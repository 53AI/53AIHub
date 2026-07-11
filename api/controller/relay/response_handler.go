package relay

import (
	"bytes"
	"crypto/md5"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/ctxkey"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/gin-gonic/gin"
)

const compactChatDeltaFlushChars = 64
const compactChatDeltaFlushWindow = 100 * time.Millisecond
const repeatedContentDeltaMaxPasses = 4
const repeatedContentDeltaMaxChars = 32

// GetResponseContent 获取响应内容
func GetResponseContent(c *gin.Context, isStream bool, resp *http.Response) (string, string) {
	// 检查上下文是否有腾讯云响应内容
	if tencentContent, exists := c.Get("tencent_response_content"); exists {
		if content, ok := tencentContent.(string); ok {
			return content, "" // 腾讯云响应通常不包含推理内容
		}
	}

	// 检查 openclaw_ws 的响应内容
	if openclawContent, exists := c.Get("openclaw_ws_response_content"); exists {
		if content, ok := openclawContent.(string); ok {
			// 同时检查是否有 reasoning_content
			reasoningContent := ""
			if reasoning, exists := c.Get("openclaw_ws_reasoning_content"); exists {
				if r, ok := reasoning.(string); ok {
					reasoningContent = r
				}
			}
			return content, reasoningContent
		}
	}

	if resp == nil {
		return "", ""
	}

	if !isStream {
		respBody, err := io.ReadAll(resp.Body)
		if err != nil {
			logger.Errorf(c.Request.Context(), "read response body failed: %s", err.Error())
			return "", ""
		}
		// 重置响应体，以便后续处理
		resp.Body = io.NopCloser(bytes.NewBuffer(respBody))

		// 尝试解析不同格式的响应内容
		var openaiResp struct {
			Choices []struct {
				Message struct {
					Content string `json:"content"`
				} `json:"message"`
				Text             string `json:"text"`
				ReasoningContent string `json:"reasoning_content"`
			} `json:"choices"`
			Text             string `json:"text"`
			ReasoningContent string `json:"reasoning_content"`
		}

		if err := json.Unmarshal(respBody, &openaiResp); err != nil {
			logger.Errorf(c.Request.Context(), "unmarshal response failed: %s", err.Error())
			return string(respBody), ""
		}

		// 优先检查 message.content (chat completions)
		if len(openaiResp.Choices) > 0 {
			if openaiResp.Choices[0].Message.Content != "" {
				return openaiResp.Choices[0].Message.Content, openaiResp.Choices[0].ReasoningContent
			}
			if openaiResp.Choices[0].Text != "" {
				return openaiResp.Choices[0].Text, openaiResp.Choices[0].ReasoningContent
			}
			if openaiResp.Choices[0].ReasoningContent != "" {
				return "", openaiResp.Choices[0].ReasoningContent
			}
		}
		if openaiResp.Text != "" {
			return openaiResp.Text, openaiResp.ReasoningContent
		}
		if openaiResp.ReasoningContent != "" {
			return "", openaiResp.ReasoningContent
		}
		return string(respBody), ""
	}

	// 对于流式响应，从上下文中获取收集器
	collector, exists := c.Get("stream_response_collector")
	if exists {
		if streamCollector, ok := collector.(*StreamResponseCollector); ok {
			return streamCollector.GetContent()
		}
	}

	return "", ""
}

// StreamResponseCollector 用于收集流式响应
type StreamResponseCollector struct {
	content          strings.Builder
	reasoningContent strings.Builder
	c                *gin.Context
	contentDeltas    []string
}

func NewStreamResponseCollector(c *gin.Context) *StreamResponseCollector {
	return &StreamResponseCollector{
		content:          strings.Builder{},
		reasoningContent: strings.Builder{},
		c:                c,
	}
}

