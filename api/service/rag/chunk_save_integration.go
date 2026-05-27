package rag

import (
	"context"
	"fmt"
	"log"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

// ChunkSaveIntegration 分块保存集成器
type ChunkSaveIntegration struct {
	chunkerService *ChunkerService
	chunkSaver     *ChunkSaver
	db             *gorm.DB
}

// NewChunkSaveIntegration 创建分块保存集成器
func NewChunkSaveIntegration(db *gorm.DB) *ChunkSaveIntegration {
	return &ChunkSaveIntegration{
		chunkerService: NewChunkerService(db),
		chunkSaver:     NewChunkSaver(db),
		db:             db,
	}
}

// SaveChunksOptimized 优化的分块保存方法（主入口）
func (csi *ChunkSaveIntegration) SaveChunksOptimized(eid int64, fileID int64, chunks []DocumentChunk) error {
	if len(chunks) == 0 {
		return nil
	}

	logger.Info(context.TODO(), fmt.Sprintf("[optSaveStart][fileID=%d][chunks=%d]", fileID, len(chunks)))

	// 获取文件信息以获取 LibraryID
	var file model.File
	err := csi.db.Where("eid = ? AND id = ?", eid, fileID).First(&file).Error
	if err != nil {
		return fmt.Errorf("获取文件信息失败: %v", err)
	}

	// 保存前检查 embedding 配置
	forceEmbeddingFailed := false
	{
		cfgSvc := NewChunkConfigService(csi.db)
		if cfg, cerr := cfgSvc.GetConfigWithFileID(eid, &file.LibraryID, &fileID); cerr != nil {
			if cfg == nil || cfg.EmbeddingChannelID == nil {
				forceEmbeddingFailed = true
				logger.Warn(context.TODO(), fmt.Sprintf("[optEmbeddingConfigMissing][eid=%d][fileID=%d] 未配置向量化渠道，本次创建的分块 embedding_status=failed", eid, fileID))
			} else {
				logger.Warn(context.TODO(), fmt.Sprintf("[optEmbeddingConfigCheckError][eid=%d][fileID=%d] err=%v", eid, fileID, cerr))
			}
		}
	}

	// 转换为 model.DocumentChunk 类型
	modelChunks := make([]model.DocumentChunk, len(chunks))
	for i, chunk := range chunks {
		embStatus := model.DocumentChunkEmbeddingStatusPending
		if forceEmbeddingFailed {
			embStatus = model.DocumentChunkEmbeddingStatusFailed
		}
		modelChunks[i] = model.DocumentChunk{
			Eid:             eid,
			FileID:          fileID,
			LibraryID:       file.LibraryID,
			Content:         chunk.Content,
			ChunkIndex:      chunk.Index,
			ChunkType:       chunk.Type,
			StartPosition:   chunk.StartPos,
			EndPosition:     chunk.EndPos,
			TokenCount:      chunk.TokenCount,
			Status:          "enabled",
			EmbeddingStatus: embStatus,
			VectorID:        "",
			IsManualEdited:  false,
			ChunkConfigID:   chunk.ChunkConfigID,
		}
	}

	// 使用优化的分块保存器
	return csi.chunkSaver.SaveChunks(eid, fileID, modelChunks)
}

// ReplaceOriginalSaveChunks 替换原始的 SaveChunks 方法
func (csi *ChunkSaveIntegration) ReplaceOriginalSaveChunks() {
	log.Printf("ChunkSaveIntegration: 已启用优化的分块保存功能")
}

// GetSaveStats 获取保存统计信息
func (csi *ChunkSaveIntegration) GetSaveStats() *ChunkSaveMonitor {
	return csi.chunkSaver.GetMonitorStats()
}

// Close 关闭集成器
func (csi *ChunkSaveIntegration) Close() {
	if csi.chunkSaver != nil {
		csi.chunkSaver.Close()
	}
}

// 全局集成器实例
var globalChunkSaveIntegration *ChunkSaveIntegration

// InitChunkSaveIntegration 初始化分块保存集成器
func InitChunkSaveIntegration(db *gorm.DB) {
	globalChunkSaveIntegration = NewChunkSaveIntegration(db)
	log.Printf("分块保存优化集成器已初始化")
}

// GetChunkSaveIntegration 获取全局集成器实例
func GetChunkSaveIntegration() *ChunkSaveIntegration {
	return globalChunkSaveIntegration
}

// OptimizedSaveChunks 全局优化保存方法
func OptimizedSaveChunks(eid int64, file model.File, fileID int64, chunks []DocumentChunk) error {
	if globalChunkSaveIntegration == nil {
		// 降级到原始方法：在此路径也检查 embedding 配置
		log.Printf("集成器未初始化，使用传统保存方法")
		forceEmbeddingFailed := false
		{
			// 使用全局数据库句柄
			cfgSvc := NewChunkConfigService(model.DB)
			if cfg, cerr := cfgSvc.GetConfigWithFileID(eid, &file.LibraryID, &fileID); cerr != nil {
				if cfg == nil || cfg.EmbeddingChannelID == nil {
					forceEmbeddingFailed = true
					logger.Warn(context.TODO(), fmt.Sprintf("[fallbackEmbeddingConfigMissing][eid=%d][fileID=%d] 未配置向量化渠道，降级路径 embedding_status=failed", eid, fileID))
				} else {
					logger.Warn(context.TODO(), fmt.Sprintf("[fallbackEmbeddingConfigCheckError][eid=%d][fileID=%d] err=%v", eid, fileID, cerr))
				}
			}
		}

		// 转换并使用传统方法
		modelChunks := make([]model.DocumentChunk, len(chunks))
		for i, chunk := range chunks {
			embStatus := model.DocumentChunkEmbeddingStatusPending
			if forceEmbeddingFailed {
				embStatus = model.DocumentChunkEmbeddingStatusFailed
			}
			modelChunks[i] = model.DocumentChunk{
				Eid:             eid,
				FileID:          fileID,
				LibraryID:       file.LibraryID,
				Content:         chunk.Content,
				ChunkIndex:      chunk.Index,
				ChunkType:       chunk.Type,
				StartPosition:   chunk.StartPos,
				EndPosition:     chunk.EndPos,
				TokenCount:      chunk.TokenCount,
				Status:          "enabled",
				EmbeddingStatus: embStatus,
				ChunkConfigID:   chunk.ChunkConfigID,
			}
			modelChunks[i].ContentHash = modelChunks[i].GenerateContentHash()
		}

		return model.BatchCreateDocumentChunks(modelChunks)
	}

	return globalChunkSaveIntegration.SaveChunksOptimized(eid, fileID, chunks)
}
