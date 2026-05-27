package elasticsearch

import (
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
)

// SyncFileToES 统一的文件索引同步函数
func SyncFileToES(file *model.File, operation string) {
	// 使用简化的同步方式
	esClient := GetGlobalClient()
	if esClient == nil || esClient.IsDisabled() {
		logger.SysLogf("Elasticsearch 未启用，跳过文件同步: fileID=%d, operation=%s", file.ID, operation)
		return
	}

	// 创建文件搜索服务进行同步
	esService := NewFileNameSearchService(esClient, model.DB)
	var err error
	switch operation {
	case "create", "update":
		err = esService.IndexFile(file)
	case "delete":
		err = esService.DeleteFile(file.ID)
	}

	if err != nil {
		logger.SysLogf("同步文件到 Elasticsearch 失败: fileID=%d, operation=%s, err=%v", file.ID, operation, err)
	} else {
		logger.SysLogf("同步文件到 Elasticsearch 成功: fileID=%d, operation=%s", file.ID, operation)
	}
}
