package service

import (
	"errors"
	"path"
	"strings"

	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

func recordingJobFailureUpdates(now int64, reason string) map[string]interface{} {
	return map[string]interface{}{
		"last_error":     reason,
		"last_active_at": now,
	}
}

func recordingJobFatalFailureUpdates(now int64, reason string) map[string]interface{} {
	updates := recordingJobFailureUpdates(now, reason)
	updates["status"] = model.RecordingJobStatusFailed
	updates["ended_at"] = now
	updates["recovery_state"] = "failed"
	updates["recovery_error"] = reason
	return updates
}

func recordingJobRecoveryReadyUpdates(now int64) map[string]interface{} {
	return map[string]interface{}{
		"recovery_state":    "ready",
		"recovery_error":    "",
		"last_recovered_at": now,
	}
}

func recordingJobRecoveryReadyStateUpdates() map[string]interface{} {
	return map[string]interface{}{
		"recovery_state": "ready",
		"recovery_error": "",
	}
}

func recordingJobAcceptedSegmentUpdates(now int64, segmentIndex int64, acceptedDuration int64) map[string]interface{} {
	updates := recordingJobRecoveryReadyStateUpdates()
	updates["last_active_at"] = now
	updates["next_expected_segment_index"] = segmentIndex + 1
	updates["last_accepted_segment_index"] = segmentIndex
	if acceptedDuration > 0 {
		updates["total_recorded_ms"] = gorm.Expr("total_recorded_ms + ?", acceptedDuration)
		updates["uploaded_recorded_ms"] = gorm.Expr("uploaded_recorded_ms + ?", acceptedDuration)
		updates["uploaded_segment_count"] = gorm.Expr("uploaded_segment_count + ?", 1)
	}
	return updates
}

func recordingJobFlushedSegmentUpdates(now int64, segmentIndex int64, acceptedDuration int64) map[string]interface{} {
	updates := recordingJobAcceptedSegmentUpdates(now, segmentIndex, acceptedDuration)
	updates["segment_count"] = int64(1)
	updates["last_segment_index"] = segmentIndex
	return updates
}

func recordingAssemblyBufferedUpdates(bufferKey string, bufferSize int64, bufferDurationMs int64, lastInputIndex int64, lastInputHash string) map[string]interface{} {
	return map[string]interface{}{
		"buffer_key":         bufferKey,
		"buffer_size":        bufferSize,
		"buffer_duration_ms": bufferDurationMs,
		"last_input_index":   lastInputIndex,
		"last_input_hash":    lastInputHash,
		"status":             model.RecordingJobAssemblyStatusActive,
	}
}

func recordingAssemblyStatusUpdates(status string) map[string]interface{} {
	return map[string]interface{}{
		"status": status,
	}
}

func recordingAssemblyBufferKeyUpdates(bufferKey string) map[string]interface{} {
	if strings.TrimSpace(bufferKey) == "" {
		return map[string]interface{}{}
	}
	return map[string]interface{}{
		"buffer_key": bufferKey,
	}
}

func recordingAssemblyFailedStatusUpdates() map[string]interface{} {
	return recordingAssemblyStatusUpdates(model.RecordingJobAssemblyStatusFailed)
}

func recordingAssemblyResetAfterFlushUpdates(segmentIndex int64) map[string]interface{} {
	return map[string]interface{}{
		"segment_index":      segmentIndex,
		"buffer_key":         "",
		"buffer_size":        int64(0),
		"buffer_duration_ms": int64(0),
		"last_input_index":   int64(-1),
		"last_input_hash":    "",
		"status":             model.RecordingJobAssemblyStatusActive,
	}
}

func recordingAssemblyRestoreSnapshotUpdates(snapshot *model.RecordingJobAssembly) map[string]interface{} {
	if snapshot == nil {
		return nil
	}
	return map[string]interface{}{
		"segment_index":      snapshot.SegmentIndex,
		"buffer_key":         snapshot.BufferKey,
		"buffer_size":        snapshot.BufferSize,
		"buffer_duration_ms": snapshot.BufferDurationMs,
		"last_input_index":   snapshot.LastInputIndex,
		"last_input_hash":    snapshot.LastInputHash,
		"status":             snapshot.Status,
	}
}

func recordingJobNeedReconcileUpdates(now int64, reason string) map[string]interface{} {
	updates := recordingJobFailureUpdates(now, reason)
	updates["status"] = model.RecordingJobStatusFinalizing
	updates["recovery_state"] = "need_reconcile"
	updates["recovery_error"] = reason
	return updates
}

func recordingJobCompletedUpdates(now int64, outputFileID int64) map[string]interface{} {
	return map[string]interface{}{
		"status":         model.RecordingJobStatusCompleted,
		"ended_at":       now,
		"last_active_at": now,
		"output_file_id": outputFileID,
		"last_error":     "",
	}
}

func resolveRecordingFilePath(job *model.RecordingJob, fileName string) (string, error) {
	if job == nil {
		return "", errors.New("recording job is nil")
	}
	if strings.TrimSpace(fileName) == "" {
		return "", errors.New("file name is required")
	}
	if job.DestinationFolderFileID <= 0 {
		return "/" + fileName, nil
	}
	folder, err := model.GetFileByID(job.Eid, job.DestinationFolderFileID)
	if err != nil {
		return "", err
	}
	if folder == nil {
		return "", errors.New("destination folder is nil")
	}
	if folder.Type != model.FILE_TYPE_DIR {
		return "", errors.New("destination is not a directory")
	}
	if folder.LibraryID != job.LibraryID {
		return "", errors.New("destination folder is not in recording library")
	}
	if folder.Path == "/" {
		return "/" + fileName, nil
	}
	return path.Join(folder.Path, fileName), nil
}
