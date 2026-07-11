package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
)

func (s *RecordingAssemblyService) ensureRecordingAssemblyActive(assembly *model.RecordingJobAssembly, bufferKey string) error {
	if assembly == nil {
		return nil
	}
	updates := recordingAssemblyBufferKeyUpdates(bufferKey)
	if strings.TrimSpace(assembly.BufferKey) != "" {
		delete(updates, "buffer_key")
	}
	if assembly.Status == model.RecordingJobAssemblyStatusFlushing {
		updates["status"] = model.RecordingJobAssemblyStatusActive
	}
	if len(updates) == 0 {
		return nil
	}
	if err := model.UpdateRecordingJobAssembly(assembly, updates); err != nil {
		return err
	}
	if strings.TrimSpace(bufferKey) != "" && strings.TrimSpace(assembly.BufferKey) == "" {
		assembly.BufferKey = bufferKey
	}
	if assembly.Status == model.RecordingJobAssemblyStatusFlushing {
		assembly.Status = model.RecordingJobAssemblyStatusActive
	}
	return nil
}

func (s *RecordingAssemblyService) prepareAssemblyBuffer(ctx context.Context, job *model.RecordingJob, assembly *model.RecordingJobAssembly) error {
	if job == nil || assembly == nil {
		return nil
	}

	bufferKey := strings.TrimSpace(assembly.BufferKey)
	if bufferKey == "" {
		bufferKey = s.buildAssemblyBufferKey(job.ID, assembly.SegmentIndex)
	}

	if recordingArtifactExists(bufferKey) {
		if err := s.ensureRecordingAssemblyActive(assembly, bufferKey); err != nil {
			return err
		}
		_ = model.UpdateRecordingJob(job, recordingJobRecoveryReadyUpdates(time.Now().UTC().UnixMilli()))
		return nil
	}

	if err := s.rebuildAssemblyBufferFromChunks(ctx, job, assembly, bufferKey); err != nil {
		return err
	}

	if !recordingArtifactExists(bufferKey) {
		return ErrRecordingAssemblyBufferMissing
	}

	if err := s.ensureRecordingAssemblyActive(assembly, bufferKey); err != nil {
		return err
	}
	_ = model.UpdateRecordingJob(job, recordingJobRecoveryReadyUpdates(time.Now().UTC().UnixMilli()))
	return nil
}

func (s *RecordingAssemblyService) rebuildAssemblyBufferFromChunks(ctx context.Context, job *model.RecordingJob, assembly *model.RecordingJobAssembly, bufferKey string) error {
	if job == nil || assembly == nil {
		return nil
	}
	chunks, err := model.GetRecordingJobChunksByJobID(job.ID)
	if err != nil {
		return err
	}
	if len(chunks) == 0 {
		return ErrRecordingAssemblyBufferMissing
	}

	var (
		buffer         bytes.Buffer
		lastInputIndex int64 = -1
		lastInputHash  string
		totalDuration  int64
	)
	for i := range chunks {
		chunk := chunks[i]
		if strings.TrimSpace(chunk.StorageKey) == "" {
			return ErrRecordingAssemblyBufferMissing
		}
		content, loadErr := loadRecordingArtifact(chunk.StorageKey)
		if loadErr != nil {
			return fmt.Errorf("%w: segment_index=%d err=%v", ErrRecordingAssemblyBufferMissing, chunk.SegmentIndex, loadErr)
		}
		if _, err := buffer.Write(content); err != nil {
			return err
		}
		totalDuration += chunk.DurationMs
		lastInputIndex = chunk.SegmentIndex
		hash := sha256.Sum256(content)
		lastInputHash = hex.EncodeToString(hash[:])
	}

	if err := ensureRecordingDirectory(filepath.Dir(bufferKey), recordingLocalDirMode, false); err != nil {
		return err
	}
	if err := ensureRecordingWritableFile(bufferKey, recordingAssemblySpoolFileMode); err != nil {
		return err
	}
	if err := os.WriteFile(bufferKey, buffer.Bytes(), 0o644); err != nil {
		return err
	}
	if err := ensureRecordingFileMode(bufferKey, recordingAssemblySpoolFileMode); err != nil {
		return err
	}

	updates := recordingAssemblyBufferedUpdates(bufferKey, int64(buffer.Len()), totalDuration, lastInputIndex, lastInputHash)
	if err := model.UpdateRecordingJobAssembly(assembly, updates); err != nil {
		return err
	}
	assembly.BufferKey = bufferKey
	assembly.BufferSize = int64(buffer.Len())
	assembly.BufferDurationMs = totalDuration
	assembly.LastInputIndex = lastInputIndex
	assembly.LastInputHash = lastInputHash
	assembly.Status = model.RecordingJobAssemblyStatusActive

	logger.Infof(ctx, "【录音】聚合缓冲已从 chunk 重建: job_id=%d buffer_key=%s chunk_count=%d", job.ID, bufferKey, len(chunks))
	return nil
}

