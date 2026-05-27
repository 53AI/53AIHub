package controller

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/gin-gonic/gin"
)

type WsConnectionListResponse struct {
	Connections []service.ConnectionInfo `json:"connections"`
	Total       int64                    `json:"total"`
	Page        int                      `json:"page"`
	PageSize    int                      `json:"page_size"`
	TotalPage   int64                    `json:"total_page"`
}

var wsAdminService = service.NewWsAdminService()

// @Summary 获取WebSocket连接列表
// @Description 获取当前所有活跃的WebSocket连接信息，支持按AgentID查询和分页
// @Tags WebSocket管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id query string false "Agent ID（HashID编码），指定则查询单个连接"
// @Param page query int false "页码" default(1)
// @Param page_size query int false "每页数量" default(20)
// @Success 200 {object} model.CommonResponse{data=WsConnectionListResponse} "成功返回连接列表"
// @Router /api/admin/ws/connections [get]
func GetWSConnections(c *gin.Context) {
	ctx := c.Request.Context()

	agentIDStr := c.Query("id")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))

	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 || pageSize > 100 {
		pageSize = 20
	}

	opts := service.ConnectionListOptions{
		AgentIDFilter: agentIDStr,
		Page:          page,
		PageSize:      pageSize,
	}

	connections, total := wsAdminService.GetConnectionList(ctx, opts)

	c.JSON(http.StatusOK, model.Success.ToResponse(WsConnectionListResponse{
		Connections: connections,
		Total:       total,
		Page:        page,
		PageSize:    pageSize,
		TotalPage:   (total + int64(pageSize) - 1) / int64(pageSize),
	}))
}

// @Summary 获取WebSocket连接统计指标
// @Description 获取WebSocket连接的核心统计指标，包括当前活跃数、累计连接数、消息收发数、错误数
// @Tags WebSocket管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse{data=wsmanager.WsMetrics} "成功返回统计指标"
// @Router /api/admin/ws/metrics [get]
func GetWSMetrics(c *gin.Context) {
	metrics := wsAdminService.GetConnectionMetrics()
	c.JSON(http.StatusOK, model.Success.ToResponse(metrics))
}

type BanAgentRequest struct {
	DurationMinutes int    `json:"duration_minutes"`
	Reason          string `json:"reason"`
	Permanent       bool   `json:"permanent"`
}

// @Summary 封禁Agent
// @Description 封禁指定的Agent，阻止其WebSocket连接。支持永久封禁和临时封禁。
// @Tags WebSocket管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path string true "Agent ID（HashID编码）"
// @Param body body BanAgentRequest true "封禁选项"
// @Success 200 {object} model.CommonResponse{data=map[string]bool} "成功封禁"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Router /api/admin/ws/agents/{id}/ban [post]
func BanWSAgent(c *gin.Context) {
	ctx := c.Request.Context()
	agentID := c.Param("id")
	if agentID == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("agent ID is required"))
		return
	}

	adminID := c.GetInt64("user_id")

	var req BanAgentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		req.DurationMinutes = 0
		req.Reason = "admin ban"
		req.Permanent = false
	}

	var duration time.Duration
	if req.Permanent {
		duration = 0
	} else if req.DurationMinutes > 0 {
		duration = time.Duration(req.DurationMinutes) * time.Minute
	} else {
		duration = 24 * time.Hour
	}

	opts := service.BanOptions{
		Duration:    duration,
		Reason:      req.Reason,
		IsPermanent: req.Permanent,
	}

	if err := wsAdminService.BanAgent(ctx, adminID, agentID, opts); err != nil {
		if errors.Is(err, service.ErrInvalidAgentID) {
			c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse(err.Error()))
		} else if errors.Is(err, service.ErrRedisDisabled) {
			c.JSON(http.StatusServiceUnavailable, model.SystemError.ToNewErrorResponse(err.Error()))
		} else {
			c.JSON(http.StatusInternalServerError, model.SystemError.ToNewErrorResponse(err.Error()))
		}
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(gin.H{"success": true}))
}

// @Summary 解封Agent
// @Description 解除Agent的封禁状态，允许其重新建立WebSocket连接
// @Tags WebSocket管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path string true "Agent ID（HashID编码）"
// @Success 200 {object} model.CommonResponse{data=map[string]bool} "成功解封"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Router /api/admin/ws/agents/{id}/unban [post]
func UnbanWSAgent(c *gin.Context) {
	ctx := c.Request.Context()
	agentID := c.Param("id")
	if agentID == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("agent ID is required"))
		return
	}

	adminID := c.GetInt64("user_id")

	if err := wsAdminService.UnbanAgent(ctx, adminID, agentID); err != nil {
		if errors.Is(err, service.ErrInvalidAgentID) {
			c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse(err.Error()))
		} else if errors.Is(err, service.ErrRedisDisabled) {
			c.JSON(http.StatusServiceUnavailable, model.SystemError.ToNewErrorResponse(err.Error()))
		} else {
			c.JSON(http.StatusInternalServerError, model.SystemError.ToNewErrorResponse(err.Error()))
		}
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(gin.H{"success": true}))
}
