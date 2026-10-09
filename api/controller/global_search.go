package controller

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/common/utils/helper"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/53AI/53AIHub/service/elasticsearch"
	mcpsvc "github.com/53AI/53AIHub/service/mcp"
	"github.com/gin-gonic/gin"
)

// GlobalSearchRequest 全局复合检索请求
// @Description 全局高级检索请求参数
type GlobalSearchRequest struct {
	Sources         []string                 `json:"sources"`
	Query           string                   `json:"query" example:"报告"`                        // 搜索关键词（可选，与其他条件至少提供一个）
	SpaceIDs        []string                 `json:"space_ids" example:"abc123,def456"`         // 空间ID列表（支持hashId）
	LibraryIDs      []string                 `json:"library_ids" example:"lib001,lib002"`       // 知识库ID列表（支持hashId）
	CreatorIDs      []int64                  `json:"creator_ids" example:"1,2"`                 // 创建人ID列表
	IsCreatedByMe   *bool                    `json:"is_created_by_me" example:"true"`           // 是否只看"我创建的"
	FileTypes       []string                 `json:"file_types" example:"pdf,word"`             // 文件类型：pdf/markdown/word/excel/powerpoint/webpage/audio
	CreatedTimeFrom *int64                   `json:"created_time_from" example:"1750000000000"` // 创建时间范围起始（Unix毫秒）
	CreatedTimeTo   *int64                   `json:"created_time_to" example:"1760000000000"`   // 创建时间范围结束（Unix毫秒）
	UpdatedTimeFrom *int64                   `json:"updated_time_from" example:"1750000000000"` // 更新时间范围起始（Unix毫秒）
	UpdatedTimeTo   *int64                   `json:"updated_time_to" example:"1760000000000"`   // 更新时间范围结束（Unix毫秒）
	SortBy          string                   `json:"sort_by" example:"recent_update"`           // 排序方式：recent_update（默认）/ recent_access
	Page            int                      `json:"page" example:"1"`                          // 页码（从1开始）
	Size            int                      `json:"size" example:"20"`                         // 每页条数（默认20，最大100）
	RAG             *GlobalRAGSearchRequest  `json:"rag,omitempty"`
	Wiki            *GlobalWikiSearchRequest `json:"wiki,omitempty"`
}

type GlobalRAGSearchRequest struct {
	SpaceIDs        []string `json:"space_ids"`
	LibraryIDs      []string `json:"library_ids"`
	CreatorIDs      []int64  `json:"creator_ids"`
	IsCreatedByMe   *bool    `json:"is_created_by_me"`
	FileTypes       []string `json:"file_types"`
	CreatedTimeFrom *int64   `json:"created_time_from"`
	CreatedTimeTo   *int64   `json:"created_time_to"`
	UpdatedTimeFrom *int64   `json:"updated_time_from"`
	UpdatedTimeTo   *int64   `json:"updated_time_to"`
	SortBy          string   `json:"sort_by"`
	Page            int      `json:"page"`
	Size            int      `json:"size"`
}

type GlobalWikiSearchRequest struct {
	SpaceIDs        []string `json:"space_ids"`
	LibraryIDs      []string `json:"library_ids"`
	CategoryIDs     []string `json:"category_ids"`
	CategoryOther   bool     `json:"category_other"`
	CreatedTimeFrom *int64   `json:"created_time_from"`
	CreatedTimeTo   *int64   `json:"created_time_to"`
	UpdatedTimeFrom *int64   `json:"updated_time_from"`
	UpdatedTimeTo   *int64   `json:"updated_time_to"`
	SortBy          string   `json:"sort_by"`
	Page            int      `json:"page"`
	Size            int      `json:"size"`
}

// GlobalSearchResponse 全局复合检索响应
// @Description 全局高级检索响应结果
type GlobalSearchResponse struct {
	Results     []elasticsearch.FileNameSearchResult `json:"results"` // 搜索结果列表
	Total       int64                                `json:"total"`   // 总记录数
	Page        int                                  `json:"page"`    // 当前页码
	Size        int                                  `json:"size"`    // 每页条数
	RAGResults  *GlobalRAGSearchResponse             `json:"rag_results,omitempty"`
	WikiResults *GlobalWikiSearchResponse            `json:"wiki_results,omitempty"`
}

