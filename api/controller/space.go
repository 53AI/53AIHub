package controller

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/middleware"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/53AI/53AIHub/service/enterpriseinit"
	mcpsvc "github.com/53AI/53AIHub/service/mcp"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// isSpaceFeatureAvailable 空间功能可用性检查（可测试替换）
var isSpaceFeatureAvailable = service.IsFeatureAvailable

type SpaceRequest struct {
	// 空间名称，必填项
	Name string `json:"name" binding:"required" example:"产品文档空间"`

	// 空间描述
	Description string `json:"description" example:"存放产品相关文档和资料"`

	// 空间图标URL
	Icon string `json:"icon" example:"/static/icons/space-icon.png"`

	// 可见性：0-私有，1-公开（全公司可见）
	Visibility int `json:"visibility" example:"0"`

	// 默认权限配置，可选参数
	// 用于在创建空间时为指定用户或分组设置权限
	// 支持为用户(0)或分组(1)设置权限级别：2-仅查看，6-可管理
	Permissions []*model.PermissionData `json:"permissions"`

	// 开启 Wiki 知识图谱（实体/概念提取）
	EnableWikiKnowledgeGraph bool `json:"enable_wiki_knowledge_graph" example:"false"`

	// 开启 Wiki 动态知识（摘要/索引/分类页面）
	EnableWikiDynamicKnowledge bool `json:"enable_wiki_dynamic_knowledge" example:"false"`
}

type SpaceSortRequest struct {
	Spaces []struct {
		ID   int64 `json:"id" binding:"required"`
		Sort int64 `json:"sort" binding:"required"`
	} `json:"spaces" binding:"required"`
}

// CreateSpace godoc
// @Summary 创建空间
// @Description 创建团队空间接口
// @Description 支持在创建时设置默认权限，通过permissions参数指定
// @Tags 空间管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body SpaceRequest true "空间信息"
// @Success 200 {object} model.CommonResponse{data=model.Space}
// @Router /api/spaces [post]
func CreateSpace(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	var req SpaceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 检查功能是否可用
	params := map[string]interface{}{
		"from": "space",
		"op":   "add",
	}
	_, err := service.IsFeatureAvailable(c, "knowledge_base", params)
	if err != nil {
		c.JSON(http.StatusForbidden, model.FeatureNotAvailableError.ToResponse(err))
		return
	}

	spaceService := mcpsvc.NewSpaceService()
	space, err := spaceService.CreateSpace(c.Request.Context(), eid, userID, req.Name, req.Description, req.Icon, req.Visibility, req.Permissions, req.EnableWikiKnowledgeGraph, req.EnableWikiDynamicKnowledge)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(err))
		return
	}
	if req.EnableWikiKnowledgeGraph {
		if err := model.DB.Transaction(func(tx *gorm.DB) error {
			return enterpriseinit.EnsureDefaultWikiPipelineForEnterprise(c.Request.Context(), tx, eid)
		}); err != nil {
			c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
			return
		}
	}

	// 记录系统日志
	LogSpaceCreate(c, space.Name)
	space.LoadOwnerInfo(eid)
	space.LoadLibraryCount(eid)

	c.JSON(http.StatusOK, model.Success.ToResponse(space))
}

