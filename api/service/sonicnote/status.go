package sonicnote

import (
	"context"
	"strings"
)

// 设备不可用原因分类（对外契约，reason 字段取值）：
//   - key_invalid：Key 无效（登录被拒）
//   - network_error：网络/服务不可达或远端异常
const (
	ReasonKeyInvalid   = "key_invalid"
	ReasonNetworkError = "network_error"
)

// DeviceStatus 设备可用性探测结果。
// Available=false 时 UnavailableReason 给出原因分类（ReasonKeyInvalid / ReasonNetworkError）。
type DeviceStatus struct {
	Available         bool   `json:"available"`
	TotalRecordings   int    `json:"total_recordings"`
	UnavailableReason string `json:"unavailable_reason,omitempty"`
}

// classifyAuthError 按错误信息分类：仅鉴权相关响应（HTTP 401/403、业务 code 400/401/403）
// 判定为 Key 无效；其余（网络、超时、限流、5xx 等）一律 network_error，避免误报。
func classifyAuthError(err error) string {
	msg := err.Error()
	for _, bad := range []string{"HTTP 401", "HTTP 403", "code=400", "code=401", "code=403"} {
		if strings.Contains(msg, bad) {
			return ReasonKeyInvalid
		}
	}
	return ReasonNetworkError
}

// FriendlySyncError 将同步失败错误翻译为用户可行动的提示文案（对外展示用）。
// 判定规则：鉴权类状态码（HTTP 401/403、业务 code 400/401/403），或远端 msg 含
// key/无效/invalid/unauthorized 等关键词（覆盖远端以 5xx + 明确 key 原因返回的场景）→ Key 不可用；
// 其余（网络、超时、5xx 无明确原因）→ 服务异常，避免误报。
// 原始错误保留在 DB（job.error）与日志中，此处仅翻译展示层。
func FriendlySyncError(err error) string {
	if err == nil {
		return ""
	}
	msg := err.Error()
	lower := strings.ToLower(msg)
	for _, bad := range []string{"HTTP 401", "HTTP 403", "code=400", "code=401", "code=403"} {
		if strings.Contains(msg, bad) {
			return "SonicNote Key 不可用，请检查设备 Key 是否正确"
		}
	}
	for _, kw := range []string{"apikey", "api key", "invalid api key", "invalid key", "unauthorized", "无效"} {
		if strings.Contains(lower, kw) {
			return "SonicNote Key 不可用，请检查设备 Key 是否正确"
		}
	}
	return "SonicNote 服务暂不可用，请稍后重试"
}

// CheckStatus 探测 SonicNote 可用性：用 apiKey 登录验证 Key 有效性，
// 并拉取首页确认账号有录音数据。探测失败不返回 error，以 status.Available=false + reason 表达。
func (s *SyncService) CheckStatus(ctx context.Context, apiKey string) (*DeviceStatus, error) {
	token, err := s.client.Login(ctx, apiKey)
	if err != nil {
		return &DeviceStatus{Available: false, UnavailableReason: classifyAuthError(err)}, nil
	}
	_, total, err := s.client.ListRecordings(ctx, token, 1, 1)
	if err != nil {
		return &DeviceStatus{Available: false, UnavailableReason: classifyAuthError(err)}, nil
	}
	return &DeviceStatus{Available: true, TotalRecordings: total}, nil
}
