package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/storage"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/image_asset"
	"github.com/saintfish/chardet"
	"golang.org/x/text/encoding/ianaindex"
	"golang.org/x/text/encoding/simplifiedchinese"
)

var createRagJobsForFile = func(ctx context.Context, eid, fileID int64, paramsJSON string) ([]*model.RagJob, error) {
	factory := GetRagJobFactoryV2()
	if factory == nil {
		return nil, nil
	}
	return factory.CreateJobsForFile(ctx, eid, fileID, paramsJSON)
}

// FileProcessor 文件处理器
type FileProcessor struct {
	supportedFormats   []string
	lightweightFormats []string // 轻量级文件格式（不需要保存原始文件）
	heavyweightFormats []string // 重量级文件格式（需要完整保护）
}

// NewFileProcessor 创建文件处理器
func NewFileProcessor() *FileProcessor {
	return &FileProcessor{
		supportedFormats: []string{
			".txt", ".md", ".html", ".htm", // 现有格式
			".pdf",          // PDF
			".ppt", ".pptx", // PowerPoint
			".doc", ".docx", // Word
			".xls", ".xlsx", // Excel
			".csv", ".json", ".xml", // Text-based formats
			".epub", // EPub
			// 音频格式支持阿里云通义听悟API
			".mp3", ".wav", ".m4a", ".wma", ".aac", ".ogg", ".amr", ".flac", ".aiff",
			// 视频格式也可以转音频
			".mp4", ".wmv", ".m4v", ".flv", ".rmvb", ".dat", ".mov", ".mkv", ".webm", ".avi", ".mpeg", ".3gp",
			".pcm", ".opus", ".speex", // 实时音频流格式
		},
		lightweightFormats: []string{".txt", ".md"},   // md, txt 文件不保存原始文件
		heavyweightFormats: []string{".html", ".htm"}, // html 文件需要完整保护
	}
}

// isLightweightFile 判断是否为轻量级文件
func (fp *FileProcessor) isLightweightFile(filename string) bool {
	ext := strings.ToLower(filepath.Ext(filename))
	for _, format := range fp.lightweightFormats {
		if ext == format {
			return true
		}
	}
	return false
}

// preprocessImagesIfNeeded 如果需要则预处理图片链接，返回替换后的内容
func (fp *FileProcessor) preprocessImagesIfNeeded(eid, userID int64, content string) (string, []image_asset.UploadFileMeta, error) {
	// 检查内容中是否包含 /static 图片链接
	if !strings.Contains(content, "/static/") {
		return content, nil, nil
	}

	// 预处理图片链接
	newContent, metas, _, err := image_asset.PreprocessImages(eid, userID, content)
	if err != nil {
		logger.SysErrorf("preprocess images error: %v", err)
		return content, nil, err
	}

	return newContent, metas, nil
}

// enqueueImageDownloadsIfNeeded 如果有图片元数据则入队下载任务
func (fp *FileProcessor) enqueueImageDownloadsIfNeeded(eid, userID int64, metas []image_asset.UploadFileMeta) {
	if len(metas) == 0 {
		return
	}

	go func() {
		if err := image_asset.EnqueueImageDownloads(eid, userID, metas); err != nil {
			logger.SysErrorf("enqueue image downloads error: %v", err)
		}
	}()
}

// isHeavyweightFile 判断是否为重量级文件
func (fp *FileProcessor) isHeavyweightFile(filename string) bool {
	ext := strings.ToLower(filepath.Ext(filename))
	for _, format := range fp.heavyweightFormats {
		if ext == format {
			return true
		}
	}
	return false
}

// ProcessFileUpload 处理单个文件上传（统一保存原始文件策略）
func (fp *FileProcessor) ProcessFileUpload(task *UploadTask) error {
	fmt.Printf("开始处理文件上传 - 文件: %s, 类型: %s\n", task.FileHeader.Filename, filepath.Ext(task.FileHeader.Filename))

	// 统一使用完整保护策略，所有文件都保存原始文件
	return fp.processWithTransactionProtection(task, true)
}

