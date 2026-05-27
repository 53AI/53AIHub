package rag

import (
	"fmt"
	"time"

	"github.com/53AI/53AIHub/common"
)

// tryLockDocument 尝试锁定文档
func tryLock(name string, ttl time.Duration) bool {
	return common.LOCKER.TryLock(name, ttl)
}

func unlock(name string) {
	common.LOCKER.Unlock(name)
}

func isLocked(name string, ttl time.Duration) bool {
	if !tryLock(name, ttl) {
		return true
	}
	unlock(name)
	return false
}

func makeLockName(resource string, eid int64, id int64) string {
	return fmt.Sprintf("%s_%d_%d", resource, eid, id)
}

const (
	// 统一锁定时长常量
	lockTTLShort = 1 * time.Second
	lockTTLLong  = 5 * time.Minute
)

func (s *ChunkerService) IsDocumentLocked(eid int64, fileID int64) bool {
	lockName := makeLockName(lockResDocument, eid, fileID)
	// 尝试获取锁，如果获取失败说明文档被锁定
	if !isLocked(lockName, lockTTLShort) {
		// isLocked 内部会立即释放锁
		return false
	}
	return true
}

// IsChunkLocked 检查分块是否被锁定
func (s *ChunkerService) IsChunkLocked(eid int64, chunkID int64) bool {
	lockName := makeLockName(lockResChunk, eid, chunkID)
	// 尝试获取锁，如果获取失败说明分块被锁定
	if !isLocked(lockName, lockTTLShort) {
		// isLocked 内部会立即释放锁
		return false
	}
	return true
}

// TryLockChunk 尝试锁定分块
func (s *ChunkerService) TryLockChunk(eid int64, chunkID int64, userID int64) bool {
	lockName := makeLockName(lockResChunk, eid, chunkID)
	// 锁定5分钟
	return tryLock(lockName, lockTTLLong)
}

// UnlockChunk 解锁分块
func (s *ChunkerService) UnlockChunk(eid int64, chunkID int64) {
	lockName := makeLockName(lockResChunk, eid, chunkID)
	unlock(lockName)
}

// IsRetrievalChunkLocked 检查检索块是否被锁定
func (s *ChunkerService) IsRetrievalChunkLocked(eid int64, chunkID int64) bool {
	lockName := makeLockName(lockResRetrieval, eid, chunkID)
	// 尝试获取锁，如果获取失败说明检索块被锁定
	if !isLocked(lockName, lockTTLShort) {
		// isLocked 内部会立即释放锁
		return false
	}
	return true
}

// TryLockRetrievalChunk 尝试锁定检索块
func (s *ChunkerService) TryLockRetrievalChunk(eid int64, chunkID int64, userID int64) bool {
	lockName := makeLockName(lockResRetrieval, eid, chunkID)
	// 锁定5分钟
	return tryLock(lockName, lockTTLLong)
}

// UnlockRetrievalChunk 解锁检索块
func (s *ChunkerService) UnlockRetrievalChunk(eid int64, chunkID int64) {
	lockName := makeLockName(lockResRetrieval, eid, chunkID)
	unlock(lockName)
}

func (s *ChunkerService) tryLockDocument(lockName string) bool {
	// 使用项目中的锁定机制，锁定5分钟
	return tryLock(lockName, lockTTLLong)
}

// unlockDocument 解锁文档
func (s *ChunkerService) unlockDocument(lockName string) {
	unlock(lockName)
}

// IsDocumentLocked 检查文档是否被锁定
const (
	lockResDocument  = "document_edit"
	lockResChunk     = "chunk_edit"
	lockResRetrieval = "retrieval_chunk_edit"
)
