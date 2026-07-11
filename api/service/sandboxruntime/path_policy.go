package sandboxruntime

import (
	"fmt"
	"path/filepath"
	"strings"
)

func ValidateWorkspacePath(root, p string) error {
	_, err := NormalizeWorkspacePath(root, p)
	return err
}

func NormalizeWorkspacePath(root, p string) (string, error) {
	root = filepath.Clean(strings.TrimSpace(root))
	if root == "" || root == "." || root == "/" {
		return "", ErrInvalidPath
	}
	trimmed := strings.TrimSpace(p)
	if trimmed == "" {
		return "", ErrInvalidPath
	}
	trimmed = strings.ReplaceAll(trimmed, "\\", "/")
	trimmed = strings.TrimPrefix(trimmed, "./")
	trimmed = strings.TrimPrefix(trimmed, "/")
	cleaned := filepath.Clean(trimmed)
	if cleaned == "." || cleaned == "" || strings.HasPrefix(cleaned, "..") {
		return "", ErrInvalidPath
	}
	joined := filepath.Clean(filepath.Join(root, cleaned))
	if joined != root && !strings.HasPrefix(joined, root+string(filepath.Separator)) {
		return "", ErrInvalidPath
	}
	return joined, nil
}

func IsOutputPath(root, p string) bool {
	normalized, err := NormalizeWorkspacePath(root, p)
	if err != nil {
		return false
	}
	outputRoot := filepath.Clean(filepath.Join(root, "output"))
	return normalized == outputRoot || strings.HasPrefix(normalized, outputRoot+string(filepath.Separator))
}

func ResolveRelPath(root, p string) (string, error) {
	normalized, err := NormalizeWorkspacePath(root, p)
	if err != nil {
		return "", fmt.Errorf("path %q must stay within workspace %q: %w", p, root, err)
	}
	return normalized, nil
}
