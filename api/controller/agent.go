package controller

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/utils"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/gin-gonic/gin"
)

type AgentListRequest struct {
	Keyword      string `json:"keyword" form:"keyword" example:"Json"`
	GroupId      int64  `json:"group_id" form:"group_id" example:"0"`
	Offset       int    `json:"offset" form:"offset" example:"0"`
	Limit        int    `json:"limit" form:"limit" example:"10"`
	ChannelTypes string `json:"channel_types" form:"channel_types" example:"0,1,2"`
	AgentTypes   string `json:"agent_types" form:"agent_types" example:"0,1,2"`
	AgentUsages  string `json:"agent_usages" form:"agent_usages" example:"0,1,2"`
}

type AgentsResponse struct {
	Count  int64          `json:"count"`
	Agents []*model.Agent `json:"agents"`
}

type AgentRequest struct {
	Name                 string  `json:"name" example:"OpenAI-ChatGPT"`
	Logo                 string  `json:"logo" example:"http://URL_ADDRESS.com/logo.png"`
	Sort                 int     `json:"sort" example:"0"`
	Description          string  `json:"description" example:"A ChatGPT based agent for general conversation"`
	Configs              string  `json:"configs" example:"{\"model\":\"gpt-3.5-turbo\",\"temperature\":0.7}"`
	Prompt               string  `json:"prompt" example:"You are a helpful AI assistant"`
	ChannelType          int     `json:"channel_type"`
	Model                string  `json:"model" example:"gpt-3.5-turbo"`
	GroupId              int64   `json:"group_id" example:"0"`
	UseCases             string  `json:"use_cases" example:"[]"`
	Tools                string  `json:"tools"  example:"[]"`
	CustomConfig         string  `json:"custom_config" example:"{}"`
	UserGroupIds         []int64 `json:"user_group_ids"`
	Enable               bool    `json:"enable" example:"true"`
	SubscriptionGroupIds []int64 `json:"subscription_group_ids"` // 订阅分组IDs
	Settings             string  `json:"settings" example:"{}"`
	AgentType            int     `json:"agent_type" example:"0"`  // Agent type (0=App, 1=Workflow), default is 0
	AgentUsage           int     `json:"agent_usage" example:"0"` // Agent usage (0=hub, 1=KM_AI_search, 2=KM_file_chat), default is 0
}

type UpdateAgentEnableRequest struct {
	Enable *bool `json:"enable" example:"true" binding:"required"` // Enable status (true=enabled, false=disabled)
}

type PersonalAgentUpdateRequest struct {
	Name         string `json:"name" binding:"required" example:"我的智能体"`
	Description  string `json:"description" example:"智能体描述"`
	Logo         string `json:"logo" example:"https://example.com/logo.png"`
	Prompt       string `json:"prompt" example:"You are a helpful AI assistant"`
	Configs      string `json:"configs" example:"{\"temperature\":0.7}"`
	Tools        string `json:"tools" example:"[]"`
	UseCases     string `json:"use_cases" example:"[]"`
	Settings     string `json:"settings" example:"{}"`
	CustomConfig string `json:"custom_config" example:"{}"`
	Model        string `json:"model" example:"openclaw-ws"`
	Enable       *bool  `json:"enable" example:"true"`
}

type PersonalAgentsResponse struct {
	Count  int64          `json:"count" example:"10"`
	Agents []*model.Agent `json:"agents"`
}

