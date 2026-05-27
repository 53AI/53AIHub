package controller

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
)

type ApprovalController struct {
	Svc service.ApprovalService
}

func NewApprovalController(svc service.ApprovalService) *ApprovalController {
	return &ApprovalController{Svc: svc}
}

// @Summary 创建审批
// @Description 发起资源权限审批申请
// @Tags 审批
// @Accept json
// @Security BearerAuth
// @Param request body service.CreateApprovalRequest true "审批创建请求"
// @Success 200 {object} model.CommonResponse "创建成功"
// @Router /api/approvals [post]
func (ac *ApprovalController) Create(c *gin.Context) {
	userID := config.GetUserId(c)
	if userID == 0 {
		respErr(c, http.StatusUnauthorized, "unauthorized")
		return
	}
	eid := config.GetEID(c)
	if eid == 0 {
		respErr(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	var req service.CreateApprovalRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("invalid json body")))
		return
	}

	id, _, _, err := ac.Svc.CreateApproval(c, eid, userID, req)
	if err != nil {
		logger.Errorf(c, "approvals.Create error: %v", err)
		switch {
		case errors.Is(err, service.ErrApprovalAlreadyApplied):
			c.JSON(http.StatusConflict, model.ParamError.ToResponse(err))
			return
		default:
			respErr(c, http.StatusInternalServerError, "internal error")
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "msg": "ok", "data": gin.H{"id": id, "status": model.ApprovalStatusPending}})
}

type ApproveBody struct {
	Permission int `json:"permission" binding:"required"`
}

// GetApprovalDetailQuery 查询参数
type GetApprovalDetailQuery struct {
	ResourceType int   `form:"resource_type" binding:"required"`
	ResourceID   int64 `form:"resource_id" binding:"required"`
}

// @Summary 审批通过
// @Description 管理员通过审批，设置最终权限
// @Tags 审批
// @Accept json
// @Security BearerAuth
// @Param id path int true "审批ID"
// @Param request body ApproveBody true "审批通过请求"
// @Success 200 {object} model.CommonResponse "操作成功"
// @Router /api/approvals/{id}/approve [post]
func (ac *ApprovalController) Approve(c *gin.Context) {
	userID := config.GetUserId(c)
	if userID == 0 {
		respErr(c, http.StatusUnauthorized, "unauthorized")
		return
	}
	eid := config.GetEID(c)
	if eid == 0 {
		respErr(c, http.StatusUnauthorized, "unauthorized")
		return
	}
	idStr := c.Param("id")
	aid, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil || aid <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("invalid id")))
		return
	}
	var body ApproveBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("invalid json body")))
		return
	}
	if err := ac.Svc.Approve(c, eid, userID, aid, body.Permission); err != nil {
		logger.Errorf(c, "approvals.Approve error: %v", err)
		switch {
		case errors.Is(err, service.ErrApprovalAlreadyProcessed):
			c.JSON(http.StatusConflict, model.ParamError.ToResponse(err))
			return
		case errors.Is(err, service.ErrForbiddenNotManager):
			c.JSON(http.StatusForbidden, model.ParamError.ToResponse(err))
			return
		default:
			respErr(c, http.StatusInternalServerError, "internal error")
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "msg": "ok", "data": gin.H{"affected": 1}})
}

// GetDetail 获取审批详情
// @Summary 获取审批详情
// @Description 按 user_id、resource_type、resource_id 获取审批详情（返回最新一条记录）
// @Tags 审批
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param resource_type query int true "资源类型"
// @Param resource_id query int true "资源ID"
// @Success 200 {object} model.CommonResponse{data=model.Approval} "查询成功"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 401 {object} model.CommonResponse "未授权"
// @Failure 404 {object} model.CommonResponse "未找到"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/approvals/detail [get]
func (ac *ApprovalController) GetDetail(c *gin.Context) {
	uid := config.GetUserId(c)
	if uid == 0 {
		respErr(c, http.StatusUnauthorized, "unauthorized")
		return
	}
	eid := config.GetEID(c)
	if eid == 0 {
		respErr(c, http.StatusUnauthorized, "unauthorized")
		return
	}
	var qs GetApprovalDetailQuery
	if err := c.ShouldBindQuery(&qs); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("invalid query params")))
		return
	}
	ap, err := ac.Svc.GetDetail(c, eid, uid, qs.ResourceType, qs.ResourceID)
	if err != nil {
		logger.Errorf(c, "approvals.GetDetail error: %v", err)
		respErr(c, http.StatusInternalServerError, "internal error")
		return
	}
	if ap == nil {
		c.JSON(http.StatusNotFound, model.ParamError.ToResponse(errors.New("not found")))
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "msg": "ok", "data": ap})
}

// LatestPending 检查最新一条是否处于待审批状态
// @Summary 检查是否存在审核中的申请
// @Description 按 user_id、resource_type、resource_id 检查最新一条是否为待审批
// @Tags 审批
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param resource_type query int true "资源类型"
// @Param resource_id query int true "资源ID"
// @Success 200 {object} model.CommonResponse{data=map[string]interface{}} "code=0, data={pending}"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Router /api/approvals/latest-pending [get]
func (ac *ApprovalController) LatestPending(c *gin.Context) {
	uid := config.GetUserId(c)
	if uid == 0 {
		respErr(c, http.StatusUnauthorized, "unauthorized")
		return
	}
	eid := config.GetEID(c)
	if eid == 0 {
		respErr(c, http.StatusUnauthorized, "unauthorized")
		return
	}
	var qs GetApprovalDetailQuery
	if err := c.ShouldBindQuery(&qs); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("invalid query params")))
		return
	}
	pending, err := ac.Svc.IsLatestPending(c, eid, uid, qs.ResourceType, qs.ResourceID)
	if err != nil {
		logger.Errorf(c, "approvals.LatestPending error: %v", err)
		respErr(c, http.StatusInternalServerError, "internal error")
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "msg": "ok", "data": gin.H{"pending": pending}})
}

// @Summary 审批拒绝
// @Description 管理员拒绝审批
// @Tags 审批
// @Accept json
// @Security BearerAuth
// @Param id path int true "审批ID"
// @Success 200 {object} model.CommonResponse "操作成功"
// @Router /api/approvals/{id}/reject [post]
func (ac *ApprovalController) Reject(c *gin.Context) {
	userID := config.GetUserId(c)
	if userID == 0 {
		respErr(c, http.StatusUnauthorized, "unauthorized")
		return
	}
	eid := config.GetEID(c)
	if eid == 0 {
		respErr(c, http.StatusUnauthorized, "unauthorized")
		return
	}
	idStr := c.Param("id")
	aid, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil || aid <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("invalid id")))
		return
	}
	if err := ac.Svc.Reject(c, eid, userID, aid); err != nil {
		logger.Errorf(c, "approvals.Reject error: %v", err)
		switch {
		case errors.Is(err, service.ErrApprovalAlreadyProcessed):
			c.JSON(http.StatusConflict, model.ParamError.ToResponse(err))
			return
		case errors.Is(err, service.ErrForbiddenNotManager):
			c.JSON(http.StatusForbidden, model.ParamError.ToResponse(err))
			return
		default:
			respErr(c, http.StatusInternalServerError, "internal error")
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "msg": "ok", "data": gin.H{"affected": 1}})
}
