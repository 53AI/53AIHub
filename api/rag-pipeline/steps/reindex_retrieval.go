package steps

import (
	"fmt"
	"log"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/rag"
	"gorm.io/gorm"
)

// ReindexRetrievalStep 重新索引检索块步骤
type ReindexRetrievalStep struct {
	BaseStep
	DB *gorm.DB
}

// ReindexRetrievalParameters 重新索引检索块步骤的参数
type ReindexRetrievalParameters struct {
	Eid    int64 `json:"eid"`
	FileID int64 `json:"file_id"`
	UserID int64 `json:"user_id"`
}

// ReindexRetrievalResult 重新索引检索块步骤的结果
type ReindexRetrievalResult struct {
	RetrievalChunkCount int  `json:"retrieval_chunk_count"`
	Success             bool `json:"success"`
}

// NewReindexRetrievalStep 创建新的重新索引检索块步骤
func NewReindexRetrievalStep(db *gorm.DB) *ReindexRetrievalStep {
	return &ReindexRetrievalStep{
		DB: db,
	}
}

// Execute 执行重新索引检索块步骤
func (s *ReindexRetrievalStep) Execute(parameters any) error {
	s.Step.StartProcessing(parameters)

	// 类型断言获取参数
	params, ok := parameters.(ReindexRetrievalParameters)
	if !ok {
		err := fmt.Errorf("invalid parameters type, expected ReindexRetrievalParameters")
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

	// 使用 chunkerService 重新索引文档
	chunkerService := rag.NewChunkerService(s.DB)
	err = chunkerService.ReindexDocument(params.Eid, params.FileID)
	if err != nil {
		errMsg := fmt.Sprintf("重新索引检索块失败: %v", err)
		s.Step.CompleteWithError(errMsg)
		return fmt.Errorf("%s", errMsg)
	}

	// 统计检索块数量
	var count int64
	err = s.DB.Model(&model.RetrievalChunk{}).
		Where("eid = ? AND file_id = ?", params.Eid, params.FileID).
		Count(&count).Error
	if err != nil {
		log.Printf("统计检索块数量失败: %v\n", err)
		count = 0
	}

	// 创建结果
	result := ReindexRetrievalResult{
		RetrievalChunkCount: int(count),
		Success:             true,
	}

	// 完成步骤并返回结果
	s.Step.CompleteSuccessfully(result)
	return nil
}
