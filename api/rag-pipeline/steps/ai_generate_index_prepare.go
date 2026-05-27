package steps

import (
	"fmt"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/rag"
	"gorm.io/gorm"
)

// AIGenerateIndexPrepareStep AI生成索引增强准备步骤
type AIGenerateIndexPrepareStep struct {
	BaseStep
	DB *gorm.DB
}

// AIGenerateIndexPrepareParameters AI生成索引增强准备步骤的参数
type AIGenerateIndexPrepareParameters struct {
	Eid    int64 `json:"eid"`
	FileID int64 `json:"file_id"`
	UserID int64 `json:"user_id"`
}

// AIGenerateIndexPrepareResult AI生成索引增强准备步骤的结果
type AIGenerateIndexPrepareResult struct {
	ShouldGenerate bool `json:"should_generate"` // 是否应该进行AI生成
	Success        bool `json:"success"`
}

// NewAIGenerateIndexPrepareStep 创建新的AI生成索引增强准备步骤
func NewAIGenerateIndexPrepareStep(db *gorm.DB) *AIGenerateIndexPrepareStep {
	return &AIGenerateIndexPrepareStep{
		DB: db,
	}
}

// Execute 执行AI生成索引增强准备步骤
func (s *AIGenerateIndexPrepareStep) Execute(parameters any) error {
	s.Step.StartProcessing(parameters)

	// 类型断言获取参数
	params, ok := parameters.(AIGenerateIndexPrepareParameters)
	if !ok {
		err := fmt.Errorf("invalid parameters type, expected AIGenerateIndexPrepareParameters")
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

	model.UpdateFileAIGenerateChunkStatus(params.FileID, model.AIGenerateChunkStatusParsing)

	// 获取分块配置
	configSvc := rag.NewChunkConfigService(s.DB)
	chunkConfig, err := configSvc.GetConfigWithFileID(params.Eid, &file.LibraryID, &params.FileID)
	if err != nil {
		errMsg := fmt.Sprintf("获取分块配置失败: %v", err)
		s.Step.CompleteWithError(errMsg)
		return fmt.Errorf("%s", errMsg)
	}

	// 判断是否开启了AI生成索引逻辑
	shouldGenerate := chunkConfig.EnableAIGeneration()

	// 创建结果
	result := AIGenerateIndexPrepareResult{
		ShouldGenerate: shouldGenerate,
		Success:        true,
	}

	// 完成步骤并返回结果
	s.Step.CompleteSuccessfully(result)
	return nil
}
