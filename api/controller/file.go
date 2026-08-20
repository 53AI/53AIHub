package controller

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils"
	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	v2model "github.com/53AI/53AIHub/rag-pipeline-v2/model"
	"github.com/53AI/53AIHub/service"
	"github.com/53AI/53AIHub/service/elasticsearch"
	mcpsvc "github.com/53AI/53AIHub/service/mcp"
	"github.com/53AI/53AIHub/service/rag"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

var knowledgeBaseFeatureAvailable = service.IsFeatureAvailable

type FileRequst struct {
	Path               string                  `json:"path" form:"path"`
	Type               int                     `json:"type" form:"type"`
	LibraryID          int64                   `json:"library_id" form:"library_id"`
	OriginType         string                  `json:"origin_type" form:"origin_type"`
	OriginSource       string                  `json:"origin_source" form:"origin_source"`
	OriginRefID        int64                   `json:"origin_ref_id" form:"origin_ref_id"`
	GroupID            int64                   `json:"group_id"`
	InsightPerspective string                  `json:"insight_perspective" form:"insight_perspective"`
	Permissions        []*model.PermissionData `json:"permissions"`
}

type FileChildrenListQuery struct {
	LibraryID int64  `form:"library_id" binding:"required"`
	Path      string `form:"path"`
	Sort      string `form:"sort"`
	RunStatus string `form:"run_status"`
	Type      string `form:"type"`
	Limit     int    `form:"limit"`
	PageToken string `form:"page_token"`
}

type FileChildrenResponse struct {
	Entries       []model.File `json:"entries"`
	NextPageToken string       `json:"next_page_token"`
	PrevPageToken string       `json:"prev_page_token"`
}

// parseLibraryIDs 解析知识库ID列表，支持整数ID和HashID格式
func parseLibraryIDs(eid int64, idStrings []string) []int64 {
	var libraryIDs []int64
	for _, idStr := range idStrings {
		idStr = strings.TrimSpace(idStr)
		if idStr == "" {
			continue
		}
		// 使用 hashids.TryParseID 解析，支持整数ID和HashID格式
		if id, err := hashids.TryParseID(idStr); err == nil && id > 0 {
			libraryIDs = append(libraryIDs, id)
		}
	}
	return libraryIDs
}

func parseMCPStyleID(id string) (int64, error) {
	if id == "" {
		return 0, errors.New("ID不能为空")
	}
	parsed, err := hashids.TryParseID(id)
	if err != nil || parsed <= 0 {
		return 0, errors.New("无效的ID")
	}
	return parsed, nil
}

// ParentExists godoc
// @Summary 查看文档父级是否存在
// @Description 检查指定文件的父级路径对应的目录是否存在且未被软删除
// @Tags 文件管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param file_id path int true "文件ID"
// @Success 200 {object} model.CommonResponse{data=map[string]interface{}}
// @Router /api/files/{file_id}/parent-exists [get]
func ParentExists(c *gin.Context) {
	eid := config.GetEID(c)
	// userID := config.GetUserId(c)

	id := c.Param("file_id")
	if id == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("文件ID不能为空")))
		return
	}

	fileID, err := parseMCPStyleID(id)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的文件ID")))
		return
	}

	// 获取文件信息
	file, err := model.GetFileByID(eid, fileID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
		return
	}

	// 计算父级路径
	parentPath := "/"
	if file.Path != "/" {
		pp := filepath.Dir(file.Path)
		if pp == "." || pp == "" {
			parentPath = "/"
		} else {
			parentPath = pp
		}
	}

	// 根目录视为存在
	if parentPath == "/" {
		c.JSON(http.StatusOK, model.Success.ToResponse(map[string]interface{}{
			"exists":      true,
			"parent_path": "/",
			"parent_id":   nil,
		}))
		return
	}

	// 查询父级
	parent, _ := model.GetFileByPathAndLibrary(eid, file.LibraryID, parentPath)
	if parent == nil || parent.IsDeleted {
		c.JSON(http.StatusOK, model.Success.ToResponse(map[string]interface{}{
			"exists":      false,
			"parent_path": parentPath,
			"parent_id":   nil,
		}))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(map[string]interface{}{
		"exists":      true,
		"parent_path": parentPath,
		"parent_id":   parent.ID,
	}))
}

type UpdateRawFileContentRequest struct {
	Content string `json:"content"`
}

type UpdateFileGeneratedContentRequest struct {
	Summary      *string  `json:"summary"`
	Questions    []string `json:"questions"`
	KnowledgeMap *string  `json:"knowledge_map"`
}

// UpdateFileGeneratedContent godoc
// @Summary 更新文件生成内容 (摘要、问题、知识地图)
// @Description 更新文件生成的摘要、问题列表或知识地图。三选一或多选进行修改。
// @Tags 文件管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param file_id path int true "文件ID"
// @Param request body UpdateFileGeneratedContentRequest true "更新内容请求"
// @Success 200 {object} model.CommonResponse "成功"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 403 {object} model.CommonResponse "无权访问"
// @Failure 404 {object} model.CommonResponse "文件不存在"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/files/{file_id}/generated-content [put]
func UpdateFileGeneratedContent(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)
	fileIDStr := c.Param("file_id")
	fileID, _ := strconv.ParseInt(fileIDStr, 10, 64)

	var req UpdateFileGeneratedContentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 权限检查
	permisson, err := service.GetUserPermission(eid, model.RESOURCE_TYPE_FILE, fileID, userID)
	if err != nil || permisson < model.PERMISSION_EDIT_KNOWLEDGE {
		c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(err))
		return
	}

	svc := rag.NewGeneratedContentService(model.DB)
	ctx := context.Background()

	// 更新摘要
	if req.Summary != nil {
		if err := svc.UpsertSummary(ctx, eid, fileID, *req.Summary); err != nil {
			c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
			return
		}
	}

	// 更新问题
	if req.Questions != nil {
		if err := svc.UpsertQuestions(ctx, eid, fileID, req.Questions); err != nil {
			c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
			return
		}
	}

	// 更新知识地图
	if req.KnowledgeMap != nil {
		if err := svc.UpsertKnowledgeMap(ctx, eid, fileID, *req.KnowledgeMap); err != nil {
			c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
			return
		}
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}

