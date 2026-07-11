package controller

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/storage"
	"github.com/53AI/53AIHub/common/utils"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/53AI/53AIHub/service/document"
	"github.com/53AI/53AIHub/service/rag"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type FileBodyRequest struct {
	FileID    int64  `json:"file_id" binding:"required"`
	Content   string `json:"content"`
	AutoChunk *bool  `json:"auto_chunk,omitempty"` // 是否自动分块
	ConfigID  *int64 `json:"config_id,omitempty"`  // 分块配置ID
}

type FileBodyResponse struct {
	*model.FileBody
	ChunkInfo *service.ChunkSummary `json:"chunk_info,omitempty"`
}

var fileBodyAutoChunkingWithPipeline = service.ProcessAutoChunkingWithPipeline

type FileChunksResponse struct {
	FileID          int64             `json:"file_id"`
	FileName        string            `json:"file_name"`
	LibraryID       int64             `json:"library_id"`
	ViewMode        string            `json:"view_mode"`
	Status          string            `json:"status"`
	OriginalContent string            `json:"original_content,omitempty"`
	Chunks          []ChunkDetailInfo `json:"chunks,omitempty"`
}

type ChunkDetailInfo struct {
	ID              int64  `json:"id"`
	Index           int    `json:"index"`
	Type            string `json:"type"`
	Content         string `json:"content"`
	TokenCount      int    `json:"token_count"`
	StartPosition   int    `json:"start_position"`
	EndPosition     int    `json:"end_position"`
	Status          string `json:"status"`
	EmbeddingStatus string `json:"embedding_status"`
	IsManualEdited  bool   `json:"is_manual_edited"`
	ContentHash     string `json:"content_hash"`
}

