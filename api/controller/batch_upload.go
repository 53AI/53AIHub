package controller

import (
	"errors"
	"fmt"
	"net/http"

	"github.com/53AI/53AIHub/common/utils"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/gin-gonic/gin"
)

// BatchUploadController 批量上传控制器
type BatchUploadController struct {
	manager         *service.BatchUploadManager
	progressStorage *service.ProgressStorage
}

// NewBatchUploadController 创建批量上传控制器
func NewBatchUploadController() *BatchUploadController {
	manager := service.GetBatchUploadManagerInstance()
	return &BatchUploadController{
		manager:         manager,
		progressStorage: manager.GetProgressStorage(),
	}
}

// InitBatchUpload 初始化批量上传
// @Summary 初始化批量上传
// @Description 创建批量上传会话，返回批次ID、上传令牌和同名文件列表。请求体可选携带 origin_type / origin_source / origin_ref_id，用于显式标记“我的录音”来源；不传则保持默认来源逻辑。
// @Tags 批量上传
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body service.BatchInitRequest true "批量上传初始化请求"
// @Success 200 {object} model.CommonResponse{data=service.BatchInitResponse} "初始化成功，duplicate_files 包含已存在的同名文件信息"
// @Failure 400 {object} model.CommonResponse "请求参数错误"
// @Failure 403 {object} model.CommonResponse "权限不足"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/files/upload/batch/init [post]
func (ctrl *BatchUploadController) InitBatchUpload(c *gin.Context) {
	var req service.BatchInitRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	library, ok := requireLibraryPermission(c, eid, userID, req.LibraryID, model.PERMISSION_EDIT_KNOWLEDGE, "无权限上传到此知识库")
	if !ok {
		return
	}

	// 验证文件结构
	if err := validateFileStructure(req.FileStructure); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	if !library.IsPersonalLibrary() {
		// 检查功能是否可用
		params := map[string]interface{}{
			"from": "document",
			"op":   "add",
		}
		_, err := service.IsFeatureAvailable(c, "knowledge_base", params)
		if err != nil {
			c.JSON(http.StatusForbidden, model.FeatureNotAvailableError.ToResponse(err))
			return
		}
	}

	// 创建批量上传会话
	batch, duplicateFiles, err := ctrl.manager.CreateBatch(eid, userID, &req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	fileMappings := make(map[string]string)
	for fileID, fileUpload := range batch.GetFilesCopy() {
		fileMappings[fileUpload.RelativePath] = fileID
	}

	response := &service.BatchInitResponse{
		BatchID:        batch.ID,
		UploadToken:    batch.UploadToken,
		MaxConcurrent:  config.BATCH_UPLOAD_MAX_CONCURRENT,
		ChunkSize:      config.BATCH_UPLOAD_CHUNK_SIZE,
		FileMappings:   fileMappings,
		DuplicateFiles: duplicateFiles,
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(response))
}

// UploadFile 上传单个文件
// @Summary 上传单个文件
// @Description 上传批量上传中的单个文件，支持同名文件处理模式：sequence(默认)自动添加序号，replace删除原文件
// @Tags 批量上传
// @Accept multipart/form-data
// @Produce json
// @Security BearerAuth
// @Param batch_id path string true "批次ID"
// @Param file formData file true "上传文件"
// @Param upload_token formData string true "上传令牌"
// @Param file_upload_id formData string true "文件ID"
// @Param duplicate_mode formData string false "同名文件处理模式: sequence(默认,自动添加序号), replace(删除原文件)"
// @Success 200 {object} model.CommonResponse "上传成功"
// @Failure 400 {object} model.CommonResponse "请求参数错误"
// @Failure 401 {object} model.CommonResponse "上传令牌无效"
// @Failure 404 {object} model.CommonResponse "批次不存在"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/files/upload/batch/{batch_id}/file [post]
func (ctrl *BatchUploadController) UploadFile(c *gin.Context) {
	batchID := c.Param("batch_id")

	// 验证批次和权限
	batch, err := ctrl.manager.GetBatch(batchID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
		return
	}

	// 获取上传参数
	uploadToken := c.PostForm("upload_token")
	fileID := c.PostForm("file_upload_id")
	duplicateMode := service.DuplicateMode(c.PostForm("duplicate_mode"))
	if duplicateMode == "" {
		duplicateMode = service.DuplicateModeSequence
	}

	// 添加验证file_id是否存在于批次中
	fileUpload, exists := batch.GetFileUpload(fileID)
	if !exists {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的文件ID")))
		return
	}
	relativePath := fileUpload.RelativePath

	// 验证上传令牌
	if !ctrl.manager.ValidateUploadToken(batchID, uploadToken) {
		c.JSON(http.StatusUnauthorized, model.AuthFailed.ToResponse(errors.New("无效的上传令牌")))
		return
	}

	if config.DOCUMENT_SINGLE_FILE_MAX_SIZE > 0 {
		if err := c.Request.ParseMultipartForm(64 << 20); err != nil {
			c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(fmt.Errorf("文件上传信息过大: %v", err)))
			return
		}
	}

	// 获取上传文件
	fileHeader, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	if config.DOCUMENT_SINGLE_FILE_MAX_SIZE > 0 && fileHeader.Size > config.DOCUMENT_SINGLE_FILE_MAX_SIZE {
		c.JSON(http.StatusBadRequest, model.FileError.ToResponse(
			fmt.Errorf("文件大小超过限制，最大允许: %dMB", config.DOCUMENT_SINGLE_FILE_MAX_SIZE/(1024*1024))))
		return
	}

	// 提交上传任务
	task := &service.UploadTask{
		BatchID:       batchID,
		FileID:        fileID,
		RelativePath:  relativePath,
		FileHeader:    fileHeader,
		UserID:        batch.UserID,
		EID:           batch.EID,
		LibraryID:     batch.LibraryID,
		BasePath:      batch.BasePath,
		OriginType:    batch.OriginType,
		OriginSource:  batch.OriginSource,
		OriginRefID:   batch.OriginRefID,
		Nickname:      config.GetUserNickname(c),
		IP:            utils.GetClientIP(c),
		DuplicateMode: duplicateMode,
	}

	err = ctrl.manager.SubmitUploadTask(task)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(gin.H{
		"file_upload_id": fileID,
		"status":         "queued",
	}))
}

