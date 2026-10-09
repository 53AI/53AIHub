package service

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

var ErrExternalWikiPageNotFound = errors.New("external wiki page not found")
var ErrExternalWikiQueryRequired = errors.New("external wiki query required")

type ExternalWikiListRequest struct {
	Eid           int64
	LibraryIDs    []int64
	CategoryID    int64
	CategoryOther bool
	Keyword       string
	PageType      string
	Offset        int
	Limit         int
}

type ExternalWikiSearchRequest struct {
	Eid        int64
	LibraryIDs []int64
	Query      string
	TopK       int
}

type ExternalWikiListResponse struct {
	Items []ExternalWikiPage `json:"items"`
	Total int64              `json:"total"`
}

type ExternalWikiSearchResponse struct {
	Items []ExternalWikiSearchItem `json:"items"`
	Total int64                    `json:"total"`
}

type ExternalWikiCategory struct {
	ID               int64
	Name             string
	Slug             string
	Description      string
	TargetEntityType string
	Sort             int64
	PageCount        int64
	IsVirtual        bool
}

type ExternalWikiSource struct {
	ID             int64
	SourceKind     string
	SourceRef      string
	SourceFileID   int64
	SourceChunkID  int64
	SourceSlug     string
	SourceLocation string
	SourceURL      string
	ExternalID     string
	LastSyncedTime int64
	FileLibraryID  int64
	FileName       string
}

type ExternalWikiLink struct {
	ID               int64
	RelatedPageID    int64
	RelatedPageSlug  string
	RelatedPageTitle string
	RelatedPageType  string
	LinkKind         string
	AnchorText       string
	TargetSlug       string
}

type ExternalWikiPage struct {
	ID            int64
	SpaceID       int64
	LibraryID     int64
	FolderID      int64
	Title         string
	Slug          string
	PageType      string
	Summary       string
	Aliases       []string
	Status        string
	Visibility    string
	CreatedTime   int64
	UpdatedTime   int64
	VersionNo     int64
	VersionTag    string
	PublishedTime int64
	Body          string
	BodyFormat    string
	Categories    []ExternalWikiCategory
	Sources       []ExternalWikiSource
	Links         []ExternalWikiLink
	Backlinks     []ExternalWikiLink
}

type ExternalWikiSearchItem struct {
	PageID        int64
	SpaceID       int64
	LibraryID     int64
	Title         string
	Slug          string
	Summary       string
	Snippet       string
	PageType      string
	VersionNo     int64
	VersionTag    string
	PublishedTime int64
	Categories    []ExternalWikiCategory
}

type ExternalWikiReadService interface {
	ResolveLibraryScope(ctx context.Context, eid int64, libraryID, spaceID *int64) ([]int64, error)
	ListCategories(ctx context.Context, eid int64, libraryIDs []int64) ([]ExternalWikiCategory, error)
	ListPages(ctx context.Context, req ExternalWikiListRequest) (*ExternalWikiListResponse, error)
	GetPage(ctx context.Context, eid int64, libraryIDs []int64, pageID int64) (*ExternalWikiPage, error)
	Search(ctx context.Context, req ExternalWikiSearchRequest) (*ExternalWikiSearchResponse, error)
}

type externalWikiReadService struct {
	db *gorm.DB
}

func NewExternalWikiReadService(db *gorm.DB) ExternalWikiReadService {
	return &externalWikiReadService{db: db}
}

func (s *externalWikiReadService) ListPages(ctx context.Context, req ExternalWikiListRequest) (*ExternalWikiListResponse, error) {
	if err := s.ensureReady(); err != nil {
		return nil, err
	}
	if err := validateExternalWikiScope(req.Eid, req.LibraryIDs); err != nil {
		return nil, err
	}

	limit := normalizeExternalWikiLimit(req.Limit)
	offset := req.Offset
	if offset < 0 {
		offset = 0
	}

	query := s.visiblePageQuery(ctx, req.Eid, req.LibraryIDs)
	query = applyExternalWikiPageFilters(query, req.Keyword, req.PageType, req.CategoryID, req.CategoryOther)

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, err
	}

	var pages []model.WikiPage
	if err := query.Order("sort ASC, id ASC").Offset(offset).Limit(limit).Find(&pages).Error; err != nil {
		return nil, err
	}

	versions, err := s.loadCurrentPublishedVersions(ctx, req.Eid, pages)
	if err != nil {
		return nil, err
	}

	items := make([]ExternalWikiPage, 0, len(pages))
	for _, page := range pages {
		version, ok := versions[page.ID]
		if !ok {
			continue
		}
		items = append(items, buildExternalWikiPage(page, version, false))
	}

	if err := s.populateExternalWikiPageCategories(ctx, req.Eid, pages, items); err != nil {
		return nil, err
	}
	return &ExternalWikiListResponse{Items: items, Total: total}, nil
}

