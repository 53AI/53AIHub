package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/53AI/53AIHub/model"
)

// Taxonomy V2 Phase 4C-FINAL：Freeze Gate 的纯审计层。
// 全部结论由程序从评测数据计算，禁止手工描述；此处不调用任何模型。

const (
	RecordingTaxonomyIntegrationEligibleKey = "integration_eligible"
)

// RecordingTaxonomyFreezeFinding 是一条审计结论。
type RecordingTaxonomyFreezeFinding struct {
	Rule     string `json:"rule"`
	Case     string `json:"case"`
	Pass     bool   `json:"pass"`
	Evidence string `json:"evidence"`
	Reason   string `json:"reason"`
}

// RecordingTaxonomyCurrentUser 是 actor grounding 用的确定性身份信息。
type RecordingTaxonomyCurrentUser struct {
	UserID   int64    `json:"user_id"`
	Name     string   `json:"name"`
	Aliases  []string `json:"aliases"`
	Company  string   `json:"company"`
	Position string   `json:"position"`
}

// BuildRecordingTaxonomyCurrentUser 从个人信息与企业信息构造当前用户身份块（确定性，不猜测）。
func BuildRecordingTaxonomyCurrentUser(ctx context.Context, eid, userID, fileID int64) RecordingTaxonomyCurrentUser {
	personal := loadInsightPersonalContext(ctx, eid, userID, fileID)
	current := RecordingTaxonomyCurrentUser{UserID: userID, Position: strings.TrimSpace(personal.Position)}
	if personal.User != nil {
		current.Name = strings.TrimSpace(personal.User.Nickname)
		for _, department := range personal.User.Departments {
			if name := strings.TrimSpace(department.Name); name != "" {
				current.Aliases = appendUniqueStrings(current.Aliases, name+"负责人")
			}
		}
	}
	if enterprise, err := model.GetEnterpriseByID(eid); err == nil && enterprise != nil {
		current.Company = strings.TrimSpace(enterprise.DisplayName)
		if current.Company == "" {
			current.Company = strings.TrimSpace(enterprise.FullName)
		}
	}
	if current.Name != "" {
		current.Aliases = appendUniqueStrings(current.Aliases, current.Name)
	}
	return current
}

// recordingTaxonomyCurrentUserBlock 是注入提示词的确定性身份块。
func recordingTaxonomyCurrentUserBlock(current RecordingTaxonomyCurrentUser) string {
	payload := map[string]interface{}{
		"name":    current.Name,
		"aliases": current.Aliases,
		"company": current.Company,
		"title":   current.Position,
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return ""
	}
	return "<current_user>\n" + string(encoded) + "\n</current_user>\n"
}

// RecordingTaxonomySceneInvariant 是 scene 硬不变量的确定性判定结果。
type RecordingTaxonomySceneInvariant struct {
	Scene    string `json:"scene"`
	Pass     bool   `json:"pass"`
	Reason   string `json:"reason"`
	Evidence string `json:"evidence"`
}