// @Summary Create a new agent
// @Description Create agent with configurable parameters. agent_type: 0=App (default), 1=Workflow. channel_type: 1014=OpenClawWS (WebSocket长连接，自动生成openclaw_app_secret存入custom_config)
// @Tags Agent
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param Agent body AgentRequest true "Agent Data"
// @Success 200 {object} model.CommonResponse{data=model.Agent} "Success"
// @Router /api/agents [post]
func CreateAgent(c *gin.Context) {
	var agentReq AgentRequest
	if err := c.ShouldBindJSON(&agentReq); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}
	// Check if user is admin
	if !common.IsAdmin(c) {
		c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(nil))
		return
	}

	agentReq.Model = model.ProcessModelNames(agentReq.Model, agentReq.ChannelType)
	if agentReq.Model == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("model is required")))
		return
	}

	if agentReq.ChannelType == model.ChannelApiTypeOpenClawWS {
		var customCfg map[string]interface{}
		if agentReq.CustomConfig != "" {
			_ = json.Unmarshal([]byte(agentReq.CustomConfig), &customCfg)
		}
		if customCfg == nil {
			customCfg = make(map[string]interface{})
		}
		if _, ok := customCfg["openclaw_app_secret"]; !ok {
			customCfg["openclaw_app_secret"] = model.GenerateOpenClawAppSecret()
		}
		bytes, _ := json.Marshal(customCfg)
		agentReq.CustomConfig = string(bytes)
	}

	params := map[string]interface{}{
		"from": "agent",
	}
	_, err := service.IsFeatureAvailable(c, "agent", params)
	if err != nil {
		c.JSON(http.StatusForbidden, model.FeatureNotAvailableError.ToResponse(err))
		return
	}

	// Start transaction
	tx := model.DB.Begin()
	if tx.Error != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
		return
	}

	agent := model.Agent{
		Eid:          config.GetEID(c),
		Name:         agentReq.Name,
		Logo:         agentReq.Logo,
		ChannelType:  agentReq.ChannelType,
		Sort:         agentReq.Sort,
		Description:  agentReq.Description,
		Model:        agentReq.Model,
		Prompt:       agentReq.Prompt,
		Configs:      agentReq.Configs,
		Tools:        agentReq.Tools,
		CustomConfig: agentReq.CustomConfig,
		GroupID:      agentReq.GroupId,
		UseCases:     agentReq.UseCases,
		CreatedBy:    config.GetUserId(c),
		Enable:       agentReq.Enable,
		Settings:     agentReq.Settings,
		AgentType:    agentReq.AgentType,  // 添加 AgentType 字段，默认为 0
		AgentUsage:   agentReq.AgentUsage, // 添加 AgentUsage 字段，默认为 0
	}

	if err := tx.Create(&agent).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
		return
	}

	allGroupIds := make([]int64, 0)

	if len(agentReq.SubscriptionGroupIds) > 0 {
		allGroupIds = append(allGroupIds, agentReq.SubscriptionGroupIds...)
	}

	if len(agentReq.UserGroupIds) > 0 {
		allGroupIds = append(allGroupIds, agentReq.UserGroupIds...)
	}

	// Add permissions for user groups
	if len(allGroupIds) > 0 {
		for _, groupID := range allGroupIds {
			permission := model.ResourcePermission{
				GroupID:      groupID,
				ResourceID:   agent.AgentID,
				ResourceType: model.ResourceTypeAgent,
				Permission:   model.PermissionRead,
			}
			if err := tx.Create(&permission).Error; err != nil {
				tx.Rollback()
				c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
				return
			}
		}
	}

	// Commit transaction
	if err := tx.Commit().Error; err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
		return
	}

	// Parse CustomConfig to get agent_type
	var customConfig map[string]interface{}
	if err := json.Unmarshal([]byte(agentReq.CustomConfig), &customConfig); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToErrorResponse(err))
		return
	}

	agentType, ok := customConfig["agent_type"].(string)
	if !ok {
		agentType = "unknown"
	}

	log := model.SystemLog{
		Eid:      agent.Eid,
		UserID:   agent.CreatedBy,
		Nickname: config.GetUserNickname(c),
		Module:   model.SystemLogModuleAgent,
		Action:   model.SystemLogActionCreate,
		Content:  fmt.Sprintf("新建智能体【】名称：【%s】；类型：%s", agent.Name, model.GetChannelDescription(agentType)),
		IP:       utils.GetClientIP(c),
	}
	model.CreateSystemLog(&log)

	agent.FillBotID()
	c.JSON(http.StatusOK, model.Success.ToResponse(agent))
}

// @Summary Get agent details
// @Description Get agent by AgentID
// @Tags Agent
// @Produce json
// @Security BearerAuth
// @Param agent_id path int true "Agent ID"
// @Success 200 {object} model.CommonResponse{data=model.Agent} "Success"
// @Router /api/agents/{agent_id} [get]
// @Router /api/my/agents/{agent_id} [get]
func GetAgent(c *gin.Context) {
	agent_id, err := strconv.ParseInt(c.Param("agent_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	// 统一查询，不过滤 owner_id
	agent, err := model.GetAgentByID(eid, agent_id)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(nil))
		return
	}

	// 根据 owner_id 判断权限
	if agent.OwnerID == 0 {
		// 企业智能体：admin 或 permission
		if !common.IsAdmin(c) {
			hasPermission, err := model.CheckPermission(config.GetUserGroupID(c), agent_id, model.ResourceTypeAgent, model.PermissionRead)
			if err != nil || !hasPermission {
				c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(nil))
				return
			}
		}
		if err := agent.LoadUserGroupIds(); err != nil {
			c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
			return
		}
	} else {
		// 个人智能体：仅 owner 可访问
		if agent.OwnerID != userID {
			c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(nil))
			return
		}
	}

	agent.FillBotID()
	c.JSON(http.StatusOK, model.Success.ToResponse(agent))
}

