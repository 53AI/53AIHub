package rag

import (
	"context"
	"fmt"
	"reflect"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/helper"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/vectorstore"
	"gorm.io/gorm"
)

const entityVectorMatchThreshold float32 = 0.8 // 默认兜底阈值，按语义相似度使用
const maxGraphScopeLibraries = 12

// SearchService 检索服务
type SearchService struct {
	db        *gorm.DB
	vectorDB  vectorstore.VectorStore
	embedding *EmbeddingService
}

// SearchRequest 搜索请求
type SearchRequest struct {
	Query                    string                  `json:"query" binding:"required"`
	SearchType               string                  `json:"search_type"` // vector, fulltext, hybrid
	TopK                     int                     `json:"top_k"`
	LibraryIDs               []int64                 `json:"library_ids"`
	FileIDs                  []int64                 `json:"file_ids"`
	ChunkTypes               []string                `json:"chunk_types"`
	SearchConfig             *model.SearchConfigData `json:"search_config,omitempty"`
	EntityKeywords           []string                `json:"entity_keywords,omitempty"`
	DocumentType             string                  `json:"document_type,omitempty"`
	KnowledgeChunkIDs        []int64                 `json:"knowledge_chunk_ids,omitempty"`
	SkipEntityScopeNarrowing bool                    `json:"skip_entity_scope_narrowing,omitempty"`
	// Scope 是统一搜索范围模型，替代松散传递 library_ids / file_ids / chunk_types
	// 当 Scope 不为 nil 时，buildVectorFilter 优先使用 Scope 构建 payload filter
	Scope *SearchScope `json:"scope,omitempty"`
	trace *searchTimingRecorder
	// 预计算的向量（用于多库并发搜索时避免重复调用 embedding）
	precomputedQueryVector []float32
	// 预计算的配置（用于多库并发搜索时避免重复获取配置）
	precomputedChunkConfig *ChunkConfig
}

// SearchResponse 搜索响应
type SearchResponse struct {
	Results      []SearchResultItem `json:"results"`
	Total        int                `json:"total"`
	Time         int64              `json:"time_ms"`
	Type         string             `json:"search_type"`
	QueryID      *int64             `json:"query_id,omitempty"` // 查询记录ID（仅在save_query=true时返回）
	StageTimings map[string]int64   `json:"-"`
}

func multiLibrarySearchConcurrencyLimit() int {
	if limit := config.RAG_MULTI_LIBRARY_SEARCH_MAX_CONCURRENT; limit > 0 {
		return limit
	}
	return 1
}

func collectionSearchConcurrencyLimit() int {
	if limit := config.RAG_COLLECTION_SEARCH_MAX_CONCURRENT; limit > 0 {
		return limit
	}
	return 1
}

var (
	searchEntityLikeMatchFn = func(s *SearchService, eid int64, keywords []string) []model.Entity {
		return s.likeMatchEntitiesByKeywords(eid, keywords)
	}
	searchEntityVectorMatchFn = func(s *SearchService, eid int64, keywords []string) ([]model.Entity, error) {
		return s.vectorMatchEntities(eid, keywords)
	}
	defaultSingleVectorSearchFn = func(s *SearchService, eid int64, req *SearchRequest, configService *ChunkConfigService) ([]SearchResultItem, error) {
		return s.singleVectorSearch(eid, req, configService)
	}
	singleVectorSearchFn        = defaultSingleVectorSearchFn
	searchBatchFallbackSearchFn = func(s *SearchService, eid int64, req *SearchRequest, userID *int64) (*SearchResponse, error) {
		return s.Search(eid, req, userID)
	}
)

// BatchSearchResult 批量搜索结果
type BatchSearchResult struct {
	Query        string
	Results      []SearchResultItem
	Error        error
	StageTimings map[string]int64
}

// SearchResultItem 搜索结果项
type SearchResultItem struct {
	// 现在以 document_chunks 为单位：ChunkID/KnowledgeChunkID -> document_chunks.id
	ChunkID              int64  `json:"chunk_id"`
	KnowledgeChunkID     int64  `json:"knowledge_chunk_id"`
	KnowledgeChunkStatus string `json:"knowledge_chunk_status"`
	FileID               int64  `json:"file_id"`
	LibraryID            int64  `json:"library_id"`
	// 主内容：来自 document_chunks.content
	Content string `json:"content"`
	// 检索块原始内容（来自 retrieval_chunks.content）
	RetrievalContent string  `json:"retrieval_content,omitempty"`
	Summary          string  `json:"summary"`
	Score            float64 `json:"score"`
	VectorScore      float64 `json:"vector_score,omitempty"`
	TextScore        float64 `json:"text_score,omitempty"`
	Highlight        string  `json:"highlight,omitempty"`
	ChunkType        string  `json:"chunk_type"`
	FileName         string  `json:"file_name,omitempty"`
	FilePath         string  `json:"file_path,omitempty"`
	LibraryName      string  `json:"library_name,omitempty"`
	LibraryIcon      string  `json:"library_icon,omitempty"`
	FileCreatedAt    int64   `json:"file_created_at,omitempty"`
	SpaceID          int64   `json:"space_id,omitempty"`
	SpaceName        string  `json:"space_name,omitempty"`
}

// FileInfo 文件信息辅助结构体
type FileInfo struct {
	FileName      string
	FilePath      string
	FileCreatedAt int64
	IsDeleted     bool
}

// LibraryInfo 知识库信息辅助结构体
type LibraryInfo struct {
	LibraryName string
	LibraryIcon string
	SpaceID     int64
	SpaceName   string
}

// NewSearchService 创建检索服务
func NewSearchService(db *gorm.DB) *SearchService {
	// 从环境变量加载向量数据库配置
	config := vectorstore.LoadFromEnv()

	// 创建向量存储实例
	store, err := vectorstore.NewVectorStore(config)
	if err != nil {
		// 如果创建失败，记录错误但不阻塞服务启动
		logger.SysLogf("警告: 创建向量存储失败: %v", err)
		store = nil
	}

	// 如果向量存储创建成功，尝试连接
	if store != nil {
		ctx := context.Background()
		if err := store.Connect(ctx); err != nil {
			logger.SysLogf("警告: 连接向量存储失败: %v", err)
			store = nil
		}
	}

	service := &SearchService{
		db:        db,
		vectorDB:  store,
		embedding: NewEmbeddingService(db),
	}
	return service
}

// NewSearchServiceWithResolver 创建带自定义解析器的检索服务（用于测试）
func NewSearchServiceWithResolver(db *gorm.DB, resolver VectorCollectionResolver) *SearchService {
	config := vectorstore.LoadFromEnv()
	store, err := vectorstore.NewVectorStore(config)
	if err != nil {
		logger.SysLogf("警告: 创建向量存储失败: %v", err)
		store = nil
	}
	if store != nil {
		ctx := context.Background()
		if err := store.Connect(ctx); err != nil {
			logger.SysLogf("警告: 连接向量存储失败: %v", err)
			store = nil
		}
	}
	return &SearchService{
		db:        db,
		vectorDB:  store,
		embedding: NewEmbeddingService(db),
	}
}

// Search 统一搜索接口
func (s *SearchService) Search(eid int64, req *SearchRequest, userID *int64) (*SearchResponse, error) {
	startTime := time.Now()

	if req == nil {
		return nil, fmt.Errorf("搜索请求不能为空")
	}

	// 设置默认值
	if req.TopK <= 0 {
		req.TopK = 10
	}
	if req.SearchType == "" {
		req.SearchType = "vector"
	}

	originalReq := cloneSearchRequest(req)
	if originalReq == nil {
		originalReq = &SearchRequest{}
	}
	searchTrace := newSearchTimingRecorder()
	originalReq.trace = searchTrace
	configService := NewChunkConfigService(s.db)
	narrowedReq := cloneSearchRequest(originalReq)
	if narrowedReq == nil {
		narrowedReq = &SearchRequest{}
	}
	entityMeta := &entityScopeNarrowMeta{}
	scopeNarrowStart := time.Now()
	if !narrowedReq.SkipEntityScopeNarrowing {
		var narrowErr error
		entityMeta, narrowErr = s.applyEntityScopeNarrowingWithMeta(eid, narrowedReq)
		if narrowErr != nil {
			logger.SysDebugf("【实体范围】实体收窄失败，回退原始请求: eid=%d, err=%v", eid, narrowErr)
			narrowedReq = cloneSearchRequest(originalReq)
			if narrowedReq == nil {
				narrowedReq = &SearchRequest{}
			}
			entityMeta = &entityScopeNarrowMeta{}
		}
	} else {
		logger.SysDebugf("【实体范围】跳过实体收窄: eid=%d, query=%q, file_count=%d",
			eid, truncateForDebug(narrowedReq.Query, 256), len(narrowedReq.FileIDs))
	}
	searchTrace.add("scope_narrowing_ms", time.Since(scopeNarrowStart))
	if entityMeta == nil {
		entityMeta = &entityScopeNarrowMeta{}
	}

	effectiveReq := normalizeSearchRequestForExecution(narrowedReq)
	if effectiveReq == nil {
		effectiveReq = &SearchRequest{}
	}

	logger.SysDebugf(
		"【实体范围】摘要: eid=%d, 种子实体数=%d, 分片候选数=%d, 请求内容=%q, 检索类型=%s, 取回数量=%d, 文件数=%d, 分片数=%d",
		eid,
		len(entityMeta.SeedEntities),
		entityMeta.ChunkCandidateCount,
		truncateForDebug(effectiveReq.Query, 256),
		effectiveReq.SearchType,
		effectiveReq.TopK,
		len(effectiveReq.FileIDs),
		len(effectiveReq.KnowledgeChunkIDs),
	)

	var results []SearchResultItem
	var err error

	// 无论是否指定知识库，都不再预先过滤知识库权限，直接使用原始请求进行搜索
	// 权限过滤将在搜索结果中基于文件权限进行

	switch effectiveReq.SearchType {
	case "vector":
		results, err = s.vectorSearch(eid, effectiveReq, configService)
	case "fulltext":
		results, err = s.fulltextSearch(eid, effectiveReq)
	case "hybrid":
		results, err = s.hybridSearch(eid, effectiveReq, configService)
	default:
		err = fmt.Errorf("不支持的搜索类型: %s", effectiveReq.SearchType)
		return nil, err
	}

	if err != nil {
		return nil, err
	}

	// results 过滤已删除文件
	results = s.filterDeletedFiles(results)
	logger.SysDebugf(
		"【实体范围】最终摘要: eid=%d, 种子实体数=%d, 分片候选数=%d, 最终结果数=%d, 取回数量=%d, 最终文件数=%d, 最终知识库数=%d, 检索类型=%s, 样本=%v",
		eid,
		len(entityMeta.SeedEntities),
		entityMeta.ChunkCandidateCount,
		len(results),
		effectiveReq.TopK,
		len(effectiveReq.FileIDs),
		len(effectiveReq.LibraryIDs),
		effectiveReq.SearchType,
		previewSearchResultsForDebug(results, 5),
	)

	// 权限过滤：根据用户权限过滤搜索结果
	permissionStart := time.Now()
	if userID != nil && *userID != 0 {
		// 过滤文件权限
		results, err = s.filterResultsByFilePermission(eid, results, *userID)
		if err != nil {
			err = fmt.Errorf("过滤文件权限失败: %v", err)
			return nil, err
		}
	}
	searchTrace.add("permission_ms", time.Since(permissionStart))

	// 限制结果数量
	if len(results) > effectiveReq.TopK {
		results = results[:effectiveReq.TopK]
	}
	if results == nil {
		results = []SearchResultItem{}
	}

	searchTimeMs := time.Since(startTime).Milliseconds()
	response := &SearchResponse{
		Results: results,
		Total:   len(results),
		Time:    searchTimeMs,
		Type:    effectiveReq.SearchType,
	}

	// 更新召回次数统计
	if err := s.updateChunkRecallCounts(eid, results); err != nil {
		// 记录错误但不影响搜索结果
		logger.SysLogf("更新召回次数失败: %v", err)
	}

	// 始终保存查询记录
	saveQueryStart := time.Now()
	queryID, err := s.saveQueryRecord(eid, userID, effectiveReq, len(results), searchTimeMs)
	searchTrace.add("save_query_ms", time.Since(saveQueryStart))
	if err != nil {
		// 记录错误但不影响搜索结果
		logger.SysLogf("保存查询记录失败: %v", err)
	} else {
		response.QueryID = &queryID
	}
	response.StageTimings = searchTrace.snapshot()

	logger.SysDebugf(
		"【实体范围】最终摘要: eid=%d, 种子实体数=%d, 分片候选数=%d, 最终结果数=%d, 取回数量=%d, 最终文件数=%d, 最终知识库数=%d, 检索类型=%s, 样本=%v",
		eid,
		len(entityMeta.SeedEntities),
		entityMeta.ChunkCandidateCount,
		len(results),
		effectiveReq.TopK,
		len(effectiveReq.FileIDs),
		len(effectiveReq.LibraryIDs),
		effectiveReq.SearchType,
		previewSearchResultsForDebug(results, 5),
	)

	return response, nil
}