// EvaluateRecordingTaxonomySceneInvariant 对单条 scene 判定做硬不变量检查。
// 判定只依赖模型给出的 evidence 文本与 scene 选择本身，模式固定、可复现。
func EvaluateRecordingTaxonomySceneInvariant(sceneType string, evidence []string) RecordingTaxonomySceneInvariant {
	joined := strings.ToLower(strings.Join(evidence, "；"))
	has := func(keywords ...string) bool {
		for _, keyword := range keywords {
			if strings.Contains(joined, strings.ToLower(keyword)) {
				return true
			}
		}
		return false
	}
	result := RecordingTaxonomySceneInvariant{Scene: sceneType, Evidence: strings.Join(evidence, "；"), Pass: true}
	switch sceneType {
	case "customer_interaction":
		// 必须出现 buyer/seller 或 customer/supplier 关系证据。
		strong := has("客户方", "采购方", "甲方", "buyer", "客户本人", "供应商", "销售方", "报价", "采购", "签约")
		weakOnly := !strong && has("受邀", "邀请", "感兴趣", "潜在客户", "未来合作", "介绍产品", "背景关系")
		if !strong {
			result.Pass = false
			if weakOnly {
				result.Reason = "customer_interaction 缺少 buyer/seller 或 customer/supplier 关系证据（仅定向受邀/感兴趣/产品介绍不足以成立）"
			} else {
				result.Reason = "customer_interaction 缺少客户或采购方实际参与的关系证据"
			}
		}
	case "business_cooperation":
		if !has("合作", "联合", "渠道", "生态", "资源交换", "一起", "共同") {
			result.Pass = false
			result.Reason = "business_cooperation 缺少“一起做什么”的合作证据"
		}
	case "advisory_conversation":
		if !has("顾问", "把关", "诊断", "咨询", "建议", "请教", "评审", "用户本人") {
			result.Pass = false
			result.Reason = "advisory_conversation 缺少“当前用户本人是建议关系一方”的证据"
		}
	case "learning_program":
		if !has("讲师", "老师", "学员", "课程", "培训", "工作坊", "训练营", "班") {
			result.Pass = false
			result.Reason = "learning_program 缺少结构化教学形态证据（讲师/学员/课程结构）"
		}
	case "network_social":
		if !has("校友", "圈层", "迎新", "社群", "聚会", "联谊", "资源交流", "企业家", "非正式", "关系维系", "闲聊", "社交", "同行") {
			result.Pass = false
			result.Reason = "network_social 缺少圈层/社交活动结构证据"
		}
	}
	return result
}

// RecordingTaxonomyRoleConsistency 检查 role / authority 与预期是否一致。
type RecordingTaxonomyRoleConsistency struct {
	Case          string   `json:"case"`
	Role          string   `json:"role"`
	Authority     string   `json:"authority"`
	ExpectedRoles []string `json:"expected_roles"`
	Pass          bool     `json:"pass"`
	Reason        string   `json:"reason"`
}

// EvaluateRecordingTaxonomyRoleConsistency 是纯函数形式的角色一致性检查。
func EvaluateRecordingTaxonomyRoleConsistency(caseID, role, authority string, expected []string) RecordingTaxonomyRoleConsistency {
	result := RecordingTaxonomyRoleConsistency{Case: caseID, Role: role, Authority: authority, ExpectedRoles: expected}
	for _, allowed := range expected {
		if role == allowed {
			result.Pass = true
			return result
		}
	}
	result.Reason = fmt.Sprintf("participation_role=%s 不在期望集合 %s 内", role, strings.Join(expected, "/"))
	return result
}

// RecordingTaxonomyIntegrationEligibility 是下一阶段接线用的确定性字段。
func RecordingTaxonomyIntegrationEligibility(task recordingTaxonomyV2TaskView) bool {
	if task.TaskTier != recordingTaxonomyTaskTierCore {
		return false
	}
	switch task.Relevance.Type {
	case "explicit_user_issue", "explicit_user_intent", "current_business_match", "historical_continuity":
	default:
		return false
	}
	return task.EvidenceStrength == "strong" || task.EvidenceStrength == "medium"
}

// RecordingTaxonomyFreezeSummary 是机器生成的冻结统计（禁止手工描述）。
type RecordingTaxonomyFreezeSummary struct {
	CaseCount             int                              `json:"case_count"`
	Variant               string                           `json:"variant"`
	SceneDistribution     map[string]int                   `json:"scene_distribution"`
	RoleDistribution      map[string]int                   `json:"role_distribution"`
	AuthorityDistribution map[string]int                   `json:"authority_distribution"`
	TaskCount             int                              `json:"task_count"`
	TierDistribution      map[string]int                   `json:"tier_distribution"`
	RelevanceDistribution map[string]int                   `json:"relevance_distribution"`
	EvidenceDistribution  map[string]int                   `json:"evidence_distribution"`
	IntegrationEligible   int                              `json:"integration_eligible_tasks"`
	SceneMembership       map[string][]string              `json:"scene_membership"`
	Findings              []RecordingTaxonomyFreezeFinding `json:"findings"`
	PassedFindings        int                              `json:"passed_findings"`
	FailedFindings        int                              `json:"failed_findings"`
}

