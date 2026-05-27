package tools

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"sync"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/sandboxruntime"
	"github.com/53AI/53AIHub/service/sandboxruntime/providers"
)

var (
	sandboxRuntimeMu  sync.Mutex
	sandboxRuntimeKey string
	sandboxRuntime    sandboxruntime.Runtime
	sandboxRuntimeErr error
)

func registerSandboxRuntimeProviders() {
	providers.RegisterDefaults()
}

func sandboxRuntimeConfigKey(cfg config.RuntimeProviderConfig) string {
	return strings.Join([]string{
		cfg.Provider,
		cfg.WorkspaceRoot,
		cfg.ContainerPrefix,
		cfg.Image,
		cfg.ContainerWorkdir,
		fmt.Sprintf("%d", cfg.TimeoutSeconds),
		fmt.Sprintf("%d", cfg.IdleCleanupSeconds),
		fmt.Sprintf("%t", cfg.NetworkEnabled),
		fmt.Sprintf("%t", cfg.ReadOnlyRoot),
	}, "|")
}

func getSandboxRuntime() (sandboxruntime.Runtime, error) {
	cfg := config.RuntimeProviderConfigFromEnv()
	key := sandboxRuntimeConfigKey(cfg)

	sandboxRuntimeMu.Lock()
	defer sandboxRuntimeMu.Unlock()

	if sandboxRuntime != nil && sandboxRuntimeKey == key {
		return sandboxRuntime, sandboxRuntimeErr
	}

	registerSandboxRuntimeProviders()
	rt, err := sandboxruntime.NewFactory(cfg).New(context.Background())
	if err != nil {
		sandboxRuntime = nil
		sandboxRuntimeErr = err
		sandboxRuntimeKey = key
		return nil, err
	}
	if cleanupRuntime, ok := rt.(interface{ CleanupOrphans(context.Context) error }); ok {
		if err := cleanupRuntime.CleanupOrphans(context.Background()); err != nil {
			logger.Warnf(context.Background(), "Failed to cleanup orphan sandbox containers: %v", err)
		}
	}
	sandboxRuntime = rt
	sandboxRuntimeErr = nil
	sandboxRuntimeKey = key
	return sandboxRuntime, nil
}

func ShutdownSandboxRuntime(ctx context.Context) error {
	rt, err := getSandboxRuntime()
	if err != nil {
		return err
	}
	if closer, ok := rt.(interface{ CloseAll(context.Context) error }); ok {
		return closer.CloseAll(ctx)
	}
	return nil
}

func buildRuntimeSessionSpec(ctx context.Context) sandboxruntime.SessionSpec {
	return sandboxruntime.SessionSpec{
		Eid:        resolveSandboxEID(ctx),
		UserID:     resolveSandboxUserID(ctx),
		MessageID:  resolveSandboxMessageID(ctx),
		AgentRunID: resolveSandboxSessionID(ctx, map[string]interface{}{}),
		Scope:      sandboxruntime.ScopeSingleSkillRun,
		Metadata:   map[string]string{},
	}
}

func resolveSandboxEID(ctx context.Context) int64 {
	if value := ctx.Value("eid"); value != nil {
		switch v := value.(type) {
		case int64:
			return v
		case int:
			return int64(v)
		}
	}
	return 0
}

func resolveSandboxUserID(ctx context.Context) int64 {
	if value := ctx.Value("user_id"); value != nil {
		switch v := value.(type) {
		case int64:
			return v
		case int:
			return int64(v)
		}
	}
	return 0
}

func resolveSandboxMessageID(ctx context.Context) int64 {
	if value := ctx.Value("message_id"); value != nil {
		switch v := value.(type) {
		case int64:
			return v
		case int:
			return int64(v)
		}
	}
	return 0
}

