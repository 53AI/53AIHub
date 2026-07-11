package controller

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/gin-gonic/gin"
)

// GetCleanupStats godoc
// @Summary 获取清理统计信息
// @Description 获取孤儿数据的统计信息
// @Tags 数据清理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse{data=CleanupStats}
// @Router /api/cleanup/stats [get]
func GetCleanupStats(c *gin.Context) {
	eid := config.GetEID(c)

	stats, err := getCleanupStats(eid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(stats))
}

// CleanupOrphanedData godoc
// @Summary 清理孤儿数据
// @Description 清理所有孤儿数据（没有对应文件的分块、关联关系等）
// @Tags 数据清理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse
// @Router /api/cleanup/orphaned [post]
func CleanupOrphanedData(c *gin.Context) {
	eid := config.GetEID(c)

	// 异步执行清理
	go func() {
		if err := cleanupOrphanedData(eid); err != nil {
			// 记录错误日志
			// TODO: 可以考虑添加到系统日志表中
		}
	}()

	c.JSON(http.StatusOK, model.Success.ToResponse(map[string]interface{}{
		"message": "孤儿数据清理任务已启动，将在后台执行",
	}))
}

// CleanupFileData godoc
// @Summary 清理指定文件的相关数据
// @Description 清理指定文件的所有相关数据（分块、向量等）
// @Tags 数据清理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param file_id path int true "文件ID"
// @Success 200 {object} model.CommonResponse
// @Router /api/cleanup/file/{file_id} [post]
func CleanupFileData(c *gin.Context) {
	eid := config.GetEID(c)

	fileIDStr := c.Param("file_id")
	if fileIDStr == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("文件ID不能为空")))
		return
	}

	fileID, err := strconv.ParseInt(fileIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的文件ID")))
		return
	}

	// 异步执行清理
	go func() {
		if err := cleanupFileRelatedData(eid, fileID); err != nil {
			// 记录错误日志
			// TODO: 可以考虑添加到系统日志表中
		}
	}()

	c.JSON(http.StatusOK, model.Success.ToResponse(map[string]interface{}{
		"message": "文件数据清理任务已启动，将在后台执行",
		"file_id": fileID,
	}))
}

// GetFileDeletionStatsAPI godoc
// @Summary 获取文件删除统计信息
// @Description 获取删除指定文件时将会影响的数据统计
// @Tags 数据清理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param file_id path int true "文件ID"
// @Success 200 {object} model.CommonResponse{data=FileDeletionStatsResponse}
// @Router /api/cleanup/file/{file_id}/stats [get]
func GetFileDeletionStatsAPI(c *gin.Context) {
	eid := config.GetEID(c)

	fileIDStr := c.Param("file_id")
	if fileIDStr == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("文件ID不能为空")))
		return
	}

	fileID, err := strconv.ParseInt(fileIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的文件ID")))
		return
	}

	// 获取文件信息
	file, err := model.GetFileByID(eid, fileID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
		return
	}

	// 获取删除统计信息
	stats, err := model.GetFileDeletionStats(eid, fileID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	response := &FileDeletionStatsResponse{
		FileID:          fileID,
		FileName:        file.Path,
		FileType:        file.Type,
		DocumentChunks:  stats.DocumentChunks,
		RetrievalChunks: stats.RetrievalChunks,
		Relations:       stats.Relations,
		Vectors:         stats.Vectors,
		OperationLogs:   stats.OperationLogs,
		EstimatedTime:   stats.EstimateDeletionTime(),
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(response))
}

// FileDeletionStatsResponse 文件删除统计响应
type FileDeletionStatsResponse struct {
	FileID          int64  `json:"file_id"`
	FileName        string `json:"file_name"`
	FileType        int    `json:"file_type"`
	DocumentChunks  int64  `json:"document_chunks"`
	RetrievalChunks int64  `json:"retrieval_chunks"`
	Relations       int64  `json:"relations"`
	Vectors         int64  `json:"vectors"`
	OperationLogs   int64  `json:"operation_logs"`
	EstimatedTime   string `json:"estimated_time"`
}

// CleanupStats 清理统计信息
type CleanupStats struct {
	EID                     int64 `json:"eid"`
	OrphanedDocumentChunks  int64 `json:"orphaned_document_chunks"`
	OrphanedRetrievalChunks int64 `json:"orphaned_retrieval_chunks"`
	OrphanedRelations       int64 `json:"orphaned_relations"`
	OrphanedOperationLogs   int64 `json:"orphaned_operation_logs"`
}

