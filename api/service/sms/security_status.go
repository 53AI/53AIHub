package sms

import (
	"strings"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/config"
)

// SecurityLimitItem 单个限流项的当前生效值
type SecurityLimitItem struct {
	Key   string `json:"key"`
	Value int64  `json:"value"` // 当前生效值
}

// SecurityIPWindow IP 维度窗口计数
type SecurityIPWindow struct {
	IPBucket string `json:"ip_bucket"`
	Window   string `json:"window"`
	Kind     string `json:"kind"` // distinct=去重手机号数 | total=总发送次数
	Count    int64  `json:"count"`
	Limit    int64  `json:"limit"`
}

// SecurityKeyState 某 key 的运行时状态（计数 / 剩余 TTL 秒）
type SecurityKeyState struct {
	Key   string `json:"key"`
	Value int64  `json:"value,omitempty"`
	TTL   int64  `json:"ttl_seconds,omitempty"`
}

// SecurityStatus 短信防刷运行时状态（供管理端查看）
type SecurityStatus struct {
	Enabled            bool                `json:"enabled"`
	SMSCaptchaRequired bool                `json:"sms_captcha_required"` // 发送短信前置字符验证码是否强制
	Limits             []SecurityLimitItem `json:"limits"`
	BannedIPs          []SecurityKeyState  `json:"banned_ips"`       // 被封禁 IP 段
	IPWindows          []SecurityIPWindow  `json:"ip_windows"`       // IP 维度各窗口计数
	CooldownMobiles    []SecurityKeyState  `json:"cooldown_mobiles"` // 冷却中的手机号
	DailyMobiles       []SecurityKeyState  `json:"daily_mobiles"`    // 手机号当日发送次数
	VerifyAttempts     []SecurityKeyState  `json:"verify_attempts"`  // 校验失败尝试次数
	EidDaily           []SecurityKeyState  `json:"eid_daily"`        // 企业当日短信总量
}

// GetSecurityStatus 汇总当前短信防刷运行时状态（只读，不修改任何状态）
func GetSecurityStatus() SecurityStatus {
	resp := SecurityStatus{
		Enabled:            false,
		SMSCaptchaRequired: config.SMS_CAPTCHA_REQUIRED,
	}
	if m := GetManager(); m != nil && m.IsEnabled() {
		resp.Enabled = true
	}

	var captchaReqVal int64
	if config.SMS_CAPTCHA_REQUIRED {
		captchaReqVal = 1
	}

	resp.Limits = []SecurityLimitItem{
		{"sms_captcha_required", captchaReqVal},
		{"sms_send_cooldown_seconds", int64(SMS_CODE_SEND_EXPIRE.Seconds())},
		{"sms_send_mobile_daily_limit", int64(SMS_CODE_SEND_TIMES)},
		{"sms_send_ip_burst_limit", int64(config.SMS_IP_BURST_LIMIT)},
		{"sms_send_ip_hourly_limit", int64(config.SMS_IP_HOURLY_LIMIT)},
		{"sms_send_ip_daily_limit", int64(config.SMS_IP_DAILY_LIMIT)},
		{"sms_ip_total_limit", int64(config.SMS_IP_TOTAL_LIMIT)},
		{"sms_ip_ban_minutes", int64(config.SMS_IP_BAN_MINUTES)},
		{"sms_eid_daily_limit", int64(config.SMS_EID_DAILY_LIMIT)},
		{"sms_verify_ip_burst_limit", int64(config.SMS_VERIFY_IP_BURST_LIMIT)},
		{"sms_verify_fail_cooldown_seconds", int64(config.SMS_VERIFY_FAIL_COOLDOWN_SECONDS)},
	}

	banKeys, _ := common.RedisScanKeys("Api:SMS:IP:Ban:*")
	for _, k := range banKeys {
		ttl, _ := common.RedisTTL(k)
		resp.BannedIPs = append(resp.BannedIPs, SecurityKeyState{Key: strings.TrimPrefix(k, "Api:SMS:IP:Ban:"), TTL: int64(ttl.Seconds())})
	}

	distinctKeys, _ := common.RedisScanKeys("Api:SMS:IP:Distinct:*")
	for _, k := range distinctKeys {
		bucket, window := parseIPWindowKey(k, "Api:SMS:IP:Distinct:")
		count, _ := common.RedisSCard(k)
		resp.IPWindows = append(resp.IPWindows, SecurityIPWindow{bucket, window, "distinct", count, ipWindowDistinctLimit(window)})
	}
	totalKeys, _ := common.RedisScanKeys("Api:SMS:IP:Total:*")
	for _, k := range totalKeys {
		bucket, window := parseIPWindowKey(k, "Api:SMS:IP:Total:")
		count, _ := common.RedisGetInt64(k)
		resp.IPWindows = append(resp.IPWindows, SecurityIPWindow{bucket, window, "total", count, int64(config.SMS_IP_TOTAL_LIMIT)})
	}

	cooldownKeys, _ := common.RedisScanKeys("Api:SMS:RateLimit:*")
	for _, k := range cooldownKeys {
		ttl, _ := common.RedisTTL(k)
		resp.CooldownMobiles = append(resp.CooldownMobiles, SecurityKeyState{Key: strings.TrimPrefix(k, "Api:SMS:RateLimit:"), TTL: int64(ttl.Seconds())})
	}

	dailyKeys, _ := common.RedisScanKeys("Api:SMS:DailyCount:*")
	for _, k := range dailyKeys {
		count, _ := common.RedisGetInt64(k)
		resp.DailyMobiles = append(resp.DailyMobiles, SecurityKeyState{Key: strings.TrimPrefix(k, "Api:SMS:DailyCount:"), Value: count})
	}

	attemptKeys, _ := common.RedisScanKeys("Api:SMS:VerifyAttempts:*")
	for _, k := range attemptKeys {
		count, _ := common.RedisGetInt64(k)
		resp.VerifyAttempts = append(resp.VerifyAttempts, SecurityKeyState{Key: strings.TrimPrefix(k, "Api:SMS:VerifyAttempts:"), Value: count})
	}

	eidKeys, _ := common.RedisScanKeys("Api:SMS:EidDaily:*")
	for _, k := range eidKeys {
		count, _ := common.RedisGetInt64(k)
		resp.EidDaily = append(resp.EidDaily, SecurityKeyState{Key: strings.TrimPrefix(k, "Api:SMS:EidDaily:"), Value: count})
	}

	return resp
}

func parseIPWindowKey(key, prefix string) (bucket, window string) {
	suffix := strings.TrimPrefix(key, prefix)
	parts := strings.SplitN(suffix, ":", 2)
	if len(parts) == 2 {
		return parts[0], parts[1]
	}
	return suffix, ""
}

func ipWindowDistinctLimit(window string) int64 {
	switch len(window) {
	case 11: // 10分钟窗口
		return int64(config.SMS_IP_BURST_LIMIT)
	case 10: // 1小时窗口
		return int64(config.SMS_IP_HOURLY_LIMIT)
	case 8: // 1天窗口
		return int64(config.SMS_IP_DAILY_LIMIT)
	}
	return 0
}
