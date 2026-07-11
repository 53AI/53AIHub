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
	mcpsvc "github.com/53AI/53AIHub/service/mcp"
	"github.com/53AI/53AIHub/service/rag"
	"github.com/gin-gonic/gin"
)

type LibraryRequest struct {
	Name        string                  `json:"name" binding:"required"`
	Description string                  `json:"description"`
	Icon        string                  `json:"icon"`
	SpaceID     int64                   `json:"space_id" binding:"required"`
	Permissions []*model.PermissionData `json:"permissions"`
	// 知识库可见性设置: 0=继承空间设置(默认), 1=公开可见, 2=私有不可见
	Visibility *int `json:"visibility,omitempty" example:"0"`
}

type LibrarySortRequest struct {
	Libraries []struct {
		ID   int64 `json:"id" binding:"required"`
		Sort int64 `json:"sort" binding:"required"`
	} `json:"libraries" binding:"required"`
}

// CreateLibrary godoc
// @Summary 创建知识库
// @Description 在指定空间中创建知识库
// @Tags 知识库管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body LibraryRequest true "知识库信息"
// @Success 200 {object} model.CommonResponse{data=model.Library}
// @Router /api/libraries [post]
func CreateLibrary(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	var req LibraryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 检查功能是否可用
	params := map[string]interface{}{
		"from": "library",
		"op":   "add",
	}
	_, err := service.IsFeatureAvailable(c, "knowledge_base", params)
	if err != nil {
		c.JSON(http.StatusForbidden, model.FeatureNotAvailableError.ToResponse(err))
		return
	}

	libraryService := mcpsvc.NewLibraryService()
	library, err := libraryService.CreateLibrary(c.Request.Context(), eid, userID, req.Name, req.Description, req.Icon, req.SpaceID, req.Visibility, req.Permissions)
	if err != nil {
		switch {
		case isPermissionRelatedError(err):
			c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(err))
		case strings.Contains(err.Error(), "无效"):
			c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		default:
			c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(err))
		}
		return
	}

	// 获取空间信息用于日志记录
	space, err := model.GetSpaceByID(eid, req.SpaceID)
	if err == nil {
		// 记录系统日志
		LogLibraryCreate(c, space.Name, library.Name)
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(library))
}

// GetLibraries godoc
// @Summary 获取知识库列表
// @Description 获取用户有权限的知识库列表
// @Tags 知识库管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param space_id query int false "空间ID"
// @Param status query int false "知识库状态" Enums(0,1)
// @Param offset query int false "偏移量" default(0)
// @Param limit query int false "限制条数(最大100)" default(20)
// @Param get_recently query int false "获取最近访问文件数量" default(5)
// @Param with_file_count query int false "是否返回未删除文件数量(0关闭,1开启；缓存加速，结果为最终一致)" default(0)
// @Success 200 {object} model.CommonResponse{data=[]model.Library}
// @Router /api/libraries [get]
func GetLibraries(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	// 检查功能是否可用
	params := map[string]interface{}{
		"from": "library",
	}
	_, err := service.IsFeatureAvailable(c, "knowledge_base", params)
	if err != nil {
		c.JSON(http.StatusForbidden, model.FeatureNotAvailableError.ToResponse(err))
		return
	}

	spaceIDStr := c.Query("space_id")
	var spaceID *int64
	if spaceIDStr != "" {
		if s, err := strconv.ParseInt(spaceIDStr, 10, 64); err == nil {
			spaceID = &s
		}
	}

	statusStr := c.Query("status")
	var status *int
	if statusStr != "" {
		if s, err := strconv.Atoi(statusStr); err == nil {
			status = &s
		}
	}

	name := c.Query("name")
	withFileCount := false
	withFileCountStr := c.DefaultQuery("with_file_count", "0")
	if v, parseErr := strconv.Atoi(withFileCountStr); parseErr == nil {
		withFileCount = v == 1
	} else {
		logger.Infof(c.Request.Context(), "GetLibraries: invalid with_file_count '%s', fallback to 0", withFileCountStr)
	}

	// 解析分页参数（非法输入回退默认并记录日志）
	offsetStr := c.DefaultQuery("offset", "0")
	limitStr := c.DefaultQuery("limit", "20")
	offset, err := strconv.Atoi(offsetStr)
	if err != nil {
		logger.Infof(c.Request.Context(), "GetLibraries: invalid offset '%s', fallback to 0", offsetStr)
		offset = 0
	}
	limit, err := strconv.Atoi(limitStr)
	if err != nil {
		logger.Infof(c.Request.Context(), "GetLibraries: invalid limit '%s', fallback to 20", limitStr)
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}
	if limit <= 0 || limit > 100 {
		limit = 20
	}

	// 前台用户视角：通过权限服务获取用户有权限的知识库
	lps := service.NewLibraryPermissionService(eid)
	_, libraries, err := lps.GetUserLibraries(userID, name, status, spaceID, offset, limit, withFileCount)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(err))
		return
	}

	getRecentlyStr, _ := strconv.Atoi(c.DefaultQuery("get_recently", "0"))
	domain := config.GetProtocol(c) + "://" + config.GetDomain(c)
	if libraries == nil {
		libraries = []model.Library{}
	}
	for i := range libraries {
		if icon := libraries[i].Icon; len(icon) > 0 && icon[0] == '/' {
			libraries[i].Icon = domain + icon
		}
		if getRecentlyStr > 0 {
			files, err := model.GetRecentlyFiles(eid, libraries[i].ID, getRecentlyStr)
			if err != nil {
				files = []model.File{}
			}
			libraries[i].Recent = files
		}
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(libraries))
}

