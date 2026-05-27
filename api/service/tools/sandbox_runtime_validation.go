package tools

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/service/sandboxruntime"
)

type sandboxRuntimeSyntaxCheckSpec struct {
	extension string
	command   string
}

type sandboxRuntimeFormatSpec struct {
	extension string
	command   string
}

func preflightSandboxRuntimeCode(ctx context.Context, rt sandboxruntime.Runtime, session *sandboxruntime.Session, language, code string) error {
	spec, ok := sandboxRuntimeSyntaxCheckSpecForLanguage(language)
	if !ok || strings.TrimSpace(code) == "" {
		return nil
	}
	if rt == nil {
		return fmt.Errorf("sandbox runtime is nil")
	}
	if session == nil {
		return sandboxruntime.ErrSessionRequired
	}
	code = normalizeSandboxTextContentForLanguage(language, code)

	tempPath := filepath.ToSlash(filepath.Join("tmp", "preflight", fmt.Sprintf("snippet-%d%s", time.Now().UnixNano(), spec.extension)))
	if err := rt.WriteFiles(ctx, session, []sandboxruntime.FileObject{{Path: tempPath, Data: []byte(code)}}); err != nil {
		return fmt.Errorf("prepare syntax preflight file failed: %w", err)
	}
	defer cleanupSandboxRuntimeTempFile(ctx, rt, session, tempPath)

	if err := formatSandboxRuntimeWrittenFiles(ctx, rt, session, []sandboxruntime.FileObject{{Path: tempPath, Data: []byte(code)}}); err != nil {
		return err
	}

	return runSandboxRuntimeSyntaxCheck(ctx, rt, session, tempPath, spec.command)
}

func formatSandboxRuntimeWrittenFiles(ctx context.Context, rt sandboxruntime.Runtime, session *sandboxruntime.Session, files []sandboxruntime.FileObject) error {
	if rt == nil {
		return fmt.Errorf("sandbox runtime is nil")
	}
	if session == nil {
		return sandboxruntime.ErrSessionRequired
	}
	for _, file := range files {
		normalizedPath, err := normalizeSandboxRuntimePath(file.Path)
		if err != nil {
			return err
		}
		spec, ok := sandboxRuntimeFormatSpecForPath(normalizedPath)
		if !ok {
			continue
		}
		result, err := runSandboxRuntimeCommand(ctx, rt, session, normalizedPath, spec.command)
		if err != nil {
			return fmt.Errorf("%s format failed: %w", normalizedPath, err)
		}
		if result != nil && result.ExitCode != 0 {
			return fmt.Errorf("%s format failed: exit_code=%d stdout=%s stderr=%s", normalizedPath, result.ExitCode, strings.TrimSpace(result.Stdout), strings.TrimSpace(result.Stderr))
		}
	}
	return nil
}

func validateSandboxRuntimeWrittenFiles(ctx context.Context, rt sandboxruntime.Runtime, session *sandboxruntime.Session, files []sandboxruntime.FileObject) error {
	if rt == nil {
		return fmt.Errorf("sandbox runtime is nil")
	}
	if session == nil {
		return sandboxruntime.ErrSessionRequired
	}
	for _, file := range files {
		normalizedPath, err := normalizeSandboxRuntimePath(file.Path)
		if err != nil {
			return err
		}
		spec, ok := sandboxRuntimeSyntaxCheckSpecForPath(normalizedPath)
		if !ok {
			continue
		}
		if err := runSandboxRuntimeSyntaxCheck(ctx, rt, session, normalizedPath, spec.command); err != nil {
			return fmt.Errorf("%s syntax validation failed: %w", normalizedPath, err)
		}
	}
	return nil
}

func cleanupSandboxRuntimeTempFile(ctx context.Context, rt sandboxruntime.Runtime, session *sandboxruntime.Session, path string) {
	if rt == nil || session == nil || strings.TrimSpace(path) == "" {
		return
	}
	_, _ = rt.RunCommand(ctx, session, sandboxruntime.CommandRequest{
		Command:        "rm -f \"$SANDBOX_PREVIEW_PATH\"",
		Cwd:            config.SandboxRuntimeContainerWorkdir,
		Env:            map[string]string{"SANDBOX_PREVIEW_PATH": path},
		TimeoutSeconds: 5,
	}, nil)
}

