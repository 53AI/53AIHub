package controller

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type WikiSpaceController struct {
	readSvc service.WikiSpaceReadService
}

func NewWikiSpaceController(db *gorm.DB) *WikiSpaceController {
	return &WikiSpaceController{
		readSvc: service.NewWikiSpaceReadService(db),
	}
}

type WikiSpaceListPagesQuery struct {
	LibraryID int64  `form:"library_id"`
	Keyword   string `form:"keyword"`
	PageType  string `form:"page_type"`
	Status    string `form:"status"`
	SortBy    string `form:"sort_by"`
	Offset    int    `form:"offset"`
	Limit     int    `form:"limit"`
}

type WikiSpacePageQuery struct {
	LibraryID int64 `form:"library_id"`
}

type WikiSpaceGraphQuery struct {
	LibraryID int64  `form:"library_id"`
	Mode      string `form:"mode"`
	Center    string `form:"center"`
	Depth     int    `form:"depth"`
	Types     string `form:"types"`
	Limit     int    `form:"limit"`
}

type WikiSpaceLogsQuery struct {
	LibraryID int64  `form:"library_id"`
	Cursor    string `form:"cursor"`
	Limit     int    `form:"limit"`
}

type WikiSpaceProgressQuery struct {
	LibraryID int64  `form:"library_id"`
	Status    string `form:"status"`
	Offset    int    `form:"offset"`
	Limit     int    `form:"limit"`
}

