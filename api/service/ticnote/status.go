package ticnote

import (
	"context"
	"strings"
)

// 设备不可用原因分类（对外契约，reason 字段取值）：
//   - key_invalid：AppKey 无效（登录被拒）
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

// classifyAuthError 按错误信息分类：鉴权类响应（HTTP 401/403、登录业务 code 11864/11865/11866）
// 判定为 AppKey 无效；其余（网络、超时、限流、5xx 等）一律 network_error，避免误报。
func classifyAuthError(err error) string {
	msg := err.Error()
	for _, bad := range []string{"HTTP 401", "HTTP 403", "登录失败 code=11864", "登录失败 code=11865", "登录失败 code=11866"} {
		if strings.Contains(msg, bad) {
			return ReasonKeyInvalid
		}
	}
	return ReasonNetworkError
}

// FriendlySyncError 将同步失败错误翻译为用户可行动的提示文案（对外展示用）。
// 判定规则：鉴权类状态码（HTTP 401/403）或登录业务 code 11864/11865/11866，或错误信息含
// appkey/invalid/unauthorized/无效 等关键词 → AppKey 不可用；其余（网络、超时、5xx 无明确原因）→ 服务异常。
// 原始错误保留在 DB（job.error）与日志中，此处仅翻译展示层。
func FriendlySyncError(err error) string {
	if err == nil {
		return ""
	}
	msg := err.Error()
	lower := strings.ToLower(msg)
	for _, bad := range []string{"HTTP 401", "HTTP 403", "登录失败 code=11864", "登录失败 code=11865", "登录失败 code=11866"} {
		if strings.Contains(msg, bad) {
			return "TicNote Key 不可用，请检查设备 Key 是否正确"
		}
	}
	for _, kw := range []string{"appkey", "invalid", "unauthorized", "无效"} {
		if strings.Contains(lower, kw) {
			return "TicNote Key 不可用，请检查设备 Key 是否正确"
		}
	}
	return "TicNote 服务暂不可用，请稍后重试"
}

// CheckStatus 探测 TicNote 可用性：用 AppKey 登录验证有效性，
// 并拉取前 maxProbeProjects 个项目统计录音数（轻量探测，避免大账号全量遍历拖慢）。
// 探测失败不返回 error，以 status.Available=false + reason 表达。
func (s *SyncService) CheckStatus(ctx context.Context, appkey string) (*DeviceStatus, error) {
	token, err := s.client.Login(ctx, appkey)
	if err != nil {
		return &DeviceStatus{Available: false, UnavailableReason: classifyAuthError(err)}, nil
	}
	recordings, err := s.client.ListRecordingsLimited(ctx, token, maxProbeProjects)
	if err != nil {
		return &DeviceStatus{Available: false, UnavailableReason: classifyAuthError(err)}, nil
	}
	return &DeviceStatus{Available: true, TotalRecordings: len(recordings)}, nil
}
