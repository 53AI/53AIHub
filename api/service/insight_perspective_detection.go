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

const insightPerspectiveDetectionSystemPrompt = `你是录音纪要的会议场景与会议模式分类器，不是内容摘要助手。

请根据本次录音生成的纪要，判断这场会议主要在处理什么经营问题（场景），以及这场会议主要采用什么模式（会议模式）。

【场景，只能选 1 个】
- strategy_operation：战略经营（战略、经营目标、预算、资源配置、重大经营决策）
- customer_growth：客户增长（客户需求、销售、报价、采购、成交、续约、回款）
- product_innovation：产品创新（产品、新业务、新服务、MVP、产品评审、市场验证）
- project_delivery：项目交付（项目启动、推进、协调、实施、交付、验收、项目复盘）
- organization_talent：组织人才（招聘、人员评估、干部、绩效、培养、组织调整）
- partnership_resource：合作资源（渠道、供应商、生态伙伴、战略合作、资源合作）
- learning_insight：学习认知（课程、行业交流、私董会、专家咨询、外部学习）

【会议模式，只能选 1 个】
- decision：决策（做选择、定方向、拍板）
- advancement：推进（推动已经确定的事情落地）
- negotiation：沟通谈判（澄清需求、交换立场、协商条件）
- evaluation：评估（判断人、方案或机会是否合适）
- retrospective：复盘（回顾结果、分析原因、总结改进）
- learning：学习（吸收新知识、新观点、新方法）

判断原则：
1. 按会议主要目的分类，不按地点、人数、标题或交流形式分类。
2. 如果存在多个经营领域，只选择最主要的一个场景。
3. 优先使用纪要中明确的事实；无法判断时置空并 abstained=true，不得根据个人信息、公司行业或泛化常识猜测。
4. <source_title> 只是上游标签，不是独立证据；与纪要冲突时以纪要为准。

只输出 JSON，不要输出 Markdown 或解释。reason_codes 只能使用 scene_signal、mode_signal、ambiguous 之一；evidence 只能填写纪要中明确出现的短事实或短引文，不能补充推测：
{"scene":"","scene_mode":"","confidence":0.0,"reason_codes":["scene_signal"],"evidence":["客户明确提出采购条件"],"abstained":false}
confidence 表示纪要对该判断的支持程度，范围为 0 到 1。`

type insightPerspectiveDetectionResult struct {
	Scene       string   `json:"scene"`
	SceneMode   string   `json:"scene_mode"`
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
	// Perspective 保存识别出的场景码（生效场景）。
	Perspective model.InsightPerspective
	SceneMode   model.SceneMode
	Confidence  float64
	ReasonCodes []string
	Evidence    []string
	Abstained   bool
}

// resolveInsightPerspective 解析未指定视角的录音。自动判断是增强能力，失败时置空场景并标记待确认。
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
		logger.Warnf(ctx, "【洞察】自动场景判断失败，标记待确认: err=%v", err)
		return fallbackInsightPerspectiveResolution("classifier_error")
	}

	resolution, ok := parseInsightPerspectiveDetection(ctx, raw)
	if !ok {
		logger.Warnf(ctx, "【洞察】自动场景判断返回无效值，标记待确认: raw=%q", truncateInsightPerspectiveInput(raw, 256))
		return fallbackInsightPerspectiveResolution("invalid_classifier_response")
	}
	if resolution.Abstained || resolution.Confidence < insightPerspectiveDetectionMinConfidence {
		modelAbstained := resolution.Abstained
		resolution.Perspective = ""
		resolution.Abstained = true
		if modelAbstained {
			resolution.ReasonCodes = appendUniqueInsightPerspectiveValue(resolution.ReasonCodes, "abstained")
		}
		if resolution.Confidence < insightPerspectiveDetectionMinConfidence {
			resolution.ReasonCodes = appendUniqueInsightPerspectiveValue(resolution.ReasonCodes, "low_confidence")
		}
		logger.Warnf(ctx, "【洞察】自动场景判断未通过门槛，标记待确认: confidence=%.2f", resolution.Confidence)
		return resolution
	}
	logger.Infof(ctx, "【洞察】自动场景判断结果: scene=%s mode=%s confidence=%.2f reason_codes=%v", resolution.Perspective, resolution.SceneMode, resolution.Confidence, resolution.ReasonCodes)
	return resolution
}

func parseInsightPerspectiveDetection(ctx context.Context, raw string) (insightPerspectiveResolution, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return fallbackInsightPerspectiveResolution("empty_classifier_response"), false
	}

	var result insightPerspectiveDetectionResult
	if common.ParseLLMJSONInto(ctx, raw, &result) == nil {
		scene := model.RecordingScene(strings.ToLower(strings.TrimSpace(result.Scene)))
		mode := model.SceneMode(strings.ToLower(strings.TrimSpace(result.SceneMode)))
		if model.IsCanonicalScene(scene) && (mode == "" || model.IsValidSceneMode(mode)) && result.Confidence >= 0 && result.Confidence <= 1 {
			return insightPerspectiveResolution{
				Perspective: model.InsightPerspective(scene),
				SceneMode:   mode,
				Confidence:  result.Confidence,
				ReasonCodes: normalizeInsightPerspectiveValues(result.ReasonCodes, insightPerspectiveDetectionMaxReasonCodes, 80),
				Evidence:    normalizeInsightPerspectiveValues(result.Evidence, insightPerspectiveDetectionMaxEvidence, insightPerspectiveDetectionMaxEvidenceRunes),
				Abstained:   result.Abstained,
			}, true
		}
	}

	// 兼容模型只返回一个场景 key 的情况，但不从自然语言解释中做模糊匹配。
	plain := strings.ToLower(strings.Trim(strings.TrimSpace(raw), `+"' \n\t`))
	if scene := model.RecordingScene(plain); model.IsCanonicalScene(scene) {
		return insightPerspectiveResolution{
			Perspective: model.InsightPerspective(scene),
			ReasonCodes: []string{"plain_key_only"},
		}, true
	}
	return fallbackInsightPerspectiveResolution("invalid_classifier_response"), false
}

func fallbackInsightPerspectiveResolution(reason string) insightPerspectiveResolution {
	return insightPerspectiveResolution{
		Perspective: "",
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
