package model

import (
	"encoding/json"
	"errors"
	"fmt"

	"github.com/53AI/53AIHub/common/utils/hashids"
	"gorm.io/gorm"
)

type Setting struct {
	SettingID int64  `json:"setting_id" gorm:"primaryKey;autoIncrement"`
	Eid       int64  `json:"eid" gorm:"not null;index" example:"1"`
	LibraryID int64  `json:"library_id" gorm:"not null;default:0;index" example:"0"`
	Key       string `json:"key" gorm:"column:key;not null;index" example:"setting_key"`
	Value     string `json:"value" gorm:"not null" example:"setting_value"`
	BaseModel
}

type SettingKey string

const (
	ThirdPartyStatisticHeader SettingKey = "third_party_statistic_header"
	ThirdPartyStatisticCss    SettingKey = "third_party_statistic_css"
	EnterpriseInfo            SettingKey = "enterprise_info"                // 企业信息（包含服务协议、隐私政策和AI隐私政策URL）
)

const (
	DefaultPromptLinks string = "default_prompt_links" // 添加默认网站配置的 key
)

const (
	SETTING_DOCUMENT_SETTING         = "document_setting"
	SETTING_DOCUMENT_JS_SDK_SETTING  = "document_js_sdk_setting"  // 添加文档设置（前端解析器，包含预览和编辑）
	SETTING_KM_AGENTS_SETTING        = "km_agents_setting"        // KM项目各功能智能体设置
	SETTING_KM_KNOWLEDGE_MAP_SETTING = "km_knowledge_map_setting" // KM 知识地图设置（是否启用、是否自动生成）
	SETTING_KM_FEEDBACK_CONFIG       = "km_feedback_config"       // KM 知识地图反馈配置
	SETTING_WORKAI_FEEDBACK_CONFIG   = "workai_feedback_config"   // 工作AI反馈配置
	SETTING_CHAT_FEEDBACK_CONFIG     = "chat_feedback_config"     // 对话型反馈配置
	SETTING_WORKFLOW_FEEDBACK_CONFIG = "workflow_feedback_config" // 工作流型反馈配置
	SETTING_DOCUMENT_APPLICATION     = "document_application"     // 文档应用设置
	SETTING_RECORDING_CONFIG         = "recording_config"         // 录音配置
)

const (
	FeedbackConfigKey = "message_feedback_config" // 反馈配置
)

type SettingGroup []SettingKey

var ThirdPartyStatisticGroup SettingGroup = []SettingKey{
	ThirdPartyStatisticHeader,
	ThirdPartyStatisticCss,
}

var settingGroupMap = map[string]SettingGroup{
	"third_party_statistic": ThirdPartyStatisticGroup,
}

func GetSettingGroupByName(group_name string) (SettingGroup, bool) {
	group, exists := settingGroupMap[group_name]
	return group, exists
}

func CreateSetting(setting *Setting) error {
	return DB.Create(setting).Error
}

func DeleteSettingByID(id int64) error {
	return DB.Where("setting_id = ?", id).Delete(&Setting{}).Error
}

func UpdateSetting(setting *Setting) error {
	return DB.Model(setting).
		Select("library_id", "key", "value", "updated_time").
		Updates(setting).Error
}

func GetSettingByID(id int64) (*Setting, error) {
	var setting Setting
	result := DB.Where("setting_id = ?", id).First(&setting)
	if result.Error != nil {
		return nil, result.Error
	}
	return &setting, nil
}

func GetSettingsByEid(eid int64) ([]Setting, error) {
	var settings []Setting
	if err := DB.Where("eid =?", eid).Order("created_time DESC").Find(&settings).Error; err != nil {
		return nil, err
	}
	return settings, nil
}

// GetSettingsByKey retrieves all settings for a specific enterprise that match a key
func GetSettingsByKey(eid int64, key string) ([]Setting, error) {
	var settings []Setting
	if err := DB.Where(map[string]interface{}{"eid": eid, "key": key}).Order("created_time DESC").Find(&settings).Error; err != nil {
		return nil, err
	}
	return settings, nil
}

