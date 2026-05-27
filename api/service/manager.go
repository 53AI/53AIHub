package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/rag"
	"github.com/53AI/53AIHub/service/vectorstore"
	"gorm.io/gorm"
)

// ServiceManager 统一的服务管理器
type ServiceManager struct {
	db                   *gorm.DB
	chunkerService       *rag.ChunkerService
	retrievalService     *rag.RetrievalChunkService
	embeddingService     *rag.EmbeddingService
	batchProcessor       *rag.EmbeddingBatchProcessor
	configService        *rag.ChunkConfigService
	chunkSaveIntegration *rag.ChunkSaveIntegration
	autoChunkingService  *AutoChunkingService
	mu                   sync.RWMutex
}

var (
	globalServiceManager *ServiceManager
	once                 sync.Once
)

// NewServiceManager 创建新的服务管理器
func NewServiceManager(db *gorm.DB) *ServiceManager {
	return &ServiceManager{
		db:                   db,
		chunkerService:       rag.NewChunkerService(db),
		retrievalService:     rag.NewRetrievalChunkService(db),
		embeddingService:     rag.NewEmbeddingService(db),
		batchProcessor:       rag.NewEmbeddingBatchProcessor(db),
		configService:        rag.NewChunkConfigService(db),
		chunkSaveIntegration: rag.NewChunkSaveIntegration(db),
		autoChunkingService:  NewAutoChunkingService(db),
	}
}

// GetServiceManager 获取全局服务管理器实例（单例模式）
func GetServiceManager() *ServiceManager {
	once.Do(func() {
		if model.DB != nil {
			globalServiceManager = NewServiceManager(model.DB)
		}
	})
	return globalServiceManager
}

// InitServiceManager 初始化全局服务管理器
func InitServiceManager(db *gorm.DB) {
	globalServiceManager = NewServiceManager(db)
}

// GetChunkerService 获取分块服务
func (sm *ServiceManager) GetChunkerService() *rag.ChunkerService {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	return sm.chunkerService
}

// GetRetrievalService 获取检索服务
func (sm *ServiceManager) GetRetrievalService() *rag.RetrievalChunkService {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	return sm.retrievalService
}

// GetEmbeddingService 获取embedding服务
func (sm *ServiceManager) GetEmbeddingService() *rag.EmbeddingService {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	return sm.embeddingService
}

// GetEmbeddingBatchProcessor 获取embedding批量处理器
func (sm *ServiceManager) GetEmbeddingBatchProcessor() *rag.EmbeddingBatchProcessor {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	return sm.batchProcessor
}

// GetConfigService 获取配置服务
func (sm *ServiceManager) GetConfigService() *rag.ChunkConfigService {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	return sm.configService
}

// GetAutoChunkingService 获取自动分块服务
func (sm *ServiceManager) GetAutoChunkingService() *AutoChunkingService {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	return sm.autoChunkingService
}

// ProcessFileEmbedding 统一的文件embedding处理入口
func (sm *ServiceManager) ProcessFileEmbedding(eid, fileID int64, options ...*rag.BatchProcessOptions) error {
	return sm.batchProcessor.ProcessFileChunks(eid, fileID, options...)
}

// ProcessChunksByIDs 根据ID列表处理检索块
func (sm *ServiceManager) ProcessChunksByIDs(eid int64, chunkIDs []int64, options ...*rag.BatchProcessOptions) error {
	return sm.batchProcessor.ProcessChunksByIDs(eid, chunkIDs, options...)
}

// IsDocumentLocked 检查文档是否被锁定
func (sm *ServiceManager) IsDocumentLocked(eid, fileID int64) bool {
	return sm.chunkerService.IsDocumentLocked(eid, fileID)
}

// ChunkDocument 分块文档
func (sm *ServiceManager) ChunkDocument(eid, fileID int64, content string, configID *int64) (*rag.ChunkResult, error) {
	return sm.chunkerService.ChunkDocument(eid, fileID, content, configID)
}

// SaveChunks 保存分块（优先使用优化保存器）
func (sm *ServiceManager) SaveChunks(eid, fileID int64, chunks []rag.DocumentChunk) error {
	if sm.chunkSaveIntegration != nil {
		return sm.chunkSaveIntegration.SaveChunksOptimized(eid, fileID, chunks)
	}
	return sm.chunkerService.SaveChunks(eid, fileID, chunks)
}

