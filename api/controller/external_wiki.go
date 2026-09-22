package controller

import (
	"errors"
	"net/http"
	"strings"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type ExternalWikiController struct {
	readSvc service.ExternalWikiReadService
}

func NewExternalWikiController(db *gorm.DB) *ExternalWikiController {
	return &ExternalWikiController{
		readSvc: service.NewExternalWikiReadService(db),
	}
}

type ExternalWikiListQuery struct {
	Keyword  string `form:"keyword"`
	PageType string `form:"page_type"`
	Offset   int    `form:"offset"`
	Limit    int    `form:"limit"`
}

type ExternalWikiSearchQuery struct {
	Keyword string `form:"keyword" binding:"required"`
	TopK    int    `form:"top_k"`
}

type ExternalWikiPageResponse struct {
	ID            string   `json:"id"`
	SpaceID       string   `json:"space_id"`
	LibraryID     string   `json:"library_id"`
	FolderID      string   `json:"folder_id,omitempty"`
	Title         string   `json:"title"`
	Slug          string   `json:"slug"`
	PageType      string   `json:"page_type"`
	Summary       string   `json:"summary"`
	Aliases       []string `json:"aliases,omitempty"`
	Status        string   `json:"status"`
	Visibility    string   `json:"visibility"`
	CreatedTime   int64    `json:"created_time"`
	UpdatedTime   int64    `json:"updated_time"`
	VersionNo     int64    `json:"version_no"`
	VersionTag    string   `json:"version_tag,omitempty"`
	PublishedTime int64    `json:"published_time"`
	Body          string   `json:"body,omitempty"`
	BodyFormat    string   `json:"body_format,omitempty"`
}

type ExternalWikiListResponse struct {
	Items []ExternalWikiPageResponse `json:"items"`
	Total int64                      `json:"total"`
}

type ExternalWikiSearchItemResponse struct {
	PageID        string `json:"page_id"`
	SpaceID       string `json:"space_id"`
	LibraryID     string `json:"library_id"`
	Title         string `json:"title"`
	Slug          string `json:"slug"`
	Summary       string `json:"summary"`
	Snippet       string `json:"snippet"`
	PageType      string `json:"page_type"`
	VersionNo     int64  `json:"version_no"`
	VersionTag    string `json:"version_tag,omitempty"`
	PublishedTime int64  `json:"published_time"`
}

type ExternalWikiSearchResponse struct {
	Items []ExternalWikiSearchItemResponse `json:"items"`
	Total int64                            `json:"total"`
}

// ListPages returns active, non-private Wiki pages from the API key's scope.
// @Summary 外部 Wiki 页面列表
// @Description 使用知识库/空间级 API Key 获取当前 Key 作用域内已发布页面的列表。只返回 active 且非 private 页面。
// @Tags 外部 Wiki
// @Accept json
// @Produce json
// @Security ExternalAPIKeyAuth
// @Param keyword query string false "标题、slug 或摘要关键词"
// @Param page_type query string false "页面类型"
// @Param library_ids query string false "知识库 hashid 列表（逗号分隔），仅在 Key 作用域内筛选，默认返回全部作用域"
// @Param offset query int false "分页偏移量，默认 0"
// @Param limit query int false "每页数量，默认 20，最大 100"
// @Success 200 {object} model.CommonResponse{data=controller.ExternalWikiListResponse}
// @Failure 400 {object} controller.ExternalWikiErrorResponse
// @Failure 401 {object} controller.ExternalWikiErrorResponse
// @Failure 403 {object} controller.ExternalWikiErrorResponse
// @Failure 500 {object} controller.ExternalWikiErrorResponse
// @Router /api/external-wiki/pages [get]
func (c *ExternalWikiController) ListPages(ctx *gin.Context) {
	eid, libraryID, spaceID, ok := externalWikiScope(ctx)
	if !ok {
		return
	}

	var query ExternalWikiListQuery
	if err := ctx.ShouldBindQuery(&query); err != nil {
		externalWikiError(ctx, http.StatusBadRequest, "请求参数错误")
		return
	}

	libraryIDs, ok := c.resolveExternalWikiLibraries(ctx, eid, libraryID, spaceID)
	if !ok {
		return
	}
	libraryIDs, ok = narrowExternalWikiLibraries(ctx, libraryIDs)
	if !ok {
		return
	}

	result, err := c.readSvc.ListPages(ctx.Request.Context(), service.ExternalWikiListRequest{
		Eid:        eid,
		LibraryIDs: libraryIDs,
		Keyword:    query.Keyword,
		PageType:   query.PageType,
		Offset:     query.Offset,
		Limit:      query.Limit,
	})
	if err != nil {
		externalWikiInternalError(ctx, err)
		return
	}

	response := ExternalWikiListResponse{
		Items: make([]ExternalWikiPageResponse, 0, len(result.Items)),
		Total: result.Total,
	}
	for _, item := range result.Items {
		response.Items = append(response.Items, encodeExternalWikiPage(item, false))
	}
	ctx.JSON(http.StatusOK, model.Success.ToResponse(response))
}

// GetPage returns the current published version of a Wiki page in the API key's scope.
// @Summary 外部 Wiki 页面详情
// @Description 使用知识库/空间级 API Key 获取页面当前已发布版本。页面必须属于当前 Key 作用域。
// @Tags 外部 Wiki
// @Produce json
// @Security ExternalAPIKeyAuth
// @Param page_id path string true "Wiki 页面 hashid"
// @Success 200 {object} model.CommonResponse{data=controller.ExternalWikiPageResponse}
// @Failure 400 {object} controller.ExternalWikiErrorResponse
// @Failure 401 {object} controller.ExternalWikiErrorResponse
// @Failure 403 {object} controller.ExternalWikiErrorResponse
// @Failure 404 {object} controller.ExternalWikiErrorResponse
// @Failure 500 {object} controller.ExternalWikiErrorResponse
// @Router /api/external-wiki/pages/{page_id} [get]
func (c *ExternalWikiController) GetPage(ctx *gin.Context) {
	eid, libraryID, spaceID, ok := externalWikiScope(ctx)
	if !ok {
		return
	}

	pageID, err := hashids.TryParseID(strings.TrimSpace(ctx.Param("page_id")))
	if err != nil || pageID <= 0 {
		externalWikiError(ctx, http.StatusBadRequest, "无效的页面 ID")
		return
	}

	libraryIDs, ok := c.resolveExternalWikiLibraries(ctx, eid, libraryID, spaceID)
	if !ok {
		return
	}

	page, err := c.readSvc.GetPage(ctx.Request.Context(), eid, libraryIDs, pageID)
	if err != nil {
		if errors.Is(err, service.ErrExternalWikiPageNotFound) || errors.Is(err, gorm.ErrRecordNotFound) {
			externalWikiError(ctx, http.StatusNotFound, "Wiki 页面不存在")
			return
		}
		externalWikiInternalError(ctx, err)
		return
	}

	ctx.JSON(http.StatusOK, model.Success.ToResponse(encodeExternalWikiPage(*page, true)))
}

// Search searches published Wiki pages in the API key's scope.
// @Summary 外部 Wiki 页面搜索
// @Description 使用知识库/空间级 API Key 搜索当前 Key 作用域内已发布页面，返回摘要和正文片段。
// @Tags 外部 Wiki
// @Produce json
// @Security ExternalAPIKeyAuth
// @Param keyword query string true "搜索关键词"
// @Param library_ids query string false "知识库 hashid 列表（逗号分隔），仅在 Key 作用域内筛选，默认返回全部作用域"
// @Param top_k query int false "最多返回数量，默认 10，最大 50"
// @Success 200 {object} model.CommonResponse{data=controller.ExternalWikiSearchResponse}
// @Failure 400 {object} controller.ExternalWikiErrorResponse
// @Failure 401 {object} controller.ExternalWikiErrorResponse
// @Failure 403 {object} controller.ExternalWikiErrorResponse
// @Failure 500 {object} controller.ExternalWikiErrorResponse
// @Router /api/external-wiki/search [get]
func (c *ExternalWikiController) Search(ctx *gin.Context) {
	eid, libraryID, spaceID, ok := externalWikiScope(ctx)
	if !ok {
		return
	}

	var query ExternalWikiSearchQuery
	if err := ctx.ShouldBindQuery(&query); err != nil || strings.TrimSpace(query.Keyword) == "" {
		externalWikiError(ctx, http.StatusBadRequest, "keyword 不能为空")
		return
	}

	libraryIDs, ok := c.resolveExternalWikiLibraries(ctx, eid, libraryID, spaceID)
	if !ok {
		return
	}
	libraryIDs, ok = narrowExternalWikiLibraries(ctx, libraryIDs)
	if !ok {
		return
	}

	result, err := c.readSvc.Search(ctx.Request.Context(), service.ExternalWikiSearchRequest{
		Eid:        eid,
		LibraryIDs: libraryIDs,
		Query:      strings.TrimSpace(query.Keyword),
		TopK:       query.TopK,
	})
	if err != nil {
		if errors.Is(err, service.ErrExternalWikiQueryRequired) {
			externalWikiError(ctx, http.StatusBadRequest, "keyword 不能为空")
			return
		}
		externalWikiInternalError(ctx, err)
		return
	}

	response := ExternalWikiSearchResponse{
		Items: make([]ExternalWikiSearchItemResponse, 0, len(result.Items)),
		Total: result.Total,
	}
	for _, item := range result.Items {
		response.Items = append(response.Items, ExternalWikiSearchItemResponse{
			PageID:        encodeExternalWikiID(item.PageID),
			SpaceID:       encodeExternalWikiID(item.SpaceID),
			LibraryID:     encodeExternalWikiID(item.LibraryID),
			Title:         item.Title,
			Slug:          item.Slug,
			Summary:       item.Summary,
			Snippet:       item.Snippet,
			PageType:      item.PageType,
			VersionNo:     item.VersionNo,
			VersionTag:    item.VersionTag,
			PublishedTime: item.PublishedTime,
		})
	}
	ctx.JSON(http.StatusOK, model.Success.ToResponse(response))
}

type ExternalWikiErrorResponse struct {
	ErrorCode int    `json:"error_code" example:"403"`
	ErrorMsg  string `json:"error_msg" example:"无权访问该 Wiki 资源"`
}

func externalWikiScope(ctx *gin.Context) (int64, *int64, *int64, bool) {
	value, exists := ctx.Get("api_key")
	apiKey, ok := value.(*model.APIKey)
	if !exists || !ok || apiKey == nil || apiKey.Eid <= 0 {
		externalWikiError(ctx, http.StatusForbidden, "外部 Wiki API Key 无效")
		return 0, nil, nil, false
	}
	if (apiKey.LibraryID == nil || *apiKey.LibraryID <= 0) && (apiKey.SpaceID == nil || *apiKey.SpaceID <= 0) {
		externalWikiError(ctx, http.StatusForbidden, "外部 Wiki API Key 必须绑定知识库或空间")
		return 0, nil, nil, false
	}
	return apiKey.Eid, apiKey.LibraryID, apiKey.SpaceID, true
}

// resolveExternalWikiLibraries 将 API Key 的绑定范围解析为可访问的知识库 ID 列表。
func (c *ExternalWikiController) resolveExternalWikiLibraries(ctx *gin.Context, eid int64, libraryID, spaceID *int64) ([]int64, bool) {
	libraryIDs, err := c.readSvc.ResolveLibraryScope(ctx.Request.Context(), eid, libraryID, spaceID)
	if err != nil {
		externalWikiInternalError(ctx, err)
		return nil, false
	}
	return libraryIDs, true
}

// narrowExternalWikiLibraries 根据请求的 library_ids 参数收敛作用域。
// 请求未传时返回全部作用域；传入时必须全部落在 Key 作用域内，否则拒绝。
func narrowExternalWikiLibraries(ctx *gin.Context, allowed []int64) ([]int64, bool) {
	raw := strings.TrimSpace(ctx.Query("library_ids"))
	if raw == "" {
		return allowed, true
	}

	allowedSet := make(map[int64]struct{}, len(allowed))
	for _, id := range allowed {
		allowedSet[id] = struct{}{}
	}

	parts := strings.Split(raw, ",")
	requested := make([]int64, 0, len(parts))
	seen := make(map[int64]struct{}, len(parts))
	for _, part := range parts {
		id, err := hashids.TryParseID(strings.TrimSpace(part))
		if err != nil || id <= 0 {
			externalWikiError(ctx, http.StatusBadRequest, "无效的知识库ID")
			return nil, false
		}
		if _, ok := allowedSet[id]; !ok {
			externalWikiError(ctx, http.StatusForbidden, "无权访问指定的知识库")
			return nil, false
		}
		if _, dup := seen[id]; !dup {
			seen[id] = struct{}{}
			requested = append(requested, id)
		}
	}

	if len(requested) == 0 {
		externalWikiError(ctx, http.StatusBadRequest, "library_ids 不能为空")
		return nil, false
	}
	return requested, true
}

func encodeExternalWikiPage(page service.ExternalWikiPage, includeBody bool) ExternalWikiPageResponse {
	response := ExternalWikiPageResponse{
		ID:            encodeExternalWikiID(page.ID),
		SpaceID:       encodeExternalWikiID(page.SpaceID),
		LibraryID:     encodeExternalWikiID(page.LibraryID),
		Title:         page.Title,
		Slug:          page.Slug,
		PageType:      page.PageType,
		Summary:       page.Summary,
		Aliases:       page.Aliases,
		Status:        page.Status,
		Visibility:    page.Visibility,
		CreatedTime:   page.CreatedTime,
		UpdatedTime:   page.UpdatedTime,
		VersionNo:     page.VersionNo,
		VersionTag:    page.VersionTag,
		PublishedTime: page.PublishedTime,
	}
	if page.FolderID > 0 {
		response.FolderID = encodeExternalWikiID(page.FolderID)
	}
	if includeBody {
		response.Body = page.Body
		response.BodyFormat = page.BodyFormat
	}
	return response
}

func encodeExternalWikiID(id int64) string {
	if id <= 0 {
		return ""
	}
	encoded, err := hashids.Encode(id)
	if err != nil {
		return ""
	}
	return encoded
}

func externalWikiError(ctx *gin.Context, status int, message string) {
	ctx.AbortWithStatusJSON(status, ExternalWikiErrorResponse{
		ErrorCode: status,
		ErrorMsg:  message,
	})
}

func externalWikiInternalError(ctx *gin.Context, err error) {
	logger.Errorf(ctx.Request.Context(), "external Wiki read failed: %v", err)
	externalWikiError(ctx, http.StatusInternalServerError, "外部 Wiki 服务暂时不可用")
}
