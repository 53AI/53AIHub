package controller

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/gin-gonic/gin"
)

type PersonalAgentRequest struct {
	Name         string `json:"name" binding:"required" example:"我的智能体"`
	Description  string `json:"description" example:"智能体描述"`
	Logo         string `json:"logo" example:"https://example.com/logo.png"`
	ChannelType  int    `json:"channel_type" binding:"required" example:"1014"`
	CustomConfig string `json:"custom_config" example:"{}"`
}

// @Summary 创建个人智能体
// @Description 用户创建属于自己的智能体。channel_type必传，目前支持1014(OpenClaw)、1015(QClaw)、1016(Codex)、1017(Manus)。
// @Description 注意：必须先通过 POST /api/channels 创建对应 type 的渠道，否则智能体运行时会因找不到执行渠道而失败。
// @Description 创建成功后会自动生成openclaw_app_secret存储在custom_config中，用于WebSocket连接认证。
// @Tags PersonalAgent
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param agent body PersonalAgentRequest true "个人智能体参数"
// @Success 200 {object} model.CommonResponse{data=model.Agent} "成功返回智能体信息，包含bot_id"
// @Failure 400 {object} model.CommonResponse "参数错误或不支持的channel_type"
// @Failure 401 {object} model.CommonResponse "未授权"
// @Failure 500 {object} model.CommonResponse "服务器错误"
// @Router /api/my/agents [post]
func CreatePersonalAgent(c *gin.Context) {
	var req PersonalAgentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	agent := &model.Agent{
		Eid:          eid,
		Name:         req.Name,
		Description:  req.Description,
		Logo:         req.Logo,
		ChannelType:  req.ChannelType,
		OwnerID:      userID,
		Enable:       true,
		Model:        "",
		Prompt:       "",
		Configs:      "{}",
		Tools:        "[]",
		UseCases:     "[]",
		CustomConfig: "{}",
		Settings:     "{}",
	}

	switch {
	case model.IsOpenClawWSCompatibleChannelType(req.ChannelType):
		agent.Model = "openclaw-ws"
		mergedCustomConfig, err := model.MergeOpenClawCustomConfigForChannelType("", req.CustomConfig, true, req.ChannelType)
		if err != nil {
			c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
			return
		}
		agent.CustomConfig = mergedCustomConfig
	default:
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("unsupported channel_type for personal agent")))
		return
	}

	if err := model.DB.Create(agent).Error; err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	agent.FillBotID()
	c.JSON(http.StatusOK, model.Success.ToResponse(agent))
}

// @Summary 重置个人智能体密钥
// @Description 重置个人智能体的API密钥。对于 OpenClawWS 兼容类型(1014/1015/1016/1017)，会重新生成openclaw_app_secret并存储在custom_config中。
// @Description 重置后旧的密钥将立即失效，需要使用新密钥重新建立WebSocket连接。
// @Tags PersonalAgent
// @Produce json
// @Security BearerAuth
// @Param agent_id path int true "智能体ID"
// @Success 200 {object} model.CommonResponse{data=map[string]string} "成功返回新密钥 {\"secret\": \"sk-53ai-xxx\"}"
// @Failure 400 {object} model.CommonResponse "参数错误或不支持的channel_type"
// @Failure 401 {object} model.CommonResponse "未授权"
// @Failure 404 {object} model.CommonResponse "智能体不存在或无权访问"
// @Failure 500 {object} model.CommonResponse "服务器错误"
// @Router /api/my/agents/{agent_id}/reset-secret [post]
func ResetPersonalAgentSecret(c *gin.Context) {
	agentID, err := strconv.ParseInt(c.Param("agent_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	agent, err := model.GetPersonalAgentByID(config.GetEID(c), config.GetUserId(c), agentID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(nil))
		return
	}

	var newSecret string
	switch {
	case agent.IsOpenClawWSCompatible():
		newSecret = model.GenerateOpenClawAppSecret()
		agent.SetOpenClawAppSecret(newSecret)
	default:
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("unsupported channel_type for secret reset")))
		return
	}

	if err := agent.Update(); err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(gin.H{"secret": newSecret}))
}
