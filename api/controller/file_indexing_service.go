package controller

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	v2engines "github.com/53AI/53AIHub/rag-pipeline-v2/engines"
	v2model "github.com/53AI/53AIHub/rag-pipeline-v2/model"
	"github.com/53AI/53AIHub/service"
	"github.com/google/uuid"
)

// disableFileIndexing 禁用文件索引
func disableFileIndexing(serviceManager *service.ServiceManager, eid int64, fileID int64, userID int64, reason string) error {
	// 获取文件信息
	file, err := model.GetFileByID(eid, fileID)
	if err != nil {
		return fmt.Errorf("获取文件信息失败: %v", err)
	}

	// 清理向量数据（不删除检索块，只清理向量ID和状态）
	if err := clearFileVectorData(eid, fileID, file.LibraryID); err != nil {
		// 删除失败记录日志，但不阻止状态更新
		logger.SysLogf("清理文件向量数据失败: eid=%d, fileID=%d, err=%v", eid, fileID, err)
	}

	// 重置检索块的向量化状态为待处理
	if err := resetRetrievalChunksEmbeddingStatus(eid, fileID); err != nil {
		logger.SysLogf("重置检索块向量化状态失败: eid=%d, fileID=%d, err=%v", eid, fileID, err)
	}

	// 更新文件状态
	file.ParsingStatus = model.FileParsingStatusDisabled
	file.DisabledReason = reason
	file.DisabledBy = userID
	file.DisabledAt = time.Now().Unix()

	if err := file.Update(); err != nil {
		return fmt.Errorf("更新文件索引状态失败: %v", err)
	}

	// 记录操作日志
	logger.SysLogf("用户禁用文件索引: eid=%d, fileID=%d, userID=%d, reason=%s", eid, fileID, userID, reason)

	return nil
}

// enableFileIndexing 启用文件索引
func enableFileIndexing(serviceManager *service.ServiceManager, eid int64, fileID int64, userID int64) error {
	// 获取文件信息
	file, err := model.GetFileByID(eid, fileID)
	if err != nil {
		return fmt.Errorf("获取文件信息失败: %v", err)
	}

	// 更新文件状态为索引中
	file.ParsingStatus = model.FileParsingStatusParsing
	file.DisabledReason = ""
	file.DisabledBy = 0
	file.DisabledAt = 0

	if err := file.Update(); err != nil {
		return fmt.Errorf("更新文件索引状态失败: %v", err)
	}

	// 异步重新索引
	go func() {
		defer func() {
			if r := recover(); r != nil {
				logger.SysLogf("重新索引文件时发生panic: eid=%d, fileID=%d, panic=%v", eid, fileID, r)
				// 更新状态为失败
				model.UpdateFileParsingStatus(fileID, model.FileParsingStatusFail)
			}
		}()

		// 检查是否有检索块数据
		hasRetrievalChunks, err := checkHasRetrievalChunks(eid, fileID)
		if err != nil {
			logger.SysLogf("检查检索块失败: eid=%d, fileID=%d, err=%v", eid, fileID, err)
			model.UpdateFileParsingStatus(fileID, model.FileParsingStatusFail)
			return
		}

		var reindexErr error
		if hasRetrievalChunks {
			// 有检索块，只运行向量化步骤
			logger.SysLogf("文件已有检索块，仅执行向量化步骤: eid=%d, fileID=%d", eid, fileID)
			reindexErr = runVectorIndexingOnly(eid, fileID, userID)
		} else {
			// 无检索块，运行完整流水线
			logger.SysLogf("文件无检索块，执行完整索引流水线: eid=%d, fileID=%d", eid, fileID)
			reindexErr = serviceManager.ReindexDocument(eid, fileID, "reindex_retrieval", userID)
		}

		if reindexErr != nil {
			logger.SysLogf("重新索引文件失败: eid=%d, fileID=%d, userID=%d, err=%v", eid, fileID, userID, reindexErr)
			model.UpdateFileParsingStatus(fileID, model.FileParsingStatusFail)
			return
		}

		logger.SysLogf("文件重新索引成功: eid=%d, fileID=%d, userID=%d", eid, fileID, userID)
	}()

	// 记录操作日志
	logger.SysLogf("用户启用文件索引: eid=%d, fileID=%d, userID=%d", eid, fileID, userID)

	return nil
}

// clearFileVectorData 清理文件的向量数据（从向量库中删除，不删除DB记录）
func clearFileVectorData(eid int64, fileID int64, libraryID int64) error {
	// 使用 model.CleanupVectorDataForFile 清理向量库数据
	return model.CleanupVectorDataForFile(eid, fileID)
}

// resetRetrievalChunksEmbeddingStatus 重置检索块的向量化状态
func resetRetrievalChunksEmbeddingStatus(eid int64, fileID int64) error {
	// 将检索块的向量化状态重置为待处理，清空向量ID
	updates := map[string]interface{}{
		"embedding_status": model.RetrievalChunkEmbeddingStatusPending,
		"vector_id":        "",
		"error_reason":     "",
	}
	return model.DB.Model(&model.RetrievalChunk{}).
		Where("eid = ? AND file_id = ?", eid, fileID).
		Updates(updates).Error
}

