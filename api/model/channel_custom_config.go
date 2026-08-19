package model

import (
	"encoding/json"
	"fmt"
	"strings"
	"github.com/songquanpeng/one-api/relay/channeltype"
)

const vectorModelConfidenceKey = "vector_model_confidence"

// CustomConfig 中 model_type 字段的值
const (
	ModelTypeText      = 1 // 推理（文本生成）
	ModelTypeEmbedding = 2 // 向量（Embedding）
	ModelTypeRerank    = 3 // 重排（Rerank）
	ModelTypeVoice     = 4 // 语音（ASR/STT）
)

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

// IsVoiceModelChannel 判断渠道是否为语音模型渠道。
//
// 支持两类语音渠道：
//   - 阿里百炼（channeltype.Ali = 17）：voice_models 标识，workspace_id 校验（DashScope 语义）
//   - OpenAI 兼容语音渠道（ChannelApiTypeCustomOpenAI = 1012）：custom_config.voice_models 标识，
//     无 workspace_id，走 /v1/audio/transcriptions multipart 转写
//
// 判定唯一依据：custom_config.voice_models 非空（model_type 仅 UI 展示，不参与判定）。
func IsVoiceModelChannel(channel *Channel) bool {
	if channel == nil {
		return false
	}
	return IsOpenAIAudioChannel(channel) || (channel.Type == channeltype.Ali && hasVoiceModels(channel))
}

// IsOpenAIAudioChannel 判断渠道是否为 OpenAI 兼容语音转写渠道（type=1012 + voice_models 配置）。
func IsOpenAIAudioChannel(channel *Channel) bool {
	if channel == nil || channel.Type != ChannelApiTypeCustomOpenAI {
		return false
	}
	return hasVoiceModels(channel)
}

// hasVoiceModels 检查 custom_config 是否含非空 voice_models。
func hasVoiceModels(channel *Channel) bool {
	if channel == nil {
		return false
	}
	cfg, err := ParseChannelCustomConfig(channel.CustomConfig)
	if err != nil {
		return false
	}
	vms, ok := cfg["voice_models"]
	if !ok {
		return false
	}
	vmMap, ok := vms.(map[string]interface{})
	return ok && len(vmMap) > 0
}

// IsModelInChannelModels 校验 modelName 是否在 channel.Models（逗号分隔）中
func IsModelInChannelModels(modelName, channelModels string) bool {
	if channelModels == "" {
		return false
	}
	for _, m := range strings.Split(channelModels, ",") {
		if strings.TrimSpace(m) == modelName {
			return true
		}
	}
	return false
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
