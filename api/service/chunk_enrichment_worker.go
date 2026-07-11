package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	v2steps "github.com/53AI/53AIHub/rag-pipeline-v2/steps"
	"github.com/53AI/53AIHub/service/rag"
	"github.com/go-redis/redis/v8"
	"gorm.io/gorm"
)

var (
	chunkEnrichmentWorkerInstance *chunkEnrichmentWorker
	chunkEnrichmentOnce           sync.Once
)

func init() {
	rag.SetChunkEnrichmentWorkerStarter(func(eid int64) {
		if chunkEnrichmentWorkerInstance != nil {
			chunkEnrichmentWorkerInstance.ensureWorker(eid)
		}
	})
}

type chunkEnrichmentWorker struct {
	rdb       redis.Cmdable
	db        *gorm.DB
	workersMu sync.Mutex
	workers   map[int64]*chunkEnrichmentWorkerPool
	cancel    context.CancelFunc
	wg        sync.WaitGroup
}

type chunkEnrichmentWorkerPool struct {
	eid    int64
	cancel context.CancelFunc
	wg     sync.WaitGroup
}

func StartChunkEnrichmentWorker(rdb redis.Cmdable, db *gorm.DB) {
	chunkEnrichmentOnce.Do(func() {
		ctx, cancel := context.WithCancel(context.Background())
		chunkEnrichmentWorkerInstance = &chunkEnrichmentWorker{
			rdb:     rdb,
			db:      db,
			workers: make(map[int64]*chunkEnrichmentWorkerPool),
			cancel:  cancel,
		}
		_ = ctx
		_ = cancel
		logger.SysLog("chunk enrichment worker initialized")
	})
}

func StopChunkEnrichmentWorker() {
	if chunkEnrichmentWorkerInstance != nil {
		chunkEnrichmentWorkerInstance.stop()
	}
}

func (w *chunkEnrichmentWorker) stop() {
	w.workersMu.Lock()
	defer w.workersMu.Unlock()
	w.cancel()
	for eid, p := range w.workers {
		p.cancel()
		p.wg.Wait()
		delete(w.workers, eid)
	}
}

func (w *chunkEnrichmentWorker) ensureWorker(eid int64) {
	w.workersMu.Lock()
	defer w.workersMu.Unlock()

	if _, ok := w.workers[eid]; ok {
		return
	}

	ctx, cancel := context.WithCancel(context.Background())
	pool := &chunkEnrichmentWorkerPool{
		eid:    eid,
		cancel: cancel,
	}
	w.workers[eid] = pool

	pool.wg.Add(1)
	go func() {
		defer pool.wg.Done()
		w.consumeLoop(ctx, eid)
	}()

	logger.Infof(nil, "【分块增益】worker 启动: eid=%d", eid)
}

func (w *chunkEnrichmentWorker) consumeLoop(ctx context.Context, eid int64) {
	queueKey := rag.ChunkEnrichmentQueueKey(eid)

	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		val, err := w.rdb.BRPop(ctx, 3*time.Second, queueKey).Result()
		if err != nil {
			if err != redis.Nil && !errors.Is(err, context.Canceled) {
				time.Sleep(500 * time.Millisecond)
			}
			continue
		}
		if len(val) < 2 {
			continue
		}
		w.handlePayload(ctx, eid, val[1])
	}
}

func (w *chunkEnrichmentWorker) handlePayload(ctx context.Context, eid int64, payloadStr string) {
	var task rag.ChunkEnrichmentTask
	if err := json.Unmarshal([]byte(payloadStr), &task); err != nil {
		logger.Errorf(ctx, "【分块增益】任务解析失败: eid=%d, err=%v", eid, err)
		return
	}
	if task.Eid != eid {
		return
	}

	err := common.CheckRagTaskStop(0, task.FileID)
	if err != nil {
		rag.ClearChunkEnrichmentDedup(ctx, task.Eid, task.FileID)
		logger.Infof(ctx, "【分块增益】任务跳过(文件已删除): eid=%d, file_id=%d", task.Eid, task.FileID)
		return
	}

	lockKey := rag.ChunkEnrichmentLockKey(task.Eid, task.FileID)
	okSet, err := w.rdb.SetNX(ctx, lockKey, time.Now().UnixMilli(), 10*time.Minute).Result()
	if err != nil || !okSet {
		return
	}
	defer func() {
		_ = w.rdb.Del(ctx, lockKey).Err()
	}()

	if err := w.processEnrichment(ctx, &task); err != nil {
		logger.Errorf(ctx, "【分块增益】处理失败(放弃重试): eid=%d, file_id=%d, err=%v",
			task.Eid, task.FileID, err)
		rag.ClearChunkEnrichmentDedup(ctx, task.Eid, task.FileID)
		w.markChunksFailed(ctx, &task, err.Error())
		return
	}

	rag.ClearChunkEnrichmentDedup(ctx, task.Eid, task.FileID)
	logger.Infof(ctx, "【分块增益】处理完成: eid=%d, file_id=%d, chunk_count=%d", task.Eid, task.FileID, len(task.ChunkIDs))
}

