package model

import "strings"

// InsightPerspective 表示生成决策洞察时采用的材料/活动视角。
type InsightPerspective string

const (
	// InsightPerspectiveAuto 表示由企业开关控制，依据本次录音纪要自动判断视角。
	InsightPerspectiveAuto                  InsightPerspective = "auto"
	InsightPerspectiveManagementMeeting     InsightPerspective = "management_meeting"
	InsightPerspectiveCustomerCommunication InsightPerspective = "customer_communication"
	InsightPerspectiveProjectReview         InsightPerspective = "project_review"
	InsightPerspectiveBusinessCooperation   InsightPerspective = "business_cooperation"
	InsightPerspectiveBusinessInnovation    InsightPerspective = "business_innovation"
	InsightPerspectiveEmployeeConversation  InsightPerspective = "employee_conversation"
	InsightPerspectiveIndustryExchange      InsightPerspective = "industry_exchange"
	InsightPerspectiveManagementCourse      InsightPerspective = "management_course"

	// 兼容历史记录。它们不再通过 InsightPerspectiveOptions 暴露给新用户。
	InsightPerspectiveExternalTraining InsightPerspective = "external_training"
	InsightPerspectiveExternalSpeech   InsightPerspective = "external_speech"
	InsightPerspectiveRoadshow         InsightPerspective = "roadshow"
	InsightPerspectiveSalesVisit       InsightPerspective = "sales_visit"
	InsightPerspectiveInternalMeeting  InsightPerspective = "internal_meeting"
	InsightPerspectiveLecture          InsightPerspective = "lecture"
	InsightPerspectiveBook             InsightPerspective = "book"
	InsightPerspectiveOneOnOne         InsightPerspective = "one_on_one"
	InsightPerspectiveHiring           InsightPerspective = "hiring"
	InsightPerspectiveGeneral          InsightPerspective = "general"
)

// DefaultInsightPerspective 是自动判断关闭、判断失败或历史数据需要兼容时的安全回退值。
const DefaultInsightPerspective = InsightPerspectiveManagementMeeting

type InsightPerspectiveOption struct {
	Key         InsightPerspective `json:"key"`
	Name        string             `json:"name"`
	Description string             `json:"description"`
}

var insightPerspectiveOptions = []InsightPerspectiveOption{
	{Key: InsightPerspectiveManagementMeeting, Name: "管理例会", Description: "聚焦公司内部管理问题、经营安排、责任分工和执行门禁。"},
	{Key: InsightPerspectiveCustomerCommunication, Name: "客户交流", Description: "识别客户真实问题、关系状态、沟通信号和下一步承诺。"},
	{Key: InsightPerspectiveProjectReview, Name: "项目复盘", Description: "围绕具体项目或事件分析结果、因果、教训和改进动作。"},
	{Key: InsightPerspectiveBusinessCooperation, Name: "商业合作", Description: "评估上下游、渠道伙伴和潜在商业机会的合作可能与验证门槛。"},
	{Key: InsightPerspectiveBusinessInnovation, Name: "业务创新", Description: "分析团队、流程、产品和业务改进的价值、成本与验证方式。"},
	{Key: InsightPerspectiveEmployeeConversation, Name: "员工谈话", Description: "聚焦绩效沟通、员工状态、成长、关系和管理者承诺。"},
	{Key: InsightPerspectiveIndustryExchange, Name: "行业交流", Description: "提炼同行经营情况、行业观点、外部信号和对本公司的影响。"},
	{Key: InsightPerspectiveManagementCourse, Name: "管理课程", Description: "判断销售、产品、品牌和管理课程对个人与企业的实际帮助。"},
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
	if IsCanonicalInsightPerspective(value) || value == InsightPerspectiveAuto {
		return true
	}
	switch value {
	case InsightPerspectiveExternalTraining, InsightPerspectiveExternalSpeech,
		InsightPerspectiveRoadshow, InsightPerspectiveSalesVisit,
		InsightPerspectiveInternalMeeting, InsightPerspectiveLecture,
		InsightPerspectiveBook, InsightPerspectiveOneOnOne,
		InsightPerspectiveHiring, InsightPerspectiveGeneral:
		return true
	default:
		return false
	}
}

func IsCanonicalInsightPerspective(value InsightPerspective) bool {
	for _, option := range insightPerspectiveOptions {
		if option.Key == value {
			return true
		}
	}
	return false
}

// NormalizeInsightPerspective 空值表示未设置，统一归一化为自动判断；历史值保持原样以兼容存量记录。
func NormalizeInsightPerspective(raw string) InsightPerspective {
	value := InsightPerspective(strings.ToLower(strings.TrimSpace(raw)))
	if value == "" {
		return InsightPerspectiveAuto
	}
	if IsValidInsightPerspective(string(value)) {
		return value
	}
	return DefaultInsightPerspective
}

// CanonicalInsightPerspective 将可以无歧义迁移的旧场景映射到正式场景。
// external_speech、roadshow 和 book 依赖具体内容，保留旧值交给兼容 Prompt 处理。
func CanonicalInsightPerspective(value InsightPerspective) InsightPerspective {
	switch value {
	case InsightPerspectiveExternalTraining, InsightPerspectiveLecture:
		return InsightPerspectiveManagementCourse
	case InsightPerspectiveSalesVisit:
		return InsightPerspectiveCustomerCommunication
	case InsightPerspectiveInternalMeeting, InsightPerspectiveGeneral:
		return InsightPerspectiveManagementMeeting
	case InsightPerspectiveOneOnOne:
		return InsightPerspectiveEmployeeConversation
	default:
		return value
	}
}
