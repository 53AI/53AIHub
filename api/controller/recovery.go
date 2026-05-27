package controller

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/gin-gonic/gin"
)

// GetRecoveryStats godoc
// @Summary 获取恢复统计信息
// @Description 获取当前系统中未完成任务的数量统计
// @Tags 系统管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse{data=RecoveryStatsResponse}
// @Router /api/admin/recovery/stats [get]
func GetRecoveryStats(c *gin.Context) {
	eid := config.GetEID(c)

	// 获取未完成的解析文件数量
	parsingFiles, err := getIncompleteParsingFilesCount(eid)
	if err != nil {
		logger.SysLogf("获取未完成解析文件统计失败 - EID: %d, Error: %v", eid, err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	// 获取待向量化的文档分块数量
	pendingChunks, err := getPendingEmbeddingChunksCount(eid)
	if err != nil {
		logger.SysLogf("获取待向量化文档分块统计失败 - EID: %d, Error: %v", eid, err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	// 获取待向量化的检索块数量
	pendingRetrievalChunks, err := getPendingEmbeddingRetrievalChunksCount(eid)
	if err != nil {
		logger.SysLogf("获取待向量化检索块统计失败 - EID: %d, Error: %v", eid, err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	// 获取失败的上传文件数量
	failedUploads, err := getFailedUploadsCount(eid)
	if err != nil {
		logger.SysLogf("获取失败上传文件统计失败 - EID: %d, Error: %v", eid, err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	response := &RecoveryStatsResponse{
		IncompleteParsingFiles:     parsingFiles,
		PendingEmbeddingChunks:     pendingChunks,
		PendingEmbeddingRetrievals: pendingRetrievalChunks,
		FailedUploads:              failedUploads,
		TotalIncompleteTasks:       parsingFiles + pendingChunks + pendingRetrievalChunks + failedUploads,
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(response))
}

// RecoveryResponse 恢复响应
type RecoveryResponse struct {
	Message string `json:"message"`
	Status  string `json:"status"`
}

// RecoveryStatsResponse 恢复统计响应
type RecoveryStatsResponse struct {
	IncompleteParsingFiles     int64 `json:"incomplete_parsing_files"`
	PendingEmbeddingChunks     int64 `json:"pending_embedding_chunks"`
	PendingEmbeddingRetrievals int64 `json:"pending_embedding_retrievals"`
	FailedUploads              int64 `json:"failed_uploads"`
	TotalIncompleteTasks       int64 `json:"total_incomplete_tasks"`
}

// getIncompleteParsingFilesCount 获取未完成解析的文件数量
func getIncompleteParsingFilesCount(eid int64) (int64, error) {
	var count int64
	err := model.DB.Model(&model.File{}).
		Where("eid = ? AND parsing_status = ?", eid, model.FileParsingStatusParsing).
		Count(&count).Error
	return count, err
}

// getPendingEmbeddingChunksCount 获取待向量化的文档分块数量
func getPendingEmbeddingChunksCount(eid int64) (int64, error) {
	var count int64
	err := model.DB.Model(&model.DocumentChunk{}).
		Where("eid = ? AND embedding_status = ?", eid, model.DocumentChunkEmbeddingStatusPending).
		Count(&count).Error
	return count, err
}

// getPendingEmbeddingRetrievalChunksCount 获取待向量化的检索块数量
func getPendingEmbeddingRetrievalChunksCount(eid int64) (int64, error) {
	var count int64
	err := model.DB.Model(&model.RetrievalChunk{}).
		Where("eid = ? AND embedding_status = ?", eid, model.RetrievalChunkEmbeddingStatusPending).
		Count(&count).Error
	return count, err
}

// getFailedUploadsCount 获取失败的上传文件数量
func getFailedUploadsCount(eid int64) (int64, error) {
	var count int64
	err := model.DB.Model(&model.UploadFile{}).
		Where("eid = ? AND status = ?", eid, "failed").
		Count(&count).Error
	return count, err
}

// RecoverFileChunking godoc
// @Summary 恢复指定文件的分块
// @Description 手动触发恢复指定文件的分块任务
// @Tags 文件管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param file_id path int true "文件ID"
// @Success 200 {object} model.CommonResponse{data=RecoveryFileResponse}
// @Router /api/files/{file_id}/recover-chunking [post]
func RecoverFileChunking(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	fileIDStr := c.Param("file_id")
	fileID, err := strconv.ParseInt(fileIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的文件ID")))
		return
	}

	// 检查权限
	permission, err := service.GetUserPermission(eid, model.RESOURCE_TYPE_FILE, fileID, userID)
	if err != nil || permission < model.PERMISSION_EDIT_KNOWLEDGE {
		c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(err))
		return
	}

	// 获取文件信息
	file, err := model.GetFileByID(eid, fileID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
		return
	}

	// 检查文件状态
	if file.ParsingStatus != model.FileParsingStatusParsing {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("文件不在解析状态")))
		return
	}

	logger.SysLogf("用户 %d 请求恢复文件分块 - EID: %d, FileID: %d", userID, eid, fileID)

	// 执行文件分块恢复
	err = service.RecoverParsingFileByID(eid, fileID)
	if err != nil {
		logger.SysLogf("恢复文件分块失败 - EID: %d, FileID: %d, Error: %v", eid, fileID, err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	response := &RecoveryFileResponse{
		FileID:  fileID,
		Message: "文件分块恢复已启动",
		Status:  "processing",
	}

	logger.SysLogf("文件分块恢复已启动 - EID: %d, FileID: %d", eid, fileID)
	c.JSON(http.StatusOK, model.Success.ToResponse(response))
}

// RecoveryFileResponse 文件恢复响应
type RecoveryFileResponse struct {
	FileID  int64  `json:"file_id"`
	Message string `json:"message"`
	Status  string `json:"status"`
}
