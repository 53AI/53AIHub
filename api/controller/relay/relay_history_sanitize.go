package relay

import (
	"strings"

	relay_model "github.com/songquanpeng/one-api/relay/model"
)

type relayMessageSanitizationStats struct {
	DroppedEmptyMessages      int
	DroppedToolMessages       int
	DroppedDuplicateToolCalls int
	MergedPlainMessages       int
}

func (s relayMessageSanitizationStats) HasChanges() bool {
	return s.DroppedEmptyMessages > 0 ||
		s.DroppedToolMessages > 0 ||
		s.DroppedDuplicateToolCalls > 0 ||
		s.MergedPlainMessages > 0
}

func sanitizeRelayMessagesForModel(messages []relay_model.Message) ([]relay_model.Message, relayMessageSanitizationStats) {
	if len(messages) == 0 {
		return nil, relayMessageSanitizationStats{}
	}

	cleaned := make([]relay_model.Message, 0, len(messages))
	seenToolCallIDs := make(map[string]struct{})
	pendingToolCallIDs := make(map[string]struct{})
	stats := relayMessageSanitizationStats{}

	for _, msg := range messages {
		role := strings.ToLower(strings.TrimSpace(msg.Role))
		if role == "" {
			stats.DroppedEmptyMessages++
			continue
		}

		switch role {
		case "assistant":
			// 每次进入新的 assistant 消息，都重新建立它允许对应的 tool_call_id 集合。
			pendingToolCallIDs = make(map[string]struct{})
			if len(msg.ToolCalls) > 0 {
				msg.ToolCalls, stats.DroppedDuplicateToolCalls = dedupeRelayToolCalls(msg.ToolCalls, seenToolCallIDs, stats.DroppedDuplicateToolCalls)
				for _, toolCall := range msg.ToolCalls {
					if toolCall.Id == "" {
						continue
					}
					pendingToolCallIDs[toolCall.Id] = struct{}{}
				}
			}
			if isRelayMessageEmpty(msg) {
				stats.DroppedEmptyMessages++
				continue
			}
			cleaned = appendOrMergeRelayMessage(cleaned, msg, &stats)

		case "tool":
			toolCallID := strings.TrimSpace(msg.ToolCallId)
			if toolCallID == "" || len(pendingToolCallIDs) == 0 {
				stats.DroppedToolMessages++
				continue
			}
			if _, ok := pendingToolCallIDs[toolCallID]; !ok {
				stats.DroppedToolMessages++
				continue
			}
			delete(pendingToolCallIDs, toolCallID)
			if isRelayMessageEmpty(msg) {
				stats.DroppedEmptyMessages++
				continue
			}
			cleaned = append(cleaned, msg)

		default:
			// Once the transcript moves on to a non-tool role, any pending tool
			// results that have not arrived yet should no longer be matched.
			pendingToolCallIDs = make(map[string]struct{})
			if isRelayMessageEmpty(msg) {
				stats.DroppedEmptyMessages++
				continue
			}
			cleaned = appendOrMergeRelayMessage(cleaned, msg, &stats)
		}
	}

	return cleaned, stats
}

func dedupeRelayToolCalls(toolCalls []relay_model.Tool, seenToolCallIDs map[string]struct{}, droppedCount int) ([]relay_model.Tool, int) {
	if len(toolCalls) == 0 {
		return nil, droppedCount
	}

	cleaned := make([]relay_model.Tool, 0, len(toolCalls))
	for _, toolCall := range toolCalls {
		toolCallID := strings.TrimSpace(toolCall.Id)
		if toolCallID == "" {
			droppedCount++
			continue
		}
		if _, ok := seenToolCallIDs[toolCallID]; ok {
			droppedCount++
			continue
		}
		seenToolCallIDs[toolCallID] = struct{}{}
		toolCall.Id = toolCallID
		cleaned = append(cleaned, toolCall)
	}
	return cleaned, droppedCount
}

func appendOrMergeRelayMessage(messages []relay_model.Message, msg relay_model.Message, stats *relayMessageSanitizationStats) []relay_model.Message {
	if len(messages) == 0 {
		return append(messages, msg)
	}
	lastIdx := len(messages) - 1
	if merged, ok := mergeRelayPlainMessages(messages[lastIdx], msg); ok {
		messages[lastIdx] = merged
		stats.MergedPlainMessages++
		return messages
	}
	return append(messages, msg)
}

func mergeRelayPlainMessages(prev relay_model.Message, next relay_model.Message) (relay_model.Message, bool) {
	if strings.TrimSpace(prev.Role) == "" || strings.TrimSpace(next.Role) == "" {
		return relay_model.Message{}, false
	}
	if prev.Role != next.Role {
		return relay_model.Message{}, false
	}
	if prev.Role == "tool" {
		return relay_model.Message{}, false
	}
	if len(prev.ToolCalls) > 0 || len(next.ToolCalls) > 0 {
		return relay_model.Message{}, false
	}
	if strings.TrimSpace(prev.ToolCallId) != "" || strings.TrimSpace(next.ToolCallId) != "" {
		return relay_model.Message{}, false
	}
	if !prev.IsStringContent() || !next.IsStringContent() {
		return relay_model.Message{}, false
	}

	left := prev.StringContent()
	right := next.StringContent()
	if left == "" && right == "" {
		return relay_model.Message{}, false
	}

	merged := prev
	switch {
	case left == "":
		merged.Content = right
	case right == "":
		merged.Content = left
	default:
		merged.Content = left + "\n\n" + right
	}
	if merged.Name == nil && next.Name != nil {
		merged.Name = next.Name
	}
	return merged, true
}

func isRelayMessageEmpty(msg relay_model.Message) bool {
	if len(msg.ToolCalls) > 0 {
		return false
	}
	if strings.TrimSpace(msg.ToolCallId) != "" {
		return false
	}
	if !msg.IsStringContent() {
		return msg.Content == nil
	}
	return strings.TrimSpace(msg.StringContent()) == ""
}
