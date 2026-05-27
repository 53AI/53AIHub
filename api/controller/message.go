package controller

import (
	"encoding/json"
	"fmt"
	"net/http"
	"path"
	"sort"
	"strconv"
	"strings"
	"time"

	"errors"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/storage"
	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/common/utils/sandboxdl"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/middleware"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/elasticsearch"
	"github.com/gin-gonic/gin"
)

type MessagesResponse struct {
	Count    int64              `json:"count"`
	Messages []*EnhancedMessage `json:"messages"`
}

// parseRAGStats 解析RAG统计数据JSON字符串
func parseRAGStats(ragStatsStr string) (map[string]interface{}, error) {
	var ragStats map[string]interface{}
	if err := json.Unmarshal([]byte(ragStatsStr), &ragStats); err != nil {
		return nil, err
	}
	return ragStats, nil
}

// EnhancedMessage 增强的消息结构，包含解析后的内容
// @Description EnhancedMessage 扩展了基础消息结构，提供解析后的内容和RAG统计信息
type EnhancedMessage struct {
	*model.Message
	MessageType    model.MessageType           `json:"message_type" example:"chat"` // 消息类型：chat(聊天), workflow(工作流)
	ParsedMessage  interface{}                 `json:"parsed_message"`              // 解析后的 message 内容
	ParsedAnswer   interface{}                 `json:"parsed_answer"`               // 解析后的 answer 内容
	RAGStats       map[string]interface{}      `json:"rag_stats"`                   // RAG检索统计数据，包含知识库搜索、文档检索(含完整分片信息)、性能等统计信息
	FileName       string                      `json:"file_name,omitempty"`         // 关联文件名
	ProcessRecords []*model.MessageProcessStep `json:"process_records"`             // 过程记录（技能运行步骤）
}

type MessageListRequest struct {
	Keyword        string `json:"keyword" form:"keyword" example:"gpt"`
	FileKeyword    string `json:"file_keyword" form:"file_keyword" example:"report"` // 文件名搜索关键词
	FileID         int64  `json:"file_id" form:"file_id"`                            // 文件 ID 筛选
	Offset         int    `json:"offset" form:"offset" example:"0"`
	Limit          int    `json:"limit" form:"limit" example:"10"`
	Direction      string `json:"direction" form:"direction" example:"desc"`          // 获取方向: desc=从新到旧, asc=从旧到新
	ThinkingMode   *int   `json:"thinking_mode" form:"thinking_mode" example:"1"`     // 思考方式: 1=快速回答, 2=深度思考
	ResponseStatus *int   `json:"response_status" form:"response_status" example:"1"` // 回答状态: 1=正常回答, 2=拒答/超纲回复
	KnowledgeType  *int   `json:"knowledge_type" form:"knowledge_type" example:"1"`   // 知识类型: 1=知识库搜索, 2=Web搜索, 3=指定知识库
	StartDate      *int64 `json:"start_date" form:"start_date" example:"1640995200"`  // 开始日期时间戳
	EndDate        *int64 `json:"end_date" form:"end_date" example:"1641081600"`      // 结束日期时间戳
	AgentID        *int64 `json:"agent_id" form:"agent_id" example:"1"`               // Agent ID 筛选
}

type MessageListAllRequest struct {
	MessageListRequest
}

// convertToEnhancedMessages 将普通消息转换为增强消息
func convertToEnhancedMessages(messages []*model.Message, fileMap map[int64]string) []*EnhancedMessage {
	enhancedMessages := make([]*EnhancedMessage, len(messages))

	for i, msg := range messages {
		enhanced := &EnhancedMessage{
			Message:        msg,
			MessageType:    msg.GetMessageType(),
			ProcessRecords: []*model.MessageProcessStep{},
		}

		// 填充文件名
		if msg.FileID > 0 && fileMap != nil {
			enhanced.FileName = fileMap[msg.FileID]
		}

		// 根据消息类型解析内容
		switch enhanced.MessageType {
		case model.MessageTypeChat:
			// 解析聊天消息
			if parsedMsg, err := msg.ParseChatMessage(); err == nil {
				enhanced.ParsedMessage = parsedMsg
			} else {
				enhanced.ParsedMessage = msg.Message // 解析失败时返回原始内容
			}
			enhanced.ParsedAnswer = msg.Answer // 聊天消息的 answer 就是文本

		case model.MessageTypeWorkflow:
			// 解析工作流消息
			if parsedParams, err := msg.ParseWorkflowParameters(); err == nil {
				enhanced.ParsedMessage = parsedParams
			} else {
				enhanced.ParsedMessage = msg.Message // 解析失败时返回原始内容
			}

			if parsedOutput, err := msg.ParseWorkflowOutput(); err == nil {
				enhanced.ParsedAnswer = parsedOutput
			} else {
				enhanced.ParsedAnswer = msg.Answer // 解析失败时返回原始内容
			}
		}

		// 解析RAG统计数据
		if msg.RAGStats != "" {
			if ragStatsData, err := parseRAGStats(msg.RAGStats); err == nil {
				enhanced.RAGStats = ragStatsData
			}
			// 解析失败时RAGStats保持为nil，不影响其他字段
		}

		enhancedMessages[i] = enhanced
	}

	return enhancedMessages
}