// CreateFileBody godoc
// @Summary 创建文件内容
// @Description 创建文件内容接口，使用流水线进行异步分块处理
// @Tags 文件内容管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body FileBodyRequest true "文件内容信息"
// @Success 200 {object} model.CommonResponse{data=model.FileBody} "文件内容创建成功，分块处理将在后台异步执行"
// @Router /api/file-bodies [post]
func CreateFileBody(c *gin.Context) {
	var req FileBodyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	// 获取文件信息以检查权限
	file, err := model.GetFileByID(eid, req.FileID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
		return
	}

	// 检查权限
	permission, err := service.GetUserPermission(eid, model.RESOURCE_TYPE_FILE, req.FileID, userID)
	if err != nil || permission < model.PERMISSION_EDIT_KNOWLEDGE {
		c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(err))
		return
	}

	library, err := model.GetLibraryByID(eid, file.LibraryID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
		return
	}
	isPersonalLibrary := library.IsPersonalLibrary()

	// 处理 file.Path 的扩展名提取
	// 转换文件: readme.html.md -> 提取 .html 作为原始扩展名
	// 原始 md 文件: readme.md -> 保留 .md 扩展名
	// 版本号格式: v0.3.1.md -> 保留 .md 扩展名（不把 .1 当作扩展名）
	filePath := file.Path
	ext := strings.ToLower(filepath.Ext(filePath))
	validSourceExts := map[string]bool{
		".pdf": true, ".docx": true, ".doc": true,
		".html": true, ".htm": true, ".txt": true,
	}
	if ext == ".md" {
		withoutMd := strings.TrimSuffix(filePath, ".md")
		innerExt := strings.ToLower(filepath.Ext(withoutMd))
		if validSourceExts[innerExt] {
			filePath = withoutMd
			ext = innerExt
		}
	}
	content := req.Content

	// 如果是 html/htm，需要转换成 markdown
	if ext == ".html" || ext == ".htm" {
		converter := document.NewConverterService()
		markdownContent, err := converter.ConvertHTMLToMarkdown(req.Content)
		if err != nil {
			c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
			return
		}
		content = markdownContent
	}

	// 只对纯文本文件同步到原始上传文件
	// PDF/Word 等二进制文件不同步，避免覆盖原始文件导致无法重新解析
	if file.UploadFileID != 0 {
		uploadFile, err := model.GetUploadFileByID(file.UploadFileID)
		if err == nil {
			// 获取原始上传文件的扩展名
			uploadExt := strings.ToLower(uploadFile.Extension)
			// 只有纯文本类型才同步：txt、md、html、htm
			if uploadExt == ".txt" || uploadExt == ".md" || uploadExt == ".html" || uploadExt == ".htm" {
				contentBytes := []byte(req.Content)
				if err := storage.StorageInstance.Save(contentBytes, uploadFile.Key); err == nil {
					mimeType := "text/markdown; charset=utf-8"
					if uploadExt == ".txt" {
						mimeType = "text/plain; charset=utf-8"
					} else if uploadExt == ".html" || uploadExt == ".htm" {
						mimeType = "text/html; charset=utf-8"
					}
					uploadFile.UpdateSizeAndMimeType(int64(len(contentBytes)), mimeType)
				}
			}
		}
	}

	fileBody := model.FileBody{
		FileID:    req.FileID,
		LibraryID: file.LibraryID,
		Eid:       eid,
		Content:   content,
		UserID:    userID,
	}

	if err := fileBody.Save(); err != nil {
		c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(err))
		return
	}

	if req.AutoChunk != nil && *req.AutoChunk && !isPersonalLibrary {
		go fileBodyAutoChunkingWithPipeline(eid, file.ID, userID, content, req.ConfigID)
	}
	if req.AutoChunk != nil && *req.AutoChunk && isPersonalLibrary {
		logger.SysLogf("跳过个人知识库文件自动分块: eid=%d file_id=%d library_id=%d", eid, file.ID, file.LibraryID)
	}

	// 记录系统日志 - CreateFileBody 只记录编辑日志
	space, _ := model.GetSpaceByID(eid, library.SpaceID)

	fileName := filepath.Base(file.Path)
	log := model.SystemLog{
		Eid:      eid,
		UserID:   config.GetUserId(c),
		Nickname: config.GetUserNickname(c),
		Module:   model.SystemLogModuleFile,
		Action:   model.SystemLogActionUpdate,
		Content:  fmt.Sprintf("编辑了【%s】知识库【%s】的《%s》", space.Name, library.Name, fileName),
		IP:       utils.GetClientIP(c),
	}
	model.CreateSystemLog(&log)

	// 直接返回文件内容，不包含分块信息
	c.JSON(http.StatusOK, model.Success.ToResponse(&fileBody))
}

// GetLastFileBody godoc
// @Summary 获取文件最新内容
// @Description 获取文件最新内容接口
// @Tags 文件内容管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param file_id path int true "文件ID"
// @Success 200 {object} model.CommonResponse{data=model.FileBody}
// @Router /api/file-bodies/last/{file_id} [get]
func GetLastFileBody(c *gin.Context) {
	fileID, err := strconv.ParseInt(c.Param("file_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	file, ok := requireFilePermission(c, eid, userID, fileID, model.PERMISSION_VIEW_ONLY, "无权限访问此文件")
	if !ok {
		return
	}

	fileBody, err := model.GetLastFileBodyByFileID(eid, file.ID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			// 没有找到文件内容记录 - 返回成功，数据为 null
			c.JSON(http.StatusOK, model.Success.ToResponse(nil))
			return
		}
		c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(err))
		return
	}

	if err := fileBody.LoadContent(); err != nil {
		c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(err))
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(fileBody))
}

