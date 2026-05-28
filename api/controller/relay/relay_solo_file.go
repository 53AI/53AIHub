package relay

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/common/utils/helper"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/rag"
	"github.com/gin-gonic/gin"
)

// processSoloFileChat 处理单文件聊天模式
func processSoloFileChat(c *gin.Context, chatRequest *ChatRequest, agent *model.Agent, messageStatus *MessageStatsInfo) error {
	_, _, requestID := prepareDetachedExecutionContext(c, helper.GetRequestID(c.Request.Context()))
	runCtx, runCancel := startAgentRunCancelWatcher(c.Request.Context(), agent.Eid, requestID, time.Second)
	defer runCancel()
	if c != nil && c.Request != nil {
		c.Request = c.Request.WithContext(runCtx)
	}
	ctx := c.Request.Context()

	fileIdStr := chatRequest.FileIDs[0]

	// 解析文件ID（支持hash解密）
	fileID, err := parseAndResolveFileID(ctx, agent.Eid, fileIdStr)
	if err != nil {
		logger.Errorf(ctx, "解析文件ID失败: %v", err)
		sendSoloFileRejectReply(c, chatRequest, agent, "文件ID格式无效", messageStatus)
		return err
	}

	// 保存解析到的文件ID到 messageStatus
	messageStatus.SaveFileID = fileID
	logger.Infof(ctx, "单文件模式 - 解析到文件ID: %d", fileID)

	// 步骤1：正在读取文件
	if chatRequest.EnableProcessSteps && chatRequest.Stream {
		step1 := ProcessStep{
			StepCode:  KB_SEARCH,
			Name:      "正在搜索文件",
			Status:    "processing",
			Message:   "正在读取文件内容...",
			Timestamp: time.Now().Unix(),
		}
		if err := sendProcessStep(c, messageStatus.RequestId, step1); err != nil {
			logger.Warnf(ctx, "发送处理步骤1失败: %s", err.Error())
		}
	}

	// 获取文件分块
	chunks, err := model.GetDocumentChunksByFileID(agent.Eid, fileID, 0, 0)
	if err != nil {
		logger.Errorf(ctx, "获取文件分块失败: %v", err)

		// 发送错误步骤
		if chatRequest.EnableProcessSteps && chatRequest.Stream {
			step1Error := ProcessStep{
				StepCode:  KB_SEARCH,
				Name:      "正在搜索文件",
				Status:    "error",
				Message:   fmt.Sprintf("获取文件分块失败: %v", err),
				Timestamp: time.Now().Unix(),
			}
			sendProcessStep(c, messageStatus.RequestId, step1Error)
		}

		// 直接拒答
		sendSoloFileRejectReply(c, chatRequest, agent, "无法读取指定的文件内容，请检查文件是否存在", messageStatus)
		return err
	}

	// 获取文件信息以获取文件名
	file, err := model.GetFileByID(agent.Eid, fileID)
	if err != nil {
		logger.Errorf(ctx, "获取文件信息失败: %v", err)
		// 继续处理，只是没有文件名
	}

	// 获取文件名
	file.LoadUploadFile()
	fileName := ""
	if file.UploadFile != nil {
		fileName = file.UploadFile.FileName
	} else {
		fileName = fmt.Sprintf("文件_%d", fileID)
	}

	// 查询知识库和空间信息（如果有）
	var library model.Library
	var space model.Space
	libraryIDHash := ""
	libraryName := ""
	libraryIcon := ""
	spaceIDHash := ""
	spaceName := ""

	// 如果文件属于某个知识库，查询相关信息
	if file.LibraryID > 0 {
		if err := model.DB.Where("eid = ? AND id = ?", agent.Eid, file.LibraryID).First(&library).Error; err == nil {
			libraryIDHash = hashInt64(library.ID)
			libraryName = library.Name
			libraryIcon = library.Icon

			// 查询空间信息
			if library.SpaceID > 0 {
				if err := model.DB.Where("eid = ? AND id = ?", agent.Eid, library.SpaceID).First(&space).Error; err == nil {
					spaceIDHash = hashInt64(space.ID)
					spaceName = space.Name
				}
			}
		}
	}

	// 获取文件路径
	filePath := ""
	if file.UploadFile != nil {
		filePath = "/" + file.UploadFile.FileName
	}

	// 步骤2：正在搜索文档
	if chatRequest.EnableProcessSteps && chatRequest.Stream {
		step2 := ProcessStep{
			StepCode:  DOC_SEARCH,
			Name:      "正在搜索文档",
			Status:    "processing",
			Message:   "正在搜索文档...",
			Timestamp: time.Now().Unix(),
		}
		if err := sendProcessStep(c, messageStatus.RequestId, step2); err != nil {
			logger.Warnf(ctx, "发送处理步骤2失败: %s", err.Error())
		}
	}

	// 拼接分块内容并添加标记，同时控制大小
	var contextBuilder strings.Builder
	var currentLength int
	var fullContentLength int
	var allChunks []interface{}
	var usedChunkIDs []int64

	// 先计算完整内容长度并生成分块列表
	for i, chunk := range chunks {
		chunkRefID := fmt.Sprintf("%d-%d", fileID, i+1)
		chunkWithSource := fmt.Sprintf("[Source:%s]%s", chunkRefID, chunk.Content)
		fullContentLength += len(chunkWithSource)

		// 生成分块预览信息
		contentPreview := chunk.Content
		if len(contentPreview) > 100 {
			contentPreview = contentPreview[:100] + "..."
		}

		// 添加到所有分块列表 - 使用与普通模式相同的格式
		allChunks = append(allChunks, map[string]interface{}{
			"chunk_id":     hashInt64(chunk.ID),
			"chunk_type":   chunk.ChunkType,
			"content":      contentPreview,
			"file_id":      hashInt64(chunk.FileID),
			"file_name":    fileName,
			"file_path":    filePath,
			"library_id":   libraryIDHash,
			"library_name": libraryName,
			"library_icon": libraryIcon,
			"space_id":     spaceIDHash,
			"space_name":   spaceName,
			"score":        1.0, // 单文件模式所有分片分数都是1.0
			"source_key":   fmt.Sprintf("[Source:%d-%d]", 1, i+1),
		})
	}

	// 拼接分块内容，确保不超过最大长度
	for i, chunk := range chunks {
		chunkRefID := fmt.Sprintf("%d-%d", 1, i+1) // 使用 fileID-index 格式
		chunkWithSource := fmt.Sprintf("[Source:%s]%s", chunkRefID, chunk.Content)
		chunkLength := len(chunkWithSource)

		// 检查是否超过最大长度
		if currentLength+chunkLength > MAX_SOLO_FILE_CONTENT_SIZE {
			// 已达到最大长度，停止拼接
			break
		}

		contextBuilder.WriteString(chunkWithSource)
		currentLength += chunkLength

		// 记录使用的分片ID
		usedChunkIDs = append(usedChunkIDs, chunk.ID)
	}

	processedContent := contextBuilder.String()

	// 步骤1完成：文件读取完成
	// if chatRequest.EnableProcessSteps && chatRequest.Stream {
	// 	step1Completed := ProcessStep{
	// 		StepCode: KB_SEARCH,
	// 		Name:     "正在搜索文件",
	// 		Status:   "completed",
	// 		Message:  "文件内容读取完成",
	// 		Data: map[string]interface{}{
	// 			"original_length":  fullContentLength,
	// 			"processed_length": len(processedContent),
	// 			"truncated":        fullContentLength > len(processedContent),
	// 		},
	// 		Timestamp: time.Now().Unix(),
	// 	}
	// 	if err := sendProcessStep(c, requestId, step1Completed); err != nil {
	// 		logger.Warnf(ctx, "发送处理步骤1完成状态失败: %s", err.Error())
	// 	}
	// }

	// 步骤2完成：显示搜索到的分片统计
	if chatRequest.EnableProcessSteps && chatRequest.Stream {
		// 创建与普通模式相同的搜索结果数据格式
		var chunksWithSource []interface{}
		for i, chunk := range chunks {
			contentPreview := chunk.Content
			if len(contentPreview) > 30 {
				contentPreview = contentPreview[:30] + "..."
			}

			chunkWithSource := map[string]interface{}{
				"chunk_id":     hashInt64(chunk.ID),
				"chunk_type":   chunk.ChunkType,
				"file_id":      hashInt64(chunk.FileID),
				"file_name":    fileName,
				"file_path":    filePath, // 单文件模式没有文件路径
				"content":      contentPreview,
				"source":       fmt.Sprintf("[Source:1-%d]", i+1),
				"score":        1.0,
				"library_id":   libraryIDHash, // 单文件模式不属于任何知识库
				"library_name": libraryName,
				"library_logo": libraryIcon,
				"space_id":     spaceIDHash,
				"space_name":   spaceName,
			}
			chunksWithSource = append(chunksWithSource, chunkWithSource)
		}

		step2Completed := ProcessStep{
			StepCode: DOC_SEARCH,
			Name:     "正在搜索文档",
			Status:   "completed",
			Message:  fmt.Sprintf("搜索到 1 个文件，%d 篇资料作为参考", len(chunks)),
			Data: map[string]interface{}{
				"document_search": map[string]interface{}{
					"chunks": chunksWithSource,
				}},
			Timestamp: time.Now().Unix(),
		}
		if err := sendProcessStep(c, messageStatus.RequestId, step2Completed); err != nil {
			logger.Warnf(ctx, "发送处理步骤2完成状态失败: %s", err.Error())
		}
	}

	// 步骤3：开始生成回答
	if chatRequest.EnableProcessSteps && chatRequest.Stream {
		step3 := ProcessStep{
			StepCode:  ANSWER_GEN,
			Name:      "开始生成回答",
			Status:    "processing",
			Message:   "正在基于文件内容生成回答...",
			Timestamp: time.Now().Unix(),
		}
		if err := sendProcessStep(c, messageStatus.RequestId, step3); err != nil {
			logger.Warnf(ctx, "发送处理步骤3失败: %s", err.Error())
		}

		// 发送步骤结束标记
		if err := sendProcessStepEnd(c, messageStatus.RequestId); err != nil {
			logger.Warnf(ctx, "发送处理步骤结束标记失败: %s", err.Error())
		}
	}

	// 设置知识类型
	messageStatus.KnowledgeType = model.KnowledgeTypeSingleFile
	messageStatus.KnowledgeScope = fmt.Sprintf("file:%d", fileID)

	// 创建 sources 引用参考数据，以便后续进行引用分析
	var sources []rag.SourceReference
	for i, chunk := range chunks {
		// 只为实际使用的分块创建引用
		isUsed := false
		for _, usedID := range usedChunkIDs {
			if chunk.ID == usedID {
				isUsed = true
				break
			}
		}
		if isUsed {
			chunkRefID := fmt.Sprintf("%d-%d", 1, i+1) // 永远为 1-索引
			source := rag.SourceReference{
				ReferenceID:       chunkRefID,
				ChunkID:           chunk.ID,
				FileID:            chunk.FileID,
				FileName:          fileName,
				ChunkType:         chunk.ChunkType,
				Content:           chunk.Content,
				Score:             1.0,
				KnowledgeBaseID:   file.LibraryID,
				KnowledgeBaseName: libraryName,
				KnowledgeBaseLogo: libraryIcon,
				LibraryID:         hashInt64(file.LibraryID),
				LibraryName:       libraryName,
				LibraryIcon:       libraryIcon,
				FileCreatedAt:     file.CreatedTime,
				SourceKey:         fmt.Sprintf("[Source:%s]", chunkRefID),
				SpaceID:           spaceIDHash,
				SpaceName:         spaceName,
				URL:               file.Path,
			}
			sources = append(sources, source)
		}
	}

	// 设置rag_stats_data到上下文
	ragStatsData := map[string]interface{}{
		"fileID":                 fileID,
		"fileName":               fileName,
		"allChunks":              allChunks,
		"usedChunkIDs":           usedChunkIDs,
		"processedContentLength": len(processedContent),
		"fullContentLength":      fullContentLength,
		"sources":                sources, // 添加 sources 以便引用分析
	}
	c.Set("rag_stats_data", ragStatsData)
	logger.Debugf(ctx, "单文件模式RAG原始数据已存储，等待回答完成后生成最终统计")

	// 将文件内容作为上下文添加到消息中
	addContextToMessages(chatRequest, processedContent)

	logger.Infof(ctx, "单文件模式处理完成 - FileID: %d, 原始长度: %d, 处理后长度: %d, 总分片数: %d, 使用分片数: %d",
		fileID, fullContentLength, len(processedContent), len(chunks), len(usedChunkIDs))

	return nil
}

