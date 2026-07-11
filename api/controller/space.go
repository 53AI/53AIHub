package controller

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	mcpsvc "github.com/53AI/53AIHub/service/mcp"
	"github.com/gin-gonic/gin"
)

type SpaceRequest struct {
	// 空间名称，必填项
	Name string `json:"name" binding:"required" example:"产品文档空间"`

	// 空间描述
	Description string `json:"description" example:"存放产品相关文档和资料"`

	// 空间图标URL
	Icon string `json:"icon" example:"/static/icons/space-icon.png"`

	// 可见性：0-私有，1-公开（全公司可见）
	Visibility int `json:"visibility" example:"0"`

	// 默认权限配置，可选参数
	// 用于在创建空间时为指定用户或分组设置权限
	// 支持为用户(0)或分组(1)设置权限级别：2-仅查看，6-可管理
	Permissions []*model.PermissionData `json:"permissions"`
}

type SpaceSortRequest struct {
	Spaces []struct {
		ID   int64 `json:"id" binding:"required"`
		Sort int64 `json:"sort" binding:"required"`
	} `json:"spaces" binding:"required"`
}

// CreateSpace godoc
// @Summary 创建空间
// @Description 创建团队空间接口
// @Description 支持在创建时设置默认权限，通过permissions参数指定
// @Tags 空间管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body SpaceRequest true "空间信息"
// @Success 200 {object} model.CommonResponse{data=model.Space}
// @Router /api/spaces [post]
func CreateSpace(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	var req SpaceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 检查功能是否可用
	params := map[string]interface{}{
		"from": "space",
		"op":   "add",
	}
	_, err := service.IsFeatureAvailable(c, "knowledge_base", params)
	if err != nil {
		c.JSON(http.StatusForbidden, model.FeatureNotAvailableError.ToResponse(err))
		return
	}

	spaceService := mcpsvc.NewSpaceService()
	space, err := spaceService.CreateSpace(c.Request.Context(), eid, userID, req.Name, req.Description, req.Icon, req.Visibility, req.Permissions)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(err))
		return
	}

	// 记录系统日志
	LogSpaceCreate(c, space.Name)
	space.LoadOwnerInfo(eid)
	space.LoadLibraryCount(eid)

	c.JSON(http.StatusOK, model.Success.ToResponse(space))
}

// GetSpaces godoc
// @Summary 获取空间列表
// @Description 获取用户所属的空间列表，支持状态筛选和名称模糊查询
// @Tags 空间管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param status query int false "空间状态(-1:全部,0:active,1:archived)" default(-1) Enums(-1,0,1)
// @Param name query string false "空间名称模糊查询"
// @Param offset query int false "分页偏移量，默认为0"
// @Param limit query int false "每页条数，默认为10"
// @Param view query string false "查看视角 admin,user（前台后台两种权限， 默认为前台 ）"
// @Success 200 {object} model.CommonResponse{data=model.SpaceListResponse} "Success"
// @Router /api/spaces [get]
func GetSpaces(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	// 检查功能是否可用
	params := map[string]interface{}{
		"from": "space",
	}
	_, err := service.IsFeatureAvailable(c, "knowledge_base", params)
	if err != nil {
		c.JSON(http.StatusForbidden, model.FeatureNotAvailableError.ToResponse(err))
		return
	}

	statusStr := c.Query("status")
	status := -1
	if statusStr != "" {
		if s, err := strconv.Atoi(statusStr); err == nil {
			status = s
		}
	}

	view := c.Query("view")

	// 解析名称模糊查询参数
	name := c.Query("name")

	// 解析分页参数
	offsetStr := c.Query("offset")
	offset := 0
	if offsetStr != "" {
		if o, err := strconv.Atoi(offsetStr); err == nil {
			offset = o
		}
	}

	limitStr := c.Query("limit")
	limit := 10
	if limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil {
			limit = l
		}
	}

	// 获取空间服务
	sps := service.NewSpacePermissionService(eid)

	var count int64
	var spaces []model.Space
	var err2 error
	if view == "user" {
		// 获取用户所属的空间(带筛选条件和分页)
		count, spaces, err2 = sps.GetUserSpaces(userID, status, name, offset, limit)
	} else {
		if !common.IsAdmin(c) {
			c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(nil))
			return
		}
		count, spaces, err2 = sps.GetAdminSpaces(userID, status, name, offset, limit)
	}

	if err2 != nil {
		c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(err2))
		return
	}

	domain := config.GetProtocol(c) + "://" + config.GetDomain(c)
	for i := range spaces {
		if icon := spaces[i].Icon; len(icon) > 0 && icon[0] == '/' {
			spaces[i].Icon = domain + icon
		}
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(model.SpaceListResponse{
		Count:  count,
		Spaces: spaces,
	}))
}

