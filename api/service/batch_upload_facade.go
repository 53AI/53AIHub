package service

import (
	"context"
	"fmt"

	"github.com/53AI/53AIHub/model"
)

// BatchUploadFacadeResult 封装批量上传初始化后的业务结果。
type BatchUploadFacadeResult struct {
	Batch          *BatchUpload
	FileMappings   map[string]string
	DuplicateFiles []DuplicateFileInfo
}

// BatchUploadFacade 负责把批量上传初始化流程收口成一个可复用入口。
type BatchUploadFacade struct {
	manager *BatchUploadManager
}

func NewBatchUploadFacade(manager *BatchUploadManager) *BatchUploadFacade {
	if manager == nil {
		manager = GetBatchUploadManagerInstance()
	}
	return &BatchUploadFacade{manager: manager}
}

func (f *BatchUploadFacade) CreateBatch(ctx context.Context, eid, userID int64, req *BatchInitRequest) (*BatchUploadFacadeResult, error) {
	_ = ctx
	if req == nil {
		return nil, fmt.Errorf("批量上传请求不能为空")
	}

	dirManager := NewDirectoryManager()
	if err := dirManager.ValidateDirectoryStructure(req.FileStructure); err != nil {
		return nil, err
	}

	fileProcessor := NewFileProcessor()
	for _, item := range req.FileStructure {
		if item.IsDirectory {
			continue
		}
		if !fileProcessor.ValidateFileFormat(item.RelativePath) {
			return nil, fmt.Errorf("不支持的文件格式: %s", item.RelativePath)
		}
		if !fileProcessor.ValidateFileSize(item.Size) {
			return nil, fmt.Errorf("文件 %s 大小超过限制", item.RelativePath)
		}
	}

	batch, duplicateFiles, err := f.manager.CreateBatch(eid, userID, req)
	if err != nil {
		return nil, err
	}

	fileMappings := make(map[string]string)
	for fileID, fileUpload := range batch.GetFilesCopy() {
		fileMappings[fileUpload.RelativePath] = fileID
	}

	return &BatchUploadFacadeResult{
		Batch:          batch,
		FileMappings:   fileMappings,
		DuplicateFiles: duplicateFiles,
	}, nil
}

// BatchUploadFacade is intentionally thin: the HTTP controller keeps the feature gate,
// while this facade only validates the structure and delegates to the manager.
func (f *BatchUploadFacade) GetBatchByID(batchID string) (*BatchUpload, error) {
	return f.manager.GetBatch(batchID)
}

func (f *BatchUploadFacade) CancelBatch(batchID string) error {
	return f.manager.CancelBatch(batchID)
}

func (f *BatchUploadFacade) GetProgressStorage() *ProgressStorage {
	return f.manager.GetProgressStorage()
}

func (f *BatchUploadFacade) GetMaxConcurrent() int {
	return f.manager.GetMaxConcurrent()
}

func (f *BatchUploadFacade) GetChunkSize() int64 {
	return f.manager.GetChunkSize()
}

// Ensure imports stay in use for strict builds.
var _ = model.FILE_TYPE_FILE
