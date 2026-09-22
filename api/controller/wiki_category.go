package controller

import (
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/common/utils/helper"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type WikiCategoryController struct {
	svc          service.WikiCategoryService
	draftService *service.WikiCategoryDraftService
}

type wikiCategoryDraftRequest struct {
	GrowthMode string `json:"growth_mode" example:"smart"`
}

func NewWikiCategoryController(db *gorm.DB) *WikiCategoryController {
	return &WikiCategoryController{svc: service.NewWikiCategoryService(db)}
}

// GenerateDraft 根据空间名称和简介生成 Wiki 分类模板草稿，不写入数据库。
// @Summary 生成 Wiki 分类模板草稿
// @Description 根据空间名称和空间简介生成一份或多份 Wiki 分类草稿。默认 smart 智能生成模式；传 fixed 生成固定章节模板。接口只返回草稿，不写入数据库，前端确认后调用分类保存接口。
// @Tags Wiki Category
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param space_id path string true "空间ID（hashID 或原始 int64）"
// @Param request body wikiCategoryDraftRequest false "草稿生成参数；不传时使用 smart"
// @Success 200 {object} model.CommonResponse{data=service.WikiCategoryDraftResponse}
// @Failure 400 {object} model.CommonResponse
// @Failure 401 {object} model.CommonResponse
// @Failure 403 {object} model.CommonResponse
// @Failure 404 {object} model.CommonResponse
// @Failure 500 {object} model.CommonResponse
// @Router /api/spaces/{space_id}/wiki/category-drafts [post]
func (c *WikiCategoryController) GenerateDraft(ctx *gin.Context) {
	eid, spaceID, ok := parseWikiCategoryScope(ctx)
	if !ok || !requireWikiCategoryAdmin(ctx) {
		return
	}
	space, err := model.GetSpaceByID(eid, spaceID)
	if err != nil {
		ctx.JSON(http.StatusNotFound, model.NotFound.ToResponse(errors.New("空间不存在")))
		return
	}
	draftService := c.draftService
	if draftService == nil {
		draftService, err = service.NewWikiCategoryDraftServiceForEnterprise(model.DB, eid)
		if err != nil {
			ctx.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
			return
		}
	}
	request := wikiCategoryDraftRequest{GrowthMode: model.WikiCategoryGrowthModeSmart}
	if ctx.Request != nil {
		if err := ctx.ShouldBindJSON(&request); err != nil && !errors.Is(err, io.EOF) {
			ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
			return
		}
	}
	draft, err := draftService.Generate(ctx, service.WikiCategoryDraftInput{Name: space.Name, Description: space.Description, GrowthMode: request.GrowthMode})
	if err != nil {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	ctx.JSON(http.StatusOK, model.Success.ToResponse(draft))
}

// WikiCategoryListResponse 空间 Wiki 分类列表响应。
type WikiCategoryListResponse struct {
	Items []model.WikiCategory `json:"items"`
	Total int64                `json:"total"`
}

// ListVisible 获取前台可展示的 Wiki 分类摘要，并追加虚拟“其他”分类。
// @Summary 获取前台 Wiki 分类列表
// @Tags Wiki Category
// @Produce json
// @Security BearerAuth
// @Param space_id query string true "空间ID（hashID 或原始 int64）"
// @Param library_id query string false "知识库ID（hashID 或原始 int64），用于统计分类页面数"
// @Success 200 {object} model.CommonResponse{data=object{items=[]service.WikiCategorySummary,total=int64}}
// @Failure 400 {object} model.CommonResponse
// @Failure 401 {object} model.CommonResponse
// @Router /api/wiki/categories [get]
func (c *WikiCategoryController) ListVisible(ctx *gin.Context) {
	eid := config.GetEID(ctx)
	spaceID, err := hashids.TryParseID(strings.TrimSpace(ctx.Query("space_id")))
	if err != nil || spaceID <= 0 {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的空间ID")))
		return
	}
	libraryID := int64(0)
	if raw := strings.TrimSpace(ctx.Query("library_id")); raw != "" {
		libraryID, err = hashids.TryParseID(raw)
		if err != nil || libraryID <= 0 {
			ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的知识库ID")))
			return
		}
	}
	// 空间可见性门禁：分类元数据随空间权限收敛（页面计数已在 service 内按页权限过滤）。
	if !requireWikiSpacePermission(ctx, eid, config.GetUserId(ctx), spaceID, model.PERMISSION_PUBLIC_ONLY, "无权限查看该空间的 Wiki 分类") {
		return
	}
	items, err := c.svc.ListVisible(ctx, eid, spaceID, libraryID, config.GetUserId(ctx))
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}
	ctx.JSON(http.StatusOK, model.Success.ToResponseWithRequestID(gin.H{"items": items, "total": len(items)}, ctx.GetString(helper.RequestIdKey)))
}

