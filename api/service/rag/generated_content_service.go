package rag

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

// GeneratedContentService 生成内容管理服务
type GeneratedContentService struct {
	db *gorm.DB
}

// NewGeneratedContentService 创建生成内容管理服务
func NewGeneratedContentService(db *gorm.DB) *GeneratedContentService {
	return &GeneratedContentService{
		db: db,
	}
}

// UpsertSummary 更新摘要及相关分块
func (s *GeneratedContentService) UpsertSummary(ctx context.Context, eid int64, fileID int64, summary string) error {
	var file model.File
	if err := s.db.Where("eid = ? AND id = ?", eid, fileID).First(&file).Error; err != nil {
		return fmt.Errorf("获取文件失败: %v", err)
	}

	configService := NewChunkConfigService(s.db)
	chunkConfig, err := configService.GetConfigWithFileID(eid, &file.LibraryID, &file.ID)
	if err != nil {
		logger.Warn(ctx, fmt.Sprintf("获取分块配置失败: %v", err))
		// 继续执行，chunkConfig 为 nil
	}

	return s.db.Transaction(func(tx *gorm.DB) error {
		// 1. 更新文件摘要字段
		if err := tx.Model(&model.File{}).Where("id = ?", file.ID).Update("summary", summary).Error; err != nil {
			return err
		}

		// 2. 更新摘要分块
		if strings.TrimSpace(summary) == "" {
			// 如果摘要为空，可能需要删除旧的分块？目前逻辑是保留空内容更新或者跳过
			// 参照 summary_generation.go，如果为空则返回 nil (不创建/更新 chunk)
			// 但如果是手动清空，应该删除对应的 chunk?
			// 这里保持与 summary_generation.go 一致的逻辑：如果为空，不处理 chunk
			// TODO: 考虑是否需要删除 chunk
			return nil
		}

		if err := s.upsertSummaryChunks(tx, eid, &file, summary, chunkConfig); err != nil {
			return err
		}
		return nil
	})
}

// UpsertKnowledgeMap 更新知识地图及相关分块
func (s *GeneratedContentService) UpsertKnowledgeMap(ctx context.Context, eid int64, fileID int64, knowledgeMap string) error {
	var file model.File
	if err := s.db.Where("eid = ? AND id = ?", eid, fileID).First(&file).Error; err != nil {
		return fmt.Errorf("获取文件失败: %v", err)
	}

	configService := NewChunkConfigService(s.db)
	chunkConfig, err := configService.GetConfigWithFileID(eid, &file.LibraryID, &file.ID)
	if err != nil {
		logger.Warn(ctx, fmt.Sprintf("获取分块配置失败: %v", err))
	}

	return s.db.Transaction(func(tx *gorm.DB) error {
		// 1. 更新文件知识地图字段
		if err := tx.Model(&model.File{}).Where("id = ?", file.ID).Update("knowledge_map", knowledgeMap).Error; err != nil {
			return err
		}

		// 2. 更新知识地图分块
		if strings.TrimSpace(knowledgeMap) == "" {
			return nil
		}

		if err := s.upsertKnowledgeMapChunks(tx, eid, &file, knowledgeMap, chunkConfig); err != nil {
			return err
		}
		return nil
	})
}

// UpsertQuestions 更新问题列表
func (s *GeneratedContentService) UpsertQuestions(ctx context.Context, eid int64, fileID int64, questions []string) error {
	questionsJSON, err := json.Marshal(questions)
	if err != nil {
		return fmt.Errorf("序列化问题列表失败: %v", err)
	}

	return s.db.Model(&model.File{}).Where("eid = ? AND id = ?", eid, fileID).Update("questions", string(questionsJSON)).Error
}

// UpsertSummaryChunks 更新摘要分块 (公开方法，可用于事务中)
func (s *GeneratedContentService) UpsertSummaryChunks(eid int64, file *model.File, summaryText string, chunkConfig *ChunkConfig) error {
	return s.upsertSummaryChunks(s.db, eid, file, summaryText, chunkConfig)
}

