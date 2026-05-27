package logger

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// RAGJobLogger 专门用于记录RAG任务执行过程的日志记录器
type RAGJobLogger struct {
	fileWriter io.Writer
	mutex      sync.Mutex
}

var (
	ragJobLoggers  = make(map[string]*RAGJobLogger) // 按类型缓存日志记录器
	ragJobLogMutex sync.RWMutex
)

// GetRAGJobLogger 获取或创建指定任务类型的RAG Job日志记录器
// jobType: auto_chunking, reindex, document_conversion, generate_questions_and_summary 等
func GetRAGJobLogger(jobType string) (*RAGJobLogger, error) {
	ragJobLogMutex.RLock()
	if logger, exists := ragJobLoggers[jobType]; exists {
		ragJobLogMutex.RUnlock()
		return logger, nil
	}
	ragJobLogMutex.RUnlock()

	// 创建新的日志记录器
	ragJobLogMutex.Lock()
	defer ragJobLogMutex.Unlock()

	// 再检查一次，防止并发创建
	if logger, exists := ragJobLoggers[jobType]; exists {
		return logger, nil
	}

	logger, err := newRAGJobLogger(jobType)
	if err != nil {
		return nil, err
	}

	ragJobLoggers[jobType] = logger
	return logger, nil
}

// newRAGJobLogger 创建新的RAG Job日志记录器
func newRAGJobLogger(jobType string) (*RAGJobLogger, error) {
	if logDir == "" {
		// 如果日志目录未设置，返回一个写入到os.Stdout的logger
		return &RAGJobLogger{
			fileWriter: os.Stdout,
		}, nil
	}

	// 确保日志目录存在
	if _, err := os.Stat(logDir); os.IsNotExist(err) {
		if err := os.MkdirAll(logDir, 0755); err != nil {
			return nil, fmt.Errorf("failed to create log directory: %w", err)
		}
	}

	// 构建日志文件路径
	var logPath string
	if onlyOneLogFile {
		logPath = filepath.Join(logDir, fmt.Sprintf("Ragjob-%s.log", jobType))
	} else {
		logPath = filepath.Join(logDir, fmt.Sprintf("Ragjob-%s-%s.log", jobType, time.Now().Format("20060102")))
	}

	// 打开日志文件
	fd, err := os.OpenFile(logPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return nil, fmt.Errorf("failed to open RAG job log file: %w", err)
	}

	return &RAGJobLogger{
		fileWriter: fd,
	}, nil
}

// Log 写入日志信息
func (l *RAGJobLogger) Log(level, msg string) {
	if l == nil {
		return
	}

	l.mutex.Lock()
	defer l.mutex.Unlock()

	timestamp := time.Now().Format("2006-01-02 15:04:05.000")
	logEntry := fmt.Sprintf("[%s] [%s] %s\n", timestamp, level, msg)

	_, _ = io.WriteString(l.fileWriter, logEntry)
}

// Info 记录信息级别的日志
func (l *RAGJobLogger) Info(msg string) {
	l.Log("INFO", msg)
}

// Infof 记录信息级别的格式化日志
func (l *RAGJobLogger) Infof(format string, args ...interface{}) {
	l.Info(fmt.Sprintf(format, args...))
}

// Debug 记录调试级别的日志
func (l *RAGJobLogger) Debug(msg string) {
	l.Log("DEBUG", msg)
}

// Debugf 记录调试级别的格式化日志
func (l *RAGJobLogger) Debugf(format string, args ...interface{}) {
	l.Debug(fmt.Sprintf(format, args...))
}

// Warn 记录警告级别的日志
func (l *RAGJobLogger) Warn(msg string) {
	l.Log("WARN", msg)
}

// Warnf 记录警告级别的格式化日志
func (l *RAGJobLogger) Warnf(format string, args ...interface{}) {
	l.Warn(fmt.Sprintf(format, args...))
}

// Error 记录错误级别的日志
func (l *RAGJobLogger) Error(msg string) {
	l.Log("ERROR", msg)
}

