package openai

import (
	"bufio"
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/songquanpeng/one-api/common/render"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common"
	"github.com/songquanpeng/one-api/common/conv"
	"github.com/songquanpeng/one-api/common/logger"
	"github.com/songquanpeng/one-api/relay/model"
	"github.com/songquanpeng/one-api/relay/relaymode"
)

const (
	dataPrefix       = "data: "
	done             = "[DONE]"
	dataPrefixLength = len(dataPrefix)
)

func StreamHandler(c *gin.Context, resp *http.Response, relayMode int) (*model.ErrorWithStatusCode, string, *model.Usage) {
	responseText := ""
	scanner := bufio.NewScanner(resp.Body)
	// 设置更大的缓冲区以处理大型响应 (1MB)
	buf := make([]byte, 0, 64*1024)
	scanner.Buffer(buf, 1024*1024)
	scanner.Split(bufio.ScanLines)
	var usage *model.Usage

	common.SetEventStreamHeaders(c)

	doneRendered := false
	lineCount := 0
	dataEventCount := 0
	ctx := c.Request.Context()
	turnValue, _ := c.Get("agent_loop_turn")
	turnCount, _ := turnValue.(int)
	skillValue, _ := c.Get("agent_loop_skill_name")
	skillName, _ := skillValue.(string)
	modelValue, _ := c.Get("agent_loop_request_model")
	modelName, _ := modelValue.(string)
	logger.Debugf(ctx, "【技能运行】开始处理流式响应: turn=%d, skill=%s, model=%s, status=%d, content_type=%s, relay_mode=%d",
		turnCount, skillName, modelName, resp.StatusCode, resp.Header.Get("Content-Type"), relayMode)
	// logger.SysLogf("========== stream data: =======")
	for scanner.Scan() {
		data := scanner.Text()
		lineCount++
		// logger.SysLogf("%s", data)
		if len(data) < dataPrefixLength { // ignore blank line or wrong format
			continue
		}
		// Normalize data format by adding space after 'data:' if missing
		if strings.HasPrefix(data, "data:{") {
			data = strings.Replace(data, "data:{", "data: {", 1)
		}
		if data[:dataPrefixLength] != dataPrefix && data[:dataPrefixLength] != done {
			continue
		}
		dataEventCount++
		if dataEventCount <= 3 {
			logger.Debugf(ctx, "【技能运行】流式响应事件: turn=%d, skill=%s, model=%s, event_index=%d, payload=%s",
				turnCount, skillName, modelName, dataEventCount, truncateForLog(data, 160))
		}
		if strings.HasPrefix(data[dataPrefixLength:], done) {
			logger.Debugf(ctx, "【技能运行】流式响应收到DONE: turn=%d, skill=%s, model=%s, line=%d, events=%d",
				turnCount, skillName, modelName, lineCount, dataEventCount)
			render.StringData(c, data)
			doneRendered = true
			continue
		}
		if streamErr := parseStreamErrorPayload(data[dataPrefixLength:], resp.StatusCode); streamErr != nil {
			logger.Errorf(ctx, "【技能运行】流式响应错误帧: turn=%d, skill=%s, model=%s, status=%d, message=%s, code=%v",
				turnCount, skillName, modelName, streamErr.StatusCode, streamErr.Message, streamErr.Code)
			_ = resp.Body.Close()
			return streamErr, responseText, usage
		}
		switch relayMode {
		case relaymode.ChatCompletions:
			var streamResponse ChatCompletionsStreamResponse
			err := json.Unmarshal([]byte(data[dataPrefixLength:]), &streamResponse)
			if err != nil {
				logger.SysError("error unmarshalling stream response: " + err.Error())
				render.StringData(c, data) // if error happened, pass the data to client
				continue                   // just ignore the error
			}
			if len(streamResponse.Choices) == 0 && streamResponse.Usage == nil {
				// but for empty choice and no usage, we should not pass it to client, this is for azure
				continue // just ignore empty choice
			}
			render.StringData(c, data)
			for _, choice := range streamResponse.Choices {
				responseText += conv.AsString(choice.Delta.Content)
			}
			if streamResponse.Usage != nil {
				usage = streamResponse.Usage
			}
		case relaymode.Completions:
			render.StringData(c, data)
			var streamResponse CompletionsStreamResponse
			err := json.Unmarshal([]byte(data[dataPrefixLength:]), &streamResponse)
			if err != nil {
				logger.SysError("error unmarshalling stream response: " + err.Error())
				continue
			}
			for _, choice := range streamResponse.Choices {
				responseText += choice.Text
			}
		}
	}

	// logger.SysLogf("========== stream data end =======")
	if err := scanner.Err(); err != nil {
		logger.SysError("error reading stream: " + err.Error())
	}
	logger.Debugf(ctx, "【技能运行】结束处理流式响应: turn=%d, skill=%s, model=%s, done_rendered=%v, lines=%d, events=%d, response_chars=%d",
		turnCount, skillName, modelName, doneRendered, lineCount, dataEventCount, len(responseText))

	if !doneRendered {
		render.Done(c)
	}

	err := resp.Body.Close()
	if err != nil {
		return ErrorWrapper(err, "close_response_body_failed", http.StatusInternalServerError), "", nil
	}

	return nil, responseText, usage
}