func (s *externalWikiReadService) GetPage(ctx context.Context, eid int64, libraryIDs []int64, pageID int64) (*ExternalWikiPage, error) {
	if err := s.ensureReady(); err != nil {
		return nil, err
	}
	if err := validateExternalWikiScope(eid, libraryIDs); err != nil {
		return nil, err
	}
	if pageID <= 0 {
		return nil, ErrExternalWikiPageNotFound
	}

	var page model.WikiPage
	if err := s.visiblePageQuery(ctx, eid, libraryIDs).Where("id = ?", pageID).First(&page).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrExternalWikiPageNotFound
		}
		return nil, err
	}

	var version model.WikiPageVersion
	if err := s.db.WithContext(ctx).
		Where("eid = ? AND page_id = ? AND id = ? AND is_published = ?", eid, page.ID, page.CurrentVersionID, true).
		First(&version).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrExternalWikiPageNotFound
		}
		return nil, err
	}

	pageResult := buildExternalWikiPage(page, version, true)
	categoryByPage, err := s.loadExternalWikiCategories(ctx, eid, []int64{page.ID})
	if err != nil {
		return nil, err
	}
	pageResult.Categories = categoryByPage[page.ID]
	pageResult.Sources, err = s.loadExternalWikiSources(ctx, eid, libraryIDs, page.ID)
	if err != nil {
		return nil, err
	}
	pageResult.Links, err = s.loadExternalWikiLinks(ctx, eid, libraryIDs, page.ID, true)
	if err != nil {
		return nil, err
	}
	pageResult.Backlinks, err = s.loadExternalWikiLinks(ctx, eid, libraryIDs, page.ID, false)
	if err != nil {
		return nil, err
	}
	return &pageResult, nil
}

func (s *externalWikiReadService) Search(ctx context.Context, req ExternalWikiSearchRequest) (*ExternalWikiSearchResponse, error) {
	if err := s.ensureReady(); err != nil {
		return nil, err
	}
	if err := validateExternalWikiScope(req.Eid, req.LibraryIDs); err != nil {
		return nil, err
	}
	queryText := strings.TrimSpace(req.Query)
	if queryText == "" {
		return nil, ErrExternalWikiQueryRequired
	}

	topK := req.TopK
	if topK <= 0 {
		topK = 10
	}
	if topK > 50 {
		topK = 50
	}

	like := "%" + strings.ToLower(queryText) + "%"
	publishedBodyPages := s.db.WithContext(ctx).Model(&model.WikiPageVersion{}).
		Select("page_id").
		Where("eid = ? AND is_published = ? AND lower(body) LIKE ?", req.Eid, true, like)

	query := s.visiblePageQuery(ctx, req.Eid, req.LibraryIDs).
		Where(s.db.Where("lower(title) LIKE ?", like).
			Or("lower(slug) LIKE ?", like).
			Or("lower(summary) LIKE ?", like).
			Or("id IN (?)", publishedBodyPages))

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, err
	}

	var pages []model.WikiPage
	if err := query.Order("updated_time DESC, id DESC").Limit(topK).Find(&pages).Error; err != nil {
		return nil, err
	}
	versions, err := s.loadCurrentPublishedVersions(ctx, req.Eid, pages)
	if err != nil {
		return nil, err
	}

	items := make([]ExternalWikiSearchItem, 0, len(pages))
	for _, page := range pages {
		version, ok := versions[page.ID]
		if !ok {
			continue
		}
		items = append(items, ExternalWikiSearchItem{
			PageID:        page.ID,
			SpaceID:       page.SpaceID,
			LibraryID:     page.LibraryID,
			Title:         page.Title,
			Slug:          page.Slug,
			Summary:       page.Summary,
			Snippet:       externalWikiSnippet(version.Body, queryText),
			PageType:      page.PageType,
			VersionNo:     version.VersionNo,
			VersionTag:    version.VersionTag,
			PublishedTime: version.PublishedTime,
		})
	}
	categoryByPage, err := s.loadExternalWikiCategories(ctx, req.Eid, externalWikiPageIDs(pages))
	if err != nil {
		return nil, err
	}
	for i := range items {
		items[i].Categories = categoryByPage[items[i].PageID]
	}

	return &ExternalWikiSearchResponse{Items: items, Total: total}, nil
}