// GetSpaces godoc
// @Summary 获取空间列表
// @Description 获取用户所属的空间列表，支持状态筛选和名称模糊查询
// @Tags 空间管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param status query int false "空间状态(-1:全部,0:active,1:archived)" default(-1) Enums(-1,0,1)
// @Param name query string false "空间名称模糊查询"
// @Param offset query int false "分页偏移量，默认为0"
// @Param limit query int false "每页条数，默认为10"
// @Param view query string false "查看视角 admin,user（前台后台两种权限， 默认为前台 ）"
// @Success 200 {object} model.CommonResponse{data=model.SpaceListResponse} "Success"
// @Router /api/spaces [get]
func GetSpaces(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	// 检查功能是否可用
	params := map[string]interface{}{
		"from": "space",
	}
	_, err := service.IsFeatureAvailable(c, "knowledge_base", params)
	if err != nil {
		c.JSON(http.StatusForbidden, model.FeatureNotAvailableError.ToResponse(err))
		return
	}

	statusStr := c.Query("status")
	status := -1
	if statusStr != "" {
		if s, err := strconv.Atoi(statusStr); err == nil {
			status = s
		}
	}

	view := c.Query("view")

	// 解析名称模糊查询参数
	name := c.Query("name")

	// 解析分页参数
	offsetStr := c.Query("offset")
	offset := 0
	if offsetStr != "" {
		if o, err := strconv.Atoi(offsetStr); err == nil {
			offset = o
		}
	}

	limitStr := c.Query("limit")
	limit := 10
	if limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil {
			limit = l
		}
	}

	// 获取空间服务
	sps := service.NewSpacePermissionService(eid)

	var count int64
	var spaces []model.Space
	var err2 error
	if view == "user" {
		// 获取用户所属的空间(带筛选条件和分页)
		count, spaces, err2 = sps.GetUserSpaces(userID, status, name, nil, 0, 0, 0, 0, offset, limit)
	} else {
		if !common.IsAdmin(c) {
			c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(nil))
			return
		}
		count, spaces, err2 = sps.GetAdminSpaces(userID, status, name, offset, limit)
	}

	if err2 != nil {
		c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(err2))
		return
	}

	domain := config.GetProtocol(c) + "://" + config.GetDomain(c)
	for i := range spaces {
		if icon := spaces[i].Icon; len(icon) > 0 && icon[0] == '/' {
			spaces[i].Icon = domain + icon
		}
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(model.SpaceListResponse{
		Count:  count,
		Spaces: spaces,
	}))
}

// GetSpace godoc
// @Summary 获取空间详情
// @Description 获取指定空间的详细信息
// @Tags 空间管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param space_id path int true "空间ID"
// @Success 200 {object} model.CommonResponse{data=model.Space}
// @Router /api/spaces/{space_id} [get]
func GetSpace(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	id := c.Param("space_id")
	if id == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("空间ID不能为空")))
		return
	}

	spaceID, err := strconv.ParseInt(id, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的空间ID")))
		return
	}

	// 检查功能是否可用
	params := map[string]interface{}{
		"from": "space",
	}
	_, featureErr := service.IsFeatureAvailable(c, "space", params)
	if featureErr != nil {
		c.JSON(http.StatusForbidden, model.FeatureNotAvailableError.ToResponse(featureErr))
		return
	}

	// 检查用户是否是空间成员
	sps := service.NewSpacePermissionService(eid)
	canViewSpc, err := sps.CheckSpacePermission(userID, spaceID, model.PERMISSION_PUBLIC_ONLY)

	if (!canViewSpc || err != nil) && !common.IsAdmin(c) {
		logger.SysLogf("User %d has no permission to access space %d", userID, spaceID)
		c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(errors.New("无权限访问此空间")))
		return
	}

	space, err := model.GetSpaceByID(eid, spaceID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
		return
	}

	// 获取用户对该空间的实际权限值（管理员跳过权限获取，直接设为管理权限）
	if common.IsAdmin(c) {
		space.Permission = model.PERMISSION_MANAGE
	} else {
		permission, err := sps.GetUserSpacePermission(userID, spaceID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
			return
		}
		space.Permission = permission
	}

	domain := config.GetProtocol(c) + "://" + config.GetDomain(c)
	if icon := space.Icon; len(icon) > 0 && icon[0] == '/' {
		space.Icon = domain + icon
	}

	space.LoadOwnerInfo(eid)
	space.LoadLibraryCount(eid)

	c.JSON(http.StatusOK, model.Success.ToResponse(space))
}

