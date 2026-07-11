package service

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/53AI/53AIHub/common/storage"
	"github.com/53AI/53AIHub/config"
)

var recordingSaveArtifactFunc = saveRecordingArtifactImpl
var recordingAppendArtifactFunc = appendRecordingArtifactImpl
var recordingSaveArtifactFromFileFunc = saveRecordingArtifactFromFileImpl
var recordingLoadArtifactFunc = loadRecordingArtifactImpl
var recordingDeleteArtifactFunc = deleteRecordingArtifactIfExistsImpl

func recordingArtifactRelativeKey(filePath string) (string, bool) {
	cleaned := filepath.Clean(strings.TrimSpace(filePath))
	if cleaned == "" {
		return "", false
	}
	if filepath.IsAbs(cleaned) {
		root := filepath.Clean(config.RecordingLocalRoot())
		rel, err := filepath.Rel(root, cleaned)
		if err != nil || rel == "." || rel == "" || strings.HasPrefix(rel, "..") {
			return "", false
		}
		return filepath.Clean(rel), true
	}
	instanceID := strings.TrimSpace(config.GetRecordingInstanceID())
	if instanceID == "" {
		instanceID = "default"
	}
	if cleaned == instanceID {
		return cleaned, true
	}
	sep := string(os.PathSeparator)
	if strings.HasPrefix(cleaned, instanceID+sep) {
		return cleaned, true
	}
	return "", false
}

func recordingArtifactDiskPath(filePath string) (string, bool) {
	if rel, ok := recordingArtifactRelativeKey(filePath); ok {
		return filepath.Join(config.RecordingLocalRoot(), rel), true
	}
	cleaned := filepath.Clean(strings.TrimSpace(filePath))
	if cleaned == "" {
		return "", false
	}
	spoolRoot := config.RecordingAssemblySpoolRoot()
	absSpoolRoot, _ := filepath.Abs(spoolRoot)
	absCleaned, _ := filepath.Abs(cleaned)
	if absCleaned == absSpoolRoot || strings.HasPrefix(absCleaned, absSpoolRoot+string(os.PathSeparator)) {
		return cleaned, true
	}
	if filepath.IsAbs(cleaned) {
		return cleaned, true
	}
	return "", false
}

func recordingArtifactExists(filePath string) bool {
	if diskPath, ok := recordingArtifactDiskPath(filePath); ok {
		if info, err := os.Stat(diskPath); err == nil && !info.IsDir() {
			return true
		}
		return false
	}
	filePath = strings.TrimSpace(filePath)
	if filePath == "" {
		return false
	}
	if info, err := os.Stat(filepath.Clean(filePath)); err == nil && !info.IsDir() {
		return true
	}
	return false
}

func saveRecordingArtifactImpl(filePath string, content []byte) error {
	if strings.TrimSpace(filePath) == "" {
		return fmt.Errorf("recording artifact path is empty")
	}
	if diskPath, ok := recordingArtifactDiskPath(filePath); ok {
		if err := ensureRecordingDirectory(filepath.Dir(diskPath), recordingLocalDirMode, false); err != nil {
			return err
		}
		if err := ensureRecordingWritableFile(diskPath, recordingLocalArtifactMode); err != nil {
			return err
		}
		if err := os.WriteFile(diskPath, content, 0o600); err != nil {
			return fmt.Errorf("write recording artifact error: %w", err)
		}
		if err := ensureRecordingFileMode(diskPath, recordingLocalArtifactMode); err != nil {
			return err
		}
		return nil
	}
	return storage.StorageInstance.Save(content, filePath)
}

func saveRecordingArtifact(filePath string, content []byte) error {
	return recordingSaveArtifactFunc(filePath, content)
}

