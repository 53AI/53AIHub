package controller

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/53AI/53AIHub/service/rag"
	"github.com/gin-gonic/gin"
)

// EnableChunk godoc
// @Summary 启用分块
// @Description 启用指定的文档分块，使其参与检索
// @Tags 文档分块管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "分块ID" example(1)
// @Success 200 {object} model.CommonResponse "成功启用分块"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 404 {object} model.CommonResponse "分块不存在"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/chunks/{id}/enable [post]
func EnableChunk(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	// 获取分块ID
	idStr := c.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 获取分块信息
	chunk, err := model.GetDocumentChunkByID(eid, id)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
		return
	}

	// 验证权限
	userPermission, err := service.GetUserPermission(eid, model.RESOURCE_TYPE_LIBRARY, chunk.LibraryID, userID)
	if err != nil || userPermission < model.PERMISSION_EDIT_KNOWLEDGE {
		c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(errors.New("无权限操作此分块")))
		return
	}

	// 启用分块
	err = model.UpdateChunkStatus(eid, id, "enabled")
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}
	// 重新生成检索块和向量
	chunkIDs := []int64{id}
	// 批量处理分块
	err = batchUpdateChunkStatus(eid, userID, chunkIDs, "enabled")
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}

// DisableChunk godoc
// @Summary 停用分块
// @Description 停用指定的文档分块，使其不参与检索
// @Tags 文档分块管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "分块ID" example(1)
// @Success 200 {object} model.CommonResponse "成功停用分块"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 404 {object} model.CommonResponse "分块不存在"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/chunks/{id}/disable [post]
func DisableChunk(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	// 获取分块ID
	idStr := c.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 获取分块信息
	chunk, err := model.GetDocumentChunkByID(eid, id)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
		return
	}

	// 验证权限
	userPermission, err := service.GetUserPermission(eid, model.RESOURCE_TYPE_LIBRARY, chunk.LibraryID, userID)
	if err != nil || userPermission < model.PERMISSION_EDIT_KNOWLEDGE {
		c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(errors.New("无权限操作此分块")))
		return
	}

	// 停用分块
	err = model.UpdateChunkStatus(eid, id, "disabled")
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	chunkIDs := []int64{id}
	// 批量处理分块
	err = batchUpdateChunkStatus(eid, userID, chunkIDs, "disabled")
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}

// regenerateRetrievalChunkVectors 为知识分片重新生成向量（不删除检索块）
func regenerateRetrievalChunkVectors(eid int64, knowledgeChunkID int64, libraryID int64, fileID int64) error {
	// 获取知识分块信息
	knowledgeChunk, err := model.GetDocumentChunkByID(eid, knowledgeChunkID)
	if err != nil {
		return fmt.Errorf("获取知识分块失败: %v", err)
	}

	// 只处理知识点类型的分块
	if knowledgeChunk.ChunkType != "knowledge" {
		return nil // 非知识点分块不需要检索块
	}

	// 获取现有的检索块
	retrievalChunks, err := model.GetRetrievalChunksByKnowledgeID(eid, knowledgeChunkID)
	if err != nil {
		return fmt.Errorf("获取检索块失败: %v", err)
	}

	if len(retrievalChunks) == 0 {
		return nil // 没有检索块，无需处理
	}

	// 为现有的检索块重新生成向量
	embeddingQueue := rag.GetDefaultEmbeddingQueue()
	if embeddingQueue != nil {
		for _, retrievalChunk := range retrievalChunks {
			// 更新检索块的向量化状态为 pending
			if err := rag.NewRetrievalChunkService(model.DB).UpdateRetrievalChunkEmbeddingStatus(
				retrievalChunk.ID, model.RetrievalChunkEmbeddingStatusPending, "", ""); err != nil {
				fmt.Printf("[enableChunkUpdateStatusFail][retrievalID=%d]%+v\n", retrievalChunk.ID, err)
				continue
			}

			// 入队异步向量化处理
			_, err := embeddingQueue.EnqueueIfNotExists(context.Background(), rag.EmbeddingTask{
				Eid:              eid,
				RetrievalChunkID: retrievalChunk.ID,
				FileID:           fileID,
				LibraryID:        libraryID,
				TraceID:          "",
				Retries:          0,
			})
			if err != nil {
				fmt.Printf("[enableChunkEnqueueFail][chunkID=%d][retrievalID=%d]%+v\n", knowledgeChunkID, retrievalChunk.ID, err)
			}
		}
	}

	return nil
}

