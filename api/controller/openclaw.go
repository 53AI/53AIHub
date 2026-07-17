package controller

import (
	"net/http"
	"strings"

	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/middleware"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/gin-gonic/gin"
)

func buildOpenClawRequestContext(c *gin.Context) (service.OpenClawRequestContext, bool) {
	c.Set(middleware.SkipIDEncryption, true)

	agentID, err := middleware.ParseIDParam(c, "agent_id")
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return service.OpenClawRequestContext{}, false
	}

	var query service.OpenClawPaginationQuery
	if err := c.ShouldBindQuery(&query); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return service.OpenClawRequestContext{}, false
	}

	return service.OpenClawRequestContext{
		EID:            config.GetEID(c),
		UserID:         config.GetUserId(c),
		Role:           config.GetUserRole(c),
		GroupID:        config.GetUserGroupID(c),
		AgentID:        agentID,
		ConversationID: c.Param("openclaw_session_id"),
		APIBaseURL:     resolveOpenClawRequestAPIBaseURL(c),
		Query:          query,
	}, true
}

func resolveOpenClawRequestAPIBaseURL(c *gin.Context) string {
	if c == nil || c.Request == nil {
		return ""
	}
	host := strings.TrimSpace(c.Request.Header.Get("X-Forwarded-Host"))
	if host == "" {
		host = strings.TrimSpace(c.Request.Host)
	}
	if host == "" {
		return ""
	}
	scheme := strings.TrimSpace(c.Request.Header.Get("X-Forwarded-Proto"))
	if scheme == "" {
		scheme = strings.TrimSpace(c.Request.Header.Get("X-Forwarded-Scheme"))
	}
	if scheme == "" {
		if c.Request.TLS != nil {
			scheme = "https"
		} else {
			scheme = "http"
		}
	}
	return strings.TrimRight(scheme+"://"+host, "/") + "/"
}

func respondOpenClawServiceError(c *gin.Context, svcErr *service.OpenClawServiceError) {
	if svcErr == nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(nil))
		return
	}
	message := svcErr.Message
	if message == "" && svcErr.Err != nil {
		message = svcErr.Err.Error()
	}
	if message == "" {
		message = svcErr.Code.Message()
	}
	c.JSON(svcErr.HTTPStatus, svcErr.Code.ToNewErrorResponse(message))
}

// GetOpenClawConversations godoc
// @Summary 获取 OpenClaw 会话列表
// @Description 获取指定 OpenClawWS 智能体的会话列表；默认优先返回 53AIHub mirror，fresh=1 时从插件/OpenClaw 拉取最新数据。
// @Tags OpenClaw
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param agent_id path int true "智能体ID"
// @Param limit query int false "分页大小"
// @Param offset query int false "分页偏移"
// @Param fresh query bool false "是否跳过 mirror，强制从插件/OpenClaw 拉取"
// @Success 200 {object} model.CommonResponse
// @Router /api/openclaw/agents/{agent_id}/conversations [get]
func GetOpenClawConversations(c *gin.Context) {
	req, ok := buildOpenClawRequestContext(c)
	if !ok {
		return
	}
	data, svcErr := service.NewOpenClawService().ListConversations(c.Request.Context(), req)
	if svcErr != nil {
		respondOpenClawServiceError(c, svcErr)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(data))
}

// GetOpenClawCurrentConversation godoc
// @Summary 获取当前 53AIHub 用户对应的 OpenClaw 会话
// @Description 获取当前 53AIHub 用户与指定 OpenClawWS 智能体的稳定 OpenClaw 会话；默认优先返回 mirror，fresh=1 时从插件/OpenClaw 拉取最新数据。
// @Tags OpenClaw
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param agent_id path int true "智能体ID"
// @Param fresh query bool false "是否跳过 mirror，强制从插件/OpenClaw 拉取"
// @Success 200 {object} model.CommonResponse
// @Router /api/openclaw/agents/{agent_id}/conversations/current [get]
func GetOpenClawCurrentConversation(c *gin.Context) {
	req, ok := buildOpenClawRequestContext(c)
	if !ok {
		return
	}
	data, svcErr := service.NewOpenClawService().GetCurrentConversation(c.Request.Context(), req)
	if svcErr != nil {
		respondOpenClawServiceError(c, svcErr)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(data))
}

