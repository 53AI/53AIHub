package service

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

// GraphProgressListRequest 图谱管线进度列表查询请求
type GraphProgressListRequest struct {
	Eid       int64
	LibraryID int64
	Status    string
	Offset    int
	Limit     int
}

// GraphProgressItem 图谱管线进度条目（对齐 WikiProgressItem 精简版）
type GraphProgressItem struct {
	FileID       int64  `json:"file_id"`
	FileName     string `json:"file_name"`
	FilePath     string `json:"file_path"`
	RunID        string `json:"run_id"`
	Status       string `json:"status"`
	Progress     int    `json:"progress"`
	SuccessCount int    `json:"success_count"`
	FailureCount int    `json:"failure_count"`
	TotalSteps   int    `json:"total_steps"`
	StepKey      string `json:"step_key"`
	StepName     string `json:"step_name"`
	StartTime    int64  `json:"start_time"`
	EndTime      int64  `json:"end_time"`
	UpdatedTime  int64  `json:"updated_time"`
}

// GraphProgressJobView 图谱管线 job 视图（对齐 WikiProgressJobView）
type GraphProgressJobView struct {
	JobID            int64                   `json:"job_id"`
	Eid              int64                   `json:"eid"`
	Type             string                  `json:"type"`
	Status           string                  `json:"status"`
	CurrentStepOrder int                     `json:"current_step_order"`
	FailureReason    string                  `json:"failure_reason"`
	RunID            string                  `json:"run_id"`
	RelatedID        int64                   `json:"related_id"`
	PipelineID       int64                   `json:"pipeline_id"`
	Progress         int                     `json:"progress"`
	CompletionTime   int64                   `json:"completion_time"`
	CreatedTime      int64                   `json:"created_time"`
	UpdatedTime      int64                   `json:"updated_time"`
	Steps            []GraphProgressStepView `json:"steps,omitempty"`
}

// GraphProgressStepView 图谱管线步骤视图（对齐 WikiProgressStepView）
type GraphProgressStepView struct {
	ID         int64  `json:"id"`
	JobID      int64  `json:"job_id"`
	Eid        int64  `json:"eid"`
	StepOrder  int    `json:"step_order"`
	Parameters string `json:"parameters"`
	Results    string `json:"results"`
	Status     string `json:"status"`
	StartTime  int64  `json:"start_time"`
	EndTime    int64  `json:"end_time"`
}

// GraphProgressDetail 图谱管线进度详情
type GraphProgressDetail struct {
	ProgressItem GraphProgressItem       `json:"progress_item"`
	Jobs         []GraphProgressJobView  `json:"jobs"`
	Steps        []GraphProgressStepView `json:"steps"`
}

// GraphProgressService 图谱管线进度查询服务
type GraphProgressService interface {
	ListFiles(ctx context.Context, req GraphProgressListRequest) ([]GraphProgressItem, int64, error)
	GetFile(ctx context.Context, eid, libraryID, fileID int64) (*GraphProgressDetail, error)
}

type graphProgressService struct {
	db *gorm.DB
}

// NewGraphProgressService 创建图谱管线进度查询服务
func NewGraphProgressService(db *gorm.DB) GraphProgressService {
	return &graphProgressService{db: db}
}

func (s *graphProgressService) ListFiles(ctx context.Context, req GraphProgressListRequest) ([]GraphProgressItem, int64, error) {
	if s == nil || s.db == nil {
		return nil, 0, fmt.Errorf("graph progress db is required")
	}
	if req.Eid <= 0 || req.LibraryID <= 0 {
		return nil, 0, fmt.Errorf("eid and library_id are required")
	}

	limit := normalizeGraphListLimit(req.Limit, 20, 100)
	offset := req.Offset
	if offset < 0 {
		offset = 0
	}

	// 有图谱管线 job 的文件（图谱 job 的 related_id 即文件 ID）
	sub := s.db.WithContext(ctx).Model(&model.RagJob{}).
		Select("DISTINCT related_id").
		Where("eid = ? AND type = ?", req.Eid, graphPipelineJobType)

	query := s.db.WithContext(ctx).Model(&model.File{}).
		Where("eid = ? AND library_id = ? AND is_deleted = ? AND type = ? AND id IN (?)",
			req.Eid, req.LibraryID, false, model.FILE_TYPE_FILE, sub)

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

	items := make([]GraphProgressItem, 0, len(files))
	for i := range files {
		items = append(items, buildGraphProgressItem(ctx, s.db, &files[i]))
	}
	return items, total, nil
}

