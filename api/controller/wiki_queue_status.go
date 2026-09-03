package controller

import (
	"net/http"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type WikiQueueStatusController struct {
	db        *gorm.DB
	statusSvc service.WikiQueueStatusService
}

func NewWikiQueueStatusController(db *gorm.DB) *WikiQueueStatusController {
	return &WikiQueueStatusController{db: db, statusSvc: service.NewWikiQueueStatusService(db, common.RDB)}
}

// GetStatus 获取当前企业 Wiki 两条流水线的队列状态。
// @Summary 获取 Wiki 队列状态
// @Description 获取 Wiki 页面生成和页面向量化队列的排队数、运行数和总数。企业范围取当前登录用户上下文，不接受前端传入 eid；可传空间 ID 只看该空间的队列。
// @Tags Wiki 队列
// @Produce json
// @Security BearerAuth
// @Param space_id query int false "空间ID，可选；不传返回企业全部队列状态"
// @Success 200 {object} model.CommonResponse{data=service.WikiQueueStatusResponse}
// @Failure 400 {object} model.CommonResponse "企业上下文无效或空间不存在"
// @Failure 500 {object} model.CommonResponse "队列状态获取失败"
// @Router /api/wiki/queue/status [get]
func (c *WikiQueueStatusController) GetStatus(ctx *gin.Context) {
	eid := config.GetEID(ctx)
	if eid <= 0 {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse("企业上下文无效"))
		return
	}

	spaceID, ok := parseOptionalQueryInt64(ctx, "space_id")
	if !ok {
		return
	}
	if spaceID > 0 {
		var space model.Space
		if err := c.db.WithContext(ctx.Request.Context()).Where("eid = ? AND id = ?", eid, spaceID).First(&space).Error; err != nil {
			ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse("空间不存在或无权访问"))
			return
		}
	}

	status, err := c.statusSvc.GetStatus(ctx.Request.Context(), eid, spaceID)
	if err != nil {
		logger.Errorf(ctx.Request.Context(), "get wiki queue status failed: %v", err)
		ctx.JSON(http.StatusInternalServerError, model.SystemError.ToResponse("获取 Wiki 队列状态失败"))
		return
	}
	ctx.JSON(http.StatusOK, model.Success.ToResponse(status))
}
