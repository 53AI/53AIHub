package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	relaymodel "github.com/songquanpeng/one-api/relay/model"
)

const insightPerspectiveDetectionSystemPrompt = `你是录音纪要的活动视角分类器，不是内容摘要助手。

请根据标题和本次录音生成的纪要，判断这次活动最适合采用哪一种决策洞察视角。判断的是“这次录音是什么活动”，不是纪要讨论的行业或主题。

候选值只能是：
- external_training：参与外部培训会议
- external_speech：去别人公司演讲
- roadshow：路演会议
- sales_visit：销售拜访
- internal_meeting：公司内部会议
- lecture：听一堂课
- book：读一本书

判断规则：
1. 只有纪要明确显示活动类型时才选择培训、演讲、路演、销售拜访、听课或读书。
2. “外部培训”强调参加组织化培训并准备将方法带回组织；“听课”强调一堂课或课程学习本身。无法区分时选择 internal_meeting。
3. 读书必须有书名、章节、读书分享或围绕书籍内容的明确证据；不要因为出现“学习”就选择 book 或 lecture。
4. 客户拜访、推介或融资材料介绍，要依据活动实际过程分别选择 sales_visit 或 roadshow；没有明确证据时选择 internal_meeting。
5. 不要根据个人信息、公司行业或泛化常识猜测。

只输出 JSON，不要输出 Markdown 或解释：
{"perspective":"候选值","confidence":0.0}
confidence 表示纪要对该判断的支持程度，范围为 0 到 1。`

type insightPerspectiveDetectionResult struct {
	Perspective string  `json:"perspective"`
	Confidence  float64 `json:"confidence"`
}

const insightPerspectiveDetectionMaxRunes = 12000

// resolveInsightPerspective 解析未指定视角的录音。自动判断是增强能力，失败不能阻断主洞察生成。
func resolveInsightPerspective(ctx context.Context, config *model.RecordingConfig, sourceTitle, minutes string) model.InsightPerspective {
	if config == nil || !config.MultiPerspectiveEnabled {
		return model.DefaultInsightPerspective
	}
	minutes = strings.TrimSpace(minutes)
	if minutes == "" {
		return model.DefaultInsightPerspective
	}

	minutes = truncateInsightPerspectiveInput(minutes, insightPerspectiveDetectionMaxRunes)
	buildRequest := func() *relaymodel.GeneralOpenAIRequest {
		return &relaymodel.GeneralOpenAIRequest{
			Model: config.InferenceModelName,
			Messages: []relaymodel.Message{
				{Role: "system", Content: insightPerspectiveDetectionSystemPrompt},
				{Role: "user", Content: fmt.Sprintf("<source_title>\n%s\n</source_title>\n\n<meeting_minutes>\n%s\n</meeting_minutes>", sourceTitle, minutes)},
			},
		}
	}

	raw, err := callLLMWithRetry(ctx, config, buildRequest)
	if err != nil {
		logger.Warnf(ctx, "【洞察】自动视角判断失败，回退内部会议: err=%v", err)
		return model.DefaultInsightPerspective
	}

	perspective, confidence, ok := parseInsightPerspectiveDetection(raw)
	if !ok {
		logger.Warnf(ctx, "【洞察】自动视角判断返回无效值，回退内部会议: raw=%q", truncateInsightPerspectiveInput(raw, 256))
		return model.DefaultInsightPerspective
	}
	logger.Infof(ctx, "【洞察】自动视角判断结果: perspective=%s confidence=%.2f", perspective, confidence)
	return perspective
}

func parseInsightPerspectiveDetection(raw string) (model.InsightPerspective, float64, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return model.DefaultInsightPerspective, 0, false
	}

	var result insightPerspectiveDetectionResult
	if json.Unmarshal([]byte(extractJSON(raw)), &result) == nil {
		perspective := model.InsightPerspective(strings.ToLower(strings.TrimSpace(result.Perspective)))
		if perspective != "" && perspective != model.InsightPerspectiveAuto && model.IsValidInsightPerspective(string(perspective)) {
			return perspective, result.Confidence, true
		}
	}

	// 兼容模型只返回一个候选 key 的情况，但不从自然语言解释中做模糊匹配。
	plain := strings.ToLower(strings.Trim(strings.TrimSpace(raw), "`\"' \n\t"))
	if model.IsValidInsightPerspective(plain) && plain != string(model.InsightPerspectiveAuto) {
		return model.InsightPerspective(plain), 0, true
	}
	return model.DefaultInsightPerspective, 0, false
}

func truncateInsightPerspectiveInput(value string, maxRunes int) string {
	runes := []rune(value)
	if len(runes) <= maxRunes {
		return value
	}
	return string(runes[:maxRunes]) + "\n...(内容已截断，仅用于视角判断)"
}
