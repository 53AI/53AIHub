package rag

import (
	"regexp"
	"strconv"
	"strings"
)

type pageSegment struct {
	Key           string
	RawPageNumber string
	Content       string
	StartPosition int
	EndPosition   int
}

var pageMarkerPattern = regexp.MustCompile(`(?m)^[ \t]*<!--[ \t]*page:[ \t]*([^>\r\n]*?)[ \t]*-->[ \t]*(?:\r?\n|$)`)

func splitContentByPages(content string) []pageSegment {
	matches := pageMarkerPattern.FindAllStringSubmatchIndex(content, -1)
	if len(matches) == 0 {
		trimmed := strings.TrimSpace(content)
		if trimmed == "" {
			return nil
		}
		return []pageSegment{{Key: "page-0", Content: trimmed, StartPosition: 0, EndPosition: len(content)}}
	}

	pages := make([]pageSegment, 0, len(matches)+1)
	pageStart := 0
	pageIndex := 0
	appendPage := func(end int, rawPageNumber string) {
		pageContent := strings.TrimSpace(content[pageStart:end])
		if pageContent == "" {
			return
		}
		pages = append(pages, pageSegment{
			Key:           "page-" + strconv.Itoa(pageIndex),
			RawPageNumber: strings.TrimSpace(rawPageNumber),
			Content:       pageContent,
			StartPosition: pageStart,
			EndPosition:   end,
		})
		pageIndex++
	}

	for _, match := range matches {
		appendPage(match[0], content[match[2]:match[3]])
		pageStart = match[1]
	}
	appendPage(len(content), "")
	return pages
}
