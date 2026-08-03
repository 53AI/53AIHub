package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

var (
	ErrWikiSpaceNotFound          = errors.New("wiki space not found")
	ErrWikiSpaceForbidden         = errors.New("wiki space is not visible")
	ErrWikiSpaceLibraryNotVisible = errors.New("wiki library is not visible")
	ErrWikiSpaceDuplicateSlug     = errors.New("wiki page slug is ambiguous")
	ErrWikiSpacePageNotFound      = errors.New("wiki page not found")
	ErrWikiSpaceFileNotFound      = errors.New("wiki file not found")
)

type WikiSpaceReadService interface {
	ListPages(ctx context.Context, req WikiSpaceListPagesRequest) (*WikiSpaceListPagesResponse, error)
	GetPage(ctx context.Context, req WikiSpacePageRequest) (*WikiSpacePageDetailResponse, error)
	GetIndex(ctx context.Context, req WikiSpaceBaseRequest) (*WikiSpaceIndexView, error)
	GetGraph(ctx context.Context, req WikiSpaceGraphRequest) (*WikiSpaceGraphView, error)
	ListLogs(ctx context.Context, req WikiSpaceListLogsRequest) (*WikiSpaceListLogsResponse, error)
	GetHealth(ctx context.Context, req WikiSpaceBaseRequest) (*WikiSpaceHealthReport, error)
	ListProgress(ctx context.Context, req WikiSpaceProgressListRequest) (*WikiSpaceListProgressResponse, error)
	GetProgress(ctx context.Context, req WikiSpaceProgressRequest) (*WikiSpaceProgressDetailResponse, error)
	GetStats(ctx context.Context, req WikiSpaceBaseRequest) (*WikiSpaceStatsResponse, error)
}

type wikiSpaceReadService struct {
	db       *gorm.DB
	pageRead *wikiPageReadService
	progress *wikiProgressService
}

func NewWikiSpaceReadService(db *gorm.DB) WikiSpaceReadService {
	return &wikiSpaceReadService{
		db:       db,
		pageRead: &wikiPageReadService{db: db},
		progress: &wikiProgressService{db: db},
	}
}

type WikiSpaceBaseRequest struct {
	Eid       int64
	UserID    int64
	SpaceID   int64
	LibraryID int64
	IsAdmin   bool
}

type WikiSpaceListPagesRequest struct {
	WikiSpaceBaseRequest
	Keyword  string
	PageType string
	Status   string
	SortBy   string
	Offset   int
	Limit    int
}

type WikiSpacePageRequest struct {
	WikiSpaceBaseRequest
	Slug string
}

type WikiSpaceGraphRequest struct {
	WikiSpaceBaseRequest
	Mode   string
	Center string
	Depth  int
	Types  []string
	Limit  int
}

type WikiSpaceListLogsRequest struct {
	WikiSpaceBaseRequest
	Cursor string
	Limit  int
	// 兼容旧版内部调用方；空间日志接口不再使用分页偏移和页面筛选。
	PageID int64
	Offset int
}

type WikiSpaceProgressListRequest struct {
	WikiSpaceBaseRequest
	Status string
	Offset int
	Limit  int
}

type WikiSpaceProgressRequest struct {
	WikiSpaceBaseRequest
	FileID int64
}

type WikiSpaceLibraryRef struct {
	ID          int64  `json:"id"`
	Name        string `json:"name"`
	LibraryKind string `json:"library_kind"`
	Permission  int    `json:"permission"`
}

type WikiSpacePageSummary struct {
	WikiPageSummary
	SpaceID     int64  `json:"space_id"`
	LibraryName string `json:"library_name"`
	LibraryKind string `json:"library_kind"`
}

type WikiSpaceListPagesResponse struct {
	Items     []WikiSpacePageSummary `json:"items"`
	Total     int64                  `json:"total"`
	Libraries []WikiSpaceLibraryRef  `json:"libraries"`
}

type WikiSpacePageDetailResponse struct {
	SpaceID        int64                 `json:"space_id"`
	LibraryID      int64                 `json:"library_id"`
	LibraryName    string                `json:"library_name"`
	LibraryKind    string                `json:"library_kind"`
	Page           WikiPageDetail        `json:"page"`
	Sources        []WikiPageSourceDTO   `json:"sources,omitempty"`
	Links          []WikiPageLinkDTO     `json:"links,omitempty"`
	Backlinks      []WikiPageLinkDTO     `json:"backlinks,omitempty"`
	CurrentVersion *WikiPageVersionDTO   `json:"current_version,omitempty"`
	Libraries      []WikiSpaceLibraryRef `json:"libraries"`
}

type WikiSpaceIndexView struct {
	Eid                int64                  `json:"eid"`
	SpaceID            int64                  `json:"space_id"`
	TotalPages         int64                  `json:"total_pages"`
	PageTypeCounts     map[string]int64       `json:"page_type_counts"`
	RecentSummaryPages []WikiSpacePageSummary `json:"recent_summary_pages,omitempty"`
	RecentIndexPages   []WikiSpacePageSummary `json:"recent_index_pages,omitempty"`
	IndexMarkdown      string                 `json:"index_markdown,omitempty"`
	Libraries          []WikiSpaceLibraryRef  `json:"libraries"`
}

