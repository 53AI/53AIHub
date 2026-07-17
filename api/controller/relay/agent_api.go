package relay

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/ctxkey"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/session"
	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/common/utils/helper"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/relay/relaymode"
)

const apiUserChannelTokenTTL = 7 * 24 * time.Hour

var (
	errAPIConversationRequired = errors.New("conversation_id is required")
	errAPIConversationInvalid  = errors.New("conversation_id is invalid")
	userIdentifierRegex        = regexp.MustCompile(`^[a-zA-Z0-9._-]+$`)
)

// HandleAgentAPIChatCompletions handles /v1/agents/:agent_id/chat/completions
// Agent is already resolved and set in session by AgentAPIAuth() middleware.
func HandleAgentAPIChatCompletions(c *gin.Context) {
	c.Set(ctxkey.Group, "vip")

	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(400, model.ParamError.ToOpenAIErrorRespone(err))
		return
	}

	// Reject model parameter — API key already binds to an agent with default model config
	if hasModelParam(body) {
		c.JSON(400, model.ParamError.ToOpenAIErrorResponeWithType("model parameter is not allowed for API access; agent default model is used", "invalid_request_error"))
		return
	}

	// Reject disallowed parameters (temperature, max_tokens, top_p)
	if hasDisallowedParams(body) {
		c.JSON(400, model.ParamError.ToOpenAIErrorResponeWithType("temperature, max_tokens, and top_p parameters are not allowed for API access; agent default configuration is used", "invalid_request_error"))
		return
	}

	if err := resolveAPIUserFromBody(c, body); err != nil {
		c.JSON(400, model.ParamError.ToOpenAIErrorResponeWithType(err.Error(), "invalid_request_error"))
		return
	}

	// Default stream=true for API access if not specified
	body = injectDefaultStream(body)

	// Inject source=api into the request body so downstream code
	// (ChatRequest.Source → MessageStatsInfo.RequestSource) picks it up.
	body = injectRequestSource(body, model.MessageRequestSourceAPI)

	processedBody, agent, err := ProcessRequestParams(c, body)
	if err != nil {
		if err.Error() == "agent not found" {
			c.JSON(404, model.NotFound.ToOpenAIErrorRespone(err))
		} else {
			c.JSON(400, model.ParamError.ToOpenAIErrorRespone(err))
		}
		return
	}

	if !agent.Enable {
		c.JSON(403, model.ForbiddenError.ToOpenAIErrorResponeWithType("Agent is disabled", "permission_error"))
		return
	}

	// Lazy: Search agents should default to all knowledge bases when no scope is provided
	if agent.AgentUsage == model.AgentUsageSearch && !hasKnowledgeScope(processedBody) {
		processedBody = injectDefaultKnowledgeBaseIDs(processedBody)
	}

	if err := resolveAPIConversationFromBody(c, processedBody); err != nil {
		if errors.Is(err, errAPIConversationRequired) || errors.Is(err, errAPIConversationInvalid) {
			c.JSON(400, model.ParamError.ToOpenAIErrorResponeWithType(err.Error(), "invalid_request_error"))
		} else {
			c.JSON(404, model.NotFound.ToOpenAIErrorResponeWithType("Conversation not found", "not_found"))
		}
		return
	}

	c.Request.Body = io.NopCloser(bytes.NewBuffer(processedBody))

	// Rewrite /openapi/v1/ → /v1/ so all relay adaptors build correct upstream URLs
	c.Request.URL.Path = strings.Replace(c.Request.URL.Path, "/openapi/v1/", "/v1/", 1)

	relayMode := relaymode.ChatCompletions

	recorder := service.NewStatusCodeRecorder(c.Writer)
	c.Writer = recorder
	startTime := time.Now()

	defer func() {
		agentID, _ := c.Get(session.SESSION_AGENT_ID)
		tokenID, _ := c.Get(session.SESSION_AGENT_API_KEY_ID)
		eid, _ := c.Get(session.ENV_EID)
		requestID := helper.GetRequestID(c.Request.Context())

		apiSvc := service.NewAgentAPIService()
		apiSvc.LogAPIAuditWithResult(
			toInt64(agentID),
			toInt64(tokenID),
			toInt64(eid),
			c.Request.Method,
			c.Request.URL.Path,
			c.ClientIP(),
			requestID,
			recorder.StatusCode,
			startTime,
		)
	}()

	handleChatRequest(c, processedBody, agent, relayMode)
}

