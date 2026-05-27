package service

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
)

type recordingFinalizeWorkspace struct {
	dir          string
	segmentsDir  string
	concatList   string
	outputPath   string
	targetFormat string
}

func newRecordingFinalizeWorkspace(jobID int64, targetFormat string) (*recordingFinalizeWorkspace, error) {
	normalizedFormat := normalizeRecordingTargetFormat(targetFormat)
	dir := filepath.Join(config.RecordingLocalRoot(), model.BuildRecordingFinalizeWorkspaceRoot(jobID))
	if err := ensureRecordingDirectory(dir, recordingLocalDirMode, false); err != nil {
		return nil, fmt.Errorf("创建 finalize 工作区失败: %w", err)
	}

	segmentsDir := filepath.Join(dir, "segments")
	if err := ensureRecordingDirectory(segmentsDir, recordingLocalDirMode, false); err != nil {
		_ = os.RemoveAll(dir)
		return nil, fmt.Errorf("创建 finalize 分段目录失败: %w", err)
	}

	workspace := &recordingFinalizeWorkspace{
		dir:          dir,
		segmentsDir:  segmentsDir,
		concatList:   filepath.Join(dir, "concat-list.txt"),
		outputPath:   filepath.Join(dir, "output."+normalizedFormat),
		targetFormat: normalizedFormat,
	}
	return workspace, nil
}

func (w *recordingFinalizeWorkspace) cleanup() error {
	if w == nil {
		return nil
	}
	if strings.TrimSpace(w.dir) == "" {
		return nil
	}
	return os.RemoveAll(w.dir)
}

func (w *recordingFinalizeWorkspace) segmentPath(index int) string {
	if w == nil {
		return ""
	}
	if index < 0 {
		index = 0
	}
	name := fmt.Sprintf("segment-%06d.%s", index, w.targetFormat)
	return filepath.Join(w.segmentsDir, name)
}