type WikiSpaceGraphView struct {
	Eid            int64                 `json:"eid"`
	SpaceID        int64                 `json:"space_id"`
	TotalPages     int64                 `json:"total_pages"`
	PageTypeCounts map[string]int64      `json:"page_type_counts"`
	Nodes          []WikiGraphNodeDTO    `json:"nodes"`
	Edges          []WikiGraphEdgeDTO    `json:"edges"`
	DanglingLinks  int64                 `json:"dangling_links"`
	Meta           WikiGraphMeta         `json:"meta"`
	Libraries      []WikiSpaceLibraryRef `json:"libraries"`
}

type WikiSpaceListLogsResponse struct {
	Entries    []WikiDocumentLogEntryDTO `json:"entries"`
	NextCursor string                    `json:"next_cursor,omitempty"`
	// Deprecated: 保留结构字段，避免旧内部调用方编译失败，不参与 JSON 输出。
	Items     []WikiLogEntryDTO     `json:"-"`
	Total     int64                 `json:"-"`
	Libraries []WikiSpaceLibraryRef `json:"-"`
}

type WikiDocumentLogPage struct {
	Slug  string `json:"slug"`
	Title string `json:"title"`
}

type WikiDocumentLogEntryDTO struct {
	ID              int64                 `json:"id"`
	KnowledgeBaseID string                `json:"knowledge_base_id"`
	Action          string                `json:"action"`
	KnowledgeID     string                `json:"knowledge_id"`
	DocTitle        string                `json:"doc_title"`
	Summary         string                `json:"summary"`
	PagesAffected   []WikiDocumentLogPage `json:"pages_affected"`
	CreatedAt       time.Time             `json:"created_at"`
}

type WikiSpaceHealthReport struct {
	Eid                        int64                 `json:"eid"`
	SpaceID                    int64                 `json:"space_id"`
	TotalPages                 int64                 `json:"total_pages"`
	PagesMissingCurrentVersion int64                 `json:"pages_missing_current_version"`
	DanglingLinks              int64                 `json:"dangling_links"`
	PagesWithoutOutlinks       int64                 `json:"pages_without_outlinks"`
	PageTypeCounts             map[string]int64      `json:"page_type_counts"`
	Libraries                  []WikiSpaceLibraryRef `json:"libraries"`
}

type WikiSpaceProgressItem struct {
	WikiProgressItem
	LibraryID   int64  `json:"library_id"`
	LibraryName string `json:"library_name"`
	LibraryKind string `json:"library_kind"`
}

type WikiSpaceListProgressResponse struct {
	Items     []WikiSpaceProgressItem `json:"items"`
	Total     int64                   `json:"total"`
	Libraries []WikiSpaceLibraryRef   `json:"libraries"`
}

type WikiSpaceProgressDetailResponse struct {
	SpaceID      int64                      `json:"space_id"`
	LibraryID    int64                      `json:"library_id"`
	LibraryName  string                     `json:"library_name"`
	LibraryKind  string                     `json:"library_kind"`
	ProgressItem WikiSpaceProgressItem      `json:"progress_item"`
	Jobs         []WikiProgressJobView      `json:"jobs"`
	Steps        []WikiProgressStepView     `json:"steps"`
	WikiPages    []WikiProgressWikiPageView `json:"wiki_pages"`
	Logs         []WikiProgressLogView      `json:"logs"`
	Libraries    []WikiSpaceLibraryRef      `json:"libraries"`
}

type WikiSpaceStatsResponse struct {
	WikiSummaryCount int64 `json:"wiki_summary_count"`
	WikiEntityCount  int64 `json:"wiki_entity_count"`
	WikiConceptCount int64 `json:"wiki_concept_count"`
	MonthNewDocs     int64 `json:"month_new_docs"`
	TotalDocs        int64 `json:"total_docs"`
	WikiCompiledDocs int64 `json:"wiki_compiled_docs"`
}

type wikiSpaceLibrariesContext struct {
	space     *model.Space
	libraries []model.Library
	refs      []WikiSpaceLibraryRef
	ids       []int64
	byID      map[int64]model.Library
}

