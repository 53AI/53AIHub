package embedding

import (
	"context"
	"fmt"
	"log"
	"strconv"
	"sync"
	"time"

	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/rag"
	"gorm.io/gorm"
)

// EmbeddingEventType 事件类型
type EmbeddingEventType string

const (
	EventTypeFileChunksCreated       EmbeddingEventType = "file_chunks_created"
	EventTypeRetrievalChunkCreated   EmbeddingEventType = "retrieval_chunk_created"
	EventTypeBatchChunkEvent         EmbeddingEventType = "batch_chunk_event"
	EventTypeChunkCreated            EmbeddingEventType = "chunk_created"
	EventTypeBatchSegmentChunksEvent EmbeddingEventType = "batch_segment_chunks_event"
)

// EmbeddingEvent 事件结构体
type EmbeddingEvent struct {
	ID         string             `json:"id"`
	Type       EmbeddingEventType `json:"type"`
	EID        int64              `json:"eid"`
	FileID     int64              `json:"file_id"`
	LibraryID  int64              `json:"library_id"`
	UserID     int64              `json:"user_id"`
	Timestamp  time.Time          `json:"timestamp"`
	Retries    int                `json:"retries"`
	MaxRetries int                `json:"max_retries"`

	// 具体事件数据
	Data any `json:"data"`
}

// FileChunksCreatedData 文件分块创建事件数据
type FileChunksCreatedData struct {
	// 基础信息已在EmbeddingEvent中
}

// RetrievalChunkCreatedData 检索块创建事件数据
type RetrievalChunkCreatedData struct {
	RetrievalChunkID int64   `json:"retrieval_chunk_id"`
	KnowledgeChunkID int64   `json:"knowledge_chunk_id"`
	ChunkType        string  `json:"chunk_type"`
	Content          string  `json:"content"`
	SearchWeight     float64 `json:"search_weight"`
}

// BatchChunkEventData 批量分块事件数据
type BatchChunkEventData struct {
	ChunkIDs  []int64 `json:"chunk_ids"`
	Operation string  `json:"operation"`
}

// ChunkCreatedData 分块创建事件数据
type ChunkCreatedData struct {
	ChunkID    int64  `json:"chunk_id"`
	ChunkType  string `json:"chunk_type"`
	Content    string `json:"content"`
	TokenCount int    `json:"token_count"`
	ConfigID   *int64 `json:"config_id"`
}

// BatchSegmentChunksEventData 批量段落分块事件数据
type BatchSegmentChunksEventData struct {
	FileID        int64    `json:"file_id"`
	CreatedChunks []string `json:"created_chunks"`
	UpdatedChunks []string `json:"updated_chunks"`
	DeletedChunks []string `json:"deleted_chunks"`
}

// EventWorker 事件处理工作器
type EventWorker struct {
	id      int
	manager *SimpleManager
	ctx     context.Context
}

// SimpleManager 简化的embedding服务管理器
type SimpleManager struct {
	db          *gorm.DB
	running     bool
	mu          sync.RWMutex
	eventQueue  chan *EmbeddingEvent
	workerCount int
	workers     []*EventWorker
	ctx         context.Context
	cancel      context.CancelFunc
	wg          sync.WaitGroup
}

// NewSimpleManager 创建简化的embedding服务管理器
func NewSimpleManager(db *gorm.DB) *SimpleManager {
	return &SimpleManager{
		db:          db,
		workerCount: 3,                               // 默认3个工作器
		eventQueue:  make(chan *EmbeddingEvent, 100), // 队列容量100
	}
}

// Start 启动embedding服务管理器
func (m *SimpleManager) Start(ctx context.Context) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.running {
		return fmt.Errorf("embedding服务管理器已经在运行")
	}

	// 创建上下文
	m.ctx, m.cancel = context.WithCancel(ctx)

	// 启动工作器
	m.workers = make([]*EventWorker, m.workerCount)
	for i := 0; i < m.workerCount; i++ {
		worker := &EventWorker{
			id:      i,
			manager: m,
			ctx:     m.ctx,
		}
		m.workers[i] = worker

		m.wg.Add(1)
		go worker.run()
	}

	m.running = true
	log.Printf("Embedding服务管理器已启动，工作器数量: %d", m.workerCount)

	return nil
}

