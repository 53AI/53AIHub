package service

import (
	"fmt"
	"path/filepath"
	"strings"
	"sync"

	"github.com/53AI/53AIHub/config"
)

type recordingAssemblyLockRegistry struct {
	mu    sync.Mutex
	locks map[int64]*sync.Mutex
}

var assemblyLockRegistry = recordingAssemblyLockRegistry{locks: map[int64]*sync.Mutex{}}

func (r *recordingAssemblyLockRegistry) lock(jobID int64) func() {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.locks == nil {
		r.locks = map[int64]*sync.Mutex{}
	}
	lk, ok := r.locks[jobID]
	if !ok {
		lk = &sync.Mutex{}
		r.locks[jobID] = lk
	}
	lk.Lock()
	return lk.Unlock
}

type RecordingAssemblyService struct {
	eid int64
}

func NewRecordingAssemblyService(eid int64) *RecordingAssemblyService {
	return &RecordingAssemblyService{eid: eid}
}

func (s *RecordingAssemblyService) buildAssemblyBufferKey(jobID int64, segmentIndex int64) string {
	dir := filepath.Join(recordingAssemblySpoolRootDir(), fmt.Sprintf("%d", s.eid), fmt.Sprintf("%d", jobID))
	return filepath.Join(dir, fmt.Sprintf("segment-%d.spool", segmentIndex))
}

func recordingAssemblySpoolRootDir() string {
	root := strings.TrimSpace(recordingAssemblySpoolRootDirFunc())
	if root == "" {
		root = config.RecordingAssemblySpoolRoot()
	}
	return root
}
