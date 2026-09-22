package service

import (
	"strings"

	"github.com/53AI/53AIHub/model"
)

const (
	recordingCognitionConsolidatorActionNew       = "new"
	recordingCognitionConsolidatorActionReinforce = "reinforce"
	recordingCognitionConsolidatorActionConflict  = "conflict"
)

// RecordingCognitionConsolidatorProposal is a shadow-only suggestion. It has
// no persistence side effect and never changes candidate or formal cognition
// status by itself.
type RecordingCognitionConsolidatorProposal struct {
	CandidateID       int64   `json:"candidate_id"`
	TargetCognitionID int64   `json:"target_cognition_id,omitempty"`
	Action            string  `json:"action"`
	Reason            string  `json:"reason"`
	Confidence        float64 `json:"confidence"`
}

// BuildRecordingCognitionConsolidatorShadow compares already loaded records.
// Exact matching is deliberately conservative; semantic reclassification is a
// later LLM candidate operation and cannot be inferred here.
func BuildRecordingCognitionConsolidatorShadow(candidates []model.RecordingCognitionCandidate, cognitions []model.RecordingCognition) []RecordingCognitionConsolidatorProposal {
	proposals := make([]RecordingCognitionConsolidatorProposal, 0, len(candidates))
	for _, candidate := range candidates {
		if candidate.Status != recordingCognitionCandidateStatusPending {
			continue
		}
		proposal := RecordingCognitionConsolidatorProposal{
			CandidateID: candidate.ID,
			Action:      recordingCognitionConsolidatorActionNew,
			Reason:      "没有找到可验证的正式认知匹配，保留为新候选",
			Confidence:  clampConfidence(candidate.Confidence),
		}
		for _, cognition := range cognitions {
			if cognition.Eid != candidate.Eid || cognition.OwnerID != candidate.OwnerID || cognition.Status == recordingCognitionStatusRejected || cognition.Status == recordingCognitionStatusExpired {
				continue
			}
			if normalizeCognitionText(cognition.Title) != normalizeCognitionText(candidate.Title) {
				continue
			}
			proposal.TargetCognitionID = cognition.ID
			if normalizeCognitionText(string(cognition.Statement)) == normalizeCognitionText(string(candidate.Statement)) {
				proposal.Action = recordingCognitionConsolidatorActionReinforce
				proposal.Reason = "标题和表述均与正式认知一致，建议强化证据与版本"
				proposal.Confidence = maxFloat(proposal.Confidence, cognition.Confidence)
			} else {
				proposal.Action = recordingCognitionConsolidatorActionConflict
				proposal.Reason = "标题一致但表述不同，建议进入冲突审阅"
			}
			break
		}
		proposals = append(proposals, proposal)
	}
	return proposals
}

func normalizeCognitionText(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}
