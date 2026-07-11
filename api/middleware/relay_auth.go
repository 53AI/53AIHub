package middleware

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/session"
	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/common/utils/helper"
	"github.com/53AI/53AIHub/model"
	"github.com/gin-gonic/gin"
)

func RelayTokenAuth() func(c *gin.Context) {
	return func(c *gin.Context) {
		token := c.Request.Header.Get("Authorization")
		token = strings.Replace(token, "Bearer ", "", 1)
		if token == "" {
			c.JSON(http.StatusUnauthorized, model.UnauthorizedError.ToOpenAIErrorRespone(nil))
			c.Abort()
			return
		}

		user, eid, err := HandleAnyTokenAuth(token, model.RoleGuestUser)
		if err != nil {
			if strings.Contains(err.Error(), "token is expired") {
				c.JSON(http.StatusUnauthorized, model.TokenExpiredError.ToOpenAIErrorRespone(nil))
			} else {
				c.JSON(http.StatusUnauthorized, model.UnauthorizedError.ToOpenAIErrorRespone(err))
			}
			c.Abort()
			return
		}

		c.Set(session.SESSION_USER_ID, user.UserID)
		c.Set(session.SESSION_USER_ROLE, user.Role)
		c.Set(session.SESSION_USER_GROUP_ID, user.GroupId)
		c.Set(session.ENV_EID, eid)

		// 读取原始请求体
		bodyBytes, err := c.GetRawData()
		if err != nil {
			c.JSON(http.StatusBadRequest, model.ParamError.ToOpenAIErrorRespone(err))
			c.Abort()
			return
		}

		var requestData map[string]interface{}
		if err := json.Unmarshal(bodyBytes, &requestData); err != nil {
			c.JSON(http.StatusBadRequest, model.ParamError.ToOpenAIErrorRespone(err))
			c.Abort()
			return
		}

		c.Request.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))

		if modelValue, exists := requestData["model"]; exists {
			modelStr, ok := modelValue.(string)
			if !ok {
				c.JSON(http.StatusUnauthorized, model.ParamError.ToOpenAIErrorRespone(nil))
				c.Abort()
				return
			}
			c.Set(session.SESSION_AGENT_MODEL, modelStr)
			conversationIdValue, hasConversationID := requestData["conversation_id"]

			if strings.HasPrefix(modelStr, "agent-") {
				// 检查是否为 "agent-{agent_id}-{agent_model_id}" 格式
				parts := strings.Split(modelStr, "-")
				if len(parts) == 3 {
					// 处理 "agent-{agent_id}-{agent_model_id}" 格式
					agentID, err1 := resolveAgentModelID(parts[1])
					agentModelID, err2 := resolveAgentModelID(parts[2])
					if err1 != nil || err2 != nil {
						c.JSON(http.StatusBadRequest, model.ParamError.ToOpenAIErrorRespone(errors.New("AgentId or AgentModelId Error")))
						c.Abort()
						return
					}

					agent, err := model.GetAgentByID(eid, agentID)
					if err != nil {
						c.JSON(http.StatusNotFound, model.NotFound.ToOpenAIErrorRespone("Agent not found"))
						c.Abort()
						return
					}

					// 获取 agent_model 信息
					agentModel, err := model.GetAgentModelByID(eid, agentModelID)
					if err != nil {
						c.JSON(http.StatusNotFound, model.NotFound.ToOpenAIErrorRespone("AgentModel not found"))
						c.Abort()
						return
					}

					// 验证 agent_model 是否属于该 agent
					if agentModel.Eid != eid || agentModel.AgentID != agentID {
						c.JSON(http.StatusForbidden, model.ForbiddenError.ToOpenAIErrorRespone(errors.New("AgentModel does not belong to the specified agent")))
						c.Abort()
						return
					}

					// 使用 agent_model 中的 channel_type 和 model 更新 agent 信息
					agent.ChannelType = agentModel.ChannelType
					agent.Model = agentModel.Model
					agent.SpecificChannelID = agentModel.ChannelID

					if !common.IsAdmin(c) {
						if shouldBypassAgentGroupAuth(agent, user.UserID) {
							logger.SysLogf("Bypass agent group auth: agent_id=%d", agent.AgentID)
						} else if user.Type == model.UserTypeVisitor {
							// 访客用户(Type=UserTypeVisitor)没有分组权限，跳过分组检查
							// 设计决策同 controller/agent.go：
							// 1. 访客是通过 H5 Fixed Token 登录的匿名用户，主要用于 Agent 对话
							// 2. 访客不需要精细的分组权限控制，企业 Agent 对访客开放是合理的业务需求
							// 3. 避免为访客创建额外的分组数据，保持最小改动原则
							logger.SysLogf("Visitor user access agent: agent_id=%d, user_id=%d", agent.AgentID, user.UserID)
						} else if user.Type == model.UserTypeRegistered {
							agentUserGroupIds, err := agent.GetUserGroupIds()
							if err != nil {
								c.JSON(http.StatusInternalServerError, model.NotFound.ToOpenAIErrorRespone(err))
								c.Abort()
								return
							}
							userGroupIds, _ := user.GetUserGroupIds()
							if !helper.HasIntersection(agentUserGroupIds, userGroupIds) {
								c.JSON(http.StatusForbidden, model.AgentAuthError.ToOpenAIErrorRespone(nil))
								c.Abort()
								return
							}
						}
					} else {
						logger.SysLogf("Admin user access agent: %d with model: %d", agent.AgentID, agentModelID)
					}

					if hasConversationID && conversationIdValue != nil &&
						!handleRelayConversationIDForAgent(c, eid, user.UserID, agent, conversationIdValue) {
						return
					}

					c.Set(session.SESSION_AGENT_ID, agentID)
					c.Set(session.SESSION_AGENT, agent)
					logger.SysLogf("Agent ID: %d with Model ID: %d", agent.AgentID, agentModelID)
				} else if len(parts) == 2 {
					// 处理现有的 "agent-{agent_id}" 格式
					agentID, err := resolveAgentModelID(parts[1])
					if err != nil {
						c.JSON(http.StatusBadRequest, model.ParamError.ToOpenAIErrorRespone(errors.New("AgentId Error")))
						c.Abort()
						return
					}

					agent, err := model.GetAgentByID(eid, agentID)
					if err != nil {
						c.JSON(http.StatusNotFound, model.NotFound.ToOpenAIErrorRespone("Agent not found"))
						c.Abort()
						return
					}

					if !common.IsAdmin(c) {
						if shouldBypassAgentGroupAuth(agent, user.UserID) {
							logger.SysLogf("Bypass agent group auth: agent_id=%d", agent.AgentID)
						} else if user.Type == model.UserTypeVisitor {
							// 访客用户(Type=UserTypeVisitor)没有分组权限，跳过分组检查
							// 设计决策同 controller/agent.go：
							// 1. 访客是通过 H5 Fixed Token 登录的匿名用户，主要用于 Agent 对话
							// 2. 访客不需要精细的分组权限控制，企业 Agent 对访客开放是合理的业务需求
							// 3. 避免为访客创建额外的分组数据，保持最小改动原则
							logger.SysLogf("Visitor user access agent: agent_id=%d, user_id=%d", agent.AgentID, user.UserID)
						} else {
							agentUserGroupIds, err := agent.GetUserGroupIds()
							if err != nil {
								c.JSON(http.StatusInternalServerError, model.NotFound.ToOpenAIErrorRespone(err))
								c.Abort()
								return
							}

							userGroupIds, err := user.GetUserGroupIds()
							if err != nil {
								c.JSON(http.StatusInternalServerError, model.NotFound.ToOpenAIErrorRespone(err))
								c.Abort()
								return
							}
							if !helper.HasIntersection(agentUserGroupIds, userGroupIds) {
								c.JSON(http.StatusForbidden, model.AgentAuthError.ToOpenAIErrorRespone(nil))
								c.Abort()
								return
							}
						}
					} else {
						logger.SysLogf("Admin user access agent: %d", agent.AgentID)
					}

					if hasConversationID && conversationIdValue != nil &&
						!handleRelayConversationIDForAgent(c, eid, user.UserID, agent, conversationIdValue) {
						return
					}

					c.Set(session.SESSION_AGENT_ID, agentID)
					c.Set(session.SESSION_AGENT, agent)
					logger.SysLogf("Agent ID: %d", agent.AgentID)
				} else {
					c.JSON(http.StatusBadRequest, model.ParamError.ToOpenAIErrorRespone(errors.New("Invalid model format")))
					c.Abort()
					return
				}
			} else if hasConversationID && conversationIdValue != nil &&
				!handlePlatformConversationID(c, eid, user.UserID, conversationIdValue) {
				return
			}
		}
		c.Next()
	}
}

