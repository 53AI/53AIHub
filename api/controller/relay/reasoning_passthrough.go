package relay

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/relay/constant/role"
	relay_model "github.com/songquanpeng/one-api/relay/model"
)

const (
	relayAssistantMessageExtrasKey = "relay_assistant_message_extras"
	relayRequestPassthroughKey     = "relay_request_passthrough"
)

var preservedAssistantMessageFields = map[string]struct{}{
	"reasoning_content": {},
}

var preservedRequestFields = map[string]struct{}{
	"thinking":        {},
	"enable_thinking": {},
}

func extractAssistantMessageExtrasFromBody(body []byte) map[int]map[string]interface{} {
	var raw map[string]interface{}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil
	}
	messages, ok := raw["messages"].([]interface{})
	if !ok || len(messages) == 0 {
		return nil
	}

	result := make(map[int]map[string]interface{})
	assistantOrdinal := 0
	for _, item := range messages {
		msg, ok := item.(map[string]interface{})
		if !ok {
			continue
		}
		if strings.TrimSpace(toStringValue(msg["role"])) != role.Assistant {
			continue
		}
		extras := make(map[string]interface{})
		for field := range preservedAssistantMessageFields {
			if value, exists := msg[field]; exists && !isEmptyRelayPassthroughValue(value) {
				extras[field] = value
			}
		}
		if len(extras) > 0 {
			result[assistantOrdinal] = extras
		}
		assistantOrdinal++
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

func extractRequestPassthroughFields(body []byte) map[string]interface{} {
	var raw map[string]interface{}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil
	}
	result := make(map[string]interface{})
	for field := range preservedRequestFields {
		if value, exists := raw[field]; exists && !isEmptyRelayPassthroughValue(value) {
			result[field] = value
		}
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

func shiftAssistantOrdinalExtras(extras map[int]map[string]interface{}, offset int) map[int]map[string]interface{} {
	if len(extras) == 0 || offset == 0 {
		return extras
	}
	shifted := make(map[int]map[string]interface{}, len(extras))
	for idx, fields := range extras {
		shifted[idx+offset] = cloneStringAnyMap(fields)
	}
	return shifted
}

func mergeAssistantOrdinalExtras(parts ...map[int]map[string]interface{}) map[int]map[string]interface{} {
	merged := make(map[int]map[string]interface{})
	for _, part := range parts {
		for idx, fields := range part {
			if len(fields) == 0 {
				continue
			}
			merged[idx] = cloneStringAnyMap(fields)
		}
	}
	if len(merged) == 0 {
		return nil
	}
	return merged
}

func storeAssistantMessageExtras(c *gin.Context, extras map[int]map[string]interface{}) {
	if c == nil || len(extras) == 0 {
		return
	}
	current, _ := c.Get(relayAssistantMessageExtrasKey)
	existing, _ := current.(map[int]map[string]interface{})
	c.Set(relayAssistantMessageExtrasKey, mergeAssistantOrdinalExtras(existing, extras))
}

func appendAssistantMessageExtra(c *gin.Context, assistantOrdinal int, extras map[string]interface{}) {
	if c == nil || len(extras) == 0 || assistantOrdinal < 0 {
		return
	}
	storeAssistantMessageExtras(c, map[int]map[string]interface{}{
		assistantOrdinal: cloneStringAnyMap(extras),
	})
}

func getStoredAssistantMessageExtras(c *gin.Context) map[int]map[string]interface{} {
	if c == nil {
		return nil
	}
	value, exists := c.Get(relayAssistantMessageExtrasKey)
	if !exists {
		return nil
	}
	extras, _ := value.(map[int]map[string]interface{})
	return extras
}

func storeRequestPassthroughFields(c *gin.Context, fields map[string]interface{}) {
	if c == nil || len(fields) == 0 {
		return
	}
	current, _ := c.Get(relayRequestPassthroughKey)
	existing, _ := current.(map[string]interface{})
	merged := make(map[string]interface{}, len(existing)+len(fields))
	for key, value := range existing {
		merged[key] = value
	}
	for key, value := range fields {
		merged[key] = value
	}
	c.Set(relayRequestPassthroughKey, merged)
}

func getStoredRequestPassthroughFields(c *gin.Context) map[string]interface{} {
	if c == nil {
		return nil
	}
	value, exists := c.Get(relayRequestPassthroughKey)
	if !exists {
		return nil
	}
	fields, _ := value.(map[string]interface{})
	return fields
}

func countAssistantMessages(messages []relay_model.Message) int {
	total := 0
	for _, msg := range messages {
		if msg.Role == role.Assistant {
			total++
		}
	}
	return total
}

func applyRelayRequestPassthrough(c *gin.Context, convertedRequest any) (any, error) {
	requestFields := getStoredRequestPassthroughFields(c)
	assistantExtras := getStoredAssistantMessageExtras(c)
	if len(requestFields) == 0 && len(assistantExtras) == 0 {
		return convertedRequest, nil
	}

	raw, err := json.Marshal(convertedRequest)
	if err != nil {
		return nil, err
	}

	var requestMap map[string]interface{}
	if err := json.Unmarshal(raw, &requestMap); err != nil {
		return nil, err
	}

	for key, value := range requestFields {
		requestMap[key] = value
	}

	if len(assistantExtras) > 0 {
		if messages, ok := requestMap["messages"].([]interface{}); ok {
			assistantOrdinal := 0
			for _, item := range messages {
				msg, ok := item.(map[string]interface{})
				if !ok {
					continue
				}
				if strings.TrimSpace(toStringValue(msg["role"])) != role.Assistant {
					continue
				}
				if extras, exists := assistantExtras[assistantOrdinal]; exists {
					for key, value := range extras {
						msg[key] = value
					}
				}
				assistantOrdinal++
			}
		}
	}

	return requestMap, nil
}

func toStringValue(value interface{}) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case string:
		return typed
	case fmt.Stringer:
		return typed.String()
	default:
		return fmt.Sprintf("%v", value)
	}
}

func isEmptyRelayPassthroughValue(value interface{}) bool {
	if value == nil {
		return true
	}
	if str, ok := value.(string); ok {
		return strings.TrimSpace(str) == ""
	}
	return false
}

func cloneStringAnyMap(source map[string]interface{}) map[string]interface{} {
	if len(source) == 0 {
		return nil
	}
	cloned := make(map[string]interface{}, len(source))
	for key, value := range source {
		cloned[key] = value
	}
	return cloned
}
