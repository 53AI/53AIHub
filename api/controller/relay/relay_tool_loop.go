package relay

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/53AI/53AIHub/model"
	relay_model "github.com/songquanpeng/one-api/relay/model"
)

const (
	agentStreamPhaseContextKey        = "agent_stream_phase"
	agentInitialStreamPhaseContextKey = "agent_initial_stream_phase"
	agentStreamPhasePlanning          = "planning"
	agentStreamPhaseAnswering         = "answering"
)

type relayToolLoopState struct {
	lastResultSignature string
	sameResultCount     int
	readOnlyStreak      int
}

type agentToolExecutionSignal struct {
	FunctionName string
	ArgsString   string
	Status       string
	ExitCode     int
	LLMOutput    string
}

type agentToolTurnOutcome struct {
	hasTool               bool
	hasFailure            bool
	hasLikelyFinalSuccess bool
}

func (o *agentToolTurnOutcome) Observe(signal agentToolExecutionSignal) {
	if o == nil {
		return
	}
	o.hasTool = true
	if isFailedToolExecutionSignal(signal) {
		o.hasFailure = true
		return
	}
	if isLikelyFinalToolSuccess(signal.FunctionName, signal.ArgsString) {
		o.hasLikelyFinalSuccess = true
	}
}

func (o agentToolTurnOutcome) NextStreamPhase() string {
	if o.hasTool && !o.hasFailure && o.hasLikelyFinalSuccess {
		return agentStreamPhaseAnswering
	}
	return agentStreamPhasePlanning
}

func shouldUseRAGAnsweringInitialPhase(messageStatus *MessageStatsInfo, ragCompleted bool, hadRequestTools bool, toolsList []relay_model.Tool) bool {
	if !ragCompleted || hadRequestTools {
		return false
	}
	if messageStatus != nil && messageStatus.RouterResult != nil && messageStatus.RouterResult.Skill != nil {
		return false
	}
	return isOnlyInjectedGlobalWebFetchTool(toolsList)
}

func isOnlyInjectedGlobalWebFetchTool(toolsList []relay_model.Tool) bool {
	if len(toolsList) != 1 {
		return false
	}
	return strings.TrimSpace(toolsList[0].Function.Name) == "web_fetch"
}

func isFailedToolExecutionSignal(signal agentToolExecutionSignal) bool {
	status := strings.TrimSpace(signal.Status)
	if status != "" && status != model.ToolCallStatusSuccess {
		return true
	}
	if signal.ExitCode != 0 {
		return true
	}
	output := strings.TrimSpace(signal.LLMOutput)
	if output == "" {
		return false
	}
	return strings.Contains(output, `"__tool_result__":"TOOL_EXECUTION_FAILED"`) ||
		strings.Contains(output, `"__tool_error__"`) ||
		strings.Contains(output, "TOOL_ARGUMENT_PARSE_ERROR") ||
		strings.Contains(output, "TOOL_ARGUMENT_TOO_LARGE") ||
		strings.Contains(output, "TOOL_EXECUTION_FAILED")
}

func isLikelyFinalToolSuccess(functionName string, argsString string) bool {
	switch strings.TrimSpace(functionName) {
	case "read_file", "list_files", "web_fetch", "prepare_input_file":
		return false
	case "run_shell":
		return isLikelyFinalRunShellCommand(extractRunShellCommand(argsString))
	default:
		return !isSandboxRuntimeToolName(functionName)
	}
}

func extractRunShellCommand(argsString string) string {
	argsString = strings.TrimSpace(argsString)
	if argsString == "" {
		return ""
	}
	var args map[string]interface{}
	if err := json.Unmarshal([]byte(argsString), &args); err == nil {
		if command, ok := args["command"].(string); ok {
			return strings.TrimSpace(command)
		}
	}
	return argsString
}

func isLikelyFinalRunShellCommand(command string) bool {
	command = strings.TrimSpace(command)
	if command == "" {
		return false
	}
	if !strings.Contains(command, "tencent_meeting_api.py") {
		return false
	}
	action := extractTencentMeetingAction(command)
	return action != "" && action != "convert_timestamp"
}

