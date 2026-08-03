package steps

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/rag"
	env_util "github.com/53AI/53AIHub/common/utils/env"
	"gorm.io/gorm"
)

// GenerateInsightsFn 由 service 包注册，实体抽取完成后同步触发洞察生成。
// 使用函数变量避免 package 循环依赖。
var GenerateInsightsFn func(ctx context.Context, eid, fileID, userID int64)

// BuildMinutesMarkdownFn 由 service 包注册，将纪要 JSON 渲染为 Markdown。
// 用于文件摘要/实体抽取前对语音文件内容做转换，提升 LLM 理解质量。
var BuildMinutesMarkdownFn func(raw string) string

// PipelineCtxFn 由 service 包注册，返回录音管线生命周期 context（recordingPipelineCtx）。
// 用于异步 goroutine 派生可被服务停止优雅取消的子 context。
// 返回 nil 时调用方需 fallback 到 context.Background()。
var PipelineCtxFn func() context.Context

func pipelineCtx() context.Context {
	if PipelineCtxFn != nil {
		if c := PipelineCtxFn(); c != nil {
			return c
		}
	}
	return context.Background()
}

// NewDocumentChunkingHandler 创建 document_chunking 步骤处理函数
func NewDocumentChunkingHandler(db *gorm.DB) func(ctx context.Context, job *model.RagJob, config json.RawMessage) error {
	return func(ctx context.Context, job *model.RagJob, stepConfig json.RawMessage) error {
		if isWikiPageGenerationActive(job) {
			logger.Infof(ctx, "wiki_page_generation 已启用，跳过 document_chunking 的分块处理")
			return nil
		}

		// 1. 解析任务参数
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
		userID := int64(0)
		if v, ok := params["user_id"]; ok {
			userID = int64(v.(float64))
		}

		logger.Info(ctx, fmt.Sprintf("DocumentChunkingStepHandler: processing job %d for file %d", job.JobID, fileID))

		updateParsingStatus := func(status string) {
			if err := model.UpdateFileParsingStatus(fileID, status); err != nil {
				logger.Error(ctx, fmt.Sprintf("更新文件解析状态失败: %v", err))
			}
		}

		// 2. 获取文件信息
		var file model.File
		if err := db.Where("eid = ? AND id = ?", eid, fileID).First(&file).Error; err != nil {
			updateParsingStatus(model.FileParsingStatusFail)
			return fmt.Errorf("获取文件信息失败: %v", err)
		}

		// 3. 检查停止信号
		if err := common.CheckRagTaskStop(file.LibraryID, file.ID); err != nil {
			updateParsingStatus(model.FileParsingStatusFail)
			return err
		}

		// 4. 清理现有的 Chunk (CleanupDbChunks 逻辑)
		if err := cleanupExistingChunks(db, eid, fileID); err != nil {
			updateParsingStatus(model.FileParsingStatusFail)
			return fmt.Errorf("清理现有分块失败: %v", err)
		}

		configSvc := rag.NewChunkConfigService(db)
		trimmed := bytes.TrimSpace(stepConfig)
		var v2Config *V2DocumentChunkingConfig
		if len(trimmed) > 0 && string(trimmed) != "null" {
			parsed, err := parseV2ChunkingConfig(stepConfig)
			if err != nil {
				logger.Warn(ctx, fmt.Sprintf("解析 V2 分块配置失败，将使用默认配置: %v", err))
			} else {
				v2Config = parsed
			}
		}
		chunkConfig, cfgErr := configSvc.GetConfigWithFileID(eid, &file.LibraryID, &fileID)
		if cfgErr != nil {
			logger.Warn(ctx, fmt.Sprintf("获取分块配置失败，将使用步骤配置: %v", cfgErr))
		}

		if chunkConfig == nil {
			chunkConfig = convertToRagChunkConfig(v2Config)
		}

		if v2Config != nil && hasChunkingOverrides(v2Config) {
			overrideCfg := convertToRagChunkConfig(v2Config)
			mergeChunkingConfig(chunkConfig, overrideCfg)
		}
		chunkConfig.Eid = eid
		chunkConfig.LibraryID = &file.LibraryID
		desiredType := strings.TrimSpace(chunkConfig.Type)
		if desiredType == "" {
			desiredType = model.ChunkTypeDefault
			chunkConfig.Type = desiredType
		}

		// 7. 获取文件内容
		fileBody, err := model.GetLastFileBodyByFileID(eid, fileID)
		if err != nil {
			updateParsingStatus(model.FileParsingStatusFail)
			return fmt.Errorf("获取文件内容失败: %v", err)
		}
		content, err := fileBody.GetContent()
		if err != nil {
			updateParsingStatus(model.FileParsingStatusFail)
			return fmt.Errorf("读取文件内容失败: %v", err)
		}

		// 对语音文件：将会议纪要 JSON 转为 Markdown，提升 LLM 理解质量
		// 只在文件摘要/实体抽取时使用，不影响分块等其他流程
		contentForLLM := content
		if file.IsRecordingOriginType() && BuildMinutesMarkdownFn != nil {
			contentForLLM = BuildMinutesMarkdownFn(content)
			logger.Infof(ctx, "【诊断-内容转换】纪要 JSON→Markdown 完成: file_id=%d, 原始长度=%d, 转换后长度=%d, 是否发生变化=%v",
				fileID, len(content), len(contentForLLM), content != contentForLLM)
		} else {
			logger.Infof(ctx, "【诊断-内容转换】跳过 Markdown 转换: file_id=%d, origin_type=%s, fn_registered=%v",
				fileID, file.OriginType, BuildMinutesMarkdownFn != nil)
		}

		var smartMatchResult *SmartMatchResult
		if v2Config != nil && v2Config.EnableSmartMatch {
			fileName := ""
			if err := file.LoadUploadFile(); err == nil && file.UploadFile != nil {
				fileName = file.UploadFile.FileName
			}
			if result, err := selectDocumentChunkingSmartMatch(ctx, db, eid, fileName, content, v2Config); err != nil {
				logger.Warn(ctx, fmt.Sprintf("DocumentChunking smart match failed, fallback to existing chunk config: %v", err))
			} else {
				smartMatchResult = result
				if result.SelectedConfig != nil {
					selectedCfg := convertToRagChunkConfig(result.SelectedConfig)
					if selectedCfg != nil {
						mergeChunkingConfig(chunkConfig, selectedCfg)
						if selectedCfg.Type != "" {
							desiredType = selectedCfg.Type
							chunkConfig.Type = selectedCfg.Type
						}
					}
				}
				logger.Infof(ctx, "【智能匹配】语料拆分选择完成: selected_key=%s, fallback=%t, confidence=%.2f, reason=%s, selected_config=%s",
					result.SelectedKey, result.FallbackUsed, result.Confidence, result.Reason, formatDocumentChunkingSmartMatchConfigForLog(result.SelectedConfig))
			}
		}
		if desiredType == model.ChunkTypeQA || desiredType == model.ChunkTypeDataTable {
			typeConfig, err := configSvc.GetConfigByType(0, desiredType)
			if err != nil {
				logger.Warn(ctx, fmt.Sprintf("获取类型分块配置失败，将继续使用当前配置: %v", err))
			} else {
				mergeChunkingConfig(chunkConfig, typeConfig)
				chunkConfig.Type = desiredType
			}
		}
		logger.Info(ctx, fmt.Sprintf("DocumentChunking 配置: desired_type=%s, effective_type=%s, knowledge_max_length=%d, index_max_length=%d",
			desiredType, chunkConfig.Type, chunkConfig.KnowledgeMaxLength, chunkConfig.IndexMaxLength))

		// 8. 执行分块 (DocumentChunking 逻辑)
		var chunkResult *rag.ChunkResult
		var savedChunks []model.DocumentChunk
		err = db.Transaction(func(tx *gorm.DB) error {
			// 创建临时的chunker服务使用事务
			chunkerService := rag.NewChunkerService(tx)

			// 执行文档分块 (使用 ChunkDocumentWithConfig)
			chunkResult, err = chunkerService.ChunkDocumentWithConfig(eid, fileID, content, chunkConfig)
			if err != nil {
				return fmt.Errorf("文档分块失败: %v", err)
			}

			logger.Info(ctx, fmt.Sprintf("DocumentChunking 分块结果: chunks=%d, tokens=%d, avg_size=%.2f, ms=%d",
				len(chunkResult.Chunks), chunkResult.Metadata.TotalTokens, chunkResult.Metadata.AvgChunkSize, chunkResult.Metadata.ProcessingTime))
			if len(chunkResult.Warnings) > 0 {
				logger.Warn(ctx, fmt.Sprintf("DocumentChunking 分块警告: %s", strings.Join(chunkResult.Warnings, "; ")))
			}
			if len(chunkResult.Errors) > 0 {
				logger.Warn(ctx, fmt.Sprintf("DocumentChunking 分块错误列表: %s", strings.Join(chunkResult.Errors, "; ")))
			}

			if len(chunkResult.Chunks) == 0 {
				return fmt.Errorf("分块结果为空: effective_type=%s", chunkConfig.Type)
			}

			// 保存分块
			savedChunks, err = chunkerService.SaveChunksInTransaction(tx, eid, fileID, chunkResult.Chunks)
			if err != nil {
				return fmt.Errorf("保存分块失败: %v", err)
			}

			// 生成并保存检索块 (Retrieval Chunks)
			retrievalService := rag.NewRetrievalChunkService(tx)

			for _, savedChunk := range savedChunks {
				// CreateRetrievalChunksForKnowledge 内部已经执行了保存操作
				_, err := retrievalService.CreateRetrievalChunksForKnowledge(eid, &savedChunk, chunkConfig)
				if err != nil {
					return fmt.Errorf("生成检索块失败 (chunk %d): %v", savedChunk.ID, err)
				}
			}

			return nil
		})

		if err != nil {
			updateParsingStatus(model.FileParsingStatusFail)
			return fmt.Errorf("文档分块事务失败: %v", err)
		}

		chunkIDs := make([]int64, 0, len(savedChunks))
		for _, c := range savedChunks {
			chunkIDs = append(chunkIDs, c.ID)
		}
		if _, err := rag.EnqueueChunkEnrichment(ctx, rag.ChunkEnrichmentTask{
			Eid:         eid,
			FileID:      fileID,
			ChunkIDs:    chunkIDs,
			ChunkConfig: chunkConfig,
		}); err != nil {
			logger.Warnf(ctx, "【分块增益】推入队列失败(非致命): eid=%d, file_id=%d, err=%v", eid, fileID, err)
		}

		// 9. 统计结果并更新状态
		// 统计知识点分块数量
		var count int64
		if err := db.Model(&model.DocumentChunk{}).
			Where("eid = ? AND file_id = ? AND chunk_type = 'knowledge'", eid, fileID).
			Count(&count).Error; err != nil {
			logger.Warn(ctx, fmt.Sprintf("统计知识点分块数量失败: %v", err))
			count = 0
		}

		// 计算平均字符数
		var totalChars int64 = 0
		// 注意：直接查询所有 Content 可能较慢，如果是统计信息，可以在保存时累加
		// 这里为了准确性，查询 Content 长度的和
		if err := db.Model(&model.DocumentChunk{}).
			Where("eid = ? AND file_id = ? AND chunk_type = 'knowledge'", eid, fileID).
			Select("COALESCE(SUM(CHAR_LENGTH(content)), 0)").
			Scan(&totalChars).Error; err != nil {
			logger.Warn(ctx, fmt.Sprintf("计算总字符数失败: %v", err))
		}

		avgChars := 0.0
		if count > 0 {
			avgChars = float64(totalChars) / float64(count)
		}

		var jobStep model.RagJobStep
		if err := db.Where("job_id = ?", job.JobID).First(&jobStep).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				jobStep = model.RagJobStep{
					JobID:     job.JobID,
					Eid:       eid,
					StepOrder: job.CurrentStepOrder,
					Status:    model.RagJobStepStatusProcessing,
					StartTime: time.Now().UnixMilli(),
				}
				if err := db.Create(&jobStep).Error; err != nil {
					logger.Error(ctx, fmt.Sprintf("创建 RagJobStep 失败: %v", err))
				}
			} else {
				logger.Error(ctx, fmt.Sprintf("查询 RagJobStep 失败: %v", err))
			}
		}

		stepResults := map[string]interface{}{
			"chunk_type":   chunkConfig.Type,
			"chunk_count":  count,
			"average_size": avgChars,
		}
		if smartMatchResult != nil {
			stepResults["smart_match"] = smartMatchResult
		}
		if jobStep.ID > 0 {
			if err := jobStep.CompleteSuccessfully(stepResults); err != nil {
				logger.Error(ctx, fmt.Sprintf("更新 RagJobStep 结果失败: %v", err))
			}
			db.Save(&jobStep)
		}

		// 异步执行文件摘要和实体抽取（不阻塞后续向量化步骤，错误仅记录日志）
		// 生成文件级摘要和常见问法（通过环境变量 RAG_GENERATE_SUMMARY 控制，默认开启）
		if env_util.Bool("RAG_GENERATE_SUMMARY", true) {
			go func() {
				summaryCtx, summaryCancel := context.WithTimeout(pipelineCtx(), 10*time.Minute)
				defer summaryCancel()
				if _, _, err := maybeGenerateFileSummaryAndFAQ(summaryCtx, db, job, eid, fileID, contentForLLM, chunkConfig); err != nil {
					logger.Error(summaryCtx, fmt.Sprintf("生成文件摘要和问法失败(非致命): file_id=%d, err=%v", fileID, err))
					updateParsingStatus(model.FileParsingStatusFail)
				}
			}()
		}
		// 实体抽取/文档标签（通过环境变量 RAG_EXTRACT_ENTITIES 控制，默认开启）
		if env_util.Bool("RAG_EXTRACT_ENTITIES", true) && !isWikiPageGenerationActive(job) {
			go func() {
				entityCtx, entityCancel := context.WithTimeout(pipelineCtx(), 10*time.Minute)
				defer entityCancel()
				if err := extractEntities(entityCtx, db, eid, fileID, contentForLLM); err != nil {
					logger.Error(entityCtx, fmt.Sprintf("实体抽取失败(非致命): file_id=%d, err=%v", fileID, err))
					updateParsingStatus(model.FileParsingStatusFail)
				}
			}()
		} else if isWikiPageGenerationActive(job) {
			logger.Info(ctx, fmt.Sprintf("DocumentChunking 跳过旧实体抽取: file_id=%d", fileID))
		}

		// 实体抽取完成后，异步触发洞察生成
		// 实体从纪要中抽取（而非转写原文），因纪要是处理过的价值高、格式稳定的内容。
		// 洞察生成不阻塞管线，异步执行。
		if GenerateInsightsFn != nil {
			go func() {
				insightsCtx, insightsCancel := context.WithTimeout(pipelineCtx(), 10*time.Minute)
				defer insightsCancel()
				GenerateInsightsFn(insightsCtx, eid, fileID, userID)
			}()
		} else {
			logger.Infof(ctx, "【洞察】GenerateInsightsFn 未注册，跳过: fileID=%d", fileID)
		}

		// 记录结果日志
		logger.Info(ctx, fmt.Sprintf("DocumentChunking 完成: 分块数=%d, 平均字符数=%.2f", count, avgChars))
		updateParsingStatus(model.FileParsingStatusNormal)

		return nil
	}
}

