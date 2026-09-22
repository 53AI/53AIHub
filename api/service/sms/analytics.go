package sms

import (
	"sort"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common"
)

// AnalyticsItem 单个维度的排行项
type AnalyticsItem struct {
	Key   string `json:"key"`
	Count int64  `json:"count"`
}

// AnalyticsIPItem IP 段排行项
type AnalyticsIPItem struct {
	IPBucket string `json:"ip_bucket"`
	Sends    int64  `json:"sends"`
	Mobiles  int64  `json:"mobiles"` // 窗口内去重手机号数
}

// AnalyticsTotals 短信用量汇总
type AnalyticsTotals struct {
	TodaySends     int64 `json:"today_sends"`      // 今日总发送（各企业日键求和）
	TodayMobiles   int64 `json:"today_mobiles"`    // 今日发送过的手机号数
	TodayEids      int64 `json:"today_eids"`       // 今日发送过的企业数
	Recent10mSends int64 `json:"recent_10m_sends"` // 近窗口总发送（IP Total 键求和）
}

// SmsAnalytics 短信用量实时快照（仅反映当前 TTL 窗口/当天数据，无历史趋势）
type SmsAnalytics struct {
	GeneratedAt int64             `json:"generated_at"`
	Totals      AnalyticsTotals   `json:"totals"`
	TopEids     []AnalyticsItem   `json:"top_eids"`    // 今日各企业发送 topN
	TopIPs      []AnalyticsIPItem `json:"top_ips"`     // 近窗口各 IP 段发送 topN
	TopMobiles  []AnalyticsItem   `json:"top_mobiles"` // 今日各手机号发送 topN
	TopVerify   []AnalyticsItem   `json:"top_verify"`  // 校验失败尝试 topN
}

const defaultAnalyticsTopN = 10

// GetSMSAnalytics 汇总短信发送用量实时快照（只读）
func GetSMSAnalytics() SmsAnalytics {
	resp := SmsAnalytics{
		GeneratedAt: time.Now().Unix(),
		// 初始化为空切片，保证 JSON 序列化为 [] 而非 null
		TopEids:     []AnalyticsItem{},
		TopIPs:      []AnalyticsIPItem{},
		TopMobiles:  []AnalyticsItem{},
		TopVerify:   []AnalyticsItem{},
	}

	// 企业维度：今日发送量排行 + 汇总
	eidKeys, _ := common.RedisScanKeys("Api:SMS:EidDaily:*")
	for _, k := range eidKeys {
		count, _ := common.RedisGetInt64(k)
		resp.Totals.TodaySends += count
		eid := firstKeyPart(k, "Api:SMS:EidDaily:")
		if eid != "" {
			resp.Totals.TodayEids++
			resp.TopEids = append(resp.TopEids, AnalyticsItem{Key: eid, Count: count})
		}
	}

	// 手机号维度：今日发送量排行 + 去重数
	mobileKeys, _ := common.RedisScanKeys("Api:SMS:DailyCount:*")
	for _, k := range mobileKeys {
		count, _ := common.RedisGetInt64(k)
		resp.Totals.TodayMobiles++
		mobile := firstKeyPart(k, "Api:SMS:DailyCount:")
		if mobile != "" {
			resp.TopMobiles = append(resp.TopMobiles, AnalyticsItem{Key: mobile, Count: count})
		}
	}

	// IP 维度：近窗口发送量排行（含去重手机号数）+ 近窗口总发送
	ipKeys, _ := common.RedisScanKeys("Api:SMS:IP:Total:*")
	for _, k := range ipKeys {
		sends, _ := common.RedisGetInt64(k)
		resp.Totals.Recent10mSends += sends
		bucket, window := parseIPWindowKey(k, "Api:SMS:IP:Total:")
		mobiles, _ := common.RedisSCard("Api:SMS:IP:Distinct:" + bucket + ":" + window)
		if bucket != "" {
			resp.TopIPs = append(resp.TopIPs, AnalyticsIPItem{IPBucket: bucket, Sends: sends, Mobiles: mobiles})
		}
	}

	// 校验尝试排行
	attemptKeys, _ := common.RedisScanKeys("Api:SMS:VerifyAttempts:*")
	for _, k := range attemptKeys {
		count, _ := common.RedisGetInt64(k)
		mobile := strings.TrimPrefix(k, "Api:SMS:VerifyAttempts:")
		if mobile != "" {
			resp.TopVerify = append(resp.TopVerify, AnalyticsItem{Key: mobile, Count: count})
		}
	}

	resp.TopEids = topN(resp.TopEids, defaultAnalyticsTopN)
	resp.TopIPs = topIPN(resp.TopIPs, defaultAnalyticsTopN)
	resp.TopMobiles = topN(resp.TopMobiles, defaultAnalyticsTopN)
	resp.TopVerify = topN(resp.TopVerify, defaultAnalyticsTopN)
	return resp
}

// firstKeyPart 取 key 前缀之后的第一个冒号分段（eid 或 mobile）
func firstKeyPart(key, prefix string) string {
	parts := strings.SplitN(strings.TrimPrefix(key, prefix), ":", 2)
	if len(parts) == 0 || parts[0] == "" {
		return ""
	}
	// eid 键第二段是日期，仅保留 eid 数字段
	return parts[0]
}

func topN(items []AnalyticsItem, n int) []AnalyticsItem {
	sort.Slice(items, func(i, j int) bool { return items[i].Count > items[j].Count })
	if len(items) > n {
		items = items[:n]
	}
	return items
}

func topIPN(items []AnalyticsIPItem, n int) []AnalyticsIPItem {
	sort.Slice(items, func(i, j int) bool { return items[i].Sends > items[j].Sends })
	if len(items) > n {
		items = items[:n]
	}
	return items
}
