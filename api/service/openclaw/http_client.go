package openclaw

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/53AI/53AIHub/model"
)

// HTTPClient OpenClaw HTTP 客户端
type HTTPClient struct {
	GatewayURL string
	AuthToken  string
	Timeout    time.Duration
	MaxRetries int
	Headers    http.Header
	HTTPClient *http.Client
}

// NewHTTPClient 从配置创建 HTTP 客户端
func NewHTTPClient(config *model.OpenClawGatewayConfig) (*HTTPClient, error) {
	if config == nil {
		return nil, fmt.Errorf("config is nil")
	}

	// 初始化默认 headers
	headers := make(http.Header)
	headers.Set("Authorization", "Bearer "+config.AuthToken)

	return &HTTPClient{
		GatewayURL: config.GatewayURL,
		AuthToken:  config.AuthToken,
		Timeout:    time.Duration(config.TimeoutMs) * time.Millisecond,
		MaxRetries: config.MaxRetries,
		Headers:    headers,
		HTTPClient: &http.Client{
			Timeout: time.Duration(config.TimeoutMs) * time.Millisecond,
		},
	}, nil
}

// sendChatRequest 发送单个请求
func (c *HTTPClient) sendChatRequest(
	ctx context.Context,
	req *ChatCompletionRequest,
	streaming bool,
) (*ChatCompletionResponse, error) {
	req.Stream = streaming

	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(
		ctx,
		"POST",
		fmt.Sprintf("%s/v1/chat/completions", c.GatewayURL),
		bytes.NewBuffer(body),
	)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}

	// 设置默认 headers
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "application/json")

	// 确保 Authorization header 存在于 c.Headers 中
	if _, hasAuth := c.Headers["Authorization"]; !hasAuth {
		httpReq.Header.Set("Authorization", "Bearer "+c.AuthToken)
	} else {
		// 如果 c.Headers 中已经有 Authorization，则使用它
		for _, authHeaderValue := range c.Headers["Authorization"] {
			httpReq.Header.Add("Authorization", authHeaderValue)
		}
	}

	// 添加其他自定义 headers
	for k, v := range c.Headers {
		if k == "Authorization" {
			continue // 跳过 Authorization，已在上面处理
		}
		for _, headerValue := range v {
			httpReq.Header.Add(k, headerValue)
		}
	}

	// 检查并设置 x-openclaw-agent-id header
	// 优先级：从模型名中解析 > 使用已设置的header值
	model := req.Model
	if strings.HasPrefix(model, "openclaw:") || strings.HasPrefix(model, "agent:") {
		parts := strings.Split(model, ":")
		if len(parts) >= 2 {
			// 如果模型名包含agent信息，则使用模型中的agent ID
			httpReq.Header.Set("x-openclaw-agent-id", parts[1])
		}
	}

	httpResp, err := c.HTTPClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("send request: %w", err)
	}
	defer httpResp.Body.Close()

	if httpResp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(httpResp.Body)
		return nil, fmt.Errorf("http %d: %s", httpResp.StatusCode, string(respBody))
	}

	var resp ChatCompletionResponse
	if err := json.NewDecoder(httpResp.Body).Decode(&resp); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}

	return &resp, nil
}

// sendChatRequestStreamInternal 发送流式请求
func (c *HTTPClient) sendChatRequestStreamInternal(
	ctx context.Context,
	req *ChatCompletionRequest,
	chunkCh chan<- *StreamChunk,
) error {
	req.Stream = true

	body, err := json.Marshal(req)
	if err != nil {
		return fmt.Errorf("marshal request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(
		ctx,
		"POST",
		fmt.Sprintf("%s/v1/chat/completions", c.GatewayURL),
		bytes.NewBuffer(body),
	)
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}

	// 设置默认 headers
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "text/event-stream")

	// 确保 Authorization header 存在于 c.Headers 中
	if _, hasAuth := c.Headers["Authorization"]; !hasAuth {
		httpReq.Header.Set("Authorization", "Bearer "+c.AuthToken)
	} else {
		// 如果 c.Headers 中已经有 Authorization，则使用它
		for _, authHeaderValue := range c.Headers["Authorization"] {
			httpReq.Header.Add("Authorization", authHeaderValue)
		}
	}

	// 添加其他自定义 headers
	for k, v := range c.Headers {
		if k == "Authorization" {
			continue // 跳过 Authorization，已在上面处理
		}
		for _, headerValue := range v {
			httpReq.Header.Add(k, headerValue)
		}
	}

	// 检查并设置 x-openclaw-agent-id header
	// 优先级：从模型名中解析 > 使用已设置的header值
	model := req.Model
	if strings.HasPrefix(model, "openclaw:") || strings.HasPrefix(model, "agent:") {
		parts := strings.Split(model, ":")
		if len(parts) >= 2 {
			// 如果模型名包含agent信息，则使用模型中的agent ID
			httpReq.Header.Set("x-openclaw-agent-id", parts[1])
		}
	}

	httpResp, err := c.HTTPClient.Do(httpReq)
	if err != nil {
		return fmt.Errorf("send request: %w", err)
	}
	defer httpResp.Body.Close()

	if httpResp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(httpResp.Body)
		return fmt.Errorf("http %d: %s", httpResp.StatusCode, string(respBody))
	}

	// 解析 SSE 流
	reader := bufio.NewReader(httpResp.Body)
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			if err == io.EOF {
				return nil
			}
			return fmt.Errorf("read stream: %w", err)
		}

		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		// 解析 data: 行
		if !strings.HasPrefix(line, "data: ") {
			continue
		}

		data := strings.TrimPrefix(line, "data: ")
		data = strings.TrimSpace(data)

		// 检查是否结束
		if data == "[DONE]" {
			return nil
		}

		// 解析 JSON
		var chunk StreamChunk
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			// 忽略解析错误，继续读取
			continue
		}

		select {
		case chunkCh <- &chunk:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}

