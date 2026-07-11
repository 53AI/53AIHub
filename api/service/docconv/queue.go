package docconv

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
)

const (
	// QueueKey Redis队列键名
	QueueKey = "docconv:queue"
)

// QueueTask 队列任务
type QueueTask struct {
	ID         string `json:"id"`
	SourceURL  string `json:"source_url"`
	ParserType string `json:"parser_type,omitempty"`
	EnqueueTs  int64  `json:"enqueue_ts"`
}

// QueueManager 队列管理器
type QueueManager struct {
	client *Client
}

// NewQueueManager 创建队列管理器
func NewQueueManager() *QueueManager {
	return &QueueManager{
		client: NewClient(),
	}
}

// Enqueue 入队任务
func (qm *QueueManager) Enqueue(ctx context.Context, sourceURL, parserType string) (string, error) {
	if !common.RedisEnabled {
		return "", &ConvertError{
			Op:      "queue",
			Code:    "redis_disabled",
			Message: "Redis is not enabled, queue operations not available",
		}
	}

	if sourceURL == "" {
		return "", &ConvertError{
			Op:      "queue",
			Code:    "invalid_request",
			Message: "source_url is required",
		}
	}

	// 生成任务ID
	taskID := fmt.Sprintf("task_%d_%s", time.Now().UnixNano(), generateShortID())

	task := &QueueTask{
		ID:         taskID,
		SourceURL:  sourceURL,
		ParserType: parserType,
		EnqueueTs:  time.Now().UnixMilli(),
	}

	taskJSON, err := json.Marshal(task)
	if err != nil {
		return "", &ConvertError{
			Op:      "queue",
			Code:    "marshal_error",
			Message: err.Error(),
		}
	}

	// 使用入队时间戳作为score
	_, err = common.RedisZAdd(QueueKey, task.EnqueueTs, string(taskJSON))
	if err != nil {
		return "", &ConvertError{
			Op:      "queue",
			Code:    "redis_error",
			Message: err.Error(),
		}
	}

	logger.Infof(ctx, "enqueued conversion task: %s for URL: %s", taskID, sourceURL)
	return taskID, nil
}

// Dequeue 出队任务
func (qm *QueueManager) Dequeue(ctx context.Context) (*QueueTask, error) {
	if !common.RedisEnabled {
		return nil, &ConvertError{
			Op:      "queue",
			Code:    "redis_disabled",
			Message: "Redis is not enabled, queue operations not available",
		}
	}

	// 获取最早的任务
	now := time.Now().UnixMilli()
	tasks, err := common.RedisZRangeByScore(QueueKey, 0, now)
	if err != nil {
		return nil, &ConvertError{
			Op:      "queue",
			Code:    "redis_error",
			Message: err.Error(),
		}
	}

	if len(tasks) == 0 {
		return nil, nil // 队列为空
	}

	// 取第一个任务
	taskJSON := tasks[0]

	// 从队列中移除
	_, err = common.RedisZRem(QueueKey, taskJSON)
	if err != nil {
		return nil, &ConvertError{
			Op:      "queue",
			Code:    "redis_error",
			Message: err.Error(),
		}
	}

	var task QueueTask
	if err := json.Unmarshal([]byte(taskJSON), &task); err != nil {
		return nil, &ConvertError{
			Op:      "queue",
			Code:    "unmarshal_error",
			Message: err.Error(),
		}
	}

	logger.Infof(ctx, "dequeued conversion task: %s", task.ID)
	return &task, nil
}

// CancelTask 取消任务
func (qm *QueueManager) CancelTask(ctx context.Context, taskID string) error {
	if !common.RedisEnabled {
		return &ConvertError{
			Op:      "queue",
			Code:    "redis_disabled",
			Message: "Redis is not enabled, queue operations not available",
		}
	}

	// 获取所有任务
	tasks, err := common.RedisZRangeByScore(QueueKey, 0, time.Now().UnixMilli()+86400000) // 未来24小时内的任务
	if err != nil {
		return &ConvertError{
			Op:      "queue",
			Code:    "redis_error",
			Message: err.Error(),
		}
	}

	// 查找并删除指定任务
	for _, taskJSON := range tasks {
		var task QueueTask
		if json.Unmarshal([]byte(taskJSON), &task) == nil && task.ID == taskID {
			_, err = common.RedisZRem(QueueKey, taskJSON)
			if err != nil {
				return &ConvertError{
					Op:      "queue",
					Code:    "redis_error",
					Message: err.Error(),
				}
			}
			logger.Infof(ctx, "cancelled queued task: %s", taskID)
			return nil
		}
	}

	return &ConvertError{
		Op:      "queue",
		Code:    "task_not_found",
		Message: fmt.Sprintf("task %s not found in queue", taskID),
	}
}

