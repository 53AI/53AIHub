package relay

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/controller/relay/agentcore"
)

type relayToolArgumentAliasPolicy struct {
	hasFeatureSnapshot bool
	editV2Enabled      bool
	editBatchEnabled   bool
}

func (relayToolArgumentAliasPolicy) Name() string { return "argument_alias_adapter" }
func (relayToolArgumentAliasPolicy) Stage() agentcore.ToolPolicyStage {
	return agentcore.StageValidate
}
func (p relayToolArgumentAliasPolicy) Before(_ context.Context, call *agentcore.ToolCallContext) agentcore.BeforeToolDecision {
	if call == nil || call.ParseErr != nil {
		return agentcore.BeforeToolDecision{}
	}
	if err := adaptRelayToolArgumentsWithEditFlags(call, p.editV2Enabled, p.editBatchEnabled, p.hasFeatureSnapshot); err != nil {
		return agentcore.BeforeToolDecision{Block: true, Code: "ARGUMENT_ALIAS_CONFLICT", Summary: "同一参数提供了多个不同值", Content: err.Error(), Meta: map[string]any{"retryable_by_model": true}}
	}
	return agentcore.BeforeToolDecision{}
}
func (relayToolArgumentAliasPolicy) After(_ context.Context, call *agentcore.ToolCallContext, result *agentcore.ToolExecutionResult) agentcore.AfterToolDecision {
	if call == nil || len(call.Repairs) == 0 || result == nil {
		return agentcore.AfterToolDecision{}
	}
	if result.Meta == nil {
		result.Meta = map[string]any{}
	}
	result.Meta["args_repaired"] = true
	result.Meta["repairs"] = call.Repairs
	return agentcore.AfterToolDecision{Result: result}
}

func adaptRelayToolArguments(call *agentcore.ToolCallContext) error {
	return adaptRelayToolArgumentsWithEditFlags(call, config.AGENT_EDIT_V2_ENABLED, config.AGENT_EDIT_BATCH_ENABLED, config.AGENT_SUCCESS_RATE_ENHANCEMENTS_ENABLED)
}

func adaptRelayToolArgumentsWithEditFlags(call *agentcore.ToolCallContext, editV2Enabled, editBatchEnabled, hasFeatureSnapshot bool) error {
	if call.ArgsParsed == nil {
		return nil
	}
	if call.FunctionName == "edit" {
		if err := adaptEditAliasesWithFlags(call, editV2Enabled, editBatchEnabled, hasFeatureSnapshot); err != nil {
			return err
		}
	}
	for _, field := range []string{"timeout", "limit", "offset", "tail_lines", "max_bytes", "max_entries"} {
		text, ok := call.ArgsParsed[field].(string)
		if !ok {
			continue
		}
		value, err := strconv.Atoi(strings.TrimSpace(text))
		if err != nil {
			continue
		}
		call.ArgsParsed[field] = value
		call.Repairs = append(call.Repairs, agentcore.ToolArgumentRepair{Field: field, From: text, To: value})
	}
	if call.FunctionName == "code-interpreter" {
		if language, ok := call.ArgsParsed["language"].(string); ok {
			normalized := strings.ToLower(strings.TrimSpace(language))
			if normalized != language && (normalized == "python" || normalized == "nodejs" || normalized == "bash") {
				call.ArgsParsed["language"] = normalized
				call.Repairs = append(call.Repairs, agentcore.ToolArgumentRepair{Field: "language", From: language, To: normalized})
			}
		}
	}
	return nil
}

func adaptEditAliases(call *agentcore.ToolCallContext) error {
	return adaptEditAliasesWithFlags(call, config.AGENT_EDIT_V2_ENABLED, config.AGENT_EDIT_BATCH_ENABLED, config.AGENT_SUCCESS_RATE_ENHANCEMENTS_ENABLED)
}

func adaptEditAliasesWithFlags(call *agentcore.ToolCallContext, editV2Enabled, editBatchEnabled, hasFeatureSnapshot bool) error {
	aliases := map[string][]string{
		"old_string": {"oldText", "old_text", "oldString", "old_str"},
		"new_string": {"newText", "new_text", "newString", "new_str"},
	}
	for canonical, names := range aliases {
		if err := applyArgumentAliases(call, canonical, names); err != nil {
			return err
		}
	}
	if edits, exists := call.ArgsParsed["edits"]; exists {
		items, ok := edits.([]any)
		if !ok || len(items) == 0 {
			return fmt.Errorf("字段 edits 必须为非空编辑数组。")
		}
		if hasFeatureSnapshot && editV2Enabled && editBatchEnabled {
			return nil
		}
		if len(items) != 1 {
			return fmt.Errorf("字段 edits 当前仅支持包含一项编辑；请拆分调用。")
		}
		edit, ok := items[0].(map[string]any)
		if !ok {
			return fmt.Errorf("字段 edits[0] 应为对象")
		}
		for _, field := range []string{"old_string", "new_string"} {
			if existing, exists := call.ArgsParsed[field]; exists && fmt.Sprint(existing) != fmt.Sprint(edit[field]) {
				return fmt.Errorf("%s 与 edits[0].%s 的值不一致，请只保留一个。", field, field)
			}
			if value, exists := edit[field]; exists {
				call.ArgsParsed[field] = value
				call.Repairs = append(call.Repairs, agentcore.ToolArgumentRepair{Field: field, From: "edits[0]." + field, To: value})
			}
		}
		delete(call.ArgsParsed, "edits")
	}
	return nil
}

func applyArgumentAliases(call *agentcore.ToolCallContext, canonical string, aliases []string) error {
	canonicalValue, canonicalExists := call.ArgsParsed[canonical]
	for _, alias := range aliases {
		value, exists := call.ArgsParsed[alias]
		if !exists {
			continue
		}
		if canonicalExists && fmt.Sprint(canonicalValue) != fmt.Sprint(value) {
			return fmt.Errorf("%s 与 %s 的值不一致，请只保留一个。", canonical, alias)
		}
		if !canonicalExists {
			call.ArgsParsed[canonical], canonicalValue, canonicalExists = value, value, true
			call.Repairs = append(call.Repairs, agentcore.ToolArgumentRepair{Field: canonical, From: alias, To: value})
		}
		delete(call.ArgsParsed, alias)
	}
	return nil
}