// @Summary Update agent
// @Description Update existing agent details. agent_type: 0=App (default), 1=Workflow. channel_type: 1014=OpenClawWS (WebSocket长连接，自动生成openclaw_app_secret存入custom_config)
// @Tags Agent
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param agent_id path int true "Agent ID"
// @Param agent body AgentRequest true "Agent data" example:{"name":"OpenAI-ChatGPT","description":"ChatGPT","configs":"{\"model\":\"gpt-3.5-turbo\",\"temperature\":0.7}","prompt":"你好","model":"gpt-3.5-turbo","group_id":0,"use_cases":"[]","tools":"[]","user_group_ids":[1,2,3],"agent_type":0}
// @Success 200 {object} model.CommonResponse{data=model.Agent} "Success"
// @Router /api/agents/{agent_id} [put]
// @Router /api/my/agents/{agent_id} [put]
func UpdateAgent(c *gin.Context) {
	agent_id, err := strconv.ParseInt(c.Param("agent_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	agent, err := model.GetAgentByID(eid, agent_id)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(nil))
		return
	}

	isEnterpriseAgent := agent.OwnerID == 0

	if isEnterpriseAgent {
		if !common.IsAdmin(c) {
			c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(nil))
			return
		}
	} else {
		if agent.OwnerID != userID {
			c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(nil))
			return
		}
	}

	if isEnterpriseAgent {
		var agentReq AgentRequest
		if err := c.ShouldBindJSON(&agentReq); err != nil {
			c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
			return
		}

		agentReq.Model = model.ProcessModelNames(agentReq.Model, agentReq.ChannelType)
		if agentReq.Model == "" {
			c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("model is required")))
			return
		}

		if agentReq.ChannelType == model.ChannelApiTypeOpenClawWS {
			var customCfg map[string]interface{}
			if agentReq.CustomConfig != "" {
				_ = json.Unmarshal([]byte(agentReq.CustomConfig), &customCfg)
			}
			if customCfg == nil {
				customCfg = make(map[string]interface{})
			}
			if _, ok := customCfg["openclaw_app_secret"]; !ok {
				customCfg["openclaw_app_secret"] = model.GenerateOpenClawAppSecret()
			}
			bytes, _ := json.Marshal(customCfg)
			agentReq.CustomConfig = string(bytes)
		}

		tx := model.DB.Begin()
		if tx.Error != nil {
			c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
			return
		}

		oldAgent := *agent

		agent.Name = agentReq.Name
		agent.Description = agentReq.Description
		agent.Model = agentReq.Model
		agent.Prompt = agentReq.Prompt
		agent.Configs = agentReq.Configs
		agent.Tools = agentReq.Tools
		agent.GroupID = agentReq.GroupId
		agent.UseCases = agentReq.UseCases
		agent.ChannelType = agentReq.ChannelType
		agent.Sort = agentReq.Sort
		agent.Logo = agentReq.Logo
		agent.CustomConfig = agentReq.CustomConfig
		agent.Enable = agentReq.Enable
		agent.Settings = agentReq.Settings
		agent.AgentType = agentReq.AgentType   // 添加 AgentType 字段更新
		agent.AgentUsage = agentReq.AgentUsage // 添加 AgentUsage 字段更新

		if err := tx.Save(agent).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
			return
		}

		enterprise, err := model.GetEnterpriseByID(eid)
		if err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
			return
		}

		if err := service.UpdateAgentResourcePermissions(c, tx, agent.AgentID, agentReq.SubscriptionGroupIds, agentReq.UserGroupIds, enterprise); err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
			return
		}

		if err := tx.Commit().Error; err != nil {
			c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
			return
		}

		fieldMap := map[string]string{
			"Name":        "名称",
			"Description": "描述",
		}
		model.LogEntityChange(
			fmt.Sprintf("智能体【%s】", oldAgent.Name),
			model.SystemLogActionUpdate,
			eid,
			userID,
			config.GetUserNickname(c),
			model.SystemLogModuleAgent,
			oldAgent,
			agent,
			utils.GetClientIP(c),
			fieldMap,
		)

		if err := agent.LoadUserGroupIds(); err != nil {
			c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
			return
		}
	} else {
		var req PersonalAgentUpdateRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
			return
		}

		agent.Name = req.Name
		agent.Description = req.Description
		agent.Logo = req.Logo
		agent.Prompt = req.Prompt
		agent.Configs = req.Configs
		agent.Tools = req.Tools
		agent.UseCases = req.UseCases
		agent.Settings = req.Settings
		if req.Enable != nil {
			agent.Enable = *req.Enable
		}
		if req.Model != "" {
			agent.Model = req.Model
		}
		if req.CustomConfig != "" {
			if agent.ChannelType == model.ChannelApiTypeOpenClawWS {
				var existingConfig map[string]interface{}
				if agent.CustomConfig != "" {
					json.Unmarshal([]byte(agent.CustomConfig), &existingConfig)
				} else {
					existingConfig = make(map[string]interface{})
				}
				var newConfig map[string]interface{}
				json.Unmarshal([]byte(req.CustomConfig), &newConfig)
				if secret, ok := existingConfig["openclaw_app_secret"]; ok {
					if _, hasNew := newConfig["openclaw_app_secret"]; !hasNew {
						newConfig["openclaw_app_secret"] = secret
					}
				}
				newConfigBytes, _ := json.Marshal(newConfig)
				agent.CustomConfig = string(newConfigBytes)
			} else {
				agent.CustomConfig = req.CustomConfig
			}
		}

		if err := agent.Update(); err != nil {
			c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
			return
		}
	}

	agent.FillBotID()
	c.JSON(http.StatusOK, model.Success.ToResponse(agent))
}