// BuildRecordingTaxonomyFreezeSummary 从评测视图计算冻结统计与全部审计结论。
func BuildRecordingTaxonomyFreezeSummary(cases []RecordingTaxonomyFreezeCase) *RecordingTaxonomyFreezeSummary {
	summary := &RecordingTaxonomyFreezeSummary{
		CaseCount: len(cases), Variant: RecordingTaxonomyShadowVariantV3,
		SceneDistribution: map[string]int{}, RoleDistribution: map[string]int{}, AuthorityDistribution: map[string]int{},
		TierDistribution: map[string]int{}, RelevanceDistribution: map[string]int{}, EvidenceDistribution: map[string]int{},
		SceneMembership: map[string][]string{},
	}
	for _, item := range cases {
		view := item.View
		if view == nil {
			summary.Findings = append(summary.Findings, RecordingTaxonomyFreezeFinding{Rule: "view_present", Case: item.CaseID, Pass: false, Reason: "缺少 taxonomy_shadow_v3 结果"})
			continue
		}
		summary.SceneDistribution[view.SceneType]++
		summary.RoleDistribution[view.ParticipationRole]++
		summary.AuthorityDistribution[view.AuthorityLevel]++
		summary.SceneMembership[view.SceneType] = append(summary.SceneMembership[view.SceneType], item.CaseID)
		invariant := EvaluateRecordingTaxonomySceneInvariant(view.SceneType, item.SceneEvidence)
		summary.Findings = append(summary.Findings, RecordingTaxonomyFreezeFinding{
			Rule: "scene_invariant:" + view.SceneType, Case: item.CaseID, Pass: invariant.Pass,
			Evidence: invariant.Evidence, Reason: invariant.Reason,
		})
		if roleCase, ok := item.ExpectedRoles[item.CaseID]; ok {
			consistency := EvaluateRecordingTaxonomyRoleConsistency(item.CaseID, view.ParticipationRole, view.AuthorityLevel, roleCase)
			summary.Findings = append(summary.Findings, RecordingTaxonomyFreezeFinding{
				Rule: "role_consistency", Case: item.CaseID, Pass: consistency.Pass, Reason: consistency.Reason,
			})
		}
		for _, task := range view.DecisionTasks {
			summary.TaskCount++
			summary.TierDistribution[task.TaskTier]++
			summary.RelevanceDistribution[task.Relevance.Type]++
			summary.EvidenceDistribution[task.EvidenceStrength]++
			if RecordingTaxonomyIntegrationEligibility(task) {
				summary.IntegrationEligible++
			}
			if task.Relevance.Type == recordingTaxonomyRelevanceGenericInference {
				summary.Findings = append(summary.Findings, RecordingTaxonomyFreezeFinding{Rule: "task_relevance_guardrail", Case: item.CaseID, Pass: false, Reason: "generic_inference 任务未被拦截"})
			}
			if task.TaskTier == recordingTaxonomyTaskTierCore && (task.Relevance.Type == recordingTaxonomyRelevanceExternalAnalogy || task.EvidenceStrength == "weak") {
				summary.Findings = append(summary.Findings, RecordingTaxonomyFreezeFinding{Rule: "core_tier_guardrail", Case: item.CaseID, Pass: false, Reason: "external_analogy/weak 不得进入 core"})
			}
		}
	}
	for _, finding := range summary.Findings {
		if finding.Pass {
			summary.PassedFindings++
		} else {
			summary.FailedFindings++
		}
	}
	return summary
}

// RecordingTaxonomyFreezeCase 是冻结审计的输入（一个 Case 的 v3 视图 + 该场的 scene 证据）。
type RecordingTaxonomyFreezeCase struct {
	CaseID        string
	View          *RecordingTaxonomyV2View
	SceneEvidence []string
	ExpectedRoles map[string][]string
}

