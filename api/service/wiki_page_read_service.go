package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/model"
	"github.com/mozillazg/go-pinyin"
	"gorm.io/gorm"
)

var fileIDRefRegex = regexp.MustCompile(`file:(\d+)`)

type WikiPageReadService interface {
	ListPages(ctx context.Context, req WikiListPagesRequest) ([]WikiPageSummary, int64, error)
	GetPage(ctx context.Context, eid, libraryID int64, slug string) (*WikiPageDetail, error)
	GetIndex(ctx context.Context, eid, libraryID int64) (*WikiPageIndexView, error)
	GetGraph(ctx context.Context, req WikiGraphRequest) (*WikiGraphView, error)
	ListLogs(ctx context.Context, req WikiListLogsRequest) ([]WikiLogEntryDTO, int64, error)
	GetHealth(ctx context.Context, eid, libraryID int64) (*WikiHealthReport, error)
	ListVersions(ctx context.Context, req WikiListVersionsRequest) ([]WikiPageVersionDTO, int64, error)
	GetVersion(ctx context.Context, eid, pageID int64, versionNo int64, currentVersionID int64) (*WikiPageVersionDTO, error)
}

type wikiPageReadService struct {
	db *gorm.DB
}

func NewWikiPageReadService(db *gorm.DB) WikiPageReadService {
	return &wikiPageReadService{db: db}
}

type WikiListPagesRequest struct {
	Eid       int64
	LibraryID int64
	SpaceID   int64
	Keyword   string
	PageType  string
	Status    string
	SortBy    string
	Offset    int
	Limit     int
}

type WikiListLogsRequest struct {
	Eid       int64
	LibraryID int64
	PageID    int64
	Offset    int
	Limit     int
}

type WikiListVersionsRequest struct {
	Eid              int64
	PageID           int64
	Offset           int
	Limit            int
	IsPublished      *bool
	CurrentVersionID int64
}

type WikiPageSummary struct {
	ID               int64    `json:"id"`
	Eid              int64    `json:"eid"`
	LibraryID        int64    `json:"library_id"`
	FolderID         int64    `json:"folder_id"`
	FolderPath       string   `json:"folder_path,omitempty"`
	CurrentVersionID int64    `json:"current_version_id"`
	Title            string   `json:"title"`
	Slug             string   `json:"slug"`
	PageType         string   `json:"page_type"`
	Summary          string   `json:"summary"`
	Aliases          []string `json:"aliases,omitempty"`
	Status           string   `json:"status"`
	Visibility       string   `json:"visibility"`
	CreatorID        int64    `json:"creator_id"`
	UpdaterID        int64    `json:"updater_id"`
	Sort             int64    `json:"sort"`
	FirstLetter      string   `json:"first_letter"`
	CreatedTime      int64    `json:"created_time"`
	UpdatedTime      int64    `json:"updated_time"`
}

type WikiPageDetail struct {
	WikiPageSummary
	Body           string              `json:"body"`
	Content        string              `json:"-"`
	BodyFormat     string              `json:"body_format"`
	CurrentVersion *WikiPageVersionDTO `json:"current_version,omitempty"`
	Sources        []WikiPageSourceDTO `json:"sources,omitempty"`
	Links          []WikiPageLinkDTO   `json:"links,omitempty"`
	Backlinks      []WikiPageLinkDTO   `json:"backlinks,omitempty"`
}

type WikiPageSourceDTO struct {
	ID                int64  `json:"id"`
	Eid               int64  `json:"eid"`
	PageID            int64  `json:"page_id"`
	SourceKind        string `json:"source_kind"`
	SourceRef         string `json:"source_ref"`
	SourceFileID      int64  `json:"source_file_id"`
	SourceChunkID     int64  `json:"source_chunk_id"`
	SourceSlug        string `json:"source_slug"`
	SourceLocation    string `json:"source_location"`
	SourceContentHash string `json:"source_content_hash"`
	SourceURL         string `json:"source_url"`
	ExternalID        string `json:"external_id"`
	ExternalDigest    string `json:"external_digest"`
	MetaJSON          string `json:"meta_json"`
	LastSyncedTime    int64  `json:"last_synced_time"`
	CreatorID         int64  `json:"creator_id"`
	CreatedTime       int64  `json:"created_time"`
	UpdatedTime       int64  `json:"updated_time"`
	LibraryID         int64  `json:"library_id"`
	FileName          string `json:"file_name"`
}

type WikiPageLinkDTO struct {
	ID            int64  `json:"id"`
	Eid           int64  `json:"eid"`
	FromPageID    int64  `json:"from_page_id"`
	FromPageSlug  string `json:"from_page_slug,omitempty"`
	FromPageTitle string `json:"from_page_title,omitempty"`
	ToPageID      int64  `json:"to_page_id"`
	LinkKind      string `json:"link_kind"`
	AnchorText    string `json:"anchor_text"`
	TargetSlug    string `json:"target_slug"`
	CreatorID     int64  `json:"creator_id"`
	CreatedTime   int64  `json:"created_time"`
	UpdatedTime   int64  `json:"updated_time"`
}
type WikiPageVersionDTO struct {
	ID            int64               `json:"id"`
	Eid           int64               `json:"eid"`
	PageID        int64               `json:"page_id"`
	VersionNo     int64               `json:"version_no"`
	Title         string              `json:"title"`
	Slug          string              `json:"slug"`
	PageType      string              `json:"page_type"`
	Aliases       []string            `json:"aliases"`
	Sources       []WikiPageSourceDTO `json:"sources"`
	Links         []WikiPageLinkDTO   `json:"links"`
	Backlinks     []WikiPageLinkDTO   `json:"backlinks"`
	Body          string              `json:"body"`
	BodyFormat    string              `json:"body_format"`
	ChangeSummary string              `json:"change_summary"`
	Checksum      string              `json:"checksum"`
	SourceVersion string              `json:"source_version"`
	EditorID      int64               `json:"editor_id"`
	IsPublished   bool                `json:"is_published"`
	IsCurrent     bool                `json:"is_current"`
	PublishKind   string              `json:"publish_kind"`
	PublishedTime int64               `json:"published_time"`
	VersionTag    string              `json:"version_tag"`
	CreatedTime   int64               `json:"created_time"`
	UpdatedTime   int64               `json:"updated_time"`
}

