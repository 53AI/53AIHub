package steps

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

// TriggerGenerateQuestionsAndSummaryStep 触发生成问答和摘要流水线步骤
type TriggerGenerateQuestionsAndSummaryStep struct {
	BaseStep
	DB *gorm.DB
}

// TriggerGenerateQuestionsAndSummaryParameters 触发生成问答和摘要流水线步骤的参数
type TriggerGenerateQuestionsAndSummaryParameters struct {
	Eid      int64  `json:"eid"`
	FileID   int64  `json:"file_id"`
	UserID   int64  `json:"user_id"`
	Metadata string `json:"metadata"`
}

// TriggerGenerateQuestionsAndSummaryResult 触发生成问答和摘要流水线步骤的结果
type TriggerGenerateQuestionsAndSummaryResult struct {
	TaskID  int64 `json:"task_id"` // 创建的任务ID
	Success bool  `json:"success"`
}

// NewTriggerGenerateQuestionsAndSummaryStep 创建新的触发生成问答和摘要流水线步骤
func NewTriggerGenerateQuestionsAndSummaryStep(db *gorm.DB) *TriggerGenerateQuestionsAndSummaryStep {
	return &TriggerGenerateQuestionsAndSummaryStep{
		DB: db,
	}
}

// Execute 执行触发生成问答和摘要流水线步骤
func (s *TriggerGenerateQuestionsAndSummaryStep) Execute(parameters any) error {
	s.Step.StartProcessing(parameters)

	// 类型断言获取参数
	params, ok := parameters.(TriggerGenerateQuestionsAndSummaryParameters)
	if !ok {
		err := fmt.Errorf("invalid parameters type, expected TriggerGenerateQuestionsAndSummaryParameters")
		s.Step.CompleteWithError(err.Error())
		return err
	}

	ctx := context.Background()

	// 1. 增加并发锁，防止重复触发
	lockKey := fmt.Sprintf("generate_questions_and_summary:%d", params.FileID)
	if !common.LOCKER.TryLock(lockKey, 5*time.Second) {
		s.Step.CompleteSuccessfully(TriggerGenerateQuestionsAndSummaryResult{Success: false})
		return nil
	}

	// 2. 检查是否已有正在运行的同类型任务
	var existingJob model.RagJob
	findErr := s.DB.Where("eid = ? AND type = ? AND related_id = ? AND status IN ?",
		params.Eid, "generate_questions_and_summary", params.FileID, []string{model.RagJobStatusPending, model.RagJobStatusProcessing}).
		First(&existingJob).Error

	if findErr == nil {
		// 已有任务在运行
		s.Step.CompleteSuccessfully(TriggerGenerateQuestionsAndSummaryResult{TaskID: existingJob.JobID, Success: true})
		return nil
	}

	if !errors.Is(findErr, gorm.ErrRecordNotFound) {
		errMsg := fmt.Sprintf("检查生成问答和摘要任务状态失败: %v", findErr)
		logger.Errorf(ctx, "%s", errMsg)
		s.Step.CompleteWithError(errMsg)
		return nil
	}

	// 3. 创建任务
	factory := model.NewRagJobFactory(s.DB, common.RDB)
	startParams := map[string]interface{}{
		"eid":      params.Eid,
		"file_id":  params.FileID,
		"user_id":  params.UserID,
		"metadata": params.Metadata,
	}
	startParamsJSON, marshalErr := json.Marshal(startParams)
	if marshalErr != nil {
		errMsg := fmt.Sprintf("自动生成问答和摘要任务参数序列化失败: %v", marshalErr)
		logger.Errorf(ctx, "%s", errMsg)
		s.Step.CompleteWithError(errMsg)
		return nil
	}

	job, createErr := factory.CreateJob(ctx, params.Eid, "generate_questions_and_summary", string(startParamsJSON))
	if createErr != nil {
		errMsg := fmt.Sprintf("自动生成问答和摘要任务创建失败: %v", createErr)
		logger.Errorf(ctx, "%s", errMsg)
		s.Step.CompleteWithError(errMsg)
		return nil
	}

	// 完成步骤并返回结果
	result := TriggerGenerateQuestionsAndSummaryResult{
		TaskID:  job.JobID,
		Success: true,
	}
	s.Step.CompleteSuccessfully(result)
	return nil
}
