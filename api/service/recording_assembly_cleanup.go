package service

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
)

const (
	recordingAssemblySpoolCleanupInterval = 10 * time.Minute
	recordingAssemblySpoolCleanupRootName = "53aihub-recording-assembly"
)

type recordingAssemblySpoolCleanupManager struct {
	flushInterval time.Duration
	rootDirFunc   func() string
	startOnce     sync.Once
}

var (
	recordingAssemblySpoolCleanupOnce sync.Once
	recordingAssemblySpoolCleanupMgr  *recordingAssemblySpoolCleanupManager
)

func SetRecordingAssemblySpoolCleanupConfigForTest(rootDir string, interval time.Duration) func() {
	mgr := getRecordingAssemblySpoolCleanupManager()
	origRootDirFunc := mgr.rootDirFunc
	origFlushInterval := mgr.flushInterval
	if strings.TrimSpace(rootDir) != "" {
		mgr.rootDirFunc = func() string { return rootDir }
	}
	if interval > 0 {
		mgr.flushInterval = interval
	}
	return func() {
		mgr.rootDirFunc = origRootDirFunc
		mgr.flushInterval = origFlushInterval
	}
}

func getRecordingAssemblySpoolCleanupManager() *recordingAssemblySpoolCleanupManager {
	recordingAssemblySpoolCleanupOnce.Do(func() {
		recordingAssemblySpoolCleanupMgr = &recordingAssemblySpoolCleanupManager{
			flushInterval: recordingAssemblySpoolCleanupInterval,
			rootDirFunc:   recordingAssemblySpoolCleanupRootDir,
		}
	})
	return recordingAssemblySpoolCleanupMgr
}

// StartRecordingAssemblySpoolCleanupWorker 启动录音聚合临时文件清理 worker。
// 仅清理无对应聚合任务、或与当前聚合状态不匹配的遗留 spool 文件，不影响正在使用的缓冲文件。
func StartRecordingAssemblySpoolCleanupWorker(ctx context.Context) {
	getRecordingAssemblySpoolCleanupManager().start(ctx)
}

func (m *recordingAssemblySpoolCleanupManager) start(ctx context.Context) {
	if m == nil {
		return
	}
	m.startOnce.Do(func() {
		if m.flushInterval <= 0 {
			m.flushInterval = recordingAssemblySpoolCleanupInterval
		}
		if m.rootDirFunc == nil {
			m.rootDirFunc = recordingAssemblySpoolCleanupRootDir
		}
		if err := m.processPending(ctx); err != nil {
			logger.SysWarnf("【录音】启动时清理聚合临时文件失败: err=%v", err)
		}
		go m.run(ctx)
	})
}

func (m *recordingAssemblySpoolCleanupManager) run(ctx context.Context) {
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
				logger.SysWarnf("【录音】清理聚合临时文件批次执行失败: err=%v", err)
			}
		}
	}
}

func (m *recordingAssemblySpoolCleanupManager) processPending(ctx context.Context) error {
	if m == nil {
		return nil
	}
	if ctx == nil {
		ctx = context.Background()
	}

	root := strings.TrimSpace(m.rootDirFunc())
	if root == "" {
		return nil
	}

	entries := make([]string, 0, 8)
	if err := filepath.WalkDir(root, func(path string, d os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if d == nil || d.IsDir() {
			return nil
		}
		if strings.HasSuffix(strings.ToLower(d.Name()), ".spool") {
			entries = append(entries, path)
		}
		return nil
	}); err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("遍历录音聚合临时目录失败: %w", err)
	}

	for _, spoolPath := range entries {
		if err := m.processSingle(ctx, root, spoolPath); err != nil {
			logger.SysWarnf("【录音】清理聚合临时文件失败: path=%s err=%v", spoolPath, err)
		}
	}
	protectedDirs, err := m.listProtectedDirs(root, time.Now().UTC())
	if err != nil {
		logger.SysWarnf("【录音】加载受保护的聚合目录失败: err=%v", err)
		protectedDirs = nil
	}
	if err := m.removeEmptyDirs(root, protectedDirs); err != nil {
		logger.SysWarnf("【录音】清理聚合空目录失败: err=%v", err)
	}
	return nil
}

