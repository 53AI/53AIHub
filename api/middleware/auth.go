package middleware

import (
	"errors"
	"fmt"
	"net/http"
	"strings"

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
			c.JSON(http.StatusUnauthorized, model.UnauthorizedError.ToResponse(nil))
			c.Abort()
			return
		}
		user, tokenEid, err := HandleAnyTokenAuth(token, role)
		if err != nil {
			switch err.Error() {
			case "token is expired":
				c.JSON(http.StatusUnauthorized, model.TokenExpiredError.ToResponse(nil))
			case "token has invalid claims", "forbidden access":
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

	channelUser, _, _, channelErr := model.ValidateUserChannelToken(token)
	if channelErr != nil {
		switch {
		case errors.Is(channelErr, model.ErrUserChannelTokenExpired):
			return nil, 0, errors.New("token is expired")
		case errors.Is(channelErr, model.ErrUserChannelTokenNotFound):
			return nil, 0, fmt.Errorf("user channel token not found: %w", channelErr)
		case errors.Is(channelErr, model.ErrUserChannelNotFound):
			return nil, 0, fmt.Errorf("user channel not found: %w", channelErr)
		default:
			return nil, 0, fmt.Errorf("user channel token validation failed: %w", channelErr)
		}
	}

	if channelUser == nil {
		return nil, 0, errors.New("unauthorized access")
	}
	if channelUser.Status == model.UserStatusDisabled {
		return nil, 0, errors.New("forbidden access")
	}
	if role > 0 && channelUser.Role < role {
		return nil, 0, errors.New("forbidden access")
	}

	return channelUser, channelUser.Eid, nil
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
		return nil, 0, errors.New("not found")
	}

	if user.Status == model.UserStatusDisabled {
		return nil, 0, errors.New("forbidden access")
	}

	if role > 0 && user.Role < role {
		return nil, 0, errors.New("forbidden access")
	}

	return user, tokenEid, nil
}
