package skill

import (
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"
)

type RunScope struct {
	Env      map[string]string
	Config   map[string]bool
	BinCache map[string]bool
	CWD      string
	EnvVars  map[string]string
	Secrets  map[string]string
}

type SkillSnapshot struct {
	RunID        string
	CreatedAt    time.Time
	Skills       []*Skill
	Blocked      map[string][]string
	ScopeSummary map[string]interface{}
}

func BuildDefaultRunScope() RunScope {
	envMap := make(map[string]string)
	for _, item := range os.Environ() {
		parts := strings.SplitN(item, "=", 2)
		if len(parts) == 2 {
			envMap[parts[0]] = parts[1]
		}
	}
	return RunScope{
		Env:      envMap,
		Config:   map[string]bool{},
		BinCache: map[string]bool{},
		EnvVars:  map[string]string{},
		Secrets:  map[string]string{},
	}
}

func EvaluateSkillGating(skill *Skill, scope RunScope) (bool, []string) {
	if skill == nil {
		return false, []string{"skill is nil"}
	}
	var reasons []string

	for _, bin := range skill.Requires.Bins {
		bin = strings.TrimSpace(bin)
		if bin == "" {
			continue
		}
		if !hasBin(bin, scope) {
			reasons = append(reasons, fmt.Sprintf("missing required binary: %s", bin))
		}
	}

	for _, envKey := range skill.Requires.Env {
		envKey = strings.TrimSpace(envKey)
		if envKey == "" {
			continue
		}
		if strings.TrimSpace(scope.Env[envKey]) == "" {
			reasons = append(reasons, fmt.Sprintf("missing required env: %s", envKey))
		}
	}

	for _, cfg := range skill.Requires.Config {
		cfg = strings.TrimSpace(cfg)
		if cfg == "" {
			continue
		}
		if !scope.Config[cfg] {
			reasons = append(reasons, fmt.Sprintf("missing required config: %s", cfg))
		}
	}

	return len(reasons) == 0, reasons
}

func hasBin(bin string, scope RunScope) bool {
	if scope.BinCache != nil {
		if v, ok := scope.BinCache[bin]; ok {
			return v
		}
	}
	_, err := exec.LookPath(bin)
	exists := err == nil
	if scope.BinCache != nil {
		scope.BinCache[bin] = exists
	}
	return exists
}
