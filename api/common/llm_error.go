package common

import "strings"

const (
	llmBalanceErrorMessage  = "LLM 渠道余额或额度不足，请检查渠道账户余额和计费配置"
	llmEmptyResponseMessage = "LLM 返回内容为空，请检查模型响应或渠道配置"
)

var llmBalanceErrorKeywords = []string{
	"insufficient_quota",
	"insufficient quota",
	"quota exceeded",
	"exceeded your current quota",
	"余额不足",
	"额度不足",
	"配额不足",
	"billing",
	"payment required",
	"out of credits",
	"credit balance",
}

// ClassifyLLMResponseError converts an empty LLM response into a user-facing
// error message without exposing the provider's raw response.
func ClassifyLLMResponseError(rawResponse, responseContent string) string {
	if strings.TrimSpace(responseContent) != "" {
		return ""
	}

	raw := strings.ToLower(rawResponse)
	for _, keyword := range llmBalanceErrorKeywords {
		if strings.Contains(raw, keyword) {
			return llmBalanceErrorMessage
		}
	}
	return llmEmptyResponseMessage
}