func (s *wikiSpaceReadService) ListPages(ctx context.Context, req WikiSpaceListPagesRequest) (*WikiSpaceListPagesResponse, error) {
	spaceCtx, err := s.resolveVisibleSpaceLibraries(ctx, req.WikiSpaceBaseRequest)
	if err != nil {
		return nil, err
	}
	if req.LibraryID > 0 && len(spaceCtx.libraries) == 1 {
		items, total, err := s.pageRead.ListPages(ctx, WikiListPagesRequest{
			Eid:       req.Eid,
			LibraryID: req.LibraryID,
			Keyword:   req.Keyword,
			PageType:  req.PageType,
			Status:    req.Status,
			SortBy:    req.SortBy,
			Offset:    req.Offset,
			Limit:     req.Limit,
		})
		if err != nil {
			return nil, err
		}
		return &WikiSpaceListPagesResponse{
			Items:     wrapWikiSpacePageSummaries(items, spaceCtx.byID[req.LibraryID]),
			Total:     total,
			Libraries: spaceCtx.refs,
		}, nil
	}

	if len(spaceCtx.ids) == 0 {
		return &WikiSpaceListPagesResponse{
			Items:     []WikiSpacePageSummary{},
			Total:     0,
			Libraries: spaceCtx.refs,
		}, nil
	}

	limit := normalizeWikiListLimit(req.Limit, 20, 100)
	offset := req.Offset
	if offset < 0 {
		offset = 0
	}

	base := s.db.WithContext(ctx).Model(&model.WikiPage{}).
		Where("eid = ? AND library_id IN ?", req.Eid, spaceCtx.ids)
	base = applyWikiPageListFilters(base, req.Keyword, req.PageType, req.Status)

	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, err
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
		return nil, err
	}
	folderPaths, err := s.pageRead.loadFolderPathMap(ctx, pages)
	if err != nil {
		return nil, err
	}
	items := make([]WikiSpacePageSummary, 0, len(pages))
	for i := range pages {
		lib := spaceCtx.byID[pages[i].LibraryID]
		items = append(items, buildWikiSpacePageSummary(&pages[i], lib, folderPaths[pages[i].FolderID]))
	}

	return &WikiSpaceListPagesResponse{
		Items:     items,
		Total:     total,
		Libraries: spaceCtx.refs,
	}, nil
}

func (s *wikiSpaceReadService) GetPage(ctx context.Context, req WikiSpacePageRequest) (*WikiSpacePageDetailResponse, error) {
	spaceCtx, err := s.resolveVisibleSpaceLibraries(ctx, req.WikiSpaceBaseRequest)
	if err != nil {
		return nil, err
	}
	slug := strings.TrimSpace(req.Slug)
	if slug == "" {
		return nil, fmt.Errorf("slug is required")
	}

	if req.LibraryID > 0 {
		detail, err := s.pageRead.GetPage(ctx, req.Eid, req.LibraryID, slug)
		if err != nil {
			return nil, err
		}
		lib, ok := spaceCtx.byID[req.LibraryID]
		if !ok {
			return nil, ErrWikiSpaceLibraryNotVisible
		}
		return buildWikiSpacePageDetailResponse(detail, lib, spaceCtx.refs), nil
	}

	var pages []model.WikiPage
	if err := s.db.WithContext(ctx).
		Where("eid = ? AND library_id IN ? AND slug = ?", req.Eid, spaceCtx.ids, slug).
		Find(&pages).Error; err != nil {
		return nil, err
	}
	if len(pages) == 0 {
		return nil, ErrWikiSpacePageNotFound
	}
	if len(pages) > 1 {
		// 若所有命中页面均为 index 类型且无 library_id，按 library sort 取第一条
		allIndex := true
		for _, p := range pages {
			if p.PageType != model.WikiPageTypeIndex {
				allIndex = false
				break
			}
		}
		if allIndex {
			sort.SliceStable(pages, func(i, j int) bool {
				li, lj := spaceCtx.byID[pages[i].LibraryID], spaceCtx.byID[pages[j].LibraryID]
				if li.Sort != lj.Sort {
					return li.Sort < lj.Sort
				}
				return li.ID < lj.ID
			})
		} else {
			return nil, ErrWikiSpaceDuplicateSlug
		}
	}
	page := pages[0]
	lib, ok := spaceCtx.byID[page.LibraryID]
	if !ok {
		return nil, ErrWikiSpaceLibraryNotVisible
	}
	detail, err := s.pageRead.GetPage(ctx, req.Eid, page.LibraryID, slug)
	if err != nil {
		return nil, err
	}
	return buildWikiSpacePageDetailResponse(detail, lib, spaceCtx.refs), nil
}

