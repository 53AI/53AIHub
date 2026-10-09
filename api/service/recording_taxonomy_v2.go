package service

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	recordingdebug "github.com/53AI/53AIHub/service/recording_debug"
	relaymodel "github.com/songquanpeng/one-api/relay/model"
)

// Taxonomy V2（Phase 4A）只做 Shadow：识别“现场类型 × 参与角色 × 参与目的 × 判断任务”，
// 不写入 files.insight_perspective，不注入 V2.1 Second Brain Prompt，不影响任何正式结果。

const recordingTaxonomyV2PromptVersion = "taxonomy-v2-shadow-1"
const recordingTaxonomyV2BPromptVersion = "taxonomy-v2-shadow-2"

// 两个 Shadow 变体：v1 是 Phase 4A 的冻结提示词，v2 是 Phase 4B 的边界校准版。
const (
	RecordingTaxonomyShadowVariantV1 = "taxonomy_shadow_v1"
	RecordingTaxonomyShadowVariantV2 = "taxonomy_shadow_v2"
)

// 候选集合。它们不是最终 taxonomy：Phase 4A 只要求 AI 能稳定选择、用户能理解、边界清晰；
// 是否合并/拆分由真实 Case 评测结论决定。
var (
	recordingTaxonomyV2SceneTypes = []string{
		"internal_management",  // 内部经营
		"customer_engagement",  // 客户交流
		"business_cooperation", // 商业合作
		"talent_interaction",   // 人才交流
		"industry_event",       // 行业 / 企业公开交流
		"learning_program",     // 课程 / 系统学习
		"network_social",       // 圈层 / 社交活动
		"advisory_deep_talk",   // 顾问 / 专业深聊
		"project_work",         // 项目工作现场
	}
	recordingTaxonomyV2Roles = []string{
		"decision_maker", "host", "speaker", "participant", "observer", "advisor",
		"reviewer", "recruiter", "customer", "seller", "partner", "learner", "network_member",
	}
	recordingTaxonomyV2Intents = []string{
		"learn", "understand", "decide", "evaluate", "review", "advance", "negotiate",
		"sell", "buy", "recruit", "manage", "advise", "gatekeep", "build_relationship",
		"explore_cooperation", "discover_opportunity", "observe_market", "validate_assumption", "solve_problem",
	}

	// Phase 4B：顶层仍是 9 类，其中两个改名以强调“客观现场”而不是议题或深度。
	recordingTaxonomyV2BSceneTypes = []string{
		"internal_management",
		"project_work",
		"customer_interaction",
		"business_cooperation",
		"talent_interaction",
		"industry_event",
		"learning_program",
		"network_social",
		"advisory_conversation",
	}
	// Phase 4B：删除 understand 与 validate_assumption（信息量低 / 更接近判断任务）。
	recordingTaxonomyV2BIntents = []string{
		"learn", "decide", "evaluate", "review", "advance", "negotiate",
		"sell", "buy", "recruit", "manage", "advise", "gatekeep", "build_relationship",
		"explore_cooperation", "discover_opportunity", "observe_market", "solve_problem",
	}
)

const recordingTaxonomyV2SystemPrompt = `你是老板现场理解器。你的任务不是总结会议，而是判断“这是什么现场、用户在其中扮演什么角色、用户为什么参加、会后需要替他/她想清楚哪几件事”。

只输出一个 JSON 对象，不输出 Markdown、代码块或解释。

## 四个层次，不要混在一起

1. scene_type（现场类型，单选）：客观上这是什么现场。尽量稳定、尽量不依赖用户主观目的。
2. participation_role（参与角色，主角色单选 + 可选次要角色）：用户在这个现场主要扮演什么角色。同一个现场，角色不同会显著改变判断任务。
3. intent_tags（参与目的，多选 1–4 个）：用户为什么参加这次现场。判断的是“用户参加的目的”，不是“会议里谈到了什么”；不允许因为现场有人提到某个话题就自动打上相应标签。
4. decision_tasks（判断任务，1–5 个，动态生成）：会后需要替用户想清楚的具体问题。它不是固定分类，question 必须针对这次现场动态生成，task_type 只用于粗粒度工程路由。

## 候选值（只允许使用下列取值）

scene_type 候选：{{SCENE_TYPES}}
participation_role 候选：{{ROLES}}
intent_tags 候选：{{INTENTS}}

decision_tasks 的 task_type 使用下列粗粒度类型之一：evaluate_person / evaluate_opportunity / learning_transfer / relationship_followup / project_gate / decision_gate / risk_check / next_step_design。

## 判定规则

- scene_type 必须只依据材料中客观发生的事，不得依赖用户的参与目的；如果两个类型都合理，选择更接近“现场客观性质”的那个，并在 ambiguity 中记录另一个候选与理由。
- participation_role 描述用户本人，不是其他参会人。
- intent_tags 每个都必须能在材料里找到证据；证据不足就不要打这个标签。同一场现场可以同时有“学习 + 关系 + 机会探索”等多个目的，不要为了整齐只保留一个。
- decision_tasks 只保留真正值得占用用户脑力的问题，必须能落到这次现场的具体事实、人物或机会上；禁止写“是否需要关注行业趋势”这类泛化问题。
- 允许信息不足：拿不准的字段降低 confidence 或留空数组，不要编造。

## 输出 JSON

{
  "scene_type": {"value": "", "confidence": 0.0, "evidence": ["material fact"]},
  "participation_role": {"primary": "", "secondary": [], "confidence": 0.0, "evidence": ["material fact"]},
  "intent_tags": [{"value": "", "confidence": 0.0, "evidence": ["material fact"]}],
  "decision_tasks": [{"task_type": "", "question": "", "why_it_matters": "", "priority": 1, "confidence": 0.0, "evidence": ["material fact"]}],
  "topic_tags": ["short topic"],
  "entity_links": [{"name": "", "type": "person|company|project|product|other", "role": "参与者|对方|提及"}],
  "ambiguity": {"alternative_scene": "", "reason": ""}
}

confidence 取 0–1；priority 从 1 开始且越小越重要。topic_tags 与 entity_links 短而具体即可（各不超过 8 条）。`

// recordingTaxonomyV2IntentTag 是一个参与目的。
type recordingTaxonomyV2IntentTag struct {
	Value      string   `json:"value"`
	Confidence float64  `json:"confidence"`
	Evidence   []string `json:"evidence"`
}

