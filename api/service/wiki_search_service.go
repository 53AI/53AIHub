package service

import (
	"context"
	"fmt"
	"strings"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/rag"
	"github.com/53AI/53AIHub/service/vectorstore"
	"gorm.io/gorm"
)

type WikiSearchRequest struct {
	Eid         int64
	UserID      int64
	Query       string
	SpaceIDs    []int64
	LibraryIDs  []int64
	WikiPageIDs []int64
	TopK        int
}

type WikiSearchResult struct {
	PageID      int64
	SpaceID     int64
	LibraryID   int64
	ChunkDBID   int64
	Title       string
	Summary     string
	Body        string
	Content     string
	ChunkID     string
	HeadingPath string
	ChunkType   string
	Slug        string
	PageType    string
	CreatedTime int64
	Score       float64
	LibraryName string
	LibraryIcon string
	SpaceName   string
}

type WikiSearchService struct {
	db        *gorm.DB
	vectorDB  WikiVectorSearcher
	embedding WikiQueryEmbedder
}

type WikiQueryEmbedder interface {
	GetQueryEmbedding(eid int64, query string, channelID int64, config *rag.ChunkConfig) ([]float64, error)
}

type wikiCollectionInfoReader interface {
	GetCollectionInfo(context.Context, string) (*vectorstore.CollectionInfo, error)
}

type WikiVectorSearcher interface {
	Search(ctx context.Context, req vectorstore.SearchRequest) (*vectorstore.SearchResponse, error)
}

var batchGetWikiPermissions = common.BatchGetUserPermissions

func NewWikiSearchService(db *gorm.DB) *WikiSearchService {
	store, _ := vectorstore.GetGlobalVectorStore()
	return &WikiSearchService{db: db, vectorDB: store, embedding: rag.NewEmbeddingService(db)}
}

func NewWikiSearchServiceWithDependencies(db *gorm.DB, store WikiVectorSearcher, embedding WikiQueryEmbedder) *WikiSearchService {
	return &WikiSearchService{db: db, vectorDB: store, embedding: embedding}
}

func (s *WikiSearchService) Search(ctx context.Context, req WikiSearchRequest) ([]WikiSearchResult, error) {
	if s == nil || s.db == nil {
		return nil, fmt.Errorf("wiki search database is nil")
	}
	if req.Eid <= 0 || req.UserID <= 0 || strings.TrimSpace(req.Query) == "" {
		return []WikiSearchResult{}, nil
	}
	if req.TopK <= 0 {
		req.TopK = 20
	}
	if req.TopK > 100 {
		req.TopK = 100
	}
	// 新表尚未由应用启动时 AutoMigrate 时，保留兼容读取路径，避免旧实例在升级窗口完全不可用。
	// 正常运行且 wiki_page_chunks 已存在时，Wiki 检索只走企业级 Wiki 向量集合。
	if s.vectorDB != nil && s.db.Migrator().HasTable((&model.WikiPageChunk{}).TableName()) {
		return s.searchVectors(ctx, req)
	}

	keyword := "%" + strings.ToLower(strings.TrimSpace(req.Query)) + "%"
	query := s.db.WithContext(ctx).Model(&model.WikiPage{}).
		Where("eid = ? AND status = ?", req.Eid, model.WikiPageStatusActive).
		Where("lower(title) LIKE ? OR lower(summary) LIKE ? OR lower(body) LIKE ? OR lower(aliases) LIKE ?", keyword, keyword, keyword, keyword)
	if len(req.SpaceIDs) > 0 {
		query = query.Where("space_id IN ?", req.SpaceIDs)
	}
	if len(req.LibraryIDs) > 0 {
		query = query.Where("library_id IN ?", req.LibraryIDs)
	}
	if len(req.WikiPageIDs) > 0 {
		query = query.Where("id IN ?", req.WikiPageIDs)
	}

	var pages []model.WikiPage
	if err := query.Order("sort ASC").Order("id ASC").Limit(req.TopK * 3).Find(&pages).Error; err != nil {
		return nil, err
	}
	if len(pages) == 0 {
		return []WikiSearchResult{}, nil
	}

	pageIDs := make([]int64, 0, len(pages))
	for _, page := range pages {
		pageIDs = append(pageIDs, page.ID)
	}
	permissions, err := batchGetWikiPermissions(req.Eid, model.RESOURCE_TYPE_WIKI_PAGE, pageIDs, req.UserID)
	if err != nil {
		return nil, err
	}

	libraryIDs := make([]int64, 0, len(pages))
	spaceIDs := make([]int64, 0, len(pages))
	for _, page := range pages {
		libraryIDs = append(libraryIDs, page.LibraryID)
		spaceIDs = append(spaceIDs, page.SpaceID)
	}
	var libraries []model.Library
	if err := s.db.WithContext(ctx).Where("eid = ? AND id IN ?", req.Eid, libraryIDs).Find(&libraries).Error; err != nil {
		return nil, err
	}
	var spaces []model.Space
	if err := s.db.WithContext(ctx).Where("eid = ? AND id IN ?", req.Eid, spaceIDs).Find(&spaces).Error; err != nil {
		return nil, err
	}
	libraryMap := make(map[int64]model.Library, len(libraries))
	for _, library := range libraries {
		libraryMap[library.ID] = library
	}
	spaceMap := make(map[int64]model.Space, len(spaces))
	for _, space := range spaces {
		spaceMap[space.ID] = space
	}

	results := make([]WikiSearchResult, 0, req.TopK)
	for _, page := range pages {
		if permissions[page.ID] < model.PERMISSION_VIEW_ONLY {
			continue
		}
		library := libraryMap[page.LibraryID]
		space := spaceMap[page.SpaceID]
		results = append(results, WikiSearchResult{
			PageID: page.ID, SpaceID: page.SpaceID, LibraryID: page.LibraryID,
			Title: page.Title, Summary: page.Summary, Body: page.Body, Slug: page.Slug,
			PageType: page.PageType, CreatedTime: page.CreatedTime, Score: wikiSearchScore(page, req.Query),
			LibraryName: library.Name, LibraryIcon: library.Icon, SpaceName: space.Name,
		})
		if len(results) >= req.TopK {
			break
		}
	}
	return results, nil
}

