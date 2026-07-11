package steps

import (
	"context"
	"fmt"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

// GenerateKnowledgeMapPrepareStep 生成知识地图准备步骤
type GenerateKnowledgeMapPrepareStep struct {
	BaseStep
	DB *gorm.DB
}

// GenerateKnowledgeMapPrepareParameters 生成知识地图准备步骤的参数
type GenerateKnowledgeMapPrepareParameters struct {
	Eid    int64 `json:"eid"`
	FileID int64 `json:"file_id"`
	UserID int64 `json:"user_id"`
}

// NewGenerateKnowledgeMapPrepareStep 创建新的生成知识地图准备步骤
func NewGenerateKnowledgeMapPrepareStep(db *gorm.DB) *GenerateKnowledgeMapPrepareStep {
	return &GenerateKnowledgeMapPrepareStep{
		DB: db,
	}
}

// Execute 执行生成知识地图准备步骤
func (s *GenerateKnowledgeMapPrepareStep) Execute(parameters any) error {
	s.Step.StartProcessing(parameters)

	// 类型断言获取参数
	params, ok := parameters.(GenerateKnowledgeMapPrepareParameters)
	if !ok {
		s.Step.CompleteWithError("Invalid parameters type")
		return nil
	}

	// 1. 检查配置是否开启知识地图功能
	kmSetting, kmErr := model.ValidateOrCreateKmKnowledgeMapSetting(params.Eid)
	if kmErr != nil {
		errMsg := fmt.Sprintf("获取知识地图配置失败: %v", kmErr)
		logger.Errorf(context.Background(), "%s", errMsg)
		s.Step.CompleteWithError(errMsg)
		return fmt.Errorf("%s", errMsg)
	}

	if !kmSetting.Enabled {
		errMsg := "知识地图功能未开启"
		logger.Warnf(context.Background(), "[GenerateKnowledgeMapPrepare] %s - EID: %d", errMsg, params.Eid)
		s.Step.CompleteWithError(errMsg)
		return fmt.Errorf("%s", errMsg)
	}

	// 2. 获取文件信息
	var file model.File
	err := s.DB.Where("eid = ? AND id = ?", params.Eid, params.FileID).First(&file).Error
	if err != nil {
		errMsg := fmt.Sprintf("获取文件信息失败: %v", err)
		logger.Errorf(context.Background(), "[GenerateKnowledgeMapPrepare] %s", errMsg)
		s.Step.CompleteWithError(errMsg)
		return fmt.Errorf("%s", errMsg)
	}

	// 检查配置（可选，如果需要检查开关）
	// 这里假设在上层已经检查过配置

	// 将必要信息传递给下一个步骤
	result := GenerateKnowledgeMapPrepareParameters{
		Eid:    params.Eid,
		FileID: params.FileID,
		UserID: params.UserID,
	}

	s.Step.CompleteSuccessfully(result)
	return nil
}
