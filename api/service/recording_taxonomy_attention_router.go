// Taxonomy V2 Attention Router（Phase 5A）。
//
// 把冻结的 Taxonomy V2 结果（taxonomy_shadow_v3_final）转换为 Second Brain V2.1 的注意力提示。
// Router 只提醒“还有哪些值得检查的目的和判断问题”，不是事实来源；V2.1 必须回到原始会议证据重新验证。

package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/53AI/53AIHub/model"
)

// RecordingTaxonomyAttentionQuestion 是进入 Attention Router 的单个候选问题。
// 只携带 question / why_it_matters / relevance_type / evidence_strength / confidence；
// 不携带长 evidence/reasoning，防止 Taxonomy 推断被当成事实注入。
type RecordingTaxonomyAttentionQuestion struct {
	Question         string  `json:"question"`
	WhyItMatters     string  `json:"why_it_matters"`
	RelevanceType    string  `json:"relevance_type"`
	EvidenceStrength string  `json:"evidence_strength"`
	Confidence       float64 `json:"confidence"`
}

// RecordingTaxonomyAttentionIntent 是进入 Router 的参与目的。
type RecordingTaxonomyAttentionIntent struct {
	Value      string  `json:"value"`
	Confidence float64 `json:"confidence"`
}

// RecordingTaxonomyAttentionRouter 是冻结 Taxonomy 到 Second Brain 的注意力提示包。
type RecordingTaxonomyAttentionRouter struct {
	TaxonomyVersion     string `json:"taxonomy_version"`
	TaxonomyResultHash  string `json:"taxonomy_result_hash"`
	AttentionRouterHash string `json:"attention_router_hash"`
	ActorRouterSafe     bool   `json:"actor_router_safe"`

	SceneType    string `json:"scene_type"`
	SceneSubtype string `json:"scene_subtype"`

	UserRole struct {
		Role      string `json:"role"`
		Authority string `json:"authority"`
		Grounded  bool   `json:"grounded"`
	} `json:"user_role"`

	Intents   []RecordingTaxonomyAttentionIntent   `json:"intents"`
	Questions []RecordingTaxonomyAttentionQuestion `json:"candidate_attention_questions"`

	// AttentionRouterText 是可以直接追加到 System Prompt 的完整独立块。
	AttentionRouterText string `json:"-"`
}

const (
	// RecordingTaxonomyAttentionRouterPreamble 是 Attention Router 的纪律声明。
	// 必须出现在 <attention_router> 块之前，明确 Router 不是事实来源。
	RecordingTaxonomyAttentionRouterPreamble = `以下信息来自 Taxonomy Attention Router。

它不是事实来源，也不是已经成立的判断。

你必须重新根据会议纪要、转写、历史、认知和记忆验证每一项。

如果某个 intent 或 decision task：
- 与当前用户无关；
- 缺少会议证据；
- 不值得影响当前判断；
- 与 Evidence Guardrail 冲突；

请直接忽略。

不得为了覆盖 Taxonomy 而强行增加输出内容。Evidence Guardrail 永远优先。`

	recordingTaxonomyAttentionRouterMaxQuestions = 3
	recordingTaxonomyAttentionRouterMaxIntents   = 4
)

