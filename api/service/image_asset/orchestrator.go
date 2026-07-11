package image_asset

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
)

// Orchestrator 编排器
type Orchestrator struct {
	queueManager *QueueManager
}

// NewOrchestrator 创建编排器
func NewOrchestrator() *Orchestrator {
	return &Orchestrator{
		queueManager: NewQueueManager(),
	}
}

// StartImageReplacementAsync 启动图片替换异步任务
func (o *Orchestrator) StartImageReplacementAsync(eid, fileID, userID, fileBodyID int64, content string) error {
	logger.SysLogf("starting image replacement for file_body %d", fileBodyID)

	// 解析 Markdown 中的静态图片路径
	staticPaths := o.parseMarkdownStaticPaths(content)
	if len(staticPaths) == 0 {
		logger.SysLogf("no static images found in file_body %d", fileBodyID)
		return nil
	}

	logger.SysLogf("found %d static images in file_body %d", len(staticPaths), fileBodyID)

	// 构建预览映射和上传文件元数据
	mapping, uploadMetas, err := o.buildPreviewMapping(eid, userID, staticPaths)
	if err != nil {
		return fmt.Errorf("build preview mapping error: %w", err)
	}

	// 创建批次
	batchID := generateBatchID(fileBodyID)
	batchMeta := &BatchMeta{
		BatchID:      batchID,
		FileBodyID:   fileBodyID,
		Eid:          eid,
		UserID:       userID,
		TotalTasks:   len(uploadMetas),
		PendingTasks: len(uploadMetas),
		Mapping:      mapping,
		CreatedAt:    time.Now(),
	}

	// 构建下载任务
	tasks := make([]ImageDownloadTask, 0, len(uploadMetas))
	now := time.Now().UnixMilli()

	for _, meta := range uploadMetas {
		task := ImageDownloadTask{
			BatchID:     batchID,
			FileBodyID:  fileBodyID,
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
	err = o.queueManager.Enqueue(context.Background(), tasks, batchMeta)
	if err != nil {
		return fmt.Errorf("enqueue tasks error: %w", err)
	}

	logger.SysLogf("enqueued %d image download tasks for batch %s", len(tasks), batchID)
	return nil
}

// parseMarkdownStaticPaths 解析 Markdown 中的静态图片路径
func (o *Orchestrator) parseMarkdownStaticPaths(content string) []string {
	var paths []string
	pathSet := make(map[string]bool) // 去重

	// 匹配 Markdown 图片格式: ![alt](/static/path/image.ext)
	imgRegex := regexp.MustCompile(`!\[[^\]]*\]\((/static/[^\)]+\.(png|jpg|jpeg|gif))\)`)
	matches := imgRegex.FindAllStringSubmatch(content, -1)

	for _, match := range matches {
		if len(match) > 1 {
			staticPath := match[1]
			if !pathSet[staticPath] {
				paths = append(paths, staticPath)
				pathSet[staticPath] = true
			}
		}
	}

	// 也匹配直接链接格式: [text](/static/path/image.ext)
	linkRegex := regexp.MustCompile(`\[[^\]]*\]\((/static/[^\)]+\.(png|jpg|jpeg|gif))\)`)
	linkMatches := linkRegex.FindAllStringSubmatch(content, -1)

	for _, match := range linkMatches {
		if len(match) > 1 {
			staticPath := match[1]
			if !pathSet[staticPath] {
				paths = append(paths, staticPath)
				pathSet[staticPath] = true
			}
		}
	}

	return paths
}

// buildPreviewMapping 构建预览映射和上传文件元数据
func (o *Orchestrator) buildPreviewMapping(eid, userID int64, staticPaths []string) (map[string]string, []UploadFileMeta, error) {
	baseURL := config.GetDocConvertBaseURL()
	if baseURL == "" {
		return nil, nil, fmt.Errorf("DOC_CONVERT_BASE_URL not configured")
	}

	mapping := make(map[string]string)
	uploadMetas := make([]UploadFileMeta, 0, len(staticPaths))

	for _, staticPath := range staticPaths {
		// 构建绝对URL
		absoluteURL := baseURL + strings.TrimPrefix(staticPath, "/")

		// 计算哈希（方案1：基于URL字符串）
		hash := sha256.Sum256([]byte(absoluteURL))
		hashStr := hex.EncodeToString(hash[:])

		// 获取扩展名和文件名
		ext := filepath.Ext(staticPath)
		fileName := path.Base(staticPath)

		// 生成预览键
		previewKey, err := model.GetPreviewKey(hashStr, ext, eid)
		if err != nil {
			logger.SysErrorf("generate preview key error for %s: %v", staticPath, err)
			continue
		}

		// 生成存储键
		storageKey := model.GetFileKey(previewKey, eid, userID)

		// 推测MIME类型
		mimeType := o.guessMimeType(ext)

		// 创建或更新 UploadFile 记录
		uploadFile := &model.UploadFile{
			FileName:   fileName,
			Key:        storageKey,
			Eid:        eid,
			UserID:     userID,
			Size:       0, // 下载后更新
			Extension:  ext,
			MimeType:   mimeType,
			Hash:       hashStr,
			PreviewKey: previewKey,
			Status:     model.UploadStatusPending,
		}

		err = uploadFile.Save()
		if err != nil {
			logger.SysErrorf("save upload file error for %s: %v", staticPath, err)
			continue
		}

		// 生成预览URL
		previewURL := uploadFile.GetPreviewFullUrl()
		mapping[staticPath] = previewURL

		// 添加到元数据列表
		meta := UploadFileMeta{
			StaticPath:  staticPath,
			AbsoluteURL: absoluteURL,
			HashStr:     hashStr,
			PreviewKey:  previewKey,
			StorageKey:  storageKey,
			Extension:   ext,
			MimeType:    mimeType,
			FileName:    fileName,
		}
		uploadMetas = append(uploadMetas, meta)

		logger.SysLogf("created upload file for %s -> %s", staticPath, previewURL)
	}

	return mapping, uploadMetas, nil
}

// ReplaceFileBodyContent 替换文件体内容
func (o *Orchestrator) ReplaceFileBodyContent(ctx context.Context, batchMeta *BatchMeta) error {
	// 获取当前文件体内容
	fileBody, err := model.GetFileBodyByID(batchMeta.FileBodyID)
	if err != nil {
		return fmt.Errorf("get file body error: %w", err)
	}
	content, err := fileBody.GetContent()
	if err != nil {
		return fmt.Errorf("get file body content error: %w", err)
	}

	// 执行替换
	newContent := o.replaceMarkdownImages(content, batchMeta.Mapping)

	// 如果内容没有变化，跳过更新
	if newContent == content {
		logger.SysLogf("no content changes for file_body %d", batchMeta.FileBodyID)
		return nil
	}

	// 更新文件体内容
	fileBody.Content = newContent
	err = fileBody.Update()
	if err != nil {
		return fmt.Errorf("update file body error: %w", err)
	}

	logger.SysLogf("updated file_body %d content with %d image replacements",
		batchMeta.FileBodyID, len(batchMeta.Mapping))
	return nil
}

// replaceMarkdownImages 替换 Markdown 中的图片链接
func (o *Orchestrator) replaceMarkdownImages(content string, mapping map[string]string) string {
	result := content

	// 替换 Markdown 图片格式: ![alt](/static/path) -> ![alt](preview_url)
	imgRegex := regexp.MustCompile(`(!\[[^\]]*\]\()(/static/[^\)]+\.(png|jpg|jpeg|gif))(\))`)
	result = imgRegex.ReplaceAllStringFunc(result, func(match string) string {
		submatches := imgRegex.FindStringSubmatch(match)
		if len(submatches) >= 5 {
			prefix := submatches[1]     // ![alt](
			staticPath := submatches[2] // /static/path
			suffix := submatches[4]     // )

			if previewURL, exists := mapping[staticPath]; exists {
				return prefix + previewURL + suffix
			}
		}
		return match
	})

	// 替换直接链接格式: [text](/static/path) -> [text](preview_url)
	linkRegex := regexp.MustCompile(`(\[[^\]]*\]\()(/static/[^\)]+\.(png|jpg|jpeg|gif))(\))`)
	result = linkRegex.ReplaceAllStringFunc(result, func(match string) string {
		submatches := linkRegex.FindStringSubmatch(match)
		if len(submatches) >= 5 {
			prefix := submatches[1]     // [text](
			staticPath := submatches[2] // /static/path
			suffix := submatches[4]     // )

			if previewURL, exists := mapping[staticPath]; exists {
				return prefix + previewURL + suffix
			}
		}
		return match
	})

	return result
}

// guessMimeType 根据扩展名推测MIME类型
func (o *Orchestrator) guessMimeType(ext string) string {
	switch strings.ToLower(ext) {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	default:
		return "application/octet-stream"
	}
}
