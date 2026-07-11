package rag

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// BatchUpdateSegments 批量更新段落 - 核心方法
func (s *ChunkerService) BatchUpdateSegments(eid int64, fileID int64, req BatchSegmentRequest) (*BatchSegmentResult, error) {
	// 获取文件信息
	var file model.File
	err := s.db.Where("eid = ? AND id = ?", eid, fileID).First(&file).Error
	if err != nil {
		return nil, fmt.Errorf("获取文件信息失败: %v", err)
	}

	// 直接执行批处理操作，不使用大事务包装
	result, err := s.processBatchOperationsWithoutTransaction(eid, fileID, file.LibraryID, req)
	if err != nil {
		return nil, fmt.Errorf("执行批量操作失败: %v", err)
	}

	// 触发后处理任务
	s.triggerBatchPostProcessingTasks(fileID, result)

	return result, nil
}

// processBatchOperationsWithoutTransaction 处理批处理操作，不使用大事务
// 使用Saga模式实现，将创建、更新、删除操作分离，每种操作在独立事务中执行，
// 并提供对应的补偿操作以保证最终一致性
func (s *ChunkerService) processBatchOperationsWithoutTransaction(eid int64, fileID int64, libraryID int64, req BatchSegmentRequest) (*BatchSegmentResult, error) {
	var deleteChunkIDs []string
	var addChunkIDs []string
	var splitInfos []SplitInfo
	var needReindexChunkIDs []string

	// 记录已创建的chunk IDs，用于补偿操作
	var createdChunks []int64
	// 记录已删除的chunk IDs，用于补偿操作
	var deletedChunks []restoreChunkInfo

	originPositionCounter := make(map[string]int) // 记录每个原始段落已添加的段落数

	// 第一阶段：解析操作
	for _, operation := range req.Operations {
		switch operation.Action {
		case "merge":
			// 合并操作：除了主段落外，其他都要删除
			for _, mergeID := range operation.MergeIdentifiers {
				if mergeID != operation.Identifier {
					deleteChunkIDs = append(deleteChunkIDs, mergeID)
				}
			}
		case "split":
			// 拆分操作：解析临时ID并排序
			tempIDStr := strings.Replace(operation.Identifier, "temp_", "", 1)
			index, err := strconv.Atoi(tempIDStr)
			if err != nil {
				return nil, fmt.Errorf("invalid temp identifier: %s", operation.Identifier)
			}
			splitInfos = append(splitInfos, SplitInfo{
				Index:            index,
				Identifier:       operation.Identifier,
				OriginIdentifier: operation.OriginIdentifier,
			})
		}
	}

	// 按index排序split操作
	sort.Slice(splitInfos, func(i, j int) bool {
		return splitInfos[i].Index < splitInfos[j].Index
	})

	// 第二阶段：删除段落（merge操作）- 提前执行删除操作以减少锁竞争
	if len(deleteChunkIDs) > 0 {
		deletedResult, err := s.processDeletionOperations(eid, fileID, req, deleteChunkIDs)
		if err != nil {
			// 执行补偿操作
			s.compensateDeletionOperations(eid, deletedResult.deletedChunks)
			return nil, fmt.Errorf("删除段落失败: %v", err)
		}
		deletedChunks = deletedResult.deletedChunks
	}

	// 第三阶段：创建新段落（split操作）
	if len(splitInfos) > 0 {
		createResult, err := s.processCreationOperations(eid, fileID, libraryID, req, splitInfos, originPositionCounter)
		if err != nil {
			// 执行补偿操作
			s.compensateCreationOperations(eid, createResult.createdChunks)
			// 删除操作已经成功执行，需要补偿
			s.compensateDeletionOperations(eid, deletedChunks)
			return nil, fmt.Errorf("创建段落失败: %v", err)
		}
		createdChunks = createResult.createdChunks
		addChunkIDs = createResult.addChunkIDs
		needReindexChunkIDs = append(needReindexChunkIDs, createResult.needReindexChunkIDs...)
	}

	// 第四阶段：更新现有段落
	updateResult, err := s.processUpdateOperations(eid, fileID, libraryID, req, addChunkIDs)
	if err != nil {
		// 执行补偿操作
		s.compensateUpdateOperations(eid, updateResult.updatedChunks, updateResult.originalChunks)
		// 创建操作已经成功执行，需要补偿
		s.compensateCreationOperations(eid, createdChunks)
		// 删除操作已经成功执行，需要补偿
		s.compensateDeletionOperations(eid, deletedChunks)
		return nil, fmt.Errorf("更新段落失败: %v", err)
	}
	needReindexChunkIDs = append(needReindexChunkIDs, updateResult.needReindexChunkIDs...)

	return &BatchSegmentResult{
		CreatedChunks: addChunkIDs,
		UpdatedChunks: s.removeDuplicateStrings(needReindexChunkIDs),
		DeletedChunks: deleteChunkIDs,
		TotalCount:    len(addChunkIDs) + len(needReindexChunkIDs) - len(deleteChunkIDs),
	}, nil
}

// deletionOperationResult 删除操作结果
type deletionOperationResult struct {
	deletedChunks []restoreChunkInfo
}

