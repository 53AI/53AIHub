package model

import (
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"
)

// optimisticLockMaxRetries 乐观锁冲突时的最大重试次数。
// 适用于 AgentUserMemory / AgentToolLesson / UserMemory 这类
// "读取 → 内存中改 Items → 带 version Update" 的并发场景。
const optimisticLockMaxRetries = 3

// optimisticLockBackoff 每次重试的基础等待时间（指数退避）
const optimisticLockBackoff = 5 * time.Millisecond

// ErrMemoryVersionConflict 乐观锁多次重试仍冲突时返回的可识别错误，
// 用于 controller 层映射为 HTTP 409 Conflict（"请重新拉取后重试"）。
var ErrMemoryVersionConflict = errors.New("memory version conflict after retries")

// retryOnOptimisticLockConflict 在乐观锁冲突时重新读取最新版本并再次执行业务函数。
//
// 业务函数 fn 必须自行完成「读取 → 修改 → 带调用方 Version 的 Update」。
// 触发重试的两类错误：
//  1. gorm.ErrRecordNotFound：版本号不匹配（RowsAffected==0）
//  2. 唯一索引冲突：并发首次 Create 时另一个请求已经插入了同一行（MySQL 1062 / PG 23505）
//
// 重试耗尽后返回 ErrMemoryVersionConflict，便于 controller 区分 409 与 500。
func retryOnOptimisticLockConflict(fn func() error) error {
	backoff := optimisticLockBackoff
	for attempt := 0; attempt < optimisticLockMaxRetries; attempt++ {
		err := fn()
		if err == nil {
			return nil
		}
		if !isOptimisticLockRetryable(err) {
			return err
		}
		// 冲突：等待一小段时间后重新读取并重试
		time.Sleep(backoff)
		backoff *= 2
	}
	return ErrMemoryVersionConflict
}

// isOptimisticLockRetryable 判断错误是否属于乐观锁可重试的冲突类型。
func isOptimisticLockRetryable(err error) bool {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return true
	}
	return isDuplicateKeyErr(err)
}

// isDuplicateKeyErr 用错误文本启发式识别 MySQL/Postgres/SQLite 的唯一索引冲突。
// 不直接 import 驱动包，避免污染 model 层的依赖关系。
func isDuplicateKeyErr(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	switch {
	case strings.Contains(msg, "duplicate key"):
		// PostgreSQL: "duplicate key value violates unique constraint"
		return true
	case strings.Contains(msg, "duplicate entry"):
		// MySQL 1062: "Error 1062 (23000): Duplicate entry '1-1-1' for key 'uk_xxx'"
		return true
	case strings.Contains(msg, "unique constraint failed"):
		// SQLite: "UNIQUE constraint failed: agent_user_memories.eid, ..."
		return true
	case strings.Contains(msg, "1062"):
		// MySQL 错误码兜底
		return true
	case strings.Contains(msg, "23505"):
		// PostgreSQL 错误码兜底
		return true
	}
	return false
}
