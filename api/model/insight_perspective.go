package model

import "strings"

// InsightPerspective 表示生成决策洞察时采用的材料/活动视角。
type InsightPerspective string

const (
	// InsightPerspectiveAuto 表示由企业开关控制，依据本次录音纪要自动判断视角。
	InsightPerspectiveAuto             InsightPerspective = "auto"
	InsightPerspectiveExternalTraining InsightPerspective = "external_training"
	InsightPerspectiveExternalSpeech   InsightPerspective = "external_speech"
	InsightPerspectiveRoadshow         InsightPerspective = "roadshow"
	InsightPerspectiveSalesVisit       InsightPerspective = "sales_visit"
	InsightPerspectiveInternalMeeting  InsightPerspective = "internal_meeting"
	InsightPerspectiveLecture          InsightPerspective = "lecture"
	InsightPerspectiveBook             InsightPerspective = "book"
)

// DefaultInsightPerspective 是自动判断关闭、判断失败或历史数据需要兼容时的安全回退值。
const DefaultInsightPerspective = InsightPerspectiveInternalMeeting

type InsightPerspectiveOption struct {
	Key         InsightPerspective `json:"key"`
	Name        string             `json:"name"`
	Description string             `json:"description"`
}

var insightPerspectiveOptions = []InsightPerspectiveOption{
	{Key: InsightPerspectiveAuto, Name: "自动判断", Description: "根据本次录音生成的纪要判断最合适的洞察视角；需要企业开启多视角功能。"},
	{Key: InsightPerspectiveExternalTraining, Name: "参与外部培训会议", Description: "把外部培训内容转化为适合公司落地的认知、方法和验证行动。"},
	{Key: InsightPerspectiveExternalSpeech, Name: "去别人公司演讲", Description: "评估分享效果、客户信号、品牌定位和后续关系推进。"},
	{Key: InsightPerspectiveRoadshow, Name: "路演会议", Description: "评估目标听众、价值主张、证据强度、异议和转化机会。"},
	{Key: InsightPerspectiveSalesVisit, Name: "销售拜访", Description: "识别客户真实需求、商机质量、决策链、承诺和下一步动作。"},
	{Key: InsightPerspectiveInternalMeeting, Name: "公司内部会议", Description: "识别决策、权责、依赖、风险、行动和升级条件。"},
	{Key: InsightPerspectiveLecture, Name: "听一堂课", Description: "提炼课程中可验证的知识，并转化为个人和组织的练习。"},
	{Key: InsightPerspectiveBook, Name: "读一本书", Description: "把书中思想翻译为老板、公司和行业的判断与行动。"},
}

// InsightPerspectiveOptions 返回内置视角的副本，避免调用方修改全局配置。
func InsightPerspectiveOptions() []InsightPerspectiveOption {
	options := make([]InsightPerspectiveOption, len(insightPerspectiveOptions))
	copy(options, insightPerspectiveOptions)
	return options
}

func IsValidInsightPerspective(raw string) bool {
	value := InsightPerspective(strings.ToLower(strings.TrimSpace(raw)))
	if value == "" {
		return true
	}
	for _, option := range insightPerspectiveOptions {
		if option.Key == value {
			return true
		}
	}
	return false
}

// NormalizeInsightPerspective 空值表示未设置，统一归一化为自动判断；未知值回退到内部会议。
func NormalizeInsightPerspective(raw string) InsightPerspective {
	value := InsightPerspective(strings.ToLower(strings.TrimSpace(raw)))
	if value == "" {
		return InsightPerspectiveAuto
	}
	for _, option := range insightPerspectiveOptions {
		if option.Key == value {
			return value
		}
	}
	return DefaultInsightPerspective
}