func toInt64(v interface{}) int64 {
	if v == nil {
		return 0
	}
	switch val := v.(type) {
	case int64:
		return val
	case float64:
		return int64(val)
	case int:
		return int64(val)
	default:
		return 0
	}
}

func resolveAPIConversationFromBody(c *gin.Context, body []byte) error {
	var raw map[string]interface{}
	if err := json.Unmarshal(body, &raw); err != nil {
		return errAPIConversationInvalid
	}

	conversationID, ok := parseAPIConversationID(raw["conversation_id"])
	if !ok || conversationID <= 0 {
		return errAPIConversationRequired
	}

	conversation, err := model.GetConversationByIDWithVisitor(config.GetEID(c), config.GetUserId(c), conversationID, session.GetVisitorID(c))
	if err != nil {
		return err
	}

	c.Set(session.SESSION_CONVERSATION_ID, conversation.ConversationID)
	c.Set(session.SESSION_CONVERSATION, conversation)
	return nil
}

func parseAPIConversationID(value interface{}) (int64, bool) {
	switch v := value.(type) {
	case float64:
		return int64(v), true
	case int64:
		return v, true
	case int:
		return int64(v), true
	case string:
		id, err := hashids.TryParseID(v)
		if err != nil {
			return 0, false
		}
		return id, true
	default:
		return 0, false
	}
}

// ResolveAPIUserFromIdentifier resolves an external user identifier into a UserChannel identity.
// It looks up or creates a User + UserChannel record for the given external identifier.
// On success, it overrides SESSION_USER_ID and SESSION_USER_CHANNEL in the gin context
// so that downstream code uses the correct per-identifier user identity.
// This is the shared helper for all OpenAPI endpoints (chat, conversations, files).
func ResolveAPIUserFromIdentifier(c *gin.Context, identifier string) error {
	identifier = strings.TrimSpace(identifier)
	if identifier == "" {
		return fmt.Errorf("user field is required")
	}
	if len(identifier) > 255 {
		return fmt.Errorf("user field must not exceed 255 characters")
	}

	if !userIdentifierRegex.MatchString(identifier) {
		return fmt.Errorf("user field contains invalid characters; only letters, digits, dots, underscores, and hyphens are allowed")
	}

	eid := config.GetEID(c)
	if eid <= 0 {
		return fmt.Errorf("enterprise not found")
	}

	channel, err := model.GetUserChannelByTypeAndOpenID(eid, model.ChannelTypeAPI, identifier)
	if err == nil && channel != nil {
		c.Set(session.SESSION_USER_ID, channel.UserID)
		c.Set(session.SESSION_USER_NICKNAME, channel.Nickname)
		c.Set(session.SESSION_USER_CHANNEL, channel)
		model.GetOrCreateUserChannelTokenWithRenewal(eid, channel.UserID, channel.ID, apiUserChannelTokenTTL)
		return nil
	}

	newUser := &model.User{
		Username: fmt.Sprintf("api_%d_%s", eid, identifier),
		Nickname: identifier,
		Eid:      eid,
		Role:     model.RoleGuestUser,
		Status:   model.UserStatusJoined,
		Type:     model.UserTypeVisitor,
	}

	if err := model.DB.Create(newUser).Error; err != nil {
		logger.Warnf(c.Request.Context(), "创建API用户失败: user=%s, eid=%d, err=%v", identifier, eid, err)
		return fmt.Errorf("failed to create user: %w", err)
	}

	channel, err = model.CreateUserChannel(eid, newUser.UserID, model.ChannelTypeAPI, identifier,
		model.WithChannelNickname(identifier),
	)
	if err != nil {
		if errors.Is(err, model.ErrUserChannelDuplicated) {
			channel, lookupErr := model.GetUserChannelByTypeAndOpenID(eid, model.ChannelTypeAPI, identifier)
			if lookupErr == nil && channel != nil {
				c.Set(session.SESSION_USER_ID, channel.UserID)
				c.Set(session.SESSION_USER_NICKNAME, channel.Nickname)
				c.Set(session.SESSION_USER_CHANNEL, channel)
				model.GetOrCreateUserChannelTokenWithRenewal(eid, channel.UserID, channel.ID, apiUserChannelTokenTTL)
			}
			return nil
		}
		logger.Warnf(c.Request.Context(), "创建API UserChannel失败: user=%s, eid=%d, userID=%d, err=%v", identifier, eid, newUser.UserID, err)
		return fmt.Errorf("failed to create user channel: %w", err)
	}

	c.Set(session.SESSION_USER_ID, newUser.UserID)
	c.Set(session.SESSION_USER_NICKNAME, identifier)
	c.Set(session.SESSION_USER_CHANNEL, channel)
	model.GetOrCreateUserChannelTokenWithRenewal(eid, newUser.UserID, channel.ID, apiUserChannelTokenTTL)
	return nil
}

