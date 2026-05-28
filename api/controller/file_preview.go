package controller

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/storage"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/aliyun/aliyun-oss-go-sdk/oss"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

var openAIUploadFileOSSObject = func(storageImpl *storage.AliyunOSSStorage, key string) (io.ReadCloser, error) {
	return storageImpl.GetBucket().GetObject(filepath.ToSlash(key))
}

var openAIUploadFileOSSRangeObject = func(storageImpl *storage.AliyunOSSStorage, key string, start, end int64) (io.ReadCloser, error) {
	return storageImpl.GetBucket().GetObject(filepath.ToSlash(key), oss.Range(start, end))
}

// PreviewRawFileContent godoc
// @Summary 预览原始文件内容
// @Description 预览原始文件内容接口，支持文本文件以及上传的原始文件
// @Tags 文件管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param file_id path int true "文件ID"
// @Success 200 {object} string "文件内容"
// @Router /api/files/{file_id}/preview_raw [get]
func PreviewRawFileContent(c *gin.Context) {
	// eid := config.GetEID(c)

	idStr := c.Param("file_id")
	if idStr == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("文件ID不能为空")))
		return
	}

	fileID, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的文件ID")))
		return
	}

	// 获取文件信息
	file, err := model.GetFileByIDOlny(fileID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
		return
	}

	// 处理 file.Path 的扩展名提取
	// 转换文件: readme.pdf.md -> 提取 .pdf 作为原始扩展名
	// 原始 md 文件: readme.md -> 保留 .md 扩展名
	// 版本号格式: v0.3.1.md -> 保留 .md 扩展名（不把 .1 当作扩展名）
	filePath := file.Path
	ext := strings.ToLower(filepath.Ext(filePath))
	validSourceExts := map[string]bool{
		".pdf": true, ".docx": true, ".doc": true,
		".html": true, ".htm": true, ".txt": true,
	}
	if ext == ".md" {
		withoutMd := strings.TrimSuffix(filePath, ".md")
		innerExt := strings.ToLower(filepath.Ext(withoutMd))
		if validSourceExts[innerExt] {
			filePath = withoutMd
			ext = innerExt
		}
	}

	if file.OriginType == model.FileOriginTypeAIGenerated && file.OriginRefID > 0 {
		if err := file.LoadUploadFile(); err != nil || file.UploadFile == nil {
			if err == nil {
				err = errors.New("未找到上传文件")
			}
			c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
			return
		}
		if err := serveUploadFilePreview(c, fileID, file.UploadFile, ext); err != nil {
			return
		}
		return
	}

	// 纯文本文件（无原始上传文件）从 FileBody 读取最新内容
	// 转换文件（xxx.html.md）和原始文本文件（有 UploadFileID）从 uploadFile 读取
	// 非文本文件（pdf/docx 等）从原始 uploadFile 读取
	isTextFile := ext == ".md" || ext == ".txt" || ext == ".html" || ext == ".htm"
	isPureTextFile := isTextFile && file.UploadFileID == 0
	if isPureTextFile {
		fileBody, err := model.GetLastFileBodyByFileID(file.Eid, file.ID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				c.JSON(http.StatusNotFound, model.NotFound.ToResponse(errors.New("未找到文件内容")))
				return
			}
			c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(err))
			return
		}

		if err := fileBody.LoadContent(); err != nil {
			c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(err))
			return
		}

		contentType := "text/markdown; charset=utf-8"
		switch ext {
		case ".txt":
			contentType = "text/plain; charset=utf-8"
		case ".html", ".htm":
			contentType = "text/html; charset=utf-8"
		}

		c.Header("Content-Type", contentType)
		c.String(http.StatusOK, fileBody.Content)
		return
	}

	if file.UploadFileID == 0 {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(errors.New("未找到上传文件")))
		return
	}

	// 预览原始上传文件
	uploadFile, err := model.GetUploadFileByID(file.UploadFileID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
		return
	}

	filename := uploadFile.FileName
	encodedFilename := url.QueryEscape(filename)

	c.Header("Content-Disposition", `inline; filename="`+filename+`"; filename*=UTF-8''`+encodedFilename)
	contentType := uploadFile.MimeType
	if contentType == "" {
		switch ext {
		case ".txt":
			contentType = "text/plain; charset=utf-8"
		case ".html", ".htm":
			contentType = "text/html; charset=utf-8"
		case ".md":
			contentType = "text/markdown; charset=utf-8"
		default:
			contentType = "application/octet-stream"
		}
	}

	// 根据存储类型选择不同的处理方式
	if config.StorageType == "aliyun_oss" {
		// OSS存储，使用Gin框架的Stream方法
		storageImpl, ok := storage.StorageInstance.(*storage.AliyunOSSStorage)
		if !ok {
			c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(errors.New("无法获取OSS客户端")))
			return
		}

		// 设置Content-Type和Accept-Ranges
		c.Header("Content-Type", contentType)

		// 获取文件大小
		fileSize := uploadFile.Size

		// 处理Range请求
		rangeHeader := c.GetHeader("Range")
		if rangeHeader != "" {
			// 解析Range头
			start, end := parseRangeHeaderForPreview(rangeHeader, fileSize)
			if start < 0 || start >= fileSize || end < start {
				c.Header("Content-Range", fmt.Sprintf("bytes */%d", fileSize))
				c.Status(http.StatusRequestedRangeNotSatisfiable)
				return
			}

			// 计算内容长度
			contentLength := end - start + 1

			// 设置响应头
			c.Header("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, fileSize))
			c.Header("Content-Length", fmt.Sprintf("%d", contentLength))
			c.Status(http.StatusPartialContent)

			// 使用OSS的Range功能
			rangeReader, err := storageImpl.GetBucket().GetObject(filepath.ToSlash(uploadFile.Key), oss.Range(start, end))
			if err != nil {
				c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(fmt.Errorf("oss range request error: %w", err)))
				return
			}
			defer rangeReader.Close()

			// 使用io.CopyBuffer高效传输
			buffer := make([]byte, 32*1024)
			_, err = io.CopyBuffer(c.Writer, rangeReader, buffer)
			if err != nil && err != io.EOF {
				return // 客户端可能已断开连接
			}
		} else {
			// 没有Range请求，传输整个文件
			c.Header("Content-Length", fmt.Sprintf("%d", fileSize))

			// 获取对象
			reader, err := storageImpl.GetBucket().GetObject(filepath.ToSlash(uploadFile.Key))
			if err != nil {
				c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(fmt.Errorf("oss file download error: %w", err)))
				return
			}
			defer reader.Close()

			// 使用io.CopyBuffer高效传输
			buffer := make([]byte, 32*1024)
			_, err = io.CopyBuffer(c.Writer, reader, buffer)
			if err != nil && err != io.EOF {
				c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(fmt.Errorf("stream file error: %w", err)))
				return
			}
		}
	} else {
		// 本地存储，使用 http.ServeContent 直接服务文件
		filePath := uploadFile.Key
		cleanBase := filepath.Clean(config.StorageBasePath)
		cleanKey := filepath.Clean(uploadFile.Key)
		if cleanKey != cleanBase && !strings.HasPrefix(cleanKey, cleanBase+string(os.PathSeparator)) {
			filePath = filepath.Join(config.StorageBasePath, uploadFile.Key)
		}

		logger.Infof(c.Request.Context(), "PreviewRawFileContent: local open file_id=%d upload_file_id=%d key=%q resolved_path=%q", fileID, uploadFile.ID, uploadFile.Key, filePath)

		// 打开文件
		file, err := os.Open(filePath)
		if err != nil {
			if os.IsNotExist(err) {
				c.JSON(http.StatusNotFound, model.NotFound.ToResponse(fmt.Errorf("read file error: %w", err)))
				return
			}
			c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(fmt.Errorf("read file error: %w", err)))
			return
		}
		defer file.Close()

		// 获取文件信息
		fileInfo, err := file.Stat()
		if err != nil {
			c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(fmt.Errorf("get file info error: %w", err)))
			return
		}

		// 设置Content-Type
		c.Header("Content-Type", contentType)

		// 使用 http.ServeContent 服务文件，它会自动处理 Range 请求
		http.ServeContent(c.Writer, c.Request, uploadFile.FileName, fileInfo.ModTime(), file)
	}
}

