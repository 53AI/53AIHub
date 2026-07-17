package controller

import (
	"errors"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/middleware"
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
	MockRiskLevel        string  `json:"mock_risk_level"` // 调试参数，跳过扫描指定风险等级(low/medium/high)，仅用于调试强制导入流程
}

type AdminForceImportSkillRequest struct {
	ScanJobID int64 `json:"scan_job_id" binding:"required"`
}

type AdminSkillListQuery struct {
	Keyword       string `form:"keyword"`
	PublishStatus string `form:"publish_status"`
	AdminStatus   string `form:"admin_status"`
	GroupID       string `form:"group_id"`
	Offset        int    `form:"offset"`
	Limit         int    `form:"limit"`
}

// AdminUpdateSkillRequest 后台更新技能请求参数
type AdminUpdateSkillRequest struct {
	DisplayName          *string `json:"display_name"`           // 技能显示名称
	Description          *string `json:"description"`            // 技能描述
	UsageGuide           *string `json:"usage_guide"`            // 使用指南
	Version              *string `json:"version"`                // 版本号
	Sort                 *int64  `json:"sort"`                   // 排序权重
	AdminStatus          *string `json:"admin_status"`           // 管理状态：enabled/disabled
	GroupIDs             []int64 `json:"group_ids"`              // 权限分组ID列表
	SubscriptionGroupIDs []int64 `json:"subscription_group_ids"` // 订阅分组ID列表
	UserGroupIDs         []int64 `json:"user_group_ids"`         // 用户分组ID列表
	Logo                 *string `json:"logo"`                   // 技能 logo URL
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
		Eid:           eid,
		SourceType:    strings.TrimSpace(req.SourceType),
		UploadFileID:  strings.TrimSpace(req.UploadFileID),
		GithubURL:     strings.TrimSpace(req.GithubURL),
		Ref:           strings.TrimSpace(req.Ref),
		SkillPath:     strings.TrimSpace(req.SkillPath),
		MockRiskLevel: strings.TrimSpace(req.MockRiskLevel),
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

// AdminForceImportSkillLibrary godoc
// @Summary 强制导入高风险技能
// @Description 根据高风险失败的导入任务，跳过风险检查强制创建技能
// @Tags 技能库-后台
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body AdminForceImportSkillRequest true "强制导入参数"
// @Success 200 {object} model.CommonResponse
// @Router /api/admin/skill-library/import/force [post]
func AdminForceImportSkillLibrary(c *gin.Context) {
	var req AdminForceImportSkillRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToErrorResponse(err))
		return
	}

	eid := config.GetEID(c)
	svc := service.NewSkillLibraryService()
	result, err := svc.ForceImportSkill(c.Request.Context(), eid, req.ScanJobID)
	if err != nil {
		toSkillAdminErrorResponse(c, err)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(result))
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
// @Description 更新技能基础信息、排序、启停状态、权限分组配置及环境变量
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
	// 只有当至少有一个分组字段不为空时，才更新权限分组
	// 否则传 nil，表示不更新权限分组（避免误清空）
	var allGroupIDs []int64
	if len(req.GroupIDs) > 0 || len(req.SubscriptionGroupIDs) > 0 || len(req.UserGroupIDs) > 0 {
		allGroupIDs = make([]int64, 0, len(req.GroupIDs)+len(req.SubscriptionGroupIDs)+len(req.UserGroupIDs))
		allGroupIDs = append(allGroupIDs, req.GroupIDs...)
		allGroupIDs = append(allGroupIDs, req.SubscriptionGroupIDs...)
		allGroupIDs = append(allGroupIDs, req.UserGroupIDs...)
	}
	err = svc.UpdateSkillMeta(c.Request.Context(), eid, skillID, &service.UpdateSkillMetaRequest{
		Sort:               req.Sort,
		DisplayName:        req.DisplayName,
		Description:        req.Description,
		UsageGuide:         req.UsageGuide,
		Logo:               req.Logo,
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

// AdminPublishSkillLibrary godoc
// @Summary 后台发布技能
// @Description 扫描通过后发布技能并启用
// @Tags 技能库-后台
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "技能ID"
// @Success 200 {object} model.CommonResponse
// @Router /api/admin/skill-library/{id}/publish [post]
func AdminPublishSkillLibrary(c *gin.Context) {
	skillID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || skillID <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	eid := config.GetEID(c)
	svc := service.NewSkillLibraryService()
	if err := svc.PublishSkill(c.Request.Context(), eid, skillID); err != nil {
		toSkillAdminErrorResponse(c, err)
		return
	}
	skillInfo, latestJob, err := svc.GetSkillByIDForAdmin(c.Request.Context(), eid, skillID)
	if err != nil {
		toSkillAdminErrorResponse(c, err)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(&AdminSkillDetailResponse{
		Skill:         skillInfo,
		GitHubURL:     buildSkillGitHubURL(skillInfo),
		LatestScanJob: latestJob,
	}))
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

// SkillFileTreeResponse represents the response for file tree
type SkillFileTreeResponse struct {
	Files []service.SkillFileItem `json:"files"`
}

// GetSkillFileTree godoc
// @Summary 获取技能文件树
// @Description 获取技能包内的完整文件目录结构
// @Tags 技能库-后台
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "技能ID"
// @Success 200 {object} model.CommonResponse{data=controller.SkillFileTreeResponse}
// @Router /api/admin/skill-library/{id}/files [get]
func GetSkillFileTree(c *gin.Context) {
	skillID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || skillID <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	eid := config.GetEID(c)
	svc := service.NewSkillLibraryService()

	files, err := svc.GetSkillFileTree(c.Request.Context(), eid, skillID)
	if err != nil {
		toSkillAdminErrorResponse(c, err)
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(&SkillFileTreeResponse{
		Files: files,
	}))
}

// SkillFileContentResponse represents the response for file content
type SkillFileContentResponse struct {
	Path    string `json:"path"`
	Content string `json:"content"`
	Size    int64  `json:"size"`
}

// GetSkillFileContent godoc
// @Summary 获取技能文件内容
// @Description 获取技能包内指定文件的文本内容
// @Tags 技能库-后台
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "技能ID"
// @Param path path string true "文件相对路径"
// @Success 200 {object} model.CommonResponse{data=controller.SkillFileContentResponse}
// @Router /api/admin/skill-library/{id}/files/{path} [get]
func GetSkillFileContent(c *gin.Context) {
	skillID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || skillID <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	filePath := c.Param("path")
	if filePath == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToErrorResponse(errors.New("file path is required")))
		return
	}
	filePath = strings.TrimPrefix(filePath, "/")

	eid := config.GetEID(c)
	svc := service.NewSkillLibraryService()

	content, err := svc.GetSkillFileContent(c.Request.Context(), eid, skillID, filePath)
	if err != nil {
		toSkillAdminErrorResponse(c, err)
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(&SkillFileContentResponse{
		Path:    filePath,
		Content: content,
		Size:    int64(len(content)),
	}))
}

// PreviewSkillFile godoc
// @Summary 预览技能文件
// @Description 流式预览技能包内指定文件内容
// @Tags 技能库-后台
// @Accept json
// @Produce octet-stream
// @Security BearerAuth
// @Param id path int true "技能ID"
// @Param path path string true "文件相对路径"
// @Success 200 {file} binary "文件内容"
// @Router /api/admin/skill-library/{id}/files-preview/{path} [get]
func PreviewSkillFile(c *gin.Context) {
	skillID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || skillID <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	filePath := c.Param("path")
	if filePath == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToErrorResponse(errors.New("file path is required")))
		return
	}
	filePath = strings.TrimPrefix(filePath, "/")

	eid := config.GetEID(c)
	svc := service.NewSkillLibraryService()

	fileInfo, err := svc.GetSkillFileInfo(c.Request.Context(), eid, skillID, filePath)
	if err != nil {
		toSkillAdminErrorResponse(c, err)
		return
	}

	ext := strings.ToLower(filepath.Ext(filePath))
	contentType := "application/octet-stream"
	switch ext {
	case ".md":
		contentType = "text/markdown; charset=utf-8"
	case ".txt":
		contentType = "text/plain; charset=utf-8"
	case ".html", ".htm":
		contentType = "text/html; charset=utf-8"
	case ".json":
		contentType = "application/json; charset=utf-8"
	case ".yaml", ".yml":
		contentType = "text/yaml; charset=utf-8"
	case ".py":
		contentType = "text/x-python; charset=utf-8"
	case ".js":
		contentType = "application/javascript; charset=utf-8"
	case ".css":
		contentType = "text/css; charset=utf-8"
	}

	filename := filepath.Base(filePath)
	encodedFilename := url.QueryEscape(filename)
	c.Header("Content-Disposition", `inline; filename="`+filename+`"; filename*=UTF-8''`+encodedFilename)
	c.Header("Content-Type", contentType)
	c.Header("Content-Length", strconv.FormatInt(fileInfo.Size, 10))

	file, err := os.Open(fileInfo.FullPath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(err))
		return
	}
	defer file.Close()

	http.ServeContent(c.Writer, c.Request, filename, fileInfo.ModTime, file)
}