// MergeChunks 合并分块
func (sm *ServiceManager) MergeChunks(eid, fileID int64, chunkIDs []int64, userID int64) (*model.DocumentChunk, error) {
	return sm.chunkerService.MergeChunks(eid, fileID, chunkIDs, userID)
}

// SplitChunk 拆分分块
func (sm *ServiceManager) SplitChunk(eid, chunkID int64, splitContents []string, userID int64) ([]model.DocumentChunk, error) {
	return sm.chunkerService.SplitChunk(eid, chunkID, splitContents, userID)
}

// MergeRetrievalChunks 合并检索块
func (sm *ServiceManager) MergeRetrievalChunks(eid int64, chunkIDs []int64, userID int64) (*model.RetrievalChunk, error) {
	return sm.retrievalService.MergeRetrievalChunks(eid, chunkIDs, userID)
}

// SplitRetrievalChunk 拆分检索块
func (sm *ServiceManager) SplitRetrievalChunk(eid, chunkID int64, splitContents []string, userID int64) ([]model.RetrievalChunk, error) {
	return sm.retrievalService.SplitRetrievalChunk(eid, chunkID, splitContents, userID)
}

// GetEmbeddingStats 获取embedding处理统计信息
func (sm *ServiceManager) GetEmbeddingStats() *rag.ProcessingStats {
	return sm.batchProcessor.GetStats()
}

// ResetEmbeddingStats 重置embedding统计信息
func (sm *ServiceManager) ResetEmbeddingStats() {
	sm.batchProcessor.ResetStats()
}

// IsEmbeddingHealthy 检查embedding处理器健康状态
func (sm *ServiceManager) IsEmbeddingHealthy() bool {
	return sm.batchProcessor.IsHealthy()
}

// GetEmbeddingSuccessRate 获取embedding成功率
func (sm *ServiceManager) GetEmbeddingSuccessRate() float64 {
	return sm.batchProcessor.GetSuccessRate()
}

// ReindexDocument 重新索引文档（支持两种模式）
func (sm *ServiceManager) ReindexDocument(eid, fileID int64, mode string, userID int64) error {
	rag.DeleteEmbeddingStepStatus(eid, fileID)
	rag.CheckEmbeddingStepStatusSave(eid, fileID, fmt.Sprintf("time:%d;开始重新索引:mode:%s", time.Now().Unix(), mode))
	var file model.File
	err := sm.db.Where("eid = ? AND id = ?", eid, fileID).First(&file).Error
	if err != nil {
		return fmt.Errorf("获取文件信息失败: %v", err)
	}

	// 更新文件解析状态为解析中
	if err := model.UpdateFileParsingStatus(fileID, model.FileParsingStatusParsing); err != nil {
		log.Printf("警告: 更新文件解析状态为解析中失败: %v\n", err)
	}

	// 这里直接测试 embinding API 是否能正常可以用，如果是不可用，直接 error
	db := model.DB
	if db == nil {
		// 更新文件解析状态为失败
		if err := model.UpdateFileParsingStatus(fileID, model.FileParsingStatusFail); err != nil {
			log.Printf("警告: 更新文件解析状态为失败失败: %v\n", err)
		}
		return fmt.Errorf("db is nil")
	}
	retrievalService := rag.NewRetrievalChunkService(db)
	err = retrievalService.CheckGenerateEmbeddingForChunk(eid, &file.LibraryID, &fileID, "TestAPI")
	if err != nil {
		// 更新文件解析状态为失败
		if err := model.UpdateFileParsingStatus(fileID, model.FileParsingStatusFail); err != nil {
			log.Printf("警告: 更新文件解析状态为失败失败: %v\n", err)
		}
		return fmt.Errorf("embedding API 不可用: %v", err)
	}

	// 使用流水线处理
	switch mode {
	case "reindex_retrieval":
		// 仅重新建立检索块
		err = sm.executeReindexPipeline(eid, fileID, userID)
	case "rechunk_and_reindex":
		// 重新分块，并建立检索块
		err = sm.executeRechunkAndReindexPipeline(eid, fileID, userID)
	default:
		// 默认模式：仅重新建立检索块
		err = sm.executeReindexPipeline(eid, fileID, userID)
	}

	// 根据执行结果更新文件解析状态
	if err != nil {
		// 更新文件解析状态为失败
		if updateErr := model.UpdateFileParsingStatus(fileID, model.FileParsingStatusFail); updateErr != nil {
			log.Printf("警告: 更新文件解析状态为失败失败: %v\n", updateErr)
		}
		return err
	} else {
		// 更新文件解析状态为正常
		if updateErr := model.UpdateFileParsingStatus(fileID, model.FileParsingStatusNormal); updateErr != nil {
			log.Printf("警告: 更新文件解析状态为正常失败: %v\n", updateErr)
		}
	}

	return nil
}

