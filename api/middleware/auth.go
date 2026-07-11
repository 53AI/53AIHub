package middleware

import (
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/session"
	"github.com/53AI/53AIHub/common/utils/jwt"
	"github.com/53AI/53AIHub/model"
	"github.com/gin-gonic/gin"
)

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
		user, tokenEid, err := HandleAnyTokenAuth(token, role)
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
		c.Next()
	}
}

func HandleAnyTokenAuth(token string, role int64) (user *model.User, tokenEid int64, err error) {
	user, tokenEid, err = HandleTokenAuth(token, role)
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
		user, tokenEid, err := HandleAnyTokenAuth(token, model.RoleCommonUser)
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

func HandleTokenAuth(token string, role int64) (user *model.User, tokenEid int64, err error) {
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

	user = model.ValidateAccessToken(token)
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
