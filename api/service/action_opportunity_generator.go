package service

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/tokenlimit"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/actionsystem"
	relaymodel "github.com/songquanpeng/one-api/relay/model"
)

const actionOpportunitySystemPromptV1 = `你是二号总裁的 ActionOpportunityGenerator，负责从洞察、会话、成果和已授权上下文中发现值得执行的 AI Action。

你只负责提出结构化候选，不执行任务，不调用 Codex，不替用户做老板、员工或组织的现实决策。
只能根据输入内容提出候选；会议中没有明确依据的内容不要补充为事实。

必须只输出一个 JSON 对象，不输出 Markdown、代码块或解释，格式必须是：
{
  "opportunities": [
    {
      "title": "候选行动标题",
      "type": "deep_research | analysis | sop | document_generation",
      "type_label": "专项研究/分析测算/制度与 SOP/行动方案",
      "reason": "为什么会议洞察值得形成这个行动",
      "objective": "可验收的行动目标",
      "deliverables": [{"type":"research_report","title":"专项研究报告"}],
      "display_deliverable": "专项研究报告",
      "required_capabilities": ["enterprise_context_read", "document_generation"],
      "human_dependency": "无；仅需用户确认 ActionPlan",
      "ai_executable_score": 0.0,
      "risk_level": "low | medium | high | critical",
      "priority": 1,
      "evidence_refs": [{"source_type":"insight","source_id":"...","segment_id":"","excerpt":""}]
    }
  ]
}

约束：opportunities 最多 3 个；每个候选都必须有明确 objective、deliverable、required_capabilities、human_dependency、risk_level 和 evidence_refs。
ai_executable_score 必须是 0 到 1；priority 从 1 开始且越小越优先。
老板待办、员工待办、线下执行、谈判、招聘、组织推动、人类重大决策、对外承诺不得作为可执行 Action 候选。
如果没有满足条件的候选，返回 {"opportunities":[]}。`

