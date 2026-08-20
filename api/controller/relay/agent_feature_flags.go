package relay

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/53AI/53AIHub/service/skill"
)

const agentToolFeatureEnterpriseConfigType = "agent_tool_features"
const agentToolFeatureSettingsKey = "agent_tool_features"
const agentToolFeatureFlagsContextKey = "agent_tool_feature_flags"

// agentToolFeatureFlags is immutable for one run. Precedence is global default
// followed by enterprise, Agent settings, and selected Skill frontmatter.
type agentToolFeatureFlags struct {
	EnhancementsEnabled     bool
	ToolPipeline            bool
	ToolInputGuard          bool
	UnifiedToolResult       bool
	StructuredProviderRetry bool
	CompletionPolicy        bool
	ReadContinuation        bool
	ArgumentAdapter         bool
	EditV2                  bool
	EditNormalizedMatch     bool
	EditBatch               bool
	ShellOutputV2           bool
}

func defaultAgentToolFeatureFlags() agentToolFeatureFlags {
	if !config.AGENT_SUCCESS_RATE_ENHANCEMENTS_ENABLED {
		return agentToolFeatureFlags{}
	}
	return agentToolFeatureFlags{
		EnhancementsEnabled: true,
		ToolPipeline:        config.AGENT_TOOL_PIPELINE_ENABLED, ToolInputGuard: config.AGENT_TOOL_INPUT_GUARD_ENABLED,
		UnifiedToolResult: config.AGENT_UNIFIED_TOOL_RESULT_ENABLED, StructuredProviderRetry: config.AGENT_STRUCTURED_PROVIDER_RETRY_ENABLED,
		CompletionPolicy: config.AGENT_COMPLETION_POLICY_ENABLED, ReadContinuation: config.AGENT_READ_CONTINUATION_ENABLED,
		ArgumentAdapter: config.AGENT_TOOL_ARGUMENT_ADAPTER_ENABLED, EditV2: config.AGENT_EDIT_V2_ENABLED,
		EditNormalizedMatch: config.AGENT_EDIT_NORMALIZED_MATCH_ENABLED, EditBatch: config.AGENT_EDIT_BATCH_ENABLED,
		ShellOutputV2: config.AGENT_RUN_SHELL_OUTPUT_V2_ENABLED,
	}
}

func resolveAgentToolFeatureFlags(_ context.Context, agent *model.Agent, currentSkill *skill.Skill) agentToolFeatureFlags {
	flags := defaultAgentToolFeatureFlags()
	// The global master switch is a hard kill switch. Tenant, Agent, and Skill
	// overrides may only narrow or enable a configured rollout after it is on;
	// they must never revive the enhancement path while it is globally off.
	if !flags.EnhancementsEnabled {
		return flags
	}
	if agent != nil && agent.Eid > 0 {
		if enterprise, err := service.GetEnterpriseConfigByType(agent.Eid, agentToolFeatureEnterpriseConfigType); err == nil && enterprise != nil && enterprise.Enabled {
			applyAgentToolFeatureOverrides(&flags, parseAgentToolFeatureMap(enterprise.Content))
		}
	}
	if agent != nil {
		applyAgentToolFeatureOverrides(&flags, parseAgentToolFeatureMapFromSettings(agent.Settings))
	}
	if currentSkill != nil {
		applyAgentToolFeatureOverrides(&flags, currentSkill.AgentToolFeatures)
	}
	return flags
}

func parseAgentToolFeatureMap(raw string) map[string]bool {
	values := map[string]bool{}
	_ = json.Unmarshal([]byte(raw), &values)
	return values
}
func parseAgentToolFeatureMapFromSettings(raw string) map[string]bool {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	var settings map[string]json.RawMessage
	if json.Unmarshal([]byte(raw), &settings) != nil {
		return nil
	}
	value, exists := settings[agentToolFeatureSettingsKey]
	if !exists {
		return nil
	}
	features := map[string]bool{}
	if json.Unmarshal(value, &features) != nil {
		return nil
	}
	return features
}
func applyAgentToolFeatureOverrides(flags *agentToolFeatureFlags, values map[string]bool) {
	if flags == nil {
		return
	}
	if value, ok := values["tool_pipeline"]; ok {
		flags.ToolPipeline = value
	}
	if value, ok := values["tool_input_guard"]; ok {
		flags.ToolInputGuard = value
	}
	if value, ok := values["unified_tool_result"]; ok {
		flags.UnifiedToolResult = value
	}
	if value, ok := values["structured_provider_retry"]; ok {
		flags.StructuredProviderRetry = value
	}
	if value, ok := values["completion_policy"]; ok {
		flags.CompletionPolicy = value
	}
	if value, ok := values["read_continuation"]; ok {
		flags.ReadContinuation = value
	}
	if value, ok := values["argument_adapter"]; ok {
		flags.ArgumentAdapter = value
	}
	if value, ok := values["edit_v2"]; ok {
		flags.EditV2 = value
	}
	if value, ok := values["edit_normalized_match"]; ok {
		flags.EditNormalizedMatch = value
	}
	if value, ok := values["edit_batch"]; ok {
		flags.EditBatch = value
	}
	if value, ok := values["shell_output_v2"]; ok {
		flags.ShellOutputV2 = value
	}
}
func agentToolFeatureFlagsFromGin(c interface{ Get(any) (any, bool) }) agentToolFeatureFlags {
	if c != nil {
		if value, exists := c.Get(agentToolFeatureFlagsContextKey); exists {
			if flags, ok := value.(agentToolFeatureFlags); ok {
				return flags
			}
		}
	}
	return defaultAgentToolFeatureFlags()
}

// shouldUseRelayToolPipeline is intentionally limited to the stages that need
// the pipeline. Argument adaptation has a compatible direct path so Gray-1
// can enable it without silently enabling the Tool Pipeline rollout.
func shouldUseRelayToolPipeline(flags agentToolFeatureFlags) bool {
	return flags.ToolPipeline || flags.ToolInputGuard || flags.UnifiedToolResult
}