// Stop 停止embedding服务管理器
func (m *SimpleManager) Stop() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if !m.running {
		return nil
	}

	// 取消上下文，停止所有工作器
	if m.cancel != nil {
		m.cancel()
	}

	// 关闭事件队列
	close(m.eventQueue)

	m.running = false

	// 等待所有工作器完成
	m.wg.Wait()

	log.Println("Embedding服务管理器已停止")

	return nil
}

// IsRunning 检查是否正在运行
func (m *SimpleManager) IsRunning() bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.running
}

// run 工作器运行逻辑
func (w *EventWorker) run() {
	defer w.manager.wg.Done()

	log.Printf("Embedding工作器 %d 已启动", w.id)

	for {
		select {
		case <-w.ctx.Done():
			log.Printf("Embedding工作器 %d 收到停止信号", w.id)
			return
		case event, ok := <-w.manager.eventQueue:
			if !ok {
				log.Printf("Embedding工作器 %d 事件队列已关闭", w.id)
				return
			}

			// 处理事件
			w.processEvent(event)
		}
	}
}

// processEvent 处理单个事件
func (w *EventWorker) processEvent(event *EmbeddingEvent) {
	log.Printf("工作器 %d 处理事件: Type=%s, EID=%d, FileID=%d",
		w.id, event.Type, event.EID, event.FileID)

	var err error

	switch event.Type {
	case EventTypeFileChunksCreated:
		err = w.processFileChunksCreated(event)
	case EventTypeRetrievalChunkCreated:
		err = w.processRetrievalChunkCreated(event)
	case EventTypeBatchChunkEvent:
		err = w.processBatchChunkEvent(event)
	case EventTypeChunkCreated:
		err = w.processChunkCreated(event)
	case EventTypeBatchSegmentChunksEvent:
		err = w.processBatchSegmentChunksEvent(event)
	default:
		log.Printf("工作器 %d 未知事件类型: %s", w.id, event.Type)
		return
	}

	if err != nil {
		log.Printf("工作器 %d 处理事件失败: %v", w.id, err)

		// 重试逻辑
		if event.Retries < event.MaxRetries {
			event.Retries++
			log.Printf("工作器 %d 重试事件 (第%d次): %s", w.id, event.Retries, event.Type)

			// 延迟重试
			go func() {
				time.Sleep(time.Duration(event.Retries) * time.Second)
				select {
				case w.manager.eventQueue <- event:
					// 重新入队成功
				case <-w.ctx.Done():
					// 管理器已停止
				}
			}()
		} else {
			log.Printf("工作器 %d 事件重试次数已达上限，放弃处理: %s", w.id, event.Type)
		}
	} else {
		log.Printf("工作器 %d 成功处理事件: %s", w.id, event.Type)
	}
}