// cleanupExistingChunks 清理现有的 Chunk
func cleanupExistingChunks(db *gorm.DB, eid, fileID int64) error {
	// 1. 删除现有的知识点分块
	if err := db.Where("eid = ? AND file_id = ?", eid, fileID).
		Delete(&model.DocumentChunk{}).Error; err != nil {
		return fmt.Errorf("删除现有知识点分块失败: %v", err)
	}

	// 2. 删除现有的检索块
	if err := db.Where("eid = ? AND file_id = ?", eid, fileID).
		Delete(&model.RetrievalChunk{}).Error; err != nil {
		return fmt.Errorf("删除现有检索块失败: %v", err)
	}
	return nil
}

// V2 配置结构定义
type V2DocumentChunkingConfig struct {
	ChunkType             string                `json:"chunk_type"`
	EnableSmartMatch      bool                  `json:"enable_smart_match"`
	MatchPreferencePrompt string                `json:"match_preference_prompt"`
	ParentChunk           V2ChunkingLayerConfig `json:"parent_chunk"`
	ChildChunk            V2ChunkingLayerConfig `json:"child_chunk"`
	IndexEnhancement      V2IndexEnhancement    `json:"index_enhancement"`
}

type V2ChunkingLayerConfig struct {
	Mode            string `json:"mode"`             // default, custom, whole
	Strategy        string `json:"strategy"`         // identifier, length
	IdentifierLevel string `json:"identifier_level"` // h1-h6
	MaxLength       int    `json:"max_length"`
	AppendFilename  bool   `json:"append_filename"`
	AppendTitle     bool   `json:"append_title"`
	AppendSubtitle  bool   `json:"append_subtitle"`
}

