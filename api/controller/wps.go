package controller

import (
	"crypto/md5"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/storage"
	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/middleware"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/pkg/wps/weboffice"
	"github.com/53AI/53AIHub/service"
	"github.com/53AI/53AIHub/service/elasticsearch"
	"github.com/gin-gonic/gin"
)

type WPSTicketResponse struct {
	Ticket string `json:"ticket"`
}

// wrapHandlerFunc 封装返回处理函数
func wrapHandlerFunc(f func(*gin.Context) (any, error)) gin.HandlerFunc {
	return func(c *gin.Context) {
		begin := time.Now()
		data, err := f(c)
		cost := time.Since(begin)

		if err != nil {
			var respErr *weboffice.Error
			if e, ok := err.(*weboffice.Error); ok {
				respErr = e
			} else {
				respErr = weboffice.ErrInternalError.WithMessage(err.Error())
			}

			// 记录详细的错误信息
			logger.SysErrorf("WPS接口调用失败: %s %s 错误码=%d 错误消息=%s 耗时=%s",
				c.Request.Method, c.Request.RequestURI, respErr.Code(), respErr.Message(), cost.String())

			// 记录请求头信息（排除敏感信息）
			headers := make(map[string]string)
			for key, values := range c.Request.Header {
				if key != "Authorization" && key != "X-Upload-Token" {
					headers[key] = strings.Join(values, ",")
				}
			}
			logger.SysErrorf("请求头信息: %+v", headers)

			// 记录请求参数（如果是POST/PUT请求，记录请求体的一部分）
			if c.Request.Method == "POST" || c.Request.Method == "PUT" {
				body, _ := io.ReadAll(c.Request.Body)
				if len(body) > 0 {
					// 限制日志大小，避免记录过大的请求体
					bodyStr := string(body)
					if len(bodyStr) > 500 {
						bodyStr = bodyStr[:500] + "..."
					}
					logger.SysErrorf("请求体内容: %s", bodyStr)
					// 恢复请求体，以便后续处理
					c.Request.Body = io.NopCloser(strings.NewReader(bodyStr))
				}
			}

			c.JSON(respErr.StatusCode(), &weboffice.Reply{Code: respErr.Code(), Message: respErr.Message()})
		} else {
			// 记录成功的调用信息
			logger.SysLogf("WPS接口调用成功: %s %s 耗时=%s",
				c.Request.Method, c.Request.RequestURI, cost.String())

			// 记录响应数据的摘要信息
			if data != nil {
				// 将响应数据转换为JSON字符串，限制长度
				if jsonStr, err := json.Marshal(data); err == nil {
					jsonStrStr := string(jsonStr)
					if len(jsonStrStr) > 500 {
						jsonStrStr = jsonStrStr[:500] + "..."
					}
					logger.SysLogf("响应数据摘要: %s", jsonStrStr)
				}
			}

			c.JSON(http.StatusOK, &weboffice.Reply{Code: weboffice.OK, Data: data})
		}
	}
}

// getWPSFileCommon 公共方法：根据文件ID获取文件信息
func getWPSFileCommon(c *gin.Context, checkUser bool) (*model.File, *weboffice.Error) {
	// 获取文件ID参数
	fileIDStr := c.Param("file_id")
	// 转换成 int64
	fileID, err := strconv.ParseInt(fileIDStr, 10, 64)
	if err != nil {
		return nil, weboffice.ErrInvalidArguments.WithMessage("无效的文件ID")
	}

	ctx, err := weboffice.ParseContext(c.Request, checkUser)
	if err != nil {
		return nil, weboffice.ErrInvalidArguments.WithMessage(err.Error())
	}

	// 判断是否用户存在
	if checkUser && ctx.UserModel() == nil {
		return nil, weboffice.ErrPermissionDenied.WithMessage("用户不存在")
	}

	config, err := model.GetPlatformSettingByExternalID(ctx.Eid(), ctx.AppID(), model.PLATFORM_KEY_WPS)
	if err != nil {
		return nil, weboffice.ErrInternalError.WithMessage("获取平台配置失败")
	}
	if config == nil {
		return nil, weboffice.ErrPermissionDenied.WithMessage("平台配置不存在")
	}

	// 查询文件
	file, err := model.GetFileByID(config.Eid, fileID)
	if err != nil {
		return nil, weboffice.ErrFileNotExists
	}

	file.LoadUploadFile()

	return file, nil
}

// calculateFileHash 计算文件内容的SHA256哈希
func calculateFileHash(fileContent []byte) string {
	hash := sha256.New()
	hash.Write(fileContent)
	hashInBytes := hash.Sum(nil)
	return hex.EncodeToString(hashInBytes)
}

// generateUniqueFileName 生成唯一的文件名，如果重复则添加序号
func generateUniqueFileName(eid, libraryID int64, dirPath, fileName, extension string, excludeFileID int64) string {
	baseName := fileName
	if extension != "" && !strings.HasSuffix(fileName, extension) {
		fileName = fileName + extension
	}

	// 检查是否重复
	counter := 1
	for {
		fullPath := dirPath + "/" + fileName
		if !strings.HasPrefix(dirPath, "/") {
			fullPath = "/" + fullPath
		}

		// 使用现有的GetFileByPath函数检查重复
		existingFile, err := model.GetFileByPath(eid, libraryID, fullPath)
		if err != nil || (existingFile != nil && existingFile.ID == excludeFileID) {
			// 没有找到重复文件或者是同一个文件，可以使用这个文件名
			return fileName
		}

		// 有重复文件，添加序号
		fileName = fmt.Sprintf("%s(%d)%s", baseName, counter, extension)
		counter++
	}
}

// resolveWPSVisibleFileName returns the file name that should be exposed to WPS.
// It strips internal workspace prefixes such as "output/" so the editor only
// sees the user-facing name.
func resolveWPSVisibleFileName(file *model.File) string {
	if file == nil {
		return "file"
	}

	candidates := []string{}
	if file.UploadFile != nil {
		candidates = append(candidates, file.UploadFile.FileName)
	}
	candidates = append(candidates, file.Path)

	for _, candidate := range candidates {
		name := strings.TrimSpace(candidate)
		if name == "" {
			continue
		}
		name = strings.TrimPrefix(name, "/")
		name = path.Base(name)
		if name != "" && name != "." && name != "/" {
			return name
		}
	}

	return "file"
}