func (c *StreamResponseCollector) Collect(chunk []byte) {
	data := string(chunk)
	lines := strings.Split(data, "\n")

	for _, line := range lines {
		if strings.HasPrefix(line, "data: ") {
			dataContent := strings.TrimPrefix(line, "data: ")
			if dataContent == "[DONE]" {
				continue
			}

			var streamResp struct {
				Choices []struct {
					Delta struct {
						Content          *string `json:"content"`
						ReasoningContent *string `json:"reasoning_content"`
					} `json:"delta"`
				} `json:"choices"`
			}

			if err := json.Unmarshal([]byte(dataContent), &streamResp); err == nil {
				if len(streamResp.Choices) > 0 {
					delta := streamResp.Choices[0].Delta
					if delta.Content != nil && *delta.Content != "" {
						c.content.WriteString(*delta.Content)
						c.contentDeltas = append(c.contentDeltas, *delta.Content)
					}
					if delta.ReasoningContent != nil && *delta.ReasoningContent != "" {
						c.reasoningContent.WriteString(*delta.ReasoningContent)
					}
				}
			}
		}
	}
}

func (c *StreamResponseCollector) GetContent() (string, string) {
	if len(c.contentDeltas) > 0 {
		return collapseRepeatedContentDeltas(c.contentDeltas), c.reasoningContent.String()
	}
	return c.content.String(), c.reasoningContent.String()
}

func collapseRepeatedContentDeltas(deltas []string) string {
	if len(deltas) == 0 {
		return ""
	}
	var out strings.Builder
	for i := 0; i < len(deltas); {
		current := deltas[i]
		run := 1
		for i+run < len(deltas) && deltas[i+run] == current {
			run++
		}
		if run >= repeatedContentDeltaMaxPasses && len([]rune(current)) <= repeatedContentDeltaMaxChars {
			out.WriteString(current)
		} else {
			for j := 0; j < run; j++ {
				out.WriteString(current)
			}
		}
		i += run
	}
	return out.String()
}

// StreamResponseInterceptor 用于拦截和收集流式响应
type StreamResponseInterceptor struct {
	gin.ResponseWriter
	collector *StreamResponseCollector
	c         *gin.Context
	sseBuffer strings.Builder
	deltaBuf  compactDeltaBuffer
}

type compactDeltaBuffer struct {
	content   strings.Builder
	reasoning strings.Builder
	lastFlush time.Time
}

// Write 实现 ResponseWriter 接口
func (w *StreamResponseInterceptor) Write(b []byte) (int, error) {
	if config.IsSSECompactMode() {
		return w.writeCompactSSE(b)
	}
	// 收集响应内容
	w.collector.Collect(b)
	// 同时转发给客户端；客户端断开时不能把 broken pipe 返回给上游 adaptor，
	// 否则 adaptor 会停止读取上游流，导致后端无法继续生成并拿不到 [DONE]/finish_reason。
	logOpenClawSSEInterceptorTrace(w.c, "relay.interceptor.write", b)
	if n, err := w.ResponseWriter.Write(b); err != nil {
		if w.c != nil {
			w.c.Set("relay_client_write_disconnected", true)
		}
		return n, nil
	}
	return len(b), nil
}

func openClawSSEInterceptorTraceEnabled() bool {
	value := strings.ToLower(strings.TrimSpace(os.Getenv("OPENCLAW_TRACE_DUPLICATES")))
	if value == "" {
		value = strings.ToLower(strings.TrimSpace(os.Getenv("OPENCLAW_DIAG_LOGS")))
	}
	return value == "1" || value == "true" || value == "yes"
}

func logOpenClawSSEInterceptorTrace(c *gin.Context, label string, chunk []byte) {
	if c == nil || c.Request == nil || !openClawSSEInterceptorTraceEnabled() {
		return
	}
	for _, summary := range summarizeOpenClawSSETraceChunk(chunk) {
		raw, err := json.Marshal(summary)
		if err != nil {
			logger.Infof(c.Request.Context(), "[openclaw-dup-trace] %s {}", label)
			continue
		}
		logger.Infof(c.Request.Context(), "[openclaw-dup-trace] %s %s", label, string(raw))
	}
}

func summarizeOpenClawSSETraceChunk(chunk []byte) []map[string]interface{} {
	text := strings.ReplaceAll(string(chunk), "\r\n", "\n")
	parts := strings.Split(text, "\n\n")
	summaries := make([]map[string]interface{}, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" || !strings.HasPrefix(part, "data:") {
			continue
		}
		data, isDone, ok := extractSSEDataContent([]byte(part + "\n\n"))
		if !ok {
			continue
		}
		if isDone {
			summaries = append(summaries, map[string]interface{}{"done": true})
			continue
		}
		var payload map[string]interface{}
		if err := json.Unmarshal([]byte(data), &payload); err != nil {
			summaries = append(summaries, map[string]interface{}{"parse_error": true, "length": len(data)})
			continue
		}
		summaries = append(summaries, summarizeOpenClawSSEPayloadForTrace(payload))
	}
	return summaries
}