// GetSettingsBySettingsGroup retrieves all settings for a specific enterprise and group
func GetSettingsBySettingsGroup(eid int64, group_name string) ([]Setting, error) {
	group, ok := GetSettingGroupByName(group_name)
	if !ok {
		return nil, errors.New("setting group not exist")
	}
	var settings []Setting

	// 转换 keys
	keys := make([]string, len(group))
	for i, k := range group {
		keys[i] = string(k)
	}

	// 修改重点：
	// 1. Where("eid = ?", eid) 保持不变
	// 2. map[string]interface{}{"key": keys} 让 GORM 自动处理 "key" 的转义和 "IN" 逻辑
	if err := DB.Where("eid = ?", eid).
		Where(map[string]interface{}{"key": keys}).
		Order("created_time DESC").
		Find(&settings).Error; err != nil {
		return nil, err
	}

	return settings, nil
}

func GetSettingByEidAndKey(eid int64, key string) (*Setting, error) {
	var setting Setting
	result := DB.Where(map[string]interface{}{"eid": eid, "library_id": 0, "key": key}).First(&setting)
	if result.Error != nil {
		if result.Error.Error() == "record not found" {
			return nil, nil
		}
		return nil, result.Error
	}
	return &setting, nil
}

func UpdateOrCreateSetting(eid int64, key, value string, libraryID int64) error {
	setting, err := GetSettingByEidAndKey(eid, key)
	if err != nil {
		return err
	}

	if setting != nil {
		// 更新现有设置
		setting.Value = value
		return UpdateSetting(setting)
	} else {
		// 创建新设置
		newSetting := &Setting{
			Eid:       eid,
			Key:       key,
			Value:     value,
			LibraryID: libraryID,
		}
		return CreateSetting(newSetting)
	}
}

func GetSettingByEidAndLibraryAndKey(eid, libraryID int64, key string) (*Setting, error) {
	var setting Setting
	result := DB.Where(map[string]interface{}{"eid": eid, "library_id": libraryID, "key": key}).First(&setting)
	if result.Error != nil {
		if result.Error.Error() == "record not found" {
			return GetSettingByEidAndKey(eid, key)
		}
		return nil, result.Error
	}
	return &setting, nil
}

// 添加解析 JSON 的辅助函数
func GetDefaultPromptLinks(eid int64) ([]AILinkInfo, error) {
	var setting Setting
	err := DB.Where(map[string]interface{}{"eid": eid, "key": DefaultPromptLinks}).First(&setting).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			// 如果记录未找到，从 GetDefaultGroupData 中提取数据
			defaultGroups := GetDefaultGroupData()

			// 定义需要的链接名称，并存储到 map 中
			requiredLinkNames := map[string]bool{
				"豆包":       true,
				"腾讯元宝":     true,
				"百度AI+":    true,
				"ChatGPT":  true,
				"Kimi":     true,
				"DeekSeek": true,
			}

			// 提取需要的链接数据
			var defaultLinks []AILinkInfo
			for _, group := range defaultGroups {
				for _, link := range group.Links {
					if requiredLinkNames[link.Name] {
						defaultLinks = append(defaultLinks, link)
					}
				}
			}
			data, _ := json.Marshal(defaultLinks)
			setting = Setting{
				Eid:   eid,
				Key:   DefaultPromptLinks,
				Value: string(data),
			}
			if err := CreateSetting(&setting); err != nil {
				return nil, err
			}
			// 重新从数据库中获取设置
			err = DB.Where(map[string]interface{}{"eid": eid, "key": DefaultPromptLinks}).First(&setting).Error
			if err != nil {
				return nil, err
			}
		}
	}
	// 还需要把setting.eid传入links中
	var links []AILinkInfo
	if err := json.Unmarshal([]byte(setting.Value), &links); err != nil {
		return nil, err
	}
	return links, nil
}

// KmAgentsSetting KM项目各功能智能体设置
type KmAgentsSetting struct {
	DefaultAIQA string `json:"default_ai_qa_agent_id"` // 默认AI问答智能体类型
	DocumentQA  string `json:"document_qa_agent_id"`   // 文档问答智能体类型
}

// KmKnowledgeMapSetting KM 知识地图设置
type KmKnowledgeMapSetting struct {
	Enabled      bool `json:"enabled"`       // 是否启用知识地图
	AutoGenerate bool `json:"auto_generate"` // 是否自动生成知识地图
}

