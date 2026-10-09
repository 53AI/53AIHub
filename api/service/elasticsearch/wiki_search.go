package elasticsearch

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/model"
	"github.com/elastic/go-elasticsearch/v7/esapi"
	"gorm.io/gorm"
)

type WikiDocument struct {
	PageID      int64    `json:"page_id"`
	Eid         int64    `json:"eid"`
	SpaceID     int64    `json:"space_id"`
	LibraryID   int64    `json:"library_id"`
	Title       string   `json:"title"`
	Summary     string   `json:"summary"`
	Body        string   `json:"body"`
	Aliases     []string `json:"aliases"`
	Slug        string   `json:"slug"`
	PageType    string   `json:"page_type"`
	Status      string   `json:"status"`
	CreatedTime int64    `json:"created_time"`
	UpdatedTime int64    `json:"updated_time"`
}

type WikiSearchRequest struct {
	Eid             int64
	UserID          int64
	Query           string
	SpaceIDs        []int64
	LibraryIDs      []int64
	CategoryIDs     []int64
	CategoryOther   bool
	CreatedTimeFrom *int64
	CreatedTimeTo   *int64
	UpdatedTimeFrom *int64
	UpdatedTimeTo   *int64
	SortBy          string
	Page            int
	Size            int
}

type WikiSearchResult struct {
	PageID           int64                `json:"page_id"`
	SpaceID          int64                `json:"space_id"`
	LibraryID        int64                `json:"library_id"`
	Title            string               `json:"title"`
	Summary          string               `json:"summary"`
	Body             string               `json:"body"`
	Slug             string               `json:"slug"`
	PageType         string               `json:"page_type"`
	CreatedTime      int64                `json:"created_time"`
	UpdatedTime      int64                `json:"updated_time"`
	Score            float64              `json:"score"`
	Highlight        string               `json:"highlight,omitempty"`
	ContentHighlight string               `json:"content_highlight,omitempty"`
	LibraryName      string               `json:"library_name"`
	LibraryIcon      string               `json:"library_icon"`
	SpaceName        string               `json:"space_name"`
	Categories       []WikiSearchCategory `json:"categories"`
	// 非持久化：当前用户对页面的实测权限（含 Source 文件交集），恒返回，0=无权限。
	Permission int `json:"permission"`
}

type WikiSearchCategory struct {
	ID      int64  `json:"id"`
	Name    string `json:"name"`
	Slug    string `json:"slug"`
	SpaceID int64  `json:"space_id"`
}

type wikiSearchCategoryRow struct {
	PageID  int64
	ID      int64
	Name    string
	Slug    string
	SpaceID int64
}

type WikiSearchPage struct {
	Items []WikiSearchResult `json:"items"`
	Total int64              `json:"total"`
	Page  int                `json:"page"`
	Size  int                `json:"size"`
}

func convertToWikiDocument(page *model.WikiPage) WikiDocument {
	return WikiDocument{
		PageID: page.ID, Eid: page.Eid, SpaceID: page.SpaceID, LibraryID: page.LibraryID,
		Title: page.Title, Summary: page.Summary, Body: page.Body, Aliases: page.Aliases,
		Slug: page.Slug, PageType: page.PageType, Status: page.Status,
		CreatedTime: page.CreatedTime, UpdatedTime: page.UpdatedTime,
	}
}

func wikiDocumentID(pageID int64) string { return fmt.Sprintf("wiki:%d", pageID) }

