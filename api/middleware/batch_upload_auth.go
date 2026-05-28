package middleware

import (
	"net/http"
	"strings"

	"github.com/53AI/53AIHub/common/utils/jwt"
	"github.com/53AI/53AIHub/model"
	"github.com/gin-gonic/gin"
)

// BatchUploadAuth 仅用于批量上传相关接口。
// 它同时接受普通登录 JWT、channel token（如 SSO 登录发放的 token）和 MCP 换发的短期委派 token。
func BatchUploadAuth(role int64) gin.HandlerFunc {
	return func(c *gin.Context) {
		token := tokenFromAuthorization(c.GetHeader("Authorization"))
		if token == "" {
			c.JSON(http.StatusUnauthorized, model.UnauthorizedError.ToResponse(nil))
			c.Abort()
			return
		}

		if user, tokenEid, err := HandleTokenAuth(token, role); err == nil {
			setUserSession(c, user, tokenEid)
			c.Next()
			return
		}

		// 也支持 channel token（如 SSO 登录发放的 token）
		if channelUser, _, _, channelErr := model.ValidateUserChannelToken(token); channelErr == nil {
			if channelUser == nil || channelUser.Status == model.UserStatusDisabled {
				c.JSON(http.StatusUnauthorized, model.ForbiddenError.ToResponse(nil))
				c.Abort()
				return
			}
			if role > 0 && channelUser.Role < role {
				c.JSON(http.StatusUnauthorized, model.ForbiddenError.ToResponse(nil))
				c.Abort()
				return
			}
			setUserSession(c, channelUser, channelUser.Eid)
			c.Next()
			return
		}

		claims, err := jwt.ParseUploadDelegateJWT(token)
		if err != nil {
			if strings.Contains(err.Error(), "token is expired") {
				c.JSON(http.StatusUnauthorized, model.TokenExpiredError.ToResponse(nil))
			} else if strings.Contains(err.Error(), "token has invalid claims") || strings.Contains(err.Error(), "signature") {
				c.JSON(http.StatusUnauthorized, model.ForbiddenError.ToResponse(nil))
			} else {
				c.JSON(http.StatusUnauthorized, model.UnauthorizedError.ToResponse(nil))
			}
			c.Abort()
			return
		}

		if claims.Scope != jwt.UploadDelegateScopeBatch {
			c.JSON(http.StatusUnauthorized, model.ForbiddenError.ToResponse(nil))
			c.Abort()
			return
		}

		user, err := model.GetUserByID(claims.UserID)
		if err != nil || user == nil {
			c.JSON(http.StatusUnauthorized, model.ForbiddenError.ToResponse(nil))
			c.Abort()
			return
		}
		if user.Status == model.UserStatusDisabled {
			c.JSON(http.StatusUnauthorized, model.ForbiddenError.ToResponse(nil))
			c.Abort()
			return
		}
		if role > 0 && user.Role < role {
			c.JSON(http.StatusUnauthorized, model.ForbiddenError.ToResponse(nil))
			c.Abort()
			return
		}
		if user.Eid != claims.Eid {
			c.JSON(http.StatusUnauthorized, model.ForbiddenError.ToResponse(nil))
			c.Abort()
			return
		}

		apiKey, err := model.GetAPIKeyByID(claims.APIKeyID)
		if err != nil || apiKey == nil || apiKey.Status != model.APIKeyStatusActive {
			c.JSON(http.StatusUnauthorized, model.ForbiddenError.ToResponse(nil))
			c.Abort()
			return
		}
		if apiKey.Eid != claims.Eid || apiKey.CreatorID != claims.UserID {
			c.JSON(http.StatusUnauthorized, model.ForbiddenError.ToResponse(nil))
			c.Abort()
			return
		}

		setUserSession(c, user, claims.Eid)
		c.Next()
	}
}
