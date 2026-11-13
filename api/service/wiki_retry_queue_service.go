package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

const wikiManualRetryCountKey = "__wiki_manual_retry_count"

type WikiRetryQueueListRequest struct {
	Eid     int64
	UserID  int64
	SpaceID int64
	Status  string
	Keyword string
	Page    int
	Size    int
}

type WikiRetryQueueItem struct {
	ID                  string `json:"id"`
	Title               string `json:"title"`
	Type                string `json:"type"`
	Status              string `json:"status"`
	FailureSummary      string `json:"failure_summary"`
	Time                int64  `json:"time"`
	RetryCount          int    `json:"retry_count"`
	RetryEligible       bool   `json:"retry_eligible"`
	RelatedResourceType string `json:"related_resource_type"`
	PageID              string `json:"page_id,omitempty"`
	PageSlug            string `json:"page_slug,omitempty"`
	FileID              string `json:"file_id,omitempty"`
	LibraryID           string `json:"library_id,omitempty"`
}

type WikiQueueDocumentTask struct {
	ID     string `json:"id"`
	FileID string `json:"file_id"`
	Title  string `json:"title"`
	Type   string `json:"type"`
	Status string `json:"status"`
	Time   int64  `json:"time"`
}

// WikiRetryQueueListResponse 返回 Wiki 可重试任务和近期文档管线任务。
type WikiRetryQueueListResponse struct {
	Items           []WikiRetryQueueItem    `json:"items"`
	DocumentTasks   []WikiQueueDocumentTask `json:"document_tasks"`
	ProcessingItems []WikiQueueDocumentTask `json:"processing_items"`
	Total           int64                   `json:"total"`
	StatusCounts    map[string]int64        `json:"status_counts"`
	Page            int                     `json:"page"`
	Size            int                     `json:"size"`
}

type WikiRetryQueueService interface {
	List(ctx context.Context, req WikiRetryQueueListRequest) (*WikiRetryQueueListResponse, error)
}

type wikiRetryQueueService struct {
	db *gorm.DB
}

func NewWikiRetryQueueService(db *gorm.DB) WikiRetryQueueService {
	return &wikiRetryQueueService{db: db}
}

type wikiRetryQueueJobRow struct {
	Eid              int64  `gorm:"column:eid"`
	JobID            int64  `gorm:"column:job_id"`
	Type             string `gorm:"column:type"`
	Status           string `gorm:"column:status"`
	FailureReason    string `gorm:"column:failure_reason"`
	StartParameters  string `gorm:"column:start_parameters"`
	RelatedID        int64  `gorm:"column:related_id"`
	UpdatedTime      int64  `gorm:"column:updated_time"`
	Title            string `gorm:"column:resource_title"`
	FileID           int64  `gorm:"column:resource_file_id"`
	LibraryID        int64  `gorm:"column:resource_library_id"`
	Slug             string `gorm:"column:resource_slug"`
	CurrentVersionID int64  `gorm:"column:current_version_id"`
}

const wikiRetryQueueScanBatchSize = 200

const wikiQueueDocumentTaskRetention = 24 * time.Hour

var wikiRetryQueueStatuses = []string{
	model.RagJobStatusFailed,
	model.RagJobStatusPending,
	model.RagJobStatusProcessing,
	model.RagJobStatusSuccess,
}

type wikiRetryQueueCursor struct {
	updatedTime int64
	jobID       int64
}

type wikiRetryQueueStream struct {
	jobType string
	rows    []wikiRetryQueueJobRow
	cursor  wikiRetryQueueCursor
	done    bool
}

