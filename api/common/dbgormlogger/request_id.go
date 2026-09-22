package dbgormlogger

import (
	"context"
	"time"

	"github.com/53AI/53AIHub/common/utils/helper"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

// requestIDLogger 包装 gorm logger，在 SQL 文本前追加 request_id 前缀。
// 不复刻阈值/级别/脱敏逻辑：fc 包装后仍委托 inner.Trace，保持行为一致。
// SQL 日志经 writer 转发时无 ctx，只能在此 Trace 层从 ctx 提取 request_id。
type requestIDLogger struct {
	inner gormlogger.Interface
}

func withRequestID(inner gormlogger.Interface) gormlogger.Interface {
	if inner == nil {
		return inner
	}
	return &requestIDLogger{inner: inner}
}

func (l *requestIDLogger) LogMode(level gormlogger.LogLevel) gormlogger.Interface {
	return &requestIDLogger{inner: l.inner.LogMode(level)}
}

func (l *requestIDLogger) Info(ctx context.Context, msg string, data ...interface{}) {
	l.inner.Info(ctx, msg, data...)
}

func (l *requestIDLogger) Warn(ctx context.Context, msg string, data ...interface{}) {
	l.inner.Warn(ctx, msg, data...)
}

func (l *requestIDLogger) Error(ctx context.Context, msg string, data ...interface{}) {
	l.inner.Error(ctx, msg, data...)
}

func (l *requestIDLogger) Trace(ctx context.Context, begin time.Time, fc func() (string, int64), err error) {
	if fc == nil {
		l.inner.Trace(ctx, begin, fc, err)
		return
	}
	requestID := helper.GetRequestID(ctx)
	// 调用点只取一次：Trace 外算好，wrapped 闭包内复用（fc 可能被 inner 调用多次）。
	caller := getCallerInfo()
	if requestID == "" && caller == "" {
		l.inner.Trace(ctx, begin, fc, err)
		return
	}
	wrapped := func() (string, int64) {
		sql, rows := fc()
		if sql == "" {
			return sql, rows
		}
		if requestID != "" {
			sql = "[request_id=" + requestID + "] " + sql
		}
		if caller != "" {
			sql += " [" + caller + "]"
		}
		return sql, rows
	}
	l.inner.Trace(ctx, begin, wrapped, err)
}

// ParamsFilter 委托 inner，保持 DEBUG_SQL 展开行为不变。
func (l *requestIDLogger) ParamsFilter(ctx context.Context, sql string, params ...interface{}) (string, []interface{}) {
	if filter, ok := l.inner.(gorm.ParamsFilter); ok {
		return filter.ParamsFilter(ctx, sql, params...)
	}
	return sql, params
}