// SearchBatch 批量搜索多个问题
// 会先对每个问题做实体范围收敛，再在收敛后的相同库范围内批量召回，并按问题分别富化结果
func (s *SearchService) SearchBatch(ctx context.Context, eid int64, reqs []*SearchRequest, userID *int64) ([]BatchSearchResult, error) {
	if len(reqs) == 0 {
		return nil, fmt.Errorf("搜索请求不能为空")
	}

	normalized, scopeNarrowingElapsed := s.prepareBatchSearchRequests(eid, reqs)

	if len(normalized) == 0 {
		return nil, fmt.Errorf("搜索请求不能为空")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if !s.canUseBatchVectorSearch(normalized) {
		logger.SysDebugf("【批量向量检索】回退到单条搜索: eid=%d, reason=%s, query_count=%d, queries=%v",
			eid, s.batchSearchFallbackReason(normalized), len(normalized), previewQueriesForDebug(normalized, 8))
		return s.searchBatchFallback(ctx, eid, normalized, userID)
	}

	batchTrace := newSearchTimingRecorder()
	batchTrace.add("scope_narrowing_ms", scopeNarrowingElapsed)

	configService := NewChunkConfigService(s.db)
	config, err := s.getSearchConfig(eid, normalized[0], configService)
	if err != nil {
		return nil, err
	}
	if config == nil || config.EmbeddingChannelID == nil {
		return nil, fmt.Errorf("未配置向量化渠道")
	}

	collections, err := s.resolveBatchCollections(eid, normalized)
	if err != nil {
		logger.SysDebugf("【批量向量检索】解析批量 collections 失败，回退单条搜索: eid=%d, err=%v", eid, err)
		return s.searchBatchFallback(ctx, eid, normalized, userID)
	}

	channel, err := model.GetChannelByID(*config.EmbeddingChannelID)
	if err != nil {
		return nil, fmt.Errorf("获取渠道配置失败: %v", err)
	}

	queryTexts := make([]string, len(normalized))
	for i, req := range normalized {
		queryTexts[i] = req.Query
	}

	logger.SysDebugf("【批量向量检索】开始: eid=%d, query_count=%d, library_count=%d, search_types=%v, queries=%v",
		eid, len(normalized), len(collections), previewSearchTypesForDebug(normalized), previewQueriesForDebug(normalized, 8))

	vectorSearchStart := time.Now()
	embeddingStart := time.Now()
	queryVectors64, err := s.embedding.BatchGenerateEmbedding(eid, queryTexts, channel, config, NewEmptyEmbeddingContext())
	embeddingElapsed := time.Since(embeddingStart)
	batchTrace.add("embedding_ms", embeddingElapsed)
	if err != nil {
		logger.SysDebugf("【批量向量检索】批量生成向量失败，回退单条搜索: eid=%d, err=%v", eid, err)
		return s.searchBatchFallback(ctx, eid, normalized, userID)
	}
	if len(queryVectors64) != len(normalized) {
		logger.SysDebugf("【批量向量检索】批量向量数量不匹配，回退单条搜索: eid=%d, expected=%d, got=%d",
			eid, len(normalized), len(queryVectors64))
		return s.searchBatchFallback(ctx, eid, normalized, userID)
	}

	// 计算 queryVectors32 供后续使用
	queryVectors32 := make([][]float32, len(queryVectors64))
	for i, v64 := range queryVectors64 {
		v32 := make([]float32, len(v64))
		for j, v := range v64 {
			v32[j] = float32(v)
		}
		queryVectors32[i] = v32
	}

	batchSearcher, ok := s.vectorDB.(interface {
		SearchBatch(context.Context, vectorstore.BatchSearchRequest) ([]vectorstore.SearchResponse, error)
	})
	if !ok {
		logger.SysDebugf("【批量向量检索】向量存储不支持批量搜索，回退单条搜索: eid=%d", eid)
		return s.searchBatchFallback(ctx, eid, normalized, userID)
	}

	type collectionBatchResult struct {
		target    batchVectorCollection
		responses []vectorstore.SearchResponse
		err       error
	}
	maxWorkers := collectionSearchConcurrencyLimit()
	if maxWorkers <= 0 {
		maxWorkers = 1
	}
	if maxWorkers > len(collections) {
		maxWorkers = len(collections)
	}
	semaphore := make(chan struct{}, maxWorkers)
	resultChan := make(chan collectionBatchResult, len(collections))
	var wg sync.WaitGroup

	qdrantSearchStart := time.Now()
	for _, target := range collections {
		target := target
		wg.Add(1)
		go func() {
			defer wg.Done()
			select {
			case semaphore <- struct{}{}:
				defer func() { <-semaphore }()
			case <-ctx.Done():
				resultChan <- collectionBatchResult{target: target, err: ctx.Err()}
				return
			}

			batchReq := vectorstore.BatchSearchRequest{
				Collection: target.Collection,
				Searches:   make([]vectorstore.SearchRequest, len(normalized)),
			}
			for i, req := range normalized {
				scopedReq := cloneSearchRequest(req)
				scopedReq.LibraryIDs = []int64{target.LibraryID}
				filter := s.buildVectorFilter(eid, scopedReq)
				searchReq := vectorstore.SearchRequest{
					Collection:     target.Collection,
					Query:          req.Query,
					Vector:         queryVectors32[i],
					TopK:           req.TopK,
					Filters:        filter,
					SearchParams:   map[string]interface{}{},
					ScoreThreshold: 0,
				}
				if req.SearchConfig != nil && req.SearchConfig.ScoreThresholdEnabled && req.SearchConfig.ScoreThreshold > 0 {
					searchReq.ScoreThreshold = float32(req.SearchConfig.ScoreThreshold)
				}
				batchReq.Searches[i] = searchReq
			}

			searchResponses, searchErr := batchSearcher.SearchBatch(ctx, batchReq)
			resultChan <- collectionBatchResult{target: target, responses: searchResponses, err: searchErr}
		}()
	}

	wg.Wait()
	close(resultChan)
	qdrantElapsed := time.Since(qdrantSearchStart)
	batchTrace.add("qdrant_search_ms", qdrantElapsed)
	batchTrace.add("vector_search_ms", time.Since(vectorSearchStart))

	queryBatches := make([][]vectorResultBatch, len(normalized))
	totalRawVectorResults := 0
	for result := range resultChan {
		if result.err != nil {
			logger.SysDebugf("【批量向量检索】Qdrant 批量搜索失败，回退单条搜索: eid=%d, collection=%s, err=%v",
				eid, result.target.Collection, result.err)
			return s.searchBatchFallback(ctx, eid, normalized, userID)
		}
		if len(result.responses) != len(normalized) {
			return nil, fmt.Errorf("批量搜索返回数量不匹配: collection=%s, expected=%d, got=%d",
				result.target.Collection, len(normalized), len(result.responses))
		}
		for i, searchResp := range result.responses {
			totalRawVectorResults += len(searchResp.Results)
			queryBatches[i] = append(queryBatches[i], vectorResultBatch{
				Collection: result.target.Collection,
				Results:    searchResp.Results,
			})
		}
	}
	logger.SysDebugf("【批量向量检索】向量阶段完成: eid=%d, query_count=%d, library_count=%d, raw_vector_results=%d, embedding_ms=%d, qdrant_search_ms=%d, vector_search_ms=%d",
		eid, len(normalized), len(collections), totalRawVectorResults, embeddingElapsed.Milliseconds(), qdrantElapsed.Milliseconds(), time.Since(vectorSearchStart).Milliseconds())

	enrichStart := time.Now()
	enrichedByQuery, enrichErr := s.enrichVectorResultBatchGroups(eid, queryBatches, queryTexts, configService)
	batchTrace.add("enrich_ms", time.Since(enrichStart))
	if enrichErr != nil {
		results := make([]BatchSearchResult, 0, len(normalized))
		for _, req := range normalized {
			results = append(results, BatchSearchResult{Query: req.Query, Error: enrichErr, StageTimings: batchTrace.snapshot()})
		}
		return results, nil
	}

	results := make([]BatchSearchResult, 0, len(normalized))
	for i, enriched := range enrichedByQuery {
		enriched = s.applyBatchScoreThreshold(enriched, normalized[i])
		enriched = s.filterDeletedFiles(enriched)
		if normalized[i].SearchType == "hybrid" {
			textResults, textErr := s.fulltextSearch(eid, normalized[i])
			if textErr != nil {
				logger.SysDebugf("【批量向量检索】全文搜索失败，保留向量结果: query=%q, err=%v", normalized[i].Query, textErr)
			} else {
				enriched = s.mergeSearchResults(enriched, textResults, normalized[i].TopK)
			}
		}
		results = append(results, BatchSearchResult{Query: normalized[i].Query, Results: enriched, StageTimings: batchTrace.snapshot()})
	}
	if userID != nil && *userID != 0 {
		permissionStart := time.Now()
		results = s.filterBatchResultsByFilePermission(eid, results, *userID)
		batchTrace.add("permission_ms", time.Since(permissionStart))
	}
	for i := range results {
		if results[i].Error == nil {
			results[i].Results = sortAndLimitSearchResults(results[i].Results, normalized[i].TopK)
		}
		results[i].StageTimings = batchTrace.snapshot()
	}

	logger.SysDebugf("【批量向量检索】完成: eid=%d, query_count=%d, library_count=%d, mode=%s",
		eid, len(results), len(collections), batchSearchModeName(normalized))
	return results, nil
}

func (s *SearchService) prepareBatchSearchRequests(eid int64, reqs []*SearchRequest) ([]*SearchRequest, time.Duration) {
	if len(reqs) == 0 {
		return nil, 0
	}

	start := time.Now()
	normalized := make([]*SearchRequest, 0, len(reqs))
	for _, req := range reqs {
		if req == nil {
			continue
		}
		cloned := cloneSearchRequest(req)
		if cloned == nil {
			continue
		}
		cloned.Query = strings.TrimSpace(cloned.Query)
		if cloned.Query == "" {
			continue
		}
		if cloned.TopK <= 0 {
			cloned.TopK = 10
		}
		if cloned.SearchType == "" {
			cloned.SearchType = "vector"
		}
		cloned.SearchConfig = normalizeSearchConfigForExecution(cloned.SearchConfig)
		if !cloned.SkipEntityScopeNarrowing {
			if narrowResult, narrowErr := s.PreprocessEntityScope(eid, cloned); narrowErr != nil {
				logger.SysDebugf("【批量向量检索】实体收敛失败，保留原始请求: eid=%d, query=%q, err=%v",
					eid, truncateForDebug(cloned.Query, 256), narrowErr)
			} else if narrowResult != nil {
				cloned.LibraryIDs = append([]int64(nil), narrowResult.NarrowedLibraryIDs...)
				cloned.FileIDs = append([]int64(nil), narrowResult.NarrowedFileIDs...)
				cloned.SkipEntityScopeNarrowing = narrowResult.Skipped
			}
		}
		cloned = normalizeSearchRequestForExecution(cloned)
		normalized = append(normalized, cloned)
	}
	return normalized, time.Since(start)
}

func (s *SearchService) canUseBatchVectorSearch(reqs []*SearchRequest) bool {
	if len(reqs) <= 1 {
		return false
	}
	for _, req := range reqs {
		if req == nil || !isBatchableSearchType(req.SearchType) {
			return false
		}
		if len(req.LibraryIDs) == 0 {
			return false
		}
	}
	for _, req := range reqs[1:] {
		if len(req.LibraryIDs) == 0 || !sameInt64IDSet(req.LibraryIDs, reqs[0].LibraryIDs) {
			return false
		}
	}
	return true
}

func isBatchableSearchType(searchType string) bool {
	return searchType == "vector" || searchType == "hybrid"
}

func batchSearchModeName(reqs []*SearchRequest) string {
	hasHybrid := false
	for _, req := range reqs {
		if req != nil && req.SearchType == "hybrid" {
			hasHybrid = true
			break
		}
	}
	if hasHybrid {
		return "hybrid_batch"
	}
	return "vector_batch"
}

func (s *SearchService) batchSearchFallbackReason(reqs []*SearchRequest) string {
	if len(reqs) == 0 {
		return "empty"
	}
	for i, req := range reqs {
		if req == nil {
			return fmt.Sprintf("request_%d_nil", i)
		}
		if !isBatchableSearchType(req.SearchType) {
			return fmt.Sprintf("unsupported_search_type_%d:%s", i, req.SearchType)
		}
		if len(req.LibraryIDs) == 0 {
			return fmt.Sprintf("request_%d_library_scope_invalid", i)
		}
		if i > 0 && !sameInt64IDSet(req.LibraryIDs, reqs[0].LibraryIDs) {
			return fmt.Sprintf("request_%d_library_scope_mismatch", i)
		}
	}
	return "unknown"
}

func sameInt64IDSet(a, b []int64) bool {
	aUnique := uniqueInt64IDsInOrder(a)
	bUnique := uniqueInt64IDsInOrder(b)
	if len(aUnique) != len(bUnique) {
		return false
	}
	seen := make(map[int64]struct{}, len(aUnique))
	for _, id := range aUnique {
		seen[id] = struct{}{}
	}
	for _, id := range bUnique {
		if _, ok := seen[id]; !ok {
			return false
		}
	}
	return true
}

func previewSearchTypesForDebug(reqs []*SearchRequest) []string {
	types := make([]string, 0, len(reqs))
	for _, req := range reqs {
		if req == nil {
			continue
		}
		types = append(types, req.SearchType)
	}
	return types
}

func previewQueriesForDebug(reqs []*SearchRequest, limit int) []string {
	queries := make([]string, 0, len(reqs))
	for _, req := range reqs {
		if req == nil {
			continue
		}
		queries = append(queries, truncateForDebug(req.Query, 64))
		if limit > 0 && len(queries) >= limit {
			break
		}
	}
	return queries
}

func (s *SearchService) searchBatchFallback(ctx context.Context, eid int64, reqs []*SearchRequest, userID *int64) ([]BatchSearchResult, error) {
	results := make([]BatchSearchResult, len(reqs))
	if len(reqs) == 0 {
		return results, nil
	}

	maxWorkers := config.RAG_SEARCH_ENGINE_MAX_WORKERS
	if maxWorkers <= 0 {
		maxWorkers = 1
	}
	if maxWorkers > len(reqs) {
		maxWorkers = len(reqs)
	}

	logger.SysDebugf("【批量向量检索】单条搜索回退并发执行: eid=%d, query_count=%d, max_workers=%d",
		eid, len(reqs), maxWorkers)

	semaphore := make(chan struct{}, maxWorkers)
	var wg sync.WaitGroup

	for i, req := range reqs {
		if req == nil {
			results[i] = BatchSearchResult{Error: fmt.Errorf("搜索请求不能为空")}
			continue
		}

		wg.Add(1)
		go func(index int, searchReq *SearchRequest) {
			defer wg.Done()

			select {
			case semaphore <- struct{}{}:
				defer func() { <-semaphore }()
			case <-ctx.Done():
				results[index] = BatchSearchResult{Query: searchReq.Query, Error: ctx.Err()}
				return
			}

			if err := ctx.Err(); err != nil {
				results[index] = BatchSearchResult{Query: searchReq.Query, Error: err}
				return
			}

			searchResp, err := searchBatchFallbackSearchFn(s, eid, searchReq, userID)
			if err != nil {
				results[index] = BatchSearchResult{Query: searchReq.Query, Error: err}
				return
			}
			results[index] = BatchSearchResult{Query: searchReq.Query, Results: searchResp.Results, StageTimings: searchResp.StageTimings}
		}(i, req)
	}

	wg.Wait()
	return results, nil
}

type batchVectorCollection struct {
	LibraryID  int64
	Collection string
}

func (s *SearchService) resolveBatchCollection(eid int64, reqs []*SearchRequest) (string, error) {
	if len(reqs) == 0 {
		return "", fmt.Errorf("搜索请求不能为空")
	}
	if len(reqs[0].LibraryIDs) != 1 {
		return "", fmt.Errorf("批量搜索仅支持单知识库")
	}

	libraryID := reqs[0].LibraryIDs[0]
	for i := 1; i < len(reqs); i++ {
		if len(reqs[i].LibraryIDs) != 1 || reqs[i].LibraryIDs[0] != libraryID {
			return "", fmt.Errorf("批量搜索需要相同的知识库范围")
		}
	}

	// enterprise 模式直接返回企业级集合
	if GetEnterpriseVectorReadMode(eid) == VectorCollectionModeEnterprise {
		return model.GetDocumentVectorCollectionName(eid), nil
	}

	libraries, err := s.batchGetLibrariesByIDs(eid, []int64{libraryID})
	if err != nil {
		return "", err
	}
	library, ok := libraries[libraryID]
	if !ok || library == nil {
		return "", fmt.Errorf("知识库不存在: %d", libraryID)
	}

	return model.GetVectorCollectionName(library.UUID), nil
}

func (s *SearchService) resolveBatchCollections(eid int64, reqs []*SearchRequest) ([]batchVectorCollection, error) {
	if len(reqs) == 0 {
		return nil, fmt.Errorf("搜索请求不能为空")
	}
	libraryIDs := uniqueInt64IDsInOrder(reqs[0].LibraryIDs)
	if len(libraryIDs) == 0 {
		return nil, fmt.Errorf("批量搜索需要知识库范围")
	}
	for i := 1; i < len(reqs); i++ {
		if reqs[i] == nil || !sameInt64IDSet(reqs[i].LibraryIDs, libraryIDs) {
			return nil, fmt.Errorf("批量搜索需要相同的知识库范围")
		}
	}

	// enterprise 模式直接返回企业级集合
	if GetEnterpriseVectorReadMode(eid) == VectorCollectionModeEnterprise {
		return []batchVectorCollection{{
			LibraryID:  0,
			Collection: model.GetDocumentVectorCollectionName(eid),
		}}, nil
	}

	libraries, err := s.batchGetLibrariesByIDs(eid, libraryIDs)
	if err != nil {
		return nil, err
	}

	collections := make([]batchVectorCollection, 0, len(libraryIDs))
	for _, libraryID := range libraryIDs {
		library, ok := libraries[libraryID]
		if !ok || library == nil {
			return nil, fmt.Errorf("知识库不存在: %d", libraryID)
		}
		collections = append(collections, batchVectorCollection{
			LibraryID:  libraryID,
			Collection: model.GetVectorCollectionName(library.UUID),
		})
	}
	return collections, nil
}

func (s *SearchService) resolveVectorCollections(eid int64, req *SearchRequest) ([]string, error) {
	if req == nil {
		return nil, fmt.Errorf("搜索请求不能为空")
	}
	if len(req.LibraryIDs) == 0 {
		return []string{}, nil
	}
	libraryMap, err := s.batchGetLibrariesByIDs(eid, req.LibraryIDs)
	if err != nil {
		logger.SysLogf("批量获取库信息失败: %v", err)
	}

	// 企业级读模式检查
	enterpriseReadMode := GetEnterpriseVectorReadMode(eid)
	if enterpriseReadMode == VectorCollectionModeEnterprise {
		return []string{model.GetDocumentVectorCollectionName(eid)}, nil
	}

	collections := make([]string, 0, len(req.LibraryIDs))
	for _, libraryID := range req.LibraryIDs {
		library, ok := libraryMap[libraryID]
		if !ok || library == nil {
			continue
		}
		collections = append(collections, model.GetVectorCollectionName(library.UUID))
	}
	return collections, nil
}

func (s *SearchService) applyBatchScoreThreshold(results []SearchResultItem, req *SearchRequest) []SearchResultItem {
	if req == nil || req.SearchConfig == nil || !req.SearchConfig.ScoreThresholdEnabled || req.SearchConfig.ScoreThreshold <= 0 {
		return results
	}
	threshold := req.SearchConfig.ScoreThreshold
	filtered := make([]SearchResultItem, 0, len(results))
	for _, result := range results {
		if result.Score >= threshold {
			filtered = append(filtered, result)
		}
	}
	return filtered
}

func sortAndLimitSearchResults(results []SearchResultItem, topK int) []SearchResultItem {
	sort.Slice(results, func(i, j int) bool {
		return results[i].Score > results[j].Score
	})
	if topK > 0 && len(results) > topK {
		return results[:topK]
	}
	return results
}

// getSearchConfig 获取搜索配置
func (s *SearchService) getSearchConfig(eid int64, req *SearchRequest, configService *ChunkConfigService) (*ChunkConfig, error) {
	_ = req
	logger.SysLogf("🔍 向量搜索使用企业 embedding 配置 (eid=%d)", eid)
	return configService.GetEnterpriseEmbeddingConfig(eid)
}

func normalizeSearchRequestForExecution(req *SearchRequest) *SearchRequest {
	if req == nil {
		return nil
	}
	cp := cloneSearchRequest(req)
	if cp == nil {
		return nil
	}
	cp.SearchConfig = normalizeSearchConfigForExecution(cp.SearchConfig)
	return cp
}

func (s *SearchService) applyEntityScopeNarrowing(eid int64, req *SearchRequest) error {
	_, err := s.applyEntityScopeNarrowingWithMeta(eid, req)
	return err
}

// ApplyEntityScopeNarrowing 公开方法，供外部调用（支持预收敛场景）
func (s *SearchService) ApplyEntityScopeNarrowing(eid int64, req *SearchRequest) error {
	return s.applyEntityScopeNarrowing(eid, req)
}

// EntityScopeNarrowResult 实体范围收敛结果，供 SSE 分阶段输出使用
type EntityScopeNarrowResult struct {
	NarrowedLibraryIDs  []int64                    // 收敛后的知识库 ID 列表
	NarrowedLibraries   []EntityScopeNarrowLibrary // 收敛后的知识库摘要
	NarrowedFileIDs     []int64                    // 收敛后的文件 ID 列表
	SeedEntities        []string                   // 种子实体名称列表
	ChunkCandidateCount int                        // 分片候选数量
	ScopeNarrowingMs    int64                      // 收敛耗时（毫秒）
	Skipped             bool                       // 是否跳过了收敛（如指定了 library_id/file_id）
}

// EntityScopeNarrowLibrary 是收敛结果中的知识库摘要。ID 仅供服务内继续编码使用。
type EntityScopeNarrowLibrary struct {
	ID   int64  `json:"-"`
	Name string `json:"name"`
}

// PreprocessEntityScope 预处理实体范围收敛，不执行向量搜索
// 用于 SSE 分阶段输出：先发送收敛结果，再执行向量搜索
// 如果请求设置了 SkipEntityScopeNarrowing=true 则跳过收敛；
// 否则会优先尝试实体收敛，并在实体关键词缺失或实体未命中时使用查询信号兜底收敛。
func (s *SearchService) PreprocessEntityScope(eid int64, req *SearchRequest) (*EntityScopeNarrowResult, error) {
	if req == nil {
		return nil, fmt.Errorf("搜索请求不能为空")
	}

	result := &EntityScopeNarrowResult{
		NarrowedLibraryIDs: append([]int64(nil), req.LibraryIDs...),
		NarrowedLibraries:  entityScopeNarrowLibrariesFromIDs(req.LibraryIDs),
		NarrowedFileIDs:    append([]int64(nil), req.FileIDs...),
		Skipped:            false,
	}

	// 检查是否应该跳过收敛
	if req.SkipEntityScopeNarrowing {
		result.Skipped = true
		s.refreshEntityScopeNarrowLibraries(eid, result)
		logger.SysDebugf("【实体范围】跳过收敛（SkipEntityScopeNarrowing=true）: eid=%d, library_count=%d, file_count=%d",
			eid, len(req.LibraryIDs), len(req.FileIDs))
		return result, nil
	}

	scopeNarrowStart := time.Now()

	narrowedReq := cloneSearchRequest(req)
	if narrowedReq == nil {
		narrowedReq = &SearchRequest{}
	}

	entityMeta, narrowErr := s.applyEntityScopeNarrowingWithMeta(eid, narrowedReq)
	if narrowErr != nil {
		logger.SysDebugf("【实体范围】实体收窄失败，回退原始请求: eid=%d, err=%v", eid, narrowErr)
	} else if entityMeta != nil {
		result.NarrowedLibraryIDs = append([]int64(nil), narrowedReq.LibraryIDs...)
		result.NarrowedFileIDs = append([]int64(nil), narrowedReq.FileIDs...)
		result.SeedEntities = entityMeta.SeedEntities
		result.ChunkCandidateCount = entityMeta.ChunkCandidateCount
	}

	s.refreshEntityScopeNarrowLibraries(eid, result)
	result.ScopeNarrowingMs = time.Since(scopeNarrowStart).Milliseconds()

	logger.SysLogf("【实体范围】预处理完成: eid=%d, 种子实体数=%d, 分片候选数=%d, 原始库数=%d, 收敛库数=%d, 耗时=%dms",
		eid, len(result.SeedEntities), result.ChunkCandidateCount,
		len(req.LibraryIDs), len(result.NarrowedLibraryIDs), result.ScopeNarrowingMs)

	return result, nil
}

func entityScopeNarrowLibrariesFromIDs(libraryIDs []int64) []EntityScopeNarrowLibrary {
	if len(libraryIDs) == 0 {
		return []EntityScopeNarrowLibrary{}
	}

	libraries := make([]EntityScopeNarrowLibrary, 0, len(libraryIDs))
	for _, libraryID := range libraryIDs {
		libraries = append(libraries, EntityScopeNarrowLibrary{ID: libraryID})
	}
	return libraries
}

func (s *SearchService) refreshEntityScopeNarrowLibraries(eid int64, result *EntityScopeNarrowResult) {
	if result == nil {
		return
	}

	result.NarrowedLibraries = entityScopeNarrowLibrariesFromIDs(result.NarrowedLibraryIDs)
	libraries, err := s.buildEntityScopeNarrowLibraries(eid, result.NarrowedLibraryIDs)
	if err != nil {
		logger.SysDebugf("【实体范围】知识库名称加载失败: eid=%d, library_count=%d, err=%v",
			eid, len(result.NarrowedLibraryIDs), err)
		return
	}
	result.NarrowedLibraries = libraries
}

func (s *SearchService) buildEntityScopeNarrowLibraries(eid int64, libraryIDs []int64) ([]EntityScopeNarrowLibrary, error) {
	if len(libraryIDs) == 0 {
		return []EntityScopeNarrowLibrary{}, nil
	}

	libraryMap, err := s.batchGetLibrariesByIDs(eid, libraryIDs)
	if err != nil {
		return nil, err
	}

	libraries := make([]EntityScopeNarrowLibrary, 0, len(libraryIDs))
	for _, libraryID := range libraryIDs {
		item := EntityScopeNarrowLibrary{ID: libraryID}
		if library, ok := libraryMap[libraryID]; ok && library != nil {
			item.Name = library.Name
		}
		libraries = append(libraries, item)
	}
	return libraries, nil
}

func (s *SearchService) applyEntityScopeNarrowingWithMeta(eid int64, req *SearchRequest) (*entityScopeNarrowMeta, error) {
	if req == nil {
		return nil, nil
	}

	fuzzyKeywords := normalizeEntityKeywords(req.EntityKeywords)

	meta := &entityScopeNarrowMeta{}
	originalLibraryIDs := append([]int64(nil), req.LibraryIDs...)
	originalFileIDs := append([]int64(nil), req.FileIDs...)
	signals := buildScopeSignals(req.Query, fuzzyKeywords, req.DocumentType)

	if len(fuzzyKeywords) == 0 {
		logger.SysDebugf("【实体向量匹配】无有效实体关键词，直接启用查询信号兜底: eid=%d, query=%q", eid, truncateForDebug(req.Query, 256))
		fallbackLibraryIDs, narrowed, positiveScoreCount, fallbackErr := s.rankLibrariesByScopeSignals(eid, originalLibraryIDs, signals)
		if fallbackErr != nil {
			logger.SysDebugf("【实体向量匹配】查询信号兜底收敛失败: eid=%d, err=%v", eid, fallbackErr)
			return meta, nil
		}
		if narrowed {
			req.LibraryIDs = fallbackLibraryIDs
			logger.SysDebugf("【实体向量匹配】查询信号兜底收敛: eid=%d, 原始知识库数=%d, 最终知识库数=%d, 正向评分数=%d",
				eid, len(originalLibraryIDs), len(req.LibraryIDs), positiveScoreCount)
		}
		return meta, nil
	}

	logger.SysDebugf("【实体向量匹配】开始: eid=%d, keywords=%v", eid, fuzzyKeywords)
	likeEntities := searchEntityLikeMatchFn(s, eid, fuzzyKeywords)
	logger.SysDebugf("【实体向量匹配】LIKE命中: eid=%d, keywords=%v, hit=%d", eid, fuzzyKeywords, len(likeEntities))

	var vectorEntities []model.Entity
	var vectorErr error
	skipVector, skipThreshold := shouldSkipEntityVectorMatch(len(likeEntities), len(fuzzyKeywords))
	if skipVector {
		logger.SysDebugf("【实体向量匹配】LIKE命中已足够，跳过向量检索: eid=%d, keywords=%v, like_hit=%d, threshold=%d",
			eid, fuzzyKeywords, len(likeEntities), skipThreshold)
	} else {
		vectorEntities, vectorErr = searchEntityVectorMatchFn(s, eid, fuzzyKeywords)
		if vectorErr != nil {
			logger.SysDebugf("【实体向量匹配】向量检索失败，继续使用LIKE结果: eid=%d, keywords=%v, err=%v", eid, fuzzyKeywords, vectorErr)
		}
		logger.SysDebugf("【实体向量匹配】向量命中: eid=%d, keywords=%v, hit=%d", eid, fuzzyKeywords, len(vectorEntities))
	}

	entities := mergeEntityMatches(likeEntities, vectorEntities)
	logger.SysDebugf("【实体向量匹配】合并完成: eid=%d, keywords=%v, like_hit=%d, vector_hit=%d, merged_hit=%d",
		eid, fuzzyKeywords, len(likeEntities), len(vectorEntities), len(entities))

	if len(entities) == 0 {
		logger.SysDebugf("【实体向量匹配】未匹配到任何有效实体: eid=%d, keywords=%v", eid, fuzzyKeywords)
		fallbackLibraryIDs, narrowed, positiveScoreCount, fallbackErr := s.rankLibrariesByScopeSignals(eid, originalLibraryIDs, signals)
		if fallbackErr != nil {
			logger.SysDebugf("【实体向量匹配】查询信号兜底收敛失败: eid=%d, err=%v", eid, fallbackErr)
			return meta, nil
		}
		if narrowed {
			req.LibraryIDs = fallbackLibraryIDs
			logger.SysDebugf("【实体向量匹配】查询信号兜底收敛: eid=%d, 原始知识库数=%d, 最终知识库数=%d, 正向评分数=%d",
				eid, len(originalLibraryIDs), len(req.LibraryIDs), positiveScoreCount)
		}
		return meta, nil
	}

	entityIDs := make([]int64, 0, len(entities))
	entityNames := make([]string, 0, len(entities))
	for _, e := range entities {
		entityIDs = append(entityIDs, e.ID)
		entityNames = append(entityNames, e.Name)
	}
	meta.SeedEntities = entityNames
	meta.SeedEntityIDs = entityIDs
	logger.SysDebugf("【实体向量匹配】实体种子命中: eid=%d, 种子实体数=%d", eid, len(entityIDs))

	type entityScopeRow struct {
		SpaceID   int64
		ChunkID   int64
		FileID    int64
		LibraryID int64
	}

	q := s.db.Model(&model.EntityChunkRelation{}).
		Select("space_id, chunk_id, file_id, library_id").
		Where("eid = ? AND chunk_type = 'knowledge' AND status = ? AND entity_id IN ?", eid, model.EntityRelationStatusActive, entityIDs)

	if len(req.LibraryIDs) > 0 {
		q = q.Where("library_id IN ?", req.LibraryIDs)
	}
	if len(req.FileIDs) > 0 {
		q = q.Where("file_id IN ?", req.FileIDs)
	}

	var rows []entityScopeRow
	if err := q.Limit(5000).Find(&rows).Error; err != nil {
		logger.SysErrorf("【缩小实体范围】查询实体关联关系失败: eid=%d, entity_ids=%v, err=%v", eid, entityIDs, err)
		return meta, err
	}
	meta.ChunkCandidateCount = len(rows)
	fileIDSet := make(map[int64]struct{})
	libraryIDSet := make(map[int64]struct{})
	libraryCount := make(map[int64]int)
	for _, r := range rows {
		if r.FileID > 0 {
			fileIDSet[r.FileID] = struct{}{}
		}
		if r.LibraryID > 0 {
			libraryIDSet[r.LibraryID] = struct{}{}
			libraryCount[r.LibraryID]++
		}
	}
	logger.SysDebugf("【实体向量匹配】范围候选统计: eid=%d, 种子实体数=%d, 实体数=%d, 范围记录数=%d, 唯一文件数=%d, 唯一知识库数=%d",
		eid, len(meta.SeedEntities), len(entityIDs), len(rows), len(fileIDSet), len(libraryIDSet))
	if len(rows) == 0 {
		logger.SysDebugf("【实体向量匹配】实体未带来范围变化: eid=%d, 种子实体数=%d, 实体数=%d, 最终文件数=%d, 最终知识库数=%d",
			eid, len(meta.SeedEntities), len(entityIDs), len(req.FileIDs), len(req.LibraryIDs))
		fallbackLibraryIDs, narrowed, positiveScoreCount, fallbackErr := s.rankLibrariesByScopeSignals(eid, originalLibraryIDs, signals)
		if fallbackErr != nil {
			logger.SysDebugf("【实体向量匹配】查询信号兜底收敛失败: eid=%d, err=%v", eid, fallbackErr)
			return meta, nil
		}
		if narrowed {
			req.LibraryIDs = fallbackLibraryIDs
			logger.SysDebugf("【实体向量匹配】查询信号兜底收敛: eid=%d, 原始知识库数=%d, 最终知识库数=%d, 正向评分数=%d",
				eid, len(originalLibraryIDs), len(req.LibraryIDs), positiveScoreCount)
		}
		return meta, nil
	}

	rankedLibraryIDs, rankErr := s.rankScopeLibraryIDsByScore(eid, libraryCount, signals)
	if rankErr != nil {
		logger.SysDebugf("【实体向量匹配】候选知识库软评分失败，回退到计数排序: eid=%d, err=%v", eid, rankErr)
		rankedLibraryIDs = topInt64IDsByCount(libraryCount, maxGraphScopeLibraries)
	}

	if len(req.FileIDs) == 0 && len(fileIDSet) > 0 {
		fileIDs := sortedLimitedInt64IDs(fileIDSet, 2000)
		if len(originalFileIDs) > 0 {
			fileIDs = intersectInt64IDs(originalFileIDs, fileIDs)
			if len(fileIDs) == 0 {
				fileIDs = append([]int64(nil), originalFileIDs...)
			}
		}
		req.FileIDs = fileIDs

		// 文件级收敛时同步收敛知识库范围，避免后续仍按原始全库并发检索。
		libraryIDs := append([]int64(nil), rankedLibraryIDs...)
		if len(originalLibraryIDs) > 0 {
			libraryIDs = intersectInt64IDsPreserveOrder(libraryIDs, originalLibraryIDs)
			if len(libraryIDs) == 0 {
				libraryIDs = append([]int64(nil), originalLibraryIDs...)
			}
		} else if len(req.LibraryIDs) > 0 && len(libraryIDs) > 0 {
			libraryIDs = intersectInt64IDsPreserveOrder(libraryIDs, req.LibraryIDs)
		}
		if len(originalLibraryIDs) > 0 || len(libraryIDs) > 0 {
			req.LibraryIDs = libraryIDs
		}
		logger.SysDebugf("【实体向量匹配】文件级收敛: eid=%d, 文件数=%d, 知识库数=%d, 上限=%d", eid, len(fileIDs), len(req.LibraryIDs), maxGraphScopeLibraries)
	} else if len(libraryIDSet) > 0 {
		libraryIDs := append([]int64(nil), rankedLibraryIDs...)
		if len(originalLibraryIDs) > 0 {
			libraryIDs = intersectInt64IDsPreserveOrder(libraryIDs, originalLibraryIDs)
			if len(libraryIDs) == 0 {
				libraryIDs = append([]int64(nil), originalLibraryIDs...)
			}
		}
		req.LibraryIDs = libraryIDs
		logger.SysDebugf("【实体向量匹配】知识库级收敛: eid=%d, 原始知识库数=%d, 最终知识库数=%d, 上限=%d",
			eid, len(originalLibraryIDs), len(req.LibraryIDs), maxGraphScopeLibraries)
	}

	logger.SysDebugf("【实体向量匹配】范围收敛完成: eid=%d, 种子实体数=%d, 实体数=%d, 分片候选数=%d, 最终文件数=%d, 最终知识库数=%d",
		eid, len(meta.SeedEntities), len(entityIDs), meta.ChunkCandidateCount, len(req.FileIDs), len(req.LibraryIDs))
	return meta, nil
}

type scopeLibraryScore struct {
	libraryID     int64
	relationCount int
	softScore     int
}

func (s *SearchService) rankScopeLibraryIDsByScore(eid int64, libraryCount map[int64]int, signals scopeSignals) ([]int64, error) {
	if len(libraryCount) == 0 {
		return nil, nil
	}

	candidateIDs := make([]int64, 0, len(libraryCount))
	for libraryID := range libraryCount {
		candidateIDs = append(candidateIDs, libraryID)
	}

	libraryMap, err := s.batchGetLibrariesByIDs(eid, candidateIDs)
	if err != nil {
		return topInt64IDsByCount(libraryCount, maxGraphScopeLibraries), err
	}

	fileMap, fileErr := s.batchGetFilesByLibraryIDs(eid, candidateIDs)
	if fileErr != nil {
		logger.SysDebugf("【实体向量匹配】批量查询文件元信息失败，继续使用库级评分: eid=%d, err=%v", eid, fileErr)
		fileMap = make(map[int64][]model.File)
	}

	scores := make([]scopeLibraryScore, 0, len(candidateIDs))
	for _, libraryID := range candidateIDs {
		scores = append(scores, scopeLibraryScore{
			libraryID:     libraryID,
			relationCount: libraryCount[libraryID],
			softScore:     scoreScopeLibraryCandidate(libraryMap[libraryID], fileMap[libraryID], signals),
		})
	}

	sort.Slice(scores, func(i, j int) bool {
		if scores[i].relationCount == scores[j].relationCount {
			if scores[i].softScore == scores[j].softScore {
				return scores[i].libraryID < scores[j].libraryID
			}
			return scores[i].softScore > scores[j].softScore
		}
		return scores[i].relationCount > scores[j].relationCount
	})

	if maxGraphScopeLibraries > 0 && len(scores) > maxGraphScopeLibraries {
		scores = scores[:maxGraphScopeLibraries]
	}

	ranked := make([]int64, 0, len(scores))
	for _, item := range scores {
		ranked = append(ranked, item.libraryID)
	}
	return ranked, nil
}

type scopeLibraryRankItem struct {
	libraryID int64
	score     int
	position  int
}

func (s *SearchService) rankLibrariesByScopeSignals(eid int64, libraryIDs []int64, signals scopeSignals) ([]int64, bool, int, error) {
	uniqueLibraryIDs := uniqueInt64IDsInOrder(libraryIDs)
	if len(uniqueLibraryIDs) == 0 {
		return nil, false, 0, nil
	}

	libraryMap, err := s.batchGetLibrariesByIDs(eid, uniqueLibraryIDs)
	if err != nil {
		return nil, false, 0, err
	}

	fileMap, fileErr := s.batchGetFilesByLibraryIDs(eid, uniqueLibraryIDs)
	if fileErr != nil {
		logger.SysDebugf("【实体向量匹配】批量查询文件元信息失败，继续使用库级查询信号: eid=%d, err=%v", eid, fileErr)
		fileMap = make(map[int64][]model.File)
	}

	scored := make([]scopeLibraryRankItem, 0, len(uniqueLibraryIDs))
	positiveScoreCount := 0
	for idx, libraryID := range uniqueLibraryIDs {
		score := scoreScopeLibraryCandidate(libraryMap[libraryID], fileMap[libraryID], signals)
		if score > 0 {
			positiveScoreCount++
		}
		scored = append(scored, scopeLibraryRankItem{
			libraryID: libraryID,
			score:     score,
			position:  idx,
		})
	}

	if len(uniqueLibraryIDs) <= maxGraphScopeLibraries {
		return uniqueLibraryIDs, false, positiveScoreCount, nil
	}

	sort.Slice(scored, func(i, j int) bool {
		if scored[i].score == scored[j].score {
			return scored[i].position < scored[j].position
		}
		return scored[i].score > scored[j].score
	})

	if positiveScoreCount > 0 {
		filtered := make([]scopeLibraryRankItem, 0, positiveScoreCount)
		for _, item := range scored {
			if item.score > 0 {
				filtered = append(filtered, item)
			}
		}
		if len(filtered) > maxGraphScopeLibraries {
			filtered = filtered[:maxGraphScopeLibraries]
		}
		ranked := make([]int64, 0, len(filtered))
		for _, item := range filtered {
			ranked = append(ranked, item.libraryID)
		}
		return ranked, true, positiveScoreCount, nil
	}

	if len(scored) > maxGraphScopeLibraries {
		scored = scored[:maxGraphScopeLibraries]
	}
	ranked := make([]int64, 0, len(scored))
	for _, item := range scored {
		ranked = append(ranked, item.libraryID)
	}
	return ranked, false, positiveScoreCount, nil
}

func scoreScopeLibraryCandidate(library *model.Library, files []model.File, signals scopeSignals) int {
	score := 0
	if library != nil {
		score += scoreScopeText(library.Name, signals) * 6
		score += scoreScopeText(library.Description, signals) * 4
		if len(signals.Phrases) > 0 {
			query := signals.Phrases[0]
			score += scoreScopeContainmentMatch(query, library.Name) * 4
			score += scoreScopeContainmentMatch(query, library.Description) * 2
		}
	}

	bestFileScore := 0
	for _, file := range files {
		if file.Type != model.FILE_TYPE_FILE || file.IsDeleted {
			continue
		}

		fileScore := scoreScopeText(file.Path, signals) * 2
		fileScore += scoreScopeText(file.Summary, signals) * 5
		fileScore += scoreScopeText(string(file.InsightSummary), signals) * 5
		if fileScore > bestFileScore {
			bestFileScore = fileScore
		}
	}

	return score + bestFileScore
}

func normalizeKeywordOrder(keywords []string) []string {
	if len(keywords) == 0 {
		return nil
	}

	seen := make(map[string]struct{}, len(keywords))
	normalized := make([]string, 0, len(keywords))
	for _, kw := range keywords {
		kw = strings.TrimSpace(kw)
		if kw == "" {
			continue
		}
		if _, ok := seen[kw]; ok {
			continue
		}
		seen[kw] = struct{}{}
		normalized = append(normalized, kw)
	}
	if len(normalized) == 0 {
		return nil
	}
	return normalized
}

func (s *SearchService) shouldParallelizeKeywordQueries() bool {
	if s == nil || s.db == nil || s.db.Dialector == nil {
		return false
	}

	// SQLite in-memory tests can open isolated connections per goroutine, so keep
	// keyword lookups sequential there and parallelize only on the production DBs.
	return !strings.EqualFold(s.db.Dialector.Name(), "sqlite")
}

func mergeEntitiesByKeywordOrder(resultsByKeyword [][]model.Entity) []model.Entity {
	idSet := make(map[int64]struct{})
	results := make([]model.Entity, 0)
	for _, entities := range resultsByKeyword {
		for _, entity := range entities {
			if entity.ID <= 0 {
				continue
			}
			if _, ok := idSet[entity.ID]; ok {
				continue
			}
			idSet[entity.ID] = struct{}{}
			results = append(results, entity)
		}
	}
	return results
}

func (s *SearchService) collectEntitiesByKeywords(eid int64, keywords []string, fetch func(string) ([]model.Entity, error), logLabel string) []model.Entity {
	normalized := normalizeKeywordOrder(keywords)
	if len(normalized) == 0 {
		return nil
	}

	if !s.shouldParallelizeKeywordQueries() || len(normalized) == 1 {
		return s.collectEntitiesByKeywordsSequential(eid, normalized, fetch, logLabel)
	}

	resultsByKeyword := make([][]model.Entity, len(normalized))
	var wg sync.WaitGroup
	for i, keyword := range normalized {
		i := i
		keyword := keyword
		wg.Add(1)
		go func() {
			defer wg.Done()
			entities, err := fetch(keyword)
			if err != nil {
				logger.SysErrorf("【缩小实体范围】【明显告警】%s: eid=%d, keyword=%s, err=%v", logLabel, eid, keyword, err)
				return
			}
			resultsByKeyword[i] = entities
		}()
	}
	wg.Wait()
	return mergeEntitiesByKeywordOrder(resultsByKeyword)
}

func (s *SearchService) collectEntitiesByKeywordsSequential(eid int64, keywords []string, fetch func(string) ([]model.Entity, error), logLabel string) []model.Entity {
	idSet := make(map[int64]struct{})
	results := make([]model.Entity, 0)
	for _, kw := range keywords {
		entities, err := fetch(kw)
		if err != nil {
			logger.SysErrorf("【缩小实体范围】【明显告警】%s: eid=%d, keyword=%s, err=%v", logLabel, eid, kw, err)
			continue
		}
		for _, entity := range entities {
			if entity.ID <= 0 {
				continue
			}
			if _, ok := idSet[entity.ID]; ok {
				continue
			}
			idSet[entity.ID] = struct{}{}
			results = append(results, entity)
		}
	}
	return results
}

func (s *SearchService) batchGetFilesByLibraryIDs(eid int64, libraryIDs []int64) (map[int64][]model.File, error) {
	result := make(map[int64][]model.File)
	uniqueLibraryIDs := uniqueInt64IDsInOrder(libraryIDs)
	if len(uniqueLibraryIDs) == 0 {
		return result, nil
	}

	var files []model.File
	if err := s.db.Select("id, eid, library_id, path, summary, insight_summary, type, is_deleted").
		Where("eid = ? AND library_id IN ? AND is_deleted = ? AND type = ?", eid, uniqueLibraryIDs, false, model.FILE_TYPE_FILE).
		Find(&files).Error; err != nil {
		return nil, err
	}

	for i := range files {
		file := files[i]
		result[file.LibraryID] = append(result[file.LibraryID], file)
	}
	return result, nil
}

func mergeEntityMatches(sources ...[]model.Entity) []model.Entity {
	idSet := make(map[int64]struct{})
	results := make([]model.Entity, 0)
	for _, source := range sources {
		for _, entity := range source {
			if entity.ID <= 0 {
				continue
			}
			if _, exists := idSet[entity.ID]; exists {
				continue
			}
			idSet[entity.ID] = struct{}{}
			results = append(results, entity)
		}
	}
	return results
}

func shouldSkipEntityVectorMatch(likeHitCount, keywordCount int) (bool, int) {
	if likeHitCount <= 0 || keywordCount <= 0 {
		return false, 0
	}

	threshold := keywordCount * 4
	if threshold < 4 {
		threshold = 4
	}
	return likeHitCount >= threshold, threshold
}

func sameInt64Set(a, b []int64) bool {
	if len(a) != len(b) {
		aSet := make(map[int64]struct{}, len(a))
		for _, v := range a {
			aSet[v] = struct{}{}
		}
		for _, v := range b {
			if _, ok := aSet[v]; !ok {
				return false
			}
		}
		bSet := make(map[int64]struct{}, len(b))
		for _, v := range b {
			bSet[v] = struct{}{}
		}
		for _, v := range a {
			if _, ok := bSet[v]; !ok {
				return false
			}
		}
		return true
	}

	set := make(map[int64]struct{}, len(a))
	for _, v := range a {
		set[v] = struct{}{}
	}
	for _, v := range b {
		if _, ok := set[v]; !ok {
			return false
		}
	}
	return true
}

func truncateForDebug(input string, max int) string {
	if max <= 0 || len(input) <= max {
		return input
	}
	return input[:max] + "...(truncated)"
}

func firstNRunesForDebug(input string, max int) string {
	if max <= 0 {
		return ""
	}
	runes := []rune(input)
	if len(runes) <= max {
		return input
	}
	return string(runes[:max])
}

func derefIntForDebug(v *int) int {
	if v == nil {
		return 0
	}
	return *v
}

func derefBoolForDebug(v *bool) bool {
	if v == nil {
		return false
	}
	return *v
}

func previewInt64IDsForDebug(ids []int64, limit int) []int64 {
	if len(ids) == 0 || limit <= 0 || len(ids) <= limit {
		return append([]int64(nil), ids...)
	}
	return append([]int64(nil), ids[:limit]...)
}

func previewStringsForDebug(items []string, limit int) []string {
	if len(items) == 0 || limit <= 0 || len(items) <= limit {
		return append([]string(nil), items...)
	}
	return append([]string(nil), items[:limit]...)
}

func previewSearchResultsForDebug(results []SearchResultItem, limit int) []string {
	if len(results) == 0 || limit <= 0 {
		return []string{}
	}
	end := limit
	if len(results) < end {
		end = len(results)
	}
	out := make([]string, 0, end)
	for i := 0; i < end; i++ {
		r := results[i]
		out = append(out, fmt.Sprintf("chunk=%d,file=%d,lib=%d,score=%.6f", r.ChunkID, r.FileID, r.LibraryID, r.Score))
	}
	return out
}

func previewDocumentsForDebug(docs []string, limit int, maxLen int) []string {
	if len(docs) == 0 || limit <= 0 {
		return []string{}
	}
	end := limit
	if len(docs) < end {
		end = len(docs)
	}
	out := make([]string, 0, end)
	for i := 0; i < end; i++ {
		out = append(out, firstNRunesForDebug(docs[i], maxLen))
	}
	return out
}

func previewRerankResultsForDebug(results []RerankResult, limit int) []string {
	if len(results) == 0 || limit <= 0 {
		return []string{}
	}
	end := limit
	if len(results) < end {
		end = len(results)
	}
	out := make([]string, 0, end)
	for i := 0; i < end; i++ {
		r := results[i]
		out = append(out, fmt.Sprintf("index=%d,score=%.6f", r.Index, r.RelevanceScore))
	}
	return out
}

func safeBaseURL(baseURL *string) string {
	if baseURL == nil {
		return ""
	}
	return *baseURL
}

func sortedLimitedInt64IDs(idSet map[int64]struct{}, limit int) []int64 {
	if len(idSet) == 0 || limit == 0 {
		return nil
	}
	ids := make([]int64, 0, len(idSet))
	for id := range idSet {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	if limit > 0 && len(ids) > limit {
		ids = ids[:limit]
	}
	return ids
}

func topInt64IDsByCount(counts map[int64]int, limit int) []int64 {
	if len(counts) == 0 || limit == 0 {
		return nil
	}
	type item struct {
		id    int64
		count int
	}
	items := make([]item, 0, len(counts))
	for id, count := range counts {
		items = append(items, item{id: id, count: count})
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].count == items[j].count {
			return items[i].id < items[j].id
		}
		return items[i].count > items[j].count
	})
	if limit > 0 && len(items) > limit {
		items = items[:limit]
	}
	ids := make([]int64, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.id)
	}
	return ids
}

