package custom_openai

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

	hubcommon "github.com/53AI/53AIHub/common"
	"github.com/songquanpeng/one-api/common"
	"github.com/songquanpeng/one-api/common/render"

	Hub_model "github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/hub_adaptor/openai"
	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/logger"
	"github.com/songquanpeng/one-api/relay/channeltype"
	"github.com/songquanpeng/one-api/relay/meta"
	"github.com/songquanpeng/one-api/relay/model"
)

type responsesAPIResponse struct {
	ID                string                      `json:"id"`
	Model             string                      `json:"model"`
	Object            string                      `json:"object"`
	CreatedAt         int64                       `json:"created_at"`
	Status            string                      `json:"status"`
	IncompleteDetails *responsesIncompleteDetails `json:"incomplete_details"`
	Error             *model.Error                `json:"error"`
	Output            []responsesOutputItem       `json:"output"`
	Usage             *responsesTokenUsage        `json:"usage"`
}

type responsesIncompleteDetails struct {
	Reason string `json:"reason"`
}

type responsesOutputItem struct {
	Type      string                   `json:"type"`
	ID        string                   `json:"id"`
	CallID    string                   `json:"call_id"`
	Status    string                   `json:"status"`
	Name      string                   `json:"name"`
	Arguments string                   `json:"arguments"`
	Role      string                   `json:"role"`
	Content   []responsesOutputContent `json:"content"`
	Action    *responsesAction         `json:"action,omitempty"`
}

type responsesAction struct {
	Sources []responsesWebSearchSource `json:"sources"`
}

type responsesWebSearchSource struct {
	Type     string `json:"type"`
	Title    string `json:"title"`
	URL      string `json:"url"`
	Snippet  string `json:"snippet"`
	SiteName string `json:"site_name"`
	SiteIcon string `json:"site_icon"`
}

type WebSearchSource struct {
	Title   string `json:"title"`
	URL     string `json:"url"`
	Content string `json:"content"`
	Date    string `json:"date"`
}

func ExtractResponsesWebSearchResult(ctx context.Context, body []byte) ([]WebSearchSource, *model.Usage, error) {
	var response responsesAPIResponse
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, nil, fmt.Errorf("解析 Responses 搜索结果失败: %w", err)
	}
	searchURLs := make(map[string]struct{})
	searchPerformed := false
	var outputTexts []string
	for _, item := range response.Output {
		if (item.Type == "search" || item.Type == "web_search_call") && item.Action != nil && (item.Status == "" || item.Status == "completed") {
			searchPerformed = true
			for _, source := range item.Action.Sources {
				if normalized, ok := normalizeWebSearchURL(source.URL); ok {
					searchURLs[normalized] = struct{}{}
				}
			}
		}
		if item.Type == "message" {
			for _, content := range item.Content {
				if content.Type != "output_text" || strings.TrimSpace(content.Text) == "" {
					continue
				}
				outputTexts = append(outputTexts, strings.TrimSpace(content.Text))
			}
		}
	}
	if !searchPerformed {
		return nil, responsesUsage(response.Usage), errors.New("Responses API 未执行联网搜索")
	}
	if len(searchURLs) == 0 {
		return nil, responsesUsage(response.Usage), errors.New("Responses API 联网搜索未返回有效网页地址")
	}
	if len(outputTexts) == 0 {
		return nil, responsesUsage(response.Usage), errors.New("Responses API 未返回模型整理的网页资料")
	}
	var sources []WebSearchSource
	if err := hubcommon.ParseLLMJSONInto(ctx, strings.Join(outputTexts, "\n"), &sources); err != nil {
		return nil, responsesUsage(response.Usage), fmt.Errorf("解析模型网页资料 JSON 失败: %w", err)
	}
	seen := make(map[string]struct{}, len(sources))
	verified := make([]WebSearchSource, 0, len(sources))
	for _, source := range sources {
		normalized, ok := normalizeWebSearchURL(source.URL)
		if !ok || strings.TrimSpace(source.Content) == "" {
			continue
		}
		if _, exists := searchURLs[normalized]; !exists {
			continue
		}
		if _, exists := seen[normalized]; exists {
			continue
		}
		seen[normalized] = struct{}{}
		source.URL = strings.TrimSpace(source.URL)
		source.Title = strings.TrimSpace(source.Title)
		if source.Title == "" {
			source.Title = source.URL
		}
		source.Content = strings.TrimSpace(source.Content)
		source.Date = strings.TrimSpace(source.Date)
		verified = append(verified, source)
	}
	if len(verified) == 0 {
		return nil, responsesUsage(response.Usage), errors.New("Responses API 未返回与实际搜索结果匹配的网页资料")
	}
	return verified, responsesUsage(response.Usage), nil
}

