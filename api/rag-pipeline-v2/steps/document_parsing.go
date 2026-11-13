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
	"github.com/53AI/53AIHub/common/utils/env"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/document"
	"github.com/53AI/53AIHub/service/image_asset"
	"gorm.io/gorm"
)

// GenerateMeetingMinutesFn 由 service 包注册，转写完成后同步触发纪要生成（纪要写入 Summary(0)）。
// 返回 nil 表示成功（或 skipped），返回 error 表示失败（管线应终止）。
// 使用函数变量避免 package 循环依赖。
var GenerateMeetingMinutesFn func(ctx context.Context, eid, fileID, userID int64) error

// GenerateInsightsFn 由 service 包注册，在纪要成功生成后异步触发洞察生成。
// 使用函数变量避免 package 循环依赖。
var GenerateInsightsFn func(ctx context.Context, eid, fileID, userID int64)

func shouldTriggerRecordingInsights(file *model.File) bool {
	// 安心录来源（recording_audio/recording_folder/recording_imported）才生成洞察；
	// 知识库音频（personal_upload 等来源）走音频管线但不出洞察。
	return file != nil && file.IsRecordingOriginType()
}

func triggerRecordingInsightsAfterMinutes(ctx context.Context, db *gorm.DB, file *model.File, eid, fileID, userID int64) {
	if !shouldTriggerRecordingInsights(file) || GenerateInsightsFn == nil {
		return
	}

	var minutesFile model.File
	if err := db.WithContext(ctx).Select("cleaning_rule_info").Where("eid = ? AND id = ?", eid, fileID).First(&minutesFile).Error; err != nil {
		logger.Warnf(ctx, "【洞察】纪要完成后读取状态失败，跳过触发 fileID=%d err=%v", fileID, err)
		return
	}
	var info model.FileCleaningRuleInfo
	if err := json.Unmarshal([]byte(minutesFile.CleaningRuleInfo), &info); err != nil {
		logger.Warnf(ctx, "【洞察】纪要完成后解析状态失败，跳过触发 fileID=%d err=%v", fileID, err)
		return
	}
	if info.MeetingMinutesStatus != "completed" {
		logger.Infof(ctx, "【洞察】纪要状态为 %s，跳过触发 fileID=%d", info.MeetingMinutesStatus, fileID)
		return
	}

	GenerateInsightsFn(pipelineCtx(), eid, fileID, userID)
}

// ReuseTranscriptFn 由 service 包注册：将同内容源文件（同 upload_files.hash 或同 upload_file_id）的
// completed 转写拷贝到目标文件（含转写状态置 completed、parse_type 继承）。
// 返回 (是否已复用, 源文件 parse_type, error)；仅录音文件调用；无复用源或源未 completed 返回 (false, "", nil)。
// 使用函数变量避免 package 循环依赖。
var ReuseTranscriptFn func(ctx context.Context, eid, dstFileID, userID int64, hash string, uploadFileID int64) (bool, string, error)

// ocrParsingSem 重解析引擎（OCR/语音等非 markitdown）并发上限，
// 防止多个重任务同时占满解析 worker 拖垮轻文本秒解析。可通过环境变量调整。
var ocrParsingSem = make(chan struct{}, env.Int("RAG_DOCUMENT_OCR_MAX_CONCURRENT", 5))

// isHeavyParsingEngine 判断解析引擎是否需要限流（非 markitdown 的 OCR/语音等重引擎）。
func isHeavyParsingEngine(parseType string) bool {
	return strings.TrimSpace(parseType) != "" && parseType != model.PLATFORM_KEY_MARKITDOWN
}

// RenderTranscriptMarkdownFn 由 service 包注册：将转写原始 JSON 渲染为带说话人/时间戳的 Markdown。
// 语音转写的新布局 FileBody 存转写 Markdown，Summary(-1) 存原始 JSON，故需在此渲染。
// 使用函数变量避免 package 循环依赖。
var RenderTranscriptMarkdownFn func(raw string, title string) (string, error)