// recordingTaxonomyV2DecisionTask 是一个判断任务（Phase 4B 增加来源与证据强度）。
type recordingTaxonomyV2DecisionTask struct {
	TaskType     string   `json:"task_type"`
	Question     string   `json:"question"`
	WhyItMatters string   `json:"why_it_matters"`
	Priority     int      `json:"priority"`
	Confidence   float64  `json:"confidence"`
	Evidence     []string `json:"evidence"`
	// Phase 4B：任务来源可审计 + 证据门（strong / medium / weak）。
	Origin struct {
		Type string `json:"type"`
		Ref  string `json:"ref"`
	} `json:"origin"`
	EvidenceStrength string `json:"evidence_strength"`
	// Phase 4C：与当前用户此刻的相关性来源 + 任务分级。
	Relevance struct {
		Type       string   `json:"type"`
		Confidence float64  `json:"confidence"`
		Evidence   []string `json:"evidence"`
	} `json:"relevance"`
	TaskTier string `json:"task_tier"`
}

// recordingTaxonomyV2Result 是模型返回的严格 JSON 契约。
type recordingTaxonomyV2Result struct {
	SceneType struct {
		Value      string   `json:"value"`
		Confidence float64  `json:"confidence"`
		Evidence   []string `json:"evidence"`
	} `json:"scene_type"`
	SceneSubtype struct {
		Value      string  `json:"value"`
		Confidence float64 `json:"confidence"`
		// 模型有时会顺带给证据；接受但不使用，避免严格解析把整条结果判为失败。
		Evidence []string `json:"evidence"`
	} `json:"scene_subtype"`
	ParticipationRole struct {
		Primary    string   `json:"primary"`
		Secondary  []string `json:"secondary"`
		Confidence float64  `json:"confidence"`
		Evidence   []string `json:"evidence"`
	} `json:"participation_role"`
	// AuthorityLevel 是 Phase 4C 的正交维度：对这件事用户有多大决定权。
	AuthorityLevel struct {
		Value      string   `json:"value"`
		Confidence float64  `json:"confidence"`
		Evidence   []string `json:"evidence"`
	} `json:"authority_level"`
	IntentTags    []recordingTaxonomyV2IntentTag    `json:"intent_tags"`
	DecisionTasks []recordingTaxonomyV2DecisionTask `json:"decision_tasks"`
	TopicTags     []string                          `json:"topic_tags"`
	EntityLinks   []struct {
		Name string `json:"name"`
		Type string `json:"type"`
		Role string `json:"role"`
	} `json:"entity_links"`
	Ambiguity struct {
		AlternativeScene string `json:"alternative_scene"`
		Reason           string `json:"reason"`
	} `json:"ambiguity"`
}

// recordingTaxonomyV2ComparisonView 是评测包使用的稳定视图。
type RecordingTaxonomyV2View struct {
	FileID              int64                         `json:"file_id"`
	InsightGeneration   int64                         `json:"insight_generation"`
	Variant             string                        `json:"variant,omitempty"`
	SceneType           string                        `json:"scene_type"`
	SceneConfidence     float64                       `json:"scene_confidence"`
	SceneSubtype        string                        `json:"scene_subtype,omitempty"`
	SubtypeConfidence   float64                       `json:"scene_subtype_confidence,omitempty"`
	ParticipationRole   string                        `json:"participation_role"`
	AuthorityLevel      string                        `json:"authority_level,omitempty"`
	AuthorityConfidence float64                       `json:"authority_confidence,omitempty"`
	SecondaryRoles      []string                      `json:"secondary_roles"`
	IntentTags          []recordingTaxonomyV2TagView  `json:"intent_tags"`
	DecisionTasks       []recordingTaxonomyV2TaskView `json:"decision_tasks"`
	TopicTags           []string                      `json:"topic_tags"`
	EntityLinks         []string                      `json:"entity_links"`
	Ambiguity           map[string]string             `json:"ambiguity"`
	ModelName           string                        `json:"model"`
	PromptHash          string                        `json:"prompt_hash"`
	PromptVersion       string                        `json:"prompt_version"`
	Status              string                        `json:"status"`
	ErrorMessage        string                        `json:"error_message,omitempty"`
	DurationMs          int64                         `json:"duration_ms"`
}

type recordingTaxonomyV2TagView struct {
	Value      string   `json:"value"`
	Confidence float64  `json:"confidence"`
	Evidence   []string `json:"evidence"`
}

// recordingTaxonomyV2TaskView 与落库 JSON 形状保持一致（origin 为嵌套对象）。
type recordingTaxonomyV2TaskView struct {
	TaskType     string   `json:"task_type"`
	Question     string   `json:"question"`
	WhyItMatters string   `json:"why_it_matters"`
	Priority     int      `json:"priority"`
	Confidence   float64  `json:"confidence"`
	Evidence     []string `json:"evidence"`
	Origin       struct {
		Type string `json:"type"`
		Ref  string `json:"ref"`
	} `json:"origin"`
	EvidenceStrength string `json:"evidence_strength,omitempty"`
	// relevance 与落库 JSON 保持同一形状（嵌套对象）。
	Relevance struct {
		Type       string   `json:"type"`
		Confidence float64  `json:"confidence"`
		Evidence   []string `json:"evidence"`
	} `json:"relevance"`
	TaskTier string `json:"task_tier,omitempty"`
}

func recordingTaxonomyV2PromptHash(systemPrompt, userPrompt string) string {
	return secondBrainHash(systemPrompt + "\x00" + userPrompt)
}

// buildRecordingTaxonomyV2UserPrompt 组装真实可用输入（不依赖失效的 PrimaryScene / Topics）。
func buildRecordingTaxonomyV2UserPrompt(ctx context.Context, eid, userID, fileID int64, file *model.File) (string, error) {
	minutes, _ := loadMeetingMinutesText(ctx, eid, fileID)
	transcript, _ := loadTranscriptText(ctx, eid, fileID)
	if strings.TrimSpace(minutes) == "" && strings.TrimSpace(transcript) == "" {
		return "", fmt.Errorf("taxonomy v2 requires meeting minutes or transcript")
	}
	personal := loadInsightPersonalContext(ctx, eid, userID, fileID)
	enterprise, _ := model.GetEnterpriseByID(eid)

	var builder strings.Builder
	builder.WriteString("<source_title>\n" + insightSourceTitle(file.Path) + "\n</source_title>\n\n")
	if currentUserBlock := recordingTaxonomyCurrentUserBlock(BuildRecordingTaxonomyCurrentUser(ctx, eid, userID, fileID)); currentUserBlock != "" {
		builder.WriteString(currentUserBlock + "\n")
	}
	if participants := recordingTaxonomyV2Participants(fileID); participants != "" {
		builder.WriteString("<participants>\n" + participants + "\n</participants>\n\n")
	}
	if personalInfo := strings.TrimSpace(personal.formatted()); personalInfo != "" {
		builder.WriteString("<personal_info>\n" + personalInfo + "\n</personal_info>\n\n")
	}
	if companyInfo := strings.TrimSpace(formatCompanyBackground(enterprise)); companyInfo != "" {
		builder.WriteString("<company_info>\n" + companyInfo + "\n</company_info>\n\n")
	}
	if strings.TrimSpace(minutes) != "" {
		builder.WriteString("<meeting_minutes>\n" + minutes + "\n</meeting_minutes>\n\n")
	}
	if strings.TrimSpace(transcript) != "" {
		builder.WriteString("<transcription>\n" + truncateInsightContext(transcript, maxInsightContextText) + "\n</transcription>\n")
	}
	return builder.String(), nil
}

