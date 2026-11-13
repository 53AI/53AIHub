package custom_openai

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	hubcommon "github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/ctxkey"
	"github.com/53AI/53AIHub/common/storage"
	"github.com/53AI/53AIHub/common/thinkingpolicy"
	Hub_model "github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/hub_adaptor/custom"
	"github.com/53AI/53AIHub/service/hub_adaptor/openai"
	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/logger"
	"github.com/songquanpeng/one-api/relay/channeltype"
	"github.com/songquanpeng/one-api/relay/meta"
	"github.com/songquanpeng/one-api/relay/model"
	"github.com/songquanpeng/one-api/relay/relaymode"
)

type Adaptor struct {
	ChannelType     int
	CustomConfig    *custom.CustomConfig
	ChannelConfig   string // 添加渠道配置字段，存储原始JSON字符串
	NativeWebSearch bool
}

func (a *Adaptor) Init(meta *meta.Meta) {
	a.ChannelType = meta.ChannelType
	// 从meta中获取渠道配置（如果有的话）
	// 实际配置会在RelayTextHelper中直接注入
}

func (a *Adaptor) GetRequestURL(meta *meta.Meta) (string, error) {
	if meta.ChannelType == channeltype.Azure && meta.Config.APIVersion == "v1" {
		_, useResponses, err := a.responsesModel(meta.ActualModelName)
		if err != nil {
			return "", err
		}
		baseURL := strings.TrimSuffix(meta.BaseURL, "/")
		for _, suffix := range []string{"/openai/v1/responses", "/openai/v1/chat/completions", "/openai/v1", "/openai", "/v1"} {
			if strings.HasSuffix(baseURL, suffix) {
				baseURL = strings.TrimSuffix(baseURL, suffix)
				break
			}
		}
		requestPath, rawQuery, hasQuery := strings.Cut(meta.RequestURLPath, "?")
		task := strings.TrimPrefix(requestPath, "/v1")
		if task == "/chat/completions" && useResponses {
			task = "/responses"
		}
		if task == "/responses" && !useResponses {
			task = "/chat/completions"
		}
		if !strings.HasPrefix(task, "/") {
			task = "/" + task
		}
		path := baseURL + "/openai/v1" + task
		if hasQuery {
			query, parseErr := url.ParseQuery(rawQuery)
			if parseErr == nil {
				query.Del("api-version")
				if encoded := query.Encode(); encoded != "" {
					path += "?" + encoded
				}
			}
		}
		return path, nil
	}
	if meta.ChannelType != Hub_model.ChannelApiTypeCustomOpenAI && meta.ChannelType != 17 {
		_, useResponses, err := a.responsesModel(meta.ActualModelName)
		if err != nil {
			return "", err
		}
		if !useResponses {
			return (&openai.Adaptor{ChannelType: meta.ChannelType}).GetRequestURL(meta)
		}
		responsesMeta := *meta
		responsesMeta.Mode = relaymode.ChatCompletions
		path, query, hasQuery := strings.Cut(responsesMeta.RequestURLPath, "?")
		if strings.HasSuffix(path, "/v1/chat/completions") {
			path = strings.TrimSuffix(path, "/v1/chat/completions") + "/v1/responses"
		} else {
			return "", fmt.Errorf("Responses upstream configured for model %q, but request path %q is not Chat Completions", meta.ActualModelName, path)
		}
		if hasQuery {
			path += "?" + query
		}
		responsesMeta.RequestURLPath = path
		if responsesMeta.ChannelType != 3 && responsesMeta.ChannelType != 900 {
			responsesMeta.BaseURL = strings.TrimSuffix(strings.TrimSuffix(responsesMeta.BaseURL, "/"), "/v1")
		}
		requestURL, err := (&openai.Adaptor{ChannelType: meta.ChannelType}).GetRequestURL(&responsesMeta)
		if err != nil {
			return "", err
		}
		if meta.ChannelType == 900 {
			requestURL = strings.TrimSuffix(requestURL, "/chat/completions") + "/responses"
		}
		return requestURL, nil
	}

	requestURLPath := meta.RequestURLPath
	useResponses := false
	var err error
	_, useResponses, err = a.responsesModel(meta.ActualModelName)
	if err != nil {
		return "", err
	}
	baseURL := strings.TrimSuffix(meta.BaseURL, "/")
	path, query, hasQuery := strings.Cut(requestURLPath, "?")
	if strings.HasSuffix(path, "/v1/chat/completions") {
		endpoint := "/v1/chat/completions"
		if useResponses {
			endpoint = "/v1/responses"
		}
		for _, existingEndpoint := range []string{"/v1/chat/completions", "/v1/responses"} {
			if strings.HasSuffix(baseURL, existingEndpoint) {
				baseURL = strings.TrimSuffix(baseURL, existingEndpoint)
				break
			}
		}
		if strings.HasSuffix(baseURL, "/v1") {
			baseURL = strings.TrimSuffix(baseURL, "/v1")
		}
		if strings.HasSuffix(baseURL, "/v3") {
			endpoint = strings.TrimPrefix(endpoint, "/v1")
		}
		requestURLPath = endpoint
		if hasQuery {
			requestURLPath += "?" + query
		}
	} else if useResponses {
		return "", fmt.Errorf("Responses upstream configured for model %q, but request path %q is not Chat Completions", meta.ActualModelName, path)
	}
	return fmt.Sprintf("%s%s", baseURL, requestURLPath), nil
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
	if a.ChannelType != Hub_model.ChannelApiTypeCustomOpenAI && a.ChannelType != 17 {
		config, useResponses, err := a.responsesModel(request.Model)
		if err != nil {
			return nil, err
		}
		if a.ChannelType == channeltype.Azure {
			compatibilityModel := config.BaseModelID
			if compatibilityModel == "" {
				compatibilityModel = request.Model
			}
			openai.ApplyUnsupportedSamplingParameters(request, compatibilityModel)
		} else if a.ChannelType == channeltype.OpenAI {
			if catalogMeta, metaErr := hubcommon.GetModelCatalogLoader().GetModelMeta(a.ChannelType, request.Model); metaErr == nil {
				if chatMeta, ok := catalogMeta.(*hubcommon.ChatModelMeta); ok && chatMeta.DeepThinking {
					openai.ApplyUnsupportedSamplingParameters(request, request.Model)
				}
			}
		}
		openAIAdaptor := &openai.Adaptor{ChannelType: a.ChannelType, CustomConfig: a.CustomConfig, ChannelConfig: a.ChannelConfig}
		converted, err := openAIAdaptor.ConvertRequest(c, relayMode, request)
		if err != nil || !useResponses {
			return converted, err
		}
		encoded, err := json.Marshal(converted)
		if err != nil {
			return nil, err
		}
		var convertedRequest model.GeneralOpenAIRequest
		if err := json.Unmarshal(encoded, &convertedRequest); err != nil {
			return nil, err
		}
		payload, err := convertResponsesRequest(c, &convertedRequest, config, a.NativeWebSearch)
		if err == nil {
			applyResponsesThinking(payload, extractResponsesThinking(converted))
		}
		return payload, err
	}
	if request.Stream {
		// always return usage in stream mode
		if request.StreamOptions == nil {
			request.StreamOptions = &model.StreamOptions{}
		}
		request.StreamOptions.IncludeUsage = true
	}

	// 提取函数调用和视觉识别等配置（兼容新旧格式）
	if a.ChannelConfig != "" {
		type perModelCfg struct {
			ModelID      string `json:"model_id"`
			Vision       *bool  `json:"vision,omitempty"`
			FunctionCall *bool  `json:"function_calling,omitempty"`
		}
		var models []perModelCfg
		modelSupportsVision := false
		if catalogMeta, err := hubcommon.GetModelCatalogLoader().GetModelMeta(a.ChannelType, request.Model); err == nil {
			if chatMeta, ok := catalogMeta.(*hubcommon.ChatModelMeta); ok {
				modelSupportsVision = chatMeta.Vision
			}
		}
		if err := json.Unmarshal([]byte(a.ChannelConfig), &models); err == nil && len(models) > 0 {
			for _, mc := range models {
				if mc.ModelID == request.Model {
					if mc.Vision != nil && !*mc.Vision && !modelSupportsVision {
						request.Messages = removeImageContent(request.Messages)
					}
					if mc.FunctionCall != nil && !*mc.FunctionCall {
						request.Functions = nil
						request.ToolChoice = nil
					}
					break
				}
			}
		} else {
			var config map[string]interface{}
			if err := json.Unmarshal([]byte(a.ChannelConfig), &config); err == nil {
				if functionCalling, ok := config["function_calling"]; ok {
					if enabled, ok := functionCalling.(bool); ok && !enabled {
						request.Functions = nil
						request.ToolChoice = nil
					}
				}
				if vision, ok := config["vision"]; ok {
					if enabled, ok := vision.(bool); ok && !enabled {
						request.Messages = removeImageContent(request.Messages)
					}
				}
			}
		}
	}

	handlerUploadFileMessages(a.ChannelType, request)
	openai.ApplyTokenLimitForModel(request)

	disableThinking := a.CustomConfig != nil && a.CustomConfig.DisableThinking != nil && *a.CustomConfig.DisableThinking
	if disableThinking {
		jsonBytes, err := json.Marshal(request)
		if err != nil {
			return request, nil
		}
		ctx := context.Background()
		channelID := 0
		if c != nil && c.Request != nil {
			ctx = c.Request.Context()
			channelID = int(c.GetInt64(ctxkey.ChannelId))
		}
		modifiedJSON, applied, err := thinkingpolicy.ApplyDisableThinking(ctx, a.ChannelConfig, jsonBytes, request.Model, request.Model, a.CustomConfig.DisableThinking, channelID)
		if err != nil {
			return request, nil
		}
		if applied {
			var resultMap map[string]interface{}
			if err := json.Unmarshal(modifiedJSON, &resultMap); err != nil {
				return request, nil
			}
			if converted, isResponses, err := a.convertConfiguredRequest(c, request, resultMap); isResponses || err != nil {
				return converted, err
			}
			return resultMap, nil
		}
	}

	enableThinking := a.CustomConfig != nil && a.CustomConfig.EnableThinking != nil && *a.CustomConfig.EnableThinking
	if enableThinking {
		jsonBytes, err := json.Marshal(request)
		if err != nil {
			return request, nil
		}
		ctx := context.Background()
		channelID := 0
		if c != nil && c.Request != nil {
			ctx = c.Request.Context()
			channelID = int(c.GetInt64(ctxkey.ChannelId))
		}
		modifiedJSON, applied, err := thinkingpolicy.ApplyEnableThinking(ctx, a.ChannelConfig, jsonBytes, request.Model, request.Model, a.CustomConfig.EnableThinking, channelID)
		if err != nil {
			return request, nil
		}
		if applied {
			var resultMap map[string]interface{}
			if err := json.Unmarshal(modifiedJSON, &resultMap); err != nil {
				return request, nil
			}
			if converted, isResponses, err := a.convertConfiguredRequest(c, request, resultMap); isResponses || err != nil {
				return converted, err
			}
			return resultMap, nil
		}
	}
	if converted, isResponses, err := a.convertConfiguredRequest(c, request, nil); isResponses || err != nil {
		return converted, err
	}
	return request, nil
}