// UpdateSpace godoc
// @Summary 更新空间信息
// @Description 更新空间的基本信息
// @Tags 空间管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param space_id path int true "空间ID"
// @Param request body SpaceRequest true "空间信息"
// @Success 200 {object} model.CommonResponse{data=model.Space}
// @Router /api/spaces/{space_id} [put]
func UpdateSpace(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	id := c.Param("space_id")
	if id == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("空间ID不能为空")))
		return
	}

	spaceID, err := strconv.ParseInt(id, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的空间ID")))
		return
	}

	// 检查功能是否可用
	params := map[string]interface{}{
		"from": "space",
	}
	_, featureErr := service.IsFeatureAvailable(c, "space", params)
	if featureErr != nil {
		c.JSON(http.StatusForbidden, model.FeatureNotAvailableError.ToResponse(featureErr))
		return
	}

	sps := service.NewSpacePermissionService(eid)
	canEditSpc, err := sps.CheckSpacePermission(userID, spaceID, model.PERMISSION_MANAGE)

	if (!canEditSpc || err != nil) && !common.IsAdmin(c) {
		c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(errors.New("无权限修改此空间")))
		return
	}

	var req SpaceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	space, err := model.GetSpaceByID(eid, spaceID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
		return
	}

	// 保存原始数据用于日志记录
	oldSpace := *space

	space.Name = req.Name
	space.Description = req.Description
	space.Icon = req.Icon
	space.EnableWikiKnowledgeGraph = req.EnableWikiKnowledgeGraph
	space.EnableWikiDynamicKnowledge = req.EnableWikiDynamicKnowledge

	// 处理可见性更新
	visibility := req.Visibility

	space.Visibility = visibility

	// 处理权限更新（完全重建模式）
	if len(req.Permissions) > 0 {
		if err := sps.UpdateSpacePermissions(spaceID, userID, req.Permissions); err != nil {
			logger.SysErrorf("Failed to update permissions for space %d: %v", space.ID, err)
			// 权限更新失败不影响基本信息更新，只记录日志
		}
	}

	// 处理全公司权限变更 - 使用SpacePermissionService
	if err := sps.UpdateSpaceVisibilityPermission(space, visibility); err != nil {
		logger.SysErrorf("Failed to update visibility permissions for space %d: %v", space.ID, err)
	}

	if err := space.Update(); err != nil {
		c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(err))
		return
	}
	if space.EnableWikiKnowledgeGraph {
		if err := model.DB.Transaction(func(tx *gorm.DB) error {
			return enterpriseinit.EnsureDefaultWikiPipelineForEnterprise(c.Request.Context(), tx, eid)
		}); err != nil {
			c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
			return
		}
	}

	space.LoadOwnerInfo(eid)
	space.LoadLibraryCount(eid)

	// 记录变更日志
	fieldMap := map[string]string{
		"Name":        "名称",
		"Description": "描述",
		"Icon":        "图标",
	}
	model.LogEntityChange("空间", model.SystemLogActionUpdate, eid, userID, config.GetUserNickname(c), model.SystemLogModuleSpace, &oldSpace, space, c.ClientIP(), fieldMap)

	c.JSON(http.StatusOK, model.Success.ToResponse(space))
}

// DeleteSpace godoc
// @Summary 删除空间
// @Description 删除指定的空间
// @Tags 空间管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param space_id path int true "空间ID"
// @Success 200 {object} model.CommonResponse
// @Router /api/spaces/{space_id} [delete]
func DeleteSpace(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	id := c.Param("space_id")
	if id == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("空间ID不能为空")))
		return
	}

	spaceID, err := strconv.ParseInt(id, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的空间ID")))
		return
	}

	// 检查功能是否可用
	params := map[string]interface{}{
		"from": "space",
	}
	_, featureErr := service.IsFeatureAvailable(c, "space", params)
	if featureErr != nil {
		c.JSON(http.StatusForbidden, model.FeatureNotAvailableError.ToResponse(featureErr))
		return
	}

	sps := service.NewSpacePermissionService(eid)
	canEditSpc, err := sps.CheckSpacePermission(userID, spaceID, model.PERMISSION_MANAGE)

	if (!canEditSpc || err != nil) && !common.IsAdmin(c) {
		c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(errors.New("无权限删除此空间")))
		return
	}

	// 获取空间信息用于日志记录
	space, err := model.GetSpaceByID(eid, spaceID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
		return
	}

	if err := model.DeleteSpace(eid, spaceID); err != nil {
		c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(err))
		return
	}

	// 记录删除日志
	LogSpaceDelete(c, space.Name)

	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}

// BatchUpdateSpaceSort godoc
// @Summary 批量更新空间排序
// @Description 批量更新空间的排序顺序
// @Tags 空间管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body SpaceSortRequest true "空间排序信息"
// @Success 200 {object} model.CommonResponse
// @Router /api/spaces/sort [post]
func BatchUpdateSpaceSort(c *gin.Context) {
	eid := config.GetEID(c)

	// 检查功能是否可用
	params := map[string]interface{}{
		"from": "space",
	}
	_, err := service.IsFeatureAvailable(c, "knowledge_base", params)
	if err != nil {
		c.JSON(http.StatusForbidden, model.FeatureNotAvailableError.ToResponse(err))
		return
	}

	var req SpaceSortRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	if !common.IsAdmin(c) {
		c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(errors.New("无权限操作此空间")))
		return
	}

	if err := model.BatchUpdateSpaceSort(eid, req.Spaces); err != nil {
		c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(err))
		return
	}

	// 记录批量排序日志
	LogSpaceBatchSort(c, len(req.Spaces))

	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}

