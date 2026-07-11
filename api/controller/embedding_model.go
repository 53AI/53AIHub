package controller

import (
	"net/http"
	"strconv"

	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/embedding"
	"github.com/gin-gonic/gin"
)

// GetAvailableEmbeddingModelsResponse 获取可用embedding模型响应
type GetAvailableEmbeddingModelsResponse struct {
	Models []embedding.EmbeddingModelInfo `json:"models"` // 模型列表
	Total  int                            `json:"total"`  // 总数量
}

// GetAvailableEmbeddingModels godoc
// @Summary 获取可用的embedding模型列表
// @Description 获取当前企业可用的所有embedding模型
// @Tags Embedding模型管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param keyword query string false "搜索关键词"
// @Success 200 {object} model.CommonResponse{data=GetAvailableEmbeddingModelsResponse} "成功获取模型列表"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/embedding/models [get]
func GetAvailableEmbeddingModels(c *gin.Context) {
	eid := config.GetEID(c)
	keyword := c.Query("keyword")

	// 创建embedding模型服务
	modelService := embedding.NewEmbeddingModelService(model.DB)

	var models []embedding.EmbeddingModelInfo
	var err error

	if keyword != "" {
		models, err = modelService.SearchEmbeddingModels(eid, keyword)
	} else {
		models, err = modelService.GetAvailableEmbeddingModels(eid)
	}

	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	response := GetAvailableEmbeddingModelsResponse{
		Models: models,
		Total:  len(models),
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(response))
}

// GetEmbeddingModelGroupsResponse 获取分组embedding模型响应
type GetEmbeddingModelGroupsResponse struct {
	Groups map[string][]embedding.EmbeddingModelInfo `json:"groups"` // 按提供商分组的模型
	Total  int                                       `json:"total"`  // 总数量
}

// GetEmbeddingModelGroups godoc
// @Summary 获取按提供商分组的embedding模型
// @Description 获取按提供商分组的embedding模型列表
// @Tags Embedding模型管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse{data=GetEmbeddingModelGroupsResponse} "成功获取分组模型"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/embedding/models/groups [get]
func GetEmbeddingModelGroups(c *gin.Context) {
	eid := config.GetEID(c)

	// 创建embedding模型服务
	modelService := embedding.NewEmbeddingModelService(model.DB)

	groups, err := modelService.GetEmbeddingModelGroups(eid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	// 计算总数量
	total := 0
	for _, models := range groups {
		total += len(models)
	}

	response := GetEmbeddingModelGroupsResponse{
		Groups: groups,
		Total:  total,
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(response))
}

// GetChannelEmbeddingModelsRequest 获取渠道embedding模型请求
type GetChannelEmbeddingModelsRequest struct {
	ChannelID int64 `uri:"channel_id" binding:"required" example:"1"` // 渠道ID
}

// GetChannelEmbeddingModelsResponse 获取渠道embedding模型响应
type GetChannelEmbeddingModelsResponse struct {
	ChannelID   int64    `json:"channel_id"`   // 渠道ID
	ChannelName string   `json:"channel_name"` // 渠道名称
	Models      []string `json:"models"`       // 模型列表
	Total       int      `json:"total"`        // 总数量
}

// GetChannelEmbeddingModels godoc
// @Summary 获取指定渠道的embedding模型
// @Description 获取指定渠道支持的embedding模型列表
// @Tags Embedding模型管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param channel_id path int true "渠道ID"
// @Success 200 {object} model.CommonResponse{data=GetChannelEmbeddingModelsResponse} "成功获取渠道模型"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 404 {object} model.CommonResponse "渠道不存在"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/embedding/channels/{channel_id}/models [get]
func GetChannelEmbeddingModels(c *gin.Context) {
	eid := config.GetEID(c)

	// 解析路径参数
	channelIDStr := c.Param("channel_id")
	channelID, err := strconv.ParseInt(channelIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("无效的渠道ID"))
		return
	}

	// 获取渠道信息
	var channel model.Channel
	err = model.DB.Where("eid = ? AND channel_id = ?", eid, channelID).First(&channel).Error
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse("渠道不存在"))
		return
	}

	// 创建embedding模型服务
	modelService := embedding.NewEmbeddingModelService(model.DB)

	models, err := modelService.GetEmbeddingModelsByChannelID(eid, channelID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	response := GetChannelEmbeddingModelsResponse{
		ChannelID:   channelID,
		ChannelName: channel.Name,
		Models:      models,
		Total:       len(models),
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(response))
}