func appendRecordingArtifactImpl(filePath string, content []byte) error {
	if strings.TrimSpace(filePath) == "" {
		return fmt.Errorf("recording artifact path is empty")
	}
	if diskPath, ok := recordingArtifactDiskPath(filePath); ok {
		if err := ensureRecordingDirectory(filepath.Dir(diskPath), recordingLocalDirMode, false); err != nil {
			return err
		}
		if err := ensureRecordingWritableFile(diskPath, recordingLocalArtifactMode); err != nil {
			return err
		}
		f, err := os.OpenFile(diskPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
		if err != nil {
			return fmt.Errorf("append recording artifact error: %w", err)
		}
		defer func() {
			_ = f.Close()
		}()
		if len(content) > 0 {
			if _, err := f.Write(content); err != nil {
				return fmt.Errorf("append recording artifact error: %w", err)
			}
		}
		if err := f.Sync(); err != nil {
			return fmt.Errorf("sync recording artifact failed: %w", err)
		}
		if err := ensureRecordingFileMode(diskPath, recordingLocalArtifactMode); err != nil {
			return err
		}
		return nil
	}
	if !storage.StorageInstance.Exists(filePath) {
		return storage.StorageInstance.Save(content, filePath)
	}
	existing, err := storage.StorageInstance.Load(filePath)
	if err != nil {
		return err
	}
	combined := make([]byte, 0, len(existing)+len(content))
	combined = append(combined, existing...)
	combined = append(combined, content...)
	return storage.StorageInstance.Save(combined, filePath)
}

func appendRecordingArtifact(filePath string, content []byte) error {
	return recordingAppendArtifactFunc(filePath, content)
}

func saveRecordingArtifactFromFileImpl(srcPath, dstPath string) error {
	if strings.TrimSpace(srcPath) == "" || strings.TrimSpace(dstPath) == "" {
		return fmt.Errorf("recording artifact path is empty")
	}
	if diskPath, ok := recordingArtifactDiskPath(dstPath); ok {
		if err := ensureRecordingDirectory(filepath.Dir(diskPath), recordingLocalDirMode, false); err != nil {
			return err
		}
		if err := ensureRecordingWritableFile(diskPath, recordingLocalArtifactMode); err != nil {
			return err
		}
		srcFile, err := os.Open(srcPath)
		if err != nil {
			return fmt.Errorf("open recording artifact source failed: %w", err)
		}
		defer srcFile.Close()

		dstFile, err := os.Create(diskPath)
		if err != nil {
			return fmt.Errorf("create recording artifact target failed: %w", err)
		}
		defer func() {
			_ = dstFile.Close()
		}()

		if _, err := io.Copy(dstFile, srcFile); err != nil {
			_ = os.Remove(diskPath)
			return fmt.Errorf("copy recording artifact failed: %w", err)
		}
		if err := dstFile.Sync(); err != nil {
			_ = os.Remove(diskPath)
			return fmt.Errorf("sync recording artifact failed: %w", err)
		}
		if err := ensureRecordingFileMode(diskPath, recordingLocalArtifactMode); err != nil {
			_ = os.Remove(diskPath)
			return err
		}
		return nil
	}
	return storage.StorageInstance.SaveFile(srcPath, dstPath)
}

func saveRecordingArtifactFromFile(srcPath, dstPath string) error {
	return recordingSaveArtifactFromFileFunc(srcPath, dstPath)
}

func loadRecordingArtifactImpl(filePath string) ([]byte, error) {
	if diskPath, ok := recordingArtifactDiskPath(filePath); ok {
		data, err := os.ReadFile(diskPath)
		if err != nil {
			return nil, fmt.Errorf("read recording artifact error: %w", err)
		}
		return data, nil
	}
	data, err := storage.StorageInstance.Load(filePath)
	if err != nil {
		return nil, err
	}
	return data, nil
}

func loadRecordingArtifact(filePath string) ([]byte, error) {
	return recordingLoadArtifactFunc(filePath)
}

func deleteRecordingArtifactIfExistsImpl(filePath string) error {
	if diskPath, ok := recordingArtifactDiskPath(filePath); ok {
		if err := os.Remove(diskPath); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("remove recording artifact error: %w", err)
		}
		return nil
	}
	filePath = strings.TrimSpace(filePath)
	if filePath == "" {
		return nil
	}
	if !storage.StorageInstance.Exists(filePath) {
		return nil
	}
	if err := storage.StorageInstance.Delete(filePath); err != nil {
		if storage.StorageInstance.Exists(filePath) {
			return fmt.Errorf("remove recording artifact error: %w", err)
		}
	}
	return nil
}

func deleteRecordingArtifactIfExists(filePath string) error {
	return recordingDeleteArtifactFunc(filePath)
}
