package steps

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/rag"
	"gorm.io/gorm"
)

const graphTemplateSelectionContextMaxTokens = 1200
const graphGenerationExecutionModeEnableLLMTemplateSelection = "enable_llm_template_selection"

type graphTemplateSelectionFunc func(ctx context.Context, db *gorm.DB, eid int64, fileContext string) (*model.GraphTemplate, error)
type graphTemplateGenerationFunc func(ctx context.Context, db *gorm.DB, eid int64, fileContent string) (*model.GraphTemplate, error)
type graphTemplateLoaderFunc func(eid int64, templateID int64) (*model.GraphTemplate, error)
type graphTemplateSelectionContextLoaderFunc func(ctx context.Context, db *gorm.DB, eid int64, fileID int64) (string, error)
type graphTemplateRelationProbeRunner interface {
	ExtractForChunks(ctx context.Context, eid int64, template *model.GraphTemplate, chunks []model.DocumentChunk) ([]rag.ExtractedGraphEntity, []rag.ExtractedGraphRelation, error)
}

// FlexID 支持字符串和整数类型的ID
type FlexID struct {
	value int64
}

// UnmarshalJSON 实现自定义JSON解析，支持string和int/float64
func (f *FlexID) UnmarshalJSON(data []byte) error {
	// 尝试解析为字符串
	var str string
	if err := json.Unmarshal(data, &str); err == nil {
		str = strings.TrimSpace(str)
		if str == "" {
			f.value = 0
			return nil
		}
		id, err := hashids.TryParseID(str)
		if err != nil {
			return fmt.Errorf("invalid template_id format: %v", err)
		}
		f.value = id
		return nil
	}

	// 尝试解析为数字
	var num float64
	if err := json.Unmarshal(data, &num); err == nil {
		f.value = int64(num)
		return nil
	}

	return fmt.Errorf("template_id must be string or number")
}

// Int64 返回int64值
func (f *FlexID) Int64() int64 {
	return f.value
}

// GraphGenerationConfig 图谱生成步骤配置
type GraphGenerationConfig struct {
	GraphTemplateID            FlexID `json:"graph_template_id"`             // 模板ID（支持HashID字符串或int）
	ExecutionMode              string `json:"execution_mode"`                // 执行方式：predefined / auto_discovery / enable_llm_template_selection
	EnableSmartMatch           bool   `json:"enable_smart_match"`            // 智能匹配开关
	EnableSmartGeneration      bool   `json:"enable_smart_generation"`       // 智能生成开关
	EnableLLMTemplateSelection bool   `json:"enable_llm_template_selection"` // 旧版自动LLM选择模板开关（兼容字段）

	hasEnableSmartMatch           bool
	hasEnableSmartGeneration      bool
	hasEnableLLMTemplateSelection bool
}

func (cfg *GraphGenerationConfig) UnmarshalJSON(data []byte) error {
	type alias GraphGenerationConfig
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}

	var decoded alias
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}

	*cfg = GraphGenerationConfig(decoded)
	cfg.hasEnableSmartMatch = hasJSONField(raw, "enable_smart_match")
	cfg.hasEnableSmartGeneration = hasJSONField(raw, "enable_smart_generation")
	cfg.hasEnableLLMTemplateSelection = hasJSONField(raw, "enable_llm_template_selection")
	return nil
}

func hasJSONField(raw map[string]json.RawMessage, key string) bool {
	if raw == nil {
		return false
	}
	_, ok := raw[key]
	return ok
}

func shouldUseSmartMatch(cfg GraphGenerationConfig) bool {
	if cfg.hasEnableSmartMatch {
		return cfg.EnableSmartMatch
	}
	if cfg.hasEnableLLMTemplateSelection {
		return cfg.EnableLLMTemplateSelection
	}
	switch cfg.ExecutionMode {
	case graphGenerationExecutionModeEnableLLMTemplateSelection:
		return true
	}
	return cfg.EnableSmartMatch || cfg.EnableLLMTemplateSelection
}

func shouldUseSmartGeneration(cfg GraphGenerationConfig) bool {
	return shouldUseSmartMatch(cfg) && cfg.EnableSmartGeneration
}

func validateGraphGenerationConfig(cfg GraphGenerationConfig) error {
	if cfg.ExecutionMode != "" &&
		cfg.ExecutionMode != "predefined" &&
		cfg.ExecutionMode != "auto_discovery" &&
		cfg.ExecutionMode != graphGenerationExecutionModeEnableLLMTemplateSelection {
		return fmt.Errorf("不支持的执行方式: %s", cfg.ExecutionMode)
	}
	if cfg.EnableSmartGeneration && !shouldUseSmartMatch(cfg) {
		return fmt.Errorf("智能生成只能在智能匹配开启时启用")
	}
	if !shouldUseSmartMatch(cfg) && cfg.GraphTemplateID.Int64() <= 0 {
		return fmt.Errorf("graph_template_id 不能为空")
	}
	return nil
}

