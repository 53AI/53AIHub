package tasks

import (
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
)

// StartChannelUpdateKeyTask starts the channel key update task
// Executes immediately once, and then every 8 hours
func StartChannelUpdateKeyTask() {
	go func() {
		// Execute immediately once
		updateCozeProviderKeys()

		// Set to execute every 8 hours
		ticker := time.NewTicker(8 * time.Hour)
		defer ticker.Stop()

		for range ticker.C {
			updateCozeProviderKeys()
		}
	}()
	logger.SysLog("Channel key update task started, executing immediately once, then every 8 hours")
}

// updateCozeProviderKeys refreshes tokens for all authorized Coze providers (CozeCn + CozeCom)
func updateCozeProviderKeys() {
	// Get all authorized providers with provider_type = 1 (CozeCn) or 2 (CozeCom)
	providersCn, err := model.GetProvidersByTypeAndAuthStatus(model.ProviderTypeCozeCn, true)
	if err != nil {
		logger.SysError("Failed to get authorized CozeCn providers: " + err.Error())
		return
	}
	providersCom, err := model.GetProvidersByTypeAndAuthStatus(model.ProviderTypeCozeCom, true)
	if err != nil {
		logger.SysError("Failed to get authorized CozeCom providers: " + err.Error())
		return
	}
	providers := append(providersCn, providersCom...)

	if len(providers) == 0 {
		logger.Debug(nil, "No authorized Coze providers found")
		return
	}

	successCount := 0
	failCount := 0

	// Process each provider
	for _, provider := range providers {
		// Skip coze-studio providers as they use fixed AccessToken
		if provider.ProviderType == model.ProviderTypeCozeStudio {
			logger.SysLogf("【cozetoken 刷新】定时任务跳过 coze-studio: %d name: %s", provider.ProviderID, provider.Name)
			continue
		}

		logger.SysLogf("【cozetoken 刷新】定时任务开始刷新: %d name: %s, expires_in=%d, authed_time=%d, fail_count=%d",
			provider.ProviderID, provider.Name, provider.ExpiresIn, provider.AuthedTime, provider.TokenRefreshFailCount)

		// Create service instance
		ser := service.CozeService{
			Provider: provider,
		}

		// 统一使用 CheckAndRefreshToken，与聊天入口路径一致（含过期检查 + 分布式锁）
		_, err := ser.CheckAndRefreshToken()
		if err != nil {
			logger.SysErrorf("【cozetoken 刷新】定时任务刷新失败: %d error: %v", provider.ProviderID, err)
			failCount++
			// Increment fail count; if reaches 3, mark as unauthorized and skip future refreshes
			newFailCount := provider.TokenRefreshFailCount + 1
			if newFailCount >= 3 {
				logger.SysErrorf("【cozetoken 刷新】provider %d 连续失败 %d 次，标记为未授权，后续不再自动刷新", provider.ProviderID, newFailCount)
				model.DB.Model(&model.Provider{}).
					Where("provider_id = ?", provider.ProviderID).
					Updates(map[string]interface{}{
						"is_authorized":            false,
						"token_refresh_fail_count": newFailCount,
					})
			} else {
				model.DB.Model(&model.Provider{}).
					Where("provider_id = ?", provider.ProviderID).
					Update("token_refresh_fail_count", newFailCount)
			}
			continue
		}
		// Reset fail count on success
		if provider.TokenRefreshFailCount > 0 {
			model.DB.Model(&model.Provider{}).
				Where("provider_id = ?", provider.ProviderID).
				Update("token_refresh_fail_count", 0)
		}
		logger.SysLogf("【cozetoken 刷新】定时任务刷新成功: %d name: %s", provider.ProviderID, provider.Name)
		successCount++
	}

	logger.SysLogf("Channel key update completed. Success: %d Failed: %d", successCount, failCount)
}
