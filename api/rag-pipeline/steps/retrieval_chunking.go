package steps

import (
	"fmt"
	"log"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/rag"
	"gorm.io/gorm"
)

// RetrievalChunkingStep 检索块分块步骤
type RetrievalChunkingStep struct {
	BaseStep
	DB *gorm.DB
}

// RetrievalChunkingParameters 检索块分块步骤的参数
type RetrievalChunkingParameters struct {
	Eid    int64 `json:"eid"`
	FileID int64 `json:"file_id"`
	UserID int64 `json:"user_id"`
}

// RetrievalChunkingResult 检索块分块步骤的结果
type RetrievalChunkingResult struct {
	RetrievalChunkCount int  `json:"retrieval_chunk_count"`
	Success             bool `json:"success"`
}

// NewRetrievalChunkingStep 创建新的检索块分块步骤
func NewRetrievalChunkingStep(db *gorm.DB) *RetrievalChunkingStep {
	return &RetrievalChunkingStep{
		DB: db,
	}
}

// Execute 执行检索块分块步骤
func (s *RetrievalChunkingStep) Execute(parameters any) error {
	s.Step.StartProcessing(parameters)

	// 类型断言获取参数
	params, ok := parameters.(RetrievalChunkingParameters)
	if !ok {
		err := fmt.Errorf("invalid parameters type, expected RetrievalChunkingParameters")
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

	// 使用事务执行检索块分块
	err = s.DB.Transaction(func(tx *gorm.DB) error {
		// 获取文件的所有知识点分块
		knowledgeChunks, err := model.GetDocumentChunksByFileID(params.Eid, params.FileID, 0, 0)
		if err != nil {
			return fmt.Errorf("获取知识点分块失败: %v", err)
		}

		// 过滤出知识点类型的分块
		var knowledgeTypeChunks []model.DocumentChunk
		for _, chunk := range knowledgeChunks {
			if chunk.ChunkType == "knowledge" {
				knowledgeTypeChunks = append(knowledgeTypeChunks, chunk)
			}
		}

		if len(knowledgeTypeChunks) == 0 {
			return fmt.Errorf("文件没有知识点分块")
		}

		// 入队检索块用于向量化
		if err := rag.EnqueueRetrievalChunksByFile(params.Eid, file.ID, file.LibraryID); err != nil {
			return fmt.Errorf("入队检索块失败 - EID:%d FileID:%d LibID:%d", params.Eid, params.FileID, file.LibraryID)
		}

		// 获取分块配置
		libraryID := knowledgeTypeChunks[0].LibraryID
		configSvc := rag.NewChunkConfigService(tx)
		chunkConfig, err := configSvc.GetConfigWithFileID(params.Eid, &libraryID, &params.FileID)
		if err != nil {
			return fmt.Errorf("获取分块配置失败: %v", err)
		}

		// 为每个知识点分块创建检索块
		retrievalSvc := rag.NewRetrievalChunkService(tx)
		for _, knowledgeChunk := range knowledgeTypeChunks {
			// 使用检索服务按配置为该知识点分块创建检索块
			createdChunks, createErr := retrievalSvc.CreateRetrievalChunksForKnowledge(params.Eid, &knowledgeChunk, chunkConfig)
			if createErr != nil {
				return fmt.Errorf("为知识点创建检索块失败: %v", createErr)
			}

			// 为每个检索块创建关联关系
			for _, rc := range createdChunks {
				metadata := &model.RelationMetadataData{
					CreatedReason:  "auto_generated",
					SemanticScore:  1.0,
					PositionScore:  1.0,
					ContentOverlap: 0.8,
				}
				_, relErr := model.CreateChunkRelation(
					params.Eid,
					knowledgeChunk.FileID,
					knowledgeChunk.LibraryID,
					knowledgeChunk.ID,
					rc.ID,
					"auto",
					1.0,
					metadata,
				)
				if relErr != nil {
					// 关联失败记录但不阻断主流程
					fmt.Printf("创建关联关系失败: %v\n", relErr)
				}
			}
		}

		return nil
	})

	if err != nil {
		errMsg := fmt.Sprintf("检索块分块事务失败: %v", err)
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

	// 保存检索块分块状态
	rag.CheckEmbeddingStepStatusSave(params.Eid, params.FileID, "检索块分块完成")

	// 创建结果
	result := RetrievalChunkingResult{
		RetrievalChunkCount: int(count),
		Success:             true,
	}

	// 完成步骤并返回结果
	s.Step.CompleteSuccessfully(result)
	return nil
}
