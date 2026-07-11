package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

func (s *RecordingAssemblyService) AppendSegment(ctx context.Context, userID int64, jobID int64, req *UploadRecordingSegmentRequest) (*model.RecordingJobSegment, error) {
	segment, _, err := s.AppendSegmentWithResult(ctx, userID, jobID, req)
	return segment, err
}

func (s *RecordingAssemblyService) AppendSegmentWithResult(ctx context.Context, userID int64, jobID int64, req *UploadRecordingSegmentRequest) (*model.RecordingJobSegment, bool, error) {
	if req == nil || req.FileHeader == nil {
		return nil, false, errors.New("segment file is required")
	}

	job, err := model.GetRecordingJobByID(s.eid, jobID)
	if err != nil {
		return nil, false, err
	}
	if job.UserID != userID {
		return nil, false, ErrRecordingJobForbidden
	}
	if job.Status != model.RecordingJobStatusRecording && job.Status != model.RecordingJobStatusPaused && job.Status != model.RecordingJobStatusInterrupted {
		return nil, false, fmt.Errorf("%w: %s", ErrRecordingJobStateNotSupported, job.Status)
	}

	unlock := assemblyLockRegistry.lock(jobID)
	defer unlock()

	assembly, err := model.GetRecordingJobAssemblyByJobID(jobID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			assembly = &model.RecordingJobAssembly{
				JobID:          jobID,
				Eid:            s.eid,
				UserID:         userID,
				SegmentIndex:   0,
				LastInputIndex: -1,
				Status:         model.RecordingJobAssemblyStatusActive,
			}
			if err := model.CreateRecordingJobAssembly(assembly); err != nil {
				return nil, false, err
			}
		} else {
			return nil, false, err
		}
	}

	if !assembly.CanAppend() {
		return nil, false, fmt.Errorf("当前聚合状态不支持追加: %s", assembly.Status)
	}

	shouldRepair, _, err := s.hasPendingAssemblyBuffer(job, assembly)
	if err != nil {
		return nil, false, err
	}
	if shouldRepair {
		if err := s.ensureAssemblyRecoverable(ctx, job, assembly); err != nil {
			return nil, false, err
		}
	}

	return s.appendToAssembly(ctx, job, assembly, req)
}

func (s *RecordingAssemblyService) appendToAssembly(ctx context.Context, job *model.RecordingJob, assembly *model.RecordingJobAssembly, req *UploadRecordingSegmentRequest) (*model.RecordingJobSegment, bool, error) {
	file, err := req.FileHeader.Open()
	if err != nil {
		return nil, false, err
	}
	defer file.Close()

	content, err := io.ReadAll(file)
	if err != nil {
		return nil, false, err
	}

	hash := sha256.Sum256(content)
	hashStr := hex.EncodeToString(hash[:])

	expectedSegmentIndex := job.NextExpectedSegmentIndex
	if expectedSegmentIndex < 0 {
		expectedSegmentIndex = 0
	}
	if req.SegmentIndex < expectedSegmentIndex {
		if req.SegmentIndex == assembly.LastInputIndex && strings.EqualFold(strings.TrimSpace(assembly.LastInputHash), hashStr) {
			return nil, false, nil
		}
		return nil, false, ErrRecordingAssemblyDuplicateSegmentConflict
	}
	if req.SegmentIndex > expectedSegmentIndex {
		return nil, false, fmt.Errorf("录音分片缺失: expected=%d got=%d", expectedSegmentIndex, req.SegmentIndex)
	}

	bufferKey := strings.TrimSpace(assembly.BufferKey)
	if bufferKey == "" {
		bufferKey = s.buildAssemblyBufferKey(job.ID, assembly.SegmentIndex)
	}

	if strings.TrimSpace(assembly.BufferKey) == "" {
		if err := model.UpdateRecordingJobAssembly(assembly, recordingAssemblyBufferKeyUpdates(bufferKey)); err != nil {
			return nil, false, err
		}
		assembly.BufferKey = bufferKey
	}

	assemblySnapshot := *assembly
	bufferExisted := false
	var previousBuffer []byte
	if recordingArtifactExists(bufferKey) {
		bufferExisted = true
		previousBuffer, err = loadRecordingArtifact(bufferKey)
		if err != nil {
			return nil, false, err
		}
	}

	if err := s.appendToBuffer(bufferKey, content); err != nil {
		return nil, false, err
	}

	newBufferSize := assembly.BufferSize + int64(len(content))
	newDuration := assembly.BufferDurationMs + estimateRecordingSegmentRecordedMs(req.DurationMs, req.StartOffsetMs, req.EndOffsetMs)
	if err := model.UpdateRecordingJobAssembly(assembly, map[string]interface{}{
		"buffer_key":         bufferKey,
		"buffer_size":        newBufferSize,
		"buffer_duration_ms": newDuration,
		"last_input_index":   req.SegmentIndex,
		"last_input_hash":    hashStr,
		"status":             model.RecordingJobAssemblyStatusActive,
	}); err != nil {
		_ = s.restoreRecordingAssemblyAfterAppendFailure(assembly, &assemblySnapshot, bufferKey, bufferExisted, previousBuffer)
		return nil, false, err
	}
	assembly.BufferKey = bufferKey
	assembly.BufferSize = newBufferSize
	assembly.BufferDurationMs = newDuration
	assembly.LastInputIndex = req.SegmentIndex
	assembly.LastInputHash = hashStr
	assembly.Status = model.RecordingJobAssemblyStatusActive

	acceptedDuration := estimateRecordingSegmentRecordedMs(req.DurationMs, req.StartOffsetMs, req.EndOffsetMs)
	now := time.Now().UTC().UnixMilli()
	if shouldFlushRecordingAssembly(newBufferSize, newDuration, req.IsFinalSegment, int(req.SegmentIndex+1)) {
		segment, err := s.flushAssembly(ctx, job, assembly, req.SegmentIndex, acceptedDuration)
		return segment, true, err
	}
	jobUpdates := recordingJobAcceptedSegmentUpdates(now, req.SegmentIndex, acceptedDuration)
	if err := updateRecordingJobFn(job, jobUpdates); err != nil {
		_ = s.restoreRecordingAssemblyAfterAppendFailure(assembly, &assemblySnapshot, bufferKey, bufferExisted, previousBuffer)
		return nil, false, err
	}
	return nil, true, nil
}

func shouldFlushRecordingAssembly(bufferSize, bufferDurationMs int64, isFinalSegment bool, segmentCount int) bool {
	_ = segmentCount
	if isFinalSegment {
		return true
	}
	if recordingAssemblyFlushThresholdBytes > 0 && bufferSize >= recordingAssemblyFlushThresholdBytes {
		return true
	}
	if recordingAssemblyFlushDurationThresholdMs > 0 && bufferDurationMs >= recordingAssemblyFlushDurationThresholdMs {
		return true
	}
	return false
}
