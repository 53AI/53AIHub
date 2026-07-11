package pipelines

import (
	"encoding/json"
	"fmt"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/rag-pipeline/steps"
	"gorm.io/gorm"
)

// AutoChunkingPipeline 自动分块流水线
type AutoChunkingPipeline struct {
	*BasePipeline
}

// NewAutoChunkingPipeline 创建新的自动分块流水线
func NewAutoChunkingPipeline() Pipeline {
	pipeline := &AutoChunkingPipeline{
		BasePipeline: NewBasePipeline("auto_chunking"),
	}

	// 注册流水线
	RegisterPipeline("auto_chunking", func() Pipeline {
		return NewAutoChunkingPipeline()
	})

	return pipeline
}

// NewAutoChunkingPipelineWithDB 创建带有数据库连接的自动分块流水线
func NewAutoChunkingPipelineWithDB(db *gorm.DB) Pipeline {
	pipeline := &AutoChunkingPipeline{
		BasePipeline: NewBasePipelineWithDB("auto_chunking", db),
	}

	return pipeline
}

// Initialize 初始化自动分块流水线
func (p *AutoChunkingPipeline) Initialize() error {
	// 添加设置文件状态为parsing步骤
	setParsingStatusStep := steps.NewSetFileStatusStep(p.DB)
	if err := p.AddStep("set_parsing_status", setParsingStatusStep); err != nil {
		return err
	}

	// 添加清理数据库分块步骤
	cleanupDbChunksStep := steps.NewCleanupDbChunksStep(p.DB)
	if err := p.AddStep("cleanup_db_chunks", cleanupDbChunksStep); err != nil {
		return err
	}

	// 添加执行分块步骤
	chunkStep := steps.NewDocumentChunkingStep(p.DB)
	if err := p.AddStep("document_chunking", chunkStep); err != nil {
		return err
	}

	// 添加执行检索块步骤
	retrievalStep := steps.NewRetrievalChunkingStep(p.DB)
	if err := p.AddStep("retrieval_chunking", retrievalStep); err != nil {
		return err
	}

	// 添加向量化处理步骤
	embeddingStep := steps.NewEmbeddingProcessingStep(p.DB)
	if err := p.AddStep("embedding_processing", embeddingStep); err != nil {
		return err
	}

	// 添加设置文件状态为normal步骤
	setNormalStatusStep := steps.NewSetFileStatusStep(p.DB)
	if err := p.AddStep("set_normal_status", setNormalStatusStep); err != nil {
		return err
	}

	// 添加创建AI生成索引任务步骤
	createAIGenerateIndexTaskStep := steps.NewCreateAIGenerateIndexTaskStep(p.DB)
	if err := p.AddStep("create_ai_generate_index_task", createAIGenerateIndexTaskStep); err != nil {
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
func (p *AutoChunkingPipeline) PrepareStepParameters(order int) interface{} {
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
		return steps.SetFileStatusParameters{
			Eid:    eid,
			FileID: fileID,
			UserID: userID,
			Status: model.FileParsingStatusParsing,
		}
	case 2:
		return steps.CleanupDbChunksParameters{
			Eid:    eid,
			FileID: fileID,
			UserID: userID,
		}
	case 3:
		return steps.DocumentChunkingParameters{
			Eid:    eid,
			FileID: fileID,
			UserID: userID,
		}
	case 4:
		return steps.RetrievalChunkingParameters{
			Eid:    eid,
			FileID: fileID,
			UserID: userID,
		}
	case 5:
		return steps.EmbeddingProcessingParameters{
			Eid:    eid,
			FileID: fileID,
			UserID: userID,
		}
	case 6:
		return steps.SetFileStatusParameters{
			Eid:    eid,
			FileID: fileID,
			UserID: userID,
			Status: model.FileParsingStatusNormal,
		}
	case 7:
		return steps.AIGenerateIndexParameters{
			Eid:            eid,
			FileID:         fileID,
			UserID:         userID,
			RunAIIndexTask: true,
		}
	case 8:
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
func (p *AutoChunkingPipeline) ExecuteWithFileID(jobID int64, eid, fileID, userID int64) error {
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

// AutoChunkingParameters 自动分块流水线的参数
type AutoChunkingParameters struct {
	Eid          int64  `json:"eid"`
	FileID       int64  `json:"file_id"`       // 使用下划线命名规范
	UserID       int64  `json:"user_id"`       // 使用下划线命名规范
	OriginStatus string `json:"origin_status"` // 原始状态，用于取消后还原状态
}

// Execute 执行自动分块流水线
func (p *AutoChunkingPipeline) Execute(job *model.RagJob) error {
	// 解析参数
	var params AutoChunkingParameters
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
