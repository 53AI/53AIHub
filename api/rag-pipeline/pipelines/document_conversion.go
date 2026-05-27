package pipelines

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/rag-pipeline/steps"
	"gorm.io/gorm"
)

// DocumentConversionPipeline 文档转换流水线
type DocumentConversionPipeline struct {
	*BasePipeline
}

// NewDocumentConversionPipeline 创建新的文档转换流水线
func NewDocumentConversionPipeline() Pipeline {
	pipeline := &DocumentConversionPipeline{
		BasePipeline: NewBasePipeline("document_conversion"),
	}

	// 注册流水线
	RegisterPipeline("document_conversion", func() Pipeline {
		return NewDocumentConversionPipeline()
	})

	return pipeline
}

// NewDocumentConversionPipelineWithDB 创建带有数据库连接的文档转换流水线
func NewDocumentConversionPipelineWithDB(db *gorm.DB) Pipeline {
	pipeline := &DocumentConversionPipeline{
		BasePipeline: NewBasePipelineWithDB("document_conversion", db),
	}

	return pipeline
}

// Initialize 初始化文档转换流水线
func (p *DocumentConversionPipeline) Initialize() error {
	// 添加文档转换步骤
	conversionStep := steps.NewDocumentConversionStep(p.DB)
	if err := p.AddStep("document_conversion", conversionStep); err != nil {
		return err
	}

	// 添加触发生成问答和摘要流水线步骤
	triggerGenerateQuestionsAndSummaryStep := steps.NewTriggerGenerateQuestionsAndSummaryStep(p.DB)
	if err := p.AddStep("trigger_generate_questions_and_summary", triggerGenerateQuestionsAndSummaryStep); err != nil {
		return err
	}

	// 添加触发重新分块并索引流水线步骤
	triggerRechunkAndReindexStep := steps.NewTriggerRechunkAndReindexStep(p.DB)
	if err := p.AddStep("trigger_rechunk_and_reindex", triggerRechunkAndReindexStep); err != nil {
		return err
	}

	return nil
}

// PrepareStepParameters 准备步骤参数
func (p *DocumentConversionPipeline) PrepareStepParameters(order int) interface{} {
	// 从任务上下文中获取参数
	var eid, fileID, uploadID, userID, libraryID int64
	var ok bool

	// 获取 eid
	if eidVal, exists := p.Context["eid"]; exists {
		if eid, ok = eidVal.(int64); !ok {
			eid = 0
		}
	}

	// 获取 file_id
	if fileIDVal, exists := p.Context["file_id"]; exists {
		if fileID, ok = fileIDVal.(int64); !ok {
			fileID = 0
		}
	}

	// 获取 upload_id
	if uploadIDVal, exists := p.Context["upload_id"]; exists {
		if uploadID, ok = uploadIDVal.(int64); !ok {
			uploadID = 0
		}
	}

	// 获取 user_id
	if userIDVal, exists := p.Context["user_id"]; exists {
		if userID, ok = userIDVal.(int64); !ok {
			userID = 0
		}
	}

	// 获取 library_id
	if libraryIDVal, exists := p.Context["library_id"]; exists {
		if libraryID, ok = libraryIDVal.(int64); !ok {
			libraryID = 0
		}
	}

	// 获取 parse_type
	var parseType string
	if parseTypeVal, exists := p.Context["parse_type"]; exists {
		if parseType, ok = parseTypeVal.(string); !ok {
			parseType = ""
		}
	}

	// 根据步骤顺序返回对应的参数
	switch order {
	case 1:
		return steps.DocumentConversionParameters{
			Eid:       eid,
			FileID:    fileID,
			UploadID:  uploadID,
			UserID:    userID,
			LibraryID: libraryID,
			ParseType: parseType,
		}
	case 2:
		return steps.TriggerGenerateQuestionsAndSummaryParameters{
			Eid:    eid,
			FileID: fileID,
			UserID: userID,
		}
	case 3:
		return steps.TriggerRechunkAndReindexParameters{
			Eid:    eid,
			FileID: fileID,
			UserID: userID,
		}
	default:
		return nil
	}
}

// DocumentConversionParameters 文档转换流水线的参数
type DocumentConversionParameters struct {
	Eid          int64  `json:"eid"`
	FileID       int64  `json:"file_id"`
	UploadID     int64  `json:"upload_id"`
	UserID       int64  `json:"user_id"`
	LibraryID    int64  `json:"library_id"`
	OriginStatus string `json:"origin_status"` // 原始状态，用于取消后还原状态
	ParseType    string `json:"parse_type"`    // 解析类型
}

// Execute 执行文档转换流水线
func (p *DocumentConversionPipeline) Execute(job *model.RagJob) error {
	// 解析参数
	var params DocumentConversionParameters
	if job.StartParameters != "" {
		if err := json.Unmarshal([]byte(job.StartParameters), &params); err != nil {
			return fmt.Errorf("failed to unmarshal parameters: %v", err)
		}
	}

	// 将参数添加到上下文中
	p.Context["eid"] = params.Eid
	p.Context["file_id"] = params.FileID
	p.Context["upload_id"] = params.UploadID
	p.Context["user_id"] = params.UserID
	p.Context["library_id"] = params.LibraryID
	p.Context["parse_type"] = params.ParseType

	fail := func(err error) error {
		if p.DB != nil {
			if updateErr := job.UpdateJobStatusToFailed(p.DB, err.Error()); updateErr != nil {
				logger.SysErrorf("更新job失败状态出错: %v", updateErr)
			}
		}
		return err
	}

	if p.DB == nil {
		return fail(fmt.Errorf("数据库连接为空"))
	}

	_, _, stepsMap, err := p.ResolveCleaningPipelineProfileByFileID(params.Eid, params.FileID)
	if err != nil {
		return fail(err)
	}

	stepMeta, ok := stepsMap["document_parsing"]
	if !ok {
		return fail(fmt.Errorf("清洗管线 profile_json 未配置 document_parsing 步骤"))
	}
	if !stepMeta.Enabled {
		_ = model.UpdateFileConversionStatus(params.FileID, model.FileConversionStatusFail)
		return fail(fmt.Errorf("document_parsing 已禁用"))
	}

	if strings.TrimSpace(params.ParseType) == "" {
		var cfg struct {
			Engine string `json:"engine"`
		}
		if len(stepMeta.Config) > 0 {
			if err := json.Unmarshal(stepMeta.Config, &cfg); err != nil {
				return fail(fmt.Errorf("解析 document_parsing.config 失败: %v", err))
			}
		}
		engine := strings.TrimSpace(cfg.Engine)
		if engine == "" {
			return fail(fmt.Errorf("document_parsing.config.engine 为空"))
		}
		p.Context["parse_type"] = engine
	}

	// 如果尚未初始化，则初始化流水线
	if len(p.Steps) == 0 {
		if err := p.Initialize(); err != nil {
			if p.DB != nil {
				if updateErr := job.UpdateJobStatusToFailed(p.DB, err.Error()); updateErr != nil {
					logger.SysErrorf("更新job失败状态出错: %v", updateErr)
				}
			}
			return err
		}
	}

	// 使用自身作为执行器调用基础执行方法
	return p.BasePipeline.ExecuteWithExecutor(job, p)
}