// GetFileBodyList godoc
// @Summary 获取文件内容列表
// @Description 获取文件内容列表，默认返回所有数据，可选择筛选是否有发布版本
// @Tags 文件内容管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param file_id path int true "文件ID"
// @Param has_versions query bool false "版本筛选参数（可选）：true-只显示有版本的文件，false-只显示无版本的文件，不传此参数-显示全部文件"
// @Param offset query int false "偏移量" default(0)
// @Param limit query int false "限制数量" default(10)
// @Success 200 {object} model.CommonResponse{data=object}
// @Router /api/file-bodies/{file_id} [get]
func GetFileBodyList(c *gin.Context) {
	fileID, err := strconv.ParseInt(c.Param("file_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	_, ok := requireFilePermission(c, eid, userID, fileID, model.PERMISSION_VIEW_ONLY, "无权限访问此文件")
	if !ok {
		return
	}

	var params model.OffsetParams
	if err := c.ShouldBindQuery(&params); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	if params.Limit == 0 {
		params.Limit = 10
	}

	// 解析版本筛选参数
	var hasVersions *bool
	if hasVersionsStr := c.Query("has_versions"); hasVersionsStr != "" {
		hasVersionsBool := hasVersionsStr == "true"
		hasVersions = &hasVersionsBool
	}

	// 使用支持版本筛选的函数
	fileBodies, total, err := model.GetFileBodyListWithVersionFilter(eid, fileID, hasVersions, params)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(err))
		return
	}

	response := map[string]interface{}{
		"file_bodies": fileBodies,
		"total":       total,
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(response))
}

// GetFileChunksDetail godoc
// @Summary 获取文件分块详情
// @Description 获取文件的所有分块信息，支持按类型筛选
// @Tags 文件内容管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param file_id path int true "文件ID"
// @Param chunk_type query string false "分块类型" Enums(knowledge,retrieval)
// @Param view_mode query string false "查看模式" Enums(original,chunks) default(chunks)
// @Success 200 {object} model.CommonResponse{data=FileChunksResponse}
// @Router /api/file-bodies/{file_id}/chunks [get]
func GetFileChunksDetail(c *gin.Context) {
	fileID, err := strconv.ParseInt(c.Param("file_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	eid := config.GetEID(c)
	userID := config.GetUserId(c)
	chunkType := c.Query("chunk_type")
	viewMode := c.DefaultQuery("view_mode", "chunks")

	file, ok := requireFilePermission(c, eid, userID, fileID, model.PERMISSION_VIEW_ONLY, "无权限访问此文件")
	if !ok {
		return
	}

	// 检查文档是否被锁定
	chunkerService := rag.NewChunkerService(model.DB)
	if chunkerService.IsDocumentLocked(eid, fileID) {
		c.JSON(http.StatusLocked, model.CommonResponse{
			Code:    423,
			Message: "文档正在处理中，请稍后再试",
		})
		return
	}

	// 获取原始文档内容
	fileBody, err := model.GetLastFileBodyByFileID(eid, fileID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(err))
		return
	}
	if err := fileBody.LoadContent(); err != nil {
		c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(err))
		return
	}

	// 从路径中提取文件名
	fileName := filepath.Base(file.Path)
	if fileName == "." || fileName == "/" {
		fileName = "未命名文件"
	}

	response := &FileChunksResponse{
		FileID:          fileID,
		FileName:        fileName,
		LibraryID:       file.LibraryID,
		ViewMode:        viewMode,
		OriginalContent: fileBody.Content,
	}

	if viewMode == "chunks" {
		// 获取分块信息
		chunks, err := getFileChunksWithDetails(eid, fileID, chunkType)
		if err != nil {
			c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
			return
		}
		response.Chunks = chunks
	}

	// 获取分块状态
	status, err := chunkerService.CheckChunkingStatus(eid, fileID)
	if err != nil {
		response.Status = "unknown"
	} else {
		response.Status = status
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(response))
}

