package model

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/53AI/53AIHub/common/utils/hashids"
	v2model "github.com/53AI/53AIHub/rag-pipeline-v2/model"
)

// NormalizeGraphPipelineProfile 规范化图谱管线 profile：
//   - 必须包含 graph_generation 步骤；
//   - 步骤 config.enabled 缺失时补 true（管线开关默认开启，兼容旧数据 run_mode=auto 种子）。
//
// 图谱管线不再使用 run_mode（skip/manual/auto）控制执行，统一由 config.enabled 开关控制；
// 智能匹配为服务端自动行为：未配置 graph_template_id 时自动智能匹配选模板（无需传 enable_smart_match 参数）。
func NormalizeGraphPipelineProfile(raw string) (string, error) {
	if strings.TrimSpace(raw) == "" {
		return "", errors.New("图谱管线配置不能为空")
	}
	var profile v2model.RuntimeProfile
	if err := json.Unmarshal([]byte(raw), &profile); err != nil {
		return "", fmt.Errorf("解析图谱管线配置失败: %w", err)
	}
	stepIdx := -1
	for i, s := range profile.Steps {
		if s.StepKey == "graph_generation" {
			stepIdx = i
			break
		}
	}
	if stepIdx < 0 {
		return "", errors.New("图谱管线必须包含 graph_generation 步骤")
	}

	cfg, err := parseGraphStepConfig(profile.Steps[stepIdx].Config)
	if err != nil {
		return "", err
	}

	// enabled 缺失 → 补 true
	if _, ok := cfg["enabled"]; !ok {
		cfg["enabled"] = json.RawMessage("true")
	}

	configBytes, err := json.Marshal(cfg)
	if err != nil {
		return "", fmt.Errorf("序列化图谱生成步骤配置失败: %w", err)
	}
	profile.Steps[stepIdx].Config = configBytes

	out, err := json.Marshal(profile)
	if err != nil {
		return "", fmt.Errorf("序列化图谱管线配置失败: %w", err)
	}
	return string(out), nil
}

// GraphPipelineTemplateIDFromProfile 提取图谱管线 profile 中 graph_generation 步骤的模板ID（0=未配置模板）。
// 支持 hashid 字符串或 int 两种格式。
func GraphPipelineTemplateIDFromProfile(raw string) (int64, error) {
	if strings.TrimSpace(raw) == "" {
		return 0, errors.New("图谱管线配置不能为空")
	}
	var profile v2model.RuntimeProfile
	if err := json.Unmarshal([]byte(raw), &profile); err != nil {
		return 0, fmt.Errorf("解析图谱管线配置失败: %w", err)
	}
	for _, s := range profile.Steps {
		if s.StepKey != "graph_generation" {
			continue
		}
		if len(s.Config) == 0 {
			return 0, nil
		}
		var cfg struct {
			GraphTemplateID json.RawMessage `json:"graph_template_id"`
		}
		if err := json.Unmarshal(s.Config, &cfg); err != nil {
			return 0, fmt.Errorf("解析图谱生成步骤配置失败: %w", err)
		}
		if len(cfg.GraphTemplateID) == 0 || string(cfg.GraphTemplateID) == "null" {
			return 0, nil
		}
		var strID string
		if err := json.Unmarshal(cfg.GraphTemplateID, &strID); err == nil {
			strID = strings.TrimSpace(strID)
			if strID == "" {
				return 0, nil
			}
			id, err := hashids.TryParseID(strID)
			if err != nil {
				return 0, fmt.Errorf("graph_template_id 格式无效: %v", err)
			}
			return id, nil
		}
		var numID int64
		if err := json.Unmarshal(cfg.GraphTemplateID, &numID); err == nil {
			return numID, nil
		}
		return 0, fmt.Errorf("graph_template_id 格式无效")
	}
	return 0, nil
}

// parseGraphStepConfig 解析图谱生成步骤 config 为 map（空配置返回空 map）
func parseGraphStepConfig(raw json.RawMessage) (map[string]json.RawMessage, error) {
	cfg := map[string]json.RawMessage{}
	if len(raw) == 0 {
		return cfg, nil
	}
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return nil, fmt.Errorf("解析图谱生成步骤配置失败: %w", err)
	}
	if cfg == nil {
		cfg = map[string]json.RawMessage{}
	}
	return cfg, nil
}
