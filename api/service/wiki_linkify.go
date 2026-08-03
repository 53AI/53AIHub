package service

import (
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

type linkRef struct {
	slug      string
	matchText string
}

type span struct {
	start int
	end   int
}

func linkifyWikiContent(content string, refs []linkRef, selfSlug string) (string, bool) {
	if content == "" || len(refs) == 0 {
		return content, false
	}

	sortedRefs := make([]linkRef, 0, len(refs))
	for _, ref := range refs {
		if ref.slug == "" || ref.matchText == "" || ref.slug == selfSlug {
			continue
		}
		sortedRefs = append(sortedRefs, ref)
	}
	sort.SliceStable(sortedRefs, func(i, j int) bool {
		return utf8.RuneCountInString(sortedRefs[i].matchText) >
			utf8.RuneCountInString(sortedRefs[j].matchText)
	})

	forbidden, used := computeWikiForbiddenSpans(content)
	changed := false

	for _, ref := range sortedRefs {
		if _, ok := used[ref.slug]; ok {
			continue
		}
		pos := findFirstSafeWikiMatch(content, ref.matchText, forbidden)
		if pos < 0 {
			continue
		}
		replacement := "[[" + ref.slug + "|" + ref.matchText + "]]"
		content = content[:pos] + replacement + content[pos+len(ref.matchText):]
		delta := len(replacement) - len(ref.matchText)
		forbidden = shiftWikiSpansAfter(forbidden, pos, delta)
		forbidden = append(forbidden, span{start: pos, end: pos + len(replacement)})
		sortWikiSpans(forbidden)
		used[ref.slug] = struct{}{}
		changed = true
	}

	return content, changed
}

func loadWikiLinkRefsForLibrary(tx *gorm.DB, eid, libraryID int64, selfSlug string) ([]linkRef, error) {
	if tx == nil {
		return nil, nil
	}

	var pages []model.WikiPage
	query := tx.Where("eid = ? AND library_id = ? AND status = ? AND page_type IN ? AND slug <> ?",
		eid, libraryID, model.WikiPageStatusActive, []string{
			model.WikiPageTypeSummary,
			model.WikiPageTypeEntity,
			model.WikiPageTypeConcept,
		}, selfSlug).Select("slug", "title", "aliases")
	if err := query.Find(&pages).Error; err != nil {
		return nil, err
	}

	refs := make([]linkRef, 0, len(pages))
	for _, page := range pages {
		seenMatch := make(map[string]struct{}, 1+len(page.Aliases))
		title := strings.TrimSpace(page.Title)
		if title == "" {
			title = strings.TrimSpace(page.Slug)
		}
		if len([]rune(title)) >= 2 {
			if _, ok := seenMatch[title]; !ok {
				seenMatch[title] = struct{}{}
				refs = append(refs, linkRef{
					slug:      page.Slug,
					matchText: title,
				})
			}
		}
		for _, alias := range normalizeWikiPageAliases(page.Aliases) {
			if len([]rune(alias)) < 2 {
				continue
			}
			if _, ok := seenMatch[alias]; ok {
				continue
			}
			seenMatch[alias] = struct{}{}
			refs = append(refs, linkRef{
				slug:      page.Slug,
				matchText: alias,
			})
		}
	}
	return refs, nil
}

func linkifyWikiPageContent(tx *gorm.DB, eid, libraryID int64, selfSlug, content string) (string, bool, error) {
	refs, err := loadWikiLinkRefsForLibrary(tx, eid, libraryID, selfSlug)
	if err != nil {
		return content, false, err
	}
	linked, changed := linkifyWikiContent(content, refs, selfSlug)
	return linked, changed, nil
}

func findFirstSafeWikiMatch(haystack, needle string, forbidden []span) int {
	if needle == "" {
		return -1
	}
	needsBoundary := hasWikiASCIILetterEdge(needle)

	start := 0
	for start <= len(haystack)-len(needle) {
		rel := strings.Index(haystack[start:], needle)
		if rel < 0 {
			return -1
		}
		pos := start + rel
		end := pos + len(needle)

		if spanWikiContains(forbidden, pos, end) {
			start = pos + 1
			continue
		}
		if needsBoundary && !hasWikiWordBoundary(haystack, pos, end) {
			start = pos + 1
			continue
		}
		return pos
	}
	return -1
}

func hasWikiASCIILetterEdge(s string) bool {
	if s == "" {
		return false
	}
	first, _ := utf8.DecodeRuneInString(s)
	last, _ := utf8.DecodeLastRuneInString(s)
	return isWikiASCIIWordRune(first) || isWikiASCIIWordRune(last)
}

func isWikiASCIIWordRune(r rune) bool {
	if r > unicode.MaxASCII {
		return false
	}
	return r == '_' || (r >= '0' && r <= '9') ||
		(r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z')
}

func hasWikiWordBoundary(s string, pos, end int) bool {
	if pos > 0 {
		r, _ := utf8.DecodeLastRuneInString(s[:pos])
		if isWikiASCIIWordRune(r) {
			return false
		}
	}
	if end < len(s) {
		r, _ := utf8.DecodeRuneInString(s[end:])
		if isWikiASCIIWordRune(r) {
			return false
		}
	}
	return true
}

func spanWikiContains(spans []span, pos, end int) bool {
	for _, sp := range spans {
		if pos < sp.end && end > sp.start {
			return true
		}
	}
	return false
}

func shiftWikiSpansAfter(spans []span, pivot, delta int) []span {
	if delta == 0 {
		return spans
	}
	out := make([]span, len(spans))
	for i, sp := range spans {
		if sp.start >= pivot {
			sp.start += delta
			sp.end += delta
		}
		out[i] = sp
	}
	return out
}

func sortWikiSpans(spans []span) {
	sort.Slice(spans, func(i, j int) bool {
		if spans[i].start != spans[j].start {
			return spans[i].start < spans[j].start
		}
		return spans[i].end < spans[j].end
	})
}

func computeWikiForbiddenSpans(s string) ([]span, map[string]struct{}) {
	spans := make([]span, 0, 8)
	used := make(map[string]struct{})
	i := 0
	n := len(s)

	for _, sp := range scanWikiReferenceDefinitions(s) {
		spans = append(spans, sp)
	}

	for i < n {
		if isWikiFenceStart(s, i) {
			fenceLen, fenceCh := wikiFenceRun(s, i)
			end := findWikiFenceEnd(s, i+fenceLen, fenceCh, fenceLen)
			spans = append(spans, span{start: i, end: end})
			i = end
			continue
		}

		c := s[i]
		switch c {
		case '`':
			run := 1
			for i+run < n && s[i+run] == '`' {
				run++
			}
			closeIdx := findWikiInlineCodeClose(s, i+run, run)
			if closeIdx < 0 {
				i += run
				continue
			}
			spans = append(spans, span{start: i, end: closeIdx + run})
			i = closeIdx + run
		case '[':
			if i+1 < n && s[i+1] == '[' {
				if close := strings.Index(s[i+2:], "]]"); close >= 0 {
					end := i + 2 + close + 2
					inner := s[i+2 : i+2+close]
					if slug := extractWikiSlug(inner); slug != "" {
						used[slug] = struct{}{}
					}
					spans = append(spans, span{start: i, end: end})
					i = end
					continue
				}
			}
			if end, ok := matchWikiMarkdownLink(s, i); ok {
				spans = append(spans, span{start: i, end: end})
				i = end
				continue
			}
			if end, ok := matchWikiReferenceStyleLink(s, i); ok {
				spans = append(spans, span{start: i, end: end})
				i = end
				continue
			}
			i++
		case '!':
			if i+1 < n && s[i+1] == '[' {
				if end, ok := matchWikiMarkdownLink(s, i+1); ok {
					spans = append(spans, span{start: i, end: end})
					i = end
					continue
				}
				if end, ok := matchWikiReferenceStyleLink(s, i+1); ok {
					spans = append(spans, span{start: i, end: end})
					i = end
					continue
				}
			}
			i++
		case '<':
			if end, ok := matchWikiAutolink(s, i); ok {
				spans = append(spans, span{start: i, end: end})
				i = end
				continue
			}
			i++
		default:
			i++
		}
	}

	sortWikiSpans(spans)
	return spans, used
}

func extractWikiSlug(inner string) string {
	if pipe := strings.IndexByte(inner, '|'); pipe >= 0 {
		inner = inner[:pipe]
	}
	inner = strings.TrimSpace(inner)
	if inner == "" {
		return ""
	}
	return inner
}

func isWikiFenceStart(s string, i int) bool {
	if i != 0 && s[i-1] != '\n' {
		return false
	}
	return strings.HasPrefix(s[i:], "```") || strings.HasPrefix(s[i:], "~~~")
}

func wikiFenceRun(s string, i int) (int, byte) {
	fenceCh := s[i]
	run := 1
	for i+run < len(s) && s[i+run] == fenceCh {
		run++
	}
	return run, fenceCh
}

func findWikiFenceEnd(s string, start int, fenceCh byte, fenceLen int) int {
	if fenceLen <= 0 {
		return len(s)
	}
	for i := start; i < len(s); i++ {
		if s[i] != fenceCh {
			continue
		}
		run := 1
		for i+run < len(s) && s[i+run] == fenceCh {
			run++
		}
		if run >= fenceLen {
			for j := i + run; j < len(s); j++ {
				if s[j] == '\n' {
					return j + 1
				}
			}
			return len(s)
		}
	}
	return len(s)
}

func findWikiInlineCodeClose(s string, start int, run int) int {
	for i := start; i < len(s); i++ {
		if s[i] != '`' {
			continue
		}
		cnt := 1
		for i+cnt < len(s) && s[i+cnt] == '`' {
			cnt++
		}
		if cnt == run {
			return i
		}
		i += cnt - 1
	}
	return -1
}

func matchWikiMarkdownLink(s string, i int) (int, bool) {
	if i >= len(s) || s[i] != '[' {
		return 0, false
	}
	close := strings.IndexByte(s[i+1:], ']')
	if close < 0 {
		return 0, false
	}
	close += i + 1
	if close+1 >= len(s) || s[close+1] != '(' {
		return 0, false
	}
	end := close + 2
	depth := 1
	for end < len(s) && depth > 0 {
		switch s[end] {
		case '(':
			depth++
		case ')':
			depth--
		}
		end++
	}
	if depth != 0 {
		return 0, false
	}
	return end, true
}

func matchWikiReferenceStyleLink(s string, i int) (int, bool) {
	if i >= len(s) || s[i] != '[' {
		return 0, false
	}
	textEnd, ok := findWikiClosingBracket(s, i)
	if !ok {
		return 0, false
	}
	if textEnd+1 >= len(s) || s[textEnd+1] != '[' {
		return 0, false
	}
	labelEnd, ok := findWikiClosingBracket(s, textEnd+1)
	if !ok {
		return 0, false
	}
	return labelEnd + 1, true
}

func findWikiClosingBracket(s string, i int) (int, bool) {
	if i >= len(s) || s[i] != '[' {
		return 0, false
	}
	depth := 1
	for j := i + 1; j < len(s); j++ {
		switch s[j] {
		case '\\':
			if j+1 < len(s) {
				j++
				continue
			}
		case '[':
			depth++
		case ']':
			depth--
			if depth == 0 {
				return j, true
			}
		case '\n':
			return 0, false
		}
	}
	return 0, false
}

func scanWikiReferenceDefinitions(s string) []span {
	var out []span
	lineStart := 0
	for lineStart < len(s) {
		nl := strings.IndexByte(s[lineStart:], '\n')
		lineEnd := len(s)
		if nl >= 0 {
			lineEnd = lineStart + nl + 1
		}
		indent := 0
		for indent < 3 && lineStart+indent < lineEnd && s[lineStart+indent] == ' ' {
			indent++
		}
		start := lineStart + indent
		if start < lineEnd && s[start] == '[' {
			if labelEnd, ok := findWikiClosingBracket(s, start); ok && labelEnd+1 < lineEnd && s[labelEnd+1] == ':' {
				out = append(out, span{start: lineStart, end: lineEnd})
			}
		}
		lineStart = lineEnd
	}
	return out
}

func matchWikiAutolink(s string, i int) (int, bool) {
	if i >= len(s) || s[i] != '<' {
		return 0, false
	}
	end := strings.IndexByte(s[i+1:], '>')
	if end < 0 {
		return 0, false
	}
	end += i + 2
	return end, true
}