func attachProcessRecords(enhancedMessages []*EnhancedMessage, processRecordMap map[int64][]*model.MessageProcessStep) {
	if len(enhancedMessages) == 0 || len(processRecordMap) == 0 {
		return
	}
	for _, enhanced := range enhancedMessages {
		if enhanced == nil || enhanced.Message == nil {
			continue
		}
		if records, exists := processRecordMap[enhanced.Message.ID]; exists {
			enhanced.ProcessRecords = records
		}
	}
}

func buildEnhancedMessages(messages []*model.Message, fileMap map[int64]string, processRecordMap map[int64][]*model.MessageProcessStep) []*EnhancedMessage {
	enhancedMessages := convertToEnhancedMessages(messages, fileMap)
	attachProcessRecords(enhancedMessages, processRecordMap)
	return enhancedMessages
}

func convertToolCallToProcessRecord(toolCall *model.MessageToolCall) *model.MessageProcessStep {
	if toolCall == nil {
		return nil
	}

	status := toolCall.Status
	if status == "" {
		status = model.ToolCallStatusPending
	}

	stepTimestamp := toolCall.CreatedTime / 1000
	if stepTimestamp <= 0 {
		stepTimestamp = toolCall.UpdatedTime / 1000
	}
	if stepTimestamp <= 0 {
		stepTimestamp = time.Now().Unix()
	}

	stepMessage := fmt.Sprintf("工具 %s 执行状态: %s", toolCall.FunctionName, status)
	if toolCall.FunctionName == "" {
		stepMessage = fmt.Sprintf("工具调用状态: %s", status)
	}

	record := &model.MessageProcessStep{
		Eid:           toolCall.Eid,
		MessageID:     toolCall.MessageID,
		StepCode:      "tool_call",
		Name:          "工具调用",
		Status:        status,
		Message:       stepMessage,
		StepTimestamp: stepTimestamp,
		BaseModel: model.BaseModel{
			CreatedTime: toolCall.CreatedTime,
			UpdatedTime: toolCall.UpdatedTime,
		},
	}

	toolData := map[string]interface{}{
		"message_tool_call_id": toolCall.ID,
		"tool_name":            toolCall.ToolName,
		"tool_call_id":         toolCall.ToolCallID,
		"function_name":        toolCall.FunctionName,
		"arguments":            toolCall.Arguments,
		"status":               toolCall.Status,
		"result":               toolCall.Result,
		"error_msg":            toolCall.ErrorMsg,
		"duration_ms":          toolCall.DurationMs,
		"skill_name":           toolCall.SkillName,
		"turn_number":          toolCall.TurnNumber,
		"channel_id":           toolCall.ChannelID,
		"model_name":           toolCall.ModelName,
	}
	if err := record.SetDataMap(toolData); err != nil {
		record.Data = ""
	}
	return record
}