type V2IndexEnhancement struct {
	MetadataInjection     V2MetadataInjection     `json:"metadata_injection"`
	GenerativeEnhancement V2GenerativeEnhancement `json:"generative_enhancement"`
}

type V2MetadataInjection struct {
	AppendFilename bool `json:"append_filename"`
	AppendTitle    bool `json:"append_title"`
	AppendSubtitle bool `json:"append_subtitle"`
}

type V2GenerativeEnhancement struct {
	GenerateSummary bool `json:"generate_summary"`
	GenerateFaq     bool `json:"generate_faq"`
}

func parseV2ChunkingConfig(stepConfig json.RawMessage) (*V2DocumentChunkingConfig, error) {
	var config V2DocumentChunkingConfig
	if len(stepConfig) == 0 {
		return &config, nil // Return empty config (will use defaults)
	}
	if err := json.Unmarshal(stepConfig, &config); err != nil {
		return nil, err
	}
	return &config, nil
}

func convertToRagChunkConfig(v2 *V2DocumentChunkingConfig) *rag.ChunkConfig {
	if v2 == nil {
		v2 = &V2DocumentChunkingConfig{}
	}
	// 创建默认配置
	config := &rag.ChunkConfig{
		Type: model.ChunkTypeDefault,
	}
	if v2.ChunkType != "" {
		config.Type = v2.ChunkType
	}

	// 映射 ParentChunk -> KnowledgeChunk
	if v2.ParentChunk.Mode == "whole" {
		config.KnowledgeChunk.SplitRule = "none"
	} else {
		config.KnowledgeChunk.SplitRule = v2.ParentChunk.IdentifierLevel
		if v2.ParentChunk.Strategy == "identifier" {
			config.KnowledgeChunk.ChunkMode = rag.ChunkModelIdentifierFirst
		} else {
			config.KnowledgeChunk.ChunkMode = rag.ChunkModelLengthFirst
		}
	}
	config.KnowledgeMaxLength = v2.ParentChunk.MaxLength
	// config.KnowledgeChunk.MaxLength is also used in some places, so set both
	config.KnowledgeChunk.MaxLength = v2.ParentChunk.MaxLength

	config.KnowledgeIncludeFileName = v2.ParentChunk.AppendFilename
	config.KnowledgeIncludeTitle = v2.ParentChunk.AppendTitle
	config.KnowledgeChunk.IncludeFileName = v2.ParentChunk.AppendFilename
	config.KnowledgeChunk.IncludeTitle = v2.ParentChunk.AppendTitle
	config.KnowledgeIncludeSubtitle = v2.ParentChunk.AppendSubtitle
	config.KnowledgeChunk.AppendSubtitle = v2.ParentChunk.AppendSubtitle

	// 映射 ChildChunk -> IndexChunk
	if v2.ChildChunk.Mode == "whole" {
		config.IndexChunk.SplitRule = "none"
	} else {
		config.IndexChunk.SplitRule = v2.ChildChunk.IdentifierLevel
		if v2.ChildChunk.Strategy == "identifier" {
			config.IndexChunk.ChunkMode = rag.ChunkModelIdentifierFirst
		} else {
			config.IndexChunk.ChunkMode = rag.ChunkModelLengthFirst
		}
	}
	config.IndexMaxLength = v2.ChildChunk.MaxLength
	config.IndexChunk.MaxLength = v2.ChildChunk.MaxLength

	config.IndexIncludeFileName = v2.ChildChunk.AppendFilename || v2.IndexEnhancement.MetadataInjection.AppendFilename
	config.IndexIncludeTitle = v2.ChildChunk.AppendTitle || v2.IndexEnhancement.MetadataInjection.AppendTitle
	config.IndexChunk.IncludeFileName = v2.ChildChunk.AppendFilename || v2.IndexEnhancement.MetadataInjection.AppendFilename
	config.IndexChunk.IncludeTitle = v2.ChildChunk.AppendTitle || v2.IndexEnhancement.MetadataInjection.AppendTitle
	config.IndexIncludeSubtitle = v2.ChildChunk.AppendSubtitle || v2.IndexEnhancement.MetadataInjection.AppendSubtitle
	config.IndexChunk.AppendSubtitle = v2.ChildChunk.AppendSubtitle || v2.IndexEnhancement.MetadataInjection.AppendSubtitle

	// 映射 GenerativeEnhancement
	if v2.IndexEnhancement.GenerativeEnhancement.GenerateSummary {
		config.SummaryGeneration = "ai"
	} else {
		config.SummaryGeneration = "manual"
	}
	if v2.IndexEnhancement.GenerativeEnhancement.GenerateFaq {
		config.QuestionGeneration = "ai"
	} else {
		config.QuestionGeneration = "manual"
	}

	return config
}

