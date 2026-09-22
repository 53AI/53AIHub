package model

import "context"

// 用户相关缓存统一失效入口：调用方只调 InvalidateUserCaches 一行。
// model 不能直接依赖 common（循环），失效函数由缓存持有方注册，沿用
// capability 快照 / access_token 短缓存的注册范式。失效日志由注册闭包
// 在持有层打（带请求 ctx），model 层不打日志。

var (
	userRowCacheInvalidator    func(ctx context.Context, userID int64)
	userGroupsCacheInvalidator func(ctx context.Context, eid, userID int64)
)

// SetUserRowCacheInvalidator 注册用户行缓存失效函数，幂等覆盖。
func SetUserRowCacheInvalidator(fn func(ctx context.Context, userID int64)) {
	userRowCacheInvalidator = fn
}

// SetUserGroupsCacheInvalidator 注册用户群组缓存失效函数，幂等覆盖。
func SetUserGroupsCacheInvalidator(fn func(ctx context.Context, eid, userID int64)) {
	userGroupsCacheInvalidator = fn
}

// InvalidateUserCaches 删掉一个用户相关的全部缓存：用户行 + 群组 + token。
// 所有用户写点只调这一行即 0 延迟；accessTokens 为该用户已知 token（可为空，
// 为空时 token 缓存走 TTL 兜底）。ctx 仅用于失效日志归因，无 ctx 时传
// context.Background()。
func InvalidateUserCaches(eid, userID int64, ctx context.Context, accessTokens ...string) {
	if ctx == nil {
		ctx = context.Background()
	}
	if userRowCacheInvalidator != nil {
		userRowCacheInvalidator(ctx, userID)
	}
	if userGroupsCacheInvalidator != nil {
		userGroupsCacheInvalidator(ctx, eid, userID)
	}
	for _, token := range accessTokens {
		invalidateUserAccessTokenCache(ctx, token)
	}
}