// getCleanupStats 获取清理统计信息
func getCleanupStats(eid int64) (*CleanupStats, error) {
	stats := &CleanupStats{EID: eid}

	// 统计孤儿文档分块
	err := model.DB.Model(&model.DocumentChunk{}).Where(`eid = ? AND file_id NOT IN (
		SELECT id FROM files WHERE eid = ?
	)`, eid, eid).Count(&stats.OrphanedDocumentChunks).Error
	if err != nil {
		return nil, err
	}

	// 统计孤儿检索块
	err = model.DB.Model(&model.RetrievalChunk{}).Where(`eid = ? AND file_id NOT IN (
		SELECT id FROM files WHERE eid = ?
	)`, eid, eid).Count(&stats.OrphanedRetrievalChunks).Error
	if err != nil {
		return nil, err
	}

	// 统计孤儿关联关系
	err = model.DB.Model(&model.ChunkRelation{}).Where(`eid = ? AND file_id NOT IN (
		SELECT id FROM files WHERE eid = ?
	)`, eid, eid).Count(&stats.OrphanedRelations).Error
	if err != nil {
		return nil, err
	}

	// 统计孤儿操作日志
	err = model.DB.Model(&model.ChunkOperationLog{}).Where(`eid = ? AND file_id NOT IN (
		SELECT id FROM files WHERE eid = ?
	)`, eid, eid).Count(&stats.OrphanedOperationLogs).Error
	if err != nil {
		return nil, err
	}

	return stats, nil
}

// cleanupOrphanedData 清理孤儿数据
func cleanupOrphanedData(eid int64) error {
	// 开启事务
	tx := model.DB.Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	// 清理孤儿文档分块
	err := tx.Where(`eid = ? AND file_id NOT IN (
		SELECT id FROM files WHERE eid = ?
	)`, eid, eid).Delete(&model.DocumentChunk{}).Error
	if err != nil {
		tx.Rollback()
		return err
	}

	// 清理孤儿检索块
	err = tx.Where(`eid = ? AND file_id NOT IN (
		SELECT id FROM files WHERE eid = ?
	)`, eid, eid).Delete(&model.RetrievalChunk{}).Error
	if err != nil {
		tx.Rollback()
		return err
	}

	// 清理孤儿关联关系
	err = tx.Where(`eid = ? AND file_id NOT IN (
		SELECT id FROM files WHERE eid = ?
	)`, eid, eid).Delete(&model.ChunkRelation{}).Error
	if err != nil {
		tx.Rollback()
		return err
	}

	// 清理孤儿操作日志
	err = tx.Where(`eid = ? AND file_id NOT IN (
		SELECT id FROM files WHERE eid = ?
	)`, eid, eid).Delete(&model.ChunkOperationLog{}).Error
	if err != nil {
		tx.Rollback()
		return err
	}

	return tx.Commit().Error
}

// cleanupFileRelatedData 清理文件相关数据
func cleanupFileRelatedData(eid int64, fileID int64) error {
	// 开启事务
	tx := model.DB.Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	// 删除分块关联关系
	err := tx.Where("eid = ? AND file_id = ?", eid, fileID).Delete(&model.ChunkRelation{}).Error
	if err != nil {
		tx.Rollback()
		return err
	}

	// 删除检索块
	err = tx.Where("eid = ? AND file_id = ?", eid, fileID).Delete(&model.RetrievalChunk{}).Error
	if err != nil {
		tx.Rollback()
		return err
	}

	// 删除文档分块
	err = tx.Where("eid = ? AND file_id = ?", eid, fileID).Delete(&model.DocumentChunk{}).Error
	if err != nil {
		tx.Rollback()
		return err
	}

	// 删除操作日志
	err = tx.Where("eid = ? AND file_id = ?", eid, fileID).Delete(&model.ChunkOperationLog{}).Error
	if err != nil {
		tx.Rollback()
		return err
	}

	// 删除文件内容
	err = tx.Where("eid = ? AND file_id = ?", eid, fileID).Delete(&model.FileBody{}).Error
	if err != nil {
		tx.Rollback()
		return err
	}

	return tx.Commit().Error
}

// RepairEntityVectorsByEID godoc
// @Summary 修复企业实体向量索引
// @Description 按企业ID批量重新索引实体向量（需要管理权限）
// @Tags 数据清理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse
// @Router /api/cleanup/entity-vectors/repair [post]
func RepairEntityVectorsByEID(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	if eid <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse(model.InvalidEnterpriseID))
		return
	}
	if userID <= 0 {
		c.JSON(http.StatusUnauthorized, model.AuthFailed.ToResponse(errors.New("用户未登录或无效")))
		return
	}

	// 异步执行
	go func() {
		ctx := context.Background()
		logger.Info(ctx, fmt.Sprintf("开始执行实体向量重建任务 - EID: %d, Operator: %d", eid, userID))

		svc := service.NewEntityVectorRepairService(model.DB)
		result, err := svc.RepairEntityVectorIndex(ctx, eid)
		if err != nil {
			if errors.Is(err, service.ErrPermissionDenied) {
				logger.Warn(ctx, fmt.Sprintf("实体向量重建权限不足 - EID: %d, Err: %v", eid, err))
			} else {
				logger.Error(ctx, fmt.Sprintf("实体向量重建失败 - EID: %d, Err: %v", eid, err))
			}
			return
		}

		logger.Info(ctx, fmt.Sprintf("实体向量重建完成 - EID: %d, Total: %d, Indexed: %d, Failed: %d",
			eid, result.Total, result.Indexed, result.Failed))
	}()

	c.JSON(http.StatusOK, model.Success.ToResponse(map[string]interface{}{
		"message": "实体向量重建任务已启动，将在后台执行",
	}))
}