// processDeletionOperations 处理删除操作
func (s *ChunkerService) processDeletionOperations(eid int64, fileID int64, req BatchSegmentRequest, deleteChunkIDs []string) (*deletionOperationResult, error) {
	result := &deletionOperationResult{
		deletedChunks: make([]restoreChunkInfo, 0, len(deleteChunkIDs)),
	}

	// 保存删除前的信息用于补偿
	for _, chunkID := range deleteChunkIDs {
		restoreInfo, err := s.getRestoreInfoForChunk(eid, fileID, chunkID)
		if err != nil {
			return result, fmt.Errorf("获取段落信息失败: %v", err)
		}

		if err := s.deleteSegmentForBatchIndependent(eid, fileID, chunkID, req.UpdateRetrievalChunk); err != nil {
			return result, fmt.Errorf("删除段落失败: %v", err)
		}

		result.deletedChunks = append(result.deletedChunks, restoreInfo)
	}

	return result, nil
}

// compensateDeletionOperations 补偿删除操作
func (s *ChunkerService) compensateDeletionOperations(eid int64, deletedChunks []restoreChunkInfo) {
	if len(deletedChunks) == 0 {
		return
	}

	logger.Warn(context.TODO(), fmt.Sprintf("[compensateDeletionStart][count=%d]", len(deletedChunks)))
	s.compensateDeletedChunks(eid, deletedChunks)
	logger.Info(context.TODO(), fmt.Sprintf("[compensateDeletionDone][count=%d]", len(deletedChunks)))
}

// creationOperationResult 创建操作结果
type creationOperationResult struct {
	createdChunks       []int64
	addChunkIDs         []string
	needReindexChunkIDs []string
}

// processCreationOperations 处理创建操作
func (s *ChunkerService) processCreationOperations(eid int64, fileID int64, libraryID int64, req BatchSegmentRequest, splitInfos []SplitInfo, originPositionCounter map[string]int) (*creationOperationResult, error) {
	result := &creationOperationResult{
		createdChunks:       make([]int64, 0),
		addChunkIDs:         make([]string, 0),
		needReindexChunkIDs: make([]string, 0),
	}

	for _, splitInfo := range splitInfos {
		// 计算插入位置
		addIndex := originPositionCounter[splitInfo.OriginIdentifier] + 1
		originPositionCounter[splitInfo.OriginIdentifier] = addIndex

		contentUpdate, exists := req.ContentUpdates[splitInfo.Identifier]
		if !exists {
			return result, fmt.Errorf("content update not found for identifier: %s", splitInfo.Identifier)
		}

		chunkModel, err := s.addSegmentForBatchIndependent(eid, fileID, libraryID, splitInfo.OriginIdentifier, addIndex, contentUpdate, req.UpdateRetrievalChunk)
		if err != nil {
			return result, fmt.Errorf("创建段落失败: %v", err)
		}

		result.createdChunks = append(result.createdChunks, chunkModel.ID)
		result.addChunkIDs = append(result.addChunkIDs, fmt.Sprintf("%d", chunkModel.ID))
		result.needReindexChunkIDs = append(result.needReindexChunkIDs, fmt.Sprintf("%d", chunkModel.ID))
	}

	return result, nil
}

// compensateCreationOperations 补偿创建操作
func (s *ChunkerService) compensateCreationOperations(eid int64, createdChunks []int64) {
	if len(createdChunks) == 0 {
		return
	}

	logger.Warn(context.TODO(), fmt.Sprintf("[compensateCreationStart][count=%d]", len(createdChunks)))
	s.compensateCreatedChunks(eid, createdChunks)
	logger.Info(context.TODO(), fmt.Sprintf("[compensateCreationDone][count=%d]", len(createdChunks)))
}

// updateOperationResult 更新操作结果
type updateOperationResult struct {
	updatedChunks       []int64
	needReindexChunkIDs []string
	originalChunks      []restoreChunkInfo
}

// processUpdateOperations 处理更新操作
func (s *ChunkerService) processUpdateOperations(eid int64, fileID int64, libraryID int64, req BatchSegmentRequest, addChunkIDs []string) (*updateOperationResult, error) {
	result := &updateOperationResult{
		updatedChunks:       make([]int64, 0),
		needReindexChunkIDs: make([]string, 0),
		originalChunks:      make([]restoreChunkInfo, 0),
	}

	// 更新现有段落
	for identifier, contentUpdate := range req.ContentUpdates {
		// 跳过新创建的段落
		if contains(addChunkIDs, identifier) || strings.HasPrefix(identifier, "temp_") {
			continue
		}

		// 保存更新前的信息用于补偿
		restoreInfo, err := s.getRestoreInfoForChunk(eid, fileID, identifier)
		if err != nil {
			return result, fmt.Errorf("获取段落信息失败: %v", err)
		}

		chunkModel, err := s.updateSegmentForBatchIndependent(eid, fileID, libraryID, identifier, contentUpdate, req.UpdateRetrievalChunk)
		if err != nil {
			return result, fmt.Errorf("更新段落失败: %v", err)
		}

		result.updatedChunks = append(result.updatedChunks, chunkModel.ID)
		result.originalChunks = append(result.originalChunks, restoreInfo)
		result.needReindexChunkIDs = append(result.needReindexChunkIDs, fmt.Sprintf("%d", chunkModel.ID))
	}

	return result, nil
}

// compensateUpdateOperations 补偿更新操作
func (s *ChunkerService) compensateUpdateOperations(eid int64, updatedChunks []int64, originalChunks []restoreChunkInfo) {
	if len(originalChunks) == 0 {
		return
	}

	logger.Warn(context.TODO(), fmt.Sprintf("[compensateUpdateStart][count=%d]", len(originalChunks)))
	// 恢复已更新的段落到原来的状态
	s.compensateUpdatedChunks(eid, originalChunks)
	logger.Info(context.TODO(), fmt.Sprintf("[compensateUpdateDone][count=%d]", len(originalChunks)))
}

