package controller

import (
	"net/http"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/gin-gonic/gin"
)

// ResourceScopeQuery 查询 resource scopes 的请求参数
type ResourceScopeQuery struct {
	ResourceID   int64  `form:"resource_id" json:"resource_id" binding:"required"`
	ResourceType string `form:"resource_type" json:"resource_type" binding:"required"`
}

// @Summary 获取指定资源的 scope 列表
// @Description 查询指定 resource_type + resource_id 的资源范围配置
// @Tags ResourceScope
// @Produce json
// @Security BearerAuth
// @Param resource_id query int true "资源 ID（hashID）"
// @Param resource_type query string true "资源类型，如 agent、space、library"
// @Success 200 {object} model.CommonResponse{data=[]model.ResourceScopeItem} "Success"
// @Router /api/resource-scopes [get]
func GetResourceScopes(c *gin.Context) {
	var q ResourceScopeQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	eid := config.GetEID(c)

	scopes, err := service.GetResourceScopes(q.ResourceID, q.ResourceType)
	if err != nil {
		logger.SysErrorf("获取资源范围失败: resource_id=%d, resource_type=%s, err=%v", q.ResourceID, q.ResourceType, err)
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
		return
	}

	// 转成 ResourceScopeItem 返回
	items := make([]model.ResourceScopeItem, 0, len(scopes))
	for _, s := range scopes {
		if s.Eid != eid {
			continue
		}
		items = append(items, model.ResourceScopeItem{
			ScopeType: s.ScopeType,
			TargetID:  s.TargetID,
		})
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(items))
}

// @Summary 全量替换指定资源的 scope
// @Description 替换指定 resource_type + resource_id 的资源范围（幂等，先删后插）
// @Tags ResourceScope
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param resource_id query int true "资源 ID（hashID）"
// @Param resource_type query string true "资源类型，如 agent、space、library"
// @Param scopes body []model.ResourceScopeItem true "scopes 数组"
// @Success 200 {object} model.CommonResponse "Success"
// @Router /api/resource-scopes [put]
func ReplaceResourceScopes(c *gin.Context) {
	var q ResourceScopeQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	var scopes []model.ResourceScopeItem
	if err := c.ShouldBindJSON(&scopes); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	eid := config.GetEID(c)

	tx := model.DB.Begin()
	if tx.Error != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
		return
	}

	if err := service.ReplaceResourceScopes(tx, q.ResourceID, q.ResourceType, scopes, eid); err != nil {
		tx.Rollback()
		logger.SysErrorf("替换资源范围失败: resource_id=%d, resource_type=%s, err=%v", q.ResourceID, q.ResourceType, err)
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
		return
	}

	if err := tx.Commit().Error; err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}

// @Summary 检查用户是否有权限访问指定资源
// @Description 根据 resource_scopes 判断当前用户是否有权限使用指定资源
// @Tags ResourceScope
// @Produce json
// @Security BearerAuth
// @Param resource_id query int true "资源 ID（hashID）"
// @Param resource_type query string true "资源类型，如 agent、space、library"
// @Success 200 {object} model.CommonResponse{data=bool} "是否有权限"
// @Router /api/resource-scopes/check [get]
func CheckResourceScopeAccess(c *gin.Context) {
	var q ResourceScopeQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		logger.SysDebugf("resource-scopes/check bind query failed: err=%v", err)
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	eid := config.GetEID(c)
	userID := config.GetUserId(c)
	logger.SysDebugf("resource-scopes/check request: user_id=%d eid=%d resource_id=%d resource_type=%s", userID, eid, q.ResourceID, q.ResourceType)

	accessible, err := service.CheckResourceScopeAccess(userID, eid, q.ResourceID, q.ResourceType)
	if err != nil {
		logger.SysErrorf("检查资源访问权限失败: resource_id=%d, resource_type=%s, user_id=%d, err=%v",
			q.ResourceID, q.ResourceType, userID, err)
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
		return
	}

	logger.SysDebugf("resource-scopes/check result: user_id=%d eid=%d resource_id=%d resource_type=%s accessible=%v", userID, eid, q.ResourceID, q.ResourceType, accessible)
	c.JSON(http.StatusOK, model.Success.ToResponse(accessible))
}