// UpdateRawFileContent godoc
// @Summary 更新文件原始内容
// @Description 更新文件原始内容，支持 .md, .txt, .html, .htm 后缀。html/htm 会被转换成 markdown 存入 fileBody，同时物理文件会保存原始 html。
// @Tags 文件管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param file_id path int true "文件ID"
// @Param request body UpdateRawFileContentRequest true "更新内容请求"
// @Success 200 {object} model.CommonResponse "成功"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 403 {object} model.CommonResponse "无权访问"
// @Failure 404 {object} model.CommonResponse "文件不存在"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/files/{file_id}/raw [put]
func UpdateRawFileContent(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)
	fileIDStr := c.Param("file_id")
	fileID, _ := strconv.ParseInt(fileIDStr, 10, 64)

	var req UpdateRawFileContentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	fileService := mcpsvc.NewFileService()
	fileBody, err := fileService.UpdateRawFileContent(c.Request.Context(), eid, userID, fileID, req.Content)
	if err != nil {
		switch {
		case isPermissionRelatedError(err):
			c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(err))
		case strings.Contains(err.Error(), "不支持"):
			c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		default:
			c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		}
		return
	}

	library, err := model.GetLibraryByID(eid, fileBody.LibraryID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	// 个人知识库只保存正文/原文件，不再自动触发后处理；普通知识库保持原行为
	if !library.IsPersonalLibrary() && !isTestMode() {
		go func() {
			content := req.Content
			if fileBody != nil && fileBody.Content != "" {
				content = fileBody.Content
			}
			service.ProcessAutoChunkingWithPipeline(eid, fileID, userID, content, nil)
		}()
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}

type FileSortListRequest struct {
	Files []struct {
		ID   int64 `json:"id" binding:"required"`
		Sort int64 `json:"sort" binding:"required"`
	} `json:"files" binding:"required"`
}

type RenameFileRequest struct {
	ID   int64  `json:"id" binding:"required"`
	Path string `json:"path" binding:"required"`
}

// FileEditLockRequest 文件编辑锁请求结构
type FileEditLockRequest struct {
	Action string `json:"action" binding:"required,oneof=add delete"` // 操作类型：add 或 delete
}

// FileEditLockResponse 文件编辑锁响应结构
type FileEditLockResponse struct {
	FileID    int64  `json:"file_id"`
	UserID    int64  `json:"user_id,omitempty"`
	UserName  string `json:"user_name,omitempty"`
	ExpiresAt int64  `json:"expires_at,omitempty"` // 过期时间戳
	Message   string `json:"message"`              // 操作结果消息
	Success   bool   `json:"success"`              // 操作是否成功
}

// SearchRequest 搜索请求
type SearchRequest struct {
	Query          string  `json:"query" form:"query" binding:"required"`
	TopK           int     `json:"top_k" form:"top_k"`
	LibraryIDs     []int64 `json:"library_ids" form:"library_ids"`
	CaseSensitive  *bool   `json:"case_sensitive" form:"case_sensitive"`   // 大小写敏感，nil表示不敏感
	FuzzyThreshold *int    `json:"fuzzy_threshold" form:"fuzzy_threshold"` // 模糊匹配阈值，1-2，nil表示自动
}

// CreateFile godoc
// @Summary 创建文件
// @Description 创建文件接口。请求体可选携带 origin_type / origin_source / origin_ref_id，用于显式标记“我的录音”来源；不传则保持默认来源逻辑。
// @Tags 文件管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body FileRequst true "文件信息"
// @Success 200 {object} model.CommonResponse{data=model.File}
// @Router /api/files [post]
func CreateFile(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	// 获取上级文件对象

	// 同时解析为请求体与模型体：请求体包含 permissions，模型体用于保存
	var req FileRequst
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	if req.LibraryID == 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("知识库ID不能为空")))
		return
	}
	if !model.IsValidInsightPerspective(req.InsightPerspective) {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("不支持的洞察视角")))
		return
	}

	library, err := model.GetLibraryByID(eid, req.LibraryID)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("知识库不存在")))
		return
	}
	isPersonalLibrary := library.IsPersonalLibrary()

	if !isPersonalLibrary {
		// 检查功能是否可用
		params := map[string]interface{}{
			"from": "document",
			"op":   "add",
		}
		_, err := knowledgeBaseFeatureAvailable(c, "knowledge_base", params)
		if err != nil {
			c.JSON(http.StatusForbidden, model.FeatureNotAvailableError.ToResponse(err))
			return
		}
	}

	file := model.File{
		Eid:                eid,
		Path:               req.Path,
		Type:               req.Type,
		LibraryID:          req.LibraryID,
		UserID:             userID, // 设置文件创建人
		OriginType:         model.FileOriginTypeManualCreate,
		OriginRefID:        0,
		GroupID:            req.GroupID,
		InsightPerspective: string(model.NormalizeInsightPerspective(req.InsightPerspective)),
	}

	switch strings.TrimSpace(req.OriginType) {
	case model.FileOriginTypeRecordingAudio:
		file.SetRecordingAudioOrigin(req.OriginRefID)
	case model.FileOriginTypeRecordingFolder:
		file.SetRecordingFolderOrigin(req.OriginRefID)
	case model.FileOriginTypeRecordingImported:
		file.SetRecordingImportedOrigin(req.OriginRefID)
	}
	if originSource := strings.TrimSpace(req.OriginSource); originSource != "" && strings.TrimSpace(req.OriginType) != "" {
		file.OriginSource = originSource
	}

	if file.Path == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("文件路径不能为空")))
		return
	}

	// 新增路径前缀强制校验
	if !strings.HasPrefix(file.Path, "/") {
		file.Path = "/" + file.Path
	}

	// 检查上级文件/文件夹权限
	fps := service.NewFilePermissionService(eid)
	if err := fps.CheckParentPermission(userID, file.Path, file.LibraryID); err != nil {
		logger.SysLogf("用户创建文件权限检查失败: userID=%d, path=%s, libraryID=%d, err=%v", userID, file.Path, file.LibraryID, err)
		c.JSON(http.StatusForbidden, model.ForbiddenError.ToResponse(err))
		return
	}

	if file.Type != model.FILE_TYPE_DIR && file.Type != model.FILE_TYPE_FILE {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("文件类型错误")))
		return
	}

	if err := file.Save(); err != nil {
		c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(err))
		return
	}

	// 文档创建者自动获得文件管理权限（目录与文档均赋权，便于后续管理）
	// fps 变量已在上面声明，这里直接使用
	if err := fps.AddFileCreatorPermission(file.ID, userID); err != nil {
		// 失败不阻断主流程，仅记录
	}
	// 若请求包含额外权限，执行校验与批量写入（与库一致的最小实现）
	if len(req.Permissions) > 0 {
		if err := fps.BatchAddPermissionsForFile(file.ID, req.Permissions); err != nil {
			// 不阻断主流程，仅记录
		}
	}

	// 同步到 Elasticsearch
	elasticsearch.SyncFileToES(&file, "create")

	// 更新知识库的更新时间
	model.UpdateLibraryUpdatedTimeByID(eid, library.ID)

	// 只为文档类型记录新建日志，目录不记录
	if file.Type == model.FILE_TYPE_FILE {
		space, _ := model.GetSpaceByID(eid, library.SpaceID)

		fileName := filepath.Base(file.Path)
		scopeName := "知识库"
		if isPersonalLibrary {
			scopeName = "个人空间"
		}
		log := model.SystemLog{
			Eid:      eid,
			UserID:   config.GetUserId(c),
			Nickname: config.GetUserNickname(c),
			Module:   model.SystemLogModuleFile,
			Action:   model.SystemLogActionCreate,
			Content:  fmt.Sprintf("在【%s】%s【%s】新建了《%s》", space.Name, scopeName, library.Name, fileName),
			IP:       utils.GetClientIP(c),
		}
		model.CreateSystemLog(&log)
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(file))
}

// GetFile godoc
// @Summary 获取文件详情
// @Description 获取文件详情接口
// @Tags 文件管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param file_id path int true "文件ID"
// @Success 200 {object} model.CommonResponse{data=model.File}
// @Router /api/files/{file_id} [get]
func GetFile(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	id := c.Param("file_id")
	if id == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("文件ID不能为空")))
		return
	}

	fileID, err := parseMCPStyleID(id)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的文件ID")))
		return
	}

	file, err := model.GetFileByID(eid, fileID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			go func() {
				elasticsearch.SyncFileToES(&model.File{ID: fileID}, "delete")
				logger.SysLogf("清理不存在文件的ES索引: fileID=%d", fileID)
			}()
		}

		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
		return
	}

	library, err := model.GetLibraryByID(eid, file.LibraryID)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("知识库不存在")))
		return
	}
	if !library.IsPersonalLibrary() {
		params := map[string]interface{}{
			"from": "document",
		}
		_, err := knowledgeBaseFeatureAvailable(c, "knowledge_base", params)
		if err != nil {
			c.JSON(http.StatusForbidden, model.FeatureNotAvailableError.ToResponse(err))
			return
		}
	}

	permisson, err := service.GetUserPermission(eid, model.RESOURCE_TYPE_FILE, fileID, userID)
	if err != nil || permisson < model.PERMISSION_VIEW_ONLY {
		c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(err))
		return
	}

	_ = file.LoadUploadFile()
	_ = file.LoadLastBodyTime()

	isFav, _ := model.IsFavorited(userID, model.RESOURCE_TYPE_FILE, fileID)
	file.IsFavorite = isFav

	recordFileBrowseHistoryAsync(eid, userID, file)

	c.JSON(http.StatusOK, model.Success.ToResponse(file))
}

func recordFileBrowseHistoryAsync(eid, userID int64, file *model.File) {
	if file == nil || file.Type != model.FILE_TYPE_FILE {
		return
	}
	go func(fileID, libraryID int64) {
		_ = model.RecordBrowseHistory(eid, userID, libraryID, fileID)
	}(file.ID, file.LibraryID)
}

// GetFileList godoc
// @Summary 获取文件列表
// @Description 根据路径获取文件列表接口
// @Tags 文件管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param path query string true "文件路径"
// @Param library_id query int true "知识库ID"
// @Success 200 {object} model.CommonResponse{data=[]model.File} "成功响应"
// @Router /api/files [get]
func GetFileList(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	base_path := c.Query("path")
	if base_path == "" {
		base_path = "/"
	}
	sort := c.Query("sort")

	libraryIDStr := c.Query("library_id")
	if libraryIDStr == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("知识库ID不能为空")))
		return
	}

	libraryID, err := strconv.ParseInt(libraryIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的知识库ID")))
		return
	}

	_, ok := requireLibraryPermission(c, eid, userID, libraryID, model.PERMISSION_VIEW_ONLY, "无权限访问此知识库")
	if !ok {
		return
	}

	files, err := model.GetFilesByParentPathAndLibrary(eid, libraryID, base_path, sort)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(files))

}

// GetAllFileList godoc
// @Summary 获取所有文件列表
// @Description 获取知识库下所有文件夹、文件、子文件夹等所有内容。不传 parent_path 时递归获取全部；传 parent_path 时只返回该路径下的直接子节点。
// @Tags 文件管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param library_id query int true "知识库ID"
// @Param parent_path query string false "父级路径，传入时只返回该路径下的直接子节点，不传则递归返回全部"
// @Param sort query string false "排序方式" Enums(asc, desc) default(asc)
// @Param run_status query string false "运行状态筛选，支持 pending,processing,success,failed,not_started,running,completed，多值逗号分隔"
// @Param type query string false "文件类型筛选，支持 dir/folder (文件夹) 或 file (文件)"
// @Success 200 {object} model.CommonResponse{data=[]model.File} "成功响应"
// @Router /api/files/all [get]
func GetAllFileList(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	libraryIDStr := c.Query("library_id")
	if libraryIDStr == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("知识库ID不能为空")))
		return
	}

	libraryID, err := strconv.ParseInt(libraryIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的知识库ID")))
		return
	}

	library, ok := requireLibraryPermission(c, eid, userID, libraryID, model.PERMISSION_VIEW_ONLY, "无权限访问此知识库")
	if !ok {
		return
	}
	if !library.IsPersonalLibrary() {
		params := map[string]interface{}{
			"from": "document",
		}
		_, featureErr := knowledgeBaseFeatureAvailable(c, "knowledge_base", params)
		if featureErr != nil {
			c.JSON(http.StatusForbidden, model.FeatureNotAvailableError.ToResponse(featureErr))
			return
		}
	}

	parentPath := c.Query("parent_path")
	sort := c.DefaultQuery("sort", "asc")
	runStatus := c.Query("run_status")
	typeStr := c.Query("type")
	var fileType *int
	if typeStr != "" {
		normalizedType := strings.ToLower(strings.TrimSpace(typeStr))
		var parsedType int
		switch normalizedType {
		case "dir", "folder":
			parsedType = model.FILE_TYPE_DIR
		case "file":
			parsedType = model.FILE_TYPE_FILE
		default:
			t, err := strconv.Atoi(normalizedType)
			if err != nil || (t != model.FILE_TYPE_DIR && t != model.FILE_TYPE_FILE) {
				c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的type参数")))
				return
			}
			parsedType = t
		}
		fileType = &parsedType
	}

	var runStatusValues []string
	if runStatus != "" {
		runStatusValues = strings.Split(runStatus, ",")
	}

	files, err := model.GetAllFilesByLibrary(eid, libraryID, parentPath, sort, fileType, runStatusValues)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(err))
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(files))
}

