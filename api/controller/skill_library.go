package controller

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/middleware"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type SkillExploreQuery struct {
	Keyword string `form:"keyword"`
	GroupID string `form:"group_id"`
	Offset  int    `form:"offset"`
	Limit   int    `form:"limit"`
}

type SkillPublicResponse struct {
	ID                int64                     `json:"id"`
	Eid               int64                     `json:"eid"`
	SourceType        string                    `json:"source_type"`
	Logo              string                    `json:"logo"`
	SkillName         string                    `json:"skill_name"`
	Sort              int64                     `json:"sort"`
	DisplayName       string                    `json:"display_name"`
	Description       string                    `json:"description"`
	Version           string                    `json:"version"`
	UsageGuide        string                    `json:"usage_guide"`
	OriginZipName     string                    `json:"origin_zip_name"`
	OriginZipSize     int64                     `json:"origin_zip_size"`
	OriginZipSHA256   string                    `json:"origin_zip_sha256"`
	PublishStatus     string                    `json:"publish_status"`
	AdminStatus       string                    `json:"admin_status"`
	RiskLevel         string                    `json:"risk_level"`
	ScoreIntegrity    float64                   `json:"score_integrity"`
	ScorePracticality float64                   `json:"score_practicality"`
	ScoreSafety       float64                   `json:"score_safety"`
	ScoreCodeQuality  float64                   `json:"score_code_quality"`
	ScoreDocQuality   float64                   `json:"score_doc_quality"`
	ScanMessage       string                    `json:"scan_message"`
	GroupIDs          []int64                   `json:"group_ids"`
	Scopes            []model.ResourceScopeItem `json:"scopes"`
	CreatedTime       int64                     `json:"created_time"`
	UpdatedTime       int64                     `json:"updated_time"`
}

type SkillExploreListItemResponse struct {
	SkillPublicResponse
}

type SkillDetailResponse struct {
	SkillPublicResponse
	EnvVars []SkillEnvVarTemplateResponse `json:"env_vars,omitempty"`
}

type SkillEnvVarTemplateResponse struct {
	Key       string `json:"key"`
	Sensitive bool   `json:"sensitive"`
}

func buildSkillPublicResponse(skillInfo *model.SkillLibrary) *SkillPublicResponse {
	if skillInfo == nil {
		return nil
	}
	groupIDs := skillInfo.GroupIDs
	if groupIDs == nil {
		groupIDs = []int64{}
	}
	scopes := skillInfo.Scopes
	if scopes == nil {
		scopes = []model.ResourceScopeItem{}
	}
	return &SkillPublicResponse{
		ID:                skillInfo.ID,
		Eid:               skillInfo.Eid,
		SourceType:        skillInfo.SourceType,
		Logo:              skillInfo.Logo,
		SkillName:         skillInfo.SkillName,
		Sort:              skillInfo.Sort,
		DisplayName:       skillInfo.DisplayName,
		Description:       skillInfo.Description,
		Version:           skillInfo.Version,
		UsageGuide:        skillInfo.UsageGuide,
		OriginZipName:     skillInfo.OriginZipName,
		OriginZipSize:     skillInfo.OriginZipSize,
		OriginZipSHA256:   skillInfo.OriginZipSHA256,
		PublishStatus:     skillInfo.PublishStatus,
		AdminStatus:       skillInfo.AdminStatus,
		RiskLevel:         skillInfo.RiskLevel,
		ScoreIntegrity:    skillInfo.ScoreIntegrity,
		ScorePracticality: skillInfo.ScorePracticality,
		ScoreSafety:       skillInfo.ScoreSafety,
		ScoreCodeQuality:  skillInfo.ScoreCodeQuality,
		ScoreDocQuality:   skillInfo.ScoreDocQuality,
		ScanMessage:       skillInfo.ScanMessage,
		GroupIDs:          groupIDs,
		Scopes:            scopes,
		CreatedTime:       skillInfo.CreatedTime,
		UpdatedTime:       skillInfo.UpdatedTime,
	}
}