// GetProgress 获取上传进度（轮询方式）
// @Summary 获取上传进度
// @Description 获取批量上传的进度信息
// @Tags 批量上传
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param batch_id path string true "批次ID"
// @Param detail query bool false "是否返回详细信息"
// @Param file_upload_id query string false "查询特定文件"
// @Param since query int false "增量查询时间戳"
// @Success 200 {object} model.CommonResponse{data=service.BatchProgressResponse} "查询成功"
// @Failure 400 {object} model.CommonResponse "请求参数错误"
// @Failure 403 {object} model.CommonResponse "权限不足"
// @Failure 404 {object} model.CommonResponse "批次不存在"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/files/upload/batch/{batch_id}/progress [get]
func (ctrl *BatchUploadController) GetProgress(c *gin.Context) {
	batchID := c.Param("batch_id")

	var params service.ProgressQueryParams
	if err := c.ShouldBindQuery(&params); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 验证权限
	batch, err := ctrl.manager.GetBatch(batchID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
		return
	}

	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	if batch.GetEID() != eid || batch.GetUserID() != userID {
		c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(errors.New("无权限查看此批次")))
		return
	}

	// 获取进度信息
	progress, err := ctrl.progressStorage.GetBatchProgress(batchID, &params)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(progress))
}

// CancelBatch 取消批量上传
// @Summary 取消批量上传
// @Description 取消批量上传并清理资源
// @Tags 批量上传
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param batch_id path string true "批次ID"
// @Success 200 {object} model.CommonResponse "取消成功"
// @Failure 404 {object} model.CommonResponse "批次不存在"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/files/upload/batch/{batch_id} [delete]
func (ctrl *BatchUploadController) CancelBatch(c *gin.Context) {
	batchID := c.Param("batch_id")

	// 取消批量上传
	err := ctrl.manager.CancelBatch(batchID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(gin.H{
		"batch_id": batchID,
		"status":   "cancelled",
	}))
}

// validateFileStructure 验证文件结构
func validateFileStructure(structure []service.FileStructureItem) error {
	if len(structure) == 0 {
		return fmt.Errorf("文件结构不能为空")
	}

	// 使用目录管理器验证结构
	dirManager := service.NewDirectoryManager()
	if err := dirManager.ValidateDirectoryStructure(structure); err != nil {
		return err
	}

	// 使用文件处理器验证文件格式和大小
	fileProcessor := service.NewFileProcessor()
	var totalSize int64

	for _, item := range structure {
		if !item.IsDirectory {
			// 验证文件格式
			if !fileProcessor.ValidateFileFormat(item.RelativePath) {
				return fmt.Errorf("不支持的文件格式: %s", item.RelativePath)
			}

			// 验证文件大小
			if !fileProcessor.ValidateFileSize(item.Size) {
				return fmt.Errorf("文件 %s 大小超过限制", item.RelativePath)
			}

			totalSize += item.Size
		}
	}

	// 文件夹上传暂不做总大小限制，根据用户反馈
	// 如果需要限制，可以在这里添加配置项

	return nil
}
