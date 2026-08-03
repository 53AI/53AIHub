package thinkingpolicy

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/53AI/53AIHub/common/logger"
)

type ThinkingConfig struct {
	Mode      string                 `json:"mode"`
	Parameter map[string]interface{} `json:"parameter,omitempty"`
}

type channelConfig struct {
	Thinking *ThinkingConfig `json:"thinking,omitempty"`
}

var allowedPaths = map[string]bool{
	"thinking.type":                   true,
	"thinking.enabled":                true,
	"enable_thinking":                 true,
	"reasoning_effort":                true,
	"thinking_budget":                 true,
	"max_reasoning_tokens":            true,
	"budget_tokens":                   true,
	"extra_body.thinking.type":        true,
	"extra_body.thinking.enabled":     true,
	"extra_body.enable_thinking":      true,
	"extra_body.reasoning_effort":     true,
	"extra_body.thinking_budget":      true,
	"extra_body.max_reasoning_tokens": true,
	"extra_body.budget_tokens":        true,
}

var autoRegistry = map[string]map[string]interface{}{
	"deepseek-v4":       {"thinking.type": "disabled"},
	"deepseek-v4-flash": {"thinking.type": "disabled"},
	// lazy: doubao-seed-2-0 通过 volcengine OpenAI 兼容 API，参数同 deepseek-v4
	"doubao-seed-2-0": {"thinking.type": "disabled"},
}

func ParseChannelThinkingConfig(channelConfigJSON string) *ThinkingConfig {
	if channelConfigJSON == "" {
		return nil
	}
	var cfg channelConfig
	if err := json.Unmarshal([]byte(channelConfigJSON), &cfg); err != nil {
		return nil
	}
	return cfg.Thinking
}

func ApplyDisableThinking(ctx context.Context, channelCfgJSON string, requestJSON []byte, requestModel string, actualModel string, disableThinking *bool, channelID int) ([]byte, bool, error) {
	if disableThinking == nil || !*disableThinking {
		logger.Debugf(ctx, "【思考策略】DisableThinking未启用 channel_id=%d request_model=%s actual_model=%s disable_thinking=%v",
			channelID, requestModel, actualModel, disableThinking)
		return requestJSON, false, nil
	}

	thinkingCfg := ParseChannelThinkingConfig(channelCfgJSON)
	if thinkingCfg == nil {
		logger.Debugf(ctx, "【思考策略】Channel无thinking配置，隐式auto兜底 channel_id=%d request_model=%s actual_model=%s channel_config=%s",
			channelID, requestModel, actualModel, truncate(channelCfgJSON, 200))
		thinkingCfg = &ThinkingConfig{Mode: "auto"}
	}

	var params map[string]interface{}
	var mode string

	switch thinkingCfg.Mode {
	case "auto":
		mode = "auto"
		key := strings.ToLower(strings.TrimSpace(actualModel))
		if adapter, ok := autoRegistry[key]; ok {
			params = adapter
			logger.Debugf(ctx, "【思考策略】auto命中 channel_id=%d request_model=%s actual_model=%s disable_thinking=true mode=auto decision=matched paths=%v",
				channelID, requestModel, actualModel, keys(params))
		} else {
			// 通用前缀匹配：registry key 是模型名前缀
			for regKey, regParams := range autoRegistry {
				if strings.HasPrefix(key, regKey) {
					params = regParams
					logger.Debugf(ctx, "【思考策略】auto前缀命中 channel_id=%d request_model=%s actual_model=%s reg_key=%s paths=%v",
						channelID, requestModel, actualModel, regKey, keys(params))
					break
				}
			}
			if params == nil {
				logger.Debugf(ctx, "【思考策略】auto未命中 channel_id=%d request_model=%s actual_model=%s disable_thinking=true mode=auto decision=unmatched",
					channelID, requestModel, actualModel)
				return requestJSON, false, nil
			}
		}
	case "custom":
		mode = "custom"
		if thinkingCfg.Parameter == nil || len(thinkingCfg.Parameter) == 0 {
			logger.Warnf(ctx, "【思考策略】custom缺少parameter channel_id=%d request_model=%s actual_model=%s disable_thinking=true mode=custom decision=missing_parameter",
				channelID, requestModel, actualModel)
			return requestJSON, false, nil
		}
		params = thinkingCfg.Parameter
		logger.Debugf(ctx, "【思考策略】custom命中 channel_id=%d request_model=%s actual_model=%s disable_thinking=true mode=custom paths=%v",
			channelID, requestModel, actualModel, keys(params))
	default:
		logger.Warnf(ctx, "【思考策略】未知模式 channel_id=%d request_model=%s actual_model=%s disable_thinking=true mode=%s",
			channelID, requestModel, actualModel, thinkingCfg.Mode)
		return requestJSON, false, nil
	}

	for path := range params {
		if !allowedPaths[path] {
			logger.Warnf(ctx, "【思考策略】路径不在白名单 channel_id=%d request_model=%s actual_model=%s mode=%s path=%s",
				channelID, requestModel, actualModel, mode, path)
			return requestJSON, false, fmt.Errorf("disallowed thinking parameter path: %s", path)
		}
	}

	var requestMap map[string]interface{}
	if err := json.Unmarshal(requestJSON, &requestMap); err != nil {
		logger.Warnf(ctx, "【思考策略】请求JSON解析失败 channel_id=%d request_model=%s actual_model=%s mode=%s err=%v",
			channelID, requestModel, actualModel, mode, err)
		return requestJSON, false, nil
	}

	for path, value := range params {
		setJSONPath(requestMap, path, value)
	}

	modified, err := json.Marshal(requestMap)
	if err != nil {
		logger.Warnf(ctx, "【思考策略】修改后JSON序列化失败 channel_id=%d request_model=%s actual_model=%s mode=%s err=%v",
			channelID, requestModel, actualModel, mode, err)
		return requestJSON, false, nil
	}
	return modified, true, nil
}

