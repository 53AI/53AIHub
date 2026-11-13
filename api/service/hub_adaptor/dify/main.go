package dify

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common"
	"github.com/songquanpeng/one-api/common/helper"
	"github.com/songquanpeng/one-api/common/render"
	"github.com/songquanpeng/one-api/relay/adaptor/openai"
	"github.com/songquanpeng/one-api/relay/model"
)

func StreamHandler(c *gin.Context, resp *http.Response, modelName string, persistConversationID func(string) error) (*model.ErrorWithStatusCode, *string, string) {
	createdTime := helper.GetTimestamp()
	scanner := bufio.NewScanner(resp.Body)
	buf := make([]byte, 0, 64*1024)
	scanner.Buffer(buf, 1024*1024)
	common.SetEventStreamHeaders(c)
	defer func() {
		if err := resp.Body.Close(); err != nil {
			logger.SysError("close stream response body failed: " + err.Error())
		}
	}()

	var responseText strings.Builder
	channelConversationID := ""
	persistedConversationID := ""
	agentMessageSeen := false
	agentMessageIDs := make(map[string]struct{})
	workflowStarted := false
	workflowFinished := false
	workflowNodeError := ""
	messageEnded := false

	for scanner.Scan() {
		data := scanner.Text()
		if len(data) < 5 || !strings.HasPrefix(data, "data:") {
			continue
		}
		data = strings.TrimSpace(strings.TrimPrefix(data, "data:"))
		if data == "" || data == "ping" || data == "[DONE]" {
			continue
		}

		var difyResponse StreamResponse
		if err := json.Unmarshal([]byte(data), &difyResponse); err != nil {
			return openai.ErrorWrapper(fmt.Errorf("decode Dify SSE event: %w", err), "dify_stream_malformed_event", http.StatusBadGateway), nil, channelConversationID
		}
		if difyResponse.Event == "error" || difyResponse.Status >= http.StatusBadRequest ||
			(difyResponse.Event == "" && (difyResponse.Code != "" || difyResponse.Message != "")) {
			message := difyResponse.Message
			if message == "" {
				message = difyResponse.Code
			}
			if message == "" {
				message = "Dify stream returned an error"
			}
			statusCode := difyResponse.Status
			if statusCode < http.StatusBadRequest || statusCode > 599 {
				statusCode = http.StatusBadGateway
			}
			return openai.ErrorWrapper(errors.New(message), "dify_stream_error", statusCode), nil, channelConversationID
		}

		if difyResponse.ConversationID != "" {
			if difyResponse.ConversationID != persistedConversationID {
				if persistConversationID != nil {
					if err := persistConversationID(difyResponse.ConversationID); err != nil {
						return openai.ErrorWrapper(err, "persist_dify_conversation_id_failed", http.StatusInternalServerError), nil, channelConversationID
					}
				}
				persistedConversationID = difyResponse.ConversationID
			}
			channelConversationID = difyResponse.ConversationID
		}

		answer := ""
		switch difyResponse.Event {
		case "agent_message":
			answer = difyResponse.Answer
			if answer != "" {
				agentMessageSeen = true
				if difyResponse.MessageID != "" {
					agentMessageIDs[difyResponse.MessageID] = struct{}{}
				}
			}
		case "message":
			// Agent 应用会在增量输出后发送完整 message；仅跳过同一 message_id，
			// 不影响不同消息 ID 的独立 message 事件。
			if agentMessageSeen {
				if difyResponse.MessageID == "" || len(agentMessageIDs) == 0 {
					continue
				}
				if _, seen := agentMessageIDs[difyResponse.MessageID]; seen {
					continue
				}
			}
			answer = difyResponse.Answer
		case "":
			// 兼容未携带 event 字段的旧版 Dify 流。
			if !agentMessageSeen {
				answer = difyResponse.Answer
			}
		case "message_replace":
			replacement := difyResponse.Answer
			current := responseText.String()
			if current == "" || strings.HasPrefix(replacement, current) {
				answer = strings.TrimPrefix(replacement, current)
			} else if replacement != current {
				// OpenAI delta 协议不支持撤回已经发送的内容，避免把完整替换文本再次拼接。
				logger.SysError("Dify message_replace 不能表示为追加式流增量，已忽略不兼容的替换事件")
			}
		case "message_end":
			messageEnded = true
			continue
		case "workflow_started":
			workflowStarted = true
			continue
		case "workflow_finished":
			workflowFinished = true
			status := strings.ToLower(strings.TrimSpace(difyResponse.Data.Status))
			if status != "succeeded" {
				message := difyResponse.Data.Error
				if message == "" {
					message = workflowNodeError
				}
				if message == "" {
					if status == "" {
						message = "Dify workflow finished without a success status"
					} else {
						message = fmt.Sprintf("Dify workflow finished with status %q", status)
					}
				}
				statusCode := http.StatusBadGateway
				if status == "paused" {
					statusCode = http.StatusConflict
				}
				return openai.ErrorWrapper(errors.New(message), "dify_workflow_failed", statusCode), nil, channelConversationID
			}
			continue
		case "node_finished":
			// 节点失败可能由 Chatflow 的错误处理分支恢复；以 workflow_finished 的最终状态为准。
			if strings.EqualFold(strings.TrimSpace(difyResponse.Data.Status), "failed") && workflowNodeError == "" {
				workflowNodeError = difyResponse.Data.Error
			}
			continue
		case "workflow_paused", "human_input_required":
			return openai.ErrorWrapper(
				errors.New("Dify workflow requires human input, which is not supported by the chat-completions adapter"),
				"dify_workflow_paused",
				http.StatusConflict,
			), nil, channelConversationID
		case "error":
			// 已在事件解析后统一处理。
			continue
		default:
			// agent_thought、message_file、ping 和其他工作流事件不属于文本增量。
			continue
		}
		if answer == "" {
			continue
		}

		if persistConversationID != nil && channelConversationID == "" {
			return openai.ErrorWrapper(errors.New("Dify answer event is missing conversation_id"), "dify_conversation_id_missing", http.StatusBadGateway), nil, channelConversationID
		}
		response, _ := StreamResponseDifyOpenAI(&StreamResponse{ConversationID: channelConversationID, Answer: answer})
		response.Model = modelName
		response.Created = createdTime
		if err := render.ObjectData(c, response); err != nil {
			return openai.ErrorWrapper(err, "write_stream_response_failed", http.StatusInternalServerError), nil, channelConversationID
		}
		responseText.WriteString(answer)
	}

	if err := scanner.Err(); err != nil {
		return openai.ErrorWrapper(err, "read_stream_response_failed", http.StatusBadGateway), nil, channelConversationID
	}
	if !messageEnded {
		return openai.ErrorWrapper(errors.New("Dify stream ended before message_end"), "dify_stream_incomplete", http.StatusBadGateway), nil, channelConversationID
	}
	if workflowStarted && !workflowFinished {
		return openai.ErrorWrapper(errors.New("Dify Chatflow stream ended before workflow_finished"), "dify_workflow_incomplete", http.StatusBadGateway), nil, channelConversationID
	}

	text := responseText.String()
	return nil, &text, channelConversationID
}