// checkHasRetrievalChunks 检查文件是否有检索块
func checkHasRetrievalChunks(eid int64, fileID int64) (bool, error) {
	var count int64
	err := model.DB.Model(&model.RetrievalChunk{}).
		Where("eid = ? AND file_id = ?", eid, fileID).
		Count(&count).Error
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

// runVectorIndexingOnly 仅运行向量化步骤
func runVectorIndexingOnly(eid int64, fileID int64, userID int64) error {
	ctx := context.Background()

	// 使用与前端相同的逻辑获取最新的 runID
	_, jobs, _, err := service.GetLatestRunJobsWithStepsByRelatedID(ctx, eid, fileID)
	if err != nil {
		logger.SysLogf("获取任务列表失败: eid=%d, fileID=%d, err=%v", eid, fileID, err)
		return fmt.Errorf("获取任务列表失败: %v", err)
	}

	if len(jobs) == 0 {
		// 没有任何任务，创建新任务
		logger.SysLogf("未找到任何任务，创建新向量化任务: eid=%d, fileID=%d", eid, fileID)
		return createVectorIndexingJob(ctx, eid, fileID, userID)
	}

	// 在任务列表中找到 vector_indexing 任务
	var vectorJob *model.RagJob
	for i := range jobs {
		if jobs[i].Type == "vector_indexing" {
			vectorJob = &jobs[i]
			break
		}
	}

	if vectorJob == nil {
		// 没找到 vector_indexing 任务，创建新任务
		logger.SysLogf("任务列表中无 vector_indexing 任务，创建新任务: eid=%d, fileID=%d", eid, fileID)
		return createVectorIndexingJob(ctx, eid, fileID, userID)
	}

	// 找到了 vector_indexing 任务，使用 RetryJobStepV2 重试（单步模式，只重置当前 job 的步骤）
	logger.SysLogf("找到现有 vector_indexing 任务，重试: job_id=%d, runID=%s, eid=%d, fileID=%d", vectorJob.JobID, vectorJob.RunID, eid, fileID)

	if err := service.RetryJobStepV2(ctx, vectorJob.JobID, nil); err != nil {
		logger.SysLogf("重试 vector_indexing 任务失败: job_id=%d, err=%v", vectorJob.JobID, err)
		return fmt.Errorf("重试向量化任务失败: %v", err)
	}

	logger.SysLogf("重试 vector_indexing 任务成功: job_id=%d, runID=%s, eid=%d, fileID=%d", vectorJob.JobID, vectorJob.RunID, eid, fileID)
	return nil
}

// createVectorIndexingJob 创建新的向量化任务
func createVectorIndexingJob(ctx context.Context, eid int64, fileID int64, userID int64) error {
	// 创建只包含 vector_indexing 步骤的 RuntimeProfile
	profile := v2model.RuntimeProfile{
		Steps: []v2model.ProfileStep{
			{
				RunMode: v2model.RunModeAuto,
				StepKey: "vector_indexing",
				Config:  json.RawMessage("{}"),
			},
		},
	}
	profileBytes, _ := json.Marshal(profile)

	// 构造启动参数
	params := map[string]interface{}{
		"eid":                  eid,
		"file_id":              fileID,
		"user_id":              userID,
		"__profile_step_index": 0,
	}
	paramsBytes, _ := json.Marshal(params)

	runID := uuid.New().String()

	// 创建任务
	job := &model.RagJob{
		Eid:             eid,
		Type:            "vector_indexing",
		Status:          model.RagJobStatusPending,
		StartParameters: string(paramsBytes),
		RuntimeProfile:  string(profileBytes),
		RunID:           runID,
		RelatedId:       fileID,
	}

	if err := model.DB.Create(job).Error; err != nil {
		return fmt.Errorf("创建向量化任务失败: %v", err)
	}

	// 将任务加入队列
	wrapper := v2engines.JobWrapper{
		JobID:      job.JobID,
		Eid:        eid,
		Type:       "vector_indexing",
		EnqueuedAt: time.Now(),
		Retries:    0,
	}
	wrapperBytes, _ := json.Marshal(wrapper)
	queueName := "rag:job:queue:vector_indexing"

	if err := common.RDB.LPush(ctx, queueName, wrapperBytes).Err(); err != nil {
		return fmt.Errorf("任务入队失败: %v", err)
	}

	logger.SysLogf("创建向量化任务成功: job_id=%d, runID=%s, eid=%d, fileID=%d", job.JobID, runID, eid, fileID)
	return nil
}

// deleteFileEmbeddings 删除文件的向量数据（已废弃，保留兼容性）
func deleteFileEmbeddings(serviceManager *service.ServiceManager, eid int64, fileID int64) error {
	return model.DeleteRetrievalChunksByFileID(eid, fileID)
}

// deleteFileSearchIndex 删除文件的搜索索引（已废弃，保留兼容性）
func deleteFileSearchIndex(serviceManager *service.ServiceManager, eid int64, fileID int64) error {
	return model.CleanupVectorDataForFile(eid, fileID)
}