// restoreChunkInfo 用于保存段落恢复信息
type restoreChunkInfo struct {
	ChunkID         int64
	Content         string
	TokenCount      int
	ChunkIndex      int
	VectorID        string
	EmbeddingStatus string
	Status          string
}

// getRestoreInfoForChunk 获取段落恢复信息
func (s *ChunkerService) getRestoreInfoForChunk(eid int64, fileID int64, chunkID string) (restoreChunkInfo, error) {
	var info restoreChunkInfo

	id, err := strconv.ParseInt(chunkID, 10, 64)
	if err != nil {
		return info, err
	}

	var chunk model.DocumentChunk
	err = s.db.Where("eid = ? AND file_id = ? AND id = ?", eid, fileID, id).First(&chunk).Error
	if err != nil {
		// 如果找不到段落，可能是新建的段落，返回空信息
		return info, nil
	}

	info.ChunkID = chunk.ID
	info.Content = chunk.Content
	info.TokenCount = chunk.TokenCount
	info.ChunkIndex = chunk.ChunkIndex
	info.VectorID = chunk.VectorID
	info.EmbeddingStatus = chunk.EmbeddingStatus
	info.Status = chunk.Status

	return info, nil
}

// compensateDeletedChunks 补偿已删除的段落
func (s *ChunkerService) compensateDeletedChunks(eid int64, deletedChunks []restoreChunkInfo) {
	if len(deletedChunks) == 0 {
		return
	}

	logger.Warn(context.TODO(), fmt.Sprintf("[compensateDeletedStart][count=%d]", len(deletedChunks)))

	// 使用事务恢复所有已删除的分块
	err := s.db.Transaction(func(tx *gorm.DB) error {
		for _, restoreInfo := range deletedChunks {
			if restoreInfo.ChunkID == 0 {
				// 跳过无效的恢复信息
				continue
			}

			// 检查段落是否还存在
			var chunk model.DocumentChunk
			err := tx.Where("eid = ? AND id = ?", eid, restoreInfo.ChunkID).First(&chunk).Error
			if err == nil {
				// 段落仍然存在，更新其内容
				updates := map[string]interface{}{
					"content":          restoreInfo.Content,
					"token_count":      restoreInfo.TokenCount,
					"chunk_index":      restoreInfo.ChunkIndex,
					"vector_id":        restoreInfo.VectorID,
					"embedding_status": restoreInfo.EmbeddingStatus,
					"status":           restoreInfo.Status,
				}

				if err := tx.Model(&chunk).Updates(updates).Error; err != nil {
					logger.Warn(context.TODO(), fmt.Sprintf("[compensateUpdateChunkFail][chunkID=%d]%+v", restoreInfo.ChunkID, err))
					return err
				}
			} else {
				// 段落已被删除，重新创建
				chunk := &model.DocumentChunk{
					ID:              restoreInfo.ChunkID,
					Eid:             eid,
					Content:         restoreInfo.Content,
					TokenCount:      restoreInfo.TokenCount,
					ChunkIndex:      restoreInfo.ChunkIndex,
					VectorID:        restoreInfo.VectorID,
					EmbeddingStatus: restoreInfo.EmbeddingStatus,
					Status:          restoreInfo.Status,
				}

				if err := tx.Create(chunk).Error; err != nil {
					logger.Warn(context.TODO(), fmt.Sprintf("[compensateCreateChunkFail][chunkID=%d]%+v", restoreInfo.ChunkID, err))
					return err
				}
			}
		}
		return nil
	})

	if err != nil {
		logger.Error(context.TODO(), fmt.Sprintf("[compensateDeletedFailed]%+v", err))
	} else {
		logger.Info(context.TODO(), fmt.Sprintf("[compensateDeletedDone][count=%d]", len(deletedChunks)))
	}
}

