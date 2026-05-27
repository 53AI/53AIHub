package openclaw_ws

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/session"
	"github.com/53AI/53AIHub/common/wsmanager"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/hub_adaptor/custom"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/songquanpeng/one-api/common/helper"
	"github.com/songquanpeng/one-api/common/render"
	"github.com/songquanpeng/one-api/relay/adaptor/openai"
	"github.com/songquanpeng/one-api/relay/meta"
	relay_model "github.com/songquanpeng/one-api/relay/model"
)

type StreamError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Details string `json:"details,omitempty"`
}

type Adaptor struct {
	CustomConfig *custom.CustomConfig
}

func getConversationId(c *gin.Context) string {
	conversationIdVal, exists := c.Get(session.SESSION_CONVERSATION_ID)
	if !exists {
		return ""
	}
	switch v := conversationIdVal.(type) {
	case int64:
		return fmt.Sprintf("conv-%d", v)
	case string:
		return v
	default:
		return ""
	}
}

func (a *Adaptor) Init(meta *meta.Meta) {
}

func (a *Adaptor) GetRequestURL(meta *meta.Meta) (string, error) {
	return "", nil
}

func (a *Adaptor) SetupRequestHeader(c *gin.Context, req *http.Request, meta *meta.Meta) error {
	return nil
}

func (a *Adaptor) ConvertRequest(c *gin.Context, relayMode int, request *relay_model.GeneralOpenAIRequest) (any, error) {
	if request == nil {
		return nil, nil
	}
	return request, nil
}

func (a *Adaptor) ConvertImageRequest(request *relay_model.ImageRequest) (any, error) {
	if request == nil {
		return nil, nil
	}
	return request, nil
}

func (a *Adaptor) DoRequest(c *gin.Context, meta *meta.Meta, requestBody io.Reader) (*http.Response, error) {
	sessionAgent, exists := c.Get(session.SESSION_AGENT)
	if !exists {
		return nil, fmt.Errorf("agent not found in context")
	}
	agent, ok := sessionAgent.(*model.Agent)
	if !ok || agent == nil {
		return nil, fmt.Errorf("invalid agent type in context")
	}

	client, ok := wsmanager.WsClientManager.GetClient(agent.AgentID)
	if !ok || client == nil {
		logger.SysError(fmt.Sprintf("[openclaw-ws] WebSocket client not found for agentID=%d", agent.AgentID))
		return nil, fmt.Errorf("websocket agent is not connected")
	}

	payloadBytes, err := io.ReadAll(requestBody)
	if err != nil {
		return nil, fmt.Errorf("failed to read request body: %w", err)
	}

	var requestData map[string]interface{}
	if err := json.Unmarshal(payloadBytes, &requestData); err == nil {
		if userID := config.GetUserId(c); userID != 0 {
			if _, exists := requestData["user"]; !exists {
				requestData["user"] = fmt.Sprintf("user-%d", userID)
			}
		}

		if conversationID := getConversationId(c); conversationID != "" {
			if _, exists := requestData["conversation_id"]; !exists {
				requestData["conversation_id"] = conversationID
			}
		}

		// 解析并转换多模态消息内容
		convertMultimodalMessages(requestData)

		if enrichedBytes, err := json.Marshal(requestData); err == nil {
			payloadBytes = enrichedBytes
		}
	}

	reqID := uuid.New().String()
	pr, pw := io.Pipe()

	client.AddWriter(reqID, pw)

	wsMsg := wsmanager.WsMessage{
		ReqID:  reqID,
		Action: "chat",
		Data:   json.RawMessage(payloadBytes),
		Status: "streaming",
	}

	err = client.SendMessage(wsMsg)
	if err != nil {
		client.RemoveWriter(reqID)
		pw.Close()
		logger.SysError(fmt.Sprintf("[openclaw-ws] Failed to send WebSocket message: %v", err))
		return nil, fmt.Errorf("failed to send request to websocket agent: %w", err)
	}

	return &http.Response{
		StatusCode: http.StatusOK,
		Body:       pr,
	}, nil
}

