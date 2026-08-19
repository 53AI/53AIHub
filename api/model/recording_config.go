package model

import (
	"encoding/json"
	"fmt"
)

type MemoryExtractionConfig struct {
	Enabled bool     `json:"enabled"`
	Types   []string `json:"types"`
}

// IsEffectivelyEnabled 判断历史记忆是否有效启用。
// enabled=true 但未选择任何实体类型时，等同于未启用。
func (m *MemoryExtractionConfig) IsEffectivelyEnabled() bool {
	return m != nil && m.Enabled && len(m.Types) > 0
}

type RecordingConfig struct {
	Enabled                 bool                    `json:"enabled"`
	ParserPlatform          string                  `json:"parser_platform"`
	VoiceModelID            int64                   `json:"voice_model_id"`
	VoiceModelName          string                  `json:"voice_model_name"`
	InferenceModelID        int64                   `json:"inference_model_id"`        // 注意：存储的是 channel_id，不是 model_id
	InferenceModelName      string                  `json:"inference_model_name"`      // 注意：存储的是 channel_name，不是 model_name
	RecordingAgentEnabled   bool                    `json:"recording_agent_enabled"`   // 是否启用录音应用（agent_usage=5）
	MultiPerspectiveEnabled bool                    `json:"multi_perspective_enabled"` // 是否允许未指定视角时由纪要自动判断
	MemoryExtraction        *MemoryExtractionConfig `json:"memory_extraction,omitempty"`
	// InsightRegenerateEnabled 企业级开关：是否允许重新生成洞察。nil 表示允许（默认，保持存量行为不变）。
	InsightRegenerateEnabled *bool `json:"insight_regenerate_enabled,omitempty"`
}

func ValidateOrCreateRecordingConfig(eid int64) (*RecordingConfig, error) {
	setting, err := GetSettingByEidAndKey(eid, SETTING_RECORDING_CONFIG)
	if err != nil {
		return nil, fmt.Errorf("failed to get recording config: %w", err)
	}

	if setting != nil {
		var config RecordingConfig
		if err := json.Unmarshal([]byte(setting.Value), &config); err != nil {
			return nil, fmt.Errorf("failed to parse recording config: %w", err)
		}
		return &config, nil
	}

	defaultConfig := &RecordingConfig{
		Enabled:                 true,
		ParserPlatform:          "",
		VoiceModelID:            0,
		VoiceModelName:          "",
		InferenceModelID:        0,
		InferenceModelName:      "",
		RecordingAgentEnabled:   false,
		MultiPerspectiveEnabled: false,
		MemoryExtraction: &MemoryExtractionConfig{
			Enabled: true,
			Types:   []string{EntityTypePerson, EntityTypeMatter, EntityTypeRisk, EntityTypePrinciple},
		},
	}

	value, err := json.Marshal(defaultConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal default recording config: %w", err)
	}

	newSetting := &Setting{
		Eid:       eid,
		LibraryID: 0,
		Key:       SETTING_RECORDING_CONFIG,
		Value:     string(value),
	}

	if err := CreateSetting(newSetting); err != nil {
		return nil, fmt.Errorf("failed to create recording config: %w", err)
	}

	return defaultConfig, nil
}

func UpdateRecordingConfig(eid int64, enabled bool, parserPlatform string, voiceModelID int64, voiceModelName string, inferenceModelID int64, inferenceModelName string, recordingAgentEnabled bool, multiPerspectiveEnabled bool, memoryExtraction *MemoryExtractionConfig, insightRegenerateEnabled *bool) error {
	config := RecordingConfig{
		Enabled:                  enabled,
		ParserPlatform:           parserPlatform,
		VoiceModelID:             voiceModelID,
		VoiceModelName:           voiceModelName,
		InferenceModelID:         inferenceModelID,
		InferenceModelName:       inferenceModelName,
		RecordingAgentEnabled:    recordingAgentEnabled,
		MultiPerspectiveEnabled:  multiPerspectiveEnabled,
		MemoryExtraction:         memoryExtraction,
		InsightRegenerateEnabled: insightRegenerateEnabled,
	}
	value, err := json.Marshal(config)
	if err != nil {
		return fmt.Errorf("failed to marshal recording config: %w", err)
	}
	return UpdateOrCreateSetting(eid, SETTING_RECORDING_CONFIG, string(value), 0)
}

