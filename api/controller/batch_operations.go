package controller

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/53AI/53AIHub/service/rag"
	"github.com/gin-gonic/gin"
)

// BatchUpdateChunks godoc
// @Summary 批量更新分块
// @Description 批量更新多个文档分块的内容，支持同时更新多个分块，如果content为空则删除对应分块
// @Tags 文档分块管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body BatchUpdateChunksRequest true "批量更新分块信息"
// @Success 200 {object} model.CommonResponse{data=object{results=[]object{id=int64,success=bool,error=string}}} "批量更新结果"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/chunks/batch [put]
// BatchUpdateChunks 批量更新chunks
func BatchUpdateChunks(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	// 解析请求体
	var req BatchUpdateChunksRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	if len(req.Chunks) == 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("chunks不能为空")))
		return
	}

	// 使用统一的服务管理器
	serviceManager := service.GetServiceManager()
	if serviceManager == nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse("服务管理器未初始化"))
		return
	}

	chunkerService := serviceManager.GetChunkerService()

	// 存储处理结果
	type updateResult struct {
		ID      int64  `json:"id"`
		Success bool   `json:"success"`
		Error   string `json:"error,omitempty"`
	}

	results := make([]updateResult, 0, len(req.Chunks))
	var fileID int64
	var needEmbedding bool

	// 批量处理chunks
	for chunkID, updateReq := range req.Chunks {
		result := updateResult{
			ID: chunkID,
		}

		// 获取原分块信息
		chunk, err := model.GetDocumentChunkByID(eid, chunkID)
		if err != nil {
			result.Success = false
			result.Error = fmt.Sprintf("分块不存在: %v", err)
			results = append(results, result)
			continue
		}
		if fileID == 0 {
			fileID = chunk.FileID
		}

		// 检查文档是否被锁定
		if chunkerService.IsDocumentLocked(eid, chunk.FileID) {
			result.Success = false
			result.Error = "文档正在处理中，无法编辑分块"
			results = append(results, result)
			continue
		}

		// 检查分块是否被锁定
		if chunkerService.IsChunkLocked(eid, chunkID) {
			result.Success = false
			result.Error = "分块正在被编辑，请稍后再试"
			results = append(results, result)
			continue
		}

		// 锁定分块
		if !chunkerService.TryLockChunk(eid, chunkID, userID) {
			result.Success = false
			result.Error = "无法获取分块编辑锁，请稍后再试"
			results = append(results, result)
			continue
		}

		// 如果content为空，则删除分块
		if updateReq.Content == "" {
			// 删除分块
			err = model.DeleteDocumentChunk(eid, chunkID)
			if err != nil {
				result.Success = false
				result.Error = fmt.Sprintf("删除分块失败: %v", err)
			} else {
				result.Success = true
			}
			results = append(results, result)
			chunkerService.UnlockChunk(eid, chunkID)
			continue
		}

		// 记录原内容用于日志
		oldContent := chunk.Content

		// 更新分块内容
		chunk.Content = updateReq.Content
		chunk.IsManualEdited = true

		// 重新计算Token数量
		tokenizerService := rag.NewTokenizerService()
		tokenCount, err := tokenizerService.CountTokens(updateReq.Content)
		if err == nil {
			chunk.TokenCount = tokenCount
		}

		// 如果内容发生变化，重置向量化状态
		if oldContent != updateReq.Content {
			chunk.EmbeddingStatus = model.DocumentChunkEmbeddingStatusPending
			chunk.VectorID = ""
			needEmbedding = true
		}

		// 保存更新
		err = chunk.Update()
		if err != nil {
			result.Success = false
			result.Error = fmt.Sprintf("更新分块失败: %v", err)
			results = append(results, result)
			chunkerService.UnlockChunk(eid, chunkID)
			continue
		}

		// 记录操作日志
		err = model.CreateEditLog(eid, chunk.FileID, userID, chunkID, oldContent, updateReq.Content)
		if err != nil {
			// 日志记录失败不影响主流程
		}

		result.Success = true
		results = append(results, result)
		chunkerService.UnlockChunk(eid, chunkID)
	}

	if needEmbedding {
		if err := service.ProcessEmbeddingForNewChunks(eid, fileID); err != nil {
			c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(fmt.Errorf("处理embedding失败: %v", err)))
			return
		}
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(gin.H{
		"results": results,
	}))
}

