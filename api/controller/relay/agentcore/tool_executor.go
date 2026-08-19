package agentcore

import "context"

// ExecutorFunc adapts an ordinary function into a ToolExecutor.
type ExecutorFunc func(context.Context, *ToolCallContext) *ToolExecutionResult

func (f ExecutorFunc) Execute(ctx context.Context, call *ToolCallContext) *ToolExecutionResult {
	return f(ctx, call)
}