func (s *wikiRetryQueueService) List(ctx context.Context, req WikiRetryQueueListRequest) (*WikiRetryQueueListResponse, error) {
	if s == nil || s.db == nil {
		return nil, fmt.Errorf("wiki retry queue database is required")
	}
	if req.Eid <= 0 || req.UserID <= 0 {
		return nil, fmt.Errorf("eid and user_id are required")
	}
	if req.Page < 1 {
		req.Page = 1
	}
	if req.Size < 1 {
		req.Size = 20
	}
	if req.Size > 100 {
		req.Size = 100
	}

	streams := []wikiRetryQueueStream{{jobType: "wiki_page_generation"}, {jobType: "wiki_page_vectorization"}}
	offset, end := wikiRetryQueuePageRange(req.Page, req.Size)
	items := make([]WikiRetryQueueItem, 0, req.Size)
	statusCounts := map[string]int64{
		model.RagJobStatusFailed:     0,
		model.RagJobStatusPending:    0,
		model.RagJobStatusProcessing: 0,
		model.RagJobStatusSuccess:    0,
	}
	var total int64
	for {
		for i := range streams {
			if len(streams[i].rows) == 0 && !streams[i].done {
				if err := s.fillWikiRetryQueueStream(ctx, req, &streams[i]); err != nil {
					return nil, err
				}
			}
		}
		if wikiRetryQueueStreamsEmpty(streams) {
			break
		}

		batch := make([]wikiRetryQueueJobRow, 0, wikiRetryQueueScanBatchSize)
		for len(batch) < wikiRetryQueueScanBatchSize {
			for i := range streams {
				if len(streams[i].rows) == 0 && !streams[i].done {
					if err := s.fillWikiRetryQueueStream(ctx, req, &streams[i]); err != nil {
						return nil, err
					}
				}
			}
			selected := nextWikiRetryQueueStream(streams)
			if selected < 0 {
				break
			}
			batch = append(batch, streams[selected].rows[0])
			streams[selected].rows = streams[selected].rows[1:]
		}

		permissions, err := wikiRetryQueuePermissions(ctx, req, batch)
		if err != nil {
			return nil, err
		}
		for _, job := range batch {
			if _, ok := statusCounts[job.Status]; !ok {
				continue
			}
			resourceID, resourceType := job.FileID, model.RESOURCE_TYPE_FILE
			if job.Type == "wiki_page_vectorization" {
				resourceID, resourceType = job.RelatedID, model.RESOURCE_TYPE_WIKI_PAGE
			}
			if permissions[resourceType][resourceID] < model.PERMISSION_VIEW_ONLY {
				continue
			}
			statusCounts[job.Status]++
			if req.Status != "" && req.Status != job.Status {
				continue
			}

			if total >= offset && total < end {
				item, err := wikiRetryQueueItem(job)
				if err != nil {
					return nil, err
				}
				items = append(items, item)
			}
			total++
		}
	}
	documentTasks, err := s.listDocumentTasks(ctx, req)
	if err != nil {
		return nil, err
	}
	processingItems := make([]WikiQueueDocumentTask, 0, len(documentTasks))
	for _, task := range documentTasks {
		if task.Status == model.RagJobStatusPending || task.Status == model.RagJobStatusProcessing {
			processingItems = append(processingItems, task)
		}
	}
	return &WikiRetryQueueListResponse{
		Items: items, DocumentTasks: documentTasks, ProcessingItems: processingItems, Total: total, StatusCounts: statusCounts, Page: req.Page, Size: req.Size,
	}, nil
}

func (s *wikiRetryQueueService) listDocumentTasks(ctx context.Context, req WikiRetryQueueListRequest) ([]WikiQueueDocumentTask, error) {
	query := s.db.WithContext(ctx).Table("rag_jobs").
		Select("rag_jobs.job_id, rag_jobs.type, rag_jobs.status, rag_jobs.related_id, rag_jobs.updated_time, COALESCE(NULLIF(upload_files.file_name, ''), files.path) AS resource_title, files.id AS resource_file_id").
		Joins("JOIN files ON files.id = rag_jobs.related_id AND files.eid = rag_jobs.eid").
		Joins("JOIN libraries ON libraries.id = files.library_id AND libraries.eid = files.eid").
		Joins("LEFT JOIN upload_files ON upload_files.id = files.upload_file_id AND upload_files.eid = files.eid").
		Where("rag_jobs.eid = ? AND rag_jobs.type IN ? AND rag_jobs.status IN ? AND rag_jobs.updated_time >= ? AND files.is_deleted = ?", req.Eid, []string{"document_parsing", "document_chunking"}, []string{model.RagJobStatusPending, model.RagJobStatusProcessing, model.RagJobStatusPaused, model.RagJobStatusSuccess, model.RagJobStatusFailed, model.RagJobStatusCancelled}, time.Now().Add(-wikiQueueDocumentTaskRetention).UnixMilli(), false)
	if req.SpaceID > 0 {
		query = query.Where("libraries.space_id = ?", req.SpaceID)
	}
	if keyword := strings.TrimSpace(req.Keyword); keyword != "" {
		query = query.Where("lower(COALESCE(NULLIF(upload_files.file_name, ''), files.path)) LIKE ?", "%"+strings.ToLower(keyword)+"%")
	}
	var jobs []wikiRetryQueueJobRow
	if err := query.Order("rag_jobs.updated_time DESC").Order("rag_jobs.job_id DESC").Limit(20).Find(&jobs).Error; err != nil {
		return nil, fmt.Errorf("load recent document pipeline jobs: %w", err)
	}
	permissions, err := wikiRetryQueuePermissions(ctx, req, jobs)
	if err != nil {
		return nil, err
	}
	items := make([]WikiQueueDocumentTask, 0, len(jobs))
	for _, job := range jobs {
		if permissions[model.RESOURCE_TYPE_FILE][job.FileID] < model.PERMISSION_VIEW_ONLY {
			continue
		}
		jobID, err := hashids.Encode(job.JobID)
		if err != nil {
			return nil, fmt.Errorf("encode document task id: %w", err)
		}
		fileID, err := hashids.Encode(job.FileID)
		if err != nil {
			return nil, fmt.Errorf("encode document task file id: %w", err)
		}
		items = append(items, WikiQueueDocumentTask{
			ID: jobID, FileID: fileID, Title: filepath.Base(job.Title), Type: job.Type, Status: job.Status, Time: job.UpdatedTime,
		})
	}
	return items, nil
}