func (s *wikiSpaceReadService) GetIndex(ctx context.Context, req WikiSpaceBaseRequest) (*WikiSpaceIndexView, error) {
	spaceCtx, err := s.resolveVisibleSpaceLibraries(ctx, req)
	if err != nil {
		return nil, err
	}
	if req.LibraryID > 0 && len(spaceCtx.libraries) == 1 {
		view, err := s.pageRead.GetIndex(ctx, req.Eid, req.LibraryID)
		if err != nil {
			return nil, err
		}
		return &WikiSpaceIndexView{
			Eid:                view.Eid,
			SpaceID:            spaceCtx.space.ID,
			TotalPages:         view.TotalPages,
			PageTypeCounts:     view.PageTypeCounts,
			RecentSummaryPages: wrapWikiSpacePageSummaries(view.RecentSummaryPages, spaceCtx.byID[req.LibraryID]),
			RecentIndexPages:   wrapWikiSpacePageSummaries(view.RecentIndexPages, spaceCtx.byID[req.LibraryID]),
			IndexMarkdown:      view.IndexMarkdown,
			Libraries:          spaceCtx.refs,
		}, nil
	}

	if len(spaceCtx.ids) == 0 {
		return &WikiSpaceIndexView{
			Eid:            req.Eid,
			SpaceID:        spaceCtx.space.ID,
			PageTypeCounts: make(map[string]int64),
			Libraries:      spaceCtx.refs,
		}, nil
	}

	view := &WikiSpaceIndexView{
		Eid:            req.Eid,
		SpaceID:        spaceCtx.space.ID,
		PageTypeCounts: make(map[string]int64),
		Libraries:      spaceCtx.refs,
	}

	countQuery := s.db.WithContext(ctx).Model(&model.WikiPage{}).
		Where("eid = ? AND library_id IN ? AND status = ?", req.Eid, spaceCtx.ids, model.WikiPageStatusActive)
	if err := countQuery.Count(&view.TotalPages).Error; err != nil {
		return nil, err
	}

	var typeCounts []struct {
		PageType string
		Count    int64
	}
	typeQuery := s.db.WithContext(ctx).Model(&model.WikiPage{}).
		Where("eid = ? AND library_id IN ? AND status = ?", req.Eid, spaceCtx.ids, model.WikiPageStatusActive)
	if err := typeQuery.Select("page_type, COUNT(*) AS count").Group("page_type").Scan(&typeCounts).Error; err != nil {
		return nil, err
	}
	for _, row := range typeCounts {
		view.PageTypeCounts[row.PageType] = row.Count
	}

	if err := s.loadRecentPagesByTypeAcrossLibraries(ctx, req.Eid, spaceCtx.ids, model.WikiPageTypeSummary, &view.RecentSummaryPages, spaceCtx.byID); err != nil {
		return nil, err
	}
	if err := s.loadRecentPagesByTypeAcrossLibraries(ctx, req.Eid, spaceCtx.ids, model.WikiPageTypeIndex, &view.RecentIndexPages, spaceCtx.byID); err != nil {
		return nil, err
	}

	var allPages []model.WikiPage
	listQuery := s.db.WithContext(ctx).Model(&model.WikiPage{}).
		Where("eid = ? AND library_id IN ? AND status = ?", req.Eid, spaceCtx.ids, model.WikiPageStatusActive)
	if err := listQuery.Order("sort ASC, id ASC").Find(&allPages).Error; err != nil {
		return nil, err
	}
	if len(allPages) > 0 {
		folderPaths, err := s.pageRead.loadFolderPathMap(ctx, allPages)
		if err != nil {
			return nil, err
		}
		view.IndexMarkdown = NewWikiIndexService().BuildIndexMarkdownWithFoldersAndIntro(allPages, folderPaths, "")
	}

	return view, nil
}

