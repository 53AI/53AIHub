package controller

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	mcpsvc "github.com/53AI/53AIHub/service/mcp"
	"github.com/gin-gonic/gin"
)

// APIKeyController API密钥控制器
type APIKeyController struct{}

// NewAPIKeyController 创建API密钥控制器
func NewAPIKeyController() *APIKeyController {
	return &APIKeyController{}
}

// CreateAPIKeyRequest 创建API密钥请求
type CreateAPIKeyRequest struct {
	Name        string `json:"name" binding:"required"`
	Description string `json:"description"`
}

// CreateAPIKeyResponse 创建API密钥响应
type CreateAPIKeyResponse struct {
	Key string `json:"key"`
	ID  int64  `json:"id"`
}

// GetAPIKeysResponse 获取API密钥列表响应
type GetAPIKeysResponse struct {
	APIKeys []APIKeyInfo `json:"api_keys"`
}

// APIKeyInfo API密钥信息
type APIKeyInfo struct {
	ID          int64      `json:"id"`
	Name        string     `json:"name"`
	Description string     `json:"description"`
	Eid         int64      `json:"eid"`
	CreatorID   int64      `json:"creator_id"`
	LibraryID   *int64     `json:"library_id,omitempty"`
	SpaceID     *int64     `json:"space_id,omitempty"`
	Status      int        `json:"status"`
	CreatedTime int64      `json:"created_time"`
	UpdatedTime int64      `json:"updated_time"`
	ExpiresAt   *time.Time `json:"expires_at"`
	Key         string     `json:"key"`
}

// CreateAPIKey 创建API密钥
// @Summary 创建API密钥
// @Description 创建一个新的API密钥用于外部系统集成。仅限管理员或有知识库管理权限的用户调用。
// @Tags API密钥管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body CreateAPIKeyRequest true "创建API密钥请求"
// @Param library_id path int false "知识库ID（通过路径传递）"
// @Param space_id path int false "空间ID（通过路径传递，创建空间级API密钥）"
// @Success 200 {object} model.CommonResponse{data=CreateAPIKeyResponse} "成功创建API密钥"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 403 {object} model.CommonResponse "权限不足"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/api-keys [post]
// @Router /api/libraries/{library_id}/api-keys [post]  # 知识库相关路由
// @Router /api/spaces/{space_id}/api-keys [post]  # 空间相关路由
func (ctrl *APIKeyController) CreateAPIKey(c *gin.Context) {
	var req CreateAPIKeyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	eid := config.GetEID(c)
	creatorID := config.GetUserId(c)
	role := config.GetUserRole(c)

	libraryID, spaceID, ok := parseAPIKeyPathScope(c)
	if !ok {
		return
	}

	apiKeyService := mcpsvc.NewAPIKeyService()
	apiKey, apiKeyStr, err := apiKeyService.CreateAPIKey(c.Request.Context(), eid, creatorID, role, req.Name, req.Description, libraryID, spaceID)
	if err != nil {
		if isPermissionRelatedError(err) {
			c.JSON(http.StatusForbidden, model.ForbiddenError.ToResponse(err))
			return
		}
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(CreateAPIKeyResponse{Key: apiKeyStr, ID: apiKey.ID}))
}

