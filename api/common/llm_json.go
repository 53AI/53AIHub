package common

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strings"

	"github.com/53AI/53AIHub/common/logger"
)

const (
	defaultLLMJSONPreviewChars = 512
)

// ParseLLMJSONInto 从 LLM 输出中提取并严格解析 JSON 到目标结构。
// 解析流程：
// 1. 收集候选 JSON（代码块内容、平衡括号片段、原始内容）
// 2. 逐个候选做严格 JSON 解码
// 3. 任一成功即返回；全部失败则返回统一错误
func ParseLLMJSONInto(ctx context.Context, content string, target any) error {
	if ctx == nil {
		ctx = context.Background()
	}
	if target == nil {
		return fmt.Errorf("LLM JSON 解析目标不能为空")
	}

	content = strings.TrimSpace(content)
	if content == "" {
		return fmt.Errorf("LLM 响应内容不能为空")
	}

	candidates := extractLLMJSONCandidates(content)
	if len(candidates) == 0 {
		return fmt.Errorf("无法从 LLM 响应中提取 JSON")
	}

	var lastErr error
	for idx, candidate := range candidates {
		if err := strictDecodeJSON(candidate, target); err != nil {
			lastErr = err
			logger.Debugf(ctx, "【工具执行】LLM JSON 候选解析失败: 候选序号=%d, 候选长度=%d, 错误=%v, 片段=%s",
				idx+1, len([]rune(candidate)), err, previewText(candidate, defaultLLMJSONPreviewChars))
			if repaired, changed := repairLLMJSONStringLiterals(candidate); changed {
				if repairErr := strictDecodeJSON(repaired, target); repairErr == nil {
					logger.Debugf(ctx, "【工具执行】LLM JSON 候选经字符串字面量修复后解析成功: 候选序号=%d, 候选长度=%d",
						idx+1, len([]rune(repaired)))
					return nil
				} else {
					lastErr = repairErr
					logger.Debugf(ctx, "【工具执行】LLM JSON 候选修复后仍解析失败: 候选序号=%d, 错误=%v, 片段=%s",
						idx+1, repairErr, previewText(repaired, defaultLLMJSONPreviewChars))
				}
			}
			continue
		}

		if idx > 0 {
			logger.Debugf(ctx, "【工具执行】LLM JSON 解析命中后备候选: 候选序号=%d, 候选长度=%d",
				idx+1, len([]rune(candidate)))
		}
		return nil
	}

	return fmt.Errorf("LLM JSON 解析失败: %w", lastErr)
}

// ParseLLMJSON 是 ParseLLMJSONInto 的泛型包装，适合直接获取结构化返回值。
func ParseLLMJSON[T any](ctx context.Context, content string) (T, error) {
	var result T
	err := ParseLLMJSONInto(ctx, content, &result)
	return result, err
}

func strictDecodeJSON(candidate string, target any) error {
	decoder := json.NewDecoder(strings.NewReader(candidate))
	decoder.DisallowUnknownFields()
	decoder.UseNumber()

	if err := decoder.Decode(target); err != nil {
		return err
	}

	// 严格校验：除了空白字符，不允许存在多余内容。
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		if err == nil {
			return fmt.Errorf("JSON 内容存在多余片段")
		}
		return err
	}

	return nil
}

func repairLLMJSONStringLiterals(content string) (string, bool) {
	if strings.TrimSpace(content) == "" {
		return content, false
	}

	var builder strings.Builder
	builder.Grow(len(content) + 16)

	inString := false
	escaped := false
	changed := false

	for _, r := range content {
		if inString {
			if escaped {
				escaped = false
				builder.WriteRune(r)
				continue
			}

			switch r {
			case '\\':
				escaped = true
				builder.WriteRune(r)
			case '"':
				inString = false
				builder.WriteRune(r)
			case '\n':
				builder.WriteString(`\n`)
				changed = true
			case '\r':
				builder.WriteString(`\r`)
				changed = true
			case '\t':
				builder.WriteString(`\t`)
				changed = true
			default:
				if r < 0x20 {
					builder.WriteString(fmt.Sprintf(`\u%04x`, r))
					changed = true
					continue
				}
				builder.WriteRune(r)
			}
			continue
		}

		if r == '"' {
			inString = true
		}
		builder.WriteRune(r)
	}

	return builder.String(), changed
}

func extractLLMJSONCandidates(content string) []string {
	if strings.TrimSpace(content) == "" {
		return nil
	}

	seen := make(map[string]struct{})
	candidates := make([]string, 0, 4)
	addCandidate := func(candidate string) {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" {
			return
		}
		if _, ok := seen[candidate]; ok {
			return
		}
		seen[candidate] = struct{}{}
		candidates = append(candidates, candidate)
	}

	for _, block := range extractCodeFenceContents(content) {
		addCandidate(block)
		if segment := findFirstBalancedJSONSegment(block); segment != "" {
			addCandidate(segment)
		}
	}

	if segment := findFirstBalancedJSONSegment(content); segment != "" {
		addCandidate(segment)
	}

	addCandidate(content)

	return candidates
}

func extractCodeFenceContents(content string) []string {
	lines := strings.Split(content, "\n")
	blocks := make([]string, 0, 2)

	inFence := false
	var current strings.Builder

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "```") {
			if inFence {
				block := strings.TrimSpace(current.String())
				if block != "" {
					blocks = append(blocks, block)
				}
				current.Reset()
				inFence = false
				continue
			}

			inFence = true
			current.Reset()
			continue
		}

		if inFence {
			current.WriteString(line)
			current.WriteByte('\n')
		}
	}

	if inFence {
		block := strings.TrimSpace(current.String())
		if block != "" {
			blocks = append(blocks, block)
		}
	}

	return blocks
}

func findFirstBalancedJSONSegment(content string) string {
	if strings.TrimSpace(content) == "" {
		return ""
	}

	runes := []rune(content)
	for start := 0; start < len(runes); start++ {
		open := runes[start]
		if open != '{' && open != '[' {
			continue
		}

		if end, ok := scanBalancedJSONSegment(runes, start); ok {
			segment := strings.TrimSpace(string(runes[start:end]))
			if segment != "" {
				return segment
			}
		}
	}

	return ""
}

func scanBalancedJSONSegment(runes []rune, start int) (int, bool) {
	if start < 0 || start >= len(runes) {
		return 0, false
	}

	open := runes[start]
	var close rune
	switch open {
	case '{':
		close = '}'
	case '[':
		close = ']'
	default:
		return 0, false
	}

	depth := 0
	inString := false
	escaped := false

	for i := start; i < len(runes); i++ {
		r := runes[i]

		if inString {
			if escaped {
				escaped = false
				continue
			}
			switch r {
			case '\\':
				escaped = true
			case '"':
				inString = false
			}
			continue
		}

		switch r {
		case '"':
			inString = true
		case open:
			depth++
		case close:
			depth--
			if depth == 0 {
				return i + 1, true
			}
		}
	}

	return 0, false
}

func previewText(content string, limit int) string {
	if limit <= 0 {
		limit = defaultLLMJSONPreviewChars
	}

	runes := []rune(strings.TrimSpace(content))
	if len(runes) <= limit {
		return string(runes)
	}

	return string(runes[:limit]) + "..."
}