type WikiLogEntryDTO struct {
	ID          int64  `json:"id"`
	Eid         int64  `json:"eid"`
	PageID      int64  `json:"page_id"`
	VersionID   int64  `json:"version_id"`
	ActorID     int64  `json:"actor_id"`
	Action      string `json:"action"`
	RequestID   string `json:"request_id"`
	Message     string `json:"message"`
	MetaJSON    string `json:"meta_json"`
	CreatedTime int64  `json:"created_time"`
	UpdatedTime int64  `json:"updated_time"`
}

type WikiPageIndexView struct {
	Eid                int64             `json:"eid"`
	LibraryID          int64             `json:"library_id"`
	TotalPages         int64             `json:"total_pages"`
	PageTypeCounts     map[string]int64  `json:"page_type_counts"`
	RecentSummaryPages []WikiPageSummary `json:"recent_summary_pages,omitempty"`
	RecentIndexPages   []WikiPageSummary `json:"recent_index_pages,omitempty"`
	IndexMarkdown      string            `json:"index_markdown,omitempty"`
}

type WikiHealthReport struct {
	Eid                        int64            `json:"eid"`
	LibraryID                  int64            `json:"library_id"`
	TotalPages                 int64            `json:"total_pages"`
	PagesMissingCurrentVersion int64            `json:"pages_missing_current_version"`
	DanglingLinks              int64            `json:"dangling_links"`
	PagesWithoutOutlinks       int64            `json:"pages_without_outlinks"`
	PageTypeCounts             map[string]int64 `json:"page_type_counts"`
}

type WikiGraphNodeDTO struct {
	ID          int64  `json:"id"`
	Eid         int64  `json:"eid"`
	LibraryID   int64  `json:"library_id"`
	FolderID    int64  `json:"folder_id"`
	FolderPath  string `json:"folder_path,omitempty"`
	Title       string `json:"title"`
	Slug        string `json:"slug"`
	PageType    string `json:"page_type"`
	Summary     string `json:"summary"`
	Status      string `json:"status"`
	LinkCount   int64  `json:"link_count"`
	UpdatedTime int64  `json:"updated_time"`
}

type WikiGraphEdgeDTO struct {
	ID         int64  `json:"id"`
	FromPageID int64  `json:"from_page_id"`
	ToPageID   int64  `json:"to_page_id"`
	LinkKind   string `json:"link_kind"`
	AnchorText string `json:"anchor_text"`
	TargetSlug string `json:"target_slug"`
	Dangling   bool   `json:"dangling"`
}

type WikiGraphView struct {
	Eid            int64              `json:"eid"`
	LibraryID      int64              `json:"library_id"`
	TotalPages     int64              `json:"total_pages"`
	PageTypeCounts map[string]int64   `json:"page_type_counts"`
	Nodes          []WikiGraphNodeDTO `json:"nodes"`
	Edges          []WikiGraphEdgeDTO `json:"edges"`
	DanglingLinks  int64              `json:"dangling_links"`
	Meta           WikiGraphMeta      `json:"meta"`
}

type WikiGraphMeta struct {
	Mode      string `json:"mode"`
	Total     int64  `json:"total"`
	Returned  int64  `json:"returned"`
	Truncated bool   `json:"truncated"`
	Center    string `json:"center,omitempty"`
	Depth     int    `json:"depth,omitempty"`
}

type WikiGraphRequest struct {
	Eid       int64
	LibraryID int64
	Mode      string
	Center    string
	Depth     int
	Types     []string
	Limit     int
}

func (s *wikiPageReadService) ListPages(ctx context.Context, req WikiListPagesRequest) ([]WikiPageSummary, int64, error) {
	if s == nil || s.db == nil {
		return nil, 0, fmt.Errorf("wiki read db is required")
	}
	if req.Eid <= 0 {
		return nil, 0, fmt.Errorf("eid is required")
	}

	limit := normalizeWikiListLimit(req.Limit, 20, 100)
	offset := req.Offset
	if offset < 0 {
		offset = 0
	}

	base := s.db.WithContext(ctx).Model(&model.WikiPage{}).Where("eid = ?", req.Eid)
	if req.LibraryID > 0 {
		base = base.Where("library_id = ?", req.LibraryID)
	}
	if req.SpaceID > 0 {
		base = base.Where("space_id = ?", req.SpaceID)
	}
	base = applyWikiPageListFilters(base, req.Keyword, req.PageType, req.Status)

	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var pages []model.WikiPage
	orderClause := "sort ASC, id ASC"
	switch req.SortBy {
	case "title":
		orderClause = "title ASC"
	case "created_time":
		orderClause = "created_time DESC"
	case "updated_time":
		orderClause = "updated_time DESC"
	}
	if err := base.Order(orderClause).Offset(offset).Limit(limit).Find(&pages).Error; err != nil {
		return nil, 0, err
	}

	folderPaths, err := s.loadFolderPathMap(ctx, pages)
	if err != nil {
		return nil, 0, err
	}
	items := make([]WikiPageSummary, 0, len(pages))
	for i := range pages {
		items = append(items, toWikiPageSummary(&pages[i], folderPaths[pages[i].FolderID]))
	}
	return items, total, nil
}

