package controller

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/gin-gonic/gin"
)

// FrontChannel 用于前台展示，不包含敏感信息
type FrontChannel struct {
	ChannelID          int64   `json:"channel_id"`
	Eid                int64   `json:"eid"`
	Type               int     `json:"type"`
	Name               string  `json:"name"`
	Models             string  `json:"models"`
	Config             string  `json:"config"`
	CustomConfig       string  `json:"custom_config"`
	Other              *string `json:"other"`
	ModelMapping       *string `json:"model_mapping"`
	Weight             *uint   `json:"weight"`
	Priority           *int64  `json:"priority"`
	UsedQuota          int64   `json:"used_quota"`
	Status             int     `json:"status"`
	Balance            float64 `json:"balance"`
	BalanceUpdatedTime int64   `json:"balance_updated_time"`
	TestTime           int64   `json:"test_time"`
	ResponseTime       int     `json:"response_time"`
	ProviderID         int64   `json:"provider_id"`
	CreatedAt          int64   `json:"created_at"`
	UpdatedAt          int64   `json:"updated_at"`
}

// 将 Channel 转换为 FrontChannel，移除敏感字段
func convertToFrontChannel(channel *model.Channel) *FrontChannel {
	return &FrontChannel{
		ChannelID:          channel.ChannelID,
		Eid:                channel.Eid,
		Type:               channel.Type,
		Name:               channel.Name,
		Models:             channel.Models,
		Config:             channel.Config,
		CustomConfig:       channel.CustomConfig,
		Other:              channel.Other,
		ModelMapping:       channel.ModelMapping,
		Weight:             channel.Weight,
		Priority:           channel.Priority,
		UsedQuota:          channel.UsedQuota,
		Status:             channel.Status,
		Balance:            channel.Balance,
		BalanceUpdatedTime: channel.BalanceUpdatedTime,
		TestTime:           channel.TestTime,
		ResponseTime:       channel.ResponseTime,
		ProviderID:         channel.ProviderID,
		CreatedAt:          channel.CreatedTime,
		UpdatedAt:          channel.UpdatedTime,
	}
}

// 将 Channel 列表转换为 FrontChannel 列表
func convertToFrontChannels(channels []*model.Channel) []*FrontChannel {
	frontChannels := make([]*FrontChannel, len(channels))
	for i, channel := range channels {
		frontChannels[i] = convertToFrontChannel(channel)
	}
	return frontChannels
}

// autoAssignCozeStudioProvider automatically assigns a ProviderID for CozeStudio channels
// when ProviderID is 0 in the request
// In multi-provider environments, this should be explicitly specified by the client
func autoAssignCozeStudioProvider(channel *model.Channel) error {
	// Check if this is a CozeStudio channel and ProviderID is 0
	if channel.Type == model.ChannelApiTypeCozeStudio && channel.ProviderID == 0 {
		// Get all CozeStudio providers for this enterprise
		providers, err := model.GetProvidersByEidAndProviderType(channel.Eid, model.ProviderTypeCozeStudio)
		if err != nil {
			return err
		}
		if len(providers) == 0 {
			return fmt.Errorf("no CozeStudio provider found for enterprise %d", channel.Eid)
		}

		// If there's only one provider, auto-assign it
		if len(providers) == 1 {
			channel.ProviderID = providers[0].ProviderID
		} else {
			// Multiple providers found - this is ambiguous in multi-provider environment
			// Return error to force explicit provider selection
			return fmt.Errorf("multiple CozeStudio providers found (%d), please specify provider_id explicitly", len(providers))
		}
	}
	return nil
}

