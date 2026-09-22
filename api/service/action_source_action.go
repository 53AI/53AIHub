package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/actionsystem"
	"gorm.io/gorm"
)

const (
	actionSourceConversationMessageLimit = 20
	actionSourceResultExcerptLimit       = 8000
)

type DetectActionOpportunitiesFromSourceRequest struct {
	SourceType string `json:"source_type" binding:"required"`
	SourceID   string `json:"source_id" binding:"required"`
}

type actionSourceContext struct {
	Input      actionsystem.DetectionInput
	SourceType string
	SourceID   string
	SourceRefs []*model.ActionSourceRefRecord
	Snapshot   InsightActionContextSnapshot
}

func (s *ActionRuntimeService) DetectActionOpportunitiesFromSource(ctx context.Context, eid, userID int64, req DetectActionOpportunitiesFromSourceRequest) ([]*ActionOpportunityView, error) {
	input, err := s.buildActionSourceContext(ctx, eid, userID, req.SourceType, req.SourceID)
	if err != nil {
		return nil, err
	}
	if existing, listErr := model.ListActionOpportunitiesForUser(ctx, eid, userID, input.Input.SourceType, input.Input.SourceID); listErr != nil {
		return nil, listErr
	} else if len(existing) > 0 {
		return s.opportunityViews(ctx, eid, existing)
	}
	return s.detectActionOpportunitiesFromInput(ctx, eid, userID, input.Input)
}

func (s *ActionRuntimeService) detectActionOpportunitiesFromInput(ctx context.Context, eid, userID int64, input actionsystem.DetectionInput) ([]*ActionOpportunityView, error) {
	registry := actionCapabilityRegistry()
	config, err := model.ValidateOrCreateRecordingConfig(eid)
	if err != nil {
		return nil, err
	}
	if s.opportunityGenerator == nil {
		return nil, ErrActionOpportunityUnavailable
	}
	opportunities, err := s.opportunityGenerator.Generate(ctx, config, input, registry)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrActionOpportunityUnavailable, err)
	}
	for index := range opportunities {
		opportunities[index].SourceType = input.SourceType
		opportunities[index].SourceID = input.SourceID
		opportunities[index].SourceInsightID = input.SourceInsightID
		opportunities[index].SourceMeetingID = input.SourceMeetingID
		opportunities[index].InsightGeneration = input.InsightGeneration
		opportunities[index].SourceRefs = append([]actionsystem.SourceRef(nil), input.SourceRefs...)
		if len(opportunities[index].EvidenceRefs) == 0 {
			opportunities[index].EvidenceRefs = append([]actionsystem.EvidenceRef(nil), input.EvidenceRefs...)
		}
	}
	opportunities = actionsystem.ApplyOpportunityGates(opportunities, registry)
	views := make([]*ActionOpportunityView, 0, len(opportunities))
	for _, opportunity := range opportunities {
		id, idErr := model.GenerateActionOpportunityID()
		if idErr != nil {
			return nil, idErr
		}
		opportunity.ID = id
		aggregate := opportunityAggregate(eid, userID, opportunity)
		aggregate.Record.DetectionVersion = actionOpportunityDetectionVersion
		if err := model.CreateActionOpportunityAggregate(ctx, aggregate); err != nil {
			return nil, err
		}
		view, viewErr := s.actionOpportunityView(ctx, eid, aggregate)
		if viewErr != nil {
			return nil, viewErr
		}
		views = append(views, view)
	}
	return views, nil
}

