package pipelines

import (
	"encoding/json"
	"fmt"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/rag-pipeline/steps"
	"github.com/53AI/53AIHub/service/rag"
	"gorm.io/gorm"
)

// GenerateQuestionsAndSummaryParameters 生成问题和简介流水线参数
type GenerateQuestionsAndSummaryParameters struct {
	Eid    int64 `json:"eid"`
	FileID int64 `json:"file_id"`
	UserID int64 `json:"user_id"`
}

// GenerateQuestionsAndSummaryPipeline 生成问题和简介流水线
type GenerateQuestionsAndSummaryPipeline struct {
	*BasePipeline
}

// NewGenerateQuestionsAndSummaryPipeline 创建新的生成问题和简介流水线
func NewGenerateQuestionsAndSummaryPipeline() Pipeline {
	pipeline := &GenerateQuestionsAndSummaryPipeline{
		BasePipeline: NewBasePipeline("generate_questions_and_summary"),
	}

	// 注册流水线
	RegisterPipeline("generate_questions_and_summary", func() Pipeline {
		return NewGenerateQuestionsAndSummaryPipeline()
	})

	return pipeline
}

// NewGenerateQuestionsAndSummaryPipelineWithDB 创建带有数据库连接的生成问题和简介流水线
func NewGenerateQuestionsAndSummaryPipelineWithDB(db *gorm.DB) Pipeline {
	pipeline := &GenerateQuestionsAndSummaryPipeline{
		BasePipeline: NewBasePipelineWithDB("generate_questions_and_summary", db),
	}

	return pipeline
}

// Initialize 初始化生成问题和简介流水线
func (p *GenerateQuestionsAndSummaryPipeline) Initialize() error {
	// 添加准备步骤：检查文件状态和配置
	prepareStep := steps.NewGenerateQuestionsAndSummaryPrepareStep(p.DB)
	if err := p.AddStep("generate_questions_and_summary_prepare", prepareStep); err != nil {
		return err
	}

	// 添加生成步骤：调用ContentGeneratorService生成问题和简介
	generateStep := steps.NewGenerateQuestionsAndSummaryGenerateStep(p.DB)
	if err := p.AddStep("generate_questions_and_summary_generate", generateStep); err != nil {
		return err
	}

	// 添加实体抽取步骤
	extractEntitiesStep := steps.NewExtractEntitiesStep(p.DB)
	if err := p.AddStep("extract_entities", extractEntitiesStep); err != nil {
		return err
	}

	// 添加完成步骤：更新文件状态和保存结果
	finalizedStep := steps.NewGenerateQuestionsAndSummaryFinalizeStep(p.DB)
	if err := p.AddStep("generate_questions_and_summary_finalize", finalizedStep); err != nil {
		return err
	}

	return nil
}

// PrepareStepParameters 准备步骤参数
func (p *GenerateQuestionsAndSummaryPipeline) PrepareStepParameters(order int) interface{} {
	// 从任务上下文中获取参数
	var eid, fileID, userID int64
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

	// 获取 user_id
	if userIDVal, exists := p.Context["user_id"]; exists {
		if userID, ok = userIDVal.(int64); !ok {
			userID = 0
		}
	}

	// 验证必需参数
	if eid == 0 {
		logger.SysLogf("GenerateQuestionsAndSummaryPipeline: eid 参数缺失或为0")
		return nil
	}
	if fileID == 0 {
		logger.SysLogf("GenerateQuestionsAndSummaryPipeline: fileID 参数缺失或为0")
		return nil
	}

	// 根据步骤顺序返回对应的参数
	switch order {
	case 1:
		return steps.GenerateQuestionsAndSummaryPrepareParameters{
			Eid:    eid,
			FileID: fileID,
			UserID: userID,
		}
	case 2:
		return steps.GenerateQuestionsAndSummaryGenerateParameters{
			Eid:    eid,
			FileID: fileID,
			UserID: userID,
		}
	case 3:
		// 尝试获取生成步骤（步骤2）的结果
		// 注意：步骤顺序可能变化，硬编码为2有风险，但在此流水线中是固定的
		// 更健壮的方式是根据 Step 名称查找，但这里简单处理
		var entities []rag.ExtractedEntity

		// 尝试从 Pipeline 的 Context 中获取（如果有）
		if entitiesVal, exists := p.Context["generated_entities"]; exists {
			if e, ok := entitiesVal.([]rag.ExtractedEntity); ok {
				entities = e
			}
		}

		// 如果 Context 中没有，尝试从上一步结果中获取（通过 BasePipeline 的 GetStepResult）
		if len(entities) == 0 {
			// 假设生成步骤是第2步
			if result, err := p.GetStepResult(2); err == nil {
				// result 是 map[string]interface{} (因为是 json unmarshal 出来的)
				// 需要小心处理类型转换
				if resMap, ok := result.(map[string]interface{}); ok {
					if entitiesRaw, ok := resMap["entities"]; ok {
						// 这是一个 interface{} slice，或者直接是 slice
						// json unmarshal 到 interface{} 通常会变成 []interface{}
						// 需要重新 marshal/unmarshal 或者手动转换
						// 这是一个性能损耗，但在 Pipeline 中可以接受

						// 简单起见，我们重新 marshal 再 unmarshal
						if jsonBytes, err := json.Marshal(entitiesRaw); err == nil {
							var extractedEntities []rag.ExtractedEntity
							if err := json.Unmarshal(jsonBytes, &extractedEntities); err == nil {
								entities = extractedEntities
							}
						}
					}
				}
			}
		}

		return steps.ExtractEntitiesParameters{
			Eid:      eid,
			FileID:   fileID,
			UserID:   userID,
			Entities: entities,
		}
	case 4:
		return steps.GenerateQuestionsAndSummaryFinalizeParameters{
			Eid:    eid,
			FileID: fileID,
			UserID: userID,
		}
	default:
		return nil
	}
}

// Execute 执行生成问题和简介流水线
func (p *GenerateQuestionsAndSummaryPipeline) Execute(job *model.RagJob) error {
	// 解析参数
	var params GenerateQuestionsAndSummaryParameters
	if job.StartParameters != "" {
		if err := json.Unmarshal([]byte(job.StartParameters), &params); err != nil {
			return fmt.Errorf("failed to unmarshal parameters: %v", err)
		}
	}

	// 将参数添加到上下文中
	p.Context["eid"] = params.Eid
	p.Context["file_id"] = params.FileID
	p.Context["user_id"] = params.UserID

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
