package controller

import (
	"fmt"
	"net/http"
	"strconv"

	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/53AI/53AIHub/service/rag"
	"github.com/gin-gonic/gin"
)

// BatchGetChunksRequest 批量获取分片请求
type BatchGetChunksRequest struct {
	ChunkIDs []interface{} `json:"chunk_ids" binding:"required"`
}

// BatchGetChunksResponse 批量获取分片响应
type BatchGetChunksResponse struct {
	Chunks []model.DocumentChunk `json:"chunks"`
	Total  int                   `json:"total"`
}

// CreateFileChunks godoc
// @Summary 创建文件分块
// @Description 对指定文件进行智能分块处理，支持自定义分块配置和强制重新分块
// @Tags 文档分块管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param file_id path int true "文件ID" example(1)
// @Param request body CreateFileChunksRequest true "分块配置信息"
// @Success 200 {object} model.CommonResponse{data=CreateFileChunksResponse} "成功创建文件分块"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 404 {object} model.CommonResponse "文件不存在"
// @Failure 409 {object} model.CommonResponse "文件已分块，需要设置force=true"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/chunks/files/{file_id} [post]
func CreateFileChunks(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	// 获取文件ID
	fileIDStr := c.Param("file_id")
	fileID, err := strconv.ParseInt(fileIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 解析请求体
	var req CreateFileChunksRequest

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 获取文件信息
	_, err = model.GetFileByID(eid, fileID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
		return
	}

	// 检查文件是否有内容
	fileBody, err := model.GetLastFileBodyByFileID(eid, fileID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
		return
	}
	content, err := fileBody.GetContent()
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	// 检查是否已经分块
	if !req.Force {
		existingChunks, err := model.GetDocumentChunksByFileID(eid, fileID, 0, 1)
		if err == nil && len(existingChunks) > 0 {
			c.JSON(http.StatusConflict, gin.H{
				"success": false,
				"message": "文件已经分块，如需重新分块请设置force=true",
				"data": gin.H{
					"existing_chunks": len(existingChunks),
				},
			})
			return
		}
	}

	// 使用统一的服务管理器
	serviceManager := service.GetServiceManager()
	if serviceManager == nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse("服务管理器未初始化"))
		return
	}

	// 执行分块
	result, err := serviceManager.ChunkDocument(eid, fileID, content, req.ConfigID)
	if err != nil {
		_ = model.UpdateFileParsingStatus(fileID, model.FileParsingStatusFail)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	// 保存分块到数据库
	err = serviceManager.SaveChunks(eid, fileID, result.Chunks)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	// 记录操作日志
	err = model.CreateAutoChunkLog(eid, fileID, userID, len(result.Chunks), result.Metadata.TotalTokens)
	if err != nil {
		// 日志记录失败不影响主流程
		// logger.SysLog("记录分块日志失败: " + err.Error())
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(result))
}