func (m *recordingAssemblySpoolCleanupManager) processSingle(ctx context.Context, root, spoolPath string) error {
	_ = ctx
	spoolPath = filepath.Clean(spoolPath)
	root = filepath.Clean(root)
	if spoolPath == "" || root == "" {
		return nil
	}

	eid, jobID, segmentIndex, ok := parseRecordingAssemblySpoolPath(root, spoolPath)
	if !ok {
		return nil
	}

	job, err := model.GetRecordingJobByID(eid, jobID)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "record not found") {
			return deleteRecordingAssemblySpoolFile(spoolPath)
		}
		return err
	}
	if job == nil {
		return deleteRecordingAssemblySpoolFile(spoolPath)
	}

	switch strings.TrimSpace(job.Status) {
	case model.RecordingJobStatusCompleted:
		return deleteRecordingAssemblySpoolFile(spoolPath)
	case model.RecordingJobStatusFailed:
		// 任务失败后立即清理 spool 文件
		return deleteRecordingAssemblySpoolFile(spoolPath)
	case model.RecordingJobStatusRecording, model.RecordingJobStatusPaused, model.RecordingJobStatusFinalizing, model.RecordingJobStatusStopped, model.RecordingJobStatusInterrupted:
		// 继续沿用聚合器状态判断，避免误删仍在收口或可恢复的缓冲文件。
	default:
		return deleteRecordingAssemblySpoolFile(spoolPath)
	}
	keepRecoverableSpool := job.Status == model.RecordingJobStatusRecording ||
		job.Status == model.RecordingJobStatusPaused ||
		job.Status == model.RecordingJobStatusFinalizing ||
		job.Status == model.RecordingJobStatusStopped ||
		job.Status == model.RecordingJobStatusInterrupted

	assembly, err := model.GetRecordingJobAssemblyByJobID(jobID)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "record not found") {
			if keepRecoverableSpool {
				return nil
			}
			return deleteRecordingAssemblySpoolFile(spoolPath)
		}
		return err
	}
	if assembly == nil {
		if keepRecoverableSpool {
			return nil
		}
		return deleteRecordingAssemblySpoolFile(spoolPath)
	}
	if !assembly.CanRecover() && !assembly.CanAppend() {
		if keepRecoverableSpool {
			return nil
		}
		return deleteRecordingAssemblySpoolFile(spoolPath)
	}
	if assembly.Eid != eid {
		if keepRecoverableSpool {
			return nil
		}
		return deleteRecordingAssemblySpoolFile(spoolPath)
	}

	expectedKey := strings.TrimSpace(assembly.BufferKey)
	if expectedKey == "" {
		expectedKey = recordingAssemblyBufferKeyFromParts(eid, jobID, segmentIndex)
	}
	if expectedKey == "" {
		if keepRecoverableSpool {
			return nil
		}
		return deleteRecordingAssemblySpoolFile(spoolPath)
	}

	if filepath.Clean(expectedKey) != spoolPath {
		return deleteRecordingAssemblySpoolFile(spoolPath)
	}
	return nil
}

func (m *recordingAssemblySpoolCleanupManager) listProtectedDirs(root string, now time.Time) (map[string]struct{}, error) {
	root = filepath.Clean(strings.TrimSpace(root))
	if root == "" {
		return nil, nil
	}

	var jobs []model.RecordingJob
	if err := model.DB.Where("status IN ?", []string{
		model.RecordingJobStatusRecording,
		model.RecordingJobStatusPaused,
		model.RecordingJobStatusInterrupted,
		model.RecordingJobStatusFinalizing,
		model.RecordingJobStatusFailed,
	}).Find(&jobs).Error; err != nil {
		return nil, err
	}

	protected := make(map[string]struct{}, len(jobs))
	for _, job := range jobs {
		if !shouldProtectRecordingAssemblyDir(&job, now) {
			continue
		}
		dir := filepath.Join(root, fmt.Sprintf("%d", job.Eid), fmt.Sprintf("%d", job.ID))
		protected[filepath.Clean(dir)] = struct{}{}
	}
	return protected, nil
}

