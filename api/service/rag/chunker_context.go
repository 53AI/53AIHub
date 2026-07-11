package rag

import (
	"regexp"
	"strings"
)

var markdownHeaderPattern = regexp.MustCompile(`(?m)^(#{1,6})\s+(.+)$`)

// extractMarkdownHeaderTitles 提取 Markdown 标题文本，按出现顺序返回。
func extractMarkdownHeaderTitles(content string) []string {
	matches := markdownHeaderPattern.FindAllStringSubmatch(content, -1)
	if len(matches) == 0 {
		return nil
	}

	titles := make([]string, 0, len(matches))
	for _, match := range matches {
		if len(match) < 3 {
			continue
		}
		title := strings.TrimSpace(match[2])
		if title == "" {
			continue
		}
		titles = append(titles, title)
	}
	return titles
}

// extractMarkdownSubtitle 从 Markdown 内容中提取最具体的子标题。
// 规则：优先取最后一个标题；如果只有一个标题，则认为没有额外子标题。
func extractMarkdownSubtitle(content string) string {
	titles := extractMarkdownHeaderTitles(content)
	if len(titles) < 2 {
		return ""
	}

	rootTitle := strings.TrimSpace(titles[0])
	for i := len(titles) - 1; i >= 1; i-- {
		title := strings.TrimSpace(titles[i])
		if title == "" {
			continue
		}
		if rootTitle != "" && title == rootTitle {
			continue
		}
		return title
	}

	return ""
}

// buildChunkContextPrefix 根据开关构建内容前缀，避免重复注入相同文本。
func buildChunkContextPrefix(fileName, documentTitle, subtitle string, includeFileName, includeTitle, includeSubtitle bool) string {
	parts := make([]string, 0, 3)
	appendUnique := func(value string) {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			return
		}
		for _, existing := range parts {
			if existing == trimmed {
				return
			}
		}
		parts = append(parts, trimmed)
	}

	if includeFileName {
		appendUnique(fileName)
	}
	if includeTitle {
		appendUnique(documentTitle)
	}
	if includeSubtitle {
		appendUnique(subtitle)
	}

	if len(parts) == 0 {
		return ""
	}

	return strings.Join(parts, "\n\n") + "\n\n"
}
