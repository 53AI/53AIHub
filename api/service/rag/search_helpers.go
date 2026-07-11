package rag

import (
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/53AI/53AIHub/model"
)

var searchTimingKeys = []string{
	"scope_narrowing_ms",
	"embedding_ms",
	"qdrant_search_ms",
	"vector_search_ms",
	"enrich_ms",
	"permission_ms",
	"save_query_ms",
}

type searchTimingRecorder struct {
	mu      sync.Mutex
	timings map[string]int64
}

func newSearchTimingRecorder() *searchTimingRecorder {
	timings := make(map[string]int64, len(searchTimingKeys))
	for _, key := range searchTimingKeys {
		timings[key] = 0
	}
	return &searchTimingRecorder{timings: timings}
}

func (r *searchTimingRecorder) add(key string, duration time.Duration) {
	if r == nil {
		return
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	if r.timings == nil {
		r.timings = make(map[string]int64, len(searchTimingKeys))
	}
	r.timings[key] += duration.Milliseconds()
}

func (r *searchTimingRecorder) snapshot() map[string]int64 {
	out := make(map[string]int64, len(searchTimingKeys))
	for _, key := range searchTimingKeys {
		out[key] = 0
	}
	if r == nil {
		return out
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	for key, value := range r.timings {
		out[key] = value
	}
	return out
}

type entityScopeNarrowMeta struct {
	SeedEntities        []string
	SeedEntityIDs       []int64
	ChunkCandidateCount int
}

var scopeYearPattern = regexp.MustCompile(`(?:19|20)\d{2}(?:年)?`)

type scopeSignals struct {
	Phrases           []string
	SubjectTerms      []string
	YearTerms         []string
	DocumentTypeTerms []string
}

func buildScopeSignals(query string, keywords []string, documentType string) scopeSignals {
	signals := scopeSignals{}

	addPhrase := func(term string) {
		term = strings.TrimSpace(term)
		if term == "" {
			return
		}
		signals.Phrases = appendUniqueStrings(signals.Phrases, []string{term})
	}

	addPhrase(query)
	for _, kw := range keywords {
		addPhrase(kw)
	}

	documentType = strings.TrimSpace(documentType)
	for _, phrase := range signals.Phrases {
		signals.YearTerms = appendUniqueStrings(signals.YearTerms, extractScopeYearTerms(phrase))
		signals.SubjectTerms = appendUniqueStrings(signals.SubjectTerms, extractScopeSubjectTerms(phrase, documentType))
	}

	if documentType != "" {
		signals.DocumentTypeTerms = appendUniqueStrings(signals.DocumentTypeTerms, []string{documentType})
	}

	signals.SubjectTerms = normalizeEntityKeywords(signals.SubjectTerms)
	signals.YearTerms = normalizeEntityKeywords(signals.YearTerms)
	signals.DocumentTypeTerms = normalizeEntityKeywords(signals.DocumentTypeTerms)
	return signals
}

func extractScopeYearTerms(text string) []string {
	matches := scopeYearPattern.FindAllString(text, -1)
	if len(matches) == 0 {
		return nil
	}
	return normalizeEntityKeywords(matches)
}

func extractScopeSubjectTerms(text string, documentType string) []string {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return nil
	}

	stripped := scopeYearPattern.ReplaceAllString(trimmed, " ")
	if documentType != "" {
		stripped = strings.ReplaceAll(stripped, documentType, " ")
	}

	parts := strings.FieldsFunc(stripped, func(r rune) bool {
		switch r {
		case ' ', '\t', '\n', '\r', ',', '，', '。', '；', ';', '、', '/', '\\', '|', '-', '_', '+', ':', '：', '.', '(', ')', '[', ']', '{', '}', '<', '>', '"', '\'':
			return true
		}
		return unicode.IsSpace(r) || unicode.IsPunct(r)
	})
	if len(parts) == 0 {
		return nil
	}

	candidates := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if scopeYearPattern.MatchString(part) {
			continue
		}
		if len([]rune(part)) < 2 {
			continue
		}
		candidates = append(candidates, part)
	}
	return normalizeEntityKeywords(candidates)
}