// recordingTaxonomyV2Participants 从纪要 JSON 提取参与人（仅用于现场判断）。
func recordingTaxonomyV2Participants(fileID int64) string {
	summary, err := model.GetSummaryByTemplateID(fileID, 0)
	if err != nil || summary == nil {
		return ""
	}
	var payload struct {
		Meeting struct {
			Participants []struct {
				Name string `json:"name"`
				Role string `json:"role"`
			} `json:"participants"`
		} `json:"meeting"`
	}
	if json.Unmarshal([]byte(summary.SummaryContent), &payload) != nil {
		return ""
	}
	parts := make([]string, 0, len(payload.Meeting.Participants))
	for _, participant := range payload.Meeting.Participants {
		name := strings.TrimSpace(participant.Name)
		if name == "" {
			continue
		}
		if role := strings.TrimSpace(participant.Role); role != "" {
			parts = append(parts, fmt.Sprintf("%s（%s）", name, role))
		} else {
			parts = append(parts, name)
		}
	}
	if len(parts) > 10 {
		parts = parts[:10]
	}
	return strings.Join(parts, "、")
}

func normalizeRecordingTaxonomyV2Values(values []string, allowed []string, limit int) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || !containsString(allowed, value) || containsString(result, value) {
			continue
		}
		result = append(result, value)
		if len(result) == limit {
			break
		}
	}
	return result
}

// parseRecordingTaxonomyShadow 把模型输出收敛成受控结果：候选外取值一律丢弃。
func parseRecordingTaxonomyShadow(ctx context.Context, raw string, profile recordingTaxonomyShadowProfile) (*recordingTaxonomyV2Result, error) {
	var parsed recordingTaxonomyV2Result
	if err := common.ParseLLMJSONInto(ctx, raw, &parsed); err != nil {
		return nil, fmt.Errorf("解析 Taxonomy JSON 失败: %w", err)
	}
	if !containsString(profile.Scenes, strings.TrimSpace(parsed.SceneType.Value)) {
		return nil, fmt.Errorf("scene_type %q is not in the candidate set", parsed.SceneType.Value)
	}
	if !containsString(profile.Roles, strings.TrimSpace(parsed.ParticipationRole.Primary)) {
		return nil, fmt.Errorf("participation_role %q is not in the candidate set", parsed.ParticipationRole.Primary)
	}
	intents := make([]recordingTaxonomyV2IntentTag, 0, len(parsed.IntentTags))
	for _, tag := range parsed.IntentTags {
		if containsString(profile.Intents, strings.TrimSpace(tag.Value)) {
			intents = append(intents, tag)
		}
	}
	if len(intents) == 0 || len(intents) > 4 {
		return nil, fmt.Errorf("intent_tags must contain 1-4 candidate values, got %d", len(intents))
	}
	tasks := make([]recordingTaxonomyV2DecisionTask, 0, len(parsed.DecisionTasks))
	for _, task := range parsed.DecisionTasks {
		if strings.TrimSpace(task.Question) == "" {
			continue
		}
		task.EvidenceStrength = normalizeRecordingTaxonomyEvidenceStrength(task.EvidenceStrength)
		task.Origin.Type = normalizeRecordingTaxonomyOriginType(task.Origin.Type)
		task.Relevance.Type = normalizeRecordingTaxonomyRelevanceType(task.Relevance.Type)
		// Phase 4C 相关性护栏：generic_inference 一律不得进入 decision_tasks。
		if task.Relevance.Type == recordingTaxonomyRelevanceGenericInference {
			continue
		}
		task.TaskTier = normalizeRecordingTaxonomyTaskTier(task.TaskTier, task)
		tasks = append(tasks, task)
	}
	tasks = applyRecordingTaxonomyTaskTiers(tasks)
	if len(tasks) == 0 || len(tasks) > 5 {
		return nil, fmt.Errorf("decision_tasks must contain 1-5 questions, got %d", len(tasks))
	}
	parsed.IntentTags = intents
	parsed.DecisionTasks = tasks
	if value := strings.TrimSpace(parsed.AuthorityLevel.Value); value != "" && !containsString(recordingTaxonomyV2CAuthorityLevels, value) {
		parsed.AuthorityLevel.Value = "unknown"
	}
	return &parsed, nil
}

const (
	recordingTaxonomyRelevanceGenericInference = "generic_inference"
	recordingTaxonomyRelevanceExternalAnalogy  = "external_analogy"
	recordingTaxonomyTaskTierCore              = "core"
	recordingTaxonomyTaskTierSecondary         = "secondary"
)

func normalizeRecordingTaxonomyRelevanceType(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if containsString(recordingTaxonomyV2CRelevanceTypes, value) {
		return value
	}
	// 未知取值按“与本场明确目的对应”处理，避免误杀；generic_inference 必须由模型显式给出才拦。
	return "explicit_user_intent"
}

func normalizeRecordingTaxonomyTaskTier(value string, task recordingTaxonomyV2DecisionTask) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == recordingTaxonomyTaskTierCore && !recordingTaxonomyTaskEligibleForCore(task) {
		return recordingTaxonomyTaskTierSecondary
	}
	if containsString(recordingTaxonomyV2CTaskTiers, value) {
		return value
	}
	if recordingTaxonomyTaskEligibleForCore(task) {
		return recordingTaxonomyTaskTierCore
	}
	return recordingTaxonomyTaskTierSecondary
}

