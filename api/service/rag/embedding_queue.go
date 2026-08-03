package rag

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/vectorstore"
	"github.com/go-redis/redis/v8"
	"gorm.io/gorm"
)

// EmbeddingTask represents a single retrieval chunk embedding task
type EmbeddingTask struct {
	Eid              int64  `json:"eid"`
	RetrievalChunkID int64  `json:"retrieval_chunk_id"`
	FileID           int64  `json:"file_id"`
	LibraryID        int64  `json:"library_id"`
	TraceID          string `json:"trace_id,omitempty"`
	EnqueuedAt       int64  `json:"enqueued_at"`
	Retries          int    `json:"retries"`
}

// WorkerOptions controls worker behavior
type WorkerOptions struct {
	DefaultConcurrency int
	MaxRetries         int
	DedupTTL           time.Duration
	LockTTL            time.Duration
	ReadBlock          time.Duration
	RetryBackoff       time.Duration
	StreamPrefix       string
	GroupName          string
	PendingIdleFor     time.Duration
}

// EmbeddingQueue is the interface for enqueue and worker management
type EmbeddingQueue interface {
	EnqueueIfNotExists(ctx context.Context, task EmbeddingTask) (bool, error)
	StartOrUpdateWorkers(ctx context.Context, eid int64) error
	Shutdown(ctx context.Context) error
}

// package-level queue holder for injection from router/controller
var defaultEmbeddingQueue EmbeddingQueue

func SetDefaultEmbeddingQueue(q EmbeddingQueue) {
	defaultEmbeddingQueue = q
}

func GetDefaultEmbeddingQueue() EmbeddingQueue {
	return defaultEmbeddingQueue
}

// embeddingRedisQueue implements EmbeddingQueue using Redis Streams
type embeddingRedisQueue struct {
	rdb       redis.Cmdable
	opts      WorkerOptions
	workersMu sync.Mutex
	workers   map[int64]*eidWorkerPool // per-eid pool
}

type eidWorkerPool struct {
	eid        int64
	concurrent int
	cancel     context.CancelFunc
	wg         sync.WaitGroup
}

// NewEmbeddingQueue constructs a queue with redis client and options
func NewEmbeddingQueue(rdb redis.Cmdable, opts WorkerOptions) *embeddingRedisQueue {
	if opts.StreamPrefix == "" {
		opts.StreamPrefix = "rag:emb:stream"
	}
	if opts.GroupName == "" {
		opts.GroupName = "rag:emb:group"
	}
	if opts.DefaultConcurrency <= 0 {
		opts.DefaultConcurrency = 5
	}
	if opts.MaxRetries <= 0 {
		opts.MaxRetries = 3
	}
	if opts.DedupTTL <= 0 {
		opts.DedupTTL = 30 * time.Minute
	}
	if opts.LockTTL <= 0 {
		opts.LockTTL = 60 * time.Second
	}
	if opts.ReadBlock <= 0 {
		opts.ReadBlock = 5 * time.Second
	}
	if opts.RetryBackoff <= 0 {
		opts.RetryBackoff = 5 * time.Second
	}
	if opts.PendingIdleFor <= 0 {
		opts.PendingIdleFor = 2 * time.Minute
	}

	q := &embeddingRedisQueue{
		rdb:     rdb,
		opts:    opts,
		workers: make(map[int64]*eidWorkerPool),
	}

	// Start cleanup routine for abandoned tasks
	q.startCleanupRoutine(context.Background())

	return q
}

func (q *embeddingRedisQueue) getListKey(eid int64) string {
	prefix := q.opts.StreamPrefix
	if prefix == "" {
		prefix = "rag:emb:list"
	} else {
		prefix = strings.ReplaceAll(prefix, ":stream", ":list")
	}
	return fmt.Sprintf("%s:%d", prefix, eid)
}

func (q *embeddingRedisQueue) dedupKey(eid, rid int64) string {
	return DedupKey(eid, rid)
}

// DedupKey 暴露 dedup key 格式，供外部清理时保持格式一致
func DedupKey(eid, rid int64) string {
	return fmt.Sprintf("rag:emb:dedup:%d:%d", eid, rid)
}

func (q *embeddingRedisQueue) lockKey(eid, rid int64) string {
	return fmt.Sprintf("rag:emb:lock:%d:%d", eid, rid)
}

func (q *embeddingRedisQueue) abandonedKey(eid int64) string {
	return fmt.Sprintf("rag:embedding:abandoned:%d", eid)
}

// markTaskAbandoned records an abandoned task in Redis sorted set
func (q *embeddingRedisQueue) markTaskAbandoned(ctx context.Context, eid int64, chunkID int64) {
	abandonedKey := q.abandonedKey(eid)
	timestamp := float64(time.Now().Unix())

	// Use chunkID as member and timestamp as score
	err := q.rdb.ZAdd(ctx, abandonedKey, &redis.Z{
		Score:  timestamp,
		Member: chunkID,
	}).Err()

	if err != nil {
		logger.Error(context.TODO(), fmt.Sprintf("[embMarkAbandonedFail][eid=%d][chunkID=%d]%+v", eid, chunkID, err))
	} else {
		logger.Info(context.TODO(), fmt.Sprintf("[embMarkAbandoned][eid=%d][chunkID=%d]", eid, chunkID))
	}
}