func (a *Adaptor) DoResponse(c *gin.Context, res *http.Response, meta *meta.Meta) (usage *relay_model.Usage, err *relay_model.ErrorWithStatusCode) {
	if meta.IsStream {
		return a.streamingHandler(c, res.Body)
	}

	bodyBytes, readErr := io.ReadAll(res.Body)
	if readErr != nil {
		return nil, openai.ErrorWrapper(readErr, "read_response_failed", http.StatusInternalServerError)
	}

	var fullText string
	var finishReason string = "stop"

	scanner := bufio.NewScanner(bytes.NewReader(bodyBytes))
	for scanner.Scan() {
		line := scanner.Text()
		if len(line) < 5 || !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimPrefix(line, "data:")
		data = strings.TrimSpace(data)
		if data == "[DONE]" {
			break
		}
		var streamResp struct {
			Error   *StreamError `json:"error,omitempty"`
			Choices []struct {
				Delta struct {
					Content string `json:"content"`
				} `json:"delta"`
				FinishReason string `json:"finish_reason"`
			} `json:"choices"`
		}
		if unmarshalErr := json.Unmarshal([]byte(data), &streamResp); unmarshalErr == nil {
			if streamResp.Error != nil {
				logger.SysError(fmt.Sprintf("[openclaw-ws] Non-stream error: code=%s, message=%s, details=%s",
					streamResp.Error.Code, streamResp.Error.Message, streamResp.Error.Details))
			}
			if len(streamResp.Choices) > 0 {
				fullText += streamResp.Choices[0].Delta.Content
				if streamResp.Choices[0].FinishReason != "" {
					finishReason = streamResp.Choices[0].FinishReason
				}
			}
		}
	}

	if scanErr := scanner.Err(); scanErr != nil {
		logger.SysError(fmt.Sprintf("[openclaw-ws] Scanner error: %v", scanErr))
	}

	resp := &openai.TextResponse{
		Id:      uuid.New().String(),
		Object:  "chat.completion",
		Created: helper.GetTimestamp(),
		Model:   meta.ActualModelName,
		Choices: []openai.TextResponseChoice{
			{
				Index: 0,
				Message: relay_model.Message{
					Role:    "assistant",
					Content: fullText,
				},
				FinishReason: finishReason,
			},
		},
		Usage: relay_model.Usage{
			PromptTokens:     0,
			CompletionTokens: openai.CountTokenText(fullText, ""),
			TotalTokens:      openai.CountTokenText(fullText, ""),
		},
	}

	c.Set("openclaw_ws_response_content", fullText)

	jsonResponse, _ := json.Marshal(resp)
	c.Writer.Header().Set("Content-Type", "application/json")
	c.Writer.WriteHeader(http.StatusOK)
	c.Writer.Write(jsonResponse)

	return &resp.Usage, nil
}

func (a *Adaptor) streamingHandler(c *gin.Context, reader io.Reader) (*relay_model.Usage, *relay_model.ErrorWithStatusCode) {
	scanner := bufio.NewScanner(reader)
	scanner.Split(bufio.ScanLines)

	scanner.Buffer(make([]byte, 64*1024), 1024*1024)

	var responseText string
	var reasoningText string

	for scanner.Scan() {
		data := scanner.Text()
		if len(data) < 5 || !strings.HasPrefix(data, "data:") {
			continue
		}
		data = strings.TrimPrefix(data, "data:")
		data = strings.TrimSpace(data)

		if data == "[DONE]" {
			continue
		}

		var streamResponse struct {
			ID      string       `json:"id"`
			Model   string       `json:"model"`
			Error   *StreamError `json:"error,omitempty"`
			Choices []struct {
				Delta struct {
					Role             string `json:"role"`
					Content          string `json:"content"`
					ReasoningContent string `json:"reasoning_content"`
				} `json:"delta"`
				Index        int    `json:"index"`
				FinishReason string `json:"finish_reason"`
			} `json:"choices"`
		}

		err := json.Unmarshal([]byte(data), &streamResponse)
		if err != nil {
			logger.SysError(fmt.Sprintf("[openclaw-ws] Failed to parse stream response: %v, raw: %s", err, data))
			continue
		}

		if streamResponse.Error != nil {
			logger.SysError(fmt.Sprintf("[openclaw-ws] Stream error: code=%s, message=%s, details=%s",
				streamResponse.Error.Code, streamResponse.Error.Message, streamResponse.Error.Details))
		}

		if len(streamResponse.Choices) > 0 {
			// 检查是否有 reasoning_content（来自 thinking 消息转换）
			if streamResponse.Choices[0].Delta.ReasoningContent != "" {
				// 直接构建包含 reasoning_content 的 JSON 响应
				response := map[string]interface{}{
					"id":      streamResponse.ID,
					"object":  "chat.completion.chunk",
					"created": helper.GetTimestamp(),
					"model":   streamResponse.Model,
					"choices": []map[string]interface{}{
						{
							"index": streamResponse.Choices[0].Index,
							"delta": map[string]interface{}{
								"reasoning_content": streamResponse.Choices[0].Delta.ReasoningContent,
							},
							"finish_reason": nil,
						},
					},
				}
				jsonData, jsonErr := json.Marshal(response)
				if jsonErr != nil {
					logger.SysError(fmt.Sprintf("[openclaw-ws] Failed to marshal reasoning response: %v", jsonErr))
					continue
				}
				c.Writer.Write([]byte("data: "))
				c.Writer.Write(jsonData)
				c.Writer.Write([]byte("\n\n"))
				if flusher, ok := c.Writer.(http.Flusher); ok {
					flusher.Flush()
				}
				reasoningText += streamResponse.Choices[0].Delta.ReasoningContent
			} else {
				// 普通 content 消息，使用标准结构体
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
					Created: helper.GetTimestamp(),
					Model:   streamResponse.Model,
					Choices: []openai.ChatCompletionsStreamResponseChoice{choice},
				}

				renderErr := render.ObjectData(c, response)
				if renderErr != nil {
					logger.SysError(fmt.Sprintf("[openclaw-ws] Render error: %v", renderErr))
					return nil, openai.ErrorWrapper(renderErr, "render_response_failed", http.StatusInternalServerError)
				}

				if streamResponse.Choices[0].Delta.Content != "" {
					responseText += streamResponse.Choices[0].Delta.Content
				}
			}
		}
	}

	if scanErr := scanner.Err(); scanErr != nil {
		logger.SysError(fmt.Sprintf("[openclaw-ws] Stream scanner error: %v", scanErr))
	}

	render.Done(c)

	// 将 reasoning_content 存储到上下文中，以便后续保存到数据库
	if reasoningText != "" {
		c.Set("openclaw_ws_reasoning_content", reasoningText)
	}

	usage := &relay_model.Usage{
		PromptTokens:     0,
		CompletionTokens: openai.CountTokenText(responseText+reasoningText, ""),
		TotalTokens:      0,
	}

	return usage, nil
}

