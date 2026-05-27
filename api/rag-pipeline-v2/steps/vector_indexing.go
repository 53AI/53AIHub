package steps

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/rag"
	"github.com/53AI/53AIHub/service/vectorstore"
	"gorm.io/gorm"
)

const (
	vectorIndexingWaitTimeout      = 24 * time.Hour
	vectorIndexingInitialPollDelay = 5 * time.Second
	vectorIndexingMaximumPollDelay = 5 * time.Minute
)

// NewVectorIndexingHandler 创建 vector_indexing 步骤处理函数
func NewVectorIndexingHandler(db *gorm.DB) func(ctx context.Context, job *model.RagJob, config json.RawMessage) error {
	return func(ctx context.Context, job *model.RagJob, stepConfig json.RawMessage) error {
		// 1. 解析基础参数
		var params map[string]interface{}
		if err := json.Unmarshal([]byte(job.StartParameters), &params); err != nil {
			return fmt.Errorf("解析任务参数失败: %v", err)
		}

		eid := int64(0)
		if v, ok := params["eid"]; ok {
			eid = int64(v.(float64))
		}
		fileID := int64(0)
		if v, ok := params["file_id"]; ok {
			fileID = int64(v.(float64))
		}

		logger.Info(ctx, fmt.Sprintf("VectorIndexingStepHandler: processing job %d for file %d", job.JobID, fileID))

		updateParsingStatus := func(status string) {
			if err := model.UpdateFileParsingStatus(fileID, status); err != nil {
				logger.Error(ctx, fmt.Sprintf("更新文件解析状态失败: %v", err))
			}
		}

		// 2. 获取文件信息
		var file model.File
		if err := db.Where("eid = ? AND id = ?", eid, fileID).First(&file).Error; err != nil {
			updateParsingStatus(model.FileParsingStatusFail)
			return fmt.Errorf("获取文件信息失败: %v", err)
		}

		// 3. 检查停止信号
		if err := common.CheckRagTaskStop(file.LibraryID, file.ID); err != nil {
			updateParsingStatus(model.FileParsingStatusFail)
			return err
		}

		// 4. 清理向量库中的旧向量 (修复 V1 孤儿向量问题)
		// 使用 FilterSearch 按 file_id 清理，不依赖 DB 中的记录
		if err := cleanupVectorsByFileID(ctx, eid, file.LibraryID, fileID); err != nil {
			logger.Warn(ctx, fmt.Sprintf("清理旧向量失败 (非致命错误): %v", err))
		}

		resetCount, err := resetFailedRetrievalChunksToPending(db, eid, fileID)
		if err != nil {
			logger.Warn(ctx, fmt.Sprintf("重置失败检索块失败 (非致命错误): %v", err))
		} else if resetCount > 0 {
			logger.Info(ctx, fmt.Sprintf("已重置失败检索块为待处理: %d", resetCount))
		}

		if ensured, err := ensureVectorCollectionExists(ctx, db, eid, fileID, &file); err != nil {
			logger.Warn(ctx, fmt.Sprintf("预创建向量集合失败 (将继续尝试插入时自动创建): %v", err))
		} else if ensured {
			logger.Info(ctx, "向量集合已确认可用")
		}

		// 5. 批量提交向量化任务
		batchProcessor := rag.NewEmbeddingBatchProcessor(db)
		if err := batchProcessor.ProcessFileChunks(eid, fileID); err != nil {
			updateParsingStatus(model.FileParsingStatusFail)
			return fmt.Errorf("提交向量化任务失败: %v", err)
		}

		// 6. 等待向量化完成
		if err := waitForEmbeddingCompletion(ctx, db, eid, fileID, file.LibraryID); err != nil {
			updateParsingStatus(model.FileParsingStatusFail)
			return fmt.Errorf("等待向量化完成失败: %v", err)
		}

		// 7. 统计结果 (向量片数和模型维度)
		var vectorCount int64
		if err := db.Model(&model.RetrievalChunk{}).
			Where("eid = ? AND file_id = ? AND vector_id IS NOT NULL AND vector_id != ''", eid, fileID).
			Count(&vectorCount).Error; err != nil {
			logger.Warn(ctx, fmt.Sprintf("统计向量数量失败: %v", err))
		}

		// 获取维度信息
		dimension := 0

		// 记录结果日志
		logger.Info(ctx, fmt.Sprintf("VectorIndexing 完成: 向量数=%d, 维度=%d", vectorCount, dimension))

		indexingStatus, err := model.GetFileIndexingStatus(eid, fileID)
		if err != nil {
			updateParsingStatus(model.FileParsingStatusFail)
			return fmt.Errorf("获取文件索引状态失败: %v", err)
		}
		updateParsingStatus(indexingStatus)

		if indexingStatus == model.FileParsingStatusFail {
			var failedCount int64
			_ = db.Model(&model.RetrievalChunk{}).
				Where("eid = ? AND file_id = ? AND embedding_status = ?", eid, fileID, model.RetrievalChunkEmbeddingStatusFailed).
				Count(&failedCount).Error
			return fmt.Errorf("向量化完成但文件状态为失败 (failed_chunks=%d，请检查 retrieval_chunks)", failedCount)
		}

		return nil
	}
}