func (s *externalWikiReadService) ListCategories(ctx context.Context, eid int64, libraryIDs []int64) ([]ExternalWikiCategory, error) {
	if err := s.ensureReady(); err != nil {
		return nil, err
	}
	if err := validateExternalWikiScope(eid, libraryIDs); err != nil {
		return nil, err
	}

	type categoryRow struct {
		ID               int64
		SpaceID          int64
		Name             string
		Slug             string
		Description      string
		TargetEntityType string
		Sort             int64
		PageCount        int64
	}
	var rows []categoryRow
	spaceIDs := s.db.WithContext(ctx).Model(&model.Library{}).
		Select("space_id").Where("eid = ? AND id IN ?", eid, libraryIDs)
	if err := s.db.WithContext(ctx).Table("wiki_categories AS wc").
		Select("wc.id, wc.space_id, wc.name, wc.slug, wc.description, wc.target_entity_type, wc.sort").
		Where("wc.eid = ? AND wc.status = ? AND wc.space_id IN (?)", eid, model.WikiCategoryStatusEnabled, spaceIDs).
		Order("wc.sort ASC, wc.id ASC").Scan(&rows).Error; err != nil {
		return nil, err
	}

	pageCountRows := []struct {
		CategoryID int64
		PageCount  int64
	}{}
	visiblePages := s.visiblePageQuery(ctx, eid, libraryIDs)
	if err := s.db.WithContext(ctx).Table("wiki_page_categories AS wpc").
		Select("wpc.category_id, COUNT(DISTINCT wpc.page_id) AS page_count").
		Joins("JOIN (?) AS visible_pages ON visible_pages.id = wpc.page_id", visiblePages).
		Where("wpc.eid = ?", eid).
		Group("wpc.category_id").Scan(&pageCountRows).Error; err != nil {
		return nil, err
	}
	pageCounts := make(map[int64]int64, len(pageCountRows))
	for _, row := range pageCountRows {
		pageCounts[row.CategoryID] = row.PageCount
	}

	items := make([]ExternalWikiCategory, 0, len(rows)+1)
	for _, row := range rows {
		items = append(items, ExternalWikiCategory{
			ID: row.ID, Name: row.Name, Slug: row.Slug, Description: row.Description,
			TargetEntityType: row.TargetEntityType, Sort: row.Sort, PageCount: pageCounts[row.ID],
		})
	}
	otherQuery := s.visiblePageQuery(ctx, eid, libraryIDs).Where("NOT EXISTS (?)", s.db.WithContext(ctx).Model(&model.WikiPageCategory{}).
		Select("1").Where("eid = ? AND page_id = wiki_pages.id", eid))
	var otherCount int64
	if err := otherQuery.Count(&otherCount).Error; err != nil {
		return nil, err
	}
	if otherCount > 0 {
		items = append(items, ExternalWikiCategory{ID: 0, Name: "其他", Slug: "other", PageCount: otherCount, IsVirtual: true})
	}
	return items, nil
}

