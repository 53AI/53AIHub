package controller

import (
	"errors"
	"net/http"
	"path"
	"strings"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	mcpsvc "github.com/53AI/53AIHub/service/mcp"
	"github.com/gin-gonic/gin"
)

type MySpaceUploadListQuery struct {
	Path    string `form:"path"`
	Type    string `form:"type" binding:"required"`
	Keyword string `form:"keyword"`
	Offset  int    `form:"offset"`
	Limit   int    `form:"limit"`
}

type MySpaceUploadListResponse struct {
	Count int64        `json:"count"`
	Data  []model.File `json:"data"`
}

type MySpaceAIGeneratedListQuery struct {
	Path    string `form:"path"`
	Type    string `form:"type"`
	Keyword string `form:"keyword"`
	Offset  int    `form:"offset"`
	Limit   int    `form:"limit"`
}

type MySpaceAIGeneratedListResponse struct {
	Count int64        `json:"count"`
	Data  []model.File `json:"data"`
}

type MySpaceContextResponse struct {
	SpaceID     int64  `json:"space_id"`
	SpaceName   string `json:"space_name"`
	LibraryID   int64  `json:"library_id"`
	LibraryName string `json:"library_name"`
}

type CreateRecordingFolderRequest struct {
	Path string `json:"path" binding:"required"`
}

type RecordingFolderResponse struct {
	Folder *model.File `json:"folder"`
}

type RecordingListResponse struct {
	Count int64               `json:"count"`
	Data  []model.File        `json:"data"`
}

type RecordingListItem struct {
	ID           int64  `json:"id"`
	Name         string `json:"name"`
	Path         string `json:"path"`
	Type         int    `json:"type"`
	OriginType   string `json:"origin_type,omitempty"`
	OriginSource string `json:"origin_source,omitempty"`
	CreatedTime  int64  `json:"created_time"`
	UpdatedTime  int64  `json:"updated_time"`
	IsFavorite   bool   `json:"is_favorite"`
}

type RecordingImportBatchResponse struct {
	BatchID        string                      `json:"batch_id"`
	UploadToken    string                      `json:"upload_token"`
	MaxConcurrent  int                         `json:"max_concurrent"`
	ChunkSize      int64                       `json:"chunk_size"`
	FileMappings   map[string]string           `json:"file_mappings"`
	DuplicateFiles []service.DuplicateFileInfo `json:"duplicate_files"`
}

// GetMySpaceUploads godoc
// @Summary 获取我上传的文件列表
// @Description 按当前用户的个人空间返回“我上传的”文件或文件夹列表，支持按 type 拆分查询
// @Tags 我的空间
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param path query string false "父路径，默认根目录"
// @Param type query string true "类型(dir/file)"
// @Param keyword query string false "文件夹或文件名关键词，存在时按个人库全局模糊查询"
// @Param offset query int false "偏移量" default(0)
// @Param limit query int false "每页条数" default(30)
// @Success 200 {object} model.CommonResponse{data=controller.MySpaceUploadListResponse}
// @Failure 400 {object} model.CommonResponse
// @Failure 500 {object} model.CommonResponse
// @Router /api/my-space/uploads [get]
func GetMySpaceUploads(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	var req MySpaceUploadListQuery
	if err := c.ShouldBindQuery(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	if rejectLegacyPageParam(c) {
		return
	}

	fileType, err := parseFileTypeFilter(req.Type)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	if req.Offset < 0 {
		req.Offset = 0
	}
	if req.Limit <= 0 {
		req.Limit = 30
	}
	if req.Limit > 200 {
		req.Limit = 200
	}

	svc := service.NewMySpaceUploadService(eid)
	entries, total, err := svc.ListEntries(c.Request.Context(), userID, req.Path, fileType, req.Keyword, req.Offset, req.Limit)
	if err != nil {
		logger.SysErrorf("【我的空间】获取我上传的列表失败: eid=%d user_id=%d path=%s type=%s err=%v", eid, userID, req.Path, req.Type, err)
		if errors.Is(err, service.ErrPersonalWorkspaceInitializing) {
			c.JSON(http.StatusTooManyRequests, model.OperateTooFast.ToResponse(err))
			return
		}
		c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(err))
		return
	}
	if entries == nil {
		entries = []model.File{}
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(MySpaceUploadListResponse{
		Count: total,
		Data:  entries,
	}))
}

