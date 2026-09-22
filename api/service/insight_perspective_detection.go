package service

import (
	"context"
	"fmt"
	"strings"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	recordingdebug "github.com/53AI/53AIHub/service/recording_debug"
	relaymodel "github.com/songquanpeng/one-api/relay/model"
)

const insightPerspectiveDetectionSystemPrompt = `你是录音纪要的活动视角分类器，不是内容摘要助手。

请根据本次录音生成的纪要，判断这次活动最适合采用哪一种决策洞察视角。判断的是“这次录音是什么活动”，不是纪要讨论的行业或主题。

候选值只能是：
- management_meeting：管理例会
- customer_communication：客户交流
- project_review：项目复盘
- business_cooperation：商业合作
- business_innovation：业务创新
- employee_conversation：员工谈话
- industry_exchange：行业交流
- management_course：管理课程

判断规则：
1. 按会议主要目的分类，不按地点、人数、标题或交流形式分类。
2. 具体项目或事件的结果分析选择 project_review；团队、流程、产品或业务改进但不针对具体项目选择 business_innovation。
3. 客户问题、客户关系或客户推进选择 customer_communication；上下游、渠道或商业机会探讨选择 business_cooperation。
4. 同行和行业经营观点选择 industry_exchange；体系化销售、产品、品牌或管理课程选择 management_course。
5. 员工绩效、状态、成长或谈心选择 employee_conversation；其他公司内部管理事项选择 management_meeting。
6. 优先使用纪要中明确的事实；无法区分时选择 management_meeting，但不得根据个人信息、公司行业或泛化常识猜测。
7. <source_title> 只是上游根据内容生成的候选标签，不是独立证据；与纪要冲突时以纪要为准。

只输出 JSON，不要输出 Markdown 或解释。reason_codes 只能使用 management_signal、customer_signal、project_signal、cooperation_signal、innovation_signal、employee_signal、industry_signal、course_signal、ambiguous 之一；evidence 只能填写纪要中明确出现的短事实或短引文，不能补充推测：
{"perspective":"候选值","confidence":0.0,"reason_codes":["customer_signal"],"evidence":["客户明确提出采购条件"],"abstained":false}
confidence 表示纪要对该判断的支持程度，范围为 0 到 1。`

type insightPerspectiveDetectionResult struct {
	Perspective string   `json:"perspective"`
	Confidence  float64  `json:"confidence"`
	ReasonCodes []string `json:"reason_codes"`
	Evidence    []string `json:"evidence"`
	Abstained   bool     `json:"abstained"`
}

const insightPerspectiveDetectionMaxRunes = 12000
const insightPerspectiveDetectionMinConfidence = 0.6
const insightPerspectiveDetectionMaxReasonCodes = 6
const insightPerspectiveDetectionMaxEvidence = 3
const insightPerspectiveDetectionMaxEvidenceRunes = 240

type insightPerspectiveResolution struct {
	Perspective model.InsightPerspective
	Confidence  float64
	ReasonCodes []string
	Evidence    []string
	Abstained   bool
}

// resolveInsightPerspective 解析未指定视角的录音。自动判断是增强能力，失败安全回退到管理例会。
func resolveInsightPerspective(ctx context.Context, config *model.RecordingConfig, sourceTitle, minutes string) insightPerspectiveResolution {
	if config == nil || !config.MultiPerspectiveEnabled {
		return fallbackInsightPerspectiveResolution("auto_disabled")
	}
	minutes = strings.TrimSpace(minutes)
	if minutes == "" {
		return fallbackInsightPerspectiveResolution("missing_minutes")
	}

	minutes = truncateInsightPerspectiveInput(minutes, insightPerspectiveDetectionMaxRunes)
	buildRequest := func() *relaymodel.GeneralOpenAIRequest {
		return &relaymodel.GeneralOpenAIRequest{
			Model:     config.InferenceModelName,
			MaxTokens: 0,
			Messages: []relaymodel.Message{
				{Role: "system", Content: insightPerspectiveDetectionSystemPrompt},
				{Role: "user", Content: fmt.Sprintf("<source_title>\n%s\n</source_title>\n\n<meeting_minutes>\n%s\n</meeting_minutes>", sourceTitle, minutes)},
			},
		}
	}

	raw, err := callLLMWithRetry(recordingdebug.WithLLMStage(ctx, recordingdebug.LLMStage(ctx, "insight_perspective_llm")), config, buildRequest)
	if err != nil {
		logger.Warnf(ctx, "【洞察】自动场景判断失败，回退管理例会: err=%v", err)
		return fallbackInsightPerspectiveResolution("classifier_error")
	}

	resolution, ok := parseInsightPerspectiveDetection(ctx, raw)
	if !ok {
		logger.Warnf(ctx, "【洞察】自动场景判断返回无效值，回退管理例会: raw=%q", truncateInsightPerspectiveInput(raw, 256))
		return fallbackInsightPerspectiveResolution("invalid_classifier_response")
	}
	if resolution.Abstained || resolution.Confidence < insightPerspectiveDetectionMinConfidence {
		modelAbstained := resolution.Abstained
		resolution.Perspective = model.DefaultInsightPerspective
		resolution.Abstained = true
		if modelAbstained {
			resolution.ReasonCodes = appendUniqueInsightPerspectiveValue(resolution.ReasonCodes, "abstained")
		}
		if resolution.Confidence < insightPerspectiveDetectionMinConfidence {
			resolution.ReasonCodes = appendUniqueInsightPerspectiveValue(resolution.ReasonCodes, "low_confidence")
		}
		logger.Warnf(ctx, "【洞察】自动场景判断未通过门槛，回退管理例会: perspective=%s confidence=%.2f", resolution.Perspective, resolution.Confidence)
		return resolution
	}
	logger.Infof(ctx, "【洞察】自动场景判断结果: perspective=%s confidence=%.2f reason_codes=%v", resolution.Perspective, resolution.Confidence, resolution.ReasonCodes)
	return resolution
}