// GetFileChildrenList godoc
// @Summary 获取目录子项列表
// @Description 按目录分层加载文件列表，返回指定路径下的直接子级
// @Tags 文件管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param library_id query int true "知识库ID"
// @Param path query string false "父级路径，默认 /"
// @Param sort query string false "排序方式" Enums(asc, desc) default(asc)
// @Param run_status query string false "运行状态筛选，支持 pending,processing,success,failed,not_started,running,completed，多值逗号分隔"
// @Param type query string false "文件类型筛选，支持 dir/folder (文件夹) 或 file (文件)"
// @Param limit query int false "单页数量" default(30)
// @Param page_token query string false "分页游标"
// @Success 200 {object} model.CommonResponse{data=FileChildrenResponse} "成功响应"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 403 {object} model.CommonResponse "无权限"
// @Failure 500 {object} model.CommonResponse "服务器错误"
// @Router /api/files/children [get]
func GetFileChildrenList(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	var req FileChildrenListQuery
	if err := c.ShouldBindQuery(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	if req.Path == "" {
		req.Path = "/"
	}
	if req.Sort == "" {
		req.Sort = "asc"
	}

	library, ok := requireLibraryPermission(c, eid, userID, req.LibraryID, model.PERMISSION_VIEW_ONLY, "无权限访问此知识库")
	if !ok {
		return
	}
	if !library.IsPersonalLibrary() {
		params := map[string]interface{}{
			"from": "document",
		}
		_, featureErr := knowledgeBaseFeatureAvailable(c, "knowledge_base", params)
		if featureErr != nil {
			c.JSON(http.StatusForbidden, model.FeatureNotAvailableError.ToResponse(featureErr))
			return
		}
	}

	limit := req.Limit
	if limit <= 0 {
		limit = 30
	}
	if limit > 200 {
		limit = 200
	}

	offset, err := decodePageToken(req.PageToken)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的page_token参数")))
		return
	}

	var fileType *int
	if req.Type != "" {
		parsedType, parseErr := parseFileTypeFilter(req.Type)
		if parseErr != nil {
			c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(parseErr))
			return
		}
		fileType = parsedType
	}

	var runStatusValues []string
	if req.RunStatus != "" {
		runStatusValues = strings.Split(req.RunStatus, ",")
	}

	files, total, err := model.GetFilesByParentPathAndLibraryWithFilter(
		eid,
		req.LibraryID,
		req.Path,
		req.Sort,
		offset,
		limit,
		fileType,
		runStatusValues,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(err))
		return
	}

	response := FileChildrenResponse{
		Entries: files,
	}
	if offset+limit < int(total) {
		response.NextPageToken = encodePageToken(offset + limit)
	}
	if offset-limit >= 0 {
		response.PrevPageToken = encodePageToken(offset - limit)
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(response))
}

func decodePageToken(token string) (int, error) {
	if token == "" {
		return 0, nil
	}
	data, err := base64.StdEncoding.DecodeString(token)
	if err != nil {
		return 0, err
	}
	offset, err := strconv.Atoi(string(data))
	if err != nil || offset < 0 {
		return 0, fmt.Errorf("invalid token")
	}
	return offset, nil
}

func encodePageToken(offset int) string {
	if offset < 0 {
		offset = 0
	}
	return base64.StdEncoding.EncodeToString([]byte(strconv.Itoa(offset)))
}

// GetRagFileRunStats godoc
// @Summary 获取RAG任务运行统计
// @Description 获取知识库下RAG任务的运行统计信息（已完成、排队中、失败/中断、平均耗时）
// @Tags 文件管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param library_id query int true "知识库ID"
// @Success 200 {object} model.CommonResponse{data=model.RagFileRunStatsSummary}
// @Router /api/files/all/stats [get]
func GetRagFileRunStats(c *gin.Context) {
	eid := config.GetEID(c)

	libraryIDStr := c.Query("library_id")
	if libraryIDStr == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("知识库ID不能为空")))
		return
	}

	libraryID, err := strconv.ParseInt(libraryIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的知识库ID")))
		return
	}

	summary, err := model.GetRagFileRunStatsSummary(eid, &libraryID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(summary))
}

// BatchUpdateSort godoc
// @Summary 批量更新文件排序
// @Description 批量更新文件排序接口
// @Tags 文件管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param files body FileSortListRequest true "文件排序数组"
// @Success 200 {object} model.CommonResponse
// @Router /api/files/sort [post]
func BatchUpdateSort(c *gin.Context) {
	eid := config.GetEID(c)
	var fileRequst FileSortListRequest

	if err := c.ShouldBindJSON(&fileRequst); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	tx := model.DB.Begin()
	for _, file := range fileRequst.Files {
		if err := tx.Model(&model.File{}).Where("eid = ? AND id = ?", eid, file.ID).Update("sort", file.Sort).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(err))
			return
		}
	}
	tx.Commit()

	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}

// RenameFile godoc
// @Summary 重命名文件
// @Description 重命名文件接口
// @Tags 文件管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body RenameFileRequest true "重命名信息"
// @Success 200 {object} model.CommonResponse{data=model.File}
// @Router /api/files/rename [put]
func RenameFile(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)
	var req RenameFileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	if req.ID == 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("文件ID不能为空")))
		return
	}

	if req.Path == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("新路径不能为空")))
		return
	}

	if req.Path == "/" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("新路径不能根目录")))
		return
	}

	file, err := model.GetFileByID(eid, req.ID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.FileError.ToResponse(err))
		return
	}

	library, err := model.GetLibraryByID(eid, file.LibraryID)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("知识库不存在")))
		return
	}
	isPersonalLibrary := library.IsPersonalLibrary()

	permisson, err := service.GetUserPermission(eid, model.RESOURCE_TYPE_FILE, req.ID, userID)
	if err != nil || permisson < model.PERMISSION_EDIT_KNOWLEDGE {
		c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(err))
		return
	}

	// 检查新路径是否已存在
	if existingFile, _ := model.GetFileByPathAndLibraryNotDeleted(eid, file.LibraryID, req.Path); existingFile != nil && existingFile.ID != file.ID {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("目标路径已存在")))
		return
	}

	// 获取原路径和新路径
	oldPath := file.Path
	newPath := req.Path

	// 开启事务
	tx := model.DB.Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	// 确保新路径以/开头
	if !strings.HasPrefix(req.Path, "/") {
		req.Path = "/" + req.Path
	}

	// 如果是目录，更新所有子项的路径
	if file.Type == model.FILE_TYPE_DIR {
		// 获取所有子文件/文件夹
		children, err := model.GetChildrenByPathPrefix(eid, oldPath)
		if err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(err))
			return
		}

		// 批量更新子路径
		for _, child := range children {
			newChildPath := strings.Replace(child.Path, oldPath, newPath, 1)
			if err := tx.Model(&model.File{}).Where("eid = ? AND id = ?", eid, child.ID).
				Updates(&model.File{
					Path: newChildPath,
				}).Error; err != nil {
				tx.Rollback()
				c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(err))
				return
			}
		}
	}

	// 更新父目录路径
	file.Path = newPath
	if err := tx.Model(&file).Where("eid = ? AND id = ?", eid, file.ID).Updates(file).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(err))
		return
	}

	if err := tx.Commit().Error; err != nil {
		c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(err))
		return
	}

	// 同步到 Elasticsearch
	elasticsearch.SyncFileToES(file, "update")

	go func() {
		// 录音文件：检查历史记忆配置，关闭或未配置 Document 类型时跳过元信息实体抽取
		if !file.IsRecordingOriginType() || model.IsRecordingMemoryExtractionTypeEnabled(eid, model.EntityTypeDocument) {
			extractor := rag.NewEntityExtractionService(model.DB)
			if err := extractor.ExtractAndStoreForFileMeta(context.Background(), eid, file.ID); err != nil {
				logger.SysLogf("文件重命名后更新元数据实体失败: eid=%d file_id=%d err=%v", eid, file.ID, err)
			}
		}
	}()

	space, _ := model.GetSpaceByID(eid, library.SpaceID)
	scopeName := "知识库"
	if isPersonalLibrary {
		scopeName = "个人空间"
	}
	fileName := filepath.Base(file.Path)
	log := model.SystemLog{
		Eid:      eid,
		UserID:   userID,
		Nickname: config.GetUserNickname(c),
		Module:   model.SystemLogModuleFile,
		Action:   model.SystemLogActionUpdate,
		Content:  fmt.Sprintf("在【%s】%s【%s】重命名了《%s》", space.Name, scopeName, library.Name, fileName),
		IP:       utils.GetClientIP(c),
	}
	model.CreateSystemLog(&log)

	c.JSON(http.StatusOK, model.Success.ToResponse(file))
}

// DeleteFile godoc
// @Summary 删除文件
// @Description 删除文件接口
// @Tags 文件管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param file_id path int true "文件ID"
// @Success 200 {object} model.CommonResponse
// @Router /api/files/{file_id} [delete]
func DeleteFile(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	id := c.Param("file_id")
	if id == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("文件ID不能为空")))
		return
	}

	fileID, err := parseMCPStyleID(id)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的文件ID")))
		return
	}

	// 获取文件信息以检查权限和记录日志
	file, err := model.GetFileByID(eid, fileID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
		return
	}

	// 获取知识库和空间信息用于日志
	library, _ := model.GetLibraryByID(eid, file.LibraryID)
	space, _ := model.GetSpaceByID(eid, library.SpaceID)
	isPersonalLibrary := library.IsPersonalLibrary()

	permisson, err := service.GetUserPermission(eid, model.RESOURCE_TYPE_FILE, fileID, userID)
	if err != nil || permisson < model.PERMISSION_MANAGE {
		c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(err))
		return
	}

	common.SetFileStop(file.ID)

	if err := model.SoftDeleteFile(eid, fileID, userID); err != nil {
		logger.SysLogf("软删除失败: eid=%d fileID=%d userID=%d err=%v", eid, fileID, userID, err)
		c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(err))
		return
	}

	// 从 Elasticsearch 移除索引
	go removeFileIndicesAsync(eid, file)

	// 记录系统日志
	fileName := filepath.Base(file.Path)
	scopeName := "知识库"
	if isPersonalLibrary {
		scopeName = "个人空间"
	}
	log := model.SystemLog{
		Eid:      eid,
		UserID:   config.GetUserId(c),
		Nickname: config.GetUserNickname(c),
		Module:   model.SystemLogModuleFile,
		Action:   model.SystemLogActionDelete,
		Content:  fmt.Sprintf("从【%s】%s【%s】删除了《%s》", space.Name, scopeName, library.Name, fileName),
		IP:       utils.GetClientIP(c),
	}
	model.CreateSystemLog(&log)

	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}

