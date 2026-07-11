package rag

import (
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

// EmbeddingBatchProcessor 统一的Embedding批量处理器
type EmbeddingBatchProcessor struct {
	db               *gorm.DB
	retrievalService *RetrievalChunkService
	embeddingService *EmbeddingService
	stats            *ProcessingStats
	maxRetries       int
}

// ProcessingStats 处理统计信息
type ProcessingStats struct {
	TotalProcessed int64     `json:"total_processed"`
	SuccessCount   int64     `json:"success_count"`
	ErrorCount     int64     `json:"error_count"`
	LastProcessed  time.Time `json:"last_processed"`
	mu             sync.RWMutex
}

// BatchProcessOptions 批量处理选项
type BatchProcessOptions struct {
	BatchSize       int           `json:"batch_size"`       // 批量大小
	MaxRetries      int           `json:"max_retries"`      // 最大重试次数
	RetryDelay      time.Duration `json:"retry_delay"`      // 重试延迟
	ConcurrentLimit int           `json:"concurrent_limit"` // 并发限制
	SkipCompleted   bool          `json:"skip_completed"`   // 跳过已完成的
}

// DefaultBatchProcessOptions 默认批量处理选项
func DefaultBatchProcessOptions() *BatchProcessOptions {
	return &BatchProcessOptions{
		BatchSize:       50,
		MaxRetries:      3,
		RetryDelay:      time.Second,
		ConcurrentLimit: 5,
		SkipCompleted:   true,
	}
}

// NewEmbeddingBatchProcessor 创建新的批量处理器
func NewEmbeddingBatchProcessor(db *gorm.DB) *EmbeddingBatchProcessor {
	return &EmbeddingBatchProcessor{
		db:               db,
		retrievalService: NewRetrievalChunkService(db),
		embeddingService: NewEmbeddingService(db),
		stats:            &ProcessingStats{},
		maxRetries:       3,
	}
}

// ProcessFileChunks 统一处理文件的所有检索块
func (p *EmbeddingBatchProcessor) ProcessFileChunks(eid, fileID int64, options ...*BatchProcessOptions) error {
	opts := DefaultBatchProcessOptions()
	if len(options) > 0 && options[0] != nil {
		opts = options[0]
	}

	// 获取待处理的检索块
	chunks, err := model.GetPendingEmbeddingRetrievalChunksByFileID(eid, fileID)
	if err != nil {
		return fmt.Errorf("获取待处理检索块失败: %v", err)
	}

	if len(chunks) == 0 {
		log.Printf("文件 %d 没有待处理的检索块", fileID)
		return nil
	}

	log.Printf("开始处理文件 %d 的 %d 个检索块", fileID, len(chunks))
	return p.ProcessChunkBatch(eid, chunks, opts)
}

// ProcessChunkBatch 批量处理检索块
func (p *EmbeddingBatchProcessor) ProcessChunkBatch(eid int64, chunks []model.RetrievalChunk, options *BatchProcessOptions) error {
	if len(chunks) == 0 {
		return nil
	}

	if options == nil {
		options = DefaultBatchProcessOptions()
	}

	startTime := time.Now()
	successCount := 0
	var errors []error

	// 使用信号量控制并发
	semaphore := make(chan struct{}, options.ConcurrentLimit)
	var wg sync.WaitGroup
	var mu sync.Mutex

	// 分批处理
	for i := 0; i < len(chunks); i += options.BatchSize {
		end := i + options.BatchSize
		if end > len(chunks) {
			end = len(chunks)
		}

		batch := chunks[i:end]

		wg.Add(1)
		go func(batchChunks []model.RetrievalChunk) {
			defer wg.Done()

			// 获取信号量
			semaphore <- struct{}{}
			defer func() { <-semaphore }()

			batchSuccess, batchErrors := p.processBatch(eid, batchChunks, options)

			mu.Lock()
			successCount += batchSuccess
			errors = append(errors, batchErrors...)
			mu.Unlock()
		}(batch)
	}

	wg.Wait()

	// 更新统计信息
	p.updateStats(int64(successCount), int64(len(errors)), time.Now())

	processingTime := time.Since(startTime)
	log.Printf("批量处理完成: 成功 %d/%d, 耗时 %v", successCount, len(chunks), processingTime)

	if len(errors) > 0 {
		log.Printf("处理过程中发生 %d 个错误", len(errors))
		// 返回第一个错误作为代表
		return fmt.Errorf("批量处理部分失败: %d个错误, 首个错误: %v", len(errors), errors[0])
	}

	return nil
}

// ProcessChunksByIDs 根据ID列表批量处理检索块
func (p *EmbeddingBatchProcessor) ProcessChunksByIDs(eid int64, chunkIDs []int64, options ...*BatchProcessOptions) error {
	if len(chunkIDs) == 0 {
		return nil
	}

	opts := DefaultBatchProcessOptions()
	if len(options) > 0 && options[0] != nil {
		opts = options[0]
	}

	// 批量获取检索块信息
	var chunks []model.RetrievalChunk
	err := p.db.Where("eid = ? AND id IN ?", eid, chunkIDs).Find(&chunks).Error
	if err != nil {
		return fmt.Errorf("获取检索块信息失败: %v", err)
	}

	if len(chunks) == 0 {
		return fmt.Errorf("未找到任何检索块")
	}

	log.Printf("根据ID列表处理 %d 个检索块", len(chunks))
	return p.ProcessChunkBatch(eid, chunks, opts)
}

 // ProcessSingleChunk 处理单个分块
func (p *EmbeddingBatchProcessor) ProcessSingleChunk(chunk *model.RetrievalChunk) error {
	// 改为入队，由队列消费者异步处理
	EnqueueRetrievalChunk(chunk.Eid, chunk.FileID, chunk.LibraryID, chunk.ID)
	log.Printf("分块 %d 已入队", chunk.ID)
	return nil
}

// GetStats 获取处理统计信息
func (p *EmbeddingBatchProcessor) GetStats() *ProcessingStats {
	p.stats.mu.RLock()
	defer p.stats.mu.RUnlock()

	return &ProcessingStats{
		TotalProcessed: p.stats.TotalProcessed,
		SuccessCount:   p.stats.SuccessCount,
		ErrorCount:     p.stats.ErrorCount,
		LastProcessed:  p.stats.LastProcessed,
	}
}

// ResetStats 重置统计信息
func (p *EmbeddingBatchProcessor) ResetStats() {
	p.stats.mu.Lock()
	defer p.stats.mu.Unlock()

	p.stats.TotalProcessed = 0
	p.stats.SuccessCount = 0
	p.stats.ErrorCount = 0
	p.stats.LastProcessed = time.Time{}
}

// processBatch 处理单个批次
func (p *EmbeddingBatchProcessor) processBatch(eid int64, chunks []model.RetrievalChunk, options *BatchProcessOptions) (int, []error) {
	successCount := 0
	var errors []error

	for _, chunk := range chunks {
		// 如果设置跳过已完成的，检查状态
		if options.SkipCompleted && model.IsRetrievalChunkEmbeddingSucceeded(chunk.EmbeddingStatus) && chunk.VectorID != "" {
			successCount++ // 已完成的也算成功
			continue
		}

		// 改为直接入队，不在此批处理器内执行embedding
		EnqueueRetrievalChunk(chunk.Eid, chunk.FileID, chunk.LibraryID, chunk.ID)
		successCount++
	}

	return successCount, errors
}

// updateStats 更新统计信息
func (p *EmbeddingBatchProcessor) updateStats(successCount, errorCount int64, timestamp time.Time) {
	p.stats.mu.Lock()
	defer p.stats.mu.Unlock()

	p.stats.TotalProcessed += successCount + errorCount
	p.stats.SuccessCount += successCount
	p.stats.ErrorCount += errorCount
	p.stats.LastProcessed = timestamp
}

// IsHealthy 检查处理器健康状态
func (p *EmbeddingBatchProcessor) IsHealthy() bool {
	stats := p.GetStats()

	// 如果没有处理过任何数据，认为是健康的
	if stats.TotalProcessed == 0 {
		return true
	}

	// 如果错误率超过50%，认为不健康
	errorRate := float64(stats.ErrorCount) / float64(stats.TotalProcessed)
	return errorRate < 0.5
}

// GetSuccessRate 获取成功率
func (p *EmbeddingBatchProcessor) GetSuccessRate() float64 {
	stats := p.GetStats()

	if stats.TotalProcessed == 0 {
		return 0.0
	}

	return float64(stats.SuccessCount) / float64(stats.TotalProcessed)
}
