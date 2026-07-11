package controller

import (
	"net/http"
	"strconv"

	"github.com/53AI/53AIHub/common/session"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/gin-gonic/gin"
)

// ConversationRequest 会话创建请求参数
type ConversationRequest struct {
	Title   string `json:"title" example:"我的会话"`
	AgentID int64  `json:"agent_id" binding:"required" example:"1"`
	FileID  int64  `json:"file_id" example:"0"`
	// ConversationType 会话类型：0=正式会话（默认），1=调试会话
	ConversationType *int `json:"conversation_type" example:"0"`
}

// ConversationUpdateRequest 会话更新请求参数
type ConversationUpdateRequest struct {
	Title string `json:"title" example:"更新后的标题"`
}

// ConversationResponse 会话列表响应
type ConversationResponse struct {
	Count         int64                        `json:"count" example:"10"`
	Conversations []*ConversationWithLatestRun `json:"conversations"`
}

type ConversationWithLatestRun struct {
	*model.Conversation
	LatestRun *model.AgentRun `json:"latest_run,omitempty"`
}

// ConversationListRequest 会话列表查询参数
type ConversationListRequest struct {
	Keyword          string `json:"keyword" form:"keyword" example:"搜索关键词"`
	AgentID          int64  `json:"agent_id" form:"agent_id" example:"1"`
	ConversationType *int   `json:"conversation_type" form:"conversation_type" example:"0"`
	Offset           int    `json:"offset" form:"offset" example:"0"`
	Limit            int    `json:"limit" form:"limit" example:"10"`
}

const maxConversationTitleLen = 64

func normalizeConversationTitle(title string) string {
	runes := []rune(title)
	if len(runes) <= maxConversationTitleLen {
		return title
	}
	if maxConversationTitleLen <= 3 {
		return string(runes[:maxConversationTitleLen])
	}
	return string(runes[:maxConversationTitleLen-3]) + "..."
}

// @Summary 创建会话
// @Description 创建新的对话会话。可指定会话类型：0=正式会话（默认），1=调试会话。
// @Tags Conversation
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param conversation body ConversationRequest true "会话参数"
// @Success 200 {object} model.CommonResponse{data=model.Conversation} "成功返回会话信息"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 401 {object} model.CommonResponse "未授权"
// @Failure 404 {object} model.CommonResponse "智能体不存在"
// @Failure 500 {object} model.CommonResponse "服务器错误"
// @Router /api/conversations [post]
func CreateConversation(c *gin.Context) {
	var req ConversationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	eid := config.GetEID(c)
	agent, err := model.GetAgentByID(eid, req.AgentID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(nil))
		return
	}

	convType := model.ConversationTypeOfficial
	if req.ConversationType != nil {
		convType = *req.ConversationType
	}

	conversation := &model.Conversation{
		Eid:              eid,
		UserID:           config.GetUserId(c),
		AgentID:          req.AgentID,
		VisitorID:        session.GetVisitorID(c),
		Source:           model.MessageRequestSourceConsole,
		Title:            normalizeConversationTitle(req.Title),
		FileID:           req.FileID,
		Status:           model.ConversationStatusActive,
		Model:            agent.Model,
		ConversationType: convType,
	}
	if conversation.VisitorID != "" {
		conversation.Source = model.MessageRequestSourceH5
	}

	if err := model.CreateConversation(conversation); err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	conversation.LoadAgent()
	c.JSON(http.StatusOK, model.Success.ToResponse(conversation))
}

// @Summary 获取会话详情
// @Description 根据会话ID获取会话详细信息。
// @Tags Conversation
// @Produce json
// @Security BearerAuth
// @Param conversation_id path int true "会话ID"
// @Success 200 {object} model.CommonResponse{data=model.Conversation} "成功返回会话详情"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 401 {object} model.CommonResponse "未授权"
// @Failure 404 {object} model.CommonResponse "会话不存在"
// @Router /api/conversations/{conversation_id} [get]
func GetConversation(c *gin.Context) {
	conversationID, err := strconv.ParseInt(c.Param("conversation_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	conversation, err := model.GetConversationByIDWithVisitor(config.GetEID(c), config.GetUserId(c), conversationID, session.GetVisitorID(c))
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(nil))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(conversation))
}