type GlobalRAGSearchResponse struct {
	Items []elasticsearch.FileNameSearchResult `json:"items"`
	Total int64                                `json:"total"`
	Page  int                                  `json:"page"`
	Size  int                                  `json:"size"`
}

type GlobalWikiSearchResponse struct {
	Items []elasticsearch.WikiSearchResult `json:"items"`
	Total int64                            `json:"total"`
	Page  int                              `json:"page"`
	Size  int                              `json:"size"`
}

// QuickTagsResponse 快捷标签响应
// @Description 用户最近访问的空间和知识库列表
type QuickTagsResponse struct {
	Spaces    []model.Space   `json:"spaces"`    // 最近访问的空间（最多10个）
	Libraries []model.Library `json:"libraries"` // 最近访问的知识库（最多10个）
}

var fileTypeToExtensions = map[string][]string{
	"pdf":        {".pdf"},
	"markdown":   {".md", ".markdown"},
	"md":         {".md", ".markdown"},
	"word":       {".doc", ".docx"},
	"excel":      {".xls", ".xlsx", ".csv"},
	"powerpoint": {".ppt", ".pptx"},
	"webpage":    {".html", ".htm", ".xhtml"},
	"audio":      {".mp3", ".wav", ".m4a", ".aac", ".ogg", ".wma", ".flac", ".aiff", ".amr", ".opus", ".ape"},
	"txt":        {".txt"},
	"epub":       {".epub"},
	"image":      {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"},
	"json":       {".json"},
	"xml":        {".xml"},
}

func resolveFileExtensions(fileTypes []string) []string {
	if len(fileTypes) == 0 {
		return nil
	}
	extSet := make(map[string]bool)
	for _, ft := range fileTypes {
		if exts, ok := fileTypeToExtensions[ft]; ok {
			for _, ext := range exts {
				extSet[ext] = true
			}
		} else {
			ext := ft
			if !strings.HasPrefix(ext, ".") {
				ext = "." + ext
			}
			extSet[ext] = true
		}
	}
	exts := make([]string, 0, len(extSet))
	for ext := range extSet {
		exts = append(exts, ext)
	}
	return exts
}

func filterAccessibleLibraryIDs(userID int64, eid int64, libraryIDs []int64) ([]int64, error) {
	var libraries []model.Library
	query := model.DB.Where("eid = ?", eid)
	if len(libraryIDs) > 0 {
		query = query.Where("id IN ?", libraryIDs)
	}
	if err := query.Find(&libraries).Error; err != nil {
		return nil, err
	}

	resolver, err := common.NewPermissionResolver(eid, userID)
	if err != nil {
		return nil, err
	}

	accessible := make([]int64, 0, len(libraries))
	for _, library := range libraries {
		if library.LibraryKind != model.LIBRARY_KIND_REGULAR {
			continue
		}
		permission, err := resolver.GetPermission(model.RESOURCE_TYPE_LIBRARY, library.ID)
		if err != nil {
			return nil, err
		}
		if permission > model.PERMISSION_NONE {
			accessible = append(accessible, library.ID)
		}
	}
	return accessible, nil
}

func resolveLibraryIDsBySpaceIDs(spaceIDs []int64) []int64 {
	if len(spaceIDs) == 0 {
		return nil
	}
	var libraryIDs []int64
	model.DB.Model(&model.Library{}).
		Where("space_id IN ?", spaceIDs).
		Pluck("id", &libraryIDs)
	return libraryIDs
}

func decodeIDs(ids []string) []int64 {
	if len(ids) == 0 {
		return nil
	}
	result := make([]int64, 0, len(ids))
	for _, idStr := range ids {
		id, err := hashids.TryParseID(idStr)
		if err != nil {
			continue
		}
		result = append(result, id)
	}
	return result
}

// GetQuickTags 获取用户最近常用的空间和知识库标签
// @Summary 获取快捷标签
// @Description 返回当前用户最近访问或最近有更新的空间和知识库列表
// @Tags 全局检索
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param mode query string false "模式：recent_access（默认）或 recent_update"
// @Success 200 {object} model.CommonResponse{data=QuickTagsResponse}
// @Router /api/global-search/quick-tags [get]
func GetQuickTags(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)
	mode := c.DefaultQuery("mode", "recent_access")

	var libraries []model.Library
	var err error

	if mode == "recent_update" {
		libraries, err = model.GetRecentlyUpdatedLibraries(eid, 10)
	} else {
		libraries, err = model.GetUserRecentLibraries(eid, userID, 10)
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	// 过滤个人知识库
	var filteredRecentLibs []model.Library
	for _, lib := range libraries {
		if !lib.IsPersonalLibrary() {
			filteredRecentLibs = append(filteredRecentLibs, lib)
		}
	}
	libraries = filteredRecentLibs

	spSvc := service.NewSpacePermissionService(eid)
	_, accessibleSpaces, err := spSvc.GetUserSpaces(userID, 0, "", nil, 0, 0, 0, 0, 0, 100)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}
	accessibleSpaceMap := make(map[int64]model.Space)
	for _, s := range accessibleSpaces {
		if !s.IsPersonalSpace() {
			accessibleSpaceMap[s.ID] = s
		}
	}

	var recentSpaces []model.Space
	seen := make(map[int64]bool)
	for _, lib := range libraries {
		if seen[lib.SpaceID] {
			continue
		}
		seen[lib.SpaceID] = true
		if space, ok := accessibleSpaceMap[lib.SpaceID]; ok {
			recentSpaces = append(recentSpaces, space)
		}
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(QuickTagsResponse{
		Spaces:    recentSpaces,
		Libraries: libraries,
	}))
}

