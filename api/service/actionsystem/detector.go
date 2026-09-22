package actionsystem

import (
	"sort"
	"strings"
)

const minAIExecutableScore = 0.7

var humanDependencyKeywords = []string{
	"老板待办", "老板任务", "员工任务", "线下执行", "线下商务谈判", "谈判", "招聘", "人工项目执行",
	"组织推动", "本人决策", "重大决策", "对外承诺", "签约", "签合同",
}

// ApplyOpportunityGates is the deterministic policy layer after LLM generation.
// It never creates a candidate and therefore cannot silently replace the LLM
// generator when the model is unavailable.
func ApplyOpportunityGates(candidates []ActionOpportunity, registry CapabilityRegistry) []ActionOpportunity {
	result := make([]ActionOpportunity, 0, len(candidates))
	for _, candidate := range candidates {
		if strings.TrimSpace(candidate.Title) == "" || strings.TrimSpace(candidate.Objective) == "" ||
			strings.TrimSpace(candidate.HumanDependency) == "" || len(candidate.RequiredCapabilities) == 0 || candidate.AIExecutableScore < minAIExecutableScore ||
			(candidate.RiskLevel != RiskLow && candidate.RiskLevel != RiskMedium) ||
			containsAny(strings.Join([]string{candidate.Title, candidate.Reason, candidate.Objective, candidate.HumanDependency}, "\n"), humanDependencyKeywords) ||
			!registry.Available(candidate.RequiredCapabilities) {
			continue
		}
		result = append(result, candidate)
	}
	sort.SliceStable(result, func(i, j int) bool {
		return result[i].Priority < result[j].Priority
	})
	if len(result) > 3 {
		return result[:3]
	}
	return result
}

func containsAny(value string, keywords []string) bool {
	lowerValue := strings.ToLower(value)
	for _, keyword := range keywords {
		if strings.Contains(lowerValue, strings.ToLower(keyword)) {
			return true
		}
	}
	return false
}

func cloneEvidenceRefs(items []EvidenceRef) []EvidenceRef {
	return append([]EvidenceRef(nil), items...)
}

func cloneSourceRefs(refs []SourceRef) []SourceRef {
	return append([]SourceRef(nil), refs...)
}