func getWPSFile(c *gin.Context) (any, error) {
	file, wpsErr := getWPSFileCommon(c, true)
	if wpsErr != nil {
		return nil, wpsErr
	}

	fileIDStr := c.Param("file_id")
	ctx, err := weboffice.ParseContext(c.Request, true)
	if err != nil {
		return nil, weboffice.ErrInvalidArguments.WithMessage(err.Error())
	}
	wpsFile := &weboffice.GetFileReply{
		CreateTime: file.CreatedTime / 1000,
		CreatorId:  fmt.Sprintf("%d", file.UserID),
		ID:         fileIDStr,
		ModifierId: fmt.Sprintf("%d", ctx.UserModel().UserID),
		ModifyTime: file.UpdatedTime / 1000,
		Name:       resolveWPSVisibleFileName(file),
		Size:       file.UploadFile.Size,
		Version:    int32(file.UpdatedTime / 1000),
	}

	return wpsFile, nil
}

func getWPSFileDownload(c *gin.Context) (any, error) {
	// if c.GetHeader("Referer") != "https://solution.wps.cn" {
	// 	c.String(http.StatusForbidden, "invalid referer")
	// 	return
	// }
	file, wpsErr := getWPSFileCommon(c, true)
	if wpsErr != nil {
		return nil, wpsErr
	}
	downloadURL := file.UploadFile.GetPreviewOrOssDownloadUrl()

	response := gin.H{
		"url": downloadURL,
	}

	return response, nil
}

func getWPSFilePermission(c *gin.Context) (any, error) {
	file, wpsErr := getWPSFileCommon(c, true)
	if wpsErr != nil {
		return nil, wpsErr
	}

	ctx, err := weboffice.ParseContext(c.Request, true)
	if err != nil {
		return nil, weboffice.ErrInvalidArguments.WithMessage(err.Error())
	}
	if ctx.UserModel() == nil {
		return nil, weboffice.ErrPermissionDenied.WithMessage("用户不存在")
	}

	// 获取平台配置
	config, err := model.GetPlatformSettingByExternalID(ctx.Eid(), ctx.AppID(), model.PLATFORM_KEY_WPS)
	if err != nil {
		return nil, weboffice.ErrInternalError.WithMessage("获取平台配置失败")
	}
	if config == nil {
		return nil, weboffice.ErrPermissionDenied.WithMessage("平台配置不存在")
	}

	// 获取用户权限
	permission, err := service.GetUserPermission(ctx.UserModel().Eid, model.RESOURCE_TYPE_FILE, file.ID, ctx.UserModel().UserID)
	if err != nil {
		return nil, weboffice.ErrInternalError.WithMessage("获取用户权限失败")
	}

	// 将系统权限映射到WPS权限格式
	wpsPermission := &weboffice.GetFilePermissionReply{
		Read:     0,
		Update:   0,
		Download: 0,
		Rename:   0,
		History:  0,
		Copy:     0,
		Print:    0,
		SaveAs:   0,
		Comment:  0,
	}

	// 根据权限级别设置WPS权限
	switch permission {
	case model.PERMISSION_NONE:
		// 无权限
		wpsPermission.Read = 0
		wpsPermission.Update = 0
		wpsPermission.Download = 0
	case model.PERMISSION_PUBLIC_ONLY:
		// 仅公开权限，只能预览
		wpsPermission.Read = 1
		wpsPermission.Update = 0
		wpsPermission.Download = 0
	case model.PERMISSION_VIEW_ONLY:
		// 仅查看权限
		wpsPermission.Read = 1
		wpsPermission.Update = 0
		wpsPermission.Download = 0
	case model.PERMISSION_VIEW_EXPORT:
		// 可查看/导出权限
		wpsPermission.Read = 1
		wpsPermission.Update = 0
		wpsPermission.Download = 1
	case model.PERMISSION_EDIT_KNOWLEDGE:
		// 仅编辑知识权限
		wpsPermission.Read = 1
		wpsPermission.Update = 1
		wpsPermission.Download = 1
		wpsPermission.Comment = 1
	case model.PERMISSION_EDIT_ALL:
		// 可编辑知识/语料权限
		wpsPermission.Read = 1
		wpsPermission.Update = 1
		wpsPermission.Download = 1
		wpsPermission.Comment = 1
		wpsPermission.Copy = 1
	case model.PERMISSION_MANAGE:
		// 管理权限，拥有所有权限
		wpsPermission.Read = 1
		wpsPermission.Update = 1
		wpsPermission.Download = 1
		wpsPermission.Rename = 1
		wpsPermission.History = 0 // 不支持历史版本
		wpsPermission.Copy = 1
		wpsPermission.Print = 1
		wpsPermission.SaveAs = 1
		wpsPermission.Comment = 1
	}

	wpsPermission.UserId = fmt.Sprintf("%d", ctx.UserModel().UserID)
	isReadOnly := ctx.Query().Get("readonly")

	if isReadOnly == "true" {
		// 只读模式，覆盖部分权限
		wpsPermission.Update = 0
		wpsPermission.Rename = 0
		wpsPermission.Print = 0
		wpsPermission.SaveAs = 0
		wpsPermission.History = 0
		wpsPermission.Copy = 0
	}
	return wpsPermission, nil
}