func intersectInt64IDs(left, right []int64) []int64 {
	if len(left) == 0 || len(right) == 0 {
		return nil
	}
	rightSet := make(map[int64]struct{}, len(right))
	for _, id := range right {
		rightSet[id] = struct{}{}
	}
	seen := make(map[int64]struct{})
	result := make([]int64, 0, len(left))
	for _, id := range left {
		if _, ok := rightSet[id]; !ok {
			continue
		}
		if _, duplicated := seen[id]; duplicated {
			continue
		}
		seen[id] = struct{}{}
		result = append(result, id)
	}
	sort.Slice(result, func(i, j int) bool { return result[i] < result[j] })
	return result
}

func intersectInt64IDsPreserveOrder(left, right []int64) []int64 {
	if len(left) == 0 || len(right) == 0 {
		return nil
	}
	rightSet := make(map[int64]struct{}, len(right))
	for _, id := range right {
		rightSet[id] = struct{}{}
	}
	seen := make(map[int64]struct{})
	result := make([]int64, 0, len(left))
	for _, id := range left {
		if _, ok := rightSet[id]; !ok {
			continue
		}
		if _, duplicated := seen[id]; duplicated {
			continue
		}
		seen[id] = struct{}{}
		result = append(result, id)
	}
	return result
}

func shouldUseMultiLibraryVectorSearch(req *SearchRequest) bool {
	if req == nil {
		return false
	}
	// 文件级过滤优先，避免在 file_ids 已收敛时仍按全库并发搜索。
	if len(req.FileIDs) > 0 {
		return false
	}
	return len(req.LibraryIDs) > 1
}