func summarizeOpenClawSSEPayloadForTrace(payload map[string]interface{}) map[string]interface{} {
	choice := firstRelayTraceChoice(payload)
	delta := relayTraceMapValue(choice["delta"])
	innerPayload := relayTraceMapValue(payload["payload"])
	timeline := relayTraceMapValue(innerPayload["openclaw_timeline"])
	content := toString(delta["content"])
	reasoning := toString(delta["reasoning_content"])
	return map[string]interface{}{
		"id":               toString(payload["id"]),
		"object":           toString(payload["object"]),
		"status":           toString(payload["status"]),
		"event_kind":       toString(payload["event_kind"]),
		"mode":             toString(payload["mode"]),
		"replace":          payload["replace"],
		"session_id":       toString(payload["session_id"]),
		"conversation_id":  toString(payload["conversation_id"]),
		"finish_reason":    toString(choice["finish_reason"]),
		"payload_seq":      innerPayload["seq"],
		"payload_rawSeq":   innerPayload["rawSeq"],
		"payload_runId":    toString(innerPayload["runId"]),
		"payload_state":    toString(innerPayload["state"]),
		"segment_id":       toString(firstRelayTraceNonEmpty(timeline["segment_id"], innerPayload["segment_id"])),
		"segment_type":     toString(firstRelayTraceNonEmpty(timeline["segment_type"], innerPayload["segment_type"])),
		"delta_index":      firstRelayTraceNonEmpty(timeline["delta_index"], innerPayload["delta_index"]),
		"visibility":       firstRelayTraceNonEmpty(timeline["visibility"], innerPayload["visibility"]),
		"final":            firstRelayTraceNonEmpty(timeline["final"], innerPayload["final"]),
		"content_length":   len(content),
		"content_hash":     shortRelayTraceHash(content),
		"reasoning_length": len(reasoning),
		"reasoning_hash":   shortRelayTraceHash(reasoning),
	}
}

func firstRelayTraceChoice(payload map[string]interface{}) map[string]interface{} {
	choices, ok := payload["choices"].([]interface{})
	if !ok || len(choices) == 0 {
		return map[string]interface{}{}
	}
	return relayTraceMapValue(choices[0])
}