// BuildRecordingTaxonomyAttentionRouter 从冻结的 Taxonomy V2 结果构造 Attention Router。
// 优先读取 taxonomy_shadow_v3_final；缺失时回退到 taxonomy_shadow_v3（Phase 5A 允许的安全回退）。
func BuildRecordingTaxonomyAttentionRouter(ctx context.Context, eid, userID, fileID, generation int64) (*RecordingTaxonomyAttentionRouter, error) {
	row, err := model.GetRecordingTaxonomyV2Shadow(ctx, eid, fileID, generation, RecordingTaxonomyShadowVariantV3Final)
	if err != nil {
		return nil, fmt.Errorf("读取 taxonomy shadow: %w", err)
	}
	variant := RecordingTaxonomyShadowVariantV3Final
	if row == nil {
		row, err = model.GetRecordingTaxonomyV2Shadow(ctx, eid, fileID, generation, RecordingTaxonomyShadowVariantV3)
		if err != nil {
			return nil, fmt.Errorf("读取 taxonomy shadow v3: %w", err)
		}
		variant = RecordingTaxonomyShadowVariantV3
	}
	if row == nil {
		return nil, fmt.Errorf("未找到 fileID=%d generation=%d 的 Taxonomy V3/Final 结果", fileID, generation)
	}

	view, err := LoadRecordingTaxonomyShadowView(ctx, eid, fileID, generation, variant)
	if err != nil {
		return nil, fmt.Errorf("展开 taxonomy view: %w", err)
	}

	var rawResult recordingTaxonomyV2Result
	_ = json.Unmarshal([]byte(row.ResultJSON), &rawResult)

	router := &RecordingTaxonomyAttentionRouter{
		TaxonomyVersion:    variant,
		TaxonomyResultHash: taxonomyResultHash(row),
		SceneType:          view.SceneType,
		SceneSubtype:       view.SceneSubtype,
	}

	// Actor grounding：只有确定性匹配或 role evidence 明确指向 current_user 时才输入具体 role。
	current := BuildRecordingTaxonomyCurrentUser(ctx, eid, userID, fileID)
	participants := RecordingTaxonomyParticipants(fileID)
	found, participantRole, _ := RecordingTaxonomyActorGrounding(current, participants)

	taxonomyRole := view.ParticipationRole
	if taxonomyRole == "" {
		taxonomyRole = "participant"
	}

	roleEvidenceGrounded := roleEvidencePointsToCurrentUser(rawResult.ParticipationRole.Evidence, current)

	if found {
		router.UserRole.Role = participantRole
		router.UserRole.Authority = view.AuthorityLevel
		router.UserRole.Grounded = true
		router.ActorRouterSafe = true
	} else if roleEvidenceGrounded {
		router.UserRole.Role = taxonomyRole
		router.UserRole.Authority = view.AuthorityLevel
		router.UserRole.Grounded = true
		router.ActorRouterSafe = true
	} else {
		// 不猜测具体身份：role 省略，authority 标记 unknown。
		router.UserRole.Role = "omitted"
		router.UserRole.Authority = "unknown"
		router.UserRole.Grounded = false
		// 安全条件：没有把低置信度 taxonomy role 当成事实注入，即为 safe。
		router.ActorRouterSafe = true
	}

	// 参与目的：最多 4 个，保持冻结结果。
	for i, tag := range view.IntentTags {
		if i >= recordingTaxonomyAttentionRouterMaxIntents {
			break
		}
		if strings.TrimSpace(tag.Value) == "" {
			continue
		}
		router.Intents = append(router.Intents, RecordingTaxonomyAttentionIntent{
			Value:      tag.Value,
			Confidence: tag.Confidence,
		})
	}

	// 判断任务：只取 integration_eligible=true，最多 3 个，按 priority / confidence / relevance 排序。
	eligible := filterEligibleTasks(view.DecisionTasks)
	sortEligibleTasks(eligible)
	for i, task := range eligible {
		if i >= recordingTaxonomyAttentionRouterMaxQuestions {
			break
		}
		q := RecordingTaxonomyAttentionQuestion{
			Question:         strings.TrimSpace(task.Question),
			WhyItMatters:     shortenWhyItMatters(task.WhyItMatters),
			RelevanceType:    task.Relevance.Type,
			EvidenceStrength: task.EvidenceStrength,
			Confidence:       task.Confidence,
		}
		if q.Question == "" {
			continue
		}
		router.Questions = append(router.Questions, q)
	}

	router.AttentionRouterText = renderAttentionRouterText(router)
	router.AttentionRouterHash = secondBrainHash(router.AttentionRouterText)
	return router, nil
}

