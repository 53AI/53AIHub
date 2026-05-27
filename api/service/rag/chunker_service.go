package rag

import (
	"context"
	"crypto/md5"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/storage"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/vectorstore"
	"gorm.io/gorm"
)

// ChunkerService 智能分块服务
type ChunkerService struct {
	db        *gorm.DB
	tokenizer *TokenizerService
	config    *ChunkConfigService
}

// NewChunkerService 创建智能分块服务
func NewChunkerService(db *gorm.DB) *ChunkerService {
	return &ChunkerService{
		db:        db,
		tokenizer: NewTokenizerService(),
		config:    NewChunkConfigService(db),
	}
}

// ChunkDocument 分块文档
func (s *ChunkerService) ChunkDocument(eid int64, fileID int64, content string, configID *int64) (*ChunkResult, error) {
	// 获取文件信息
	var file model.File
	err := s.db.Where("eid = ? AND id = ?", eid, fileID).First(&file).Error
	if err != nil {
		return nil, fmt.Errorf("获取文件信息失败: %v", err)
	}

	// 获取分块配置（支持4层级联：默认 → 站点 → 知识库 → 文档）
	var chunkConfig *ChunkConfig
	if configID != nil && *configID > 0 {
		// 使用指定的配置ID
		chunkConfig, err = s.config.GetConfigByID(file.Eid, *configID)
		if err != nil {
			// 兼容，没有企业专用的规则时，查询系统默认的规则
			chunkConfig, err = s.config.GetConfigByID(0, *configID)
		}
	} else {
		// 使用4层级联配置查找，包括文档级配置
		chunkConfig, err = s.config.GetConfigWithFileID(file.Eid, &file.LibraryID, &fileID)
	}
	if err != nil {
		return nil, fmt.Errorf("获取分块配置失败: %v", err)
	}

	return s.ChunkDocumentWithConfig(eid, fileID, content, chunkConfig)
}

// ChunkDocumentWithConfig 使用指定配置分块文档
func (s *ChunkerService) ChunkDocumentWithConfig(eid int64, fileID int64, content string, chunkConfig *ChunkConfig) (*ChunkResult, error) {
	startTime := time.Now()

	// 根据配置类型选择不同的分块策略
	strategy := GetChunkStrategy(chunkConfig.Type)

	// 使用选定的策略处理分块
	result, err := strategy.ProcessChunking(s, eid, fileID, content, chunkConfig)
	if err != nil {
		return nil, fmt.Errorf("分块处理失败: %v", err)
	}

	// 生成哈希和索引（对所有分块，包括单个分块）
	for i := range result.Chunks {
		result.Chunks[i].Index = i
		result.Chunks[i].ContentHash = s.generateContentHash(fileID, result.Chunks[i].Content, i)
		// 记录使用的配置ID
		result.Chunks[i].ChunkConfigID = chunkConfig.ID
	}

	// 计算元数据（对所有分块，包括单个分块）
	result.Metadata = s.calculateMetadata(result.Chunks, startTime)

	return result, nil
}

// UpdateDocumentChunks 智能更新文档分块
func (s *ChunkerService) UpdateDocumentChunks(eid int64, fileID int64, newContent string, configID *int64) (*ChunkUpdateResult, error) {
	// 获取文件信息
	var file model.File
	err := s.db.Where("eid = ? AND id = ?", eid, fileID).First(&file).Error
	if err != nil {
		return nil, fmt.Errorf("获取文件信息失败: %v", err)
	}

	// 重新分块新内容
	result, err := s.ChunkDocument(eid, fileID, newContent, configID)
	if err != nil {
		return nil, fmt.Errorf("分块新内容失败: %v", err)
	}

	// 使用事务执行智能更新
	var updateResult *ChunkUpdateResult
	err = s.db.Transaction(func(tx *gorm.DB) error {
		updateResult, err = s.executeSmartChunkUpdate(tx, eid, fileID, file.LibraryID, result.Chunks)
		return err
	})

	if err != nil {
		return nil, fmt.Errorf("执行智能分块更新失败: %v", err)
	}

	return updateResult, nil
}

// AnalyzeChunkChanges 公共方法：分析分块变化（用于测试和外部调用）
func (s *ChunkerService) AnalyzeChunkChanges(existingChunks []model.DocumentChunk, newChunks []DocumentChunk) *ChunkChanges {
	return s.analyzeChunkChanges(existingChunks, newChunks)
}

