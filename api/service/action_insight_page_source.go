package service

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/53AI/53AIHub/model"
	"golang.org/x/net/html"
)

// loadFormalInsightPageText returns the user-visible text of the persisted
// InsightPage. Action detection and planning must use this formal source; the
// legacy files.insight_summary column is not an Action source of truth.
func loadFormalInsightPageText(fileID int64) (string, error) {
	page, err := model.GetRecordingFileInsightPageByFileID(fileID)
	if err != nil {
		return "", err
	}
	var payload insightHTMLPage
	if err := json.Unmarshal([]byte(page.PageJSON), &payload); err != nil {
		return "", fmt.Errorf("解析洞察页面失败: %w", err)
	}
	if payload.Format != insightPageHTMLFormat || strings.TrimSpace(payload.HTML) == "" {
		return "", fmt.Errorf("洞察页面格式不可用于行动")
	}
	text := extractInsightPageText(payload.HTML)
	if text == "" {
		return "", fmt.Errorf("洞察页面没有可用正文")
	}
	return text, nil
}

func extractInsightPageText(rawHTML string) string {
	doc, err := html.Parse(strings.NewReader(rawHTML))
	if err != nil {
		return ""
	}
	var parts []string
	var visit func(*html.Node, bool)
	visit = func(node *html.Node, skip bool) {
		if node == nil {
			return
		}
		if node.Type == html.ElementNode {
			tag := strings.ToLower(node.Data)
			if tag == "script" || tag == "style" || tag == "noscript" || tag == "head" {
				skip = true
			}
		}
		if !skip && node.Type == html.TextNode {
			if value := strings.Join(strings.Fields(node.Data), " "); value != "" {
				parts = append(parts, value)
			}
		}
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			visit(child, skip)
		}
	}
	visit(doc, false)
	return strings.TrimSpace(strings.Join(parts, " "))
}
