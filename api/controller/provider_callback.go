package controller

import (
	"errors"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/relay/channeltype"
)

type CozeCallbackRequest struct {
	Code  string `json:"code" form:"code" binding:"required"`
	State string `json:"state" form:"state" binding:"required"`
}

// @Summary Coze authorization callback
// @Description Handles OAuth2 authorization callback from Coze platform
// @Tags CallBack
// @Accept json
// @Produce json
// @Param request body CozeCallbackRequest true "Callback request parameters"
// @Param eid path int true "eid"
// @Success 200 {object} model.CommonResponse
// @Failure 400 {object} model.CommonResponse
// @Failure 500 {object} model.CommonResponse
// @Router /api/callback/cozecn/auth/{eid} [get]
// @Router /api/callback/cozecom/auth/{eid} [get]
func CozeCallBack(c *gin.Context) {
	eid, err := strconv.ParseInt(c.Param("eid"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	var providerType int64
	if strings.Contains(c.Request.URL.Path, "/api/callback/cozecn/auth/") {
		providerType = int64(model.ProviderTypeCozeCn)
	} else if strings.Contains(c.Request.URL.Path, "/api/callback/cozecom/auth/") {
		providerType = int64(model.ProviderTypeCozeCom)
	} else {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("invalid path")))
		return
	}
	var req CozeCallbackRequest
	if err := c.ShouldBindQuery(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// Try to parse provider_id from query parameter or state parameter
	// State parameter format might be: "provider_id=123" or just the provider_id
	var providerID int64 = 0
	if providerIDStr := c.Query("provider_id"); providerIDStr != "" {
		providerID, _ = strconv.ParseInt(providerIDStr, 10, 64)
	} else if strings.Contains(req.State, "provider_id=") {
		// Extract provider_id from state parameter
		parts := strings.Split(req.State, "provider_id=")
		if len(parts) > 1 {
			providerIDStr := strings.Split(parts[1], "&")[0] // Get first part before any other parameters
			providerID, _ = strconv.ParseInt(providerIDStr, 10, 64)
		}
	}

	provider, err := model.GetProviderByEidAndProviderTypeWithOptionalID(eid, providerType, providerID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.NotFound.ToResponse(err))
		return
	}

	// Determine scheme based on TLS or forwarded headers
	// 这里还是恢复回这个判断，因为这样才兼容http和https，不过注意nginx返向代理一定要配置原始协议转发过来（如下）
	// proxy_set_header X-Real-IP $remote_addr;
	// proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
	// proxy_set_header X-Forwarded-Proto $scheme;  # 关键配置：传递原始协议
	// proxy_set_header X-Forwarded-Protocol $scheme;
	// proxy_set_header X-Url-Scheme $scheme;
	scheme := "http"
	if c.Request.TLS != nil ||
		strings.ToLower(c.Request.Header.Get("X-Forwarded-Proto")) == "https" ||
		strings.ToLower(c.Request.Header.Get("X-Forwarded-Protocol")) == "https" ||
		strings.ToLower(c.Request.Header.Get("X-Forwarded-Ssl")) == "on" ||
		strings.ToLower(c.Request.Header.Get("X-Url-Scheme")) == "https" ||
		c.Request.Header.Get("X-Forwarded-Port") == "443" {
		scheme = "https"
	}

	// Build callback URL with proper host (including port if non-standard)
	callbackUrl := scheme + "://" + c.Request.Host + c.Request.URL.Path
	ser := service.CozeService{
		Provider: provider,
	}

	logger.SysLogf("callbackUrl: %v", callbackUrl)
	if err := ser.HandlerAccessTokenByCode(req.Code, callbackUrl); err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	// Get all workspaces and bots
	workspaces, err := ser.GetAllWorkspace()
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	// Collect all bot IDs
	var botIds []string
	for _, workspace := range workspaces {
		bots, err := ser.GetAllBot(workspace.ID)
		if err != nil {
			continue
		}
		for _, bot := range bots {
			botIds = append(botIds, "bot-"+bot.BotID)
		}
	}
	// todo Call interface user ID all use the same
	configStr := `{"region":"","sk":"","ak":"","user_id":"53AIHub","vertex_ai_project_id":"","vertex_ai_adc":""}`
	// Create or update channel record
	baseURL := provider.GetBaseURLByProviderType()
	channel := &model.Channel{
		Eid:        eid,
		Name:       ser.Provider.Name,
		Key:        ser.Provider.AccessToken,
		Type:       channeltype.Coze,
		ProviderID: ser.Provider.ProviderID,
		BaseURL:    &baseURL, // Fix: assign address of baseURL since Channel.BaseURL is *string
		Models:     strings.Join(botIds, ","),
		Status:     model.ChannelStatusEnabled,
		Config:     configStr,
	}

	existingChannel, err := model.GetFirstChannelByEidAndProviderId(channel.Eid, channel.ProviderID)
	if err != nil {
		// Create new record
		if err := model.CreateChannel(channel); err != nil {
			c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
			return
		}
	} else {
		// Update existing record
		channel.ChannelID = existingChannel.ChannelID
		if err := model.UpdateChannel(channel); err != nil {
			c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
			return
		}
	}
	var domain string

	if config.IS_SAAS {
		domain = os.Getenv("DOMAIN")
		if domain == "" {
			domain = "kmmix.53ai.com"
		}
	} else {
		// Redirect to frontend page
		domain = c.Request.Host

	}
	redirectURL := fmt.Sprintf(scheme+"://%s/console/?is_authorized=%t&provider_id=%d&provider_type=%d",
		domain, provider.IsAuthorized, provider.ProviderID, provider.ProviderType)

	c.Redirect(http.StatusFound, redirectURL)

	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}
