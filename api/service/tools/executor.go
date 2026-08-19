package tools

import (
	"bufio"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/helper"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	sandboxclient "github.com/53AI/53AIHub/service/sandbox"
	relay_model "github.com/songquanpeng/one-api/relay/model"
)

var seededSessionResources sync.Map

type contextKey string

const (
	SkillRootPathKey         contextKey = "skill_root_path"
	SkillResourcesKey        contextKey = "skill_resources"
	UploadedFilesKey         contextKey = "uploaded_files" // 用户上传的文件列表
	RuntimeSeedFilesKey      contextKey = "runtime_seed_files"
	SkillRunIDKey            contextKey = "skill_run_id"
	ToolEIDKey               contextKey = "tool_eid"
	ToolUserIDKey            contextKey = "tool_user_id"
	ToolAgentIDKey           contextKey = "tool_agent_id"
	ToolMessageIDKey         contextKey = "tool_message_id"
	SandboxConversationIDKey contextKey = "sandbox_conversation_id"
	SandboxSessionIDKey      contextKey = "sandbox_session_id"
	SandboxCWDKey            contextKey = "sandbox_cwd"
	SandboxEnvVarsKey        contextKey = "sandbox_env_vars"
)

// SandboxRequest represents the payload sent to the sandbox service
type SandboxRequest struct {
	Code      string            `json:"code"`
	Language  string            `json:"language"`
	Timeout   int               `json:"timeout"`
	SessionID string            `json:"session_id,omitempty"`
	Cwd       string            `json:"cwd,omitempty"`
	EnvVars   map[string]string `json:"env_vars,omitempty"`
	Files     map[string]string `json:"files,omitempty"`
}

// SandboxResponse represents the response from the sandbox service
type SandboxResponse struct {
	Stdout      string       `json:"stdout"`
	Stderr      string       `json:"stderr"`
	ExitCode    int          `json:"exit_code"`
	OutputFiles []OutputFile `json:"output_files,omitempty"` // 沙盒生成的输出文件
}

// OutputFile represents a file generated in the sandbox
type OutputFile struct {
	FileName string `json:"file_name"` // 文件名（含相对路径）
	Content  string `json:"content"`   // Base64 编码的文件内容
	MimeType string `json:"mime_type"` // MIME 类型
	Size     int    `json:"size"`      // 文件大小（字节）
}

// SandboxStreamEvent represents a streaming event from the sandbox service
type SandboxStreamEvent struct {
	EventType string                 `json:"event_type"` // tool.started, stdout.delta, stderr.delta, tool.completed, error
	Data      map[string]interface{} `json:"data"`
}

// SandboxStreamHandler is a callback function for handling streaming events
type SandboxStreamHandler func(event SandboxStreamEvent)

// ToolResult represents the result of a tool execution
type ToolResult struct {
	Output      string                 // 标准输出内容
	Stderr      string                 // 标准错误内容
	ExitCode    int                    // 退出码
	OutputFiles []OutputFile           // 沙盒生成的文件
	Meta        map[string]interface{} // 模型侧结果规整使用的中立元数据
}

// ExecuteTool executes a tool by name with given arguments
// Returns output string and error (backward compatible)
func ExecuteTool(ctx context.Context, name string, args map[string]interface{}) (string, error) {
	result, err := ExecuteToolWithResult(ctx, name, args)
	if err != nil {
		return "", err
	}
	return result.Output, nil
}

// ExecuteToolWithResult executes a tool and returns full result including output files
func ExecuteToolWithResult(ctx context.Context, name string, args map[string]interface{}) (*ToolResult, error) {
	logger.Infof(ctx, "【工具执行】开始: tool=%s %s", name, logger.SummarizeToolArguments(args))
	if err := ensureSandboxRuntimeEnabledForTool(name); err != nil {
		return nil, err
	}

	switch name {
	case "code-interpreter":
		// Generic handler for code execution
		code, ok := args["code"].(string)
		if !ok {
			return nil, fmt.Errorf("missing code argument")
		}
		// Default to python if not specified
		language, ok := args["language"].(string)
		if !ok || language == "" {
			language = "python"
		}
		if config.IsSandboxRuntimeProviderEnabled() {
			return executeSandboxRuntimeCodeWithResult(ctx, language, code)
		}
		return executeSandboxCodeWithResult(ctx, language, code)

	case "run_shell":
		if config.IsSandboxRuntimeProviderEnabled() {
			return executeSandboxRuntimeRunShell(ctx, args)
		}
		return executeRunShell(ctx, args)

	case "read_file":
		if config.IsSandboxRuntimeProviderEnabled() {
			return executeSandboxRuntimeReadFile(ctx, args)
		}
		return executeReadFile(ctx, args)

	case "write_file":
		if config.IsSandboxRuntimeProviderEnabled() {
			return executeSandboxRuntimeWriteFile(ctx, args)
		}
		return executeWriteFile(ctx, args)

	case "prepare_input_file":
		if config.IsSandboxRuntimeProviderEnabled() {
			return executeSandboxRuntimePrepareInputFile(ctx, args)
		}
		return executePrepareInputFile(ctx, args)

	case "list_files":
		if config.IsSandboxRuntimeProviderEnabled() {
			return executeSandboxRuntimeListFiles(ctx, args)
		}
		return executeListFiles(ctx, args)

	case "edit":
		if config.IsSandboxRuntimeProviderEnabled() {
			return executeSandboxRuntimeEditFile(ctx, args)
		}
		return executeEditFile(ctx, args)

	case "web_fetch":
		return executeWebFetch(ctx, args)

	case "memory_search":
		return executeMemorySearch(ctx, args)

	case "save_memory":
		return executeSaveMemory(ctx, args)

	default:
		return nil, fmt.Errorf("tool execution not implemented for: %s", name)
	}
}

// executeSandboxCodeWithResult executes code and returns full result including output files
func executeSandboxCodeWithResult(ctx context.Context, language string, code string) (*ToolResult, error) {
	reqPayload := buildSandboxRequest(ctx, language, code)
	if err := ensureSandboxSessionSeeded(ctx, reqPayload.SessionID, reqPayload.Cwd); err != nil {
		return nil, err
	}
	if err := preflightSandboxClientCode(ctx, reqPayload.SessionID, reqPayload.Cwd, language, code); err != nil {
		return nil, err
	}

	jsonData, err := json.Marshal(reqPayload)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal sandbox request: %v", err)
	}

	url := fmt.Sprintf("%s/execute", strings.TrimRight(config.SandboxServiceURL, "/"))
	logSandboxRequestDebug(ctx, "execute", url, reqPayload, jsonData)
	var sandboxResp *sandboxclient.ExecuteCodeResponse

	// Execute with retry logic for transient failures
	retryErr := common.Retry(ctx, func() error {
		resp, httpErr := getSandboxClient().ExecuteCode(ctx, convertToSandboxClientExecuteRequest(reqPayload))
		if httpErr != nil {
			logger.Warnf(ctx, "Sandbox service request failed: %v", httpErr)
			return httpErr
		}
		sandboxResp = resp
		return nil
	},
		common.WithMaxRetries(3),
		common.WithInitialDelay(500*time.Millisecond),
		common.WithRetryableFunc(common.IsRetryableError),
	)

	if retryErr != nil {
		logger.Errorf(ctx, "Sandbox service unavailable after retries: %v", retryErr)
		return nil, fmt.Errorf("工具服务暂时不可用，请稍后重试")
	}
	logSandboxResponseDebug(ctx, "execute", convertFromSandboxClientExecuteResponse(sandboxResp))
	outputFiles, snapshot := filterSandboxOutputFilesBySnapshot(loadSandboxOutputSnapshot(ctx), convertSandboxOutputFiles(sandboxResp.OutputFiles))
	rememberSandboxOutputSnapshot(ctx, snapshot)

	return &ToolResult{
		Output:      formatCommandResult(sandboxResp.Stdout, sandboxResp.Stderr, sandboxResp.ExitCode),
		Stderr:      sandboxResp.Stderr,
		ExitCode:    sandboxResp.ExitCode,
		OutputFiles: outputFiles,
	}, nil
}

// executeSandboxCode handles the HTTP communication with the Sandbox Service
// with retry logic for transient failures
func executeSandboxCode(ctx context.Context, language string, code string) (string, error) {
	reqPayload := buildSandboxRequest(ctx, language, code)
	if err := ensureSandboxSessionSeeded(ctx, reqPayload.SessionID, reqPayload.Cwd); err != nil {
		return "", err
	}
	if err := preflightSandboxClientCode(ctx, reqPayload.SessionID, reqPayload.Cwd, language, code); err != nil {
		return "", err
	}

	jsonData, err := json.Marshal(reqPayload)
	if err != nil {
		return "", fmt.Errorf("failed to marshal sandbox request: %v", err)
	}

	url := fmt.Sprintf("%s/execute", strings.TrimRight(config.SandboxServiceURL, "/"))
	logSandboxRequestDebug(ctx, "execute_legacy", url, reqPayload, jsonData)

	var result *sandboxclient.ExecuteCodeResponse

	// Execute with retry logic for transient failures
	retryErr := common.Retry(ctx, func() error {
		resp, httpErr := getSandboxClient().ExecuteCode(ctx, convertToSandboxClientExecuteRequest(reqPayload))
		if httpErr != nil {
			logger.Warnf(ctx, "Sandbox service request failed: %v", httpErr)
			return httpErr
		}
		result = resp
		return nil
	},
		common.WithMaxRetries(3),
		common.WithInitialDelay(500*time.Millisecond),
		common.WithRetryableFunc(common.IsRetryableError),
	)

	if retryErr != nil {
		logger.Errorf(ctx, "Sandbox service unavailable after retries: %v", retryErr)
		return "", fmt.Errorf("工具服务暂时不可用，请稍后重试")
	}
	logSandboxResponseDebug(ctx, "execute_legacy", convertFromSandboxClientExecuteResponse(result))
	return formatCommandResult(result.Stdout, result.Stderr, result.ExitCode), nil
}

