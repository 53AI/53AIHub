package openai

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/53AI/53AIHub/common/storage"
	Hub_model "github.com/53AI/53AIHub/model"
	db_model "github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/hub_adaptor/custom"
	"github.com/53AI/53AIHub/service/hub_adaptor/volcengine"
	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/logger"
	"github.com/songquanpeng/one-api/relay/adaptor/doubao"
	"github.com/songquanpeng/one-api/relay/adaptor/minimax"
	"github.com/songquanpeng/one-api/relay/adaptor/novita"
	"github.com/songquanpeng/one-api/relay/channeltype"
	"github.com/songquanpeng/one-api/relay/meta"
	"github.com/songquanpeng/one-api/relay/model"
	"github.com/songquanpeng/one-api/relay/relaymode"
)

type Adaptor struct {
	ChannelType   int
	CustomConfig  *custom.CustomConfig
	ChannelConfig string // 添加渠道配置字段，存储原始JSON字符串
}

func (a *Adaptor) Init(meta *meta.Meta) {
	a.ChannelType = meta.ChannelType
	// 从meta中获取渠道配置（如果有的话）
	// 实际配置会在RelayTextHelper中直接注入
}

func (a *Adaptor) GetRequestURL(meta *meta.Meta) (string, error) {
	switch meta.ChannelType {
	case channeltype.Azure:
		if meta.Mode == relaymode.ImagesGenerations {
			// https://learn.microsoft.com/en-us/azure/ai-services/openai/dall-e-quickstart?tabs=dalle3%2Ccommand-line&pivots=rest-api
			// https://{resource_name}.openai.azure.com/openai/deployments/dall-e-3/images/generations?api-version=2024-03-01-preview
			baseUrl := meta.BaseURL
			baseUrl = strings.TrimSuffix(baseUrl, "/")
			fullRequestURL := fmt.Sprintf("%s/openai/deployments/%s/images/generations?api-version=%s", baseUrl, meta.ActualModelName, meta.Config.APIVersion)
			return fullRequestURL, nil
		}

		// https://learn.microsoft.com/en-us/azure/cognitive-services/openai/chatgpt-quickstart?pivots=rest-api&tabs=command-line#rest-api
		requestURL := strings.Split(meta.RequestURLPath, "?")[0]
		requestURL = fmt.Sprintf("%s?api-version=%s", requestURL, meta.Config.APIVersion)
		task := strings.TrimPrefix(requestURL, "/v1/")
		model_ := meta.ActualModelName
		//https://github.com/songquanpeng/one-api/issues/1191
		// {your endpoint}/openai/deployments/{your azure_model}/chat/completions?api-version={api_version}
		requestURL = fmt.Sprintf("/openai/deployments/%s/%s", model_, task)
		return GetFullRequestURL(meta.BaseURL, requestURL, meta.ChannelType), nil
	case channeltype.Minimax:
		return minimax.GetRequestURL(meta)
	case channeltype.Doubao:
		return doubao.GetRequestURL(meta)
	case channeltype.Novita:
		return novita.GetRequestURL(meta)
	case Hub_model.ChannelApiVolcengine, Hub_model.ChannelApiVolcengineModel:
		return volcengine.GetRequestURL(meta)
	case Hub_model.ChannelApiTypeMaxKB:
		meta.RequestURLPath = strings.TrimPrefix(meta.RequestURLPath, "/v1")
		return GetFullRequestURL(meta.BaseURL, meta.RequestURLPath, meta.ChannelType), nil
	default:
		return GetFullRequestURL(meta.BaseURL, meta.RequestURLPath, meta.ChannelType), nil
	}
}

func (a *Adaptor) SetupRequestHeader(c *gin.Context, req *http.Request, meta *meta.Meta) error {
	custom.SetupCommonRequestHeader(c, req, meta)
	if meta.ChannelType == channeltype.Azure {
		req.Header.Set("api-key", meta.APIKey)
		return nil
	}
	req.Header.Set("Authorization", "Bearer "+meta.APIKey)
	if meta.ChannelType == channeltype.OpenRouter {
		req.Header.Set("HTTP-Referer", "https://53ai.com")
		req.Header.Set("X-Title", "53AIHub")
	}
	return nil
}