// executeReindexPipeline 执行重新索引流水线
func (sm *ServiceManager) executeReindexPipeline(eid, fileID, userID int64) error {
	file, err := model.GetFileByID(eid, fileID)
	if err != nil {
		return fmt.Errorf("获取文件信息失败: %v", err)
	}

	// 将参数序列化为JSON字符串
	params := map[string]interface{}{
		"eid":              eid,
		"file_id":          fileID,
		"user_id":          userID,
		"run_ai_index_task": false,
		"origin_status":    file.ConversionStatus,
	}
	paramsJSON, err := json.Marshal(params)
	if err != nil {
		return fmt.Errorf("failed to marshal parameters: %v", err)
	}

	// 创建任务并加入队列，由任务引擎异步处理
	model.UpdateFileParsingStatus(fileID, model.FileParsingStatusPending)
	_, err = GetRagJobFactoryV2().CreateJobsForFile(context.Background(), eid, fileID, string(paramsJSON))
	if err != nil {
		return fmt.Errorf("failed to create reindex job: %v", err)
	}

	return nil
}

// executeRechunkAndReindexPipeline 执行重新分块并索引流水线
func (sm *ServiceManager) executeRechunkAndReindexPipeline(eid, fileID, userID int64) error {
	file, err := model.GetFileByID(eid, fileID)
	if err != nil {
		return fmt.Errorf("获取文件信息失败: %v", err)
	}

	// 将参数序列化为JSON字符串
	params := map[string]interface{}{
		"eid":           eid,
		"file_id":       fileID,
		"user_id":       userID,
		"origin_status": file.ConversionStatus,
	}
	paramsJSON, err := json.Marshal(params)
	if err != nil {
		return fmt.Errorf("failed to marshal parameters: %v", err)
	}

	// 创建任务并加入队列，由任务引擎异步处理
	model.UpdateFileParsingStatus(fileID, model.FileParsingStatusPending)
	_, err = GetRagJobFactoryV2().CreateJobsForFile(context.Background(), eid, fileID, string(paramsJSON))
	if err != nil {
		return fmt.Errorf("failed to create rechunk_and_reindex job: %v", err)
	}

	return nil
}

// reindexRetrievalOnly 仅重新建立检索块
func (sm *ServiceManager) reindexRetrievalOnly(eid, fileID int64, userID int64) error {
	// 使用现有的ReindexDocument方法
	err := sm.chunkerService.ReindexDocument(eid, fileID)
	if err != nil {
		return fmt.Errorf("重新索引检索块失败: %v", err)
	}

	// 异步处理embedding，避免阻塞HTTP请求
	go func() {
		// 添加一些延迟，确保主事务已提交
		time.Sleep(100 * time.Millisecond)

		// 使用统一的embedding批量处理器处理新创建的检索块
		err := sm.ProcessFileEmbedding(eid, fileID)
		if err != nil {
			// embedding处理失败不应该影响主流程，只记录错误
			fmt.Printf("重新索引后embedding处理失败: %v\n", err)
		}
	}()

	return nil
}

