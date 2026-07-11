package relay

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/ctxkey"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/middleware"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/53AI/53AIHub/service/rag"
	"github.com/53AI/53AIHub/service/skill"
	"github.com/53AI/53AIHub/service/tools"
	"github.com/gin-gonic/gin"
	oneapi_common "github.com/songquanpeng/one-api/common"
	openai_model "github.com/songquanpeng/one-api/relay/adaptor/openai"
	relay_model "github.com/songquanpeng/one-api/relay/model"
)

// OpenAITextResponse defines the structure for OpenAI compatible text response
type OpenAITextResponse struct {
	Id      string `json:"id"`
	Object  string `json:"object"`
	Created int64  `json:"created"`
	Model   string `json:"model"`
	Choices []struct {
		Index        int                 `json:"index"`
		Message      relay_model.Message `json:"message"`
		FinishReason string              `json:"finish_reason"`
	} `json:"choices"`
	Usage relay_model.Usage `json:"usage"`
}

func extractReasoningContentFromOpenAIResponse(body []byte) string {
	if len(body) == 0 {
		return ""
	}

	var response struct {
		Choices []struct {
			Message struct {
				ReasoningContent string `json:"reasoning_content"`
			} `json:"message"`
			ReasoningContent string `json:"reasoning_content"`
		} `json:"choices"`
		ReasoningContent string `json:"reasoning_content"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return ""
	}

	if len(response.Choices) > 0 {
		if reasoning := strings.TrimSpace(response.Choices[0].Message.ReasoningContent); reasoning != "" {
			return reasoning
		}
		if reasoning := strings.TrimSpace(response.Choices[0].ReasoningContent); reasoning != "" {
			return reasoning
		}
	}
	return strings.TrimSpace(response.ReasoningContent)
}

const outputFilesContractVersion = "v1"
const mediaAttachmentsContractVersion = "v1"
const maxWriteFileArgsChars = 8192
const maxRecoverableWriteFileArgsChars = 256 * 1024
const maxRecoverableWriteFileContentChars = 200 * 1024
const maxToolRawArgsEchoChars = 3000
const sandboxSignedDownloadTTL = 168 * time.Hour
const compactLLMDeltaFlushChars = 96
const compactLLMDeltaFlushWindow = 300 * time.Millisecond
const compactToolLogDeltaFlushChars = 120
const compactToolLogDeltaFlushWindow = 80 * time.Millisecond
const compactToolResultMaxChars = 1200
const toolOutputDefaultMaxCharsForLLM = 4000
const contextPruneToolTriggerCount = 12
const contextPruneKeepRecentToolMsgs = 6
const contextPruneToolMaxChars = 12000
const contextPruneToolHeadChars = 7000
const contextPruneToolTailChars = 3000
const contextPruneHardClearTriggerCount = 20
const contextPruneHardClearKeepRecentToolMsgs = 10
const contextPruneHardClearPlaceholder = "[Old tool result content cleared]"

func shouldRetryRelayError(err *relay_model.ErrorWithStatusCode) bool {
	if err == nil {
		return false
	}

	switch err.StatusCode {
	case http.StatusRequestTimeout, http.StatusTooManyRequests:
		return true
	case http.StatusInternalServerError, http.StatusBadGateway, http.StatusServiceUnavailable, http.StatusGatewayTimeout:
		return true
	default:
		return false
	}
}

func appendAgentAssistantMessage(c *gin.Context, chatRequest *ChatRequest, message relay_model.Message, reasoningContent string) {
	if chatRequest == nil {
		return
	}
	chatRequest.Messages = append(chatRequest.Messages, message)
	if message.Role == "assistant" && strings.TrimSpace(reasoningContent) != "" {
		appendAssistantMessageExtra(c, countAssistantMessages(chatRequest.Messages)-1, map[string]interface{}{
			"reasoning_content": reasoningContent,
		})
	}
}

func hasStreamResponseStarted(c *gin.Context) bool {
	if c == nil {
		return false
	}
	if c.Writer != nil && c.Writer.Written() {
		return true
	}
	if doneAny, exists := c.Get("stream_response_done"); exists {
		if done, ok := doneAny.(bool); ok && done {
			return true
		}
	}
	content, reasoning := getCollectedStreamResponseContent(c)
	return strings.TrimSpace(content) != "" || strings.TrimSpace(reasoning) != ""
}

func getCollectedStreamResponseContent(c *gin.Context) (string, string) {
	if c == nil {
		return "", ""
	}
	if collectorAny, exists := c.Get("stream_response_collector"); exists {
		if collector, ok := collectorAny.(*StreamResponseCollector); ok && collector != nil {
			return collector.GetContent()
		}
	}
	return "", ""
}

func shouldRetryRelayWithContext(c *gin.Context, chatRequest *ChatRequest, err *relay_model.ErrorWithStatusCode) bool {
	if !shouldRetryRelayError(err) {
		return false
	}
	if chatRequest == nil || !chatRequest.Stream {
		return true
	}
	return !hasStreamResponseStarted(c)
}

func normalizeAIGeneratedSessionFolderSegment(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
	}

	replacer := strings.NewReplacer(
		"/", "-",
		"\\", "-",
		":", "-",
		"*", "-",
		"?", "-",
		"\"", "-",
		"<", "-",
		">", "-",
		"|", "-",
		"\t", " ",
		"\n", " ",
		"\r", " ",
	)
	trimmed = replacer.Replace(trimmed)
	trimmed = strings.Join(strings.Fields(trimmed), "-")
	trimmed = strings.Trim(trimmed, "-._")
	if trimmed == "" {
		return ""
	}

	runes := []rune(trimmed)
	const maxSegmentRunes = 80
	if len(runes) > maxSegmentRunes {
		trimmed = string(runes[:maxSegmentRunes])
		trimmed = strings.Trim(trimmed, "-._")
	}
	return trimmed
}

// LLMDeltaCollector collects streaming LLM output and emits llm_delta process steps.
// Intermediate turns should be rendered into process.step, but the final answer
// should stay in outer choices streaming. To avoid duplicating the same answer in
// both channels, we delay llm_delta emission until the turn is confirmed to be a
// non-final control turn (tool call / continue / rag / skill switch).
//
// Passthrough optimization: non-internal streams can switch to passthrough when
// the first content chunk arrives without tool_calls. Internal agent-loop turns
// keep plain content buffered because some models emit text before later tool_calls.
type LLMDeltaCollector struct {
	gin.ResponseWriter
	content                  strings.Builder
	reasoningContent         strings.Builder
	visibleContent           strings.Builder
	sseBuffer                strings.Builder
	toolCalls                map[int]*relay_model.Tool
	contentDeltas            []string
	pendingDeltas            map[string]*strings.Builder
	pendingLastFlush         map[string]time.Time
	contentSanitizer         *streamControlSanitizer
	requestId                string
	ctx                      context.Context
	c                        *gin.Context
	hasToolCall              bool
	decisionResolved         bool
	decisionValue            string
	shouldEmitLLMDelta       bool
	deferVisibleContentDelta bool
	passthroughMode          bool
	seenFirstContent         bool
	upstreamSeq              int64
	upstreamSawDone          bool
	upstreamLastFinishReason string

	// passthroughContent tracks content during passthrough mode for DB persistence
	passthroughContent          strings.Builder
	passthroughReasoningContent strings.Builder
	passthroughContentDeltas    []string
}

// NewLLMDeltaCollector creates a new collector that emits llm_delta events
func NewLLMDeltaCollector(c *gin.Context, ctx context.Context, requestId string) *LLMDeltaCollector {
	return &LLMDeltaCollector{
		ResponseWriter: c.Writer,
		content:        strings.Builder{},
		visibleContent: strings.Builder{},
		toolCalls:      make(map[int]*relay_model.Tool),
		pendingDeltas:  make(map[string]*strings.Builder),
		pendingLastFlush: map[string]time.Time{
			"content":   time.Now(),
			"reasoning": time.Now(),
		},
		contentSanitizer: newStreamControlSanitizer(),
		requestId:        requestId,
		ctx:              ctx,
		c:                c,
	}
}

// Write implements ResponseWriter interface.
// In passthrough mode, directly forwards SSE data to the underlying ResponseWriter.
// Otherwise, parses SSE and emits llm_delta for intermediate turns.
func (w *LLMDeltaCollector) Write(b []byte) (int, error) {
	if w.passthroughMode {
		if isInternalAgentStreamTurn(w.c) {
			return w.writeInternalPassthrough(b)
		}
		return w.writeExternalPassthrough(b)
	}
	w.sseBuffer.Write(b)
	buffer := strings.ReplaceAll(w.sseBuffer.String(), "\r\n", "\n")

	for {
		idx := strings.Index(buffer, "\n\n")
		if idx == -1 {
			break
		}
		event := buffer[:idx]
		buffer = buffer[idx+2:]
		w.processSSEEvent(event)
		if w.passthroughMode {
			buffer = strings.TrimLeft(buffer, "\n")
			if buffer != "" {
				if isInternalAgentStreamTurn(w.c) {
					_, _ = w.writeInternalPassthrough([]byte(buffer + "\n\n"))
				} else {
					_, _ = w.writeExternalPassthrough([]byte(buffer + "\n\n"))
				}
			}
			w.sseBuffer.Reset()
			return len(b), nil
		}
	}

	w.sseBuffer.Reset()
	if buffer != "" {
		w.sseBuffer.WriteString(buffer)
	}
	return len(b), nil
}

// writeExternalPassthrough forwards SSE bytes to the underlying writer for non-internal
// passthrough turns and also tracks the content into passthroughContent / passthroughContentDeltas.
// Without this tracking, mirrorAgentRunFinalResponse would persist an empty answer to
// agent_run_events and subscribe clients would see an empty final message.
func (w *LLMDeltaCollector) writeExternalPassthrough(b []byte) (int, error) {
	w.sseBuffer.Write(b)
	buffer := strings.ReplaceAll(w.sseBuffer.String(), "\r\n", "\n")

	for {
		idx := strings.Index(buffer, "\n\n")
		if idx == -1 {
			break
		}
		event := buffer[:idx]
		buffer = buffer[idx+2:]
		// External passthrough must forward every event (including [DONE]) to the client,
		// but only structured deltas should be tracked for DB persistence.
		if _, err := w.ResponseWriter.Write([]byte(event + "\n\n")); err != nil {
			return len(b), err
		}
		if isSSEDataDoneEvent(event) {
			w.upstreamSeq++
			w.upstreamSawDone = true
		} else {
			w.trackPassthroughContent(event)
		}
	}

	w.sseBuffer.Reset()
	if buffer != "" {
		w.sseBuffer.WriteString(buffer)
	}
	return len(b), nil
}

func (w *LLMDeltaCollector) writeInternalPassthrough(b []byte) (int, error) {
	w.sseBuffer.Write(b)
	buffer := strings.ReplaceAll(w.sseBuffer.String(), "\r\n", "\n")

	for {
		idx := strings.Index(buffer, "\n\n")
		if idx == -1 {
			break
		}
		event := buffer[:idx]
		buffer = buffer[idx+2:]
		if isSSEDataDoneEvent(event) {
			w.upstreamSeq++
			w.upstreamSawDone = true
			continue
		}
		if _, err := w.ResponseWriter.Write([]byte(event + "\n\n")); err != nil {
			return len(b), err
		}

		// Track content in passthrough mode for later DB persistence
		w.trackPassthroughContent(event)
	}

	w.sseBuffer.Reset()
	if buffer != "" {
		w.sseBuffer.WriteString(buffer)
	}
	return len(b), nil
}

// trackPassthroughContent parses an SSE data line during passthrough and buffers the content
func (w *LLMDeltaCollector) trackPassthroughContent(event string) {
	// Strip "data:" prefix if present
	dataLine := strings.TrimSpace(event)
	if strings.HasPrefix(dataLine, "data:") {
		dataLine = strings.TrimSpace(dataLine[5:])
	}
	if dataLine == "" || dataLine == "[DONE]" {
		return
	}
	w.upstreamSeq++

	// Parse the SSE JSON payload to extract delta content
	var payload struct {
		Choices []struct {
			Delta struct {
				Content          string `json:"content"`
				ReasoningContent string `json:"reasoning_content"`
			} `json:"delta"`
			FinishReason *string `json:"finish_reason"`
		} `json:"choices"`
	}
	if err := json.Unmarshal([]byte(dataLine), &payload); err != nil {
		return
	}
	if len(payload.Choices) == 0 {
		return
	}

	finishReason := ""
	if payload.Choices[0].FinishReason != nil {
		finishReason = *payload.Choices[0].FinishReason
		if finishReason != "" {
			w.upstreamLastFinishReason = finishReason
		}
	}
	delta := payload.Choices[0].Delta
	if delta.Content != "" {
		w.passthroughContent.WriteString(delta.Content)
		w.passthroughContentDeltas = append(w.passthroughContentDeltas, delta.Content)
	}
	if delta.ReasoningContent != "" {
		w.passthroughReasoningContent.WriteString(delta.ReasoningContent)
	}
}

func isSSEDataDoneEvent(event string) bool {
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
	return strings.Join(dataLines, "\n") == "[DONE]"
}

func (w *LLMDeltaCollector) processSSEEvent(event string) {
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
		return
	}
	dataContent := strings.Join(dataLines, "\n")
	w.upstreamSeq++
	if dataContent == "" || dataContent == "[DONE]" {
		if dataContent == "[DONE]" {
			w.upstreamSawDone = true
		}
		w.flushPendingDeltas(true)
		return
	}

	// 透传 process.step 类型的消息
	var genericPayload map[string]interface{}
	if err := json.Unmarshal([]byte(dataContent), &genericPayload); err == nil {
		if object, ok := genericPayload["object"].(string); ok && object == "process.step" {
			origWriter := w.c.Writer
			w.c.Writer = w.ResponseWriter
			_, writeErr := w.ResponseWriter.Write([]byte("data: " + dataContent + "\n\n"))
			w.c.Writer = origWriter
			if writeErr != nil {
				logger.Warnf(w.ctx, "Failed to pass through process.step: %v", writeErr)
			}
			return
		}
	}

	var streamResp struct {
		Choices []struct {
			FinishReason interface{} `json:"finish_reason"`
			Delta        struct {
				Content          *string `json:"content"`
				ReasoningContent *string `json:"reasoning_content"`
				ToolCalls        []struct {
					Index    *int   `json:"index"`
					Id       string `json:"id"`
					Type     string `json:"type"`
					Function struct {
						Name      string `json:"name"`
						Arguments string `json:"arguments"`
					} `json:"function"`
				} `json:"tool_calls"`
			} `json:"delta"`
		} `json:"choices"`
	}

	if err := json.Unmarshal([]byte(dataContent), &streamResp); err != nil {
		return
	}
	if len(streamResp.Choices) == 0 {
		return
	}
	finishReason := ""
	if streamResp.Choices[0].FinishReason != nil {
		finishReason = fmt.Sprintf("%v", streamResp.Choices[0].FinishReason)
		if finishReason != "" && finishReason != "<nil>" {
			w.upstreamLastFinishReason = finishReason
		}
	}
	delta := streamResp.Choices[0].Delta

	hasVisibleContent := delta.Content != nil && *delta.Content != ""
	hasReasoningContent := delta.ReasoningContent != nil && *delta.ReasoningContent != ""

	// 工具调用优先处理
	if len(delta.ToolCalls) > 0 {
		w.hasToolCall = true
		w.enableLLMDeltaIfNeeded("tool_calls")
		// 处理内容部分（可能有 tool_calls 和 content 同时出现）
		if delta.Content != nil && *delta.Content != "" {
			chunk := *delta.Content
			w.content.WriteString(chunk)
			w.resolveDecisionFromBufferedContent()
			if visible := w.contentSanitizer.Add(chunk); visible != "" {
				w.visibleContent.WriteString(visible)
				w.contentDeltas = append(w.contentDeltas, visible)
				if w.shouldEmitLLMDelta {
					w.queueLLMDelta(visible, "content")
				}
			}
		}
		if delta.ReasoningContent != nil && *delta.ReasoningContent != "" {
			w.reasoningContent.WriteString(*delta.ReasoningContent)
			if w.shouldEmitLLMDelta {
				w.queueLLMDelta(*delta.ReasoningContent, "reasoning")
			}
		}
		for _, tc := range delta.ToolCalls {
			idx := 0
			if tc.Index != nil {
				idx = *tc.Index
			}
			existing, ok := w.toolCalls[idx]
			if !ok {
				existing = &relay_model.Tool{Id: tc.Id, Type: tc.Type}
				w.toolCalls[idx] = existing
			}
			if tc.Id != "" {
				existing.Id = tc.Id
			}
			if tc.Type != "" {
				existing.Type = tc.Type
			}
			if tc.Function.Name != "" {
				existing.Function.Name = tc.Function.Name
			}
			if tc.Function.Arguments != "" {
				currentArgs := ""
				if existing.Function.Arguments != nil {
					if s, ok := existing.Function.Arguments.(string); ok {
						currentArgs = s
					}
				}
				existing.Function.Arguments = currentArgs + tc.Function.Arguments
			}
		}
		return
	}

	// 关键透传检测：第一个 content chunk 且没有 tool_calls -> 可能是最终回答
	// 但如果内容包含 <decision> 标签，可能是控制轮次，需要缓冲解析决策
	if !w.seenFirstContent && hasVisibleContent && !w.hasToolCall {
		contentChunk := *delta.Content
		// 检查是否包含决策标签前缀（可能需要等待完整标签）
		if w.shouldDelayPassthroughForDecision(contentChunk) {
			// 内容可能包含决策标签，不立即透传，继续缓冲
			w.seenFirstContent = true
			// 继续下面的常规内容处理
		} else if w.shouldPassthroughOnFirstContent(contentChunk) {
			w.seenFirstContent = true
			w.switchToPassthrough(dataContent)
			return
		} else {
			w.seenFirstContent = true
			if !isInternalAgentStreamTurn(w.c) {
				w.enableLLMDeltaIfNeeded("plain_stream")
			} else {
				w.deferVisibleContentDelta = true
			}
		}
	} else if !w.seenFirstContent && hasReasoningContent && !w.hasToolCall {
		w.enableLLMDeltaIfNeeded("internal_reasoning")
	}

	// 常规内容处理（已有 tool_call 或 llm_delta 已启用）
	if delta.Content != nil && *delta.Content != "" {
		chunk := *delta.Content
		w.content.WriteString(chunk)
		w.resolveDecisionFromBufferedContent()
		if visible := w.contentSanitizer.Add(chunk); visible != "" {
			w.visibleContent.WriteString(visible)
			w.contentDeltas = append(w.contentDeltas, visible)
			if w.shouldEmitLLMDelta && !w.deferVisibleContentDelta {
				w.queueLLMDelta(visible, "content")
			}
		}
	}
	if delta.ReasoningContent != nil && *delta.ReasoningContent != "" {
		w.reasoningContent.WriteString(*delta.ReasoningContent)
		if w.shouldEmitLLMDelta {
			w.queueLLMDelta(*delta.ReasoningContent, "reasoning")
		}
	}

	if w.decisionResolved && w.decisionValue != DecisionDone {
		w.enableLLMDeltaIfNeeded("decision")
	}
}

// emitLLMDelta sends a llm_delta process step to the client
func (w *LLMDeltaCollector) emitLLMDelta(content string, deltaType string) {
	step := ProcessStep{
		StepCode:  "llm_delta",
		Name:      "LLM 输出",
		Status:    "streaming",
		Message:   "",
		Data:      map[string]interface{}{"content": content, "type": deltaType},
		Timestamp: time.Now().Unix(),
	}
	// NOTE:
	// During intermediate streaming turns, c.Writer is replaced by this collector.
	// sendProcessStep writes to c.Writer, so we must temporarily swap back to the
	// underlying writer, otherwise the event will be recursively swallowed.
	origWriter := w.c.Writer
	w.c.Writer = w.ResponseWriter
	err := sendProcessStep(w.c, w.requestId, step)
	w.c.Writer = origWriter
	if err != nil {
		logger.Warnf(w.ctx, "Failed to send llm_delta step: %v", err)
	}
}

func (w *LLMDeltaCollector) queueLLMDelta(content string, deltaType string) {
	if content == "" {
		return
	}
	if !config.IsSSECompactMode() {
		w.emitLLMDelta(content, deltaType)
		return
	}
	builder, ok := w.pendingDeltas[deltaType]
	if !ok || builder == nil {
		builder = &strings.Builder{}
		w.pendingDeltas[deltaType] = builder
	}
	builder.WriteString(content)

	shouldFlush := builder.Len() >= compactLLMDeltaFlushChars
	if !shouldFlush {
		last := w.pendingLastFlush[deltaType]
		if last.IsZero() || time.Since(last) >= compactLLMDeltaFlushWindow {
			shouldFlush = true
		}
	}
	if shouldFlush {
		w.flushPendingDeltaType(deltaType)
	}
}

func (w *LLMDeltaCollector) flushPendingDeltaType(deltaType string) {
	builder := w.pendingDeltas[deltaType]
	if builder == nil || builder.Len() == 0 {
		return
	}
	payload := builder.String()
	builder.Reset()
	w.pendingLastFlush[deltaType] = time.Now()
	w.emitLLMDelta(payload, deltaType)
}

func (w *LLMDeltaCollector) flushPendingDeltas(force bool) {
	for deltaType, builder := range w.pendingDeltas {
		if builder == nil || builder.Len() == 0 {
			continue
		}
		if force {
			w.flushPendingDeltaType(deltaType)
			continue
		}
		last := w.pendingLastFlush[deltaType]
		if last.IsZero() || time.Since(last) >= compactLLMDeltaFlushWindow || builder.Len() >= compactLLMDeltaFlushChars {
			w.flushPendingDeltaType(deltaType)
		}
	}
}

func (w *LLMDeltaCollector) resolveDecisionFromBufferedContent() {
	if w.decisionResolved {
		return
	}
	event := ParseAgentControlEvent(w.content.String())
	if event == nil || event.Decision == nil {
		return
	}
	w.decisionResolved = true
	w.decisionValue = event.Decision.Decision
}

func (w *LLMDeltaCollector) enableLLMDeltaIfNeeded(trigger string) {
	flushDeferredContent := trigger == "tool_calls" || trigger == "decision"
	wasEnabled := w.shouldEmitLLMDelta
	shouldFlushVisible := (!wasEnabled && !w.deferVisibleContentDelta) || (flushDeferredContent && w.deferVisibleContentDelta)
	if flushDeferredContent {
		w.deferVisibleContentDelta = false
	}
	if !wasEnabled {
		w.shouldEmitLLMDelta = true
		w.pendingLastFlush["content"] = time.Time{}
		w.pendingLastFlush["reasoning"] = time.Time{}
	}
	if shouldFlushVisible && w.visibleContent.Len() > 0 {
		w.queueLLMDelta(w.visibleContent.String(), "content")
	}
	if !wasEnabled && w.reasoningContent.Len() > 0 {
		w.queueLLMDelta(w.reasoningContent.String(), "reasoning")
	}
	logger.Debugf(w.ctx,
		"【技能运行】启用 llm_delta: trigger=%s, decision=%s, has_tool_call=%v, content_len=%d, reasoning_len=%d",
		trigger, w.decisionValue, w.hasToolCall, w.visibleContent.Len(), w.reasoningContent.Len())
}

func (w *LLMDeltaCollector) switchToPassthrough(currentDataContent string) {
	if w.passthroughMode {
		return
	}
	w.passthroughMode = true
	logger.Debugf(w.ctx, "【技能运行】切换到透传模式: has_tool_call=%v, content_len=%d", w.hasToolCall, w.visibleContent.Len())
	SetUpStreamResponseHeaders(w.c)
	w.sseBuffer.Reset()
	if currentDataContent != "" {
		if sanitizedDataContent, ok := sanitizeDecisionPassthroughDataContent(currentDataContent); ok {
			w.ResponseWriter.Write([]byte("data: " + sanitizedDataContent + "\n\n"))
			// 切换那一拍的 chunk 也要 track 到 passthroughContent，否则首段会丢失，
			// 导致 mirrorAgentRunFinalResponse 写入的 answer 不完整。
			w.trackPassthroughContent("data: " + sanitizedDataContent)
		}
	}
	if flusher, ok := w.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
	w.content.Reset()
	w.reasoningContent.Reset()
	w.visibleContent.Reset()
	w.contentDeltas = nil
}

func sanitizeDecisionPassthroughDataContent(dataContent string) (string, bool) {
	var payload map[string]interface{}
	if err := json.Unmarshal([]byte(dataContent), &payload); err != nil {
		return dataContent, true
	}

	choices, ok := payload["choices"].([]interface{})
	if !ok {
		return dataContent, true
	}

	hasVisibleContent := false
	for _, choiceAny := range choices {
		choice, ok := choiceAny.(map[string]interface{})
		if !ok {
			continue
		}
		delta, ok := choice["delta"].(map[string]interface{})
		if !ok {
			continue
		}
		contentAny, exists := delta["content"]
		if !exists {
			continue
		}
		content := toString(contentAny)
		cleanContent := sanitizeFinalAssistantContent(content)
		if cleanContent == "" {
			delete(delta, "content")
			continue
		}
		delta["content"] = cleanContent
		hasVisibleContent = true
	}

	if !hasVisibleContent {
		return "", false
	}
	rebuilt, err := json.Marshal(payload)
	if err != nil {
		return dataContent, true
	}
	return string(rebuilt), true
}

func (w *LLMDeltaCollector) IsPassthrough() bool {
	return w.passthroughMode
}

func (w *LLMDeltaCollector) shouldDelayPassthroughForDecision(contentChunk string) bool {
	if !strings.Contains(contentChunk, "<decision>") && !strings.Contains(contentChunk, "decision>") {
		return false
	}
	startIdx := strings.Index(contentChunk, "<decision>")
	if startIdx == -1 {
		return true
	}
	endIdx := strings.Index(contentChunk, "</decision>")
	if endIdx == -1 {
		return true
	}
	decisionValue := strings.TrimSpace(contentChunk[startIdx+len("<decision>") : endIdx])
	if decisionValue == DecisionDone {
		return false
	}
	return true
}

func (w *LLMDeltaCollector) shouldPassthroughOnFirstContent(contentChunk string) bool {
	if !isInternalAgentStreamTurn(w.c) {
		return true
	}
	if isAgentAnsweringStreamPhase(w.c) {
		return true
	}
	return hasCompleteDoneDecision(contentChunk)
}

func isAgentAnsweringStreamPhase(c *gin.Context) bool {
	if c == nil {
		return false
	}
	if value, ok := c.Get(agentStreamPhaseContextKey); ok {
		phase, _ := value.(string)
		return phase == agentStreamPhaseAnswering
	}
	return false
}

func getAgentInitialStreamPhase(c *gin.Context) string {
	if c == nil {
		return agentStreamPhasePlanning
	}
	if value, ok := c.Get(agentInitialStreamPhaseContextKey); ok {
		phase, _ := value.(string)
		if phase == agentStreamPhaseAnswering {
			return agentStreamPhaseAnswering
		}
	}
	return agentStreamPhasePlanning
}

func hasCompleteDoneDecision(contentChunk string) bool {
	startIdx := strings.Index(contentChunk, "<decision>")
	if startIdx == -1 {
		return false
	}
	endIdx := strings.Index(contentChunk, "</decision>")
	if endIdx == -1 {
		return false
	}
	decisionValue := strings.TrimSpace(contentChunk[startIdx+len("<decision>") : endIdx])
	return decisionValue == DecisionDone
}

func (w *LLMDeltaCollector) drainResidualSSEBuffer() {
	if w.sseBuffer.Len() == 0 {
		return
	}
	remaining := strings.ReplaceAll(w.sseBuffer.String(), "\r\n", "\n")
	remaining = strings.TrimSpace(remaining)
	if remaining == "" {
		w.sseBuffer.Reset()
		return
	}
	// Be tolerant of upstream streams that end without trailing "\n\n".
	// Parsing once here avoids dropping the last delta chunk.
	w.processSSEEvent(remaining)
	w.sseBuffer.Reset()
}

func (w *LLMDeltaCollector) flushVisibleControlState() {
	if w.contentSanitizer == nil {
		return
	}
	if visible := w.contentSanitizer.Flush(); visible != "" {
		w.visibleContent.WriteString(visible)
		w.contentDeltas = append(w.contentDeltas, visible)
		if w.shouldEmitLLMDelta && !w.deferVisibleContentDelta {
			w.queueLLMDelta(visible, "content")
		}
	}
}

// GetContent returns the buffered content and assembled tool calls for parsing.
// GetContent returns the buffered content and assembled tool calls for parsing.
// In passthrough mode, returns empty values as content was forwarded directly.
func (w *LLMDeltaCollector) GetContent() (string, string, []relay_model.Tool) {
	if w.passthroughMode {
		return "", "", nil
	}
	w.drainResidualSSEBuffer()
	w.flushVisibleControlState()
	w.flushPendingDeltas(true)
	toolCalls := make([]relay_model.Tool, 0, len(w.toolCalls))
	if len(w.toolCalls) > 0 {
		keys := make([]int, 0, len(w.toolCalls))
		for idx := range w.toolCalls {
			keys = append(keys, idx)
		}
		sort.Ints(keys)
		for _, idx := range keys {
			toolCalls = append(toolCalls, *w.toolCalls[idx])
		}
	}
	content := w.content.String()
	reasoning := w.reasoningContent.String()
	return content, reasoning, toolCalls
}

func (w *LLMDeltaCollector) GetContentDeltas() []string {
	if w.passthroughMode || len(w.contentDeltas) == 0 {
		return nil
	}
	out := make([]string, len(w.contentDeltas))
	copy(out, w.contentDeltas)
	return out
}

// GetPassthroughContent returns the content tracked during passthrough mode.
// Returns empty when not in passthrough mode.
func (w *LLMDeltaCollector) GetPassthroughContent() (string, string) {
	if !w.passthroughMode {
		return "", ""
	}
	content := w.passthroughContent.String()
	reasoning := w.passthroughReasoningContent.String()
	return content, reasoning
}

// GetPassthroughContentDeltas returns the content deltas tracked during passthrough mode.
// Returns nil when not in passthrough mode.
func (w *LLMDeltaCollector) IsUpstreamComplete() bool {
	if w == nil {
		return false
	}
	return w.upstreamSawDone || strings.TrimSpace(w.upstreamLastFinishReason) != ""
}

func (w *LLMDeltaCollector) GetPassthroughContentDeltas() []string {
	if !w.passthroughMode || len(w.passthroughContentDeltas) == 0 {
		return nil
	}
	out := make([]string, len(w.passthroughContentDeltas))
	copy(out, w.passthroughContentDeltas)
	return out
}

type streamControlSanitizer struct {
	pending strings.Builder
}

func newStreamControlSanitizer() *streamControlSanitizer {
	return &streamControlSanitizer{}
}

func (s *streamControlSanitizer) Add(chunk string) string {
	if chunk == "" {
		return ""
	}
	s.pending.WriteString(chunk)
	return s.drain(false)
}

func (s *streamControlSanitizer) Flush() string {
	return s.drain(true)
}

func (s *streamControlSanitizer) drain(force bool) string {
	const startTag = "<decision>"
	const endTag = "</decision>"
	const decisionToken = "decision>"

	buffer := s.pending.String()
	if buffer == "" {
		return ""
	}

	var out strings.Builder
	for {
		startIdx := strings.Index(buffer, startTag)
		shortIdx := strings.Index(buffer, decisionToken)
		if startIdx == -1 && shortIdx != -1 {
			startIdx = shortIdx - 1
			if startIdx < 0 {
				startIdx = shortIdx
			}
		}
		if startIdx == -1 {
			if force {
				out.WriteString(buffer)
				buffer = ""
			} else {
				keep := longestDecisionTagPrefixSuffix(buffer)
				if keep == 0 {
					out.WriteString(buffer)
					buffer = ""
				} else if len(buffer) > keep {
					out.WriteString(buffer[:len(buffer)-keep])
					buffer = buffer[len(buffer)-keep:]
				}
			}
			break
		}

		if startIdx > 0 {
			out.WriteString(buffer[:startIdx])
		}
		buffer = buffer[startIdx:]
		endIdx := strings.Index(buffer, endTag)
		if endIdx == -1 {
			if force {
				buffer = ""
			}
			break
		}
		buffer = buffer[endIdx+len(endTag):]
	}

	s.pending.Reset()
	if buffer != "" {
		s.pending.WriteString(buffer)
	}
	return out.String()
}

func longestDecisionTagPrefixSuffix(buffer string) int {
	const startTag = "<decision>"
	const endTag = "</decision>"
	maxKeep := 0
	for _, tag := range []string{startTag, endTag} {
		limit := len(tag) - 1
		if limit > len(buffer) {
			limit = len(buffer)
		}
		for keep := 1; keep <= limit; keep++ {
			if strings.HasSuffix(buffer, tag[:keep]) && keep > maxKeep {
				maxKeep = keep
			}
		}
	}
	return maxKeep
}

type toolLogDeltaBuffer struct {
	Content   strings.Builder
	LastFlush time.Time
}

func getToolLogDeltaBuffers(c *gin.Context) map[string]*toolLogDeltaBuffer {
	if c == nil {
		return map[string]*toolLogDeltaBuffer{}
	}
	if value, ok := c.Get("tool_log_delta_buffers"); ok {
		if buffers, ok := value.(map[string]*toolLogDeltaBuffer); ok {
			return buffers
		}
	}
	buffers := make(map[string]*toolLogDeltaBuffer)
	c.Set("tool_log_delta_buffers", buffers)
	return buffers
}

func flushToolLogDeltaBuffer(c *gin.Context, requestId, key, toolCallId, functionName, streamType string, force bool) {
	if c == nil {
		return
	}
	buffers := getToolLogDeltaBuffers(c)
	buf, ok := buffers[key]
	if !ok || buf == nil || buf.Content.Len() == 0 {
		return
	}
	if !force {
		if buf.Content.Len() < compactToolLogDeltaFlushChars && time.Since(buf.LastFlush) < compactToolLogDeltaFlushWindow {
			return
		}
	}
	content := buf.Content.String()
	buf.Content.Reset()
	buf.LastFlush = time.Now()

	step := ProcessStep{
		StepCode:  "tool_log_delta",
		Name:      "工具输出",
		Status:    "streaming",
		Message:   "",
		Data:      map[string]interface{}{"content": content, "type": streamType, "tool_call_id": toolCallId, "function_name": functionName},
		Timestamp: time.Now().Unix(),
	}
	if err := sendProcessStep(c, requestId, step); err != nil {
		logger.Warnf(c, "Failed to send compact tool_log_delta step: %v", err)
	}
}

func queueToolLogDelta(c *gin.Context, requestId string, content string, toolCallId string, functionName string, streamType string) {
	if content == "" {
		return
	}
	if !config.IsSSECompactMode() {
		step := ProcessStep{
			StepCode:  "tool_log_delta",
			Name:      "工具输出",
			Status:    "streaming",
			Message:   "",
			Data:      map[string]interface{}{"content": content, "type": streamType, "tool_call_id": toolCallId, "function_name": functionName},
			Timestamp: time.Now().Unix(),
		}
		if err := sendProcessStep(c, requestId, step); err != nil {
			logger.Warnf(c, "Failed to send tool_log_delta step: %v", err)
		}
		return
	}

	key := fmt.Sprintf("%s|%s", toolCallId, streamType)
	buffers := getToolLogDeltaBuffers(c)
	buf, ok := buffers[key]
	if !ok || buf == nil {
		buf = &toolLogDeltaBuffer{LastFlush: time.Now()}
		buffers[key] = buf
	}
	buf.Content.WriteString(content)
	flushToolLogDeltaBuffer(c, requestId, key, toolCallId, functionName, streamType, false)
}

func compactToolResultPreview(result string) (string, bool) {
	result = extractHTTPBodyFromToolOutput(result)
	if !config.IsSSECompactMode() {
		return result, false
	}
	trimmed := strings.TrimSpace(result)
	if runeLen(trimmed) <= compactToolResultMaxChars {
		return trimmed, false
	}
	return truncateRunes(trimmed, compactToolResultMaxChars) + "\n...(truncated)", true
}

// Flush implements Flusher interface
func (w *LLMDeltaCollector) Flush() {
	if flusher, ok := w.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

// Header implements ResponseWriter interface
func (w *LLMDeltaCollector) Header() http.Header {
	return w.ResponseWriter.Header()
}

// WriteHeader implements ResponseWriter interface
func (w *LLMDeltaCollector) WriteHeader(statusCode int) {
	w.ResponseWriter.WriteHeader(statusCode)
}

type GinResponseRecorder struct {
	gin.ResponseWriter
	Body           *bytes.Buffer
	responseStatus int
	HeaderMap      http.Header
}

func (w *GinResponseRecorder) Write(b []byte) (int, error) {
	w.Body.Write(b)
	return len(b), nil
}

func (w *GinResponseRecorder) WriteString(s string) (int, error) {
	w.Body.WriteString(s)
	return len(s), nil
}

func (w *GinResponseRecorder) WriteHeader(statusCode int) {
	w.responseStatus = statusCode
}

func (w *GinResponseRecorder) Header() http.Header {
	if w.HeaderMap == nil {
		w.HeaderMap = make(http.Header)
	}
	return w.HeaderMap
}

func (w *GinResponseRecorder) Status() int {
	return w.responseStatus
}

func (w *GinResponseRecorder) Flush() {
	// Prevent early flush to underlying writer
}

// cleanupMessageFileContents 清理消息中的文件内容，替换为轻量级引用
// 文件已上传到沙盒，下游渠道可直接访问，无需通过消息传递大文件内容
func cleanupMessageFileContents(messages []relay_model.Message, uploadedFiles []*model.UploadFile) []relay_model.Message {
	if len(uploadedFiles) == 0 {
		return messages
	}

	// 构建已上传文件ID的映射，用于快速查找
	uploadedFileMap := make(map[int64]string) // fileID -> filename
	for _, f := range uploadedFiles {
		uploadedFileMap[f.ID] = f.FileName
	}

	cleanedMessages := make([]relay_model.Message, len(messages))
	for i, msg := range messages {
		cleanedMessages[i] = msg

		// 处理数组类型的 Content（包含文件对象）
		if contentList, ok := msg.Content.([]any); ok {
			var newContentList []any
			for _, item := range contentList {
				itemMap, ok := item.(map[string]any)
				if !ok {
					newContentList = append(newContentList, item)
					continue
				}

				itemType, _ := itemMap["type"].(string)

				// 检查是否是文件类型
				if itemType == "file" {
					// 获取文件名
					filename := ""
					if fn, ok := itemMap["filename"].(string); ok && fn != "" {
						filename = fn
					}

					// 将文件内容替换为轻量级引用文本
					newContentList = append(newContentList, map[string]any{
						"type": "text",
						"text": fmt.Sprintf("[文件已上传: %s，已保存到沙盒当前目录，可直接使用文件名引用]", filename),
					})
				} else {
					// 保留其他类型（text, image_url 等）
					newContentList = append(newContentList, item)
				}
			}
			cleanedMessages[i].Content = newContentList
		}
	}

	return cleanedMessages
}

func splitCommandSegments(code string) []string {
	replacer := strings.NewReplacer(
		"&&", "\n",
		"||", "\n",
		";", "\n",
		"|", "\n",
	)
	normalized := replacer.Replace(code)
	parts := strings.Split(normalized, "\n")

	segments := make([]string, 0, len(parts))
	for _, part := range parts {
		seg := strings.TrimSpace(part)
		if seg != "" {
			segments = append(segments, seg)
		}
	}
	return segments
}

func extractScriptPathTokens(code string) []string {
	segments := splitCommandSegments(code)
	tokens := make([]string, 0)

	for _, seg := range segments {
		fields := strings.Fields(seg)
		for _, field := range fields {
			value := strings.Trim(field, `"'`)
			if strings.Contains(value, "scripts/") {
				tokens = append(tokens, value)
			}
		}
	}
	return tokens
}

