package tools

import (
	"context"
	"encoding/base64"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/53AI/53AIHub/service/sandboxruntime"
)

// SandboxOutputSnapshot stores the content hash of files under output/ and outputs/.
type SandboxOutputSnapshot struct {
	Files map[string]string
}

type sandboxOutputFileRecord struct {
	FileName string
	Content  []byte
	Hash     string
	MimeType string
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
	records, err := scanSandboxOutputFiles(root)
	if err != nil {
		return nil, nil, err
	}

	snapshot := &SandboxOutputSnapshot{Files: make(map[string]string, len(records))}
	prevFiles := map[string]string{}
	if prev != nil && len(prev.Files) > 0 {
		prevFiles = prev.Files
	}

	changed := make([]OutputFile, 0, len(records))
	for _, record := range records {
		snapshot.Files[record.FileName] = record.Hash
		if prevHash, exists := prevFiles[record.FileName]; exists && prevHash == record.Hash {
			continue
		}
		changed = append(changed, OutputFile{
			FileName: record.FileName,
			Content:  base64.StdEncoding.EncodeToString(record.Content),
			MimeType: record.MimeType,
			Size:     len(record.Content),
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

			content, readErr := os.ReadFile(path)
			if readErr != nil {
				return readErr
			}
			rel, relErr := filepath.Rel(root, path)
			if relErr != nil {
				return relErr
			}
			rel = filepath.ToSlash(rel)
			if !strings.HasPrefix(rel, subtree+"/") {
				return nil
			}

			records = append(records, sandboxOutputFileRecord{
				FileName: rel,
				Content:  content,
				Hash:     sandboxruntime.HashBytes(content),
				MimeType: sandboxruntime.DetectMimeType(path),
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
	cloned := &SandboxOutputSnapshot{Files: make(map[string]string, len(snapshot.Files))}
	for fileName, hash := range snapshot.Files {
		cloned.Files[fileName] = hash
	}
	return cloned
}