const actionOpportunitySystemPromptV2 = `你是二号总裁的 ActionOpportunityGenerator，负责从洞察、会话、成果和已授权上下文中发现值得执行的 AI Action。

你只负责提出结构化候选，不执行任务，不调用 Codex，不替用户做老板、员工或组织的现实决策。只能依据输入中的会议事实和权威证据，不补充或编造事实。

先判断经营价值，再判断 AI 能否交付；这是一次模型调用中的判断顺序，不是要求拆成多个步骤或多个候选。

第一门：经营需求与价值
1. 从证据识别真实经营问题、目标、待决事项或障碍；区分已确认事实、症状、根因假设和明确决定，不把推测写成事实。
2. 判断老板或有权决策人明确表达的需求（explicit），或从证据合理推断的需求（inferred）。证据不足时，不得把推断写成老板已提出的要求。
3. 判断此刻最值得接手的脑力工作：核实事实/梳理缺口、分析测算/比较方案，或准备明确需要的成果。它们是判断方向，不是固定流水线；已有明确交付需求时不要强行先做诊断。
4. 只有存在现实用途，且能节省老板或骨干查找、整理、分析、测算、比较或决策准备的时间与脑力时，才通过价值门。容易生成文件本身不构成价值。
5. 优先考虑明确目标、时效、重大风险、关键客户/项目和老板当前关注事项。一般闲聊、琐碎行政工作、已完成或已否定事项不推荐。

第二门：AI 可闭环与成果
6. 对通过价值门的工作核对 <available_capabilities>；AI 必须能完成主要脑力工作，并且成果有明确使用场景。人类审批、签署、谈判、实际招聘和组织推动等不能冒充 AI 可执行工作。
7. 写清 AI 具体接手的工作、成果由谁在何时用于什么判断或推进。不要只写“优化、完善、提升”。
8. 检查必要输入是否存在或可补齐。缺少关键数字时不得虚构测算值；若事实核查或缺口清单本身有价值，可只建议该项工作；如果连准备工作也无实际价值，则不推荐。
9. 交付物必须有可按内容检查的验收标准，不能只以“生成一个文件”作为目标。
10. 合并重复候选，按经营需要和省时省脑价值排序，最多输出 3 条；没有合格候选时必须输出空数组，不凑数。

少量反例校准：
- 客户要求降价：可先核对毛利、回款和交换条件；缺少成本、报价或账期时不得编造测算结果。
- 业绩停滞且根因不明：可先整理漏斗事实和缺口；不得直接把未经验证的根因写成事实并生成销售培训 SOP。
- 没有重要待办，或事项已解决/已否定：输出空数组。

必须只输出一个 JSON 对象，不输出 Markdown、代码块或解释，且只能使用以下既有 schema，不得新增字段：
{
  "opportunities": [
    {
      "title": "候选行动标题",
      "type": "deep_research | analysis | sop | document_generation",
      "type_label": "专项研究/分析测算/制度与 SOP/行动方案",
      "reason": "问题证据、为何现在做、AI 将接手的脑力工作",
      "objective": "支持具体实际判断或使用的可验收目标",
      "deliverables": [{"type":"research_report","title":"专项研究报告"}],
      "display_deliverable": "专项研究报告及其用途",
      "required_capabilities": ["enterprise_context_read", "document_generation"],
      "human_dependency": "关键缺失材料、尚未确认事实或人类审批边界",
      "ai_executable_score": 0.0,
      "risk_level": "low | medium | high | critical",
      "priority": 1,
      "evidence_refs": [{"source_type":"insight","source_id":"...","segment_id":"","excerpt":""}]
    }
  ]
}

每个候选都必须有明确 objective、deliverable、required_capabilities、human_dependency、risk_level 和 evidence_refs。reason 只陈述证据支持的问题、时效价值和 AI 接手的工作；objective 和 deliverable 说明要支持的使用或判断及内容级验收方式；human_dependency 标明关键输入缺口、未确认内容及人类边界。
risk_level 只描述 AI 为完成该候选所需操作的权限、执行和外部影响风险，不表示经营问题本身有多严重。仅基于已授权资料进行只读分析，不应仅因现金流、客户或项目问题严重而标为 high；未经授权访问敏感资料、对外承诺、签约、转账或替人作招聘等操作风险仍须如实标为 high 或 critical。
ai_executable_score 必须是 0 到 1；priority 从 1 开始且越小越优先。opportunities 最多 3 个。
老板待办、员工待办、线下执行、谈判、招聘、组织推动、人类重大决策、对外承诺不得作为可执行 Action 候选。
若没有通过两道判断门的候选，返回 {"opportunities":[]}。`

const actionOpportunityPromptVersionEnv = "ACTION_OPPORTUNITY_PROMPT_VERSION"

func actionOpportunitySystemPrompt(version string) (string, error) {
	if strings.TrimSpace(version) == "" {
		version = os.Getenv(actionOpportunityPromptVersionEnv)
	}
	switch strings.ToLower(strings.TrimSpace(version)) {
	case "", "v2":
		return actionOpportunitySystemPromptV2, nil
	case "v1":
		return actionOpportunitySystemPromptV1, nil
	default:
		return "", fmt.Errorf("unsupported ActionOpportunity prompt version %q", version)
	}
}

type actionOpportunityGenerator interface {
	Generate(context.Context, *model.RecordingConfig, actionsystem.DetectionInput, actionsystem.CapabilityRegistry) ([]actionsystem.ActionOpportunity, error)
}

type actionOpportunityGeneratorFunc func(context.Context, *model.RecordingConfig, actionsystem.DetectionInput, actionsystem.CapabilityRegistry) ([]actionsystem.ActionOpportunity, error)

func (f actionOpportunityGeneratorFunc) Generate(ctx context.Context, config *model.RecordingConfig, input actionsystem.DetectionInput, registry actionsystem.CapabilityRegistry) ([]actionsystem.ActionOpportunity, error) {
	return f(ctx, config, input, registry)
}

