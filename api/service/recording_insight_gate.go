package service

import (
	"strings"
	"unicode"
)

const (
	insightModeNoInsight = "no_insight"
	insightModeCompact   = "compact"
	insightModeFull      = "full"

	insightReasonNoMeaningfulContent = "no_meaningful_content"
	insightReasonInsufficientContext = "insufficient_context"
	insightReasonStrongSingleSignal  = "strong_single_signal"
	insightReasonMultiSignalTradeoff = "multi_signal_tradeoff"
)

// insightGateResult is deliberately deterministic. It is a first-line safety
// gate and must not use Profile, historical memory, or an LLM to invent value
// for a meeting that has no usable material.
type insightGateResult struct {
	Mode       string
	ReasonCode string
	Message    string
	Confidence float64
	Allowed    bool
}

// evaluateInsightGate classifies only the current meeting material. The
// heuristic is intentionally conservative: strong decision signals can pass
// even when short, while filler/opening text is stopped before context loading.
func evaluateInsightGate(material string) insightGateResult {
	compact := compactInsightGateText(material)
	if compact == "" || onlyInsightGateFiller(compact) || isInsightGateOpening(compact) {
		return insightGateResult{
			Mode:       insightModeNoInsight,
			ReasonCode: insightReasonNoMeaningfulContent,
			Message:    "本会议无实际内容，不生成洞察。",
			Confidence: 0.99,
		}
	}

	semantic := stripInsightGateFiller(compact)
	strongSignals := countInsightGateSignals(semantic)
	length := len([]rune(semantic))
	if length < 10 && strongSignals == 0 {
		return insightGateResult{
			Mode:       insightModeNoInsight,
			ReasonCode: insightReasonNoMeaningfulContent,
			Message:    "本会议无实际内容，不生成洞察。",
			Confidence: 0.94,
		}
	}
	if strongSignals == 0 && length < 24 {
		return insightGateResult{
			Mode:       insightModeNoInsight,
			ReasonCode: insightReasonInsufficientContext,
			Message:    "本次录音内容不完整，无法形成可靠洞察。",
			Confidence: 0.86,
		}
	}

	if strongSignals >= 2 && length >= 40 {
		return insightGateResult{
			Mode:       insightModeFull,
			ReasonCode: insightReasonMultiSignalTradeoff,
			Confidence: 0.78,
			Allowed:    true,
		}
	}
	return insightGateResult{
		Mode:       insightModeCompact,
		ReasonCode: insightReasonStrongSingleSignal,
		Confidence: 0.74,
		Allowed:    true,
	}
}

func compactInsightGateText(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	value = strings.Map(func(r rune) rune {
		if unicode.IsSpace(r) || unicode.IsPunct(r) || unicode.IsSymbol(r) {
			return ' '
		}
		return r
	}, value)
	return strings.Join(strings.Fields(value), "")
}

func stripInsightGateFiller(value string) string {
	for _, token := range []string{"嗯嗯", "嗯", "啊啊", "啊", "哦", "噢", "呃", "额", "欸", "喂", "哈哈", "好的好的"} {
		value = strings.ReplaceAll(value, token, "")
	}
	return strings.TrimSpace(value)
}

func onlyInsightGateFiller(value string) bool {
	return stripInsightGateFiller(value) == ""
}

func isInsightGateOpening(value string) bool {
	for _, phrase := range []string{
		"会议开始", "现在开始", "大家好", "先这样", "今天先到这里", "散会", "测试一下", "听得到吗", "能听到吗",
	} {
		if value == phrase || strings.HasPrefix(value, phrase) && len([]rune(value)) <= len([]rune(phrase))+4 {
			return true
		}
	}
	return false
}

func countInsightGateSignals(value string) int {
	signalGroups := [][]string{
		{"决定", "确定", "同意", "通过", "拍板", "采用", "停止", "放弃"},
		{"承诺", "负责", "负责人", "截止", "期限", "明天", "下周", "交付", "上线"},
		{"风险", "问题", "阻塞", "冲突", "不同意", "拒绝", "亏损", "事故"},
		{"预算", "成本", "资源", "必须", "需要", "验收", "方案"},
	}
	count := 0
	for _, group := range signalGroups {
		for _, signal := range group {
			if strings.Contains(value, signal) {
				count++
				break
			}
		}
	}
	return count
}

func insightGateOutputInstruction(mode string) string {
	switch mode {
	case insightModeCompact:
		return `
<insight_output_budget mode="compact">
本次材料只有一个足够强的决策信号。只输出一个核心洞察：主体最多一个分析块，行动建议最多一条；不要复述会议过程、补齐不存在的字段或为了完整结构添加金句。若证据不足，明确写“待验证”。
</insight_output_budget>`
	case insightModeFull:
		return `
<insight_output_budget mode="full">
本次最多保留三条相互冲突、存在取舍或有明确依赖的高价值洞察。按决策影响排序；没有改变判断的背景、重复纪要和泛化建议不要输出。每条核心判断都要有可核验依据。
</insight_output_budget>`
	default:
		return ""
	}
}
