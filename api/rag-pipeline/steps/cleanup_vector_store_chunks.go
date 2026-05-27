package steps

import (
	"context"
	"fmt"
	"log"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/rag"
	"github.com/53AI/53AIHub/service/vectorstore"
	"gorm.io/gorm"
)

// CleanupVectorStoreChunksStep 清理向量库中的Chunk数据步骤
type CleanupVectorStoreChunksStep struct {
	BaseStep
	DB *gorm.DB
}

// CleanupVectorStoreChunksParameters 清理向量库Chunk步骤的参数
type CleanupVectorStoreChunksParameters struct {
	Eid    int64 `json:"eid"`
	FileID int64 `json:"file_id"`
	UserID int64 `json:"user_id"`
}

// CleanupVectorStoreChunksResult 清理向量库Chunk步骤的结果
type CleanupVectorStoreChunksResult struct {
	VectorsDeleted int  `json:"vectors_deleted"`
	Success        bool `json:"success"`
}

// NewCleanupVectorStoreChunksStep 创建新的清理向量库Chunk步骤
func NewCleanupVectorStoreChunksStep(db *gorm.DB) *CleanupVectorStoreChunksStep {
	return &CleanupVectorStoreChunksStep{
		DB: db,
	}
}

// Execute 执行清理向量库Chunk步骤
func (s *CleanupVectorStoreChunksStep) Execute(parameters any) error {
	s.Step.StartProcessing(parameters)

	// 类型断言获取参数
	params, ok := parameters.(CleanupVectorStoreChunksParameters)
	if !ok {
		err := fmt.Errorf("invalid parameters type, expected CleanupVectorStoreChunksParameters")
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

	model.UpdateFileParsingStatus(params.FileID, model.FileParsingStatusParsing)

	// 清理向量库中的向量
	var vectorsDeleted int = 0
	{
		var vectorIDs []string
		if err := s.DB.Model(&model.RetrievalChunk{}).
			Where("eid = ? AND file_id = ? AND vector_id IS NOT NULL AND vector_id != ''", params.Eid, params.FileID).
			Pluck("vector_id", &vectorIDs).Error; err != nil {
			log.Printf("清理向量库查询失败，跳过清理 - EID:%d FileID:%d Err:%v", params.Eid, params.FileID, err)
		} else if len(vectorIDs) > 0 {
			ids := make([]interface{}, 0, len(vectorIDs))
			for _, id := range vectorIDs {
				ids = append(ids, id)
			}
			ctx := context.Background()
			cfg := vectorstore.LoadFromEnv()
			store, err := vectorstore.NewVectorStore(cfg)
			if err != nil {
				log.Printf("向量存储初始化失败，跳过清理 - EID:%d FileID:%d Err:%v", params.Eid, params.FileID, err)
			} else {
				// 通过文件获取库信息构建集合名
				library, err := model.GetLibraryByID(params.Eid, file.LibraryID)
				if err != nil {
					log.Printf("获取库信息失败，跳过向量清理 - EID:%d LibraryID=%d Err:%v", params.Eid, file.LibraryID, err)
				} else {
					collection := model.GetVectorCollectionName(library.UUID)
					if err := store.Delete(ctx, collection, ids); err != nil {
						log.Printf("向量批量删除失败（继续流程） - EID:%d FileID:%d Collection:%s Count:%d Err:%v",
							params.Eid, params.FileID, collection, len(ids), err)
					} else {
						vectorsDeleted = len(ids)
						log.Printf("已从向量库删除旧检索块向量 - EID:%d FileID:%d Collection:%s Count:%d",
							params.Eid, params.FileID, collection, len(ids))
					}
				}
			}
		}
	}

	// 保存清理状态
	rag.CheckEmbeddingStepStatusSave(params.Eid, params.FileID, "清理向量库完成")

	// 创建结果
	result := CleanupVectorStoreChunksResult{
		VectorsDeleted: vectorsDeleted,
		Success:        true,
	}

	// 完成步骤并返回结果
	s.Step.CompleteSuccessfully(result)
	return nil
}