// processFileChunksCreated 处理文件分块创建事件
func (w *EventWorker) processFileChunksCreated(event *EmbeddingEvent) error {
	// 获取文件的所有待向量化的检索块
	retrievalChunks, err := model.GetPendingEmbeddingRetrievalChunksByFileID(event.EID, event.FileID)
	if err != nil {
		return fmt.Errorf("获取待向量化检索块失败: %v", err)
	}

	// 如果没有待处理的检索块，则创建默认检索块
	if len(retrievalChunks) == 0 {
		log.Printf("文件 %d 没有待向量化的检索块，尝试创建默认检索块", event.FileID)

		// 检查是否已存在任何检索块
		existingChunks, err := model.GetRetrievalChunksByFileID(event.EID, event.FileID)
		if err != nil {
			return fmt.Errorf("检查现有检索块失败: %v", err)
		}

		// 如果没有任何检索块，则创建默认检索块
		if len(existingChunks) == 0 {
			err = w.createDefaultRetrievalChunks(event)
			if err != nil {
				return fmt.Errorf("创建默认检索块失败: %v", err)
			}

			// 重新获取待处理的检索块
			retrievalChunks, err = model.GetPendingEmbeddingRetrievalChunksByFileID(event.EID, event.FileID)
			if err != nil {
				return fmt.Errorf("重新获取待向量化检索块失败: %v", err)
			}
		} else {
			log.Printf("文件 %d 已存在检索块，但没有待向量化的检索块", event.FileID)
			return nil
		}
	}

	if len(retrievalChunks) == 0 {
		log.Printf("文件 %d 没有待向量化的检索块", event.FileID)
		return nil
	}

	// 创建检索块服务并处理embedding
	retrievalService := rag.NewRetrievalChunkService(w.manager.db)
	successCount := 0

	// 跟踪处理过的KnowledgeChunkID
	processedKnowledgeChunkIDs := make(map[int64]bool)

	for _, chunk := range retrievalChunks {
		// 记录处理过的KnowledgeChunkID
		processedKnowledgeChunkIDs[chunk.KnowledgeChunkID] = true

		err := retrievalService.ProcessEmbeddingForRetrievalChunk(event.EID, &chunk)
		if err != nil {
			log.Printf("工作器 %d - 检索块 %d embedding 处理失败: %v", w.id, chunk.ID, err)
			// 更新检索块状态为失败
			updateErr := retrievalService.UpdateRetrievalChunkEmbeddingStatus(chunk.ID, model.RetrievalChunkEmbeddingStatusFailed, "", err.Error())
			if updateErr != nil {
				log.Printf("更新检索块 %d 状态为失败时出错: %v", chunk.ID, updateErr)
			}
			// 更新对应的DocumentChunk状态
			w.updateDocumentChunkStatusBasedOnRetrievalChunks(event.EID, chunk.KnowledgeChunkID)
			continue
		}

		// 更新检索块状态为完成
		err = retrievalService.UpdateRetrievalChunkEmbeddingStatus(chunk.ID, model.RetrievalChunkEmbeddingStatusNormal, "", "")
		if err != nil {
			log.Printf("更新检索块 %d 状态为完成时出错: %v", chunk.ID, err)
		}

		// 更新对应的DocumentChunk状态
		w.updateDocumentChunkStatusBasedOnRetrievalChunks(event.EID, chunk.KnowledgeChunkID)
		successCount++
	}

	// 确保所有相关的DocumentChunk状态都被更新
	for knowledgeChunkID := range processedKnowledgeChunkIDs {
		w.updateDocumentChunkStatusBasedOnRetrievalChunks(event.EID, knowledgeChunkID)
	}

	log.Printf("工作器 %d - 文件 %d 处理完成: 成功 %d/%d", w.id, event.FileID, successCount, len(retrievalChunks))
	return nil
}