type wikiCategoryBody struct {
	Name        string `json:"name" binding:"required"`
	Description string `json:"description"`
	// TargetEntityType 目标大类，枚举：Person / Organization / Product / Location / Time / Event / Document / Concept / Method。
	TargetEntityType string `json:"target_entity_type" binding:"required"`
	OKFType          string `json:"okf_type"`
	GrowthMode       string `json:"growth_mode"`
	StylePrompt      string `json:"style_prompt"`
	// StylePromptTitle 写作风格预设标题：专业严谨 / 通俗易懂 / 对话访谈 / 自定义（不传默认自定义）
	StylePromptTitle   string                               `json:"style_prompt_title"`
	GraphDepth         int                                  `json:"graph_depth"`
	Creativity         float64                              `json:"creativity"`
	AnchorLinksEnabled bool                                 `json:"anchor_links_enabled"`
	TemplateMarkdown   string                               `json:"template_markdown"`
	TemplateSections   *[]model.WikiCategoryTemplateSection `json:"template_sections"`
	StrictFill         bool                                 `json:"strict_fill"`
	Status             string                               `json:"status"`
	Sort               int64                                `json:"sort"`
}

type wikiCategoryUpdateBody struct {
	Name               string                               `json:"name" binding:"required"`
	Description        *string                              `json:"description"`
	TargetEntityType   string                               `json:"target_entity_type" binding:"required"`
	OKFType            *string                              `json:"okf_type"`
	GrowthMode         *string                              `json:"growth_mode"`
	StylePrompt        *string                              `json:"style_prompt"`
	StylePromptTitle   *string                              `json:"style_prompt_title"`
	GraphDepth         *int                                 `json:"graph_depth"`
	Creativity         *float64                             `json:"creativity"`
	AnchorLinksEnabled *bool                                `json:"anchor_links_enabled"`
	TemplateMarkdown   *string                              `json:"template_markdown"`
	TemplateSections   *[]model.WikiCategoryTemplateSection `json:"template_sections"`
	StrictFill         *bool                                `json:"strict_fill"`
	Status             *string                              `json:"status"`
	Sort               *int64                               `json:"sort"`
}

// ListStylePresets 获取智能生成模式的写作风格预设列表（全局静态）。
// @Summary 获取写作风格预设
// @Tags Wiki Category
// @Produce json
// @Security BearerAuth
// @Param space_id path string true "空间ID（hashID 或原始 int64）"
// @Success 200 {object} model.CommonResponse{data=[]service.StylePreset}
// @Router /api/spaces/{space_id}/wiki/categories/style-presets [get]
func (c *WikiCategoryController) ListStylePresets(ctx *gin.Context) {
	if !requireWikiCategoryAdmin(ctx) {
		return
	}
	ctx.JSON(http.StatusOK, model.Success.ToResponse(service.WikiCategoryStylePresets))
}