// cleanupVectorsByFileID 按文件ID清理向量
func cleanupVectorsByFileID(ctx context.Context, eid, libraryID, fileID int64) error {
	cfg := vectorstore.LoadFromEnv()
	store, err := vectorstore.NewVectorStore(cfg)
	if err != nil {
		return err
	}
	if err := store.Connect(ctx); err != nil {
		return err
	}
	defer store.Disconnect(ctx)

	library, err := model.GetLibraryByID(eid, libraryID)
	if err != nil {
		return err
	}
	collection := model.GetVectorCollectionName(library.UUID)

	// 构建 file_id 过滤条件
	filter := map[string]interface{}{
		"must": []map[string]interface{}{
			{
				"key": "file_id",
				"match": map[string]interface{}{
					"value": fileID,
				},
			},
		},
	}

	// 循环删除直到没有匹配项
	for {
		// 搜索旧向量
		req := vectorstore.FilterSearchRequest{
			Collection: collection,
			Filters:    filter,
			TopK:       100, // 每次批处理 100 条
		}
		resp, err := store.FilterSearch(ctx, req)
		if err != nil {
			// 如果集合不存在，直接返回成功
			if vectorstore.IsNotFoundError(err) {
				return nil
			}
			return err
		}

		if len(resp.Results) == 0 {
			break
		}

		// 提取 ID 进行删除
		ids := make([]interface{}, 0, len(resp.Results))
		for _, res := range resp.Results {
			ids = append(ids, res.ID)
		}

		if err := store.Delete(ctx, collection, ids); err != nil {
			return fmt.Errorf("删除向量失败: %v", err)
		}
		logger.Info(ctx, fmt.Sprintf("已清理 %d 个旧向量", len(ids)))
	}
	return nil
}