// GetAPIKeys 获取API密钥列表
// @Summary 获取API密钥列表
// @Description 获取当前企业下的API密钥列表。管理员可获取全局API密钥，普通用户只能获取与有权限的知识库关联的API密钥。
// @Tags API密钥管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param type query string false "筛选类型：personal=个人key，library=知识库key，默认library"
// @Param library_id path int false "知识库ID（通过路径传递）"
// @Param space_id path int false "空间ID（通过路径传递，获取空间级API密钥）"
// @Success 200 {object} model.CommonResponse{data=GetAPIKeysResponse} "成功获取API密钥列表"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 403 {object} model.CommonResponse "权限不足"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/api-keys [get]
// @Router /api/libraries/{library_id}/api-keys [get]  # 知识库相关路由
// @Router /api/spaces/{space_id}/api-keys [get]  # 空间相关路由
func (ctrl *APIKeyController) GetAPIKeys(c *gin.Context) {
	eid := config.GetEID(c)
	if eid == 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("缺少企业ID参数"))
		return
	}

	creatorID := config.GetUserId(c)
	role := config.GetUserRole(c)
	keyType := strings.ToLower(strings.TrimSpace(c.Query("type")))
	if keyType != "" && keyType != "personal" && keyType != "library" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("无效的API密钥类型参数"))
		return
	}

	libraryID, spaceID, ok := parseAPIKeyPathScope(c)
	if !ok {
		return
	}

	apiKeyService := mcpsvc.NewAPIKeyService()
	apiKeys, err := apiKeyService.ListAPIKeys(c.Request.Context(), eid, creatorID, role, keyType, libraryID, spaceID)
	if err != nil {
		if isPermissionRelatedError(err) {
			c.JSON(http.StatusForbidden, model.ForbiddenError.ToResponse(err))
			return
		}
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	// 构建响应数据
	responseKeys := make([]APIKeyInfo, len(apiKeys))
	for i, key := range apiKeys {
		responseKeys[i] = APIKeyInfo{
			ID:          key.ID,
			Name:        key.Name,
			Description: key.Description,
			Eid:         key.Eid,
			CreatorID:   key.CreatorID,
			LibraryID:   key.LibraryID,
			SpaceID:     key.SpaceID,
			Status:      key.Status,
			CreatedTime: key.CreatedTime,
			UpdatedTime: key.UpdatedTime,
			ExpiresAt:   key.ExpiresAt,
			Key:         key.Key,
		}
	}

	// 规范化返回值
	response := GetAPIKeysResponse{
		APIKeys: responseKeys,
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(response))
}

// DeleteAPIKey 删除API密钥
// @Summary 删除API密钥
// @Description 删除指定ID的API密钥。需要管理员权限或对关联知识库的管理权限。
// @Tags API密钥管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param library_id path int false "知识库ID（通过路径传递）"
// @Param id path string true "API密钥ID"
// @Success 200 {object} model.CommonResponse "成功删除API密钥"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 403 {object} model.CommonResponse "权限不足"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/api-keys/{id} [delete]
// @Router /api/libraries/{library_id}/api-keys/{key_id} [delete]  # 知识库相关路由
// @Router /api/spaces/{space_id}/api-keys/{key_id} [delete]  # 空间相关路由
func (ctrl *APIKeyController) DeleteAPIKey(c *gin.Context) {
	libraryID, spaceID, ok := parseAPIKeyPathScope(c)
	if !ok {
		return
	}
	scoped := libraryID != nil || spaceID != nil

	keyID, ok := resolveAPIKeyPathID(c, scoped)
	if !ok {
		return
	}

	eid := config.GetEID(c)
	creatorID := config.GetUserId(c)
	role := config.GetUserRole(c)
	apiKeyService := mcpsvc.NewAPIKeyService()

	if err := apiKeyService.DeleteAPIKey(c.Request.Context(), eid, creatorID, role, keyID, libraryID, spaceID); err != nil {
		if isPermissionRelatedError(err) {
			c.JSON(http.StatusForbidden, model.ForbiddenError.ToResponse(err))
			return
		}
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse("API密钥删除成功"))
}

// DisableAPIKey 禁用API密钥
// @Summary 禁用API密钥
// @Description 禁用指定ID的API密钥。需要管理员权限或对关联知识库的管理权限。
// @Tags API密钥管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param library_id path int false "知识库ID（通过路径传递）"
// @Param key_id path string true "API密钥ID"
// @Success 200 {object} model.CommonResponse "成功禁用API密钥"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 403 {object} model.CommonResponse "权限不足"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/api-keys/{id}/disable [post]
// @Router /api/libraries/{library_id}/api-keys/{key_id}/disable [post]  # 知识库相关路由
// @Router /api/spaces/{space_id}/api-keys/{key_id}/disable [post]  # 空间相关路由
func (ctrl *APIKeyController) DisableAPIKey(c *gin.Context) {
	libraryID, spaceID, ok := parseAPIKeyPathScope(c)
	if !ok {
		return
	}
	scoped := libraryID != nil || spaceID != nil

	keyID, ok := resolveAPIKeyPathID(c, scoped)
	if !ok {
		return
	}

	eid := config.GetEID(c)
	creatorID := config.GetUserId(c)
	role := config.GetUserRole(c)
	apiKeyService := mcpsvc.NewAPIKeyService()

	if err := apiKeyService.SetAPIKeyStatus(c.Request.Context(), eid, creatorID, role, keyID, libraryID, spaceID, false); err != nil {
		if isPermissionRelatedError(err) {
			c.JSON(http.StatusForbidden, model.ForbiddenError.ToResponse(err))
			return
		}
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse("API密钥禁用成功"))
}