// ListPages 获取空间内可见的 Wiki 页面列表。
// @Summary 获取空间 Wiki 页面列表
// @Tags Wiki Space
// @Produce json
// @Security BearerAuth
// @Param space_id path string true "空间ID（hashID 或原始 int64）"
// @Param library_id query string false "知识库ID（hashID 或原始 int64）"
// @Param keyword query string false "关键词"
// @Param page_type query string false "页面类型"
// @Param status query string false "页面状态"
// @Param sort_by query string false "排序字段：title、created_time、updated_time"
// @Param offset query int false "分页偏移量"
// @Param limit query int false "每页条数"
// @Success 200 {object} model.CommonResponse{data=service.WikiSpaceListPagesResponse}
// @Failure 400 {object} model.CommonResponse "请求参数错误"
// @Failure 403 {object} model.CommonResponse "无权限查看空间 Wiki"
// @Failure 404 {object} model.CommonResponse "空间不存在"
// @Router /api/spaces/{space_id}/wiki/pages [get]
func (c *WikiSpaceController) ListPages(ctx *gin.Context) {
	req, ok := c.buildBaseSpaceRequest(ctx)
	if !ok {
		return
	}
	var query WikiSpaceListPagesQuery
	if err := ctx.ShouldBindQuery(&query); err != nil {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	req.LibraryID = query.LibraryID

	resp, err := c.readSvc.ListPages(ctx.Request.Context(), service.WikiSpaceListPagesRequest{
		WikiSpaceBaseRequest: req,
		Keyword:              query.Keyword,
		PageType:             query.PageType,
		Status:               query.Status,
		SortBy:               query.SortBy,
		Offset:               query.Offset,
		Limit:                query.Limit,
	})
	if err != nil {
		writeWikiSpaceReadError(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, model.Success.ToResponse(resp))
}

// GetPage 获取空间内指定 Wiki 页面详情。
// @Summary 获取空间 Wiki 页面详情
// @Tags Wiki Space
// @Produce json
// @Security BearerAuth
// @Param space_id path string true "空间ID（hashID 或原始 int64）"
// @Param slug path string true "页面 slug"
// @Param library_id query string false "知识库ID（hashID 或原始 int64）"
// @Success 200 {object} model.CommonResponse{data=service.WikiSpacePageDetailResponse}
// @Failure 400 {object} model.CommonResponse "请求参数错误"
// @Failure 403 {object} model.CommonResponse "无权限查看空间 Wiki"
// @Failure 404 {object} model.CommonResponse "页面或空间不存在"
// @Router /api/spaces/{space_id}/wiki/pages/{slug} [get]
func (c *WikiSpaceController) GetPage(ctx *gin.Context) {
	req, ok := c.buildBaseSpaceRequest(ctx)
	if !ok {
		return
	}
	var query WikiSpacePageQuery
	if err := ctx.ShouldBindQuery(&query); err != nil {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	req.LibraryID = query.LibraryID
	slug := trimWikiSlugParam(ctx.Param("slug"))

	resp, err := c.readSvc.GetPage(ctx.Request.Context(), service.WikiSpacePageRequest{
		WikiSpaceBaseRequest: req,
		Slug:                 slug,
	})
	if err != nil {
		writeWikiSpaceReadError(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, model.Success.ToResponse(resp))
}

// GetIndex 获取空间 Wiki 索引。
// @Summary 获取空间 Wiki 索引
// @Tags Wiki Space
// @Produce json
// @Security BearerAuth
// @Param space_id path string true "空间ID（hashID 或原始 int64）"
// @Param library_id query string false "知识库ID（hashID 或原始 int64）"
// @Success 200 {object} model.CommonResponse{data=service.WikiSpaceIndexView}
// @Failure 400 {object} model.CommonResponse "请求参数错误"
// @Failure 403 {object} model.CommonResponse "无权限查看空间 Wiki"
// @Failure 404 {object} model.CommonResponse "空间不存在"
// @Router /api/spaces/{space_id}/wiki/index [get]
func (c *WikiSpaceController) GetIndex(ctx *gin.Context) {
	req, ok := c.buildBaseSpaceRequest(ctx)
	if !ok {
		return
	}
	libraryID, ok := parseOptionalQueryInt64(ctx, "library_id")
	if !ok {
		return
	}
	req.LibraryID = libraryID

	resp, err := c.readSvc.GetIndex(ctx.Request.Context(), req)
	if err != nil {
		writeWikiSpaceReadError(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, model.Success.ToResponse(resp))
}

// GetGraph 获取空间 Wiki 页面关系图。
// @Summary 获取空间 Wiki 关系图
// @Tags Wiki Space
// @Produce json
// @Security BearerAuth
// @Param space_id path string true "空间ID（hashID 或原始 int64）"
// @Param library_id query string false "知识库ID（hashID 或原始 int64）"
// @Param mode query string false "图模式"
// @Param center query string false "中心页面 slug"
// @Param depth query int false "关系图深度"
// @Param types query string false "页面类型，多个值用逗号分隔"
// @Param limit query int false "返回边和节点数量上限"
// @Success 200 {object} model.CommonResponse{data=service.WikiSpaceGraphView}
// @Failure 400 {object} model.CommonResponse "请求参数错误"
// @Failure 403 {object} model.CommonResponse "无权限查看空间 Wiki"
// @Failure 404 {object} model.CommonResponse "空间不存在"
// @Router /api/spaces/{space_id}/wiki/graph [get]
func (c *WikiSpaceController) GetGraph(ctx *gin.Context) {
	req, ok := c.buildBaseSpaceRequest(ctx)
	if !ok {
		return
	}
	var query WikiSpaceGraphQuery
	if err := ctx.ShouldBindQuery(&query); err != nil {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	req.LibraryID = query.LibraryID
	resp, err := c.readSvc.GetGraph(ctx.Request.Context(), service.WikiSpaceGraphRequest{
		WikiSpaceBaseRequest: req,
		Mode:                 query.Mode,
		Center:               trimWikiSlugParam(query.Center),
		Depth:                query.Depth,
		Types:                parseWikiGraphTypes(query.Types),
		Limit:                query.Limit,
	})
	if err != nil {
		writeWikiSpaceReadError(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, model.Success.ToResponse(resp))
}

// ListLogs 获取空间 Wiki 操作日志。
// @Summary 获取空间 Wiki 操作日志
// @Tags Wiki Space
// @Produce json
// @Security BearerAuth
// @Param space_id path string true "空间ID（hashID 或原始 int64）"
// @Param library_id query string false "知识库ID（hashID 或原始 int64）"
// @Param cursor query string false "下一页游标"
// @Param limit query int false "每页条数，范围 1-200，默认 50"
// @Success 200 {object} model.CommonResponse{data=service.WikiSpaceListLogsResponse}
// @Failure 400 {object} model.CommonResponse "请求参数错误"
// @Failure 403 {object} model.CommonResponse "无权限查看空间 Wiki"
// @Failure 404 {object} model.CommonResponse "空间不存在"
// @Router /api/spaces/{space_id}/wiki/logs [get]
func (c *WikiSpaceController) ListLogs(ctx *gin.Context) {
	req, ok := c.buildBaseSpaceRequest(ctx)
	if !ok {
		return
	}
	var query WikiSpaceLogsQuery
	if err := ctx.ShouldBindQuery(&query); err != nil {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	req.LibraryID = query.LibraryID
	resp, err := c.readSvc.ListLogs(ctx.Request.Context(), service.WikiSpaceListLogsRequest{
		WikiSpaceBaseRequest: req,
		Cursor:               query.Cursor,
		Limit:                query.Limit,
	})
	if err != nil {
		writeWikiSpaceReadError(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, model.Success.ToResponse(resp))
}

// GetHealth 获取空间 Wiki 健康检查结果。
// @Summary 获取空间 Wiki 健康检查
// @Tags Wiki Space
// @Produce json
// @Security BearerAuth
// @Param space_id path string true "空间ID（hashID 或原始 int64）"
// @Param library_id query string false "知识库ID（hashID 或原始 int64）"
// @Success 200 {object} model.CommonResponse{data=service.WikiSpaceHealthReport}
// @Failure 400 {object} model.CommonResponse "请求参数错误"
// @Failure 403 {object} model.CommonResponse "无权限查看空间 Wiki"
// @Failure 404 {object} model.CommonResponse "空间不存在"
// @Router /api/spaces/{space_id}/wiki/health [get]
func (c *WikiSpaceController) GetHealth(ctx *gin.Context) {
	req, ok := c.buildBaseSpaceRequest(ctx)
	if !ok {
		return
	}
	libraryID, ok := parseOptionalQueryInt64(ctx, "library_id")
	if !ok {
		return
	}
	req.LibraryID = libraryID

	resp, err := c.readSvc.GetHealth(ctx.Request.Context(), req)
	if err != nil {
		writeWikiSpaceReadError(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, model.Success.ToResponse(resp))
}

// GetStats 获取空间 Wiki + 文档统计信息。
// @Summary 获取空间 Wiki + 文档统计
// @Tags Wiki Space
// @Produce json
// @Security BearerAuth
// @Param space_id path string true "空间ID（hashID 或原始 int64）"
// @Success 200 {object} model.CommonResponse{data=service.WikiSpaceStatsResponse}
// @Failure 400 {object} model.CommonResponse "请求参数错误"
// @Failure 403 {object} model.CommonResponse "无权限查看空间 Wiki"
// @Failure 404 {object} model.CommonResponse "空间不存在"
// @Router /api/spaces/{space_id}/wiki/stats [get]
func (c *WikiSpaceController) GetStats(ctx *gin.Context) {
	req, ok := c.buildBaseSpaceRequest(ctx)
	if !ok {
		return
	}
	resp, err := c.readSvc.GetStats(ctx.Request.Context(), req)
	if err != nil {
		writeWikiSpaceReadError(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, model.Success.ToResponse(resp))
}

// ListProgress 获取空间 Wiki 生成进度列表。
// @Summary 获取空间 Wiki 生成进度列表
// @Tags Wiki Space
// @Produce json
// @Security BearerAuth
// @Param space_id path string true "空间ID（hashID 或原始 int64）"
// @Param library_id query string false "知识库ID（hashID 或原始 int64）"
// @Param status query string false "进度状态"
// @Param offset query int false "分页偏移量"
// @Param limit query int false "每页条数"
// @Success 200 {object} model.CommonResponse{data=service.WikiSpaceListProgressResponse}
// @Failure 400 {object} model.CommonResponse "请求参数错误"
// @Failure 403 {object} model.CommonResponse "无权限查看空间 Wiki"
// @Failure 404 {object} model.CommonResponse "空间不存在"
// @Router /api/spaces/{space_id}/wiki/progress [get]
func (c *WikiSpaceController) ListProgress(ctx *gin.Context) {
	req, ok := c.buildBaseSpaceRequest(ctx)
	if !ok {
		return
	}
	var query WikiSpaceProgressQuery
	if err := ctx.ShouldBindQuery(&query); err != nil {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	req.LibraryID = query.LibraryID
	resp, err := c.readSvc.ListProgress(ctx.Request.Context(), service.WikiSpaceProgressListRequest{
		WikiSpaceBaseRequest: req,
		Status:               query.Status,
		Offset:               query.Offset,
		Limit:                query.Limit,
	})
	if err != nil {
		writeWikiSpaceReadError(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, model.Success.ToResponse(resp))
}

// GetProgress 获取空间 Wiki 指定文件的生成进度详情。
// @Summary 获取空间 Wiki 文件生成进度
// @Tags Wiki Space
// @Produce json
// @Security BearerAuth
// @Param space_id path string true "空间ID（hashID 或原始 int64）"
// @Param file_id path string true "文件ID（hashID 或原始 int64）"
// @Param library_id query string false "知识库ID（hashID 或原始 int64）"
// @Success 200 {object} model.CommonResponse{data=service.WikiSpaceProgressDetailResponse}
// @Failure 400 {object} model.CommonResponse "请求参数错误"
// @Failure 403 {object} model.CommonResponse "无权限查看空间 Wiki"
// @Failure 404 {object} model.CommonResponse "空间或文件不存在"
// @Router /api/spaces/{space_id}/wiki/progress/{file_id} [get]
func (c *WikiSpaceController) GetProgress(ctx *gin.Context) {
	req, ok := c.buildBaseSpaceRequest(ctx)
	if !ok {
		return
	}
	libraryID, ok := parseOptionalQueryInt64(ctx, "library_id")
	if !ok {
		return
	}
	req.LibraryID = libraryID

	fileID, err := strconv.ParseInt(strings.TrimSpace(ctx.Param("file_id")), 10, 64)
	if err != nil || fileID <= 0 {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("file_id 参数无效")))
		return
	}

	resp, err := c.readSvc.GetProgress(ctx.Request.Context(), service.WikiSpaceProgressRequest{
		WikiSpaceBaseRequest: req,
		FileID:               fileID,
	})
	if err != nil {
		writeWikiSpaceReadError(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, model.Success.ToResponse(resp))
}

func (c *WikiSpaceController) buildBaseSpaceRequest(ctx *gin.Context) (service.WikiSpaceBaseRequest, bool) {
	eid := config.GetEID(ctx)
	spaceID, ok := parseWikiSpaceID(ctx.Param("space_id"))
	if !ok {
		return service.WikiSpaceBaseRequest{}, false
	}
	return service.WikiSpaceBaseRequest{
		Eid:     eid,
		UserID:  config.GetUserId(ctx),
		SpaceID: spaceID,
		IsAdmin: common.IsAdmin(ctx),
	}, true
}

func parseWikiSpaceID(raw string) (int64, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0, false
	}
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || id <= 0 {
		return 0, false
	}
	return id, true
}

func parseOptionalQueryInt64(ctx *gin.Context, key string) (int64, bool) {
	raw := strings.TrimSpace(ctx.Query(key))
	if raw == "" {
		return 0, true
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || value <= 0 {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New(key+" 参数无效")))
		return 0, false
	}
	return value, true
}

func writeWikiSpaceReadError(ctx *gin.Context, err error) {
	switch {
	case errors.Is(err, service.ErrWikiSpaceNotFound), errors.Is(err, service.ErrWikiSpacePageNotFound), errors.Is(err, service.ErrWikiSpaceFileNotFound), errors.Is(err, gorm.ErrRecordNotFound):
		ctx.JSON(http.StatusNotFound, model.NotFound.ToResponse(errors.New("wiki 资源不存在")))
	case errors.Is(err, service.ErrWikiSpaceForbidden), errors.Is(err, service.ErrWikiSpaceLibraryNotVisible):
		ctx.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(errors.New("无权限查看该空间的 Wiki")))
	case errors.Is(err, service.ErrWikiSpaceDuplicateSlug):
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("slug 在多个来源库中存在，请指定 library_id")))
	default:
		logger.Errorf(ctx.Request.Context(), "wiki space read failed: %v", err)
		ctx.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
	}
}
