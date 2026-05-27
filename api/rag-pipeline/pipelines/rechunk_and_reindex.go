package pipelines

import (
	"encoding/json"
	"fmt"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/rag-pipeline/steps"
	"gorm.io/gorm"
)

// RechunkAndReindexPipeline 重新分块并索引流水线
type RechunkAndReindexPipeline struct {
	*BasePipeline
}

// NewRechunkAndReindexPipeline 创建新的重新分块并索引流水线
func NewRechunkAndReindexPipeline() Pipeline {
	pipeline := &RechunkAndReindexPipeline{
		BasePipeline: NewBasePipeline("rechunk_and_reindex"),
	}

	// 注册流水线
	RegisterPipeline("rechunk_and_reindex", func() Pipeline {
		return NewRechunkAndReindexPipeline()
	})

	return pipeline
}

// NewRechunkAndReindexPipelineWithDB 创建带有数据库连接的重新分块并索引流水线
func NewRechunkAndReindexPipelineWithDB(db *gorm.DB) Pipeline {
	pipeline := &RechunkAndReindexPipeline{
		BasePipeline: NewBasePipelineWithDB("rechunk_and_reindex", db),
	}

	return pipeline
}

// Initialize 初始化重新分块并索引流水线
func (p *RechunkAndReindexPipeline) Initialize() error {
	// 添加清理数据库中的Chunk记录步骤
	cleanupDbStep := steps.NewCleanupDbChunksStep(p.DB)
	if err := p.AddStep("cleanup_db_chunks", cleanupDbStep); err != nil {
		return err
	}

	// 添加执行分块步骤
	chunkStep := steps.NewDocumentChunkingStep(p.DB)
	if err := p.AddStep("document_chunking", chunkStep); err != nil {
		return err
	}

	// 添加触发重新索引流水线步骤，设置run_ai_index_task为true
	triggerReIndexStep := steps.NewTriggerReIndexStep(p.DB)
	if err := p.AddStep("trigger_reindex", triggerReIndexStep); err != nil {
		return err
	}

	// 添加触发生成知识地图任务步骤
	triggerKMStep := steps.NewTriggerGenerateKnowledgeMapStep(p.DB)
	if err := p.AddStep("trigger_generate_knowledge_map", triggerKMStep); err != nil {
		return err
	}

	return nil
}

// PrepareStepParameters 准备步骤参数
func (p *RechunkAndReindexPipeline) PrepareStepParameters(order int) interface{} {
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

	// 根据步骤顺序返回对应的参数
	switch order {
	case 1:
		return steps.CleanupDbChunksParameters{
			Eid:    eid,
			FileID: fileID,
			UserID: userID,
		}
	case 2:
		return steps.DocumentChunkingParameters{
			Eid:    eid,
			FileID: fileID,
			UserID: userID,
		}
	case 3:
		return steps.TriggerReIndexParameters{
			Eid:            eid,
			FileID:         fileID,
			UserID:         userID,
			RunAIIndexTask: true, // 重新分块并索引流水线需要运行AI索引任务
		}
	case 4:
		return steps.TriggerGenerateKnowledgeMapParameters{
			Eid:    eid,
			FileID: fileID,
			UserID: userID,
		}
	default:
		return nil
	}
}

// ExecuteWithFileID 使用文件ID执行流水线
func (p *RechunkAndReindexPipeline) ExecuteWithFileID(jobID int64, eid, fileID, userID int64) error {
	// 将参数添加到上下文中
	p.Context["eid"] = eid
	p.Context["file_id"] = fileID
	p.Context["user_id"] = userID

	// 创建任务对象
	job := &model.RagJob{
		JobID:  jobID,
		Eid:    eid,
		Type:   p.GetType(),
		Status: model.RagJobStatusPending,
	}

	// 将参数序列化为JSON字符串
	params := map[string]interface{}{
		"eid":     eid,
		"file_id": fileID,
		"user_id": userID,
	}
	paramsJSON, err := json.Marshal(params)
	if err != nil {
		return fmt.Errorf("failed to marshal parameters: %v", err)
	}
	job.StartParameters = string(paramsJSON)

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

	// 调用基础流水线的执行方法
	return p.BasePipeline.Execute(job)
}

// RechunkAndReindexParameters 重新分块并索引流水线的参数
type RechunkAndReindexParameters struct {
	Eid          int64  `json:"eid"`
	FileID       int64  `json:"file_id"`
	UserID       int64  `json:"user_id"`
	OriginStatus string `json:"origin_status"`
}

// Execute 执行重新分块并索引流水线
func (p *RechunkAndReindexPipeline) Execute(job *model.RagJob) error {
	// 解析参数
	var params RechunkAndReindexParameters
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