// ── 可观测性：埋点辅助方法 ──

// obsCallsKey 今日 API 调用次数 key
func obsCallsKey(eid int64, date string) string {
	return fmt.Sprintf("rag:emb:obs:%d:calls:%s", eid, date)
}

// obsLatencyKey 今日累计耗时 key
func obsLatencyKey(eid int64, date string) string {
	return fmt.Sprintf("rag:emb:obs:%d:latency:%s", eid, date)
}

// obsActiveKey 当前活跃文件 key
func obsActiveKey(eid, fileID int64) string {
	return fmt.Sprintf("rag:emb:obs:%d:active:%d", eid, fileID)
}

// obsActiveSetKey 活跃文件 ID 集合 key
func obsActiveSetKey(eid int64) string {
	return fmt.Sprintf("rag:emb:obs:%d:active_set", eid)
}

// obsCallTimestampsKey 最近调用时间戳 ZSET key
func obsCallTimestampsKey(eid int64) string {
	return fmt.Sprintf("rag:emb:obs:%d:call_timestamps", eid)
}

// obsLastCallTsKey 上次调用时间戳 key
func obsLastCallTsKey(eid int64) string {
	return fmt.Sprintf("rag:emb:obs:%d:last_call_ts", eid)
}
// obsChunksKey 今日已处理 chunk 总数 key
func obsChunksKey(eid int64, date string) string {
	return fmt.Sprintf("rag:emb:obs:%d:chunks:%s", eid, date)
}

// recordAPICall 记录一次成功的向量化 API 调用（调用次数、耗时、时间戳、处理 chunk 数）
func (q *embeddingRedisQueue) recordAPICall(ctx context.Context, eid int64, elapsedMs int64, chunkCount int) {
	today := time.Now().Format("2006-01-02")
	now := time.Now().UnixMilli()
	// ZSET member 格式: timestamp:chunkCount，方便解析每次调用处理了多少 chunk
	member := fmt.Sprintf("%d:%d", now, chunkCount)
	pipe := q.rdb.Pipeline()
	pipe.Incr(ctx, obsCallsKey(eid, today))
	pipe.IncrBy(ctx, obsLatencyKey(eid, today), elapsedMs)
	pipe.IncrBy(ctx, obsChunksKey(eid, today), int64(chunkCount))
	pipe.ZAdd(ctx, obsCallTimestampsKey(eid), &redis.Z{Score: float64(now), Member: member})
	pipe.Expire(ctx, obsCallTimestampsKey(eid), 3600*time.Second)
	pipe.Set(ctx, obsLastCallTsKey(eid), now, 0)
	pipe.Exec(ctx)
}

// recordActiveFile 设置/刷新当前活跃文件信息（5 分钟 TTL）
// remainingChunks 为该文件当前尚未完成的 chunk 数量（pending + indexing）
func (q *embeddingRedisQueue) recordActiveFile(ctx context.Context, eid, fileID int64, fileName, modelName string, remainingChunks int) {
	info, _ := json.Marshal(map[string]interface{}{
		"file_id":     fileID,
		"file_name":   fileName,
		"model":       modelName,
		"remaining":   remainingChunks,
		"started_at":  time.Now().UnixMilli(),
	})
	pipe := q.rdb.Pipeline()
	pipe.Set(ctx, obsActiveKey(eid, fileID), string(info), 300*time.Second)
	pipe.SAdd(ctx, obsActiveSetKey(eid), fileID)
	pipe.Exec(ctx)
}

// clearActiveFile 移除活跃文件标记
func (q *embeddingRedisQueue) clearActiveFile(ctx context.Context, eid, fileID int64) {
	pipe := q.rdb.Pipeline()
	pipe.Del(ctx, obsActiveKey(eid, fileID))
	pipe.SRem(ctx, obsActiveSetKey(eid), fileID)
	pipe.Exec(ctx)
}

// obsWorkerTaskKey 当前 worker 正在处理的 chunk key
func obsWorkerTaskKey(eid int64, workerName string) string {
	return fmt.Sprintf("rag:emb:obs:%d:worker:%s", eid, workerName)
}

// obsRunningTasksKey 当前正在运行的任务集合
func obsRunningTasksKey(eid int64) string {
	return fmt.Sprintf("rag:emb:obs:%d:running_tasks", eid)
}