// GlobalSearch 全局复合检索
// @Summary 全局复合检索
// @Description 按来源分别执行 RAG 文件和 Wiki 动态知识检索；来源内部的筛选条件组合查询
// @Tags 全局检索
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body controller.GlobalSearchRequest true "搜索请求参数"
// @Success 200 {object} model.CommonResponse{data=GlobalSearchResponse}
// @Failure 400 {object} model.CommonResponse
// @Failure 401 {object} model.CommonResponse
// @Failure 500 {object} model.CommonResponse
// @Router /api/global-search/search [post]
func normalizeGlobalSearchSources(raw []string) ([]string, error) {
	if len(raw) == 0 {
		return []string{"rag"}, nil
	}
	seen := make(map[string]struct{}, len(raw))
	sources := make([]string, 0, len(raw))
	for _, rawSource := range raw {
		source := strings.ToLower(strings.TrimSpace(rawSource))
		if source != "rag" && source != "wiki" {
			return nil, errors.New("sources only supports rag and wiki")
		}
		if _, ok := seen[source]; ok {
			continue
		}
		seen[source] = struct{}{}
		sources = append(sources, source)
	}
	return sources, nil
}

func mergeGlobalRAGRequest(req GlobalSearchRequest) GlobalSearchRequest {
	if req.RAG == nil {
		return req
	}
	filter := req.RAG
	if len(filter.SpaceIDs) > 0 {
		req.SpaceIDs = filter.SpaceIDs
	}
	if len(filter.LibraryIDs) > 0 {
		req.LibraryIDs = filter.LibraryIDs
	}
	if len(filter.CreatorIDs) > 0 {
		req.CreatorIDs = filter.CreatorIDs
	}
	if filter.IsCreatedByMe != nil {
		req.IsCreatedByMe = filter.IsCreatedByMe
	}
	if len(filter.FileTypes) > 0 {
		req.FileTypes = filter.FileTypes
	}
	if filter.CreatedTimeFrom != nil {
		req.CreatedTimeFrom = filter.CreatedTimeFrom
	}
	if filter.CreatedTimeTo != nil {
		req.CreatedTimeTo = filter.CreatedTimeTo
	}
	if filter.UpdatedTimeFrom != nil {
		req.UpdatedTimeFrom = filter.UpdatedTimeFrom
	}
	if filter.UpdatedTimeTo != nil {
		req.UpdatedTimeTo = filter.UpdatedTimeTo
	}
	if filter.SortBy != "" {
		req.SortBy = filter.SortBy
	}
	if filter.Page > 0 {
		req.Page = filter.Page
	}
	if filter.Size > 0 {
		req.Size = filter.Size
	}
	return req
}
func normalizeRelativeTime(t *int64, now int64) *int64 {
	if t == nil {
		return nil
	}
	if *t < 0 {
		val := now + *t
		return &val
	}
	return t
}

