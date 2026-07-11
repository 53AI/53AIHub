package service

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/53AI/53AIHub/config"
)

const (
	recordingLocalDirMode          os.FileMode = 0o755
	recordingLocalArtifactMode     os.FileMode = 0o600
	recordingAssemblySpoolFileMode os.FileMode = 0o644
)

// InitRecordingStorageLayout checks and repairs the recording local storage
// directories before the recording workers start. It is safe to call multiple times.
func InitRecordingStorageLayout() error {
	if err := ensureRecordingDirectory(config.RecordingLocalRoot(), recordingLocalDirMode, true); err != nil {
		return err
	}
	if err := ensureRecordingDirectory(config.RecordingAssemblySpoolRoot(), recordingLocalDirMode, true); err != nil {
		return err
	}
	return nil
}

func ensureRecordingDirectory(dir string, mode os.FileMode, verifyWritable bool) error {
	dir = filepath.Clean(strings.TrimSpace(dir))
	if dir == "" {
		return nil
	}

	info, err := os.Stat(dir)
	if err != nil {
		if !os.IsNotExist(err) {
			return fmt.Errorf("检查录音目录失败: path=%s err=%w", dir, err)
		}
		if err := os.MkdirAll(dir, mode); err != nil {
			return fmt.Errorf("创建录音目录失败: path=%s err=%w", dir, err)
		}
	} else if !info.IsDir() {
		return fmt.Errorf("录音路径不是目录: path=%s", dir)
	}

	if err := os.Chmod(dir, mode); err != nil {
		return fmt.Errorf("修复录音目录权限失败: path=%s mode=%#o err=%w", dir, mode, err)
	}

	if !verifyWritable {
		return nil
	}

	probe, err := os.CreateTemp(dir, ".perm-check-*")
	if err != nil {
		return fmt.Errorf("验证录音目录可写失败: path=%s err=%w", dir, err)
	}
	probePath := probe.Name()
	if closeErr := probe.Close(); closeErr != nil {
		_ = os.Remove(probePath)
		return fmt.Errorf("关闭录音目录校验文件失败: path=%s err=%w", probePath, closeErr)
	}
	if removeErr := os.Remove(probePath); removeErr != nil && !os.IsNotExist(removeErr) {
		return fmt.Errorf("清理录音目录校验文件失败: path=%s err=%w", probePath, removeErr)
	}
	return nil
}

func ensureRecordingFileMode(path string, mode os.FileMode) error {
	path = filepath.Clean(strings.TrimSpace(path))
	if path == "" {
		return nil
	}
	if err := os.Chmod(path, mode); err != nil {
		return fmt.Errorf("修复录音文件权限失败: path=%s mode=%#o err=%w", path, mode, err)
	}
	return nil
}

func ensureRecordingWritableFile(path string, mode os.FileMode) error {
	path = filepath.Clean(strings.TrimSpace(path))
	if path == "" {
		return nil
	}
	info, err := os.Stat(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("检查录音文件失败: path=%s err=%w", path, err)
	}
	if info.IsDir() {
		return fmt.Errorf("录音路径不是文件: path=%s", path)
	}
	if err := ensureRecordingFileMode(path, mode); err != nil {
		return err
	}
	return nil
}
