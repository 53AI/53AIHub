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
	"github.com/53AI/53AIHub/model"
)

const actionRuntimeCleanupBatchSize = 100

// StartActionRuntimeArtifactCleanupWorker removes only explicitly expired
// terminal-run files. Retention is disabled unless configured with a positive
// ACTION_RUNTIME_ARTIFACT_RETENTION_DAYS value.
func StartActionRuntimeArtifactCleanupWorker(ctx context.Context) {
	config := ActionRuntimeConfigFromEnv()
	if config.ArtifactRetentionDays <= 0 {
		logger.SysLog("Action Runtime Artifact 清理跳过: ACTION_RUNTIME_ARTIFACT_RETENTION_DAYS 未启用")
		return
	}
	interval := config.CleanupInterval
	if interval <= 0 {
		interval = time.Hour
	}
	if ctx == nil {
		ctx = context.Background()
	}
	go func() {
		process := func() {
			cutoff := time.Now().UTC().Add(-time.Duration(config.ArtifactRetentionDays) * 24 * time.Hour)
			count, err := CleanupExpiredActionArtifacts(ctx, config.ArtifactRoot, config.PreviewRoot, cutoff)
			if err != nil {
				logger.SysWarnf("Action Runtime Artifact 清理失败: err=%v", err)
				return
			}
			if count > 0 {
				logger.SysLogf("Action Runtime Artifact 清理完成: count=%d cutoff=%s", count, cutoff.Format(time.RFC3339))
			}
		}
		process()
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				process()
			}
		}
	}()
}

// CleanupExpiredActionArtifacts deletes expired files but keeps their Run and
// event records so status/replay history remains available after retention.
func CleanupExpiredActionArtifacts(ctx context.Context, artifactRoot, previewRoot string, cutoff time.Time) (int, error) {
	if model.DB == nil {
		return 0, errors.New("database connection is nil")
	}
	artifactRoot, err := cleanActionRuntimeRoot(artifactRoot)
	if err != nil {
		return 0, fmt.Errorf("invalid artifact root: %w", err)
	}
	previewRoot, err = cleanActionRuntimeRoot(previewRoot)
	if err != nil {
		return 0, fmt.Errorf("invalid preview root: %w", err)
	}
	removed := 0
	afterID := int64(0)
	for {
		artifacts, err := model.ListExpiredActionArtifacts(ctx, cutoff.UnixMilli(), afterID, actionRuntimeCleanupBatchSize)
		if err != nil {
			return removed, err
		}
		if len(artifacts) == 0 {
			return removed, nil
		}
		for _, artifact := range artifacts {
			if artifact == nil {
				continue
			}
			if artifact.ID > afterID {
				afterID = artifact.ID
			}
			if err := removeActionRuntimeFile(artifact.StoragePath, artifactRoot); err != nil {
				return removed, fmt.Errorf("remove artifact %s: %w", artifact.ArtifactID, err)
			}
			if err := removeActionRuntimeFile(artifact.PreviewPath, previewRoot); err != nil {
				return removed, fmt.Errorf("remove artifact preview %s: %w", artifact.ArtifactID, err)
			}
			if err := model.DeleteActionArtifact(ctx, artifact.Eid, artifact.ArtifactID); err != nil {
				return removed, err
			}
			removed++
		}
		if len(artifacts) < actionRuntimeCleanupBatchSize {
			return removed, nil
		}
	}
}

func cleanActionRuntimeRoot(root string) (string, error) {
	root = strings.TrimSpace(root)
	if root == "" {
		return "", errors.New("root is empty")
	}
	return filepath.Abs(root)
}

func removeActionRuntimeFile(path, root string) error {
	if strings.TrimSpace(path) == "" {
		return nil
	}
	path, err := filepath.Abs(path)
	if err != nil {
		return err
	}
	relative, err := filepath.Rel(root, path)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return fmt.Errorf("path is outside configured root")
	}
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("path is not a regular file")
	}
	return os.Remove(path)
}