func normalizeWebSearchURL(raw string) (string, bool) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return "", false
	}
	parsed.Scheme = strings.ToLower(parsed.Scheme)
	parsed.Host = strings.ToLower(parsed.Host)
	parsed.Fragment = ""
	if parsed.Path != "/" {
		parsed.Path = strings.TrimRight(parsed.Path, "/")
	}
	return parsed.String(), true
}

type responsesOutputContent struct {
	Type        string                `json:"type"`
	Text        string                `json:"text"`
	Refusal     string                `json:"refusal"`
	Annotations []responsesAnnotation `json:"annotations"`
}

type responsesAnnotation struct {
	Type       string `json:"type"`
	URL        string `json:"url"`
	Title      string `json:"title"`
	StartIndex int    `json:"start_index"`
	EndIndex   int    `json:"end_index"`
}

type responsesTokenUsage struct {
	InputTokens  int `json:"input_tokens"`
	OutputTokens int `json:"output_tokens"`
	TotalTokens  int `json:"total_tokens"`
}

type responsesStreamEvent struct {
	Type        string                `json:"type"`
	Delta       string                `json:"delta"`
	ItemID      string                `json:"item_id"`
	OutputIndex int                   `json:"output_index"`
	Item        responsesOutputItem   `json:"item"`
	Response    *responsesAPIResponse `json:"response"`
	Error       *model.Error          `json:"error"`
}

func (a *Adaptor) handleResponsesResponse(c *gin.Context, resp *http.Response, meta *meta.Meta) (*model.Usage, *model.ErrorWithStatusCode) {
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return nil, responsesUpstreamError(resp)
	}
	if meta.IsStream {
		return handleResponsesStream(c, resp, meta)
	}
	return handleResponsesJSON(c, resp, meta)
}

func responsesUpstreamError(resp *http.Response) *model.ErrorWithStatusCode {
	body, err := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if err != nil {
		return &model.ErrorWithStatusCode{Error: model.Error{Message: err.Error(), Type: "upstream_error"}, StatusCode: http.StatusBadGateway}
	}
	var payload struct {
		Error model.Error `json:"error"`
	}
	if json.Unmarshal(body, &payload) != nil || payload.Error.Message == "" {
		payload.Error = model.Error{Message: strings.TrimSpace(string(body)), Type: "upstream_error"}
	}
	return &model.ErrorWithStatusCode{Error: payload.Error, StatusCode: resp.StatusCode}
}

func handleResponsesJSON(c *gin.Context, resp *http.Response, meta *meta.Meta) (*model.Usage, *model.ErrorWithStatusCode) {
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		_ = resp.Body.Close()
		return nil, openai.ErrorWrapper(err, "read_response_body_failed", http.StatusBadGateway)
	}
	if err := resp.Body.Close(); err != nil {
		return nil, openai.ErrorWrapper(err, "close_response_body_failed", http.StatusInternalServerError)
	}
	var response responsesAPIResponse
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, openai.ErrorWrapper(err, "unmarshal_response_body_failed", http.StatusBadGateway)
	}
	if response.Error != nil {
		return nil, &model.ErrorWithStatusCode{Error: *response.Error, StatusCode: responsesErrorStatus(resp.StatusCode)}
	}
	completion, usage, err := responsesToChatCompletion(response, meta)
	if err != nil {
		return nil, openai.ErrorWrapper(err, "convert_responses_body_failed", http.StatusBadGateway)
	}
	for key, values := range resp.Header {
		if len(values) > 0 && !strings.EqualFold(key, "Content-Length") && !strings.EqualFold(key, "Content-Encoding") {
			c.Writer.Header().Set(key, values[0])
		}
	}
	c.Writer.Header().Set("Content-Type", "application/json")
	c.Writer.WriteHeader(resp.StatusCode)
	if err := json.NewEncoder(c.Writer).Encode(completion); err != nil {
		return nil, openai.ErrorWrapper(err, "write_response_body_failed", http.StatusInternalServerError)
	}
	return usage, nil
}