// parseAndResolveFileID 解析并解析文件ID（支持hash解密）
func parseAndResolveFileID(ctx context.Context, eid int64, fileIDStr string) (int64, error) {
	logger.Infof(ctx, "开始解析文件ID: %s", fileIDStr)

	// 尝试hash解密
	fileID, err := hashids.TryParseID(fileIDStr)
	if err != nil {
		logger.Errorf(ctx, "hash解密失败: %v, 原始字符串: %s", err.Error(), fileIDStr)
		return 0, fmt.Errorf("无效的文件ID格式: %s", fileIDStr)
	}

	logger.Infof(ctx, "hash解密成功，FileID: %d", fileID)

	// 验证文件是否存在
	var file model.File
	if err := model.DB.Where("eid = ? AND id = ?", eid, fileID).First(&file).Error; err != nil {
		logger.Errorf(ctx, "文件不存在验证失败: %v, FileID: %d, EID: %d", err.Error(), fileID, eid)
		return 0, fmt.Errorf("文件不存在: %d", fileID)
	}

	logger.Infof(ctx, "文件存在性验证通过，返回FileID: %d", fileID)
	return fileID, nil
}

// parseFileIDString 尝试将字符串解析为文件ID
func parseFileIDString(fileIDStr string) (int64, error) {
	// 去除前后空格
	fileIDStr = strings.TrimSpace(fileIDStr)

	var fileID int64
	_, err := fmt.Sscanf(fileIDStr, "%d", &fileID)
	if err != nil {
		// 返回错误让调用者知道需要尝试其他方法
		return 0, fmt.Errorf("需要尝试其他解析方法")
	}

	return fileID, nil
}

