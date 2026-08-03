package controller

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/ai53"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/gin-gonic/gin"
)

// Get53AIAllBots Get all 53AI bots
// @Summary Get all 53AI bots list
// @Description Get all bots list from 53AI platform
// @Tags 53AI
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param provider_id query int false "Provider ID (optional, for backward compatibility)"
// @Success 200 {object} model.CommonResponse{data=[]ai53.AppResponse}
// @Router /api/53ai/bots [get]
func Get53AIAllBots(c *gin.Context) {
	eid := config.GetEID(c)
	providerID, _ := strconv.ParseInt(c.DefaultQuery("provider_id", "0"), 10, 64)
	provider, err := model.GetProviderByEidAndProviderTypeWithOptionalID(eid, int64(model.ProviderType53AI), providerID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ProviderNoFoundError.ToResponse(err))
		return
	}

	ser := service.AI53Service{
		Provider: &provider,
	}

	bots, err := ser.GetAllBots()
	if err != nil {
		logger.SysLogf("Get53AIAllBots: %s", err.Error())
		c.JSON(http.StatusInternalServerError, model.ProviderNoFoundError.ToResponse(err))
		return
	}

	Update53AIChannel(provider, bots)
	c.JSON(http.StatusOK, model.Success.ToResponse(bots))
}

// Get53AIAllWorkflows Get all 53AI workflows
// @Summary Get all 53AI workflows list
// @Description Get all workflows list from 53AI platform
// @Tags 53AI
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param provider_id query int false "Provider ID (optional, for backward compatibility)"
// @Success 200 {object} model.CommonResponse{data=[]ai53.AppResponse}
// @Router /api/53ai/workflows [get]
func Get53AIAllWorkflows(c *gin.Context) {
	eid := config.GetEID(c)
	providerID, _ := strconv.ParseInt(c.DefaultQuery("provider_id", "0"), 10, 64)
	provider, err := model.GetProviderByEidAndProviderTypeWithOptionalID(eid, int64(model.ProviderType53AI), providerID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ProviderNoFoundError.ToResponse(err))
		return
	}

	ser := service.AI53Service{
		Provider: &provider,
	}

	workflows, err := ser.GetAllWorkflows()
	if err != nil {
		logger.SysLogf("Get53AIAllWorkflows: %s", err.Error())
		c.JSON(http.StatusInternalServerError, model.ProviderNoFoundError.ToResponse(err))
		return
	}

	Update53AIWorkflowChannel(provider, workflows)
	c.JSON(http.StatusOK, model.Success.ToResponse(workflows))
}

func Update53AIChannel(provider model.Provider, apps []ai53.AppResponse) error {
	var botIds []string
	for _, bot := range apps {
		botIds = append(botIds, "bot-"+bot.BotID)
	}
	// todo Call interface user ID all use the same
	configStr := `{"region":"","sk":"","ak":"","user_id":"53AIHub","vertex_ai_project_id":"","vertex_ai_adc":""}`
	// Create or update channel record
	baseURL := provider.GetBaseURLByProviderType()
	channel := &model.Channel{
		Eid:        provider.Eid,
		Name:       provider.Name,
		Key:        provider.AccessToken,
		Type:       model.ChannelApi53AI,
		ProviderID: provider.ProviderID,
		BaseURL:    &baseURL,
		Status:     model.ChannelStatusEnabled,
		Config:     configStr,
	}

	existingChannel, err := model.GetFirstChannelByEidAndProviderId(channel.Eid, channel.ProviderID)
	if err != nil {
		// Create new record with initial botIds
		channel.Models = strings.Join(botIds, ",")
		return model.CreateChannel(channel)
	} else {
		// Update existing record with incremental botIds
		channel.ChannelID = existingChannel.ChannelID
		channel.CreatedTime = existingChannel.CreatedTime

		// Get existing botIds
		existingBotIds := strings.Split(existingChannel.Models, ",")
		botIdMap := make(map[string]bool)
		for _, id := range existingBotIds {
			if id != "" {
				botIdMap[id] = true
			}
		}

		// Add new botIds
		for _, id := range botIds {
			botIdMap[id] = true
		}

		// Convert map back to slice
		var updatedBotIds []string
		for id := range botIdMap {
			updatedBotIds = append(updatedBotIds, id)
		}

		channel.Models = strings.Join(updatedBotIds, ",")
		return model.UpdateChannel(channel)
	}
}

