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

type SkillExploreQuery struct {
	Keyword string `form:"keyword"`
	GroupID string `form:"group_id"`
	Offset  int    `form:"offset"`
	Limit   int    `form:"limit"`
}

type UpdateMySkillStatusRequest struct {
	Status string `json:"status" binding:"required"`
}

type SkillPublicResponse struct {
	ID                int64   `json:"id"`
	Eid               int64   `json:"eid"`
	SourceType        string  `json:"source_type"`
	SkillName         string  `json:"skill_name"`
	Sort              int64   `json:"sort"`
	DisplayName       string  `json:"display_name"`
	Description       string  `json:"description"`
	Version           string  `json:"version"`
	UsageGuide        string  `json:"usage_guide"`
	OriginZipName     string  `json:"origin_zip_name"`
	OriginZipSize     int64   `json:"origin_zip_size"`
	OriginZipSHA256   string  `json:"origin_zip_sha256"`
	PublishStatus     string  `json:"publish_status"`
	AdminStatus       string  `json:"admin_status"`
	RiskLevel         string  `json:"risk_level"`
	ScoreIntegrity    float64 `json:"score_integrity"`
	ScorePracticality float64 `json:"score_practicality"`
	ScoreSafety       float64 `json:"score_safety"`
	ScoreCodeQuality  float64 `json:"score_code_quality"`
	ScoreDocQuality   float64 `json:"score_doc_quality"`
	ScanMessage       string  `json:"scan_message"`
	CreatedTime       int64   `json:"created_time"`
	UpdatedTime       int64   `json:"updated_time"`
}

type SkillExploreListItemResponse struct {
	SkillPublicResponse
	BindingID     int64  `json:"binding_id"`
	Added         bool   `json:"added"`
	BindingStatus string `json:"binding_status"`
}

type SkillDetailResponse struct {
	SkillPublicResponse
	BindingID     int64  `json:"binding_id"`
	Added         bool   `json:"added"`
	BindingStatus string `json:"binding_status"`
}

type SkillMyListItemResponse struct {
	// 注意：该结构体中的 created_time / updated_time 表示“我的技能”绑定记录的创建、更新时间，不表示技能本身的时间。
	BindingID int64 `json:"binding_id"`
	SkillPublicResponse
	BindingStatus string `json:"binding_status"`
}

func buildSkillPublicResponse(skillInfo *model.SkillLibrary) *SkillPublicResponse {
	if skillInfo == nil {
		return nil
	}
	return &SkillPublicResponse{
		ID:                skillInfo.ID,
		Eid:               skillInfo.Eid,
		SourceType:        skillInfo.SourceType,
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

// GetSkillExploreList godoc
// @Summary 获取技能库探索列表
// @Description 获取当前用户可见的已发布技能列表（含平台技能），每个技能包含当前用户绑定状态。仅返回当前用户有权限的技能：平台技能全量可见，其他技能必须命中用户所属分组权限。
// @Tags 技能库
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param keyword query string false "关键词（匹配技能名skill_name、展示名display_name）"
// @Param group_id query string false "技能分组ID，多个ID用逗号分隔，用于筛选技能所属分组"
// @Param offset query int false "分页偏移" default(0)
// @Param limit query int false "分页大小" default(20)
// @Success 200 {object} model.CommonResponse{data=object{count=int64,items=[]controller.SkillExploreListItemResponse}} "成功"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 401 {object} model.CommonResponse "未授权"
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
		public := buildSkillPublicResponse(item.SkillLibrary)
		items = append(items, &SkillExploreListItemResponse{
			SkillPublicResponse: *public,
			BindingID:           item.BindingID,
			Added:               item.Added,
			BindingStatus:       item.BindingStatus,
		})
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(gin.H{
		"count": result.Count,
		"items": items,
	}))
}

// GetSkillDetail godoc
// @Summary 获取技能详情
// @Description 获取技能详情，包含技能基础信息、评分、风险等级及当前用户绑定状态（binding_id、added、binding_status）
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
		BindingID:           skillInfo.BindingID,
		Added:               skillInfo.Added,
		BindingStatus:       skillInfo.BindingStatus,
	}))
}

// AddSkillToMy godoc
// @Summary 添加技能到我的
// @Description 将探索技能添加到当前用户"我的技能"列表。接口幂等，重复添加不会报错，添加后默认状态为enabled。
// @Tags 技能库
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "技能ID（HashID编码）"
// @Success 200 {object} model.CommonResponse "成功"
// @Failure 400 {object} model.CommonResponse "参数错误：ID格式不正确"
// @Failure 403 {object} model.CommonResponse "权限不足：技能不可见、未发布或已禁用"
// @Failure 404 {object} model.CommonResponse "技能不存在"
// @Router /api/skill-library/{id}/add [post]
func AddSkillToMy(c *gin.Context) {
	skillID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || skillID <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}
	eid := config.GetEID(c)
	userID := config.GetUserId(c)
	userGroupID := config.GetUserGroupID(c)

	svc := service.NewSkillLibraryService()
	if addErr := svc.AddSkillToMy(c.Request.Context(), eid, userID, userGroupID, skillID); addErr != nil {
		toSkillErrorResponse(c, addErr)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}

