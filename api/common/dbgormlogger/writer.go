package dbgormlogger

import (
	"fmt"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/env"
	gormlogger "gorm.io/gorm/logger"
)

// writer implements gormlogger.Writer by forwarding to common/logger.
type writer struct {
	prefix string
}

// Printf implements gormlogger.Writer
func (w *writer) Printf(format string, args ...interface{}) {
	msg := fmt.Sprintf(format, args...)
	if w.prefix != "" {
		msg = w.prefix + msg
	}
	// unify to SysLog; gorm will include level tag in message
	logger.SysLog(msg)
}

// NewWriter creates a gorm-compatible writer with optional prefix.
func NewWriter(prefix string) gormlogger.Writer {
	return &writer{prefix: prefix}
}

// Build constructs a gorm logger with provided options.
func Build(prefix string, level gormlogger.LogLevel, slowThresholdMs int) gormlogger.Interface {
	if slowThresholdMs <= 0 {
		slowThresholdMs = 200
	}
	return gormlogger.New(
		NewWriter(prefix),
		gormlogger.Config{
			SlowThreshold:             time.Duration(slowThresholdMs) * time.Millisecond,
			LogLevel:                  level,
			IgnoreRecordNotFoundError: true,
			Colorful:                  false,
		},
	)
}

// ParseLevel maps string to gorm logger level.
func ParseLevel(levelStr string) gormlogger.LogLevel {
	switch levelStr {
	case "silent":
		return gormlogger.Silent
	case "error":
		return gormlogger.Error
	case "info":
		return gormlogger.Info
	case "debug":
		// be conservative; for detailed SQL use db.Debug()
		return gormlogger.Info
	default:
		return gormlogger.Warn
	}
}

// GetLevelFromEnv reads level via provided getter: func(key, def) string.
func GetLevelFromEnv(get func(string, string) string) gormlogger.LogLevel {
	if get == nil {
		return gormlogger.Warn
	}
	// info 输出很多留着调试
	// var str string
	// if config.DebugSQLEnabled {
	// 	str = "info"
	// } else {
	// 	str = get("GORM_LOG_LEVEL", "warn")
	// }
	str := get("GORM_LOG_LEVEL", "warn")
	return ParseLevel(str)
}

// GetSlowThresholdMsFromEnv reads slow threshold via provided getter: func(key, defInt) int.
func GetSlowThresholdMsFromEnv(getInt func(string, int) int) int {
	if getInt == nil {
		return 200
	}
	return getInt("GORM_SLOW_THRESHOLD_MS", 200)
}

// BuildFromEnv builds gorm logger by reading env through provided getters.
func BuildFromEnv(prefix string) gormlogger.Interface {
	level := GetLevelFromEnv(env.String)
	slowMs := GetSlowThresholdMsFromEnv(env.Int)
	return Build(prefix, level, slowMs)
}
