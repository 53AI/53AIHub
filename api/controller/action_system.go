package controller

import (
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/gin-gonic/gin"
)

func DetectActionOpportunitiesFromSource(c *gin.Context) {
	var req service.DetectActionOpportunitiesFromSourceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("行动来源参数无效"))
		return
	}
	opportunities, err := service.DefaultActionRuntimeService().DetectActionOpportunitiesFromSource(c.Request.Context(), config.GetEID(c), config.GetUserId(c), req)
	if err != nil {
		writeActionRuntimeError(c, err)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(opportunities))
}

func DetectActionOpportunities(c *gin.Context) {
	fileID, err := hashids.TryParseID(c.Param("file_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("文件ID无效"))
		return
	}
	opportunities, err := service.DefaultActionRuntimeService().DetectInsightActionOpportunities(c.Request.Context(), config.GetEID(c), config.GetUserId(c), fileID)
	if err != nil {
		writeActionRuntimeError(c, err)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(opportunities))
}

type actionOpportunityPreviewRequest struct {
	PromptVersions  []string `json:"prompt_versions" binding:"required,min=1,max=2"`
	IncludeExisting bool     `json:"include_existing"`
}

func PreviewActionOpportunities(c *gin.Context) {
	fileID, err := hashids.TryParseID(c.Param("file_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("文件ID无效"))
		return
	}
	var req actionOpportunityPreviewRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("预览参数无效"))
		return
	}
	result, err := service.DefaultActionRuntimeService().PreviewInsightActionOpportunities(c.Request.Context(), config.GetEID(c), config.GetUserId(c), fileID, req.PromptVersions, req.IncludeExisting)
	if err != nil {
		writeActionRuntimeError(c, err)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponseWithRequestID(result, c.GetString("request_id")))
}

func GetActionOpportunity(c *gin.Context) {
	opportunity, err := service.DefaultActionRuntimeService().GetActionOpportunity(c.Request.Context(), config.GetEID(c), config.GetUserId(c), c.Param("opportunity_id"))
	if err != nil {
		writeActionRuntimeError(c, err)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(opportunity))
}

func ListActionOpportunities(c *gin.Context) {
	statusFilter := strings.TrimSpace(c.Query("status"))
	if statusFilter == "" {
		statusFilter = strings.TrimSpace(c.Query("view"))
	}
	typeFilter := strings.TrimSpace(c.Query("type"))
	if typeFilter == "" {
		typeFilter = strings.TrimSpace(c.Query("opportunity_type"))
	}
	pageValue, pageSizeValue := strings.TrimSpace(c.Query("page")), strings.TrimSpace(c.Query("page_size"))
	if statusFilter != "" || typeFilter != "" || pageValue != "" || pageSizeValue != "" {
		page, pageSize := 1, 20
		var err error
		if pageValue != "" {
			page, err = strconv.Atoi(pageValue)
			if err != nil || page < 1 {
				c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("分页参数无效"))
				return
			}
		}
		if pageSizeValue != "" {
			pageSize, err = strconv.Atoi(pageSizeValue)
			if err != nil || pageSize < 1 || pageSize > 100 {
				c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("分页参数无效"))
				return
			}
		}
		result, err := service.DefaultActionRuntimeService().ListActionOpportunitiesPage(c.Request.Context(), config.GetEID(c), config.GetUserId(c), statusFilter, typeFilter, page, pageSize)
		if err != nil {
			writeActionRuntimeError(c, err)
			return
		}
		c.JSON(http.StatusOK, model.Success.ToResponse(result))
		return
	}
	// No query parameters keeps the legacy array response for existing clients.
	opportunities, err := service.DefaultActionRuntimeService().ListActionOpportunities(c.Request.Context(), config.GetEID(c), config.GetUserId(c))
	if err != nil {
		writeActionRuntimeError(c, err)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(opportunities))
}

func DeleteActionOpportunity(c *gin.Context) {
	err := service.DefaultActionRuntimeService().PermanentlyDeleteActionOpportunity(c.Request.Context(), config.GetEID(c), config.GetUserId(c), c.Param("opportunity_id"))
	if err != nil {
		writeActionRuntimeError(c, err)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(gin.H{"deleted": true}))
}

