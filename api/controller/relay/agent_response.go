package relay

import (
	"math"
	"strings"
	"time"

	relay_model "github.com/songquanpeng/one-api/relay/model"
)

// AssistantResponse isolates Agent decisions from the upstream response shape.
// It is intentionally built in relay so provider adaptors remain untouched.
type AssistantResponse struct {
	Content          string
	ReasoningContent string
	ToolCalls        []relay_model.Tool
	FinishReason     string
	StreamComplete   bool
}

func normalizeAssistantResponse(message relay_model.Message, reasoning, finishReason string, streamComplete bool) AssistantResponse {
	content, _ := message.Content.(string)
	return AssistantResponse{
		Content: content, ReasoningContent: reasoning, ToolCalls: message.ToolCalls,
		FinishReason: finishReason, StreamComplete: streamComplete,
	}
}

// shouldBlockIncompleteAssistantResponse prevents an interrupted stream from
// being interpreted as a valid action. A partial tool call is particularly
// dangerous because it may otherwise reach a side-effecting executor.
func shouldBlockIncompleteAssistantResponse(response AssistantResponse) bool {
	return !response.StreamComplete && (len(response.ToolCalls) > 0 || strings.TrimSpace(response.Content) != "" || strings.TrimSpace(response.ReasoningContent) != "")
}

func duplicateAssistantToolCallID(calls []relay_model.Tool) string {
	seen := make(map[string]struct{}, len(calls))
	for _, call := range calls {
		id := strings.TrimSpace(call.Id)
		if id == "" {
			continue
		}
		if _, exists := seen[id]; exists {
			return id
		}
		seen[id] = struct{}{}
	}
	return ""
}

type RetryPolicy struct {
	MaxAttempts  int
	InitialDelay time.Duration
	MaxDelay     time.Duration
	Multiplier   float64
	Jitter       float64
}

func defaultStructuredRetryPolicy() RetryPolicy {
	return RetryPolicy{MaxAttempts: 3, InitialDelay: 500 * time.Millisecond, MaxDelay: 8 * time.Second, Multiplier: 2, Jitter: 0.2}
}

func (p RetryPolicy) DelayForRetry(attempt int) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	if p.InitialDelay <= 0 {
		return 0
	}
	delay := float64(p.InitialDelay) * math.Pow(p.Multiplier, float64(attempt-1))
	if p.MaxDelay > 0 && delay > float64(p.MaxDelay) {
		delay = float64(p.MaxDelay)
	}
	// Deterministic midpoint jitter avoids synchronized immediate retries while
	// retaining predictable unit tests. Providers may later supply random jitter.
	if p.Jitter > 0 {
		delay *= 1 - p.Jitter/2
	}
	return time.Duration(delay)
}
