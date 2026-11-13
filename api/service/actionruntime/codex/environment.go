package codex

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// Environment sets an installed UTF-8 locale before app-server captures shell
// snapshots. A shell_environment_policy override is too late for those snapshots.
func Environment(ctx context.Context, overrides []string) ([]string, error) {
	env := append(os.Environ(), overrides...)
	if python := environmentValue(env, "ACTION_RUNTIME_PYTHON_BINARY"); python != "" {
		if !filepath.IsAbs(python) {
			return nil, fmt.Errorf("ACTION_RUNTIME_PYTHON_BINARY must be absolute")
		}
		if _, err := os.Stat(python); err != nil {
			return nil, fmt.Errorf("Action Runtime Python: %w", err)
		}
		env = append(env, "PATH="+filepath.Dir(python)+string(os.PathListSeparator)+environmentValue(env, "PATH"))
	}
	if runtime.GOOS != "linux" {
		return env, nil
	}
	command := exec.CommandContext(ctx, "locale", "-a")
	command.Env = append(env, "LC_ALL=C")
	available, err := command.Output()
	if err != nil {
		return nil, fmt.Errorf("list installed locales: %w", err)
	}
	current := environmentValue(env, "LC_ALL")
	if current == "" {
		current = environmentValue(env, "LANG")
	}
	selected, err := selectUTF8Locale(current, string(available))
	if err != nil {
		return nil, err
	}
	return append(env, "LANG="+selected, "LC_ALL="+selected), nil
}

func selectUTF8Locale(current, available string) (string, error) {
	normalize := func(value string) string { return strings.ReplaceAll(strings.ToLower(value), "-", "") }
	locales := strings.Fields(available)
	for _, preferred := range []string{current, "C.UTF-8", "en_US.UTF-8"} {
		for _, candidate := range locales {
			if strings.Contains(normalize(candidate), "utf8") && normalize(candidate) == normalize(preferred) {
				return candidate, nil
			}
		}
	}
	for _, candidate := range locales {
		if strings.Contains(normalize(candidate), "utf8") {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("Action Runtime requires an installed UTF-8 locale; check locale -a")
}

func environmentValue(env []string, name string) string {
	for i := len(env) - 1; i >= 0; i-- {
		if value, ok := strings.CutPrefix(env[i], name+"="); ok {
			return value
		}
	}
	return ""
}