// CorrectTranscriptFn is the optional LLM text correction before the formal transcript is persisted.
// It is registered by service, avoiding a package dependency cycle.
var CorrectTranscriptFn func(ctx context.Context, eid, fileID int64, raw string) (string, error)

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

				}

				// OpenAI 兼容语音渠道绕过 docconv，直连 /v1/audio/transcriptions
				if strings.HasPrefix(parseType, model.PLATFORM_KEY_OPENAI_AUDIO_PREFIX) {
					strategy = document.NewOpenAIAudioDocumentStrategy()
					logger.Infof(ctx, "DocumentParsingStepHandler: 使用 OpenAI 兼容语音转写策略, fileID=%d parseType=%s", fileID, parseType)

				}

				// 录音解析能力（recording_voice）：从平台设置读取语音模型渠道，按渠道类型分派
				// DashScope（type=17）→ voice 策略；OpenAI 兼容（type=1012）→ openai 策略
				if parseType == model.PLATFORM_KEY_RECORDING_VOICE {
					rv, rerr := model.GetPlatformSettingRecordingVoice(eid)
					if rerr != nil {
						// 配置失败必须落库转写错误状态，供前端 parse-status 查询（不静默吞掉）
						model.SetFileTranscriptionError(fileID, "failed", rerr.Error(), model.ErrorTypeModelUnavailable)
						return fmt.Errorf("录音解析配置无效: %w", rerr)
					}
					if rv.IsOpenAI {
						strategy = document.NewOpenAIAudioDocumentStrategy()
					} else {
						strategy = document.NewVoiceModelDocumentStrategy(file.LibraryID)
					}
					logger.Infof(ctx, "DocumentParsingStepHandler: 使用录音解析策略, fileID=%d isOpenAI=%v", fileID, rv.IsOpenAI)

				}

				// 仅语音类解析需要"成功后替换旧数据"（与原三个语音分支行为一致，避免扩大到其它文档类型）
				clearOldVoiceData := strings.HasPrefix(parseType, model.PLATFORM_KEY_VOICE_MODEL_PREFIX) || parseType == "voice_model" ||
					strings.HasPrefix(parseType, model.PLATFORM_KEY_OPENAI_AUDIO_PREFIX) || parseType == model.PLATFORM_KEY_RECORDING_VOICE

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
						legacyCompatibleParseTypeQuery(db.Where("upload_file_id = ? AND eid = ?", uploadFile.ID, eid), parseType).
							Order("id DESC").Find(&candidateFiles)
						for _, cf := range candidateFiles {
							if content, ok := loadCachedTranscriptionContent(db, eid, cf.ID, parseType, file.UserID); ok {
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
								legacyCompatibleParseTypeQuery(db.Where("upload_file_id IN ? AND eid = ?", relatedUploadIDs, eid), parseType).
									Order("id DESC").Find(&crossFiles)
								for _, crossFile := range crossFiles {
									if content, ok := loadCachedTranscriptionContent(db, eid, crossFile.ID, parseType, file.UserID); ok {
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
					// 重引擎（OCR/语音）并发限流：真正外部解析前占信号量，防止多个重任务占满 worker
					if isHeavyParsingEngine(parseType) {
						select {
						case ocrParsingSem <- struct{}{}:
							defer func() { <-ocrParsingSem }()
						case <-ctx.Done():
							return ctx.Err()
						}
					}
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

				// 语音转写：新布局 FileBody=转写 Markdown，Summary(-1)=转写原文（原始 JSON）。
				// 普通文档 FileBody 保持原内容，无 Summary(-1)。
				voiceTranscriptRaw := ""
				voiceTranscriptSource := ""
				fileBodyContent := processedContent
				if isVoiceParseType(parseType) {
					voiceTranscriptSource = processedContent
					voiceTranscriptRaw = processedContent
					if CorrectTranscriptFn != nil {
						if corrected, correctionErr := CorrectTranscriptFn(ctx, eid, fileID, voiceTranscriptRaw); correctionErr == nil && strings.TrimSpace(corrected) != "" {
							voiceTranscriptRaw = corrected
						} else if correctionErr != nil {
							logger.Warnf(ctx, "【转写校正】失败，使用原始ASR转写：fileID=%d err=%v", fileID, correctionErr)
						}
					}
					title := strings.TrimSpace(file.GetAccurateFileName())
					if title == "" {
						title = strings.TrimSpace(uploadFile.FileName)
					}
					if RenderTranscriptMarkdownFn != nil {
						if md, mdErr := RenderTranscriptMarkdownFn(voiceTranscriptRaw, title); mdErr == nil {
							fileBodyContent = md
						} else {
							logger.Warnf(ctx, "DocumentParsingStepHandler: 转写渲染 Markdown 失败，降级存原始 JSON fileID=%d: %v", fileID, mdErr)
						}
					}
				}

				// 检查停止信号及文件是否已被删除，若已删除则放弃回写并中止管线，防止复活已删除文件
				if stopErr := common.CheckRagTaskStop(file.LibraryID, file.ID); stopErr != nil {
					return stopErr
				}
				var latestFile model.File
				if fErr := db.Select("is_deleted").Where("eid = ? AND id = ?", eid, fileID).First(&latestFile).Error; fErr == nil && latestFile.IsDeleted {
					logger.Warnf(ctx, "DocumentParsingStepHandler: 文件已删除，放弃保存解析结果并中止管线 fileID=%d", fileID)
					return fmt.Errorf("文件已被删除，管线中止: fileID=%d", fileID)
				}

				// 处理结果保存 (FileBody)
				// 开启事务
				err = db.Transaction(func(tx *gorm.DB) error {
					// 解析成功后才清理旧数据：解析/ASR 失败时保留原转写，避免重转失败导致数据丢失。
					// 清理与新数据写入放在同一事务，成功后替换，避免新旧数据混用。
					if clearOldVoiceData {
						if err := clearVoiceModelDataIfNeeded(ctx, tx, eid, fileID); err != nil {
							return fmt.Errorf("清理旧 voice_model 数据失败: %w", err)
						}
					}
					// 保存 FileBody
					fileBody := &model.FileBody{
						Eid:       eid,
						FileID:    fileID,
						LibraryID: file.LibraryID, // 补充 LibraryID
						Content:   fileBodyContent,
						UserID:    userID,
					}

					if err := fileBody.ProcessContentStorage(); err != nil {
						return fmt.Errorf("处理文件内容存储失败: %v", err)
					}

					if err := tx.Create(fileBody).Error; err != nil {
						return fmt.Errorf("保存文件体失败: %v", err)
					}

					// 语音转写：转写原文（原始 JSON）写入 Summary(template_id=-1)
					if voiceTranscriptRaw != "" {
						if err := tx.Where("file_id = ? AND template_id = -1", fileID).
							Delete(&model.RecordingFileSummary{}).Error; err != nil {
							return fmt.Errorf("清理旧转写原文失败: %v", err)
						}
						summary := &model.RecordingFileSummary{
							FileID:           fileID,
							TemplateID:       -1,
							TemplateName:     "转写原文",
							InferenceModelID: 0,
							SummaryContent:   model.LongText(voiceTranscriptRaw),
						}
						if err := tx.Create(summary).Error; err != nil {
							return fmt.Errorf("保存转写原文失败: %v", err)
						}
						// Store an immutable source snapshot for the current ASR generation.
						if err := tx.Where("file_id = ? AND template_id = ?", fileID, -3).Delete(&model.RecordingFileSummary{}).Error; err != nil {
							return err
						}
						if err := tx.Create(&model.RecordingFileSummary{FileID: fileID, TemplateID: -3, TemplateName: "ASR原始快照", SummaryContent: model.LongText(voiceTranscriptSource)}).Error; err != nil {
							return err
						}
					}

					// 原子更新文件状态与元数据（在 tx 内统一提交，避免事务内外连接互锁争用）
					fileUpdates := map[string]interface{}{
						"parsing_status":    model.FileParsingStatusNormal,
						"conversion_status": model.FileConversionStatusNormal,
					}
					if parseType != "" {
						fileUpdates["parse_type"] = parseType
					}
					if result != nil && result.ConfigId > 0 {
						fileUpdates["config_id"] = result.ConfigId
					}
					if err := tx.Model(&model.File{}).Where("id = ? AND eid = ?", fileID, eid).Updates(fileUpdates).Error; err != nil {
						return fmt.Errorf("更新文件解析状态失败: %w", err)
					}

					if err := uploadFile.MarkAsCompleted(); err != nil {
						logger.Error(ctx, fmt.Sprintf("标记上传文件为完成状态失败: %v", err))
					} else {
						tx.Save(&uploadFile)
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

				// 转写内容已入库，才记录转写状态（独立于 parsing_status，避免被后续 RAG 管线失败覆盖）。
				// 状态由本步骤统一落库：ASR 策略不再提前写 completed，防止管线中途停止/文件删除时
				// 残留"已转写"标记而 FileBody 并不存在。
				if shouldMarkTranscriptionCompleted(parseType) {
					_ = model.SetFileTranscriptionStatus(fileID, "completed")
				}
			}

			// 语音、预置或复用转写：同步触发纪要生成
			// 纪要失败时终止管线，不继续分块/向量
			if isVoiceParseType(parseType) || transcriptReused {
				if GenerateMeetingMinutesFn != nil {
					if stopErr := common.CheckRagTaskStop(file.LibraryID, file.ID); stopErr != nil {
						return stopErr
					}
					var chkFile model.File
					if fErr := db.Select("is_deleted").Where("eid = ? AND id = ?", eid, fileID).First(&chkFile).Error; fErr == nil && chkFile.IsDeleted {
						logger.Warnf(ctx, "DocumentParsingStepHandler: 文件已删除，中止纪要生成 fileID=%d", fileID)
						return fmt.Errorf("文件已被删除，中止纪要生成: fileID=%d", fileID)
					}
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
					triggerRecordingInsightsAfterMinutes(ctx, db, &file, eid, fileID, userID)
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
		strings.HasPrefix(parseType, model.PLATFORM_KEY_OPENAI_AUDIO_PREFIX) ||
		parseType == model.PLATFORM_KEY_RECORDING_VOICE
}

// shouldMarkTranscriptionCompleted 判断本次解析是否产出了"可读的音频转写内容"，用于入库后写转写状态。
// 听悟（tingwu）同样是音频转写，但它走通用文档管线：不写 Summary(-1)、不触发纪要、不清理旧 voice 数据，
// 因此不能并入 isVoiceParseType（那会改变它的失败语义与纪要门控）；转写状态这一件事上它与语音模型同权。
func shouldMarkTranscriptionCompleted(parseType string) bool {
	return isVoiceParseType(parseType) || parseType == model.PLATFORM_KEY_TINGWU
}

func legacyCompatibleParseTypeQuery(query *gorm.DB, parseType string) *gorm.DB {
	if parseType == model.PLATFORM_KEY_MARKITDOWN {
		return query.Where("parse_type = ? OR parse_type = ''", parseType)
	}
	return query.Where("parse_type = ?", parseType)
}

// isTranscriptJSONContent 判断内容是否为"转写原始 JSON"（秒解析缓存校验用）：
//   - DashScope 对象：{"file_url":...,"transcripts":[...]}（含 "transcripts" 键）
//   - SonicNote 数组：[{"speaker":...}]（以 [ 开头且可解析为 JSON 数组）
//
// 纪要 JSON（{"minutes_version":...}）与转写 Markdown（[00:00:00] A说话人: ...）均不命中，
// 避免把纪要/转写 MD 误当转写原文复用。
// 与 service 层 classifyRecordingContent 的转写 JSON 语义保持一致（本包无法引用 service，内联实现）。
func isTranscriptJSONContent(content string) bool {
	trimmed := strings.TrimSpace(content)
	if trimmed == "" {
		return false
	}
	if strings.HasPrefix(trimmed, "{") {
		return strings.Contains(trimmed, `"transcripts"`)
	}
	if strings.HasPrefix(trimmed, "[") {
		var arr []map[string]interface{}
		// 空数组 "[]" 表示无转写内容，不命中缓存
		if err := json.Unmarshal([]byte(trimmed), &arr); err == nil && len(arr) > 0 {
			return true
		}
	}
	return false
}

// loadCachedTranscriptionContent returns ASR evidence for a fresh correction pass.
// Summary(-1) is the formal transcript and must never be re-used as "raw" once corrected.
// Legacy sources without a raw snapshot may be reused if no correction marker exists.
func loadCachedTranscriptionContent(db *gorm.DB, eid, fileID int64, parseType string, targetOwnerID int64) (string, bool) {
	isVoice := isVoiceParseType(parseType)
	if isVoice {
		var source model.File
		if err := db.Select("user_id").Where("id = ? AND eid = ?", fileID, eid).First(&source).Error; err != nil {
			return "", false
		}
		crossUser := source.UserID != targetOwnerID
		var summary model.RecordingFileSummary
		for _, templateID := range []int64{-3, -1} {
			if err := db.Where("file_id = ? AND template_id = ?", fileID, templateID).First(&summary).Error; err != nil {
				continue
			}
			content := string(summary.SummaryContent)
			if !isTranscriptJSONContent(content) {
				continue
			}
			if templateID == -1 && strings.Contains(content, `"_transcript_correction_version"`) {
				// Without the original, fall back to a fresh ASR call rather than re-correct.
				continue
			}
			if crossUser && strings.Contains(content, `"contact"`) {
				// Legacy speaker bindings belong to another user. Re-ASR instead of leaking.
				continue
			}
			return content, true
		}
	} else {
		var summary model.RecordingFileSummary
		if err := db.Where("file_id = ? AND template_id = -1", fileID).First(&summary).Error; err == nil && summary.SummaryContent != "" {
			return string(summary.SummaryContent), true
		}
	}

	// Legacy layout: source JSON sometimes lived in FileBody.
	var body model.FileBody
	if err := db.Where("file_id = ? AND eid = ?", fileID, eid).Order("id DESC").First(&body).Error; err == nil {
		if err := body.LoadContent(); err == nil && body.Content != "" {
			if !isVoice {
				return body.Content, true
			}
			var source model.File
			if err := db.Select("user_id").Where("id = ? AND eid = ?", fileID, eid).First(&source).Error; err != nil {
				return "", false
			}
			if isTranscriptJSONContent(body.Content) &&
				!strings.Contains(body.Content, `"_transcript_correction_version"`) &&
				(source.UserID == targetOwnerID || !strings.Contains(body.Content, `"contact"`)) {
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
				// 重新转写后旧的人员绑定关系随之作废：清空参会人员快照并重置回填标记
				info.Speakers = nil
				info.SpeakersHealed = false
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
