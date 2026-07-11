package middleware

import (
	"fmt"

	"github.com/53AI/53AIHub/common/ctxkey"
	"github.com/53AI/53AIHub/model"
	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/relay/channeltype"
)

type ModelRequest struct {
	Model string `json:"model" form:"model"`
}

func SetupContextForSelectedChannel(c *gin.Context, channel *model.Channel, modelName string) {
	c.Set(ctxkey.Channel, channel.Type)
	c.Set(ctxkey.ChannelId, channel.ChannelID)
	c.Set(ctxkey.ChannelName, channel.Name)
	c.Set(ctxkey.SelectedChannel, channel)
	// if channel.SystemPrompt != nil && *channel.SystemPrompt != "" {
	// 	c.Set(ctxkey.SystemPrompt, *channel.SystemPrompt)
	// }
	c.Set(ctxkey.ModelMapping, channel.GetModelMapping())
	c.Set(ctxkey.OriginalModel, modelName) // for retry

	// Check if channel has provider_id and use provider's credentials for coze-studio
	apiKey := channel.Key
	baseURL := channel.GetBaseURL()

	if channel.ProviderID != 0 {
		provider, err := model.GetProviderByID(channel.ProviderID, channel.Eid)
		if err == nil {
			// For coze-studio, use provider's AccessToken and BaseURL
			if provider.ProviderType == model.ProviderTypeCozeStudio {
				apiKey = provider.AccessToken
				if provider.BaseURL != nil && *provider.BaseURL != "" {
					baseURL = *provider.BaseURL
				}
			}
		}
	}

	c.Request.Header.Set("Authorization", fmt.Sprintf("Bearer %s", apiKey))
	c.Set(ctxkey.BaseURL, baseURL)
	cfg, _ := channel.LoadConfig()
	// this is for backward compatibility
	if channel.Other != nil {
		switch channel.Type {
		case channeltype.Azure:
			if cfg.APIVersion == "" {
				cfg.APIVersion = *channel.Other
			}
		case channeltype.Xunfei:
			if cfg.APIVersion == "" {
				cfg.APIVersion = *channel.Other
			}
		case channeltype.Gemini:
			if cfg.APIVersion == "" {
				cfg.APIVersion = *channel.Other
			}
		case channeltype.AIProxyLibrary:
			if cfg.LibraryID == "" {
				cfg.LibraryID = *channel.Other
			}
		case channeltype.Ali:
			if cfg.Plugin == "" {
				cfg.Plugin = *channel.Other
			}
		}
	}
	c.Set(ctxkey.Config, cfg)
}
