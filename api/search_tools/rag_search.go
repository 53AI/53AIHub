package search_tools

import (
	"context"
	"fmt"
	"strings"
	"sync"

	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/rag"
	"gorm.io/gorm"
)

// RagSearcher RAG搜索适配器
type RagSearcher struct {
	db     *gorm.DB
	eid    int64
	userID *int64
	config *RagConfig

	mu                       sync.Mutex
	lastSearchReqByQuery     map[string]*rag.SearchRequest
	lastSearchTimingsByQuery map[string]map[string]int64
	lastSearchQuery          string
}

// NewRagSearcher 创建RAG搜索适配器
func NewRagSearcher(db *gorm.DB, eid int64, userID *int64, config *RagConfig) *RagSearcher {
	if config == nil {
		config = &RagConfig{
			Type: "vector", // 默认向量搜索
		}
	}

	return &RagSearcher{
		db:                       db,
		eid:                      eid,
		userID:                   userID,
		config:                   config,
		lastSearchReqByQuery:     make(map[string]*rag.SearchRequest),
		lastSearchTimingsByQuery: make(map[string]map[string]int64),
	}
}

func (r *RagSearcher) Search(query string, count int) ([]*SearchItem, error) {
	config := r.getConfigSnapshot()

	searchService := rag.NewSearchService(r.db)

	searchReq := &rag.SearchRequest{
		Query:                    query,
		SearchType:               getSearchTypeByConfig(config),
		TopK:                     count,
		LibraryIDs:               config.LibraryIDs,
		FileIDs:                  config.FileIDs,
		ChunkTypes:               config.ChunkTypes,
		SearchConfig:             config.SearchConfig,
		EntityKeywords:           config.EntityKeywords,
		DocumentType:             config.DocumentType,
		SkipEntityScopeNarrowing: len(config.FileIDs) > 0,
	}

	searchResponse, err := searchService.Search(r.eid, searchReq, r.userID)
	if err != nil {
		return nil, fmt.Errorf("RAG搜索失败: %v", err)
	}

	r.setLastSearchRequest(query, searchReq)
	r.setLastSearchTimings(query, searchResponse.StageTimings)

	return r.convertResults(searchResponse.Results), nil
}

func (r *RagSearcher) SearchBatch(ctx context.Context, queries []string, count int) (*SearchResult, error) {
	if len(queries) == 0 {
		return &SearchResult{Items: []*SearchItem{}, Errors: []error{fmt.Errorf("queries is empty")}}, nil
	}

	config := r.getConfigSnapshot()
	searchService := rag.NewSearchService(r.db)

	requests := make([]*rag.SearchRequest, 0, len(queries))
	for _, query := range queries {
		trimmed := strings.TrimSpace(query)
		if trimmed == "" {
			continue
		}
		req := &rag.SearchRequest{
			Query:                    trimmed,
			SearchType:               getSearchTypeByConfig(config),
			TopK:                     count,
			LibraryIDs:               config.LibraryIDs,
			FileIDs:                  config.FileIDs,
			ChunkTypes:               config.ChunkTypes,
			SearchConfig:             config.SearchConfig,
			EntityKeywords:           config.EntityKeywords,
			DocumentType:             config.DocumentType,
			SkipEntityScopeNarrowing: len(config.FileIDs) > 0,
		}
		requests = append(requests, req)
	}

	if len(requests) == 0 {
		return &SearchResult{Items: []*SearchItem{}, Errors: []error{fmt.Errorf("queries is empty")}}, nil
	}

	batchResults, err := searchService.SearchBatch(ctx, r.eid, requests, r.userID)
	if err != nil {
		return nil, fmt.Errorf("RAG批量搜索失败: %v", err)
	}

	var items []*SearchItem
	var errs []error
	for _, result := range batchResults {
		if result.Error != nil {
			errs = append(errs, result.Error)
			continue
		}
		items = append(items, r.convertResults(result.Results)...)
		r.setLastSearchRequest(result.Query, &rag.SearchRequest{
			Query:                    result.Query,
			SearchType:               getSearchTypeByConfig(config),
			TopK:                     count,
			LibraryIDs:               config.LibraryIDs,
			FileIDs:                  config.FileIDs,
			ChunkTypes:               config.ChunkTypes,
			SearchConfig:             config.SearchConfig,
			EntityKeywords:           config.EntityKeywords,
			DocumentType:             config.DocumentType,
			SkipEntityScopeNarrowing: len(config.FileIDs) > 0,
		})
		r.setLastSearchTimings(result.Query, result.StageTimings)
	}

	mergedItems := deduplicateSearchItems(items)
	if count > 0 && len(mergedItems) > count {
		mergedItems = mergedItems[:count]
	}

	return &SearchResult{Items: mergedItems, Errors: errs}, nil
}

func (r *RagSearcher) setLastSearchRequest(query string, req *rag.SearchRequest) {
	if req == nil {
		return
	}
	cloned := cloneSearchRequest(req)
	r.mu.Lock()
	r.lastSearchReqByQuery[query] = &cloned
	r.mu.Unlock()
}

func (r *RagSearcher) setLastSearchTimings(query string, timings map[string]int64) {
	if query == "" {
		return
	}

	cloned := cloneTimingMap(timings)
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.lastSearchTimingsByQuery == nil {
		r.lastSearchTimingsByQuery = make(map[string]map[string]int64)
	}
	r.lastSearchTimingsByQuery[query] = cloned
	r.lastSearchQuery = query
}