func executeSandboxRuntimeNodeCode(ctx context.Context, rt sandboxruntime.Runtime, session *sandboxruntime.Session, code string) (*ToolResult, error) {
	if rt == nil {
		return nil, fmt.Errorf("sandbox runtime is nil")
	}
	if session == nil {
		return nil, sandboxruntime.ErrSessionRequired
	}
	code = normalizeSandboxTextContentForLanguage("nodejs", code)

	tempPath := filepath.ToSlash(filepath.Join("tmp", "preflight", fmt.Sprintf("snippet-%d%s", time.Now().UnixNano(), sandboxRuntimeNodeScriptExtension(code))))
	if err := rt.WriteFiles(ctx, session, []sandboxruntime.FileObject{{Path: tempPath, Data: []byte(code)}}); err != nil {
		return nil, fmt.Errorf("prepare node script failed: %w", err)
	}
	defer cleanupSandboxRuntimeTempFile(ctx, rt, session, tempPath)

	if err := formatSandboxRuntimeWrittenFiles(ctx, rt, session, []sandboxruntime.FileObject{{Path: tempPath, Data: []byte(code)}}); err != nil {
		return nil, err
	}

	checkResult, checkErr := rt.RunCommand(ctx, session, sandboxruntime.CommandRequest{
		Command:        `if command -v node >/dev/null 2>&1; then node --check "$SANDBOX_PREVIEW_PATH"; else echo "node is not installed" >&2; exit 127; fi`,
		Cwd:            config.SandboxRuntimeContainerWorkdir,
		Env:            map[string]string{"SANDBOX_PREVIEW_PATH": tempPath},
		TimeoutSeconds: 20,
	}, nil)
	if checkErr != nil {
		return nil, checkErr
	}
	if checkResult != nil && checkResult.ExitCode != 0 {
		return nil, fmt.Errorf("node syntax check failed: %s", formatCommandResult(checkResult.Stdout, checkResult.Stderr, checkResult.ExitCode))
	}

	result, err := rt.RunCommand(ctx, session, sandboxruntime.CommandRequest{
		Command:        `if command -v node >/dev/null 2>&1; then node "$SANDBOX_PREVIEW_PATH"; else echo "node is not installed" >&2; exit 127; fi`,
		Cwd:            config.SandboxRuntimeContainerWorkdir,
		Env:            map[string]string{"SANDBOX_PREVIEW_PATH": tempPath},
		TimeoutSeconds: config.SandboxRuntimeTimeoutSeconds,
	}, nil)
	if err != nil {
		return nil, err
	}
	if result != nil && result.ExitCode != 0 {
		return nil, fmt.Errorf("node execution failed: %s", formatCommandResult(result.Stdout, result.Stderr, result.ExitCode))
	}
	return &ToolResult{
		Output:   formatCommandResult(result.Stdout, result.Stderr, result.ExitCode),
		Stderr:   result.Stderr,
		ExitCode: result.ExitCode,
	}, nil
}

func runSandboxRuntimeSyntaxCheck(ctx context.Context, rt sandboxruntime.Runtime, session *sandboxruntime.Session, path string, command string) error {
	result, err := runSandboxRuntimeCommand(ctx, rt, session, path, command)
	if err != nil {
		return err
	}
	if result != nil && result.ExitCode != 0 {
		return fmt.Errorf("exit_code=%d stdout=%s stderr=%s", result.ExitCode, strings.TrimSpace(result.Stdout), strings.TrimSpace(result.Stderr))
	}
	return nil
}

func runSandboxRuntimeCommand(ctx context.Context, rt sandboxruntime.Runtime, session *sandboxruntime.Session, path string, command string) (*sandboxruntime.CommandResult, error) {
	if rt == nil {
		return nil, fmt.Errorf("sandbox runtime is nil")
	}
	if session == nil {
		return nil, sandboxruntime.ErrSessionRequired
	}
	if strings.TrimSpace(path) == "" || strings.TrimSpace(command) == "" {
		return nil, nil
	}

	result, err := rt.RunCommand(ctx, session, sandboxruntime.CommandRequest{
		Command:        command,
		Cwd:            config.SandboxRuntimeContainerWorkdir,
		Env:            map[string]string{"SANDBOX_PREVIEW_PATH": path},
		TimeoutSeconds: 20,
	}, nil)
	if err != nil {
		return nil, err
	}
	return result, nil
}