// GetFileChunks godoc
// @Summary 获取文件分块列表
// @Description 获取指定文件的分块列表，包含分块详情和统计信息
// @Tags 文档分块管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param file_id path string true "文件ID" example(1)
// @Param offset query int false "偏移量" default(0)
// @Param limit query int false "数量" default(1000)
// @Param chunk_type query string false "分块类型" Enums(knowledge,index) default(knowledge)
// @Param status query string false "状态筛选" Enums(enabled,disabled)
// @Param keyword query string false "搜索关键词"
// @Success 200 {object} model.CommonResponse{data=GetFileChunksResponse} "成功获取文件分块列表"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/chunks/files/{file_id} [get]
func GetFileChunks(c *gin.Context) {
	eid := config.GetEID(c)

	// 获取文件ID
	fileIDStr := c.Param("file_id")
	fileID, err := strconv.ParseInt(fileIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	offset, _ := strconv.Atoi(c.Query("offset"))
	limit, _ := strconv.Atoi(c.Query("limit"))
	if limit == 0 {
		limit = 1000
	}

	// 获取筛选参数
	chunkType := c.DefaultQuery("chunk_type", "knowledge")
	status := c.Query("status")
	keyword := c.Query("keyword")

	// 获取分块列表
	chunks, err := model.GetDocumentChunksByFileIDWithFilters(eid, fileID, offset, limit, chunkType, status, keyword)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	// 获取统计信息（使用与分块列表相同的 chunkType 过滤）
	stats, err := model.GetChunkStatsByFileID(eid, fileID, chunkType)
	if err != nil {
		stats = &model.ChunkStats{}
	}

	response := gin.H{
		"chunks": chunks,
		"stats":  stats,
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(response))
}

// GetChunk godoc
// @Summary 获取单个分块详情
// @Description 获取指定分块的详细信息，包含内容、摘要、向量化状态等
// @Tags 文档分块管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path string true "分块ID" example(1)
// @Success 200 {object} model.CommonResponse{data=ChunkInfo} "成功获取分块详情"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 404 {object} model.CommonResponse "分块不存在"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/chunks/{id} [get]
func GetChunk(c *gin.Context) {
	eid := config.GetEID(c)

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

	c.JSON(http.StatusOK, model.Success.ToResponse(chunk))
}

// UpdateChunk 更新文档分块内容
// @Summary 更新文档分块
// @Description 更新文档分块内容，如果内容为空则删除分块
// @Tags 分块管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path integer true "分块ID"
// @Param request body UpdateChunkRequest true "更新分块请求"
// @Success 200 {object} model.CommonResponse{data=model.DocumentChunk} "更新成功"
// @Success 204 {object} model.CommonResponse "删除成功（当content为空时）"
// @Failure 400 {object} model.CommonResponse "请求参数错误"
// @Failure 404 {object} model.CommonResponse "分块不存在"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/chunk/{id} [put]
func UpdateChunk(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	// 获取分块ID
	idStr := c.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 解析请求体
	var req UpdateChunkRequest

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 获取原分块信息
	chunk, err := model.GetDocumentChunkByID(eid, id)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
		return
	}

	// 如果content为空，则删除分块
	if req.Content == "" {
		// 删除分块
		err = model.DeleteDocumentChunk(eid, id)
		if err != nil {
			c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
			return
		}

		// TODO: 添加删除日志记录（目前暂无CreateDeleteLog方法）
		// err = model.CreateDeleteLog(eid, chunk.FileID, userID, id, chunk.Content)
		// if err != nil {
		// 	// 日志记录失败不影响主流程
		// }

		// 返回204状态码表示删除成功
		c.JSON(http.StatusNoContent, model.Success.ToResponse(nil))
		return
	}

	// 使用统一的服务管理器
	serviceManager := service.GetServiceManager()
	if serviceManager == nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse("服务管理器未初始化"))
		return
	}

	chunkerService := serviceManager.GetChunkerService()

	// 检查文档是否被锁定
	if chunkerService.IsDocumentLocked(eid, chunk.FileID) {
		c.JSON(http.StatusLocked, model.CommonResponse{
			Code:    423,
			Message: "文档正在处理中，无法编辑分块",
		})
		return
	}

	// 检查分块是否被锁定
	if chunkerService.IsChunkLocked(eid, id) {
		c.JSON(http.StatusLocked, model.CommonResponse{
			Code:    423,
			Message: "分块正在被编辑，请稍后再试",
		})
		return
	}

	// 锁定分块
	if !chunkerService.TryLockChunk(eid, id, userID) {
		c.JSON(http.StatusLocked, model.CommonResponse{
			Code:    423,
			Message: "无法获取分块编辑锁，请稍后再试",
		})
		return
	}
	defer chunkerService.UnlockChunk(eid, id)

	// 记录原内容用于日志
	oldContent := chunk.Content

	// 更新分块内容
	chunk.Content = req.Content
	chunk.IsManualEdited = true

	// 重新计算Token数量
	tokenizerService := rag.NewTokenizerService()
	tokenCount, err := tokenizerService.CountTokens(req.Content)
	if err == nil {
		chunk.TokenCount = tokenCount
	}

	// 如果内容发生变化，重置向量化状态
	if oldContent != req.Content {
		chunk.EmbeddingStatus = model.DocumentChunkEmbeddingStatusPending
		chunk.VectorID = ""
	}

	// 保存更新
	err = chunk.Update()
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	// 记录操作日志
	err = model.CreateEditLog(eid, chunk.FileID, userID, id, oldContent, req.Content)
	if err != nil {
		// 日志记录失败不影响主流程
		// logger.SysLog("记录编辑日志失败: " + err.Error())
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(chunk))
}

// DeleteChunk godoc
// @Summary 删除分块
// @Description 删除指定的文档分块，同时清理相关的向量数据
// @Tags 文档分块管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "分块ID" example(1)
// @Success 200 {object} model.CommonResponse "成功删除分块"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 404 {object} model.CommonResponse "分块不存在"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/chunks/{id} [delete]
func DeleteChunk(c *gin.Context) {
	eid := config.GetEID(c)

	// 获取分块ID
	idStr := c.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 删除分块
	err = model.DeleteDocumentChunk(eid, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}

// BatchGetChunks godoc
// @Summary 批量获取分片详情
// @Description 根据分片ID列表批量获取分片详情，支持跨文件查询，供图谱接口的 chunk_ids 查询使用
// @Tags 文档分块管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body BatchGetChunksRequest true "分片ID列表"
// @Success 200 {object} model.CommonResponse{data=BatchGetChunksResponse} "成功获取分片列表"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/chunks/batch-get [post]
func BatchGetChunks(c *gin.Context) {
	eid := config.GetEID(c)

	var req BatchGetChunksRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	if len(req.ChunkIDs) == 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("chunk_ids 不能为空"))
		return
	}

	if len(req.ChunkIDs) > 1000 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("单次最多查询1000个分片"))
		return
	}

	chunkIDs, err := parseChunkIDs(req.ChunkIDs)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	chunks, err := model.BatchGetDocumentChunksByIDs(eid, chunkIDs)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	response := &BatchGetChunksResponse{
		Chunks: chunks,
		Total:  len(chunks),
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(response))
}

func parseChunkIDs(ids []interface{}) ([]int64, error) {
	result := make([]int64, 0, len(ids))
	for i, id := range ids {
		switch v := id.(type) {
		case string:
			parsed, err := hashids.TryParseID(v)
			if err != nil {
				return nil, fmt.Errorf("chunk_ids[%d]: 无效的ID格式", i)
			}
			result = append(result, parsed)
		case float64:
			if v <= 0 || v != float64(int64(v)) {
				return nil, fmt.Errorf("chunk_ids[%d]: 无效的ID值", i)
			}
			result = append(result, int64(v))
		case int64:
			if v <= 0 {
				return nil, fmt.Errorf("chunk_ids[%d]: 无效的ID值", i)
			}
			result = append(result, v)
		default:
			return nil, fmt.Errorf("chunk_ids[%d]: 不支持的ID类型", i)
		}
	}
	return result, nil
}
