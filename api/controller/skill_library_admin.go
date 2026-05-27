package controller

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type AdminImportSkillRequest struct {
	SourceType           string  `json:"source_type" binding:"required"`
	UploadFileID         string  `json:"upload_file_id"`
	GithubURL            string  `json:"github_url"`
	Ref                  string  `json:"ref"`
	SkillPath            string  `json:"skill_path"`
	GroupIDs             []int64 `json:"group_ids"`
	SubscriptionGroupIDs []int64 `json:"subscription_group_ids"`
	UserGroupIDs         []int64 `json:"user_group_ids"`
}

type AdminSkillListQuery struct {
	Keyword       string `form:"keyword"`
	PublishStatus string `form:"publish_status"`
	AdminStatus   string `form:"admin_status"`
	GroupID       string `form:"group_id"`
	Offset        int    `form:"offset"`
	Limit         int    `form:"limit"`
}

type AdminUpdateSkillRequest struct {
	DisplayName          *string `json:"display_name"`
	Description          *string `json:"description"`
	UsageGuide           *string `json:"usage_guide"`
	Version              *string `json:"version"`
	Sort                 *int64  `json:"sort"`
	AdminStatus          *string `json:"admin_status"`
	GroupIDs             []int64 `json:"group_ids"`
	SubscriptionGroupIDs []int64 `json:"subscription_group_ids"`
	UserGroupIDs         []int64 `json:"user_group_ids"`
}

type AdminUpdateSkillStatusRequest struct {
	PublishStatus string `json:"publish_status"`
	AdminStatus   string `json:"admin_status"`
}

type AdminSkillDetailResponse struct {
	Skill              *model.SkillLibrary `json:"skill"`
	GitHubURL          string              `json:"github_url,omitempty"`
	LatestScanJob      *model.SkillScanJob `json:"latest_scan_job,omitempty"`
	PermissionGroupIDs []int64             `json:"permission_group_ids"`
}

type AdminSkillImportJobResponse struct {
	Job   *model.SkillScanJob `json:"job"`
	Skill *model.SkillLibrary `json:"skill,omitempty"`
}

type AdminAIGenerateSkillRequest struct {
	GenerationType      string `json:"generation_type" binding:"required"`
	SkillMD             string `json:"skill_md"`
	TitleMaxChars       int    `json:"title_max_chars"`
	DescriptionMaxChars int    `json:"description_max_chars"`
	QuestionMaxChars    int    `json:"question_max_chars"`
	AnswerMaxChars      int    `json:"answer_max_chars"`
	CaseMaxChars        int    `json:"case_max_chars"`
	TargetChars         int    `json:"target_chars"`
	Document            string `json:"document"`
}

func toSkillAdminErrorResponse(c *gin.Context, err error) {
	if err == nil {
		return
	}

	switch {
	case errors.Is(err, service.ErrSkillImportRequestInvalid),
		errors.Is(err, service.ErrSkillStatusInvalid),
		errors.Is(err, service.ErrSkillPublishPrecheckFailed),
		errors.Is(err, service.ErrSkillGroupInvalid),
		errors.Is(err, service.ErrSkillPermissionGroupsInvalid),
		errors.Is(err, service.ErrSkillNameInvalid),
		errors.Is(err, service.ErrSkillNameDuplicated),
		errors.Is(err, service.ErrSkillAIGenerationTypeInvalid),
		errors.Is(err, service.ErrSkillAIGenerationDocRequired),
		errors.Is(err, service.ErrSkillImportSourceTypeUnsupported):
		c.JSON(http.StatusBadRequest, model.ParamError.ToErrorResponse(err))
	case errors.Is(err, service.ErrSkillPlatformReadonly):
		c.JSON(http.StatusForbidden, model.AuthFailed.ToErrorResponse(err))
	case errors.Is(err, gorm.ErrRecordNotFound):
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(nil))
	default:
		c.JSON(http.StatusInternalServerError, model.DBError.ToErrorResponse(err))
	}
}

