package openai

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/songquanpeng/one-api/relay/channeltype"
	"github.com/songquanpeng/one-api/relay/model"
)

func ResponseText2Usage(responseText string, modelName string, promptTokens int) *model.Usage {
	usage := &model.Usage{}
	usage.PromptTokens = promptTokens
	usage.CompletionTokens = CountTokenText(responseText, modelName)
	usage.TotalTokens = usage.PromptTokens + usage.CompletionTokens
	return usage
}

func GetFullRequestURL(baseURL string, requestURL string, channelType int) string {
	baseURL = strings.TrimSuffix(baseURL, "/")
	fullRequestURL := fmt.Sprintf("%s%s", baseURL, requestURL)

	if strings.HasPrefix(baseURL, "https://gateway.ai.cloudflare.com") {
		switch channelType {
		case channeltype.OpenAI:
			fullRequestURL = fmt.Sprintf("%s%s", baseURL, strings.TrimPrefix(requestURL, "/v1"))
		case channeltype.Azure:
			fullRequestURL = fmt.Sprintf("%s%s", baseURL, strings.TrimPrefix(requestURL, "/openai/deployments"))
		}
	}
	return fullRequestURL
}

// ShouldUseMaxCompletionTokens 判断当前模型是否需要使用 max_completion_tokens
// GPT-5.1 及后续版本不再走旧的 max_tokens 字段。
func ShouldUseMaxCompletionTokens(modelName string) bool {
	name := strings.ToLower(strings.TrimSpace(modelName))
	if !strings.HasPrefix(name, "gpt-5.") {
		return false
	}

	minorPart := strings.TrimPrefix(name, "gpt-5.")
	end := len(minorPart)
	for i, r := range minorPart {
		if r < '0' || r > '9' {
			end = i
			break
		}
	}
	if end == 0 {
		return false
	}

	minorVersion, err := strconv.Atoi(minorPart[:end])
	if err != nil {
		return false
	}
	return minorVersion >= 1
}

// ApplyTokenLimitForModel 将 max_tokens 迁移到 max_completion_tokens（仅适用于 GPT-5.1 及以后）
func ApplyTokenLimitForModel(request *model.GeneralOpenAIRequest) {
	if request == nil {
		return
	}
	if !ShouldUseMaxCompletionTokens(request.Model) {
		return
	}
	if request.MaxCompletionTokens != nil {
		request.MaxTokens = 0
		return
	}
	if request.MaxTokens <= 0 {
		return
	}

	maxCompletionTokens := request.MaxTokens
	request.MaxCompletionTokens = &maxCompletionTokens
	request.MaxTokens = 0
}