// DeleteWikiLibraryDocuments removes stale ES Wiki documents scoped to one tenant library.
func DeleteWikiLibraryDocuments(ctx context.Context, client *Client, eid, libraryID int64) (int64, error) {
	if client == nil || client.IsDisabled() {
		return 0, nil
	}
	if eid <= 0 || libraryID <= 0 {
		return 0, fmt.Errorf("eid and library_id are required")
	}
	body, err := json.Marshal(map[string]interface{}{"query": map[string]interface{}{"bool": map[string]interface{}{"filter": []interface{}{
		map[string]interface{}{"term": map[string]interface{}{"eid": eid}},
		map[string]interface{}{"term": map[string]interface{}{"library_id": libraryID}},
	}}}})
	if err != nil {
		return 0, err
	}
	refresh := true
	ignoreUnavailable := true
	res, err := (esapi.DeleteByQueryRequest{Index: []string{client.GetWikiIndexName()}, Body: bytes.NewReader(body), Conflicts: "proceed", Refresh: &refresh, IgnoreUnavailable: &ignoreUnavailable}).Do(ctx, client)
	if err != nil {
		return 0, fmt.Errorf("delete wiki library from Elasticsearch: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode == 404 {
		return 0, nil
	}
	if res.IsError() {
		return 0, fmt.Errorf("delete wiki library Elasticsearch response: %s", res.Status())
	}
	var result struct {
		Deleted  int64             `json:"deleted"`
		TimedOut bool              `json:"timed_out"`
		Failures []json.RawMessage `json:"failures"`
	}
	if err := json.NewDecoder(res.Body).Decode(&result); err != nil {
		return 0, fmt.Errorf("decode wiki Elasticsearch delete result: %w", err)
	}
	if result.TimedOut || len(result.Failures) > 0 {
		return result.Deleted, fmt.Errorf("Elasticsearch delete incomplete: timed_out=%t failures=%d", result.TimedOut, len(result.Failures))
	}
	return result.Deleted, nil
}

func (s *WikiSearchService) IndexWikiPagesBatch(pages []model.WikiPage) error {
	if s == nil || s.client == nil || s.client.IsDisabled() || len(pages) == 0 {
		return nil
	}
	var buf bytes.Buffer
	for i := range pages {
		meta, _ := json.Marshal(map[string]interface{}{"index": map[string]interface{}{
			"_index": s.client.GetWikiIndexName(), "_id": wikiDocumentID(pages[i].ID),
		}})
		doc, err := json.Marshal(convertToWikiDocument(&pages[i]))
		if err != nil {
			return fmt.Errorf("序列化 Wiki 文档失败: %v", err)
		}
		buf.Write(meta)
		buf.WriteByte('\n')
		buf.Write(doc)
		buf.WriteByte('\n')
	}
	res, err := (esapi.BulkRequest{Body: &buf, Refresh: "false"}).Do(context.Background(), s.client)
	if err != nil {
		return fmt.Errorf("批量索引 Wiki 失败: %v", err)
	}
	defer res.Body.Close()
	if res.IsError() {
		return fmt.Errorf("批量索引 Wiki 响应错误: %s", res.Status())
	}
	var response struct {
		Errors bool `json:"errors"`
	}
	if err := json.NewDecoder(res.Body).Decode(&response); err != nil {
		return fmt.Errorf("解析 Wiki 批量索引响应失败: %v", err)
	}
	if response.Errors {
		return fmt.Errorf("批量索引 Wiki 存在逐项失败")
	}
	return nil
}

type WikiSearchService struct {
	client *Client
	db     *gorm.DB
}

func NewWikiSearchService(client *Client, db *gorm.DB) *WikiSearchService {
	return &WikiSearchService{client: client, db: db}
}

func (s *WikiSearchService) SearchPage(ctx context.Context, req WikiSearchRequest) (*WikiSearchPage, error) {
	if s.client == nil || s.client.IsDisabled() {
		return nil, fmt.Errorf("Elasticsearch 服务不可用")
	}
	if req.Page <= 0 {
		req.Page = 1
	}
	if req.Size <= 0 {
		req.Size = 20
	}
	if req.Size > 100 {
		req.Size = 100
	}
	var recentRanks map[int64]int
	var pageIDs []int64
	var err error
	if req.SortBy == "recent_access" {
		pageIDs, recentRanks, err = s.scopeRecentWikiPageIDs(ctx, req)
		if err != nil {
			return nil, err
		}
	} else {
		pageIDs, err = s.scopeWikiPageIDs(ctx, req)
		if err != nil {
			return nil, err
		}
	}
	permissions, pageSpaces, err := batchWikiPermissionsWithSnapshot(ctx, req.Eid, pageIDs, req.UserID)
	if err != nil {
		return nil, err
	}
	// 空间级读门禁：页面权限可能被显式页面 ACL 单独放行，但所在空间 Wiki 不可读时，
	// 整空间结果不应出现在搜索中（与 /api/spaces/:id/wiki/pages 的 403 门禁同口径）。
	spaceRead, err := wikiSearchSpaceReadPermissions(ctx, req.Eid, pageSpaces, req.UserID)
	if err != nil {
		return nil, err
	}
	allowedIDs := wikiSearchAllowedIDs(pageIDs, pageSpaces, permissions, spaceRead)
	if len(allowedIDs) == 0 {
		return &WikiSearchPage{Items: []WikiSearchResult{}, Total: 0, Page: req.Page, Size: req.Size}, nil
	}
	query := buildWikiSearchQuery(req.Eid, allowedIDs, &req)
	var body bytes.Buffer
	if err := json.NewEncoder(&body).Encode(query); err != nil {
		return nil, err
	}
	from := (req.Page - 1) * req.Size
	searchFrom, searchSize := from, req.Size
	if req.SortBy == "recent_access" {
		searchFrom, searchSize = 0, len(allowedIDs)
	}
	res, err := s.client.Search(s.client.Search.WithContext(ctx), s.client.Search.WithIndex(s.client.GetWikiIndexName()), s.client.Search.WithBody(&body), s.client.Search.WithFrom(searchFrom), s.client.Search.WithSize(searchSize), s.client.Search.WithTrackTotalHits(true))
	if err != nil {
		return nil, fmt.Errorf("搜索 Wiki 失败: %v", err)
	}
	defer res.Body.Close()
	if res.IsError() {
		return nil, fmt.Errorf("搜索 Wiki 响应错误: %s", res.Status())
	}
	var response struct {
		Hits struct {
			Total json.RawMessage   `json:"total"`
			Hits  []json.RawMessage `json:"hits"`
		} `json:"hits"`
	}
	if err := json.NewDecoder(res.Body).Decode(&response); err != nil {
		return nil, err
	}
	total := parseWikiTotal(response.Hits.Total)
	items := make([]WikiSearchResult, 0, len(response.Hits.Hits))
	spaceIDs, libraryIDs := make([]int64, 0), make([]int64, 0)
	for _, raw := range response.Hits.Hits {
		var hit struct {
			Source    WikiDocument        `json:"_source"`
			Score     float64             `json:"_score"`
			Highlight map[string][]string `json:"highlight"`
		}
		if err := json.Unmarshal(raw, &hit); err != nil {
			return nil, err
		}
		item := WikiSearchResult{PageID: hit.Source.PageID, SpaceID: hit.Source.SpaceID, LibraryID: hit.Source.LibraryID, Title: hit.Source.Title, Summary: hit.Source.Summary, Body: hit.Source.Body, Slug: hit.Source.Slug, PageType: hit.Source.PageType, CreatedTime: hit.Source.CreatedTime, UpdatedTime: hit.Source.UpdatedTime, Score: hit.Score, Permission: permissions[hit.Source.PageID]}
		item.Highlight, item.ContentHighlight = extractWikiHighlights(hit.Highlight)
		items = append(items, item)
		spaceIDs = append(spaceIDs, item.SpaceID)
		libraryIDs = append(libraryIDs, item.LibraryID)
	}
	s.enrichNames(ctx, req.Eid, items, spaceIDs, libraryIDs)
	if req.SortBy == "recent_access" {
		sort.SliceStable(items, func(i, j int) bool {
			return recentRanks[items[i].PageID] < recentRanks[items[j].PageID]
		})
		if from >= len(items) {
			items = []WikiSearchResult{}
		} else {
			end := from + req.Size
			if end > len(items) {
				end = len(items)
			}
			items = items[from:end]
		}
	}
	return &WikiSearchPage{Items: items, Total: total, Page: req.Page, Size: req.Size}, nil
}

func (s *WikiSearchService) scopeRecentWikiPageIDs(ctx context.Context, req WikiSearchRequest) ([]int64, map[int64]int, error) {
	resourceType := model.RESOURCE_TYPE_WIKI_PAGE
	records, err := model.ListUserRecentUsed(req.Eid, req.UserID, &resourceType, nil)
	if err != nil {
		return nil, nil, err
	}
	candidates := make([]int64, 0, len(records))
	for _, record := range records {
		candidates = append(candidates, record.ResourceID)
	}
	if len(candidates) == 0 {
		return nil, map[int64]int{}, nil
	}
	scopedPageIDs, err := s.scopeWikiPageIDs(ctx, req, candidates)
	if err != nil {
		return nil, nil, err
	}
	scoped := make(map[int64]struct{}, len(scopedPageIDs))
	for _, id := range scopedPageIDs {
		scoped[id] = struct{}{}
	}
	pageIDs := make([]int64, 0, len(scopedPageIDs))
	ranks := make(map[int64]int, len(scopedPageIDs))
	for _, record := range records {
		if _, ok := scoped[record.ResourceID]; !ok {
			continue
		}
		ranks[record.ResourceID] = len(pageIDs)
		pageIDs = append(pageIDs, record.ResourceID)
	}
	return pageIDs, ranks, nil
}

func buildWikiSearchQuery(eid int64, pageIDs []int64, req *WikiSearchRequest) map[string]interface{} {
	filters := []map[string]interface{}{
		{"term": map[string]interface{}{"eid": eid}},
		{"term": map[string]interface{}{"status": model.WikiPageStatusActive}},
		{"terms": map[string]interface{}{"page_id": pageIDs}},
	}
	boolQuery := map[string]interface{}{"filter": filters}
	if strings.TrimSpace(req.Query) != "" {
		boolQuery["must"] = []map[string]interface{}{{"multi_match": map[string]interface{}{
			"query": req.Query, "fields": []string{"title^8", "aliases^4", "summary^3", "body^1"}, "type": "best_fields", "operator": "and",
		}}}
	} else {
		boolQuery["must"] = []map[string]interface{}{{"match_all": map[string]interface{}{}}}
	}
	if len(req.SpaceIDs) > 0 {
		filters = append(filters, map[string]interface{}{"terms": map[string]interface{}{"space_id": req.SpaceIDs}})
	}
	if len(req.LibraryIDs) > 0 {
		filters = append(filters, map[string]interface{}{"terms": map[string]interface{}{"library_id": req.LibraryIDs}})
	}
	if req.CreatedTimeFrom != nil || req.CreatedTimeTo != nil {
		rangeClause := map[string]interface{}{}
		if req.CreatedTimeFrom != nil {
			rangeClause["gte"] = *req.CreatedTimeFrom
		}
		if req.CreatedTimeTo != nil {
			rangeClause["lte"] = *req.CreatedTimeTo
		}
		filters = append(filters, map[string]interface{}{
			"range": map[string]interface{}{
				"created_time": rangeClause,
			},
		})
	}
	if req.UpdatedTimeFrom != nil || req.UpdatedTimeTo != nil {
		rangeClause := map[string]interface{}{}
		if req.UpdatedTimeFrom != nil {
			rangeClause["gte"] = *req.UpdatedTimeFrom
		}
		if req.UpdatedTimeTo != nil {
			rangeClause["lte"] = *req.UpdatedTimeTo
		}
		filters = append(filters, map[string]interface{}{
			"range": map[string]interface{}{
				"updated_time": rangeClause,
			},
		})
	}
	boolQuery["filter"] = filters
	var sort []map[string]interface{}
	if strings.TrimSpace(req.Query) != "" {
		sort = []map[string]interface{}{
			{"_score": map[string]interface{}{"order": "desc"}},
			{"updated_time": map[string]interface{}{"order": "desc"}},
		}
	} else {
		sort = []map[string]interface{}{
			{"updated_time": map[string]interface{}{"order": "desc"}},
			{"_score": map[string]interface{}{"order": "desc"}},
		}
	}
	return map[string]interface{}{
		"query": map[string]interface{}{"bool": boolQuery},
		"highlight": map[string]interface{}{"fields": map[string]interface{}{
			"title":   map[string]interface{}{},
			"summary": map[string]interface{}{},
			"body": map[string]interface{}{
				"fragment_size":       120,
				"number_of_fragments": 1,
				"no_match_size":       0,
			},
		}, "pre_tags": []string{"<mark>"}, "post_tags": []string{"</mark>"}},
		"sort": sort,
	}
}
func extractWikiHighlights(hitHighlight map[string][]string) (string, string) {
	if len(hitHighlight) == 0 {
		return "", ""
	}
	highlight := ""
	for _, field := range []string{"title", "aliases", "summary"} {
		if values := hitHighlight[field]; len(values) > 0 && values[0] != "" {
			highlight = values[0]
			break
		}
	}
	contentHighlight := ""
	if values := hitHighlight["body"]; len(values) > 0 {
		var parts []string
		for _, v := range values {
			if v != "" {
				parts = append(parts, v)
			}
		}
		contentHighlight = strings.Join(parts, " ... ")
	}
	if highlight == "" && contentHighlight != "" {
		highlight = contentHighlight
	}
	return highlight, contentHighlight
}

func (s *WikiSearchService) scopeWikiPageIDs(ctx context.Context, req WikiSearchRequest, candidateIDs ...[]int64) ([]int64, error) {
	query := s.db.WithContext(ctx).Model(&model.WikiPage{}).Where("eid = ? AND status = ?", req.Eid, model.WikiPageStatusActive)
	if len(candidateIDs) > 0 && len(candidateIDs[0]) > 0 {
		query = query.Where("id IN ?", candidateIDs[0])
	}
	if len(req.SpaceIDs) > 0 {
		query = query.Where("space_id IN ?", req.SpaceIDs)
	}
	if len(req.LibraryIDs) > 0 {
		query = query.Where("library_id IN ?", req.LibraryIDs)
	}
	if req.CreatedTimeFrom != nil {
		query = query.Where("created_time >= ?", *req.CreatedTimeFrom)
	}
	if req.CreatedTimeTo != nil {
		query = query.Where("created_time <= ?", *req.CreatedTimeTo)
	}
	if req.UpdatedTimeFrom != nil {
		query = query.Where("updated_time >= ?", *req.UpdatedTimeFrom)
	}
	if req.UpdatedTimeTo != nil {
		query = query.Where("updated_time <= ?", *req.UpdatedTimeTo)
	}
	categoryExists := "EXISTS (SELECT 1 FROM wiki_page_categories wpc WHERE wpc.eid = ? AND wpc.page_id = wiki_pages.id AND wpc.category_id IN ?)"
	otherExists := "NOT EXISTS (SELECT 1 FROM wiki_page_categories wpc WHERE wpc.eid = ? AND wpc.page_id = wiki_pages.id)"
	if len(req.CategoryIDs) > 0 && req.CategoryOther {
		query = query.Where("("+categoryExists+") OR ("+otherExists+")", req.Eid, req.CategoryIDs, req.Eid)
	} else if len(req.CategoryIDs) > 0 {
		query = query.Where(categoryExists, req.Eid, req.CategoryIDs)
	} else if req.CategoryOther {
		query = query.Where(otherExists, req.Eid)
	}
	var ids []int64
	if err := query.Pluck("id", &ids).Error; err != nil {
		return nil, err
	}
	return ids, nil
}

func (s *WikiSearchService) enrichNames(ctx context.Context, eid int64, items []WikiSearchResult, spaceIDs, libraryIDs []int64) {
	var libraries []model.Library
	var spaces []model.Space
	s.db.WithContext(ctx).Where("eid = ? AND id IN ?", eid, libraryIDs).Find(&libraries)
	s.db.WithContext(ctx).Where("eid = ? AND id IN ?", eid, spaceIDs).Find(&spaces)
	libraryMap := make(map[int64]model.Library, len(libraries))
	spaceMap := make(map[int64]model.Space, len(spaces))
	for _, item := range libraries {
		libraryMap[item.ID] = item
	}
	for _, item := range spaces {
		spaceMap[item.ID] = item
	}
	for i := range items {
		library, space := libraryMap[items[i].LibraryID], spaceMap[items[i].SpaceID]
		items[i].LibraryName, items[i].LibraryIcon, items[i].SpaceName = library.Name, library.Icon, space.Name
	}
	pageIDs := make([]int64, 0, len(items))
	for _, item := range items {
		pageIDs = append(pageIDs, item.PageID)
	}
	categoryMap := s.loadWikiSearchCategories(ctx, eid, pageIDs)
	for i := range items {
		items[i].Categories = categoryMap[items[i].PageID]
		if items[i].Categories == nil {
			items[i].Categories = []WikiSearchCategory{}
		}
	}
}

func (s *WikiSearchService) loadWikiSearchCategories(ctx context.Context, eid int64, pageIDs []int64) map[int64][]WikiSearchCategory {
	result := make(map[int64][]WikiSearchCategory, len(pageIDs))
	if s.db == nil || len(pageIDs) == 0 {
		return result
	}
	var rows []wikiSearchCategoryRow
	err := s.db.WithContext(ctx).Table("wiki_page_categories AS wpc").
		Select("wpc.page_id, wc.id, wc.name, wc.slug, wc.space_id").
		Joins("JOIN wiki_categories AS wc ON wc.id = wpc.category_id AND wc.eid = wpc.eid").
		Where("wpc.eid = ? AND wpc.page_id IN ? AND wc.status = ?", eid, pageIDs, model.WikiCategoryStatusEnabled).
		Order("wpc.page_id ASC, wc.sort ASC, wc.id ASC").
		Find(&rows).Error
	if err != nil {
		return result
	}
	return groupWikiSearchCategories(rows)
}

func groupWikiSearchCategories(rows []wikiSearchCategoryRow) map[int64][]WikiSearchCategory {
	result := make(map[int64][]WikiSearchCategory)
	for _, row := range rows {
		result[row.PageID] = append(result[row.PageID], WikiSearchCategory{
			ID: row.ID, Name: row.Name, Slug: row.Slug, SpaceID: row.SpaceID,
		})
	}
	return result
}

func parseWikiTotal(raw json.RawMessage) int64 {
	var value int64
	if json.Unmarshal(raw, &value) == nil {
		return value
	}
	var object struct {
		Value int64 `json:"value"`
	}
	if json.Unmarshal(raw, &object) == nil {
		return object.Value
	}
	return 0
}

// batchWikiPermissionsWithSnapshot WIKI_PAGE 批量权限走按库快照（与 service 侧 batchGetWikiPermissions
// 同语义；elasticsearch 子包不能反向依赖 service 主包，故独立实现，共用 common.LoadCapabilityWiki）：
// 先批量定位页面所属库，按库分组加载快照注入 resolver；跨库/快照失败降级 DB 路径（resolver 内仍有 Source 交集）。
// 第二返回值 pageSpaces 为 pageID→spaceID 映射，供搜索层叠加空间级读门禁。
func batchWikiPermissionsWithSnapshot(ctx context.Context, eid int64, pageIDs []int64, userID int64) (map[int64]int, map[int64]int64, error) {
	pages, err := model.GetWikiPagesByIDs(eid, pageIDs)
	if err != nil || len(pages) == 0 {
		m, batchErr := common.BatchGetUserPermissions(eid, model.RESOURCE_TYPE_WIKI_PAGE, pageIDs, userID, ctx)
		return m, nil, batchErr
	}
	perLibrary := make(map[int64][]int64)
	pageSpaces := make(map[int64]int64, len(pages))
	for _, p := range pages {
		perLibrary[p.LibraryID] = append(perLibrary[p.LibraryID], p.ID)
		pageSpaces[p.ID] = p.SpaceID
	}
	result := make(map[int64]int, len(pageIDs))
	for libraryID, ids := range perLibrary {
		wiki, perms, loadErr := common.LoadCapabilityWiki(ctx, eid, libraryID)
		if loadErr != nil {
			m, batchErr := common.BatchGetUserPermissions(eid, model.RESOURCE_TYPE_WIKI_PAGE, ids, userID, ctx)
			if batchErr != nil {
				return nil, nil, batchErr
			}
			for id, perm := range m {
				result[id] = perm
			}
			continue
		}
		m, batchErr := common.BatchGetUserPermissionsWithWikiSnapshot(eid, model.RESOURCE_TYPE_WIKI_PAGE, ids, userID, wiki, perms, ctx)
		if batchErr != nil {
			return nil, nil, batchErr
		}
		for id, perm := range m {
			result[id] = perm
		}
	}
	// 非 active 页面（不在 pages 内）保持原批量语义：NONE。
	for _, id := range pageIDs {
		if _, ok := result[id]; !ok {
			result[id] = model.PERMISSION_NONE
		}
	}
	return result, pageSpaces, nil
}

// wikiSearchSpaceReadPermissions 从候选页面提取所在空间（去重），复用 common.BatchGetWikiSpaceReadPermissions
// 解析空间 Wiki 读权限——与 /api/spaces/:id/wiki/pages 门禁同口径（type=4 已配置以其为准，未配置回退 RAG 空间）。
func wikiSearchSpaceReadPermissions(ctx context.Context, eid int64, pageSpaces map[int64]int64, userID int64) (map[int64]int, error) {
	spaceIDs := make([]int64, 0, len(pageSpaces))
	seen := make(map[int64]struct{}, len(pageSpaces))
	for _, spaceID := range pageSpaces {
		if spaceID <= 0 {
			continue
		}
		if _, ok := seen[spaceID]; ok {
			continue
		}
		seen[spaceID] = struct{}{}
		spaceIDs = append(spaceIDs, spaceID)
	}
	return common.BatchGetWikiSpaceReadPermissions(eid, spaceIDs, userID, ctx)
}

// wikiSearchAllowedIDs 判定搜索可见页面：页面权限 >= VIEW_ONLY 且所在空间 Wiki 可读（>= PUBLIC_ONLY）。
// 空间门禁与 /api/spaces/:id/wiki/pages 同口径，防止显式页面 ACL 单独放行导致跨空间搜索结果泄漏。
func wikiSearchAllowedIDs(pageIDs []int64, pageSpaces map[int64]int64, pagePerms, spaceRead map[int64]int) []int64 {
	allowed := make([]int64, 0, len(pageIDs))
	for _, id := range pageIDs {
		spaceID := pageSpaces[id]
		if pagePerms[id] >= model.PERMISSION_VIEW_ONLY && spaceRead[spaceID] >= model.PERMISSION_PUBLIC_ONLY {
			allowed = append(allowed, id)
		}
	}
	return allowed
}
