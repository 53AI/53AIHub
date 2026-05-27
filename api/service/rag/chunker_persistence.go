package rag

import (
	"context"
	"fmt"
	"math"
	"math/rand/v2"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

// SaveChunks 保存分块到数据库 - 优化版本，支持智能更新
func (s *ChunkerService) SaveChunks(eid int64, fileID int64, chunks []DocumentChunk) error {
	if len(chunks) == 0 {
		return nil
	}

	var file model.File
	err := s.db.Where("eid = ? AND id = ?", eid, fileID).First(&file).Error
	if err != nil {
		return fmt.Errorf("获取文件信息失败: %v", err)
	}

	// 在保存前尝试获取 embedding 配置；若未配置则将本次所有新建分块的 embedding_status 置为 failed
	forceEmbeddingFailed := false
	{
		configService := NewChunkConfigService(s.db)
		if cfg, cerr := configService.GetConfigWithFileID(eid, &file.LibraryID, &fileID); cerr != nil {
			// 仅当明确为“未配置向量化渠道”时降级到 failed，其它错误保持原逻辑（不强制 failed）
			if cfg == nil || cfg.EmbeddingChannelID == nil {
				forceEmbeddingFailed = true
				logger.Warn(context.TODO(), fmt.Sprintf("[embeddingConfigMissing][eid=%d][fileID=%d] 未配置向量化渠道，本次创建的检索/文档分块将标记为 failed", eid, fileID))
			} else {
				logger.Warn(context.TODO(), fmt.Sprintf("[embeddingConfigCheckError][eid=%d][fileID=%d] err=%v", eid, fileID, cerr))
			}
		} else {
			_ = cfg // 配置存在时无需特殊处理
		}
	}

	// 日志记录并保持原有优化保存入口（无法改其签名），若其内部无法设置 failed，则由 fallback/事务路径保证
	ctx := context.TODO()
	logger.Info(ctx, fmt.Sprintf("[saveOptimizedStart][fileID=%d][chunks=%d][embFailed=%v]", fileID, len(chunks), forceEmbeddingFailed))

	// 使用优化的分块保存方案（保留原函数）
	err = OptimizedSaveChunks(eid, file, fileID, chunks)
	if err != nil {
		logger.Warn(ctx, fmt.Sprintf("[saveOptimizedFailFallback][fileID=%d]%+v", fileID, err))

		// 降级到传统方法（此处我们已在 legacy 路径按 forceEmbeddingFailed 处理）
		err = s.saveChunksLegacy(eid, fileID, chunks)
	}

	if err != nil {
		_ = model.UpdateFileParsingStatus(fileID, model.FileParsingStatusFail)
		return fmt.Errorf("保存分块失败: %v", err)
	}
	_ = model.UpdateFileParsingStatus(fileID, model.FileParsingStatusNormal)

	logger.Info(ctx, fmt.Sprintf("[saveOptimizedDone][count=%d]", len(chunks)))
	return nil
}

// SaveChunksInTransaction 在事务中保存分块
func (s *ChunkerService) SaveChunksInTransaction(tx *gorm.DB, eid int64, fileID int64, chunks []DocumentChunk) ([]model.DocumentChunk, error) {
	if len(chunks) == 0 {
		return []model.DocumentChunk{}, nil
	}

	var file model.File
	err := tx.Where("eid = ? AND id = ?", eid, fileID).First(&file).Error
	if err != nil {
		return nil, fmt.Errorf("获取文件信息失败: %v", err)
	}

	// 事务场景下同样尝试获取 embedding 配置并决定是否强制 failed
	forceEmbeddingFailed := false
	{
		configService := NewChunkConfigService(tx)
		if cfg, cerr := configService.GetConfigWithFileID(eid, &file.LibraryID, &fileID); cerr != nil {
			if cfg == nil || cfg.EmbeddingChannelID == nil {
				forceEmbeddingFailed = true
				logger.Warn(context.TODO(), fmt.Sprintf("[txEmbeddingConfigMissing][eid=%d][fileID=%d] 未配置向量化渠道，本次在事务中创建的分块将标记为 failed", eid, fileID))
			} else {
				logger.Warn(context.TODO(), fmt.Sprintf("[txEmbeddingConfigCheckError][eid=%d][fileID=%d] err=%v", eid, fileID, cerr))
			}
		}
	}

	logger.Info(context.TODO(), fmt.Sprintf("[txSaveStart][fileID=%d][chunks=%d][embFailed=%v]", fileID, len(chunks), forceEmbeddingFailed))

	// 使用传入的事务数据库连接创建 ChunkSaver 实例（确保 cs.db == tx）
	chunkSaver := NewChunkSaver(tx)

	// 转换为model.DocumentChunk类型
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
			ContentHash:     "",                  // 将在实际保存时生成
			ChunkConfigID:   chunk.ChunkConfigID, // 确保ChunkConfigID被保存到数据库中
		}
	}

	// 强制在传入的事务 tx 上同步保存，避免 SaveChunks 可能走异步/脱离事务的策略
	// 优先尝试批量在 tx 上保存，失败时回退到逐条同步保存
	if err := chunkSaver.saveChunksBatchOn(tx, eid, fileID, modelChunks); err != nil {
		logger.Warn(context.TODO(), fmt.Sprintf("[txBatchSaveFailFallback][fileID=%d]%+v", fileID, err))
		if derr := chunkSaver.SaveChunksDirect(eid, fileID, modelChunks); derr != nil {
			logger.Error(context.TODO(), fmt.Sprintf("[txDirectSaveFail][fileID=%d][err1=%+v][err2=%+v]", fileID, err, derr))
			return nil, fmt.Errorf("在事务中保存新分块失败: %v; fallback err: %v", err, derr)
		}
	}

	// 查询并返回刚刚在事务中保存的 DocumentChunk（使用 tx 确保可见性）
	var savedDocs []model.DocumentChunk
	if err := tx.Where("eid = ? AND file_id = ?", eid, fileID).Order("chunk_index asc").Find(&savedDocs).Error; err != nil {
		logger.Warn(context.TODO(), fmt.Sprintf("[txFindSavedChunksFail][fileID=%d]%+v", fileID, err))
		return nil, err
	}

	logger.Info(context.TODO(), fmt.Sprintf("[txSaveDone][count=%d]", len(savedDocs)))
	return savedDocs, nil
}

