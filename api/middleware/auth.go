package middleware

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/session"
	"github.com/53AI/53AIHub/common/utils/jwt"
	"github.com/53AI/53AIHub/model"
	"github.com/gin-gonic/gin"
)

// userAccessTokenCacheTTL 是 access_token 短时缓存 TTL：每次请求一次 DB 点查改走缓存。
// 正确性靠 model.InvalidateUserCaches 统一入口 0 延迟主动失效（轮换/登出/禁用/改角色/
// 删用户/群组变更全覆盖），TTL 仅兜底未埋点路径。
const userAccessTokenCacheTTL = 120 * time.Second

// InitUserAccessTokenCache 注册 access_token 短时缓存的主动失效，main.go 调用。
func InitUserAccessTokenCache() {
	model.SetUserAccessTokenCacheInvalidator(func(ctx context.Context, token string) {
		if token == "" || !common.RedisEnabled {
			return
		}
		if err := common.RedisDel(common.GetUserAccessTokenCacheKey(token)); err != nil {
			logger.Warnf(ctx, "【用户缓存】access_token 短缓存：失效失败（%v）", err)
			return
		}
		logger.Infof(ctx, "【用户缓存】access_token 短缓存：已失效（token 轮换/登出主动清理）")
	})
}

// getCachedTokenUser 读 access_token 短时缓存：命中且 token/用户一致才返回。
// 缓存存的是登录时刻的 User 全量 JSON；校验 AccessToken 字段防哈希碰撞串户。
func getCachedTokenUser(ctx context.Context, token string) *model.User {
	if token == "" || !common.RedisEnabled {
		return nil
	}
	raw, err := common.RedisGetWithCtx(ctx, common.GetUserAccessTokenCacheKey(token))
	if err != nil || raw == "" {
		return nil
	}
	var user model.User
	if err := json.Unmarshal([]byte(raw), &user); err != nil {
		return nil
	}
	if user.UserID <= 0 || user.AccessToken != token {
		return nil
	}
	return &user
}

// setCachedTokenUser 写 access_token 短时缓存：失败只丢缓存（miss 回源），不影响鉴权。
func setCachedTokenUser(ctx context.Context, token string, user *model.User) {
	if token == "" || user == nil || user.UserID <= 0 || !common.RedisEnabled {
		return
	}
	raw, err := json.Marshal(user)
	if err != nil {
		return
	}
	_ = common.RedisSetWithCtx(ctx, common.GetUserAccessTokenCacheKey(token), string(raw), userAccessTokenCacheTTL)
}

func authRequestContext(ctxs []context.Context) context.Context {
	if len(ctxs) > 0 && ctxs[0] != nil {
		return ctxs[0]
	}
	return context.Background()
}

func UserTokenAuth(role int64) func(c *gin.Context) {
	return func(c *gin.Context) {
		token := c.Request.Header.Get("Authorization")
		token = strings.Replace(token, "Bearer ", "", 1)
		if token == "" {
			token = c.Query("access_token")
		}
		if token == "" {
			c.JSON(http.StatusUnauthorized, model.UnauthorizedError.ToResponse(nil))
			c.Abort()
			return
		}
		user, tokenEid, err := HandleAnyTokenAuth(token, role, c.Request.Context())
		if err != nil {
			logger.SysDebugf("auth denied: token_prefix=%s required_role=%d err=%v", tokenPrefix(token), role, err)
			switch err.Error() {
			case "token is expired":
				c.JSON(http.StatusUnauthorized, model.TokenExpiredError.ToResponse(nil))
			case "token has invalid claims":
				c.JSON(http.StatusUnauthorized, model.ForbiddenError.ToResponse(nil))
			case "user is disabled":
				c.JSON(http.StatusForbidden, model.CommonResponse{
					Code:    int(model.ForbiddenError),
					Message: "账户已被禁用",
					Data:    nil,
				})
			case "forbidden access":
				c.JSON(http.StatusUnauthorized, model.ForbiddenError.ToResponse(nil))
			default:
				c.JSON(http.StatusUnauthorized, model.UnauthorizedError.ToResponse(nil))
			}

			c.Abort()
			return
		}

		setUserSession(c, user, tokenEid)
		// 更新最后活跃时间（4 小时窗口，避免频繁写 DB）
		tryUpdateLastActive(user)

		c.Next()
	}
}

// RequireSettingKeyAuth 设置 key 查询鉴权：白名单 key（model.IsPublicSettingKey）免登录
// 直接放行（如密码安全策略，登录页未登录时读取）；其余 key 走 UserTokenAuth(RoleGuestUser)。
func RequireSettingKeyAuth() gin.HandlerFunc {
	guestAuth := UserTokenAuth(model.RoleGuestUser)
	return func(c *gin.Context) {
		if model.IsPublicSettingKey(c.Param("key")) {
			c.Next()
			return
		}
		guestAuth(c)
	}
}

