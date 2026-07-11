package steps

import (
	"context"
	"fmt"
	"log"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/rag"
	"gorm.io/gorm"
)

// AIGenerateIndexStep AI生成索引增强步骤
type AIGenerateIndexStep struct {
	BaseStep
	DB *gorm.DB
}

// AIGenerateIndexParameters AI生成索引增强步骤的参数
type AIGenerateIndexParameters struct {
	Eid            int64  `json:"eid"`
	FileID         int64  `json:"file_id"`
	UserID         int64  `json:"user_id"`
	RunAIIndexTask bool   `json:"run_ai_index_task"` // 是否运行AI索引任务
	Metadata       string `json:"metadata"`          // 任务元数据
	OriginStatus   string `json:"origin_status"`     // 原始文件状态
}

// AIGenerateIndexResult AI生成索引增强步骤的结果
type AIGenerateIndexResult struct {
	ProcessedChunkCount int  `json:"processed_chunk_count"`
	Success             bool `json:"success"`
}

// NewAIGenerateIndexStep 创建新的AI生成索引增强步骤
func NewAIGenerateIndexStep(db *gorm.DB) *AIGenerateIndexStep {
	return &AIGenerateIndexStep{
		DB: db,
	}
}

// Execute 执行AI生成索引增强步骤
func (s *AIGenerateIndexStep) Execute(parameters any) error {
	s.Step.StartProcessing(parameters)

	// 类型断言获取参数
	params, ok := parameters.(AIGenerateIndexParameters)
	if !ok {
		// 获取实际参数类型信息
		actualType := fmt.Sprintf("%T", parameters)
		err := fmt.Errorf("invalid parameters type, expected AIGenerateIndexParameters, got %s", actualType)
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

	// 获取文件的所有知识点分块
	knowledgeChunks, err := model.GetDocumentChunksByFileID(params.Eid, params.FileID, 0, 0)
	if err != nil {
		errMsg := fmt.Sprintf("获取知识点分块失败: %v", err)
		s.Step.CompleteWithError(errMsg)
		return fmt.Errorf("%s", errMsg)
	}

	// 过滤出知识点类型的分块
	var knowledgeTypeChunks []model.DocumentChunk
	for _, chunk := range knowledgeChunks {
		if chunk.ChunkType == "knowledge" {
			knowledgeTypeChunks = append(knowledgeTypeChunks, chunk)
		}
	}

	if len(knowledgeTypeChunks) == 0 {
		errMsg := "文件没有知识点分块"
		s.Step.CompleteWithError(errMsg)
		return fmt.Errorf("%s", errMsg)
	}

	// 获取分块配置
	libraryID := knowledgeTypeChunks[0].LibraryID
	configSvc := rag.NewChunkConfigService(s.DB)
	chunkConfig, err := configSvc.GetConfigWithFileID(params.Eid, &libraryID, &params.FileID)
	if err != nil {
		errMsg := fmt.Sprintf("获取分块配置失败: %v", err)
		s.Step.CompleteWithError(errMsg)
		return fmt.Errorf("%s", errMsg)
	}

	// 检查是否开启了AI生成索引逻辑
	if !chunkConfig.EnableAIGeneration() {
		// 没有开启，直接返回成功
		result := AIGenerateIndexResult{
			ProcessedChunkCount: 0,
			Success:             true,
		}
		model.UpdateFileAIGenerateChunkStatus(params.FileID, model.AIGenerateChunkStatusInactive)

		s.Step.CompleteSuccessfully(result)
		return nil
	}

	// 使用事务执行AI生成索引增强
	err = s.DB.Transaction(func(tx *gorm.DB) error {
		// 创建内容生成器
		contentGenerator := rag.NewContentGeneratorService(tx)

		// 逐块进行生成
		for _, knowledgeChunk := range knowledgeTypeChunks {
			// 检查是否有停止信号
			err = common.CheckRagTaskStop(file.LibraryID, file.ID)
			if err != nil {
				s.Step.CompleteWithError(err)
				return err
			}
			// 如果以前创建过，需要重新从pending开始重新生成
			if knowledgeChunk.AIGenerateDocChunkStatus == model.AIGenerateDocChunkStatusNormal {
				// 重置状态为pending
				err := tx.Model(&model.DocumentChunk{}).
					Where("id = ?", knowledgeChunk.ID).
					Update("ai_generate_doc_chunk_status", model.AIGenerateDocChunkStatusInactive).Error
				if err != nil {
					return fmt.Errorf("重置知识点分块AI生成状态失败: %v", err)
				}
				knowledgeChunk.AIGenerateDocChunkStatus = model.AIGenerateDocChunkStatusParsing
			}

			// 只有状态为pending的知识点分块才需要生成
			if knowledgeChunk.AIGenerateDocChunkStatus == model.AIGenerateDocChunkStatusParsing {
				// 更新状态为parsing
				err := tx.Model(&model.DocumentChunk{}).
					Where("id = ?", knowledgeChunk.ID).
					Update("ai_generate_doc_chunk_status", model.AIGenerateDocChunkStatusParsing).Error
				if err != nil {
					return fmt.Errorf("更新知识点分块AI生成状态为parsing失败: %v", err)
				}

				// 调用contentGenerator.GenerateContentForKnowledgeChunk生成内容
				summaries, questions, err := contentGenerator.GenerateContentForKnowledgeChunk(context.Background(), params.Eid, chunkConfig, knowledgeChunk.Content)
				if err != nil {
					// 更新状态为failed
					updateErr := tx.Model(&model.DocumentChunk{}).
						Where("id = ?", knowledgeChunk.ID).
						Update("ai_generate_doc_chunk_status", model.AIGenerateDocChunkStatusFail).Error
					if updateErr != nil {
						log.Printf("更新知识点分块AI生成状态为failed失败: %v\n", updateErr)
					}
					return fmt.Errorf("生成知识点分块AI内容失败: %v", err)
				}

				// 查询当前知识点下最大的检索块序号
				var maxIndex int
				err = tx.Model(&model.RetrievalChunk{}).
					Where("knowledge_chunk_id = ?", knowledgeChunk.ID).
					Order("chunk_index DESC").
					Limit(1).
					Pluck("chunk_index", &maxIndex).Error
				if err != nil {
					return fmt.Errorf("查询知识点分块最大索引块序号失败: %v", err)
				}

				s := rag.NewRetrievalChunkService(tx)
				additionalChunks := s.CreateAdditionalRetrievalChunks(
					knowledgeChunk.Eid, &knowledgeChunk, summaries,
					questions, chunkConfig, maxIndex)
				if len(additionalChunks) > 0 {
					// 保存额外的检索块
					err = rag.SaveRetrievalChunksWithDB(tx, knowledgeChunk.Eid, knowledgeChunk.FileID, additionalChunks)
					if err != nil {
						logger.Warnf(context.Background(), "保存AI生成的检索块失败: %v", err)
					}
				}

				// 更新状态为normal
				err = tx.Model(&model.DocumentChunk{}).
					Where("id = ?", knowledgeChunk.ID).
					Update("ai_generate_doc_chunk_status", model.AIGenerateDocChunkStatusNormal).Error
				if err != nil {
					return fmt.Errorf("更新知识点分块AI生成状态为normal失败: %v", err)
				}
			}
		}

		return nil
	})

	if err != nil {
		errMsg := fmt.Sprintf("AI生成索引增强事务失败: %v", err)
		s.Step.CompleteWithError(errMsg)
		return fmt.Errorf("%s", errMsg)
	}

	// 统计已处理的知识点分块数量
	var count int64
	err = s.DB.Model(&model.DocumentChunk{}).
		Where("eid = ? AND file_id = ? AND chunk_type = 'knowledge' AND ai_generate_doc_chunk_status = ?",
			params.Eid, params.FileID, model.AIGenerateDocChunkStatusNormal).
		Count(&count).Error
	if err != nil {
		log.Printf("统计已处理的知识点分块数量失败: %v\n", err)
		count = 0
	}

	// 创建结果
	result := AIGenerateIndexResult{
		ProcessedChunkCount: int(count),
		Success:             true,
	}

	// 完成步骤并返回结果
	s.Step.CompleteSuccessfully(result)
	return nil
}
