package model

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/storage"
)

const (
	sandboxOutputFileCleanupInterval   = 10 * time.Second
	sandboxOutputFileCleanupBatchSize  = 20
	sandboxOutputFileCleanupMaxRetries = 3
)

type sandboxOutputFileCleanupManager struct {
	flushInterval time.Duration
	maxBatchSize  int
	maxRetries    int64
	startOnce     sync.Once
}

var (
	sandboxOutputFileCleanupOnce sync.Once
	sandboxOutputFileCleanupMgr  *sandboxOutputFileCleanupManager
)

func getAIUploadFileCleanupManager() *sandboxOutputFileCleanupManager {
	sandboxOutputFileCleanupOnce.Do(func() {
		sandboxOutputFileCleanupMgr = &sandboxOutputFileCleanupManager{
			flushInterval: sandboxOutputFileCleanupInterval,
			maxBatchSize:  sandboxOutputFileCleanupBatchSize,
			maxRetries:    sandboxOutputFileCleanupMaxRetries,
		}
	})
	return sandboxOutputFileCleanupMgr
}

// StartAIUploadFileCleanupWorker 启动 AI 上传文件清理 worker。
// 调用方应在应用启动时传入可取消的上下文；worker 会先执行一次全量清理扫表，再进入定时轮询。
func StartAIUploadFileCleanupWorker(ctx context.Context) {
	getAIUploadFileCleanupManager().start(ctx)
}

func (m *sandboxOutputFileCleanupManager) start(ctx context.Context) {
	if m == nil {
		return
	}
	m.startOnce.Do(func() {
		if m.flushInterval <= 0 {
			m.flushInterval = sandboxOutputFileCleanupInterval
		}
		if m.maxBatchSize <= 0 {
			m.maxBatchSize = sandboxOutputFileCleanupBatchSize
		}
		if m.maxRetries <= 0 {
			m.maxRetries = sandboxOutputFileCleanupMaxRetries
		}
		go m.run(ctx)
	})
}

func (m *sandboxOutputFileCleanupManager) run(ctx context.Context) {
	if ctx == nil {
		ctx = context.Background()
	}

	if err := m.processPending(ctx); err != nil {
		logger.SysWarnf("【沙盒】启动时清理失败文件失败: err=%v", err)
	}

	ticker := time.NewTicker(m.flushInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := m.processPending(ctx); err != nil {
				logger.SysWarnf("【沙盒】清理失败文件批次执行失败: err=%v", err)
			}
		}
	}
}

func (m *sandboxOutputFileCleanupManager) processPending(ctx context.Context) error {
	if m == nil {
		return nil
	}
	if ctx == nil {
		ctx = context.Background()
	}

	afterID := int64(0)
	for {
		cleanupFiles, err := GetAIUploadFilesCleanupBatch(afterID, m.maxBatchSize, m.maxRetries)
		if err != nil {
			return fmt.Errorf("查询待清理 AI 上传文件失败: %w", err)
		}
		if len(cleanupFiles) == 0 {
			return nil
		}

		for _, cleanupFile := range cleanupFiles {
			if cleanupFile == nil || cleanupFile.ID <= 0 {
				continue
			}
			if err := m.processSingle(ctx, cleanupFile); err != nil {
				logger.SysWarnf("【沙盒】清理失败文件重试失败: upload_file_id=%d key=%s retry_count=%d err=%v",
					cleanupFile.ID, cleanupFile.Key, cleanupFile.CleanupRetryCount, err)
			}
			afterID = cleanupFile.ID
		}

		if len(cleanupFiles) < m.maxBatchSize {
			return nil
		}
	}
}

func (m *sandboxOutputFileCleanupManager) processSingle(_ context.Context, cleanupFile *UploadFile) error {
	if cleanupFile == nil || cleanupFile.ID <= 0 {
		return nil
	}

	key := strings.TrimSpace(cleanupFile.Key)
	if key == "" {
		return DeleteAIUploadFileByID(cleanupFile.ID)
	}

	exists, err := sandboxOutputFileObjectExists(key)
	if err != nil {
		if markErr := MarkAIUploadFileCleanupFailed(cleanupFile.ID); markErr != nil {
			return fmt.Errorf("标记 AI 上传文件清理失败失败: %v (原始错误: %w)", markErr, err)
		}
		return err
	}

	if exists {
		if err := storage.StorageInstance.Delete(key); err != nil {
			stillExists, existsErr := sandboxOutputFileObjectExists(key)
			if existsErr != nil {
				if markErr := MarkAIUploadFileCleanupFailed(cleanupFile.ID); markErr != nil {
					return fmt.Errorf("标记 AI 上传文件清理失败失败: %v (原始错误: %w)", markErr, err)
				}
				return err
			}
			if stillExists {
				if markErr := MarkAIUploadFileCleanupFailed(cleanupFile.ID); markErr != nil {
					return fmt.Errorf("标记 AI 上传文件清理失败失败: %v (原始错误: %w)", markErr, err)
				}
				return err
			}
		}
	}

	if err := DeleteAIUploadFileByID(cleanupFile.ID); err != nil {
		if markErr := MarkAIUploadFileCleanupFailed(cleanupFile.ID); markErr != nil {
			return fmt.Errorf("标记 AI 上传文件清理失败失败: %v (原始错误: %w)", markErr, err)
		}
		return err
	}
	return nil
}

func sandboxOutputFileObjectExists(key string) (bool, error) {
	key = strings.TrimSpace(key)
	if key == "" {
		return false, nil
	}

	switch s := storage.StorageInstance.(type) {
	case *storage.LocalStorage:
		return s.Exists(key), nil
	case *storage.AliyunOSSStorage:
		return s.GetBucket().IsObjectExist(filepath.ToSlash(key))
	default:
		return storage.StorageInstance.Exists(key), nil
	}
}