// @Summary Delete agent
// @Description Delete agent by ID
// @Tags Agent
// @Produce json
// @Security BearerAuth
// @Param agent_id path int true "Agent ID"
// @Success 200 {object} model.CommonResponse "Success"
// @Router /api/agents/{agent_id} [delete]
// @Router /api/my/agents/{agent_id} [delete]
func DeleteAgent(c *gin.Context) {
	agent_id, err := strconv.ParseInt(c.Param("agent_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	agent, err := model.GetAgentByID(eid, agent_id)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(nil))
		return
	}

	// 根据 owner_id 判断权限
	isEnterpriseAgent := agent.OwnerID == 0
	if isEnterpriseAgent {
		// 企业智能体：仅 admin 可删除
		if !common.IsAdmin(c) {
			c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(nil))
			return
		}
	} else {
		// 个人智能体：仅 owner 可删除
		if agent.OwnerID != userID {
			c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(nil))
			return
		}
	}

	// Start transaction
	tx := model.DB.Begin()
	if tx.Error != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
		return
	}

	// Delete agent
	if err := tx.Delete(agent).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
		return
	}

	// Delete associated permissions (only for enterprise agents)
	if isEnterpriseAgent {
		if err := tx.Where("resource_id = ? AND resource_type = ?", agent_id, model.ResourceTypeAgent).Delete(&model.ResourcePermission{}).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
			return
		}
	}

	// Commit transaction
	if err := tx.Commit().Error; err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
		return
	}

	// System log only for enterprise agents
	if isEnterpriseAgent {
		log := model.SystemLog{
			Eid:      agent.Eid,
			UserID:   agent.CreatedBy,
			Nickname: config.GetUserNickname(c),
			Module:   model.SystemLogModuleAgent,
			Action:   model.SystemLogActionDelete,
			Content:  fmt.Sprintf("删除智能体【%s】", agent.Name),
			IP:       utils.GetClientIP(c),
		}
		model.CreateSystemLog(&log)
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}

// @Summary Get agents list
// @Description Retrieve paginated list of agents with filtering options
// @Tags Agent
// @Produce json
// @Security BearerAuth
// @Param keyword query string false "Search keyword for agent name or description"
// @Param group_id query int false "Group ID to filter agents by group"
// @Param offset query int false "Pagination offset" default(0)
// @Param limit query int false "Pagination limit" default(10)
// @Param channel_types query string false "Channel types (0=OpenAI,1=Azure,2=claude), split by comma" example:"0,1,2"
// @Param agent_types query string false "Agent types (0=App,1=Workflow), split by comma" example:"0,1,2"
// @Param agent_usages query string false "Agent usages (0=hub,1=KM_AI_search,2=KM_file_chat), split by comma" example:"0,1,2" default:"0"
// @Success 200 {object} model.CommonResponse{data=AgentsResponse} "Success"
// @Router /api/agents [get]
// @Router /api/my/agents [get]
func GetAgents(c *gin.Context) {
	var agentListRequest AgentListRequest
	if err := c.ShouldBindQuery(&agentListRequest); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	if agentListRequest.Limit == 0 {
		agentListRequest.Limit = 10
	}

	eid := config.GetEID(c)

	// 个人智能体列表（通过 /api/my/agents 路由访问）
	if strings.HasPrefix(c.FullPath(), "/api/my/agents") {
		userID := config.GetUserId(c)
		total, agents, err := model.GetPersonalAgentsByUserID(eid, userID, agentListRequest.Offset, agentListRequest.Limit)
		if err != nil {
			c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
			return
		}
		for _, agent := range agents {
			agent.FillBotID()
		}
		c.JSON(http.StatusOK, model.Success.ToResponse(PersonalAgentsResponse{
			Count:  total,
			Agents: agents,
		}))
		return
	}

	// 企业智能体列表（通过 /api/agents 路由访问）
	var total int64
	var agents []*model.Agent
	var err error
	channelTypes := splitChannelTypesString(agentListRequest.ChannelTypes)
	agentTypes := splitAgentTypesString(agentListRequest.AgentTypes)
	agentUsages := splitAgentUsagesString(agentListRequest.AgentUsages)

	if common.IsAdmin(c) || len(agentUsages) > 0 {
		total, agents, err = model.GetAgentListWithIDs(
			eid, agentListRequest.Keyword, agentListRequest.GroupId,
			nil, channelTypes, agentTypes, agentUsages, agentListRequest.Offset, agentListRequest.Limit)
	} else {
		permittedAgentIDs, getErr := model.GetResourcesByGroupAndType(config.GetUserGroupID(c), model.ResourceTypeAgent)
		if getErr != nil {
			c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
			return
		}

		total, agents, err = model.GetAgentListWithIDs(
			eid, agentListRequest.Keyword, agentListRequest.GroupId,
			permittedAgentIDs, channelTypes, agentTypes, agentUsages,
			agentListRequest.Offset, agentListRequest.Limit)
	}

	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
		return
	}

	for _, agent := range agents {
		if err := agent.LoadUserGroupIds(); err != nil {
			c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
			return
		}
		agent.FillBotID()
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(AgentsResponse{
		Count:  total,
		Agents: agents,
	}))
}