// normalizeScriptPath 标准化脚本路径
// 用于安全比较，防止路径遍历攻击
func normalizeScriptPath(path string) string {
	// 去除引号
	path = strings.Trim(path, `"'`)
	// 去除前后空格
	path = strings.TrimSpace(path)
	// 使用 filepath.Clean 清理路径（处理 ./ 和多余斜杠）
	path = filepath.Clean(path)
	// 统一为正斜杠
	path = strings.ReplaceAll(path, "\\", "/")
	return path
}

// isPathSuspicious 检查路径是否可疑
// 返回 true 表示路径可能有安全风险
func isPathSuspicious(path string) bool {
	// 检查路径遍历攻击
	if strings.Contains(path, "..") {
		return true
	}
	// 检查绝对路径（可能访问系统敏感文件）
	if strings.HasPrefix(path, "/") {
		return true
	}
	// 检查 Windows 绝对路径
	if len(path) >= 2 && path[1] == ':' {
		return true
	}
	return false
}

func matchesScriptPattern(token string, pattern string) bool {
	// Exact match.
	if token == pattern {
		return true
	}
	// Directory prefix pattern (e.g. scripts/).
	if strings.HasSuffix(pattern, "/") && strings.HasPrefix(token, strings.TrimSuffix(pattern, "/")+"/") {
		return true
	}
	// Legacy prefix allow (e.g. pattern "scripts" allows "scripts/a.py").
	if strings.HasPrefix(token, strings.TrimSuffix(pattern, "/")+"/") {
		return true
	}
	// Standard glob matching.
	if strings.ContainsAny(pattern, "*?[") {
		if ok, err := path.Match(pattern, token); err == nil && ok {
			return true
		}
	}
	// Recursive glob support: ** => match any nested path.
	if strings.Contains(pattern, "**") {
		regexPattern := regexp.QuoteMeta(pattern)
		regexPattern = strings.ReplaceAll(regexPattern, `\*\*`, ".*")
		regexPattern = strings.ReplaceAll(regexPattern, `\*`, `[^/]*`)
		regexPattern = strings.ReplaceAll(regexPattern, `\?`, `[^/]`)
		re, err := regexp.Compile("^" + regexPattern + "$")
		if err == nil && re.MatchString(token) {
			return true
		}
	}
	return false
}