func (s *ActionRuntimeService) buildActionSourceContext(ctx context.Context, eid, userID int64, sourceType, sourceID string) (*actionSourceContext, error) {
	sourceType = strings.TrimSpace(sourceType)
	sourceID = strings.TrimSpace(sourceID)
	switch sourceType {
	case model.SourceTypeConversation:
		conversationID, err := hashids.TryParseID(sourceID)
		if err != nil {
			return nil, ErrActionOpportunityNotFound
		}
		conversation, err := model.GetConversationByID(eid, userID, conversationID)
		if err != nil {
			if err == gorm.ErrRecordNotFound {
				return nil, ErrActionOpportunityNotFound
			}
			return nil, err
		}
		messages, err := model.GetRecentMessagesByConversationID(ctx, eid, conversationID, actionSourceConversationMessageLimit)
		if err != nil {
			return nil, err
		}
		contextText := formatConversationActionContext(conversation.Title, messages)
		if strings.TrimSpace(contextText) == "" {
			return nil, ErrActionOpportunityUnavailable
		}
		canonicalID := strconv.FormatInt(conversationID, 10)
		refs := []*model.ActionSourceRefRecord{{Role: model.ActionSourceRefRolePrimary, SourceType: model.SourceTypeConversation, CanonicalID: canonicalID}}
		input := actionsystem.DetectionInput{
			SourceType: model.SourceTypeConversation, SourceID: canonicalID, ContextLabel: "会话深聊结论",
			InsightSummary: contextText, MaterialContext: "仅包含该会话最近形成的约束、判断和待核对事项。",
			SourceRefs:   actionSourceRefsDomain(refs),
			EvidenceRefs: []actionsystem.EvidenceRef{{SourceType: model.SourceTypeConversation, SourceID: canonicalID, Excerpt: truncateActionText(contextText, maxOpportunityExcerpt)}},
		}
		return &actionSourceContext{Input: input, SourceType: sourceType, SourceID: canonicalID, SourceRefs: refs, Snapshot: InsightActionContextSnapshot{Version: 1, SourceType: model.SourceTypeConversation, SourceID: canonicalID, InsightSummary: contextText, ContextLabel: input.ContextLabel, SourceRefs: input.SourceRefs, EvidenceRefs: input.EvidenceRefs}}, nil
	case model.SourceTypeResult:
		result, err := model.GetActionResultAssetForUser(ctx, eid, userID, sourceID)
		if err != nil {
			if err == gorm.ErrRecordNotFound {
				return nil, ErrActionResultAssetNotFound
			}
			return nil, err
		}
		return buildResultActionSourceContext(ctx, eid, userID, result)
	default:
		return nil, ErrActionInvalidRequest
	}
}

func buildResultActionSourceContext(ctx context.Context, eid, userID int64, result *model.ActionResultAssetAggregate) (*actionSourceContext, error) {
	if result == nil || result.Record == nil || strings.TrimSpace(result.Record.ResultAssetID) == "" {
		return nil, ErrActionResultAssetNotFound
	}
	resultID := result.Record.ResultAssetID
	refs := []*model.ActionSourceRefRecord{{Role: model.ActionSourceRefRolePrimary, SourceType: model.SourceTypeResult, CanonicalID: resultID}}
	seen := map[string]struct{}{model.SourceTypeResult + ":" + resultID: {}}
	for _, ref := range result.SourceRefs {
		if ref == nil || strings.TrimSpace(ref.CanonicalID) == "" {
			continue
		}
		key := ref.SourceType + ":" + ref.CanonicalID
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		refs = append(refs, &model.ActionSourceRefRecord{Role: model.ActionSourceRefRoleRelated, SourceType: ref.SourceType, CanonicalID: ref.CanonicalID, SourceVersion: ref.SourceVersion})
	}
	content := strings.TrimSpace(string(result.Record.Summary))
	if spec, err := resultSpecFromRun(ctx, eid, result.Record.RunID); err == nil {
		if encoded, encodeErr := json.Marshal(spec.Spec); encodeErr == nil {
			content += "\n\nResultSpec：\n" + string(encoded)
		}
	} else if !errorsIsNotFound(err) {
		return nil, err
	}
	evidence := []actionsystem.EvidenceRef{{SourceType: model.SourceTypeResult, SourceID: resultID, Excerpt: truncateActionText(content, actionSourceResultExcerptLimit)}}
	for _, ref := range result.EvidenceRefs {
		if ref == nil || strings.TrimSpace(ref.SourceType) == "" || strings.TrimSpace(ref.SourceID) == "" {
			continue
		}
		evidence = append(evidence, actionsystem.EvidenceRef{SourceType: ref.SourceType, SourceID: ref.SourceID, SegmentID: ref.SegmentID, Excerpt: ref.Excerpt, Timestamp: ref.Timestamp, Position: ref.Position})
	}
	artifactIDs := make([]string, 0, len(result.Artifacts))
	for _, artifact := range result.Artifacts {
		if artifact == nil {
			continue
		}
		artifactIDs = append(artifactIDs, artifact.ArtifactID)
		evidence = append(evidence, actionsystem.EvidenceRef{SourceType: "artifact", SourceID: artifact.ArtifactID, Excerpt: artifact.ArtifactID})
	}
	input := actionsystem.DetectionInput{
		SourceType: model.SourceTypeResult, SourceID: resultID, ContextLabel: "已沉淀成果",
		InsightSummary:  truncateActionText(content, maxOpportunityExcerpt),
		MaterialContext: "成果 Artifact：" + strings.Join(artifactIDs, ", "),
		SourceRefs:      actionSourceRefsDomain(refs), EvidenceRefs: evidence,
	}
	return &actionSourceContext{Input: input, SourceType: model.SourceTypeResult, SourceID: resultID, SourceRefs: refs, Snapshot: InsightActionContextSnapshot{Version: 1, SourceType: model.SourceTypeResult, SourceID: resultID, InsightSummary: input.InsightSummary, ContextLabel: input.ContextLabel, SourceRefs: input.SourceRefs, EvidenceRefs: input.EvidenceRefs}}, nil
}