func responsesToChatCompletion(response responsesAPIResponse, meta *meta.Meta) (map[string]any, *model.Usage, error) {
	var text strings.Builder
	var reasoning strings.Builder
	var citations []string
	var calls []map[string]any
	for _, item := range response.Output {
		switch item.Type {
		case "reasoning":
			for _, content := range item.Content {
				if content.Type == "reasoning_text" {
					reasoning.WriteString(content.Text)
				}
			}
		case "message":
			for _, content := range item.Content {
				switch content.Type {
				case "output_text":
					text.WriteString(content.Text)
					for _, annotation := range content.Annotations {
						if annotation.Type == "url_citation" && annotation.URL != "" {
							title := annotation.Title
							if title == "" {
								title = annotation.URL
							}
							citations = append(citations, fmt.Sprintf("[%s](%s)", title, annotation.URL))
						}
					}
				case "refusal":
					text.WriteString(content.Refusal)
				}
			}
		case "function_call":
			callID := item.CallID
			if callID == "" {
				callID = item.ID
			}
			if callID == "" || item.Name == "" {
				return nil, nil, errors.New("Responses function_call missing id or name")
			}
			calls = append(calls, map[string]any{"id": callID, "type": "function", "function": map[string]any{"name": item.Name, "arguments": item.Arguments}})
		}
	}
	content := text.String()
	if len(citations) > 0 {
		content += "\n\nSources:\n" + strings.Join(uniqueStrings(citations), "\n")
	}
	modelName := response.Model
	if modelName == "" {
		modelName = meta.ActualModelName
	}
	finishReason := "stop"
	if len(calls) > 0 {
		finishReason = "tool_calls"
	} else if response.Status == "incomplete" {
		finishReason = responsesIncompleteFinishReason(response.IncompleteDetails)
	}
	created := response.CreatedAt
	completion := map[string]any{
		"id": response.ID, "object": "chat.completion", "created": created, "model": modelName,
		"choices": []any{map[string]any{"index": 0, "message": map[string]any{"role": "assistant", "content": content, "tool_calls": nonNilToolCalls(calls)}, "finish_reason": finishReason}},
	}
	if reasoning.Len() > 0 {
		completion["choices"].([]any)[0].(map[string]any)["message"].(map[string]any)["reasoning_content"] = reasoning.String()
	}
	usage := responsesUsage(response.Usage)
	if usage == nil || usage.TotalTokens == 0 {
		usage = openai.ResponseText2Usage(text.String(), modelName, meta.PromptTokens)
	}
	completion["usage"] = usage
	return completion, usage, nil
}

func responsesIncompleteFinishReason(details *responsesIncompleteDetails) string {
	if details != nil && details.Reason == "content_filter" {
		return "content_filter"
	}
	return "length"
}

func nonNilToolCalls(calls []map[string]any) []map[string]any {
	if calls == nil {
		return []map[string]any{}
	}
	return calls
}

func responsesUsage(usage *responsesTokenUsage) *model.Usage {
	if usage == nil {
		return nil
	}
	total := usage.TotalTokens
	if total == 0 {
		total = usage.InputTokens + usage.OutputTokens
	}
	return &model.Usage{PromptTokens: usage.InputTokens, CompletionTokens: usage.OutputTokens, TotalTokens: total}
}

func uniqueStrings(values []string) []string {
	seen := make(map[string]bool, len(values))
	unique := make([]string, 0, len(values))
	for _, value := range values {
		if !seen[value] {
			seen[value] = true
			unique = append(unique, value)
		}
	}
	return unique
}