func isDefaultSingleVectorSearchFn() bool {
	return reflect.ValueOf(singleVectorSearchFn).Pointer() == reflect.ValueOf(defaultSingleVectorSearchFn).Pointer()
}

func (s *SearchService) vectorMatchEntities(eid int64, keywords []string) ([]model.Entity, error) {
	if s.vectorDB == nil {
		return nil, fmt.Errorf("向量数据库未初始化或初始化失败，请检查相关配置")
	}

	configService := NewChunkConfigService(s.db)
	config, err := configService.GetEnterpriseEmbeddingConfig(eid)
	if err != nil {
		return nil, err
	}
	if config.EmbeddingChannelID == nil {
		return nil, fmt.Errorf("未配置向量化渠道")
	}
	normalizedKeywords := normalizeKeywordOrder(keywords)
	if len(normalizedKeywords) == 0 {
		return nil, nil
	}
	matchThreshold := resolveEntityVectorMatchThreshold(config.EmbeddingChannel, config.EmbeddingModelName)

	queryVectors64, err := s.embedding.BatchGenerateEmbedding(eid, normalizedKeywords, config.EmbeddingChannel, config, NewEmptyEmbeddingContext())
	if err != nil || len(queryVectors64) != len(normalizedKeywords) {
		if err != nil {
			logger.SysDebugf("【实体向量匹配】批量生成向量失败，回退单条查询: eid=%d, keywords=%v, err=%v", eid, normalizedKeywords, err)
		} else {
			logger.SysDebugf("【实体向量匹配】批量生成向量数量不匹配，回退单条查询: eid=%d, expected=%d, got=%d", eid, len(normalizedKeywords), len(queryVectors64))
		}
		return s.vectorMatchEntitiesSequential(eid, normalizedKeywords, *config.EmbeddingChannelID, config, matchThreshold)
	}

	queryVectors32 := make([][]float32, len(queryVectors64))
	for i, v64 := range queryVectors64 {
		v32 := make([]float32, len(v64))
		for j, v := range v64 {
			v32[j] = float32(v)
		}
		queryVectors32[i] = v32
	}

	return s.vectorMatchEntitiesWithVectors(eid, normalizedKeywords, queryVectors32, matchThreshold)
}

func (s *SearchService) vectorMatchEntitiesSequential(eid int64, keywords []string, channelID int64, config *ChunkConfig, matchThreshold float32) ([]model.Entity, error) {
	if s.vectorDB == nil {
		return nil, fmt.Errorf("向量数据库未初始化或初始化失败，请检查相关配置")
	}

	collection := model.GetEntityVectorCollectionName(eid)
	idSet := make(map[int64]struct{})
	results := make([]model.Entity, 0)
	var firstErr error

	for _, kw := range keywords {
		queryVec64, err := s.embedding.GetQueryEmbedding(eid, kw, channelID, config)
		if err != nil {
			if firstErr == nil {
				firstErr = fmt.Errorf("关键词向量生成失败 keyword=%s: %v", kw, err)
			}
			continue
		}

		queryVec := make([]float32, len(queryVec64))
		for i, v := range queryVec64 {
			queryVec[i] = float32(v)
		}

		res, err := s.vectorDB.Search(context.Background(), vectorstore.SearchRequest{
			Collection:     collection,
			Vector:         queryVec,
			TopK:           10,
			ScoreThreshold: matchThreshold,
		})
		if err != nil {
			if firstErr == nil {
				firstErr = fmt.Errorf("向量检索失败 keyword=%s: %v", kw, err)
			}
			continue
		}
		if res == nil {
			continue
		}
		appendVectorMatchEntities(res.Results, matchThreshold, idSet, &results)
	}

	if len(results) == 0 && firstErr != nil {
		return nil, firstErr
	}
	return results, nil
}

func (s *SearchService) vectorMatchEntitiesWithVectors(eid int64, keywords []string, queryVectors32 [][]float32, matchThreshold float32) ([]model.Entity, error) {
	if s.vectorDB == nil {
		return nil, fmt.Errorf("向量数据库未初始化或初始化失败，请检查相关配置")
	}
	if len(keywords) == 0 {
		return nil, nil
	}
	if len(queryVectors32) != len(keywords) {
		return nil, fmt.Errorf("批量向量数量不匹配: expected=%d, got=%d", len(keywords), len(queryVectors32))
	}

	collection := model.GetEntityVectorCollectionName(eid)
	idSet := make(map[int64]struct{})
	results := make([]model.Entity, 0)
	var firstErr error

	batchSearcher, ok := s.vectorDB.(interface {
		SearchBatch(context.Context, vectorstore.BatchSearchRequest) ([]vectorstore.SearchResponse, error)
	})
	if ok {
		batchReq := vectorstore.BatchSearchRequest{
			Collection: collection,
			Searches:   make([]vectorstore.SearchRequest, len(keywords)),
		}
		for i := range keywords {
			batchReq.Searches[i] = vectorstore.SearchRequest{
				Collection:     collection,
				Vector:         queryVectors32[i],
				TopK:           10,
				ScoreThreshold: matchThreshold,
			}
		}

		responses, err := batchSearcher.SearchBatch(context.Background(), batchReq)
		if err == nil && len(responses) == len(keywords) {
			for i := range responses {
				appendVectorMatchEntities(responses[i].Results, matchThreshold, idSet, &results)
			}
			return results, nil
		}

		if err == nil {
			err = fmt.Errorf("批量搜索返回数量不匹配: expected=%d, got=%d", len(keywords), len(responses))
		}
		firstErr = err
		logger.SysDebugf("【实体向量匹配】批量向量检索失败，回退单条搜索: eid=%d, err=%v", eid, err)
	}

	for i, kw := range keywords {
		if len(queryVectors32[i]) == 0 {
			continue
		}

		res, err := s.vectorDB.Search(context.Background(), vectorstore.SearchRequest{
			Collection:     collection,
			Vector:         queryVectors32[i],
			TopK:           10,
			ScoreThreshold: matchThreshold,
		})
		if err != nil {
			if firstErr == nil {
				firstErr = fmt.Errorf("向量检索失败 keyword=%s: %v", kw, err)
			}
			continue
		}
		if res == nil {
			continue
		}
		appendVectorMatchEntities(res.Results, matchThreshold, idSet, &results)
	}

	if len(results) == 0 && firstErr != nil {
		return nil, firstErr
	}
	return results, nil
}

func appendVectorMatchEntities(results []vectorstore.SearchResult, matchThreshold float32, idSet map[int64]struct{}, out *[]model.Entity) {
	for _, r := range results {
		if r.Score < matchThreshold {
			continue
		}
		if r.Metadata == nil {
			continue
		}
		v, ok := r.Metadata["entity_id"]
		if !ok {
			continue
		}

		var id int64
		switch vv := v.(type) {
		case float64:
			id = int64(vv)
		case int64:
			id = vv
		case int:
			id = int64(vv)
		default:
			continue
		}
		if _, ok := idSet[id]; ok {
			continue
		}

		name := ""
		if nv, ok := r.Metadata["name"]; ok {
			if nvv, ok := nv.(string); ok {
				name = nvv
			}
		}
		*out = append(*out, model.Entity{ID: id, Name: name})
		idSet[id] = struct{}{}
	}
}

func resolveEntityVectorMatchThreshold(channel *model.Channel, modelName *string) float32 {
	if channel == nil {
		logger.SysDebugf("【实体向量匹配】未获取到渠道信息，使用默认阈值: default_threshold=%.4f", entityVectorMatchThreshold)
		return entityVectorMatchThreshold
	}

	if modelName == nil || strings.TrimSpace(*modelName) == "" {
		logger.SysDebugf("【实体向量匹配】未配置模型名，使用默认阈值: channel_id=%d, default_threshold=%.4f", channel.ChannelID, entityVectorMatchThreshold)
		return entityVectorMatchThreshold
	}

	thresholdHigh, found, err := model.FindVectorModelThresholdHigh(channel.CustomConfig, *modelName)
	if err != nil {
		logger.SysDebugf("【实体向量匹配】解析渠道阈值失败，使用默认阈值: channel_id=%d, model=%s, err=%v, default_threshold=%.4f",
			channel.ChannelID, *modelName, err, entityVectorMatchThreshold)
		return entityVectorMatchThreshold
	}
	if !found {
		logger.SysDebugf("【实体向量匹配】渠道未配置模型阈值，使用默认阈值: channel_id=%d, model=%s, default_threshold=%.4f",
			channel.ChannelID, *modelName, entityVectorMatchThreshold)
		return entityVectorMatchThreshold
	}

	threshold := float32(thresholdHigh) / 100.0
	logger.SysDebugf("【实体向量匹配】使用渠道模型阈值: channel_id=%d, model=%s, threshold_high=%d, threshold=%.4f",
		channel.ChannelID, *modelName, thresholdHigh, threshold)
	return threshold
}

func (s *SearchService) likeMatchEntitiesByKeywords(eid int64, keywords []string) []model.Entity {
	return s.collectEntitiesByKeywords(eid, keywords, func(kw string) ([]model.Entity, error) {
		return s.likeMatchEntities(eid, kw, 10)
	}, "LIKE回退查询失败")
}

func (s *SearchService) likeMatchEntitiesByKeywordsScoped(eid int64, keywords []string, libraryIDs []int64, fileIDs []int64) []model.Entity {
	return s.collectEntitiesByKeywords(eid, keywords, func(kw string) ([]model.Entity, error) {
		return s.likeMatchEntitiesScoped(eid, kw, 10, libraryIDs, fileIDs)
	}, "LIKE范围查询失败")
}

func (s *SearchService) likeMatchEntities(eid int64, keyword string, limit int) ([]model.Entity, error) {
	if s.db == nil {
		return nil, fmt.Errorf("db is nil")
	}
	if limit <= 0 {
		limit = 10
	}

	var entities []model.Entity
	err := s.db.Model(&model.Entity{}).
		Select("id", "name", "type", "status").
		Where("eid = ? AND status = ?", eid, model.EntityRelationStatusActive).
		Where("name LIKE ?", "%"+keyword+"%").
		Limit(limit).
		Find(&entities).Error
	if err != nil {
		return nil, err
	}
	return entities, nil
}

func (s *SearchService) likeMatchEntitiesScoped(eid int64, keyword string, limit int, libraryIDs []int64, fileIDs []int64) ([]model.Entity, error) {
	if s.db == nil {
		return nil, fmt.Errorf("db is nil")
	}
	if limit <= 0 {
		limit = 10
	}
	if len(libraryIDs) == 0 && len(fileIDs) == 0 {
		return []model.Entity{}, nil
	}

	query := s.db.Model(&model.Entity{}).
		Select("DISTINCT entities.id, entities.name, entities.type, entities.status").
		Joins("JOIN entity_chunk_relations ecr ON ecr.entity_id = entities.id").
		Where("entities.eid = ? AND entities.status = ? AND ecr.eid = ? AND ecr.status = ?",
			eid, model.EntityRelationStatusActive, eid, model.EntityRelationStatusActive).
		Where("entities.name LIKE ?", "%"+keyword+"%")

	if len(libraryIDs) > 0 {
		query = query.Where("ecr.library_id IN ?", libraryIDs)
	}
	if len(fileIDs) > 0 {
		query = query.Where("ecr.file_id IN ?", fileIDs)
	}

	var entities []model.Entity
	if err := query.Limit(limit).Find(&entities).Error; err != nil {
		return nil, err
	}
	return entities, nil
}

// vectorSearch 向量搜索
func (s *SearchService) vectorSearch(eid int64, req *SearchRequest, configService *ChunkConfigService) ([]SearchResultItem, error) {
	searchQuery := req.Query
	searchType := req.SearchType
	logger.SysDebugf("【向量检索】开始: eid=%d, query=%q, top_k=%d, search_type=%s, library_ids=%v, file_ids=%v, chunk_types=%v",
		eid, truncateForDebug(searchQuery, 256), req.TopK, searchType,
		previewInt64IDsForDebug(req.LibraryIDs, 20), previewInt64IDsForDebug(req.FileIDs, 20), req.ChunkTypes)

	// 检查向量数据库是否可用
	if s.vectorDB == nil {
		return nil, fmt.Errorf("向量数据库未初始化或初始化失败，请检查相关配置")
	}

	// 强制要求传入 LibraryIDs 或 FileIDs，避免越权检索
	if len(req.LibraryIDs) == 0 && len(req.FileIDs) == 0 {
		return nil, fmt.Errorf("LibraryIDs or FileIDs required")
	}

	// 文件级过滤优先，避免触发多知识库并发放大。
	if shouldUseMultiLibraryVectorSearch(req) {
		logger.SysDebugf("【向量检索】路由策略: multi_library, libraries=%v", previewInt64IDsForDebug(req.LibraryIDs, 20))
		return s.multiLibraryVectorSearch(eid, req, configService)
	}

	logger.SysDebugf("【向量检索】路由策略: single_vector, libraries=%v, files=%v",
		previewInt64IDsForDebug(req.LibraryIDs, 20), previewInt64IDsForDebug(req.FileIDs, 20))
	return s.singleVectorSearch(eid, req, configService)
}

// singleVectorSearch 单知识库向量搜索
func (s *SearchService) singleVectorSearch(eid int64, req *SearchRequest, configService *ChunkConfigService) ([]SearchResultItem, error) {
	if configService == nil {
		configService = NewChunkConfigService(s.db)
	}
	vectorStageStart := time.Now()
	vectorStageRecorded := false
	defer func() {
		if vectorStageRecorded {
			return
		}
		if req != nil && req.trace != nil {
			req.trace.add("vector_search_ms", time.Since(vectorStageStart))
		}
	}()

	var config *ChunkConfig
	var queryVector []float32
	var err error

	// 检查是否有预计算的配置和向量（多库并发搜索时传入）
	if req.precomputedChunkConfig != nil && req.precomputedQueryVector != nil {
		config = req.precomputedChunkConfig
		queryVector = req.precomputedQueryVector
		logger.SysDebugf("【向量检索】使用预计算向量: eid=%d, library_id=%v, vector_dim=%d",
			eid, req.LibraryIDs, len(queryVector))
	} else {
		// 获取embedding配置
		configStart := time.Now()
		config, err = s.getSearchConfig(eid, req, configService)
		if err != nil {
			return nil, fmt.Errorf("获取配置失败: %v", err)
		}
		logger.SysDebugf("【向量检索】获取配置耗时: eid=%d, library_id=%v, elapsed_ms=%d",
			eid, req.LibraryIDs, time.Since(configStart).Milliseconds())

		if config.EmbeddingChannelID == nil {
			return nil, fmt.Errorf("未配置向量化渠道")
		}

		// 生成查询向量
		embeddingStart := time.Now()
		var queryVector64 []float64
		queryVector64, err = s.embedding.GetQueryEmbedding(eid, req.Query, *config.EmbeddingChannelID, config)
		if err != nil {
			return nil, fmt.Errorf("生成查询向量失败: %v", err)
		}
		logger.SysDebugf("【向量检索】获取Embedding耗时: eid=%d, channel_id=%d, elapsed_ms=%d, vector_dim=%d",
			eid, *config.EmbeddingChannelID, time.Since(embeddingStart).Milliseconds(), len(queryVector64))

		// 转换向量格式 (float64 -> float32)
		queryVector = make([]float32, len(queryVector64))
		for i, v := range queryVector64 {
			queryVector[i] = float32(v)
		}
	}

	// 构建过滤条件
	filter := s.buildVectorFilter(eid, req)

	libraryIDs, err := s.resolveVectorSearchLibraryIDs(eid, req)
	if err != nil {
		return nil, err
	}
	libraryMap, err := s.batchGetLibrariesByIDs(eid, libraryIDs)
	if err != nil {
		logger.SysLogf("批量获取库信息失败: %v", err)
	}

	// 企业级读模式检查：如果命中则直接使用 doc_eid_{eid}
	var collections []string
	enterpriseReadMode := GetEnterpriseVectorReadMode(eid)
	if enterpriseReadMode == VectorCollectionModeEnterprise {
		collections = []string{model.GetDocumentVectorCollectionName(eid)}
		logger.SysDebugf("【向量检索】企业级检索集合: eid=%d, query=%q, collection=%s, filter=%s",
			eid, truncateForDebug(req.Query, 256), collections[0], truncateForDebug(fmt.Sprintf("%v", filter), 1000))
	} else {
		collections = make([]string, 0, len(libraryIDs))
		for _, libraryID := range libraryIDs {
			library, ok := libraryMap[libraryID]
			if !ok || library == nil {
				continue
			}
			collections = append(collections, model.GetVectorCollectionName(library.UUID))
		}
	}

	if len(collections) == 0 {
		return []SearchResultItem{}, nil
	}
	logger.SysDebugf("【向量检索】检索集合确定: eid=%d, query=%q, collection_count=%d, collections=%v, filter=%s",
		eid, truncateForDebug(req.Query, 256), len(collections), previewStringsForDebug(collections, 20), truncateForDebug(fmt.Sprintf("%v", filter), 1000))

	// 并发搜索多个集合，使用可配置上限。
	maxConcurrency := collectionSearchConcurrencyLimit()
	if len(collections) < maxConcurrency {
		maxConcurrency = len(collections)
	}

	// 使用信号量控制并发度
	semaphore := make(chan struct{}, maxConcurrency)
	var wg sync.WaitGroup
	var mu sync.Mutex
	var allResults []SearchResultItem

	ctx := context.Background()

	for _, collection := range collections {
		wg.Add(1)
		go func(coll string) {
			defer wg.Done()

			// 获取信号量
			semaphore <- struct{}{}
			defer func() { <-semaphore }()

			searchReq := vectorstore.SearchRequest{
				Collection: coll,
				Query:      req.Query,
				Vector:     queryVector,
				TopK:       req.TopK,
				Filters:    filter,
			}

			// 添加score_threshold支持
			if req.SearchConfig != nil && req.SearchConfig.ScoreThresholdEnabled && req.SearchConfig.ScoreThreshold > 0 {
				searchReq.ScoreThreshold = float32(req.SearchConfig.ScoreThreshold)
			}

			// 执行向量搜索
			searchResp, err := s.vectorDB.Search(ctx, searchReq)
			if err != nil {
				logger.SysLogf("向量搜索失败 Collection=%s: %v", coll, err)
				return
			}
			logger.SysDebugf("【向量检索】集合检索返回: collection=%s, raw_result_count=%d", coll, len(searchResp.Results))

			// 转换搜索结果格式
			vectorResults := make([]vectorstore.SearchResult, len(searchResp.Results))
			for i, result := range searchResp.Results {
				vectorResults[i] = vectorstore.SearchResult{
					ID:       result.ID,
					Score:    result.Score,
					Metadata: result.Metadata,
				}
			}

			if req != nil && req.trace != nil && !vectorStageRecorded {
				req.trace.add("vector_search_ms", time.Since(vectorStageStart))
				vectorStageRecorded = true
			}

			enrichStart := time.Now()
			// 获取分块详情并转换结果
			collectionResults, err := s.enrichVectorResults(eid, coll, vectorResults, req.Query, configService)
			if req != nil && req.trace != nil {
				req.trace.add("enrich_ms", time.Since(enrichStart))
			}
			if err != nil {
				logger.SysLogf("丰富向量结果失败 Collection=%s: %v", coll, err)
				return
			}
			logger.SysDebugf("【向量检索】集合富化完成: collection=%s, enriched_count=%d, sample=%v",
				coll, len(collectionResults), previewSearchResultsForDebug(collectionResults, 3))

			// 线程安全地合并结果
			mu.Lock()
			allResults = append(allResults, collectionResults...)
			mu.Unlock()
		}(collection)
	}

	// 等待所有搜索完成
	wg.Wait()

	// 按 ChunkID 去重（保留最高分）
	chunkMap := make(map[int64]SearchResultItem)
	for _, result := range allResults {
		if existing, exists := chunkMap[result.ChunkID]; !exists || result.Score > existing.Score {
			chunkMap[result.ChunkID] = result
		}
	}

	// 转换为切片并排序
	var deduplicatedResults []SearchResultItem
	for _, result := range chunkMap {
		deduplicatedResults = append(deduplicatedResults, result)
	}

	// 按分数排序
	sort.Slice(deduplicatedResults, func(i, j int) bool {
		return deduplicatedResults[i].Score > deduplicatedResults[j].Score
	})

	// 应用score_threshold过滤（在数据库过滤基础上再做一层保障）
	if req.SearchConfig != nil && req.SearchConfig.ScoreThresholdEnabled && req.SearchConfig.ScoreThreshold > 0 {
		var thresholdFilteredResults []SearchResultItem
		for _, result := range deduplicatedResults {
			if result.Score >= req.SearchConfig.ScoreThreshold {
				thresholdFilteredResults = append(thresholdFilteredResults, result)
			}
		}
		deduplicatedResults = thresholdFilteredResults
	}

	if len(deduplicatedResults) > req.TopK {
		deduplicatedResults = deduplicatedResults[:req.TopK]
	}
	logger.SysDebugf("【向量检索】完成: eid=%d, query=%q, final_count=%d, sample=%v",
		eid, truncateForDebug(req.Query, 256), len(deduplicatedResults), previewSearchResultsForDebug(deduplicatedResults, 5))

	return deduplicatedResults, nil
}