// sendSoloFileRejectReply 发送单文件模式拒答回复
func sendSoloFileRejectReply(c *gin.Context, chatRequest *ChatRequest, agent *model.Agent, rejectMessage string, messageStatus *MessageStatsInfo) {
	ctx := c.Request.Context()
	requestId := ""
	if messageStatus != nil {
		requestId = messageStatus.RequestId
	}
	requestId = ensureRequestID(c, requestId)
	if messageStatus != nil {
		messageStatus.RequestId = requestId
	}

	// 设置响应状态
	messageStatus.ResponseStatus = model.ResponseStatusReject

	// 先落库拿到 message_id，确保流式首帧符合统一协议
	messageID, err := saveSoloFileRejectMessage(c, chatRequest, agent, requestId, rejectMessage, messageStatus)
	if err != nil {
		logger.Errorf(ctx, "保存单文件拒答消息失败: %v", err)
	}
	if messageID > 0 {
		c.Set("agent_master_message_id", messageID)
		bindMessageIDAndFlushProcessSteps(ctx, agent.Eid, messageStatus, messageID)
	}

	if chatRequest.Stream {
		// 流式响应
		sendStreamRejectReply(c, requestId, agent.Model, rejectMessage, messageID)
	} else {
		// 非流式响应
		sendNonStreamRejectReply(c, rejectMessage, requestId, agent.Model)
	}
}

