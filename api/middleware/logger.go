package middleware

import (
	"bytes"
	"io"
	"net/http"
	"runtime/debug"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/session"
	"github.com/gin-gonic/gin"
)

const maxLogBodyBytes = 64 * 1024

var suppressedAccessLogPaths = []string{
	"/api/notifications/stats",
}

type responseBodyWriter struct {
	gin.ResponseWriter
	body  bytes.Buffer
	limit int
}

func (w *responseBodyWriter) Write(b []byte) (int, error) {
	if w.limit > 0 && w.body.Len() < w.limit {
		remain := w.limit - w.body.Len()
		if remain > 0 {
			if len(b) <= remain {
				_, _ = w.body.Write(b)
			} else {
				_, _ = w.body.Write(b[:remain])
			}
		}
	}
	return w.ResponseWriter.Write(b)
}

func Logger() gin.HandlerFunc {
	return func(c *gin.Context) {
		// 保存请求协议和域名
		if c.Request.URL.Scheme != "" {
			c.Set(session.SESSION_REQUEST_PROTOCOL, c.Request.URL.Scheme)
		} else {
			c.Set(session.SESSION_REQUEST_PROTOCOL, "http")
		}
		c.Set(session.SESSION_REQUEST_DOMAIN, c.Request.Host)

		// 记录请求开始时间
		start := time.Now()

		if _, ok := c.Get("log_request_body"); !ok {
			if reqBody, ok := safeReadAndRestoreBodyForLog(c.Request); ok && reqBody != "" {
				c.Set("log_request_body", reqBody)
			}
		}

		bw, ok := c.Writer.(*responseBodyWriter)
		if !ok {
			bw = &responseBodyWriter{
				ResponseWriter: c.Writer,
				limit:          maxLogBodyBytes,
			}
			c.Writer = bw
		}

		// 处理请求
		c.Next()

		// 计算请求耗时
		duration := time.Since(start)
		status := c.Writer.Status()
		if !shouldSkipAccessLog(c.Request.Method, c.Request.URL.Path, status) {
			logger.SysLogf("请求完成: method=%s path=%s status=%d cost=%s", c.Request.Method, c.Request.URL.Path, status, duration.String())
		}

		if status >= http.StatusInternalServerError {
			headers := formatHeadersRedacted(c.Request.Header)
			query := c.Request.URL.RawQuery
			ip := c.ClientIP()
			respBody := bw.body.String()
			reqBody, _ := c.Get("log_request_body")
			logger.Errorf(c.Request.Context(), "请求处理失败: method=%s path=%s status=%d cost=%s ip=%s query=%s headers=%s req=%v resp=%s",
				c.Request.Method, c.Request.URL.Path, status, duration.String(), ip, query, headers, reqBody, respBody)
		}
	}
}

func shouldSkipAccessLog(method, path string, status int) bool {
	if method != http.MethodGet {
		return false
	}
	if status >= http.StatusBadRequest {
		return false
	}
	return containsSuppressedAccessLogPath(path)
}

func containsSuppressedAccessLogPath(path string) bool {
	for _, suppressedPath := range suppressedAccessLogPaths {
		if suppressedPath == path {
			return true
		}
	}
	return false
}

func Recovery() gin.HandlerFunc {
	return func(c *gin.Context) {
		if _, ok := c.Get("log_request_body"); !ok {
			if reqBody, ok := safeReadAndRestoreBodyForLog(c.Request); ok && reqBody != "" {
				c.Set("log_request_body", reqBody)
			}
		}

		if _, ok := c.Writer.(*responseBodyWriter); !ok {
			c.Writer = &responseBodyWriter{
				ResponseWriter: c.Writer,
				limit:          maxLogBodyBytes,
			}
		}

		defer func() {
			if r := recover(); r != nil {
				status := http.StatusInternalServerError
				ip := c.ClientIP()
				query := c.Request.URL.RawQuery
				headers := formatHeadersRedacted(c.Request.Header)
				reqBody, _ := c.Get("log_request_body")

				respBody := ""
				if bw, ok := c.Writer.(*responseBodyWriter); ok {
					respBody = bw.body.String()
				}

				stack := string(debug.Stack())
				logger.Crashf(c.Request.Context(), "请求发生崩溃: method=%s path=%s status=%d ip=%s query=%s headers=%s req=%v resp=%s panic=%v stack=%s",
					c.Request.Method, c.Request.URL.Path, status, ip, query, headers, reqBody, respBody, r, stack)
				c.AbortWithStatus(status)
			}
		}()
		c.Next()
	}
}

func safeReadAndRestoreBodyForLog(r *http.Request) (string, bool) {
	if r == nil || r.Body == nil {
		return "", false
	}
	if r.ContentLength <= 0 || r.ContentLength > maxLogBodyBytes {
		return "", false
	}
	ct := strings.ToLower(r.Header.Get("Content-Type"))
	if !strings.Contains(ct, "application/json") {
		return "", false
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		return "", false
	}
	_ = r.Body.Close()
	r.Body = io.NopCloser(bytes.NewBuffer(body))
	if len(body) == 0 {
		return "", true
	}
	return string(body), true
}

func formatHeadersRedacted(h http.Header) string {
	if len(h) == 0 {
		return ""
	}
	var b strings.Builder
	first := true
	for k, vals := range h {
		kl := strings.ToLower(k)
		if kl == "authorization" || kl == "cookie" {
			vals = []string{"***"}
		}
		if !first {
			b.WriteString("; ")
		}
		first = false
		b.WriteString(k)
		b.WriteString("=")
		b.WriteString(strings.Join(vals, ","))
	}
	return b.String()
}