func mergeProcessRecordsWithToolCalls(processRecordMap map[int64][]*model.MessageProcessStep, toolCallMap map[int64][]*model.MessageToolCall) map[int64][]*model.MessageProcessStep {
	merged := make(map[int64][]*model.MessageProcessStep, len(processRecordMap)+len(toolCallMap))
	for messageID, records := range processRecordMap {
		if len(records) == 0 {
			continue
		}
		merged[messageID] = append(merged[messageID], records...)
	}

	for messageID, toolCalls := range toolCallMap {
		for _, toolCall := range toolCalls {
			record := convertToolCallToProcessRecord(toolCall)
			if record == nil {
				continue
			}
			merged[messageID] = append(merged[messageID], record)
		}
	}

	for messageID := range merged {
		records := merged[messageID]
		sort.SliceStable(records, func(i, j int) bool {
			left := records[i]
			right := records[j]
			if left == nil {
				return false
			}
			if right == nil {
				return true
			}
			if left.StepTimestamp != right.StepTimestamp {
				return left.StepTimestamp < right.StepTimestamp
			}
			if left.CreatedTime != right.CreatedTime {
				return left.CreatedTime < right.CreatedTime
			}
			return left.ID < right.ID
		})
		merged[messageID] = records
	}

	return merged
}

func parseConversationIDParam(rawID string) (int64, error) {
	return hashids.TryParseID(rawID)
}

