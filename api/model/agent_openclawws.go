package model

import (
	"encoding/json"
	"fmt"
	"strings"
)

const openClawAppSecretKey = "openclaw_app_secret"
const openClawCodexRunnerCommand = "codex-app-server"
const openClawWSModelName = "openclaw-ws"

var openClawCompatibleAgentTypes = map[string]struct{}{
	"openclaw": {},
	"qclaw":    {},
	"codex":    {},
	"manus":    {},
}

var openClawCompatibleKindChannelTypes = map[string]int{
	"openclaw": ChannelApiTypeOpenClawWS,
	"qclaw":    ChannelApiTypeQClawWS,
	"codex":    ChannelApiTypeCodexWS,
	"manus":    ChannelApiTypeManusWS,
}

var openClawCompatibleChannelTypeKinds = map[int]string{
	ChannelApiTypeOpenClawWS: "openclaw",
	ChannelApiTypeQClawWS:    "qclaw",
	ChannelApiTypeCodexWS:    "codex",
	ChannelApiTypeManusWS:    "manus",
}

func IsOpenClawWSCompatibleChannelType(channelType int) bool {
	_, ok := openClawCompatibleChannelTypeKinds[channelType]
	return ok
}

func ResolveOpenClawCompatibleKindFromChannelType(channelType int) string {
	return openClawCompatibleChannelTypeKinds[channelType]
}

func ResolveOpenClawCompatibleChannelType(kind string) int {
	normalizedKind := normalizeOpenClawCompatibleKind(kind)
	if normalizedKind == "" {
		return ChannelApiTypeOpenClawWS
	}
	if channelType, ok := openClawCompatibleKindChannelTypes[normalizedKind]; ok {
		return channelType
	}
	return ChannelApiTypeOpenClawWS
}

// MergeOpenClawCustomConfig merges OpenClawWS custom_config values while preserving
// the OpenClawWS secret semantics used by create/update/reset flows.
//
// Rules:
// - existingConfig is treated as the stored config before the update.
// - incomingConfig is treated as the config submitted by the caller.
// - incoming fields override existing fields.
// - openclaw_app_secret is preserved from incoming first, then existing.
// - when generateIfMissing is true and no secret is present, a new secret is generated.
func MergeOpenClawCustomConfig(existingConfig, incomingConfig string, generateIfMissing bool) (string, error) {
	return mergeOpenClawCustomConfigWithDefaultKind(existingConfig, incomingConfig, generateIfMissing, "")
}

func MergeOpenClawCustomConfigForChannelType(existingConfig, incomingConfig string, generateIfMissing bool, channelType int) (string, error) {
	return mergeOpenClawCustomConfigWithDefaultKind(
		existingConfig,
		incomingConfig,
		generateIfMissing,
		ResolveOpenClawCompatibleKindFromChannelType(channelType),
	)
}

func mergeOpenClawCustomConfigWithDefaultKind(existingConfig, incomingConfig string, generateIfMissing bool, defaultKind string) (string, error) {
	merged := make(map[string]interface{})

	existingMap, err := parseOpenClawCustomConfig(existingConfig)
	if err != nil {
		return "", fmt.Errorf("parse existing custom_config: %w", err)
	}
	for key, value := range existingMap {
		merged[key] = value
	}

	incomingMap, err := parseOpenClawCustomConfig(incomingConfig)
	if err != nil {
		return "", fmt.Errorf("parse incoming custom_config: %w", err)
	}
	for key, value := range incomingMap {
		merged[key] = value
	}

	if secret, ok := openClawSecretFromMap(incomingMap); ok {
		merged[openClawAppSecretKey] = secret
	} else if secret, ok := openClawSecretFromMap(existingMap); ok {
		merged[openClawAppSecretKey] = secret
	} else if generateIfMissing {
		merged[openClawAppSecretKey] = GenerateOpenClawAppSecret()
	}

	normalizeOpenClawCompatibleCustomConfigWithDefault(merged, defaultKind)

	if len(merged) == 0 {
		return "{}", nil
	}

	bytes, err := json.Marshal(merged)
	if err != nil {
		return "", fmt.Errorf("marshal merged custom_config: %w", err)
	}
	return string(bytes), nil
}