func parseCommaSeparatedInt64IDs(input string) []int64 {
	parts := strings.Split(input, ",")
	ids := make([]int64, 0, len(parts))
	seen := make(map[int64]struct{}, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		id, err := strconv.ParseInt(part, 10, 64)
		if err != nil || id <= 0 {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	return ids
}

func buildSkillGitHubURL(skillInfo *model.SkillLibrary) string {
	if skillInfo == nil || skillInfo.SourceType != model.SkillSourceTypeGithub {
		return ""
	}

	sourceRef := strings.TrimSpace(skillInfo.SourceRef)
	if sourceRef == "" {
		return ""
	}

	repoURL, refPart, ok := strings.Cut(sourceRef, "@")
	if !ok {
		return ""
	}
	repoURL = strings.TrimSpace(repoURL)
	ref, skillPath, hasPath := strings.Cut(refPart, ":")
	ref = strings.TrimSpace(ref)
	if repoURL == "" || ref == "" {
		return ""
	}

	if hasPath {
		skillPath = strings.TrimSpace(skillPath)
		if skillPath != "" {
			return strings.TrimSuffix(repoURL, "/") + "/tree/" + ref + "/" + skillPath
		}
	}

	return strings.TrimSuffix(repoURL, "/")
}

// AdminImportSkillLibrary godoc
// @Summary 后台导入技能
// @Description 后台导入技能（当前支持 zip 和 GitHub 仓库导入）
// @Tags 技能库-后台
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body AdminImportSkillRequest true "导入参数"
// @Success 200 {object} model.CommonResponse
// @Router /api/admin/skill-library/import [post]
func AdminImportSkillLibrary(c *gin.Context) {
	var req AdminImportSkillRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToErrorResponse(err))
		return
	}

	eid := config.GetEID(c)
	svc := service.NewSkillLibraryService()
	allGroupIDs := make([]int64, 0, len(req.GroupIDs)+len(req.SubscriptionGroupIDs)+len(req.UserGroupIDs))
	allGroupIDs = append(allGroupIDs, req.GroupIDs...)
	allGroupIDs = append(allGroupIDs, req.SubscriptionGroupIDs...)
	allGroupIDs = append(allGroupIDs, req.UserGroupIDs...)
	result, err := svc.ImportSkillWithPermissionsAndStartScan(c.Request.Context(), &service.SkillImportRequest{
		Eid:          eid,
		SourceType:   strings.TrimSpace(req.SourceType),
		UploadFileID: strings.TrimSpace(req.UploadFileID),
		GithubURL:    strings.TrimSpace(req.GithubURL),
		Ref:          strings.TrimSpace(req.Ref),
		SkillPath:    strings.TrimSpace(req.SkillPath),
	}, allGroupIDs)
	if err != nil {
		toSkillAdminErrorResponse(c, err)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(result))
}

// AdminGetSkillLibraryImportJob godoc
// @Summary 查询后台技能导入任务
// @Description 根据任务ID查询后台技能导入任务的状态与关联技能信息
// @Tags 技能库-后台
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "导入任务ID"
// @Success 200 {object} model.CommonResponse
// @Router /api/admin/skill-library/import/jobs/{id} [get]
func AdminGetSkillLibraryImportJob(c *gin.Context) {
	jobID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || jobID <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	eid := config.GetEID(c)
	svc := service.NewSkillLibraryService()
	job, skillInfo, err := svc.GetSkillImportJobForAdmin(c.Request.Context(), eid, jobID)
	if err != nil {
		toSkillAdminErrorResponse(c, err)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(&AdminSkillImportJobResponse{
		Job:   job,
		Skill: skillInfo,
	}))
}

// AdminReloadSkillManager godoc
// @Summary 手动重载技能管理器
// @Description 手动刷新技能管理器缓存，适用于特殊场景下的技能目录变更同步
// @Tags 技能库-后台
// @Accept json
// @Produce json
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse
// @Router /api/admin/skill-library/reload [post]
func AdminReloadSkillManager(c *gin.Context) {
	svc := service.NewSkillLibraryService()
	if err := svc.ReloadSkillManager(c.Request.Context()); err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToErrorResponse(err))
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}

