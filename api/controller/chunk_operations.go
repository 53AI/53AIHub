package controller

import (
	"fmt"
	"net/http"
	"strconv"

	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/rag"
	"github.com/gin-gonic/gin"
)

// MergeChunks godoc
// @Summary 合并分块
// @Description 将多个分块合并为一个分块，保留所有内容并重新计算向量
// @Tags 文档分块管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body MergeChunksRequest true "合并分块信息"
// @Success 200 {object} model.CommonResponse{data=ChunkInfo} "成功合并分块"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/chunks/merge [post]
func MergeChunks(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	// 解析请求体
	var req MergeChunksRequest

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 验证分块ID数量
	if len(req.ChunkIDs) < 2 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(fmt.Errorf("至少需要2个分块才能合并")))
		return
	}

	// 创建分块服务
	chunkerService := rag.NewChunkerService(model.DB)

	// 构建选项
	options := rag.MergeChunksOptions{
		UpdateIndexes:       req.UpdateIndexes != nil && *req.UpdateIndexes,
		ResetEmbedding:      req.ResetEmbedding != nil && *req.ResetEmbedding,
		AutoSplitIfTooLarge: req.AutoSplitIfTooLarge == nil || *req.AutoSplitIfTooLarge, // 默认为true
	}

	// 执行合并
	mergedChunk, err := chunkerService.MergeChunksWithOptions(eid, req.FileID, req.ChunkIDs, userID, options)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(mergedChunk))
}

// SplitChunk godoc
// @Summary 拆分分块
// @Description 将一个分块拆分为多个分块，每个分块包含指定的内容
// @Tags 文档分块管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "分块ID" example(1)
// @Param request body SplitChunkRequest true "拆分内容信息"
// @Success 200 {object} model.CommonResponse{data=[]ChunkInfo} "成功拆分分块"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 404 {object} model.CommonResponse "分块不存在"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/chunks/{id}/split [post]
func SplitChunk(c *gin.Context) {
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
	var req SplitChunkRequest

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 验证拆分内容数量
	if len(req.SplitContents) < 2 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(fmt.Errorf("至少需要拆分为2个分块")))
		return
	}

	// 创建分块服务
	chunkerService := rag.NewChunkerService(model.DB)

	// 构建选项
	options := rag.SplitChunkOptions{
		UpdateIndexes:  req.UpdateIndexes == nil || *req.UpdateIndexes, // 默认为true
		ResetEmbedding: req.ResetEmbedding != nil && *req.ResetEmbedding,
	}

	// 执行拆分
	newChunks, err := chunkerService.SplitChunkWithOptions(eid, id, req.SplitContents, userID, options)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(newChunks))
}