func (a *Adaptor) ConvertRequest(c *gin.Context, relayMode int, request *model.GeneralOpenAIRequest) (any, error) {
	if request == nil {
		return nil, errors.New("request is nil")
	}
	if request.Stream {
		// always return usage in stream mode
		if request.StreamOptions == nil {
			request.StreamOptions = &model.StreamOptions{}
		}
		request.StreamOptions.IncludeUsage = true
	}

	// 如果有渠道配置，可以根据配置进行请求调整
	if a.ChannelConfig != "" {
		var config map[string]interface{}
		if err := json.Unmarshal([]byte(a.ChannelConfig), &config); err != nil {
			logger.SysError("error parsing channel config: " + err.Error())
		} else {
			// 根据配置调整请求参数
			if contextLength, ok := config["context_length"].(float64); ok {
				// 验证输入是否超过上下文长度限制
				promptTokens := 0
				switch relayMode {
				case relaymode.ChatCompletions:
					// 使用更精确的token计算器 - 调用通用的token计算函数
					promptTokens = CountTokenMessages(request.Messages, request.Model)
				case relaymode.Completions:
					if str, ok := request.Prompt.(string); ok {
						promptTokens = CountTokenInput(str, request.Model)
					} else if arr, ok := request.Prompt.([]interface{}); ok {
						for _, item := range arr {
							if str, ok := item.(string); ok {
								promptTokens += CountTokenInput(str, request.Model)
							}
						}
					}
				}

				// 如果输入超过了上下文长度限制，返回错误
				if promptTokens > int(contextLength) {
					errMsg := fmt.Sprintf("Input length (%d) exceeds context length limit (%.0f)",
						promptTokens, contextLength)
					logger.SysError(errMsg)
					return nil, errors.New(errMsg)
				}
			}

			if functionCalling, ok := config["function_calling"]; ok {
				if enabled, ok := functionCalling.(bool); ok && !enabled {
					// 如果函数调用被禁用，清除请求中的函数定义
					request.Functions = nil
					request.ToolChoice = nil
				}
			}

			if vision, ok := config["vision"]; ok {
				if enabled, ok := vision.(bool); ok && !enabled {
					// 如果视觉识别被禁用，过滤掉图像输入
					request.Messages = removeImageContent(request.Messages)
				}
			}

			if maxTokens, ok := config["max_tokens"].(float64); ok {
				// 如果配置了最大token数，设置到请求中
				// 仅在请求中未设置max_tokens时才使用配置值
				if request.MaxTokens == 0 {
					request.MaxTokens = int(maxTokens)
				}
			}
		}
	}

	a.HandlerUploadFileMessages(request)
	ApplyTokenLimitForModel(request)
	return request, nil
}

// removeImageContent 移除消息中的图像内容
func removeImageContent(messages []model.Message) []model.Message {
	for i, message := range messages {
		if _, ok := message.Content.(string); ok {
			continue // 纯文本内容无需处理
		}

		if contentItems, ok := message.Content.([]interface{}); ok {
			var filteredContent []interface{}
			for _, item := range contentItems {
				if itemMap, ok := item.(map[string]interface{}); ok {
					if itemType, exists := itemMap["type"]; exists && itemType == "image_url" {
						continue // 跳过图像类型内容
					}
				}
				filteredContent = append(filteredContent, item)
			}
			messages[i].Content = filteredContent
		}
	}
	return messages
}

func (a *Adaptor) ConvertImageRequest(request *model.ImageRequest) (any, error) {
	if request == nil {
		return nil, errors.New("request is nil")
	}
	return request, nil
}

func (a *Adaptor) DoRequest(c *gin.Context, meta *meta.Meta, requestBody io.Reader) (*http.Response, error) {
	return custom.DoRequestHelper(a, c, meta, requestBody)
}