// removeFileIndicesAsync 异步删除文件在Elasticsearch中的索引
func removeFileIndicesAsync(eid int64, file *model.File) {
	// 如果删除的是文件夹，则需要删除文件夹下所有文件的索引
	if file.Type == model.FILE_TYPE_DIR {
		// 获取文件夹下所有文件
		children, err := model.GetChildrenByPathPrefix(eid, file.Path)
		if err != nil {
			logger.SysLogf("获取文件夹下文件列表失败: eid=%d path=%s err=%v", eid, file.Path, err)
		} else {
			// 删除文件夹下所有文件的索引
			for _, child := range children {
				if child.Type == model.FILE_TYPE_FILE {
					common.SetFileStop(child.ID) // 设置文件为已删除状态
					elasticsearch.SyncFileToES(&child, "delete")
				}
			}
		}
	} else {
		// 删除单个文件的索引
		elasticsearch.SyncFileToES(file, "delete")
	}
}

// DeleteFileAsync godoc
// @Summary 异步删除文件
// @Description 异步删除文件接口，支持级联删除相关数据
// @Tags 文件管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param file_id path int true "文件ID"
// @Param async query bool false "是否异步删除" default(false)
// @Success 200 {object} model.CommonResponse
// @Router /api/files/{file_id}/delete-async [delete]
func DeleteFileAsync(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	id := c.Param("file_id")
	if id == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("文件ID不能为空")))
		return
	}

	fileID, err := parseMCPStyleID(id)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的文件ID")))
		return
	}

	// 获取文件信息以检查权限和记录日志
	file, err := model.GetFileByID(eid, fileID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
		return
	}

	// 获取知识库和空间信息用于日志
	library, _ := model.GetLibraryByID(eid, file.LibraryID)
	space, _ := model.GetSpaceByID(eid, library.SpaceID)

	permisson, err := service.GetUserPermission(eid, model.RESOURCE_TYPE_FILE, fileID, userID)
	if err != nil || permisson < model.PERMISSION_MANAGE {
		c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(err))
		return
	}

	// 检查是否异步删除
	async := c.DefaultQuery("async", "false") == "true"

	// 执行删除（现在都是级联删除）
	if err := model.DeleteFile(eid, fileID); err != nil {
		c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(err))
		return
	}

	// 记录系统日志
	fileName := filepath.Base(file.Path)
	log := model.SystemLog{
		Eid:      eid,
		UserID:   config.GetUserId(c),
		Nickname: config.GetUserNickname(c),
		Module:   model.SystemLogModuleFile,
		Action:   model.SystemLogActionDelete,
		Content:  fmt.Sprintf("从【%s】知识库【%s】删除了《%s》", space.Name, library.Name, fileName),
		IP:       utils.GetClientIP(c),
	}
	model.CreateSystemLog(&log)

	// 从 Elasticsearch 移除索引
	elasticsearch.SyncFileToES(file, "delete")

	message := "文件删除完成"
	if async {
		message = "文件删除请求已提交，向量数据将在后台清理"
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(map[string]interface{}{
		"message": message,
		"async":   async,
	}))
}

// GetFileDeletionPreview godoc
// @Summary 获取文件删除预览
// @Description 获取删除文件时将会影响的数据统计
// @Tags 文件管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param file_id path int true "文件ID"
// @Success 200 {object} model.CommonResponse{data=FileDeletionPreview}
// @Router /api/files/{file_id}/deletion-preview [get]
func GetFileDeletionPreview(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	id := c.Param("file_id")
	if id == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("文件ID不能为空")))
		return
	}

	fileID, err := parseMCPStyleID(id)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的文件ID")))
		return
	}

	// 获取文件信息
	file, err := model.GetFileByID(eid, fileID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
		return
	}

	permisson, err := service.GetUserPermission(eid, model.RESOURCE_TYPE_FILE, fileID, userID)
	if err != nil || permisson < model.PERMISSION_MANAGE {
		c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(err))
		return
	}

	// 获取删除统计信息
	stats, err := model.GetFileDeletionStats(eid, fileID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	preview := &FileDeletionPreview{
		FileID:          fileID,
		FileName:        file.Path,
		FileType:        file.Type,
		DocumentChunks:  stats.DocumentChunks,
		RetrievalChunks: stats.RetrievalChunks,
		Relations:       stats.Relations,
		Vectors:         stats.Vectors,
		OperationLogs:   stats.OperationLogs,
		FileVersions:    stats.FileVersions,
		EstimatedTime:   stats.EstimateDeletionTime(),
		RecommendAsync:  stats.ShouldUseAsync(),
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(preview))
}

// FileDeletionPreview 文件删除预览
type FileDeletionPreview struct {
	FileID          int64  `json:"file_id"`
	FileName        string `json:"file_name"`
	FileType        int    `json:"file_type"`
	DocumentChunks  int64  `json:"document_chunks"`
	RetrievalChunks int64  `json:"retrieval_chunks"`
	Relations       int64  `json:"relations"`
	Vectors         int64  `json:"vectors"`
	OperationLogs   int64  `json:"operation_logs"`
	FileVersions    int64  `json:"file_versions"`   // 新增：文件版本数量
	EstimatedTime   string `json:"estimated_time"`  // 预估删除时间
	RecommendAsync  bool   `json:"recommend_async"` // 是否推荐异步删除
}

// GetRecentlyFileList godoc
// @Summary Get recent files list
// @Description Get the list of recently accessed files that the user has permission to access
// @Tags 文件管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param library_id query int false "Library ID"
// @Success 200 {object} model.CommonResponse{data=[]model.File}
// @Router /api/files/recently [get]
func GetRecentlyFileList(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	libraryIdStr := c.Query("library_id")
	libraryId := int64(0)
	if libraryIdStr != "" {
		var err error
		libraryId, err = strconv.ParseInt(libraryIdStr, 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
			return
		}
	}

	// 使用新的基于浏览记录的方法
	files, err := model.GetUserRecentFilesByLibrary(eid, userID, libraryId, 20)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(err))
		return
	}

	favoriteIDs := make([]int64, 0, len(files))
	for _, file := range files {
		if file.ID > 0 {
			favoriteIDs = append(favoriteIDs, file.ID)
		}
	}
	favoriteMap, err := model.GetFavoriteResourceIDMap(userID, model.RESOURCE_TYPE_FILE, favoriteIDs)
	if err != nil {
		logger.Errorf(c, "GetRecentlyFileList favorite lookup error: %v", err)
		c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(err))
		return
	}
	for i := range files {
		files[i].IsFavorite = favoriteMap[files[i].ID]
		if lib, libErr := model.GetLibraryByID(eid, files[i].LibraryID); libErr == nil && lib != nil {
			trimPersonalLibraryFilePath(&files[i], lib)
		}
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(files))
}

// GetRecentlyUpdatedFileList godoc
// @Summary 获取最近更新的文件列表
// @Description 获取最近更新的文件列表，按更新时间倒序排列
// @Tags 文件管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param library_id query int false "知识库ID"
// @Success 200 {object} model.CommonResponse{data=[]model.File}
// @Router /api/files/recently-updated [get]
func GetRecentlyUpdatedFileList(c *gin.Context) {
	eid := config.GetEID(c)
	// userID := config.GetUserId(c)

	libraryIdStr := c.Query("library_id")
	libraryId := int64(0)
	if libraryIdStr != "" {
		var err error
		libraryId, err = strconv.ParseInt(libraryIdStr, 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
			return
		}
	}

	// 所有库的最近文件,最近不要检查权限，因为是曾经的预览
	files, err := model.GetRecentlyFiles(eid, libraryId, 20)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(files))
}

