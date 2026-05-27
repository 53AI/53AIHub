package steps

import (
	"context"
	"fmt"
	"log"
	"strconv"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/rag"
	"gorm.io/gorm"
)

// EmbeddingProcessingStep 向量化处理步骤
type EmbeddingProcessingStep struct {
	BaseStep
	DB *gorm.DB
}

// EmbeddingProcessingParameters 向量化处理步骤的参数
type EmbeddingProcessingParameters struct {
	Eid    int64 `json:"eid"`
	FileID int64 `json:"file_id"`
	UserID int64 `json:"user_id"`
}

// EmbeddingProcessingResult 向量化处理步骤的结果
type EmbeddingProcessingResult struct {
	ProcessedChunkCount int  `json:"processed_chunk_count"`
	Success             bool `json:"success"`
}

// NewEmbeddingProcessingStep 创建新的向量化处理步骤
func NewEmbeddingProcessingStep(db *gorm.DB) *EmbeddingProcessingStep {
	return &EmbeddingProcessingStep{
		DB: db,
	}
}

// Execute 执行向量化处理步骤
func (s *EmbeddingProcessingStep) Execute(parameters any) error {
	s.Step.StartProcessing(parameters)

	// 类型断言获取参数
	params, ok := parameters.(EmbeddingProcessingParameters)
	if !ok {
		err := fmt.Errorf("invalid parameters type, expected EmbeddingProcessingParameters")
		s.Step.CompleteWithError(err.Error())
		return err
	}

	// 获取文件信息
	var file model.File
	err := s.DB.Where("eid = ? AND id = ?", params.Eid, params.FileID).First(&file).Error
	if err != nil {
		errMsg := fmt.Sprintf("获取文件信息失败: %v", err)
		s.Step.CompleteWithError(errMsg)
		return fmt.Errorf("%s", errMsg)
	}

	// 检查是否有停止信号
	err = common.CheckRagTaskStop(file.LibraryID, file.ID)
	if err != nil {
		s.Step.CompleteWithError(err)
		return err
	}

	// 检查嵌入 API 是否可用
	retrievalService := rag.NewRetrievalChunkService(s.DB)
	err = retrievalService.CheckGenerateEmbeddingForChunk(params.Eid, &file.LibraryID, &params.FileID, "TestAPI")
	if err != nil {
		errMsg := fmt.Sprintf("embedding API 不可用: %v", err)
		s.Step.CompleteWithError(errMsg)
		return fmt.Errorf("%s", errMsg)
	}

	// 使用批量处理器处理文件嵌入
	batchProcessor := rag.NewEmbeddingBatchProcessor(s.DB)
	if batchProcessor == nil {
		errMsg := "批量处理器为空"
		s.Step.CompleteWithError(errMsg)
		return fmt.Errorf("%s", errMsg)
	}
	err = batchProcessor.ProcessFileChunks(params.Eid, params.FileID)
	if err != nil {
		errMsg := fmt.Sprintf("处理文件嵌入失败: %v", err)
		s.Step.CompleteWithError(errMsg)
		return fmt.Errorf("%s", errMsg)
	}

	// 等待所有向量化任务完成
	log.Printf("等待文件 %d 的向量化任务完成...", params.FileID)
	err = s.waitForEmbeddingCompletion(params.Eid, params.FileID)
	if err != nil {
		errMsg := fmt.Sprintf("等待向量化完成失败: %v", err)
		s.Step.CompleteWithError(errMsg)
		return fmt.Errorf("%s", errMsg)
	}

	// 统计已处理的检索块数量
	var count int64
	err = s.DB.Model(&model.RetrievalChunk{}).
		Where("eid = ? AND file_id = ? AND vector_id IS NOT NULL AND vector_id != ''", params.Eid, params.FileID).
		Count(&count).Error
	if err != nil {
		log.Printf("统计已处理的检索块数量失败: %v\n", err)
		count = 0
	}

	// 创建结果
	result := EmbeddingProcessingResult{
		ProcessedChunkCount: int(count),
		Success:             true,
	}

	// 更新文件解析状态为正常
	model.UpdateFileParsingStatus(params.FileID, model.FileParsingStatusNormal)

	// 完成步骤并返回结果
	s.Step.CompleteSuccessfully(result)
	return nil
}