// setCurrentTask 设置当前 worker 正在处理的任务（30s TTL 自动过期）
func (q *embeddingRedisQueue) setCurrentTask(ctx context.Context, eid int64, workerName string, chunkID, fileID int64, step string) {
	now := time.Now().UnixMilli()
	info, _ := json.Marshal(map[string]interface{}{
		"chunk_id":      chunkID,
		"file_id":       fileID,
		"step":          step,
		"step_started_at": now,
		"steps":         map[string]interface{}{},
		"started_at":    now,
	})
	pipe := q.rdb.Pipeline()
	pipe.Set(ctx, obsWorkerTaskKey(eid, workerName), string(info), 30*time.Second)
	pipe.SAdd(ctx, obsRunningTasksKey(eid), chunkID)
	pipe.Expire(ctx, obsRunningTasksKey(eid), 30*time.Second)
	pipe.Exec(ctx)
}

// updateTaskStep 更新当前 worker 的步骤，记录每步耗时
func (q *embeddingRedisQueue) updateTaskStep(ctx context.Context, eid int64, workerName, step string) {
	key := obsWorkerTaskKey(eid, workerName)
	val, err := q.rdb.Get(ctx, key).Result()
	if err != nil {
		return
	}
	var info map[string]interface{}
	if err := json.Unmarshal([]byte(val), &info); err != nil {
		return
	}
	now := time.Now().UnixMilli()
	// 记录上一步的耗时
	if prevStep, ok := info["step"].(string); ok && prevStep != "" {
		if prevStarted, ok := info["step_started_at"].(float64); ok {
			elapsed := now - int64(prevStarted)
			if steps, ok := info["steps"].(map[string]interface{}); ok {
				steps[prevStep] = elapsed
			} else {
				info["steps"] = map[string]interface{}{prevStep: elapsed}
			}
		}
	}
	info["step"] = step
	info["step_started_at"] = now
	updated, _ := json.Marshal(info)
	q.rdb.Set(ctx, key, string(updated), 30*time.Second)
}

// clearCurrentTask 清除当前 worker 的任务标记
func (q *embeddingRedisQueue) clearCurrentTask(ctx context.Context, eid int64, workerName string, chunkID int64) {
	pipe := q.rdb.Pipeline()
	pipe.Del(ctx, obsWorkerTaskKey(eid, workerName))
	pipe.SRem(ctx, obsRunningTasksKey(eid), chunkID)
	pipe.Exec(ctx)
}

// startCleanupRoutine starts a goroutine to periodically clean up old abandoned records
func (q *embeddingRedisQueue) startCleanupRoutine(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(1 * time.Hour)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				q.cleanupAbandonedRecords(ctx)
			}
		}
	}()

	logger.Info(context.TODO(), "[embCleanupRoutineStarted] Abandoned task cleanup routine started")
}

// cleanupAbandonedRecords removes abandoned records older than 24 hours
func (q *embeddingRedisQueue) cleanupAbandonedRecords(ctx context.Context) {
	// Get all abandoned keys pattern
	pattern := "rag:embedding:abandoned:*"

	iter := q.rdb.Scan(ctx, 0, pattern, 0).Iterator()
	var keys []string

	for iter.Next(ctx) {
		keys = append(keys, iter.Val())
	}

	if err := iter.Err(); err != nil {
		logger.Error(context.TODO(), fmt.Sprintf("[embCleanupScanFail]%+v", err))
		return
	}

	if len(keys) == 0 {
		return
	}

	// Calculate cutoff time (24 hours ago)
	cutoffTime := float64(time.Now().Add(-24 * time.Hour).Unix())

	// Clean up each key
	for _, key := range keys {
		// Remove old records from the sorted set
		err := q.rdb.ZRemRangeByScore(ctx, key, "-inf", fmt.Sprintf("%f", cutoffTime)).Err()
		if err != nil && err != redis.Nil {
			logger.Error(context.TODO(), fmt.Sprintf("[embCleanupFail][key=%s]%+v", key, err))
			continue
		}

		// If the sorted set is empty, remove the key entirely
		count, err := q.rdb.ZCard(ctx, key).Result()
		if err == nil && count == 0 {
			_ = q.rdb.Del(ctx, key).Err()
		}
	}

	logger.Info(context.TODO(), fmt.Sprintf("[embCleanupCompleted][keys=%d] Cleaned up abandoned task records", len(keys)))
}

