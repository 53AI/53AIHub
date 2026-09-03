package service

import (
	"encoding/json"
	"fmt"
	"strings"
)

const insightPageHTMLFormat = "html_v2"

type insightHTMLPage struct {
	Format  string `json:"format"`
	Version int    `json:"version"`
	HTML    string `json:"html"`
}

// encodeInsightHTMLPage stores the generated document in the existing page_json
// column without changing the schema. Legacy Markdown and block JSON values are
// deliberately left untouched so their historical renderer remains available.
func encodeInsightHTMLPage(rawHTML, sourceMarkdown string) (string, error) {
	html, err := normalizeInsightHTML(rawHTML)
	if err != nil {
		return "", err
	}
	if insightMarkdownNeedsInlineSVG(sourceMarkdown) && !strings.Contains(strings.ToLower(html), "<svg") {
		return "", fmt.Errorf("第一步包含 Mermaid 图，但第二步 HTML 未生成内联 SVG")
	}
	payload, err := json.Marshal(insightHTMLPage{
		Format:  insightPageHTMLFormat,
		Version: 1,
		HTML:    html,
	})
	if err != nil {
		return "", fmt.Errorf("序列化洞察 HTML 页面失败: %w", err)
	}
	return string(payload), nil
}

func insightMarkdownNeedsInlineSVG(markdown string) bool {
	lower := strings.ToLower(markdown)
	return strings.Contains(lower, "```mermaid") || strings.Contains(lower, "~~~mermaid")
}

func normalizeInsightHTML(rawHTML string) (string, error) {
	html := strings.TrimSpace(rawHTML)
	html = strings.TrimPrefix(html, "\ufeff")
	if strings.HasPrefix(html, "```") {
		lines := strings.Split(html, "\n")
		if len(lines) >= 3 && strings.HasPrefix(strings.TrimSpace(lines[len(lines)-1]), "```") {
			html = strings.TrimSpace(strings.Join(lines[1:len(lines)-1], "\n"))
		}
	}
	if html == "" {
		return "", fmt.Errorf("洞察 HTML 页面为空")
	}
	if !strings.HasPrefix(strings.ToLower(html), "<!doctype html>") ||
		!strings.Contains(strings.ToLower(html), "<html") ||
		!strings.Contains(strings.ToLower(html), "</html>") {
		return "", fmt.Errorf("洞察 HTML 页面不是完整 HTML 文档")
	}

	// The page is rendered in a sandboxed iframe, but reject active content and
	// remote dependencies before persistence as a second safety boundary.
	lower := strings.ToLower(html)
	for _, forbidden := range []string{
		"<script",
		"</script",
		"javascript:",
		"<iframe",
		"<object",
		"<embed",
		"<form",
		" onload=",
		" onclick=",
		" onerror=",
		" src=http",
		" src='http",
		" src=\"http",
		" href=http",
		" href='http",
		" href=\"http",
	} {
		if strings.Contains(lower, forbidden) {
			return "", fmt.Errorf("洞察 HTML 页面包含不允许的内容: %s", forbidden)
		}
	}
	return html, nil
}