func extractTencentMeetingAction(command string) string {
	fields := strings.Fields(command)
	for i, field := range fields {
		if strings.HasSuffix(field, "tencent_meeting_api.py") && i+1 < len(fields) {
			return strings.TrimSpace(fields[i+1])
		}
	}
	return ""
}

func newRelayToolLoopState() *relayToolLoopState {
	return &relayToolLoopState{}
}

func (s *relayToolLoopState) ObserveToolResult(functionName, output string, exitCode int) string {
	signature := buildRelayToolResultSignature(functionName, output, exitCode)
	if signature == "" {
		return ""
	}
	if signature == s.lastResultSignature {
		s.sameResultCount++
	} else {
		s.lastResultSignature = signature
		s.sameResultCount = 1
	}
	if s.sameResultCount == 2 {
		return buildRepeatedToolResultHint(functionName, s.sameResultCount)
	}
	return ""
}

func (s *relayToolLoopState) ObserveTurn(turnHasReadOnlyTool bool, turnHasMutatingTool bool, turnProducedOutputFiles bool) string {
	if turnHasMutatingTool || turnProducedOutputFiles {
		s.readOnlyStreak = 0
		return ""
	}
	if !turnHasReadOnlyTool {
		s.readOnlyStreak = 0
		return ""
	}

	s.readOnlyStreak++
	if s.readOnlyStreak == 3 {
		return buildReadOnlyStreakHint(s.readOnlyStreak)
	}
	return ""
}

func buildRelayToolResultSignature(functionName, output string, exitCode int) string {
	trimmed := strings.TrimSpace(extractHTTPBodyFromToolOutput(output))
	if trimmed == "" {
		trimmed = strings.TrimSpace(output)
	}
	if trimmed == "" && exitCode == 0 {
		return ""
	}
	sum := sha256.Sum256([]byte(fmt.Sprintf("%s|%d|%s", strings.TrimSpace(functionName), exitCode, trimmed)))
	return fmt.Sprintf("%x", sum[:8])
}

func buildRepeatedToolResultHint(functionName string, count int) string {
	if count < 2 {
		return ""
	}
	switch strings.TrimSpace(functionName) {
	case "read_file":
		return fmt.Sprintf("System Note: read_file 已连续 %d 次返回相同结果，请停止重复读取同一文件，改为编辑文件、查看不同路径或总结当前发现。", count)
	case "list_files":
		return fmt.Sprintf("System Note: list_files 已连续 %d 次返回相同结果，请停止重复列出同一目录，改为切换路径、编辑文件或总结当前发现。", count)
	case "run_shell":
		return fmt.Sprintf("System Note: run_shell 已连续 %d 次返回相同结果，请停止重复执行同一条命令，先改命令、cwd 或目标文件后再试。", count)
	case "code-interpreter":
		return fmt.Sprintf("System Note: code-interpreter 已连续 %d 次返回相同结果，请停止重复执行同一段代码，先修正输入或改用最小可运行片段。", count)
	default:
		return fmt.Sprintf("System Note: 工具 %s 已连续 %d 次返回相同结果，请停止重复提交同一策略，先改变命令、路径或输入后再试。", strings.TrimSpace(functionName), count)
	}
}

func buildReadOnlyStreakHint(count int) string {
	if count < 3 {
		return ""
	}
	return fmt.Sprintf("System Note: 你已经连续 %d 轮只做只读检查，没有产生有效修改。请停止反复读取同一上下文，改为最小修改、换路径或直接总结结论。", count)
}

func isReadOnlyRelayToolName(functionName string) bool {
	switch strings.TrimSpace(functionName) {
	case "read_file", "list_files", "web_fetch":
		return true
	default:
		return false
	}
}

func isMutatingRelayToolName(functionName string) bool {
	switch strings.TrimSpace(functionName) {
	case "write_file", "prepare_input_file", "edit":
		return true
	default:
		return false
	}
}
