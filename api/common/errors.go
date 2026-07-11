package common

import (
	"context"
	"errors"
	"net"
	"strings"
)

// 常用错误定义
var (
	// ErrServiceNotInitialized 服务未初始化错误
	ErrServiceNotInitialized = errors.New("service not initialized")

	// ErrInvalidParameter 无效参数错误
	ErrInvalidParameter = errors.New("invalid parameter")

	// ErrResourceNotFound 资源未找到错误
	ErrResourceNotFound = errors.New("resource not found")

	// ErrPermissionDenied 权限不足错误
	ErrPermissionDenied = errors.New("permission denied")

	// ErrOperationNotSupported 不支持的操作错误
	ErrOperationNotSupported = errors.New("operation not supported")
)

// IsRetryableError 判断错误是否可重试
// 返回 true 表示可重试（如网络错误、服务端错误、限流）
// 返回 false 表示不可重试（如认证错误、客户端错误、配置错误）
func IsRetryableError(err error) bool {
	if err == nil {
		return false
	}

	// 检查 context 超时/取消 - 不可重试
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return false
	}

	// 检查网络超时错误
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return true
	}

	errStr := strings.ToLower(err.Error())

	// ===== 不可重试的错误 =====

	// 认证错误
	if strings.Contains(errStr, "unauthorized") ||
		strings.Contains(errStr, "invalid api key") ||
		strings.Contains(errStr, "forbidden") ||
		strings.Contains(errStr, "permission denied") {
		return false
	}

	// 客户端错误 (4xx)
	if strings.Contains(errStr, "bad request") ||
		strings.Contains(errStr, "invalid parameter") ||
		strings.Contains(errStr, "400") ||
		strings.Contains(errStr, "404") ||
		strings.Contains(errStr, "not found") {
		return false
	}

	// 配置错误
	if strings.Contains(errStr, "baseurl") ||
		strings.Contains(errStr, "不支持的渠道类型") ||
		strings.Contains(errStr, "config") ||
		strings.Contains(errStr, "unsupported") ||
		strings.Contains(errStr, "not implemented") {
		return false
	}

	// ===== 可重试的错误 =====

	// 网络错误
	if strings.Contains(errStr, "timeout") ||
		strings.Contains(errStr, "connection refused") ||
		strings.Contains(errStr, "connection reset") ||
		strings.Contains(errStr, "connection closed") {
		return true
	}

	// 服务端错误 (5xx)
	if strings.Contains(errStr, "500") ||
		strings.Contains(errStr, "502") ||
		strings.Contains(errStr, "503") ||
		strings.Contains(errStr, "504") ||
		strings.Contains(errStr, "internal server error") ||
		strings.Contains(errStr, "bad gateway") ||
		strings.Contains(errStr, "service unavailable") ||
		strings.Contains(errStr, "gateway timeout") {
		return true
	}

	// 限流错误 (429)
	if strings.Contains(errStr, "429") ||
		strings.Contains(errStr, "rate limit") ||
		strings.Contains(errStr, "too many requests") {
		return true
	}

	// 默认：未知错误不可重试
	return false
}
