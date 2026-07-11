package steps

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
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

// NewDocumentParsingHandler 创建 document_parsing 步骤处理函数
func NewDocumentParsingHandler(db *gorm.DB) func(ctx context.Context, job *model.RagJob, config json.RawMessage) error {
	return func(ctx context.Context, job *model.RagJob, stepConfig json.RawMessage) error {
		// 1. 解析参数
		var params map[string]interface{}
		if err := json.Unmarshal([]byte(job.StartParameters), &params); err != nil {
			return fmt.Errorf("解析任务参数失败: %v", err)
		}

		eid := int64(0)
		if v, ok := params["eid"]; ok {
			eid = int64(v.(float64))
		}
		fileID := int64(0)
		if v, ok := params["file_id"]; ok {
			fileID = int64(v.(float64))
		}
		uploadID := int64(0)
		if v, ok := params["upload_id"]; ok {
			uploadID = int64(v.(float64))
		}
		userID := int64(0)
		if v, ok := params["user_id"]; ok {
			userID = int64(v.(float64))
		}

		logger.Info(ctx, fmt.Sprintf("DocumentParsingStepHandler: processing job %d for file %d", job.JobID, fileID))

		// 2. 获取文件信息
		var file model.File
		if err := db.Where("eid = ? AND id = ?", eid, fileID).First(&file).Error; err != nil {
			return fmt.Errorf("获取文件信息失败: %v", err)
		}

		// 3. 检查停止信号
		if err := common.CheckRagTaskStop(file.LibraryID, file.ID); err != nil {
			return err
		}

		// 4. 获取上传文件信息
		var uploadFile model.UploadFile
		hasUploadFile := false
		if uploadID > 0 {
			if err := db.Where("eid = ? AND id = ?", eid, uploadID).First(&uploadFile).Error; err == nil {
				hasUploadFile = true
			}
		} else if file.UploadFileID > 0 {
			// 尝试从 file 关联获取
			if err := db.Where("eid = ? AND id = ?", eid, file.UploadFileID).First(&uploadFile).Error; err == nil {
				hasUploadFile = true
				uploadID = uploadFile.ID
			}
		}

		// 准备统计数据
		var fileSize int64 = 0
		var pageCount int = 0
		var fileExt string
		var needsConversion = false
		parseType := ""
		engineFound := false
		var smartMatchResult *SmartMatchResult

		// 5. 判断处理逻辑
		if !hasUploadFile {
			// 情况 1: model/file 没有 uploadfile, 是直接保存 markdown 文件，无需转换
			logger.Info(ctx, "DocumentParsingStepHandler: No upload file, skipping conversion (assuming markdown saved directly)")
		} else {
			fileSize = uploadFile.Size
			fileExt = strings.ToLower(filepath.Ext(uploadFile.FileName))

			if fileExt == ".txt" || fileExt == ".md" || fileExt == ".markdown" {
				// 情况 2: txt 和 markdown，无需转换
				// 但仍需读取内容并保存到 file_bodies
				logger.Info(ctx, fmt.Sprintf("DocumentParsingStepHandler: File extension %s, using simple strategy", fileExt))
				needsConversion = true
			} else {
				// 情况 3: 其他文件
				needsConversion = true
			}
		}

		if needsConversion && hasUploadFile {
			// 执行转换逻辑 (复用 DocumentConversionStep 逻辑)
			// 更新状态
			model.UpdateFileConversionStatus(fileID, model.FileConversionStatusConverting)

			converterService := document.NewConverterService()
			strategyFactory := document.NewDocumentStrategyFactory(converterService, storage.StorageInstance)
			strategy := strategyFactory.GetStrategy(uploadFile.FileName, file.LibraryID)

			var result *document.DocumentProcessResult
			var err error

			// 获取 parse_type
			// V2 优先从 stepConfig 获取 (支持单步重试时修改配置)
			if stepConfig != nil {
				var cfg struct {
					Engine                *string `json:"engine"`
					EnableSmartMatch      bool    `json:"enable_smart_match"`
					MatchPreferencePrompt string  `json:"match_preference_prompt"`
				}
				if err := json.Unmarshal(stepConfig, &cfg); err == nil && cfg.Engine != nil {
					parseType = normalizeDocumentParsingEngine(*cfg.Engine)
					engineFound = true
					logger.Infof(ctx, "DocumentParsingStepHandler: Using engine from stepConfig: '%s'", parseType)
				}

				if cfg.EnableSmartMatch && hasUploadFile {
					result, err := selectDocumentParsingSmartMatch(ctx, db, eid, uploadFile.FileName, fileExt, cfg.MatchPreferencePrompt)
					if err != nil {
						logger.Warn(ctx, fmt.Sprintf("DocumentParsingStepHandler: smart match failed, fallback to existing parse type: %v", err))
					} else {
						smartMatchResult = result
						parseType = result.SelectedKey
						engineFound = true
						logger.Infof(ctx, "DocumentParsingStepHandler: smart match selected parse type '%s' (fallback=%v)", parseType, result.FallbackUsed)
					}
				}
			}

			// 如果 stepConfig 没有明确提供，尝试从 params 中获取 (兼容旧逻辑或全局参数)
			if !engineFound {
				if v, ok := params["parse_type"]; ok {
					if rawParseType, ok := v.(string); ok {
						parseType = normalizeDocumentParsingEngine(rawParseType)
						logger.Infof(ctx, "DocumentParsingStepHandler: Using engine from params: '%s'", parseType)
					}
				}
			}

			// 兼容旧版本：document_parsing 里空字符串和缺失值都按 markitdown 处理
			if parseType == "" {
				parseType = model.PLATFORM_KEY_MARKITDOWN
				logger.Infof(ctx, "DocumentParsingStepHandler: parse type missing, defaulting to '%s'", parseType)
			}

			// 听悟引擎绕过 docconv，直连听悟 SDK
			if parseType == model.PLATFORM_KEY_TINGWU {
				strategy = document.NewTingwuDocumentStrategy(file.LibraryID)
				logger.Infof(ctx, "DocumentParsingStepHandler: 使用听悟直连策略, fileID=%d", fileID)
			}

			// 读取文件内容 (如果是 docconv 或 tingwu 策略，不需要读取内容，直接传 nil)
			var content []byte
			if strategy.GetStrategyName() != "docconv" && strategy.GetStrategyName() != model.PLATFORM_KEY_TINGWU {
				content, err = storage.StorageInstance.Load(uploadFile.Key)
				if err != nil {
					return fmt.Errorf("加载文件失败: %v", err)
				}
			}

			if strategy.GetStrategyName() == "docconv" || strategy.GetStrategyName() == model.PLATFORM_KEY_TINGWU {
				result, err = strategy.ProcessWithUploadFile(fileID, content, uploadFile.FileName, uploadFile.Size, eid, userID, &uploadFile, parseType)
			} else {
				result, err = strategy.Process(content, uploadFile.FileName, uploadFile.Size, eid, userID)
			}

			if err != nil {
				model.UpdateFileConversionStatus(fileID, model.FileConversionStatusFail)
				return fmt.Errorf("文档转换失败: %v", err)
			}

			if result.DurationMs == 0 && common.IsMediaFile(uploadFile.FileName) {
				mediaPath := uploadFile.GetPreviewOrOssDownloadUrl()
				if d := common.ProbeDurationMs(ctx, mediaPath); d > 0 {
					result.DurationMs = d
				}
			}

			if result.DurationMs > 0 {
				if err := model.DB.Model(&model.File{}).Where("id = ?", fileID).Update("duration_ms", result.DurationMs).Error; err != nil {
					logger.Errorf(ctx, "【媒体时长】保存时长失败: fileID=%d err=%v", fileID, err)
				}
			}

			// 预处理图片链接
			processedContent := result.ProcessedContent
			var imageMetas []image_asset.UploadFileMeta

			// 调用 image_asset.PreprocessImages
			newContent, metas, _, err := image_asset.PreprocessImages(eid, userID, processedContent)
			if err != nil {
				logger.Error(ctx, fmt.Sprintf("预处理图片失败: %v", err))
				// 出错时继续使用原内容
			} else {
				processedContent = newContent
				imageMetas = metas
			}

			// 处理结果保存 (FileBody)
			// 开启事务
			err = db.Transaction(func(tx *gorm.DB) error {
				// 保存 FileBody
				fileBody := &model.FileBody{
					Eid:       eid,
					FileID:    fileID,
					LibraryID: file.LibraryID, // 补充 LibraryID
					Content:   processedContent,
					UserID:    userID,
				}

				if err := fileBody.ProcessContentStorage(); err != nil {
					return fmt.Errorf("处理文件内容存储失败: %v", err)
				}

				if err := tx.Create(fileBody).Error; err != nil {
					return fmt.Errorf("保存文件体失败: %v", err)
				}

				// 更新状态
				if err := model.UpdateFileParsingStatus(fileID, model.FileParsingStatusNormal); err != nil {
					logger.Error(ctx, fmt.Sprintf("更新文件解析状态失败: %v", err))
				}
				// 显式更新文件转换状态为正常
				if err := model.UpdateFileConversionStatus(fileID, model.FileConversionStatusNormal); err != nil {
					logger.Error(ctx, fmt.Sprintf("更新文件转换状态失败: %v", err))
				}

				if err := uploadFile.MarkAsCompleted(); err != nil {
					logger.Error(ctx, fmt.Sprintf("标记上传文件为完成状态失败: %v", err))
				} else {
					tx.Save(&uploadFile)
				}

				// 更新 ConfigID (如果存在)
				if result != nil && result.ConfigId > 0 {
					if err := tx.Model(&file).Where("id = ? AND eid = ?", fileID, eid).Update("config_id", result.ConfigId).Error; err != nil {
						logger.Error(ctx, fmt.Sprintf("更新文件ConfigID失败: %v", err))
					}
				}

				return nil
			})

			if err != nil {
				model.UpdateFileParsingStatus(fileID, model.FileParsingStatusFail)
				uploadFile.MarkAsFailed(fmt.Sprintf("保存文件体失败: %v", err))
				db.Save(&uploadFile)
				return err
			}

			// 异步入队图片下载任务
			if len(imageMetas) > 0 {
				go func() {
					if err := image_asset.EnqueueImageDownloads(eid, userID, imageMetas); err != nil {
						logger.Error(ctx, fmt.Sprintf("enqueue image downloads error: %v", err))
					}
				}()
			}

			// 更新统计信息
			if result.FileSize > 0 {
				fileSize = result.FileSize
			}
			// pageCount 保持 0，因为 DocumentProcessResult 没有 page_count
		}

		// 6. 记录统计信息到 rag_job_steps
		// 查找或创建 RagJobStep
		var jobStep model.RagJobStep
		// 尝试根据 JobID 查找
		err := db.Where("job_id = ?", job.JobID).First(&jobStep).Error
		if err != nil {
			if err == gorm.ErrRecordNotFound {
				// 创建新的
				jobStep = model.RagJobStep{
					JobID:     job.JobID,
					Eid:       eid,
					StepOrder: job.CurrentStepOrder,          // 使用当前步骤顺序
					Status:    model.RagJobStepStatusSuccess, // 即将完成
					StartTime: time.Now().UnixMilli(),
				}
				if err := db.Create(&jobStep).Error; err != nil {
					logger.Error(ctx, fmt.Sprintf("创建 RagJobStep 失败: %v", err))
					// 不阻断流程
				}
			} else {
				logger.Error(ctx, fmt.Sprintf("查询 RagJobStep 失败: %v", err))
			}
		}

		// 更新结果
		stats := map[string]interface{}{
			"document_size": fileSize,
			"page_count":    pageCount,
		}
		if parseType != "" {
			stats["parse_type"] = parseType
		}
		if smartMatchResult != nil {
			stats["smart_match"] = smartMatchResult
		}

		if jobStep.ID > 0 {
			if err := jobStep.CompleteSuccessfully(stats); err != nil {
				logger.Error(ctx, fmt.Sprintf("更新 RagJobStep 结果失败: %v", err))
			}
			db.Save(&jobStep)
		}

		logger.Info(ctx, fmt.Sprintf("DocumentParsingStepHandler: completed successfully, size: %d", fileSize))
		return nil
	}
}

func normalizeDocumentParsingEngine(engine string) string {
	engine = strings.TrimSpace(engine)
	if engine == "" {
		return model.PLATFORM_KEY_MARKITDOWN
	}
	return engine
}
