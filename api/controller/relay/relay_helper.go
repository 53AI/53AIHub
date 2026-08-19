package relay

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/53AI/53AIHub/service/rag"
	"github.com/gin-gonic/gin"
	relay_model "github.com/songquanpeng/one-api/relay/model"
)

const agentRunEventSinkGinKey = "agent_run_event_sink"

type agentRunEventSinkContextKey struct{}

func installAgentRunEventSink(c *gin.Context, eid int64, requestID, runID string) *service.AgentRunEventSink {
	if c == nil || eid <= 0 || strings.TrimSpace(requestID) == "" {
		return nil
	}
	sink := service.NewAgentRunEventSink(service.AgentRunEventSinkConfig{
		EID:       eid,
		RequestID: requestID,
		RunID:     runID,
	})
	c.Set(agentRunEventSinkGinKey, sink)
	if c.Request != nil {
		ctx := context.WithValue(c.Request.Context(), agentRunEventSinkContextKey{}, sink)
		c.Request = c.Request.WithContext(ctx)
	}
	return sink
}

func agentRunEventSinkFromContext(ctx context.Context) *service.AgentRunEventSink {
	if ctx == nil {
		return nil
	}
	sink, _ := ctx.Value(agentRunEventSinkContextKey{}).(*service.AgentRunEventSink)
	return sink
}

func agentRunEventSinkFromGin(c *gin.Context) *service.AgentRunEventSink {
	if c == nil {
		return nil
	}
	if value, exists := c.Get(agentRunEventSinkGinKey); exists {
		if sink, ok := value.(*service.AgentRunEventSink); ok {
			return sink
		}
	}
	if c.Request != nil {
		return agentRunEventSinkFromContext(c.Request.Context())
	}
	return nil
}

func drainAgentRunEventSink(ctx context.Context, sink *service.AgentRunEventSink, requestID string) {
	if sink == nil {
		return
	}
	drainCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	drainErr := sink.CloseAndDrain(drainCtx)
	stats, shouldReport := sink.StatsForReport()
	if !shouldReport {
		return
	}
	if drainErr != nil {
		logger.Warnf(ctx, "【技能运行】AgentRun事件队列排空失败: request_id=%s, error_count=%d, err=%v",
			requestID, sink.ErrorCount(), drainErr)
	}
	logger.Infof(ctx, "【Agent事件性能】request_id=%s enqueued=%d persisted=%d coalesced=%d failed=%d max_queue_depth=%d persist_ms=%d elapsed_ms=%d",
		requestID, stats.Enqueued, stats.Persisted, stats.Coalesced, stats.Failed,
		stats.MaxQueueDepth, stats.PersistMillis, stats.ElapsedMillis)
}

func enqueueAgentRunAsyncWrite(ctx context.Context, name string, write func(context.Context) error) bool {
	sink := agentRunEventSinkFromContext(ctx)
	if sink == nil {
		return false
	}
	if err := sink.EnqueueWrite(name, write); err != nil {
		logger.Warnf(ctx, "【技能运行】异步兼容投影入队失败: name=%s, err=%v", name, err)
		return false
	}
	return true
}

// filterInfoMessages 过滤掉 role 为 "info" 的消息，用于 AI API 调用
// 前端发送的 messages 中可能包含 role: "info" 类型的消息（用于前端展示/后端保存）
// 但 AI API 通常不支持这种角色类型，需要在调用前过滤掉
// 保庺完整原始消息到数据库，但调用 AI API 前过滤掉 info 消息
func filterInfoMessages(messages []relay_model.Message) []relay_model.Message {
	var filteredMessages []relay_model.Message
	infoCount := 0

	for _, message := range messages {
		if message.Role == "info" {
			infoCount++
			continue // 跳过 role 为 "info" 的消息
		}
		filteredMessages = append(filteredMessages, message)
	}

	if infoCount > 0 {
		logger.Debugf(context.Background(), "过滤掉 %d 条 role 为 'info' 的消息", infoCount)
	}

	return filteredMessages
}

// ProcessStep 定义处理步骤的数据结构
// @Description ProcessStep 表示聊天过程中的处理步骤，用于实时反馈处理进度
type ProcessStep struct {
	StepCode  string                 `json:"step_code" example:"kbs"`        // 步骤代码：kbs(知识库搜索), dcs(文档搜索), ang(回答生成)
	Name      string                 `json:"name" example:"正在搜索知识库"`         // 步骤名称
	Status    string                 `json:"status" example:"processing"`    // 状态：processing(处理中), completed(已完成), error(错误)
	Message   string                 `json:"message" example:"正在搜索知识库：..."`  // 步骤详细描述信息
	Data      map[string]interface{} `json:"data,omitempty"`                 // 步骤相关的额外数据（可选）
	Timestamp int64                  `json:"timestamp" example:"1699123456"` // 时间戳（Unix秒级）
}

// sendProcessStepEnd 发送处理步骤结束标记
func sendProcessStepEnd(c *gin.Context, requestId string) error {
	createdAt := time.Now().Unix()
	if !isMessageIDFirstFrameSent(c) {
		enqueuePendingProcessStepEnd(c, requestId, createdAt)
		return nil
	}
	return sendProcessStepEndRaw(c, requestId, createdAt)
}

func sendProcessStepEndRaw(c *gin.Context, requestId string, createdAt int64) error {
	// 确保响应头已设置（如果已经设置了就不重复设置）
	if c.Writer.Header().Get("Content-Type") == "" {
		h := c.Writer.Header()
		h.Set("Content-Type", "text/event-stream; charset=utf-8")
		h.Set("Cache-Control", "no-cache")
		h.Set("Connection", "keep-alive")
		h.Set("X-Accel-Buffering", "no")
	}

	payload := map[string]interface{}{
		"id":      requestId,
		"object":  "process.step.end",
		"created": createdAt,
		"message": "Process steps completed",
	}

	b, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	chunk := append([]byte("data: "), b...)
	chunk = append(chunk, []byte("\n\n")...)

	if _, err := c.Writer.Write(chunk); err != nil {
		return err
	}
	if flusher, ok := c.Writer.(http.Flusher); ok {
		flusher.Flush()
	}
	mirrorAgentRunTimelineEvent(c, requestId, model.AgentRunEventProcessStepEnd, payload)
	return nil
}

func mirrorAgentRunTimelineEvent(c *gin.Context, requestID string, eventType string, payload map[string]interface{}) {
	_, messageID, ok := getAgentRunMirrorContext(c, requestID)
	if !ok {
		return
	}
	mirrorAgentRunTimelineEventWithMessageID(c, requestID, eventType, messageID, payload)
}

func mirrorAgentRunTimelineEventAsync(c *gin.Context, requestID string, eventType string, payload map[string]interface{}) {
	_, messageID, ok := getAgentRunMirrorContext(c, requestID)
	if !ok {
		return
	}
	mirrorAgentRunTimelineEventWithMessageID(c, requestID, eventType, messageID, payload)
}

func getAgentRunMirrorContext(c *gin.Context, requestID string) (int64, int64, bool) {
	if c == nil {
		return 0, 0, false
	}
	requestID = strings.TrimSpace(requestID)
	if requestID == "" {
		return 0, 0, false
	}

	eid := config.GetEID(c)
	if eid <= 0 {
		return 0, 0, false
	}
	if model.DB == nil {
		return 0, 0, false
	}

	messageID := int64(0)
	if masterMsgID, exists := c.Get("agent_master_message_id"); exists {
		if id, ok := masterMsgID.(int64); ok && id > 0 {
			messageID = id
		}
	}
	return eid, messageID, true
}

func mirrorAgentRunTimelineEventWithMessageID(c *gin.Context, requestID string, eventType string, messageID int64, payload map[string]interface{}) {
	if sink := agentRunEventSinkFromGin(c); sink != nil {
		if err := sink.Enqueue(eventType, messageID, payload); err != nil {
			logger.Warnf(context.Background(), "【技能运行】AgentRun事件入队失败: request_id=%s, event_type=%s, err=%v", requestID, eventType, err)
		}
		return
	}

	eid := config.GetEID(c)
	if eid <= 0 || model.DB == nil {
		return
	}
	// 非标准入口没有 request sink 时保留同步兼容路径，但为写入增加上限。
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	runSvc := service.NewAgentRunService()
	if _, err := runSvc.AppendEventForRequest(ctx, eid, requestID, eventType, messageID, payload); err != nil {
		logger.Warnf(ctx, "【技能运行】镜像过程事件失败: eid=%d, request_id=%s, event_type=%s, err=%v", eid, requestID, eventType, err)
	}
}