// filterEligibleTasks 只保留 integration_eligible=true 的任务。
func filterEligibleTasks(tasks []recordingTaxonomyV2TaskView) []recordingTaxonomyV2TaskView {
	var out []recordingTaxonomyV2TaskView
	for _, task := range tasks {
		if RecordingTaxonomyIntegrationEligibility(task) {
			out = append(out, task)
		}
	}
	return out
}

// sortEligibleTasks 按 priority 升序、confidence 降序、relevance 优先级排序。
func sortEligibleTasks(tasks []recordingTaxonomyV2TaskView) {
	relevanceOrder := map[string]int{
		"explicit_user_issue":    0,
		"explicit_user_intent":   1,
		"current_business_match": 2,
		"historical_continuity":  3,
	}
	sort.SliceStable(tasks, func(i, j int) bool {
		if tasks[i].Priority != tasks[j].Priority {
			return tasks[i].Priority < tasks[j].Priority
		}
		if tasks[i].Confidence != tasks[j].Confidence {
			return tasks[i].Confidence > tasks[j].Confidence
		}
		return relevanceOrder[tasks[i].Relevance.Type] < relevanceOrder[tasks[j].Relevance.Type]
	})
}

// shortenWhyItMatters 把 why_it_matters 截短，禁止把长 reasoning 当事实注入。
func shortenWhyItMatters(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	// 保留第一句，最多 120 字。
	if idx := strings.IndexAny(value, "。；.;\n"); idx > 0 && idx < 120 {
		value = value[:idx+1]
	}
	runes := []rune(value)
	if len(runes) > 120 {
		return string(runes[:120]) + "…"
	}
	return value
}

// roleEvidencePointsToCurrentUser 检查 role evidence 文本是否明确包含当前用户标识。
func roleEvidencePointsToCurrentUser(evidence []string, current RecordingTaxonomyCurrentUser) bool {
	identifiers := append([]string{}, current.Aliases...)
	if current.Name != "" {
		identifiers = append(identifiers, current.Name)
	}
	if current.Position != "" {
		identifiers = append(identifiers, current.Position)
	}
	if len(identifiers) == 0 || len(evidence) == 0 {
		return false
	}
	joined := strings.ToLower(strings.Join(evidence, "；"))
	for _, id := range identifiers {
		if strings.Contains(joined, strings.ToLower(id)) {
			return true
		}
	}
	return false
}

// isSpecificTaxonomyRole 判断 taxonomy role 是否是具体身份（非通用安全角色）。
func isSpecificTaxonomyRole(role string) bool {
	switch role {
	case "participant", "observer", "unknown", "omitted", "":
		return false
	}
	return true
}

// renderAttentionRouterText 渲染完整的 <attention_router> 块（含前置纪律声明）。
func renderAttentionRouterText(router *RecordingTaxonomyAttentionRouter) string {
	payload := map[string]interface{}{
		"taxonomy_version": router.TaxonomyVersion,
		"scene": map[string]string{
			"type":    router.SceneType,
			"subtype": router.SceneSubtype,
		},
		"user_role": map[string]interface{}{
			"role":      router.UserRole.Role,
			"authority": router.UserRole.Authority,
			"grounded":  router.UserRole.Grounded,
		},
		"intents":                       router.Intents,
		"candidate_attention_questions": router.Questions,
	}
	encoded, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		encoded = []byte("{}")
	}
	return RecordingTaxonomyAttentionRouterPreamble + "\n\n<attention_router>\n" + string(encoded) + "\n</attention_router>"
}

// taxonomyResultHash 计算冻结 Taxonomy 结果 JSON 的 SHA256 指纹。
func taxonomyResultHash(row *model.RecordingTaxonomyV2Shadow) string {
	if row == nil {
		return ""
	}
	sum := sha256.Sum256([]byte(row.ResultJSON))
	return hex.EncodeToString(sum[:])
}

