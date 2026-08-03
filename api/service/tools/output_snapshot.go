package tools

import (
	"context"
	"encoding/base64"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"sync"

	"github.com/53AI/53AIHub/service/sandboxruntime"
)

// SandboxOutputSnapshot stores content hashes plus cheap file metadata for
// output/ and outputs/. Metadata lets subsequent turns avoid reading and
// hashing files that have not changed.
type SandboxOutputSnapshot struct {
	Files    map[string]string
	Metadata map[string]SandboxOutputFileMetadata
}

type SandboxOutputFileMetadata struct {
	Size               int64
	ModTimeUnixNano    int64
	ChangeTimeUnixNano int64
	Mode               uint32
}

type sandboxOutputFileRecord struct {
	FileName string
	AbsPath  string
	Metadata SandboxOutputFileMetadata
}

type sandboxOutputSnapshotHistory struct {
	mu           sync.RWMutex
	latestTurnID string
	latest       *SandboxOutputSnapshot
	turns        map[string]*SandboxOutputSnapshot
}

var sandboxOutputSnapshotHistories sync.Map

// SnapshotSandboxOutputFiles captures the current output/ and outputs/ subtrees.
func SnapshotSandboxOutputFiles(root string) (*SandboxOutputSnapshot, error) {
	snapshot, _, err := captureSandboxOutputFiles(nil, root)
	return snapshot, err
}

// DiffSandboxOutputFiles returns only new or changed output/ or outputs/ files.
func DiffSandboxOutputFiles(prev *SandboxOutputSnapshot, root string) ([]OutputFile, error) {
	_, files, err := captureSandboxOutputFiles(prev, root)
	return files, err
}

// primeSandboxOutputSnapshot seeds the conversation snapshot with the current workspace state.
// Call this before the first tool mutation in a conversation so pre-existing output/ or outputs/ files
// are treated as baseline instead of brand-new artifacts.
func primeSandboxOutputSnapshot(ctx context.Context, root string) error {
	conversationKey := sandboxOutputConversationKey(ctx)
	if conversationKey == "" {
		return nil
	}
	root = strings.TrimSpace(root)
	if root == "" {
		return nil
	}

	history := getSandboxOutputSnapshotHistory(conversationKey)
	if history == nil {
		return nil
	}

	history.mu.RLock()
	if history.latest != nil {
		history.mu.RUnlock()
		return nil
	}
	history.mu.RUnlock()

	snapshot, err := SnapshotSandboxOutputFiles(root)
	if err != nil {
		return err
	}

	history.mu.Lock()
	defer history.mu.Unlock()
	if history.latest != nil {
		return nil
	}
	if history.turns == nil {
		history.turns = make(map[string]*SandboxOutputSnapshot)
	}
	turnID := sandboxOutputTurnIdentity(ctx)
	if turnID == "" {
		turnID = conversationKey + ":baseline"
	}
	cloned := cloneSandboxOutputSnapshot(snapshot)
	history.turns[turnID] = cloneSandboxOutputSnapshot(cloned)
	history.latest = cloned
	history.latestTurnID = turnID
	return nil
}

func captureSandboxOutputFiles(prev *SandboxOutputSnapshot, root string) (*SandboxOutputSnapshot, []OutputFile, error) {
	return captureSandboxOutputFilesWithReader(prev, root, os.ReadFile)
}

func captureSandboxOutputFilesWithReader(prev *SandboxOutputSnapshot, root string, readFile func(string) ([]byte, error)) (*SandboxOutputSnapshot, []OutputFile, error) {
	records, err := scanSandboxOutputFiles(root)
	if err != nil {
		return nil, nil, err
	}
	if readFile == nil {
		readFile = os.ReadFile
	}

	snapshot := &SandboxOutputSnapshot{
		Files:    make(map[string]string, len(records)),
		Metadata: make(map[string]SandboxOutputFileMetadata, len(records)),
	}
	prevFiles := map[string]string{}
	prevMetadata := map[string]SandboxOutputFileMetadata{}
	if prev != nil && len(prev.Files) > 0 {
		prevFiles = prev.Files
	}
	if prev != nil && len(prev.Metadata) > 0 {
		prevMetadata = prev.Metadata
	}

	changed := make([]OutputFile, 0, len(records))
	for _, record := range records {
		snapshot.Metadata[record.FileName] = record.Metadata
		if previous, exists := prevMetadata[record.FileName]; exists && previous == record.Metadata {
			if prevHash, hasHash := prevFiles[record.FileName]; hasHash {
				snapshot.Files[record.FileName] = prevHash
				continue
			}
		}

		content, readErr := readFile(record.AbsPath)
		if readErr != nil {
			return nil, nil, readErr
		}
		hash := sandboxruntime.HashBytes(content)
		snapshot.Files[record.FileName] = hash
		if prevHash, exists := prevFiles[record.FileName]; exists && prevHash == hash {
			continue
		}
		changed = append(changed, OutputFile{
			FileName: record.FileName,
			Content:  base64.StdEncoding.EncodeToString(content),
			MimeType: sandboxruntime.DetectMimeType(record.AbsPath),
			Size:     len(content),
		})
	}

	sort.Slice(changed, func(i, j int) bool {
		return changed[i].FileName < changed[j].FileName
	})
	return snapshot, changed, nil
}

