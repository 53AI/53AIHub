package controller

import (
	"fmt"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/53AI/53AIHub/common/utils"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/53AI/53AIHub/service/rag"
	"github.com/gin-gonic/gin"
)

// RestoreDocument godoc
// @Summary 从分块还原文档内容
// @Description 将文件的所有分块按顺序合并，还原为完整的文档内容
// @Tags 文档分块管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body RestoreDocumentRequest true "还原文档请求"
// @Success 200 {object} model.CommonResponse{data=RestoreDocumentResponse} "成功还原文档内容"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 404 {object} model.CommonResponse "文件不存在或没有分块"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/chunks/restore [post]
func RestoreDocument(c *gin.Context) {
	eid := config.GetEID(c)

	// 检查功能是否可用
	params := map[string]interface{}{
		"from": "document",
		"op":   "add",
	}
	_, err := service.IsFeatureAvailable(c, "knowledge_base", params)
	if err != nil {
		c.JSON(http.StatusForbidden, model.FeatureNotAvailableError.ToResponse(err))
		return
	}

	// 解析请求体
	var req RestoreDocumentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 创建分块服务
	chunkerService := rag.NewChunkerService(model.DB)

	// 还原文档内容
	content, err := chunkerService.RestoreDocumentFromChunks(eid, req.FileID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
		return
	}

	response := RestoreDocumentResponse{
		Content: content,
		Length:  len(content),
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(response))
}

// SyncChunksToDocument godoc
// @Summary 同步分块内容到文档
// @Description 将文件的所有分块内容同步更新到原文档中
// @Tags 文档分块管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body SyncChunksToDocumentRequest true "同步请求"
// @Success 200 {object} model.CommonResponse "成功同步分块内容到文档"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 404 {object} model.CommonResponse "文件不存在或没有分块"
// @Failure 409 {object} model.CommonResponse "文档正在被编辑，无法同步"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/chunks/sync [post]
func SyncChunksToDocument(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	// 解析请求体
	var req SyncChunksToDocumentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 创建分块服务
	chunkerService := rag.NewChunkerService(model.DB)

	// 同步分块内容到文档
	err := chunkerService.SyncChunksToDocument(eid, req.FileID, userID)
	if err != nil {
		if strings.Contains(err.Error(), "正在被编辑") {
			c.JSON(http.StatusConflict, model.SystemError.ToResponse(err))
		} else if strings.Contains(err.Error(), "没有分块") {
			c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
		} else {
			c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		}
		return
	}

	// 记录系统日志 - 只记录编辑日志
	file, _ := model.GetFileByID(eid, req.FileID)
	library, _ := model.GetLibraryByID(eid, file.LibraryID)
	space, _ := model.GetSpaceByID(eid, library.SpaceID)

	fileName := filepath.Base(file.Path)
	log := model.SystemLog{
		Eid:      eid,
		UserID:   config.GetUserId(c),
		Nickname: config.GetUserNickname(c),
		Module:   model.SystemLogModuleFile,
		Action:   model.SystemLogActionUpdate,
		Content:  fmt.Sprintf("编辑了【%s】知识库【%s】的《%s》", space.Name, library.Name, fileName),
		IP:       utils.GetClientIP(c),
	}
	model.CreateSystemLog(&log)

	c.JSON(http.StatusOK, model.Success.ToResponse("分块内容已成功同步到文档"))
}

