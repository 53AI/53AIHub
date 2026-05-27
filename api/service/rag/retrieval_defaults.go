package rag

import (
	"fmt"

	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

// CreateDefaultRetrievalChunksForFile 为文件创建默认检索块（若当前不存在任何检索块）
func CreateDefaultRetrievalChunksForFile(eid int64, fileID int64) error {
	// 读取文件，拿到 libraryID
	file, err := model.GetFileByID(eid, fileID)
	if err != nil {
		return fmt.Errorf("get file failed: %w", err)
	}
	if file == nil {
		return fmt.Errorf("file not found: eid=%d fileID=%d", eid, fileID)
	}

	// 如果已经存在任意检索块，直接返回
	existing, err := model.GetRetrievalChunksByFileID(eid, fileID)
	if err != nil {
		return fmt.Errorf("check existing retrieval chunks failed: %w", err)
	}
	if len(existing) > 0 {
		return nil
	}

	// 读取该文件的所有 DocumentChunks
	documentChunks, err := model.GetDocumentChunksByFileID(eid, fileID, 0, 0)
	if err != nil {
		return fmt.Errorf("get document chunks failed: %w", err)
	}
	if len(documentChunks) == 0 {
		// 没有知识点分块，无需创建检索块
		return nil
	}

	// 使用现有服务对象完成创建
	db := model.DB
	if db == nil {
		return fmt.Errorf("db is nil")
	}
	retrievalService := NewRetrievalChunkService(db)
	configService := NewChunkConfigService(db)

	createdTotal := 0
	for _, docChunk := range documentChunks {
		// 读取配置（失败则降级为默认）
		cfg, cfgErr := configService.GetConfigWithFileID(eid, &docChunk.LibraryID, &docChunk.FileID)
		if cfgErr != nil {
			cfg = &ChunkConfig{
				IndexChunk: model.IndexChunkingConfig{
					SplitRule:       "\n\n",
					MaxLength:       2000,
					OverlapSize:     100,
					IncludeTitle:    false,
					IncludeFileName: false,
				},
				IndexMaxLength:   2000,
				IndexOverlapSize: 100,
			}
		}

		// 创建检索块
		createdChunks, createErr := retrievalService.CreateRetrievalChunksForKnowledge(eid, &docChunk, cfg)
		if createErr != nil {
			// 不阻断整个流程，继续下一个
			continue
		}

		// 为每个检索块创建关联关系
		for _, rc := range createdChunks {
			metadata := &model.RelationMetadataData{
				CreatedReason:  "auto_generated_default",
				SemanticScore:  1.0,
				PositionScore:  1.0,
				ContentOverlap: 0.8,
			}
			_, relErr := model.CreateChunkRelation(
				eid,
				docChunk.FileID,
				docChunk.LibraryID,
				docChunk.ID,
				rc.ID,
				"auto",
				1.0,
				metadata,
			)
			_ = relErr // 失败不阻断
		}

		createdTotal += len(createdChunks)
	}

	// createdTotal 可用于日志；此函数只需保证兜底创建已尝试完成
	return nil
}

// helper: allow injecting custom db if needed later
func createDefaultRetrievalChunksForFileWithDB(db *gorm.DB, eid, fileID int64) error {
	// 暂不使用，可根据需要扩展
	return CreateDefaultRetrievalChunksForFile(eid, fileID)
}