// GetChunkUpdateStats 获取分块更新统计信息
func (s *ChunkerService) GetChunkUpdateStats(eid int64, fileID int64) (*ChunkUpdateStats, error) {
	var stats ChunkUpdateStats

	// 获取知识点分块统计
	err := s.db.Model(&model.DocumentChunk{}).
		Where("eid = ? AND file_id = ? AND chunk_type = ?", eid, fileID, "knowledge").
		Count(&stats.KnowledgeChunks).Error
	if err != nil {
		return nil, err
	}

	// 获取检索块统计
	err = s.db.Model(&model.RetrievalChunk{}).
		Where("eid = ? AND file_id = ?", eid, fileID).
		Count(&stats.RetrievalChunks).Error
	if err != nil {
		return nil, err
	}

	// 获取关联关系统计
	err = s.db.Model(&model.ChunkRelation{}).
		Where("eid = ? AND file_id = ? AND status = ?", eid, fileID, "active").
		Count(&stats.Relations).Error
	if err != nil {
		return nil, err
	}

	// 获取向量化状态统计
	err = s.db.Model(&model.DocumentChunk{}).
		Where("eid = ? AND file_id = ? AND chunk_type = ? AND embedding_status IN ?",
			eid, fileID, "knowledge", model.DocumentChunkEmbeddingSuccessStatuses()).
		Count(&stats.EmbeddedChunks).Error
	if err != nil {
		return nil, err
	}

	return &stats, nil
}

// PreviewChunkingWithConfig 使用指定配置预览分块（不保存到数据库）
func (s *ChunkerService) PreviewChunkingWithConfig(eid int64, fileID int64, content string, chunkingConfig *model.ChunkingConfigData) (*ChunkResult, error) {
	startTime := time.Now()

	// 解析文档内容
	parsed := s.parseMarkdown(content)

	// 使用知识点分块配置进行分块
	knowledgeChunks := s.chunkByRules(parsed, chunkingConfig.KnowledgeChunk.ChunkMode, chunkingConfig.KnowledgeChunk.GetSplitRules(), chunkingConfig.KnowledgeChunk.MaxLength, "knowledge")

	// 为分块添加索引
	for i := range knowledgeChunks {
		knowledgeChunks[i].Index = i
	}

	// 计算元数据
	totalTokens := 0
	for _, chunk := range knowledgeChunks {
		totalTokens += chunk.TokenCount
	}

	metadata := ChunkMetadata{
		TotalChunks:    len(knowledgeChunks),
		TotalTokens:    totalTokens,
		AvgChunkSize:   float64(totalTokens) / float64(len(knowledgeChunks)),
		ProcessingTime: time.Since(startTime).Milliseconds(),
	}

	return &ChunkResult{
		Chunks:   knowledgeChunks,
		Metadata: metadata,
	}, nil
}

// CheckContentChanged 检查分块内容是否有变化
func (s *ChunkerService) CheckContentChanged(eid int64, fileID int64) (bool, error) {
	// 获取当前文档内容
	fileBody, err := model.GetLastFileBodyByFileID(eid, fileID)
	if err != nil {
		return false, fmt.Errorf("获取文档内容失败: %v", err)
	}
	content, err := fileBody.GetContent()
	if err != nil {
		return false, fmt.Errorf("获取文档内容失败: %v", err)
	}

	// 获取现有分块
	var chunks []model.DocumentChunk
	err = s.db.Where("eid = ? AND file_id = ? AND chunk_type = ?", eid, fileID, "knowledge").
		Order("chunk_index asc").Find(&chunks).Error
	if err != nil {
		return false, fmt.Errorf("获取分块失败: %v", err)
	}

	if len(chunks) == 0 {
		return true, nil // 没有分块，需要重新分块
	}

	// 重新生成分块并比较哈希
	result, err := s.ChunkDocument(eid, fileID, content, nil)
	if err != nil {
		return false, fmt.Errorf("重新分块失败: %v", err)
	}

	// 比较分块数量
	if len(result.Chunks) != len(chunks) {
		return true, nil
	}

	// 比较每个分块的哈希
	for i, newChunk := range result.Chunks {
		if i >= len(chunks) || newChunk.ContentHash != chunks[i].ContentHash {
			return true, nil
		}
	}

	return false, nil
}

