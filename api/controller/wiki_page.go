package controller

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/rag-pipeline-v2/steps"
	"github.com/53AI/53AIHub/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type WikiPageController struct {
	readSvc     service.WikiPageReadService
	editSvc     service.WikiPageEditService
	progressSvc service.WikiProgressService
	db          *gorm.DB
}

func NewWikiPageController(db *gorm.DB) *WikiPageController {
	return &WikiPageController{
		readSvc:     service.NewWikiPageReadService(db),
		editSvc:     service.NewWikiPageEditService(db),
		progressSvc: service.NewWikiProgressService(db),
		db:          db,
	}
}

type WikiListPagesQuery struct {
	Keyword  string `form:"keyword"`
	PageType string `form:"page_type"`
	Status   string `form:"status"`
	SortBy   string `form:"sort_by"`
	SpaceID  int64  `form:"space_id"`
	Offset   int    `form:"offset"`
	Limit    int    `form:"limit"`
}

type WikiCreatePageBody struct {
	PageType     string                        `json:"page_type" binding:"required"`
	Slug         string                        `json:"slug"`
	Title        string                        `json:"title" binding:"required"`
	Summary      string                        `json:"summary"`
	Content      string                        `json:"content" binding:"required"`
	Aliases      []string                      `json:"aliases"`
	Visibility   string                        `json:"visibility"`
	FolderID     int64                         `json:"folder_id"`
	ChangeReason string                        `json:"change_reason"`
	Sources      []service.WikiPageSourceInput `json:"sources"`
}

type WikiCreatePageStandaloneBody struct {
	LibraryID    string                        `json:"library_id" binding:"required"`
	PageType     string                        `json:"page_type" binding:"required"`
	Slug         string                        `json:"slug"`
	Title        string                        `json:"title" binding:"required"`
	Summary      string                        `json:"summary"`
	Content      string                        `json:"content" binding:"required"`
	Aliases      []string                      `json:"aliases"`
	Visibility   string                        `json:"visibility"`
	FolderID     int64                         `json:"folder_id"`
	ChangeReason string                        `json:"change_reason"`
	Sources      []service.WikiPageSourceInput `json:"sources"`
}

type WikiUpdatePageBody struct {
	PageType     string                        `json:"page_type" binding:"required"`
	Title        string                        `json:"title" binding:"required"`
	Summary      string                        `json:"summary"`
	Content      string                        `json:"content" binding:"required"`
	Aliases      []string                      `json:"aliases"`
	Visibility   string                        `json:"visibility"`
	FolderID     int64                         `json:"folder_id"`
	ChangeReason string                        `json:"change_reason"`
	Sources      []service.WikiPageSourceInput `json:"sources"`
}

type WikiRenamePageBody struct {
	Slug         string `json:"slug" binding:"required"`
	NewSlug      string `json:"new_slug"`
	NewTitle     string `json:"new_title"`
	ChangeReason string `json:"change_reason"`
}

type WikiMovePageBody struct {
	Slug         string `json:"slug" binding:"required"`
	FolderID     int64  `json:"folder_id" binding:"required"`
	ChangeReason string `json:"change_reason"`
}

type WikiArchivePageBody struct {
	Slug         string `json:"slug" binding:"required"`
	ChangeReason string `json:"change_reason"`
}

type WikiRebuildBody struct {
	FileID   *int64 `json:"file_id"`
	Language string `json:"language"`
}

type WikiProgressQuery struct {
	Status string `form:"status"`
	Offset int    `form:"offset"`
	Limit  int    `form:"limit"`
}

