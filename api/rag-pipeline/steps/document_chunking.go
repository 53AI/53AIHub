package steps

import (
	"context"
	"fmt"
	"log"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/rag"
	"gorm.io/gorm"
)

// DocumentChunkingStep 文档分块步骤
type DocumentChunkingStep struct {
	BaseStep
	DB *gorm.DB
}

// DocumentChunkingParameters 文档分块步骤的参数
type DocumentChunkingParameters struct {
	Eid    int64 `json:"eid"`
	FileID int64 `json:"file_id"`
	UserID int64 `json:"user_id"`
}

// DocumentChunkingResult 文档分块步骤的结果
type DocumentChunkingResult struct {
	DocumentChunkCount int  `json:"document_chunk_count"`
	Success            bool `json:"success"`
}

// NewDocumentChunkingStep 创建新的文档分块步骤
func NewDocumentChunkingStep(db *gorm.DB) *DocumentChunkingStep {
	return &DocumentChunkingStep{
		DB: db,
	}
}

// Execute 执行文档分块步骤
func (s *DocumentChunkingStep) Execute(parameters any) error {
	s.Step.StartProcessing(parameters)

	// 类型断言获取参数
	params, ok := parameters.(DocumentChunkingParameters)
	if !ok {
		err := fmt.Errorf("invalid parameters type, expected DocumentChunkingParameters")
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

	// 获取文件内容
	var fileBody model.FileBody
	err = s.DB.Where("eid = ? AND file_id = ?", params.Eid, params.FileID).Last(&fileBody).Error
	if err != nil {
		errMsg := fmt.Sprintf("获取文件内容失败: %v", err)
		s.Step.CompleteWithError(errMsg)
		return fmt.Errorf("%s", errMsg)
	}

	// 使用事务执行文档分块
	var chunkResult *rag.ChunkResult
	err = s.DB.Transaction(func(tx *gorm.DB) error {
		content, err := fileBody.GetContent()
		if err != nil {
			return fmt.Errorf("获取文件内容失败: %v", err)
		}
		// 创建临时的chunker服务使用事务
		chunkerService := rag.NewChunkerService(tx)

		// 执行文档分块
		chunkResult, err = chunkerService.ChunkDocument(params.Eid, params.FileID, content, nil)
		if err != nil {
			return fmt.Errorf("文档分块失败: %v", err)
		}

		// 保存分块
		_, err = chunkerService.SaveChunksInTransaction(tx, params.Eid, params.FileID, chunkResult.Chunks)
		if err != nil {
			return fmt.Errorf("保存分块失败: %v", err)
		}

		return nil
	})

	if err != nil {
		errMsg := fmt.Sprintf("文档分块事务失败: %v", err)
		s.Step.CompleteWithError(errMsg)
		return fmt.Errorf("%s", errMsg)
	}

	// 统计知识点分块数量
	var count int64
	err = s.DB.Model(&model.DocumentChunk{}).
		Where("eid = ? AND file_id = ? AND chunk_type = 'knowledge'", params.Eid, params.FileID).
		Count(&count).Error
	if err != nil {
		log.Printf("统计知识点分块数量失败: %v\n", err)
		count = 0
	}

	// 保存分块状态
	rag.CheckEmbeddingStepStatusSave(params.Eid, params.FileID, "文档分块完成")

	// 抽取实体（仅 knowledge chunks，失败不阻断分块流程）
	if entityExtractionEnabled := false; entityExtractionEnabled {
		var knowledgeChunks []model.DocumentChunk
		if err := s.DB.Select("id", "eid", "file_id", "library_id", "content", "chunk_type", "chunk_config_id").
			Where("eid = ? AND file_id = ? AND chunk_type = 'knowledge'", params.Eid, params.FileID).
			Order("chunk_index asc").
			Find(&knowledgeChunks).Error; err != nil {
			log.Printf("查询知识分块失败: %v\n", err)
		} else {
			extractor := rag.NewEntityExtractionService(s.DB)
			for i := range knowledgeChunks {
				if err := common.CheckRagTaskStop(file.LibraryID, file.ID); err != nil {
					s.Step.CompleteWithError(err)
					return err
				}
				if err := extractor.ExtractAndStoreForChunk(context.Background(), params.Eid, &knowledgeChunks[i]); err != nil {
					log.Printf("实体抽取失败 chunk_id=%d: %v\n", knowledgeChunks[i].ID, err)
				}
			}
		}
	}

	// 创建结果
	result := DocumentChunkingResult{
		DocumentChunkCount: int(count),
		Success:            true,
	}

	// 完成步骤并返回结果
	s.Step.CompleteSuccessfully(result)
	return nil
}