// ValidateEmbeddingModelRequest 验证embedding模型请求
type ValidateEmbeddingModelRequest struct {
	ChannelID int64  `json:"channel_id" binding:"required" example:"1"`                    // 渠道ID
	ModelName string `json:"model_name" binding:"required" example:"text-embedding-ada-002"` // 模型名称
}

// ValidateEmbeddingModel godoc
// @Summary 验证embedding模型是否可用
// @Description 验证指定渠道的embedding模型是否可用
// @Tags Embedding模型管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body ValidateEmbeddingModelRequest true "验证请求"
// @Success 200 {object} model.CommonResponse "模型验证成功"
// @Failure 400 {object} model.CommonResponse "参数错误或模型不可用"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/embedding/models/validate [post]
func ValidateEmbeddingModel(c *gin.Context) {
	eid := config.GetEID(c)

	// 解析请求体
	var req ValidateEmbeddingModelRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 创建embedding模型服务
	modelService := embedding.NewEmbeddingModelService(model.DB)

	err := modelService.ValidateEmbeddingModel(eid, req.ChannelID, req.ModelName)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse("模型验证成功"))
}

// GetDefaultRerankModelResponse 获取默认rerank模型响应
type GetDefaultRerankModelResponse struct {
	Model *embedding.RerankModelInfo `json:"model"` // 默认模型
}

// GetDefaultRerankModel godoc
// @Summary 获取默认的rerank模型
// @Description 获取系统推荐的默认rerank模型
// @Tags Embedding模型管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse{data=GetDefaultRerankModelResponse} "成功获取默认模型"
// @Failure 404 {object} model.CommonResponse "没有可用的模型"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/embedding/models/rerank [get]
func GetDefaultRerankModel(c *gin.Context) {
	eid := config.GetEID(c)

	// 创建embedding模型服务
	modelService := embedding.NewEmbeddingModelService(model.DB)

	defaultModel, err := modelService.GetDefaultRerankModel(eid)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
		return
	}

	response := GetDefaultRerankModelResponse{
		Model: defaultModel,
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(response))
}

// GetDefaultEmbeddingModelResponse 获取默认embedding模型响应
type GetDefaultEmbeddingModelResponse struct {
	Model *embedding.EmbeddingModelInfo `json:"model"` // 默认模型
}

// GetDefaultEmbeddingModel godoc
// @Summary 获取默认的embedding模型
// @Description 获取系统推荐的默认embedding模型
// @Tags Embedding模型管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse{data=GetDefaultEmbeddingModelResponse} "成功获取默认模型"
// @Failure 404 {object} model.CommonResponse "没有可用的模型"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/embedding/models/default [get]
func GetDefaultEmbeddingModel(c *gin.Context) {
	eid := config.GetEID(c)

	// 创建embedding模型服务
	modelService := embedding.NewEmbeddingModelService(model.DB)

	defaultModel, err := modelService.GetDefaultEmbeddingModel(eid)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
		return
	}

	response := GetDefaultEmbeddingModelResponse{
		Model: defaultModel,
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(response))
}

// GetEmbeddingModelInfoRequest 获取embedding模型详情请求
type GetEmbeddingModelInfoRequest struct {
	ModelName string `uri:"model_name" binding:"required" example:"text-embedding-ada-002"` // 模型名称
}

// GetEmbeddingModelInfo godoc
// @Summary 获取embedding模型详细信息
// @Description 获取指定embedding模型的详细信息
// @Tags Embedding模型管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param model_name path string true "模型名称"
// @Success 200 {object} model.CommonResponse{data=embedding.EmbeddingModelInfo} "成功获取模型信息"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 404 {object} model.CommonResponse "模型不存在"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/embedding/models/{model_name} [get]
func GetEmbeddingModelInfo(c *gin.Context) {
	eid := config.GetEID(c)
	modelName := c.Param("model_name")

	if modelName == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("模型名称不能为空"))
		return
	}

	// 创建embedding模型服务
	modelService := embedding.NewEmbeddingModelService(model.DB)

	models, err := modelService.GetAvailableEmbeddingModels(eid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	// 查找指定模型
	for _, embeddingModel := range models {
		if embeddingModel.ModelName == modelName {
			c.JSON(http.StatusOK, model.Success.ToResponse(embeddingModel))
			return
		}
	}

	c.JSON(http.StatusNotFound, model.NotFound.ToResponse("模型不存在"))
}