// Errorf 记录错误级别的格式化日志
func (l *RAGJobLogger) Errorf(format string, args ...interface{}) {
	l.Error(fmt.Sprintf(format, args...))
}

// JobStart 记录任务开始
func (l *RAGJobLogger) JobStart(jobID int64, eid int64, jobType string, parameters string) {
	l.Infof("========== JOB START ==========")
	l.Infof("JobID: %d", jobID)
	l.Infof("EID: %d", eid)
	l.Infof("Type: %s", jobType)
	l.Infof("StartTime: %s", time.Now().Format("2006-01-02 15:04:05"))
	if parameters != "" && len(parameters) < 500 {
		l.Infof("Parameters: %s", parameters)
	} else if parameters != "" {
		l.Infof("Parameters: %s... (truncated)", parameters[:500])
	}
	l.Infof("========== JOB START END ==========\n")
}

// JobEnd 记录任务结束
func (l *RAGJobLogger) JobEnd(jobID int64, status string, duration time.Duration, failureReason string) {
	l.Infof("========== JOB END ==========")
	l.Infof("JobID: %d", jobID)
	l.Infof("Status: %s", status)
	l.Infof("Duration: %v", duration)
	l.Infof("EndTime: %s", time.Now().Format("2006-01-02 15:04:05"))
	if failureReason != "" {
		l.Infof("FailureReason: %s", failureReason)
	}
	l.Infof("========== JOB END END ==========\n")
}

// StepStart 记录步骤开始
func (l *RAGJobLogger) StepStart(jobID int64, stepOrder int, stepName string, parameters string) {
	l.Infof("---------- STEP START ----------")
	l.Infof("JobID: %d", jobID)
	l.Infof("StepOrder: %d", stepOrder)
	l.Infof("StepName: %s", stepName)
	l.Infof("StartTime: %s", time.Now().Format("2006-01-02 15:04:05"))
	if parameters != "" && len(parameters) < 300 {
		l.Infof("Parameters: %s", parameters)
	} else if parameters != "" {
		l.Infof("Parameters: %s... (truncated)", parameters[:300])
	}
	l.Infof("---------- STEP START END ----------\n")
}

// StepEnd 记录步骤结束
func (l *RAGJobLogger) StepEnd(jobID int64, stepOrder int, stepName string, status string, duration time.Duration, results string) {
	l.Infof("---------- STEP END ----------")
	l.Infof("JobID: %d", jobID)
	l.Infof("StepOrder: %d", stepOrder)
	l.Infof("StepName: %s", stepName)
	l.Infof("Status: %s", status)
	l.Infof("Duration: %v", duration)
	l.Infof("EndTime: %s", time.Now().Format("2006-01-02 15:04:05"))
	if results != "" && len(results) < 300 {
		l.Infof("Results: %s", results)
	} else if results != "" {
		l.Infof("Results: %s... (truncated)", results[:300])
	}
	l.Infof("---------- STEP END END ----------\n")
}

// LogJobEvent 记录任务事件（用于记录任务处理过程中的关键事件）
func (l *RAGJobLogger) LogJobEvent(jobID int64, eventType string, eventMsg string) {
	l.Infof("[Event] JobID: %d | Type: %s | Message: %s", jobID, eventType, eventMsg)
}

// LogError 记录错误信息（包含堆栈跟踪）
func (l *RAGJobLogger) LogError(jobID int64, errMsg string, stack string) {
	l.Errorf("JobID: %d | Error: %s", jobID, errMsg)
	if stack != "" && len(stack) < 2000 {
		l.Errorf("Stack Trace:\n%s", stack)
	} else if stack != "" {
		l.Errorf("Stack Trace: %s... (truncated)", stack[:2000])
	}
}

// logDir 存储日志目录路径
var logDir string

// onlyOneLogFile 存储是否使用统一日志文件
var onlyOneLogFile bool

// InitRAGJobLogConfig 初始化RAG Job日志配置
// 这个函数应该在logger.SetupLogger之后调用
func InitRAGJobLogConfig(dir string, useOneFile bool) {
	logDir = dir
	onlyOneLogFile = useOneFile
}