func renameWPSFile(c *gin.Context) (any, error) {
	// 获取文件信息
	file, wpsErr := getWPSFileCommon(c, true)
	if wpsErr != nil {
		return nil, wpsErr
	}

	// 解析请求体
	var req struct {
		Name string `json:"name" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		return nil, weboffice.ErrInvalidArguments.WithMessage("请求参数错误")
	}

	// 验证新文件名
	if strings.TrimSpace(req.Name) == "" {
		return nil, weboffice.ErrInvalidArguments.WithMessage("文件名不能为空")
	}

	// 检查用户是否有重命名权限
	ctx, err := weboffice.ParseContext(c.Request, true)
	if err != nil {
		return nil, weboffice.ErrInvalidArguments.WithMessage(err.Error())
	}
	if ctx.UserModel() == nil {
		return nil, weboffice.ErrPermissionDenied.WithMessage("用户不存在")
	}

	// 获取用户权限
	permission, err := service.GetUserPermission(ctx.UserModel().Eid, model.RESOURCE_TYPE_FILE, file.ID, ctx.UserModel().UserID)
	if err != nil {
		return nil, weboffice.ErrInternalError.WithMessage("获取用户权限失败")
	}

	// 检查是否有重命名权限（只有管理权限可以重命名）
	if permission < model.PERMISSION_MANAGE {
		return nil, weboffice.ErrPermissionDenied.WithMessage("没有重命名权限")
	}

	file.LoadUploadFile()

	uploadFile := file.UploadFile

	if uploadFile == nil {
		return nil, weboffice.ErrInternalError.WithMessage("获取上传文件信息失败")
	}

	// 构建新的完整路径：从当前路径中提取目录，替换文件名部分
	dirPath := file.Path
	if lastSlash := strings.LastIndex(file.Path, "/"); lastSlash >= 0 {
		dirPath = file.Path[:lastSlash]
	}
	newPath := dirPath + "/" + req.Name + ".md"

	// 开启事务
	tx := model.DB.Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	// 如果是目录，更新所有子项的路径
	if file.Type == model.FILE_TYPE_DIR {
		// 获取所有子文件/文件夹
		children, err := model.GetChildrenByPathPrefix(ctx.UserModel().Eid, file.Path)
		if err != nil {
			tx.Rollback()
			return nil, weboffice.ErrInternalError.WithMessage("获取子文件列表失败")
		}

		// 批量更新子路径
		for _, child := range children {
			newChildPath := strings.Replace(child.Path, file.Path, newPath, 1)
			if err := tx.Model(&model.File{}).Where("eid = ? AND id = ?", ctx.UserModel().Eid, child.ID).
				Updates(&model.File{
					Path: newChildPath,
				}).Error; err != nil {
				tx.Rollback()
				return nil, weboffice.ErrInternalError.WithMessage("更新子文件路径失败")
			}
		}
	}

	// 更新文件名和路径
	uploadFile.FileName = req.Name
	if err := uploadFile.Save(); err != nil {
		tx.Rollback()
		return nil, weboffice.ErrInternalError.WithMessage("更新文件名失败")
	}

	// 更新父目录路径
	if err := tx.Model(&model.File{}).Where("eid = ? AND id = ?", ctx.UserModel().Eid, file.ID).
		Updates(&model.File{
			Path: newPath,
		}).Error; err != nil {
		tx.Rollback()
		return nil, weboffice.ErrInternalError.WithMessage("更新文件路径失败")
	}

	if err := tx.Commit().Error; err != nil {
		return nil, weboffice.ErrInternalError.WithMessage("事务提交失败")
	}

	// 同步到 Elasticsearch
	elasticsearch.SyncFileToES(file, "update")

	// 返回空响应
	return map[string]interface{}{}, nil
}

// prepareWPSFileUpload 准备WPS文件上传
func prepareWPSFileUpload(c *gin.Context) (any, error) {
	// 记录请求开始
	logger.Infof(c, "开始处理WPS文件上传准备请求，文件ID: %s", c.Param("file_id"))

	// 获取文件信息
	file, wpsErr := getWPSFileCommon(c, true)
	if wpsErr != nil {
		logger.Errorf(c, "获取文件信息失败: %v", wpsErr)
		return nil, wpsErr
	}

	// 验证文件是否存在
	if file == nil {
		logger.Error(c, "文件不存在")
		return nil, weboffice.ErrFileNotExists
	}

	logger.Infof(c, "成功获取文件信息，文件ID: %d, 文件路径: %s", file.ID, file.Path)

	// 返回支持的摘要算法列表
	response := gin.H{
		"digest_types": []string{"md5"},
	}

	logger.Infof(c, "WPS文件上传准备请求处理完成，返回支持的摘要算法: %v", response["digest_types"])
	return response, nil
}

// UploadAddressRequest 获取上传地址请求体
type UploadAddressRequest struct {
	Name           string            `json:"name" binding:"required"`
	Size           int64             `json:"size" binding:"required"`
	Digest         map[string]string `json:"digest" binding:"required"`
	IsManual       bool              `json:"is_manual"` // 移除 required 标签，默认为 false
	AttachmentSize *int64            `json:"attachment_size,omitempty"`
	ContentType    string            `json:"content_type,omitempty"`
}

// UploadAddressResponse 获取上传地址响应体
type UploadAddressResponse struct {
	Method         string            `json:"method"`
	URL            string            `json:"url"`
	Headers        map[string]string `json:"headers,omitempty"`
	Params         map[string]string `json:"params,omitempty"`
	SendBackParams map[string]string `json:"send_back_params,omitempty"`
}

// getWPSFileUploadAddress 获取WPS文件上传地址
func getWPSFileUploadAddress(c *gin.Context) (any, error) {
	// 记录请求开始
	logger.Infof(c, "开始处理WPS文件上传地址请求，文件ID: %s", c.Param("file_id"))

	// 获取文件信息
	file, wpsErr := getWPSFileCommon(c, true)
	if wpsErr != nil {
		logger.Errorf(c, "获取文件信息失败: %v", wpsErr)
		return nil, wpsErr
	}

	// 验证文件是否存在
	if file == nil {
		logger.Error(c, "文件不存在")
		return nil, weboffice.ErrFileNotExists
	}

	logger.Infof(c, "成功获取文件信息，文件ID: %d, 文件路径: %s", file.ID, file.Path)

	// 解析请求体
	var req UploadAddressRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		logger.Errorf(c, "解析请求体失败: %v", err)
		return nil, weboffice.ErrInvalidArguments.WithMessage("请求参数错误")
	}

	// 记录请求参数
	logger.Infof(c, "请求参数 - 文件名: %s, 文件大小: %d, 摘要: %v, 是否手动: %v, 内容类型: %s",
		req.Name, req.Size, req.Digest, req.IsManual, req.ContentType)

	// 验证文件大小
	if req.Size <= 0 {
		logger.Errorf(c, "文件大小无效: %d", req.Size)
		return nil, weboffice.ErrInvalidArguments.WithMessage("文件大小必须大于0")
	}

	// 验证摘要算法是否支持
	if len(req.Digest) == 0 {
		logger.Error(c, "摘要为空")
		return nil, weboffice.ErrInvalidArguments.WithMessage("摘要不能为空")
	}

	supportedDigests := map[string]bool{"sha1": true, "md5": true, "sha256": true}
	for digestType := range req.Digest {
		if !supportedDigests[digestType] {
			logger.Errorf(c, "不支持的摘要算法: %s", digestType)
			return nil, weboffice.ErrInvalidArguments.WithMessage("不支持的摘要算法: " + digestType)
		}
	}

	// 检查用户权限
	ctx, err := weboffice.ParseContext(c.Request, true)
	if err != nil {
		logger.Errorf(c, "解析WPS上下文失败: %v", err)
		return nil, weboffice.ErrInvalidArguments.WithMessage(err.Error())
	}
	if ctx.UserModel() == nil {
		logger.Error(c, "用户不存在")
		return nil, weboffice.ErrPermissionDenied.WithMessage("用户不存在")
	}

	logger.Infof(c, "成功解析用户信息，用户ID: %d, 企业ID: %d", ctx.UserModel().UserID, ctx.UserModel().Eid)

	// 获取用户权限
	permission, err := service.GetUserPermission(ctx.UserModel().Eid, model.RESOURCE_TYPE_FILE, file.ID, ctx.UserModel().UserID)
	if err != nil {
		logger.Errorf(c, "获取用户权限失败: %v", err)
		return nil, weboffice.ErrInternalError.WithMessage("获取用户权限失败")
	}

	logger.Infof(c, "用户权限值: %d", permission)

	// 检查是否有编辑权限
	if permission < model.PERMISSION_EDIT_KNOWLEDGE {
		logger.Errorf(c, "权限不足，当前权限: %d, 需要权限: %d", permission, model.PERMISSION_EDIT_KNOWLEDGE)
		return nil, weboffice.ErrPermissionDenied.WithMessage("没有编辑权限")
	}

	// 生成原始上传许可字符串
	uploadTokenRaw := fmt.Sprintf("wps_upload_%d_%d_%d", file.ID, ctx.UserModel().UserID, time.Now().Unix())
	logger.Infof(c, "生成原始上传许可字符串: %s", uploadTokenRaw)

	// 使用 MD5 加密生成 uploadToken
	hasher := md5.New()
	hasher.Write([]byte(uploadTokenRaw))
	uploadToken := hex.EncodeToString(hasher.Sum(nil))
	logger.Infof(c, "生成上传许可Token: %s", uploadToken)

	// 将原始信息存入 Redis，过期时间为 3 天
	redisKey := fmt.Sprintf("wps_upload_token_%s", uploadToken)
	redisValue := uploadTokenRaw
	if err := common.RedisSet(redisKey, redisValue, 3*24*time.Hour); err != nil {
		logger.Errorf(c, "存储上传许可到Redis失败: %v", err)
		return nil, weboffice.ErrInternalError.WithMessage("存储上传许可失败")
	}

	logger.Infof(c, "成功存储上传许可到Redis，Key: %s", redisKey)

	// 构建上传地址（这里返回一个临时上传接口地址）
	hashedFileID, err := hashids.Encode(file.ID)
	if err != nil {
		logger.Errorf(c, "加密文件ID失败: %v", err)
		return nil, weboffice.ErrInternalError.WithMessage("加密文件ID失败")
	}
	APIHost := config.GetApiHost()
	uploadURL := fmt.Sprintf("%sapi/wps/v3/3rd/files/%s/upload/execute", APIHost, hashedFileID)
	logger.Infof(c, "生成上传URL: %s", uploadURL)

	// 构建响应
	response := UploadAddressResponse{
		Method: "PUT",
		URL:    uploadURL,
		Headers: map[string]string{
			"X-Upload-Token": uploadToken,
			"Content-Type":   req.ContentType,
		},
		Params: map[string]string{
			"size":      strconv.FormatInt(req.Size, 10),
			"is_manual": strconv.FormatBool(req.IsManual),
		},
		SendBackParams: map[string]string{
			"original_name": req.Name,
			"upload_token":  uploadToken,
		},
	}

	// 记录响应内容
	logger.Infof(c, "构建响应成功 - 方法: %s, URL: %s", response.Method, response.URL)
	logger.Infof(c, "响应头信息: %v", response.Headers)
	logger.Infof(c, "响应参数: %v", response.Params)
	logger.Infof(c, "响应回调参数: %v", response.SendBackParams)

	logger.Infof(c, "WPS文件上传地址请求处理完成，文件ID: %d", file.ID)
	return response, nil
}

// RenameWPSFile godoc
// @Summary 重命名WPS文档
// @Description WPS集成接口，重命名指定文档
// @Tags WPS集成（回调接口）
// @Accept json
// @Produce json
// @Param file_id path string true "文件ID"
// @Param X-App-ID header string true "APP_ID"
// @Param name body object{name=string} true "新文件名"
// @Success 200 {object} weboffice.Reply
// @Failure 400 {object} weboffice.Reply
// @Failure 401 {object} weboffice.Reply
// @Failure 403 {object} weboffice.Reply
// @Failure 404 {object} weboffice.Reply
// @Failure 500 {object} weboffice.Reply
// @Router /api/wps/v3/3rd/files/{file_id}/name [put]
func RenameWPSFile(c *gin.Context) {
	wrapHandlerFunc(renameWPSFile)(c)
}

// PrepareWPSFileUpload godoc
// @Summary 准备WPS文件上传
// @Description WPS三阶段上传第一步：协商摘要算法
// @Tags WPS集成（回调接口）
// @Accept json
// @Produce json
// @Param file_id path string true "文件ID"
// @Param X-App-ID header string true "APP_ID"
// @Success 200 {object} weboffice.Reply{data=map[string][]string}
// @Failure 400 {object} weboffice.Reply
// @Failure 401 {object} weboffice.Reply
// @Failure 403 {object} weboffice.Reply
// @Failure 404 {object} weboffice.Reply
// @Failure 500 {object} weboffice.Reply
// @Router /api/wps/v3/3rd/files/{file_id}/upload/prepare [get]
func PrepareWPSFileUpload(c *gin.Context) {
	wrapHandlerFunc(prepareWPSFileUpload)(c)
}

// GetWPSFileUploadAddress godoc
// @Summary 获取WPS文件上传地址
// @Description WPS三阶段上传第二步：获取上传地址和临时许可
// @Tags WPS集成（回调接口）
// @Accept json
// @Produce json
// @Param file_id path string true "文件ID"
// @Param X-App-ID header string true "APP_ID"
// @Param request body UploadAddressRequest true "上传信息"
// @Success 200 {object} weboffice.Reply{data=UploadAddressResponse}
// @Failure 400 {object} weboffice.Reply
// @Failure 401 {object} weboffice.Reply
// @Failure 403 {object} weboffice.Reply
// @Failure 404 {object} weboffice.Reply
// @Failure 500 {object} weboffice.Reply
// @Router /api/wps/v3/3rd/files/{file_id}/upload/address [post]
func GetWPSFileUploadAddress(c *gin.Context) {
	wrapHandlerFunc(getWPSFileUploadAddress)(c)
}

// executeWPSFileUpload 执行WPS文件上传
func executeWPSFileUpload(c *gin.Context) (any, error) {
	// 记录请求开始
	logger.Infof(c, "开始处理WPS文件上传请求，文件ID: %s", c.Param("file_id"))

	// 获取文件信息
	fileIDStr := c.Param("file_id")
	// 转换成 int64
	fileID, err := strconv.ParseInt(fileIDStr, 10, 64)
	if err != nil {
		return nil, weboffice.ErrInvalidArguments.WithMessage("无效的文件ID")
	}

	// 获取上传许可
	uploadToken := c.GetHeader("X-Upload-Token")
	if uploadToken == "" {
		logger.Error(c, "缺少上传许可")
		return nil, weboffice.ErrPermissionDenied.WithMessage("缺少上传许可")
	}

	logger.Infof(c, "获取到上传许可: %s", uploadToken)

	// 从 Redis 验证上传许可
	redisKey := fmt.Sprintf("wps_upload_token_%s", uploadToken)
	uploadTokenRaw, err := common.RedisGet(redisKey)
	if err != nil {
		logger.Errorf(c, "从Redis验证上传许可失败: %v", err)
		return nil, weboffice.ErrPermissionDenied.WithMessage("上传许可无效或已过期")
	}

	if uploadTokenRaw == "" {
		logger.Errorf(c, "上传许可不存在，Redis Key: %s", redisKey)
		return nil, weboffice.ErrPermissionDenied.WithMessage("上传许可不存在")
	}

	// 从uploadTokenRaw中提取文件ID并验证
	// uploadTokenRaw格式: "wps_upload_%d_%d_%d"，第一个%d是文件ID
	parts := strings.Split(uploadTokenRaw, "_")
	if len(parts) < 4 {
		logger.Errorf(c, "上传许可格式无效: %s", uploadTokenRaw)
		return nil, weboffice.ErrPermissionDenied.WithMessage("上传许可格式无效")
	}

	tokenFileID, err := strconv.ParseInt(parts[2], 10, 64)
	if err != nil {
		logger.Errorf(c, "解析上传许可中的文件ID失败: %v", err)
		return nil, weboffice.ErrPermissionDenied.WithMessage("上传许可中的文件ID无效")
	}

	// 验证文件ID是否匹配
	if tokenFileID != fileID {
		logger.Errorf(c, "文件ID不匹配，上传许可中的文件ID: %d，请求的文件ID: %d", tokenFileID, fileID)
		return nil, weboffice.ErrPermissionDenied.WithMessage("文件ID不匹配")
	}

	logger.Infof(c, "文件ID验证成功，文件ID: %d", fileID)

	file, wpsErr := model.GetFileByIDOlny(fileID)
	if wpsErr != nil {
		logger.Errorf(c, "获取文件信息失败: %v", wpsErr)
		return nil, wpsErr
	}

	// 验证文件是否存在
	if file == nil {
		logger.Error(c, "文件不存在")
		return nil, weboffice.ErrFileNotExists
	}

	logger.Infof(c, "成功获取文件信息，文件ID: %d, 文件路径: %s", file.ID, file.Path)

	// 获取查询参数
	sizeStr := c.Query("size")
	isManualStr := c.Query("is_manual")

	logger.Infof(c, "查询参数 - size: %s, is_manual: %s", sizeStr, isManualStr)

	// 解析文件大小
	var fileSize int64
	if sizeStr != "" {
		if parsedSize, err := strconv.ParseInt(sizeStr, 10, 64); err == nil {
			fileSize = parsedSize
		} else {
			logger.Warnf(c, "解析文件大小失败: %v", err)
		}
	}

	// 读取请求体中的文件流内容
	fileContent, err := io.ReadAll(c.Request.Body)
	if err != nil {
		logger.Errorf(c, "读取文件内容失败: %v", err)
		return nil, weboffice.ErrInternalError.WithMessage("读取文件内容失败: " + err.Error())
	}

	logger.Infof(c, "成功读取文件内容，大小: %d 字节", fileSize)

	// 验证文件大小
	if fileSize > 0 && int64(len(fileContent)) != fileSize {
		logger.Errorf(c, "文件大小不匹配，期望：%d，实际：%d", fileSize, len(fileContent))
		return nil, weboffice.ErrInvalidArguments.WithMessage(fmt.Sprintf("文件大小不匹配，期望：%d，实际：%d", fileSize, len(fileContent)))
	}

	// 加载现有的上传文件信息
	file.LoadUploadFile()
	if file.UploadFile == nil {
		logger.Error(c, "获取上传文件信息失败")
		return nil, weboffice.ErrInternalError.WithMessage("获取上传文件信息失败")
	}

	uploadFile := file.UploadFile
	logger.Infof(c, "成功加载上传文件信息，文件名: %s, Key: %s", uploadFile.FileName, uploadFile.Key)

	// 保存文件内容到storage，覆盖原有文件
	err = storage.StorageInstance.Save(fileContent, uploadFile.Key)
	if err != nil {
		logger.Errorf(c, "保存文件内容到存储失败: %v", err)
		return nil, weboffice.ErrInternalError.WithMessage("保存文件内容失败: " + err.Error())
	}

	logger.Infof(c, "成功保存文件内容到存储")

	// 计算文件内容的哈希
	hash := calculateFileHash(fileContent)
	logger.Infof(c, "计算文件哈希: %s", hash)

	// 更新uploadfile表中的文件信息
	uploadFile.Size = fileSize
	uploadFile.Hash = hash

	// 仅暴露用户可见文件名，避免把沙盒内部路径如 output/ 带回知识库路径。
	fileName := resolveWPSVisibleFileName(file)

	// 提取文件扩展名
	extension := uploadFile.Extension
	if extension == "" && strings.Contains(file.Path, ".") {
		extension = file.Path[strings.LastIndex(file.Path, "."):]
	}

	// 构建新的完整路径：从当前路径中提取目录
	dirPath := file.Path
	if lastSlash := strings.LastIndex(file.Path, "/"); lastSlash >= 0 {
		dirPath = file.Path[:lastSlash]
	}

	// 生成唯一的文件名（避免重复）
	uniqueFileName := generateUniqueFileName(file.Eid, file.LibraryID, dirPath, fileName, extension, file.ID)
	newPath := dirPath + "/" + uniqueFileName

	logger.Infof(c, "生成唯一文件名: %s, 新路径: %s", uniqueFileName, newPath)

	// 开启事务
	logger.Info(c, "开始数据库事务")
	tx := model.DB.Begin()
	defer func() {
		if r := recover(); r != nil {
			logger.Errorf(c, "事务回滚，panic: %v", r)
			tx.Rollback()
		}
	}()

	// 直接更新UploadFile记录，避免Save方法的主键冲突问题
	if err := tx.Model(uploadFile).Where("id = ?", uploadFile.ID).Updates(map[string]interface{}{
		"file_name": fileName,
		"size":      fileSize,
		"hash":      hash,
	}).Error; err != nil {
		logger.Errorf(c, "更新UploadFile记录失败: %v", err)
		tx.Rollback()
		return nil, weboffice.ErrInternalError.WithMessage("更新文件信息失败: " + err.Error())
	}

	logger.Infof(c, "成功更新UploadFile记录")

	// 更新文件的修改时间和路径
	currentTime := time.Now().Unix()
	file.UpdatedTime = currentTime * 1000 // 转换为毫秒
	file.Path = newPath

	if err := tx.Model(&model.File{}).Where("eid = ? AND id = ?", file.Eid, file.ID).
		Updates(map[string]interface{}{
			"updated_time": file.UpdatedTime,
			"path":         newPath,
		}).Error; err != nil {
		logger.Errorf(c, "更新File记录失败: %v", err)
		tx.Rollback()
		return nil, weboffice.ErrInternalError.WithMessage("更新文件信息失败: " + err.Error())
	}

	logger.Infof(c, "成功更新File记录")

	if err := tx.Commit().Error; err != nil {
		logger.Errorf(c, "事务提交失败: %v", err)
		return nil, weboffice.ErrInternalError.WithMessage("事务提交失败: " + err.Error())
	}

	logger.Infof(c, "事务提交成功")
	uploadFile.FileName = fileName

	// 同步到 Elasticsearch
	logger.Info(c, "开始同步到Elasticsearch")
	elasticsearch.SyncFileToES(file, "update")
	logger.Infof(c, "成功同步到Elasticsearch")

	// 构建响应
	response := gin.H{
		"message":      "文件上传成功",
		"file_id":      file.ID,
		"file_name":    fileName,
		"file_size":    uploadFile.Size,
		"is_manual":    isManualStr,
		"upload_token": uploadToken,
		"updated_time": file.UpdatedTime,
	}

	logger.Infof(c, "WPS文件上传处理完成，文件ID: %d, 文件名: %s", file.ID, fileName)
	return response, nil
}

// UploadCompleteRequest 上传完成回调请求体
type UploadCompleteRequest struct {
	Request        map[string]interface{} `json:"request" binding:"required"`
	Response       map[string]interface{} `json:"response" binding:"required"`
	SendBackParams map[string]string      `json:"send_back_params,omitempty"`
}

// UploadCompleteResponse 上传完成回调响应体
type UploadCompleteResponse struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Version    int64  `json:"version"`
	Size       int64  `json:"size"`
	CreateTime int64  `json:"create_time"`
	ModifyTime int64  `json:"modify_time"`
	CreatorID  string `json:"creator_id"`
	ModifierID string `json:"modifier_id"`
}

// completeWPSFileUpload 完成WPS文件上传回调
func completeWPSFileUpload(c *gin.Context) (any, error) {
	// 获取文件信息
	file, wpsErr := getWPSFileCommon(c, true)
	if wpsErr != nil {
		return nil, wpsErr
	}

	// 验证文件是否存在
	if file == nil {
		return nil, weboffice.ErrFileNotExists
	}

	// 解析请求体
	var req UploadCompleteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		return nil, weboffice.ErrInvalidArguments.WithMessage("请求参数错误")
	}

	// 验证 send_back_params 中的 upload_token
	if req.SendBackParams == nil {
		return nil, weboffice.ErrInvalidArguments.WithMessage("缺少 send_back_params")
	}

	uploadToken, exists := req.SendBackParams["upload_token"]
	if !exists || uploadToken == "" {
		return nil, weboffice.ErrInvalidArguments.WithMessage("缺少 upload_token")
	}

	// 从 Redis 验证上传许可
	redisKey := fmt.Sprintf("wps_upload_token_%s", uploadToken)
	uploadTokenRaw, err := common.RedisGet(redisKey)
	if err != nil {
		return nil, weboffice.ErrPermissionDenied.WithMessage("上传许可无效或已过期")
	}

	if uploadTokenRaw == "" {
		return nil, weboffice.ErrPermissionDenied.WithMessage("上传许可不存在")
	}

	// 解析原始数据验证匹配
	ctx, err := weboffice.ParseContext(c.Request, true)
	if err != nil {
		return nil, weboffice.ErrInvalidArguments.WithMessage(err.Error())
	}
	expectedPrefix := fmt.Sprintf("wps_upload_%d_%d_", file.ID, ctx.UserModel().UserID)
	if !strings.HasPrefix(uploadTokenRaw, expectedPrefix) {
		return nil, weboffice.ErrPermissionDenied.WithMessage("上传许可不匹配")
	}

	// 解析请求信息
	rawNameValue, _ := req.Request["name"]
	name, ok := rawNameValue.(string)
	if !ok {
		return nil, weboffice.ErrInvalidArguments.WithMessage("缺少文档名称")
	}
	name = strings.TrimSpace(path.Base(name))
	if name == "" || name == "." || name == "/" {
		return nil, weboffice.ErrInvalidArguments.WithMessage("缺少文档名称")
	}

	size, ok := req.Request["size"].(float64)
	if !ok {
		return nil, weboffice.ErrInvalidArguments.WithMessage("缺少文档大小")
	}

	fileSize := int64(size)

	// 解析响应状态
	responseStatusCode, ok := req.Response["status_code"].(float64)
	if !ok {
		return nil, weboffice.ErrInvalidArguments.WithMessage("缺少响应状态码")
	}

	// 检查上传是否成功
	if int(responseStatusCode) != http.StatusOK {
		return nil, weboffice.ErrInternalError.WithMessage("文件上传失败")
	}

	// 开启事务
	tx := model.DB.Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	// 加载上传文件信息
	file.LoadUploadFile()
	if file.UploadFile == nil {
		tx.Rollback()
		return nil, weboffice.ErrInternalError.WithMessage("获取上传文件信息失败")
	}

	// 更新文件名和大小
	file.UploadFile.FileName = name
	file.UploadFile.Size = fileSize
	if err := file.UploadFile.Save(); err != nil {
		tx.Rollback()
		return nil, weboffice.ErrInternalError.WithMessage("更新文件信息失败")
	}

	// 更新文件的修改时间
	currentTime := time.Now().Unix()
	file.UpdatedTime = currentTime * 1000 // 转换为毫秒

	if err := tx.Model(&model.File{}).Where("eid = ? AND id = ?", ctx.UserModel().Eid, file.ID).
		Update("updated_time", file.UpdatedTime).Error; err != nil {
		tx.Rollback()
		return nil, weboffice.ErrInternalError.WithMessage("更新文件修改时间失败")
	}

	if err := tx.Commit().Error; err != nil {
		return nil, weboffice.ErrInternalError.WithMessage("事务提交失败")
	}

	// 同步到 Elasticsearch
	elasticsearch.SyncFileToES(file, "update")

	// 构建响应
	response := UploadCompleteResponse{
		ID:         strconv.FormatInt(file.ID, 10),
		Name:       name,
		Version:    file.UpdatedTime / 1000, // 使用时间戳作为版本号
		Size:       fileSize,
		CreateTime: file.CreatedTime / 1000, // 转换为秒
		ModifyTime: file.UpdatedTime / 1000, // 转换为秒
		CreatorID:  fmt.Sprintf("%d", file.UserID),
		ModifierID: fmt.Sprintf("%d", ctx.UserModel().UserID),
	}

	return response, nil
}

// ExecuteWPSFileUploadResponse 上传执行响应
type ExecuteWPSFileUploadResponse struct {
	Message     string `json:"message"`
	FileID      int64  `json:"file_id"`
	FileName    string `json:"file_name"`
	FileSize    int64  `json:"file_size"`
	IsManual    string `json:"is_manual"`
	UploadToken string `json:"upload_token"`
	UpdatedTime int64  `json:"updated_time"`
}

// ExecuteWPSFileUpload godoc
// @Summary 执行WPS文件上传
// @Description WPS三阶段上传第三步：执行实际的文件上传，接收文件流并更新存储
// @Tags WPS集成（回调接口）
// @Accept application/octet-stream
// @Produce json
// @Param file_id path string true "文件ID" example("123")
// @Param X-App-ID header string true "应用ID" example("your_app_id")
// @Param X-Upload-Token header string true "上传许可Token" example("abc123...")
// @Param size query int64 true "文件大小(字节)" example(1024)
// @Param is_manual query bool true "是否手动保存" example(true)
// @Param file body string true "文件内容(binary data)" example("binary file content")
// @Success 200 {object} weboffice.Reply{data=ExecuteWPSFileUploadResponse} "上传成功"
// @Failure 400 {object} weboffice.Reply "请求参数错误"
// @Failure 401 {object} weboffice.Reply "未授权"
// @Failure 403 {object} weboffice.Reply "权限不足"
// @Failure 404 {object} weboffice.Reply "文件不存在"
// @Failure 500 {object} weboffice.Reply "服务器内部错误"
// @Router /api/wps/v3/3rd/files/{file_id}/upload/execute [put]
func ExecuteWPSFileUpload(c *gin.Context) {
	wrapHandlerFunc(executeWPSFileUpload)(c)
}

// CompleteWPSFileUpload godoc
// @Summary 完成WPS文件上传回调
// @Description WPS三阶段上传第三步：处理上传完成回调
// @Tags WPS集成（回调接口）
// @Accept json
// @Produce json
// @Param file_id path string true "文件ID"
// @Param X-App-ID header string true "APP_ID"
// @Param request body UploadCompleteRequest true "上传完成信息"
// @Success 200 {object} weboffice.Reply{data=UploadCompleteResponse}
// @Failure 400 {object} weboffice.Reply
// @Failure 401 {object} weboffice.Reply
// @Failure 403 {object} weboffice.Reply
// @Failure 404 {object} weboffice.Reply
// @Failure 500 {object} weboffice.Reply
// @Router /api/wps/v3/3rd/files/{file_id}/upload/complete [post]
func CompleteWPSFileUpload(c *gin.Context) {
	wrapHandlerFunc(completeWPSFileUpload)(c)
}

// GetWPSFile godoc
// @Summary 获取WPS文件信息
// @Description WPS集成接口，根据外部应用ID和文件ID获取文件详情信息
// @Tags WPS集成（回调接口）
// @Accept json
// @Produce json
// @Param file_id path string true "文件ID"
// @Param X-App-ID header string true "APP_ID"
// @Success 200 {object} weboffice.Reply{data=model.File}
// @Failure 400 {object} weboffice.Reply
// @Failure 401 {object} weboffice.Reply
// @Failure 403 {object} weboffice.Reply
// @Failure 404 {object} weboffice.Reply
// @Failure 500 {object} weboffice.Reply
// @Router /api/wps/v3/3rd/files/{file_id} [get]
func GetWPSFile(c *gin.Context) {
	wrapHandlerFunc(getWPSFile)(c)
}

// GetWPSFileDownload godoc
// @Summary 获取WPS文件下载地址
// @Description WPS集成接口，根据外部应用ID和文件ID获取文件下载地址
// @Tags WPS集成（回调接口）
// @Accept json
// @Produce json
// @Param file_id path string true "文件ID"
// @Param X-App-ID header string true "APP_ID"
// @Success 200 {object} weboffice.Reply
// @Failure 400 {object} weboffice.Reply
// @Failure 401 {object} weboffice.Reply
// @Failure 403 {object} weboffice.Reply
// @Failure 404 {object} weboffice.Reply
// @Failure 500 {object} weboffice.Reply
// @Router /api/wps/v3/3rd/files/{file_id}/download [get]
func GetWPSFileDownload(c *gin.Context) {
	wrapHandlerFunc(getWPSFileDownload)(c)
}

// GetWPSFilePermission godoc
// @Summary 获取WPS文件权限
// @Description WPS集成接口，根据外部应用ID和文件ID获取用户对该文件的权限信息
// @Tags WPS集成（回调接口）
// @Accept json
// @Produce json
// @Param file_id path string true "文件ID"
// @Param X-App-ID header string true "APP_ID"
// @Success 200 {object} weboffice.Reply{data=weboffice.GetFilePermissionReply}
// @Failure 400 {object} weboffice.Reply
// @Failure 401 {object} weboffice.Reply
// @Failure 403 {object} weboffice.Reply
// @Failure 404 {object} weboffice.Reply
// @Failure 500 {object} weboffice.Reply
// @Router /api/wps/v3/3rd/files/{file_id}/permission [get]
func GetWPSFilePermission(c *gin.Context) {
	wrapHandlerFunc(getWPSFilePermission)(c)
}

// WPSUser WPS用户信息响应结构
type WPSUser struct {
	ID        string `json:"id"`         // 用户ID（字符串格式）
	Name      string `json:"name"`       // 用户昵称
	AvatarURL string `json:"avatar_url"` // 用户头像URL
}

// getWPSUsers 获取WPS用户信息
func getWPSUsers(c *gin.Context) (any, error) {
	// 设置跳过ID加密，确保返回原始ID
	c.Set(middleware.SkipIDEncryption, true)

	ctx, err := weboffice.ParseContext(c.Request, true)
	if err != nil {
		return nil, weboffice.ErrInvalidArguments.WithMessage(err.Error())
	}
	if ctx.UserModel() == nil {
		return nil, weboffice.ErrPermissionDenied.WithMessage("用户不存在")
	}

	// 获取请求中的user_ids参数（可能重复）
	userIDsStr := c.QueryArray("user_ids")
	if len(userIDsStr) == 0 {
		return nil, weboffice.ErrInvalidArguments.WithMessage("user_ids参数不能为空")
	}

	// 将字符串转换为用户ID
	var userIDs []int64
	for _, userIDStr := range userIDsStr {
		// 将字符串转换为int64
		userID, err := strconv.ParseInt(userIDStr, 10, 64)
		if err != nil {
			logger.SysErrorf("Failed to parse user ID %s: %v", userIDStr, err)
			continue // 跳过无效的用户ID
		}
		userIDs = append(userIDs, userID)
	}

	if len(userIDs) == 0 {
		return nil, weboffice.ErrInvalidArguments.WithMessage("没有有效的用户ID")
	}

	// 批量获取用户信息，添加EID筛选
	users, err := model.GetUsersByIDsAndEid(ctx.UserModel().Eid, userIDs)
	if err != nil {
		logger.SysErrorf("Failed to get users by IDs: %v", err)
		return nil, weboffice.ErrInternalError.WithMessage("获取用户信息失败")
	}

	// 构建用户ID到用户的映射
	userMap := make(map[int64]*model.User)
	for _, user := range users {
		userMap[user.UserID] = user
	}

	// 按照请求顺序构建响应
	var wpsUsers []WPSUser
	for _, userIDStr := range userIDsStr {
		// 再次转换为int64
		userID, err := strconv.ParseInt(userIDStr, 10, 64)
		if err != nil {
			continue // 跳过无效的用户ID
		}

		if user, exists := userMap[userID]; exists {
			wpsUser := WPSUser{
				ID:        userIDStr, // 直接使用原始字符串作为ID
				Name:      user.Nickname,
				AvatarURL: user.Avatar,
			}

			wpsUsers = append(wpsUsers, wpsUser)
		}
	}

	return wpsUsers, nil
}

// GetWPSUsers godoc
// @Summary 获取WPS用户信息
// @Description WPS集成接口，批量获取指定用户的名称和头像，用于协同场景下查看历史改动、在线协同用户头像等
// @Tags WPS集成（回调接口）
// @Accept json
// @Produce json
// @Param user_ids query []string true "用户ID数组（字符串格式）" collectionFormat(multi)
// @Param X-App-ID header string true "APP_ID"
// @Success 200 {object} weboffice.Reply{data=[]WPSUser}
// @Failure 400 {object} weboffice.Reply
// @Failure 401 {object} weboffice.Reply
// @Failure 403 {object} weboffice.Reply
// @Failure 404 {object} weboffice.Reply
// @Failure 500 {object} weboffice.Reply
// @Router /api/wps/v3/3rd/users [get]
func GetWPSUsers(c *gin.Context) {
	wrapHandlerFunc(getWPSUsers)(c)
}

// GenerateTicket 生成WPS票据
// @Summary 生成WPS票据
// @Description 生成WPS访问票据用于身份验证
// @Tags WPS
// @Accept json
// @Security BearerAuth
// @Produce json
// @Success 200 {object} model.CommonResponse{data=WPSTicketResponse}
// @Router /api/wps/ticket [get]
func GenerateTicket(c *gin.Context) {
	user, err := model.GetLoginUser(c)
	if err != nil {
		c.JSON(http.StatusOK, model.AuthFailed.ToResponse(err))
		return
	}

	tk, err := weboffice.GenerateTicket(user.Eid)
	if err != nil {
		c.JSON(http.StatusOK, model.AuthFailed.ToResponse(err))
		return
	}

	response := WPSTicketResponse{
		Ticket: tk,
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(response))
}