// sendStreamRejectReply 发送流式拒答回复
func sendStreamRejectReply(c *gin.Context, requestId, model, content string, messageID int64) {
	// 设置流式响应头
	if c.Writer.Header().Get("Content-Type") == "" {
		h := c.Writer.Header()
		h.Set("Content-Type", "text/event-stream; charset=utf-8")
		h.Set("Cache-Control", "no-cache")
		h.Set("Connection", "keep-alive")
		h.Set("X-Accel-Buffering", "no")
	}

	if err := sendMessageIDFirstFrame(c, requestId, model, messageID); err != nil {
		logger.Warnf(c.Request.Context(), "sendMessageIDFirstFrame failed in sendStreamRejectReply: %v", err)
	}

	// 发送内容
	delta := map[string]interface{}{
		"role":    "assistant",
		"content": content,
	}

	contentPayload := map[string]interface{}{
		"id":      requestId,
		"object":  "chat.completion.chunk",
		"created": time.Now().Unix(),
		"model":   model,
		"choices": []map[string]interface{}{
			{
				"index": 0,
				"delta": delta,
			},
		},
	}

	if b, err := json.Marshal(contentPayload); err == nil {
		chunk := append([]byte("data: "), b...)
		chunk = append(chunk, []byte("\n\n")...)
		c.Writer.Write(chunk)
		if flusher, ok := c.Writer.(http.Flusher); ok {
			flusher.Flush()
		}
	}

	// 发送结束标记
	endChunk := "data: [DONE]\n\n"
	c.Writer.Write([]byte(endChunk))
	if flusher, ok := c.Writer.(http.Flusher); ok {
		flusher.Flush()
	}
}