// isScriptRestrictedCodeAllowed 检查代码中的脚本调用是否在允许列表中
// 增强版：使用精确匹配而非 Contains，防止路径绕过
func isScriptRestrictedCodeAllowed(code string, allowedScriptPatterns []string) bool {
	if len(allowedScriptPatterns) == 0 {
		return true
	}

	scriptTokens := extractScriptPathTokens(code)
	if len(scriptTokens) == 0 {
		return false
	}

	// 预处理允许列表：标准化所有模式
	normalizedPatterns := make([]string, len(allowedScriptPatterns))
	for i, pattern := range allowedScriptPatterns {
		normalizedPatterns[i] = normalizeScriptPath(pattern)
	}

	for _, token := range scriptTokens {
		// 标准化 token
		normalizedToken := normalizeScriptPath(token)

		// 检查可疑路径
		if isPathSuspicious(normalizedToken) {
			logger.Warnf(context.Background(), "【工具执行】可疑脚本路径被拒绝: %s", token)
			return false
		}

		// 模式匹配检查：支持精确路径、目录前缀以及通配符（* / ? / **）
		matched := false
		for _, pattern := range normalizedPatterns {
			if pattern == "" || isPathSuspicious(pattern) {
				continue
			}
			if matchesScriptPattern(normalizedToken, pattern) {
				matched = true
				break
			}
		}

		if !matched {
			logger.Warnf(context.Background(), "【工具执行】脚本不在允许列表中: token=%s, allowed=%v", token, allowedScriptPatterns)
			return false
		}
	}
	return true
}

func truncateToolOutputForLLM(value string, max int) string {
	if max <= 0 || runeLen(value) <= max {
		return value
	}
	return truncateRunes(value, max) + "\n...(truncated)"
}

// truncateToolOutputForLLMHeadTail keeps the beginning and the tail of long outputs.
// This helps LLMs preserve context from both ends (e.g. file headers + trailing syntax errors).
func truncateToolOutputForLLMHeadTail(value string, max int) string {
	if max <= 0 || runeLen(value) <= max {
		return value
	}
	if max < 512 {
		return truncateToolOutputForLLM(value, max)
	}

	tailBudget := max / 4
	if tailBudget > 2000 {
		tailBudget = 2000
	}
	if tailBudget < 256 {
		tailBudget = 256
	}
	if tailBudget >= max {
		tailBudget = max / 2
	}

	headBudget := max - tailBudget
	runes := []rune(value)
	headPart := string(runes[:headBudget])
	tailPart := string(runes[len(runes)-tailBudget:])
	omittedChars := len(runes) - headBudget - tailBudget

	return fmt.Sprintf("%s\n...(truncated %d chars)...\n%s", headPart, omittedChars, tailPart)
}

func toolOutputLimitForLLM(functionName string) (max int, keepTail bool) {
	switch strings.TrimSpace(functionName) {
	case "read_file":
		// nextgoclaw read_file caps around 50k at tool layer; we keep lower here
		// because relay currently has no equivalent post-loop context pruning.
		return 32000, true
	case "run_shell":
		return 24000, true
	case "list_files":
		return 12000, true
	case "code-interpreter":
		return 16000, true
	case "web_fetch":
		return 20000, true
	default:
		return toolOutputDefaultMaxCharsForLLM, false
	}
}

func softTrimContextMessage(content string, maxChars int, headChars int, tailChars int) (string, bool) {
	runes := []rune(content)
	if len(runes) <= maxChars || maxChars <= 0 {
		return content, false
	}
	if headChars <= 0 || tailChars <= 0 || headChars+tailChars >= maxChars {
		headChars = maxChars / 2
		tailChars = maxChars - headChars
	}
	if headChars+tailChars >= len(runes) {
		return content, false
	}
	omitted := len(runes) - headChars - tailChars
	head := string(runes[:headChars])
	tail := string(runes[len(runes)-tailChars:])
	return fmt.Sprintf("%s\n...[context-pruned %d chars]...\n%s", head, omitted, tail), true
}

func runeLen(value string) int {
	return len([]rune(value))
}

func pruneHistoricalToolMessagesForContext(messages []relay_model.Message, protectedStart int) (softTrimmed int, hardCleared int) {
	if len(messages) == 0 {
		return 0, 0
	}
	if protectedStart < 0 {
		protectedStart = 0
	}
	if protectedStart >= len(messages) {
		return 0, 0
	}

	toolIndexes := make([]int, 0)
	for i := protectedStart; i < len(messages); i++ {
		if messages[i].Role == "tool" {
			toolIndexes = append(toolIndexes, i)
		}
	}
	if len(toolIndexes) == 0 {
		return 0, 0
	}

	if len(toolIndexes) >= contextPruneHardClearTriggerCount {
		hardClearCount := len(toolIndexes) - contextPruneHardClearKeepRecentToolMsgs
		if hardClearCount > 0 {
			for _, idx := range toolIndexes[:hardClearCount] {
				content, ok := messages[idx].Content.(string)
				if !ok || strings.TrimSpace(content) == "" || strings.TrimSpace(content) == contextPruneHardClearPlaceholder {
					continue
				}
				messages[idx].Content = contextPruneHardClearPlaceholder
				hardCleared++
			}
		}
	}

	if len(toolIndexes) < contextPruneToolTriggerCount {
		return 0, hardCleared
	}

	compressCount := len(toolIndexes) - contextPruneKeepRecentToolMsgs
	if compressCount <= 0 {
		return 0, hardCleared
	}

	changed := 0
	for _, idx := range toolIndexes[:compressCount] {
		content, ok := messages[idx].Content.(string)
		if !ok || content == contextPruneHardClearPlaceholder || strings.Contains(content, "[context-pruned") {
			continue
		}
		trimmed := strings.TrimSpace(content)
		if trimmed == "" {
			continue
		}
		compressed, didCompress := softTrimContextMessage(trimmed, contextPruneToolMaxChars, contextPruneToolHeadChars, contextPruneToolTailChars)
		if !didCompress {
			continue
		}
		messages[idx].Content = compressed
		changed++
	}
	return changed, hardCleared
}

func sanitizeToolOutputForLLM(functionName string, output string) string {
	if output == "" {
		return output
	}
	output = extractHTTPBodyFromToolOutput(output)
	maxChars, keepTail := toolOutputLimitForLLM(functionName)
	if functionName != "code-interpreter" {
		if keepTail {
			return truncateToolOutputForLLMHeadTail(output, maxChars)
		}
		return truncateToolOutputForLLM(output, maxChars)
	}

	stderrMarker := "\n\nSTDERR:\n"
	idx := strings.Index(output, stderrMarker)
	if idx < 0 {
		stderrMarker = "STDERR:\n"
		idx = strings.Index(output, stderrMarker)
	}
	if idx < 0 {
		if keepTail {
			return truncateToolOutputForLLMHeadTail(output, maxChars)
		}
		return truncateToolOutputForLLM(output, maxChars)
	}

	stdoutPart := strings.TrimSpace(output[:idx])
	stderrPart := strings.TrimSpace(output[idx+len(stderrMarker):])

	if stdoutPart == "" {
		if stderrPart == "" {
			return ""
		}
		return buildToolExecutionFailureLLMOutput(functionName, output, nil)
	}

	if stderrPart == "" {
		if keepTail {
			return truncateToolOutputForLLMHeadTail(stdoutPart, maxChars)
		}
		return truncateToolOutputForLLM(stdoutPart, maxChars)
	}

	return buildToolExecutionFailureLLMOutput(functionName, output, nil)
}

func buildToolExecutionFailureLLMOutput(functionName string, toolOutput string, err error) string {
	combined := strings.TrimSpace(toolOutput)
	if err != nil {
		if combined != "" {
			combined += "\n\n"
		}
		combined += strings.TrimSpace(err.Error())
	}
	combined = strings.TrimSpace(extractHTTPBodyFromToolOutput(combined))
	if combined == "" {
		combined = "unknown tool execution failure"
	}

	category, repairHint := classifyToolExecutionFailure(functionName, combined)
	payload := map[string]interface{}{
		"__tool_result__":     "TOOL_EXECUTION_FAILED",
		"__tool_name__":       functionName,
		"__error_category__":  category,
		"__error__":           summarizeToolFailureHeadline(combined),
		"__error_preview__":   truncateToolOutputForLLMHeadTail(combined, 1200),
		"__repair_hint__":     repairHint,
		"__repair_priority__": "high",
	}
	if encoded, marshalErr := json.Marshal(payload); marshalErr == nil {
		return string(encoded)
	}
	return fmt.Sprintf("TOOL_EXECUTION_FAILED tool=%s category=%s error=%s", functionName, category, summarizeToolFailureHeadline(combined))
}

func classifyToolExecutionFailure(functionName string, combined string) (category string, repairHint string) {
	lower := strings.ToLower(combined)
	toolName := strings.TrimSpace(functionName)
	switch toolName {
	case "code-interpreter":
		switch {
		case containsAnySubstring(lower, "syntaxerror", "indentationerror", "unexpected indent", "unexpected token", "unexpected identifier", "unexpected end of input", "parseerror", "unterminated string", "eol while scanning string literal", "cannot use import statement outside a module"):
			return "code_syntax_error", "先修正语法错误，再用最小可运行片段重试，不要同时改业务逻辑。"
		case containsAnySubstring(lower, "modulenotfounderror", "importerror", "cannot find module", "no module named", "python is not installed", "node is not installed"):
			return "code_dependency_error", "先补齐缺失依赖或修正 import，再重试当前脚本。"
		case containsAnySubstring(lower, "traceback", "exception", "stack trace"):
			return "code_runtime_exception", "先定位 traceback 指向的失败行，再只修当前行附近的最小改动。"
		case containsAnySubstring(lower, "process exited with code", "exit code"):
			return "code_execution_failed", "先根据退出码和 stderr 定位失败原因，再用最小改动重试。"
		default:
			return "code_execution_failed", "先检查 stderr 和退出码，再用最小可运行脚本重试。"
		}
	case "run_shell":
		switch {
		case containsAnySubstring(lower, "temporarily unavailable", "暂时不可用", "status 502", "status 503", "sandbox request failed", "sandbox service"):
			return "shell_service_unavailable", "先确认 sandbox 服务可用，再重试相同命令。"
		case containsAnySubstring(lower, "permission denied", "operation not permitted"):
			return "shell_permission_denied", "先检查可执行权限和目录权限，再重试。"
		case containsAnySubstring(lower, "command not found", "not found", "is not recognized as an internal or external command", "executable file not found"):
			return "shell_command_not_found", "先确认命令是否存在、PATH 是否正确，或改成仓库内脚本/绝对路径后重试。"
		case containsAnySubstring(lower, "no such file or directory", "can't open file", "cannot open", "file not found"):
			return "shell_missing_file", "先确认工作目录和文件路径，再重试。"
		case containsAnySubstring(lower, "traceback", "syntaxerror", "indentationerror", "exception"):
			return "shell_runtime_exception", "先修正脚本本身的错误，再重试。"
		case containsAnySubstring(lower, "process exited with code", "exit code"):
			return "shell_execution_failed", "先根据退出码和 stderr 定位失败原因，再用最小改动重试。"
		default:
			return "shell_execution_failed", "先检查 stderr 和退出码，再用最小可运行命令重试。"
		}
	case "write_file", "prepare_input_file":
		switch {
		case containsAnySubstring(lower, "invalid sandbox path", "invalid path", "path traversal", "outside workspace", "absolute path"):
			return "write_path_error", "使用工作区内的相对路径，避免绝对路径和 .. 目录穿越。"
		case containsAnySubstring(lower, "create_if_missing=false", "not exist", "no such file", "does not exist", "status 404"):
			return "missing_target_file", "先创建父目录或改用 create_if_missing=true，再重试写入。"
		case containsAnySubstring(lower, "permission denied", "operation not permitted"):
			return "permission_denied", "把文件写到允许的工作区路径，避免只读目录。"
		default:
			return "write_file_error", "先核对目标路径和写入内容，再用最小修改重试。"
		}
	case "edit":
		switch {
		case strings.Contains(lower, "old_string not found"):
			return "edit_anchor_missing", "先重新读取当前文件内容，确认锚点存在后再编辑。"
		case strings.Contains(lower, "found") && strings.Contains(lower, "times") && strings.Contains(lower, "replace_all=true"):
			return "edit_anchor_ambiguous", "把 old_string 写得更具体，或者在确实需要全量替换时设置 replace_all=true。"
		case containsAnySubstring(lower, "invalid sandbox path", "invalid path", "path traversal", "outside workspace", "absolute path"):
			return "edit_path_error", "使用工作区内的相对路径，避免绝对路径和 .. 目录穿越。"
		case containsAnySubstring(lower, "permission denied", "operation not permitted"):
			return "permission_denied", "把文件放在允许编辑的工作区路径中，再重试。"
		default:
			return "edit_error", "先重新读取文件并确认锚点，再用最小修改重试。"
		}
	default:
		switch {
		case containsAnySubstring(lower, "permission denied", "operation not permitted"):
			return "permission_denied", "检查目标路径是否可写，或者改用允许的工作区目录。"
		case containsAnySubstring(lower, "not found", "no such file", "does not exist"):
			return "missing_resource", "先从工作区根目录按技能给出的原始相对路径重试，不要先加 inputs/ 或 output/ 前缀。"
		default:
			return "tool_execution_error", "先定位失败原因，再用最小修改重试。"
		}
	}
}

func buildToolFailureSignature(functionName string, argsString string, category string) string {
	toolName := strings.TrimSpace(functionName)
	if toolName == "" {
		return ""
	}
	normalizedCategory := strings.TrimSpace(category)
	if normalizedCategory == "" {
		normalizedCategory = "unknown"
	}
	normalizedArgs := normalizeToolFailureArgsString(toolName, argsString)
	sum := sha256.Sum256([]byte(toolName + "\n" + normalizedArgs + "\n" + normalizedCategory))
	return fmt.Sprintf("%x", sum[:8])
}

func normalizeToolFailureArgsString(functionName string, argsString string) string {
	trimmed := strings.TrimSpace(argsString)
	if trimmed == "" {
		return ""
	}

	var args map[string]interface{}
	if err := json.Unmarshal([]byte(trimmed), &args); err != nil {
		return trimmed
	}

	switch strings.TrimSpace(functionName) {
	case "run_shell":
		if command, ok := args["command"].(string); ok {
			args["command"] = strings.TrimSpace(command)
		}
		if cwd, ok := args["cwd"].(string); ok {
			if normalized := normalizeToolRelativePath(cwd); normalized != "" {
				args["cwd"] = normalized
			}
		}
	case "write_file", "prepare_input_file", "read_file", "edit", "list_files":
		if pathValue, ok := args["path"].(string); ok {
			if normalized := normalizeToolRelativePath(pathValue); normalized != "" {
				args["path"] = normalized
			}
		}
		if cwd, ok := args["cwd"].(string); ok {
			if normalized := normalizeToolRelativePath(cwd); normalized != "" {
				args["cwd"] = normalized
			}
		}
	}

	encoded, err := json.Marshal(args)
	if err != nil {
		return trimmed
	}
	return string(encoded)
}

func buildRepeatedToolFailureHint(functionName string, category string, count int) string {
	if count < 2 {
		return ""
	}
	toolName := strings.TrimSpace(functionName)
	toolCategory := strings.TrimSpace(category)
	if toolCategory == "" {
		toolCategory = "tool_execution_failed"
	}
	switch toolName {
	case "run_shell":
		return fmt.Sprintf("System Note: run_shell 连续 %d 次触发相同的 %s 失败，请停止重复执行同一条命令；先检查文件路径、工作目录和依赖，再改动后重试。", count, toolCategory)
	case "write_file", "prepare_input_file":
		return fmt.Sprintf("System Note: %s 连续 %d 次触发相同的 %s 失败，请停止重复提交同一路径和同一份内容；先修正工作区路径、拆分内容或改用 helper 文件后再重试。", toolName, count, toolCategory)
	case "edit":
		return fmt.Sprintf("System Note: edit 连续 %d 次触发相同的 %s 失败，请先重新读取当前文件、确认锚点，再只改最小片段后重试。", count, toolCategory)
	case "code-interpreter":
		return fmt.Sprintf("System Note: code-interpreter 连续 %d 次触发相同的 %s 失败，请先修正语法或依赖，再用最小可运行片段重试。", count, toolCategory)
	default:
		return fmt.Sprintf("System Note: %s 连续 %d 次触发相同的 %s 失败，请停止重复提交同一参数；先检查路径、锚点和依赖，再换策略重试。", toolName, count, toolCategory)
	}
}

func recordRepeatedSandboxToolFailure(toolFailureCount map[string]int, repeatedHint *string, functionName, argsString, output string, err error) {
	if toolFailureCount == nil || !isSandboxRuntimeToolName(functionName) {
		return
	}

	combined := strings.TrimSpace(output)
	if err != nil {
		if combined != "" {
			combined += "\n\n"
		}
		combined += strings.TrimSpace(err.Error())
	}
	combined = strings.TrimSpace(extractHTTPBodyFromToolOutput(combined))
	if combined == "" {
		return
	}

	category, _ := classifyToolExecutionFailure(functionName, combined)
	failureSignature := buildToolFailureSignature(functionName, argsString, category)
	if failureSignature == "" {
		return
	}

	toolFailureCount[failureSignature]++
	if toolFailureCount[failureSignature] == 2 && repeatedHint != nil && strings.TrimSpace(*repeatedHint) == "" {
		if hint := buildRepeatedToolFailureHint(functionName, category, toolFailureCount[failureSignature]); hint != "" {
			*repeatedHint = hint
		}
	}
}

func summarizeToolFailureHeadline(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}
	lines := strings.Split(trimmed, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line != "" {
			return truncateToolOutputForLLM(line, 240)
		}
	}
	return truncateToolOutputForLLM(trimmed, 240)
}

func containsAnySubstring(value string, needles ...string) bool {
	for _, needle := range needles {
		if needle == "" {
			continue
		}
		if strings.Contains(value, needle) {
			return true
		}
	}
	return false
}

// extractHTTPBodyFromToolOutput strips verbose HTTP envelope fields
// (status_code / headers / body) and keeps only body payload when present.
func extractHTTPBodyFromToolOutput(output string) string {
	trimmed := strings.TrimSpace(output)
	if trimmed == "" {
		return output
	}

	var envelope map[string]json.RawMessage
	if err := json.Unmarshal([]byte(trimmed), &envelope); err != nil {
		return output
	}

	rawBody, hasBody := envelope["body"]
	if !hasBody {
		return output
	}

	var bodyText string
	if err := json.Unmarshal(rawBody, &bodyText); err == nil {
		return strings.TrimSpace(bodyText)
	}

	// body may itself be a JSON object/array instead of JSON-encoded string.
	return strings.TrimSpace(string(rawBody))
}

func summarizeRawArgsForLLM(raw string, max int) string {
	raw = strings.TrimSpace(raw)
	if raw == "" || max <= 0 {
		return ""
	}
	if len(raw) > max {
		raw = raw[:max]
	}
	return raw
}

func fingerprintRawArgs(raw string) string {
	if strings.TrimSpace(raw) == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(raw))
	return fmt.Sprintf("%x", sum[:8])
}

