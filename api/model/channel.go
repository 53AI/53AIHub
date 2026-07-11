package model

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils"
	"github.com/songquanpeng/one-api/common/helper"
	oneapi_model "github.com/songquanpeng/one-api/model"
	"github.com/songquanpeng/one-api/relay/channeltype"
)

const (
	ChannelStatusUnknown          = 0
	ChannelStatusEnabled          = 1
	ChannelStatusManuallyDisabled = 2
	ChannelStatusAutoDisabled     = 3
)

const (
	// 因为是 model 类型和之前的 ChannelApiVolcengine 1004 区分开，1004 是 APP 类型
	ChannelApiVolcengineModel = 900
	// model 和 agent的类型不一样
	ChannelApiTypeAppBuilderModel = 901
)

const (
	ChannelApiDify       = 1001
	ChannelApi53AI       = 1002
	ChannelApiBailian    = 1003
	ChannelApiVolcengine = 1004
	ChannelApiAppBuilder = 1005
	ChannelApiYuanqi     = 1006
	// FastGpt 不是新的渠道，数据库里面还是 22，这里是为了替代 apitype 为0 只能走默认 openai 的问题
	ChannelApiTypeFastGpt    = 1007
	ChannelApiTypeMaxKB      = 1008
	ChannelApiTypeN8n        = 1009
	ChannelApiTypeCozeStudio = 1010
	// 腾讯云
	ChannelApiTypeTencent = 1011
	// 自定义 OpenAI 兼容模型
	ChannelApiTypeCustomOpenAI = 1012
	// OpenClaw
	ChannelApiTypeOpenClaw = 1013
	// OpenClaw WebSocket 长连接
	ChannelApiTypeOpenClawWS = 1014
	// QClaw WebSocket 长连接
	ChannelApiTypeQClawWS = 1015
	// Codex WebSocket 长连接
	ChannelApiTypeCodexWS = 1016
	// Manus WebSocket 长连接
	ChannelApiTypeManusWS = 1017
)

// ChannelDescription 渠道描述结构体
type ChannelDescription struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

// channelDescMap 渠道key到描述的映射
var channelDescMap = map[string]string{
	"prompt":           "通过Prompt创建",
	"53ai_agent":       "53AI Studio",
	"53ai_workflow":    "53AI工作流",
	"coze_agent_cn":    "扣子",
	"coze_workflow_cn": "扣子工作流",
	"coze_agent":       "Coze智能体",
	"coze_workflow":    "Coze工作流",
	"coze_studio":      "Coze Studio",
	"dify_agent":       "Dify",
	"dify_workflow":    "Dify工作流",
	"app_builder":      "百度千帆Appbuilder",
	"yuanqi":           "腾讯元器",
	"bailian":          "阿里百炼",
	"volcengine":       "火山方舟",
	"tencent":          "腾讯云",
	"openclaw_ws":      "OpenClaw长连接",
	"openclaw":         "OpenClaw",
	"qclaw":            "QClaw",
	"codex":            "Codex",
	"manus":            "Manus",
}

// GetChannelDescription 通过key获取渠道描述
func GetChannelDescription(key string) string {
	if desc, ok := channelDescMap[key]; ok {
		return desc
	}
	return ""
}

// GetAllChannelDescriptions 获取所有渠道描述
func GetAllChannelDescriptions() []ChannelDescription {
	descriptions := make([]ChannelDescription, 0, len(channelDescMap))
	for k, v := range channelDescMap {
		descriptions = append(descriptions, ChannelDescription{Key: k, Value: v})
	}
	return descriptions
}

type Channel struct {
	ChannelID          int64   `json:"channel_id" gorm:"primaryKey;autoIncrement"`
	Eid                int64   `json:"eid" gorm:"not null;index" example:"1"`
	Type               int     `json:"type" gorm:"default:0"`
	Key                string  `json:"key" gorm:"type:text"`
	Weight             *uint   `json:"weight" gorm:"default:0"`
	Name               string  `json:"name" gorm:"not null" example:"channel_name"`
	Models             string  `json:"models"`
	Config             string  `json:"config"`
	CustomConfig       string  `json:"custom_config"`
	Other              *string `json:"other"`
	ModelMapping       *string `json:"model_mapping" gorm:"size:2048;default:''"`
	Priority           *int64  `json:"priority" gorm:"bigint;default:0"`
	BaseURL            *string `json:"base_url" gorm:"column:base_url;size:512;default:''"`
	UsedQuota          int64   `json:"used_quota" gorm:"bigint;default:0"`
	Status             int     `json:"status" gorm:"default:1"`
	Balance            float64 `json:"balance"`
	BalanceUpdatedTime int64   `json:"balance_updated_time" gorm:"bigint"`
	TestTime           int64   `json:"test_time" gorm:"bigint"`
	ResponseTime       int     `json:"response_time"`
	ProviderID         int64   `json:"provider_id" gorm:"bigint;default:0"`
	BaseModel
}

