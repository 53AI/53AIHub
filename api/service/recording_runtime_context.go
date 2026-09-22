package service

import (
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"

	"github.com/53AI/53AIHub/common/utils/hashids"
)

const recordingDecisionContextAuditVersion = "v1.1"
const recordingDecisionRuntimeContextEnabledEnv = "RECORDING_DECISION_RUNTIME_CONTEXT_ENABLED"
const recordingEnterpriseKnowledgeLibraryIDsEnv = "RECORDING_ENTERPRISE_KNOWLEDGE_LIBRARY_IDS"
const recordingEnterpriseKnowledgeEnabledEnv = "RECORDING_ENTERPRISE_KNOWLEDGE_ENABLED"

func recordingDecisionRuntimeContextEnabled() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(recordingDecisionRuntimeContextEnabledEnv))) {
	case "1", "true", "on", "enabled", "yes":
		return true
	default:
		return false
	}
}

func recordingEnterpriseKnowledgeEnabled() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(recordingEnterpriseKnowledgeEnabledEnv))) {
	case "0", "false", "off", "disabled", "no":
		return false
	default:
		return true
	}
}

func enterpriseKnowledgeDegradationReason(enabled bool, libraryIDs []int64, scopeErr error, query string) string {
	switch {
	case !enabled:
		return "enterprise_knowledge_disabled"
	case scopeErr != nil:
		return "enterprise_knowledge_scope_invalid"
	case len(normalizePositiveInt64s(libraryIDs)) == 0:
		return "enterprise_knowledge_scope_missing"
	case strings.TrimSpace(query) == "":
		return "enterprise_knowledge_query_missing"
	default:
		return ""
	}
}

func recordingEnterpriseKnowledgeLibraryIDsFromEnv() ([]int64, error) {
	raw := strings.TrimSpace(os.Getenv(recordingEnterpriseKnowledgeLibraryIDsEnv))
	if raw == "" {
		return nil, nil
	}
	ids := make([]int64, 0)
	for _, value := range strings.Split(raw, ",") {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, numericErr := strconv.ParseInt(value, 10, 64); numericErr == nil || !hashids.IsValidHashid(value) {
			return nil, fmt.Errorf("enterprise knowledge library scope must use HashID")
		}
		id, err := hashids.Decode(value)
		if err != nil || id <= 0 {
			return nil, fmt.Errorf("invalid enterprise knowledge library HashID")
		}
		ids = appendUniqueInt64s(ids, id)
	}
	return ids, nil
}

func appendUniqueInt64s(values []int64, value int64) []int64 {
	for _, existing := range values {
		if existing == value {
			return values
		}
	}
	return append(values, value)
}

func containsString(values []string, value string) bool {
	for _, existing := range values {
		if existing == value {
			return true
		}
	}
	return false
}

func recordingEnterpriseKnowledgeQuery(current *CurrentMeetingContext) string {
	if current == nil {
		return ""
	}
	parts := make([]string, 0, 4)
	for _, claim := range current.Claims {
		if content := strings.TrimSpace(claim.Content); content != "" {
			parts = append(parts, content)
		}
		if len(parts) == 3 {
			break
		}
	}
	parts = append(parts, current.Topics...)
	return strings.TrimSpace(strings.Join(parts, "；"))
}

type RecordingDecisionContextAuditPackage struct {
	PackageVersion string                        `json:"package_version"`
	Request        RecordingDecisionAuditRequest `json:"request_context"`
	Items          []RecordingDecisionAuditItem  `json:"items"`
	OmittedReasons []string                      `json:"omitted_reasons,omitempty"`
}

type RecordingDecisionAuditRequest struct {
	EnterpriseID string   `json:"enterprise_id"`
	UserID       string   `json:"user_id"`
	FileID       string   `json:"file_id"`
	Generation   int64    `json:"generation"`
	Scene        string   `json:"primary_scene,omitempty"`
	Domains      []string `json:"secondary_domains,omitempty"`
	Topics       []string `json:"topics,omitempty"`
}

