package common

import (
	"context"
	"runtime/debug"

	"github.com/53AI/53AIHub/common/logger"
)

// SafeGo 启动一个带有 panic 恢复机制的 goroutine
// 防止 goroutine 内的 panic 导致整个进程崩溃
func SafeGo(ctx context.Context, fn func()) {
	go func() {
		defer func() {
			if r := recover(); r != nil {
				stack := string(debug.Stack())
				logger.Crashf(ctx, "goroutine panic recovered: %v\nstack:\n%s", r, stack)
			}
		}()
		fn()
	}()
}

// SafeGoWithRecovery 启动一个带有自定义 panic 恢复处理的 goroutine
// 允许调用者自定义 panic 发生后的处理逻辑
func SafeGoWithRecovery(ctx context.Context, fn func(), onPanic func(interface{})) {
	go func() {
		defer func() {
			if r := recover(); r != nil {
				stack := string(debug.Stack())
				logger.Crashf(ctx, "goroutine panic recovered: %v\nstack:\n%s", r, stack)
				if onPanic != nil {
					// 保护 onPanic 回调，防止其内部 panic 导致进程崩溃
					func() {
						defer func() {
							if r2 := recover(); r2 != nil {
								logger.Crashf(ctx, "onPanic callback panic: %v", r2)
							}
						}()
						onPanic(r)
					}()
				}
			}
		}()
		fn()
	}()
}

// SafeGoSimple 启动一个简单的带 panic 恢复的 goroutine（无 context）
// 用于不需要 context 的简单场景
func SafeGoSimple(fn func()) {
	go func() {
		defer func() {
			if r := recover(); r != nil {
				stack := string(debug.Stack())
				logger.SysErrorf("goroutine panic recovered: %v\nstack:\n%s", r, stack)
			}
		}()
		fn()
	}()
}
