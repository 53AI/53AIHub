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
	// InsightPerspectiveHiring 是人才面试 / 合作人才评估场景。它曾只作为兼容旧值存在
	// （有常量但无 Prompt Profile，会静默兜底到管理例会），现在升为正式视角。
	InsightPerspectiveHiring InsightPerspective = "hiring"

	// 兼容历史记录。它们不再通过 InsightPerspectiveOptions 暴露给新用户。
	InsightPerspectiveExternalTraining InsightPerspective = "external_training"
	InsightPerspectiveExternalSpeech   InsightPerspective = "external_speech"
	InsightPerspectiveRoadshow         InsightPerspective = "roadshow"
	InsightPerspectiveSalesVisit       InsightPerspective = "sales_visit"
	InsightPerspectiveInternalMeeting  InsightPerspective = "internal_meeting"
	InsightPerspectiveLecture          InsightPerspective = "lecture"
	InsightPerspectiveBook             InsightPerspective = "book"
	InsightPerspectiveOneOnOne         InsightPerspective = "one_on_one"
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
	{Key: InsightPerspectiveHiring, Name: "人才面试", Description: "评估候选人真实能力、合作方式与验证路径，形成是否推进的判断。"},
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
	if IsCanonicalScene(RecordingScene(value)) {
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
		InsightPerspectiveGeneral:
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

// RecordingScene 是会议的一级经营场景。
type RecordingScene string

const (
	RecordingSceneStrategyOperation   RecordingScene = "strategy_operation"
	RecordingSceneCustomerGrowth      RecordingScene = "customer_growth"
	RecordingSceneProductInnovation   RecordingScene = "product_innovation"
	RecordingSceneProjectDelivery     RecordingScene = "project_delivery"
	RecordingSceneOrganizationTalent  RecordingScene = "organization_talent"
	RecordingScenePartnershipResource RecordingScene = "partnership_resource"
	RecordingSceneLearningInsight     RecordingScene = "learning_insight"
)

// SceneMode 是会议采用的会议模式。
type SceneMode string

const (
	SceneModeDecision      SceneMode = "decision"
	SceneModeAdvancement   SceneMode = "advancement"
	SceneModeNegotiation   SceneMode = "negotiation"
	SceneModeEvaluation    SceneMode = "evaluation"
	SceneModeRetrospective SceneMode = "retrospective"
	SceneModeLearning      SceneMode = "learning"
)

// RecordingSceneOption 是场景与模式对外的选项形态。
type RecordingSceneOption struct {
	Key         string `json:"key"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

var recordingSceneOptions = []RecordingSceneOption{
	{Key: string(RecordingSceneStrategyOperation), Name: "战略经营", Description: "公司整体方向、经营目标、预算、资源配置、重大取舍。"},
	{Key: string(RecordingSceneCustomerGrowth), Name: "客户增长", Description: "客户需求、销售、成交、续约、增购与回款。"},
	{Key: string(RecordingSceneProductInnovation), Name: "产品创新", Description: "做什么产品、服务或新业务，以及是否值得做。"},
	{Key: string(RecordingSceneProjectDelivery), Name: "项目交付", Description: "已确定的事如何真正完成。"},
	{Key: string(RecordingSceneOrganizationTalent), Name: "组织人才", Description: "人、岗位、团队、干部与组织能力。"},
	{Key: string(RecordingScenePartnershipResource), Name: "合作资源", Description: "通过外部组织、渠道、供应商或伙伴完成商业目标。"},
	{Key: string(RecordingSceneLearningInsight), Name: "学习认知", Description: "获取新知识、方法、经验、趋势或判断框架。"},
}

var sceneModeOptions = []RecordingSceneOption{
	{Key: string(SceneModeDecision), Name: "决策", Description: "做选择、定方向、拍板。"},
	{Key: string(SceneModeAdvancement), Name: "推进", Description: "推动已经确定的事情落地。"},
	{Key: string(SceneModeNegotiation), Name: "沟通谈判", Description: "澄清需求、交换立场、协商条件。"},
	{Key: string(SceneModeEvaluation), Name: "评估", Description: "判断人、方案或机会是否合适。"},
	{Key: string(SceneModeRetrospective), Name: "复盘", Description: "回顾结果、分析原因、总结改进。"},
	{Key: string(SceneModeLearning), Name: "学习", Description: "吸收新知识、新观点、新方法。"},
}

// SceneOptions 返回内置一级场景的副本。
func SceneOptions() []RecordingSceneOption {
	options := make([]RecordingSceneOption, len(recordingSceneOptions))
	copy(options, recordingSceneOptions)
	return options
}

// SceneModeOptions 返回内置会议模式的副本。
func SceneModeOptions() []RecordingSceneOption {
	options := make([]RecordingSceneOption, len(sceneModeOptions))
	copy(options, sceneModeOptions)
	return options
}

// IsCanonicalScene 判断给定值是否为 7 个一级场景之一。
func IsCanonicalScene(value RecordingScene) bool {
	for _, option := range recordingSceneOptions {
		if RecordingScene(option.Key) == value {
			return true
		}
	}
	return false
}

// IsValidSceneMode 判断给定值是否为 6 个会议模式之一。
func IsValidSceneMode(value SceneMode) bool {
	for _, option := range sceneModeOptions {
		if SceneMode(option.Key) == value {
			return true
		}
	}
	return false
}

// ResolveSceneFromCode 将旧视角码或场景码归一化为一级场景；auto/未知返回空。
func ResolveSceneFromCode(code string) RecordingScene {
	trimmed := strings.ToLower(strings.TrimSpace(code))
	if trimmed == "" || trimmed == string(InsightPerspectiveAuto) {
		return ""
	}
	scene := RecordingScene(trimmed)
	if IsCanonicalScene(scene) {
		return scene
	}
	switch InsightPerspective(trimmed) {
	case InsightPerspectiveCustomerCommunication, InsightPerspectiveSalesVisit:
		return RecordingSceneCustomerGrowth
	case InsightPerspectiveProjectReview:
		return RecordingSceneProjectDelivery
	case InsightPerspectiveBusinessCooperation:
		return RecordingScenePartnershipResource
	case InsightPerspectiveBusinessInnovation:
		return RecordingSceneProductInnovation
	case InsightPerspectiveEmployeeConversation, InsightPerspectiveOneOnOne, InsightPerspectiveHiring:
		return RecordingSceneOrganizationTalent
	case InsightPerspectiveIndustryExchange, InsightPerspectiveManagementCourse,
		InsightPerspectiveExternalTraining, InsightPerspectiveLecture,
		InsightPerspectiveBook, InsightPerspectiveExternalSpeech:
		return RecordingSceneLearningInsight
	case InsightPerspectiveRoadshow:
		return RecordingSceneCustomerGrowth
	case InsightPerspectiveManagementMeeting, InsightPerspectiveInternalMeeting, InsightPerspectiveGeneral:
		return RecordingSceneStrategyOperation
	default:
		return ""
	}
}

// SceneLegacyCodes 返回可映射到该场景的旧视角码，用于列表兼容过滤。
func SceneLegacyCodes(scene RecordingScene) []string {
	codes := make([]string, 0, 4)
	for _, code := range []InsightPerspective{
		InsightPerspectiveManagementMeeting, InsightPerspectiveCustomerCommunication,
		InsightPerspectiveProjectReview, InsightPerspectiveBusinessCooperation,
		InsightPerspectiveBusinessInnovation, InsightPerspectiveEmployeeConversation,
		InsightPerspectiveIndustryExchange, InsightPerspectiveManagementCourse,
		InsightPerspectiveExternalTraining, InsightPerspectiveExternalSpeech,
		InsightPerspectiveRoadshow, InsightPerspectiveSalesVisit,
		InsightPerspectiveInternalMeeting, InsightPerspectiveLecture,
		InsightPerspectiveBook, InsightPerspectiveOneOnOne,
		InsightPerspectiveHiring, InsightPerspectiveGeneral,
	} {
		if ResolveSceneFromCode(string(code)) == scene {
			codes = append(codes, string(code))
		}
	}
	return codes
}
