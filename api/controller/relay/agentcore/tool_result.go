package agentcore

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
)

const ToolResultVersion = "1"

// ToolResultEnvelope is the stable, model-facing representation. The raw
// executor output stays outside this type in the relay's existing records.
type ToolResultEnvelope struct {
	Version     string         `json:"version"`
	OK          bool           `json:"ok"`
	Code        string         `json:"code"`
	Summary     string         `json:"summary"`
	ContentType string         `json:"content_type"`
	Content     string         `json:"content"`
	Meta        map[string]any `json:"meta"`
}

const sensitiveOutputKeyPattern = `(?:[a-z][a-z0-9]*[_-])*(?:api[_-]?key|token|authorization|password|secret)`

var sensitiveOutputPattern = regexp.MustCompile(`(?i)(\b` + sensitiveOutputKeyPattern + `\b\s*([:=])\s*)(?:Bearer\s+|Basic\s+)?(?:"[^"]*"|'[^']*'|[^\s,;]+)`)
var sensitiveJSONOutputPattern = regexp.MustCompile(`(?i)(["']` + sensitiveOutputKeyPattern + `["']\s*:\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)`)
var sensitiveOutputKeyNamePattern = regexp.MustCompile(`(?i)^` + sensitiveOutputKeyPattern + `$`)

func BuildToolResultEnvelope(result *ToolExecutionResult, maxChars int) ToolResultEnvelope {
	if result == nil {
		result = &ToolExecutionResult{Code: "UNKNOWN_OUTCOME", ExitCode: -1}
	}
	content := redactToolOutput(result.Output)
	content, truncated := truncateToolContent(content, maxChars)
	meta := sanitizeToolResultMeta(result.Meta)
	if meta == nil {
		meta = map[string]any{}
	}
	meta["exit_code"] = result.ExitCode
	meta["duration_ms"] = result.DurationMS
	meta["truncated"] = truncated
	if result.Err != nil {
		meta["error"] = redactToolOutput(result.Err.Error())
	}
	if strings.TrimSpace(result.Stderr) != "" {
		stderr, stderrTruncated := truncateToolContent(redactToolOutput(result.Stderr), maxChars)
		meta["stderr"] = stderr
		meta["stderr_truncated"] = stderrTruncated
	}
	if _, explicitlySet := meta["retryable_by_model"]; !explicitlySet {
		meta["retryable_by_model"] = !result.OK
	}
	if len(result.Artifacts) > 0 {
		artifacts := make([]map[string]any, 0, len(result.Artifacts))
		for _, artifact := range result.Artifacts {
			artifacts = append(artifacts, map[string]any{
				"path": artifact.Path, "mime_type": artifact.MimeType, "size": artifact.Size, "digest": artifact.Digest,
			})
		}
		meta["artifacts"] = artifacts
	}
	code := result.Code
	if code == "" {
		if result.OK {
			code = "OK"
		} else {
			code = "UNKNOWN_OUTCOME"
		}
	}
	return ToolResultEnvelope{
		Version: ToolResultVersion, OK: result.OK, Code: code,
		Summary: toolResultSummary(code, result.OK), ContentType: "text", Content: content, Meta: meta,
	}
}

func sanitizeToolResultMeta(meta map[string]any) map[string]any {
	if len(meta) == 0 {
		return nil
	}
	sanitized := make(map[string]any, len(meta))
	for key, value := range meta {
		sanitized[key] = sanitizeToolResultMetaValue(key, value, 0)
	}
	return sanitized
}

func sanitizeToolResultMetaValue(key string, value any, depth int) any {
	if sensitiveOutputKeyNamePattern.MatchString(strings.TrimSpace(key)) {
		return "[REDACTED]"
	}
	if depth >= 8 {
		return "[TRUNCATED]"
	}
	switch typed := value.(type) {
	case string:
		return redactToolOutput(typed)
	case map[string]any:
		nested := make(map[string]any, len(typed))
		for nestedKey, nestedValue := range typed {
			nested[nestedKey] = sanitizeToolResultMetaValue(nestedKey, nestedValue, depth+1)
		}
		return nested
	case map[string]string:
		nested := make(map[string]string, len(typed))
		for nestedKey, nestedValue := range typed {
			if sensitiveOutputKeyNamePattern.MatchString(strings.TrimSpace(nestedKey)) {
				nested[nestedKey] = "[REDACTED]"
			} else {
				nested[nestedKey] = redactToolOutput(nestedValue)
			}
		}
		return nested
	case []any:
		items := make([]any, len(typed))
		for index, item := range typed {
			items[index] = sanitizeToolResultMetaValue("", item, depth+1)
		}
		return items
	default:
		return value
	}
}

func MarshalToolResultEnvelope(result *ToolExecutionResult, maxChars int) string {
	envelope := BuildToolResultEnvelope(result, maxChars)
	encoded, err := json.Marshal(envelope)
	if err != nil {
		return fmt.Sprintf(`{"version":"%s","ok":false,"code":"UNKNOWN_OUTCOME","summary":"工具结果无法规整","content_type":"text","content":""}`, ToolResultVersion)
	}
	return string(encoded)
}

func redactToolOutput(content string) string {
	content = sensitiveJSONOutputPattern.ReplaceAllString(content, "$1[REDACTED]")
	return sensitiveOutputPattern.ReplaceAllString(content, "$1[REDACTED]")
}

func truncateToolContent(content string, maxChars int) (string, bool) {
	if maxChars <= 0 || len(content) <= maxChars {
		return content, false
	}
	head := maxChars / 3
	tail := maxChars - head
	if head < 1 {
		head = 1
	}
	if tail < 1 {
		tail = 1
	}
	omitted := len(content) - head - tail
	marker := fmt.Sprintf("\n[中间已省略约 %d 字符]\n", omitted)
	if maxChars <= len(marker)+2 {
		return content[:maxChars], true
	}
	for head+tail+len(marker) > maxChars && tail > 1 {
		tail--
	}
	return content[:head] + marker + content[len(content)-tail:], true
}

func toolResultSummary(code string, ok bool) string {
	if ok || code == "OK" {
		return "工具执行成功"
	}
	switch code {
	case "ARGUMENT_PARSE_ERROR":
		return "工具参数不是合法 JSON"
	case "ARGUMENT_SCHEMA_INVALID":
		return "工具参数不符合 Schema"
	case "ARGUMENT_TOO_LARGE":
		return "工具参数超过安全预算"
	case "PLACEHOLDER_DETECTED":
		return "工具参数包含未替换的占位符"
	case "PATH_ESCAPE_BLOCKED":
		return "工具路径越过允许范围"
	case "DUPLICATE_CALL_SKIPPED":
		return "重复工具调用已跳过"
	case "UNKNOWN_TOOL":
		return "未找到工具"
	case "TOOL_EXECUTION_FAILED":
		return "工具执行失败"
	case "TOOL_EXECUTION_SKIPPED":
		return "工具执行已跳过"
	default:
		return strings.ReplaceAll(code, "_", " ")
	}
}
