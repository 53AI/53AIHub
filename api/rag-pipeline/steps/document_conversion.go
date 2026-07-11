package steps

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/storage"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/document"
	"github.com/53AI/53AIHub/service/image_asset"
	"gorm.io/gorm"
)

// DocumentConversionStep 文档转换步骤
type DocumentConversionStep struct {
	BaseStep
	DB *gorm.DB
}

// DocumentConversionParameters 文档转换步骤的参数
type DocumentConversionParameters struct {
	Eid       int64  `json:"eid"`
	FileID    int64  `json:"file_id"`
	UploadID  int64  `json:"upload_id"`
	UserID    int64  `json:"user_id"`
	LibraryID int64  `json:"library_id"`
	ParseType string `json:"parse_type"`
}

// DocumentConversionResult 文档转换步骤的结果
type DocumentConversionResult struct {
	Success       bool   `json:"success"`
	ContentLength int    `json:"content_length"`
	Converted     bool   `json:"converted"`
	FileType      string `json:"file_type"`
	ConfigId      int64  `json:"config_id"`
}

// NewDocumentConversionStep 创建新的文档转换步骤
func NewDocumentConversionStep(db *gorm.DB) *DocumentConversionStep {
	return &DocumentConversionStep{
		DB: db,
	}
}

// Execute 执行文档转换步骤
func (s *DocumentConversionStep) Execute(parameters any) error {
	s.Step.StartProcessing(parameters)

	// 类型断言获取参数
	params, ok := parameters.(DocumentConversionParameters)
	if !ok {
		err := fmt.Errorf("invalid parameters type, expected DocumentConversionParameters")
		s.Step.CompleteWithError(err.Error())
		return err
	}

	// 获取上传文件信息
	var uploadFile model.UploadFile
	err := s.DB.Where("eid = ? AND id = ?", params.Eid, params.UploadID).First(&uploadFile).Error
	if err != nil {
		errMsg := fmt.Sprintf("获取上传文件信息失败: %v", err)
		s.Step.CompleteWithError(errMsg)
		return fmt.Errorf("%s", errMsg)
	}

	// 获取文件信息
	var file model.File
	err = s.DB.Where("eid = ? AND id = ?", params.Eid, params.FileID).First(&file).Error
	if err != nil {
		errMsg := fmt.Sprintf("获取文件信息失败: %v", err)
		s.Step.CompleteWithError(errMsg)
		return fmt.Errorf("%s", errMsg)
	}

	// 检查是否有停止信号
	err = common.CheckRagTaskStop(file.LibraryID, file.ID)
	if err != nil {
		s.Step.CompleteWithError(err)
		return err
	}

	// 将文件转换状态设置为"converting"
	if err := model.UpdateFileConversionStatus(params.FileID, model.FileConversionStatusConverting); err != nil {
		// 记录错误但不中断处理流程
		logger.SysErrorf("警告: 更新文件转换状态为converting失败: %v", err)
	}

	// 获取适合的文档处理策略
	converterService := document.NewConverterService()

	// 确保存储实例已正确初始化
	if storage.StorageInstance == nil {
		err := fmt.Errorf("storage.StorageInstance 未初始化")
		s.Step.CompleteWithError(err.Error())
		return err
	}

	strategyFactory := document.NewDocumentStrategyFactory(converterService, storage.StorageInstance)
	strategy := strategyFactory.GetStrategy(uploadFile.FileName, params.LibraryID)

	// 使用策略处理文档
	var result *document.DocumentProcessResult
	var content []byte
	if strategy.GetStrategyName() == "docconv" {
		result, err = strategy.ProcessWithUploadFile(params.FileID, content, uploadFile.FileName, uploadFile.Size, params.Eid, params.UserID, &uploadFile, params.ParseType)
	} else {
		content, err := storage.StorageInstance.Load(uploadFile.Key)
		if err == nil {
			result, err = strategy.Process(content, uploadFile.FileName, uploadFile.Size, params.Eid, params.UserID)
		}
	}
	if err == nil && result == nil {
		err = fmt.Errorf("处理文档失败: 文档处理策略返回空结果")
	}

	// 根据处理结果更新文件转换状态
	if err != nil {
		// 处理失败，将文件转换状态设置为"failed"
		if updateErr := model.UpdateFileConversionStatus(params.FileID, model.FileConversionStatusFail); updateErr != nil {
			logger.SysErrorf("警告: 更新文件转换状态为failed失败: %v", updateErr)
		}

		logger.SysErrorf("文档处理失败 | upload_id=%d eid=%d user_id=%d file=%s err=%v",
			uploadFile.ID, params.Eid, params.UserID, uploadFile.FileName, err)

		// 更新上传文件状态为失败
		uploadFile.MarkAsFailed(fmt.Sprintf("处理文档失败: %v", err))
		s.DB.Save(&uploadFile)

		errMsg := fmt.Sprintf("处理文档失败: %v", err)
		s.Step.CompleteWithError(errMsg)
		return fmt.Errorf("%s", errMsg)
	} else {
		// 处理成功，将文件转换状态设置为"normal"
		if updateErr := model.UpdateFileConversionStatus(params.FileID, model.FileConversionStatusNormal); updateErr != nil {
			logger.SysErrorf("警告: 更新文件转换状态为normal失败: %v", updateErr)
		}

		if result.DurationMs == 0 && common.IsMediaFile(uploadFile.FileName) {
			mediaPath := uploadFile.GetPreviewOrOssDownloadUrl()
			probeCtx, probeCancel := context.WithTimeout(context.Background(), 30*time.Second)
			if d := common.ProbeDurationMs(probeCtx, mediaPath); d > 0 {
				result.DurationMs = d
			}
			probeCancel()
		}

		if result.DurationMs > 0 {
			if err := s.DB.Model(&model.File{}).Where("id = ?", params.FileID).Update("duration_ms", result.DurationMs).Error; err != nil {
				logger.SysErrorf("警告: 保存媒体时长失败: %v", err)
			}
		}

		// ✅ 确保只在处理成功时才更新 ConfigID，用于分块
		if result != nil && result.ConfigId > 0 {
			file.ConfigID = &result.ConfigId
			if err := s.DB.Model(&file).Where("id = ? AND eid = ?", params.FileID, params.Eid).Update("config_id", result.ConfigId).Error; err != nil {
				logger.SysErrorf("警告: 更新文件ConfigID失败: %v", err)
			}
		}
	}

	// 预处理图片链接（在保存前替换）
	var imageMetas []image_asset.UploadFileMeta
	processedContent, imageMetas, err := s.preprocessImagesIfNeeded(params.Eid, params.UserID, result.ProcessedContent)
	if err != nil {
		logger.SysErrorf("预处理图片失败: %v", err)
		// 继续使用原内容，不阻塞主流程
		processedContent = result.ProcessedContent
		imageMetas = nil
	}

	// 使用事务保存文件体
	err = s.DB.Transaction(func(tx *gorm.DB) error {
		// 创建文件体（使用预处理后的内容）
		fileBody := &model.FileBody{
			FileID:    params.FileID,
			LibraryID: params.LibraryID,
			Eid:       params.Eid,
			Content:   processedContent,
			UserID:    params.UserID,
		}

		// 显式调用内容存储处理，确保内容被截断并保存到存储服务
		// 虽然 BeforeSave 钩子应该会自动触发，但在事务中显式调用更安全
		if err := fileBody.ProcessContentStorage(); err != nil {
			return fmt.Errorf("处理文件内容存储失败: %v", err)
		}

		if err := tx.Create(fileBody).Error; err != nil {
			return fmt.Errorf("保存文件体失败: %v", err)
		}

		// 更新文件解析状态
		if err := model.UpdateFileParsingStatus(params.FileID, model.FileParsingStatusNormal); err != nil {
			logger.SysErrorf("更新文件解析状态失败: %v", err)
			// 不阻塞主流程
		}

		// 更新上传文件状态为完成
		if err := uploadFile.MarkAsCompleted(); err != nil {
			logger.SysErrorf("标记上传文件为完成状态失败: %v", err)
			// 不阻塞主流程
		} else {
			tx.Save(&uploadFile)
		}

		return nil
	})

	if err != nil {
		// 保存失败时，设置解析状态为 failed
		model.UpdateFileParsingStatus(params.FileID, model.FileParsingStatusFail)
		uploadFile.MarkAsFailed(fmt.Sprintf("保存文件体失败: %v", err))
		s.DB.Save(&uploadFile)

		errMsg := fmt.Sprintf("保存文件体失败: %v", err)
		s.Step.CompleteWithError(errMsg)
		return fmt.Errorf("%s", errMsg)
	}

	// 异步入队图片下载任务
	s.enqueueImageDownloadsIfNeeded(params.Eid, params.UserID, imageMetas)

	// 获取文件类型
	fileType := "unknown"
	if result != nil {
		fileType = result.FileType
	}

	// 创建结果
	resultData := DocumentConversionResult{
		Success:       true,
		ContentLength: len(processedContent),
		Converted:     result != nil && result.NeedsConversion,
		FileType:      fileType,
		ConfigId:      result.ConfigId,
	}

	logger.Infof(nil, "文档转换完成 - 文件ID: %d, 内容大小: %d bytes, 转换: %v",
		params.FileID, len(processedContent), resultData.Converted)

	// 完成步骤并返回结果
	s.Step.CompleteSuccessfully(resultData)
	return nil
}

// preprocessImagesIfNeeded 预处理图片链接
func (s *DocumentConversionStep) preprocessImagesIfNeeded(eid, userID int64, content string) (string, []image_asset.UploadFileMeta, error) {
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

// enqueueImageDownloadsIfNeeded 异步入队图片下载任务
func (s *DocumentConversionStep) enqueueImageDownloadsIfNeeded(eid, userID int64, imageMetas []image_asset.UploadFileMeta) {
	if len(imageMetas) == 0 {
		return
	}

	go func() {
		if err := image_asset.EnqueueImageDownloads(eid, userID, imageMetas); err != nil {
			logger.SysErrorf("enqueue image downloads error: %v", err)
		}
	}()
}