func (a *Adaptor) DoResponse(c *gin.Context, resp *http.Response, meta *meta.Meta) (usage *model.Usage, err *model.ErrorWithStatusCode) {
	if meta.IsStream {
		var responseText string
		err, responseText, usage = StreamHandler(c, resp, meta.Mode)
		if usage == nil || usage.TotalTokens == 0 {
			usage = ResponseText2Usage(responseText, meta.ActualModelName, meta.PromptTokens)
		}
		if usage.TotalTokens != 0 && usage.PromptTokens == 0 { // some channels don't return prompt tokens & completion tokens
			usage.PromptTokens = meta.PromptTokens
			usage.CompletionTokens = usage.TotalTokens - meta.PromptTokens
		}
	} else {
		switch meta.Mode {
		case relaymode.ImagesGenerations:
			err, _ = ImageHandler(c, resp)
		default:
			err, usage = Handler(c, resp, meta.PromptTokens, meta.ActualModelName)
		}
	}
	return
}

func (a *Adaptor) GetModelList() []string {
	_, modelList := GetCompatibleChannelMeta(a.ChannelType)
	return modelList
}

func (a *Adaptor) GetChannelName() string {
	channelName, _ := GetCompatibleChannelMeta(a.ChannelType)
	return channelName
}

func (a *Adaptor) HandlerUploadFileMessages(request *model.GeneralOpenAIRequest) {
	if request.Messages == nil || len(request.Messages) == 0 {
		return
	}

	var newMessages []model.Message
	var contentObjs []db_model.ObjectStringContent

	for _, message := range request.Messages {
		if message.Role == "assistant" {
			newMessages = append(newMessages, message)
			continue
		}

		if _, ok := message.Content.(string); !ok {
			newMessages = append(newMessages, message)
			continue
		}

		queryStr := message.Content.(string)
		if err := json.Unmarshal([]byte(queryStr), &contentObjs); err != nil {
			// Unmarshal failed, treat as normal text content
			newMessages = append(newMessages, message)
			continue
		}

		var contexts []any
		for _, contentObj := range contentObjs {
			if contentObj.Type == "text" {
				contexts = append(contexts, TextContent{
					Type: "text",
					Text: contentObj.Content,
				})
				continue
			} else if contentObj.Type == "image" {
				uoloadFile := contentObj.GetUploadFile()
				if uoloadFile == nil {
					logger.SysError("file not found")
					continue
				}

				if a.ChannelType == channeltype.FastGPT {
					fileType := GetFileFastGptTypeString(uoloadFile.Extension)
					if fileType == "" {
						logger.SysErrorf("yuanqi: file type not supported, %+v", contentObj)
						continue
					}
					if fileType == "file" {
						// fastgpt 支持文件,图片就和之前一样
						contexts = append(contexts, FastGptFileContent{
							Type: "file_url",
							Name: uoloadFile.FileName,
							Url:  uoloadFile.GetPreviewFullUrl(),
						})
						continue
					}
				}

				fileContent, err := storage.StorageInstance.Load(uoloadFile.Key)
				if err != nil {
					logger.SysError("file content not found")
					continue
				}
				base64Str := base64.StdEncoding.EncodeToString(fileContent)
				mimeType := uoloadFile.MimeType
				dataUrl := "data:" + mimeType + ";base64," + base64Str
				contexts = append(contexts, ImageContent{
					Type: "image_url",
					ImageURL: &model.ImageURL{
						Url: dataUrl,
					},
				})
				continue
			}
		}
		message.Content = contexts
		newMessages = append(newMessages, message)
	}

	request.Messages = newMessages
	// jsonBytes, err := json.Marshal(request)
	// if err != nil {
	// 	logger.SysError("marshal request failed")
	// 	return
	// }
	// logger.SysLogf("request: %s", string(jsonBytes))

	// return
}

func GetFileFastGptTypeString(extension string) string {
	// 兼容 openAI 目前是支持文件和图片
	var fileType string
	switch strings.ToLower(extension) {
	case ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp":
		fileType = "image"
	// case ".mp4", ".mov", ".avi", ".wmv", ".flv":
	// 	fileType = "video"
	// case ".mp3", ".wav", ".aac", ".flac":
	// 	fileType = "audio"
	// case ".pdf", ".txt", ".csv", ".json", ".xml", ".doc", ".docx":
	// 	fileType = "file"
	// case ".txt", ".csv", ".json", ".xml":
	// 	fileType = "text"
	// case ".doc", ".docx":
	// 	fileType = "doc"
	// case ".xls", ".xlsx":
	// 	fileType = "xls"
	// case ".ppt", ".pptx":
	// 	fileType = "ppt"
	default:
		fileType = "file"
	}

	return fileType
}
