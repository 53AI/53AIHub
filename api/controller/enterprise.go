package controller

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/53AI/53AIHub/common/utils"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/middleware"
	"github.com/53AI/53AIHub/model"
	saas_model "github.com/53AI/53AIHub/saas/model"
	"github.com/53AI/53AIHub/service"
	"github.com/gin-gonic/gin"
)

// Compare behavior snippet from 53AIHub/model/enterprise.go:
// resulf api
type EnterpriseResponse struct {
	Enterprise model.Enterprise           `json:"enterprise"`
	ApplyInfo  saas_model.EnterpriseApply `json:"apply_info,omitempty"` // 添加这两个结构返回是因为为了兼容saas版前端，是On-Prem分支独有
	Domains    []saas_model.SaasDomain    `json:"domains,omitempty"`
}

type CurrentEnterpriseResponse struct {
	Enterprise model.Enterprise `json:"enterprise"`
	Version    int              `json:"version,omitempty"`
}

// Compare behavior snippet from 53AIHub/model/enterprise.go:
// resulf api

// @Summary Get enterprise information
// @Description Retrieve detailed information of a specific enterprise by ID
// @Tags Enterprise
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "Enterprise ID"
// @Success 200 {object} model.Enterprise "Enterprise information"
// @Router /api/enterprises/{id} [get]
func GetEnterprise(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	enterprise, err := model.GetEnterpriseModel(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.NotFound.ToResponse(nil))
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(EnterpriseResponse{
		Enterprise: *enterprise,
	}))
}

// CreateEnterprise handles enterprise creation
// @Summary      Create a new enterprise
// @Tags         Enterprise
// @Accept       json
// @Produce      json
// @Security BearerAuth
// @Param        enterprise  body   model.Enterprise  true  "Enterprise data"
// @Success      200  {object}  model.CommonResponse{data=EnterpriseResponse}  "Success"
// @Router       /api/enterprises [post]
func CreateEnterprise(c *gin.Context) {
	enterprise := model.Enterprise{}
	err := c.ShouldBindJSON(&enterprise)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}
	err = model.CreateEnterpriseModel(&enterprise)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(nil))
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(EnterpriseResponse{
		Enterprise: enterprise,
	}))
}

// UpdateEnterpriseRequest defines the request structure for updating enterprise information
type UpdateEnterpriseRequest struct {
	DisplayName  string `json:"display_name" binding:"required" example:"Enterprise Name"`
	Logo         string `json:"logo" binding:"required" example:"http://a.com/a.jpg"`
	Ico          string `json:"ico" example:"http://a.com/favicon.ico"`
	Keywords     string `json:"keywords" example:"AI,Hub,Agent"`
	Copyright    string `json:"copyright" example:"© 2023 Company Name"`
	Type         string `json:"type" example:"independent、enterprise、industry"`
	Banner       string `json:"banner" example:"http://a.com/banner.jpg"`
	Language     string `json:"language" binding:"required" example:"zh-cn"`
	Description  string `json:"description" example:"Description Test"`
	TemplateType string `json:"template_type" example:"default"`
	LayoutType   string `json:"layout_type" example:"1"`
}

