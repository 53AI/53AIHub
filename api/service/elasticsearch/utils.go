package elasticsearch

import (
	"sync"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
)

type syncTask struct {
	fileID int64
	file   model.File
	op     string
	retry  int
}

var (
	syncQueue    = make(chan syncTask, 1000)
	initSyncOnce sync.Once
)

func initSyncWorker() {
	go func() {
		for t := range syncQueue {
			if t.retry > 3 {
				logger.SysLogf("ES sync 放弃(重试超限): fileID=%d, op=%s", t.fileID, t.op)
				continue
			}
			processSyncTask(t)
		}
	}()
}

func processSyncTask(t syncTask) {
	esClient := GetGlobalClient()
	if esClient == nil || esClient.IsDisabled() {
		return
	}

	esService := NewFileNameSearchService(esClient, model.DB)
	var err error
	switch t.op {
	case "create", "update":
		err = esService.IndexFile(&t.file)
	case "delete":
		err = esService.DeleteFile(t.fileID)
	default:
		logger.SysLogf("ES sync 未知操作: %s", t.op)
	}

	if err != nil {
		logger.SysLogf("ES sync 失败(fileID=%d, op=%s, retry=%d): %v", t.fileID, t.op, t.retry, err)
		t.retry++
		time.AfterFunc(time.Duration(t.retry)*200*time.Millisecond, func() {
			syncQueue <- t
		})
	} else {
		logger.SysLogf("ES sync 完成: fileID=%d, op=%s", t.fileID, t.op)
	}
}

// SyncFileToES 统一的文件索引同步函数（异步，带重试）
func SyncFileToES(file *model.File, operation string) {
	initSyncOnce.Do(initSyncWorker)

	t := syncTask{
		fileID: file.ID,
		op:     operation,
	}
	if operation != "delete" && file != nil {
		t.file = *file
	}

	select {
	case syncQueue <- t:
	default:
		logger.SysLogf("ES sync 队列已满, 丢弃: fileID=%d, operation=%s", file.ID, operation)
	}
}