func scanSandboxOutputFiles(root string) ([]sandboxOutputFileRecord, error) {
	root = filepath.Clean(strings.TrimSpace(root))
	if root == "" || root == "." || root == string(filepath.Separator) {
		return nil, fmt.Errorf("invalid sandbox root: %q", root)
	}

	records := make([]sandboxOutputFileRecord, 0)
	for _, subtree := range []string{"output", "outputs"} {
		subtreeRoot := filepath.Join(root, subtree)
		info, err := os.Stat(subtreeRoot)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return nil, err
		}
		if !info.IsDir() {
			continue
		}

		err = filepath.WalkDir(subtreeRoot, func(path string, d fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if d.IsDir() {
				return nil
			}

			rel, relErr := filepath.Rel(root, path)
			if relErr != nil {
				return relErr
			}
			rel = filepath.ToSlash(rel)
			if !strings.HasPrefix(rel, subtree+"/") {
				return nil
			}

			info, infoErr := d.Info()
			if infoErr != nil {
				return infoErr
			}
			records = append(records, sandboxOutputFileRecord{
				FileName: rel,
				AbsPath:  path,
				Metadata: SandboxOutputFileMetadata{
					Size:               info.Size(),
					ModTimeUnixNano:    info.ModTime().UnixNano(),
					ChangeTimeUnixNano: fileChangeTimeUnixNano(info),
					Mode:               uint32(info.Mode()),
				},
			})
			return nil
		})
		if err != nil {
			return nil, err
		}
	}

	sort.Slice(records, func(i, j int) bool {
		return records[i].FileName < records[j].FileName
	})
	return records, nil
}

func fileChangeTimeUnixNano(info fs.FileInfo) int64 {
	if info == nil || info.Sys() == nil {
		return 0
	}
	value := reflect.ValueOf(info.Sys())
	if value.Kind() == reflect.Ptr {
		if value.IsNil() {
			return 0
		}
		value = value.Elem()
	}
	if value.Kind() != reflect.Struct {
		return 0
	}
	for _, fieldName := range []string{"Ctim", "Ctimespec"} {
		field := value.FieldByName(fieldName)
		if field.Kind() != reflect.Struct {
			continue
		}
		sec := field.FieldByName("Sec")
		nsec := field.FieldByName("Nsec")
		if sec.IsValid() && nsec.IsValid() && sec.CanInt() && nsec.CanInt() {
			return sec.Int()*int64(1e9) + nsec.Int()
		}
	}
	return 0
}

func loadSandboxOutputSnapshot(ctx context.Context) *SandboxOutputSnapshot {
	conversationKey := sandboxOutputConversationKey(ctx)
	if conversationKey == "" {
		return nil
	}
	history := getSandboxOutputSnapshotHistory(conversationKey)
	if history == nil {
		return nil
	}
	history.mu.RLock()
	defer history.mu.RUnlock()
	return cloneSandboxOutputSnapshot(history.latest)
}

func rememberSandboxOutputSnapshot(ctx context.Context, snapshot *SandboxOutputSnapshot) {
	if snapshot == nil {
		return
	}
	conversationKey := sandboxOutputConversationKey(ctx)
	if conversationKey == "" {
		return
	}
	turnID := sandboxOutputTurnIdentity(ctx)
	if turnID == "" {
		turnID = conversationKey
	}

	history := getSandboxOutputSnapshotHistory(conversationKey)
	if history == nil {
		return
	}

	cloned := cloneSandboxOutputSnapshot(snapshot)
	history.mu.Lock()
	defer history.mu.Unlock()
	if history.turns == nil {
		history.turns = make(map[string]*SandboxOutputSnapshot)
	}
	history.turns[turnID] = cloneSandboxOutputSnapshot(cloned)
	history.latest = cloned
	history.latestTurnID = turnID
}

func getSandboxOutputSnapshotHistory(conversationKey string) *sandboxOutputSnapshotHistory {
	if conversationKey == "" {
		return nil
	}
	if existing, ok := sandboxOutputSnapshotHistories.Load(conversationKey); ok {
		if history, ok := existing.(*sandboxOutputSnapshotHistory); ok {
			return history
		}
	}

	history := &sandboxOutputSnapshotHistory{}
	actual, _ := sandboxOutputSnapshotHistories.LoadOrStore(conversationKey, history)
	if actual == nil {
		return history
	}
	if existing, ok := actual.(*sandboxOutputSnapshotHistory); ok {
		return existing
	}
	return history
}

func cloneSandboxOutputSnapshot(snapshot *SandboxOutputSnapshot) *SandboxOutputSnapshot {
	if snapshot == nil {
		return nil
	}
	cloned := &SandboxOutputSnapshot{
		Files:    make(map[string]string, len(snapshot.Files)),
		Metadata: make(map[string]SandboxOutputFileMetadata, len(snapshot.Metadata)),
	}
	for fileName, hash := range snapshot.Files {
		cloned.Files[fileName] = hash
	}
	for fileName, metadata := range snapshot.Metadata {
		cloned.Metadata[fileName] = metadata
	}
	return cloned
}