// recordingTaxonomyTaskEligibleForCore 判断任务是否具备 core 资格：
// 证据 strong/medium，且相关性不是 external_analogy / generic_inference。
func recordingTaxonomyTaskEligibleForCore(task recordingTaxonomyV2DecisionTask) bool {
	if task.EvidenceStrength != "strong" && task.EvidenceStrength != "medium" {
		return false
	}
	return task.Relevance.Type != recordingTaxonomyRelevanceExternalAnalogy && task.Relevance.Type != recordingTaxonomyRelevanceGenericInference
}

// applyRecordingTaxonomyTaskTiers 保证 core ≤3、secondary ≤2，并按 priority 保留最重要的。
func applyRecordingTaxonomyTaskTiers(tasks []recordingTaxonomyV2DecisionTask) []recordingTaxonomyV2DecisionTask {
	sort.SliceStable(tasks, func(i, j int) bool { return tasks[i].Priority < tasks[j].Priority })
	result := make([]recordingTaxonomyV2DecisionTask, 0, len(tasks))
	core, secondary := 0, 0
	for _, task := range tasks {
		if task.TaskTier == recordingTaxonomyTaskTierCore {
			if core < 3 {
				core++
				result = append(result, task)
				continue
			}
			task.TaskTier = recordingTaxonomyTaskTierSecondary
		}
		if secondary >= 2 {
			continue
		}
		secondary++
		result = append(result, task)
	}
	return result
}

func normalizeRecordingTaxonomyEvidenceStrength(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "strong", "medium", "weak":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return "medium"
	}
}

func normalizeRecordingTaxonomyOriginType(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "intent", "explicit_unresolved", "emergent_signal", "historical_continuity":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return "intent"
	}
}

// parseRecordingTaxonomyV2 是 v1（Phase 4A）解析入口，保持既有测试契约。
func parseRecordingTaxonomyV2(ctx context.Context, raw string) (*recordingTaxonomyV2Result, error) {
	return parseRecordingTaxonomyShadow(ctx, raw, recordingTaxonomyShadowProfileFor(RecordingTaxonomyShadowVariantV1))
}

// RunRecordingTaxonomyShadow 生成一次 Taxonomy Shadow；失败只记录在 shadow 表。
// variant 决定使用哪套提示词（taxonomy_shadow_v1 / taxonomy_shadow_v2），两套结果各自独立保存。
func RunRecordingTaxonomyShadow(ctx context.Context, eid, userID, fileID int64, variant string) error {
	profile := recordingTaxonomyShadowProfileFor(variant)
	file, err := model.GetFileByID(eid, fileID)
	if err != nil || file == nil {
		return fmt.Errorf("读取文件失败: %w", err)
	}
	if !file.IsRecordingOriginType() {
		return fmt.Errorf("非安心录来源文件不做 Taxonomy 判断")
	}
	if file.UserID > 0 && userID != file.UserID {
		userID = file.UserID
	}
	config, err := model.ValidateOrCreateRecordingConfig(eid)
	if err != nil || config.InferenceModelID == 0 || strings.TrimSpace(config.InferenceModelName) == "" {
		return fmt.Errorf("推理模型未配置")
	}
	userPrompt, err := buildRecordingTaxonomyV2UserPrompt(ctx, eid, userID, fileID, file)
	if err != nil {
		return err
	}
	systemPrompt := buildRecordingTaxonomyShadowPrompt(profile)

	row := &model.RecordingTaxonomyV2Shadow{
		Eid: eid, OwnerID: userID, FileID: fileID, InsightGeneration: file.InsightGeneration,
		Variant: profile.Variant, ModelName: config.InferenceModelName, PromptVersion: profile.Version,
		PromptHash: recordingTaxonomyV2PromptHash(systemPrompt, userPrompt),
	}
	startedAt := time.Now()
	raw, callErr := callLLMWithRetry(
		recordingdebug.WithLLMStage(ctx, recordingdebug.LLMStage(ctx, "taxonomy_v2_shadow_llm")),
		config,
		func() *relaymodel.GeneralOpenAIRequest {
			// Taxonomy 输出是带 evidence/relevance 的嵌套 JSON，必须显式给足 max_tokens；
			// 依赖渠道默认值会被截断成非法 JSON（v3 实测出现过 3/32 截断）。
			return &relaymodel.GeneralOpenAIRequest{
				Model:     config.InferenceModelName,
				MaxTokens: recordingTaxonomyShadowMaxTokens,
				Messages: []relaymodel.Message{
					{Role: "system", Content: systemPrompt},
					{Role: "user", Content: userPrompt},
				},
			}
		},
	)
	row.DurationMs = time.Since(startedAt).Milliseconds()
	persistFailure := func(reason error) error {
		row.Status = secondBrainShadowStatusFailed
		row.ErrorMessage = truncateSecondBrainError(reason)
		if upsertErr := model.UpsertRecordingTaxonomyV2Shadow(ctx, row); upsertErr != nil {
			logger.Warnf(ctx, "【Taxonomy-Shadow】失败结果写入失败 fileID=%d variant=%s err=%v", fileID, profile.Variant, upsertErr)
		}
		return reason
	}
	if callErr != nil {
		return persistFailure(callErr)
	}
	parsed, parseErr := parseRecordingTaxonomyShadow(ctx, raw, profile)
	if parseErr != nil {
		return persistFailure(parseErr)
	}
	row.Status = secondBrainShadowStatusShadow
	row.SceneType = strings.TrimSpace(parsed.SceneType.Value)
	row.SceneConfidence = parsed.SceneType.Confidence
	row.SceneSubtype = strings.TrimSpace(parsed.SceneSubtype.Value)
	row.SceneSubtypeConfidence = parsed.SceneSubtype.Confidence
	row.ParticipationRole = strings.TrimSpace(parsed.ParticipationRole.Primary)
	if encoded, err := json.Marshal(normalizeRecordingTaxonomyV2Values(parsed.ParticipationRole.Secondary, profile.Roles, 3)); err == nil {
		if encoded, err := json.Marshal(parsed.AuthorityLevel); err == nil {
			row.AuthorityLevelJSON = model.LongText(encoded)
		}
		row.SecondaryRolesJSON = model.LongText(encoded)
	}
	if encoded, err := json.Marshal(parsed.IntentTags); err == nil {
		row.IntentTagsJSON = model.LongText(encoded)
	}
	if encoded, err := json.Marshal(parsed.DecisionTasks); err == nil {
		row.DecisionTasksJSON = model.LongText(encoded)
	}
	if encoded, err := json.Marshal(parsed.TopicTags); err == nil {
		row.TopicTagsJSON = model.LongText(encoded)
	}
	if encoded, err := json.Marshal(parsed.EntityLinks); err == nil {
		row.EntityLinksJSON = model.LongText(encoded)
	}
	if encoded, err := json.Marshal(map[string]string{"alternative_scene": parsed.Ambiguity.AlternativeScene, "reason": parsed.Ambiguity.Reason}); err == nil {
		row.AmbiguityJSON = model.LongText(encoded)
	}
	if encoded, err := json.Marshal(parsed); err == nil {
		row.ResultJSON = model.LongText(encoded)
	}
	if upsertErr := model.UpsertRecordingTaxonomyV2Shadow(ctx, row); upsertErr != nil {
		return fmt.Errorf("persist taxonomy shadow: %w", upsertErr)
	}
	logger.Infof(ctx, "【Taxonomy-Shadow】生成成功 fileID=%d variant=%s scene=%s/%s role=%s intents=%d tasks=%d elapsed_ms=%d",
		fileID, profile.Variant, row.SceneType, row.SceneSubtype, row.ParticipationRole, len(parsed.IntentTags), len(parsed.DecisionTasks), row.DurationMs)
	return nil
}