func toSkillErrorResponse(c *gin.Context, err error) {
	if err == nil {
		return
	}
	switch {
	case errors.Is(err, service.ErrSkillNotVisible), errors.Is(err, service.ErrSkillNotPublished), errors.Is(err, service.ErrSkillDisabled):
		c.JSON(http.StatusForbidden, model.AuthFailed.ToErrorResponse(err))
	case errors.Is(err, service.ErrSkillStatusInvalid):
		c.JSON(http.StatusBadRequest, model.ParamError.ToErrorResponse(err))
	case errors.Is(err, gorm.ErrRecordNotFound):
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(nil))
	default:
		c.JSON(http.StatusInternalServerError, model.DBError.ToErrorResponse(err))
	}
}

func toSkillUserEnvErrorResponse(c *gin.Context, err error) {
	if err == nil {
		return
	}
	switch {
	case errors.Is(err, service.ErrSkillImportRequestInvalid),
		errors.Is(err, service.ErrSkillStatusInvalid),
		errors.Is(err, service.ErrSkillGroupInvalid),
		errors.Is(err, service.ErrSkillPermissionGroupsInvalid):
		c.JSON(http.StatusBadRequest, model.ParamError.ToErrorResponse(err))
	case errors.Is(err, service.ErrSkillNotVisible), errors.Is(err, service.ErrSkillNotPublished), errors.Is(err, service.ErrSkillDisabled):
		c.JSON(http.StatusForbidden, model.AuthFailed.ToErrorResponse(err))
	case errors.Is(err, gorm.ErrRecordNotFound):
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(nil))
	default:
		c.JSON(http.StatusInternalServerError, model.DBError.ToErrorResponse(err))
	}
}

// GetSkillExploreList godoc
// @Summary 获取技能库探索列表
// @Description 获取当前企业可见的已发布技能列表（含平台技能），无需登录。
// @Tags 技能库
// @Accept json
// @Produce json
// @Param keyword query string false "关键词（匹配技能名skill_name、展示名display_name）"
// @Param group_id query string false "技能分组ID，多个ID用逗号分隔，用于筛选技能所属分组"
// @Param offset query int false "分页偏移" default(0)
// @Param limit query int false "分页大小" default(20)
// @Success 200 {object} model.CommonResponse{data=object{count=int64,items=[]controller.SkillExploreListItemResponse}} "成功"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 500 {object} model.CommonResponse "服务器错误"
// @Router /api/skill-library/explore [get]
func GetSkillExploreList(c *gin.Context) {
	var query SkillExploreQuery
	if err := c.ShouldBindQuery(&query); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToErrorResponse(err))
		return
	}
	if query.Limit <= 0 {
		query.Limit = 20
	}
	if query.Offset < 0 {
		query.Offset = 0
	}

	eid := config.GetEID(c)
	userID := config.GetUserId(c)
	groupIDs := parseCommaSeparatedInt64IDs(query.GroupID)

	svc := service.NewSkillLibraryService()
	result, err := svc.ListExploreSkills(c.Request.Context(), eid, userID, query.Keyword, groupIDs, query.Offset, query.Limit)
	if err != nil {
		toSkillErrorResponse(c, err)
		return
	}

	items := make([]*SkillExploreListItemResponse, 0, len(result.Items))
	for _, item := range result.Items {
		if item == nil || item.SkillLibrary == nil {
			continue
		}
		items = append(items, &SkillExploreListItemResponse{
			SkillPublicResponse: *buildSkillPublicResponse(item.SkillLibrary),
		})
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(gin.H{
		"count": result.Count,
		"items": items,
	}))
}

