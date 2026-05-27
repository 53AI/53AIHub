package controller

import (
	"encoding/json"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/relay"
	"github.com/songquanpeng/one-api/relay/adaptor/openai"
	"github.com/songquanpeng/one-api/relay/apitype"
	"github.com/songquanpeng/one-api/relay/channeltype"
	"github.com/songquanpeng/one-api/relay/meta"
)

type OpenAIModelPermission struct {
	Id                 string  `json:"id"`
	Object             string  `json:"object"`
	Created            int     `json:"created"`
	AllowCreateEngine  bool    `json:"allow_create_engine"`
	AllowSampling      bool    `json:"allow_sampling"`
	AllowLogprobs      bool    `json:"allow_logprobs"`
	AllowSearchIndices bool    `json:"allow_search_indices"`
	AllowView          bool    `json:"allow_view"`
	AllowFineTuning    bool    `json:"allow_fine_tuning"`
	Organization       string  `json:"organization"`
	Group              *string `json:"group"`
	IsBlocking         bool    `json:"is_blocking"`
}

type OpenAIModels struct {
	Id         string                  `json:"id"`
	Object     string                  `json:"object"`
	Created    int                     `json:"created"`
	OwnedBy    string                  `json:"owned_by"`
	Permission []OpenAIModelPermission `json:"permission"`
	Root       string                  `json:"root"`
	Parent     *string                 `json:"parent"`
}

type OpenAIModelsResponse struct {
	Models []OpenAIModels `json:"models"`
}

var models []OpenAIModels
var modelsMap map[string]OpenAIModels
var channelId2Models map[int][]string

func init() {
	var permission []OpenAIModelPermission
	permission = append(permission, OpenAIModelPermission{
		Id:                 "modelperm-LwHkVFn8AcMItP432fKKDIKJ",
		Object:             "model_permission",
		Created:            1626777600,
		AllowCreateEngine:  true,
		AllowSampling:      true,
		AllowLogprobs:      true,
		AllowSearchIndices: false,
		AllowView:          true,
		AllowFineTuning:    false,
		Organization:       "*",
		Group:              nil,
		IsBlocking:         false,
	})
	// https://platform.openai.com/docs/models/model-endpoint-compatibility
	for i := 0; i < apitype.Dummy; i++ {
		if i == apitype.AIProxyLibrary {
			continue
		}
		adaptor := relay.GetAdaptor(i)
		channelName := adaptor.GetChannelName()
		modelNames := adaptor.GetModelList()
		for _, modelName := range modelNames {
			models = append(models, OpenAIModels{
				Id:         modelName,
				Object:     "model",
				Created:    1626777600,
				OwnedBy:    channelName,
				Permission: permission,
				Root:       modelName,
				Parent:     nil,
			})
		}
	}

	// 添加自定义适配器的模型
	customAdaptorTypes := []int{
		model.ChannelApiDify,
		model.ChannelApi53AI,
		model.ChannelApiBailian,
		model.ChannelApiVolcengine,
		model.ChannelApiAppBuilder,
		model.ChannelApiYuanqi,
		model.ChannelApiTypeFastGpt,
		model.ChannelApiTypeMaxKB,
		model.ChannelApiTypeN8n,
		model.ChannelApiTypeCozeStudio,
	}

	for _, apiType := range customAdaptorTypes {
		adaptor := service.GetAdaptor(apiType)
		if adaptor != nil {
			channelName := adaptor.GetChannelName()
			modelNames := adaptor.GetModelList()
			for _, modelName := range modelNames {
				models = append(models, OpenAIModels{
					Id:         modelName,
					Object:     "model",
					Created:    1626777600,
					OwnedBy:    channelName,
					Permission: permission,
					Root:       modelName,
					Parent:     nil,
				})
			}
		}
	}

	for _, channelType := range openai.CompatibleChannels {
		if channelType == channeltype.Azure {
			continue
		}
		channelName, channelModelList := openai.GetCompatibleChannelMeta(channelType)
		for _, modelName := range channelModelList {
			models = append(models, OpenAIModels{
				Id:         modelName,
				Object:     "model",
				Created:    1626777600,
				OwnedBy:    channelName,
				Permission: permission,
				Root:       modelName,
				Parent:     nil,
			})
		}
	}
	modelsMap = make(map[string]OpenAIModels)
	for _, model := range models {
		modelsMap[model.Id] = model
	}
	channelId2Models = make(map[int][]string)
	for i := 1; i < channeltype.Dummy; i++ {
		adaptor := relay.GetAdaptor(channeltype.ToAPIType(i))
		meta := &meta.Meta{
			ChannelType: i,
		}
		adaptor.Init(meta)
		channelId2Models[i] = adaptor.GetModelList()
	}
}

// ListAllModels List all models
// @Summary List all available models
// @Description Get a list of all available models in the system
// @Tags Channel
// @Accept json
// @Produce json
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse{data=OpenAIModelsResponse}
// @Router /api/channels/models [get]
func ListAllModels(c *gin.Context) {
	c.JSON(200, model.Success.ToResponse(OpenAIModelsResponse{
		Models: models,
	}))
}

// GetModelCatalog Get model catalog
// @Summary Get model catalog by platform and category
// @Description Get a categorized list of models organized by platform and model type
// @Tags Channel
// @Accept json
// @Produce json
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse
// @Router /api/channels/km/models [get]
func GetKmModels(c *gin.Context) {
	// 解析JSON常量
	var catalogData map[string]interface{}
	if err := json.Unmarshal([]byte(common.KmModelsJSON), &catalogData); err != nil {
		c.JSON(500, model.SystemError.ToResponse(err))
		return
	}

	// 自动计算每个分类的model_count
	if platforms, ok := catalogData["platforms"].([]interface{}); ok {
		for _, platform := range platforms {
			if platformMap, ok := platform.(map[string]interface{}); ok {
				if categories, ok := platformMap["categories"].([]interface{}); ok {
					for _, category := range categories {
						if categoryMap, ok := category.(map[string]interface{}); ok {
							if models, ok := categoryMap["models"].([]interface{}); ok {
								categoryMap["model_count"] = len(models)
							}
						}
					}
				}
			}
		}
	}

	c.JSON(200, model.Success.ToResponse(catalogData))
}