// RunRecordingTaxonomyV2Shadow 是 v1（Phase 4A）入口，保持兼容。
func RunRecordingTaxonomyV2Shadow(ctx context.Context, eid, userID, fileID int64) error {
	return RunRecordingTaxonomyShadow(ctx, eid, userID, fileID, RecordingTaxonomyShadowVariantV1)
}

// LoadRecordingTaxonomyShadowView 读取并展开指定 variant 的 Taxonomy Shadow。
func LoadRecordingTaxonomyShadowView(ctx context.Context, eid, fileID, generation int64, variant string) (*RecordingTaxonomyV2View, error) {
	row, err := model.GetRecordingTaxonomyV2Shadow(ctx, eid, fileID, generation, variant)
	if err != nil || row == nil {
		return nil, err
	}
	view := &RecordingTaxonomyV2View{
		FileID: fileID, InsightGeneration: row.InsightGeneration,
		Variant: row.Variant, PromptVersion: row.PromptVersion,
		SceneType: row.SceneType, SceneConfidence: row.SceneConfidence,
		SceneSubtype: row.SceneSubtype, SubtypeConfidence: row.SceneSubtypeConfidence,
		ParticipationRole: row.ParticipationRole,
		ModelName:         row.ModelName, PromptHash: row.PromptHash,
		Status: row.Status, ErrorMessage: row.ErrorMessage, DurationMs: row.DurationMs,
	}
	var authority struct {
		Value      string   `json:"value"`
		Confidence float64  `json:"confidence"`
		Evidence   []string `json:"evidence"`
	}
	if json.Unmarshal([]byte(row.AuthorityLevelJSON), &authority) == nil {
		view.AuthorityLevel = authority.Value
		view.AuthorityConfidence = authority.Confidence
	}
	_ = json.Unmarshal([]byte(row.SecondaryRolesJSON), &view.SecondaryRoles)
	_ = json.Unmarshal([]byte(row.IntentTagsJSON), &view.IntentTags)
	_ = json.Unmarshal([]byte(row.DecisionTasksJSON), &view.DecisionTasks)
	_ = json.Unmarshal([]byte(row.TopicTagsJSON), &view.TopicTags)
	var links []struct {
		Name string `json:"name"`
		Type string `json:"type"`
		Role string `json:"role"`
	}
	if json.Unmarshal([]byte(row.EntityLinksJSON), &links) == nil {
		for _, link := range links {
			if name := strings.TrimSpace(link.Name); name != "" {
				view.EntityLinks = append(view.EntityLinks, fmt.Sprintf("%s(%s/%s)", name, link.Type, link.Role))
			}
		}
	}
	ambiguity := map[string]string{}
	if json.Unmarshal([]byte(row.AmbiguityJSON), &ambiguity) == nil {
		for key, value := range ambiguity {
			if strings.TrimSpace(value) == "" {
				delete(ambiguity, key)
			}
		}
	}
	view.Ambiguity = ambiguity
	return view, nil
}

// LoadRecordingTaxonomyV2View 是 v1（Phase 4A）视图入口，保持兼容。
func LoadRecordingTaxonomyV2View(ctx context.Context, eid, fileID, generation int64) (*RecordingTaxonomyV2View, error) {
	return LoadRecordingTaxonomyShadowView(ctx, eid, fileID, generation, RecordingTaxonomyShadowVariantV1)
}

// ---------------------------------------------------------------------------
// Phase 4B：taxonomy-v2-shadow-2（边界校准版）。v1 提示词保持冻结，这里只新增 v2 文本与候选集合。
// ---------------------------------------------------------------------------