func cloneToolFileVersions(src map[string]int) map[string]int {
	if len(src) == 0 {
		return map[string]int{}
	}
	dst := make(map[string]int, len(src))
	for k, v := range src {
		dst[k] = v
	}
	return dst
}

func normalizeToolRelativePath(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	normalized := filepath.ToSlash(filepath.Clean(raw))
	normalized = strings.TrimPrefix(normalized, "./")
	if normalized == "" || normalized == "." || strings.HasPrefix(normalized, "..") || strings.HasPrefix(normalized, "/") {
		return ""
	}
	return normalized
}

func normalizeShellCommandTokens(command string) []string {
	if strings.TrimSpace(command) == "" {
		return nil
	}
	fields := strings.FieldsFunc(command, func(r rune) bool {
		switch r {
		case ' ', '\t', '\n', '\r', ';', '&', '|', '>', '<':
			return true
		default:
			return false
		}
	})

	tokens := make([]string, 0, len(fields))
	for _, field := range fields {
		token := strings.TrimSpace(field)
		token = strings.Trim(token, `"'`)
		token = strings.Trim(token, "()[]{}")
		token = strings.TrimPrefix(token, "./")
		token = strings.TrimPrefix(token, ".\\")
		token = filepath.ToSlash(filepath.Clean(token))
		if token == "" || token == "." {
			continue
		}
		tokens = append(tokens, token)
	}
	return tokens
}

func buildRunShellFileFingerprint(command string, fileVersions map[string]int) string {
	if strings.TrimSpace(command) == "" || len(fileVersions) == 0 {
		return ""
	}

	tokens := normalizeShellCommandTokens(command)
	if len(tokens) == 0 {
		return ""
	}

	type matchedFile struct {
		path    string
		version int
	}

	var matches []matchedFile
	for trackedPath, version := range fileVersions {
		base := path.Base(trackedPath)
		for _, token := range tokens {
			if token == trackedPath || token == base {
				matches = append(matches, matchedFile{path: trackedPath, version: version})
				break
			}
		}
	}

	if len(matches) == 0 {
		return ""
	}

	sort.Slice(matches, func(i, j int) bool {
		if matches[i].path == matches[j].path {
			return matches[i].version < matches[j].version
		}
		return matches[i].path < matches[j].path
	})

	parts := make([]string, 0, len(matches))
	for _, match := range matches {
		parts = append(parts, fmt.Sprintf("%s#%d", match.path, match.version))
	}
	return "files:" + strings.Join(parts, ",")
}

func buildToolDedupKey(skillName, functionName, argsString string, args map[string]interface{}, fileVersions map[string]int) string {
	baseKey := fmt.Sprintf("%s:%s:%s", skillName, functionName, argsString)
	if functionName != "run_shell" {
		return baseKey
	}
	command, _ := args["command"].(string)
	fingerprint := buildRunShellFileFingerprint(command, fileVersions)
	if fingerprint == "" {
		return baseKey
	}
	return baseKey + ":" + fingerprint
}

func recordSessionFileMutation(fileVersions map[string]int, functionName string, args map[string]interface{}) {
	if fileVersions == nil {
		return
	}
	if functionName != "write_file" && functionName != "prepare_input_file" && functionName != "edit" {
		return
	}
	pathValue, ok := args["path"].(string)
	if !ok {
		return
	}
	normalized := normalizeToolRelativePath(pathValue)
	if normalized == "" {
		return
	}
	aliases := []string{normalized}
	if cwdValue, ok := args["cwd"].(string); ok {
		cwd := normalizeToolRelativePath(cwdValue)
		if cwd != "" {
			if joined := normalizeToolRelativePath(path.Join(cwd, normalized)); joined != "" {
				aliases = append(aliases, joined)
			}
		}
	}

	version := 0
	for _, alias := range aliases {
		if current := fileVersions[alias]; current > version {
			version = current
		}
	}
	version++
	for _, alias := range aliases {
		fileVersions[alias] = version
	}
}

func toolCallArgumentsToString(args any) string {
	if s, ok := args.(string); ok {
		return s
	}
	bytes, _ := json.Marshal(args)
	return string(bytes)
}

func filterDuplicateToolCallsByDedupKey(ctx context.Context, skillName string, toolCalls []relay_model.Tool, injectedTools map[string]struct{}, fileVersions map[string]int, enforceInjectedTools bool, duplicateLogSuffix string) []relay_model.Tool {
	if len(toolCalls) == 0 {
		return nil
	}

	previewFileVersions := cloneToolFileVersions(fileVersions)
	seenToolCalls := make(map[string]struct{}, len(toolCalls))
	filteredToolCalls := make([]relay_model.Tool, 0, len(toolCalls))

	for _, toolCall := range toolCalls {
		functionName := strings.TrimSpace(toolCall.Function.Name)
		if enforceInjectedTools {
			if _, exists := injectedTools[functionName]; !exists {
				logger.Warnf(ctx, "【技能运行】工具权限拦截: skill=%s, tool=%s, injected_tools_only", skillName, functionName)
				continue
			}
		}

		argsString := toolCallArgumentsToString(toolCall.Function.Arguments)
		argsMap := map[string]interface{}{}
		_ = json.Unmarshal([]byte(argsString), &argsMap)
		key := buildToolDedupKey(skillName, functionName, argsString, argsMap, previewFileVersions)

		if _, exists := seenToolCalls[key]; exists {
			if duplicateLogSuffix != "" {
				logger.Warnf(ctx, "Ignoring duplicate tool call %s: %s", duplicateLogSuffix, key)
			} else {
				logger.Warnf(ctx, "Ignoring duplicate tool call: %s", key)
			}
			continue
		}

		seenToolCalls[key] = struct{}{}
		filteredToolCalls = append(filteredToolCalls, toolCall)
		recordSessionFileMutation(previewFileVersions, functionName, argsMap)
	}

	return filteredToolCalls
}

func filterDuplicateToolCallsForTurn(ctx context.Context, skillName string, toolCalls []relay_model.Tool, injectedTools map[string]struct{}, fileVersions map[string]int) []relay_model.Tool {
	return filterDuplicateToolCallsByDedupKey(ctx, skillName, toolCalls, injectedTools, fileVersions, true, "")
}

func filterDuplicateToolCallsFromContent(ctx context.Context, skillName string, toolCalls []relay_model.Tool, fileVersions map[string]int) []relay_model.Tool {
	return filterDuplicateToolCallsByDedupKey(ctx, skillName, toolCalls, nil, fileVersions, false, "from content")
}

func buildToolArgParseFailureLLMOutput(functionName, rawArgs string, parseErr error) string {
	errMsg := "unknown parse error"
	if parseErr != nil {
		errMsg = parseErr.Error()
	}
	rawTrimmed := strings.TrimSpace(rawArgs)
	rawPreview := summarizeRawArgsForLLM(rawTrimmed, 160)
	payload := map[string]interface{}{
		"__tool_error__":             "TOOL_ARGUMENT_PARSE_ERROR",
		"__tool_name__":              functionName,
		"__error__":                  errMsg,
		"__raw_arguments_preview__":  rawPreview,
		"__raw_arguments_length__":   len(rawTrimmed),
		"__raw_arguments_sha256_8__": fingerprintRawArgs(rawTrimmed),
		"__repair_hint__":            "Retry with valid JSON object arguments. Do not resend the same malformed payload verbatim. For large write_file content, prefer run_shell+heredoc or chunked write_file with append=true.",
	}
	if encoded, err := json.Marshal(payload); err == nil {
		return string(encoded)
	}
	return fmt.Sprintf("TOOL_ARGUMENT_PARSE_ERROR tool=%s error=%s", functionName, errMsg)
}

func buildToolArgTooLargeLLMOutput(functionName string, argsLength int, maxAllowed int, rawArgs string) string {
	rawTrimmed := strings.TrimSpace(rawArgs)
	rawPreview := summarizeRawArgsForLLM(rawTrimmed, 160)
	payload := map[string]interface{}{
		"__tool_error__":             "TOOL_ARGUMENT_TOO_LARGE",
		"__tool_name__":              functionName,
		"__error__":                  fmt.Sprintf("tool arguments too large: %d > %d chars", argsLength, maxAllowed),
		"__raw_arguments_preview__":  rawPreview,
		"__raw_arguments_length__":   argsLength,
		"__raw_arguments_sha256_8__": fingerprintRawArgs(rawTrimmed),
		"__max_allowed__":            maxAllowed,
		"__repair_hint__":            "Do not send oversized inline JSON. Prefer file-based transfer: write content to an input file, then use run_shell with heredoc or a skill script to read that file. If inline write is unavoidable, split write_file into chunks with append=true.",
	}
	if encoded, err := json.Marshal(payload); err == nil {
		return string(encoded)
	}
	return fmt.Sprintf("TOOL_ARGUMENT_TOO_LARGE tool=%s length=%d max=%d", functionName, argsLength, maxAllowed)
}

func buildConversationSandboxID(conversationID int64) string {
	if conversationID <= 0 {
		return ""
	}
	return fmt.Sprintf("conversation-%d", conversationID)
}

func buildSkillToolContext(baseCtx context.Context, messageStatus *MessageStatsInfo, conversationSandboxID string, toolSessionID string, agentEid int64, agentID int64, userID int64) context.Context {
	toolCtx := baseCtx
	toolCtx = context.WithValue(toolCtx, tools.ToolEIDKey, agentEid)
	toolCtx = context.WithValue(toolCtx, tools.ToolUserIDKey, userID)
	toolCtx = context.WithValue(toolCtx, tools.ToolAgentIDKey, agentID)
	if messageStatus != nil && messageStatus.RouterResult != nil && messageStatus.RouterResult.Skill != nil {
		if messageStatus.RouterResult.Skill.Path != "" {
			toolCtx = context.WithValue(toolCtx, tools.SkillRootPathKey, messageStatus.RouterResult.Skill.Path)
		}
		if len(messageStatus.RouterResult.Skill.Resources) > 0 {
			toolCtx = context.WithValue(toolCtx, tools.SkillResourcesKey, messageStatus.RouterResult.Skill.Resources)
		}
	}

	if strings.TrimSpace(conversationSandboxID) != "" {
		toolCtx = context.WithValue(toolCtx, tools.SandboxConversationIDKey, strings.TrimSpace(conversationSandboxID))
	}
	toolCtx = context.WithValue(toolCtx, tools.SandboxSessionIDKey, toolSessionID)
	toolCtx = context.WithValue(toolCtx, tools.SkillRunIDKey, toolSessionID)
	scopeCWD := "."
	scopeEnv := map[string]string{}
	if messageStatus != nil && messageStatus.SkillRunScope != nil {
		if strings.TrimSpace(messageStatus.SkillRunScope.CWD) != "" {
			scopeCWD = messageStatus.SkillRunScope.CWD
		}
		for k, v := range messageStatus.SkillRunScope.EnvVars {
			scopeEnv[k] = v
		}
		for k, v := range messageStatus.SkillRunScope.Secrets {
			scopeEnv[k] = v
		}
	}
	if strings.TrimSpace(conversationSandboxID) != "" {
		scopeEnv["CONVERSATION_SANDBOX_ID"] = strings.TrimSpace(conversationSandboxID)
	}
	scopeEnv["SKILL_RUN_ID"] = toolSessionID
	scopeEnv["SKILL_RUN_CWD"] = scopeCWD
	scopeEnv["SANDBOX_MODE"] = config.SandboxMode
	scopeEnv["SANDBOX_SCOPE"] = config.SandboxScope
	scopeEnv["SANDBOX_WORKSPACE_ACCESS"] = config.SandboxWorkspaceAccess
	toolCtx = context.WithValue(toolCtx, tools.SandboxCWDKey, scopeCWD)
	toolCtx = context.WithValue(toolCtx, tools.SandboxEnvVarsKey, scopeEnv)

	if messageStatus != nil && len(messageStatus.UploadedFiles) > 0 {
		logger.Infof(toolCtx, "【沙盒】注入已上传文件到 toolCtx: count=%d", len(messageStatus.UploadedFiles))
		toolCtx = context.WithValue(toolCtx, tools.UploadedFilesKey, messageStatus.UploadedFiles)
	}
	return toolCtx
}

func isRecoverableLargeWriteFileArgs(args map[string]interface{}) bool {
	if args == nil {
		return false
	}
	pathVal, ok := args["path"].(string)
	if !ok || strings.TrimSpace(pathVal) == "" {
		return false
	}
	if _, ok := args["content"].(string); !ok {
		return false
	}
	return true
}

func writeLikeContentLength(args map[string]interface{}) int {
	if args == nil {
		return 0
	}
	content, _ := args["content"].(string)
	return len(content)
}

func isWriteLikeTool(functionName string) bool {
	switch strings.TrimSpace(functionName) {
	case "write_file", "prepare_input_file":
		return true
	default:
		return false
	}
}

func shouldAutoRecoverLargeWriteLikeCall(functionName string, argsLength int, args map[string]interface{}) bool {
	if !isWriteLikeTool(functionName) {
		return false
	}
	if argsLength <= maxWriteFileArgsChars {
		return false
	}
	if argsLength > maxRecoverableWriteFileArgsChars {
		return false
	}
	if !isRecoverableLargeWriteFileArgs(args) {
		return false
	}
	if writeLikeContentLength(args) > maxRecoverableWriteFileContentChars {
		return false
	}
	return true
}

func buildOutputFilePathKey(file tools.OutputFile) string {
	name := strings.TrimSpace(file.FileName)
	name = strings.ReplaceAll(name, "\\", "/")
	if name == "" {
		return ""
	}
	cleaned := path.Clean(name)
	if cleaned == "." || cleaned == "/" {
		return ""
	}
	return cleaned
}

func buildOutputFileFingerprint(file tools.OutputFile) string {
	pathKey := buildOutputFilePathKey(file)
	if pathKey == "" {
		return ""
	}
	content := strings.TrimSpace(file.Content)
	rawContent, err := base64.StdEncoding.DecodeString(content)
	if err != nil {
		rawContent = []byte(file.Content)
	}
	sum := sha256.Sum256(rawContent)
	return fmt.Sprintf("%s|%d|%x", pathKey, len(rawContent), sum[:])
}

func filterNewSandboxOutputFilesByFingerprint(seen map[string]string, outputFiles []tools.OutputFile) ([]tools.OutputFile, []string) {
	if len(outputFiles) == 0 {
		return nil, nil
	}
	if seen == nil {
		seen = map[string]string{}
	}

	dedupedOutputFiles := make([]tools.OutputFile, 0, len(outputFiles))
	skippedNames := make([]string, 0)
	for _, outputFile := range outputFiles {
		pathKey := buildOutputFilePathKey(outputFile)
		if pathKey == "" {
			skippedNames = append(skippedNames, outputFile.FileName)
			continue
		}
		fingerprint := buildOutputFileFingerprint(outputFile)
		if fingerprint == "" {
			skippedNames = append(skippedNames, outputFile.FileName)
			continue
		}
		if prevFingerprint, exists := seen[pathKey]; exists && prevFingerprint == fingerprint {
			skippedNames = append(skippedNames, outputFile.FileName)
			continue
		}
		seen[pathKey] = fingerprint
		dedupedOutputFiles = append(dedupedOutputFiles, outputFile)
	}
	return dedupedOutputFiles, skippedNames
}

func buildAllRegisteredTools(ctx context.Context) []relay_model.Tool {
	toolNames := tools.ListTools()
	sort.Strings(toolNames)

	rebuilt := make([]relay_model.Tool, 0, len(toolNames))
	for _, toolName := range toolNames {
		toolDef, err := tools.GetToolDefinition(toolName)
		if err != nil {
			logger.Warnf(ctx, "Tool definition not found for '%s': %v", toolName, err)
			continue
		}
		rebuilt = append(rebuilt, relay_model.Tool{
			Type: "function",
			Function: relay_model.Function{
				Name:        toolDef.Function.Name,
				Description: toolDef.Function.Description,
				Parameters:  toolDef.Function.Parameters,
			},
		})
	}
	return rebuilt
}

func mergeToolsByName(existing []relay_model.Tool, incoming []relay_model.Tool) []relay_model.Tool {
	if len(incoming) == 0 {
		return existing
	}
	index := make(map[string]struct{}, len(existing)+len(incoming))
	out := make([]relay_model.Tool, 0, len(existing)+len(incoming))
	for _, tool := range existing {
		name := strings.TrimSpace(tool.Function.Name)
		if name == "" {
			continue
		}
		if _, exists := index[name]; exists {
			continue
		}
		index[name] = struct{}{}
		out = append(out, tool)
	}
	for _, tool := range incoming {
		name := strings.TrimSpace(tool.Function.Name)
		if name == "" {
			continue
		}
		if _, exists := index[name]; exists {
			continue
		}
		index[name] = struct{}{}
		out = append(out, tool)
	}
	return out
}

func buildToolSetForSkill(ctx context.Context, skillDef *skill.Skill) []relay_model.Tool {
	requiredBaseTools := []string{}
	if config.IsSandboxRuntimeEnabled() {
		requiredBaseTools = append(requiredBaseTools,
			"run_shell",
			"read_file",
			"write_file",
			"prepare_input_file",
			"list_files",
			"edit",
		)
	}

	selected := make(map[string]struct{})
	for _, name := range requiredBaseTools {
		selected[name] = struct{}{}
	}
	if skillDef != nil {
		for _, tool := range skillDef.Tools {
			name := strings.TrimSpace(tool.Name)
			if name != "" {
				selected[name] = struct{}{}
			}
		}
		// code-interpreter is opt-in for stability: only expose when skill explicitly declares it.
		if skillDeclaresCodeInterpreter(skillDef) {
			selected["code-interpreter"] = struct{}{}
		}
	}

	toolNames := make([]string, 0, len(selected))
	for name := range selected {
		toolNames = append(toolNames, name)
	}
	sort.Strings(toolNames)

	rebuilt := make([]relay_model.Tool, 0, len(toolNames))
	for _, toolName := range toolNames {
		if !config.IsSandboxRuntimeEnabled() && isSandboxRuntimeToolName(toolName) {
			logger.Warnf(ctx, "Sandbox runtime disabled, skip tool injection: %s", toolName)
			continue
		}
		toolDef, err := tools.GetToolDefinition(toolName)
		if err != nil {
			logger.Warnf(ctx, "Tool definition not found for '%s': %v", toolName, err)
			continue
		}
		rebuilt = append(rebuilt, relay_model.Tool{
			Type: "function",
			Function: relay_model.Function{
				Name:        toolDef.Function.Name,
				Description: toolDef.Function.Description,
				Parameters:  toolDef.Function.Parameters,
			},
		})
	}
	return rebuilt
}

func buildGlobalToolSet(ctx context.Context) []relay_model.Tool {
	toolDef, err := tools.GetToolDefinition("web_fetch")
	if err != nil {
		logger.Warnf(ctx, "Tool definition not found for '%s': %v", "web_fetch", err)
		return nil
	}
	return []relay_model.Tool{{
		Type: "function",
		Function: relay_model.Function{
			Name:        toolDef.Function.Name,
			Description: toolDef.Function.Description,
			Parameters:  toolDef.Function.Parameters,
		},
	}}
}

func injectGlobalTools(toolsList *[]relay_model.Tool, ctx context.Context) {
	if toolsList == nil {
		return
	}
	*toolsList = mergeToolsByName(*toolsList, buildGlobalToolSet(ctx))
}

func injectGlobalToolsToChatRequest(chatRequest *ChatRequest, ctx context.Context) {
	if chatRequest == nil {
		return
	}
	injectGlobalTools(&chatRequest.Tools, ctx)
}

func injectGlobalToolsToGeneralRequest(req *relay_model.GeneralOpenAIRequest, ctx context.Context) {
	if req == nil {
		return
	}
	injectGlobalTools(&req.Tools, ctx)
}

func skillDeclaresCodeInterpreter(skillDef *skill.Skill) bool {
	if skillDef == nil {
		return false
	}
	for _, tool := range skillDef.Tools {
		switch strings.TrimSpace(tool.Name) {
		case "code-interpreter":
			return true
		}
	}
	// allowed_tools is specifically used as code-interpreter script policy.
	return len(skillDef.AllowedTools) > 0
}

func isSandboxRuntimeToolName(toolName string) bool {
	switch strings.TrimSpace(toolName) {
	case "code-interpreter", "run_shell", "read_file", "write_file", "prepare_input_file", "list_files", "edit":
		return true
	default:
		return false
	}
}

