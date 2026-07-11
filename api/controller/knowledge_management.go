package controller

import (
	"errors"
	"fmt"
	"net/http"

	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"

	"github.com/53AI/53AIHub/service/rag"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// SaveKnowledgeChunk godoc
// @Summary 保存知识点内容
// @Description 一次性保存知识点内容、概要、常见问法和关联知识点，支持大内容自动分块。如果提供chunk_id则更新现有分块，否则创建新的知识点
// @Tags 文档分块管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body SaveKnowledgeChunkRequest true "知识点信息"
// @Success 200 {object} model.CommonResponse{data=SaveKnowledgeChunkResponse} "成功保存知识点"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/chunks/knowledge [post]
func SaveKnowledgeChunk(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	// 解析请求体
	var req SaveKnowledgeChunkRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 验证知识库权限
	userPermission, err := service.GetUserPermission(eid, model.RESOURCE_TYPE_LIBRARY, req.LibraryID, userID)
	if err != nil || userPermission < model.PERMISSION_EDIT_KNOWLEDGE {
		c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(errors.New("无权限在此知识库创建知识点")))
		return
	}

	// 如果指定了 ChunkID，验证分块是否存在且属于指定知识库
	if req.ChunkID != nil {
		existingChunk, err := model.GetDocumentChunkByID(eid, *req.ChunkID)
		if err != nil {
			c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(fmt.Errorf("指定的分块 %d 不存在", *req.ChunkID)))
			return
		}
		if existingChunk.LibraryID != req.LibraryID {
			c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(fmt.Errorf("指定的分块 %d 不属于指定知识库", *req.ChunkID)))
			return
		}
		if existingChunk.ChunkType != "knowledge" {
			c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(fmt.Errorf("指定的分块 %d 不是知识点类型", *req.ChunkID)))
			return
		}
	}

	// 验证关联知识点是否存在且属于同一知识库
	if len(req.RelatedKnowledgeIDs) > 0 {
		for _, relatedID := range req.RelatedKnowledgeIDs {
			relatedChunk, err := model.GetDocumentChunkByID(eid, relatedID)
			if err != nil {
				c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(fmt.Errorf("关联知识点 %d 不存在", relatedID)))
				return
			}
			if relatedChunk.LibraryID != req.LibraryID {
				c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(fmt.Errorf("关联知识点 %d 不属于指定知识库", relatedID)))
				return
			}
			if relatedChunk.ChunkType != "knowledge" {
				c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(fmt.Errorf("关联的分块 %d 不是知识点类型", relatedID)))
				return
			}
		}
	}

	// 创建场景下，先校验目标文件是否存在且属于指定知识库
	if req.ChunkID == nil {
		file, err := model.GetFileByID(eid, req.FileID)
		if err != nil {
			c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(fmt.Errorf("指定的文件 %d 不存在", req.FileID)))
			return
		}
		if file.LibraryID != req.LibraryID {
			c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(fmt.Errorf("指定的文件 %d 不属于指定知识库", req.FileID)))
			return
		}
	}

	// 使用事务处理
	result, err := saveKnowledgeChunkWithTransaction(eid, userID, &req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(result))
}