// FileNameSearch godoc
// @Summary 文件名搜索
// @Description 基于path字段进行文件名模糊搜索，支持大小写敏感控制和模糊匹配阈值（支持GET和POST方式）
// @Tags 文件管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param query query string true "搜索关键词"
// @Param top_k query int false "返回结果数量" default(20)
// @Param library_ids query []int false "知识库ID列表"
// @Param case_sensitive query bool false "是否大小写敏感 true=大小写敏感，false=大小写不敏感" default(false)
// // @Param fuzzy_threshold query int false "模糊匹配阈值1=最多1个字符差异，2=最多2个字符差异，不填为自动" Enums(1,2)
// @Param request body controller.SearchRequest false "搜索请求（POST方式时使用）"
// @Success 200 {object} model.CommonResponse{data=elasticsearch.FileNameSearchResponse}
// @Router /api/files/search/by-name [get]
// @Router /api/files/search/by-name [post]
func FileNameSearch(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	// 解析搜索请求
	var req SearchRequest
	var err error

	// 从查询参数解析
	if query := c.Query("query"); query != "" {
		req.Query = query
		if topKStr := c.Query("top_k"); topKStr != "" {
			if tk, err := strconv.Atoi(topKStr); err == nil && tk > 0 {
				req.TopK = tk
			} else {
				req.TopK = 20
			}
		} else {
			req.TopK = 20
		}

		// 解析知识库ID
		// 优先使用数组格式 library_ids[]=1&library_ids[]=2
		if libraryIDsArr := c.QueryArray("library_ids[]"); len(libraryIDsArr) > 0 {
			req.LibraryIDs = parseLibraryIDs(eid, libraryIDsArr)
		} else if libraryIDsStr := c.Query("library_ids"); libraryIDsStr != "" {
			// 兼容逗号分隔格式 library_ids=1,2,3
			libIDs := strings.Split(libraryIDsStr, ",")
			req.LibraryIDs = parseLibraryIDs(eid, libIDs)
		}

		// 解析大小写敏感
		if caseSensitiveStr := c.Query("case_sensitive"); caseSensitiveStr != "" {
			if cs, err := strconv.ParseBool(caseSensitiveStr); err == nil {
				req.CaseSensitive = &cs
			}
		}

		// 解析模糊阈值
		if fuzzyThresholdStr := c.Query("fuzzy_threshold"); fuzzyThresholdStr != "" {
			if ft, err := strconv.Atoi(fuzzyThresholdStr); err == nil && (ft == 1 || ft == 2) {
				req.FuzzyThreshold = &ft
			}
		}

	} else {
		// 从POST请求体解析
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
			return
		}
		if req.TopK <= 0 {
			req.TopK = 20
		}
	}

	if req.Query == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("搜索关键词不能为空")))
		return
	}

	searchService := mcpsvc.NewSearchService(model.DB)
	searchReq := &mcpsvc.FileNameSearchRequest{
		Query:          req.Query,
		TopK:           req.TopK,
		LibraryIDs:     req.LibraryIDs,
		CaseSensitive:  req.CaseSensitive,
		FuzzyThreshold: req.FuzzyThreshold,
	}

	response, err := searchService.SearchFileNames(c.Request.Context(), eid, userID, searchReq)
	if err != nil {
		logger.SysLogf("文件名搜索失败: eid=%d, userID=%d, query=%s, err=%v", eid, userID, req.Query, err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	logger.SysLogf("文件名搜索完成: eid=%d, userID=%d, query=%s, results=%d", eid, userID, req.Query, len(response.Results))
	c.JSON(http.StatusOK, model.Success.ToResponse(response))
}

// BatchImportToES godoc
// @Summary 批量导入现有文档到 Elasticsearch
// @Description 将现有文档批量索引到 Elasticsearch 中，供平台管理员使用
// @Tags 平台管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body BatchImportRequest false "批量导入请求"
// @Success 200 {object} model.CommonResponse{data=BatchImportResponse}
// @Router /api/admin/files/import-to-es [post]
func BatchImportToES(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	// 检查 Elasticsearch 是否可用
	esClient := elasticsearch.GetGlobalClient()
	if esClient == nil || esClient.IsDisabled() {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("Elasticsearch服务不可用")))
		return
	}

	// 解析请求参数
	var req BatchImportRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 设置默认值
	if req.BatchSize <= 0 {
		req.BatchSize = 100
	}
	if req.BatchSize > 1000 {
		req.BatchSize = 1000
	}

	logger.SysLogf("开始批量导入到 Elasticsearch: eid=%d, userID=%d, batchSize=%d", eid, userID, req.BatchSize)

	// 异步执行导入
	go func() {
		err := performBatchImportToES(eid, &req)
		if err != nil {
			logger.SysLogf("批量导入到 Elasticsearch 失败: eid=%d, err=%v", eid, err)
		} else {
			logger.SysLogf("批量导入到 Elasticsearch 完成: eid=%d", eid)
		}
	}()

	c.JSON(http.StatusOK, model.Success.ToResponse(&BatchImportResponse{
		Message: "批量导入任务已启动，正在后台处理",
		Status:  "processing",
	}))
}

// BatchImportRequest 批量导入请求
type BatchImportRequest struct {
	LibraryIDs []int64 `json:"library_ids"` // 知识库ID列表，为空则导入所有
	BatchSize  int     `json:"batch_size"`  // 批处理大小，默认100
}

// BatchImportResponse 批量导入响应
type BatchImportResponse struct {
	Message    string `json:"message"`
	Status     string `json:"status"`
	TotalCount int64  `json:"total_count,omitempty"`
	Processed  int64  `json:"processed,omitempty"`
	Failed     int64  `json:"failed,omitempty"`
}

// performBatchImportToES 执行批量导入到 Elasticsearch
func performBatchImportToES(eid int64, req *BatchImportRequest) error {
	esClient := elasticsearch.GetGlobalClient()
	if esClient == nil || esClient.IsDisabled() {
		return errors.New("Elasticsearch 服务不可用")
	}

	// 创建文件搜索服务
	esSearchService := elasticsearch.NewFileNameSearchService(esClient, model.DB)

	offset := 0
	totalProcessed := int64(0)
	totalFailed := int64(0)

	for {
		// 分批查询文件
		var files []model.File
		query := model.DB.Where("eid = ? AND is_deleted = ? AND type = ?", eid, false, model.FILE_TYPE_FILE)

		// 添加过滤条件
		if len(req.LibraryIDs) > 0 {
			query = query.Where("library_id IN ?", req.LibraryIDs)
		}

		// 分页查询
		if err := query.Offset(offset).Limit(req.BatchSize).Find(&files).Error; err != nil {
			return fmt.Errorf("查询文件失败: %v", err)
		}

		if len(files) == 0 {
			break // 没有更多数据
		}

		// 批量索引到 Elasticsearch
		if err := esSearchService.IndexFilesBatch(files); err != nil {
			logger.SysLogf("批量索引失败: batch=%d, error=%v", offset/req.BatchSize, err)
			totalFailed += int64(len(files))
		} else {
			totalProcessed += int64(len(files))
			logger.SysLogf("批量索引成功: batch=%d, count=%d", offset/req.BatchSize, len(files))
		}

		offset += req.BatchSize

		// 避免过于频繁的处理
		if len(files) == req.BatchSize {
			time.Sleep(100 * time.Millisecond)
		}
	}

	logger.SysLogf("批量导入完成: eid=%d, processed=%d, failed=%d", eid, totalProcessed, totalFailed)
	return nil
}

// searchFileNameByDatabase 数据库搜索降级方案
func searchFileNameByDatabase(eid int64, req SearchRequest) (*elasticsearch.FileNameSearchResponse, error) {
	// 使用数据库的LIKE查询进行简单搜索
	var files []model.File
	query := model.DB.Where("eid = ? AND is_deleted = ?", eid, false)

	// 添加知识库过滤
	if len(req.LibraryIDs) > 0 {
		query = query.Where("library_id IN ?", req.LibraryIDs)
	}

	// 添加路径模糊匹配
	if req.Query != "" {
		query = query.Where("path LIKE ?", "%"+req.Query+"%")
	}

	// 限制结果数量
	if req.TopK <= 0 {
		req.TopK = 20
	}
	query = query.Limit(req.TopK)

	// 执行查询
	if err := query.Find(&files).Error; err != nil {
		return nil, fmt.Errorf("数据库搜索失败: %v", err)
	}

	// 转换为搜索结果格式
	var results []elasticsearch.FileNameSearchResult
	for _, file := range files {
		// 获取知识库信息
		library, _ := model.GetLibraryByID(eid, file.LibraryID)
		libraryName := ""
		spaceID := int64(0)
		spaceName := ""

		if library != nil {
			libraryName = library.Name
			spaceID = library.SpaceID
		}

		// 获取空间信息
		if spaceID > 0 {
			space, _ := model.GetSpaceByID(eid, spaceID)
			if space != nil {
				spaceName = space.Name
			}
		}

		// 获取创建人信息
		creatorID := file.UserID
		creatorName := ""
		if creatorID > 0 {
			if creator, err := model.GetUserByID(creatorID); err == nil {
				creatorName = creator.Nickname
				if creatorName == "" {
					creatorName = creator.Username
				}
			}
		}

		// 使用现有的 model 方法提取文件名
		fileName := model.ExtractSimpleFileName(file.Path)
		baseName := model.ExtractSimpleBaseName(file.Path)

		// 使用现有方法获取最新文件内容更新时间
		latestUpdateTime := int64(0)
		if fileBody, err := model.GetLastFileBodyByFileID(eid, file.ID); err == nil {
			latestUpdateTime = fileBody.UpdatedTime
		}

		result := elasticsearch.FileNameSearchResult{
			FileID:                   file.ID,
			LibraryID:                file.LibraryID,
			Path:                     file.Path,
			FileName:                 fileName,
			BaseName:                 baseName,
			Type:                     file.Type,
			Score:                    1.0, // 数据库搜索使用固定分数
			Highlight:                "",  // 数据库搜索不支持高亮
			LibraryName:              libraryName,
			SpaceID:                  spaceID,
			SpaceName:                spaceName,
			CreatorID:                creatorID,
			CreatorName:              creatorName,
			IsDeleted:                file.IsDeleted,
			LatestFileBodyUpdateTime: latestUpdateTime,
		}
		results = append(results, result)
	}

	response := &elasticsearch.FileNameSearchResponse{
		Results: results,
		Total:   int64(len(results)),
		Time:    0, // 数据库搜索不计时
		Query:   req.Query,
	}

	return response, nil
}