type RecordingDecisionAuditItem struct {
	AuditItemID     string   `json:"audit_item_id"`
	SourceKind      string   `json:"source_kind"`
	SourceID        string   `json:"source_id"`
	Content         string   `json:"content"`
	EvidenceRefs    []string `json:"evidence_refs,omitempty"`
	PermissionScope string   `json:"permission_scope"`
	RetrievalReason string   `json:"retrieval_reason"`
	Selected        bool     `json:"selected"`
	OmittedReason   string   `json:"omitted_reason,omitempty"`
}

// RecordingDecisionEnterpriseKnowledgeCandidate is the already-authorized
// projection returned by the existing RAG layer. This adapter deliberately
// does not query storage or make permission decisions from caller input.
type RecordingDecisionEnterpriseKnowledgeCandidate struct {
	ChunkID         string
	Content         string
	EvidenceRefs    []string
	PermissionScope string
	RetrievalReason string
	Authorized      bool
}

type RecordingDecisionRuntimeContext struct {
	ContextVersion      string                         `json:"context_version"`
	CurrentContext      []RecordingDecisionRuntimeItem `json:"current_context"`
	BossCognition       []RecordingDecisionRuntimeItem `json:"boss_cognition"`
	BusinessMemory      []RecordingDecisionRuntimeItem `json:"business_memory"`
	EnterpriseKnowledge []RecordingDecisionRuntimeItem `json:"enterprise_knowledge"`
	EvidenceRefs        []string                       `json:"evidence_refs"`
	Degraded            bool                           `json:"degraded"`
	DegradationReasons  []string                       `json:"degradation_reasons,omitempty"`
}

type RecordingDecisionRuntimeItem struct {
	AuditItemID  string   `json:"audit_item_id"`
	SourceID     string   `json:"source_id"`
	Content      string   `json:"content"`
	EvidenceRefs []string `json:"evidence_refs,omitempty"`
}

type RecordingDecisionQueryPlanInput struct {
	Question string
	UserID   int64
	NowUnix  int64
	Current  *CurrentMeetingContext
}

type RecordingDecisionQueryPlan struct {
	Version       string   `json:"version"`
	Question      string   `json:"question,omitempty"`
	ClaimAnchors  []string `json:"claim_anchors,omitempty"`
	EntityAnchors []string `json:"entity_anchors,omitempty"`
	Scene         string   `json:"primary_scene,omitempty"`
	Domains       []string `json:"secondary_domains,omitempty"`
	Topics        []string `json:"topics,omitempty"`
	Priority      []string `json:"priority"`
	Reasons       []string `json:"reasons,omitempty"`
	Degraded      bool     `json:"degraded"`
	DegradeReason string   `json:"degrade_reason,omitempty"`
}

// BuildRecordingDecisionQueryPlan only plans bounded lookup anchors. It does
// not query storage and never promotes user profile fields to cognition.
func BuildRecordingDecisionQueryPlan(input RecordingDecisionQueryPlanInput) RecordingDecisionQueryPlan {
	plan := RecordingDecisionQueryPlan{Version: recordingDecisionContextAuditVersion, Question: strings.TrimSpace(input.Question), Priority: []string{"current_claims", "current_entities", "boss_cognition", "business_memory", "enterprise_knowledge"}}
	if input.Current == nil {
		plan.Degraded = true
		plan.DegradeReason = "current_context_unavailable"
		plan.Reasons = []string{"仅保留问题锚点，禁止用历史数据补写当前事实"}
		return plan
	}
	plan.Scene = strings.TrimSpace(input.Current.PrimaryScene)
	plan.Domains = sortedUniqueStrings(input.Current.SecondaryDomains)
	plan.Topics = sortedUniqueStrings(input.Current.Topics)
	for _, claim := range input.Current.Claims {
		if content := strings.TrimSpace(claim.Content); content != "" {
			plan.ClaimAnchors = appendUniqueStrings(plan.ClaimAnchors, content)
		}
	}
	plan.EntityAnchors = input.Current.RecallEntityNames()
	if len(plan.ClaimAnchors) == 0 && len(plan.EntityAnchors) == 0 && plan.Question == "" {
		plan.Degraded = true
		plan.DegradeReason = "no_recall_anchor"
		plan.Reasons = append(plan.Reasons, "当前上下文和问题均无可用锚点")
	} else {
		plan.Reasons = append(plan.Reasons, "current_claims_and_evidence_first")
	}
	if plan.Scene == "" && len(plan.Domains) == 0 && len(plan.Topics) == 0 {
		plan.Reasons = append(plan.Reasons, "scene_domain_topic_low_confidence")
	}
	return plan
}

