package relay

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/53AI/53AIHub/controller/relay/agentcore"
	"github.com/53AI/53AIHub/service/tools"
	relay_model "github.com/songquanpeng/one-api/relay/model"
)

// agentToolPipelineExecution keeps the transport-specific result beside the
// neutral result. The neutral result is for policies; the raw result remains
// available to the existing SSE, persistence, and upload-file paths.
type agentToolPipelineExecution struct {
	Result     *agentcore.ToolExecutionResult
	ToolResult *tools.ToolResult
}

type relayToolArgumentParsePolicy struct{}

func (relayToolArgumentParsePolicy) Name() string { return "argument_parse" }
func (relayToolArgumentParsePolicy) Stage() agentcore.ToolPolicyStage {
	return agentcore.StageValidate
}
func (relayToolArgumentParsePolicy) Before(_ context.Context, call *agentcore.ToolCallContext) agentcore.BeforeToolDecision {
	if call == nil || call.ParseErr == nil {
		return agentcore.BeforeToolDecision{}
	}
	return agentcore.BeforeToolDecision{
		Block:   true,
		Code:    "ARGUMENT_PARSE_ERROR",
		Summary: "工具参数不是合法 JSON",
		Content: "参数解析失败，请检查工具调用格式",
		Meta: map[string]any{
			"retryable_by_model": true,
		},
	}
}
func (relayToolArgumentParsePolicy) After(context.Context, *agentcore.ToolCallContext, *agentcore.ToolExecutionResult) agentcore.AfterToolDecision {
	return agentcore.AfterToolDecision{}
}

// relayToolPreflightPolicy moves the legacy per-turn permission and duplicate
// filters into the pipeline. A blocked/duplicate call therefore still yields a
// tool result paired with the model's original tool_call_id.
type relayToolPreflightPolicy struct {
	skillName     string
	injectedTools map[string]struct{}
	previewFiles  map[string]int
	seen          map[string]struct{}
	onDuplicate   func()
}

func newRelayToolPreflightPolicy(skillName string, injectedTools map[string]struct{}, fileVersions map[string]int, onDuplicate func()) *relayToolPreflightPolicy {
	return &relayToolPreflightPolicy{
		skillName: skillName, injectedTools: injectedTools, previewFiles: cloneToolFileVersions(fileVersions),
		seen: make(map[string]struct{}), onDuplicate: onDuplicate,
	}
}

func (p *relayToolPreflightPolicy) Name() string                   { return "relay_preflight" }
func (*relayToolPreflightPolicy) Stage() agentcore.ToolPolicyStage { return agentcore.StageGuard }
func (p *relayToolPreflightPolicy) Before(_ context.Context, call *agentcore.ToolCallContext) agentcore.BeforeToolDecision {
	if call == nil {
		return agentcore.BeforeToolDecision{Block: true, Code: "UNKNOWN_TOOL", Content: "工具调用为空"}
	}
	functionName := strings.TrimSpace(call.FunctionName)
	if _, exists := p.injectedTools[functionName]; !exists {
		return agentcore.BeforeToolDecision{
			Block: true, Code: "TOOL_NOT_ALLOWED", Summary: "工具不在当前技能允许范围内", Content: "当前技能不允许调用该工具",
		}
	}
	args := map[string]interface{}(call.ArgsParsed)
	key := buildToolDedupKey(p.skillName, functionName, call.ArgsRaw, args, p.previewFiles)
	if _, exists := p.seen[key]; exists {
		if p.onDuplicate != nil {
			p.onDuplicate()
		}
		return agentcore.BeforeToolDecision{
			Skip: true, Code: "DUPLICATE_CALL_SKIPPED", Summary: "重复工具调用已跳过", Content: "本轮中相同的工具调用已执行或已排队，无需重复执行",
			Meta: map[string]any{"retryable_by_model": false},
		}
	}
	p.seen[key] = struct{}{}
	recordSessionFileMutation(p.previewFiles, functionName, args)
	return agentcore.BeforeToolDecision{}
}
func (*relayToolPreflightPolicy) After(context.Context, *agentcore.ToolCallContext, *agentcore.ToolExecutionResult) agentcore.AfterToolDecision {
	return agentcore.AfterToolDecision{}
}

