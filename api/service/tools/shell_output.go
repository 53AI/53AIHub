package tools

import (
	"fmt"
	"strings"
	"unicode"
)

const shellOutputVisibleLimit = 12000

var shellErrorKeywords = []string{"error", "failed", "failure", "fatal", "panic", "traceback", "exception", "permission denied", "not found", "undefined", "segmentation fault", "exit code"}

func shapeShellOutput(stdout, stderr string, exitCode int) (string, map[string]interface{}) {
	raw := formatCommandResult(stdout, stderr, exitCode)
	sanitized, binary := sanitizeShellOutput(raw)
	lines := strings.Split(sanitized, "\n")
	meta := map[string]interface{}{"total_lines": len(lines), "total_bytes": len([]byte(raw)), "truncated": false}
	if binary {
		meta["code"] = "SHELL_BINARY_OUTPUT_SANITIZED"
	}
	if len(sanitized) <= shellOutputVisibleLimit {
		return sanitized, meta
	}
	headCount, tailCount := 30, 180
	if headCount > len(lines) {
		headCount = len(lines)
	}
	if tailCount > len(lines)-headCount {
		tailCount = len(lines) - headCount
	}
	selected := make(map[int]struct{})
	for i := 0; i < headCount; i++ {
		selected[i] = struct{}{}
	}
	for i := len(lines) - tailCount; i < len(lines); i++ {
		if i >= 0 {
			selected[i] = struct{}{}
		}
	}
	for i, line := range lines {
		lower := strings.ToLower(line)
		for _, keyword := range shellErrorKeywords {
			if strings.Contains(lower, keyword) {
				for contextLine := i - 2; contextLine <= i+2; contextLine++ {
					if contextLine >= 0 && contextLine < len(lines) {
						selected[contextLine] = struct{}{}
					}
				}
				break
			}
		}
	}
	var builder strings.Builder
	omitted := 0
	for i, line := range lines {
		if _, ok := selected[i]; !ok {
			omitted++
			continue
		}
		builder.WriteString(line)
		builder.WriteByte('\n')
		if builder.Len() >= shellOutputVisibleLimit {
			break
		}
	}
	builder.WriteString(fmt.Sprintf("\n[中间已省略 %d 行；完整输出未通过当前 Sandbox 协议保存。]\n", omitted))
	meta["truncated"] = true
	meta["truncate_reason"] = "error_aware"
	return strings.TrimSpace(builder.String()), meta
}

func sanitizeShellOutput(value string) (string, bool) {
	var builder strings.Builder
	controls := 0
	for _, r := range value {
		if r == '\n' || r == '\t' || r == '\r' || r >= 32 && !unicode.IsControl(r) {
			builder.WriteRune(r)
			continue
		}
		controls++
	}
	return builder.String(), controls > len(value)/20
}
