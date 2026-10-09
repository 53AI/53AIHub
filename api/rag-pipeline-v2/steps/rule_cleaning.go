package steps

import (
	"regexp"
	"strings"
)

// ruleCleaningResult 单条规则替换记录，用于日志与统计，不进入 LLM。
type ruleCleaningResult struct {
	RuleCode    string // 手机号/邮箱/身份证/银行卡/API Key
	Original    string
	Replacement string
}

// 纯页码行：如 "第 3 页"、"3"、"3/10"、"- 12 -"、"Page 3 of 5"
var invalidTagPageNumberPattern = regexp.MustCompile(`^\s*(?:[-—–]?\s*\d{1,4}\s*[-—–]?\s*|\d{1,4}\s*/\s*\d{1,4}|第\s*\d{1,4}\s*页|Page\s+\d{1,4}(?:\s+of\s+\d{1,4})?)\s*$`)

// 页眉/页脚前缀行（小写匹配）
var invalidTagHeaderFooterPattern = regexp.MustCompile(`^\s*(?:页眉|页脚|header|footer)[:：\s]`)

// ruleCleanInvalidTags 移除纯页码行与页眉页脚行，保留其余内容与行结构。
func ruleCleanInvalidTags(content string) string {
	lines := strings.Split(content, "\n")
	kept := make([]string, 0, len(lines))
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		lower := strings.ToLower(trimmed)
		if trimmed != "" && (invalidTagPageNumberPattern.MatchString(trimmed) || invalidTagHeaderFooterPattern.MatchString(lower)) {
			continue
		}
		kept = append(kept, line)
	}
	return strings.Join(kept, "\n")
}

// 敏感信息正则。执行顺序硬约束：身份证/银行卡（长数字）必须先于手机号执行，
// 防止身份证内部的 1[3-9] 开头 11 位子串被手机号规则误命中。
var (
	idCardPattern   = regexp.MustCompile(`[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]`)
	bankCardPattern = regexp.MustCompile(`(?:62|60|48|45|43|40)\d{13,16}`)
	phonePattern    = regexp.MustCompile(`(?:^|\D)(1[3-9]\d{9})(?:\D|$)`)
	emailPattern    = regexp.MustCompile(`[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}`)
	apiKeyPattern   = regexp.MustCompile(`(?:sk-[A-Za-z0-9]{16,}|api[_-]?key[:=]\s*[A-Za-z0-9_\-]{16,})`)
)

// ruleCleanSensitive 按开启字段执行确定性脱敏，格式与现有 LLM 脱敏 prompt 一致。
// fieldsKey 为 cfg.SensitiveMask.Fields 集合；姓名无可靠正则边界，不在规则集内，由 LLM 处理。
func ruleCleanSensitive(content string, fieldsKey map[string]bool) (string, []ruleCleaningResult) {
	var results []ruleCleaningResult
	mask := func(code string, re *regexp.Regexp, replacer func(match string) string) {
		if !fieldsKey[code] {
			return
		}
		content = re.ReplaceAllStringFunc(content, func(m string) string {
			r := replacer(m)
			results = append(results, ruleCleaningResult{RuleCode: code, Original: m, Replacement: r})
			return r
		})
	}
	mask("身份证", idCardPattern, func(m string) string {
		return m[:4] + strings.Repeat("*", len(m)-8) + m[len(m)-4:]
	})
	mask("银行卡", bankCardPattern, func(m string) string {
		return m[:4] + strings.Repeat("*", len(m)-8) + m[len(m)-4:]
	})
	// 手机号：边界断言消费前后非数字字符，用捕获组只替换命中体
	if fieldsKey["手机号"] {
		content = phonePattern.ReplaceAllStringFunc(content, func(m string) string {
			core := regexp.MustCompile(`1[3-9]\d{9}`).FindString(m)
			if core == "" {
				return m
			}
			r := core[:3] + "****" + core[7:]
			results = append(results, ruleCleaningResult{RuleCode: "手机号", Original: core, Replacement: r})
			return strings.Replace(m, core, r, 1)
		})
	}
	mask("邮箱", emailPattern, func(m string) string {
		at := strings.Index(m, "@")
		return m[:1] + "****" + m[at:]
	})
	mask("API Key", apiKeyPattern, func(m string) string {
		return m[:3] + strings.Repeat("*", len(m)-3)
	})
	return content, results
}
