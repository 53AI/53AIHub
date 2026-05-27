package rag

import (
	"strings"
	"sync"
	"time"

	"github.com/53AI/53AIHub/model"
)

var searchTimingKeys = []string{
	"scope_narrowing_ms",
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
