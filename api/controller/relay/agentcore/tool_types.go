// Package agentcore contains the transport-independent parts of the agent tool
// execution path. It deliberately has no Gin, SSE, database, or sandbox types.
package agentcore

import "context"

// ToolHistoryView exposes historical information without giving policies a
// mutable view of the agent loop's internal maps.
type ToolHistoryView interface {
	UsageCount(functionName string) int
	FailureCount(functionName string) int
}

// ToolCallContext is the immutable-per-call context made available to policies.
// ArgsParsed can be replaced only by an explicit repair policy before execution.
type ToolCallContext struct {
	RunID        string
	Turn         int
	SkillName    string
	ToolCallID   string
	FunctionName string

	ArgsRaw    string
	ArgsParsed map[string]any
	ParseErr   error
	Repairs    []ToolArgumentRepair

	UsageCount   int
	FailureCount int

	History ToolHistoryView
}

type ToolArgumentRepair struct {
	Field string `json:"field"`
	From  any    `json:"from"`
	To    any    `json:"to"`
}

// ToolArtifact is an executor-neutral description of a file created by a tool.
type ToolArtifact struct {
	Path     string
	MimeType string
	Size     int64
	Digest   string
}

// ToolExecutionResult represents both executor outcomes and policy-created
// blocked/skip outcomes. Err is retained for diagnostics and is never a model
// response on its own.
type ToolExecutionResult struct {
	OK         bool
	Code       string
	Output     string
	Stderr     string
	ExitCode   int
	DurationMS int64
	Artifacts  []ToolArtifact
	Err        error
	Meta       map[string]any
}

// ToolExecutor is intentionally small so production adapters and test fakes
// have the same contract.
type ToolExecutor interface {
	Execute(ctx context.Context, call *ToolCallContext) *ToolExecutionResult
}
