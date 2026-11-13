package service

import (
	"context"
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/53AI/53AIHub/common/logger"
)

// IdleMemoryTrigger 空闲记忆压缩触发器
// Debounce 模式：每次 Reset 重置定时器，并保留本批次最早的未处理 messageID。
// 定时器到期后压缩 >= messageID 的新消息，精确控制压缩范围。
// 支持断路器：连续失败时下次空闲间隔翻倍（上限 2h），成功后重置。
type IdleMemoryTrigger struct {
	mu         sync.Mutex
	timers     map[string]*time.Timer
	pending    map[string]int64
	generation map[string]uint64
	nextID     uint64
	failures   map[string]int
	interval   time.Duration
	maxBackoff time.Duration

	onTrigger func(eid, agentID, userID, messageID int64)
}

// NewIdleMemoryTrigger 创建空闲触发器
func NewIdleMemoryTrigger(interval time.Duration) *IdleMemoryTrigger {
	if interval <= 0 {
		interval = 5 * time.Minute
	}
	return &IdleMemoryTrigger{
		timers:     make(map[string]*time.Timer),
		pending:    make(map[string]int64),
		generation: make(map[string]uint64),
		failures:   make(map[string]int),
		interval:   interval,
		maxBackoff: 2 * time.Hour,
		onTrigger:  defaultTriggerFn,
	}
}

// SetTrigger 设置触发回调（用于测试替换）
func (t *IdleMemoryTrigger) SetTrigger(fn func(eid, agentID, userID, messageID int64)) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.onTrigger = fn
}

// effectiveInterval 计算有效间隔：基础间隔 x 2^连续失败次数，上限 maxBackoff
func (t *IdleMemoryTrigger) effectiveInterval(key string) time.Duration {
	failCount := t.failures[key]
	if failCount <= 0 {
		return t.interval
	}
	multiplier := time.Duration(1 << uint(failCount))
	d := t.interval * multiplier
	if d > t.maxBackoff {
		d = t.maxBackoff
	}
	return d
}

// Reset 重置空闲计时，但保留尚未压缩的第一条消息 ID（0 表示按时间窗口扫描）。
func (t *IdleMemoryTrigger) Reset(eid, agentID, userID, messageID int64) {
	key := t.key(eid, agentID, userID)
	t.mu.Lock()
	defer t.mu.Unlock()

	if existing, ok := t.timers[key]; ok {
		existing.Stop()
	}
	if firstID, ok := t.pending[key]; ok && (firstID == 0 || messageID > firstID) {
		messageID = firstID
	}
	t.pending[key] = messageID
	t.nextID++
	generation := t.nextID
	t.generation[key] = generation

	d := t.effectiveInterval(key)
	t.timers[key] = time.AfterFunc(d, func() {
		t.fire(eid, agentID, userID, messageID, generation)
	})
}

// Stop 停止指定 key 的定时器
func (t *IdleMemoryTrigger) Stop(eid, agentID, userID int64) {
	key := t.key(eid, agentID, userID)
	t.mu.Lock()
	defer t.mu.Unlock()

	if existing, ok := t.timers[key]; ok {
		existing.Stop()
		delete(t.timers, key)
	}
	delete(t.pending, key)
	delete(t.generation, key)
}

// RecordSuccess 记录压缩成功，重置失败计数
func (t *IdleMemoryTrigger) RecordSuccess(eid, agentID, userID int64) {
	key := t.key(eid, agentID, userID)
	t.mu.Lock()
	defer t.mu.Unlock()
	delete(t.failures, key)
}

// RecordFailure 记录压缩失败，递增失败计数
func (t *IdleMemoryTrigger) RecordFailure(eid, agentID, userID int64) {
	key := t.key(eid, agentID, userID)
	t.mu.Lock()
	defer t.mu.Unlock()
	t.failures[key]++
}

func (t *IdleMemoryTrigger) key(eid, agentID, userID int64) string {
	return fmt.Sprintf("%d:%d:%d", eid, agentID, userID)
}

func (t *IdleMemoryTrigger) fire(eid, agentID, userID, messageID int64, generation uint64) {
	key := t.key(eid, agentID, userID)

	t.mu.Lock()
	if t.generation[key] != generation {
		t.mu.Unlock()
		return // 已被更晚一次 Reset 或 Stop 取代的定时器
	}
	delete(t.generation, key)
	delete(t.timers, key)
	delete(t.pending, key)
	fn := t.onTrigger
	t.mu.Unlock()

	if fn == nil {
		return
	}
	fn(eid, agentID, userID, messageID)
}

// defaultTriggerFn 默认触发回调：调用 CompressAgentMemory，并向断路器报告结果
func defaultTriggerFn(eid, agentID, userID, sinceMessageID int64) {
	ctx := context.Background()
	logger.Infof(ctx, "【空闲记忆压缩】触发: eid=%d, agent_id=%d, user_id=%d, since_message_id=%d",
		eid, agentID, userID, sinceMessageID)

	trigger := DefaultIdleTrigger
	compressSvc := NewAgentMemoryCompressService()
	if err := compressSvc.CompressAgentMemory(ctx, eid, agentID, userID, sinceMessageID); err != nil {
		logger.Errorf(ctx, "【空闲记忆压缩】压缩失败: eid=%d, agent_id=%d, user_id=%d, err=%v",
			eid, agentID, userID, err)
		if trigger != nil {
			trigger.RecordFailure(eid, agentID, userID)
		}
	} else {
		if trigger != nil {
			trigger.RecordSuccess(eid, agentID, userID)
		}
	}
}

// DefaultIdleTrigger 全局默认空闲触发器实例
var DefaultIdleTrigger *IdleMemoryTrigger

func init() {
	interval := 5 * time.Minute
	if env := os.Getenv("MEMORY_COMPRESS_IDLE_INTERVAL"); env != "" {
		if d, err := time.ParseDuration(env); err == nil && d > 0 {
			interval = d
		}
	}
	DefaultIdleTrigger = NewIdleMemoryTrigger(interval)
}