// GetChunkingStatus godoc
// @Summary 获取文件分块状态
// @Description 获取文件的分块处理状态和统计信息
// @Tags 文件内容管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param file_id path int true "文件ID"
// @Success 200 {object} model.CommonResponse{data=ChunkingStatusResponse} "分块状态信息"
// @Router /api/file-bodies/{file_id}/chunking-status [get]
func GetChunkingStatus(c *gin.Context) {
	eid := config.GetEID(c)
	// userID := config.GetUserId(c)

	// 解析文件ID
	fileIDStr := c.Param("file_id")
	fileID, err := strconv.ParseInt(fileIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("无效的文件ID"))
		return
	}

	// 获取文件信息以检查权限
	file, err := model.GetFileByID(eid, fileID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
		return
	}

	// 获取分块统计信息
	chunkerService := rag.NewChunkerService(model.DB)
	stats, err := chunkerService.GetChunkUpdateStats(eid, fileID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	// 获取最新的分块日志
	var latestLog *model.ChunkOperationLog
	logs, err := model.GetChunkOperationLogsByFileID(eid, fileID, 1, 0)
	if err == nil && len(logs) > 0 {
		latestLog = &logs[0]
	}

	// 获取文件名（从路径中提取）
	fileName := filepath.Base(file.GetPath())
	if fileName == "." || fileName == "/" {
		fileName = "未命名文件"
	}

	// 构建响应
	response := &ChunkingStatusResponse{
		FileID:          fileID,
		FileName:        fileName,
		LibraryID:       file.LibraryID,
		KnowledgeChunks: stats.KnowledgeChunks,
		RetrievalChunks: stats.RetrievalChunks,
		Relations:       stats.Relations,
		EmbeddedChunks:  stats.EmbeddedChunks,
		Status:          determineChunkingStatus(stats),
	}

	if latestLog != nil {
		response.LastProcessedTime = latestLog.CreatedTime
		response.ProcessingDetails = &ChunkingProcessDetails{
			Operation: latestLog.OperationType,
		}
	}

	// 计算向量化进度
	if stats.KnowledgeChunks > 0 {
		progress := float64(stats.EmbeddedChunks) / float64(stats.KnowledgeChunks) * 100
		response.EmbeddingProgress = &progress
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(response))
}

// ChunkingStatusResponse 分块状态响应
type ChunkingStatusResponse struct {
	FileID            int64                   `json:"file_id"`
	FileName          string                  `json:"file_name"`
	LibraryID         int64                   `json:"library_id"`
	KnowledgeChunks   int64                   `json:"knowledge_chunks"`    // 知识点分块数量
	RetrievalChunks   int64                   `json:"retrieval_chunks"`    // 检索块数量
	Relations         int64                   `json:"relations"`           // 关联关系数量
	EmbeddedChunks    int64                   `json:"embedded_chunks"`     // 已向量化分块数量
	EmbeddingProgress *float64                `json:"embedding_progress"`  // 向量化进度百分比
	Status            string                  `json:"status"`              // 整体状态
	LastProcessedTime int64                   `json:"last_processed_time"` // 最后处理时间
	ProcessingDetails *ChunkingProcessDetails `json:"processing_details"`  // 处理详情
}

// ChunkingProcessDetails 分块处理详情
type ChunkingProcessDetails struct {
	Operation string `json:"operation"` // 操作类型
}

// determineChunkingStatus 确定分块状态
func determineChunkingStatus(stats *rag.ChunkUpdateStats) string {
	if stats.KnowledgeChunks == 0 {
		return "not_chunked" // 未分块
	}

	if stats.EmbeddedChunks == 0 {
		return "chunked_not_embedded" // 已分块但未向量化
	}

	if stats.EmbeddedChunks < stats.KnowledgeChunks {
		return "embedding_in_progress" // 向量化进行中
	}

	return "completed" // 完成
}