// DetectToolCallsFromContent parses the content string for code blocks or patterns that imply a tool call
func DetectToolCallsFromContent(content string) []relay_model.Tool {
	var toolCalls []relay_model.Tool

	logger.Debugf(context.Background(), "[DetectToolCalls] Content length: %d", len(content))

	// First, try to parse JSON format tool calls (e.g., {"language": "bash", "code": "..."})
	jsonToolCalls := detectJSONToolCalls(content)
	logger.Debugf(context.Background(), "[DetectToolCalls] detectJSONToolCalls returned %d calls", len(jsonToolCalls))
	if len(jsonToolCalls) > 0 {
		return jsonToolCalls
	}

	// Helper function to extract command from code block
	extractCommand := func(lang string) {
		pattern := "```" + lang
		if strings.Contains(content, pattern) {
			parts := strings.Split(content, pattern)
			if len(parts) > 1 {
				codePart := parts[1]
				endIdx := strings.Index(codePart, "```")
				if endIdx != -1 {
					command := strings.TrimSpace(codePart[:endIdx])
					if command != "" {
						toolName := "code-interpreter"
						args := map[string]interface{}{}
						if lang == "python" {
							args["code"] = command
							args["language"] = "python"
						} else {
							toolName = "run_shell"
							args["command"] = command
						}
						argsBytes, _ := json.Marshal(args)

						toolCalls = append(toolCalls, relay_model.Tool{
							Id:   fmt.Sprintf("call_%d", rand.Int()),
							Type: "function",
							Function: relay_model.Function{
								Name:      toolName,
								Arguments: string(argsBytes),
							},
						})
					}
				}
			}
		}
	}

	// Supported languages for CLI commands
	supportedLangs := []string{"bash", "sh", "shell", "python"}
	for _, lang := range supportedLangs {
		extractCommand(lang)
		if len(toolCalls) > 0 {
			break // Stop after finding the first valid block to prevent duplicates if multiple langs used
		}
	}

	logger.Debugf(context.Background(), "[DetectToolCalls] Final result: %d tool calls detected", len(toolCalls))
	return toolCalls
}

func detectJSONToolCalls(content string) []relay_model.Tool {
	var toolCalls []relay_model.Tool

	logger.Debugf(context.Background(), "[detectJSONToolCalls] Checking content for JSON patterns")

	// Pattern 1: Look for json code blocks containing tool call format
	jsonPattern := "```json"
	logger.Debugf(context.Background(), "[detectJSONToolCalls] Checking for pattern: %s", jsonPattern)
	if strings.Contains(content, jsonPattern) {
		logger.Debugf(context.Background(), "[detectJSONToolCalls] Found jsonPattern in content")
		parts := strings.Split(content, jsonPattern)
		logger.Debugf(context.Background(), "[detectJSONToolCalls] Split into %d parts", len(parts))
		for i := 1; i < len(parts); i++ {
			codePart := parts[i]
			endIdx := strings.Index(codePart, "```")
			if endIdx == -1 {
				logger.Debugf(context.Background(), "[detectJSONToolCalls] Part %d: no closing ``` found", i)
				continue
			}

			jsonStr := strings.TrimSpace(codePart[:endIdx])
			logger.Debugf(context.Background(), "[detectJSONToolCalls] Part %d: extracted JSON string length: %d", i, len(jsonStr))
			if jsonStr == "" {
				continue
			}

			toolCall := parseJSONToolCall(jsonStr)
			if toolCall != nil {
				logger.Debugf(context.Background(), "[detectJSONToolCalls] Part %d: successfully parsed tool call: %s", i, toolCall.Function.Name)
				toolCalls = append(toolCalls, *toolCall)
			} else {
				logger.Debugf(context.Background(), "[detectJSONToolCalls] Part %d: parseJSONToolCall returned nil", i)
			}
		}
		if len(toolCalls) > 0 {
			logger.Debugf(context.Background(), "[detectJSONToolCalls] Returning %d tool calls from jsonPattern", len(toolCalls))
			return toolCalls
		}
	} else {
		logger.Debugf(context.Background(), "[detectJSONToolCalls] jsonPattern not found in content")
	}

	// Pattern 2: Bare JSON object after decision tag (e.g., <decision>TOOL_CALL</decision>\n{...})
	if strings.Contains(content, "<decision>TOOL_CALL</decision>") {
		logger.Debugf(context.Background(), "[detectJSONToolCalls] Found decision tag pattern")
		decisionEnd := strings.Index(content, "</decision>")
		if decisionEnd != -1 {
			afterDecision := content[decisionEnd+len("</decision>"):]
			afterDecision = strings.TrimSpace(afterDecision)

			// Find JSON object boundaries
			startIdx := strings.Index(afterDecision, "{")
			if startIdx != -1 {
				jsonStr := extractJSONObject(afterDecision[startIdx:])
				if jsonStr != "" {
					toolCall := parseJSONToolCall(jsonStr)
					if toolCall != nil {
						logger.Debugf(context.Background(), "[detectJSONToolCalls] Decision pattern: parsed tool call: %s", toolCall.Function.Name)
						toolCalls = append(toolCalls, *toolCall)
						return toolCalls
					}
				}
			}
		}
	}

	logger.Debugf(context.Background(), "[detectJSONToolCalls] No tool calls detected, returning empty")
	return toolCalls
}

// extractJSONObject extracts a complete JSON object from a string starting with '{'
func extractJSONObject(s string) string {
	if len(s) == 0 || s[0] != '{' {
		return ""
	}

	depth := 0
	inString := false
	escape := false

	for i, ch := range s {
		if escape {
			escape = false
			continue
		}
		if ch == '\\' && inString {
			escape = true
			continue
		}
		if ch == '"' {
			inString = !inString
			continue
		}
		if inString {
			continue
		}
		if ch == '{' {
			depth++
		} else if ch == '}' {
			depth--
			if depth == 0 {
				return s[:i+1]
			}
		}
	}

	return ""
}

func parseJSONToolCall(jsonStr string) *relay_model.Tool {
	logger.Debugf(context.Background(), "[parseJSONToolCall] Parsing JSON string length: %d", len(jsonStr))

	var args map[string]interface{}
	if err := json.Unmarshal([]byte(jsonStr), &args); err != nil {
		logger.Debugf(context.Background(), "[parseJSONToolCall] JSON unmarshal failed: %v", err)
		return nil
	}

	logger.Debugf(context.Background(), "[parseJSONToolCall] Parsed args, checking for 'command' or 'code' fields")

	if command, hasCommand := args["command"].(string); hasCommand && strings.TrimSpace(command) != "" {
		argsBytes, _ := json.Marshal(args)
		return &relay_model.Tool{
			Id:   fmt.Sprintf("call_%d", rand.Int()),
			Type: "function",
			Function: relay_model.Function{
				Name:      "run_shell",
				Arguments: string(argsBytes),
			},
		}
	}

	code, hasCode := args["code"].(string)
	if !hasCode || code == "" {
		return nil
	}

	if _, hasLang := args["language"].(string); !hasLang {
		args["language"] = "bash"
	}

	argsBytes, _ := json.Marshal(args)
	return &relay_model.Tool{
		Id:   fmt.Sprintf("call_%d", rand.Int()),
		Type: "function",
		Function: relay_model.Function{
			Name:      "code-interpreter",
			Arguments: string(argsBytes),
		},
	}
}

func loadSkillFilesForSandbox(ctx context.Context, skillRootPath string, resources []string) (map[string]string, error) {
	files := make(map[string]string)

	resolvedPath, err := filepath.EvalSymlinks(skillRootPath)
	if err != nil {
		return nil, fmt.Errorf("failed to resolve skill path: %w", err)
	}

	if len(resources) == 0 {
		err := filepath.Walk(resolvedPath, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				return err
			}
			if info.IsDir() {
				return nil
			}
			return appendSkillFile(ctx, files, resolvedPath, path, info)
		})
		return files, err
	}

	for _, entry := range resources {
		pattern := strings.TrimSpace(entry)
		if pattern == "" {
			continue
		}
		if strings.Contains(pattern, "..") || filepath.IsAbs(pattern) {
			logger.Warnf(ctx, "Skip suspicious skill resource pattern: %s", pattern)
			continue
		}
		matches, err := filepath.Glob(filepath.Join(skillRootPath, pattern))
		if err != nil {
			logger.Warnf(ctx, "Invalid skill resource pattern %s: %v", pattern, err)
			continue
		}
		for _, match := range matches {
			info, statErr := os.Stat(match)
			if statErr != nil || info.IsDir() {
				continue
			}
			if err := appendSkillFile(ctx, files, skillRootPath, match, info); err != nil {
				logger.Warnf(ctx, "Skip skill resource %s: %v", match, err)
				continue
			}
		}
	}

	return files, nil
}

func appendSkillFile(ctx context.Context, files map[string]string, root string, absPath string, info os.FileInfo) error {
	if info.Size() > 10*1024*1024 {
		logger.Warnf(ctx, "Skipping large file %s (%d bytes)", absPath, info.Size())
		return nil
	}
	relPath, err := filepath.Rel(root, absPath)
	if err != nil {
		return err
	}
	relPath = filepath.Clean(relPath)
	if strings.HasPrefix(relPath, "..") || filepath.IsAbs(relPath) {
		return fmt.Errorf("path traversal detected: %s", relPath)
	}
	content, err := os.ReadFile(absPath)
	if err != nil {
		return err
	}
	files[filepath.ToSlash(relPath)] = string(content)
	return nil
}

func ensureSkillResourcesSeeded(ctx context.Context, sessionID string, cwd string) error {
	if strings.TrimSpace(sessionID) == "" {
		return nil
	}
	skillRootPath, ok := ctx.Value(SkillRootPathKey).(string)
	if !ok || strings.TrimSpace(skillRootPath) == "" {
		return nil
	}
	resources, _ := ctx.Value(SkillResourcesKey).([]string)
	if len(resources) == 0 {
		return nil
	}

	cacheKey := buildSkillSeedCacheKey(sessionID, skillRootPath, resources)
	if _, exists := seededSessionResources.Load(cacheKey); exists {
		return nil
	}

	files, err := loadSkillFilesForSandbox(ctx, skillRootPath, resources)
	if err != nil {
		return err
	}
	if len(files) == 0 {
		seededSessionResources.Store(cacheKey, struct{}{})
		return nil
	}
	var writeErrors []string
	for path, content := range files {
		_, writeErr := getSandboxClient().WriteFile(ctx, sandboxclient.FileWriteRequest{
			Path:      path,
			Content:   content,
			SessionID: sessionID,
			Cwd:       cwd,
			Append:    false,
		})
		if writeErr != nil {
			logger.Warnf(ctx, "Seed skill resource failed: session=%s, path=%s, err=%v", sessionID, path, writeErr)
			writeErrors = append(writeErrors, fmt.Sprintf("%s: %v", path, writeErr))
		}
	}
	if len(writeErrors) > 0 {
		return fmt.Errorf("seed skill resources failed: %s", strings.Join(writeErrors, "; "))
	}
	seededSessionResources.Store(cacheKey, struct{}{})
	return nil
}

func buildUploadSeedCacheKey(sessionID string, uploadFiles []*model.UploadFile) string {
	parts := make([]string, 0, len(uploadFiles))
	for _, file := range uploadFiles {
		if file == nil {
			continue
		}
		parts = append(parts, fmt.Sprintf("%d:%s:%d", file.ID, file.FileName, file.Size))
	}
	sort.Strings(parts)
	return sessionID + "::uploads::" + strings.Join(parts, "|")
}