func (a *Adaptor) convertConfiguredRequest(c *gin.Context, request *model.GeneralOpenAIRequest, modified map[string]interface{}) (any, bool, error) {
	config, isResponses, err := a.responsesModel(request.Model)
	if err != nil || !isResponses {
		return nil, isResponses, err
	}
	if modified != nil {
		encoded, err := json.Marshal(modified)
		if err != nil {
			return nil, true, err
		}
		var convertedRequest model.GeneralOpenAIRequest
		if err := json.Unmarshal(encoded, &convertedRequest); err != nil {
			return nil, true, err
		}
		request = &convertedRequest
	}
	converted, err := convertResponsesRequest(c, request, config, a.NativeWebSearch)
	if err == nil {
		applyResponsesThinking(converted, extractResponsesThinking(modified))
	}
	return converted, true, err
}

func extractResponsesThinking(request any) string {
	requestMap, ok := request.(map[string]interface{})
	if !ok {
		return ""
	}
	thinking, ok := requestMap["thinking"].(map[string]interface{})
	if !ok {
		return ""
	}
	thinkingType, _ := thinking["type"].(string)
	return thinkingType
}

func applyResponsesThinking(payload map[string]any, thinkingType string) {
	var effort string
	switch thinkingType {
	case "enabled":
		effort = "high"
	case "disabled":
		effort = "none"
	default:
		return
	}
	payload["reasoning"] = map[string]any{"effort": effort}
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
	if meta.ChannelType == channeltype.Azure && a.NativeWebSearch {
		if policyErr := azureWebSearchPolicyError(resp); policyErr != nil {
			return nil, policyErr
		}
	}
	if meta.Mode == relaymode.ChatCompletions {
		_, isResponses, configErr := a.responsesModel(meta.ActualModelName)
		if configErr != nil {
			return nil, openai.ErrorWrapper(configErr, "invalid_model_config", http.StatusInternalServerError)
		}
		if isResponses {
			return a.handleResponsesResponse(c, resp, meta)
		}
	}
	if meta.IsStream {
		var responseText string
		err, responseText, usage = openai.StreamHandler(c, resp, meta.Mode)
		if usage == nil || usage.TotalTokens == 0 {
			usage = openai.ResponseText2Usage(responseText, meta.ActualModelName, meta.PromptTokens)
		}
		if usage.TotalTokens != 0 && usage.PromptTokens == 0 { // some channels don't return prompt tokens & completion tokens
			usage.PromptTokens = meta.PromptTokens
			usage.CompletionTokens = usage.TotalTokens - meta.PromptTokens
		}
	} else {
		switch meta.Mode {
		case relaymode.ImagesGenerations:
			err, _ = openai.ImageHandler(c, resp)
		default:
			err, usage = openai.Handler(c, resp, meta.PromptTokens, meta.ActualModelName)
		}
	}
	return
}