func cloneSearchRequest(req *rag.SearchRequest) rag.SearchRequest {
	cloned := *req
	cloned.LibraryIDs = append([]int64(nil), req.LibraryIDs...)
	cloned.FileIDs = append([]int64(nil), req.FileIDs...)
	cloned.ChunkTypes = append([]string(nil), req.ChunkTypes...)
	cloned.EntityKeywords = append([]string(nil), req.EntityKeywords...)
	cloned.DocumentType = req.DocumentType
	cloned.KnowledgeChunkIDs = append([]int64(nil), req.KnowledgeChunkIDs...)
	return cloned
}

func cloneTimingMap(timings map[string]int64) map[string]int64 {
	if len(timings) == 0 {
		return nil
	}
	cloned := make(map[string]int64, len(timings))
	for key, value := range timings {
		cloned[key] = value
	}
	return cloned
}

func deduplicateSearchItems(items []*SearchItem) []*SearchItem {
	if len(items) == 0 {
		return []*SearchItem{}
	}

	seen := make(map[string]bool, len(items))
	deduped := make([]*SearchItem, 0, len(items))
	for _, item := range items {
		if item == nil {
			continue
		}
		contentKey := strings.TrimSpace(strings.ToLower(item.Content))
		if contentKey == "" {
			contentKey = strings.TrimSpace(strings.ToLower(item.FilePath))
		}
		if contentKey == "" {
			contentKey = fmt.Sprintf("chunk:%d", item.ChunkID)
		}
		if seen[contentKey] {
			continue
		}
		seen[contentKey] = true
		cloned := *item
		deduped = append(deduped, &cloned)
	}

	return deduped
}

func (r *RagSearcher) GetLastSearchRequests() map[string]*rag.SearchRequest {
	r.mu.Lock()
	defer r.mu.Unlock()

	out := make(map[string]*rag.SearchRequest, len(r.lastSearchReqByQuery))
	for q, req := range r.lastSearchReqByQuery {
		if req == nil {
			out[q] = nil
			continue
		}
		cloned := cloneSearchRequest(req)
		out[q] = &cloned
	}
	return out
}

func (r *RagSearcher) GetLastSearchTimings() map[string]int64 {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.lastSearchQuery == "" {
		return nil
	}
	return cloneTimingMap(r.lastSearchTimingsByQuery[r.lastSearchQuery])
}

func getSearchTypeByConfig(config *RagConfig) string {
	if config == nil {
		return "vector"
	}

	// 优先使用配置的搜索类型
	if config.Type != "" {
		return config.Type
	}

	// 如果有 SearchConfig，根据其配置推断搜索类型
	if config.SearchConfig != nil {
		if config.SearchConfig.Vector && !config.SearchConfig.Fulltext {
			return "vector"
		}
		if !config.SearchConfig.Vector && config.SearchConfig.Fulltext {
			return "fulltext"
		}
		if config.SearchConfig.Vector && config.SearchConfig.Fulltext {
			return "hybrid"
		}
	}

	// 默认使用向量搜索
	return "vector"
}

// convertResults 转换搜索结果格式
func (r *RagSearcher) convertResults(ragResults []rag.SearchResultItem) []*SearchItem {
	if len(ragResults) == 0 {
		return []*SearchItem{}
	}

	results := make([]*SearchItem, 0, len(ragResults))

	for _, item := range ragResults {
		searchItem := &SearchItem{
			ChunkID:   item.ChunkID,
			FileID:    item.FileID,
			LibraryID: item.LibraryID,
			FilePath:  item.FilePath,
			ChunkType: item.ChunkType,
			Content:   item.Content,
			Score:     item.Score,
		}
		results = append(results, searchItem)
	}

	return results
}

func cloneRagConfig(config *RagConfig) *RagConfig {
	if config == nil {
		return &RagConfig{}
	}

	cloned := *config
	cloned.LibraryIDs = append([]int64(nil), config.LibraryIDs...)
	cloned.FileIDs = append([]int64(nil), config.FileIDs...)
	cloned.ChunkTypes = append([]string(nil), config.ChunkTypes...)
	cloned.EntityKeywords = append([]string(nil), config.EntityKeywords...)
	return &cloned
}

func (r *RagSearcher) getConfigSnapshot() *RagConfig {
	r.mu.Lock()
	defer r.mu.Unlock()
	return cloneRagConfig(r.config)
}

// SetLibraryIDs 设置知识库ID列表（链式调用）
func (r *RagSearcher) SetLibraryIDs(libraryIDs []int64) *RagSearcher {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.config.LibraryIDs = append([]int64(nil), libraryIDs...)
	return r
}

// SetFileIDs 设置文件ID列表（链式调用）
func (r *RagSearcher) SetFileIDs(fileIDs []int64) *RagSearcher {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.config.FileIDs = append([]int64(nil), fileIDs...)
	return r
}

// SetChunkTypes 设置分片类型列表（链式调用）
func (r *RagSearcher) SetChunkTypes(chunkTypes []string) *RagSearcher {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.config.ChunkTypes = append([]string(nil), chunkTypes...)
	return r
}

// SetSearchConfig 设置搜索详细配置（链式调用）
func (r *RagSearcher) SetSearchConfig(searchConfig *model.SearchConfigData) *RagSearcher {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.config.SearchConfig = searchConfig
	return r
}

// GetConfig 获取当前配置
func (r *RagSearcher) GetConfig() *RagConfig {
	return r.getConfigSnapshot()
}
