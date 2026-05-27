package service

import (
	"fmt"
	"log"

	"github.com/53AI/53AIHub/model"
)

// ErrorHandler 错误处理器
type ErrorHandler struct {
	batchManager *BatchUploadManager
}

// NewErrorHandler 创建错误处理器
func NewErrorHandler() *ErrorHandler {
	return &ErrorHandler{
		batchManager: GetBatchUploadManagerInstance(),
	}
}

// HandleInvalidConnection 处理无效连接错误
func (h *ErrorHandler) HandleInvalidConnection(batchID, fileID string, err error) error {
	log.Printf("处理无效连接错误: BatchID=%s, FileID=%s, Error=%v", batchID, fileID, err)

	// 1. 清理批次中的文件记录
	if err := h.cleanupFileRecord(batchID, fileID); err != nil {
		log.Printf("清理文件记录失败: %v", err)
	}

	// 2. 清理数据库中的相关记录
	if err := h.cleanupDatabaseRecords(batchID, fileID); err != nil {
		log.Printf("清理数据库记录失败: %v", err)
	}

	// 3. 重置文件状态为可重新上传
	if err := h.resetFileForReupload(batchID, fileID); err != nil {
		log.Printf("重置文件状态失败: %v", err)
	}

	return nil
}

// cleanupFileRecord 清理批次中的文件记录
func (h *ErrorHandler) cleanupFileRecord(batchID, fileID string) error {
	batch, err := h.batchManager.GetBatch(batchID)
	if err != nil {
		return fmt.Errorf("获取批次失败: %v", err)
	}

	batch.mu.Lock()
	if fileUpload, exists := batch.Files[fileID]; exists {
		// 标记为失败状态
		fileUpload.Status = "failed"
		fileUpload.Error = "连接异常，请重新上传"
		fileUpload.Progress = 0
		fileUpload.UploadedSize = 0

		// 更新进度（在持有 batch 锁的情况下安全修改）
		// Fix: Use updateFileProgressNoLock to avoid deadlock since we already hold the lock
		h.batchManager.updateFileProgressNoLock(batch, fileID, fileUpload)
		
		log.Printf("已清理文件记录: BatchID=%s, FileID=%s", batchID, fileID)
	}
	batch.mu.Unlock()
	return nil
}

// cleanupDatabaseRecords 清理数据库中的相关记录
func (h *ErrorHandler) cleanupDatabaseRecords(batchID, fileID string) error {
	batch, err := h.batchManager.GetBatch(batchID)
	if err != nil {
		return fmt.Errorf("获取批次失败: %v", err)
	}

	batch.mu.RLock()
	// Fix: Copy struct under lock to avoid data race on fields
	var fileUpload FileUpload
	var exists bool
	if ptr, ok := batch.Files[fileID]; ok {
		fileUpload = *ptr
		exists = true
	}
	batch.mu.RUnlock()
	if !exists {
		return nil
	}

	// 清理UploadFile记录
	if fileUpload.DatabaseID != 0 {
		uploadFile, err := model.GetUploadFileByID(fileUpload.DatabaseID)
		if err == nil && uploadFile != nil {
			// 标记为失败状态
			uploadFile.MarkAsFailed("连接异常，已清理记录")
			log.Printf("已标记UploadFile为失败: ID=%d", uploadFile.ID)
		}
	}

	// 清理File记录（如果存在）
	if fileUpload.FileID != 0 {
		// 使用正确的删除方法
		if err := model.DeleteFile(batch.EID, fileUpload.FileID); err != nil {
			log.Printf("删除File记录失败: ID=%d, Error=%v", fileUpload.FileID, err)
		} else {
			log.Printf("已删除File记录: ID=%d", fileUpload.FileID)
		}
	}

	return nil
}

// resetFileForReupload 重置文件状态为可重新上传
func (h *ErrorHandler) resetFileForReupload(batchID, fileID string) error {
	batch, err := h.batchManager.GetBatch(batchID)
	if err != nil {
		return fmt.Errorf("获取批次失败: %v", err)
	}

	batch.mu.Lock()
	if fileUpload, exists := batch.Files[fileID]; exists {
		// 重置为队列状态，允许重新上传
		fileUpload.Status = "queued"
		fileUpload.Error = ""
		fileUpload.Progress = 0
		fileUpload.UploadedSize = 0
		fileUpload.DatabaseID = 0
		fileUpload.FileID = 0

		// 更新进度（在持有 batch 锁的情况下安全修改）
		// Fix: Use updateFileProgressNoLock to avoid deadlock since we already hold the lock
		h.batchManager.updateFileProgressNoLock(batch, fileID, fileUpload)
		
		log.Printf("已重置文件状态为可重新上传: BatchID=%s, FileID=%s", batchID, fileID)
	}
	batch.mu.Unlock()
	return nil
}

// CleanupFailedBatch 清理失败的批次
func (h *ErrorHandler) CleanupFailedBatch(batchID string) error {
	log.Printf("开始清理失败的批次: BatchID=%s", batchID)

	batch, err := h.batchManager.GetBatch(batchID)
	if err != nil {
		return fmt.Errorf("获取批次失败: %v", err)
	}

	// 清理所有文件记录 - 先收集 keys 避免在遍历时修改 map 导致并发问题
	batch.mu.RLock()
	keys := make([]string, 0, len(batch.Files))
	for fid := range batch.Files {
		keys = append(keys, fid)
	}
	batch.mu.RUnlock()

	for _, fileID := range keys {
		if err := h.HandleInvalidConnection(batchID, fileID, fmt.Errorf("批次清理")); err != nil {
			log.Printf("清理文件失败: FileID=%s, Error=%v", fileID, err)
		}
	}

	// 标记批次为失败状态（在锁内修改状态）
	batch.mu.Lock()
	batch.Status = "failed"
	batch.mu.Unlock()
	h.batchManager.progressStorage.SaveBatch(batch)

	log.Printf("批次清理完成: BatchID=%s", batchID)
	return nil
}

// GetErrorHandler 获取全局错误处理器实例
var globalErrorHandler *ErrorHandler

func GetErrorHandler() *ErrorHandler {
	if globalErrorHandler == nil {
		globalErrorHandler = NewErrorHandler()
	}
	return globalErrorHandler
}