// compensateUpdatedChunks 补偿已更新的段落
// 注意：此函数也用于补偿删除操作，因为deletedChunks参数包含了删除前和更新前的段落信息
func (s *ChunkerService) compensateUpdatedChunks(eid int64, updatedChunks []restoreChunkInfo) {
	if len(updatedChunks) == 0 {
		return
	}

	startTime := time.Now()
	totalCount := len(updatedChunks)
	successCount := 0
	failCount := 0

	logger.Warn(context.TODO(), fmt.Sprintf("[compensateUpdatedStart][count=%d]", totalCount))

	// 使用事务恢复所有已更新的分块到原始状态
	err := s.db.Transaction(func(tx *gorm.DB) error {
		for _, restoreInfo := range updatedChunks {
			if restoreInfo.ChunkID == 0 {
				// 跳过无效的恢复信息
				logger.Debug(context.TODO(), fmt.Sprintf("[compensateSkipInvalidChunk][chunkID=0]"))
				continue
			}

			// 检查段落是否存在
			var chunk model.DocumentChunk
			err := tx.Where("eid = ? AND id = ?", eid, restoreInfo.ChunkID).First(&chunk).Error
			if err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					// 段落不存在，跳过
					logger.Warn(context.TODO(), fmt.Sprintf("[compensateUpdateChunkNotFound][chunkID=%d]", restoreInfo.ChunkID))
				} else {
					// 数据库查询错误，应该返回错误终止事务
					logger.Error(context.TODO(), fmt.Sprintf("[compensateQueryChunkFail][chunkID=%d]%+v", restoreInfo.ChunkID, err))
					return err
				}
				continue
			}

			// 恢复段落到更新前的状态
			updates := map[string]interface{}{
				"content":          restoreInfo.Content,
				"token_count":      restoreInfo.TokenCount,
				"chunk_index":      restoreInfo.ChunkIndex,
				"vector_id":        restoreInfo.VectorID,
				"embedding_status": restoreInfo.EmbeddingStatus,
				"status":           restoreInfo.Status,
			}

			if err := tx.Model(&chunk).Updates(updates).Error; err != nil {
				logger.Warn(context.TODO(), fmt.Sprintf("[compensateUpdateChunkFail][chunkID=%d]%+v", restoreInfo.ChunkID, err))
				failCount++
				// 继续处理其他恢复操作而不是立即返回错误
				continue
			}

			successCount++
		}
		return nil
	})

	duration := time.Since(startTime).Milliseconds()
	if err != nil {
		logger.Error(context.TODO(), fmt.Sprintf("[compensateUpdatedPartialFailed][total=%d][success=%d][fail=%d][duration=%dms]%+v",
			totalCount, successCount, failCount, duration, err))
	} else if failCount > 0 {
		logger.Warn(context.TODO(), fmt.Sprintf("[compensateUpdatedPartialSuccess][total=%d][success=%d][fail=%d][duration=%dms]",
			totalCount, successCount, failCount, duration))
	} else {
		logger.Info(context.TODO(), fmt.Sprintf("[compensateUpdatedDone][count=%d][duration=%dms]", totalCount, duration))
	}
}

// addSegmentForBatch 为批量操作添加段落
func (s *ChunkerService) addSegmentForBatch(tx *gorm.DB, eid int64, fileID int64, libraryID int64, originIdentifier string, addIndex int, contentUpdate BatchContentUpdate, updateRetrievalChunk bool) (*model.DocumentChunk, error) {
	// 查找原始段落
	var originChunk model.DocumentChunk
	err := tx.Where("eid = ? AND file_id = ? AND id = ?", eid, fileID, originIdentifier).First(&originChunk).Error
	if err != nil {
		return nil, fmt.Errorf("origin chunk not found: %s", originIdentifier)
	}

	// 计算token数
	tokens, err := s.tokenizer.CountTokens(contentUpdate.Content)
	if err != nil {
		return nil, err
	}

	// 获取文件中所有的分块，按chunk_index排序，并对这些行加行级锁避免并发冲突
	var allChunks []model.DocumentChunk
	err = tx.Where("eid = ? AND file_id = ?", eid, fileID).
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Order("chunk_index ASC").
		Find(&allChunks).Error
	if err != nil {
		return nil, err
	}

	// 确定新分块的插入位置
	insertPosition := len(allChunks) // 默认插入到末尾

	// 查找originChunk在allChunks中的位置
	for i, chunk := range allChunks {
		if chunk.ID == originChunk.ID {
			// 插入位置是originChunk位置之后的第addIndex个位置
			insertPosition = i + addIndex
			break
		}
	}

	// 确保插入位置不会超出范围
	if insertPosition > len(allChunks) {
		insertPosition = len(allChunks)
	}
	if insertPosition < 0 {
		insertPosition = 0
	}

	// 计算所有分块的新索引（包括即将创建的新分块）
	// 先为现有分块分配新索引
	chunkIDToNewIndex := make(map[int64]int)
	for i, chunk := range allChunks {
		var newIndex int
		if i < insertPosition {
			// 插入位置之前的分块索引不变
			newIndex = i
		} else {
			// 插入位置及之后的分块索引都加1
			newIndex = i + 1
		}
		chunkIDToNewIndex[chunk.ID] = newIndex
	}

	// 新分块的索引就是插入位置
	newChunkIndex := insertPosition

	// 两阶段索引重排，避免 (eid,file_id,chunk_index) 唯一约束的过渡冲突
	const indexOffset = 1000000

	// 收集受影响的所有分块ID
	affectedIDs := make([]int64, 0, len(allChunks))
	for i := range allChunks {
		affectedIDs = append(affectedIDs, allChunks[i].ID)
	}

	// 第一步：将受影响的现有分块索引统一加上偏移，腾出目标区间
	if len(affectedIDs) > 0 {
		if err := tx.Model(&model.DocumentChunk{}).
			Where("id IN ?", affectedIDs).
			Update("chunk_index", gorm.Expr("chunk_index + ?", indexOffset)).Error; err != nil {
			return nil, fmt.Errorf("阶段1：批量偏移分块索引失败: %v", err)
		}
	}

	// 第二步：将受影响的现有分块索引设置为最终目标索引（现在目标区间为空，不会触发唯一约束）
	for i := range allChunks {
		chunk := &allChunks[i]
		finalIndex := chunkIDToNewIndex[chunk.ID]
		if err := tx.Model(&model.DocumentChunk{}).
			Where("id = ?", chunk.ID).
			Update("chunk_index", finalIndex).Error; err != nil {
			return nil, fmt.Errorf("阶段2：设置最终分块索引失败 (ID: %d): %v", chunk.ID, err)
		}
	}

	// 创建新段落，使用已计算好的索引
	newChunk := &model.DocumentChunk{
		Eid:           eid,
		FileID:        fileID,
		LibraryID:     libraryID,
		Content:       contentUpdate.Content,
		ChunkIndex:    newChunkIndex,
		ChunkType:     originChunk.ChunkType,
		StartPosition: originChunk.StartPosition,
		EndPosition:   originChunk.EndPosition,
		TokenCount:    tokens,
		Status:        "enabled",
	}

	// 根据是否需要更新检索块来设置EmbeddingStatus
	if !updateRetrievalChunk {
		newChunk.EmbeddingStatus = model.DocumentChunkEmbeddingStatusNormal
	} else {
		newChunk.EmbeddingStatus = model.DocumentChunkEmbeddingStatusPending
	}

	// 生成内容哈希
	newChunk.ContentHash = newChunk.GenerateContentHash()

	// 处理附加内容 - 注意：当前模型不支持AppendContent字段
	// 如果需要支持，需要在DocumentChunk模型中添加该字段
	if len(contentUpdate.AppendContent) > 0 {
		// 暂时将附加内容合并到主内容中
		for _, appendText := range contentUpdate.AppendContent {
			newChunk.Content += "\n\n" + appendText
		}
		// 重新计算token数
		newChunk.TokenCount, _ = s.tokenizer.CountTokens(newChunk.Content)
	}

	// 现在创建新分块，使用已分配好的索引
	if err := tx.Create(newChunk).Error; err != nil {
		return nil, err
	}

	// 根据参数决定是否创建检索块
	if updateRetrievalChunk {
		if err := s.createRetrievalChunksForUpdatedKnowledge(tx, eid, newChunk); err != nil {
			return nil, fmt.Errorf("创建检索块失败: %v", err)
		}
	}

	return newChunk, nil
}