// UpsertKnowledgeMapChunks 更新知识地图分块 (公开方法，可用于事务中)
func (s *GeneratedContentService) UpsertKnowledgeMapChunks(eid int64, file *model.File, knowledgeMap string, chunkConfig *ChunkConfig) error {
	return s.upsertKnowledgeMapChunks(s.db, eid, file, knowledgeMap, chunkConfig)
}

// upsertSummaryChunks 内部方法：更新摘要分块
func (s *GeneratedContentService) upsertSummaryChunks(tx *gorm.DB, eid int64, file *model.File, summaryText string, chunkConfig *ChunkConfig) error {
	if strings.TrimSpace(summaryText) == "" {
		return nil
	}

	tokenizer := NewTokenizerService()
	tokenCount, _ := tokenizer.CountTokens(summaryText)

	docChunk, err := s.getOrCreateSummaryDocChunk(tx, eid, file, summaryText, tokenCount, chunkConfig)
	if err != nil {
		return err
	}

	// 查找或创建 retrieval chunk
	// 注意：summary_generation.go 中是总是创建新的？不，它没有查旧的 retrieval chunk 逻辑，直接 SaveRetrievalChunksWithDB?
	// SaveRetrievalChunksWithDB 是批量插入。
	// 如果已经存在，需要更新。
	// summary_generation.go 逻辑看起来是：
	// 1. getOrCreateSummaryDocChunk (DocumentChunk)
	// 2. Create RetrievalChunk object
	// 3. SaveRetrievalChunksWithDB
	// 4. Enqueue

	// SaveRetrievalChunksWithDB 内部如果是 Create，会重复插入吗？
	// 让我们看看 SaveRetrievalChunksWithDB (在 retrieval_service.go 中?)
	// 没找到 SaveRetrievalChunksWithDB 定义，应该是 retrieval_service.go 里的 SaveRetrievalChunksWithDB?
	// 刚才 grep 没看到，可能是 retrieval_defaults.go?
	// 无论如何，我们应该尝试更新如果存在。

	// 检查是否存在
	var retrievalChunk model.RetrievalChunk
	err = tx.Where("eid = ? AND file_id = ? AND knowledge_chunk_id = ? AND chunk_index = ? AND chunk_type = ?",
		eid, file.ID, docChunk.ID, 0, "summary").First(&retrievalChunk).Error

	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}

	if errors.Is(err, gorm.ErrRecordNotFound) {
		// 创建新 RetrievalChunk
		retrievalChunk = model.RetrievalChunk{
			Eid:              eid,
			FileID:           file.ID,
			LibraryID:        file.LibraryID,
			KnowledgeChunkID: docChunk.ID,
			Content:          summaryText,
			ChunkIndex:       0,
			ChunkType:        "summary",
			StartPosition:    0,
			EndPosition:      len(summaryText),
			TokenCount:       tokenCount,
			Status:           "enabled",
			EmbeddingStatus:  model.RetrievalChunkEmbeddingStatusPending,
			VectorID:         "",
			SearchWeight:     1.2,
		}
		if err := SaveRetrievalChunksWithDB(tx, eid, file.ID, []model.RetrievalChunk{retrievalChunk}); err != nil {
			return err
		}
		// 重新查询以获取 ID
		if err := tx.Where("eid = ? AND file_id = ? AND knowledge_chunk_id = ? AND chunk_index = ? AND chunk_type = ?",
			eid, file.ID, docChunk.ID, 0, "summary").First(&retrievalChunk).Error; err != nil {
			return err
		}
	} else {
		// 更新现有 RetrievalChunk
		retrievalChunk.Content = summaryText
		retrievalChunk.TokenCount = tokenCount
		retrievalChunk.EmbeddingStatus = model.RetrievalChunkEmbeddingStatusPending
		retrievalChunk.VectorID = "" // 重置向量ID，需要重新生成
		if err := tx.Save(&retrievalChunk).Error; err != nil {
			return err
		}
	}

	// 同步处理向量化（摘要只有1个chunk，不需要异步队列）
	retrievalService := NewRetrievalChunkService(tx)
	if err := retrievalService.ProcessEmbeddingForRetrievalChunk(eid, &retrievalChunk); err != nil {
		// 更新状态为失败
		_ = tx.Model(&retrievalChunk).Updates(map[string]interface{}{
			"embedding_status": model.RetrievalChunkEmbeddingStatusFailed,
			"error_reason":     err.Error(),
		}).Error
		return fmt.Errorf("摘要向量化失败: %v", err)
	}
	return nil
}

