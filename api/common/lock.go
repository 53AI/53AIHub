package common

import (
	"context"
	"sync"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"github.com/go-redis/redis/v8"
)

var LOCKER Locker

func InitLocker() {
	if RedisEnabled {
		LOCKER = NewRedisLock(RDB)
	} else {
		LOCKER = NewLocalLock()
	}
	model.SetBrowseHistoryLocker(LOCKER)
}

type Locker interface {
	// TryLock 尝试获取锁
	// name: 锁名称
	// ttl: 锁的存活时间
	// 返回是否获取成功
	TryLock(name string, ttl time.Duration) bool

	// Unlock 释放锁
	Unlock(name string)
}

func NewLocalLock() *LocalLock {
	return &LocalLock{}
}

type LocalLock struct {
	locks sync.Map // key: lockName, value: *lockEntry
}

type lockEntry struct {
	mu        sync.Mutex
	expiresAt time.Time
}

// TryLock 尝试获取锁，如果成功返回true，否则返回false
// name: 锁名称
// ttl: 锁的存活时间
func (ll *LocalLock) TryLock(name string, ttl time.Duration) bool {
	now := time.Now()
	entry, loaded := ll.locks.LoadOrStore(name, &lockEntry{
		expiresAt: now.Add(ttl),
	})

	le := entry.(*lockEntry)
	le.mu.Lock()
	logger.SysLogf("lock: %s", name)

	// 检查锁是否已过期
	if now.After(le.expiresAt) {
		le.expiresAt = now.Add(ttl)
		le.mu.Unlock()
		return true
	}

	if loaded {
		le.mu.Unlock()
		return false
	}

	// 新创建的锁，启动定时器自动释放
	time.AfterFunc(ttl, func() {
		le.mu.Lock()
		defer le.mu.Unlock()
		ll.locks.Delete(name)
		logger.SysLogf("lock %s expired, unlock", name)
	})

	le.mu.Unlock()
	return true
}

// Unlock 手动释放锁
func (ll *LocalLock) Unlock(name string) {
	if entry, ok := ll.locks.Load(name); ok {
		le := entry.(*lockEntry)
		le.mu.Lock()
		defer le.mu.Unlock()
		ll.locks.Delete(name)
	}
}

type RedisLock struct {
	client redis.Cmdable
}

func NewRedisLock(client redis.Cmdable) *RedisLock {
	return &RedisLock{client: client}
}

func (rl *RedisLock) TryLock(name string, ttl time.Duration) bool {
	ctx := context.Background()
	// 使用SET NX EX实现原子操作
	result, err := rl.client.SetNX(ctx, "lock:"+name, "1", ttl).Result()
	return err == nil && result
}

func (rl *RedisLock) Unlock(name string) {
	ctx := context.Background()
	rl.client.Del(ctx, "lock:"+name)
}
