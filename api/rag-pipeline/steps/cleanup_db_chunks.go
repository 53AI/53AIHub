package steps

import (
	"fmt"
	"log"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

// CleanupDbChunksStep 清理数据库中的Chunk记录步骤
type CleanupDbChunksStep struct {
	BaseStep
	DB *gorm.DB
}

// CleanupDbChunksParameters 清理数据库Chunk步骤的参数
type CleanupDbChunksParameters struct {
	Eid    int64 `json:"eid"`
	FileID int64 `json:"file_id"`
	UserID int64 `json:"user_id"`
}

// CleanupDbChunksResult 清理数据库Chunk步骤的结果
type CleanupDbChunksResult struct {
	DocumentChunksDeleted  int  `json:"document_chunks_deleted"`
	RetrievalChunksDeleted int  `json:"retrieval_chunks_deleted"`
	Success                bool `json:"success"`
}

// NewCleanupDbChunksStep 创建新的清理数据库Chunk步骤
func NewCleanupDbChunksStep(db *gorm.DB) *CleanupDbChunksStep {
	return &CleanupDbChunksStep{
		DB: db,
	}
}

// Execute 执行清理数据库Chunk步骤
func (s *CleanupDbChunksStep) Execute(parameters any) error {
	s.Step.StartProcessing(parameters)

	// 类型断言获取参数
	params, ok := parameters.(CleanupDbChunksParameters)
	if !ok {
		err := fmt.Errorf("invalid parameters type, expected CleanupDbChunksParameters")
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

	// 1. 统计并删除现有的知识点分块
	var docChunkCount int64
	err = s.DB.Model(&model.DocumentChunk{}).
		Where("eid = ? AND file_id = ?", params.Eid, params.FileID).
		Count(&docChunkCount).Error
	if err != nil {
		log.Printf("统计知识点分块数量失败: %v\n", err)
		docChunkCount = 0
	}

	err = s.DB.Where("eid = ? AND file_id = ?", params.Eid, params.FileID).
		Delete(&model.DocumentChunk{}).Error
	if err != nil {
		errMsg := fmt.Sprintf("删除现有知识点分块失败: %v", err)
		s.Step.CompleteWithError(errMsg)
		return fmt.Errorf("%s", errMsg)
	}

	// 2. 统计并删除现有的检索块
	var retrievalChunkCount int64
	err = s.DB.Model(&model.RetrievalChunk{}).
		Where("eid = ? AND file_id = ?", params.Eid, params.FileID).
		Count(&retrievalChunkCount).Error
	if err != nil {
		log.Printf("统计检索块数量失败: %v\n", err)
		retrievalChunkCount = 0
	}

	err = s.DB.Where("eid = ? AND file_id = ?", params.Eid, params.FileID).
		Delete(&model.RetrievalChunk{}).Error
	if err != nil {
		errMsg := fmt.Sprintf("删除现有检索块失败: %v", err)
		s.Step.CompleteWithError(errMsg)
		return fmt.Errorf("%s", errMsg)
	}

	// 创建结果
	result := CleanupDbChunksResult{
		DocumentChunksDeleted:  int(docChunkCount),
		RetrievalChunksDeleted: int(retrievalChunkCount),
		Success:                true,
	}

	// 完成步骤并返回结果
	s.Step.CompleteSuccessfully(result)
	return nil
}
