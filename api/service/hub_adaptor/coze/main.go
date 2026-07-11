package coze

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"strings"

	"github.com/53AI/53AIHub/common/storage"
	"github.com/53AI/53AIHub/common/logger"
	db_model "github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/hub_adaptor/coze/constant/event"
	"github.com/53AI/53AIHub/service/hub_adaptor/custom"
	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common"
	"github.com/songquanpeng/one-api/common/conv"
	"github.com/songquanpeng/one-api/common/helper"
	"github.com/songquanpeng/one-api/common/render"
	"github.com/songquanpeng/one-api/relay/adaptor/coze/constant/messagetype"
	"github.com/songquanpeng/one-api/relay/adaptor/openai"
	"github.com/songquanpeng/one-api/relay/meta"
	"github.com/songquanpeng/one-api/relay/model"
)

// https://www.coze.com/open

func stopReasonCoze2OpenAI(reason *string) string {
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

// getNewMessagesAfterLastAssistant 返回最后一条 assistant 消息之后的 messages。
// 用于延续已有 conversation 时，只发送增量消息，避免将全部历史重复发送。
func getNewMessagesAfterLastAssistant(messages []model.Message) []model.Message {
	lastAssistantIdx := -1
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role == "assistant" {
			lastAssistantIdx = i
			break
		}
	}
	if lastAssistantIdx < 0 {
		// 没有 assistant 回复，说明是全新对话，返回全部
		return messages
	}
	// 只取 assistant 之后的消息（通常是新的 user 消息）
	return messages[lastAssistantIdx+1:]
}

func ConvertRequest(textRequest model.GeneralOpenAIRequest, meta *meta.Meta, customConfig *custom.CustomConfig) *Request {
	modelName := "bot-" + strings.TrimPrefix(meta.ActualModelName, "bot-")
	channelID := meta.ChannelId
	cozeRequest := Request{
		Stream: textRequest.Stream,
		UserID: customConfig.UserId,
		BotId:  strings.TrimPrefix(textRequest.Model, "bot-"),
	}

	// 当已有 conversation_id（延续对话）时，只发送增量消息，不重复发送历史
	messages := textRequest.Messages
	if customConfig.ConversationId != "" {
		messages = getNewMessagesAfterLastAssistant(messages)
	}

	for _, message := range messages {
		typeStr := TypeQuestion
		contentType := ContentTypeText
		if message.Role == "assistant" {
			typeStr = TypeAnswer
		}
		contentStr := message.StringContent()
		if contentStr == "" {
			continue
		}
		var contentObjs []db_model.ObjectStringContent
		if err := json.Unmarshal([]byte(contentStr), &contentObjs); err == nil {
			if len(contentObjs) == 0 {
				continue
			}
			var mergedContent []map[string]interface{}
			for _, contentObj := range contentObjs {
				if contentObj.Type == "text" {
					mergedContent = append(mergedContent, map[string]interface{}{
						"type": "text",
						"text": contentObj.Content,
					})
					continue
				}
				uoloadFile := contentObj.GetUploadFile()
				if uoloadFile == nil {
					logger.SysError("file not found")
					continue
				}
				fileMapping := uoloadFile.GetChannelFileMapping(channelID, modelName)
				if fileMapping == nil {
					fileMapping = &db_model.ChannelFileMapping{}
					err := CozeUploadFile(meta, uoloadFile, fileMapping)
					if err != nil {
						logger.SysError(fmt.Sprintf("upload file failed: %v", err))
						continue
					}
					err = db_model.CreateChannelFileMapping(fileMapping)
					if err != nil {
						logger.SysError(fmt.Sprintf("create file mapping failed: %v", err))
						continue
					}
				} else if helper.GetTimestamp() > fileMapping.ExpirationTime {
					err := CozeUploadFile(meta, uoloadFile, fileMapping)
					if err != nil {
						logger.SysError(fmt.Sprintf("update file failed: %v", err))
						continue
					}
					err = db_model.UpdateChannelFileMapping(fileMapping)
					if err != nil {
						logger.SysError(fmt.Sprintf("update file mapping failed: %v", err))
						continue
					}
				}

				var contentType string
				if strings.HasPrefix(uoloadFile.MimeType, "image/") {
					contentType = "image"
				} else {
					contentType = "file"
				}
				mergedContent = append(mergedContent, map[string]interface{}{
					"type":    contentType,
					"file_id": fileMapping.ChannelFileID,
				})
			}
			mergedJSON, _ := json.Marshal(mergedContent)
			cozeMessage := AdditionalMessage{
				Role:        message.Role,
				Content:     string(mergedJSON),
				ContentType: ContentTypeObjectString,
				Type:        typeStr,
			}
			cozeRequest.AdditionalMessages = append(cozeRequest.AdditionalMessages, cozeMessage)
		} else {
			cozeMessage := AdditionalMessage{
				Role:        message.Role,
				Content:     contentStr,
				ContentType: contentType,
				Type:        typeStr,
			}
			cozeRequest.AdditionalMessages = append(cozeRequest.AdditionalMessages, cozeMessage)
		}
	}
	return &cozeRequest
}