func normalizeInt64RelativeTime(val int64, now int64) int64 {
	if val < 0 {
		return now + val
	}
	return val
}

func normalizeSearchTimes(req *GlobalSearchRequest) {
	if req == nil {
		return
	}
	now := time.Now().UnixMilli()
	req.CreatedTimeFrom = normalizeRelativeTime(req.CreatedTimeFrom, now)
	req.CreatedTimeTo = normalizeRelativeTime(req.CreatedTimeTo, now)
	req.UpdatedTimeFrom = normalizeRelativeTime(req.UpdatedTimeFrom, now)
	req.UpdatedTimeTo = normalizeRelativeTime(req.UpdatedTimeTo, now)

	if req.RAG != nil {
		req.RAG.CreatedTimeFrom = normalizeRelativeTime(req.RAG.CreatedTimeFrom, now)
		req.RAG.CreatedTimeTo = normalizeRelativeTime(req.RAG.CreatedTimeTo, now)
		req.RAG.UpdatedTimeFrom = normalizeRelativeTime(req.RAG.UpdatedTimeFrom, now)
		req.RAG.UpdatedTimeTo = normalizeRelativeTime(req.RAG.UpdatedTimeTo, now)
	}

	if req.Wiki != nil {
		req.Wiki.CreatedTimeFrom = normalizeRelativeTime(req.Wiki.CreatedTimeFrom, now)
		req.Wiki.CreatedTimeTo = normalizeRelativeTime(req.Wiki.CreatedTimeTo, now)
		req.Wiki.UpdatedTimeFrom = normalizeRelativeTime(req.Wiki.UpdatedTimeFrom, now)
		req.Wiki.UpdatedTimeTo = normalizeRelativeTime(req.Wiki.UpdatedTimeTo, now)
	}
}

func mergeGlobalWikiRequest(req GlobalSearchRequest) *GlobalWikiSearchRequest {
	wiki := req.Wiki
	if wiki == nil {
		wiki = &GlobalWikiSearchRequest{}
	} else {
		cloned := *wiki
		wiki = &cloned
	}
	if len(wiki.SpaceIDs) == 0 {
		wiki.SpaceIDs = req.SpaceIDs
	}
	if len(wiki.LibraryIDs) == 0 {
		wiki.LibraryIDs = req.LibraryIDs
	}
	if wiki.CreatedTimeFrom == nil {
		wiki.CreatedTimeFrom = req.CreatedTimeFrom
	}
	if wiki.CreatedTimeTo == nil {
		wiki.CreatedTimeTo = req.CreatedTimeTo
	}
	if wiki.UpdatedTimeFrom == nil {
		wiki.UpdatedTimeFrom = req.UpdatedTimeFrom
	}
	if wiki.UpdatedTimeTo == nil {
		wiki.UpdatedTimeTo = req.UpdatedTimeTo
	}
	if wiki.SortBy == "" {
		wiki.SortBy = req.SortBy
	}
	if wiki.Page <= 0 {
		wiki.Page = req.Page
	}
	if wiki.Size <= 0 {
		wiki.Size = req.Size
	}
	return wiki
}

func hasGlobalSearchCondition(req GlobalSearchRequest) bool {
	if req.Query != "" || len(req.SpaceIDs) > 0 || len(req.LibraryIDs) > 0 || len(req.CreatorIDs) > 0 || len(req.FileTypes) > 0 || req.IsCreatedByMe != nil || req.CreatedTimeFrom != nil || req.CreatedTimeTo != nil || req.UpdatedTimeFrom != nil || req.UpdatedTimeTo != nil || req.SortBy != "" {
		return true
	}
	return req.Wiki != nil && (len(req.Wiki.SpaceIDs) > 0 || len(req.Wiki.LibraryIDs) > 0 || len(req.Wiki.CategoryIDs) > 0 || req.Wiki.CategoryOther || req.Wiki.CreatedTimeFrom != nil || req.Wiki.CreatedTimeTo != nil || req.Wiki.UpdatedTimeFrom != nil || req.Wiki.UpdatedTimeTo != nil)
}

