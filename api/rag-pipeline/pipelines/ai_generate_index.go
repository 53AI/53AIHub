package pipelines

import (
	"encoding/json"
	"fmt"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/rag-pipeline/steps"
	"gorm.io/gorm"
)

// AIGenerateIndexPipeline AI生成索引增强流水线
type AIGenerateIndexPipeline struct {
	*BasePipeline
}

// NewAIGenerateIndexPipeline 创建新的AI生成索引增强流水线
func NewAIGenerateIndexPipeline() Pipeline {
	pipeline := &AIGenerateIndexPipeline{
		BasePipeline: NewBasePipeline("ai_generate_index"),
	}

	// 注册流水线
	RegisterPipeline("ai_generate_index", func() Pipeline {
		return NewAIGenerateIndexPipeline()
	})

	return pipeline
}

// NewAIGenerateIndexPipelineWithDB 创建带有数据库连接的AI生成索引增强流水线
func NewAIGenerateIndexPipelineWithDB(db *gorm.DB) Pipeline {
	pipeline := &AIGenerateIndexPipeline{
		BasePipeline: NewBasePipelineWithDB("ai_generate_index", db),
	}

	return pipeline
}

// Initialize 初始化AI生成索引增强流水线
func (p *AIGenerateIndexPipeline) Initialize() error {
	// 添加准备步骤：判断是否开启了AI生成索引逻辑
	prepareStep := steps.NewAIGenerateIndexPrepareStep(p.DB)
	if err := p.AddStep("ai_generate_index_prepare", prepareStep); err != nil {
		return err
	}

	// 添加索引步骤：逐块进行生成，生成结果更新到model.DocumentChunk的状态中
	indexStep := steps.NewAIGenerateIndexStep(p.DB)
	if err := p.AddStep("ai_generate_index", indexStep); err != nil {
		return err
	}

	// 添加结束步骤：更新file的AIGenerateChunkStatus状态
	finalizeStep := steps.NewAIGenerateIndexFinalizeStep(p.DB)
	if err := p.AddStep("ai_generate_index_finalize", finalizeStep); err != nil {
		return err
	}

	return nil
}

// PrepareStepParameters 准备步骤参数
func (p *AIGenerateIndexPipeline) PrepareStepParameters(order int) interface{} {
	// 从任务上下文中获取参数
	var eid, fileID, userID int64
	var runAIIndexTask bool
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

	// 获取 run_ai_index_task
	if runAIIndexTaskVal, exists := p.Context["run_ai_index_task"]; exists {
		if runAIIndexTask, ok = runAIIndexTaskVal.(bool); !ok {
			runAIIndexTask = false
		}
	}

	// 根据步骤顺序返回对应的参数
	switch order {
	case 1:
		return steps.AIGenerateIndexPrepareParameters{
			Eid:    eid,
			FileID: fileID,
			UserID: userID,
		}
	case 2:
		return steps.AIGenerateIndexParameters{
			Eid:            eid,
			FileID:         fileID,
			UserID:         userID,
			RunAIIndexTask: runAIIndexTask,
		}
	case 3:
		return steps.AIGenerateIndexFinalizeParameters{
			Eid:    eid,
			FileID: fileID,
			UserID: userID,
		}
	default:
		return nil
	}
}

// Execute 执行AI生成索引增强流水线
func (p *AIGenerateIndexPipeline) Execute(job *model.RagJob) error {
	// 解析参数
	var params steps.AIGenerateIndexParameters
	if job.StartParameters != "" {
		if err := json.Unmarshal([]byte(job.StartParameters), &params); err != nil {
			return fmt.Errorf("failed to unmarshal parameters: %v", err)
		}
	}

	// 将参数添加到上下文中
	p.Context["eid"] = params.Eid
	p.Context["file_id"] = params.FileID
	p.Context["user_id"] = params.UserID
	p.Context["run_ai_index_task"] = params.RunAIIndexTask

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