func (s *externalWikiReadService) loadExternalWikiCategories(ctx context.Context, eid int64, pageIDs []int64) (map[int64][]ExternalWikiCategory, error) {
	result := make(map[int64][]ExternalWikiCategory, len(pageIDs))
	if len(pageIDs) == 0 {
		return result, nil
	}
	type categoryRow struct {
		PageID           int64
		ID               int64
		Name             string
		Slug             string
		Description      string
		TargetEntityType string
		Sort             int64
	}
	var rows []categoryRow
	if err := s.db.WithContext(ctx).Table("wiki_page_categories AS wpc").
		Select("wpc.page_id, wc.id, wc.name, wc.slug, wc.description, wc.target_entity_type, wc.sort").
		Joins("JOIN wiki_categories AS wc ON wc.id = wpc.category_id AND wc.eid = wpc.eid AND wc.space_id = wpc.space_id").
		Where("wpc.eid = ? AND wpc.page_id IN ? AND wc.status = ?", eid, pageIDs, model.WikiCategoryStatusEnabled).
		Order("wpc.page_id ASC, wc.sort ASC, wc.id ASC").Scan(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		result[row.PageID] = append(result[row.PageID], ExternalWikiCategory{
			ID: row.ID, Name: row.Name, Slug: row.Slug, Description: row.Description,
			TargetEntityType: row.TargetEntityType, Sort: row.Sort,
		})
	}
	for _, pageID := range pageIDs {
		if result[pageID] == nil {
			result[pageID] = []ExternalWikiCategory{}
		}
	}
	return result, nil
}

func (s *externalWikiReadService) populateExternalWikiPageCategories(ctx context.Context, eid int64, pages []model.WikiPage, items []ExternalWikiPage) error {
	pageIDs := make([]int64, 0, len(pages))
	for _, page := range pages {
		pageIDs = append(pageIDs, page.ID)
	}
	categoryByPage, err := s.loadExternalWikiCategories(ctx, eid, pageIDs)
	if err != nil {
		return err
	}
	for i := range items {
		items[i].Categories = categoryByPage[items[i].ID]
	}
	return nil
}

func (s *externalWikiReadService) loadExternalWikiSources(ctx context.Context, eid int64, libraryIDs []int64, pageID int64) ([]ExternalWikiSource, error) {
	var sources []model.WikiPageSource
	if err := s.db.WithContext(ctx).Where("eid = ? AND page_id = ?", eid, pageID).Order("id ASC").Find(&sources).Error; err != nil {
		return nil, err
	}
	fileIDs := make([]int64, 0, len(sources))
	seenFileIDs := make(map[int64]struct{}, len(sources))
	for _, source := range sources {
		if source.SourceFileID > 0 {
			if _, ok := seenFileIDs[source.SourceFileID]; !ok {
				fileIDs = append(fileIDs, source.SourceFileID)
				seenFileIDs[source.SourceFileID] = struct{}{}
			}
		}
	}
	fileInfo := make(map[int64]model.File, len(fileIDs))
	if len(fileIDs) > 0 {
		var files []model.File
		if err := s.db.WithContext(ctx).
			Where("eid = ? AND id IN ? AND library_id IN ? AND is_deleted = ? AND is_active_deleted = ?", eid, fileIDs, libraryIDs, false, false).
			Find(&files).Error; err != nil {
			return nil, err
		}
		for _, file := range files {
			fileInfo[file.ID] = file
		}
	}

	items := make([]ExternalWikiSource, 0, len(sources))
	for _, source := range sources {
		file, hasFile := fileInfo[source.SourceFileID]
		if source.SourceFileID > 0 && !hasFile {
			continue
		}
		item := ExternalWikiSource{
			ID: source.ID, SourceKind: source.SourceKind, SourceRef: source.SourceRef,
			SourceFileID: source.SourceFileID, SourceChunkID: source.SourceChunkID,
			SourceSlug: source.SourceSlug, SourceLocation: source.SourceLocation,
			SourceURL: source.SourceURL, ExternalID: source.ExternalID,
			LastSyncedTime: source.LastSyncedTime,
		}
		if hasFile {
			item.FileLibraryID = file.LibraryID
			item.FileName = filepath.Base(file.Path)
		}
		items = append(items, item)
	}
	return items, nil
}

