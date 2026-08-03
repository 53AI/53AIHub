package controller

import (
	"fmt"
	"net/http"
	"strconv"

	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/gin-gonic/gin"
)

type CreateUserGroupRequest struct {
	GroupType int64  `json:"group_type" binding:"required" example:"8"`
	GroupName string `json:"group_name" binding:"required" example:"我的录音"`
	Sort      int64  `json:"sort" example:"0"`
}

type UpdateUserGroupRequest struct {
	GroupName string `json:"group_name" binding:"required" example:"新分组名"`
}

type BatchSubmitUserGroupsRequest struct {
	Groups []service.BatchSubmitItem `json:"groups" binding:"required"`
}

// ListUserGroups godoc
// @Summary 列出当前用户的分组
// @Description 按 group_type 列出当前用户的分组，支持 future 扩展
// @Tags 用户分组
// @Produce json
// @Security BearerAuth
// @Param group_type path int true "分组类型（如 8=录音文件分组）"
// @Success 200 {object} model.CommonResponse{data=[]model.Group}
// @Router /api/user/groups/type/{group_type} [get]
func ListUserGroups(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	groupType, err := strconv.ParseInt(c.Param("group_type"), 10, 64)
	if err != nil || groupType <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(fmt.Errorf("group_type 参数无效")))
		return
	}

	svc := service.NewUserGroupService(eid)
	groups, err := svc.List(c, userID, groupType)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToErrorResponse(err))
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(groups))
}

// GetUserGroup godoc
// @Summary 获取单个用户分组
// @Description 获取当前用户的单个分组详情
// @Tags 用户分组
// @Produce json
// @Security BearerAuth
// @Param group_id path int true "分组ID"
// @Success 200 {object} model.CommonResponse{data=model.Group}
// @Router /api/user/groups/{group_id} [get]
func GetUserGroup(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	groupID, err := hashids.TryParseID(c.Param("group_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	group, err := model.GetGroupByID(groupID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
		return
	}
	if group.Eid != eid || group.CreatedBy != userID {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(nil))
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(group))
}

// CreateUserGroup godoc
// @Summary 创建用户分组
// @Description 创建当前用户的个人分组
// @Tags 用户分组
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body controller.CreateUserGroupRequest true "分组创建请求"
// @Success 200 {object} model.CommonResponse{data=model.Group}
// @Router /api/user/groups [post]
func CreateUserGroup(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	var req CreateUserGroupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	svc := service.NewUserGroupService(eid)
	group, err := svc.Create(c, userID, req.GroupName, req.GroupType, req.Sort)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToErrorResponse(err))
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(group))
}

// UpdateUserGroup godoc
// @Summary 更新用户分组
// @Description 重命名当前用户的个人分组
// @Tags 用户分组
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param group_id path int true "分组ID"
// @Param request body controller.UpdateUserGroupRequest true "分组更新请求"
// @Success 200 {object} model.CommonResponse
// @Router /api/user/groups/{group_id} [put]
func UpdateUserGroup(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	groupID, err := hashids.TryParseID(c.Param("group_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	var req UpdateUserGroupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	svc := service.NewUserGroupService(eid)
	if err := svc.Rename(c, userID, groupID, req.GroupName); err != nil {
		c.JSON(http.StatusForbidden, model.ForbiddenError.ToNewErrorResponse(err.Error()))
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(gin.H{"ok": true}))
}

// DeleteUserGroup godoc
// @Summary 删除用户分组
// @Description 删除当前用户的个人分组，分组内文件自动归入未分类
// @Tags 用户分组
// @Produce json
// @Security BearerAuth
// @Param group_id path int true "分组ID"
// @Success 200 {object} model.CommonResponse
// @Router /api/user/groups/{group_id} [delete]
func DeleteUserGroup(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	groupID, err := hashids.TryParseID(c.Param("group_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	svc := service.NewUserGroupService(eid)
	if err := svc.Delete(c, userID, groupID); err != nil {
		c.JSON(http.StatusForbidden, model.ForbiddenError.ToNewErrorResponse(err.Error()))
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(gin.H{"ok": true}))
}

// BatchSubmitUserGroups godoc
// @Summary 批量提交用户分组
// @Description 批量创建/更新/删除用户分组。group_id=0 创建，group_id>0 更新，不在列表中的删除
// @Tags 用户分组
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param group_type path int true "分组类型（如 8=录音文件分组）"
// @Param request body controller.BatchSubmitUserGroupsRequest true "批量分组请求"
// @Success 200 {object} model.CommonResponse
// @Router /api/user/groups/type/{group_type} [post]
func BatchSubmitUserGroups(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	groupType, err := strconv.ParseInt(c.Param("group_type"), 10, 64)
	if err != nil || groupType <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(fmt.Errorf("group_type 参数无效")))
		return
	}

	var req BatchSubmitUserGroupsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	svc := service.NewUserGroupService(eid)
	if err := svc.BatchSubmit(c, userID, groupType, req.Groups); err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToErrorResponse(err))
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(gin.H{"ok": true}))
}