// EnqueueIfNotExists pushes a task if not duplicated recently
func (q *embeddingRedisQueue) EnqueueIfNotExists(ctx context.Context, task EmbeddingTask) (bool, error) {
	// dedup
	dk := q.dedupKey(task.Eid, task.RetrievalChunkID)
	ok, err := q.rdb.SetNX(ctx, dk, time.Now().UnixMilli(), q.opts.DedupTTL).Result()
	if err != nil {
		logger.Error(context.TODO(), fmt.Sprintf("[embDedupCheckFail][eid=%d][retrievalID=%d]%+v", task.Eid, task.RetrievalChunkID, err))
		return false, err
	}
	if !ok {
		logger.Info(context.TODO(), fmt.Sprintf("[embDedupSkip][eid=%d][retrievalID=%d]", task.Eid, task.RetrievalChunkID))
		return false, nil
	}

	task.EnqueuedAt = time.Now().UnixMilli()
	if task.Retries < 0 {
		task.Retries = 0
	}
	payload, _ := json.Marshal(task)

	// List enqueue
	listKey := q.getListKey(task.Eid)
	if err := q.rdb.RPush(ctx, listKey, string(payload)).Err(); err != nil {
		logger.Error(context.TODO(), fmt.Sprintf("[embEnqueueFail][eid=%d][retrievalID=%d]%+v", task.Eid, task.RetrievalChunkID, err))
		_ = q.rdb.Del(ctx, dk).Err()
		return false, err
	}
	logger.Info(context.TODO(), fmt.Sprintf("[embEnqueued][eid=%d][retrievalID=%d]", task.Eid, task.RetrievalChunkID))

	// lazy start workers for this eid if not running
	if err := q.StartOrUpdateWorkers(ctx, task.Eid); err != nil {
		return true, err
	}

	return true, nil
}

// StartOrUpdateWorkers starts per-eid pool with configured concurrency
func (q *embeddingRedisQueue) StartOrUpdateWorkers(ctx context.Context, eid int64) error {
	q.workersMu.Lock()
	defer q.workersMu.Unlock()

	desired := q.getConcurrencyForEID(ctx, eid)
	if pool, ok := q.workers[eid]; ok {
		if pool.concurrent == desired {
			// already running with desired concurrency
			return nil
		}
		// restart with new concurrency
		pool.cancel()
		pool.wg.Wait()
		delete(q.workers, eid)
	}

	ctxWorker, cancel := context.WithCancel(ctx)
	pool := &eidWorkerPool{
		eid:        eid,
		concurrent: desired,
		cancel:     cancel,
	}
	q.workers[eid] = pool

	// start consumers
	for i := 0; i < desired; i++ {
		pool.wg.Add(1)
		go func(idx int) {
			defer pool.wg.Done()
			q.consumeLoop(ctxWorker, eid, fmt.Sprintf("rag-emb-worker-%s:%d:%d", hostnameSafe(), os.Getpid(), idx))
		}(i)
	}

	// start a periodic pending recovery goroutine
	pool.wg.Add(1)
	go func() {
		defer pool.wg.Done()
		q.pendingRecoveryLoop(ctxWorker, eid)
	}()
	return nil
}

func (q *embeddingRedisQueue) Shutdown(ctx context.Context) error {
	q.workersMu.Lock()
	defer q.workersMu.Unlock()
	for eid, p := range q.workers {
		p.cancel()
		p.wg.Wait()
		delete(q.workers, eid)
	}
	return nil
}

func (q *embeddingRedisQueue) consumeLoop(ctx context.Context, eid int64, workerName string) {
	listKey := q.getListKey(eid)
	batchSize := getEmbeddingBatchSize()
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}
		val, err := q.rdb.BRPop(ctx, q.opts.ReadBlock, listKey).Result()
		if err != nil {
			if err != redis.Nil && !errors.Is(err, context.Canceled) {
				logger.Warn(context.TODO(), fmt.Sprintf("[embReadFail][eid=%d]%+v", eid, err))
				time.Sleep(500 * time.Millisecond)
			}
			continue
		}
		if len(val) < 2 {
			continue
		}

		payloads := []string{val[1]}
		if batchSize > 1 {
			for i := 1; i < batchSize; i++ {
				more, err := q.rdb.RPop(ctx, listKey).Result()
				if err != nil {
					break
				}
				payloads = append(payloads, more)
			}
		}

		// 标记当前 worker 正在处理的任务（可观测）
		var firstTask EmbeddingTask
		json.Unmarshal([]byte(payloads[0]), &firstTask)
		if firstTask.RetrievalChunkID > 0 {
			q.setCurrentTask(ctx, eid, workerName, firstTask.RetrievalChunkID, firstTask.FileID, "入队")
		}
		if len(payloads) == 1 {
			q.updateTaskStep(ctx, eid, workerName, "API调用")
			q.handlePayload(ctx, eid, payloads[0])
		} else {
			q.updateTaskStep(ctx, eid, workerName, "API调用")
			q.handleBatchPayload(ctx, eid, payloads, workerName)
		}
		// 处理完成后清除任务标记
		if firstTask.RetrievalChunkID > 0 {
			q.clearCurrentTask(ctx, eid, workerName, firstTask.RetrievalChunkID)
		}
	}
 }

