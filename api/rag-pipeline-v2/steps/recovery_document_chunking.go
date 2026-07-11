package steps

import (
	"context"
	"encoding/json"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/rag"
	"gorm.io/gorm"
)

// RecoverDocumentChunking document_chunking 步骤的恢复 handler
// 断点检查：document_chunks 表是否有 knowledge 类型的分块
func RecoverDocumentChunking(db *gorm.DB) func(ctx context.Context, job *model.RagJob, config json.RawMessage) error {
	return func(ctx context.Context, job *model.RagJob, config json.RawMessage) error {
		eid, fileID := extractEidAndFileID(job)

		var chunkCount int64
		db.Model(&model.DocumentChunk{}).
			Where("eid = ? AND file_id = ? AND chunk_type = 'knowledge'", eid, fileID).
			Count(&chunkCount)

		if chunkCount > 0 {
			logger.Infof(ctx, "【流水线恢复】document_chunking: 已有 %d 个分块，跳过切分 (file_id=%d)", chunkCount, fileID)
			enqueueExistingChunksForEnrichment(ctx, db, eid, fileID)
			return nil
		}

		logger.Infof(ctx, "【流水线恢复】document_chunking: 无分块记录，全量重做 (file_id=%d)", fileID)
		return NewDocumentChunkingHandler(db)(ctx, job, config)
	}
}

// enqueueExistingChunksForEnrichment 将已有分块补入 enrichment 队列（幂等）
func enqueueExistingChunksForEnrichment(ctx context.Context, db *gorm.DB, eid, fileID int64) {
	var chunks []model.DocumentChunk
	if err := db.Where("eid = ? AND file_id = ? AND chunk_type = 'knowledge'", eid, fileID).
		Find(&chunks).Error; err != nil {
		logger.Warnf(ctx, "【流水线恢复】获取已有分块失败: %v", err)
		return
	}

	if len(chunks) == 0 {
		return
	}

	chunkIDs := make([]int64, 0, len(chunks))
	for _, c := range chunks {
		chunkIDs = append(chunkIDs, c.ID)
	}

	cfgService := rag.NewChunkConfigService(db)
	chunkConfig, err := cfgService.GetConfigWithFileID(eid, nil, &fileID)
	if err != nil {
		logger.Errorf(ctx, "【流水线恢复】获取 chunk config 失败，无法补入 enrichment 队列: eid=%d, file_id=%d, err=%v", eid, fileID, err)
		return
	}

	if _, err := rag.EnqueueChunkEnrichment(ctx, rag.ChunkEnrichmentTask{
		Eid:         eid,
		FileID:      fileID,
		ChunkIDs:    chunkIDs,
		ChunkConfig: chunkConfig,
	}); err != nil {
		logger.Warnf(ctx, "【流水线恢复】补入 enrichment 队列失败(非致命): eid=%d, file_id=%d, err=%v", eid, fileID, err)
	}
}
