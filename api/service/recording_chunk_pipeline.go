package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
)

type RecordingChunkPipelineService struct {
	eid int64
}

func NewRecordingChunkPipelineService(eid int64) *RecordingChunkPipelineService {
	return &RecordingChunkPipelineService{eid: eid}
}

func (s *RecordingChunkPipelineService) AppendChunk(ctx context.Context, userID, jobID int64, req *UploadRecordingSegmentRequest) (*model.RecordingJobSegment, error) {
	if req == nil || req.FileHeader == nil {
		return nil, errors.New("segment file is required")
	}

	job, err := model.GetRecordingJobByID(s.eid, jobID)
	if err != nil {
		return nil, err
	}
	if job.UserID != userID {
		return nil, ErrRecordingJobForbidden
	}
	if job.Status != model.RecordingJobStatusRecording && job.Status != model.RecordingJobStatusPaused && job.Status != model.RecordingJobStatusInterrupted {
		return nil, fmt.Errorf("%w: %s", ErrRecordingJobStateNotSupported, job.Status)
	}

	content, storageKey, err := s.persistChunk(ctx, job, req)
	if err != nil {
		return nil, err
	}

	assemblySvc := NewRecordingAssemblyService(s.eid)
	segment, accepted, err := assemblySvc.AppendSegmentWithResult(ctx, userID, jobID, req)
	if err != nil {
		_ = s.cleanupPersistedChunk(job.ID, req.SegmentIndex, storageKey)
		return nil, err
	}
	if !accepted {
		_ = s.cleanupPersistedChunk(job.ID, req.SegmentIndex, storageKey)
		logger.Infof(ctx, "【录音】chunk已去重或已落清单，等待聚合收口: job_id=%d segment_index=%d", jobID, req.SegmentIndex)
		return nil, nil
	}

	logger.Infof(ctx, "【录音】chunk清单已落库并生成逻辑分段: job_id=%d segment_index=%d storage_key=%s chunk_size=%d", jobID, req.SegmentIndex, storageKey, len(content))
	return segment, nil
}

func (s *RecordingChunkPipelineService) persistChunk(ctx context.Context, job *model.RecordingJob, req *UploadRecordingSegmentRequest) ([]byte, string, error) {
	file, err := req.FileHeader.Open()
	if err != nil {
		return nil, "", err
	}
	defer file.Close()

	content, err := io.ReadAll(file)
	if err != nil {
		return nil, "", err
	}

	chunk := &model.RecordingJobChunk{
		Eid:          s.eid,
		JobID:        job.ID,
		SegmentIndex: req.SegmentIndex,
		StorageKey:   fmt.Sprintf("%s_%d", model.BuildRecordingChunkLocalStorageKey(s.eid, job.UserID, job.ID, req.SegmentIndex, req.FileHeader.Filename), time.Now().UTC().UnixNano()),
		Size:         int64(len(content)),
		DurationMs:   estimateRecordingSegmentRecordedMs(req.DurationMs, req.StartOffsetMs, req.EndOffsetMs),
		Status:       model.RecordingJobChunkStatusUploaded,
	}
	if err := model.CreateRecordingJobChunk(chunk); err != nil {
		return nil, "", err
	}

	if err := saveRecordingArtifact(chunk.StorageKey, content); err != nil {
		_ = model.DB.Where("job_id = ? AND segment_index = ? AND owner_instance = ? AND storage_key = ?", job.ID, req.SegmentIndex, config.GetRecordingInstanceID(), chunk.StorageKey).
			Delete(&model.RecordingJobChunk{}).Error
		return nil, "", err
	}

	return content, chunk.StorageKey, nil
}

func (s *RecordingChunkPipelineService) cleanupPersistedChunk(jobID int64, segmentIndex int64, storageKey string) error {
	_ = deleteRecordingArtifactIfExists(storageKey)
	return model.DB.Where("job_id = ? AND segment_index = ? AND owner_instance = ? AND storage_key = ?", jobID, segmentIndex, config.GetRecordingInstanceID(), storageKey).
		Delete(&model.RecordingJobChunk{}).Error
}

func (s *RecordingChunkPipelineService) markChunkFailed(jobID int64, segmentIndex int64, storageKey string, cause error) error {
	if cause == nil {
		return nil
	}
	fields := map[string]interface{}{
		"status": model.RecordingJobChunkStatusFailed,
		"error":  cause.Error(),
	}
	result := model.DB.Model(&model.RecordingJobChunk{}).
		Where("job_id = ? AND segment_index = ? AND owner_instance = ? AND storage_key = ?", jobID, segmentIndex, config.GetRecordingInstanceID(), storageKey).
		Updates(fields)
	return result.Error
}

func buildRecordingChunkStorageKey(eid, userID, jobID, segmentIndex int64, fileName string) string {
	fileName = strings.TrimSpace(fileName)
	if fileName == "" {
		fileName = fmt.Sprintf("segment-%d.chunk", segmentIndex)
	}
	ext := strings.TrimSpace(filepath.Ext(fileName))
	if ext == "" {
		ext = ".chunk"
	}
	sum := sha256.Sum256([]byte(fileName))
	shortHash := hex.EncodeToString(sum[:])[:12]
	return fmt.Sprintf("recordings/%d/%d/%d/chunks/%d_%s%s", eid, userID, jobID, segmentIndex, shortHash, ext)
}
