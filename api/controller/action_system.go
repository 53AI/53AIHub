package controller

import (
	"net/http"

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

func GetActionOpportunity(c *gin.Context) {
	opportunity, err := service.DefaultActionRuntimeService().GetActionOpportunity(c.Request.Context(), config.GetEID(c), config.GetUserId(c), c.Param("opportunity_id"))
	if err != nil {
		writeActionRuntimeError(c, err)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(opportunity))
}

func ListActionOpportunities(c *gin.Context) {
	opportunities, err := service.DefaultActionRuntimeService().ListActionOpportunities(c.Request.Context(), config.GetEID(c), config.GetUserId(c))
	if err != nil {
		writeActionRuntimeError(c, err)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(opportunities))
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
	plans, err := service.DefaultActionRuntimeService().ListActionPlans(c.Request.Context(), config.GetEID(c), config.GetUserId(c))
	if err != nil {
		writeActionRuntimeError(c, err)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(plans))
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
	confirmation, err := service.DefaultActionRuntimeService().ConfirmActionPlan(c.Request.Context(), config.GetEID(c), config.GetUserId(c), c.Param("plan_id"))
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
	assets, err := service.DefaultActionRuntimeService().ListActionResultAssets(c.Request.Context(), config.GetEID(c), config.GetUserId(c))
	if err != nil {
		writeActionRuntimeError(c, err)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(assets))
}