func (s *SearchService) resolveVectorSearchLibraryIDs(eid int64, req *SearchRequest) ([]int64, error) {
	if req == nil {
		return nil, nil
	}

	requestLibraryIDs := uniqueInt64IDsInOrder(req.LibraryIDs)
	fileIDs := uniqueInt64IDsInOrder(req.FileIDs)
	if len(fileIDs) == 0 {
		return requestLibraryIDs, nil
	}

	db := s.db
	if db == nil {
		db = model.DB
	}
	if db == nil {
		return nil, fmt.Errorf("数据库未初始化")
	}

	var files []model.File
	if err := db.Select("id, library_id").
		Where("eid = ? AND id IN ? AND is_deleted = ?", eid, fileIDs, false).
		Find(&files).Error; err != nil {
		return nil, fmt.Errorf("获取文件信息失败: %v", err)
	}

	fileLibraryByID := make(map[int64]int64, len(files))
	for _, file := range files {
		if file.LibraryID <= 0 {
			continue
		}
		fileLibraryByID[file.ID] = file.LibraryID
	}

	fileLibraryIDs := make([]int64, 0, len(files))
	seenLibraryIDs := make(map[int64]struct{}, len(files))
	for _, fileID := range fileIDs {
		libraryID, ok := fileLibraryByID[fileID]
		if !ok {
			continue
		}
		if _, exists := seenLibraryIDs[libraryID]; exists {
			continue
		}
		seenLibraryIDs[libraryID] = struct{}{}
		fileLibraryIDs = append(fileLibraryIDs, libraryID)
	}

	if len(requestLibraryIDs) == 0 {
		return fileLibraryIDs, nil
	}
	return intersectInt64IDsPreserveOrder(requestLibraryIDs, fileLibraryIDs), nil
}

// fulltextSearch 全文搜索
func (s *SearchService) fulltextSearch(eid int64, req *SearchRequest) ([]SearchResultItem, error) {
	query := s.db.Where("eid = ? AND content LIKE ?", eid, "%"+req.Query+"%")

	// 应用过滤条件
	query = s.applyFilters(query, req)

	var chunks []model.RetrievalChunk
	err := query.Limit(req.TopK).Find(&chunks).Error
	if err != nil {
		return nil, fmt.Errorf("全文搜索失败: %v", err)
	}

	return s.convertToSearchResults(chunks, req.Query, "fulltext")
}

// hybridSearch 混合搜索
func (s *SearchService) hybridSearch(eid int64, req *SearchRequest, configService *ChunkConfigService) ([]SearchResultItem, error) {
	// 并发执行向量搜索和全文搜索
	vectorChan := make(chan []SearchResultItem, 1)
	textChan := make(chan []SearchResultItem, 1)
	errorChan := make(chan error, 2)

	// 向量搜索
	go func() {
		results, err := s.vectorSearch(eid, req, configService)
		if err != nil {
			errorChan <- err
			return
		}
		vectorChan <- results
	}()

	// 全文搜索
	go func() {
		results, err := s.fulltextSearch(eid, req)
		if err != nil {
			errorChan <- err
			return
		}
		textChan <- results
	}()

	// 等待结果
	var vectorResults, textResults []SearchResultItem
	var vectorErr, textErr error

	for i := 0; i < 2; i++ {
		select {
		case results := <-vectorChan:
			vectorResults = results
		case results := <-textChan:
			textResults = results
		case err := <-errorChan:
			if vectorErr == nil {
				vectorErr = err
			} else {
				textErr = err
			}
		}
	}

	// 如果两个搜索都失败，返回错误
	if vectorErr != nil && textErr != nil {
		return nil, fmt.Errorf("向量搜索和全文搜索都失败: vector=%v, text=%v", vectorErr, textErr)
	}

	// 合并结果
	return s.mergeSearchResults(vectorResults, textResults, req.TopK), nil
}

// mergeSearchResults 合并搜索结果
func (s *SearchService) mergeSearchResults(vectorResults, textResults []SearchResultItem, topK int) []SearchResultItem {
	// 使用RRF (Reciprocal Rank Fusion) 算法合并结果
	resultMap := make(map[int64]*SearchResultItem)

	// 处理向量搜索结果
	for i, result := range vectorResults {
		result.VectorScore = result.Score
		result.Score = 1.0 / float64(i+60) // RRF with k=60
		resultMap[result.ChunkID] = &result
	}

	// 处理全文搜索结果
	for i, result := range textResults {
		if existing, exists := resultMap[result.ChunkID]; exists {
			existing.TextScore = result.Score
			existing.Score += 1.0 / float64(i+60)
			if result.Highlight != "" {
				existing.Highlight = result.Highlight
			}
		} else {
			result.TextScore = result.Score
			result.Score = 1.0 / float64(i+60)
			resultMap[result.ChunkID] = &result
		}
	}

	// 转换为切片并排序
	var mergedResults []SearchResultItem
	for _, result := range resultMap {
		mergedResults = append(mergedResults, *result)
	}

	sort.Slice(mergedResults, func(i, j int) bool {
		return mergedResults[i].Score > mergedResults[j].Score
	})

	// 限制结果数量
	if len(mergedResults) > topK {
		mergedResults = mergedResults[:topK]
	}

	return mergedResults
}

// buildVectorFilter 构建向量搜索过滤条件
// extractLibraryIDFromMetadata 从向量 payload 中提取 library_id
func extractLibraryIDFromMetadata(metadata map[string]interface{}) int64 {
	if metadata == nil {
		return 0
	}
	v, ok := metadata["library_id"]
	if !ok {
		return 0
	}
	switch v := v.(type) {
	case float64:
		return int64(v)
	case int64:
		return v
	case int:
		return int64(v)
	default:
		return 0
	}
}

func (s *SearchService) buildVectorFilter(eid int64, req *SearchRequest) map[string]interface{} {
	filter := map[string]interface{}{
		"must": []map[string]interface{}{
			{
				"key":   "eid",
				"match": map[string]interface{}{"value": eid},
			},
		},
	}

	var conditions []map[string]interface{}

	if len(req.LibraryIDs) > 0 {
		conditions = append(conditions, map[string]interface{}{
			"key": "library_id",
			"match": map[string]interface{}{
				"any": req.LibraryIDs,
			},
		})
	}

	if len(req.FileIDs) > 0 {
		conditions = append(conditions, map[string]interface{}{
			"key": "file_id",
			"match": map[string]interface{}{
				"any": req.FileIDs,
			},
		})
	}

	if len(req.ChunkTypes) > 0 {
		conditions = append(conditions, map[string]interface{}{
			"key": "chunk_type",
			"match": map[string]interface{}{
				"any": req.ChunkTypes,
			},
		})
	}

	if len(req.KnowledgeChunkIDs) > 0 {
		conditions = append(conditions, map[string]interface{}{
			"key": "knowledge_chunk_id",
			"match": map[string]interface{}{
				"any": req.KnowledgeChunkIDs,
			},
		})
	}

	if len(conditions) > 0 {
		filter["must"] = append(filter["must"].([]map[string]interface{}), conditions...)
	}

	return filter
}

// applyFilters 应用数据库查询过滤条件
func (s *SearchService) applyFilters(query *gorm.DB, req *SearchRequest) *gorm.DB {
	if len(req.LibraryIDs) > 0 {
		query = query.Where("library_id IN ?", req.LibraryIDs)
	}

	if len(req.FileIDs) > 0 {
		query = query.Where("file_id IN ?", req.FileIDs)
	}

	if len(req.ChunkTypes) > 0 {
		query = query.Where("chunk_type IN ?", req.ChunkTypes)
	}

	return query
}

type vectorResultBatch struct {
	Collection string
	Results    []vectorstore.SearchResult
}

type vectorEnrichmentData struct {
	configService    *ChunkConfigService
	chunkMap         map[interface{}]*model.RetrievalChunk
	foundIDs         map[interface{}]bool
	documentChunkMap map[int64]*model.DocumentChunk
	fileInfoMap      map[int64]*FileInfo
	libraryInfoMap   map[int64]*LibraryInfo
	chunkConfigCache map[int64]*ChunkConfig
	chunkConfigErr   map[int64]error
}

// enrichVectorResults 丰富向量搜索结果
func (s *SearchService) enrichVectorResults(eid int64, collection string, vectorResults []vectorstore.SearchResult, query string, configService *ChunkConfigService) ([]SearchResultItem, error) {
	return s.enrichVectorResultBatches(eid, []vectorResultBatch{{
		Collection: collection,
		Results:    vectorResults,
	}}, query, configService)
}

func (s *SearchService) enrichVectorResultBatches(eid int64, batches []vectorResultBatch, query string, configService *ChunkConfigService) ([]SearchResultItem, error) {
	grouped, err := s.enrichVectorResultBatchGroups(eid, [][]vectorResultBatch{batches}, []string{query}, configService)
	if err != nil {
		return nil, err
	}
	if len(grouped) == 0 {
		return []SearchResultItem{}, nil
	}
	return grouped[0], nil
}

func (s *SearchService) enrichVectorResultBatchGroups(eid int64, groups [][]vectorResultBatch, queries []string, configService *ChunkConfigService) ([][]SearchResultItem, error) {
	results := make([][]SearchResultItem, len(groups))
	if len(groups) == 0 {
		return results, nil
	}
	flattened := make([]vectorResultBatch, 0)
	for _, group := range groups {
		flattened = append(flattened, group...)
	}
	enrichmentData, err := s.loadVectorEnrichmentData(eid, flattened, configService)
	if err != nil {
		return nil, err
	}
	buildStart := time.Now()
	totalResults := 0
	for i, group := range groups {
		query := ""
		if i < len(queries) {
			query = queries[i]
		}
		results[i] = s.buildVectorSearchResultsFromBatches(eid, enrichmentData, group, query)
		totalResults += len(results[i])
	}
	logger.SysDebugf("【向量富化】结果拆分完成: eid=%d, group_count=%d, total_results=%d, build_ms=%d",
		eid, len(groups), totalResults, time.Since(buildStart).Milliseconds())
	return results, nil
}

func (s *SearchService) loadVectorEnrichmentData(eid int64, batches []vectorResultBatch, configService *ChunkConfigService) (*vectorEnrichmentData, error) {
	loadStart := time.Now()
	totalVectorResults := 0
	for _, batch := range batches {
		totalVectorResults += len(batch.Results)
	}
	if configService == nil {
		configService = NewChunkConfigService(s.db)
	}
	data := &vectorEnrichmentData{
		configService:    configService,
		chunkMap:         make(map[interface{}]*model.RetrievalChunk),
		foundIDs:         make(map[interface{}]bool),
		documentChunkMap: make(map[int64]*model.DocumentChunk),
		fileInfoMap:      make(map[int64]*FileInfo),
		libraryInfoMap:   make(map[int64]*LibraryInfo),
		chunkConfigCache: make(map[int64]*ChunkConfig),
		chunkConfigErr:   make(map[int64]error),
	}
	if totalVectorResults == 0 {
		logger.SysDebugf("【向量富化】跳过空结果富化: eid=%d, batch_count=%d", eid, len(batches))
		return data, nil
	}

	// 批量查询所有RetrievalChunk
	vectorIDs := make([]interface{}, 0, totalVectorResults)
	vectorIDSet := make(map[interface{}]bool, totalVectorResults)
	for _, batch := range batches {
		for _, vectorResult := range batch.Results {
			if vectorIDSet[vectorResult.ID] {
				continue
			}
			vectorIDSet[vectorResult.ID] = true
			vectorIDs = append(vectorIDs, vectorResult.ID)
		}
	}

	retrievalStart := time.Now()
	retrievalChunks, err := model.BatchGetRetrievalChunksByVectorIDs(eid, vectorIDs)
	retrievalMs := time.Since(retrievalStart).Milliseconds()
	if err != nil {
		logger.SysLogf("批量查询RetrievalChunk失败: %v", err)
		return nil, err
	}

	// 创建向量ID到RetrievalChunk的映射
	for i := range retrievalChunks {
		chunk := &retrievalChunks[i]
		data.chunkMap[chunk.VectorID] = chunk
		data.foundIDs[chunk.VectorID] = true
	}

	for _, batch := range batches {
		orphanVectorIDs := collectOrphanVectorIDs(batch.Results, data.foundIDs)
		if len(orphanVectorIDs) > 0 {
			cleanupManager := getOrphanVectorCleanupManager()
			logger.SysLogf("【孤儿向量清理】发现异常向量批次: eid=%d, collection=%s, count=%d",
				eid, batch.Collection, len(orphanVectorIDs))
			cleanupManager.enqueueBatch(eid, batch.Collection, orphanVectorIDs)
		}
	}

	// 过滤向量搜索结果，只保留在数据库中找到的分片
	filteredVectorResults := make([]vectorstore.SearchResult, 0, totalVectorResults)
	for _, batch := range batches {
		for _, vectorResult := range batch.Results {
			if data.foundIDs[vectorResult.ID] {
				filteredVectorResults = append(filteredVectorResults, vectorResult)
			} else {
				logger.SysLogf("❌ 过滤掉未找到的分片: VectorID=%v, collection=%s", vectorResult.ID, batch.Collection)
			}
		}
	}

	if len(filteredVectorResults) == 0 {
		return data, nil
	}

	// 收集所有KnowledgeChunkID用于批量查询DocumentChunk
	var knowledgeChunkIDs []int64
	knowledgeChunkIDSet := make(map[int64]bool)
	for _, vectorResult := range filteredVectorResults {
		chunk := data.chunkMap[vectorResult.ID]
		if chunk.KnowledgeChunkID != 0 && !knowledgeChunkIDSet[chunk.KnowledgeChunkID] {
			knowledgeChunkIDs = append(knowledgeChunkIDs, chunk.KnowledgeChunkID)
			knowledgeChunkIDSet[chunk.KnowledgeChunkID] = true
		}
	}

	// 批量查询DocumentChunk
	var documentChunks []model.DocumentChunk
	documentMs := int64(0)
	if len(knowledgeChunkIDs) > 0 {
		documentStart := time.Now()
		documentChunks, err = model.BatchGetDocumentChunksByIDs(eid, knowledgeChunkIDs)
		documentMs = time.Since(documentStart).Milliseconds()
		if err != nil {
			logger.SysLogf("批量查询DocumentChunk失败: %v", err)
			// 继续处理，使用空切片
			documentChunks = []model.DocumentChunk{}
		}
	}

	// 创建KnowledgeChunkID到DocumentChunk的映射
	for i := range documentChunks {
		data.documentChunkMap[documentChunks[i].ID] = &documentChunks[i]
	}

	// 收集需要查询的文件ID和知识库ID
	var fileIDs []int64
	var libraryIDs []int64
	fileIDSet := make(map[int64]bool)
	libraryIDSet := make(map[int64]bool)

	for _, vectorResult := range filteredVectorResults {
		chunk := data.chunkMap[vectorResult.ID]
		if !fileIDSet[chunk.FileID] {
			fileIDs = append(fileIDs, chunk.FileID)
			fileIDSet[chunk.FileID] = true
		}
		if !libraryIDSet[chunk.LibraryID] {
			libraryIDs = append(libraryIDs, chunk.LibraryID)
			libraryIDSet[chunk.LibraryID] = true
		}
	}

	// 批量查询文件信息和知识库信息
	fileStart := time.Now()
	fileInfoMap, err := s.batchGetFileInfo(eid, fileIDs)
	fileMs := time.Since(fileStart).Milliseconds()
	if err != nil {
		logger.SysLogf("批量查询文件信息失败: %v", err)
		fileInfoMap = make(map[int64]*FileInfo)
	}
	data.fileInfoMap = fileInfoMap

	libraryStart := time.Now()
	libraryInfoMap, err := s.batchGetLibraryInfo(eid, libraryIDs)
	libraryMs := time.Since(libraryStart).Milliseconds()
	if err != nil {
		logger.SysLogf("批量查询知识库信息失败: %v", err)
		libraryInfoMap = make(map[int64]*LibraryInfo)
	}
	data.libraryInfoMap = libraryInfoMap

	logger.SysDebugf("【向量富化】数据加载完成: eid=%d, batch_count=%d, raw_vector_count=%d, unique_vector_count=%d, retrieval_count=%d, document_chunk_count=%d, file_count=%d, library_count=%d, retrieval_ms=%d, document_ms=%d, file_ms=%d, library_ms=%d, total_ms=%d",
		eid, len(batches), totalVectorResults, len(vectorIDs), len(retrievalChunks), len(documentChunks), len(fileIDs), len(libraryIDs),
		retrievalMs, documentMs, fileMs, libraryMs, time.Since(loadStart).Milliseconds())

	return data, nil
}

func (data *vectorEnrichmentData) getChunkConfig(eid int64, libraryID int64) (*ChunkConfig, error) {
	if data == nil || data.configService == nil {
		return nil, fmt.Errorf("分块配置服务未初始化")
	}
	if config, ok := data.chunkConfigCache[libraryID]; ok {
		return config, data.chunkConfigErr[libraryID]
	}
	config, err := data.configService.GetEnterpriseEmbeddingConfig(eid)
	data.chunkConfigCache[libraryID] = config
	if err != nil {
		data.chunkConfigErr[libraryID] = err
	}
	return config, err
}

