package openclaw

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/hub_adaptor/custom"
	"github.com/53AI/53AIHub/service/openclaw"
	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/helper"
	"github.com/songquanpeng/one-api/common/render"
	"github.com/songquanpeng/one-api/relay/adaptor/openai"
	"github.com/songquanpeng/one-api/relay/meta"
	relay_model "github.com/songquanpeng/one-api/relay/model"
)

type Adaptor struct {
	CustomConfig *custom.CustomConfig
}

func (a *Adaptor) Init(meta *meta.Meta) {
}

func (a *Adaptor) GetRequestURL(meta *meta.Meta) (string, error) {
	// 这个方法不会被直接使用，因为OpenClaw有自己的客户端
	return "", nil
}

func (a *Adaptor) SetupRequestHeader(c *gin.Context, req *http.Request, meta *meta.Meta) error {
	// 不需要实现，因为OpenClaw有自己的处理方式
	return nil
}

func (a *Adaptor) ConvertRequest(c *gin.Context, relayMode int, request *relay_model.GeneralOpenAIRequest) (any, error) {
	if request == nil {
		return nil, nil
	}

	// 将标准的OpenAI request转换为OpenClaw格式
	messages := make([]openclaw.Message, 0, len(request.Messages))
	for _, msg := range request.Messages {
		messages = append(messages, openclaw.Message{
			Role:    msg.Role,
			Content: msg.StringContent(),
		})
	}

	openClawRequest := &openclaw.ChatCompletionRequest{
		Model:    request.Model,
		Messages: messages,
		Stream:   request.Stream,
	}
	return openClawRequest, nil
}


func (a *Adaptor) DoRequest(c *gin.Context, meta *meta.Meta, requestBody io.Reader) (*http.Response, error) {
	// 从meta中获取配置
	var gatewayConfig *model.OpenClawGatewayConfig

	// 尝试获取渠道配置
	channel, err := model.GetChannelByID(int64(meta.ChannelId))
	if err != nil {
		// 如果获取不到channel，使用默认配置
		gatewayConfig = &model.OpenClawGatewayConfig{
			GatewayURL: meta.BaseURL,
			AuthToken:  meta.APIKey,
			TimeoutMs:  30000,
			MaxRetries: 3,
		}
	} else {
		gatewayConfig = &model.OpenClawGatewayConfig{}
		if channel.Config != "" {
			_ = json.Unmarshal([]byte(channel.Config), gatewayConfig)
		}
		if channel.BaseURL != nil && *channel.BaseURL != "" {
			gatewayConfig.GatewayURL = *channel.BaseURL
		}
		if channel.Key != "" {
			gatewayConfig.AuthToken = channel.Key
		}

		if gatewayConfig.TimeoutMs == 0 {
			gatewayConfig.TimeoutMs = 30000
		}
		if gatewayConfig.MaxRetries == 0 {
			gatewayConfig.MaxRetries = 3
		}
	}

	client, err := openclaw.NewHTTPClient(gatewayConfig)
	if err != nil {
		return nil, fmt.Errorf("create OpenClaw client: %w", err)
	}

	// 从requestBody中读取请求数据
	body, err := io.ReadAll(requestBody)
	if err != nil {
		return nil, fmt.Errorf("read request body: %w", err)
	}

	var req openclaw.ChatCompletionRequest
	if err := json.Unmarshal(body, &req); err != nil {
		return nil, fmt.Errorf("parse request: %w", err)
	}

	// 发送请求
	if req.Stream {
		return a.doStreamRequest(client, &req)
	} else {
		return a.doSyncRequest(client, &req)
	}
}

func (a *Adaptor) DoResponse(c *gin.Context, resp *http.Response, meta *meta.Meta) (*relay_model.Usage, *relay_model.ErrorWithStatusCode) {
	if meta.IsStream {
		return a.streamingHandler(c, resp.Body)
	} else {
		return a.chatHandler(resp.Body)
	}
}

// ConvertImageRequest 图像请求转换
func (a *Adaptor) ConvertImageRequest(request *relay_model.ImageRequest) (any, error) {
	if request == nil {
		return nil, nil
	}
	// 直接返回原请求，OpenClaw可能不支持图像生成
	return request, nil
}

func (a *Adaptor) GetModelList() []string {
	return []string{"openclaw-*"} // 通配符匹配所有openclaw模型
}

func (a *Adaptor) GetChannelName() string {
	return "openclaw"
}

// doSyncRequest 模拟同步请求响应
func (a *Adaptor) doSyncRequest(client *openclaw.HTTPClient, req *openclaw.ChatCompletionRequest) (*http.Response, error) {
	// 实际上，我们需要模拟一个HTTP响应，因为one-api的适配器期望一个HTTP响应
	ctx := context.Background()
	resp, err := client.SendChatRequest(ctx, req)
	if err != nil {
		return nil, err
	}

	// 将响应转换为HTTP响应
	jsonData, err := json.Marshal(resp)
	if err != nil {
		return nil, err
	}

	// 创建一个模拟的HTTP响应
	r := &http.Response{
		StatusCode: http.StatusOK,
		Body:       io.NopCloser(strings.NewReader(string(jsonData))),
		Header:     make(http.Header),
	}
	r.Header.Set("Content-Type", "application/json")

	return r, nil
}

