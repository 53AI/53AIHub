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
	// Prompt 5 规范允许在简单流程时用 div 布局模拟流程图，因此不强制拦截无 <svg 的 HTML
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

func normalizeInsightHTML(rawHTML string) (string, error) {
	html := strings.TrimSpace(rawHTML)
	html = strings.TrimPrefix(html, "\ufeff")
	if html == "" {
		return "", fmt.Errorf("洞察 HTML 页面为空")
	}

	html = extractInsightHTMLDocument(html)
	if html == "" {
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
	// Generated citation CSS is not reliable enough to control the default
	// state. Keep the detail hidden until the citation is hovered or focused.
	if (strings.Contains(lower, "insight-citation") || strings.Contains(lower, "memory-citation")) && !strings.Contains(lower, `id="insight-citation-visibility"`) {
		const citationCSS = `<style id="insight-citation-visibility">.insight-citation .insight-citation-popover,.insight-citation .citation-popover,.memory-citation .memory-popover{display:none!important}.insight-citation:hover .insight-citation-popover,.insight-citation:focus .insight-citation-popover,.insight-citation:focus-within .insight-citation-popover,.insight-citation:hover .citation-popover,.insight-citation:focus .citation-popover,.insight-citation:focus-within .citation-popover,.memory-citation:hover .memory-popover,.memory-citation:focus .memory-popover,.memory-citation:focus-within .memory-popover{display:block!important}</style>`
		if at := strings.LastIndex(strings.ToLower(html), "</head>"); at >= 0 {
			html = html[:at] + citationCSS + html[at:]
		} else if at := strings.LastIndex(strings.ToLower(html), "</body>"); at >= 0 {
			html = html[:at] + citationCSS + html[at:]
		}
	}
	return html, nil
}

func extractInsightHTMLDocument(rawHTML string) string {
	if fenced := extractFencedInsightHTML(rawHTML); fenced != "" {
		rawHTML = fenced
	}

	lower := strings.ToLower(rawHTML)
	start := indexHTMLTag(lower, "<html")
	if start < 0 {
		return ""
	}

	closingStart := indexHTMLTag(lower[start:], "</html")
	if closingStart < 0 {
		return ""
	}
	closingStart += start
	closingEnd := strings.IndexByte(rawHTML[closingStart:], '>')
	if closingEnd < 0 {
		return ""
	}
	closingEnd += closingStart + 1

	documentStart := start
	prefix := rawHTML[:start]
	if doctypeStart := strings.LastIndex(strings.ToLower(prefix), "<!doctype html>"); doctypeStart >= 0 && strings.TrimSpace(prefix[doctypeStart+len("<!doctype html>"):]) == "" {
		documentStart = doctypeStart
	}

	document := strings.TrimSpace(rawHTML[documentStart:closingEnd])
	if !strings.HasPrefix(strings.ToLower(document), "<!doctype html>") {
		document = "<!doctype html>\n" + document
	}
	return document
}

func extractFencedInsightHTML(rawHTML string) string {
	lines := strings.Split(rawHTML, "\n")
	for start, line := range lines {
		fence := strings.TrimSpace(line)
		if !strings.HasPrefix(fence, "```") {
			continue
		}
		language := strings.TrimSpace(strings.TrimPrefix(fence, "```"))
		if language != "" && !strings.EqualFold(language, "html") {
			continue
		}
		for end := start + 1; end < len(lines); end++ {
			if strings.HasPrefix(strings.TrimSpace(lines[end]), "```") {
				candidate := strings.TrimSpace(strings.Join(lines[start+1:end], "\n"))
				if indexHTMLTag(strings.ToLower(candidate), "<html") >= 0 {
					return candidate
				}
				break
			}
		}
	}
	return ""
}

func indexHTMLTag(input, tag string) int {
	for offset := 0; offset < len(input); {
		index := strings.Index(input[offset:], tag)
		if index < 0 {
			return -1
		}
		index += offset
		end := index + len(tag)
		if end == len(input) || strings.ContainsRune(" \t\r\n>", rune(input[end])) {
			return index
		}
		offset = end
	}
	return -1
}
