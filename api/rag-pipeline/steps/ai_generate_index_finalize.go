package steps

import (
	"fmt"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

// AIGenerateIndexFinalizeStep AI生成索引增强结束步骤
type AIGenerateIndexFinalizeStep struct {
	BaseStep
	DB *gorm.DB
}

// AIGenerateIndexFinalizeParameters AI生成索引增强结束步骤的参数
type AIGenerateIndexFinalizeParameters struct {
	Eid    int64 `json:"eid"`
	FileID int64 `json:"file_id"`
	UserID int64 `json:"user_id"`
}

// AIGenerateIndexFinalizeResult AI生成索引增强结束步骤的结果
type AIGenerateIndexFinalizeResult struct {
	Success bool `json:"success"`
}

// NewAIGenerateIndexFinalizeStep 创建新的AI生成索引增强结束步骤
func NewAIGenerateIndexFinalizeStep(db *gorm.DB) *AIGenerateIndexFinalizeStep {
	return &AIGenerateIndexFinalizeStep{
		DB: db,
	}
}

// Execute 执行AI生成索引增强结束步骤
func (s *AIGenerateIndexFinalizeStep) Execute(parameters any) error {
	s.Step.StartProcessing(parameters)

	// 类型断言获取参数
	params, ok := parameters.(AIGenerateIndexFinalizeParameters)
	if !ok {
		err := fmt.Errorf("invalid parameters type, expected AIGenerateIndexFinalizeParameters")
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

	// 检查是否有失败的知识点分块
	var failedCount int64
	err = s.DB.Model(&model.DocumentChunk{}).
		Where("eid = ? AND file_id = ? AND chunk_type = 'knowledge' AND ai_generate_doc_chunk_status = ?",
			params.Eid, params.FileID, model.AIGenerateDocChunkStatusFail).
		Count(&failedCount).Error
	if err != nil {
		errMsg := fmt.Sprintf("统计失败的知识点分块数量失败: %v", err)
		s.Step.CompleteWithError(errMsg)
		return fmt.Errorf("%s", errMsg)
	}

	// 更新文件的AIGenerateChunkStatus状态
	var newStatus string
	if failedCount > 0 {
		// 有失败的知识点分块，文件状态设置为failed
		newStatus = model.AIGenerateDocChunkStatusFail
	} else {
		// 没有失败的知识点分块，文件状态设置为normal
		newStatus = model.AIGenerateChunkStatusNormal
	}

	err = s.DB.Model(&model.File{}).
		Where("eid = ? AND id = ?", params.Eid, params.FileID).
		Update("ai_generate_chunk_status", newStatus).Error
	if err != nil {
		errMsg := fmt.Sprintf("更新文件AI生成索引状态失败: %v", err)
		s.Step.CompleteWithError(errMsg)
		return fmt.Errorf("%s", errMsg)
	}

	// 创建结果
	result := AIGenerateIndexFinalizeResult{
		Success: true,
	}

	model.UpdateFileAIGenerateChunkStatus(params.FileID, model.AIGenerateChunkStatusNormal)

	// 完成步骤并返回结果
	s.Step.CompleteSuccessfully(result)
	return nil
}