// rechunkAndReindex 重新分块并建立检索块
func (sm *ServiceManager) rechunkAndReindex(eid, fileID int64, userID int64) error {
	// 1. 获取文件信息和内容
	var file model.File
	err := sm.db.Where("eid = ? AND id = ?", eid, fileID).First(&file).Error
	if err != nil {
		return fmt.Errorf("获取文件信息失败: %v", err)
	}

	// 2. 获取文件内容
	var fileBody model.FileBody
	err = sm.db.Where("eid = ? AND file_id = ?", eid, fileID).Last(&fileBody).Error
	if err != nil {
		return fmt.Errorf("获取文件内容失败: %v", err)
	}
	content, err := fileBody.GetContent()
	if err != nil {
		return fmt.Errorf("获取文件内容失败: %v", err)
	}

	// 3. 使用事务执行重新分块和索引（前置向量清理：按文件ID删除检索块向量，失败仅记录日志并继续）
	{
		var vectorIDs []string
		if err := sm.db.Model(&model.RetrievalChunk{}).
			Where("eid = ? AND file_id = ? AND vector_id IS NOT NULL AND vector_id != ''", eid, fileID).
			Pluck("vector_id", &vectorIDs).Error; err != nil {
			log.Printf("rechunk_and_reindex 向量清理查询失败，跳过清理 - EID:%d FileID:%d Err:%v", eid, fileID, err)
			rag.CheckEmbeddingStepStatusSave(eid, fileID, fmt.Sprintf("rechunk_and_reindex 向量清理查询失败，跳过清理 - EID:%d FileID:%d Err:%v", eid, fileID, err))
		} else if len(vectorIDs) > 0 {
			ids := make([]interface{}, 0, len(vectorIDs))
			for _, id := range vectorIDs {
				ids = append(ids, id)
			}
			ctx := context.Background()
			cfg := vectorstore.LoadFromEnv()
			store, err := vectorstore.NewVectorStore(cfg)
			if err != nil {
				log.Printf("rechunk_and_reindex 向量存储初始化失败，跳过清理 - EID:%d FileID:%d Err:%v", eid, fileID, err)
				rag.CheckEmbeddingStepStatusSave(eid, fileID, fmt.Sprintf("rechunk_and_reindex 向量存储初始化失败，跳过清理 - EID:%d FileID:%d Err:%v", eid, fileID, err))
			} else {
				// 通过文件获取库信息构建集合名
				var fileInfo model.File
				if err := sm.db.Where("eid = ? AND id = ?", eid, fileID).First(&fileInfo).Error; err != nil {
					log.Printf("rechunk_and_reindex 获取文件信息失败，跳过向量清理 - EID:%d FileID:%d Err:%v", eid, fileID, err)
					rag.CheckEmbeddingStepStatusSave(eid, fileID, fmt.Sprintf("rechunk_and_reindex 获取文件信息失败，跳过清理 - EID:%d FileID:%d Err:%v", eid, fileID, err))
				} else {
					library, err := model.GetLibraryByID(eid, fileInfo.LibraryID)
					if err != nil {
						log.Printf("rechunk_and_reindex 获取库信息失败，跳过向量清理 - EID:%d LibraryID=%d Err:%v", eid, fileInfo.LibraryID, err)
						rag.CheckEmbeddingStepStatusSave(eid, fileID, fmt.Sprintf("rechunk_and_reindex 获取库信息失败，跳过清理 - EID:%d LibraryID=%d Err:%v", eid, fileInfo.LibraryID, err))
					} else {
						collection := model.GetVectorCollectionName(library.UUID)
						if err := store.Delete(ctx, collection, ids); err != nil {
							log.Printf("rechunk_and_reindex 向量批量删除失败（继续流程） - EID:%d FileID:%d Collection:%s Count:%d Err:%v",
								eid, fileID, collection, len(ids), err)
							rag.CheckEmbeddingStepStatusSave(eid, fileID, fmt.Sprintf("rechunk_and_reindex 向量批量删除失败（继续流程） - EID:%d FileID:%d Collection:%s Count:%d Err:%v",
								eid, fileID, collection, len(ids), err))
						} else {
							log.Printf("rechunk_and_reindex 已从向量库删除旧检索块向量 - EID:%d FileID:%d Collection:%s Count:%d",
								eid, fileID, collection, len(ids))
							rag.CheckEmbeddingStepStatusSave(eid, fileID, fmt.Sprintf("已从向量库删除旧检索块向量 - EID:%d FileID:%d Collection:%s Count:%d",
								eid, fileID, collection, len(ids)))
						}
					}
				}
			}
		} else {
			// 无需清理
			rag.CheckEmbeddingStepStatusSave(eid, fileID, "无需清理旧向量")
		}
	}

	// 3. 使用事务执行重新分块和索引
	var result *rag.ChunkResult
	err = sm.db.Transaction(func(tx *gorm.DB) error {
		// 创建临时的chunker服务使用事务
		tempChunkerService := rag.NewChunkerService(tx)

		// 3.1 删除现有的所有分块（知识点分块和检索块）
		err := tx.Where("eid = ? AND file_id = ?", eid, fileID).Delete(&model.DocumentChunk{}).Error
		if err != nil {
			return fmt.Errorf("删除现有知识点分块失败: %v", err)
		}

		err = tx.Where("eid = ? AND file_id = ?", eid, fileID).Delete(&model.RetrievalChunk{}).Error
		if err != nil {
			return fmt.Errorf("删除现有检索块失败: %v", err)
		}

		// 3.2 重新分块文档
		result, err = tempChunkerService.ChunkDocument(eid, fileID, content, nil)
		if err != nil {
			return fmt.Errorf("重新分块文档失败: %v", err)
		}

		// 3.3 在事务中保存新的分块并返回已保存的 DocumentChunk 列表
		var savedDocs []model.DocumentChunk
		if len(result.Chunks) > 0 {
			if err := rag.EnqueueRetrievalChunksByFile(eid, file.ID, file.LibraryID); err != nil {
				return fmt.Errorf("入队检索块失败: %v", err)
			}
			savedDocs, err = tempChunkerService.SaveChunksInTransaction(tx, eid, fileID, result.Chunks)
			if err != nil {
				return fmt.Errorf("在事务中保存新分块失败: %v", err)
			}

			// 基于已保存的 DocumentChunk 在同一事务内按检索配置生成并保存对应的 RetrievalChunk（避免直接拷贝 DocumentChunk）
			configSvc := rag.NewChunkConfigService(tx)
			retrievalSvc := rag.NewRetrievalChunkService(tx)

			for _, doc := range savedDocs {
				// 获取分块配置，若失败使用默认配置
				cfg, cfgErr := configSvc.GetConfigWithFileID(eid, &doc.LibraryID, &doc.FileID)
				if cfgErr != nil {
					cfg = &rag.ChunkConfig{
						IndexChunk: model.IndexChunkingConfig{
							SplitRule:       "\n\n",
							MaxLength:       2000,
							OverlapSize:     100,
							IncludeTitle:    false,
							IncludeFileName: false,
						},
						KnowledgeChunk: model.KnowledgeChunkingConfig{
							SplitRule:       "\n\n",
							MaxLength:       2000,
							OverlapSize:     100,
							IncludeTitle:    false,
							IncludeFileName: false,
						},
						IndexMaxLength:   2000,
						IndexOverlapSize: 100,
					}
					cfg.IndexChunk.ResetBySystemDefault()
					cfg.KnowledgeChunk.ResetBySystemDefault()
				}

				// 使用检索服务按配置为该知识点分块创建检索块（在 tx 上保存并返回）
				createdChunks, createErr := retrievalSvc.CreateRetrievalChunksForKnowledge(eid, &doc, cfg)
				if createErr != nil {
					return fmt.Errorf("在事务中为知识点创建检索块失败: %v", createErr)
				}

				// 为每个检索块创建关联关系（在事务内）
				for _, rc := range createdChunks {
					metadata := &model.RelationMetadataData{
						CreatedReason:  "auto_generated",
						SemanticScore:  1.0,
						PositionScore:  1.0,
						ContentOverlap: 0.8,
					}
					_, relErr := model.CreateChunkRelation(
						eid,
						doc.FileID,
						doc.LibraryID,
						doc.ID,
						rc.ID,
						"auto",
						1.0,
						metadata,
					)
					if relErr != nil {
						// 关联失败记录但不阻断主流程（保持与现有 createRetrievalChunksForUpdatedKnowledge 行为一致）
						fmt.Printf("创建关联关系失败: %v\n", relErr)
					}
				}
			}
		}

		return nil
	})
	if err != nil {
		return fmt.Errorf("failed to create rechunk_and_reindex job: %v", err)
	}

	return nil
}