// @Summary Update enterprise information
// @Description Update enterprise information
// @Tags Enterprise
// @Accept json
// @Produce json
// @Param id  path  int  true  "Enterprise ID"
// @Param request body UpdateEnterpriseRequest true "Enterprise information"
// @Success 200 {object} model.CommonResponse
// @Router /api/enterprises/{id} [put]
func UpdateEnterprise(c *gin.Context) {
	var req UpdateEnterpriseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 从路径参数获取解码后的企业 ID
	pathEid, ok := middleware.MustParseIDParam(c, "id")
	if !ok {
		return
	}

	// SaaS 模式下需要登录并校验 EID
	if config.IS_SAAS {
		user, err := model.GetLoginUser(c)
		if err != nil {
			c.JSON(http.StatusUnauthorized, model.UnauthorizedError.ToResponse(nil))
			return
		}
		if user.Role < model.RoleAdminUser {
			c.JSON(http.StatusForbidden, model.ForbiddenError.ToResponse(nil))
			return
		}
		if pathEid != user.Eid {
			c.JSON(http.StatusForbidden, model.ForbiddenError.ToResponse(errors.New("只能更新当前登录的企业")))
			return
		}
	}

	enterprise, err := model.GetEnterpriseModel(pathEid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.NotFound.ToResponse(nil))
		return
	}

	if req.Type != model.EnterpriseTypeIndependent {
		// params := map[string]interface{}{
		// 	"from": "enterprise",
		// 	"type": req.Type,
		// }
		// _, err = service.IsFeatureAvailable(c, "internal_user", params)
		// if err != nil {
		// 	c.JSON(http.StatusForbidden, model.FeatureNotAvailableError.ToResponse(err))
		// 	return
		// }
	}

	oldEnterprise := *enterprise

	// 构建要更新的字段映射
	updateData := make(map[string]interface{})

	if req.DisplayName != "" {
		updateData["display_name"] = req.DisplayName
		enterprise.DisplayName = req.DisplayName
	}

	if req.Logo != "" {
		updateData["logo"] = req.Logo
		enterprise.Logo = req.Logo
	}

	if req.Ico != "" {
		updateData["ico"] = req.Ico
		enterprise.Ico = req.Ico
	}

	updateData["keywords"] = req.Keywords
	enterprise.Keywords = req.Keywords

	updateData["copyright"] = req.Copyright
	enterprise.Copyright = req.Copyright

	if req.Type != "" {
		updateData["type"] = req.Type
		enterprise.Type = req.Type
	}
	if req.Language != "" {
		updateData["language"] = req.Language
		enterprise.Language = req.Language
	}
	updateData["description"] = req.Description
	enterprise.Description = req.Description

	if req.TemplateType != "" {
		updateData["template_type"] = req.TemplateType
		enterprise.TemplateType = req.TemplateType
	}

	updateData["layout_type"] = req.LayoutType
	enterprise.LayoutType = req.LayoutType

	if err := enterprise.PartialUpdateEnterprise(updateData); err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	// Prepare for logging
	fieldMap := map[string]string{
		"DisplayName": "站点名称",
		"Type":        "站点类型",
	}

	model.LogEntityChange(
		"站点信息",
		model.SystemLogActionUpdate,
		pathEid,
		config.GetUserId(c),
		config.GetUserNickname(c),
		model.SystemLogModuleSiteInfo,
		oldEnterprise,
		*enterprise,
		utils.GetClientIP(c),
		fieldMap,
	)

	c.JSON(http.StatusOK, model.Success.ToResponse(enterprise))
}

// DeleteEnterprise handles enterprise deletion
// @Summary      Delete an enterprise
// @Description  Delete an existing enterprise by ID
// @Tags         Enterprise
// @Accept       json
// @Produce      json
// @Security BearerAuth
// @Param        id  path  int  true  "Enterprise ID"
// @Success      200  {object}  model.CommonResponse  "Success"
// @Router       /api/enterprises/{id} [delete]
func DeleteEnterprise(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}
	enterprise, err := model.GetEnterpriseModel(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.NotFound.ToResponse(nil))
		return
	}

	err = enterprise.Delete()
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}

// UpdateEnterpriseAttribute handles partial update of enterprise attributes
// @Summary      Partial update of enterprise attributes
// @Description  Update specific attributes of an existing enterprise by ID
// @Tags         Enterprise
// @Accept       json
// @Produce      json
// @Security BearerAuth
// @Param        id  path  int  true  "Enterprise ID"
// @Param        updateData  body  map[string]interface{}  true  "Update data for enterprise attributes"
// @Success      200  {object}  model.CommonResponse{data=EnterpriseResponse} "Success"
// @Router       /api/enterprises/{id} [patch]
func UpdateEnterpriseAttribute(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	enterprise, err := model.GetEnterpriseModel(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.NotFound.ToResponse(nil))
		return
	}

	var updateData map[string]interface{}
	if err := c.ShouldBindJSON(&updateData); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	if err := enterprise.PartialUpdateEnterprise(updateData); err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(EnterpriseResponse{
		Enterprise: *enterprise,
	}))
}

