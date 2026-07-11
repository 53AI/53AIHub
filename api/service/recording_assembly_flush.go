package service

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
)

func (s *RecordingAssemblyService) flushAssembly(ctx context.Context, job *model.RecordingJob, assembly *model.RecordingJobAssembly, inputSegmentIndex int64, acceptedDuration int64) (*model.RecordingJobSegment, error) {
	if assembly == nil {
		return nil, errors.New("recording assembly is nil")
	}
	bufferKey := strings.TrimSpace(assembly.BufferKey)
	if bufferKey == "" {
		return nil, errors.New("buffer key is required")
	}

	if !assembly.CanEnterFlushing() {
		return nil, fmt.Errorf("当前聚合状态不支持收口: %s", assembly.Status)
	}
	assemblySnapshot := *assembly
	if err := model.UpdateRecordingJobAssembly(assembly, recordingAssemblyStatusUpdates(model.RecordingJobAssemblyStatusFlushing)); err != nil {
		return nil, err
	}
	assembly.Status = model.RecordingJobAssemblyStatusFlushing

	content, err := loadRecordingArtifact(bufferKey)
	if err != nil {
		_ = model.UpdateRecordingJobAssembly(assembly, recordingAssemblyFailedStatusUpdates())
		return nil, err
	}

	segmentIndex := int64(0)
	var existingSegmentSnapshot *model.RecordingJobSegment
	var existingSegmentContent []byte
	if existingSegment, existingErr := model.GetRecordingJobSegmentByIndex(job.ID, segmentIndex); existingErr == nil {
		existingSegmentSnapshot = existingSegment
		existingSegmentContent, err = loadRecordingArtifact(existingSegment.StorageKey)
		if err != nil {
			_ = model.UpdateRecordingJobAssembly(assembly, recordingAssemblyFailedStatusUpdates())
			return nil, err
		}
	}
	segmentKey := model.BuildRecordingSegmentLocalStorageKey(s.eid, job.UserID, job.ID, segmentIndex, fmt.Sprintf("segment-%d.webm", segmentIndex))
	if existingSegmentSnapshot != nil {
		if err := appendRecordingArtifact(segmentKey, content); err != nil {
			_ = model.UpdateRecordingJobAssembly(assembly, recordingAssemblyFailedStatusUpdates())
			return nil, err
		}
	} else if err := saveRecordingArtifact(segmentKey, content); err != nil {
		_ = model.UpdateRecordingJobAssembly(assembly, recordingAssemblyFailedStatusUpdates())
		return nil, err
	}
	finalContent, err := loadRecordingArtifact(segmentKey)
	if err != nil {
		_ = model.UpdateRecordingJobAssembly(assembly, recordingAssemblyFailedStatusUpdates())
		return nil, err
	}

	bufferStartOffsetMs := job.TotalRecordedMs - (assembly.BufferDurationMs - acceptedDuration)
	if bufferStartOffsetMs < 0 {
		bufferStartOffsetMs = 0
	}
	bufferEndOffsetMs := bufferStartOffsetMs + assembly.BufferDurationMs
	segmentStartOffsetMs := bufferStartOffsetMs
	if existingSegmentSnapshot != nil {
		segmentStartOffsetMs = existingSegmentSnapshot.StartOffsetMs
	}
	segmentEndOffsetMs := bufferEndOffsetMs
	segmentDurationMs := segmentEndOffsetMs - segmentStartOffsetMs
	if segmentDurationMs < 0 {
		segmentDurationMs = 0
	}

	segment := &model.RecordingJobSegment{
		JobID:                job.ID,
		Eid:                  s.eid,
		UserID:               job.UserID,
		SegmentIndex:         segmentIndex,
		StorageKey:           segmentKey,
		SegmentHash:          hashBytes(finalContent),
		MimeType:             reqMimeTypeOrDefault(job.SourceMimeType),
		Size:                 int64(len(finalContent)),
		DurationMs:           segmentDurationMs,
		StartOffsetMs:        segmentStartOffsetMs,
		EndOffsetMs:          segmentEndOffsetMs,
		Status:               model.RecordingJobSegmentStatusUploaded,
		TranscodeStatus:      model.RecordingJobSegmentTranscodeStatusPending,
		TranscodedStorageKey: "",
		TranscodedMimeType:   "",
		TranscodedSize:       0,
		TranscodeError:       "",
		UploadedAt:           time.Now().UTC().UnixMilli(),
	}
	created, err := model.UpsertRecordingJobSegment(segment)
	if err != nil {
		_ = model.UpdateRecordingJobAssembly(assembly, recordingAssemblyFailedStatusUpdates())
		_ = s.rollbackRecordingAssemblyFlush(ctx, job, assembly, &assemblySnapshot, existingSegmentSnapshot, existingSegmentContent, created, segmentKey, content)
		return nil, err
	}

	if err := deleteRecordingArtifactIfExists(bufferKey); err != nil {
		_ = model.UpdateRecordingJobAssembly(assembly, recordingAssemblyFailedStatusUpdates())
		_ = s.rollbackRecordingAssemblyFlush(ctx, job, assembly, &assemblySnapshot, existingSegmentSnapshot, existingSegmentContent, created, segmentKey, content)
		return nil, err
	}

	if err := model.UpdateRecordingJobAssembly(assembly, recordingAssemblyResetAfterFlushUpdates(segmentIndex)); err != nil {
		_ = s.rollbackRecordingAssemblyFlush(ctx, job, assembly, &assemblySnapshot, existingSegmentSnapshot, existingSegmentContent, created, segmentKey, content)
		return nil, err
	}
	jobUpdates := recordingJobFlushedSegmentUpdates(time.Now().UTC().UnixMilli(), inputSegmentIndex, acceptedDuration)
	if err := updateRecordingJobFn(job, jobUpdates); err != nil {
		_ = s.rollbackRecordingAssemblyFlush(ctx, job, assembly, &assemblySnapshot, existingSegmentSnapshot, existingSegmentContent, created, segmentKey, content)
		return nil, err
	}
	assembly.SegmentIndex = segmentIndex
	assembly.BufferKey = ""
	assembly.BufferSize = 0
	assembly.BufferDurationMs = 0
	assembly.LastInputIndex = -1
	assembly.LastInputHash = ""
	assembly.Status = model.RecordingJobAssemblyStatusActive

	logger.Infof(ctx, "【录音】聚合块已生成: job_id=%d segment_index=%d size=%d", job.ID, segmentIndex, len(content))
	return segment, nil
}