func (a *Adaptor) GetModelList() []string {
	return []string{"openclaw-ws"}
}

func (a *Adaptor) GetChannelName() string {
	return "openclaw-ws"
}

// GetConnectionStatus 获取 WebSocket 连接状态（供外部查询）
func GetConnectionStatus(agentID int64) (connected bool, lastActive time.Time) {
	client, ok := wsmanager.WsClientManager.GetClient(agentID)
	if !ok {
		return false, time.Time{}
	}
	return true, client.GetLastActive()
}

// GetMetrics 获取 WebSocket 连接状态（供外部查询）
func GetMetrics() wsmanager.WsMetrics {
	return wsmanager.GetMetrics()
}

// convertMultimodalMessages 解析并转换多模态消息内容
// 兼容格式：[{"type":"text","content":"..."},{"type":"image","content":"file_id:xxx","url":"..."}]
// 转换为插件期望的格式：[{"type":"text","text":"..."},{"type":"image","url":"..."}]
func convertMultimodalMessages(requestData map[string]interface{}) {
	messages, ok := requestData["messages"].([]interface{})
	if !ok {
		return
	}

	for _, msg := range messages {
		msgMap, ok := msg.(map[string]interface{})
		if !ok {
			continue
		}

		content, ok := msgMap["content"]
		if !ok {
			continue
		}

		contentStr, ok := content.(string)
		if !ok {
			continue
		}

		if len(contentStr) == 0 || contentStr[0] != '[' {
			continue
		}

		var contentItems []map[string]interface{}
		if err := json.Unmarshal([]byte(contentStr), &contentItems); err != nil {
			continue
		}

		converted := make([]map[string]interface{}, 0, len(contentItems))
		for _, item := range contentItems {
			itemType, _ := item["type"].(string)
			switch itemType {
			case "text":
				convertedItem := map[string]interface{}{
					"type": "text",
				}
				if text, ok := item["text"].(string); ok {
					convertedItem["text"] = text
				} else if contentVal, ok := item["content"].(string); ok {
					convertedItem["text"] = contentVal
				}
				converted = append(converted, convertedItem)

			case "image":
				convertedItem := map[string]interface{}{
					"type": "image",
				}
				if url, ok := item["url"].(string); ok && url != "" {
					convertedItem["url"] = url
				}
				if base64, ok := item["base64"].(string); ok {
					convertedItem["base64"] = base64
				}
				if mimeType, ok := item["mimeType"].(string); ok {
					convertedItem["mimeType"] = mimeType
				} else if mimeType, ok := item["mime_type"].(string); ok {
					convertedItem["mimeType"] = mimeType
				}
				converted = append(converted, convertedItem)

			case "image_url":
				converted = append(converted, item)

			case "file":
				convertedItem := map[string]interface{}{
					"type": "file",
				}
				if url, ok := item["url"].(string); ok && url != "" {
					convertedItem["url"] = url
				}
				if base64, ok := item["base64"].(string); ok {
					convertedItem["base64"] = base64
				}
				if filename, ok := item["filename"].(string); ok {
					convertedItem["filename"] = filename
				}
				if mimeType, ok := item["mimeType"].(string); ok {
					convertedItem["mimeType"] = mimeType
				} else if mimeType, ok := item["mime_type"].(string); ok {
					convertedItem["mimeType"] = mimeType
				}
				converted = append(converted, convertedItem)

			default:
				converted = append(converted, item)
			}
		}

		msgMap["content"] = converted
	}
}
