package custom_openai

import (
	"bytes"
	"encoding/json"
	"fmt"
)

const (
	APIFormatChatCompletions = "chat_completions"
	APIFormatResponses       = "responses"
)

// ModelConfig contains capabilities configured for one channel model.
type ModelConfig struct {
	UpstreamAPIFormat       string
	APIFormatConfigured     bool
	BaseModelID             string
	IncludeWebSearchSources bool
	Vision                  *bool
	EnabledTools            map[string]bool
	Raw                     map[string]json.RawMessage
}

// ParseModelConfig reads the capability settings for modelID. Older configs
// and configs without this model retain the Chat Completions behavior.
func ParseModelConfig(channelConfig, modelID string) (ModelConfig, error) {
	result := ModelConfig{
		UpstreamAPIFormat: APIFormatChatCompletions,
		EnabledTools:      map[string]bool{},
	}
	if channelConfig == "" {
		return result, nil
	}

	var root json.RawMessage
	if err := json.Unmarshal([]byte(channelConfig), &root); err != nil {
		return result, fmt.Errorf("解析渠道模型配置失败: %w", err)
	}
	root = bytes.TrimSpace(root)
	if len(root) == 0 {
		return result, fmt.Errorf("渠道模型配置不能为空")
	}
	var entries []json.RawMessage
	allowUnkeyedConfig := false
	switch root[0] {
	case '[':
		if err := json.Unmarshal(root, &entries); err != nil {
			return result, fmt.Errorf("模型配置必须是数组: %w", err)
		}
	case '{':
		var object map[string]json.RawMessage
		if err := json.Unmarshal(root, &object); err != nil {
			return result, fmt.Errorf("模型配置必须是对象: %w", err)
		}
		if rawModels, ok := object["models"]; ok {
			if err := json.Unmarshal(rawModels, &entries); err != nil {
				return result, fmt.Errorf("models 必须是数组: %w", err)
			}
		} else {
			entries = []json.RawMessage{root}
			_, hasModelID := object["model_id"]
			allowUnkeyedConfig = !hasModelID
		}
	default:
		return result, fmt.Errorf("渠道模型配置必须是对象或数组")
	}

	for _, entry := range entries {
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(entry, &fields); err != nil || fields == nil {
			return result, fmt.Errorf("模型配置项必须是对象")
		}
		var id string
		if rawID, ok := fields["model_id"]; ok {
			if err := json.Unmarshal(rawID, &id); err != nil {
				return result, fmt.Errorf("model_id 必须是字符串")
			}
		}
		if id != modelID && !(allowUnkeyedConfig && id == "") {
			continue
		}
		if err := applyModelCapabilities(&result, fields); err != nil {
			return result, err
		}
		result.Raw = fields
		break
	}
	return result, nil
}

// ValidateModelConfig validates capability values in every model entry.
func ValidateModelConfig(channelConfig string) error {
	if channelConfig == "" {
		return nil
	}
	var root json.RawMessage
	if err := json.Unmarshal([]byte(channelConfig), &root); err != nil {
		return fmt.Errorf("解析渠道模型配置失败: %w", err)
	}
	root = bytes.TrimSpace(root)
	if len(root) == 0 {
		return fmt.Errorf("渠道模型配置不能为空")
	}
	var entries []json.RawMessage
	switch root[0] {
	case '[':
		if err := json.Unmarshal(root, &entries); err != nil {
			return fmt.Errorf("模型配置必须是数组: %w", err)
		}
	case '{':
		var object map[string]json.RawMessage
		if err := json.Unmarshal(root, &object); err != nil {
			return fmt.Errorf("模型配置必须是对象: %w", err)
		}
		if rawModels, ok := object["models"]; ok {
			if err := json.Unmarshal(rawModels, &entries); err != nil {
				return fmt.Errorf("models 必须是数组: %w", err)
			}
		} else {
			entries = []json.RawMessage{root}
		}
	default:
		return fmt.Errorf("渠道模型配置必须是对象或数组")
	}
	for _, entry := range entries {
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(entry, &fields); err != nil || fields == nil {
			return fmt.Errorf("模型配置项必须是对象")
		}
		config := ModelConfig{UpstreamAPIFormat: APIFormatChatCompletions}
		if err := applyModelCapabilities(&config, fields); err != nil {
			return err
		}
		if config.EnabledTools["web_search"] && config.UpstreamAPIFormat != APIFormatResponses {
			return fmt.Errorf("enabled_tools 包含 web_search 时 upstream_api_format 必须为 %q", APIFormatResponses)
		}
	}
	return nil
}

func applyModelCapabilities(config *ModelConfig, fields map[string]json.RawMessage) error {
	if raw, ok := fields["upstream_api_format"]; ok {
		config.APIFormatConfigured = true
		if err := json.Unmarshal(raw, &config.UpstreamAPIFormat); err != nil {
			return fmt.Errorf("upstream_api_format 必须是字符串")
		}
		if config.UpstreamAPIFormat != APIFormatChatCompletions && config.UpstreamAPIFormat != APIFormatResponses {
			return fmt.Errorf("upstream_api_format 仅支持 %q 或 %q", APIFormatChatCompletions, APIFormatResponses)
		}
	}
	if raw, ok := fields["base_model_id"]; ok {
		if err := json.Unmarshal(raw, &config.BaseModelID); err != nil {
			return fmt.Errorf("base_model_id 必须是字符串")
		}
	}
	if raw, ok := fields["vision"]; ok {
		var vision bool
		if err := json.Unmarshal(raw, &vision); err != nil {
			return fmt.Errorf("vision 必须是布尔值")
		}
		config.Vision = &vision
	}
	if raw, ok := fields["enabled_tools"]; ok {
		var tools []string
		if err := json.Unmarshal(raw, &tools); err != nil {
			return fmt.Errorf("enabled_tools 必须是字符串数组")
		}
		for _, tool := range tools {
			if tool != "function" && tool != "web_search" {
				return fmt.Errorf("enabled_tools 包含不支持的工具 %q", tool)
			}
			if config.EnabledTools == nil {
				config.EnabledTools = map[string]bool{}
			}
			config.EnabledTools[tool] = true
		}
	}
	return nil
}