func HandleAnyTokenAuth(token string, role int64, ctxs ...context.Context) (user *model.User, tokenEid int64, err error) {
	user, tokenEid, err = HandleTokenAuth(token, role, ctxs...)
	if err == nil {
		return user, tokenEid, nil
	}
	if err.Error() == "user is disabled" {
		return nil, 0, errors.New("user is disabled")
	}

	channelUser, _, _, channelErr := model.ValidateUserChannelToken(token)
	if channelErr != nil {
		logger.SysDebugf("auth channel token validation failed: token_prefix=%s required_role=%d err=%v", tokenPrefix(token), role, channelErr)
		if errors.Is(channelErr, model.ErrUserDisabled) {
			return nil, 0, errors.New("user is disabled")
		}
		return nil, 0, fmt.Errorf("handle_token_err=%v; channel_token_err=%w", err, channelErr)
	}

	logger.SysDebugf("auth channel token validated: user_id=%d role=%d eid=%d required_role=%d", channelUser.UserID, channelUser.Role, channelUser.Eid, role)
	if channelUser == nil {
		return nil, 0, errors.New("unauthorized access")
	}
	if channelUser.Status == model.UserStatusDisabled {
		return nil, 0, errors.New("user is disabled")
	}
	if role > 0 && channelUser.Role < role {
		return nil, 0, errors.New("forbidden access")
	}

	return channelUser, channelUser.Eid, nil
}

func tokenPrefix(token string) string {
	if len(token) > 8 {
		return token[:8]
	}
	if len(token) > 0 {
		return token
	}
	return ""
}

func OptionalUserTokenAuth() func(c *gin.Context) {
	return func(c *gin.Context) {
		token := c.Request.Header.Get("Authorization")
		token = strings.Replace(token, "Bearer ", "", 1)
		if token == "" {
			token = c.Query("access_token")
		}
		if token == "" {
			c.Next()
			return
		}
		user, tokenEid, err := HandleAnyTokenAuth(token, model.RoleCommonUser, c.Request.Context())
		if err != nil {
			c.Next()
			return
		}
		setUserSession(c, user, tokenEid)
		c.Next()
	}
}

func setUserSession(c *gin.Context, user *model.User, tokenEid int64) {
	if c == nil || user == nil {
		return
	}
	c.Set(session.SESSION_USER_ID, user.UserID)
	c.Set(session.SESSION_USER_NICKNAME, user.Nickname)
	c.Set(session.SESSION_USER_ROLE, user.Role)
	c.Set(session.SESSION_USER_GROUP_ID, user.GroupId)
	c.Set(session.ENV_EID, tokenEid)
	c.Set(session.SESSION_SAAS_USER, false)
}

func HandleTokenAuth(token string, role int64, ctxs ...context.Context) (user *model.User, tokenEid int64, err error) {
	user_id, tokenEid, err := jwt.UserParseJWT(token)
	if err != nil {
		logger.SysDebugf("auth jwt parse failed: token_prefix=%s required_role=%d err=%v", tokenPrefix(token), role, err)
		if strings.Contains(err.Error(), "token is expired") {
			return nil, 0, errors.New("token is expired")
		} else if strings.Contains(err.Error(), "token has invalid claims") {
			return nil, 0, errors.New("token has invalid claims")
		} else {
			return nil, 0, errors.New("unauthorized access")
		}
	}

	reqCtx := authRequestContext(ctxs)
	if cached := getCachedTokenUser(reqCtx, token); cached != nil && cached.UserID == user_id {
		user = cached
	} else {
		user = model.ValidateAccessToken(token, ctxs...)
		setCachedTokenUser(reqCtx, token, user)
	}
	if user == nil || user.UserID != user_id {
		logger.SysDebugf("auth access token validation failed: token_prefix=%s jwt_user_id=%d required_role=%d", tokenPrefix(token), user_id, role)
		return nil, 0, errors.New("not found")
	}

	if user.Status == model.UserStatusDisabled {
		return nil, 0, errors.New("user is disabled")
	}

	if role > 0 && user.Role < role {
		logger.SysDebugf("auth role check failed: user_id=%d user_role=%d required_role=%d", user.UserID, user.Role, role)
		return nil, 0, errors.New("forbidden access")
	}

	return user, tokenEid, nil
}

// tryUpdateLastActive 更新用户最后活跃时间，4 小时窗口避免频繁写 DB
func tryUpdateLastActive(user *model.User) {
	if user == nil {
		return
	}
	now := time.Now().UTC().UnixMilli()
	if now-user.LastLoginTime < 4*time.Hour.Milliseconds() {
		return
	}
	user.LastLoginTime = now
	model.DB.Model(user).Update("last_login_time", now)
}
