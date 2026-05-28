package rag

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
)

const (
	chunkEnrichmentQueuePrefix = "Queue:chunk_enrichment"
	chunkEnrichmentDedupPrefix = "Cache:chunk_enrichment_dedup"
	chunkEnrichmentDedupTTL    = 2 * time.Hour
)

var chunkEnrichmentWorkerStarter func(eid int64)

func SetChunkEnrichmentWorkerStarter(fn func(eid int64)) {
	chunkEnrichmentWorkerStarter = fn
}

type ChunkEnrichmentTask struct {
	Eid         int64        `json:"eid"`
	FileID      int64        `json:"file_id"`
	ChunkIDs    []int64      `json:"chunk_ids"`
	ChunkConfig *ChunkConfig `json:"chunk_config"`
	Retries     int          `json:"retries"`
	EnqueuedAt  int64        `json:"enqueued_at"`
}

func ChunkEnrichmentQueueKey(eid int64) string {
	return fmt.Sprintf("%s:%d", chunkEnrichmentQueuePrefix, eid)
}

func ChunkEnrichmentLockKey(eid, fileID int64) string {
	return fmt.Sprintf("Lock:chunk_enrichment:%d:%d", eid, fileID)
}

func chunkEnrichmentDedupKey(eid, fileID int64) string {
	return fmt.Sprintf("%s:%d:%d", chunkEnrichmentDedupPrefix, eid, fileID)
}

func EnqueueChunkEnrichment(ctx context.Context, task ChunkEnrichmentTask) (bool, error) {
	if !common.RedisEnabled || common.RDB == nil {
		return false, fmt.Errorf("redis not enabled")
	}

	dk := chunkEnrichmentDedupKey(task.Eid, task.FileID)
	ok, err := common.RDB.SetNX(ctx, dk, time.Now().UnixMilli(), chunkEnrichmentDedupTTL).Result()
	if err != nil {
		logger.Errorf(ctx, "【分块增益】入队去重检查失败: eid=%d, file_id=%d, err=%v", task.Eid, task.FileID, err)
		return false, err
	}
	if !ok {
		logger.Infof(ctx, "【分块增益】入队跳过(已存在): eid=%d, file_id=%d", task.Eid, task.FileID)
		if chunkEnrichmentWorkerStarter != nil {
			chunkEnrichmentWorkerStarter(task.Eid)
		}
		return false, nil
	}

	task.EnqueuedAt = time.Now().UnixMilli()

	payload, _ := json.Marshal(task)
	queueKey := ChunkEnrichmentQueueKey(task.Eid)
	if err := common.RDB.RPush(ctx, queueKey, string(payload)).Err(); err != nil {
		_ = common.RDB.Del(ctx, dk).Err()
		logger.Errorf(ctx, "【分块增益】入队失败: eid=%d, file_id=%d, err=%v", task.Eid, task.FileID, err)
		return false, err
	}

	logger.Infof(ctx, "【分块增益】已入队: eid=%d, file_id=%d, chunk_count=%d", task.Eid, task.FileID, len(task.ChunkIDs))

	if chunkEnrichmentWorkerStarter != nil {
		chunkEnrichmentWorkerStarter(task.Eid)
	}

	return true, nil
}

func ClearChunkEnrichmentDedup(ctx context.Context, eid, fileID int64) {
	if !common.RedisEnabled || common.RDB == nil {
		return
	}
	_ = common.RDB.Del(ctx, chunkEnrichmentDedupKey(eid, fileID)).Err()
}
