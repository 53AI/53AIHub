package chatdebug

import "encoding/json"

// CacheUsage represents cache token statistics returned by a model provider.
type CacheUsage struct {
	HitTokens  int64   `json:"hit_tokens"`
	MissTokens int64   `json:"miss_tokens"`
	HitRate    float64 `json:"hit_rate"`
}

// ExtractCacheUsagePayload returns only the provider usage object, never the response content.
func ExtractCacheUsagePayload(response []byte) string {
	var payload struct {
		Usage    json.RawMessage `json:"usage"`
		Response struct {
			Usage json.RawMessage `json:"usage"`
		} `json:"response"`
	}
	if json.Unmarshal(response, &payload) != nil {
		return ""
	}
	usage := payload.Usage
	if len(usage) == 0 || string(usage) == "null" {
		usage = payload.Response.Usage
	}
	if len(usage) == 0 || string(usage) == "null" {
		return ""
	}
	return string(usage)
}

// ParseCacheUsage reads common OpenAI-compatible and DeepSeek usage fields.
func ParseCacheUsage(response []byte) *CacheUsage {
	type usageFields struct {
		PromptTokens          *int64 `json:"prompt_tokens"`
		InputTokens           *int64 `json:"input_tokens"`
		PromptCacheHitTokens  *int64 `json:"prompt_cache_hit_tokens"`
		PromptCacheMissTokens *int64 `json:"prompt_cache_miss_tokens"`
		PromptTokensDetails   struct {
			CachedTokens *int64 `json:"cached_tokens"`
		} `json:"prompt_tokens_details"`
		InputTokensDetails struct {
			CachedTokens *int64 `json:"cached_tokens"`
		} `json:"input_tokens_details"`
	}
	var payload struct {
		Usage    usageFields `json:"usage"`
		Response struct {
			Usage usageFields `json:"usage"`
		} `json:"response"`
	}
	if json.Unmarshal(response, &payload) != nil {
		return nil
	}
	usage := payload.Usage
	if usage.PromptTokens == nil && usage.InputTokens == nil && usage.PromptCacheHitTokens == nil && usage.PromptTokensDetails.CachedTokens == nil && usage.InputTokensDetails.CachedTokens == nil {
		usage = payload.Response.Usage
	}
	hit := usage.PromptCacheHitTokens
	if hit == nil {
		hit = usage.PromptTokensDetails.CachedTokens
	}
	if hit == nil {
		hit = usage.InputTokensDetails.CachedTokens
	}
	if hit == nil || *hit < 0 {
		return nil
	}
	miss := usage.PromptCacheMissTokens
	if miss == nil {
		totalTokens := usage.PromptTokens
		if totalTokens == nil {
			totalTokens = usage.InputTokens
		}
		if totalTokens == nil || *totalTokens < *hit {
			return nil
		}
		derived := *totalTokens - *hit
		miss = &derived
	}
	if *miss < 0 {
		return nil
	}
	total := *hit + *miss
	rate := float64(0)
	if total > 0 {
		rate = float64(*hit) / float64(total)
	}
	return &CacheUsage{HitTokens: *hit, MissTokens: *miss, HitRate: rate}
}