// processLightweightFile 处理轻量级文件（md, txt）- 简化保护策略
func (fp *FileProcessor) processLightweightFile(task *UploadTask) error {
	fmt.Printf("使用轻量级处理策略 - 文件: %s\n", task.FileHeader.Filename)

	// 轻量级文件处理：重点保证事务原子性，不保存原始文件
	return fp.processWithTransactionProtection(task, false)
}

// processHeavyweightFile 处理重量级文件（html, htm）- 完整保护策略
func (fp *FileProcessor) processHeavyweightFile(task *UploadTask) error {
	fmt.Printf("使用完整保护策略 - 文件: %s\n", task.FileHeader.Filename)

	// 重量级文件处理：完整保护，包括原始文件备份
	return fp.processWithTransactionProtection(task, true)
}

// detectAndConvertEncoding 检测并转换文件编码为UTF-8
func (fp *FileProcessor) detectAndConvertEncoding(file multipart.File) (io.Reader, error) {
	// 读取文件内容用于编码检测
	content, err := io.ReadAll(file)
	if err != nil {
		return nil, fmt.Errorf("读取文件内容失败: %v", err)
	}

	// 检测文件编码
	detector := chardet.NewTextDetector()
	result, err := detector.DetectBest(content)
	if err != nil {
		// 如果检测失败，默认使用UTF-8
		logger.SysWarnf("编码检测失败，使用默认UTF-8编码: %v", err)
		return bytes.NewReader(content), nil
	}

	// 如果已经是UTF-8编码，直接返回
	if result.Charset == "UTF-8" {
		logger.SysLog("文件已使用UTF-8编码")
		return bytes.NewReader(content), nil
	}

	// 转换为UTF-8编码
	logger.SysLogf("检测到文件编码: %s，转换为UTF-8", result.Charset)
	var decodedContent []byte
	switch result.Charset {
	case "GB-18030", "GBK", "HZ-GB-2312":
		decoder := simplifiedchinese.GB18030.NewDecoder()
		decodedContent, err = decoder.Bytes(content)
		if err != nil {
			return nil, fmt.Errorf("GBK/GB18030解码失败: %v", err)
		}
	default:
		// 对于其他编码，尝试查找对应的解码器
		e, err := ianaindex.MIB.Encoding(result.Charset)
		if err != nil || e == nil {
			logger.SysWarnf("不支持的编码格式: %s，使用原始内容", result.Charset)
			return bytes.NewReader(content), nil
		}
		decoder := e.NewDecoder()
		decodedContent, err = decoder.Bytes(content)
		if err != nil {
			return nil, fmt.Errorf("解码失败: %v", err)
		}
	}

	return bytes.NewReader(decodedContent), nil
}

