package logger

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strings"
)

const redactedLogValue = "[REDACTED]"

// SanitizedHeaderSummary is a deterministic, credential-safe representation
// of HTTP headers intended for diagnostic logs.
type SanitizedHeaderSummary []string

func (s SanitizedHeaderSummary) String() string {
	return strings.Join(s, ", ")
}

// SanitizeHeaders preserves ordinary diagnostic headers while redacting any
// header whose name indicates that its value may contain credentials.
func SanitizeHeaders(headers http.Header) SanitizedHeaderSummary {
	if len(headers) == 0 {
		return nil
	}

	keys := make([]string, 0, len(headers))
	for key := range headers {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	result := make(SanitizedHeaderSummary, 0, len(keys))
	for _, key := range keys {
		value := strings.Join(headers[key], ",")
		if isSensitiveLogKey(key) {
			value = redactedLogValue
		} else {
			value = summarizeLogScalar(value, 256)
		}
		result = append(result, key+"="+value)
	}
	return result
}

// SummarizeRequestBody reports only low-cardinality routing and sizing data.
// Message, prompt, tool definition, file content, and arbitrary request fields
// are deliberately never rendered.
func SummarizeRequestBody(body []byte) string {
	parts := []string{fmt.Sprintf("body_bytes=%d", len(body))}
	if len(body) == 0 {
		return strings.Join(parts, " ")
	}

	var payload map[string]interface{}
	if err := json.Unmarshal(body, &payload); err != nil {
		return strings.Join(append(parts, "json=false"), " ")
	}
	parts = append(parts, "json=true")
	if model, ok := payload["model"].(string); ok && model != "" {
		parts = append(parts, "model="+summarizeLogScalar(model, 128))
	}
	if stream, ok := payload["stream"].(bool); ok {
		parts = append(parts, fmt.Sprintf("stream=%t", stream))
	}
	if requestID, ok := payload["request_id"].(string); ok && requestID != "" {
		parts = append(parts, "request_id="+summarizeLogScalar(requestID, 128))
	}
	for _, key := range []string{"messages", "tools", "files", "input"} {
		if values, ok := payload[key].([]interface{}); ok {
			parts = append(parts, fmt.Sprintf("%s=%d", key, len(values)))
		}
	}
	return strings.Join(parts, " ")
}

// SummarizeToolArguments reports the argument shape and encoded size without
// logging commands, code, prompts, secrets, or file contents.
func SummarizeToolArguments(args map[string]interface{}) string {
	keys := make([]string, 0, len(args))
	for key := range args {
		keys = append(keys, summarizeLogScalar(key, 64))
	}
	sort.Strings(keys)

	encoded, err := json.Marshal(args)
	encodedSize := 0
	if err == nil {
		encodedSize = len(encoded)
	}
	return fmt.Sprintf("arg_count=%d arg_keys=%s args_bytes=%d", len(args), strings.Join(keys, ","), encodedSize)
}

// SanitizeURL removes userinfo and the complete query/fragment. Signed URLs
// commonly carry access tokens in their query string and must never be logged.
func SanitizeURL(raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil {
		return "<invalid-url>"
	}
	parsed.User = nil
	parsed.RawQuery = ""
	parsed.ForceQuery = false
	parsed.Fragment = ""
	return summarizeLogScalar(parsed.String(), 512)
}

func isSensitiveLogKey(key string) bool {
	normalized := strings.ToLower(key)
	replacer := strings.NewReplacer("-", "", "_", "", ".", "", " ", "")
	normalized = replacer.Replace(normalized)
	for _, marker := range []string{
		"authorization",
		"apikey",
		"token",
		"secret",
		"password",
		"passwd",
		"cookie",
		"credential",
		"privatekey",
	} {
		if strings.Contains(normalized, marker) {
			return true
		}
	}
	return false
}

func summarizeLogScalar(value string, max int) string {
	value = strings.Map(func(r rune) rune {
		switch r {
		case '\n', '\r', '\t':
			return ' '
		default:
			return r
		}
	}, value)
	if max > 0 && len(value) > max {
		return value[:max] + "...(truncated)"
	}
	return value
}