func (s *SearchService) buildVectorSearchResultsFromBatches(eid int64, data *vectorEnrichmentData, batches []vectorResultBatch, query string) []SearchResultItem {
	if data == nil {
		return []SearchResultItem{}
	}

	totalVectorResults := 0
	for _, batch := range batches {
		totalVectorResults += len(batch.Results)
	}
	if totalVectorResults == 0 {
		return []SearchResultItem{}
	}

	filteredVectorResults := make([]vectorstore.SearchResult, 0, totalVectorResults)
	for _, batch := range batches {
		for _, vectorResult := range batch.Results {
			if data.foundIDs[vectorResult.ID] {
				filteredVectorResults = append(filteredVectorResults, vectorResult)
			}
		}
	}
	if len(filteredVectorResults) == 0 {
		return []SearchResultItem{}
	}

	// 转换结果
	var results []SearchResultItem
	// 按 document_chunk 去重：同一 document_chunk 可能对应多个 retrieval_chunk，保留分数最高的检索块
	bestByDoc := make(map[int64]*SearchResultItem)
	for _, vectorResult := range filteredVectorResults {
		rc := data.chunkMap[vectorResult.ID]
		// 获取 document chunk（KnowledgeChunkID 指向 document_chunks.id）
		var docChunk *model.DocumentChunk
		if rc.KnowledgeChunkID != 0 {
			if dc, exists := data.documentChunkMap[rc.KnowledgeChunkID]; exists {
				docChunk = dc
			}
		}

		// 准备内容与元信息
		docContent := rc.Content
		if docChunk != nil && docChunk.Content != "" {
			docContent = docChunk.Content
		}

		// 获取知识库配置，用于动态添加标题和文件名
		// 注意：这里获取配置是为了支持 KnowledgeIncludeTitle 和 KnowledgeIncludeFileName
		var chunkConfig *ChunkConfig
		var configErr error
		configLibraryID := rc.LibraryID
		if docChunk != nil {
			configLibraryID = docChunk.LibraryID
		}
		chunkConfig, configErr = data.getChunkConfig(eid, configLibraryID)

		// 如果需要，动态添加标题和文件名到内容中
		if configErr == nil && chunkConfig != nil {
			var prefixParts []string

			// 动态获取文件名（如果配置启用）
			if chunkConfig.KnowledgeIncludeFileName {
				fileInfo, fileExists := data.fileInfoMap[rc.FileID]
				if fileExists && fileInfo != nil && fileInfo.FilePath != "" {
					// 复用 RetrievalChunkService 的方法来提取文件名（去掉后缀）
					fileName := s.extractFileNameFromPath(fileInfo.FilePath)
					if fileName != "" {
						prefixParts = append(prefixParts, fileName)
					}
				}
			}

			// 动态获取文档标题（如果配置启用）
			if chunkConfig.KnowledgeIncludeTitle {
				// 复用 RetrievalChunkService 的方法来提取标题
				title := s.extractDocumentTitleFromRetrievalChunk(eid, rc)
				if title != "" {
					prefixParts = append(prefixParts, title)
				}
			}

			// 动态获取子标题（如果配置启用）
			if chunkConfig.KnowledgeIncludeSubtitle {
				subtitle := extractMarkdownSubtitle(docContent)
				if subtitle != "" {
					prefixParts = append(prefixParts, subtitle)
				}
			}

			// 构建前缀并添加到内容前
			if len(prefixParts) > 0 {
				prefix := strings.Join(prefixParts, "\n\n") + "\n\n"
				docContent = prefix + docContent
			}
		} else if configErr != nil {
			// 配置获取失败时记录日志，但不影响搜索结果
			logger.SysLogf("获取分块配置失败（不影响搜索）: %v", configErr)
		}
		// 决定文档单元ID（优先 document chunk id）
		var docID int64
		if docChunk != nil && docChunk.ID != 0 {
			docID = docChunk.ID
		} else if rc.KnowledgeChunkID != 0 {
			docID = rc.KnowledgeChunkID
		} else {
			// 回退到 retrieval chunk id 以保证有标识
			docID = rc.ID
		}

		score := float64(vectorResult.Score)

		// 比较并选择分数最高的检索块代表该 document chunk
		existing, exists := bestByDoc[docID]
		if !exists || score > existing.Score {
			res := &SearchResultItem{
				ChunkID:          docID,
				KnowledgeChunkID: docID,
				KnowledgeChunkStatus: func() string {
					if docChunk != nil {
						return docChunk.Status
					}
					return rc.Status
				}(),
				FileID: func() int64 {
					if docChunk != nil && docChunk.FileID != 0 {
						return docChunk.FileID
					}
					return rc.FileID
				}(),
				LibraryID: func() int64 {
					if docChunk != nil && docChunk.LibraryID != 0 {
						return docChunk.LibraryID
					}
					return rc.LibraryID
				}(),
				Content:          docContent,
				RetrievalContent: rc.Content,
				Summary:          "",
				Score:            score,
				VectorScore:      score,
				Highlight:        s.generateHighlight(docContent, query),
				ChunkType: func() string {
					if docChunk != nil && docChunk.ChunkType != "" {
						return docChunk.ChunkType
					}
					return rc.ChunkType
				}(),
			}
			// 填充文件/知识库信息（延后赋值以便统一处理）
			if fileInfo, ok := data.fileInfoMap[res.FileID]; ok {
				res.FileName = fileInfo.FileName
				res.FilePath = fileInfo.FilePath
				res.FileCreatedAt = fileInfo.FileCreatedAt
			}
			if libInfo, ok := data.libraryInfoMap[res.LibraryID]; ok {
				res.LibraryName = libInfo.LibraryName
				res.LibraryIcon = libInfo.LibraryIcon
				res.SpaceID = libInfo.SpaceID
				res.SpaceName = libInfo.SpaceName
			}

			bestByDoc[docID] = res
		}
	}

	// 收集结果（过滤掉文件不存在或已软删的项）
	for _, item := range bestByDoc {
		if fi, ok := data.fileInfoMap[item.FileID]; !ok || fi == nil || fi.IsDeleted {
			logger.SysLogf("❌ 过滤掉已删除或不存在的文件结果: file_id=%d", item.FileID)
			continue
		}
		results = append(results, *item)
	}

	return results
}

// convertToSearchResults 转换为搜索结果
func (s *SearchService) convertToSearchResults(chunks []model.RetrievalChunk, query string, searchType string) ([]SearchResultItem, error) {
	if len(chunks) == 0 {
		return []SearchResultItem{}, nil
	}

	// 收集所有KnowledgeChunkID用于批量查询DocumentChunk
	var knowledgeChunkIDs []int64
	knowledgeChunkIDSet := make(map[int64]bool)
	for _, chunk := range chunks {
		if chunk.KnowledgeChunkID != 0 && !knowledgeChunkIDSet[chunk.KnowledgeChunkID] {
			knowledgeChunkIDs = append(knowledgeChunkIDs, chunk.KnowledgeChunkID)
			knowledgeChunkIDSet[chunk.KnowledgeChunkID] = true
		}
	}

	// 批量查询DocumentChunk
	var documentChunks []model.DocumentChunk
	if len(knowledgeChunkIDs) > 0 {
		var err error
		documentChunks, err = model.BatchGetDocumentChunksByIDs(chunks[0].Eid, knowledgeChunkIDs)
		if err != nil {
			fmt.Printf("批量查询DocumentChunk失败: %v\n", err)
			documentChunks = []model.DocumentChunk{}
		}
	}

	// 创建KnowledgeChunkID到DocumentChunk的映射
	documentChunkMap := make(map[int64]*model.DocumentChunk)
	for i := range documentChunks {
		documentChunkMap[documentChunks[i].ID] = &documentChunks[i]
	}

	// 收集需要查询的文件ID和知识库ID
	var fileIDs []int64
	var libraryIDs []int64
	fileIDSet := make(map[int64]bool)
	libraryIDSet := make(map[int64]bool)

	for _, chunk := range chunks {
		if !fileIDSet[chunk.FileID] {
			fileIDs = append(fileIDs, chunk.FileID)
			fileIDSet[chunk.FileID] = true
		}
		if !libraryIDSet[chunk.LibraryID] {
			libraryIDs = append(libraryIDs, chunk.LibraryID)
			libraryIDSet[chunk.LibraryID] = true
		}
	}

	// 批量查询文件信息和知识库信息
	fileInfoMap, err := s.batchGetFileInfo(chunks[0].Eid, fileIDs)
	if err != nil {
		fmt.Printf("批量查询文件信息失败: %v\n", err)
		fileInfoMap = make(map[int64]*FileInfo) // 使用空映射继续处理
	}

	libraryInfoMap, err := s.batchGetLibraryInfo(chunks[0].Eid, libraryIDs)
	if err != nil {
		fmt.Printf("批量查询知识库信息失败: %v\n", err)
		libraryInfoMap = make(map[int64]*LibraryInfo) // 使用空映射继续处理
	}

	var results []SearchResultItem

	// fulltext 情况也按 document_chunk 聚合去重（保留分数最高的检索块）
	bestByDoc := make(map[int64]*SearchResultItem)
	for _, rc := range chunks {
		// 获取 document chunk
		var docChunk *model.DocumentChunk
		if rc.KnowledgeChunkID != 0 {
			if dc, exists := documentChunkMap[rc.KnowledgeChunkID]; exists {
				docChunk = dc
			}
		}

		docContent := rc.Content
		if docChunk != nil && docChunk.Content != "" {
			docContent = docChunk.Content
		}

		score := s.calculateTextScore(docContent, query)

		// 确定文档单元ID
		var docID int64
		if docChunk != nil && docChunk.ID != 0 {
			docID = docChunk.ID
		} else if rc.KnowledgeChunkID != 0 {
			docID = rc.KnowledgeChunkID
		} else {
			docID = rc.ID
		}

		existing, exists := bestByDoc[docID]
		if !exists || score > existing.Score {
			res := &SearchResultItem{
				ChunkID:          docID,
				KnowledgeChunkID: docID,
				KnowledgeChunkStatus: func() string {
					if docChunk != nil {
						return docChunk.Status
					}
					return rc.Status
				}(),
				FileID: func() int64 {
					if docChunk != nil && docChunk.FileID != 0 {
						return docChunk.FileID
					}
					return rc.FileID
				}(),
				LibraryID: func() int64 {
					if docChunk != nil && docChunk.LibraryID != 0 {
						return docChunk.LibraryID
					}
					return rc.LibraryID
				}(),
				Content:          docContent,
				RetrievalContent: rc.Content,
				Summary:          "",
				Score:            score,
				TextScore:        score,
				Highlight:        s.generateHighlight(docContent, query),
				ChunkType: func() string {
					if docChunk != nil && docChunk.ChunkType != "" {
						return docChunk.ChunkType
					}
					return rc.ChunkType
				}(),
			}

			if fileInfo, ok := fileInfoMap[res.FileID]; ok {
				res.FileName = fileInfo.FileName
				res.FilePath = fileInfo.FilePath
				res.FileCreatedAt = fileInfo.FileCreatedAt
			}
			if libInfo, ok := libraryInfoMap[res.LibraryID]; ok {
				res.LibraryName = libInfo.LibraryName
				res.LibraryIcon = libInfo.LibraryIcon
				res.SpaceID = libInfo.SpaceID
				res.SpaceName = libInfo.SpaceName
			}

			bestByDoc[docID] = res
		}
	}

	// 收集结果（过滤掉文件不存在或已软删的项）
	for _, item := range bestByDoc {
		if fi, ok := fileInfoMap[item.FileID]; !ok || fi == nil || fi.IsDeleted {
			logger.SysLogf("❌ 过滤掉已删除或不存在的文件结果: file_id=%d", item.FileID)
			continue
		}
		results = append(results, *item)
	}

	return results, nil
}

// calculateTextScore 计算文本相关性分数
func (s *SearchService) calculateTextScore(content, query string) float64 {
	// 简单的TF-IDF近似计算
	contentLower := strings.ToLower(content)
	queryLower := strings.ToLower(query)

	// 计算查询词在内容中的出现次数
	count := strings.Count(contentLower, queryLower)
	if count == 0 {
		return 0.0
	}

	// 简单的相关性分数：出现次数 / 内容长度
	score := float64(count) / float64(len(content)) * 1000

	// 限制分数范围
	if score > 1.0 {
		score = 1.0
	}

	return score
}

// generateHighlight 生成高亮文本
func (s *SearchService) generateHighlight(content, query string) string {
	if query == "" {
		return ""
	}

	// 查找查询词在内容中的位置
	queryLower := strings.ToLower(query)
	contentLower := strings.ToLower(content)

	index := strings.Index(contentLower, queryLower)
	if index == -1 {
		return ""
	}

	// 提取高亮片段（前后各50个字符）
	start := index - 50
	if start < 0 {
		start = 0
	}

	end := index + len(query) + 50
	if end > len(content) {
		end = len(content)
	}

	highlight := content[start:end]

	// 添加高亮标记
	highlight = strings.ReplaceAll(highlight, query, "<mark>"+query+"</mark>")

	return highlight
}

// batchGetFileInfo 批量获取文件信息
func (s *SearchService) batchGetFileInfo(eid int64, fileIDs []int64) (map[int64]*FileInfo, error) {
	if len(fileIDs) == 0 {
		return make(map[int64]*FileInfo), nil
	}

	// 去重文件ID
	uniqueFileIDs := make([]int64, 0, len(fileIDs))
	seen := make(map[int64]bool)
	for _, id := range fileIDs {
		if !seen[id] {
			uniqueFileIDs = append(uniqueFileIDs, id)
			seen[id] = true
		}
	}

	// 批量查询文件信息
	var files []model.File
	err := s.db.Where("eid = ? AND id IN ?", eid, uniqueFileIDs).Find(&files).Error
	if err != nil {
		return nil, fmt.Errorf("批量查询文件失败: %v", err)
	}

	// 构建结果（携带软删标记）
	result := make(map[int64]*FileInfo)
	for _, file := range files {
		// 提取文件名
		var fileName string
		if file.Path != "" {
			p := strings.TrimPrefix(file.Path, "/")
			if idx := strings.LastIndex(p, "/"); idx != -1 {
				fileName = p[idx+1:]
			} else {
				fileName = p
			}
		}
		result[file.ID] = &FileInfo{
			FileName:      fileName,
			FilePath:      file.Path,
			FileCreatedAt: file.CreatedTime,
			IsDeleted:     file.IsDeleted,
		}
	}

	// 不为未找到的文件填充占位，后续统一过滤掉

	return result, nil
}

// batchGetLibraryInfo 批量获取知识库信息
func (s *SearchService) batchGetLibraryInfo(eid int64, libraryIDs []int64) (map[int64]*LibraryInfo, error) {
	if len(libraryIDs) == 0 {
		return make(map[int64]*LibraryInfo), nil
	}

	// 去重知识库ID
	uniqueLibraryIDs := make([]int64, 0, len(libraryIDs))
	seen := make(map[int64]bool)
	for _, id := range libraryIDs {
		if !seen[id] {
			uniqueLibraryIDs = append(uniqueLibraryIDs, id)
			seen[id] = true
		}
	}

	// 批量查询知识库信息
	var libraries []model.Library
	err := s.db.Where("eid = ? AND id IN ?", eid, uniqueLibraryIDs).Find(&libraries).Error
	if err != nil {
		return nil, fmt.Errorf("批量查询知识库失败: %v", err)
	}

	spaceIDs := make([]int64, 0, len(libraries))
	for _, library := range libraries {
		spaceIDs = append(spaceIDs, library.SpaceID)
	}
	spaceIDs = uniqueInt64IDsInOrder(spaceIDs)

	spaceNameMap := make(map[int64]string)
	if len(spaceIDs) > 0 {
		var spaces []model.Space
		if err := s.db.Where("eid = ? AND id IN ?", eid, spaceIDs).Find(&spaces).Error; err == nil {
			for i := range spaces {
				spaceNameMap[spaces[i].ID] = spaces[i].Name
			}
		}
	}

	// 构建结果
	result := make(map[int64]*LibraryInfo)
	for _, library := range libraries {
		result[library.ID] = &LibraryInfo{
			LibraryName: library.Name,
			LibraryIcon: library.Icon,
			SpaceID:     library.SpaceID,
			SpaceName:   spaceNameMap[library.SpaceID],
		}
	}

	// 为未找到的知识库添加空信息
	for _, libraryID := range uniqueLibraryIDs {
		if _, exists := result[libraryID]; !exists {
			result[libraryID] = &LibraryInfo{
				LibraryName: "",
				LibraryIcon: "",
				SpaceName:   "",
			}
		}
	}

	return result, nil
}

func (s *SearchService) batchGetLibrariesByIDs(eid int64, libraryIDs []int64) (map[int64]*model.Library, error) {
	if len(libraryIDs) == 0 {
		return make(map[int64]*model.Library), nil
	}

	uniqueLibraryIDs := uniqueInt64IDsInOrder(libraryIDs)
	if len(uniqueLibraryIDs) == 0 {
		return make(map[int64]*model.Library), nil
	}

	libraries, err := model.GetLibrariesByEidCached(eid)
	if err != nil {
		return nil, err
	}

	requested := make(map[int64]struct{}, len(uniqueLibraryIDs))
	for _, libraryID := range uniqueLibraryIDs {
		requested[libraryID] = struct{}{}
	}

	result := make(map[int64]*model.Library, len(uniqueLibraryIDs))
	for i := range libraries {
		if _, ok := requested[libraries[i].ID]; !ok {
			continue
		}
		library := libraries[i]
		result[library.ID] = &library
	}
	return result, nil
}

// saveQueryRecord 保存查询记录
func (s *SearchService) saveQueryRecord(eid int64, userID *int64, req *SearchRequest, totalResults int, searchTimeMs int64) (int64, error) {
	// 确定知识库ID（如果只搜索一个知识库）
	var libraryID *int64
	if len(req.LibraryIDs) == 1 {
		libraryID = &req.LibraryIDs[0]
	}

	// 如果没有用户ID（外部API调用），使用0作为占位符
	var actualUserID int64
	if userID != nil {
		actualUserID = *userID
	} else {
		actualUserID = 0 // 外部API调用时使用0表示系统调用
	}

	// 创建查询记录
	query, err := model.CreateLibraryQuery(
		eid,
		actualUserID,
		libraryID,
		req.Query,
		req.SearchType,
		req.TopK,
		totalResults,
		searchTimeMs,
	)
	if err != nil {
		return 0, err
	}

	return query.ID, nil
}