// GetOpenClawConversationMessages godoc
// @Summary 获取 OpenClaw 会话消息列表
// @Description 获取指定 OpenClaw 会话的消息列表；默认优先返回 53AIHub mirror，fresh=1 时从插件/OpenClaw 拉取最新数据。
// @Tags OpenClaw
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param agent_id path int true "智能体ID"
// @Param conversation_id path string true "OpenClaw 会话ID"
// @Param limit query int false "分页大小"
// @Param offset query int false "分页偏移"
// @Param fresh query bool false "是否跳过 mirror，强制从插件/OpenClaw 拉取"
// @Success 200 {object} model.CommonResponse
// @Router /api/openclaw/agents/{agent_id}/conversations/{conversation_id}/messages [get]
func GetOpenClawConversationMessages(c *gin.Context) {
	req, ok := buildOpenClawRequestContext(c)
	if !ok {
		return
	}
	data, svcErr := service.NewOpenClawService().ListMessages(c.Request.Context(), req)
	if svcErr != nil {
		respondOpenClawServiceError(c, svcErr)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(data))
}

// GetOpenClawConversationEvents godoc
// @Summary 获取 OpenClaw 会话事件列表
// @Description 获取指定 OpenClaw 会话的 timeline events；默认优先返回 53AIHub mirror，fresh=1 时从插件/OpenClaw 拉取最新数据。
// @Tags OpenClaw
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param agent_id path int true "智能体ID"
// @Param conversation_id path string true "OpenClaw 会话ID"
// @Param limit query int false "分页大小"
// @Param offset query int false "分页偏移"
// @Param after_seq query int false "只返回该 seq 之后的事件"
// @Param fresh query bool false "是否跳过 mirror，强制从插件/OpenClaw 拉取"
// @Success 200 {object} model.CommonResponse
// @Router /api/openclaw/agents/{agent_id}/conversations/{conversation_id}/events [get]
func GetOpenClawConversationEvents(c *gin.Context) {
	req, ok := buildOpenClawRequestContext(c)
	if !ok {
		return
	}
	data, svcErr := service.NewOpenClawService().ListEvents(c.Request.Context(), req)
	if svcErr != nil {
		respondOpenClawServiceError(c, svcErr)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(data))
}

// GetOpenClawConversationSnapshot godoc
// @Summary 获取 OpenClaw 会话实时快照
// @Description 获取指定 OpenClaw 会话的 canonical ledger 快照；默认优先返回 53AIHub mirror，fresh=1 时从插件/OpenClaw 拉取最新数据。
// @Tags OpenClaw
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param agent_id path int true "智能体ID"
// @Param conversation_id path string true "OpenClaw 会话ID"
// @Param after_seq query int false "只返回该 seq 之后的 recent events"
// @Param fresh query bool false "是否跳过 mirror，强制从插件/OpenClaw 拉取"
// @Success 200 {object} model.CommonResponse
// @Router /api/openclaw/agents/{agent_id}/conversations/{conversation_id}/snapshot [get]
func GetOpenClawConversationSnapshot(c *gin.Context) {
	req, ok := buildOpenClawRequestContext(c)
	if !ok {
		return
	}
	data, svcErr := service.NewOpenClawService().GetSnapshot(c.Request.Context(), req)
	if svcErr != nil {
		respondOpenClawServiceError(c, svcErr)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(data))
}

type OpenClawControlRequest struct {
	Action        string                 `json:"action" binding:"required"`
	InteractionID string                 `json:"interaction_id,omitempty"`
	ToolCallID    string                 `json:"tool_call_id,omitempty"`
	Decision      string                 `json:"decision,omitempty"`
	OptionID      string                 `json:"option_id,omitempty"`
	Answer        interface{}            `json:"answer,omitempty"`
	Answers       map[string]interface{} `json:"answers,omitempty"`
}

