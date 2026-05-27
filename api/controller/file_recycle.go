package controller

import (
	"errors"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/53AI/53AIHub/service/elasticsearch"
	"github.com/gin-gonic/gin"
)

// RestoreFileRequest 恢复文件请求结构体
type RestoreFileRequest struct {
	RestoreToRootIfParentMissing bool `json:"restore_to_root_if_parent_missing"`
}

type RecycleBinListResponse struct {
	Items []model.File `json:"items"`
	Count int64        `json:"count"`
}

// ListRecycleBin godoc
// @Summary 回收站列表
// @Description 仅显示主动删除的文件/文件夹（分页）
// @Tags 文件管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param library_id query int true "知识库ID"
// @Param offset query int false "offset" default(0)
// @Param limit query int false "limit" default(20)
// @Param sort query string false "排序方式" Enums(asc, desc) default(desc)
// @Param q query string false "名称关键词（模糊匹配）"
// @Param deleted_by query int false "删除人ID（仅显示该用户主动删除的文件）"
// @Success 200 {object} model.CommonResponse{data=RecycleBinListResponse}
// @Router /api/files/recycle-bin [get]
func ListRecycleBin(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	libraryIDStr := c.Query("library_id")
	if libraryIDStr == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("知识库ID不能为空")))
		return
	}
	libraryID, err := strconv.ParseInt(libraryIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的知识库ID")))
		return
	}
	nameKeyword := strings.TrimSpace(c.DefaultQuery("q", ""))
	deletedBy, _ := strconv.ParseInt(c.DefaultQuery("deleted_by", ""), 10, 64)

	// 权限
	maxPermission, err := service.GetUserPermission(eid, model.RESOURCE_TYPE_LIBRARY, libraryID, userID)
	if err != nil || maxPermission < model.PERMISSION_MANAGE {
		c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(errors.New("无权限管理该知识库")))
		return
	}

	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	sort := c.DefaultQuery("sort", "desc")

	files, count, err := model.ListRecycleBin(eid, libraryID, offset, limit, sort, nameKeyword, deletedBy)
	if err != nil {
		logger.SysLogf("回收站查询失败 eid=%d library=%d err=%v", eid, libraryID, err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(map[string]interface{}{
		"items": files,
		"count": count}))
}

// RestoreFile godoc
// @Summary 恢复文件或文件夹
// @Description 恢复被软删除的文件（支持根据参数在父级不存在时恢复到根目录）
// @Tags 文件管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param file_id path int true "文件ID"
// @Param request body RestoreFileRequest false "恢复文件请求参数"
// @Success 200 {object} model.CommonResponse
// @Router /api/files/{file_id}/restore [post]
func RestoreFile(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	id := c.Param("file_id")
	if id == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("文件ID不能为空")))
		return
	}
	fileID, err := parseMCPStyleID(id)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的文件ID")))
		return
	}
	file, err := model.GetFileByID(eid, fileID)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的文件ID")))
		return
	}

	// 权限
	maxPermission, err := service.GetUserPermission(eid, model.RESOURCE_TYPE_LIBRARY, file.LibraryID, userID)
	if err != nil || maxPermission < model.PERMISSION_MANAGE {
		c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(errors.New("无权限管理该知识库")))
		return
	}

	// 解析请求体参数
	var req RestoreFileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		// 如果没有提供请求体或解析失败，使用默认值
		req.RestoreToRootIfParentMissing = false
	}

	if err := model.RestoreDeletedFile(eid, fileID, req.RestoreToRootIfParentMissing, userID); err != nil {
		logger.SysLogf("恢复失败: eid=%d fileID=%d userID=%d err=%v", eid, fileID, userID, err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}
	common.DeleteFileStopCache(fileID) // 删除文件的停止信号缓存

	// 更新 file 对象的 IsDeleted 状态，确保 ES 索引正确
	file.IsDeleted = false

	// 恢复完成后，重新建立 Elasticsearch 索引
	go indexRestoredFilesAsync(eid, file)

	// 记录系统日志
	library, _ := model.GetLibraryByID(eid, file.LibraryID)
	space, _ := model.GetSpaceByID(eid, library.SpaceID)
	fileName := filepath.Base(file.Path)

	log := model.SystemLog{
		Eid:      eid,
		UserID:   userID,
		Nickname: config.GetUserNickname(c),
		Module:   model.SystemLogModuleFile,
		Action:   model.SystemLogActionRestore,
		Content:  "恢复了《" + fileName + "》于知识库【" + library.Name + "】空间【" + space.Name + "】",
		IP:       utils.GetClientIP(c),
	}
	model.CreateSystemLog(&log)

	c.JSON(http.StatusOK, model.Success.ToResponse(map[string]interface{}{
		"restored": true,
		"time":     time.Now().UnixMilli(),
	}))
}

// indexRestoredFilesAsync 异步为恢复的文件建立 Elasticsearch 索引
func indexRestoredFilesAsync(eid int64, file *model.File) {
	// 如果恢复的是文件夹，则需要为文件夹下所有文件建立索引
	if file.Type == model.FILE_TYPE_DIR {
		// 获取文件夹下所有文件
		children, err := model.GetChildrenByPathPrefix(eid, file.Path)
		if err != nil {
			logger.SysLogf("获取文件夹下文件列表失败: eid=%d path=%s err=%v", eid, file.Path, err)
		} else {
			// 为文件夹下所有文件建立索引
			for _, child := range children {
				if child.Type == model.FILE_TYPE_FILE && !child.IsDeleted {
					elasticsearch.SyncFileToES(&child, "create")
					common.DeleteFileStopCache(child.ID) // 设置文件为已恢复状态
				}
			}
		}
	} else {
		// 为单个文件建立索引
		elasticsearch.SyncFileToES(file, "create")
	}
}

// HardDeleteFile godoc
// @Summary 管理员彻底删除文件
// @Description 彻底删除文件及其相关数据（父级彻删同时删除已标记删除且非主动的子级）
// @Tags 文件管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param file_id path int true "文件ID"
// @Success 200 {object} model.CommonResponse
// @Router /api/files/{file_id}/hard-delete [delete]
func HardDeleteFile(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	id := c.Param("file_id")
	if id == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("文件ID不能为空")))
		return
	}
	fileID, err := parseMCPStyleID(id)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的文件ID")))
		return
	}

	file, _ := model.GetFileByID(eid, fileID)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的文件ID")))
		return
	}

	// 权限
	maxPermission, err := service.GetUserPermission(eid, model.RESOURCE_TYPE_LIBRARY, file.LibraryID, userID)
	if err != nil || maxPermission < model.PERMISSION_MANAGE {
		c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(errors.New("无权限管理该知识库")))
		return
	}

	if err := model.DeleteFile(eid, fileID); err != nil {
		logger.SysLogf("管理员彻底删除失败: eid=%d fileID=%d userID=%d err=%v", eid, fileID, userID, err)
		c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}