func ensureSandboxRuntimeSessionSeeded(ctx context.Context, session *sandboxruntime.Session) error {
	if session == nil {
		return sandboxruntime.ErrSessionRequired
	}
	files := make([]sandboxruntime.FileObject, 0)
	if skillFiles, err := buildSkillFilesForSandbox(ctx); err != nil {
		return err
	} else {
		for path, content := range skillFiles {
			files = append(files, sandboxruntime.FileObject{
				Path: path,
				Data: []byte(content),
			})
		}
	}
	if uploadFiles, ok := ctx.Value(UploadedFilesKey).([]*model.UploadFile); ok && len(uploadFiles) > 0 {
		for _, uploadFile := range uploadFiles {
			if uploadFile == nil {
				continue
			}
			data, err := fetchUploadFileContent(ctx, uploadFile)
			if err != nil {
				logger.Warnf(ctx, "Failed to fetch upload file for sandbox runtime: file_id=%d, err=%v", uploadFile.ID, err)
				continue
			}
			path := uploadFile.FileName
			if normalized, err := normalizeSandboxRelativePath(path); err == nil {
				path = normalized
			} else {
				path = filepath.ToSlash(filepath.Base(path))
			}
			files = append(files, sandboxruntime.FileObject{
				Path: path,
				Data: data,
			})
		}
	}
	if len(files) == 0 {
		return nil
	}
	return runtimeWriteFiles(ctx, session, files)
}

func fetchUploadFileContent(ctx context.Context, uploadFile *model.UploadFile) ([]byte, error) {
	if uploadFile == nil {
		return nil, fmt.Errorf("upload file is nil")
	}
	url := uploadFile.GetPreviewOrOssDownloadUrl()
	if strings.TrimSpace(url) == "" {
		return nil, fmt.Errorf("empty upload file url")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return nil, fmt.Errorf("upload file download failed: status=%s body=%s", resp.Status, strings.TrimSpace(string(body)))
	}
	return io.ReadAll(resp.Body)
}

func runtimeSessionForContext(ctx context.Context) (*sandboxruntime.Session, error) {
	rt, err := getSandboxRuntime()
	if err != nil {
		return nil, err
	}
	spec := buildRuntimeSessionSpec(ctx)
	session, err := rt.Acquire(ctx, spec)
	if err != nil {
		return nil, err
	}
	if err := ensureSandboxRuntimeSessionSeeded(ctx, session); err != nil {
		return nil, err
	}
	if err := primeSandboxOutputSnapshot(ctx, session.Mounts.WorkspaceRoot); err != nil {
		logger.Warnf(ctx, "Failed to prime sandbox output snapshot: session=%s, err=%v", session.ID, err)
	}
	return session, nil
}

func runtimeWriteFiles(ctx context.Context, session *sandboxruntime.Session, files []sandboxruntime.FileObject) error {
	rt, err := getSandboxRuntime()
	if err != nil {
		return err
	}
	return rt.WriteFiles(ctx, session, files)
}

func executeSandboxRuntimeCodeWithResult(ctx context.Context, language, code string) (*ToolResult, error) {
	session, err := runtimeSessionForContext(ctx)
	if err != nil {
		return nil, err
	}
	rt, err := getSandboxRuntime()
	if err != nil {
		return nil, err
	}
	code = normalizeSandboxTextContentForLanguage(language, code)
	switch normalizeCodeInterpreterLanguage(language) {
	case "python":
		if err := preflightSandboxRuntimeCode(ctx, rt, session, language, code); err != nil {
			return nil, err
		}
		command := runtimeCodeCommand("python", code)
		result, err := rt.RunCommand(ctx, session, sandboxruntime.CommandRequest{
			Command:        command,
			Cwd:            config.SandboxRuntimeContainerWorkdir,
			TimeoutSeconds: config.SandboxRuntimeTimeoutSeconds,
		}, nil)
		if err != nil {
			return nil, err
		}
		return &ToolResult{
			Output:   formatCommandResult(result.Stdout, result.Stderr, result.ExitCode),
			Stderr:   result.Stderr,
			ExitCode: result.ExitCode,
		}, nil
	case "bash":
		if err := preflightSandboxRuntimeCode(ctx, rt, session, language, code); err != nil {
			return nil, err
		}
		command := runtimeCodeCommand("bash", code)
		result, err := rt.RunCommand(ctx, session, sandboxruntime.CommandRequest{
			Command:        command,
			Cwd:            config.SandboxRuntimeContainerWorkdir,
			TimeoutSeconds: config.SandboxRuntimeTimeoutSeconds,
		}, nil)
		if err != nil {
			return nil, err
		}
		return &ToolResult{
			Output:   formatCommandResult(result.Stdout, result.Stderr, result.ExitCode),
			Stderr:   result.Stderr,
			ExitCode: result.ExitCode,
		}, nil
	case "nodejs":
		return executeSandboxRuntimeNodeCode(ctx, rt, session, code)
	default:
		return nil, fmt.Errorf("unsupported code-interpreter language %q", language)
	}
}