// AdminListSkillLibraries godoc
// @Summary 后台技能列表
// @Description 后台分页查询技能列表
// @Tags 技能库-后台
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param keyword query string false "关键词（匹配技能名、显示名）"
// @Param publish_status query string false "发布状态：draft/published/rejected" default(published)
// @Param admin_status query string false "管理状态：enabled/disabled" default(enabled)
// @Param group_id query string false "技能分组ID，多个ID用英文逗号分隔，为空时查询全部"
// @Param offset query int false "偏移量" default(0)
// @Param limit query int false "分页大小" default(20)
// @Success 200 {object} model.CommonResponse
// @Router /api/admin/skill-library/list [get]
func AdminListSkillLibraries(c *gin.Context) {
	var query AdminSkillListQuery
	if err := c.ShouldBindQuery(&query); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToErrorResponse(err))
		return
	}
	if query.Offset < 0 {
		query.Offset = 0
	}
	if query.Limit <= 0 {
		query.Limit = 20
	}

	eid := config.GetEID(c)

	var filterSkillIDs []int64
	groupIDs := parseCommaSeparatedInt64IDs(query.GroupID)
	if strings.TrimSpace(query.GroupID) != "" && len(groupIDs) == 0 {
		c.JSON(http.StatusOK, model.Success.ToResponse(gin.H{
			"count": 0,
			"items": []*model.SkillLibrary{},
		}))
		return
	}
	if len(groupIDs) > 0 {
		var err error
		filterSkillIDs, err = model.GetDistinctResourceIDsByGroupsAndType(groupIDs, model.ResourceTypeSkillLibrary)
		if err != nil {
			c.JSON(http.StatusInternalServerError, model.DBError.ToErrorResponse(err))
			return
		}
		if len(filterSkillIDs) == 0 {
			c.JSON(http.StatusOK, model.Success.ToResponse(gin.H{
				"count": 0,
				"items": []*model.SkillLibrary{},
			}))
			return
		}
	}

	svc := service.NewSkillLibraryService()
	items, count, err := svc.ListAdminSkillsWithFilter(c.Request.Context(), eid, query.Keyword, strings.TrimSpace(query.PublishStatus), strings.TrimSpace(query.AdminStatus), filterSkillIDs, query.Offset, query.Limit)
	if err != nil {
		toSkillAdminErrorResponse(c, err)
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(gin.H{
		"count": count,
		"items": items,
	}))
}

// AdminGetSkillLibrary godoc
// @Summary 后台技能详情
// @Description 获取后台技能详情（含最新扫描结果与权限分组）
// @Tags 技能库-后台
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "技能ID"
// @Success 200 {object} model.CommonResponse
// @Router /api/admin/skill-library/{id} [get]
func AdminGetSkillLibrary(c *gin.Context) {
	skillID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || skillID <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	eid := config.GetEID(c)
	svc := service.NewSkillLibraryService()
	skillInfo, job, err := svc.GetSkillByIDForAdmin(c.Request.Context(), eid, skillID)
	if err != nil {
		toSkillAdminErrorResponse(c, err)
		return
	}
	groupIDs := []int64{}
	if skillInfo != nil {
		groupIDs, err = model.GetResourcePermissionGroupIDs(skillID, model.ResourceTypeSkillLibrary)
		if err != nil {
			toSkillAdminErrorResponse(c, err)
			return
		}
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(&AdminSkillDetailResponse{
		Skill:              skillInfo,
		GitHubURL:          buildSkillGitHubURL(skillInfo),
		LatestScanJob:      job,
		PermissionGroupIDs: groupIDs,
	}))
}

// AdminUpdateSkillLibrary godoc
// @Summary 后台更新技能信息
// @Description 更新技能基础信息、排序、启停状态与权限分组配置
// @Tags 技能库-后台
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "技能ID"
// @Param request body AdminUpdateSkillRequest true "更新参数"
// @Success 200 {object} model.CommonResponse
// @Router /api/admin/skill-library/{id} [put]
func AdminUpdateSkillLibrary(c *gin.Context) {
	skillID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || skillID <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	var req AdminUpdateSkillRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToErrorResponse(err))
		return
	}

	eid := config.GetEID(c)
	svc := service.NewSkillLibraryService()
	allGroupIDs := make([]int64, 0, len(req.GroupIDs)+len(req.SubscriptionGroupIDs)+len(req.UserGroupIDs))
	allGroupIDs = append(allGroupIDs, req.GroupIDs...)
	allGroupIDs = append(allGroupIDs, req.SubscriptionGroupIDs...)
	allGroupIDs = append(allGroupIDs, req.UserGroupIDs...)
	err = svc.UpdateSkillMeta(c.Request.Context(), eid, skillID, &service.UpdateSkillMetaRequest{
		Sort:               req.Sort,
		DisplayName:        req.DisplayName,
		Description:        req.Description,
		UsageGuide:         req.UsageGuide,
		Version:            req.Version,
		AdminStatus:        req.AdminStatus,
		PermissionGroupIDs: allGroupIDs,
	})
	if err != nil {
		toSkillAdminErrorResponse(c, err)
		return
	}
	updatedSkill, _, err := svc.GetSkillByIDForAdmin(c.Request.Context(), eid, skillID)
	if err != nil {
		toSkillAdminErrorResponse(c, err)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(updatedSkill))
}