// GetSpace godoc
// @Summary 获取空间详情
// @Description 获取指定空间的详细信息
// @Tags 空间管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param space_id path int true "空间ID"
// @Success 200 {object} model.CommonResponse{data=model.Space}
// @Router /api/spaces/{space_id} [get]
func GetSpace(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	id := c.Param("space_id")
	if id == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("空间ID不能为空")))
		return
	}

	spaceID, err := strconv.ParseInt(id, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的空间ID")))
		return
	}

	// 检查功能是否可用
	params := map[string]interface{}{
		"from": "space",
	}
	_, featureErr := service.IsFeatureAvailable(c, "space", params)
	if featureErr != nil {
		c.JSON(http.StatusForbidden, model.FeatureNotAvailableError.ToResponse(featureErr))
		return
	}

	// 检查用户是否是空间成员
	sps := service.NewSpacePermissionService(eid)
	canViewSpc, err := sps.CheckSpacePermission(userID, spaceID, model.PERMISSION_PUBLIC_ONLY)

	if (!canViewSpc || err != nil) && !common.IsAdmin(c) {
		logger.SysLogf("User %d has no permission to access space %d", userID, spaceID)
		c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(errors.New("无权限访问此空间")))
		return
	}

	space, err := model.GetSpaceByID(eid, spaceID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
		return
	}

	// 获取用户对该空间的实际权限值（管理员跳过权限获取，直接设为管理权限）
	if common.IsAdmin(c) {
		space.Permission = model.PERMISSION_MANAGE
	} else {
		permission, err := sps.GetUserSpacePermission(userID, spaceID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
			return
		}
		space.Permission = permission
	}

	domain := config.GetProtocol(c) + "://" + config.GetDomain(c)
	if icon := space.Icon; len(icon) > 0 && icon[0] == '/' {
		space.Icon = domain + icon
	}

	space.LoadOwnerInfo(eid)
	space.LoadLibraryCount(eid)

	c.JSON(http.StatusOK, model.Success.ToResponse(space))
}