func resolveAPIUserFromBody(c *gin.Context, body []byte) error {
	var raw map[string]interface{}
	if err := json.Unmarshal(body, &raw); err != nil {
		return fmt.Errorf("invalid request body: %w", err)
	}

	userField, ok := raw["user"]
	if !ok || userField == nil {
		return fmt.Errorf("user field is required")
	}

	userStr, ok := userField.(string)
	if !ok || strings.TrimSpace(userStr) == "" {
		return fmt.Errorf("user field is required")
	}
	userStr = strings.TrimSpace(userStr)

	return ResolveAPIUserFromIdentifier(c, userStr)
}

func injectRequestSource(body []byte, source string) []byte {
	var raw map[string]interface{}
	if err := json.Unmarshal(body, &raw); err != nil {
		return body
	}
	raw["source"] = source
	updated, err := json.Marshal(raw)
	if err != nil {
		return body
	}
	return updated
}

func hasModelParam(body []byte) bool {
	var raw map[string]interface{}
	if err := json.Unmarshal(body, &raw); err != nil {
		return false
	}
	_, ok := raw["model"]
	return ok
}

func hasDisallowedParams(body []byte) bool {
	var raw map[string]interface{}
	if err := json.Unmarshal(body, &raw); err != nil {
		return false
	}
	for _, key := range []string{"temperature", "max_tokens", "top_p"} {
		if _, ok := raw[key]; ok {
			return true
		}
	}
	return false
}

func injectDefaultStream(body []byte) []byte {
	var raw map[string]interface{}
	if err := json.Unmarshal(body, &raw); err != nil {
		return body
	}
	if _, ok := raw["stream"]; !ok {
		raw["stream"] = true
	}
	updated, err := json.Marshal(raw)
	if err != nil {
		return body
	}
	return updated
}

func hasKnowledgeScope(body []byte) bool {
	var raw map[string]interface{}
	if err := json.Unmarshal(body, &raw); err != nil {
		return false
	}
	for _, key := range []string{"space_ids", "knowledge_base_ids", "file_ids"} {
		if v, ok := raw[key]; ok {
			if arr, ok := v.([]interface{}); ok && len(arr) > 0 {
				return true
			}
		}
	}
	return false
}

func injectDefaultKnowledgeBaseIDs(body []byte) []byte {
	var raw map[string]interface{}
	if err := json.Unmarshal(body, &raw); err != nil {
		return body
	}
	raw["knowledge_base_ids"] = []string{"all"}
	raw["enable_process_steps"] = true
	raw["solo_file_mode"] = false
	raw["search_config"] = map[string]interface{}{}
	raw["web_search_config"] = map[string]interface{}{}
	if _, ok := raw["file_ids"]; !ok {
		raw["file_ids"] = []string{}
	}
	if _, ok := raw["space_ids"]; !ok {
		raw["space_ids"] = []string{}
	}
	updated, err := json.Marshal(raw)
	if err != nil {
		return body
	}
	return updated
}