// ListWikiCategoryTargetTypes 获取 Wiki 分类目标大类枚举（枚举 + 中文名 + 别名 + 引导描述，全局静态）。
// @Summary 获取目标大类枚举
// @Tags Wiki Category
// @Produce json
// @Security BearerAuth
// @Param space_id path string true "空间ID（hashID 或原始 int64）"
// @Success 200 {object} model.CommonResponse{data=[]model.WikiCategoryTargetTypeMeta}
// @Router /api/spaces/{space_id}/wiki/categories/target-types [get]
func (c *WikiCategoryController) ListWikiCategoryTargetTypes(ctx *gin.Context) {
	if !requireWikiCategoryAdmin(ctx) {
		return
	}
	ctx.JSON(http.StatusOK, model.Success.ToResponse(model.GetWikiCategoryTargetTypes()))
}

// List 获取空间内 Wiki 分类列表，可按状态与名称关键词筛选。
// @Summary 获取 Wiki 分类列表
// @Tags Wiki Category
// @Produce json
// @Security BearerAuth
// @Param space_id path string true "空间ID（hashID 或原始 int64）"
// @Param status query string false "分类状态：enabled、disabled"
// @Param keyword query string false "分类名称关键词"
// @Param offset query int false "分页偏移量"
// @Param limit query int false "每页条数，默认 20，最大 100"
// @Success 200 {object} model.CommonResponse{data=controller.WikiCategoryListResponse}
// @Failure 400 {object} model.CommonResponse "请求参数错误"
// @Failure 403 {object} model.CommonResponse "无权限查看空间 Wiki"
// @Router /api/spaces/{space_id}/wiki/categories [get]
func (c *WikiCategoryController) List(ctx *gin.Context) {
	eid, spaceID, ok := parseWikiCategoryScope(ctx)
	if !ok {
		return
	}
	if !requireWikiCategoryAdmin(ctx) {
		return
	}
	offset, _ := strconv.Atoi(ctx.DefaultQuery("offset", "0"))
	limit, _ := strconv.Atoi(ctx.DefaultQuery("limit", "20"))
	items, total, err := c.svc.List(ctx, eid, spaceID, ctx.Query("status"), ctx.Query("keyword"), offset, limit)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}
	ctx.JSON(http.StatusOK, model.Success.ToResponse(WikiCategoryListResponse{Items: items, Total: total}))
}

// Get 获取空间内单个 Wiki 分类详情。
// @Summary 获取 Wiki 分类详情
// @Tags Wiki Category
// @Produce json
// @Security BearerAuth
// @Param space_id path string true "空间ID（hashID 或原始 int64）"
// @Param category_id path string true "分类ID（hashID 或原始 int64）"
// @Success 200 {object} model.CommonResponse{data=model.WikiCategory}
// @Failure 400 {object} model.CommonResponse "请求参数错误"
// @Failure 403 {object} model.CommonResponse "无权限查看空间 Wiki"
// @Failure 404 {object} model.CommonResponse "分类不存在"
// @Router /api/spaces/{space_id}/wiki/categories/{category_id} [get]
func (c *WikiCategoryController) Get(ctx *gin.Context) {
	eid, spaceID, ok := parseWikiCategoryScope(ctx)
	if !ok {
		return
	}
	if !requireWikiCategoryAdmin(ctx) {
		return
	}
	id, ok := parseWikiCategoryID(ctx.Param("category_id"))
	if !ok {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的分类ID")))
		return
	}
	item, err := c.svc.Get(ctx, eid, spaceID, id)
	if errors.Is(err, service.ErrWikiCategoryNotFound) {
		ctx.JSON(http.StatusNotFound, model.NotFound.ToResponse(errors.New("wiki 分类不存在")))
		return
	}
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}
	ctx.JSON(http.StatusOK, model.Success.ToResponse(item))
}