func (s *wikiSpaceReadService) GetGraph(ctx context.Context, req WikiSpaceGraphRequest) (*WikiSpaceGraphView, error) {
	spaceCtx, err := s.resolveVisibleSpaceLibraries(ctx, req.WikiSpaceBaseRequest)
	if err != nil {
		return nil, err
	}
	if req.LibraryID > 0 && len(spaceCtx.libraries) == 1 {
		view, err := s.pageRead.GetGraph(ctx, WikiGraphRequest{
			Eid:       req.Eid,
			LibraryID: req.LibraryID,
			Mode:      req.Mode,
			Center:    req.Center,
			Depth:     req.Depth,
			Types:     req.Types,
			Limit:     req.Limit,
		})
		if err != nil {
			return nil, err
		}
		return &WikiSpaceGraphView{
			Eid:            view.Eid,
			SpaceID:        spaceCtx.space.ID,
			TotalPages:     view.TotalPages,
			PageTypeCounts: view.PageTypeCounts,
			Nodes:          view.Nodes,
			Edges:          view.Edges,
			DanglingLinks:  view.DanglingLinks,
			Meta:           view.Meta,
			Libraries:      spaceCtx.refs,
		}, nil
	}

	if len(spaceCtx.ids) == 0 {
		return &WikiSpaceGraphView{
			Eid:            req.Eid,
			SpaceID:        spaceCtx.space.ID,
			PageTypeCounts: make(map[string]int64),
			Meta:           WikiGraphMeta{Mode: normalizeWikiGraphMode(req.Mode), Center: strings.TrimSpace(req.Center), Depth: normalizeWikiGraphDepth(req.Depth)},
			Libraries:      spaceCtx.refs,
		}, nil
	}

	mode := normalizeWikiGraphMode(req.Mode)
	center := strings.TrimSpace(req.Center)
	depth := normalizeWikiGraphDepth(req.Depth)
	limit := normalizeWikiGraphLimit(req.Limit)
	typeFilter := normalizeWikiGraphTypes(req.Types)
	if mode == "ego" && center == "" {
		return nil, fmt.Errorf("center is required when mode=ego")
	}

	view := &WikiSpaceGraphView{
		Eid:            req.Eid,
		SpaceID:        spaceCtx.space.ID,
		PageTypeCounts: make(map[string]int64),
		Meta: WikiGraphMeta{
			Mode:   mode,
			Center: center,
			Depth:  depth,
		},
		Libraries: spaceCtx.refs,
	}

	base := s.db.WithContext(ctx).Model(&model.WikiPage{}).
		Where("eid = ? AND library_id IN ? AND status = ?", req.Eid, spaceCtx.ids, model.WikiPageStatusActive)
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
	pageBySlug := make(map[string][]model.WikiPage, len(pages))
	pageSet := make(map[int64]struct{}, len(pages))
	for i := range pages {
		page := pages[i]
		pageByID[page.ID] = page
		pageBySlug[page.Slug] = append(pageBySlug[page.Slug], page)
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
			if _, ok := pageSet[link.ToPageID]; ok {
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
		matches := pageBySlug[center]
		if len(matches) == 0 {
			return nil, ErrWikiSpacePageNotFound
		}
		if len(matches) > 1 {
			return nil, ErrWikiSpaceDuplicateSlug
		}
		centerID := matches[0].ID
		selected := bfsWikiGraphPages(centerID, adjacency, depth)
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

	folderPaths, err := s.pageRead.loadFolderPathMap(ctx, pages)
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

func (s *wikiSpaceReadService) ListLogs(ctx context.Context, req WikiSpaceListLogsRequest) (*WikiSpaceListLogsResponse, error) {
	spaceCtx, err := s.resolveVisibleSpaceLibraries(ctx, req.WikiSpaceBaseRequest)
	if err != nil {
		return nil, err
	}
	if len(spaceCtx.libraries) == 0 {
		return &WikiSpaceListLogsResponse{Entries: []WikiDocumentLogEntryDTO{}}, nil
	}
	knowledgeBaseIDs := make([]string, 0, len(spaceCtx.libraries))
	for _, library := range spaceCtx.libraries {
		if strings.TrimSpace(library.UUID) != "" {
			knowledgeBaseIDs = append(knowledgeBaseIDs, library.UUID)
		}
	}
	if len(knowledgeBaseIDs) == 0 {
		return &WikiSpaceListLogsResponse{Entries: []WikiDocumentLogEntryDTO{}}, nil
	}
	limit := normalizeWikiListLimit(req.Limit, 50, 200)
	base := s.db.WithContext(ctx).Model(&model.WikiLogEntry{}).
		Where("eid = ? AND page_id = ? AND action IN ? AND knowledge_base_id IN ?", req.Eid, 0, []string{"ingest", "retract"}, knowledgeBaseIDs)
	if strings.TrimSpace(req.Cursor) != "" {
		cursor, parseErr := strconv.ParseInt(req.Cursor, 10, 64)
		if parseErr != nil || cursor <= 0 {
			return nil, fmt.Errorf("invalid wiki log cursor")
		}
		base = base.Where("id < ?", cursor)
	}
	var logs []model.WikiLogEntry
	if err := base.Order("id DESC").Limit(limit).Find(&logs).Error; err != nil {
		return nil, err
	}
	entries := make([]WikiDocumentLogEntryDTO, 0, len(logs))
	for i := range logs {
		entries = append(entries, toWikiDocumentLogEntryDTO(&logs[i]))
	}
	resp := &WikiSpaceListLogsResponse{Entries: entries}
	if len(logs) == limit {
		resp.NextCursor = strconv.FormatInt(logs[len(logs)-1].ID, 10)
	}
	return resp, nil
}

func toWikiDocumentLogEntryDTO(entry *model.WikiLogEntry) WikiDocumentLogEntryDTO {
	dto := WikiDocumentLogEntryDTO{PagesAffected: []WikiDocumentLogPage{}}
	if entry == nil {
		return dto
	}
	dto.ID = entry.ID
	dto.KnowledgeBaseID = entry.KnowledgeBaseID
	dto.Action = entry.Action
	dto.KnowledgeID = entry.KnowledgeID
	dto.DocTitle = entry.DocTitle
	dto.Summary = entry.Summary
	dto.CreatedAt = time.UnixMilli(entry.CreatedTime).UTC()
	if strings.TrimSpace(entry.PagesAffected) != "" {
		_ = json.Unmarshal([]byte(entry.PagesAffected), &dto.PagesAffected)
	}
	return dto
}

func (s *wikiSpaceReadService) GetHealth(ctx context.Context, req WikiSpaceBaseRequest) (*WikiSpaceHealthReport, error) {
	spaceCtx, err := s.resolveVisibleSpaceLibraries(ctx, req)
	if err != nil {
		return nil, err
	}
	if req.LibraryID > 0 && len(spaceCtx.libraries) == 1 {
		report, err := s.pageRead.GetHealth(ctx, req.Eid, req.LibraryID)
		if err != nil {
			return nil, err
		}
		return &WikiSpaceHealthReport{
			Eid:                        report.Eid,
			SpaceID:                    spaceCtx.space.ID,
			TotalPages:                 report.TotalPages,
			PagesMissingCurrentVersion: report.PagesMissingCurrentVersion,
			DanglingLinks:              report.DanglingLinks,
			PagesWithoutOutlinks:       report.PagesWithoutOutlinks,
			PageTypeCounts:             report.PageTypeCounts,
			Libraries:                  spaceCtx.refs,
		}, nil
	}
	if len(spaceCtx.ids) == 0 {
		return &WikiSpaceHealthReport{
			Eid:            req.Eid,
			SpaceID:        spaceCtx.space.ID,
			PageTypeCounts: make(map[string]int64),
			Libraries:      spaceCtx.refs,
		}, nil
	}

	report := &WikiSpaceHealthReport{
		Eid:            req.Eid,
		SpaceID:        spaceCtx.space.ID,
		PageTypeCounts: make(map[string]int64),
		Libraries:      spaceCtx.refs,
	}

	activePages := s.db.WithContext(ctx).Model(&model.WikiPage{}).
		Select("id").
		Where("eid = ? AND library_id IN ? AND status = ?", req.Eid, spaceCtx.ids, model.WikiPageStatusActive)
	if err := s.db.WithContext(ctx).Model(&model.WikiPage{}).
		Where("eid = ? AND library_id IN ? AND status = ?", req.Eid, spaceCtx.ids, model.WikiPageStatusActive).
		Count(&report.TotalPages).Error; err != nil {
		return nil, err
	}
	if err := s.db.WithContext(ctx).Model(&model.WikiPage{}).
		Where("eid = ? AND library_id IN ? AND status = ? AND current_version_id = 0", req.Eid, spaceCtx.ids, model.WikiPageStatusActive).
		Count(&report.PagesMissingCurrentVersion).Error; err != nil {
		return nil, err
	}

	var typeCounts []struct {
		PageType string
		Count    int64
	}
	typeQuery := s.db.WithContext(ctx).Model(&model.WikiPage{}).
		Where("eid = ? AND library_id IN ? AND status = ?", req.Eid, spaceCtx.ids, model.WikiPageStatusActive)
	if err := typeQuery.Select("page_type, COUNT(*) AS count").Group("page_type").Scan(&typeCounts).Error; err != nil {
		return nil, err
	}
	for _, row := range typeCounts {
		report.PageTypeCounts[row.PageType] = row.Count
	}

	if err := s.db.WithContext(ctx).Model(&model.WikiPageLink{}).
		Where("eid = ? AND from_page_id IN (?)", req.Eid, activePages).
		Where("to_page_id = 0 OR to_page_id NOT IN (?)", activePages).
		Count(&report.DanglingLinks).Error; err != nil {
		return nil, err
	}

	var pagesWithOutlinks int64
	if err := s.db.WithContext(ctx).Model(&model.WikiPageLink{}).
		Where("eid = ? AND from_page_id IN (?)", req.Eid, activePages).
		Distinct("from_page_id").
		Count(&pagesWithOutlinks).Error; err != nil {
		return nil, err
	}
	if report.TotalPages >= pagesWithOutlinks {
		report.PagesWithoutOutlinks = report.TotalPages - pagesWithOutlinks
	}

	return report, nil
}

func (s *wikiSpaceReadService) ListProgress(ctx context.Context, req WikiSpaceProgressListRequest) (*WikiSpaceListProgressResponse, error) {
	spaceCtx, err := s.resolveVisibleSpaceLibraries(ctx, req.WikiSpaceBaseRequest)
	if err != nil {
		return nil, err
	}
	if req.LibraryID > 0 && len(spaceCtx.libraries) == 1 {
		items, total, err := s.progress.ListFiles(ctx, WikiProgressListRequest{
			Eid:       req.Eid,
			LibraryID: req.LibraryID,
			Status:    req.Status,
			Offset:    req.Offset,
			Limit:     req.Limit,
		})
		if err != nil {
			return nil, err
		}
		return &WikiSpaceListProgressResponse{
			Items:     wrapWikiSpaceProgressItems(items, spaceCtx.byID[req.LibraryID]),
			Total:     total,
			Libraries: spaceCtx.refs,
		}, nil
	}
	if len(spaceCtx.ids) == 0 {
		return &WikiSpaceListProgressResponse{
			Items:     []WikiSpaceProgressItem{},
			Total:     0,
			Libraries: spaceCtx.refs,
		}, nil
	}

	limit := normalizeWikiListLimit(req.Limit, 20, 100)
	offset := req.Offset
	if offset < 0 {
		offset = 0
	}

	base := s.db.WithContext(ctx).Model(&model.File{}).
		Where("eid = ? AND library_id IN ? AND is_deleted = ? AND type = ?", req.Eid, spaceCtx.ids, false, model.FILE_TYPE_FILE)
	if status := strings.ToLower(strings.TrimSpace(req.Status)); status != "" && status != "all" {
		base = base.Where("run_status = ?", status)
	}

	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, err
	}

	var files []model.File
	if err := base.Order("updated_time DESC, id DESC").Offset(offset).Limit(limit).Find(&files).Error; err != nil {
		return nil, err
	}
	items := make([]WikiSpaceProgressItem, 0, len(files))
	for i := range files {
		lib := spaceCtx.byID[files[i].LibraryID]
		items = append(items, buildWikiSpaceProgressItem(ctx, s.db, &files[i], lib))
	}
	return &WikiSpaceListProgressResponse{
		Items:     items,
		Total:     total,
		Libraries: spaceCtx.refs,
	}, nil
}

func (s *wikiSpaceReadService) GetProgress(ctx context.Context, req WikiSpaceProgressRequest) (*WikiSpaceProgressDetailResponse, error) {
	spaceCtx, err := s.resolveVisibleSpaceLibraries(ctx, req.WikiSpaceBaseRequest)
	if err != nil {
		return nil, err
	}
	if req.FileID <= 0 {
		return nil, fmt.Errorf("file_id is required")
	}

	var file model.File
	if err := s.db.WithContext(ctx).
		Where("eid = ? AND id = ? AND is_deleted = ? AND type = ? AND library_id IN ?", req.Eid, req.FileID, false, model.FILE_TYPE_FILE, spaceCtx.ids).
		First(&file).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrWikiSpaceFileNotFound
		}
		return nil, err
	}
	lib, ok := spaceCtx.byID[file.LibraryID]
	if !ok {
		return nil, ErrWikiSpaceLibraryNotVisible
	}

	detail, err := s.progress.GetFile(ctx, req.Eid, file.LibraryID, file.ID)
	if err != nil {
		return nil, err
	}
	return &WikiSpaceProgressDetailResponse{
		SpaceID:      spaceCtx.space.ID,
		LibraryID:    lib.ID,
		LibraryName:  lib.Name,
		LibraryKind:  lib.LibraryKind,
		ProgressItem: buildWikiSpaceProgressItemFromDetail(detail.ProgressItem, lib),
		Jobs:         detail.Jobs,
		Steps:        detail.Steps,
		WikiPages:    detail.WikiPages,
		Logs:         detail.Logs,
		Libraries:    spaceCtx.refs,
	}, nil
}