func sandboxRuntimeSyntaxCheckSpecForLanguage(language string) (sandboxRuntimeSyntaxCheckSpec, bool) {
	switch strings.ToLower(strings.TrimSpace(language)) {
	case "python", "py":
		return sandboxRuntimeSyntaxCheckSpec{
			extension: ".py",
			command:   `if command -v python3 >/dev/null 2>&1; then python3 -B -m py_compile "$SANDBOX_PREVIEW_PATH"; elif command -v python >/dev/null 2>&1; then python -B -m py_compile "$SANDBOX_PREVIEW_PATH"; else echo "python is not installed" >&2; exit 127; fi`,
		}, true
	case "bash", "sh", "shell":
		return sandboxRuntimeSyntaxCheckSpec{
			extension: ".sh",
			command:   `sh -n "$SANDBOX_PREVIEW_PATH"`,
		}, true
	default:
		return sandboxRuntimeSyntaxCheckSpec{}, false
	}
}

func sandboxRuntimeFormatSpecForPath(path string) (sandboxRuntimeFormatSpec, bool) {
	switch strings.ToLower(filepath.Ext(strings.TrimSpace(path))) {
	case ".py", ".pyw":
		return sandboxRuntimeFormatSpec{
			extension: ".py",
			command:   `if command -v ruff >/dev/null 2>&1; then ruff format "$SANDBOX_PREVIEW_PATH"; elif command -v black >/dev/null 2>&1; then black --quiet "$SANDBOX_PREVIEW_PATH"; else exit 0; fi`,
		}, true
	case ".js", ".mjs", ".cjs", ".ts", ".tsx":
		return sandboxRuntimeFormatSpec{
			extension: ".js",
			command:   `if command -v prettier >/dev/null 2>&1; then prettier --write "$SANDBOX_PREVIEW_PATH"; elif command -v eslint >/dev/null 2>&1; then eslint --fix "$SANDBOX_PREVIEW_PATH"; else exit 0; fi`,
		}, true
	case ".sh", ".bash":
		return sandboxRuntimeFormatSpec{
			extension: ".sh",
			command:   `if command -v shfmt >/dev/null 2>&1; then shfmt -w "$SANDBOX_PREVIEW_PATH"; else exit 0; fi`,
		}, true
	default:
		return sandboxRuntimeFormatSpec{}, false
	}
}

func sandboxRuntimeSyntaxCheckSpecForPath(path string) (sandboxRuntimeSyntaxCheckSpec, bool) {
	switch strings.ToLower(filepath.Ext(strings.TrimSpace(path))) {
	case ".py", ".pyw":
		return sandboxRuntimeSyntaxCheckSpec{
			extension: ".py",
			command:   `if command -v python3 >/dev/null 2>&1; then python3 -B -m py_compile "$SANDBOX_PREVIEW_PATH"; elif command -v python >/dev/null 2>&1; then python -B -m py_compile "$SANDBOX_PREVIEW_PATH"; else exit 0; fi`,
		}, true
	case ".js", ".mjs", ".cjs":
		return sandboxRuntimeSyntaxCheckSpec{
			extension: ".js",
			command:   `if command -v node >/dev/null 2>&1; then node --check "$SANDBOX_PREVIEW_PATH"; else exit 0; fi`,
		}, true
	case ".ts", ".tsx":
		return sandboxRuntimeSyntaxCheckSpec{
			extension: ".ts",
			command:   `if command -v tsc >/dev/null 2>&1; then tsc --noEmit --pretty false "$SANDBOX_PREVIEW_PATH"; else exit 0; fi`,
		}, true
	case ".sh", ".bash":
		return sandboxRuntimeSyntaxCheckSpec{
			extension: ".sh",
			command:   `sh -n "$SANDBOX_PREVIEW_PATH"`,
		}, true
	default:
		return sandboxRuntimeSyntaxCheckSpec{}, false
	}
}

func sandboxRuntimeNodeScriptExtension(code string) string {
	trimmed := strings.TrimSpace(code)
	if trimmed == "" {
		return ".js"
	}
	if strings.Contains(trimmed, "\nimport ") || strings.HasPrefix(trimmed, "import ") ||
		strings.Contains(trimmed, "\nexport ") || strings.HasPrefix(trimmed, "export ") {
		return ".mjs"
	}
	return ".js"
}

func normalizeCodeInterpreterLanguage(language string) string {
	switch strings.ToLower(strings.TrimSpace(language)) {
	case "python", "py":
		return "python"
	case "bash", "sh", "shell":
		return "bash"
	case "nodejs", "js", "javascript":
		return "nodejs"
	default:
		return ""
	}
}