// ReindexDocument 重新索引文档的检索块
func (s *ChunkerService) ReindexDocument(eid int64, fileID int64) error {
	// 0. 向量库清理：删除该文件相关的检索块向量（容错，失败仅记录日志）
	{
		var vectorIDs []string
		if err := s.db.Model(&model.RetrievalChunk{}).
			Where("eid = ? AND file_id = ? AND vector_id IS NOT NULL AND vector_id != ''", eid, fileID).
			Pluck("vector_id", &vectorIDs).Error; err != nil {
			logger.Warn(context.TODO(), fmt.Sprintf("[reindexVectorQueryFail][eid=%d][fileID=%d]%+v", eid, fileID, err))
		} else if len(vectorIDs) > 0 {
			ids := make([]interface{}, 0, len(vectorIDs))
			for _, id := range vectorIDs {
				ids = append(ids, id)
			}
			ctx := context.Background()
			cfg := vectorstore.LoadFromEnv()
			store, err := vectorstore.NewVectorStore(cfg)
			if err != nil {
				logger.Warn(context.TODO(), fmt.Sprintf("[reindexStoreInitFail][eid=%d][fileID=%d]%+v", eid, fileID, err))
			} else {
				// 通过文件ID获取库信息构建集合名
				var file model.File
				if err := s.db.Where("eid = ? AND id = ?", eid, fileID).First(&file).Error; err != nil {
					logger.Warn(context.TODO(), fmt.Sprintf("[reindexGetFileFail][eid=%d][fileID=%d]%+v", eid, fileID, err))
				} else {
					library, err := model.GetLibraryByID(eid, file.LibraryID)
					if err != nil {
						logger.Warn(context.TODO(), fmt.Sprintf("[reindexGetLibraryFail][eid=%d][libraryID=%d]%+v", eid, file.LibraryID, err))
					} else {
						collection := model.GetVectorCollectionName(library.UUID)
						if err := store.Delete(ctx, collection, ids); err != nil {
							logger.Warn(context.TODO(), fmt.Sprintf("[reindexVectorBatchDeleteFail][eid=%d][fileID=%d][collection=%s][count=%d]%+v", eid, fileID, collection, len(ids), err))
						} else {
							logger.Info(context.TODO(), fmt.Sprintf("[reindexVectorDeleted][eid=%d][fileID=%d][collection=%s][count=%d]", eid, fileID, collection, len(ids)))
						}
					}
				}
			}
		} else {
			// 无需清理
		}
	}

	// 1. 获取文件的所有知识点分块
	knowledgeChunks, err := model.GetDocumentChunksByFileID(eid, fileID, 0, 0)
	if err != nil {
		return fmt.Errorf("获取知识点分块失败: %v", err)
	}

	// 2. 过滤出知识点类型的分块
	var knowledgeTypeChunks []model.DocumentChunk
	for _, chunk := range knowledgeChunks {
		if chunk.ChunkType == "knowledge" {
			knowledgeTypeChunks = append(knowledgeTypeChunks, chunk)
		}
	}

	// 3. 获取分块配置
	if len(knowledgeTypeChunks) == 0 {
		return fmt.Errorf("文件没有知识点分块")
	}

	libraryID := knowledgeTypeChunks[0].LibraryID
	chunkConfig, err := s.config.GetConfigWithFileID(eid, &libraryID, &fileID)
	if err != nil {
		return fmt.Errorf("获取分块配置失败: %v", err)
	}

	// 4. 开启事务
	tx := s.db.Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	// 5. 删除现有的检索块
	err = tx.Where("eid = ? AND file_id = ?", eid, fileID).
		Delete(&model.RetrievalChunk{}).Error
	if err != nil {
		tx.Rollback()
		return fmt.Errorf("删除现有检索块失败: %v", err)
	}

	// 6. 为每个知识点分块重新生成检索块
	retrievalService := NewRetrievalChunkService(tx)
	for _, knowledgeChunk := range knowledgeTypeChunks {
		_, err := retrievalService.CreateRetrievalChunksForKnowledge(eid, &knowledgeChunk, chunkConfig)
		if err != nil {
			tx.Rollback()
			return fmt.Errorf("为知识点分块 %d 生成检索块失败: %v", knowledgeChunk.ID, err)
		}
	}

	// 7. 提交事务
	if err := tx.Commit().Error; err != nil {
		return fmt.Errorf("提交事务失败: %v", err)
	}

	// 8. 事务提交成功后，入队所有该文件的检索块，交给异步向量化
	if q := GetDefaultEmbeddingQueue(); q != nil {
		var rids []int64
		if err := s.db.Model(&model.RetrievalChunk{}).
			Where("eid = ? AND file_id = ?", eid, fileID).
			Pluck("id", &rids).Error; err != nil {
			logger.Warn(context.TODO(), fmt.Sprintf("[reindexListRetrievalIDsFail][eid=%d][fileID=%d]%+v", eid, fileID, err))
		} else {
			for _, rid := range rids {
				_, err := q.EnqueueIfNotExists(context.TODO(), EmbeddingTask{
					Eid:              eid,
					RetrievalChunkID: rid,
					FileID:           fileID,
					LibraryID:        libraryID,
					TraceID:          "",
					Retries:          0,
				})
				if err != nil {
					logger.Warn(context.TODO(), fmt.Sprintf("[reindexEnqueueFail][eid=%d][fileID=%d][rid=%d]%+v", eid, fileID, rid, err))
				}
			}
			logger.Info(context.TODO(), fmt.Sprintf("[reindexEnqueuedAll][eid=%d][fileID=%d][count=%d]", eid, fileID, len(rids)))
		}
	}

	return nil
}

