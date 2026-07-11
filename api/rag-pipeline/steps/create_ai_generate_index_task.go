package steps

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/rag"
	"gorm.io/gorm"
)

// CreateAIGenerateIndexTaskStep 创建AI生成索引任务步骤
type CreateAIGenerateIndexTaskStep struct {
	BaseStep
	DB *gorm.DB
}

// CreateAIGenerateIndexTaskResult 创建AI生成索引任务步骤的结果
type CreateAIGenerateIndexTaskResult struct {
	TaskID      int64            `json:"task_id"` // 创建的任务ID
	Success     bool             `json:"success"`
	ChunkConfig *rag.ChunkConfig `json:"chunk_config"`
}

// NewCreateAIGenerateIndexTaskStep 创建新的创建AI生成索引任务步骤
func NewCreateAIGenerateIndexTaskStep(db *gorm.DB) *CreateAIGenerateIndexTaskStep {
	return &CreateAIGenerateIndexTaskStep{
		DB: db,
	}
}

// Execute 执行创建AI生成索引任务步骤
func (s *CreateAIGenerateIndexTaskStep) Execute(parameters any) error {
	s.Step.StartProcessing(parameters)

	// 类型断言获取参数
	params, ok := parameters.(AIGenerateIndexParameters)
	if !ok {
		// 获取实际参数类型信息
		actualType := fmt.Sprintf("%T", parameters)
		err := fmt.Errorf("invalid parameters type, expected AIGenerateIndexParameters, got %s", actualType)
		s.Step.CompleteWithError(err.Error())
		return err
	}

	// 检查是否需要运行AI索引任务
	if !params.RunAIIndexTask {
		// 不需要运行AI索引任务，记录信息并正常完成步骤
		fmt.Printf("AI索引任务未启用，跳过创建AI生成索引任务 (文件ID: %d)\n", params.FileID)
		s.Step.CompleteSuccessfully(CreateAIGenerateIndexTaskResult{
			TaskID:      0,
			Success:     true,
			ChunkConfig: nil,
		})
		return nil
	}

	// 获取文件信息
	var file model.File
	err := s.DB.Where("eid = ? AND id = ?", params.Eid, params.FileID).First(&file).Error
	if err != nil {
		errMsg := fmt.Sprintf("获取文件信息失败: %v", err)
		s.Step.CompleteWithError(errMsg)
		return fmt.Errorf("%s", errMsg)
	}

	// 检查是否有停止信号
	err = common.CheckRagTaskStop(file.LibraryID, file.ID)
	if err != nil {
		s.Step.CompleteWithError(err)
		return err
	}

	// 获取分块配置
	configSvc := rag.NewChunkConfigService(s.DB)
	chunkConfig, err := configSvc.GetConfigWithFileID(params.Eid, &file.LibraryID, &params.FileID)
	if err != nil {
		errMsg := fmt.Sprintf("获取分块配置失败: %v", err)
		s.Step.CompleteWithError(errMsg)
		return fmt.Errorf("%s", errMsg)
	}

	// 检查是否开启了AI生成索引逻辑
	if !chunkConfig.EnableAIGeneration() {
		// 没有开启，直接返回成功
		result := CreateAIGenerateIndexTaskResult{
			TaskID:      0,
			Success:     true,
			ChunkConfig: chunkConfig,
		}
		s.Step.CompleteSuccessfully(result)
		return nil
	}

	// 创建AI生成索引任务参数
	taskParams := &AIGenerateIndexParameters{
		Eid:            params.Eid,
		FileID:         params.FileID,
		UserID:         params.UserID,
		RunAIIndexTask: params.RunAIIndexTask,
		Metadata:       s.Job.Metadata,
		OriginStatus:   model.AIGenerateChunkStatusInactive, // 因为是被其他任务调用的，所以从一开始就应该是未激活
	}

	// 序列化参数
	paramsJSON, err := json.Marshal(taskParams)
	if err != nil {
		errMsg := fmt.Sprintf("序列化任务参数失败: %v", err)
		s.Step.CompleteWithError(errMsg)
		return fmt.Errorf("%s", errMsg)
	}

	// 创建任务
	ctx := context.Background()
	factory := model.NewRagJobFactory(s.DB, common.RDB)
	// 更新文件索引状态为pending
	model.UpdateFileAIGenerateChunkStatus(params.FileID, model.AIGenerateChunkStatusPending)
	job, err := factory.CreateJob(ctx, params.Eid, "ai_generate_index", string(paramsJSON))
	if err != nil {
		errMsg := fmt.Sprintf("创建AI生成索引任务失败: %v", err)
		s.Step.CompleteWithError(errMsg)
		return fmt.Errorf("%s", errMsg)
	}

	// 创建结果
	result := CreateAIGenerateIndexTaskResult{
		TaskID:      job.JobID,
		Success:     true,
		ChunkConfig: chunkConfig,
	}

	// 完成步骤并返回结果
	s.Step.CompleteSuccessfully(result)
	return nil
}