func (q *embeddingRedisQueue) handlePayload(ctx context.Context, eid int64, payloadStr string) {
	var task EmbeddingTask
	if err := json.Unmarshal([]byte(payloadStr), &task); err != nil {
		logger.Error(context.TODO(), fmt.Sprintf("[embTaskParseFail][eid=%d]%+v", eid, err))
		return
	}
	// cross check eid
	if task.Eid != eid {
		logger.Warn(context.TODO(), fmt.Sprintf("[embEidMismatch][eid=%d][taskEid=%d]", eid, task.Eid))
		return
	}

	err := common.CheckRagTaskStop(task.LibraryID, task.FileID)
	if err != nil {
		// Mark task as abandoned before cleanup
		q.markTaskAbandoned(ctx, task.Eid, task.RetrievalChunkID)

		// 清理去重键，防止阻止未来的合法任务
		_ = q.rdb.Del(ctx, q.dedupKey(task.Eid, task.RetrievalChunkID)).Err()
		logger.Error(context.TODO(), fmt.Sprintf("[文件或者知识库被删除，任务停止][embTaskStopCheckFail][eid=%d][retrievalID=%d]%+v", eid, task.RetrievalChunkID, err))
		return
	}

	// distributed lock per retrieval chunk
	lk := q.lockKey(task.Eid, task.RetrievalChunkID)
	okSet, err := q.rdb.SetNX(ctx, lk, time.Now().UnixMilli(), q.opts.LockTTL).Result()
	if err != nil || !okSet {
		// lock busy, let it retry later by idle/pending mechanism
		logger.Warn(context.TODO(), fmt.Sprintf("[embLockBusy][eid=%d][retrievalID=%d][trace=%s]", eid, task.RetrievalChunkID, task.TraceID))
		// Optionally extend message idle for delay; here we just return to keep it pending
		return
	}
	defer func() {
		_ = q.rdb.Del(ctx, lk).Err()
	}()

	// idempotency + robust fetch
	chunk, err := model.GetRetrievalChunkByID(eid, task.RetrievalChunkID)
	if err != nil {
		// Permanent not found -> give up, clear dedup, no retry
		if errors.Is(err, gorm.ErrRecordNotFound) {
			_ = q.rdb.Del(ctx, q.dedupKey(task.Eid, task.RetrievalChunkID)).Err()
			logger.Warn(context.TODO(), fmt.Sprintf("[embChunkNotFound][eid=%d][retrievalID=%d][trace=%s]", eid, task.RetrievalChunkID, task.TraceID))
			return
		}
		// Transient DB error -> schedule retry
		logger.Warn(context.TODO(), fmt.Sprintf("[embChunkFetchFail][eid=%d][retrievalID=%d][trace=%s]%+v", eid, task.RetrievalChunkID, task.TraceID, err))
		task.Retries++
		if task.Retries > q.opts.MaxRetries {
			_ = q.rdb.Del(ctx, q.dedupKey(task.Eid, task.RetrievalChunkID)).Err()
			logger.Error(context.TODO(), fmt.Sprintf("[embGiveUpOnFetch][eid=%d][retrievalID=%d][retries=%d]%+v", eid, task.RetrievalChunkID, task.Retries, err))
			return
		}
		q.scheduleRetry(ctx, eid, task)
		return
	}
	if chunk == nil {
		// Defensive: unexpected nil
		_ = q.rdb.Del(ctx, q.dedupKey(task.Eid, task.RetrievalChunkID)).Err()
		logger.Warn(context.TODO(), fmt.Sprintf("[embChunkNil][eid=%d][retrievalID=%d][trace=%s]", eid, task.RetrievalChunkID, task.TraceID))
		return
	}
	if model.IsRetrievalChunkEmbeddingSucceeded(chunk.EmbeddingStatus) {
		_ = q.rdb.Del(ctx, q.dedupKey(task.Eid, task.RetrievalChunkID)).Err()
		logger.Info(context.TODO(), fmt.Sprintf("[embAlreadyDone][eid=%d][retrievalID=%d]", eid, task.RetrievalChunkID))
		return
	}

	// process embedding（含耗时统计）
	apiStart := time.Now()
 	svc := NewRetrievalChunkService(model.DB)
 	err = svc.ProcessEmbeddingForRetrievalChunk(eid, chunk)
 	if err != nil {
 		task.Retries++
 		if task.Retries > q.opts.MaxRetries {
 			_ = q.rdb.Del(ctx, q.dedupKey(task.Eid, task.RetrievalChunkID)).Err()
 			logger.Error(context.TODO(), fmt.Sprintf("[embGiveUp][eid=%d][retrievalID=%d][retries=%d]%+v", eid, task.RetrievalChunkID, task.Retries, err))
 			return
 		}
 		logger.Warn(context.TODO(), fmt.Sprintf("[embRetry][eid=%d][retrievalID=%d][retries=%d]%+v", eid, task.RetrievalChunkID, task.Retries, err))
 		// 延迟重试：写入 retry ZSET，由调度器搬回 list
 		q.scheduleRetry(ctx, eid, task)
 		return
 	}

	apiElapsed := time.Since(apiStart).Milliseconds()
	q.recordAPICall(ctx, eid, apiElapsed, 1)

	// 记录活跃文件（单 chunk 路径，确保可观测性有数据）
	file, _ := model.GetFileByID(eid, task.FileID)
	if file != nil {
		remaining, _ := model.CountPendingEmbeddingRetrievalChunksByFileID(eid, task.FileID)
		q.recordActiveFile(ctx, eid, task.FileID, model.ExtractSimpleFileName(file.Path), "", int(remaining))
	}

	// success
	_ = q.rdb.Del(ctx, q.dedupKey(task.Eid, task.RetrievalChunkID)).Err()
	logger.Info(context.TODO(), fmt.Sprintf("[embDone][eid=%d][retrievalID=%d]", eid, task.RetrievalChunkID))
	// 检查文件是否所有 chunk 都完成，触发 pipeline 下一步
	if model.IsFileEmbeddingComplete(eid, task.FileID) {
		q.triggerNextPipelineStep(ctx, eid, task.FileID)
		q.clearActiveFile(ctx, eid, task.FileID)
	}
}