func normalizeOpenClawCompatibleCustomConfig(config map[string]interface{}) {
	normalizeOpenClawCompatibleCustomConfigWithDefault(config, "")
}

func normalizeOpenClawCompatibleCustomConfigWithDefault(config map[string]interface{}, defaultKind string) {
	if config == nil {
		return
	}

	agentType := normalizeOpenClawCompatibleKind(config["agent_type"])
	hostKind := normalizeOpenClawCompatibleKind(config["hostKind"])
	if hostKind == "" {
		hostKind = normalizeOpenClawCompatibleKind(config["host_kind"])
	}

	selectedKind := agentType
	if selectedKind == "" {
		selectedKind = hostKind
	}
	if selectedKind == "" {
		selectedKind = normalizeOpenClawCompatibleKind(defaultKind)
		if selectedKind == "" {
			return
		}
	}

	config["agent_type"] = selectedKind
	config["hostKind"] = selectedKind

	runnerCommand, hasRunnerCommand := config["runnerCommand"]
	runnerCommandBlank := !hasRunnerCommand || runnerCommand == nil || strings.TrimSpace(fmt.Sprint(runnerCommand)) == ""
	if selectedKind == "codex" && runnerCommandBlank {
		config["runnerCommand"] = openClawCodexRunnerCommand
	}
}

// NormalizeOpenClawCompatibleResponseConfig repairs legacy OpenClawWS metadata on
// the in-memory response object only. It never persists changes to the database.
func (a *Agent) NormalizeOpenClawCompatibleResponseConfig() {
	if a == nil || !a.IsOpenClawWSCompatible() {
		return
	}

	config, err := parseOpenClawCustomConfig(a.CustomConfig)
	if err != nil {
		return
	}

	defaultKind := ResolveOpenClawCompatibleKindFromChannelType(a.ChannelType)
	if defaultKind == "" {
		defaultKind = "openclaw"
	}
	normalizeOpenClawCompatibleCustomConfigWithDefault(config, defaultKind)

	bytes, err := json.Marshal(config)
	if err != nil {
		return
	}
	a.CustomConfig = string(bytes)
}

func (a *Agent) ResolveOpenClawCompatiblePlatformType() string {
	if a == nil || !a.IsOpenClawWSCompatible() {
		return ""
	}

	config, err := parseOpenClawCustomConfig(a.CustomConfig)
	if err != nil {
		return ""
	}

	if agentType := normalizeOpenClawCompatibleKind(config["agent_type"]); agentType != "" {
		return agentType
	}
	if hostKind := normalizeOpenClawCompatibleKind(config["hostKind"]); hostKind != "" {
		return hostKind
	}
	if hostKind := normalizeOpenClawCompatibleKind(config["host_kind"]); hostKind != "" {
		return hostKind
	}

	if kind := ResolveOpenClawCompatibleKindFromChannelType(a.ChannelType); kind != "" {
		return kind
	}

	return "openclaw"
}

func (a *Agent) IsOpenClawWSCompatible() bool {
	if a == nil {
		return false
	}
	return IsOpenClawWSCompatibleChannelType(a.ChannelType) || strings.EqualFold(strings.TrimSpace(a.Model), openClawWSModelName)
}

func normalizeOpenClawCompatibleKind(value interface{}) string {
	kind := strings.TrimSpace(strings.ToLower(fmt.Sprint(value)))
	if _, ok := openClawCompatibleAgentTypes[kind]; ok {
		return kind
	}
	return ""
}

func parseOpenClawCustomConfig(config string) (map[string]interface{}, error) {
	if config == "" {
		return map[string]interface{}{}, nil
	}

	var parsed map[string]interface{}
	if err := json.Unmarshal([]byte(config), &parsed); err != nil {
		return nil, err
	}
	if parsed == nil {
		parsed = make(map[string]interface{})
	}
	return parsed, nil
}

func openClawSecretFromMap(config map[string]interface{}) (interface{}, bool) {
	if config == nil {
		return nil, false
	}

	secret, ok := config[openClawAppSecretKey]
	if !ok || secret == nil {
		return nil, false
	}

	if secretStr, ok := secret.(string); ok && secretStr == "" {
		return nil, false
	}

	return secret, true
}