// waitForEmbeddingCompletion 等待向量化完成 (复用 V1 逻辑并简化)
func waitForEmbeddingCompletion(ctx context.Context, db *gorm.DB, eid, fileID, libraryID int64) error {
	timeout := vectorIndexingWaitTimeout
	startTime := time.Now()
	delay := vectorIndexingInitialPollDelay

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(delay):
			// 检查停止信号
			if err := common.CheckRagTaskStop(libraryID, fileID); err != nil {
				return err
			}

			// 检查超时
			if time.Since(startTime) > timeout {
				return fmt.Errorf("等待向量化超时")
			}

			// 检查待处理数量
			pending, err := model.CountPendingEmbeddingRetrievalChunksByFileID(eid, fileID)
			if err != nil {
				logger.Warn(ctx, fmt.Sprintf("检查待处理数量失败: %v", err))
				delay = nextVectorIndexingPollDelay(delay)
				continue
			}

			if pending == 0 {
				// 检查是否有失败的任务
				var failedCount int64
				if err := db.Model(&model.RetrievalChunk{}).
					Where("eid = ? AND file_id = ? AND embedding_status = ?", eid, fileID, model.RetrievalChunkEmbeddingStatusFailed).
					Count(&failedCount).Error; err != nil {
					logger.Warn(ctx, fmt.Sprintf("检查失败数量失败: %v", err))
				}

				if failedCount > 0 {
					logger.Warn(ctx, fmt.Sprintf("向量化完成，但有 %d 个分块失败", failedCount))
				}

				// 方案D-增强版：强制同步所有 document_chunks 状态
				// 解决异步更新导致的 document_chunks 状态不一致问题
				// 无论 docPending 是否为 0，都执行强制同步确保状态正确
				if err := syncAllDocumentChunksStatus(ctx, db, eid, fileID); err != nil {
					logger.Warn(ctx, fmt.Sprintf("同步文档分块状态失败: %v", err))
				}

				// 检查是否还有未完成的 document_chunks
				docPending, err := model.CountPendingEmbeddingDocumentChunksByFileID(eid, fileID)
				if err != nil {
					logger.Warn(ctx, fmt.Sprintf("检查文档分块待处理数量失败: %v", err))
				} else if docPending > 0 {
					logger.Info(ctx, fmt.Sprintf("强制同步后仍有 %d 个文档分块未完成，继续等待...", docPending))
					continue
				}

				return nil
			}

			delay = nextVectorIndexingPollDelay(delay)

			// 可选：打印进度日志
			if elapsed := time.Since(startTime); elapsed > 10*time.Second && elapsed%(30*time.Second) == 0 {
				logger.Info(ctx, fmt.Sprintf("等待向量化... 剩余 %d 个任务", pending))
			}
		}
	}
}

func nextVectorIndexingPollDelay(current time.Duration) time.Duration {
	if current < vectorIndexingInitialPollDelay {
		return vectorIndexingInitialPollDelay
	}

	next := current * 2
	if next > vectorIndexingMaximumPollDelay {
		return vectorIndexingMaximumPollDelay
	}

	return next
}

// syncAllDocumentChunksStatus 强制同步文件下所有 document_chunks 的状态
// 基于关联的 retrieval_chunks 实际状态重新计算并更新
func syncAllDocumentChunksStatus(ctx context.Context, db *gorm.DB, eid, fileID int64) error {
	// 获取该文件下所有关联的 document_chunk IDs
	var docChunkIDs []int64
	if err := db.Model(&model.DocumentChunk{}).
		Where("eid = ? AND file_id = ?", eid, fileID).
		Pluck("id", &docChunkIDs).Error; err != nil {
		return fmt.Errorf("获取文档分块列表失败: %v", err)
	}

	if len(docChunkIDs) == 0 {
		return nil
	}

	logger.Info(ctx, fmt.Sprintf("开始同步文档分块状态: fileID=%d, docChunks=%d", fileID, len(docChunkIDs)))

	// 为每个 document_chunk 重新计算状态
	for _, docChunkID := range docChunkIDs {
		if err := syncDocumentChunkStatus(db, eid, docChunkID, fileID); err != nil {
			logger.Warn(ctx, fmt.Sprintf("同步文档分块 %d 状态失败: %v", docChunkID, err))
			// 继续处理其他分块，不因单个失败而中断
		}
	}

	logger.Info(ctx, fmt.Sprintf("文档分块状态同步完成: fileID=%d", fileID))
	return nil
}