// @Summary Get messages by agent
// @Description Get messages between user and specific agent with pagination and keyword search. 返回的消息包含RAG检索统计数据（如果存在）
// @Tags Message
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param agent_id path int true "Agent ID"
// @Param keyword query string false "Search keyword"
// @Param file_id query int false "File ID filter"
// @Param offset query int false "Pagination offset" default(0)
// @Param limit query int false "Pagination limit" default(10)
// @Success 200 {object} model.CommonResponse{data=MessagesResponse} "Success"
// @Router /api/agents/{agent_id}/messages [get]
func GetMessagesByUserAndAgent(c *gin.Context) {
	agent_id, err := strconv.ParseInt(c.Param("agent_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	var messageListRequest MessageListRequest
	if err := c.ShouldBindQuery(&messageListRequest); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	userId := config.GetUserId(c)
	eid := config.GetEID(c)
	count, messages, err := model.GetMessagesByUserAndAgent(
		eid, userId, agent_id,
		messageListRequest.Keyword, messageListRequest.FileID, messageListRequest.Limit, messageListRequest.Offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	// 批量获取文件名，避免 N+1 查询
	fileMap := make(map[int64]string)
	var targetFileIDs []int64
	for _, msg := range messages {
		if msg.FileID > 0 {
			targetFileIDs = append(targetFileIDs, msg.FileID)
		}
	}
	if len(targetFileIDs) > 0 {
		var files []model.File
		if err := model.DB.Select("id, path").Where("id IN ?", targetFileIDs).Find(&files).Error; err == nil {
			for _, f := range files {
				fileMap[f.ID] = model.ExtractSimpleFileName(f.Path)
			}
		}
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(&MessagesResponse{
		Count:    count,
		Messages: convertToEnhancedMessages(messages, fileMap),
	}))
}

// @Summary Get messages by user and agent
// @Description Get messages between user and specific agent with pagination and keyword search. 返回的消息包含RAG检索统计数据（如果存在）
// @Tags Message
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param agent_id path int true "Agent ID"
// @Param user_id path int true "User ID"
// @Param keyword query string false "Search keyword"
// @Param file_id query int false "File ID filter"
// @Param offset query int false "Pagination offset" default(0)
// @Param limit query int false "Pagination limit" default(10)
// @Success 200 {object} model.CommonResponse{data=MessagesResponse} "Success"
// @Router /api/users/{user_id}/agents/{agent_id}/messages [get]
func GetUserMessages(c *gin.Context) {
	agent_id, err := strconv.ParseInt(c.Param("agent_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	user_id, err := strconv.ParseInt(c.Param("user_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}
	user, err := model.GetUserByID(user_id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	if user.Eid != config.GetEID(c) {
		c.JSON(http.StatusForbidden, model.NotFound.ToResponse(nil))
		return
	}

	var messageListRequest MessageListRequest
	if err := c.ShouldBindQuery(&messageListRequest); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	eid := config.GetEID(c)
	count, messages, err := model.GetMessagesByUserAndAgent(
		eid, user_id, agent_id,
		messageListRequest.Keyword, messageListRequest.FileID, messageListRequest.Limit, messageListRequest.Offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	// 批量获取文件名，避免 N+1 查询
	fileMap := make(map[int64]string)
	var targetFileIDs []int64
	for _, msg := range messages {
		if msg.FileID > 0 {
			targetFileIDs = append(targetFileIDs, msg.FileID)
		}
	}
	if len(targetFileIDs) > 0 {
		var files []model.File
		if err := model.DB.Select("id, path").Where("id IN ?", targetFileIDs).Find(&files).Error; err == nil {
			for _, f := range files {
				fileMap[f.ID] = model.ExtractSimpleFileName(f.Path)
			}
		}
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(&MessagesResponse{
		Count:    count,
		Messages: convertToEnhancedMessages(messages, fileMap),
	}))
}

// @Summary Get messages by conversation ID
// @Description Get message list by conversation ID with pagination and keyword search. 返回的消息包含RAG检索统计数据（如果存在）
// @Tags Message
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param conversation_id path int true "Conversation ID"
// @Param keyword query string false "Search keyword"
// @Param offset query int false "Pagination offset" default(0)
// @Param limit query int false "Pagination limit" default(10)
// @Param direction query string false "Direction (desc=newest first, asc=oldest first)" default(desc)
// @Success 200 {object} model.CommonResponse{data=MessagesResponse} "Success"
// @Router /api/conversations/{conversation_id}/messages [get]
func GetMessagesByConversation(c *gin.Context) {
	conversation_id, err := parseConversationIDParam(c.Param("conversation_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	var messageListRequest MessageListRequest
	if err := c.ShouldBindQuery(&messageListRequest); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 设置默认方向为从新到旧
	if messageListRequest.Direction == "" {
		messageListRequest.Direction = "desc"
	}

	eid := config.GetEID(c)
	var messages []*model.Message
	var count int64

	var getConversation func() error
	if common.IsAdmin(c) {
		getConversation = func() error {
			_, err := model.AdminGetConversationByID(eid, conversation_id)
			return err
		}
	} else {
		getConversation = func() error {
			_, err := model.GetConversationByID(eid, config.GetUserId(c), conversation_id)
			return err
		}
	}

	if err := getConversation(); err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
		return
	}

	// 传递方向参数到模型层
	count, messages, err = model.GetMessagesByConversationIDWithDirection(
		eid, conversation_id,
		messageListRequest.Keyword, messageListRequest.Limit, messageListRequest.Offset,
		messageListRequest.Direction)

	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	// 如果是从新到旧获取的，需要反转结果集以确保最终结果是从旧到新排序
	if messageListRequest.Direction == "desc" {
		// 反转消息数组
		for i, j := 0, len(messages)-1; i < j; i, j = i+1, j-1 {
			messages[i], messages[j] = messages[j], messages[i]
		}
	}

	// 批量获取文件名，避免 N+1 查询
	fileMap := make(map[int64]string)
	var targetFileIDs []int64
	for _, msg := range messages {
		if msg.FileID > 0 {
			targetFileIDs = append(targetFileIDs, msg.FileID)
		}
	}
	if len(targetFileIDs) > 0 {
		var files []model.File
		if err := model.DB.Select("id, path").Where("id IN ?", targetFileIDs).Find(&files).Error; err == nil {
			for _, f := range files {
				fileMap[f.ID] = model.ExtractSimpleFileName(f.Path)
			}
		}
	}

	messageIDs := make([]int64, 0, len(messages))
	for _, msg := range messages {
		if msg != nil && msg.ID > 0 {
			messageIDs = append(messageIDs, msg.ID)
		}
	}
	processRecordMap := map[int64][]*model.MessageProcessStep{}
	if len(messageIDs) > 0 {
		processRecordMap, err = model.GetMessageProcessStepsByMessageIDs(eid, messageIDs)
		if err != nil {
			logger.Warnf(c.Request.Context(), "GetMessageProcessStepsByMessageIDs failed: %v", err)
			processRecordMap = map[int64][]*model.MessageProcessStep{}
		}
	}
	toolCallMap := map[int64][]*model.MessageToolCall{}
	if len(messageIDs) > 0 {
		toolCallMap, err = model.GetMessageToolCallsByMessageIDs(eid, messageIDs)
		if err != nil {
			logger.Warnf(c.Request.Context(), "GetMessageToolCallsByMessageIDs failed: %v", err)
			toolCallMap = map[int64][]*model.MessageToolCall{}
		}
	}
	processRecordMap = mergeProcessRecordsWithToolCalls(processRecordMap, toolCallMap)

	enhancedMessages := buildEnhancedMessages(messages, fileMap, processRecordMap)

	c.JSON(http.StatusOK, model.Success.ToResponse(&MessagesResponse{
		Count:    count,
		Messages: enhancedMessages,
	}))
}

// GetMessageByID godoc
// @Summary 获取单条消息记录
// @Description 根据消息ID获取单条消息记录
// @Tags 消息
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "消息ID"
// @Success 200 {object} model.CommonResponse{data=model.Message} "Success"
// @Router /api/messages/{id} [get]
func GetMessageByID(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	message, err := model.GetMessageByID(eid, id)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
		return
	}

	// 验证用户权限，确保用户只能访问自己的消息
	if message.UserID != userID && !common.IsAdmin(c) {
		c.JSON(http.StatusForbidden, model.ForbiddenError.ToResponse(nil))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(message))
}

// MessageStatsRequest 消息统计请求参数
type MessageStatsRequest struct {
	StartDate int64  `json:"start_date" form:"start_date" binding:"required"` // 开始日期时间戳
	EndDate   int64  `json:"end_date" form:"end_date" binding:"required"`     // 结束日期时间戳
	AgentID   *int64 `json:"agent_id" form:"agent_id"`                        // Agent ID 筛选
}

// GetMessageStatsSum godoc
// @Summary 获取消息统计汇总数据
// @Description 根据日期范围获取消息统计汇总数据
// @Tags Message
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param start_date query int64 true "开始日期时间戳"
// @Param end_date query int64 true "结束日期时间戳"
// @Success 200 {object} model.CommonResponse{data=model.MessageStatsSummary} "Success"
// @Router /api/message_stats/sum [get]
func GetMessageStatsSum(c *gin.Context) {
	var req MessageStatsRequest
	if err := c.ShouldBindQuery(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	eid := config.GetEID(c)

	// 将时间戳转换为time.Time
	startDate := time.Unix(req.StartDate, 0)
	endDate := time.Unix(req.EndDate, 0)

	stats, err := model.SumStatsByAgentAndDateRange(eid, req.AgentID, startDate, endDate)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(stats))
}

// GetMessagesList 获取消息列表
// @Summary 获取消息列表
// @Description 获取消息列表，支持关键词、思考方式、回答状态、知识类型、日期范围筛选，支持排序
// @Tags Message
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param keyword query string false "搜索关键词，支持在消息内容和回答内容中搜索"
// @Param file_keyword query string false "文件名搜索关键词，支持模糊搜索匹配的文件"
// @Param offset query int false "分页偏移量" default(0)
// @Param limit query int false "分页大小" default(10)
// @Param direction query string false "排序方向" Enums(desc,asc) default("desc") "desc=从新到旧，asc=从旧到新"
// @Param thinking_mode query int false "思考方式" Enums(1,2) "1=快速回答，2=深度思考"
// @Param response_status query int false "回答状态" Enums(1,2) "1=正常回答，2=拒答/超纲回复"
// @Param knowledge_type query int false "知识类型" Enums(1,2,3) "1=知识库搜索，2=Web搜索，3=指定知识库"
// @Param start_date query int64 false "开始日期时间戳（秒或毫秒）"
// @Param end_date query int64 false "结束日期时间戳（秒或毫秒）"
// @Param agent_id query int64 false "Agent ID 筛选"
// @Success 200 {object} model.CommonResponse{data=MessagesResponse} "Success"
// @Router /api/messages/list [get]
func GetMessagesList(c *gin.Context) {
	var messageListRequest MessageListAllRequest
	if err := c.ShouldBindQuery(&messageListRequest); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 设置默认方向为从新到旧
	if messageListRequest.Direction == "" {
		messageListRequest.Direction = "desc"
	}

	eid := config.GetEID(c)
	var fileIDs []int64
	if messageListRequest.FileKeyword != "" {
		// 执行文件名搜索逻辑
		esClient := elasticsearch.GetGlobalClient()
		if esClient != nil && !esClient.IsDisabled() {
			// 创建文件搜索服务
			esSearchService := elasticsearch.NewFileNameSearchService(esClient, model.DB)
			// 构建搜索请求
			searchReq := &elasticsearch.FileNameSearchRequest{
				Query: messageListRequest.FileKeyword,
				TopK:  1000, // 搜索足够多的文件 ID
			}
			// 执行搜索
			response, err := esSearchService.Search(eid, searchReq)
			if err != nil {
				logger.SysLogf("GetMessagesList 文件名 ES 搜索失败: eid=%d, query=%s, err=%v", eid, messageListRequest.FileKeyword, err)
			} else if len(response.Results) > 0 {
				for _, res := range response.Results {
					fileIDs = append(fileIDs, res.FileID)
				}
			}
		}

		// 如果 ES 没搜到或报错，尝试数据库降级搜索（仅当 fileIDs 为空时）
		if len(fileIDs) == 0 {
			var files []model.File
			// 数据库 LIKE 搜索
			if err := model.DB.Where("eid = ? AND is_deleted = ? AND path LIKE ?", eid, false, "%"+messageListRequest.FileKeyword+"%").Limit(1000).Find(&files).Error; err == nil {
				for _, f := range files {
					fileIDs = append(fileIDs, f.ID)
				}
			}
		}

		// 如果最终还是没搜到匹配的文件，说明该文件名下没有消息，直接返回空
		if len(fileIDs) == 0 {
			c.JSON(http.StatusOK, model.Success.ToResponse(&MessagesResponse{
				Count:    0,
				Messages: []*EnhancedMessage{},
			}))
			return
		}
	}

	count, messages, err := model.GetMessagesList(
		eid,
		messageListRequest.Keyword,
		messageListRequest.ThinkingMode,
		messageListRequest.ResponseStatus,
		messageListRequest.KnowledgeType,
		messageListRequest.StartDate,
		messageListRequest.EndDate,
		messageListRequest.Direction,
		messageListRequest.Limit,
		messageListRequest.Offset,
		messageListRequest.AgentID,
		fileIDs,
	)

	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	// 批量获取文件名，避免 N+1 查询
	fileMap := make(map[int64]string)
	var targetFileIDs []int64
	for _, msg := range messages {
		if msg.FileID > 0 {
			targetFileIDs = append(targetFileIDs, msg.FileID)
		}
	}
	if len(targetFileIDs) > 0 {
		var files []model.File
		if err := model.DB.Select("id, path").Where("id IN ?", targetFileIDs).Find(&files).Error; err == nil {
			for _, f := range files {
				fileMap[f.ID] = model.ExtractSimpleFileName(f.Path)
			}
		}
	}

	messageIDs := make([]int64, 0, len(messages))
	for _, msg := range messages {
		if msg != nil && msg.ID > 0 {
			messageIDs = append(messageIDs, msg.ID)
		}
	}
	processRecordMap := map[int64][]*model.MessageProcessStep{}
	if len(messageIDs) > 0 {
		processRecordMap, err = model.GetMessageProcessStepsByMessageIDs(eid, messageIDs)
		if err != nil {
			logger.Warnf(c.Request.Context(), "GetMessageProcessStepsByMessageIDs failed: %v", err)
			processRecordMap = map[int64][]*model.MessageProcessStep{}
		}
	}
	toolCallMap := map[int64][]*model.MessageToolCall{}
	if len(messageIDs) > 0 {
		toolCallMap, err = model.GetMessageToolCallsByMessageIDs(eid, messageIDs)
		if err != nil {
			logger.Warnf(c.Request.Context(), "GetMessageToolCallsByMessageIDs failed: %v", err)
			toolCallMap = map[int64][]*model.MessageToolCall{}
		}
	}
	processRecordMap = mergeProcessRecordsWithToolCalls(processRecordMap, toolCallMap)

	c.JSON(http.StatusOK, model.Success.ToResponse(&MessagesResponse{
		Count:    count,
		Messages: buildEnhancedMessages(messages, fileMap, processRecordMap),
	}))
}

// GetMessageAIUploadFiles 获取消息关联的 AI 上传文件列表
// @Summary 获取消息输出文件
// @Description 获取指定消息关联的所有 AI 上传文件列表
// @Tags Message
// @Accept json
// @Produce json
// @Param id path int true "消息ID"
// @Success 200 {object} model.CommonResponse{data=[]model.UploadFile}
// @Router /api/messages/{id}/files [get]
// @Security BearerAuth
func GetMessageAIUploadFiles(c *gin.Context) {
	// 支持 HashID 和整数ID
	idStr := c.Param("id")
	messageID, err := hashids.TryParseID(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的消息ID")))
		return
	}

	// 验证消息归属
	eid := config.GetEID(c)
	message, err := model.GetMessageByID(eid, messageID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
		return
	}

	// 检查权限
	userID := config.GetUserId(c)
	if message.UserID != userID {
		c.JSON(http.StatusForbidden, model.ForbiddenError.ToResponse(nil))
		return
	}

	// 获取文件列表
	files, err := model.GetAIUploadFilesByMessageID(messageID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}
	originRefIDs := make([]int64, 0, len(files))
	for _, file := range files {
		if file != nil && file.ID > 0 {
			originRefIDs = append(originRefIDs, file.ID)
		}
	}
	associatedFiles, err := model.GetFilesByOriginRefIDs(model.FileOriginTypeAIGenerated, originRefIDs)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}
	fileMap := make(map[int64]model.File, len(associatedFiles))
	for _, file := range associatedFiles {
		fileMap[file.OriginRefID] = file
	}
	for _, outputFile := range files {
		if outputFile == nil {
			continue
		}
		if file, ok := fileMap[outputFile.ID]; ok {
			associated := file
			outputFile.File = &associated
		}
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(files))
}

// DownloadAIUploadFile 下载 AI 上传文件
// @Summary 下载 AI 上传文件
// @Description 下载指定的 AI 上传文件内容
// @Tags Message
// @Accept json
// @Produce octet-stream
// @Param id path int true "文件ID"
// @Success 200 {file} binary
// @Router /api/upload-files/{id}/download [get]
// @Security BearerAuth
func DownloadAIUploadFile(c *gin.Context) {
	// 支持 HashID 和整数ID
	idStr := c.Param("id")
	fileID, err := hashids.TryParseID(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的文件ID")))
		return
	}

	// 获取文件记录
	file, err := model.GetAIUploadFileByID(fileID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
		return
	}

	// 签名下载（支持无登录态访问）
	downloadToken := strings.TrimSpace(c.Query("token"))
	if downloadToken != "" {
		requestedFileName := strings.TrimSpace(c.Param("filename"))
		expectedFileName := path.Base(strings.TrimSpace(file.FileName))
		if requestedFileName == "" {
			requestedFileName = expectedFileName
		}
		if path.Base(requestedFileName) != expectedFileName {
			c.JSON(http.StatusForbidden, model.ForbiddenError.ToResponse(errors.New("文件名不匹配")))
			return
		}
		if err := sandboxdl.ValidateDownloadToken(downloadToken, file.ID, expectedFileName); err != nil {
			c.JSON(http.StatusUnauthorized, model.UnauthorizedError.ToResponse(err))
			return
		}
		serveUploadFile(c, file)
		return
	}

	// Bearer 鉴权下载（兼容旧逻辑）
	token := strings.TrimSpace(c.GetHeader("Authorization"))
	token = strings.TrimSpace(strings.TrimPrefix(token, "Bearer "))
	if token == "" {
		c.JSON(http.StatusUnauthorized, model.UnauthorizedError.ToResponse(nil))
		return
	}
	user, tokenEid, err := middleware.HandleTokenAuth(token, model.RoleGuestUser)
	if err != nil {
		c.JSON(http.StatusUnauthorized, model.UnauthorizedError.ToResponse(err))
		return
	}
	message, err := model.GetMessageByID(tokenEid, file.MessageID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
		return
	}
	if message.UserID != user.UserID {
		c.JSON(http.StatusForbidden, model.ForbiddenError.ToResponse(nil))
		return
	}

	serveUploadFile(c, file)
}

func serveUploadFile(c *gin.Context, file *model.UploadFile) {
	content, err := storage.StorageInstance.Load(file.Key)
	if err != nil {
		logger.Errorf(c.Request.Context(), "Failed to read file %s: %v", file.Key, err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	// 设置下载头
	downloadName := path.Base(strings.TrimSpace(file.FileName))
	if downloadName == "" || downloadName == "." || downloadName == "/" {
		downloadName = "download.bin"
	}
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", downloadName))
	c.Header("Content-Type", file.MimeType)
	c.Header("Content-Length", strconv.FormatInt(file.Size, 10))
	c.Data(http.StatusOK, file.MimeType, content)
}