// GetSkillDetail godoc
// @Summary 获取技能详情
// @Description 获取技能详情，包含技能基础信息、评分、风险等级及企业环境变量 key 列表
// @Tags 技能库
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "技能ID（HashID编码）"
// @Success 200 {object} model.CommonResponse{data=controller.SkillDetailResponse} "成功"
// @Failure 400 {object} model.CommonResponse "参数错误：ID格式不正确"
// @Failure 403 {object} model.CommonResponse "权限不足：技能不可见、未发布或已禁用"
// @Failure 404 {object} model.CommonResponse "技能不存在"
// @Router /api/skill-library/{id} [get]
func GetSkillDetail(c *gin.Context) {
	skillID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || skillID <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}
	eid := config.GetEID(c)
	userID := config.GetUserId(c)
	userGroupID := config.GetUserGroupID(c)

	svc := service.NewSkillLibraryService()
	skillInfo, getErr := svc.GetSkillDetailForUser(c.Request.Context(), eid, userID, userGroupID, skillID)
	if getErr != nil {
		toSkillErrorResponse(c, getErr)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(&SkillDetailResponse{
		SkillPublicResponse: *buildSkillPublicResponse(skillInfo.SkillLibrary),
		EnvVars: func() []SkillEnvVarTemplateResponse {
			if len(skillInfo.EnvVars) == 0 {
				return []SkillEnvVarTemplateResponse{}
			}
			envVars := make([]SkillEnvVarTemplateResponse, 0, len(skillInfo.EnvVars))
			for _, envVar := range skillInfo.EnvVars {
				envVars = append(envVars, SkillEnvVarTemplateResponse{
					Key:       envVar.Key,
					Sensitive: envVar.Sensitive,
				})
			}
			return envVars
		}(),
	}))
}

// DownloadSkillZip godoc
// @Summary 下载技能安装包
// @Description 下载当前用户可见技能的标准zip安装包，返回application/zip格式文件
// @Tags 技能库
// @Accept json
// @Produce application/zip
// @Security BearerAuth
// @Param id path int true "技能ID（HashID编码）"
// @Success 200 {file} string "zip binary"
// @Failure 400 {object} model.CommonResponse "参数错误：ID格式不正确"
// @Failure 403 {object} model.CommonResponse "权限不足：技能不可见、未发布或已禁用"
// @Failure 404 {object} model.CommonResponse "技能不存在或文件不存在"
// @Router /api/skill-library/{id}/download [get]
func DownloadSkillZip(c *gin.Context) {
	skillID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || skillID <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}
	eid := config.GetEID(c)
	userID := config.GetUserId(c)
	userGroupID := config.GetUserGroupID(c)

	svc := service.NewSkillLibraryService()
	fileName, content, downloadErr := svc.DownloadSkillZipForUser(c.Request.Context(), eid, userID, userGroupID, skillID)
	if downloadErr != nil {
		toSkillErrorResponse(c, downloadErr)
		return
	}

	c.Header("Content-Type", "application/zip")
	c.Header("Content-Disposition", "attachment; filename=\""+fileName+"\"")
	c.Header("Content-Length", strconv.Itoa(len(content)))
	c.Data(http.StatusOK, "application/zip", content)
}

// GetSkillMD godoc
// @Summary 获取技能SKILL.md内容
// @Description 获取当前用户可见技能的SKILL.md文本内容，返回text/plain格式
// @Tags 技能库
// @Accept json
// @Produce text/plain
// @Security BearerAuth
// @Param id path int true "技能ID（HashID编码）"
// @Success 200 {string} string "SKILL.md文本内容"
// @Failure 400 {object} model.CommonResponse "参数错误：ID格式不正确"
// @Failure 403 {object} model.CommonResponse "权限不足：技能不可见、未发布或已禁用"
// @Failure 404 {object} model.CommonResponse "技能不存在或SKILL.md文件不存在"
// @Router /api/skill-library/{id}/skill-md [get]
func GetSkillMD(c *gin.Context) {
	skillID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || skillID <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}
	eid := config.GetEID(c)
	userID := config.GetUserId(c)
	userGroupID := config.GetUserGroupID(c)
	svc := service.NewSkillLibraryService()
	content, getErr := svc.GetSkillMDForUser(c.Request.Context(), eid, userID, userGroupID, skillID)
	if getErr != nil {
		toSkillErrorResponse(c, getErr)
		return
	}
	c.Data(http.StatusOK, "text/plain; charset=utf-8", []byte(content))
}

