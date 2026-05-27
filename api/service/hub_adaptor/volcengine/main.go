package volcengine

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/53AI/53AIHub/model"
	"github.com/songquanpeng/one-api/relay/meta"
	"github.com/songquanpeng/one-api/relay/relaymode"
)

func GetRequestURL(meta *meta.Meta) (string, error) {
	if meta.Mode == relaymode.ChatCompletions {
		if meta.ChannelType == model.ChannelApiVolcengineModel {
			baseUrl := strings.TrimSuffix(meta.BaseURL, "/")
			// 检查URL末尾是否包含类似v1, v2, v999这样的版本号模式
			versionPattern := regexp.MustCompile(`/v\d+$`)
			if versionPattern.MatchString(baseUrl) {
				return fmt.Sprintf("%s/chat/completions", baseUrl), nil
			}
			// 默认情况下使用 /api/v3/chat/completions
			return fmt.Sprintf("%s/api/v3/chat/completions", baseUrl), nil
		} else {
			baseUrl := strings.TrimSuffix(meta.BaseURL, "/")
			// 避免 baseUrl 已包含 /v3/bots 或 /api/v3/bots 导致路径重复
			if strings.HasSuffix(baseUrl, "/api/v3/bots") {
				baseUrl = strings.TrimSuffix(baseUrl, "/api/v3/bots")
			} else if strings.HasSuffix(baseUrl, "/v3/bots") {
				baseUrl = strings.TrimSuffix(baseUrl, "/v3/bots")
			}
			return fmt.Sprintf("%s/api/v3/bots/chat/completions", baseUrl), nil
		}
	}
	return "", fmt.Errorf("unsupported relay mode %d for volcengine", meta.Mode)
}