// AdminUpdateSkillLibraryStatus godoc
// @Summary 后台更新技能状态
// @Description 更新草稿/驳回/启停状态（发布请走 publish 接口）
// @Tags 技能库-后台
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "技能ID"
// @Param request body AdminUpdateSkillStatusRequest true "状态参数"
// @Success 200 {object} model.CommonResponse
// @Router /api/admin/skill-library/{id}/status [patch]
func AdminUpdateSkillLibraryStatus(c *gin.Context) {
	skillID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || skillID <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	var req AdminUpdateSkillStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToErrorResponse(err))
		return
	}

	eid := config.GetEID(c)
	svc := service.NewSkillLibraryService()
	currentSkill, _, err := svc.GetSkillByIDForAdmin(c.Request.Context(), eid, skillID)
	if err != nil {
		toSkillAdminErrorResponse(c, err)
		return
	}

	targetPublish := currentSkill.PublishStatus
	targetAdmin := currentSkill.AdminStatus
	reqPublishStatus := strings.TrimSpace(req.PublishStatus)
	reqAdminStatus := strings.TrimSpace(req.AdminStatus)
	if reqPublishStatus != "" {
		if reqPublishStatus == model.SkillPublishStatusPublished {
			c.JSON(http.StatusBadRequest, model.ParamError.ToErrorResponse(errors.New("published 状态请使用 publish 接口")))
			return
		}
		targetPublish = reqPublishStatus
	}
	if reqAdminStatus != "" {
		targetAdmin = reqAdminStatus
	}
	if reqPublishStatus == "" && reqAdminStatus == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToErrorResponse(errors.New("publish_status/admin_status 不能同时为空")))
		return
	}
	if err := svc.ValidateSkillStatusCombination(targetPublish, targetAdmin); err != nil {
		toSkillAdminErrorResponse(c, err)
		return
	}

	if err := svc.UpdateSkillStatusDirect(c.Request.Context(), eid, skillID, targetPublish, targetAdmin); err != nil {
		toSkillAdminErrorResponse(c, err)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}

// AdminDeleteSkillLibrary godoc
// @Summary 后台删除技能
// @Description 后台硬删除技能（删除后立即生效）
// @Tags 技能库-后台
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "技能ID"
// @Success 200 {object} model.CommonResponse
// @Router /api/admin/skill-library/{id} [delete]
func AdminDeleteSkillLibrary(c *gin.Context) {
	skillID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || skillID <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	eid := config.GetEID(c)
	svc := service.NewSkillLibraryService()
	if err := svc.DeleteSkill(c.Request.Context(), eid, skillID); err != nil {
		toSkillAdminErrorResponse(c, err)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}

// AdminGenerateSkillLibraryContent godoc
// @Summary 后台 AI 生成技能文案
// @Description 按单一类型生成技能文案（capabilities/usage_example/best_practice/faq/document_summary，不直接写库）
// @Tags 技能库-后台
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "技能ID"
// @Param request body AdminAIGenerateSkillRequest true "生成参数"
// @Success 200 {object} model.CommonResponse
// @Router /api/admin/skill-library/{id}/ai-generate [post]
func AdminGenerateSkillLibraryContent(c *gin.Context) {
	skillID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || skillID <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	var req AdminAIGenerateSkillRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToErrorResponse(err))
		return
	}

	eid := config.GetEID(c)
	svc := service.NewSkillLibraryService()
	result, err := svc.GenerateSkillContent(c.Request.Context(), eid, skillID, &service.SkillAIGenerateRequest{
		GenerationType:      strings.TrimSpace(req.GenerationType),
		SkillMD:             req.SkillMD,
		TitleMaxChars:       req.TitleMaxChars,
		DescriptionMaxChars: req.DescriptionMaxChars,
		QuestionMaxChars:    req.QuestionMaxChars,
		AnswerMaxChars:      req.AnswerMaxChars,
		CaseMaxChars:        req.CaseMaxChars,
		TargetChars:         req.TargetChars,
		Document:            req.Document,
	})
	if err != nil {
		toSkillAdminErrorResponse(c, err)
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(result))
}
