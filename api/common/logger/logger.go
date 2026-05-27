package logger

import (
	"context"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/53AI/53AIHub/common/utils/helper"
	"github.com/53AI/53AIHub/config"
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

type loggerLevel string

const (
	loggerDEBUG loggerLevel = "DEBUG"
	loggerINFO  loggerLevel = "INFO"
	loggerWARN  loggerLevel = "WARN"
	loggerERROR loggerLevel = "ERROR"
	loggerCRASH loggerLevel = "CRASH"
	loggerFATAL loggerLevel = "FATAL"
	loggerNONE  loggerLevel = "NONE"
)

var (
	setupLogOnce sync.Once
	// Current log level, initialized from environment variable
	currentLogLevel loggerLevel = loggerINFO

	errorFileWriter io.Writer
	crashFileWriter io.Writer

	loggerMu  sync.RWMutex
	zapLogger *zap.Logger
)

// Initialize the logger system with environment variables
func init() {
	currentLogLevel = parseLevel(os.Getenv("LOG_LEVEL"))
}

func parseLevel(level string) loggerLevel {
	switch strings.ToUpper(strings.TrimSpace(level)) {
	case string(loggerDEBUG):
		return loggerDEBUG
	case string(loggerINFO):
		return loggerINFO
	case string(loggerWARN):
		return loggerWARN
	case string(loggerERROR):
		return loggerERROR
	case string(loggerFATAL):
		return loggerFATAL
	case string(loggerNONE):
		return loggerNONE
	default:
		return loggerINFO
	}
}

// SetLogLevel allows programmatically setting the log level
func SetLogLevel(level string) {
	currentLogLevel = parseLevel(level)
}

// GetLogLevel returns the current log level
func GetLogLevel() string {
	return string(currentLogLevel)
}

// shouldLog determines if a log message should be output based on its level
func shouldLog(level loggerLevel) bool {
	if currentLogLevel == loggerNONE {
		return false
	}

	switch currentLogLevel {
	case loggerDEBUG:
		return true
	case loggerINFO:
		return level != loggerDEBUG
	case loggerWARN:
		return level != loggerDEBUG && level != loggerINFO
	case loggerERROR:
		return level == loggerERROR || level == loggerCRASH || level == loggerFATAL
	case loggerFATAL:
		return level == loggerFATAL
	default:
		return true
	}
}

func SetupLogger() {
	setupLogOnce.Do(func() {
		mainWriter := io.Writer(os.Stdout)
		errorWriter := io.Writer(os.Stderr)

		if config.LogDir != "" {
			if _, err := os.Stat(config.LogDir); os.IsNotExist(err) {
				if mkErr := os.MkdirAll(config.LogDir, 0755); mkErr != nil {
					log.Printf("failed to create log directory %s: %v", config.LogDir, mkErr)
				} else {
					mainWriter, errorWriter = initFileWriters(config.LogDir)
				}
			} else {
				mainWriter, errorWriter = initFileWriters(config.LogDir)
			}
		}

		gin.DefaultWriter = mainWriter
		gin.DefaultErrorWriter = errorWriter
		log.SetOutput(gin.DefaultErrorWriter)
		InitRAGJobLogConfig(config.LogDir, config.OnlyOneLogFile)

		setZapLogger(buildZapLogger(mainWriter))
	})
}

func initFileWriters(logDir string) (io.Writer, io.Writer) {
	mainWriter := io.Writer(os.Stdout)
	errorWriter := io.Writer(os.Stderr)

	var logPath, errorLogPath, crashLogPath string
	if config.OnlyOneLogFile {
		logPath = filepath.Join(logDir, "53AIHub.log")
		errorLogPath = filepath.Join(logDir, "53AIHub-error.log")
		crashLogPath = filepath.Join(logDir, "53AIHub-crash.log")
	} else {
		now := time.Now().Format("20060102")
		logPath = filepath.Join(logDir, fmt.Sprintf("53AIHub-%s.log", now))
		errorLogPath = filepath.Join(logDir, fmt.Sprintf("53AIHub-error-%s.log", now))
		crashLogPath = filepath.Join(logDir, fmt.Sprintf("53AIHub-crash-%s.log", now))
	}

	fd, err := os.OpenFile(logPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		log.Printf("failed to open log file %s: %v", logPath, err)
	} else {
		mainWriter = io.MultiWriter(os.Stdout, fd)
		errorWriter = io.MultiWriter(os.Stderr, fd)
	}

	errorFd, err := os.OpenFile(errorLogPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		log.Printf("failed to open error log file %s: %v", errorLogPath, err)
	} else {
		errorFileWriter = errorFd
	}

	crashFd, err := os.OpenFile(crashLogPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		log.Printf("failed to open crash log file %s: %v", crashLogPath, err)
	} else {
		crashFileWriter = crashFd
	}

	return mainWriter, errorWriter
}

func buildZapLogger(mainWriter io.Writer) *zap.Logger {
	encoderConfig := zapcore.EncoderConfig{
		TimeKey:        "ts",
		LevelKey:       "level",
		NameKey:        "logger",
		CallerKey:      "caller",
		FunctionKey:    "",
		MessageKey:     "msg",
		StacktraceKey:  "stacktrace",
		LineEnding:     zapcore.DefaultLineEnding,
		EncodeLevel:    zapcore.LowercaseLevelEncoder,
		EncodeTime:     zapcore.ISO8601TimeEncoder,
		EncodeDuration: zapcore.StringDurationEncoder,
		EncodeCaller:   zapcore.ShortCallerEncoder,
	}

	encoder := zapcore.NewJSONEncoder(encoderConfig)
	cores := []zapcore.Core{
		zapcore.NewCore(encoder, zapcore.AddSync(mainWriter), zapcore.DebugLevel),
	}

	if errorFileWriter != nil {
		cores = append(cores, zapcore.NewCore(
			encoder,
			zapcore.AddSync(errorFileWriter),
			zap.LevelEnablerFunc(func(level zapcore.Level) bool {
				return level >= zapcore.ErrorLevel
			}),
		))
	}

	if crashFileWriter != nil {
		cores = append(cores, zapcore.NewCore(
			encoder,
			zapcore.AddSync(crashFileWriter),
			zap.LevelEnablerFunc(func(level zapcore.Level) bool {
				return level >= zapcore.DPanicLevel
			}),
		))
	}

	return zap.New(zapcore.NewTee(cores...), zap.AddCaller(), zap.AddCallerSkip(2))
}

func setZapLogger(l *zap.Logger) {
	loggerMu.Lock()
	defer loggerMu.Unlock()
	zapLogger = l
}

func getZapLogger() *zap.Logger {
	loggerMu.RLock()
	defer loggerMu.RUnlock()
	return zapLogger
}

func SysLog(s string) {
	logHelper(nil, loggerINFO, s)
}

func SysLogf(format string, a ...any) {
	logHelper(nil, loggerINFO, fmt.Sprintf(format, a...))
}

func SysWarn(s string) {
	logHelper(nil, loggerWARN, s)
}

func SysWarnf(format string, a ...any) {
	logHelper(nil, loggerWARN, fmt.Sprintf(format, a...))
}

func SysError(s string) {
	logHelper(nil, loggerERROR, s)
}

func SysErrorf(format string, a ...any) {
	logHelper(nil, loggerERROR, fmt.Sprintf(format, a...))
}

func SysCrash(s string) {
	logHelper(nil, loggerCRASH, s)
}

func SysCrashf(format string, a ...any) {
	logHelper(nil, loggerCRASH, fmt.Sprintf(format, a...))
}
func SysDebug(s string) {
	logHelper(nil, loggerDEBUG, s)
}

func SysDebugf(format string, a ...any) {
	logHelper(nil, loggerDEBUG, fmt.Sprintf(format, a...))
}
func Debug(ctx context.Context, msg string) {
	logHelper(ctx, loggerDEBUG, msg)
}

func Info(ctx context.Context, msg string) {
	logHelper(ctx, loggerINFO, msg)
}

func Warn(ctx context.Context, msg string) {
	logHelper(ctx, loggerWARN, msg)
}

func Error(ctx context.Context, msg string) {
	logHelper(ctx, loggerERROR, msg)
}

func Debugf(ctx context.Context, format string, a ...any) {
	logHelper(ctx, loggerDEBUG, fmt.Sprintf(format, a...))
}

func Infof(ctx context.Context, format string, a ...any) {
	logHelper(ctx, loggerINFO, fmt.Sprintf(format, a...))
}

func Warnf(ctx context.Context, format string, a ...any) {
	logHelper(ctx, loggerWARN, fmt.Sprintf(format, a...))
}

func Errorf(ctx context.Context, format string, a ...any) {
	logHelper(ctx, loggerERROR, fmt.Sprintf(format, a...))
}

func Crash(ctx context.Context, msg string) {
	logHelper(ctx, loggerCRASH, msg)
}

func Crashf(ctx context.Context, format string, a ...any) {
	logHelper(ctx, loggerCRASH, fmt.Sprintf(format, a...))
}

func FatalLog(s string) {
	logHelper(nil, loggerFATAL, s)
}

func FatalLogf(format string, a ...any) {
	logHelper(nil, loggerFATAL, fmt.Sprintf(format, a...))
}

func logHelper(ctx context.Context, level loggerLevel, msg string) {
	if !shouldLog(level) {
		return
	}

	SetupLogger()
	l := getZapLogger()
	if l == nil {
		_, _ = fmt.Fprintf(gin.DefaultErrorWriter, "[%s] %s\n", level, msg)
		if level == loggerFATAL {
			os.Exit(1)
		}
		return
	}

	fileLine, funcName := getLineInfo()
	fields := []zap.Field{
		zap.String("source", fileLine),
		zap.String("func", funcName),
	}

	if ctx != nil {
		if requestID := helper.GetRequestID(ctx); requestID != "" {
			fields = append(fields, zap.String("request_id", requestID))
		}
	}

	switch level {
	case loggerDEBUG:
		l.Debug(msg, fields...)
	case loggerINFO:
		l.Info(msg, fields...)
	case loggerWARN:
		l.Warn(msg, fields...)
	case loggerERROR:
		l.Error(msg, fields...)
	case loggerCRASH:
		l.DPanic(msg, fields...)
	case loggerFATAL:
		l.DPanic(msg, append(fields, zap.String("event", "fatal"))...)
		os.Exit(1)
	default:
		l.Info(msg, fields...)
	}
}

func getLineInfo() (string, string) {
	pc, file, line, ok := runtime.Caller(3)
	if !ok {
		return "unknown:0", "unknown"
	}

	funcName := "unknown"
	if fn := runtime.FuncForPC(pc); fn != nil {
		parts := strings.Split(fn.Name(), ".")
		funcName = parts[len(parts)-1]
	}

	return fmt.Sprintf("%s:%d", file, line), funcName
}