func azureWebSearchPolicyError(resp *http.Response) *model.ErrorWithStatusCode {
	if resp == nil || resp.StatusCode < http.StatusBadRequest || resp.Body == nil {
		return nil
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil
	}
	resp.Body.Close()
	resp.Body = io.NopCloser(bytes.NewReader(body))
	message := strings.ToLower(string(body))
	if !strings.Contains(message, "web_search") && !strings.Contains(message, "web search") {
		return nil
	}
	for _, reason := range []string{"disabled", "not enabled", "not available", "not supported", "blocked", "policy", "forbidden"} {
		if strings.Contains(message, reason) {
			return openai.ErrorWrapper(errors.New("Azure 订阅或策略未启用模型联网搜索，请管理员开通 Web Search，或关闭该模型的联网搜索"), "azure_web_search_disabled", resp.StatusCode)
		}
	}
	return nil
}

func (a *Adaptor) GetModelList() []string {
	_, modelList := openai.GetCompatibleChannelMeta(a.ChannelType)
	return modelList
}

func (a *Adaptor) GetChannelName() string {
	channelName, _ := openai.GetCompatibleChannelMeta(a.ChannelType)
	return channelName
}

// handlerUploadFileMessages 处理上传文件消息
func handlerUploadFileMessages(channelType int, request *model.GeneralOpenAIRequest) {
	if request.Messages == nil || len(request.Messages) == 0 {
		return
	}

	var newMessages []model.Message
	var contentObjs []Hub_model.ObjectStringContent

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
				contexts = append(contexts, openai.TextContent{
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

				if channelType == channeltype.FastGPT {
					fileType := openai.GetFileFastGptTypeString(uoloadFile.Extension)
					if fileType == "" {
						logger.SysErrorf("yuanqi: file type not supported, %+v", contentObj)
						continue
					}
					if fileType == "file" {
						// fastgpt 支持文件,图片就和之前一样
						contexts = append(contexts, openai.FastGptFileContent{
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
				contexts = append(contexts, openai.ImageContent{
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
}
