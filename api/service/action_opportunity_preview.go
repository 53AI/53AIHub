package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/actionsystem"
)

const actionOpportunityPreviewEnabledEnv = "ACTION_OPPORTUNITY_PREVIEW_ENABLED"

// Preview 需要同时有显式开关与非生产部署标识；默认永远不可访问。
func actionOpportunityPreviewEnabled() bool {
	if os.Getenv(actionOpportunityPreviewEnabledEnv) != "true" {
		return false
	}
	switch strings.ToLower(strings.TrimSpace(os.Getenv("DEPLOYMENT_MODE"))) {
	case "local", "test", "staging":
		return true
	default:
		return false
	}
}

// PreviewOpportunityCandidate 不向测试界面下发会议 evidence 摘录或原始 SourceRef。
type PreviewOpportunityCandidate struct {
	Title              string                       `json:"title"`
	Type               actionsystem.OpportunityType `json:"type"`
	Reason             string                       `json:"reason"`
	Objective          string                       `json:"objective"`
	Deliverables       []actionsystem.Deliverable   `json:"deliverables"`
	DisplayDeliverable string                       `json:"display_deliverable"`
	HumanDependency    string                       `json:"human_dependency"`
	AIExecutableScore  float64                      `json:"ai_executable_score"`
	RiskLevel          string                       `json:"risk_level"`
	Priority           int                          `json:"priority"`
}

type PreviewOpportunityRejection struct {
	Candidate PreviewOpportunityCandidate `json:"candidate"`
	Reason    string                      `json:"reason"`
}

type PreviewOpportunityEvaluation struct {
	RawCount   int                           `json:"raw_count"`
	FinalCount int                           `json:"final_count"`
	Raw        []PreviewOpportunityCandidate `json:"raw"`
	Final      []PreviewOpportunityCandidate `json:"final"`
	Rejected   []PreviewOpportunityRejection `json:"rejected"`
}

type ActionOpportunityPreviewResult struct {
	InsightGeneration int64                                   `json:"insight_generation"`
	InputHash         string                                  `json:"input_hash"`
	ModelName         string                                  `json:"model_name"`
	Existing          []*ActionOpportunityView                `json:"existing"`
	Evaluations       map[string]PreviewOpportunityEvaluation `json:"evaluations"`
	Persisted         bool                                    `json:"persisted"`
}

func previewOpportunityCandidate(candidate actionsystem.ActionOpportunity) PreviewOpportunityCandidate {
	return PreviewOpportunityCandidate{
		Title: candidate.Title, Type: candidate.Type, Reason: candidate.Reason, Objective: candidate.Objective,
		Deliverables: candidate.Deliverables, DisplayDeliverable: candidate.DisplayDeliverable,
		HumanDependency: candidate.HumanDependency, AIExecutableScore: candidate.AIExecutableScore,
		RiskLevel: candidate.RiskLevel, Priority: candidate.Priority,
	}
}