// BatchUpdateSegments godoc
// @Summary 批量更新段落
// @Description 批量执行段落的合并、拆分和更新操作，支持在一个请求中处理多个操作，可控制是否同时更新检索块。操作列表和内容更新至少需要提供其中一个
// @Tags 文档分块管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param file_id path int true "文件ID" example(1)
// @Param request body BatchSegmentRequest true "批量操作信息，操作列表和内容更新至少需要提供其中一个"
// @Success 200 {object} model.CommonResponse{data=rag.BatchSegmentResult} "成功执行批量操作"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 404 {object} model.CommonResponse "文件不存在"
// @Failure 423 {object} model.CommonResponse "文档被锁定"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/chunks/files/{file_id}/batch [post]
func BatchUpdateSegments(c *gin.Context) {
	eid := config.GetEID(c)
	// userID := config.GetUserId(c)

	// 获取文件ID
	fileIDStr := c.Param("file_id")
	fileID, err := strconv.ParseInt(fileIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 解析请求体
	var req BatchSegmentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 验证操作数量和内容更新（至少需要其中一项）
	if len(req.Operations) == 0 && len(req.ContentUpdates) == 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(fmt.Errorf("至少需要一个操作或一个内容更新")))
		return
	}

	// 使用统一的服务管理器
	serviceManager := service.GetServiceManager()
	if serviceManager == nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse("服务管理器未初始化"))
		return
	}

	// 检查文档是否被锁定
	if serviceManager.IsDocumentLocked(eid, fileID) {
		c.JSON(http.StatusLocked, model.CommonResponse{
			Code:    423,
			Message: "文档正在处理中，无法编辑",
		})
		return
	}

	// 转换请求格式
	ragReq := rag.BatchSegmentRequest{
		Operations:           make([]rag.BatchOperation, len(req.Operations)),
		ContentUpdates:       make(map[string]rag.BatchContentUpdate),
		UpdateRetrievalChunk: req.UpdateRetrievalChunk == nil || *req.UpdateRetrievalChunk, // 默认为true
	}

	// 转换操作
	for i, op := range req.Operations {
		if decoded, err := hashids.TryParseID(op.OriginIdentifier); err == nil {
			op.OriginIdentifier = strconv.FormatInt(decoded, 10)
		}
		if op.Action == "merge" {
			for index, identifier := range op.MergeIdentifiers {
				if !strings.HasPrefix(identifier, "temp_") {
					if decoded, err := hashids.TryParseID(identifier); err == nil {
						identifier = strconv.FormatInt(decoded, 10)
					}
					op.MergeIdentifiers[index] = identifier
				}
			}
			if decoded, err := hashids.TryParseID(op.Identifier); err == nil {
				op.Identifier = strconv.FormatInt(decoded, 10)
			}
		}
		ragReq.Operations[i] = rag.BatchOperation{
			Action:           op.Action,
			Identifier:       op.Identifier,
			OriginIdentifier: op.OriginIdentifier,
			MergeIdentifiers: op.MergeIdentifiers,
		}
	}

	// 转换内容更新
	for key, update := range req.ContentUpdates {
		if decoded, err := hashids.TryParseID(key); err == nil {
			key = strconv.FormatInt(decoded, 10)
		}
		ragReq.ContentUpdates[key] = rag.BatchContentUpdate{
			Content:       update.Content,
			AppendContent: update.AppendContent,
		}
	}

	// 执行批量操作
	result, err := serviceManager.GetChunkerService().BatchUpdateSegments(eid, fileID, ragReq)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(result))
}