func StreamResponseCoze2OpenAI(cozeResponse *StreamResponseV3) (*openai.ChatCompletionsStreamResponse, *Response) {
	var response *Response
	var stopReason string
	var choice openai.ChatCompletionsStreamResponseChoice

	choice.Delta.Content = cozeResponse.Content
	choice.Delta.Role = "assistant"
	finishReason := stopReasonCoze2OpenAI(&stopReason)
	if finishReason != "null" {
		choice.FinishReason = &finishReason
	}
	var openaiResponse openai.ChatCompletionsStreamResponse
	openaiResponse.Object = "chat.completion.chunk"
	openaiResponse.Choices = []openai.ChatCompletionsStreamResponseChoice{choice}
	openaiResponse.Id = cozeResponse.ConversationId
	return &openaiResponse, response
}

func ResponseCoze2OpenAI(cozeResponse *Response) (*openai.TextResponse, string) {
	var responseText string
	for _, message := range cozeResponse.Messages {
		if message.Type == messagetype.Answer {
			responseText = message.Content
			break
		}
	}
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
		Id:      fmt.Sprintf("chatcmpl-%s", cozeResponse.ConversationId),
		Model:   "coze-bot",
		Object:  "chat.completion",
		Created: helper.GetTimestamp(),
		Choices: []openai.TextResponseChoice{choice},
	}
	return &fullTextResponse, cozeResponse.ConversationId
}

// writeStreamError 通过 SSE 向客户端发送错误信息并刷新
func writeStreamError(c *gin.Context, message string, code int) {
	errChunk := map[string]interface{}{
		"error": model.Error{
			Message: message,
			Code:    code,
		},
	}
	jsonBytes, _ := json.Marshal(errChunk)
	c.Writer.Write([]byte("data: "))
	c.Writer.Write(jsonBytes)
	c.Writer.Write([]byte("\n\n"))
	c.Writer.Write([]byte("data: [DONE]\n\n"))
	if flusher, ok := c.Writer.(http.Flusher); ok {
		flusher.Flush()
	}
}

