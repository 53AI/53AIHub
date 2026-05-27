package service

import (
	"errors"
	"strings"

	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
)

const recordingAssemblyDefaultFlushThresholdBytes int64 = 16 << 20

var recordingAssemblyFlushThresholdBytes = recordingAssemblyDefaultFlushThresholdBytes
var recordingAssemblyFlushDurationThresholdMs = int64(config.RECORDING_SPOOL_FLUSH_DURATION_MS)
var recordingAssemblySpoolRootDirFunc = func() string {
	return config.RecordingAssemblySpoolRoot()
}

var ErrRecordingAssemblyDuplicateSegmentConflict = errors.New("录音分片内容与已接收分片冲突")
var ErrRecordingAssemblyBufferMissing = errors.New("录音聚合缓冲文件不存在")
var updateRecordingJobFn = model.UpdateRecordingJob

func SetRecordingAssemblySpoolRootDirForTest(root string) func() {
	previous := recordingAssemblySpoolRootDirFunc
	if strings.TrimSpace(root) != "" {
		recordingAssemblySpoolRootDirFunc = func() string { return root }
	}
	return func() {
		recordingAssemblySpoolRootDirFunc = previous
	}
}

func SetRecordingAssemblyFlushThresholdForTest(size int64) func() {
	previous := recordingAssemblyFlushThresholdBytes
	recordingAssemblyFlushThresholdBytes = size
	return func() {
		recordingAssemblyFlushThresholdBytes = previous
	}
}

func SetRecordingAssemblyFlushDurationThresholdForTest(ms int64) func() {
	previous := recordingAssemblyFlushDurationThresholdMs
	recordingAssemblyFlushDurationThresholdMs = ms
	return func() {
		recordingAssemblyFlushDurationThresholdMs = previous
	}
}

func SetRecordingAssemblyUpdateRecordingJobFuncForTest(fn func(*model.RecordingJob, map[string]interface{}) error) func() {
	previous := updateRecordingJobFn
	if fn == nil {
		updateRecordingJobFn = model.UpdateRecordingJob
	} else {
		updateRecordingJobFn = fn
	}
	return func() {
		updateRecordingJobFn = previous
	}
}
