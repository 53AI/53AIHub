package image_asset

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/storage"
	"github.com/53AI/53AIHub/model"
)

// Downloader 下载器
type Downloader struct {
	queueManager *QueueManager
	httpClient   *http.Client
	rateLimiter  <-chan time.Time
}

// NewDownloader 创建下载器
func NewDownloader(rateLimit int) *Downloader {
	if rateLimit <= 0 {
		rateLimit = 1
	}
	// 创建限流器：每秒允许 rateLimit 个请求
	ticker := time.NewTicker(time.Second / time.Duration(rateLimit))

	return &Downloader{
		queueManager: NewQueueManager(),
		httpClient: &http.Client{
			Timeout: DefaultTimeout,
		},
		rateLimiter: ticker.C,
	}
}

// StartWorkers 启动下载工作器
func (d *Downloader) StartWorkers(ctx context.Context, workerCount int, rateLimit int) {
	logger.SysLogf("starting %d image download workers with rate limit %d/s", workerCount, rateLimit)

	if workerCount <= 0 {
		workerCount = 1
	}
	for i := 0; i < workerCount; i++ {
		go d.worker(ctx, i)
	}
}

// worker 工作器
func (d *Downloader) worker(ctx context.Context, workerID int) {
	logger.SysLogf("image download worker %d started", workerID)
	defer logger.SysLogf("image download worker %d stopped", workerID)

	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			// 尝试处理一个任务
			if err := d.processOneTask(ctx); err != nil {
				if err.Error() != "queue is empty" {
					// 常见可忽略错误过滤：redis.Nil 等
					if strings.Contains(err.Error(), "redis: nil") {
						continue
					}
					logger.SysErrorf("worker %d process task error: %v", workerID, err)
				}
			}
		}
	}
}

// processOneTask 处理一个任务
func (d *Downloader) processOneTask(ctx context.Context) error {
	// 出队任务
	task, err := d.queueManager.Dequeue(ctx)
	if err != nil {
		return fmt.Errorf("dequeue error: %w", err)
	}

	if task == nil {
		return fmt.Errorf("queue is empty")
	}

	// 等待限流器
	select {
	case <-d.rateLimiter:
		// 获得令牌，继续执行
	case <-ctx.Done():
		return ctx.Err()
	}

	// 处理任务
	err = d.downloadAndSave(ctx, task)
	if err != nil {
		// 任务失败，尝试重试或标记失败
		return d.queueManager.FailTask(ctx, task, err.Error())
	}

	// 任务成功
	return d.queueManager.AckTask(ctx, task, true, "")
}

// downloadAndSave 下载并保存图片
func (d *Downloader) downloadAndSave(ctx context.Context, task *ImageDownloadTask) error {
	logger.SysLogf("downloading image: %s", task.AbsoluteURL)

	// 创建HTTP请求
	req, err := http.NewRequestWithContext(ctx, "GET", task.AbsoluteURL, nil)
	if err != nil {
		return fmt.Errorf("create request error: %w", err)
	}

	// 执行请求
	resp, err := d.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("http request error: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("http status error: %d", resp.StatusCode)
	}

	// 读取响应体
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read response body error: %w", err)
	}

	// 保存到存储
	err = storage.StorageInstance.Save(body, task.StorageKey)
	if err != nil {
		return fmt.Errorf("save to storage error: %w", err)
	}

	// 更新 UploadFile 状态
	err = d.updateUploadFileStatus(task, int64(len(body)), resp.Header.Get("Content-Type"))
	if err != nil {
		logger.SysErrorf("update upload file status error: %v", err)
		// 不返回错误，因为文件已经下载成功
	}

	logger.SysLogf("image download completed: %s -> %s (%d bytes)",
		task.StaticPath, task.PreviewKey, len(body))
	return nil
}

// updateUploadFileStatus 更新上传文件状态
func (d *Downloader) updateUploadFileStatus(task *ImageDownloadTask, size int64, contentType string) error {
	// 根据 PreviewKey 查找 UploadFile
	uploadFile, err := model.GetNoAuthUploadFileByEidAndPreviewKey(task.PreviewKey)
	if err != nil {
		return fmt.Errorf("get upload file error: %w", err)
	}

	// 持久化大小与类型
	if err := uploadFile.UpdateSizeAndMimeType(size, contentType); err != nil {
		return fmt.Errorf("update size/mime error: %w", err)
	}

	// 标记为完成
	if err := uploadFile.MarkAsCompleted(); err != nil {
		return fmt.Errorf("mark as completed error: %w", err)
	}

	return nil
}

// GetQueueSize 获取队列大小
func (d *Downloader) GetQueueSize(ctx context.Context) (int64, error) {
	return d.queueManager.GetQueueSize(ctx)
}