func (s *WikiSearchService) searchVectors(ctx context.Context, req WikiSearchRequest) ([]WikiSearchResult, error) {
	// Wiki 使用企业级单集合，因此查询向量也必须来自企业级 embedding 配置。
	config, err := rag.NewChunkConfigService(s.db).GetEnterpriseEmbeddingConfig(req.Eid)
	if err != nil {
		return nil, fmt.Errorf("get wiki embedding config: %w", err)
	}
	if config.EmbeddingChannelID == nil || *config.EmbeddingChannelID <= 0 {
		return nil, fmt.Errorf("wiki embedding channel is not configured")
	}
	queryVector, err := s.embedding.GetQueryEmbedding(req.Eid, req.Query, *config.EmbeddingChannelID, config)
	if err != nil {
		return nil, fmt.Errorf("embed wiki query: %w", err)
	}
	vector := make([]float32, len(queryVector))
	for i, value := range queryVector {
		vector[i] = float32(value)
	}
	logicalCollection := wikiVectorCollectionName(req.Eid)
	physicalCollection := wikiSearchPhysicalCollectionName(logicalCollection)
	collectionDimension := 0
	if infoReader, ok := s.vectorDB.(wikiCollectionInfoReader); ok {
		if info, infoErr := infoReader.GetCollectionInfo(ctx, logicalCollection); infoErr != nil {
			logger.SysDebugf("【Wiki检索-Debug】获取集合信息失败: eid=%d channel_id=%d model=%s query_dim=%d logical_collection=%s physical_collection=%s err=%v", req.Eid, *config.EmbeddingChannelID, wikiEmbeddingModelName(config), len(vector), logicalCollection, physicalCollection, infoErr)
		} else if info != nil {
			collectionDimension = info.Dimension
		}
	}
	logger.SysDebugf("【Wiki检索-Debug】查询向量信息: eid=%d channel_id=%d model=%s query_dim=%d collection_dim=%d logical_collection=%s physical_collection=%s", req.Eid, *config.EmbeddingChannelID, wikiEmbeddingModelName(config), len(vector), collectionDimension, logicalCollection, physicalCollection)
	// 先将页面权限收敛为向量过滤条件，避免“先召回、后过滤”导致 TopK 被无权限页面耗尽。
	pageScopeQuery := s.db.WithContext(ctx).Model(&model.WikiPage{}).
		Where("eid = ? AND status = ?", req.Eid, model.WikiPageStatusActive)
	if len(req.SpaceIDs) > 0 {
		pageScopeQuery = pageScopeQuery.Where("space_id IN ?", req.SpaceIDs)
	}
	if len(req.LibraryIDs) > 0 {
		pageScopeQuery = pageScopeQuery.Where("library_id IN ?", req.LibraryIDs)
	}
	if len(req.WikiPageIDs) > 0 {
		pageScopeQuery = pageScopeQuery.Where("id IN ?", req.WikiPageIDs)
	}
	var scopedPageIDs []int64
	if err := pageScopeQuery.Pluck("id", &scopedPageIDs).Error; err != nil {
		return nil, err
	}
	if len(scopedPageIDs) == 0 {
		return []WikiSearchResult{}, nil
	}
	permissions, err := batchGetWikiPermissions(req.Eid, model.RESOURCE_TYPE_WIKI_PAGE, scopedPageIDs, req.UserID)
	if err != nil {
		return nil, err
	}
	allowedPageIDs := make([]int64, 0, len(scopedPageIDs))
	for _, pageID := range scopedPageIDs {
		if permissions[pageID] >= model.PERMISSION_VIEW_ONLY {
			allowedPageIDs = append(allowedPageIDs, pageID)
		}
	}
	if len(allowedPageIDs) == 0 {
		return []WikiSearchResult{}, nil
	}
	filter := rag.SearchScope{Eid: req.Eid, SpaceIDs: req.SpaceIDs, LibraryIDs: req.LibraryIDs}.BuildVectorFilter()
	filter["must"] = append(filter["must"].([]map[string]interface{}),
		map[string]interface{}{"key": "source_type", "match": map[string]interface{}{"value": "wiki"}},
		map[string]interface{}{"key": "status", "match": map[string]interface{}{"value": model.WikiPageChunkIndexStatusActive}},
		map[string]interface{}{"key": "wiki_page_id", "match": map[string]interface{}{"any": allowedPageIDs}},
	)
	response, err := s.vectorDB.Search(ctx, vectorstore.SearchRequest{
		Collection: logicalCollection, Vector: vector, TopK: req.TopK,
		Filters: filter, OutputFields: []string{"*"},
	})
	if err != nil {
		logger.SysDebugf("【Wiki检索-Debug】向量搜索失败: eid=%d channel_id=%d model=%s query_dim=%d collection_dim=%d logical_collection=%s physical_collection=%s err=%v", req.Eid, *config.EmbeddingChannelID, wikiEmbeddingModelName(config), len(vector), collectionDimension, logicalCollection, physicalCollection, err)
		if vectorstore.IsNotFoundError(err) {
			return []WikiSearchResult{}, nil
		}
		return nil, err
	}
	if response == nil {
		return []WikiSearchResult{}, nil
	}
	pageIDs := make([]int64, 0, len(response.Results))
	seenPages := make(map[int64]struct{})
	for _, hit := range response.Results {
		id := wikiMetadataInt64(hit.Metadata, "wiki_page_id")
		if id > 0 {
			if len(req.WikiPageIDs) > 0 && !containsInt64(req.WikiPageIDs, id) {
				continue
			}
			if _, ok := seenPages[id]; !ok {
				seenPages[id] = struct{}{}
				pageIDs = append(pageIDs, id)
			}
		}
	}
	if len(pageIDs) == 0 {
		return []WikiSearchResult{}, nil
	}
	var pages []model.WikiPage
	if err := s.db.WithContext(ctx).Where("eid = ? AND status = ? AND id IN ?", req.Eid, model.WikiPageStatusActive, pageIDs).Find(&pages).Error; err != nil {
		return nil, err
	}
	pageMap := make(map[int64]model.WikiPage, len(pages))
	for _, page := range pages {
		pageMap[page.ID] = page
	}
	chunkIDs := make([]string, 0, len(response.Results))
	seenChunkIDs := make(map[string]struct{}, len(response.Results))
	for _, hit := range response.Results {
		chunkID := wikiMetadataString(hit.Metadata, "chunk_id")
		if chunkID == "" {
			continue
		}
		if _, ok := seenChunkIDs[chunkID]; ok {
			continue
		}
		seenChunkIDs[chunkID] = struct{}{}
		chunkIDs = append(chunkIDs, chunkID)
	}
	chunkDBIDs := make(map[string]int64, len(chunkIDs))
	if len(chunkIDs) > 0 {
		var wikiChunks []model.WikiPageChunk
		if err := s.db.WithContext(ctx).Where("eid = ? AND chunk_id IN ?", req.Eid, chunkIDs).Find(&wikiChunks).Error; err != nil {
			return nil, err
		}
		for _, chunk := range wikiChunks {
			chunkDBIDs[chunk.ChunkID] = chunk.ID
		}
	}
	var libraries []model.Library
	var spaces []model.Space
	if err := s.db.WithContext(ctx).Where("eid = ? AND id IN ?", req.Eid, uniqueWikiLibraryIDs(pages)).Find(&libraries).Error; err != nil {
		return nil, err
	}
	if err := s.db.WithContext(ctx).Where("eid = ? AND id IN ?", req.Eid, uniqueWikiSpaceIDs(pages)).Find(&spaces).Error; err != nil {
		return nil, err
	}
	libraryMap := make(map[int64]model.Library, len(libraries))
	for _, item := range libraries {
		libraryMap[item.ID] = item
	}
	spaceMap := make(map[int64]model.Space, len(spaces))
	for _, item := range spaces {
		spaceMap[item.ID] = item
	}
	results := make([]WikiSearchResult, 0, req.TopK)
	returned := make(map[int64]struct{})
	for _, hit := range response.Results {
		pageID := wikiMetadataInt64(hit.Metadata, "wiki_page_id")
		page, ok := pageMap[pageID]
		if !ok || permissions[pageID] < model.PERMISSION_VIEW_ONLY {
			continue
		}
		if _, ok := returned[pageID]; ok {
			continue
		}
		returned[pageID] = struct{}{}
		library, space := libraryMap[page.LibraryID], spaceMap[page.SpaceID]
		chunkID := wikiMetadataString(hit.Metadata, "chunk_id")
		results = append(results, WikiSearchResult{PageID: page.ID, SpaceID: page.SpaceID, LibraryID: page.LibraryID, ChunkDBID: chunkDBIDs[chunkID], Title: page.Title, Summary: page.Summary, Body: page.Body, Content: wikiMetadataString(hit.Metadata, "content"), ChunkID: chunkID, HeadingPath: wikiMetadataString(hit.Metadata, "heading_path"), ChunkType: wikiMetadataString(hit.Metadata, "chunk_type"), Slug: page.Slug, PageType: page.PageType, CreatedTime: page.CreatedTime, Score: float64(hit.Score), LibraryName: library.Name, LibraryIcon: library.Icon, SpaceName: space.Name})
		if len(results) >= req.TopK {
			break
		}
	}
	return results, nil
}

