package docker

import (
	"context"
	"os"
	"path/filepath"
	"strings"
)

type FsBridge struct {
	hostRoot         string
	containerWorkdir string
}

func NewFsBridge(hostRoot, containerWorkdir string) *FsBridge {
	if strings.TrimSpace(hostRoot) == "" {
		hostRoot = filepath.Join(os.TempDir(), "53ai-sandbox")
	}
	if strings.TrimSpace(containerWorkdir) == "" {
		containerWorkdir = "/workspace"
	}
	return &FsBridge{hostRoot: hostRoot, containerWorkdir: containerWorkdir}
}

func (b *FsBridge) resolveHostPath(path string) string {
	if strings.TrimSpace(path) == "" || path == "." {
		return b.hostRoot
	}
	path = strings.ReplaceAll(path, "\\", "/")
	path = strings.TrimPrefix(path, "./")
	if strings.HasPrefix(path, "/") {
		cleaned := filepath.Clean(path)
		containerRoot := filepath.Clean(b.containerWorkdir)
		if cleaned == containerRoot || strings.HasPrefix(cleaned, containerRoot+"/") {
			suffix := strings.TrimPrefix(cleaned, containerRoot)
			suffix = strings.TrimPrefix(suffix, "/")
			return filepath.Clean(filepath.Join(b.hostRoot, suffix))
		}
		return b.hostRoot
	}
	return filepath.Clean(filepath.Join(b.hostRoot, path))
}

func (b *FsBridge) resolveContainerPath(path string) string {
	containerRoot := filepath.Clean(b.containerWorkdir)
	if strings.TrimSpace(path) == "" || path == "." {
		return containerRoot
	}
	path = strings.ReplaceAll(path, "\\", "/")
	path = strings.TrimPrefix(path, "./")
	if strings.HasPrefix(path, "/") {
		cleaned := filepath.Clean(path)
		if cleaned == containerRoot || strings.HasPrefix(cleaned, containerRoot+"/") {
			return cleaned
		}
		return containerRoot
	}
	return filepath.Clean(filepath.Join(containerRoot, path))
}

func (b *FsBridge) ReadFile(ctx context.Context, path string) (string, error) {
	cleaned := b.resolveHostPath(path)
	raw, err := os.ReadFile(cleaned)
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

func (b *FsBridge) WriteFile(ctx context.Context, path, content string, appendMode bool) error {
	cleaned := b.resolveHostPath(path)
	if err := os.MkdirAll(filepath.Dir(cleaned), 0755); err != nil {
		return err
	}
	flag := os.O_CREATE | os.O_WRONLY
	if appendMode {
		flag |= os.O_APPEND
	} else {
		flag |= os.O_TRUNC
	}
	f, err := os.OpenFile(cleaned, flag, 0644)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = f.WriteString(content)
	return err
}

func (b *FsBridge) ListDir(ctx context.Context, path string) ([]string, error) {
	cleaned := b.resolveHostPath(path)
	entries, err := os.ReadDir(cleaned)
	if err != nil {
		return nil, err
	}
	out := make([]string, 0, len(entries))
	for _, entry := range entries {
		out = append(out, filepath.ToSlash(filepath.Join(cleaned, entry.Name())))
	}
	return out, nil
}

func (b *FsBridge) Stat(ctx context.Context, path string) (os.FileInfo, error) {
	cleaned := b.resolveHostPath(path)
	return os.Stat(cleaned)
}

func (b *FsBridge) ContainerPath(path string) string {
	return b.resolveContainerPath(path)
}
