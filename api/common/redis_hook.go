package common

import (
	"context"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/helper"
	"github.com/53AI/53AIHub/config"
	"github.com/go-redis/redis/v8"
)

// lazy: 仅DEBUG_REDIS=true记录；mget打出全部key（超500截断），不记value；pipeline合并一行。
// request_id从调用方传入的ctx提取，与SQL日志同前缀归因。

type redisStartKey struct{}

type redisDebugHook struct{}

func (redisDebugHook) BeforeProcess(ctx context.Context, cmd redis.Cmder) (context.Context, error) {
	return context.WithValue(ctx, redisStartKey{}, time.Now()), nil
}

func (redisDebugHook) AfterProcess(ctx context.Context, cmd redis.Cmder) error {
	if !config.DebugRedisEnabled {
		return nil
	}
	start, _ := ctx.Value(redisStartKey{}).(time.Time)
	logRedisCmd(ctx, cmd.Name(), cmd.Args(), cmd.Err(), time.Since(start))
	return nil
}

func (redisDebugHook) BeforeProcessPipeline(ctx context.Context, cmds []redis.Cmder) (context.Context, error) {
	return context.WithValue(ctx, redisStartKey{}, time.Now()), nil
}

func (redisDebugHook) AfterProcessPipeline(ctx context.Context, cmds []redis.Cmder) error {
	if !config.DebugRedisEnabled || len(cmds) == 0 {
		return nil
	}
	start, _ := ctx.Value(redisStartKey{}).(time.Time)
	logRedisCmd(ctx, cmds[0].Name()+" pipeline", nil, nil, time.Since(start))
	return nil
}

func logRedisCmd(ctx context.Context, name string, args []interface{}, cmdErr error, cost time.Duration) {
	detail := ""
	if len(args) > 1 {
		if name == "mget" {
			keys := make([]string, 0, len(args)-1)
			for _, a := range args[1:] {
				if s, ok := a.(string); ok {
					keys = append(keys, s)
				}
			}
			detail = strings.Join(keys, " ")
		} else if s, ok := args[1].(string); ok {
			detail = s
		}
		if len(detail) > 500 {
			detail = detail[:500] + "..."
		}
	}
	if name == "get" {
		if cmdErr == redis.Nil {
			detail += " MISS"
		} else if cmdErr == nil {
			detail += " HIT"
		}
	}
	suffix := ""
	if rid := helper.GetRequestID(ctx); rid != "" {
		suffix = " [request_id=" + rid + "]"
	}
	if cmdErr != nil && cmdErr != redis.Nil {
		logger.Debugf(ctx, "[REDIS] %s %s cost=%s err=%v%s", name, detail, cost, cmdErr, suffix)
		return
	}
	logger.Debugf(ctx, "[REDIS] %s %s cost=%s%s", name, detail, cost, suffix)
}
