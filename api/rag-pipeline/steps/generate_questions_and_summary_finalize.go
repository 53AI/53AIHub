package steps

import (
	"context"
	"fmt"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

// GenerateQuestionsAndSummaryFinalizeStep 生成问题和简介完成步骤
type GenerateQuestionsAndSummaryFinalizeStep struct {
	BaseStep
	DB *gorm.DB
}

// GenerateQuestionsAndSummaryFinalizeParameters 生成问题和简介完成步骤的参数
type GenerateQuestionsAndSummaryFinalizeParameters struct {
	Eid    int64 `json:"eid"`
	FileID int64 `json:"file_id"`
	UserID int64 `json:"user_id"`
}

// GenerateQuestionsAndSummaryFinalizeResult 生成问题和简介完成步骤的结果
type GenerateQuestionsAndSummaryFinalizeResult struct {
	FileID  int64  `json:"file_id"`
	Success bool   `json:"success"`
	Status  string `json:"status"`
	Message string `json:"message"`
}

// NewGenerateQuestionsAndSummaryFinalizeStep 创建新的生成问题和简介完成步骤
func NewGenerateQuestionsAndSummaryFinalizeStep(db *gorm.DB) *GenerateQuestionsAndSummaryFinalizeStep {
	return &GenerateQuestionsAndSummaryFinalizeStep{
		DB: db,
	}
}

// Execute 执行生成问题和简介完成步骤
func (s *GenerateQuestionsAndSummaryFinalizeStep) Execute(parameters any) error {
	s.Step.StartProcessing(parameters)

	// 类型断言获取参数
	params, ok := parameters.(GenerateQuestionsAndSummaryFinalizeParameters)
	if !ok {
		s.Step.CompleteWithError("Invalid parameters type")
		return nil
	}

	logger.Debugf(context.Background(), "[GenerateQuestionsAndSummaryFinalize] 开始完成生成问题和简介 - EID: %d, FileID: %d", params.Eid, params.FileID)

	// 直接获取文件信息
	var file model.File
	err := s.DB.Where("eid = ? AND id = ?", params.Eid, params.FileID).First(&file).Error
	if err != nil {
		errMsg := fmt.Sprintf("获取文件信息失败: %v", err)
		logger.Errorf(context.Background(), "[GenerateQuestionsAndSummaryFinalize] %s", errMsg)
		s.Step.CompleteWithError(errMsg)
		return fmt.Errorf("%s", errMsg)
	}

	// 检查是否有停止信号
	err = common.CheckRagTaskStop(file.LibraryID, file.ID)
	if err != nil {
		s.Step.CompleteWithError(err)
		return err
	}

	fileID := file.ID

	// 检查文件状态是否已生成
	if file.AIGenerateSQStatus != model.AIGenerateSQStatusNormal {
		logger.Warnf(context.Background(), "[GenerateQuestionsAndSummaryFinalize] 文件尚未成功生成问题和简介，跳过完成步骤 - FileID: %d, Status: %s", fileID, file.AIGenerateSQStatus)
		result := GenerateQuestionsAndSummaryFinalizeResult{
			FileID:  fileID,
			Success: false,
			Status:  "skipped",
			Message: "文件尚未生成问题和简介",
		}
		s.Step.CompleteSuccessfully(result)
		return nil
	}

	logger.Infof(context.Background(), "[GenerateQuestionsAndSummaryFinalize] 成功完成问题和简介生成 - FileID: %d, 简介长度: %d, 问题数: %d",
		fileID, len(file.Summary), len(file.Questions))

	// 验证文件状态
	err = s.DB.Where("id = ?", fileID).First(&file).Error
	if err != nil {
		errMsg := fmt.Sprintf("获取更新后的文件信息失败: %v", err)
		logger.Errorf(context.Background(), "[GenerateQuestionsAndSummaryFinalize] %s", errMsg)
		s.Step.CompleteWithError(errMsg)
		return fmt.Errorf("%s", errMsg)
	}

	// 检查状态是否正确
	if file.AIGenerateSQStatus != model.AIGenerateSQStatusNormal {
		errMsg := fmt.Sprintf("文件状态不正确，期望: %s, 实际: %s", model.AIGenerateSQStatusNormal, file.AIGenerateSQStatus)
		logger.Warnf(context.Background(), "[GenerateQuestionsAndSummaryFinalize] %s - FileID: %d", errMsg, fileID)
	}

	// 验证生成的内容
	if file.Summary == "" {
		logger.Warnf(context.Background(), "[GenerateQuestionsAndSummaryFinalize] 简介内容为空 - FileID: %d", fileID)
	}

	if file.Questions == "" {
		logger.Warnf(context.Background(), "[GenerateQuestionsAndSummaryFinalize] 问题内容为空 - FileID: %d", fileID)
	}

	// 创建成功结果
	result := GenerateQuestionsAndSummaryFinalizeResult{
		FileID:  fileID,
		Success: true,
		Status:  "completed",
		Message: "问题和简介生成完成",
	}

	logger.Infof(context.Background(), "[GenerateQuestionsAndSummaryFinalize] 流水线执行完成 - FileID: %d", fileID)

	// 完成步骤并返回结果
	s.Step.CompleteSuccessfully(result)
	return nil
}