// KnowledgeGraphConfigRequest 空间图谱管线配置（图谱总开关 + 知识库范围，空=全部）
type KnowledgeGraphConfigRequest struct {
	EnableKnowledgeGraph bool     `json:"enable_knowledge_graph" example:"false"`
	LibraryIDs           []string `json:"library_ids" example:"[\"hashid1\",\"hashid2\"]"`
}

// KnowledgeGraphConfigResponse 空间图谱管线配置响应（library_ids 为空=全部）
type KnowledgeGraphConfigResponse struct {
	EnableKnowledgeGraph bool     `json:"enable_knowledge_graph"`
	LibraryIDs           []string `json:"library_ids"`
}

type WikiKnowledgeGraphConfigRequest struct {
	EnableWikiKnowledgeGraph   *bool    `json:"enable_wiki_knowledge_graph" example:"true"`
	EnableWikiDynamicKnowledge *bool    `json:"enable_wiki_dynamic_knowledge" example:"true"`
	WikiGenerationMode         *string  `json:"wiki_generation_mode" example:"lazy"`
	LibraryIDs                 []string `json:"library_ids" example:"[\"hashid1\",\"hashid2\"]"`
}

type WikiKnowledgeGraphLibraryInfo struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Icon string `json:"icon"`
}

type WikiKnowledgeGraphConfigResponse struct {
	EnableWikiKnowledgeGraph   bool                            `json:"enable_wiki_knowledge_graph"`
	EnableWikiDynamicKnowledge bool                            `json:"enable_wiki_dynamic_knowledge"`
	WikiGenerationMode         string                          `json:"wiki_generation_mode"`
	LibraryIDs                 []string                        `json:"library_ids"`
	Libraries                  []WikiKnowledgeGraphLibraryInfo `json:"libraries"`
}

// GetSpaceKnowledgeGraphConfig godoc
// @Summary 获取空间图谱管线配置
// @Description 获取空间图谱开关与知识库范围（library_ids 空=全部）
// @Tags 空间管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param space_id path int true "空间ID"
// @Success 200 {object} model.CommonResponse{data=KnowledgeGraphConfigResponse}
// @Router /api/spaces/{space_id}/knowledge-graph [get]
func GetSpaceKnowledgeGraphConfig(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	id := c.Param("space_id")
	if id == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("空间ID不能为空")))
		return
	}
	spaceID, err := strconv.ParseInt(id, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的空间ID")))
		return
	}

	// 空间可见性校验（与 GetSpace 一致）
	sps := service.NewSpacePermissionService(eid)
	canView, err := sps.CheckSpacePermission(userID, spaceID, model.PERMISSION_PUBLIC_ONLY)
	if (!canView || err != nil) && !common.IsAdmin(c) {
		c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(errors.New("无权限访问此空间")))
		return
	}

	space, err := model.GetSpaceByID(eid, spaceID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
		return
	}

	libraryIDs, err := model.GetSpaceKnowledgeGraphLibraryIDs(model.DB, eid, spaceID, model.SpaceKnowledgeGraphScopeNormal)
	if err != nil {
		logger.Errorf(c, "读取空间图谱知识库范围失败: space_id=%d err=%v", spaceID, err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}
	encoded := make([]string, 0, len(libraryIDs))
	for _, libraryID := range libraryIDs {
		if s, encodeErr := hashids.Encode(libraryID); encodeErr == nil {
			encoded = append(encoded, s)
		}
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(KnowledgeGraphConfigResponse{
		EnableKnowledgeGraph: space.EnableKnowledgeGraph,
		LibraryIDs:           encoded,
	}))
}