// upsertKnowledgeMapChunks 内部方法：更新知识地图分块
func (s *GeneratedContentService) upsertKnowledgeMapChunks(tx *gorm.DB, eid int64, file *model.File, knowledgeMap string, chunkConfig *ChunkConfig) error {
	if strings.TrimSpace(knowledgeMap) == "" {
		return nil
	}

	tokenizer := NewTokenizerService()
	tokenCount, _ := tokenizer.CountTokens(knowledgeMap)

	docChunk, err := s.getOrCreateKnowledgeMapDocChunk(tx, eid, file, knowledgeMap, tokenCount, chunkConfig)
	if err != nil {
		return err
	}

	// 检查是否存在 RetrievalChunk
	var retrievalChunk model.RetrievalChunk
	err = tx.Where("eid = ? AND file_id = ? AND knowledge_chunk_id = ? AND chunk_index = ? AND chunk_type = ?",
		eid, file.ID, docChunk.ID, 0, "knowledge_map").First(&retrievalChunk).Error

	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}

	if errors.Is(err, gorm.ErrRecordNotFound) {
		retrievalChunk = model.RetrievalChunk{
			Eid:              eid,
			FileID:           file.ID,
			LibraryID:        file.LibraryID,
			KnowledgeChunkID: docChunk.ID,
			Content:          knowledgeMap,
			ChunkIndex:       0,
			ChunkType:        "knowledge_map",
			StartPosition:    0,
			EndPosition:      len(knowledgeMap),
			TokenCount:       tokenCount,
			Status:           "enabled",
			EmbeddingStatus:  model.RetrievalChunkEmbeddingStatusPending,
			VectorID:         "",
			SearchWeight:     1.0,
		}
		if err := SaveRetrievalChunksWithDB(tx, eid, file.ID, []model.RetrievalChunk{retrievalChunk}); err != nil {
			return err
		}
		if err := tx.Where("eid = ? AND file_id = ? AND knowledge_chunk_id = ? AND chunk_index = ? AND chunk_type = ?",
			eid, file.ID, docChunk.ID, 0, "knowledge_map").First(&retrievalChunk).Error; err != nil {
			return err
		}
	} else {
		retrievalChunk.Content = knowledgeMap
		retrievalChunk.TokenCount = tokenCount
		retrievalChunk.EmbeddingStatus = model.RetrievalChunkEmbeddingStatusPending
		retrievalChunk.VectorID = ""
		if err := tx.Save(&retrievalChunk).Error; err != nil {
			return err
		}
	}

	// 同步处理向量化（知识地图只有1个chunk，不需要异步队列）
	retrievalService := NewRetrievalChunkService(tx)
	if err := retrievalService.ProcessEmbeddingForRetrievalChunk(eid, &retrievalChunk); err != nil {
		// 更新状态为失败
		_ = tx.Model(&retrievalChunk).Updates(map[string]interface{}{
			"embedding_status": model.RetrievalChunkEmbeddingStatusFailed,
			"error_reason":     err.Error(),
		}).Error
		return fmt.Errorf("知识地图向量化失败: %v", err)
	}
	return nil
}

