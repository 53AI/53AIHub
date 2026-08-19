package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/storage"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/elasticsearch"
	"gorm.io/gorm"
)

// RecordingFinalizeService 负责录音定稿、恢复和清理。
// 通过 RecordingService 的 GetJob 等查询录音任务信息。
type RecordingFinalizeService struct {
	eid        int64
	svc        *RecordingService
	transcoder RecordingTranscoder
}

// NewRecordingFinalizeService 创建定稿服务。svc 用于委托任务查询。
func NewRecordingFinalizeService(svc *RecordingService) *RecordingFinalizeService {
	return &RecordingFinalizeService{
		eid:        svc.eid,
		svc:        svc,
		transcoder: newRecordingTranscoder(),
	}
}

// ============================================================
// 定稿流程
// ============================================================

// RequestFinalize 请求结束录音。检查权限、装配状态，更新任务状态为 finalizing。
func (f *RecordingFinalizeService) RequestFinalize(ctx context.Context, userID int64, jobID int64) (*model.RecordingJob, error) {
	job, err := f.svc.GetJob(ctx, userID, jobID)
	if err != nil {
		return nil, err
	}
	if !CheckFFmpegAvailable() {
		_ = f.recordFinalizeRequestFailure(job, ErrFFmpegNotAvailable)
		return nil, ErrFFmpegNotAvailable
	}
	if !job.CanEnterFinalizing() {
		stateErr := fmt.Errorf("%w: %s", ErrRecordingJobStateNotSupported, job.Status)
		_ = f.recordFinalizeRequestFailure(job, stateErr)
		return nil, stateErr
	}

	assemblySvc := NewRecordingAssemblyService(f.eid)
	if assembly, assemblyErr := model.GetRecordingJobAssemblyByJobID(jobID); assemblyErr == nil && assembly != nil {
		shouldRepair, _, pendingErr := assemblySvc.hasPendingAssemblyBuffer(job, assembly)
		if pendingErr != nil {
			_ = f.recordFinalizeRequestFailure(job, pendingErr)
			return nil, pendingErr
		}
		if shouldRepair {
			if checkErr := assemblySvc.prepareAssemblyBuffer(ctx, job, assembly); checkErr != nil {
				_ = f.recordFinalizeRequestFailure(job, checkErr)
				return nil, checkErr
			}
		}
	} else if assemblyErr != nil && !errors.Is(assemblyErr, gorm.ErrRecordNotFound) {
		_ = f.recordFinalizeRequestFailure(job, assemblyErr)
		return nil, assemblyErr
	}

	unlock := recordingFinalizeLockRegistry.lock(jobID)
	defer unlock()

	now := time.Now().UTC().UnixMilli()
	result := model.DB.Model(&model.RecordingJob{}).
		Where("id = ? AND eid = ? AND user_id = ? AND owner_instance = ? AND status IN ?", jobID, f.eid, userID, config.GetRecordingInstanceID(), []string{
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

	return model.GetRecordingJobByID(f.eid, jobID)
}

func (f *RecordingFinalizeService) recordFinalizeRequestFailure(job *model.RecordingJob, reason error) error {
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

// CompleteFinalize 完成定稿。检查任务状态，然后执行完整定稿流程。
func (f *RecordingFinalizeService) CompleteFinalize(ctx context.Context, userID int64, jobID int64) (*model.File, error) {
	job, err := model.GetRecordingJobByID(f.eid, jobID)
	if err != nil {
		return nil, err
	}
	if job.UserID != userID {
		return nil, ErrRecordingJobForbidden
	}
	if job.Status != model.RecordingJobStatusFinalizing && job.Status != model.RecordingJobStatusFinalizingProcessing {
		return nil, fmt.Errorf("%w: %s", ErrRecordingJobStateNotSupported, job.Status)
	}
	return f.completeFinalizeRecordingJob(ctx, job, model.RecordingJobStatusFinalizing)
}

func (f *RecordingFinalizeService) completeFinalizeRecordingJob(ctx context.Context, job *model.RecordingJob, restoreStatus string) (result *model.File, err error) {
	if job == nil {
		return nil, errors.New("recording job is nil")
	}
	defer assemblyLockRegistry.cleanupLock(job.ID)

	failFinalize := func(reason error) error {
		return f.failFinalizeRecordingJob(ctx, job, restoreStatus, reason)
	}

	unlock := recordingFinalizeLockRegistry.lock(job.ID)
	defer unlock()

	assemblySvc := NewRecordingAssemblyService(f.eid)
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
		repairedSegments, repairErr := f.repairRecordingJobSegmentsForFinalize(ctx, job, segments)
		if repairErr != nil {
			logger.SysErrorf("【录音】修复历史录音分段失败: job_id=%d err=%v", job.ID, repairErr)
			return nil, failFinalize(repairErr)
		}
		segments = repairedSegments
	}
	result, err = f.directFinalizeRecordingJob(ctx, job, segments)
	if err != nil {
		return nil, failFinalize(err)
	}
	return result, nil
}

// Finalize 一站式完成录音（RequestFinalize + CompleteFinalize）。
func (f *RecordingFinalizeService) Finalize(ctx context.Context, userID int64, jobID int64) (*model.File, error) {
	logger.Infof(ctx, "【录音】开始结束录音任务: job_id=%d user_id=%d", jobID, userID)
	job, err := f.RequestFinalize(ctx, userID, jobID)
	if err != nil {
		logger.SysErrorf("【录音】获取或提交录音任务失败: job_id=%d err=%v", jobID, err)
		return nil, err
	}
	return f.CompleteFinalize(ctx, userID, job.ID)
}

// directFinalizeRecordingJob 执行实际的定稿操作：转码、保存文件、创建 UploadFile 和 File 记录、触发 RAG 解析。
func (f *RecordingFinalizeService) directFinalizeRecordingJob(ctx context.Context, job *model.RecordingJob, segments []model.RecordingJobSegment) (*model.File, error) {
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
		transcodedContent, transcodeErr = f.transcoder.TranscodeFromFile(ctx, diskPath, job.TargetFormat)
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
		transcodedContent, transcodeErr = f.transcoder.Transcode(ctx, [][]byte{data}, job.TargetFormat)
		if transcodeErr != nil {
			return nil, fmt.Errorf("transcode failed: %w", transcodeErr)
		}
	}

	transcodeDuration := time.Since(transcodeStart)
	logger.Infof(ctx, "【录音】直接转码完成: job_id=%d 耗时=%.1f秒 输出大小=%.2fMB", job.ID, transcodeDuration.Seconds(), float64(len(transcodedContent))/1024/1024)

	finalName := buildRecordingFileName(job.StartedAt, job.TargetFormat)
	finalKey := model.BuildRecordingOutputStorageKey(f.eid, job.UserID, job.ID, finalName)

	if err := saveRecordingArtifact(finalKey, transcodedContent); err != nil {
		return nil, fmt.Errorf("save final file failed: %w", err)
	}

	outputHash := hashBytes(transcodedContent)
	uploadFile := &model.UploadFile{
		FileName:  finalName,
		Key:       finalKey,
		Eid:       f.eid,
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
	recordingConfig, cfgErr := model.ValidateOrCreateRecordingConfig(f.eid)
	hasParser := cfgErr == nil && recordingConfig.Enabled && recordingConfig.ParserPlatform != ""

	parsingStatus := model.FileParsingStatusNormal
	if !hasParser {
		parsingStatus = model.FileParsingStatusInactive
	}

	recordingFile := &model.File{
		Eid:                f.eid,
		LibraryID:          job.LibraryID,
		Path:               recordingPath,
		Type:               model.FILE_TYPE_FILE,
		UserID:             job.UserID,
		UploadFileID:       uploadFile.ID,
		DurationMs:         job.TotalRecordedMs,
		GroupID:            job.GroupID,
		ConversionStatus:   model.FileConversionStatusNormal,
		ParsingStatus:      parsingStatus,
		InsightPerspective: string(model.NormalizeInsightPerspective(job.InsightPerspective)),
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
	f.cleanupRecordingFinalizeSpool(job)

	if hasParser {
		f.triggerRecordingRAGParsing(ctx, job, recordingFile)
	}

	logger.Infof(ctx, "【录音】直接 finalize 完成: job_id=%d output_file_id=%d", job.ID, recordingFile.ID)
	return recordingFile, nil
}

// failFinalizeRecordingJob 定稿失败时回退任务状态。
func (f *RecordingFinalizeService) failFinalizeRecordingJob(ctx context.Context, job *model.RecordingJob, restoreStatus string, reason error) error {
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
		f.cleanupRecordingFinalizeSpool(job)
	} else {
		logger.SysWarnf("【录音】录音任务失败并回退到可重试状态: job_id=%d restore_status=%s err=%v", job.ID, targetStatus, reason)
	}
	return reason
}

// isRecordingFinalizeFatalReason 判断错误是否为终态失败。
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

// repairRecordingJobSegmentsForFinalize 修复历史脏分段（合并为单分段）。
func (f *RecordingFinalizeService) repairRecordingJobSegmentsForFinalize(ctx context.Context, job *model.RecordingJob, segments []model.RecordingJobSegment) ([]model.RecordingJobSegment, error) {
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
	canonicalSegment.StorageKey = model.BuildRecordingSegmentLocalStorageKey(f.eid, job.UserID, job.ID, 0, "segment-0.webm")
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

// ============================================================
// 恢复流程
// ============================================================

// RecoverPendingFinalizingJobs 恢复本 EID 下超时的 finalizing 任务。
func (f *RecordingFinalizeService) RecoverPendingFinalizingJobs(ctx context.Context) (int, error) {
	cutoff := time.Now().UTC().UnixMilli() - recordingFinalizeRecoveryLease.Milliseconds()
	var jobs []model.RecordingJob
	if err := model.DB.Where("eid = ? AND owner_instance = ? AND ((status = ?) OR (status = ? AND last_active_at <= ?))",
		f.eid, config.GetRecordingInstanceID(),
		model.RecordingJobStatusFinalizingProcessing,
		model.RecordingJobStatusFinalizing,
		cutoff).
		Order("id asc").
		Find(&jobs).Error; err != nil {
		return 0, err
	}

	recovered := 0
	for i := range jobs {
		ok, err := f.recoverFinalizingJob(ctx, &jobs[i])
		if err != nil {
			return recovered, err
		}
		if ok {
			recovered++
		}
	}
	return recovered, nil
}

// RecoverPendingFinalizingRecordingJobs 恢复所有 EID 下超时的 finalizing 任务。
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
		svc := NewRecordingService(eid)
		recovered, err := svc.finalizeSvc.RecoverPendingFinalizingJobs(ctx)
		if err != nil {
			return total, err
		}
		total += recovered
	}
	return total, nil
}

func (f *RecordingFinalizeService) recoverFinalizingJob(ctx context.Context, job *model.RecordingJob) (bool, error) {
	if job == nil {
		return false, nil
	}
	_ = ctx

	unlock := recordingFinalizeLockRegistry.lock(job.ID)
	defer unlock()

	current, err := model.GetRecordingJobByID(f.eid, job.ID)
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

	assemblySvc := NewRecordingAssemblyService(f.eid)
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
	claimed, err := f.claimRecoveringFinalizingJob(current.ID, now)
	if err != nil {
		return false, err
	}
	if !claimed {
		return false, nil
	}

	recordingFile := &model.File{}
	foundRecordingFile := false

	if current.OutputFileID > 0 {
		if file, loadErr := model.GetFileByID(f.eid, current.OutputFileID); loadErr == nil && file != nil && file.OriginType == model.FileOriginTypeRecordingAudio {
			recordingFile = file
			foundRecordingFile = true
		}
	}

	if !foundRecordingFile {
		query := model.DB.Where(map[string]interface{}{
			"eid":           f.eid,
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

// classifyRecordingFinalizingRecoveryFailure 检查分段是否可重建。
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

func (f *RecordingFinalizeService) claimRecoveringFinalizingJob(jobID int64, now int64) (bool, error) {
	cutoff := now - recordingFinalizeRecoveryLease.Milliseconds()
	result := model.DB.Model(&model.RecordingJob{}).
		Where("eid = ? AND id = ? AND owner_instance = ? AND ((status = ?) OR (status = ? AND last_active_at <= ?))",
			f.eid, jobID, config.GetRecordingInstanceID(),
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

// ============================================================
// 清理
// ============================================================

// recordingLocalJobRootPath 返回录音任务本地根目录路径。
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

func (f *RecordingFinalizeService) cleanupRecordingLocalArtifacts(job *model.RecordingJob) {
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

func (f *RecordingFinalizeService) cleanupRecordingFinalizeSpool(job *model.RecordingJob) {
	if job == nil {
		return
	}
	if err := deleteRecordingAssemblyJobSpoolDir(recordingAssemblySpoolRootDir(), f.eid, job.ID); err != nil {
		logger.SysWarnf("【录音】清理录音聚合临时文件失败: job_id=%d err=%v", job.ID, err)
	}
}

// ============================================================
// RAG 解析触发
// ============================================================

func (f *RecordingFinalizeService) triggerRecordingRAGParsing(ctx context.Context, job *model.RecordingJob, file *model.File) {
	if file == nil || file.ID == 0 {
		return
	}

	recordingConfig, err := model.ValidateOrCreateRecordingConfig(f.eid)
	if err != nil {
		logger.SysErrorf("【录音】检查解析配置失败: eid=%d err=%v", f.eid, err)
		return
	}

	if !recordingConfig.Enabled || recordingConfig.ParserPlatform == "" {
		return
	}

	params := map[string]interface{}{
		"eid":           f.eid,
		"file_id":       file.ID,
		"user_id":       job.UserID,
		"library_id":    job.LibraryID,
		"origin_status": model.FileConversionStatusPending,
	}
	paramsJSON, _ := json.Marshal(params)

	jobs, err := createRagJobsForFile(ctx, f.eid, file.ID, string(paramsJSON))
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

// TriggerPendingRecordingParsings 后台配置语音模型后，自动触发所有未解析录音文件的解析。
func TriggerPendingRecordingParsings(ctx context.Context, eid int64, parserPlatform string) error {
	libraryIDs := model.GetPersonalLibraryIDsByEid(eid)
	if len(libraryIDs) == 0 {
		return nil
	}

	var files []model.File
	if err := model.DB.Model(&model.File{}).
		Where("eid = ? AND is_deleted = ? AND origin_type IN ? AND library_id IN ? AND parsing_status IN ?",
			eid, false, model.RecordingOriginTypes(), libraryIDs, []string{model.FileParsingStatusInactive, model.FileParsingStatusDisabled}).
		Find(&files).Error; err != nil {
		return fmt.Errorf("查询待解析录音文件失败: %w", err)
	}

	if len(files) == 0 {
		logger.Infof(ctx, "【录音】无待解析录音文件: eid=%d", eid)
		return nil
	}

	logger.Infof(ctx, "【录音】触发待解析录音: eid=%d count=%d", eid, len(files))
	for _, f := range files {
		// 跳过已有 FileBody 的文件（已处理过），避免重复创建 RAG 任务
		var existingBodyCount int64
		model.DB.Model(&model.FileBody{}).Where("eid = ? AND file_id = ?", eid, f.ID).Count(&existingBodyCount)
		if existingBodyCount > 0 {
			logger.Infof(ctx, "【录音】文件已有 FileBody，跳过: file_id=%d", f.ID)
			model.UpdateFileParsingStatus(f.ID, model.FileParsingStatusNormal)
			model.UpdateFileConversionStatus(f.ID, model.FileConversionStatusNormal)
			continue
		}

		params := map[string]interface{}{
			"eid":           eid,
			"file_id":       f.ID,
			"user_id":       f.UserID,
			"library_id":    f.LibraryID,
			"origin_status": model.FileConversionStatusPending,
			"parse_type":    parserPlatform, // 与 recording_config.parser_platform 一致，作为 stepConfig engine 的 fallback
		}
		paramsJSON, _ := json.Marshal(params)

		jobs, err := createRagJobsForFile(ctx, eid, f.ID, string(paramsJSON))
		if err != nil {
			logger.SysErrorf("【录音】触发待解析录音失败: file_id=%d err=%v", f.ID, err)
			continue
		}
		if len(jobs) > 0 {
			model.UpdateFileParsingStatus(f.ID, model.FileParsingStatusPending)
			model.UpdateFileConversionStatus(f.ID, model.FileConversionStatusPending)
			logger.Infof(ctx, "【录音】待解析录音已触发: file_id=%d rag_job_id=%d", f.ID, jobs[0].JobID)
		}
	}

	return nil
}

// CreateRagJobsForRecordingFile 导出包装：从子包创建录音文件的 RAG 解析任务。
// 内部委托给包级函数变量 createRagJobsForFile（file_processor.go），便于测试替换。
func CreateRagJobsForRecordingFile(ctx context.Context, eid, fileID int64, paramsJSON string) ([]*model.RagJob, error) {
	return createRagJobsForFile(ctx, eid, fileID, paramsJSON)
}

// ErrRetranscribeAlreadyProcessing 表示文件已有进行中的 document_parsing 任务（幂等，不重复建 job）。
var ErrRetranscribeAlreadyProcessing = errors.New("转写任务已在处理中")

// RetranscribeRecordingFile 对录音文件补触发转写（document_parsing job）。
// 用于同步时引擎未就绪导致"有录音无转写"的存量文件；复用 CreateRagJobsForRecordingFile。
// 幂等：已有 pending/processing document_parsing job 时返回 ErrRetranscribeAlreadyProcessing。
func RetranscribeRecordingFile(ctx context.Context, eid, fileID int64) error {
	file, err := model.GetFileByID(eid, fileID)
	if err != nil || file == nil {
		return fmt.Errorf("录音文件不存在: file_id=%d", fileID)
	}
	if !file.IsRecordingOriginType() && !isRecordingAudioPath(file.GetPath()) {
		return fmt.Errorf("非录音文件，不支持补转写: file_id=%d origin_type=%s", fileID, file.OriginType)
	}

	var jobCount int64
	model.DB.Model(&model.RagJob{}).
		Where("eid = ? AND related_id = ? AND type = ? AND status IN ?", eid, fileID, "document_parsing",
			[]string{model.RagJobStatusPending, model.RagJobStatusProcessing}).
		Count(&jobCount)
	if jobCount > 0 {
		return ErrRetranscribeAlreadyProcessing
	}

	params := map[string]interface{}{
		"eid":           eid,
		"file_id":       fileID,
		"user_id":       file.UserID,
		"library_id":    file.LibraryID,
		"origin_status": model.FileConversionStatusPending,
	}
	paramsJSON, err := json.Marshal(params)
	if err != nil {
		return fmt.Errorf("序列化 RAG 参数失败: %w", err)
	}

	jobs, err := CreateRagJobsForRecordingFile(ctx, eid, fileID, string(paramsJSON))
	if err != nil {
		return fmt.Errorf("创建解析任务失败: %w", err)
	}
	if len(jobs) > 0 {
		if err := model.UpdateFileConversionStatus(fileID, model.FileConversionStatusPending); err != nil {
			return fmt.Errorf("更新文件转换状态失败: %w", err)
		}
	}
	return nil
}

// isRecordingAudioPath 判断文件路径扩展名是否为录音音频格式（兼容早期 origin_type 缺失的录音文件）。
func isRecordingAudioPath(filePath string) bool {
	ext := strings.ToLower(path.Ext(filePath))
	for _, format := range RecordingAudioFormats {
		if ext == format {
			return true
		}
	}
	return false
}
