package steps

import (
	"context"
	"fmt"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

// GenerateQuestionsAndSummaryPrepareStep 生成问题和简介准备步骤
type GenerateQuestionsAndSummaryPrepareStep struct {
	BaseStep
	DB *gorm.DB
}

// GenerateQuestionsAndSummaryPrepareParameters 生成问题和简介准备步骤的参数
type GenerateQuestionsAndSummaryPrepareParameters struct {
	Eid    int64 `json:"eid"`
	FileID int64 `json:"file_id"`
	UserID int64 `json:"user_id"`
}

// GenerateQuestionsAndSummaryPrepareResult 生成问题和简介准备步骤的结果
type GenerateQuestionsAndSummaryPrepareResult struct {
	File        *model.File `json:"file"`
	CanGenerate bool        `json:"can_generate"`
}

// NewGenerateQuestionsAndSummaryPrepareStep 创建新的生成问题和简介准备步骤
func NewGenerateQuestionsAndSummaryPrepareStep(db *gorm.DB) *GenerateQuestionsAndSummaryPrepareStep {
	return &GenerateQuestionsAndSummaryPrepareStep{
		DB: db,
	}
}

// Execute 执行生成问题和简介准备步骤
func (s *GenerateQuestionsAndSummaryPrepareStep) Execute(parameters any) error {
	s.Step.StartProcessing(parameters)

	// 类型断言获取参数
	params, ok := parameters.(GenerateQuestionsAndSummaryPrepareParameters)
	if !ok {
		s.Step.CompleteWithError("Invalid parameters type")
		return nil
	}

	logger.Debugf(context.Background(), "[GenerateQuestionsAndSummaryPrepare] 开始处理文件 - EID: %d, FileID: %d", params.Eid, params.FileID)

	// 获取文件信息
	var file model.File
	err := s.DB.Where("eid = ? AND id = ?", params.Eid, params.FileID).First(&file).Error
	if err != nil {
		errMsg := fmt.Sprintf("获取文件信息失败: %v", err)
		logger.Errorf(context.Background(), "[GenerateQuestionsAndSummaryPrepare] %s", errMsg)
		s.Step.CompleteWithError(errMsg)
		return fmt.Errorf("%s", errMsg)
	}

	// 检查是否有停止信号
	err = common.CheckRagTaskStop(file.LibraryID, file.ID)
	if err != nil {
		s.Step.CompleteWithError(err)
		return err
	}

	// 检查文件类型
	if file.Type != model.FILE_TYPE_FILE {
		errMsg := fmt.Sprintf("只能为文件生成问题和简介，当前类型: %d", file.Type)
		logger.Warnf(context.Background(), "[GenerateQuestionsAndSummaryPrepare] %s", errMsg)
		s.Step.CompleteWithError(errMsg)
		return fmt.Errorf("%s", errMsg)
	}

	// 检查是否已生成过问题简介
	if file.AIGenerateSQStatus == model.AIGenerateSQStatusNormal {
		logger.Infof(context.Background(), "[GenerateQuestionsAndSummaryPrepare] 文件已生成过问题和简介，跳过 - FileID: %d", file.ID)
		result := GenerateQuestionsAndSummaryPrepareResult{
			File:        &file,
			CanGenerate: false,
		}
		s.Step.CompleteSuccessfully(result)
		return nil
	}

	logger.Infof(context.Background(), "[GenerateQuestionsAndSummaryPrepare] 准备为文件生成问题和简介 - FileID: %d", file.ID)

	// 创建结果
	result := GenerateQuestionsAndSummaryPrepareResult{
		File:        &file,
		CanGenerate: true,
	}

	// 完成步骤并返回结果
	s.Step.CompleteSuccessfully(result)
	return nil
}
