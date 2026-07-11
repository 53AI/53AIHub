package logger

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
	"time"
)

var (
	slowLogWriter   io.Writer
	slowLogInitOnce sync.Once
)

// InitSlowLogger 初始化 slow.log 文件写入器。
// 在 SetupLogger 之后调用，使用同样的 LogDir。
func InitSlowLogger(logDir string) {
	slowLogInitOnce.Do(func() {
		if logDir == "" {
			slowLogWriter = os.Stdout
			return
		}
		path := filepath.Join(logDir, "slow.log")
		fd, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
		if err != nil {
			SysWarnf("无法创建 slow.log: %v，回退到 stdout", err)
			slowLogWriter = os.Stdout
			return
		}
		slowLogWriter = fd
	})
}

// SlowLog 写入慢日志到独立的 slow.log 文件。
// 格式兼容日志查看器的 ragLinePattern：[2006-01-02 15:04:05.000] [WARN] 慢接口:/慢查询: ...
func SlowLog(format string, args ...interface{}) {
	if slowLogWriter == nil {
		return
	}
	ts := time.Now().Format("2006-01-02 15:04:05.000")
	msg := fmt.Sprintf(format, args...)
	_, _ = fmt.Fprintf(slowLogWriter, "[%s] [WARN] %s\n", ts, msg)
}
