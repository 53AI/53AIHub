package middleware

import (
	"strconv"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/dbgormlogger"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/gin-gonic/gin"
)

// SlowAPILogger 记录耗时超过阈值的 HTTP 请求到独立的 slow.log 和异步入库。
func SlowAPILogger() gin.HandlerFunc {
	threshold := time.Duration(config.SLOW_API_THRESHOLD_MS) * time.Millisecond
	if threshold <= 0 {
		threshold = 1 * time.Second
	}
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		duration := time.Since(start)
		if duration >= threshold && !strings.Contains(c.Writer.Header().Get("Content-Type"), "text/event-stream") {
			costMs := duration.Milliseconds()
			path := c.Request.URL.Path
			method := c.Request.Method
			logger.SlowLog("慢接口: method=%s path=%s status=%d cost=%s",
				method, path, c.Writer.Status(), duration)

			// 异步入库（feature 去重键：METHOD PATH）
			feature := strings.ToUpper(method) + " " + path
			sampleData := method + " " + path + " status=" + strconv.Itoa(c.Writer.Status())
			model.PushSlowLogEntry(dbgormlogger.SlowLogEntry{
				Type:       "api",
				Feature:    feature,
				SampleData: sampleData,
				CostMs:     costMs,
			})
		}
	}
}
