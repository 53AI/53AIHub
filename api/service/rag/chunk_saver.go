package rag

import (
	"context"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/go-sql-driver/mysql"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ChunkSaver 优化的分块保存器
type ChunkSaver struct {
	db         *gorm.DB
	asyncQueue chan *ChunkSaveTask
	workers    []*ChunkSaveWorker
	wg         sync.WaitGroup
	ctx        context.Context
	cancel     context.CancelFunc
	monitor    *ChunkSaveMonitor
	maxRetries int
	retryDelay time.Duration
}

// ChunkSaveTask 分块保存任务
type ChunkSaveTask struct {
	EID       int64
	FileID    int64
	Chunks    []model.DocumentChunk
	Callback  func(error)
	CreatedAt time.Time
}

// ChunkSaveWorker 分块保存工作器
type ChunkSaveWorker struct {
	id    int
	saver *ChunkSaver
	ctx   context.Context
}

// ChunkSaveMonitor 分块保存监控器
type ChunkSaveMonitor struct {
	mu                sync.RWMutex
	totalTasks        int64
	completedTasks    int64
	failedTasks       int64
	totalChunks       int64
	completedChunks   int64
	avgProcessingTime time.Duration
	lastUpdateTime    time.Time
}

// NewChunkSaver 创建分块保存器
func NewChunkSaver(db *gorm.DB) *ChunkSaver {
	ctx, cancel := context.WithCancel(context.Background())

	saver := &ChunkSaver{
		db:         db,
		asyncQueue: make(chan *ChunkSaveTask, config.CHUNK_SAVE_ASYNC_BUFFER_SIZE),
		ctx:        ctx,
		cancel:     cancel,
		monitor:    &ChunkSaveMonitor{lastUpdateTime: time.Now()},
		maxRetries: config.CHUNK_SAVE_MAX_RETRIES,
		retryDelay: time.Duration(config.CHUNK_SAVE_RETRY_DELAY) * time.Millisecond,
	}

	// 启动异步工作器
	if config.CHUNK_SAVE_ASYNC_ENABLED {
		saver.startWorkers()
	}

	return saver
}

// baseSession 返回一个全新的、与事务和请求上下文解耦的 DB 会话，适用于异步写入场景
func (cs *ChunkSaver) baseSession() *gorm.DB {
	// 必须基于全局根 DB 创建新会话，避免从事务派生的会话继续复用已提交/回滚的 *sql.Tx
	rootDB := model.DB
	if rootDB == nil {
		rootDB = cs.db
	}
	return rootDB.Session(&gorm.Session{
		NewDB:                  true,
		SkipDefaultTransaction: true,
		Context:                context.Background(),
	})
}

// SaveChunks 保存分块（主入口）
func (cs *ChunkSaver) SaveChunks(eid int64, fileID int64, chunks []model.DocumentChunk) error {
	if len(chunks) == 0 {
		return nil
	}

	// 更新监控数据
	if config.CHUNK_SAVE_MONITOR_ENABLED {
		cs.monitor.recordTaskStart(len(chunks))
	}

	startTime := time.Now()
	strategy := config.GetChunkSaveStrategy(len(chunks))

	log.Printf("分块保存开始 - 文件ID: %d, 分块数量: %d, 策略: %v", fileID, len(chunks), strategy)

	var err error
	switch strategy {
	case config.StrategyDirect:
		err = cs.SaveChunksDirect(eid, fileID, chunks)
	case config.StrategyBatch:
		err = cs.saveChunksBatch(eid, fileID, chunks)
	case config.StrategyAsync:
		err = cs.saveChunksAsync(eid, fileID, chunks)
	default:
		err = cs.saveChunksBatch(eid, fileID, chunks)
	}

	processingTime := time.Since(startTime)

	// 更新监控数据
	if config.CHUNK_SAVE_MONITOR_ENABLED {
		cs.monitor.recordTaskComplete(err == nil, processingTime)
	}

	if err != nil {
		log.Printf("分块保存失败 - 文件ID: %d, 错误: %v, 耗时: %v", fileID, err, processingTime)
		return err
	}

	log.Printf("分块保存完成 - 文件ID: %d, 分块数量: %d, 耗时: %v", fileID, len(chunks), processingTime)
	return nil
}

// SaveChunksDirect 直接保存（小量分块），改为逐条保存
// 这是一个公开方法，可以在事务中使用
func (cs *ChunkSaver) SaveChunksDirect(eid int64, fileID int64, chunks []model.DocumentChunk) error {
	// 设置基础字段
	for i := range chunks {
		chunks[i].Eid = eid
		chunks[i].FileID = fileID
		if chunks[i].ContentHash == "" {
			chunks[i].ContentHash = chunks[i].GenerateContentHash()
		}
		// 确保LibraryID被设置
		if chunks[i].LibraryID == 0 {
			// 从文件信息中获取LibraryID
			var file model.File
			if err := cs.db.Where("eid = ? AND id = ?", eid, fileID).First(&file).Error; err == nil {
				chunks[i].LibraryID = file.LibraryID
			}
		}
	}

	// 改为逐条保存，避免批量保存问题
	for i, chunk := range chunks {
		err := cs.db.Clauses(clause.OnConflict{
			Columns: []clause.Column{
				{Name: "eid"},
				{Name: "file_id"},
				{Name: "chunk_index"},
			},
			DoUpdates: clause.Assignments(map[string]interface{}{
				"content":          gorm.Expr("VALUES(content)"),
				"chunk_type":       gorm.Expr("VALUES(chunk_type)"),
				"start_position":   gorm.Expr("VALUES(start_position)"),
				"end_position":     gorm.Expr("VALUES(end_position)"),
				"token_count":      gorm.Expr("VALUES(token_count)"),
				"status":           gorm.Expr("VALUES(status)"),
				"is_manual_edited": gorm.Expr("VALUES(is_manual_edited)"),
				"embedding_status": gorm.Expr("VALUES(embedding_status)"),
				"vector_id":        gorm.Expr("VALUES(vector_id)"),
				"chunk_config_id":  gorm.Expr("VALUES(chunk_config_id)"), // 添加chunk_config_id字段
				"updated_time":     gorm.Expr("VALUES(updated_time)"),
			}),
		}).Create(&chunk).Error

		if err != nil {
			log.Printf("保存文档分块失败，索引: %d, 错误: %v", i, err)
			return fmt.Errorf("保存文档分块失败，索引: %d, 错误: %v", i, err)
		}

		log.Printf("成功保存文档分块，索引: %d, ID: %d", i, chunk.ID)
	}

	log.Printf("直接保存完成 - 文件ID: %d, 分块数量: %d", fileID, len(chunks))
	return nil
}

/**
 * saveChunksBatch 分批保存（中量分块）
 * 改为基于根会话执行，彻底与事务解耦，确保同步/异步一致性，避免复用已提交/回滚的事务句柄
 */
func (cs *ChunkSaver) saveChunksBatch(eid int64, fileID int64, chunks []model.DocumentChunk) error {
	// 使用根会话，适用于默认批量保存
	return cs.saveChunksBatchOn(cs.db, eid, fileID, chunks)
}

// saveChunksBatchOn 显式在传入的 db 句柄上执行批量保存（异步使用全新会话，同步使用 cs.db）
func (cs *ChunkSaver) saveChunksBatchOn(db *gorm.DB, eid int64, fileID int64, chunks []model.DocumentChunk) error {
	batchSize := config.GetBatchSize(config.StrategyBatch)
	var LibraryID int64
	var file model.File
	if err := db.Where("eid = ? AND id = ?", eid, fileID).First(&file).Error; err == nil {
		LibraryID = file.LibraryID
	}
	// 设置基础字段
	for i := range chunks {
		chunks[i].Eid = eid
		chunks[i].FileID = fileID
		chunks[i].ContentHash = chunks[i].GenerateContentHash()
		// 确保LibraryID被设置
		if chunks[i].LibraryID == 0 {
			// 从文件信息中获取LibraryID
			chunks[i].LibraryID = LibraryID
		}
	}

	// 分批处理
	for i := 0; i < len(chunks); i += batchSize {
		err := common.CheckRagTaskStop(file.LibraryID, file.ID)
		if err != nil {
			return err
		}

		end := i + batchSize
		if end > len(chunks) {
			end = len(chunks)
		}

		batch := chunks[i:end]

		// 使用传入会话批量写入，不包事务，避免与外层或异步场景发生冲突
		err = db.CreateInBatches(batch, len(batch)).Error

		if err != nil {
			// 如果批次失败，尝试重试（在同一 db 会话上）
			retryErr := cs.retryBatchOn(db, batch)
			if retryErr != nil {
				return fmt.Errorf("批次 %d-%d 保存失败: %v", i, end-1, retryErr)
			}
		}

		log.Printf("分块批次保存完成 - 文件ID: %d, 批次: %d-%d", fileID, i, end-1)
	}

	log.Printf("分块批次保存完成 - 文件ID: %d, 分块数量: %d", fileID, len(chunks))
	return nil
}

// saveChunksAsync 异步保存（大量分块）
func (cs *ChunkSaver) saveChunksAsync(eid int64, fileID int64, chunks []model.DocumentChunk) error {
	if !config.CHUNK_SAVE_ASYNC_ENABLED {
		// 降级到分批保存
		return cs.saveChunksBatchOn(cs.baseSession(), eid, fileID, chunks)
	}

	// 创建异步任务
	task := &ChunkSaveTask{
		EID:       eid,
		FileID:    fileID,
		Chunks:    chunks,
		CreatedAt: time.Now(),
	}

	select {
	case cs.asyncQueue <- task:
		log.Printf("分块保存任务已加入队列 - 文件ID: %d, 分块数量: %d", fileID, len(chunks))
		return nil
	case <-time.After(5 * time.Second):
		return fmt.Errorf("异步队列已满，任务提交超时")
	}
}

// retryBatchOn 在指定 db 会话上执行批次重试
func (cs *ChunkSaver) retryBatchOn(db *gorm.DB, batch []model.DocumentChunk) error {
	maxRetries := config.CHUNK_SAVE_MAX_RETRIES
	retryDelay := time.Duration(config.CHUNK_SAVE_RETRY_DELAY) * time.Millisecond

	for attempt := 1; attempt <= maxRetries; attempt++ {
		time.Sleep(retryDelay * time.Duration(attempt)) // 指数退避

		// 直接执行批量创建，不使用事务，避免 "transaction has already been committed or rolled回" 错误
		err := db.CreateInBatches(batch, len(batch)).Error

		if err == nil {
			log.Printf("批次重试成功 - 尝试次数: %d", attempt)
			return nil
		}

		log.Printf("批次重试失败 - 尝试次数: %d, 错误: %v", attempt, err)
	}

	return fmt.Errorf("批次保存重试 %d 次后仍然失败", maxRetries)
}

func isRetryableError(err error) bool {
	if err == nil {
		return false
	}
	if me, ok := err.(*mysql.MySQLError); ok {
		if me.Number == 1205 || me.Number == 1213 {
			return true
		}
	}
	errStr := err.Error()
	if strings.Contains(errStr, "Lock wait timeout") || strings.Contains(errStr, "deadlock") {
		return true
	}
	return false
}

// isDuplicateKeyError 检查是否为重复键错误
func isDuplicateKeyError(err error) bool {
	if err == nil {
		return false
	}

	if me, ok := err.(*mysql.MySQLError); ok {
		// MySQL错误代码1062表示重复键错误
		return me.Number == 1062
	}

	errStr := err.Error()
	return strings.Contains(errStr, "Duplicate entry") || strings.Contains(errStr, "duplicate key")
}

// handleBatchConflictsIndividually 逐条处理批次冲突
func (s *ChunkSaver) handleBatchConflictsIndividually(batch []model.DocumentChunk, maxRetries int, retryDelay time.Duration) error {
	log.Printf("开始逐条处理批次中的 %d 个分块", len(batch))

	for i, chunk := range batch {
		var err error
		// 尝试插入单个分块
		for attempt := 1; attempt <= maxRetries; attempt++ {
			err = s.db.Create(&chunk).Error
			if err == nil {
				break // 成功插入
			}

			// 如果是重复键错误，则更新现有记录
			if isDuplicateKeyError(err) {
				log.Printf("分块 %d 存在冲突，执行更新操作", chunk.ID)
				err = s.db.Model(&model.DocumentChunk{}).
					Where("eid = ? AND file_id = ? AND chunk_index = ?", chunk.Eid, chunk.FileID, chunk.ChunkIndex).
					Updates(map[string]interface{}{
						"content":          chunk.Content,
						"content_hash":     chunk.ContentHash,
						"chunk_type":       chunk.ChunkType,
						"start_position":   chunk.StartPosition,
						"end_position":     chunk.EndPosition,
						"token_count":      chunk.TokenCount,
						"status":           chunk.Status,
						"is_manual_edited": chunk.IsManualEdited,
						"embedding_status": chunk.EmbeddingStatus,
						"vector_id":        chunk.VectorID,
						"updated_time":     chunk.UpdatedTime,
					}).Error

				if err == nil {
					break // 成功更新
				}
			}

			// 非锁相关错误不重试
			if !isRetryableError(err) {
				log.Printf("处理分块 %d 失败（不可重试错误）: %v", chunk.ID, err)
				return fmt.Errorf("处理分块 %d 失败: %v", chunk.ID, err)
			}

			log.Printf("处理分块 %d 可重试错误 - 尝试: %d, 错误: %v", chunk.ID, attempt, err)
			time.Sleep(retryDelay * time.Duration(attempt))
		}

		if err != nil {
			return fmt.Errorf("处理分块 %d 失败，已达到最大重试次数: %v", chunk.ID, err)
		}

		log.Printf("成功处理分块 %d/%d", i+1, len(batch))
	}

	return nil
}

// startWorkers 启动异步工作器
func (cs *ChunkSaver) startWorkers() {
	workerCount := config.CHUNK_SAVE_ASYNC_WORKERS
	cs.workers = make([]*ChunkSaveWorker, workerCount)

	for i := 0; i < workerCount; i++ {
		worker := &ChunkSaveWorker{
			id:    i,
			saver: cs,
			ctx:   cs.ctx,
		}
		cs.workers[i] = worker

		cs.wg.Add(1)
		go worker.run()
	}

	log.Printf("分块保存异步工作器已启动 - 工作器数量: %d", workerCount)
}

// run 工作器运行循环
func (w *ChunkSaveWorker) run() {
	defer w.saver.wg.Done()

	log.Printf("分块保存工作器 %d 开始运行", w.id)

	for {
		select {
		case task := <-w.saver.asyncQueue:
			w.processTask(task)
		case <-w.ctx.Done():
			log.Printf("分块保存工作器 %d 停止运行", w.id)
			return
		}
	}
}

// processTask 处理异步任务
func (w *ChunkSaveWorker) processTask(task *ChunkSaveTask) {
	log.Printf("工作器 %d 开始处理任务 - 文件ID: %d, 分块数量: %d",
		w.id, task.FileID, len(task.Chunks))

	// 异步路径：使用与事务/上下文解耦的新会话，避免复用已提交/回滚的 tx
	err := w.saver.saveChunksBatchOn(w.saver.baseSession(), task.EID, task.FileID, task.Chunks)

	if task.Callback != nil {
		task.Callback(err)
	}

	if err != nil {
		log.Printf("工作器 %d 任务处理失败 - 文件ID: %d, 错误: %v",
			w.id, task.FileID, err)
	} else {
		log.Printf("工作器 %d 任务处理完成 - 文件ID: %d", w.id, task.FileID)
	}
}

// Close 关闭分块保存器
func (cs *ChunkSaver) Close() {
	if cs.cancel != nil {
		cs.cancel()
	}

	// 等待所有工作器完成
	cs.wg.Wait()

	// 关闭队列
	close(cs.asyncQueue)

	log.Printf("分块保存器已关闭")
}

// GetMonitorStats 获取监控统计信息
func (cs *ChunkSaver) GetMonitorStats() *ChunkSaveMonitor {
	if !config.CHUNK_SAVE_MONITOR_ENABLED {
		return nil
	}

	cs.monitor.mu.RLock()
	defer cs.monitor.mu.RUnlock()

	// 返回副本
	return &ChunkSaveMonitor{
		totalTasks:        cs.monitor.totalTasks,
		completedTasks:    cs.monitor.completedTasks,
		failedTasks:       cs.monitor.failedTasks,
		totalChunks:       cs.monitor.totalChunks,
		completedChunks:   cs.monitor.completedChunks,
		avgProcessingTime: cs.monitor.avgProcessingTime,
		lastUpdateTime:    cs.monitor.lastUpdateTime,
	}
}

// recordTaskStart 记录任务开始
func (m *ChunkSaveMonitor) recordTaskStart(chunkCount int) {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.totalTasks++
	m.totalChunks += int64(chunkCount)
	m.lastUpdateTime = time.Now()
}

// recordTaskComplete 记录任务完成
func (m *ChunkSaveMonitor) recordTaskComplete(success bool, processingTime time.Duration) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if success {
		m.completedTasks++
	} else {
		m.failedTasks++
	}

	// 更新平均处理时间
	if m.completedTasks > 0 {
		m.avgProcessingTime = (m.avgProcessingTime*time.Duration(m.completedTasks-1) + processingTime) / time.Duration(m.completedTasks)
	}

	m.lastUpdateTime = time.Now()
}