// GetMySkillEnvVars godoc
// @Summary 获取我的技能环境变量列表
// @Description 获取当前用户针对指定技能配置的环境变量列表，返回原始值，不做脱敏
// @Tags 技能库
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "技能ID（HashID编码）"
// @Success 200 {object} model.CommonResponse{data=SkillEnvVarListResponse} "成功"
// @Failure 400 {object} model.CommonResponse "参数错误：ID格式不正确"
// @Failure 403 {object} model.CommonResponse "权限不足：技能不可见、未发布或已禁用"
// @Failure 404 {object} model.CommonResponse "技能不存在"
// @Router /api/skill-library/{id}/env-vars [get]
func GetMySkillEnvVars(c *gin.Context) {
	skillID, ok := middleware.MustParseIDParam(c, "id")
	if !ok {
		return
	}

	eid := config.GetEID(c)
	userID := config.GetUserId(c)
	userGroupID := config.GetUserGroupID(c)
	svc := service.NewSkillLibraryService()
	if _, err := svc.GetSkillDetailForUser(c.Request.Context(), eid, userID, userGroupID, skillID); err != nil {
		toSkillErrorResponse(c, err)
		return
	}

	records, err := svc.ListSkillUserEnvVars(c.Request.Context(), eid, userID, skillID)
	if err != nil {
		toSkillUserEnvErrorResponse(c, err)
		return
	}

	items := make([]SkillEnvVarResponse, 0, len(records))
	for _, record := range records {
		items = append(items, SkillEnvVarResponse{
			ID:        record.ID,
			Key:       record.Key,
			Value:     record.Value,
			Sensitive: record.Sensitive,
		})
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(&SkillEnvVarListResponse{Items: items}))
}

// CreateMySkillEnvVar godoc
// @Summary 创建我的技能环境变量
// @Description 为当前用户指定的技能新增一个环境变量
// @Tags 技能库
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "技能ID（HashID编码）"
// @Param request body CreateSkillEnvVarRequest true "环境变量信息"
// @Success 200 {object} model.CommonResponse{data=SkillEnvVarResponse} "成功"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 403 {object} model.CommonResponse "权限不足"
// @Failure 404 {object} model.CommonResponse "技能不存在"
// @Router /api/skill-library/{id}/env-vars [post]
func CreateMySkillEnvVar(c *gin.Context) {
	skillID, ok := middleware.MustParseIDParam(c, "id")
	if !ok {
		return
	}

	var req CreateSkillEnvVarRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToErrorResponse(err))
		return
	}

	eid := config.GetEID(c)
	userID := config.GetUserId(c)
	userGroupID := config.GetUserGroupID(c)
	svc := service.NewSkillLibraryService()
	if _, err := svc.GetSkillDetailForUser(c.Request.Context(), eid, userID, userGroupID, skillID); err != nil {
		toSkillErrorResponse(c, err)
		return
	}

	record, err := svc.CreateSkillUserEnvVar(c.Request.Context(), eid, userID, skillID, &service.CreateSkillUserEnvVarRequest{
		Key:       req.Key,
		Value:     req.Value,
		Sensitive: req.Sensitive,
	})
	if err != nil {
		toSkillUserEnvErrorResponse(c, err)
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(&SkillEnvVarResponse{
		ID:        record.ID,
		Key:       record.Key,
		Value:     record.Value,
		Sensitive: record.Sensitive,
	}))
}

// UpdateMySkillEnvVar godoc
// @Summary 更新我的技能环境变量
// @Description 更新当前用户指定技能下的某个环境变量
// @Tags 技能库
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "技能ID（HashID编码）"
// @Param env_var_id path int true "环境变量ID"
// @Param request body UpdateSkillEnvVarRequest true "更新信息"
// @Success 200 {object} model.CommonResponse{data=SkillEnvVarResponse} "成功"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 403 {object} model.CommonResponse "权限不足"
// @Failure 404 {object} model.CommonResponse "技能不存在"
// @Router /api/skill-library/{id}/env-vars/{env_var_id} [put]
func UpdateMySkillEnvVar(c *gin.Context) {
	skillID, ok := middleware.MustParseIDParam(c, "id")
	if !ok {
		return
	}

	envVarID, ok := middleware.MustParseIDParam(c, "env_var_id")
	if !ok {
		return
	}

	var req UpdateSkillEnvVarRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToErrorResponse(err))
		return
	}

	eid := config.GetEID(c)
	userID := config.GetUserId(c)
	userGroupID := config.GetUserGroupID(c)
	svc := service.NewSkillLibraryService()
	if _, err := svc.GetSkillDetailForUser(c.Request.Context(), eid, userID, userGroupID, skillID); err != nil {
		toSkillErrorResponse(c, err)
		return
	}

	record, err := svc.UpdateSkillUserEnvVar(c.Request.Context(), eid, userID, skillID, envVarID, &service.UpdateSkillUserEnvVarRequest{
		Key:       req.Key,
		Value:     req.Value,
		Sensitive: req.Sensitive,
	})
	if err != nil {
		toSkillUserEnvErrorResponse(c, err)
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(&SkillEnvVarResponse{
		ID:        record.ID,
		Key:       record.Key,
		Value:     record.Value,
		Sensitive: record.Sensitive,
	}))
}