func (s *externalWikiReadService) loadExternalWikiLinks(ctx context.Context, eid int64, libraryIDs []int64, pageID int64, outgoing bool) ([]ExternalWikiLink, error) {
	var links []model.WikiPageLink
	whereColumn := "from_page_id"
	if !outgoing {
		whereColumn = "to_page_id"
	}
	if err := s.db.WithContext(ctx).Where("eid = ? AND "+whereColumn+" = ?", eid, pageID).Order("id ASC").Find(&links).Error; err != nil {
		return nil, err
	}
	relatedIDs := make([]int64, 0, len(links))
	for _, link := range links {
		relatedID := link.ToPageID
		if !outgoing {
			relatedID = link.FromPageID
		}
		if relatedID > 0 {
			relatedIDs = append(relatedIDs, relatedID)
		}
	}
	relatedPages := make(map[int64]model.WikiPage, len(relatedIDs))
	if len(relatedIDs) > 0 {
		var pages []model.WikiPage
		if err := s.visiblePageQuery(ctx, eid, libraryIDs).Where("id IN ?", relatedIDs).Find(&pages).Error; err != nil {
			return nil, err
		}
		for _, page := range pages {
			relatedPages[page.ID] = page
		}
	}

	items := make([]ExternalWikiLink, 0, len(links))
	for _, link := range links {
		relatedID := link.ToPageID
		if !outgoing {
			relatedID = link.FromPageID
		}
		relatedPage, visible := relatedPages[relatedID]
		if relatedID > 0 && !visible {
			continue
		}
		item := ExternalWikiLink{
			ID: link.ID, RelatedPageID: relatedID, LinkKind: link.LinkKind,
			AnchorText: link.AnchorText, TargetSlug: link.TargetSlug,
		}
		if visible {
			item.RelatedPageSlug = relatedPage.Slug
			item.RelatedPageTitle = relatedPage.Title
			item.RelatedPageType = relatedPage.PageType
		}
		items = append(items, item)
	}
	return items, nil
}

func (s *externalWikiReadService) visiblePageQuery(ctx context.Context, eid int64, libraryIDs []int64) *gorm.DB {
	publishedVersionIDs := s.db.WithContext(ctx).Model(&model.WikiPageVersion{}).
		Select("id").Where("eid = ? AND is_published = ?", eid, true)
	return s.db.WithContext(ctx).Model(&model.WikiPage{}).
		Where("eid = ? AND library_id IN ? AND status = ?", eid, libraryIDs, model.WikiPageStatusActive).
		Where("visibility <> ?", model.WikiPageVisibilityPrivate).
		Where("current_version_id IN (?)", publishedVersionIDs)
}

// ResolveLibraryScope 根据 API Key 的绑定范围解析可访问的知识库 ID 列表。
// 绑定知识库时返回该知识库；绑定空间时返回该空间下所有活跃知识库。
func (s *externalWikiReadService) ResolveLibraryScope(ctx context.Context, eid int64, libraryID, spaceID *int64) ([]int64, error) {
	if err := s.ensureReady(); err != nil {
		return nil, err
	}
	if eid <= 0 {
		return nil, errors.New("external wiki scope is required")
	}
	if libraryID != nil && *libraryID > 0 {
		return []int64{*libraryID}, nil
	}
	if spaceID != nil && *spaceID > 0 {
		var libraries []model.Library
		if err := s.db.WithContext(ctx).Model(&model.Library{}).
			Where("eid = ? AND space_id = ? AND status = ?", eid, *spaceID, model.LIBRARY_STATUS_ACTIVE).
			Order("sort ASC, id ASC").Find(&libraries).Error; err != nil {
			return nil, err
		}
		ids := make([]int64, 0, len(libraries))
		for _, library := range libraries {
			ids = append(ids, library.ID)
		}
		return ids, nil
	}
	return nil, errors.New("external wiki scope is required")
}

func (s *externalWikiReadService) loadCurrentPublishedVersions(ctx context.Context, eid int64, pages []model.WikiPage) (map[int64]model.WikiPageVersion, error) {
	versions := make(map[int64]model.WikiPageVersion, len(pages))
	if len(pages) == 0 {
		return versions, nil
	}

	pageIDs := make([]int64, 0, len(pages))
	for _, page := range pages {
		pageIDs = append(pageIDs, page.ID)
	}

	var rows []model.WikiPageVersion
	if err := s.db.WithContext(ctx).
		Where("eid = ? AND page_id IN ? AND is_published = ?", eid, pageIDs, true).
		Find(&rows).Error; err != nil {
		return nil, err
	}

	currentVersionIDs := make(map[int64]int64, len(pages))
	for _, page := range pages {
		currentVersionIDs[page.ID] = page.CurrentVersionID
	}
	for _, version := range rows {
		if currentVersionIDs[version.PageID] == version.ID {
			versions[version.PageID] = version
		}
	}
	return versions, nil
}