func executeSandboxRuntimeRunShell(ctx context.Context, args map[string]interface{}) (*ToolResult, error) {
	command, ok := args["command"].(string)
	if !ok || strings.TrimSpace(command) == "" {
		return nil, fmt.Errorf("missing command argument")
	}
	session, err := runtimeSessionForContext(ctx)
	if err != nil {
		return nil, err
	}
	timeout := 30
	if v, exists := args["timeout"]; exists {
		timeout = parseIntValue(v, timeout)
	}
	cwd := resolveSandboxCWD(ctx, args)
	if strings.TrimSpace(cwd) == "" {
		cwd = config.SandboxRuntimeContainerWorkdir
	}
	result, err := getSandboxRuntimeResult(ctx, session, sandboxruntime.CommandRequest{
		Command:        command,
		Cwd:            cwd,
		Env:            resolveSandboxEnvVars(ctx, args),
		TimeoutSeconds: timeout,
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}

func executeSandboxRuntimeReadFile(ctx context.Context, args map[string]interface{}) (*ToolResult, error) {
	path, ok := args["path"].(string)
	if !ok || strings.TrimSpace(path) == "" {
		return nil, fmt.Errorf("missing path argument")
	}
	path, err := normalizeSandboxWorkspacePath(path)
	if err != nil {
		return nil, err
	}
	session, err := runtimeSessionForContext(ctx)
	if err != nil {
		return nil, err
	}
	rt, err := getSandboxRuntime()
	if err != nil {
		return nil, err
	}
	data, err := rt.ReadFile(ctx, session, path, int64(parseIntValue(args["max_bytes"], 0)))
	if err != nil {
		return nil, err
	}
	if len(data) == 0 {
		return &ToolResult{Output: "(Empty file)", ExitCode: 0}, nil
	}
	return &ToolResult{Output: paginateReadFileContent(string(data), args), ExitCode: 0}, nil
}

func executeSandboxRuntimeWriteFile(ctx context.Context, args map[string]interface{}) (*ToolResult, error) {
	return executeSandboxRuntimeWriteFileWithPathNormalizer(ctx, args, normalizeSandboxRuntimePath)
}

func executeSandboxRuntimePrepareInputFile(ctx context.Context, args map[string]interface{}) (*ToolResult, error) {
	return executeSandboxRuntimeWriteFileWithPathNormalizer(ctx, args, normalizeSandboxInputPath)
}

func executeSandboxRuntimeWriteFileWithPathNormalizer(ctx context.Context, args map[string]interface{}, normalizePath func(string) (string, error)) (*ToolResult, error) {
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
	appendMode := parseBoolValue(args["append"])
	session, err := runtimeSessionForContext(ctx)
	if err != nil {
		return nil, err
	}
	rt, err := getSandboxRuntime()
	if err != nil {
		return nil, err
	}
	if appendMode {
		existing, readErr := rt.ReadFile(ctx, session, path, 0)
		if readErr != nil {
			return nil, readErr
		}
		content = string(existing) + content
	}
	content = normalizeSandboxTextContentForPath(path, content)
	if err := rt.WriteFiles(ctx, session, []sandboxruntime.FileObject{{Path: path, Data: []byte(content)}}); err != nil {
		return nil, err
	}
	if err := formatSandboxRuntimeWrittenFiles(ctx, rt, session, []sandboxruntime.FileObject{{Path: path, Data: []byte(content)}}); err != nil {
		return nil, err
	}
	if err := validateSandboxRuntimeWrittenFiles(ctx, rt, session, []sandboxruntime.FileObject{{Path: path, Data: []byte(content)}}); err != nil {
		return nil, err
	}
	prevSnapshot := loadSandboxOutputSnapshot(ctx)
	outputFiles, currentSnapshot, collectErr := collectRuntimeOutputFiles(ctx, session, prevSnapshot)
	if collectErr != nil {
		return nil, collectErr
	}
	rememberSandboxOutputSnapshot(ctx, currentSnapshot)
	return &ToolResult{
		Output:      fmt.Sprintf("Wrote %d bytes to %s", len(content), path),
		ExitCode:    0,
		OutputFiles: outputFiles,
	}, nil
}

func executeSandboxRuntimeEditFile(ctx context.Context, args map[string]interface{}) (*ToolResult, error) {
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
	replaceAll := parseBoolValue(args["replace_all"])
	session, err := runtimeSessionForContext(ctx)
	if err != nil {
		return nil, err
	}
	rt, err := getSandboxRuntime()
	if err != nil {
		return nil, err
	}
	data, err := rt.ReadFile(ctx, session, path, 0)
	if err != nil {
		return nil, err
	}
	content := string(data)
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
	newContent = normalizeSandboxTextContentForPath(path, newContent)
	if err := rt.WriteFiles(ctx, session, []sandboxruntime.FileObject{{Path: path, Data: []byte(newContent)}}); err != nil {
		return nil, err
	}
	if err := formatSandboxRuntimeWrittenFiles(ctx, rt, session, []sandboxruntime.FileObject{{Path: path, Data: []byte(newContent)}}); err != nil {
		return nil, err
	}
	if err := validateSandboxRuntimeWrittenFiles(ctx, rt, session, []sandboxruntime.FileObject{{Path: path, Data: []byte(newContent)}}); err != nil {
		return nil, err
	}
	prevSnapshot := loadSandboxOutputSnapshot(ctx)
	outputFiles, currentSnapshot, collectErr := collectRuntimeOutputFiles(ctx, session, prevSnapshot)
	if collectErr != nil {
		return nil, collectErr
	}
	rememberSandboxOutputSnapshot(ctx, currentSnapshot)
	return &ToolResult{
		Output:      fmt.Sprintf("Edited %s (%d replacement(s))", path, replacements),
		ExitCode:    0,
		OutputFiles: outputFiles,
	}, nil
}

func executeSandboxRuntimeListFiles(ctx context.Context, args map[string]interface{}) (*ToolResult, error) {
	path := "."
	if v, exists := args["path"]; exists {
		if p, ok := v.(string); ok && strings.TrimSpace(p) != "" {
			path = p
		}
	}
	session, err := runtimeSessionForContext(ctx)
	if err != nil {
		return nil, err
	}
	rt, err := getSandboxRuntime()
	if err != nil {
		return nil, err
	}
	recursive := parseBoolValue(args["recursive"])
	limit := parseIntValue(args["max_entries"], 200)
	arts, err := rt.ListFiles(ctx, session, path, recursive, limit)
	if err != nil {
		return nil, err
	}
	if len(arts) == 0 {
		return &ToolResult{Output: "(No files found)", ExitCode: 0}, nil
	}
	lines := make([]string, 0, len(arts))
	for _, art := range arts {
		lines = append(lines, art.Path)
	}
	return &ToolResult{Output: strings.Join(lines, "\n"), ExitCode: 0}, nil
}

func runtimeCodeCommand(language, code string) string {
	language = strings.ToLower(strings.TrimSpace(language))
	switch language {
	case "bash", "sh", "shell":
		return code
	default:
		return "python - <<'PY'\n" + code + "\nPY"
	}
}

func getSandboxRuntimeResult(ctx context.Context, session *sandboxruntime.Session, req sandboxruntime.CommandRequest) (*ToolResult, error) {
	rt, err := getSandboxRuntime()
	if err != nil {
		return nil, err
	}
	prevSnapshot := loadSandboxOutputSnapshot(ctx)
	res, err := rt.RunCommand(ctx, session, req, nil)
	if err != nil {
		return nil, err
	}
	outputFiles, currentSnapshot, collectErr := collectRuntimeOutputFiles(ctx, session, prevSnapshot)
	if collectErr != nil {
		logger.Warnf(ctx, "Failed to collect sandbox output files: %v", collectErr)
	}
	rememberSandboxOutputSnapshot(ctx, currentSnapshot)
	return &ToolResult{
		Output:      formatCommandResult(res.Stdout, res.Stderr, res.ExitCode),
		Stderr:      res.Stderr,
		ExitCode:    res.ExitCode,
		OutputFiles: outputFiles,
	}, nil
}

func collectRuntimeOutputFiles(ctx context.Context, session *sandboxruntime.Session, prevSnapshot *SandboxOutputSnapshot) ([]OutputFile, *SandboxOutputSnapshot, error) {
	if session == nil {
		return nil, nil, nil
	}
	if prevSnapshot == nil {
		prevSnapshot = loadSandboxOutputSnapshot(ctx)
	}
	snapshot, changedFiles, err := captureSandboxOutputFiles(prevSnapshot, session.Mounts.WorkspaceRoot)
	if err != nil {
		return nil, nil, err
	}
	return changedFiles, snapshot, nil
}