// GetRecentlyLLibraries godoc
// @Summary 获取最近访问的知识库列表
// @Description 获取当前用户最近访问过的知识库列表
// @Tags 知识库管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse{data=[]model.Library}
// @Router /api/libraries/recently [get]
func GetRecentlyLLibraries(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	// 检查功能是否可用
	params := map[string]interface{}{
		"from": "library",
	}
	_, err := knowledgeBaseFeatureAvailable(c, "knowledge_base", params)
	if err != nil {
		c.JSON(http.StatusForbidden, model.FeatureNotAvailableError.ToResponse(err))
		return
	}

	// 获取用户有权限的知识库
	libraries, err := model.GetUserRecentLibraries(eid, userID, 5)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(err))
		return
	}

	domain := config.GetProtocol(c) + "://" + config.GetDomain(c)
	for i := range libraries {
		if icon := libraries[i].Icon; len(icon) > 0 && icon[0] == '/' {
			libraries[i].Icon = domain + icon
		}
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(libraries))
}

// GetLibrary godoc
// @Summary 获取知识库详情
// @Description 获取指定知识库的详细信息
// @Tags 知识库管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param library_id path int true "知识库ID"
// @Success 200 {object} model.CommonResponse{data=model.Library}
// @Router /api/libraries/{library_id} [get]
func GetLibrary(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	id := c.Param("library_id")
	if id == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("知识库ID不能为空")))
		return
	}

	libraryID, err := strconv.ParseInt(id, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的知识库ID")))
		return
	}

	// 检查功能是否可用
	params := map[string]interface{}{
		"from": "library",
	}
	_, featureErr := knowledgeBaseFeatureAvailable(c, "library", params)
	if featureErr != nil {
		c.JSON(http.StatusForbidden, model.FeatureNotAvailableError.ToResponse(featureErr))
		return
	}

	// 检查知识库可见性，暂时不要求
	// visible, err := service.IsLibraryVisible(eid, libraryID, userID)
	// if err != nil || !visible {
	// 	c.JSON(http.StatusNotFound, model.NotFound.ToResponse("知识库不存在或无权限访问"))
	// 	return
	// }

	// 先加载库，拿到 SpaceID
	library, err := model.GetLibraryByID(eid, libraryID)
	if err != nil || library == nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
		return
	}

	// 基于新KM权限进行读取校验（最小权限：仅查看）
	permission, _ := service.GetUserPermission(eid, model.RESOURCE_TYPE_LIBRARY, library.ID, userID)
	// if err != nil || permission < model.PERMISSION_VIEW_ONLY {
	// 	c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(err))
	// 	return
	// }

	library.Permission = permission

	domain := config.GetProtocol(c) + "://" + config.GetDomain(c)
	if icon := library.Icon; len(icon) > 0 && icon[0] == '/' {
		library.Icon = domain + icon
	}

	isFav, _ := model.IsFavorited(userID, model.RESOURCE_TYPE_LIBRARY, library.ID)
	library.IsFavorite = isFav

	if !library.IsPersonalLibrary() {
		go func() {
			_ = model.RecordBrowseHistory(eid, userID, library.ID, 0)
		}()
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(library))
}