// @Summary Get current enterprise information
// @Description Retrieve information of current enterprise (when not logged in)
// @Tags Enterprise
// @Accept json
// @Produce json
// @Success 200 {object} model.Enterprise "Current enterprise information"
// @Router /api/enterprises/current [get]
func GetCurrentEnterprise(c *gin.Context) {

	// Get default enterprise ID
	currentEid := config.GetEID(c)
	if currentEid <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}
	enterprise, err := model.GetEnterpriseModel(currentEid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.NotFound.ToResponse(nil))
		return
	}

	params := map[string]interface{}{
		"from": "enterprise",
	}
	isFeatureAvailable, _ := service.IsFeatureAvailable(c, "wecom", params)
	if isFeatureAvailable {
		enterprise.LoadWecomCorpInfo(config.GetWecomSuiteID(), 0)
		enterprise.LoadDingtalkCorpInfo(config.GetDingtalkSuiteID(), 0)
	}
	if config.IS_SAAS {
		version := service.GetSaaSVersion(c.Request.Context(), currentEid)
		c.JSON(http.StatusOK, model.Success.ToResponse(CurrentEnterpriseResponse{
			Enterprise: *enterprise,
			Version:    version,
		}))
		return
	}

	response := EnterpriseResponse{}
	response.Enterprise = *enterprise
	if !config.IS_SAAS {
		version := 1
		response.ApplyInfo = saas_model.EnterpriseApply{
			ApplyID:        1,
			ContactName:    "123",
			Domain:         config.ApiHost,
			Eid:            currentEid,
			Email:          config.ADMIN_EMAIL,
			EnterpriseName: "53AI",
			ExpiredTime:    0,
			Phone:          config.ADMIN_MOBILE,
			Reason:         "",
			Status:         1,
			UserID:         1,
			Version:        version,
		}
		response.Domains = []saas_model.SaasDomain{
			{
				Config: "",
				Domain: config.ApiHost,
				Eid:    currentEid,
				ID:     1, // 根据实际结构体字段名调整
				Type:   1,
			},
		}
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(response))
}

type GetIsSaasResponse struct {
	IsSaas bool `json:"is_saas" example:"true"` // Whether the system is running in SAAS mode
}

// GetIsSaas retrieves the system's SAAS mode status
// @Summary Get SAAS mode status
// @Description Get whether the system is running in SAAS mode
// @Tags Enterprise
// @Accept json
// @Produce json
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse{data=GetIsSaasResponse} "Success"
// @Router /api/enterprises/is_saas [get]
func GetIsSaas(c *gin.Context) {
	c.JSON(http.StatusOK, model.Success.ToResponse(GetIsSaasResponse{
		IsSaas: config.IS_SAAS,
	}))
}

type HomePageResponse struct {
	AgentCount        int64 `json:"agent_count"`
	UserCount         int64 `json:"user_count"`
	InternalUserCount int64 `json:"internal_user_count"`
	PromptCount       int64 `json:"prompt_count"`
	AILinkCount       int64 `json:"ai_link_count"`
	SpaceCount        int64 `json:"space_count"`
	LibraryCount      int64 `json:"library_count"`
	DocumentCount     int64 `json:"document_count"`
}

// @Summary Get homepage information
// @Description Get site application info, enterprise info, agent count and user count
// @Tags Enterprise
// @Accept json
// @Produce json
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse{data=HomePageResponse} "Success"
// @Router /api/enterprises/homepage [get]
func GetHomePage(c *gin.Context) {
	eid := config.GetEID(c)
	if eid <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	var agentCount int64
	if err := model.DB.Model(&model.Agent{}).Where(map[string]interface{}{"eid": eid, "agent_usage": model.AgentUsageHub, "owner_id": model.AgentOwnerEnterprise}).Count(&agentCount).Error; err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	var userCount int64
	if err := model.DB.Model(&model.User{}).Where("eid = ? AND type = ?", eid, model.UserTypeRegistered).Count(&userCount).Error; err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	var internalUserCount int64
	if err := model.DB.Model(&model.User{}).Where("eid = ? AND type = ?", eid, model.UserTypeInternal).Count(&internalUserCount).Error; err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	var promptCount int64
	statusArray := []int{model.PromptStatusNormal, model.PromptStatusDisable}
	if err := model.DB.Model(&model.Prompt{}).Where("eid = ? AND status in (?)", eid, statusArray).Count(&promptCount).Error; err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	var aiLinkCount int64
	if err := model.DB.Model(&model.AILink{}).Where("eid =?", eid).Count(&aiLinkCount).Error; err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	var spaceCount int64
	if err := model.DB.Model(&model.Space{}).Where("eid = ?", eid).Count(&spaceCount).Error; err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	var libraryCount int64
	if err := model.DB.Model(&model.Library{}).Where("eid = ?", eid).Count(&libraryCount).Error; err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	var documentCount int64
	if err := model.DB.Model(&model.File{}).Where("eid = ? AND is_deleted = ?", eid, false).Count(&documentCount).Error; err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(HomePageResponse{
		AgentCount:        agentCount,
		UserCount:         userCount,
		InternalUserCount: internalUserCount,
		PromptCount:       promptCount,
		AILinkCount:       aiLinkCount,
		SpaceCount:        spaceCount,
		LibraryCount:      libraryCount,
		DocumentCount:     documentCount,
	}))
}