// handleBatchPayload 批量处理多个 embedding 任务，按文件分组后批量提交 API
func (q *embeddingRedisQueue) handleBatchPayload(ctx context.Context, eid int64, payloads []string, workerName string) {
	var tasks []EmbeddingTask
	for _, p := range payloads {
		var task EmbeddingTask
		if err := json.Unmarshal([]byte(p), &task); err != nil || task.Eid != eid {
			continue
		}
		tasks = append(tasks, task)
	}
	if len(tasks) == 0 {
		return
	}

	byFile := make(map[int64][]EmbeddingTask)
	for _, t := range tasks {
		byFile[t.FileID] = append(byFile[t.FileID], t)
	}

	for fileID, fileTasks := range byFile {
		q.processFileBatch(ctx, eid, fileID, fileTasks, workerName)
	}
}
// processFileBatch 批量处理同一文件下的多个 chunk：一次性 API 调用 + 逐个存储
func (q *embeddingRedisQueue) processFileBatch(ctx context.Context, eid int64, fileID int64, tasks []EmbeddingTask, workerName string) {
	svc := NewRetrievalChunkService(model.DB)
	type validChunk struct {
		task  EmbeddingTask
		chunk *model.RetrievalChunk
	}
	var validChunks []validChunk

	for _, task := range tasks {
		if err := common.CheckRagTaskStop(task.LibraryID, task.FileID); err != nil {
			q.markTaskAbandoned(ctx, task.Eid, task.RetrievalChunkID)
			_ = q.rdb.Del(ctx, q.dedupKey(task.Eid, task.RetrievalChunkID)).Err()
			continue
		}
		lk := q.lockKey(task.Eid, task.RetrievalChunkID)
		ok, _ := q.rdb.SetNX(ctx, lk, time.Now().UnixMilli(), q.opts.LockTTL).Result()
		if !ok {
			continue
		}
		chunk, err := model.GetRetrievalChunkByID(eid, task.RetrievalChunkID)
		if err != nil {
			_ = q.rdb.Del(ctx, lk).Err()
			continue
		}
		if model.IsRetrievalChunkEmbeddingSucceeded(chunk.EmbeddingStatus) {
			_ = q.rdb.Del(ctx, lk).Err()
			_ = q.rdb.Del(ctx, q.dedupKey(task.Eid, task.RetrievalChunkID)).Err()
			continue
		}
		validChunks = append(validChunks, validChunk{task: task, chunk: chunk})
	}

	if len(validChunks) == 0 {
		return
	}
	defer func() {
		for _, vc := range validChunks {
			_ = q.rdb.Del(ctx, q.lockKey(eid, vc.task.RetrievalChunkID)).Err()
		}
	}()

	// 获取配置和渠道（同一文件共享）
	first := validChunks[0].chunk
	configService := NewChunkConfigService(model.DB)
	config, err := configService.GetConfigWithFileID(eid, &first.LibraryID, &first.FileID)
	if err != nil {
		for _, vc := range validChunks {
			svc.UpdateRetrievalChunkEmbeddingStatus(vc.chunk.ID, model.RetrievalChunkEmbeddingStatusFailed, "", err.Error())
		}
		return
	}
	if config.EmbeddingChannelID == nil {
		for _, vc := range validChunks {
			svc.UpdateRetrievalChunkEmbeddingStatus(vc.chunk.ID, model.RetrievalChunkEmbeddingStatusFailed, "", "未配置向量化渠道")
		}
		return
	}
	channel, err := model.GetChannelByID(*config.EmbeddingChannelID)
	if err != nil {
		for _, vc := range validChunks {
			svc.UpdateRetrievalChunkEmbeddingStatus(vc.chunk.ID, model.RetrievalChunkEmbeddingStatusFailed, "", "获取渠道失败")
		}
		return
	}

	q.updateTaskStep(ctx, eid, workerName, "标记索引中")

	// 记录活跃文件到 Redis（可观测）
	modelName := ""
	if config.EmbeddingModelName != nil {
		modelName = *config.EmbeddingModelName
	}
	file, _ := model.GetFileByID(eid, fileID)
	if file != nil {
		remaining, _ := model.CountPendingEmbeddingRetrievalChunksByFileID(eid, fileID)
		q.recordActiveFile(ctx, eid, fileID, model.ExtractSimpleFileName(file.Path), modelName, int(remaining))
	}

	// 标记所有 chunk 为索引中
	docChunkUpdateMap := make(map[int64]int64)
	for _, vc := range validChunks {
		svc.UpdateRetrievalChunkEmbeddingStatus(vc.chunk.ID, model.RetrievalChunkEmbeddingStatusIndexing, "", "")
		docChunkUpdateMap[vc.chunk.KnowledgeChunkID] = vc.chunk.FileID
	}
	svc.batchUpdateDocumentChunkEmbeddingStatus(docChunkUpdateMap)

	q.updateTaskStep(ctx, eid, workerName, "API调用")

	// 批量 API 调用（含耗时统计）
	apiStart := time.Now()
	texts := make([]string, len(validChunks))
	for i, vc := range validChunks {
		texts[i] = vc.chunk.Content
	}
	embCtx := NewEmbeddingContext(first.LibraryID, first.FileID)
	embeddingService := NewEmbeddingService(model.DB)
	vectors, err := embeddingService.BatchGenerateEmbedding(eid, texts, channel, config, embCtx)
	if err != nil {
		for _, vc := range validChunks {
			svc.UpdateRetrievalChunkEmbeddingStatus(vc.chunk.ID, model.RetrievalChunkEmbeddingStatusFailed, "", err.Error())
			_ = q.rdb.Del(ctx, q.dedupKey(eid, vc.task.RetrievalChunkID)).Err()
		}
		return
	}
	apiElapsed := time.Since(apiStart).Milliseconds()
	q.recordAPICall(ctx, eid, apiElapsed, len(validChunks))

	q.updateTaskStep(ctx, eid, workerName, "存储向量")

	// 逐个存储到向量库并更新状态
	for i, vc := range validChunks {
		if i >= len(vectors) {
			break
		}
		vectorID, storeErr := svc.storeRetrievalChunkToVectorDB(eid, vc.chunk, vectors[i])
		if storeErr != nil {
			svc.UpdateRetrievalChunkEmbeddingStatus(vc.chunk.ID, model.RetrievalChunkEmbeddingStatusFailed, "", storeErr.Error())
			_ = q.rdb.Del(ctx, q.dedupKey(eid, vc.task.RetrievalChunkID)).Err()
			continue
		}
		if err := svc.updateRetrievalChunkVectorInfo(vc.chunk.ID, vectorID); err != nil {
			svc.UpdateRetrievalChunkEmbeddingStatus(vc.chunk.ID, model.RetrievalChunkEmbeddingStatusFailed, "", err.Error())
			_ = q.rdb.Del(ctx, q.dedupKey(eid, vc.task.RetrievalChunkID)).Err()
			continue
		}
		_ = q.rdb.Del(ctx, q.dedupKey(eid, vc.task.RetrievalChunkID)).Err()
	}

	svc.batchUpdateDocumentChunkEmbeddingStatus(docChunkUpdateMap)

	if model.IsFileEmbeddingComplete(eid, fileID) {
		q.triggerNextPipelineStep(ctx, eid, fileID)
		q.clearActiveFile(ctx, eid, fileID)
	}
}