func loadGraphTemplateContent(ctx context.Context, db *gorm.DB, eid int64, fileID int64) (string, error) {
	var fileBody model.FileBody
	if err := db.Where("eid = ? AND file_id = ?", eid, fileID).Order("id DESC").First(&fileBody).Error; err != nil {
		return "", fmt.Errorf("获取文件正文失败: %v", err)
	}

	content, err := fileBody.GetContent()
	if err != nil {
		return "", fmt.Errorf("获取文件正文失败: %v", err)
	}
	content = strings.TrimSpace(content)
	if content == "" {
		return "", fmt.Errorf("文件正文为空")
	}

	return content, nil
}

func loadGraphTemplateSelectionContext(ctx context.Context, db *gorm.DB, eid int64, fileID int64) (string, error) {
	content, err := loadGraphTemplateContent(ctx, db, eid, fileID)
	if err != nil {
		return "", err
	}
	tokenizer := rag.NewTokenizerService()
	chunks, err := tokenizer.SplitTextByTokens(content, graphTemplateSelectionContextMaxTokens, 0)
	if err != nil {
		return "", fmt.Errorf("截取模板选择上下文失败: %v", err)
	}
	if len(chunks) == 0 {
		return "", fmt.Errorf("模板选择上下文为空")
	}

	return strings.TrimSpace(chunks[0]), nil
}

func probeGraphTemplateRelations(ctx context.Context, runner graphTemplateRelationProbeRunner, eid int64, template *model.GraphTemplate, chunks []model.DocumentChunk) (bool, error) {
	if runner == nil {
		return false, fmt.Errorf("图谱关系预检执行器不能为空")
	}
	if template == nil {
		return false, fmt.Errorf("图谱模板不能为空")
	}
	if len(chunks) == 0 {
		return false, nil
	}

	entities, relations, err := runner.ExtractForChunks(ctx, eid, template, chunks)
	if err != nil {
		return false, err
	}

	logger.Debugf(ctx, "【图谱生成】模板关系预检完成: template_id=%d, chunk_count=%d, entities=%d, relations=%d",
		template.ID, len(chunks), len(entities), len(relations))
	return len(relations) > 0, nil
}

func resolveGraphGenerationTemplate(
	ctx context.Context,
	db *gorm.DB,
	eid int64,
	fileID int64,
	cfg GraphGenerationConfig,
	selectTemplate graphTemplateSelectionFunc,
	generateTemplate graphTemplateGenerationFunc,
	loadSelectionContext graphTemplateSelectionContextLoaderFunc,
	loadGenerationContent graphTemplateSelectionContextLoaderFunc,
	loadTemplateByID graphTemplateLoaderFunc,
) (*model.GraphTemplate, bool, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if loadTemplateByID == nil {
		loadTemplateByID = model.GetGraphTemplateByID
	}

	if !shouldUseSmartMatch(cfg) {
		templateID := cfg.GraphTemplateID.Int64()
		if templateID <= 0 {
			return nil, false, fmt.Errorf("graph_template_id 不能为空")
		}
		template, err := loadTemplateByID(eid, templateID)
		if err != nil {
			return nil, false, err
		}
		return template, false, nil
	}
	if selectTemplate == nil {
		return nil, false, fmt.Errorf("图谱模板选择函数不能为空")
	}
	if loadSelectionContext == nil {
		return nil, false, fmt.Errorf("图谱模板选择上下文加载函数不能为空")
	}

	fileContext, err := loadSelectionContext(ctx, db, eid, fileID)
	if err != nil {
		return nil, false, err
	}

	template, err := selectTemplate(ctx, db, eid, fileContext)
	if err == nil && template != nil {
		return template, false, nil
	}

	if !shouldUseSmartGeneration(cfg) {
		return nil, true, nil
	}

	if generateTemplate == nil {
		return nil, false, fmt.Errorf("图谱模板自动生成函数不能为空")
	}
	if loadGenerationContent == nil {
		return nil, false, fmt.Errorf("图谱模板生成内容加载函数不能为空")
	}

	fileContent, err := loadGenerationContent(ctx, db, eid, fileID)
	if err != nil {
		return nil, false, err
	}

	logger.Warnf(ctx, "【图谱生成】智能匹配未命中，开始智能生成模板: file_id=%d", fileID)
	template, err = generateTemplate(ctx, db, eid, fileContent)
	if err != nil {
		return nil, false, err
	}

	return template, false, nil
}