// runAgentLoop executes the tool use loop for the agent
func runAgentLoop(c *gin.Context, requestCtx context.Context, agent *model.Agent, chatRequest *ChatRequest, messageStatus *MessageStatsInfo,
	requestModel string, relayMode int, retryTimes int, executionChannel *model.Channel) {

	requestID := ""
	if messageStatus != nil {
		requestID = messageStatus.RequestId
	}
	requestID = ensureRequestID(c, requestID)
	ctx := c.Request.Context()
	if ctx == nil {
		ctx = context.Background()
	}
	maxTurns := config.AGENT_MAX_TURNS
	turnCount := 0
	runStartMsgCount := len(chatRequest.Messages)

	// Track file mutation versions so repeated run_shell calls can be re-evaluated
	// when a referenced file has changed since the previous execution.
	sessionFileVersions := make(map[string]int)
	// Track tool usage count (regardless of args)
	toolUsageCount := make(map[string]int)
	// Track repeated failure signatures so identical run_shell failures can be surfaced once.
	toolFailureCount := make(map[string]int)
	// Track repeated tool results and read-only streaks to break no-progress loops.
	toolLoopState := newRelayToolLoopState()
	var repeatedToolLoopHint string
	// Track all output files generated in this session.
	var sessionOutputFiles []*model.UploadFile
	// De-duplicate by normalized output path + content fingerprint.
	// This prevents run_shell full-directory scans from re-saving unchanged files.
	seenOutputFileFingerprints := make(map[string]string)

	// Helper function to get current skill name for tool deduplication
	getCurrentSkillName := func() string {
		if messageStatus != nil && messageStatus.RouterResult != nil && messageStatus.RouterResult.Skill != nil {
			return messageStatus.RouterResult.Skill.Name
		}
		return ""
	}

	getCurrentMessageID := func() int64 {
		if messageStatus != nil && messageStatus.MessageID > 0 {
			return messageStatus.MessageID
		}
		if masterMsgIDVal, exists := c.Get("agent_master_message_id"); exists {
			if id, ok := masterMsgIDVal.(int64); ok && id > 0 {
				return id
			}
		}
		return 0
	}

	syncFinalAIUploadFiles := func(files []*model.UploadFile, folderPath string) {
		if len(files) == 0 {
			return
		}
		eid := config.GetEID(c)
		userID := config.GetUserId(c)
		messageID := getCurrentMessageID()
		syncSvc := service.NewAIGeneratedSyncService(eid)
		syncedFiles, syncErr := syncSvc.SyncOutputFiles(ctx, userID, files, folderPath)
		if syncErr != nil {
			logger.Errorf(ctx, "【技能运行】同步最终AI生成文件失败: message_id=%d skill=%s err=%v", messageID, getCurrentSkillName(), syncErr)
			return
		}
		syncedNames := make([]string, 0, len(syncedFiles))
		for _, syncedFile := range syncedFiles {
			if syncedFile != nil {
				syncedNames = append(syncedNames, syncedFile.Path)
			}
		}
		logger.Debugf(ctx, "【技能运行】最终AI生成文件同步完成: message_id=%d skill=%s synced_count=%d synced_paths=%v",
			messageID, getCurrentSkillName(), len(syncedFiles), syncedNames)
	}

	buildAIGeneratedSessionFolderPath := func(conversation *model.Conversation) string {
		if conversation == nil {
			return ""
		}

		title := normalizeAIGeneratedSessionFolderSegment(conversation.Title)
		if title == "" {
			title = fmt.Sprintf("conversation-%d", conversation.ConversationID)
		}
		if createdAt := conversation.CreatedTime; createdAt > 0 {
			createdDate := time.UnixMilli(createdAt).UTC().Format("2006-01-02")
			if createdDate != "" {
				title = fmt.Sprintf("%s-%s", title, createdDate)
			}
		}
		return path.Join("/ai-generated", title)
	}

	// Helper function to build runtime injected tool set.
	getInjectedToolNames := func() map[string]struct{} {
		injected := make(map[string]struct{})
		for _, t := range chatRequest.Tools {
			toolName := strings.TrimSpace(t.Function.Name)
			if toolName != "" {
				injected[toolName] = struct{}{}
			}
		}
		return injected
	}

	logger.Debugf(ctx, "【技能运行】开始Agent循环: skill=%s, model=%s, max_turns=%d, outer_stream=%v",
		getCurrentSkillName(), requestModel, maxTurns, chatRequest.Stream)

	// [Agent Mode] 创建Master Message
	// 在循环开始前创建一次消息记录，后续循环中复用此ID并累加Quota
	user_id := config.GetUserId(c)
	runnableSkillPathSet := loadRunnableSkillPathSet(c.Request.Context(), agent, user_id)
	conversation, errConv := GetSessionConversation(c)
	if errConv != nil {
		logger.Errorf(ctx, "GetSessionConversation failed: %s", errConv.Error())
		errResp := model.ParamError.ToOpenAIErrorRespone(nil)
		if chatRequest.Stream {
			writeStreamOpenAIError(c, 500, errResp)
		} else {
			c.JSON(500, errResp)
		}
		return
	}
	sessionFolderPath := buildAIGeneratedSessionFolderPath(conversation)

	meta := GetByContext(c)
	// 构造初始 textRequest 用于创建消息
	initialModel := requestModel
	if initialModel == "" || strings.HasPrefix(initialModel, "agent-") {
		initialModel = agent.Model
	}

	// 匹配模型与 agent.settings 配置，确定 ThinkingMode
	if messageStatus != nil {
		messageStatus.ThinkingMode = resolveThinkingMode(agent, initialModel)
	}

	initialTextRequest := &relay_model.GeneralOpenAIRequest{
		Messages: chatRequest.Messages,
		Model:    initialModel,
		Stream:   chatRequest.Stream,
	}
	// requestId 在 loop 外生成一次
	if messageStatus != nil {
		messageStatus.RequestId = requestID
	}
	conversationSandboxID := buildConversationSandboxID(conversation.ConversationID)
	toolSessionID := fmt.Sprintf("skillrun-%s", strings.ReplaceAll(requestID, " ", "_"))
	c.Set("agent_tool_session_id", toolSessionID)

	masterMsgID := int64(0)
	if existingMsgID, exists := c.Get("agent_master_message_id"); exists {
		if id, ok := existingMsgID.(int64); ok && id > 0 {
			masterMsgID = id
		}
	}
	if masterMsgID == 0 && messageStatus != nil && messageStatus.MessageID > 0 {
		masterMsgID = messageStatus.MessageID
	}
	if masterMsgID == 0 {
		createdMsgID, errMsg := CreateInitialMessage(c, agent, user_id, conversation.ConversationID, initialTextRequest, meta, requestID, messageStatus)
		if errMsg != nil {
			logger.Errorf(ctx, "CreateInitialMessage failed: %s", errMsg.Error())
			// 降级处理：不阻断流程，但在 context 中不设置 ID，后续 RelayTextHelper 会按旧逻辑尝试创建（可能会有重复消息风险）
		} else {
			masterMsgID = createdMsgID
		}
	}
	if masterMsgID > 0 {
		// 设置到 Context 中，供 RelayTextHelper 和 postConsumeQuota 使用
		c.Set("agent_master_message_id", masterMsgID)
		syncAgentRunForMessage(ctx, agent, conversation.ConversationID, masterMsgID, requestID, "agent_loop")
		bindMessageIDAndFlushProcessSteps(ctx, agent.Eid, messageStatus, masterMsgID)
		logger.Debugf(ctx, "Agent Master Message Ready: %d", masterMsgID)

		// 统一保证流式首帧先发送 message_id，避免步骤事件被缓存到最终回答才输出
		if chatRequest.Stream {
			modelName := requestModel
			if modelName == "" {
				modelName = chatRequest.Model
			}
			if err := sendMessageIDFirstFrame(c, requestID, modelName, masterMsgID); err != nil {
				logger.Warnf(ctx, "sendMessageIDFirstFrame failed at agent loop start: %v", err)
			}
		}
	}

	if requestCtx != nil && requestCtx.Done() != nil {
		go func(requestCtx context.Context, requestID string) {
			<-requestCtx.Done()
			logger.Infof(ctx, "client disconnected, keep agent loop alive: request_id=%s", requestID)
		}(requestCtx, requestID)
	}

	nextStreamPhase := getAgentInitialStreamPhase(c)
	for turnCount < maxTurns {
		select {
		case <-ctx.Done():
			logger.Infof(ctx, "【技能运行】检测到取消请求，退出 agent loop: request_id=%s, turn=%d", requestID, turnCount)
			if masterMsgID > 0 && conversation != nil {
				finalizeAgentRunForMessage(ctx, agent, conversation.ConversationID, masterMsgID, requestID, model.AgentRunStatusCancelled, "cancelled", "User requested cancellation")
			}
			return
		default:
		}

		turnCount++
		c.Set("agent_loop_turn", turnCount)
		c.Set("agent_loop_skill_name", getCurrentSkillName())
		c.Set("agent_loop_request_model", requestModel)
		c.Set(agentStreamPhaseContextKey, nextStreamPhase)
		logger.Debugf(ctx, "【技能运行】开始轮次: turn=%d, skill=%s, model=%s, stream_phase=%s, message_count=%d, tool_count=%d",
			turnCount, getCurrentSkillName(), requestModel, nextStreamPhase, len(chatRequest.Messages), len(chatRequest.Tools))

		// 1. Determine if we should stream this turn's LLM output.
		// Keep streaming enabled for every turn (including the last allowed turn),
		// otherwise the final turn may collapse into a single non-stream block.
		streamIntermediate := chatRequest.Stream

		currentRequest := *chatRequest
		currentRequest.Stream = streamIntermediate // Enable streaming for intermediate turns when outer is streaming
		currentRequest.Model = requestModel        // Fix: Ensure request uses the actual underlying model name, not the virtual agent name

		// Prepare request body
		modifiedBody, err := json.Marshal(currentRequest)
		if err != nil {
			logger.Errorf(ctx, "Failed to marshal chat request: %v", err)
			errResp := model.ParamError.ToOpenAIErrorRespone(nil)
			if chatRequest.Stream {
				writeStreamOpenAIError(c, 500, errResp)
			} else {
				c.JSON(500, errResp)
			}
			return
		}
		// Log the actual request body being sent
		logger.Debugf(ctx, "【技能运行】轮次请求体: turn=%d, skill=%s, model=%s, body=%s",
			turnCount, getCurrentSkillName(), requestModel, string(modifiedBody))

		c.Request.Body = io.NopCloser(bytes.NewBuffer(modifiedBody))
		c.Set(ctxkey.KeyRequestBody, modifiedBody)

		// 2. Capture Response - use LLMDeltaCollector for streaming intermediate turns
		originalWriter := c.Writer
		var responseRecorder *GinResponseRecorder
		var deltaCollector *LLMDeltaCollector

		if streamIntermediate {
			// Use delta collector to emit llm_delta events and buffer content
			deltaCollector = NewLLMDeltaCollector(c, ctx, messageStatus.RequestId)
			c.Writer = deltaCollector
			logger.Debugf(ctx, "【技能运行】Turn %d: 启用中间 LLM 流式输出", turnCount)
		} else {
			// Use standard recorder for non-streaming
			responseRecorder = &GinResponseRecorder{
				ResponseWriter: originalWriter,
				Body:           bytes.NewBufferString(""),
				responseStatus: 200,
			}
			c.Writer = responseRecorder
		}

		var errResp *model.OpenAIErrorResponse
		if streamIntermediate {
			c.Set("agent_internal_stream_turn", true)
		}
		errResp = executeLLMRequest(c, &currentRequest, ctx, messageStatus, requestModel, relayMode, retryTimes, executionChannel)
		if streamIntermediate {
			c.Set("agent_internal_stream_turn", false)
		}

		// Restore writer
		c.Writer = originalWriter

		if errResp != nil {
			// If error, return immediately
			// Note: executeLLMRequest returns *model.OpenAIErrorResponse which doesn't have StatusCode
			// We assume 500 or map from error type
			if chatRequest.Stream {
				writeStreamOpenAIError(c, 500, *errResp)
			} else {
				c.JSON(500, errResp)
			}
			return
		}

		// 4. Parse Response - get content from collector or recorder
		var responseBody []byte
		var contentStr string
		var reasoningStr string

		if streamIntermediate && deltaCollector != nil {
			// Get buffered content from delta collector
			var streamedToolCalls []relay_model.Tool
			contentStr, reasoningStr, streamedToolCalls = deltaCollector.GetContent()
			// Build a synthetic JSON response for parsing
			syntheticResp := OpenAITextResponse{
				Id:      messageStatus.RequestId,
				Object:  "chat.completion",
				Created: time.Now().Unix(),
				Model:   requestModel,
				Choices: []struct {
					Index        int                 `json:"index"`
					Message      relay_model.Message `json:"message"`
					FinishReason string              `json:"finish_reason"`
				}{
					{
						Index: 0,
						Message: relay_model.Message{
							Role:      "assistant",
							Content:   contentStr,
							ToolCalls: streamedToolCalls,
						},
						FinishReason: "stop",
					},
				},
			}
			// Note: reasoning content is stored separately for tool-call parsing if needed
			responseBody, _ = json.Marshal(syntheticResp)
		} else {
			responseBody = responseRecorder.Body.Bytes()
			reasoningStr = extractReasoningContentFromOpenAIResponse(responseBody)
		}

		var sseSteps []byte
		var cleanJSON []byte
		sseSteps, cleanJSON = ParseMixedOutput(responseBody)

		// For streaming intermediate turns, use the synthetic JSON directly
		if streamIntermediate && deltaCollector != nil {
			cleanJSON = responseBody // Already clean JSON from synthetic response
		}

		if len(cleanJSON) == 0 {
			// [FIX] 容错处理：如果无法提取 JSON，且没有 SSE 步骤，尝试将整个响应体作为内容进行容错解析
			// 这通常发生在模型直接返回了内容而没有被 ParseMixedOutput 正确识别（例如 JSON 格式轻微错误）
			// 或者模型返回了纯文本错误
			logger.Warnf(ctx, "Failed to extract JSON from mixed response. Raw body: %s", string(responseBody))

			// 如果是流式响应且有步骤，优先尝试从流式收集器重建 cleanJSON，
			// 避免直接透传导致工具检测被跳过（典型表现：模型输出 ```python``` 但不执行工具）。
			if chatRequest.Stream && len(sseSteps) > 0 {
				if collectorAny, exists := c.Get("stream_response_collector"); exists {
					if collector, ok := collectorAny.(*StreamResponseCollector); ok {
						collectedContent, _ := collector.GetContent()
						collectedContent = strings.TrimSpace(collectedContent)
						if collectedContent != "" {
							detectedToolCalls := tools.DetectToolCallsFromContent(collectedContent)
							fallbackResp := OpenAITextResponse{
								Id:      messageStatus.RequestId,
								Object:  "chat.completion",
								Created: time.Now().Unix(),
								Model:   requestModel,
								Choices: []struct {
									Index        int                 `json:"index"`
									Message      relay_model.Message `json:"message"`
									FinishReason string              `json:"finish_reason"`
								}{
									{
										Index: 0,
										Message: relay_model.Message{
											Role:      "assistant",
											Content:   collectedContent,
											ToolCalls: detectedToolCalls,
										},
										FinishReason: "stop",
									},
								},
							}
							if fallbackJSON, marshalErr := json.Marshal(fallbackResp); marshalErr == nil {
								cleanJSON = fallbackJSON
								logger.Warnf(ctx, "Recovered clean JSON from stream collector fallback, content_chars=%d, detected_tool_calls=%d",
									len(collectedContent), len(detectedToolCalls))
							}
						}
					}
				}
				if len(cleanJSON) == 0 {
					if responseRecorder != nil {
						replayBufferedHeaders(c, responseRecorder)
					}
					SetUpStreamResponseHeaders(c)
					c.Writer.Write(sseSteps)
					if f, ok := c.Writer.(http.Flusher); ok {
						f.Flush()
					}
					return
				}
			}

			// 尝试容错：如果是 DeepSeek 等模型返回的特定格式（例如只有 reasoning_content 或 content 但 JSON 不完整）
			// 或者如果是 200 OK 但内容解析失败，我们尝试构造一个假的 OpenAI 响应
			// 注意：这里仅处理状态码为 200 的情况，如果是 500 等错误，直接原样返回
			// Also handle case where responseRecorder is nil (streaming intermediate)
			recorderStatus := 200
			if responseRecorder != nil {
				recorderStatus = responseRecorder.responseStatus
			}
			if recorderStatus == 200 && len(responseBody) > 0 {
				// 尝试将 body 当作 content 封装
				logger.Warnf(ctx, "Attempting fallback: treating raw body as content")
				fallbackResp := OpenAITextResponse{
					Choices: []struct {
						Index        int                 `json:"index"`
						Message      relay_model.Message `json:"message"`
						FinishReason string              `json:"finish_reason"`
					}{
						{
							Message: relay_model.Message{
								Role:    "assistant",
								Content: string(responseBody),
							},
						},
					},
				}
				// 序列化为 cleanJSON 供后续流程使用
				if fallbackJSON, err := json.Marshal(fallbackResp); err == nil {
					cleanJSON = fallbackJSON
					logger.Infof(ctx, "Fallback successful, proceeding with wrapped content")
				} else {
					// 序列化失败，放弃治疗
					replayGinResponseSafe(c, responseRecorder, responseBody)
					return
				}
			} else {
				replayGinResponseSafe(c, responseRecorder, responseBody)
				return
			}
		}

		var openaiResp OpenAITextResponse
		if err := json.Unmarshal(cleanJSON, &openaiResp); err != nil {
			// Failed to parse, maybe it's not JSON or error
			logger.Errorf(ctx, "Failed to parse LLM response: %v, Clean Body: %s", err, string(cleanJSON))
			if chatRequest.Stream && len(sseSteps) > 0 {
				if responseRecorder != nil {
					replayBufferedHeaders(c, responseRecorder)
				}
				SetUpStreamResponseHeaders(c)
				c.Writer.Write(sseSteps)
				if f, ok := c.Writer.(http.Flusher); ok {
					f.Flush()
				}
				return
			}
			replayGinResponseSafe(c, responseRecorder, responseBody)
			return
		}
		if reasoningStr == "" {
			reasoningStr = extractReasoningContentFromOpenAIResponse(cleanJSON)
		}

		if len(openaiResp.Choices) == 0 {
			logger.Warnf(ctx, "LLM response has no choices. Body: %s", string(responseBody))
			if chatRequest.Stream && len(sseSteps) > 0 {
				if responseRecorder != nil {
					replayBufferedHeaders(c, responseRecorder)
				}
				SetUpStreamResponseHeaders(c)
				c.Writer.Write(sseSteps)
				return
			}
			replayGinResponseSafe(c, responseRecorder, responseBody)
			return
		}

		choice := openaiResp.Choices[0]
		// Convert relay_model.Message to local Message (or generic struct) to check tools
		// choice.Message is relay_model.Message which should have ToolCalls
		message := choice.Message

		// === Decision-based branching ===
		// Parse decision from LLM response content
		// Note: contentStr may already be set from streaming intermediate turn
		if contentStr == "" {
			contentStr = ""
		}
		if str, ok := message.Content.(string); ok {
			contentStr = str
		} else {
			contentStr = fmt.Sprintf("%v", message.Content)
		}

		controlEvent := ParseAgentControlEvent(contentStr)
		decision := controlEvent.Decision
		logger.Debugf(ctx, "Agent control event: decision=%v legacy=%v content_length=%d", decision, controlEvent.IsLegacy, len(contentStr))

		// Decision switch: handle based on parsed decision
		if decision != nil {
			switch decision.Decision {
			case DecisionDone:
				// LLM indicates conversation is complete - return final answer
				finalAnswerContent := sanitizeFinalAssistantContent(contentStr)
				currentRunMessages := chatRequest.Messages
				if runStartMsgCount >= 0 && runStartMsgCount <= len(chatRequest.Messages) {
					currentRunMessages = chatRequest.Messages[runStartMsgCount:]
				}
				finalAnswerContent = ensureNonEmptyFinalAssistantContent(finalAnswerContent, currentRunMessages, getCurrentSkillName())
				passthrough := deltaCollector != nil && deltaCollector.IsPassthrough()
				logger.Infof(ctx, "Agent decision: DONE - returning final answer, streamIntermediate=%v, passthrough=%v, sessionOutputFiles count: %d",
					streamIntermediate, passthrough, len(sessionOutputFiles))
				syncFinalAIUploadFiles(sessionOutputFiles, sessionFolderPath)
				if chatRequest.Stream {
					if len(sseSteps) > 0 {
						if responseRecorder != nil {
							replayBufferedHeaders(c, responseRecorder)
						}
						SetUpStreamResponseHeaders(c)
						c.Writer.Write(sseSteps)
						if f, ok := c.Writer.(http.Flusher); ok {
							f.Flush()
						}
					}
					sendOutputFilesStep(c, ctx, messageStatus.RequestId, sessionOutputFiles, messageStatus, true)
					// 透传模式下内容已实时发送，只需发送 finish 信号
					if passthrough {
						// 从 delta collector 获取 passthrough 期间跟踪的内容
						passthroughAnswer, passthroughReasoning := "", ""
						passthroughDeltas := []string(nil)
						if deltaCollector != nil {
							passthroughAnswer, passthroughReasoning = deltaCollector.GetPassthroughContent()
							passthroughDeltas = deltaCollector.GetPassthroughContentDeltas()
						}
						if collectedAnswer, collectedReasoning := getCollectedStreamResponseContent(c); strings.TrimSpace(collectedAnswer) != "" {
							passthroughAnswer = collectedAnswer
							if strings.TrimSpace(collectedReasoning) != "" && passthroughReasoning == "" {
								passthroughReasoning = collectedReasoning
							}
						}
						if passthroughReasoning != "" && reasoningStr == "" {
							reasoningStr = passthroughReasoning
						}
						if deltaCollector != nil && !deltaCollector.IsUpstreamComplete() {
							logger.Warnf(ctx, "【技能运行】上游流未完整结束，跳过最终回答写入: request_id=%s, message_id=%d", messageStatus.RequestId, getCurrentMessageID())
							finalizeAgentRunForMessage(ctx, agent, conversation.ConversationID, getCurrentMessageID(), messageStatus.RequestId, model.AgentRunStatusFailed, "incomplete_stream", "upstream stream ended before finish_reason or DONE")
							return
						}

						// 持久化 message.delta（让 subscribe 也能看到逐段内容）
						for _, delta := range passthroughDeltas {
							mirrorAgentRunTimelineEvent(c, messageStatus.RequestId, model.AgentRunEventMessageDelta, map[string]interface{}{
								"choices": []map[string]interface{}{
									{
										"delta": relay_model.Message{
											Content: delta,
										},
									},
								},
							})
						}

						finishChunk := openai_model.ChatCompletionsStreamResponse{
							Id:      messageStatus.RequestId,
							Object:  "chat.completion.chunk",
							Created: time.Now().Unix(),
							Model:   requestModel,
							Choices: []openai_model.ChatCompletionsStreamResponseChoice{
								{Delta: relay_model.Message{Content: ""}, FinishReason: stringPtr("stop")},
							},
						}
						finishBytes, _ := json.Marshal(finishChunk)
						c.Writer.Write([]byte("data: "))
						c.Writer.Write(finishBytes)
						c.Writer.Write([]byte("\n\n"))
						if flusher, ok := c.Writer.(http.Flusher); ok {
							flusher.Flush()
						}

						// Send message.completed SSE event（使用 passthrough 跟踪到的真实内容）
						msgID := getCurrentMessageID()
						if msgID > 0 {
							payload := map[string]interface{}{
								"event_type": model.AgentRunEventMessageDone,
								"answer":     passthroughAnswer,
							}
							if reasoningStr != "" {
								payload["reasoning_content"] = reasoningStr
							}
							completedBytes, _ := json.Marshal(payload)
							c.Writer.Write([]byte("data: "))
							c.Writer.Write(completedBytes)
							c.Writer.Write([]byte("\n\n"))
							if flusher, ok := c.Writer.(http.Flusher); ok {
								flusher.Flush()
							}
						}

						if !config.IsSSECompactMode() {
							c.Writer.Write([]byte("data: [DONE]\n\n"))
							if flusher, ok := c.Writer.(http.Flusher); ok {
								flusher.Flush()
							}
						}
						mirrorAgentRunFinalResponse(c, messageStatus.RequestId, msgID, passthroughAnswer, reasoningStr)
					} else {
						var finalDeltas []string
						if deltaCollector != nil {
							finalDeltas = deltaCollector.GetContentDeltas()
						}

						sendStreamResponse(c, messageStatus.RequestId, requestModel, finalAnswerContent, reasoningStr, getCurrentMessageID(), finalDeltas)
					}
				} else {
					sendOutputFilesStep(c, ctx, messageStatus.RequestId, sessionOutputFiles, messageStatus, false)
					replaySanitizedAssistantResponse(c, responseRecorder, openaiResp, finalAnswerContent, sessionOutputFiles, responseBody)
				}
				return

			case DecisionContinue:
				// LLM wants to continue without tool execution - loop again
				logger.Infof(ctx, "Agent decision: CONTINUE - continuing loop without tools")
				// Append assistant message and continue loop
				appendAgentAssistantMessage(c, chatRequest, message, reasoningStr)
				continue

			case DecisionToolCall:
				// LLM indicates tool call needed - fall through to existing tool logic
				logger.Infof(ctx, "Agent decision: TOOL_CALL - proceeding to tool execution")
				// Continue to tool_calls detection below

			case DecisionRAGQuery:
				// Phase 2: RAG query logic - search knowledge base
				logger.Infof(ctx, "Agent decision: RAG_QUERY - executing knowledge retrieval")

				// Use the structured control event payload when available.
				ragQuery := controlEvent.Query
				if ragQuery == "" {
					logger.Warnf(ctx, "RAG_QUERY decision but no query content, treating as CONTINUE")
					appendAgentAssistantMessage(c, chatRequest, message, reasoningStr)
					continue
				}

				// Get library IDs from chatRequest
				var libraryIDs []int64
				var fileIDs []int64
				if len(chatRequest.KnowledgeBaseIDs) > 0 {
					resolvedIDs, err := resolveKnowledgeBaseIDs(agent.Eid, chatRequest.KnowledgeBaseIDs)
					if err != nil {
						logger.Errorf(ctx, "Failed to resolve knowledge base IDs: %v", err)
						appendAgentAssistantMessage(c, chatRequest, message, reasoningStr)
						continue
					}
					libraryIDs = resolvedIDs
				} else if len(chatRequest.FileIDs) > 0 {
					resolvedIDs, err := resolveFileIDs(agent.Eid, chatRequest.FileIDs)
					if err != nil {
						logger.Errorf(ctx, "Failed to resolve file IDs: %v", err)
						appendAgentAssistantMessage(c, chatRequest, message, reasoningStr)
						continue
					}
					fileIDs = resolvedIDs
				}

				if len(libraryIDs) == 0 && len(fileIDs) == 0 {
					logger.Warnf(ctx, "RAG_QUERY decision but no library/file IDs configured")
					appendAgentAssistantMessage(c, chatRequest, message, reasoningStr)
					continue
				}

				// Execute RAG query with retry mechanism
				var sources []rag.SourceReference
				var ragErr error
				var userIDPtr *int64
				userID := config.GetUserId(c)
				if userID > 0 {
					userIDPtr = &userID
				}
				err := common.Retry(ctx, func() error {
					sources, ragErr = ExecuteRAGQuery(ctx, ragQuery, libraryIDs, fileIDs, agent.Eid, userIDPtr, agent, chatRequest.SearchConfig)
					return ragErr
				},
					common.WithMaxRetries(3),
					common.WithInitialDelay(500*time.Millisecond),
					common.WithRetryableFunc(common.IsRetryableError),
				)

				if err != nil {
					logger.Errorf(ctx, "RAG query failed after retries: %v", err)
					// Add warning message for user
					warningMsg := relay_model.Message{
						Role:    "system",
						Content: "注意：知识库查询暂时不可用，将基于已有信息回答。",
					}
					appendAgentAssistantMessage(c, chatRequest, message, reasoningStr)
					chatRequest.Messages = append(chatRequest.Messages, warningMsg)
					continue
				}

				// Task 2.3: Inject RAG results into context for next LLM call
				logger.Infof(ctx, "RAG query returned %d sources, injecting into context", len(sources))

				if len(sources) > 0 {
					// Build context string from sources using standard format
					var contextBuilder strings.Builder
					contextBuilder.WriteString("## 知识库检索结果\n\n")
					contextBuilder.WriteString("以下是与用户问题相关的参考资料，请基于这些内容回答问题：\n\n")

					for i, source := range sources {
						// Use standard [Source:x-y] format for citations
						sourceKey := source.SourceKey
						if sourceKey == "" {
							sourceKey = fmt.Sprintf("[Source:%d-%d]", 1, i+1)
						}
						contextBuilder.WriteString(fmt.Sprintf("%s\n<begin>\n%s\n<end>\n\n", sourceKey, source.Content))
					}

					// Create system message with RAG context
					ragContextMsg := relay_model.Message{
						Role:    "system",
						Content: contextBuilder.String(),
					}

					// Append assistant message (with RAG query decision) and RAG context
					appendAgentAssistantMessage(c, chatRequest, message, reasoningStr)
					chatRequest.Messages = append(chatRequest.Messages, ragContextMsg)
					logger.Infof(ctx, "RAG context injected: %d sources, context length: %d chars", len(sources), contextBuilder.Len())
				} else {
					// No sources found, just append the message
					logger.Warnf(ctx, "RAG query returned no sources, continuing without context")
					appendAgentAssistantMessage(c, chatRequest, message, reasoningStr)
				}
				continue

			case DecisionSkillSwitch:
				// Phase 3 Task 3.2: Skill switch logic
				logger.Infof(ctx, "Agent decision: SKILL_SWITCH - switching to new skill")

				// Use the structured control event payload when available.
				targetSkillName := controlEvent.SkillName
				if targetSkillName == "" {
					logger.Warnf(ctx, "SKILL_SWITCH decision but no skill name found, treating as CONTINUE")
					appendAgentAssistantMessage(c, chatRequest, message, reasoningStr)
					continue
				}

				// Get skill manager
				skillManager := skill.GetManager()
				var newSkill *skill.Skill
				if messageStatus != nil && messageStatus.SkillSnapshot != nil {
					newSkill = findSkillInSnapshot(messageStatus.SkillSnapshot, targetSkillName)
				}
				if newSkill == nil {
					newSkill = skillManager.GetSkillWithScope(agent.Eid, targetSkillName, buildSkillRunScope(ctx, agent, agent.Eid, ".", requestID))
				}
				if newSkill == nil {
					logger.Warnf(ctx, "Skill '%s' not found in tenant/global lookup for switch, treating as CONTINUE", targetSkillName)
					appendAgentAssistantMessage(c, chatRequest, message, reasoningStr)
					continue
				}
				if !isSkillAllowedByPathSet(newSkill, runnableSkillPathSet) {
					logger.Warnf(ctx, "Skill '%s' blocked by current runnable path set, treating as CONTINUE", targetSkillName)
					appendAgentAssistantMessage(c, chatRequest, message, reasoningStr)
					continue
				}

				currentSkillName := getCurrentSkillName()

				// Append current message to preserve context
				appendAgentAssistantMessage(c, chatRequest, message, reasoningStr)

				// Update RouterResult with new skill for tool context
				if messageStatus.RouterResult == nil {
					messageStatus.RouterResult = &RouterResult{
						Skill: newSkill,
					}
				} else {
					messageStatus.RouterResult.Skill = newSkill
				}

				// Rebuild runtime tool set from the new skill instead of appending old tools.
				previousToolCount := len(chatRequest.Tools)
				chatRequest.Tools = buildToolSetForSkill(ctx, newSkill)
				injectGlobalToolsToChatRequest(chatRequest, ctx)

				// Inject skill instruction as system message
				if newSkill.Instruction != "" {
					skillInstructionMsg := relay_model.Message{
						Role:    "system",
						Content: fmt.Sprintf("## 新技能指令: %s\n\n%s", newSkill.Name, newSkill.Instruction),
					}
					chatRequest.Messages = append(chatRequest.Messages, skillInstructionMsg)
				}

				logger.Debugf(ctx, "【技能运行】技能切换完成: from_skill=%s, to_skill=%s, previous_tool_count=%d, current_tool_count=%d",
					currentSkillName, targetSkillName, previousToolCount, len(chatRequest.Tools))
				continue

			default:
				// Unknown decision type - fall through to existing logic
				logger.Warnf(ctx, "Agent decision: unknown type '%s', falling through to tool detection", decision.Decision)
			}
		}

		// === Fallback: No decision or TOOL_CALL - use existing tool detection logic ===
		// Log tool calls for debugging
		if len(message.ToolCalls) > 0 {
			toolCallBytes, _ := json.Marshal(message.ToolCalls)
			logger.Infof(ctx, "LLM returned tool calls: %s", string(toolCallBytes))
		} else {
			logger.Infof(ctx, "LLM returned no tool calls. Content: %v", message.Content)
			// Content fallback tool detection (existing logic)
			if contentStr != "" {
				// Prevent infinite loops by checking if the exact same content was already processed
				isDuplicate := false
				if len(chatRequest.Messages) > 0 {
					for i := len(chatRequest.Messages) - 1; i >= 0; i-- {
						msg := chatRequest.Messages[i]
						if msg.Role == "assistant" && msg.Content == contentStr {
							if len(msg.ToolCalls) > 0 {
								isDuplicate = true
								break
							}
						}
					}
				}

				// State Machine Logic: Check if in "Answering Phase"
				isAnsweringPhase := false
				if len(chatRequest.Messages) > 0 {
					lastMsg := chatRequest.Messages[len(chatRequest.Messages)-1]
					logger.Debugf(ctx, "Content Fallback Check - Last Message Role: %s", lastMsg.Role)
					if lastMsg.Role == "tool" {
						isAnsweringPhase = true
					}
				}

				if !isDuplicate {
					if !isAnsweringPhase {
						detectedToolCalls := tools.DetectToolCallsFromContent(contentStr)
						if len(detectedToolCalls) > 0 {
							validDetectedCalls := filterDuplicateToolCallsFromContent(ctx, getCurrentSkillName(), detectedToolCalls, sessionFileVersions)

							if len(validDetectedCalls) > 0 {
								logger.Infof(ctx, "Detected %d tool calls from content fallback", len(validDetectedCalls))
								message.ToolCalls = validDetectedCalls
								choice.Message.ToolCalls = validDetectedCalls
							}
						}
					} else {
						logger.Infof(ctx, "Skipping content fallback detection in answering phase to prevent hallucination loop")
					}
				} else {
					logger.Warnf(ctx, "Detected duplicate content with potential tool calls, ignoring to prevent loop")
				}
			}
		}

		// Filter duplicate tool calls within this turn.
		if len(message.ToolCalls) > 0 {
			injectedTools := getInjectedToolNames()
			newToolCalls := filterDuplicateToolCallsForTurn(ctx, getCurrentSkillName(), message.ToolCalls, injectedTools, sessionFileVersions)
			message.ToolCalls = newToolCalls
			// Update the choice message to reflect filtered calls
			choice.Message.ToolCalls = newToolCalls
		}

		// 5. Check for Tool Calls
		if len(message.ToolCalls) > 0 {
			logger.Infof(ctx, "Agent detected %d tool calls", len(message.ToolCalls))
			if content, ok := message.Content.(string); ok {
				sanitizedContent := sanitizeAssistantContentForToolCalls(content)
				if sanitizedContent != content {
					logger.Debugf(ctx, "Sanitized assistant content for tool calls: original_chars=%d, sanitized_chars=%d",
						len(content), len(sanitizedContent))
				}
				message.Content = sanitizedContent
				choice.Message.Content = sanitizedContent
			}

			// Notify client (if streaming)
			if chatRequest.Stream {
				// Send tool execution start step with skill name
				skillDisplayName := getCurrentSkillName()
				if skillDisplayName == "" {
					skillDisplayName = "工具"
				}
				messageStatus.StepSender.SendStartStep(STEP_TOOL_EXECUTION, fmt.Sprintf("正在执行 %s...", skillDisplayName), map[string]interface{}{
					"tool_calls": message.ToolCalls,
					"skill_name": skillDisplayName,
				})

				// Keep compatible with existing process step
				// sendToolProcessingStep(c, messageStatus.RequestId, message.ToolCalls)
			}

			// Append Assistant Message with Tool Calls
			// Append assistant message
			appendAgentAssistantMessage(c, chatRequest, message, reasoningStr)
			logger.Debugf(ctx, "Appended Assistant Message. Total messages: %d", len(chatRequest.Messages))

			// Execute Tools
			// 本次工具执行生成的文件
			var turnOutputFiles []*model.UploadFile
			var repeatedToolFailureHint string
			var turnHasReadOnlyTool bool
			var turnHasMutatingTool bool
			var turnOutcome agentToolTurnOutcome

			for _, toolCall := range message.ToolCalls {
				functionName := toolCall.Function.Name
				argsStr := toolCall.Function.Arguments
				toolStartTime := time.Now()
				toolStatus := model.ToolCallStatusSuccess
				toolErrorMsg := ""
				toolCallRecordID := int64(0)

				logger.Debugf(ctx, "【工具执行】开始执行工具: turn=%d, skill=%s, tool=%s", turnCount, getCurrentSkillName(), functionName)
				if isReadOnlyRelayToolName(functionName) {
					turnHasReadOnlyTool = true
				}
				if isMutatingRelayToolName(functionName) {
					turnHasMutatingTool = true
				}

				var argsStrString string
				if s, ok := argsStr.(string); ok {
					argsStrString = s
				} else {
					// Handle non-string arguments (e.g. if already parsed map)
					bytes, _ := json.Marshal(argsStr)
					argsStrString = string(bytes)
				}
				logger.Debugf(ctx, "【工具执行】工具参数摘要: turn=%d, skill=%s, tool=%s, args_chars=%d", turnCount, getCurrentSkillName(), functionName, len(argsStrString))

				if messageID := getCurrentMessageID(); messageID > 0 {
					channelID := int64(0)
					if executionChannel != nil {
						channelID = executionChannel.ChannelID
					}
					toolCallRecord := &model.MessageToolCall{
						Eid:          agent.Eid,
						MessageID:    messageID,
						TurnNumber:   turnCount,
						ToolName:     functionName,
						ToolCallID:   toolCall.Id,
						FunctionName: functionName,
						Arguments:    argsStrString,
						Status:       model.ToolCallStatusRunning,
						SkillName:    getCurrentSkillName(),
						ChannelID:    channelID,
						ModelName:    requestModel,
					}
					if err := model.CreateMessageToolCall(toolCallRecord); err != nil {
						logger.Warnf(ctx, "【工具执行】创建工具调用记录失败: turn=%d, skill=%s, tool=%s, err=%v",
							turnCount, getCurrentSkillName(), functionName, err)
					} else {
						toolCallRecordID = toolCallRecord.ID
					}
				}

				updateToolCallRecord := func(output string) {
					if toolCallRecordID <= 0 {
						return
					}
					if err := model.UpdateMessageToolCallResult(toolCallRecordID, toolStatus, output, toolErrorMsg, time.Since(toolStartTime).Milliseconds()); err != nil {
						logger.Warnf(ctx, "【工具执行】更新工具调用记录失败: turn=%d, skill=%s, tool=%s, record_id=%d, err=%v",
							turnCount, getCurrentSkillName(), functionName, toolCallRecordID, err)
					}
				}

				var output string
				var llmOutput string
				resultExitCode := 0
				args, err := tools.ParseToolArguments(argsStrString)
				oversizedWriteRecovered := false
				if err != nil {
					logger.Warnf(ctx, "【工具执行】工具参数解析失败: turn=%d, skill=%s, tool=%s, err=%v", turnCount, getCurrentSkillName(), functionName, err)
					output = "参数解析失败，请检查工具调用格式"
					llmOutput = buildToolArgParseFailureLLMOutput(functionName, argsStrString, err)
					resultExitCode = -1
					toolStatus = model.ToolCallStatusFailed
					toolErrorMsg = err.Error()
				} else if isWriteLikeTool(functionName) && len(argsStrString) > maxWriteFileArgsChars && !shouldAutoRecoverLargeWriteLikeCall(functionName, len(argsStrString), args) {
					err := fmt.Errorf("tool arguments too large: %d > %d chars", len(argsStrString), maxWriteFileArgsChars)
					logger.Warnf(ctx, "【工具执行】工具参数超限: turn=%d, skill=%s, tool=%s, args_chars=%d, max_allowed=%d",
						turnCount, getCurrentSkillName(), functionName, len(argsStrString), maxWriteFileArgsChars)
					output = fmt.Sprintf("参数过长，已拒绝执行（%d > %d）", len(argsStrString), maxWriteFileArgsChars)
					llmOutput = buildToolArgTooLargeLLMOutput(functionName, len(argsStrString), maxWriteFileArgsChars, argsStrString)
					resultExitCode = -1
					toolStatus = model.ToolCallStatusFailed
					toolErrorMsg = err.Error()
				} else {
					if shouldAutoRecoverLargeWriteLikeCall(functionName, len(argsStrString), args) {
						oversizedWriteRecovered = true
						logger.Warnf(ctx, "【工具执行】大参数写入触发自动接管: turn=%d, skill=%s, tool=%s, args_chars=%d, write_content_chars=%d, max_allowed=%d",
							turnCount, getCurrentSkillName(), functionName, len(argsStrString), writeLikeContentLength(args), maxWriteFileArgsChars)
					}

					toolCtx := buildSkillToolContext(ctx, messageStatus, conversationSandboxID, toolSessionID, agent.Eid, agent.AgentID, config.GetUserId(c))
					if messageStatus != nil && len(messageStatus.UploadedFiles) > 0 {
						logger.Infof(ctx, "Injected %d uploaded files to tool context", len(messageStatus.UploadedFiles))
					}

					// 使用 ExecuteToolStream 进行流式执行（当客户端启用流式时）
					// 否则使用非流式执行
					var toolResult *tools.ToolResult
					if oversizedWriteRecovered {
						path, _ := args["path"].(string)
						content, _ := args["content"].(string)
						seedCtx := context.WithValue(toolCtx, tools.RuntimeSeedFilesKey, map[string]string{path: content})
						seedResult, seedErr := tools.ExecuteToolWithResult(seedCtx, "run_shell", map[string]interface{}{"command": ":"})
						if seedErr != nil {
							err = seedErr
						} else {
							toolResult = &tools.ToolResult{
								Output:      fmt.Sprintf("Wrote %d bytes to %s", len(content), path),
								Stderr:      seedResult.Stderr,
								ExitCode:    seedResult.ExitCode,
								OutputFiles: seedResult.OutputFiles,
							}
						}
					} else if chatRequest.Stream {
						// 创建流式处理器，将事件发送给客户端
						handler := func(event tools.SandboxStreamEvent) {
							handleSandboxStreamEvent(c, messageStatus.RequestId, event, toolCall.Id, functionName)
						}
						toolResult, err = tools.ExecuteToolStream(toolCtx, functionName, args, handler)
					} else {
						toolResult, err = tools.ExecuteToolWithResult(toolCtx, functionName, args)
					}
					if err != nil {
						logger.Errorf(ctx, "【工具执行】工具执行失败: turn=%d, skill=%s, tool=%s, err=%v", turnCount, getCurrentSkillName(), functionName, err)
						output = fmt.Sprintf("Error executing tool: %v", err)
						llmOutput = buildToolExecutionFailureLLMOutput(functionName, output, err)
						resultExitCode = -1
						toolStatus = model.ToolCallStatusFailed
						toolErrorMsg = err.Error()
						recordRepeatedSandboxToolFailure(toolFailureCount, &repeatedToolFailureHint, functionName, argsStrString, output, err)
					} else {
						output = toolResult.Output
						llmOutput = sanitizeToolOutputForLLM(functionName, toolResult.Output)
						resultExitCode = toolResult.ExitCode
						if oversizedWriteRecovered {
							path, _ := args["path"].(string)
							content, _ := args["content"].(string)
							llmPayload := map[string]interface{}{
								"__tool_result__": "WRITE_FILE_VIA_RUNTIME_SEED",
								"__tool_name__":   functionName,
								"__path__":        path,
								"__bytes__":       len(content),
								"__message__":     "Oversized write payload was materialized via runtime seed file injection.",
							}
							if encoded, marshalErr := json.Marshal(llmPayload); marshalErr == nil {
								llmOutput = string(encoded)
							}
						}
						logger.Debugf(ctx, "【工具执行】工具执行完成: turn=%d, skill=%s, tool=%s, output_chars=%d, llm_output_chars=%d, output_file_count=%d",
							turnCount, getCurrentSkillName(), functionName, len(output), len(llmOutput), len(toolResult.OutputFiles))
						if output != llmOutput {
							logger.Debugf(ctx, "【工具执行】裁剪工具结果用于LLM: turn=%d, skill=%s, tool=%s, raw_chars=%d, llm_chars=%d",
								turnCount, getCurrentSkillName(), functionName, len(output), len(llmOutput))
						}
						if isSandboxRuntimeToolName(functionName) && toolResult.ExitCode != 0 {
							llmOutput = buildToolExecutionFailureLLMOutput(functionName, output, nil)
							toolStatus = model.ToolCallStatusFailed
							toolErrorMsg = fmt.Sprintf("exit_code=%d", toolResult.ExitCode)
							recordRepeatedSandboxToolFailure(toolFailureCount, &repeatedToolFailureHint, functionName, argsStrString, output, nil)
						}
						toolUsageCount[functionName]++
						recordSessionFileMutation(sessionFileVersions, functionName, args)

						// 保存 AI 上传文件
						if len(toolResult.OutputFiles) > 0 {
							dedupedOutputFiles, skippedNames := filterNewSandboxOutputFilesByFingerprint(seenOutputFileFingerprints, toolResult.OutputFiles)
							fileNames := make([]string, 0, len(dedupedOutputFiles))
							for _, outputFile := range dedupedOutputFiles {
								fileNames = append(fileNames, outputFile.FileName)
							}
							if len(skippedNames) > 0 {
								logger.Debugf(ctx, "【沙盒】跳过重复输出文件: turn=%d, skill=%s, skipped_count=%d, file_names=%v",
									turnCount, getCurrentSkillName(), len(skippedNames), skippedNames)
							}
							if len(dedupedOutputFiles) == 0 {
								logger.Infof(ctx, "No new output files from tool after dedupe: %s", functionName)
							} else {
								logger.Debugf(ctx, "【工具执行】工具产出文件摘要: turn=%d, skill=%s, tool=%s, file_count=%d, file_names=%v",
									turnCount, getCurrentSkillName(), functionName, len(dedupedOutputFiles), fileNames)
								// 获取 master message ID
								messageID := getCurrentMessageID()

								if messageID > 0 {
									fileStorageManager := tools.GetFileStorageManager()
									eid := config.GetEID(c)
									userID := config.GetUserId(c)
									savedFiles, saveErr := fileStorageManager.SaveAIUploadFiles(ctx, messageID, eid, userID, dedupedOutputFiles)
									if saveErr != nil {
										logger.Errorf(ctx, "Failed to save AI upload files: %v", saveErr)
									} else {
										turnOutputFiles = mergeAIUploadFilesKeepLast(turnOutputFiles, savedFiles...)
										savedNames := make([]string, 0, len(savedFiles))
										for _, savedFile := range savedFiles {
											savedNames = append(savedNames, savedFile.FileName)
										}
										logger.Debugf(ctx, "【沙盒】本轮 AI 上传文件已落库: turn=%d, skill=%s, message_id=%d, saved_count=%d, file_names=%v",
											turnCount, getCurrentSkillName(), messageID, len(savedFiles), savedNames)
									}
								} else {
									logger.Warnf(ctx, "No master message ID found, skipping file save")
								}
							}
						} else {
							logger.Infof(ctx, "No output files from tool: %s", functionName)
						}
					}
				}
				if hint := toolLoopState.ObserveToolResult(functionName, llmOutput, resultExitCode); hint != "" && repeatedToolLoopHint == "" {
					repeatedToolLoopHint = hint
				}
				turnOutcome.Observe(agentToolExecutionSignal{
					FunctionName: functionName,
					ArgsString:   argsStrString,
					Status:       toolStatus,
					ExitCode:     resultExitCode,
					LLMOutput:    llmOutput,
				})

				// Send tool result step immediately
				if chatRequest.Stream {
					skillDisplayName := getCurrentSkillName()
					if skillDisplayName == "" {
						skillDisplayName = "工具"
					}
					stepResult, resultTruncated := compactToolResultPreview(output)
					toolResultStep := ProcessStep{
						StepCode: "tool_result",
						Name:     fmt.Sprintf("%s 执行结果", skillDisplayName),
						Status:   "completed",
						Message:  fmt.Sprintf("%s 执行完成", skillDisplayName),
						Data: map[string]interface{}{
							"tool_call_id":     toolCall.Id,
							"function_name":    functionName,
							"skill_name":       skillDisplayName,
							"result":           stepResult,
							"result_truncated": resultTruncated,
						},
						Timestamp: time.Now().Unix(),
					}
					if err := sendProcessStep(c, messageStatus.RequestId, toolResultStep); err != nil {
						logger.Warnf(ctx, "Failed to send tool result step: %v", err)
					} else {
						recordProcessStepForHistory(ctx, config.GetEID(c), messageStatus, messageStatus.RequestId, toolResultStep)
					}
				}

				// Append Tool Message
				toolMsg := relay_model.Message{
					Role:       "tool",
					Content:    llmOutput,
					ToolCallId: toolCall.Id,
					Name:       &functionName,
				}
				chatRequest.Messages = append(chatRequest.Messages, toolMsg)
				logger.Debugf(ctx, "【工具执行】工具结果已写回上下文: turn=%d, skill=%s, tool=%s, tool_call_id=%s, output_chars=%d, llm_output_chars=%d",
					turnCount, getCurrentSkillName(), functionName, toolCall.Id, len(output), len(llmOutput))
				logger.Debugf(ctx, "Appended Tool Message. Total messages: %d. ToolCallID: %s", len(chatRequest.Messages), toolCall.Id)
				updateToolCallRecord(output)
			}

			if chatRequest.Stream {
				skillDisplayName := getCurrentSkillName()
				if skillDisplayName == "" {
					skillDisplayName = "工具"
				}
				messageStatus.StepSender.SendEndStep(STEP_TOOL_EXECUTION, fmt.Sprintf("%s 调用完成", skillDisplayName), nil)
			}

			// Loop continues
			logger.Debugf(ctx, "【技能运行】合并本轮输出文件: turn=%d, skill=%s, turn_file_count=%d, session_file_count_before=%d",
				turnCount, getCurrentSkillName(), len(turnOutputFiles), len(sessionOutputFiles))
			if len(turnOutputFiles) > 0 {
				sessionOutputFiles = mergeAIUploadFilesKeepLast(sessionOutputFiles, turnOutputFiles...)
				sessionNames := make([]string, 0, len(sessionOutputFiles))
				for _, sessionFile := range sessionOutputFiles {
					sessionNames = append(sessionNames, sessionFile.FileName)
				}
				logger.Debugf(ctx, "【技能运行】会话输出文件汇总: turn=%d, skill=%s, session_file_count_after=%d, file_names=%v",
					turnCount, getCurrentSkillName(), len(sessionOutputFiles), sessionNames)
			}

			if hint := toolLoopState.ObserveTurn(turnHasReadOnlyTool, turnHasMutatingTool, len(turnOutputFiles) > 0); hint != "" && repeatedToolLoopHint == "" {
				repeatedToolLoopHint = hint
			}

			if repeatedToolFailureHint != "" {
				chatRequest.Messages = append(chatRequest.Messages, relay_model.Message{
					Role:    "system",
					Content: repeatedToolFailureHint,
				})
				logger.Warnf(ctx, "Injected repeated sandbox tool failure hint: %s", repeatedToolFailureHint)
			}
			if repeatedToolLoopHint != "" {
				chatRequest.Messages = append(chatRequest.Messages, relay_model.Message{
					Role:    "system",
					Content: repeatedToolLoopHint,
				})
				logger.Warnf(ctx, "Injected repeated tool loop hint: %s", repeatedToolLoopHint)
			}
			nextStreamPhase = turnOutcome.NextStreamPhase()
			if repeatedToolFailureHint != "" || repeatedToolLoopHint != "" {
				nextStreamPhase = agentStreamPhasePlanning
			}
			logger.Debugf(ctx, "【技能运行】下一轮流式阶段: turn=%d, skill=%s, next_stream_phase=%s",
				turnCount, getCurrentSkillName(), nextStreamPhase)
		} else {
			// No tool calls -> Final Answer (default DONE behavior)
			finalAnswerContent := sanitizeFinalAssistantContent(contentStr)
			currentRunMessages := chatRequest.Messages
			if runStartMsgCount >= 0 && runStartMsgCount <= len(chatRequest.Messages) {
				currentRunMessages = chatRequest.Messages[runStartMsgCount:]
			}
			finalAnswerContent = ensureNonEmptyFinalAssistantContent(finalAnswerContent, currentRunMessages, getCurrentSkillName())
			passthrough := deltaCollector != nil && deltaCollector.IsPassthrough()
			logger.Infof(ctx, "Agent loop finished (no tool calls), returning final answer, streamIntermediate=%v, passthrough=%v", streamIntermediate, passthrough)
			syncFinalAIUploadFiles(sessionOutputFiles, sessionFolderPath)

			if chatRequest.Stream {
				if len(sseSteps) > 0 {
					if responseRecorder != nil {
						replayBufferedHeaders(c, responseRecorder)
					}
					SetUpStreamResponseHeaders(c)
					c.Writer.Write(sseSteps)
					if f, ok := c.Writer.(http.Flusher); ok {
						f.Flush()
					}
				}
				sendOutputFilesStep(c, ctx, messageStatus.RequestId, sessionOutputFiles, messageStatus, true)
				if passthrough {
					// 从 delta collector 获取 passthrough 期间跟踪的内容
					passthroughAnswer, passthroughReasoning := "", ""
					passthroughDeltas := []string(nil)
					if deltaCollector != nil {
						passthroughAnswer, passthroughReasoning = deltaCollector.GetPassthroughContent()
						passthroughDeltas = deltaCollector.GetPassthroughContentDeltas()
					}
					if collectedAnswer, collectedReasoning := getCollectedStreamResponseContent(c); strings.TrimSpace(collectedAnswer) != "" {
						passthroughAnswer = collectedAnswer
						if strings.TrimSpace(collectedReasoning) != "" && passthroughReasoning == "" {
							passthroughReasoning = collectedReasoning
						}
					}
					if passthroughReasoning != "" && reasoningStr == "" {
						reasoningStr = passthroughReasoning
					}
					if deltaCollector != nil && !deltaCollector.IsUpstreamComplete() {
						logger.Warnf(ctx, "【技能运行】上游流未完整结束，跳过最终回答写入: request_id=%s, message_id=%d", messageStatus.RequestId, getCurrentMessageID())
						finalizeAgentRunForMessage(ctx, agent, conversation.ConversationID, getCurrentMessageID(), messageStatus.RequestId, model.AgentRunStatusFailed, "incomplete_stream", "upstream stream ended before finish_reason or DONE")
						return
					}

					// 持久化 message.delta（让 subscribe 也能看到逐段内容）
					for _, delta := range passthroughDeltas {
						mirrorAgentRunTimelineEvent(c, messageStatus.RequestId, model.AgentRunEventMessageDelta, map[string]interface{}{
							"choices": []map[string]interface{}{
								{
									"delta": relay_model.Message{
										Content: delta,
									},
								},
							},
						})
					}

					finishChunk := openai_model.ChatCompletionsStreamResponse{
						Id:      messageStatus.RequestId,
						Object:  "chat.completion.chunk",
						Created: time.Now().Unix(),
						Model:   requestModel,
						Choices: []openai_model.ChatCompletionsStreamResponseChoice{
							{Delta: relay_model.Message{Content: ""}, FinishReason: stringPtr("stop")},
						},
					}
					finishBytes, _ := json.Marshal(finishChunk)
					c.Writer.Write([]byte("data: "))
					c.Writer.Write(finishBytes)
					c.Writer.Write([]byte("\n\n"))
					if flusher, ok := c.Writer.(http.Flusher); ok {
						flusher.Flush()
					}

					// Send message.completed SSE event（使用 passthrough 跟踪到的真实内容）
					msgID := getCurrentMessageID()
					if msgID > 0 {
						payload := map[string]interface{}{
							"event_type": model.AgentRunEventMessageDone,
							"answer":     passthroughAnswer,
						}
						if reasoningStr != "" {
							payload["reasoning_content"] = reasoningStr
						}
						completedBytes, _ := json.Marshal(payload)
						c.Writer.Write([]byte("data: "))
						c.Writer.Write(completedBytes)
						c.Writer.Write([]byte("\n\n"))
						if flusher, ok := c.Writer.(http.Flusher); ok {
							flusher.Flush()
						}
					}

					if !config.IsSSECompactMode() {
						c.Writer.Write([]byte("data: [DONE]\n\n"))
						if flusher, ok := c.Writer.(http.Flusher); ok {
							flusher.Flush()
						}
					}
					mirrorAgentRunFinalResponse(c, messageStatus.RequestId, msgID, passthroughAnswer, reasoningStr)
				} else {
					var finalDeltas []string
					if deltaCollector != nil {
						finalDeltas = deltaCollector.GetContentDeltas()
					}
					sendStreamResponse(c, messageStatus.RequestId, requestModel, finalAnswerContent, reasoningStr, getCurrentMessageID(), finalDeltas)
				}
			} else {
				sendOutputFilesStep(c, ctx, messageStatus.RequestId, sessionOutputFiles, messageStatus, false)
				replaySanitizedAssistantResponse(c, responseRecorder, openaiResp, finalAnswerContent, sessionOutputFiles, responseBody)
			}
			if masterMsgID > 0 {
				finalizeAgentRunForMessage(ctx, agent, conversation.ConversationID, masterMsgID, requestID, model.AgentRunStatusCompleted, "", "")
			}
			return
		}

		for funcName, count := range toolUsageCount {
			if count >= 3 {
				hintMsg := relay_model.Message{
					Role:    "system",
					Content: fmt.Sprintf("System Note: You have executed tool '%s' %d times. Please consolidate your findings and provide a final answer unless absolutely critical.", funcName, count),
				}
				chatRequest.Messages = append(chatRequest.Messages, hintMsg)
				logger.Warnf(ctx, "Injected loop prevention hint for tool %s (count: %d)", funcName, count)
				break
			}
		}

		softTrimmed, hardCleared := pruneHistoricalToolMessagesForContext(chatRequest.Messages, runStartMsgCount)
		if softTrimmed > 0 || hardCleared > 0 {
			logger.Infof(ctx, "Context-pruned historical tool messages: soft_trimmed=%d, hard_cleared=%d, protected_start=%d",
				softTrimmed, hardCleared, runStartMsgCount)
		}
	}

	// Safety fallback: ensure we always return a response when max turns reached.
	// Without this guard, requests may terminate without any final payload.
	logger.Warnf(ctx, "Agent loop reached max turns (%d) without terminal response", maxTurns)
	fallbackContent := "已达到最大工具执行轮次限制，已停止继续调用工具。请基于当前结果给出总结，或调整请求后重试。"
	finalRequestID := requestID
	if messageStatus != nil && messageStatus.RequestId != "" {
		finalRequestID = messageStatus.RequestId
	}

	syncFinalAIUploadFiles(sessionOutputFiles, sessionFolderPath)
	if chatRequest.Stream {
		sendOutputFilesStep(c, ctx, finalRequestID, sessionOutputFiles, messageStatus, true)

		sendStreamResponse(c, finalRequestID, requestModel, fallbackContent, "", getCurrentMessageID(), nil)
		if masterMsgID > 0 {
			finalizeAgentRunForMessage(ctx, agent, conversation.ConversationID, masterMsgID, requestID, model.AgentRunStatusCompleted, "max_turns_reached", "Agent loop reached max turns")
		}
		return
	}

	fallbackResp := OpenAITextResponse{
		Id:      finalRequestID,
		Object:  "chat.completion",
		Created: time.Now().Unix(),
		Model:   requestModel,
		Choices: []struct {
			Index        int                 `json:"index"`
			Message      relay_model.Message `json:"message"`
			FinishReason string              `json:"finish_reason"`
		}{
			{
				Index: 0,
				Message: relay_model.Message{
					Role:    "assistant",
					Content: fallbackContent,
				},
				FinishReason: "stop",
			},
		},
	}
	body, err := json.Marshal(fallbackResp)
	if err != nil {
		c.JSON(200, fallbackResp)
		return
	}
	c.Data(200, "application/json; charset=utf-8", injectOutputFilesToResponse(body, sessionOutputFiles))
	if masterMsgID > 0 {
		finalizeAgentRunForMessage(ctx, agent, conversation.ConversationID, masterMsgID, requestID, model.AgentRunStatusCompleted, "max_turns_reached", "Agent loop reached max turns")
	}
}

