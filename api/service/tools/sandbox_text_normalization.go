package tools

import (
	"path/filepath"
	"strings"

	"golang.org/x/text/unicode/norm"
)

var sandboxTextNormalizationReplacer = strings.NewReplacer(
	"\u200b", "",
	"\u200c", "",
	"\u200d", "",
	"\u2060", "",
	"\ufeff", "",
	"\u2018", "'",
	"\u2019", "'",
	"\u201c", "\"",
	"\u201d", "\"",
)

func normalizeSandboxTextContentForPath(path string, content string) string {
	if strings.TrimSpace(content) == "" {
		return content
	}
	if !shouldNormalizeSandboxTextContentForPath(path) {
		return content
	}
	normalized := norm.NFKC.String(content)
	return sandboxTextNormalizationReplacer.Replace(normalized)
}

func normalizeSandboxTextContentForLanguage(language string, content string) string {
	switch normalizeCodeInterpreterLanguage(language) {
	case "python":
		return normalizeSandboxTextContentForPath("snippet.py", content)
	case "bash":
		return normalizeSandboxTextContentForPath("snippet.sh", content)
	case "nodejs":
		return normalizeSandboxTextContentForPath("snippet.js", content)
	default:
		return content
	}
}

func shouldNormalizeSandboxTextContentForPath(path string) bool {
	trimmed := strings.ToLower(strings.TrimSpace(path))
	if trimmed == "" {
		return false
	}
	switch filepath.Base(trimmed) {
	case "dockerfile", "makefile", "justfile", "procfile":
		return true
	}
	switch strings.ToLower(filepath.Ext(trimmed)) {
	case ".go", ".py", ".pyw", ".js", ".mjs", ".cjs", ".ts", ".tsx",
		".sh", ".bash", ".json", ".jsonc", ".yaml", ".yml", ".toml":
		return true
	default:
		return false
	}
}
