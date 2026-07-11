package rag

import (
	"context"
	"fmt"
	"strings"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

// MergeChunks 合并分块（增强版）
func defaultMergeOptions() MergeChunksOptions {
	return MergeChunksOptions{
		UpdateIndexes:  false,
		ResetEmbedding: false,
	}
}

func defaultSplitOptions() SplitChunkOptions {
	return SplitChunkOptions{
		UpdateIndexes:  true,  // 拆分时默认更新索引
		ResetEmbedding: false, // 默认不重置向量化状态
	}
}

func (s *ChunkerService) MergeChunks(eid int64, fileID int64, chunkIDs []int64, userID int64) (*model.DocumentChunk, error) {
	// 使用默认选项
	options := defaultMergeOptions()
	options.AutoSplitIfTooLarge = true
	return s.MergeChunksWithOptions(eid, fileID, chunkIDs, userID, options)
}

// MergeChunksWithOptions 带选项的合并分块
func (s *ChunkerService) MergeChunksWithOptions(eid int64, fileID int64, chunkIDs []int64, userID int64, options MergeChunksOptions) (*model.DocumentChunk, error) {
	if len(chunkIDs) < 2 {
		return nil, fmt.Errorf("至少需要2个分块才能合并")
	}

	// 获取要合并的分块
	var chunks []model.DocumentChunk
	err := s.db.Where("eid = ? AND file_id = ? AND id IN ?", eid, fileID, chunkIDs).
		Order("chunk_index asc").Find(&chunks).Error
	if err != nil {
		return nil, err
	}

	if len(chunks) != len(chunkIDs) {
		return nil, fmt.Errorf("部分分块不存在")
	}

	// 检查分块类型一致性
	chunkType := chunks[0].ChunkType
	for _, chunk := range chunks {
		if chunk.ChunkType != chunkType {
			return nil, fmt.Errorf("只能合并相同类型的分块")
		}
	}

	// 获取分块配置以确定最大长度
	config, err := s.config.GetConfigWithFileID(eid, &chunks[0].LibraryID, &chunks[0].FileID)
	if err != nil {
		return nil, fmt.Errorf("获取分块配置失败: %v", err)
	}

	// 根据分块类型确定最大长度
	var maxLength int
	if chunkType == "knowledge" {
		maxLength = config.KnowledgeMaxLength
	} else {
		maxLength = config.IndexMaxLength
	}

	// 合并内容
	var mergedContent strings.Builder
	for i, chunk := range chunks {
		if i > 0 {
			mergedContent.WriteString("\n\n")
		}
		mergedContent.WriteString(chunk.Content)
	}

	mergedContentStr := mergedContent.String()
	mergedTokenCount, _ := s.tokenizer.CountTokens(mergedContentStr)

	// 开启事务
	tx := s.db.Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	var resultChunk *model.DocumentChunk

	// 检查合并后是否超长
	if mergedTokenCount > maxLength && options.AutoSplitIfTooLarge {
		// 智能拆分合并后的内容
		splitChunks := s.splitLargeContent(mergedContentStr, maxLength, chunkType, chunks[0].StartPosition)

		if len(splitChunks) > 1 {
			// 创建多个分块
			var newChunks []model.DocumentChunk
			baseIndex := chunks[0].ChunkIndex

			for i, splitChunk := range splitChunks {
				newChunk := model.DocumentChunk{
					Eid:            chunks[0].Eid,
					FileID:         chunks[0].FileID,
					LibraryID:      chunks[0].LibraryID,
					Content:        splitChunk.Content,
					ChunkIndex:     baseIndex + i,
					ChunkType:      chunkType,
					StartPosition:  chunks[0].StartPosition,
					EndPosition:    chunks[len(chunks)-1].EndPosition,
					TokenCount:     splitChunk.TokenCount,
					Status:         "enabled",
					IsManualEdited: true,
				}

				// 生成新的内容哈希
				newChunk.ContentHash = newChunk.GenerateContentHash()

				// 设置向量化状态
				if options.ResetEmbedding {
					newChunk.EmbeddingStatus = model.DocumentChunkEmbeddingStatusPending
					newChunk.VectorID = ""
				} else {
					newChunk.EmbeddingStatus = chunks[0].EmbeddingStatus
					newChunk.VectorID = chunks[0].VectorID
				}

				if err := tx.Create(&newChunk).Error; err != nil {
					tx.Rollback()
					return nil, err
				}
				newChunks = append(newChunks, newChunk)
			}

			resultChunk = &newChunks[0] // 返回第一个分块
		} else {
			// 拆分失败，创建单个分块
			resultChunk = s.createMergedChunk(chunks, mergedContentStr, mergedTokenCount, options)
			if err := tx.Create(resultChunk).Error; err != nil {
				tx.Rollback()
				return nil, err
			}
		}
	} else {
		// 创建单个合并分块
		resultChunk = s.createMergedChunk(chunks, mergedContentStr, mergedTokenCount, options)
		if err := tx.Create(resultChunk).Error; err != nil {
			tx.Rollback()
			return nil, err
		}
	}

	// 处理检索块的级联更新
	if err := s.handleRetrievalChunksForMerge(tx, eid, chunkIDs, resultChunk.ID); err != nil {
		tx.Rollback()
		return nil, err
	}

	// 删除原分块
	if err := tx.Where("eid = ? AND id IN ?", eid, chunkIDs).Delete(&model.DocumentChunk{}).Error; err != nil {
		tx.Rollback()
		return nil, err
	}

	// 更新其他分块索引（如果需要）
	if options.UpdateIndexes {
		if err := s.updateChunkIndexes(tx, eid, fileID, chunks[0].ChunkIndex); err != nil {
			tx.Rollback()
			return nil, err
		}
	}

	// 提交事务
	if err := tx.Commit().Error; err != nil {
		return nil, err
	}

	return resultChunk, nil
}

// SplitChunk 拆分分块（增强版）
func (s *ChunkerService) SplitChunk(eid int64, chunkID int64, splitContents []string, userID int64) ([]model.DocumentChunk, error) {
	// 使用默认选项
	options := defaultSplitOptions()
	return s.SplitChunkWithOptions(eid, chunkID, splitContents, userID, options)
}

// SplitChunkWithOptions 带选项的拆分分块
func (s *ChunkerService) SplitChunkWithOptions(eid int64, chunkID int64, splitContents []string, userID int64, options SplitChunkOptions) ([]model.DocumentChunk, error) {
	if len(splitContents) < 2 {
		return nil, fmt.Errorf("至少需要拆分为2个分块")
	}

	// 获取原分块
	var chunk model.DocumentChunk
	err := s.db.Where("eid = ? AND id = ?", eid, chunkID).First(&chunk).Error
	if err != nil {
		return nil, err
	}

	// 获取分块配置以验证拆分后的长度
	config, err := s.config.GetConfigWithFileID(eid, &chunk.LibraryID, &chunk.FileID)
	if err != nil {
		return nil, fmt.Errorf("获取分块配置失败: %v", err)
	}

	// 根据分块类型确定最大长度
	var maxLength int
	if chunk.ChunkType == "knowledge" {
		maxLength = config.KnowledgeMaxLength
	} else {
		maxLength = config.IndexMaxLength
	}

	// 验证拆分内容的长度
	for i, content := range splitContents {
		tokenCount, _ := s.tokenizer.CountTokens(content)
		if tokenCount > maxLength {
			return nil, fmt.Errorf("第%d个拆分内容超过最大长度限制(%d tokens)", i+1, maxLength)
		}
	}

	// 开启事务
	tx := s.db.Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	// 如果需要更新索引，先为后续分块腾出空间
	if options.UpdateIndexes {
		additionalChunks := len(splitContents) - 1 // 额外需要的分块数
		if additionalChunks > 0 {
			// 将后续分块的索引向后移动
			err = tx.Model(&model.DocumentChunk{}).
				Where("eid = ? AND file_id = ? AND chunk_index > ?", eid, chunk.FileID, chunk.ChunkIndex).
				Update("chunk_index", gorm.Expr("chunk_index + ?", additionalChunks)).Error
			if err != nil {
				tx.Rollback()
				return nil, err
			}
		}
	}

	// 创建新分块
	var newChunks []model.DocumentChunk

	for i, content := range splitContents {
		newChunk := model.DocumentChunk{
			Eid:            chunk.Eid,
			FileID:         chunk.FileID,
			LibraryID:      chunk.LibraryID,
			Content:        content,
			ChunkType:      chunk.ChunkType,
			StartPosition:  chunk.StartPosition,
			EndPosition:    chunk.EndPosition,
			Status:         "enabled",
			IsManualEdited: true,
		}

		// 设置分块索引
		if options.UpdateIndexes {
			newChunk.ChunkIndex = chunk.ChunkIndex + i
		} else {
			newChunk.ChunkIndex = chunk.ChunkIndex + i
		}

		// 设置向量化状态
		if options.ResetEmbedding {
			newChunk.EmbeddingStatus = model.DocumentChunkEmbeddingStatusPending
			newChunk.VectorID = ""
		} else {
			newChunk.EmbeddingStatus = chunk.EmbeddingStatus
			newChunk.VectorID = chunk.VectorID
		}

		// 重新计算Token数量
		newChunk.TokenCount, _ = s.tokenizer.CountTokens(content)

		// 生成新的内容哈希
		newChunk.ContentHash = newChunk.GenerateContentHash()

		if err := tx.Create(&newChunk).Error; err != nil {
			tx.Rollback()
			return nil, err
		}

		newChunks = append(newChunks, newChunk)
	}

	// 收集新分块ID用于检索块处理
	var newChunkIDs []int64
	for _, newChunk := range newChunks {
		newChunkIDs = append(newChunkIDs, newChunk.ID)
	}

	// 处理检索块的级联处理
	if err := s.handleRetrievalChunksForSplit(tx, eid, chunkID, newChunkIDs); err != nil {
		tx.Rollback()
		return nil, err
	}

	// 删除原分块
	if err := tx.Where("eid = ? AND id = ?", eid, chunkID).Delete(&model.DocumentChunk{}).Error; err != nil {
		tx.Rollback()
		return nil, err
	}

	// 提交事务
	if err := tx.Commit().Error; err != nil {
		return nil, err
	}

	// 记录操作日志（使用已收集的新分块ID）

	err = model.CreateSplitLog(eid, chunk.FileID, userID, chunkID, newChunkIDs)
	if err != nil {
		// 日志记录失败不影响主流程
		logger.Warn(context.TODO(), fmt.Sprintf("[splitLogCreateFail][chunkID=%d]%+v", chunkID, err))
	}

	return newChunks, nil
}

// createMergedChunk 创建合并后的分块
func (s *ChunkerService) createMergedChunk(chunks []model.DocumentChunk, content string, tokenCount int, options MergeChunksOptions) *model.DocumentChunk {
	mergedChunk := &model.DocumentChunk{
		Eid:            chunks[0].Eid,
		FileID:         chunks[0].FileID,
		LibraryID:      chunks[0].LibraryID,
		Content:        content,
		ChunkIndex:     chunks[0].ChunkIndex,
		ChunkType:      chunks[0].ChunkType,
		StartPosition:  chunks[0].StartPosition,
		EndPosition:    chunks[len(chunks)-1].EndPosition,
		TokenCount:     tokenCount,
		Status:         "enabled",
		IsManualEdited: true,
	}

	// 生成新的内容哈希
	mergedChunk.ContentHash = mergedChunk.GenerateContentHash()

	// 设置向量化状态
	if options.ResetEmbedding {
		mergedChunk.EmbeddingStatus = model.DocumentChunkEmbeddingStatusPending
		mergedChunk.VectorID = ""
	} else {
		mergedChunk.EmbeddingStatus = chunks[0].EmbeddingStatus
		mergedChunk.VectorID = chunks[0].VectorID
	}

	return mergedChunk
}

// updateChunkIndexes 更新分块索引
func (s *ChunkerService) updateChunkIndexes(tx *gorm.DB, eid int64, fileID int64, startIndex int) error {
	// 获取需要更新的分块（索引大于startIndex的分块）
	var chunksToUpdate []model.DocumentChunk
	err := tx.Where("eid = ? AND file_id = ? AND chunk_index > ?", eid, fileID, startIndex).
		Order("chunk_index asc").Find(&chunksToUpdate).Error
	if err != nil {
		return err
	}

	// 重新分配索引
	for i := range chunksToUpdate {
		newIndex := startIndex + i + 1
		err = tx.Model(&chunksToUpdate[i]).Update("chunk_index", newIndex).Error
		if err != nil {
			return err
		}
	}

	return nil
}

// handleRetrievalChunksForSplit 处理拆分操作中的检索块级联处理
func (s *ChunkerService) handleRetrievalChunksForSplit(tx *gorm.DB, eid int64, oldChunkID int64, newChunkIDs []int64) error {
	// 获取原知识点分块的所有检索块
	var retrievalChunks []model.RetrievalChunk
	err := tx.Where("eid = ? AND knowledge_chunk_id = ?", eid, oldChunkID).Find(&retrievalChunks).Error
	if err != nil {
		return fmt.Errorf("获取检索块失败: %v", err)
	}

	if len(retrievalChunks) == 0 {
		return nil // 没有检索块需要处理
	}

	// 删除原检索块
	err = tx.Where("eid = ? AND knowledge_chunk_id = ?", eid, oldChunkID).Delete(&model.RetrievalChunk{}).Error
	if err != nil {
		return fmt.Errorf("删除原检索块失败: %v", err)
	}

	// 为每个新的知识点分块重新创建检索块
	for _, newChunkID := range newChunkIDs {
		for _, retrievalChunk := range retrievalChunks {
			// 创建新的检索块
			newRetrievalChunk := model.RetrievalChunk{
				Eid:              retrievalChunk.Eid,
				FileID:           retrievalChunk.FileID,
				LibraryID:        retrievalChunk.LibraryID,
				KnowledgeChunkID: newChunkID,
				Content:          retrievalChunk.Content,
				ChunkIndex:       retrievalChunk.ChunkIndex,
				ChunkType:        retrievalChunk.ChunkType,
				StartPosition:    retrievalChunk.StartPosition,
				EndPosition:      retrievalChunk.EndPosition,
				TokenCount:       retrievalChunk.TokenCount,
				Status:           "enabled", // 重置状态
				IsManualEdited:   retrievalChunk.IsManualEdited,
				EmbeddingStatus:  model.RetrievalChunkEmbeddingStatusPending, // 重置向量化状态
				SearchKeywords:   retrievalChunk.SearchKeywords,
				SearchWeight:     retrievalChunk.SearchWeight,
			}

			err = tx.Create(&newRetrievalChunk).Error
			if err != nil {
				return fmt.Errorf("创建新检索块失败: %v", err)
			}
		}
	}

	// 删除原关联关系
	err = tx.Where("eid = ? AND knowledge_chunk_id = ?", eid, oldChunkID).Delete(&model.ChunkRelation{}).Error
	if err != nil {
		return fmt.Errorf("删除原关联关系失败: %v", err)
	}

	return nil
}

// handleRetrievalChunksForMerge 处理合并操作中的检索块级联更新
func (s *ChunkerService) handleRetrievalChunksForMerge(tx *gorm.DB, eid int64, oldChunkIDs []int64, newChunkID int64) error {
	// 更新所有关联的检索块，将它们指向新的知识点分块
	err := tx.Model(&model.RetrievalChunk{}).
		Where("eid = ? AND knowledge_chunk_id IN ?", eid, oldChunkIDs).
		Update("knowledge_chunk_id", newChunkID).Error
	if err != nil {
		return fmt.Errorf("更新检索块关联失败: %v", err)
	}

	// 更新关联关系中的知识点分块ID
	err = tx.Model(&model.ChunkRelation{}).
		Where("eid = ? AND knowledge_chunk_id IN ?", eid, oldChunkIDs).
		Update("knowledge_chunk_id", newChunkID).Error
	if err != nil {
		return fmt.Errorf("更新分块关联关系失败: %v", err)
	}

	return nil
}
