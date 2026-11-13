package service

import (
	"context"
	"errors"
	"strings"

	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/actionruntime"
	"github.com/53AI/53AIHub/service/actionsystem"
	"gorm.io/gorm"
)

const ActionResultAssetTypeDocument = "document"

type ActionResultAssetArtifactView struct {
	ArtifactID       string `json:"artifact_id"`
	RunID            string `json:"run_id"`
	Name             string `json:"name"`
	MimeType         string `json:"mime_type"`
	Size             int64  `json:"size"`
	DownloadURL      string `json:"download_url"`
	PreviewURL       string `json:"preview_url,omitempty"`
	PreviewStatus    string `json:"preview_status,omitempty"`
	PreviewErrorCode string `json:"preview_error_code,omitempty"`
}

type ActionResultSpecView struct {
	ResultSpecID      string                   `json:"result_spec_id"`
	ResultSpecVersion string                   `json:"result_spec_version"`
	RendererVersion   string                   `json:"renderer_version"`
	TemplateVersion   string                   `json:"template_version"`
	Status            string                   `json:"status"`
	Spec              actionruntime.ResultSpec `json:"spec"`
}

type ActionResultExecutionProcessView struct {
	Run          *ActionRunView     `json:"run"`
	Events       []*ActionEventView `json:"events"`
	NextAfterSeq int64              `json:"next_after_seq"`
	HasMore      bool               `json:"has_more"`
}

type ActionResultAssetView struct {
	ResultAssetID    string                            `json:"result_asset_id"`
	PlanID           string                            `json:"plan_id"`
	ActionID         string                            `json:"action_id"`
	RunID            string                            `json:"run_id"`
	OpportunityID    string                            `json:"opportunity_id"`
	SourceInsightID  string                            `json:"source_insight_id"`
	SourceMeetingID  string                            `json:"source_meeting_id"`
	SourceRefs       []actionsystem.SourceRef          `json:"source_refs"`
	Title            string                            `json:"title"`
	ResultType       string                            `json:"result_type"`
	Summary          string                            `json:"summary"`
	Status           string                            `json:"status"`
	Artifacts        []*ActionResultAssetArtifactView  `json:"artifacts"`
	ExecutionSteps   []actionsystem.ExecutionStep      `json:"execution_steps"`
	ExecutionProcess *ActionResultExecutionProcessView `json:"execution_process,omitempty"`
	ResultSpec       *ActionResultSpecView             `json:"result_spec,omitempty"`
	SourceLinks      []*ActionSourceLinkView           `json:"source_links,omitempty"`
	CreatedTime      int64                             `json:"created_time"`
	UpdatedTime      int64                             `json:"updated_time"`
}