// updateSegmentForBatch 为批量操作更新段落
func (s *ChunkerService) updateSegmentForBatch(tx *gorm.DB, eid int64, fileID int64, libraryID int64, chunkID string, contentUpdate BatchContentUpdate, updateRetrievalChunk bool) (*model.DocumentChunk, error) {
	var chunk model.DocumentChunk
	err := tx.Where("eid = ? AND file_id = ? AND id = ?", eid, fileID, chunkID).First(&chunk).Error
	if err != nil {
		return nil, fmt.Errorf("chunk not found: %s", chunkID)
	}

	// 计算新的token数
	tokens, err := s.tokenizer.CountTokens(contentUpdate.Content)
	if err != nil {
		return nil, err
	}

	// 更新段落
	embeddingStatus := model.DocumentChunkEmbeddingStatusPending
	if !updateRetrievalChunk {
		embeddingStatus = model.DocumentChunkEmbeddingStatusNormal
	}

	updates := map[string]interface{}{
		"content":          contentUpdate.Content,
		"token_count":      tokens,
		"embedding_status": embeddingStatus,
		"status":           "enabled",
	}

	// 处理附加内容 - 注意：当前模型不支持AppendContent字段
	if len(contentUpdate.AppendContent) > 0 {
		// 暂时将附加内容合并到主内容中
		for _, appendText := range contentUpdate.AppendContent {
			contentUpdate.Content += "\n\n" + appendText
		}
		// 重新计算token数
		tokens, _ = s.tokenizer.CountTokens(contentUpdate.Content)
		updates["content"] = contentUpdate.Content
		updates["token_count"] = tokens
	}

	// 重新生成内容哈希
	chunk.Content = contentUpdate.Content
	updates["content_hash"] = chunk.GenerateContentHash()

	if err := tx.Model(&chunk).Updates(updates).Error; err != nil {
		return nil, err
	}

	// 根据参数决定是否更新检索块
	if updateRetrievalChunk {
		// 删除旧的检索块 - 添加重试机制
		maxRetries := 3
		var deleteErr error
		for i := 0; i < maxRetries; i++ {
			deleteErr = s.deleteRetrievalChunksByKnowledgeID(tx, eid, chunk.ID)
			if deleteErr == nil {
				break
			}

			// 检查是否是锁等待超时或死锁错误，进行重试
			errMsg := deleteErr.Error()
			if strings.Contains(errMsg, "Deadlock") || strings.Contains(errMsg, "deadlock") ||
				strings.Contains(errMsg, "Lock wait timeout") || strings.Contains(errMsg, "1205") ||
				strings.Contains(errMsg, "deadlock detected") || strings.Contains(errMsg, "could not obtain lock") ||
				strings.Contains(errMsg, "lock timeout") {
				if i < maxRetries-1 {
					// 使用指数退避 + 抖动进行重试
					waitTime := calculateBackoff(i)
					time.Sleep(waitTime)
					continue
				}
			}
			// 非锁相关错误或重试次数用尽
			break
		}

		if deleteErr != nil {
			return nil, fmt.Errorf("删除旧检索块失败: %v", deleteErr)
		}

		// 重新创建检索块
		if err := s.createRetrievalChunksForUpdatedKnowledge(tx, eid, &chunk); err != nil {
			return nil, fmt.Errorf("重新创建检索块失败: %v", err)
		}
	}

	return &chunk, nil
}