func (s *wikiPageReadService) GetPage(ctx context.Context, eid, libraryID int64, slug string) (*WikiPageDetail, error) {
	if s == nil || s.db == nil {
		return nil, fmt.Errorf("wiki read db is required")
	}
	if eid <= 0 || libraryID <= 0 || strings.TrimSpace(slug) == "" {
		return nil, fmt.Errorf("eid, library_id and slug are required")
	}

	var page model.WikiPage
	if err := s.db.WithContext(ctx).Where("eid = ? AND library_id = ? AND slug = ?", eid, libraryID, slug).First(&page).Error; err != nil {
		return nil, err
	}

	folderPaths, err := s.loadFolderPathMap(ctx, []model.WikiPage{page})
	if err != nil {
		return nil, err
	}
	currentVersion, err := s.loadCurrentVersion(ctx, &page)
	if err != nil {
		return nil, err
	}
	sources, err := s.loadPageSources(ctx, page.ID)
	if err != nil {
		return nil, err
	}
	links, err := s.loadPageLinks(ctx, page.ID)
	if err != nil {
		return nil, err
	}
	backlinks, err := s.loadPageBacklinks(ctx, page.ID)
	if err != nil {
		return nil, err
	}

	detail := &WikiPageDetail{
		WikiPageSummary: toWikiPageSummary(&page, folderPaths[page.FolderID]),
		Body:            replaceFileIDRefs(page.Body),
		BodyFormat:      page.BodyFormat,
		Sources:         replaceSourcesFileIDRefs(sources),
		Links:           links,
		Backlinks:       backlinks,
	}
	if currentVersion != nil {
		detail.CurrentVersion = currentVersion
		if strings.TrimSpace(detail.Body) == "" && strings.TrimSpace(currentVersion.Body) != "" {
			detail.Body = currentVersion.Body
		}
	}

	return detail, nil
}

func (s *wikiPageReadService) GetIndex(ctx context.Context, eid, libraryID int64) (*WikiPageIndexView, error) {
	if s == nil || s.db == nil {
		return nil, fmt.Errorf("wiki read db is required")
	}
	if eid <= 0 || libraryID <= 0 {
		return nil, fmt.Errorf("eid and library_id are required")
	}

	view := &WikiPageIndexView{
		Eid:            eid,
		LibraryID:      libraryID,
		PageTypeCounts: make(map[string]int64),
	}

	countQuery := s.db.WithContext(ctx).Model(&model.WikiPage{}).
		Where("eid = ? AND library_id = ? AND status = ?", eid, libraryID, model.WikiPageStatusActive)
	if err := countQuery.Count(&view.TotalPages).Error; err != nil {
		return nil, err
	}

	var typeCounts []struct {
		PageType string
		Count    int64
	}
	typeQuery := s.db.WithContext(ctx).Model(&model.WikiPage{}).
		Where("eid = ? AND library_id = ? AND status = ?", eid, libraryID, model.WikiPageStatusActive)
	if err := typeQuery.Select("page_type, COUNT(*) AS count").Group("page_type").Scan(&typeCounts).Error; err != nil {
		return nil, err
	}
	for _, row := range typeCounts {
		view.PageTypeCounts[row.PageType] = row.Count
	}

	if err := s.loadRecentPagesByType(ctx, eid, libraryID, model.WikiPageTypeSummary, &view.RecentSummaryPages); err != nil {
		return nil, err
	}
	if err := s.loadRecentPagesByType(ctx, eid, libraryID, model.WikiPageTypeIndex, &view.RecentIndexPages); err != nil {
		return nil, err
	}

	var allPages []model.WikiPage
	listQuery := s.db.WithContext(ctx).Model(&model.WikiPage{}).
		Where("eid = ? AND library_id = ? AND status = ?", eid, libraryID, model.WikiPageStatusActive)
	if err := listQuery.Order("sort ASC, id ASC").Find(&allPages).Error; err != nil {
		return nil, err
	}
	intro, err := s.loadIndexIntroMarkdown(ctx, eid, libraryID)
	if err != nil {
		return nil, err
	}
	if len(allPages) > 0 || strings.TrimSpace(intro) != "" {
		folderPaths, err := s.loadFolderPathMap(ctx, allPages)
		if err != nil {
			return nil, err
		}
		view.IndexMarkdown = NewWikiIndexService().BuildIndexMarkdownWithFoldersAndIntro(allPages, folderPaths, intro)
	}

	return view, nil
}