// UpdateLibrary godoc
// @Summary 更新知识库信息
// @Description 更新知识库的基本信息
// @Tags 知识库管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param library_id path int true "知识库ID"
// @Param request body LibraryRequest true "知识库信息"
// @Success 200 {object} model.CommonResponse{data=model.Library}
// @Router /api/libraries/{library_id} [put]
func UpdateLibrary(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	id := c.Param("library_id")
	if id == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("知识库ID不能为空")))
		return
	}

	libraryID, err := strconv.ParseInt(id, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的知识库ID")))
		return
	}

	// 检查功能是否可用
	params := map[string]interface{}{
		"from": "library",
	}
	_, featureErr := service.IsFeatureAvailable(c, "library", params)
	if featureErr != nil {
		c.JSON(http.StatusForbidden, model.FeatureNotAvailableError.ToResponse(featureErr))
		return
	}

	// 检查"可编辑"权限
	permission, err := service.GetUserPermission(eid, model.RESOURCE_TYPE_LIBRARY, libraryID, userID)
	if err != nil || permission < model.PERMISSION_EDIT_KNOWLEDGE {
		c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(err))
		return
	}

	var req LibraryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	library, err := model.GetLibraryByID(eid, libraryID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
		return
	}

	// 保存原始数据用于日志记录
	oldLibrary := *library

	library.Name = req.Name
	library.Description = req.Description
	library.Icon = req.Icon

	// 如果请求中包含可见性设置，则更新可见性
	if req.Visibility != nil {
		// 验证可见性值是否合法
		if *req.Visibility < model.LIBRARY_VISIBILITY_INHERIT || *req.Visibility > model.LIBRARY_VISIBILITY_PRIVATE {
			c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的可见性设置")))
			return
		}
		library.Visibility = *req.Visibility
	}

	if err := library.Update(); err != nil {
		c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(err))
		return
	}

	// 记录变更日志
	fieldMap := map[string]string{
		"Name":        "名称",
		"Description": "描述",
		"Icon":        "图标",
		"SpaceID":     "所属空间",
	}
	model.LogEntityChange("知识库", model.SystemLogActionUpdate, eid, userID, config.GetUserNickname(c), model.SystemLogModuleLibrary, &oldLibrary, library, c.ClientIP(), fieldMap)

	c.JSON(http.StatusOK, model.Success.ToResponse(library))
}

// DeleteLibrary godoc
// @Summary 删除知识库
// @Description 删除指定的知识库
// @Tags 知识库管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param library_id path int true "知识库ID"
// @Success 200 {object} model.CommonResponse
// @Router /api/libraries/{library_id} [delete]
func DeleteLibrary(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	id := c.Param("library_id")
	if id == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("知识库ID不能为空")))
		return
	}

	libraryID, err := strconv.ParseInt(id, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的知识库ID")))
		return
	}

	// 检查功能是否可用
	params := map[string]interface{}{
		"from": "library",
	}
	_, featureErr := service.IsFeatureAvailable(c, "library", params)
	if featureErr != nil {
		c.JSON(http.StatusForbidden, model.FeatureNotAvailableError.ToResponse(featureErr))
		return
	}

	// 检查"可管理"权限
	permission, err := service.GetUserPermission(eid, model.RESOURCE_TYPE_LIBRARY, libraryID, userID)
	if err != nil || permission < model.PERMISSION_MANAGE {
		c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(err))
		return
	}

	// 获取知识库信息用于日志记录
	library, err := model.GetLibraryByID(eid, libraryID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
		return
	}

	// 获取空间信息用于日志记录
	space, _ := model.GetSpaceByID(eid, library.SpaceID)

	if err := model.DeleteLibrary(eid, libraryID); err != nil {
		c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(err))
		return
	}

	// 记录删除日志
	var spaceName string
	if space != nil {
		spaceName = space.Name
	}
	LogLibraryDelete(c, spaceName, library.Name)
	common.SetLibraryStop(libraryID)

	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}