func (s *wikiSpaceReadService) resolveVisibleSpaceLibraries(ctx context.Context, req WikiSpaceBaseRequest) (*wikiSpaceLibrariesContext, error) {
	if s == nil || s.db == nil {
		return nil, fmt.Errorf("wiki space read db is required")
	}
	if req.Eid <= 0 || req.UserID <= 0 || req.SpaceID <= 0 {
		return nil, fmt.Errorf("eid, user_id and space_id are required")
	}

	space, err := model.GetSpaceByID(req.Eid, req.SpaceID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrWikiSpaceNotFound
		}
		return nil, err
	}

	if !req.IsAdmin {
		spacePerm, err := getWikiSpaceReadPermission(req.Eid, model.RESOURCE_TYPE_SPACE, req.SpaceID, req.UserID)
		if err != nil || spacePerm < model.PERMISSION_PUBLIC_ONLY {
			return nil, ErrWikiSpaceForbidden
		}
	}

	libraries, err := model.GetLibrariesBySpaceID(req.Eid, req.SpaceID)
	if err != nil {
		return nil, err
	}
	sort.SliceStable(libraries, func(i, j int) bool {
		if libraries[i].Sort != libraries[j].Sort {
			return libraries[i].Sort < libraries[j].Sort
		}
		return libraries[i].ID < libraries[j].ID
	})

	byID := make(map[int64]model.Library, len(libraries))
	visible := make([]model.Library, 0, len(libraries))
	ids := make([]int64, 0, len(libraries))
	for _, library := range libraries {
		if library.Status != model.LIBRARY_STATUS_ACTIVE {
			continue
		}
		if req.LibraryID > 0 && library.ID != req.LibraryID {
			continue
		}
		visible = append(visible, library)
		ids = append(ids, library.ID)
		byID[library.ID] = library
	}

	if req.LibraryID > 0 && len(visible) == 0 {
		return nil, ErrWikiSpaceLibraryNotVisible
	}

	return &wikiSpaceLibrariesContext{
		space:     space,
		libraries: visible,
		refs:      buildWikiSpaceLibraryRefs(visible),
		ids:       ids,
		byID:      byID,
	}, nil
}