// processWithTransactionProtection 使用事务保护的文件处理
func (fp *FileProcessor) processWithTransactionProtection(task *UploadTask, saveOriginal bool) error {
	var uploadFile *model.UploadFile
	var err error

	if GetBatchUploadManagerInstance().IsBatchCancelled(task.BatchID) {
		return errBatchUploadCancelled
	}

	// 更新批量上传进度
	fp.updateBatchProgress(task, model.UploadStatusUploading, 26)

	if GetBatchUploadManagerInstance().IsBatchCancelled(task.BatchID) {
		return errBatchUploadCancelled
	}

	// 创建上传记录（事务化处理）
	if saveOriginal {
		uploadFile, err = fp.createUploadFileRecordFromTask(task)
	} else {
		uploadFile, err = fp.createLightweightUploadRecord(task)
	}
	if err != nil {
		return fmt.Errorf("创建上传记录失败: %v", err)
	}
	task.DatabaseID = uploadFile.ID

	if GetBatchUploadManagerInstance().IsBatchCancelled(task.BatchID) {
		fp.cleanupCancelledUpload(task, uploadFile, 0)
		return errBatchUploadCancelled
	}

	// 标记为已上传并更新进度
	if err := uploadFile.MarkAsUploaded(); err != nil {
		return fmt.Errorf("标记为已上传失败: %v", err)
	}

	// 更新批量上传进度
	fp.updateBatchProgress(task, model.UploadStatusUploaded, 100)

	if GetBatchUploadManagerInstance().IsBatchCancelled(task.BatchID) {
		fp.cleanupCancelledUpload(task, uploadFile, 0)
		return errBatchUploadCancelled
	}

	// 记录处理开始
	fmt.Printf("上传记录已创建 - ID: %d, 文件: %s\n", uploadFile.ID, task.FileHeader.Filename)

	library, err := model.GetLibraryByID(task.EID, task.LibraryID)
	if err != nil {
		uploadFile.MarkAsFailed(fmt.Sprintf("获取知识库信息失败: %v", err))
		fp.updateBatchProgress(task, "failed", 0)
		return fmt.Errorf("获取知识库信息失败: %v", err)
	}

	// 创建文件记录，使用 base_path
	dirManager := NewDirectoryManager()
	fileID, err := dirManager.CreateFileRecord(task.EID, task.LibraryID, task.RelativePath, uploadFile.ID, task.BasePath, task.UserID, task.DuplicateMode, library.IsPersonalLibrary(), task.OriginType, task.OriginSource, task.OriginRefID)

	if err != nil {
		uploadFile.MarkAsFailed(fmt.Sprintf("创建文件记录失败: %v", err))
		fp.updateBatchProgress(task, "failed", 0)
		return fmt.Errorf("创建文件记录失败: %v", err)
	}

	// FFprobe 探测媒体时长（上传时立即执行，不依赖 RAG 管线）
	if common.IsMediaFile(task.FileHeader.Filename) {
		mediaURL := uploadFile.GetPreviewOrOssDownloadUrl()
		probeCtx, probeCancel := context.WithTimeout(context.Background(), 30*time.Second)
		if d := common.ProbeDurationMs(probeCtx, mediaURL); d > 0 {
			if err := model.DB.Model(&model.File{}).Where("id = ?", fileID).Update("duration_ms", d).Error; err != nil {
				logger.SysWarnf("【媒体时长】上传时保存时长失败: fileID=%d err=%v", fileID, err)
			}
		}
		probeCancel()
	}

	if GetBatchUploadManagerInstance().IsBatchCancelled(task.BatchID) {
		fp.cleanupCancelledUpload(task, uploadFile, fileID)
		return errBatchUploadCancelled
	}

	// 更新任务中的 FileIDRef
	task.FileIDRef = fileID

	if GetBatchUploadManagerInstance().IsBatchCancelled(task.BatchID) {
		fp.cleanupCancelledUpload(task, uploadFile, fileID)
		return errBatchUploadCancelled
	}

	// 文件名上传成功就是成功了，设计如此
	fp.updateBatchProgress(task, "completed", 100)
	// // 更新进度为文件记录创建完成，但还不是完全完成
	// fp.updateBatchProgress(task, "converting", 75)

	// 创建系统日志
	space, _ := model.GetSpaceByID(task.EID, library.SpaceID)
	fileName := filepath.Base(task.RelativePath)
	log := model.SystemLog{
		Eid:      task.EID,
		UserID:   task.UserID,
		Nickname: task.Nickname,
		Module:   model.SystemLogModuleFile,
		Action:   model.SystemLogActionCreate,
		Content:  fmt.Sprintf("在【%s】知识库【%s】新建了《%s》", space.Name, library.Name, fileName),
		IP:       task.IP,
	}
	model.CreateSystemLog(&log)

	if GetBatchUploadManagerInstance().IsBatchCancelled(task.BatchID) {
		fp.cleanupCancelledUpload(task, uploadFile, fileID)
		return errBatchUploadCancelled
	}

	if library.IsPersonalLibrary() {
		ext := strings.ToLower(filepath.Ext(task.FileHeader.Filename))
		recordingFormats := []string{".m4a", ".mp3", ".wav", ".aac", ".flac", ".opus"}
		isRecordingFile := false
		for _, format := range recordingFormats {
			if ext == format {
				isRecordingFile = true
				break
			}
		}

		if isRecordingFile {
			recordingConfig, err := model.ValidateOrCreateRecordingConfig(task.EID)
			if err != nil || !recordingConfig.Enabled || recordingConfig.ParserPlatform == "" {
				logger.Debugf(context.Background(), "【录音】录音功能未启用或未配置解析平台，跳过解析 - 文件ID: %d", fileID)
				return nil
			}
			logger.Infof(context.Background(), "【录音】个人知识库录音文件需要解析 - 文件ID: %d, 扩展名: %s, 平台: %s", fileID, ext, recordingConfig.ParserPlatform)
			// 将解析平台写入任务参数，供 RAG 管线使用
			task.ParseType = recordingConfig.ParserPlatform
		} else {
			logger.Debugf(context.Background(), "【录音】个人知识库非录音文件跳过解析 - 文件ID: %d", fileID)
			return nil
		}
	}

	// 创建文档转换任务
	fmt.Printf("创建文档转换任务 - 文件ID: %d, 上传ID: %d\n", fileID, uploadFile.ID)

	params := map[string]interface{}{
		"eid":           task.EID,
		"file_id":       fileID,
		"user_id":       task.UserID,
		"library_id":    task.LibraryID,
		"upload_id":     uploadFile.ID,
		"origin_status": model.FileConversiontatusInactive,
	}
	if task.ParseType != "" {
		params["parse_type"] = task.ParseType
	}
	paramsJSON, err := json.Marshal(params)
	if err != nil {
		logger.SysErrorf("序列化文档转换任务参数失败: %v", err)
		// 不阻塞主流程，继续执行
	} else {
		// 创建文档转换任务 (V2 迁移测试)
		ctx := context.Background()

		// 使用 V2 工厂根据策略自动创建任务
		jobs, err := createRagJobsForFile(ctx, task.EID, fileID, string(paramsJSON))
		if err != nil {
			logger.SysErrorf("创建文档转换任务(V2)失败: %v", err)
			// 不阻塞主流程，继续执行
		} else if len(jobs) > 0 {
			model.UpdateFileConversionStatus(fileID, model.FileConversionStatusPending)
			fmt.Printf("文档转换任务(V2)已创建 - 首个任务ID: %d\n", jobs[0].JobID)
		}
	}

	return nil
}