func (s *ActionRuntimeService) AcceptActionRun(ctx context.Context, eid, userID int64, runID string) (*ActionResultAssetView, error) {
	run, err := model.GetActionRunForUser(ctx, eid, userID, strings.TrimSpace(runID))
	if err != nil {
		return nil, mapActionNotFound(err, ErrActionRunNotFound)
	}
	if existing, getErr := model.GetActionResultAssetByRunForUser(ctx, eid, userID, run.RunID); getErr == nil {
		return s.actionResultAssetView(ctx, existing, true)
	} else if !errors.Is(getErr, gorm.ErrRecordNotFound) {
		return nil, getErr
	}
	if run.Status != model.ActionRunStatusCompleted {
		return nil, ErrActionQualityNotReady
	}
	action, err := model.GetActionForUser(ctx, eid, userID, run.ActionID)
	if err != nil {
		return nil, mapActionNotFound(err, ErrActionNotFound)
	}
	plan, err := model.GetActionPlanByActionID(ctx, eid, action.ActionID)
	if err != nil {
		return nil, mapActionNotFound(err, ErrActionPlanNotFound)
	}
	planAggregate, err := model.GetActionPlanForUser(ctx, eid, userID, plan.PlanID)
	if err != nil {
		return nil, mapActionNotFound(err, ErrActionPlanNotFound)
	}
	var artifacts []*model.ActionArtifactRecord
	if err := model.DB.WithContext(ctx).Where("eid = ? AND run_id = ?", eid, run.RunID).Order("id ASC").Find(&artifacts).Error; err != nil {
		return nil, err
	}
	if len(artifacts) == 0 {
		return nil, ErrActionQualityNotReady
	}
	opportunity, err := model.GetActionOpportunityForUser(ctx, eid, userID, plan.OpportunityID)
	if err != nil {
		return nil, mapActionNotFound(err, ErrActionOpportunityNotFound)
	}
	resultID, err := model.GenerateActionResultAssetID()
	if err != nil {
		return nil, err
	}
	aggregate := &model.ActionResultAssetAggregate{Record: &model.ActionResultAssetRecord{
		ResultAssetID: resultID, Eid: eid, OwnerID: userID, PlanID: plan.PlanID, ActionID: action.ActionID, RunID: run.RunID,
		OpportunityID: opportunity.Record.OpportunityID, SourceInsightID: opportunity.Record.SourceInsightID, SourceMeetingID: opportunity.Record.SourceMeetingID,
		Title: resultAssetTitle(planAggregate, opportunity), ResultType: opportunity.Record.OpportunityType, Summary: model.LongText(artifactSummary(artifacts)), Status: model.ActionResultAssetStatusActive,
	}}
	aggregate.SourceRefs = actionSourceRefsRecords(actionSourceRefsDomain(planAggregate.SourceRefs))
	aggregate.Artifacts = artifacts
	// 证据链继承：opportunity → action → result asset，全部走 action_evidence_refs。
	actionEvidence, err := model.ListActionEvidenceRefs(ctx, eid, model.ActionEvidenceOwnerAction, action.ActionID)
	if err != nil {
		return nil, err
	}
	if len(actionEvidence) == 0 {
		actionEvidence, err = model.ListActionEvidenceRefs(ctx, eid, model.ActionEvidenceOwnerOpportunity, opportunity.Record.OpportunityID)
		if err != nil {
			return nil, err
		}
	}
	aggregate.EvidenceRefs = actionEvidence
	// 成果写入、Action 终态及业务主记录归档必须原子提交；不能让成果与列表阶段分叉。
	if err := model.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := model.CreateActionResultAssetAggregateTx(tx, aggregate); err != nil {
			return err
		}
		update := tx.Model(&model.ActionRecord{}).
			Where("eid = ? AND owner_id = ? AND action_id = ? AND status = ?", eid, userID, action.ActionID, model.ActionStatusAwaitingReview).
			Update("status", model.ActionStatusAccepted)
		if update.Error != nil {
			return update.Error
		}
		if update.RowsAffected != 1 {
			return ErrActionState
		}
		return model.TransitionActionItemStage(tx, eid, userID, opportunity.Record.OpportunityID,
			model.ActionItemStageAction, model.ActionItemStageResult)
	}); err != nil {
		return nil, err
	}
	return s.actionResultAssetView(ctx, aggregate, true)
}

// resultAssetTitle keeps the result card title aligned with the originating opportunity;
// the actual file name remains available through artifacts.
func resultAssetTitle(plan *model.ActionPlanAggregate, opportunity *model.ActionOpportunityAggregate) string {
	if opportunity != nil && opportunity.Record != nil && strings.TrimSpace(opportunity.Record.Title) != "" {
		return strings.TrimSpace(opportunity.Record.Title)
	}
	if plan == nil || plan.Record == nil {
		return ""
	}
	return strings.TrimSpace(plan.Record.Objective)
}

func artifactSummary(artifacts []*model.ActionArtifactRecord) string {
	if len(artifacts) == 0 {
		return ""
	}
	return "已交付：" + artifacts[0].Name
}

func (s *ActionRuntimeService) GetActionResultAsset(ctx context.Context, eid, userID int64, resultAssetID string) (*ActionResultAssetView, error) {
	aggregate, err := model.GetActionResultAssetForUser(ctx, eid, userID, strings.TrimSpace(resultAssetID))
	if err != nil {
		return nil, mapActionNotFound(err, ErrActionResultAssetNotFound)
	}
	return s.actionResultAssetView(ctx, aggregate, true)
}

func (s *ActionRuntimeService) ListActionResultAssets(ctx context.Context, eid, userID int64) ([]*ActionResultAssetView, error) {
	records, err := model.ListActionResultAssetsForUser(ctx, eid, userID)
	if err != nil {
		return nil, err
	}
	views := make([]*ActionResultAssetView, 0, len(records))
	for _, record := range records {
		aggregate, getErr := model.GetActionResultAssetForUser(ctx, eid, userID, record.ResultAssetID)
		if getErr != nil {
			return nil, getErr
		}
		view, viewErr := s.actionResultAssetView(ctx, aggregate)
		if viewErr != nil {
			return nil, viewErr
		}
		views = append(views, view)
	}
	return views, nil
}

