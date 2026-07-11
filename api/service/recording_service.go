package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/storage"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/elasticsearch"
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
}

type CreateRecordingJobRequest struct {
	LibraryID               int64
	DestinationFolderFileID int64
	Title                   string
	TargetFormat            string
	SourceMimeType          string
	UploadIntervalMs        int64
	MaxDurationMs           int64
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
	Path    string
	Keyword string
	Type    *int
	Offset  int
	Limit   int
}

type RecordingJobSegmentManifest struct {
	Job             *model.RecordingJob
	Segments        []model.RecordingJobSegment
	MissingSegments []int64
}

func NewRecordingService(eid int64) *RecordingService {
	return &RecordingService{
		eid:               eid,
		personalSpaceSvc:  NewPersonalSpaceService(eid),
		filePermissionSvc: NewFilePermissionService(eid),
		transcoder:        newRecordingTranscoder(),
	}
}

func (s *RecordingService) CreateJob(ctx context.Context, userID int64, req *CreateRecordingJobRequest) (*model.RecordingJob, error) {
	if req == nil {
		return nil, errors.New("request is required")
	}
	if req.LibraryID <= 0 {
		return nil, errors.New("library id is required")
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

func (s *RecordingService) RecoverPendingFinalizingJobs(ctx context.Context) (int, error) {
	cutoff := time.Now().UTC().UnixMilli() - recordingFinalizeRecoveryLease.Milliseconds()
	var jobs []model.RecordingJob
	if err := model.DB.Where("eid = ? AND owner_instance = ? AND ((status = ?) OR (status = ? AND last_active_at <= ?))",
		s.eid, config.GetRecordingInstanceID(),
		model.RecordingJobStatusFinalizingProcessing,
		model.RecordingJobStatusFinalizing,
		cutoff).
		Order("id asc").
		Find(&jobs).Error; err != nil {
		return 0, err
	}

	recovered := 0
	for i := range jobs {
		ok, err := s.recoverFinalizingJob(ctx, &jobs[i])
		if err != nil {
			return recovered, err
		}
		if ok {
			recovered++
		}
	}
	return recovered, nil
}

func RecoverPendingFinalizingRecordingJobs(ctx context.Context) (int, error) {
	cutoff := time.Now().UTC().UnixMilli() - recordingFinalizeRecoveryLease.Milliseconds()
	var eids []int64
	if err := model.DB.Model(&model.RecordingJob{}).
		Where("owner_instance = ? AND ((status = ?) OR (status = ? AND last_active_at <= ?))",
			config.GetRecordingInstanceID(),
			model.RecordingJobStatusFinalizingProcessing,
			model.RecordingJobStatusFinalizing,
			cutoff).
		Distinct().
		Pluck("eid", &eids).Error; err != nil {
		return 0, err
	}

	total := 0
	for _, eid := range eids {
		recovered, err := NewRecordingService(eid).RecoverPendingFinalizingJobs(ctx)
		if err != nil {
			return total, err
		}
		total += recovered
	}
	return total, nil
}

func (s *RecordingService) recoverFinalizingJob(ctx context.Context, job *model.RecordingJob) (bool, error) {
	if job == nil {
		return false, nil
	}
	_ = ctx

	unlock := recordingFinalizeLockRegistry.lock(job.ID)
	defer unlock()

	current, err := model.GetRecordingJobByID(s.eid, job.ID)
	if err != nil {
		return false, err
	}
	if current.Status != model.RecordingJobStatusFinalizing && current.Status != model.RecordingJobStatusFinalizingProcessing {
		return false, nil
	}

	lockSvc := NewRecordingLockService()
	if !lockSvc.TryLockRecover(current.ID) {
		logger.Infof(ctx, "【录音】Recovery 任务已被其他实例处理，跳过: job_id=%d", current.ID)
		return false, nil
	}
	defer lockSvc.UnlockRecover(current.ID)

	assemblySvc := NewRecordingAssemblyService(s.eid)
	assembly, assemblyErr := model.GetRecordingJobAssemblyByJobID(current.ID)
	if assemblyErr == nil && assembly != nil {
		shouldRepair, _, pendingErr := assemblySvc.hasPendingAssemblyBuffer(current, assembly)
		if pendingErr != nil {
			logger.SysWarnf("【录音】Recovery 检查 assembly 状态失败: job_id=%d err=%v", current.ID, pendingErr)
			return false, pendingErr
		}
		if shouldRepair {
			if checkErr := assemblySvc.prepareAssemblyBuffer(ctx, current, assembly); checkErr != nil {
				if errors.Is(checkErr, ErrRecordingAssemblyBufferMissing) {
					logger.SysWarnf("【录音】Recovery 检查到本地 spool 文件缺失，继续尝试完成: job_id=%d err=%v", current.ID, checkErr)
				} else {
					logger.SysWarnf("【录音】Recovery 检查 assembly buffer 失败: job_id=%d err=%v", current.ID, checkErr)
					return false, checkErr
				}
			}
		}
	}

	now := time.Now().UTC().UnixMilli()
	claimed, err := s.claimRecoveringFinalizingJob(current.ID, now)
	if err != nil {
		return false, err
	}
	if !claimed {
		return false, nil
	}

	recordingFile := &model.File{}
	foundRecordingFile := false

	if current.OutputFileID > 0 {
		if file, loadErr := model.GetFileByID(s.eid, current.OutputFileID); loadErr == nil && file != nil && file.OriginType == model.FileOriginTypeRecordingAudio {
			recordingFile = file
			foundRecordingFile = true
		}
	}

	if !foundRecordingFile {
		query := model.DB.Where(map[string]interface{}{
			"eid":           s.eid,
			"library_id":    current.LibraryID,
			"user_id":       current.UserID,
			"is_deleted":    false,
			"origin_type":   model.FileOriginTypeRecordingAudio,
			"origin_ref_id": current.ID,
		}).Order("id desc")
		if err := query.First(recordingFile).Error; err != nil {
			if !errors.Is(err, gorm.ErrRecordNotFound) {
				return false, err
			}
		} else {
			foundRecordingFile = true
		}
	}

	if foundRecordingFile {
		if err := model.UpdateRecordingJob(current, recordingJobCompletedUpdates(now, recordingFile.ID)); err != nil {
			return false, err
		}
		return true, nil
	}

	segments, err := model.GetRecordingJobSegments(current.ID)
	if err != nil {
		return false, err
	}
	missing, err := model.GetRecordingJobMissingSegmentIndices(current.ID)
	if err != nil {
		return false, err
	}
	if len(missing) > 0 {
		if err := model.UpdateRecordingJob(current, recordingJobFatalFailureUpdates(now, fmt.Sprintf("录音结束恢复缺失分段: %v", missing))); err != nil {
			return false, err
		}
		logger.SysErrorf("【录音】恢复 finalizing 任务失败并标记为终态失败: job_id=%d missing=%v", current.ID, missing)
		return true, nil
	}
	if fatalReason := classifyRecordingFinalizingRecoveryFailure(segments); fatalReason != nil {
		if err := model.UpdateRecordingJob(current, recordingJobFatalFailureUpdates(now, fatalReason.Error())); err != nil {
			return false, err
		}
		logger.SysErrorf("【录音】恢复 finalizing 任务失败并标记为终态失败: job_id=%d err=%v", current.ID, fatalReason)
		return true, nil
	}

	if err := model.UpdateRecordingJob(current, recordingJobNeedReconcileUpdates(now, "录音结束恢复未找到成品文件")); err != nil {
		return false, err
	}
	return true, nil
}

func classifyRecordingFinalizingRecoveryFailure(segments []model.RecordingJobSegment) error {
	if len(segments) == 0 {
		return errors.New("录音结束恢复缺少可重建分段")
	}

	for i := range segments {
		segment := segments[i]
		if strings.TrimSpace(segment.StorageKey) == "" || !storage.StorageInstance.Exists(segment.StorageKey) {
			return fmt.Errorf("%w: segment_index=%d", ErrRecordingSegmentMissing, segment.SegmentIndex)
		}
	}
	return nil
}

func (s *RecordingService) claimRecoveringFinalizingJob(jobID int64, now int64) (bool, error) {
	cutoff := now - recordingFinalizeRecoveryLease.Milliseconds()
	result := model.DB.Model(&model.RecordingJob{}).
		Where("eid = ? AND id = ? AND owner_instance = ? AND ((status = ?) OR (status = ? AND last_active_at <= ?))",
			s.eid, jobID, config.GetRecordingInstanceID(),
			model.RecordingJobStatusFinalizing,
			model.RecordingJobStatusFinalizingProcessing,
			cutoff,
		).
		Updates(map[string]interface{}{
			"status":         model.RecordingJobStatusFinalizingProcessing,
			"last_active_at": now,
		})
	if result.Error != nil {
		return false, result.Error
	}
	return result.RowsAffected > 0, nil
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

func (s *RecordingService) RequestFinalize(ctx context.Context, userID int64, jobID int64) (*model.RecordingJob, error) {
	job, err := s.GetJob(ctx, userID, jobID)
	if err != nil {
		return nil, err
	}
	if !CheckFFmpegAvailable() {
		_ = s.recordFinalizeRequestFailure(job, ErrFFmpegNotAvailable)
		return nil, ErrFFmpegNotAvailable
	}
	if !job.CanEnterFinalizing() {
		stateErr := fmt.Errorf("%w: %s", ErrRecordingJobStateNotSupported, job.Status)
		_ = s.recordFinalizeRequestFailure(job, stateErr)
		return nil, stateErr
	}

	assemblySvc := NewRecordingAssemblyService(s.eid)
	if assembly, assemblyErr := model.GetRecordingJobAssemblyByJobID(jobID); assemblyErr == nil && assembly != nil {
		shouldRepair, _, pendingErr := assemblySvc.hasPendingAssemblyBuffer(job, assembly)
		if pendingErr != nil {
			_ = s.recordFinalizeRequestFailure(job, pendingErr)
			return nil, pendingErr
		}
		if shouldRepair {
			if checkErr := assemblySvc.prepareAssemblyBuffer(ctx, job, assembly); checkErr != nil {
				_ = s.recordFinalizeRequestFailure(job, checkErr)
				return nil, checkErr
			}
		}
	} else if assemblyErr != nil && !errors.Is(assemblyErr, gorm.ErrRecordNotFound) {
		_ = s.recordFinalizeRequestFailure(job, assemblyErr)
		return nil, assemblyErr
	}

	unlock := recordingFinalizeLockRegistry.lock(jobID)
	defer unlock()

	now := time.Now().UTC().UnixMilli()
	result := model.DB.Model(&model.RecordingJob{}).
		Where("id = ? AND eid = ? AND user_id = ? AND owner_instance = ? AND status IN ?", jobID, s.eid, userID, config.GetRecordingInstanceID(), []string{
			model.RecordingJobStatusRecording,
			model.RecordingJobStatusPaused,
			model.RecordingJobStatusInterrupted,
			model.RecordingJobStatusStopped,
		}).
		Updates(map[string]interface{}{
			"status":         model.RecordingJobStatusFinalizing,
			"last_error":     "",
			"last_active_at": now,
		})
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected == 0 {
		return nil, ErrRecordingJobFinalizeInProgress
	}

	NotifyFinalizeWorker()

	return model.GetRecordingJobByID(s.eid, jobID)
}

func (s *RecordingService) recordFinalizeRequestFailure(job *model.RecordingJob, reason error) error {
	if job == nil || reason == nil {
		return nil
	}
	now := time.Now().UTC().UnixMilli()
	updates := recordingJobFailureUpdates(now, reason.Error())
	if isRecordingFinalizeFatalReason(reason) {
		updates = recordingJobFatalFailureUpdates(now, reason.Error())
	}
	return model.UpdateRecordingJob(job, updates)
}

func (s *RecordingService) CompleteFinalize(ctx context.Context, userID int64, jobID int64) (*model.File, error) {
	job, err := model.GetRecordingJobByID(s.eid, jobID)
	if err != nil {
		return nil, err
	}
	if job.UserID != userID {
		return nil, ErrRecordingJobForbidden
	}
	if job.Status != model.RecordingJobStatusFinalizing && job.Status != model.RecordingJobStatusFinalizingProcessing {
		return nil, fmt.Errorf("%w: %s", ErrRecordingJobStateNotSupported, job.Status)
	}
	return s.completeFinalizeRecordingJob(ctx, job, model.RecordingJobStatusFinalizing)
}

func (s *RecordingService) completeFinalizeRecordingJob(ctx context.Context, job *model.RecordingJob, restoreStatus string) (result *model.File, err error) {
	if job == nil {
		return nil, errors.New("recording job is nil")
	}
	failFinalize := func(reason error) error {
		return s.failFinalizeRecordingJob(ctx, job, restoreStatus, reason)
	}

	unlock := recordingFinalizeLockRegistry.lock(job.ID)
	defer unlock()

	assemblySvc := NewRecordingAssemblyService(s.eid)
	if assembly, assemblyErr := model.GetRecordingJobAssemblyByJobID(job.ID); assemblyErr == nil && assembly != nil {
		shouldRepair, _, pendingErr := assemblySvc.hasPendingAssemblyBuffer(job, assembly)
		if pendingErr != nil {
			return nil, failFinalize(pendingErr)
		}
		if shouldRepair {
			if checkErr := assemblySvc.prepareAssemblyBuffer(ctx, job, assembly); checkErr != nil {
				return nil, failFinalize(checkErr)
			}
		}
	} else if assemblyErr != nil && !errors.Is(assemblyErr, gorm.ErrRecordNotFound) {
		logger.SysErrorf("【录音】获取录音聚合信息失败: job_id=%d err=%v", job.ID, assemblyErr)
		return nil, failFinalize(assemblyErr)
	}

	_, flushErr := assemblySvc.flushPendingAssemblyLocked(ctx, job)
	if flushErr != nil {
		logger.SysErrorf("【录音】收口录音缓冲失败: job_id=%d err=%v", job.ID, flushErr)
		return nil, failFinalize(flushErr)
	}

	segments, err := model.GetRecordingJobSegments(job.ID)
	if err != nil {
		logger.SysErrorf("【录音】获取分段列表失败: job_id=%d err=%v", job.ID, err)
		return nil, failFinalize(err)
	}
	if len(segments) == 0 {
		logger.SysErrorf("【录音】录音无分段数据: job_id=%d", job.ID)
		return nil, failFinalize(ErrRecordingSegmentMissing)
	}
	missing, err := model.GetRecordingJobMissingSegmentIndices(job.ID)
	if err != nil {
		logger.SysErrorf("【录音】检查缺失分段失败: job_id=%d err=%v", job.ID, err)
		return nil, failFinalize(err)
	}
	if len(missing) > 0 {
		logger.SysErrorf("【录音】录音分段不完整，缺失分段: job_id=%d missing=%v", job.ID, missing)
		return nil, failFinalize(fmt.Errorf("%w: %v", ErrRecordingSegmentMissing, missing))
	}
	if len(segments) > 1 {
		repairedSegments, repairErr := s.repairRecordingJobSegmentsForFinalize(ctx, job, segments)
		if repairErr != nil {
			logger.SysErrorf("【录音】修复历史录音分段失败: job_id=%d err=%v", job.ID, repairErr)
			return nil, failFinalize(repairErr)
		}
		segments = repairedSegments
	}
	result, err = s.directFinalizeRecordingJob(ctx, job, segments)
	if err != nil {
		return nil, failFinalize(err)
	}
	return result, nil
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

func (s *RecordingService) Finalize(ctx context.Context, userID int64, jobID int64) (*model.File, error) {
	logger.Infof(ctx, "【录音】开始结束录音任务: job_id=%d user_id=%d", jobID, userID)
	job, err := s.RequestFinalize(ctx, userID, jobID)
	if err != nil {
		logger.SysErrorf("【录音】获取或提交录音任务失败: job_id=%d err=%v", jobID, err)
		return nil, err
	}
	return s.CompleteFinalize(ctx, userID, job.ID)
}

func isRecordingFinalizeFatalReason(reason error) bool {
	if reason == nil {
		return false
	}
	switch {
	case errors.Is(reason, ErrRecordingAssemblyBufferMissing):
		return true
	case errors.Is(reason, ErrRecordingSegmentMissing):
		return true
	case errors.Is(reason, ErrRecordingSegmentCountUnsupported):
		return true
	default:
		return false
	}
}

func (s *RecordingService) failFinalizeRecordingJob(ctx context.Context, job *model.RecordingJob, restoreStatus string, reason error) error {
	if reason == nil {
		return nil
	}
	if job == nil {
		return reason
	}
	now := time.Now().UTC().UnixMilli()
	targetStatus := restoreStatus
	updates := recordingJobFailureUpdates(now, reason.Error())
	if isRecordingFinalizeFatalReason(reason) {
		targetStatus = model.RecordingJobStatusFailed
		updates = recordingJobFatalFailureUpdates(now, reason.Error())
	} else {
		if strings.TrimSpace(restoreStatus) == "" {
			restoreStatus = model.RecordingJobStatusFinalizing
		}
		targetStatus = restoreStatus
		updates["status"] = targetStatus
	}
	if err := model.UpdateRecordingJob(job, updates); err != nil {
		logger.SysErrorf("【录音】回退录音任务状态失败: job_id=%d restore_status=%s err=%v", job.ID, targetStatus, err)
		return reason
	}
	if isRecordingFinalizeFatalReason(reason) {
		logger.SysErrorf("【录音】录音任务失败并标记为终态失败: job_id=%d err=%v", job.ID, reason)
		s.cleanupRecordingFinalizeSpool(job)
	} else {
		logger.SysWarnf("【录音】录音任务失败并回退到可重试状态: job_id=%d restore_status=%s err=%v", job.ID, targetStatus, reason)
	}
	return reason
}

func recordingLocalJobRootPath(job *model.RecordingJob) string {
	if job == nil {
		return ""
	}
	ownerInstance := strings.TrimSpace(job.OwnerInstance)
	if ownerInstance == "" {
		ownerInstance = config.GetRecordingInstanceID()
	}
	return filepath.Join(config.RecordingLocalRoot(), model.BuildRecordingLocalJobRootPathForInstance(ownerInstance, job.Eid, job.UserID, job.ID))
}

func (s *RecordingService) cleanupRecordingLocalArtifacts(job *model.RecordingJob) {
	if job == nil {
		return
	}
	jobRoot := recordingLocalJobRootPath(job)
	if strings.TrimSpace(jobRoot) == "" {
		return
	}
	for _, subdir := range []string{"chunks", "segments", "transcoded"} {
		path := filepath.Join(jobRoot, subdir)
		if err := os.RemoveAll(path); err != nil && !os.IsNotExist(err) {
			logger.SysWarnf("【录音】清理录音本地中间文件失败: job_id=%d path=%s err=%v", job.ID, path, err)
		}
	}
}

func (s *RecordingService) cleanupRecordingFinalizeSpool(job *model.RecordingJob) {
	if job == nil {
		return
	}
	if err := deleteRecordingAssemblyJobSpoolDir(recordingAssemblySpoolRootDir(), s.eid, job.ID); err != nil {
		logger.SysWarnf("【录音】清理录音聚合临时文件失败: job_id=%d err=%v", job.ID, err)
	}
}

func (s *RecordingService) repairRecordingJobSegmentsForFinalize(ctx context.Context, job *model.RecordingJob, segments []model.RecordingJobSegment) ([]model.RecordingJobSegment, error) {
	if job == nil {
		return nil, errors.New("recording job is nil")
	}
	if len(segments) <= 1 {
		return segments, nil
	}

	logger.Infof(ctx, "【录音】检测到历史脏分段，开始修复为单分段: job_id=%d segment_count=%d", job.ID, len(segments))
	sort.Slice(segments, func(i, j int) bool {
		return segments[i].SegmentIndex < segments[j].SegmentIndex
	})

	canonicalSegment := segments[0]
	canonicalSegment.StorageKey = model.BuildRecordingSegmentLocalStorageKey(s.eid, job.UserID, job.ID, 0, "segment-0.webm")
	canonicalSegment.SegmentIndex = 0
	if segments[0].SegmentIndex != 0 {
		canonicalSegment.ID = 0
	}
	mergedContent := make([]byte, 0)
	var totalDurationMs int64
	var uploadedAt int64
	for i := range segments {
		segment := segments[i]
		if strings.TrimSpace(segment.StorageKey) == "" {
			return nil, fmt.Errorf("segment %d missing storage key", segment.SegmentIndex)
		}
		data, err := loadRecordingArtifact(segment.StorageKey)
		if err != nil {
			return nil, fmt.Errorf("load segment %d failed: %w", segment.SegmentIndex, err)
		}
		mergedContent = append(mergedContent, data...)
		totalDurationMs += segment.DurationMs
		if segment.UploadedAt > uploadedAt {
			uploadedAt = segment.UploadedAt
		}
	}

	if err := saveRecordingArtifact(canonicalSegment.StorageKey, mergedContent); err != nil {
		return nil, fmt.Errorf("save canonical segment failed: %w", err)
	}

	canonicalSegment.Size = int64(len(mergedContent))
	canonicalSegment.DurationMs = totalDurationMs
	canonicalSegment.StartOffsetMs = 0
	canonicalSegment.EndOffsetMs = segments[len(segments)-1].EndOffsetMs
	canonicalSegment.SegmentHash = hashBytes(mergedContent)
	if strings.TrimSpace(canonicalSegment.MimeType) == "" {
		for i := range segments {
			if strings.TrimSpace(segments[i].MimeType) != "" {
				canonicalSegment.MimeType = segments[i].MimeType
				break
			}
		}
	}
	canonicalSegment.Status = model.RecordingJobSegmentStatusUploaded
	canonicalSegment.TranscodeStatus = model.RecordingJobSegmentTranscodeStatusPending
	canonicalSegment.TranscodedStorageKey = ""
	canonicalSegment.TranscodedMimeType = ""
	canonicalSegment.TranscodedSize = 0
	canonicalSegment.TranscodeError = ""
	canonicalSegment.RetryCount = 0
	canonicalSegment.UploadedAt = uploadedAt

	if _, err := model.UpsertRecordingJobSegment(&canonicalSegment); err != nil {
		return nil, err
	}
	ownerInstance := strings.TrimSpace(job.OwnerInstance)
	if ownerInstance == "" {
		ownerInstance = config.GetRecordingInstanceID()
	}
	if err := model.UpdateRecordingJob(job, map[string]interface{}{
		"segment_count":               1,
		"uploaded_segment_count":      1,
		"last_segment_index":          0,
		"next_expected_segment_index": 1,
		"last_accepted_segment_index": 0,
		"total_recorded_ms":           totalDurationMs,
		"uploaded_recorded_ms":        totalDurationMs,
	}); err != nil {
		return nil, err
	}
	job.SegmentCount = 1
	job.UploadedSegmentCount = 1
	job.LastSegmentIndex = 0
	job.NextExpectedSegmentIndex = 1
	job.LastAcceptedSegmentIndex = 0
	job.TotalRecordedMs = totalDurationMs
	job.UploadedRecordedMs = totalDurationMs

	for i := 1; i < len(segments); i++ {
		segment := segments[i]
		if err := model.DB.Where("job_id = ? AND segment_index = ? AND owner_instance = ?", job.ID, segment.SegmentIndex, ownerInstance).
			Delete(&model.RecordingJobSegment{}).Error; err != nil {
			return nil, err
		}
		if err := deleteRecordingArtifactIfExists(segment.StorageKey); err != nil {
			logger.SysWarnf("【录音】删除历史脏分段文件失败: job_id=%d segment_index=%d storage_key=%s err=%v", job.ID, segment.SegmentIndex, segment.StorageKey, err)
		}
	}

	logger.Infof(ctx, "【录音】历史脏分段修复完成: job_id=%d segment_count=%d", job.ID, len(segments))
	return []model.RecordingJobSegment{canonicalSegment}, nil
}

func (s *RecordingService) directFinalizeRecordingJob(ctx context.Context, job *model.RecordingJob, segments []model.RecordingJobSegment) (*model.File, error) {
	if job == nil || len(segments) == 0 {
		return nil, errors.New("invalid job or segments")
	}
	if len(segments) != 1 {
		return nil, fmt.Errorf("%w: job_id=%d segment_count=%d", ErrRecordingSegmentCountUnsupported, job.ID, len(segments))
	}

	logger.Infof(ctx, "【录音】使用直接 finalize 模式: job_id=%d segments=%d duration_ms=%d", job.ID, len(segments), job.TotalRecordedMs)

	seg := segments[0]
	if strings.TrimSpace(seg.StorageKey) == "" {
		return nil, fmt.Errorf("segment %d missing storage key", seg.SegmentIndex)
	}

	transcodeStart := time.Now()
	var transcodedContent []byte

	if diskPath, ok := recordingArtifactDiskPath(seg.StorageKey); ok {
		logger.Infof(ctx, "【录音】使用文件路径直转模式: job_id=%d path=%s", job.ID, diskPath)
		var transcodeErr error
		transcodedContent, transcodeErr = s.transcoder.TranscodeFromFile(ctx, diskPath, job.TargetFormat)
		if transcodeErr != nil {
			return nil, fmt.Errorf("transcode from file failed: %w", transcodeErr)
		}
	} else {
		logger.Infof(ctx, "【录音】使用内存加载转码模式: job_id=%d", job.ID)
		data, loadErr := loadRecordingArtifact(seg.StorageKey)
		if loadErr != nil {
			return nil, fmt.Errorf("load segment %d failed: %w", seg.SegmentIndex, loadErr)
		}
		var transcodeErr error
		transcodedContent, transcodeErr = s.transcoder.Transcode(ctx, [][]byte{data}, job.TargetFormat)
		if transcodeErr != nil {
			return nil, fmt.Errorf("transcode failed: %w", transcodeErr)
		}
	}

	transcodeDuration := time.Since(transcodeStart)
	logger.Infof(ctx, "【录音】直接转码完成: job_id=%d 耗时=%.1f秒 输出大小=%.2fMB", job.ID, transcodeDuration.Seconds(), float64(len(transcodedContent))/1024/1024)

	finalName := buildRecordingFileName(job.StartedAt, job.TargetFormat)
	finalKey := model.BuildRecordingOutputStorageKey(s.eid, job.UserID, job.ID, finalName)

	if err := saveRecordingArtifact(finalKey, transcodedContent); err != nil {
		return nil, fmt.Errorf("save final file failed: %w", err)
	}

	outputHash := hashBytes(transcodedContent)
	uploadFile := &model.UploadFile{
		FileName:  finalName,
		Key:       finalKey,
		Eid:       s.eid,
		UserID:    job.UserID,
		Size:      int64(len(transcodedContent)),
		Extension: path.Ext(finalName),
		MimeType:  detectRecordingMimeType(job.TargetFormat),
		Hash:      outputHash,
	}
	if err := uploadFile.Save(); err != nil {
		_ = deleteRecordingArtifactIfExists(finalKey)
		return nil, fmt.Errorf("save upload file record failed: %w", err)
	}
	if err := uploadFile.MarkAsCompleted(); err != nil {
		_ = deleteRecordingArtifactIfExists(finalKey)
		return nil, fmt.Errorf("mark upload file completed failed: %w", err)
	}

	recordingPath := buildRecordingFilePath(job, finalName)
	if !strings.HasSuffix(recordingPath, ".md") {
		recordingPath += ".md"
	}
	recordingFile := &model.File{
		Eid:              s.eid,
		LibraryID:        job.LibraryID,
		Path:             recordingPath,
		Type:             model.FILE_TYPE_FILE,
		UserID:           job.UserID,
		UploadFileID:     uploadFile.ID,
		DurationMs:       job.TotalRecordedMs,
		ConversionStatus: model.FileConversionStatusNormal,
		ParsingStatus:    model.FileParsingStatusNormal,
	}
	recordingFile.SetRecordingAudioOrigin(job.ID)
	if err := recordingFile.Save(); err != nil {
		_ = deleteRecordingArtifactIfExists(finalKey)
		return nil, fmt.Errorf("save file record failed: %w", err)
	}

	now := time.Now().UTC().UnixMilli()
	if err := model.UpdateRecordingJob(job, recordingJobCompletedUpdates(now, recordingFile.ID)); err != nil {
		_ = deleteRecordingArtifactIfExists(finalKey)
		return nil, fmt.Errorf("update job status failed: %w", err)
	}

	elasticsearch.SyncFileToES(recordingFile, "create")
	cleanupRecordingTaskArtifacts(job)
	s.cleanupRecordingFinalizeSpool(job)

	s.triggerRecordingRAGParsing(ctx, job, recordingFile)

	logger.Infof(ctx, "【录音】直接 finalize 完成: job_id=%d output_file_id=%d", job.ID, recordingFile.ID)
	return recordingFile, nil
}

func hashBytes(data []byte) string {
	hash := sha256.Sum256(data)
	return hex.EncodeToString(hash[:])
}

func (s *RecordingService) triggerRecordingRAGParsing(ctx context.Context, job *model.RecordingJob, file *model.File) {
	if file == nil || file.ID == 0 {
		return
	}

	recordingConfig, err := model.ValidateOrCreateRecordingConfig(s.eid)
	if err != nil {
		logger.SysErrorf("【录音】检查解析配置失败: eid=%d err=%v", s.eid, err)
		return
	}

	if !recordingConfig.Enabled || recordingConfig.ParserPlatform == "" {
		return
	}

	params := map[string]interface{}{
		"eid":           s.eid,
		"file_id":       file.ID,
		"user_id":       job.UserID,
		"library_id":    job.LibraryID,
		"origin_status": model.FileConversionStatusPending,
	}
	paramsJSON, _ := json.Marshal(params)

	jobs, err := createRagJobsForFile(ctx, s.eid, file.ID, string(paramsJSON))
	if err != nil {
		logger.SysErrorf("【录音】创建解析任务失败: job_id=%d file_id=%d err=%v",
			job.ID, file.ID, err)
		return
	}

	if len(jobs) > 0 {
		model.UpdateFileConversionStatus(file.ID, model.FileConversionStatusPending)
		logger.Infof(ctx, "【录音】解析任务已创建: job_id=%d file_id=%d rag_job_id=%d",
			job.ID, file.ID, jobs[0].JobID)
	}
}

func (s *RecordingService) ListMyRecordingFiles(ctx context.Context, userID int64, query *RecordingFileListQuery) ([]model.File, int64, error) {
	if query == nil {
		query = &RecordingFileListQuery{}
	}
	if query.Offset < 0 {
		query.Offset = 0
	}
	if query.Limit <= 0 {
		query.Limit = 30
	}
	if query.Limit > 200 {
		query.Limit = 200
	}
	library, err := s.personalSpaceSvc.GetExistingPersonalLibrary(ctx, userID)
	if err != nil {
		return nil, 0, err
	}
	if library == nil {
		return []model.File{}, 0, nil
	}

	fileTypes := []int{model.FILE_TYPE_DIR, model.FILE_TYPE_FILE}
	if query.Type != nil {
		fileTypes = []int{*query.Type}
	}

	if strings.TrimSpace(query.Keyword) != "" {
		files, total, err := searchMySpaceFilesByKeywordWithOriginTypes(ctx, s.eid, library.ID, model.RecordingOriginTypes(), query.Keyword, query.Type, query.Offset, query.Limit)
		if err != nil {
			return nil, 0, err
		}
		if err := s.attachUploadFiles(files); err != nil {
			return nil, 0, err
		}
		if err := s.fillFavoriteStatus(userID, files); err != nil {
			return nil, 0, err
		}
		return files, total, nil
	}

	var files []model.File
	q := s.buildMyRecordingFilesQuery(library.ID, fileTypes, query.Path)

	if err := q.Order("created_time desc, id desc").Offset(query.Offset).Limit(query.Limit).Find(&files).Error; err != nil {
		return nil, 0, err
	}
	if err := s.attachUploadFiles(files); err != nil {
		return nil, 0, err
	}
	if err := s.fillFavoriteStatus(userID, files); err != nil {
		return nil, 0, err
	}

	var total int64
	if err := s.buildMyRecordingFilesQuery(library.ID, fileTypes, query.Path).
		Count(&total).Error; err != nil {
		return nil, 0, err
	}
	return files, total, nil
}

func (s *RecordingService) buildMyRecordingFilesQuery(libraryID int64, fileTypes []int, pathFilter string) *gorm.DB {
	q := model.DB.Model(&model.File{}).
		Where("eid = ? AND library_id = ? AND is_deleted = ?", s.eid, libraryID, false).
		Where("origin_type IN ?", model.RecordingOriginTypes()).
		Where("type IN ?", fileTypes)

	if strings.TrimSpace(pathFilter) != "" {
		normalized := normalizeRecordingPath(pathFilter)
		if normalized == "/" {
			q = q.Where("path LIKE ? AND path NOT LIKE ?", "/%", "/%/%")
		} else {
			q = q.Where("path LIKE ? AND path NOT LIKE ?", normalized+"/%", normalized+"/%/%")
		}
	}

	return q
}

func (s *RecordingService) fillFavoriteStatus(userID int64, files []model.File) error {
	fileIDs := make([]int64, 0, len(files))
	for _, file := range files {
		if file.ID > 0 {
			fileIDs = append(fileIDs, file.ID)
		}
	}
	if len(fileIDs) == 0 {
		return nil
	}

	favoriteMap, err := model.GetFavoriteResourceIDMap(userID, model.RESOURCE_TYPE_FILE, fileIDs)
	if err != nil {
		return err
	}
	for i := range files {
		if favoriteMap[files[i].ID] {
			files[i].IsFavorite = true
		}
	}
	return nil
}

func buildRecordingFilePath(job *model.RecordingJob, fileName string) string {
	recordingPath, err := resolveRecordingFilePath(job, fileName)
	if err != nil {
		return "/" + fileName
	}
	return recordingPath
}

func normalizeRecordingPath(recordingPath string) string {
	recordingPath = strings.TrimSpace(recordingPath)
	if recordingPath == "" {
		return "/"
	}
	if !strings.HasPrefix(recordingPath, "/") {
		recordingPath = "/" + recordingPath
	}
	cleaned := path.Clean(recordingPath)
	if cleaned == "." || cleaned == "" {
		return "/"
	}
	return cleaned
}

func buildRecordingFileName(startedAt int64, targetFormat string) string {
	if strings.TrimSpace(targetFormat) == "" {
		targetFormat = "m4a"
	}
	t := time.UnixMilli(startedAt).UTC()
	return fmt.Sprintf("会议_%04d%02d%02d_%02d%02d%02d.%s",
		t.Year(), t.Month(), t.Day(), t.Hour(), t.Minute(), t.Second(), strings.TrimPrefix(targetFormat, "."))
}

func resolveFFprobeToolchainPath() (string, error) {
	if path := strings.TrimSpace(os.Getenv("FFPROBE_PATH")); path != "" {
		if resolved, err := resolveRecordingProbeExecutableCandidate(path); err == nil {
			return resolved, nil
		}
	}

	if ffmpegPath, err := ResolveFFmpegToolchainPath(); err == nil {
		candidates := []string{
			filepath.Join(filepath.Dir(ffmpegPath), "ffprobe"),
			filepath.Join(filepath.Dir(ffmpegPath), "ffprobe.exe"),
		}
		for _, candidate := range candidates {
			if resolved, err := resolveRecordingProbeExecutableCandidate(candidate); err == nil {
				return resolved, nil
			}
		}
	}

	if path, err := exec.LookPath("ffprobe"); err == nil {
		if resolved, err := resolveRecordingProbeExecutableCandidate(path); err == nil {
			return resolved, nil
		}
	}

	return "", errors.New("未找到可用的 ffprobe 可执行文件")
}

func resolveRecordingProbeExecutableCandidate(candidate string) (string, error) {
	candidate = filepath.Clean(strings.TrimSpace(candidate))
	if candidate == "" {
		return "", errors.New("empty candidate")
	}

	info, err := os.Stat(candidate)
	if err != nil {
		return "", err
	}
	if info.IsDir() {
		nested := filepath.Join(candidate, filepath.Base(candidate))
		nestedInfo, nestedErr := os.Stat(nested)
		if nestedErr != nil {
			return "", nestedErr
		}
		if nestedInfo.Mode().IsRegular() && nestedInfo.Mode().Perm()&0o111 != 0 {
			return nested, nil
		}
		return "", fmt.Errorf("%s is a directory without executable binary", candidate)
	}
	if !info.Mode().IsRegular() {
		return "", fmt.Errorf("%s is not a regular file", candidate)
	}
	if info.Mode().Perm()&0o111 == 0 {
		return "", fmt.Errorf("%s is not executable", candidate)
	}
	return candidate, nil
}

func detectRecordingMimeType(targetFormat string) string {
	switch strings.ToLower(strings.TrimPrefix(targetFormat, ".")) {
	case "mp3":
		return "audio/mpeg"
	case "wav":
		return "audio/wav"
	case "aac":
		return "audio/aac"
	case "ogg":
		return "audio/ogg"
	case "webm":
		return "audio/webm"
	default:
		return "audio/mp4"
	}
}

func estimateRecordingSegmentRecordedMs(durationMs, startOffsetMs, endOffsetMs int64) int64 {
	if durationMs > 0 {
		return durationMs
	}
	if endOffsetMs > startOffsetMs {
		return endOffsetMs - startOffsetMs
	}
	return 0
}

func hashFile(filePath string) (string, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return "", fmt.Errorf("open file error: %w", err)
	}
	defer file.Close()

	hasher := sha256.New()
	if _, err := io.Copy(hasher, file); err != nil {
		return "", fmt.Errorf("hash file error: %w", err)
	}
	return hex.EncodeToString(hasher.Sum(nil)), nil
}

func (s *RecordingService) attachUploadFiles(files []model.File) error {
	if len(files) == 0 {
		return nil
	}
	uploadFileIDs := make([]int64, 0, len(files))
	for _, f := range files {
		if f.UploadFileID > 0 {
			uploadFileIDs = append(uploadFileIDs, f.UploadFileID)
		}
	}
	if len(uploadFileIDs) == 0 {
		return nil
	}
	var uploadFiles []model.UploadFile
	if err := model.DB.Where("id IN ?", uploadFileIDs).Find(&uploadFiles).Error; err != nil {
		return err
	}
	uploadFileMap := make(map[int64]*model.UploadFile, len(uploadFiles))
	for i := range uploadFiles {
		uploadFileMap[uploadFiles[i].ID] = &uploadFiles[i]
	}
	for i := range files {
		if files[i].UploadFileID > 0 {
			if uf, ok := uploadFileMap[files[i].UploadFileID]; ok {
				files[i].UploadFile = uf
			}
		}
	}
	return nil
}
