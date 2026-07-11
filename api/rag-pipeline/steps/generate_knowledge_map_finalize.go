package steps

import (
	"context"
	"fmt"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

// GenerateKnowledgeMapFinalizeStep 生成知识地图完成步骤
type GenerateKnowledgeMapFinalizeStep struct {
	BaseStep
	DB *gorm.DB
}

// GenerateKnowledgeMapFinalizeParameters 生成知识地图完成步骤的参数
type GenerateKnowledgeMapFinalizeParameters struct {
	Eid    int64 `json:"eid"`
	FileID int64 `json:"file_id"`
	UserID int64 `json:"user_id"`
}

// GenerateKnowledgeMapFinalizeResult 生成知识地图完成步骤的结果
type GenerateKnowledgeMapFinalizeResult struct {
	FileID  int64  `json:"file_id"`
	Success bool   `json:"success"`
	Message string `json:"message"`
}

// NewGenerateKnowledgeMapFinalizeStep 创建新的生成知识地图完成步骤
func NewGenerateKnowledgeMapFinalizeStep(db *gorm.DB) *GenerateKnowledgeMapFinalizeStep {
	return &GenerateKnowledgeMapFinalizeStep{
		DB: db,
	}
}

// Execute 执行生成知识地图完成步骤
func (s *GenerateKnowledgeMapFinalizeStep) Execute(parameters any) error {
	s.Step.StartProcessing(parameters)

	// 类型断言获取参数
	params, ok := parameters.(GenerateKnowledgeMapFinalizeParameters)
	if !ok {
		s.Step.CompleteWithError("Invalid parameters type")
		return nil
	}

	logger.Debugf(context.Background(), "[GenerateKnowledgeMapFinalize] 开始完成生成知识地图 - EID: %d, FileID: %d", params.Eid, params.FileID)

	// 获取文件信息
	var file model.File
	err := s.DB.Where("eid = ? AND id = ?", params.Eid, params.FileID).First(&file).Error
	if err != nil {
		errMsg := fmt.Sprintf("获取文件信息失败: %v", err)
		logger.Errorf(context.Background(), "[GenerateKnowledgeMapFinalize] %s", errMsg)
		s.Step.CompleteWithError(errMsg)
		return fmt.Errorf("%s", errMsg)
	}

	if file.KnowledgeMap == "" {
		errMsg := "文件知识地图为空，生成可能失败"
		logger.Warnf(context.Background(), "[GenerateKnowledgeMapFinalize] %s - FileID: %d", errMsg, file.ID)
		result := GenerateKnowledgeMapFinalizeResult{
			FileID:  file.ID,
			Success: false,
			Message: errMsg,
		}
		s.Step.CompleteSuccessfully(result)
		return nil
	}

	logger.Infof(context.Background(), "[GenerateKnowledgeMapFinalize] 成功完成知识地图生成 - FileID: %d, 长度: %d",
		file.ID, len(file.KnowledgeMap))

	result := GenerateKnowledgeMapFinalizeResult{
		FileID:  file.ID,
		Success: true,
		Message: "知识地图生成成功",
	}

	s.Step.CompleteSuccessfully(result)
	return nil
}