func shouldProtectRecordingAssemblyDir(job *model.RecordingJob, now time.Time) bool {
	if job == nil {
		return false
	}
	switch strings.TrimSpace(job.Status) {
	case model.RecordingJobStatusRecording, model.RecordingJobStatusPaused, model.RecordingJobStatusFinalizing, model.RecordingJobStatusInterrupted:
		return true
	case model.RecordingJobStatusFailed:
		// failed 状态立即清理，不再保护
		return false
	default:
		return false
	}
}

func (m *recordingAssemblySpoolCleanupManager) removeEmptyDirs(root string, protectedDirs map[string]struct{}) error {
	root = filepath.Clean(strings.TrimSpace(root))
	if root == "" {
		return nil
	}

	dirs := make([]string, 0, 32)
	if err := filepath.WalkDir(root, func(path string, d os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if d == nil || !d.IsDir() {
			return nil
		}
		if filepath.Clean(path) == root {
			return nil
		}
		dirs = append(dirs, filepath.Clean(path))
		return nil
	}); err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}

	sort.Slice(dirs, func(i, j int) bool {
		return len(dirs[i]) > len(dirs[j])
	})
	for _, dir := range dirs {
		if _, ok := protectedDirs[dir]; ok {
			continue
		}
		entries, err := os.ReadDir(dir)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return err
		}
		if len(entries) > 0 {
			continue
		}
		if err := os.Remove(dir); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	return nil
}

func deleteRecordingAssemblySpoolFile(spoolPath string) error {
	if strings.TrimSpace(spoolPath) == "" {
		return nil
	}
	if err := os.Remove(spoolPath); err != nil && !os.IsNotExist(err) {
		return err
	}
	pruneRecordingAssemblySpoolDirs(filepath.Dir(spoolPath))
	return nil
}

func deleteRecordingAssemblyJobSpoolDir(root string, eid int64, jobID int64) error {
	root = filepath.Clean(strings.TrimSpace(root))
	if root == "" {
		return nil
	}

	jobDir := filepath.Join(root, fmt.Sprintf("%d", eid), fmt.Sprintf("%d", jobID))
	if err := os.RemoveAll(jobDir); err != nil {
		return err
	}
	pruneRecordingAssemblySpoolDirs(filepath.Dir(jobDir))
	return nil
}

func pruneRecordingAssemblySpoolDirs(dir string) {
	if strings.TrimSpace(dir) == "" {
		return
	}
	root := filepath.Clean(recordingAssemblySpoolCleanupRootDir())
	current := filepath.Clean(dir)
	for current != "" && current != "." {
		if strings.EqualFold(current, root) {
			return
		}
		entries, err := os.ReadDir(current)
		if err != nil || len(entries) > 0 {
			return
		}
		if err := os.Remove(current); err != nil {
			return
		}
		current = filepath.Dir(current)
	}
}

func parseRecordingAssemblySpoolPath(root, spoolPath string) (int64, int64, int64, bool) {
	rel, err := filepath.Rel(root, spoolPath)
	if err != nil || rel == "." || rel == "" {
		return 0, 0, 0, false
	}
	parts := strings.Split(filepath.ToSlash(rel), "/")
	if len(parts) < 3 {
		return 0, 0, 0, false
	}
	eid, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		return 0, 0, 0, false
	}
	jobID, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil {
		return 0, 0, 0, false
	}
	segmentIndexStr := strings.TrimSuffix(parts[len(parts)-1], ".spool")
	if !strings.HasPrefix(segmentIndexStr, "segment-") {
		return 0, 0, 0, false
	}
	segmentIndex, err := strconv.ParseInt(strings.TrimPrefix(segmentIndexStr, "segment-"), 10, 64)
	if err != nil {
		return 0, 0, 0, false
	}
	return eid, jobID, segmentIndex, true
}

func recordingAssemblySpoolCleanupRootDir() string {
	root := strings.TrimSpace(config.RecordingAssemblySpoolRoot())
	if root == "" {
		root = filepath.Join(os.TempDir(), recordingAssemblySpoolCleanupRootName)
	}
	return root
}

func recordingAssemblyBufferKeyFromParts(eid int64, jobID int64, segmentIndex int64) string {
	return filepath.Join(
		recordingAssemblySpoolCleanupRootDir(),
		fmt.Sprintf("%d", eid),
		fmt.Sprintf("%d", jobID),
		fmt.Sprintf("segment-%d.spool", segmentIndex),
	)
}
