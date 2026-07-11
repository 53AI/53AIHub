package middleware

import (
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/session"
	"github.com/53AI/53AIHub/common/utils/helper"
	"github.com/53AI/53AIHub/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func AgentAPIAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		token := c.Request.Header.Get("Authorization")
		token = strings.TrimPrefix(token, "Bearer ")

		if token == "" {
			token = c.Request.Header.Get("X-API-Key")
		}

		if token == "" {
			c.JSON(http.StatusUnauthorized, model.UnauthorizedError.ToOpenAIErrorResponeWithType(nil, "invalid_request_error"))
			c.Abort()
			return
		}

		key, err := model.ValidateAgentAccessKey(token)
		if err != nil {
			c.JSON(http.StatusUnauthorized, model.UnauthorizedError.ToOpenAIErrorResponeWithType(err, "invalid_api_key"))
			c.Abort()
			return
		}

		if key.Source != model.SourceAPI {
			c.JSON(http.StatusForbidden, model.ForbiddenError.ToOpenAIErrorResponeWithType(nil, "permission_error"))
			c.Abort()
			return
		}

		agent, err := model.GetAgentByID(key.Eid, key.AgentID)
		if err != nil {
			c.JSON(http.StatusNotFound, model.NotFound.ToOpenAIErrorRespone("Agent not found"))
			c.Abort()
			return
		}

		if agent.Model == "" {
			c.JSON(http.StatusBadRequest, model.ParamError.ToOpenAIErrorResponeWithType("Agent has no model configured", "invalid_request_error"))
			c.Abort()
			return
		}

		logger.Infof(c.Request.Context(), "【Agent API】加载 agent 成功: agent_id=%d, model=%s, channel_type=%d, specific_channel_id=%d", agent.AgentID, agent.Model, agent.ChannelType, agent.SpecificChannelID)

		if agent.SpecificChannelID <= 0 {
			if agentModels, err := model.GetAgentModelsByAgentID(agent.Eid, agent.AgentID); err == nil && len(agentModels) > 0 {
				agentModel := agentModels[0]
				agent.ChannelType = agentModel.ChannelType
				agent.Model = agentModel.Model
				agent.SpecificChannelID = agentModel.ChannelID
				logger.Infof(c.Request.Context(), "【Agent API】使用 agent_model 配置: agent_id=%d, model=%s, channel_type=%d, channel_id=%d", agent.AgentID, agent.Model, agent.ChannelType, agent.SpecificChannelID)
			} else {
				logger.Warnf(c.Request.Context(), "【Agent API】SpecificChannelID<=0 且未找到 agent_model: agent_id=%d, err=%v", agent.AgentID, err)
				var firstChannel model.Channel
				if dbErr := model.DB.Where("eid = ? AND type = ? AND status = ? AND models LIKE ?", agent.Eid, agent.ChannelType, model.ChannelStatusEnabled, "%"+agent.Model+"%").Order("channel_id ASC").Limit(1).First(&firstChannel).Error; dbErr == nil && firstChannel.ChannelID > 0 {
					agent.SpecificChannelID = firstChannel.ChannelID
					logger.Infof(c.Request.Context(), "【Agent API】回退到首个匹配渠道: agent_id=%d, channel_id=%d, channel_type=%d, model=%s", agent.AgentID, firstChannel.ChannelID, firstChannel.Type, agent.Model)
				} else {
					logger.Warnf(c.Request.Context(), "【Agent API】未找到匹配渠道: agent_id=%d, channel_type=%d, model=%s, err=%v", agent.AgentID, agent.ChannelType, agent.Model, dbErr)
				}
			}
		} else {
			logger.Infof(c.Request.Context(), "【Agent API】使用 agent 默认渠道: agent_id=%d, channel_id=%d", agent.AgentID, agent.SpecificChannelID)
		}

		visitorUsername := fmt.Sprintf("api_visitor_%d", key.AgentID)
		visitorUser, err := model.GetUserByUserName(key.Eid, visitorUsername)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				visitorUser = &model.User{
					Eid:      key.Eid,
					Username: visitorUsername,
					Nickname: fmt.Sprintf("API_Agent_%d", key.AgentID),
					Role:     model.RoleGuestUser,
					Status:   model.UserStatusJoined,
					Type:     model.UserTypeVisitor,
					Password: "",
					Salt:     helper.RandomString(6),
				}
				if err := model.DB.Create(visitorUser).Error; err != nil {
					c.JSON(http.StatusInternalServerError, model.SystemError.ToOpenAIErrorResponeWithType(err, "server_error"))
					c.Abort()
					return
				}
			} else {
				c.JSON(http.StatusInternalServerError, model.SystemError.ToOpenAIErrorResponeWithType(err, "server_error"))
				c.Abort()
				return
			}
		}

		c.Set(session.SESSION_USER_ID, visitorUser.UserID)
		c.Set(session.SESSION_USER_NICKNAME, visitorUser.Nickname)
		c.Set(session.SESSION_AGENT_ID, key.AgentID)
		c.Set(session.SESSION_AGENT, agent)
		c.Set(session.SESSION_REQUEST_SOURCE, model.SourceAPI)
		c.Set(session.ENV_EID, key.Eid)
		c.Set(session.SESSION_AGENT_API_KEY_ID, key.ID)
		session.SetVisitorID(c, fmt.Sprintf("api_%d", key.AgentID))

		c.Next()
	}
}