func mirrorOutOfRangeReplyForSubscribe(c *gin.Context, requestID string, messageID int64, answer string) {
	if strings.TrimSpace(answer) != "" {
		mirrorAgentRunTimelineEvent(c, requestID, model.AgentRunEventMessageDelta, map[string]interface{}{
			"choices": []map[string]interface{}{
				{
					"delta": relay_model.Message{
						Content: answer,
					},
				},
			},
		})
	}
	mirrorAgentRunFinalResponse(c, requestID, messageID, answer, "")
}

func mirrorAgentRunFinalResponse(c *gin.Context, requestID string, messageID int64, answer string, reasoningContent string) {
	if c == nil {
		return
	}
	requestID = strings.TrimSpace(requestID)
	if requestID == "" {
		return
	}

	eid := config.GetEID(c)
	if eid <= 0 {
		return
	}

	// 即便 answer 为空也写入 message.completed，让 subscribe 端能感知到本轮已结束。
	// 否则页面刷新后订阅会一直空等，看不到任何收尾事件。
	payload := map[string]interface{}{
		"answer": answer,
	}
	if strings.TrimSpace(reasoningContent) != "" {
		payload["reasoning_content"] = reasoningContent
	}

	ctx := c.Request.Context()
	logger.Infof(ctx, "【诊断-AgentRun】开始写入最终事件: request_id=%s message_id=%d", requestID, messageID)
	mirrorAgentRunTimelineEventWithMessageID(c, requestID, model.AgentRunEventMessageDone, messageID, payload)
	logger.Infof(ctx, "【诊断-AgentRun】完成写入最终事件: request_id=%s message_id=%d", requestID, messageID)
}

var mirrorAgentRunFinalResponsePersist = mirrorAgentRunFinalResponse

func mirrorAgentRunFinalResponseAsync(c *gin.Context, requestID string, messageID int64, answer string, reasoningContent string) {
	logger.Infof(c, "【诊断-AgentRun】异步提交最终事件: request_id=%s message_id=%d", requestID, messageID)
	mirrorAgentRunFinalResponse(c, requestID, messageID, answer, reasoningContent)
}

// handleOutOfRangeReply 处理超纲回复
func handleOutOfRangeReply(c *gin.Context, chatRequest *ChatRequest, agent *model.Agent, replyContent string, requestId string, relayMode int, messageStatus *MessageStatsInfo) {
	ctx := c.Request.Context()

	logger.Infof(ctx, "发送超纲回复: reply_chars=%d", len(replyContent))

	// 增加未搜索到内容统计
	go func() {
		if err := model.IncrementField(agent.Eid, agent.AgentID, "no_search_results", 1); err != nil {
			logger.Errorf(ctx, "增加未搜索到内容统计失败: %s", err.Error())
		}
	}()

	// 获取用户ID和会话ID，用于保存消息记录
	userID := config.GetUserId(c)
	var conversationId int64

	// 尝试从会话中获取会话ID
	if conversation, err := GetSessionConversation(c); err == nil {
		conversationId = conversation.ConversationID
	}

	existingMsgID := getPreparedMasterMessageID(c, messageStatus)
	replyMessageID := int64(0)

	if messageStatus != nil && messageStatus.DocumentType == model.DocumentTypeWiki && messageStatus.DocumentID == 0 {
		if rawSources, ok := c.Get("rag_sources"); ok {
			if sources, ok := rawSources.([]rag.SourceReference); ok {
				messageStatus.DocumentID = firstWikiPageID(sources)
			}
		}
	}

	// 保存超纲回复到聊天记录
	if existingMsgID > 0 {
		if msg, err := model.GetMessageByID(agent.Eid, existingMsgID); err == nil {
			msg.Answer = replyContent
			msg.ReasoningContent = ""
			msg.ModelName = agent.Model
			msg.Quota = 0
			msg.PromptTokens = 0
			msg.CompletionTokens = 0
			msg.TotalTokens = 0
			msg.ChannelId = 0
			msg.RequestId = requestId
			msg.ElapsedTime = 0
			msg.IsStream = chatRequest.Stream
			msg.QuotaContent = "超纲回复，无消耗"
			msg.AgentCustomConfig = agent.CustomConfig
			msg.RAGStats = ""
			msg.ResponseStatus = model.ResponseStatusReject
			msg.ThinkingMode = messageStatus.ThinkingMode
			msg.KnowledgeScope = messageStatus.KnowledgeScope
			msg.KnowledgeType = messageStatus.KnowledgeType
			msg.DocumentType = messageStatus.DocumentType
			msg.DocumentID = messageStatus.DocumentID
			if messageStatus.DocumentType == model.DocumentTypeFile {
				msg.FileID = messageStatus.DocumentID
			} else {
				msg.FileID = 0
			}
			msg.OriginalQuestion = messageStatus.OriginalQuestion
			msg.RewrittenQuestion = messageStatus.RewrittenQuestion

			if err := model.UpdateMessage(msg); err != nil {
				logger.Errorf(ctx, "更新超纲回复消息失败: %s", err.Error())
			} else {
				logger.Infof(ctx, "超纲回复消息已更新 - MessageID: %d", msg.ID)
				replyMessageID = msg.ID
			}
		} else {
			logger.Errorf(ctx, "读取已创建消息失败: %v", err)
		}
		if chatRequest.Stream {
			if err := sendMessageIDFirstFrame(c, requestId, agent.Model, existingMsgID); err != nil {
				logger.Warnf(ctx, "sendMessageIDFirstFrame failed: %v", err)
			}
		}
	} else if userID != 0 && conversationId != 0 {
		// 仅用于持久化字段：question/message 只保留最后一条 user 消息
		messageJSON, err := json.Marshal(prepareMessagesForStorage(chatRequest.Messages))
		if err != nil {
			logger.Errorf(ctx, "序列化消息失败: %s", err.Error())
			messageJSON = []byte("[]")
		}

		// 创建消息记录
		message := &model.Message{
			Eid:               agent.Eid,
			UserID:            userID,
			ConversationID:    conversationId,
			AgentID:           agent.AgentID,
			Message:           string(messageJSON),
			Answer:            replyContent,
			ReasoningContent:  "",
			ModelName:         agent.Model,
			Quota:             0,
			PromptTokens:      0,
			CompletionTokens:  0,
			TotalTokens:       0,
			ChannelId:         0, // 超纲回复不使用渠道
			RequestId:         requestId,
			ElapsedTime:       0,
			IsStream:          chatRequest.Stream,
			QuotaContent:      "超纲回复，无消耗",
			AgentCustomConfig: agent.CustomConfig,
			RAGStats:          "", // 超纲回复没有RAG统计
			ResponseStatus:    model.ResponseStatusReject,
			ThinkingMode:      messageStatus.ThinkingMode,
			KnowledgeScope:    messageStatus.KnowledgeScope,
			KnowledgeType:     messageStatus.KnowledgeType,
			DocumentType:      messageStatus.DocumentType,
			DocumentID:        messageStatus.DocumentID,
			FileID: func() int64 {
				if messageStatus.DocumentType == model.DocumentTypeFile {
					return messageStatus.DocumentID
				}
				return 0
			}(),
			OriginalQuestion:  messageStatus.OriginalQuestion,
			RewrittenQuestion: messageStatus.RewrittenQuestion,
			RequestSource:     messageStatus.RequestSource,
			// CitationCount:     messageStatus.CitationCount,
		}

		applyVisitorIdentityToMessage(c, message)
		if err := model.CreateMessage(message); err != nil {
			logger.Errorf(ctx, "保存超纲回复消息失败: %s", err.Error())
		} else {
			logger.Infof(ctx, "超纲回复消息已保存 - MessageID: %d", message.ID)

			// 更新会话的最后消息
			if err := updateConversationLastMessage(agent.Eid, conversationId, userID, string(messageJSON), replyContent, 0, 0); err != nil {
				logger.Errorf(ctx, "更新会话最后消息失败: %v", err)
			}

			// 流式响应统一先发送 message_id 首帧
			if chatRequest.Stream {
				if err := sendMessageIDFirstFrame(c, requestId, agent.Model, message.ID); err != nil {
					logger.Warnf(ctx, "sendMessageIDFirstFrame failed: %v", err)
				}
			}
			replyMessageID = message.ID
		}
	}

	if replyMessageID > 0 {
		if userID > 0 {
			if err := model.AddOrUpdateUserAgentShortcut(agent.Eid, userID, agent.AgentID, replyContent); err != nil {
				logger.Warnf(ctx, "【快捷Agent】超纲回复更新快捷失败: eid=%d user_id=%d agent_id=%d err=%v", agent.Eid, userID, agent.AgentID, err)
			}
		}
		mirrorOutOfRangeReplyForSubscribe(c, requestId, replyMessageID, replyContent)
		finalizeAgentRunForMessage(ctx, agent, conversationId, replyMessageID, requestId, model.AgentRunStatusCompleted, "", "")
	}

	// 根据是否流式返回不同格式的响应
	if chatRequest.Stream {
		// 流式响应
		sendStreamOutOfRangeReply(c, replyContent, requestId, agent.Model)
	} else {
		// 非流式响应
		sendNonStreamOutOfRangeReply(c, replyContent, requestId, agent.Model)
	}
}

