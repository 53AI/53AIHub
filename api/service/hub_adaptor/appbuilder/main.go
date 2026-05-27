package appbuilder

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/service/hub_adaptor/openai"
	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common"
	"github.com/songquanpeng/one-api/common/helper"
	"github.com/songquanpeng/one-api/common/render"
	"github.com/songquanpeng/one-api/relay/model"
)

func StreamHandler(c *gin.Context, resp *http.Response) (*model.ErrorWithStatusCode, *string, string) {
	var responseText string
	createdTime := helper.GetTimestamp()
	scanner := bufio.NewScanner(resp.Body)
	// 设置更大的缓冲区以处理大型响应 (1MB)
	buf := make([]byte, 0, 64*1024)
	scanner.Buffer(buf, 1024*1024)
	scanner.Split(bufio.ScanLines)
	common.SetEventStreamHeaders(c)
	var modelName string

	channelConversationId := ""
	for scanner.Scan() {
		data := scanner.Text()
		if len(data) < 5 || !strings.HasPrefix(data, "data:") {
			continue
		}
		data = strings.TrimPrefix(data, "data:")
		data = strings.TrimSuffix(data, "\r")

		var appBuilderResponse Response
		err := json.Unmarshal([]byte(data), &appBuilderResponse)
		if err != nil {
			logger.SysError("error unmarshalling stream response: " + err.Error())
			continue
		}

		response, finishReason := StreamResponseToOpenAI(&appBuilderResponse)
		if response == nil {
			continue
		}

		response.Model = modelName
		response.Created = createdTime

		// 检查是否是完成事件
		isCompletion := appBuilderResponse.IsCompletion != nil && *appBuilderResponse.IsCompletion

		// 如果是完成事件，设置finish_reason
		if isCompletion || (finishReason != nil && *finishReason != "") {
			for i := range response.Choices {
				response.Choices[i].FinishReason = finishReason
			}
		}

		err = render.ObjectData(c, response)
		if err != nil {
			logger.SysError(err.Error())
		}
		channelConversationId = appBuilderResponse.ConversationID

		// 如果是完成事件，跳出循环
		if isCompletion {
			break
		}
	}

	if err := scanner.Err(); err != nil {
		logger.SysError("error reading stream: " + err.Error())
	}

	render.Done(c)

	err := resp.Body.Close()
	if err != nil {
		return openai.ErrorWrapper(err, "close_response_body_failed", http.StatusInternalServerError), nil, channelConversationId
	}

	return nil, &responseText, channelConversationId
}

func Handler(c *gin.Context, resp *http.Response, promptTokens int, modelName string) (*model.ErrorWithStatusCode, *string, string) {
	channelConversationId := ""
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return openai.ErrorWrapper(err, "read_response_body_failed", http.StatusInternalServerError), nil, channelConversationId
	}
	err = resp.Body.Close()
	if err != nil {
		return openai.ErrorWrapper(err, "close_response_body_failed", http.StatusInternalServerError), nil, channelConversationId
	}
	var response Response
	err = json.Unmarshal(responseBody, &response)
	if err != nil {
		return openai.ErrorWrapper(err, "unmarshal_response_body_failed", http.StatusInternalServerError), nil, channelConversationId
	}

	fullTextResponse := ResponseToOpenAI(&response)
	fullTextResponse.Model = modelName
	jsonResponse, err := json.Marshal(fullTextResponse)
	if err != nil {
		return openai.ErrorWrapper(err, "marshal_response_body_failed", http.StatusInternalServerError), nil, channelConversationId
	}
	c.Writer.Header().Set("Content-Type", "application/json")
	c.Writer.WriteHeader(resp.StatusCode)
	_, err = c.Writer.Write(jsonResponse)
	var responseText string
	if len(fullTextResponse.Choices) > 0 {
		responseText = fullTextResponse.Choices[0].Message.StringContent()
	}
	channelConversationId = response.ConversationID
	return nil, &responseText, channelConversationId
}

func StreamResponseToOpenAI(appBuilderResponse *Response) (*openai.ChatCompletionsStreamResponse, *string) {
	var stopReason string
	var choice openai.ChatCompletionsStreamResponseChoice

	if appBuilderResponse.Answer != "" {
		choice.Delta.Content = appBuilderResponse.Answer
	}
	choice.Delta.Role = "assistant"

	// 检查是否是完成状态
	isCompletion := appBuilderResponse.IsCompletion != nil && *appBuilderResponse.IsCompletion
	var finishReason *string

	if isCompletion {
		stopReason = "stop" // 默认为自然停止
		finishReason = &stopReason

		// 检查内容是否因长度限制而停止
		for _, content := range appBuilderResponse.Content {
			if content.EventStatus == "FINISHED" && content.EventType == "ResponseCompletedEvent" {
				// 检查是否有长度相关的事件
				if strings.Contains(content.EventMessage, "length") ||
					strings.Contains(content.EventMessage, "max_tokens") ||
					strings.Contains(content.EventMessage, "context_length") {
					stopReason = "length"
					finishReason = &stopReason
					break
				}
			}
		}
	}

	if finishReason != nil && *finishReason != "" {
		choice.FinishReason = finishReason
	}

	var openaiResponse openai.ChatCompletionsStreamResponse
	openaiResponse.Object = "chat.completion.chunk"
	openaiResponse.Choices = []openai.ChatCompletionsStreamResponseChoice{choice}
	openaiResponse.Id = appBuilderResponse.ConversationID
	return &openaiResponse, finishReason
}

func stopReasonAppBuilderOpenAI(reason *string) string {
	if reason == nil {
		return ""
	}
	switch *reason {
	case "end_turn":
		return "stop"
	case "stop_sequence":
		return "stop"
	case "max_tokens":
		return "length"
	default:
		return *reason
	}
}

func ResponseToOpenAI(response *Response) *openai.TextResponse {
	var responseText string
	responseText = response.Answer
	choice := openai.TextResponseChoice{
		Index: 0,
		Message: model.Message{
			Role:    "assistant",
			Content: responseText,
			Name:    nil,
		},
		FinishReason: "stop",
	}
	fullTextResponse := openai.TextResponse{
		Id:      fmt.Sprintf("chatcmpl-%s", response.ConversationID),
		Model:   "appbuilder-bot",
		Object:  "chat.completion",
		Created: helper.GetTimestamp(),
		Choices: []openai.TextResponseChoice{choice},
	}
	return &fullTextResponse
}