func buildSkillSeedCacheKey(sessionID string, skillRootPath string, resources []string) string {
	parts := make([]string, 0, len(resources))
	for _, resource := range resources {
		if trimmed := strings.TrimSpace(resource); trimmed != "" {
			parts = append(parts, trimmed)
		}
	}
	sort.Strings(parts)
	return sessionID + "::skill::" + skillRootPath + "::" + strings.Join(parts, "|")
}

func ensureUploadedFilesSeeded(ctx context.Context, sessionID string, cwd string) error {
	if strings.TrimSpace(sessionID) == "" {
		return nil
	}
	uploadFiles, ok := ctx.Value(UploadedFilesKey).([]*model.UploadFile)
	if !ok || len(uploadFiles) == 0 {
		return nil
	}
	logger.Infof(ctx, "Start upload seed for sandbox session: session=%s, uploaded_files=%d", sessionID, len(uploadFiles))

	cacheKey := buildUploadSeedCacheKey(sessionID, uploadFiles)
	if _, exists := seededSessionResources.Load(cacheKey); exists {
		return nil
	}

	downloads := BuildFileDownloadsFromUploadFiles(ctx, uploadFiles)
	logger.Infof(ctx, "【沙盒】准备注入上传文件: session=%s cwd=%s count=%d", sessionID, cwd, len(downloads))
	for _, download := range downloads {
		logger.Infof(ctx, "【沙盒】download_files 请求项: session=%s file_name=%s url=%s mime=%s size=%d",
			sessionID, download.FileName, logger.SanitizeURL(download.URL), download.MimeType, download.Size)
	}
	if len(downloads) == 0 {
		seededSessionResources.Store(cacheKey, struct{}{})
		logger.Warnf(ctx, "No valid uploaded files to seed into sandbox session: session=%s", sessionID)
		return nil
	}

	seedReq := sandboxclient.ExecuteCodeRequest{
		Code:          "print('seed_uploaded_files')",
		Language:      "python",
		Timeout:       30,
		SessionID:     sessionID,
		Cwd:           cwd,
		DownloadFiles: downloads,
	}
	resp, err := getSandboxClient().ExecuteCode(ctx, seedReq)
	if err != nil {
		return fmt.Errorf("上传文件注入沙盒失败，请稍后重试: %v", err)
	}
	if resp.ExitCode != 0 {
		return fmt.Errorf("上传文件注入沙盒失败，seed 执行异常: %s", formatCommandResult(resp.Stdout, resp.Stderr, resp.ExitCode))
	}

	seededSessionResources.Store(cacheKey, struct{}{})
	logger.Infof(ctx, "Seeded %d uploaded files into sandbox session: session=%s", len(downloads), sessionID)
	if listResp, listErr := getSandboxClient().ListFiles(ctx, sandboxclient.FileListRequest{
		Path:       ".",
		SessionID:  sessionID,
		Cwd:        cwd,
		Recursive:  false,
		MaxEntries: 500,
	}); listErr != nil {
		logger.Warnf(ctx, "Failed to list sandbox files after upload seed: session=%s, err=%v", sessionID, listErr)
	} else {
		logger.Infof(ctx, "Sandbox workspace visibility after upload seed: session=%s, visible_files=%d", sessionID, len(listResp.Entries))
	}
	return nil
}

func ensureSandboxSessionSeeded(ctx context.Context, sessionID string, cwd string) error {
	if err := ensureSkillResourcesSeeded(ctx, sessionID, cwd); err != nil {
		logger.Warnf(ctx, "Skill resource seed failed: session=%s, err=%v", sessionID, err)
	}
	if err := ensureUploadedFilesSeeded(ctx, sessionID, cwd); err != nil {
		return err
	}
	return nil
}

func hasUploadedFilesInContext(ctx context.Context) bool {
	uploadFiles, ok := ctx.Value(UploadedFilesKey).([]*model.UploadFile)
	return ok && len(uploadFiles) > 0
}

func isLikelyMissingFileError(output string) bool {
	lower := strings.ToLower(output)
	return strings.Contains(lower, "no such file") ||
		strings.Contains(lower, "file not found") ||
		strings.Contains(lower, "does not exist") ||
		strings.Contains(output, "文件不存在") ||
		strings.Contains(output, "找不到文件") ||
		strings.Contains(output, "没有那个文件")
}

func forceReseedUploadedFiles(ctx context.Context, sessionID string, cwd string) error {
	if strings.TrimSpace(sessionID) == "" {
		return nil
	}
	uploadFiles, ok := ctx.Value(UploadedFilesKey).([]*model.UploadFile)
	if !ok || len(uploadFiles) == 0 {
		return nil
	}
	cacheKey := buildUploadSeedCacheKey(sessionID, uploadFiles)
	seededSessionResources.Delete(cacheKey)
	return ensureUploadedFilesSeeded(ctx, sessionID, cwd)
}

func buildSkillFilesForSandbox(ctx context.Context) (map[string]string, error) {
	files := make(map[string]string)

	if runtime := loadRuntimeSeedFilesFromContext(ctx); len(runtime) > 0 {
		for k, v := range runtime {
			files[k] = v
		}
	}

	skillRootPath, ok := ctx.Value(SkillRootPathKey).(string)
	if !ok || strings.TrimSpace(skillRootPath) == "" {
		if len(files) == 0 {
			return nil, nil
		}
		return files, nil
	}

	var resources []string
	if raw := ctx.Value(SkillResourcesKey); raw != nil {
		if list, ok := raw.([]string); ok {
			resources = list
		}
	}

	skillFiles, err := loadSkillFilesForSandbox(ctx, skillRootPath, resources)
	if err != nil {
		return nil, err
	}
	for k, v := range skillFiles {
		// Runtime seed files have higher priority than static skill resources.
		if _, exists := files[k]; !exists {
			files[k] = v
		}
	}

	if len(files) == 0 {
		return nil, nil
	}
	return files, nil
}

func loadRuntimeSeedFilesFromContext(ctx context.Context) map[string]string {
	raw := ctx.Value(RuntimeSeedFilesKey)
	if raw == nil {
		return nil
	}
	seedFiles, ok := raw.(map[string]string)
	if !ok || len(seedFiles) == 0 {
		return nil
	}

	sanitized := make(map[string]string, len(seedFiles))
	for p, content := range seedFiles {
		normalized := filepath.ToSlash(filepath.Clean(strings.TrimSpace(p)))
		if normalized == "" || normalized == "." || strings.HasPrefix(normalized, "..") || strings.HasPrefix(normalized, "/") {
			continue
		}
		sanitized[normalized] = content
	}
	if len(sanitized) == 0 {
		return nil
	}
	return sanitized
}

func normalizeSandboxRelativePath(raw string) (string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", nil
	}
	normalized := strings.TrimLeft(trimmed, "/")
	normalized = strings.TrimPrefix(normalized, "./")
	if normalized == "" {
		return ".", nil
	}
	normalized = filepath.ToSlash(filepath.Clean(normalized))
	if normalized == "" || normalized == "." {
		return ".", nil
	}
	if strings.HasPrefix(normalized, "../") || normalized == ".." {
		return "", fmt.Errorf("path must be relative to the sandbox workspace: %s", raw)
	}
	return normalized, nil
}

func normalizeSandboxWorkspacePath(fileName string) (string, error) {
	normalized, err := normalizeSandboxRelativePath(fileName)
	if err != nil {
		return "", err
	}
	if normalized == "" || normalized == "." {
		return "", fmt.Errorf("missing path argument")
	}
	return normalized, nil
}

func normalizeSandboxInputPath(fileName string) (string, error) {
	normalized, err := normalizeSandboxWorkspacePath(fileName)
	if err != nil {
		return "", err
	}
	if strings.HasPrefix(normalized, "output/") || strings.HasPrefix(normalized, "outputs/") {
		return normalized, nil
	}
	if strings.HasPrefix(normalized, "inputs/") || strings.HasPrefix(normalized, "tmp/") || strings.HasPrefix(normalized, "skills/") {
		return normalized, nil
	}
	return filepath.ToSlash(filepath.Join("inputs", normalized)), nil
}

func shouldNormalizeSandboxDeliverablePath(fileName string) bool {
	switch strings.ToLower(filepath.Ext(strings.TrimSpace(fileName))) {
	case ".docx", ".doc", ".pdf", ".xlsx", ".xls", ".csv", ".pptx", ".ppt",
		".txt", ".md", ".markdown", ".html", ".xml", ".yaml", ".yml",
		".zip", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".mp3", ".wav", ".m4a", ".mp4", ".mov":
		return true
	default:
		return false
	}
}

func normalizeSandboxDeliverablePath(fileName string) (string, error) {
	normalized, err := normalizeSandboxRelativePath(fileName)
	if err != nil {
		return "", err
	}
	if normalized == "" || normalized == "." {
		return "", fmt.Errorf("missing path argument")
	}
	if strings.Contains(normalized, "/") {
		return normalized, nil
	}
	if shouldNormalizeSandboxDeliverablePath(normalized) {
		return "output/" + filepath.Base(normalized), nil
	}
	return normalized, nil
}

func normalizeSandboxRuntimePath(fileName string) (string, error) {
	normalized, err := normalizeSandboxRelativePath(fileName)
	if err != nil {
		return "", err
	}
	if normalized == "" || normalized == "." {
		return "", fmt.Errorf("missing path argument")
	}
	if strings.HasPrefix(normalized, "output/") || strings.HasPrefix(normalized, "outputs/") {
		return normalized, nil
	}
	if strings.HasPrefix(normalized, "inputs/") || strings.HasPrefix(normalized, "tmp/") || strings.HasPrefix(normalized, "skills/") {
		return normalized, nil
	}
	if shouldNormalizeSandboxDeliverablePath(normalized) {
		return "output/" + filepath.Base(normalized), nil
	}
	return filepath.ToSlash(filepath.Join("inputs", normalized)), nil
}