// GetMySkillList godoc
// @Summary 获取我的技能列表
// @Description 获取当前用户已添加的技能列表，包含技能详情、绑定状态（binding_status: enabled/disabled）以及绑定记录的创建时间和更新时间。
// @Tags 技能库
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param offset query int false "分页偏移" default(0)
// @Param limit query int false "分页大小" default(20)
// @Success 200 {object} model.CommonResponse{data=object{count=int64,items=[]controller.SkillMyListItemResponse}} "成功"
// @Failure 401 {object} model.CommonResponse "未授权"
// @Failure 500 {object} model.CommonResponse "服务器错误"
// @Router /api/skill-library/my [get]
func GetMySkillList(c *gin.Context) {
	offset, _ := strconv.Atoi(c.Query("offset"))
	limit, _ := strconv.Atoi(c.Query("limit"))
	if limit <= 0 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}

	eid := config.GetEID(c)
	userID := config.GetUserId(c)
	svc := service.NewSkillLibraryService()
	result, err := svc.ListMySkills(c.Request.Context(), eid, userID, offset, limit)
	if err != nil {
		toSkillErrorResponse(c, err)
		return
	}

	items := make([]*SkillMyListItemResponse, 0, len(result.Items))
	for _, item := range result.Items {
		if item == nil {
			continue
		}
		public := &SkillPublicResponse{
			ID:                item.SkillLibraryID,
			Eid:               item.Eid,
			SourceType:        item.SourceType,
			SkillName:         item.SkillName,
			Sort:              item.Sort,
			DisplayName:       item.DisplayName,
			Description:       item.Description,
			Version:           item.Version,
			UsageGuide:        item.UsageGuide,
			OriginZipName:     item.OriginZipName,
			OriginZipSize:     item.OriginZipSize,
			OriginZipSHA256:   item.OriginZipSHA256,
			PublishStatus:     item.PublishStatus,
			AdminStatus:       item.AdminStatus,
			RiskLevel:         item.RiskLevel,
			ScoreIntegrity:    item.ScoreIntegrity,
			ScorePracticality: item.ScorePracticality,
			ScoreSafety:       item.ScoreSafety,
			ScoreCodeQuality:  item.ScoreCodeQuality,
			ScoreDocQuality:   item.ScoreDocQuality,
			ScanMessage:       item.ScanMessage,
			CreatedTime:       item.CreatedTime,
			UpdatedTime:       item.UpdatedTime,
		}
		items = append(items, &SkillMyListItemResponse{
			BindingID:           item.BindingID,
			SkillPublicResponse: *public,
			BindingStatus:       item.BindingStatus,
		})
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(gin.H{
		"count": result.Count,
		"items": items,
	}))
}

// UpdateMySkillStatus godoc
// @Summary 更新我的技能启停状态
// @Description 启用或禁用当前用户已添加的技能。禁用后该技能不参与工作AI匹配。
// @Tags 技能库
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param binding_id path int true "绑定ID（HashID编码）"
// @Param request body controller.UpdateMySkillStatusRequest true "状态参数"
// @Success 200 {object} model.CommonResponse "成功"
// @Failure 400 {object} model.CommonResponse "参数错误：binding_id格式不正确或status值非法"
// @Failure 404 {object} model.CommonResponse "绑定关系不存在或越权操作"
// @Router /api/skill-library/my/{binding_id}/status [patch]
func UpdateMySkillStatus(c *gin.Context) {
	bindingID, err := strconv.ParseInt(c.Param("binding_id"), 10, 64)
	if err != nil || bindingID <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	var req UpdateMySkillStatusRequest
	if bindErr := c.ShouldBindJSON(&req); bindErr != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToErrorResponse(bindErr))
		return
	}

	eid := config.GetEID(c)
	userID := config.GetUserId(c)
	svc := service.NewSkillLibraryService()
	if updateErr := svc.UpdateMySkillStatus(c.Request.Context(), eid, userID, bindingID, req.Status); updateErr != nil {
		toSkillErrorResponse(c, updateErr)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}

// DeleteMySkill godoc
// @Summary 删除我的技能
// @Description 删除当前用户技能绑定关系，删除后技能不再出现在"我的技能"列表中
// @Tags 技能库
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param binding_id path int true "绑定ID（HashID编码）"
// @Success 200 {object} model.CommonResponse "成功"
// @Failure 400 {object} model.CommonResponse "参数错误：binding_id格式不正确"
// @Failure 404 {object} model.CommonResponse "绑定关系不存在或越权操作"
// @Router /api/skill-library/my/{binding_id} [delete]
func DeleteMySkill(c *gin.Context) {
	bindingID, err := strconv.ParseInt(c.Param("binding_id"), 10, 64)
	if err != nil || bindingID <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	eid := config.GetEID(c)
	userID := config.GetUserId(c)
	svc := service.NewSkillLibraryService()
	if delErr := svc.DeleteMySkill(c.Request.Context(), eid, userID, bindingID); delErr != nil {
		toSkillErrorResponse(c, delErr)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
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
