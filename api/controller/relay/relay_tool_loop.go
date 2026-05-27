package relay

import (
	"crypto/sha256"
	"fmt"
	"strings"
)

type relayToolLoopState struct {
	lastResultSignature string
	sameResultCount     int
	readOnlyStreak      int
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