// BatchUpdateLibrarySort godoc
// @Summary 批量更新知识库排序
// @Description 批量更新知识库的排序顺序
// @Tags 知识库管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body LibrarySortRequest true "知识库排序信息"
// @Success 200 {object} model.CommonResponse
// @Router /api/libraries/sort [post]
func BatchUpdateLibrarySort(c *gin.Context) {
	eid := config.GetEID(c)

	// 检查功能是否可用
	params := map[string]interface{}{
		"from": "library",
	}
	_, err := service.IsFeatureAvailable(c, "knowledge_base", params)
	if err != nil {
		c.JSON(http.StatusForbidden, model.FeatureNotAvailableError.ToResponse(err))
		return
	}

	var req LibrarySortRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	if err := model.BatchUpdateLibrarySort(eid, req.Libraries); err != nil {
		c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(err))
		return
	}

	// 记录批量排序日志
	LogLibraryBatchSort(c, len(req.Libraries))

	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}

// GetLibraryQueries godoc
// @Summary 获取知识库查询历史
// @Description 获取指定知识库的查询历史记录
// @Tags 知识库管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param library_id path int true "知识库ID"
// @Param page query int false "页码" default(1)
// @Param page_size query int false "每页数量" default(20)
// @Param search_type query string false "搜索类型过滤"
// @Param start_date query string false "开始日期"
// @Param end_date query string false "结束日期"
// @Success 200 {object} model.CommonResponse{data=LibraryQueriesResponse}
// @Router /api/libraries/{library_id}/queries [get]
func GetLibraryQueries(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	// 检查功能是否可用
	params := map[string]interface{}{
		"from": "library",
	}
	_, featureErr := service.IsFeatureAvailable(c, "library", params)
	if featureErr != nil {
		c.JSON(http.StatusForbidden, model.FeatureNotAvailableError.ToResponse(featureErr))
		return
	}

	// 解析路径参数
	libraryIDStr := c.Param("library_id")
	libraryID, err := strconv.ParseInt(libraryIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的知识库ID")))
		return
	}

	// 权限校验：最小查看权限
	permission, err := service.GetUserPermission(eid, model.RESOURCE_TYPE_LIBRARY, libraryID, userID)
	if err != nil || permission < model.PERMISSION_VIEW_ONLY {
		c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(err))
		return
	}

	// 解析查询参数（非法输入回退默认并记录日志）
	pageStr := c.DefaultQuery("page", "1")
	pageSizeStr := c.DefaultQuery("page_size", "20")
	page, err := strconv.Atoi(pageStr)
	if err != nil {
		logger.Infof(c.Request.Context(), "GetLibraryQueries: invalid page '%s', fallback to 1", pageStr)
		page = 1
	}
	pageSize, err := strconv.Atoi(pageSizeStr)
	if err != nil {
		logger.Infof(c.Request.Context(), "GetLibraryQueries: invalid page_size '%s', fallback to 20", pageSizeStr)
		pageSize = 20
	}
	searchType := c.Query("search_type")
	startDate := c.Query("start_date")
	endDate := c.Query("end_date")

	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 || pageSize > 100 {
		pageSize = 20
	}

	// 获取查询历史
	queries, total, err := model.GetLibraryQueries(eid, libraryID, page, pageSize, searchType, startDate, endDate)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	response := LibraryQueriesResponse{
		Queries:  queries,
		Total:    total,
		Page:     int64(page),
		PageSize: int64(pageSize),
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(response))
}

// LibraryQueriesResponse 查询历史响应
type LibraryQueriesResponse struct {
	Queries  []model.LibraryQueryWithUser `json:"queries"`
	Total    int64                        `json:"total"`
	Page     int64                        `json:"page"`
	PageSize int64                        `json:"page_size"`
}

// LibrarySearchRequest 知识库搜索请求
type LibrarySearchRequest struct {
	Query        string                  `json:"query" binding:"required" example:"人工智能的发展"`
	SearchConfig *model.SearchConfigData `json:"search_config,omitempty"` // 可选的搜索配置覆盖
}

// LibrarySearchResponse 知识库搜索响应
type LibrarySearchResponse struct {
	Results []rag.SearchResultItem `json:"results"`
	Total   int                    `json:"total"`
	Time    int64                  `json:"time_ms"`
	Type    string                 `json:"search_type"` // 实际使用的搜索类型
	QueryID *int64                 `json:"query_id,omitempty"`
}