type actionOpportunityLLMCaller func(context.Context, *model.RecordingConfig, func() *relaymodel.GeneralOpenAIRequest) (string, error)

type llmActionOpportunityGenerator struct {
	call          actionOpportunityLLMCaller
	promptVersion string
}

type actionOpportunityPayload struct {
	Title                string                       `json:"title"`
	Type                 actionsystem.OpportunityType `json:"type"`
	TypeLabel            string                       `json:"type_label"`
	Reason               string                       `json:"reason"`
	Objective            string                       `json:"objective"`
	Deliverables         []actionsystem.Deliverable   `json:"deliverables"`
	DisplayDeliverable   string                       `json:"display_deliverable"`
	RequiredCapabilities []string                     `json:"required_capabilities"`
	HumanDependency      string                       `json:"human_dependency"`
	AIExecutableScore    float64                      `json:"ai_executable_score"`
	RiskLevel            string                       `json:"risk_level"`
	Priority             int                          `json:"priority"`
	EvidenceRefs         []actionsystem.EvidenceRef   `json:"evidence_refs"`
}

type actionOpportunityPayloadEnvelope struct {
	Opportunities []actionOpportunityPayload `json:"opportunities"`
}

const actionOpportunityRequestControlKey = "_53ai_internal_request_control"

func actionOpportunityRequest(modelName string, messages []relaymodel.Message) *relaymodel.GeneralOpenAIRequest {
	return &relaymodel.GeneralOpenAIRequest{
		Model:     modelName,
		MaxTokens: 0,
		Messages:  messages,
		Metadata: map[string]interface{}{
			actionOpportunityRequestControlKey: map[string]interface{}{
				"reasoning_mode": "disabled",
			},
		},
	}
}

func newLLMActionOpportunityGenerator() actionOpportunityGenerator {
	return &llmActionOpportunityGenerator{}
}

func (g *llmActionOpportunityGenerator) Generate(ctx context.Context, config *model.RecordingConfig, input actionsystem.DetectionInput, registry actionsystem.CapabilityRegistry) ([]actionsystem.ActionOpportunity, error) {
	if config == nil || config.InferenceModelID == 0 || strings.TrimSpace(config.InferenceModelName) == "" {
		return nil, fmt.Errorf("meeting insight model is not configured")
	}
	if strings.TrimSpace(input.InsightSummary) == "" {
		return nil, fmt.Errorf("insight summary is empty")
	}
	prompt, err := actionOpportunitySystemPrompt(g.promptVersion)
	if err != nil {
		return nil, err
	}

	modelConfig := *config
	if modelName := strings.TrimSpace(os.Getenv("ACTION_OPPORTUNITY_MODEL")); modelName != "" {
		modelConfig.InferenceModelName = modelName
	}
	caller := g.call
	if caller == nil {
		caller = actionOpportunityLLMCaller(callLLMWithRetry)
	}
	capabilities := actionOpportunityCapabilityPrompt(registry)
	buildRequest := func() *relaymodel.GeneralOpenAIRequest {
		return actionOpportunityRequest(modelConfig.InferenceModelName, []relaymodel.Message{
			{Role: "system", Content: prompt},
			{Role: "user", Content: fmt.Sprintf("<available_capabilities>\n%s\n</available_capabilities>\n\n<source_context type=\"%s\" label=\"%s\">\n%s\n</source_context>\n\n<related_context>\n%s\n</related_context>\n\n<authoritative_evidence_refs>\n%s\n</authoritative_evidence_refs>", capabilities, input.SourceType, input.ContextLabel, tokenlimit.TruncateContent(input.InsightSummary, 6000), tokenlimit.TruncateContent(input.MaterialContext, 6000), marshalActionOpportunityEvidence(input.EvidenceRefs))},
		})
	}

	raw, err := caller(ctx, &modelConfig, buildRequest)
	if err != nil {
		return nil, err
	}
	payload, err := parseActionOpportunityPayload(ctx, raw)
	var candidates []actionsystem.ActionOpportunity
	if err == nil {
		candidates, err = actionOpportunityPayloads(payload, input)
	}
	if err != nil {
		logger.Warnf(ctx, "【ActionOpportunity】首轮模型输出校验失败: bytes=%d err=%v", len(raw), err)
		// The repair request is deliberately the only additional formatting attempt.
		repairRaw, repairErr := caller(ctx, &modelConfig, func() *relaymodel.GeneralOpenAIRequest {
			return actionOpportunityRequest(modelConfig.InferenceModelName, []relaymodel.Message{
				{Role: "system", Content: prompt},
				{Role: "user", Content: fmt.Sprintf("请将下面的模型输出修复为严格符合要求的 JSON。只输出 JSON，不新增任何事实。\n失败原因：%v\n权威 evidence_refs（只能从中选择，不能改写 source_type/source_id/segment_id）：\n%s\n<invalid_output>\n%s\n</invalid_output>", err, marshalActionOpportunityEvidence(input.EvidenceRefs), tokenlimit.TruncateContent(raw, 8000))},
			})
		})
		if repairErr != nil {
			return nil, fmt.Errorf("format repair failed: %w", repairErr)
		}
		payload, err = parseActionOpportunityPayload(ctx, repairRaw)
		if err != nil {
			logger.Warnf(ctx, "【ActionOpportunity】修复模型输出 JSON 校验失败: bytes=%d err=%v", len(repairRaw), err)
			return nil, fmt.Errorf("strict action opportunity JSON is invalid after one repair: %w", err)
		}
		candidates, err = actionOpportunityPayloads(payload, input)
		if err != nil {
			logger.Warnf(ctx, "【ActionOpportunity】修复模型输出 schema 校验失败: err=%v", err)
			return nil, fmt.Errorf("strict action opportunity schema is invalid after one repair: %w", err)
		}
	}
	return candidates, nil
}