func handleResponsesStream(c *gin.Context, resp *http.Response, meta *meta.Meta) (*model.Usage, *model.ErrorWithStatusCode) {
	common.SetEventStreamHeaders(c)
	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	var eventName string
	var dataLines []string
	var usage *model.Usage
	var response *responsesAPIResponse
	var text strings.Builder
	toolItemIDs := make(map[string]bool)
	chatToolIndexes := make(map[int]int)
	nextChatToolIndex := 0
	toolCallsStarted := false
	responseID := ""
	modelName := meta.ActualModelName
	createdAt := time.Now().Unix()
	emit := func(payload any) error { return render.ObjectData(c, payload) }
	toolIndex := func(outputIndex int) int {
		if index, ok := chatToolIndexes[outputIndex]; ok {
			return index
		}
		index := nextChatToolIndex
		nextChatToolIndex++
		chatToolIndexes[outputIndex] = index
		return index
	}
	process := func() error {
		if len(dataLines) == 0 {
			eventName = ""
			return nil
		}
		data := strings.Join(dataLines, "\n")
		dataLines = nil
		var event responsesStreamEvent
		if err := json.Unmarshal([]byte(data), &event); err != nil {
			return fmt.Errorf("decode Responses event %q: %w", eventName, err)
		}
		if event.Type == "" {
			event.Type = eventName
		}
		if event.Error != nil {
			return &responsesStreamError{status: responsesErrorStatus(resp.StatusCode), err: *event.Error}
		}
		switch event.Type {
		case "response.reasoning_text.delta":
			return emit(chatStreamChunk(responseID, modelName, createdAt, map[string]any{"reasoning_content": event.Delta}, nil, nil))
		case "response.output_text.delta":
			text.WriteString(event.Delta)
			return emit(chatStreamChunk(responseID, modelName, createdAt, map[string]any{"content": event.Delta}, nil, nil))
		case "response.refusal.delta":
			text.WriteString(event.Delta)
			return emit(chatStreamChunk(responseID, modelName, createdAt, map[string]any{"content": event.Delta}, nil, nil))
		case "response.output_item.added":
			if event.Item.Type != "function_call" {
				return nil
			}
			toolCallsStarted = true
			toolItemIDs[event.Item.ID] = true
			toolItemIDs[event.Item.CallID] = true
			index := toolIndex(event.OutputIndex)
			id := event.Item.CallID
			if id == "" {
				id = event.Item.ID
			}
			return emit(chatStreamChunk(responseID, modelName, createdAt, map[string]any{"tool_calls": []any{map[string]any{"index": index, "id": id, "type": "function", "function": map[string]any{"name": event.Item.Name, "arguments": event.Item.Arguments}}}}, nil, nil))
		case "response.function_call_arguments.delta":
			toolCallsStarted = true
			toolItemIDs[event.ItemID] = true
			index := toolIndex(event.OutputIndex)
			return emit(chatStreamChunk(responseID, modelName, createdAt, map[string]any{"tool_calls": []any{map[string]any{"index": index, "function": map[string]any{"arguments": event.Delta}}}}, nil, nil))
		case "response.created", "response.in_progress":
			if event.Response != nil {
				responseID = event.Response.ID
				if event.Response.CreatedAt > 0 {
					createdAt = event.Response.CreatedAt
				}
				if event.Response.Model != "" {
					modelName = event.Response.Model
				}
			}
		case "response.completed", "response.incomplete", "response.done":
			response = event.Response
			if response != nil {
				responseID = response.ID
				if response.CreatedAt > 0 {
					createdAt = response.CreatedAt
				}
				if response.Model != "" {
					modelName = response.Model
				}
				usage = responsesUsage(response.Usage)
				completion, _, err := responsesToChatCompletion(*response, meta)
				if err != nil {
					return err
				}
				choices := completion["choices"].([]any)
				choice := choices[0].(map[string]any)
				message := choice["message"].(map[string]any)
				if citations, ok := message["content"].(string); ok && citations != text.String() {
					citationSuffix := strings.TrimPrefix(citations, text.String())
					if citationSuffix != "" {
						text.WriteString(citationSuffix)
						if err := emit(chatStreamChunk(responseID, modelName, createdAt, map[string]any{"content": citationSuffix}, nil, nil)); err != nil {
							return err
						}
					}
				}
				for index, item := range response.Output {
					if item.Type != "function_call" || toolItemIDs[item.ID] || toolItemIDs[item.CallID] {
						continue
					}
					callID := item.CallID
					if callID == "" {
						callID = item.ID
					}
					toolCallsStarted = true
					toolItemIDs[item.ID] = true
					toolItemIDs[item.CallID] = true
					chatIndex := toolIndex(index)
					if err := emit(chatStreamChunk(responseID, modelName, createdAt, map[string]any{"tool_calls": []any{map[string]any{"index": chatIndex, "id": callID, "type": "function", "function": map[string]any{"name": item.Name, "arguments": item.Arguments}}}}, nil, nil)); err != nil {
						return err
					}
				}
			}
			finishReason := "stop"
			if toolCallsStarted {
				finishReason = "tool_calls"
			} else if event.Type == "response.incomplete" || (response != nil && response.Status == "incomplete") {
				var details *responsesIncompleteDetails
				if response != nil {
					details = response.IncompleteDetails
				}
				finishReason = responsesIncompleteFinishReason(details)
			}
			if err := emit(chatStreamChunk(responseID, modelName, createdAt, map[string]any{}, &finishReason, nil)); err != nil {
				return err
			}
			if usage == nil || usage.TotalTokens == 0 {
				usage = openai.ResponseText2Usage(text.String(), modelName, meta.PromptTokens)
			}
			return emit(chatStreamChunk(responseID, modelName, createdAt, nil, nil, usage))
		case "response.failed", "error":
			if event.Error == nil && event.Response != nil {
				event.Error = event.Response.Error
			}
			if event.Error == nil {
				event.Error = &model.Error{Message: "Responses stream failed", Type: "upstream_error"}
			}
			return &responsesStreamError{status: responsesErrorStatus(resp.StatusCode), err: *event.Error}
		}
		eventName = ""
		return nil
	}
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			if err := process(); err != nil {
				_ = resp.Body.Close()
				if streamErr, ok := err.(*responsesStreamError); ok {
					return usage, &model.ErrorWithStatusCode{Error: streamErr.err, StatusCode: streamErr.status}
				}
				return usage, openai.ErrorWrapper(err, "convert_responses_stream_failed", http.StatusBadGateway)
			}
			continue
		}
		if strings.HasPrefix(line, "event:") {
			eventName = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
		} else if strings.HasPrefix(line, "data:") {
			dataLines = append(dataLines, strings.TrimSpace(strings.TrimPrefix(line, "data:")))
		}
	}
	if err := scanner.Err(); err != nil {
		_ = resp.Body.Close()
		return usage, openai.ErrorWrapper(err, "read_stream_failed", http.StatusBadGateway)
	}
	if len(dataLines) > 0 {
		if err := process(); err != nil {
			_ = resp.Body.Close()
			if streamErr, ok := err.(*responsesStreamError); ok {
				return usage, &model.ErrorWithStatusCode{Error: streamErr.err, StatusCode: streamErr.status}
			}
			return usage, openai.ErrorWrapper(err, "convert_responses_stream_failed", http.StatusBadGateway)
		}
	}
	if response == nil {
		_ = resp.Body.Close()
		return usage, openai.ErrorWrapper(errors.New("Responses stream ended before a completed response"), "incomplete_responses_stream", http.StatusBadGateway)
	}
	if err := resp.Body.Close(); err != nil {
		return usage, openai.ErrorWrapper(err, "close_response_body_failed", http.StatusInternalServerError)
	}
	render.Done(c)
	return usage, nil
}

