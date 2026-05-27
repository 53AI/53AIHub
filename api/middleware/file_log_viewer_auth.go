package middleware

import (
	"net/http"
	"strings"

	"github.com/53AI/53AIHub/common/session"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/gin-gonic/gin"
)

func tokenFromAuthorization(header string) string {
	header = strings.TrimSpace(header)
	if header == "" {
		return ""
	}
	parts := strings.Fields(header)
	if len(parts) == 2 && strings.EqualFold(parts[0], "Bearer") {
		return strings.TrimSpace(parts[1])
	}
	if len(parts) == 1 {
		return strings.TrimSpace(parts[0])
	}
	return ""
}

func extractFileLogViewerToken(c *gin.Context) string {
	candidates := []string{
		tokenFromAuthorization(c.GetHeader("Authorization")),
		strings.TrimSpace(c.GetHeader("X-Access-Token")),
		strings.TrimSpace(c.Query("access_token")),
		strings.TrimSpace(c.Query("accessToken")),
		strings.TrimSpace(c.Query("token")),
	}
	for _, t := range candidates {
		if t != "" {
			return t
		}
	}
	return ""
}

// FileLogViewerAuth 仅支持 ENV 中配置的全局日志查看 token（FILE_LOG_VIEWER_ACCESS_TOKEN）。
// 该接口用于运维日志检索，不走普通管理员账号鉴权。
func FileLogViewerAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		globalToken := strings.TrimSpace(config.FILE_LOG_VIEWER_ACCESS_TOKEN)
		if globalToken == "" {
			c.JSON(http.StatusUnauthorized, model.ForbiddenError.ToResponse(nil))
			c.Abort()
			return
		}

		token := extractFileLogViewerToken(c)
		if token == "" {
			c.JSON(http.StatusUnauthorized, model.UnauthorizedError.ToResponse(nil))
			c.Abort()
			return
		}

		if token == globalToken {
			// 全局 token 不绑定具体用户，按管理员能力放行日志接口。
			c.Set(session.SESSION_USER_ID, int64(0))
			c.Set(session.SESSION_USER_NICKNAME, "log-viewer")
			c.Set(session.SESSION_USER_ROLE, model.RoleAdminUser)
			c.Set(session.ENV_EID, int64(0))
			c.Set(session.SESSION_SAAS_USER, false)
			c.Next()
			return
		}
		c.JSON(http.StatusUnauthorized, model.ForbiddenError.ToResponse(nil))
		c.Abort()
	}
}