func StreamResponseDifyOpenAI(difyResponse *StreamResponse) (*openai.ChatCompletionsStreamResponse, *Response) {

	var response *Response
	var stopReason string
	var choice openai.ChatCompletionsStreamResponseChoice
	if difyResponse.Answer != "" {
		choice.Delta.Content = difyResponse.Answer
	}
	choice.Delta.Role = "assistant"
	finishReason := stopReasonDifyOpenAI(&stopReason)
	if finishReason != "null" {
		choice.FinishReason = &finishReason
	}
	var openaiResponse openai.ChatCompletionsStreamResponse
	openaiResponse.Object = "chat.completion.chunk"
	openaiResponse.Choices = []openai.ChatCompletionsStreamResponseChoice{choice}
	openaiResponse.Id = difyResponse.ConversationID
	return &openaiResponse, response
}

func BlockingResponseDifyOpenAI(difyResponse *BlockResponse) (*openai.ChatCompletionsStreamResponse, *Response) {
	var response *Response
	var choice openai.ChatCompletionsStreamResponseChoice

	if difyResponse.Answer != "" {
		choice.Delta.Content = difyResponse.Answer
	}
	var openaiResponse openai.ChatCompletionsStreamResponse
	openaiResponse.Object = "chat.completion.chunk"
	openaiResponse.Choices = []openai.ChatCompletionsStreamResponseChoice{choice}
	openaiResponse.Id = difyResponse.ConversationID
	return &openaiResponse, response
}

func stopReasonDifyOpenAI(reason *string) string {
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

type File struct {
	TransferMethod string `json:"transfer_method"`
	Type           string `json:"type"`
	Url            string `json:"url"`
	UploadFileID   string `json:"upload_file_id"`
}

const (
	ResponseModeStream = "streaming"
	ResponseModeBlock  = "blocking"
)

type Request struct {
	ConversationId string      `json:"conversation_id"`
	User           string      `json:"user"`
	Query          string      `json:"query"`
	ResponseMode   string      `json:"response_mode"`
	Files          []File      `json:"files"`
	Inputs         interface{} `json:"inputs"`
}
