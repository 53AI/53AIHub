package actionruntime

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
)

const DefaultArtifactMaxSize int64 = 100 << 20

var (
	ErrArtifactPathOutsideRoot = errors.New("artifact path is outside run workspace")
	ErrArtifactNotRegular      = errors.New("artifact is not a regular file")
	ErrArtifactRunIDInvalid    = errors.New("artifact run id is invalid")
)

type ArtifactStore struct {
	root    string
	nextVer atomic.Uint64
}

func NewArtifactStore(root string) (*ArtifactStore, error) {
	root, err := filepath.Abs(root)
	if err != nil {
		return nil, fmt.Errorf("resolve artifact store root: %w", err)
	}
	return &ArtifactStore{root: root}, nil
}

func (s *ArtifactStore) Archive(ctx context.Context, runID, workspaceRoot, sourcePath string) (ActionArtifact, error) {
	if s == nil {
		return ActionArtifact{}, errors.New("artifact store is nil")
	}
	if !safeArtifactSegment(runID) {
		return ActionArtifact{}, ErrArtifactRunIDInvalid
	}
	var verified ActionArtifact
	var err error
	verified, err = VerifyArtifactInWorkspace(ctx, workspaceRoot, sourcePath, 0)
	if err != nil {
		return ActionArtifact{}, err
	}
	directory := filepath.Join(s.root, runID)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return ActionArtifact{}, fmt.Errorf("create artifact directory: %w", err)
	}
	var destination string
	for {
		version := s.nextVer.Add(1)
		destination = filepath.Join(directory, fmt.Sprintf("v%d-%s", version, verified.Name))
		if err := copyArtifact(ctx, verified.Path, destination, verified.Size); err != nil {
			if errors.Is(err, os.ErrExist) {
				continue
			}
			return ActionArtifact{}, err
		}
		break
	}
	verified.ID = filepath.Join(runID, filepath.Base(destination))
	verified.Path = destination
	return verified, nil
}

func VerifyArtifact(ctx context.Context, root, path string, maxSize int64) (ActionArtifact, error) {
	if err := contextError(ctx); err != nil {
		return ActionArtifact{}, err
	}
	root, err := filepath.Abs(root)
	if err != nil {
		return ActionArtifact{}, fmt.Errorf("resolve artifact root: %w", err)
	}
	path, err = filepath.Abs(path)
	if err != nil {
		return ActionArtifact{}, fmt.Errorf("resolve artifact path: %w", err)
	}
	relative, err := filepath.Rel(root, path)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return ActionArtifact{}, ErrArtifactPathOutsideRoot
	}
	info, err := os.Lstat(path)
	if err != nil {
		return ActionArtifact{}, fmt.Errorf("stat artifact: %w", err)
	}
	if !info.Mode().IsRegular() {
		return ActionArtifact{}, ErrArtifactNotRegular
	}
	if maxSize <= 0 {
		maxSize = DefaultArtifactMaxSize
	}
	if info.Size() > maxSize {
		return ActionArtifact{}, fmt.Errorf("artifact exceeds size limit: %d > %d", info.Size(), maxSize)
	}
	mimeType, err := detectMimeType(path)
	if err != nil {
		return ActionArtifact{}, err
	}
	return ActionArtifact{ID: relative, Name: filepath.Base(path), Path: path, MimeType: mimeType, Size: info.Size()}, nil
}

func detectMimeType(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", fmt.Errorf("open artifact for type detection: %w", err)
	}
	defer file.Close()
	buffer := make([]byte, 512)
	read, err := file.Read(buffer)
	if err != nil && !errors.Is(err, io.EOF) {
		return "", fmt.Errorf("read artifact for type detection: %w", err)
	}
	return http.DetectContentType(buffer[:read]), nil
}

func copyArtifact(ctx context.Context, source, destination string, expectedSize int64) error {
	input, err := os.Open(source)
	if err != nil {
		return fmt.Errorf("open artifact source: %w", err)
	}
	defer input.Close()
	output, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return fmt.Errorf("create archived artifact: %w", err)
	}
	removeOnError := true
	defer func() {
		_ = output.Close()
		if removeOnError {
			_ = os.Remove(destination)
		}
	}()
	buffer := make([]byte, 32*1024)
	var copied int64
	for {
		if err := contextError(ctx); err != nil {
			return err
		}
		read, readErr := input.Read(buffer)
		if read > 0 {
			written, writeErr := output.Write(buffer[:read])
			copied += int64(written)
			if writeErr != nil {
				return fmt.Errorf("write archived artifact: %w", writeErr)
			}
			if written != read {
				return io.ErrShortWrite
			}
		}
		if errors.Is(readErr, io.EOF) {
			break
		}
		if readErr != nil {
			return fmt.Errorf("read artifact source: %w", readErr)
		}
	}
	if copied != expectedSize {
		return fmt.Errorf("archived artifact size mismatch: %d != %d", copied, expectedSize)
	}
	if err := output.Close(); err != nil {
		return fmt.Errorf("close archived artifact: %w", err)
	}
	removeOnError = false
	return nil
}

func safeArtifactSegment(value string) bool {
	return value != "" && value != "." && value != ".." && filepath.Base(value) == value && !strings.ContainsRune(value, filepath.Separator)
}

func contextError(ctx context.Context) error {
	if ctx == nil {
		return nil
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
		return nil
	}
}
