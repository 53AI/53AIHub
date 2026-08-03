package service

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"sort"
	"strings"

	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

type WikiProgressListRequest struct {
	Eid       int64
	LibraryID int64
	Status    string
	Offset    int
	Limit     int
}

type WikiProgressService interface {
	ListFiles(ctx context.Context, req WikiProgressListRequest) ([]WikiProgressItem, int64, error)
	GetFile(ctx context.Context, eid, libraryID, fileID int64) (*WikiProgressDetail, error)
}

type WikiProgressItem struct {
	FileID         int64                    `json:"file_id"`
	FileName       string                   `json:"file_name"`
	FilePath       string                   `json:"file_path"`
	RunID          string                   `json:"run_id"`
	Status         string                   `json:"status"`
	Progress       int                      `json:"progress"`
	SuccessCount   int                      `json:"success_count"`
	FailureCount   int                      `json:"failure_count"`
	TotalSteps     int                      `json:"total_steps"`
	CurrentJobType string                   `json:"current_job_type"`
	StepKey        string                   `json:"step_key"`
	StepName       string                   `json:"step_name"`
	NextStepKey    string                   `json:"next_step_key"`
	NextStepName   string                   `json:"next_step_name"`
	StartTime      int64                    `json:"start_time"`
	EndTime        int64                    `json:"end_time"`
	DurationMs     int64                    `json:"duration_ms"`
	CompletionTime int64                    `json:"completion_time"`
	TokenUsage     model.RagJobUsageSummary `json:"token_usage"`
	UpdatedTime    int64                    `json:"updated_time"`
}

type WikiProgressJobView struct {
	JobID            int64                    `json:"job_id"`
	Eid              int64                    `json:"eid"`
	Type             string                   `json:"type"`
	Status           string                   `json:"status"`
	CurrentStepOrder int                      `json:"current_step_order"`
	FailureReason    string                   `json:"failure_reason"`
	StartParameters  string                   `json:"start_parameters"`
	Metadata         string                   `json:"metadata"`
	RunID            string                   `json:"run_id"`
	RelatedID        int64                    `json:"related_id"`
	PipelineID       int64                    `json:"pipeline_id"`
	Progress         int                      `json:"progress"`
	CompletionTime   int64                    `json:"completion_time"`
	CreatedTime      int64                    `json:"created_time"`
	UpdatedTime      int64                    `json:"updated_time"`
	TokenUsage       model.RagJobUsageSummary `json:"token_usage"`
	Steps            []WikiProgressStepView   `json:"steps,omitempty"`
}

type WikiProgressStepView struct {
	ID         int64  `json:"id"`
	JobID      int64  `json:"job_id"`
	Eid        int64  `json:"eid"`
	StepOrder  int    `json:"step_order"`
	Parameters string `json:"parameters"`
	Results    string `json:"results"`
	Status     string `json:"status"`
	StartTime  int64  `json:"start_time"`
	EndTime    int64  `json:"end_time"`
	DurationMs int64  `json:"duration_ms"`
}

type WikiProgressWikiPageView struct {
	ID          int64  `json:"id"`
	Slug        string `json:"slug"`
	Title       string `json:"title"`
	PageType    string `json:"page_type"`
	Status      string `json:"status"`
	UpdatedTime int64  `json:"updated_time"`
}

type WikiProgressLogView struct {
	ID          int64  `json:"id"`
	PageID      int64  `json:"page_id"`
	VersionID   int64  `json:"version_id"`
	Action      string `json:"action"`
	RequestID   string `json:"request_id"`
	Message     string `json:"message"`
	CreatedTime int64  `json:"created_time"`
}

type WikiProgressDetail struct {
	ProgressItem WikiProgressItem           `json:"progress_item"`
	Jobs         []WikiProgressJobView      `json:"jobs"`
	Steps        []WikiProgressStepView     `json:"steps"`
	WikiPages    []WikiProgressWikiPageView `json:"wiki_pages"`
	Logs         []WikiProgressLogView      `json:"logs"`
}

type wikiProgressService struct {
	db *gorm.DB
}

func NewWikiProgressService(db *gorm.DB) WikiProgressService {
	return &wikiProgressService{db: db}
}