func parseActionOpportunityPayload(ctx context.Context, raw string) (actionOpportunityPayloadEnvelope, error) {
	var payload actionOpportunityPayloadEnvelope
	if err := common.ParseLLMJSONInto(ctx, raw, &payload); err != nil {
		return payload, err
	}
	if len(payload.Opportunities) > 3 {
		return payload, fmt.Errorf("opportunities exceeds maximum of 3")
	}
	return payload, nil
}

func actionOpportunityPayloads(payload actionOpportunityPayloadEnvelope, input actionsystem.DetectionInput) ([]actionsystem.ActionOpportunity, error) {
	result := make([]actionsystem.ActionOpportunity, 0, len(payload.Opportunities))
	for index, item := range payload.Opportunities {
		if err := validateActionOpportunityPayload(item); err != nil {
			return nil, fmt.Errorf("opportunity %d: %w", index+1, err)
		}
		evidenceRefs, err := authoritativeActionEvidence(item.EvidenceRefs, input.EvidenceRefs)
		if err != nil {
			return nil, fmt.Errorf("opportunity %d: %w", index+1, err)
		}
		result = append(result, actionsystem.ActionOpportunity{
			Title:                strings.TrimSpace(item.Title),
			Type:                 item.Type,
			TypeLabel:            strings.TrimSpace(item.TypeLabel),
			Reason:               strings.TrimSpace(item.Reason),
			Objective:            strings.TrimSpace(item.Objective),
			Deliverables:         item.Deliverables,
			DisplayDeliverable:   strings.TrimSpace(item.DisplayDeliverable),
			RequiredCapabilities: item.RequiredCapabilities,
			HumanDependency:      strings.TrimSpace(item.HumanDependency),
			AIExecutableScore:    item.AIExecutableScore,
			RiskLevel:            item.RiskLevel,
			Priority:             item.Priority,
			EvidenceRefs:         evidenceRefs,
		})
	}
	return result, nil
}

