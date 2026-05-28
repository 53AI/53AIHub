package controller

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

var agentH5AuthService = service.NewAgentH5AuthService()

type CreateAgentH5FixedTokenRequest struct {
	AgentID     int64  `json:"agent_id" binding:"required" example:"1"`
	Source      string `json:"source" example:"agent_h5"`
	ExpiredDays int    `json:"expired_days" example:"0"`
}

type CreateAgentH5FixedTokenResponse struct {
	FixedToken string `json:"fixed_token"`
	AgentID    int64  `json:"agent_id"`
	Source     string `json:"source"`
	ExpiresAt  int64  `json:"expires_at"`
}

type AgentH5LoginRequest struct {
	FixedToken      string `json:"fixed_token" binding:"required" example:"abc123"`
	FingerprintCode string `json:"fingerprint_code" binding:"required" example:"device-001"`
}

type AgentH5LoginResponse struct {
	AccessToken string `json:"access_token"`
	AgentID     int64  `json:"agent_id"`
	UserID      int64  `json:"user_id"`
	Username    string `json:"username"`
	Nickname    string `json:"nickname"`
	Source      string `json:"source"`
	ExpiresAt   int64  `json:"expires_at"`
	ChannelID   int64  `json:"channel_id"`
	ChannelType string `json:"channel_type"`
}

type AgentH5LogoutResponse struct {
	Revoked bool `json:"revoked"`
}

type AgentH5InfoRequest struct {
	FixedToken string `json:"fixed_token" binding:"required" example:"abc123"`
}

// @Summary 生成 agent H5 固定令牌
// @Description 为指定 agent 生成一个固定令牌，前端可用该令牌兑换访客登录态
// @Tags Agent
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body CreateAgentH5FixedTokenRequest true "固定令牌参数"
// @Success 200 {object} model.CommonResponse{data=CreateAgentH5FixedTokenResponse} "Success"
// @Router /api/agents/h5/fixed-token [post]
func CreateAgentH5FixedToken(c *gin.Context) {
	var req CreateAgentH5FixedTokenRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	source := req.Source
	if source == "" {
		source = "h5"
	}
	_ = req.ExpiredDays
	ttl := 0 * time.Second

	tokenRecord, err := agentH5AuthService.CreateAccessKey(c.Request.Context(), config.GetEID(c), req.AgentID, source, ttl)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
			return
		}
		c.JSON(http.StatusBadRequest, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(&CreateAgentH5FixedTokenResponse{
		FixedToken: tokenRecord.Token,
		AgentID:    tokenRecord.AgentID,
		Source:     tokenRecord.Source,
		ExpiresAt:  tokenRecord.ExpiresAt,
	}))
}

// @Summary agent H5 固定令牌登录
// @Description 使用固定令牌兑换一个多渠道登录态 token，适用于未登录情况下的 agent H5 接入
// @Tags Agent
// @Accept json
// @Produce json
// @Param request body AgentH5LoginRequest true "固定令牌"
// @Success 200 {object} model.CommonResponse{data=AgentH5LoginResponse} "Success"
// @Router /api/agents/h5/login [post]
func AgentH5Login(c *gin.Context) {
	var req AgentH5LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	req.FixedToken = strings.TrimSpace(req.FixedToken)
	req.FingerprintCode = strings.TrimSpace(req.FingerprintCode)
	if req.FixedToken == "" || req.FingerprintCode == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("fixed_token and fingerprint_code are required")))
		return
	}

	result, err := agentH5AuthService.ExchangeAccessKey(c.Request.Context(), req.FixedToken, 168*time.Hour, req.FingerprintCode)
	if err != nil {
		if strings.Contains(err.Error(), "fingerprint_code is required") {
			c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
			return
		}
		c.JSON(http.StatusUnauthorized, model.UnauthorizedError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(&AgentH5LoginResponse{
		AccessToken: result.UserChannelToken.Token,
		AgentID:     result.AgentAccessKey.AgentID,
		UserID:      result.User.UserID,
		Username:    result.User.Username,
		Nickname:    result.User.Nickname,
		Source:      result.UserChannel.ChannelType,
		ExpiresAt:   result.UserChannelToken.ExpiresAt,
		ChannelID:   result.UserChannel.ID,
		ChannelType: result.UserChannel.ChannelType,
	}))
}

// @Summary 获取 agent H5 信息
// @Description 使用 agent 登录 key 获取绑定的 agent 信息，用于在换取 usertoken 之前展示 agent 基础信息
// @Tags Agent
// @Accept json
// @Produce json
// @Param request body AgentH5InfoRequest true "固定令牌"
// @Success 200 {object} model.CommonResponse{data=model.Agent} "Success"
// @Router /api/agents/h5/info [post]
func GetAgentH5Info(c *gin.Context) {
	var req AgentH5InfoRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	agent, err := agentH5AuthService.GetAgentInfoByAccessKey(c.Request.Context(), req.FixedToken)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
			return
		}
		c.JSON(http.StatusUnauthorized, model.UnauthorizedError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(agent))
}

// @Summary agent H5 退出登录
// @Description 撤销当前 Authorization 中携带的多渠道登录态 token，撤销后该 token 立即失效
// @Tags Agent
// @Accept json
// @Produce json
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse{data=AgentH5LogoutResponse} "Success"
// @Router /api/agents/h5/token [delete]
func AgentH5Logout(c *gin.Context) {
	token := c.Request.Header.Get("Authorization")
	token = strings.TrimSpace(strings.Replace(token, "Bearer ", "", 1))
	if token == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	revoked, err := agentH5AuthService.RevokeToken(c.Request.Context(), token)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(&AgentH5LogoutResponse{
		Revoked: revoked,
	}))
}

type GetAgentH5FixedTokenListRequest struct {
	AgentID int64 `json:"agent_id" form:"agent_id" example:"1"`
	Offset  int   `json:"offset" form:"offset" example:"0"`
	Limit   int   `json:"limit" form:"limit" example:"10"`
}

type GetAgentH5FixedTokenListResponse struct {
	Count int64                      `json:"count"`
	List  []*model.AgentAccessKey    `json:"list"`
}

// @Summary 获取 agent H5 固定令牌列表
// @Description 获取企业下所有 agent H5 固定令牌，可按 agent_id 过滤
// @Tags Agent
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param agent_id query int false "agent_id 过滤（可选）"
// @Param offset query int false "偏移量" default(0)
// @Param limit query int false "每页数量" default(10)
// @Success 200 {object} model.CommonResponse{data=GetAgentH5FixedTokenListResponse} "Success"
// @Router /api/agents/h5/fixed-token [get]
func GetAgentH5FixedTokenList(c *gin.Context) {
	var req GetAgentH5FixedTokenListRequest
	if err := c.ShouldBindQuery(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	if req.Limit == 0 {
		req.Limit = 10
	}

	eid := config.GetEID(c)
	total, list, err := model.GetAgentAccessKeyList(eid, req.AgentID, req.Offset, req.Limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(GetAgentH5FixedTokenListResponse{
		Count: total,
		List:  list,
	}))
}