func sortedUniqueStrings(values []string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			result = appendUniqueStrings(result, value)
		}
	}
	sort.Strings(result)
	return result
}

// BuildRecordingDecisionContextAuditPackage converts the current context result
// into an auditable, string-ID boundary. It reuses already filtered data and
// does not perform another query or inference pass.
func BuildRecordingDecisionContextAuditPackage(eid, userID, fileID int64, result *RecordingDecisionContextResult) (*RecordingDecisionContextAuditPackage, error) {
	if result == nil || result.Public == nil {
		return nil, fmt.Errorf("recording decision context result is nil")
	}
	request := RecordingDecisionAuditRequest{
		EnterpriseID: strconv.FormatInt(eid, 10), UserID: strconv.FormatInt(userID, 10), FileID: strconv.FormatInt(fileID, 10),
		Generation: result.Public.CurrentContext.Generation, Scene: result.Public.CurrentContext.PrimaryScene,
		Domains: append([]string{}, result.Public.CurrentContext.SecondaryDomains...), Topics: append([]string{}, result.Public.CurrentContext.Topics...),
	}
	audit := &RecordingDecisionContextAuditPackage{PackageVersion: recordingDecisionContextAuditVersion, Request: request, Items: []RecordingDecisionAuditItem{}, OmittedReasons: append([]string{}, result.OmittedReasons...)}
	for _, claim := range result.Public.CurrentContext.Claims {
		audit.Items = append(audit.Items, RecordingDecisionAuditItem{AuditItemID: "current:claim:" + claim.TempID, SourceKind: "current_context", SourceID: claim.TempID, Content: claim.Content, EvidenceRefs: append([]string{}, claim.EvidenceSegmentIDs...), PermissionScope: request.EnterpriseID + ":" + request.UserID, RetrievalReason: "current_context", Selected: true})
	}
	if result.Cognitions != nil {
		for _, cognition := range append(append(append([]RecordingCognitionContextItem{}, result.Cognitions.Core...), result.Cognitions.Situational...), result.Cognitions.Conflicts...) {
			kind := "boss_cognition"
			encodedID, err := hashids.Encode(cognition.ID)
			if err != nil {
				return nil, fmt.Errorf("encode cognition id: %w", err)
			}
			audit.Items = append(audit.Items, RecordingDecisionAuditItem{AuditItemID: kind + ":" + encodedID, SourceKind: kind, SourceID: encodedID, Content: cognition.Statement, PermissionScope: request.EnterpriseID + ":" + request.UserID, RetrievalReason: cognition.RetrievalReason, Selected: true})
		}
	}
	for _, memory := range result.Public.BusinessMemory.Items {
		encodedID, err := hashids.Encode(memory.MemoryID)
		if err != nil {
			return nil, fmt.Errorf("encode memory id: %w", err)
		}
		audit.Items = append(audit.Items, RecordingDecisionAuditItem{AuditItemID: "business_memory:" + encodedID, SourceKind: "business_memory", SourceID: encodedID, Content: memory.Content, EvidenceRefs: append([]string{}, memory.SourceSegmentIDs...), PermissionScope: request.EnterpriseID + ":" + request.UserID, RetrievalReason: "history_recall", Selected: true})
	}
	return audit, nil
}

// AppendEnterpriseKnowledgeCandidates adds only candidates that the RAG layer
// has already authorized. Unauthorized candidates are represented as omission
// reasons so evaluation can distinguish no-hit from permission filtering.
func AppendEnterpriseKnowledgeCandidates(audit *RecordingDecisionContextAuditPackage, candidates []RecordingDecisionEnterpriseKnowledgeCandidate) error {
	if audit == nil {
		return fmt.Errorf("recording decision audit package is nil")
	}
	for _, candidate := range candidates {
		if candidate.ChunkID == "" {
			return fmt.Errorf("enterprise knowledge candidate is missing chunk id")
		}
		if !candidate.Authorized {
			audit.OmittedReasons = append(audit.OmittedReasons, "enterprise_knowledge_permission_filtered:"+candidate.ChunkID)
			continue
		}
		audit.Items = append(audit.Items, RecordingDecisionAuditItem{
			AuditItemID: "enterprise_knowledge:" + candidate.ChunkID, SourceKind: "enterprise_knowledge", SourceID: candidate.ChunkID,
			Content: candidate.Content, EvidenceRefs: append([]string{}, candidate.EvidenceRefs...), PermissionScope: candidate.PermissionScope,
			RetrievalReason: candidate.RetrievalReason, Selected: true,
		})
	}
	return nil
}

