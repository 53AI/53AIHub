package service

import (
	"context"
	"fmt"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/coze"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
)

func refreshChannelWithTokenRefresh(ctx context.Context, channel *model.Channel) (*model.Channel, error) {
	if channel == nil {
		return nil, fmt.Errorf("channel is nil")
	}

	isRefreshToken := false
	if channel.ProviderID != 0 {
		provider, err := model.GetProviderByID(channel.ProviderID, channel.Eid)
		if err != nil {
			logger.Errorf(ctx, "refresh token failed: %s", err.Error())
			logger.SysLogf("【cozetoken 刷新】GetProviderByID 失败: provider_id=%d, eid=%d, err=%s",
				channel.ProviderID, channel.Eid, err.Error())
			return nil, err
		}
		checkProviderType := int(provider.ProviderType)
		logger.SysLogf("【cozetoken 刷新】provider 详情: channel_id=%d, provider_id=%d, provider_type=%d, expires_in=%d, authed_time=%d, now=%d, expiry_unix=%d, channel_key_prefix=%s",
			channel.ChannelID, provider.ProviderID, provider.ProviderType,
			provider.ExpiresIn, provider.AuthedTime, time.Now().Unix(),
			coze.GetTokenExpiryUnix(provider),
			provider.AccessToken[:min(len(provider.AccessToken), 10)]+"...")

		switch checkProviderType {
		case model.ProviderTypeCozeCn, model.ProviderTypeCozeCom:
			ser := CozeService{
				Provider: *provider,
			}
			isRefreshToken, err = ser.CheckAndRefreshToken()
			if err != nil {
				logger.Errorf(ctx, "refresh token failed: %s", err.Error())
				return nil, err
			}
			// 刷新后 provider 对象已是最新，但 channel Key 可能未同步
			if channel.Key != ser.Provider.AccessToken {
				channel.Key = ser.Provider.AccessToken
				if updateErr := model.UpdateChannel(channel); updateErr != nil {
					logger.Errorf(ctx, "sync channel key failed: %s", updateErr.Error())
					return nil, updateErr
				}
				logger.SysLogf("channel key synced with provider, channel_id=%d", channel.ChannelID)
				isRefreshToken = true
			}
		case model.ProviderTypeCozeStudio:
			if channel.BaseURL != provider.BaseURL || channel.Key != provider.AccessToken {
				channel.BaseURL = provider.BaseURL
				channel.Key = provider.AccessToken
				isRefreshToken = true
				err = model.UpdateChannel(channel)
				if err != nil {
					logger.Errorf(ctx, "refresh token failed: %s", err.Error())
					return nil, err
				}
			}
		}
	}

	if isRefreshToken {
		updatedChannel, err := model.GetChannelByID(channel.ChannelID)
		if err != nil {
			logger.Errorf(ctx, "refresh token failed: %s", err.Error())
			return nil, err
		}
		logger.SysLogf("channel token update success, channel_id=%d", updatedChannel.ChannelID)
		return updatedChannel, nil
	}

	return channel, nil
}

// GetChannelByIDWithTokenRefresh 获取指定渠道并检查/刷新token（如果需要）
func GetChannelByIDWithTokenRefresh(ctx context.Context, channelID int64) (*model.Channel, error) {
	channel, err := model.GetChannelByID(channelID)
	if err != nil {
		return nil, err
	}
	return refreshChannelWithTokenRefresh(ctx, channel)
}

// GetChannelWithTokenRefresh 获取渠道并检查/刷新token（如果需要 ）
// 这个函数可以被聊天和工作流共同使用
func GetChannelWithTokenRefresh(ctx context.Context, eid int64, channelType int, modelName string, lastFailedChannelId int64) (*model.Channel, error) {
	logger.SysLogf("【cozetoken 刷新】GetChannelWithTokenRefresh 入口: eid=%d, channelType=%d, modelName=%s, lastFailedChannelId=%d",
		eid, channelType, modelName, lastFailedChannelId)

	// 获取重试次数
	retryTimes := config.CHANNEL_RETRY_TIMES

	var lastErr error
	for i := retryTimes; i > 0; i-- {
		// 获取随机渠道
		channel, err := model.GetRandomChannel(eid, channelType, modelName)
		if err != nil {
			logger.SysLogf("【cozetoken 刷新】GetRandomChannel 失败: eid=%d, err=%s", eid, err.Error())
			lastErr = err
			continue
		}

		logger.SysLogf("【cozetoken 刷新】获取到渠道: channel_id=%d, provider_id=%d, key_prefix=%s",
			channel.ChannelID, channel.ProviderID,
			channel.Key[:min(len(channel.Key), 10)]+"...")

		// 避免重复使用上次失败的渠道
		if channel.ChannelID == lastFailedChannelId {
			logger.SysLogf("【cozetoken 刷新】跳过上次失败的渠道: channel_id=%d", channel.ChannelID)
			continue
		}

		// 检查并刷新token（如果需要）
		channel, err = refreshChannelWithTokenRefresh(ctx, channel)
		if err != nil {
			lastErr = err
			continue
		}

		return channel, nil
	}

	return nil, fmt.Errorf("all channels are unavailable, last error: %v", lastErr)
}