// UpdateSpaceKnowledgeGraphConfig godoc
// @Summary 保存空间图谱管线配置
// @Description 保存空间图谱开关与知识库范围（library_ids 空=全部）
// @Tags 空间管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param space_id path int true "空间ID"
// @Param config body KnowledgeGraphConfigRequest true "图谱配置"
// @Success 200 {object} model.CommonResponse
// @Router /api/spaces/{space_id}/knowledge-graph [put]
func UpdateSpaceKnowledgeGraphConfig(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	id := c.Param("space_id")
	if id == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("空间ID不能为空")))
		return
	}
	spaceID, err := strconv.ParseInt(id, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的空间ID")))
		return
	}

	// 检查功能是否可用
	params := map[string]interface{}{
		"from": "space",
	}
	if _, featureErr := isSpaceFeatureAvailable(c, "space", params); featureErr != nil {
		c.JSON(http.StatusForbidden, model.FeatureNotAvailableError.ToResponse(featureErr))
		return
	}

	// 空间管理权限（与 UpdateSpace 一致）
	sps := service.NewSpacePermissionService(eid)
	canEdit, err := sps.CheckSpacePermission(userID, spaceID, model.PERMISSION_MANAGE)
	if (!canEdit || err != nil) && !common.IsAdmin(c) {
		c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(errors.New("无权限修改此空间")))
		return
	}

	var req KnowledgeGraphConfigRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 知识库范围：hashid 数组解码；空 = 全部
	libraryIDs, err := middleware.BatchDecodeIDStrings(req.LibraryIDs)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的知识库ID")))
		return
	}
	if len(libraryIDs) > 0 {
		var count int64
		if err := model.DB.Model(&model.Library{}).Where("eid = ? AND space_id = ? AND id IN ?", eid, spaceID, libraryIDs).Count(&count).Error; err != nil {
			logger.Errorf(c, "校验知识库范围失败: eid=%d space_id=%d err=%v", eid, spaceID, err)
			c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
			return
		}
		if count != int64(len(libraryIDs)) {
			c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("存在不属于该空间的知识库")))
			return
		}
	}

	space, err := model.GetSpaceByID(eid, spaceID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
		return
	}

	// 开启图谱总开关时，在同一事务内初始化默认图谱管线与兜底策略（幂等）。
	// 任一步失败整体回滚，避免出现「开关已开但默认管线缺失」。
	err = model.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(space).Update("enable_knowledge_graph", req.EnableKnowledgeGraph).Error; err != nil {
			return err
		}
		if err := model.ReplaceSpaceKnowledgeGraphLibraryScope(tx, eid, spaceID, model.SpaceKnowledgeGraphScopeNormal, libraryIDs); err != nil {
			return err
		}
		if req.EnableKnowledgeGraph {
			if err := enterpriseinit.EnsureDefaultGraphPipelineForEnterprise(c.Request.Context(), tx, eid); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		logger.Errorf(c, "保存空间图谱配置失败: space_id=%d err=%v", spaceID, err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}

// GetSpaceWikiKnowledgeGraphConfig 获取空间 Wiki 生成范围。
// @Summary 获取空间 Wiki 生成范围
// @Tags 空间管理
// @Produce json
// @Security BearerAuth
// @Param space_id path int true "空间ID"
// @Success 200 {object} model.CommonResponse{data=WikiKnowledgeGraphConfigResponse}
// @Router /api/spaces/{space_id}/wiki-knowledge-graph [get]
func GetSpaceWikiKnowledgeGraphConfig(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)
	spaceID, err := strconv.ParseInt(c.Param("space_id"), 10, 64)
	if err != nil || spaceID <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的空间ID")))
		return
	}
	if canView, checkErr := service.NewSpacePermissionService(eid).CheckSpacePermission(userID, spaceID, model.PERMISSION_VIEW_ONLY); checkErr != nil || !canView {
		if !common.IsAdmin(c) {
			c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(errors.New("无权限查看此空间")))
			return
		}
	}
	space, err := model.GetSpaceByID(eid, spaceID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
		return
	}
	response, err := buildWikiKnowledgeGraphConfigResponse(model.DB, eid, spaceID, space)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(response))
}