func handleRelayConversationID(c *gin.Context, eid int64, userID int64, modelStr string, conversationIDValue interface{}) bool {
	if strings.HasPrefix(modelStr, "agent-") {
		parts := strings.Split(modelStr, "-")
		if len(parts) == 3 {
			agentID, err1 := resolveAgentModelID(parts[1])
			agentModelID, err2 := resolveAgentModelID(parts[2])
			if err1 == nil && err2 == nil {
				if agent, err := model.GetAgentByID(eid, agentID); err == nil {
					if agentModel, err := model.GetAgentModelByID(eid, agentModelID); err == nil &&
						agentModel.Eid == eid && agentModel.AgentID == agentID {
						agent.ChannelType = agentModel.ChannelType
						agent.Model = agentModel.Model
						agent.SpecificChannelID = agentModel.ChannelID
						return handleRelayConversationIDForAgent(c, eid, userID, agent, conversationIDValue)
					}
				}
			}
		} else if len(parts) == 2 {
			agentID, err := resolveAgentModelID(parts[1])
			if err == nil {
				if agent, err := model.GetAgentByID(eid, agentID); err == nil {
					return handleRelayConversationIDForAgent(c, eid, userID, agent, conversationIDValue)
				}
			}
		}
	}
	return handlePlatformConversationID(c, eid, userID, conversationIDValue)
}

