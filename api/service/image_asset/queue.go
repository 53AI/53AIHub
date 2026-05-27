package image_asset

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
)

// QueueManager 队列管理器
type QueueManager struct{}

// NewQueueManager 创建队列管理器
func NewQueueManager() *QueueManager {
	return &QueueManager{}
}

// Enqueue 批量入队任务
func (qm *QueueManager) Enqueue(ctx context.Context, tasks []ImageDownloadTask, batchMeta *BatchMeta) error {
	if !common.RedisEnabled {
		return fmt.Errorf("Redis is not enabled, image download queue not available")
	}

	if len(tasks) == 0 {
		return fmt.Errorf("no tasks to enqueue")
	}

	// 保存批次元数据
	batchKey := BatchKeyPrefix + batchMeta.BatchID
	batchJSON, err := json.Marshal(batchMeta)
	if err != nil {
		return fmt.Errorf("marshal batch meta error: %w", err)
	}

	err = common.RedisSet(batchKey, string(batchJSON), 24*time.Hour) // 24小时过期
	if err != nil {
		return fmt.Errorf("save batch meta error: %w", err)
	}

	// 设置 pending 计数
	pendingKey := PendingPrefix + batchMeta.BatchID
	err = common.RedisSet(pendingKey, strconv.Itoa(batchMeta.PendingTasks), 24*time.Hour)
	if err != nil {
		return fmt.Errorf("set pending count error: %w", err)
	}

	// 批量入队任务
	for _, task := range tasks {
		taskJSON, err := json.Marshal(task)
		if err != nil {
			logger.SysErrorf("marshal task error: %v", err)
			continue
		}

		// 使用入队时间戳作为score
		_, err = common.RedisZAdd(QueueKey, task.EnqueueTs, string(taskJSON))
		if err != nil {
			logger.SysErrorf("enqueue task error: %v", err)
			continue
		}
	}

	logger.SysLogf("enqueued %d image download tasks for batch %s", len(tasks), batchMeta.BatchID)
	return nil
}

// Dequeue 出队任务
func (qm *QueueManager) Dequeue(ctx context.Context) (*ImageDownloadTask, error) {
	if !common.RedisEnabled {
		return nil, fmt.Errorf("Redis is not enabled")
	}

	// 获取最早的任务
	now := time.Now().UnixMilli()
	tasks, err := common.RedisZRangeByScore(QueueKey, 0, now)
	if err != nil {
		return nil, fmt.Errorf("redis range error: %w", err)
	}

	if len(tasks) == 0 {
		return nil, nil // 队列为空
	}

	// 取第一个任务
	taskJSON := tasks[0]

	// 从队列中移除
	_, err = common.RedisZRem(QueueKey, taskJSON)
	if err != nil {
		return nil, fmt.Errorf("redis remove error: %w", err)
	}

	var task ImageDownloadTask
	if err := json.Unmarshal([]byte(taskJSON), &task); err != nil {
		return nil, fmt.Errorf("unmarshal task error: %w", err)
	}

	return &task, nil
}

// AckTask 确认任务完成
func (qm *QueueManager) AckTask(ctx context.Context, task *ImageDownloadTask, success bool, errorMsg string) error {
	if !common.RedisEnabled {
		return fmt.Errorf("Redis is not enabled")
	}

	pendingKey := PendingPrefix + task.BatchID

	// 递减 pending 计数
	err := common.RedisDecrease(pendingKey, 1)
	if err != nil {
		logger.SysErrorf("decr pending count error: %v", err)
		return err
	}
	// 刷新 TTL，避免长处理导致过期
	_, _ = common.RedisExpire(pendingKey, 48*time.Hour)

	if success {
		logger.SysLogf("image download success: %s -> %s", task.StaticPath, task.PreviewKey)
	} else {
		logger.SysErrorf("image download failed: %s, error: %s", task.StaticPath, errorMsg)
	}

	// 获取当前 pending 计数
	remainingStr, err := common.RedisGet(pendingKey)
	if err != nil {
		// 键不存在视为 0，不当成错误
		if errors.Is(err, common.ErrRedisNil) {
			remainingStr = "0"
		} else {
			logger.SysErrorf("get pending count error: %v", err)
			return err
		}
	}

	remaining, err := strconv.Atoi(remainingStr)
	if err != nil {
		logger.SysErrorf("parse pending count error: %v", err)
		return err
	}

	// 如果是最后一个任务，触发批次完成
	if remaining <= 0 {
		go qm.onBatchComplete(ctx, task.BatchID)
	}

	return nil
}

// FailTask 标记任务失败并重新入队（如果还有重试次数）
func (qm *QueueManager) FailTask(ctx context.Context, task *ImageDownloadTask, errorMsg string) error {
	if !common.RedisEnabled {
		return fmt.Errorf("Redis is not enabled")
	}

	task.Retry++

	if task.Retry < MaxRetries {
		// 还有重试次数，重新入队（延迟入队）
		delay := time.Duration(task.Retry) * RetryBaseDelay * time.Duration(task.Retry) // 指数退避
		task.EnqueueTs = time.Now().Add(delay).UnixMilli()

		taskJSON, err := json.Marshal(task)
		if err != nil {
			return fmt.Errorf("marshal retry task error: %w", err)
		}

		_, err = common.RedisZAdd(QueueKey, task.EnqueueTs, string(taskJSON))
		if err != nil {
			return fmt.Errorf("requeue task error: %w", err)
		}

		logger.SysLogf("image download retry %d/%d: %s, error: %s", task.Retry, MaxRetries, task.StaticPath, errorMsg)
		return nil
	}

	// 重试次数用尽，标记为最终失败
	return qm.AckTask(ctx, task, false, errorMsg)
}

// GetQueueSize 获取队列大小
func (qm *QueueManager) GetQueueSize(ctx context.Context) (int64, error) {
	if !common.RedisEnabled {
		return 0, fmt.Errorf("Redis is not enabled")
	}

	count, err := common.RedisZCount(QueueKey, 0, time.Now().UnixMilli()+86400000)
	if err != nil {
		return 0, fmt.Errorf("redis count error: %w", err)
	}

	return count, nil
}

// onBatchComplete 批次完成回调
func (qm *QueueManager) onBatchComplete(ctx context.Context, batchID string) {
	logger.SysLogf("batch %s completed, starting content replacement", batchID)

	// 获取批次元数据
	batchKey := BatchKeyPrefix + batchID
	batchJSON, err := common.RedisGet(batchKey)
	if err != nil {
		logger.SysErrorf("get batch meta error: %v", err)
		return
	}

	var batchMeta BatchMeta
	if err := json.Unmarshal([]byte(batchJSON), &batchMeta); err != nil {
		logger.SysErrorf("unmarshal batch meta error: %v", err)
		return
	}

	// 不再执行内容替换，因为内容已在保存前替换完成
	logger.SysLogf("batch %s completed, all images downloaded to storage", batchID)

	// 标记批次完成时间
	now := time.Now()
	batchMeta.CompletedAt = &now

	updatedJSON, _ := json.Marshal(batchMeta)
	common.RedisSet(batchKey, string(updatedJSON), 24*time.Hour)

	// 清理 pending 键
	pendingKey := PendingPrefix + batchID
	common.RedisDel(pendingKey)

	logger.SysLogf("batch %s content replacement completed", batchID)
}

// generateBatchID 生成批次ID
func generateBatchID(fileBodyID int64) string {
	return fmt.Sprintf("fb_%d_%d", fileBodyID, time.Now().UnixNano())
}