// GetQueueSize 获取队列大小
func (qm *QueueManager) GetQueueSize(ctx context.Context) (int64, error) {
	if !common.RedisEnabled {
		return 0, &ConvertError{
			Op:      "queue",
			Code:    "redis_disabled",
			Message: "Redis is not enabled, queue operations not available",
		}
	}

	count, err := common.RedisZCount(QueueKey, 0, time.Now().UnixMilli()+86400000)
	if err != nil {
		return 0, &ConvertError{
			Op:      "queue",
			Code:    "redis_error",
			Message: err.Error(),
		}
	}

	return count, nil
}

// ProcessTask 处理单个任务（出队→提交→轮询→下载）
func (qm *QueueManager) ProcessTask(ctx context.Context, task *QueueTask, libraryID, fileID int64) (string, error) {
	logger.Infof(ctx, "processing task: %s", task.ID)

	// 提交任务
	req := &ConvertRequest{
		SourceURL:    task.SourceURL,
		OutputFormat: "md",
		ParserType:   task.ParserType,
	}

	jobResp, err := qm.client.SubmitJob(ctx, req)
	if err != nil {
		logger.Errorf(ctx, "failed to submit job for task %s: %v", task.ID, err)

		// 特别处理 mineru.net token 错误
		if convertErr, ok := err.(*ConvertError); ok {
			if convertErr.Message == "mineru_config requires token" {
				logger.Errorf(ctx, "🚨 CRITICAL ERROR: MinerU.net token is missing! Please configure platform setting for mineru.net with valid api_key")
				// 创建一个更明确的错误消息
				return "", &ConvertError{
					Op:      "submit",
					Code:    "mineru_token_missing",
					Message: "create mineru.net converter: mineru.net token is required in job_params",
				}
			}
		}

		return "", err
	}

	// 轮询任务状态
	result, err := qm.pollAndDownload(ctx, jobResp.JobID, libraryID, fileID)
	if err != nil {
		logger.Errorf(ctx, "failed to poll and download for task %s (job %s): %v", task.ID, jobResp.JobID, err)
		return "", err
	}

	logger.Infof(ctx, "completed task: %s (job %s)", task.ID, jobResp.JobID)
	return result, nil
}

