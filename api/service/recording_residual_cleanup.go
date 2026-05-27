package service

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

const (
	recordingResidualCleanupInterval     = 30 * time.Minute
	recordingResidualCleanupRetainPeriod = 7 * 24 * time.Hour
	recordingResidualCleanupBatchSize    = 100
)

type recordingResidualCleanupManager struct {
	flushInterval time.Duration
	startOnce     sync.Once
}

func newRecordingResidualCleanupManager() *recordingResidualCleanupManager {
	return &recordingResidualCleanupManager{
		flushInterval: recordingResidualCleanupInterval,
	}
}

func StartRecordingResidualCleanupWorker(ctx context.Context) {
	manager := newRecordingResidualCleanupManager()
	manager.start(ctx)
}

func (m *recordingResidualCleanupManager) start(ctx context.Context) {
	if m == nil {
		return
	}
	m.startOnce.Do(func() {
		if m.flushInterval <= 0 {
			m.flushInterval = recordingResidualCleanupInterval
		}
		if err := m.processPending(ctx); err != nil {
			logger.SysWarnf("【录音】启动时清理录音残留失败: err=%v", err)
		}
		go m.run(ctx)
	})
}

func (m *recordingResidualCleanupManager) run(ctx context.Context) {
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
				logger.SysWarnf("【录音】清理录音残留失败: err=%v", err)
			}
		}
	}
}

func (m *recordingResidualCleanupManager) ProcessOnce(ctx context.Context) error {
	return m.processPending(ctx)
}

func (m *recordingResidualCleanupManager) processPending(ctx context.Context) error {
	if m == nil {
		return nil
	}
	if ctx == nil {
		ctx = context.Background()
	}

	cutoff := time.Now().UTC().Add(-recordingResidualCleanupRetainPeriod)
	if err := m.cleanupRecordingTaskResidues(ctx, cutoff); err != nil {
		return err
	}

	var errs []error
	if err := m.cleanupOrphanRecordingDirs(cutoff); err != nil {
		errs = append(errs, err)
	}
	if err := m.cleanupOrphanRecordingAssemblySpoolDirs(cutoff); err != nil {
		errs = append(errs, err)
	}
	if err := m.cleanupStaleChunkUploadTempDirs(cutoff); err != nil {
		errs = append(errs, err)
	}

	if len(errs) > 0 {
		return errors.Join(errs...)
	}
	return nil
}

func (m *recordingResidualCleanupManager) cleanupRecordingTaskResidues(ctx context.Context, cutoff time.Time) error {
	query := model.DB.Where("owner_instance = ? AND status IN ? AND ended_at > 0 AND ended_at <= ?", config.GetRecordingInstanceID(), []string{
		model.RecordingJobStatusFailed,
		model.RecordingJobStatusStopped,
	}, cutoff.UnixMilli())

	chunkCleanupMgr := NewRecordingChunkCleanupManager()
	lockSvc := NewRecordingLockService()
	lastID := int64(0)
	for {
		var jobs []model.RecordingJob
		if err := query.Where("id > ?", lastID).Order("id asc").Limit(recordingResidualCleanupBatchSize).Find(&jobs).Error; err != nil {
			return err
		}
		if len(jobs) == 0 {
			return nil
		}

		for i := range jobs {
			job := &jobs[i]
			if job == nil {
				continue
			}
			if job.ID > lastID {
				lastID = job.ID
			}
			if !recordingResidualCleanupNeedsTask(job, cutoff) {
				continue
			}
			if !lockSvc.TryLockCleanup(job.ID) {
				logger.Infof(ctx, "【录音】残留清理任务已被其他实例处理，跳过: job_id=%d", job.ID)
				continue
			}

			func() {
				defer lockSvc.UnlockCleanup(job.ID)

				if err := chunkCleanupMgr.cleanupJob(ctx, job); err != nil {
					logger.SysWarnf("【录音】清理录音任务数据失败: job_id=%d err=%v", job.ID, err)
					return
				}
				cleanupRecordingTaskArtifacts(job)
			}()
		}

		if len(jobs) < recordingResidualCleanupBatchSize {
			return nil
		}
	}
}

func (m *recordingResidualCleanupManager) cleanupOrphanRecordingDirs(cutoff time.Time) error {
	root := strings.TrimSpace(config.RecordingLocalRoot())
	if root == "" {
		return nil
	}

	candidates := make([]string, 0, 32)
	if err := filepath.WalkDir(root, func(path string, d os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if d == nil || !d.IsDir() {
			return nil
		}
		if filepath.Clean(path) == filepath.Clean(root) {
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil || rel == "." || rel == "" {
			return nil
		}
		parts := strings.Split(filepath.ToSlash(rel), "/")
		if len(parts) == 4 || (len(parts) == 3 && parts[1] == "finalize") {
			candidates = append(candidates, path)
		}
		return nil
	}); err != nil {
		return err
	}

	for _, candidate := range candidates {
		info, err := os.Stat(candidate)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return err
		}
		if !info.IsDir() {
			continue
		}
		if !info.ModTime().Before(cutoff) {
			continue
		}

		instanceID, jobID, ok := parseRecordingResidualCleanupCandidate(root, candidate)
		if !ok {
			continue
		}
		exists, err := recordingJobExistsForInstance(jobID, instanceID)
		if err != nil {
			return err
		}
		if exists {
			continue
		}
		if err := os.RemoveAll(candidate); err != nil && !os.IsNotExist(err) {
			logger.SysWarnf("【录音】清理录音孤儿目录失败: path=%s err=%v", candidate, err)
		}
	}
	return nil
}