// getAbandonedTaskCount checks for abandoned tasks in Redis for the last hour
func (s *EmbeddingProcessingStep) getAbandonedTaskCount(eid int64) (int64, error) {
	if !common.IsRedisEnabled() {
		log.Printf("Redis is not enabled, cannot check abandoned tasks")
		return 0, nil
	}

	abandonedKey := fmt.Sprintf("rag:embedding:abandoned:%d", eid)
	ctx := context.Background()

	// Calculate timestamp for one hour ago
	oneHourAgo := time.Now().Add(-time.Hour).Unix()

	// Count abandoned tasks in the last hour
	count, err := common.RDB.ZCount(ctx, abandonedKey, strconv.FormatInt(oneHourAgo, 10), "+inf").Result()
	if err != nil {
		log.Printf("Failed to count abandoned tasks for eid %d: %v", eid, err)
		return 0, err
	}

	return count, nil
}

// waitForEmbeddingCompletion 等待向量化任务完成
func (s *EmbeddingProcessingStep) waitForEmbeddingCompletion(eid, fileID int64) error {
	// 设置超时时间：30分钟
	timeout := 30 * time.Minute
	startTime := time.Now()

	// 获取总块数用于进度显示
	var totalChunks int64
	err := s.DB.Model(&model.RetrievalChunk{}).
		Where("eid = ? AND file_id = ?", eid, fileID).
		Count(&totalChunks).Error
	if err != nil {
		log.Printf("获取总检索块数量失败: %v\n", err)
		totalChunks = 0
	}

	log.Printf("等待文件 %d 的向量化任务完成，共 %d 个检索块", fileID, totalChunks)
	file, err := model.GetFileByID(eid, fileID)
	if err != nil {
		return fmt.Errorf("获取文件 %d 失败: %v", fileID, err)
	}

	err = common.CheckRagTaskStop(file.LibraryID, file.ID)
	if err != nil {
		return err
	}

	// 使用 ticker 定时检查
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	checkCount := 0
	for range ticker.C {
		checkCount++

		// 检查是否有停止信号
		err = common.CheckRagTaskStop(file.LibraryID, file.ID)
		if err != nil {
			return err
		}

		// 检查是否有被放弃的任务（用于检测停止信号）
		abandonedCount, err := s.getAbandonedTaskCount(eid)
		if err != nil {
			log.Printf("检查放弃任务数量失败: %v", err)
		} else if abandonedCount > 10 {
			log.Printf("检测到大量放弃任务 (%d)，可能收到停止信号，立即返回错误", abandonedCount)
			return fmt.Errorf("embedding tasks aborted due to stop signal")
		} else if abandonedCount > 0 {
			// Debug log for non-zero abandoned task count
			log.Printf("检测到 %d 个放弃任务（阈值: 10）", abandonedCount)
		}

		// 检查是否超时
		if time.Since(startTime) > timeout {
			return fmt.Errorf("等待向量化完成超时（%v），已检查%d次", timeout, checkCount)
		}

		// 获取待处理的数量
		pendingCount, err := model.CountPendingEmbeddingRetrievalChunksByFileID(eid, fileID)
		if err != nil {
			log.Printf("检查待处理检索块数量失败: %v\n", err)
			continue
		}

		// 获取已完成数量
		var completedCount int64
		err = s.DB.Model(&model.RetrievalChunk{}).
			Where("eid = ? AND file_id = ? AND vector_id IS NOT NULL AND vector_id != ''", eid, fileID).
			Count(&completedCount).Error
		if err != nil {
			log.Printf("检查已完成检索块数量失败: %v\n", err)
			completedCount = 0
		}

		// 日志输出进度
		if totalChunks > 0 {
			progress := float64(completedCount) / float64(totalChunks) * 100
			log.Printf("向量化进度检查 #%d: 已完成 %d/%d (%.1f%%), 待处理 %d",
				checkCount, completedCount, totalChunks, progress, pendingCount)
		} else {
			log.Printf("向量化进度检查 #%d: 已完成 %d, 待处理 %d",
				checkCount, completedCount, pendingCount)
		}

		// 如果没有待处理的，说明全部完成
		if pendingCount == 0 {
			log.Printf("文件 %d 的向量化任务全部完成，耗时 %v", fileID, time.Since(startTime))
			return nil
		}

		// 如果长时间没有进度更新，输出警告
		if checkCount%6 == 0 { // 每分钟检查一次
			log.Printf("等待向量化完成中... 已耗时 %v，仍有 %d 个块待处理",
				time.Since(startTime), pendingCount)
		}
	}

	// 这一行不会被执行到，因为ticker.C是一个永不关闭的通道
	return nil
}
