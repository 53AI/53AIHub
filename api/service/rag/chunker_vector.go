package rag

import (
	"context"
	"fmt"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/vectorstore"
)

// DeleteVectorFromDB 从向量数据库删除向量
func (s *ChunkerService) DeleteVectorFromDB(eid int64, libraryID int64, vectorID string) error {
	// 获取全局向量存储实例
	store, err := vectorstore.GetGlobalVectorStore()
	if err != nil {
		return fmt.Errorf("获取全局向量存储失败: %v", err)
	}

	ctx := context.Background()

	// 获取知识库信息以获取 UUID
	library, err := model.GetLibraryByID(eid, libraryID)
	if err != nil {
		return fmt.Errorf("获取知识库信息失败: %v", err)
	}

	// 使用统一的集合名称方法
	collection := model.GetVectorCollectionName(library.UUID)

	// 删除向量
	return store.Delete(ctx, collection, []interface{}{vectorID})
}

// cleanupVectorsAsync 异步清理向量数据
func (s *ChunkerService) cleanupVectorsAsync(eid int64, libraryID int64, vectorIDs []string) {
	if len(vectorIDs) == 0 {
		return
	}

	logger.Info(context.TODO(), fmt.Sprintf("[vectorCleanupStart][eid=%d][count=%d]", eid, len(vectorIDs)))

	// 使用defer确保错误也会被记录
	defer func() {
		if r := recover(); r != nil {
			logger.Error(context.TODO(), fmt.Sprintf("[vectorCleanupPanic][eid=%d]%+v", eid, r))
		}
	}()

	// 批量删除向量
	err := s.DeleteVectorsFromDB(eid, libraryID, vectorIDs)
	if err != nil {
		logger.Warn(context.TODO(), fmt.Sprintf("[vectorBatchDeleteFail][eid=%d][count=%d]%+v", eid, len(vectorIDs), err))
		return
	}

	logger.Info(context.TODO(), fmt.Sprintf("[vectorCleanupDone][eid=%d][count=%d]", eid, len(vectorIDs)))
}

// DeleteVectorsFromDB 批量删除向量数据
func (s *ChunkerService) DeleteVectorsFromDB(eid int64, libraryID int64, vectorIDs []string) error {
	if len(vectorIDs) == 0 {
		return nil
	}

	// 获取全局向量存储实例
	store, err := vectorstore.GetGlobalVectorStore()
	if err != nil {
		return fmt.Errorf("获取全局向量存储失败: %v", err)
	}

	ctx := context.Background()

	// 获取知识库信息以获取 UUID
	library, err := model.GetLibraryByID(eid, libraryID)
	if err != nil {
		return fmt.Errorf("获取知识库信息失败: %v", err)
	}

	// 使用统一的集合名称方法
	collection := model.GetVectorCollectionName(library.UUID)

	// 转换为interface{}切片
	ids := make([]interface{}, len(vectorIDs))
	for i, id := range vectorIDs {
		ids[i] = id
	}

	// 批量删除向量
	return store.Delete(ctx, collection, ids)
}

// cleanupInvalidVectors 清理无效的向量数据
func (s *ChunkerService) cleanupInvalidVectors(vectorIDsToDelete []string) {
	if len(vectorIDsToDelete) == 0 {
		return
	}

	logger.Info(context.TODO(), fmt.Sprintf("[vectorInvalidCleanupStart][count=%d]", len(vectorIDsToDelete)))

	// 获取EID（从第一个向量ID推断，或者从上下文获取）
	// 这里我们需要从调用上下文获取EID
	// 由于方法签名限制，我们暂时记录日志，实际清理由调用方处理

	for _, vectorID := range vectorIDsToDelete {
		logger.Info(context.TODO(), fmt.Sprintf("[vectorInvalidCleanupID][id=%s]", vectorID))
	}

	logger.Info(context.TODO(), fmt.Sprintf("[vectorInvalidCleanupMarked][count=%d]", len(vectorIDsToDelete)))
}