func (s *GeneratedContentService) getOrCreateSummaryDocChunk(tx *gorm.DB, eid int64, file *model.File, summaryText string, tokenCount int, chunkConfig *ChunkConfig) (*model.DocumentChunk, error) {
	var docChunk model.DocumentChunk
	err := tx.Where("eid = ? AND file_id = ? AND chunk_type = ?", eid, file.ID, "summary").First(&docChunk).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	if errors.Is(err, gorm.ErrRecordNotFound) {
		var maxIndex int
		if err := tx.Model(&model.DocumentChunk{}).
			Where("eid = ? AND file_id = ?", eid, file.ID).
			Select("COALESCE(MAX(chunk_index), -1)").
			Scan(&maxIndex).Error; err != nil {
			return nil, err
		}

		newChunk := model.DocumentChunk{
			Eid:             eid,
			FileID:          file.ID,
			LibraryID:       file.LibraryID,
			Content:         summaryText,
			ChunkIndex:      maxIndex + 1,
			ChunkType:       "summary",
			StartPosition:   0,
			EndPosition:     len(summaryText),
			TokenCount:      tokenCount,
			Status:          "enabled",
			EmbeddingStatus: model.DocumentChunkEmbeddingStatusPending,
			VectorID:        "",
			IsManualEdited:  false,
		}
		if chunkConfig != nil {
			newChunk.ChunkConfigID = chunkConfig.ID
		}
		newChunk.ContentHash = newChunk.GenerateContentHash()
		if err := tx.Create(&newChunk).Error; err != nil {
			return nil, err
		}
		return &newChunk, nil
	}

	// Update existing
	docChunk.Content = summaryText
	docChunk.TokenCount = tokenCount
	docChunk.EmbeddingStatus = model.DocumentChunkEmbeddingStatusPending
	docChunk.VectorID = ""
	if chunkConfig != nil {
		docChunk.ChunkConfigID = chunkConfig.ID
	}
	docChunk.ContentHash = docChunk.GenerateContentHash()

	if err := tx.Save(&docChunk).Error; err != nil {
		return nil, err
	}
	return &docChunk, nil
}

func (s *GeneratedContentService) getOrCreateKnowledgeMapDocChunk(tx *gorm.DB, eid int64, file *model.File, knowledgeMap string, tokenCount int, chunkConfig *ChunkConfig) (*model.DocumentChunk, error) {
	var docChunk model.DocumentChunk
	err := tx.Where("eid = ? AND file_id = ? AND chunk_type = ?", eid, file.ID, "knowledge_map").First(&docChunk).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	if errors.Is(err, gorm.ErrRecordNotFound) {
		var maxIndex int
		if err := tx.Model(&model.DocumentChunk{}).
			Where("eid = ? AND file_id = ?", eid, file.ID).
			Select("COALESCE(MAX(chunk_index), -1)").
			Scan(&maxIndex).Error; err != nil {
			return nil, err
		}

		newChunk := model.DocumentChunk{
			Eid:             eid,
			FileID:          file.ID,
			LibraryID:       file.LibraryID,
			Content:         knowledgeMap,
			ChunkIndex:      maxIndex + 1,
			ChunkType:       "knowledge_map",
			StartPosition:   0,
			EndPosition:     len(knowledgeMap),
			TokenCount:      tokenCount,
			Status:          "enabled",
			EmbeddingStatus: model.DocumentChunkEmbeddingStatusPending,
			VectorID:        "",
			IsManualEdited:  false,
		}
		if chunkConfig != nil {
			newChunk.ChunkConfigID = chunkConfig.ID
		}
		newChunk.ContentHash = newChunk.GenerateContentHash()
		if err := tx.Create(&newChunk).Error; err != nil {
			return nil, err
		}
		return &newChunk, nil
	}

	docChunk.Content = knowledgeMap
	docChunk.TokenCount = tokenCount
	docChunk.EmbeddingStatus = model.DocumentChunkEmbeddingStatusPending
	docChunk.VectorID = ""
	if chunkConfig != nil {
		docChunk.ChunkConfigID = chunkConfig.ID
	}
	docChunk.ContentHash = docChunk.GenerateContentHash()

	if err := tx.Save(&docChunk).Error; err != nil {
		return nil, err
	}
	return &docChunk, nil
}