const recordingTaxonomyV2BSystemPrompt = `你是老板现场理解器。你的任务不是总结会议，而是判断“这是什么现场、用户在其中扮演什么角色、用户为什么参加、会后需要替他/她想清楚哪几件事”。

只输出一个 JSON 对象，不输出 Markdown、代码块或解释。

## 五个层次，不要混在一起

1. scene_type（现场类型，单选）：客观上这是什么现场。
2. scene_subtype（子类型，可选）：更细的现场形态，输出简短、稳定、可读的英文 snake_case 标签，例如 weekly_review、people_management、product_design、technical_sync、company_visit、product_launch、expert_share、alumni_welcome、entrepreneur_circle、first_interview、partnership_interview、course、workshop。它只用于记录，不决定后续路由。
3. participation_role（参与角色，主角色单选 + 可选次要角色）：优先输出“最能改变分析方式的具体角色”，只有没有更具体角色时才用 participant。
4. intent_tags（参与目的，多选 1–4 个）：用户为什么参加这次现场。判断的是“用户参加的目的”，不是“会议里谈到了什么”。
5. decision_tasks（判断任务，1–5 个）：会后需要替用户想清楚的具体问题。

## 候选值（只允许使用下列取值）

scene_type 候选：{{SCENE_TYPES}}
participation_role 候选：{{ROLES}}
intent_tags 候选：{{INTENTS}}

decision_tasks 的 task_type 使用下列粗粒度类型之一：evaluate_person / evaluate_opportunity / learning_transfer / relationship_followup / project_gate / decision_gate / risk_check / next_step_design。

## scene_type 的硬边界（先判断“现场”，再判断“议题”）

- internal_management：公司内部用于管理经营、人、资源、责任、优先级、政策或**一组事项**的会议（周例会、经营会、多客户项目盘点、团队管理、人员调整、资源分配、管理层决策）。判断要点：现场主要在“管理一组事情 / 一组人 / 一组经营事项”。不要因为讨论了某个客户就变成 customer_interaction；不要因为讨论了几个项目就自动变成 project_work。
- project_work：参与者围绕**一个明确的项目、产品、方案、交付物或技术问题**共同完成具体工作（产品设计讨论、项目工作会、技术方案评审、进度与问题解决、UI/UX 设计、交付方案共创、技术排障）。即使参与者全部来自公司内部，只要现场主要在共同推进同一个具体对象，也可以是 project_work。区别：internal_management 是“管理事情”，project_work 是“正在一起做这件事情”。
- customer_interaction：**客户本人或明确代表客户的一方实际参与本次现场**（客户拜访、客户需求会、客户汇报、客户谈判、售前交流、客户复盘、客诉沟通）。只是公司内部讨论客户时不属于这一类，应改用 internal_management / project_work 等；客户信息进入 topic_tags、entity_links、intent 与判断任务。
- business_cooperation：存在**实际外部合作方 / 潜在合作方现场参与**，核心是双方或多方探索资源交换、联合业务、渠道、生态、共同产品、合作模式。客户采购关系优先 customer_interaction，人才关系优先 talent_interaction。
- talent_interaction：招聘、复试、人才评估、合作人才沟通、候选人试用或合作方式判断。与 business_cooperation 冲突时：如果“这个人值不值得一起做事”仍是核心，选 talent_interaction；如果双方已脱离招聘关系、以两个业务主体讨论合作，选 business_cooperation。
- industry_event：客观现场是公开或半公开的发布会、企业参访、行业大会、行业分享、专家主题分享、产品发布、行业组织活动。用户可能带着学习、市场观察、合作、关系等多个目的；不要因为用户来学习就改成 learning_program。
- learning_program：只用于客观形式本身就是结构化学习项目的现场（正式课程、培训、工作坊、训练营、老师授课、连续课程体系）。有学习内容不等于 learning_program。
- network_social：客观现场主要以校友交流、企业家圈层、迎新、社群活动、聚会、联谊、资源交流为主要形式。活动里可以有演讲或学习内容，但如果“建立关系 / 认识人 / 圈层交流”是活动本身的重要结构，优先 network_social；不要因为主办方是“学堂”就自动判成 learning_program。
- advisory_conversation：小范围、非结构化、以专业判断为主的深度交流（老朋友找用户把关项目、用户担任技术顾问、专家与用户深聊某个问题、用户请专业人士帮助判断、定期顾问同步）。它不是正式项目工作会、不是客户售前、不是商业合作谈判、不是公开行业活动，角色上更接近 advisor / reviewer / gatekeeper。

## participation_role 优先级

优先写最能改变分析方式的具体角色（例如 recruiter、observer、advisor、reviewer、host、speaker、customer、seller、partner、learner、network_member）；participant 只在没有更具体角色时使用；decision_maker 通常作为次要角色，只有“最终拍板者”本身就是本场最关键身份时才作为主角色。

## decision_tasks 要求

每个任务都要能解释“它为什么会出现在这里”，并标注来源与证据强度：

- origin.type：intent（由已识别目的直接产生）/ explicit_unresolved（会议明确存在的未决事项）/ emergent_signal（用户未必带着这个目的进来，但会议过程中出现值得关注的新机会、风险或关系信号）/ historical_continuity（因历史会议、记忆或既有事项需要继续判断）。
- origin.ref：对应 intent 值、未决事项或信号的简短说明。
- evidence_strength：strong（当前会议明确提出 / 明确未决 / 与显式 intent 强关联）/ medium（多个会议事实共同支持）/ weak（单一外部案例或泛化推演）。
- 默认只输出 strong 与 medium；weak 只有在 origin.type 为 emergent_signal 且潜在价值很高时才保留，并降低 confidence。
- 不要提前替用户发明战略：不要把一场发布会、一个同行的做法、一个案例直接升级成“我方应调整战略 / 改变制度 / 抢占某定位”的强任务。

## 输出 JSON

{
  "scene_type": {"value": "", "confidence": 0.0, "evidence": ["material fact"]},
  "scene_subtype": {"value": "", "confidence": 0.0},
  "participation_role": {"primary": "", "secondary": [], "confidence": 0.0, "evidence": ["material fact"]},
  "intent_tags": [{"value": "", "confidence": 0.0, "evidence": ["material fact"]}],
  "decision_tasks": [{"task_type": "", "question": "", "why_it_matters": "", "priority": 1, "confidence": 0.0, "evidence": ["material fact"], "origin": {"type": "intent", "ref": ""}, "evidence_strength": "strong"}],
  "topic_tags": ["short topic"],
  "entity_links": [{"name": "", "type": "person|company|project|product|other", "role": "参与者|对方|提及"}],
  "ambiguity": {"alternative_scene": "", "reason": ""}
}

confidence 取 0–1；priority 从 1 开始且越小越重要。topic_tags 与 entity_links 各不超过 8 条。`

// recordingTaxonomyShadowProfile 描述一个 Shadow 变体使用的提示词与候选集合。
type recordingTaxonomyShadowProfile struct {
	Variant string
	Version string
	Prompt  string
	Scenes  []string
	Roles   []string
	Intents []string
}

func recordingTaxonomyShadowProfileFor(variant string) recordingTaxonomyShadowProfile {
	if strings.TrimSpace(variant) == RecordingTaxonomyShadowVariantV3Final {
		return recordingTaxonomyShadowProfile{
			Variant: RecordingTaxonomyShadowVariantV3Final,
			Version: recordingTaxonomyV2CFinalPromptVersion,
			Prompt:  recordingTaxonomyV2CSystemPrompt + "\n\n" + recordingTaxonomyV2CFinalHardRules,
			Scenes:  recordingTaxonomyV2BSceneTypes,
			Roles:   recordingTaxonomyV2CRoles,
			Intents: recordingTaxonomyV2BIntents,
		}
	}
	if strings.TrimSpace(variant) == RecordingTaxonomyShadowVariantV3 {
		return recordingTaxonomyShadowProfile{
			Variant: RecordingTaxonomyShadowVariantV3,
			Version: recordingTaxonomyV2CPromptVersion,
			Prompt:  recordingTaxonomyV2CSystemPrompt,
			Scenes:  recordingTaxonomyV2BSceneTypes,
			Roles:   recordingTaxonomyV2CRoles,
			Intents: recordingTaxonomyV2BIntents,
		}
	}
	if strings.TrimSpace(variant) == RecordingTaxonomyShadowVariantV2 {
		return recordingTaxonomyShadowProfile{
			Variant: RecordingTaxonomyShadowVariantV2,
			Version: recordingTaxonomyV2BPromptVersion,
			Prompt:  recordingTaxonomyV2BSystemPrompt,
			Scenes:  recordingTaxonomyV2BSceneTypes,
			Roles:   recordingTaxonomyV2Roles,
			Intents: recordingTaxonomyV2BIntents,
		}
	}
	return recordingTaxonomyShadowProfile{
		Variant: RecordingTaxonomyShadowVariantV1,
		Version: recordingTaxonomyV2PromptVersion,
		Prompt:  recordingTaxonomyV2SystemPrompt,
		Scenes:  recordingTaxonomyV2SceneTypes,
		Roles:   recordingTaxonomyV2Roles,
		Intents: recordingTaxonomyV2Intents,
	}
}