// sendStreamOutOfRangeReply 发送流式超纲回复
func sendStreamOutOfRangeReply(c *gin.Context, content string, requestId string, model string) {
	// 设置流式响应头
	h := c.Writer.Header()
	h.Set("Content-Type", "text/event-stream; charset=utf-8")
	h.Set("Cache-Control", "no-cache")
	h.Set("Connection", "keep-alive")
	h.Set("X-Accel-Buffering", "no")

	// 构造流式响应格式
	response := map[string]interface{}{
		"id":      requestId,
		"object":  "chat.completion.chunk",
		"created": time.Now().Unix(),
		"model":   model,
		"choices": []map[string]interface{}{
			{
				"index": 0,
				"delta": map[string]interface{}{
					"content": content,
				},
				"finish_reason": nil,
			},
		},
	}

	jsonData, err := json.Marshal(response)
	if err != nil {
		logger.Errorf(c.Request.Context(), "序列化流式响应失败: %v", err)
		return
	}

	// 发送数据块
	chunk := append([]byte("data: "), jsonData...)
	chunk = append(chunk, []byte("\n\n")...)

	if _, err := c.Writer.Write(chunk); err != nil {
		logger.Errorf(c.Request.Context(), "写入流式响应失败: %v", err)
		return
	}
	if flusher, ok := c.Writer.(http.Flusher); ok {
		flusher.Flush()
	}

	// 发送完成标记
	doneChunk := append([]byte("data: "), []byte("[DONE]\n\n")...)
	c.Writer.Write(doneChunk)
	if flusher, ok := c.Writer.(http.Flusher); ok {
		flusher.Flush()
	}
}

// createRAGStatsData 创建RAG统计数据格式
func createRAGStatsData(eid int64, typeStr string, searchResponse *rag.SearchResponse, sources []rag.SourceReference, answer string) map[string]interface{} {
	var processingTimeMs int64 = 0
	if searchResponse != nil {
		processingTimeMs = searchResponse.Time
	}

	stats := map[string]interface{}{
		"document_search": map[string]interface{}{
			"chunks": []interface{}{}, // 搜索到的所有分片列表
		},
		"document_quotations":  []string{}, // 实际被引用的分片ID列表
		"file_quotations":      []string{}, // 实际被引用的去重file_id列表
		"wiki_page_quotations": []string{},
		"performance": map[string]interface{}{
			"processing_time_ms": processingTimeMs,
		},
		"type": typeStr,
	}

	// 统计文档搜索数据
	if searchResponse != nil {
		// 预先批量获取知识库信息
		extendedInfos := getExtendedChunkInfo(eid, searchResponse.Results)

		// 构建分片信息，与流输出的文档列表一样
		var chunks []interface{}
		for _, result := range searchResponse.Results {
			extendedInfo := extendedInfos[result.ChunkID]

			contentPreview := ""
			runes := []rune(result.Content)
			if len(runes) > MAX_DESC_WORD {
				contentPreview = string(runes[:MAX_DESC_WORD])
			} else {
				contentPreview = result.Content
			}

			if extendedInfo.KnowledgeBaseName != "" {
				result.LibraryName = extendedInfo.KnowledgeBaseName
			}
			if extendedInfo.KnowledgeBaseLogo != "" {
				result.LibraryIcon = extendedInfo.KnowledgeBaseLogo
			}

			SourceKey := ""
			for _, sourceItem := range sources {
				if sourceItem.ChunkID == result.ChunkID {
					SourceKey = sourceItem.SourceKey
					break
				}
			}

			chunk := map[string]interface{}{
				"chunk_id":     hashInt64(result.ChunkID),
				"chunk_type":   result.ChunkType,
				"content":      contentPreview,
				"file_id":      hashInt64(result.FileID),
				"file_name":    result.FileName,
				"library_id":   hashInt64(result.LibraryID),
				"library_name": result.LibraryName,
				"library_icon": result.LibraryIcon,
				"space_id":     hashInt64(extendedInfo.SpaceID),
				"space_name":   extendedInfo.SpaceName,
				"score":        result.Score,
				"file_path":    result.FilePath,
				"source_key":   SourceKey,
			}
			chunks = append(chunks, chunk)
		}

		stats["document_search"].(map[string]interface{})["chunks"] = chunks

		// 从回答内容中提取实际的引用
		if answer != "" {
			quotedSourceIDs := extractQuotedSourceIDs(answer)
			quotedChunkIDs, quotedFileIDs := resolveQuotedSourceIDs(quotedSourceIDs, sources, false, true)
			stats["document_quotations"] = quotedChunkIDs
			stats["file_quotations"] = quotedFileIDs
			stats["wiki_page_quotations"] = getQuotedWikiPageIDs(quotedSourceIDs, sources)
		} else {
			// 如果还没有回答内容，暂时使用所有搜索到的分片和文件
			var chunkQuotations []string
			var fileQuotationsMap = make(map[int64]bool) // 使用map去重

			for _, source := range sources {
				if source.SourceType == "wiki" {
					continue
				}
				chunkQuotations = append(chunkQuotations, hashInt64(source.ChunkID))
				fileQuotationsMap[source.FileID] = true
			}

			// 将去重的file_id转换为字符串数组
			var fileQuotations []string
			for fileID := range fileQuotationsMap {
				fileQuotations = append(fileQuotations, hashInt64(fileID))
			}

			stats["document_quotations"] = chunkQuotations
			stats["file_quotations"] = fileQuotations
			stats["wiki_page_quotations"] = getQuotedWikiPageIDs(nil, sources)
		}
	}

	return stats
}

// collectRAGStats 收集RAG检索统计数据
func collectRAGStats(eid int64, typeStr string, searchResponse *rag.SearchResponse, sources []rag.SourceReference, retrievalContext string, resolvedLibraryIDs []int64, kbNames []string, uniqueDocuments []UniqueDocumentInfo, answer string) map[string]interface{} {
	// 使用统一的RAG数据格式，传入回答内容以提取实际引用
	return createRAGStatsData(eid, typeStr, searchResponse, sources, answer)
}

// getKnowledgeBaseNames 获取知识库名称列表
func getKnowledgeBaseNames(eid int64, libraryIDs []int64) ([]string, error) {
	var names []string
	for _, id := range libraryIDs {
		library, err := model.GetLibraryByID(eid, id)
		if err != nil {
			continue // 跳过获取失败的知识库
		}
		names = append(names, library.Name)
	}
	return names, nil
}