func Update53AIWorkflowChannel(provider model.Provider, apps []ai53.AppResponse) error {
	var workflowIds []string
	for _, workflow := range apps {
		workflowIds = append(workflowIds, "workflow-"+workflow.BotID)
	}
	// todo Call interface user ID all use the same
	configStr := `{"region":"","sk":"","ak":"","user_id":"53AIHub","vertex_ai_project_id":"","vertex_ai_adc":""}`
	// Create or update channel record
	baseURL := provider.GetBaseURLByProviderType()
	channel := &model.Channel{
		Eid:        provider.Eid,
		Name:       provider.Name,
		Key:        provider.AccessToken,
		Type:       model.ChannelApi53AI,
		ProviderID: provider.ProviderID,
		BaseURL:    &baseURL,
		Status:     model.ChannelStatusEnabled,
		Config:     configStr,
	}

	existingChannel, err := model.GetFirstChannelByEidAndProviderId(channel.Eid, channel.ProviderID)
	if err != nil {
		// Create new record with initial workflowIds
		channel.Models = strings.Join(workflowIds, ",")
		return model.CreateChannel(channel)
	} else {
		// Update existing record with incremental workflowIds
		channel.ChannelID = existingChannel.ChannelID
		channel.CreatedTime = existingChannel.CreatedTime

		// Get existing workflowIds
		existingWorkflowIds := strings.Split(existingChannel.Models, ",")
		workflowIdMap := make(map[string]bool)
		for _, id := range existingWorkflowIds {
			if id != "" {
				workflowIdMap[id] = true
			}
		}

		// Add new workflowIds
		for _, id := range workflowIds {
			workflowIdMap[id] = true
		}

		// Convert map back to slice
		var updatedWorkflowIds []string
		for id := range workflowIdMap {
			updatedWorkflowIds = append(updatedWorkflowIds, id)
		}

		channel.Models = strings.Join(updatedWorkflowIds, ",")
		return model.UpdateChannel(channel)
	}
}

// Get53AIAppParameters 获取 53AI 应用参数配置
// @Summary 获取 53AI 应用参数配置
// @Description 根据 botId 获取 53AI 应用的参数配置信息，支持带前缀或不带前缀的 botId
// @Tags 53AI
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param botId path string true "机器人ID (支持 bot-xxx, workflow-xxx 或直接 xxx 格式)"
// @Param provider_id query int false "Provider ID (optional, for backward compatibility)"
// @Success 200 {object} model.CommonResponse{data=interface{}}
// @Router /api/53ai/parameters/{botId} [get]
func Get53AIAppParameters(c *gin.Context) {
	// 1. 获取并处理 botId 参数
	botId := c.Param("botId")
	if botId == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("botId 不能为空"))
		return
	}

	logger.SysLogf("🔍 获取53AI应用参数 - Bot ID: %s", botId)

	// 2. 获取 EID (遵循 53AI 渠道模式)
	eid := config.GetEID(c)

	// 3. 获取 53AI Provider (遵循 53AI 渠道模式)
	providerID, _ := strconv.ParseInt(c.DefaultQuery("provider_id", "0"), 10, 64)
	provider, err := model.GetProviderByEidAndProviderTypeWithOptionalID(eid, int64(model.ProviderType53AI), providerID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ProviderNoFoundError.ToResponse(err))
		return
	}

	// 4. 创建 AI53Service 实例 (遵循 53AI 渠道模式)
	ser := service.AI53Service{
		Provider: &provider,
	}

	// 5. 调用服务方法获取应用参数
	appParams, err := ser.GetAppParameters(botId)
	if err != nil {
		logger.SysLogf("Get53AIAppParameters: %s", err.Error())
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	logger.SysLogf("✅ 53AI应用参数获取成功 - Bot ID: %s", botId)
	// 6. 返回结果
	c.JSON(http.StatusOK, model.Success.ToResponse(appParams))
}
