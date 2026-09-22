package service

import (
	"context"
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

var ErrExternalWikiPageNotFound = errors.New("external wiki page not found")
var ErrExternalWikiQueryRequired = errors.New("external wiki query required")

type ExternalWikiListRequest struct {
	Eid        int64
	LibraryIDs []int64
	Keyword    string
	PageType   string
	Offset     int
	Limit      int
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
}

type ExternalWikiReadService interface {
	ResolveLibraryScope(ctx context.Context, eid int64, libraryID, spaceID *int64) ([]int64, error)
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
	query = applyExternalWikiPageFilters(query, req.Keyword, req.PageType)

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

	return &ExternalWikiSearchResponse{Items: items, Total: total}, nil
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

func applyExternalWikiPageFilters(query *gorm.DB, keyword, pageType string) *gorm.DB {
	keyword = strings.TrimSpace(keyword)
	if keyword != "" {
		like := "%" + strings.ToLower(keyword) + "%"
		query = query.Where("(lower(title) LIKE ? OR lower(slug) LIKE ? OR lower(summary) LIKE ?)", like, like, like)
	}
	if pageType = strings.TrimSpace(pageType); pageType != "" {
		query = query.Where("page_type = ?", pageType)
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