// doStreamRequest 模拟流式请求响应
func (a *Adaptor) doStreamRequest(client *openclaw.HTTPClient, req *openclaw.ChatCompletionRequest) (*http.Response, error) {
	// 为流式请求创建一个模拟的HTTP响应
	pr, pw := io.Pipe()

	// 启动一个goroutine来处理流式响应
	go func() {
		defer pw.Close()

		ctx := context.Background()
		chunkCh, errCh := client.SendChatRequestStream(ctx, req)

		// 发送初始事件
		pw.Write([]byte("data: " + fmt.Sprintf(`{"id":"chatcmpl-%d","object":"chat.completion.chunk","created":%d,"model":"%s","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}`, 
			time.Now().Unix(), time.Now().Unix(), req.Model) + "\n\n"))

		fullContent := ""

		for {
			select {
			case chunk, ok := <-chunkCh:
				if !ok {
					pw.Write([]byte("data: [DONE]\n\n"))
					return
				}

				if len(chunk.Choices) > 0 {
					delta := chunk.Choices[0].Delta.Content
					fullContent += delta

					response := map[string]interface{}{
						"id":      chunk.ID,
						"object":  "chat.completion.chunk",
						"created": chunk.Created,
						"model":   chunk.Model,
						"choices": []map[string]interface{}{
							{
								"index": 0,
								"delta": map[string]interface{}{
									"content": delta,
								},
								"finish_reason": nil,
							},
						},
					}
					jsonData, _ := json.Marshal(response)
					pw.Write([]byte("data: " + string(jsonData) + "\n\n"))
				}

			case err := <-errCh:
				if err != nil {
					pw.Write([]byte("data: " + fmt.Sprintf(`{"error":{"message":"%s","type":"server_error"}}`, err.Error()) + "\n\n"))
					return
				}
			case <-ctx.Done():
				return
			}
		}
	}()

	// 创建一个模拟的HTTP响应
	r := &http.Response{
		StatusCode: http.StatusOK,
		Body:       pr,
		Header:     make(http.Header),
	}
	r.Header.Set("Content-Type", "text/event-stream")
	r.Header.Set("Cache-Control", "no-cache")
	r.Header.Set("Connection", "keep-alive")

	return r, nil
}

func (a *Adaptor) chatHandler(reader io.Reader) (*relay_model.Usage, *relay_model.ErrorWithStatusCode) {
	respBody, err := io.ReadAll(reader)
	if err != nil {
		return nil, openai.ErrorWrapper(err, "read_response_body_failed", http.StatusInternalServerError)
	}
	
	var openClawResp openclaw.ChatCompletionResponse
	err = json.Unmarshal(respBody, &openClawResp)
	if err != nil {
		return nil, openai.ErrorWrapper(err, "unmarshal_response_body_failed", http.StatusInternalServerError)
	}

	if len(openClawResp.Choices) == 0 {
		return nil, openai.ErrorWrapper(fmt.Errorf("no choices in response"), "no_choices", http.StatusInternalServerError)
	}

	// 返回使用情况
	usage := &relay_model.Usage{
		PromptTokens:     openClawResp.Usage.PromptTokens,
		CompletionTokens: openClawResp.Usage.CompletionTokens,
		TotalTokens:      openClawResp.Usage.TotalTokens,
	}
	
	return usage, nil
}

func (a *Adaptor) streamingHandler(c *gin.Context, reader io.Reader) (*relay_model.Usage, *relay_model.ErrorWithStatusCode) {
	scanner := bufio.NewScanner(reader)
	scanner.Split(bufio.ScanLines)

	createdTime := helper.GetTimestamp()
	var responseText string

	for scanner.Scan() {
		data := scanner.Text()
		if len(data) < 5 || !strings.HasPrefix(data, "data:") {
			continue
		}
		data = strings.TrimPrefix(data, "data:")
		data = strings.TrimSuffix(data, "\r")

		if data == "[DONE]" {
			continue
		}

		var streamResponse openclaw.StreamChunk
		err := json.Unmarshal([]byte(data), &streamResponse)
		if err != nil {
			continue // 跳过无效数据
		}

		if len(streamResponse.Choices) > 0 {
			choice := openai.ChatCompletionsStreamResponseChoice{
				Delta: relay_model.Message{
					Role:    streamResponse.Choices[0].Delta.Role,
					Content: streamResponse.Choices[0].Delta.Content,
				},
				Index: streamResponse.Choices[0].Index,
			}
			
			if streamResponse.Choices[0].FinishReason != "" {
				choice.FinishReason = &streamResponse.Choices[0].FinishReason
			}

			response := &openai.ChatCompletionsStreamResponse{
				Id:      streamResponse.ID,
				Object:  "chat.completion.chunk",
				Created: createdTime,
				Model:   streamResponse.Model,
				Choices: []openai.ChatCompletionsStreamResponseChoice{choice},
			}

			err := render.ObjectData(c, response)
			if err != nil {
				return nil, openai.ErrorWrapper(err, "render_response_failed", http.StatusInternalServerError)
			}
			
			// 累积响应文本以计算使用量
			if streamResponse.Choices[0].Delta.Content != "" {
				responseText += streamResponse.Choices[0].Delta.Content
			}
		}
	}

	render.Done(c)
	
	// 对于流式响应，我们只能估算使用量
	usage := &relay_model.Usage{
		PromptTokens:     0, // 无法准确估计
		CompletionTokens: openai.CountTokenText(responseText, ""), // 使用one-api提供的计数函数
		TotalTokens:      0, // 会在调用方重新计算
	}
	
	return usage, nil
}