// PreviewInsightActionOpportunities 对历史正式洞察重新推理，严格不触发来源登记、候选持久化或 ActionRun。
func (s *ActionRuntimeService) PreviewInsightActionOpportunities(ctx context.Context, eid, userID, fileID int64, versions []string, includeExisting bool) (*ActionOpportunityPreviewResult, error) {
	if !actionOpportunityPreviewEnabled() {
		return nil, ErrActionForbidden
	}
	if len(versions) == 0 || len(versions) > 2 {
		return nil, ErrActionPlanInvalid
	}
	seen := make(map[string]bool, 2)
	for _, version := range versions {
		if version != "v1" && version != "v2" || seen[version] {
			return nil, ErrActionPlanInvalid
		}
		seen[version] = true
	}
	file, err := GetViewableRecordingFile(ctx, eid, userID, fileID)
	if err != nil {
		return nil, mapActionNotFound(err, ErrActionOpportunityNotFound)
	}
	if !file.IsRecordingOriginType() {
		return nil, ErrActionOpportunityNotFound
	}
	insight, err := loadFormalInsightPageText(fileID)
	if err != nil {
		return nil, ErrActionInsightNotReady
	}
	// 与正式检测一致的 canonical evidence，但绝不调用可能写入的 ensureRecordingActionSources。
	legacyID := strconv.FormatInt(fileID, 10)
	insightIdentity, err := model.GetCanonicalSourceIdentityByLegacy(ctx, eid, model.SourceTypeInsight, model.LegacySourceTypeRecordingFile, legacyID)
	if err != nil {
		return nil, fmt.Errorf("%w: insight source identity is not available for read-only preview", ErrActionInsightNotReady)
	}
	meetingIdentity, err := model.GetCanonicalSourceIdentityByLegacy(ctx, eid, model.SourceTypeMeeting, model.LegacySourceTypeRecordingFile, legacyID)
	if err != nil {
		return nil, fmt.Errorf("%w: meeting source identity is not available for read-only preview", ErrActionInsightNotReady)
	}
	// GetInsightBackground 会读取默认上下文，可能间接触发配置自动创建；
	// 因此必须先确认录音配置已存在，再读取任何背景。
	setting, err := model.GetSettingByEidAndKey(eid, model.SETTING_RECORDING_CONFIG)
	if err != nil {
		return nil, err
	}
	if setting == nil {
		return nil, ErrActionOpportunityUnavailable
	}
	var cfg model.RecordingConfig
	if err := json.Unmarshal([]byte(setting.Value), &cfg); err != nil {
		return nil, ErrActionOpportunityUnavailable
	}
	background, err := GetInsightBackground(ctx, eid, userID, fileID)
	if err != nil {
		if errors.Is(err, ErrInsightContextForbidden) {
			return nil, ErrActionForbidden
		}
		return nil, err
	}
	version := ""
	if file.InsightGeneration > 0 {
		version = strconv.FormatInt(file.InsightGeneration, 10)
	}
	sourceRefs := []actionsystem.SourceRef{
		{Role: model.ActionSourceRefRolePrimary, SourceType: model.SourceTypeInsight, CanonicalID: insightIdentity.CanonicalID, SourceVersion: version},
		{Role: model.ActionSourceRefRoleRelated, SourceType: model.SourceTypeMeeting, CanonicalID: meetingIdentity.CanonicalID, SourceVersion: version},
	}
	input := actionsystem.DetectionInput{
		SourceType: ActionOpportunitySourceInsight, SourceID: insightIdentity.CanonicalID,
		SourceInsightID: insightIdentity.CanonicalID, SourceMeetingID: meetingIdentity.CanonicalID,
		InsightGeneration: file.InsightGeneration, InsightSummary: insight, MaterialContext: background.MaterialContext,
		SourceRefs: sourceRefs,
		EvidenceRefs: []actionsystem.EvidenceRef{
			{SourceType: model.SourceTypeInsight, SourceID: insightIdentity.CanonicalID, Excerpt: truncateActionText(insight, maxOpportunityExcerpt)},
			{SourceType: model.SourceTypeMeeting, SourceID: meetingIdentity.CanonicalID, Excerpt: truncateActionText(background.MaterialContext, maxOpportunityExcerpt)},
		},
	}
	sum := sha256.Sum256([]byte(input.InsightSummary + "\x00" + input.MaterialContext + "\x00" + input.SourceInsightID + "\x00" + input.SourceMeetingID))
	result := &ActionOpportunityPreviewResult{
		InsightGeneration: file.InsightGeneration, InputHash: hex.EncodeToString(sum[:]),
		ModelName: cfg.InferenceModelName, Existing: []*ActionOpportunityView{},
		Evaluations: make(map[string]PreviewOpportunityEvaluation, len(versions)),
	}
	if includeExisting {
		existing, err := model.ListActionOpportunitiesForUser(ctx, eid, userID, ActionOpportunitySourceInsight, insightIdentity.CanonicalID)
		if err != nil {
			return nil, err
		}
		if len(existing) == 0 {
			legacySourceID, err := encodeActionID(fileID)
			if err != nil {
				return nil, err
			}
			existing, err = model.ListActionOpportunitiesForUser(ctx, eid, userID, ActionOpportunitySourceMeetingInsight, legacySourceID)
			if err != nil {
				return nil, err
			}
		}
		result.Existing, err = s.opportunityViews(ctx, eid, existing)
		if err != nil {
			return nil, err
		}
	}
	if s.opportunityGenerator == nil {
		return nil, ErrActionOpportunityUnavailable
	}
	registry := actionCapabilityRegistry()
	for _, promptVersion := range versions {
		generator := s.opportunityGenerator
		if live, ok := generator.(*llmActionOpportunityGenerator); ok {
			copy := *live
			copy.promptVersion = promptVersion
			generator = &copy
		}
		raw, err := generator.Generate(ctx, &cfg, input, registry)
		if err != nil {
			return nil, fmt.Errorf("%w: preview %s: %v", ErrActionOpportunityUnavailable, promptVersion, err)
		}
		gated := actionsystem.EvaluateOpportunityGates(raw, registry)
		eval := PreviewOpportunityEvaluation{
			RawCount: len(raw), FinalCount: len(gated.Accepted),
			Raw:      make([]PreviewOpportunityCandidate, 0, len(raw)),
			Final:    make([]PreviewOpportunityCandidate, 0, len(gated.Accepted)),
			Rejected: make([]PreviewOpportunityRejection, 0, len(gated.Rejected)),
		}
		for _, candidate := range raw {
			eval.Raw = append(eval.Raw, previewOpportunityCandidate(candidate))
		}
		for _, candidate := range gated.Accepted {
			eval.Final = append(eval.Final, previewOpportunityCandidate(candidate))
		}
		for _, rejected := range gated.Rejected {
			eval.Rejected = append(eval.Rejected, PreviewOpportunityRejection{Candidate: previewOpportunityCandidate(rejected.Candidate), Reason: rejected.Reason})
		}
		result.Evaluations[promptVersion] = eval
	}
	latest, err := model.GetFileByID(eid, fileID, ctx)
	if err != nil {
		return nil, err
	}
	if latest == nil || latest.InsightGeneration != file.InsightGeneration {
		return nil, ErrActionInsightChanged
	}
	return result, nil
}
