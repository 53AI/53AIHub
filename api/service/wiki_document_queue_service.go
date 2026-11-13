package service

import (
	"context"
	"path/filepath"
	"sort"
	"strings"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

type WikiDocumentQueueRequest struct {
	Eid, UserID, SpaceID, LibraryID int64
	Status, Keyword                 string
	Page, Size                      int
}

type WikiDocumentPageCounts struct {
	Total       int `json:"total"`
	Success     int `json:"success"`
	Failed      int `json:"failed"`
	Processing  int `json:"processing"`
	Pending     int `json:"pending"`
	Waiting     int `json:"waiting"`
	NotRequired int `json:"not_required"`
}

type WikiDocumentQueueItem struct {
	FileID           int64                  `json:"file_id"`
	Title            string                 `json:"title"`
	LibraryID        int64                  `json:"library_id"`
	LibraryName      string                 `json:"library_name"`
	Status           string                 `json:"status"`
	GenerationStatus string                 `json:"generation_status"`
	GenerationTaskID *int64                 `json:"generation_task_id,omitempty"`
	PageCounts       WikiDocumentPageCounts `json:"page_counts"`
	FailureSummary   string                 `json:"failure_summary"`
	UpdatedTime      int64                  `json:"updated_time"`
	RetryEligible    bool                   `json:"retry_eligible"`
	RetryTaskIDs     []int64                `json:"retry_task_ids"`
}

type WikiDocumentQueuePage struct {
	PageID              int64  `json:"page_id"`
	PageSlug            string `json:"page_slug"`
	Title               string `json:"title"`
	PageType            string `json:"page_type"`
	PageStatus          string `json:"page_status"`
	CurrentVersionID    *int64 `json:"current_version_id,omitempty"`
	VectorizationStatus string `json:"vectorization_status"`
	VectorizationTaskID *int64 `json:"vectorization_task_id,omitempty"`
	FailureSummary      string `json:"failure_summary"`
	RetryCount          int    `json:"retry_count"`
	RetryEligible       bool   `json:"retry_eligible"`
	UpdatedTime         int64  `json:"updated_time"`
}

type WikiDocumentQueueResponse struct {
	Items        []WikiDocumentQueueItem `json:"items"`
	Total        int64                   `json:"total"`
	StatusCounts map[string]int64        `json:"status_counts"`
	Page         int                     `json:"page"`
	Size         int                     `json:"size"`
}

type WikiDocumentQueuePagesResponse struct {
	Document WikiDocumentQueueItem   `json:"document"`
	Items    []WikiDocumentQueuePage `json:"items"`
	Total    int64                   `json:"total"`
	Page     int                     `json:"page"`
	Size     int                     `json:"size"`
}

type WikiDocumentQueueService struct{ db *gorm.DB }

func NewWikiDocumentQueueService(db *gorm.DB) *WikiDocumentQueueService {
	return &WikiDocumentQueueService{db: db}
}

type wikiDocumentFile struct {
	ID          int64
	LibraryID   int64
	LibraryName string
	Title       string
	Path        string
	UpdatedTime int64
}

type wikiDocumentProjection struct {
	document   WikiDocumentQueueItem
	pages      []WikiDocumentQueuePage
	searchable string
}

const wikiDocumentIDBatchSize = 400

func (s *WikiDocumentQueueService) List(ctx context.Context, req WikiDocumentQueueRequest) (*WikiDocumentQueueResponse, error) {
	req.Page, req.Size = wikiDocumentPagination(req.Page, req.Size, 10)
	result := &WikiDocumentQueueResponse{Items: []WikiDocumentQueueItem{}, StatusCounts: map[string]int64{"failed": 0, "pending": 0, "processing": 0, "success": 0, "waiting": 0}, Page: req.Page, Size: req.Size}
	var documents []WikiDocumentQueueItem
	var cursor int64
	for {
		var files []wikiDocumentFile
		if err := s.candidates(ctx, req).Where("files.id > ?", cursor).Order("files.id ASC").Limit(wikiRetryQueueScanBatchSize).Find(&files).Error; err != nil {
			return nil, err
		}
		if len(files) == 0 {
			break
		}
		cursor = files[len(files)-1].ID
		projections, err := s.project(ctx, req, files)
		if err != nil {
			return nil, err
		}
		keyword := strings.ToLower(strings.TrimSpace(req.Keyword))
		for _, p := range projections {
			if keyword != "" && !strings.Contains(p.searchable, keyword) {
				continue
			}
			result.StatusCounts[p.document.Status]++
			if req.Status == "" || req.Status == p.document.Status {
				documents = append(documents, p.document)
			}
		}
	}
	sort.Slice(documents, func(i, j int) bool {
		if documents[i].UpdatedTime == documents[j].UpdatedTime {
			return documents[i].FileID > documents[j].FileID
		}
		return documents[i].UpdatedTime > documents[j].UpdatedTime
	})
	result.Total = int64(len(documents))
	start, end := wikiDocumentRange(req.Page, req.Size, len(documents))
	result.Items = append(result.Items, documents[start:end]...)
	return result, nil
}

func (s *WikiDocumentQueueService) Pages(ctx context.Context, req WikiDocumentQueueRequest, fileID int64) (*WikiDocumentQueuePagesResponse, error) {
	req.Page, req.Size = wikiDocumentPagination(req.Page, req.Size, 20)
	var files []wikiDocumentFile
	if err := s.candidates(ctx, req).Where("files.id = ?", fileID).Find(&files).Error; err != nil {
		return nil, err
	}
	projections, err := s.project(ctx, req, files)
	if err != nil {
		return nil, err
	}
	if len(projections) == 0 {
		return nil, gorm.ErrRecordNotFound
	}
	p := projections[0]
	start, end := wikiDocumentRange(req.Page, req.Size, len(p.pages))
	return &WikiDocumentQueuePagesResponse{Document: p.document, Items: append([]WikiDocumentQueuePage{}, p.pages[start:end]...), Total: int64(len(p.pages)), Page: req.Page, Size: req.Size}, nil
}

func (s *WikiDocumentQueueService) candidates(ctx context.Context, req WikiDocumentQueueRequest) *gorm.DB {
	db := s.db.WithContext(ctx)
	generated := db.Model(&model.RagJob{}).Select("related_id").Where("eid = ? AND type = ?", req.Eid, "wiki_page_generation")
	indexed := db.Table("wiki_page_sources").Select("wiki_page_sources.source_file_id").
		Joins("JOIN wiki_pages ON wiki_pages.id = wiki_page_sources.page_id AND wiki_pages.eid = wiki_page_sources.eid").
		Joins("JOIN rag_jobs ON rag_jobs.related_id = wiki_pages.id AND rag_jobs.eid = wiki_pages.eid AND rag_jobs.type = ?", wikiPageVectorizationJobType).
		Where("wiki_page_sources.eid = ? AND wiki_pages.space_id = ?", req.Eid, req.SpaceID)
	q := db.Table("files").Select("files.id, files.library_id, files.path, files.updated_time, libraries.name AS library_name, COALESCE(NULLIF(upload_files.file_name, ''), files.path) AS title").
		Joins("JOIN libraries ON libraries.id = files.library_id AND libraries.eid = files.eid").
		Joins("LEFT JOIN upload_files ON upload_files.id = files.upload_file_id AND upload_files.eid = files.eid").
		Where("files.eid = ? AND libraries.space_id = ? AND files.is_deleted = ? AND files.type = ?", req.Eid, req.SpaceID, false, model.FILE_TYPE_FILE).
		Where("files.id IN (?) OR files.id IN (?)", generated, indexed)
	if req.LibraryID > 0 {
		q = q.Where("files.library_id = ?", req.LibraryID)
	}
	return q
}

func (s *WikiDocumentQueueService) project(ctx context.Context, req WikiDocumentQueueRequest, files []wikiDocumentFile) ([]wikiDocumentProjection, error) {
	result := make([]wikiDocumentProjection, 0, len(files))
	if len(files) == 0 {
		return result, nil
	}
	fileIDs := make([]int64, 0, len(files))
	for _, f := range files {
		fileIDs = append(fileIDs, f.ID)
	}
	permissions, err := common.BatchGetUserPermissions(req.Eid, model.RESOURCE_TYPE_FILE, fileIDs, req.UserID, ctx)
	if err != nil {
		return nil, err
	}
	visible := files[:0]
	fileIDs = fileIDs[:0]
	for _, f := range files {
		if permissions[f.ID] >= model.PERMISSION_VIEW_ONLY {
			visible = append(visible, f)
			fileIDs = append(fileIDs, f.ID)
		}
	}
	files = visible
	if len(files) == 0 {
		return result, nil
	}
	db := s.db.WithContext(ctx)
	latestGenerationIDs := db.Model(&model.RagJob{}).Select("MAX(job_id)").Where("eid = ? AND type = ? AND related_id IN ?", req.Eid, "wiki_page_generation", fileIDs).Group("related_id")
	var generationJobs []model.RagJob
	if err := db.Select("job_id, related_id, status, failure_reason, updated_time").Where("job_id IN (?)", latestGenerationIDs).Find(&generationJobs).Error; err != nil {
		return nil, err
	}
	generations := make(map[int64]model.RagJob, len(generationJobs))
	for _, j := range generationJobs {
		generations[j.RelatedId] = j
	}
	var sources []model.WikiPageSource
	if err := db.Select("source_file_id, page_id").Where("eid = ? AND source_file_id IN ?", req.Eid, fileIDs).Find(&sources).Error; err != nil {
		return nil, err
	}
	sourcePageIDs := make(map[int64]struct{})
	for _, src := range sources {
		sourcePageIDs[src.PageID] = struct{}{}
	}
	pageIDs := make([]int64, 0, len(sourcePageIDs))
	for id := range sourcePageIDs {
		pageIDs = append(pageIDs, id)
	}
	var pages []model.WikiPage
	if err := wikiDocumentIDBatches(pageIDs, func(ids []int64) error {
		var batch []model.WikiPage
		if err := db.Select("id, eid, space_id, library_id, current_version_id, title, slug, page_type, status, updated_time").Where("eid = ? AND space_id = ? AND id IN ?", req.Eid, req.SpaceID, ids).Find(&batch).Error; err != nil {
			return err
		}
		pages = append(pages, batch...)
		return nil
	}); err != nil {
		return nil, err
	}
	pageIDs = pageIDs[:0]
	for _, p := range pages {
		pageIDs = append(pageIDs, p.ID)
	}
	pagePerms := map[int64]int{}
	if err := wikiDocumentIDBatches(pageIDs, func(ids []int64) error {
		permissions, err := batchGetWikiPermissions(req.Eid, model.RESOURCE_TYPE_WIKI_PAGE, ids, req.UserID, ctx)
		if err == nil {
			for id, permission := range permissions {
				pagePerms[id] = permission
			}
		}
		return err
	}); err != nil {
		return nil, err
	}
	var taskRows []wikiRetryQueueJobRow
	versionIDs := []int64{}
	for _, p := range pages {
		if pagePerms[p.ID] < model.PERMISSION_VIEW_ONLY {
			continue
		}
		taskRows = append(taskRows, wikiRetryQueueJobRow{Eid: req.Eid, RelatedID: p.ID, CurrentVersionID: p.CurrentVersionID})
		if p.CurrentVersionID > 0 {
			versionIDs = append(versionIDs, p.CurrentVersionID)
		}
	}
	tasks := map[int64]wikiRetryQueueJobRow{}
	pagesWithTasks := map[int64]bool{}
	if err := wikiDocumentIDBatches(taskRows, func(rows []wikiRetryQueueJobRow) error {
		visiblePageIDs := make([]int64, 0, len(rows))
		for _, row := range rows {
			visiblePageIDs = append(visiblePageIDs, row.RelatedID)
		}
		var historicalPageIDs []int64
		if err := db.Model(&model.RagJob{}).Distinct("related_id").Where("eid = ? AND type = ? AND related_id IN ?", req.Eid, wikiPageVectorizationJobType, visiblePageIDs).Pluck("related_id", &historicalPageIDs).Error; err != nil {
			return err
		}
		for _, id := range historicalPageIDs {
			pagesWithTasks[id] = true
		}
		current, err := loadCurrentWikiVectorizationJobs(ctx, s.db, rows)
		if err != nil {
			return err
		}
		current, err = (&wikiRetryQueueService{db: s.db}).markPartiallyFailedWikiJobs(ctx, current)
		if err != nil {
			return err
		}
		for _, j := range current {
			tasks[j.RelatedID] = j
		}
		return nil
	}); err != nil {
		return nil, err
	}
	var versions []model.WikiPageVersion
	if err := wikiDocumentIDBatches(versionIDs, func(ids []int64) error {
		var batch []model.WikiPageVersion
		if err := db.Select("id, page_id, is_published").Where("eid = ? AND id IN ?", req.Eid, ids).Find(&batch).Error; err != nil {
			return err
		}
		versions = append(versions, batch...)
		return nil
	}); err != nil {
		return nil, err
	}
	published := map[int64]int64{}
	for _, v := range versions {
		if v.IsPublished {
			published[v.ID] = v.PageID
		}
	}
	pageViews := map[int64]WikiDocumentQueuePage{}
	for _, p := range pages {
		if pagePerms[p.ID] < model.PERMISSION_VIEW_ONLY {
			continue
		}
		item := WikiDocumentQueuePage{PageID: p.ID, PageSlug: p.Slug, Title: p.Title, PageType: p.PageType, PageStatus: p.Status, UpdatedTime: p.UpdatedTime, VectorizationStatus: "not_required"}
		if p.CurrentVersionID > 0 {
			v := p.CurrentVersionID
			item.CurrentVersionID = &v
		}
		if published[p.CurrentVersionID] == p.ID {
			item.VectorizationStatus = "not_started"
			if job, ok := tasks[p.ID]; ok {
				item.VectorizationStatus = wikiDocumentStatus(job.Status)
				id := job.JobID
				item.VectorizationTaskID = &id
				item.UpdatedTime = job.UpdatedTime
				item.RetryCount = wikiManualRetryCount(job.StartParameters)
				if item.VectorizationStatus == "failed" {
					item.FailureSummary = wikiDocumentFailure(job.Status, job.FailureReason)
					item.RetryEligible = job.Status == model.RagJobStatusFailed && pagePerms[p.ID] >= model.PERMISSION_EDIT_KNOWLEDGE
				}
			}
		}
		pageViews[p.ID] = item
	}
	perFile := map[int64]map[int64]struct{}{}
	for _, src := range sources {
		if perFile[src.SourceFileID] == nil {
			perFile[src.SourceFileID] = map[int64]struct{}{}
		}
		perFile[src.SourceFileID][src.PageID] = struct{}{}
	}
	for _, f := range files {
		gen, hasGeneration := generations[f.ID]
		p := wikiDocumentProjection{document: WikiDocumentQueueItem{FileID: f.ID, Title: filepath.Base(f.Title), LibraryID: f.LibraryID, LibraryName: f.LibraryName, GenerationStatus: "not_started", Status: "success", UpdatedTime: f.UpdatedTime, RetryTaskIDs: []int64{}}, pages: []WikiDocumentQueuePage{}}
		doc := &p.document
		states := []string{}
		hasVisibleTask := false
		if hasGeneration {
			id := gen.JobID
			doc.GenerationTaskID = &id
			doc.GenerationStatus = wikiDocumentStatus(gen.Status)
			states = append(states, doc.GenerationStatus)
			doc.UpdatedTime = gen.UpdatedTime
			if doc.GenerationStatus == "failed" {
				doc.FailureSummary = wikiDocumentFailure(gen.Status, gen.FailureReason)
				if gen.Status == model.RagJobStatusFailed && permissions[f.ID] >= model.PERMISSION_EDIT_KNOWLEDGE {
					doc.RetryTaskIDs = append(doc.RetryTaskIDs, gen.JobID)
				}
			}
		}
		for pageID := range perFile[f.ID] {
			item, ok := pageViews[pageID]
			if !ok {
				continue
			}
			p.pages = append(p.pages, item)
			if pagesWithTasks[pageID] {
				hasVisibleTask = true
			}
		}
		sort.Slice(p.pages, func(i, j int) bool {
			if p.pages[i].UpdatedTime == p.pages[j].UpdatedTime {
				return p.pages[i].PageID > p.pages[j].PageID
			}
			return p.pages[i].UpdatedTime > p.pages[j].UpdatedTime
		})
		for _, item := range p.pages {
			switch item.VectorizationStatus {
			case "success":
				doc.PageCounts.Success++
			case "failed":
				doc.PageCounts.Failed++
			case "processing":
				doc.PageCounts.Processing++
			case "waiting":
				doc.PageCounts.Waiting++
			case "not_required":
				doc.PageCounts.NotRequired++
			default:
				doc.PageCounts.Pending++
			}
			state := item.VectorizationStatus
			if state == "not_started" {
				state = "pending"
			}
			if state != "not_required" {
				states = append(states, state)
			}
			if item.UpdatedTime > doc.UpdatedTime {
				doc.UpdatedTime = item.UpdatedTime
			}
			if doc.FailureSummary == "" && item.FailureSummary != "" {
				doc.FailureSummary = item.FailureSummary
			}
			if doc.GenerationStatus != "failed" && item.RetryEligible {
				doc.RetryTaskIDs = append(doc.RetryTaskIDs, *item.VectorizationTaskID)
			}
		}
		if !hasGeneration && !hasVisibleTask {
			continue
		}
		doc.PageCounts.Total = len(p.pages)
		doc.Status = wikiDocumentAggregateStatus(states)
		doc.RetryEligible = len(doc.RetryTaskIDs) > 0
		sort.Slice(doc.RetryTaskIDs, func(i, j int) bool { return doc.RetryTaskIDs[i] < doc.RetryTaskIDs[j] })
		search := []string{doc.Title, f.Path, doc.FailureSummary}
		for _, page := range p.pages {
			search = append(search, page.Title, page.FailureSummary)
		}
		p.searchable = strings.ToLower(strings.Join(search, "\n"))
		result = append(result, p)
	}
	return result, nil
}

func wikiDocumentStatus(raw string) string {
	switch raw {
	case model.RagJobStatusCancelled:
		return "failed"
	case model.RagJobStatusPaused:
		return "waiting"
	default:
		return raw
	}
}
func wikiDocumentFailure(status, reason string) string {
	if status == model.RagJobStatusCancelled {
		return "任务已取消"
	}
	return wikiRetryQueueFailureSummary(reason)
}
func wikiDocumentAggregateStatus(states []string) string {
	for _, status := range []string{"failed", "processing", "pending", "waiting"} {
		for _, s := range states {
			if s == status {
				return status
			}
		}
	}
	return "success"
}
func wikiDocumentPagination(page, size, fallback int) (int, int) {
	if page < 1 {
		page = 1
	}
	if size < 1 {
		size = fallback
	}
	if size > 100 {
		size = 100
	}
	return page, size
}
func wikiDocumentRange(page, size, total int) (int, int) {
	start, end := wikiRetryQueuePageRange(page, size)
	if start > int64(total) {
		start = int64(total)
	}
	if end > int64(total) {
		end = int64(total)
	}
	return int(start), int(end)
}

func wikiDocumentIDBatches[T any](items []T, visit func([]T) error) error {
	for start := 0; start < len(items); start += wikiDocumentIDBatchSize {
		end := start + wikiDocumentIDBatchSize
		if end > len(items) {
			end = len(items)
		}
		if err := visit(items[start:end]); err != nil {
			return err
		}
	}
	return nil
}