// resolveKnowledgeBaseIDs 解析知识库ID，支持 "all" 参数和加密的hashID
func resolveKnowledgeBaseIDs(eid int64, libraryHashIDs []string) ([]int64, error) {
	// 检查是否包含 "all" 标识
	for _, hashID := range libraryHashIDs {
		if hashID == "all" || hashID == "-1" {
			// 获取所有活跃状态的知识库
			libraries, err := model.GetLibrariesByEid(eid, nil)
			if err != nil {
				return nil, fmt.Errorf("获取知识库列表失败: %v", err)
			}
			var allIDs []int64
			for _, lib := range libraries {
				allIDs = append(allIDs, lib.ID)
			}
			return allIDs, nil
		}
	}

	// 解析加密的hashID
	var resolvedIDs []int64
	for _, hashID := range libraryHashIDs {
		// 尝试从hashID解码获取原始ID
		if originalID, err := hashids.Decode(hashID); err == nil {
			resolvedIDs = append(resolvedIDs, originalID)
		} else {
			// 如果解码失败，尝试直接解析为数字（向后兼容）
			if id, err := strconv.ParseInt(hashID, 10, 64); err == nil {
				resolvedIDs = append(resolvedIDs, id)
			} else {
				return nil, fmt.Errorf("无法解析知识库ID: %s", hashID)
			}
		}
	}

	return resolvedIDs, nil
}

// resolveFileIDs 解析文件ID，支持加密的hashID
func resolveFileIDs(eid int64, fileHashIDs []string) ([]int64, error) {
	var resolvedIDs []int64
	for _, hashID := range fileHashIDs {
		// 尝试从hashID解码获取原始ID
		if originalID, err := hashids.Decode(hashID); err == nil {
			resolvedIDs = append(resolvedIDs, originalID)
		} else {
			// 如果解码失败，尝试直接解析为数字（向后兼容）
			if id, err := strconv.ParseInt(hashID, 10, 64); err == nil {
				resolvedIDs = append(resolvedIDs, id)
			} else {
				return nil, fmt.Errorf("无法解析文件ID: %s", hashID)
			}
		}
	}

	return resolvedIDs, nil
}

// SearchTarget 搜索目标类型
type SearchTarget struct {
	Type       string  // "knowledge_base" 或 "file"
	SpaceIDs   []int64 // 空间ID列表（原始解码后）
	LibraryIDs []int64 // 知识库ID列表
	FileIDs    []int64 // 文件ID列表
}

// resolveSearchTargets 解析搜索目标，将 space_ids / knowledge_base_ids / file_ids 三路合并
func resolveSearchTargets(eid int64, spaceIDs []string, knowledgeBaseIDs []string, fileIDs []string) (*SearchTarget, error) {
	libraryIDs := make([]int64, 0)
	var spaceResolvedIDs []int64

	// 1. 解析空间ID → 展开为知识库ID
	if len(spaceIDs) > 0 {
		resolved, err := resolveSpaceIDs(eid, spaceIDs)
		if err != nil {
			return nil, fmt.Errorf("解析空间ID失败: %v", err)
		}
		spaceResolvedIDs = resolved
		libraryIDs = append(libraryIDs, resolved...)
	}

	// 2. 解析知识库ID
	if len(knowledgeBaseIDs) > 0 {
		resolvedLibraryIDs, err := resolveKnowledgeBaseIDs(eid, knowledgeBaseIDs)
		if err != nil {
			return nil, fmt.Errorf("解析知识库ID失败: %v", err)
		}
		libraryIDs = append(libraryIDs, resolvedLibraryIDs...)
	}

	// 3. 去重 LibraryIDs
	libraryIDs = uniqueInt64IDsInOrder(libraryIDs)

	// 4. 解析文件ID
	var resolvedFileIDs []int64
	if len(fileIDs) > 0 {
		resolved, err := resolveFileIDs(eid, fileIDs)
		if err != nil {
			return nil, fmt.Errorf("解析文件ID失败: %v", err)
		}
		// 扩展文件夹ID
		expandedFileIDs, err := expandFileIDs(eid, resolved)
		if err != nil {
			logger.Warnf(context.Background(), "扩展文件夹ID失败，使用原始文件ID: %v", err)
			expandedFileIDs = resolved // 降级处理
		}
		resolvedFileIDs = expandedFileIDs
	}

	// 5. 返回合并结果
	if len(libraryIDs) == 0 && len(resolvedFileIDs) == 0 {
		return &SearchTarget{
			Type:       "",
			SpaceIDs:   spaceResolvedIDs,
			LibraryIDs: nil,
			FileIDs:    nil,
		}, nil
	}

	return &SearchTarget{
		Type:       "knowledge_base",
		SpaceIDs:   spaceResolvedIDs,
		LibraryIDs: libraryIDs,
		FileIDs:    resolvedFileIDs,
	}, nil
}

// resolveSpaceIDs 解析空间ID列表，返回空间下所有活跃知识库的ID（去重后）
func resolveSpaceIDs(eid int64, spaceHashIDs []string) ([]int64, error) {
	if len(spaceHashIDs) == 0 {
		return nil, nil
	}

	var allLibraryIDs []int64
	for _, hashID := range spaceHashIDs {
		// 解码 hashID
		spaceID, err := hashids.Decode(hashID)
		if err != nil {
			// 尝试直接解析为数字（向后兼容）
			if id, parseErr := strconv.ParseInt(hashID, 10, 64); parseErr == nil {
				spaceID = id
			} else {
				return nil, fmt.Errorf("无法解析空间ID: %s", hashID)
			}
		}

		// 查询空间下所有活跃知识库
		libraries, err := model.GetLibrariesBySpaceID(eid, spaceID)
		if err != nil {
			logger.Warnf(context.Background(), "查询空间 %d 的知识库失败: %v", spaceID, err)
			continue // 跳过失败的空间，不阻塞
		}

		for _, lib := range libraries {
			if lib.Status == model.LIBRARY_STATUS_ACTIVE {
				allLibraryIDs = append(allLibraryIDs, lib.ID)
			}
		}
	}

	return allLibraryIDs, nil
}

// expandFileIDs 扩展文件ID列表，将文件夹ID递归展开为其下所有子文件ID
func expandFileIDs(eid int64, fileIDs []int64) ([]int64, error) {
	if len(fileIDs) == 0 {
		return fileIDs, nil
	}

	// 1. 批量查询文件信息
	files, err := model.GetFilesByIDs(eid, fileIDs)
	if err != nil {
		return nil, fmt.Errorf("查询文件信息失败: %v", err)
	}

	// 2. 分离文件和文件夹
	var directFileIDs []int64
	var folderInfo []struct {
		Path      string
		LibraryID int64
		FileID    int64
	}

	for _, file := range files {
		if file.Type == model.FILE_TYPE_FILE {
			directFileIDs = append(directFileIDs, file.ID)
		} else if file.Type == model.FILE_TYPE_DIR {
			folderInfo = append(folderInfo, struct {
				Path      string
				LibraryID int64
				FileID    int64
			}{
				Path:      file.Path,
				LibraryID: file.LibraryID,
				FileID:    file.ID,
			})
		}
	}

	// 3. 对每个文件夹递归获取子文件ID
	var allChildFileIDs []int64
	for _, folder := range folderInfo {
		childFileIDs, err := model.GetFileIDsByDirectoryPath(eid, folder.LibraryID, folder.Path)
		if err != nil {
			logger.Warnf(context.Background(), "获取文件夹 %s (ID: %d) 的子文件失败: %v",
				folder.Path, folder.FileID, err)
			continue
		}

		logger.Infof(context.Background(), "文件夹 %s 扩展出 %d 个子文件", folder.Path, len(childFileIDs))
		allChildFileIDs = append(allChildFileIDs, childFileIDs...)
	}

	// 4. 合并所有文件ID并去重
	allFileIDs := append(directFileIDs, allChildFileIDs...)
	finalFileIDs := model.DeduplicateFileIDs(allFileIDs)

	// 5. 记录处理结果
	originalCount := len(fileIDs)
	finalCount := len(finalFileIDs)
	expandedCount := finalCount - len(directFileIDs)

	logger.Infof(context.Background(), "文件ID扩展完成: 原始 %d 个, 直接文件 %d 个, 扩展子文件 %d 个, 最终去重后 %d 个",
		originalCount, len(directFileIDs), expandedCount, finalCount)

	return finalFileIDs, nil
}