// createTempFileFromReader 从Reader创建临时文件
func (fp *FileProcessor) createTempFileFromReader(reader io.Reader, filename string) (multipart.File, error) {
	// 创建临时文件
	tempFile, err := os.CreateTemp("", fmt.Sprintf("encoding_converted_%s_*.tmp", filepath.Base(filename)))
	if err != nil {
		return nil, fmt.Errorf("创建临时文件失败: %v", err)
	}

	// 复制内容到临时文件
	_, err = io.Copy(tempFile, reader)
	if err != nil {
		tempFile.Close()
		os.Remove(tempFile.Name())
		return nil, fmt.Errorf("复制内容到临时文件失败: %v", err)
	}

	// 重置文件指针到开头
	if _, err := tempFile.Seek(0, 0); err != nil {
		tempFile.Close()
		os.Remove(tempFile.Name())
		return nil, fmt.Errorf("重置文件指针失败: %v", err)
	}

	return tempFile, nil
}

// ValidateFileFormat 文件格式验证
func (fp *FileProcessor) ValidateFileFormat(filename string) bool {
	ext := strings.ToLower(filepath.Ext(filename))
	for _, format := range fp.supportedFormats {
		if ext == format {
			return true
		}
	}
	return false
}

// SaveFile 保存文件
func (fp *FileProcessor) SaveFile(path string, content []byte) error {
	// 确保目录存在
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("创建目录失败: %v", err)
	}

	// 写入文件
	file, err := os.Create(path)
	if err != nil {
		return fmt.Errorf("创建文件失败: %v", err)
	}
	defer file.Close()

	_, err = file.Write(content)
	if err != nil {
		return fmt.Errorf("写入文件失败: %v", err)
	}

	return nil
}