func (s *wikiRetryQueueService) fillWikiRetryQueueStream(ctx context.Context, req WikiRetryQueueListRequest, stream *wikiRetryQueueStream) error {
	query := s.db.WithContext(ctx).Table("rag_jobs")
	switch stream.jobType {
	case "wiki_page_generation":
		query = query.Select("rag_jobs.eid, rag_jobs.job_id, rag_jobs.type, rag_jobs.status, rag_jobs.failure_reason, rag_jobs.start_parameters, rag_jobs.related_id, rag_jobs.updated_time, COALESCE(NULLIF(upload_files.file_name, ''), files.path) AS resource_title, files.id AS resource_file_id, libraries.id AS resource_library_id").
			Joins("JOIN files ON files.id = rag_jobs.related_id AND files.eid = rag_jobs.eid").
			Joins("JOIN libraries ON libraries.id = files.library_id AND libraries.eid = files.eid").
			Joins("LEFT JOIN upload_files ON upload_files.id = files.upload_file_id AND upload_files.eid = files.eid").
			Where("rag_jobs.eid = ? AND rag_jobs.type = ? AND files.is_deleted = ?", req.Eid, stream.jobType, false)
		if req.SpaceID > 0 {
			query = query.Where("libraries.space_id = ?", req.SpaceID)
		}
	case "wiki_page_vectorization":
		query = query.Select("rag_jobs.eid, rag_jobs.job_id, rag_jobs.type, rag_jobs.status, rag_jobs.failure_reason, rag_jobs.start_parameters, rag_jobs.related_id, rag_jobs.updated_time, wiki_pages.title AS resource_title, wiki_pages.slug AS resource_slug, wiki_pages.current_version_id").
			Joins("JOIN wiki_pages ON wiki_pages.id = rag_jobs.related_id AND wiki_pages.eid = rag_jobs.eid").
			Where("rag_jobs.eid = ? AND rag_jobs.type = ?", req.Eid, stream.jobType)
		if req.SpaceID > 0 {
			query = query.Where("wiki_pages.space_id = ?", req.SpaceID)
		}
	}
	query = query.Where("rag_jobs.status IN ?", wikiRetryQueueStatuses)
	query = applyWikiRetryQueueFilters(query, req, stream.jobType)
	for {
		batchQuery := query.Session(&gorm.Session{})
		if stream.cursor.jobID > 0 {
			batchQuery = batchQuery.Where("(rag_jobs.updated_time < ?) OR (rag_jobs.updated_time = ? AND rag_jobs.job_id < ?)", stream.cursor.updatedTime, stream.cursor.updatedTime, stream.cursor.jobID)
		}
		var rows []wikiRetryQueueJobRow
		if err := batchQuery.Limit(wikiRetryQueueScanBatchSize).Find(&rows).Error; err != nil {
			return fmt.Errorf("load %s wiki jobs: %w", stream.jobType, err)
		}
		if len(rows) == 0 {
			stream.done = true
			stream.rows = nil
			return nil
		}
		last := rows[len(rows)-1]
		stream.cursor = wikiRetryQueueCursor{updatedTime: last.UpdatedTime, jobID: last.JobID}
		var err error
		if stream.jobType == wikiPageVectorizationJobType {
			rows, err = s.currentWikiVectorizationJobs(ctx, rows)
			if err != nil {
				return err
			}
		}
		if stream.jobType == wikiPageVectorizationJobType && len(rows) > 0 {
			rows, err = s.markPartiallyFailedWikiJobs(ctx, rows)
			if err != nil {
				return err
			}
		}
		if len(rows) > 0 {
			stream.rows = rows
			return nil
		}
	}
}