func CreateChannel(channel *Channel) error {
	return DB.Create(channel).Error
}

func GetChannelByID(id int64) (*Channel, error) {
	var channel Channel
	err := DB.Where("channel_id = ?", id).First(&channel).Error
	return &channel, err
}

func UpdateChannel(channel *Channel) error {
	return DB.Save(channel).Error
}

func DeleteChannelByID(id int64) error {
	return DB.Where("channel_id = ?", id).Delete(&Channel{}).Error
}

func GetChannelsByEid(eid int64) ([]Channel, error) {
	var channels []Channel
	err := DB.Where("eid = ?", eid).Find(&channels).Error
	return channels, err
}

// GetChannelsByEidAndProviderId gets a list of channels by enterprise ID and provider ID
// If providerId is 0, get channels added by the platform itself (providerId=0)
// If providerId is not 0, get channels from other platforms
func GetChannelsByEidAndParams(eid int64, providerId int64, channelTypes []int) ([]Channel, error) {
	var channels []Channel
	var err error

	db := DB.Where("eid = ?", eid)

	if providerId != 0 {
		db = db.Where("provider_id = ?", providerId)
	} else {
		db = db.Where("provider_id = 0")
	}

	if len(channelTypes) > 0 {
		db = db.Where("type IN (?)", channelTypes)
	}

	err = db.Find(&channels).Error

	return channels, err
}

// GetFirstChannelByEidAndProviderId finds the first channel record by enterprise ID and provider ID
func GetFirstChannelByEidAndProviderId(eid int64, providerId int64) (*Channel, error) {
	var channel Channel
	err := DB.Where("eid = ? and provider_id = ?", eid, providerId).First(&channel).Error
	return &channel, err
}

func (channel *Channel) GetBaseURL() string {
	if channel.BaseURL == nil {
		return ""
	}
	return *channel.BaseURL
}

func (channel *Channel) LoadConfig() (oneapi_model.ChannelConfig, error) {
	var cfg oneapi_model.ChannelConfig
	if channel.Config == "" {
		return cfg, nil
	}
	err := json.Unmarshal([]byte(channel.Config), &cfg)
	if err != nil {
		return cfg, err
	}
	return cfg, nil
}

func (channel *Channel) GetModelMapping() map[string]string {
	if channel.ModelMapping == nil || *channel.ModelMapping == "" || *channel.ModelMapping == "{}" {
		return nil
	}
	modelMapping := make(map[string]string)
	err := json.Unmarshal([]byte(*channel.ModelMapping), &modelMapping)
	if err != nil {
		logger.SysError(fmt.Sprintf("failed to unmarshal model mapping for channel %d, error: %s", channel.ChannelID, err.Error()))
		return nil
	}
	return modelMapping
}

func (channel *Channel) UpdateResponseTime(responseTime int64) {
	err := DB.Model(channel).Select("response_time", "test_time").Updates(Channel{
		TestTime:     helper.GetTimestamp(),
		ResponseTime: int(responseTime),
	}).Error
	if err != nil {
		logger.SysError("failed to update response time: " + err.Error())
	}
}

func GetRandomChannel(eid int64, channelType int, modelName string) (*Channel, error) {
	var channels []Channel

	err := DB.Where("eid = ? AND type = ? AND status = ? AND models LIKE ?",
		eid, channelType, ChannelStatusEnabled, "%"+modelName+"%").
		Find(&channels).Error
	if err != nil {
		return nil, err
	}

	if len(channels) == 0 {
		return nil, fmt.Errorf("no available channel found")
	}

	var totalWeight uint = 0
	for _, channel := range channels {
		if channel.Weight != nil {
			totalWeight += *channel.Weight
		}
	}

	if totalWeight == 0 {
		return &channels[utils.GetRandomInt64(int64(len(channels)))], nil
	}

	randomWeight := utils.GetRandomInt64(int64(totalWeight))
	var currentWeight uint = 0
	for _, channel := range channels {
		if channel.Weight != nil {
			currentWeight += *channel.Weight
			if uint(randomWeight) < currentWeight {
				return &channel, nil
			}
		}
	}

	return &channels[0], nil
}