// Create 创建空间内 Wiki 分类（smart/fixed 生长模式）。
// @Summary 创建 Wiki 分类
// @Tags Wiki Category
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param space_id path string true "空间ID（hashID 或原始 int64）"
// @Param body body wikiCategoryBody true "分类配置（target_entity_type 大类：Person / Organization / Product / Location / Time / Event / Document / Concept / Method）"
// @Success 200 {object} model.CommonResponse{data=model.WikiCategory}
// @Failure 400 {object} model.CommonResponse "参数或模板校验失败"
// @Failure 403 {object} model.CommonResponse "无权限管理 Wiki 分类"
// @Router /api/spaces/{space_id}/wiki/categories [post]
func (c *WikiCategoryController) Create(ctx *gin.Context) {
	eid, spaceID, ok := parseWikiCategoryScope(ctx)
	if !ok {
		return
	}
	if !requireWikiCategoryAdmin(ctx) {
		return
	}
	var body wikiCategoryBody
	if err := ctx.ShouldBindJSON(&body); err != nil {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	item, err := c.svc.Create(ctx, body.toModel(eid, spaceID))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	ctx.JSON(http.StatusOK, model.Success.ToResponse(item))
}

// Update 更新空间内 Wiki 分类（含启用/停用，通过 status 切换）。
// @Summary 更新 Wiki 分类
// @Tags Wiki Category
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param space_id path string true "空间ID（hashID 或原始 int64）"
// @Param category_id path string true "分类ID（hashID 或原始 int64）"
// @Param body body wikiCategoryBody true "分类配置（target_entity_type 大类：Person / Organization / Product / Location / Time / Event / Document / Concept / Method）"
// @Success 200 {object} model.CommonResponse{data=model.WikiCategory}
// @Failure 400 {object} model.CommonResponse "参数或模板校验失败"
// @Failure 403 {object} model.CommonResponse "无权限管理 Wiki 分类"
// @Failure 404 {object} model.CommonResponse "分类不存在"
// @Router /api/spaces/{space_id}/wiki/categories/{category_id} [put]
func (c *WikiCategoryController) Update(ctx *gin.Context) {
	eid, spaceID, ok := parseWikiCategoryScope(ctx)
	if !ok {
		return
	}
	if !requireWikiCategoryAdmin(ctx) {
		return
	}
	id, ok := parseWikiCategoryID(ctx.Param("category_id"))
	if !ok {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的分类ID")))
		return
	}
	var body wikiCategoryUpdateBody
	if err := ctx.ShouldBindJSON(&body); err != nil {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	current, err := c.svc.Get(ctx, eid, spaceID, id)
	if errors.Is(err, service.ErrWikiCategoryNotFound) {
		ctx.JSON(http.StatusNotFound, model.NotFound.ToResponse(errors.New("wiki 分类不存在")))
		return
	}
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}
	item := mergeWikiCategoryUpdate(*current, body)
	item.Eid = eid
	item.SpaceID = spaceID
	item.ID = id
	updated, err := c.svc.Update(ctx, &item)
	if errors.Is(err, service.ErrWikiCategoryNotFound) {
		ctx.JSON(http.StatusNotFound, model.NotFound.ToResponse(errors.New("wiki 分类不存在")))
		return
	}
	if err != nil {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	ctx.JSON(http.StatusOK, model.Success.ToResponse(updated))
}

// Delete 删除空间内 Wiki 分类（不影响已生成的历史 Wiki 页面）。
// @Summary 删除 Wiki 分类
// @Tags Wiki Category
// @Produce json
// @Security BearerAuth
// @Param space_id path string true "空间ID（hashID 或原始 int64）"
// @Param category_id path string true "分类ID（hashID 或原始 int64）"
// @Success 200 {object} model.CommonResponse
// @Failure 400 {object} model.CommonResponse "请求参数错误"
// @Failure 403 {object} model.CommonResponse "无权限管理 Wiki 分类"
// @Failure 404 {object} model.CommonResponse "分类不存在"
// @Router /api/spaces/{space_id}/wiki/categories/{category_id} [delete]
func (c *WikiCategoryController) Delete(ctx *gin.Context) {
	eid, spaceID, ok := parseWikiCategoryScope(ctx)
	if !ok {
		return
	}
	if !requireWikiCategoryAdmin(ctx) {
		return
	}
	id, ok := parseWikiCategoryID(ctx.Param("category_id"))
	if !ok {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的分类ID")))
		return
	}
	err := c.svc.Delete(ctx, eid, spaceID, id)
	if errors.Is(err, service.ErrWikiCategoryNotFound) {
		ctx.JSON(http.StatusNotFound, model.NotFound.ToResponse(errors.New("wiki 分类不存在")))
		return
	}
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}
	ctx.JSON(http.StatusOK, model.Success.ToResponse(gin.H{"deleted": true}))
}

func (b wikiCategoryBody) toModel(eid, spaceID int64) *model.WikiCategory {
	category := &model.WikiCategory{Eid: eid, SpaceID: spaceID, Name: b.Name, Description: b.Description, TargetEntityType: b.TargetEntityType, OKFType: b.OKFType, GrowthMode: b.GrowthMode, StylePrompt: b.StylePrompt, StylePromptTitle: b.StylePromptTitle, GraphDepth: b.GraphDepth, Creativity: b.Creativity, AnchorLinksEnabled: b.AnchorLinksEnabled, TemplateMarkdown: b.TemplateMarkdown, StrictFill: b.StrictFill, Status: b.Status, Sort: b.Sort}
	if b.TemplateSections != nil {
		category.TemplateSections = *b.TemplateSections
		category.TemplateMarkdown = ""
	}
	return category
}

func mergeWikiCategoryUpdate(current model.WikiCategory, body wikiCategoryUpdateBody) model.WikiCategory {
	updated := current
	updated.Name = body.Name
	updated.TargetEntityType = body.TargetEntityType
	if body.Description != nil {
		updated.Description = *body.Description
	}
	if body.OKFType != nil {
		updated.OKFType = *body.OKFType
	}
	if body.GrowthMode != nil {
		updated.GrowthMode = *body.GrowthMode
	}
	if body.StylePrompt != nil {
		updated.StylePrompt = *body.StylePrompt
	}
	if body.StylePromptTitle != nil {
		updated.StylePromptTitle = *body.StylePromptTitle
	}
	if body.GraphDepth != nil {
		updated.GraphDepth = *body.GraphDepth
	}
	if body.Creativity != nil {
		updated.Creativity = *body.Creativity
	}
	if body.AnchorLinksEnabled != nil {
		updated.AnchorLinksEnabled = *body.AnchorLinksEnabled
	}
	if body.TemplateMarkdown != nil {
		updated.TemplateMarkdown = *body.TemplateMarkdown
	}
	if body.TemplateSections != nil {
		updated.TemplateSections = *body.TemplateSections
	}
	if body.StrictFill != nil {
		updated.StrictFill = *body.StrictFill
	}
	if body.Status != nil {
		updated.Status = *body.Status
	}
	if body.Sort != nil {
		updated.Sort = *body.Sort
	}
	return updated
}

func parseWikiCategoryScope(ctx *gin.Context) (int64, int64, bool) {
	eid := config.GetEID(ctx)
	spaceID, err := hashids.TryParseID(ctx.Param("space_id"))
	if err != nil || spaceID <= 0 {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的空间ID")))
		return 0, 0, false
	}
	return eid, spaceID, true
}

func parseWikiCategoryID(raw string) (int64, bool) {
	id, err := hashids.TryParseID(raw)
	return id, err == nil && id > 0
}

func requireWikiCategoryAdmin(ctx *gin.Context) bool {
	if common.IsAdmin(ctx) {
		return true
	}
	ctx.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(errors.New("仅后台管理员可管理 Wiki 分类")))
	return false
}
