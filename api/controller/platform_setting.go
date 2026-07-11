package controller

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"

	"github.com/53AI/53AIHub/common/session"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/gin-gonic/gin"
)

type PlatformSettingRequest struct {
	PlatformKey string `json:"platform_key" example:"tingwu"` // 当PlatformKey为tingwu时，setting中需要包含app_key、access_key_id、access_key_secret、endpoint
	Setting     string `json:"setting" example:"{\"app_key\":\"your_app_key\",\"access_key_id\":\"your_access_key_id\",\"access_key_secret\":\"your_access_key_secret\",\"endpoint\":\"your_endpoint\"}"` // 当PlatformKey为tingwu时，必须包含app_key、access_key_id、access_key_secret、endpoint字段
	ExternalID  string `json:"external_id" example:"wps_external_id"`
	Status      string `json:"status" example:"enabled"` // 添加status字段
}

type WPSIntegrationStatusResponse struct {
	IsConfigured bool   `json:"is_configured" example:"true"` // 是否已配置WPS
	Eid          int64  `json:"eid" example:"123"`            // 企业ID
	PlatformKey  string `json:"platform_key" example:"wps"`   // 平台键
	AppID        string `json:"app_id" example:"wps_app_id"`  // WPS应用ID
}

type PlatformSettingDefaultMetaResponse struct {
	PlatformKey        string `json:"platform_key" example:"textin"`           // 平台键
	DisplayName        string `json:"display_name" example:"TextIn"`           // 默认展示名称
	DisplayDescription string `json:"display_description" example:"默认展示描述"` // 默认展示描述
}

type PlatformSettingListResponse struct {
	ID                 int64  `json:"id"`
	Eid                int64  `json:"eid"`
	Setting            string `json:"setting"`
	PlatformKey        string `json:"platform_key"`
	ExternalID         string `json:"external_id"`
	Status             string `json:"status"`
	DisplayName        string `json:"display_name"`
	DisplayDescription string `json:"display_description"`
	CreatedTime        int64  `json:"created_time"`
	UpdatedTime        int64  `json:"updated_time"`
}

func buildPlatformSettingListResponse(platformSetting model.PlatformSetting) PlatformSettingListResponse {
	return PlatformSettingListResponse{
		ID:                 platformSetting.ID,
		Eid:                platformSetting.Eid,
		Setting:            platformSetting.Setting,
		PlatformKey:        platformSetting.PlatformKey,
		ExternalID:         platformSetting.ExternalID,
		Status:             platformSetting.Status,
		DisplayName:        platformSetting.DisplayName,
		DisplayDescription: platformSetting.DisplayDescription,
		CreatedTime:        platformSetting.CreatedTime,
		UpdatedTime:        platformSetting.UpdatedTime,
	}
}

// @Summary 创建平台设置
// @Description 创建新的平台设置条目
// @Tags 能力平台设置
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param platform_setting body PlatformSettingRequest true "平台设置数据"
// @Success 200 {object} model.CommonResponse
// @Router /api/platform-settings [post]
func CreatePlatformSetting(c *gin.Context) {
	var req PlatformSettingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	platformSetting := model.PlatformSetting{
		Eid:         config.GetEID(c),
		Setting:     req.Setting,
		PlatformKey: req.PlatformKey,
		ExternalID:  req.ExternalID,
		Status:      req.Status, // 添加status字段
	}

	// 如果请求中没有指定状态，则默认为启用
	if platformSetting.Status == "" {
		platformSetting.Status = model.PLATFORM_STATUS_ENABLED
	}

	if err := model.CreatePlatformSetting(&platformSetting); err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(platformSetting))
}

// @Summary 获取平台设置详情
// @Description 根据ID获取平台设置详情
// @Tags 能力平台设置
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "平台设置ID"
// @Success 200 {object} model.CommonResponse
// @Router /api/platform-settings/{id} [get]
func GetPlatformSetting(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	platformSetting, err := model.GetPlatformSettingByID(int64(id))

	if err != nil || platformSetting.Eid != config.GetEID(c) {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(nil))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(platformSetting))
}