// @Security BearerAuth
// @Param library_id path int true "知识库ID"
// @Param keyword query string false "关键词"
// @Param page_type query string false "页面类型"
// @Param status query string false "页面状态"
// @Param offset query int false "分页偏移量"
// @Param limit query int false "每页条数"
// @Success 200 {object} model.CommonResponse{data=object{items=[]service.WikiPageSummary,total=int64}}
// @Failure 400 {object} model.CommonResponse
// @Failure 401 {object} model.CommonResponse
// @Failure 500 {object} model.CommonResponse
// @Router /api/libraries/{library_id}/wiki/pages [get]
func (c *WikiPageController) ListPages(ctx *gin.Context) {
	eid := config.GetEID(ctx)
	libraryID, ok := parseWikiLibraryID(ctx)
	if !ok {
		return
	}
	if _, ok := requireLibraryPermission(ctx, eid, config.GetUserId(ctx), libraryID, model.PERMISSION_VIEW_ONLY, "无权限查看此知识库的 Wiki"); !ok {
		return
	}

	var req WikiListPagesQuery
	if err := ctx.ShouldBindQuery(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	items, total, err := c.readSvc.ListPages(ctx.Request.Context(), service.WikiListPagesRequest{
		Eid:       eid,
		LibraryID: libraryID,
		Keyword:   req.Keyword,
		PageType:  req.PageType,
		Status:    req.Status,
		SortBy:    req.SortBy,
		Offset:    req.Offset,
		Limit:     req.Limit,
	})
	if err != nil {
		logger.Errorf(ctx.Request.Context(), "wiki list pages failed: %v", err)
		ctx.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	ctx.JSON(http.StatusOK, model.Success.ToResponse(gin.H{
		"items": items,
		"total": total,
	}))
}

// @Security BearerAuth
// @Param library_id query string false "知识库ID（hashID 或原始 int64），为空时查全空间可见页面"
// @Param keyword query string false "关键词"
// @Param page_type query string false "页面类型"
// @Param status query string false "页面状态"
// @Param space_id query int false "空间ID"
// @Param offset query int false "分页偏移量"
// @Param limit query int false "每页条数"
// @Success 200 {object} model.CommonResponse{data=object{items=[]service.WikiPageSummary,total=int64}}
// @Failure 400 {object} model.CommonResponse
// @Failure 401 {object} model.CommonResponse
// @Failure 500 {object} model.CommonResponse
// @Router /api/wiki/pages [get]
func (c *WikiPageController) ListPagesStandalone(ctx *gin.Context) {
	eid := config.GetEID(ctx)

	var req WikiListPagesQuery
	if err := ctx.ShouldBindQuery(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	libraryID := int64(0)
	if raw := strings.TrimSpace(ctx.Query("library_id")); raw != "" {
		parsed, err := hashids.TryParseID(raw)
		if err != nil || parsed <= 0 {
			ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的知识库ID")))
			return
		}
	}

	items, total, err := c.readSvc.ListPages(ctx.Request.Context(), service.WikiListPagesRequest{
		Eid:       eid,
		LibraryID: libraryID,
		SpaceID:   req.SpaceID,
		Keyword:   req.Keyword,
		PageType:  req.PageType,
		Status:    req.Status,
		SortBy:    req.SortBy,
		Offset:    req.Offset,
		Limit:     req.Limit,
	})
	if err != nil {
		logger.Errorf(ctx.Request.Context(), "wiki list pages failed: %v", err)
		ctx.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	ctx.JSON(http.StatusOK, model.Success.ToResponse(gin.H{
		"items": items,
		"total": total,
	}))
}

// @Security BearerAuth
// @Param library_id path int true "知识库ID"
// @Param slug path string true "页面slug"
// @Success 200 {object} model.CommonResponse{data=service.WikiPageDetail}
// @Failure 404 {object} model.CommonResponse
// @Failure 500 {object} model.CommonResponse
// @Router /api/libraries/{library_id}/wiki/pages/{slug} [get]
func (c *WikiPageController) GetPage(ctx *gin.Context) {
	eid := config.GetEID(ctx)
	libraryID, ok := parseWikiLibraryID(ctx)
	if !ok {
		return
	}

	slug := trimWikiSlugParam(ctx.Param("slug"))
	if _, ok := requireWikiPageSlugPermission(ctx, eid, config.GetUserId(ctx), libraryID, slug, model.PERMISSION_VIEW_ONLY, "无权限查看此 Wiki 页面"); !ok {
		return
	}

	page, err := c.readSvc.GetPage(ctx.Request.Context(), eid, libraryID, slug)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			ctx.JSON(http.StatusNotFound, model.NotFound.ToResponse(errors.New("wiki 页面不存在")))
			return
		}
		logger.Errorf(ctx.Request.Context(), "wiki get page failed: %v", err)
		ctx.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	ctx.JSON(http.StatusOK, model.Success.ToResponse(page))
}

func (c *WikiPageController) GetIndex(ctx *gin.Context) {
	eid := config.GetEID(ctx)
	libraryID, ok := parseWikiLibraryID(ctx)
	if !ok {
		return
	}
	if _, ok := requireLibraryPermission(ctx, eid, config.GetUserId(ctx), libraryID, model.PERMISSION_VIEW_ONLY, "无权限查看此知识库的 Wiki"); !ok {
		return
	}

	view, err := c.readSvc.GetIndex(ctx.Request.Context(), eid, libraryID)
	if err != nil {
		logger.Errorf(ctx.Request.Context(), "wiki get index failed: %v", err)
		ctx.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	ctx.JSON(http.StatusOK, model.Success.ToResponse(view))
}

func (c *WikiPageController) GetGraph(ctx *gin.Context) {
	eid := config.GetEID(ctx)
	libraryID, ok := parseWikiLibraryID(ctx)
	if !ok {
		return
	}
	if _, ok := requireLibraryPermission(ctx, eid, config.GetUserId(ctx), libraryID, model.PERMISSION_VIEW_ONLY, "无权限查看此知识库的 Wiki"); !ok {
		return
	}

	view, err := c.readSvc.GetGraph(ctx.Request.Context(), service.WikiGraphRequest{
		Eid:       eid,
		LibraryID: libraryID,
		Mode:      parseWikiGraphMode(ctx.Query("mode")),
		Center:    trimWikiSlugParam(ctx.Query("center")),
		Depth:     parseIntQuery(ctx, "depth", 1),
		Types:     parseWikiGraphTypes(ctx.Query("types")),
		Limit:     parseIntQuery(ctx, "limit", 500),
	})
	if err != nil {
		logger.Errorf(ctx.Request.Context(), "wiki get graph failed: %v", err)
		ctx.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	ctx.JSON(http.StatusOK, model.Success.ToResponse(view))
}

func (c *WikiPageController) ListLogs(ctx *gin.Context) {
	eid := config.GetEID(ctx)
	libraryID, ok := parseWikiLibraryID(ctx)
	if !ok {
		return
	}
	if _, ok := requireLibraryPermission(ctx, eid, config.GetUserId(ctx), libraryID, model.PERMISSION_VIEW_ONLY, "无权限查看此知识库的 Wiki"); !ok {
		return
	}

	pageID := int64(0)
	if raw := strings.TrimSpace(ctx.Query("page_id")); raw != "" {
		parsed, err := strconv.ParseInt(raw, 10, 64)
		if err == nil && parsed > 0 {
			pageID = parsed
		}
	}

	items, total, err := c.readSvc.ListLogs(ctx.Request.Context(), service.WikiListLogsRequest{
		Eid:       eid,
		LibraryID: libraryID,
		PageID:    pageID,
		Offset:    parseIntQuery(ctx, "offset", 0),
		Limit:     parseIntQuery(ctx, "limit", 20),
	})
	if err != nil {
		logger.Errorf(ctx.Request.Context(), "wiki list logs failed: %v", err)
		ctx.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	ctx.JSON(http.StatusOK, model.Success.ToResponse(gin.H{
		"items": items,
		"total": total,
	}))
}

func (c *WikiPageController) GetHealth(ctx *gin.Context) {
	eid := config.GetEID(ctx)
	libraryID, ok := parseWikiLibraryID(ctx)
	if !ok {
		return
	}
	if _, ok := requireLibraryPermission(ctx, eid, config.GetUserId(ctx), libraryID, model.PERMISSION_VIEW_ONLY, "无权限查看此知识库的 Wiki"); !ok {
		return
	}

	report, err := c.readSvc.GetHealth(ctx.Request.Context(), eid, libraryID)
	if err != nil {
		logger.Errorf(ctx.Request.Context(), "wiki get health failed: %v", err)
		ctx.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	ctx.JSON(http.StatusOK, model.Success.ToResponse(report))
}

func (c *WikiPageController) ListProgress(ctx *gin.Context) {
	eid := config.GetEID(ctx)
	libraryID, ok := parseWikiLibraryID(ctx)
	if !ok {
		return
	}
	if _, ok := requireLibraryPermission(ctx, eid, config.GetUserId(ctx), libraryID, model.PERMISSION_VIEW_ONLY, "无权限查看此知识库的 Wiki"); !ok {
		return
	}

	var req WikiProgressQuery
	if err := ctx.ShouldBindQuery(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	items, total, err := c.progressSvc.ListFiles(ctx.Request.Context(), service.WikiProgressListRequest{
		Eid:       eid,
		LibraryID: libraryID,
		Status:    req.Status,
		Offset:    req.Offset,
		Limit:     req.Limit,
	})
	if err != nil {
		logger.Errorf(ctx.Request.Context(), "wiki list progress failed: %v", err)
		ctx.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	ctx.JSON(http.StatusOK, model.Success.ToResponse(gin.H{
		"items": items,
		"total": total,
	}))
}

func (c *WikiPageController) GetProgress(ctx *gin.Context) {
	eid := config.GetEID(ctx)
	libraryID, ok := parseWikiLibraryID(ctx)
	if !ok {
		return
	}
	if _, ok := requireLibraryPermission(ctx, eid, config.GetUserId(ctx), libraryID, model.PERMISSION_VIEW_ONLY, "无权限查看此知识库的 Wiki"); !ok {
		return
	}

	fileID, err := strconv.ParseInt(strings.TrimSpace(ctx.Param("file_id")), 10, 64)
	if err != nil || fileID <= 0 {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("file_id 参数无效")))
		return
	}

	detail, err := c.progressSvc.GetFile(ctx.Request.Context(), eid, libraryID, fileID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			ctx.JSON(http.StatusNotFound, model.NotFound.ToResponse(errors.New("wiki 文件进度不存在")))
			return
		}
		logger.Errorf(ctx.Request.Context(), "wiki get progress failed: %v", err)
		ctx.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	ctx.JSON(http.StatusOK, model.Success.ToResponse(detail))
}

func (c *WikiPageController) Rebuild(ctx *gin.Context) {
	eid := config.GetEID(ctx)
	libraryID, ok := parseWikiLibraryID(ctx)
	if !ok {
		return
	}
	if _, ok := requireLibraryPermission(ctx, eid, config.GetUserId(ctx), libraryID, model.PERMISSION_EDIT_KNOWLEDGE, "无权限重建此知识库的 Wiki"); !ok {
		return
	}

	var req WikiRebuildBody
	if err := ctx.ShouldBindJSON(&req); err != nil && !errors.Is(err, io.EOF) {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	ctxReq := ctx.Request.Context()
	language := strings.TrimSpace(req.Language)
	if req.FileID != nil && *req.FileID > 0 {
		if err := service.NewWikiPageGenerationProcessor(c.db).ProcessFile(ctxReq, steps.WikiPageGenerationInput{
			Eid:       eid,
			LibraryID: libraryID,
			FileID:    *req.FileID,
			Language:  language,
		}); err != nil {
			logger.Errorf(ctxReq, "wiki rebuild single file failed: %v", err)
			ctx.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
			return
		}
		ctx.JSON(http.StatusOK, model.Success.ToResponse(gin.H{"processed_files": 1}))
		return
	}

	files, err := model.GetFilesByLibraryID(eid, libraryID)
	if err != nil {
		logger.Errorf(ctxReq, "wiki rebuild list files failed: %v", err)
		ctx.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	processor := service.NewWikiPageGenerationProcessor(c.db)
	processed := 0
	for _, file := range files {
		if file.IsDeleted {
			continue
		}
		if err := processor.ProcessFile(ctxReq, steps.WikiPageGenerationInput{
			Eid:       eid,
			LibraryID: libraryID,
			FileID:    file.ID,
			Language:  language,
		}); err != nil {
			logger.Warnf(ctxReq, "wiki rebuild skipped file_id=%d err=%v", file.ID, err)
			continue
		}
		processed++
	}

	ctx.JSON(http.StatusOK, model.Success.ToResponse(gin.H{
		"processed_files": processed,
	}))
}

// @Security BearerAuth
// @Param library_id path int true "知识库ID"
// @Param request body controller.WikiCreatePageBody true "创建Wiki页面"
// @Success 200 {object} model.CommonResponse{data=service.WikiPageWriteResult}
// @Failure 400 {object} model.CommonResponse
// @Router /api/libraries/{library_id}/wiki/pages [post]
func (c *WikiPageController) CreatePage(ctx *gin.Context) {
	eid := config.GetEID(ctx)
	userID := config.GetUserId(ctx)
	libraryID, ok := parseWikiLibraryID(ctx)
	if !ok {
		return
	}
	if _, ok := requireLibraryPermission(ctx, eid, userID, libraryID, model.PERMISSION_EDIT_KNOWLEDGE, "无权限在此知识库创建 Wiki 页面"); !ok {
		return
	}

	var req WikiCreatePageBody
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	result, err := c.editSvc.CreatePage(ctx.Request.Context(), service.WikiCreatePageRequest{
		Eid:          eid,
		LibraryID:    libraryID,
		PageType:     req.PageType,
		Slug:         req.Slug,
		Title:        req.Title,
		Summary:      req.Summary,
		Content:      req.Content,
		Aliases:      req.Aliases,
		Visibility:   req.Visibility,
		FolderID:     req.FolderID,
		CreatorID:    userID,
		ChangeReason: req.ChangeReason,
		Sources:      req.Sources,
	})
	if err != nil {
		writeWikiEditError(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, model.Success.ToResponse(result))
}

// @Security BearerAuth
// @Param request body controller.WikiCreatePageStandaloneBody true "创建Wiki页面"
// @Success 200 {object} model.CommonResponse{data=service.WikiPageWriteResult}
// @Failure 400 {object} model.CommonResponse
// @Router /api/wiki/pages [post]
func (c *WikiPageController) CreatePageStandalone(ctx *gin.Context) {
	eid := config.GetEID(ctx)
	userID := config.GetUserId(ctx)

	var req WikiCreatePageStandaloneBody
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	libraryID, err := hashids.TryParseID(strings.TrimSpace(req.LibraryID))
	if err != nil || libraryID <= 0 {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的知识库ID")))
		return
	}

	if _, ok := requireLibraryPermission(ctx, eid, userID, libraryID, model.PERMISSION_EDIT_KNOWLEDGE, "无权限在此知识库创建 Wiki 页面"); !ok {
		return
	}

	result, err := c.editSvc.CreatePage(ctx.Request.Context(), service.WikiCreatePageRequest{
		Eid:          eid,
		LibraryID:    libraryID,
		PageType:     req.PageType,
		Slug:         req.Slug,
		Title:        req.Title,
		Summary:      req.Summary,
		Content:      req.Content,
		Aliases:      req.Aliases,
		Visibility:   req.Visibility,
		FolderID:     req.FolderID,
		CreatorID:    userID,
		ChangeReason: req.ChangeReason,
		Sources:      req.Sources,
	})
	if err != nil {
		writeWikiEditError(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, model.Success.ToResponse(result))
}

// @Security BearerAuth
// @Param library_id path int true "知识库ID"
// @Param slug path string true "页面slug"
// @Param request body controller.WikiUpdatePageBody true "更新Wiki页面"
// @Success 200 {object} model.CommonResponse{data=service.WikiPageWriteResult}
// @Failure 400 {object} model.CommonResponse
// @Router /api/libraries/{library_id}/wiki/pages/{slug} [put]
func (c *WikiPageController) UpdatePage(ctx *gin.Context) {
	eid := config.GetEID(ctx)
	userID := config.GetUserId(ctx)
	libraryID, ok := parseWikiLibraryID(ctx)
	if !ok {
		return
	}

	slug := trimWikiSlugParam(ctx.Param("slug"))
	if _, ok := requireWikiPageSlugPermission(ctx, eid, userID, libraryID, slug, model.PERMISSION_EDIT_KNOWLEDGE, "无权限修改此 Wiki 页面"); !ok {
		return
	}

	var req WikiUpdatePageBody
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	result, err := c.editSvc.UpdatePage(ctx.Request.Context(), service.WikiUpdatePageRequest{
		Eid:          eid,
		LibraryID:    libraryID,
		Slug:         trimWikiSlugParam(ctx.Param("slug")),
		PageType:     req.PageType,
		Title:        req.Title,
		Summary:      req.Summary,
		Content:      req.Content,
		Aliases:      req.Aliases,
		Visibility:   req.Visibility,
		FolderID:     req.FolderID,
		UpdaterID:    userID,
		ChangeReason: req.ChangeReason,
		Sources:      req.Sources,
	})
	if err != nil {
		writeWikiEditError(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, model.Success.ToResponse(result))
}

// @Security BearerAuth
// @Param library_id path int true "知识库ID"
// @Param request body controller.WikiRenamePageBody true "重命名Wiki页面"
// @Success 200 {object} model.CommonResponse{data=service.WikiPageWriteResult}
// @Failure 400 {object} model.CommonResponse
// @Router /api/libraries/{library_id}/wiki/pages/rename [post]
func (c *WikiPageController) RenamePage(ctx *gin.Context) {
	eid := config.GetEID(ctx)
	userID := config.GetUserId(ctx)
	libraryID, ok := parseWikiLibraryID(ctx)
	if !ok {
		return
	}

	var req WikiRenamePageBody
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	slug := firstNonEmptyWikiValue(trimWikiSlugParam(ctx.Param("slug")), req.Slug)
	if _, ok := requireWikiPageSlugPermission(ctx, eid, userID, libraryID, slug, model.PERMISSION_EDIT_KNOWLEDGE, "无权限重命名此 Wiki 页面"); !ok {
		return
	}

	result, err := c.editSvc.RenamePage(ctx.Request.Context(), service.WikiRenamePageRequest{
		Eid:          eid,
		LibraryID:    libraryID,
		Slug:         slug,
		NewSlug:      req.NewSlug,
		NewTitle:     req.NewTitle,
		ChangeReason: req.ChangeReason,
		UpdaterID:    userID,
	})
	if err != nil {
		writeWikiEditError(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, model.Success.ToResponse(result))
}

// @Security BearerAuth
// @Param library_id path int true "知识库ID"
// @Param request body controller.WikiMovePageBody true "移动Wiki页面"
// @Success 200 {object} model.CommonResponse{data=service.WikiPageWriteResult}
// @Failure 400 {object} model.CommonResponse
// @Router /api/libraries/{library_id}/wiki/pages/move [post]
func (c *WikiPageController) MovePage(ctx *gin.Context) {
	eid := config.GetEID(ctx)
	userID := config.GetUserId(ctx)
	libraryID, ok := parseWikiLibraryID(ctx)
	if !ok {
		return
	}

	var req WikiMovePageBody
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	slug := firstNonEmptyWikiValue(trimWikiSlugParam(ctx.Param("slug")), req.Slug)
	if _, ok := requireWikiPageSlugPermission(ctx, eid, userID, libraryID, slug, model.PERMISSION_EDIT_KNOWLEDGE, "无权限移动此 Wiki 页面"); !ok {
		return
	}

	result, err := c.editSvc.MovePage(ctx.Request.Context(), service.WikiMovePageRequest{
		Eid:          eid,
		LibraryID:    libraryID,
		Slug:         slug,
		FolderID:     req.FolderID,
		ChangeReason: req.ChangeReason,
		UpdaterID:    userID,
	})
	if err != nil {
		writeWikiEditError(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, model.Success.ToResponse(result))
}

// @Security BearerAuth
// @Param library_id path int true "知识库ID"
// @Param request body controller.WikiArchivePageBody true "归档Wiki页面"
// @Success 200 {object} model.CommonResponse{data=service.WikiPageWriteResult}
// @Failure 400 {object} model.CommonResponse
// @Router /api/libraries/{library_id}/wiki/pages/archive [post]
func (c *WikiPageController) ArchivePage(ctx *gin.Context) {
	eid := config.GetEID(ctx)
	userID := config.GetUserId(ctx)
	libraryID, ok := parseWikiLibraryID(ctx)
	if !ok {
		return
	}

	var req WikiArchivePageBody
	if err := ctx.ShouldBindJSON(&req); err != nil && !errors.Is(err, io.EOF) {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	slug := firstNonEmptyWikiValue(trimWikiSlugParam(ctx.Param("slug")), req.Slug)
	if _, ok := requireWikiPageSlugPermission(ctx, eid, userID, libraryID, slug, model.PERMISSION_EDIT_KNOWLEDGE, "无权限归档此 Wiki 页面"); !ok {
		return
	}

	result, err := c.editSvc.ArchivePage(ctx.Request.Context(), service.WikiArchivePageRequest{
		Eid:          eid,
		LibraryID:    libraryID,
		Slug:         slug,
		ChangeReason: req.ChangeReason,
		UpdaterID:    userID,
	})
	if err != nil {
		writeWikiEditError(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, model.Success.ToResponse(result))
}

// @Security BearerAuth
// @Param library_id path int true "知识库ID"
// @Param slug path string true "页面slug"
// @Success 200 {object} model.CommonResponse{data=service.WikiPageWriteResult}
// @Failure 400 {object} model.CommonResponse
// @Router /api/libraries/{library_id}/wiki/pages/{slug} [delete]
func (c *WikiPageController) DeletePage(ctx *gin.Context) {
	eid := config.GetEID(ctx)
	userID := config.GetUserId(ctx)
	libraryID, ok := parseWikiLibraryID(ctx)
	if !ok {
		return
	}

	slug := trimWikiSlugParam(ctx.Param("slug"))
	if _, ok := requireWikiPageSlugPermission(ctx, eid, userID, libraryID, slug, model.PERMISSION_EDIT_KNOWLEDGE, "无权限删除此 Wiki 页面"); !ok {
		return
	}

	result, err := c.editSvc.DeletePage(ctx.Request.Context(), service.WikiDeletePageRequest{
		Eid:       eid,
		LibraryID: libraryID,
		Slug:      slug,
		UpdaterID: userID,
	})
	if err != nil {
		writeWikiEditError(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, model.Success.ToResponse(result))
}

// @Security BearerAuth
// @Param page_id path int true "Wiki页面ID"
// @Success 200 {object} model.CommonResponse{data=service.WikiPageDetail}
// @Failure 404 {object} model.CommonResponse
// @Failure 500 {object} model.CommonResponse
// @Router /api/wiki/pages/{page_id} [get]
func (c *WikiPageController) GetPageByID(ctx *gin.Context) {
	eid := config.GetEID(ctx)
	userID := config.GetUserId(ctx)
	page, ok := resolveWikiPageByID(ctx, eid, userID, model.PERMISSION_VIEW_ONLY, "无权限查看此 Wiki 页面")
	if !ok {
		return
	}
	detail, err := c.readSvc.GetPage(ctx.Request.Context(), eid, page.LibraryID, page.Slug)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			ctx.JSON(http.StatusNotFound, model.NotFound.ToResponse(errors.New("wiki 页面不存在")))
			return
		}
		logger.Errorf(ctx.Request.Context(), "wiki get page by id failed: %v", err)
		ctx.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}
	ctx.JSON(http.StatusOK, model.Success.ToResponse(detail))
}

// @Security BearerAuth
// @Param page_id path int true "Wiki页面ID"
// @Param request body controller.WikiUpdatePageBody true "更新Wiki页面"
// @Success 200 {object} model.CommonResponse{data=service.WikiPageWriteResult}
// @Failure 400 {object} model.CommonResponse
// @Router /api/wiki/pages/{page_id} [put]
func (c *WikiPageController) UpdatePageByID(ctx *gin.Context) {
	eid := config.GetEID(ctx)
	userID := config.GetUserId(ctx)
	page, ok := resolveWikiPageByID(ctx, eid, userID, model.PERMISSION_EDIT_KNOWLEDGE, "无权限修改此 Wiki 页面")
	if !ok {
		return
	}

	var req WikiUpdatePageBody
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	result, err := c.editSvc.UpdatePage(ctx.Request.Context(), service.WikiUpdatePageRequest{
		Eid:          eid,
		LibraryID:    page.LibraryID,
		Slug:         page.Slug,
		PageType:     req.PageType,
		Title:        req.Title,
		Summary:      req.Summary,
		Content:      req.Content,
		Aliases:      req.Aliases,
		Visibility:   req.Visibility,
		FolderID:     req.FolderID,
		UpdaterID:    userID,
		ChangeReason: req.ChangeReason,
		Sources:      req.Sources,
	})
	if err != nil {
		writeWikiEditError(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, model.Success.ToResponse(result))
}

// @Security BearerAuth
// @Param page_id path int true "Wiki页面ID"
// @Success 200 {object} model.CommonResponse{data=service.WikiPageWriteResult}
// @Failure 400 {object} model.CommonResponse
// @Router /api/wiki/pages/{page_id} [delete]
func (c *WikiPageController) DeletePageByID(ctx *gin.Context) {
	eid := config.GetEID(ctx)
	userID := config.GetUserId(ctx)
	page, ok := resolveWikiPageByID(ctx, eid, userID, model.PERMISSION_EDIT_KNOWLEDGE, "无权限删除此 Wiki 页面")
	if !ok {
		return
	}
	result, err := c.editSvc.DeletePage(ctx.Request.Context(), service.WikiDeletePageRequest{
		Eid:       eid,
		LibraryID: page.LibraryID,
		Slug:      page.Slug,
		UpdaterID: userID,
	})
	if err != nil {
		writeWikiEditError(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, model.Success.ToResponse(result))
}

// @Security BearerAuth
// @Param page_id path int true "Wiki页面ID"
// @Param request body controller.WikiRenamePageBody true "重命名Wiki页面"
// @Success 200 {object} model.CommonResponse{data=service.WikiPageWriteResult}
// @Failure 400 {object} model.CommonResponse
// @Router /api/wiki/pages/{page_id}/rename [post]
func (c *WikiPageController) RenamePageByID(ctx *gin.Context) {
	eid := config.GetEID(ctx)
	userID := config.GetUserId(ctx)
	page, ok := resolveWikiPageByID(ctx, eid, userID, model.PERMISSION_EDIT_KNOWLEDGE, "无权限重命名此 Wiki 页面")
	if !ok {
		return
	}
	var req WikiRenamePageBody
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	result, err := c.editSvc.RenamePage(ctx.Request.Context(), service.WikiRenamePageRequest{
		Eid:          eid,
		LibraryID:    page.LibraryID,
		Slug:         page.Slug,
		NewSlug:      req.NewSlug,
		NewTitle:     req.NewTitle,
		ChangeReason: req.ChangeReason,
		UpdaterID:    userID,
	})
	if err != nil {
		writeWikiEditError(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, model.Success.ToResponse(result))
}

// @Security BearerAuth
// @Param page_id path int true "Wiki页面ID"
// @Param request body controller.WikiMovePageBody true "移动Wiki页面"
// @Success 200 {object} model.CommonResponse{data=service.WikiPageWriteResult}
// @Failure 400 {object} model.CommonResponse
// @Router /api/wiki/pages/{page_id}/move [post]
func (c *WikiPageController) MovePageByID(ctx *gin.Context) {
	eid := config.GetEID(ctx)
	userID := config.GetUserId(ctx)
	page, ok := resolveWikiPageByID(ctx, eid, userID, model.PERMISSION_EDIT_KNOWLEDGE, "无权限移动此 Wiki 页面")
	if !ok {
		return
	}
	var req WikiMovePageBody
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	result, err := c.editSvc.MovePage(ctx.Request.Context(), service.WikiMovePageRequest{
		Eid:          eid,
		LibraryID:    page.LibraryID,
		Slug:         page.Slug,
		FolderID:     req.FolderID,
		ChangeReason: req.ChangeReason,
		UpdaterID:    userID,
	})
	if err != nil {
		writeWikiEditError(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, model.Success.ToResponse(result))
}

// @Security BearerAuth
// @Param page_id path int true "Wiki页面ID"
// @Param request body controller.WikiArchivePageBody true "归档Wiki页面"
// @Success 200 {object} model.CommonResponse{data=service.WikiPageWriteResult}
// @Failure 400 {object} model.CommonResponse
// @Router /api/wiki/pages/{page_id}/archive [post]
func (c *WikiPageController) ArchivePageByID(ctx *gin.Context) {
	eid := config.GetEID(ctx)
	userID := config.GetUserId(ctx)
	page, ok := resolveWikiPageByID(ctx, eid, userID, model.PERMISSION_EDIT_KNOWLEDGE, "无权限归档此 Wiki 页面")
	if !ok {
		return
	}
	var req WikiArchivePageBody
	if err := ctx.ShouldBindJSON(&req); err != nil && !errors.Is(err, io.EOF) {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	result, err := c.editSvc.ArchivePage(ctx.Request.Context(), service.WikiArchivePageRequest{
		Eid:          eid,
		LibraryID:    page.LibraryID,
		Slug:         page.Slug,
		ChangeReason: req.ChangeReason,
		UpdaterID:    userID,
	})
	if err != nil {
		writeWikiEditError(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, model.Success.ToResponse(result))
}

// @Security BearerAuth
// @Summary 获取 Wiki 页面版本列表或单个版本
// @Param library_id path int true "知识库ID"
// @Param slug path string true "页面slug，末尾带版本号时可获取单个版本"
// @Param offset query int false "分页偏移量"
// @Param limit query int false "每页条数"
// @Param is_published query bool false "是否仅返回已发布版本"
// @Success 200 {object} model.CommonResponse{data=object{items=[]service.WikiPageVersionDTO,total=int64}}
// @Failure 400 {object} model.CommonResponse
// @Failure 404 {object} model.CommonResponse
// @Failure 500 {object} model.CommonResponse
// @Router /api/libraries/{library_id}/wiki/versions/{slug} [get]
func (c *WikiPageController) ListVersionsOrGetVersion(ctx *gin.Context) {
	eid := config.GetEID(ctx)
	libraryID, ok := parseWikiLibraryID(ctx)
	if !ok {
		return
	}

	raw := trimWikiSlugParam(ctx.Param("slug"))
	if raw == "" {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的 slug")))
		return
	}

	if lastSlash := strings.LastIndex(raw, "/"); lastSlash >= 0 {
		tail := raw[lastSlash+1:]
		if versionNo, err := strconv.ParseInt(strings.TrimSpace(tail), 10, 64); err == nil && versionNo > 0 {
			slug := raw[:lastSlash]
			c.serveGetVersion(ctx, eid, libraryID, slug, versionNo)
			return
		}
	}

	c.serveListVersions(ctx, eid, libraryID, raw)
}

func (c *WikiPageController) serveListVersions(ctx *gin.Context, eid, libraryID int64, slug string) {
	page, ok := requireWikiPageSlugPermission(ctx, eid, config.GetUserId(ctx), libraryID, slug, model.PERMISSION_VIEW_ONLY, "无权限查看此 Wiki 页面的版本历史")
	if !ok {
		return
	}

	items, total, err := c.readSvc.ListVersions(ctx.Request.Context(), service.WikiListVersionsRequest{
		Eid:              eid,
		PageID:           page.ID,
		Offset:           parseIntQuery(ctx, "offset", 0),
		Limit:            parseIntQuery(ctx, "limit", 20),
		IsPublished:      parseBoolQuery(ctx, "is_published"),
		CurrentVersionID: page.CurrentVersionID,
	})
	if err != nil {
		logger.Errorf(ctx.Request.Context(), "wiki list versions failed: %v", err)
		ctx.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	ctx.JSON(http.StatusOK, model.Success.ToResponse(gin.H{
		"items": items,
		"total": total,
	}))
}

func (c *WikiPageController) serveGetVersion(ctx *gin.Context, eid, libraryID int64, slug string, versionNo int64) {
	page, ok := requireWikiPageSlugPermission(ctx, eid, config.GetUserId(ctx), libraryID, slug, model.PERMISSION_VIEW_ONLY, "无权限查看此 Wiki 页面版本")
	if !ok {
		return
	}

	version, err := c.readSvc.GetVersion(ctx.Request.Context(), eid, page.ID, versionNo, page.CurrentVersionID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			ctx.JSON(http.StatusNotFound, model.NotFound.ToResponse(errors.New("版本不存在")))
			return
		}
		logger.Errorf(ctx.Request.Context(), "wiki get version failed: %v", err)
		ctx.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	ctx.JSON(http.StatusOK, model.Success.ToResponse(version))
}

// @Security BearerAuth
// @Summary 根据页面ID获取 Wiki 版本列表
// @Param page_id path int true "Wiki页面ID"
// @Param offset query int false "分页偏移量"
// @Param limit query int false "每页条数"
// @Param is_published query bool false "是否仅返回已发布版本"
// @Success 200 {object} model.CommonResponse{data=object{items=[]service.WikiPageVersionDTO,total=int64}}
// @Failure 400 {object} model.CommonResponse
// @Failure 404 {object} model.CommonResponse
// @Failure 500 {object} model.CommonResponse
// @Router /api/wiki/pages/{page_id}/versions [get]
func (c *WikiPageController) ListVersionsByID(ctx *gin.Context) {
	eid := config.GetEID(ctx)
	userID := config.GetUserId(ctx)
	page, ok := resolveWikiPageByID(ctx, eid, userID, model.PERMISSION_VIEW_ONLY, "无权限查看此 Wiki 页面的版本历史")
	if !ok {
		return
	}

	items, total, err := c.readSvc.ListVersions(ctx.Request.Context(), service.WikiListVersionsRequest{
		Eid:              eid,
		PageID:           page.ID,
		Offset:           parseIntQuery(ctx, "offset", 0),
		Limit:            parseIntQuery(ctx, "limit", 20),
		IsPublished:      parseBoolQuery(ctx, "is_published"),
		CurrentVersionID: page.CurrentVersionID,
	})
	if err != nil {
		logger.Errorf(ctx.Request.Context(), "wiki list versions by id failed: %v", err)
		ctx.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	ctx.JSON(http.StatusOK, model.Success.ToResponse(gin.H{
		"items": items,
		"total": total,
	}))
}

// @Security BearerAuth
// @Summary 根据页面ID和版本号获取 Wiki 单个版本
// @Param page_id path int true "Wiki页面ID"
// @Param version_no path int true "版本号"
// @Success 200 {object} model.CommonResponse{data=service.WikiPageVersionDTO}
// @Failure 400 {object} model.CommonResponse
// @Failure 404 {object} model.CommonResponse
// @Failure 500 {object} model.CommonResponse
// @Router /api/wiki/pages/{page_id}/versions/{version_no} [get]
func (c *WikiPageController) GetVersionByID(ctx *gin.Context) {
	eid := config.GetEID(ctx)
	userID := config.GetUserId(ctx)
	page, ok := resolveWikiPageByID(ctx, eid, userID, model.PERMISSION_VIEW_ONLY, "无权限查看此 Wiki 页面版本")
	if !ok {
		return
	}

	versionNo, err := strconv.ParseInt(strings.TrimSpace(ctx.Param("version_no")), 10, 64)
	if err != nil || versionNo <= 0 {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的版本号")))
		return
	}

	version, err := c.readSvc.GetVersion(ctx.Request.Context(), eid, page.ID, versionNo, page.CurrentVersionID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			ctx.JSON(http.StatusNotFound, model.NotFound.ToResponse(errors.New("版本不存在")))
			return
		}
		logger.Errorf(ctx.Request.Context(), "wiki get version by id failed: %v", err)
		ctx.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	ctx.JSON(http.StatusOK, model.Success.ToResponse(version))
}

type WikiPublishVersionBody struct {
	VersionTag string `json:"version_tag"`
}

type WikiVectorizePageBody struct {
	VersionID string `json:"version_id,omitempty"`
	Force     bool   `json:"force"`
	Reason    string `json:"reason,omitempty"`
}

// @Security BearerAuth
// @Summary 为 Wiki 页面创建异步向量化任务
// @Param page_id path string true "页面ID"
// @Param request body controller.WikiVectorizePageBody false "向量化参数"
// @Success 202 {object} model.CommonResponse
// @Router /api/wiki/pages/{page_id}/vectorize [post]
func (c *WikiPageController) VectorizePage(ctx *gin.Context) {
	eid := config.GetEID(ctx)
	userID := config.GetUserId(ctx)
	page, ok := resolveWikiPageByID(ctx, eid, userID, model.PERMISSION_EDIT_KNOWLEDGE, "无权限向量化此 Wiki 页面")
	if !ok {
		return
	}
	var err error
	var body WikiVectorizePageBody
	if ctx.Request.Body != nil {
		if err := ctx.ShouldBindJSON(&body); err != nil && err != io.EOF {
			ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
			return
		}
	}
	versionID := page.CurrentVersionID
	if strings.TrimSpace(body.VersionID) != "" {
		versionID, err = hashids.Decode(strings.TrimSpace(body.VersionID))
		if err != nil || versionID <= 0 {
			ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的版本ID")))
			return
		}
	}
	if versionID <= 0 {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("页面没有可向量化的已发布版本")))
		return
	}
	var selectedVersion model.WikiPageVersion
	if err := c.db.WithContext(ctx.Request.Context()).Where("eid = ? AND page_id = ? AND id = ?", eid, page.ID, versionID).First(&selectedVersion).Error; err != nil || !selectedVersion.IsPublished {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("只能向量化已发布版本")))
		return
	}
	job, err := service.EnqueueWikiPageVectorizationJob(ctx.Request.Context(), eid, page.ID, versionID, body.Force, strings.TrimSpace(body.Reason))
	if err != nil {
		logger.Errorf(ctx.Request.Context(), "wiki vectorize page failed: %v", err)
		ctx.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}
	jobID, err := hashids.Encode(job.JobID)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}
	ctx.JSON(http.StatusAccepted, model.Success.ToResponse(gin.H{"task_id": jobID, "status": job.Status, "page_id": ctx.Param("page_id")}))
}

// @Security BearerAuth
// @Summary 查询 Wiki 向量化任务
// @Param task_id path string true "任务ID"
// @Success 200 {object} model.CommonResponse
// @Router /api/wiki/vectorization-tasks/{task_id} [get]
func (c *WikiPageController) GetVectorizationTask(ctx *gin.Context) {
	eid := config.GetEID(ctx)
	userID := config.GetUserId(ctx)
	jobID, err := hashids.Decode(strings.TrimSpace(ctx.Param("task_id")))
	if err != nil || jobID <= 0 {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的任务ID")))
		return
	}
	var job model.RagJob
	if err := c.db.WithContext(ctx.Request.Context()).Where("eid = ? AND job_id = ? AND type = ?", eid, jobID, service.WikiPageVectorizationJobType).First(&job).Error; err != nil {
		ctx.JSON(http.StatusNotFound, model.NotFound.ToResponse(errors.New("向量化任务不存在")))
		return
	}
	page, ok := resolveWikiPageByIDValue(ctx, eid, userID, job.RelatedId, model.PERMISSION_VIEW_ONLY, "无权限查看此 Wiki 页面")
	if !ok {
		return
	}
	encodedPageID, err := hashids.Encode(page.ID)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}
	versionID := vectorizationVersionID(job.StartParameters)
	encodedVersionID, err := hashids.Encode(versionID)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}
	ctx.JSON(http.StatusOK, model.Success.ToResponse(gin.H{
		"task_id": ctx.Param("task_id"), "status": job.Status, "progress": job.Progress,
		"failure_reason": job.FailureReason, "page_id": encodedPageID, "version_id": encodedVersionID,
	}))
}

func vectorizationVersionID(raw string) int64 {
	var params struct {
		VersionID int64 `json:"version_id"`
	}
	_ = json.Unmarshal([]byte(raw), &params)
	return params.VersionID
}

func resolveWikiPageByIDValue(ctx *gin.Context, eid, userID, pageID int64, minPermission int, deniedMessage string) (*model.WikiPage, bool) {
	page, err := model.GetWikiPageByID(eid, pageID)
	if err != nil {
		ctx.JSON(http.StatusNotFound, model.NotFound.ToResponse(errors.New("wiki 页面不存在")))
		return nil, false
	}
	permission, err := service.GetUserPermission(eid, model.RESOURCE_TYPE_WIKI_PAGE, pageID, userID)
	if err != nil || permission < minPermission {
		ctx.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(errors.New(deniedMessage)))
		return nil, false
	}
	return page, true
}

// @Security BearerAuth
// @Summary 发布 Wiki 页面版本
// @Param page_id path string true "页面ID"
// @Param version_no path int true "版本号"
// @Param request body controller.WikiPublishVersionBody true "发布参数"
// @Success 200 {object} model.CommonResponse{data=service.WikiPageVersionDTO} "发布成功"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 404 {object} model.CommonResponse "页面或版本不存在"
// @Failure 500 {object} model.CommonResponse "服务器错误"
// @Router /api/wiki/pages/{page_id}/versions/{version_no}/publish [post]
func (c *WikiPageController) PublishVersion(ctx *gin.Context) {
	eid := config.GetEID(ctx)
	userID := config.GetUserId(ctx)
	page, ok := resolveWikiPageByID(ctx, eid, userID, model.PERMISSION_EDIT_KNOWLEDGE, "无权限发布此 Wiki 页面版本")
	if !ok {
		return
	}

	versionNo, err := strconv.ParseInt(strings.TrimSpace(ctx.Param("version_no")), 10, 64)
	if err != nil || versionNo <= 0 {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的版本号")))
		return
	}

	var reqBody WikiPublishVersionBody
	if err := ctx.ShouldBindJSON(&reqBody); err != nil {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	version, err := c.editSvc.PublishVersion(ctx.Request.Context(), service.WikiPublishVersionRequest{
		Eid:        eid,
		PageID:     page.ID,
		VersionNo:  versionNo,
		EditorID:   userID,
		VersionTag: strings.TrimSpace(reqBody.VersionTag),
	})
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			ctx.JSON(http.StatusNotFound, model.NotFound.ToResponse(errors.New("版本不存在")))
			return
		}
		logger.Errorf(ctx.Request.Context(), "wiki publish version failed: %v", err)
		ctx.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	ctx.JSON(http.StatusOK, model.Success.ToResponse(version))
}

type WikiUpdateVersionTagBody struct {
	VersionTag string `json:"version_tag"`
}

// @Security BearerAuth
// @Summary 更新 Wiki 页面版本的 version_tag（支持清空）
// @Param page_id path string true "页面ID"
// @Param version_no path int true "版本号"
// @Param request body controller.WikiUpdateVersionTagBody true "version_tag 值，传空字符串即清空"
// @Success 200 {object} model.CommonResponse{data=service.WikiPageVersionDTO}
// @Failure 400 {object} model.CommonResponse
// @Failure 404 {object} model.CommonResponse
// @Failure 500 {object} model.CommonResponse
// @Router /api/wiki/pages/{page_id}/versions/{version_no}/version-tag [put]
func (c *WikiPageController) UpdateVersionTag(ctx *gin.Context) {
	eid := config.GetEID(ctx)
	userID := config.GetUserId(ctx)
	page, ok := resolveWikiPageByID(ctx, eid, userID, model.PERMISSION_EDIT_KNOWLEDGE, "无权限编辑此 Wiki 页面版本标签")
	if !ok {
		return
	}

	versionNo, err := strconv.ParseInt(strings.TrimSpace(ctx.Param("version_no")), 10, 64)
	if err != nil || versionNo <= 0 {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的版本号")))
		return
	}

	var reqBody WikiUpdateVersionTagBody
	if err := ctx.ShouldBindJSON(&reqBody); err != nil {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	version, err := c.editSvc.UpdateVersionTag(ctx.Request.Context(), service.WikiUpdateVersionTagRequest{
		Eid:        eid,
		PageID:     page.ID,
		VersionNo:  versionNo,
		EditorID:   userID,
		VersionTag: strings.TrimSpace(reqBody.VersionTag),
	})
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			ctx.JSON(http.StatusNotFound, model.NotFound.ToResponse(errors.New("版本不存在")))
			return
		}
		logger.Errorf(ctx.Request.Context(), "wiki update version tag failed: %v", err)
		ctx.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	ctx.JSON(http.StatusOK, model.Success.ToResponse(version))
}

func parseWikiLibraryID(ctx *gin.Context) (int64, bool) {
	libraryID, err := parseWikiPageID(ctx.Param("library_id"))
	if err != nil || libraryID <= 0 {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的知识库ID")))
		return 0, false
	}
	return libraryID, true
}

func parseWikiPageID(raw string) (int64, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0, errors.New("empty id")
	}
	id, err := hashids.TryParseID(raw)
	if err != nil || id <= 0 {
		return 0, errors.New("invalid id")
	}
	return id, nil
}

func trimWikiSlugParam(raw string) string {
	raw = strings.TrimSpace(raw)
	raw = strings.TrimPrefix(raw, "/")
	if raw == "" {
		return raw
	}
	if decoded, err := url.PathUnescape(raw); err == nil {
		return decoded
	}
	return raw
}

func parseIntQuery(ctx *gin.Context, key string, fallback int) int {
	raw := strings.TrimSpace(ctx.Query(key))
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	return value
}

func parseBoolQuery(ctx *gin.Context, key string) *bool {
	raw := strings.TrimSpace(ctx.Query(key))
	if raw == "" {
		return nil
	}
	value, err := strconv.ParseBool(raw)
	if err != nil {
		return nil
	}
	return &value
}

func parseWikiGraphMode(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "ego":
		return "ego"
	default:
		return "overview"
	}
}

func parseWikiGraphTypes(raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	types := make([]string, 0, len(parts))
	seen := make(map[string]struct{}, len(parts))
	for _, part := range parts {
		value := strings.TrimSpace(part)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		types = append(types, value)
	}
	return types
}

func firstNonEmptyWikiValue(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func writeWikiEditError(ctx *gin.Context, err error) {
	switch {
	case errors.Is(err, service.ErrWikiPageNotFound), errors.Is(err, gorm.ErrRecordNotFound):
		ctx.JSON(http.StatusNotFound, model.NotFound.ToResponse(errors.New("wiki 页面不存在")))
	case errors.Is(err, service.ErrWikiPageSlugExists):
		ctx.JSON(http.StatusConflict, model.RecordAlreadyExists.ToResponse(errors.New("slug 已存在")))
	default:
		logger.Errorf(ctx.Request.Context(), "wiki edit failed: %v", err)
		ctx.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
	}
}
