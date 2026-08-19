package steps

import (
	"context"
	"encoding/json"
	"errors"
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

// GenerateMeetingMinutesFn 由 service 包注册，转写完成后同步触发纪要生成并执行存储反转。
// 返回 nil 表示成功（或 skipped），返回 error 表示失败（管线应终止）。
// 使用函数变量避免 package 循环依赖。
var GenerateMeetingMinutesFn func(ctx context.Context, eid, fileID, userID int64) error

// ReuseTranscriptFn 由 service 包注册：将同内容源文件（同 upload_files.hash 或同 upload_file_id）的
// completed 转写拷贝到目标文件（含转写状态置 completed、parse_type 继承）。
// 返回 (是否已复用, 源文件 parse_type, error)；仅录音文件调用；无复用源或源未 completed 返回 (false, "", nil)。
// 使用函数变量避免 package 循环依赖。
var ReuseTranscriptFn func(ctx context.Context, eid, dstFileID, userID int64, hash string, uploadFileID int64) (bool, string, error)

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
		// 单步重跑任务可能没有携带 user_id。纪要及其安心录记忆必须归属到
		// 文件创建者，不能以 0 作为 owner_id 写入后被权限查询过滤掉。
		if userID <= 0 && file.UserID > 0 {
			logger.Warnf(ctx, "DocumentParsingStepHandler: job user_id 无效，使用文件创建者 fileID=%d job_user_id=%d file_user_id=%d", fileID, userID, file.UserID)
			userID = file.UserID
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
			// 提前解析 force_reparse：强制重转写时必须跳过转写复用（对齐秒解析缓存行为），
			// 否则重转写请求会被同内容源短路而静默失效。stepConfig 优先，params 兜底。
			forceReparse := false
			if v, ok := params["force_reparse"]; ok {
				if b, ok := v.(bool); ok {
					forceReparse = b
				} else {
					logger.Warnf(ctx, "force_reparse 参数类型错误，期望 bool，实际 %T，默认 false", v)
				}
			}
			if stepConfig != nil {
				var cfg struct {
					ForceReparse bool `json:"force_reparse"`
				}
				if err := json.Unmarshal(stepConfig, &cfg); err == nil && cfg.ForceReparse {
					forceReparse = true
				}
			}

			// 转写复用（仅录音文件）：同内容源文件（同 upload_files.hash 或同 upload_file_id）已有
			// completed 转写 → 拷贝到目标 FileBody 并跳过 ASR。复用成功后 parseType 继承源 voice 引擎值，
			// 保证下方纪要生成门控（voice:*）通过。普通文档（非录音来源）不参与。
			// 与 force_reparse 互斥：强制重转写时跳过复用，走正常 ASR。
			transcriptReused := false
			reuseParseType := ""
			if !forceReparse && file.IsRecordingOriginType() && ReuseTranscriptFn != nil {
				var rerr error
				transcriptReused, reuseParseType, rerr = ReuseTranscriptFn(ctx, eid, fileID, userID, uploadFile.Hash, uploadFile.ID)
				if rerr != nil {
					logger.Warnf(ctx, "DocumentParsingStepHandler: 转写复用检查失败，降级正常转换 fileID=%d: %v", fileID, rerr)
					transcriptReused = false
				} else if transcriptReused {
					logger.Infof(ctx, "DocumentParsingStepHandler: 转写复用完成，跳过 ASR fileID=%d", fileID)
				}
			}

			var result *document.DocumentProcessResult
			var err error

			if transcriptReused {
				// 转写已具备（同内容复用）：跳过 ASR 转换与 FileBody 保存。
				// 短路必须在引擎解析之前：profile step config 的 engine 是 voice:...，
				// 会触发 clearVoiceModelDataIfNeeded 误删已复用写入的 FileBody。
				parseType = reuseParseType // 继承源 voice 引擎值，保证纪要门控通过
				logger.Infof(ctx, "DocumentParsingStepHandler: 转写已具备，跳过 ASR fileID=%d parseType=%s", fileID, parseType)
				model.UpdateFileParsingStatus(fileID, model.FileParsingStatusNormal)
				model.UpdateFileConversionStatus(fileID, model.FileConversionStatusNormal)
				_ = model.SetFileTranscriptionStatus(fileID, "completed")
				// 对齐正常路径：上传文件标记完成（否则 upload_file.status 永久停留 none，接口可见）
				if err := uploadFile.MarkAsCompleted(); err != nil {
					logger.Warnf(ctx, "DocumentParsingStepHandler: 标记上传文件完成失败 fileID=%d: %v", fileID, err)
				} else {
					db.Save(&uploadFile)
				}
			} else {
				// 执行转换逻辑 (复用 DocumentConversionStep 逻辑)
				// 更新状态
				model.UpdateFileConversionStatus(fileID, model.FileConversionStatusConverting)

				converterService := document.NewConverterService()
				strategyFactory := document.NewDocumentStrategyFactory(converterService, storage.StorageInstance)
				strategy := strategyFactory.GetStrategy(uploadFile.FileName, file.LibraryID)

				// 获取 parse_type
				// V2 优先从 stepConfig 获取 (支持单步重试时修改配置)
				if stepConfig != nil {
					var cfg struct {
						Engine                *string `json:"engine"`
						EnableSmartMatch      bool    `json:"enable_smart_match"`
						MatchPreferencePrompt string  `json:"match_preference_prompt"`
						ForceReparse          bool    `json:"force_reparse"`
					}
					if err := json.Unmarshal(stepConfig, &cfg); err == nil && cfg.Engine != nil {
						parseType = normalizeDocumentParsingEngine(*cfg.Engine)
						engineFound = true
						logger.Infof(ctx, "DocumentParsingStepHandler: Using engine from stepConfig: '%s'", parseType)
					}

					if cfg.ForceReparse {
						params["force_reparse"] = true
						logger.Infof(ctx, "DocumentParsingStepHandler: force_reparse from stepConfig")
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

				// 存量兼容：sonicnote_transcript 是旧版预置设备转写的来源标记，非本地 ASR 引擎，
				// 忽略不当作引擎使用（防校验失败/外部注入被当作引擎）。
				if parseType == model.PLATFORM_KEY_SONICNOTE {
					logger.Warnf(ctx, "DocumentParsingStepHandler: 忽略 sonicnote_transcript parse_type，按默认引擎处理 fileID=%d", fileID)
					parseType = ""
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

				// 语音模型渠道绕过 docconv，直连百炼 API
				if strings.HasPrefix(parseType, model.PLATFORM_KEY_VOICE_MODEL_PREFIX) || parseType == "voice_model" {
					strategy = document.NewVoiceModelDocumentStrategy(file.LibraryID)
					logger.Infof(ctx, "DocumentParsingStepHandler: 使用语音模型策略, fileID=%d parseType=%s", fileID, parseType)

					if err := clearVoiceModelDataIfNeeded(ctx, db, eid, fileID); err != nil {
						return fmt.Errorf("清理旧 voice_model 数据失败: %w", err)
					}
				}

				// OpenAI 兼容语音渠道绕过 docconv，直连 /v1/audio/transcriptions
				if strings.HasPrefix(parseType, model.PLATFORM_KEY_OPENAI_AUDIO_PREFIX) {
					strategy = document.NewOpenAIAudioDocumentStrategy()
					logger.Infof(ctx, "DocumentParsingStepHandler: 使用 OpenAI 兼容语音转写策略, fileID=%d parseType=%s", fileID, parseType)

					if err := clearVoiceModelDataIfNeeded(ctx, db, eid, fileID); err != nil {
						return fmt.Errorf("清理旧 voice_model 数据失败: %w", err)
					}
				}

				// 秒解析缓存检查：同企业相同 hash 文件的已有解析结果复用
				var cachedBody *model.FileBody
				if hasUploadFile && uploadFile.Hash != "" && parseType != "" {
					forceReparse := false
					if v, ok := params["force_reparse"]; ok {
						if b, ok := v.(bool); ok {
							forceReparse = b
						} else {
							logger.Warnf(ctx, "force_reparse 参数类型错误，期望 bool，实际 %T，值: %v，默认按 false 处理", v, v)
						}
					}
					if !forceReparse {
						var candidateFiles []model.File
						db.Where("upload_file_id = ? AND eid = ? AND parse_type = ?", uploadFile.ID, eid, parseType).
							Order("id DESC").Find(&candidateFiles)
						for _, cf := range candidateFiles {
							if content, ok := loadCachedTranscriptionContent(db, eid, cf.ID, parseType); ok {
								cachedBody = &model.FileBody{Content: content}
								logger.Infof(ctx, "秒解析命中：upload_file_id=%d, parse_type=%s, file_id=%d", uploadFile.ID, parseType, cf.ID)
								break
							}
						}
						if cachedBody == nil {
							var relatedUploadIDs []int64
							db.Model(&model.UploadFile{}).Where("eid = ? AND hash = ? AND id != ?", eid, uploadFile.Hash, uploadFile.ID).
								Pluck("id", &relatedUploadIDs)
							if len(relatedUploadIDs) > 0 {
								var crossFiles []model.File
								db.Where("upload_file_id IN ? AND eid = ? AND parse_type = ?", relatedUploadIDs, eid, parseType).
									Order("id DESC").Find(&crossFiles)
								for _, crossFile := range crossFiles {
									if content, ok := loadCachedTranscriptionContent(db, eid, crossFile.ID, parseType); ok {
										cachedBody = &model.FileBody{Content: content}
										logger.Infof(ctx, "秒解析跨用户命中：current_upload_file_id=%d matched_upload_file_id=%d parse_type=%s file_id=%d",
											uploadFile.ID, crossFile.UploadFileID, parseType, crossFile.ID)
										break
									}
								}
							}
						}
						if cachedBody == nil {
							logger.Infof(ctx, "秒解析未命中，进入外部解析：upload_file_id=%d, parse_type=%s", uploadFile.ID, parseType)
						}
					} else {
						logger.Infof(ctx, "force_reparse=true，跳过缓存：upload_file_id=%d, parse_type=%s", uploadFile.ID, parseType)
					}
				}

				if cachedBody == nil {
					var content []byte
					if strategy.GetStrategyName() != "docconv" && strategy.GetStrategyName() != model.PLATFORM_KEY_TINGWU && strategy.GetStrategyName() != "voice_model" && strategy.GetStrategyName() != "openai_audio" {
						content, err = storage.StorageInstance.Load(uploadFile.Key)
						if err != nil {
							return fmt.Errorf("加载文件失败: %v", err)
						}
					}

					if strategy.GetStrategyName() == "docconv" || strategy.GetStrategyName() == model.PLATFORM_KEY_TINGWU || strategy.GetStrategyName() == "voice_model" || strategy.GetStrategyName() == "openai_audio" {
						result, err = strategy.ProcessWithUploadFile(fileID, content, uploadFile.FileName, uploadFile.Size, eid, userID, &uploadFile, parseType)
					} else {
						result, err = strategy.Process(content, uploadFile.FileName, uploadFile.Size, eid, userID)
					}

					if err != nil {
						model.UpdateFileConversionStatus(fileID, model.FileConversionStatusFail)
						// 语音模型转写失败时，记录错误状态
						if isVoiceParseType(parseType) {
							errorType := model.ErrorTypeModelUnavailable
							var llmErr *model.LLMError
							if errors.As(err, &llmErr) {
								errorType = llmErr.ErrorType
							}
							model.SetFileTranscriptionError(fileID, "failed", err.Error(), errorType)
						}
						return fmt.Errorf("文档转换失败: %w", err)
					}

					if result.DurationMs == 0 && common.IsMediaFile(uploadFile.FileName) {
						// 先查 DB 是否已有时长，避免重复探测
						var existingDuration int64
						model.DB.Model(&model.File{}).Select("duration_ms").Where("id = ?", fileID).Scan(&existingDuration)
						if existingDuration > 0 {
							result.DurationMs = existingDuration
						} else {
							mediaPath := uploadFile.GetPreviewOrOssDownloadUrl()
							if d := common.ProbeDurationMs(ctx, mediaPath); d > 0 {
								result.DurationMs = d
							}
						}
					}

					if result.DurationMs > 0 {
						if err := model.DB.Model(&model.File{}).Where("id = ?", fileID).Update("duration_ms", result.DurationMs).Error; err != nil {
							logger.Errorf(ctx, "【媒体时长】保存时长失败: fileID=%d err=%v", fileID, err)
						}
					}
				}

				// 预处理图片链接
				var processedContent string
				if cachedBody != nil {
					processedContent = cachedBody.Content
				} else {
					processedContent = result.ProcessedContent
				}
				var imageMetas []image_asset.UploadFileMeta

				// 缓存命中时跳过图片预处理（已在上次解析时处理过）；JSON 内容也跳过（如语音模型原始响应）
				if cachedBody == nil && result.FileType != "json" {
					newContent, metas, _, err := image_asset.PreprocessImages(eid, userID, processedContent)
					if err != nil {
						logger.Error(ctx, fmt.Sprintf("预处理图片失败: %v", err))
					} else {
						processedContent = newContent
						imageMetas = metas
					}
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

					// 回写 parse_type，确保秒解析缓存可命中
					if parseType != "" {
						if err := tx.Model(&file).Where("id = ? AND eid = ?", fileID, eid).Update("parse_type", parseType).Error; err != nil {
							logger.Error(ctx, fmt.Sprintf("更新文件parse_type失败: %v", err))
						}
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

				// 语音模型转写完成后，记录转写状态（独立于 parsing_status，避免被后续 RAG 管线失败覆盖）
				if isVoiceParseType(parseType) {
					_ = model.SetFileTranscriptionStatus(fileID, "completed")
				}
			}

			// 语音、预置或复用转写：同步触发纪要生成
			// 纪要失败时终止管线，不继续分块/向量
			if isVoiceParseType(parseType) || transcriptReused {
				if GenerateMeetingMinutesFn != nil {
					minutesCtx, minutesCancel := context.WithTimeout(pipelineCtx(), 15*time.Minute)
					if err := GenerateMeetingMinutesFn(minutesCtx, eid, fileID, userID); err != nil {
						minutesCancel()
						// 提取 LLM 错误类型，默认 model_unavailable
						errorType := model.ErrorTypeModelUnavailable
						var llmErr *model.LLMError
						if errors.As(err, &llmErr) {
							errorType = llmErr.ErrorType
						}
						// 记录纪要失败状态、错误信息和错误类型，供前端 parse-status 展示
						model.SetMeetingMinutesStatus(fileID, "failed", err.Error(), errorType)
						return fmt.Errorf("纪要生成失败，终止管线: %w", err)
					}
					minutesCancel()
				}
			}

			// 更新统计信息
			if result != nil && result.FileSize > 0 {
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

// isVoiceParseType 判断 parseType 是否为语音转写类型（voice: / voice_model / openai:）。
// 门控统一入口：策略分派、错误映射、转写状态、纪要触发、缓存校验共用一个判定，
// 避免新增语音供应商时遗漏散落的硬编码分支。
func isVoiceParseType(parseType string) bool {
	return strings.HasPrefix(parseType, model.PLATFORM_KEY_VOICE_MODEL_PREFIX) ||
		parseType == "voice_model" ||
		strings.HasPrefix(parseType, model.PLATFORM_KEY_OPENAI_AUDIO_PREFIX)
}

// loadCachedTranscriptionContent 读取文件的原始转写内容，考虑存储反转。
//
// 语音文件经过 GenerateMeetingMinutes 存储反转后：
//   - 原始转写 JSON 在 Summary(template_id=-1)
//   - 纪要 JSON 在 FileBody
//
// 秒解析缓存必须读原始转写，而非纪要，否则后续文件的"转写原文"会被污染。
// 优先读 Summary(-1)，不存在时回退读 FileBody（未反转的文件）。
// 对 voice_model/voice:* 类型校验内容必须含 "transcripts" 字段，跳过被污染的纪要 JSON。
func loadCachedTranscriptionContent(db *gorm.DB, eid, fileID int64, parseType string) (string, bool) {
	isVoice := isVoiceParseType(parseType)

	// 优先读 Summary(-1)（存储反转后的原始转写位置）
	var summary model.RecordingFileSummary
	if err := db.Where("file_id = ? AND template_id = -1", fileID).First(&summary).Error; err == nil {
		content := string(summary.SummaryContent)
		if content != "" && (!isVoice || strings.Contains(content, `"transcripts"`)) {
			return content, true
		}
	}

	// 未反转，读 FileBody
	var body model.FileBody
	if err := db.Where("file_id = ? AND eid = ?", fileID, eid).Order("id DESC").First(&body).Error; err == nil {
		if err := body.LoadContent(); err == nil && body.Content != "" {
			if !isVoice || strings.Contains(body.Content, `"transcripts"`) {
				return body.Content, true
			}
		}
	}
	return "", false
}

func clearVoiceModelDataIfNeeded(ctx context.Context, db *gorm.DB, eid, fileID int64) error {
	if err := db.Where("file_id = ? AND template_id IN ?", fileID, []int64{-1, -2, 0}).
		Delete(&model.RecordingFileSummary{}).Error; err != nil {
		return fmt.Errorf("清理旧 Summary 失败: %w", err)
	}

	if err := db.Where("file_id = ?", fileID).
		Delete(&model.FileBody{}).Error; err != nil {
		return fmt.Errorf("清理旧 FileBody 失败: %w", err)
	}

	if err := db.Model(&model.File{}).Where("id = ?", fileID).
		Update("insight_summary", "").Error; err != nil {
		return fmt.Errorf("清理旧洞察失败: %w", err)
	}

	if err := db.Where("file_id = ?", fileID).
		Delete(&model.RecordingFileInsightPage{}).Error; err != nil {
		return fmt.Errorf("清理旧洞察页面失败: %w", err)
	}

	if err := model.DeleteDocumentChunksByFileID(eid, fileID); err != nil {
		return fmt.Errorf("清理旧分块失败: %w", err)
	}

	if err := model.DeleteRetrievalChunksByFileID(eid, fileID); err != nil {
		return fmt.Errorf("清理旧检索分块失败: %w", err)
	}

	var file model.File
	if err := db.Where("id = ?", fileID).First(&file).Error; err == nil {
		if file.CleaningRuleInfo != "" {
			var info model.FileCleaningRuleInfo
			if json.Unmarshal([]byte(file.CleaningRuleInfo), &info) == nil {
				info.MeetingMinutesStatus = ""
				info.InsightsStatus = ""
				info.InsightPageStatus = ""
				if data, err := json.Marshal(info); err == nil {
					db.Model(&model.File{}).Where("id = ?", fileID).
						Update("cleaning_rule_info", string(data))
				}
			}
		}
	}

	logger.Infof(ctx, "clearVoiceModelDataIfNeeded: cleaned old data for fileID=%d", fileID)
	return nil
}