// @Summary Get agents by group
// @Description Retrieve paginated list of agents by specified group with filtering options
// @Tags Agent
// @Produce json
// @Security BearerAuth
// @Param keyword    query string false "Search keyword for agent name or description"
// @Param group_id   query int    false  "Target group ID to filter agents"
// @Param offset     query int    false "Pagination offset" default(0)
// @Param limit      query int    false "Pagination limit"  default(10)
// @Param channel_types query string false "Channel types (0=OpenAI,1=Azure,2=claude), split by comma" example:"0,1,2"
// @Param agent_types query string false "Agent types (0=App,1=Workflow), split by comma" example:"0,1,2"
// @Param agent_usages query string false "Agent usages (0=hub,1=KM_AI_search,2=KM_file_chat), split by comma" example:"0,1,2" default:"0"
// @Success 200 {object} model.CommonResponse{data=AgentsResponse} "Success response with agent list"
// @Router /api/agents/group [get]
func GetAgentsByGroup(c *gin.Context) {
	var agentListRequest AgentListRequest
	if err := c.ShouldBindQuery(&agentListRequest); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// Set default limit to 10 if not specified
	if agentListRequest.Limit == 0 {
		agentListRequest.Limit = 10
	}

	channelTypes := splitChannelTypesString(agentListRequest.ChannelTypes)
	agentTypes := splitAgentTypesString(agentListRequest.AgentTypes)
	agentUsages := splitAgentUsagesString(agentListRequest.AgentUsages)
	var total, agents, err = model.GetAgentListWithIDs(
		config.GetEID(c), agentListRequest.Keyword, agentListRequest.GroupId,
		nil, channelTypes, agentTypes, agentUsages, agentListRequest.Offset, agentListRequest.Limit)

	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
		return
	}

	for _, agent := range agents {
		if err := agent.LoadUserGroupIds(); err != nil {
			c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
			return
		}
		agent.FillBotID()
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(AgentsResponse{
		Count:  total,
		Agents: agents,
	}))
}

// @Summary Get available agents
// @Description Retrieve paginated list of available agents with filtering options
// @Tags Agent
// @Produce json
// @Param offset query int false "Pagination offset" default(0)
// @Param limit query int false "Pagination limit" default(10)
// @Param agent_types query string false "Agent types (0=App,1=Workflow), split by comma" example:"0,1,2"
// @Param agent_usages query string false "Agent usages (0=hub,1=KM_AI_search,2=KM_file_chat), split by comma" example:"0,1,2" default:"0"
// @Success 200 {object} model.CommonResponse{data=AgentsResponse} "Success response with available agent list"
// @Router /api/agents/available [get]
func GetAvailableAgents(c *gin.Context) {
	var agentListRequest AgentListRequest
	if err := c.ShouldBindQuery(&agentListRequest); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	if agentListRequest.Limit == 0 {
		agentListRequest.Limit = 10
	}

	agentTypes := splitAgentTypesString(agentListRequest.AgentTypes)
	agentUsages := splitAgentUsagesString(agentListRequest.AgentUsages)
	var total, agents, err = model.GetAvailableAgentList(
		config.GetEID(c),
		agentTypes,
		agentUsages,
		agentListRequest.Offset,
		agentListRequest.Limit,
	)

	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
		return
	}

	for _, agent := range agents {
		if err = agent.LoadUserGroupIds(); err != nil {
			c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
			return
		}
		if err = agent.LoadConversationCount(); err != nil {
			c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
			return
		}
		agent.FillBotID()
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(AgentsResponse{
		Count:  total,
		Agents: agents,
	}))
}

// Get Current Agents
// @Summary Get current agent list
// @Description Get agents list under the first agent-type group of current enterprise (no pagination required)
// @Tags Agent
// @Produce json
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse{data=AgentsResponse} "Success response containing agent list"
// @Router /api/agents/current [get]
func GetCurrentAgents(c *gin.Context) {
	eid := config.GetEID(c)

	authHeader := c.GetHeader("Authorization")
	authHeader = strings.Replace(authHeader, "Bearer ", "", 1)

	var theGroup *model.Group
	var err error

	if authHeader == "" {
		group, err := model.GetFirstGroupByEid(eid, model.USER_GROUP_TYPE)
		if err != nil {
			c.JSON(http.StatusNotFound, model.DBError.ToResponse(err))
			return
		}
		theGroup = &group
	} else {
		user := model.ValidateAccessToken(authHeader)
		if user == nil {
			c.JSON(http.StatusUnauthorized, model.UnauthorizedError.ToResponse(nil))
			return
		}

		if user.GroupId > 0 {
			theGroup, err = model.GetGroupByID(user.GroupId)
			if err != nil {
				c.JSON(http.StatusNotFound, model.DBError.ToResponse(err))
				return
			}
		}
	}

	group, err := model.GetGroupWithAgents(theGroup.GroupId, true)
	if err != nil {
		c.JSON(http.StatusNotFound, model.DBError.ToResponse(err))
		return
	}

	for i := range group.Agents {
		var count int64
		model.DB.Model(&model.Conversation{}).
			Where("eid = ? AND agent_id = ?", eid, group.Agents[i].AgentID).
			Count(&count)

		group.Agents[i].ConversationCount = count
		group.Agents[i].FillBotID()
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(AgentsResponse{
		Count:  int64(len(group.Agents)),
		Agents: group.Agents,
	}))
}