// SkillFileUpdateRequest represents the request for updating files
type SkillFileUpdateRequest struct {
	Files        []SkillFileUpdateItem `json:"files"`
	DeletedFiles []string              `json:"deleted_files"`
}

// SkillFileUpdateItem represents a file to update
type SkillFileUpdateItem struct {
	Path    string `json:"path" binding:"required"`
	Content string `json:"content" binding:"required"`
}

// SkillFileUpdateResponse represents the response for file update
type SkillFileUpdateResponse struct {
	UpdatedCount int    `json:"updated_count"`
	DeletedCount int    `json:"deleted_count"`
	Repackaged   bool   `json:"repackaged"`
	NewZipKey    string `json:"new_zip_key"`
}

// UpdateSkillFiles godoc
// @Summary 批量更新技能文件
// @Description 批量更新技能包内的文件内容，自动重新打包并上传
// @Tags 技能库-后台
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "技能ID"
// @Param request body controller.SkillFileUpdateRequest true "文件更新请求"
// @Success 200 {object} model.CommonResponse{data=controller.SkillFileUpdateResponse}
// @Router /api/admin/skill-library/{id}/files [put]
func UpdateSkillFiles(c *gin.Context) {
	skillID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || skillID <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	var req SkillFileUpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToErrorResponse(err))
		return
	}

	// 至少需要一个操作
	if len(req.Files) == 0 && len(req.DeletedFiles) == 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToErrorResponse(errors.New("at least one file operation required")))
		return
	}

	eid := config.GetEID(c)
	svc := service.NewSkillLibraryService()

	// 转换请求格式
	updateItems := make([]service.SkillFileUpdateItem, 0, len(req.Files))
	for _, f := range req.Files {
		updateItems = append(updateItems, service.SkillFileUpdateItem{
			Path:    f.Path,
			Content: f.Content,
		})
	}

	result, err := svc.UpdateSkillFiles(c.Request.Context(), eid, skillID, updateItems, req.DeletedFiles)
	if err != nil {
		toSkillAdminErrorResponse(c, err)
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(&SkillFileUpdateResponse{
		UpdatedCount: result.UpdatedCount,
		DeletedCount: result.DeletedCount,
		Repackaged:   result.Repackaged,
		NewZipKey:    result.NewZipKey,
	}))
}