// GetSupportedFormats 获取支持的文件格式
func (fp *FileProcessor) GetSupportedFormats() []string {
	return fp.supportedFormats
}

// ValidateFileSize 验证文件大小
func (fp *FileProcessor) ValidateFileSize(size int64) bool {
	// 使用配置项中的文档单文件大小限制
	return size <= config.DOCUMENT_SINGLE_FILE_MAX_SIZE
}

// createLightweightUploadRecord 为轻量级文件创建上传记录（不保存原始文件）
func (fp *FileProcessor) createLightweightUploadRecord(task *UploadTask) (*model.UploadFile, error) {
	fmt.Printf("创建轻量级上传记录 - 文件: %s\n", task.FileHeader.Filename)

	// 轻量级文件直接计算哈希，不保存原始文件
	file, err := task.FileHeader.Open()
	if err != nil {
		return nil, fmt.Errorf("打开文件失败: %v", err)
	}
	defer file.Close()

	// 计算文件哈希
	hashStr, err := storage.GetFileHash(file)
	if err != nil {
		return nil, fmt.Errorf("计算文件哈希失败: %v", err)
	}

	extension := filepath.Ext(task.FileHeader.Filename)
	previewKey, err := model.GetPreviewKey(hashStr, extension, task.EID)
	if err != nil {
		return nil, fmt.Errorf("生成预览键失败: %v", err)
	}

	// 轻量级文件不保存到存储，只创建数据库记录
	uploadFile := &model.UploadFile{
		FileName:   task.FileHeader.Filename,
		Key:        "", // 轻量级文件不保存原始文件
		Eid:        task.EID,
		UserID:     task.UserID,
		Size:       task.FileHeader.Size,
		Extension:  extension,
		MimeType:   task.FileHeader.Header.Get("Content-Type"),
		Hash:       hashStr,
		PreviewKey: previewKey,
		Status:     model.UploadStatusPending,
	}

	if err := uploadFile.Save(); err != nil {
		return nil, fmt.Errorf("保存轻量级上传记录失败: %v", err)
	}

	return uploadFile, nil
}

// updateBatchProgress 更新批量上传进度
func (fp *FileProcessor) updateBatchProgress(task *UploadTask, status string, progress float64) {
	if task.BatchID == "" || task.FileID == "" {
		return
	}

	manager := GetBatchUploadManagerInstance()
	if manager.IsBatchCancelled(task.BatchID) {
		return
	}
	if batch, err := manager.GetBatch(task.BatchID); err == nil {
		// Fix: Use GetFileUpload for thread-safe access to the map
		if fileUploadPtr, exists := batch.GetFileUpload(task.FileID); exists {
			// Create a copy to modify, avoiding race conditions on struct fields
			fileUpload := *fileUploadPtr

			fileUpload.Status = status
			fileUpload.Progress = progress
			if status == "failed" {
				// 从数据库获取错误信息，如果没有则使用通用错误
				if task.DatabaseID != 0 {
					if dbFile, err := model.GetUploadFileByID(task.DatabaseID); err == nil && dbFile != nil && dbFile.Error != "" {
						fileUpload.Error = dbFile.Error
					} else {
						fileUpload.Error = "处理失败"
					}
				} else {
					fileUpload.Error = "处理失败"
				}
			}

			// 如果task中有DatabaseID和FileID，则使用它们
			if task.DatabaseID != 0 {
				fileUpload.DatabaseID = task.DatabaseID
			}
			if task.FileIDRef != 0 {
				fileUpload.FileID = task.FileIDRef
			}

			// Pass the address of the modified copy
			manager.updateFileProgress(task.BatchID, task.FileID, &fileUpload)
		}
	}
}