// currentWikiVectorizationJobs excludes superseded versions and attempts from both the list and its counts.
func (s *wikiRetryQueueService) currentWikiVectorizationJobs(ctx context.Context, rows []wikiRetryQueueJobRow) ([]wikiRetryQueueJobRow, error) {
	latest, err := loadCurrentWikiVectorizationJobs(ctx, s.db, rows)
	if err != nil {
		return nil, err
	}
	latestIDs := make(map[int64]int64, len(latest))
	for _, row := range latest {
		latestIDs[row.RelatedID] = row.JobID
	}
	current := make([]wikiRetryQueueJobRow, 0, len(rows))
	for _, row := range rows {
		if latestIDs[row.RelatedID] == row.JobID {
			current = append(current, row)
		}
	}
	return current, nil
}

func loadCurrentWikiVectorizationJobs(ctx context.Context, db *gorm.DB, rows []wikiRetryQueueJobRow) ([]wikiRetryQueueJobRow, error) {
	if len(rows) == 0 {
		return []wikiRetryQueueJobRow{}, nil
	}
	versions := make(map[int64]int64, len(rows))
	pageIDs := make([]int64, 0, len(rows))
	for _, row := range rows {
		if _, ok := versions[row.RelatedID]; !ok {
			pageIDs = append(pageIDs, row.RelatedID)
			versions[row.RelatedID] = row.CurrentVersionID
		}
	}
	var jobs []model.RagJob
	if err := db.WithContext(ctx).Select("eid, job_id, type, related_id, start_parameters, status, failure_reason, updated_time").
		Where("eid = ? AND type = ? AND related_id IN ?", rows[0].Eid, wikiPageVectorizationJobType, pageIDs).
		Order("job_id DESC").Find(&jobs).Error; err != nil {
		return nil, fmt.Errorf("load current wiki page tasks: %w", err)
	}
	latestJobIDs := make(map[int64]int64, len(pageIDs))
	current := make([]wikiRetryQueueJobRow, 0, len(pageIDs))
	for _, job := range jobs {
		if latestJobIDs[job.RelatedId] > 0 {
			continue
		}
		params, err := parseWikiPageVectorizationParameters(&job)
		if err == nil && params.PageID == job.RelatedId && params.VersionID == versions[job.RelatedId] {
			latestJobIDs[job.RelatedId] = job.JobID
			current = append(current, wikiRetryQueueJobRow{Eid: job.Eid, JobID: job.JobID, Type: job.Type, RelatedID: job.RelatedId, StartParameters: job.StartParameters, Status: job.Status, FailureReason: job.FailureReason, UpdatedTime: job.UpdatedTime, CurrentVersionID: params.VersionID})
		}
	}
	return current, nil
}

func wikiRetryQueueStreamsEmpty(streams []wikiRetryQueueStream) bool {
	for _, stream := range streams {
		if len(stream.rows) > 0 {
			return false
		}
	}
	return true
}