// autoCompleteByDatabase 数据库自动补全降级方案
func autoCompleteByDatabase(eid int64, pattern string, libraryIDs []int64, limit int) ([]string, error) {
	// 使用数据库的LIKE查询进行简单自动补全
	var files []model.File
	query := model.DB.Where("eid = ? AND is_deleted = ?", eid, false)

	// 添加知识库过滤
	if len(libraryIDs) > 0 {
		query = query.Where("library_id IN ?", libraryIDs)
	}

	// 添加路径前缀匹配
	if pattern != "" {
		query = query.Where("path LIKE ?", pattern+"%")
	}

	// 限制结果数量
	if limit <= 0 {
		limit = 10
	}
	query = query.Limit(limit)

	// 执行查询
	if err := query.Find(&files).Error; err != nil {
		return nil, fmt.Errorf("数据库自动补全失败: %v", err)
	}

	// 提取唯一路径
	seen := make(map[string]bool)
	var suggestions []string
	for _, file := range files {
		if file.Path != "" && !seen[file.Path] {
			suggestions = append(suggestions, file.Path)
			seen[file.Path] = true
		}
	}

	return suggestions, nil
}

// FileNameAutoComplete godoc
// @Summary 文件名自动补全
// @Description 根据输入模式基于path字段提供文件名自动补全建议
// @Tags 文件管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param pattern query string true "输入模式"
// @Param library_ids query []int false "知识库ID列表"
// @Param limit query int false "建议数量限制" default(10)
// @Success 200 {object} model.CommonResponse{data=[]string}
// @Router /api/files/autocomplete [get]
func FileNameAutoComplete(c *gin.Context) {
	eid := config.GetEID(c)

	// 解析请求参数
	pattern := c.Query("pattern")
	if pattern == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("输入模式不能为空")))
		return
	}

	limit := 10
	if limitStr := c.Query("limit"); limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 {
			limit = l
		}
	}

	var libraryIDs []int64
	// 优先使用数组格式 library_ids[]=1&library_ids[]=2
	if libraryIDsArr := c.QueryArray("library_ids[]"); len(libraryIDsArr) > 0 {
		libraryIDs = parseLibraryIDs(eid, libraryIDsArr)
	} else if libraryIDsStr := c.Query("library_ids"); libraryIDsStr != "" {
		// 兼容逗号分隔格式 library_ids=1,2,3
		libIDs := strings.Split(libraryIDsStr, ",")
		libraryIDs = parseLibraryIDs(eid, libIDs)
	}

	// 使用Elasticsearch进行自动补全
	esClient := elasticsearch.GetGlobalClient()
	if esClient == nil || esClient.IsDisabled() {
		// 优雅降级：尝试数据库自动补全
		logger.SysLogf("Elasticsearch不可用，尝试数据库自动补全: eid=%d, pattern=%s", eid, pattern)
		suggestions, err := autoCompleteByDatabase(eid, pattern, libraryIDs, limit)
		if err != nil {
			c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
			return
		}
		logger.SysLogf("数据库自动补全完成: eid=%d, pattern=%s, suggestions=%d", eid, pattern, len(suggestions))
		c.JSON(http.StatusOK, model.Success.ToResponse(suggestions))
		return
	}

	// 创建文件搜索服务
	esSearchService := elasticsearch.NewFileNameSearchService(esClient, model.DB)

	// 执行自动补全搜索
	suggestions, err := esSearchService.GetFileNamesByPattern(eid, pattern, libraryIDs, limit)
	if err != nil {
		logger.SysLogf("文件名自动补全失败: eid=%d, pattern=%s, err=%v", eid, pattern, err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	logger.SysLogf("文件名自动补全完成: eid=%d, pattern=%s, suggestions=%d", eid, pattern, len(suggestions))
	c.JSON(http.StatusOK, model.Success.ToResponse(suggestions))
}

// FileEditLock godoc
// @Summary 文件编辑锁操作
// @Description 文件编辑锁接口，支持获取/续期锁(add)和释放锁(delete)操作
// @Tags 文件管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param file_id path int true "文件ID"
// @Param request body FileEditLockRequest true "锁操作请求"
// @Success 200 {object} model.CommonResponse{data=FileEditLockResponse}
// @Router /api/files/{file_id}/edit-lock [post]
func FileEditLock(c *gin.Context) {
	// 获取文件ID
	fileIDStr := c.Param("file_id")
	fileID, err := strconv.ParseInt(fileIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的文件ID")))
		return
	}

	// 解析请求参数
	var req FileEditLockRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 获取用户信息
	eid := config.GetEID(c)
	userID := config.GetUserId(c)
	userName := config.GetUserNickname(c)

	if userID == 0 {
		c.JSON(http.StatusUnauthorized, model.AuthFailed.ToResponse(errors.New("用户未登录")))
		return
	}

	// 检查文件是否存在
	file, err := model.GetFileByID(eid, fileID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(errors.New("文件不存在")))
		return
	}

	// 检查文件类型，只有文档类型才能编辑
	if file.Type != model.FILE_TYPE_FILE {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("只有文档类型的文件才能编辑")))
		return
	}

	// 新权限：编辑锁前置校验编辑权限
	permisson, err := service.GetUserPermission(eid, model.RESOURCE_TYPE_FILE, fileID, userID)
	if err != nil || permisson < model.PERMISSION_EDIT_KNOWLEDGE {
		c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(err))
		return
	}

	// 创建锁服务实例
	lockService := service.NewFileEditLockService()

	// 根据操作类型执行相应操作
	switch req.Action {
	case "add":
		// 尝试获取或续期锁
		lockInfo, err := lockService.TryLock(fileID, userID, userName)
		if err != nil {
			// 检查是否是因为其他用户占用锁
			if lockInfo != nil && lockInfo.UserID != userID {
				response := FileEditLockResponse{
					FileID:    fileID,
					UserID:    lockInfo.UserID,
					UserName:  lockInfo.UserName,
					ExpiresAt: lockInfo.ExpiresAt,
					Message:   err.Error(),
					Success:   false,
				}
				c.JSON(http.StatusConflict, model.Success.ToResponse(response))
				return
			}
			c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(err))
			return
		}

		response := FileEditLockResponse{
			FileID:    fileID,
			UserID:    lockInfo.UserID,
			UserName:  lockInfo.UserName,
			ExpiresAt: lockInfo.ExpiresAt,
			Message:   "锁定成功",
			Success:   true,
		}
		c.JSON(http.StatusOK, model.Success.ToResponse(response))

	case "delete":
		// 释放锁
		err := lockService.ReleaseLock(fileID, userID)
		if err != nil {
			response := FileEditLockResponse{
				FileID:  fileID,
				Message: err.Error(),
				Success: false,
			}
			c.JSON(http.StatusBadRequest, model.Success.ToResponse(response))
			return
		}

		response := FileEditLockResponse{
			FileID:  fileID,
			Message: "释放成功",
			Success: true,
		}
		c.JSON(http.StatusOK, model.Success.ToResponse(response))

	default:
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的操作类型")))
	}
}

// UpdateFileIndexingStatusRequest 更新文件索引状态请求
type UpdateFileIndexingStatusRequest struct {
	Status string `json:"status" binding:"required,oneof=normal disabled" example:"normal"` // 状态: normal(启用) | disabled(禁用)，实际操作ParsingStatus字段
	Reason string `json:"reason" example:"用户主动禁用"`                                          // 禁用原因（仅当status=disabled时需要）
}

// UpdateFileIndexingStatus godoc
// @Summary 更新文件索引状态
// @Description 启用或禁用文件的索引状态，禁用时会删除所有相关索引数据，启用时会重新建立索引
// @Tags 文件管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param file_id path string true "文件ID" example(1)
// @Param request body UpdateFileIndexingStatusRequest true "索引状态更新请求"
// @Success 200 {object} model.CommonResponse "成功更新文件索引状态"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 403 {object} model.CommonResponse "权限不足"
// @Failure 404 {object} model.CommonResponse "文件不存在"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/files/{file_id}/index-status [put]
func UpdateFileIndexingStatus(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	// 获取文件ID
	fileIDStr := c.Param("file_id")
	fileID, err := strconv.ParseInt(fileIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 解析请求体
	var req UpdateFileIndexingStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 获取文件信息
	file, err := model.GetFileByID(eid, fileID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
		return
	}

	// 检查文件编辑权限
	maxPermission, err := service.GetUserPermission(eid, model.RESOURCE_TYPE_FILE, fileID, userID)
	if err != nil || maxPermission < model.PERMISSION_EDIT_KNOWLEDGE {
		c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(err))
		return
	}

	// 验证状态转换
	if err := model.ValidateIndexingTransition(file.ParsingStatus, req.Status); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 使用统一的服务管理器
	serviceManager := service.GetServiceManager()
	if serviceManager == nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse("服务管理器未初始化"))
		return
	}

	// 执行状态更新
	switch req.Status {
	case model.FileParsingStatusDisabled:
		// 禁用索引：删除所有相关索引数据
		err = disableFileIndexing(serviceManager, eid, fileID, userID, req.Reason)
	case model.FileParsingStatusNormal:
		// 启用索引：重新建立索引
		err = enableFileIndexing(serviceManager, eid, fileID, userID)
	}

	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	var message string
	if req.Status == model.FileParsingStatusDisabled {
		message = "文件索引已禁用"
	} else {
		message = "文件索引已启用，正在重新建立索引"
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(message))
}

// FileStatsResponse 文件统计响应
type FileStatsResponse struct {
	TotalFiles            int64 `json:"total_files"`             // 未删除总文件数
	ConversionNormalCount int64 `json:"conversion_normal_count"` // conversion_status = normal 的数量
	ParsingNormalCount    int64 `json:"parsing_normal_count"`    // parsing_status = normal 的数量
	TotalCharacterCount   int64 `json:"total_character_count"`   // 总字符数
}