func (s *wikiSpaceReadService) GetStats(ctx context.Context, req WikiSpaceBaseRequest) (*WikiSpaceStatsResponse, error) {
	spaceCtx, err := s.resolveVisibleSpaceLibraries(ctx, req)
	if err != nil {
		return nil, err
	}

	wikiCounts, err := model.CountWikiPagesByTypes(req.Eid, req.SpaceID)
	if err != nil {
		return nil, err
	}

	now := time.Now()
	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location()).UnixMilli()
	totalDocs, monthNewDocs, err := model.CountFilesInLibraries(req.Eid, spaceCtx.ids, monthStart)
	if err != nil {
		return nil, err
	}
	wikiCompiledDocs, err := s.countSuccessfulWikiCompiledDocs(ctx, req.Eid, spaceCtx.ids)
	if err != nil {
		return nil, err
	}

	return &WikiSpaceStatsResponse{
		WikiSummaryCount: wikiCounts[model.WikiPageTypeSummary],
		WikiEntityCount:  wikiCounts[model.WikiPageTypeEntity],
		WikiConceptCount: wikiCounts[model.WikiPageTypeConcept],
		MonthNewDocs:     monthNewDocs,
		TotalDocs:        totalDocs,
		WikiCompiledDocs: wikiCompiledDocs,
	}, nil
}