func (s *wikiProgressService) ListFiles(ctx context.Context, req WikiProgressListRequest) ([]WikiProgressItem, int64, error) {
	if s == nil || s.db == nil {
		return nil, 0, fmt.Errorf("wiki progress db is required")
	}
	if req.Eid <= 0 || req.LibraryID <= 0 {
		return nil, 0, fmt.Errorf("eid and library_id are required")
	}

	limit := normalizeWikiListLimit(req.Limit, 20, 100)
	offset := req.Offset
	if offset < 0 {
		offset = 0
	}

	query := s.db.WithContext(ctx).Model(&model.File{}).
		Where("eid = ? AND library_id = ? AND is_deleted = ? AND type = ?", req.Eid, req.LibraryID, false, model.FILE_TYPE_FILE)
	status := strings.ToLower(strings.TrimSpace(req.Status))
	if status != "" && status != "all" {
		query = query.Where("run_status = ?", status)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var files []model.File
	if err := query.Order("updated_time DESC, id DESC").Offset(offset).Limit(limit).Find(&files).Error; err != nil {
		return nil, 0, err
	}

	items := make([]WikiProgressItem, 0, len(files))
	for i := range files {
		items = append(items, buildWikiProgressItem(ctx, s.db, &files[i]))
	}
	return items, total, nil
}

func (s *wikiProgressService) GetFile(ctx context.Context, eid, libraryID, fileID int64) (*WikiProgressDetail, error) {
	if s == nil || s.db == nil {
		return nil, fmt.Errorf("wiki progress db is required")
	}
	if eid <= 0 || libraryID <= 0 || fileID <= 0 {
		return nil, fmt.Errorf("eid, library_id and file_id are required")
	}

	var file model.File
	if err := s.db.WithContext(ctx).
		Where("eid = ? AND library_id = ? AND id = ? AND is_deleted = ? AND type = ?", eid, libraryID, fileID, false, model.FILE_TYPE_FILE).
		First(&file).Error; err != nil {
		return nil, err
	}

	item := buildWikiProgressItem(ctx, s.db, &file)
	runID, jobs, stepMap, err := getLatestRunJobsWithStepsByRelatedIDForWikiProgress(ctx, s.db, eid, fileID)
	if err != nil {
		return nil, err
	}
	item.RunID = runID
	if strings.TrimSpace(runID) != "" {
		item.TokenUsage = aggregateWikiUsageForRun(ctx, s.db, eid, fileID, runID)
	} else if item.TokenUsage == (model.RagJobUsageSummary{}) {
		item.TokenUsage = aggregateWikiJobUsage(jobs)
	}

	jobViews := make([]WikiProgressJobView, 0, len(jobs))
	allSteps := make([]WikiProgressStepView, 0)
	for _, job := range jobs {
		view := toWikiProgressJobView(job)
		steps := toWikiProgressStepViews(stepMap[job.JobID])
		view.Steps = steps
		jobViews = append(jobViews, view)
		allSteps = append(allSteps, steps...)
	}

	pages, err := s.loadWikiPagesForFile(ctx, eid, libraryID, fileID)
	if err != nil {
		return nil, err
	}
	logs, err := s.loadWikiLogsForPages(ctx, eid, pages)
	if err != nil {
		return nil, err
	}

	return &WikiProgressDetail{
		ProgressItem: item,
		Jobs:         jobViews,
		Steps:        allSteps,
		WikiPages:    pages,
		Logs:         logs,
	}, nil
}

func buildWikiProgressItem(ctx context.Context, db *gorm.DB, file *model.File) WikiProgressItem {
	if file == nil {
		return WikiProgressItem{}
	}

	item := WikiProgressItem{
		FileID:      file.ID,
		FileName:    wikiProgressFileName(db, file),
		FilePath:    strings.TrimSpace(file.Path),
		Status:      strings.ToLower(strings.TrimSpace(file.RunStatus)),
		UpdatedTime: file.UpdatedTime,
	}

	var info model.FileCleaningRuleInfo
	if strings.TrimSpace(file.CleaningRuleInfo) != "" {
		_ = json.Unmarshal([]byte(file.CleaningRuleInfo), &info)
	}
	if item.Status == "" {
		item.Status = strings.ToLower(strings.TrimSpace(info.Status))
	}
	if item.Status == "" {
		item.Status = model.ResolveFileRunStatus(file.CleaningRuleInfo)
	}

	item.RunID = strings.TrimSpace(info.RunID)
	item.Progress = info.Progress
	item.SuccessCount = info.SuccessCount
	item.FailureCount = info.FailureCount
	item.TotalSteps = info.TotalSteps
	item.CurrentJobType = firstNonEmptyWikiHelper(strings.TrimSpace(info.CurrentJobType), strings.TrimSpace(info.StepKey))
	item.StepKey = strings.TrimSpace(info.StepKey)
	item.StepName = strings.TrimSpace(info.StepName)
	item.NextStepKey = strings.TrimSpace(info.NextStepKey)
	item.NextStepName = strings.TrimSpace(info.NextStepName)
	item.StartTime = info.StartTime
	item.EndTime = info.EndTime
	item.DurationMs = 0
	if info.StartTime > 0 && info.EndTime >= info.StartTime {
		item.DurationMs = info.EndTime - info.StartTime
	}
	if item.EndTime > 0 && item.CompletionTime == 0 {
		item.CompletionTime = item.DurationMs
	}
	if item.TokenUsage == (model.RagJobUsageSummary{}) && item.RunID != "" {
		item.TokenUsage = aggregateWikiUsageForRun(ctx, db, file.Eid, file.ID, item.RunID)
	}

	return item
}

func aggregateWikiUsageForRun(ctx context.Context, db *gorm.DB, eid, fileID int64, runID string) model.RagJobUsageSummary {
	_, jobs, _, err := getLatestRunJobsWithStepsByRelatedIDForWikiProgress(ctx, db, eid, fileID)
	if err != nil {
		return model.RagJobUsageSummary{}
	}
	if strings.TrimSpace(runID) == "" {
		return aggregateWikiJobUsage(jobs)
	}

	summary := model.RagJobUsageSummary{}
	for _, job := range jobs {
		if strings.TrimSpace(job.RunID) != strings.TrimSpace(runID) {
			continue
		}
		summary = addWikiUsage(summary, parseWikiJobUsage(job.Metadata))
	}
	return summary
}

func aggregateWikiJobUsage(jobs []model.RagJob) model.RagJobUsageSummary {
	summary := model.RagJobUsageSummary{}
	for _, job := range jobs {
		summary = addWikiUsage(summary, parseWikiJobUsage(job.Metadata))
	}
	return summary
}

func addWikiUsage(base, add model.RagJobUsageSummary) model.RagJobUsageSummary {
	base.PromptTokens += add.PromptTokens
	base.CompletionTokens += add.CompletionTokens
	base.TotalTokens += add.TotalTokens
	base.CallCount += add.CallCount
	return base
}

func parseWikiJobUsage(metadata string) model.RagJobUsageSummary {
	if strings.TrimSpace(metadata) == "" {
		return model.RagJobUsageSummary{}
	}
	var jobMetadata model.RagJobMetadata
	if err := json.Unmarshal([]byte(metadata), &jobMetadata); err != nil {
		return model.RagJobUsageSummary{}
	}
	if jobMetadata.WikiUsage == nil {
		return model.RagJobUsageSummary{}
	}
	return *jobMetadata.WikiUsage
}

func toWikiProgressJobView(job model.RagJob) WikiProgressJobView {
	view := WikiProgressJobView{
		JobID:            job.JobID,
		Eid:              job.Eid,
		Type:             job.Type,
		Status:           job.Status,
		CurrentStepOrder: job.CurrentStepOrder,
		FailureReason:    job.FailureReason,
		StartParameters:  job.StartParameters,
		Metadata:         job.Metadata,
		RunID:            job.RunID,
		RelatedID:        job.RelatedId,
		PipelineID:       job.PipelineID,
		Progress:         job.Progress,
		CompletionTime:   job.CompletionTime,
		CreatedTime:      job.CreatedTime,
		UpdatedTime:      job.UpdatedTime,
		TokenUsage:       parseWikiJobUsage(job.Metadata),
	}
	return view
}

func toWikiProgressStepViews(steps []model.RagJobStep) []WikiProgressStepView {
	if len(steps) == 0 {
		return nil
	}
	items := make([]WikiProgressStepView, 0, len(steps))
	for _, step := range steps {
		item := WikiProgressStepView{
			ID:         step.ID,
			JobID:      step.JobID,
			Eid:        step.Eid,
			StepOrder:  step.StepOrder,
			Parameters: step.Parameters,
			Results:    step.Results,
			Status:     step.Status,
			StartTime:  step.StartTime,
			EndTime:    step.EndTime,
		}
		if step.EndTime >= step.StartTime && step.StartTime > 0 {
			item.DurationMs = step.EndTime - step.StartTime
		}
		items = append(items, item)
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].StepOrder == items[j].StepOrder {
			return items[i].ID < items[j].ID
		}
		return items[i].StepOrder < items[j].StepOrder
	})
	return items
}