// deleteSegmentForBatch 为批量操作删除段落
func (s *ChunkerService) deleteSegmentForBatch(tx *gorm.DB, eid int64, fileID int64, chunkID string, updateRetrievalChunk bool) error {
	var chunk model.DocumentChunk
	err := tx.Where("eid = ? AND file_id = ? AND id = ?", eid, fileID, chunkID).First(&chunk).Error
	if err != nil {
		return fmt.Errorf("chunk not found: %s", chunkID)
	}

	// 根据参数决定是否删除关联的检索块
	if updateRetrievalChunk {
		// 删除关联的检索块
		if err := s.deleteRetrievalChunksByKnowledgeID(tx, eid, chunk.ID); err != nil {
			return fmt.Errorf("删除检索块失败: %v", err)
		}

		// 删除向量数据库中的向量
		if chunk.VectorID != "" {
			if err := s.DeleteVectorFromDB(eid, chunk.LibraryID, chunk.VectorID); err != nil {
				// 向量删除失败不阻断流程，但记录日志
				logger.Warn(context.TODO(), fmt.Sprintf("[deleteVectorFail][vectorID=%s]%+v", chunk.VectorID, err))
			}
		}
	}

	// 删除文档分块
	if err := tx.Delete(&chunk).Error; err != nil {
		return fmt.Errorf("删除文档分块失败: %v", err)
	}

	return nil
}

// triggerBatchPostProcessingTasks 触发批量操作后处理任务
func (s *ChunkerService) triggerBatchPostProcessingTasks(fileID int64, result *BatchSegmentResult) {
	logger.Info(context.TODO(), fmt.Sprintf("[batchPostStart][fileID=%d][created=%d][updated=%d][deleted=%d]", fileID, len(result.CreatedChunks), len(result.UpdatedChunks), len(result.DeletedChunks)))

	// 1. 触发embedding处理任务
	s.triggerEmbeddingTasks(fileID, result)

	// 2. 更新文件统计信息
	s.updateFileStatistics(fileID)

	// 3. 发布批量操作事件
	s.publishBatchOperationEvents(fileID, result)

	// 4. 清理无效的向量数据
	// 注意：向量清理应该在删除操作中完成，这里只是记录
	if len(result.DeletedChunks) > 0 {
		logger.Info(context.TODO(), fmt.Sprintf("[batchPostDeleted][count=%d]", len(result.DeletedChunks)))
	}

	logger.Info(context.TODO(), fmt.Sprintf("[batchPostDone][fileID=%d]", fileID))
}

// removeDuplicateStrings 去除字符串切片中的重复项
func (s *ChunkerService) removeDuplicateStrings(slice []string) []string {
	keys := make(map[string]bool)
	var result []string
	for _, item := range slice {
		if !keys[item] {
			keys[item] = true
			result = append(result, item)
		}
	}
	return result
}

// deleteSegmentForBatchIndependent 独立事务删除段落
func (s *ChunkerService) deleteSegmentForBatchIndependent(eid int64, fileID int64, chunkID string, updateRetrievalChunk bool) error {
	return s.db.Transaction(func(tx *gorm.DB) error {
		return s.deleteSegmentForBatch(tx, eid, fileID, chunkID, updateRetrievalChunk)
	})
}

// addSegmentForBatchIndependent 独立事务添加段落
func (s *ChunkerService) addSegmentForBatchIndependent(eid int64, fileID int64, libraryID int64, originIdentifier string, addIndex int, contentUpdate BatchContentUpdate, updateRetrievalChunk bool) (*model.DocumentChunk, error) {
	var result *model.DocumentChunk
	err := s.db.Transaction(func(tx *gorm.DB) error {
		var err error
		result, err = s.addSegmentForBatch(tx, eid, fileID, libraryID, originIdentifier, addIndex, contentUpdate, updateRetrievalChunk)
		return err
	})
	return result, err
}

// updateSegmentForBatchIndependent 独立事务更新段落
func (s *ChunkerService) updateSegmentForBatchIndependent(eid int64, fileID int64, libraryID int64, chunkID string, contentUpdate BatchContentUpdate, updateRetrievalChunk bool) (*model.DocumentChunk, error) {
	var result *model.DocumentChunk
	err := s.db.Transaction(func(tx *gorm.DB) error {
		var err error
		result, err = s.updateSegmentForBatch(tx, eid, fileID, libraryID, chunkID, contentUpdate, updateRetrievalChunk)
		return err
	})
	return result, err
}

// compensateCreatedChunks 补偿已创建的分块
func (s *ChunkerService) compensateCreatedChunks(eid int64, createdChunks []int64) {
	if len(createdChunks) == 0 {
		return
	}

	logger.Warn(context.TODO(), fmt.Sprintf("[compensationStart][count=%d]", len(createdChunks)))

	// 使用事务删除所有已创建的分块
	err := s.db.Transaction(func(tx *gorm.DB) error {
		for _, chunkID := range createdChunks {
			var chunk model.DocumentChunk
			if err := tx.Where("eid = ? AND id = ?", eid, chunkID).First(&chunk).Error; err != nil {
				continue
			}

			// 删除关联的检索块
			if err := s.deleteRetrievalChunksByKnowledgeID(tx, eid, chunk.ID); err != nil {
				logger.Warn(context.TODO(), fmt.Sprintf("[compensationDeleteRetrievalFail][chunkID=%d]%+v", chunk.ID, err))
				return err
			}

			// 删除向量数据
			if chunk.VectorID != "" {
				if err := s.DeleteVectorFromDB(eid, chunk.LibraryID, chunk.VectorID); err != nil {
					logger.Warn(context.TODO(), fmt.Sprintf("[compensationDeleteVectorFail][vectorID=%s]%+v", chunk.VectorID, err))
					// 向量删除失败不阻断流程，继续执行
				}
			}

			// 删除文档分块
			if err := tx.Delete(&chunk).Error; err != nil {
				logger.Warn(context.TODO(), fmt.Sprintf("[compensationDeleteChunkFail][chunkID=%d]%+v", chunk.ID, err))
				return err
			}
		}
		return nil
	})

	if err != nil {
		logger.Error(context.TODO(), fmt.Sprintf("[compensationFailed]%+v", err))
	} else {
		logger.Info(context.TODO(), fmt.Sprintf("[compensationDone][count=%d]", len(createdChunks)))
	}
}