// pollAndDownload 轮询任务状态并下载结果
func (qm *QueueManager) pollAndDownload(ctx context.Context, jobID string, libraryID, fileID int64) (string, error) {
	interval := qm.client.pollInterval
	maxInterval := 30 * time.Second
	deadline := time.Now().Add(qm.client.pollTimeout)
	if ctxDeadline, ok := ctx.Deadline(); ok && ctxDeadline.Before(deadline) {
		deadline = ctxDeadline
	}
	truncate := func(s string, maxLen int) string {
		if maxLen <= 0 || len(s) <= maxLen {
			return s
		}
		return s[:maxLen] + "... (truncated)"
	}

	for {
		select {
		case <-ctx.Done():
			return "", &ConvertError{
				Op:      "poll",
				Code:    "cancelled",
				Message: "operation cancelled",
			}
		default:
		}

		if time.Now().After(deadline) {
			return "", &ConvertError{
				Op:      "poll",
				Code:    "timeout",
				Message: fmt.Sprintf("polling timeout after %v", qm.client.pollTimeout),
			}
		}

		// 检查停止信号（仅当 libraryID 和 fileID 不为 0 时）
		if libraryID != 0 && fileID != 0 {
			if err := common.CheckRagTaskStop(libraryID, fileID); err != nil {
				logger.Infof(ctx, "task stopped by signal: libraryID=%d, fileID=%d, error=%v", libraryID, fileID, err)
				return "", &ConvertError{
					Op:      "poll",
					Code:    "task_stopped",
					Message: fmt.Sprintf("task stopped: %v", err),
				}
			}
		}

		status, err := qm.client.QueryJob(ctx, jobID)
		if err != nil {
			return "", err
		}

		logger.Debugf(ctx, "job %s status: %s, progress: %d%%", jobID, status.Status, status.Progress)

		switch status.Status {
		case "succeeded":
			// 检查是否是通义听悟任务
			if strings.HasPrefix(jobID, "tingwu_") {
				// 通义听悟任务，需要从内存缓存中获取结果
				task, exists := getTingWuTask(jobID)
				if !exists {
					return "", &ConvertError{
						Op:      "poll",
						Code:    "task_not_found",
						Message: "tingwu task not found",
					}
				}

				// 创建TingWuClient实例
				tingwuClient, err := NewTingWuClient(task.Config)
				if err != nil {
					return "", &ConvertError{
						Op:      "poll",
						Code:    "tingwu_client_error",
						Message: fmt.Sprintf("failed to create tingwu client: %v", err),
					}
				}

				// 从任务信息中获取真实的任务ID
				taskID, ok := extractTingWuTaskID(jobID)
				if !ok {
					return "", &ConvertError{
						Op:      "poll",
						Code:    "task_id_error",
						Message: "unable to extract real task id from job id",
					}
				}

				// 获取任务结果
				taskInfo, err := tingwuClient.getTaskInfo(ctx, taskID)
				if err != nil {
					return "", &ConvertError{
						Op:      "poll",
						Code:    "get_task_info_error",
						Message: fmt.Sprintf("failed to get task info: %v", err),
					}
				}

				// 获取最终结果
				logger.Infof(ctx, "🚀🚀🚀 [TINGWU-NEW-CODE] 进入 getResult 方法 - task_id=%s, job_id=%s", taskID, jobID)
				result, err := tingwuClient.getResult(ctx, taskInfo)
				if err != nil {
					return "", &ConvertError{
						Op:      "poll",
						Code:    "get_result_error",
						Message: fmt.Sprintf("failed to get result: %v", err),
					}
				}

				logger.Infof(ctx, "[TINGWU] getResult returned: content_len=%d, summary_len=%d, insight_len=%d",
					len(result.Content), len(result.Summary), len(result.InsightSummary))

				// 将结果存储到缓存中
				storeTingWuResult(jobID, result)

				// 如果task.FileID存在，更新文件的Summary字段和转换状态
				if task.FileID != 0 {
					logger.Infof(ctx, "[TINGWU] saving to file %d: summary_len=%d, insight_len=%d, content_len=%d",
						task.FileID, len(result.Summary), len(result.InsightSummary), len(result.Content))
					updates := map[string]interface{}{
						"summary":         result.Summary,
						"insight_summary": result.InsightSummary,
					}

					if common.IsMediaFile(task.SourceURL) {
						probeCtx, probeCancel := context.WithTimeout(ctx, 30*time.Second)
						if d := common.ProbeDurationMs(probeCtx, task.SourceURL); d > 0 {
							updates["duration_ms"] = d
						}
						probeCancel()
					}

					err := model.DB.Model(&model.File{}).Where("id = ?", task.FileID).Updates(updates).Error
					if err != nil {
						logger.Errorf(ctx, "failed to update file summary: %v", err)
					} else {
						logger.Infof(ctx, "[TINGWU] saved insight_summary to file %d (summary_len=%d, insight_len=%d)",
							task.FileID, len(result.Summary), len(result.InsightSummary))
					}
				} else {
					logger.Warnf(ctx, "[TINGWU] task.FileID is 0, skipping insight_summary save")
				}

				return result.Content, nil
			} else {
				// 下载结果
				return qm.client.DownloadResult(ctx, jobID)
			}
		case "failed":
			logger.Errorf(ctx, "[TINGWU] job %s failed - text_preview=%s", jobID, status.TextPreview)
			return "", &ConvertError{
				Op:   "poll",
				Code: "job_failed",
				Message: fmt.Sprintf(
					"job %s failed (stage=%s progress=%d elapsed_ms=%d preview=%s original_filename=%s content_length=%d original_url=%s)",
					jobID,
					status.Stage,
					status.Progress,
					status.ElapsedMs,
					truncate(status.TextPreview, 300),
					status.OriginalFilename,
					status.OriginalContentLength,
					truncate(status.OriginalURL, 300),
				),
			}
		case "queued", "downloading", "processing":
			// 继续等待
		default:
			logger.Warnf(ctx, "unknown job status: %s for job %s", status.Status, jobID)
		}

		timer := time.NewTimer(interval)
		select {
		case <-ctx.Done():
			timer.Stop()
			return "", &ConvertError{
				Op:      "poll",
				Code:    "cancelled",
				Message: "operation cancelled",
			}
		case <-timer.C:
		}

		// 指数退避，最大30秒
		interval *= 2
		if interval > maxInterval {
			interval = maxInterval
		}
	}
}

// generateShortID 生成短ID
func generateShortID() string {
	return strconv.FormatInt(time.Now().UnixNano()%1000000, 36)
}