func executeRunShell(ctx context.Context, args map[string]interface{}) (*ToolResult, error) {
	command, ok := args["command"].(string)
	if !ok || strings.TrimSpace(command) == "" {
		return nil, fmt.Errorf("missing command argument")
	}

	timeout := 30
	if v, exists := args["timeout"]; exists {
		timeout = parseIntValue(v, timeout)
	}
	cwd := resolveSandboxCWD(ctx, args)
	if _, err := normalizeSandboxRelativePath(cwd); err != nil {
		return nil, err
	}
	req := sandboxclient.ShellRequest{
		Command:   command,
		Timeout:   timeout,
		SessionID: resolveSandboxSessionID(ctx, args),
		Cwd:       cwd,
		EnvVars:   resolveSandboxEnvVars(ctx, args),
	}
	if files, err := buildSkillFilesForSandbox(ctx); err != nil {
		logger.Warnf(ctx, "Failed to build skill files for shell execution: %v", err)
	} else if len(files) > 0 {
		req.Files = files
	}
	if err := ensureSandboxSessionSeeded(ctx, req.SessionID, req.Cwd); err != nil {
		return nil, err
	}

	resp, err := getSandboxClient().ExecuteShell(ctx, req)
	if err != nil {
		return nil, wrapSandboxServiceError(err)
	}
	output := formatCommandResult(resp.Stdout, resp.Stderr, resp.ExitCode)
	var outputMeta map[string]interface{}
	if agentSuccessRateFeatureFlagsFromContext(ctx).ShellOutputV2 {
		output, outputMeta = shapeShellOutput(resp.Stdout, resp.Stderr, resp.ExitCode)
	}
	if resp.ExitCode != 0 && hasUploadedFilesInContext(ctx) && isLikelyMissingFileError(output) {
		logger.Warnf(ctx, "run_shell detected missing-file error, trying one upload reseed retry: session=%s, cwd=%s", req.SessionID, req.Cwd)
		if reseedErr := forceReseedUploadedFiles(ctx, req.SessionID, req.Cwd); reseedErr != nil {
			logger.Warnf(ctx, "run_shell upload reseed retry skipped due to seed error: %v", reseedErr)
		} else {
			retryResp, retryErr := getSandboxClient().ExecuteShell(ctx, req)
			if retryErr != nil {
				logger.Warnf(ctx, "run_shell retry after upload reseed failed: %v", retryErr)
			} else {
				resp = retryResp
				output = formatCommandResult(resp.Stdout, resp.Stderr, resp.ExitCode)
				if agentSuccessRateFeatureFlagsFromContext(ctx).ShellOutputV2 {
					output, outputMeta = shapeShellOutput(resp.Stdout, resp.Stderr, resp.ExitCode)
				}
				logger.Infof(ctx, "run_shell retry after upload reseed completed: exit_code=%d", resp.ExitCode)
			}
		}
	}

	return &ToolResult{
		Output:   output,
		Stderr:   resp.Stderr,
		ExitCode: resp.ExitCode,
		Meta:     outputMeta,
		OutputFiles: func() []OutputFile {
			outputFiles, snapshot := filterSandboxOutputFilesBySnapshot(loadSandboxOutputSnapshot(ctx), convertSandboxOutputFiles(resp.OutputFiles))
			rememberSandboxOutputSnapshot(ctx, snapshot)
			return outputFiles
		}(),
	}, nil
}

func executeReadFile(ctx context.Context, args map[string]interface{}) (*ToolResult, error) {
	path, ok := args["path"].(string)
	if !ok || strings.TrimSpace(path) == "" {
		return nil, fmt.Errorf("missing path argument")
	}
	path, err := normalizeSandboxWorkspacePath(path)
	if err != nil {
		return nil, err
	}

	maxBytes := 0
	if v, exists := args["max_bytes"]; exists {
		maxBytes = parseIntValue(v, 0)
	}

	cwd := resolveSandboxCWD(ctx, args)
	if _, err := normalizeSandboxRelativePath(cwd); err != nil {
		return nil, err
	}

	req := sandboxclient.FileReadRequest{
		Path:      path,
		SessionID: resolveSandboxSessionID(ctx, args),
		Cwd:       cwd,
		MaxBytes:  maxBytes,
	}
	if files, err := buildSkillFilesForSandbox(ctx); err != nil {
		logger.Warnf(ctx, "Failed to build skill files for read_file: %v", err)
	} else if len(files) > 0 {
		req.Files = files
	}
	if err := ensureSandboxSessionSeeded(ctx, req.SessionID, req.Cwd); err != nil {
		return nil, err
	}
	resp, err := getSandboxClient().ReadFile(ctx, req)
	if err != nil {
		return nil, wrapSandboxServiceError(err)
	}

	if resp.Content == "" {
		return &ToolResult{Output: "(Empty file)", ExitCode: 0}, nil
	}
	page := buildReadFilePageWithContinuation(resp.Content, args, agentSuccessRateFeatureFlagsFromContext(ctx).ReadContinuation)
	paginated := page.Output
	if strings.TrimSpace(paginated) == "" {
		return &ToolResult{Output: "(Empty file)", ExitCode: 0}, nil
	}
	features := agentSuccessRateFeatureFlagsFromContext(ctx)
	if paginated != resp.Content && !features.ReadContinuation {
		paginated += "\n\n【说明】这是文件预览，省略部分是正常截断，不代表文件损坏。如需更多内容，请通过 offset/limit/tail_lines 继续读取。"
	}
	result := &ToolResult{Output: paginated, ExitCode: 0}
	if features.ReadContinuation {
		result.Meta = page.Meta()
	}
	return result, nil
}

func executeWriteFile(ctx context.Context, args map[string]interface{}) (*ToolResult, error) {
	return executeWriteFileWithPathNormalizer(ctx, args, normalizeSandboxRuntimePath, "write_file")
}

func executePrepareInputFile(ctx context.Context, args map[string]interface{}) (*ToolResult, error) {
	return executeWriteFileWithPathNormalizer(ctx, args, normalizeSandboxInputPath, "prepare_input_file")
}

func executeWriteFileWithPathNormalizer(ctx context.Context, args map[string]interface{}, normalizePath func(string) (string, error), toolName string) (*ToolResult, error) {
	path, ok := args["path"].(string)
	if !ok || strings.TrimSpace(path) == "" {
		return nil, fmt.Errorf("missing path argument")
	}
	path, err := normalizePath(path)
	if err != nil {
		return nil, err
	}
	content, ok := args["content"].(string)
	if !ok {
		return nil, fmt.Errorf("missing content argument")
	}
	appendMode := false
	if v, exists := args["append"]; exists {
		appendMode = parseBoolValue(v)
	}
	createIfMissing := true
	if v, exists := args["create_if_missing"]; exists {
		createIfMissing = parseBoolValue(v)
	}
	cwd := resolveSandboxCWD(ctx, args)
	if _, err := normalizeSandboxRelativePath(cwd); err != nil {
		return nil, err
	}
	content = normalizeSandboxTextContentForPath(path, content)

	req := sandboxclient.FileWriteRequest{
		Path:      path,
		Content:   content,
		Append:    appendMode,
		SessionID: resolveSandboxSessionID(ctx, args),
		Cwd:       cwd,
	}
	if files, err := buildSkillFilesForSandbox(ctx); err != nil {
		logger.Warnf(ctx, "Failed to build skill files for %s: %v", toolName, err)
	} else if len(files) > 0 {
		req.Files = files
	}
	if err := ensureSandboxSessionSeeded(ctx, req.SessionID, req.Cwd); err != nil {
		return nil, err
	}
	if !createIfMissing {
		if _, readErr := getSandboxClient().ReadFile(ctx, sandboxclient.FileReadRequest{
			Path:      req.Path,
			SessionID: req.SessionID,
			Cwd:       req.Cwd,
		}); readErr != nil {
			if isSandboxFileNotFound(readErr) {
				return nil, fmt.Errorf("target file does not exist and create_if_missing=false: %s", req.Path)
			}
			return nil, wrapSandboxServiceError(readErr)
		}
	}
	resp, err := getSandboxClient().WriteFile(ctx, req)
	if err != nil {
		return nil, wrapSandboxServiceError(err)
	}
	if err := formatSandboxClientWrittenFile(ctx, req.SessionID, req.Cwd, req.Path); err != nil {
		return nil, err
	}
	if err := validateSandboxClientWrittenFile(ctx, req.SessionID, req.Cwd, req.Path); err != nil {
		return nil, err
	}

	outputFiles, err := buildWriteFileOutputFiles(ctx, req, content)
	if err != nil {
		logger.Warnf(ctx, "Failed to build write_file output files for %s: %v", resp.Path, err)
	}
	outputFiles, snapshot := filterSandboxOutputFilesBySnapshot(loadSandboxOutputSnapshot(ctx), outputFiles)
	rememberSandboxOutputSnapshot(ctx, snapshot)

	return &ToolResult{
		Output:      fmt.Sprintf("Wrote %d bytes to %s ", resp.Written, resp.Path),
		ExitCode:    0,
		OutputFiles: outputFiles,
	}, nil
}

func executeEditFile(ctx context.Context, args map[string]interface{}) (*ToolResult, error) {
	if agentSuccessRateFeatureFlagsFromContext(ctx).EditV2 {
		return executeEditFileV2(ctx, args)
	}
	path, ok := args["path"].(string)
	if !ok || strings.TrimSpace(path) == "" {
		return nil, fmt.Errorf("missing path argument")
	}
	path, err := normalizeSandboxWorkspacePath(path)
	if err != nil {
		return nil, err
	}
	oldString, ok := args["old_string"].(string)
	if !ok || oldString == "" {
		return nil, fmt.Errorf("missing old_string argument")
	}
	newString, ok := args["new_string"].(string)
	if !ok {
		return nil, fmt.Errorf("missing new_string argument")
	}
	replaceAll := false
	if v, exists := args["replace_all"]; exists {
		replaceAll = parseBoolValue(v)
	}

	sessionID := resolveSandboxSessionID(ctx, args)
	cwd := resolveSandboxCWD(ctx, args)
	if _, err := normalizeSandboxRelativePath(cwd); err != nil {
		return nil, err
	}
	if err := ensureSandboxSessionSeeded(ctx, sessionID, cwd); err != nil {
		return nil, err
	}

	readResp, err := getSandboxClient().ReadFile(ctx, sandboxclient.FileReadRequest{
		Path:      path,
		SessionID: sessionID,
		Cwd:       cwd,
	})
	if err != nil {
		return nil, wrapSandboxServiceError(err)
	}

	content := readResp.Content
	matchCount := strings.Count(content, oldString)
	if matchCount == 0 {
		return nil, fmt.Errorf("old_string not found in file")
	}
	if !replaceAll && matchCount > 1 {
		return nil, fmt.Errorf("old_string found %d times, set replace_all=true or provide a more specific match", matchCount)
	}

	newContent := content
	replacements := 1
	if replaceAll {
		newContent = strings.ReplaceAll(content, oldString, newString)
		replacements = matchCount
	} else {
		newContent = strings.Replace(content, oldString, newString, 1)
	}

	writeReq := sandboxclient.FileWriteRequest{
		Path:      path,
		Content:   newContent,
		Append:    false,
		SessionID: sessionID,
		Cwd:       cwd,
	}
	if files, buildErr := buildSkillFilesForSandbox(ctx); buildErr != nil {
		logger.Warnf(ctx, "Failed to build skill files for edit: %v", buildErr)
	} else if len(files) > 0 {
		writeReq.Files = files
	}
	if _, err := getSandboxClient().WriteFile(ctx, writeReq); err != nil {
		return nil, wrapSandboxServiceError(err)
	}
	if err := formatSandboxClientWrittenFile(ctx, writeReq.SessionID, writeReq.Cwd, writeReq.Path); err != nil {
		return nil, err
	}
	if err := validateSandboxClientWrittenFile(ctx, writeReq.SessionID, writeReq.Cwd, writeReq.Path); err != nil {
		return nil, err
	}

	statusNote := "content not validated"
	if strings.TrimSpace(writeReq.SessionID) != "" {
		statusNote = "content formatted and validated"
	}
	return &ToolResult{
		Output:   fmt.Sprintf("Edited %s (%d replacement(s), %s)", path, replacements, statusNote),
		ExitCode: 0,
	}, nil
}

