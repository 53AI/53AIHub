package service

import (
	"bytes"
	"strings"
	"text/template"
)

type WikiPromptService struct{}

func NewWikiPromptService() *WikiPromptService {
	return &WikiPromptService{}
}

func (s *WikiPromptService) Render(prompt string, data any) (string, error) {
	return renderWikiPromptTemplate(prompt, data)
}

func (s *WikiPromptService) RenderPageModifyPrompt(input WikiPageModifyInput) (string, error) {
	return renderWikiPromptTemplate(WikiPageModifyPrompt, map[string]any{
		"PageSlug":                input.PageSlug,
		"PageTitle":               input.PageTitle,
		"PageType":                input.PageType,
		"PageAliases":             input.PageAliases,
		"ExistingContent":         input.ExistingContent,
		"NewContent":              input.NewInformation,
		"DeletedContent":          input.DeletedContent,
		"RemainingSourcesContent": input.RemainingSources,
		"AvailableSlugs":          input.AvailableSlugs,
		"Language":                input.Language,
		"HasAdditions":            boolToWikiPromptFlag(input.HasAdditions),
		"HasRetractions":          boolToWikiPromptFlag(input.HasRetractions),
	})
}

func renderWikiPromptTemplate(prompt string, data any) (string, error) {
	tmpl, err := template.New("wiki_prompt").Option("missingkey=error").Parse(prompt)
	if err != nil {
		return "", err
	}

	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, data); err != nil {
		return "", err
	}
	return buf.String(), nil
}

// splitSummaryLine 拆出 SUMMARY 行与其后的正文。
//
// SUMMARY 行必须是**第一行**——这是提示词的明文契约（"Your FIRST line must be
// exactly \"SUMMARY:\"..."）。旧实现取的是"最后一个"匹配的 SUMMARY 行，于是响应
// 前面即使塞了一整段回显，也照样能把后面的 SUMMARY 行摘出来当有效摘要落库，
// 而回显本身被静默丢弃。生产现场（logs/53AIHub-20261021.log, file_id=1978075）：
//
//	 If the content has no substantive information, output only the title line and
//	 explanation sentence.        ← 回显，被静默丢弃
//
//	SUMMARY: 本文档仅包含写作指令，无可提取的实质性内容。
//
//	该来源缺少可综述的材料，仅要求遵循源语言、不使用项目符号、限制在 200 字符内并附加综述行。
//
// 改为只认第一行后，回显会被识别为"首行不是 SUMMARY"而进入契约校验的重试流程。
func splitSummaryLine(raw string) (summary string, content string) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", ""
	}
	lines := strings.Split(raw, "\n")

	first := strings.TrimSpace(lines[0])
	if !strings.HasPrefix(first, "SUMMARY:") && !strings.HasPrefix(first, "SUMMARY：") {
		// 首行不是 SUMMARY：整体当作正文，摘要行留空，由调用方判为违约。
		return "", raw
	}
	summaryLine := strings.TrimPrefix(strings.TrimPrefix(first, "SUMMARY:"), "SUMMARY：")
	body := strings.TrimSpace(strings.Join(lines[1:], "\n"))
	body = strings.TrimPrefix(body, "</summary>")
	return strings.TrimSpace(summaryLine), strings.TrimSpace(body)
}

func cleanLLMJSON(s string) string {
	s = strings.TrimSpace(s)
	s = strings.TrimPrefix(s, "```json")
	s = strings.TrimPrefix(s, "```")
	s = strings.TrimSuffix(s, "```")
	s = strings.TrimSpace(s)
	return sanitizeJSONString(s)
}

func sanitizeJSONString(s string) string {
	var buf strings.Builder
	buf.Grow(len(s))

	inString := false
	escape := false
	for _, r := range s {
		if escape {
			switch r {
			case '\n':
				buf.WriteString("n")
			case '\r':
				buf.WriteString("r")
			case '\t':
				buf.WriteString("t")
			default:
				buf.WriteRune(r)
			}
			escape = false
			continue
		}

		if r == '\\' {
			escape = true
			buf.WriteRune(r)
			continue
		}
		if r == '"' {
			inString = !inString
			buf.WriteRune(r)
			continue
		}

		if inString {
			switch r {
			case '\n':
				buf.WriteString(`\n`)
				continue
			case '\r':
				buf.WriteString(`\r`)
				continue
			case '\t':
				buf.WriteString(`\t`)
				continue
			}
		}

		buf.WriteRune(r)
	}

	return buf.String()
}

func boolToWikiPromptFlag(v bool) string {
	if v {
		return "1"
	}
	return ""
}