func (s *RecordingAssemblyService) rollbackRecordingAssemblyFlush(
	ctx context.Context,
	job *model.RecordingJob,
	assembly *model.RecordingJobAssembly,
	assemblySnapshot *model.RecordingJobAssembly,
	existingSegmentSnapshot *model.RecordingJobSegment,
	existingSegmentContent []byte,
	created bool,
	segmentKey string,
	content []byte,
) error {
	if segmentKey != "" {
		if created || len(existingSegmentContent) == 0 {
			_ = deleteRecordingArtifactIfExists(segmentKey)
		} else if err := saveRecordingArtifact(segmentKey, existingSegmentContent); err != nil {
			logger.SysErrorf("【录音】回滚录音聚合块失败，恢复旧分段文件失败: job_id=%d segment_index=%d err=%v", job.ID, assemblySnapshot.SegmentIndex, err)
		}
	}

	if created {
		_ = model.DB.Where("job_id = ? AND segment_index = ? AND owner_instance = ?", job.ID, assemblySnapshot.SegmentIndex, config.GetRecordingInstanceID()).Delete(&model.RecordingJobSegment{}).Error
	} else if existingSegmentSnapshot != nil {
		if _, err := model.UpsertRecordingJobSegment(existingSegmentSnapshot); err != nil {
			logger.SysErrorf("【录音】回滚录音聚合块失败，恢复旧分段记录失败: job_id=%d segment_index=%d err=%v", job.ID, assemblySnapshot.SegmentIndex, err)
		}
	}

	if len(content) > 0 && strings.TrimSpace(assemblySnapshot.BufferKey) != "" {
		if err := ensureRecordingDirectory(filepath.Dir(assemblySnapshot.BufferKey), recordingLocalDirMode, false); err == nil {
			_ = ensureRecordingWritableFile(assemblySnapshot.BufferKey, recordingAssemblySpoolFileMode)
			if err := os.WriteFile(assemblySnapshot.BufferKey, content, 0o644); err == nil {
				_ = ensureRecordingFileMode(assemblySnapshot.BufferKey, recordingAssemblySpoolFileMode)
			}
		}
	}

	if err := model.UpdateRecordingJobAssembly(assembly, recordingAssemblyRestoreSnapshotUpdates(assemblySnapshot)); err != nil {
		logger.SysErrorf("【录音】回滚录音聚合块失败，恢复聚合器状态失败: job_id=%d segment_index=%d err=%v", job.ID, assemblySnapshot.SegmentIndex, err)
		return err
	}

	assembly.SegmentIndex = assemblySnapshot.SegmentIndex
	assembly.BufferKey = assemblySnapshot.BufferKey
	assembly.BufferSize = assemblySnapshot.BufferSize
	assembly.BufferDurationMs = assemblySnapshot.BufferDurationMs
	assembly.LastInputIndex = assemblySnapshot.LastInputIndex
	assembly.LastInputHash = assemblySnapshot.LastInputHash
	assembly.Status = assemblySnapshot.Status
	return nil
}

func reqMimeTypeOrDefault(mimeType string) string {
	mimeType = strings.TrimSpace(mimeType)
	if mimeType == "" {
		return "audio/webm"
	}
	return mimeType
}
