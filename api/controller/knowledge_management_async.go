package controller

import (
	"context"
	"fmt"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/rag"
	"gorm.io/gorm"
)

type knowledgeChunkPostSaveTask struct {
	EID                 int64
	UserID              int64
	FileID              int64
	LibraryID           int64
	ChunkID             int64
	IsUpdate            bool
	AutoSplitRetrieval  bool
	ConfigID            *int64
	Content             string
	Summary             []string
	CommonQuestions     []string
	RelatedKnowledgeIDs []int64
}

var enqueueRetrievalChunksByFile = rag.EnqueueRetrievalChunksByFile

var scheduleKnowledgeChunkPostSave = func(task knowledgeChunkPostSaveTask) {
	go func(task knowledgeChunkPostSaveTask) {
		if err := processKnowledgeChunkPostSave(context.Background(), task); err != nil {
			logger.Warn(context.Background(), fmt.Sprintf("【知识点保存】后台派生处理失败: eid=%d, fileID=%d, chunkID=%d, err=%v",
				task.EID, task.FileID, task.ChunkID, err))
		}
	}(task)
}

func processKnowledgeChunkPostSave(ctx context.Context, task knowledgeChunkPostSaveTask) error {
	if task.ChunkID <= 0 {
		return nil
	}

	if err := model.DB.Transaction(func(tx *gorm.DB) error {
		var knowledgeChunk model.DocumentChunk
		if err := tx.Where("eid = ? AND id = ?", task.EID, task.ChunkID).First(&knowledgeChunk).Error; err != nil {
			return fmt.Errorf("获取知识点分块失败: %v", err)
		}

		configService := rag.NewChunkConfigService(tx)
		var chunkConfig *rag.ChunkConfig
		var err error
		if task.ConfigID != nil {
			chunkConfig, err = configService.GetConfigByID(task.EID, *task.ConfigID)
		} else {
			chunkConfig, err = configService.GetConfigWithFileID(task.EID, &task.LibraryID, &task.FileID)
		}
		if err != nil {
			return fmt.Errorf("获取分块配置失败: %v", err)
		}

		retrievalService := rag.NewRetrievalChunkService(tx)
		summaryChunks := make([]model.RetrievalChunk, 0, len(task.Summary))
		questionChunks := make([]model.RetrievalChunk, 0, len(task.CommonQuestions))
		relationChunks := make([]model.KnowledgeRelation, 0, len(task.RelatedKnowledgeIDs)*2)

		if task.IsUpdate {
			if err := tx.Where("eid = ? AND knowledge_chunk_id = ? AND chunk_type IN (?)",
				task.EID, task.ChunkID, []string{"summary", "question"}).Delete(&model.RetrievalChunk{}).Error; err != nil {
				return fmt.Errorf("删除现有概要/问题块失败: %v", err)
			}
			if task.AutoSplitRetrieval {
				if err := tx.Where("eid = ? AND knowledge_chunk_id = ? AND chunk_type = ?",
					task.EID, task.ChunkID, "retrieval").Delete(&model.RetrievalChunk{}).Error; err != nil {
					return fmt.Errorf("删除现有检索块失败: %v", err)
				}
			}
			if len(task.RelatedKnowledgeIDs) > 0 {
				if err := model.DeleteKnowledgeRelationsByKnowledgeIDWithDB(tx, task.EID, knowledgeChunk.ID); err != nil {
					return fmt.Errorf("删除现有关联知识点失败: %v", err)
				}
				if err := tx.Where("eid = ? AND knowledge_chunk_id = ?", task.EID, knowledgeChunk.ID).
					Delete(&model.ChunkRelation{}).Error; err != nil {
					return fmt.Errorf("删除现有关联关系失败: %v", err)
				}
			}
		}

		if task.AutoSplitRetrieval {
			if _, err := retrievalService.CreateRetrievalChunksForKnowledge(task.EID, &knowledgeChunk, chunkConfig); err != nil {
				return fmt.Errorf("创建检索块失败: %v", err)
			}
		}

		for i, summary := range task.Summary {
			summaryChunks = append(summaryChunks, model.RetrievalChunk{
				Eid:              task.EID,
				FileID:           task.FileID,
				LibraryID:        task.LibraryID,
				KnowledgeChunkID: knowledgeChunk.ID,
				Content:          summary,
				ChunkIndex:       i,
				ChunkType:        "summary",
				Status:           "enabled",
				SearchWeight:     1.2,
			})
		}

		for i, question := range task.CommonQuestions {
			questionChunks = append(questionChunks, model.RetrievalChunk{
				Eid:              task.EID,
				FileID:           task.FileID,
				LibraryID:        task.LibraryID,
				KnowledgeChunkID: knowledgeChunk.ID,
				Content:          question,
				ChunkIndex:       i,
				ChunkType:        "question",
				Status:           "enabled",
				SearchWeight:     1.5,
			})
		}

		if len(summaryChunks) > 0 {
			if err := tx.CreateInBatches(summaryChunks, 100).Error; err != nil {
				return fmt.Errorf("批量创建概要块失败: %v", err)
			}
		}
		if len(questionChunks) > 0 {
			if err := tx.CreateInBatches(questionChunks, 100).Error; err != nil {
				return fmt.Errorf("批量创建问题块失败: %v", err)
			}
		}

		if len(task.RelatedKnowledgeIDs) > 0 {
			for _, relatedID := range task.RelatedKnowledgeIDs {
				metadata := &model.KnowledgeRelationMetadata{
					CreatedBy:     task.UserID,
					CreatedReason: "manual",
				}

				relation := model.KnowledgeRelation{
					Eid:               task.EID,
					LibraryID:         task.LibraryID,
					SourceKnowledgeID: knowledgeChunk.ID,
					TargetKnowledgeID: relatedID,
					RelationType:      "manual",
					RelationWeight:    1.0,
					Status:            "active",
				}
				if err := relation.SetRelationMetadata(metadata); err != nil {
					return fmt.Errorf("设置关联关系元数据失败: %v", err)
				}
				relationChunks = append(relationChunks, relation)

				reverseRelation := model.KnowledgeRelation{
					Eid:               task.EID,
					LibraryID:         task.LibraryID,
					SourceKnowledgeID: relatedID,
					TargetKnowledgeID: knowledgeChunk.ID,
					RelationType:      "manual",
					RelationWeight:    1.0,
					Status:            "active",
				}
				if err := reverseRelation.SetRelationMetadata(metadata); err != nil {
					return fmt.Errorf("设置反向关联关系元数据失败: %v", err)
				}
				relationChunks = append(relationChunks, reverseRelation)
			}
		}

		if len(relationChunks) > 0 {
			if err := model.BatchCreateKnowledgeRelationsWithDB(tx, relationChunks); err != nil {
				return fmt.Errorf("批量创建关联关系失败: %v", err)
			}
		}

		return nil
	}); err != nil {
		return err
	}

	if err := enqueueRetrievalChunksByFile(task.EID, task.FileID, task.LibraryID); err != nil {
		return fmt.Errorf("入队检索块失败: %v", err)
	}

	return nil
}
