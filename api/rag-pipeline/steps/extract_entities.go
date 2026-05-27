package steps

import (
	"context"
	"fmt"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/service/rag"
	"gorm.io/gorm"
)

// ExtractEntitiesStep 抽取实体步骤
type ExtractEntitiesStep struct {
	BaseStep
	DB *gorm.DB
}

// ExtractEntitiesParameters 抽取实体步骤参数
type ExtractEntitiesParameters struct {
	Eid      int64                 `json:"eid"`
	FileID   int64                 `json:"file_id"`
	UserID   int64                 `json:"user_id"`
	Entities []rag.ExtractedEntity `json:"entities"` // 如果已经生成了实体，直接传递
}

// ExtractEntitiesResult 抽取实体步骤结果
type ExtractEntitiesResult struct {
	Success bool  `json:"success"`
	FileID  int64 `json:"file_id"`
}

// NewExtractEntitiesStep 创建新的抽取实体步骤
func NewExtractEntitiesStep(db *gorm.DB) *ExtractEntitiesStep {
	return &ExtractEntitiesStep{
		DB: db,
	}
}

// Execute 执行抽取实体步骤
func (s *ExtractEntitiesStep) Execute(parameters any) error {
	s.Step.StartProcessing(parameters)

	params, ok := parameters.(ExtractEntitiesParameters)
	if !ok {
		err := fmt.Errorf("invalid parameters type, expected ExtractEntitiesParameters")
		s.Step.CompleteWithError(err.Error())
		return err
	}

	logger.SysLogf("开始抽取实体: eid=%d file_id=%d", params.Eid, params.FileID)

	// 1. 保存传入的实体（如果有）
	extractor := rag.NewEntityExtractionService(s.DB)
	if len(params.Entities) > 0 {
		if err := extractor.StoreForFileExtractedEntities(context.Background(), params.Eid, params.FileID, params.Entities); err != nil {
			logger.Errorf(context.Background(), "存储实体失败: %v", err)
			// 即使失败也继续执行，尝试元数据实体抽取
		}
	}

	// 2. 执行基于路径的实体生成（元信息实体）
	if err := extractor.ExtractAndStoreForFileMeta(context.Background(), params.Eid, params.FileID); err != nil {
		errMsg := fmt.Sprintf("生成基于路径的实体失败: %v", err)
		logger.Errorf(context.Background(), "%s", errMsg)
		// 这是一个非阻塞错误，记录日志即可
	}

	logger.SysLogf("抽取实体完成: file_id=%d", params.FileID)
	s.Step.CompleteSuccessfully(ExtractEntitiesResult{
		Success: true,
		FileID:  params.FileID,
	})
	return nil
}