// triggerEmbeddingTasks 触发embedding处理任务
func (s *ChunkerService) triggerEmbeddingTasks(fileID int64, result *BatchSegmentResult) {
	// 获取文件信息以获取eid和libraryID
	var file model.File
	err := s.db.Where("id = ?", fileID).First(&file).Error
	if err != nil {
		logger.Warn(context.TODO(), fmt.Sprintf("[embGetFileFail][fileID=%d]%+v", fileID, err))
		return
	}

	// 收集需要处理embedding的文档分块ID
	var docChunkIDs []int64

	// 新创建的分块需要embedding
	for _, chunkIDStr := range result.CreatedChunks {
		if chunkID, err := strconv.ParseInt(chunkIDStr, 10, 64); err == nil {
			docChunkIDs = append(docChunkIDs, chunkID)
		}
	}

	// 更新的分块也需要重新embedding
	for _, chunkIDStr := range result.UpdatedChunks {
		if chunkID, err := strconv.ParseInt(chunkIDStr, 10, 64); err == nil {
			docChunkIDs = append(docChunkIDs, chunkID)
		}
	}

	if len(docChunkIDs) > 0 {
		// 获取这些文档分块对应的检索块
		var retrievalChunks []model.RetrievalChunk
		err := s.db.Where("eid = ? AND file_id = ? AND knowledge_chunk_id IN ?", file.Eid, fileID, docChunkIDs).
			Find(&retrievalChunks).Error
		if err != nil {
			logger.Warn(context.TODO(), fmt.Sprintf("[embGetRetrievalFail][fileID=%d]%+v", fileID, err))
			return
		}

		if len(retrievalChunks) > 0 {
			// 改为入队由队列消费
			successCount := 0
			for _, chunk := range retrievalChunks {
				EnqueueRetrievalChunk(file.Eid, fileID, file.LibraryID, chunk.ID)
				successCount++
			}
			logger.Info(context.TODO(), fmt.Sprintf("[embBatchEnqueueDone][fileID=%d][enqueued=%d][total=%d]", fileID, successCount, len(retrievalChunks)))

			// 更新文档分块状态基于检索块的状态
			processedKnowledgeChunkIDs := make(map[int64]bool)
			for _, chunk := range retrievalChunks {
				processedKnowledgeChunkIDs[chunk.KnowledgeChunkID] = true
			}

			// 确保所有相关的DocumentChunk状态都被更新
			for knowledgeChunkID := range processedKnowledgeChunkIDs {
				s.updateDocumentChunkStatusBasedOnRetrievalChunks(file.Eid, knowledgeChunkID)
			}
		} else {
			logger.Info(context.TODO(), fmt.Sprintf("[embNoRetrieval][fileID=%d][docChunks=%d]", fileID, len(docChunkIDs)))

			// 即使没有检索块，也需要更新文档分块状态
			for _, docChunkID := range docChunkIDs {
				// 如果文档分块没有对应的检索块，且UpdateRetrievalChunk为false，则状态应为completed
				err := model.UpdateChunkEmbeddingStatus(file.Eid, docChunkID, model.DocumentChunkEmbeddingStatusNormal, "")
				if err != nil {
					logger.Warn(context.TODO(), fmt.Sprintf("[updateChunkStatusCompleteFail][chunkID=%d]%+v", docChunkID, err))
				}
			}
		}
	}
}

// updateDocumentChunkStatusBasedOnRetrievalChunks 根据检索块状态更新文档分块状态
func (s *ChunkerService) updateDocumentChunkStatusBasedOnRetrievalChunks(eid, knowledgeChunkID int64) {
	// 获取与该DocumentChunk关联的所有检索块
	retrievalChunks, err := model.GetRetrievalChunksByKnowledgeID(eid, knowledgeChunkID)
	if err != nil {
		logger.Warn(context.TODO(), fmt.Sprintf("[getRetrievalByKnowledgeFail][knowledgeChunkID=%d]%+v", knowledgeChunkID, err))
		return
	}

	if len(retrievalChunks) == 0 {
		// 如果没有检索块，将文档分块状态设置为completed
		err := model.UpdateChunkEmbeddingStatus(eid, knowledgeChunkID, model.DocumentChunkEmbeddingStatusNormal, "")
		if err != nil {
			logger.Warn(context.TODO(), fmt.Sprintf("[updateKnowledgeCompleteFail][knowledgeChunkID=%d]%+v", knowledgeChunkID, err))
		}
		return
	}

	allSucceeded := true
	hasFailed := false
	hasIndexing := false

	for _, rc := range retrievalChunks {
		switch {
		case rc.EmbeddingStatus == model.RetrievalChunkEmbeddingStatusFailed:
			hasFailed = true
			allSucceeded = false
		case model.IsRetrievalChunkEmbeddingSucceeded(rc.EmbeddingStatus):
			// success
		case rc.EmbeddingStatus == model.RetrievalChunkEmbeddingStatusIndexing:
			allSucceeded = false
			hasIndexing = true
		default:
			allSucceeded = false
		}

		if hasFailed {
			break
		}
	}

	var newStatus string
	switch {
	case hasFailed:
		newStatus = model.DocumentChunkEmbeddingStatusFailed
	case allSucceeded:
		newStatus = model.DocumentChunkEmbeddingStatusNormal
	case hasIndexing:
		newStatus = model.DocumentChunkEmbeddingStatusIndexing
	default:
		newStatus = model.DocumentChunkEmbeddingStatusPending
	}

	err = model.UpdateChunkEmbeddingStatus(eid, knowledgeChunkID, newStatus, "")
	if err != nil {
		logger.Warn(context.TODO(), fmt.Sprintf("[updateKnowledgeEmbeddingStatusFail][knowledgeChunkID=%d]%+v", knowledgeChunkID, err))
	}
}

