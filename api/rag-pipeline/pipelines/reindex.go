package pipelines

import (
	"encoding/json"
	"fmt"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/rag-pipeline/steps"
	"gorm.io/gorm"
)

// ReindexPipeline 仅重新索引流水线
type ReindexPipeline struct {
	*BasePipeline
}

// NewReindexPipeline 创建新的重新索引流水线
func NewReindexPipeline() Pipeline {
	pipeline := &ReindexPipeline{
		BasePipeline: NewBasePipeline("reindex"),
	}

	// 注册流水线
	RegisterPipeline("reindex", func() Pipeline {
		return NewReindexPipeline()
	})

	return pipeline
}

// NewReindexPipelineWithDB 创建带有数据库连接的重新索引流水线
func NewReindexPipelineWithDB(db *gorm.DB) Pipeline {
	pipeline := &ReindexPipeline{
		BasePipeline: NewBasePipelineWithDB("reindex", db),
	}

	return pipeline
}

// Initialize 初始化重新索引流水线
func (p *ReindexPipeline) Initialize() error {
	// 添加清理向量库中的Chunk数据步骤
	cleanupVectorStep := steps.NewCleanupVectorStoreChunksStep(p.DB)
	if err := p.AddStep("cleanup_vector_store_chunks", cleanupVectorStep); err != nil {
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

	// 添加创建AI生成索引任务步骤（条件性执行）
	createAIGenerateIndexTaskStep := steps.NewCreateAIGenerateIndexTaskStep(p.DB)
	if err := p.AddStep("create_ai_generate_index_task", createAIGenerateIndexTaskStep); err != nil {
		return err
	}

	return nil
}

// PrepareStepParameters 准备步骤参数
func (p *ReindexPipeline) PrepareStepParameters(order int) interface{} {
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
		return steps.CleanupVectorStoreChunksParameters{
			Eid:    eid,
			FileID: fileID,
			UserID: userID,
		}
	case 2:
		return steps.RetrievalChunkingParameters{
			Eid:    eid,
			FileID: fileID,
			UserID: userID,
		}
	case 3:
		return steps.EmbeddingProcessingParameters{
			Eid:    eid,
			FileID: fileID,
			UserID: userID,
		}
	case 4:
		// 总是返回参数，让步骤内部决定是否执行
		return steps.AIGenerateIndexParameters{
			Eid:            eid,
			FileID:         fileID,
			UserID:         userID,
			RunAIIndexTask: runAIIndexTask, // 传递原始值，让步骤内部决定
		}
	default:
		return nil
	}
}

// ReindexParameters 重新索引流水线的参数
type ReindexParameters struct {
	Eid            int64  `json:"eid"`
	FileID         int64  `json:"file_id"`           // 使用下划线命名规范
	UserID         int64  `json:"user_id"`           // 使用下划线命名规范
	RunAIIndexTask bool   `json:"run_ai_index_task"` // 是否运行AI索引任务，默认为false
	OriginStatus   string `json:"origin_status"`     // 原始转换状态
}

// Execute 执行重新索引流水线
func (p *ReindexPipeline) Execute(job *model.RagJob) error {
	// 解析参数
	var params ReindexParameters
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