// executeRelayToolPipeline adapts the existing tool executor without allowing
// agentcore to depend on Gin, SSE, or service/tools.OutputFile.
func executeRelayToolPipeline(ctx context.Context, call *agentcore.ToolCallContext,
	execute func(context.Context, map[string]interface{}) (*tools.ToolResult, error), policies ...agentcore.ToolPolicy,
) agentToolPipelineExecution {
	var rawResult *tools.ToolResult
	executor := agentcore.ExecutorFunc(func(executionCtx context.Context, pipelineCall *agentcore.ToolCallContext) *agentcore.ToolExecutionResult {
		startedAt := time.Now()
		raw, err := execute(executionCtx, pipelineCall.ArgsParsed)
		rawResult = raw
		result := &agentcore.ToolExecutionResult{
			OK:         err == nil && raw != nil && raw.ExitCode == 0,
			Code:       "OK",
			ExitCode:   0,
			DurationMS: time.Since(startedAt).Milliseconds(),
			Err:        err,
		}
		if raw != nil {
			result.Output = raw.Output
			result.Stderr = raw.Stderr
			result.ExitCode = raw.ExitCode
			result.Meta = raw.Meta
			result.Artifacts = make([]agentcore.ToolArtifact, 0, len(raw.OutputFiles))
			for _, file := range raw.OutputFiles {
				result.Artifacts = append(result.Artifacts, agentcore.ToolArtifact{
					Path: file.FileName, MimeType: file.MimeType, Size: int64(file.Size),
				})
			}
		}
		if err != nil {
			result.Code = "TOOL_EXECUTION_FAILED"
			if raw == nil {
				result.ExitCode = -1
				result.Output = fmt.Sprintf("Error executing tool: %v", err)
			}
			return result
		}
		if raw == nil {
			result.Code = "UNKNOWN_OUTCOME"
			result.ExitCode = -1
			return result
		}
		if raw.ExitCode != 0 {
			result.Code = "TOOL_EXECUTION_FAILED"
		}
		return result
	})
	allPolicies := make([]agentcore.ToolPolicy, 0, len(policies)+1)
	allPolicies = append(allPolicies, relayToolArgumentParsePolicy{})
	allPolicies = append(allPolicies, policies...)
	result := agentcore.NewToolPipeline(executor, allPolicies...).Execute(ctx, call)
	return agentToolPipelineExecution{Result: result, ToolResult: rawResult}
}

func relayToolSchemaValidatorPolicy() agentcore.ToolPolicy {
	return agentcore.ArgsSchemaValidator{Provider: func(functionName string) (map[string]any, bool) {
		definition, err := tools.GetToolDefinition(functionName)
		if err != nil {
			return nil, false
		}
		schema, ok := definition.Function.Parameters.(map[string]interface{})
		if !ok {
			return nil, false
		}
		return schema, true
	}}
}

func relayToolInputGuardPolicies() []agentcore.ToolPolicy {
	policies := []agentcore.ToolPolicy{relayToolSchemaValidatorPolicy()}
	return append(policies, relayToolInputGuardOnlyPolicies()...)
}

func relayToolInputGuardOnlyPolicies() []agentcore.ToolPolicy {
	return []agentcore.ToolPolicy{
		agentcore.ArgsBudgetGuard{
			MaxArgsChars:    65536,
			MaxFieldChars:   32768,
			MaxCommandChars: 16384,
			MaxWriteChars:   32768,
		},
		agentcore.PlaceholderGuard{},
		agentcore.PathContainmentGuard{},
	}
}

// appendUnexecutedToolResultMessages closes the provider transcript when a
// turn-level safety stop prevents the rest of an already accepted tool batch
// from running. The skipped calls still need one tool result each; otherwise a
// subsequent/final provider request receives an invalid assistant/tool pairing.
func appendUnexecutedToolResultMessages(messages *[]relay_model.Message, calls []relay_model.Tool, reason string, unified bool) {
	if messages == nil {
		return
	}
	for _, call := range calls {
		functionName := strings.TrimSpace(call.Function.Name)
		result := &agentcore.ToolExecutionResult{
			OK: false, Code: "TOOL_EXECUTION_SKIPPED", Output: reason, ExitCode: -1,
			Meta: map[string]any{"retryable_by_model": false},
		}
		content := result.Output
		if unified {
			content = agentcore.MarshalToolResultEnvelope(result, toolOutputDefaultMaxCharsForLLM)
		}
		*messages = append(*messages, relay_model.Message{
			Role: "tool", Content: content, ToolCallId: call.Id, Name: &functionName,
		})
	}
}