func CreateActionPlan(c *gin.Context) {
	plan, err := service.DefaultActionRuntimeService().CreateActionPlan(c.Request.Context(), config.GetEID(c), config.GetUserId(c), c.Param("opportunity_id"))
	if err != nil {
		writeActionRuntimeError(c, err)
		return
	}
	c.JSON(http.StatusCreated, model.Success.ToResponse(plan))
}

func GetActionPlan(c *gin.Context) {
	plan, err := service.DefaultActionRuntimeService().GetActionPlan(c.Request.Context(), config.GetEID(c), config.GetUserId(c), c.Param("plan_id"))
	if err != nil {
		writeActionRuntimeError(c, err)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(plan))
}

func ListActionPlans(c *gin.Context) {
	statusFilter := strings.TrimSpace(c.Query("status"))
	typeFilter := strings.TrimSpace(c.Query("type"))
	if typeFilter == "" {
		typeFilter = strings.TrimSpace(c.Query("opportunity_type"))
	}
	pageValue, pageSizeValue := strings.TrimSpace(c.Query("page")), strings.TrimSpace(c.Query("page_size"))
	if statusFilter != "" || typeFilter != "" || pageValue != "" || pageSizeValue != "" {
		page, pageSize := 1, 20
		var err error
		if pageValue != "" {
			page, err = strconv.Atoi(pageValue)
			if err != nil || page < 1 {
				c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("分页参数无效"))
				return
			}
		}
		if pageSizeValue != "" {
			pageSize, err = strconv.Atoi(pageSizeValue)
			if err != nil || pageSize < 1 || pageSize > 100 {
				c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("分页参数无效"))
				return
			}
		}
		plans, err := service.DefaultActionRuntimeService().ListActionPlansPage(c.Request.Context(), config.GetEID(c), config.GetUserId(c), statusFilter, typeFilter, page, pageSize)
		if err != nil {
			writeActionRuntimeError(c, err)
			return
		}
		c.JSON(http.StatusOK, model.Success.ToResponse(plans))
		return
	}
	plans, err := service.DefaultActionRuntimeService().ListActionPlans(c.Request.Context(), config.GetEID(c), config.GetUserId(c))
	if err != nil {
		writeActionRuntimeError(c, err)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(plans))
}