type responsesStreamError struct {
	status int
	err    model.Error
}

func (e *responsesStreamError) Error() string { return e.err.Message }

func responsesErrorStatus(status int) int {
	if status < http.StatusBadRequest {
		return http.StatusBadGateway
	}
	return status
}

func chatStreamChunk(id, modelName string, createdAt int64, delta map[string]any, finishReason *string, usage *model.Usage) map[string]any {
	if id == "" {
		id = "chatcmpl-responses"
	}
	if delta == nil {
		delta = map[string]any{}
	}
	chunk := map[string]any{"id": id, "object": "chat.completion.chunk", "created": createdAt, "model": modelName}
	if usage != nil {
		chunk["choices"] = []any{}
		chunk["usage"] = usage
	} else {
		chunk["choices"] = []any{map[string]any{"index": 0, "delta": delta, "finish_reason": finishReason}}
	}
	return chunk
}

func (a *Adaptor) responsesModel(modelName string) (ModelConfig, bool, error) {
	return ResolveModelConfig(a.ChannelType, a.ChannelConfig, modelName)
}

func ResolveModelConfig(channelType int, channelConfig, modelName string) (ModelConfig, bool, error) {
	config, err := ParseModelConfig(channelConfig, modelName)
	if err != nil {
		return config, false, err
	}
	config.IncludeWebSearchSources = channelType == channeltype.Azure || channelType == channeltype.OpenAI
	lookupModel := modelName
	if channelType == channeltype.Azure && config.BaseModelID != "" {
		lookupModel = config.BaseModelID
	}
	var catalogMeta *hubcommon.ChatModelMeta
	if metaValue, metaErr := hubcommon.GetModelCatalogLoader().GetModelMeta(channelType, lookupModel); metaErr == nil {
		catalogMeta, _ = metaValue.(*hubcommon.ChatModelMeta)
	}
	if catalogMeta != nil {
		if channelType == channeltype.Azure && config.APIFormatConfigured && len(catalogMeta.SupportedAPIFormats) > 0 && !slices.Contains(catalogMeta.SupportedAPIFormats, config.UpstreamAPIFormat) {
			return config, false, fmt.Errorf("Azure 基础模型 %q 不支持 %s", lookupModel, config.UpstreamAPIFormat)
		}
		if channelType == channeltype.Azure && config.EnabledTools["web_search"] && !slices.Contains(catalogMeta.EnabledTools, "web_search") {
			return config, false, fmt.Errorf("Azure 基础模型 %q 不支持模型原生联网搜索", lookupModel)
		}
		if !config.APIFormatConfigured && catalogMeta.UpstreamAPIFormat != "" && (channelType != channeltype.Azure || config.BaseModelID != "") {
			config.UpstreamAPIFormat = catalogMeta.UpstreamAPIFormat
		}
	}
	if !hasEnabledTools(config) && (channelType != channeltype.Azure || config.BaseModelID != "") {
		if catalogMeta != nil {
			for _, tool := range catalogMeta.EnabledTools {
				config.EnabledTools[tool] = true
			}
		}
	}
	if channelType == channeltype.DeepSeek && modelName == "deepseek-v4-pro" {
		delete(config.EnabledTools, "web_search")
	}
	if config.Vision == nil && catalogMeta != nil {
		vision := catalogMeta.Vision
		config.Vision = &vision
	}
	if !supportsConfiguredResponses(channelType) {
		return config, false, nil
	}
	if config.APIFormatConfigured {
		return config, config.UpstreamAPIFormat == APIFormatResponses, nil
	}
	if isDefaultResponsesModel(channelType, modelName) {
		config.UpstreamAPIFormat = APIFormatResponses
	}
	return config, config.UpstreamAPIFormat == APIFormatResponses, nil
}