// buildSearchRequest 根据搜索目标构建搜索请求
func buildSearchRequest(query string, searchType string, topK int, chunkTypes []string, searchTarget *SearchTarget) *rag.SearchRequest {
	searchRequest := &rag.SearchRequest{
		Query:      query,
		SearchType: searchType,
		TopK:       topK,
		ChunkTypes: chunkTypes,
	}

	// 根据搜索目标类型设置相应的ID列表
	if searchTarget != nil {
		if searchTarget.Type == "knowledge_base" {
			searchRequest.LibraryIDs = searchTarget.LibraryIDs
			searchRequest.FileIDs = nil
		} else if searchTarget.Type == "file" {
			searchRequest.LibraryIDs = nil
			searchRequest.FileIDs = searchTarget.FileIDs
		}
	}

	return searchRequest
}

// sendNonStreamOutOfRangeReply 发送非流式超纲回复
func sendNonStreamOutOfRangeReply(c *gin.Context, content string, requestId string, model string) {
	// 构造响应格式
	response := map[string]interface{}{
		"id":      requestId,
		"object":  "chat.completion",
		"created": time.Now().Unix(),
		"model":   model,
		"choices": []map[string]interface{}{
			{
				"index": 0,
				"message": map[string]interface{}{
					"role":    "assistant",
					"content": content,
				},
				"finish_reason": "stop",
			},
		},
		"usage": map[string]interface{}{
			"prompt_tokens":     0,
			"completion_tokens": 0,
			"total_tokens":      0,
		},
	}

	c.JSON(200, response)
}

// GetUniqueDocumentsFromSources 从搜索结果中提取去重文档列表（导出供测试使用）
func GetUniqueDocumentsFromSources(sources []rag.SourceReference) []UniqueDocumentInfo {
	// 使用 map 进行去重，记录每个文档的匹配分片数量
	documentMap := make(map[int64]*UniqueDocumentInfo)

	for _, source := range sources {
		if docInfo, exists := documentMap[source.FileID]; exists {
			// 文档已存在，增加分片计数
			docInfo.ChunkCount++
		} else {
			// 新文档，创建记录，保存第一个分片的内容作为文档详情
			documentMap[source.FileID] = &UniqueDocumentInfo{
				FileID:     source.FileID,
				FileName:   source.FileName,
				FilePath:   "", // 可以从数据库查询获取完整路径
				ChunkCount: 1,
				FirstChunk: source.Content, // 保存第一个分片的内容作为文档详情
			}
		}
	}

	// 转换为切片
	var uniqueDocuments []UniqueDocumentInfo
	for _, doc := range documentMap {
		uniqueDocuments = append(uniqueDocuments, *doc)
	}

	return uniqueDocuments
}

// updateUniqueDocumentsWithFileDetails 更新去重文档列表的详细信息
func updateUniqueDocumentsWithFileDetails(eid int64, documents []UniqueDocumentInfo) error {
	if len(documents) == 0 {
		return nil
	}

	// 提取所有文档ID
	fileIDs := make([]int64, 0, len(documents))
	for _, doc := range documents {
		fileIDs = append(fileIDs, doc.FileID)
	}

	// 批量查询文档信息
	var files []model.File
	err := model.DB.Where("eid = ? AND id IN ?", eid, fileIDs).Find(&files).Error
	if err != nil {
		return fmt.Errorf("批量查询文档信息失败: %v", err)
	}

	// 创建文件ID到文件信息的映射
	fileMap := make(map[int64]*model.File)
	for i := range files {
		fileMap[files[i].ID] = &files[i]
	}

	// 更新文档信息
	for i := range documents {
		if file, exists := fileMap[documents[i].FileID]; exists {
			documents[i].FilePath = file.Path
		}
	}

	return nil
}

// ChunkExtendedInfo 分片扩展信息
type ChunkExtendedInfo struct {
	KnowledgeBaseID   int64  `json:"knowledge_base_id"`
	KnowledgeBaseName string `json:"knowledge_base_name"`
	KnowledgeBaseLogo string `json:"knowledge_base_logo"`
	FileCreatedAt     int64  `json:"file_created_at"`
	SpaceID           int64  `json:"space_id"`
	SpaceName         string `json:"space_name"`
}

