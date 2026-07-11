package steps

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/rag"
	"gorm.io/gorm"
)

// GenerateQuestionsAndSummaryGenerateStep 生成问题和简介生成步骤
type GenerateQuestionsAndSummaryGenerateStep struct {
	BaseStep
	DB *gorm.DB
}

// GenerateQuestionsAndSummaryGenerateParameters 生成问题和简介生成步骤的参数
type GenerateQuestionsAndSummaryGenerateParameters struct {
	Eid    int64 `json:"eid"`
	FileID int64 `json:"file_id"`
	UserID int64 `json:"user_id"`
}

// GenerateQuestionsAndSummaryGenerateResult 生成问题和简介生成步骤的结果
type GenerateQuestionsAndSummaryGenerateResult struct {
	File      *model.File           `json:"file"`
	Success   bool                  `json:"success"`
	Summary   string                `json:"summary"`
	Questions []string              `json:"questions"`
	Entities  []rag.ExtractedEntity `json:"entities"`
}

// NewGenerateQuestionsAndSummaryGenerateStep 创建新的生成问题和简介生成步骤
func NewGenerateQuestionsAndSummaryGenerateStep(db *gorm.DB) *GenerateQuestionsAndSummaryGenerateStep {
	return &GenerateQuestionsAndSummaryGenerateStep{
		DB: db,
	}
}