func (s *wikiProgressService) loadWikiPagesForFile(ctx context.Context, eid, libraryID, fileID int64) ([]WikiProgressWikiPageView, error) {
	var sources []model.WikiPageSource
	if err := s.db.WithContext(ctx).
		Where("eid = ? AND source_file_id = ?", eid, fileID).
		Find(&sources).Error; err != nil {
		return nil, err
	}
	if len(sources) == 0 {
		return []WikiProgressWikiPageView{}, nil
	}

	pageIDs := make([]int64, 0, len(sources))
	seen := make(map[int64]struct{}, len(sources))
	for _, source := range sources {
		if source.PageID <= 0 {
			continue
		}
		if _, ok := seen[source.PageID]; ok {
			continue
		}
		seen[source.PageID] = struct{}{}
		pageIDs = append(pageIDs, source.PageID)
	}
	if len(pageIDs) == 0 {
		return []WikiProgressWikiPageView{}, nil
	}

	var pages []model.WikiPage
	if err := s.db.WithContext(ctx).
		Where("eid = ? AND library_id = ? AND id IN ?", eid, libraryID, pageIDs).
		Order("updated_time DESC, id DESC").
		Find(&pages).Error; err != nil {
		return nil, err
	}

	items := make([]WikiProgressWikiPageView, 0, len(pages))
	for _, page := range pages {
		items = append(items, WikiProgressWikiPageView{
			ID:          page.ID,
			Slug:        page.Slug,
			Title:       page.Title,
			PageType:    page.PageType,
			Status:      page.Status,
			UpdatedTime: page.UpdatedTime,
		})
	}
	return items, nil
}