// Helper to execute single LLM request (extracted from processChatRequestV2)
func executeLLMRequest(c *gin.Context, chatRequest *ChatRequest, ctx context.Context, messageStatus *MessageStatsInfo,
	requestModel string, relayMode int, retryTimes int, executionChannel *model.Channel) *model.OpenAIErrorResponse {

	if executionChannel == nil {
		return &model.OpenAIErrorResponse{
			Error: model.OpenAIError{
				Message: "No execution channel provided",
				Type:    "53aihub_error",
			},
		}
	}

	middleware.SetupContextForSelectedChannel(c, executionChannel, requestModel)

	// [阶段1: 清理文件内容] 传给渠道前，清理消息中的文件内容
	// 文件已上传到沙盒，下游渠道可直接访问，无需通过消息传递大文件内容
	var baseRequestBody []byte
	cleanedMessages := cleanupMessageFileContents(chatRequest.Messages, messageStatus.UploadedFiles)
	sanitizedMessages, sanitizeStats := sanitizeRelayMessagesForModel(cleanedMessages)
	if sanitizeStats.HasChanges() {
		logger.Debugf(ctx, "executeLLMRequest: sanitized relay transcript, dropped_empty=%d dropped_tool=%d dropped_duplicate_tool_calls=%d merged_plain=%d",
			sanitizeStats.DroppedEmptyMessages, sanitizeStats.DroppedToolMessages, sanitizeStats.DroppedDuplicateToolCalls, sanitizeStats.MergedPlainMessages)
	}
	if len(cleanedMessages) != len(chatRequest.Messages) || sanitizeStats.HasChanges() || len(messageStatus.UploadedFiles) > 0 {
		// 创建了新的请求体，使用清理后的消息
		cleanedRequest := *chatRequest
		cleanedRequest.Messages = sanitizedMessages
		modifiedBody, _ := json.Marshal(cleanedRequest)
		c.Request.Body = io.NopCloser(bytes.NewBuffer(modifiedBody))
		c.Set(ctxkey.KeyRequestBody, modifiedBody)
		logger.Debugf(ctx, "executeLLMRequest: cleaned up file contents from messages, uploaded files: %d", len(messageStatus.UploadedFiles))
		baseRequestBody = modifiedBody
	} else {
		requestBody, _ := oneapi_common.GetRequestBody(c)
		c.Request.Body = io.NopCloser(bytes.NewBuffer(requestBody))
		baseRequestBody = requestBody
	}

	availableChannelCount, err := model.CountAvailableChannels(executionChannel.Eid, executionChannel.Type, requestModel)
	if err != nil {
		logger.Warnf(ctx, "count available channels failed, fallback to single-channel retry: %v", err)
		availableChannelCount = 1
	}
	if messageStatus != nil && messageStatus.AgentModel != nil && messageStatus.AgentModel.SpecificChannelID > 0 {
		availableChannelCount = 1
	}

	var lastFailedChannelId int64
	retryCount := retryTimes
	if retryCount < 1 {
		retryCount = 1
	}

	var bizErr *relay_model.ErrorWithStatusCode
	for attempt := 1; attempt <= retryCount; attempt++ {
		currentChannel := executionChannel
		if attempt > 1 && availableChannelCount > 1 {
			selectedChannel, selectErr := service.GetChannelWithTokenRefresh(ctx, executionChannel.Eid, executionChannel.Type, requestModel, lastFailedChannelId)
			if selectErr != nil {
				logger.Warnf(ctx, "retry channel selection failed (attempt=%d, channelID=%d): %v", attempt, lastFailedChannelId, selectErr)
			} else if selectedChannel != nil {
				currentChannel = selectedChannel
			}
		}

		middleware.SetupContextForSelectedChannel(c, currentChannel, requestModel)
		c.Request.Body = io.NopCloser(bytes.NewBuffer(baseRequestBody))
		c.Set(ctxkey.KeyRequestBody, baseRequestBody)

		bizErr = RelayTextHelper(c, messageStatus)
		if bizErr == nil {
			return nil
		}

		if !shouldRetryRelayError(bizErr) {
			channelId := currentChannel.ChannelID
			channelName := currentChannel.Name
			go processChannelRelayError(ctx, int(config.GetUserId(c)), int(channelId), channelName, *bizErr)
			logger.Warnf(ctx, "Non-retryable channel error (status=%d, channelID=%d): %v", bizErr.StatusCode, currentChannel.ChannelID, bizErr)
			break
		}
		if !shouldRetryRelayWithContext(c, chatRequest, bizErr) {
			channelId := currentChannel.ChannelID
			channelName := currentChannel.Name
			go processChannelRelayError(ctx, int(config.GetUserId(c)), int(channelId), channelName, *bizErr)
			logger.Warnf(ctx, "Skip retry because stream response already started (attempt=%d/%d, channelID=%d, status=%d)",
				attempt, retryCount, currentChannel.ChannelID, bizErr.StatusCode)
			break
		}

		channelId := currentChannel.ChannelID
		lastFailedChannelId = channelId
		channelName := currentChannel.Name
		go processChannelRelayError(ctx, int(config.GetUserId(c)), int(channelId), channelName, *bizErr)
		logger.Warnf(ctx, "Channel call failed (attempt=%d/%d, channelID=%d): %v", attempt, retryCount, currentChannel.ChannelID, bizErr)

		if attempt == retryCount {
			break
		}
	}

	if bizErr == nil {
		return nil
	}

	errResp := openAIErrorResponseFromRelayError(bizErr)
	return &errResp
}