func getEmbeddingBatchSize() int {
	v := os.Getenv("EMBEDDING_BATCH_SIZE")
	if v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	return 5
}

func (q *embeddingRedisQueue) pendingRecoveryLoop(ctx context.Context, eid int64) {
	// 从重试 ZSET 搬运到期任务回 List
	retryKey := fmt.Sprintf("rag:emb:retry:%d", eid)
	listKey := q.getListKey(eid)
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			now := float64(time.Now().Unix())
			items, err := q.rdb.ZRangeByScore(ctx, retryKey, &redis.ZRangeBy{
				Min:    "-inf",
				Max:    fmt.Sprintf("%f", now),
				Offset: 0,
				Count:  50,
			}).Result()
			if err != nil && err != redis.Nil {
				logger.Warn(context.TODO(), fmt.Sprintf("[embRetryScanFail][eid=%d]%+v", eid, err))
				continue
			}
			if len(items) == 0 {
				continue
			}
			pipe := q.rdb.TxPipeline()
			for _, it := range items {
				pipe.ZRem(ctx, retryKey, it)
				pipe.RPush(ctx, listKey, it)
			}
			_, _ = pipe.Exec(ctx)
		}
	}
}

func (q *embeddingRedisQueue) backoffDuration(retries int) time.Duration {
	base := q.opts.RetryBackoff
	if base <= 0 {
		base = 5 * time.Second
	}
	if retries <= 1 {
		return base
	}
	return time.Duration(1<<uint(retries-1)) * base
}