// RestoreDocumentFromChunks 从分块还原文档内容
func (s *ChunkerService) RestoreDocumentFromChunks(eid int64, fileID int64) (string, error) {
	// 获取文件的所有分块，按索引排序
	var chunks []model.DocumentChunk
	err := s.db.Where("eid = ? AND file_id = ? AND chunk_type = ?", eid, fileID, "knowledge").
		Order("chunk_index asc").Find(&chunks).Error
	if err != nil {
		return "", fmt.Errorf("获取分块失败: %v", err)
	}

	if len(chunks) == 0 {
		return "", fmt.Errorf("文件没有分块")
	}

	// 按顺序合并分块内容
	var content strings.Builder
	for i, chunk := range chunks {
		if i > 0 {
			// 在分块之间添加适当的分隔符
			content.WriteString("\n\n")
		}
		content.WriteString(chunk.Content)
	}

	return content.String(), nil
}

// SyncChunksToDocument 同步分块内容到文档
func (s *ChunkerService) SyncChunksToDocument(eid int64, fileID int64, userID int64) error {
	// 检查文档编辑锁
	// lockName := fmt.Sprintf("document_edit_%d_%d", eid, fileID)
	// if !s.tryLockDocument(lockName) {
	// 	return fmt.Errorf("文档正在被编辑，无法同步分块内容")
	// }
	// defer s.unlockDocument(lockName)

	// 从分块还原文档内容
	restoredContent, err := s.RestoreDocumentFromChunks(eid, fileID)
	if err != nil {
		if err.Error() == "文件没有分块" {
			return nil
		}
		return fmt.Errorf("还原文档内容失败: %v", err)
	}

	// 更新文档内容
	var fileBody model.FileBody
	err = s.db.Where("eid = ? AND file_id = ?", eid, fileID).Last(&fileBody).Error
	if err != nil {
		return fmt.Errorf("获取文档内容失败: %v", err)
	}
	content, err := fileBody.GetContent()
	if err != nil {
		return fmt.Errorf("获取文档内容失败: %v", err)
	}

	// 检查内容是否有变化
	if content == restoredContent {
		return nil // 内容没有变化，无需更新
	}

	file, err := model.GetFileByID(eid, fileID)
	if err != nil {
		return fmt.Errorf("获取文件信息失败: %v", err)
	}

	if file.UploadFileID != 0 {
		filePath := strings.TrimSuffix(file.Path, ".md")
		ext := strings.ToLower(filepath.Ext(filePath))

		uploadFile, err := model.GetUploadFileByID(file.UploadFileID)
		if err == nil && uploadFile != nil {
			contentBytes := []byte(restoredContent)
			if err := storage.StorageInstance.Save(contentBytes, uploadFile.Key); err == nil {
				var mimeType string
				switch ext {
				case ".html", ".htm":
					mimeType = "text/html; charset=utf-8"
				case ".md":
					mimeType = "text/markdown; charset=utf-8"
				default:
					mimeType = "text/plain; charset=utf-8"
				}
				uploadFile.UpdateSizeAndMimeType(int64(len(contentBytes)), mimeType)
			} else {
				logger.Warn(context.TODO(), fmt.Sprintf("[syncOriginalFileFail][fileID=%d][uploadFileID=%d]%+v", fileID, file.UploadFileID, err))
			}
		}
	}

	newFileBody := model.FileBody{
		FileID:    fileBody.FileID,
		LibraryID: fileBody.LibraryID,
		Eid:       eid,
		Content:   restoredContent,
		UserID:    userID, // 记录修改人
	}

	if err := newFileBody.Save(); err != nil {
		return fmt.Errorf("更新文档内容失败: %v", err)
	}

	// 记录同步日志
	err = model.CreateSyncLog(eid, fileID, userID, len(restoredContent))
	if err != nil {
		// 日志记录失败不影响主流程
		logger.Warn(context.TODO(), fmt.Sprintf("[syncLogCreateFail][fileID=%d]%+v", fileID, err))
	}

	return nil
}