// buildRecordingTaxonomyShadowPrompt 把候选集合注入提示词模板。
func buildRecordingTaxonomyShadowPrompt(profile recordingTaxonomyShadowProfile) string {
	return strings.NewReplacer(
		"{{SCENE_TYPES}}", strings.Join(profile.Scenes, ", "),
		"{{ROLES}}", strings.Join(profile.Roles, ", "),
		"{{INTENTS}}", strings.Join(profile.Intents, ", "),
	).Replace(profile.Prompt)
}

// ---------------------------------------------------------------------------
// Phase 4C：taxonomy-v2-shadow-3（角色正交化 + Decision Task 相关性护栏）。
// v2 提示词逐字节冻结；v3 只新增文本与候选集合。
// ---------------------------------------------------------------------------

const recordingTaxonomyV2CPromptVersion = "taxonomy-v2-shadow-3"

// recordingTaxonomyShadowMaxTokens 是 Taxonomy Shadow 单次调用的输出上限。
const recordingTaxonomyShadowMaxTokens = 4096

const RecordingTaxonomyShadowVariantV3 = "taxonomy_shadow_v3"

// Phase 4C-FINAL：v3 的最小补强版（只增加 actor grounding 与硬不变量复述，不重设计结构）。
const RecordingTaxonomyShadowVariantV3Final = "taxonomy_shadow_v3_final"

const recordingTaxonomyV2CFinalPromptVersion = "taxonomy-v2-shadow-3-final"

// recordingTaxonomyV2CFinalHardRules 是 Freeze Gate 要求补强的硬不变量（追加在 v3 提示词之后）。
const recordingTaxonomyV2CFinalHardRules = `# Freeze Gate 硬不变量（必须遵守，不得用叙事推测替代）

1. customer_interaction：必须存在**当前现场的 buyer/seller 或 customer/supplier 关系证据**（客户本人/采购方实际参与，或报价、采购、签约等买卖行为）。以下**不能单独**成立：被定向邀请、对方是公司、用户对产品感兴趣、可能未来合作、对方介绍产品、双方有商业背景关系。若只有这些，改判 industry_event 或其它符合客观现场的类型。
2. business_cooperation：必须是两个业务主体在讨论“一起做什么”（联合产品、渠道、生态、联合交付、资源交换）；只要核心是买卖/采购/报价，就用 customer_interaction。
3. advisory_conversation：当前用户本人必须是 advice_seeker / advisor / reviewer / gatekeeper 之一；只是旁听他人被咨询、诊断或点评不成立。
4. learning_program：必须有真实结构化教学形态（讲师、学员、课程/培训/工作坊/训练营结构）；只有“有人分享知识”不成立。
5. network_social：活动客观结构必须以圈层/校友/聚会/迎新/资源交流/非正式关系建立为核心；有学习内容不等于 learning_program。

# 当前用户身份（actor grounding）

<current_user> 块给出的是当前用户的确定性身份（姓名、别名、公司、职务）。判断 participation_role 时必须先确认“当前用户在这次现场里是谁”：
- 如果纪要参与人里当前用户被标注为主讲人/讲师/老师：participation_role 用 speaker 或 host，而不是 learner/participant。
- 如果当前用户是卖方/服务提供方：用 seller；是被服务的客户方：用 customer。
- 如果无法用 <current_user> 与参与人信息确定身份：authority_level 用 unknown，role 用 participant 或 observer，禁止猜测具体身份。`

var (
	// v3：现场角色不再混入决策权限，decision_maker 被移出。
	recordingTaxonomyV2CRoles = []string{
		"host", "speaker", "observer", "advisor", "advice_seeker", "reviewer",
		"gatekeeper", "recruiter", "customer", "seller", "partner", "learner",
		"network_member", "participant",
	}
	// v3：决策权限独立成一个正交维度。
	recordingTaxonomyV2CAuthorityLevels = []string{
		"final_decider", "recommender", "executor", "observer", "unknown",
	}
	// v3：判断任务与“当前用户此刻”的相关性来源。
	recordingTaxonomyV2CRelevanceTypes = []string{
		"explicit_user_issue", "explicit_user_intent", "current_business_match",
		"historical_continuity", "external_analogy", "generic_inference",
	}
	recordingTaxonomyV2CTaskTiers = []string{"core", "secondary"}
)

