package middleware

import (
	"net/http"
	"sync"
	"time"

	"github.com/53AI/53AIHub/common/session"
	"github.com/53AI/53AIHub/model"
	"github.com/gin-gonic/gin"
)

type slidingWindowEntry struct {
	timestamps []int64
}

type slidingWindowRateLimiter struct {
	mu      sync.RWMutex
	windows map[string]*slidingWindowEntry
	limit   int
	window  time.Duration
}

var agentAPIRateLimiter = &slidingWindowRateLimiter{
	windows: make(map[string]*slidingWindowEntry),
	limit:   60,
	window:  time.Minute,
}

func AgentAPIRateLimit() gin.HandlerFunc {
	return func(c *gin.Context) {
		agentID, exists := c.Get(session.SESSION_AGENT_ID)
		if !exists {
			c.Next()
			return
		}

		key := formatRateLimitKey(agentID.(int64), c.ClientIP())
		if !agentAPIRateLimiter.allow(key) {
			c.Header("Retry-After", "60")
			c.JSON(http.StatusTooManyRequests, model.OperateTooFast.ToOpenAIErrorRespone(nil))
			c.Abort()
			return
		}

		c.Next()
	}
}

func (l *slidingWindowRateLimiter) allow(key string) bool {
	now := time.Now().UnixMilli()
	cutoff := now - l.window.Milliseconds()

	l.mu.Lock()
	defer l.mu.Unlock()

	entry, exists := l.windows[key]
	if !exists {
		l.windows[key] = &slidingWindowEntry{
			timestamps: []int64{now},
		}
		return true
	}

	valid := entry.timestamps[:0]
	for _, ts := range entry.timestamps {
		if ts > cutoff {
			valid = append(valid, ts)
		}
	}
	entry.timestamps = valid

	if len(entry.timestamps) >= l.limit {
		return false
	}

	entry.timestamps = append(entry.timestamps, now)
	return true
}

func formatRateLimitKey(agentID int64, ip string) string {
	return "agent_api:" + ip
}

func init() {
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			agentAPIRateLimiter.mu.Lock()
			cutoff := time.Now().Add(-10 * time.Minute).UnixMilli()
			for key, entry := range agentAPIRateLimiter.windows {
				if len(entry.timestamps) == 0 || entry.timestamps[len(entry.timestamps)-1] < cutoff {
					delete(agentAPIRateLimiter.windows, key)
				}
			}
			agentAPIRateLimiter.mu.Unlock()
		}
	}()
}