func (s *wikiRetryQueueService) markPartiallyFailedWikiJobs(ctx context.Context, rows []wikiRetryQueueJobRow) ([]wikiRetryQueueJobRow, error) {
	if len(rows) == 0 {
		return rows, nil
	}
	pageIDs := make([]int64, 0, len(rows))
	versions := make(map[int64]int64, len(rows))
	for _, row := range rows {
		pageIDs = append(pageIDs, row.RelatedID)
		versions[row.RelatedID] = row.CurrentVersionID
	}
	type failedChunk struct {
		WikiPageID        int64  `gorm:"column:wiki_page_id"`
		WikiPageVersionID int64  `gorm:"column:wiki_page_version_id"`
		ErrorMessage      string `gorm:"column:error_message"`
	}
	var chunks []failedChunk
	if err := s.db.WithContext(ctx).Table("wiki_page_chunks").
		Select("wiki_page_id, wiki_page_version_id, error_message").
		Where("eid = ? AND wiki_page_id IN ? AND (index_status IN ? OR embedding_status = ?)", rows[0].Eid, pageIDs, []string{model.WikiPageChunkIndexStatusFailed, model.WikiPageChunkIndexStatusOversized}, model.WikiPageChunkEmbeddingStatusFailed).
		Find(&chunks).Error; err != nil {
		return nil, err
	}
	failures := make(map[int64]string, len(chunks))
	for _, chunk := range chunks {
		if versions[chunk.WikiPageID] != chunk.WikiPageVersionID {
			continue
		}
		message := strings.TrimSpace(chunk.ErrorMessage)
		if message == "" {
			message = "页面仍有未完成的索引内容"
		}
		failures[chunk.WikiPageID] = message
	}
	updated := make([]wikiRetryQueueJobRow, 0, len(rows))
	for _, row := range rows {
		if message, ok := failures[row.RelatedID]; ok && row.Status == model.RagJobStatusSuccess {
			row.Status = model.RagJobStatusFailed
			row.FailureReason = message
		}
		updated = append(updated, row)
	}
	return updated, nil
}

// RetryPartiallyFailedWikiPageVectorization schedules a fresh indexing job for a completed task with failed chunks.
func RetryPartiallyFailedWikiPageVectorization(ctx context.Context, db *gorm.DB, job *model.RagJob) error {
	params, err := parseWikiPageVectorizationParameters(job)
	if err != nil {
		return err
	}
	if job.Status != model.RagJobStatusSuccess || job.RelatedId != params.PageID {
		return fmt.Errorf("任务状态已变化，请刷新后重试")
	}
	var page model.WikiPage
	if err := db.WithContext(ctx).Where("eid = ? AND id = ?", job.Eid, params.PageID).First(&page).Error; err != nil {
		return err
	}
	if page.CurrentVersionID != params.VersionID {
		return fmt.Errorf("Wiki 页面已更新，请刷新任务后重试")
	}
	var failedChunk model.WikiPageChunk
	if err := db.WithContext(ctx).Where("eid = ? AND wiki_page_id = ? AND wiki_page_version_id = ? AND (index_status IN ? OR embedding_status = ?)", job.Eid, page.ID, params.VersionID, []string{model.WikiPageChunkIndexStatusFailed, model.WikiPageChunkIndexStatusOversized}, model.WikiPageChunkEmbeddingStatusFailed).First(&failedChunk).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return fmt.Errorf("任务没有待修复的页面索引内容")
		}
		return err
	}
	if _, err := createWikiPageVectorizationJob(ctx, db, common.RDB, job.Eid, page.ID, params.VersionID, true, "manual_retry_partial"); err != nil {
		return fmt.Errorf("创建 Wiki 页面重索引任务失败: %w", err)
	}
	return nil
}

func nextWikiRetryQueueStream(streams []wikiRetryQueueStream) int {
	selected := -1
	for i := range streams {
		if len(streams[i].rows) == 0 {
			continue
		}
		if selected < 0 || wikiRetryQueueJobAfter(streams[selected].rows[0], streams[i].rows[0]) {
			selected = i
		}
	}
	return selected
}

func wikiRetryQueueJobAfter(a, b wikiRetryQueueJobRow) bool {
	if a.UpdatedTime == b.UpdatedTime {
		return a.JobID < b.JobID
	}
	return a.UpdatedTime < b.UpdatedTime
}

func wikiRetryQueuePageRange(page, size int) (int64, int64) {
	maxInt64 := int64(^uint64(0) >> 1)
	pageOffset := int64(page - 1)
	if pageOffset > maxInt64/int64(size) {
		return maxInt64, maxInt64
	}
	start := pageOffset * int64(size)
	if start > maxInt64-int64(size) {
		return start, maxInt64
	}
	return start, start + int64(size)
}