func (m *recordingResidualCleanupManager) cleanupStaleChunkUploadTempDirs(cutoff time.Time) error {
	root := strings.TrimSpace(config.ChunkUploadTempDir())
	if root == "" {
		return nil
	}

	entries, err := os.ReadDir(root)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}

	for _, entry := range entries {
		if entry == nil || !entry.IsDir() {
			continue
		}
		fileID := strings.TrimSpace(entry.Name())
		if fileID == "" {
			continue
		}
		path := filepath.Join(root, entry.Name())
		info, err := os.Stat(path)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return err
		}
		if !info.ModTime().Before(cutoff) {
			continue
		}
		if err := os.RemoveAll(path); err != nil && !os.IsNotExist(err) {
			logger.SysWarnf("【录音】清理 chunk-upload 临时目录失败: path=%s err=%v", path, err)
		}
	}
	return nil
}

func recordingResidualCleanupNeedsTask(job *model.RecordingJob, cutoff time.Time) bool {
	if job == nil || job.EndedAt <= 0 {
		return false
	}

	switch job.Status {
	case model.RecordingJobStatusFailed, model.RecordingJobStatusStopped:
		return !time.UnixMilli(job.EndedAt).After(cutoff)
	default:
		return false
	}
}

func (m *recordingResidualCleanupManager) cleanupOrphanRecordingAssemblySpoolDirs(cutoff time.Time) error {
	root := strings.TrimSpace(config.RecordingAssemblySpoolRoot())
	if root == "" {
		return nil
	}

	eidEntries, err := os.ReadDir(root)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}

	for _, eidEntry := range eidEntries {
		if eidEntry == nil || !eidEntry.IsDir() {
			continue
		}
		eid := strings.TrimSpace(eidEntry.Name())
		if eid == "" {
			continue
		}
		eidID, err := strconv.ParseInt(eid, 10, 64)
		if err != nil {
			continue
		}

		eidPath := filepath.Join(root, eid)
		jobEntries, err := os.ReadDir(eidPath)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return err
		}

		for _, jobEntry := range jobEntries {
			if jobEntry == nil || !jobEntry.IsDir() {
				continue
			}
			jobIDText := strings.TrimSpace(jobEntry.Name())
			if jobIDText == "" {
				continue
			}
			jobID, err := strconv.ParseInt(jobIDText, 10, 64)
			if err != nil {
				continue
			}

			jobPath := filepath.Join(eidPath, jobIDText)
			info, err := os.Stat(jobPath)
			if err != nil {
				if os.IsNotExist(err) {
					continue
				}
				return err
			}
			if !info.IsDir() || !info.ModTime().Before(cutoff) {
				continue
			}

			exists, err := recordingJobExistsForInstance(jobID, config.GetRecordingInstanceID())
			if err != nil {
				return err
			}
			if exists {
				continue
			}
			if err := deleteRecordingAssemblyJobSpoolDir(root, eidID, jobID); err != nil && !os.IsNotExist(err) {
				logger.SysWarnf("【录音】清理录音孤儿 spool 目录失败: path=%s err=%v", jobPath, err)
			}
		}
	}
	return nil
}

func parseRecordingResidualCleanupCandidate(root, candidate string) (string, int64, bool) {
	rel, err := filepath.Rel(root, candidate)
	if err != nil || rel == "." || rel == "" {
		return "", 0, false
	}
	parts := strings.Split(filepath.ToSlash(rel), "/")
	switch {
	case len(parts) == 4:
		jobID, err := strconv.ParseInt(parts[3], 10, 64)
		if err != nil {
			return "", 0, false
		}
		return parts[0], jobID, true
	case len(parts) == 3 && parts[1] == "finalize":
		jobID, err := strconv.ParseInt(parts[2], 10, 64)
		if err != nil {
			return "", 0, false
		}
		return parts[0], jobID, true
	default:
		return "", 0, false
	}
}

func recordingJobExistsForInstance(jobID int64, instanceID string) (bool, error) {
	instanceID = strings.TrimSpace(instanceID)
	if instanceID == "" || jobID <= 0 {
		return false, nil
	}

	var job model.RecordingJob
	if err := model.DB.Where("id = ? AND owner_instance = ?", jobID, instanceID).First(&job).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}