func UpdateActionPlanState(c *gin.Context) {
	var req struct {
		Status string `json:"status" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("行动状态参数无效"))
		return
	}
	var plan *service.ActionPlanView
	var err error
	switch strings.TrimSpace(req.Status) {
	case "trash":
		plan, err = service.DefaultActionRuntimeService().TrashActionPlan(c.Request.Context(), config.GetEID(c), config.GetUserId(c), c.Param("plan_id"))
	case "restore":
		plan, err = service.DefaultActionRuntimeService().RestoreActionPlan(c.Request.Context(), config.GetEID(c), config.GetUserId(c), c.Param("plan_id"))
	default:
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("不支持的行动状态操作"))
		return
	}
	if err != nil {
		writeActionRuntimeError(c, err)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(plan))
}

func DeleteActionPlan(c *gin.Context) {
	if err := service.DefaultActionRuntimeService().PermanentlyDeleteActionPlan(c.Request.Context(), config.GetEID(c), config.GetUserId(c), c.Param("plan_id")); err != nil {
		writeActionRuntimeError(c, err)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(gin.H{"deleted": true}))
}
func ListActionWorkspace(c *gin.Context) {
	page, pageSize := 1, 20
	var err error
	if value := strings.TrimSpace(c.Query("page")); value != "" {
		page, err = strconv.Atoi(value)
		if err != nil || page < 1 {
			c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("分页参数无效"))
			return
		}
	}
	if value := strings.TrimSpace(c.Query("page_size")); value != "" {
		pageSize, err = strconv.Atoi(value)
		if err != nil || pageSize < 1 || pageSize > 100 {
			c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("分页参数无效"))
			return
		}
	}
	result, err := service.DefaultActionRuntimeService().ListActionWorkspace(
		c.Request.Context(), config.GetEID(c), config.GetUserId(c),
		c.DefaultQuery("opportunity_status", "all"), c.Query("opportunity_type"),
		c.DefaultQuery("plan_status", "all"), c.Query("plan_type"), page, pageSize,
	)
	if err != nil {
		writeActionRuntimeError(c, err)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(result))
}

func UpdateActionPlan(c *gin.Context) {
	var req service.UpdateActionPlanRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("行动规划参数无效"))
		return
	}
	plan, err := service.DefaultActionRuntimeService().UpdateActionPlan(c.Request.Context(), config.GetEID(c), config.GetUserId(c), c.Param("plan_id"), req)
	if err != nil {
		writeActionRuntimeError(c, err)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(plan))
}

func ConfirmActionPlan(c *gin.Context) {
	var req struct {
		SupplementalInfo string `json:"supplemental_info"`
	}
	if err := c.ShouldBindJSON(&req); err != nil && err != io.EOF {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("补充信息参数无效"))
		return
	}
	confirmation, err := service.DefaultActionRuntimeService().ConfirmActionPlanWithSupplementalInfo(c.Request.Context(), config.GetEID(c), config.GetUserId(c), c.Param("plan_id"), req.SupplementalInfo)
	if err != nil {
		writeActionRuntimeError(c, err)
		return
	}
	c.JSON(http.StatusAccepted, model.Success.ToResponse(confirmation))
}

func GetActionResultAsset(c *gin.Context) {
	asset, err := service.DefaultActionRuntimeService().GetActionResultAsset(c.Request.Context(), config.GetEID(c), config.GetUserId(c), c.Param("result_asset_id"))
	if err != nil {
		writeActionRuntimeError(c, err)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(asset))
}

func ListActionResultAssets(c *gin.Context) {
	typeFilter := strings.TrimSpace(c.Query("type"))
	if typeFilter == "" {
		typeFilter = strings.TrimSpace(c.Query("result_type"))
	}
	statusFilter := strings.TrimSpace(c.Query("status"))
	sortBy := strings.TrimSpace(c.Query("sort_by"))
	pageValue, pageSizeValue := strings.TrimSpace(c.Query("page")), strings.TrimSpace(c.Query("page_size"))
	if typeFilter != "" || statusFilter != "" || sortBy != "" || pageValue != "" || pageSizeValue != "" {
		page, pageSize := 1, 20
		var err error
		if pageValue != "" {
			page, err = strconv.Atoi(pageValue)
			if err != nil || page < 1 {
				c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("分页参数无效"))
				return
			}
		}
		if pageSizeValue != "" {
			pageSize, err = strconv.Atoi(pageSizeValue)
			if err != nil || pageSize < 1 || pageSize > 100 {
				c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("分页参数无效"))
				return
			}
		}
		assets, err := service.DefaultActionRuntimeService().ListActionResultAssetsPage(c.Request.Context(), config.GetEID(c), config.GetUserId(c), typeFilter, statusFilter, sortBy, page, pageSize)
		if err != nil {
			writeActionRuntimeError(c, err)
			return
		}
		c.JSON(http.StatusOK, model.Success.ToResponse(assets))
		return
	}
	assets, err := service.DefaultActionRuntimeService().ListActionResultAssets(c.Request.Context(), config.GetEID(c), config.GetUserId(c))
	if err != nil {
		writeActionRuntimeError(c, err)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(assets))
}

func ListActionResultAssetCategories(c *gin.Context) {
	categories, err := service.DefaultActionRuntimeService().ListActionResultAssetCategories(c.Request.Context(), config.GetEID(c), config.GetUserId(c), c.Query("stage"))
	if err != nil {
		writeActionRuntimeError(c, err)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(categories))
}

// DeleteActionResultAsset godoc
// @Summary 删除一条成果（软删除，status=archived）
// @Tags Action System
// @Security BearerAuth
// @Param result_asset_id path string true "成果资产 ID"
// @Success 200 {object} model.CommonResponse
// @Router /api/actions/results/{result_asset_id} [delete]
func DeleteActionResultAsset(c *gin.Context) {
	if err := service.DefaultActionRuntimeService().DeleteActionResultAsset(c.Request.Context(), config.GetEID(c), config.GetUserId(c), c.Param("result_asset_id")); err != nil {
		writeActionRuntimeError(c, err)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(gin.H{"deleted": true}))
}