func wikiRetryQueueItem(job wikiRetryQueueJobRow) (WikiRetryQueueItem, error) {
	jobID, err := hashids.Encode(job.JobID)
	if err != nil {
		return WikiRetryQueueItem{}, fmt.Errorf("encode wiki job id: %w", err)
	}
	item := WikiRetryQueueItem{
		ID: jobID, Title: wikiRetryQueueTitle(job), Type: job.Type, Status: job.Status,
		FailureSummary: wikiRetryQueueFailureSummary(job.FailureReason), Time: job.UpdatedTime,
		RetryCount: wikiManualRetryCount(job.StartParameters), RetryEligible: job.Status == model.RagJobStatusFailed,
	}
	if job.Status != model.RagJobStatusFailed {
		item.FailureSummary = ""
	}
	if job.Type == "wiki_page_generation" {
		item.RelatedResourceType = "file"
		item.FileID, err = hashids.Encode(job.FileID)
		if err == nil {
			item.LibraryID, err = hashids.Encode(job.LibraryID)
		}
	} else {
		item.RelatedResourceType = "wiki_page"
		item.PageID, err = hashids.Encode(job.RelatedID)
		item.PageSlug = job.Slug
	}
	if err != nil {
		return WikiRetryQueueItem{}, fmt.Errorf("encode wiki resource id: %w", err)
	}
	return item, nil
}

func applyWikiRetryQueueFilters(query *gorm.DB, req WikiRetryQueueListRequest, jobType string) *gorm.DB {
	if keyword := strings.TrimSpace(req.Keyword); keyword != "" {
		pattern := "%" + strings.ToLower(keyword) + "%"
		condition := query.Session(&gorm.Session{NewDB: true})
		switch jobType {
		case "wiki_page_generation":
			condition = condition.Where("lower(COALESCE(NULLIF(upload_files.file_name, ''), files.path)) LIKE ?", pattern).
				Or("lower(rag_jobs.failure_reason) LIKE ?", pattern)
		case "wiki_page_vectorization":
			condition = condition.Where("lower(wiki_pages.title) LIKE ?", pattern).
				Or("lower(rag_jobs.failure_reason) LIKE ?", pattern)
		}
		query = query.Where(condition)
	}
	return query.Order("rag_jobs.updated_time DESC").Order("rag_jobs.job_id DESC")
}

func wikiRetryQueuePermissions(ctx context.Context, req WikiRetryQueueListRequest, jobs []wikiRetryQueueJobRow) (map[int]map[int64]int, error) {
	fileIDs, pageIDs := make([]int64, 0), make([]int64, 0)
	for _, job := range jobs {
		if job.Type == "wiki_page_vectorization" {
			pageIDs = append(pageIDs, job.RelatedID)
		} else {
			fileIDs = append(fileIDs, job.FileID)
		}
	}
	result := map[int]map[int64]int{
		model.RESOURCE_TYPE_FILE:      {},
		model.RESOURCE_TYPE_WIKI_PAGE: {},
	}
	if len(fileIDs) > 0 {
		permissions, err := common.BatchGetUserPermissions(req.Eid, model.RESOURCE_TYPE_FILE, fileIDs, req.UserID, ctx)
		if err != nil {
			return nil, err
		}
		result[model.RESOURCE_TYPE_FILE] = permissions
	}
	if len(pageIDs) > 0 {
		permissions, err := batchGetWikiPermissions(req.Eid, model.RESOURCE_TYPE_WIKI_PAGE, pageIDs, req.UserID, ctx)
		if err != nil {
			return nil, err
		}
		result[model.RESOURCE_TYPE_WIKI_PAGE] = permissions
	}
	return result, nil
}

func wikiRetryQueueTitle(job wikiRetryQueueJobRow) string {
	if job.Type == "wiki_page_generation" {
		return filepath.Base(job.Title)
	}
	return job.Title
}

func wikiRetryQueueFailureSummary(reason string) string {
	const maxFailureSummaryRunes = 200
	reason = strings.TrimSpace(reason)
	if utf8.RuneCountInString(reason) <= maxFailureSummaryRunes {
		return reason
	}
	runes := []rune(reason)
	return string(runes[:maxFailureSummaryRunes]) + "…"
}

func wikiManualRetryCount(startParameters string) int {
	var params map[string]json.RawMessage
	if json.Unmarshal([]byte(startParameters), &params) != nil {
		return 0
	}
	var count int
	if json.Unmarshal(params[wikiManualRetryCountKey], &count) != nil || count < 0 {
		return 0
	}
	return count
}
