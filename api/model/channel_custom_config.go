package model

import (
	"encoding/json"
	"fmt"
	"strings"
)

const vectorModelConfidenceKey = "vector_model_confidence"

const (
	ThresholdLevelHigh     = "high"
	ThresholdLevelBalanced = "balanced"
	ThresholdLevelLoose    = "loose"
)

// VectorModelThreshold 渠道自定义配置中的向量模型阈值项
type VectorModelThreshold struct {
	ModelName         string `json:"model_name"`
	ThresholdHigh     int    `json:"threshold_high"`
	ThresholdBalanced int    `json:"threshold_balanced"`
	ThresholdLoose    int    `json:"threshold_loose"`
}

// ChannelCustomConfig 渠道 custom_config 对象
type ChannelCustomConfig map[string]any

// ParseChannelCustomConfig 解析渠道 custom_config
func ParseChannelCustomConfig(existing string) (ChannelCustomConfig, error) {
	if existing == "" {
		return ChannelCustomConfig{}, nil
	}

	var obj map[string]any
	if err := json.Unmarshal([]byte(existing), &obj); err == nil {
		if obj == nil {
			obj = map[string]any{}
		}
		return ChannelCustomConfig(obj), nil
	}

	// 兼容旧的“裸数组”格式
	thresholds, err := ParseVectorModelThresholds(existing)
	if err != nil {
		return nil, err
	}
	return ChannelCustomConfig{
		vectorModelConfidenceKey: thresholds,
	}, nil
}

// ParseVectorModelThresholds 解析阈值数组，兼容对象和裸数组两种格式
func ParseVectorModelThresholds(existing string) ([]VectorModelThreshold, error) {
	if existing == "" {
		return []VectorModelThreshold{}, nil
	}

	var obj map[string]json.RawMessage
	if err := json.Unmarshal([]byte(existing), &obj); err == nil {
		if raw, ok := obj[vectorModelConfidenceKey]; ok {
			if len(raw) == 0 || string(raw) == "null" {
				return []VectorModelThreshold{}, nil
			}
			var thresholds []VectorModelThreshold
			if err := json.Unmarshal(raw, &thresholds); err != nil {
				return nil, fmt.Errorf("解析 %s 失败: %w", vectorModelConfidenceKey, err)
			}
			if thresholds == nil {
				thresholds = []VectorModelThreshold{}
			}
			return thresholds, nil
		}
		return []VectorModelThreshold{}, nil
	}

	var thresholds []VectorModelThreshold
	if err := json.Unmarshal([]byte(existing), &thresholds); err != nil {
		return nil, err
	}
	if thresholds == nil {
		thresholds = []VectorModelThreshold{}
	}
	return thresholds, nil
}

// UpsertVectorModelThreshold 在阈值数组中插入或更新某个模型
func UpsertVectorModelThreshold(existing string, modelName string, thresholdHigh, thresholdBalanced, thresholdLoose int) ([]VectorModelThreshold, error) {
	thresholds, err := ParseVectorModelThresholds(existing)
	if err != nil {
		return nil, err
	}

	replaced := false
	for i := range thresholds {
		if thresholds[i].ModelName == modelName {
			thresholds[i].ThresholdHigh = thresholdHigh
			thresholds[i].ThresholdBalanced = thresholdBalanced
			thresholds[i].ThresholdLoose = thresholdLoose
			replaced = true
			break
		}
	}
	if !replaced {
		thresholds = append(thresholds, VectorModelThreshold{
			ModelName:         modelName,
			ThresholdHigh:     thresholdHigh,
			ThresholdBalanced: thresholdBalanced,
			ThresholdLoose:    thresholdLoose,
		})
	}

	return thresholds, nil
}

// UpsertChannelVectorModelThreshold 更新渠道 custom_config 中的向量模型阈值字段，保留其他字段
func UpsertChannelVectorModelThreshold(existing string, modelName string, thresholdHigh, thresholdBalanced, thresholdLoose int) (ChannelCustomConfig, error) {
	cfg, err := ParseChannelCustomConfig(existing)
	if err != nil {
		return nil, err
	}

	thresholds, err := UpsertVectorModelThreshold(existing, modelName, thresholdHigh, thresholdBalanced, thresholdLoose)
	if err != nil {
		return nil, err
	}
	cfg[vectorModelConfidenceKey] = thresholds
	return cfg, nil
}

// MarshalChannelCustomConfig 序列化渠道 custom_config 对象
func MarshalChannelCustomConfig(cfg ChannelCustomConfig) (string, error) {
	if cfg == nil {
		cfg = ChannelCustomConfig{}
	}
	data, err := json.Marshal(cfg)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func normalizeThresholdLevel(level string) string {
	switch strings.ToLower(strings.TrimSpace(level)) {
	case ThresholdLevelBalanced:
		return ThresholdLevelBalanced
	case ThresholdLevelLoose:
		return ThresholdLevelLoose
	default:
		return ThresholdLevelHigh
	}
}

func thresholdValueByLevel(threshold VectorModelThreshold, level string) int {
	switch normalizeThresholdLevel(level) {
	case ThresholdLevelBalanced:
		if threshold.ThresholdBalanced > 0 {
			return threshold.ThresholdBalanced
		}
	case ThresholdLevelLoose:
		if threshold.ThresholdLoose > 0 {
			return threshold.ThresholdLoose
		}
	}
	if threshold.ThresholdHigh > 0 {
		return threshold.ThresholdHigh
	}
	if threshold.ThresholdBalanced > 0 {
		return threshold.ThresholdBalanced
	}
	return threshold.ThresholdLoose
}

// FindVectorModelThreshold 从渠道 custom_config 中查找某个模型的阈值
func FindVectorModelThreshold(existing string, modelName string, level string) (int, bool, error) {
	thresholds, err := ParseVectorModelThresholds(existing)
	if err != nil {
		return 0, false, err
	}
	for _, threshold := range thresholds {
		if threshold.ModelName == modelName {
			return thresholdValueByLevel(threshold, level), true, nil
		}
	}
	return 0, false, nil
}

// FindVectorModelThresholdHigh 查找指定模型的 threshold_high 原始值。
func FindVectorModelThresholdHigh(existing string, modelName string) (int, bool, error) {
	thresholds, err := ParseVectorModelThresholds(existing)
	if err != nil {
		return 0, false, err
	}
	for _, threshold := range thresholds {
		if threshold.ModelName == modelName {
			return threshold.ThresholdHigh, true, nil
		}
	}
	return 0, false, nil
}