// @Summary 更新平台设置
// @Description 更新现有的平台设置
// @Tags 能力平台设置
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "平台设置ID"
// @Param platform_setting body PlatformSettingRequest true "更新数据"
// @Success 200 {object} model.CommonResponse
// @Router /api/platform-settings/{id} [put]
func UpdatePlatformSetting(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	platformSetting, err := model.GetPlatformSettingByID(int64(id))

	if err != nil || platformSetting.Eid != config.GetEID(c) {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(nil))
		return
	}

	var req PlatformSettingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	platformSetting.Setting = req.Setting
	platformSetting.PlatformKey = req.PlatformKey
	platformSetting.ExternalID = req.ExternalID
	platformSetting.Status = req.Status // 添加status字段

	// 如果请求中没有指定状态，则默认为启用
	if platformSetting.Status == "" {
		platformSetting.Status = model.PLATFORM_STATUS_ENABLED
	}

	if err := model.UpdatePlatformSetting(platformSetting); err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(platformSetting))
}

// @Summary 删除平台设置
// @Description 根据ID删除平台设置
// @Tags 能力平台设置
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "平台设置ID"
// @Success 200 {object} model.CommonResponse
// @Router /api/platform-settings/{id} [delete]
func DeletePlatformSetting(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	platformSetting, err := model.GetPlatformSettingByID(int64(id))

	if err == nil && platformSetting.Eid == config.GetEID(c) {
		err = model.DeletePlatformSettingByID(int64(id))
	}

	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}

// @Summary 获取平台设置列表
// @Description 获取当前企业的所有平台设置，可通过platform_key筛选
// @Tags 能力平台设置
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param platform_key query string false "平台键筛选"
// @Success 200 {object} model.CommonResponse
// @Router /api/platform-settings [get]
func GetPlatformSettings(c *gin.Context) {
	platformKey := c.Query("platform_key")

	var platformSettings []model.PlatformSetting
	var err error

	if platformKey != "" {
		// 根据platform_key筛选
		platformSetting, err := model.GetPlatformSettingByEidAndPlatformKey(config.GetEID(c), platformKey)
		if err != nil {
			c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
			return
		}

		if platformSetting != nil {
			platformSettings = []model.PlatformSetting{*platformSetting}
		} else {
			platformSettings = []model.PlatformSetting{}
		}
	} else {
		// 获取所有设置
		platformSettings, err = model.GetPlatformSettingsByEid(config.GetEID(c))
		if err != nil {
			c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
			return
		}
	}

	responses := make([]PlatformSettingListResponse, 0, len(platformSettings))
	for _, platformSetting := range platformSettings {
		responses = append(responses, buildPlatformSettingListResponse(platformSetting))
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(responses))
}

// @Summary 获取平台设置默认元数据
// @Description 获取代码内默认的平台设置展示元数据，供前端渲染候选项和说明文案
// @Tags 能力平台设置
// @Accept json
// @Produce json
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse
// @Router /api/platform-settings/default-metas [get]
func GetDefaultPlatformSettings(c *gin.Context) {
	defaultMetas := model.ListDefaultPlatformSettingDisplayMetas()
	responses := make([]PlatformSettingDefaultMetaResponse, 0, len(defaultMetas))
	for _, meta := range defaultMetas {
		responses = append(responses, PlatformSettingDefaultMetaResponse{
			PlatformKey:        meta.PlatformKey,
			DisplayName:        meta.DisplayName,
			DisplayDescription: meta.DisplayDescription,
		})
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(responses))
}

// @Summary 检查WPS接入状态
// @Description 检查当前企业是否已正确配置WPS平台接入
// @Tags 能力平台设置
// @Accept json
// @Produce json
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse{data=WPSIntegrationStatusResponse} "返回WPS接入状态"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 500 {object} model.CommonResponse "服务器错误"
// @Router /api/platform-settings/wps/status [get]
func CheckWPSIntegrationStatus(c *gin.Context) {
	// eid := config.GetEID(c)
	eid, exists := c.Get(session.ENV_EID)
	if !exists {
		c.JSON(http.StatusInternalServerError, model.ParamError.ToResponse(nil))
		return
	}

	platformSetting, err := model.GetPlatformSettingByEidAndPlatformKey(eid.(int64), model.PLATFORM_KEY_WPS)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	response := WPSIntegrationStatusResponse{
		IsConfigured: platformSetting != nil,
		Eid:          eid.(int64),
		PlatformKey:  model.PLATFORM_KEY_WPS,
		AppID: func() string {
			if platformSetting != nil {
				return platformSetting.ExternalID
			}
			return ""
		}(),
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(response))
}

