package steps

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/rag"
	"github.com/53AI/53AIHub/service/vectorstore"
	"gorm.io/gorm"
)

const (
	vectorIndexingWaitTimeout          = 30 * time.Minute
	vectorIndexingInitialPollDelay     = 5 * time.Second
	vectorIndexingMaximumPollDelay     = 2 * time.Minute
	maxDeleteVectorsByFilterIteration  = 50
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

		if err := guardEmbeddingReindexRunForJob(ctx, db, eid, job); err != nil {
			return err
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

// 6. 等待向量化完成，失败自动重试
	retryCount := 0
	const maxEmbeddingRetries = 3
	for {
		if err := waitForEmbeddingCompletion(ctx, db, eid, fileID, file.LibraryID); err != nil {
			updateParsingStatus(model.FileParsingStatusFail)
			return fmt.Errorf("等待向量化完成失败: %v", err)
		}

		var failedChunks []model.RetrievalChunk
		if err := db.Where("eid = ? AND file_id = ? AND embedding_status = ?", eid, fileID, model.RetrievalChunkEmbeddingStatusFailed).
			Find(&failedChunks).Error; err != nil {
			logger.Warn(ctx, fmt.Sprintf("检查失败分块失败: %v", err))
			break
		}

		if len(failedChunks) == 0 {
			break
		}

		if retryCount >= maxEmbeddingRetries {
			logger.Warn(ctx, fmt.Sprintf("向量化重试已达上限 (%d)，仍有 %d 个分块失败", maxEmbeddingRetries, len(failedChunks)))
			break
		}

		retryCount++
		logger.Info(ctx, fmt.Sprintf("向量化完成但有 %d 个分块失败，开始第 %d 次重试", len(failedChunks), retryCount))

		if err := db.Model(&model.RetrievalChunk{}).
			Where("eid = ? AND file_id = ? AND embedding_status = ?", eid, fileID, model.RetrievalChunkEmbeddingStatusFailed).
			Updates(map[string]interface{}{
				"embedding_status": model.RetrievalChunkEmbeddingStatusPending,
				"vector_id":        "",
				"error_reason":     "",
			}).Error; err != nil {
			logger.Warn(ctx, fmt.Sprintf("重置失败分块状态失败: %v", err))
			break
		}

		if err := batchProcessor.ProcessFileChunks(eid, fileID); err != nil {
			logger.Warn(ctx, fmt.Sprintf("重新提交向量化任务失败: %v", err))
			break
		}
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

		// 如果是向量模型重建触发的 vector_indexing job，完成后恢复流水线信息
		if indexingStatus == model.FileParsingStatusNormal {
			restoreReindexCleaningRuleInfo(ctx, db, job)
		}

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

func guardEmbeddingReindexRunForJob(ctx context.Context, db *gorm.DB, eid int64, job *model.RagJob) error {
	if job == nil || strings.TrimSpace(job.StartParameters) == "" {
		return nil
	}

	var params map[string]interface{}
	if err := json.Unmarshal([]byte(job.StartParameters), &params); err != nil {
		return err
	}
	rawRunID, ok := params["embedding_reindex_batch_run_id"]
	if !ok {
		return nil
	}
	runID, ok := rawRunID.(string)
	if !ok || strings.TrimSpace(runID) == "" {
		return nil
	}

	active, err := rag.NewSiteEmbeddingReindexService(db).IsActiveRun(ctx, eid, runID)
	if err != nil {
		return err
	}
	if !active {
		logger.Warnf(ctx, "[SiteReindex] 旧批次 job 被拦截: eid=%d, job_id=%d, run_id=%s", eid, job.JobID, runID)
		return rag.ErrStaleEmbeddingReindexRun
	}
	return nil
}

// restoreReindexCleaningRuleInfo 检查 job 是否为向量模型重建触发，
// 如果是，完成时恢复文件的 cleaning_rule_info（去掉重建步骤覆盖层）
func restoreReindexCleaningRuleInfo(ctx context.Context, db *gorm.DB, job *model.RagJob) {
	if job == nil || strings.TrimSpace(job.StartParameters) == "" {
		return
	}
	var params map[string]interface{}
	if err := json.Unmarshal([]byte(job.StartParameters), &params); err != nil {
		return
	}
	if _, ok := params["embedding_reindex_batch_run_id"]; !ok {
		return
	}
	fileID := model.ExtractFileIDFromJob(job)
	if fileID <= 0 {
		return
	}

	// 读取现有的 cleaning_rule_info，去掉步骤覆盖层
	var file model.File
	if err := db.Select("cleaning_rule_info").First(&file, fileID).Error; err != nil {
		logger.Warnf(ctx, "[SiteReindex] 重建完成读取文件失败: file_id=%d, err=%v", fileID, err)
		return
	}
	if file.CleaningRuleInfo == "" {
		return
	}
	var info model.FileCleaningRuleInfo
	if err := json.Unmarshal([]byte(file.CleaningRuleInfo), &info); err != nil {
		return
	}
	// 清除步骤运行状态，保留 pipeline/strategy 等原始信息
	info.Status = ""
	info.Progress = 0
	info.SuccessCount = 0
	info.FailureCount = 0
	info.TotalSteps = 0
	info.EndTime = 0
	info.CurrentJobType = ""
	info.StepKey = ""
	info.StepName = ""
	info.StepMode = ""

	infoBytes, err := json.Marshal(info)
	if err != nil {
		logger.Warnf(ctx, "[SiteReindex] 重建完成序列化失败: file_id=%d, err=%v", fileID, err)
		return
	}
	logger.Infof(ctx, "[SiteReindex] 重建完成，恢复流水线信息: file_id=%d", fileID)
	if err := db.Model(&model.File{}).Where("id = ?", fileID).
		Update("cleaning_rule_info", string(infoBytes)).Error; err != nil {
		logger.Warnf(ctx, "[SiteReindex] 重建完成恢复流水线失败: file_id=%d, err=%v", fileID, err)
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

	// 根据当前 collection 模式，确定要清理的集合列表
	resolver := rag.VectorCollectionResolver{Mode: rag.GetVectorCollectionMode()}
	collections := resolver.ResolveDocumentWriteCollections(eid, *library)
	logger.SysLogf("【诊断-按文件清理向量】eid=%d, file_id=%d, library_id=%d, mode=%s, collections=%v", eid, fileID, libraryID, resolver.Mode, collections)

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
	for _, collection := range collections {
		if err := deleteVectorsByFilter(ctx, store, collection, filter); err != nil {
			if vectorstore.IsNotFoundError(err) {
				continue // 集合不存在时跳过
			}
			return err
		}
	}
	return nil
}

// deleteVectorsByFilter 按过滤条件循环删除向量，直到无匹配项
func deleteVectorsByFilter(ctx context.Context, store vectorstore.VectorStore, collection string, filter map[string]interface{}) error {
	logger.Info(ctx, fmt.Sprintf("【诊断-删除向量-开始】collection=%s, filter=%v", collection, filter))
	totalDeleted := 0
	for i := 0; i < maxDeleteVectorsByFilterIteration; i++ {
		req := vectorstore.FilterSearchRequest{
			Collection: collection,
			Filters:    filter,
			TopK:       100,
		}
		resp, err := store.FilterSearch(ctx, req)
		if err != nil {
			return err
		}
		if len(resp.Results) == 0 {
			if totalDeleted > 0 {
				logger.Info(ctx, fmt.Sprintf("【诊断-删除向量-完成】collection=%s, total_deleted=%d", collection, totalDeleted))
			} else {
				logger.Info(ctx, fmt.Sprintf("【诊断-删除向量-无数据】collection=%s, 无需清理", collection))
			}
			return nil
		}

		ids := make([]interface{}, 0, len(resp.Results))
		for _, res := range resp.Results {
			ids = append(ids, res.ID)
		}
		if err := store.Delete(ctx, collection, ids); err != nil {
			return fmt.Errorf("删除向量失败: %v", err)
		}
		totalDeleted += len(ids)
		logger.Info(ctx, fmt.Sprintf("【诊断-删除向量-迭代】collection=%s, iteration=%d, found=%d, total_deleted=%d", collection, i+1, len(ids), totalDeleted))

		if i >= maxDeleteVectorsByFilterIteration-5 {
			logger.Warn(ctx, fmt.Sprintf("【诊断-删除向量-接近上限】collection=%s, iteration=%d, total_deleted=%d, max=%d", collection, i+1, totalDeleted, maxDeleteVectorsByFilterIteration))
		}
	}
	return fmt.Errorf("删除向量超过最大迭代次数 %d，请检查是否有并发写入，collection=%s, total_deleted=%d", maxDeleteVectorsByFilterIteration, collection, totalDeleted)
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

	// 根据当前 collection 模式创建对应集合
	resolver := rag.VectorCollectionResolver{Mode: rag.GetVectorCollectionMode()}
	collections := resolver.ResolveDocumentWriteCollections(eid, *library)
	logger.SysLogf("【诊断-确保集合存在】eid=%d, file_id=%d, mode=%s, collections=%v", eid, fileID, resolver.Mode, collections)

	for _, collection := range collections {
		createErr := store.CreateCollection(ctx, vectorstore.CollectionConfig{
			Name:      collection,
			Dimension: meta.Dimensions,
			Metric:    cfg.DistanceMetric,
		})
		if createErr != nil {
			if vectorstore.IsExistsError(createErr) {
				logger.SysLogf("【诊断-确保集合存在】collection已存在，尝试读取实际维度: %s", collection)
				if info, infoErr := store.GetCollectionInfo(ctx, collection); infoErr == nil && info.Dimension > 0 && info.Dimension != meta.Dimensions {
					logger.SysLogf("【诊断-确保集合存在】collection维度不匹配，先删除旧集合: %s, 期望=%d, 实际=%d", collection, meta.Dimensions, info.Dimension)
					if delErr := store.DeleteCollection(ctx, collection); delErr != nil && !vectorstore.IsNotFoundError(delErr) {
						return false, fmt.Errorf("删除旧集合失败: %w", delErr)
					}
					logger.SysLogf("【诊断-确保集合存在】旧集合已删除，准备重建: %s", collection)
				} else if infoErr == nil {
					logger.SysLogf("【诊断-确保集合存在】collection维度一致: %s, dimension=%d", collection, info.Dimension)
				} else {
					logger.SysLogf("【诊断-确保集合存在】读取collection信息失败: %s, err=%v", collection, infoErr)
				}
			} else {
				return false, createErr
			}
		} else {
			logger.SysLogf("【诊断-确保集合存在】collection创建成功: %s, dimension=%d", collection, meta.Dimensions)
		}
		// TODO(E4): 创建 payload index (eid, space_id, library_id, file_id, chunk_type, status)
		// 当前 vectorstore.CreateIndex 为 stub，需要扩展 Qdrant API 调用 payload index 创建接口
	}
	return true, nil
}