func (s *RecordingAssemblyService) appendToBuffer(bufferKey string, content []byte) error {
	if bufferKey == "" {
		return errors.New("buffer key is required")
	}
	if err := ensureRecordingDirectory(filepath.Dir(bufferKey), recordingLocalDirMode, false); err != nil {
		return err
	}
	if err := ensureRecordingWritableFile(bufferKey, recordingAssemblySpoolFileMode); err != nil {
		return err
	}
	f, err := os.OpenFile(bufferKey, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = f.Write(content)
	if err != nil {
		return err
	}
	return ensureRecordingFileMode(bufferKey, recordingAssemblySpoolFileMode)
}

func (s *RecordingAssemblyService) restoreAssemblyBuffer(bufferKey string, existed bool, content []byte) error {
	_ = s
	bufferKey = strings.TrimSpace(bufferKey)
	if bufferKey == "" {
		return nil
	}

	if existed {
		if err := ensureRecordingWritableFile(bufferKey, recordingAssemblySpoolFileMode); err != nil {
			return err
		}
		if err := os.WriteFile(bufferKey, content, 0o644); err != nil {
			return err
		}
		return ensureRecordingFileMode(bufferKey, recordingAssemblySpoolFileMode)
	}
	if err := os.Remove(bufferKey); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func (s *RecordingAssemblyService) restoreRecordingAssemblyAfterAppendFailure(
	assembly *model.RecordingJobAssembly,
	snapshot *model.RecordingJobAssembly,
	bufferKey string,
	existed bool,
	content []byte,
) error {
	if assembly == nil || snapshot == nil {
		return nil
	}
	if err := s.restoreAssemblyBuffer(bufferKey, existed, content); err != nil {
		return err
	}

	if err := model.UpdateRecordingJobAssembly(assembly, recordingAssemblyRestoreSnapshotUpdates(snapshot)); err != nil {
		return err
	}
	assembly.BufferKey = bufferKey
	assembly.BufferSize = snapshot.BufferSize
	assembly.BufferDurationMs = snapshot.BufferDurationMs
	assembly.LastInputIndex = snapshot.LastInputIndex
	assembly.LastInputHash = snapshot.LastInputHash
	assembly.Status = snapshot.Status
	return nil
}

func (s *RecordingAssemblyService) hasPendingAssemblyBuffer(job *model.RecordingJob, assembly *model.RecordingJobAssembly) (bool, string, error) {
	if job == nil || assembly == nil {
		return false, "", nil
	}
	if !assembly.CanRecover() && !assembly.CanAppend() && !assembly.CanEnterFlushing() {
		return false, "", nil
	}

	bufferKey := strings.TrimSpace(assembly.BufferKey)
	if bufferKey == "" {
		bufferKey = s.buildAssemblyBufferKey(job.ID, assembly.SegmentIndex)
	}

	if recordingArtifactExists(bufferKey) {
		return false, bufferKey, nil
	}
	if assembly.BufferSize <= 0 && assembly.LastInputIndex < 0 && assembly.Status != model.RecordingJobAssemblyStatusFlushing {
		return false, bufferKey, nil
	}
	return true, bufferKey, nil
}

func (s *RecordingAssemblyService) ensureAssemblyRecoverable(ctx context.Context, job *model.RecordingJob, assembly *model.RecordingJobAssembly) error {
	if assembly == nil {
		return nil
	}
	if !assembly.CanRecover() {
		return nil
	}
	if assembly.BufferSize <= 0 && assembly.LastInputIndex < 0 && assembly.Status != model.RecordingJobAssemblyStatusFlushing {
		return nil
	}

	if err := s.prepareAssemblyBuffer(ctx, job, assembly); err != nil {
		if errors.Is(err, ErrRecordingAssemblyBufferMissing) {
			bufferKey := strings.TrimSpace(assembly.BufferKey)
			if bufferKey == "" {
				bufferKey = s.buildAssemblyBufferKey(job.ID, assembly.SegmentIndex)
			}
			logger.SysWarnf("【录音】本地聚合缓冲缺失，跳过恢复准备: job_id=%d buffer_key=%s status=%s", job.ID, bufferKey, assembly.Status)
		}
		return err
	}

	return nil
}