// ControlOpenClawConversation godoc
// @Summary 控制 OpenClaw 会话
// @Description 对指定 OpenClaw 会话执行控制操作，支持 stop 以及 WorkBuddy 交互中断响应。
// @Tags OpenClaw
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param agent_id path int true "智能体ID"
// @Param conversation_id path string true "OpenClaw 会话ID"
// @Param request body controller.OpenClawControlRequest true "控制参数"
// @Success 200 {object} model.CommonResponse
// @Router /api/openclaw/agents/{agent_id}/conversations/{conversation_id}/control [post]
func ControlOpenClawConversation(c *gin.Context) {
	req, ok := buildOpenClawRequestContext(c)
	if !ok {
		return
	}
	var body map[string]interface{}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	action, _ := body["action"].(string)
	action = strings.TrimSpace(action)
	if action == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("action is required"))
		return
	}
	body["action"] = action
	data, svcErr := service.NewOpenClawService().ControlConversation(c.Request.Context(), req, action, body)
	if svcErr != nil {
		respondOpenClawServiceError(c, svcErr)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(data))
}

// GetOpenClawStatus godoc
// @Summary 获取 OpenClaw 状态
// @Description 获取 OpenClaw 插件和运行环境状态，保留 gatewayHealth、connectionHealthy 等插件字段。
// @Tags OpenClaw
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param agent_id path int true "智能体ID"
// @Success 200 {object} model.CommonResponse
// @Router /api/openclaw/agents/{agent_id}/status [get]
func GetOpenClawStatus(c *gin.Context) {
	req, ok := buildOpenClawRequestContext(c)
	if !ok {
		return
	}
	data, svcErr := service.NewOpenClawService().GetStatus(c.Request.Context(), req)
	if svcErr != nil {
		respondOpenClawServiceError(c, svcErr)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(data))
}

// GetOpenClawConfig godoc
// @Summary 获取 OpenClaw 脱敏配置
// @Description 获取插件返回的 OpenClaw 脱敏配置，不返回插件密钥。
// @Tags OpenClaw
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param agent_id path int true "智能体ID"
// @Success 200 {object} model.CommonResponse
// @Router /api/openclaw/agents/{agent_id}/config [get]
func GetOpenClawConfig(c *gin.Context) {
	req, ok := buildOpenClawRequestContext(c)
	if !ok {
		return
	}
	data, svcErr := service.NewOpenClawService().GetConfig(c.Request.Context(), req)
	if svcErr != nil {
		respondOpenClawServiceError(c, svcErr)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(data))
}

// GetOpenClawSkills godoc
// @Summary 获取 OpenClaw 技能列表
// @Description 获取当前 OpenClaw/QClaw 启用的技能信息。
// @Tags OpenClaw
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param agent_id path int true "智能体ID"
// @Success 200 {object} model.CommonResponse
// @Router /api/openclaw/agents/{agent_id}/skills [get]
func GetOpenClawSkills(c *gin.Context) {
	req, ok := buildOpenClawRequestContext(c)
	if !ok {
		return
	}
	data, svcErr := service.NewOpenClawService().GetSkills(c.Request.Context(), req)
	if svcErr != nil {
		respondOpenClawServiceError(c, svcErr)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(data))
}

// GetOpenClawCronTasks godoc
// @Summary 获取 OpenClaw cron tasks
// @Description 获取当前 OpenClaw/QClaw 中配置的 cron tasks，支持分页参数。
// @Tags OpenClaw
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param agent_id path int true "智能体ID"
// @Param limit query int false "分页大小"
// @Param offset query int false "分页偏移"
// @Success 200 {object} model.CommonResponse
// @Router /api/openclaw/agents/{agent_id}/cron-tasks [get]
func GetOpenClawCronTasks(c *gin.Context) {
	req, ok := buildOpenClawRequestContext(c)
	if !ok {
		return
	}
	data, svcErr := service.NewOpenClawService().ListCronTasks(c.Request.Context(), req)
	if svcErr != nil {
		respondOpenClawServiceError(c, svcErr)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(data))
}