func (q *embeddingRedisQueue) scheduleRetry(ctx context.Context, eid int64, task EmbeddingTask) {
	retryKey := fmt.Sprintf("rag:emb:retry:%d", eid)
	delay := q.backoffDuration(task.Retries)
	score := float64(time.Now().Add(delay).Unix())
	payload, _ := json.Marshal(task)
	_ = q.rdb.ZAdd(ctx, retryKey, &redis.Z{
		Score:  score,
		Member: string(payload),
	}).Err()
}

// triggerNextPipelineStep 文件所有 chunk 向量化完成后，触发 pipeline 下一步
func (q *embeddingRedisQueue) triggerNextPipelineStep(ctx context.Context, eid, fileID int64) {
	redisKey := fmt.Sprintf("rag:emb:pending_pipeline:%d", fileID)
	val, err := q.rdb.Get(ctx, redisKey).Result()
	if err != nil {
		return
	}
	defer q.rdb.Del(ctx, redisKey)

	var ctxData struct {
		RunID       string `json:"run_id"`
		NextStepIdx int    `json:"next_step_idx"`
	}
	if err := json.Unmarshal([]byte(val), &ctxData); err != nil || ctxData.RunID == "" {
		return
	}

	var nextJob model.RagJob
	if err := model.DB.Where("run_id = ? AND status = ?", ctxData.RunID, model.RagJobStatusPaused).First(&nextJob).Error; err != nil {
		return
	}

	model.DB.Model(&nextJob).Update("status", model.RagJobStatusPending)
	wrapper := model.JobWrapper{
		JobID:      nextJob.JobID,
		Eid:        nextJob.Eid,
		Type:       nextJob.Type,
		EnqueuedAt: time.Now(),
	}
	wrapperBytes, _ := json.Marshal(wrapper)
	queueName := fmt.Sprintf("rag:job:queue:%s", nextJob.Type)
	_ = q.rdb.LPush(ctx, queueName, string(wrapperBytes)).Err()
	logger.Info(context.TODO(), fmt.Sprintf("[embPipelineTrigger] 文件所有 chunk 向量化完成，触发下一步: file_id=%d, next_job=%d, type=%s", fileID, nextJob.JobID, nextJob.Type))

	// 更新文件解析状态
	model.UpdateFileParsingStatus(fileID, model.FileParsingStatusNormal)
}

// getConcurrencyForEID reads per-eid concurrency from store; fallback to default
func (q *embeddingRedisQueue) getConcurrencyForEID(ctx context.Context, eid int64) int {
	// Try Redis hash: rag:emb:concurrency field=eid
	val, err := q.rdb.HGet(ctx, "rag:emb:concurrency", strconv.FormatInt(eid, 10)).Result()
	if err == nil && val != "" {
		if n, convErr := strconv.Atoi(val); convErr == nil && n > 0 {
			return n
		}
	}
	// Fallback default
	return q.opts.DefaultConcurrency
}

func hostnameSafe() string {
	h, err := os.Hostname()
	if err != nil {
		return "unknown"
	}
	return strings.ReplaceAll(h, ":", "_")
}

// ---- Vector Store Observability (batch writes to Qdrant) ----

func obsVSCallsKey(eid int64, date string) string {
	return fmt.Sprintf("rag:emb:vs:%d:calls:%s", eid, date)
}

func obsVSLatencyKey(eid int64, date string) string {
	return fmt.Sprintf("rag:emb:vs:%d:latency:%s", eid, date)
}

func obsVSVectorsKey(eid int64, date string) string {
	return fmt.Sprintf("rag:emb:vs:%d:vectors:%s", eid, date)
}

func obsVSCallTimestampsKey(eid int64) string {
	return fmt.Sprintf("rag:emb:vs:%d:call_timestamps", eid)
}

func obsVSLastCallTsKey(eid int64) string {
	return fmt.Sprintf("rag:emb:vs:%d:last_call_ts", eid)
}

// recordVectorStoreCall 记录一次向量存储批量写入
func recordVectorStoreCall(eid int64, batchSize int, elapsedMs int64) {
	if common.RDB == nil {
		return
	}
	ctx := context.Background()
	today := time.Now().Format("2006-01-02")
	now := time.Now().UnixMilli()
	member := fmt.Sprintf("%d:%d", now, batchSize)
	pipe := common.RDB.Pipeline()
	pipe.Incr(ctx, obsVSCallsKey(eid, today))
	pipe.IncrBy(ctx, obsVSLatencyKey(eid, today), elapsedMs)
	pipe.IncrBy(ctx, obsVSVectorsKey(eid, today), int64(batchSize))
	pipe.ZAdd(ctx, obsVSCallTimestampsKey(eid), &redis.Z{Score: float64(now), Member: member})
	pipe.Expire(ctx, obsVSCallTimestampsKey(eid), 3600*time.Second)
	pipe.Set(ctx, obsVSLastCallTsKey(eid), now, 0)
	pipe.Exec(ctx)
}

func init() {
	vectorstore.SetBatchFlushObserver(recordVectorStoreCall)
}
