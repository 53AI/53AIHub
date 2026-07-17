package controller

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type AddAgentSkillRequest struct {
	SkillLibraryID int64 `json:"skill_library_id" binding:"required"`
}

type AgentSkillListItem struct {
	SkillPublicResponse
	BindingID int64  `json:"binding_id"`
	BindType  string `json:"bind_type"`
	Status    string `json:"status"`
}

func toAgentSkillErrorResponse(c *gin.Context, err error) {
	switch {
	case err == service.ErrAgentSkillAccessDenied:
		c.JSON(http.StatusForbidden, model.AuthFailed.ToErrorResponse(err))
	case errors.Is(err, gorm.ErrRecordNotFound):
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(nil))
	default:
		c.JSON(http.StatusInternalServerError, model.DBError.ToErrorResponse(err))
	}
}

// ListAgentSkills godoc
// @Summary 获取 Agent 技能列表
// @Description 获取指定 Agent 的技能列表，包含内置技能（builtin）和当前用户个人添加的技能（user）。user 技能在当前用户失去 group 权限时 status 为 disabled。
// @Tags Agent技能
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param agent_id path int true "Agent ID（数字）"
// @Success 200 {object} model.CommonResponse{data=object{items=[]controller.AgentSkillListItem}} "成功"
// @Failure 400 {object} model.CommonResponse "参数错误：agent_id 格式不正确"
// @Failure 403 {object} model.CommonResponse "权限不足：无法访问该 Agent"
// @Router /api/agent/{agent_id}/skills [get]
func ListAgentSkills(c *gin.Context) {
	agentID, err := strconv.ParseInt(c.Param("agent_id"), 10, 64)
	if err != nil || agentID <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	svc := service.NewSkillLibraryService()
	items, err := svc.ListAgentSkills(c.Request.Context(), eid, agentID, userID)
	if err != nil {
		toAgentSkillErrorResponse(c, err)
		return
	}

	result := make([]*AgentSkillListItem, 0, len(items))
	for _, item := range items {
		if item == nil {
			continue
		}
		public := &SkillPublicResponse{
			ID:                item.SkillLibraryID,
			Eid:               item.Eid,
			SourceType:        item.SourceType,
			Logo:              item.Logo,
			SkillName:         item.SkillName,
			Sort:              item.Sort,
			DisplayName:       item.DisplayName,
			Description:       item.Description,
			Version:           item.Version,
			UsageGuide:        item.UsageGuide,
			PublishStatus:     item.PublishStatus,
			AdminStatus:       item.AdminStatus,
			RiskLevel:         item.RiskLevel,
			CreatedTime:       item.CreatedTime,
			UpdatedTime:       item.UpdatedTime,
		}
		result = append(result, &AgentSkillListItem{
			SkillPublicResponse: *public,
			BindingID:           item.BindingID,
			BindType:            item.BindType,
			Status:              item.Status,
		})
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(gin.H{
		"items": result,
	}))
}

// AddAgentSkill godoc
// @Summary 用户添加技能到 Agent
// @Description 当前用户给指定 Agent 添加个人技能。接口幂等，重复添加不报错。同一技能可同时作为内置和用户技能存在。
// @Tags Agent技能
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param agent_id path int true "Agent ID（数字）"
// @Param request body controller.AddAgentSkillRequest true "技能信息"
// @Success 200 {object} model.CommonResponse "成功"
// @Failure 400 {object} model.CommonResponse "参数错误：agent_id 格式不正确或请求体非法"
// @Failure 403 {object} model.CommonResponse "权限不足：无法访问该 Agent 或技能未发布/已禁用"
// @Router /api/agent/{agent_id}/skills [post]
func AddAgentSkill(c *gin.Context) {
	agentID, err := strconv.ParseInt(c.Param("agent_id"), 10, 64)
	if err != nil || agentID <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	var req AddAgentSkillRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToErrorResponse(err))
		return
	}

	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	svc := service.NewSkillLibraryService()
	if err := svc.AddAgentSkill(c.Request.Context(), eid, agentID, userID, req.SkillLibraryID); err != nil {
		toAgentSkillErrorResponse(c, err)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}

