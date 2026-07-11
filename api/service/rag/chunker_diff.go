package rag

import (
	"context"
	"fmt"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

// executeChunkChanges 执行分块变化操作
func (s *ChunkerService) executeChunkChanges(tx *gorm.DB, eid int64, fileID int64, libraryID int64, changes *ChunkChanges, updateRetrievalChunk bool) error {
	// 1. 处理删除操作（先删除，避免索引冲突）
	if err := s.executeChunkDeletes(tx, eid, changes.Deletes); err != nil {
		return fmt.Errorf("执行分块删除失败: %v", err)
	}

	// 2. 处理更新操作
	if err := s.executeChunkUpdates(tx, eid, fileID, libraryID, changes.Updates, updateRetrievalChunk); err != nil {
		return fmt.Errorf("执行分块更新失败: %v", err)
	}

	// 3. 处理创建操作
	if err := s.executeChunkCreates(tx, eid, fileID, libraryID, changes.Creates, updateRetrievalChunk); err != nil {
		return fmt.Errorf("执行分块创建失败: %v", err)
	}

	return nil
}

// executeChunkDeletes 执行分块删除操作
func (s *ChunkerService) executeChunkDeletes(tx *gorm.DB, eid int64, deletes []ChunkChange) error {
	for _, change := range deletes {
		if change.OldChunk == nil {
			continue
		}

		// 删除关联的检索块
		if err := s.deleteRetrievalChunksByKnowledgeID(tx, eid, change.OldChunk.ID); err != nil {
			return fmt.Errorf("删除检索块失败: %v", err)
		}

		// 删除分块关联关系
		if err := model.DeleteChunkRelationsByKnowledgeID(eid, change.OldChunk.ID); err != nil {
			return fmt.Errorf("删除分块关联关系失败: %v", err)
		}

		// 删除向量数据库中的向量
		if change.OldChunk.VectorID != "" {
			if err := s.DeleteVectorFromDB(eid, change.OldChunk.LibraryID, change.OldChunk.VectorID); err != nil {
				// 向量删除失败不阻断流程，但记录日志
				logger.Warn(context.TODO(), fmt.Sprintf("[deleteVectorFail][vectorID=%s]%+v", change.OldChunk.VectorID, err))
			}
		}

		// 删除文档分块
		if err := tx.Delete(change.OldChunk).Error; err != nil {
			return fmt.Errorf("删除文档分块失败: %v", err)
		}

		logger.Info(context.TODO(), fmt.Sprintf("[chunkDeleted][id=%d][index=%d]", change.OldChunk.ID, change.OldChunk.ChunkIndex))
	}

	return nil
}

// executeChunkUpdates 执行分块更新操作
func (s *ChunkerService) executeChunkUpdates(tx *gorm.DB, eid int64, fileID int64, libraryID int64, updates []ChunkChange, updateRetrievalChunk bool) error {
	for _, change := range updates {
		if change.OldChunk == nil || change.NewChunk == nil {
			continue
		}

		// 更新文档分块内容
		updatedChunk := change.OldChunk
		updatedChunk.Content = change.NewChunk.Content
		updatedChunk.ContentHash = s.generateContentHash(fileID, change.NewChunk.Content, change.ChunkIndex)
		updatedChunk.StartPosition = change.NewChunk.StartPos
		updatedChunk.EndPosition = change.NewChunk.EndPos
		updatedChunk.TokenCount = change.NewChunk.TokenCount

		// 根据是否需要更新检索块来设置EmbeddingStatus
		if updateRetrievalChunk {
			updatedChunk.EmbeddingStatus = "pending" // 需要重新向量化
		} else {
			updatedChunk.EmbeddingStatus = "completed" // 不需要向量化
		}

		if err := tx.Save(updatedChunk).Error; err != nil {
			return fmt.Errorf("更新文档分块失败: %v", err)
		}

		// 根据参数决定是否删除旧的检索块并重新创建
		if updateRetrievalChunk {
			// 删除旧的检索块
			if err := s.deleteRetrievalChunksByKnowledgeID(tx, eid, updatedChunk.ID); err != nil {
				return fmt.Errorf("删除旧检索块失败: %v", err)
			}

			// 重新创建检索块
			if err := s.createRetrievalChunksForUpdatedKnowledge(tx, eid, updatedChunk); err != nil {
				return fmt.Errorf("重新创建检索块失败: %v", err)
			}
		}

		logger.Info(context.TODO(), fmt.Sprintf("[chunkUpdated][id=%d][index=%d]", updatedChunk.ID, updatedChunk.ChunkIndex))
	}

	return nil
}

// executeChunkCreates 执行分块创建操作
func (s *ChunkerService) executeChunkCreates(tx *gorm.DB, eid int64, fileID int64, libraryID int64, creates []ChunkChange, updateRetrievalChunk bool) error {
	for _, change := range creates {
		if change.NewChunk == nil {
			continue
		}

		// 根据是否需要更新检索块来设置EmbeddingStatus
		embeddingStatus := model.DocumentChunkEmbeddingStatusPending
		if !updateRetrievalChunk {
			embeddingStatus = model.DocumentChunkEmbeddingStatusNormal
		}

		// 创建新的文档分块
		newChunk := &model.DocumentChunk{
			Eid:             eid,
			FileID:          fileID,
			LibraryID:       libraryID,
			Content:         change.NewChunk.Content,
			ContentHash:     s.generateContentHash(fileID, change.NewChunk.Content, change.ChunkIndex),
			ChunkIndex:      change.ChunkIndex,
			ChunkType:       change.NewChunk.Type,
			StartPosition:   change.NewChunk.StartPos,
			EndPosition:     change.NewChunk.EndPos,
			TokenCount:      change.NewChunk.TokenCount,
			Status:          "enabled",
			EmbeddingStatus: embeddingStatus,
		}

		if err := tx.Create(newChunk).Error; err != nil {
			return fmt.Errorf("创建文档分块失败: %v", err)
		}

		// 根据参数决定是否为新分块创建检索块
		if updateRetrievalChunk {
			if err := s.createRetrievalChunksForUpdatedKnowledge(tx, eid, newChunk); err != nil {
				return fmt.Errorf("为新分块创建检索块失败: %v", err)
			}
		}

		logger.Info(context.TODO(), fmt.Sprintf("[chunkCreated][fileID=%d][index=%d]", fileID, newChunk.ChunkIndex))
	}

	return nil
}

// executeSmartChunkUpdate 执行智能分块更新
func (s *ChunkerService) executeSmartChunkUpdate(tx *gorm.DB, eid int64, fileID int64, libraryID int64, newChunks []DocumentChunk) (*ChunkUpdateResult, error) {
	startTime := time.Now()

	// 获取现有的分块
	var existingChunks []model.DocumentChunk
	err := tx.Where("eid = ? AND file_id = ? AND chunk_type = ?", eid, fileID, "knowledge").
		Order("chunk_index asc").Find(&existingChunks).Error
	if err != nil {
		return nil, fmt.Errorf("获取现有分块失败: %v", err)
	}

	// 分析分块变化
	changes := s.analyzeChunkChanges(existingChunks, newChunks)

	// 执行分块变化操作
	// 智能更新总是需要更新检索块
	if err := s.executeChunkChanges(tx, eid, fileID, libraryID, changes, true); err != nil {
		return nil, err
	}

	// 计算更新结果
	result := &ChunkUpdateResult{
		CreatedCount: len(changes.Creates),
		UpdatedCount: len(changes.Updates),
		DeletedCount: len(changes.Deletes),
		TotalCount:   len(newChunks),
		Changes:      changes,
		Metadata:     s.calculateMetadata(newChunks, startTime),
	}

	return result, nil
}

// calculateMetadata 计算分块元数据
func (s *ChunkerService) calculateMetadata(chunks []DocumentChunk, startTime time.Time) ChunkMetadata {
	if len(chunks) == 0 {
		return ChunkMetadata{
			ProcessingTime: time.Since(startTime).Milliseconds(),
		}
	}

	totalTokens := 0
	totalLength := 0
	knowledgeChunkCount := 0

	for _, chunk := range chunks {
		if chunk.Type == "knowledge" { // 只统计知识点分块
			totalTokens += chunk.TokenCount
			totalLength += len(chunk.Content)
			knowledgeChunkCount++
		}
	}

	avgLength := 0.0
	if knowledgeChunkCount > 0 {
		avgLength = float64(totalLength) / float64(knowledgeChunkCount)
	}

	return ChunkMetadata{
		TotalChunks:    len(chunks),
		TotalTokens:    totalTokens,
		AvgChunkSize:   avgLength,
		ProcessingTime: time.Since(startTime).Milliseconds(),
	}
}