func writeGlobalSearchError(c *gin.Context, err error) {
	if err == nil {
		return
	}
	if strings.Contains(err.Error(), "sources only supports") || strings.Contains(err.Error(), "at least one search condition") || strings.Contains(err.Error(), "query") {
		c.JSON(http.StatusBadRequest, model.ParamError.ToErrorResponse(err))
		return
	}
	c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
}

func GlobalSearch(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)
	requestStart := time.Now()
	var req GlobalSearchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToErrorResponse(err))
		return
	}
	sources, err := normalizeGlobalSearchSources(req.Sources)
	if err != nil {
		writeGlobalSearchError(c, err)
		return
	}
	normalizeSearchTimes(&req)
	if !hasGlobalSearchCondition(req) {
		writeGlobalSearchError(c, errors.New("at least one search condition is required"))
		return
	}

	response := GlobalSearchResponse{}
	for _, source := range sources {
		switch source {
		case "rag":
			ragRequest := mergeGlobalRAGRequest(req)
			ragResponse, searchErr := searchGlobalRAG(c, ragRequest)
			if searchErr != nil {
				writeGlobalSearchError(c, searchErr)
				return
			}
			page, size := normalizeSearchPage(ragRequest.Page, ragRequest.Size)
			response.Results = ragResponse.Results
			response.Total = ragResponse.Total
			response.Page = page
			response.Size = size
			response.RAGResults = &GlobalRAGSearchResponse{Items: ragResponse.Results, Total: ragResponse.Total, Page: page, Size: size}
		case "wiki":
			wikiRequest := mergeGlobalWikiRequest(req)
			wikiResponse, searchErr := searchGlobalWiki(c, req.Query, wikiRequest)
			if searchErr != nil {
				writeGlobalSearchError(c, searchErr)
				return
			}
			response.WikiResults = &GlobalWikiSearchResponse{Items: wikiResponse.Items, Total: wikiResponse.Total, Page: wikiResponse.Page, Size: wikiResponse.Size}
		}
	}
	logger.SysLogf("全局搜索完成: eid=%d, userID=%d, sources=%v, elapsed_ms=%d", eid, userID, sources, time.Since(requestStart).Milliseconds())
	c.JSON(http.StatusOK, model.Success.ToResponseWithRequestID(response, c.GetString(helper.RequestIdKey)))
}

func normalizeSearchPage(page, size int) (int, int) {
	if page <= 0 {
		page = 1
	}
	if size <= 0 {
		size = 20
	}
	if size > 100 {
		size = 100
	}
	return page, size
}

func searchGlobalWiki(c *gin.Context, query string, req *GlobalWikiSearchRequest) (*elasticsearch.WikiSearchPage, error) {
	spaceIDs := decodeIDs(req.SpaceIDs)
	libraryIDs := decodeIDs(req.LibraryIDs)
	categoryIDs := decodeIDs(req.CategoryIDs)
	return elasticsearch.NewWikiSearchService(elasticsearch.GetGlobalClient(), model.DB).SearchPage(c.Request.Context(), elasticsearch.WikiSearchRequest{
		Eid: config.GetEID(c), UserID: config.GetUserId(c), Query: query,
		SpaceIDs: spaceIDs, LibraryIDs: libraryIDs, CategoryIDs: categoryIDs,
		CategoryOther:   req.CategoryOther,
		CreatedTimeFrom: req.CreatedTimeFrom, CreatedTimeTo: req.CreatedTimeTo,
		UpdatedTimeFrom: req.UpdatedTimeFrom, UpdatedTimeTo: req.UpdatedTimeTo,
		SortBy: req.SortBy, Page: req.Page, Size: req.Size,
	})
}