// EnableAPIKey 启用API密钥
// @Summary 启用API密钥
// @Description 启用指定ID的API密钥。需要管理员权限或对关联知识库的管理权限。
// @Tags API密钥管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param library_id path int false "知识库ID（通过路径传递）"
// @Param key_id path string true "API密钥ID"
// @Success 200 {object} model.CommonResponse "成功启用API密钥"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 403 {object} model.CommonResponse "权限不足"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/api-keys/{id}/enable [post]
// @Router /api/libraries/{library_id}/api-keys/{key_id}/enable [post]  # 知识库相关路由
// @Router /api/spaces/{space_id}/api-keys/{key_id}/enable [post]  # 空间相关路由
func (ctrl *APIKeyController) EnableAPIKey(c *gin.Context) {
	libraryID, spaceID, ok := parseAPIKeyPathScope(c)
	if !ok {
		return
	}
	scoped := libraryID != nil || spaceID != nil

	keyID, ok := resolveAPIKeyPathID(c, scoped)
	if !ok {
		return
	}

	eid := config.GetEID(c)
	creatorID := config.GetUserId(c)
	role := config.GetUserRole(c)
	apiKeyService := mcpsvc.NewAPIKeyService()

	if err := apiKeyService.SetAPIKeyStatus(c.Request.Context(), eid, creatorID, role, keyID, libraryID, spaceID, true); err != nil {
		if isPermissionRelatedError(err) {
			c.JSON(http.StatusForbidden, model.ForbiddenError.ToResponse(err))
			return
		}
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse("API密钥启用成功"))
}

// hasLibraryManagementPermission 检查用户是否有知识库管理权限
func hasLibraryManagementPermission(eid, userID, libraryID int64) (bool, error) {
	// 使用标准的服务层方法检查用户权限
	permission, err := service.GetUserPermission(eid, model.RESOURCE_TYPE_LIBRARY, libraryID, userID)
	if err != nil {
		return false, err
	}

	// 管理权限及以上（即 PERMISSION_MANAGE 及更高权限）才能管理API密钥
	return permission >= model.PERMISSION_MANAGE, nil
}

func isPermissionRelatedError(err error) bool {
	if err == nil {
		return false
	}
	message := err.Error()
	return strings.Contains(message, "权限") || strings.Contains(message, "无权")
}

// parseAPIKeyPathScope 解析路径中的知识库/空间作用域参数。
// 路由参数经过 HashidsDecoder 已解码为原始数字字符串，兼容 hashid 与原始 int64。
func parseAPIKeyPathScope(c *gin.Context) (libraryID, spaceID *int64, ok bool) {
	if raw := strings.TrimSpace(c.Param("library_id")); raw != "" {
		id, err := hashids.TryParseID(raw)
		if err != nil || id <= 0 {
			c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("无效的知识库ID参数"))
			return nil, nil, false
		}
		libraryID = &id
	}
	if raw := strings.TrimSpace(c.Param("space_id")); raw != "" {
		id, err := hashids.TryParseID(raw)
		if err != nil || id <= 0 {
			c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("无效的空间ID参数"))
			return nil, nil, false
		}
		spaceID = &id
	}
	return libraryID, spaceID, true
}

// resolveAPIKeyPathID 解析路径中的 API 密钥 ID。
// scoped 路由使用 key_id（hashid），全局管理路由使用 id（原始 int64）。
func resolveAPIKeyPathID(c *gin.Context, scoped bool) (int64, bool) {
	if scoped {
		raw := strings.TrimSpace(c.Param("key_id"))
		if raw == "" {
			c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("缺少API密钥ID参数"))
			return 0, false
		}
		id, err := hashids.TryParseID(raw)
		if err != nil || id <= 0 {
			c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("无效的API密钥ID参数"))
			return 0, false
		}
		return id, true
	}

	raw := strings.TrimSpace(c.Param("id"))
	if raw == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("缺少API密钥ID参数"))
		return 0, false
	}
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("无效的API密钥ID参数"))
		return 0, false
	}
	return id, true
}