// DeleteAgentSkill godoc
// @Summary 用户删除 Agent 技能绑定
// @Description 当前用户删除自己在指定 Agent 上的某个技能绑定。只能删除 bind_type=user 的记录。
// @Tags Agent技能
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param agent_id path int true "Agent ID（数字）"
// @Param binding_id path int true "绑定 ID（来自列表接口返回的 binding_id 字段）"
// @Success 200 {object} model.CommonResponse "成功"
// @Failure 400 {object} model.CommonResponse "参数错误：agent_id 或 binding_id 格式不正确"
// @Failure 403 {object} model.CommonResponse "权限不足：无法访问该 Agent"
// @Failure 404 {object} model.CommonResponse "绑定不存在"
// @Router /api/agent/{agent_id}/skills/{binding_id} [delete]
func DeleteAgentSkill(c *gin.Context) {
	agentID, err := strconv.ParseInt(c.Param("agent_id"), 10, 64)
	if err != nil || agentID <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	bindingID, err := strconv.ParseInt(c.Param("binding_id"), 10, 64)
	if err != nil || bindingID <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	svc := service.NewSkillLibraryService()
	if err := svc.DeleteAgentSkill(c.Request.Context(), eid, agentID, userID, bindingID); err != nil {
		toAgentSkillErrorResponse(c, err)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}

// ListAgentBuiltinSkills godoc
// @Summary 管理员获取 Agent 内置技能列表
// @Description 管理员查看指定 Agent 的内置技能列表（bind_type=builtin），内置技能全员可见。
// @Tags Agent技能-管理员
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param agent_id path int true "Agent ID（数字）"
// @Success 200 {object} model.CommonResponse{data=object{items=[]controller.AgentSkillListItem}} "成功"
// @Failure 400 {object} model.CommonResponse "参数错误：agent_id 格式不正确"
// @Failure 403 {object} model.CommonResponse "权限不足：需要管理员角色"
// @Router /api/admin/agent/{agent_id}/skills/builtin [get]
func ListAgentBuiltinSkills(c *gin.Context) {
	agentID, err := strconv.ParseInt(c.Param("agent_id"), 10, 64)
	if err != nil || agentID <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	eid := config.GetEID(c)

	svc := service.NewSkillLibraryService()
	items, err := svc.ListAgentBuiltinSkills(c.Request.Context(), eid, agentID)
	if err != nil {
		toAgentSkillErrorResponse(c, err)
		return
	}

	result := make([]*AgentSkillListItem, 0, len(items))
	for _, item := range items {
		if item == nil {
			continue
		}
		public := &SkillPublicResponse{
			ID:                item.SkillLibraryID,
			Eid:               item.Eid,
			SourceType:        item.SourceType,
			Logo:              item.Logo,
			SkillName:         item.SkillName,
			Sort:              item.Sort,
			DisplayName:       item.DisplayName,
			Description:       item.Description,
			Version:           item.Version,
			UsageGuide:        item.UsageGuide,
			PublishStatus:     item.PublishStatus,
			AdminStatus:       item.AdminStatus,
			RiskLevel:         item.RiskLevel,
			CreatedTime:       item.CreatedTime,
			UpdatedTime:       item.UpdatedTime,
		}
		result = append(result, &AgentSkillListItem{
			SkillPublicResponse: *public,
			BindingID:           item.BindingID,
			BindType:            item.BindType,
			Status:              item.Status,
		})
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(gin.H{
		"items": result,
	}))
}

// AddAgentBuiltinSkill godoc
// @Summary 管理员添加内置技能到 Agent
// @Description 管理员给指定 Agent 添加内置技能，内置技能全员可见。接口幂等，重复添加不报错。
// @Tags Agent技能-管理员
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param agent_id path int true "Agent ID（数字）"
// @Param request body controller.AddAgentSkillRequest true "技能信息"
// @Success 200 {object} model.CommonResponse "成功"
// @Failure 400 {object} model.CommonResponse "参数错误：agent_id 格式不正确或技能未发布/已禁用"
// @Failure 403 {object} model.CommonResponse "权限不足：需要管理员角色"
// @Router /api/admin/agent/{agent_id}/skills/builtin [post]
func AddAgentBuiltinSkill(c *gin.Context) {
	agentID, err := strconv.ParseInt(c.Param("agent_id"), 10, 64)
	if err != nil || agentID <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	var req AddAgentSkillRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToErrorResponse(err))
		return
	}

	eid := config.GetEID(c)

	svc := service.NewSkillLibraryService()
	if err := svc.AddAgentBuiltinSkill(c.Request.Context(), eid, agentID, req.SkillLibraryID); err != nil {
		toAgentSkillErrorResponse(c, err)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}

// DeleteAgentBuiltinSkill godoc
// @Summary 管理员删除 Agent 内置技能
// @Description 管理员删除指定 Agent 的内置技能绑定。
// @Tags Agent技能-管理员
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param agent_id path int true "Agent ID（数字）"
// @Param binding_id path int true "绑定 ID（来自列表接口返回的 binding_id 字段）"
// @Success 200 {object} model.CommonResponse "成功"
// @Failure 400 {object} model.CommonResponse "参数错误：agent_id 或 binding_id 格式不正确"
// @Failure 403 {object} model.CommonResponse "权限不足：需要管理员角色"
// @Failure 404 {object} model.CommonResponse "绑定不存在"
// @Router /api/admin/agent/{agent_id}/skills/builtin/{binding_id} [delete]
func DeleteAgentBuiltinSkill(c *gin.Context) {
	agentID, err := strconv.ParseInt(c.Param("agent_id"), 10, 64)
	if err != nil || agentID <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	bindingID, err := strconv.ParseInt(c.Param("binding_id"), 10, 64)
	if err != nil || bindingID <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	eid := config.GetEID(c)

	svc := service.NewSkillLibraryService()
	if err := svc.DeleteAgentBuiltinSkill(c.Request.Context(), eid, agentID, bindingID); err != nil {
		toAgentSkillErrorResponse(c, err)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}