// @Summary Update agent status
// @Description Update agent enable/disable status
// @Tags Agent
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param agent_id path int true "Agent ID"
// @Param request body UpdateAgentEnableRequest true "Enable status"
// @Success 200 {object} model.CommonResponse "Success"
// @Router /api/agents/{agent_id}/status [patch]
func UpdateAgentStatus(c *gin.Context) {
	agentID, err := strconv.ParseInt(c.Param("agent_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	var updateAgentEnableReq UpdateAgentEnableRequest
	if err = c.ShouldBindJSON(&updateAgentEnableReq); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	eid := config.GetEID(c)
	_, err = model.GetEnterpriseAgentByID(eid, agentID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(nil))
		return
	}

	err = model.UpdateAgentStatus(eid, agentID, updateAgentEnableReq.Enable)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
		return
	}

	agent, err := model.GetEnterpriseAgentByID(eid, agentID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(nil))
		return
	}
	statusText := "启用"
	if !agent.Enable {
		statusText = "禁用"
	}

	log := model.SystemLog{
		Eid:      eid,
		UserID:   config.GetUserId(c),
		Nickname: config.GetUserNickname(c),
		Module:   model.SystemLogModuleAgent,
		Action:   model.SystemLogActionToggle,
		Content:  fmt.Sprintf("%s智能体【%s】", statusText, agent.Name),
		IP:       utils.GetClientIP(c),
	}
	model.CreateSystemLog(&log)

	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}

func splitChannelTypesString(channelTypesStr string) []int {
	var channelTypes []int
	if channelTypesStr != "" {
		strSlice := strings.Split(channelTypesStr, ",")
		for _, s := range strSlice {
			if i, err := strconv.Atoi(strings.TrimSpace(s)); err == nil {
				channelTypes = append(channelTypes, i)
			}
		}
	}
	return channelTypes
}

func splitAgentTypesString(agentTypesStr string) []int {
	var agentTypes []int
	if agentTypesStr != "" {
		strSlice := strings.Split(agentTypesStr, ",")
		for _, s := range strSlice {
			if i, err := strconv.Atoi(strings.TrimSpace(s)); err == nil {
				agentTypes = append(agentTypes, i)
			}
		}
	}
	return agentTypes
}

func splitAgentUsagesString(agentUsagesStr string) []int {
	// 如果没有指定 agent_usages 参数，默认返回 [0] 即 hub 类型
	if agentUsagesStr == "" {
		return []int{0}
	}

	var agentUsages []int
	strSlice := strings.Split(agentUsagesStr, ",")
	for _, s := range strSlice {
		if i, err := strconv.Atoi(strings.TrimSpace(s)); err == nil {
			agentUsages = append(agentUsages, i)
		}
	}
	return agentUsages
}

