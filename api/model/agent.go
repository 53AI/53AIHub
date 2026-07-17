package model

import (
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// agentCacheTTL 进程内缓存有效期（秒）
const agentCacheTTL = 60

type agentCacheEntry struct {
	agent     *Agent
	expiresAt time.Time
}

var agentCache sync.Map // key: "eid:agentID"

func cacheKey(eid, agentID int64) string {
	return fmt.Sprintf("%d:%d", eid, agentID)
}

func invalidateAgentCache(eid, agentID int64) {
	agentCache.Delete(cacheKey(eid, agentID))
}

func ClearAgentCache() {
	agentCache.Range(func(key, _ any) bool {
		agentCache.Delete(key)
		return true
	})
}

type Agent struct {
	AgentID           int64   `json:"agent_id" gorm:"primaryKey;autoIncrement"`
	BotID             string  `json:"bot_id" gorm:"-"`
	Eid               int64   `json:"eid" gorm:"not null;index"`
	Name              string  `json:"name" gorm:"not null"`
	Logo              string  `json:"logo" gorm:"not null"`
	Sort              int     `json:"sort" gorm:"default:0"`
	Description       string  `json:"description" gorm:"not null"`
	ChannelType       int     `json:"channel_type" gorm:"default:0"`
	Model             string  `json:"model" gorm:"not null"`
	SpecificChannelID int64   `json:"-" gorm:"-"`
	Prompt            string  `json:"prompt" gorm:"not null"`
	Configs           string  `json:"configs" gorm:"not null;type:text"`
	Tools             string  `json:"tools" gorm:"not null;type:text"`
	GroupID           int64   `json:"group_id" gorm:"type:int;default:0;not null"`
	UseCases          string  `json:"use_cases" gorm:"not null;type:text"`
	CreatedBy         int64   `json:"created_by" gorm:"not null"`
	CustomConfig      string  `json:"custom_config" gorm:"not null;type:text"`
	Settings          string  `json:"settings" gorm:"not null;type:text"`
	UserGroupIds      []int64             `json:"user_group_ids" gorm:"-"`
	Scopes            []ResourceScopeItem `json:"scopes" gorm:"-"`
	Enable            bool                `json:"enable" gorm:"default:false;comment:enable status"`
	ConversationCount int64   `json:"conversation_count" gorm:"-"`
	AgentType         int     `json:"agent_type" gorm:"default:0"`
	AgentUsage        int     `json:"agent_usage" gorm:"default:0"`
	OwnerID           int64   `json:"owner_id" gorm:"default:0;index:idx_agent_owner"` // 归属用户ID，0=企业智能体，>0=个人智能体
	IsSystem          bool    `json:"is_system" gorm:"default:false;comment:系统创建标记"`
	BaseModel
}

const (
	AgentTypeApp       = 0 // 默认类型：应用型（后台页面上）
	AgentTypeWorkflow  = 1 // 对话型（后台页面上）
	AgentTypeAssistant = 2 // 助手型（后台页面上）
)

// 智能体归属常量
const (
	AgentOwnerEnterprise = 0 // 企业智能体（默认）
)

const (
	AgentUsageHub          = 0 // 默认类型：hub
	AgentUsageSearch       = 1 // KM AI 搜索
	AgentUsageFileChat     = 2 // KM 文件单聊模式
	AgentUsageKnowledgeMap = 3 // 知识地图
	AgentUsageWorkAI       = 4 // 工作AI
)

func (a *Agent) FillBotID() {
	if a.AgentID > 0 {
		a.BotID, _ = hashids.Encode(a.AgentID)
	}
}

func (agent *Agent) Create() error {
	if agent.Eid == 0 {
		return errors.New("eid is empty")
	}
	// check if name exists
	var count int64
	DB.Model(&Agent{}).Where("eid = ? AND name = ?", agent.Eid, agent.Name).Count(&count)
	if count > 0 {
		return errors.New("name already exists")
	}

	result := DB.Create(agent)
	if result.Error != nil {
		return result.Error
	}

	return nil
}

func (agent *Agent) Update() error {
	err := DB.Model(agent).Updates(agent).Error
	if err == nil {
		invalidateAgentCache(agent.Eid, agent.AgentID)
	}
	return err
}

func (agent *Agent) Delete() error {
	err := DB.Delete(agent).Error
	if err == nil {
		invalidateAgentCache(agent.Eid, agent.AgentID)
	}
	return err
}

func GetAgentByID(eid int64, agentID int64) (*Agent, error) {
	// 查缓存
	key := cacheKey(eid, agentID)
	if entry, ok := agentCache.Load(key); ok {
		ce := entry.(agentCacheEntry)
		if time.Now().Before(ce.expiresAt) {
			return ce.agent, nil
		}
		agentCache.Delete(key)
	}

	var agent Agent
	err := DB.Where("eid = ? AND agent_id = ?", eid, agentID).First(&agent).Error
	if err != nil {
		return nil, err
	}

	// 写入缓存
	agentCache.Store(key, agentCacheEntry{
		agent:     &agent,
		expiresAt: time.Now().Add(agentCacheTTL * time.Second),
	})
	return &agent, nil
}

func GetEnterpriseAgentByID(eid int64, agentID int64) (*Agent, error) {
	var agent Agent
	err := DB.Where("eid = ? AND agent_id = ? AND owner_id = ?", eid, agentID, AgentOwnerEnterprise).First(&agent).Error
	if err != nil {
		return nil, err
	}
	return &agent, nil
}

func GetAgentListWithIDs(eid int64, keyword string, group_id int64, permittedAgentIDs []int64, channel_types []int, agent_types []int, agent_usages []int, offset int, limit int) (count int64, agents []*Agent, err error) {
	db := DB.Model(&Agent{}).Where("eid = ? AND owner_id = ?", eid, AgentOwnerEnterprise)
	if keyword != "" {
		db = db.Where("name LIKE ?", "%"+keyword+"%")
	}

	if group_id != 0 {
		db = db.Where("group_id =?", group_id)
	}

	if len(channel_types) > 0 {
		db = db.Where("channel_type IN?", channel_types)
	}

	if len(agent_types) > 0 {
		db = db.Where("agent_type IN?", agent_types)
	}

	if len(agent_usages) > 0 {
		db = db.Where("agent_usage IN?", agent_usages)
	}

	if permittedAgentIDs != nil {
		if len(permittedAgentIDs) == 0 {
			return 0, []*Agent{}, nil
		}
		db = db.Where("agent_id IN ?", permittedAgentIDs)
	}

	db.Count(&count)

	err = db.Offset(offset).Limit(limit).Order("(CASE WHEN is_system = true AND agent_usage IN (1, 4) THEN 0 ELSE 1 END), (CASE WHEN is_system = true AND agent_usage = 1 THEN 0 WHEN is_system = true AND agent_usage = 4 THEN 1 ELSE 2 END), sort DESC, agent_id DESC").Find(&agents).Error

	return count, agents, err
}

func GetAvailableAgentList(eid int64, agent_types []int, agent_usages []int, offset int, limit int) (count int64, agents []*Agent, err error) {
	db := DB.Model(&Agent{}).Where("eid = ? AND owner_id = ? AND Enable = ?", eid, AgentOwnerEnterprise, true)

	if len(agent_types) > 0 {
		db = db.Where("agent_type IN?", agent_types)
	}

	if len(agent_usages) > 0 {
		db = db.Where("agent_usage IN?", agent_usages)
	}

	db.Count(&count)

	err = db.Offset(offset).Limit(limit).Order("sort DESC").Order("agent_id DESC").Find(&agents).Error

	return count, agents, err
}

func (a *Agent) GetUserGroupIds() ([]int64, error) {
	var permissions []ResourcePermission
	groupIds := make([]int64, 0)
	seen := make(map[int64]bool)

	err := DB.Where("resource_id = ? AND resource_type = ?", a.AgentID, ResourceTypeAgent).Find(&permissions).Error
	if err != nil {
		return nil, err
	}

	for _, p := range permissions {
		if !seen[p.GroupID] {
			seen[p.GroupID] = true
			groupIds = append(groupIds, p.GroupID)
		}
	}

	return groupIds, nil
}

// LoadUserGroupIds
func (a *Agent) LoadUserGroupIds() error {
	ids, err := a.GetUserGroupIds()
	if err != nil {
		return err
	}
	a.UserGroupIds = ids
	return nil
}

func (a *Agent) LoadScopes() error {
	scopes, err := GetResourceScopesByResource(a.AgentID, ResourceTypeAgent)
	if err != nil {
		return err
	}
	items := make([]ResourceScopeItem, 0, len(scopes))
	for _, s := range scopes {
		items = append(items, ResourceScopeItem{
			ScopeType: s.ScopeType,
			TargetID:  s.TargetID,
		})
	}
	a.Scopes = items
	return nil
}

func (a *Agent) LoadConversationCount() error {
	var count int64
	err := DB.Model(&Conversation{}).Where("agent_id =?", a.AgentID).Count(&count).Error
	if err != nil {
		return err
	}
	a.ConversationCount = count
	return nil
}

func LoadUserGroupIdsBatch(agents []*Agent) error {
	if len(agents) == 0 {
		return nil
	}

	agentIDs := make([]int64, len(agents))
	for i, a := range agents {
		agentIDs[i] = a.AgentID
	}

	var permissions []ResourcePermission
	err := DB.Where("resource_id IN ? AND resource_type = ?", agentIDs, ResourceTypeAgent).Find(&permissions).Error
	if err != nil {
		return err
	}

	permMap := make(map[int64][]int64)
	seen := make(map[int64]map[int64]bool)
	for _, p := range permissions {
		if seen[p.ResourceID] == nil {
			seen[p.ResourceID] = make(map[int64]bool)
		}
		if !seen[p.ResourceID][p.GroupID] {
			seen[p.ResourceID][p.GroupID] = true
			permMap[p.ResourceID] = append(permMap[p.ResourceID], p.GroupID)
		}
	}

	for _, a := range agents {
		a.UserGroupIds = permMap[a.AgentID]
		if a.UserGroupIds == nil {
			a.UserGroupIds = []int64{}
		}
	}
	return nil
}

func LoadScopesBatch(agents []*Agent) error {
	if len(agents) == 0 {
		return nil
	}

	agentIDs := make([]int64, len(agents))
	for i, a := range agents {
		agentIDs[i] = a.AgentID
	}

	var scopes []ResourceScope
	err := DB.Where("resource_id IN ? AND resource_type = ?", agentIDs, ResourceTypeAgent).Find(&scopes).Error
	if err != nil {
		return err
	}

	scopeMap := make(map[int64][]ResourceScopeItem)
	for _, s := range scopes {
		scopeMap[s.ResourceID] = append(scopeMap[s.ResourceID], ResourceScopeItem{
			ScopeType: s.ScopeType,
			TargetID:  s.TargetID,
		})
	}

	for _, a := range agents {
		a.Scopes = scopeMap[a.AgentID]
		if a.Scopes == nil {
			a.Scopes = []ResourceScopeItem{}
		}
	}
	return nil
}

type agentConversationCount struct {
	AgentID int64
	Count   int64
}

func LoadConversationCountBatch(agents []*Agent, eid int64) error {
	if len(agents) == 0 {
		return nil
	}

	agentIDs := make([]int64, len(agents))
	for i, a := range agents {
		agentIDs[i] = a.AgentID
	}

	var results []agentConversationCount
	err := DB.Model(&Conversation{}).
		Select("agent_id, count(*) as count").
		Where("agent_id IN ? AND eid = ?", agentIDs, eid).
		Group("agent_id").
		Find(&results).Error
	if err != nil {
		return err
	}

	countMap := make(map[int64]int64)
	for _, r := range results {
		countMap[r.AgentID] = r.Count
	}

	for _, a := range agents {
		a.ConversationCount = countMap[a.AgentID]
	}
	return nil
}

func UpdateAgentStatus(eid, agentID int64, enable *bool) error {
	err := DB.Model(&Agent{}).
		Where("eid = ? AND agent_id = ?", eid, agentID).
		Update("enable", enable).Error
	if err == nil {
		invalidateAgentCache(eid, agentID)
	}
	return err
}

func GetAgentCountByEID(eid int64) (int64, error) {
	var count int64
	err := DB.Model(&Agent{}).Where("eid = ? AND owner_id = ?", eid, AgentOwnerEnterprise).Count(&count).Error
	return count, err
}

func (a *Agent) GetProviderID() int64 {
	if a.CustomConfig == "" {
		return 0
	}

	var config map[string]interface{}
	if err := json.Unmarshal([]byte(a.CustomConfig), &config); err != nil {
		return 0
	}

	if providerID, exists := config["provider_id"]; exists {
		switch v := providerID.(type) {
		case float64:
			return int64(v)
		case int:
			return int64(v)
		case int64:
			return v
		case string:
			// Try to parse string as number
			if num, err := strconv.ParseInt(v, 10, 64); err == nil {
				return num
			}
		}
	}

	return 0
}

// GetRerankConfig 从 Agent Settings 中获取重排配置
// 使用 "rerank_config" 作为字典的 key 来获取配置，不影响其他功能
func (a *Agent) GetRerankConfig() (*SearchConfigData, error) {
	if a.Settings == "" {
		return nil, nil
	}

	var settings map[string]interface{}
	if err := json.Unmarshal([]byte(a.Settings), &settings); err != nil {
		return nil, err
	}

	// 使用 "rerank_config" key 获取重排配置
	if rerankConfigData, exists := settings["rerank_config"]; exists {
		// 将 interface{} 转换为 JSON 字符串，再解析为 SearchConfigData
		configBytes, err := json.Marshal(rerankConfigData)
		if err != nil {
			return nil, err
		}

		var rerankConfig SearchConfigData
		if err := json.Unmarshal(configBytes, &rerankConfig); err != nil {
			return nil, err
		}

		return &rerankConfig, nil
	}

	return nil, nil
}

// OutOfRangeReplyConfig 超纲回复配置
type OutOfRangeReplyConfig struct {
	Enable bool   `json:"enable"` // 是否启用超纲回复
	Reply  string `json:"reply"`  // 超纲回复内容
	Mode   string `json:"mode"`   // 模式：fixed_reply (固定回复), continue (模型继续生成)
	Prompt string `json:"prompt"` // 兜底提示词（当 mode 为 continue 时使用）
}

// AnswerPreferenceConfig 回答偏好配置
type AnswerPreferenceConfig struct {
	Enable  bool   `json:"enable"`  // 是否启用回答偏好
	Content string `json:"content"` // 偏好内容
}

// AnswerRemarksConfig 回答备注配置
type AnswerRemarksConfig struct {
	Enable  bool   `json:"enable"`  // 是否启用回答备注
	Content string `json:"content"` // 备注内容
}

// GetOutOfRangeReplyConfig 从 Agent Settings 中获取超纲回复配置
// 使用 "out_of_range_reply" 作为字典的 key 来获取配置，不影响其他功能
func (a *Agent) GetOutOfRangeReplyConfig() (*OutOfRangeReplyConfig, error) {
	if a.Settings == "" {
		return nil, nil
	}

	var settings map[string]interface{}
	if err := json.Unmarshal([]byte(a.Settings), &settings); err != nil {
		return nil, err
	}

	// 使用 "out_of_range_reply" key 获取超纲回复配置
	if replyConfigData, exists := settings["out_of_range_reply"]; exists {
		// 将 interface{} 转换为 JSON 字符串，再解析为 OutOfRangeReplyConfig
		configBytes, err := json.Marshal(replyConfigData)
		if err != nil {
			return nil, err
		}

		var replyConfig OutOfRangeReplyConfig
		if err := json.Unmarshal(configBytes, &replyConfig); err != nil {
			return nil, err
		}

		return &replyConfig, nil
	}

	return nil, nil
}

// GetAnswerPreferenceConfig 获取回答偏好配置
func (a *Agent) GetAnswerPreferenceConfig() (*AnswerPreferenceConfig, error) {
	if a.Settings == "" {
		return nil, nil
	}

	var settings map[string]interface{}
	if err := json.Unmarshal([]byte(a.Settings), &settings); err != nil {
		return nil, err
	}

	if configData, exists := settings["answer_preference_config"]; exists {
		configBytes, err := json.Marshal(configData)
		if err != nil {
			return nil, err
		}

		var config AnswerPreferenceConfig
		if err := json.Unmarshal(configBytes, &config); err != nil {
			return nil, err
		}
		return &config, nil
	}
	return nil, nil
}

// GetAnswerRemarksConfig 获取回答备注配置
func (a *Agent) GetAnswerRemarksConfig() (*AnswerRemarksConfig, error) {
	if a.Settings == "" {
		return nil, nil
	}

	var settings map[string]interface{}
	if err := json.Unmarshal([]byte(a.Settings), &settings); err != nil {
		return nil, err
	}

	if configData, exists := settings["answer_remarks_config"]; exists {
		configBytes, err := json.Marshal(configData)
		if err != nil {
			return nil, err
		}

		var config AnswerRemarksConfig
		if err := json.Unmarshal(configBytes, &config); err != nil {
			return nil, err
		}
		return &config, nil
	}
	return nil, nil
}

// WebISearchConfig AI在线搜索配置
type WebSearchConfig struct {
	Enable            bool   `json:"enable"`              // 是否启用AI在线搜索
	PlatformSettingID string `json:"platform_setting_id"` // PlatformSetting的ID经过hashID加密后的字符串
	PlatformKey       string `json:"platform_key"`        // PlatformKey的类型，如"bochaai"
}

// GraphSearchConfig 图谱搜索配置
type GraphSearchConfig struct {
	Enable        bool `json:"enable"`         // 是否启用图谱搜索总开关
	DefaultEnable bool `json:"default_enable"` // 前端默认是否启用图谱搜索
}

// GetWebSearchConfig 从 Agent Settings 中获取AI在线搜索配置
// 使用 "web_search_config" 作为字典的 key 来获取配置
func (a *Agent) GetWebSearchConfig() (*WebSearchConfig, error) {
	if a.Settings == "" {
		return nil, nil
	}

	var settings map[string]interface{}
	if err := json.Unmarshal([]byte(a.Settings), &settings); err != nil {
		return nil, err
	}

	// 使用 "web_search_config" key 获取AI在线搜索配置
	if searchConfigData, exists := settings["web_search_config"]; exists {
		// 将 interface{} 转换为 JSON 字符串，再解析为 WebSearchConfig
		configBytes, err := json.Marshal(searchConfigData)
		if err != nil {
			return nil, err
		}

		var searchConfig WebSearchConfig
		if err := json.Unmarshal(configBytes, &searchConfig); err != nil {
			return nil, err
		}

		return &searchConfig, nil
	}

	return nil, nil
}

// GetGraphSearchConfig 从 Agent Settings 中获取图谱搜索配置
// 使用 "graph_search_setting" 作为字典的 key 来获取配置
func (a *Agent) GetGraphSearchConfig() (*GraphSearchConfig, error) {
	if a.Settings == "" {
		return nil, nil
	}

	var settings map[string]interface{}
	if err := json.Unmarshal([]byte(a.Settings), &settings); err != nil {
		return nil, err
	}

	if graphSearchConfigData, exists := settings["graph_search_setting"]; exists {
		configBytes, err := json.Marshal(graphSearchConfigData)
		if err != nil {
			return nil, err
		}

		var graphSearchConfig GraphSearchConfig
		if err := json.Unmarshal(configBytes, &graphSearchConfig); err != nil {
			return nil, err
		}

		return &graphSearchConfig, nil
	}

	return nil, nil
}

// SkillRunConfig 技能执行配置
type SkillRunConfig struct {
	Enable      bool    `json:"enable"`
	ChannelID   int64   `json:"channel_id"`
	ChannelType int     `json:"channel_type"`
	ModelName   string  `json:"model_name"`
	Temperature float64 `json:"temperature"`
}

// DeepThinkingConfig 深度思考配置
type DeepThinkingConfig struct {
	Enable      bool    `json:"enable"`
	ChannelID   int64   `json:"channel_id"`
	ChannelType int     `json:"channel_type"`
	ModelName   string  `json:"model_name"`
	Temperature float64 `json:"temperature"`
}

// GetSkillRunConfig 从 Agent Settings 中获取技能执行配置
func (a *Agent) GetSkillRunConfig() (*SkillRunConfig, error) {
	if a.Settings == "" {
		return nil, nil
	}

	var settings map[string]interface{}
	if err := json.Unmarshal([]byte(a.Settings), &settings); err != nil {
		return nil, err
	}

	if skillRunConfigData, exists := settings["skill_run_config"]; exists {
		configBytes, err := json.Marshal(skillRunConfigData)
		if err != nil {
			return nil, err
		}

		var skillRunConfig SkillRunConfig
		if err := json.Unmarshal(configBytes, &skillRunConfig); err != nil {
			return nil, err
		}

		return &skillRunConfig, nil
	}

	return nil, nil
}

// GetDeepThinkingConfig 从 Agent Settings 中获取深度思考配置
func (a *Agent) GetDeepThinkingConfig() (*DeepThinkingConfig, error) {
	if a.Settings == "" {
		return nil, nil
	}

	var settings map[string]interface{}
	if err := json.Unmarshal([]byte(a.Settings), &settings); err != nil {
		return nil, err
	}

	if deepThinkingData, exists := settings["deep_thinking_config"]; exists {
		configBytes, err := json.Marshal(deepThinkingData)
		if err != nil {
			return nil, err
		}

		var deepThinkingConfig DeepThinkingConfig
		if err := json.Unmarshal(configBytes, &deepThinkingConfig); err != nil {
			return nil, err
		}

		return &deepThinkingConfig, nil
	}

	return nil, nil
}

// OpenClawGatewayConfig OpenClaw Gateway 配置
type OpenClawGatewayConfig struct {
	GatewayURL string `json:"gateway_url"`
	AuthToken  string `json:"auth_token"`
	TimeoutMs  int    `json:"timeout_ms"`
	MaxRetries int    `json:"max_retries"`
	Streaming  bool   `json:"streaming"`
	InstanceID string `json:"instance_id"`
}

// GetOpenClawGatewayConfig 从 Agent CustomConfig 中获取 Gateway 配置
func (a *Agent) GetOpenClawGatewayConfig() (*OpenClawGatewayConfig, error) {
	if a.CustomConfig == "" {
		return nil, nil
	}

	var config map[string]interface{}
	if err := json.Unmarshal([]byte(a.CustomConfig), &config); err != nil {
		return nil, err
	}

	// 从 openclaw 键中获取配置
	openclawConfig, exists := config["openclaw"]
	if !exists {
		return nil, nil
	}

	// 转换为 JSON 字符串，再解析为 OpenClawGatewayConfig
	configBytes, err := json.Marshal(openclawConfig)
	if err != nil {
		return nil, err
	}

	var gatewayConfig OpenClawGatewayConfig
	if err := json.Unmarshal(configBytes, &gatewayConfig); err != nil {
		return nil, err
	}

	// 设置默认值
	if gatewayConfig.TimeoutMs == 0 {
		gatewayConfig.TimeoutMs = 30000
	}
	if gatewayConfig.MaxRetries == 0 {
		gatewayConfig.MaxRetries = 3
	}

	return &gatewayConfig, nil
}

// IsOpenClawAgent 检查 Agent 是否为 OpenClaw 类型
func (a *Agent) IsOpenClawAgent() bool {
	if a.ChannelType == ChannelApiTypeOpenClaw {
		return true
	}

	if a.CustomConfig == "" {
		return false
	}

	var config map[string]interface{}
	if err := json.Unmarshal([]byte(a.CustomConfig), &config); err != nil {
		return false
	}

	_, exists := config["openclaw"]
	return exists
}

// GetFastReasoningConfig 从 Agent Settings 中获取 FastReasoning 配置
func (a *Agent) GetFastReasoningConfig() (*ModelChannelConfig, error) {
	if a.Settings == "" {
		return nil, nil
	}

	var settings map[string]interface{}
	if err := json.Unmarshal([]byte(a.Settings), &settings); err != nil {
		return nil, err
	}

	// 使用 "fast_reasoning" key 获取 FastReasoning 配置
	if fastReasoningData, exists := settings["fast_reasoning"]; exists {
		// 将 interface{} 转换为 JSON 字符串，再解析为 ModelChannelConfig
		configBytes, err := json.Marshal(fastReasoningData)
		if err != nil {
			return nil, err
		}

		var fastReasoningConfig ModelChannelConfig
		if err := json.Unmarshal(configBytes, &fastReasoningConfig); err != nil {
			return nil, err
		}

		return &fastReasoningConfig, nil
	}

	if fastReasoningData, exists := settings["fast_reasoning_config"]; exists {
		// 将 interface{} 转换为 JSON 字符串，再解析为 ModelChannelConfig
		configBytes, err := json.Marshal(fastReasoningData)
		if err != nil {
			return nil, err
		}

		var fastReasoningConfig ModelChannelConfig
		if err := json.Unmarshal(configBytes, &fastReasoningConfig); err != nil {
			return nil, err
		}

		return &fastReasoningConfig, nil
	}

	return nil, nil
}

func GetPersonalAgentsByUserID(eid, userID int64, offset, limit int) (int64, []*Agent, error) {
	var count int64
	var agents []*Agent

	db := DB.Model(&Agent{}).Where("eid = ? AND owner_id = ?", eid, userID)
	db.Count(&count)

	err := db.Order("created_time DESC").Offset(offset).Limit(limit).Find(&agents).Error
	return count, agents, err
}

func GetPersonalAgentByID(eid, userID, agentID int64) (*Agent, error) {
	var agent Agent
	err := DB.Where("eid = ? AND agent_id = ? AND owner_id = ?", eid, agentID, userID).First(&agent).Error
	if err != nil {
		return nil, err
	}
	return &agent, nil
}

// CanUserAccessAgent 检查用户是否有权限使用/访问某个智能体
// 权限规则：
// 1. 个人智能体（owner_id > 0）：只有 owner 可以访问
// 2. 企业智能体且 agent_usage 为 1(KM AI搜索) 或 4(工作AI)：默认可用，跳过组权限检查
// 3. 其他企业智能体（owner_id == 0）：
//    - 用户在 resource_permissions 表中有该 agent 的 read 权限
//    - 或用户所属组在智能体的 UserGroupIds 中
// 两者满足其一即可访问
func CanUserAccessAgent(eid, userID, agentID int64) (bool, *Agent, error) {
	agent, err := GetAgentByID(eid, agentID)
	if err != nil {
		return false, nil, err
	}

	// 个人智能体：只有 owner 可以访问
	if agent.OwnerID > 0 {
		if agent.OwnerID == userID {
			return true, agent, nil
		}
		return false, agent, nil
	}

	// 企业智能体且 agent_usage 为 1(KM AI搜索) 或 4(工作AI)：默认可用，跳过组权限检查
	if agent.AgentUsage == AgentUsageSearch || agent.AgentUsage == AgentUsageWorkAI {
		return true, agent, nil
	}

	user, err := GetUserByID(userID)
	if err != nil {
		return false, agent, err
	}

	userGroupIds, err := user.GetUserGroupIds()
	if err != nil {
		return false, agent, err
	}

	// 检查方式1：resource_permissions 表
	for _, groupID := range userGroupIds {
		hasPermission, err := CheckPermission(groupID, agentID, ResourceTypeAgent, PermissionRead)
		if err == nil && hasPermission {
			return true, agent, nil
		}
	}

	// 检查方式2：agent.user_group_ids 交集
	agentGroupIds, err := agent.GetUserGroupIds()
	if err != nil {
		return false, agent, err
	}

	for _, ug := range userGroupIds {
		for _, ag := range agentGroupIds {
			if ug == ag {
				return true, agent, nil
			}
		}
	}

	return false, agent, nil
}

func GenerateOpenClawAppSecret() string {
	return "sk-53ai-" + strings.ReplaceAll(uuid.New().String(), "-", "")
}

func (a *Agent) SetOpenClawAppSecret(secret string) error {
	var config map[string]interface{}
	if a.CustomConfig != "" {
		if err := json.Unmarshal([]byte(a.CustomConfig), &config); err != nil {
			config = make(map[string]interface{})
		}
	} else {
		config = make(map[string]interface{})
	}

	version := 1
	if v, ok := config["secret_version"].(float64); ok {
		version = int(v) + 1
	}
	config["secret_version"] = version
	config["secret_reset_time"] = time.Now().UTC().UnixMilli()

	config["openclaw_app_secret"] = secret

	configBytes, err := json.Marshal(config)
	if err != nil {
		return err
	}
	a.CustomConfig = string(configBytes)
	return nil
}

func (a *Agent) GetOpenClawAppSecret() string {
	if a.CustomConfig == "" {
		return ""
	}

	var config map[string]interface{}
	if err := json.Unmarshal([]byte(a.CustomConfig), &config); err != nil {
		return ""
	}

	if secret, ok := config["openclaw_app_secret"].(string); ok {
		return secret
	}
	return ""
}

func removeRelateAgentFromSettingsJSON(settingsJSON string, deletedAgentID int64, deletedBotID string) (bool, string, error) {
	if settingsJSON == "" {
		return false, settingsJSON, nil
	}

	var settings map[string]interface{}
	if err := json.Unmarshal([]byte(settingsJSON), &settings); err != nil {
		return false, settingsJSON, nil
	}

	relateAgentsRaw, exists := settings["relate_agents"]
	if !exists {
		return false, settingsJSON, nil
	}

	relateAgents, ok := relateAgentsRaw.([]interface{})
	if !ok || len(relateAgents) == 0 {
		return false, settingsJSON, nil
	}

	filtered := make([]interface{}, 0, len(relateAgents))
	for _, item := range relateAgents {
		agent, ok := item.(map[string]interface{})
		if !ok {
			filtered = append(filtered, item)
			continue
		}
		agentIDVal, exists := agent["agent_id"]
		if !exists {
			filtered = append(filtered, item)
			continue
		}
		if matchRelateAgentID(agentIDVal, deletedAgentID, deletedBotID) {
			continue
		}
		filtered = append(filtered, item)
	}

	if len(filtered) == len(relateAgents) {
		return false, settingsJSON, nil
	}

	settings["relate_agents"] = filtered
	result, err := json.Marshal(settings)
	if err != nil {
		return false, settingsJSON, err
	}
	return true, string(result), nil
}

func matchRelateAgentID(agentIDVal interface{}, deletedAgentID int64, deletedBotID string) bool {
	switch v := agentIDVal.(type) {
	case string:
		if v == deletedBotID {
			return true
		}
		decoded, err := strconv.ParseInt(v, 10, 64)
		if err == nil && decoded == deletedAgentID {
			return true
		}
		decodedHash, err := hashids.Decode(v)
		if err == nil && decodedHash == deletedAgentID {
			return true
		}
	case float64:
		if int64(v) == deletedAgentID {
			return true
		}
	}
	return false
}

func RemoveRelateAgentFromSettings(tx *gorm.DB, eid int64, deletedAgentID int64, deletedBotID string) error {
	var agents []Agent
	if err := tx.Select("agent_id, settings").Where("eid = ?", eid).Find(&agents).Error; err != nil {
		return err
	}

	for i := range agents {
		changed, newSettings, err := removeRelateAgentFromSettingsJSON(agents[i].Settings, deletedAgentID, deletedBotID)
		if err != nil {
			logger.SysErrorf("清理 relate_agents 失败: agent_id=%d, err=%v", agents[i].AgentID, err)
			continue
		}
		if changed {
			if err := tx.Model(&Agent{}).Where("agent_id = ?", agents[i].AgentID).Update("settings", newSettings).Error; err != nil {
				return err
			}
		}
	}
	return nil
}