func parseStreamErrorPayload(payload string, statusCode int) *model.ErrorWithStatusCode {
	payload = strings.TrimSpace(payload)
	if payload == "" || payload == done {
		return nil
	}
	var upstreamErr struct {
		Error *model.Error `json:"error"`
	}
	if err := json.Unmarshal([]byte(payload), &upstreamErr); err != nil {
		return nil
	}
	if upstreamErr.Error == nil || upstreamErr.Error.Message == "" {
		return nil
	}
	if statusCode <= 0 {
		statusCode = http.StatusInternalServerError
	}
	return &model.ErrorWithStatusCode{
		Error:      *upstreamErr.Error,
		StatusCode: statusCode,
	}
}

func truncateForLog(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max] + "...(truncated)"
}

func Handler(c *gin.Context, resp *http.Response, promptTokens int, modelName string) (*model.ErrorWithStatusCode, *model.Usage) {
	var textResponse SlimTextResponse
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return ErrorWrapper(err, "read_response_body_failed", http.StatusInternalServerError), nil
	}
	err = resp.Body.Close()
	if err != nil {
		return ErrorWrapper(err, "close_response_body_failed", http.StatusInternalServerError), nil
	}
	err = json.Unmarshal(responseBody, &textResponse)
	if err != nil {
		return ErrorWrapper(err, "unmarshal_response_body_failed", http.StatusInternalServerError), nil
	}
	if textResponse.Error.Type != "" {
		return &model.ErrorWithStatusCode{
			Error:      textResponse.Error,
			StatusCode: resp.StatusCode,
		}, nil
	}
	// Reset response body
	resp.Body = io.NopCloser(bytes.NewBuffer(responseBody))

	// We shouldn't set the header before we parse the response body, because the parse part may fail.
	// And then we will have to send an error response, but in this case, the header has already been set.
	// So the HTTPClient will be confused by the response.
	// For example, Postman will report error, and we cannot check the response at all.
	for k, v := range resp.Header {
		c.Writer.Header().Set(k, v[0])
	}
	c.Writer.WriteHeader(resp.StatusCode)
	_, err = io.Copy(c.Writer, resp.Body)
	if err != nil {
		return ErrorWrapper(err, "copy_response_body_failed", http.StatusInternalServerError), nil
	}
	err = resp.Body.Close()
	if err != nil {
		return ErrorWrapper(err, "close_response_body_failed", http.StatusInternalServerError), nil
	}

	if textResponse.Usage.TotalTokens == 0 || (textResponse.Usage.PromptTokens == 0 && textResponse.Usage.CompletionTokens == 0) {
		completionTokens := 0
		for _, choice := range textResponse.Choices {
			completionTokens += CountTokenText(choice.Message.StringContent(), modelName)
		}
		textResponse.Usage = model.Usage{
			PromptTokens:     promptTokens,
			CompletionTokens: completionTokens,
			TotalTokens:      promptTokens + completionTokens,
		}
	}
	return nil, &textResponse.Usage
}