func (s *wikiPageReadService) GetGraph(ctx context.Context, req WikiGraphRequest) (*WikiGraphView, error) {
	if s == nil || s.db == nil {
		return nil, fmt.Errorf("wiki read db is required")
	}
	if req.Eid <= 0 || req.LibraryID <= 0 {
		return nil, fmt.Errorf("eid and library_id are required")
	}
	mode := normalizeWikiGraphMode(req.Mode)
	center := strings.TrimSpace(req.Center)
	depth := normalizeWikiGraphDepth(req.Depth)
	limit := normalizeWikiGraphLimit(req.Limit)
	typeFilter := normalizeWikiGraphTypes(req.Types)
	if mode == "ego" && center == "" {
		return nil, fmt.Errorf("center is required when mode=ego")
	}

	view := &WikiGraphView{
		Eid:            req.Eid,
		LibraryID:      req.LibraryID,
		PageTypeCounts: make(map[string]int64),
		Meta: WikiGraphMeta{
			Mode:   mode,
			Center: center,
			Depth:  depth,
		},
	}

	base := s.db.WithContext(ctx).Model(&model.WikiPage{}).
		Where("eid = ? AND library_id = ? AND status = ?", req.Eid, req.LibraryID, model.WikiPageStatusActive)
	if len(typeFilter) > 0 {
		base = base.Where("page_type IN ?", typeFilter)
	}
	if err := base.Count(&view.TotalPages).Error; err != nil {
		return nil, err
	}

	var pages []model.WikiPage
	if err := base.Find(&pages).Error; err != nil {
		return nil, err
	}
	sort.SliceStable(pages, func(i, j int) bool {
		if pages[i].Sort != pages[j].Sort {
			return pages[i].Sort < pages[j].Sort
		}
		return pages[i].ID < pages[j].ID
	})

	pageByID := make(map[int64]model.WikiPage, len(pages))
	pageBySlug := make(map[string]model.WikiPage, len(pages))
	pageSet := make(map[int64]struct{}, len(pages))
	for i := range pages {
		page := pages[i]
		pageByID[page.ID] = page
		pageBySlug[page.Slug] = page
		pageSet[page.ID] = struct{}{}
		view.PageTypeCounts[page.PageType]++
	}

	var links []model.WikiPageLink
	if err := s.db.WithContext(ctx).Where("eid = ?", req.Eid).Order("id ASC").Find(&links).Error; err != nil {
		return nil, err
	}

	adjacency := make(map[int64]map[int64]struct{}, len(pageSet))
	linkCounts := make(map[int64]int64, len(pageSet))
	for i := range links {
		link := links[i]
		if _, ok := pageSet[link.FromPageID]; !ok {
			continue
		}
		if link.ToPageID > 0 {
			if _, ok := pageSet[link.ToPageID]; !ok {
				// 目标页不在当前库的活跃页面集合中，保留为断链。
			} else {
				if _, ok := adjacency[link.ToPageID]; !ok {
					adjacency[link.ToPageID] = make(map[int64]struct{})
				}
				adjacency[link.ToPageID][link.FromPageID] = struct{}{}
			}
		}
		if _, ok := adjacency[link.FromPageID]; !ok {
			adjacency[link.FromPageID] = make(map[int64]struct{})
		}
		if link.ToPageID > 0 {
			adjacency[link.FromPageID][link.ToPageID] = struct{}{}
		}
		linkCounts[link.FromPageID]++
		if link.ToPageID > 0 {
			linkCounts[link.ToPageID]++
		}
	}

	selectedIDs := make([]int64, 0, len(pageSet))
	switch mode {
	case "ego":
		centerPage, ok := pageBySlug[center]
		if !ok {
			return nil, fmt.Errorf("center page not found")
		}
		centerID := centerPage.ID
		selected := bfsWikiGraphPages(centerPage.ID, adjacency, depth)
		for id := range selected {
			if _, ok := pageSet[id]; ok {
				selectedIDs = append(selectedIDs, id)
			}
		}
		sort.SliceStable(selectedIDs, func(i, j int) bool {
			if selectedIDs[i] == centerID {
				return true
			}
			if selectedIDs[j] == centerID {
				return false
			}
			if linkCounts[selectedIDs[i]] != linkCounts[selectedIDs[j]] {
				return linkCounts[selectedIDs[i]] > linkCounts[selectedIDs[j]]
			}
			return selectedIDs[i] < selectedIDs[j]
		})
	default:
		for id := range pageSet {
			selectedIDs = append(selectedIDs, id)
		}
		sort.SliceStable(selectedIDs, func(i, j int) bool {
			if linkCounts[selectedIDs[i]] != linkCounts[selectedIDs[j]] {
				return linkCounts[selectedIDs[i]] > linkCounts[selectedIDs[j]]
			}
			left, right := pageByID[selectedIDs[i]], pageByID[selectedIDs[j]]
			if left.Sort != right.Sort {
				return left.Sort < right.Sort
			}
			return left.ID < right.ID
		})
	}

	view.Meta.Total = int64(len(selectedIDs))
	if limit > 0 && len(selectedIDs) > limit {
		selectedIDs = selectedIDs[:limit]
		view.Meta.Truncated = true
	}
	view.Meta.Returned = int64(len(selectedIDs))
	view.TotalPages = view.Meta.Total

	selectedSet := make(map[int64]struct{}, len(selectedIDs))
	for _, id := range selectedIDs {
		selectedSet[id] = struct{}{}
	}

	folderPaths, err := s.loadFolderPathMap(ctx, pages)
	if err != nil {
		return nil, err
	}
	nodes := make([]WikiGraphNodeDTO, 0, len(selectedIDs))
	for _, id := range selectedIDs {
		page := pageByID[id]
		nodes = append(nodes, WikiGraphNodeDTO{
			ID:          page.ID,
			Eid:         page.Eid,
			LibraryID:   page.LibraryID,
			FolderID:    page.FolderID,
			FolderPath:  folderPaths[page.FolderID],
			Title:       page.Title,
			Slug:        page.Slug,
			PageType:    page.PageType,
			Summary:     page.Summary,
			Status:      page.Status,
			LinkCount:   linkCounts[page.ID],
			UpdatedTime: page.UpdatedTime,
		})
	}
	view.Nodes = nodes

	edges := make([]WikiGraphEdgeDTO, 0, len(links))
	for i := range links {
		link := &links[i]
		if _, ok := selectedSet[link.FromPageID]; !ok {
			continue
		}
		if link.ToPageID > 0 {
			if _, ok := pageSet[link.ToPageID]; ok {
				if _, ok := selectedSet[link.ToPageID]; !ok {
					continue
				}
			} else {
				// 保留断链边，不要求目标页也在当前选中集合中。
			}
		}
		dangling := link.ToPageID <= 0
		if !dangling {
			if _, ok := pageSet[link.ToPageID]; !ok {
				dangling = true
			}
		}
		if dangling {
			view.DanglingLinks++
		}
		edges = append(edges, WikiGraphEdgeDTO{
			ID:         link.ID,
			FromPageID: link.FromPageID,
			ToPageID:   link.ToPageID,
			LinkKind:   link.LinkKind,
			AnchorText: link.AnchorText,
			TargetSlug: link.TargetSlug,
			Dangling:   dangling,
		})
	}
	view.Edges = edges

	return view, nil
}

func normalizeWikiGraphMode(mode string) string {
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case "ego":
		return "ego"
	default:
		return "overview"
	}
}

func normalizeWikiGraphDepth(depth int) int {
	switch {
	case depth <= 0:
		return 1
	case depth > 3:
		return 3
	default:
		return depth
	}
}