// syncDocumentChunkStatus 同步单个 document_chunk 的状态
func syncDocumentChunkStatus(db *gorm.DB, eid, docChunkID, fileID int64) error {
	// 在事务中查询 retrieval_chunks 并更新 document_chunk
	return db.Transaction(func(tx *gorm.DB) error {
		// 查询该 document_chunk 下的所有 retrieval_chunks
		var retrievalChunks []model.RetrievalChunk
		if err := tx.Where("knowledge_chunk_id = ? AND file_id = ?", docChunkID, fileID).
			Find(&retrievalChunks).Error; err != nil {
			return err
		}

		if len(retrievalChunks) == 0 {
			return nil
		}

		// 计算状态
		allSucceeded := true
		hasFailed := false
		hasIndexing := false

		for _, chunk := range retrievalChunks {
			switch {
			case chunk.EmbeddingStatus == model.RetrievalChunkEmbeddingStatusFailed:
				hasFailed = true
				allSucceeded = false
			case model.IsRetrievalChunkEmbeddingSucceeded(chunk.EmbeddingStatus):
				// 已完成
			case chunk.EmbeddingStatus == model.RetrievalChunkEmbeddingStatusIndexing:
				allSucceeded = false
				hasIndexing = true
			default:
				// pending 或其他中间态
				allSucceeded = false
			}
		}

		// 确定目标状态
		var targetStatus string
		switch {
		case hasFailed:
			targetStatus = model.DocumentChunkEmbeddingStatusFailed
		case allSucceeded:
			targetStatus = model.DocumentChunkEmbeddingStatusNormal
		case hasIndexing:
			targetStatus = model.DocumentChunkEmbeddingStatusIndexing
		default:
			targetStatus = model.DocumentChunkEmbeddingStatusPending
		}

		// 获取当前状态
		var currentStatus string
		if err := tx.Model(&model.DocumentChunk{}).
			Where("id = ? AND eid = ?", docChunkID, eid).
			Pluck("embedding_status", &currentStatus).Error; err != nil {
			return err
		}

		// 只在状态不一致时更新
		if currentStatus != targetStatus {
			if err := tx.Model(&model.DocumentChunk{}).
				Where("id = ? AND eid = ?", docChunkID, eid).
				Update("embedding_status", targetStatus).Error; err != nil {
				return err
			}
		}

		return nil
	})
}

func resetFailedRetrievalChunksToPending(db *gorm.DB, eid, fileID int64) (int64, error) {
	tx := db.Model(&model.RetrievalChunk{}).
		Where("eid = ? AND file_id = ? AND embedding_status = ?", eid, fileID, model.RetrievalChunkEmbeddingStatusFailed).
		Where("(vector_id IS NULL OR vector_id = '')").
		Updates(map[string]any{
			"embedding_status": model.RetrievalChunkEmbeddingStatusPending,
			"error_reason":     "",
		})
	return tx.RowsAffected, tx.Error
}

func ensureVectorCollectionExists(ctx context.Context, db *gorm.DB, eid, fileID int64, file *model.File) (bool, error) {
	cfgService := rag.NewChunkConfigService(db)
	chunkCfg, err := cfgService.GetConfigWithFileID(eid, &file.LibraryID, &fileID)
	if err != nil {
		return false, err
	}
	if chunkCfg.EmbeddingModelName == nil || *chunkCfg.EmbeddingModelName == "" {
		return false, nil
	}

	meta, err := common.GetModelCatalogLoader().GetEmbeddingModelMeta(*chunkCfg.EmbeddingModelName)
	if err != nil || meta == nil || meta.Dimensions <= 0 {
		return false, nil
	}

	cfg := vectorstore.LoadFromEnv()
	if cfg == nil {
		return false, fmt.Errorf("vector db config is nil")
	}
	store, err := vectorstore.NewVectorStore(cfg)
	if err != nil {
		return false, err
	}
	if err := store.Connect(ctx); err != nil {
		return false, err
	}
	defer store.Disconnect(ctx)

	library, err := model.GetLibraryByID(eid, file.LibraryID)
	if err != nil {
		return false, err
	}
	collection := model.GetVectorCollectionName(library.UUID)
	createErr := store.CreateCollection(ctx, vectorstore.CollectionConfig{
		Name:      collection,
		Dimension: meta.Dimensions,
		Metric:    cfg.DistanceMetric,
	})
	if createErr != nil && !vectorstore.IsExistsError(createErr) {
		return false, createErr
	}
	return true, nil
}
