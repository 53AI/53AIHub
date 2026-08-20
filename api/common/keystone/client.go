package keystone

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Client Keystone 上报客户端，封装 HMAC-SHA256 签名和 HTTP 请求
type Client struct {
	endpoint       string
	integrationKey string
	secret         string
	productKey     string
	serviceKey     string
	environmentKey string
	httpClient     *http.Client
	maxRetries     int
}

// NewClient 创建上报客户端
func NewClient(endpoint, integrationKey, secret, productKey, serviceKey, environmentKey string, timeout time.Duration, maxRetries int) *Client {
	return &Client{
		endpoint:       strings.TrimRight(endpoint, "/"),
		integrationKey: integrationKey,
		secret:         secret,
		productKey:     productKey,
		serviceKey:     serviceKey,
		environmentKey: environmentKey,
		httpClient:     &http.Client{Timeout: timeout},
		maxRetries:     maxRetries,
	}
}

// fillDefaults 用客户端的默认值补充事件中的空字段
func (c *Client) fillDefaults(event *TaskEvent) {
	if event.Source == "" {
		event.Source = c.integrationKey
	}
	if event.ProductKey == "" {
		event.ProductKey = c.productKey
	}
	if event.ServiceKey == "" {
		event.ServiceKey = c.serviceKey
	}
	if event.EnvironmentKey == "" {
		event.EnvironmentKey = c.environmentKey
	}
}

// sign 计算 HMAC-SHA256 签名
func (c *Client) sign(timestamp int64, body []byte) string {
	mac := hmac.New(sha256.New, []byte(c.secret))
	mac.Write([]byte(strconv.FormatInt(timestamp, 10)))
	mac.Write([]byte("."))
	mac.Write(body)
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}

// post 发送 POST 请求到指定路径，含重试逻辑
func (c *Client) post(path string, payload interface{}) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("keystone: marshal failed: %w", err)
	}

	url := c.endpoint + path

	for retry := 0; retry <= c.maxRetries; retry++ {
		timestamp := time.Now().Unix()
		signature := c.sign(timestamp, body)

		req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
		if err != nil {
			return fmt.Errorf("keystone: request failed: %w", err)
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Integration-Key", c.integrationKey)
		req.Header.Set("X-Webhook-Timestamp", strconv.FormatInt(timestamp, 10))
		req.Header.Set("X-Webhook-Signature", signature)

		resp, err := c.httpClient.Do(req)
		if err != nil {
			if retry < c.maxRetries {
				time.Sleep(time.Duration(100*(1<<retry)) * time.Millisecond)
				continue
			}
			return fmt.Errorf("keystone: request failed after %d retries: %w", retry, err)
		}
		io.Copy(io.Discard, resp.Body)
		resp.Body.Close()

		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			return nil
		}
		if resp.StatusCode == 408 || resp.StatusCode == 429 || resp.StatusCode >= 500 {
			if retry < c.maxRetries {
				time.Sleep(time.Duration(100*(1<<retry)) * time.Millisecond)
				continue
			}
		}
		return fmt.Errorf("keystone: HTTP %d", resp.StatusCode)
	}
	return fmt.Errorf("keystone: max retries exceeded")
}

// safeCall 安全调用，不向业务抛错误
func (c *Client) safeCall(fn func() error) {
	if c == nil {
		return
	}
	if err := fn(); err != nil {
		// 只记录日志，不抛给业务；调用方已注入 logger
		fmt.Printf("keystone: %v\n", err)
	}
}

// ReportTaskCreated 上报任务创建
func (c *Client) ReportTaskCreated(event TaskEvent) {
	c.fillDefaults(&event)
	event.Status = TaskStatusPending
	c.safeCall(func() error {
		return c.post("/api/v1/webhooks/business-tasks", event)
	})
}

// ReportTaskStageStarted 上报阶段开始
func (c *Client) ReportTaskStageStarted(event TaskEvent) {
	c.fillDefaults(&event)
	event.Status = TaskStatusRunning
	event.StageStatus = TaskStatusRunning
	c.safeCall(func() error {
		return c.post("/api/v1/webhooks/business-tasks", event)
	})
}

// ReportTaskStageCompleted 上报阶段完成
func (c *Client) ReportTaskStageCompleted(event TaskEvent) {
	c.fillDefaults(&event)
	event.Status = TaskStatusRunning
	event.StageStatus = TaskStatusSucceeded
	c.safeCall(func() error {
		return c.post("/api/v1/webhooks/business-tasks", event)
	})
}

// ReportTaskSucceeded 上报任务成功
func (c *Client) ReportTaskSucceeded(event TaskEvent) {
	c.fillDefaults(&event)
	event.Status = TaskStatusSucceeded
	event.FinishedAt = time.Now().UTC()
	c.safeCall(func() error {
		return c.post("/api/v1/webhooks/business-tasks", event)
	})
}

// ReportTaskFailed 上报任务失败
func (c *Client) ReportTaskFailed(event TaskEvent, failureCode, failureMessage string) {
	c.fillDefaults(&event)
	event.Status = TaskStatusFailed
	event.FailureCode = failureCode
	event.FailureMessage = truncate(failureMessage, 512)
	event.FinishedAt = time.Now().UTC()
	c.safeCall(func() error {
		return c.post("/api/v1/webhooks/business-tasks", event)
	})
}

// ReportTaskBatch 批量上报
func (c *Client) ReportTaskBatch(events []TaskEvent) {
	if len(events) == 0 || len(events) > 100 {
		return
	}
	for i := range events {
		c.fillDefaults(&events[i])
		if events[i].Status == "" {
			events[i].Status = TaskStatusRunning
		}
	}
	c.safeCall(func() error {
		return c.post("/api/v1/webhooks/business-tasks/batch", BatchRequest{Events: events})
	})
}

// ReportChangeEvent 上报变更事件
func (c *Client) ReportChangeEvent(event ChangeEvent) {
	c.safeCall(func() error {
		return c.post("/api/v1/webhooks/change-events", event)
	})
}

func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen]
}