func serveUploadFilePreview(c *gin.Context, fileID int64, uploadFile *model.UploadFile, ext string) error {
	contentType := uploadFile.MimeType
	if contentType == "" {
		switch ext {
		case ".txt":
			contentType = "text/plain; charset=utf-8"
		case ".html", ".htm":
			contentType = "text/html; charset=utf-8"
		case ".md":
			contentType = "text/markdown; charset=utf-8"
		default:
			contentType = "application/octet-stream"
		}
	}

	downloadName := path.Base(strings.TrimSpace(uploadFile.FileName))
	if downloadName == "" || downloadName == "." || downloadName == "/" {
		downloadName = "preview.bin"
	}
	c.Header("Content-Disposition", `inline; filename="`+downloadName+`"; filename*=UTF-8''`+url.QueryEscape(downloadName))

	if config.StorageType == "aliyun_oss" {
		storageImpl, ok := storage.StorageInstance.(*storage.AliyunOSSStorage)
		if !ok {
			c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(errors.New("无法获取OSS客户端")))
			return fmt.Errorf("failed to get oss storage for sandbox output preview")
		}

		c.Header("Content-Type", contentType)

		fileSize := uploadFile.Size
		rangeHeader := c.GetHeader("Range")
		if rangeHeader != "" {
			start, end := parseRangeHeaderForPreview(rangeHeader, fileSize)
			if start < 0 || start >= fileSize || end < start {
				c.Header("Content-Range", fmt.Sprintf("bytes */%d", fileSize))
				c.Status(http.StatusRequestedRangeNotSatisfiable)
				return nil
			}

			contentLength := end - start + 1
			c.Header("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, fileSize))
			c.Header("Content-Length", fmt.Sprintf("%d", contentLength))
			c.Status(http.StatusPartialContent)

			rangeReader, err := openAIUploadFileOSSRangeObject(storageImpl, uploadFile.Key, start, end)
			if err != nil {
				c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(fmt.Errorf("oss range request error: %w", err)))
				return err
			}
			defer rangeReader.Close()

			buffer := make([]byte, 32*1024)
			_, err = io.CopyBuffer(c.Writer, rangeReader, buffer)
			if err != nil && err != io.EOF {
				return err
			}
			return nil
		}

		c.Header("Content-Length", fmt.Sprintf("%d", fileSize))
		reader, err := openAIUploadFileOSSObject(storageImpl, uploadFile.Key)
		if err != nil {
			c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(fmt.Errorf("oss file download error: %w", err)))
			return err
		}
		defer reader.Close()

		buffer := make([]byte, 32*1024)
		_, err = io.CopyBuffer(c.Writer, reader, buffer)
		if err != nil && err != io.EOF {
			c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(fmt.Errorf("stream file error: %w", err)))
			return err
		}
		return nil
	}

	filePath := uploadFile.Key
	basePath := storage.StorageInstance.GetBasePath()
	if basePath == "" {
		basePath = config.StorageBasePath
	}
	cleanBase := filepath.Clean(basePath)
	cleanKey := filepath.Clean(uploadFile.Key)
	if cleanKey != cleanBase && !strings.HasPrefix(cleanKey, cleanBase+string(os.PathSeparator)) {
		filePath = filepath.Join(basePath, uploadFile.Key)
	}

	logger.Infof(c.Request.Context(), "PreviewRawFileContent: local open ai file_id=%d upload_file_id=%d key=%q resolved_path=%q", fileID, uploadFile.ID, uploadFile.Key, filePath)

	file, err := os.Open(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			c.JSON(http.StatusNotFound, model.NotFound.ToResponse(fmt.Errorf("read file error: %w", err)))
			return err
		}
		c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(fmt.Errorf("read file error: %w", err)))
		return err
	}
	defer file.Close()

	fileInfo, err := file.Stat()
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(fmt.Errorf("get file info error: %w", err)))
		return err
	}

	c.Header("Content-Type", contentType)
	http.ServeContent(c.Writer, c.Request, downloadName, fileInfo.ModTime(), file)
	return nil
}

