package steps

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

// TriggerReIndexStep 触发重新索引流水线步骤
type TriggerReIndexStep struct {
	BaseStep
	DB *gorm.DB
}

// TriggerReIndexParameters 触发重新索引流水线步骤的参数
type TriggerReIndexParameters struct {
	Eid            int64  `json:"eid"`
	FileID         int64  `json:"file_id"`           // 恢复为下划线命名规范
	UserID         int64  `json:"user_id"`           // 恢复为下划线命名规范
	RunAIIndexTask bool   `json:"run_ai_index_task"` // 是否运行AI索引任务
	Metadata       string `json:"metadata"`          // 任务元数据
	OriginStatus   string `json:"origin_status"`     // 原始文件状态
}

// TriggerReIndexResult 触发重新索引流水线步骤的结果
type TriggerReIndexResult struct {
	TaskID  int64 `json:"task_id"` // 创建的任务ID
	Success bool  `json:"success"`
}

// NewTriggerReIndexStep 创建新的触发重新索引流水线步骤
func NewTriggerReIndexStep(db *gorm.DB) *TriggerReIndexStep {
	return &TriggerReIndexStep{
		DB: db,
	}
}

// Execute 执行触发重新索引流水线步骤
func (s *TriggerReIndexStep) Execute(parameters any) error {
	s.Step.StartProcessing(parameters)

	// 类型断言获取参数
	params, ok := parameters.(TriggerReIndexParameters)
	if !ok {
		err := fmt.Errorf("invalid parameters type, expected TriggerReIndexParameters")
		s.Step.CompleteWithError(err.Error())
		return err
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

	// 创建重新索引任务参数
	taskParams := &TriggerReIndexParameters{
		Eid:            params.Eid,
		FileID:         params.FileID,
		UserID:         params.UserID,
		RunAIIndexTask: params.RunAIIndexTask,
		Metadata:       s.Job.Metadata,
		OriginStatus:   model.FileParsingStatusInactive, // 因为是被其他任务调用的，所以从一开始就应该是未激活
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
	// 仅需进行中
	// model.UpdateFileParsingStatus(params.FileID, model.FileParsingStatusPending)
	job, err := factory.CreateJob(ctx, params.Eid, "reindex", string(paramsJSON))
	if err != nil {
		errMsg := fmt.Sprintf("创建重新索引任务失败: %v", err)
		s.Step.CompleteWithError(errMsg)
		return fmt.Errorf("%s", errMsg)
	}

	// 创建结果
	result := TriggerReIndexResult{
		TaskID:  job.JobID,
		Success: true,
	}

	// 完成步骤并返回结果
	s.Step.CompleteSuccessfully(result)
	return nil
}