func sendToolProcessingStep(c *gin.Context, requestId string, toolCalls any) {
	// Using ProcessSender logic
}

// handleSandboxStreamEvent processes sandbox SSE events and emits process steps
func handleSandboxStreamEvent(c *gin.Context, requestId string, event tools.SandboxStreamEvent, toolCallId string, functionName string) {
	switch event.EventType {
	case "tool.started":
		logger.Debugf(c, "【工具执行】Tool started: %s, request_id: %v", functionName, event.Data["request_id"])
		startStep := ProcessStep{
			StepCode:  "tool_started",
			Name:      "工具启动",
			Status:    "start",
			Message:   fmt.Sprintf("工具 %s 开始执行", functionName),
			Data:      map[string]interface{}{"tool_call_id": toolCallId, "function_name": functionName},
			Timestamp: time.Now().Unix(),
		}
		if err := sendProcessStep(c, requestId, startStep); err != nil {
			logger.Warnf(c, "Failed to send tool_started step: %v", err)
		}

	case "stdout.delta", "tool.stdout.delta":
		content, _ := event.Data["content"].(string)
		if content != "" {
			queueToolLogDelta(c, requestId, content, toolCallId, functionName, "stdout")
		}

	case "stderr.delta", "tool.stderr.delta":
		content, _ := event.Data["content"].(string)
		if content != "" {
			queueToolLogDelta(c, requestId, content, toolCallId, functionName, "stderr")
		}

	case "tool.completed":
		flushToolLogDeltaBuffer(c, requestId, fmt.Sprintf("%s|%s", toolCallId, "stdout"), toolCallId, functionName, "stdout", true)
		flushToolLogDeltaBuffer(c, requestId, fmt.Sprintf("%s|%s", toolCallId, "stderr"), toolCallId, functionName, "stderr", true)

		exitCode := 0
		switch v := event.Data["exit_code"].(type) {
		case float64:
			exitCode = int(v)
		case int:
			exitCode = v
		}

		execTime := 0.0
		switch v := event.Data["execution_time"].(type) {
		case float64:
			execTime = v
		case int:
			execTime = float64(v)
		}

		outputFilesCount := 0
		if files, ok := event.Data["output_files"].([]interface{}); ok {
			outputFilesCount = len(files)
		}

		logger.Debugf(c, "【工具执行】Tool completed: %s, exit_code=%d, time=%.3fs", functionName, exitCode, execTime)
		completedStep := ProcessStep{
			StepCode:  "tool_completed",
			Name:      "工具执行完成",
			Status:    "completed",
			Message:   fmt.Sprintf("工具 %s 执行完成", functionName),
			Data:      map[string]interface{}{"tool_call_id": toolCallId, "function_name": functionName, "exit_code": exitCode, "execution_time": execTime, "output_files_count": outputFilesCount},
			Timestamp: time.Now().Unix(),
		}
		if err := sendProcessStep(c, requestId, completedStep); err != nil {
			logger.Warnf(c, "Failed to send tool_completed step: %v", err)
		}

	case "error":
		// Error event - log it
		errMsg, _ := event.Data["message"].(string)
		logger.Errorf(c, "【工具执行】Sandbox error: %s", errMsg)
	}
}

