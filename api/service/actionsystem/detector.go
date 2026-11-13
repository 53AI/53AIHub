package actionsystem

import (
	"sort"
	"strings"
)

const minAIExecutableScore = 0.7

var directHumanActionPhrases = []string{
	"老板待办", "老板任务", "员工任务", "线下执行", "线下商务谈判", "人工项目执行", "组织推动",
	"决定录用", "决定聘用", "最终录用", "招聘决定", "AI负责录用", "AI执行招聘",
	"代表公司签约", "代表公司签合同", "代表公司签订合同", "代表公司签署合同", "直接签约", "直接签合同", "直接签订合同", "直接签署合同", "替公司签约", "替公司签合同", "代签合同",
	"对外承诺", "向客户承诺", "对客户承诺", "AI承诺报价", "AI直接报价并承诺",
	"代替老板决策", "替老板做决策", "代替用户决策", "替用户做决策",
	"未经授权访问", "未经授权读取", "未授权读取敏感",
}

type OpportunityRejection struct {
	Candidate ActionOpportunity `json:"candidate"`
	Reason    string            `json:"reason"`
}

type OpportunityGateResult struct {
	Accepted []ActionOpportunity    `json:"accepted"`
	Rejected []OpportunityRejection `json:"rejected"`
}

// ApplyOpportunityGates is the deterministic policy layer after LLM generation.
// It never creates a candidate and therefore cannot silently replace the LLM
// generator when the model is unavailable.
func ApplyOpportunityGates(candidates []ActionOpportunity, registry CapabilityRegistry) []ActionOpportunity {
	return EvaluateOpportunityGates(candidates, registry).Accepted
}

// EvaluateOpportunityGates applies the production policy and explains each
// rejected candidate for offline evaluation reports.
func EvaluateOpportunityGates(candidates []ActionOpportunity, registry CapabilityRegistry) OpportunityGateResult {
	result := OpportunityGateResult{Accepted: make([]ActionOpportunity, 0, len(candidates))}
	for _, candidate := range candidates {
		reason := opportunityGateRejectionReason(candidate, registry)
		if reason != "" {
			result.Rejected = append(result.Rejected, OpportunityRejection{Candidate: candidate, Reason: reason})
			continue
		}
		result.Accepted = append(result.Accepted, candidate)
	}
	sort.SliceStable(result.Accepted, func(i, j int) bool {
		return result.Accepted[i].Priority < result.Accepted[j].Priority
	})
	if len(result.Accepted) > 3 {
		for _, candidate := range result.Accepted[3:] {
			result.Rejected = append(result.Rejected, OpportunityRejection{Candidate: candidate, Reason: "candidate is below the three-item display limit"})
		}
		result.Accepted = result.Accepted[:3]
	}
	return result
}

func opportunityGateRejectionReason(candidate ActionOpportunity, registry CapabilityRegistry) string {
	if strings.TrimSpace(candidate.Title) == "" || strings.TrimSpace(candidate.Objective) == "" || strings.TrimSpace(candidate.HumanDependency) == "" {
		return "required title, objective, or human_dependency is empty"
	}
	if len(candidate.RequiredCapabilities) == 0 {
		return "required_capabilities is empty"
	}
	if candidate.AIExecutableScore < minAIExecutableScore {
		return "ai_executable_score is below 0.7"
	}
	if candidate.RiskLevel != RiskLow && candidate.RiskLevel != RiskMedium {
		return "risk_level is high or critical"
	}
	if containsNonNegatedAny(strings.Join([]string{candidate.Title, candidate.Objective, deliverableTitles(candidate.Deliverables)}, "\n"), directHumanActionPhrases) {
		return "candidate objective assigns a prohibited human or external action to AI"
	}
	if !registry.Available(candidate.RequiredCapabilities) {
		return "one or more required capabilities are unavailable or unverified"
	}
	return ""
}

func containsNonNegatedAny(value string, phrases []string) bool {
	for _, phrase := range phrases {
		remaining := strings.ToLower(value)
		for {
			index := strings.Index(remaining, strings.ToLower(phrase))
			if index < 0 {
				break
			}
			prefix := []rune(remaining[:index])
			if len(prefix) > 12 {
				prefix = prefix[len(prefix)-12:]
			}
			context := string(prefix)
			negated := false
			for _, marker := range []string{"不负责", "不执行", "不代替", "不包含", "不涉及", "不承担", "不会", "不得", "禁止", "无需", "不能", "不应", "不", "未", "非"} {
				if strings.HasSuffix(context, marker) {
					negated = true
					break
				}
			}
			if !negated {
				return true
			}
			remaining = remaining[index+len(phrase):]
		}
	}
	return false
}

func deliverableTitles(items []Deliverable) string {
	var titles strings.Builder
	for _, item := range items {
		titles.WriteString(item.Title)
		titles.WriteByte('\n')
	}
	return titles.String()
}

func cloneEvidenceRefs(items []EvidenceRef) []EvidenceRef {
	return append([]EvidenceRef(nil), items...)
}

func cloneSourceRefs(refs []SourceRef) []SourceRef {
	return append([]SourceRef(nil), refs...)
}