// ==================== 技能环境变量接口 ====================

// SkillEnvVarResponse 技能环境变量响应
type SkillEnvVarResponse struct {
	ID        int64  `json:"id"`
	Key       string `json:"key"`
	Value     string `json:"value"`
	Sensitive bool   `json:"sensitive"`
}

// SkillEnvVarListResponse 技能环境变量列表响应
type SkillEnvVarListResponse struct {
	Items []SkillEnvVarResponse `json:"items"`
}

// CreateSkillEnvVarRequest 创建技能环境变量请求
type CreateSkillEnvVarRequest struct {
	Key       string `json:"key" binding:"required"`
	Value     string `json:"value"`
	Sensitive bool   `json:"sensitive"`
}

// UpdateSkillEnvVarRequest 更新技能环境变量请求
type UpdateSkillEnvVarRequest struct {
	Key       *string `json:"key"`
	Value     *string `json:"value"`
	Sensitive *bool   `json:"sensitive"`
}

// BatchUpdateSkillEnvVarsRequest 批量更新技能环境变量请求
type BatchUpdateSkillEnvVarsRequest struct {
	Items []CreateSkillEnvVarRequest `json:"items" binding:"required"`
}

// AdminListSkillEnvVars godoc
// @Summary 获取技能环境变量列表
// @Description 获取指定技能的所有环境变量
// @Tags 技能库-后台-环境变量
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "技能ID"
// @Success 200 {object} model.CommonResponse{data=SkillEnvVarListResponse}
// @Router /api/admin/skill-library/{id}/env-vars [get]
func AdminListSkillEnvVars(c *gin.Context) {
	skillID, ok := middleware.MustParseIDParam(c, "id")
	if !ok {
		return
	}

	eid := config.GetEID(c)
	svc := service.NewSkillLibraryService()

	records, err := svc.ListSkillEnvVars(c.Request.Context(), eid, skillID)
	if err != nil {
		toSkillAdminErrorResponse(c, err)
		return
	}

	items := make([]SkillEnvVarResponse, 0, len(records))
	for _, record := range records {
		resp := SkillEnvVarResponse{
			ID:        record.ID,
			Key:       record.Key,
			Value:     record.Value,
			Sensitive: record.Sensitive,
		}
		if record.Sensitive {
			resp.Value = "***"
		}
		items = append(items, resp)
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(&SkillEnvVarListResponse{Items: items}))
}

