package actionsystem

import (
	"fmt"
	"strings"
)

type PlanAlignmentFailure struct {
	Field  string
	Reason string
}

type PlanAlignmentError struct {
	Failures []PlanAlignmentFailure
}

func (e *PlanAlignmentError) Error() string {
	if e == nil || len(e.Failures) == 0 {
		return "action plan alignment failed"
	}
	parts := make([]string, 0, len(e.Failures))
	for _, failure := range e.Failures {
		parts = append(parts, failure.Field+": "+failure.Reason)
	}
	return "action plan alignment failed: " + strings.Join(parts, "; ")
}

// PlanAlignmentGate rejects a generated plan when it changes the accepted
// ActionIntent. It intentionally does not inspect prose relevance of every
// step; that remains a human-review concern rather than an AI self-scoring
// loop.
func PlanAlignmentGate(intent ActionIntent, plan ActionPlan) error {
	failures := make([]PlanAlignmentFailure, 0, 5)
	if normalizeContractText(plan.Objective) != normalizeContractText(intent.Objective) {
		failures = append(failures, PlanAlignmentFailure{Field: "objective", Reason: "must preserve the opportunity objective"})
	}
	if plan.ActionType != intent.ActionType {
		failures = append(failures, PlanAlignmentFailure{Field: "action_type", Reason: fmt.Sprintf("must remain %q", intent.ActionType)})
	}
	if normalizeContractText(plan.Scope) != normalizeContractText(intent.Scope) {
		failures = append(failures, PlanAlignmentFailure{Field: "scope", Reason: "must preserve the accepted action scope"})
	}
	if !sameDeliverables(intent.ExpectedDeliverables, plan.Deliverables) {
		failures = append(failures, PlanAlignmentFailure{Field: "expected_deliverables", Reason: "must preserve the accepted deliverables"})
	}
	if !containsEvidence(plan.EvidenceRefs, intent.SourceEvidence) {
		failures = append(failures, PlanAlignmentFailure{Field: "source_evidence", Reason: "must retain every accepted source evidence reference"})
	}
	if len(failures) > 0 {
		return &PlanAlignmentError{Failures: failures}
	}
	return nil
}

func normalizeContractText(value string) string {
	return strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
}

func sameDeliverables(expected, actual []Deliverable) bool {
	if len(expected) != len(actual) {
		return false
	}
	for index := range expected {
		if normalizeContractText(expected[index].Type) != normalizeContractText(actual[index].Type) ||
			normalizeContractText(expected[index].Title) != normalizeContractText(actual[index].Title) {
			return false
		}
	}
	return true
}

func containsEvidence(actual, expected []EvidenceRef) bool {
	for _, required := range expected {
		found := false
		for _, candidate := range actual {
			if candidate.SourceType == required.SourceType && candidate.SourceID == required.SourceID && candidate.SegmentID == required.SegmentID {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}