const recordingTaxonomyV2CSystemPrompt = `你是老板现场理解器。你的任务不是总结会议，而是判断“这是什么现场、用户在其中扮演什么角色、对这件事有多大决定权、用户为什么参加、会后需要替他/她想清楚哪几件事”。

只输出一个 JSON 对象，不输出 Markdown、代码块或解释。

## 层次，不要混在一起

1. scene_type（现场类型，单选）：客观上这是什么现场。
2. scene_subtype（子类型，可选）：更细的现场形态，英文 snake_case 标签。
3. participation_role（现场角色，主角色 + 次要角色）：**我在这个现场以什么身份参与**。候选里没有 decision_maker。
4. authority_level（决策权限，单选）：**对这件事我有多大决定权**。它与现场角色正交，必须单独判断。
5. intent_tags（参与目的，多选 1–4 个）：用户为什么参加这次现场。
6. decision_tasks（判断任务，1–5 个）：会后需要替用户想清楚的具体问题；每条都要有证据强度、相关性来源与 tier。

## 候选值（只允许使用下列取值）

scene_type 候选：{{SCENE_TYPES}}
participation_role 候选：{{ROLES}}
authority_level 候选：final_decider, recommender, executor, observer, unknown
intent_tags 候选：{{INTENTS}}

decision_tasks 的 task_type 使用：evaluate_person / evaluate_opportunity / learning_transfer / relationship_followup / project_gate / decision_gate / risk_check / next_step_design。

## scene_type 的硬边界（先判断“现场”，再判断“议题”）

- internal_management：公司内部用于管理经营、人、资源、责任、优先级、政策或一组事项的会议。不要因为讨论了某个客户就变成 customer_interaction；不要因为讨论了几个项目就自动变成 project_work。
- project_work：参与者围绕一个明确的项目、产品、方案、交付物或技术问题共同完成具体工作。internal_management 是“管理事情”，project_work 是“正在一起做这件事情”。
- customer_interaction：**存在相对明确的 buyer/seller 或 customer/supplier 关系，且客户本人或明确代表客户的一方实际参与**（客户拜访、需求会、汇报、谈判、售前、复盘、客诉，以及采购方案与报价讨论）。只是公司内部讨论客户时不属于这一类。
- business_cooperation：存在实际外部合作方现场参与，双方主要在讨论**“一起做什么”**（联合产品、渠道、生态、联合交付、资源交换、战略合作），而不是**“谁买谁的东西”**。如果主要是采购/售卖关系，用 customer_interaction。
- talent_interaction：招聘、复试、人才评估、合作人才沟通、候选人试用或合作方式判断。
- industry_event：公开或半公开的发布会、企业参访、行业大会、行业分享、专家主题分享、产品发布、行业组织活动。用户可能带着学习、市场观察、合作、关系等多个目的。
- learning_program：客观形式本身就是**结构化教学项目**（正式课程、培训、工作坊、训练营、老师授课、连续课程体系，现场有讲师与学员结构）。有学习内容不等于 learning_program；普通主题分享、圈层活动、被专家点评都不属于。
- network_social：客观现场主要以校友交流、企业家圈层、迎新、社群活动、聚会、联谊、资源交流为主要形式。
- advisory_conversation：**当前用户本人必须是建议关系中的一方**（advice_seeker / advisor / reviewer / gatekeeper），并且现场是小范围、非结构化、以专业判断为主的深度交流（找用户把关项目、用户担任顾问、专家与用户深聊、请专业人士帮助判断、定期顾问同步）。**如果用户只是旁听别人被咨询、诊断或点评（例如旁观导师给第三方做诊断），不得判为 advisory_conversation**，应按客观活动形式选择 learning_program / network_social / industry_event 等。

## participation_role 与 authority_level

- 现场角色优先写最能改变分析方式的具体身份；没有更具体角色时才用 participant。
- 常见搭配（不是硬编码，但明显冲突时要重新判断）：industry_event → observer / speaker / participant（若写 learner，必须确认用户本人确实是明确的学习者身份，而不是因为 intent=learn）；network_social → network_member / host / participant；learning_program → learner / speaker / host；talent_interaction 中用户在招人时用 recruiter，而不是 reviewer；advisory_conversation 必须有 advice_seeker / advisor / reviewer / gatekeeper 之一。
- authority_level：final_decider=这件事由用户拍板；recommender=用户出建议、需他人拍板；executor=用户负责执行但不定方向；observer=用户在场但无决定权；无法判断用 unknown。

## decision_tasks：证据强度、相关性、tier（本阶段重点）

每个任务必须同时给出：

- evidence_strength：strong / medium / weak —— **只回答“材料有没有支持这件事”**。默认只输出 strong 与 medium；weak 仅当 origin 为 emergent_signal 且价值很高时保留并降低 confidence。
- relevance.type（**“为什么这个问题与当前用户现在有关”**）：
  - explicit_user_issue：用户本人明确提出正在处理 / 困惑 / 需要决策的问题（最高级）。
  - explicit_user_intent：与本场明确参与目的直接对应。
  - current_business_match：当前材料或已确认的公司上下文同时证明外部案例与用户真实业务存在同构关系（必须有双方证据）。
  - historical_continuity：已确认历史记忆中确实存在同一问题。
  - external_analogy：只有外部案例相似，尚无证据证明用户也存在同样问题。
  - generic_inference：仅因“企业通常可能有这个问题”而推断 —— **禁止输出这类任务**。
- relevance.confidence 与 relevance.evidence。
- origin{type,ref}：intent / explicit_unresolved / emergent_signal / historical_continuity。
- task_tier：core（最多 3 条）或 secondary（最多 2 条）。
  - core 必须同时满足：evidence_strength 为 strong 或 medium；relevance.type 不是 external_analogy / generic_inference；确实可能改变用户决策或下一步。
  - secondary 用于 emergent_signal、external_analogy 或较低置信的机会/风险信号。

**证据强度不等于相关性**：一个外部案例本身可以有 strong 证据（例如“某创业者因股权设计吃亏”），但这只说明案例真实，不代表用户当前也有同样问题。此情况下只能写 relevance.type=external_analogy，并把任务放在 secondary。

## 外部案例映射规则

当任务主要来自 external_analogy 时，禁止写成“我们是否应该建立 / 是否存在 / 必须 / 是否应该调整公司……”这类直接建议；只能写成先验证同构的形式，例如：
- “这个案例暴露的问题是否也存在于我们当前的情况，值得先核对哪些事实？”
- “这条经验是否适用于当前公司？需要先确认哪些前提？”

## 人的动机与人格不得作为已成立的任务

不允许把创业心态、忠诚度、责任感、长期意愿、价值观等作为已成立的判断任务或结论依据。可以问的是可验证的问题，例如“候选人当前可投入时间、合作预期与岗位要求是否匹配？”，而不是“候选人的创业心态是否符合期待？”。

## 输出 JSON

{
  "scene_type": {"value": "", "confidence": 0.0, "evidence": ["material fact"]},
  "scene_subtype": {"value": "", "confidence": 0.0},
  "participation_role": {"primary": "", "secondary": [], "confidence": 0.0, "evidence": ["material fact"]},
  "authority_level": {"value": "", "confidence": 0.0, "evidence": ["material fact"]},
  "intent_tags": [{"value": "", "confidence": 0.0, "evidence": ["material fact"]}],
  "decision_tasks": [{"task_type": "", "question": "", "why_it_matters": "", "priority": 1, "confidence": 0.0, "evidence": ["material fact"], "origin": {"type": "intent", "ref": ""}, "evidence_strength": "strong", "relevance": {"type": "explicit_user_intent", "confidence": 0.0, "evidence": []}, "task_tier": "core"}],
  "topic_tags": ["short topic"],
  "entity_links": [{"name": "", "type": "person|company|project|product|other", "role": "参与者|对方|提及"}],
  "ambiguity": {"alternative_scene": "", "reason": ""}
}

confidence 取 0–1；priority 从 1 开始且越小越重要。topic_tags 与 entity_links 各不超过 8 条。`