// deleteRetrievalChunkVectorsForDisable 删除知识分片关联的所有检索块的向量（禁用时使用）
func deleteRetrievalChunkVectorsForDisable(eid int64, knowledgeChunkID int64, libraryID int64) error {
	// 获取所有关联的检索块
	retrievalChunks, err := model.GetRetrievalChunksByKnowledgeID(eid, knowledgeChunkID)
	if err != nil {
		return fmt.Errorf("获取检索块失败: %v", err)
	}

	if len(retrievalChunks) == 0 {
		return nil // 没有关联的检索块，无需删除向量
	}

	// 创建 ChunkerService
	chunkerService := rag.NewChunkerService(model.DB)

	// 收集所有需要删除的向量ID
	var vectorIDs []string
	for _, retrievalChunk := range retrievalChunks {
		if retrievalChunk.VectorID != "" {
			vectorIDs = append(vectorIDs, retrievalChunk.VectorID)
		}
	}

	if len(vectorIDs) == 0 {
		return nil // 没有向量需要删除
	}

	// 批量删除向量
	return chunkerService.DeleteVectorsFromDB(eid, libraryID, vectorIDs)
}

// BatchEnableChunks godoc
// @Summary 批量启用分块
// @Description 批量启用多个文档分块，使其参与检索
// @Tags 文档分块管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body BatchChunkOperationRequest true "批量操作请求"
// @Success 200 {object} model.CommonResponse "批量启用完成"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/chunks/batch/enable [post]
func BatchEnableChunks(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	// 解析请求体
	var req BatchChunkOperationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	if len(req.ChunkIDs) == 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("分块ID列表不能为空")))
		return
	}

	// 批量处理分块
	err := batchUpdateChunkStatus(eid, userID, req.ChunkIDs, "enabled")
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}

// BatchDisableChunks godoc
// @Summary 批量停用分块
// @Description 批量停用多个文档分块，使其不参与检索
// @Tags 文档分块管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body BatchChunkOperationRequest true "批量操作请求"
// @Success 200 {object} model.CommonResponse "批量停用完成"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/chunks/batch/disable [post]
func BatchDisableChunks(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	// 解析请求体
	var req BatchChunkOperationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	if len(req.ChunkIDs) == 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("分块ID列表不能为空")))
		return
	}

	// 批量处理分块
	err := batchUpdateChunkStatus(eid, userID, req.ChunkIDs, "disabled")
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}

// batchUpdateChunkStatus 批量更新分块状态的辅助函数
func batchUpdateChunkStatus(eid int64, userID int64, chunkIDs []int64, status string) error {
	for _, chunkID := range chunkIDs {
		// 获取分块信息
		chunk, err := model.GetDocumentChunkByID(eid, chunkID)
		if err != nil {
			return fmt.Errorf("获取分块 %d 失败: %v", chunkID, err)
		}

		// 验证权限
		userPermission, err := service.GetUserPermission(eid, model.RESOURCE_TYPE_LIBRARY, chunk.LibraryID, userID)
		if err != nil || userPermission < model.PERMISSION_EDIT_KNOWLEDGE {
			return fmt.Errorf("无权限操作分块 %d", chunkID)
		}

		// 更新状态
		err = model.UpdateChunkStatus(eid, chunkID, status)
		if err != nil {
			return fmt.Errorf("更新分块 %d 状态失败: %v", chunkID, err)
		}

		// 根据状态处理向量
		if status == "disabled" {
			// 禁用操作：删除所有关联的检索块的向量
			if err := deleteRetrievalChunkVectorsForDisable(eid, chunkID, chunk.LibraryID); err != nil {
				// 向量删除失败不阻断流程，但记录日志
				fmt.Printf("[batchDisableChunkVectorDeleteFail][chunkID=%d][libraryID=%d]%+v\n", chunkID, chunk.LibraryID, err)
			}
		} else if status == "enabled" {
			// 启用操作：重新生成检索块和向量
			if err := regenerateRetrievalChunkVectors(eid, chunkID, chunk.LibraryID, chunk.FileID); err != nil {
				// 向量生成失败不阻断流程，但记录日志
				fmt.Printf("[batchEnableChunkVectorRegenerateFail][chunkID=%d][libraryID=%d]%+v\n", chunkID, chunk.LibraryID, err)
			}
		}
	}

	return nil
}
