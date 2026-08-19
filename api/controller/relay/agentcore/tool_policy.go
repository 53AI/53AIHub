package agentcore

import "context"

// ToolPolicyStage makes the pipeline order explicit instead of relying on the
// order in which policies were registered.
type ToolPolicyStage int

const (
	StageValidate ToolPolicyStage = iota
	StageRepair
	StageGuard
	StageSanitize
	StageShape
	StageTruncate
	StageHint
)

// BeforeToolDecision may prevent an executor call. A blocked or skipped call
// still becomes a ToolExecutionResult so every tool_call_id keeps its pair.
type BeforeToolDecision struct {
	Block   bool
	Skip    bool
	Code    string
	Summary string
	Content string
	Meta    map[string]any
}

// AfterToolDecision lets policies replace or annotate the execution result.
type AfterToolDecision struct {
	Result *ToolExecutionResult
}

type ToolPolicy interface {
	Name() string
	Stage() ToolPolicyStage
	Before(ctx context.Context, call *ToolCallContext) BeforeToolDecision
	After(ctx context.Context, call *ToolCallContext, result *ToolExecutionResult) AfterToolDecision
}