func StreamHandler(c *gin.Context, resp *http.Response) (*model.ErrorWithStatusCode, *string, string) {
	var responseText string
	createdTime := helper.GetTimestamp()

	// 处理非 200 响应：Coze 可能直接返回 HTTP 错误而非 SSE 流
	if resp.StatusCode != http.StatusOK {
		bodyBytes, readErr := io.ReadAll(resp.Body)
		resp.Body.Close()
		errMsg := fmt.Sprintf("upstream error (status %d)", resp.StatusCode)
		if readErr == nil && len(bodyBytes) > 0 {
			logger.SysError(fmt.Sprintf("【Coze】非200响应: status=%d, body=%s", resp.StatusCode, string(bodyBytes)))
			var cozeErr CozeErrorResponse
			if json.Unmarshal(bodyBytes, &cozeErr) == nil && cozeErr.Msg != "" {
				errMsg = cozeErr.Msg
			}
		} else {
			logger.SysError(fmt.Sprintf("【Coze】非200响应且读取body失败: status=%d, readErr=%v", resp.StatusCode, readErr))
		}

		common.SetEventStreamHeaders(c)
		writeStreamError(c, errMsg, resp.StatusCode)
		return nil, &errMsg, ""
	}

	scanner := bufio.NewScanner(resp.Body)
	buf := make([]byte, 0, 64*1024)
	scanner.Buffer(buf, 1024*1024)
	scanner.Split(bufio.ScanLines)

	common.SetEventStreamHeaders(c)
	conversationId := ""
	var modelName string
	errored := false

		eventStr := ""
		eventCount := 0
		for scanner.Scan() {
			data := scanner.Text()
			eventCount++

			if data == "" || data == "\n" {
				eventStr = ""
				continue
			}
			if strings.HasPrefix(data, "event:") {
				eventStr = strings.TrimPrefix(data, "event:")
				continue
			}

			if !strings.HasPrefix(data, "data:") {
				continue
			}

			if eventStr == "" {
				continue
			}

			if eventStr == event.ChatFailed {
			if len(data) >= 5 && strings.HasPrefix(data, "data:") {
				payload := strings.TrimPrefix(data, "data:")
				payload = strings.TrimSuffix(payload, "\r")

				var failedResp ChatFailedResponse
				if err := json.Unmarshal([]byte(payload), &failedResp); err != nil {
					logger.SysError("【Coze】解析 conversation.chat.failed 失败: " + err.Error() + ", 原始数据: " + payload)
					continue
				}
				logger.SysError(fmt.Sprintf("【Coze】chat failed: code=%d, msg=%s",
					failedResp.LastError.Code, failedResp.LastError.Msg))

				// 不调用 writeStreamError——让 relay 层的统一错误处理路径发送 SSE 错误并正确终结 agent run
				resp.Body.Close()
				return &model.ErrorWithStatusCode{
					Error: model.Error{
						Message: failedResp.LastError.Msg,
						Code:    failedResp.LastError.Code,
					},
					StatusCode: resp.StatusCode,
				}, nil, failedResp.ConversationId
			}
			errored = true
			break
		}

		if eventStr == event.Error {
			if len(data) >= 5 && strings.HasPrefix(data, "data:") {
				payload := strings.TrimPrefix(data, "data:")
				payload = strings.TrimSuffix(payload, "\r")

				var cozeErr CozeErrorResponse
				if err := json.Unmarshal([]byte(payload), &cozeErr); err != nil {
					logger.SysError("【Coze】解析 error 事件失败: " + err.Error())
					resp.Body.Close()
					return &model.ErrorWithStatusCode{
						Error: model.Error{
							Message: "coze stream error",
							Code:    500,
						},
						StatusCode: http.StatusInternalServerError,
					}, nil, ""
				} else {
					errMsg := cozeErr.Msg
					if errMsg == "" {
						errMsg = "coze stream error"
					}
					logger.SysError(fmt.Sprintf("【Coze】error 事件: code=%d, msg=%s", cozeErr.Code, errMsg))
					resp.Body.Close()
					return &model.ErrorWithStatusCode{
						Error: model.Error{
							Message: errMsg,
							Code:    cozeErr.Code,
						},
						StatusCode: resp.StatusCode,
					}, nil, ""
				}
			} else {
				logger.SysError("【Coze】error 事件缺少 data 字段: " + data)
				resp.Body.Close()
				return &model.ErrorWithStatusCode{
					Error: model.Error{
						Message: "coze stream error event without data",
						Code:    http.StatusInternalServerError,
					},
					StatusCode: http.StatusInternalServerError,
				}, nil, ""
			}

			// event.Error 已提前返回，不再需要 errored/break
		}

		if eventStr != "conversation.message.delta" {
			continue
		}

		if len(data) < 5 || !strings.HasPrefix(data, "data:") {
			continue
		}
		data = strings.TrimPrefix(data, "data:")
		data = strings.TrimSuffix(data, "\r")

		var cozeResponse StreamResponseV3
		err := json.Unmarshal([]byte(data), &cozeResponse)
		if err != nil {
			logger.SysError("error unmarshalling stream response: " + err.Error())
			continue
		}

		if cozeResponse.Type != "answer" {
			continue
		}

		response, _ := StreamResponseCoze2OpenAI(&cozeResponse)

		if response == nil {
			continue
		}

		if response.Id != "" {
			conversationId = response.Id
		}

		for _, choice := range response.Choices {
			responseText += conv.AsString(choice.Delta.Content)
		}
		response.Model = modelName
		response.Created = createdTime

		err = render.ObjectData(c, response)
		if err != nil {
			logger.SysError(err.Error())
		}
	}

	if err := scanner.Err(); err != nil {
		logger.SysError("error reading stream: " + err.Error())
	}

	if eventCount == 0 {
		logger.SysError("【Coze】流式响应返回空流（无任何SSE事件），conversation可能处于异常状态")
	}

	if !errored {
		render.Done(c)
	}

	err := resp.Body.Close()
	if err != nil {
		return openai.ErrorWrapper(err, "close_response_body_failed", http.StatusInternalServerError), nil, conversationId
	}

	return nil, &responseText, conversationId
}