// multiLibraryVectorSearch 多知识库向量搜索
func (s *SearchService) multiLibraryVectorSearch(eid int64, req *SearchRequest, configService *ChunkConfigService) ([]SearchResultItem, error) {
	multiSearchStart := time.Now()
	logger.SysLogf("🔍 开始多知识库向量搜索 (eid=%d, libraries=%v)", eid, req.LibraryIDs)
	logger.SysDebugf("【向量检索】多库并发参数: eid=%d, query=%q, top_k=%d, libraries=%v, files=%v, chunk_types=%v",
		eid, truncateForDebug(req.Query, 256), req.TopK,
		previewInt64IDsForDebug(req.LibraryIDs, 50), previewInt64IDsForDebug(req.FileIDs, 50), req.ChunkTypes)

	// 检查 singleVectorSearchFn 是否被 mock（测试场景）
	// 如果被 mock，则走原来的流程（不预获取 embedding）
	if !isDefaultSingleVectorSearchFn() {
		// 测试场景：singleVectorSearchFn 被 mock，走原来的流程
		return s.multiLibraryVectorSearchLegacy(eid, req, configService)
	}

	if configService == nil {
		configService = NewChunkConfigService(s.db)
	}

	// 预先获取企业全局配置和 embedding（只调用一次，避免多次调用 embedding API）
	configStart := time.Now()
	config, configErr := configService.GetEnterpriseEmbeddingConfig(eid)
	if configErr != nil {
		logger.SysLogf("❌ 获取企业全局配置失败: eid=%d, err=%v", eid, configErr)
		return nil, fmt.Errorf("获取企业全局配置失败: %v", configErr)
	}
	logger.SysDebugf("【向量检索】获取配置耗时: eid=%d, elapsed_ms=%d", eid, time.Since(configStart).Milliseconds())

	if config.EmbeddingChannelID == nil {
		return nil, fmt.Errorf("未配置向量化渠道")
	}

	// 预先获取 embedding（多库并发搜索时，所有库共用同一个 embedding）
	embeddingStart := time.Now()
	queryVector64, embeddingErr := s.embedding.GetQueryEmbedding(eid, req.Query, *config.EmbeddingChannelID, config)
	if embeddingErr != nil {
		return nil, fmt.Errorf("生成查询向量失败: %v", embeddingErr)
	}
	logger.SysDebugf("【向量检索】获取Embedding耗时: eid=%d, channel_id=%d, elapsed_ms=%d, vector_dim=%d",
		eid, *config.EmbeddingChannelID, time.Since(embeddingStart).Milliseconds(), len(queryVector64))

	// 转换向量格式 (float64 -> float32)
	queryVector := make([]float32, len(queryVector64))
	for i, v := range queryVector64 {
		queryVector[i] = float32(v)
	}

	libraryMap, err := s.batchGetLibrariesByIDs(eid, req.LibraryIDs)
	if err != nil {
		logger.SysLogf("批量获取库信息失败: %v", err)
	}

	// 并发搜索各个知识库，先保留原始向量结果，随后统一富化，避免每个库重复查一轮 DB。
	type libraryResult struct {
		libraryID     int64
		collection    string
		vectorResults []vectorstore.SearchResult
		err           error
		elapsedMs     int64
	}

	resultChan := make(chan libraryResult, len(req.LibraryIDs))
	maxConcurrentSearches := multiLibrarySearchConcurrencyLimit()
	sem := make(chan struct{}, maxConcurrentSearches)
	var recordVectorOnce sync.Once

	// enterprise 模式下所有库共享 doc_eid_{eid} 集合，合并为一次请求
	if GetEnterpriseVectorReadMode(eid) == VectorCollectionModeEnterprise {
		collection := model.GetDocumentVectorCollectionName(eid)
		mergedReq := &SearchRequest{
			Query:                  req.Query,
			SearchType:             req.SearchType,
			TopK:                   req.TopK * len(req.LibraryIDs),
			LibraryIDs:             req.LibraryIDs,
			FileIDs:                req.FileIDs,
			ChunkTypes:             req.ChunkTypes,
			SearchConfig:           normalizeSearchConfigForExecution(req.SearchConfig),
			precomputedQueryVector: queryVector,
			precomputedChunkConfig: config,
			trace:                  req.trace,
		}
		searchReq := vectorstore.SearchRequest{
			Collection: collection,
			Query:      req.Query,
			Vector:     queryVector,
			TopK:       mergedReq.TopK,
			Filters:    s.buildVectorFilter(eid, mergedReq),
		}
		if req.SearchConfig != nil && req.SearchConfig.ScoreThresholdEnabled && req.SearchConfig.ScoreThreshold > 0 {
			searchReq.ScoreThreshold = float32(req.SearchConfig.ScoreThreshold)
		}

		libStart := time.Now()
		searchResp, err := s.vectorDB.Search(context.Background(), searchReq)
		if err != nil {
			for _, libID := range req.LibraryIDs {
				resultChan <- libraryResult{
					libraryID: libID,
					err:       err,
					elapsedMs: time.Since(libStart).Milliseconds(),
				}
			}
		} else {
			recordVectorOnce.Do(func() {
				if req.trace != nil {
					req.trace.add("vector_search_ms", time.Since(multiSearchStart))
				}
			})

			libResults := make(map[int64][]vectorstore.SearchResult)
			for _, result := range searchResp.Results {
				libID := extractLibraryIDFromMetadata(result.Metadata)
				libResults[libID] = append(libResults[libID], vectorstore.SearchResult{
					ID:       result.ID,
					Score:    result.Score,
					Metadata: result.Metadata,
				})
			}
			for _, libID := range req.LibraryIDs {
				results := libResults[libID]
				if results == nil {
					results = []vectorstore.SearchResult{}
				}
				resultChan <- libraryResult{
					libraryID:     libID,
					collection:    collection,
					vectorResults: results,
					elapsedMs:     time.Since(libStart).Milliseconds(),
				}
			}
		}
	} else {
		// 为每个知识库启动独立的搜索
		for _, libraryID := range req.LibraryIDs {
			sem <- struct{}{}
			go func(libID int64) {
				libStart := time.Now()
				defer func() {
					<-sem
				}()

				library, ok := libraryMap[libID]
				if !ok || library == nil {
					resultChan <- libraryResult{
						libraryID: libID,
						err:       fmt.Errorf("知识库不存在或无权限"),
						elapsedMs: time.Since(libStart).Milliseconds(),
					}
					return
				}

				singleReq := &SearchRequest{
					Query:                  req.Query,
					SearchType:             req.SearchType,
					TopK:                   req.TopK,
					LibraryIDs:             []int64{libID},
					FileIDs:                req.FileIDs,
					ChunkTypes:             req.ChunkTypes,
					SearchConfig:           normalizeSearchConfigForExecution(req.SearchConfig),
					precomputedQueryVector: queryVector,
					precomputedChunkConfig: config,
					trace:                  req.trace,
				}

				collection := model.GetVectorCollectionName(library.UUID)
				searchReq := vectorstore.SearchRequest{
					Collection: collection,
					Query:      req.Query,
					Vector:     queryVector,
					TopK:       req.TopK,
					Filters:    s.buildVectorFilter(eid, singleReq),
				}
				if req.SearchConfig != nil && req.SearchConfig.ScoreThresholdEnabled && req.SearchConfig.ScoreThreshold > 0 {
					searchReq.ScoreThreshold = float32(req.SearchConfig.ScoreThreshold)
				}

				searchResp, err := s.vectorDB.Search(context.Background(), searchReq)
				if err != nil {
					resultChan <- libraryResult{
						libraryID:  libID,
						collection: collection,
						err:        err,
						elapsedMs:  time.Since(libStart).Milliseconds(),
					}
					return
				}
				recordVectorOnce.Do(func() {
					if req.trace != nil {
						req.trace.add("vector_search_ms", time.Since(multiSearchStart))
					}
				})

				vectorResults := make([]vectorstore.SearchResult, 0)
				if searchResp != nil {
					vectorResults = make([]vectorstore.SearchResult, len(searchResp.Results))
					for i, result := range searchResp.Results {
						vectorResults[i] = vectorstore.SearchResult{
							ID:       result.ID,
							Score:    result.Score,
							Metadata: result.Metadata,
						}
					}
				}
				resultChan <- libraryResult{
					libraryID:     libID,
					collection:    collection,
					vectorResults: vectorResults,
					elapsedMs:     time.Since(libStart).Milliseconds(),
				}
			}(libraryID)
		}
	}

	// 收集所有结果
	var rawBatches []vectorResultBatch
	var errors []error

	for i := 0; i < len(req.LibraryIDs); i++ {
		result := <-resultChan
		if result.err != nil {
			logger.SysDebugf("❌ 知识库%d搜索失败: %v, 耗时=%dms", result.libraryID, result.err, result.elapsedMs)
			errors = append(errors, fmt.Errorf("知识库%d: %v", result.libraryID, result.err))
		} else {
			logger.SysDebugf("✅ 知识库%d搜索成功，返回%d个原始向量结果, 耗时=%dms", result.libraryID, len(result.vectorResults), result.elapsedMs)
			rawBatches = append(rawBatches, vectorResultBatch{
				Collection: result.collection,
				Results:    result.vectorResults,
			})
		}
	}

	// 如果所有知识库都搜索失败，返回详细错误信息
	if len(errors) == len(req.LibraryIDs) {
		var errorDetails []string
		for _, err := range errors {
			errorDetails = append(errorDetails, err.Error())
		}
		return nil, fmt.Errorf("所有知识库搜索都失败，详细错误: %s", strings.Join(errorDetails, "; "))
	}

	enrichStart := time.Now()
	allResults, err := s.enrichVectorResultBatches(eid, rawBatches, req.Query, configService)
	if req.trace != nil {
		req.trace.add("enrich_ms", time.Since(enrichStart))
	}
	if err != nil {
		return nil, err
	}

	// 合并和排序结果
	results := s.mergeMultiLibraryResults(allResults, req.TopK)

	// 应用score_threshold过滤（额外保障）
	if req.SearchConfig != nil && req.SearchConfig.ScoreThresholdEnabled && req.SearchConfig.ScoreThreshold > 0 {
		var thresholdFilteredResults []SearchResultItem
		for _, result := range results {
			if result.Score >= req.SearchConfig.ScoreThreshold {
				thresholdFilteredResults = append(thresholdFilteredResults, result)
			}
		}
		results = thresholdFilteredResults
	}

	logger.SysDebugf("【向量检索】多库并发完成: eid=%d, libraries=%d, final_count=%d, total_ms=%d",
		eid, len(req.LibraryIDs), len(results), time.Since(multiSearchStart).Milliseconds())
	logger.SysDebugf("【向量检索】多库并发完成: eid=%d, query=%q, final_count=%d, sample=%v",
		eid, truncateForDebug(req.Query, 256), len(results), previewSearchResultsForDebug(results, 5))

	return results, nil
}

// multiLibraryVectorSearchLegacy 原来的多库搜索流程（用于测试 mock 场景）
func (s *SearchService) multiLibraryVectorSearchLegacy(eid int64, req *SearchRequest, configService *ChunkConfigService) ([]SearchResultItem, error) {
	logger.SysDebugf("🔍 开始多知识库向量搜索-Legacy (eid=%d, libraries=%v)", eid, req.LibraryIDs)

	// 并发搜索各个知识库
	type libraryResult struct {
		libraryID int64
		results   []SearchResultItem
		err       error
	}

	resultChan := make(chan libraryResult, len(req.LibraryIDs))
	maxConcurrentSearches := multiLibrarySearchConcurrencyLimit()
	sem := make(chan struct{}, maxConcurrentSearches)

	// 为每个知识库启动独立的搜索
	for _, libraryID := range req.LibraryIDs {
		sem <- struct{}{}
		go func(libID int64) {
			defer func() {
				<-sem
			}()

			// 创建单知识库搜索请求
			singleReq := &SearchRequest{
				Query:        req.Query,
				SearchType:   req.SearchType,
				TopK:         req.TopK,
				LibraryIDs:   []int64{libID},
				FileIDs:      req.FileIDs,
				ChunkTypes:   req.ChunkTypes,
				SearchConfig: normalizeSearchConfigForExecution(req.SearchConfig),
				trace:        req.trace,
			}

			results, err := singleVectorSearchFn(s, eid, singleReq, configService)
			resultChan <- libraryResult{
				libraryID: libID,
				results:   results,
				err:       err,
			}
		}(libraryID)
	}

	// 收集所有结果
	var allResults []SearchResultItem
	var errors []error

	for i := 0; i < len(req.LibraryIDs); i++ {
		result := <-resultChan
		if result.err != nil {
			logger.SysLogf("❌ 知识库%d搜索失败: %v", result.libraryID, result.err)
			errors = append(errors, fmt.Errorf("知识库%d: %v", result.libraryID, result.err))
		} else {
			logger.SysLogf("✅ 知识库%d搜索成功，返回%d个结果", result.libraryID, len(result.results))
			allResults = append(allResults, result.results...)
		}
	}

	// 如果所有知识库都搜索失败，返回详细错误信息
	if len(errors) == len(req.LibraryIDs) {
		var errorDetails []string
		for _, err := range errors {
			errorDetails = append(errorDetails, err.Error())
		}
		return nil, fmt.Errorf("所有知识库搜索都失败，详细错误: %s", strings.Join(errorDetails, "; "))
	}

	// 合并和排序结果
	results := s.mergeMultiLibraryResults(allResults, req.TopK)

	// 应用score_threshold过滤（额外保障）
	if req.SearchConfig != nil && req.SearchConfig.ScoreThresholdEnabled && req.SearchConfig.ScoreThreshold > 0 {
		var thresholdFilteredResults []SearchResultItem
		for _, result := range results {
			if result.Score >= req.SearchConfig.ScoreThreshold {
				thresholdFilteredResults = append(thresholdFilteredResults, result)
			}
		}
		results = thresholdFilteredResults
	}

	return results, nil
}

// mergeMultiLibraryResults 合并多知识库搜索结果
func (s *SearchService) mergeMultiLibraryResults(allResults []SearchResultItem, topK int) []SearchResultItem {
	// 按分数排序所有结果
	sort.Slice(allResults, func(i, j int) bool {
		return allResults[i].Score > allResults[j].Score
	})

	// 限制结果数量
	if len(allResults) > topK {
		allResults = allResults[:topK]
	}

	logger.SysLogf("🔗 多知识库结果合并完成，最终返回%d个结果", len(allResults))
	return allResults
}

// filterLibraryIDsByPermission 根据用户权限过滤libraryID
func (s *SearchService) filterLibraryIDsByPermission(eid int64, libraryIDs []int64, userID int64) ([]int64, error) {
	if len(libraryIDs) == 0 {
		return libraryIDs, nil
	}

	permissions, err := common.BatchGetUserPermissions(eid, model.RESOURCE_TYPE_LIBRARY, libraryIDs, userID)
	if err != nil {
		logger.SysLogf("批量获取知识库权限失败，回退单条查询: userID=%d, err=%v", userID, err)
		return s.filterLibraryIDsByPermissionFallback(eid, libraryIDs, userID)
	}

	var filteredLibraryIDs []int64
	for _, libraryID := range uniqueSearchInt64IDs(libraryIDs) {
		permission := permissions[libraryID]
		if permission >= model.PERMISSION_VIEW_ONLY {
			filteredLibraryIDs = append(filteredLibraryIDs, libraryID)
		} else {
			logger.SysLogf("用户无知识库权限，已过滤 libraryID=%d, userID=%d, permission=%d", libraryID, userID, permission)
		}
	}

	return filteredLibraryIDs, nil
}

// filterFileIDsByPermission 根据用户权限过滤fileID
func (s *SearchService) filterFileIDsByPermission(eid int64, fileIDs []int64, userID int64) ([]int64, error) {
	if len(fileIDs) == 0 {
		return fileIDs, nil
	}

	permissions, err := common.BatchGetUserPermissions(eid, model.RESOURCE_TYPE_FILE, fileIDs, userID)
	if err != nil {
		logger.SysLogf("批量获取文件权限失败，回退单条查询: userID=%d, err=%v", userID, err)
		return s.filterFileIDsByPermissionFallback(eid, fileIDs, userID)
	}

	var filteredFileIDs []int64
	for _, fileID := range uniqueSearchInt64IDs(fileIDs) {
		permission := permissions[fileID]
		if permission >= model.PERMISSION_VIEW_ONLY {
			filteredFileIDs = append(filteredFileIDs, fileID)
		} else {
			logger.SysLogf("用户无文件权限，已过滤 fileID=%d, userID=%d, permission=%d", fileID, userID, permission)
		}
	}

	return filteredFileIDs, nil
}

// filterResultsByFilePermission 根据用户权限过滤搜索结果中的文件
func (s *SearchService) filterResultsByFilePermission(eid int64, results []SearchResultItem, userID int64) ([]SearchResultItem, error) {
	if len(results) == 0 {
		return results, nil
	}

	fileIDs := make([]int64, 0, len(results))
	for _, result := range results {
		if result.FileID > 0 {
			fileIDs = append(fileIDs, result.FileID)
		}
	}

	permissions, err := common.BatchGetUserPermissions(eid, model.RESOURCE_TYPE_FILE, fileIDs, userID)
	if err != nil {
		logger.SysLogf("批量获取搜索结果文件权限失败，回退单条查询: userID=%d, err=%v", userID, err)
		return s.filterResultsByFilePermissionFallback(eid, results, userID)
	}

	return filterSearchResultsByFilePermissionMap(results, permissions, userID), nil
}

func (s *SearchService) filterBatchResultsByFilePermission(eid int64, batchResults []BatchSearchResult, userID int64) []BatchSearchResult {
	filterStart := time.Now()
	fileIDs := make([]int64, 0)
	beforeCount := 0
	for _, batchResult := range batchResults {
		if batchResult.Error != nil {
			continue
		}
		beforeCount += len(batchResult.Results)
		for _, result := range batchResult.Results {
			if result.FileID > 0 {
				fileIDs = append(fileIDs, result.FileID)
			}
		}
	}
	fileIDs = uniqueSearchInt64IDs(fileIDs)
	if len(fileIDs) == 0 {
		emptyPermissions := map[int64]int{}
		for i := range batchResults {
			if batchResults[i].Error == nil {
				batchResults[i].Results = filterSearchResultsByFilePermissionMap(batchResults[i].Results, emptyPermissions, userID)
			}
		}
		logger.SysDebugf("【权限过滤】批量搜索文件权限完成: eid=%d, userID=%d, query_count=%d, unique_file_count=0, before=%d, after=0, elapsed_ms=%d",
			eid, userID, len(batchResults), beforeCount, time.Since(filterStart).Milliseconds())
		return batchResults
	}

	permissions, err := common.BatchGetUserPermissions(eid, model.RESOURCE_TYPE_FILE, fileIDs, userID)
	if err != nil {
		logger.SysLogf("批量获取批量搜索文件权限失败，回退单条查询: userID=%d, file_count=%d, err=%v", userID, len(fileIDs), err)
		for i := range batchResults {
			if batchResults[i].Error != nil {
				continue
			}
			filtered, filterErr := s.filterResultsByFilePermissionFallback(eid, batchResults[i].Results, userID)
			if filterErr != nil {
				batchResults[i].Error = fmt.Errorf("过滤文件权限失败: %v", filterErr)
				batchResults[i].Results = nil
				continue
			}
			batchResults[i].Results = filtered
		}
		return batchResults
	}

	for i := range batchResults {
		if batchResults[i].Error != nil {
			continue
		}
		batchResults[i].Results = filterSearchResultsByFilePermissionMap(batchResults[i].Results, permissions, userID)
	}
	afterCount := 0
	for _, batchResult := range batchResults {
		if batchResult.Error == nil {
			afterCount += len(batchResult.Results)
		}
	}
	logger.SysDebugf("【权限过滤】批量搜索文件权限完成: eid=%d, userID=%d, query_count=%d, unique_file_count=%d, before=%d, after=%d, elapsed_ms=%d",
		eid, userID, len(batchResults), len(fileIDs), beforeCount, afterCount, time.Since(filterStart).Milliseconds())
	return batchResults
}

func filterSearchResultsByFilePermissionMap(results []SearchResultItem, permissions map[int64]int, userID int64) []SearchResultItem {
	filteredResults := make([]SearchResultItem, 0, len(results))
	for _, result := range results {
		permission := permissions[result.FileID]
		// 只有具有查看权限及以上权限才能查看结果
		if permission >= model.PERMISSION_VIEW_ONLY {
			filteredResults = append(filteredResults, result)
		} else {
			logger.SysLogf("用户无文件权限，已过滤 fileID=%d, userID=%d, permission=%d", result.FileID, userID, permission)
		}
	}

	return filteredResults
}

// updateChunkRecallCounts 更新召回次数统计
func (s *SearchService) updateChunkRecallCounts(eid int64, results []SearchResultItem) error {
	if len(results) == 0 {
		return nil
	}

	// 提取所有的 ChunkID（去重）
	chunkIDMap := make(map[int64]bool)
	var chunkIDs []int64
	for _, result := range results {
		if result.ChunkID != 0 && !chunkIDMap[result.ChunkID] {
			chunkIDs = append(chunkIDs, result.ChunkID)
			chunkIDMap[result.ChunkID] = true
		}
	}

	if len(chunkIDs) == 0 {
		return nil
	}

	// 批量更新召回次数
	return model.IncrementRecallCount(eid, chunkIDs)
}

// getUserPermission 获取用户权限的辅助函数，实现与service层一致的权限检查逻辑
func getUserPermission(eid int64, resourceType int, resourceID int64, userID int64) (int, error) {
	return common.GetUserPermission(eid, resourceType, resourceID, userID)
}

func (s *SearchService) filterLibraryIDsByPermissionFallback(eid int64, libraryIDs []int64, userID int64) ([]int64, error) {
	var filteredLibraryIDs []int64
	for _, libraryID := range uniqueSearchInt64IDs(libraryIDs) {
		permission, err := getUserPermission(eid, model.RESOURCE_TYPE_LIBRARY, libraryID, userID)
		if err != nil {
			logger.SysLogf("获取知识库权限失败 libraryID=%d, userID=%d: %v", libraryID, userID, err)
			continue
		}
		if permission >= model.PERMISSION_VIEW_ONLY {
			filteredLibraryIDs = append(filteredLibraryIDs, libraryID)
		} else {
			logger.SysLogf("用户无知识库权限，已过滤 libraryID=%d, userID=%d, permission=%d", libraryID, userID, permission)
		}
	}
	return filteredLibraryIDs, nil
}