// ValidateOrCreateKmAgentsSetting 验证或创建KM智能体设置
func ValidateOrCreateKmAgentsSetting(eid int64) (*KmAgentsSetting, error) {
	setting, err := GetSettingByEidAndKey(eid, SETTING_KM_AGENTS_SETTING)
	if err != nil {
		return nil, fmt.Errorf("failed to get km agents setting: %w", err)
	}

	if setting != nil {
		// 解析现有的设置
		var kmAgentsSetting KmAgentsSetting
		if err := json.Unmarshal([]byte(setting.Value), &kmAgentsSetting); err != nil {
			return nil, fmt.Errorf("failed to parse km agents setting: %w", err)
		}
		return &kmAgentsSetting, nil
	}

	// 创建默认设置
	defaultSetting := &KmAgentsSetting{
		DefaultAIQA: "",
		DocumentQA:  "",
	}

	// 序列化设置
	value, err := json.Marshal(defaultSetting)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal default km agents setting: %w", err)
	}

	// 创建数据库记录
	newSetting := &Setting{
		Eid:       eid,
		LibraryID: 0,
		Key:       SETTING_KM_AGENTS_SETTING,
		Value:     string(value),
	}

	if err := CreateSetting(newSetting); err != nil {
		return nil, fmt.Errorf("failed to create km agents setting: %w", err)
	}

	return defaultSetting, nil
}

// GetKmAgentsSetting 获取KM智能体设置
func GetKmAgentsSetting(eid int64) (*KmAgentsSetting, error) {
	setting, err := GetSettingByEidAndKey(eid, SETTING_KM_AGENTS_SETTING)
	if err != nil {
		return nil, fmt.Errorf("failed to get km agents setting: %w", err)
	}

	if setting == nil {
		return nil, fmt.Errorf("km agents setting not found for eid %d", eid)
	}

	var kmAgentsSetting KmAgentsSetting
	if err := json.Unmarshal([]byte(setting.Value), &kmAgentsSetting); err != nil {
		return nil, fmt.Errorf("failed to parse km agents setting: %w", err)
	}

	return &kmAgentsSetting, nil
}

// GetDefaultAIQAAgentID 获取默认AI问答智能体ID
func (s *KmAgentsSetting) GetDefaultAIQAAgentID() (int64, error) {
	if s.DefaultAIQA == "" {
		return 0, fmt.Errorf("default AI QA agent ID is empty")
	}

	return hashids.TryParseID(s.DefaultAIQA)
}

// GetDocumentQAAgentID 获取文档问答智能体ID
func (s *KmAgentsSetting) GetDocumentQAAgentID() (int64, error) {
	if s.DocumentQA == "" {
		return 0, fmt.Errorf("document QA agent ID is empty")
	}

	return hashids.TryParseID(s.DocumentQA)
}

func ValidateOrCreateKmKnowledgeMapSetting(eid int64) (*KmKnowledgeMapSetting, error) {
	setting, err := GetSettingByEidAndKey(eid, SETTING_KM_KNOWLEDGE_MAP_SETTING)
	if err != nil {
		return nil, fmt.Errorf("failed to get km knowledge map setting: %w", err)
	}

	if setting != nil {
		var kmKnowledgeMapSetting KmKnowledgeMapSetting
		if err := json.Unmarshal([]byte(setting.Value), &kmKnowledgeMapSetting); err != nil {
			return nil, fmt.Errorf("failed to parse km knowledge map setting: %w", err)
		}
		return &kmKnowledgeMapSetting, nil
	}

	defaultSetting := &KmKnowledgeMapSetting{
		Enabled:      false,
		AutoGenerate: false,
	}

	value, err := json.Marshal(defaultSetting)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal default km knowledge map setting: %w", err)
	}

	newSetting := &Setting{
		Eid:       eid,
		LibraryID: 0,
		Key:       SETTING_KM_KNOWLEDGE_MAP_SETTING,
		Value:     string(value),
	}

	if err := CreateSetting(newSetting); err != nil {
		return nil, fmt.Errorf("failed to create km knowledge map setting: %w", err)
	}

	return defaultSetting, nil
}

func GetKmKnowledgeMapSetting(eid int64) (*KmKnowledgeMapSetting, error) {
	setting, err := GetSettingByEidAndKey(eid, SETTING_KM_KNOWLEDGE_MAP_SETTING)
	if err != nil {
		return nil, fmt.Errorf("failed to get km knowledge map setting: %w", err)
	}

	if setting == nil {
		return nil, fmt.Errorf("km knowledge map setting not found for eid %d", eid)
	}

	var kmKnowledgeMapSetting KmKnowledgeMapSetting
	if err := json.Unmarshal([]byte(setting.Value), &kmKnowledgeMapSetting); err != nil {
		return nil, fmt.Errorf("failed to parse km knowledge map setting: %w", err)
	}

	return &kmKnowledgeMapSetting, nil
}
