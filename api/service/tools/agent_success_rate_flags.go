package tools

import (
	"context"

	"github.com/53AI/53AIHub/config"
)

// AgentSuccessRateFeatureFlags is frozen by relay once per Agent Run and is
// carried through the tool context. Direct tool callers use the globally gated
// defaults, preserving legacy behaviour while the master switch is off.
type AgentSuccessRateFeatureFlags struct {
	Enabled             bool
	ReadContinuation    bool
	EditV2              bool
	EditNormalizedMatch bool
	EditBatch           bool
	ShellOutputV2       bool
}

const AgentSuccessRateFeatureFlagsKey contextKey = "agent_success_rate_feature_flags"

func WithAgentSuccessRateFeatureFlags(ctx context.Context, flags AgentSuccessRateFeatureFlags) context.Context {
	return context.WithValue(ctx, AgentSuccessRateFeatureFlagsKey, flags)
}

func agentSuccessRateFeatureFlagsFromContext(ctx context.Context) AgentSuccessRateFeatureFlags {
	if ctx != nil {
		if flags, ok := ctx.Value(AgentSuccessRateFeatureFlagsKey).(AgentSuccessRateFeatureFlags); ok {
			return flags
		}
	}
	if !config.AGENT_SUCCESS_RATE_ENHANCEMENTS_ENABLED {
		return AgentSuccessRateFeatureFlags{}
	}
	return AgentSuccessRateFeatureFlags{
		Enabled: true, ReadContinuation: config.AGENT_READ_CONTINUATION_ENABLED,
		EditV2: config.AGENT_EDIT_V2_ENABLED, EditNormalizedMatch: config.AGENT_EDIT_NORMALIZED_MATCH_ENABLED,
		EditBatch: config.AGENT_EDIT_BATCH_ENABLED, ShellOutputV2: config.AGENT_RUN_SHELL_OUTPUT_V2_ENABLED,
	}
}
