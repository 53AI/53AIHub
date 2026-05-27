package controller

import (
	"errors"
	"net/http"
	"path"
	"strconv"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/gin-gonic/gin"
)

// PermissionRequest 权限请求结构体
// @Description 单个权限请求的结构体
type PermissionRequest struct {
	SubjectType int   `json:"subject_type" binding:"required" example:"0"` // 权限主体类型: 0=用户, 1=分组, 2=全公司
	SubjectID   int64 `json:"subject_id" binding:"required" example:"123"` // 主体ID (全公司权限时传0)
	Permission  *int  `json:"permission" binding:"required" example:"2"`   // 权限级别: 0=无权限, 1=仅公开, 2=仅查看, 3=可查看/导出, 4=仅编辑知识, 5=可编辑知识/语料, 6=可管理
}

// BatchPermissionRequest 批量权限请求结构体
// @Description 批量权限请求的结构体
type BatchPermissionRequest struct {
	Permissions []PermissionRequest `json:"permissions" binding:"required"` // 权限列表
}

// CreatePermissions godoc
// @Summary 批量创建权限
// @Description 为指定资源批量创建权限
// @Tags 权限管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param resource_type path int true "资源类型 (0=空间, 1=知识库, 2=文件)"
// @Param resource_id path int true "资源ID"
// @Param request body BatchPermissionRequest true "权限请求"
// @Success 200 {object} model.CommonResponse "创建成功"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 500 {object} model.CommonResponse "服务器错误"
// @Router /api/permissions/{resource_type}/{resource_id} [post]
func CreatePermissions(c *gin.Context) {
	eid := config.GetEID(c)

	// 获取资源类型和资源ID
	resourceTypeStr := c.Param("resource_type")
	resourceIDStr := c.Param("resource_id")

	resourceType, err := strconv.Atoi(resourceTypeStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("invalid resource_type"))
		return
	}

	resourceID, err := strconv.ParseInt(resourceIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("invalid resource_id"))
		return
	}

	var req BatchPermissionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 转换为内部结构
	permissions := make([]*model.PermissionData, len(req.Permissions))
	for i, perm := range req.Permissions {
		permissions[i] = &model.PermissionData{
			SubjectType: perm.SubjectType,
			SubjectID:   perm.SubjectID,
			Permission:  *perm.Permission,
		}
	}

	// 幂等：同主体同资源仅一条记录 -> Upsert
	if err := service.UpsertBatchPermissions(eid, resourceType, int64(resourceID), permissions); err != nil {
		c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(err))
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse("permissions upsert successfully"))
}

// GetPermissions godoc
// @Summary 获取权限列表
// @Description 根据资源或主体查询权限列表，支持权限级别筛选
// @Tags 权限管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param resource_type query int false "资源类型 (0=空间, 1=知识库, 2=文件)"
// @Param resource_id query int false "资源ID"
// @Param subject_type query int false "主体类型 (0=用户, 1=分组, 2=全公司)"
// @Param subject_id query int false "主体ID"
// @Param permission query int false "权限级别 (0=无权限, 1=仅公开, 2=仅查看, 3=可查看/导出, 4=仅编辑知识, 5=可编辑知识/语料, 6=可管理)"
// @Success 200 {object} model.CommonResponse{data=[]model.Permission} "权限列表"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 500 {object} model.CommonResponse "服务器错误"
// @Router /api/permissions [get]
func GetPermissions(c *gin.Context) {
	eid := config.GetEID(c)

	// 使用公共参数解析函数统一处理所有参数
	resourceType, resourceID, subjectType, subjectID, permissionLevel, err := parsePermissionQueryParams(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err.Error()))
		return
	}

	// 统一使用 GetPermissionsByFilter 进行动态条件查询
	permissions, err := model.GetPermissionsByFilter(eid, resourceType, resourceID, subjectType, subjectID, permissionLevel)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(permissions))
}