func (s *wikiSpaceReadService) countSuccessfulWikiCompiledDocs(ctx context.Context, eid int64, libraryIDs []int64) (int64, error) {
	if len(libraryIDs) == 0 {
		return 0, nil
	}

	var count int64
	err := s.db.WithContext(ctx).
		Model(&model.File{}).
		Joins("INNER JOIN rag_jobs ON rag_jobs.related_id = files.id AND rag_jobs.eid = files.eid").
		Where("files.eid = ? AND files.library_id IN ? AND files.is_deleted = ? AND files.type = ?", eid, libraryIDs, false, model.FILE_TYPE_FILE).
		Where("rag_jobs.type = ? AND rag_jobs.status = ?", wikiAutoTriggerJobType, model.RagJobStatusSuccess).
		Select("COUNT(DISTINCT rag_jobs.related_id)").
		Scan(&count).Error
	return count, err
}

func (s *wikiSpaceReadService) loadRecentPagesByTypeAcrossLibraries(ctx context.Context, eid int64, libraryIDs []int64, pageType string, dst *[]WikiSpacePageSummary, libs map[int64]model.Library) error {
	var pages []model.WikiPage
	if err := s.db.WithContext(ctx).
		Where("eid = ? AND library_id IN ? AND status = ? AND page_type = ?", eid, libraryIDs, model.WikiPageStatusActive, pageType).
		Order("updated_time DESC, id DESC").
		Limit(10).
		Find(&pages).Error; err != nil {
		return err
	}
	folderPaths, err := s.pageRead.loadFolderPathMap(ctx, pages)
	if err != nil {
		return err
	}
	items := make([]WikiSpacePageSummary, 0, len(pages))
	for i := range pages {
		lib := libs[pages[i].LibraryID]
		items = append(items, buildWikiSpacePageSummary(&pages[i], lib, folderPaths[pages[i].FolderID]))
	}
	*dst = items
	return nil
}

func buildWikiSpaceLibraryRefs(libraries []model.Library) []WikiSpaceLibraryRef {
	if len(libraries) == 0 {
		return []WikiSpaceLibraryRef{}
	}
	refs := make([]WikiSpaceLibraryRef, 0, len(libraries))
	for _, library := range libraries {
		refs = append(refs, WikiSpaceLibraryRef{
			ID:          library.ID,
			Name:        library.Name,
			LibraryKind: library.LibraryKind,
			Permission:  library.Permission,
		})
	}
	return refs
}

func buildWikiSpacePageSummary(page *model.WikiPage, library model.Library, folderPath string) WikiSpacePageSummary {
	summary := toWikiPageSummary(page, folderPath)
	return WikiSpacePageSummary{
		WikiPageSummary: summary,
		SpaceID:         library.SpaceID,
		LibraryName:     library.Name,
		LibraryKind:     library.LibraryKind,
	}
}

func wrapWikiSpacePageSummaries(pages []WikiPageSummary, library model.Library) []WikiSpacePageSummary {
	if len(pages) == 0 {
		return []WikiSpacePageSummary{}
	}
	items := make([]WikiSpacePageSummary, 0, len(pages))
	for _, page := range pages {
		items = append(items, WikiSpacePageSummary{
			WikiPageSummary: page,
			SpaceID:         library.SpaceID,
			LibraryName:     library.Name,
			LibraryKind:     library.LibraryKind,
		})
	}
	return items
}

func buildWikiSpacePageDetailResponse(detail *WikiPageDetail, library model.Library, refs []WikiSpaceLibraryRef) *WikiSpacePageDetailResponse {
	if detail == nil {
		return nil
	}
	resp := &WikiSpacePageDetailResponse{
		SpaceID:        library.SpaceID,
		LibraryID:      library.ID,
		LibraryName:    library.Name,
		LibraryKind:    library.LibraryKind,
		Page:           *detail,
		Sources:        detail.Sources,
		Links:          detail.Links,
		Backlinks:      detail.Backlinks,
		CurrentVersion: detail.CurrentVersion,
		Libraries:      refs,
	}
	return resp
}

func buildWikiSpaceProgressItem(ctx context.Context, db *gorm.DB, file *model.File, library model.Library) WikiSpaceProgressItem {
	item := buildWikiProgressItem(ctx, db, file)
	return buildWikiSpaceProgressItemFromItem(item, library)
}

func buildWikiSpaceProgressItemFromItem(item WikiProgressItem, library model.Library) WikiSpaceProgressItem {
	return WikiSpaceProgressItem{
		WikiProgressItem: item,
		LibraryID:        library.ID,
		LibraryName:      library.Name,
		LibraryKind:      library.LibraryKind,
	}
}

func buildWikiSpaceProgressItemFromDetail(item WikiProgressItem, library model.Library) WikiSpaceProgressItem {
	return buildWikiSpaceProgressItemFromItem(item, library)
}

func wrapWikiSpaceProgressItems(items []WikiProgressItem, library model.Library) []WikiSpaceProgressItem {
	if len(items) == 0 {
		return []WikiSpaceProgressItem{}
	}
	out := make([]WikiSpaceProgressItem, 0, len(items))
	for _, item := range items {
		out = append(out, buildWikiSpaceProgressItemFromItem(item, library))
	}
	return out
}