func normalizeWikiGraphLimit(limit int) int {
	switch {
	case limit <= 0:
		return 500
	case limit > 2000:
		return 2000
	default:
		return limit
	}
}

func normalizeWikiGraphTypes(types []string) []string {
	if len(types) == 0 {
		return nil
	}
	result := make([]string, 0, len(types))
	seen := make(map[string]struct{}, len(types))
	for _, raw := range types {
		value := strings.TrimSpace(raw)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

func bfsWikiGraphPages(centerID int64, adjacency map[int64]map[int64]struct{}, depth int) map[int64]struct{} {
	selected := map[int64]struct{}{centerID: struct{}{}}
	if depth <= 0 {
		return selected
	}

	visited := map[int64]struct{}{centerID: struct{}{}}
	frontier := []int64{centerID}
	for level := 0; level < depth && len(frontier) > 0; level++ {
		next := make([]int64, 0)
		for _, id := range frontier {
			for neighbor := range adjacency[id] {
				if _, ok := visited[neighbor]; ok {
					continue
				}
				visited[neighbor] = struct{}{}
				selected[neighbor] = struct{}{}
				next = append(next, neighbor)
			}
		}
		frontier = next
	}
	return selected
}

func (s *wikiPageReadService) ListLogs(ctx context.Context, req WikiListLogsRequest) ([]WikiLogEntryDTO, int64, error) {
	if s == nil || s.db == nil {
		return nil, 0, fmt.Errorf("wiki read db is required")
	}
	if req.Eid <= 0 || req.LibraryID <= 0 {
		return nil, 0, fmt.Errorf("eid and library_id are required")
	}

	limit := normalizeWikiListLimit(req.Limit, 20, 100)
	offset := req.Offset
	if offset < 0 {
		offset = 0
	}

	pageIDsQuery := s.db.WithContext(ctx).Model(&model.WikiPage{}).
		Select("id").
		Where("eid = ? AND library_id = ?", req.Eid, req.LibraryID)
	base := s.db.WithContext(ctx).Model(&model.WikiLogEntry{}).
		Where("eid = ?", req.Eid)
	if req.PageID > 0 {
		var page model.WikiPage
		if err := s.db.WithContext(ctx).
			Where("eid = ? AND library_id = ? AND id = ?", req.Eid, req.LibraryID, req.PageID).
			First(&page).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return []WikiLogEntryDTO{}, 0, nil
			}
			return nil, 0, err
		}
		base = base.Where("page_id = ?", req.PageID)
	} else {
		base = base.Where("page_id IN (?)", pageIDsQuery)
	}

	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var logs []model.WikiLogEntry
	if err := base.Order("created_time DESC, id DESC").Offset(offset).Limit(limit).Find(&logs).Error; err != nil {
		return nil, 0, err
	}

	items := make([]WikiLogEntryDTO, 0, len(logs))
	for i := range logs {
		items = append(items, toWikiLogEntryDTO(&logs[i]))
	}
	return items, total, nil
}

func (s *wikiPageReadService) GetHealth(ctx context.Context, eid, libraryID int64) (*WikiHealthReport, error) {
	if s == nil || s.db == nil {
		return nil, fmt.Errorf("wiki read db is required")
	}
	if eid <= 0 || libraryID <= 0 {
		return nil, fmt.Errorf("eid and library_id are required")
	}

	report := &WikiHealthReport{
		Eid:            eid,
		LibraryID:      libraryID,
		PageTypeCounts: make(map[string]int64),
	}

	countQuery := s.db.WithContext(ctx).Model(&model.WikiPage{}).
		Where("eid = ? AND library_id = ? AND status = ?", eid, libraryID, model.WikiPageStatusActive)
	if err := countQuery.Count(&report.TotalPages).Error; err != nil {
		return nil, err
	}

	missingVersionQuery := s.db.WithContext(ctx).Model(&model.WikiPage{}).
		Where("eid = ? AND library_id = ? AND status = ? AND current_version_id = 0", eid, libraryID, model.WikiPageStatusActive)
	if err := missingVersionQuery.Count(&report.PagesMissingCurrentVersion).Error; err != nil {
		return nil, err
	}

	var typeCounts []struct {
		PageType string
		Count    int64
	}
	typeQuery := s.db.WithContext(ctx).Model(&model.WikiPage{}).
		Where("eid = ? AND library_id = ? AND status = ?", eid, libraryID, model.WikiPageStatusActive)
	if err := typeQuery.Select("page_type, COUNT(*) AS count").Group("page_type").Scan(&typeCounts).Error; err != nil {
		return nil, err
	}
	for _, row := range typeCounts {
		report.PageTypeCounts[row.PageType] = row.Count
	}

	pageIDsQuery := s.db.WithContext(ctx).Model(&model.WikiPage{}).
		Select("id").
		Where("eid = ? AND library_id = ? AND status = ?", eid, libraryID, model.WikiPageStatusActive)
	if err := s.db.WithContext(ctx).Model(&model.WikiPageLink{}).
		Where("eid = ?", eid).
		Where("from_page_id IN (?)", pageIDsQuery).
		Where("to_page_id = 0 OR to_page_id NOT IN (?)", pageIDsQuery).
		Count(&report.DanglingLinks).Error; err != nil {
		return nil, err
	}

	var pagesWithOutlinks int64
	if err := s.db.WithContext(ctx).Model(&model.WikiPageLink{}).
		Where("eid = ?", eid).
		Where("from_page_id IN (?)", pageIDsQuery).
		Distinct("from_page_id").
		Count(&pagesWithOutlinks).Error; err != nil {
		return nil, err
	}
	if report.TotalPages >= pagesWithOutlinks {
		report.PagesWithoutOutlinks = report.TotalPages - pagesWithOutlinks
	}

	return report, nil
}

