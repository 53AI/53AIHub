package image_asset

import (
	"context"
	"fmt"
	"time"

	"github.com/53AI/53AIHub/common/logger"
)

// Service 图片资源服务
type Service struct {
	orchestrator *Orchestrator
	downloader   *Downloader
}

// NewService 创建图片资源服务
func NewService() *Service {
	return &Service{
		orchestrator: NewOrchestrator(),
		downloader:   NewDownloader(20), // 默认20/s限流
	}
}

// StartImageReplacementAsync 启动图片替换异步任务
func (s *Service) StartImageReplacementAsync(eid, fileID, userID, fileBodyID int64, content string) error {
	return s.orchestrator.StartImageReplacementAsync(eid, fileID, userID, fileBodyID, content)
}

// StartWorkers 启动下载工作器
func (s *Service) StartWorkers(ctx context.Context, workerCount int, rateLimit int) {
	s.downloader.StartWorkers(ctx, workerCount, rateLimit)
}

// GetQueueSize 获取队列大小
func (s *Service) GetQueueSize(ctx context.Context) (int64, error) {
	return s.downloader.GetQueueSize(ctx)
}

// 全局服务实例
var globalImageAssetService *Service

// InitImageAssetService 初始化图片资源服务
func InitImageAssetService() {
	globalImageAssetService = NewService()
	logger.SysLogf("image asset service initialized")
}

// StartImageReplacementAsync 全局函数，用于向后兼容
func StartImageReplacementAsync(eid, fileID, userID, fileBodyID int64, content string) error {
	if globalImageAssetService == nil {
		InitImageAssetService()
	}
	return globalImageAssetService.StartImageReplacementAsync(eid, fileID, userID, fileBodyID, content)
}

// StartImageDownloadWorkers 启动图片下载工作器
func StartImageDownloadWorkers(ctx context.Context, workerCount int, rateLimit int) {
	if globalImageAssetService == nil {
		InitImageAssetService()
	}
	globalImageAssetService.StartWorkers(ctx, workerCount, rateLimit)
}

// GetImageDownloadQueueSize 获取图片下载队列大小
func GetImageDownloadQueueSize(ctx context.Context) (int64, error) {
	if globalImageAssetService == nil {
		InitImageAssetService()
	}
	return globalImageAssetService.GetQueueSize(ctx)
}

// PreprocessImages 预处理内容中的图片链接，返回替换后的内容和下载元数据
func PreprocessImages(eid, userID int64, content string) (newContent string, metas []UploadFileMeta, mapping map[string]string, err error) {
	orchestrator := NewOrchestrator()

	// 解析 Markdown 中的静态图片路径
	staticPaths := orchestrator.parseMarkdownStaticPaths(content)
	if len(staticPaths) == 0 {
		return content, nil, nil, nil
	}

	logger.SysLogf("preprocessing %d static images for eid=%d, userID=%d", len(staticPaths), eid, userID)

	// 构建预览映射和上传文件元数据
	mapping, metas, err = orchestrator.buildPreviewMapping(eid, userID, staticPaths)
	if err != nil {
		return content, nil, nil, err
	}

	// 替换内容中的图片链接
	newContent = orchestrator.replaceMarkdownImages(content, mapping)

	logger.SysLogf("preprocessed %d images, created %d upload files", len(staticPaths), len(metas))
	return newContent, metas, mapping, nil
}

// EnqueueImageDownloads 将图片下载任务入队（不需要 fileBodyID）
func EnqueueImageDownloads(eid, userID int64, metas []UploadFileMeta) error {
	if len(metas) == 0 {
		return nil
	}

	orchestrator := NewOrchestrator()

	// 生成批次ID（不依赖 fileBodyID）
	batchID := generateSimpleBatchID()
	batchMeta := &BatchMeta{
		BatchID:      batchID,
		FileBodyID:   0, // 不再需要
		Eid:          eid,
		UserID:       userID,
		TotalTasks:   len(metas),
		PendingTasks: len(metas),
		Mapping:      nil, // 不再需要回写
		CreatedAt:    time.Now(),
	}

	// 构建下载任务
	tasks := make([]ImageDownloadTask, 0, len(metas))
	now := time.Now().UnixMilli()

	for _, meta := range metas {
		task := ImageDownloadTask{
			BatchID:     batchID,
			FileBodyID:  0, // 不再需要
			Eid:         eid,
			UserID:      userID,
			StaticPath:  meta.StaticPath,
			AbsoluteURL: meta.AbsoluteURL,
			PreviewKey:  meta.PreviewKey,
			StorageKey:  meta.StorageKey,
			MimeType:    meta.MimeType,
			Retry:       0,
			EnqueueTs:   now,
		}
		tasks = append(tasks, task)
	}

	// 批量入队
	err := orchestrator.queueManager.Enqueue(context.Background(), tasks, batchMeta)
	if err != nil {
		return err
	}

	logger.SysLogf("enqueued %d image download tasks for batch %s", len(tasks), batchID)
	return nil
}

// generateSimpleBatchID 生成简单的批次ID
func generateSimpleBatchID() string {
	return fmt.Sprintf("img_%d", time.Now().UnixNano())
}