func (s *SearchService) filterFileIDsByPermissionFallback(eid int64, fileIDs []int64, userID int64) ([]int64, error) {
	var filteredFileIDs []int64
	for _, fileID := range uniqueSearchInt64IDs(fileIDs) {
		permission, err := getUserPermission(eid, model.RESOURCE_TYPE_FILE, fileID, userID)
		if err != nil {
			logger.SysLogf("获取文件权限失败 fileID=%d, userID=%d: %v", fileID, userID, err)
			continue
		}
		if permission >= model.PERMISSION_VIEW_ONLY {
			filteredFileIDs = append(filteredFileIDs, fileID)
		} else {
			logger.SysLogf("用户无文件权限，已过滤 fileID=%d, userID=%d, permission=%d", fileID, userID, permission)
		}
	}
	return filteredFileIDs, nil
}

func (s *SearchService) filterResultsByFilePermissionFallback(eid int64, results []SearchResultItem, userID int64) ([]SearchResultItem, error) {
	permissionCache := make(map[int64]int)
	var filteredResults []SearchResultItem
	for _, result := range results {
		var permission int
		if cachedPermission, exists := permissionCache[result.FileID]; exists {
			permission = cachedPermission
		} else {
			var err error
			permission, err = getUserPermission(eid, model.RESOURCE_TYPE_FILE, result.FileID, userID)
			if err != nil {
				logger.SysLogf("获取文件权限失败 fileID=%d, userID=%d: %v", result.FileID, userID, err)
				continue
			}
			permissionCache[result.FileID] = permission
		}
		if permission >= model.PERMISSION_VIEW_ONLY {
			filteredResults = append(filteredResults, result)
		} else {
			logger.SysLogf("用户无文件权限，已过滤 fileID=%d, userID=%d, permission=%d", result.FileID, userID, permission)
		}
	}
	return filteredResults, nil
}

func uniqueSearchInt64IDs(ids []int64) []int64 {
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

func isRegisteredUserInEID(user *model.User, eid int64) bool {
	return user != nil && user.Eid == eid && user.Type == model.UserTypeRegistered
}

// getSpacePermission 获取空间权限，包含空间角色检查
// 复制自service.SpacePermissionService.GetUserPermissionForSpace
func getSpacePermission(eid int64, spaceID int64, userID int64) (int, error) {
	// 获取用户对该空间的所有权限记录
	permissions, err := model.GetResourcePermissions(eid, model.RESOURCE_TYPE_SPACE, spaceID)
	if err != nil {
		return 0, err
	}
	user, err := model.GetUserByID(userID)
	if user == nil || err != nil || user.Eid != eid {
		logger.SysLogf("【空间】无法加载用户 %d", userID)
		return 0, err
	}
	if isRegisteredUserInEID(user, eid) {
		return model.PERMISSION_NONE, nil
	}
	userGroupIDs, _ := user.GetUserGroupIds()

	var maxCompanyPermission *int
	var maxGroupPermission *int
	for _, perm := range permissions {
		// 成员权限第一
		if perm.SubjectType == model.SUBJECT_TYPE_USER && perm.SubjectID == userID {
			logger.SysLogf("用户 %d 对空间 %d 的权限为成员权限 %d", userID, spaceID, perm.Permission)
			return perm.Permission, nil
		}

		// 判断分组权限
		if len(userGroupIDs) > 0 && perm.SubjectType == model.SUBJECT_TYPE_GROUP &&
			helper.Int64InArray(perm.SubjectID, userGroupIDs) {
			if maxGroupPermission == nil || perm.Permission > *maxGroupPermission {
				maxGroupPermission = &perm.Permission
			}
		}

		// 判断全公司权限
		if perm.SubjectType == model.SUBJECT_TYPE_COMPANY_ALL {
			if maxCompanyPermission == nil || perm.Permission > *maxCompanyPermission {
				maxCompanyPermission = &perm.Permission
			}
		}
	}

	if maxGroupPermission != nil {
		logger.SysLogf("用户 %d 对空间 %d 的权限为分组权限 %d", userID, spaceID, *maxGroupPermission)
		return *maxGroupPermission, nil
	}

	if maxCompanyPermission != nil {
		logger.SysLogf("用户 %d 对空间 %d 的权限为全公司权限 %d", userID, spaceID, *maxCompanyPermission)
		return *maxCompanyPermission, nil
	}

	return model.PERMISSION_NONE, nil
}

// getLibraryPermission 获取知识库权限
// 复制自service.LibraryPermissionService.GetUserLibraryPermission
func getLibraryPermission(eid int64, libraryID int64, userID int64) (int, error) {
	// 先加载库，拿到 SpaceID
	library, err := model.GetLibraryByID(eid, libraryID)
	if err != nil || library == nil {
		logger.SysLogf("【知识库】无法加载知识库 %d", libraryID)
		return 0, err
	}

	user, err := model.GetUserByID(userID)
	if user == nil || err != nil || user.Eid != eid {
		logger.SysLogf("【知识库】无法加载用户 %d", userID)
		return 0, err
	}
	if isRegisteredUserInEID(user, eid) {
		return model.PERMISSION_NONE, nil
	}
	userGroupIDs, _ := user.GetUserGroupIds()

	// 步骤1：获取知识库的所有权限记录
	allLibraryPermissions, err := model.GetResourcePermissions(eid, model.RESOURCE_TYPE_LIBRARY, libraryID)
	if err != nil {
		logger.SysLogf("【知识库】无法加载知识库 %d 的权限", libraryID)
		return 0, err
	}

	var maxGroupPermission *int
	var companyPermission *int

	// 判断 allLibraryPermissions 中是否有自己的记录，如果有并且是MANAGE，那么直接返回
	for _, perm := range allLibraryPermissions {
		// 就近原则，人是最近的
		if perm.SubjectType == model.SUBJECT_TYPE_USER && perm.SubjectID == userID {
			logger.SysLogf("【知识库】直接指定用户权限 %d", perm.Permission)
			return perm.Permission, nil
		}
		// 判断分组
		if len(userGroupIDs) > 0 && perm.SubjectType == model.SUBJECT_TYPE_GROUP &&
			helper.Int64InArray(perm.SubjectID, userGroupIDs) {
			if maxGroupPermission == nil || perm.Permission > *maxGroupPermission {
				maxGroupPermission = &perm.Permission
			}
		}
		// 判断全公司
		if perm.SubjectType == model.SUBJECT_TYPE_COMPANY_ALL {
			companyPermission = &perm.Permission
		}
	}

	if maxGroupPermission != nil {
		logger.SysLogf("【知识库】搜到指定分组最大权限 %d", *maxGroupPermission)
		return *maxGroupPermission, nil
	} else if companyPermission != nil {
		logger.SysLogf("【知识库】搜到全公司最大权限 %d", *companyPermission)
		return *companyPermission, nil
	}

	// 步骤2：检查是否存在空间角色权限记录
	hasSpaceAdminRecord := false // false 默认继承
	hasSpaceUserRecord := false  // false 默认继承
	spaceAdminPermission := model.PERMISSION_MANAGE
	SpaceUserRole := model.PERMISSION_NONE
	for _, perm := range allLibraryPermissions {
		if perm.SubjectType == model.SUBJECT_TYPE_SPACE_ADMIN {
			hasSpaceAdminRecord = true
			spaceAdminPermission = perm.Permission
		}
		if perm.SubjectType == model.SUBJECT_TYPE_SPACE_USER {
			hasSpaceUserRecord = true
			SpaceUserRole = perm.Permission
		}
	}

	isAdmin, isMember, spacePermission := getUserSpaceRoles(eid, userID, library.SpaceID)

	if isAdmin && !hasSpaceAdminRecord {
		// 空间管理员势必继承空间管理权限也就继承了知识库权限
		logger.SysLogf("空间管理员 %d 继承知识库 %d 的权限 %d", userID, libraryID, model.PERMISSION_MANAGE)
		return spacePermission, nil
	} else if isAdmin && hasSpaceAdminRecord {
		// 空间管理员继承空间管理员权限，无需额外判断
		logger.SysLogf("空间管理员 %d 继承知识库 %d 的权限 %d", userID, libraryID, model.PERMISSION_MANAGE)
		return spaceAdminPermission, nil
	}

	if isMember && !hasSpaceUserRecord {
		// 空间成员继承空间成员权限, 需要查询该成员在空间是什么权限
		logger.SysLogf("空间成员 %d 继承知识库 %d 的权限 %d", userID, libraryID, SpaceUserRole)
		// 添加一个虚拟权限用于后续判断最大值
		return spacePermission, nil
	} else if isMember && hasSpaceUserRecord {
		// 空间成员继承空间管理员权限，无需额外判断
		logger.SysLogf("空间成员 %d 继承知识库 %d 的权限 %d", userID, libraryID, spaceAdminPermission)
		return SpaceUserRole, nil
	}

	logger.SysLogf("用户没有找到最近的权限 user %d, library %d, permission %d", userID, libraryID, model.PERMISSION_NONE)
	return model.PERMISSION_NONE, nil
}

// getFilePermission 获取文件权限
// 复制自service.FilePermissionService.GetUserFilePermission
func getFilePermission(eid int64, fileID int64, userID int64) (int, error) {
	// file
	// 查出文件和文件的父ID
	user, err := model.GetUserByID(userID)
	if user == nil || err != nil || user.Eid != eid {
		logger.SysLogf("【知识库】无法加载用户 %d", userID)
		return 0, err
	}
	if isRegisteredUserInEID(user, eid) {
		return model.PERMISSION_NONE, nil
	}
	userGroupIDs, _ := user.GetUserGroupIds()

	file, fileList, err := model.GetFileWithParentsByID(eid, fileID)
	if err != nil {
		logger.SysLogf("无法获取文件[%d]的信息, err=%v", fileID, err)
		return 0, err
	}

	fileIDs := []int64{}
	for _, f := range fileList {
		fileIDs = append(fileIDs, f.ID)
	}

	// 第一层:查看文件直接设置的权限
	allFilePermissions, err := model.GetResourcesPermissions(eid, model.RESOURCE_TYPE_FILE, fileIDs)
	if err != nil || len(allFilePermissions) == 0 {
		logger.SysLogf("无法获取文件[%d]的权限信息, 继承知识库权限 err=%v, len=%d", fileID, err, len(allFilePermissions))
		// 继承知识库权限
		return getLibraryPermission(eid, file.LibraryID, userID)
	}

	var bestPermission *int // 最佳权限
	var bestLevel *int      // 最佳权限所在层级，数值越小越近（0=当前文件）
	var bestPriority int    // 权限优先级：用户>组>LIBRARY_USER>公司

	for index, f := range fileList {
		var currentUserPermission *int
		var currentGroupPermission *int
		var currentLibraryUserPermission *int
		var currentCompanyPermission *int

		logger.SysLogf("开始检查第【%d】层文件[%s]的权限", index, f.Path)

		for _, perm := range allFilePermissions {
			if perm.ResourceID != f.ID {
				continue
			}

			// 收集当前层级的各类权限
			if perm.SubjectType == model.SUBJECT_TYPE_USER && perm.SubjectID == userID && currentUserPermission == nil {
				currentUserPermission = &perm.Permission
			} else if len(userGroupIDs) > 0 && perm.SubjectType == model.SUBJECT_TYPE_GROUP &&
				helper.Int64InArray(perm.SubjectID, userGroupIDs) {
				if currentGroupPermission == nil || perm.Permission > *currentGroupPermission {
					currentGroupPermission = &perm.Permission
				}
			} else if perm.SubjectType == model.SUBJECT_TYPE_LIBRARY_USER && currentLibraryUserPermission == nil {
				currentLibraryUserPermission = &perm.Permission
			} else if perm.SubjectType == model.SUBJECT_TYPE_COMPANY_ALL && currentCompanyPermission == nil {
				currentCompanyPermission = &perm.Permission
			}
		}

		// 按优先级检查当前层级的权限，并应用就近原则
		if currentUserPermission != nil {
			if bestPermission == nil || (bestLevel != nil && index < *bestLevel) || (bestLevel != nil && index == *bestLevel && 1 > bestPriority) {
				bestPermission = currentUserPermission
				bestLevel = &index
				bestPriority = 1
				logger.SysLogf("第%d层找到更优的用户权限 %d", index, *currentUserPermission)
			}
		} else if currentGroupPermission != nil {
			if bestPermission == nil || (bestLevel != nil && index < *bestLevel) || (bestLevel != nil && index == *bestLevel && 2 > bestPriority) {
				bestPermission = currentGroupPermission
				bestLevel = &index
				bestPriority = 2
				logger.SysLogf("第%d层找到更优的组权限 %d", index, *currentGroupPermission)
			}
		} else if currentLibraryUserPermission != nil {
			if bestPermission == nil || (bestLevel != nil && index < *bestLevel) || (bestLevel != nil && index == *bestLevel && 3 > bestPriority) {
				bestPermission = currentLibraryUserPermission
				bestLevel = &index
				bestPriority = 3
				logger.SysLogf("第%d层找到更优的LIBRARY_USER权限 %d", index, *currentLibraryUserPermission)
			}
		} else if currentCompanyPermission != nil {
			if bestPermission == nil || (bestLevel != nil && index < *bestLevel) || (bestLevel != nil && index == *bestLevel && 4 > bestPriority) {
				bestPermission = currentCompanyPermission
				bestLevel = &index
				bestPriority = 4
				logger.SysLogf("第%d层找到更优的公司权限 %d", index, *currentCompanyPermission)
			}
		}
	}

	// 如果找到文件层级的权限，直接返回
	if bestPermission != nil {
		logger.SysLogf("返回最优权限 %d（层级：%d，优先级：%d）", *bestPermission, *bestLevel, bestPriority)
		return *bestPermission, nil
	}

	// 如果没有找到文件层级的权限，使用知识库权限
	librayPermission, err := getLibraryPermission(eid, file.LibraryID, userID)
	if err != nil {
		librayPermission = model.PERMISSION_NONE
	}
	if librayPermission <= model.PERMISSION_PUBLIC_ONLY {
		librayPermission = model.PERMISSION_NONE // 仅公开其实只在空间生效，在下层级的这两个对象其实都是无权限
	}

	return librayPermission, nil
}

// getUserSpaceRoles 获取用户空间角色信息
// 复制自service.SpacePermissionService.GetUserSpaceRoles
func getUserSpaceRoles(eid int64, userID int64, spaceID int64) (bool, bool, int) {
	spacePermission, err := getSpacePermission(eid, spaceID, userID)
	if err != nil {
		spacePermission = 0
	}
	isAdmin := spacePermission == model.PERMISSION_MANAGE
	isMember := spacePermission >= model.PERMISSION_VIEW_ONLY

	return isAdmin, isMember, spacePermission
}

// extractDocumentTitleFromRetrievalChunk 从检索块对应的文档中提取标题
// 这个方法复用 RetrievalChunkService 中的标题提取逻辑
func (s *SearchService) extractDocumentTitleFromRetrievalChunk(eid int64, rc *model.RetrievalChunk) string {
	// 尝试从文件内容中提取第一个大标题
	fileBody, err := model.GetLastFileBodyByFileID(eid, rc.FileID)
	if err != nil || fileBody == nil {
		// 如果获取文件内容失败，返回空字符串
		return ""
	}
	content, err := fileBody.GetContent()
	if err != nil {
		return ""
	}

	// 从文件内容中提取第一个大标题
	title := s.extractFirstHeaderFromContent(content)
	if title != "" {
		return title
	}

	// 如果没有找到标题，返回空字符串
	return ""
}

// extractFirstHeaderFromContent 从文档内容中提取第一个大标题
// 这个方法复用 RetrievalChunkService 中的实现
func (s *SearchService) extractFirstHeaderFromContent(content string) string {
	if content == "" {
		return ""
	}

	lines := strings.Split(content, "\n")

	// 遍历每一行，寻找第一个标题
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		// 检查是否是 Markdown 标题格式 (# ## ### 等)
		if strings.HasPrefix(line, "#") {
			// 计算标题级别
			level := 0
			for _, char := range line {
				if char == '#' {
					level++
				} else {
					break
				}
			}

			// 提取标题文本（去掉 # 号和前后空格）
			titleText := strings.TrimSpace(line[level:])
			if titleText != "" {
				return titleText
			}
		}

		// 检查是否是其他常见的大标题格式
		// 例如：全大写、加粗、下划线等
		if s.isLikelyTitle(line) {
			return line
		}

		// 如果遇到非空行且不是标题，可能正文开始了，停止搜索
		// 但我们可以继续搜索几行，以防标题格式不标准
		// 这里简化处理，继续搜索
	}

	return ""
}

// isLikelyTitle 判断一行文字是否可能是标题
// 这个方法复用 RetrievalChunkService 中的实现
func (s *SearchService) isLikelyTitle(line string) bool {
	if len(line) == 0 {
		return false
	}

	// 去除前后空格
	line = strings.TrimSpace(line)

	// 检查长度，标题通常不会太长也不会太短
	if len(line) > 100 || len(line) < 3 {
		return false
	}

	// 检查是否全大写（英文）
	if line == strings.ToUpper(line) && s.containsEnglish(line) {
		return true
	}

	// 检查是否包含常见的标题关键词
	titleKeywords := []string{
		"第", "章", "节", "部分", "概述", "介绍", "总结", "结论",
		"Chapter", "Section", "Part", "Overview", "Introduction", "Summary", "Conclusion",
	}

	for _, keyword := range titleKeywords {
		if strings.Contains(line, keyword) {
			return true
		}
	}

	// 检查是否是加粗格式（**标题**）
	if strings.HasPrefix(line, "**") && strings.HasSuffix(line, "**") {
		title := strings.TrimSpace(line[2 : len(line)-2])
		return title != ""
	}

	return false
}

// containsEnglish 检查字符串是否包含英文字符
// 这个方法复用 RetrievalChunkService 中的实现
func (s *SearchService) containsEnglish(text string) bool {
	for _, r := range text {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') {
			return true
		}
	}
	return false
}

// extractFileNameFromPath 从文件路径中提取文件名（不带后缀）
// 这个方法复用 RetrievalChunkService 中的实现
func (s *SearchService) extractFileNameFromPath(filePath string) string {
	if filePath == "" {
		return ""
	}

	// 使用 path.Base 获取文件名（包含后缀）
	fileNameWithExt := strings.TrimPrefix(filePath, "/")
	lastSlash := strings.LastIndex(fileNameWithExt, "/")
	if lastSlash >= 0 {
		fileNameWithExt = fileNameWithExt[lastSlash+1:]
	}

	// 去掉文件后缀
	lastDot := strings.LastIndex(fileNameWithExt, ".")
	if lastDot > 0 {
		fileName := fileNameWithExt[:lastDot]
		return fileName
	}

	return fileNameWithExt
}

// filterDeletedFiles 过滤已删除的文件和已删除的知识库
func (s *SearchService) filterDeletedFiles(results []SearchResultItem) []SearchResultItem {
	if len(results) == 0 {
		return results
	}

	// 收集所有需要检查的文件ID和知识库ID
	fileIDs := make([]int64, 0, len(results))
	libraryIDs := make([]int64, 0, len(results))

	for _, result := range results {
		if result.FileID != 0 {
			fileIDs = append(fileIDs, result.FileID)
		}
		if result.LibraryID != 0 {
			libraryIDs = append(libraryIDs, result.LibraryID)
		}
	}

	// 创建已删除资源ID的集合
	deletedFileIDs := make(map[int64]bool)
	deletedLibraryIDs := make(map[int64]bool)

	// 批量查询所有被删除的文件
	if len(fileIDs) > 0 {
		var deletedFiles []model.File
		err := s.db.Where("id IN ? AND is_deleted = ?", fileIDs, true).Find(&deletedFiles).Error
		if err != nil {
			logger.SysLogf("批量查询已删除文件时出错: %v", err)
			// 出错时继续处理知识库
		} else {
			for _, file := range deletedFiles {
				deletedFileIDs[file.ID] = true
				logger.SysLogf("标记已删除的文件: file_id=%d", file.ID)
			}
		}
	}

	// 批量查询所有被删除的知识库
	// if len(libraryIDs) > 0 {
	// 	var deletedLibraries []model.Library
	// 	err := s.db.Where("id IN ?", libraryIDs).Find(&deletedLibraries).Error
	// 	if err != nil {
	// 		logger.SysLogf("批量查询已删除知识库时出错: %v", err)
	// 		// 出错时继续处理
	// 	} else {
	// 		for _, library := range deletedLibraries {
	// 			deletedLibraryIDs[library.ID] = true
	// 			logger.SysLogf("标记已删除的知识库: library_id=%d", library.ID)
	// 		}
	// 	}
	// }

	// 过滤结果
	var filteredResults []SearchResultItem
	for _, result := range results {
		// 如果文件或知识库被删除，则过滤掉该结果
		if (result.FileID != 0 && deletedFileIDs[result.FileID]) ||
			(result.LibraryID != 0 && deletedLibraryIDs[result.LibraryID]) {
			logger.SysLogf("过滤掉已删除的搜索结果: file_id=%d, library_id=%d", result.FileID, result.LibraryID)
			continue
		}
		// 文件和知识库都未被删除，保留结果
		filteredResults = append(filteredResults, result)
	}

	return filteredResults
}