func searchGlobalRAG(c *gin.Context, req GlobalSearchRequest) (*elasticsearch.FileNameSearchResponse, error) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)
	if err := elasticsearch.ValidateFileNameSearchQuery(req.Query); err != nil {
		return nil, err
	}
	if req.Page <= 0 {
		req.Page = 1
	}
	if req.Size <= 0 {
		req.Size = 20
	}
	if req.Size > 100 {
		req.Size = 100
	}
	creatorIDs := req.CreatorIDs
	if req.IsCreatedByMe != nil && *req.IsCreatedByMe {
		creatorIDs = append(creatorIDs, userID)
	}
	if !hasGlobalSearchCondition(req) {
		return nil, errors.New("at least one search condition is required")
	}
	now := time.Now().UnixMilli()
	req.CreatedTimeFrom = normalizeRelativeTime(req.CreatedTimeFrom, now)
	req.CreatedTimeTo = normalizeRelativeTime(req.CreatedTimeTo, now)
	req.UpdatedTimeFrom = normalizeRelativeTime(req.UpdatedTimeFrom, now)
	req.UpdatedTimeTo = normalizeRelativeTime(req.UpdatedTimeTo, now)
	fileExtensions := resolveFileExtensions(req.FileTypes)
	spaceIDs := decodeIDs(req.SpaceIDs)
	libraryIDs := decodeIDs(req.LibraryIDs)
	accessibleLibraryIDs := libraryIDs
	hasExplicitFilter := len(spaceIDs) > 0 || len(libraryIDs) > 0
	if len(spaceIDs) > 0 {
		spaceLibraryIDs := resolveLibraryIDsBySpaceIDs(spaceIDs)
		if len(accessibleLibraryIDs) == 0 {
			accessibleLibraryIDs = spaceLibraryIDs
		} else {
			libSet := make(map[int64]bool, len(accessibleLibraryIDs))
			for _, id := range accessibleLibraryIDs {
				libSet[id] = true
			}
			intersection := make([]int64, 0)
			for _, id := range spaceLibraryIDs {
				if libSet[id] {
					intersection = append(intersection, id)
				}
			}
			accessibleLibraryIDs = intersection
		}
	}
	if hasExplicitFilter && len(accessibleLibraryIDs) == 0 {
		return &elasticsearch.FileNameSearchResponse{Results: []elasticsearch.FileNameSearchResult{}, Query: req.Query, Source: "sql"}, nil
	}
	filteredLibraryIDs, err := filterAccessibleLibraryIDs(userID, eid, accessibleLibraryIDs)
	if err != nil {
		return nil, err
	}
	if len(filteredLibraryIDs) == 0 {
		return &elasticsearch.FileNameSearchResponse{Results: []elasticsearch.FileNameSearchResult{}, Query: req.Query, Source: "sql"}, nil
	}
	esClient := elasticsearch.GetGlobalClient()
	var resp *elasticsearch.FileNameSearchResponse
	if esClient == nil || esClient.IsDisabled() {
		resp, err = mcpsvc.NewSearchService(model.DB).SearchFileNames(c.Request.Context(), eid, userID, &mcpsvc.FileNameSearchRequest{Query: req.Query, LibraryIDs: filteredLibraryIDs, CreatorIDs: creatorIDs, FileExtensions: fileExtensions, TopK: req.Size, Page: req.Page, Size: req.Size, CreatedTimeFrom: req.CreatedTimeFrom, CreatedTimeTo: req.CreatedTimeTo, UpdatedTimeFrom: req.UpdatedTimeFrom, UpdatedTimeTo: req.UpdatedTimeTo, SortBy: req.SortBy})
		if err != nil {
			return nil, err
		}
		resp.Source = "sql"
	} else {
		esReq := &elasticsearch.FileNameSearchRequest{Query: req.Query, LibraryIDs: filteredLibraryIDs, CreatorIDs: creatorIDs, FileExtensions: fileExtensions, CreatedTimeFrom: req.CreatedTimeFrom, CreatedTimeTo: req.CreatedTimeTo, UpdatedTimeFrom: req.UpdatedTimeFrom, UpdatedTimeTo: req.UpdatedTimeTo, SortBy: req.SortBy, Page: req.Page, Size: req.Size}
		if req.SortBy == "recent_access" {
			resp, err = elasticsearch.NewFileNameSearchService(esClient, model.DB).SearchWithRecentAccessSort(eid, userID, esReq)
		} else {
			resp, err = elasticsearch.NewFileNameSearchService(esClient, model.DB).Search(eid, esReq)
		}
		if err != nil {
			return nil, err
		}
	}
	// 结果级文件权限：库级过滤（filterAccessibleLibraryIDs）之上，文件级显式 NONE 也剔除；
	// 回填实测权限值（含路径链继承，走 FILE resolver 缓存）。
	fillAndFilterFileNamePermission(c.Request.Context(), eid, userID, resp)
	return resp, nil
}

