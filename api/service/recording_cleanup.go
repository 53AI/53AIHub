package service

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
)

func recordingFinalizeWorkspaceRootPath(jobID int64) string {
	return filepath.Join(config.RecordingLocalRoot(), model.BuildRecordingFinalizeWorkspaceRoot(jobID))
}

func cleanupRecordingTaskArtifacts(job *model.RecordingJob) {
	if job == nil {
		return
	}

	if jobRoot := strings.TrimSpace(recordingLocalJobRootPath(job)); jobRoot != "" {
		if err := os.RemoveAll(jobRoot); err != nil {
			logger.SysWarnf("【录音】清理录音任务目录失败: job_id=%d path=%s err=%v", job.ID, jobRoot, err)
		}
	}

	if finalizeRoot := strings.TrimSpace(recordingFinalizeWorkspaceRootPath(job.ID)); finalizeRoot != "" {
		if err := os.RemoveAll(finalizeRoot); err != nil {
			logger.SysWarnf("【录音】清理录音 finalize 工作区失败: job_id=%d path=%s err=%v", job.ID, finalizeRoot, err)
		}
	}

	if err := deleteRecordingAssemblyJobSpoolDir(recordingAssemblySpoolRootDir(), job.Eid, job.ID); err != nil {
		logger.SysWarnf("【录音】清理录音任务 spool 目录失败: job_id=%d err=%v", job.ID, err)
	}
}
