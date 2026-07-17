package dbgormlogger

import (
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/config"
	"gorm.io/gorm"
)

const slowQueryStartKey = "slow_query_start_time"

// SlowLogEntry 慢日志入队列条目
type SlowLogEntry struct {
	Type       string // "api" 或 "sql"
	Feature    string // 去重特征键
	SampleData string // 采样数据
	CostMs     int64  // 耗时（毫秒）
	FileLine   string // 仅 SQL 类型使用
}

// slowLogHandler 由 model 层注册的慢日志持久化回调
var slowLogHandler func(entry SlowLogEntry)

// RegisterSlowLogHandler 注册慢日志持久化回调（由 model 层在初始化时调用）
func RegisterSlowLogHandler(fn func(entry SlowLogEntry)) {
	slowLogHandler = fn
}

// pushSlowLog 推送到持久化回调（非阻塞，handler 为空则忽略）
func pushSlowLog(entry SlowLogEntry) {
	if slowLogHandler != nil {
		slowLogHandler(entry)
	}
}

// RegisterSlowQueryCallback 注册 GORM 慢查询回调。
// 当单条 SQL 执行耗时超过阈值时，记录到 slow.log 和异步入库。
func RegisterSlowQueryCallback(db *gorm.DB) {
	threshold := time.Duration(config.SLOW_SQL_THRESHOLD_MS) * time.Millisecond
	if threshold <= 0 {
		threshold = 200 * time.Millisecond
	}

	// BeforeQuery：记录查询开始时间
	_ = db.Callback().Query().Before("gorm:query").Register("slow_query_logger:before", func(tx *gorm.DB) {
		if tx.Statement != nil {
			tx.Statement.Settings.Store(slowQueryStartKey, time.Now())
		}
	})

	// AfterQuery：计算耗时，超过阈值则记录慢查询日志
	_ = db.Callback().Query().After("gorm:query").Register("slow_query_logger:after", func(tx *gorm.DB) {
		if tx.Statement == nil || tx.Statement.Error != nil {
			return
		}
		startVal, ok := tx.Statement.Settings.Load(slowQueryStartKey)
		if !ok {
			return
		}
		startTime, ok := startVal.(time.Time)
		if !ok {
			return
		}
		elapsed := time.Since(startTime)
		if elapsed >= threshold {
			costMs := elapsed.Milliseconds()
			fullSQL := tx.Explain(tx.Statement.SQL.String(), tx.Statement.Vars...)
			logger.SlowLog("慢查询: cost=%s table=%s sql=%s",
				elapsed, tx.Statement.Table, fullSQL)

			// 异步入库 - 以 SQL 指纹 + 调用位置作为 feature 实现去重
			fingerprint := normalizeSQL(tx.Statement.SQL.String())
			fileLine := getCallerInfo()
			pushSlowLog(SlowLogEntry{
				Type:       "sql",
				Feature:    fingerprint + " | " + fileLine,
				SampleData: fullSQL,
				CostMs:     costMs,
				FileLine:   fileLine,
			})
		}
	})
}

// normalizeSQL 简单归一化 SQL（去除字符串字面量和数字字面量，保留结构）
func normalizeSQL(sql string) string {
	var b strings.Builder
	b.Grow(len(sql))
	inStr := false
	for i := 0; i < len(sql); i++ {
		c := sql[i]
		if c == '\'' {
			inStr = !inStr
			b.WriteByte('?')
			continue
		}
		if inStr {
			continue
		}
		if c >= '0' && c <= '9' {
			// 跳过连续数字
			for i < len(sql) && sql[i] >= '0' && sql[i] <= '9' {
				i++
			}
			b.WriteByte('?')
			i--
			continue
		}
		b.WriteByte(c)
	}
	return b.String()
}

// getCallerInfo 获取调用栈中第一个非 dbgormlogger/gorm 包的调用位置
func getCallerInfo() string {
	for i := 3; i < 15; i++ {
		_, file, line, ok := runtime.Caller(i)
		if !ok {
			break
		}
		if strings.Contains(file, "gorm.io") || strings.Contains(file, "dbgormlogger") {
			continue
		}
		short := file
		if idx := strings.LastIndex(file, "/"); idx >= 0 {
			short = file[idx+1:]
		}
		return short + ":" + strconv.Itoa(line)
	}
	return ""
}
