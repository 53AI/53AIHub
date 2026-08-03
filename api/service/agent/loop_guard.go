package agent

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

const (
	StopRepeatedToolCall    = "repeated_tool_call"
	StopConsecutiveFailures = "consecutive_tool_failures"
	StopNoProgress          = "no_progress"
	StopWallClock           = "wall_clock_budget"
)

type LoopStop struct {
	Code    string
	Message string
}

type LoopGuardConfig struct {
	StartedAt                  time.Time
	MaxDuration                time.Duration
	MaxRepeatedToolCalls       int
	MaxConsecutiveToolFailures int
}

type LoopGuard struct {
	config LoopGuardConfig
	now    func() time.Time

	lastToolCallSignature string
	repeatedToolCalls     int
	consecutiveFailures   int
}

func EffectiveMaxTurns(configured, hardLimit int) int {
	if configured < 1 {
		configured = 1
	}
	if hardLimit > 0 && configured > hardLimit {
		return hardLimit
	}
	return configured
}

func NewLoopGuard(config LoopGuardConfig, now func() time.Time) *LoopGuard {
	if now == nil {
		now = time.Now
	}
	if config.StartedAt.IsZero() {
		config.StartedAt = now()
	}
	return &LoopGuard{config: config, now: now}
}

func (g *LoopGuard) CheckWallClock() *LoopStop {
	if g == nil || g.config.MaxDuration <= 0 || g.now().Sub(g.config.StartedAt) < g.config.MaxDuration {
		return nil
	}
	return &LoopStop{Code: StopWallClock, Message: "Agent 执行已达到最长运行时间，已停止继续调用工具并保留当前结果。"}
}

func (g *LoopGuard) ObserveToolCall(functionName, args string) *LoopStop {
	if g == nil || g.config.MaxRepeatedToolCalls <= 0 {
		return nil
	}
	signature := ToolCallSignature(functionName, args)
	if signature == g.lastToolCallSignature {
		g.repeatedToolCalls++
	} else {
		g.lastToolCallSignature = signature
		g.repeatedToolCalls = 1
	}
	if g.repeatedToolCalls < g.config.MaxRepeatedToolCalls {
		return nil
	}
	return &LoopStop{Code: StopRepeatedToolCall, Message: fmt.Sprintf("检测到工具 %s 连续使用相同参数调用 %d 次，已硬停止以避免重复执行。", strings.TrimSpace(functionName), g.repeatedToolCalls)}
}

func (g *LoopGuard) ObserveToolResult(success bool) *LoopStop {
	if g == nil || g.config.MaxConsecutiveToolFailures <= 0 {
		return nil
	}
	if success {
		g.consecutiveFailures = 0
		return nil
	}
	g.consecutiveFailures++
	if g.consecutiveFailures < g.config.MaxConsecutiveToolFailures {
		return nil
	}
	return &LoopStop{Code: StopConsecutiveFailures, Message: fmt.Sprintf("工具已连续失败 %d 次，已硬停止以避免继续消耗资源。", g.consecutiveFailures)}
}

func ToolCallSignature(functionName, args string) string {
	normalizedArgs := strings.TrimSpace(args)
	if normalizedArgs != "" {
		var parsed interface{}
		if json.Unmarshal([]byte(normalizedArgs), &parsed) == nil {
			if encoded, err := json.Marshal(parsed); err == nil {
				normalizedArgs = string(encoded)
			}
		}
	}
	sum := sha256.Sum256([]byte(strings.TrimSpace(functionName) + "|" + normalizedArgs))
	return fmt.Sprintf("%x", sum[:8])
}