func normalizeEntityKeywords(input []string) []string {
	if len(input) == 0 {
		return nil
	}

	seen := make(map[string]struct{}, len(input))
	keywords := make([]string, 0, len(input))
	for _, kw := range input {
		kw = strings.TrimSpace(kw)
		if kw == "" {
			continue
		}
		if _, ok := seen[kw]; ok {
			continue
		}
		seen[kw] = struct{}{}
		keywords = append(keywords, kw)
		if len(keywords) >= 5 {
			break
		}
	}
	if len(keywords) == 0 {
		return nil
	}

	fuzzy := make([]string, 0, len(keywords))
	for _, kw := range keywords {
		if len([]rune(kw)) < 2 {
			continue
		}
		fuzzy = append(fuzzy, kw)
	}
	if len(fuzzy) == 0 {
		return nil
	}
	return fuzzy
}

func cloneSearchRequest(req *SearchRequest) *SearchRequest {
	if req == nil {
		return nil
	}
	cp := *req
	cp.LibraryIDs = append([]int64(nil), req.LibraryIDs...)
	cp.FileIDs = append([]int64(nil), req.FileIDs...)
	cp.ChunkTypes = append([]string(nil), req.ChunkTypes...)
	cp.EntityKeywords = append([]string(nil), req.EntityKeywords...)
	cp.DocumentType = req.DocumentType
	cp.KnowledgeChunkIDs = append([]int64(nil), req.KnowledgeChunkIDs...)
	return &cp
}

func normalizeSearchConfigForExecution(config *model.SearchConfigData) *model.SearchConfigData {
	if config == nil {
		return nil
	}

	cp := *config
	// 分值阈值在不同向量库和重排模型之间没有统一尺度，直接沿用会导致误过滤和空结果。
	// 因此执行期统一强制清零，保留字段仅用于兼容历史配置和前端展示。
	cp.ScoreThreshold = 0
	return &cp
}

func uniqueInt64IDsInOrder(ids []int64) []int64 {
	if len(ids) == 0 {
		return nil
	}
	seen := make(map[int64]struct{}, len(ids))
	unique := make([]int64, 0, len(ids))
	for _, id := range ids {
		if id <= 0 {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		unique = append(unique, id)
	}
	if len(unique) == 0 {
		return nil
	}
	return unique
}

func normalizeScopeText(text string) string {
	text = strings.ToLower(strings.TrimSpace(text))
	if text == "" {
		return ""
	}

	var builder strings.Builder
	builder.Grow(len(text))
	for _, r := range text {
		if unicode.IsSpace(r) || unicode.IsPunct(r) || unicode.IsSymbol(r) {
			continue
		}
		builder.WriteRune(r)
	}
	return builder.String()
}

func scoreScopeText(text string, signals scopeSignals) int {
	normalizedText := normalizeScopeText(text)
	if normalizedText == "" {
		return 0
	}

	score := 0
	for _, phrase := range signals.Phrases {
		normalizedPhrase := normalizeScopeText(phrase)
		if normalizedPhrase == "" {
			continue
		}
		if strings.Contains(normalizedText, normalizedPhrase) {
			score += 20
		}
	}
	for _, term := range signals.SubjectTerms {
		normalizedTerm := normalizeScopeText(term)
		if normalizedTerm == "" {
			continue
		}
		if strings.Contains(normalizedText, normalizedTerm) {
			score += 12
		}
	}
	for _, term := range signals.YearTerms {
		normalizedTerm := normalizeScopeText(term)
		if normalizedTerm == "" {
			continue
		}
		if strings.Contains(normalizedText, normalizedTerm) {
			score += 8
		}
	}
	for _, term := range signals.DocumentTypeTerms {
		normalizedTerm := normalizeScopeText(term)
		if normalizedTerm == "" {
			continue
		}
		if strings.Contains(normalizedText, normalizedTerm) {
			score += 10
		}
	}
	return score
}

func scoreScopeContainmentMatch(text string, target string) int {
	normalizedText := normalizeScopeText(text)
	normalizedTarget := normalizeScopeText(target)
	if normalizedText == "" || normalizedTarget == "" {
		return 0
	}

	switch {
	case normalizedText == normalizedTarget:
		return 50
	case strings.Contains(normalizedText, normalizedTarget):
		return 35
	case strings.Contains(normalizedTarget, normalizedText):
		return 25
	default:
		return 0
	}
}