// LibrarySearch godoc
// @Summary 在指定知识库中搜索
// @Description 根据查询和可选的搜索配置，在指定知识库中进行搜索和重排
// @Tags 知识库管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param library_id path int true "知识库ID"
// @Param request body LibrarySearchRequest true "搜索请求"
// @Success 200 {object} model.CommonResponse{data=LibrarySearchResponse} "搜索成功"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 403 {object} model.CommonResponse "无权限"
// @Failure 404 {object} model.CommonResponse "知识库不存在"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/libraries/{library_id}/search [post]
func LibrarySearch(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	libraryIDStr := c.Param("library_id")
	libraryID, err := strconv.ParseInt(libraryIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的知识库ID")))
		return
	}

	var req LibrarySearchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 检查功能是否可用
	params := map[string]interface{}{
		"from": "library",
	}
	_, featureErr := service.IsFeatureAvailable(c, "library", params)
	if featureErr != nil {
		c.JSON(http.StatusForbidden, model.FeatureNotAvailableError.ToResponse(featureErr))
		return
	}

	permission, err := service.GetUserPermission(eid, model.RESOURCE_TYPE_LIBRARY, libraryID, userID)
	if err != nil || permission < model.PERMISSION_VIEW_ONLY {
		c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(err))
		return
	}

	// 确认库存在
	library, err := model.GetLibraryByID(eid, libraryID)
	if err != nil || library == nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
		return
	}

	// 使用新的知识库搜索服务
	searchService := rag.NewLibrarySearchService(model.DB)

	// 日志输出当前使用的 embedding 模型
	if cfg, err := rag.NewChunkConfigService(model.DB).GetConfig(eid, &libraryID, model.ChunkTypeDefault); err == nil && cfg != nil {
		modelName := "nil"
		if cfg.EmbeddingModelName != nil {
			modelName = *cfg.EmbeddingModelName
		}
		channelID := int64(0)
		if cfg.EmbeddingChannelID != nil {
			channelID = *cfg.EmbeddingChannelID
		}
		logger.Infof(c.Request.Context(), "[LibrarySearch][eid=%d][library=%d] embedding model: channel=%d, model=%s", eid, libraryID, channelID, modelName)
	} else if err != nil {
		logger.Warnf(c.Request.Context(), "[LibrarySearch][eid=%d][library=%d] 获取 embedding 配置失败: %v", eid, libraryID, err)
	}

	searchParams := &rag.LibrarySearchParams{
		EID:          eid,
		UserID:       userID,
		LibraryID:    libraryID,
		Query:        req.Query,
		SearchConfig: req.SearchConfig,
	}

	searchResult, err := searchService.Search(c.Request.Context(), searchParams)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	// 直接使用 rag.SearchResultItem，避免重复定义
	response := LibrarySearchResponse{
		Results: searchResult.Results,
		Total:   searchResult.Total,
		Time:    searchResult.Time,
		Type:    searchResult.Type,
		QueryID: searchResult.QueryID,
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(response))
}

// getSearchType 根据SearchConfigData确定搜索类型
func getSearchType(config *model.SearchConfigData) string {
	if config.Hybrid {
		return "hybrid"
	} else if config.Vector && !config.Fulltext {
		return "vector"
	} else if !config.Vector && config.Fulltext {
		return "fulltext"
	}
	return "hybrid" // 默认
}

// SearchLibrariesByName godoc
// @Summary 根据名称搜索知识库
// @Description 跨空间搜索用户有权限的知识库，支持名称模糊匹配，name为空时返回所有
// @Tags 知识库管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param name query string false "知识库名称(支持模糊匹配)，为空时返回所有"
// @Success 200 {object} model.CommonResponse{data=[]model.Library}
// @Router /api/libraries/search [get]
func SearchLibrariesByName(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	// 检查功能是否可用
	params := map[string]interface{}{
		"from": "library",
	}
	_, err := service.IsFeatureAvailable(c, "knowledge_base", params)
	if err != nil {
		c.JSON(http.StatusForbidden, model.FeatureNotAvailableError.ToResponse(err))
		return
	}

	name := c.Query("name")

	// 使用空间权限服务进行搜索
	sps := service.NewSpacePermissionService(eid)
	libraries, err := sps.SearchLibrariesByName(userID, name)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(err))
		return
	}

	// 处理图标URL
	domain := config.GetProtocol(c) + "://" + config.GetDomain(c)
	for i := range libraries {
		if icon := libraries[i].Icon; len(icon) > 0 && icon[0] == '/' {
			libraries[i].Icon = domain + icon
		}
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(libraries))
}