type ChannelRequest struct {
	// gemini 24；月之暗面 25； 自定义模型 1012
	Type   int    `json:"type" example:"1"`
	Key    string `json:"key" example:"channel_key"`
	Name   string `json:"name" example:"channel_name"`
	Models string `json:"models" example:"gpt-3.5-turbo"`
	// - model_id: 模型唯一标识符, - model_name: 模型显示名称, - model_type: 模型类型（1=text, 2=embedding, 3=rerank） 这几个不需要
	// Config字段：存储渠道特定配置信息，由前端直接传入
	// 对于自定义模型（ChannelApiTypeCustomOpenAI），存储模型特定配置，包括：
	// - base_url_model_name: 基础URL中的模型名称
	// - completion_mode: 完成模式（chat, completion）
	// - context_length: 上下文长度
	// - max_tokens: 最大token限制
	// - deep_thinking: 是否支持深度思考功能
	// - function_calling: 是否支持函数调用
	// - stream_function_calling: 是否支持流式函数调用
	// - vision: 是否支持视觉识别
	// - structured_output: 是否支持结构化输出
	// - stream_separator: 流式响应的分隔符
	// 注意：Config字段只包含一份配置数据，不包含enabled字段
	Config string `json:"config" example:"{\"completion_mode\":\"chat\",\"context_length\":4096,\"function_calling\":true}"`

	// CustomConfig字段：用于前端配置传输和展示的原始JSON字符串
	// 仅用于接收前端传入的原始配置，由前端定义具体结构
	CustomConfig string  `json:"custom_config" example:"{}"`
	ModelMapping *string `json:"model_mapping"`
	Weight       *uint   `json:"weight"`
	Priority     *int64  `json:"priority"`
	BaseURL      *string `json:"base_url"`
	Other        *string `json:"other"`
	ProviderID   *int64  `json:"provider_id" example:"181"`
}

// CustomModelRequest represents the structure for custom model configuration
type CustomModelRequest struct {
	ModelID          string  `json:"model_id" binding:"required"`
	ModelName        string  `json:"model_name"`
	BaseURLModelName *string `json:"base_url_model_name"`
	ModelType        int     `json:"model_type" binding:"required"` // 1=text, 2=embedding, 3=rerank
	CompletionMode   string  `json:"completion_mode"`               // chat, completion
	ContextLength    int     `json:"context_length"`
	MaxTokens        *int    `json:"max_tokens"`              // 可选，仅对embedding/rerank模型
	DeepThinking     *bool   `json:"deep_thinking"`           // 可选，仅对text模型
	FunctionCall     *bool   `json:"function_calling"`        // 可选，仅对text模型
	StreamFunction   *bool   `json:"stream_function_calling"` // 可选，仅对text模型
	Vision           *bool   `json:"vision"`                  // 可选，仅对text模型
	StructuredOut    *bool   `json:"structured_output"`       // 可选，仅对text模型
	StreamSeparator  *string `json:"stream_separator"`        // 流模式返回结果的分隔符
	Enabled          bool    `json:"enabled"`                 // 模型是否启用
}

// @Summary Create channel
// @Description Create new channel configuration. type: 1013=OpenClaw (HTTP), 1014=OpenClawWS (WebSocket长连接，用于插件实时通信)
// @Tags Channel
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param channel body ChannelRequest true "Channel data"
// @Success 200 {object} model.CommonResponse
// @Router /api/channels [post]
func CreateChannel(c *gin.Context) {
	var req ChannelRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 特殊处理自定义模型类型 (1012)
	if req.Type == model.ChannelApiTypeCustomOpenAI {
		// 验证 CustomConfig 并提取必要信息
		// _, modelsList, err := validateAndExtractCustomModelConfig(c, &req)
		// if err != nil {
		// 错误响应已在 validateAndExtractCustomModelConfig 中发送
		// 	return
		// }

		// req.Models = strings.Join(modelsList, ",")
	}

	channel := model.Channel{
		Eid:          config.GetEID(c),
		Type:         req.Type,
		Key:          req.Key,
		Name:         req.Name,
		Models:       req.Models,
		Config:       req.Config,
		CustomConfig: req.CustomConfig,
		ModelMapping: req.ModelMapping,
		Weight:       req.Weight,
		Priority:     req.Priority,
		BaseURL:      req.BaseURL,
		Other:        req.Other,
		ProviderID:   0, // Default to 0 if not provided
	}

	// Set ProviderID if provided in request
	if req.ProviderID != nil {
		channel.ProviderID = *req.ProviderID
	}

	channel.Models = model.ProcessModelNames(req.Models, channel.Type)
	if channel.Models == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(strings.NewReader("models is required")))
		return
	}

	// Auto assign ProviderID for CozeStudio channels if needed
	if err := autoAssignCozeStudioProvider(&channel); err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	if err := model.CreateChannel(&channel); err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(channel))
}

// @Summary Get channel
// @Description Get channel configuration by ID
// @Tags Channel
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param channel_id path int true "Channel ID"
// @Success 200 {object} model.CommonResponse
// @Router /api/channels/{channel_id} [get]
func GetChannel(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Param("channel_id"), 10, 64)
	channel, err := model.GetChannelByID(id)

	if err != nil || channel.Eid != config.GetEID(c) {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(nil))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(channel))
}

