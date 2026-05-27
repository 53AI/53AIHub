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

// TriggerGenerateKnowledgeMapStep 触发生成知识地图流水线步骤
type TriggerGenerateKnowledgeMapStep struct {
	BaseStep
	DB *gorm.DB
}

// TriggerGenerateKnowledgeMapParameters 触发生成知识地图流水线步骤的参数
type TriggerGenerateKnowledgeMapParameters struct {
	Eid      int64  `json:"eid"`
	FileID   int64  `json:"file_id"`
	UserID   int64  `json:"user_id"`
	Metadata string `json:"metadata"`
}

// TriggerGenerateKnowledgeMapResult 触发生成知识地图流水线步骤的结果
type TriggerGenerateKnowledgeMapResult struct {
	TaskID  int64 `json:"task_id"` // 创建的任务ID
	Success bool  `json:"success"`
}

// NewTriggerGenerateKnowledgeMapStep 创建新的触发生成知识地图流水线步骤
func NewTriggerGenerateKnowledgeMapStep(db *gorm.DB) *TriggerGenerateKnowledgeMapStep {
	return &TriggerGenerateKnowledgeMapStep{
		DB: db,
	}
}

// Execute 执行触发生成知识地图流水线步骤
func (s *TriggerGenerateKnowledgeMapStep) Execute(parameters any) error {
	s.Step.StartProcessing(parameters)

	// 类型断言获取参数
	params, ok := parameters.(TriggerGenerateKnowledgeMapParameters)
	if !ok {
		err := fmt.Errorf("invalid parameters type, expected TriggerGenerateKnowledgeMapParameters")
		s.Step.CompleteWithError(err.Error())
		return err
	}

	ctx := context.Background()

	// 1. 检查配置是否开启自动生成
	kmSetting, kmErr := model.ValidateOrCreateKmKnowledgeMapSetting(params.Eid)
	if kmErr != nil {
		errMsg := fmt.Sprintf("获取知识地图配置失败: %v", kmErr)
		logger.Errorf(ctx, "%s", errMsg)
		s.Step.CompleteWithError(errMsg)
		return nil // 即使失败也返回nil，不阻塞主流程
	}

	if kmSetting == nil || !kmSetting.Enabled || !kmSetting.AutoGenerate {
		s.Step.CompleteSuccessfully(TriggerGenerateKnowledgeMapResult{Success: false})
		return nil
	}

	// 2. 增加并发锁，防止重复触发
	lockKey := fmt.Sprintf("generate_knowledge_map:%d", params.FileID)
	if !common.LOCKER.TryLock(lockKey, 5*time.Second) {
		s.Step.CompleteSuccessfully(TriggerGenerateKnowledgeMapResult{Success: false})
		return nil
	}

	// 3. 检查是否已有正在运行的同类型任务
	var existingJob model.RagJob
	findErr := s.DB.Where("eid = ? AND type = ? AND related_id = ? AND status IN ?",
		params.Eid, "generate_knowledge_map", params.FileID, []string{model.RagJobStatusPending, model.RagJobStatusProcessing}).
		First(&existingJob).Error

	if findErr == nil {
		// 已有任务在运行
		s.Step.CompleteSuccessfully(TriggerGenerateKnowledgeMapResult{TaskID: existingJob.JobID, Success: true})
		return nil
	}

	if !errors.Is(findErr, gorm.ErrRecordNotFound) {
		errMsg := fmt.Sprintf("检查知识地图任务状态失败: %v", findErr)
		logger.Errorf(ctx, "%s", errMsg)
		s.Step.CompleteWithError(errMsg)
		return nil
	}

	// 4. 创建任务
	factory := model.NewRagJobFactory(s.DB, common.RDB)
	startParams := map[string]interface{}{
		"eid":      params.Eid,
		"file_id":  params.FileID,
		"user_id":  params.UserID,
		"metadata": params.Metadata,
	}
	startParamsJSON, marshalErr := json.Marshal(startParams)
	if marshalErr != nil {
		errMsg := fmt.Sprintf("自动生成知识地图任务参数序列化失败: %v", marshalErr)
		logger.Errorf(ctx, "%s", errMsg)
		s.Step.CompleteWithError(errMsg)
		return nil
	}

	job, createErr := factory.CreateJob(ctx, params.Eid, "generate_knowledge_map", string(startParamsJSON))
	if createErr != nil {
		errMsg := fmt.Sprintf("自动生成知识地图任务创建失败: %v", createErr)
		logger.Errorf(ctx, "%s", errMsg)
		s.Step.CompleteWithError(errMsg)
		return nil
	}

	// 5. 记录统计次数
	if incErr := model.IncrementKmKnowledgeMapField(params.Eid, model.KmKnowledgeMapStatFieldGenerateCount, 1); incErr != nil {
		logger.Errorf(ctx, "记录知识地图生成次数失败: %v", incErr)
	}

	// 完成步骤并返回结果
	result := TriggerGenerateKnowledgeMapResult{
		TaskID:  job.JobID,
		Success: true,
	}
	s.Step.CompleteSuccessfully(result)
	return nil
}
