package service

import (
	"context"
	"errors"

	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

// ActionItemView is one business identity across proposal -> action -> result.
// Plan/Run/Result remain technical/asset children and are navigated by their IDs.
type ActionItemView struct {
	ItemID          string                 `json:"item_id"`
	OpportunityID   string                 `json:"opportunity_id"`
	Title           string                 `json:"title"`
	Type            string                 `json:"type"`
	TypeLabel       string                 `json:"type_label"`
	Stage           string                 `json:"stage"`
	ProgressStatus  string                 `json:"progress_status"`
	IsRead          bool                   `json:"is_read"`
	IsTrashed       bool                   `json:"is_trashed"`
	IsStale         bool                   `json:"is_stale"`
	SourceType      string                 `json:"source_type"`
	SourceID        string                 `json:"source_id"`
	SourceInsightID string                 `json:"source_insight_id"`
	SourceMeetingID string                 `json:"source_meeting_id"`
	SourceRefs      []ActionSourceRefView  `json:"source_refs,omitempty"`
	PlanID          string                 `json:"plan_id,omitempty"`
	ActionID        string                 `json:"action_id,omitempty"`
	RunID           string                 `json:"run_id,omitempty"`
	ResultAssetID   string                 `json:"result_asset_id,omitempty"`
	Opportunity     *ActionOpportunityView `json:"opportunity,omitempty"`
	Plan            *ActionPlanView        `json:"plan,omitempty"`
	Result          *ActionResultAssetView `json:"result,omitempty"`
	CreatedTime     int64                  `json:"created_time"`
	UpdatedTime     int64                  `json:"updated_time"`
}

type ActionSourceRefView struct {
	Role          string `json:"role"`
	SourceType    string `json:"source_type"`
	CanonicalID   string `json:"canonical_id"`
	SourceVersion string `json:"source_version,omitempty"`
}

type ActionItemCounts struct {
	Proposal        int64 `json:"proposal"`
	Action          int64 `json:"action"`
	Result          int64 `json:"result"`
	Trash           int64 `json:"trash"`
	UnreadProposals int64 `json:"unread_proposals"`
}

type ActionItemPage struct {
	Items    []*ActionItemView `json:"items"`
	Total    int64             `json:"total"`
	Page     int               `json:"page"`
	PageSize int               `json:"page_size"`
	Counts   ActionItemCounts  `json:"counts"`
}

func (s *ActionRuntimeService) actionItemView(ctx context.Context, eid, ownerID int64, record *model.ActionOpportunityRecord) (*ActionItemView, error) {
	item := &ActionItemView{
		ItemID: record.OpportunityID, OpportunityID: record.OpportunityID,
		Title: record.Title, Type: record.OpportunityType, TypeLabel: record.TypeLabel,
		Stage: record.Stage, IsRead: record.IsRead, IsTrashed: record.IsTrashed,
		SourceType: record.SourceType, SourceID: record.SourceID,
		SourceMeetingID: record.SourceMeetingID, SourceInsightID: record.SourceInsightID,
		CreatedTime: record.CreatedTime, UpdatedTime: record.UpdatedTime, ProgressStatus: record.Status,
	}
	refs, err := model.ListActionSourceRefs(ctx, eid, model.ActionSourceParentOpportunity, record.OpportunityID)
	if err != nil {
		return nil, err
	}
	for _, ref := range refs {
		item.SourceRefs = append(item.SourceRefs, ActionSourceRefView{Role: ref.Role, SourceType: ref.SourceType, CanonicalID: ref.CanonicalID, SourceVersion: ref.SourceVersion})
	}
	opportunity, err := model.GetActionOpportunityForUser(ctx, eid, ownerID, record.OpportunityID)
	if err != nil {
		return nil, err
	}
	item.Opportunity, err = s.actionOpportunityView(ctx, eid, opportunity)
	if err != nil {
		return nil, err
	}
	// An unplanned meeting proposal is no longer executable after the insight is regenerated.
	// Mark it for the UI without mutating or deleting historical opportunity records.
	if record.Stage == model.ActionItemStageProposal && (record.SourceType == model.SourceTypeInsight || record.SourceType == ActionOpportunitySourceMeetingInsight) {
		fileID, sourceErr := actionOpportunityFileID(ctx, record)
		if sourceErr == nil {
			file, fileErr := model.GetFileByID(eid, fileID, ctx)
			if fileErr != nil && !errors.Is(fileErr, gorm.ErrRecordNotFound) {
				return nil, fileErr
			}
			item.IsStale = file == nil || record.InsightGeneration != file.InsightGeneration
		}
	}
	plan, err := model.GetActionPlanForBusinessItem(ctx, eid, ownerID, record.OpportunityID, record.Stage)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return item, nil
	}
	if err != nil {
		return nil, err
	}
	item.PlanID = plan.Record.PlanID
	// A plan already created from historical evidence must remain navigable.
	item.IsStale = false
	item.Plan, err = s.actionPlanView(ctx, eid, ownerID, plan)
	if err != nil {
		return nil, err
	}
	item.ActionID = plan.Record.ActionID
	if record.Stage == model.ActionItemStageProposal {
		item.ProgressStatus = plan.Record.Status
	}
	if plan.Record.ActionID != "" {
		summaries, summaryErr := listActionSummaries(ctx, eid, []*model.ActionPlanRecord{plan.Record})
		if summaryErr != nil {
			return nil, summaryErr
		}
		if summary := summaries[plan.Record.PlanID]; summary != nil {
			item.ProgressStatus = summary.Status
			if summary.LatestRun != nil {
				item.RunID = summary.LatestRun.RunID
			}
			item.ResultAssetID = summary.ResultAssetID
			item.Plan.ActionSummary = summary
			if summary.ResultAssetID != "" {
				asset, assetErr := model.GetActionResultAssetForUser(ctx, eid, ownerID, summary.ResultAssetID)
				if assetErr != nil {
					return nil, assetErr
				}
				item.Result, assetErr = s.actionResultAssetView(ctx, asset)
				if assetErr != nil {
					return nil, assetErr
				}
			}
		}
	}
	return item, nil
}