func (s *wikiPageReadService) ListVersions(ctx context.Context, req WikiListVersionsRequest) ([]WikiPageVersionDTO, int64, error) {
	if s == nil || s.db == nil {
		return nil, 0, fmt.Errorf("wiki read db is required")
	}
	if req.Eid <= 0 || req.PageID <= 0 {
		return nil, 0, fmt.Errorf("eid and page_id are required")
	}

	var total int64
	baseQuery := s.db.WithContext(ctx).Model(&model.WikiPageVersion{}).Where("eid = ? AND page_id = ?", req.Eid, req.PageID)
	if req.IsPublished != nil {
		baseQuery = baseQuery.Where("is_published = ?", *req.IsPublished)
		if *req.IsPublished {
			baseQuery = baseQuery.Where("TRIM(version_tag) <> ''")
		}
	}
	if err := baseQuery.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if total == 0 {
		return []WikiPageVersionDTO{}, 0, nil
	}

	var versions []model.WikiPageVersion
	offset := req.Offset
	if offset < 0 {
		offset = 0
	}
	limit := req.Limit
	if limit <= 0 {
		limit = 20
	}
	if err := baseQuery.Order("version_no DESC").Offset(offset).Limit(limit).Find(&versions).Error; err != nil {
		return nil, 0, err
	}

	items := make([]WikiPageVersionDTO, 0, len(versions))
	for i := range versions {
		dto := toWikiPageVersionDTO(&versions[i])
		dto.IsCurrent = req.CurrentVersionID > 0 && versions[i].ID == req.CurrentVersionID
		items = append(items, dto)
	}
	return items, total, nil
}

func (s *wikiPageReadService) GetVersion(ctx context.Context, eid, pageID int64, versionNo int64, currentVersionID int64) (*WikiPageVersionDTO, error) {
	if s == nil || s.db == nil {
		return nil, fmt.Errorf("wiki read db is required")
	}
	if eid <= 0 || pageID <= 0 || versionNo <= 0 {
		return nil, fmt.Errorf("eid, page_id and version_no are required")
	}

	var version model.WikiPageVersion
	if err := s.db.WithContext(ctx).Where("eid = ? AND page_id = ? AND version_no = ?", eid, pageID, versionNo).First(&version).Error; err != nil {
		return nil, err
	}
	dto := toWikiPageVersionDTO(&version)
	dto.IsCurrent = currentVersionID > 0 && version.ID == currentVersionID
	return &dto, nil
}