func validateActionOpportunityPayload(item actionOpportunityPayload) error {
	if strings.TrimSpace(item.Title) == "" || strings.TrimSpace(item.TypeLabel) == "" || strings.TrimSpace(item.Reason) == "" || strings.TrimSpace(item.Objective) == "" || strings.TrimSpace(item.DisplayDeliverable) == "" || strings.TrimSpace(item.HumanDependency) == "" {
		return fmt.Errorf("required text is empty")
	}
	switch item.Type {
	case actionsystem.OpportunityDeepResearch, actionsystem.OpportunityAnalysis, actionsystem.OpportunitySOP, actionsystem.OpportunityDocument:
	default:
		return fmt.Errorf("unsupported opportunity type %q", item.Type)
	}
	if len(item.Deliverables) == 0 || len(item.Deliverables) > 5 {
		return fmt.Errorf("deliverables must contain 1 to 5 items")
	}
	for _, deliverable := range item.Deliverables {
		if strings.TrimSpace(deliverable.Type) == "" || strings.TrimSpace(deliverable.Title) == "" {
			return fmt.Errorf("deliverable is incomplete")
		}
	}
	if len(item.RequiredCapabilities) == 0 || len(item.RequiredCapabilities) > 8 {
		return fmt.Errorf("required_capabilities must contain 1 to 8 items")
	}
	seen := make(map[string]struct{}, len(item.RequiredCapabilities))
	for _, capability := range item.RequiredCapabilities {
		capability = strings.TrimSpace(capability)
		if capability == "" {
			return fmt.Errorf("required capability is empty")
		}
		if _, ok := seen[capability]; ok {
			return fmt.Errorf("duplicate required capability %q", capability)
		}
		seen[capability] = struct{}{}
	}
	if item.AIExecutableScore < 0 || item.AIExecutableScore > 1 || item.Priority < 1 || item.Priority > 100 {
		return fmt.Errorf("score or priority is out of range")
	}
	switch item.RiskLevel {
	case actionsystem.RiskLow, actionsystem.RiskMedium, actionsystem.RiskHigh, actionsystem.RiskCritical:
	default:
		return fmt.Errorf("unsupported risk level %q", item.RiskLevel)
	}
	return nil
}

func authoritativeActionEvidence(candidate, authoritative []actionsystem.EvidenceRef) ([]actionsystem.EvidenceRef, error) {
	if len(candidate) == 0 {
		return cloneActionEvidence(authoritative), nil
	}
	result := make([]actionsystem.EvidenceRef, 0, len(candidate))
	for _, ref := range candidate {
		found := false
		for _, source := range authoritative {
			if ref.SourceType == source.SourceType && ref.SourceID == source.SourceID && (ref.SegmentID == "" || ref.SegmentID == source.SegmentID) {
				result = append(result, source)
				found = true
				break
			}
		}
		if !found {
			return nil, fmt.Errorf("evidence ref is not authoritative: %s/%s", ref.SourceType, ref.SourceID)
		}
	}
	return result, nil
}

func cloneActionEvidence(refs []actionsystem.EvidenceRef) []actionsystem.EvidenceRef {
	return append([]actionsystem.EvidenceRef(nil), refs...)
}

func marshalActionOpportunityEvidence(refs []actionsystem.EvidenceRef) string {
	data, err := json.Marshal(refs)
	if err != nil {
		return "[]"
	}
	return string(data)
}

func actionOpportunityCapabilityPrompt(registry actionsystem.CapabilityRegistry) string {
	keys := []string{actionsystem.CapabilityEnterpriseContext, actionsystem.CapabilityDeepResearch, actionsystem.CapabilityDocumentGeneration}
	items := make([]actionsystem.Capability, 0, len(keys))
	for _, key := range keys {
		if capability, ok := registry.Get(key); ok {
			items = append(items, capability)
		}
	}
	data, err := json.Marshal(items)
	if err != nil {
		return "[]"
	}
	return string(data)
}

func configuredActionPlannerModel(config *model.RecordingConfig) string {
	if modelName := strings.TrimSpace(os.Getenv("ACTION_PLANNER_MODEL")); modelName != "" {
		return modelName
	}
	if config == nil {
		return ""
	}
	return strings.TrimSpace(config.InferenceModelName)
}
