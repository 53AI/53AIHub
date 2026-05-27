package service

import (
	"context"
	"fmt"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
)

// GetChannelWithTokenRefresh 获取渠道并检查/刷新token（如果需要 ）
// 这个函数可以被聊天和工作流共同使用
func GetChannelWithTokenRefresh(ctx context.Context, eid int64, channelType int, modelName string, lastFailedChannelId int64) (*model.Channel, error) {
	// 获取重试次数
	retryTimes := config.CHANNEL_RETRY_TIMES

	var lastErr error
	for i := retryTimes; i > 0; i-- {
		// 获取随机渠道
		channel, err := model.GetRandomChannel(eid, channelType, modelName)
		if err != nil {
			lastErr = err
			continue
		}

		// 避免重复使用上次失败的渠道
		if channel.ChannelID == lastFailedChannelId {
			continue
		}

		// 检查并刷新token（如果需要）
		isRefreshToken := false
		if channel.ProviderID != 0 {
			provider, err := model.GetProviderByID(channel.ProviderID, channel.Eid)
			if err != nil {
				logger.Errorf(ctx, "refresh token failed: %s", err.Error())
				continue
			}
			checkProviderType := int(provider.ProviderType)

			switch checkProviderType {
			case model.ProviderTypeCozeCn, model.ProviderTypeCozeCom:
				ser := CozeService{
					Provider: *provider,
				}
				isRefreshToken, err = ser.CheckAndRefreshToken()
				if err != nil {
					logger.Errorf(ctx, "refresh token failed: %s", err.Error())
					continue
				}
			case model.ProviderTypeCozeStudio:
				if channel.BaseURL != provider.BaseURL || channel.Key != provider.AccessToken {
					channel.BaseURL = provider.BaseURL
					channel.Key = provider.AccessToken
					isRefreshToken = true
					err = model.UpdateChannel(channel)
				}
			}
		}

		// 如果token被刷新，更新渠道信息
		if isRefreshToken {
			// update channel key
			channel, err = model.GetChannelByID(channel.ChannelID)
			if err != nil {
				logger.Errorf(ctx, "refresh token failed: %s", err.Error())
				continue
			}
			logger.SysLogf("channel token update success, channel_id=%d", channel.ChannelID)
		}

		return channel, nil
	}

	return nil, fmt.Errorf("all channels are unavailable, last error: %v", lastErr)
}