func sendStreamResponse(c *gin.Context, requestId, modelName, content, reasoningContent string, messageID int64, contentDeltas []string) {

	// 客户端已断开时跳过 SSE 发送，但仍要把 deltas 和最终事件持久化到 agent_run_events，
	// 否则 subscribe 端在重连后既看不到逐段内容、也无法增量回放最终答案。
	clientDisconnected := false
	if c != nil && c.Request != nil {
		select {
		case <-c.Request.Context().Done():
			clientDisconnected = true
		default:
		}
	}
	if clientDisconnected {
		if messageID <= 0 {
			if masterMsgIDVal, exists := c.Get("agent_master_message_id"); exists {
				if id, ok := masterMsgIDVal.(int64); ok && id > 0 {
					messageID = id
				}
			}
		}
		segments := buildFinalStreamSegments(content, contentDeltas)
		for _, segment := range segments {
			if segment == "" {
				continue
			}
			mirrorAgentRunTimelineEvent(c, requestId, model.AgentRunEventMessageDelta, map[string]interface{}{
				"choices": []map[string]interface{}{
					{
						"delta": relay_model.Message{
							Content: segment,
						},
					},
				},
			})
		}
		mirrorAgentRunFinalResponse(c, requestId, messageID, content, reasoningContent)
		return
	}

	// 1. Setup headers
	SetUpStreamResponseHeaders(c)

	// 2. Send opening chunk (with message ID)
	if messageID <= 0 {
		if masterMsgIDVal, exists := c.Get("agent_master_message_id"); exists {
			if id, ok := masterMsgIDVal.(int64); ok && id > 0 {
				messageID = id
			}
		}
	}
	if err := sendMessageIDFirstFrame(c, requestId, modelName, messageID); err != nil {
		logger.Warnf(c.Request.Context(), "sendMessageIDFirstFrame failed in sendStreamResponse: %v", err)
	}

	segments := buildFinalStreamSegments(content, contentDeltas)
	if len(contentDeltas) > 0 {
		var merged strings.Builder
		for _, seg := range contentDeltas {
			merged.WriteString(seg)
		}
		logger.Debugf(c.Request.Context(),
			"final stream segments built: delta_count=%d, merged_chars=%d, content_chars=%d, exact_match=%v, emitted_segments=%d",
			len(contentDeltas), merged.Len(), len(content), merged.String() == content, len(segments))
	} else {
		logger.Debugf(c.Request.Context(),
			"final stream segments built: delta_count=0, content_chars=%d, emitted_segments=%d",
			len(content), len(segments))
	}

	// 3. Send content chunks + persist message.delta
	for _, segment := range segments {
		if segment == "" {
			continue
		}
		chunk := openai_model.ChatCompletionsStreamResponse{
			Id:      requestId,
			Object:  "chat.completion.chunk",
			Created: time.Now().Unix(),
			Model:   modelName,
			Choices: []openai_model.ChatCompletionsStreamResponseChoice{
				{
					Delta: relay_model.Message{
						Content: segment,
					},
					FinishReason: nil, // Not finished yet
				},
			},
		}

		chunkBytes, _ := json.Marshal(chunk)
		c.Writer.Write([]byte("data: "))
		c.Writer.Write(chunkBytes)
		c.Writer.Write([]byte("\n\n"))

		// 持久化 message.delta（供 subscribe 端点通过 agent_run_events 表消费）
		mirrorAgentRunTimelineEvent(c, requestId, model.AgentRunEventMessageDelta, map[string]interface{}{
			"choices": []map[string]interface{}{
				{
					"delta": relay_model.Message{
						Content: segment,
					},
				},
			},
		})
		if flusher, ok := c.Writer.(http.Flusher); ok {
			flusher.Flush()
		}
	}

	// 4. Send finishing chunk
	finishChunk := openai_model.ChatCompletionsStreamResponse{
		Id:      requestId,
		Object:  "chat.completion.chunk",
		Created: time.Now().Unix(),
		Model:   modelName,
		Choices: []openai_model.ChatCompletionsStreamResponseChoice{
			{
				Delta: relay_model.Message{
					Content: "",
				},
				FinishReason: stringPtr("stop"),
			},
		},
	}
	finishBytes, _ := json.Marshal(finishChunk)
	c.Writer.Write([]byte("data: "))
	c.Writer.Write(finishBytes)
	c.Writer.Write([]byte("\n\n"))
	if flusher, ok := c.Writer.(http.Flusher); ok {
		flusher.Flush()
	}

	// 5. Send SSE: message.completed — 位于 DONE 之前，与 OpenClaw 路径一致
	if messageID > 0 {
		payload := map[string]interface{}{
			"event_type": model.AgentRunEventMessageDone,
			"answer":     content,
		}
		if reasoningContent != "" {
			payload["reasoning_content"] = reasoningContent
		}
		completedBytes, _ := json.Marshal(payload)
		c.Writer.Write([]byte("data: "))
		c.Writer.Write(completedBytes)
		c.Writer.Write([]byte("\n\n"))
		if flusher, ok := c.Writer.(http.Flusher); ok {
			flusher.Flush()
		}
	}

	// 6. Send DONE (in compact mode, let defer handle it to ensure process steps are sent first)
	if !config.IsSSECompactMode() {
		c.Writer.Write([]byte("data: [DONE]\n\n"))
		if flusher, ok := c.Writer.(http.Flusher); ok {
			flusher.Flush()
		}
	}
	mirrorAgentRunFinalResponse(c, requestId, messageID, content, reasoningContent)
}

func stringPtr(s string) *string {
	return &s
}

func buildFinalStreamSegments(content string, contentDeltas []string) []string {
	fallback := []string{content}
	if len(contentDeltas) == 0 {
		return fallback
	}
	segments := make([]string, 0, len(contentDeltas))
	var merged strings.Builder
	for _, seg := range contentDeltas {
		if seg == "" {
			continue
		}
		segments = append(segments, seg)
		merged.WriteString(seg)
	}
	if len(segments) == 0 {
		return fallback
	}
	// Only replay captured deltas when they fully cover the final content.
	// Otherwise fallback to full content to avoid truncated final answers.
	if merged.String() != content {
		return fallback
	}
	return segments
}

func replayBufferedHeaders(c *gin.Context, recorder *GinResponseRecorder) {
	for k, v := range recorder.HeaderMap {
		for _, val := range v {
			c.Writer.Header().Add(k, val)
		}
	}
}

func replayGinResponse(c *gin.Context, recorder *GinResponseRecorder, body []byte) {
	for k, v := range recorder.HeaderMap {
		for _, val := range v {
			c.Writer.Header().Add(k, val)
		}
	}
	if recorder.responseStatus != 0 {
		c.Writer.WriteHeader(recorder.responseStatus)
	}
	c.Writer.Write(body)
}

func replayGinResponseSafe(c *gin.Context, recorder *GinResponseRecorder, body []byte) {
	if recorder == nil {
		c.Writer.Write(body)
		return
	}
	replayGinResponse(c, recorder, body)
}

func replaySanitizedAssistantResponse(c *gin.Context, recorder *GinResponseRecorder, response OpenAITextResponse, content string, files []*model.UploadFile, fallbackBody []byte) {
	if len(response.Choices) > 0 {
		response.Choices[0].Message.Content = content
	}

	sanitizedBody, err := json.Marshal(response)
	if err != nil {
		logger.Warnf(c.Request.Context(), "sanitize assistant response failed, fallback to original body: %v", err)
		replayGinResponseSafe(c, recorder, injectOutputFilesToResponse(fallbackBody, files))
		return
	}

	// Keep non-stream output_files contract for frontend compatibility.
	sanitizedBody = injectOutputFilesToResponse(sanitizedBody, files)
	replayGinResponseSafe(c, recorder, sanitizedBody)
}

// buildOutputFileItems builds the output file items for response
func buildOutputFileItems(files []*model.UploadFile) []map[string]interface{} {
	if len(files) == 0 {
		return nil
	}
	fileItems := make([]map[string]interface{}, 0, len(files))
	for _, f := range files {
		// 将ID编码为HashID
		fileIDHash, _ := hashids.Encode(f.ID)
		messageIDHash, _ := hashids.Encode(f.MessageID)
		if fileIDHash == "" {
			fileIDHash = strconv.FormatInt(f.ID, 10)
		}
		if messageIDHash == "" {
			messageIDHash = strconv.FormatInt(f.MessageID, 10)
		}
		fileItems = append(fileItems, map[string]interface{}{
			"id":         fileIDHash,
			"file_name":  f.FileName,
			"url":        f.GetAISignedDownloadURL(sandboxSignedDownloadTTL),
			"mime_type":  f.MimeType,
			"size":       f.Size,
			"message_id": messageIDHash,
		})
	}
	return fileItems
}

func resolveMediaKind(mimeType string) string {
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
	default:
		return "file"
	}
}

func buildMediaAttachmentItems(files []*model.UploadFile) []map[string]interface{} {
	if len(files) == 0 {
		return nil
	}
	items := make([]map[string]interface{}, 0, len(files))
	for _, f := range files {
		fileIDHash, _ := hashids.Encode(f.ID)
		messageIDHash, _ := hashids.Encode(f.MessageID)
		if fileIDHash == "" {
			fileIDHash = strconv.FormatInt(f.ID, 10)
		}
		if messageIDHash == "" {
			messageIDHash = strconv.FormatInt(f.MessageID, 10)
		}
		items = append(items, map[string]interface{}{
			"id":         fileIDHash,
			"file_name":  f.FileName,
			"url":        f.GetAISignedDownloadURL(sandboxSignedDownloadTTL),
			"mime_type":  f.MimeType,
			"size":       f.Size,
			"kind":       resolveMediaKind(f.MimeType),
			"message_id": messageIDHash,
		})
	}
	return items
}

// injectOutputFilesToResponse injects output_files into non-stream JSON response
// This ensures frontend receives consistent file information in both stream and non-stream modes
func injectOutputFilesToResponse(body []byte, files []*model.UploadFile) []byte {
	if len(files) == 0 {
		return body
	}

	// Parse the response
	var response map[string]interface{}
	if err := json.Unmarshal(body, &response); err != nil {
		logger.Warnf(context.Background(), "Failed to parse response for output_files injection: %v", err)
		return body
	}

	// Check if this is a chat.completion response
	if _, ok := response["choices"]; !ok {
		return body
	}

	// Build output files
	fileItems := buildOutputFileItems(files)
	mediaItems := buildMediaAttachmentItems(files)

	// Add output_files to response
	response["output_files"] = fileItems
	response["output_files_contract_version"] = outputFilesContractVersion
	// Optional incremental contract: media attachments for direct distribution UX.
	response["media_attachments"] = mediaItems
	response["media_attachments_contract_version"] = mediaAttachmentsContractVersion

	// Re-encode
	newBody, err := json.Marshal(response)
	if err != nil {
		logger.Warnf(context.Background(), "Failed to marshal response with output_files: %v", err)
		return body
	}

	return newBody
}

// sendOutputFilesStep 向客户端发送 AI 上传文件信息的 process.step 事件
func sendOutputFilesStep(c *gin.Context, ctx context.Context, requestId string, files []*model.UploadFile, messageStatus *MessageStatsInfo, emitToClient bool) {
	if len(files) == 0 {
		return
	}
	fileItems := buildOutputFileItems(files)
	mediaItems := buildMediaAttachmentItems(files)
	fileStep := ProcessStep{
		StepCode: "output_files",
		Name:     "生成文件",
		Status:   "completed",
		Message:  fmt.Sprintf("生成了 %d 个文件", len(files)),
		Data: map[string]interface{}{
			"files":                  fileItems,
			"contract_version":       outputFilesContractVersion,
			"media_attachments":      mediaItems,
			"media_contract_version": mediaAttachmentsContractVersion,
		},
		Timestamp: time.Now().Unix(),
	}
	fileNames := make([]string, 0, len(files))
	for _, f := range files {
		fileNames = append(fileNames, f.FileName)
	}
	if messageStatus != nil {
		recordProcessStepForHistory(ctx, config.GetEID(c), messageStatus, requestId, fileStep)
	}
	if !emitToClient {
		return
	}
	logger.Debugf(ctx, "【技能运行】发送输出文件步骤: request_id=%s, file_count=%d, file_names=%v", requestId, len(files), fileNames)
	if err := sendProcessStep(c, requestId, fileStep); err != nil {
		logger.Warnf(ctx, "Failed to send output files step: %v", err)
	}
}