// cleanupCancelledUpload 回收取消时已经创建的上传/文件记录
func (fp *FileProcessor) cleanupCancelledUpload(task *UploadTask, uploadFile *model.UploadFile, fileID int64) {
	reason := errBatchUploadCancelled.Error()

	if fileID != 0 {
		if err := model.DeleteFile(task.EID, fileID); err != nil {
			fmt.Printf("取消上传时删除文件记录失败 - file_id: %d, err: %v\n", fileID, err)
		}
	}

	if uploadFile != nil {
		if markErr := uploadFile.MarkAsFailed(reason); markErr != nil {
			fmt.Printf("取消上传时标记上传记录失败 - upload_file_id: %d, err: %v\n", uploadFile.ID, markErr)
		}
		if uploadFile.Key != "" {
			if deleteErr := storage.StorageInstance.Delete(uploadFile.Key); deleteErr != nil {
				fmt.Printf("取消上传时删除存储文件失败 - key: %s, err: %v\n", uploadFile.Key, deleteErr)
			}
		}
	}
}

// cleanupFailedUpload 清理失败的上传记录（增强版）
func (fp *FileProcessor) cleanupFailedUpload(uploadFileID int64, reason string) {
	fmt.Printf("开始清理失败的上传记录 - ID: %d, 原因: %s\n", uploadFileID, reason)

	// 获取上传文件记录
	uploadFile, err := model.GetUploadFileByID(uploadFileID)
	if err != nil {
		fmt.Printf("获取上传文件记录失败 - ID: %d, 错误: %v\n", uploadFileID, err)
		return
	}

	// 标记上传文件为失败状态
	if markErr := uploadFile.MarkAsFailed(reason); markErr != nil {
		fmt.Printf("标记上传文件失败状态出错 - ID: %d, 错误: %v\n", uploadFileID, markErr)
	} else {
		fmt.Printf("已标记上传文件为失败状态 - ID: %d\n", uploadFileID)
	}

	// 清理存储的文件（如果存在）
	if uploadFile.Key != "" {
		if deleteErr := storage.StorageInstance.Delete(uploadFile.Key); deleteErr != nil {
			fmt.Printf("删除存储文件失败 - Key: %s, 错误: %v\n", uploadFile.Key, deleteErr)
		} else {
			fmt.Printf("已删除存储文件 - Key: %s\n", uploadFile.Key)
		}
	}

	// 记录清理操作日志
	fmt.Printf("上传记录清理完成 - ID: %d, 文件: %s\n", uploadFileID, uploadFile.FileName)
}

// recoverIncompleteUploads 恢复未完成的上传任务（系统启动时调用）
func (fp *FileProcessor) RecoverIncompleteUploads() error {
	fmt.Printf("开始恢复未完成的上传任务\n")

	// 查找处理中和转换中的上传文件
	processingFiles, err := model.GetUploadFilesByStatus(model.UploadStatusUploading)
	if err != nil {
		return fmt.Errorf("查询处理中文件失败: %v", err)
	}

	convertingFiles, err := model.GetUploadFilesByStatus(model.UploadStatusConverting)
	if err != nil {
		return fmt.Errorf("查询转换中文件失败: %v", err)
	}

	allIncompleteFiles := append(processingFiles, convertingFiles...)

	if len(allIncompleteFiles) == 0 {
		fmt.Printf("没有发现未完成的上传任务\n")
		return nil
	}

	fmt.Printf("发现 %d 个未完成的上传任务，开始清理\n", len(allIncompleteFiles))

	// 清理未完成的上传任务
	for _, uploadFile := range allIncompleteFiles {
		reason := fmt.Sprintf("系统重启时发现未完成任务，状态: %s", uploadFile.Status)
		fp.cleanupFailedUpload(uploadFile.ID, reason)
	}

	fmt.Printf("未完成上传任务清理完成，共处理 %d 个文件\n", len(allIncompleteFiles))
	return nil
}