// ProcessEmbeddingForNewChunksTest godoc
// @Summary 测试处理新分块的embedding
// @Description 用于测试 processEmbeddingForNewChunks 函数的路由方法
// @Tags 文件内容管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param file_id query int true "文件ID"
// @Success 200 {object} model.CommonResponse "处理成功"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 500 {object} model.CommonResponse "处理失败"
// @Router /api/file-bodies/test-embedding-process [post]
func ProcessEmbeddingForNewChunksTest(c *gin.Context) {
	fileID, err := strconv.ParseInt(c.Query("file_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(fmt.Errorf("file_id 参数错误: %v", err)))
		return
	}

	eid := config.GetEID(c)

	// 调用处理函数
	if err := service.ProcessEmbeddingForNewChunks(eid, fileID); err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(fmt.Errorf("处理embedding失败: %v", err)))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse("处理完成"))
}

// getFileChunksWithDetails 获取文件分块详情
func getFileChunksWithDetails(eid int64, fileID int64, chunkType string) ([]ChunkDetailInfo, error) {
	var chunks []model.DocumentChunk
	query := model.DB.Where("eid = ? AND file_id = ?", eid, fileID)

	if chunkType != "" {
		query = query.Where("chunk_type = ?", chunkType)
	}

	err := query.Order("chunk_index asc").Find(&chunks).Error
	if err != nil {
		return nil, err
	}

	var result []ChunkDetailInfo
	for _, chunk := range chunks {
		result = append(result, ChunkDetailInfo{
			ID:              chunk.ID,
			Index:           chunk.ChunkIndex,
			Type:            chunk.ChunkType,
			Content:         chunk.Content,
			TokenCount:      chunk.TokenCount,
			StartPosition:   chunk.StartPosition,
			EndPosition:     chunk.EndPosition,
			Status:          chunk.Status,
			EmbeddingStatus: chunk.EmbeddingStatus,
			IsManualEdited:  chunk.IsManualEdited,
			ContentHash:     chunk.ContentHash,
		})
	}

	return result, nil
}