// Execute 执行生成问题和简介生成步骤
func (s *GenerateQuestionsAndSummaryGenerateStep) Execute(parameters any) error {
	s.Step.StartProcessing(parameters)

	// 类型断言获取参数
	params, ok := parameters.(GenerateQuestionsAndSummaryGenerateParameters)
	if !ok {
		s.Step.CompleteWithError("Invalid parameters type")
		return nil
	}

	logger.Debugf(context.Background(), "[GenerateQuestionsAndSummaryGenerate] 开始生成问题和简介 - EID: %d, FileID: %d", params.Eid, params.FileID)

	// 直接获取文件信息
	var file model.File
	err := s.DB.Where("eid = ? AND id = ?", params.Eid, params.FileID).First(&file).Error
	if err != nil {
		errMsg := fmt.Sprintf("获取文件信息失败: %v", err)
		logger.Errorf(context.Background(), "[GenerateQuestionsAndSummaryGenerate] %s", errMsg)
		s.Step.CompleteWithError(errMsg)
		return fmt.Errorf("%s", errMsg)
	}
	// 检查是否有停止信号
	err = common.CheckRagTaskStop(file.LibraryID, file.ID)
	if err != nil {
		s.Step.CompleteWithError(err)
		return err
	}

	// 检查文件是否需要生成问题和简介
	if file.AIGenerateSQStatus == model.AIGenerateSQStatusNormal {
		logger.Infof(context.Background(), "[GenerateQuestionsAndSummaryGenerate] 文件已生成过问题和简介，跳过 - FileID: %d", file.ID)
		result := GenerateQuestionsAndSummaryGenerateResult{
			File:    &file,
			Success: true,
		}
		s.Step.CompleteSuccessfully(result)
		return nil
	}

	// 获取文件内容
	fileBody, err := model.GetLastFileBodyByFileID(params.Eid, file.ID)
	if err != nil {
		errMsg := fmt.Sprintf("获取文件内容失败: %v", err)
		logger.Errorf(context.Background(), "[GenerateQuestionsAndSummaryGenerate] %s", errMsg)
		s.Step.CompleteWithError(errMsg)
		return fmt.Errorf("%s", errMsg)
	}
	content, err := fileBody.GetContent()
	if err != nil {
		errMsg := fmt.Sprintf("获取文件内容失败: %v", err)
		logger.Errorf(context.Background(), "[GenerateQuestionsAndSummaryGenerate] %s", errMsg)
		s.Step.CompleteWithError(errMsg)
		return fmt.Errorf("%s", errMsg)
	}

	if fileBody == nil || content == "" {
		errMsg := "文件内容为空，无法生成问题和简介"
		logger.Warnf(context.Background(), "[GenerateQuestionsAndSummaryGenerate] %s - FileID: %d", errMsg, file.ID)
		s.Step.CompleteWithError(errMsg)
		return fmt.Errorf("%s", errMsg)
	}

	logger.Debugf(context.Background(), "[GenerateQuestionsAndSummaryGenerate] 文件内容长度: %d - FileID: %d", len(content), file.ID)

	// 更新文件状态为正在生成
	err = model.UpdateFileAIGenerateSQStatus(file.ID, model.AIGenerateSQStatusParsing)
	if err != nil {
		errMsg := fmt.Sprintf("更新文件状态失败: %v", err)
		logger.Errorf(context.Background(), "[GenerateQuestionsAndSummaryGenerate] %s", errMsg)
		s.Step.CompleteWithError(errMsg)
		return fmt.Errorf("%s", errMsg)
	}

	// 获取分块配置
	configService := rag.NewChunkConfigService(s.DB)
	chunkConfig, err := configService.GetConfigWithFileID(params.Eid, &file.LibraryID, &file.ID)
	if err != nil {
		errMsg := fmt.Sprintf("获取分块配置失败: %v", err)
		logger.Errorf(context.Background(), "[GenerateQuestionsAndSummaryGenerate] %s", errMsg)
		// 更新状态为失败
		if updateErr := model.UpdateFileAIGenerateSQStatus(file.ID, model.AIGenerateSQStatusFail); updateErr != nil {
			logger.Errorf(context.Background(), "[GenerateQuestionsAndSummaryGenerate] 更新失败状态也出错: %v", updateErr)
		}
		s.Step.CompleteWithError(errMsg)
		return fmt.Errorf("%s", errMsg)
	}

	if chunkConfig == nil || chunkConfig.LogicChannel == nil {
		errMsg := "未配置逻辑推理渠道，无法生成问题和简介"
		logger.Warnf(context.Background(), "[GenerateQuestionsAndSummaryGenerate] %s - FileID: %d", errMsg, file.ID)
		// 更新状态为失败
		if updateErr := model.UpdateFileAIGenerateSQStatus(file.ID, model.AIGenerateSQStatusFail); updateErr != nil {
			logger.Errorf(context.Background(), "[GenerateQuestionsAndSummaryGenerate] 更新失败状态也出错: %v", updateErr)
		}
		s.Step.CompleteWithError(errMsg)
		return fmt.Errorf("%s", errMsg)
	}

	// 创建内容生成器
	contentGenerator := rag.NewContentGeneratorService(s.DB)

	// 创建生成请求
	request := &rag.GenerateQuestionsAndSummaryRequest{
		Content: content,
	}

	// 调用生成方法
	response, err := contentGenerator.GenerateQuestionsSummaryAndEntities(context.Background(), params.Eid, chunkConfig, request)
	if err != nil {
		errMsg := fmt.Sprintf("生成问题和简介失败: %v", err)
		logger.Errorf(context.Background(), "[GenerateQuestionsAndSummaryGenerate] %s - FileID: %d", errMsg, file.ID)
		// 更新状态为失败
		if updateErr := model.UpdateFileAIGenerateSQStatus(file.ID, model.AIGenerateSQStatusFail); updateErr != nil {
			logger.Errorf(context.Background(), "[GenerateQuestionsAndSummaryGenerate] 更新失败状态也出错: %v", updateErr)
		}
		s.Step.CompleteWithError(errMsg)
		return fmt.Errorf("%s", errMsg)
	}

	logger.Infof(context.Background(), "[GenerateQuestionsAndSummaryGenerate] 成功生成问题和简介 - FileID: %d, 问题数: %d, 简介长度: %d",
		file.ID, len(response.Questions), len(response.Summary))

	// 将结果序列化为JSON以便存储
	questionsJSON, _ := json.Marshal(response.Questions)

	// 更新文件信息
	updateData := map[string]interface{}{
		"ai_generate_sq_status": model.AIGenerateSQStatusNormal,
		"summary":               response.Summary,
		"questions":             string(questionsJSON),
	}

	err = s.DB.Model(&model.File{}).Where("id = ?", file.ID).Updates(updateData).Error
	if err != nil {
		errMsg := fmt.Sprintf("更新文件生成结果失败: %v", err)
		logger.Errorf(context.Background(), "[GenerateQuestionsAndSummaryGenerate] %s - FileID: %d", errMsg, file.ID)
		// 更新状态为失败
		if updateErr := model.UpdateFileAIGenerateSQStatus(file.ID, model.AIGenerateSQStatusFail); updateErr != nil {
			logger.Errorf(context.Background(), "[GenerateQuestionsAndSummaryGenerate] 更新失败状态也出错: %v", updateErr)
		}
		s.Step.CompleteWithError(errMsg)
		return fmt.Errorf("%s", errMsg)
	}

	// 创建结果
	result := GenerateQuestionsAndSummaryGenerateResult{
		File:      &file,
		Success:   true,
		Summary:   response.Summary,
		Questions: response.Questions,
		Entities:  response.Entities,
	}

	// 完成步骤并返回结果
	s.Step.CompleteSuccessfully(result)
	return nil
}