func wikiEmbeddingModelName(config *rag.ChunkConfig) string {
	if config == nil || config.EmbeddingModelName == nil {
		return ""
	}
	return strings.TrimSpace(*config.EmbeddingModelName)
}

func wikiSearchPhysicalCollectionName(logicalCollection string) string {
	return vectorstore.LoadFromEnv().CollectionPrefix + logicalCollection
}

func wikiMetadataString(metadata map[string]interface{}, key string) string {
	if value, ok := metadata[key].(string); ok {
		return value
	}
	return ""
}
func wikiMetadataInt64(metadata map[string]interface{}, key string) int64 {
	switch value := metadata[key].(type) {
	case int64:
		return value
	case int:
		return int64(value)
	case float64:
		return int64(value)
	case float32:
		return int64(value)
	case string:
		var parsed int64
		_, _ = fmt.Sscan(value, &parsed)
		return parsed
	}
	return 0
}
func containsInt64(items []int64, target int64) bool {
	for _, item := range items {
		if item == target {
			return true
		}
	}
	return false
}
func uniqueWikiLibraryIDs(pages []model.WikiPage) []int64 {
	result := make([]int64, 0, len(pages))
	seen := map[int64]struct{}{}
	for _, page := range pages {
		if _, ok := seen[page.LibraryID]; !ok {
			seen[page.LibraryID] = struct{}{}
			result = append(result, page.LibraryID)
		}
	}
	return result
}
func uniqueWikiSpaceIDs(pages []model.WikiPage) []int64 {
	result := make([]int64, 0, len(pages))
	seen := map[int64]struct{}{}
	for _, page := range pages {
		if _, ok := seen[page.SpaceID]; !ok {
			seen[page.SpaceID] = struct{}{}
			result = append(result, page.SpaceID)
		}
	}
	return result
}

func wikiSearchScore(page model.WikiPage, query string) float64 {
	q := strings.ToLower(strings.TrimSpace(query))
	if strings.Contains(strings.ToLower(page.Title), q) {
		return 1.0
	}
	if strings.Contains(strings.ToLower(page.Summary), q) {
		return 0.8
	}
	return 0.6
}