type ActionResultAssetPage struct {
	Items    []*ActionResultAssetView `json:"items"`
	Total    int64                    `json:"total"`
	Page     int                      `json:"page"`
	PageSize int                      `json:"page_size"`
}

func (s *ActionRuntimeService) ListActionResultAssetsPage(ctx context.Context, eid, userID int64, typeFilter, statusFilter, sortBy string, page, pageSize int) (*ActionResultAssetPage, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	records, total, err := model.ListActionResultAssetsForUserPage(ctx, eid, userID, strings.TrimSpace(typeFilter), strings.TrimSpace(statusFilter), model.NormalizeActionResultAssetSortBy(sortBy), page, pageSize)
	if err != nil {
		return nil, err
	}
	views := make([]*ActionResultAssetView, 0, len(records))
	for _, record := range records {
		aggregate, getErr := model.GetActionResultAssetForUser(ctx, eid, userID, record.ResultAssetID)
		if getErr != nil {
			return nil, getErr
		}
		view, viewErr := s.actionResultAssetView(ctx, aggregate)
		if viewErr != nil {
			return nil, viewErr
		}
		views = append(views, view)
	}
	return &ActionResultAssetPage{Items: views, Total: total, Page: page, PageSize: pageSize}, nil
}

func (s *ActionRuntimeService) ListActionResultAssetCategories(ctx context.Context, eid, userID int64, stage string) ([]model.ActionResultAssetCategory, error) {
	return model.ListActionResultAssetCategoriesForUser(ctx, eid, userID, stage)
}

// DeleteActionResultAsset 用户侧删除成果：软删除（status=archived），列表不再
// 展示。成果挂在执行历史上，不做物理删除，避免 artifacts / evidence / source
// 引用悬空。
func (s *ActionRuntimeService) DeleteActionResultAsset(ctx context.Context, eid, userID int64, resultAssetID string) error {
	if strings.TrimSpace(resultAssetID) == "" {
		return ErrActionResultAssetNotFound
	}
	if err := model.ArchiveActionResultAssetForUser(ctx, eid, userID, strings.TrimSpace(resultAssetID)); err != nil {
		return mapActionNotFound(err, ErrActionResultAssetNotFound)
	}
	return nil
}