// saveKnowledgeChunkWithTransaction 使用事务保存知识点
func saveKnowledgeChunkWithTransaction(eid int64, userID int64, req *SaveKnowledgeChunkRequest) (*SaveKnowledgeChunkResult, error) {
	var result *SaveKnowledgeChunkResult
	var isUpdate bool = req.ChunkID != nil
	var fileID int64

	// 确定是否需要自动分检索块
	autoSplitRetrieval := true // 默认值
	if req.AutoSplitRetrieval != nil {
		autoSplitRetrieval = *req.AutoSplitRetrieval
	} else {
		// 新增默认分，更新默认不分
		autoSplitRetrieval = !isUpdate
	}

	err := model.DB.Transaction(func(tx *gorm.DB) error {
		var knowledgeChunk *model.DocumentChunk

		if isUpdate {
			// 更新模式：获取现有分块信息
			existingChunk, err := model.GetDocumentChunkByID(eid, *req.ChunkID)
			if err != nil {
				return fmt.Errorf("获取现有分块失败: %v", err)
			}

			fileID = existingChunk.FileID

			existingChunk.Content = req.Content
			existingChunk.IsManualEdited = true
			if autoSplitRetrieval {
				existingChunk.EmbeddingStatus = model.DocumentChunkEmbeddingStatusPending
				existingChunk.VectorID = ""
			}

			tokenizerService := rag.NewTokenizerService()
			tokenCount, err := tokenizerService.CountTokens(req.Content)
			if err == nil {
				existingChunk.TokenCount = tokenCount
			}

			if err := tx.Model(existingChunk).Updates(existingChunk).Error; err != nil {
				return fmt.Errorf("更新分块失败: %v", err)
			}

			knowledgeChunk = existingChunk
		} else {
			fileID = req.FileID

			tokenizerService := rag.NewTokenizerService()
			tokenCount, err := tokenizerService.CountTokens(req.Content)
			if err != nil {
				tokenCount = 0
			}

			newChunk := &model.DocumentChunk{
				Eid:             eid,
				FileID:          fileID,
				LibraryID:       req.LibraryID,
				Content:         req.Content,
				ChunkIndex:      0,
				ChunkType:       "knowledge",
				StartPosition:   0,
				EndPosition:     len(req.Content),
				TokenCount:      tokenCount,
				Status:          "enabled",
				IsManualEdited:  false,
				EmbeddingStatus: model.DocumentChunkEmbeddingStatusPending,
			}

			if err := tx.Create(newChunk).Error; err != nil {
				return fmt.Errorf("保存知识点分块失败: %v", err)
			}

			knowledgeChunk = newChunk
		}

		chunkInfo := ChunkInfo{
			ID:              knowledgeChunk.ID,
			FileID:          knowledgeChunk.FileID,
			Type:            knowledgeChunk.ChunkType,
			Content:         knowledgeChunk.Content,
			TokenCount:      knowledgeChunk.TokenCount,
			StartPos:        knowledgeChunk.StartPosition,
			EndPos:          knowledgeChunk.EndPosition,
			EmbeddingStatus: knowledgeChunk.EmbeddingStatus,
			VectorID:        knowledgeChunk.VectorID,
			IsManualEdited:  knowledgeChunk.IsManualEdited,
			CreatedTime:     knowledgeChunk.CreatedTime,
			UpdatedTime:     knowledgeChunk.UpdatedTime,
		}

		result = &SaveKnowledgeChunkResult{
			MainChunkID:     knowledgeChunk.ID,
			Chunks:          []ChunkInfo{chunkInfo},
			AsyncQueued:     shouldQueueKnowledgeChunkPostSave(isUpdate, autoSplitRetrieval, req),
			RetrievalChunks: 0,
			SummaryChunks:   0,
			QuestionChunks:  0,
			RelationCount:   0,
		}

		return nil
	})

	if err != nil {
		return nil, err
	}

	if result != nil && result.AsyncQueued {
		scheduleKnowledgeChunkPostSave(knowledgeChunkPostSaveTask{
			EID:                 eid,
			UserID:              userID,
			FileID:              fileID,
			LibraryID:           req.LibraryID,
			ChunkID:             result.MainChunkID,
			IsUpdate:            isUpdate,
			AutoSplitRetrieval:  autoSplitRetrieval,
			ConfigID:            req.ConfigID,
			Content:             req.Content,
			Summary:             append([]string(nil), req.Summary...),
			CommonQuestions:     append([]string(nil), req.CommonQuestions...),
			RelatedKnowledgeIDs: append([]int64(nil), req.RelatedKnowledgeIDs...),
		})
	}

	return result, nil
}

func shouldQueueKnowledgeChunkPostSave(isUpdate bool, autoSplitRetrieval bool, req *SaveKnowledgeChunkRequest) bool {
	return isUpdate || autoSplitRetrieval || len(req.Summary) > 0 || len(req.CommonQuestions) > 0 || len(req.RelatedKnowledgeIDs) > 0
}