// RecordingTaxonomyAttentionRouterForComparison 返回用于注入 Second Brain System Prompt 的文本与元信息。
func RecordingTaxonomyAttentionRouterForComparison(ctx context.Context, eid, userID, fileID, generation int64) (text string, hash string, taxonomyVersion string, taxonomyResultHash string, actorRouterSafe bool, err error) {
	router, err := BuildRecordingTaxonomyAttentionRouter(ctx, eid, userID, fileID, generation)
	if err != nil {
		return "", "", "", "", false, err
	}
	return router.AttentionRouterText, router.AttentionRouterHash, router.TaxonomyVersion, router.TaxonomyResultHash, router.ActorRouterSafe, nil
}

// RecordingTaxonomyMinimalContext 是 Phase 5B 的 Minimal Taxonomy Context。
// 只携带 scene_type / scene_subtype / intent_tags + contract；不携带 role/authority/tasks/why_it_matters/relevance/evidence/tier。
type RecordingTaxonomyMinimalContext struct {
	TaxonomyVersion    string   `json:"taxonomy_version"`
	SceneType          string   `json:"scene_type"`
	SceneSubtype       string   `json:"scene_subtype"`
	IntentTags         []string `json:"intent_tags"`
	MinimalContextText string   `json:"-"`
	MinimalContextHash string   `json:"minimal_context_hash"`
	TaxonomyResultHash string   `json:"taxonomy_result_hash"`
}

const recordingTaxonomyMinimalContextPreamble = `以下信息来自 Taxonomy Minimal Context。

它只是对现场类型与用户参与目的的粗粒度提示，不是事实，也不是必须覆盖的分析目录。

请你仍然以原始会议纪要、转写、历史、认知和记忆为准，自主决定真正值得用户关注的问题。

如果某个标签没有足够证据支持，可以忽略。

不要为了覆盖标签而增加内容。`

// BuildRecordingTaxonomyMinimalContext 构造 Phase 5B 的 Minimal Context。
func BuildRecordingTaxonomyMinimalContext(ctx context.Context, eid, userID, fileID, generation int64) (*RecordingTaxonomyMinimalContext, error) {
	row, err := model.GetRecordingTaxonomyV2Shadow(ctx, eid, fileID, generation, RecordingTaxonomyShadowVariantV3Final)
	if err != nil {
		return nil, fmt.Errorf("读取 taxonomy shadow: %w", err)
	}
	variant := RecordingTaxonomyShadowVariantV3Final
	if row == nil {
		row, err = model.GetRecordingTaxonomyV2Shadow(ctx, eid, fileID, generation, RecordingTaxonomyShadowVariantV3)
		if err != nil {
			return nil, fmt.Errorf("读取 taxonomy shadow v3: %w", err)
		}
		variant = RecordingTaxonomyShadowVariantV3
	}
	if row == nil {
		return nil, fmt.Errorf("未找到 fileID=%d generation=%d 的 Taxonomy V3/Final 结果", fileID, generation)
	}

	view, err := LoadRecordingTaxonomyShadowView(ctx, eid, fileID, generation, variant)
	if err != nil {
		return nil, fmt.Errorf("展开 taxonomy view: %w", err)
	}

	mc := &RecordingTaxonomyMinimalContext{
		TaxonomyVersion:    variant,
		TaxonomyResultHash: taxonomyResultHash(row),
		SceneType:          view.SceneType,
		SceneSubtype:       view.SceneSubtype,
	}
	for i, tag := range view.IntentTags {
		if i >= recordingTaxonomyAttentionRouterMaxIntents {
			break
		}
		if value := strings.TrimSpace(tag.Value); value != "" {
			mc.IntentTags = append(mc.IntentTags, value)
		}
	}
	mc.MinimalContextText = renderMinimalContextText(mc)
	mc.MinimalContextHash = secondBrainHash(mc.MinimalContextText)
	return mc, nil
}

func renderMinimalContextText(mc *RecordingTaxonomyMinimalContext) string {
	payload := map[string]interface{}{
		"taxonomy_version": mc.TaxonomyVersion,
		"scene_type":       mc.SceneType,
		"scene_subtype":    mc.SceneSubtype,
		"intent_tags":      mc.IntentTags,
	}
	encoded, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		encoded = []byte("{}")
	}
	return recordingTaxonomyMinimalContextPreamble + "\n\n<minimal_taxonomy_context>\n" + string(encoded) + "\n</minimal_taxonomy_context>"
}