// UpdatePermission godoc
// @Summary 更新权限
// @Description 更新指定权限的权限级别
// @Tags 权限管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param permission_id path int true "权限ID"
// @Param request body object{permission=int} true "权限级别 (0=无权限, 1=仅公开, 2=仅查看, 3=可查看/导出, 4=仅编辑知识, 5=可编辑知识/语料, 6=可管理)"
// @Success 200 {object} model.CommonResponse{data=model.Permission} "更新后的权限"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 404 {object} model.CommonResponse "权限不存在"
// @Failure 500 {object} model.CommonResponse "服务器错误"
// @Router /api/permissions/{permission_id} [put]
func UpdatePermission(c *gin.Context) {
	permissionIDStr := c.Param("permission_id")
	permissionID, err := strconv.ParseInt(permissionIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("invalid permission id"))
		return
	}

	var req struct {
		Permission *int `json:"permission" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 检查权限值是否提供
	if req.Permission == nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("permission is required"))
		return
	}

	// 更新权限（Service层会自动处理缓存清除）
	if err := service.UpdatePermissionByID(permissionID, *req.Permission); err != nil {
		if err.Error() == "permission not found" {
			c.JSON(http.StatusNotFound, model.FileError.ToResponse("permission not found"))
			return
		}
		c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(err))
		return
	}

	// 返回更新后的权限
	permission, err := model.GetPermissionByID(permissionID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(err))
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(permission))
}

// DeletePermission godoc
// @Summary 删除权限
// @Description 删除指定的权限
// @Tags 权限管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param permission_id path int true "权限ID"
// @Success 200 {object} model.CommonResponse "删除成功"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 404 {object} model.CommonResponse "权限不存在"
// @Failure 500 {object} model.CommonResponse "服务器错误"
// @Router /api/permissions/{permission_id} [delete]
func DeletePermission(c *gin.Context) {
	permissionIDStr := c.Param("permission_id")
	permissionID, err := strconv.ParseInt(permissionIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("invalid permission id"))
		return
	}

	// 检查权限是否存在
	_, err = model.GetPermissionByID(permissionID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.FileError.ToResponse("permission not found"))
		return
	}

	// 删除权限
	if err := service.DeletePermissionByID(permissionID); err != nil {
		c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse("permission deleted successfully"))
}

// parsePermissionQueryParams 解析权限查询参数
func parsePermissionQueryParams(c *gin.Context) (*int, *int64, *int, *int64, *int, error) {
	var resourceType *int
	var resourceID *int64
	var subjectType *int
	var subjectID *int64
	var permissionLevel *int

	// 解析资源类型
	if resourceTypeStr := c.Query("resource_type"); resourceTypeStr != "" {
		rt, err := strconv.Atoi(resourceTypeStr)
		if err != nil {
			return nil, nil, nil, nil, nil, errors.New("invalid resource_type")
		}
		resourceType = &rt
	}

	// 解析资源ID
	if resourceIDStr := c.Query("resource_id"); resourceIDStr != "" {
		rid, err := strconv.ParseInt(resourceIDStr, 10, 64)
		if err != nil {
			return nil, nil, nil, nil, nil, errors.New("invalid resource_id")
		}
		resourceID = &rid
	}

	// 解析主体类型
	if subjectTypeStr := c.Query("subject_type"); subjectTypeStr != "" {
		st, err := strconv.Atoi(subjectTypeStr)
		if err != nil {
			return nil, nil, nil, nil, nil, errors.New("invalid subject_type")
		}
		subjectType = &st
	}

	// 解析主体ID
	if subjectIDStr := c.Query("subject_id"); subjectIDStr != "" {
		sid, err := strconv.ParseInt(subjectIDStr, 10, 64)
		if err != nil {
			return nil, nil, nil, nil, nil, errors.New("invalid subject_id")
		}
		subjectID = &sid
	}

	// 解析权限级别
	if permissionStr := c.Query("permission"); permissionStr != "" {
		pl, err := strconv.Atoi(permissionStr)
		if err != nil {
			return nil, nil, nil, nil, nil, errors.New("invalid permission_level")
		}
		permissionLevel = &pl
	}

	return resourceType, resourceID, subjectType, subjectID, permissionLevel, nil
}

// DetailPermissionResponse 详细权限响应结构
type DetailPermissionResponse struct {
	ResourceType int                `json:"resource_type"`
	ResourceID   int64              `json:"resource_id"`
	Direct       []model.Permission `json:"direct"`      // 直接权限
	Inherited    []model.Permission `json:"inherited"`   // 继承权限（仅文档有）
	TeamAdmin    []model.Permission `json:"team_admin"`  // 团队管理员（知识库、文档有）
	TeamMember   []model.Permission `json:"team_member"` // 团队成员（知识库、文档有）
}

// MyPermissionResponse 我的权限响应结构
type MyPermissionResponse struct {
	ResourceType  int   `json:"resource_type"`  // 资源类型
	ResourceID    int64 `json:"resource_id"`    // 资源ID
	MaxPermission int   `json:"max_permission"` // 最大权限值
}

// BatchMyPermissionRequest 批量我的权限请求结构
type BatchMyPermissionRequest struct {
	ResourceType *int    `json:"resource_type" binding:"required"` // 资源类型
	ResourceIDs  []int64 `json:"resource_ids" binding:"required"`  // 资源ID列表
}

// BatchMyPermissionResponse 批量我的权限响应结构
type BatchMyPermissionResponse struct {
	Permissions []MyPermissionResponse `json:"permissions"`
}

// GetDetailPermissions godoc
// @Summary 获取详细权限信息（支持继承）
// @Description 根据资源类型返回不同的权限结构：空间（直接权限），知识库（团队管理员+成员），文档（知识库管理员/成员+父文档继承）
// @Tags 权限管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param resource_type query int true "资源类型 (0=空间, 1=知识库, 2=文档)"
// @Param resource_id query int true "资源ID"
// @Success 200 {object} model.CommonResponse{data=DetailPermissionResponse} "详细权限信息"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 500 {object} model.CommonResponse "服务器错误"
// @Router /api/permissions/detail [get]
func GetDetailPermissions(c *gin.Context) {
	eid := config.GetEID(c)

	// 解析必需参数
	resourceTypeStr := c.Query("resource_type")
	resourceIDStr := c.Query("resource_id")

	if resourceTypeStr == "" || resourceIDStr == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("resource_type and resource_id are required"))
		return
	}

	resourceType, err := strconv.Atoi(resourceTypeStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("invalid resource_type"))
		return
	}

	resourceID, err := strconv.ParseInt(resourceIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("invalid resource_id"))
		return
	}

	response := DetailPermissionResponse{
		ResourceType: resourceType,
		ResourceID:   resourceID,
		Direct:       []model.Permission{},
		Inherited:    []model.Permission{},
		TeamAdmin:    []model.Permission{},
		TeamMember:   []model.Permission{},
	}

	switch resourceType {
	case model.RESOURCE_TYPE_SPACE:
		// 空间：只返回直接权限，无继承
		if err := handleSpaceDetailPermissions(eid, resourceID, &response); err != nil {
			c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(err))
			return
		}

	case model.RESOURCE_TYPE_LIBRARY:
		// 知识库：直接权限 + 团队管理员 + 团队成员
		if err := handleLibraryDetailPermissions(eid, resourceID, &response); err != nil {
			c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(err))
			return
		}

	case model.RESOURCE_TYPE_FILE:
		// 文档：直接权限 + 继承权限 + 知识库团队管理员/成员
		if err := handleFileDetailPermissions(eid, resourceID, &response); err != nil {
			c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(err))
			return
		}

	default:
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("unsupported resource_type"))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(response))
}

// GetMyPermissions godoc
// @Summary 获取我的权限信息
// @Description 获取当前登录用户对指定资源的最大权限
// @Tags 权限管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param resource_type query int true "资源类型 (0=空间, 1=知识库, 2=文档)"
// @Param resource_id query int true "资源ID"
// @Success 200 {object} model.CommonResponse{data=MyPermissionResponse} "我的权限信息"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 500 {object} model.CommonResponse "服务器错误"
// @Router /api/permissions/my [get]
func GetMyPermissions(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	// 解析必需参数
	resourceTypeStr := c.Query("resource_type")
	resourceIDStr := c.Query("resource_id")

	if resourceTypeStr == "" || resourceIDStr == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("resource_type and resource_id are required"))
		return
	}

	resourceType, err := strconv.Atoi(resourceTypeStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("invalid resource_type"))
		return
	}

	resourceID, err := strconv.ParseInt(resourceIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("invalid resource_id"))
		return
	}

	var maxPermission int

	maxPermission, err = service.GetUserPermission(eid, resourceType, resourceID, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(err))
		return
	}
	response := MyPermissionResponse{
		ResourceType:  resourceType,
		ResourceID:    resourceID,
		MaxPermission: maxPermission,
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(response))
}

// GetMyPermissionsBatch godoc
// @Summary 批量获取我的权限信息
// @Description 批量获取当前登录用户对指定资源的最大权限
// @Tags 权限管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body BatchMyPermissionRequest true "批量权限请求"
// @Success 200 {object} model.CommonResponse{data=BatchMyPermissionResponse} "批量权限信息"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 500 {object} model.CommonResponse "服务器错误"
// @Router /api/permissions/my/batch [post]
func GetMyPermissionsBatch(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	var req BatchMyPermissionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	if req.ResourceType == nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("resource_type is required"))
		return
	}
	if len(req.ResourceIDs) == 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("resource_ids is required"))
		return
	}

	permissions, err := service.BatchGetUserPermissions(eid, *req.ResourceType, req.ResourceIDs, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(err))
		return
	}

	uniqueResourceIDs := uniquePermissionResourceIDs(req.ResourceIDs)
	response := BatchMyPermissionResponse{
		Permissions: make([]MyPermissionResponse, 0, len(uniqueResourceIDs)),
	}
	for _, resourceID := range uniqueResourceIDs {
		maxPermission, ok := permissions[resourceID]
		if !ok {
			continue
		}
		response.Permissions = append(response.Permissions, MyPermissionResponse{
			ResourceType:  *req.ResourceType,
			ResourceID:    resourceID,
			MaxPermission: maxPermission,
		})
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(response))
}

func uniquePermissionResourceIDs(resourceIDs []int64) []int64 {
	if len(resourceIDs) == 0 {
		return nil
	}
	seen := make(map[int64]struct{}, len(resourceIDs))
	unique := make([]int64, 0, len(resourceIDs))
	for _, resourceID := range resourceIDs {
		if resourceID <= 0 {
			continue
		}
		if _, ok := seen[resourceID]; ok {
			continue
		}
		seen[resourceID] = struct{}{}
		unique = append(unique, resourceID)
	}
	if len(unique) == 0 {
		return nil
	}
	return unique
}

// handleSpaceDetailPermissions 处理空间的详细权限
func handleSpaceDetailPermissions(eid int64, spaceID int64, response *DetailPermissionResponse) error {
	// 空间只有直接权限，无继承
	resourceType := model.RESOURCE_TYPE_SPACE
	permissions, err := model.GetPermissionsByFilter(eid, &resourceType, &spaceID, nil, nil, nil)
	if err != nil {
		return err
	}
	response.Direct = permissions
	return nil
}

// handleLibraryDetailPermissions 处理知识库的详细权限
func handleLibraryDetailPermissions(eid int64, libraryID int64, response *DetailPermissionResponse) error {
	// 1. 获取知识库直接权限
	resourceType := model.RESOURCE_TYPE_LIBRARY
	directPermissions, err := model.GetPermissionsByFilter(eid, &resourceType, &libraryID, nil, nil, nil)
	if err != nil {
		return err
	}
	response.Direct = directPermissions

	// 2. 获取知识库信息，拿到所属空间ID
	library, err := model.GetLibraryByID(eid, libraryID)
	if err != nil || library == nil {
		return err
	}

	// 3. 获取所属空间的团队管理员和成员权限
	spacePermissionService := service.NewSpacePermissionService(eid)

	// 团队管理员权限
	adminPermissions, err := spacePermissionService.GetSpaceAdminPermissions(library.SpaceID)
	if err != nil {
		return err
	}
	response.TeamAdmin = adminPermissions

	// 团队成员权限
	memberPermissions, err := spacePermissionService.GetSpaceUserPermissions(library.SpaceID)
	if err != nil {
		return err
	}
	response.TeamMember = memberPermissions

	return nil
}

// handleFileDetailPermissions 处理文档的详细权限
func handleFileDetailPermissions(eid int64, fileID int64, response *DetailPermissionResponse) error {
	// 1. 获取文档直接权限
	var err error
	resourceType := model.RESOURCE_TYPE_FILE
	directPermissions, err := model.GetPermissionsByFilter(eid, &resourceType, &fileID, nil, nil, nil)
	if err != nil {
		return err
	}
	response.Direct = directPermissions

	// 2. 获取文档信息
	file, err := model.GetFileByID(eid, fileID)
	if err != nil || file == nil {
		return err
	}

	parentPath := path.Dir(file.Path)
	if parentPath == "." || parentPath == "/" {
		parentPath = "" // 根目录
	}

	var permissions []model.Permission
	if parentPath == "" {
		// 上级是知识库
		upserResourceType := model.RESOURCE_TYPE_LIBRARY
		permissions, err = model.GetPermissionsByFilter(eid, &upserResourceType, &file.LibraryID, nil, nil, nil)
		if err != nil {
			return err
		}
	} else {
		// 上级是文件/文件夹
		parentFile, err := model.GetFileByPathAndLibrary(eid, file.LibraryID, parentPath)
		if err != nil {
			logger.SysLogf("查询上级文件夹失败: path=%s, libraryID=%d, err=%v", parentPath, file.LibraryID, err)
			return err
		}

		permissions, err = model.GetPermissionsByFilter(eid, &resourceType, &parentFile.ID, nil, nil, nil)
		if err != nil {
			return err
		}
	}

	adminPermissions := make([]model.Permission, 0)
	memberPermissions := make([]model.Permission, 0)

	for _, perm := range permissions {
		if perm.Permission != model.PERMISSION_NONE &&
			perm.Permission != model.PERMISSION_MANAGE &&
			perm.Permission != model.PERMISSION_PUBLIC_ONLY {
			memberPermissions = append(memberPermissions, perm)
		} else if perm.Permission == model.PERMISSION_MANAGE {
			adminPermissions = append(adminPermissions, perm)
		}
	}

	response.TeamAdmin = adminPermissions
	response.TeamMember = memberPermissions

	return nil
}

// getFileInheritedPermissions 获取文档的继承权限（父路径权限）
func getFileInheritedPermissions(eid int64, file *model.File) ([]model.Permission, error) {
	var inheritedPermissions []model.Permission

	// 使用 file_permission.go 中的 buildParentPaths 逻辑
	parentPaths := buildParentPaths(file.Path)

	for _, parentPath := range parentPaths {
		// 获取父路径对应的文件
		parentFile, err := model.GetFileByPathAndLibrary(eid, file.LibraryID, parentPath)
		if err != nil || parentFile == nil {
			continue
		}

		// 获取父文件的权限
		resourceType := model.RESOURCE_TYPE_FILE
		parentPermissions, err := model.GetPermissionsByFilter(eid, &resourceType, &parentFile.ID, nil, nil, nil)
		if err != nil {
			continue
		}

		// 添加到继承权限列表
		inheritedPermissions = append(inheritedPermissions, parentPermissions...)
	}

	return inheritedPermissions, nil
}

// buildParentPaths 基于路径生成从近到远的父路径序列（不含自身路径，不含根"/"）
// 例如：/a/b/c.md -> ["/a/b", "/a"]
// 复制自 service/file_permission.go 以避免循环依赖
func buildParentPaths(p string) []string {
	res := []string{}
	if p == "" || p == "/" {
		return res
	}
	dir := path.Dir(p)
	for dir != "" && dir != "/" && dir != "." {
		res = append(res, dir)
		dir = path.Dir(dir)
	}
	return res
}