func ValidateThinkingConfig(channelConfigJSON string) error {
	if channelConfigJSON == "" {
		return nil
	}

	var cfg channelConfig
	if err := json.Unmarshal([]byte(channelConfigJSON), &cfg); err != nil {
		return nil
	}
	if cfg.Thinking == nil {
		return nil
	}

	switch cfg.Thinking.Mode {
	case "auto":
		if cfg.Thinking.Parameter != nil && len(cfg.Thinking.Parameter) > 0 {
			return fmt.Errorf("auto mode should not have parameter")
		}
		return nil
	case "custom":
		if cfg.Thinking.Parameter == nil || len(cfg.Thinking.Parameter) == 0 {
			return fmt.Errorf("custom mode requires parameter")
		}
		for path := range cfg.Thinking.Parameter {
			if !allowedPaths[path] {
				return fmt.Errorf("disallowed thinking parameter path: %s", path)
			}
		}
		return nil
	case "":
		return fmt.Errorf("thinking mode is required when thinking config is present")
	default:
		return fmt.Errorf("invalid thinking mode: %s", cfg.Thinking.Mode)
	}
}

func setJSONPath(obj map[string]interface{}, path string, value interface{}) {
	parts := strings.Split(path, ".")
	current := obj
	for i := 0; i < len(parts)-1; i++ {
		next, ok := current[parts[i]]
		if !ok {
			newMap := make(map[string]interface{})
			current[parts[i]] = newMap
			current = newMap
		} else {
			nextMap, ok := next.(map[string]interface{})
			if !ok {
				newMap := make(map[string]interface{})
				current[parts[i]] = newMap
				current = newMap
			} else {
				current = nextMap
			}
		}
	}
	current[parts[len(parts)-1]] = value
}

func keys(m map[string]interface{}) []string {
	if m == nil {
		return nil
	}
	result := make([]string, 0, len(m))
	for k := range m {
		result = append(result, k)
	}
	return result
}

func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}