// fillAndFilterFileNamePermission 批量回填文件名搜索结果的实测文件权限，并过滤无权限（0）结果，
// 与 /files/all 语义一致（无查看权限不返回）。走 service.BatchGetUserPermissions（FILE resolver，
// 含路径链继承 + 用户/群组/权限缓存）。权限查询失败不阻断搜索（库级已过滤），保持原结果。
func fillAndFilterFileNamePermission(ctx context.Context, eid, userID int64, resp *elasticsearch.FileNameSearchResponse) {
	if resp == nil || len(resp.Results) == 0 || userID <= 0 {
		return
	}
	fileIDs := make([]int64, 0, len(resp.Results))
	for _, r := range resp.Results {
		if r.FileID > 0 {
			fileIDs = append(fileIDs, r.FileID)
		}
	}
	if len(fileIDs) == 0 {
		return
	}
	permissions, err := service.BatchGetUserPermissions(eid, model.RESOURCE_TYPE_FILE, fileIDs, userID, ctx)
	if err != nil {
		logger.SysWarnf("global-search file permission fill failed: eid=%d user=%d err=%v", eid, userID, err)
		return
	}
	kept := resp.Results[:0]
	for _, r := range resp.Results {
		r.Permission = permissions[r.FileID]
		if r.Permission != model.PERMISSION_NONE {
			kept = append(kept, r)
		}
	}
	resp.Results = kept
	// lazy: 分页下 Total 按过滤后当前结果近似（同 wiki pagelist）。
	resp.Total = int64(len(kept))
}

// SearchSpacesByName 搜索空间名称
// @Summary 搜索空间名称
// @Description 用于高级筛选器中的空间搜索框，模糊匹配用户有权限的空间名称
// @Tags 全局检索
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param keyword query string false "空间名称关键词"
// @Success 200 {object} model.CommonResponse{data=[]model.Space}
// @Failure 400 {object} model.CommonResponse
// @Router /api/global-search/spaces [get]
func SearchSpacesByName(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)
	keyword := c.Query("keyword")

	// 解析可选筛选参数
	var creatorIDs []int64
	if creatorIDsArr := c.QueryArray("creator_ids[]"); len(creatorIDsArr) > 0 {
		for _, s := range creatorIDsArr {
			if id, err := strconv.ParseInt(strings.TrimSpace(s), 10, 64); err == nil {
				creatorIDs = append(creatorIDs, id)
			}
		}
	} else if creatorIDsStr := c.Query("creator_ids"); creatorIDsStr != "" {
		for _, s := range strings.Split(creatorIDsStr, ",") {
			if id, err := strconv.ParseInt(strings.TrimSpace(s), 10, 64); err == nil {
				creatorIDs = append(creatorIDs, id)
			}
		}
	}
	if c.Query("is_created_by_me") == "true" {
		creatorIDs = append(creatorIDs, userID)
	}
	createdTimeFrom, _ := strconv.ParseInt(c.Query("created_time_from"), 10, 64)
	createdTimeTo, _ := strconv.ParseInt(c.Query("created_time_to"), 10, 64)
	updatedTimeFrom, _ := strconv.ParseInt(c.Query("updated_time_from"), 10, 64)
	updatedTimeTo, _ := strconv.ParseInt(c.Query("updated_time_to"), 10, 64)
	now := time.Now().UnixMilli()
	createdTimeFrom = normalizeInt64RelativeTime(createdTimeFrom, now)
	createdTimeTo = normalizeInt64RelativeTime(createdTimeTo, now)
	updatedTimeFrom = normalizeInt64RelativeTime(updatedTimeFrom, now)
	updatedTimeTo = normalizeInt64RelativeTime(updatedTimeTo, now)
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("size", "20"))
	if size > 100 {
		size = 100
	}
	if page <= 0 {
		page = 1
	}
	offset := (page - 1) * size

	spSvc := service.NewSpacePermissionService(eid)
	count, spaces, err := spSvc.GetUserSpaces(userID, 0, keyword, creatorIDs, createdTimeFrom, createdTimeTo, updatedTimeFrom, updatedTimeTo, offset, size)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(map[string]interface{}{
		"results": spaces,
		"total":   count,
		"page":    page,
		"size":    size,
	}))
}