func supportsConfiguredResponses(channelType int) bool {
	switch channelType {
	case Hub_model.ChannelApiTypeCustomOpenAI, 1, 3, 17, 36, 900, Hub_model.ChannelApiTypeTencentTokenHub:
		return true
	default:
		return false
	}
}

func isDefaultResponsesModel(channelType int, modelName string) bool {
	models, ok := defaultResponsesModels[channelType]
	if !ok {
		return false
	}
	_, ok = models[modelName]
	return ok
}

var defaultResponsesModels = map[int]map[string]struct{}{
	1:    modelSet("gpt-6-astra", "gpt-6.1-sol", "gpt-6-luna", "gpt-5", "gpt-5-mini", "gpt-5-nano", "gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini", "o1", "o3", "o4-mini"),
	3:    modelSet("gpt-4o", "gpt-4o-mini"),
	17:   modelSet("qwen3.7-max", "qwen3.7-plus", "qwen3.6-flash", "deepseek-v4.1-flash", "deepseek-v4-pro"),
	36:   modelSet("deepseek-flash", "deepseek-v4-pro"),
	900:  modelSet("doubao-seed-2-0-lite-260428", "doubao-seed-2-0-mini-260428", "doubao-seed-2-0-pro-260215", "doubao-seed-2-0-code-preview-260215", "deepseek-v4-pro-260425", "deepseek-v4-flash-260425"),
	1019: modelSet("hy4-preview", "hy3", "deepseek-v4-pro", "deepseek-v4-flash", "kimi-k3"),
}

func modelSet(modelIDs ...string) map[string]struct{} {
	models := make(map[string]struct{}, len(modelIDs))
	for _, modelID := range modelIDs {
		models[modelID] = struct{}{}
	}
	return models
}

func convertResponsesRequest(c *gin.Context, request *model.GeneralOpenAIRequest, config ModelConfig, nativeWebSearch bool) (map[string]any, error) {
	if err := validateResponsesRequest(request); err != nil {
		return nil, err
	}
	if ignored := ignoredResponsesParams(request); len(ignored) > 0 && c != nil && c.Request != nil {
		logger.Warnf(c.Request.Context(), "【Responses兼容】上游不支持或未使用的可选参数已省略：%s", strings.Join(ignored, ", "))
	}
	payload := map[string]any{"model": request.Model}
	if nativeWebSearch && strings.HasPrefix(strings.ToLower(strings.TrimSpace(request.Model)), "deepseek-v4") {
		payload["reasoning"] = map[string]any{"effort": "none"}
	}
	var instructions []string
	var input []any
	for _, message := range request.Messages {
		switch message.Role {
		case "system", "developer":
			if text := message.StringContent(); text != "" {
				instructions = append(instructions, text)
			}
		case "user", "assistant":
			if message.Content != nil {
				item := map[string]any{"type": "message", "role": message.Role, "content": responsesInputContent(message.Content)}
				if message.Name != nil {
					item["name"] = *message.Name
				}
				input = append(input, item)
			}
			if message.Role == "assistant" {
				for _, call := range message.ToolCalls {
					if call.Id == "" || call.Function.Name == "" {
						return nil, errors.New("Responses function call requires an id and function name")
					}
					arguments, err := functionArguments(call.Function.Arguments)
					if err != nil {
						return nil, fmt.Errorf("Responses function call %q arguments: %w", call.Function.Name, err)
					}
					input = append(input, map[string]any{
						"type": "function_call", "call_id": call.Id,
						"name": call.Function.Name, "arguments": arguments,
					})
				}
			}
		case "tool":
			if message.ToolCallId == "" {
				return nil, errors.New("Responses function_call_output requires tool_call_id")
			}
			output, err := responseOutput(message.Content)
			if err != nil {
				return nil, err
			}
			input = append(input, map[string]any{
				"type": "function_call_output", "call_id": message.ToolCallId, "output": output,
			})
		default:
			return nil, fmt.Errorf("Responses API does not support message role %q", message.Role)
		}
	}
	if len(instructions) > 0 {
		payload["instructions"] = strings.Join(instructions, "\n\n")
	}
	payload["input"] = input
	if request.Temperature != nil {
		payload["temperature"] = request.Temperature
	}
	if request.TopP != nil {
		payload["top_p"] = request.TopP
	}
	if request.MaxCompletionTokens != nil {
		if *request.MaxCompletionTokens > 0 {
			payload["max_output_tokens"] = *request.MaxCompletionTokens
		}
	} else if request.MaxTokens > 0 {
		payload["max_output_tokens"] = request.MaxTokens
	}
	if request.ResponseFormat != nil {
		format, err := responsesFormat(request.ResponseFormat)
		if err != nil {
			return nil, err
		}
		payload["text"] = map[string]any{"format": format}
	}
	if request.Stream {
		payload["stream"] = true
	}
	if request.Store != nil {
		payload["store"] = *request.Store
	}
	if request.Metadata != nil {
		payload["metadata"] = request.Metadata
	}
	if request.User != "" {
		payload["user"] = request.User
	}
	if request.ParallelTooCalls != nil {
		payload["parallel_tool_calls"] = *request.ParallelTooCalls
	}
	functionsEnabled := configuredFunctionCalling(config) && (!hasEnabledTools(config) || config.EnabledTools["function"])
	if functionsEnabled {
		tools, err := responsesFunctionTools(request)
		if err != nil {
			return nil, err
		}
		if len(tools) > 0 {
			payload["tools"] = tools
			choice, err := responsesToolChoice(request.ToolChoice, request.FunctionCall)
			if err != nil {
				return nil, err
			}
			if choice != nil {
				payload["tool_choice"] = choice
			}
		}
	}
	if nativeWebSearch && config.EnabledTools["web_search"] {
		payload["tools"] = []any{map[string]any{"type": "web_search"}}
		if config.IncludeWebSearchSources {
			payload["include"] = []string{"web_search_call.action.sources"}
		}
		delete(payload, "tool_choice")
	}
	return payload, nil
}