func uniqueInt64IDsInOrder(ids []int64) []int64 {
	if len(ids) == 0 {
		return nil
	}

	seen := make(map[int64]struct{}, len(ids))
	unique := make([]int64, 0, len(ids))
	for _, id := range ids {
		if id <= 0 {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		unique = append(unique, id)
	}
	if len(unique) == 0 {
		return nil
	}
	return unique
}

func resultsHavePreloadedChunkMetadata(results []rag.SearchResultItem) bool {
	if len(results) == 0 {
		return false
	}

	for _, result := range results {
		if result.FileCreatedAt == 0 || result.SpaceID == 0 || result.SpaceName == "" || result.LibraryName == "" {
			return false
		}
	}

	return true
}

// getExtendedChunkInfo 批量获取分片的扩展信息（知识库信息和文件创建时间）
func getExtendedChunkInfo(eid int64, results []rag.SearchResultItem) map[int64]ChunkExtendedInfo {
	extendedInfos := make(map[int64]ChunkExtendedInfo)

	if len(results) == 0 {
		return extendedInfos
	}

	if resultsHavePreloadedChunkMetadata(results) {
		for _, result := range results {
			extendedInfos[result.ChunkID] = ChunkExtendedInfo{
				KnowledgeBaseID:   result.LibraryID,
				KnowledgeBaseName: result.LibraryName,
				KnowledgeBaseLogo: result.LibraryIcon,
				FileCreatedAt:     result.FileCreatedAt,
				SpaceID:           result.SpaceID,
				SpaceName:         result.SpaceName,
			}
		}
		return extendedInfos
	}

	// 提取所有分片ID
	chunkIDs := make([]int64, 0, len(results))
	for _, result := range results {
		chunkIDs = append(chunkIDs, result.ChunkID)
	}
	chunkIDs = uniqueInt64IDsInOrder(chunkIDs)
	if len(chunkIDs) == 0 {
		return extendedInfos
	}

	// 批量查询分片信息，获取知识库ID和文件ID
	var chunks []model.DocumentChunk
	err := model.DB.Where("eid = ? AND id IN ?", eid, chunkIDs).Find(&chunks).Error
	if err != nil {
		logger.Warnf(context.Background(), "批量查询分片信息失败: %v", err)
		// 返回空的扩展信息，使用零值
		for _, chunkID := range chunkIDs {
			extendedInfos[chunkID] = ChunkExtendedInfo{}
		}
		return extendedInfos
	}

	// 构建分片ID到分片信息的映射
	chunkMap := make(map[int64]*model.DocumentChunk)
	for i := range chunks {
		chunkMap[chunks[i].ID] = &chunks[i]
	}

	// 提取所有唯一的文件ID
	fileIDs := make([]int64, 0)
	for _, chunk := range chunks {
		fileIDs = append(fileIDs, chunk.FileID)
	}
	fileIDs = uniqueInt64IDsInOrder(fileIDs)

	// 批量查询文件信息，获取创建时间
	var files []model.File
	if len(fileIDs) > 0 {
		err = model.DB.Where("eid = ? AND id IN ?", eid, fileIDs).Find(&files).Error
		if err != nil {
			logger.Warnf(context.Background(), "批量查询文件信息失败: %v", err)
		}
	}

	// 构建文件ID到文件信息的映射
	fileMap := make(map[int64]*model.File)
	for i := range files {
		fileMap[files[i].ID] = &files[i]
	}

	// 提取所有唯一的知识库ID
	libraryIDs := make([]int64, 0)
	for _, chunk := range chunks {
		libraryIDs = append(libraryIDs, chunk.LibraryID)
	}
	libraryIDs = uniqueInt64IDsInOrder(libraryIDs)

	// 批量查询知识库信息，获取名称和logo
	var libraries []model.Library
	if len(libraryIDs) > 0 {
		err = model.DB.Where("eid = ? AND id IN ?", eid, libraryIDs).Find(&libraries).Error
		if err != nil {
			logger.Warnf(context.Background(), "批量查询知识库信息失败: %v", err)
		}
	}

	// 构建知识库ID到知识库信息的映射
	libraryMap := make(map[int64]*model.Library)
	for i := range libraries {
		libraryMap[libraries[i].ID] = &libraries[i]
	}

	// 提取所有唯一的空间ID
	spaceIDs := make([]int64, 0)
	for _, library := range libraries {
		spaceIDs = append(spaceIDs, library.SpaceID)
	}
	spaceIDs = uniqueInt64IDsInOrder(spaceIDs)

	// 批量查询空间信息，获取名称
	var spaces []model.Space
	if len(spaceIDs) > 0 {
		err = model.DB.Where("eid = ? AND id IN ?", eid, spaceIDs).Find(&spaces).Error
		if err != nil {
			logger.Warnf(context.Background(), "批量查询空间信息失败: %v", err)
		}
	}

	// 构建空间ID到空间信息的映射
	spaceMap := make(map[int64]*model.Space)
	for i := range spaces {
		spaceMap[spaces[i].ID] = &spaces[i]
	}

	// 为每个分片构建扩展信息
	for _, chunkID := range chunkIDs {
		info := ChunkExtendedInfo{}

		if chunk, exists := chunkMap[chunkID]; exists {
			info.KnowledgeBaseID = chunk.LibraryID

			// 获取知识库信息
			if library, libExists := libraryMap[chunk.LibraryID]; libExists {
				info.KnowledgeBaseName = library.Name
				info.KnowledgeBaseLogo = library.Icon
				info.SpaceID = library.SpaceID

				// 获取空间信息
				if space, spaceExists := spaceMap[library.SpaceID]; spaceExists {
					info.SpaceName = space.Name
				}
			}

			// 获取文件创建时间
			if file, fileExists := fileMap[chunk.FileID]; fileExists {
				info.FileCreatedAt = file.CreatedTime
			}
		}

		extendedInfos[chunkID] = info
	}

	return extendedInfos
}

// hashInt64Slice 对int64数组进行hash化
func hashInt64Slice(ids []int64) []string {
	if len(ids) == 0 {
		return []string{}
	}

	hashedIDs := make([]string, len(ids))
	for i, id := range ids {
		if hashedID, err := hashids.Encode(id); err == nil {
			hashedIDs[i] = hashedID
		} else {
			// 如果hash化失败，保留原字符串
			hashedIDs[i] = fmt.Sprintf("%d", id)
			logger.Warnf(context.Background(), "Failed to hash ID %d: %v", id, err)
		}
	}

	return hashedIDs
}

// hashSourcesArray 对SourceReference数组进行hash化
func hashSourcesArray(sources []rag.SourceReference) []map[string]interface{} {
	if len(sources) == 0 {
		return []map[string]interface{}{}
	}

	hashedSources := make([]map[string]interface{}, len(sources))
	for i, source := range sources {
		hashedSource := map[string]interface{}{
			"source_type":         source.SourceType,
			"wiki_page_id":        hashInt64(source.WikiPageID),
			"reference_id":        source.ReferenceID,
			"chunk_id":            hashInt64(source.ChunkID),
			"file_id":             hashInt64(source.FileID),
			"file_name":           source.FileName,
			"chunk_type":          source.ChunkType,
			"content":             source.Content,
			"score":               source.Score,
			"start_position":      source.StartPosition,
			"end_position":        source.EndPosition,
			"url":                 source.URL,
			"file_path":           source.FilePath,
			"knowledge_base_id":   hashInt64(source.KnowledgeBaseID),
			"knowledge_base_name": source.KnowledgeBaseName,
			"knowledge_base_logo": source.KnowledgeBaseLogo,
			"library_id":          source.LibraryID,
			"library_name":        source.LibraryName,
			"library_icon":        source.LibraryIcon,
			"space_id":            source.SpaceID,
			"space_name":          source.SpaceName,
			"slug":                source.Slug,
			"title":               source.Title,
			"file_created_at":     source.FileCreatedAt,
			"source_key":          source.SourceKey,
		}
		if source.ChunkType == rag.GraphAggregateChunkType || source.EntityCount > 0 || source.EntitySupportingChunkCount > 0 || source.RelationSupportingChunkCount > 0 || source.SupportingChunkCountTotal > 0 {
			hashedSource["entity_count"] = source.EntityCount
			hashedSource["entity_supporting_chunk_count"] = source.EntitySupportingChunkCount
			hashedSource["relation_supporting_chunk_count"] = source.RelationSupportingChunkCount
			hashedSource["supporting_chunk_count_total"] = source.SupportingChunkCountTotal
		}
		if graphData := hashGraphAggregate(source.Graph); graphData != nil {
			hashedSource["graph"] = graphData
		}
		hashedSources[i] = hashedSource
	}

	return hashedSources
}

func hashGraphAggregate(graph *rag.GraphAggregateGraph) map[string]interface{} {
	if graph == nil {
		return nil
	}

	entities := make([]map[string]interface{}, 0, len(graph.Entities))
	for _, entity := range graph.Entities {
		if entity == nil {
			continue
		}
		entities = append(entities, map[string]interface{}{
			"id":           entity.ID,
			"type":         entity.Type,
			"name":         entity.Name,
			"properties":   entity.Properties,
			"chunk_ids":    entity.ChunkIDs,
			"created_time": entity.CreatedTime,
		})
	}

	relations := make([]map[string]interface{}, 0, len(graph.Relations))
	for _, relation := range graph.Relations {
		if relation == nil {
			continue
		}
		relations = append(relations, map[string]interface{}{
			"id":               relation.ID,
			"source_entity_id": relation.SourceEntityID,
			"target_entity_id": relation.TargetEntityID,
			"predicate":        relation.Predicate,
			"chunk_ids":        relation.ChunkIDs,
			"created_time":     relation.CreatedTime,
		})
	}

	return map[string]interface{}{
		"entities":  entities,
		"relations": relations,
	}
}

// hashUniqueDocumentsArray 对UniqueDocumentInfo数组进行hash化
func hashUniqueDocumentsArray(docs []UniqueDocumentInfo) []map[string]interface{} {
	if len(docs) == 0 {
		return []map[string]interface{}{}
	}

	hashedDocs := make([]map[string]interface{}, len(docs))
	for i, doc := range docs {
		hashedDoc := map[string]interface{}{
			"file_id":     hashInt64(doc.FileID),
			"file_name":   doc.FileName,
			"file_path":   doc.FilePath,
			"chunk_count": doc.ChunkCount,
			"first_chunk": doc.FirstChunk,
		}
		hashedDocs[i] = hashedDoc
	}

	return hashedDocs
}

// hashInt64 对单个int64进行hash化
func hashInt64(id int64) string {
	if id <= 0 {
		return ""
	}

	if hashedID, err := hashids.Encode(id); err == nil {
		return hashedID
	} else if err != nil {
		// 如果hash化失败，返回原字符串
		logger.Warnf(context.Background(), "Failed to hash ID %d: %v", id, err)
		return fmt.Sprintf("%d", id)
	}

	// 默认返回原字符串
	return fmt.Sprintf("%d", id)
}

// truncateContent 截取内容为指定长度的预览
func truncateContent(content string, maxLen int) string {
	runes := []rune(content)
	if len(runes) <= maxLen {
		return content
	}
	return string(runes[:maxLen]) + "..."
}

// performWebSearch 执行全网搜索
func performWebSearch(agent *model.Agent, webSearchConfig *model.WebSearchConfig, query string) (*service.SearchResponse, error) {
	// ctx := context.Background()

	// 从PlatformSetting中获取API密钥
	platformSettingID, err := hashids.Decode(webSearchConfig.PlatformSettingID)
	if err != nil {
		return nil, fmt.Errorf("解析PlatformSetting ID失败: %v", err)
	}

	platformSetting, err := model.GetPlatformSettingByID(platformSettingID)
	if err != nil {
		return nil, fmt.Errorf("获取PlatformSetting失败: %v", err)
	}

	if platformSetting.Eid != agent.Eid {
		return nil, fmt.Errorf("PlatformSetting不属于当前企业")
	}

	// 解析设置中的API密钥
	var apiKeySetting struct {
		APIKey string `json:"api_key"`
	}
	if err := json.Unmarshal([]byte(platformSetting.Setting), &apiKeySetting); err != nil {
		return nil, fmt.Errorf("解析API密钥失败: %v", err)
	}

	if apiKeySetting.APIKey == "" {
		return nil, fmt.Errorf("API密钥不能为空")
	}

	// 创建博查AI服务实例
	bochaAIService := service.NewBochaAIService(apiKeySetting.APIKey)

	// 创建搜索请求
	request := service.SearchRequest{
		Query:   query,
		Count:   10,
		Summary: true,
	}

	// 执行搜索
	response, err := bochaAIService.Search(request)
	if err != nil {
		return nil, fmt.Errorf("搜索请求失败: %v", err)
	}

	// 检查响应状态码
	codeStr, ok := response.Code.(string)
	if ok {
		if codeStr != "200" {
			return nil, fmt.Errorf("搜索响应错误，状态码: %s", codeStr)
		}
	} else {
		codeNum, ok := response.Code.(float64) // JSON数字默认解析为float64
		if ok {
			if codeNum != 200 {
				return nil, fmt.Errorf("搜索响应错误，状态码: %f", codeNum)
			}
		} else {
			return nil, fmt.Errorf("无法识别的响应状态码类型: %T, 值: %v", response.Code, response.Code)
		}
	}

	return response, nil
}

// createQuotationsData 创建引用数据
func createQuotationsData(ctx context.Context, sources []rag.SourceReference, answer string) map[string]interface{} {
	quotedChunkIDs := make([]string, 0)
	quotedFileIDs := make([]string, 0)
	quotedWikiPageIDs := make([]string, 0)

	logger.Debugf(ctx, "【引用分析】开始生成引用数据: sources=%d, answer_len=%d", len(sources), len(answer))
	for i, source := range sources {
		logger.Debugf(ctx, "【引用分析】source[%d]: reference_id=%s, chunk_id=%d, file_id=%d, source_key=%s",
			i, source.ReferenceID, source.ChunkID, source.FileID, source.SourceKey)
	}

	if answer != "" {
		// 从回答内容中提取实际的引用
		quotedSourceIDs := extractQuotedSourceIDs(answer)
		logger.Debugf(ctx, "【引用分析】extractQuotedSourceIDs 结果: %v", quotedSourceIDs)

		// 判断是否为网页搜索（通过检查ReferenceID是否以"B_"开头）
		isWebSearch := false
		isSoloFile := false

		if len(sources) > 0 {
			if strings.HasPrefix(sources[0].ReferenceID, "B_") {
				isWebSearch = true
			} else if strings.Contains(sources[0].ReferenceID, "-") && !strings.HasPrefix(sources[0].ReferenceID, "A_") {
				// 包含短横线且不是A_开头，可能是单文件模式
				isSoloFile = true
			}
		}

		if isWebSearch {
			// 对于网页搜索，直接使用原始ID
			quotedChunkIDs, quotedFileIDs = resolveQuotedSourceIDs(quotedSourceIDs, sources, true, false)
		} else if isSoloFile {
			// 对于单文件模式，使用hash值
			quotedChunkIDs, quotedFileIDs = resolveQuotedSourceIDs(quotedSourceIDs, sources, false, true)
		} else {
			// 对于知识库搜索，使用hash值
			quotedChunkIDs, quotedFileIDs = resolveQuotedSourceIDs(quotedSourceIDs, sources, false, true)
		}
		lookup := buildQuotedSourceLookup(sources)
		for _, sourceID := range quotedSourceIDs {
			info, ok := lookupQuotedSourceInfo(lookup, sourceID)
			if ok && info.SourceType == "wiki" && info.WikiPageID > 0 {
				quotedWikiPageIDs = append(quotedWikiPageIDs, hashInt64(info.WikiPageID))
			}
		}
	}

	logger.Debugf(ctx, "【引用分析】引用数据生成完成: document_quotations=%v, file_quotations=%v",
		quotedChunkIDs, quotedFileIDs)

	return map[string]interface{}{
		"document_quotations":  quotedChunkIDs,
		"file_quotations":      quotedFileIDs,
		"wiki_page_quotations": quotedWikiPageIDs,
		"performance": map[string]interface{}{
			"processing_time_ms": 0, // 引用分析的时间可以单独计算，这里先设为0
		},
	}
}

// addContextToMessages 将检索到的上下文信息添加到消息中
func addContextToMessages(chatRequest *ChatRequest, context string) {
	if context == "" {
		return
	}

	// 创建包含上下文的系统消息，使用空字符串作为问题占位符
	contextMessage := relay_model.Message{
		Role:    "system",
		Content: rag.GetContextMessage(context, ""),
	}

	// 将上下文消息添加到消息列表的开头
	chatRequest.Messages = append([]relay_model.Message{contextMessage}, chatRequest.Messages...)
}
func extractQuotedSourceIDs(answer string) []string {
	// 支持三种格式：
	// 1. Source:A-数字 (知识库搜索)
	// 2. Source:B-数字 (网页搜索)
	// 3. Source:数字-数字 (单文件搜索，fileID-chunkIndex)
	re := `Source:(A|B|W|\d+)-(\d+)`
	matches := regexp.MustCompile(re).FindAllStringSubmatch(answer, -1)

	uniqueIDs := make(map[string]bool)
	var quotedIDs []string

	for _, match := range matches {
		if len(match) == 3 {
			sourceType := match[1] // A, B, 或者 fileID
			id := match[2]

			if sourceType == "A" || sourceType == "B" {
				// 知识库搜索或网页搜索格式
				refID := fmt.Sprintf("%s-%s", sourceType, id)
				if !uniqueIDs[refID] {
					uniqueIDs[refID] = true
					quotedIDs = append(quotedIDs, refID)
				}
			} else {
				// 单文件搜索格式: fileID-chunkIndex
				refID := fmt.Sprintf("%s-%s", sourceType, id)
				if !uniqueIDs[refID] {
					uniqueIDs[refID] = true
					quotedIDs = append(quotedIDs, refID)
				}
			}
		}
	}

	if len(quotedIDs) == 0 {
		re = `\[(Source:(\d+)-(\d+))\]`
		matches = regexp.MustCompile(re).FindAllStringSubmatch(answer, -1)

		for _, match := range matches {
			if len(match) >= 4 {
				refID := fmt.Sprintf("%s-%s", match[2], match[3]) // 保持文件ID_分片ID格式
				if !uniqueIDs[refID] {
					uniqueIDs[refID] = true
					quotedIDs = append(quotedIDs, refID)
				}
			}
		}
	}

	// 如果仍然没有匹配到，尝试匹配简单的数字引用格式，如 [1]、[2] 等
	if len(quotedIDs) == 0 {
		// Wiki/知识库答案也可能只保留数字-数字形式，如 [1-1]。
		re = `\[(\d+-\d+)\]`
		matches = regexp.MustCompile(re).FindAllStringSubmatch(answer, -1)

		for _, match := range matches {
			if len(match) >= 2 {
				id := match[1]
				if !uniqueIDs[id] {
					uniqueIDs[id] = true
					quotedIDs = append(quotedIDs, id)
				}
			}
		}
	}

	if len(quotedIDs) == 0 {
		// 匹配 [数字] 格式的引用
		re = `\[(\d+)\]`
		matches = regexp.MustCompile(re).FindAllStringSubmatch(answer, -1)

		for _, match := range matches {
			if len(match) >= 2 {
				id := match[1]
				if !uniqueIDs[id] {
					uniqueIDs[id] = true
					quotedIDs = append(quotedIDs, id)
				}
			}
		}
	}

	if len(quotedIDs) == 0 {
		re = `\[(Source:(A|B|W)-(\d+))\]`
		matches = regexp.MustCompile(re).FindAllStringSubmatch(answer, -1)

		for _, match := range matches {
			if len(match) >= 4 {
				sourceType := match[2] // A、B 或 W
				id := match[3]

				if sourceType == "A" || sourceType == "B" || sourceType == "W" {
					refID := fmt.Sprintf("%s-%s", sourceType, id)
					if !uniqueIDs[refID] {
						uniqueIDs[refID] = true
						quotedIDs = append(quotedIDs, refID)
					}
				}
			}
		}
	}

	return quotedIDs
}

// getQuotedChunkIDs 根据引用ID获取实际的 chunk_id 列表
func getQuotedChunkIDs(quotedSourceIDs []string, sources []rag.SourceReference) []string {
	quotedChunkIDs, _ := resolveQuotedSourceIDs(quotedSourceIDs, sources, false, false)
	return quotedChunkIDs
}

// getQuotedFileIDs 根据引用ID获取去重的 file_id 列表
func getQuotedFileIDs(quotedSourceIDs []string, sources []rag.SourceReference) []string {
	_, quotedFileIDs := resolveQuotedSourceIDs(quotedSourceIDs, sources, false, true)
	return quotedFileIDs
}

func getQuotedWikiPageIDs(quotedSourceIDs []string, sources []rag.SourceReference) []string {
	lookup := buildQuotedSourceLookup(sources)
	ids := make([]string, 0)
	seen := make(map[int64]struct{})
	if len(quotedSourceIDs) == 0 {
		for _, source := range sources {
			if source.SourceType == "wiki" && source.WikiPageID > 0 {
				if _, ok := seen[source.WikiPageID]; !ok {
					seen[source.WikiPageID] = struct{}{}
					ids = append(ids, hashInt64(source.WikiPageID))
				}
			}
		}
		return ids
	}
	for _, sourceID := range quotedSourceIDs {
		info, ok := lookupQuotedSourceInfo(lookup, sourceID)
		if ok && info.SourceType == "wiki" && info.WikiPageID > 0 {
			if _, exists := seen[info.WikiPageID]; !exists {
				seen[info.WikiPageID] = struct{}{}
				ids = append(ids, hashInt64(info.WikiPageID))
			}
		}
	}
	return ids
}

type quotedSourceLookup struct {
	ChunkID    int64
	FileID     int64
	WikiPageID int64
	SourceType string
}

func buildQuotedSourceLookup(sources []rag.SourceReference) map[string]quotedSourceLookup {
	lookup := make(map[string]quotedSourceLookup, len(sources))
	for index, source := range sources {
		info := quotedSourceLookup{
			ChunkID: source.ChunkID, FileID: source.FileID,
			WikiPageID: source.WikiPageID, SourceType: source.SourceType,
		}
		lookup[source.ReferenceID] = info
		lookup[strconv.Itoa(index+1)] = info
	}
	return lookup
}

func resolveQuotedSourceIDs(
	quotedSourceIDs []string,
	sources []rag.SourceReference,
	rawOutput bool,
	dedupeFileIDs bool,
) ([]string, []string) {
	if len(quotedSourceIDs) == 0 || len(sources) == 0 {
		return []string{}, []string{}
	}

	lookup := buildQuotedSourceLookup(sources)
	quotedChunkIDs := make([]string, 0, len(quotedSourceIDs))
	quotedFileIDs := make([]string, 0, len(quotedSourceIDs))
	uniqueFileIDs := make(map[int64]struct{}, len(quotedSourceIDs))

	for _, sourceID := range quotedSourceIDs {
		info, ok := lookupQuotedSourceInfo(lookup, sourceID)
		if !ok {
			continue
		}
		if info.SourceType == "wiki" {
			continue
		}

		if rawOutput {
			quotedChunkIDs = append(quotedChunkIDs, fmt.Sprintf("%d", info.ChunkID))
			if dedupeFileIDs {
				if _, exists := uniqueFileIDs[info.FileID]; exists {
					continue
				}
				uniqueFileIDs[info.FileID] = struct{}{}
			}
			quotedFileIDs = append(quotedFileIDs, fmt.Sprintf("%d", info.FileID))
			continue
		}

		quotedChunkIDs = append(quotedChunkIDs, hashInt64(info.ChunkID))
		if dedupeFileIDs {
			if _, exists := uniqueFileIDs[info.FileID]; exists {
				continue
			}
			uniqueFileIDs[info.FileID] = struct{}{}
		}
		quotedFileIDs = append(quotedFileIDs, hashInt64(info.FileID))
	}

	return quotedChunkIDs, quotedFileIDs
}

func lookupQuotedSourceInfo(
	lookup map[string]quotedSourceLookup,
	sourceID string,
) (quotedSourceLookup, bool) {
	formattedID := strings.TrimPrefix(sourceID, "Source:")
	if info, exists := lookup[formattedID]; exists {
		return info, true
	}

	underscoreID := strings.ReplaceAll(formattedID, "_", "-")
	if info, exists := lookup[underscoreID]; exists {
		return info, true
	}

	dashID := strings.ReplaceAll(formattedID, "-", "_")
	if info, exists := lookup[dashID]; exists {
		return info, true
	}

	return quotedSourceLookup{}, false
}

// createDocumentSearchData 创建文档搜索数据（仅包含chunks，不包含quotations）
func createDocumentSearchData(eid int64, searchResponse *rag.SearchResponse, sources []rag.SourceReference) map[string]interface{} {
	if searchResponse == nil {
		return map[string]interface{}{
			"document_search": map[string]interface{}{
				"chunks": []interface{}{},
			},
		}
	}

	// 创建一个映射，从 ChunkID 到 SourceKey
	chunkIDToSourceKey := make(map[int64]string)
	for _, source := range sources {
		chunkIDToSourceKey[source.ChunkID] = source.SourceKey
	}

	// 预先批量获取知识库信息
	extendedInfos := getExtendedChunkInfo(eid, searchResponse.Results)

	// 构建分片信息，与流输出的文档列表一样
	var chunks []interface{}
	for _, result := range searchResponse.Results {
		extendedInfo := extendedInfos[result.ChunkID]

		// 只提取前30个字的内容，避免汉字截断
		contentPreview := ""
		runes := []rune(result.Content)
		if len(runes) > MAX_DESC_WORD {
			contentPreview = string(runes[:MAX_DESC_WORD])
		} else {
			contentPreview = result.Content
		}

		if extendedInfo.KnowledgeBaseName != "" {
			result.LibraryName = extendedInfo.KnowledgeBaseName
		}
		if extendedInfo.KnowledgeBaseLogo != "" {
			result.LibraryIcon = extendedInfo.KnowledgeBaseLogo
		}
		chunk := map[string]interface{}{
			"chunk_id":     hashInt64(result.ChunkID),
			"chunk_type":   result.ChunkType,
			"content":      contentPreview,
			"file_id":      hashInt64(result.FileID),
			"file_name":    result.FileName,
			"library_id":   hashInt64(result.LibraryID),
			"library_name": result.LibraryName,
			"library_icon": result.LibraryIcon,
			"space_id":     hashInt64(extendedInfo.SpaceID),
			"space_name":   extendedInfo.SpaceName,
			"score":        result.Score,
			"file_path":    result.FilePath,
			"source_key":   chunkIDToSourceKey[result.ChunkID], // 添加source_key字段
		}
		chunks = append(chunks, chunk)
	}

	return map[string]interface{}{
		"document_search": map[string]interface{}{
			"chunks": chunks,
		},
	}
}

// HandleOutOfRangeReply 处理超纲回复
func HandleOutOfRangeReply(agent *model.Agent) (bool, string) {
	// 检查是否启用了超纲回复且没有搜索到内容
	var outOfRangeReplyConfig *model.OutOfRangeReplyConfig
	replyConfig, err := agent.GetOutOfRangeReplyConfig()
	if err == nil && replyConfig != nil {
		outOfRangeReplyConfig = replyConfig
	}

	enable := outOfRangeReplyConfig != nil && outOfRangeReplyConfig.Enable && outOfRangeReplyConfig.Reply != ""

	return enable, outOfRangeReplyConfig.Reply
}

func CreateRetrievalContext(sources []rag.SourceReference) string {
	var contextParts []string
	for _, source := range sources {
		contextParts = append(contextParts, fmt.Sprintf("[Source:%s] \n <begin>  %s <end>", source.ReferenceID, source.Content))
	}
	return strings.Join(contextParts, "\n")
}
