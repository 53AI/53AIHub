package controller

import (
	"strconv"

	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/middleware"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/gin-gonic/gin"
)

// GetFileGraph godoc
// @Summary 获取文件图谱数据
// @Description 获取指定文件的图谱数据（实体和关系）
// @Tags 图谱
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param file_id path int true "文件ID"
// @Param limit query int false "返回实体数量上限" default(50)
// @Param entity_type query string false "按实体类型筛选"
// @Param keyword query string false "搜索关键词，匹配实体名称"
// @Success 200 {object} model.CommonResponse
// @Router /api/files/{file_id}/graph [get]
func GetFileGraph(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	// 解析文件ID
	fileID, ok := middleware.MustParseIDParam(c, "file_id")
	if !ok {
		return
	}

	// 检查文件权限
	permission, err := service.GetUserPermission(eid, model.RESOURCE_TYPE_FILE, fileID, userID)
	if err != nil || permission < model.PERMISSION_VIEW_ONLY {
		c.JSON(200, model.UnauthorizedError.ToResponse(nil))
		return
	}

	// 解析查询参数
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	entityType := c.Query("entity_type")
	keyword := c.Query("keyword")

	// 获取图谱数据
	data, err := service.GetFileGraphData(c.Request.Context(), eid, fileID, limit, entityType, keyword)
	if err != nil {
		c.JSON(200, model.NotFound.ToNewErrorResponse(err.Error()))
		return
	}

	c.JSON(200, model.Success.ToResponse(data))
}
