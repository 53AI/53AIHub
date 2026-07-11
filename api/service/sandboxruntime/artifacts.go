package sandboxruntime

import (
	"crypto/sha256"
	"encoding/hex"
	"io"
	"mime"
	"os"
	"path/filepath"
	"strings"
)

func DetectMimeType(path string) string {
	if mt := mime.TypeByExtension(strings.ToLower(filepath.Ext(path))); mt != "" {
		return mt
	}
	return "application/octet-stream"
}

func HashBytes(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func ScanArtifacts(root string, recursive bool, limit int) ([]Artifact, error) {
	artifactRoot := filepath.Join(root, "output")
	if _, err := os.Stat(artifactRoot); err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var entries []Artifact
	walkFn := func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		entries = append(entries, Artifact{
			Path:        filepath.ToSlash(rel),
			FileName:    filepath.Base(path),
			ContentType: DetectMimeType(path),
			Size:        int64(len(raw)),
			Checksum:    HashBytes(raw),
		})
		if limit > 0 && len(entries) >= limit {
			return io.EOF
		}
		return nil
	}
	if recursive {
		err := filepath.WalkDir(artifactRoot, walkFn)
		if err != nil && err != io.EOF {
			return nil, err
		}
		return entries, nil
	}
	ents, err := os.ReadDir(artifactRoot)
	if err != nil {
		return nil, err
	}
	for _, ent := range ents {
		if ent.IsDir() {
			continue
		}
		path := filepath.Join(artifactRoot, ent.Name())
		raw, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return nil, err
		}
		entries = append(entries, Artifact{
			Path:        filepath.ToSlash(rel),
			FileName:    ent.Name(),
			ContentType: DetectMimeType(path),
			Size:        int64(len(raw)),
			Checksum:    HashBytes(raw),
		})
		if limit > 0 && len(entries) >= limit {
			break
		}
	}
	return entries, nil
}