// UpdateSpace godoc
// @Summary 更新空间信息
// @Description 更新空间的基本信息
// @Tags 空间管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param space_id path int true "空间ID"
// @Param request body SpaceRequest true "空间信息"
// @Success 200 {object} model.CommonResponse{data=model.Space}
// @Router /api/spaces/{space_id} [put]
func UpdateSpace(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	id := c.Param("space_id")
	if id == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("空间ID不能为空")))
		return
	}

	spaceID, err := strconv.ParseInt(id, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的空间ID")))
		return
	}

	// 检查功能是否可用
	params := map[string]interface{}{
		"from": "space",
	}
	_, featureErr := service.IsFeatureAvailable(c, "space", params)
	if featureErr != nil {
		c.JSON(http.StatusForbidden, model.FeatureNotAvailableError.ToResponse(featureErr))
		return
	}

	sps := service.NewSpacePermissionService(eid)
	canEditSpc, err := sps.CheckSpacePermission(userID, spaceID, model.PERMISSION_MANAGE)

	if (!canEditSpc || err != nil) && !common.IsAdmin(c) {
		c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(errors.New("无权限修改此空间")))
		return
	}

	var req SpaceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	space, err := model.GetSpaceByID(eid, spaceID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
		return
	}

	// 保存原始数据用于日志记录
	oldSpace := *space

	space.Name = req.Name
	space.Description = req.Description
	space.Icon = req.Icon

	// 处理可见性更新
	visibility := req.Visibility

	space.Visibility = visibility

	// 处理权限更新（完全重建模式）
	if len(req.Permissions) > 0 {
		if err := sps.UpdateSpacePermissions(spaceID, userID, req.Permissions); err != nil {
			logger.SysErrorf("Failed to update permissions for space %d: %v", space.ID, err)
			// 权限更新失败不影响基本信息更新，只记录日志
		}
	}

	// 处理全公司权限变更 - 使用SpacePermissionService
	if err := sps.UpdateSpaceVisibilityPermission(space, visibility); err != nil {
		logger.SysErrorf("Failed to update visibility permissions for space %d: %v", space.ID, err)
	}

	if err := space.Update(); err != nil {
		c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(err))
		return
	}

	space.LoadOwnerInfo(eid)
	space.LoadLibraryCount(eid)

	// 记录变更日志
	fieldMap := map[string]string{
		"Name":        "名称",
		"Description": "描述",
		"Icon":        "图标",
	}
	model.LogEntityChange("空间", model.SystemLogActionUpdate, eid, userID, config.GetUserNickname(c), model.SystemLogModuleSpace, &oldSpace, space, c.ClientIP(), fieldMap)

	c.JSON(http.StatusOK, model.Success.ToResponse(space))
}

// DeleteSpace godoc
// @Summary 删除空间
// @Description 删除指定的空间
// @Tags 空间管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param space_id path int true "空间ID"
// @Success 200 {object} model.CommonResponse
// @Router /api/spaces/{space_id} [delete]
func DeleteSpace(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	id := c.Param("space_id")
	if id == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("空间ID不能为空")))
		return
	}

	spaceID, err := strconv.ParseInt(id, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的空间ID")))
		return
	}

	// 检查功能是否可用
	params := map[string]interface{}{
		"from": "space",
	}
	_, featureErr := service.IsFeatureAvailable(c, "space", params)
	if featureErr != nil {
		c.JSON(http.StatusForbidden, model.FeatureNotAvailableError.ToResponse(featureErr))
		return
	}

	sps := service.NewSpacePermissionService(eid)
	canEditSpc, err := sps.CheckSpacePermission(userID, spaceID, model.PERMISSION_MANAGE)

	if (!canEditSpc || err != nil) && !common.IsAdmin(c) {
		c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(errors.New("无权限删除此空间")))
		return
	}

	// 获取空间信息用于日志记录
	space, err := model.GetSpaceByID(eid, spaceID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
		return
	}

	if err := model.DeleteSpace(eid, spaceID); err != nil {
		c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(err))
		return
	}

	// 记录删除日志
	LogSpaceDelete(c, space.Name)

	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}

// BatchUpdateSpaceSort godoc
// @Summary 批量更新空间排序
// @Description 批量更新空间的排序顺序
// @Tags 空间管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body SpaceSortRequest true "空间排序信息"
// @Success 200 {object} model.CommonResponse
// @Router /api/spaces/sort [post]
func BatchUpdateSpaceSort(c *gin.Context) {
	eid := config.GetEID(c)

	// 检查功能是否可用
	params := map[string]interface{}{
		"from": "space",
	}
	_, err := service.IsFeatureAvailable(c, "knowledge_base", params)
	if err != nil {
		c.JSON(http.StatusForbidden, model.FeatureNotAvailableError.ToResponse(err))
		return
	}

	var req SpaceSortRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	if !common.IsAdmin(c) {
		c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(errors.New("无权限操作此空间")))
		return
	}

	if err := model.BatchUpdateSpaceSort(eid, req.Spaces); err != nil {
		c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(err))
		return
	}

	// 记录批量排序日志
	LogSpaceBatchSort(c, len(req.Spaces))

	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}