// @Summary Update channel
// @Description Update existing channel configuration
// @Tags Channel
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param channel_id path int true "Channel ID"
// @Param channel body ChannelRequest true "Update data"
// @Success 200 {object} model.CommonResponse
// @Router /api/channels/{channel_id} [put]
func UpdateChannel(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Param("channel_id"), 10, 64)
	channel, err := model.GetChannelByID(id)

	if err != nil || channel.Eid != config.GetEID(c) {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(nil))
		return
	}

	var req ChannelRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 对于自定义模型类型，同样需要验证CustomConfig
	// if req.Type == model.ChannelApiTypeCustomOpenAI {
	// 验证 CustomConfig 并提取必要信息
	// _, modelsList, err := validateAndExtractCustomModelConfig(c, &req)
	// if err != nil {
	// 错误响应已在 validateAndExtractCustomModelConfig 中发送
	// 	return
	// }

	// 使用从CustomConfig提取的模型列表
	// 	req.Models = strings.Join(modelsList, ",")
	// }

	channel.Models = model.ProcessModelNames(req.Models, channel.Type)

	if channel.Models == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(strings.NewReader("models is required")))
		return
	}

	channel.Type = req.Type
	channel.Key = req.Key
	channel.Name = req.Name

	channel.Config = req.Config
	channel.CustomConfig = req.CustomConfig
	channel.ModelMapping = req.ModelMapping
	channel.Weight = req.Weight
	channel.Priority = req.Priority
	channel.BaseURL = req.BaseURL
	channel.Other = req.Other

	// Update ProviderID if provided in request
	if req.ProviderID != nil {
		channel.ProviderID = *req.ProviderID
	}

	// Auto assign ProviderID for CozeStudio channels if needed
	if err := autoAssignCozeStudioProvider(channel); err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	if err := model.UpdateChannel(channel); err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(channel))
}

// @Summary Delete channel
// @Description Delete channel by ID
// @Tags Channel
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param channel_id path int true "Channel ID"
// @Success 200 {object} model.CommonResponse
// @Router /api/channels/{channel_id} [delete]
func DeleteChannel(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Param("channel_id"), 10, 64)
	channel, err := model.GetChannelByID(id)

	if err == nil && channel.Eid == config.GetEID(c) {
		err = model.DeleteChannelByID(id)
	}

	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}

// @Summary Get all channels
// @Description Get all channels for current enterprise
// @Tags Channel
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param provider_id query int false "Provider ID, 0 means platform-added keys, non-zero means get channels from other platforms" example:"0"
// @Param channel_types query string false "Channel type filters" example:"1,1001,1002"
// @Success 200 {object} model.CommonResponse
// @Router /api/channels [get]
func GetChannels(c *gin.Context) {
	providerId, _ := strconv.ParseInt(c.Query("provider_id"), 10, 64)
	channelTypesStr := c.Query("channel_types")
	var channelTypes []int
	if channelTypesStr != "" {
		for _, s := range strings.Split(channelTypesStr, ",") {
			if t, err := strconv.Atoi(strings.TrimSpace(s)); err == nil {
				channelTypes = append(channelTypes, t)
			}
		}
	}

	channels, err := model.GetChannelsByEidAndParams(config.GetEID(c), providerId, channelTypes)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(channels))
}

// @Summary Get all channels for public use
// @Description Get all channels for current enterprise without sensitive info (key, base_url)
// @Tags Channel
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param provider_id query int false "Provider ID, 0 means platform-added keys, non-zero means get channels from other platforms" example:"0"
// @Param channel_types query string false "Channel type filters" example:"1,1001,1002"
// @Success 200 {object} model.CommonResponse
// @Router /api/channels/public [get]
func GetChannelsForFrontend(c *gin.Context) {
	providerId, _ := strconv.ParseInt(c.Query("provider_id"), 10, 64)
	channelTypesStr := c.Query("channel_types")
	var channelTypes []int
	if channelTypesStr != "" {
		for _, s := range strings.Split(channelTypesStr, ",") {
			if t, err := strconv.Atoi(strings.TrimSpace(s)); err == nil {
				channelTypes = append(channelTypes, t)
			}
		}
	}

	channels, err := model.GetChannelsByEidAndParams(config.GetEID(c), providerId, channelTypes)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	// 将 []Channel 转换为 []*Channel
	channelPtrs := make([]*model.Channel, len(channels))
	for i := range channels {
		channelPtrs[i] = &channels[i]
	}

	// 转换为前端友好的结构，移除敏感字段
	frontChannels := convertToFrontChannels(channelPtrs)

	c.JSON(http.StatusOK, model.Success.ToResponse(frontChannels))
}

