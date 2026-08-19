package tools

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

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

	sandboxRuntimeSeedStates sync.Map
	sandboxSeedCleanupMu     sync.Mutex
	sandboxSeedLastCleanup   time.Time
)

type sandboxRuntimeSeedState struct {
	mu                    sync.Mutex
	fingerprints          map[string]string
	skillScopeFingerprint string
	lastUsedAt            time.Time
}

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
	return resolveSandboxInt64ContextValue(ctx, ToolEIDKey, "eid")
}

func resolveSandboxUserID(ctx context.Context) int64 {
	return resolveSandboxInt64ContextValue(ctx, ToolUserIDKey, "user_id")
}

func resolveSandboxMessageID(ctx context.Context) int64 {
	return resolveSandboxInt64ContextValue(ctx, ToolMessageIDKey, "message_id")
}

func resolveSandboxInt64ContextValue(ctx context.Context, typedKey contextKey, legacyKey string) int64 {
	for _, key := range []interface{}{typedKey, legacyKey} {
		value := ctx.Value(key)
		if value == nil {
			continue
		}
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
	return ensureSandboxRuntimeSessionSeededWithFetcher(ctx, session, fetchUploadFileContent)
}

func ensureSandboxRuntimeSessionSeededWithFetcher(ctx context.Context, session *sandboxruntime.Session, fetchUpload func(context.Context, *model.UploadFile) ([]byte, error)) error {
	if session == nil {
		return sandboxruntime.ErrSessionRequired
	}
	if fetchUpload == nil {
		fetchUpload = fetchUploadFileContent
	}

	maybeCleanupSandboxRuntimeSeedStates(time.Now())
	stateKey := session.ID + "|" + session.Mounts.WorkspaceRoot
	stateAny, _ := sandboxRuntimeSeedStates.LoadOrStore(stateKey, &sandboxRuntimeSeedState{
		fingerprints: make(map[string]string),
	})
	state := stateAny.(*sandboxRuntimeSeedState)
	state.mu.Lock()
	defer state.mu.Unlock()
	state.lastUsedAt = time.Now()

	desiredFiles := make(map[string]sandboxruntime.FileObject)
	desiredFingerprints := make(map[string]string)
	skillScopeFingerprint := sandboxRuntimeSkillScopeFingerprint(ctx)
	skillScopeChanged := state.skillScopeFingerprint != skillScopeFingerprint
	if skillScopeChanged {
		if skillFiles, err := buildSkillFilesForSandbox(ctx); err != nil {
			return err
		} else {
			for path, content := range skillFiles {
				data := []byte(content)
				desiredFiles[path] = sandboxruntime.FileObject{
					Path: path,
					Data: data,
				}
				desiredFingerprints[path] = "seed:" + sandboxruntime.HashBytes(data)
			}
		}
	}

	if uploadFiles, ok := ctx.Value(UploadedFilesKey).([]*model.UploadFile); ok && len(uploadFiles) > 0 {
		for _, uploadFile := range uploadFiles {
			if uploadFile == nil {
				continue
			}
			path := uploadFile.FileName
			if normalized, err := normalizeSandboxRelativePath(path); err == nil {
				path = normalized
			} else {
				path = filepath.ToSlash(filepath.Base(path))
			}
			fingerprint := sandboxRuntimeUploadFingerprint(uploadFile)
			desiredFingerprints[path] = fingerprint
			if previous, exists := state.fingerprints[path]; exists && previous == fingerprint {
				delete(desiredFiles, path)
				continue
			}
			data, err := fetchUpload(ctx, uploadFile)
			if err != nil {
				logger.Warnf(ctx, "Failed to fetch upload file for sandbox runtime: file_id=%d, err=%v", uploadFile.ID, err)
				delete(desiredFingerprints, path)
				delete(desiredFiles, path)
				continue
			}
			desiredFiles[path] = sandboxruntime.FileObject{
				Path: path,
				Data: data,
			}
		}
	}

	paths := make([]string, 0, len(desiredFiles))
	for path := range desiredFiles {
		if previous, exists := state.fingerprints[path]; exists && previous == desiredFingerprints[path] {
			continue
		}
		paths = append(paths, path)
	}
	if len(paths) == 0 {
		if skillScopeChanged {
			state.skillScopeFingerprint = skillScopeFingerprint
		}
		return nil
	}
	sort.Strings(paths)
	files := make([]sandboxruntime.FileObject, 0, len(paths))
	for _, path := range paths {
		files = append(files, desiredFiles[path])
	}
	if err := runtimeWriteFiles(ctx, session, files); err != nil {
		return err
	}
	for _, path := range paths {
		state.fingerprints[path] = desiredFingerprints[path]
	}
	if skillScopeChanged {
		state.skillScopeFingerprint = skillScopeFingerprint
	}
	return nil
}

func maybeCleanupSandboxRuntimeSeedStates(now time.Time) {
	sandboxSeedCleanupMu.Lock()
	if !sandboxSeedLastCleanup.IsZero() && now.Sub(sandboxSeedLastCleanup) < time.Minute {
		sandboxSeedCleanupMu.Unlock()
		return
	}
	sandboxSeedLastCleanup = now
	sandboxSeedCleanupMu.Unlock()

	ttl := time.Duration(config.SandboxRuntimeIdleCleanupSeconds) * 2 * time.Second
	if ttl < 30*time.Minute {
		ttl = 30 * time.Minute
	}
	cleanupSandboxRuntimeSeedStates(now, ttl)
}

func cleanupSandboxRuntimeSeedStates(now time.Time, ttl time.Duration) {
	if ttl <= 0 {
		return
	}
	sandboxRuntimeSeedStates.Range(func(key, value interface{}) bool {
		state, ok := value.(*sandboxRuntimeSeedState)
		if !ok || state == nil {
			sandboxRuntimeSeedStates.Delete(key)
			return true
		}
		state.mu.Lock()
		lastUsedAt := state.lastUsedAt
		state.mu.Unlock()
		if !lastUsedAt.IsZero() && now.Sub(lastUsedAt) > ttl {
			sandboxRuntimeSeedStates.Delete(key)
		}
		return true
	})
}

func sandboxRuntimeSkillScopeFingerprint(ctx context.Context) string {
	root, _ := ctx.Value(SkillRootPathKey).(string)
	resources, _ := ctx.Value(SkillResourcesKey).([]string)
	resources = append([]string(nil), resources...)
	sort.Strings(resources)

	parts := []string{filepath.Clean(strings.TrimSpace(root)), strings.Join(resources, "\x00")}
	if runtimeSeedFiles := loadRuntimeSeedFilesFromContext(ctx); len(runtimeSeedFiles) > 0 {
		paths := make([]string, 0, len(runtimeSeedFiles))
		for path := range runtimeSeedFiles {
			paths = append(paths, path)
		}
		sort.Strings(paths)
		for _, path := range paths {
			parts = append(parts, path, sandboxruntime.HashBytes([]byte(runtimeSeedFiles[path])))
		}
	}
	return sandboxruntime.HashBytes([]byte(strings.Join(parts, "\x00")))
}

func sandboxRuntimeUploadFingerprint(uploadFile *model.UploadFile) string {
	if uploadFile == nil {
		return ""
	}
	identity := fmt.Sprintf("%d|%s|%s|%s|%d|%d", uploadFile.ID, uploadFile.FileName, uploadFile.Key, uploadFile.Hash, uploadFile.Size, uploadFile.UpdatedTime)
	return "upload:" + sandboxruntime.HashBytes([]byte(identity))
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
	session, req, err := buildSandboxRuntimeRunShellRequest(ctx, args)
	if err != nil {
		return nil, err
	}
	return getSandboxRuntimeResult(ctx, session, req)
}

// executeSandboxRuntimeRunShellStream is the provider-runtime counterpart of
// run_shell streaming. ExecuteToolStream should call this function when the
// Docker runtime provider is enabled.
func executeSandboxRuntimeRunShellStream(ctx context.Context, args map[string]interface{}, handler SandboxStreamHandler) (*ToolResult, error) {
	if handler != nil {
		handler(SandboxStreamEvent{EventType: "tool.started", Data: map[string]interface{}{"tool_name": "run_shell"}})
	}
	session, req, err := buildSandboxRuntimeRunShellRequest(ctx, args)
	if err != nil {
		emitSandboxRuntimeStreamError(handler, err)
		return nil, err
	}
	result, err := getSandboxRuntimeResultWithStream(ctx, session, req, func(event sandboxruntime.StreamEvent) {
		if handler == nil || event.Type == "tool.completed" {
			return
		}
		data := make(map[string]interface{}, len(event.Data)+1)
		for key, value := range event.Data {
			data[key] = value
		}
		if event.Content != "" {
			data["content"] = event.Content
		}
		handler(SandboxStreamEvent{EventType: event.Type, Data: data})
	})
	if err != nil {
		emitSandboxRuntimeStreamError(handler, err)
		return result, err
	}
	if handler != nil {
		handler(SandboxStreamEvent{EventType: "tool.completed", Data: map[string]interface{}{
			"stdout":       result.Output,
			"stderr":       result.Stderr,
			"exit_code":    result.ExitCode,
			"output_files": result.OutputFiles,
		}})
	}
	return result, nil
}

func emitSandboxRuntimeStreamError(handler SandboxStreamHandler, err error) {
	if handler == nil || err == nil {
		return
	}
	handler(SandboxStreamEvent{EventType: "error", Data: map[string]interface{}{
		"message":   err.Error(),
		"tool_name": "run_shell",
	}})
}

func buildSandboxRuntimeRunShellRequest(ctx context.Context, args map[string]interface{}) (*sandboxruntime.Session, sandboxruntime.CommandRequest, error) {
	command, ok := args["command"].(string)
	if !ok || strings.TrimSpace(command) == "" {
		return nil, sandboxruntime.CommandRequest{}, fmt.Errorf("missing command argument")
	}
	session, err := runtimeSessionForContext(ctx)
	if err != nil {
		return nil, sandboxruntime.CommandRequest{}, err
	}
	timeout := 30
	if v, exists := args["timeout"]; exists {
		timeout = parseIntValue(v, timeout)
	}
	cwd := resolveSandboxCWD(ctx, args)
	if strings.TrimSpace(cwd) == "" {
		cwd = config.SandboxRuntimeContainerWorkdir
	}
	return session, sandboxruntime.CommandRequest{
		Command:        command,
		Cwd:            cwd,
		Env:            resolveSandboxEnvVars(ctx, args),
		TimeoutSeconds: timeout,
	}, nil
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
	page := buildReadFilePageWithContinuation(string(data), args, agentSuccessRateFeatureFlagsFromContext(ctx).ReadContinuation)
	result := &ToolResult{Output: page.Output, ExitCode: 0}
	if agentSuccessRateFeatureFlagsFromContext(ctx).ReadContinuation {
		result.Meta = page.Meta()
	}
	return result, nil
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
	if agentSuccessRateFeatureFlagsFromContext(ctx).EditV2 {
		return executeSandboxRuntimeEditFileV2(ctx, args)
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

func executeSandboxRuntimeEditFileV2(ctx context.Context, args map[string]interface{}) (*ToolResult, error) {
	path, ok := args["path"].(string)
	if !ok || strings.TrimSpace(path) == "" {
		return nil, fmt.Errorf("missing path argument")
	}
	path, err := normalizeSandboxWorkspacePath(path)
	if err != nil {
		return nil, err
	}
	features := agentSuccessRateFeatureFlagsFromContext(ctx)
	operations, err := parseEditV2OperationsWithBatch(args, features.EditBatch)
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
	data, err := rt.ReadFile(ctx, session, path, 0)
	if err != nil {
		return nil, err
	}
	originalContent := string(data)
	spans, matchMode, err := buildEditV2SpansForContentWithNormalizedMatch(originalContent, operations, features.EditNormalizedMatch)
	if err != nil {
		return nil, err
	}
	newContent := applyEditV2Spans(originalContent, spans)
	if newContent == originalContent {
		return nil, fmt.Errorf("EDIT_NO_CHANGE: edits do not change file content")
	}
	written := sandboxruntime.FileObject{Path: path, Data: []byte(newContent)}
	if err := rt.WriteFiles(ctx, session, []sandboxruntime.FileObject{written}); err != nil {
		return nil, err
	}
	if err := formatSandboxRuntimeWrittenFiles(ctx, rt, session, []sandboxruntime.FileObject{written}); err != nil {
		return nil, err
	}
	if err := validateSandboxRuntimeWrittenFiles(ctx, rt, session, []sandboxruntime.FileObject{written}); err != nil {
		return nil, err
	}
	prevSnapshot := loadSandboxOutputSnapshot(ctx)
	outputFiles, currentSnapshot, collectErr := collectRuntimeOutputFiles(ctx, session, prevSnapshot)
	if collectErr != nil {
		return nil, collectErr
	}
	rememberSandboxOutputSnapshot(ctx, currentSnapshot)
	return &ToolResult{
		Output:      fmt.Sprintf("Edited %s (%d replacement(s), atomic batch)", path, len(spans)),
		ExitCode:    0,
		OutputFiles: outputFiles,
		Meta:        map[string]interface{}{"edit_count": len(operations), "match_mode": matchMode},
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
	return getSandboxRuntimeResultWithStream(ctx, session, req, nil)
}

func getSandboxRuntimeResultWithStream(ctx context.Context, session *sandboxruntime.Session, req sandboxruntime.CommandRequest, stream func(sandboxruntime.StreamEvent)) (*ToolResult, error) {
	rt, err := getSandboxRuntime()
	if err != nil {
		return nil, err
	}
	prevSnapshot := loadSandboxOutputSnapshot(ctx)
	res, runErr := rt.RunCommand(ctx, session, req, stream)
	if res == nil {
		if runErr == nil {
			runErr = fmt.Errorf("sandbox runtime returned an empty command result")
		}
		return nil, runErr
	}
	result := &ToolResult{
		Output:   formatCommandResult(res.Stdout, res.Stderr, res.ExitCode),
		Stderr:   res.Stderr,
		ExitCode: res.ExitCode,
	}
	if agentSuccessRateFeatureFlagsFromContext(ctx).ShellOutputV2 {
		result.Output, result.Meta = shapeShellOutput(res.Stdout, res.Stderr, res.ExitCode)
	}
	if runErr != nil {
		return result, runErr
	}
	outputFiles, currentSnapshot, collectErr := collectRuntimeOutputFiles(ctx, session, prevSnapshot)
	if collectErr != nil {
		logger.Warnf(ctx, "Failed to collect sandbox output files: %v", collectErr)
	} else {
		result.OutputFiles = outputFiles
		rememberSandboxOutputSnapshot(ctx, currentSnapshot)
	}
	return result, nil
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
