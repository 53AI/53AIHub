package service

import (
	"context"
	"errors"
	"fmt"
	"mime/multipart"
	"strings"
	"sync"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

var ErrRecordingJobAlreadyActive = errors.New("当前用户已有进行中的录音任务")
var ErrRecordingJobNotFound = errors.New("录音任务不存在")
var ErrRecordingJobForbidden = errors.New("无权限访问该录音任务")
var ErrRecordingJobInvalidAction = errors.New("不支持的状态操作")
var ErrRecordingJobStateNotSupported = errors.New("当前状态不支持该操作")
var ErrRecordingSegmentMissing = errors.New("录音分段缺失")
var ErrRecordingSegmentCountUnsupported = errors.New("录音任务仅支持单个分段")
var ErrRecordingJobFinalizeInProgress = errors.New("录音任务正在结束处理中")

const recordingFinalizeRecoveryLease = 10 * time.Minute

type recordingJobLockRegistry struct {
	mu    sync.Mutex
	locks map[int64]*sync.Mutex
}

func (r *recordingJobLockRegistry) lock(jobID int64) func() {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.locks == nil {
		r.locks = map[int64]*sync.Mutex{}
	}
	lk, ok := r.locks[jobID]
	if !ok {
		lk = &sync.Mutex{}
		r.locks[jobID] = lk
	}
	lk.Lock()
	return lk.Unlock
}

var recordingFinalizeLockRegistry = recordingJobLockRegistry{locks: map[int64]*sync.Mutex{}}

type RecordingService struct {
	eid               int64
	personalSpaceSvc  *PersonalSpaceService
	filePermissionSvc *FilePermissionService
	transcoder        RecordingTranscoder
	finalizeSvc       *RecordingFinalizeService
	fileQuerySvc      *RecordingFileQueryService
}

type CreateRecordingJobRequest struct {
	LibraryID               int64
	DestinationFolderFileID int64
	Title                   string
	TargetFormat            string
	SourceMimeType          string
	UploadIntervalMs        int64
	MaxDurationMs           int64
	GroupID                 int64
	InsightPerspective      string
}

type UploadRecordingSegmentRequest struct {
	SegmentIndex   int64
	DurationMs     int64
	StartOffsetMs  int64
	EndOffsetMs    int64
	MimeType       string
	ClientTime     int64
	IsFinalSegment bool
	FileHeader     *multipart.FileHeader
}

type RecordingFileListQuery struct {
	Path      string
	Keyword   string
	Type      *int
	Offset    int
	Limit     int
	GroupID   int64
	SortBy    string
	Order     string
	StartTime int64
	EndTime   int64
}

type RecordingJobSegmentManifest struct {
	Job             *model.RecordingJob
	Segments        []model.RecordingJobSegment
	MissingSegments []int64
}

func NewRecordingService(eid int64) *RecordingService {
	svc := &RecordingService{
		eid:               eid,
		personalSpaceSvc:  NewPersonalSpaceService(eid),
		filePermissionSvc: NewFilePermissionService(eid),
		transcoder:        newRecordingTranscoder(),
	}
	svc.finalizeSvc = NewRecordingFinalizeService(svc)
	svc.fileQuerySvc = NewRecordingFileQueryService(svc)
	return svc
}

func (s *RecordingService) CreateJob(ctx context.Context, userID int64, req *CreateRecordingJobRequest) (*model.RecordingJob, error) {
	if req == nil {
		return nil, errors.New("request is required")
	}
	if req.LibraryID <= 0 {
		return nil, errors.New("library id is required")
	}
	if !model.IsValidInsightPerspective(req.InsightPerspective) {
		return nil, fmt.Errorf("不支持的洞察视角: %s", req.InsightPerspective)
	}

	logger.Infof(ctx, "【录音】开始创建录音任务: eid=%d user_id=%d library_id=%d", s.eid, userID, req.LibraryID)

	permission, err := GetUserPermission(s.eid, model.RESOURCE_TYPE_LIBRARY, req.LibraryID, userID)
	if err != nil {
		logger.SysErrorf("【录音】权限检查失败: eid=%d user_id=%d library_id=%d err=%v", s.eid, userID, req.LibraryID, err)
		return nil, err
	}
	if permission < model.PERMISSION_EDIT_KNOWLEDGE {
		logger.SysErrorf("【录音】权限不足: eid=%d user_id=%d library_id=%d permission=%d", s.eid, userID, req.LibraryID, permission)
		return nil, ErrRecordingJobForbidden
	}

	activeCount, err := model.CountActiveRecordingJobs(s.eid, userID)
	if err != nil {
		logger.SysErrorf("【录音】检查活跃任务失败: eid=%d user_id=%d err=%v", s.eid, userID, err)
		return nil, err
	}
	if activeCount > 0 {
		logger.SysErrorf("【录音】用户已有活跃录音任务，拒绝创建新任务: eid=%d user_id=%d active_count=%d", s.eid, userID, activeCount)
		return nil, ErrRecordingJobAlreadyActive
	}

	job := &model.RecordingJob{
		Eid:                      s.eid,
		UserID:                   userID,
		LibraryID:                req.LibraryID,
		DestinationFolderFileID:  req.DestinationFolderFileID,
		Title:                    req.Title,
		TargetFormat:             req.TargetFormat,
		SourceMimeType:           req.SourceMimeType,
		UploadIntervalMs:         req.UploadIntervalMs,
		MaxDurationMs:            req.MaxDurationMs,
		GroupID:                  req.GroupID,
		InsightPerspective:       string(model.NormalizeInsightPerspective(req.InsightPerspective)),
		Status:                   model.RecordingJobStatusRecording,
		StartedAt:                time.Now().UTC().UnixMilli(),
		LastActiveAt:             time.Now().UTC().UnixMilli(),
		NextExpectedSegmentIndex: 0,
		LastAcceptedSegmentIndex: -1,
		RecoveryState:            "ready",
	}
	if err := model.CreateRecordingJob(job); err != nil {
		logger.SysErrorf("【录音】创建录音任务失败: eid=%d user_id=%d err=%v", s.eid, userID, err)
		return nil, err
	}
	logger.Infof(ctx, "【录音】创建录音任务成功: job_id=%d eid=%d user_id=%d library_id=%d 格式=%s", job.ID, s.eid, userID, job.LibraryID, job.TargetFormat)
	return job, nil
}

func (s *RecordingService) GetActiveJob(ctx context.Context, userID int64) (*model.RecordingJob, error) {
	job, err := model.GetActiveRecordingJobByUser(s.eid, userID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return job, nil
}

func (s *RecordingService) GetJob(ctx context.Context, userID int64, jobID int64) (*model.RecordingJob, error) {
	job, err := model.GetRecordingJobByID(s.eid, jobID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrRecordingJobNotFound
		}
		return nil, err
	}
	permission, err := GetUserPermission(s.eid, model.RESOURCE_TYPE_LIBRARY, job.LibraryID, userID)
	if err != nil {
		return nil, err
	}
	if permission < model.PERMISSION_VIEW_ONLY {
		return nil, ErrRecordingJobForbidden
	}
	if job.UserID != userID {
		return nil, ErrRecordingJobForbidden
	}
	return job, nil
}

func (s *RecordingService) UpdateJobState(ctx context.Context, userID int64, jobID int64, action string) (*model.RecordingJob, error) {
	job, err := s.GetJob(ctx, userID, jobID)
	if err != nil {
		return nil, err
	}

	now := time.Now().UTC().UnixMilli()
	updates := map[string]interface{}{
		"last_active_at": now,
	}
	switch strings.ToLower(strings.TrimSpace(action)) {
	case "pause":
		if !job.CanPause() {
			return nil, fmt.Errorf("%w: %s", ErrRecordingJobStateNotSupported, job.Status)
		}
		updates["status"] = model.RecordingJobStatusPaused
		updates["paused_at"] = now
	case "resume":
		if !job.CanResume() {
			return nil, fmt.Errorf("%w: %s", ErrRecordingJobStateNotSupported, job.Status)
		}
		updates["status"] = model.RecordingJobStatusRecording
		updates["resumed_at"] = now
	case "interrupt":
		if !job.CanInterrupt() {
			return nil, fmt.Errorf("%w: %s", ErrRecordingJobStateNotSupported, job.Status)
		}
		updates["status"] = model.RecordingJobStatusInterrupted
	case "stop":
		if !job.CanStop() {
			return nil, fmt.Errorf("%w: %s", ErrRecordingJobStateNotSupported, job.Status)
		}
		updates["status"] = model.RecordingJobStatusStopped
		updates["ended_at"] = now
	default:
		return nil, ErrRecordingJobInvalidAction
	}
	if err := model.UpdateRecordingJob(job, updates); err != nil {
		return nil, err
	}
	return model.GetRecordingJobByID(s.eid, jobID)
}

func (s *RecordingService) Heartbeat(ctx context.Context, userID int64, jobID int64) error {
	job, err := s.GetJob(ctx, userID, jobID)
	if err != nil {
		return err
	}
	return model.UpdateRecordingJob(job, map[string]interface{}{
		"last_active_at": time.Now().UTC().UnixMilli(),
	})
}

func (s *RecordingService) UploadSegment(ctx context.Context, userID int64, jobID int64, req *UploadRecordingSegmentRequest) (*model.RecordingJobSegment, error) {
	chunkPipeline := NewRecordingChunkPipelineService(s.eid)
	segment, err := chunkPipeline.AppendChunk(ctx, userID, jobID, req)
	if err != nil {
		logger.SysErrorf("【录音】上传录音分段失败: eid=%d user_id=%d job_id=%d segment_index=%d err=%v", s.eid, userID, jobID, req.SegmentIndex, err)
		return nil, err
	}
	if segment == nil {
		logger.Infof(ctx, "【录音】分段已接收并进入聚合器: job_id=%d segment_index=%d", jobID, req.SegmentIndex)
		return nil, nil
	}
	logger.Infof(ctx, "【录音】聚合块已落库: job_id=%d segment_index=%d storage_key=%s", jobID, segment.SegmentIndex, segment.StorageKey)
	return segment, nil
}

func (s *RecordingService) GetMissingSegmentIndices(ctx context.Context, userID int64, jobID int64) ([]int64, error) {
	job, err := s.GetJob(ctx, userID, jobID)
	if err != nil {
		return nil, err
	}
	if job == nil {
		return nil, nil
	}
	return model.GetRecordingJobMissingSegmentIndices(job.ID)
}

func (s *RecordingService) GetSegmentManifest(ctx context.Context, userID int64, jobID int64) (*RecordingJobSegmentManifest, error) {
	job, err := s.GetJob(ctx, userID, jobID)
	if err != nil {
		return nil, err
	}
	segments, err := model.GetRecordingJobSegments(job.ID)
	if err != nil {
		return nil, err
	}
	missingSegments, err := model.GetRecordingJobMissingSegmentIndices(job.ID)
	if err != nil {
		return nil, err
	}
	return &RecordingJobSegmentManifest{
		Job:             job,
		Segments:        segments,
		MissingSegments: missingSegments,
	}, nil
}

// ============================================================
// 委托方法（委派到子服务）
// ============================================================

func (s *RecordingService) RecoverPendingFinalizingJobs(ctx context.Context) (int, error) {
	return s.finalizeSvc.RecoverPendingFinalizingJobs(ctx)
}

func (s *RecordingService) RequestFinalize(ctx context.Context, userID int64, jobID int64) (*model.RecordingJob, error) {
	return s.finalizeSvc.RequestFinalize(ctx, userID, jobID)
}

func (s *RecordingService) CompleteFinalize(ctx context.Context, userID int64, jobID int64) (*model.File, error) {
	return s.finalizeSvc.CompleteFinalize(ctx, userID, jobID)
}

func (s *RecordingService) Finalize(ctx context.Context, userID int64, jobID int64) (*model.File, error) {
	return s.finalizeSvc.Finalize(ctx, userID, jobID)
}

func (s *RecordingService) ListMyRecordingFiles(ctx context.Context, userID int64, query *RecordingFileListQuery) ([]model.File, int64, error) {
	return s.fileQuerySvc.ListMyRecordingFiles(ctx, userID, query)
}