// SearchGlobalLibrariesByName 搜索知识库名称（全局检索用）
// @Summary 搜索知识库名称
// @Description 用于高级筛选器中的知识库搜索框，模糊匹配用户有权限的知识库名称
// @Tags 全局检索
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param keyword query string false "知识库名称关键词"
// @Param space_id query int false "空间ID（可选，指定空间下搜索）"
// @Success 200 {object} model.CommonResponse{data=[]model.Library}
// @Failure 400 {object} model.CommonResponse
// @Router /api/global-search/libraries [get]
func SearchGlobalLibrariesByName(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)
	keyword := c.Query("keyword")
	// 解析 space_ids（数组参数 + 旧版 space_id 兼容），支持数字和 Hashid 格式
	var spaceIDStrs []string
	if arr := c.QueryArray("space_ids[]"); len(arr) > 0 {
		spaceIDStrs = append(spaceIDStrs, arr...)
	}
	if s := c.Query("space_id"); s != "" {
		spaceIDStrs = append(spaceIDStrs, s)
	}
	spaceIDs := decodeIDs(spaceIDStrs)

	// 解析可选筛选参数
	var creatorIDs []int64
	if creatorIDsArr := c.QueryArray("creator_ids[]"); len(creatorIDsArr) > 0 {
		for _, s := range creatorIDsArr {
			if id, err := strconv.ParseInt(strings.TrimSpace(s), 10, 64); err == nil {
				creatorIDs = append(creatorIDs, id)
			}
		}
	} else if creatorIDsStr := c.Query("creator_ids"); creatorIDsStr != "" {
		for _, s := range strings.Split(creatorIDsStr, ",") {
			if id, err := strconv.ParseInt(strings.TrimSpace(s), 10, 64); err == nil {
				creatorIDs = append(creatorIDs, id)
			}
		}
	}
	if c.Query("is_created_by_me") == "true" {
		creatorIDs = append(creatorIDs, userID)
	}
	createdTimeFrom, _ := strconv.ParseInt(c.Query("created_time_from"), 10, 64)
	createdTimeTo, _ := strconv.ParseInt(c.Query("created_time_to"), 10, 64)
	updatedTimeFrom, _ := strconv.ParseInt(c.Query("updated_time_from"), 10, 64)
	updatedTimeTo, _ := strconv.ParseInt(c.Query("updated_time_to"), 10, 64)
	now := time.Now().UnixMilli()
	createdTimeFrom = normalizeInt64RelativeTime(createdTimeFrom, now)
	createdTimeTo = normalizeInt64RelativeTime(createdTimeTo, now)
	updatedTimeFrom = normalizeInt64RelativeTime(updatedTimeFrom, now)
	updatedTimeTo = normalizeInt64RelativeTime(updatedTimeTo, now)
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("size", "20"))
	if size > 100 {
		size = 100
	}
	if page <= 0 {
		page = 1
	}
	offset := (page - 1) * size

	spSvc := service.NewSpacePermissionService(eid)
	libraries, totalCount, err := spSvc.SearchLibrariesByName(userID, keyword, spaceIDs, creatorIDs, createdTimeFrom, createdTimeTo, updatedTimeFrom, updatedTimeTo, offset, size)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	domain := config.GetProtocol(c) + "://" + config.GetDomain(c)
	for i := range libraries {
		if icon := libraries[i].Icon; len(icon) > 0 && icon[0] == '/' {
			libraries[i].Icon = domain + icon
		}
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(map[string]interface{}{
		"results": libraries,
		"total":   totalCount,
		"page":    page,
		"size":    size,
	}))
}