// RecordingTaxonomyMinimalContextForComparison 返回用于注入 Second Brain System Prompt 的 Minimal Context 文本与元信息。
func RecordingTaxonomyMinimalContextForComparison(ctx context.Context, eid, userID, fileID, generation int64) (text string, hash string, taxonomyVersion string, taxonomyResultHash string, err error) {
	mc, err := BuildRecordingTaxonomyMinimalContext(ctx, eid, userID, fileID, generation)
	if err != nil {
		return "", "", "", "", err
	}
	return mc.MinimalContextText, mc.MinimalContextHash, mc.TaxonomyVersion, mc.TaxonomyResultHash, nil
}

const recordingTaxonomyGuardedMinimalContextPreamble = `以下 scene / intent 标签只是 Attention Hypothesis。

它们用于提醒你检查某些可能值得关注的方向，不是用户真实意图已经成立的证据，也不是该方向一定重要的证明。

特别注意：

1. 不得因为某个 intent 标签存在，就提高相关结论的置信度。
2. 不得因为某个 intent 标签存在，就把一个弱信号升级为：风险已经存在、机会值得推进、战略需要调整、用户应该采取行动。
3. intent 标签不能增加判断强度、紧迫程度、行动优先级、风险严重度。
4. 每个重要判断仍必须完全由原始会议证据、历史、认知和记忆支持。
5. 如果原始材料没有支持某个 intent：直接忽略该标签。
6. 如果原始材料本身已经足够支持某个判断：按 Evidence Guardrail 正常判断。

这些标签只能改变“你检查什么”，不能改变“你相信什么”。

不要为了覆盖标签增加章节或内容。

Taxonomy 可以改变注意力，不允许改变证据权重。`

// BuildRecordingTaxonomyGuardedMinimalContext 构造 Phase 5C 的 Guarded Minimal Context。
// payload 与 Phase 5B Minimal 完全一致，仅前置 contract 替换为 Anti-Anchoring Contract。
func BuildRecordingTaxonomyGuardedMinimalContext(ctx context.Context, eid, userID, fileID, generation int64) (*RecordingTaxonomyMinimalContext, error) {
	mc, err := BuildRecordingTaxonomyMinimalContext(ctx, eid, userID, fileID, generation)
	if err != nil {
		return nil, err
	}
	mc.MinimalContextText = recordingTaxonomyGuardedMinimalContextPreamble + "\n\n<guarded_minimal_taxonomy_context>\n" + extractMinimalContextJSON(mc.MinimalContextText) + "\n</guarded_minimal_taxonomy_context>"
	mc.MinimalContextHash = secondBrainHash(mc.MinimalContextText)
	return mc, nil
}

// extractMinimalContextJSON 从已渲染的 Minimal Context 文本中提取 <minimal_taxonomy_context> 块内的 JSON。
func extractMinimalContextJSON(text string) string {
	start := strings.Index(text, "<minimal_taxonomy_context>")
	end := strings.Index(text, "</minimal_taxonomy_context>")
	if start == -1 || end == -1 || end <= start {
		return "{}"
	}
	return strings.TrimSpace(text[start+len("<minimal_taxonomy_context>") : end])
}

// RecordingTaxonomyGuardedMinimalContextForComparison 返回用于注入 Second Brain System Prompt 的 Guarded Minimal Context 文本与元信息。
func RecordingTaxonomyGuardedMinimalContextForComparison(ctx context.Context, eid, userID, fileID, generation int64) (text string, hash string, taxonomyVersion string, taxonomyResultHash string, err error) {
	mc, err := BuildRecordingTaxonomyGuardedMinimalContext(ctx, eid, userID, fileID, generation)
	if err != nil {
		return "", "", "", "", err
	}
	return mc.MinimalContextText, mc.MinimalContextHash, mc.TaxonomyVersion, mc.TaxonomyResultHash, nil
}
