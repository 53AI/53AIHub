package controller

import (
	"fmt"
	"net/http"
	"path/filepath"
	"strconv"

	"github.com/53AI/53AIHub/common/utils"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/gin-gonic/gin"
)

// FileBodyVersionRequest 版本请求结构
type FileBodyVersionRequest struct {
	Version string `json:"version" binding:"required" example:"v1.0.0"`
}

// CreateFileBodyVersion 创建/保存版本
// @Summary 创建文件版本
// @Description 为指定的file_body创建版本记录
// @Tags 文件版本管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param file_body_id path int true "FileBody ID"
// @Param request body FileBodyVersionRequest true "版本信息"
// @Success 201 {object} model.CommonResponse{data=model.FileBodyVersion}
// @Failure 400 {object} model.CommonResponse
// @Failure 500 {object} model.CommonResponse
// @Router /api/file-body-versions/file-body/{file_body_id} [post]
func CreateFileBodyVersion(c *gin.Context) {
	// 获取file_body_id
	fileBodyIDStr := c.Param("file_body_id")
	fileBodyID, err := strconv.ParseInt(fileBodyIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	eid := config.GetEID(c)
	// userID := config.GetUserId(c)

	// 解析请求体
	var req FileBodyVersionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 验证file_body是否存在
	fileBody, err := model.GetFileBodyByID(fileBodyID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
		return
	}

	// 获取文件信息以检查权限
	file, err := model.GetFileByID(eid, fileBody.FileID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
		return
	}

	// 创建版本记录
	version := &model.FileBodyVersion{
		FileBodyID: fileBodyID,
		FileID:     fileBody.FileID,
		Version:    req.Version,
	}

	if err := version.Save(); err != nil {
		c.JSON(http.StatusBadRequest, model.FileError.ToResponse(err))
		return
	}

	// 记录系统日志
	library, _ := model.GetLibraryByID(eid, file.LibraryID)
	space, _ := model.GetSpaceByID(eid, library.SpaceID)

	fileName := filepath.Base(file.Path)
	log := model.SystemLog{
		Eid:      eid,
		UserID:   config.GetUserId(c),
		Nickname: config.GetUserNickname(c),
		Module:   model.SystemLogModuleLibrary,
		Action:   model.SystemLogActionCreate,
		Content:  fmt.Sprintf("【%s】知识库【%s】的《%s》文档创建了版本 %s", space.Name, library.Name, fileName, req.Version),
		IP:       utils.GetClientIP(c),
	}
	model.CreateSystemLog(&log)

	c.JSON(http.StatusCreated, model.Success.ToResponse(version))
}

// UpdateFileBodyVersion 编辑版本名
// @Summary 更新版本名称
// @Description 更新指定版本的名称
// @Tags 文件版本管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "版本ID"
// @Param request body FileBodyVersionRequest true "版本信息"
// @Success 200 {object} model.CommonResponse{data=model.FileBodyVersion}
// @Failure 400 {object} model.CommonResponse
// @Failure 404 {object} model.CommonResponse
// @Failure 500 {object} model.CommonResponse
// @Router /api/file-body-versions/{id} [put]
func UpdateFileBodyVersion(c *gin.Context) {
	// 获取版本ID
	idStr := c.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// eid := config.GetEID(c)
	// userID := config.GetUserId(c)

	// 获取版本记录
	version, err := model.GetFileBodyVersionByID(id)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
		return
	}

	// // 获取关联的file_body以检查权限
	// fileBody, err := model.GetFileBodyByID(version.FileBodyID)
	// if err != nil {
	// 	c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
	// 	return
	// }

	// // 获取文件信息以检查权限
	// file, err := model.GetFileByID(eid, fileBody.FileID)
	// if err != nil {
	// 	c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
	// 	return
	// }

	// 解析请求体
	var req FileBodyVersionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 更新版本名称
	version.Version = req.Version
	if err := version.Update(); err != nil {
		c.JSON(http.StatusBadRequest, model.FileError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(version))
}

// DeleteFileBodyVersion 删除版本
// @Summary 删除版本
// @Description 删除指定的版本记录
// @Tags 文件版本管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "版本ID"
// @Success 200 {object} model.CommonResponse
// @Failure 400 {object} model.CommonResponse
// @Failure 404 {object} model.CommonResponse
// @Failure 500 {object} model.CommonResponse
// @Router /api/file-body-versions/{id} [delete]
func DeleteFileBodyVersion(c *gin.Context) {
	// 获取版本ID
	idStr := c.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// eid := config.GetEID(c)
	// userID := config.GetUserId(c)

	// 获取版本记录
	version, err := model.GetFileBodyVersionByID(id)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
		return
	}

	// 获取关联的file_body以检查权限
	// fileBody, err := model.GetFileBodyByID(version.FileBodyID)
	// if err != nil {
	// 	c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
	// 	return
	// }

	// // 获取文件信息以检查权限
	// file, err := model.GetFileByID(eid, fileBody.FileID)
	// if err != nil {
	// 	c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
	// 	return
	// }

	// 删除版本
	if err := version.Delete(); err != nil {
		c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse("版本删除成功"))
}

// GetFileBodyVersionList 获取版本列表
// @Summary 获取文件的所有版本列表
// @Description 根据文件ID获取该文件下所有FileBody的版本信息
// @Tags 文件版本管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param file_id path int true "文件ID"
// @Param offset query int false "偏移量" default(0)
// @Param limit query int false "限制数量" default(20)
// @Success 200 {object} model.CommonResponse{data=object}
// @Failure 400 {object} model.CommonResponse
// @Failure 500 {object} model.CommonResponse
// @Router /api/file-body-versions/{file_id} [get]
func GetFileBodyVersionList(c *gin.Context) {
	fileIDStr := c.Param("file_id")
	fileID, err := strconv.ParseInt(fileIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	eid := config.GetEID(c)
	// userID := config.GetUserId(c)

	// 获取文件信息以检查权限
	_, err = model.GetFileByID(eid, fileID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
		return
	}

	// 检查用户是否有知识库读权限
	// hasPermission, err := model.HasLibraryReadPermission(eid, file.LibraryID, userID)
	// if err != nil || !hasPermission {
	// 	c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(errors.New("无权限访问此文件")))
	// 	return
	// }

	// 解析查询参数
	var offsetParams model.OffsetParams
	if err := c.ShouldBindQuery(&offsetParams); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 设置默认值
	if offsetParams.Limit == 0 {
		offsetParams.Limit = 20
	}

	// 获取该文件下所有版本信息
	versions, total, err := model.GetFileVersionsByFileID(eid, fileID, offsetParams)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(err))
		return
	}

	response := map[string]interface{}{
		"versions": versions,
		"total":    total,
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(response))
}
