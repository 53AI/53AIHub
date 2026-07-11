package steps

import (
	"fmt"

	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

// SetFileStatusStep 设置文件状态步骤
type SetFileStatusStep struct {
	BaseStep
	DB *gorm.DB
}

// SetFileStatusParameters 设置文件状态步骤的参数
type SetFileStatusParameters struct {
	Eid    int64  `json:"eid"`
	FileID int64  `json:"file_id"`
	UserID int64  `json:"user_id"`
	Status string `json:"status"` // 文件解析状态: parsing, normal, fail
}

// SetFileStatusResult 设置文件状态步骤的结果
type SetFileStatusResult struct {
	Success bool `json:"success"`
}

// NewSetFileStatusStep 创建新的设置文件状态步骤
func NewSetFileStatusStep(db *gorm.DB) *SetFileStatusStep {
	return &SetFileStatusStep{
		DB: db,
	}
}

// Execute 执行设置文件状态步骤
func (s *SetFileStatusStep) Execute(parameters any) error {
	s.Step.StartProcessing(parameters)

	// 类型断言获取参数
	params, ok := parameters.(SetFileStatusParameters)
	if !ok {
		err := fmt.Errorf("invalid parameters type, expected SetFileStatusParameters")
		s.Step.CompleteWithError(err.Error())
		return err
	}

	// 设置文件解析状态
	var status string
	switch params.Status {
	case "parsing":
		status = model.FileParsingStatusParsing
	case "normal":
		status = model.FileParsingStatusNormal
	case "fail":
		status = model.FileParsingStatusFail
	default:
		err := fmt.Errorf("invalid file status: %s", params.Status)
		s.Step.CompleteWithError(err.Error())
		return err
	}

	if err := model.UpdateFileParsingStatus(params.FileID, status); err != nil {
		errMsg := fmt.Sprintf("更新文件解析状态失败: %v", err)
		s.Step.CompleteWithError(errMsg)
		return fmt.Errorf("%s", errMsg)
	}

	// 创建结果
	result := SetFileStatusResult{
		Success: true,
	}

	// 完成步骤并返回结果
	s.Step.CompleteSuccessfully(result)
	return nil
}