func (s *wikiPageReadService) loadCurrentVersion(ctx context.Context, page *model.WikiPage) (*WikiPageVersionDTO, error) {
	if page == nil {
		return nil, nil
	}

	var version model.WikiPageVersion
	query := s.db.WithContext(ctx).Where("eid = ? AND page_id = ?", page.Eid, page.ID)
	if page.CurrentVersionID > 0 {
		if err := query.Where("id = ?", page.CurrentVersionID).First(&version).Error; err == nil {
			dto := toWikiPageVersionDTO(&version)
			return &dto, nil
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
	}

	if err := query.Order("version_no DESC, id DESC").First(&version).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	dto := toWikiPageVersionDTO(&version)
	return &dto, nil
}

func (s *wikiPageReadService) loadPageSources(ctx context.Context, pageID int64) ([]WikiPageSourceDTO, error) {
	var sources []model.WikiPageSource
	if err := s.db.WithContext(ctx).Where("page_id = ?", pageID).Order("id ASC").Find(&sources).Error; err != nil {
		return nil, err
	}

	fileIDs := make([]int64, 0, len(sources))
	for i := range sources {
		if sources[i].SourceFileID > 0 {
			fileIDs = append(fileIDs, sources[i].SourceFileID)
		}
	}

	fileInfo := make(map[int64]*model.File)
	if len(fileIDs) > 0 {
		var files []model.File
		if err := s.db.WithContext(ctx).Where("id IN ?", fileIDs).Find(&files).Error; err == nil {
			for i := range files {
				fileInfo[files[i].ID] = &files[i]
			}
		}
	}

	items := make([]WikiPageSourceDTO, 0, len(sources))
	for i := range sources {
		dto := toWikiPageSourceDTO(&sources[i])
		if f, ok := fileInfo[sources[i].SourceFileID]; ok {
			dto.LibraryID = f.LibraryID
			dto.FileName = filepath.Base(f.Path)
		}
		items = append(items, dto)
	}
	return items, nil
}

func (s *wikiPageReadService) loadPageLinks(ctx context.Context, pageID int64) ([]WikiPageLinkDTO, error) {
	var links []model.WikiPageLink
	if err := s.db.WithContext(ctx).Where("from_page_id = ?", pageID).Order("id ASC").Find(&links).Error; err != nil {
		return nil, err
	}
	return s.toWikiPageLinkDTOsWithSourceTitles(ctx, links)
}

func (s *wikiPageReadService) loadPageBacklinks(ctx context.Context, pageID int64) ([]WikiPageLinkDTO, error) {
	var links []model.WikiPageLink
	if err := s.db.WithContext(ctx).Where("to_page_id = ?", pageID).Order("id ASC").Find(&links).Error; err != nil {
		return nil, err
	}
	return s.toWikiPageLinkDTOsWithSourceTitles(ctx, links)
}

func (s *wikiPageReadService) toWikiPageLinkDTOsWithSourceTitles(ctx context.Context, links []model.WikiPageLink) ([]WikiPageLinkDTO, error) {
	pageIDs := make([]int64, 0, len(links))
	seen := make(map[int64]struct{}, len(links))
	for _, link := range links {
		if link.FromPageID <= 0 {
			continue
		}
		if _, ok := seen[link.FromPageID]; ok {
			continue
		}
		seen[link.FromPageID] = struct{}{}
		pageIDs = append(pageIDs, link.FromPageID)
	}

	titles := make(map[int64]string, len(pageIDs))
	slugs := make(map[int64]string, len(pageIDs))
	if len(pageIDs) > 0 {
		var pages []model.WikiPage
		if err := s.db.WithContext(ctx).Select("id, title, slug").Where("id IN ?", pageIDs).Find(&pages).Error; err != nil {
			return nil, err
		}
		for _, page := range pages {
			titles[page.ID] = page.Title
			slugs[page.ID] = page.Slug
		}
	}

	items := make([]WikiPageLinkDTO, 0, len(links))
	for i := range links {
		item := toWikiPageLinkDTO(&links[i])
		item.FromPageTitle = titles[links[i].FromPageID]
		item.FromPageSlug = slugs[links[i].FromPageID]
		items = append(items, item)
	}
	return items, nil
}

func (s *wikiPageReadService) loadRecentPagesByType(ctx context.Context, eid, libraryID int64, pageType string, dst *[]WikiPageSummary) error {
	var pages []model.WikiPage
	if err := s.db.WithContext(ctx).Where("eid = ? AND library_id = ? AND status = ? AND page_type = ?", eid, libraryID, model.WikiPageStatusActive, pageType).
		Order("updated_time DESC, id DESC").
		Limit(10).
		Find(&pages).Error; err != nil {
		return err
	}
	folderPaths, err := s.loadFolderPathMap(ctx, pages)
	if err != nil {
		return err
	}
	items := make([]WikiPageSummary, 0, len(pages))
	for i := range pages {
		items = append(items, toWikiPageSummary(&pages[i], folderPaths[pages[i].FolderID]))
	}
	*dst = items
	return nil
}

func applyWikiPageListFilters(db *gorm.DB, keyword, pageType, status string) *gorm.DB {
	if db == nil {
		return db
	}
	keyword = strings.TrimSpace(keyword)
	if keyword != "" {
		like := "%" + keyword + "%"
		db = db.Where("(title LIKE ? OR slug LIKE ? OR summary LIKE ? OR aliases LIKE ?)", like, like, like, like)
	}
	pageType = strings.TrimSpace(pageType)
	if pageType != "" {
		db = db.Where("page_type = ?", pageType)
	}
	status = strings.TrimSpace(status)
	if status == "" {
		status = model.WikiPageStatusActive
	}
	if status != "" && strings.ToLower(status) != "all" {
		db = db.Where("status = ?", status)
	}
	return db
}

func normalizeWikiListLimit(limit, defaultLimit, maxLimit int) int {
	if limit <= 0 {
		return defaultLimit
	}
	if limit > maxLimit {
		return maxLimit
	}
	return limit
}

func (s *wikiPageReadService) loadFolderPathMap(ctx context.Context, pages []model.WikiPage) (map[int64]string, error) {
	if s == nil || s.db == nil || len(pages) == 0 {
		return nil, nil
	}
	folderIDs := make([]int64, 0, len(pages))
	seen := make(map[int64]struct{}, len(pages))
	for _, page := range pages {
		if page.FolderID <= 0 {
			continue
		}
		if _, ok := seen[page.FolderID]; ok {
			continue
		}
		seen[page.FolderID] = struct{}{}
		folderIDs = append(folderIDs, page.FolderID)
	}
	if len(folderIDs) == 0 {
		return nil, nil
	}

	var folders []model.WikiFolder
	if err := s.db.WithContext(ctx).Where("id IN ?", folderIDs).Find(&folders).Error; err != nil {
		return nil, err
	}
	out := make(map[int64]string, len(folders))
	for _, folder := range folders {
		out[folder.ID] = folder.Path
	}
	return out, nil
}

func (s *wikiPageReadService) loadIndexIntroMarkdown(ctx context.Context, eid, libraryID int64) (string, error) {
	var page model.WikiPage
	if err := s.db.WithContext(ctx).
		Where("eid = ? AND library_id = ? AND status = ? AND page_type = ? AND slug = ?", eid, libraryID, model.WikiPageStatusActive, model.WikiPageTypeIndex, wikiIndexIntroSlugForRead).
		Order("updated_time DESC, id DESC").
		First(&page).Error; err == nil {
		return strings.TrimSpace(page.Body), nil
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return "", err
	}

	if err := s.db.WithContext(ctx).
		Where("eid = ? AND library_id = ? AND status = ? AND page_type = ?", eid, libraryID, model.WikiPageStatusActive, model.WikiPageTypeIndex).
		Order("updated_time DESC, id DESC").
		First(&page).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", nil
		}
		return "", err
	}
	return strings.TrimSpace(page.Body), nil
}

func toWikiPageSummary(page *model.WikiPage, folderPath string) WikiPageSummary {
	if page == nil {
		return WikiPageSummary{}
	}
	firstLetter := firstLetterOfTitle(page.Title)
	return WikiPageSummary{
		ID:               page.ID,
		Eid:              page.Eid,
		LibraryID:        page.LibraryID,
		FolderID:         page.FolderID,
		FolderPath:       folderPath,
		CurrentVersionID: page.CurrentVersionID,
		Title:            page.Title,
		Slug:             page.Slug,
		PageType:         page.PageType,
		Summary:          page.Summary,
		Aliases:          normalizeWikiPageAliasesForRead(page.Aliases),
		Status:           page.Status,
		Visibility:       page.Visibility,
		CreatorID:        page.CreatorID,
		UpdaterID:        page.UpdaterID,
		Sort:             page.Sort,
		FirstLetter:      firstLetter,
		CreatedTime:      page.CreatedTime,
		UpdatedTime:      page.UpdatedTime,
	}
}

func firstLetterOfTitle(title string) string {
	if title == "" {
		return ""
	}
	r, _ := utf8.DecodeRuneInString(title)
	if r == utf8.RuneError {
		return ""
	}
	if r > unicode.MaxASCII {
		p := pinyin.LazyPinyin(string(r), pinyin.NewArgs())
		if len(p) > 0 && p[0] != "" {
			return strings.ToUpper(string([]rune(p[0])[0]))
		}
		return ""
	}
	return string(unicode.ToUpper(r))
}