func errorsIsNotFound(err error) bool {
	return err == nil || err == gorm.ErrRecordNotFound
}

func formatConversationActionContext(title string, messages []*model.Message) string {
	var builder strings.Builder
	if strings.TrimSpace(title) != "" {
		builder.WriteString("会话标题：" + strings.TrimSpace(title) + "\n\n")
	}
	for index := len(messages) - 1; index >= 0; index-- {
		message := messages[index]
		if message == nil {
			continue
		}
		if text := strings.TrimSpace(message.Message); text != "" {
			builder.WriteString("用户：" + truncateActionText(text, 2500) + "\n")
		}
		if answer := strings.TrimSpace(message.Answer); answer != "" {
			builder.WriteString("二号位：" + truncateActionText(answer, 3500) + "\n")
		}
		if reasoning := strings.TrimSpace(message.ReasoningContent); reasoning != "" {
			builder.WriteString("判断依据：" + truncateActionText(reasoning, 1200) + "\n")
		}
		builder.WriteString("\n")
	}
	return strings.TrimSpace(builder.String())
}

func (s *ActionRuntimeService) sourceContextForOpportunity(ctx context.Context, eid, userID int64, opportunity *model.ActionOpportunityAggregate) (*actionSourceContext, error) {
	if opportunity == nil || opportunity.Record == nil {
		return nil, ErrActionOpportunityNotFound
	}
	if opportunity.Record.SourceType == model.SourceTypeConversation || opportunity.Record.SourceType == model.SourceTypeResult {
		return s.buildActionSourceContext(ctx, eid, userID, opportunity.Record.SourceType, opportunity.Record.SourceID)
	}
	fileID, err := actionOpportunityFileID(ctx, opportunity.Record)
	if err != nil {
		return nil, ErrActionOpportunityNotFound
	}
	file, err := GetViewableRecordingFile(ctx, eid, userID, fileID)
	if err != nil {
		return nil, mapActionNotFound(err, ErrActionOpportunityNotFound)
	}
	if !file.IsRecordingOriginType() {
		return nil, ErrActionInsightNotReady
	}
	if file.InsightGeneration != opportunity.Record.InsightGeneration {
		return nil, ErrActionInsightChanged
	}
	insight, err := loadFormalInsightPageText(fileID)
	if err != nil {
		return nil, ErrActionInsightNotReady
	}
	background, err := GetInsightBackground(ctx, eid, userID, fileID)
	if err != nil {
		return nil, err
	}
	refs, err := model.ListActionSourceRefs(ctx, eid, model.ActionSourceParentOpportunity, opportunity.Record.OpportunityID)
	if err != nil {
		return nil, err
	}
	input := actionsystem.DetectionInput{
		SourceType: opportunity.Record.SourceType, SourceID: opportunity.Record.SourceID, ContextLabel: "会议洞察",
		SourceInsightID: opportunity.Record.SourceInsightID, SourceMeetingID: opportunity.Record.SourceMeetingID,
		InsightGeneration: file.InsightGeneration, InsightSummary: insight, MaterialContext: background.MaterialContext,
		SourceRefs: actionSourceRefsDomain(refs),
	}
	for _, evidence := range opportunity.EvidenceRefs {
		if evidence != nil {
			input.EvidenceRefs = append(input.EvidenceRefs, actionsystem.EvidenceRef{SourceType: evidence.SourceType, SourceID: evidence.SourceID, SegmentID: evidence.SegmentID, Excerpt: evidence.Excerpt, Timestamp: evidence.Timestamp, Position: evidence.Position})
		}
	}
	return &actionSourceContext{Input: input, SourceType: input.SourceType, SourceID: input.SourceID, SourceRefs: refs, Snapshot: InsightActionContextSnapshot{Version: 1, SourceType: model.SourceTypeInsight, SourceID: input.SourceID, SourceFileID: fileID, InsightGeneration: input.InsightGeneration, InsightSummary: input.InsightSummary, Background: *background, ContextLabel: input.ContextLabel, SourceRefs: input.SourceRefs, EvidenceRefs: input.EvidenceRefs}}, nil
}