// 全局分块保存器实例
var globalChunkSaver *ChunkSaver
var chunkSaverOnce sync.Once

// GetChunkSaver 获取全局分块保存器实例
func GetChunkSaver() *ChunkSaver {
	chunkSaverOnce.Do(func() {
		globalChunkSaver = NewChunkSaver(model.DB)
	})
	return globalChunkSaver
}

// CloseChunkSaver 关闭全局分块保存器
func CloseChunkSaver() {
	if globalChunkSaver != nil {
		globalChunkSaver.Close()
	}
}

// createWithOnConflictAndRetry 在指定 db 会话上使用 ON CONFLICT 执行单条插入并带重试（通用实现）
func createWithOnConflictAndRetry(db *gorm.DB, entity interface{}, conflictCols []clause.Column, updates map[string]interface{}, maxRetries int, retryDelay time.Duration) error {
	var err error
	for attempt := 1; attempt <= maxRetries; attempt++ {
		err = db.Clauses(clause.OnConflict{
			Columns:   conflictCols,
			DoUpdates: clause.Assignments(updates),
		}).Create(entity).Error

		if err == nil {
			return nil
		}

		// 非可重试错误直接返回
		if !isRetryableError(err) {
			return err
		}

		// 可重试：记录并指数退避
		log.Printf("createWithOnConflictAndRetry: 可重试错误 - 尝试: %d, 错误: %v", attempt, err)
		time.Sleep(retryDelay * time.Duration(attempt*attempt))
	}
	return fmt.Errorf("createWithOnConflictAndRetry: 达到最大重试次数 %d: %v", maxRetries, err)
}