func parseInsightPerspectiveDetection(ctx context.Context, raw string) (insightPerspectiveResolution, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return fallbackInsightPerspectiveResolution("empty_classifier_response"), false
	}

	var result insightPerspectiveDetectionResult
	if common.ParseLLMJSONInto(ctx, raw, &result) == nil {
		perspective := model.InsightPerspective(strings.ToLower(strings.TrimSpace(result.Perspective)))
		if perspective != "" && perspective != model.InsightPerspectiveAuto && model.IsCanonicalInsightPerspective(perspective) && result.Confidence >= 0 && result.Confidence <= 1 {
			return insightPerspectiveResolution{
				Perspective: perspective,
				Confidence:  result.Confidence,
				ReasonCodes: normalizeInsightPerspectiveValues(result.ReasonCodes, insightPerspectiveDetectionMaxReasonCodes, 80),
				Evidence:    normalizeInsightPerspectiveValues(result.Evidence, insightPerspectiveDetectionMaxEvidence, insightPerspectiveDetectionMaxEvidenceRunes),
				Abstained:   result.Abstained,
			}, true
		}
	}

	// 兼容模型只返回一个正式场景 key 的情况，但不从自然语言解释中做模糊匹配。
	plain := strings.ToLower(strings.Trim(strings.TrimSpace(raw), "`\"' \n\t"))
	if model.IsCanonicalInsightPerspective(model.InsightPerspective(plain)) {
		return insightPerspectiveResolution{
			Perspective: model.InsightPerspective(plain),
			ReasonCodes: []string{"plain_key_only"},
		}, true
	}
	return fallbackInsightPerspectiveResolution("invalid_classifier_response"), false
}

func fallbackInsightPerspectiveResolution(reason string) insightPerspectiveResolution {
	return insightPerspectiveResolution{
		Perspective: model.DefaultInsightPerspective,
		ReasonCodes: []string{reason},
		Abstained:   true,
	}
}

func normalizeInsightPerspectiveValues(values []string, limit, maxRunes int) []string {
	result := make([]string, 0, minInsightPerspectiveInt(len(values), limit))
	for _, value := range values {
		value = truncateInsightPerspectiveInput(strings.TrimSpace(value), maxRunes)
		if value == "" || containsInsightPerspectiveValue(result, value) {
			continue
		}
		result = append(result, value)
		if len(result) == limit {
			break
		}
	}
	return result
}

func appendUniqueInsightPerspectiveValue(values []string, value string) []string {
	if containsInsightPerspectiveValue(values, value) {
		return values
	}
	return append(values, value)
}

func containsInsightPerspectiveValue(values []string, value string) bool {
	for _, item := range values {
		if item == value {
			return true
		}
	}
	return false
}

func minInsightPerspectiveInt(left, right int) int {
	if left < right {
		return left
	}
	return right
}

func truncateInsightPerspectiveInput(value string, maxRunes int) string {
	runes := []rune(value)
	if len(runes) <= maxRunes {
		return value
	}
	return string(runes[:maxRunes]) + "\n...(内容已截断，仅用于视角判断)"
}