// createUploadFileRecordFromTask 从任务创建上传文件记录（流式处理版本）
func (fp *FileProcessor) createUploadFileRecordFromTask(task *UploadTask) (*model.UploadFile, error) {
	// 打开文件
	file, err := task.FileHeader.Open()
	if err != nil {
		return nil, fmt.Errorf("打开文件失败: %v", err)
	}
	defer file.Close()

	// 创建临时文件用于流式处理
	tempFile, err := os.CreateTemp("", fmt.Sprintf("upload_%s_*.tmp", task.FileID))
	if err != nil {
		return nil, fmt.Errorf("创建临时文件失败: %v", err)
	}
	defer func() {
		tempFile.Close()
		os.Remove(tempFile.Name())
	}()

	// 流式复制文件内容到临时文件，避免大文件占用内存
	_, err = io.Copy(tempFile, file)
	if err != nil {
		return nil, fmt.Errorf("复制文件内容失败: %v", err)
	}

	// 重置临时文件指针到开头
	if _, err := tempFile.Seek(0, 0); err != nil {
		return nil, fmt.Errorf("重置临时文件指针失败: %v", err)
	}

	// 计算文件哈希
	hashStr, err := storage.GetFileHash(tempFile)
	if err != nil {
		return nil, fmt.Errorf("计算文件哈希失败: %v", err)
	}

	// 重置临时文件指针到开头准备读取内容
	if _, err := tempFile.Seek(0, 0); err != nil {
		return nil, fmt.Errorf("重置临时文件指针失败: %v", err)
	}

	// 读取临时文件内容用于存储
	fileContent, err := io.ReadAll(tempFile)
	if err != nil {
		return nil, fmt.Errorf("读取临时文件内容失败: %v", err)
	}

	extension := filepath.Ext(task.FileHeader.Filename)
	previewKey, err := model.GetPreviewKey(hashStr, extension, task.EID)
	if err != nil {
		return nil, fmt.Errorf("生成预览键失败: %v", err)
	}

	key := model.GetFileKey(previewKey, task.EID, task.UserID)

	// 存储文件
	err = storage.StorageInstance.Save(fileContent, key)
	if err != nil {
		return nil, fmt.Errorf("存储文件失败: %v", err)
	}

	// 创建上传文件记录
	uploadFile := &model.UploadFile{
		FileName:   task.FileHeader.Filename,
		Key:        key,
		Eid:        task.EID,
		UserID:     task.UserID,
		Size:       task.FileHeader.Size,
		Extension:  extension,
		MimeType:   task.FileHeader.Header.Get("Content-Type"),
		Hash:       hashStr,
		PreviewKey: previewKey,
		Status:     model.UploadStatusPending,
	}

	if err := uploadFile.Save(); err != nil {
		return nil, fmt.Errorf("保存上传记录失败: %v", err)
	}

	return uploadFile, nil
}

// getMimeType 根据文件扩展名获取MIME类型
func (fp *FileProcessor) getMimeType(filename string) string {
	ext := strings.ToLower(filepath.Ext(filename))
	switch ext {
	case ".txt":
		return "text/plain"
	case ".md":
		return "text/markdown"
	case ".html", ".htm":
		return "text/html"
	default:
		return "application/octet-stream"
	}
}

// isConnectionError 检查是否是连接相关错误
func isConnectionError(err error) bool {
	if err == nil {
		return false
	}

	errMsg := strings.ToLower(err.Error())
	connectionErrors := []string{
		"invalid connection",
		"connection refused",
		"connection reset",
		"connection timeout",
		"broken pipe",
		"network is unreachable",
		"no such host",
		"context deadline exceeded",
		"i/o timeout",
	}

	for _, connErr := range connectionErrors {
		if strings.Contains(errMsg, connErr) {
			return true
		}
	}

	return false
}
