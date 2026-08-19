package relay

import "strings"

type CompletionAction string

const (
	CompletionContinue           CompletionAction = "continue"
	CompletionGenerateFinal      CompletionAction = "generate_final"
	CompletionCompleteWithResult CompletionAction = "complete_with_result"
	CompletionWaitForAction      CompletionAction = "wait_for_action"
	CompletionFail               CompletionAction = "fail"
)

type CompletionDecision struct {
	Action CompletionAction
	Reason string
}

type CompletionInput struct {
	ToolCallCount            int
	Content                  string
	LegacyDone               bool
	WaitingForAction         bool
	EmptyCorrectionAttempted bool
	MaxTurnsReached          bool
}

func decideAgentCompletion(input CompletionInput) CompletionDecision {
	// A legal tool call always wins over a legacy completion marker.
	if input.ToolCallCount > 0 {
		return CompletionDecision{Action: CompletionContinue, Reason: "tool_calls"}
	}
	if input.WaitingForAction {
		return CompletionDecision{Action: CompletionWaitForAction, Reason: "action_required"}
	}
	if input.MaxTurnsReached {
		return CompletionDecision{Action: CompletionFail, Reason: "max_turns"}
	}
	if strings.TrimSpace(input.Content) != "" {
		if input.LegacyDone {
			return CompletionDecision{Action: CompletionCompleteWithResult, Reason: "legacy_done"}
		}
		return CompletionDecision{Action: CompletionCompleteWithResult, Reason: "natural_answer"}
	}
	if !input.EmptyCorrectionAttempted {
		return CompletionDecision{Action: CompletionGenerateFinal, Reason: "empty_response_correction"}
	}
	return CompletionDecision{Action: CompletionFail, Reason: "empty_assistant_response"}
}

type ToolCompletionMode string

const (
	ToolCompletionContinue ToolCompletionMode = "continue"
	ToolCompletionFinalize ToolCompletionMode = "finalize"
	ToolCompletionTerminal ToolCompletionMode = "terminal"
)

type RuntimeToolMetadata struct {
	SkillName      string
	ToolName       string
	CompletionMode ToolCompletionMode
	ReadOnly       bool
	Idempotent     bool
}

var runtimeToolMetadata = map[string]RuntimeToolMetadata{
	// Only a controlled built-in may terminate directly. General file tools
	// deliberately remain continue: large files and multi-step Skills rely on
	// repeated writes, edits, and validation calls across turns.
	"|save_memory": {ToolName: "save_memory", CompletionMode: ToolCompletionTerminal},
}

func runtimeToolCompletionMetadataKey(skillName, toolName string) string {
	return strings.TrimSpace(skillName) + "|" + strings.TrimSpace(toolName)
}

func runtimeToolCompletionMode(skillName, toolName string) ToolCompletionMode {
	if metadata, exists := runtimeToolMetadata[runtimeToolCompletionMetadataKey(skillName, toolName)]; exists {
		return metadata.CompletionMode
	}
	if metadata, exists := runtimeToolMetadata[runtimeToolCompletionMetadataKey("", toolName)]; exists && strings.TrimSpace(skillName) == "" {
		return metadata.CompletionMode
	}
	return ToolCompletionContinue
}

type toolCompletionOutcome struct {
	total          int
	hasFailure     bool
	hasContinue    bool
	finalizeCount  int
	terminalCount  int
	terminalResult string
}

func (o *toolCompletionOutcome) Observe(mode ToolCompletionMode, succeeded bool, output string) {
	if o == nil {
		return
	}
	o.total++
	if !succeeded {
		o.hasFailure = true
		return
	}
	switch mode {
	case ToolCompletionFinalize:
		o.finalizeCount++
	case ToolCompletionTerminal:
		o.terminalCount++
		o.terminalResult = strings.TrimSpace(output)
	default:
		o.hasContinue = true
	}
}

func (o toolCompletionOutcome) Mode() ToolCompletionMode {
	if o.total == 0 || o.hasFailure || o.hasContinue {
		return ToolCompletionContinue
	}
	if o.terminalCount == 1 && o.total == 1 {
		return ToolCompletionTerminal
	}
	if o.terminalCount == 0 && o.finalizeCount > 0 {
		return ToolCompletionFinalize
	}
	return ToolCompletionContinue
}