func buildWriteFileOutputFiles(ctx context.Context, req sandboxclient.FileWriteRequest, content string) ([]OutputFile, error) {
	outputPath, err := normalizeSandboxDeliverablePath(req.Path)
	if err != nil {
		return nil, err
	}
	if !isAllowedSandboxOutputPath(outputPath) {
		return nil, nil
	}

	finalContent := content
	if strings.TrimSpace(req.SessionID) != "" {
		readResp, err := getSandboxClient().ReadFile(ctx, sandboxclient.FileReadRequest{
			Path:      req.Path,
			SessionID: req.SessionID,
			Cwd:       req.Cwd,
		})
		if err != nil {
			return nil, wrapSandboxServiceError(err)
		}
		finalContent = readResp.Content
	}

	mimeType := mime.TypeByExtension(filepath.Ext(outputPath))
	if strings.TrimSpace(mimeType) == "" {
		mimeType = "application/octet-stream"
	}

	return []OutputFile{
		{
			FileName: outputPath,
			Content:  base64.StdEncoding.EncodeToString([]byte(finalContent)),
			MimeType: mimeType,
			Size:     len([]byte(finalContent)),
		},
	}, nil
}

func executeListFiles(ctx context.Context, args map[string]interface{}) (*ToolResult, error) {
	path := "."
	if v, exists := args["path"]; exists {
		if p, ok := v.(string); ok && strings.TrimSpace(p) != "" {
			path = p
		}
	}
	if normalized, err := normalizeSandboxRelativePath(path); err == nil {
		path = normalized
	} else {
		return nil, err
	}
	req := sandboxclient.FileListRequest{
		Path:       path,
		SessionID:  resolveSandboxSessionID(ctx, args),
		Cwd:        resolveSandboxCWD(ctx, args),
		Recursive:  parseBoolValue(args["recursive"]),
		MaxEntries: parseIntValue(args["max_entries"], 200),
	}
	if files, err := buildSkillFilesForSandbox(ctx); err != nil {
		logger.Warnf(ctx, "Failed to build skill files for list_files: %v", err)
	} else if len(files) > 0 {
		req.Files = files
	}
	if err := ensureSandboxSessionSeeded(ctx, req.SessionID, req.Cwd); err != nil {
		return nil, err
	}
	resp, err := getSandboxClient().ListFiles(ctx, req)
	if err != nil {
		return nil, wrapSandboxServiceError(err)
	}

	if len(resp.Entries) == 0 {
		return &ToolResult{Output: "(No files found)", ExitCode: 0}, nil
	}
	return &ToolResult{Output: strings.Join(resp.Entries, "\n"), ExitCode: 0}, nil
}

func ParseToolArguments(argStr string) (map[string]interface{}, error) {
	var lastErr error

	if parsed, err := parseToolArgumentObject(argStr); err == nil {
		return parsed, nil
	} else {
		lastErr = err
	}

	// 某些模型会把 arguments 再包一层 JSON string，这里做一次兜底解析。
	var wrapped string
	if err := json.Unmarshal([]byte(argStr), &wrapped); err == nil {
		if parsed, innerErr := parseToolArgumentObject(wrapped); innerErr == nil {
			return parsed, nil
		} else {
			lastErr = innerErr
		}
	} else {
		lastErr = err
	}

	trimmed := strings.TrimSpace(argStr)
	trimmed = strings.Trim(trimmed, `"'`)
	if trimmed != argStr {
		if parsed, err := parseToolArgumentObject(trimmed); err == nil {
			return parsed, nil
		} else {
			lastErr = err
		}
	}

	// 提取首个完整 JSON 对象，兼容模型在 arguments 后追加噪声文本的场景。
	if extracted := extractFirstJSONObject(trimmed); extracted != "" && extracted != trimmed {
		if parsed, err := parseToolArgumentObject(extracted); err == nil {
			return parsed, nil
		} else {
			lastErr = err
		}
	}

	if lastErr != nil {
		return nil, fmt.Errorf("parse tool arguments failed: %w", lastErr)
	}
	return nil, fmt.Errorf("parse tool arguments failed")
}

// parseToolArgumentObject keeps the final tool-argument repair deliberately
// narrow. It repairs only invalid string escapes and raw control characters,
// following Pi's conservative repairJson behavior. Structural truncation,
// missing braces, and missing fields remain errors and must be retried by the
// model instead of being turned into an executable request.
func parseToolArgumentObject(raw string) (map[string]interface{}, error) {
	var args map[string]interface{}
	if err := json.Unmarshal([]byte(raw), &args); err == nil {
		return args, nil
	}

	repaired, changed := repairJSONStrings(raw)
	if !changed {
		var lastErr error
		if err := json.Unmarshal([]byte(raw), &args); err != nil {
			lastErr = err
		}
		return nil, lastErr
	}

	if err := json.Unmarshal([]byte(repaired), &args); err != nil {
		return nil, err
	}
	return args, nil
}

func repairJSONStrings(raw string) (string, bool) {
	const validEscapes = `"\\/bfnrtu`
	runes := []rune(raw)
	var builder strings.Builder
	builder.Grow(len(raw) + 16)
	inString := false
	escaped := false
	changed := false

	for index := 0; index < len(runes); index++ {
		r := runes[index]
		if !inString {
			builder.WriteRune(r)
			if r == '"' {
				inString = true
			}
			continue
		}

		if escaped {
			if r == 'u' {
				if index+4 < len(runes) && isHexRune(runes[index+1]) && isHexRune(runes[index+2]) && isHexRune(runes[index+3]) && isHexRune(runes[index+4]) {
					builder.WriteString(`\u`)
					for offset := 1; offset <= 4; offset++ {
						builder.WriteRune(runes[index+offset])
					}
					index += 4
					escaped = false
					continue
				}
				builder.WriteString(`\\u`)
				changed = true
				escaped = false
				continue
			}
			if strings.ContainsRune(validEscapes, r) {
				builder.WriteRune('\\')
				builder.WriteRune(r)
				escaped = false
				continue
			}
			builder.WriteString(`\\`)
			builder.WriteRune(r)
			changed = true
			escaped = false
			continue
		}

		switch r {
		case '"':
			builder.WriteRune(r)
			inString = false
		case '\\':
			escaped = true
		case '\b':
			builder.WriteString(`\b`)
			changed = true
		case '\f':
			builder.WriteString(`\f`)
			changed = true
		case '\n':
			builder.WriteString(`\n`)
			changed = true
		case '\r':
			builder.WriteString(`\r`)
			changed = true
		case '\t':
			builder.WriteString(`\t`)
			changed = true
		default:
			if r < 0x20 {
				builder.WriteString(fmt.Sprintf(`\u%04x`, r))
				changed = true
				continue
			}
			builder.WriteRune(r)
		}
	}

	if escaped {
		// A trailing backslash is structural truncation, not a repairable escape.
		return raw, false
	}
	return builder.String(), changed
}

func isHexRune(r rune) bool {
	return r >= '0' && r <= '9' || r >= 'a' && r <= 'f' || r >= 'A' && r <= 'F'
}

// extractFirstJSONObject extracts the first balanced JSON object from raw text.
// It is intentionally conservative: only returns content when braces are balanced.
func extractFirstJSONObject(raw string) string {
	start := strings.Index(raw, "{")
	if start < 0 {
		return ""
	}

	depth := 0
	inString := false
	escape := false

	for i := start; i < len(raw); i++ {
		ch := raw[i]

		if inString {
			if escape {
				escape = false
				continue
			}
			if ch == '\\' {
				escape = true
				continue
			}
			if ch == '"' {
				inString = false
			}
			continue
		}

		switch ch {
		case '"':
			inString = true
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return raw[start : i+1]
			}
			if depth < 0 {
				return ""
			}
		}
	}

	return ""
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func getSandboxClient() *sandboxclient.Client {
	return sandboxclient.NewClient(config.SandboxServiceURL)
}

func parseBoolValue(value interface{}) bool {
	switch v := value.(type) {
	case bool:
		return v
	case string:
		return strings.EqualFold(strings.TrimSpace(v), "true")
	default:
		return false
	}
}

func formatSandboxClientWrittenFile(ctx context.Context, sessionID string, cwd string, path string) error {
	if strings.TrimSpace(sessionID) == "" {
		return nil
	}
	spec, ok := sandboxRuntimeFormatSpecForPath(path)
	if !ok {
		return nil
	}
	resp, err := getSandboxClient().ExecuteShell(ctx, sandboxclient.ShellRequest{
		Command:   spec.command,
		Timeout:   20,
		SessionID: sessionID,
		Cwd:       cwd,
		EnvVars:   map[string]string{"SANDBOX_PREVIEW_PATH": path},
	})
	if err != nil {
		return wrapSandboxServiceError(err)
	}
	if resp.ExitCode != 0 {
		return fmt.Errorf("%s format failed: %s", path, formatCommandResult(resp.Stdout, resp.Stderr, resp.ExitCode))
	}
	return nil
}

func preflightSandboxClientCode(ctx context.Context, sessionID string, cwd string, language string, code string) error {
	if strings.TrimSpace(sessionID) == "" || strings.TrimSpace(code) == "" {
		return nil
	}
	spec, ok := sandboxRuntimeSyntaxCheckSpecForLanguage(language)
	if !ok {
		return nil
	}
	code = normalizeSandboxTextContentForLanguage(language, code)

	tempPath := filepath.ToSlash(filepath.Join("tmp", "preflight", fmt.Sprintf("snippet-%d%s", time.Now().UnixNano(), spec.extension)))
	if _, err := getSandboxClient().WriteFile(ctx, sandboxclient.FileWriteRequest{
		Path:      tempPath,
		Content:   code,
		SessionID: sessionID,
		Cwd:       cwd,
	}); err != nil {
		return wrapSandboxServiceError(err)
	}
	defer cleanupSandboxClientTempFile(ctx, sessionID, cwd, tempPath)

	if err := formatSandboxClientWrittenFile(ctx, sessionID, cwd, tempPath); err != nil {
		return err
	}
	if err := validateSandboxClientWrittenFile(ctx, sessionID, cwd, tempPath); err != nil {
		return err
	}
	return nil
}

