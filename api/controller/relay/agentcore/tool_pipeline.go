package agentcore

import (
	"context"
	"sort"
)

// ToolPipeline applies the sorted policy phases around one executor. It owns
// neither SSE nor persistence, allowing it to be tested outside Gin.
type ToolPipeline struct {
	executor ToolExecutor
	policies []ToolPolicy
}

func NewToolPipeline(executor ToolExecutor, policies ...ToolPolicy) *ToolPipeline {
	sorted := append([]ToolPolicy(nil), policies...)
	sort.SliceStable(sorted, func(i, j int) bool {
		return sorted[i].Stage() < sorted[j].Stage()
	})
	return &ToolPipeline{executor: executor, policies: sorted}
}

func (p *ToolPipeline) Execute(ctx context.Context, call *ToolCallContext) *ToolExecutionResult {
	if call == nil {
		return &ToolExecutionResult{Code: "UNKNOWN_OUTCOME", ExitCode: -1}
	}

	for _, policy := range p.policies {
		decision := policy.Before(ctx, call)
		if !decision.Block && !decision.Skip {
			continue
		}
		code := decision.Code
		if code == "" {
			if decision.Skip {
				code = "DUPLICATE_CALL_SKIPPED"
			} else {
				code = "TOOL_EXECUTION_BLOCKED"
			}
		}
		result := &ToolExecutionResult{
			OK:       false,
			Code:     code,
			Output:   decision.Content,
			ExitCode: -1,
			Meta:     cloneMeta(decision.Meta),
		}
		if result.Meta == nil {
			result.Meta = map[string]any{}
		}
		if decision.Summary != "" {
			result.Meta["summary"] = decision.Summary
		}
		return p.applyAfter(ctx, call, result)
	}

	if p.executor == nil {
		return p.applyAfter(ctx, call, &ToolExecutionResult{Code: "UNKNOWN_TOOL", ExitCode: -1})
	}
	result := p.executor.Execute(ctx, call)
	if result == nil {
		result = &ToolExecutionResult{Code: "UNKNOWN_OUTCOME", ExitCode: -1}
	}
	return p.applyAfter(ctx, call, result)
}

func (p *ToolPipeline) applyAfter(ctx context.Context, call *ToolCallContext, result *ToolExecutionResult) *ToolExecutionResult {
	for _, policy := range p.policies {
		decision := policy.After(ctx, call, result)
		if decision.Result != nil {
			result = decision.Result
		}
	}
	return result
}

func cloneMeta(meta map[string]any) map[string]any {
	if len(meta) == 0 {
		return nil
	}
	cloned := make(map[string]any, len(meta))
	for key, value := range meta {
		cloned[key] = value
	}
	return cloned
}
