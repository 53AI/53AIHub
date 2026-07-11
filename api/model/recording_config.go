package model

import (
	"encoding/json"
	"fmt"
)

type RecordingConfig struct {
	Enabled        bool   `json:"enabled"`
	ParserPlatform string `json:"parser_platform"`
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
		Enabled:        true,
		ParserPlatform: "",
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

func UpdateRecordingConfig(eid int64, enabled bool, parserPlatform string) error {
	config := RecordingConfig{
		Enabled:        enabled,
		ParserPlatform: parserPlatform,
	}
	value, err := json.Marshal(config)
	if err != nil {
		return fmt.Errorf("failed to marshal recording config: %w", err)
	}
	return UpdateOrCreateSetting(eid, SETTING_RECORDING_CONFIG, string(value), 0)
}

func PatchRecordingConfig(eid int64, enabled *bool, parserPlatform *string) error {
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