// GetMySpaceAIGenerated godoc
// @Summary 获取AI生成的文件列表
// @Description 按当前用户的个人空间返回 AI 生成的文件列表。无 keyword 时默认返回 /ai-generated 的目录树节点，带 path/type 时可按目录浏览，带 keyword 时保留旧的 AI 文件关键词搜索能力。
// @Tags 我的空间
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param path query string false "父路径，默认 /ai-generated"
// @Param type query string false "类型(dir/file)，不传时返回当前目录下的目录和文件"
// @Param keyword query string false "文件名关键词，存在时在 AI 生成结果范围内模糊搜索"
// @Param offset query int false "偏移量" default(0)
// @Param limit query int false "每页条数" default(30)
// @Success 200 {object} model.CommonResponse{data=controller.MySpaceAIGeneratedListResponse}
// @Failure 500 {object} model.CommonResponse
// @Router /api/my-space/ai-generated [get]
func GetMySpaceAIGenerated(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	var req MySpaceAIGeneratedListQuery
	if err := c.ShouldBindQuery(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	if rejectLegacyPageParam(c) {
		return
	}

	if req.Offset < 0 {
		req.Offset = 0
	}
	if req.Limit <= 0 {
		req.Limit = 30
	}
	if req.Limit > 200 {
		req.Limit = 200
	}

	svc := service.NewMySpaceAIService(eid)
	keyword := strings.TrimSpace(req.Keyword)
	pathValue := strings.TrimSpace(req.Path)
	typeValue := strings.TrimSpace(req.Type)

	if keyword != "" && pathValue == "" && typeValue == "" {
		entries, total, err := svc.ListEntries(c.Request.Context(), userID, keyword, req.Offset, req.Limit)
		if err != nil {
			logger.SysErrorf("【我的空间】获取AI生成的列表失败: eid=%d user_id=%d keyword=%s err=%v", eid, userID, req.Keyword, err)
			if errors.Is(err, service.ErrPersonalWorkspaceInitializing) {
				c.JSON(http.StatusTooManyRequests, model.OperateTooFast.ToResponse(err))
				return
			}
			c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(err))
			return
		}
		if entries == nil {
			entries = []model.File{}
		}

		c.JSON(http.StatusOK, model.Success.ToResponse(MySpaceAIGeneratedListResponse{
			Count: total,
			Data:  entries,
		}))
		return
	}

	if pathValue == "" {
		pathValue = "/ai-generated"
	}

	var typeFilter *int
	if typeValue != "" {
		var parseErr error
		typeFilter, parseErr = parseFileTypeFilter(typeValue)
		if parseErr != nil {
			c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(parseErr))
			return
		}
	}

	entries, total, listErr := svc.ListEntriesByPath(c.Request.Context(), userID, pathValue, typeFilter, keyword, req.Offset, req.Limit)
	if listErr != nil {
		logger.SysErrorf("【我的空间】获取AI生成的列表失败: eid=%d user_id=%d path=%s type=%s keyword=%s err=%v", eid, userID, pathValue, typeValue, req.Keyword, listErr)
		if errors.Is(listErr, service.ErrPersonalWorkspaceInitializing) {
			c.JSON(http.StatusTooManyRequests, model.OperateTooFast.ToResponse(listErr))
			return
		}
		c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(listErr))
		return
	}
	if entries == nil {
		entries = []model.File{}
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(MySpaceAIGeneratedListResponse{
		Count: total,
		Data:  entries,
	}))
}

// GetMySpaceContext godoc
// @Summary 获取我的空间上下文
// @Description 获取当前用户的个人空间和个人知识库信息，用于“我上传的”写入侧初始化
// @Tags 我的空间
// @Accept json
// @Produce json
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse{data=controller.MySpaceContextResponse}
// @Failure 429 {object} model.CommonResponse
// @Failure 500 {object} model.CommonResponse
// @Router /api/my-space/context [get]
func GetMySpaceContext(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	svc := service.NewPersonalSpaceService(eid)
	space, library, err := svc.EnsurePersonalWorkspace(c.Request.Context(), userID)
	if err != nil {
		logger.SysErrorf("【我的空间】获取个人空间上下文失败: eid=%d user_id=%d err=%v", eid, userID, err)
		if errors.Is(err, service.ErrPersonalWorkspaceInitializing) {
			c.JSON(http.StatusTooManyRequests, model.OperateTooFast.ToResponse(err))
			return
		}
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(MySpaceContextResponse{
		SpaceID:     space.ID,
		SpaceName:   space.Name,
		LibraryID:   library.ID,
		LibraryName: library.Name,
	}))
}

