package pipelines

import (
	"encoding/json"
	"fmt"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/rag-pipeline/steps"
	"gorm.io/gorm"
)

// GenerateKnowledgeMapParameters 生成知识地图流水线参数
type GenerateKnowledgeMapParameters struct {
	Eid            int64 `json:"eid"`
	FileID         int64 `json:"file_id"`
	UserID         int64 `json:"user_id"`
	ConversationID int64 `json:"conversation_id"`
}

// GenerateKnowledgeMapPipeline 生成知识地图流水线
type GenerateKnowledgeMapPipeline struct {
	*BasePipeline
}

// NewGenerateKnowledgeMapPipeline 创建新的生成知识地图流水线
func NewGenerateKnowledgeMapPipeline() Pipeline {
	pipeline := &GenerateKnowledgeMapPipeline{
		BasePipeline: NewBasePipeline("generate_knowledge_map"),
	}

	// 注册流水线
	RegisterPipeline("generate_knowledge_map", func() Pipeline {
		return NewGenerateKnowledgeMapPipeline()
	})

	return pipeline
}

// NewGenerateKnowledgeMapPipelineWithDB 创建带有数据库连接的生成知识地图流水线
func NewGenerateKnowledgeMapPipelineWithDB(db *gorm.DB) Pipeline {
	pipeline := &GenerateKnowledgeMapPipeline{
		BasePipeline: NewBasePipelineWithDB("generate_knowledge_map", db),
	}

	return pipeline
}

// Initialize 初始化生成知识地图流水线
func (p *GenerateKnowledgeMapPipeline) Initialize() error {
	// 添加准备步骤
	prepareStep := steps.NewGenerateKnowledgeMapPrepareStep(p.DB)
	if err := p.AddStep("generate_knowledge_map_prepare", prepareStep); err != nil {
		return err
	}

	// 添加生成步骤
	generateStep := steps.NewGenerateKnowledgeMapGenerateStep(p.DB)
	if err := p.AddStep("generate_knowledge_map_generate", generateStep); err != nil {
		return err
	}

	// 添加完成步骤
	finalizeStep := steps.NewGenerateKnowledgeMapFinalizeStep(p.DB)
	if err := p.AddStep("generate_knowledge_map_finalize", finalizeStep); err != nil {
		return err
	}

	return nil
}

// PrepareStepParameters 准备步骤参数
func (p *GenerateKnowledgeMapPipeline) PrepareStepParameters(order int) interface{} {
	var (
		eid            int64
		fileID         int64
		userID         int64
		conversationID int64
		ok             bool
	)

	if eidVal, exists := p.Context["eid"]; exists {
		if eid, ok = eidVal.(int64); !ok {
			eid = 0
		}
	}
	if fileIDVal, exists := p.Context["file_id"]; exists {
		if fileID, ok = fileIDVal.(int64); !ok {
			fileID = 0
		}
	}
	if userIDVal, exists := p.Context["user_id"]; exists {
		if userID, ok = userIDVal.(int64); !ok {
			userID = 0
		}
	}
	if conversationIDVal, exists := p.Context["conversation_id"]; exists {
		if conversationID, ok = conversationIDVal.(int64); !ok {
			conversationID = 0
		}
	}

	if eid == 0 {
		logger.SysLogf("GenerateKnowledgeMapPipeline: eid 参数缺失或为0")
		return nil
	}
	if fileID == 0 {
		logger.SysLogf("GenerateKnowledgeMapPipeline: fileID 参数缺失或为0")
		return nil
	}

	switch order {
	case 1:
		return steps.GenerateKnowledgeMapPrepareParameters{
			Eid:    eid,
			FileID: fileID,
			UserID: userID,
		}
	case 2:
		return steps.GenerateKnowledgeMapGenerateParameters{
			Eid:            eid,
			FileID:         fileID,
			UserID:         userID,
			ConversationID: conversationID,
		}
	case 3:
		return steps.GenerateKnowledgeMapFinalizeParameters{
			Eid:    eid,
			FileID: fileID,
			UserID: userID,
		}
	default:
		return nil
	}
}

// Execute 执行生成知识地图流水线
func (p *GenerateKnowledgeMapPipeline) Execute(job *model.RagJob) error {
	// 解析参数
	var params GenerateKnowledgeMapParameters
	if job.StartParameters != "" {
		if err := json.Unmarshal([]byte(job.StartParameters), &params); err != nil {
			return fmt.Errorf("failed to unmarshal parameters: %v", err)
		}
	}

	// 将参数添加到上下文中
	p.Context["eid"] = params.Eid
	p.Context["file_id"] = params.FileID
	p.Context["user_id"] = params.UserID
	p.Context["conversation_id"] = params.ConversationID

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