// CountAvailableChannels counts enabled channels matching the given eid, type, and model.
func CountAvailableChannels(eid int64, channelType int, modelName string) (int64, error) {
	var count int64
	err := DB.Model(&Channel{}).
		Where("eid = ? AND type = ? AND status = ? AND models LIKE ?",
			eid, channelType, ChannelStatusEnabled, "%"+modelName+"%").
		Count(&count).Error
	if err != nil {
		return 0, err
	}
	return count, nil
}

func GetApiType(channelType int) int {
	apiType := channeltype.ToAPIType(channelType)
	if channelType > 1000 {
		apiType = channelType
	}
	if IsOpenClawWSCompatibleChannelType(channelType) {
		return channelType
	}
	// Refactoring and modification
	switch channelType {
	case channeltype.FastGPT:
		return ChannelApiTypeFastGpt
	case ChannelApiTypeCustomOpenAI:
		return ChannelApiTypeCustomOpenAI
	case ChannelApiTypeOpenClaw:
		return ChannelApiTypeOpenClaw
	}

	return apiType
}

func GetFirstChannelByEidAndProviderType(eid int64, providerType int64, providerID int64) (*Channel, error) {
	var channel Channel
	err := DB.Where("eid = ? AND type = ? AND provider_id = ?", eid, providerType, providerID).First(&channel).Error
	if err != nil {
		return nil, err
	}
	return &channel, nil
}

// GetFirstAvailableChannelByEidAndProviderType gets the first available channel by enterprise ID and provider type
// This function prioritizes channels with provider_id > 0 (associated with specific providers)
// Falls back to provider_id = 0 (platform channels) for backward compatibility
func GetFirstAvailableChannelByEidAndProviderType(eid int64, providerType int64) (*Channel, error) {
	var channel Channel

	// First try to get channel with provider_id > 0 (specific provider)
	err := DB.Where("eid = ? AND type = ? AND provider_id > 0", eid, providerType).First(&channel).Error
	if err == nil {
		return &channel, nil
	}

	// Fallback to any channel of this type (backward compatibility)
	err = DB.Where("eid = ? AND type = ?", eid, providerType).First(&channel).Error
	if err != nil {
		return nil, err
	}
	return &channel, nil
}

func StandardizationBotId(botId string) string {
	if !strings.HasPrefix(botId, "bot-") && !strings.HasPrefix(botId, "workflow-") {
		return "bot-" + botId
	}
	return botId
}

func StandardizationBotIdByChannelType(botId string, channelType int) string {
	switch channelType {
	case ChannelApiDify, ChannelApi53AI, ChannelApiBailian, ChannelApiVolcengine, ChannelApiAppBuilder, ChannelApiYuanqi, ChannelApiTypeFastGpt, ChannelApiTypeMaxKB:
		return StandardizationBotId(botId)
	}
	return botId
}

func ProcessModelNames(models string, channelType int) string {
	modelArr := strings.Split(models, ",")
	if len(modelArr) == 0 {
		return ""
	}

	var newModels []string
	for _, modelName := range modelArr {
		newModels = append(newModels, StandardizationBotIdByChannelType(modelName, channelType))
	}

	return strings.Join(newModels, ",")
}

func (channel *Channel) GetAddModelString(model string) string {
	existingModels := make(map[string]bool)
	for _, m := range strings.Split(channel.Models, ",") {
		existingModels[m] = true
	}

	// 如果新模型不存在，则添加
	if !existingModels[model] {
		existingModels[model] = true
	}

	// 将map转换回切片
	var models []string
	for m := range existingModels {
		models = append(models, m)
	}
	return strings.Join(models, ",")
}

// UpdateChannelConfigOnly 更新渠道配置，但保留原有配置数据
func UpdateChannelConfigOnly(channelID int64, newConfig map[string]interface{}) error {
	// 获取当前渠道配置
	channel, err := GetChannelByID(channelID)
	if err != nil {
		return err
	}

	// 解析当前配置
	var currentConfig map[string]interface{}
	if channel.Config != "" {
		if err := json.Unmarshal([]byte(channel.Config), &currentConfig); err != nil {
			return err
		}
	} else {
		currentConfig = make(map[string]interface{})
	}

	// 合并配置
	for k, v := range newConfig {
		currentConfig[k] = v
	}

	// 序列化并更新
	updatedConfig, err := json.Marshal(currentConfig)
	if err != nil {
		return err
	}

	return DB.Model(&Channel{}).Where("channel_id = ?", channelID).Update("config", string(updatedConfig)).Error
}