// RecordingTaxonomyFreezeEvidenceCorpus 汇总一条 v3 结果中**已落库**的证据语料：
// 每条判断任务的 evidence / question / why_it_matters + ambiguity 理由。
// 4C 的 scene 级 evidence 未落库，因此硬不变量审计使用这份语料；4C-FINAL 会补存完整结果 JSON。
func RecordingTaxonomyFreezeEvidenceCorpus(ctx context.Context, eid, fileID, generation int64, promptVersion string) []string {
	variant := RecordingTaxonomyShadowVariantV3
	if strings.Contains(promptVersion, "final") {
		variant = RecordingTaxonomyShadowVariantV3Final
	}
	row, err := model.GetRecordingTaxonomyV2Shadow(ctx, eid, fileID, generation, variant)
	if err != nil || row == nil {
		return nil
	}
	corpus := make([]string, 0, 16)
	// 优先使用已落库的完整结果（含 scene 级证据）；旧行没有 result_json 时退回任务语料。
	if strings.TrimSpace(string(row.ResultJSON)) != "" {
		var parsed recordingTaxonomyV2Result
		if json.Unmarshal([]byte(row.ResultJSON), &parsed) == nil {
			corpus = append(corpus, parsed.SceneType.Evidence...)
			corpus = append(corpus, parsed.ParticipationRole.Evidence...)
			for _, tag := range parsed.IntentTags {
				corpus = append(corpus, tag.Evidence...)
			}
			if strings.TrimSpace(parsed.Ambiguity.Reason) != "" {
				corpus = append(corpus, parsed.Ambiguity.Reason)
			}
			if len(corpus) > 0 {
				return corpus
			}
		}
	}
	var tasks []recordingTaxonomyV2DecisionTask
	if json.Unmarshal([]byte(row.DecisionTasksJSON), &tasks) == nil {
		for _, task := range tasks {
			corpus = append(corpus, task.Evidence...)
			if strings.TrimSpace(task.Question) != "" {
				corpus = append(corpus, task.Question)
			}
			if strings.TrimSpace(task.WhyItMatters) != "" {
				corpus = append(corpus, task.WhyItMatters)
			}
		}
	}
	if strings.TrimSpace(string(row.AmbiguityJSON)) != "" {
		corpus = append(corpus, string(row.AmbiguityJSON))
	}
	return corpus
}

// RecordingTaxonomyParticipant 是纪要里的参与人条目（用于 actor grounding）。
type RecordingTaxonomyParticipant struct {
	Name string `json:"name"`
	Role string `json:"role"`
}

// RecordingTaxonomyParticipants 读取纪要 JSON 中的参与人列表（确定性信息）。
func RecordingTaxonomyParticipants(fileID int64) []RecordingTaxonomyParticipant {
	summary, err := model.GetSummaryByTemplateID(fileID, 0)
	if err != nil || summary == nil {
		return nil
	}
	var payload struct {
		Meeting struct {
			Participants []RecordingTaxonomyParticipant `json:"participants"`
		} `json:"meeting"`
	}
	if json.Unmarshal([]byte(summary.SummaryContent), &payload) != nil {
		return nil
	}
	result := make([]RecordingTaxonomyParticipant, 0, len(payload.Meeting.Participants))
	for _, participant := range payload.Meeting.Participants {
		name := strings.TrimSpace(participant.Name)
		if name == "" {
			continue
		}
		result = append(result, RecordingTaxonomyParticipant{Name: name, Role: strings.TrimSpace(participant.Role)})
	}
	return result
}

// RecordingTaxonomyActorGrounding 用确定性信息判断当前用户在纪要中的身份线索。
// 注意：不猜测——只在姓名/别名与参与人条目匹配时给出结论；无法匹配时返回 found=false。
func RecordingTaxonomyActorGrounding(current RecordingTaxonomyCurrentUser, participants []RecordingTaxonomyParticipant) (found bool, role string, matched string) {
	aliases := append([]string{}, current.Aliases...)
	if current.Name != "" {
		aliases = append(aliases, current.Name)
	}
	for _, participant := range participants {
		name := strings.TrimSpace(participant.Name)
		if name == "" {
			continue
		}
		for _, alias := range aliases {
			alias = strings.TrimSpace(alias)
			if alias == "" {
				continue
			}
			if strings.Contains(name, alias) || strings.Contains(alias, name) {
				return true, participant.Role, name
			}
		}
	}
	return false, "", ""
}
