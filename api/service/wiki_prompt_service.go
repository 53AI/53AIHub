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

func splitSummaryLine(raw string) (summary string, content string) {
	raw = strings.TrimSpace(raw)
	if strings.HasPrefix(raw, "SUMMARY:") || strings.HasPrefix(raw, "SUMMARY：") {
		idx := strings.IndexByte(raw, '\n')
		if idx < 0 {
			trimmed := strings.TrimPrefix(raw, "SUMMARY:")
			trimmed = strings.TrimPrefix(trimmed, "SUMMARY：")
			return strings.TrimSpace(trimmed), ""
		}

		summaryLine := raw[:idx]
		summaryLine = strings.TrimPrefix(summaryLine, "SUMMARY:")
		summaryLine = strings.TrimPrefix(summaryLine, "SUMMARY：")
		return strings.TrimSpace(summaryLine), strings.TrimSpace(raw[idx+1:])
	}

	return "", raw
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