// GetMySpaceRecently godoc
// @Summary 获取最近访问（统一结构）
// @Description 返回当前用户最近访问过的文件/知识库单列表，结构与 /api/files/recently 保持一致；新路由优先用于前端新迭代。
// @Tags 我的空间
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param resource_type query int false "资源类型筛选，仅支持 1（知识库）或 2（文件）"
// @Param offset query int false "偏移量" default(0)
// @Param limit query int false "每页数量" default(20)
// @Param keyword query string false "当前 Tab 内关键词搜索"
// @Success 200 {object} model.CommonResponse{data=controller.RecentAccessListResponse}
// @Router /api/my-space/recently [get]
func GetMySpaceRecently(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	var req favoritesListQuery
	if err := c.ShouldBindQuery(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	if rejectLegacyPageParam(c) {
		return
	}

	resourceTypeFilter, err := parseTabResourceType(req.ResourceType)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	req.Offset, req.Limit = normalizeTabOffsetLimit(req.Offset, req.Limit, 20, 100)

	var items []recentAccessItem
	if strings.TrimSpace(req.Keyword) == "" {
		items, err = loadRecentAccessItemsPaged(eid, userID, 0, resourceTypeFilter, req.Offset, req.Limit)
	} else {
		items, err = loadRecentAccessItemsByKeyword(eid, userID, 0, resourceTypeFilter, req.Keyword, req.Offset, req.Limit)
	}
	if err != nil {
		logger.SysErrorf("【我的空间】获取最近访问列表失败: eid=%d user_id=%d keyword=%s err=%v", eid, userID, req.Keyword, err)
		if errors.Is(err, service.ErrPersonalWorkspaceInitializing) {
			c.JSON(http.StatusTooManyRequests, model.OperateTooFast.ToResponse(err))
			return
		}
		c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(err))
		return
	}

	if err := markRecentAccessFavoriteState(userID, items); err != nil {
		logger.SysErrorf("【我的空间】标记最近访问收藏状态失败: eid=%d user_id=%d err=%v", eid, userID, err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(toRecentAccessResponse(items)))
}

// CreateMySpaceRecordingFolder godoc
// @Summary 创建我的录音文件夹
// @Description 在当前用户的个人知识库中创建录音相关文件夹，并标记为录音来源
// @Tags 我的录音
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body controller.CreateRecordingFolderRequest true "录音文件夹创建请求"
// @Success 200 {object} model.CommonResponse{data=controller.RecordingFolderResponse}
// @Failure 400 {object} model.CommonResponse
// @Failure 404 {object} model.CommonResponse
// @Failure 500 {object} model.CommonResponse
// @Router /api/my-space/recordings/folders [post]
func CreateMySpaceRecordingFolder(c *gin.Context) {
	var req CreateRecordingFolderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	eid := config.GetEID(c)
	userID := config.GetUserId(c)
	spaceSvc := service.NewPersonalSpaceService(eid)
	_, library, err := spaceSvc.EnsurePersonalWorkspace(c.Request.Context(), userID)
	if err != nil {
		logger.SysErrorf("【录音】创建录音文件夹失败: eid=%d user_id=%d path=%s err=%v", eid, userID, req.Path, err)
		if errors.Is(err, service.ErrPersonalWorkspaceInitializing) {
			c.JSON(http.StatusTooManyRequests, model.OperateTooFast.ToResponse(err))
			return
		}
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	recordingSvc := service.NewMySpaceRecordingService(eid)
	activeJobID, activeErr := recordingSvc.ActiveRecordingJobID(c.Request.Context(), userID)
	if activeErr != nil {
		logger.SysErrorf("【录音】获取活跃录音任务失败: eid=%d user_id=%d err=%v", eid, userID, activeErr)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(activeErr))
		return
	}

	fileSvc := mcpsvc.NewFileService()
	result, err := fileSvc.CreateFileOrFolder(c.Request.Context(), eid, userID, library.ID, req.Path, model.FILE_TYPE_DIR, "")
	if err != nil {
		logger.SysErrorf("【录音】创建录音文件夹失败: eid=%d user_id=%d path=%s err=%v", eid, userID, req.Path, err)
		c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(err))
		return
	}
	if result == nil || result.File == nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(errors.New("创建录音文件夹失败")))
		return
	}

	result.File.SetRecordingFolderOrigin(activeJobID)
	if err := model.DB.Model(result.File).Updates(map[string]interface{}{
		"origin_type":   result.File.OriginType,
		"origin_ref_id": result.File.OriginRefID,
		"origin_source": result.File.OriginSource,
	}).Error; err != nil {
		logger.SysErrorf("【录音】标记录音文件夹失败: eid=%d user_id=%d file_id=%d err=%v", eid, userID, result.File.ID, err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(RecordingFolderResponse{Folder: result.File}))
}

