package rag

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/service/vectorstore"
)

const (
	orphanVectorCleanupFlushInterval = 3 * time.Second
	orphanVectorCleanupMaxBatchSize  = 100
)

type vectorDeleteClient interface {
	Delete(ctx context.Context, collection string, ids []interface{}) error
}

type orphanVectorBatchKey struct {
	eid        int64
	collection string
}

type orphanVectorBatch struct {
	eid        int64
	collection string
	vectorIDs  []string
}

type orphanVectorCleanupTask struct {
	eid        int64
	collection string
	vectorIDs  []string
}

type orphanVectorCleanupManager struct {
	flushInterval time.Duration
	maxBatchSize  int

	mu      sync.Mutex
	pending map[orphanVectorBatchKey]*orphanVectorBatch

	startOnce sync.Once

	vectorStoreGetter func() (vectorDeleteClient, error)
}

var (
	orphanVectorCleanupOnce sync.Once
	orphanVectorCleanupMgr  *orphanVectorCleanupManager
)

func newOrphanVectorCleanupManager() *orphanVectorCleanupManager {
	return &orphanVectorCleanupManager{
		flushInterval: orphanVectorCleanupFlushInterval,
		maxBatchSize:  orphanVectorCleanupMaxBatchSize,
		pending:       make(map[orphanVectorBatchKey]*orphanVectorBatch),
		vectorStoreGetter: func() (vectorDeleteClient, error) {
			store, err := vectorstore.GetGlobalVectorStore()
			if err != nil {
				return nil, err
			}
			return store, nil
		},
	}
}

func getOrphanVectorCleanupManager() *orphanVectorCleanupManager {
	orphanVectorCleanupOnce.Do(func() {
		orphanVectorCleanupMgr = newOrphanVectorCleanupManager()
		orphanVectorCleanupMgr.start()
	})
	return orphanVectorCleanupMgr
}

func (m *orphanVectorCleanupManager) start() {
	if m == nil {
		return
	}
	m.startOnce.Do(func() {
		if m.flushInterval <= 0 {
			m.flushInterval = orphanVectorCleanupFlushInterval
		}
		if m.maxBatchSize <= 0 {
			m.maxBatchSize = orphanVectorCleanupMaxBatchSize
		}
		go m.flushLoop()
	})
}

func (m *orphanVectorCleanupManager) flushLoop() {
	ticker := time.NewTicker(m.flushInterval)
	defer ticker.Stop()

	for range ticker.C {
		tasks := m.flushPending()
		for _, task := range tasks {
			if err := m.processTask(context.Background(), task); err != nil {
				logger.SysLogf("【孤儿向量清理】批次执行失败: eid=%d, collection=%s, count=%d, err=%v",
					task.eid, task.collection, len(task.vectorIDs), err)
			}
		}
	}
}

func (m *orphanVectorCleanupManager) enqueueBatch(eid int64, collection string, vectorIDs []string) {
	if m == nil || strings.TrimSpace(collection) == "" {
		return
	}
	uniqueIDs := uniqueOrphanVectorIDs(vectorIDs)
	if len(uniqueIDs) == 0 {
		return
	}

	m.start()

	collection = strings.TrimSpace(collection)
	key := orphanVectorBatchKey{eid: eid, collection: collection}
	m.mu.Lock()
	batch, exists := m.pending[key]
	if !exists {
		batch = &orphanVectorBatch{eid: eid, collection: collection}
		m.pending[key] = batch
	}
	batch.vectorIDs = appendUniqueStrings(batch.vectorIDs, uniqueIDs)
	shouldFlush := m.maxBatchSize > 0 && len(batch.vectorIDs) >= m.maxBatchSize
	task := orphanVectorCleanupTask{}
	if shouldFlush {
		task = orphanVectorCleanupTask{
			eid:        batch.eid,
			collection: batch.collection,
			vectorIDs:  append([]string(nil), batch.vectorIDs...),
		}
		delete(m.pending, key)
	}
	m.mu.Unlock()

	if shouldFlush {
		go func() {
			if err := m.processTask(context.Background(), task); err != nil {
				logger.SysLogf("【孤儿向量清理】立即执行失败: eid=%d, collection=%s, count=%d, err=%v",
					task.eid, task.collection, len(task.vectorIDs), err)
			}
		}()
	}
}