func hasChunkingOverrides(config *V2DocumentChunkingConfig) bool {
	if config == nil {
		return false
	}
	if config.ParentChunk.Mode != "" ||
		config.ParentChunk.Strategy != "" ||
		config.ParentChunk.IdentifierLevel != "" ||
		config.ParentChunk.MaxLength > 0 ||
		config.ParentChunk.AppendFilename ||
		config.ParentChunk.AppendTitle ||
		config.ParentChunk.AppendSubtitle {
		return true
	}
	if config.ChildChunk.Mode != "" ||
		config.ChildChunk.Strategy != "" ||
		config.ChildChunk.IdentifierLevel != "" ||
		config.ChildChunk.MaxLength > 0 ||
		config.ChildChunk.AppendFilename ||
		config.ChildChunk.AppendTitle ||
		config.ChildChunk.AppendSubtitle {
		return true
	}
	if config.IndexEnhancement.MetadataInjection.AppendFilename ||
		config.IndexEnhancement.MetadataInjection.AppendTitle ||
		config.IndexEnhancement.MetadataInjection.AppendSubtitle ||
		config.IndexEnhancement.GenerativeEnhancement.GenerateSummary ||
		config.IndexEnhancement.GenerativeEnhancement.GenerateFaq {
		return true
	}
	return false
}