func (s *wikiProgressService) loadWikiLogsForPages(ctx context.Context, eid int64, pages []WikiProgressWikiPageView) ([]WikiProgressLogView, error) {
	if len(pages) == 0 {
		return []WikiProgressLogView{}, nil
	}

	pageIDs := make([]int64, 0, len(pages))
	for _, page := range pages {
		pageIDs = append(pageIDs, page.ID)
	}

	var logs []model.WikiLogEntry
	if err := s.db.WithContext(ctx).
		Where("eid = ? AND page_id IN ?", eid, pageIDs).
		Order("created_time DESC, id DESC").
		Limit(50).
		Find(&logs).Error; err != nil {
		return nil, err
	}

	items := make([]WikiProgressLogView, 0, len(logs))
	for _, logEntry := range logs {
		items = append(items, WikiProgressLogView{
			ID:          logEntry.ID,
			PageID:      logEntry.PageID,
			VersionID:   logEntry.VersionID,
			Action:      logEntry.Action,
			RequestID:   logEntry.RequestID,
			Message:     logEntry.Message,
			CreatedTime: logEntry.CreatedTime,
		})
	}
	return items, nil
}

func wikiProgressFileName(db *gorm.DB, file *model.File) string {
	if file == nil {
		return ""
	}
	if file.UploadFileID > 0 {
		var uploadFile model.UploadFile
		if db != nil && db.Where("id = ?", file.UploadFileID).First(&uploadFile).Error == nil {
			if strings.TrimSpace(uploadFile.FileName) != "" {
				return strings.TrimSpace(uploadFile.FileName)
			}
		}
	}
	name := strings.TrimSpace(file.Path)
	if name == "" {
		return fmt.Sprintf("file-%d", file.ID)
	}
	base := filepath.Base(name)
	if base == "." || base == string(filepath.Separator) {
		return name
	}
	return base
}