func cleanupSandboxClientTempFile(ctx context.Context, sessionID string, cwd string, path string) {
	if strings.TrimSpace(sessionID) == "" || strings.TrimSpace(path) == "" {
		return
	}
	_, _ = getSandboxClient().ExecuteShell(ctx, sandboxclient.ShellRequest{
		Command:   "rm -f \"$SANDBOX_PREVIEW_PATH\"",
		Timeout:   5,
		SessionID: sessionID,
		Cwd:       cwd,
		EnvVars:   map[string]string{"SANDBOX_PREVIEW_PATH": path},
	})
}

func validateSandboxClientWrittenFile(ctx context.Context, sessionID string, cwd string, path string) error {
	if strings.TrimSpace(sessionID) == "" {
		return nil
	}
	spec, ok := sandboxRuntimeSyntaxCheckSpecForPath(path)
	if !ok {
		return nil
	}
	resp, err := getSandboxClient().ExecuteShell(ctx, sandboxclient.ShellRequest{
		Command:   spec.command,
		Timeout:   20,
		SessionID: sessionID,
		Cwd:       cwd,
		EnvVars:   map[string]string{"SANDBOX_PREVIEW_PATH": path},
	})
	if err != nil {
		return wrapSandboxServiceError(err)
	}
	if resp.ExitCode != 0 {
		return fmt.Errorf("%s syntax validation failed: %s", path, formatCommandResult(resp.Stdout, resp.Stderr, resp.ExitCode))
	}
	return nil
}

func parseIntValue(value interface{}, defaultValue int) int {
	switch v := value.(type) {
	case int:
		return v
	case int32:
		return int(v)
	case int64:
		return int(v)
	case float32:
		return int(v)
	case float64:
		return int(v)
	case string:
		parsed, err := strconv.Atoi(strings.TrimSpace(v))
		if err == nil {
			return parsed
		}
	}
	return defaultValue
}

type readFilePage struct {
	Output         string
	StartLine      int
	EndLine        int
	TotalLines     int
	HasMore        bool
	NextOffset     int
	NextByteOffset int
	UseByteOffset  bool
	Truncated      bool
	TruncateReason string
}

func (p readFilePage) Meta() map[string]interface{} {
	return map[string]interface{}{
		"read_range": map[string]interface{}{
			"start_line": p.StartLine, "end_line": p.EndLine, "total_lines": p.TotalLines,
			"has_more": p.HasMore, "next_offset": p.NextOffset, "next_byte_offset": p.NextByteOffset,
		},
		"byte_count": len([]byte(p.Output)), "truncated": p.Truncated, "truncate_reason": p.TruncateReason,
	}
}

func paginateReadFileContent(content string, args map[string]interface{}) string {
	return buildReadFilePage(content, args).Output
}

// buildReadFilePage preserves the legacy zero-based input offset and exposes
// human-readable one-based line numbers in its result metadata.
func buildReadFilePage(content string, args map[string]interface{}) readFilePage {
	return buildReadFilePageWithContinuation(content, args, agentSuccessRateFeatureFlagsFromContext(context.Background()).ReadContinuation)
}

func buildReadFilePageWithContinuation(content string, args map[string]interface{}, readContinuation bool) readFilePage {
	const readFileMaxChars = 50000
	if byteOffset := parseIntValue(args["byte_offset"], 0); byteOffset > 0 {
		return buildReadFileBytePage(content, byteOffset, readFileMaxChars)
	}

	lines := strings.Split(content, "\n")
	total := len(lines)
	if total == 0 {
		return readFilePage{}
	}

	tailLines := parseIntValue(args["tail_lines"], 0)
	offset := parseIntValue(args["offset"], 0)
	limit := parseIntValue(args["limit"], 0)

	start := 0
	end := total

	if tailLines > 0 {
		if tailLines < total {
			start = total - tailLines
		}
	} else {
		if offset > 0 {
			if offset >= total {
				return readFilePage{Output: fmt.Sprintf("(offset %d exceeds file length of %d lines)", offset, total), TotalLines: total}
			}
			start = offset
		}
		if limit > 0 && start+limit < end {
			end = start + limit
		}
	}

	sliced := lines[start:end]
	output := strings.Join(sliced, "\n")
	page := readFilePage{Output: output, StartLine: start + 1, EndLine: end, TotalLines: total, HasMore: end < total, NextOffset: end}
	if runeLen(output) > readFileMaxChars {
		keptLines := make([]string, 0, len(sliced))
		usedChars := 0
		for _, line := range sliced {
			lineChars := runeLen(line)
			additional := lineChars
			if len(keptLines) > 0 {
				additional += 1 // newline between lines
			}
			if usedChars+additional > readFileMaxChars {
				break
			}
			keptLines = append(keptLines, line)
			usedChars += additional
		}
		if len(keptLines) == 0 && len(sliced) > 0 {
			runes := []rune(sliced[0])
			keep := min(len(runes), readFileMaxChars)
			keptLines = append(keptLines, string(runes[:keep]))
			page.TruncateReason = "line_too_large"
			page.UseByteOffset = true
			page.NextByteOffset = len([]byte(keptLines[0]))
		}
		shownLines := len(keptLines)
		if shownLines <= 0 {
			page.Output = fmt.Sprintf("[Output capped at %d chars. File has %d total lines. Use offset=0 limit=<n> to continue reading.]", readFileMaxChars, total)
			page.Truncated, page.TruncateReason, page.HasMore, page.NextOffset = true, "max_bytes", true, start
			return page
		}
		endLine := start + shownLines
		if !readContinuation {
			page.Output = strings.Join(keptLines, "\n") + fmt.Sprintf(
				"\n\n[Output capped at %d chars. Showing lines %d-%d of %d total. Use offset=%d limit=<n> to continue reading.]",
				readFileMaxChars, start, endLine-1, total, endLine,
			)
			return page
		}
		page.Output = strings.Join(keptLines, "\n")
		page.EndLine, page.NextOffset, page.HasMore, page.Truncated = endLine, endLine, endLine < total, true
		if page.UseByteOffset {
			page.HasMore = page.NextByteOffset < len(content)
			page.Output += fmt.Sprintf("\n\n[当前显示超大行的前 %d 个字符。继续读取请使用 byte_offset=%d。]", readFileMaxChars, page.NextByteOffset)
		} else {
			page.Output += fmt.Sprintf("\n\n[当前显示第 %d—%d 行，共 %d 行。继续读取请使用 offset=%d。]", start+1, endLine, total, endLine)
		}
		if page.TruncateReason == "" {
			page.TruncateReason = "line_limit"
		}
		return page
	}

	if readContinuation && page.HasMore {
		page.Output += fmt.Sprintf("\n\n[当前显示第 %d—%d 行，共 %d 行。继续读取请使用 offset=%d。]", page.StartLine, page.EndLine, total, page.NextOffset)
	} else if tailLines > 0 {
		page.Output += fmt.Sprintf("\n\n[Showing last %d lines of %d total]", len(sliced), total)
	} else if offset > 0 || limit > 0 {
		page.Output += fmt.Sprintf("\n\n[Showing lines %d-%d of %d total]", start, end-1, total)
	}
	return page
}

func buildReadFileBytePage(content string, byteOffset, maxChars int) readFilePage {
	if byteOffset >= len(content) {
		return readFilePage{Output: fmt.Sprintf("(byte_offset %d exceeds file length of %d bytes)", byteOffset, len(content)), TotalLines: strings.Count(content, "\n") + 1, UseByteOffset: true}
	}
	for byteOffset < len(content) && (content[byteOffset]&0xc0) == 0x80 {
		byteOffset++
	}
	remaining := content[byteOffset:]
	runes := []rune(remaining)
	keep := min(len(runes), maxChars)
	output := string(runes[:keep])
	nextByteOffset := byteOffset + len([]byte(output))
	page := readFilePage{
		Output: output, TotalLines: strings.Count(content, "\n") + 1, HasMore: nextByteOffset < len(content),
		NextByteOffset: nextByteOffset, UseByteOffset: true, Truncated: nextByteOffset < len(content),
	}
	if page.HasMore {
		page.TruncateReason = "byte_limit"
		page.Output += fmt.Sprintf("\n\n[继续读取请使用 byte_offset=%d。]", nextByteOffset)
	}
	return page
}

func runeLen(value string) int {
	return len([]rune(value))
}

func isSandboxFileNotFound(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "not found") ||
		strings.Contains(msg, "no such file") ||
		strings.Contains(msg, "does not exist") ||
		strings.Contains(msg, "status 404") ||
		strings.Contains(msg, "不存在") ||
		strings.Contains(msg, "找不到")
}

func resolveSandboxSessionID(ctx context.Context, args map[string]interface{}) string {
	if value := ctx.Value(SandboxConversationIDKey); value != nil {
		if conversationID, ok := value.(string); ok && strings.TrimSpace(conversationID) != "" {
			return strings.TrimSpace(conversationID)
		}
	}
	if sessionID, ok := args["session_id"].(string); ok && strings.TrimSpace(sessionID) != "" {
		return strings.TrimSpace(sessionID)
	}
	if value := ctx.Value(SandboxSessionIDKey); value != nil {
		if sessionID, ok := value.(string); ok {
			return strings.TrimSpace(sessionID)
		}
	}
	return ""
}

func sandboxOutputConversationKey(ctx context.Context) string {
	return strings.TrimSpace(resolveSandboxSessionID(ctx, nil))
}

func sandboxOutputTurnIdentity(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	if value := ctx.Value(helper.RequestIdKey); value != nil {
		if requestID, ok := value.(string); ok && strings.TrimSpace(requestID) != "" {
			return strings.TrimSpace(requestID)
		}
	}
	if value := ctx.Value(SkillRunIDKey); value != nil {
		if runID, ok := value.(string); ok && strings.TrimSpace(runID) != "" {
			return strings.TrimSpace(runID)
		}
	}
	if value := ctx.Value(SandboxSessionIDKey); value != nil {
		if sessionID, ok := value.(string); ok && strings.TrimSpace(sessionID) != "" {
			return strings.TrimSpace(sessionID)
		}
	}
	return ""
}