// CheckDocumentStatus godoc
// @Summary 检查文档状态
// @Description 检查文档是否被锁定以及分块处理状态
// @Tags 文档分块管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body CheckDocumentStatusRequest true "检查状态请求"
// @Success 200 {object} model.CommonResponse{data=CheckDocumentStatusResponse} "成功获取文档状态"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/chunks/status [post]
func CheckDocumentStatus(c *gin.Context) {
	eid := config.GetEID(c)

	// 解析请求体
	var req CheckDocumentStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 创建分块服务
	chunkerService := rag.NewChunkerService(model.DB)

	// 检查文档锁定状态
	isLocked := chunkerService.IsDocumentLocked(eid, req.FileID)

	// 检查分块状态
	chunkingStatus, err := chunkerService.CheckChunkingStatus(eid, req.FileID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	// 确定是否可以编辑
	canEdit := !isLocked && chunkingStatus == model.DocumentChunkEmbeddingStatusCompleted

	// 生成状态描述
	var message string
	if isLocked {
		message = "文档正在被编辑，请稍后再试"
	} else if chunkingStatus == "chunking" {
		message = "文档正在分块处理中，请稍后再试"
	} else if chunkingStatus == "embedding" {
		message = "文档正在向量化处理中，可以编辑但建议等待完成"
	} else if chunkingStatus == "failed" {
		message = "文档向量化失败，请重试或重新索引"
	} else {
		message = "文档可以正常编辑"
	}

	response := CheckDocumentStatusResponse{
		IsLocked:       isLocked,
		ChunkingStatus: chunkingStatus,
		CanEdit:        canEdit,
		Message:        message,
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(response))
}

// GetChunkEditStatus godoc
// @Summary 获取分块编辑状态
// @Description 获取指定文件的分块编辑状态，包括文档锁定状态和各分块的锁定状态
// @Tags 分块管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param file_id path int true "文件ID"
// @Success 200 {object} model.CommonResponse{data=GetChunkEditStatusResponse} "成功获取编辑状态"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 404 {object} model.CommonResponse "文件不存在"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/chunks/edit-status/{file_id} [get]
func GetChunkEditStatus(c *gin.Context) {
	eid := config.GetEID(c)

	// 解析路径参数
	fileIDStr := c.Param("file_id")
	fileID, err := strconv.ParseInt(fileIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("无效的文件ID"))
		return
	}

	// 检查文件是否存在
	var file model.File
	err = model.DB.Where("eid = ? AND id = ?", eid, fileID).First(&file).Error
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse("文件不存在"))
		return
	}

	// 创建分块服务
	chunkerService := rag.NewChunkerService(model.DB)

	// 检查文档锁定状态
	isDocumentLocked := chunkerService.IsDocumentLocked(eid, fileID)

	// 检查分块状态
	chunkingStatus, err := chunkerService.CheckChunkingStatus(eid, fileID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	// 确定是否可以编辑
	canEdit := !isDocumentLocked && chunkingStatus == model.DocumentChunkEmbeddingStatusCompleted

	// 生成状态描述
	var message string
	if isDocumentLocked {
		message = "文档正在被编辑，请稍后再试"
	} else if chunkingStatus == "chunking" {
		message = "文档正在分块处理中，请稍后再试"
	} else if chunkingStatus == "embedding" {
		message = "文档正在向量化处理中，可以编辑但建议等待完成"
	} else if chunkingStatus == "failed" {
		message = "文档向量化失败，请重试或重新索引"
	} else {
		message = "文档可以正常编辑"
	}

	// 获取文档分块列表
	var chunks []model.DocumentChunk
	err = model.DB.Where("eid = ? AND file_id = ?", eid, fileID).Find(&chunks).Error
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	// 检查各分块的锁定状态
	var lockedChunks []ChunkLockInfo
	for _, chunk := range chunks {
		lockInfo := ChunkLockInfo{
			ChunkID:  chunk.ID,
			IsLocked: chunkerService.IsChunkLocked(eid, chunk.ID),
		}
		lockedChunks = append(lockedChunks, lockInfo)
	}

	// 获取检索块列表
	var retrievalChunks []model.RetrievalChunk
	err = model.DB.Where("eid = ? AND file_id = ?", eid, fileID).Find(&retrievalChunks).Error
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	// 检查各检索块的锁定状态
	var lockedRetrieval []RetrievalChunkLockInfo
	for _, chunk := range retrievalChunks {
		lockInfo := RetrievalChunkLockInfo{
			ChunkID:  chunk.ID,
			IsLocked: chunkerService.IsRetrievalChunkLocked(eid, chunk.ID),
		}
		lockedRetrieval = append(lockedRetrieval, lockInfo)
	}

	response := GetChunkEditStatusResponse{
		FileID:           fileID,
		IsDocumentLocked: isDocumentLocked,
		ChunkingStatus:   chunkingStatus,
		CanEdit:          canEdit,
		Message:          message,
		LockedChunks:     lockedChunks,
		LockedRetrieval:  lockedRetrieval,
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(response))
}