// CompileRecordingDecisionRuntimeContext is a pure deterministic projection of
// selected Audit items. It cannot invent records and never accesses storage.
func CompileRecordingDecisionRuntimeContext(audit *RecordingDecisionContextAuditPackage) (*RecordingDecisionRuntimeContext, error) {
	if audit == nil {
		return nil, fmt.Errorf("recording decision audit package is nil")
	}
	items := append([]RecordingDecisionAuditItem{}, audit.Items...)
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].SourceKind != items[j].SourceKind {
			return runtimeSourceOrder(items[i].SourceKind) < runtimeSourceOrder(items[j].SourceKind)
		}
		return items[i].AuditItemID < items[j].AuditItemID
	})
	runtime := &RecordingDecisionRuntimeContext{ContextVersion: recordingDecisionContextAuditVersion, CurrentContext: []RecordingDecisionRuntimeItem{}, BossCognition: []RecordingDecisionRuntimeItem{}, BusinessMemory: []RecordingDecisionRuntimeItem{}, EnterpriseKnowledge: []RecordingDecisionRuntimeItem{}, EvidenceRefs: []string{}, DegradationReasons: []string{}}
	for _, reason := range audit.OmittedReasons {
		reason = strings.TrimSpace(reason)
		if reason != "" && !containsString(runtime.DegradationReasons, reason) {
			runtime.DegradationReasons = append(runtime.DegradationReasons, reason)
		}
	}
	sort.Strings(runtime.DegradationReasons)
	runtime.Degraded = len(runtime.DegradationReasons) > 0
	seenEvidence := map[string]struct{}{}
	for _, item := range items {
		if !item.Selected {
			continue
		}
		if item.AuditItemID == "" || item.SourceKind == "" {
			return nil, fmt.Errorf("selected audit item is missing identity")
		}
		runtimeItem := RecordingDecisionRuntimeItem{AuditItemID: item.AuditItemID, SourceID: item.SourceID, Content: item.Content, EvidenceRefs: append([]string{}, item.EvidenceRefs...)}
		switch item.SourceKind {
		case "current_context":
			runtime.CurrentContext = append(runtime.CurrentContext, runtimeItem)
		case "boss_cognition":
			runtime.BossCognition = append(runtime.BossCognition, runtimeItem)
		case "business_memory":
			runtime.BusinessMemory = append(runtime.BusinessMemory, runtimeItem)
		case "enterprise_knowledge":
			runtime.EnterpriseKnowledge = append(runtime.EnterpriseKnowledge, runtimeItem)
		default:
			return nil, fmt.Errorf("unsupported selected audit source %q", item.SourceKind)
		}
		for _, evidence := range item.EvidenceRefs {
			if _, exists := seenEvidence[evidence]; !exists {
				seenEvidence[evidence] = struct{}{}
				runtime.EvidenceRefs = append(runtime.EvidenceRefs, evidence)
			}
		}
	}
	return runtime, nil
}

func runtimeSourceOrder(source string) int {
	switch source {
	case "current_context":
		return 1
	case "boss_cognition":
		return 2
	case "business_memory":
		return 3
	case "enterprise_knowledge":
		return 4
	default:
		return 99
	}
}

func FormatRecordingDecisionRuntimeContext(runtime *RecordingDecisionRuntimeContext) string {
	if runtime == nil {
		return ""
	}
	encoded, err := json.Marshal(runtime)
	if err != nil {
		return ""
	}
	return "<decision_runtime_context>\n" + string(encoded) + "\n</decision_runtime_context>"
}