func (m *orphanVectorCleanupManager) flushPending() []orphanVectorCleanupTask {
	if m == nil {
		return nil
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	if len(m.pending) == 0 {
		return nil
	}

	tasks := make([]orphanVectorCleanupTask, 0, len(m.pending))
	for key, batch := range m.pending {
		if batch == nil || len(batch.vectorIDs) == 0 {
			delete(m.pending, key)
			continue
		}
		tasks = append(tasks, orphanVectorCleanupTask{
			eid:        batch.eid,
			collection: batch.collection,
			vectorIDs:  append([]string(nil), batch.vectorIDs...),
		})
		delete(m.pending, key)
	}
	return tasks
}

func (m *orphanVectorCleanupManager) processTask(ctx context.Context, task orphanVectorCleanupTask) error {
	if m == nil || len(task.vectorIDs) == 0 {
		return nil
	}
	if ctx == nil {
		ctx = context.Background()
	}

	store, err := m.vectorStoreGetter()
	if err != nil {
		return fmt.Errorf("获取向量存储失败: %v", err)
	}

	ids := make([]interface{}, 0, len(task.vectorIDs))
	for _, vectorID := range task.vectorIDs {
		vectorID = strings.TrimSpace(vectorID)
		if vectorID == "" {
			continue
		}
		ids = append(ids, vectorID)
	}
	if len(ids) == 0 {
		return nil
	}

	deleteCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	logger.SysLogf("【孤儿向量清理】开始批量删除: eid=%d, collection=%s, count=%d",
		task.eid, task.collection, len(ids))

	if err := store.Delete(deleteCtx, task.collection, ids); err != nil {
		return fmt.Errorf("删除向量失败: %v", err)
	}

	logger.SysLogf("【孤儿向量清理】批量删除完成: eid=%d, collection=%s, count=%d",
		task.eid, task.collection, len(ids))
	return nil
}

func collectOrphanVectorIDs(results []vectorstore.SearchResult, foundIDs map[interface{}]bool) []string {
	if len(results) == 0 {
		return nil
	}

	seen := make(map[string]struct{}, len(results))
	out := make([]string, 0, len(results))
	for _, result := range results {
		if foundIDs != nil && foundIDs[result.ID] {
			continue
		}

		vectorID := strings.TrimSpace(fmt.Sprint(result.ID))
		if vectorID == "" {
			continue
		}
		if _, exists := seen[vectorID]; exists {
			continue
		}
		seen[vectorID] = struct{}{}
		out = append(out, vectorID)
	}
	return out
}

func uniqueOrphanVectorIDs(vectorIDs []string) []string {
	if len(vectorIDs) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(vectorIDs))
	out := make([]string, 0, len(vectorIDs))
	for _, vectorID := range vectorIDs {
		vectorID = strings.TrimSpace(vectorID)
		if vectorID == "" {
			continue
		}
		if _, exists := seen[vectorID]; exists {
			continue
		}
		seen[vectorID] = struct{}{}
		out = append(out, vectorID)
	}
	return out
}

func appendUniqueStrings(dst []string, src []string) []string {
	if len(src) == 0 {
		return dst
	}
	seen := make(map[string]struct{}, len(dst))
	for _, item := range dst {
		seen[item] = struct{}{}
	}
	for _, item := range src {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		if _, exists := seen[item]; exists {
			continue
		}
		seen[item] = struct{}{}
		dst = append(dst, item)
	}
	return dst
}