// saveChunksLegacy 传统的分块保存方法（作为降级方案）
func (s *ChunkerService) saveChunksLegacy(eid int64, fileID int64, chunks []DocumentChunk) error {
	if len(chunks) == 0 {
		return nil
	}

	// 在传统路径中同样检查 embedding 配置
	forceEmbeddingFailed := false
	var file model.File
	if err := s.db.Where("eid = ? AND id = ?", eid, fileID).First(&file).Error; err != nil {
		return fmt.Errorf("获取文件信息失败: %v", err)
	}
	{
		configService := NewChunkConfigService(s.db)
		if cfg, cerr := configService.GetConfigWithFileID(eid, &file.LibraryID, &fileID); cerr != nil {
			if cfg == nil || cfg.EmbeddingChannelID == nil {
				forceEmbeddingFailed = true
				logger.Warn(context.TODO(), fmt.Sprintf("[legacyEmbeddingConfigMissing][eid=%d][fileID=%d] 未配置向量化渠道，本次创建的分块将标记为 failed", eid, fileID))
			} else {
				logger.Warn(context.TODO(), fmt.Sprintf("[legacyEmbeddingConfigCheckError][eid=%d][fileID=%d] err=%v", eid, fileID, cerr))
			}
		}
	}

	logger.Info(context.TODO(), fmt.Sprintf("[legacySaveStart][fileID=%d][chunks=%d][embFailed=%v]", fileID, len(chunks), forceEmbeddingFailed))

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
			ChunkConfigID:   chunk.ChunkConfigID, // 确保ChunkConfigID被保存到数据库中
		}
		// 生成内容哈希
		modelChunks[i].ContentHash = modelChunks[i].GenerateContentHash()
	}

	// 批量创建分块
	err := model.BatchCreateDocumentChunks(modelChunks)
	if err != nil {
		return fmt.Errorf("批量创建分块失败: %v", err)
	}

	logger.Info(context.TODO(), fmt.Sprintf("[legacySaveDone][count=%d]", len(chunks)))
	return nil
}

// calculateBackoff 计算指数退避时间，包含随机抖动
func calculateBackoff(attempt int) time.Duration {
	baseDelay := time.Millisecond * 100
	maxDelay := time.Second * 5

	delay := time.Duration(float64(baseDelay) * math.Pow(2, float64(attempt)))
	if delay > maxDelay {
		delay = maxDelay
	}

	// 添加随机抖动 (±25%)
	jitter := time.Duration(float64(delay) * 0.25 * (rand.Float64()*2 - 1))
	return delay + jitter
}