func buildExternalWikiPage(page model.WikiPage, version model.WikiPageVersion, includeBody bool) ExternalWikiPage {
	result := ExternalWikiPage{
		ID:            page.ID,
		SpaceID:       page.SpaceID,
		LibraryID:     page.LibraryID,
		FolderID:      page.FolderID,
		Title:         page.Title,
		Slug:          page.Slug,
		PageType:      page.PageType,
		Summary:       page.Summary,
		Aliases:       page.Aliases,
		Status:        page.Status,
		Visibility:    page.Visibility,
		CreatedTime:   page.CreatedTime,
		UpdatedTime:   page.UpdatedTime,
		VersionNo:     version.VersionNo,
		VersionTag:    version.VersionTag,
		PublishedTime: version.PublishedTime,
	}
	if includeBody {
		result.Body = version.Body
		result.BodyFormat = version.BodyFormat
	}
	return result
}

func (s *externalWikiReadService) ensureReady() error {
	if s == nil || s.db == nil {
		return errors.New("external wiki read database is required")
	}
	return nil
}

func externalWikiPageIDs(pages []model.WikiPage) []int64 {
	ids := make([]int64, 0, len(pages))
	for _, page := range pages {
		ids = append(ids, page.ID)
	}
	return ids
}

func applyExternalWikiPageFilters(query *gorm.DB, keyword, pageType string, categoryID int64, categoryOther bool) *gorm.DB {
	keyword = strings.TrimSpace(keyword)
	if keyword != "" {
		like := "%" + strings.ToLower(keyword) + "%"
		query = query.Where("(lower(title) LIKE ? OR lower(slug) LIKE ? OR lower(summary) LIKE ?)", like, like, like)
	}
	if pageType = strings.TrimSpace(pageType); pageType != "" {
		query = query.Where("page_type = ?", pageType)
	}
	if categoryOther {
		query = query.Where("NOT EXISTS (?)", query.Session(&gorm.Session{}).Model(&model.WikiPageCategory{}).
			Select("1").Where("eid = wiki_pages.eid AND page_id = wiki_pages.id"))
	} else if categoryID > 0 {
		query = query.Where("EXISTS (?)", query.Session(&gorm.Session{}).Model(&model.WikiPageCategory{}).
			Select("1").Where("eid = wiki_pages.eid AND category_id = ? AND page_id = wiki_pages.id", categoryID))
	}
	return query
}

func validateExternalWikiScope(eid int64, libraryIDs []int64) error {
	if eid <= 0 || len(libraryIDs) == 0 {
		return errors.New("external wiki scope is required")
	}
	for _, libraryID := range libraryIDs {
		if libraryID <= 0 {
			return errors.New("external wiki scope is required")
		}
	}
	return nil
}

func normalizeExternalWikiLimit(limit int) int {
	if limit <= 0 {
		return 20
	}
	if limit > 100 {
		return 100
	}
	return limit
}

func externalWikiSnippet(body, query string) string {
	clean := strings.Join(strings.Fields(body), " ")
	if clean == "" {
		return ""
	}
	const maxRunes = 240
	runes := []rune(clean)
	if len(runes) <= maxRunes {
		return clean
	}

	queryIndex := strings.Index(strings.ToLower(clean), strings.ToLower(query))
	if queryIndex < 0 {
		return string(runes[:maxRunes])
	}
	runeIndex := utf8.RuneCountInString(clean[:queryIndex])
	start := runeIndex - 80
	if start < 0 {
		start = 0
	}
	end := start + maxRunes
	if end > len(runes) {
		end = len(runes)
		start = end - maxRunes
		if start < 0 {
			start = 0
		}
	}
	return string(runes[start:end])
}

var _ ExternalWikiReadService = (*externalWikiReadService)(nil)
