package logger

import (
	"fmt"
	"strings"
)

// truncateString 截断字符串，如果超过指定长度则添加省略号
func truncateString(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "... (truncated)"
}

// formatLogParams 格式化日志参数，对长参数进行截断处理
func FormatLogParams(params string) string {
	// 限制参数长度为1000字符
	return truncateString(params, 1000)
}

// formatErrorResp 格式化错误响应，确保完整显示错误信息
func FormatErrorResp(resp string) string {
	// 错误响应通常比较重要，限制长度为5000字符
	return truncateString(resp, 5000)
}

// FormatLogMessage 格式化日志消息，添加适当的换行和分隔符
func FormatLogMessage(title, content string) string {
	if content == "" {
		return fmt.Sprintf("%s\n", title)
	}
	return fmt.Sprintf("%s\n%s\n", title, content)
}

// FormatKeyValue 格式化键值对日志
func FormatKeyValue(key, value string) string {
	return fmt.Sprintf("%s: %s", key, value)
}

// FormatList 格式化列表日志
func FormatList(title string, items []string) string {
	if len(items) == 0 {
		return fmt.Sprintf("%s: (empty)\n", title)
	}
	var sb strings.Builder
	for i, item := range items {
		if i > 0 {
			sb.WriteString("\n")
		}
		sb.WriteString(fmt.Sprintf("  %d. %s", i+1, item))
	}
	return fmt.Sprintf("%s:\n%s\n", title, sb.String())
}