// @Summary 获取会话列表
// @Description 获取当前用户的会话列表。支持按智能体ID和会话类型筛选。
// @Description 会话类型：0=正式会话（默认查询），1=调试会话。不传conversation_type时默认查询正式会话。
// @Tags Conversation
// @Produce json
// @Security BearerAuth
// @Param keyword query string false "搜索关键词"
// @Param agent_id query int false "智能体ID，按智能体筛选会话"
// @Param conversation_type query int false "会话类型：0=正式会话（默认），1=调试会话"
// @Param offset query int false "偏移量" default(0)
// @Param limit query int false "每页数量" default(10)
// @Success 200 {object} model.CommonResponse{data=ConversationResponse} "成功返回会话列表"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 401 {object} model.CommonResponse "未授权"
// @Failure 500 {object} model.CommonResponse "服务器错误"
// @Router /api/conversations [get]
func GetConversations(c *gin.Context) {
	var req ConversationListRequest
	if err := c.ShouldBindQuery(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	convType := model.ConversationTypeOfficial
	if req.ConversationType != nil {
		convType = *req.ConversationType
	}

	offset := req.Offset
	limit := req.Limit
	if limit <= 0 {
		limit = 20
	}

	conversations, total, err := model.GetConversationsByUserIDAndTypeWithVisitorPaged(config.GetEID(c), config.GetUserId(c), req.AgentID, convType, session.GetVisitorID(c), offset, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	conversationIDs, _ := collectConversationAndUserIDs(conversations)
	latestRuns, err := agentRunService.GetLatestRunsForConversations(c.Request.Context(), config.GetEID(c), conversationIDs)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	items := make([]*ConversationWithLatestRun, 0, len(conversations))
	for _, conversation := range conversations {
		items = append(items, &ConversationWithLatestRun{
			Conversation: conversation,
			LatestRun:    latestRuns[conversation.ConversationID],
		})
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(&ConversationResponse{
		Count:         total,
		Conversations: items,
	}))
}

// @Summary 更新会话
// @Description 更新会话信息，目前支持更新会话标题。
// @Tags Conversation
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param conversation_id path int true "会话ID"
// @Param conversation body ConversationUpdateRequest true "会话更新参数"
// @Success 200 {object} model.CommonResponse{data=model.Conversation} "成功返回更新后的会话信息"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 401 {object} model.CommonResponse "未授权"
// @Failure 404 {object} model.CommonResponse "会话不存在"
// @Failure 500 {object} model.CommonResponse "服务器错误"
// @Router /api/conversations/{conversation_id} [put]
func UpdateConversation(c *gin.Context) {
	conversationID, err := strconv.ParseInt(c.Param("conversation_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	var req ConversationUpdateRequest
	if err = c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	conversation, err := model.GetConversationByIDWithVisitor(config.GetEID(c), config.GetUserId(c), conversationID, session.GetVisitorID(c))
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(nil))
		return
	}

	conversation.Title = normalizeConversationTitle(req.Title)

	if err := model.UpdateConversation(conversation); err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(conversation))
}

// UserConversationListRequest 用户会话列表查询参数
type UserConversationListRequest struct {
	ConversationListRequest
	CreatedAtStart int64  `form:"created_at_start" example:"1704067200000"`
	CreatedAtEnd   int64  `form:"created_at_end" example:"1735689600000"`
	AgentID        int64  `form:"agent_id" example:"1"`
	FileID         int64  `form:"file_id" example:"1"`
	View           string `form:"view" example:"user"`
}

func collectConversationAndUserIDs(conversations []*model.Conversation) ([]int64, []int64) {
	conversationIDs := make([]int64, 0, len(conversations))
	userIDs := make([]int64, 0, len(conversations))
	conversationSeen := make(map[int64]struct{}, len(conversations))
	userSeen := make(map[int64]struct{}, len(conversations))

	for _, conv := range conversations {
		if conv == nil {
			continue
		}
		if conv.ConversationID > 0 {
			if _, ok := conversationSeen[conv.ConversationID]; !ok {
				conversationSeen[conv.ConversationID] = struct{}{}
				conversationIDs = append(conversationIDs, conv.ConversationID)
			}
		}
		if conv.UserID > 0 {
			if _, ok := userSeen[conv.UserID]; !ok {
				userSeen[conv.UserID] = struct{}{}
				userIDs = append(userIDs, conv.UserID)
			}
		}
	}

	return conversationIDs, userIDs
}

func getBatchConversationMessageStats(conversationIDs []int64) (map[int64]int, map[int64]string) {
	messageCounts := make(map[int64]int)
	firstMessages := make(map[int64]string)
	if len(conversationIDs) == 0 {
		return messageCounts, firstMessages
	}

	counts, firsts, err := model.GetConversationMessageStatsByConversationIDs(conversationIDs)
	if err != nil {
		return messageCounts, firstMessages
	}
	return counts, firsts
}

// @Summary 获取用户会话列表（管理员）
// @Description 管理员查看指定用户的会话列表，支持时间范围筛选。
// @Tags Conversation
// @Produce json
// @Security BearerAuth
// @Param user_id path int true "用户ID"
// @Param agent_id query int false "智能体ID"
// @Param keyword query string false "搜索关键词"
// @Param created_at_start query int false "创建时间起始（毫秒时间戳）"
// @Param created_at_end query int false "创建时间结束（毫秒时间戳）"
// @Param offset query int false "偏移量" default(0)
// @Param limit query int false "每页数量" default(10)
// @Success 200 {object} model.CommonResponse{data=ConversationSummaryResponse} "成功返回会话摘要列表"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 401 {object} model.CommonResponse "未授权"
// @Failure 404 {object} model.CommonResponse "用户不存在"
// @Failure 500 {object} model.CommonResponse "服务器错误"
// @Router /api/users/{user_id}/conversations [get]
func GetUserConversations(c *gin.Context) {
	userID, err := strconv.ParseInt(c.Param("user_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	user, err := model.GetUserByID(userID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(nil))
		return
	}
	var req UserConversationListRequest
	if err = c.ShouldBindQuery(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	conversations, total, err := model.GetUserConversationsWithFilterWithVisitor(
		config.GetEID(c),
		userID,
		req.AgentID,
		req.Keyword,
		req.CreatedAtStart,
		req.CreatedAtEnd,
		session.GetVisitorID(c),
		req.Offset,
		req.Limit,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	conversationIDs, _ := collectConversationAndUserIDs(conversations)
	messageCounts, firstMessages := getBatchConversationMessageStats(conversationIDs)

	var summaries []*ConversationSummary = make([]*ConversationSummary, 0)
	for _, conv := range conversations {
		summaries = append(summaries, &ConversationSummary{
			ID:           conv.ConversationID,
			Title:        conv.Title,
			CreatedAt:    conv.CreatedTime,
			Summary:      firstMessages[conv.ConversationID],
			MessageCount: messageCounts[conv.ConversationID],
			User:         UserInfo{user.UserID, user.Username},
		})
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(&ConversationSummaryResponse{
		Count: total,
		Items: summaries,
	}))
}

// UserInfo 用户信息
type UserInfo struct {
	UserID   int64  `json:"user_id" example:"1"`
	Username string `json:"username" example:"张三"`
}

// ConversationSummary 会话摘要
type ConversationSummary struct {
	ID           int64           `json:"id" example:"1"`
	Title        string          `json:"title" example:"会话标题"`
	CreatedAt    int64           `json:"created_at" example:"1704067200000"`
	Summary      string          `json:"summary" example:"会话摘要内容"`
	MessageCount int             `json:"message_count" example:"10"`
	User         UserInfo        `json:"user"`
	LatestRun    *model.AgentRun `json:"latest_run,omitempty"`
}

// ConversationSummaryResponse 会话摘要列表响应
type ConversationSummaryResponse struct {
	Count int64                  `json:"count" example:"10"`
	Items []*ConversationSummary `json:"items"`
}

// @Summary 获取智能体会话列表
// @Description 获取指定智能体的会话列表，支持时间范围和文件筛选。
// @Tags Conversation
// @Produce json
// @Security BearerAuth
// @Param agent_id path int true "智能体ID"
// @Param keyword query string false "搜索关键词"
// @Param created_at_start query int false "创建时间起始（毫秒时间戳）"
// @Param created_at_end query int false "创建时间结束（毫秒时间戳）"
// @Param file_id query int false "文件ID"
// @Param view query string false "视图模式：user=仅当前用户，不传=全部"
// @Param offset query int false "偏移量" default(0)
// @Param limit query int false "每页数量" default(10)
// @Success 200 {object} model.CommonResponse{data=ConversationSummaryResponse} "成功返回会话摘要列表"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 401 {object} model.CommonResponse "未授权"
// @Failure 500 {object} model.CommonResponse "服务器错误"
// @Router /api/agents/{agent_id}/conversations [get]
func GetAgentConversations(c *gin.Context) {
	agentID, err := strconv.ParseInt(c.Param("agent_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	var req UserConversationListRequest
	if err = c.ShouldBindQuery(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	var userID int64
	if req.View == "user" {
		userID = config.GetUserId(c)
	}

	conversations, total, err := model.GetAgentConversationsWithFilterWithVisitor(
		config.GetEID(c),
		agentID,
		userID,
		req.Keyword,
		req.CreatedAtStart,
		req.CreatedAtEnd,
		req.FileID,
		session.GetVisitorID(c),
		req.Offset,
		req.Limit,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	conversationIDs, userIDs := collectConversationAndUserIDs(conversations)
	messageCounts, firstMessages := getBatchConversationMessageStats(conversationIDs)
	latestRuns, err := agentRunService.GetLatestRunsForConversations(c.Request.Context(), config.GetEID(c), conversationIDs)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}
	userMap, userErr := model.GetUserMapByIDs(userIDs)
	if userErr != nil {
		userMap = make(map[int64]*model.User)
	}

	var summaries []*ConversationSummary = make([]*ConversationSummary, 0)
	for _, conv := range conversations {
		userInfo := UserInfo{}
		if user := userMap[conv.UserID]; user != nil {
			userInfo = UserInfo{user.UserID, user.Username}
		}
		summaries = append(summaries, &ConversationSummary{
			ID:           conv.ConversationID,
			Title:        conv.Title,
			CreatedAt:    conv.CreatedTime,
			Summary:      firstMessages[conv.ConversationID],
			MessageCount: messageCounts[conv.ConversationID],
			User:         userInfo,
			LatestRun:    latestRuns[conv.ConversationID],
		})
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(&ConversationSummaryResponse{
		Count: total,
		Items: summaries,
	}))
}

// @Summary 删除会话
// @Description 删除指定会话。
// @Tags Conversation
// @Produce json
// @Security BearerAuth
// @Param conversation_id path int true "会话ID"
// @Success 200 {object} model.CommonResponse "删除成功"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 401 {object} model.CommonResponse "未授权"
// @Failure 500 {object} model.CommonResponse "服务器错误"
// @Router /api/conversations/{conversation_id} [delete]
func DeleteConversation(c *gin.Context) {
	conversationID, err := strconv.ParseInt(c.Param("conversation_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	if err := model.DeleteConversation(config.GetEID(c), conversationID); err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}