// generateContentHash 生成内容哈希
func (s *ChunkerService) generateContentHash(fileID int64, content string, index int) string {
	data := fmt.Sprintf("%d:%s:%d", fileID, content, index)
	hash := md5.Sum([]byte(data))
	return fmt.Sprintf("%x", hash)
}

// analyzeChunkChanges 分析分块变化
func (s *ChunkerService) analyzeChunkChanges(existingChunks []model.DocumentChunk, newChunks []DocumentChunk) *ChunkChanges {
	changes := &ChunkChanges{
		Creates: []ChunkChange{},
		Updates: []ChunkChange{},
		Deletes: []ChunkChange{},
	}

	// 创建现有分块的映射（按索引）
	existingMap := make(map[int]*model.DocumentChunk)
	for i := range existingChunks {
		existingMap[existingChunks[i].ChunkIndex] = &existingChunks[i]
	}

	// 创建新分块的映射（按索引）
	newMap := make(map[int]*DocumentChunk)
	for i := range newChunks {
		if newChunks[i].Type == "knowledge" { // 只处理知识点分块
			newMap[newChunks[i].Index] = &newChunks[i]
		}
	}

	// 分析新分块：创建或更新
	for index, newChunk := range newMap {
		if existingChunk, exists := existingMap[index]; exists {
			// 检查内容是否有变化
			newHash := s.generateContentHash(existingChunk.FileID, newChunk.Content, index)
			if existingChunk.ContentHash != newHash {
				// 内容有变化，需要更新
				changes.Updates = append(changes.Updates, ChunkChange{
					Type:       ChunkChangeUpdate,
					OldChunk:   existingChunk,
					NewChunk:   newChunk,
					ChunkIndex: index,
				})
			}
			// 如果内容没有变化，则无需操作
		} else {
			// 新分块，需要创建
			changes.Creates = append(changes.Creates, ChunkChange{
				Type:       ChunkChangeCreate,
				NewChunk:   newChunk,
				ChunkIndex: index,
			})
		}
	}

	// 分析删除的分块
	for index, existingChunk := range existingMap {
		if _, exists := newMap[index]; !exists {
			// 分块被删除
			changes.Deletes = append(changes.Deletes, ChunkChange{
				Type:       ChunkChangeDelete,
				OldChunk:   existingChunk,
				ChunkIndex: index,
			})
		}
	}

	return changes
}

// CheckChunkingStatus 检查分块状态
func (s *ChunkerService) CheckChunkingStatus(eid int64, fileID int64) (string, error) {
	// 检查是否有正在处理的分块
	var pendingCount int64
	err := s.db.Model(&model.DocumentChunk{}).
		Where("eid = ? AND file_id = ? AND embedding_status = ?", eid, fileID, model.DocumentChunkEmbeddingStatusPending).
		Count(&pendingCount).Error
	if err != nil {
		return "", err
	}

	if pendingCount > 0 {
		return "chunking", nil // 正在分块
	}

	// 检查是否有正在向量化的分块（索引中）
	var embeddingCount int64
	err = s.db.Model(&model.DocumentChunk{}).
		Where("eid = ? AND file_id = ? AND embedding_status = ?", eid, fileID, model.DocumentChunkEmbeddingStatusIndexing).
		Count(&embeddingCount).Error
	if err != nil {
		return "", err
	}

	if embeddingCount > 0 {
		return "embedding", nil // 正在向量化
	}

	// 如果存在失败但没有进行中的任务，返回失败状态
	var failedCount int64
	err = s.db.Model(&model.DocumentChunk{}).
		Where("eid = ? AND file_id = ? AND embedding_status = ?", eid, fileID, model.DocumentChunkEmbeddingStatusFailed).
		Count(&failedCount).Error
	if err != nil {
		return "", err
	}
	if failedCount > 0 {
		return "failed", nil
	}

	return "completed", nil // 处理完成
}