func (s *graphProgressService) GetFile(ctx context.Context, eid, libraryID, fileID int64) (*GraphProgressDetail, error) {
	if s == nil || s.db == nil {
		return nil, fmt.Errorf("graph progress db is required")
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

	item := buildGraphProgressItem(ctx, s.db, &file)
	runID, jobs, stepMap, err := getLatestGraphRunJobsWithStepsByRelatedID(ctx, s.db, eid, fileID)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(runID) != "" {
		item.RunID = runID
	}

	jobViews := make([]GraphProgressJobView, 0, len(jobs))
	allSteps := make([]GraphProgressStepView, 0)
	for _, job := range jobs {
		view := toGraphProgressJobView(job)
		view.Steps = toGraphProgressStepViews(stepMap[job.JobID])
		jobViews = append(jobViews, view)
		allSteps = append(allSteps, view.Steps...)
	}

	return &GraphProgressDetail{
		ProgressItem: item,
		Jobs:         jobViews,
		Steps:        allSteps,
	}, nil
}

func buildGraphProgressItem(ctx context.Context, db *gorm.DB, file *model.File) GraphProgressItem {
	if file == nil {
		return GraphProgressItem{}
	}

	item := GraphProgressItem{
		FileID:      file.ID,
		FileName:    wikiProgressFileName(db, file),
		FilePath:    strings.TrimSpace(file.Path),
		UpdatedTime: file.UpdatedTime,
	}

	if _, jobs, _, err := getLatestGraphRunJobsWithStepsByRelatedID(ctx, db, file.Eid, file.ID); err == nil && len(jobs) > 0 {
		latest := jobs[len(jobs)-1]
		item.RunID = latest.RunID
		item.Status = strings.ToLower(latest.Status)
		item.Progress = latest.Progress
		item.StartTime = latest.CreatedTime
		item.EndTime = latest.CompletionTime
		for _, job := range jobs {
			if job.Status == model.RagJobStatusSuccess {
				item.SuccessCount++
			} else if job.Status == model.RagJobStatusFailed {
				item.FailureCount++
			}
		}
		item.TotalSteps = len(jobs)
		item.StepKey = "graph_generation"
		item.StepName = "图谱生成"
	}

	return item
}

func toGraphProgressJobView(job model.RagJob) GraphProgressJobView {
	return GraphProgressJobView{
		JobID:            job.JobID,
		Eid:              job.Eid,
		Type:             job.Type,
		Status:           job.Status,
		CurrentStepOrder: job.CurrentStepOrder,
		FailureReason:    job.FailureReason,
		RunID:            job.RunID,
		RelatedID:        job.RelatedId,
		PipelineID:       job.PipelineID,
		Progress:         job.Progress,
		CompletionTime:   job.CompletionTime,
		CreatedTime:      job.CreatedTime,
		UpdatedTime:      job.UpdatedTime,
	}
}

func toGraphProgressStepViews(steps []model.RagJobStep) []GraphProgressStepView {
	if len(steps) == 0 {
		return nil
	}
	items := make([]GraphProgressStepView, 0, len(steps))
	for _, step := range steps {
		items = append(items, GraphProgressStepView{
			ID:         step.ID,
			JobID:      step.JobID,
			Eid:        step.Eid,
			StepOrder:  step.StepOrder,
			Parameters: step.Parameters,
			Results:    step.Results,
			Status:     step.Status,
			StartTime:  step.StartTime,
			EndTime:    step.EndTime,
		})
	}
	return items
}

func normalizeGraphListLimit(limit, def, max int) int {
	if limit <= 0 {
		return def
	}
	if limit > max {
		return max
	}
	return limit
}

// getLatestGraphRunJobsWithStepsByRelatedID 按图谱 job 类型查询文件最新的图谱管线批次。
// 图谱 job 使用独立 run_id：latestJob 为该文件最新图谱 job，按其 run_id 归集全部图谱 job 与步骤。
func getLatestGraphRunJobsWithStepsByRelatedID(ctx context.Context, db *gorm.DB, eid int64, relatedID int64) (string, []model.RagJob, map[int64][]model.RagJobStep, error) {
	if db == nil {
		return "", nil, map[int64][]model.RagJobStep{}, nil
	}
	query := db.WithContext(ctx).Model(&model.RagJob{})
	if eid > 0 {
		query = query.Where("eid = ?", eid)
	}

	var latestJob model.RagJob
	if err := query.Where("related_id = ? AND type = ?", relatedID, graphPipelineJobType).
		Order("created_time DESC").First(&latestJob).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", nil, map[int64][]model.RagJobStep{}, nil
		}
		return "", nil, nil, err
	}

	runID := strings.TrimSpace(latestJob.RunID)
	jobQuery := db.WithContext(ctx).Model(&model.RagJob{})
	if eid > 0 {
		jobQuery = jobQuery.Where("eid = ?", eid)
	}
	if runID != "" {
		jobQuery = jobQuery.Where("run_id = ?", runID)
	} else {
		jobQuery = jobQuery.Where("job_id = ?", latestJob.JobID)
	}
	jobQuery = jobQuery.Where("related_id = ? AND type = ?", relatedID, graphPipelineJobType).Order("created_time ASC")

	var jobs []model.RagJob
	if err := jobQuery.Find(&jobs).Error; err != nil {
		return "", nil, nil, err
	}
	if len(jobs) == 0 {
		return runID, jobs, map[int64][]model.RagJobStep{}, nil
	}

	jobIDs := make([]int64, 0, len(jobs))
	for _, job := range jobs {
		jobIDs = append(jobIDs, job.JobID)
	}

	var steps []model.RagJobStep
	if err := db.WithContext(ctx).
		Where("job_id IN ?", jobIDs).
		Order("job_id ASC, step_order ASC").
		Find(&steps).Error; err != nil {
		return runID, jobs, nil, err
	}

	stepMap := make(map[int64][]model.RagJobStep, len(jobIDs))
	for _, step := range steps {
		stepMap[step.JobID] = append(stepMap[step.JobID], step)
	}

	return runID, jobs, stepMap, nil
}