// MergeFileChunks godoc
// @Summary 合并文件分块
// @Description 合并指定的文件分块
// @Tags 文件内容管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param file_id path int true "文件ID"
// @Param request body MergeChunksRequest true "合并请求"
// @Success 200 {object} model.CommonResponse{data=model.DocumentChunk}
// @Router /api/file-bodies/{file_id}/chunks/merge [post]
func MergeFileChunks(c *gin.Context) {
	fileID, err := strconv.ParseInt(c.Param("file_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	var req MergeChunksRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	// 检查文档是否被锁定
	chunkerService := rag.NewChunkerService(model.DB)
	if chunkerService.IsDocumentLocked(eid, fileID) {
		c.JSON(http.StatusLocked, model.CommonResponse{
			Code:    423,
			Message: "文档正在处理中，无法编辑",
		})
		return
	}

	// 执行合并
	mergedChunk, err := chunkerService.MergeChunks(eid, fileID, req.ChunkIDs, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	// 同步分块内容到文档
	// go func() {
	// 	err := chunkerService.SyncChunksToDocument(eid, fileID, userID)
	// 	if err != nil {
	// 		fmt.Printf("同步分块内容到文档失败: %v", err)
	// 	}
	// }()

	c.JSON(http.StatusOK, model.Success.ToResponse(mergedChunk))
}

// ReConvertRequest 重新转换请求参数
type ReConvertRequest struct {
	ParseType string `json:"parse_type" binding:"omitempty"`
}

// ReConvert godoc
// @Summary 重新转换文件
// @Description 找到上传源文件，然后使用 ProcessWithUploadFile 并执行 ReindexDocument 逻辑
// @Tags 文件内容管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param file_id path int true "文件ID"
// @Param request body ReConvertRequest false "重新转换参数"
// @Success 200 {object} model.CommonResponse "重新转换任务已启动"
// @Router /api/file-bodies/{file_id}/reconvert [post]
func ReConvert(c *gin.Context) {
	fileID, err := strconv.ParseInt(c.Param("file_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 解析请求参数
	var req ReConvertRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	// 获取文件信息
	file, err := model.GetFileByID(eid, fileID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
		return
	}

	// 检查是否有上传文件
	if file.UploadFileID <= 0 {
		c.JSON(http.StatusBadRequest, model.CommonResponse{
			Code:    400,
			Message: "文件没有关联的上传源文件",
		})
		return
	}

	// 确定实际使用的解析类型
	// 如果用户没有指定 parse_type（空字符串），则使用文件已保存的 ParseType
	actualParseType := req.ParseType
	if actualParseType == "" {
		actualParseType = file.ParseType
	}

	// 创建一个 map 来存放需要更新的字段
	// 只有当用户明确指定了新的解析类型时才更新 file.ParseType
	fileUpdates := make(map[string]interface{})
	if req.ParseType != "" && file.ParseType != req.ParseType {
		// 保存解析方法，用于页面默认选中
		file.ParseType = req.ParseType
		fileUpdates["parse_type"] = req.ParseType
	}

	// 只有当有需要更新的字段时才执行更新操作
	if len(fileUpdates) > 0 {
		if err := model.DB.Model(file).Updates(fileUpdates).Error; err != nil {
			c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
			return
		}
	}

	// 获取上传文件
	uploadFile, err := model.GetUploadFileByID(file.UploadFileID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
		return
	}

	// 使用服务管理器处理重新转换
	serviceManager := service.GetServiceManager()
	if serviceManager == nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse("服务管理器未初始化"))
		return
	}

	params := map[string]interface{}{
		"eid":           uploadFile.Eid,
		"file_id":       fileID,
		"user_id":       userID,
		"library_id":    file.LibraryID,
		"upload_id":     uploadFile.ID,
		"origin_status": file.ConversionStatus,
		"parse_type":    actualParseType,
	}
	paramsJSON, err := json.Marshal(params)
	if err != nil {
		logger.SysErrorf("序列化文档转换任务参数失败: %v", err)
		// 不阻塞主流程，继续执行
	} else {
		jobs, err := service.GetRagJobFactoryV2().CreateJobsForFile(context.Background(), uploadFile.Eid, fileID, string(paramsJSON))
		if err != nil {
			logger.SysErrorf("创建文档转换任务失败: %v", err)
			// 不阻塞主流程，继续执行
		} else if len(jobs) > 0 {
			model.UpdateFileConversionStatus(fileID, model.FileConversionStatusPending)
			fmt.Printf("文档转换任务已创建 - 任务ID: %d\n", jobs[0].JobID)
		}
	}

	c.JSON(http.StatusOK, model.Success.ToResponse("重新转换任务已启动"))
}

// SplitFileChunk godoc
// @Summary 拆分文件分块
// @Description 拆分指定的文件分块
// @Tags 文件内容管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param file_id path int true "文件ID"
// @Param chunk_id path int true "分块ID"
// @Param request body SplitChunkRequest true "拆分请求"
// @Success 200 {object} model.CommonResponse{data=[]model.DocumentChunk}
// @Router /api/file-bodies/{file_id}/chunks/{chunk_id}/split [post]
func SplitFileChunk(c *gin.Context) {
	fileID, err := strconv.ParseInt(c.Param("file_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	chunkID, err := strconv.ParseInt(c.Param("chunk_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	var req SplitChunkRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	// 检查文档是否被锁定
	chunkerService := rag.NewChunkerService(model.DB)
	if chunkerService.IsDocumentLocked(eid, fileID) {
		c.JSON(http.StatusLocked, model.CommonResponse{
			Code:    423,
			Message: "文档正在处理中，无法编辑",
		})
		return
	}

	// 执行拆分
	splitChunks, err := chunkerService.SplitChunk(eid, chunkID, req.SplitContents, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	// 同步分块内容到文档
	// go func() {
	// 	err := chunkerService.SyncChunksToDocument(eid, fileID, userID)
	// 	if err != nil {
	// 		fmt.Printf("同步分块内容到文档失败: %v", err)
	// 	}
	// }()

	c.JSON(http.StatusOK, model.Success.ToResponse(splitChunks))
}