func PatchRecordingConfig(eid int64, enabled *bool, parserPlatform *string, voiceModelID *int64, voiceModelName *string, inferenceModelID *int64, inferenceModelName *string, recordingAgentEnabled *bool, multiPerspectiveEnabled *bool, memoryExtraction *MemoryExtractionConfig, insightRegenerateEnabled *bool) error {
	current, err := ValidateOrCreateRecordingConfig(eid)
	if err != nil {
		return fmt.Errorf("获取当前配置失败: %w", err)
	}
	if enabled != nil {
		current.Enabled = *enabled
	}
	if parserPlatform != nil {
		current.ParserPlatform = *parserPlatform
	}
	if voiceModelID != nil {
		current.VoiceModelID = *voiceModelID
	}
	if voiceModelName != nil {
		current.VoiceModelName = *voiceModelName
	}
	if inferenceModelID != nil {
		current.InferenceModelID = *inferenceModelID
	}
	if inferenceModelName != nil {
		current.InferenceModelName = *inferenceModelName
	}
	if recordingAgentEnabled != nil {
		current.RecordingAgentEnabled = *recordingAgentEnabled
	}
	if multiPerspectiveEnabled != nil {
		current.MultiPerspectiveEnabled = *multiPerspectiveEnabled
	}
	if memoryExtraction != nil {
		current.MemoryExtraction = memoryExtraction
	}
	if insightRegenerateEnabled != nil {
		current.InsightRegenerateEnabled = insightRegenerateEnabled
	}
	value, err := json.Marshal(current)
	if err != nil {
		return fmt.Errorf("failed to marshal recording config: %w", err)
	}
	return UpdateOrCreateSetting(eid, SETTING_RECORDING_CONFIG, string(value), 0)
}

func IsRecordingEnabled(eid int64) (bool, error) {
	config, err := ValidateOrCreateRecordingConfig(eid)
	if err != nil {
		return false, err
	}
	return config.Enabled, nil
}

// IsInsightRegenerateEnabled 判断企业是否允许重新生成洞察。
// 未配置（nil）时默认允许，保持存量行为不变；显式 false 才关闭。
func IsInsightRegenerateEnabled(eid int64) bool {
	config, err := ValidateOrCreateRecordingConfig(eid)
	if err != nil || config == nil || config.InsightRegenerateEnabled == nil {
		return true
	}
	return *config.InsightRegenerateEnabled
}

// IsRecordingMemoryExtractionEnabled 判断录音文件的记忆抽取是否有效启用。
// 用于实体抽取等场景：记忆关闭时跳过所有实体抽取（包括元信息实体）。
// 返回 true 表示记忆开启且可选类型非空，false 表示记忆关闭或无条件应跳过。
func IsRecordingMemoryExtractionEnabled(eid int64) bool {
	config, err := ValidateOrCreateRecordingConfig(eid)
	if err != nil || config == nil {
		return false
	}
	memCfg := config.MemoryExtraction
	if memCfg == nil {
		memCfg = &MemoryExtractionConfig{Enabled: true, Types: []string{EntityTypePerson, EntityTypeMatter, EntityTypeRisk, EntityTypePrinciple}}
	}
	return memCfg.IsEffectivelyEnabled()
}

// IsRecordingMemoryExtractionTypeEnabled 判断录音文件记忆抽取是否有效启用且包含指定实体类型。
// 用于元信息实体抽取（Document 类型）等场景：记忆关闭或配置类型中不包含该类型时均不执行。
func IsRecordingMemoryExtractionTypeEnabled(eid int64, entityType string) bool {
	config, err := ValidateOrCreateRecordingConfig(eid)
	if err != nil || config == nil || config.MemoryExtraction == nil {
		return false
	}
	if !config.MemoryExtraction.Enabled {
		return false
	}
	for _, t := range config.MemoryExtraction.Types {
		if t == entityType {
			return true
		}
	}
	return false
}

// ContainsString 检查字符串切片中是否包含指定字符串。
func ContainsString(slice []string, target string) bool {
	for _, s := range slice {
		if s == target {
			return true
		}
	}
	return false
}