// validateAndExtractCustomModelConfig 验证CustomConfig并提取必要信息
func validateAndExtractCustomModelConfig(c *gin.Context, req *ChannelRequest) (map[string]interface{}, []string, error) {
	var customConfig map[string]interface{}
	if req.CustomConfig != "" {
		if err := json.Unmarshal([]byte(req.CustomConfig), &customConfig); err != nil {
			c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(fmt.Sprintf("CustomConfig 解析失败: %v", err)))
			return nil, nil, err
		}
	} else {
		err := fmt.Errorf("自定义模型必须提供 CustomConfig")
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err.Error()))
		return nil, nil, err
	}

	// 检查是否有新的 models 数组结构
	modelsInterface, hasModels := customConfig["models"]

	var modelsList []string

	if hasModels {
		// 使用新的 models 数组结构
		modelsArray, ok := modelsInterface.([]interface{})
		if !ok {
			// 尝试解析为字节数组后再解析为JSON，处理可能的类型转换问题
			modelsBytes, err := json.Marshal(modelsInterface)
			if err != nil {
				err := fmt.Errorf("CustomConfig 中的 models 必须是数组")
				c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err.Error()))
				return nil, nil, err
			}

			if err := json.Unmarshal(modelsBytes, &modelsArray); err != nil {
				err := fmt.Errorf("CustomConfig 中的 models 必须是数组")
				c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err.Error()))
				return nil, nil, err
			}
		}

		// 遍历 models 数组中的所有模型
		for _, modelInterface := range modelsArray {
			modelConfigMap, ok := modelInterface.(map[string]interface{})
			if !ok {
				err := fmt.Errorf("模型配置必须是对象")
				c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err.Error()))
				return nil, nil, err
			}

			// 获取模型ID
			modelIDInterface, exists := modelConfigMap["model_id"]
			if !exists {
				err := fmt.Errorf("每个模型配置必须包含 model_id")
				c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err.Error()))
				return nil, nil, err
			}

			modelID, ok := modelIDInterface.(string)
			if !ok {
				err := fmt.Errorf("model_id 必须是字符串")
				c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err.Error()))
				return nil, nil, err
			}

			// 检查该模型是否启用
			enabledInterface, exists := modelConfigMap["enabled"]
			enabled := true // 默认启用
			if exists {
				if enabledVal, ok := enabledInterface.(bool); ok {
					enabled = enabledVal
				}
			}

			if enabled {
				modelsList = append(modelsList, modelID)
			}
		}

	} else {
		// 保持旧的结构兼容性
		if _, ok := customConfig["model_id"]; !ok {
			err := fmt.Errorf("CustomConfig 必须包含 model_id")
			c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err.Error()))
			return nil, nil, err
		}
		if _, ok := customConfig["model_type"]; !ok {
			err := fmt.Errorf("CustomConfig 必须包含 model_type")
			c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err.Error()))
			return nil, nil, err
		}
		if _, ok := customConfig["completion_mode"]; !ok {
			err := fmt.Errorf("CustomConfig 必须包含 completion_mode")
			c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err.Error()))
			return nil, nil, err
		}
		if _, ok := customConfig["context_length"]; !ok {
			err := fmt.Errorf("CustomConfig 必须包含 context_length")
			c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err.Error()))
			return nil, nil, err
		}

		// 检查模型类型是否有效
		modelType, ok := customConfig["model_type"].(float64) // JSON numbers are parsed as float64
		if !ok {
			err := fmt.Errorf("model_type 必须是数字")
			c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err.Error()))
			return nil, nil, err
		}
		if int(modelType) != 1 && int(modelType) != 2 && int(modelType) != 3 {
			err := fmt.Errorf("模型类型必须是1(text)、2(embedding)或3(rerank)")
			c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err.Error()))
			return nil, nil, err
		}

		// 提取模型列表（如果存在 enabled_models 字段）
		if enabledModels, ok := customConfig["enabled_models"].(map[string]interface{}); ok {
			for modelKey := range enabledModels {
				modelsList = append(modelsList, modelKey)
			}
		} else {
			// 如果没有 enabled_models，使用 model_id 作为模型
			modelID := customConfig["model_id"].(string)
			modelsList = append(modelsList, modelID)
		}

	}

	return customConfig, modelsList, nil
}