func (s *ActionRuntimeService) GetActionItem(ctx context.Context, eid, ownerID int64, itemID string) (*ActionItemView, error) {
	source, err := model.GetActionOpportunityForUser(ctx, eid, ownerID, itemID)
	if err != nil {
		return nil, mapActionNotFound(err, ErrActionOpportunityNotFound)
	}
	return s.actionItemView(ctx, eid, ownerID, source.Record)
}

func (s *ActionRuntimeService) ListActionItems(ctx context.Context, eid, ownerID int64, filter model.ActionItemFilter) (*ActionItemPage, error) {
	if filter.Page < 1 {
		filter.Page = 1
	}
	if filter.PageSize < 1 {
		filter.PageSize = 20
	}
	if filter.PageSize > 100 {
		filter.PageSize = 100
	}
	records, total, err := model.ListActionItemsForUserPage(ctx, eid, ownerID, filter)
	if err != nil {
		return nil, err
	}
	items := make([]*ActionItemView, 0, len(records))
	for _, record := range records {
		view, viewErr := s.actionItemView(ctx, eid, ownerID, record)
		if viewErr != nil {
			return nil, viewErr
		}
		items = append(items, view)
	}
	countFilter := filter
	countFilter.Status = ""
	countFilter.Read = "" // tab counts describe all unread/read records, not only the selected read filter
	countFilter.Stage = ""
	countFilter.Trashed = false
	countFilter.Page = 1
	countFilter.PageSize = 1
	counts := ActionItemCounts{}
	for _, entry := range []struct {
		stage  string
		target *int64
	}{
		{model.ActionItemStageProposal, &counts.Proposal},
		{model.ActionItemStageAction, &counts.Action},
		{model.ActionItemStageResult, &counts.Result},
	} {
		countFilter.Stage = entry.stage
		_, count, countErr := model.ListActionItemsForUserPage(ctx, eid, ownerID, countFilter)
		if countErr != nil {
			return nil, countErr
		}
		*entry.target = count
	}
	countFilter.Stage = model.ActionItemStageProposal
	countFilter.Read = "unread"
	_, counts.UnreadProposals, err = model.ListActionItemsForUserPage(ctx, eid, ownerID, countFilter)
	if err != nil {
		return nil, err
	}
	countFilter.Read = ""
	countFilter.Stage = ""
	countFilter.Trashed = true
	_, counts.Trash, err = model.ListActionItemsForUserPage(ctx, eid, ownerID, countFilter)
	if err != nil {
		return nil, err
	}
	return &ActionItemPage{Items: items, Total: total, Page: filter.Page, PageSize: filter.PageSize, Counts: counts}, nil
}