// Message 消息结构
// Content 支持 string（纯文本）或 []ContentItem（多模态内容）
type Message struct {
	Role    string `json:"role"`
	Content any    `json:"content"`
}

// ChatCompletionRequest Chat Completions 请求
type ChatCompletionRequest struct {
	Model    string         `json:"model"`
	Messages []Message      `json:"messages"`
	Stream   bool           `json:"stream"`
	Metadata map[string]any `json:"metadata,omitempty"`
}

// ChatCompletionResponse Chat Completions 响应
type ChatCompletionResponse struct {
	ID      string   `json:"id"`
	Object  string   `json:"object"`
	Created int64    `json:"created"`
	Model   string   `json:"model"`
	Choices []Choice `json:"choices"`
	Usage   Usage    `json:"usage"`
}

// Choice 选择
type Choice struct {
	Index        int     `json:"index"`
	Message      Message `json:"message"`
	FinishReason string  `json:"finish_reason"`
}

// Usage 使用统计
type Usage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
}

// StreamChunk 流式响应块
type StreamChunk struct {
	ID      string `json:"id"`
	Object  string `json:"object"`
	Created int64  `json:"created"`
	Model   string `json:"model"`
	Choices []struct {
		Index int `json:"index"`
		Delta struct {
			Content string `json:"content,omitempty"`
			Role    string `json:"role,omitempty"`
		} `json:"delta"`
		FinishReason string `json:"finish_reason,omitempty"`
	} `json:"choices"`
}

// SendChatRequest 发送 Chat 请求（非流式）
func (c *HTTPClient) SendChatRequest(
	ctx context.Context,
	req *ChatCompletionRequest,
) (*ChatCompletionResponse, error) {
	return c.sendChatRequestWithRetry(ctx, req, false)
}

// SendChatRequestStream 发送 Chat 请求（流式）
func (c *HTTPClient) SendChatRequestStream(
	ctx context.Context,
	req *ChatCompletionRequest,
) (<-chan *StreamChunk, <-chan error) {
	chunkCh := make(chan *StreamChunk, 100)
	errCh := make(chan error, 1)

	go func() {
		defer close(chunkCh)
		defer close(errCh)

		if err := c.sendChatRequestStreamInternal(ctx, req, chunkCh); err != nil {
			errCh <- err
		}
	}()

	return chunkCh, errCh
}

// sendChatRequestWithRetry 带重试的请求发送
func (c *HTTPClient) sendChatRequestWithRetry(
	ctx context.Context,
	req *ChatCompletionRequest,
	streaming bool,
) (*ChatCompletionResponse, error) {
	var lastErr error

	for i := 0; i < c.MaxRetries; i++ {
		resp, err := c.sendChatRequest(ctx, req, streaming)
		if err == nil {
			return resp, nil
		}

		lastErr = err
		if !isRetryableError(err) {
			break
		}

		// 指数退避
		time.Sleep(time.Duration(1<<uint(i)) * time.Second)
	}

	return nil, lastErr
}

// isRetryableError 检查错误是否可重试
func isRetryableError(err error) bool {
	if err == nil {
		return false
	}

	errStr := err.Error()
	lowerErrStr := strings.ToLower(errStr)

	// 检查常见的可重试错误
	retryablePhrases := []string{
		"connection refused",
		"connection reset",
		"timeout",             // 通用timeout匹配
		"operation timed out", // 特定的timeout错误信息
		"temporary failure",
		"no such host",
		"i/o timeout",
		"broken pipe",
		"connection aborted",
		"use of closed network connection",
	}

	for _, phrase := range retryablePhrases {
		if strings.Contains(lowerErrStr, phrase) {
			return true
		}
	}

	return false
}