// SaveRetrievalChunkWithRetry 为 RetrievalChunk 提供统一的单条保存（带 ON CONFLICT 与重试）
func SaveRetrievalChunkWithRetry(db *gorm.DB, chunk *model.RetrievalChunk, maxRetries int, retryDelay time.Duration) error {
	if db == nil {
		db = model.DB
	}

	// 冲突列：eid, file_id, knowledge_chunk_id, chunk_index, chunk_type
	conflictCols := []clause.Column{
		{Name: "eid"},
		{Name: "file_id"},
		{Name: "knowledge_chunk_id"},
		{Name: "chunk_index"},
		{Name: "chunk_type"},
	}

	var valExpr func(string) clause.Expr
	if db != nil {
		dialect := db.Dialector.Name()
		if dialect == "sqlite" || dialect == "postgres" {
			valExpr = func(col string) clause.Expr { return gorm.Expr("excluded." + col) }
		} else {
			valExpr = func(col string) clause.Expr { return gorm.Expr(fmt.Sprintf("VALUES(%s)", col)) }
		}
	} else {
		valExpr = func(col string) clause.Expr { return gorm.Expr(fmt.Sprintf("VALUES(%s)", col)) }
	}
	updates := map[string]interface{}{
		"content":          valExpr("content"),
		"chunk_type":       valExpr("chunk_type"),
		"start_position":   valExpr("start_position"),
		"end_position":     valExpr("end_position"),
		"token_count":      valExpr("token_count"),
		"status":           valExpr("status"),
		"is_manual_edited": valExpr("is_manual_edited"),
		"embedding_status": valExpr("embedding_status"),
		"vector_id":        valExpr("vector_id"),
		"search_keywords":  valExpr("search_keywords"),
		"search_weight":    valExpr("search_weight"),
		"updated_time":     valExpr("updated_time"),
		"content_hash":     valExpr("content_hash"),
	}

	return createWithOnConflictAndRetry(db, chunk, conflictCols, updates, maxRetries, retryDelay)
}