func resolveSandboxCWD(ctx context.Context, args map[string]interface{}) string {
	if cwd, ok := args["cwd"].(string); ok && strings.TrimSpace(cwd) != "" {
		if normalized, err := normalizeSandboxRelativePath(cwd); err == nil {
			return normalized
		}
		return ""
	}
	if value := ctx.Value(SandboxCWDKey); value != nil {
		if cwd, ok := value.(string); ok {
			if normalized, err := normalizeSandboxRelativePath(cwd); err == nil {
				return normalized
			}
		}
	}
	return ""
}

func resolveSandboxEnvVars(ctx context.Context, args map[string]interface{}) map[string]string {
	if raw, exists := args["env_vars"]; exists {
		if converted := toStringMap(raw); len(converted) > 0 {
			return converted
		}
	}
	if value := ctx.Value(SandboxEnvVarsKey); value != nil {
		if envMap, ok := value.(map[string]string); ok && len(envMap) > 0 {
			return envMap
		}
	}
	return nil
}

func toStringMap(value interface{}) map[string]string {
	switch v := value.(type) {
	case map[string]string:
		out := make(map[string]string, len(v))
		for k, val := range v {
			if strings.TrimSpace(k) != "" {
				out[k] = val
			}
		}
		return out
	case map[string]interface{}:
		out := make(map[string]string, len(v))
		for k, val := range v {
			if strings.TrimSpace(k) == "" {
				continue
			}
			switch typed := val.(type) {
			case string:
				out[k] = typed
			default:
				out[k] = fmt.Sprintf("%v", typed)
			}
		}
		return out
	default:
		return nil
	}
}

func formatCommandResult(stdout string, stderr string, exitCode int) string {
	output := stdout
	if stderr != "" {
		if output != "" {
			output += "\n"
		}
		output += "STDERR:\n" + stderr
	}
	if exitCode != 0 {
		if output != "" {
			output += "\n"
		}
		output += fmt.Sprintf("Process exited with code %d", exitCode)
	}
	if output == "" && exitCode == 0 {
		return "(No output)"
	}
	return output
}

func wrapSandboxServiceError(err error) error {
	if err == nil {
		return fmt.Errorf("工具服务暂时不可用，请稍后重试")
	}
	msg := err.Error()
	if strings.Contains(msg, "status 502") {
		return fmt.Errorf("工具服务暂时不可用：sandbox 网关返回 502（通常是 sandbox 进程未启动或未接入网关）")
	}
	if strings.Contains(msg, "status 404") {
		return fmt.Errorf("工具服务暂时不可用：sandbox 缺少对应接口，请确认已部署新版 /shell 与 /file/*")
	}
	return fmt.Errorf("工具服务暂时不可用：%s", msg)
}

func ensureSandboxRuntimeEnabledForTool(toolName string) error {
	if !isSandboxRuntimeTool(toolName) {
		return nil
	}
	if config.IsSandboxRuntimeEnabled() {
		return nil
	}
	return fmt.Errorf("工具服务已关闭：SANDBOX_MODE=off，%s 不可用", toolName)
}

func isSandboxRuntimeTool(toolName string) bool {
	switch strings.TrimSpace(toolName) {
	case "code-interpreter", "run_shell", "read_file", "write_file", "prepare_input_file", "list_files", "edit":
		return true
	default:
		return false
	}
}

func collectOutputFileNames(files []OutputFile) []string {
	if len(files) == 0 {
		return nil
	}
	names := make([]string, 0, len(files))
	for _, f := range files {
		if f.FileName != "" {
			names = append(names, f.FileName)
		}
	}
	return names
}

func logSandboxRequestDebug(ctx context.Context, mode string, url string, reqPayload SandboxRequest, jsonData []byte) {
	logger.Debugf(ctx, "【沙盒】%s请求: url=%s, session_id=%s, cwd=%s, language=%s, timeout=%d, code_chars=%d, env_vars=%d, injected_files=%d, payload_bytes=%d",
		mode,
		logger.SanitizeURL(url),
		reqPayload.SessionID,
		reqPayload.Cwd,
		reqPayload.Language,
		reqPayload.Timeout,
		len(reqPayload.Code),
		len(reqPayload.EnvVars),
		len(reqPayload.Files),
		len(jsonData),
	)
}

func logSandboxResponseDebug(ctx context.Context, mode string, resp SandboxResponse) {
	logger.Debugf(ctx, "【沙盒】%s响应: exit_code=%d, stdout_chars=%d, stderr_chars=%d, output_files=%d, output_file_names=%v",
		mode,
		resp.ExitCode,
		len(resp.Stdout),
		len(resp.Stderr),
		len(resp.OutputFiles),
		collectOutputFileNames(resp.OutputFiles),
	)
}

func convertToSandboxClientExecuteRequest(req SandboxRequest) sandboxclient.ExecuteCodeRequest {
	return sandboxclient.ExecuteCodeRequest{
		Code:      req.Code,
		Language:  req.Language,
		Timeout:   req.Timeout,
		SessionID: req.SessionID,
		Cwd:       req.Cwd,
		EnvVars:   req.EnvVars,
		Files:     req.Files,
	}
}

func convertSandboxOutputFiles(files []sandboxclient.OutputFile) []OutputFile {
	if len(files) == 0 {
		return nil
	}
	result := make([]OutputFile, 0, len(files))
	for _, file := range files {
		fileName, err := normalizeSandboxDeliverablePath(file.FileName)
		if err != nil {
			continue
		}
		if fileName == file.FileName && !strings.HasPrefix(fileName, "output/") && !strings.HasPrefix(fileName, "outputs/") && !shouldNormalizeSandboxDeliverablePath(fileName) {
			continue
		}
		result = append(result, OutputFile{
			FileName: fileName,
			Content:  file.Content,
			MimeType: file.MimeType,
			Size:     file.Size,
		})
	}
	return result
}

func convertFromSandboxClientExecuteResponse(resp *sandboxclient.ExecuteCodeResponse) SandboxResponse {
	if resp == nil {
		return SandboxResponse{}
	}
	return SandboxResponse{
		Stdout:      resp.Stdout,
		Stderr:      resp.Stderr,
		ExitCode:    resp.ExitCode,
		OutputFiles: convertSandboxOutputFiles(resp.OutputFiles),
	}
}

func decodeSandboxOutputFileContent(content string) []byte {
	trimmed := strings.TrimSpace(content)
	if trimmed == "" {
		return nil
	}
	decoded, err := base64.StdEncoding.DecodeString(trimmed)
	if err != nil {
		return []byte(content)
	}
	return decoded
}

func buildSandboxOutputSnapshotFromOutputFiles(outputFiles []OutputFile) *SandboxOutputSnapshot {
	snapshot := &SandboxOutputSnapshot{Files: make(map[string]string, len(outputFiles))}
	for _, file := range outputFiles {
		fileName := normalizeSandboxOutputFileName(file.FileName)
		if fileName == "" {
			continue
		}
		snapshot.Files[fileName] = buildSandboxOutputFileFingerprint(file.FileName, decodeSandboxOutputFileContent(file.Content))
	}
	return snapshot
}

func filterSandboxOutputFilesBySnapshot(prev *SandboxOutputSnapshot, outputFiles []OutputFile) ([]OutputFile, *SandboxOutputSnapshot) {
	snapshot := buildSandboxOutputSnapshotFromOutputFiles(outputFiles)
	if len(outputFiles) == 0 {
		return nil, snapshot
	}

	latestByPath := make(map[string]OutputFile, len(outputFiles))
	for _, file := range outputFiles {
		fileName := normalizeSandboxOutputFileName(file.FileName)
		if fileName == "" {
			continue
		}
		latestByPath[fileName] = file
	}

	prevFiles := map[string]string{}
	if prev != nil && len(prev.Files) > 0 {
		prevFiles = prev.Files
	}

	changed := make([]OutputFile, 0, len(latestByPath))
	paths := make([]string, 0, len(latestByPath))
	for fileName := range latestByPath {
		paths = append(paths, fileName)
	}
	sort.Strings(paths)

	for _, fileName := range paths {
		file := latestByPath[fileName]
		fingerprint := snapshot.Files[fileName]
		if prevFingerprint, exists := prevFiles[fileName]; exists && prevFingerprint == fingerprint {
			continue
		}
		changed = append(changed, file)
	}

	return changed, snapshot
}

// ExecuteToolStream executes a tool and streams events via callback
// Returns final result after streaming completes
func ExecuteToolStream(ctx context.Context, name string, args map[string]interface{}, handler SandboxStreamHandler) (*ToolResult, error) {
	logger.Infof(ctx, "【工具执行】开始流式执行: tool=%s %s", name, logger.SummarizeToolArguments(args))
	if err := ensureSandboxRuntimeEnabledForTool(name); err != nil {
		return nil, err
	}

	switch name {
	case "code-interpreter":
		code, ok := args["code"].(string)
		if !ok {
			return nil, fmt.Errorf("missing code argument")
		}
		language, ok := args["language"].(string)
		if !ok || language == "" {
			language = "python"
		}
		if config.IsSandboxRuntimeProviderEnabled() {
			return executeSandboxRuntimeCodeWithResult(ctx, language, code)
		}
		return executeSandboxCodeStream(ctx, language, code, handler)

	case "run_shell":
		if config.IsSandboxRuntimeProviderEnabled() {
			return executeSandboxRuntimeRunShellStream(ctx, args, handler)
		}
		return executeSyncToolStream(ctx, "run_shell", func() (*ToolResult, error) {
			return executeRunShell(ctx, args)
		}, handler)

	case "read_file":
		if config.IsSandboxRuntimeProviderEnabled() {
			return executeSandboxRuntimeReadFile(ctx, args)
		}
		return executeSyncToolStream(ctx, "read_file", func() (*ToolResult, error) {
			return executeReadFile(ctx, args)
		}, handler)

	case "write_file":
		if config.IsSandboxRuntimeProviderEnabled() {
			return executeSandboxRuntimeWriteFile(ctx, args)
		}
		return executeSyncToolStream(ctx, "write_file", func() (*ToolResult, error) {
			return executeWriteFile(ctx, args)
		}, handler)

	case "prepare_input_file":
		if config.IsSandboxRuntimeProviderEnabled() {
			return executeSandboxRuntimePrepareInputFile(ctx, args)
		}
		return executeSyncToolStream(ctx, "prepare_input_file", func() (*ToolResult, error) {
			return executePrepareInputFile(ctx, args)
		}, handler)

	case "list_files":
		if config.IsSandboxRuntimeProviderEnabled() {
			return executeSandboxRuntimeListFiles(ctx, args)
		}
		return executeSyncToolStream(ctx, "list_files", func() (*ToolResult, error) {
			return executeListFiles(ctx, args)
		}, handler)

	case "edit":
		if config.IsSandboxRuntimeEnabled() {
			return executeSandboxRuntimeEditFile(ctx, args)
		}
		return executeSyncToolStream(ctx, "edit", func() (*ToolResult, error) {
			return executeEditFile(ctx, args)
		}, handler)

	case "web_fetch":
		return executeSyncToolStream(ctx, "web_fetch", func() (*ToolResult, error) {
			return executeWebFetch(ctx, args)
		}, handler)

	default:
		return nil, fmt.Errorf("tool execution not implemented for: %s", name)
	}
}