// GetFileStats godoc
// @Summary 获取文件统计信息
// @Description 按eid统计未删除总文件数，并统计conversion_status、parsing_status为normal的数量，支持按知识库过滤
// @Tags 文件管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param library_id path int false "知识库ID"
// @Success 200 {object} model.CommonResponse{data=FileStatsResponse}
// @Router /api/files/stats [get]
// @Router /api/files/libraries/{library_id}/stats [get]
func GetFileStats(c *gin.Context) {
	eid := config.GetEID(c)

	// 解析路径参数中的知识库ID（可选）
	libraryIDStr := c.Param("library_id")
	var libraryID int64
	var err error
	if libraryIDStr != "" {
		libraryID, err = strconv.ParseInt(libraryIDStr, 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的知识库ID")))
			return
		}
	}

	var stats FileStatsResponse

	// 优化：使用单个查询完成所有统计，减少数据库压力
	var fileStats struct {
		TotalFiles            int64 `json:"total_files"`
		ConversionNormalCount int64 `json:"conversion_normal_count"`
		ParsingNormalCount    int64 `json:"parsing_normal_count"`
		TotalCharacterCount   int64 `json:"total_character_count"`
	}

	// 构建基础查询条件
	query := model.DB.Model(&model.File{}).
		Select(`
			COUNT(1) as total_files,
			COUNT(CASE WHEN conversion_status = ? THEN 1 END) as conversion_normal_count,
			COUNT(CASE WHEN parsing_status = ? THEN 1 END) as parsing_normal_count,
			SUM(character_count) as total_character_count
		`, model.FileConversionStatusNormal, model.FileParsingStatusNormal).
		Where("eid = ? AND is_deleted = ? AND type = ? ", eid, false, model.FILE_TYPE_FILE)

	// 如果提供了library_id，添加过滤条件
	if libraryID > 0 {
		query = query.Where("library_id = ?", libraryID)
	}

	// 使用 CASE WHEN 进行条件统计，一次查询获取所有数据
	err = query.Scan(&fileStats).Error

	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(fmt.Errorf("统计文件信息失败: %v", err)))
		return
	}

	stats.TotalFiles = fileStats.TotalFiles
	stats.ConversionNormalCount = fileStats.ConversionNormalCount
	stats.ParsingNormalCount = fileStats.ParsingNormalCount
	stats.TotalCharacterCount = fileStats.TotalCharacterCount

	c.JSON(http.StatusOK, model.Success.ToResponse(stats))
}

// DocumentChunkStatsResponse 文档分块统计响应
type DocumentChunkStatsResponse struct {
	TotalChunks  int64            `json:"total_chunks"`  // 未删除文件的分块数量
	StatusStats  map[string]int64 `json:"status_stats"`  // 按status统计的数量
	TotalTokens  int64            `json:"total_tokens"`  // 总token数量
	TotalRecalls int64            `json:"total_recalls"` // 总召回次数
}

// GetDocumentChunkStats godoc
// @Summary 获取文档分块统计信息
// @Description 统计未删除文件的分块数量，按status统计，并统计总token数和总召回次数，支持按知识库过滤
// @Tags 文件管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param library_id path int false "知识库ID"
// @Success 200 {object} model.CommonResponse{data=DocumentChunkStatsResponse}
// @Router /api/document-chunks/stats [get]
// @Router /api/document-chunks/libraries/{library_id}/stats [get]
func GetDocumentChunkStats(c *gin.Context) {
	eid := config.GetEID(c)

	// 解析路径参数中的知识库ID（可选）
	libraryIDStr := c.Param("library_id")
	var libraryID int64
	var err error
	if libraryIDStr != "" {
		libraryID, err = strconv.ParseInt(libraryIDStr, 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的知识库ID")))
			return
		}
	}

	var stats DocumentChunkStatsResponse
	stats.StatusStats = make(map[string]int64)

	// 优化：使用单个查询同时获取总数、状态统计、token总和、召回总和，减少数据库压力
	var chunkStats []struct {
		Status    string
		Count     int64
		TokenSum  int64
		RecallSum int64
	}

	// 构建基础查询
	query := model.DB.Table("document_chunks dc").
		Joins("INNER JOIN files f ON dc.file_id = f.id").
		Where("dc.eid = ? AND f.is_deleted = ?", eid, false)

	// 如果提供了library_id，添加过滤条件
	if libraryID > 0 {
		query = query.Where("f.library_id = ?", libraryID)
	}

	// 使用单个查询获取所有分块统计信息，包括总数、按状态的分组统计、token总和、召回总和
	err = query.Select(`
			dc.status,
			COUNT(*) as count,
			SUM(dc.token_count) as token_sum,
			SUM(dc.recall_count) as recall_sum
		`).
		Group("dc.status").
		Scan(&chunkStats).Error

	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(fmt.Errorf("统计分块信息失败: %v", err)))
		return
	}

	// 计算总数和填充状态统计
	for _, result := range chunkStats {
		stats.TotalChunks += result.Count
		stats.TotalTokens += result.TokenSum
		stats.TotalRecalls += result.RecallSum
		stats.StatusStats[result.Status] = result.Count

		if len(chunkStats) == 1 {
			switch chunkStats[0].Status {
			case "enabled":
				stats.StatusStats["disabled"] = 0
			case "disabled":
				stats.StatusStats["enabled"] = 0
			}
		}
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(stats))
}

// RetrievalChunkStatsResponse 检索块统计响应
type RetrievalChunkStatsResponse struct {
	TotalChunks   int64 `json:"total_chunks"`   // 未删除文件的检索块总数
	DefaultCount  int64 `json:"default_count"`  // 默认索引的块数（retrieval）
	EnhancedCount int64 `json:"enhanced_count"` // 增强索引的块数（summary + question）
	SummaryCount  int64 `json:"summary_count"`  // summary 类型的块数
	QuestionCount int64 `json:"question_count"` // question 类型的块数
}

// GetRetrievalChunkStats godoc
// @Summary 获取检索块统计信息
// @Description 统计未删除文件的检索块总数，retrieval默认索引；summary + question为增强索引，支持按知识库过滤
// @Tags 文件管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param library_id path int false "知识库ID"
// @Success 200 {object} model.CommonResponse{data=RetrievalChunkStatsResponse}
// @Router /api/retrieval-chunks/stats [get]
// @Router /api/retrieval-chunks/libraries/{library_id}/stats [get]
func GetRetrievalChunkStats(c *gin.Context) {
	eid := config.GetEID(c)

	// 解析路径参数中的知识库ID（可选）
	libraryIDStr := c.Param("library_id")
	var libraryID int64
	var err error
	if libraryIDStr != "" {
		libraryID, err = strconv.ParseInt(libraryIDStr, 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的知识库ID")))
			return
		}
	}

	var stats RetrievalChunkStatsResponse

	// 优化：使用单个查询获取所有检索块统计信息
	var chunkStats []struct {
		ChunkType string
		Count     int64
	}

	// 构建基础查询
	query := model.DB.Table("retrieval_chunks rc").
		Joins("INNER JOIN files f ON rc.file_id = f.id").
		Where("rc.eid = ? AND f.is_deleted = ?", eid, false)

	// 如果提供了library_id，添加过滤条件
	if libraryID > 0 {
		query = query.Where("f.library_id = ?", libraryID)
	}

	err = query.Select(`
			rc.chunk_type,
			COUNT(*) as count
		`).
		Group("rc.chunk_type").
		Scan(&chunkStats).Error

	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(fmt.Errorf("统计检索块信息失败: %v", err)))
		return
	}

	// 计算总数和各种类型统计
	for _, result := range chunkStats {
		stats.TotalChunks += result.Count

		switch result.ChunkType {
		case "summary":
			stats.SummaryCount = result.Count
			stats.EnhancedCount += result.Count
		case "question":
			stats.QuestionCount = result.Count
			stats.EnhancedCount += result.Count
		case "retrieval":
			stats.DefaultCount += result.Count
		}
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(stats))
}