// createDefaultRetrievalChunks 为文件创建默认检索块
func (w *EventWorker) createDefaultRetrievalChunks(event *EmbeddingEvent) error {
	// 获取文件的所有知识点分块
	documentChunks, err := model.GetDocumentChunksByFileID(event.EID, event.FileID, 0, 0)
	if err != nil {
		return fmt.Errorf("获取知识点分块失败: %v", err)
	}

	if len(documentChunks) == 0 {
		log.Printf("文件 %d 没有知识点分块，无需创建检索块", event.FileID)
		return nil
	}

	// 创建检索块服务和配置服务
	retrievalService := rag.NewRetrievalChunkService(w.manager.db)
	configService := rag.NewChunkConfigService(w.manager.db)

	// 为每个知识点分块创建检索块
	createdCount := 0
	for _, docChunk := range documentChunks {
		// 获取分块配置，若失败使用默认配置
		cfg, cfgErr := configService.GetConfigWithFileID(event.EID, &docChunk.LibraryID, &docChunk.FileID)
		if cfgErr != nil {
			cfg = &rag.ChunkConfig{
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

		// 使用检索服务按配置为该知识点分块创建检索块
		createdChunks, createErr := retrievalService.CreateRetrievalChunksForKnowledge(event.EID, &docChunk, cfg)
		if createErr != nil {
			log.Printf("为知识点分块 %d 创建检索块失败: %v", docChunk.ID, createErr)
			continue
		}

		// 为每个检索块创建关联关系
		for _, rc := range createdChunks {
			metadata := &model.RelationMetadataData{
				CreatedReason:  "auto_generated_default",
				SemanticScore:  1.0,
				PositionScore:  1.0,
				ContentOverlap: 0.8,
			}
			_, relErr := model.CreateChunkRelation(
				event.EID,
				docChunk.FileID,
				docChunk.LibraryID,
				docChunk.ID,
				rc.ID,
				"auto",
				1.0,
				metadata,
			)
			if relErr != nil {
				log.Printf("创建关联关系失败: %v", relErr)
			}
		}

		createdCount += len(createdChunks)
	}

	log.Printf("为文件 %d 创建了 %d 个默认检索块", event.FileID, createdCount)
	return nil
}

// processRetrievalChunkCreated 处理检索块创建事件
func (w *EventWorker) processRetrievalChunkCreated(event *EmbeddingEvent) error {
	data, ok := event.Data.(*RetrievalChunkCreatedData)
	if !ok {
		return fmt.Errorf("无效的检索块创建事件数据")
	}

	// 获取检索块信息
	var chunk model.RetrievalChunk
	err := w.manager.db.Where("eid = ? AND id = ?", event.EID, data.RetrievalChunkID).First(&chunk).Error
	if err != nil {
		return fmt.Errorf("获取检索块信息失败: %v", err)
	}

	// 创建检索块服务并处理embedding
	retrievalService := rag.NewRetrievalChunkService(w.manager.db)
	err = retrievalService.ProcessEmbeddingForRetrievalChunk(event.EID, &chunk)
	if err != nil {
		// 更新检索块状态为失败
		updateErr := retrievalService.UpdateRetrievalChunkEmbeddingStatus(chunk.ID, model.RetrievalChunkEmbeddingStatusFailed, "", err.Error())
		if updateErr != nil {
			log.Printf("更新检索块 %d 状态为失败时出错: %v", chunk.ID, updateErr)
		}

		// 更新对应的DocumentChunk状态为失败
		w.updateDocumentChunkStatusBasedOnRetrievalChunks(event.EID, chunk.KnowledgeChunkID)

		return fmt.Errorf("检索块 %d embedding 处理失败: %v", data.RetrievalChunkID, err)
	}

	// 更新检索块状态为完成
	err = retrievalService.UpdateRetrievalChunkEmbeddingStatus(chunk.ID, model.RetrievalChunkEmbeddingStatusNormal, "", "")
	if err != nil {
		log.Printf("更新检索块 %d 状态为完成时出错: %v", chunk.ID, err)
	}

	// 更新对应的DocumentChunk状态
	w.updateDocumentChunkStatusBasedOnRetrievalChunks(event.EID, chunk.KnowledgeChunkID)

	log.Printf("工作器 %d - 检索块 %d 处理成功", w.id, data.RetrievalChunkID)
	return nil
}

// processBatchChunkEvent 处理批量分块事件
func (w *EventWorker) processBatchChunkEvent(event *EmbeddingEvent) error {
	data, ok := event.Data.(*BatchChunkEventData)
	if !ok {
		return fmt.Errorf("无效的批量分块事件数据")
	}

	if len(data.ChunkIDs) == 0 {
		return nil
	}

	retrievalService := rag.NewRetrievalChunkService(w.manager.db)
	successCount := 0

	// 用于跟踪需要更新DocumentChunk状态的KnowledgeChunkIDs
	updatedKnowledgeChunkIDs := make(map[int64]bool)

	for _, chunkID := range data.ChunkIDs {
		// 获取检索块信息
		var chunk model.RetrievalChunk
		err := w.manager.db.Where("eid = ? AND id = ?", event.EID, chunkID).First(&chunk).Error
		if err != nil {
			log.Printf("工作器 %d - 获取检索块信息失败: ChunkID=%d, Error=%v", w.id, chunkID, err)
			continue
		}

		// 处理embedding
		err = retrievalService.ProcessEmbeddingForRetrievalChunk(event.EID, &chunk)
		if err != nil {
			log.Printf("工作器 %d - 检索块 %d embedding 处理失败: %v", w.id, chunkID, err)
			// 更新检索块状态为失败
			updateErr := retrievalService.UpdateRetrievalChunkEmbeddingStatus(chunk.ID, model.RetrievalChunkEmbeddingStatusFailed, "", err.Error())
			if updateErr != nil {
				log.Printf("更新检索块 %d 状态为失败时出错: %v", chunk.ID, updateErr)
			}
			// 记录需要更新DocumentChunk状态的KnowledgeChunkID
			updatedKnowledgeChunkIDs[chunk.KnowledgeChunkID] = true
			continue
		}

		// 更新检索块状态为完成
		err = retrievalService.UpdateRetrievalChunkEmbeddingStatus(chunk.ID, model.RetrievalChunkEmbeddingStatusNormal, "", "")
		if err != nil {
			log.Printf("更新检索块 %d 状态为完成时出错: %v", chunk.ID, err)
		}

		// 记录需要更新DocumentChunk状态的KnowledgeChunkID
		updatedKnowledgeChunkIDs[chunk.KnowledgeChunkID] = true
		successCount++
	}

	// 更新相关的DocumentChunk状态
	for knowledgeChunkID := range updatedKnowledgeChunkIDs {
		w.updateDocumentChunkStatusBasedOnRetrievalChunks(event.EID, knowledgeChunkID)
	}

	log.Printf("工作器 %d - 批量处理完成: 成功 %d/%d", w.id, successCount, len(data.ChunkIDs))
	return nil
}

// processChunkCreated 处理分块创建事件
func (w *EventWorker) processChunkCreated(event *EmbeddingEvent) error {
	data, ok := event.Data.(*ChunkCreatedData)
	if !ok {
		return fmt.Errorf("无效的分块创建事件数据")
	}

	// 创建embedding服务
	embeddingService := rag.NewEmbeddingService(w.manager.db)

	// 处理分块embedding
	err := embeddingService.ProcessChunkEmbedding(event.EID, data.ChunkID)
	if err != nil {
		return fmt.Errorf("分块 %d embedding 处理失败: %v", data.ChunkID, err)
	}

	log.Printf("工作器 %d - 分块 %d 处理成功", w.id, data.ChunkID)
	return nil
}

// processBatchSegmentChunksEvent 处理批量段落分块事件
func (w *EventWorker) processBatchSegmentChunksEvent(event *EmbeddingEvent) error {
	data, ok := event.Data.(*BatchSegmentChunksEventData)
	if !ok {
		return fmt.Errorf("无效的批量段落分块事件数据")
	}

	// 获取文件信息以获取eid和libraryID
	var file model.File
	err := w.manager.db.Where("id = ?", data.FileID).First(&file).Error
	if err != nil {
		return fmt.Errorf("获取文件信息失败: %v", err)
	}

	// 收集需要处理embedding的文档分块ID
	var docChunkIDs []int64

	// 新创建的分块需要embedding
	for _, chunkIDStr := range data.CreatedChunks {
		if chunkID, err := strconv.ParseInt(chunkIDStr, 10, 64); err == nil {
			docChunkIDs = append(docChunkIDs, chunkID)
		}
	}

	// 更新的分块也需要重新embedding
	for _, chunkIDStr := range data.UpdatedChunks {
		if chunkID, err := strconv.ParseInt(chunkIDStr, 10, 64); err == nil {
			docChunkIDs = append(docChunkIDs, chunkID)
		}
	}

	if len(docChunkIDs) > 0 {
		// 只处理状态为 pending 的分块
		var pendingChunks []model.DocumentChunk
		err := w.manager.db.Where("eid = ? AND id IN ? AND embedding_status = ?", file.Eid, docChunkIDs, model.DocumentChunkEmbeddingStatusPending).
			Find(&pendingChunks).Error
		if err != nil {
			log.Printf("获取状态为 pending 的文档分块失败: FileID=%d, Error=%v", data.FileID, err)
			return err
		}

		if len(pendingChunks) > 0 {
			// 获取这些文档分块对应的检索块
			var pendingChunkIDs []int64
			for _, chunk := range pendingChunks {
				pendingChunkIDs = append(pendingChunkIDs, chunk.ID)
			}

			var retrievalChunks []model.RetrievalChunk
			err := w.manager.db.Where("eid = ? AND file_id = ? AND knowledge_chunk_id IN ?", file.Eid, data.FileID, pendingChunkIDs).
				Find(&retrievalChunks).Error
			if err != nil {
				log.Printf("获取检索块信息失败: FileID=%d, Error=%v", data.FileID, err)
				return err
			}

			if len(retrievalChunks) > 0 {
				// 创建检索块服务并处理embedding
				retrievalService := rag.NewRetrievalChunkService(w.manager.db)
				successCount := 0

				// 逐个处理检索块的embedding
				for _, chunk := range retrievalChunks {
					// 复制循环变量避免闭包问题
					chunkCopy := chunk
					err = retrievalService.ProcessEmbeddingForRetrievalChunk(file.Eid, &chunkCopy)
					if err != nil {
						log.Printf("检索块 %d embedding 处理失败: %v", chunk.ID, err)
						// 更新检索块状态为失败
						updateErr := retrievalService.UpdateRetrievalChunkEmbeddingStatus(chunk.ID, model.RetrievalChunkEmbeddingStatusFailed, "", err.Error())
						if updateErr != nil {
							log.Printf("更新检索块 %d 状态为失败时出错: %v", chunk.ID, updateErr)
						}
						continue
					}
					successCount++
				}

				log.Printf("批量embedding处理完成: 文件ID=%d, 成功=%d/%d", data.FileID, successCount, len(retrievalChunks))

				// 更新文档分块状态基于检索块的状态
				processedKnowledgeChunkIDs := make(map[int64]bool)
				for _, chunk := range retrievalChunks {
					processedKnowledgeChunkIDs[chunk.KnowledgeChunkID] = true
				}

				// 确保所有相关的DocumentChunk状态都被更新
				for knowledgeChunkID := range processedKnowledgeChunkIDs {
					w.updateDocumentChunkStatusBasedOnRetrievalChunks(file.Eid, knowledgeChunkID)
				}
			} else {
				log.Printf("未找到需要处理的检索块: 文件ID=%d, 文档分块数量=%d", data.FileID, len(pendingChunkIDs))

				// 即使没有检索块，也需要更新文档分块状态
				for _, docChunkID := range pendingChunkIDs {
					// 如果文档分块没有对应的检索块，且UpdateRetrievalChunk为false，则状态应为completed
					err := model.UpdateChunkEmbeddingStatus(file.Eid, docChunkID, model.DocumentChunkEmbeddingStatusNormal, "")
					if err != nil {
						log.Printf("更新文档分块 %d 状态为完成时出错: %v", docChunkID, err)
					}
				}
			}
		} else {
			log.Printf("没有状态为 pending 的文档分块需要处理: 文件ID=%d", data.FileID)
		}
	}

	return nil
}

// 全局简化embedding管理器实例
var globalSimpleManager *SimpleManager
var globalSimpleManagerOnce sync.Once

// GetGlobalSimpleManager 获取全局简化embedding管理器
func GetGlobalSimpleManager(db *gorm.DB) *SimpleManager {
	globalSimpleManagerOnce.Do(func() {
		globalSimpleManager = NewSimpleManager(db)
	})
	return globalSimpleManager
}

// StartGlobalSimpleManager 启动全局简化embedding管理器
func StartGlobalSimpleManager(ctx context.Context, db *gorm.DB) error {
	manager := GetGlobalSimpleManager(db)
	return manager.Start(ctx)
}

// StopGlobalSimpleManager 停止全局简化embedding管理器
func StopGlobalSimpleManager() error {
	if globalSimpleManager != nil {
		return globalSimpleManager.Stop()
	}
	return nil
}

// IsSimpleEmbeddingManagerInitialized 检查简化embedding管理器是否已初始化
func IsSimpleEmbeddingManagerInitialized() bool {
	return globalSimpleManager != nil && globalSimpleManager.IsRunning()
}

// EnsureSimpleEmbeddingManagerInitialized 确保简化embedding管理器已初始化
func EnsureSimpleEmbeddingManagerInitialized(db *gorm.DB) {
	if !IsSimpleEmbeddingManagerInitialized() {
		log.Println("简化Embedding管理器未初始化，尝试初始化...")
		err := StartGlobalSimpleManager(context.Background(), db)
		if err != nil {
			log.Printf("初始化简化embedding管理器失败: %v", err)
		} else {
			log.Println("简化Embedding管理器初始化成功")
		}
	}
}

// publishEvent 发布事件到队列
func (m *SimpleManager) publishEvent(event *EmbeddingEvent) error {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if !m.running {
		return fmt.Errorf("embedding管理器未运行")
	}

	// 设置默认值
	if event.Timestamp.IsZero() {
		event.Timestamp = time.Now()
	}
	if event.MaxRetries == 0 {
		event.MaxRetries = 3 // 默认重试3次
	}

	// 生成事件ID
	if event.ID == "" {
		event.ID = fmt.Sprintf("%s_%d_%d_%d", event.Type, event.EID, event.FileID, event.Timestamp.Unix())
	}

	select {
	case m.eventQueue <- event:
		return nil
	default:
		return fmt.Errorf("事件队列已满")
	}
}

// 事件发布函数（实际的事件发布逻辑）
func PublishChunkCreatedSimple(eid, fileID, libraryID, userID, chunkID int64, chunkType, content string, tokenCount int, configID *int64) error {
	if globalSimpleManager == nil || !globalSimpleManager.IsRunning() {
		return fmt.Errorf("embedding管理器未初始化或未运行")
	}

	event := &EmbeddingEvent{
		Type:      EventTypeChunkCreated,
		EID:       eid,
		FileID:    fileID,
		LibraryID: libraryID,
		UserID:    userID,
		Data: &ChunkCreatedData{
			ChunkID:    chunkID,
			ChunkType:  chunkType,
			Content:    content,
			TokenCount: tokenCount,
			ConfigID:   configID,
		},
	}

	return globalSimpleManager.publishEvent(event)
}

func PublishRetrievalChunkCreatedSimple(eid, fileID, libraryID, userID, retrievalChunkID, knowledgeChunkID int64, chunkType, content string, searchWeight float64) error {
	if globalSimpleManager == nil || !globalSimpleManager.IsRunning() {
		return fmt.Errorf("embedding管理器未初始化或未运行")
	}

	event := &EmbeddingEvent{
		Type:      EventTypeRetrievalChunkCreated,
		EID:       eid,
		FileID:    fileID,
		LibraryID: libraryID,
		UserID:    userID,
		Data: &RetrievalChunkCreatedData{
			RetrievalChunkID: retrievalChunkID,
			KnowledgeChunkID: knowledgeChunkID,
			ChunkType:        chunkType,
			Content:          content,
			SearchWeight:     searchWeight,
		},
	}

	return globalSimpleManager.publishEvent(event)
}

func PublishFileChunksCreatedSimple(eid, fileID, libraryID, userID int64) error {
	if globalSimpleManager == nil || !globalSimpleManager.IsRunning() {
		return fmt.Errorf("embedding管理器未初始化或未运行")
	}

	event := &EmbeddingEvent{
		Type:      EventTypeFileChunksCreated,
		EID:       eid,
		FileID:    fileID,
		LibraryID: libraryID,
		UserID:    userID,
		Data:      &FileChunksCreatedData{},
	}

	return globalSimpleManager.publishEvent(event)
}

func PublishBatchChunkEventSimple(eid, fileID, libraryID, userID int64, chunkIDs []int64, operation string) error {
	if globalSimpleManager == nil || !globalSimpleManager.IsRunning() {
		return fmt.Errorf("embedding管理器未初始化或未运行")
	}

	event := &EmbeddingEvent{
		Type:      EventTypeBatchChunkEvent,
		EID:       eid,
		FileID:    fileID,
		LibraryID: libraryID,
		UserID:    userID,
		Data: &BatchChunkEventData{
			ChunkIDs:  chunkIDs,
			Operation: operation,
		},
	}

	return globalSimpleManager.publishEvent(event)
}

func PublishBatchSegmentChunksEventSimple(eid, fileID, libraryID, userID int64, createdChunks, updatedChunks, deletedChunks []string) error {
	if globalSimpleManager == nil || !globalSimpleManager.IsRunning() {
		return fmt.Errorf("embedding管理器未初始化或未运行")
	}

	event := &EmbeddingEvent{
		Type:      EventTypeBatchSegmentChunksEvent,
		EID:       eid,
		FileID:    fileID,
		LibraryID: libraryID,
		UserID:    userID,
		Data: &BatchSegmentChunksEventData{
			FileID:        fileID,
			CreatedChunks: createdChunks,
			UpdatedChunks: updatedChunks,
			DeletedChunks: deletedChunks,
		},
	}

	return globalSimpleManager.publishEvent(event)
}

// GetQueueStatus 获取队列状态
func (m *SimpleManager) GetQueueStatus() map[string]interface{} {
	m.mu.RLock()
	defer m.mu.RUnlock()

	return map[string]interface{}{
		"running":      m.running,
		"worker_count": m.workerCount,
		"queue_length": len(m.eventQueue),
		"queue_cap":    cap(m.eventQueue),
	}
}

// SetWorkerCount 设置工作器数量（仅在停止状态下有效）
func (m *SimpleManager) SetWorkerCount(count int) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.running {
		return fmt.Errorf("无法在运行时修改工作器数量")
	}

	if count <= 0 {
		return fmt.Errorf("工作器数量必须大于0")
	}

	m.workerCount = count
	return nil
}

// SetQueueCapacity 设置队列容量（仅在停止状态下有效）
func (m *SimpleManager) SetQueueCapacity(capacity int) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.running {
		return fmt.Errorf("无法在运行时修改队列容量")
	}

	if capacity <= 0 {
		return fmt.Errorf("队列容量必须大于0")
	}

	m.eventQueue = make(chan *EmbeddingEvent, capacity)
	return nil
}

// updateDocumentChunkStatusBasedOnRetrievalChunks 根据检索块的处理状态更新DocumentChunk的EmbeddingStatus
func (w *EventWorker) updateDocumentChunkStatusBasedOnRetrievalChunks(eid, knowledgeChunkID int64) {
	// 获取与该DocumentChunk关联的所有检索块
	retrievalChunks, err := model.GetRetrievalChunksByKnowledgeID(eid, knowledgeChunkID)
	if err != nil {
		log.Printf("获取知识点分块 %d 的检索块失败: %v", knowledgeChunkID, err)
		return
	}

	if len(retrievalChunks) == 0 {
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
		log.Printf("更新知识点分块 %d 状态为处理中时出错: %v", knowledgeChunkID, err)
	}
}

// GetGlobalManagerStatus 获取全局管理器状态
func GetGlobalManagerStatus() map[string]interface{} {
	if globalSimpleManager == nil {
		return map[string]interface{}{
			"initialized": false,
			"running":     false,
		}
	}

	status := globalSimpleManager.GetQueueStatus()
	status["initialized"] = true
	return status
}