// AdminCreateSkillEnvVar godoc
// @Summary 创建技能环境变量
// @Description 为指定技能创建新的环境变量
// @Tags 技能库-后台-环境变量
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "技能ID"
// @Param request body CreateSkillEnvVarRequest true "环境变量信息"
// @Success 200 {object} model.CommonResponse{data=SkillEnvVarResponse}
// @Router /api/admin/skill-library/{id}/env-vars [post]
func AdminCreateSkillEnvVar(c *gin.Context) {
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
	svc := service.NewSkillLibraryService()

	record, err := svc.CreateSkillEnvVar(c.Request.Context(), eid, skillID, &service.CreateSkillEnvVarRequest{
		Key:       req.Key,
		Value:     req.Value,
		Sensitive: req.Sensitive,
	})
	if err != nil {
		toSkillAdminErrorResponse(c, err)
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(&SkillEnvVarResponse{
		ID:        record.ID,
		Key:       record.Key,
		Value:     record.Value,
		Sensitive: record.Sensitive,
	}))
}

// AdminUpdateSkillEnvVar godoc
// @Summary 更新技能环境变量
// @Description 更新指定技能的环境变量
// @Tags 技能库-后台-环境变量
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "技能ID"
// @Param env_var_id path int true "环境变量ID"
// @Param request body UpdateSkillEnvVarRequest true "更新信息"
// @Success 200 {object} model.CommonResponse{data=SkillEnvVarResponse}
// @Router /api/admin/skill-library/{id}/env-vars/{env_var_id} [put]
func AdminUpdateSkillEnvVar(c *gin.Context) {
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
	svc := service.NewSkillLibraryService()

	record, err := svc.UpdateSkillEnvVar(c.Request.Context(), eid, skillID, envVarID, &service.UpdateSkillEnvVarRequest{
		Key:       req.Key,
		Value:     req.Value,
		Sensitive: req.Sensitive,
	})
	if err != nil {
		toSkillAdminErrorResponse(c, err)
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(&SkillEnvVarResponse{
		ID:        record.ID,
		Key:       record.Key,
		Value:     record.Value,
		Sensitive: record.Sensitive,
	}))
}

// AdminDeleteSkillEnvVar godoc
// @Summary 删除技能环境变量
// @Description 删除指定技能的环境变量
// @Tags 技能库-后台-环境变量
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "技能ID"
// @Param env_var_id path int true "环境变量ID"
// @Success 200 {object} model.CommonResponse
// @Router /api/admin/skill-library/{id}/env-vars/{env_var_id} [delete]
func AdminDeleteSkillEnvVar(c *gin.Context) {
	skillID, ok := middleware.MustParseIDParam(c, "id")
	if !ok {
		return
	}

	envVarID, ok := middleware.MustParseIDParam(c, "env_var_id")
	if !ok {
		return
	}

	eid := config.GetEID(c)
	svc := service.NewSkillLibraryService()

	err := svc.DeleteSkillEnvVar(c.Request.Context(), eid, skillID, envVarID)
	if err != nil {
		toSkillAdminErrorResponse(c, err)
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}

// AdminBatchUpdateSkillEnvVars godoc
// @Summary 批量更新技能环境变量
// @Description 替换指定技能的所有环境变量（先删后建）
// @Tags 技能库-后台-环境变量
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "技能ID"
// @Param request body BatchUpdateSkillEnvVarsRequest true "环境变量列表"
// @Success 200 {object} model.CommonResponse{data=SkillEnvVarListResponse}
// @Router /api/admin/skill-library/{id}/env-vars/batch [put]
func AdminBatchUpdateSkillEnvVars(c *gin.Context) {
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
	svc := service.NewSkillLibraryService()

	// 转换请求
	envVars := make([]model.SkillEnvVar, 0, len(req.Items))
	for _, item := range req.Items {
		envVars = append(envVars, model.SkillEnvVar{
			Key:       item.Key,
			Value:     item.Value,
			Sensitive: item.Sensitive,
		})
	}

	records, err := svc.BatchUpdateSkillEnvVars(c.Request.Context(), eid, skillID, envVars)
	if err != nil {
		toSkillAdminErrorResponse(c, err)
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