// DeleteMySkillEnvVar godoc
// @Summary 删除我的技能环境变量
// @Description 删除当前用户指定技能下的某个环境变量
// @Tags 技能库
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "技能ID（HashID编码）"
// @Param env_var_id path int true "环境变量ID"
// @Success 200 {object} model.CommonResponse
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 403 {object} model.CommonResponse "权限不足"
// @Failure 404 {object} model.CommonResponse "技能不存在"
// @Router /api/skill-library/{id}/env-vars/{env_var_id} [delete]
func DeleteMySkillEnvVar(c *gin.Context) {
	skillID, ok := middleware.MustParseIDParam(c, "id")
	if !ok {
		return
	}

	envVarID, ok := middleware.MustParseIDParam(c, "env_var_id")
	if !ok {
		return
	}

	eid := config.GetEID(c)
	userID := config.GetUserId(c)
	userGroupID := config.GetUserGroupID(c)
	svc := service.NewSkillLibraryService()
	if _, err := svc.GetSkillDetailForUser(c.Request.Context(), eid, userID, userGroupID, skillID); err != nil {
		toSkillErrorResponse(c, err)
		return
	}

	if err := svc.DeleteSkillUserEnvVar(c.Request.Context(), eid, userID, skillID, envVarID); err != nil {
		toSkillUserEnvErrorResponse(c, err)
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}

// BatchUpdateMySkillEnvVars godoc
// @Summary 批量更新我的技能环境变量
// @Description 先删除再创建当前用户指定技能下的所有环境变量
// @Tags 技能库
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "技能ID（HashID编码）"
// @Param request body BatchUpdateSkillEnvVarsRequest true "环境变量列表"
// @Success 200 {object} model.CommonResponse{data=SkillEnvVarListResponse} "成功"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 403 {object} model.CommonResponse "权限不足"
// @Failure 404 {object} model.CommonResponse "技能不存在"
// @Router /api/skill-library/{id}/env-vars/batch [put]
func BatchUpdateMySkillEnvVars(c *gin.Context) {
	skillID, ok := middleware.MustParseIDParam(c, "id")
	if !ok {
		return
	}

	var req BatchUpdateSkillEnvVarsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToErrorResponse(err))
		return
	}

	eid := config.GetEID(c)
	userID := config.GetUserId(c)
	userGroupID := config.GetUserGroupID(c)
	svc := service.NewSkillLibraryService()
	if _, err := svc.GetSkillDetailForUser(c.Request.Context(), eid, userID, userGroupID, skillID); err != nil {
		toSkillErrorResponse(c, err)
		return
	}

	envVars := make([]model.SkillEnvVar, 0, len(req.Items))
	for _, item := range req.Items {
		envVars = append(envVars, model.SkillEnvVar{
			Key:       item.Key,
			Value:     item.Value,
			Sensitive: item.Sensitive,
		})
	}

	records, err := svc.BatchUpdateSkillUserEnvVars(c.Request.Context(), eid, userID, skillID, envVars)
	if err != nil {
		toSkillUserEnvErrorResponse(c, err)
		return
	}

	items := make([]SkillEnvVarResponse, 0, len(records))
	for _, record := range records {
		items = append(items, SkillEnvVarResponse{
			ID:        record.ID,
			Key:       record.Key,
			Value:     record.Value,
			Sensitive: record.Sensitive,
		})
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(&SkillEnvVarListResponse{Items: items}))
}