// updateFileStatistics 更新文件统计信息
func (s *ChunkerService) updateFileStatistics(fileID int64) {
	// 获取文件信息
	var file model.File
	err := s.db.Where("id = ?", fileID).First(&file).Error
	if err != nil {
		logger.Warn(context.TODO(), fmt.Sprintf("[statsGetFileFail][fileID=%d]%+v", fileID, err))
		return
	}

	// 更新文档分块统计
	var docChunkCount int64
	var totalTokens int64

	err = s.db.Model(&model.DocumentChunk{}).
		Where("eid = ? AND file_id = ?", file.Eid, fileID).
		Count(&docChunkCount).Error
	if err != nil {
		logger.Warn(context.TODO(), fmt.Sprintf("[statsCountDocChunksFail][fileID=%d]%+v", fileID, err))
		return
	}

	err = s.db.Model(&model.DocumentChunk{}).
		Where("eid = ? AND file_id = ?", file.Eid, fileID).
		Select("COALESCE(SUM(token_count), 0)").
		Scan(&totalTokens).Error
	if err != nil {
		logger.Warn(context.TODO(), fmt.Sprintf("[statsSumTokensFail][fileID=%d]%+v", fileID, err))
		return
	}

	// 更新检索块统计
	var retrievalChunkCount int64
	err = s.db.Model(&model.RetrievalChunk{}).
		Where("eid = ? AND file_id = ?", file.Eid, fileID).
		Count(&retrievalChunkCount).Error
	if err != nil {
		logger.Warn(context.TODO(), fmt.Sprintf("[statsCountRetrievalFail][fileID=%d]%+v", fileID, err))
		return
	}

	logger.Info(context.TODO(), fmt.Sprintf("[statsDone][fileID=%d][docChunks=%d][retrievalChunks=%d][totalTokens=%d]", fileID, docChunkCount, retrievalChunkCount, totalTokens))
}

// publishBatchOperationEvents 发布批量操作事件
func (s *ChunkerService) publishBatchOperationEvents(fileID int64, result *BatchSegmentResult) {
	// 获取文件信息
	var file model.File
	err := s.db.Where("id = ?", fileID).First(&file).Error
	if err != nil {
		logger.Warn(context.TODO(), fmt.Sprintf("[eventGetFileFail][fileID=%d]%+v", fileID, err))
		return
	}

	// 记录批量操作日志
	err = s.createBatchOperationLog(file.Eid, fileID, 0, result)
	if err != nil {
		logger.Warn(context.TODO(), fmt.Sprintf("[eventCreateOpLogFail][fileID=%d]%+v", fileID, err))
	}

	logger.Info(context.TODO(), fmt.Sprintf("[eventPublished][fileID=%d]", fileID))
}

// createBatchOperationLog 创建批量操作日志
func (s *ChunkerService) createBatchOperationLog(eid int64, fileID int64, userID int64, result *BatchSegmentResult) error {
	// 构建操作详情
	details := map[string]interface{}{
		"created_count":  len(result.CreatedChunks),
		"updated_count":  len(result.UpdatedChunks),
		"deleted_count":  len(result.DeletedChunks),
		"total_count":    result.TotalCount,
		"created_chunks": result.CreatedChunks,
		"updated_chunks": result.UpdatedChunks,
		"deleted_chunks": result.DeletedChunks,
		"operation_time": time.Now().UTC().UnixMilli(),
	}

	// 创建操作日志
	log := &model.ChunkOperationLog{
		Eid:           eid,
		FileID:        fileID,
		UserID:        userID,
		OperationType: "batch_operation",
	}

	// 设置操作数据
	operationData := &model.OperationData{
		Description: "批量分块操作",
		Details:     details,
	}

	if err := log.SetOperationData(operationData); err != nil {
		return fmt.Errorf("设置操作数据失败: %v", err)
	}

	// 设置受影响的分块 - 转换字符串ID为int64
	var affectedChunks model.AffectedChunksData

	// 收集所有受影响的分块ID
	allChunkIDs := make([]string, 0)
	allChunkIDs = append(allChunkIDs, result.CreatedChunks...)
	allChunkIDs = append(allChunkIDs, result.UpdatedChunks...)
	allChunkIDs = append(allChunkIDs, result.DeletedChunks...)

	// 转换为int64
	for _, chunkIDStr := range allChunkIDs {
		if chunkID, err := strconv.ParseInt(chunkIDStr, 10, 64); err == nil {
			affectedChunks = append(affectedChunks, chunkID)
		}
	}

	if err := log.SetAffectedChunks(affectedChunks); err != nil {
		return fmt.Errorf("设置受影响分块失败: %v", err)
	}

	// 保存日志
	return log.Save()
}