// createRetrievalChunksForUpdatedKnowledge 为更新的知识点分块创建检索块
func (s *ChunkerService) createRetrievalChunksForUpdatedKnowledge(tx *gorm.DB, eid int64, knowledgeChunk *model.DocumentChunk) error {
	// 获取分块配置
	config, err := s.config.GetConfigWithFileID(eid, &knowledgeChunk.LibraryID, &knowledgeChunk.FileID)
	if err != nil {
		// 使用默认配置
		config = &ChunkConfig{
			IndexChunk: model.IndexChunkingConfig{
				SplitRule:       "\n\n",
				MaxLength:       2000,
				OverlapSize:     100,
				IncludeTitle:    false,
				IncludeFileName: false,
			},
			IndexMaxLength:   2000,
			IndexOverlapSize: 100,
		}
	}

	// 创建检索块服务
	retrievalService := NewRetrievalChunkService(tx)

	// 为知识点分块创建检索块
	retrievalChunks, err := retrievalService.CreateRetrievalChunksForKnowledge(eid, knowledgeChunk, config)
	if err != nil {
		return err
	}

	// 创建关联关系
	for _, retrievalChunk := range retrievalChunks {
		metadata := &model.RelationMetadataData{
			CreatedReason:  "auto_generated",
			SemanticScore:  1.0,
			PositionScore:  1.0,
			ContentOverlap: 0.8,
		}

		_, err = model.CreateChunkRelation(
			eid,
			knowledgeChunk.FileID,
			knowledgeChunk.LibraryID,
			knowledgeChunk.ID,
			retrievalChunk.ID,
			"auto",
			1.0,
			metadata,
		)
		if err != nil {
			logger.Warn(context.TODO(), fmt.Sprintf("[createRelationFail][knowledgeChunkID=%d]%+v", knowledgeChunk.ID, err))
		}
	}

	return nil
}

// deleteRetrievalChunksByKnowledgeID 删除知识点分块关联的所有检索块
func (s *ChunkerService) deleteRetrievalChunksByKnowledgeID(tx *gorm.DB, eid int64, knowledgeChunkID int64) error {
	// 获取知识点分块信息以获取 libraryID
	knowledgeChunk, err := model.GetDocumentChunkByID(eid, knowledgeChunkID)
	if err != nil {
		return err
	}

	// 获取所有关联的检索块
	var retrievalChunks []model.RetrievalChunk
	err = tx.Where("eid = ? AND knowledge_chunk_id = ?", eid, knowledgeChunkID).Find(&retrievalChunks).Error
	if err != nil {
		return err
	}

	// 1. 先收集需要清理的向量ID
	var vectorIDsToDelete []string
	for _, chunk := range retrievalChunks {
		if chunk.VectorID != "" {
			vectorIDsToDelete = append(vectorIDsToDelete, chunk.VectorID)
		}
	}

	// 2. 删除检索块的关联关系，添加重试机制处理死锁和锁等待超时
	maxRetries := 3
	for _, chunk := range retrievalChunks {
		for i := 0; i < maxRetries; i++ {
			err = model.DeleteChunkRelationsByRetrievalID(eid, chunk.ID)
			if err == nil {
				break
			}

			// 检查是否是死锁或锁等待超时错误
			errMsg := err.Error()
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
			logger.Warn(context.TODO(), fmt.Sprintf("[deleteRelationFail][retrievalID=%d]%+v", chunk.ID, err))
			break
		}
	}

	// 3. 删除检索块，添加重试机制处理死锁和锁等待超时
	for i := 0; i < maxRetries; i++ {
		err = tx.Where("eid = ? AND knowledge_chunk_id = ?", eid, knowledgeChunkID).Delete(&model.RetrievalChunk{}).Error
		if err == nil {
			break
		}

		// 检查是否是死锁或锁等待超时错误
		errMsg := err.Error()
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

	if err != nil {
		return err
	}

	// 4. 清理向量数据（异步执行，不阻塞主流程）
	if len(vectorIDsToDelete) > 0 {
		go s.cleanupVectorsAsync(eid, knowledgeChunk.LibraryID, vectorIDsToDelete)
	}

	return nil
}