// NewGraphGenerationHandler 创建图谱生成步骤处理器
func NewGraphGenerationHandler(db *gorm.DB) func(ctx context.Context, job *model.RagJob, config json.RawMessage) error {
	return func(ctx context.Context, job *model.RagJob, stepConfig json.RawMessage) error {
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
			switch vv := v.(type) {
			case float64:
				userID = int64(vv)
			case int64:
				userID = vv
			}
		}

		logger.Info(ctx, fmt.Sprintf("GraphGenerationStepHandler: processing job %d for file %d", job.JobID, fileID))

		// 解析步骤配置
		var cfg GraphGenerationConfig
		if len(stepConfig) > 0 && string(stepConfig) != "null" {
			if err := json.Unmarshal(stepConfig, &cfg); err != nil {
				return fmt.Errorf("解析步骤配置失败: %v", err)
			}
		}

		// 验证配置
		if err := validateGraphGenerationConfig(cfg); err != nil {
			return err
		}

		templateID := cfg.GraphTemplateID.Int64()

		// 目前 auto_discovery 仍保留原有行为，自动 LLM 选模板由新执行方式显式开启
		if cfg.ExecutionMode == "auto_discovery" {
			logger.Warnf(ctx, "auto_discovery 模式暂未实现，使用 predefined 模式")
			cfg.ExecutionMode = "predefined"
		}
		logger.Debugf(ctx, "【图谱生成】步骤配置: job_id=%d, template_id=%d, execution_mode=%s, 智能匹配=%t, 智能生成=%t",
			job.JobID, templateID, cfg.ExecutionMode, shouldUseSmartMatch(cfg), shouldUseSmartGeneration(cfg))

		// 获取文件信息
		var file model.File
		if err := db.Where("eid = ? AND id = ?", eid, fileID).First(&file).Error; err != nil {
			return fmt.Errorf("获取文件信息失败: %v", err)
		}
		if userID == 0 {
			userID = file.UserID
		}

		if err := common.CheckRagTaskStop(file.LibraryID, file.ID); err != nil {
			return err
		}

		// 获取模板定义
		template, skipped, err := resolveGraphGenerationTemplate(
			ctx,
			db,
			eid,
			fileID,
			cfg,
			func(selectCtx context.Context, selectDB *gorm.DB, selectEID int64, fileContext string) (*model.GraphTemplate, error) {
				return rag.SelectGraphTemplateByLLM(selectCtx, selectDB, selectEID, fileContext)
			},
			rag.GenerateGraphTemplateFromContent,
			loadGraphTemplateSelectionContext,
			loadGraphTemplateContent,
			model.GetGraphTemplateByID,
		)
		if err != nil {
			return fmt.Errorf("获取图谱模板失败: %v", err)
		}
		if skipped {
			logger.Warnf(ctx, "【图谱生成】智能匹配未命中且未开启智能生成，跳过图谱生成: job_id=%d, file_id=%d", job.JobID, fileID)
			if err := saveStepResults(db, job.JobID, map[string]interface{}{
				"entity_count":             0,
				"relation_count":           0,
				"chunk_count":              0,
				"error_count":              0,
				"skipped_count":            0,
				"graph_generation_skipped": true,
			}); err != nil {
				logger.Errorf(ctx, "保存跳过结果失败: %v", err)
			}
			return nil
		}
		templateID = template.ID

		// 获取文件的所有分片
		chunks, err := model.GetDocumentChunksByFileID(eid, fileID, 0, 0)
		if err != nil {
			return fmt.Errorf("获取文件分片失败: %v", err)
		}

		if len(chunks) == 0 {
			return nil
		}
		logger.Debugf(ctx, "【图谱生成】分片加载完成: file_id=%d, total_chunks=%d", fileID, len(chunks))

		// 创建图谱抽取服务
		extractor := rag.NewGraphExtractionService(db)

		// 先保留当前短分片跳过规则，再交给 batch helper 组批
		knowledgeChunks, skippedChunks := collectGraphGenerationKnowledgeChunks(chunks)
		logger.Debugf(ctx, "【图谱生成】知识分片筛选完成: file_id=%d, candidate_chunks=%d, skipped_chunks=%d", fileID, len(knowledgeChunks), skippedChunks)

		var retryTemplateResolver graphBatchTemplateRetryFunc
		if shouldUseSmartGeneration(cfg) {
			retryTemplateResolver = func(retryCtx context.Context) (*model.GraphTemplate, error) {
				fileContent, loadErr := loadGraphTemplateContent(retryCtx, db, eid, fileID)
				if loadErr != nil {
					return nil, loadErr
				}
				return rag.GenerateGraphTemplateFromContent(retryCtx, db, eid, fileContent)
			}
		}

		if shouldUseSmartMatch(cfg) {
			if shouldUseSmartGeneration(cfg) {
				logger.Debugf(ctx, "【图谱生成】智能生成或智能匹配完成: file_id=%d, template_id=%d, template_name=%s", fileID, template.ID, template.Name)
			} else {
				logger.Debugf(ctx, "【图谱生成】智能匹配完成: file_id=%d, template_id=%d, template_name=%s", fileID, template.ID, template.Name)
			}
		}

		// 获取文件关联的知识库和空间信息
		var library model.Library
		if err := db.Where("eid = ? AND id = ?", eid, file.LibraryID).First(&library).Error; err != nil {
			return fmt.Errorf("获取知识库信息失败: %v", err)
		}

		// 创建图谱实例
		instance := &model.GraphInstance{
			Eid:        eid,
			TemplateID: templateID,
			SpaceID:    library.SpaceID,
			LibraryID:  file.LibraryID,
			FileID:     fileID,
			RunID:      job.RunID,
			Status:     model.GraphInstanceStatusProcessing,
		}
		if err := model.CreateGraphInstance(db, instance); err != nil {
			return fmt.Errorf("创建图谱实例失败: %v", err)
		}

		processedChunks, skippedChunks, totalEntities, totalRelations, errorCount, finalTemplate, batchErr := runGraphGenerationBatchFlow(
			ctx,
			extractor,
			eid,
			template,
			instance.ID,
			templateID,
			&library,
			knowledgeChunks,
			skippedChunks,
			retryTemplateResolver,
		)
		if batchErr != nil {
			_ = model.UpdateGraphInstanceStatus(db, instance.ID, model.GraphInstanceStatusFailed, batchErr.Error())
			return fmt.Errorf("图谱抽取遇到致命错误，已终止: %v", batchErr)
		}
		if finalTemplate != nil && finalTemplate.ID > 0 && finalTemplate.ID != templateID {
			template = finalTemplate
			templateID = finalTemplate.ID
			instance.TemplateID = templateID
			if err := db.Model(&model.GraphInstance{}).Where("id = ?", instance.ID).Update("template_id", templateID).Error; err != nil {
				return fmt.Errorf("更新图谱实例模板失败: %v", err)
			}
			logger.Debugf(ctx, "【图谱生成】图谱实例模板已更新: instance_id=%d, template_id=%d, template_name=%s", instance.ID, templateID, template.Name)
		}

		// 更新图谱实例状态
		var statusMsg string
		if errorCount > 0 {
			statusMsg = fmt.Sprintf("处理完成，%d 个分片失败", errorCount)
		}
		_ = model.UpdateGraphInstanceStatus(db, instance.ID, model.GraphInstanceStatusCompleted, statusMsg)
		logger.Debugf(ctx, "【图谱生成】步骤完成: instance_id=%d, processed_chunks=%d, skipped_chunks=%d, errors=%d, total_entities=%d, total_relations=%d",
			instance.ID, processedChunks, skippedChunks, errorCount, totalEntities, totalRelations)

		// 保存步骤结果（不更新状态，由 engine 统一管理）
		if err := saveStepResults(db, job.JobID, map[string]interface{}{
			"entity_count":   totalEntities,
			"relation_count": totalRelations,
			"chunk_count":    processedChunks,
			"error_count":    errorCount,
			"skipped_count":  skippedChunks,
		}); err != nil {
			logger.Errorf(ctx, "保存步骤结果失败: %v", err)
		} else {
			logger.Debugf(ctx, "【图谱生成】步骤结果已保存: job_id=%d, entity_count=%d, relation_count=%d, chunk_count=%d, error_count=%d, skipped_count=%d",
				job.JobID, totalEntities, totalRelations, processedChunks, errorCount, skippedChunks)
		}

		return nil
	}
}

func saveStepResults(db *gorm.DB, jobID int64, results map[string]interface{}) error {
	resultBytes, err := json.Marshal(results)
	if err != nil {
		return fmt.Errorf("序列化结果失败: %v", err)
	}
	return db.Model(&model.RagJobStep{}).Where("job_id = ?", jobID).Update("results", string(resultBytes)).Error
}
