package service

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

const recordingChunkCleanupInterval = 30 * time.Minute

type recordingChunkCleanupManager struct {
	flushInterval time.Duration
	startOnce     sync.Once
}

var (
	recordingChunkCleanupOnce sync.Once
	recordingChunkCleanupMgr  *recordingChunkCleanupManager
	recordingChunkRetainSecs  = config.RECORDING_CHUNK_RETAIN_SECONDS
)

func SetRecordingChunkRetainSecondsForTest(retainSeconds int) func() {
	previous := recordingChunkRetainSecs
	if retainSeconds > 0 {
		recordingChunkRetainSecs = retainSeconds
	}
	return func() {
		recordingChunkRetainSecs = previous
	}
}

func NewRecordingChunkCleanupManager() *recordingChunkCleanupManager {
	return getRecordingChunkCleanupManager()
}

func getRecordingChunkCleanupManager() *recordingChunkCleanupManager {
	recordingChunkCleanupOnce.Do(func() {
		recordingChunkCleanupMgr = &recordingChunkCleanupManager{
			flushInterval: recordingChunkCleanupInterval,
		}
	})
	return recordingChunkCleanupMgr
}

func StartRecordingChunkCleanupWorker(ctx context.Context) {
	getRecordingChunkCleanupManager().start(ctx)
}

func (m *recordingChunkCleanupManager) start(ctx context.Context) {
	if m == nil {
		return
	}
	m.startOnce.Do(func() {
		if m.flushInterval <= 0 {
			m.flushInterval = recordingChunkCleanupInterval
		}
		if err := m.processPending(ctx); err != nil {
			logger.SysWarnf("【录音】启动时清理录音 chunk 失败: err=%v", err)
		}
		go m.run(ctx)
	})
}

func (m *recordingChunkCleanupManager) run(ctx context.Context) {
	if ctx == nil {
		ctx = context.Background()
	}
	ticker := time.NewTicker(m.flushInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := m.processPending(ctx); err != nil {
				logger.SysWarnf("【录音】清理录音 chunk 失败: err=%v", err)
			}
		}
	}
}

func (m *recordingChunkCleanupManager) ProcessOnce(ctx context.Context) error {
	return m.processPending(ctx)
}

func (m *recordingChunkCleanupManager) processPending(ctx context.Context) error {
	if m == nil {
		return nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if recordingChunkRetainSecs <= 0 {
		return nil
	}

	cutoff := time.Now().UTC().Add(-time.Duration(recordingChunkRetainSecs) * time.Second).UnixMilli()
	var jobs []model.RecordingJob
	if err := model.DB.Where("owner_instance = ? AND status IN ? AND ended_at > 0 AND ended_at <= ?", config.GetRecordingInstanceID(), []string{
		model.RecordingJobStatusCompleted,
		model.RecordingJobStatusFailed,
		model.RecordingJobStatusStopped,
	}, cutoff).Order("id asc").Find(&jobs).Error; err != nil {
		return err
	}

	lockSvc := NewRecordingLockService()
	for i := range jobs {
		jobID := jobs[i].ID

		if !lockSvc.TryLockCleanup(jobID) {
			logger.Infof(ctx, "【录音】清理任务已被其他实例处理，跳过: job_id=%d", jobID)
			continue
		}

		err := m.cleanupJob(ctx, &jobs[i])
		lockSvc.UnlockCleanup(jobID)

		if err != nil {
			logger.SysWarnf("【录音】清理录音 chunk 失败: job_id=%d err=%v", jobID, err)
		}
	}
	return nil
}

func (m *recordingChunkCleanupManager) cleanupJob(ctx context.Context, job *model.RecordingJob) error {
	if job == nil {
		return nil
	}
	_ = ctx

	chunks, err := model.GetRecordingJobChunksByJobID(job.ID)
	if err != nil {
		return err
	}
	segments, err := model.GetRecordingJobSegments(job.ID)
	if err != nil {
		return err
	}
	assembly, err := model.GetRecordingJobAssemblyByJobID(job.ID)
	if err != nil && !strings.Contains(strings.ToLower(err.Error()), "record not found") {
		return err
	}

	for i := range chunks {
		if err := deleteStorageObjectIfExists(chunks[i].StorageKey); err != nil {
			return err
		}
	}
	for i := range segments {
		if err := deleteStorageObjectIfExists(segments[i].StorageKey); err != nil {
			return err
		}
		if err := deleteStorageObjectIfExists(segments[i].TranscodedStorageKey); err != nil {
			return err
		}
	}
	if assembly != nil && strings.TrimSpace(assembly.BufferKey) != "" {
		if err := deleteStorageObjectIfExists(assembly.BufferKey); err != nil {
			return err
		}
	}
	ownerInstance := strings.TrimSpace(job.OwnerInstance)
	if ownerInstance == "" {
		ownerInstance = config.GetRecordingInstanceID()
	}

	if err := model.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("job_id = ? AND owner_instance = ?", job.ID, ownerInstance).Delete(&model.RecordingJobChunk{}).Error; err != nil {
			return err
		}
		if err := tx.Where("job_id = ? AND owner_instance = ?", job.ID, ownerInstance).Delete(&model.RecordingJobSegment{}).Error; err != nil {
			return err
		}
		if err := tx.Where("job_id = ? AND owner_instance = ?", job.ID, ownerInstance).Delete(&model.RecordingJobAssembly{}).Error; err != nil {
			return err
		}
		return nil
	}); err != nil {
		return err
	}

	svc := NewRecordingService(job.Eid)
	svc.cleanupRecordingLocalArtifacts(job)
	return nil
}

func deleteStorageObjectIfExists(key string) error {
	key = strings.TrimSpace(key)
	if key == "" {
		return nil
	}
	if err := deleteRecordingArtifactIfExists(key); err != nil {
		return fmt.Errorf("删除录音对象失败: key=%s err=%w", key, err)
	}
	return nil
}