// parseRangeHeaderForPreview 解析Range请求头，用于预览功能
func parseRangeHeaderForPreview(rangeHeader string, fileSize int64) (int64, int64) {
	if !strings.HasPrefix(rangeHeader, "bytes=") {
		return 0, fileSize - 1
	}

	rangeHeader = rangeHeader[6:] // 移除 "bytes="
	parts := strings.Split(rangeHeader, "-")
	if len(parts) != 2 {
		return 0, fileSize - 1
	}

	var start, end int64
	var err error

	if parts[0] == "" {
		// suffix bytes
		suffix, err := strconv.ParseInt(parts[1], 10, 64)
		if err != nil || suffix <= 0 {
			return 0, fileSize - 1
		}
		start = fileSize - suffix
		end = fileSize - 1
	} else {
		start, err = strconv.ParseInt(parts[0], 10, 64)
		if err != nil || start < 0 {
			start = 0
		}

		if parts[1] == "" {
			// bytes=start-
			end = fileSize - 1
		} else {
			end, err = strconv.ParseInt(parts[1], 10, 64)
			if err != nil || end >= fileSize {
				end = fileSize - 1
			}
		}
	}

	return start, end
}

// GetFileBodyContent godoc
// @Summary 获取文件版本内容
// @Description 根据file_body_id获取文件内容，从content_path读取完整内容
// @Tags 文件内容管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param file_body_id path int true "文件内容ID"
// @Param filename path string false "文件名（可选）"
// @Success 200 {object} string "文件内容"
// @Router /api/file-version/{file_body_id} [get]
func GetFileBodyContent(c *gin.Context) {
	idStr := c.Param("file_body_id")
	if idStr == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("文件内容ID不能为空")))
		return
	}

	fileBodyID, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的文件内容ID")))
		return
	}

	// 获取文件内容记录
	fileBody, err := model.GetFileBodyByID(fileBodyID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
		return
	}

	// 加载完整内容（从content_path读取）
	if err := fileBody.LoadContent(); err != nil {
		c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(err))
		return
	}

	// 获取关联文件信息以确定Content-Type
	file, err := model.GetFileByIDOlny(fileBody.FileID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
		return
	}

	filePath := strings.TrimSuffix(file.Path, ".md")
	ext := strings.ToLower(filepath.Ext(filePath))

	contentType := "text/markdown; charset=utf-8"
	switch ext {
	case ".txt":
		contentType = "text/plain; charset=utf-8"
	case ".html", ".htm":
		contentType = "text/html; charset=utf-8"
	}

	c.Header("Content-Type", contentType)
	c.String(http.StatusOK, fileBody.Content)
}
