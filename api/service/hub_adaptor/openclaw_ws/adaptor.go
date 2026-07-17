package openclaw_ws

import (
	"bufio"
	"bytes"
	"context"
	"crypto/md5"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/session"
	"github.com/53AI/53AIHub/common/storage"
	"github.com/53AI/53AIHub/common/utils/hashids"
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

const openClawWSRequestControlKey = "openclaw_ws_request_control"

type openClawWSRequestControl struct {
	client *wsmanager.WSClient
	reqID  string

	mu             sync.Mutex
	conversationID string
	completed      atomic.Bool
	detachStarted  atomic.Bool
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

func newOpenClawWSRequestControl(client *wsmanager.WSClient, reqID string, conversationID string) *openClawWSRequestControl {
	control := &openClawWSRequestControl{
		client: client,
		reqID:  reqID,
	}
	control.SetConversationID(conversationID)
	return control
}

func (c *openClawWSRequestControl) SetConversationID(conversationID string) {
	conversationID = strings.TrimSpace(conversationID)
	if conversationID == "" {
		return
	}
	c.mu.Lock()
	c.conversationID = conversationID
	c.mu.Unlock()
}

func (c *openClawWSRequestControl) ConversationID() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.conversationID
}

func (c *openClawWSRequestControl) MarkComplete() {
	c.completed.Store(true)
}

func (c *openClawWSRequestControl) DetachForClientCancel(agentID int64) {
	if c == nil || c.client == nil || c.completed.Load() || !c.detachStarted.CompareAndSwap(false, true) {
		return
	}

	c.client.RemoveWriter(c.reqID)
	conversationID := c.ConversationID()
	if conversationID == "" {
		logger.Warnf(context.Background(), "[openclaw-ws] client detached request before OpenClaw session was known: agentID=%d reqID=%s", agentID, c.reqID)
		return
	}
	logger.Infof(context.Background(), "[openclaw-ws] client detached stream without stopping OpenClaw run: agentID=%d reqID=%s conversation_id=%s", agentID, c.reqID, conversationID)
}

func setOpenClawWSRequestConversationID(c *gin.Context, conversationID string) {
	value, exists := c.Get(openClawWSRequestControlKey)
	if !exists {
		return
	}
	control, ok := value.(*openClawWSRequestControl)
	if !ok {
		return
	}
	control.SetConversationID(conversationID)
}

func completeOpenClawWSRequest(c *gin.Context) {
	value, exists := c.Get(openClawWSRequestControlKey)
	if !exists {
		return
	}
	control, ok := value.(*openClawWSRequestControl)
	if !ok {
		return
	}
	control.MarkComplete()
}

func stringValue(value interface{}) string {
	switch v := value.(type) {
	case string:
		return strings.TrimSpace(v)
	case json.Number:
		return strings.TrimSpace(v.String())
	case float64:
		if v == float64(int64(v)) {
			return strconv.FormatInt(int64(v), 10)
		}
		return strconv.FormatFloat(v, 'f', -1, 64)
	case int:
		return strconv.Itoa(v)
	case int64:
		return strconv.FormatInt(v, 10)
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
	var openClawConversationID string
	if err := json.Unmarshal(payloadBytes, &requestData); err == nil {
		if _, exists := requestData["user"]; !exists {
			if a.CustomConfig != nil && strings.TrimSpace(a.CustomConfig.UserId) != "" {
				requestData["user"] = a.CustomConfig.UserId
			} else if userID := config.GetUserId(c); userID != 0 {
				requestData["user"] = fmt.Sprintf("user-%d", userID)
			}
		}

		if conversationID := getConversationId(c); conversationID != "" {
			if _, exists := requestData["conversation_id"]; !exists {
				requestData["conversation_id"] = conversationID
			}
		}
		openClawConversationID = stringValue(requestData["conversation_id"])
		if openClawConversationID == "" {
			openClawConversationID = stringValue(requestData["session_id"])
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
	requestControl := newOpenClawWSRequestControl(client, reqID, openClawConversationID)
	c.Set(openClawWSRequestControlKey, requestControl)
	logOpenClawStreamTrace(openClawWSRequestContext(c), "backend.request.start", map[string]interface{}{
		"agent_id":             agent.AgentID,
		"req_id":               reqID,
		"conversation_id_hash": shortOpenClawTraceHash(openClawConversationID),
		"payload_bytes":        len(payloadBytes),
		"has_conversation_id":  openClawConversationID != "",
	})
	go func() {
		<-c.Request.Context().Done()
		requestControl.DetachForClientCancel(agent.AgentID)
	}()

	wsMsg := wsmanager.WsMessage{
		ReqID:  reqID,
		Action: "chat",
		Data:   json.RawMessage(payloadBytes),
		Status: "streaming",
	}

	err = client.SendMessage(wsMsg)
	if err != nil {
		requestControl.MarkComplete()
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
	defer completeOpenClawWSRequest(c)
	if res != nil && res.Body != nil {
		defer res.Body.Close()
	}
	if meta.IsStream {
		return a.streamingHandler(c, res.Body, meta.ActualModelName)
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
				return nil, wrapOpenClawStreamError(streamResp.Error)
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
			CompletionTokens: countOpenClawWSTokens(fullText, meta.ActualModelName),
			TotalTokens:      countOpenClawWSTokens(fullText, meta.ActualModelName),
		},
	}

	c.Set("openclaw_ws_response_content", fullText)
	c.Set("openclaw_ws_reasoning_content", "")

	jsonResponse, _ := json.Marshal(resp)
	c.Writer.Header().Set("Content-Type", "application/json")
	c.Writer.WriteHeader(http.StatusOK)
	c.Writer.Write(jsonResponse)

	return &resp.Usage, nil
}

func (a *Adaptor) streamingHandler(c *gin.Context, reader io.Reader, modelName string) (*relay_model.Usage, *relay_model.ErrorWithStatusCode) {
	scanner := bufio.NewScanner(reader)
	scanner.Split(bufio.ScanLines)

	scanner.Buffer(make([]byte, 64*1024), 1024*1024)

	var responseText string
	var reasoningText string
	streamTrace := newOpenClawWSStreamTrace(c, modelName)
	defer streamTrace.Finish()

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

		var rawResponse map[string]interface{}
		if err := json.Unmarshal([]byte(data), &rawResponse); err != nil {
			logger.SysError(fmt.Sprintf("[openclaw-ws] Failed to parse stream response: %v, raw: %s", err, data))
			continue
		}
		logOpenClawDuplicateTrace(openClawWSRequestContext(c), "backend.upstream.raw", summarizeOpenClawRawStreamPayload(rawResponse))
		streamTrace.Observe("backend.upstream.raw", rawResponse)

		if rawResponse["object"] == "process.step" {
			normalizedResponse := normalizeOpenClawWSProcessStep(c, rawResponse)
			jsonData, jsonErr := json.Marshal(normalizedResponse)
			if jsonErr != nil {
				logger.SysError(fmt.Sprintf("[openclaw-ws] Failed to marshal process step response: %v", jsonErr))
				continue
			}
			logOpenClawDuplicateTrace(openClawWSRequestContext(c), "backend.downstream.process_step", summarizeOpenClawRawStreamPayload(normalizedResponse))
			streamTrace.Observe("backend.downstream.process_step", normalizedResponse)
			c.Writer.Write([]byte("data: "))
			c.Writer.Write(jsonData)
			c.Writer.Write([]byte("\n\n"))
			if flusher, ok := c.Writer.(http.Flusher); ok {
				flusher.Flush()
			}
			continue
		}

		var streamResponse struct {
			ID             string          `json:"id"`
			Model          string          `json:"model"`
			Status         string          `json:"status,omitempty"`
			Mode           string          `json:"mode,omitempty"`
			Replace        *bool           `json:"replace,omitempty"`
			EventKind      string          `json:"event_kind,omitempty"`
			Payload        json.RawMessage `json:"payload,omitempty"`
			SessionID      string          `json:"session_id,omitempty"`
			ConversationID string          `json:"conversation_id,omitempty"`
			Error          *StreamError    `json:"error,omitempty"`
			Choices        []struct {
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
		if streamResponse.SessionID != "" {
			setOpenClawWSRequestConversationID(c, streamResponse.SessionID)
		} else if streamResponse.ConversationID != "" {
			setOpenClawWSRequestConversationID(c, streamResponse.ConversationID)
		}

		if streamResponse.Error != nil {
			streamTrace.ErrorCount += 1
			logger.SysError(fmt.Sprintf("[openclaw-ws] Stream error: code=%s, message=%s, details=%s",
				streamResponse.Error.Code, streamResponse.Error.Message, streamResponse.Error.Details))
			return nil, wrapOpenClawStreamError(streamResponse.Error)
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
				if streamResponse.SessionID != "" {
					response["session_id"] = streamResponse.SessionID
				}
				if streamResponse.ConversationID != "" {
					response["conversation_id"] = streamResponse.ConversationID
				}
				addOpenClawStreamMetadata(response, streamResponse.Status, streamResponse.Mode, streamResponse.Replace, streamResponse.EventKind)
				addOpenClawStreamPayload(response, streamResponse.Payload)
				logOpenClawDuplicateTrace(openClawWSRequestContext(c), "backend.downstream.reasoning", summarizeOpenClawRawStreamPayload(response))
				streamTrace.Observe("backend.downstream.reasoning", response)
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

				response := map[string]interface{}{
					"id":      streamResponse.ID,
					"object":  "chat.completion.chunk",
					"created": helper.GetTimestamp(),
					"model":   streamResponse.Model,
					"choices": []openai.ChatCompletionsStreamResponseChoice{choice},
				}
				if streamResponse.SessionID != "" {
					response["session_id"] = streamResponse.SessionID
				}
				if streamResponse.ConversationID != "" {
					response["conversation_id"] = streamResponse.ConversationID
				}
				addOpenClawStreamMetadata(response, streamResponse.Status, streamResponse.Mode, streamResponse.Replace, streamResponse.EventKind)
				addOpenClawStreamPayload(response, streamResponse.Payload)
				logOpenClawDuplicateTrace(openClawWSRequestContext(c), "backend.downstream.content", summarizeOpenClawRawStreamPayload(response))
				streamTrace.Observe("backend.downstream.content", response)

				renderErr := render.ObjectData(c, response)
				if renderErr != nil {
					streamTrace.ErrorCount += 1
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
		streamTrace.ErrorCount += 1
		logger.SysError(fmt.Sprintf("[openclaw-ws] Stream scanner error: %v", scanErr))
	}

	render.Done(c)

	// 将 reasoning_content 和 response_content 存储到上下文中，以便后续保存到数据库
	if reasoningText != "" {
		c.Set("openclaw_ws_reasoning_content", reasoningText)
	}
	if responseText != "" {
		c.Set("openclaw_ws_response_content", responseText)
	}

	usage := &relay_model.Usage{
		PromptTokens:     0,
		CompletionTokens: countOpenClawWSTokens(responseText+reasoningText, modelName),
		TotalTokens:      0,
	}

	return usage, nil
}

func wrapOpenClawStreamError(streamErr *StreamError) *relay_model.ErrorWithStatusCode {
	if streamErr == nil {
		return openai.ErrorWrapper(fmt.Errorf("OpenClaw 响应失败"), "openclaw_stream_error", http.StatusBadGateway)
	}
	code := strings.TrimSpace(streamErr.Code)
	if code == "" {
		code = "openclaw_stream_error"
	}
	message := strings.TrimSpace(streamErr.Message)
	if message == "" {
		message = "OpenClaw 响应失败"
	}
	return openai.ErrorWrapper(fmt.Errorf("%s", message), code, http.StatusBadGateway)
}

func countOpenClawWSTokens(text string, modelName string) (tokens int) {
	if text == "" {
		return 0
	}
	if strings.TrimSpace(modelName) == "" {
		modelName = "gpt-3.5-turbo"
	}
	defer func() {
		if recovered := recover(); recovered != nil {
			logger.SysErrorf("[openclaw-ws] token count panic: model=%s err=%v", modelName, recovered)
			tokens = 0
		}
	}()
	return openai.CountTokenText(text, modelName)
}

func addOpenClawStreamMetadata(response map[string]interface{}, status string, mode string, replace *bool, eventKind string) {
	if status != "" {
		response["status"] = status
	}
	if mode != "" {
		response["mode"] = mode
	}
	if replace != nil {
		response["replace"] = *replace
	}
	if eventKind != "" {
		response["event_kind"] = eventKind
	}
}

func addOpenClawStreamPayload(response map[string]interface{}, payload json.RawMessage) {
	if len(payload) > 0 && string(payload) != "null" {
		response["payload"] = payload
	}
}

type openClawWSStreamTrace struct {
	Context              context.Context
	AgentID              int64
	RequestID            string
	ModelName            string
	StartedAt            time.Time
	UpstreamChunkCount   int
	DownstreamChunkCount int
	ProcessStepCount     int
	ReasoningChunkCount  int
	ContentChunkCount    int
	ErrorCount           int
	StatusCounts         map[string]int
	EventKindCounts      map[string]int
	ObjectCounts         map[string]int
	LastSessionID        string
	LastConversationID   string
	ContentLength        int
	ReasoningLength      int
}

func newOpenClawWSStreamTrace(c *gin.Context, modelName string) *openClawWSStreamTrace {
	control := currentOpenClawWSRequestControl(c)
	return &openClawWSStreamTrace{
		Context:         openClawWSRequestContext(c),
		AgentID:         openClawWSAgentID(c),
		RequestID:       openClawWSRequestID(control),
		ModelName:       modelName,
		StartedAt:       time.Now(),
		StatusCounts:    map[string]int{},
		EventKindCounts: map[string]int{},
		ObjectCounts:    map[string]int{},
	}
}

func (t *openClawWSStreamTrace) Observe(label string, payload map[string]interface{}) {
	if t == nil {
		return
	}
	summary := summarizeOpenClawRawStreamPayload(payload)
	if strings.Contains(label, ".upstream.") {
		t.UpstreamChunkCount += 1
	} else {
		t.DownstreamChunkCount += 1
	}
	status := stringValue(summary["status"])
	if status != "" {
		t.StatusCounts[status]++
	}
	eventKind := stringValue(summary["event_kind"])
	if eventKind != "" {
		t.EventKindCounts[eventKind]++
	}
	object := stringValue(summary["object"])
	if object != "" {
		t.ObjectCounts[object]++
		if object == "process.step" {
			t.ProcessStepCount += 1
		}
	}
	if length, ok := summary["content_length"].(int); ok {
		t.ContentLength += length
		if length > 0 {
			t.ContentChunkCount += 1
		}
	}
	if length, ok := summary["reasoning_length"].(int); ok {
		t.ReasoningLength += length
		if length > 0 {
			t.ReasoningChunkCount += 1
		}
	}
	if sessionID := stringValue(summary["session_id"]); sessionID != "" {
		t.LastSessionID = sessionID
	}
	if conversationID := stringValue(summary["conversation_id"]); conversationID != "" {
		t.LastConversationID = conversationID
	}

	summary["agent_id"] = t.AgentID
	summary["req_id"] = t.RequestID
	summary["model_name"] = t.ModelName
	logOpenClawStreamTrace(t.Context, label, summary)
}

func (t *openClawWSStreamTrace) Finish() {
	if t == nil {
		return
	}
	logOpenClawStreamTrace(t.Context, "backend.stream.summary", map[string]interface{}{
		"agent_id":                  t.AgentID,
		"req_id":                    t.RequestID,
		"model_name":                t.ModelName,
		"duration_ms":               time.Since(t.StartedAt).Milliseconds(),
		"upstream_chunk_count":      t.UpstreamChunkCount,
		"downstream_chunk_count":    t.DownstreamChunkCount,
		"process_step_count":        t.ProcessStepCount,
		"reasoning_chunk_count":     t.ReasoningChunkCount,
		"content_chunk_count":       t.ContentChunkCount,
		"error_count":               t.ErrorCount,
		"status_counts":             t.StatusCounts,
		"event_kind_counts":         t.EventKindCounts,
		"object_counts":             t.ObjectCounts,
		"last_session_id_hash":      shortOpenClawTraceHash(t.LastSessionID),
		"last_conversation_id_hash": shortOpenClawTraceHash(t.LastConversationID),
		"content_length":            t.ContentLength,
		"reasoning_length":          t.ReasoningLength,
	})
}

func currentOpenClawWSRequestControl(c *gin.Context) *openClawWSRequestControl {
	if c == nil {
		return nil
	}
	value, exists := c.Get(openClawWSRequestControlKey)
	if !exists {
		return nil
	}
	control, _ := value.(*openClawWSRequestControl)
	return control
}

func openClawWSRequestID(control *openClawWSRequestControl) string {
	if control == nil {
		return ""
	}
	return control.reqID
}

func openClawWSAgentID(c *gin.Context) int64 {
	if c == nil {
		return 0
	}
	value, exists := c.Get(session.SESSION_AGENT)
	if !exists {
		return 0
	}
	agent, ok := value.(*model.Agent)
	if !ok || agent == nil {
		return 0
	}
	return agent.AgentID
}

func openClawStreamTraceEnabled() bool {
	value := strings.ToLower(strings.TrimSpace(os.Getenv("OPENCLAW_TRACE_STREAM")))
	if value == "" {
		value = strings.ToLower(strings.TrimSpace(os.Getenv("OPENCLAW_DIAG_LOGS")))
	}
	return value == "1" || value == "true" || value == "yes"
}

func logOpenClawStreamTrace(ctx context.Context, label string, payload map[string]interface{}) {
	if !openClawStreamTraceEnabled() {
		return
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		logger.Infof(ctx, "[openclaw-stream-trace] %s {}", label)
		return
	}
	logger.Infof(ctx, "[openclaw-stream-trace] %s %s", label, string(raw))
}

func openClawDuplicateTraceEnabled() bool {
	value := strings.ToLower(strings.TrimSpace(os.Getenv("OPENCLAW_TRACE_DUPLICATES")))
	if value == "" {
		value = strings.ToLower(strings.TrimSpace(os.Getenv("OPENCLAW_DIAG_LOGS")))
	}
	return value == "1" || value == "true" || value == "yes"
}

func logOpenClawDuplicateTrace(ctx context.Context, label string, payload map[string]interface{}) {
	if !openClawDuplicateTraceEnabled() {
		return
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		logger.Infof(ctx, "[openclaw-dup-trace] %s {}", label)
		return
	}
	logger.Infof(ctx, "[openclaw-dup-trace] %s %s", label, string(raw))
}

func openClawWSRequestContext(c *gin.Context) context.Context {
	if c != nil && c.Request != nil {
		return c.Request.Context()
	}
	return context.Background()
}

func summarizeOpenClawRawStreamPayload(payload map[string]interface{}) map[string]interface{} {
	if payload == nil {
		return map[string]interface{}{}
	}
	choice := firstOpenClawChoice(payload)
	delta := mapValue(choice["delta"])
	innerPayload := mapValue(payload["payload"])
	timeline := mapValue(innerPayload["openclaw_timeline"])
	content := stringValue(delta["content"])
	reasoning := stringValue(delta["reasoning_content"])
	return map[string]interface{}{
		"id":               stringValue(payload["id"]),
		"object":           stringValue(payload["object"]),
		"status":           stringValue(payload["status"]),
		"event_kind":       stringValue(payload["event_kind"]),
		"mode":             stringValue(payload["mode"]),
		"replace":          payload["replace"],
		"session_id":       stringValue(payload["session_id"]),
		"conversation_id":  stringValue(payload["conversation_id"]),
		"finish_reason":    stringValue(choice["finish_reason"]),
		"payload_seq":      innerPayload["seq"],
		"payload_rawSeq":   innerPayload["rawSeq"],
		"payload_runId":    stringValue(innerPayload["runId"]),
		"payload_state":    stringValue(innerPayload["state"]),
		"segment_id":       stringValue(firstNonEmpty(timeline["segment_id"], innerPayload["segment_id"])),
		"segment_type":     stringValue(firstNonEmpty(timeline["segment_type"], innerPayload["segment_type"])),
		"delta_index":      firstNonEmpty(timeline["delta_index"], innerPayload["delta_index"]),
		"visibility":       firstNonEmpty(timeline["visibility"], innerPayload["visibility"]),
		"final":            firstNonEmpty(timeline["final"], innerPayload["final"]),
		"content_length":   len(content),
		"content_hash":     shortOpenClawTraceHash(content),
		"reasoning_length": len(reasoning),
		"reasoning_hash":   shortOpenClawTraceHash(reasoning),
		"has_error":        payload["error"] != nil,
	}
}

func firstOpenClawChoice(payload map[string]interface{}) map[string]interface{} {
	choices, ok := payload["choices"].([]interface{})
	if !ok || len(choices) == 0 {
		return map[string]interface{}{}
	}
	return mapValue(choices[0])
}

func mapValue(value interface{}) map[string]interface{} {
	if mapped, ok := value.(map[string]interface{}); ok {
		return mapped
	}
	if raw, ok := value.(json.RawMessage); ok && len(raw) > 0 && string(raw) != "null" {
		var decoded map[string]interface{}
		if err := json.Unmarshal(raw, &decoded); err == nil {
			return decoded
		}
	}
	return map[string]interface{}{}
}

func firstNonEmpty(values ...interface{}) interface{} {
	for _, value := range values {
		if stringValue(value) != "" {
			return value
		}
	}
	return nil
}

func shortOpenClawTraceHash(text string) string {
	if text == "" {
		return ""
	}
	sum := md5.Sum([]byte(text))
	return fmt.Sprintf("%x", sum)[:12]
}

func normalizeOpenClawWSProcessStep(c *gin.Context, response map[string]interface{}) map[string]interface{} {
	processStep, ok := response["process_step"].(map[string]interface{})
	if !ok {
		return response
	}
	stepCode, _ := processStep["step_code"].(string)
	if stepCode != "output_files" {
		return response
	}

	data, ok := processStep["data"].(map[string]interface{})
	if !ok {
		data = map[string]interface{}{}
		processStep["data"] = data
	}
	files := normalizeOpenClawWSOutputFiles(c, data["files"])
	if len(files) == 0 {
		files = normalizeOpenClawWSOutputFiles(c, data["media_attachments"])
	}
	data["files"] = files
	data["contract_version"] = "v1"
	data["media_attachments"] = buildOpenClawWSMediaAttachments(files)
	data["media_contract_version"] = "v1"
	processStep["status"] = "completed"
	if _, ok := processStep["name"].(string); !ok {
		processStep["name"] = "生成文件"
	}
	if _, ok := processStep["message"].(string); !ok {
		processStep["message"] = fmt.Sprintf("生成了 %d 个文件", len(files))
	}
	if _, ok := processStep["timestamp"].(float64); !ok {
		processStep["timestamp"] = time.Now().Unix()
	}
	return response
}

func normalizeOpenClawWSOutputFiles(c *gin.Context, value interface{}) []map[string]interface{} {
	rawFiles, ok := value.([]interface{})
	if !ok {
		if single, singleOk := value.(map[string]interface{}); singleOk {
			rawFiles = []interface{}{single}
		} else {
			return nil
		}
	}
	files := make([]map[string]interface{}, 0, len(rawFiles))
	seen := map[string]bool{}
	for _, rawFile := range rawFiles {
		file, ok := rawFile.(map[string]interface{})
		if !ok {
			continue
		}
		normalized := normalizeOpenClawWSOutputFile(c, file)
		if len(normalized) == 0 {
			continue
		}
		key := strings.Join([]string{
			readOpenClawWSString(normalized, "id"),
			readOpenClawWSString(normalized, "url"),
			readOpenClawWSString(normalized, "file_name"),
		}, "|")
		if key != "||" && seen[key] {
			continue
		}
		seen[key] = true
		files = append(files, normalized)
	}
	return files
}

func normalizeOpenClawWSOutputFile(c *gin.Context, file map[string]interface{}) map[string]interface{} {
	fileName := firstOpenClawWSString(file, "file_name", "fileName", "filename", "name", "path", "title")
	urlValue := firstOpenClawWSString(file, "url", "href", "download_url", "downloadUrl", "file_url", "fileUrl", "signed_url")
	base64Value := firstOpenClawWSString(file, "base64")
	contentValue := firstOpenClawWSString(file, "content", "data")
	mimeType := firstOpenClawWSString(file, "mime_type", "mimeType", "mime", "content_type", "contentType")

	if fileName == "" {
		fileName = inferOpenClawWSFileNameFromURL(urlValue)
	}
	if fileName == "" {
		fileName = "file"
	}
	if mimeType == "" {
		mimeType = mime.TypeByExtension(path.Ext(fileName))
	}
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}

	if base64Value != "" || (contentValue != "" && urlValue == "") {
		if savedFile := saveOpenClawWSGeneratedFile(c, fileName, mimeType, base64Value, contentValue); savedFile != nil {
			return buildOpenClawWSOutputFileItem(savedFile)
		}
	}

	if urlValue == "" {
		return nil
	}
	id := firstOpenClawWSString(file, "id", "file_id", "fileId", "upload_file_id", "uploadFileId")
	if id == "" {
		id = urlValue
	}
	normalized := map[string]interface{}{
		"id":        id,
		"file_name": fileName,
		"url":       urlValue,
		"mime_type": mimeType,
	}
	if size, ok := readOpenClawWSNumber(file, "size", "file_size", "fileSize", "bytes"); ok {
		normalized["size"] = size
	}
	return normalized
}

func saveOpenClawWSGeneratedFile(c *gin.Context, fileName string, mimeType string, base64Value string, contentValue string) *model.UploadFile {
	contentBytes, err := decodeOpenClawWSGeneratedFile(base64Value, contentValue)
	if err != nil {
		logger.SysError(fmt.Sprintf("[openclaw-ws] Failed to decode generated file %s: %v", fileName, err))
		return nil
	}
	eid := config.GetEID(c)
	userID := config.GetUserId(c)
	messageID := getOpenClawWSMessageID(c)
	storageKey := model.GetAIGeneratedUploadFileKey(fileName, eid, userID, messageID)
	if err := storage.StorageInstance.Save(contentBytes, storageKey); err != nil {
		logger.SysError(fmt.Sprintf("[openclaw-ws] Failed to save generated file %s: %v", fileName, err))
		return nil
	}
	hash := fmt.Sprintf("%x", md5.Sum(contentBytes))
	uploadFile := &model.UploadFile{
		MessageID:  messageID,
		SourceType: model.UploadFileSourceAIGenerated,
		FileName:   fileName,
		Key:        storageKey,
		Eid:        eid,
		UserID:     userID,
		Size:       int64(len(contentBytes)),
		Extension:  strings.TrimPrefix(path.Ext(fileName), "."),
		MimeType:   mimeType,
		Hash:       hash,
		Status:     model.UploadStatusCompleted,
	}
	if err := model.CreateAIUploadFile(uploadFile); err != nil {
		logger.SysError(fmt.Sprintf("[openclaw-ws] Failed to create generated file record %s: %v", fileName, err))
		return nil
	}
	return uploadFile
}

func decodeOpenClawWSGeneratedFile(base64Value string, contentValue string) ([]byte, error) {
	if strings.TrimSpace(base64Value) == "" {
		return []byte(contentValue), nil
	}
	raw := strings.TrimSpace(base64Value)
	if comma := strings.Index(raw, ","); strings.HasPrefix(raw, "data:") && comma >= 0 {
		raw = raw[comma+1:]
	}
	return base64.StdEncoding.DecodeString(raw)
}

func getOpenClawWSMessageID(c *gin.Context) int64 {
	value, exists := c.Get("agent_master_message_id")
	if !exists {
		return 0
	}
	switch v := value.(type) {
	case int64:
		return v
	case int:
		return int64(v)
	case float64:
		return int64(v)
	case string:
		parsed, _ := strconv.ParseInt(v, 10, 64)
		return parsed
	default:
		return 0
	}
}

func buildOpenClawWSOutputFileItem(uploadFile *model.UploadFile) map[string]interface{} {
	fileIDHash, _ := hashids.Encode(uploadFile.ID)
	messageIDHash, _ := hashids.Encode(uploadFile.MessageID)
	if fileIDHash == "" {
		fileIDHash = strconv.FormatInt(uploadFile.ID, 10)
	}
	if messageIDHash == "" {
		messageIDHash = strconv.FormatInt(uploadFile.MessageID, 10)
	}
	return map[string]interface{}{
		"id":                  fileIDHash,
		"file_name":           uploadFile.FileName,
		"url":                 uploadFile.GetAISignedDownloadURL(168 * time.Hour),
		"download_url":        uploadFile.GetAIDownloadURL(),
		"signed_download_url": uploadFile.GetAISignedDownloadURL(168 * time.Hour),
		"mime_type":           uploadFile.MimeType,
		"size":                uploadFile.Size,
		"message_id":          messageIDHash,
		"source_kind":         "ai_generated",
	}
}

func buildOpenClawWSMediaAttachments(files []map[string]interface{}) []map[string]interface{} {
	if len(files) == 0 {
		return nil
	}
	attachments := make([]map[string]interface{}, 0, len(files))
	for _, file := range files {
		item := make(map[string]interface{}, len(file)+1)
		for key, value := range file {
			item[key] = value
		}
		item["kind"] = resolveOpenClawWSMediaKind(readOpenClawWSString(file, "mime_type"), readOpenClawWSString(file, "file_name"))
		attachments = append(attachments, item)
	}
	return attachments
}

func resolveOpenClawWSMediaKind(mimeType string, fileName string) string {
	lower := strings.ToLower(strings.TrimSpace(mimeType))
	switch {
	case strings.HasPrefix(lower, "image/"):
		return "image"
	case strings.HasPrefix(lower, "audio/"):
		return "audio"
	case strings.HasPrefix(lower, "video/"):
		return "video"
	case strings.HasPrefix(lower, "text/"):
		return "text"
	}
	switch strings.ToLower(strings.TrimPrefix(path.Ext(fileName), ".")) {
	case "png", "jpg", "jpeg", "gif", "webp", "svg":
		return "image"
	case "mp3", "wav", "m4a", "ogg":
		return "audio"
	case "mp4", "mov", "webm":
		return "video"
	case "txt", "md", "csv", "json", "log":
		return "text"
	default:
		return "file"
	}
}

func firstOpenClawWSString(file map[string]interface{}, keys ...string) string {
	for _, key := range keys {
		if value := readOpenClawWSString(file, key); value != "" {
			return value
		}
	}
	return ""
}

func readOpenClawWSString(file map[string]interface{}, key string) string {
	value, ok := file[key]
	if !ok {
		return ""
	}
	if raw, ok := value.(string); ok {
		return strings.TrimSpace(raw)
	}
	return ""
}

func readOpenClawWSNumber(file map[string]interface{}, keys ...string) (int64, bool) {
	for _, key := range keys {
		value, ok := file[key]
		if !ok {
			continue
		}
		switch v := value.(type) {
		case int64:
			return v, true
		case int:
			return int64(v), true
		case float64:
			return int64(v), true
		case string:
			parsed, err := strconv.ParseInt(strings.TrimSpace(v), 10, 64)
			if err == nil {
				return parsed, true
			}
		}
	}
	return 0, false
}

func inferOpenClawWSFileNameFromURL(rawURL string) string {
	if rawURL == "" {
		return ""
	}
	candidate := strings.Split(rawURL, "?")[0]
	return path.Base(candidate)
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