// GetInternalUserAgents retrieves available agents for a specific internal user
// @Summary Get available agents for a specific internal user
// @Description Get all available agents for a specific internal user (including agents from user's groups and department groups, with duplicates removed)
// @Tags Agent
// @Produce json
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse{data=AgentsResponse} "Success response containing agent list"
// @Router /api/agents/internal_users [get]
func GetInternalUserAgents(c *gin.Context) {
	eid := config.GetEID(c)

	userID := config.GetUserId(c)
	user, err := model.GetUserByID(userID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.DBError.ToResponse(err))
		return
	}

	if user.Eid != eid || user.Type != model.UserTypeInternal {
		c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse("User is not an internal member of the current enterprise"))
		return
	}

	var groupIDs []int64
	groupIDs, err = model.GetGroupsByUserID(userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	var dids []int64
	dids, err = model.GetMemberDidsByBID(eid, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	var departmentGroupIDs []int64
	if len(dids) == 0 {
		dids = []int64{0}
	}

	for _, did := range dids {
		deptGroupIDs, err := model.GetGroupsByDepartmentID(did)
		if err != nil {
			c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
			return
		}
		departmentGroupIDs = append(departmentGroupIDs, deptGroupIDs...)
	}

	if len(departmentGroupIDs) > 0 {
		groupIDMap := make(map[int64]bool)
		for _, id := range groupIDs {
			groupIDMap[id] = true
		}

		for _, id := range departmentGroupIDs {
			if !groupIDMap[id] {
				groupIDs = append(groupIDs, id)
				groupIDMap[id] = true
			}
		}
	}

	if len(groupIDs) == 0 {
		c.JSON(http.StatusOK, model.Success.ToResponse(AgentsResponse{
			Count:  0,
			Agents: []*model.Agent{},
		}))
		return
	}

	var allAgents []*model.Agent
	agentMap := make(map[int64]*model.Agent)

	for _, groupID := range groupIDs {
		group, err := model.GetGroupWithAgents(groupID, true)
		if err != nil {
			continue
		}

		for i := range group.Agents {
			if group.Agents[i].Enable {
				agentMap[group.Agents[i].AgentID] = group.Agents[i]
			}
		}
	}

	for _, agent := range agentMap {
		var count int64
		model.DB.Model(&model.Conversation{}).
			Where("eid = ? AND agent_id = ?", eid, agent.AgentID).
			Count(&count)

		agent.ConversationCount = count
		agent.FillBotID()
		allAgents = append(allAgents, agent)
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(AgentsResponse{
		Count:  int64(len(allAgents)),
		Agents: allAgents,
	}))
}

// Agent Models 相关结构体
// AgentModelRequest 创建Agent Model请求参数
type AgentModelRequest struct {
	// Model 模型名称
	Model string `json:"model" example:"gpt-3.5-turbo"`
	// ChannelType 渠道类型
	ChannelType int `json:"channel_type" example:"0"`
	// ChannelID 渠道ID，关联 Channel.ChannelID
	ChannelID int64 `json:"channel_id" example:"0"`
}

// AgentModelUpdateRequest 更新Agent Model请求参数
type AgentModelUpdateRequest struct {
	// Model 模型名称
	Model string `json:"model" example:"gpt-3.5-turbo"`
	// ChannelType 渠道类型
	ChannelType int `json:"channel_type" example:"0"`
	// ChannelID 渠道ID，关联 Channel.ChannelID
	ChannelID int64 `json:"channel_id" example:"0"`
}

// BatchAgentModelRequest 批量创建Agent Model请求参数
type BatchAgentModelRequest struct {
	// AgentID Agent ID
	AgentID int64 `json:"agent_id" example:"1"`
	// Models 模型配置列表
	Models []AgentModelRequest `json:"models" example:"[{'model': 'gpt-3.5-turbo', 'channel_type': 0, 'channel_id': 1}]"`
}

// BatchAgentModelResponse 批量创建Agent Model响应数据
type BatchAgentModelResponse struct {
	// SuccessCount 成功创建数量
	SuccessCount int `json:"success_count"`
	// FailedCount 失败数量
	FailedCount int `json:"failed_count"`
	// AgentModels 创建成功的模型列表
	AgentModels []*model.AgentModels `json:"agent_models"`
	// Errors 失败错误信息列表
	Errors []string `json:"errors,omitempty"`
}

// AgentModelsResponse Agent Models响应数据
type AgentModelsResponse struct {
	// Count 总数
	Count int64 `json:"count"`
	// AgentModels Agent模型列表
	AgentModels []*model.AgentModels `json:"agent_models"`
}

// @Summary 创建Agent模型
// @Description 为指定Agent创建新的模型配置（需要管理员权限）
// @Tags Agent
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param agent_id path int true "Agent ID"
// @Param model body AgentModelRequest true "模型配置信息"
// @Success 200 {object} model.CommonResponse{data=model.AgentModels} "创建成功的模型配置"
// @Failure 400 {object} model.CommonResponse "请求参数错误"
// @Failure 404 {object} model.CommonResponse "Agent不存在"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/agents/{agent_id}/models [post]
func CreateAgentModel(c *gin.Context) {
	eid := config.GetEID(c)
	agentID, err := strconv.ParseInt(c.Param("agent_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	// 检查 Agent 是否存在
	_, err = model.GetEnterpriseAgentByID(eid, agentID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(nil))
		return
	}

	var req AgentModelRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	agentModel := &model.AgentModels{
		Eid:         eid,
		AgentID:     agentID,
		Model:       req.Model,
		ChannelType: req.ChannelType,
		ChannelID:   req.ChannelID,
	}

	err = agentModel.Create()
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
		return
	}

	fillAgentModelMeta(agentModel)
	c.JSON(http.StatusOK, model.Success.ToResponse(agentModel))
}

// @Summary 获取Agent模型列表
// @Description 获取指定Agent的所有模型配置（普通用户权限）
// @Tags Agent
// @Produce json
// @Security BearerAuth
// @Param agent_id path int true "Agent ID"
// @Success 200 {object} model.CommonResponse{data=AgentModelsResponse} "模型配置列表"
// @Failure 400 {object} model.CommonResponse "请求参数错误"
// @Failure 404 {object} model.CommonResponse "Agent不存在"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/agents/{agent_id}/models [get]
func GetAgentModels(c *gin.Context) {
	eid := config.GetEID(c)
	agentID, err := strconv.ParseInt(c.Param("agent_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	// 检查 Agent 是否存在
	_, err = model.GetEnterpriseAgentByID(eid, agentID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(nil))
		return
	}

	agentModels, err := model.GetAgentModelsByAgentID(eid, agentID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
		return
	}

	fillAgentModelsMeta(agentModels)
	c.JSON(http.StatusOK, model.Success.ToResponse(AgentModelsResponse{
		Count:       int64(len(agentModels)),
		AgentModels: agentModels,
	}))
}

// @Summary 更新Agent模型
// @Description 更新指定Agent的模型配置（需要管理员权限）
// @Tags Agent
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param agent_id path int true "Agent ID"
// @Param model_id path int true "模型配置ID"
// @Param model body AgentModelUpdateRequest true "模型配置更新信息"
// @Success 200 {object} model.CommonResponse{data=model.AgentModels} "更新后的模型配置"
// @Failure 400 {object} model.CommonResponse "请求参数错误"
// @Failure 403 {object} model.CommonResponse "权限不足"
// @Failure 404 {object} model.CommonResponse "模型配置不存在"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/agents/{agent_id}/models/{model_id} [put]
func UpdateAgentModel(c *gin.Context) {
	eid := config.GetEID(c)
	agentID, err := strconv.ParseInt(c.Param("agent_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	modelID, err := strconv.ParseInt(c.Param("model_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	// 检查 Agent Model 是否存在
	agentModel, err := model.GetAgentModelByID(eid, modelID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(nil))
		return
	}

	// 验证权限：确保该 Agent Model 属于指定的 Agent
	if agentModel.Eid != eid || agentModel.AgentID != agentID {
		c.JSON(http.StatusForbidden, model.ForbiddenError.ToResponse(nil))
		return
	}

	var req AgentModelUpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	agentModel.Model = req.Model
	agentModel.ChannelType = req.ChannelType
	agentModel.ChannelID = req.ChannelID

	err = agentModel.Update()
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
		return
	}

	fillAgentModelMeta(agentModel)
	c.JSON(http.StatusOK, model.Success.ToResponse(agentModel))
}

// @Summary 删除Agent模型
// @Description 删除指定的Agent模型配置（需要管理员权限）
// @Tags Agent
// @Produce json
// @Security BearerAuth
// @Param agent_id path int true "Agent ID"
// @Param model_id path int true "模型配置ID"
// @Success 200 {object} model.CommonResponse "删除成功"
// @Failure 400 {object} model.CommonResponse "请求参数错误"
// @Failure 403 {object} model.CommonResponse "权限不足"
// @Failure 404 {object} model.CommonResponse "模型配置不存在"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/agents/{agent_id}/models/{model_id} [delete]
func DeleteAgentModel(c *gin.Context) {
	eid := config.GetEID(c)
	agentID, err := strconv.ParseInt(c.Param("agent_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	modelID, err := strconv.ParseInt(c.Param("model_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	// 检查 Agent Model 是否存在
	agentModel, err := model.GetAgentModelByID(eid, modelID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(nil))
		return
	}

	// 验证权限：确保该 Agent Model 属于指定的 Agent
	if agentModel.Eid != eid || agentModel.AgentID != agentID {
		c.JSON(http.StatusForbidden, model.ForbiddenError.ToResponse(nil))
		return
	}

	err = agentModel.Delete()
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}

// @Summary 全量覆盖Agent模型配置
// @Description 为指定Agent全量覆盖模型配置，先删除所有现有配置再创建新的（需要管理员权限）
// @Tags Agent
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param model body BatchAgentModelRequest true "批量模型配置信息"
// @Success 200 {object} model.CommonResponse{data=BatchAgentModelResponse} "全量覆盖结果"
// @Failure 400 {object} model.CommonResponse "请求参数错误"
// @Failure 404 {object} model.CommonResponse "Agent不存在"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/agents/models/batch [post]
func BatchCreateAgentModels(c *gin.Context) {
	eid := config.GetEID(c)

	// 检查是否是管理员
	if !common.IsAdmin(c) {
		c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(nil))
		return
	}

	var req BatchAgentModelRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	// 检查 Agent 是否存在
	_, err := model.GetEnterpriseAgentByID(eid, req.AgentID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(nil))
		return
	}

	// 检查模型列表是否为空
	if len(req.Models) == 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("models list cannot be empty")))
		return
	}

	// 开始事务
	tx := model.DB.Begin()
	if tx.Error != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
		return
	}

	response := &BatchAgentModelResponse{
		SuccessCount: 0,
		FailedCount:  0,
		AgentModels:  make([]*model.AgentModels, 0),
		Errors:       make([]string, 0),
	}

	// 全量覆盖：先删除该 Agent 的所有现有模型配置
	if err := tx.Where("eid = ? AND agent_id = ?", eid, req.AgentID).Delete(&model.AgentModels{}).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
		return
	}

	// 遍历模型列表进行批量创建
	for _, modelReq := range req.Models {
		agentModel := &model.AgentModels{
			Eid:         eid,
			AgentID:     req.AgentID,
			Model:       modelReq.Model,
			ChannelType: modelReq.ChannelType,
			ChannelID:   modelReq.ChannelID,
		}

		// 创建新的模型配置
		if err := tx.Create(agentModel).Error; err != nil {
			response.FailedCount++
			response.Errors = append(response.Errors, fmt.Sprintf("Failed to create model %s: %v", modelReq.Model, err))
			continue
		}

		response.SuccessCount++
		response.AgentModels = append(response.AgentModels, agentModel)
	}

	// 提交事务
	if err := tx.Commit().Error; err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
		return
	}

	fillAgentModelsMeta(response.AgentModels)
	c.JSON(http.StatusOK, model.Success.ToResponse(response))
}

func fillAgentModelsMeta(agentModels []*model.AgentModels) {
	for _, agentModel := range agentModels {
		fillAgentModelMeta(agentModel)
	}
}

func fillAgentModelMeta(agentModel *model.AgentModels) {
	if agentModel == nil {
		return
	}

	meta := map[string]interface{}{}
	loader := common.GetModelCatalogLoader()
	if loader != nil {
		loadedMeta, err := loader.GetModelMeta(agentModel.ChannelType, agentModel.Model)
		if err == nil && loadedMeta != nil {
			if convertedMeta, ok := loadedMeta.(map[string]interface{}); ok {
				meta = convertedMeta
			}
		}
	}
	agentModel.ModelMeta = meta
}