func (s *ActionRuntimeService) actionResultAssetView(ctx context.Context, aggregate *model.ActionResultAssetAggregate, includeExecutionProcess ...bool) (*ActionResultAssetView, error) {
	if aggregate == nil || aggregate.Record == nil {
		return nil, ErrActionResultAssetNotFound
	}
	artifactIDs := make([]string, 0, len(aggregate.Artifacts))
	for _, artifact := range aggregate.Artifacts {
		if artifact != nil {
			artifactIDs = append(artifactIDs, artifact.ArtifactID)
		}
	}
	artifacts, err := model.GetActionArtifactsByIDs(ctx, aggregate.Record.Eid, artifactIDs)
	if err != nil {
		return nil, err
	}
	title, resultType := aggregate.Record.Title, aggregate.Record.ResultType
	if opportunity, opportunityErr := model.GetActionOpportunityForUser(ctx, aggregate.Record.Eid, aggregate.Record.OwnerID, aggregate.Record.OpportunityID); opportunityErr == nil {
		if strings.TrimSpace(opportunity.Record.Title) != "" {
			title = strings.TrimSpace(opportunity.Record.Title)
		}
		if strings.TrimSpace(opportunity.Record.OpportunityType) != "" {
			resultType = opportunity.Record.OpportunityType
		}
	} else if !errors.Is(opportunityErr, gorm.ErrRecordNotFound) {
		return nil, opportunityErr
	}
	view := &ActionResultAssetView{ResultAssetID: aggregate.Record.ResultAssetID, PlanID: aggregate.Record.PlanID, ActionID: aggregate.Record.ActionID, RunID: aggregate.Record.RunID, OpportunityID: aggregate.Record.OpportunityID, SourceInsightID: aggregate.Record.SourceInsightID, SourceMeetingID: aggregate.Record.SourceMeetingID, Title: title, ResultType: resultType, Summary: string(aggregate.Record.Summary), Status: aggregate.Record.Status, CreatedTime: aggregate.Record.CreatedTime, UpdatedTime: aggregate.Record.UpdatedTime}
	if len(includeExecutionProcess) > 0 && includeExecutionProcess[0] {
		replay, replayErr := s.GetActionRunReplay(ctx, aggregate.Record.Eid, aggregate.Record.OwnerID, aggregate.Record.RunID, 0, 101)
		if replayErr != nil {
			return nil, replayErr
		}
		events := replay.Events
		hasMore := len(events) > 100
		if hasMore {
			events = events[:100]
		}
		nextAfterSeq := int64(0)
		if len(events) > 0 {
			nextAfterSeq = events[len(events)-1].Seq
		}
		view.ExecutionProcess = &ActionResultExecutionProcessView{Run: replay.Run, Events: events, NextAfterSeq: nextAfterSeq, HasMore: hasMore}
	}
	if plan, planErr := model.GetActionPlanForUser(ctx, aggregate.Record.Eid, aggregate.Record.OwnerID, aggregate.Record.PlanID); planErr == nil {
		for _, step := range plan.ExecutionSteps {
			view.ExecutionSteps = append(view.ExecutionSteps, actionsystem.ExecutionStep{Order: step.StepOrder, Title: step.Title, Description: step.Description})
		}
	} else if !errors.Is(planErr, gorm.ErrRecordNotFound) {
		return nil, planErr
	}
	if spec, specErr := resultSpecFromRun(ctx, aggregate.Record.Eid, aggregate.Record.RunID); specErr == nil {
		view.ResultSpec = spec
	} else if !errors.Is(specErr, gorm.ErrRecordNotFound) {
		return nil, specErr
	}
	view.SourceRefs = actionSourceRefsDomain(aggregate.SourceRefs)
	for _, ref := range aggregate.Artifacts {
		artifact := artifacts[ref.ArtifactID]
		if artifact == nil {
			continue
		}
		// 预览状态与 Review 路径共用同一个 ArtifactView，避免两套 preview 逻辑漂移。
		shared := artifactView(artifact.RunID, artifact)
		view.Artifacts = append(view.Artifacts, &ActionResultAssetArtifactView{
			ArtifactID: artifact.ArtifactID, RunID: artifact.RunID, Name: artifact.Name, MimeType: artifact.MimeType,
			Size: artifact.Size, DownloadURL: shared.DownloadURL, PreviewURL: shared.PreviewURL,
			PreviewStatus: shared.PreviewStatus, PreviewErrorCode: shared.PreviewErrorCode,
		})
	}
	// 原始会议来源入口：解析为可导航录音链接；evidence 正文不再下发（PLAN 7.3）。
	sourceLinks, err := s.resolveActionSourceLinks(ctx, aggregate.Record.Eid, collectActionMeetingSourceIDs(aggregate.Record.SourceMeetingID, actionSourceRefsDomain(aggregate.SourceRefs), evidenceRefsDomain(aggregate.EvidenceRefs)))
	if err != nil {
		return nil, err
	}
	view.SourceLinks = sourceLinks
	return view, nil
}

// resultSpecFromRun reads the Run's ResultSpec output. V1 keeps the spec as Run
// output, not as its own business entity.
func resultSpecFromRun(ctx context.Context, eid int64, runID string) (*ActionResultSpecView, error) {
	if strings.TrimSpace(runID) == "" {
		return nil, gorm.ErrRecordNotFound
	}
	run, err := model.GetActionRunByID(ctx, eid, runID)
	if err != nil {
		return nil, err
	}
	raw := strings.TrimSpace(string(run.OutputJSON))
	if raw == "" || raw == "{}" {
		return nil, gorm.ErrRecordNotFound
	}
	spec, err := actionruntime.ParseResultSpec([]byte(raw))
	if err != nil {
		return nil, err
	}
	return &ActionResultSpecView{ResultSpecVersion: spec.ResultSpecVersion, RendererVersion: spec.RendererVersion, TemplateVersion: spec.TemplateVersion, Status: model.ActionResultAssetStatusActive, Spec: spec}, nil
}