// GetMySpaceRecordings godoc
// @Summary 获取“我的录音”资源列表
// @Description 按录音来源标记查询文件和文件夹列表，path 仅作为辅助导航字段
// @Tags 我的录音
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param path query string false "父路径，仅作为辅助导航"
// @Param keyword query string false "关键词"
// @Param type query string true "类型筛选(dir/file)"
// @Param offset query int false "偏移量" default(0)
// @Param limit query int false "每页条数" default(30)
// @Success 200 {object} model.CommonResponse{data=controller.RecordingListResponse}
// @Failure 500 {object} model.CommonResponse
// @Router /api/my-space/recordings [get]
func GetMySpaceRecordings(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	var req struct {
		Path    string `form:"path"`
		Keyword string `form:"keyword"`
		Type    string `form:"type" binding:"required"`
		Offset  int    `form:"offset"`
		Limit   int    `form:"limit"`
	}
	if err := c.ShouldBindQuery(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	fileType, err := parseFileTypeFilter(req.Type)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	svc := service.NewMySpaceRecordingService(eid)
	files, total, err := svc.ListEntries(c.Request.Context(), userID, req.Path, fileType, req.Keyword, req.Offset, req.Limit)
	if err != nil {
		logger.SysErrorf("【录音】获取我的录音列表失败: eid=%d user_id=%d err=%v", eid, userID, err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(RecordingListResponse{
		Count: total,
		Data:  files,
	}))
}

func recordingDisplayName(recordingPath string) string {
	recordingPath = strings.TrimSpace(recordingPath)
	if recordingPath == "" {
		return ""
	}
	if recordingPath == "/" {
		return "/"
	}
	name := path.Base(recordingPath)
	if name == "." || name == "/" {
		return recordingPath
	}
	return name
}

// CreateMySpaceRecordingImportBatch godoc
// @Summary 创建录音导入批次
// @Description 复用现有批量上传会话，为导入的录音文件打上录音来源标记
// @Tags 我的录音
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body service.BatchInitRequest true "录音导入批次请求"
// @Success 200 {object} model.CommonResponse{data=controller.RecordingImportBatchResponse}
// @Failure 400 {object} model.CommonResponse
// @Failure 500 {object} model.CommonResponse
// @Router /api/my-space/recordings/import [post]
func CreateMySpaceRecordingImportBatch(c *gin.Context) {
	var req service.BatchInitRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	eid := config.GetEID(c)
	userID := config.GetUserId(c)
	svc := service.NewMySpaceRecordingService(eid)
	result, err := svc.CreateImportBatch(c.Request.Context(), userID, &req)
	if err != nil {
		logger.SysErrorf("【录音】创建录音导入批次失败: eid=%d user_id=%d err=%v", eid, userID, err)
		if errors.Is(err, service.ErrPersonalWorkspaceInitializing) {
			c.JSON(http.StatusTooManyRequests, model.OperateTooFast.ToResponse(err))
			return
		}
		if strings.Contains(strings.ToLower(err.Error()), "不存在") {
			c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
			return
		}
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	facade := service.NewBatchUploadFacade(service.GetBatchUploadManagerInstance())
	c.JSON(http.StatusOK, model.Success.ToResponse(RecordingImportBatchResponse{
		BatchID:        result.Batch.ID,
		UploadToken:    result.Batch.UploadToken,
		MaxConcurrent:  facade.GetMaxConcurrent(),
		ChunkSize:      facade.GetChunkSize(),
		FileMappings:   result.FileMappings,
		DuplicateFiles: result.DuplicateFiles,
	}))
}
