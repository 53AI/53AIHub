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

func (q *embeddingRedisQueue) consumeLoop(ctx context.Context, eid int64, _ string) {
	listKey := q.getListKey(eid)
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
		payloadStr := val[1]
		q.handlePayload(ctx, eid, payloadStr)
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

	// process embedding
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

	// success
	_ = q.rdb.Del(ctx, q.dedupKey(task.Eid, task.RetrievalChunkID)).Err()
	logger.Info(context.TODO(), fmt.Sprintf("[embDone][eid=%d][retrievalID=%d]", eid, task.RetrievalChunkID))
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