// executeSandboxCodeStream executes code in sandbox with streaming output
func executeSandboxCodeStream(ctx context.Context, language string, code string, handler SandboxStreamHandler) (*ToolResult, error) {
	reqPayload := buildSandboxRequest(ctx, language, code)

	jsonData, err := json.Marshal(reqPayload)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal sandbox request: %v", err)
	}

	url := fmt.Sprintf("%s/execute/stream", strings.TrimRight(config.SandboxServiceURL, "/"))
	logSandboxRequestDebug(ctx, "stream", url, reqPayload, jsonData)

	var resp *http.Response
	retryErr := common.Retry(ctx, func() error {
		streamResp, reqErr := getSandboxClient().ExecuteCodeStream(ctx, convertToSandboxClientExecuteRequest(reqPayload))
		if reqErr != nil {
			logger.Warnf(ctx, "Sandbox streaming request failed: %v", reqErr)
			return reqErr
		}
		resp = streamResp
		return nil
	},
		common.WithMaxRetries(3),
		common.WithInitialDelay(500*time.Millisecond),
		common.WithRetryableFunc(common.IsRetryableError),
	)
	if retryErr != nil {
		logger.Errorf(ctx, "Sandbox streaming unavailable after retries: %v", retryErr)
		return nil, fmt.Errorf("工具服务暂时不可用，请稍后重试")
	}
	defer resp.Body.Close()

	// Parse SSE stream
	result, parseErr := parseSSEStream(ctx, resp.Body, handler)
	if parseErr != nil {
		logger.Debugf(ctx, "【沙盒】stream解析失败: err=%v", parseErr)
		return nil, parseErr
	}
	outputFiles, snapshot := filterSandboxOutputFilesBySnapshot(loadSandboxOutputSnapshot(ctx), result.OutputFiles)
	rememberSandboxOutputSnapshot(ctx, snapshot)
	result.OutputFiles = outputFiles
	logger.Debugf(ctx, "【沙盒】stream最终结果: output_chars=%d, output_files=%d, output_file_names=%v",
		len(result.Output), len(result.OutputFiles), collectOutputFileNames(result.OutputFiles))
	return result, nil
}

func executeSyncToolStream(ctx context.Context, toolName string, executor func() (*ToolResult, error), handler SandboxStreamHandler) (*ToolResult, error) {
	start := time.Now()
	if handler != nil {
		handler(SandboxStreamEvent{
			EventType: "tool.started",
			Data:      map[string]interface{}{"tool_name": toolName},
		})
	}

	result, err := executor()
	if err != nil {
		if handler != nil {
			handler(SandboxStreamEvent{
				EventType: "error",
				Data:      map[string]interface{}{"message": err.Error(), "tool_name": toolName},
			})
		}
		return nil, err
	}

	if handler != nil {
		handler(SandboxStreamEvent{
			EventType: "tool.completed",
			Data: map[string]interface{}{
				"stdout":         result.Output,
				"stderr":         result.Stderr,
				"exit_code":      result.ExitCode,
				"execution_time": time.Since(start).Seconds(),
				"output_files":   result.OutputFiles,
				"tool_name":      toolName,
			},
		})
	}
	return result, nil
}

// buildSandboxRequest constructs a sandbox request from context and parameters
func buildSandboxRequest(ctx context.Context, language string, code string) SandboxRequest {
	code = normalizeSandboxTextContentForLanguage(language, code)
	reqPayload := SandboxRequest{
		Code:      code,
		Language:  language,
		Timeout:   30,
		SessionID: resolveSandboxSessionID(ctx, map[string]interface{}{}),
		Cwd:       resolveSandboxCWD(ctx, map[string]interface{}{}),
		EnvVars:   resolveSandboxEnvVars(ctx, map[string]interface{}{}),
	}

	// Inject skill files if available. When no explicit resources are declared, seed the
	// entire skill directory so script-based skills can execute relative paths directly.
	if files, err := buildSkillFilesForSandbox(ctx); err != nil {
		logger.Warnf(ctx, "Failed to read skill files: %v", err)
	} else if len(files) > 0 {
		reqPayload.Files = files
		if skillRootPath, ok := ctx.Value(SkillRootPathKey).(string); ok && skillRootPath != "" {
			logger.Infof(ctx, "Injected %d files from skill path: %s", len(files), skillRootPath)
		}
	}

	return reqPayload
}

// parseSSEStream reads SSE events from response body and calls handler
// Returns final ToolResult after parsing tool.completed event
func parseSSEStream(ctx context.Context, body io.Reader, handler SandboxStreamHandler) (*ToolResult, error) {
	scanner := NewSSEScanner(body)
	var result *ToolResult

	for scanner.Scan() {
		event := scanner.Event()
		if event == nil {
			continue
		}

		// Call handler if provided
		if handler != nil {
			handler(*event)
		}

		// Capture final result from tool.completed
		if event.EventType == "tool.completed" {
			stdout, _ := event.Data["stdout"].(string)
			stderr, _ := event.Data["stderr"].(string)
			exitCode, _ := event.Data["exit_code"].(float64) // JSON numbers are float64

			output := stdout
			if stderr != "" {
				if output != "" {
					output += "\n"
				}
				output += "STDERR:\n" + stderr
			}
			if int(exitCode) != 0 {
				if output != "" {
					output += "\n"
				}
				output += fmt.Sprintf("Process exited with code %d", int(exitCode))
			}
			if output == "" && int(exitCode) == 0 {
				output = "(No output)"
			}

			outputFiles := parseStreamOutputFiles(event.Data["output_files"])
			logger.Debugf(ctx, "【沙盒】stream事件完成: event=%s, exit_code=%d, stdout_chars=%d, stderr_chars=%d, output_files=%d, output_file_names=%v",
				event.EventType, int(exitCode), len(stdout), len(stderr), len(outputFiles), collectOutputFileNames(outputFiles))

			result = &ToolResult{
				Output:      output,
				Stderr:      stderr,
				ExitCode:    int(exitCode),
				OutputFiles: outputFiles,
			}
		}

		// Handle error event
		if event.EventType == "error" {
			errMsg, _ := event.Data["message"].(string)
			logger.Debugf(ctx, "【沙盒】stream事件异常: event=%s, message=%s", event.EventType, errMsg)
			return nil, fmt.Errorf("sandbox error: %s", errMsg)
		}
	}

	if err := scanner.Err(); err != nil {
		logger.Errorf(ctx, "SSE scanner error: %v", err)
		return nil, fmt.Errorf("failed to read SSE stream: %v", err)
	}

	if result == nil {
		return nil, fmt.Errorf("no tool.completed event received")
	}

	return result, nil
}

func parseStreamOutputFiles(raw interface{}) []OutputFile {
	switch files := raw.(type) {
	case []OutputFile:
		if len(files) == 0 {
			return nil
		}
		return files
	case []interface{}:
		outputFiles := make([]OutputFile, 0, len(files))
		for _, f := range files {
			if fMap, ok := f.(map[string]interface{}); ok {
				fileName, _ := fMap["file_name"].(string)
				content, _ := fMap["content"].(string)
				mimeType, _ := fMap["mime_type"].(string)
				size, _ := fMap["size"].(float64)
				outputFiles = append(outputFiles, OutputFile{
					FileName: fileName,
					Content:  content,
					MimeType: mimeType,
					Size:     int(size),
				})
			}
		}
		if len(outputFiles) == 0 {
			return nil
		}
		return outputFiles
	default:
		return nil
	}
}

// SSEScanner is a scanner for Server-Sent Events
// SSE format: "event: <type>\ndata: <json>\n\n"
type SSEScanner struct {
	scanner *bufio.Scanner
	event   *SandboxStreamEvent
	err     error
}

const maxSSETokenSize = 10 * 1024 * 1024 // 10MB per SSE event

// NewSSEScanner creates a new SSE scanner
func NewSSEScanner(r io.Reader) *SSEScanner {
	s := &SSEScanner{
		scanner: bufio.NewScanner(r),
	}
	s.scanner.Buffer(make([]byte, 0, 64*1024), maxSSETokenSize)
	// Split on double newlines (SSE event boundary)
	s.scanner.Split(func(data []byte, atEOF bool) (advance int, token []byte, err error) {
		// Find LF or CRLF boundary.
		for i := 0; i < len(data); i++ {
			// LF LF
			if i+1 < len(data) && data[i] == '\n' && data[i+1] == '\n' {
				return i + 2, data[:i], nil
			}
			// CRLF CRLF
			if i+3 < len(data) &&
				data[i] == '\r' && data[i+1] == '\n' &&
				data[i+2] == '\r' && data[i+3] == '\n' {
				return i + 4, data[:i], nil
			}
		}
		if atEOF && len(data) > 0 {
			return len(data), data, nil
		}
		return 0, nil, nil
	})
	return s
}

// Scan advances to the next event
func (s *SSEScanner) Scan() bool {
	if !s.scanner.Scan() {
		s.err = s.scanner.Err()
		return false
	}

	block := s.scanner.Text()
	s.event = parseSSEBlock(block)
	return true
}

// Event returns the current event
func (s *SSEScanner) Event() *SandboxStreamEvent {
	return s.event
}

// Err returns any error encountered
func (s *SSEScanner) Err() error {
	return s.err
}

// parseSSEBlock parses a single SSE block into an event
func parseSSEBlock(block string) *SandboxStreamEvent {
	lines := strings.Split(block, "\n")
	var eventType string
	dataLines := make([]string, 0, len(lines))

	for _, line := range lines {
		line = strings.TrimSuffix(line, "\r")
		if strings.HasPrefix(line, "event:") {
			eventType = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
		} else if strings.HasPrefix(line, "data:") {
			data := strings.TrimPrefix(line, "data:")
			if strings.HasPrefix(data, " ") {
				data = data[1:]
			}
			dataLines = append(dataLines, data)
		}
	}

	if eventType == "" || len(dataLines) == 0 {
		return nil
	}
	dataStr := strings.Join(dataLines, "\n")

	var data map[string]interface{}
	if err := json.Unmarshal([]byte(dataStr), &data); err != nil {
		return &SandboxStreamEvent{
			EventType: eventType,
			Data:      map[string]interface{}{"raw": dataStr, "error": err.Error()},
		}
	}

	return &SandboxStreamEvent{
		EventType: eventType,
		Data:      data,
	}
}