func (w *chunkEnrichmentWorker) processEnrichment(ctx context.Context, task *rag.ChunkEnrichmentTask) error {
	var file model.File
	if err := w.db.Where("eid = ? AND id = ?", task.Eid, task.FileID).First(&file).Error; err != nil {
		return fmt.Errorf("获取文件信息失败: %v", err)
	}

	if len(task.ChunkIDs) == 0 {
		return nil
	}

	var chunks []model.DocumentChunk
	if err := w.db.Where("eid = ? AND file_id = ? AND id IN ?", task.Eid, task.FileID, task.ChunkIDs).
		Order("chunk_index asc").
		Find(&chunks).Error; err != nil {
		return fmt.Errorf("加载分块失败: %v", err)
	}
	if len(chunks) == 0 {
		return nil
	}

	if err := v2steps.EnrichDocumentChunksAsync(ctx, w.db, &file, task.ChunkConfig, chunks); err != nil {
		return err
	}

	w.enqueueDerivedRetrievalChunks(ctx, task.Eid, task.FileID, file.LibraryID, task.ChunkIDs)

	return nil
}

func (w *chunkEnrichmentWorker) enqueueDerivedRetrievalChunks(ctx context.Context, eid, fileID, libraryID int64, chunkIDs []int64) {
	if len(chunkIDs) == 0 {
		return
	}

	var rids []int64
	if err := w.db.Model(&model.RetrievalChunk{}).
		Where("eid = ? AND file_id = ? AND knowledge_chunk_id IN ? AND chunk_type IN ?",
			eid, fileID, chunkIDs, []string{"summary", "question"}).
		Pluck("id", &rids).Error; err != nil {
		logger.Errorf(ctx, "【分块增益】查询派生检索块失败: eid=%d, file_id=%d, err=%v", eid, fileID, err)
		return
	}

	if len(rids) == 0 {
		return
	}

	q := rag.GetDefaultEmbeddingQueue()
	if q == nil {
		logger.Warnf(ctx, "【分块增益】向量化队列未初始化，跳过派生检索块入队: eid=%d, file_id=%d, count=%d", eid, fileID, len(rids))
		return
	}

	enqueued := 0
	for _, rid := range rids {
		if _, err := q.EnqueueIfNotExists(ctx, rag.EmbeddingTask{
			Eid:              eid,
			RetrievalChunkID: rid,
			FileID:           fileID,
			LibraryID:        libraryID,
		}); err != nil {
			logger.Warnf(ctx, "【分块增益】派生检索块入队失败: eid=%d, rid=%d, err=%v", eid, rid, err)
		} else {
			enqueued++
		}
	}

	logger.Infof(ctx, "【分块增益】派生检索块已入队向量化: eid=%d, file_id=%d, count=%d/%d", eid, fileID, enqueued, len(rids))
}

func (w *chunkEnrichmentWorker) markChunksFailed(ctx context.Context, task *rag.ChunkEnrichmentTask, reason string) {
	if len(task.ChunkIDs) == 0 {
		return
	}
	err := w.db.Model(&model.DocumentChunk{}).
		Where("eid = ? AND file_id = ? AND id IN ?", task.Eid, task.FileID, task.ChunkIDs).
		Updates(map[string]interface{}{
			"ai_generate_doc_chunk_status": model.AIGenerateDocChunkStatusFail,
			"updated_time":                 time.Now().UTC().UnixMilli(),
		}).Error
	if err != nil {
		logger.Errorf(ctx, "【分块增益】标记分块失败状态出错: eid=%d, file_id=%d, err=%v", task.Eid, task.FileID, err)
	}
}
