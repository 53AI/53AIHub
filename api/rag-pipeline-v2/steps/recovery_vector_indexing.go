package steps

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/rag"
	"gorm.io/gorm"
)

// RecoverVectorIndexing vector_indexing 步骤的恢复 handler
// 断点检查：retrieval_chunks 和 document_chunks 的 embedding_status 是否全部完成
func RecoverVectorIndexing(db *gorm.DB) func(ctx context.Context, job *model.RagJob, config json.RawMessage) error {
	return func(ctx context.Context, job *model.RagJob, config json.RawMessage) error {
		eid, fileID := extractEidAndFileID(job)
		if err := guardEmbeddingReindexRunForJob(ctx, db, eid, job); err != nil {
			return err
		}

		var file model.File
		if err := db.Where("eid = ? AND id = ?", eid, fileID).First(&file).Error; err != nil {
			return fmt.Errorf("获取文件信息失败: %v", err)
		}

		resetProcessingCount, err := resetProcessingRetrievalChunksToPending(db, eid, fileID)
		if err != nil {
			logger.Warnf(ctx, "[SiteReindex] 重置 processing chunk 失败 (非致命): %v", err)
		} else if resetProcessingCount > 0 {
			logger.Infof(ctx, "[SiteReindex] vector_indexing: 已重置 %d 个 processing chunk 为 pending (file_id=%d)", resetProcessingCount, fileID)
		}

		remaining, _ := model.CountPendingEmbeddingRetrievalChunksByFileID(eid, fileID)
		docRemaining, _ := model.CountPendingEmbeddingDocumentChunksByFileID(eid, fileID)
		if remaining == 0 && docRemaining == 0 {
			logger.Infof(ctx, "[SiteReindex] vector_indexing: 所有向量化已完成，跳过 (file_id=%d)", fileID)
			return nil
		}

		logger.Infof(ctx, "[SiteReindex] vector_indexing: 仍有 %d 个 chunk 未完成向量化，重新提交 (file_id=%d)", remaining, fileID)

		batchProcessor := rag.NewEmbeddingBatchProcessor(db)
		if err := batchProcessor.ProcessFileChunks(eid, fileID); err != nil {
			return fmt.Errorf("提交向量化任务失败: %v", err)
		}

		// 不等待 embedding 完成——恢复期间 embedding worker 尚未启动
		// ProcessFileChunks 已入队，StartWorkers 启动后 embedding worker 会消费
		logger.Infof(ctx, "[SiteReindex] vector_indexing: 已入队向量化任务，异步处理 (file_id=%d)", fileID)
		return nil
	}
}

// resetProcessingRetrievalChunksToPending 将 embedding_status='processing' 的 chunk 重置为 pending
func resetProcessingRetrievalChunksToPending(db *gorm.DB, eid, fileID int64) (int64, error) {
	tx := db.Model(&model.RetrievalChunk{}).
		Where("eid = ? AND file_id = ? AND embedding_status = ?", eid, fileID, model.RetrievalChunkEmbeddingStatusIndexing).
		Updates(map[string]any{
			"embedding_status": model.RetrievalChunkEmbeddingStatusPending,
			"error_reason":     "",
		})
	return tx.RowsAffected, tx.Error
}