// BochaAIKeySetting 博查AI密钥设置结构体
type BochaAIKeySetting struct {
	APIKey string `json:"api_key"`
}

// @Summary 测试博查AI搜索功能
// @Description 根据平台设置ID测试博查AI搜索功能是否正常
// @Tags 能力平台设置
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "平台设置ID"
// @Success 200 {object} model.CommonResponse
// @Router /api/platform-settings/{id}/test-bochaai-search [post]
func TestBochaAISearch(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	platformSetting, err := model.GetPlatformSettingByID(int64(id))

	if err != nil || platformSetting.Eid != config.GetEID(c) {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(nil))
		return
	}

	// 检查平台设置是否为博查AI类型
	if platformSetting.PlatformKey != model.PLATFORM_BOCHAAI {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(fmt.Errorf("平台设置类型不匹配，期望: %s, 实际: %s", model.PLATFORM_BOCHAAI, platformSetting.PlatformKey)))
		return
	}

	// 解析设置中的API密钥
	var apiKeySetting BochaAIKeySetting
	if err := json.Unmarshal([]byte(platformSetting.Setting), &apiKeySetting); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(fmt.Errorf("解析API密钥失败: %v", err)))
		return
	}

	if apiKeySetting.APIKey == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(fmt.Errorf("API密钥不能为空")))
		return
	}

	// 创建博查AI服务实例
	bochaAIService := service.NewBochaAIService(apiKeySetting.APIKey)

	// 创建搜索请求，使用简单的查询词，只请求1个结果
	request := service.SearchRequest{
		Query:   "人工智能",
		Count:   1,
		Summary: true,
	}

	// 执行搜索
	response, err := bochaAIService.Search(request)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ParamError.ToResponse(fmt.Errorf("搜索请求失败: %v", err)))
		return
	}

	// 检查响应状态码
	codeStr, ok := response.Code.(string)
	if ok {
		if codeStr != "200" {
			c.JSON(http.StatusInternalServerError, model.ParamError.ToResponse(fmt.Errorf("搜索响应错误，状态码: %s", codeStr)))
			return
		}
	} else {
		codeNum, ok := response.Code.(float64) // JSON数字默认解析为float64
		if ok {
			if codeNum != 200 {
				c.JSON(http.StatusInternalServerError, model.ParamError.ToResponse(fmt.Errorf("搜索响应错误，状态码: %f", codeNum)))
				return
			}
		} else {
			c.JSON(http.StatusInternalServerError, model.ParamError.ToResponse(fmt.Errorf("无法识别的响应状态码类型: %T, 值: %v", response.Code, response.Code)))
			return
		}
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(response))
}

// @Summary 切换平台设置状态
// @Description 启用或禁用平台设置
// @Tags 能力平台设置
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "平台设置ID"
// @Param status query string true "状态值: enabled 或 disabled"
// @Success 200 {object} model.CommonResponse
// @Router /api/platform-settings/{id}/toggle [post]
func TogglePlatformSettingStatus(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	status := c.Query("status")

	// 验证状态参数
	if status != model.PLATFORM_STATUS_ENABLED && status != model.PLATFORM_STATUS_DISABLED {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(fmt.Errorf("无效的状态值: %s", status)))
		return
	}

	platformSetting, err := model.GetPlatformSettingByID(int64(id))
	if err != nil || platformSetting.Eid != config.GetEID(c) {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(nil))
		return
	}

	platformSetting.Status = status
	if err := model.UpdatePlatformSetting(platformSetting); err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(platformSetting))
}