func configuredFunctionCalling(config ModelConfig) bool {
	raw, ok := config.Raw["function_calling"]
	if !ok {
		return true
	}
	var enabled bool
	return json.Unmarshal(raw, &enabled) == nil && enabled
}

func hasEnabledTools(config ModelConfig) bool {
	_, ok := config.Raw["enabled_tools"]
	return ok
}

func validateResponsesRequest(request *model.GeneralOpenAIRequest) error {
	for _, modality := range request.Modalities {
		if modality != "text" {
			return errors.New("Responses API audio or multimodal output is not supported")
		}
	}
	if request.Audio != nil {
		return errors.New("Responses API audio output is not supported")
	}
	return nil
}

func ignoredResponsesParams(request *model.GeneralOpenAIRequest) []string {
	var ignored []string
	if request.N != 0 && request.N != 1 {
		ignored = append(ignored, "n")
	}
	if !emptyRequestValue(request.Stop) {
		ignored = append(ignored, "stop")
	}
	if request.Logprobs != nil && *request.Logprobs || request.TopLogprobs != nil && *request.TopLogprobs > 0 {
		ignored = append(ignored, "logprobs")
	}
	if !emptyRequestValue(request.LogitBias) {
		ignored = append(ignored, "logit_bias")
	}
	if !emptyRequestValue(request.Prediction) {
		ignored = append(ignored, "prediction")
	}
	if request.TopK != 0 {
		ignored = append(ignored, "top_k")
	}
	if request.FrequencyPenalty != nil && *request.FrequencyPenalty != 0 {
		ignored = append(ignored, "frequency_penalty")
	}
	if request.PresencePenalty != nil && *request.PresencePenalty != 0 {
		ignored = append(ignored, "presence_penalty")
	}
	if request.Seed != 0 {
		ignored = append(ignored, "seed")
	}
	if request.ServiceTier != nil && *request.ServiceTier != "" {
		ignored = append(ignored, "service_tier")
	}
	if request.MaxTokens > 0 && request.MaxCompletionTokens != nil {
		ignored = append(ignored, "max_tokens")
	}
	return ignored
}

func emptyRequestValue(value any) bool {
	if value == nil {
		return true
	}
	switch v := value.(type) {
	case string:
		return v == ""
	case []any:
		return len(v) == 0
	case []string:
		return len(v) == 0
	case map[string]any:
		return len(v) == 0
	case map[string]string:
		return len(v) == 0
	}
	return false
}

func responsesInputContent(content any) any {
	items, ok := content.([]any)
	if !ok {
		return content
	}
	converted := make([]any, 0, len(items))
	for _, item := range items {
		switch value := item.(type) {
		case map[string]any:
			converted = append(converted, responsesInputContentItem(value))
		case openai.TextContent:
			converted = append(converted, map[string]any{"type": "input_text", "text": value.Text})
		case *openai.TextContent:
			converted = append(converted, map[string]any{"type": "input_text", "text": value.Text})
		case openai.ImageContent:
			converted = append(converted, responsesInputImage(value.ImageURL))
		case *openai.ImageContent:
			converted = append(converted, responsesInputImage(value.ImageURL))
		default:
			converted = append(converted, item)
		}
	}
	return converted
}