func handleRelayConversationIDForAgent(c *gin.Context, eid int64, userID int64, agent *model.Agent, conversationIDValue interface{}) bool {
	if agent != nil && agent.IsOpenClawWSCompatible() {
		rawConversationID, ok := stringifyConversationID(conversationIDValue)
		if !ok {
			writeConversationNotFound(c)
			return false
		}
		c.Set(session.SESSION_CONVERSATION_ID, rawConversationID)
		return true
	}
	return handlePlatformConversationID(c, eid, userID, conversationIDValue)
}

func handlePlatformConversationID(c *gin.Context, eid int64, userID int64, conversationIDValue interface{}) bool {
	conversationID, ok := parsePlatformConversationID(conversationIDValue)
	if !ok {
		writeConversationNotFound(c)
		return false
	}
	conversation, err := model.GetConversationByIdAndUserId(eid, conversationID, userID)
	if err != nil {
		writeConversationNotFound(c)
		return false
	}
	c.Set(session.SESSION_CONVERSATION_ID, conversationID)
	c.Set(session.SESSION_CONVERSATION, conversation)
	return true
}

func parsePlatformConversationID(conversationIDValue interface{}) (int64, bool) {
	switch v := conversationIDValue.(type) {
	case float64:
		return int64(v), true
	case int64:
		return v, true
	case string:
		if decoded, err := hashids.TryParseID(v); err == nil {
			return int64(decoded), true
		}
	}
	return 0, false
}

func stringifyConversationID(conversationIDValue interface{}) (string, bool) {
	switch v := conversationIDValue.(type) {
	case string:
		if strings.TrimSpace(v) == "" {
			return "", false
		}
		return v, true
	case float64:
		return strconv.FormatInt(int64(v), 10), true
	case int64:
		return strconv.FormatInt(v, 10), true
	default:
		return "", false
	}
}

func writeConversationNotFound(c *gin.Context) {
	c.JSON(http.StatusNotFound, model.NotFound.ToOpenAIErrorRespone(errors.New("Conversation not found")))
	c.Abort()
}

// shouldBypassAgentGroupAuth 判断是否跳过分组权限检查
// - 个人智能体（OwnerID > 0）：仅创建者可访问，跳过分组检查
// - 企业工作AI（OwnerID=0 && AgentUsage=WorkAI）：全员可用，跳过分组检查
// - 其他企业智能体：返回 false，走原有分组鉴权
func shouldBypassAgentGroupAuth(agent *model.Agent, userID int64) bool {
	if agent == nil {
		return false
	}
	// 个人智能体：仅创建者可访问
	if agent.OwnerID > model.AgentOwnerEnterprise {
		return agent.OwnerID == userID
	}
	// 企业工作AI：全员可用
	return agent.AgentUsage == model.AgentUsageWorkAI
}

// resolveAgentModelID 解析 Agent 和 AgentModel ID，支持加密的 hashID 和明文数字ID
func resolveAgentModelID(input string) (int64, error) {
	if input == "" {
		return 0, fmt.Errorf("输入不能为空")
	}

	// 首先尝试直接解析为数字（向后兼容）
	if id, err := strconv.ParseInt(input, 10, 64); err == nil {
		// 验证数字是否有效（正数）
		if id > 0 {
			return id, nil
		}
		return 0, fmt.Errorf("ID必须为正数: %s", input)
	}

	// 如果不是纯数字，检查是否是有效的hashID格式（包含字母）
	if isHashIDFormat(input) {
		// 尝试从hashID解码获取原始ID
		if originalID, err := hashids.Decode(input); err == nil {
			return originalID, nil
		}
	}

	return 0, fmt.Errorf("无法解析ID: %s", input)
}

// isHashIDFormat 检查字符串是否符合hashID的一般格式（包含字母且不是纯数字）
func isHashIDFormat(s string) bool {
	if len(s) < 3 { // hashID通常比较长
		return false
	}
	hasLetter := false
	for _, char := range s {
		if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') {
			hasLetter = true
			break
		}
	}
	return hasLetter
}