// SaveRetrievalChunksWithDB 批量保存 RetrievalChunk（可在传入 db 上执行以支持事务）
// 实现策略：尽量批量插入（ON CONFLICT），失败则逐条重试
func SaveRetrievalChunksWithDB(db *gorm.DB, eid int64, fileID int64, chunks []model.RetrievalChunk) error {
	if len(chunks) == 0 {
		return nil
	}
	if db == nil {
		db = model.DB
	}

	log.Printf("SaveRetrievalChunksWithDB: 开始保存检索块，总数=%d, eid=%d, fileID=%d", len(chunks), eid, fileID)

	// 补充基础字段与 content_hash（若缺失）
	for i := range chunks {
		chunks[i].Eid = eid
		chunks[i].FileID = fileID
		if chunks[i].ContentHash == "" {
			chunks[i].ContentHash = chunks[i].GenerateContentHash()
		}
	}

	// 尝试一次性批量写入（带 ON CONFLICT）
	conflictCols := []clause.Column{
		{Name: "eid"},
		{Name: "file_id"},
		{Name: "knowledge_chunk_id"},
		{Name: "chunk_index"},
		{Name: "chunk_type"},
	}
	var valExpr func(string) clause.Expr
	if db != nil {
		dialect := db.Dialector.Name()
		if dialect == "sqlite" || dialect == "postgres" {
			valExpr = func(col string) clause.Expr { return gorm.Expr("excluded." + col) }
		} else {
			valExpr = func(col string) clause.Expr { return gorm.Expr(fmt.Sprintf("VALUES(%s)", col)) }
		}
	} else {
		valExpr = func(col string) clause.Expr { return gorm.Expr(fmt.Sprintf("VALUES(%s)", col)) }
	}
	updates := clause.Assignments(map[string]interface{}{
		"content":          valExpr("content"),
		"chunk_type":       valExpr("chunk_type"),
		"start_position":   valExpr("start_position"),
		"end_position":     valExpr("end_position"),
		"token_count":      valExpr("token_count"),
		"status":           valExpr("status"),
		"is_manual_edited": valExpr("is_manual_edited"),
		"embedding_status": valExpr("embedding_status"),
		"vector_id":        valExpr("vector_id"),
		"search_keywords":  valExpr("search_keywords"),
		"search_weight":    valExpr("search_weight"),
		"updated_time":     valExpr("updated_time"),
		"content_hash":     valExpr("content_hash"),
	})

	// 尝试批量写入（根据传入 db 的能力）
	err := db.Clauses(clause.OnConflict{
		Columns:   conflictCols,
		DoUpdates: updates,
	}).CreateInBatches(chunks, len(chunks)).Error
	if err == nil {
		log.Printf("SaveRetrievalChunksWithDB: 批量写入成功，总数=%d", len(chunks))
		return nil
	}

	// 批量写入失败，回退到逐条重试模式
	log.Printf("SaveRetrievalChunksWithDB: 批量写入失败，回退逐条保存，错误: %v", err)
	maxRetries := config.CHUNK_SAVE_MAX_RETRIES
	retryDelay := time.Duration(config.CHUNK_SAVE_RETRY_DELAY) * time.Millisecond
	for i := range chunks {
		chunk := &chunks[i]
		if err := SaveRetrievalChunkWithRetry(db, chunk, maxRetries, retryDelay); err != nil {
			log.Printf("SaveRetrievalChunksWithDB: 逐条保存失败，索引=%d, err=%v", i, err)
			return fmt.Errorf("保存检索块失败，索引=%d, 错误=%v", i, err)
		}
	}

	log.Printf("SaveRetrievalChunksWithDB: 逐条保存完成，总数=%d", len(chunks))
	return nil
}

// init 在包初始化时将 model 的批量保存委托指向 rag 的实现，避免包循环依赖
func init() {
	model.SaveRetrievalChunksDelegate = func(db *gorm.DB, chunks []model.RetrievalChunk) error {
		if len(chunks) == 0 {
			return nil
		}
		// 使用第一个 chunk 的 Eid 和 FileID 作为批量保存的上下文（呼叫者应保证一致）
		eid := chunks[0].Eid
		fileID := chunks[0].FileID
		return SaveRetrievalChunksWithDB(db, eid, fileID, chunks)
	}
}