func responsesInputContentItem(field map[string]any) any {
	switch field["type"] {
	case "text":
		return map[string]any{"type": "input_text", "text": field["text"]}
	case "image_url":
		image, ok := field["image_url"].(map[string]any)
		if !ok {
			return field
		}
		inputImage := map[string]any{"type": "input_image", "image_url": image["url"]}
		if detail, exists := image["detail"]; exists {
			inputImage["detail"] = detail
		}
		return inputImage
	default:
		return field
	}
}

func responsesInputImage(image *model.ImageURL) map[string]any {
	result := map[string]any{"type": "input_image"}
	if image != nil {
		result["image_url"] = image.Url
		if image.Detail != "" {
			result["detail"] = image.Detail
		}
	}
	return result
}

func functionArguments(value any) (string, error) {
	if value == nil {
		return "{}", nil
	}
	if raw, ok := value.(string); ok {
		return raw, nil
	}
	encoded, err := json.Marshal(value)
	return string(encoded), err
}

func responseOutput(value any) (string, error) {
	if text, ok := value.(string); ok {
		return text, nil
	}
	encoded, err := json.Marshal(value)
	return string(encoded), err
}

func responsesFormat(format *model.ResponseFormat) (map[string]any, error) {
	switch format.Type {
	case "text", "json_object":
		return map[string]any{"type": format.Type}, nil
	case "json_schema":
		if format.JsonSchema == nil || format.JsonSchema.Name == "" {
			return nil, errors.New("Responses API json_schema requires a name and schema")
		}
		result := map[string]any{"type": "json_schema", "name": format.JsonSchema.Name}
		if format.JsonSchema.Description != "" {
			result["description"] = format.JsonSchema.Description
		}
		if format.JsonSchema.Schema != nil {
			result["schema"] = format.JsonSchema.Schema
		}
		if format.JsonSchema.Strict != nil {
			result["strict"] = *format.JsonSchema.Strict
		}
		return result, nil
	default:
		return nil, fmt.Errorf("Responses API response_format %q is not supported", format.Type)
	}
}

func responsesFunctionTools(request *model.GeneralOpenAIRequest) ([]any, error) {
	var tools []any
	for _, tool := range request.Tools {
		if tool.Type != "function" {
			return nil, fmt.Errorf("Responses API tool type %q is not supported", tool.Type)
		}
		item := map[string]any{"type": "function", "name": tool.Function.Name}
		if tool.Function.Description != "" {
			item["description"] = tool.Function.Description
		}
		if tool.Function.Parameters != nil {
			item["parameters"] = tool.Function.Parameters
		}
		tools = append(tools, item)
	}
	if request.Functions != nil {
		var legacy []struct {
			Name        string `json:"name"`
			Description string `json:"description"`
			Parameters  any    `json:"parameters"`
		}
		encoded, err := json.Marshal(request.Functions)
		if err != nil {
			return nil, fmt.Errorf("encode legacy functions: %w", err)
		}
		if err := json.Unmarshal(encoded, &legacy); err != nil {
			return nil, fmt.Errorf("decode legacy functions: %w", err)
		}
		for _, function := range legacy {
			item := map[string]any{"type": "function", "name": function.Name}
			if function.Description != "" {
				item["description"] = function.Description
			}
			if function.Parameters != nil {
				item["parameters"] = function.Parameters
			}
			tools = append(tools, item)
		}
	}
	return tools, nil
}

func responsesToolChoice(choice any, legacy any) (any, error) {
	if choice == nil {
		choice = legacy
	}
	if choice == nil {
		return nil, nil
	}
	if value, ok := choice.(string); ok {
		if value == "auto" || value == "none" || value == "required" {
			return value, nil
		}
		return map[string]any{"type": "function", "name": value}, nil
	}
	data, err := json.Marshal(choice)
	if err != nil {
		return nil, err
	}
	var object map[string]any
	if err := json.Unmarshal(data, &object); err != nil {
		return nil, fmt.Errorf("invalid tool_choice: %w", err)
	}
	if object["type"] == "function" {
		function, _ := object["function"].(map[string]any)
		if function != nil {
			name, _ := function["name"].(string)
			return map[string]any{"type": "function", "name": name}, nil
		}
		return object, nil
	}
	if name, ok := object["name"].(string); ok {
		return map[string]any{"type": "function", "name": name}, nil
	}
	return object, nil
}
