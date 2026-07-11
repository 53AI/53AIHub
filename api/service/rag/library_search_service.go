package rag

import (
	"context"
	"time"

	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

// LibrarySearchService 知识库搜索服务
type LibrarySearchService struct {
	searchService *SearchService
	rerankService *RerankService
	configService *ChunkConfigService
	db            *gorm.DB
}

// LibrarySearchParams 知识库搜索参数
type LibrarySearchParams struct {
	EID          int64                   `json:"eid"`
	UserID       int64                   `json:"user_id"`
	LibraryID    int64                   `json:"library_id"`
	Query        string                  `json:"query"`
	TopK         int                     `json:"top_k,omitempty"`
	SearchConfig *model.SearchConfigData `json:"search_config,omitempty"`
}

// LibrarySearchResult 知识库搜索结果
type LibrarySearchResult struct {
	Results []SearchResultItem `json:"results"`
	Total   int                `json:"total"`
	Time    int64              `json:"time_ms"`
	Type    string             `json:"search_type"`
	QueryID *int64             `json:"query_id,omitempty"`
}

// NewLibrarySearchService 创建知识库搜索服务实例
func NewLibrarySearchService(db *gorm.DB) *LibrarySearchService {
	return &LibrarySearchService{
		searchService: NewSearchService(db),
		rerankService: NewRerankService(db),
		configService: NewChunkConfigService(db),
		db:            db,
	}
}

// Search 执行知识库搜索
func (s *LibrarySearchService) Search(ctx context.Context, params *LibrarySearchParams) (*LibrarySearchResult, error) {
	startTime := time.Now()

	// 1. 获取知识库的默认搜索配置
	finalSearchConfig, err := s.getSearchConfig(params.EID, params.LibraryID, params.SearchConfig)
	if err != nil {
		return nil, err
	}
	if params.TopK > 0 {
		finalSearchConfig.TopK = params.TopK
	}

	// 2. 执行搜索
	searchReq := &SearchRequest{
		Query:        params.Query,
		LibraryIDs:   []int64{params.LibraryID},
		TopK:         finalSearchConfig.TopK,
		SearchType:   s.getSearchType(finalSearchConfig),
		SearchConfig: finalSearchConfig,
	}

	searchResponse, err := s.searchService.Search(params.EID, searchReq, &params.UserID)
	if err != nil {
		return nil, err
	}

	// 3. 应用分数阈值过滤（无论是否启用重排都要执行）
	filteredResults := s.applyScoreThreshold(searchResponse.Results, finalSearchConfig)

	// 4. 如果启用了重排，执行重排
	finalResults := filteredResults
	if finalSearchConfig.RerankingEnable {
		rerankResults, err := s.rerankService.PerformRerank(ctx, params.EID, params.Query, filteredResults, finalSearchConfig)
		if err != nil {
			// 重排失败时使用已过滤的结果
			finalResults = filteredResults
		} else {
			// 重排阶段只负责排序和 TopK，阈值过滤已在召回阶段完成
			finalResults = rerankResults
		}
	}

	if finalResults == nil {
		finalResults = []SearchResultItem{}
	}

	elapsed := time.Since(startTime).Milliseconds()
	return &LibrarySearchResult{
		Results: finalResults,
		Total:   len(finalResults),
		Time:    elapsed,
		Type:    s.getSearchType(finalSearchConfig),
		QueryID: searchResponse.QueryID,
	}, nil
}

// getSearchConfig 获取最终的搜索配置
func (s *LibrarySearchService) getSearchConfig(eid, libraryID int64, overrideConfig *model.SearchConfigData) (*model.SearchConfigData, error) {
	if s.configService == nil {
		s.configService = NewChunkConfigService(s.db)
	}
	chunkConfig, err := s.configService.GetConfig(eid, &libraryID, model.ChunkTypeDefault)
	if err != nil {
		return nil, err
	}
	librarySearchConfig := chunkConfig.SearchConfig

	// 如果提供了覆盖配置，则使用覆盖配置
	finalSearchConfig := librarySearchConfig
	if overrideConfig != nil {
		finalSearchConfig = overrideConfig
	}

	return normalizeSearchConfigForExecution(finalSearchConfig), nil
}

// applyScoreThreshold 应用分数阈值过滤
func (s *LibrarySearchService) applyScoreThreshold(results []SearchResultItem, config *model.SearchConfigData) []SearchResultItem {
	// 如果未启用分数阈值过滤，直接返回原结果
	if !config.ScoreThresholdEnabled {
		return results
	}

	var filteredResults []SearchResultItem
	for _, result := range results {
		if result.Score >= config.ScoreThreshold {
			filteredResults = append(filteredResults, result)
		}
	}

	return filteredResults
}

// getSearchType 根据SearchConfigData确定搜索类型
func (s *LibrarySearchService) getSearchType(config *model.SearchConfigData) string {
	if config.Hybrid {
		return "hybrid"
	} else if config.Vector && !config.Fulltext {
		return "vector"
	} else if !config.Vector && config.Fulltext {
		return "fulltext"
	}
	return "hybrid" // 默认
}