// Reload 重新加载所有服务（用于配置更新等场景）
func (sm *ServiceManager) Reload() {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	// 重新创建所有服务实例
	sm.chunkerService = rag.NewChunkerService(sm.db)
	sm.retrievalService = rag.NewRetrievalChunkService(sm.db)
	sm.embeddingService = rag.NewEmbeddingService(sm.db)
	sm.batchProcessor = rag.NewEmbeddingBatchProcessor(sm.db)
	sm.configService = rag.NewChunkConfigService(sm.db)
	sm.chunkSaveIntegration = rag.NewChunkSaveIntegration(sm.db)
	sm.autoChunkingService = NewAutoChunkingService(sm.db)
}

// Close 关闭服务管理器（清理资源）
func (sm *ServiceManager) Close() error {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	// 这里可以添加资源清理逻辑
	// 比如关闭连接池、清理缓存等

	return nil
}

// HealthCheck 健康检查
func (sm *ServiceManager) HealthCheck() map[string]interface{} {
	return map[string]interface{}{
		"embedding_healthy":      sm.IsEmbeddingHealthy(),
		"embedding_success_rate": sm.GetEmbeddingSuccessRate(),
		"embedding_stats":        sm.GetEmbeddingStats(),
		"database_connected":     sm.db != nil,
	}
}