// sendNonStreamRejectReply 发送非流式拒答回复
func sendNonStreamRejectReply(c *gin.Context, content, requestId, model string) {
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

// saveSoloFileRejectMessage 保存单文件拒答消息记录
func saveSoloFileRejectMessage(c *gin.Context, chatRequest *ChatRequest, agent *model.Agent, requestId, rejectMessage string, messageStatus *MessageStatsInfo) (int64, error) {
	ctx := c.Request.Context()
	userID := config.GetUserId(c)

	// 获取会话ID
	var conversationId int64
	if conversation, err := GetSessionConversation(c); err == nil {
		conversationId = conversation.ConversationID
	}

	// 序列化请求消息
	messageJSON, err := json.Marshal(chatRequest.Messages)
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
		Answer:            rejectMessage,
		ReasoningContent:  "",
		ModelName:         agent.Model,
		Quota:             0,
		PromptTokens:      0,
		CompletionTokens:  0,
		TotalTokens:       0,
		ChannelId:         0,
		RequestId:         requestId,
		ElapsedTime:       0,
		IsStream:          chatRequest.Stream,
		QuotaContent:      "单文件拒答，无消耗",
		AgentCustomConfig: agent.CustomConfig,
		RAGStats:          "",
		ResponseStatus:    messageStatus.ResponseStatus,
		ThinkingMode:      messageStatus.ThinkingMode,
		KnowledgeScope:    messageStatus.KnowledgeScope,
		KnowledgeType:     messageStatus.KnowledgeType,
		RequestSource:     messageStatus.RequestSource,
	}

	applyVisitorIdentityToMessage(c, message)
	if err := model.CreateMessage(message); err != nil {
		return 0, err
	}
	logger.Infof(ctx, "单文件拒答消息已保存 - MessageID: %d", message.ID)
	return message.ID, nil
}

// collectSoloFileRAGStats 收集单文件模式的RAG统计数据
func collectSoloFileRAGStats(eid int64, fileID int64, fileName string, sources []rag.SourceReference, answer string) map[string]interface{} {
	stats := map[string]interface{}{
		"document_search": map[string]interface{}{
			"chunks": []interface{}{}, // 搜索到的所有分片列表
		},
		"document_quotations": []string{}, // 实际被引用的分片ID列表
		"file_quotations":     []string{}, // 实际被引用的去重file_id列表
		"performance": map[string]interface{}{
			"processing_time_ms": 0, // 单文件模式没有搜索时间
		},
		"type": "rag_search",
	}

	// 构建分片信息，与流输出的文档列表一样
	var chunks []interface{}
	for _, source := range sources {
		contentPreview := ""
		runes := []rune(source.Content)
		if len(runes) > MAX_DESC_WORD {
			contentPreview = string(runes[:MAX_DESC_WORD])
		} else {
			contentPreview = source.Content
		}

		chunk := map[string]interface{}{
			"chunk_id":     hashInt64(source.ChunkID),
			"chunk_type":   source.ChunkType,
			"content":      contentPreview,
			"file_id":      hashInt64(source.FileID),
			"file_name":    fileName,
			"library_id":   hashInt64(source.KnowledgeBaseID), // 使用source中的知识库ID
			"library_name": source.KnowledgeBaseName,          // 使用source中的知识库名称
			"library_icon": source.KnowledgeBaseLogo,          // 使用source中的知识库图标
			"space_id":     source.SpaceID,                    // 使用source中的空间ID
			"space_name":   source.SpaceName,                  // 使用source中的空间名称
			"score":        source.Score,
			"file_path":    source.URL,
			"source_key":   source.SourceKey,
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
	} else {
		// 如果还没有回答内容，暂时使用所有搜索到的分片和文件
		var chunkQuotations []string
		var fileQuotationsMap = make(map[int64]bool) // 使用map去重

		for _, source := range sources {
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
	}

	return stats
}