// GenerateQuestionsAndSummary godoc
// @Summary 生成问题和简介
// @Description 为指定文件生成相关问题和简介，使用 GenerateQuestionsAndSummaryPipeline 流水线处理
// @Tags 文件管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param file_id path int true "文件ID"
// @Success 200 {object} model.CommonResponse{data=model.RagJob} "任务创建成功，返回任务信息"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 403 {object} model.CommonResponse "权限不足"
// @Failure 404 {object} model.CommonResponse "文件不存在"
// @Failure 429 {object} model.CommonResponse "请求过于频繁"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/files/{file_id}/generate-questions-and-summary [post]
func GenerateQuestionsAndSummary(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	// 获取文件ID
	fileIDStr := c.Param("file_id")
	if fileIDStr == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("文件ID不能为空")))
		return
	}

	fileID, err := strconv.ParseInt(fileIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的文件ID")))
		return
	}

	// 验证文件是否存在
	file, err := model.GetFileByID(eid, fileID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(errors.New("文件不存在")))
		return
	}

	// 检查用户是否有权限访问该文件
	permission, err := service.GetUserPermission(eid, model.RESOURCE_TYPE_FILE, fileID, userID)
	if err != nil || permission < model.PERMISSION_VIEW_ONLY {
		c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(errors.New("没有权限访问该文件")))
		return
	}

	// 1. 幂等检查：已有任务或已有结果则直接返回
	jobTypes := []string{"summary_generation", "generate_questions_and_summary"}
	var existingJob model.RagJob
	if err := model.DB.Where("eid = ? AND related_id = ? AND type IN ?",
		eid, fileID, jobTypes).Order("job_id DESC").First(&existingJob).Error; err == nil {
		if existingJob.Status == model.RagJobStatusPending || existingJob.Status == model.RagJobStatusProcessing {
			c.JSON(http.StatusOK, model.Success.ToResponse(existingJob))
			return
		}
		if existingJob.Status == model.RagJobStatusSuccess {
			c.JSON(http.StatusOK, model.Success.ToResponse(existingJob))
			return
		}
	}

	// 文件已生成成功，直接返回（避免重复创建任务）
	if file.AIGenerateSQStatus == model.AIGenerateSQStatusNormal &&
		(strings.TrimSpace(file.Summary) != "" || strings.TrimSpace(file.Questions) != "" || strings.TrimSpace(file.KnowledgeMap) != "") {
		c.JSON(http.StatusOK, model.Success.ToResponse(model.RagJob{
			Eid:       eid,
			Type:      "summary_generation",
			Status:    model.RagJobStatusSuccess,
			RelatedId: fileID,
		}))
		return
	}

	// 如果文件状态显示正在处理中，直接返回 processing
	if file.AIGenerateSQStatus == model.AIGenerateSQStatusPending || file.AIGenerateSQStatus == model.AIGenerateSQStatusParsing {
		c.JSON(http.StatusOK, model.Success.ToResponse(model.RagJob{
			Eid:       eid,
			Type:      "summary_generation",
			Status:    model.RagJobStatusProcessing,
			RelatedId: fileID,
		}))
		return
	}

	// 2. 增加短时并发锁，防止瞬时重复触发
	lockKey := fmt.Sprintf("generate_questions_and_summary:%d", fileID)
	if !common.LOCKER.TryLock(lockKey, 5*time.Second) {
		time.Sleep(300 * time.Millisecond)
		if err := model.DB.Where("eid = ? AND related_id = ? AND type IN ? AND status IN ?",
			eid, fileID, jobTypes, []string{model.RagJobStatusPending, model.RagJobStatusProcessing}).
			Order("job_id DESC").First(&existingJob).Error; err == nil {
			c.JSON(http.StatusOK, model.Success.ToResponse(existingJob))
			return
		}
		c.JSON(http.StatusOK, model.Success.ToResponse(model.RagJob{
			Eid:       eid,
			Type:      "summary_generation",
			Status:    model.RagJobStatusProcessing,
			RelatedId: fileID,
		}))
		return
	}
	// 注意：锁由 Redis TTL 自动过期，无需手动释放

	// 构造 summary_generation 步骤的 RuntimeProfile
	profile := v2model.RuntimeProfile{
		Steps: []v2model.ProfileStep{
			{
				StepKey: "summary_generation",
				RunMode: v2model.RunModeAuto,
				Enabled: true,
				Config:  json.RawMessage(`{"summary_faq":{"enabled":true},"entity_extraction":{"enabled":true}}`),
			},
		},
	}

	jobFactory := service.GetRagJobFactoryV2()
	if jobFactory == nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(errors.New("RAG Job Engine not initialized")))
		return
	}

	params := fmt.Sprintf(`{"file_id":%d, "eid":%d}`, fileID, eid)
	// 使用空 runID 让工厂生成
	jobs, err := jobFactory.CreateJobsFromProfile(context.Background(), eid, profile, 0, params, "")
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	if len(jobs) > 0 {
		c.JSON(http.StatusOK, model.Success.ToResponse(jobs[0]))
	} else {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(errors.New("failed to create job")))
	}
}

// GenerateKnowledgeMap godoc
// @Summary 生成知识地图
// @Description 为指定文件生成知识地图，使用 GenerateKnowledgeMapPipeline 流水线处理
// @Tags 文件管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param file_id path int true "文件ID"
// @Success 200 {object} model.CommonResponse{data=model.RagJob} "任务创建成功，返回任务信息"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 403 {object} model.CommonResponse "权限不足或功能未开启"
// @Failure 404 {object} model.CommonResponse "文件不存在"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/files/{file_id}/generate-knowledge-map [post]
func GenerateKnowledgeMap(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	// 获取文件ID
	fileIDStr := c.Param("file_id")
	if fileIDStr == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("文件ID不能为空")))
		return
	}

	fileID, err := strconv.ParseInt(fileIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的文件ID")))
		return
	}

	// 验证文件是否存在
	_, err = model.GetFileByID(eid, fileID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(errors.New("文件不存在")))
		return
	}

	// 检查用户是否有权限访问该文件
	permission, err := service.GetUserPermission(eid, model.RESOURCE_TYPE_FILE, fileID, userID)
	if err != nil || permission < model.PERMISSION_VIEW_ONLY {
		c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(errors.New("没有权限访问该文件")))
		return
	}

	// 检查知识地图功能是否开启
	kmSetting, err := model.ValidateOrCreateKmKnowledgeMapSetting(eid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(fmt.Errorf("获取知识地图配置失败: %v", err)))
		return
	}

	if !kmSetting.Enabled {
		c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(errors.New("知识地图功能未开启")))
		return
	}

	// 1. 检查是否已有同类型任务
	var existingJob model.RagJob
	err = model.DB.Where("eid = ? AND type = ? AND related_id = ?",
		eid, "generate_knowledge_map", fileID).
		Order("job_id DESC").
		First(&existingJob).Error
	if err == nil {
		// 如果找到正在运行的任务，直接返回该任务信息
		if existingJob.Status == model.RagJobStatusPending || existingJob.Status == model.RagJobStatusProcessing {
			c.JSON(http.StatusOK, model.Success.ToResponse(existingJob))
			return
		}

		// 如果任务已成功，且没有强制重生成的参数，则直接返回（幂等处理）
		// 除非有 force=true 参数（暂未实现，可作为后续扩展）
		if existingJob.Status == model.RagJobStatusSuccess {
			c.JSON(http.StatusOK, model.Success.ToResponse(existingJob))
			return
		}
	}

	// 2. 增加 5 秒并发锁，防止极短时间内重复触发
	lockKey := fmt.Sprintf("generate_knowledge_map:%d", fileID)
	if !common.LOCKER.TryLock(lockKey, 5*time.Second) {
		// 锁失败也不报错，尝试再次查询数据库（处理并发创建的间隙）
		time.Sleep(500 * time.Millisecond)
		if err := model.DB.Where("eid = ? AND type = ? AND related_id = ? AND status IN ?",
			eid, "generate_knowledge_map", fileID, []string{model.RagJobStatusPending, model.RagJobStatusProcessing}).
			First(&existingJob).Error; err == nil {
			c.JSON(http.StatusOK, model.Success.ToResponse(existingJob))
			return
		}
		// 如果依然没有，返回一个模拟的 processing 状态，不报错
		c.JSON(http.StatusOK, model.Success.ToResponse(model.RagJob{
			Eid:       eid,
			Type:      "generate_knowledge_map",
			Status:    model.RagJobStatusProcessing,
			RelatedId: fileID,
		}))
		return
	}
	// 注意：分布式锁由 Redis 自动过期，无需手动释放，以保证 5 秒内不会有第二个请求进入查询环节

	if err := model.IncrementKmKnowledgeMapField(eid, model.KmKnowledgeMapStatFieldGenerateCount, 1); err != nil {
		logger.Errorf(c.Request.Context(), "记录知识地图生成次数失败: %v", err)
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(errors.New("记录知识地图生成次数失败")))
		return
	}

	// 构建启动参数
	startParams := map[string]interface{}{
		"eid":     eid,
		"file_id": fileID,
		"user_id": userID,
	}
	startParamsJSON, _ := json.Marshal(startParams)

	jobs, err := service.GetRagJobFactoryV2().CreateJobsForFile(c.Request.Context(), eid, fileID, string(startParamsJSON))
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(fmt.Errorf("创建任务失败: %v", err)))
		return
	}
	if len(jobs) == 0 {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(errors.New("未创建任务")))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(jobs[0]))
}

// RecordKnowledgeMapQuery godoc
// @Summary 记录知识地图查询
// @Description 前端展示知识地图时调用，用于统计查询次数
// @Tags 知识地图
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param file_id path int true "文件ID"
// @Success 200 {object} model.CommonResponse "记录成功"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 403 {object} model.CommonResponse "权限不足或功能未开启"
// @Failure 404 {object} model.CommonResponse "文件不存在"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/files/{file_id}/knowledge-map/record-query [post]
func RecordKnowledgeMapQuery(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	fileIDStr := c.Param("file_id")
	if fileIDStr == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("文件ID不能为空")))
		return
	}

	fileID, err := strconv.ParseInt(fileIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的文件ID")))
		return
	}

	_, err = model.GetFileByID(eid, fileID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(errors.New("文件不存在")))
		return
	}

	permission, err := service.GetUserPermission(eid, model.RESOURCE_TYPE_FILE, fileID, userID)
	if err != nil || permission < model.PERMISSION_VIEW_ONLY {
		c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(errors.New("没有权限访问该文件")))
		return
	}

	kmSetting, err := model.ValidateOrCreateKmKnowledgeMapSetting(eid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(fmt.Errorf("获取知识地图配置失败: %v", err)))
		return
	}
	if !kmSetting.Enabled {
		c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(errors.New("知识地图功能未开启")))
		return
	}

	if err := model.IncrementKmKnowledgeMapField(eid, model.KmKnowledgeMapStatFieldQueryCount, 1); err != nil {
		logger.Errorf(c.Request.Context(), "记录知识地图查询次数失败: %v", err)
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(errors.New("记录知识地图查询次数失败")))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}

type KnowledgeMapStatsRequest struct {
	StartDate int64 `json:"start_date" form:"start_date" binding:"required"`
	EndDate   int64 `json:"end_date" form:"end_date" binding:"required"`
}

// GetKnowledgeMapStatsSum godoc
// @Summary 获取知识地图统计汇总
// @Description 根据日期范围获取知识地图生成次数和查询次数汇总
// @Tags 知识地图
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param start_date query int64 true "开始日期时间戳"
// @Param end_date query int64 true "结束日期时间戳"
// @Success 200 {object} model.CommonResponse{data=model.KmKnowledgeMapStats} "Success"
// @Router /api/knowledge_map_stats/sum [get]
func GetKnowledgeMapStatsSum(c *gin.Context) {
	var req KnowledgeMapStatsRequest
	if err := c.ShouldBindQuery(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	eid := config.GetEID(c)
	startDate := time.Unix(req.StartDate, 0)
	endDate := time.Unix(req.EndDate, 0)

	stats, err := model.SumKmKnowledgeMapStatsByDateRange(eid, startDate, endDate)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(stats))
}
