package common

import (
	"context"
	"encoding/json"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
)

// 用户行/群组短时缓存：NewPermissionResolver 每次 3 条 DB 点查改走缓存。
// 正确性靠 model.InvalidateUserCaches 统一入口 0 延迟主动失效，TTL 仅兜底。

const (
	// 行/群组缓存 30min：新鲜度由 InvalidateUserCaches 主动失效保证，TTL 只兜底漏 hook 的未知写路径。
	userRowCacheTTL    = 30 * time.Minute
	userGroupsCacheTTL = 30 * time.Minute
)

// InitUserCaches 注册用户行/群组缓存的主动失效，main.go 调用。
// token 短缓存失效沿用 middleware.InitUserAccessTokenCache。
func InitUserCaches() {
	model.SetUserRowCacheInvalidator(func(ctx context.Context, userID int64) {
		if userID <= 0 || !RedisEnabled {
			return
		}
		if err := RedisDel(GetUserRowCacheKey(userID)); err != nil {
			logger.Warnf(ctx, "【用户缓存】用户%d的用户行缓存：失效失败（%v）", userID, err)
			return
		}
		logger.Infof(ctx, "【用户缓存】用户%d的用户行缓存：已失效（资料变更主动清理）", userID)
	})
	model.SetUserGroupsCacheInvalidator(func(ctx context.Context, eid, userID int64) {
		if userID <= 0 || !RedisEnabled {
			return
		}
		if err := RedisDel(GetUserGroupsCacheKey(eid, userID)); err != nil {
			logger.Warnf(ctx, "【用户缓存】用户%d（企业%d）的群组缓存：失效失败（%v）", userID, eid, err)
			return
		}
		logger.Infof(ctx, "【用户缓存】用户%d（企业%d）的群组缓存：已失效（分组变更主动清理）", userID, eid)
	})
}

// getCachedUserByID 读用户行短时缓存：未命中回源 model.GetUserByID 并回填。
func getCachedUserByID(ctx context.Context, userID int64) (*model.User, error) {
	if userID > 0 && RedisEnabled {
		if raw, err := RedisGetWithCtx(ctx, GetUserRowCacheKey(userID)); err == nil && raw != "" {
			var user model.User
			if err := json.Unmarshal([]byte(raw), &user); err == nil && user.UserID == userID {
				logger.Infof(ctx, "【用户缓存】用户%d的用户行缓存：命中", userID)
				return &user, nil
			}
		}
		logger.Infof(ctx, "【用户缓存】用户%d的用户行缓存：未命中（回源数据库）", userID)
	}
	user, err := model.GetUserByID(userID, ctx)
	if err != nil || user == nil {
		return user, err
	}
	if RedisEnabled {
		if raw, err := json.Marshal(user); err == nil {
			_ = RedisSetWithCtx(ctx, GetUserRowCacheKey(userID), string(raw), userRowCacheTTL)
		}
	}
	return user, nil
}

// getCachedUserGroupIDs 读用户群组短时缓存：未命中回源并回填。
// Registered 用户直接取行内 GroupId，不进缓存（无 DB 开销）。
func getCachedUserGroupIDs(ctx context.Context, user *model.User) ([]int64, error) {
	if user.Type == model.UserTypeRegistered || user.UserID <= 0 || !RedisEnabled {
		return user.GetUserGroupIds(ctx)
	}
	key := GetUserGroupsCacheKey(user.Eid, user.UserID)
	if raw, err := RedisGetWithCtx(ctx, key); err == nil && raw != "" {
		var groupIDs []int64
		if err := json.Unmarshal([]byte(raw), &groupIDs); err == nil {
			logger.Infof(ctx, "【用户缓存】用户%d（企业%d）的群组缓存：命中（%d个群组）", user.UserID, user.Eid, len(groupIDs))
			return groupIDs, nil
		}
	}
	logger.Infof(ctx, "【用户缓存】用户%d（企业%d）的群组缓存：未命中（回源数据库）", user.UserID, user.Eid)
	groupIDs, err := user.GetUserGroupIds(ctx)
	if err != nil {
		return nil, err
	}
	if raw, err := json.Marshal(groupIDs); err == nil {
		_ = RedisSetWithCtx(ctx, key, string(raw), userGroupsCacheTTL)
	}
	return groupIDs, nil
}