// @Summary Get enterprise banner
// @Description Get banner information of the current enterprise
// @Tags Enterprise
// @Accept json
// @Produce json
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse
// @Router /api/enterprises/banner [get]
func GetEnterpriseBanner(c *gin.Context) {
	currentEid := config.GetEID(c)
	if currentEid <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	enterprise, err := model.GetEnterpriseModel(currentEid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.NotFound.ToResponse(nil))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(map[string]string{
		"banner": enterprise.Banner,
	}))
}

type UpdateEnterpriseBannerRequest struct {
	Banner string `json:"banner" binding:"required" example:"http://a.com/banner.jpg"`
}

// @Summary Update enterprise banner
// @Description Update banner information of the current enterprise
// @Tags Enterprise
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body UpdateEnterpriseBannerRequest true "Banner information"
// @Success 200 {object} model.CommonResponse
// @Router /api/enterprises/banner [put]
func UpdateEnterpriseBanner(c *gin.Context) {
	var req UpdateEnterpriseBannerRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	currentEid := config.GetEID(c)
	if currentEid <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	enterprise, err := model.GetEnterpriseModel(currentEid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.NotFound.ToResponse(nil))
		return
	}

	updateData := map[string]interface{}{
		"banner": req.Banner,
	}

	if err := enterprise.PartialUpdateEnterprise(updateData); err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(map[string]string{
		"banner": req.Banner,
	}))
}

type UpdateEnterpriseTemplateTypeRequest struct {
	TemplateType string `json:"template_type" binding:"required" example:"default"`
}

// @Summary Update enterprise template type
// @Description Update template type information of the current enterprise
// @Tags Enterprise
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body UpdateEnterpriseTemplateTypeRequest true "Template type information"
// @Success 200 {object} model.CommonResponse
// @Router /api/enterprises/template_type [put]
func UpdateEnterpriseTemplateType(c *gin.Context) {
	var req UpdateEnterpriseTemplateTypeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	currentEid := config.GetEID(c)
	if currentEid <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	enterprise, err := model.GetEnterpriseModel(currentEid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.NotFound.ToResponse(nil))
		return
	}

	// Update template type
	updateData := map[string]interface{}{
		"template_type": req.TemplateType,
	}

	if err := enterprise.PartialUpdateEnterprise(updateData); err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	log := model.SystemLog{
		Eid:      currentEid,
		UserID:   config.GetUserId(c),
		Nickname: config.GetUserNickname(c),
		Module:   model.SystemLogModuleTemplate,
		Action:   model.SystemLogActionUpdate,
		Content:  "编辑模板风格",
		IP:       utils.GetClientIP(c),
	}
	model.CreateSystemLog(&log)

	c.JSON(http.StatusOK, model.Success.ToResponse(map[string]string{
		"template_type": req.TemplateType,
	}))
}

// @Summary Get enterprise template type
// @Description Get template type information of the current enterprise
// @Tags Enterprise
// @Accept json
// @Produce json
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse
// @Router /api/enterprises/template_type [get]
func GetEnterpriseTemplateType(c *gin.Context) {
	currentEid := config.GetEID(c)
	if currentEid <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	enterprise, err := model.GetEnterpriseModel(currentEid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.NotFound.ToResponse(nil))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(map[string]string{
		"template_type": enterprise.TemplateType,
	}))
}

// @Summary Get enterprise feature limits
// @Description Get all feature limits for the current enterprise
// @Tags Enterprise
// @Accept json
// @Produce json
// @Success 200 {object} model.CommonResponse{data=[]service.FeatureLimitResponse}
// @Router /api/enterprises/features [get]
func GetEnterpriseFeatureLimits(c *gin.Context) {
	featureLimits, err := service.GetEnterpriseFeatureLimits(c)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse("Failed to get feature limits"))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(featureLimits))
}