func relayTraceMapValue(value interface{}) map[string]interface{} {
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

func firstRelayTraceNonEmpty(values ...interface{}) interface{} {
	for _, value := range values {
		if toString(value) != "" {
			return value
		}
	}
	return nil
}

func shortRelayTraceHash(text string) string {
	if text == "" {
		return ""
	}
	sum := md5.Sum([]byte(text))
	return fmt.Sprintf("%x", sum)[:12]
}

func (w *StreamResponseInterceptor) writeCompactSSE(b []byte) (int, error) {
	w.sseBuffer.Write(b)
	normalized := strings.ReplaceAll(w.sseBuffer.String(), "\r\n", "\n")

	for {
		idx := strings.Index(normalized, "\n\n")
		if idx == -1 {
			break
		}
		event := normalized[:idx]
		normalized = normalized[idx+2:]
		out, hasOutput := w.sanitizeSSEEvent(event)
		if !hasOutput {
			continue
		}
		outs, err := w.handleCompactEventOutput(out)
		if err != nil {
			return len(b), err
		}
		for _, chunk := range outs {
			w.collector.Collect(chunk)
			logOpenClawSSEInterceptorTrace(w.c, "relay.interceptor.compact_write", chunk)
			if _, err := w.ResponseWriter.Write(chunk); err != nil {
				if w.c != nil {
					w.c.Set("relay_client_write_disconnected", true)
				}
			}
		}
	}

	if flushed := w.flushCompactDeltaBuffer(false); len(flushed) > 0 {
		w.collector.Collect(flushed)
		logOpenClawSSEInterceptorTrace(w.c, "relay.interceptor.compact_flush", flushed)
		if _, err := w.ResponseWriter.Write(flushed); err != nil {
			if w.c != nil {
				w.c.Set("relay_client_write_disconnected", true)
			}
		}
	}

	w.sseBuffer.Reset()
	if normalized != "" {
		w.sseBuffer.WriteString(normalized)
	}
	return len(b), nil
}

func (w *StreamResponseInterceptor) handleCompactEventOutput(out []byte) ([][]byte, error) {
	dataContent, isDone, ok := extractSSEDataContent(out)
	if !ok {
		return [][]byte{out}, nil
	}
	if isDone {
		result := make([][]byte, 0, 2)
		if flushed := w.flushCompactDeltaBuffer(true); len(flushed) > 0 {
			result = append(result, flushed)
		}
		result = append(result, out)
		return result, nil
	}

	var payload map[string]interface{}
	if err := json.Unmarshal([]byte(dataContent), &payload); err != nil {
		result := make([][]byte, 0, 2)
		if flushed := w.flushCompactDeltaBuffer(true); len(flushed) > 0 {
			result = append(result, flushed)
		}
		result = append(result, out)
		return result, nil
	}

	content, reasoning, canAggregate := canAggregateCompactChatPayload(payload)
	if !canAggregate {
		result := make([][]byte, 0, 2)
		if flushed := w.flushCompactDeltaBuffer(true); len(flushed) > 0 {
			result = append(result, flushed)
		}
		result = append(result, out)
		return result, nil
	}

	w.appendCompactDelta(content, reasoning)
	if flushed := w.flushCompactDeltaBuffer(false); len(flushed) > 0 {
		return [][]byte{flushed}, nil
	}
	return nil, nil
}

func extractSSEDataContent(out []byte) (string, bool, bool) {
	text := string(out)
	lines := strings.Split(text, "\n")
	dataLines := make([]string, 0, 1)
	for _, line := range lines {
		line = strings.TrimSuffix(line, "\r")
		if strings.HasPrefix(line, "data:") {
			payload := strings.TrimPrefix(line, "data:")
			payload = strings.TrimLeft(payload, " ")
			dataLines = append(dataLines, payload)
		}
	}
	if len(dataLines) == 0 {
		return "", false, false
	}
	dataContent := strings.Join(dataLines, "\n")
	if dataContent == "[DONE]" {
		return dataContent, true, true
	}
	return dataContent, false, true
}

func canAggregateCompactChatPayload(payload map[string]interface{}) (string, string, bool) {
	if payload == nil {
		return "", "", false
	}
	if payload["object"] == "process.step" {
		return "", "", false
	}
	if _, hasMessageID := payload["message_id"]; hasMessageID {
		return "", "", false
	}
	if hasOpenClawStreamMetadata(payload) {
		return "", "", false
	}

	choices, ok := payload["choices"].([]interface{})
	if !ok || len(choices) != 1 {
		return "", "", false
	}
	choice, ok := choices[0].(map[string]interface{})
	if !ok {
		return "", "", false
	}
	if finishReason, exists := choice["finish_reason"]; exists && strings.TrimSpace(toString(finishReason)) != "" {
		return "", "", false
	}
	for k := range choice {
		if k != "delta" && k != "index" {
			return "", "", false
		}
	}
	delta, ok := choice["delta"].(map[string]interface{})
	if !ok || len(delta) == 0 {
		return "", "", false
	}
	for k := range delta {
		if k != "content" && k != "reasoning_content" {
			return "", "", false
		}
	}

	content := toString(delta["content"])
	reasoning := toString(delta["reasoning_content"])
	if content == "" && reasoning == "" {
		return "", "", false
	}
	return content, reasoning, true
}

func hasOpenClawStreamMetadata(payload map[string]interface{}) bool {
	if payload == nil {
		return false
	}
	openClawKeys := []string{
		"event_kind",
		"session_id",
		"conversation_id",
		"payload",
		"mode",
		"replace",
	}
	for _, key := range openClawKeys {
		if _, ok := payload[key]; ok {
			return true
		}
	}
	return false
}

func (w *StreamResponseInterceptor) appendCompactDelta(content string, reasoning string) {
	if content != "" {
		w.deltaBuf.content.WriteString(content)
	}
	if reasoning != "" {
		w.deltaBuf.reasoning.WriteString(reasoning)
	}
	if w.deltaBuf.lastFlush.IsZero() {
		w.deltaBuf.lastFlush = time.Now()
	}
}

func (w *StreamResponseInterceptor) flushCompactDeltaBuffer(force bool) []byte {
	content := w.deltaBuf.content.String()
	reasoning := w.deltaBuf.reasoning.String()
	if content == "" && reasoning == "" {
		return nil
	}

	shouldFlush := force
	if !shouldFlush {
		total := len(content) + len(reasoning)
		if total >= compactChatDeltaFlushChars {
			shouldFlush = true
		}
		if !shouldFlush {
			last := w.deltaBuf.lastFlush
			if last.IsZero() || time.Since(last) >= compactChatDeltaFlushWindow {
				shouldFlush = true
			}
		}
	}
	if !shouldFlush {
		return nil
	}

	delta := map[string]interface{}{}
	if content != "" {
		delta["content"] = content
	}
	if reasoning != "" {
		delta["reasoning_content"] = reasoning
	}
	payload := map[string]interface{}{
		"choices": []map[string]interface{}{
			{
				"delta": delta,
			},
		},
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return nil
	}

	w.deltaBuf.content.Reset()
	w.deltaBuf.reasoning.Reset()
	w.deltaBuf.lastFlush = time.Now()
	return []byte("data: " + string(raw) + "\n\n")
}

func (w *StreamResponseInterceptor) sanitizeSSEEvent(event string) ([]byte, bool) {
	lines := strings.Split(event, "\n")
	var dataLines []string
	for _, line := range lines {
		line = strings.TrimSuffix(line, "\r")
		if strings.HasPrefix(line, "data:") {
			payload := strings.TrimPrefix(line, "data:")
			payload = strings.TrimLeft(payload, " ")
			dataLines = append(dataLines, payload)
		}
	}
	if len(dataLines) == 0 {
		return []byte(event + "\n\n"), true
	}

	dataContent := strings.Join(dataLines, "\n")
	if dataContent == "[DONE]" {
		if isInternalAgentStreamTurn(w.c) {
			// Internal agent-loop turns should not mark/defer the outer stream done state.
			// Pass through so the inner collector can finalize its buffers.
			return []byte("data: [DONE]\n\n"), true
		}
		if shouldDeferStreamDone(w.c) {
			w.c.Set("stream_response_done_deferred", true)
			return nil, false
		}
		if w.c != nil {
			markStreamDone(w.c)
		}
		return []byte("data: [DONE]\n\n"), true
	}

	var payload map[string]interface{}
	if err := json.Unmarshal([]byte(dataContent), &payload); err != nil {
		return []byte("data: " + dataContent + "\n\n"), true
	}
	if errPayload, ok := payload["error"].(map[string]interface{}); ok {
		enrichSSEErrorPayload(w.c, payload, errPayload)
		rebuilt, err := json.Marshal(payload)
		if err != nil {
			return []byte("data: " + dataContent + "\n\n"), true
		}
		return []byte("data: " + string(rebuilt) + "\n\n"), true
	}

	if payload["object"] != "chat.completion.chunk" {
		rebuilt, err := json.Marshal(payload)
		if err != nil {
			return []byte("data: " + dataContent + "\n\n"), true
		}
		return []byte("data: " + string(rebuilt) + "\n\n"), true
	}

	choices, hasChoices := payload["choices"].([]interface{})
	if hasChoices {
		if config.IsSSECompactMode() {
			choices = compactSanitizeChoices(choices)
			payload["choices"] = choices
		}
		if len(choices) == 0 {
			if _, hasMessageID := payload["message_id"]; !hasMessageID {
				return nil, false
			}
		} else if shouldDropCompactChatChunk(choices) {
			return nil, false
		}
	}

	if config.IsSSECompactMode() {
		delete(payload, "usage")
		delete(payload, "system_fingerprint")
		_, hasMessageID := payload["message_id"]
		if !hasMessageID && !hasFinalChatChunkFinishReason(choices) {
			delete(payload, "id")
			delete(payload, "created")
			delete(payload, "model")
			delete(payload, "object")
		}
	}

	rebuilt, err := json.Marshal(payload)
	if err != nil {
		return []byte("data: " + dataContent + "\n\n"), true
	}
	return []byte("data: " + string(rebuilt) + "\n\n"), true
}

func isInternalAgentStreamTurn(c *gin.Context) bool {
	if c == nil {
		return false
	}
	if value, ok := c.Get("agent_internal_stream_turn"); ok {
		if internal, ok := value.(bool); ok && internal {
			return true
		}
	}
	return false
}

func shouldDeferStreamDone(c *gin.Context) bool {
	if c == nil || !config.IsSSECompactMode() {
		return false
	}
	if isInternalAgentStreamTurn(c) {
		return false
	}
	if value, ok := c.Get("defer_stream_done"); ok {
		if enabled, ok := value.(bool); ok {
			return enabled
		}
	}
	return false
}

func markStreamDone(c *gin.Context) {
	if c == nil {
		return
	}
	c.Set("stream_response_done", true)
}

func flushDeferredStreamDone(c *gin.Context) {
	if c == nil {
		return
	}
	value, exists := c.Get("stream_response_done_deferred")
	if !exists {
		return
	}
	deferred, ok := value.(bool)
	if !ok || !deferred {
		return
	}
	if doneVal, doneExists := c.Get("stream_response_done"); doneExists {
		if done, ok := doneVal.(bool); ok && done {
			return
		}
	}
	writer := unwrapStreamResponseWriter(c.Writer)
	if _, err := writer.Write([]byte("data: [DONE]\n\n")); err != nil {
		logger.Warnf(c, "flush deferred [DONE] failed: %v", err)
		return
	}
	if flusher, ok := writer.(http.Flusher); ok {
		flusher.Flush()
	}
	markStreamDone(c)
	c.Set("stream_response_done_deferred", false)
}

func unwrapStreamResponseWriter(writer gin.ResponseWriter) gin.ResponseWriter {
	current := writer
	for {
		interceptor, ok := current.(*StreamResponseInterceptor)
		if !ok {
			return current
		}
		next, ok := interceptor.ResponseWriter.(gin.ResponseWriter)
		if !ok {
			return current
		}
		current = next
	}
}

func shouldDropCompactChatChunk(choices []interface{}) bool {
	for _, choiceAny := range choices {
		choice, ok := choiceAny.(map[string]interface{})
		if !ok {
			return false
		}

		if finishReason, ok := choice["finish_reason"]; ok && finishReason != nil && strings.TrimSpace(toString(finishReason)) != "" {
			return false
		}

		delta, ok := choice["delta"].(map[string]interface{})
		if !ok {
			return false
		}

		if toolCalls, exists := delta["tool_calls"]; exists {
			if arr, ok := toolCalls.([]interface{}); ok && len(arr) > 0 {
				return false
			}
		}

		content := strings.TrimSpace(toString(delta["content"]))
		reasoning := strings.TrimSpace(toString(delta["reasoning_content"]))
		role := strings.TrimSpace(toString(delta["role"]))
		if content != "" || reasoning != "" {
			return false
		}
		if role == "" {
			return false
		}
	}
	return true
}

func hasFinalChatChunkFinishReason(choices []interface{}) bool {
	for _, choiceAny := range choices {
		choice, ok := choiceAny.(map[string]interface{})
		if !ok {
			return false
		}
		finishReason, ok := choice["finish_reason"]
		if !ok || finishReason == nil {
			return false
		}
		if strings.TrimSpace(toString(finishReason)) == "" {
			return false
		}
	}
	return len(choices) > 0
}

func compactSanitizeChoices(choices []interface{}) []interface{} {
	sanitized := make([]interface{}, 0, len(choices))
	for _, choiceAny := range choices {
		choice, ok := choiceAny.(map[string]interface{})
		if !ok {
			sanitized = append(sanitized, choiceAny)
			continue
		}

		normalized := make(map[string]interface{}, len(choice))
		for k, v := range choice {
			normalized[k] = v
		}

		finishReason, finishExists := normalized["finish_reason"]
		hasFinish := false
		if finishExists && finishReason != nil && strings.TrimSpace(toString(finishReason)) != "" {
			hasFinish = true
		} else {
			delete(normalized, "finish_reason")
		}

		delta, ok := normalized["delta"].(map[string]interface{})
		if ok {
			cleanDelta := make(map[string]interface{}, len(delta))
			for k, v := range delta {
				cleanDelta[k] = v
			}
			if role := strings.TrimSpace(toString(cleanDelta["role"])); role == "assistant" {
				delete(cleanDelta, "role")
			}
			if strings.TrimSpace(toString(cleanDelta["reasoning_content"])) == "" {
				delete(cleanDelta, "reasoning_content")
			}
			if strings.TrimSpace(toString(cleanDelta["content"])) == "" {
				delete(cleanDelta, "content")
			}
			if len(cleanDelta) == 0 {
				delete(normalized, "delta")
			} else {
				normalized["delta"] = cleanDelta
			}
		}

		if _, hasDelta := normalized["delta"]; !hasDelta && !hasFinish {
			continue
		}
		sanitized = append(sanitized, normalized)
	}
	return sanitized
}

func enrichSSEErrorPayload(c *gin.Context, payload map[string]interface{}, errPayload map[string]interface{}) {
	if errPayload == nil {
		return
	}

	if modelName := resolveSSEErrorModel(c, payload); modelName != "" {
		errPayload["model"] = modelName
	}
	if channelName, channelType, channelID := resolveSSEErrorChannel(c); channelName != "" || channelType != 0 || channelID != "" {
		if channelName != "" {
			errPayload["channel_name"] = channelName
		}
		if channelType != 0 {
			errPayload["channel_type"] = channelType
		}
		if channelID != "" {
			errPayload["channel_id"] = channelID
		}
	}
}

func resolveSSEErrorModel(c *gin.Context, payload map[string]interface{}) string {
	if payload != nil {
		if modelName := strings.TrimSpace(toString(payload["model"])); modelName != "" {
			return modelName
		}
	}
	if c == nil {
		return ""
	}
	if v, ok := c.Get("agent_loop_request_model"); ok {
		if modelName := strings.TrimSpace(toString(v)); modelName != "" {
			return modelName
		}
	}
	if v, ok := c.Get(ctxkey.RequestModel); ok {
		if modelName := strings.TrimSpace(toString(v)); modelName != "" {
			return modelName
		}
	}
	return ""
}

func resolveSSEErrorChannel(c *gin.Context) (string, int, string) {
	if c == nil {
		return "", 0, ""
	}
	if v, ok := c.Get(ctxkey.SelectedChannel); ok {
		if ch, ok := v.(*model.Channel); ok && ch != nil {
			channelID := ""
			if encoded, err := hashids.Encode(ch.ChannelID); err == nil {
				channelID = encoded
			}
			return ch.Name, ch.Type, channelID
		}
	}
	name := ""
	if v, ok := c.Get(ctxkey.ChannelName); ok {
		name = strings.TrimSpace(toString(v))
	}
	channelType := 0
	if v, ok := c.Get(ctxkey.Channel); ok {
		switch t := v.(type) {
		case int:
			channelType = t
		case int32:
			channelType = int(t)
		case int64:
			channelType = int(t)
		case float64:
			channelType = int(t)
		}
	}
	return name, channelType, ""
}

func toString(v interface{}) string {
	switch t := v.(type) {
	case string:
		return t
	case nil:
		return ""
	default:
		b, _ := json.Marshal(t)
		return string(b)
	}
}

// WriteHeader 实现 ResponseWriter 接口
func (w *StreamResponseInterceptor) WriteHeader(statusCode int) {
	w.ResponseWriter.WriteHeader(statusCode)
}

// Flush 实现 Flusher 接口
func (w *StreamResponseInterceptor) Flush() {
	if flusher, ok := w.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

// SetupStreamInterceptor 设置流式响应拦截器
func SetupStreamInterceptor(c *gin.Context) *StreamResponseCollector {
	collector := NewStreamResponseCollector(c)
	c.Set("stream_response_collector", collector)

	// 创建并设置拦截器
	interceptor := &StreamResponseInterceptor{
		ResponseWriter: c.Writer,
		collector:      collector,
		c:              c,
	}
	c.Writer = interceptor

	return collector
}