// UpdateSpaceWikiKnowledgeGraphConfig 保存空间 Wiki 开关与生成范围。
// @Summary 保存空间 Wiki 开关与生成范围
// @Tags 空间管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param space_id path int true "空间ID"
// @Param config body WikiKnowledgeGraphConfigRequest true "Wiki 开关与范围"
// @Success 200 {object} model.CommonResponse{data=WikiKnowledgeGraphConfigResponse}
// @Router /api/spaces/{space_id}/wiki-knowledge-graph [put]
func UpdateSpaceWikiKnowledgeGraphConfig(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)
	spaceID, err := strconv.ParseInt(c.Param("space_id"), 10, 64)
	if err != nil || spaceID <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的空间ID")))
		return
	}
	if canEdit, checkErr := service.NewSpacePermissionService(eid).CheckSpacePermission(userID, spaceID, model.PERMISSION_MANAGE); (checkErr != nil || !canEdit) && !common.IsAdmin(c) {
		c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(errors.New("无权限修改此空间")))
		return
	}
	var req WikiKnowledgeGraphConfigRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	if req.WikiGenerationMode != nil && !model.IsValidWikiGenerationMode(*req.WikiGenerationMode) {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的 Wiki 生成模式")))
		return
	}
	libraryIDs, err := middleware.BatchDecodeIDStrings(req.LibraryIDs)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("无效的知识库ID")))
		return
	}
	if len(libraryIDs) > 0 {
		var count int64
		if err := model.DB.Model(&model.Library{}).Where("eid = ? AND space_id = ? AND id IN ?", eid, spaceID, libraryIDs).Count(&count).Error; err != nil {
			c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
			return
		}
		if count != int64(len(libraryIDs)) {
			c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("存在不属于该空间的知识库")))
			return
		}
	}
	if _, err := model.GetSpaceByID(eid, spaceID); err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
		return
	}
	if err := model.DB.Transaction(func(tx *gorm.DB) error {
		updates := map[string]interface{}{}
		if req.EnableWikiKnowledgeGraph != nil {
			updates["enable_wiki_knowledge_graph"] = *req.EnableWikiKnowledgeGraph
		}
		if req.EnableWikiDynamicKnowledge != nil {
			updates["enable_wiki_dynamic_knowledge"] = *req.EnableWikiDynamicKnowledge
		}
		if req.WikiGenerationMode != nil {
			updates["wiki_generation_mode"] = *req.WikiGenerationMode
		}
		if len(updates) > 0 {
			if err := tx.Model(&model.Space{}).Where("eid = ? AND id = ?", eid, spaceID).Updates(updates).Error; err != nil {
				return err
			}
		}
		if err := model.ReplaceSpaceKnowledgeGraphLibraryScope(tx, eid, spaceID, model.SpaceKnowledgeGraphScopeWiki, libraryIDs); err != nil {
			return err
		}
		return enterpriseinit.EnsureDefaultWikiPipelineForEnterprise(c.Request.Context(), tx, eid)
	}); err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}
	space, err := model.GetSpaceByID(eid, spaceID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}
	response, err := buildWikiKnowledgeGraphConfigResponse(model.DB, eid, spaceID, space)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(response))
}

func buildWikiKnowledgeGraphConfigResponse(db *gorm.DB, eid, spaceID int64, space *model.Space) (*WikiKnowledgeGraphConfigResponse, error) {
	libraryIDs, err := model.GetSpaceKnowledgeGraphLibraryIDs(db, eid, spaceID, model.SpaceKnowledgeGraphScopeWiki)
	if err != nil {
		return nil, err
	}
	query := db.Model(&model.Library{}).Where("eid = ? AND space_id = ?", eid, spaceID)
	if len(libraryIDs) > 0 {
		query = query.Where("id IN ?", libraryIDs)
	}
	var libraries []model.Library
	if err := query.Order("sort asc, id asc").Find(&libraries).Error; err != nil {
		return nil, err
	}
	encodedIDs := make([]string, 0, len(libraryIDs))
	for _, libraryID := range libraryIDs {
		value, encodeErr := hashids.Encode(libraryID)
		if encodeErr != nil {
			return nil, encodeErr
		}
		encodedIDs = append(encodedIDs, value)
	}
	items := make([]WikiKnowledgeGraphLibraryInfo, 0, len(libraries))
	for _, library := range libraries {
		value, encodeErr := hashids.Encode(library.ID)
		if encodeErr != nil {
			return nil, encodeErr
		}
		items = append(items, WikiKnowledgeGraphLibraryInfo{ID: value, Name: library.Name, Icon: library.Icon})
	}
	return &WikiKnowledgeGraphConfigResponse{
		EnableWikiKnowledgeGraph:   space.EnableWikiKnowledgeGraph,
		EnableWikiDynamicKnowledge: space.EnableWikiDynamicKnowledge,
		WikiGenerationMode:         model.NormalizeWikiGenerationMode(space.WikiGenerationMode),
		LibraryIDs:                 encodedIDs,
		Libraries:                  items,
	}, nil
}