func Handler(c *gin.Context, resp *http.Response, promptTokens int, modelName string) (*model.ErrorWithStatusCode, *string, string) {
	responseBody, err := io.ReadAll(resp.Body)
	conversationId := ""
	if err != nil {
		return openai.ErrorWrapper(err, "read_response_body_failed", http.StatusInternalServerError), nil, conversationId
	}
	err = resp.Body.Close()
	if err != nil {
		return openai.ErrorWrapper(err, "close_response_body_failed", http.StatusInternalServerError), nil, conversationId
	}
	var cozeResponse Response
	err = json.Unmarshal(responseBody, &cozeResponse)
	if err != nil {
		return openai.ErrorWrapper(err, "unmarshal_response_body_failed", http.StatusInternalServerError), nil, conversationId
	}
	if cozeResponse.Code != 0 {
		return &model.ErrorWithStatusCode{
			Error: model.Error{
				Message: cozeResponse.Msg,
				Code:    cozeResponse.Code,
			},
			StatusCode: resp.StatusCode,
		}, nil, conversationId
	}
	fullTextResponse, conversationId := ResponseCoze2OpenAI(&cozeResponse)
	fullTextResponse.Model = modelName
	jsonResponse, err := json.Marshal(fullTextResponse)
	if err != nil {
		return openai.ErrorWrapper(err, "marshal_response_body_failed", http.StatusInternalServerError), nil, conversationId
	}
	c.Writer.Header().Set("Content-Type", "application/json")
	c.Writer.WriteHeader(resp.StatusCode)
	_, err = c.Writer.Write(jsonResponse)
	var responseText string
	if len(fullTextResponse.Choices) > 0 {
		responseText = fullTextResponse.Choices[0].Message.StringContent()
	}
	return nil, &responseText, conversationId
}

func CozeUploadFile(meta *meta.Meta, uploadFile *db_model.UploadFile, fileMapping *db_model.ChannelFileMapping) error {
	url := fmt.Sprintf("%s/v1/files/upload", meta.BaseURL)
	fileContent, err := storage.StorageInstance.Load(uploadFile.Key)
	if err != nil {
		return err
	}

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	part, err := writer.CreateFormFile("file", uploadFile.FileName)
	if err != nil {
		return err
	}
	_, err = io.Copy(part, bytes.NewReader(fileContent))
	if err != nil {
		return err
	}
	writer.Close()

	req, err := http.NewRequest("POST", url, body)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+meta.APIKey)

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("upload failed with status: %s", resp.Status)
	}

	var result struct {
		Code int `json:"code"`
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	err = json.NewDecoder(resp.Body).Decode(&result)
	if err != nil {
		return err
	}

	if result.Code != 0 {
		return fmt.Errorf("upload failed with code: %d", result.Code)
	}
	ExpirationTime := helper.GetTimestamp() + 3600*24*30

	fileMapping.Eid = uploadFile.Eid
	fileMapping.FileID = uploadFile.ID
	fileMapping.ChannelID = meta.ChannelId
	fileMapping.Model = "bot-" + strings.TrimPrefix(meta.ActualModelName, "bot-")
	fileMapping.ChannelFileID = result.Data.ID
	fileMapping.ExpirationTime = ExpirationTime
	jsonResult, err := json.Marshal(result)
	if err != nil {
		return err
	}
	fileMapping.ApiResponse = string(jsonResult)

	return nil
}