func toWikiPageSourceDTO(src *model.WikiPageSource) WikiPageSourceDTO {
	if src == nil {
		return WikiPageSourceDTO{}
	}
	return WikiPageSourceDTO{
		ID:                src.ID,
		Eid:               src.Eid,
		PageID:            src.PageID,
		SourceKind:        src.SourceKind,
		SourceRef:         replaceFileIDRefs(src.SourceRef),
		SourceFileID:      src.SourceFileID,
		SourceChunkID:     src.SourceChunkID,
		SourceSlug:        src.SourceSlug,
		SourceLocation:    src.SourceLocation,
		SourceContentHash: src.SourceContentHash,
		SourceURL:         src.SourceURL,
		ExternalID:        src.ExternalID,
		ExternalDigest:    src.ExternalDigest,
		MetaJSON:          src.MetaJSON,
		LastSyncedTime:    src.LastSyncedTime,
		CreatorID:         src.CreatorID,
		CreatedTime:       src.CreatedTime,
		UpdatedTime:       src.UpdatedTime,
	}
}

func toWikiPageSourceDTOs(sources []model.WikiPageSource) []WikiPageSourceDTO {
	items := make([]WikiPageSourceDTO, 0, len(sources))
	for i := range sources {
		items = append(items, toWikiPageSourceDTO(&sources[i]))
	}
	return items
}

func toWikiPageLinkDTO(link *model.WikiPageLink) WikiPageLinkDTO {
	if link == nil {
		return WikiPageLinkDTO{}
	}
	return WikiPageLinkDTO{
		ID:          link.ID,
		Eid:         link.Eid,
		FromPageID:  link.FromPageID,
		ToPageID:    link.ToPageID,
		LinkKind:    link.LinkKind,
		AnchorText:  link.AnchorText,
		TargetSlug:  link.TargetSlug,
		CreatorID:   link.CreatorID,
		CreatedTime: link.CreatedTime,
		UpdatedTime: link.UpdatedTime,
	}
}

func toWikiPageLinkDTOs(links []model.WikiPageLink) []WikiPageLinkDTO {
	items := make([]WikiPageLinkDTO, 0, len(links))
	for i := range links {
		items = append(items, toWikiPageLinkDTO(&links[i]))
	}
	return items
}

func toWikiPageVersionDTO(version *model.WikiPageVersion) WikiPageVersionDTO {
	if version == nil {
		return WikiPageVersionDTO{}
	}
	aliases := make([]string, 0)
	if strings.TrimSpace(version.AliasesJSON) != "" {
		if err := json.Unmarshal([]byte(version.AliasesJSON), &aliases); err != nil {
			aliases = make([]string, 0)
		}
	}
	var sources []model.WikiPageSource
	if strings.TrimSpace(version.SourcesJSON) != "" {
		if err := json.Unmarshal([]byte(version.SourcesJSON), &sources); err != nil {
			sources = nil
		}
	}
	var links []model.WikiPageLink
	if strings.TrimSpace(version.LinksJSON) != "" {
		if err := json.Unmarshal([]byte(version.LinksJSON), &links); err != nil {
			links = nil
		}
	}
	var backlinks []model.WikiPageLink
	if strings.TrimSpace(version.BacklinksJSON) != "" {
		if err := json.Unmarshal([]byte(version.BacklinksJSON), &backlinks); err != nil {
			backlinks = nil
		}
	}
	return WikiPageVersionDTO{
		ID:            version.ID,
		Eid:           version.Eid,
		PageID:        version.PageID,
		VersionNo:     version.VersionNo,
		Title:         version.Title,
		Slug:          version.Slug,
		PageType:      version.PageType,
		Aliases:       aliases,
		Sources:       replaceSourcesFileIDRefs(toWikiPageSourceDTOs(sources)),
		Links:         toWikiPageLinkDTOs(links),
		Backlinks:     toWikiPageLinkDTOs(backlinks),
		Body:          replaceFileIDRefs(version.Body),
		BodyFormat:    version.BodyFormat,
		ChangeSummary: version.ChangeSummary,
		Checksum:      version.Checksum,
		SourceVersion: replaceFileIDRefs(version.SourceVersion),
		EditorID:      version.EditorID,
		IsPublished:   version.IsPublished,
		IsCurrent:     false,
		PublishKind:   version.PublishKind,
		PublishedTime: version.PublishedTime,
		VersionTag:    version.VersionTag,
		CreatedTime:   version.CreatedTime,
		UpdatedTime:   version.UpdatedTime,
	}
}

func toWikiLogEntryDTO(entry *model.WikiLogEntry) WikiLogEntryDTO {
	if entry == nil {
		return WikiLogEntryDTO{}
	}
	return WikiLogEntryDTO{
		ID:          entry.ID,
		Eid:         entry.Eid,
		PageID:      entry.PageID,
		VersionID:   entry.VersionID,
		ActorID:     entry.ActorID,
		Action:      entry.Action,
		RequestID:   entry.RequestID,
		Message:     entry.Message,
		MetaJSON:    entry.MetaJSON,
		CreatedTime: entry.CreatedTime,
		UpdatedTime: entry.UpdatedTime,
	}
}

func replaceFileIDRefs(s string) string {
	return fileIDRefRegex.ReplaceAllStringFunc(s, func(match string) string {
		idStr := match[len("file:"):]
		id, err := strconv.ParseInt(idStr, 10, 64)
		if err != nil || id <= 0 {
			return match
		}
		if encoded, err := hashids.Encode(id); err == nil {
			return "file:" + encoded
		}
		return match
	})
}

func replaceSourcesFileIDRefs(sources []WikiPageSourceDTO) []WikiPageSourceDTO {
	for i := range sources {
		sources[i].SourceRef = replaceFileIDRefs(sources[i].SourceRef)
	}
	return sources
}
