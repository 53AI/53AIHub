package controller

import (
	"net/http"

	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/botgateway"
	"github.com/gin-gonic/gin"
)

func BotGatewayListBots(c *gin.Context) {
	bots, err := botgateway.ListBots(c.Request.Context())
	if err != nil {
		respondGatewayError(c, err)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(map[string]any{"list": bots}))
}

// BotGatewayContactDetails 反查联系人资料（转发网关）。
// @Summary 反查联系人资料
// @Description 按 wxids 反查联系人资料（头像/昵称/签名等）
// @Tags BotGateway
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body object true "查询参数 {bot_id, wxids[]}"
// @Success 200 {object} model.CommonResponse{data=object} "Success"
// @Router /api/bot-gateway/contacts/detail [post]

func BotGatewayContactDetails(c *gin.Context) {
	var req struct {
		BotID string   `json:"bot_id"`
		Wxids []string `json:"wxids"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.BotID == "" || len(req.Wxids) == 0 {
		respondErr(c, http.StatusBadRequest, model.ParamError, "请指定机器人与联系人")
		return
	}
	details, err := botgateway.GetContactDetails(c.Request.Context(), req.BotID, req.Wxids)
	if err != nil {
		respondGatewayError(c, err)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(map[string]any{"list": details}))
}

// BotGatewayBotDetail 机器人平台实时详情（转发网关）。
// @Summary 机器人平台详情
// @Description 获取机器人在线/昵称/头像/签名等实时信息
// @Tags BotGateway
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param bot_id path string true "机器人账号"
// @Success 200 {object} model.CommonResponse{data=object} "Success"
// @Router /api/bot-gateway/bots/{bot_id}/detail [get]

func BotGatewayBotDetail(c *gin.Context) {
	botID := c.Param("bot_id")
	info, err := botgateway.GetBotDetail(c.Request.Context(), botID)
	if err != nil {
		respondGatewayError(c, err)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(info))
}

// BotGatewayBotOnline 机器人在线状态（转发网关）。
// @Summary 机器人在线状态
// @Description 实时检测单个机器人在线状态
// @Tags BotGateway
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param bot_id path string true "机器人账号"
// @Success 200 {object} model.CommonResponse{data=object} "Success"
// @Router /api/bot-gateway/bots/{bot_id}/online [get]

func BotGatewayBotOnline(c *gin.Context) {
	botID := c.Param("bot_id")
	online, err := botgateway.GetBotOnline(c.Request.Context(), botID)
	if err != nil {
		respondGatewayError(c, err)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(map[string]any{"bot_id": botID, "online": online}))
}