func mergeChunkingConfig(dst *rag.ChunkConfig, src *rag.ChunkConfig) {
	if dst == nil || src == nil {
		return
	}

	if src.KnowledgeChunk.SplitRule != "" {
		dst.KnowledgeChunk.SplitRule = src.KnowledgeChunk.SplitRule
	}
	if src.KnowledgeChunk.ChunkMode != "" {
		dst.KnowledgeChunk.ChunkMode = src.KnowledgeChunk.ChunkMode
	}
	if src.KnowledgeChunk.MaxLength > 0 {
		dst.KnowledgeChunk.MaxLength = src.KnowledgeChunk.MaxLength
		dst.KnowledgeMaxLength = src.KnowledgeChunk.MaxLength
	} else if src.KnowledgeMaxLength > 0 {
		dst.KnowledgeMaxLength = src.KnowledgeMaxLength
	}
	dst.KnowledgeIncludeFileName = dst.KnowledgeIncludeFileName || src.KnowledgeIncludeFileName
	dst.KnowledgeIncludeTitle = dst.KnowledgeIncludeTitle || src.KnowledgeIncludeTitle
	dst.KnowledgeChunk.IncludeFileName = dst.KnowledgeChunk.IncludeFileName || src.KnowledgeChunk.IncludeFileName
	dst.KnowledgeChunk.IncludeTitle = dst.KnowledgeChunk.IncludeTitle || src.KnowledgeChunk.IncludeTitle
	dst.KnowledgeIncludeSubtitle = dst.KnowledgeIncludeSubtitle || src.KnowledgeIncludeSubtitle
	dst.KnowledgeChunk.AppendSubtitle = dst.KnowledgeChunk.AppendSubtitle || src.KnowledgeChunk.AppendSubtitle

	if src.IndexChunk.SplitRule != "" {
		dst.IndexChunk.SplitRule = src.IndexChunk.SplitRule
	}
	if src.IndexChunk.ChunkMode != "" {
		dst.IndexChunk.ChunkMode = src.IndexChunk.ChunkMode
	}
	if src.IndexChunk.MaxLength > 0 {
		dst.IndexChunk.MaxLength = src.IndexChunk.MaxLength
		dst.IndexMaxLength = src.IndexChunk.MaxLength
	} else if src.IndexMaxLength > 0 {
		dst.IndexMaxLength = src.IndexMaxLength
	}
	dst.IndexIncludeFileName = dst.IndexIncludeFileName || src.IndexIncludeFileName
	dst.IndexIncludeTitle = dst.IndexIncludeTitle || src.IndexIncludeTitle
	dst.IndexChunk.IncludeFileName = dst.IndexChunk.IncludeFileName || src.IndexChunk.IncludeFileName
	dst.IndexChunk.IncludeTitle = dst.IndexChunk.IncludeTitle || src.IndexChunk.IncludeTitle
	dst.IndexIncludeSubtitle = dst.IndexIncludeSubtitle || src.IndexIncludeSubtitle
	dst.IndexChunk.AppendSubtitle = dst.IndexChunk.AppendSubtitle || src.IndexChunk.AppendSubtitle

	if src.SummaryGeneration != "" {
		dst.SummaryGeneration = src.SummaryGeneration
	}
	if src.QuestionGeneration != "" {
		dst.QuestionGeneration = src.QuestionGeneration
	}
}
