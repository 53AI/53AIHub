package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/actionsystem"
	"golang.org/x/sync/singleflight"
	"gorm.io/gorm"
)

const (
	ActionOpportunitySourceInsight        = model.SourceTypeInsight
	ActionOpportunitySourceMeetingInsight = "meeting_insight"
	actionOpportunityDetectionVersion     = "llm-v1-gated"
	maxOpportunityExcerpt                 = 12000
)

var (
	ErrActionOpportunityNotFound    = errors.New("action opportunity not found")
	ErrActionPlanNotFound           = errors.New("action plan not found")
	ErrActionOpportunityState       = errors.New("action opportunity state does not allow this operation")
	ErrActionPlanState              = errors.New("action plan state does not allow this operation")
	ErrActionCapabilityUnavailable  = errors.New("action capability is unavailable")
	ErrActionOpportunityUnavailable = errors.New("action opportunity generation is unavailable")
	ErrActionPlanInvalid            = errors.New("action plan is invalid")
	ErrActionPlanGenerationFailed   = errors.New("plan_generation_failed")
	ErrActionQualityNotReady        = errors.New("action plan is not ready for acceptance")
	ErrActionResultAssetNotFound    = errors.New("action result asset not found")
	// 主交付物契约（命名 + 格式）错误：命名权威是用户已确认的 Plan，冲突必须
	// 让 Plan 修正，不能静默改名或降级格式。
	ErrActionPrimaryArtifactMissing      = actionsystem.ErrDeliverableMissing
	ErrActionMultiplePrimaryArtifacts    = actionsystem.ErrDeliverableAmbiguous
	ErrActionPrimaryArtifactTitleInvalid = actionsystem.ErrDeliverableTitleInvalid
	ErrActionArtifactFormatUnsupported   = actionsystem.ErrDeliverableFormatUnsupported
	ErrActionArtifactTitleFormatConflict = actionsystem.ErrDeliverableTitleFormatConflict
)

var recordingActionOpportunityDetectionGroup singleflight.Group

type ActionOpportunityView struct {
	OpportunityID        string                     `json:"opportunity_id"`
	SourceType           string                     `json:"source_type"`
	SourceID             string                     `json:"source_id"`
	SourceInsightID      string                     `json:"source_insight_id"`
	SourceMeetingID      string                     `json:"source_meeting_id"`
	InsightGeneration    int64                      `json:"insight_generation"`
	Title                string                     `json:"title"`
	Type                 string                     `json:"type"`
	TypeLabel            string                     `json:"type_label"`
	Reason               string                     `json:"reason"`
	Objective            string                     `json:"objective"`
	Deliverables         []actionsystem.Deliverable `json:"deliverables"`
	DisplayDeliverable   string                     `json:"display_deliverable"`
	RequiredCapabilities []string                   `json:"required_capabilities"`
	HumanDependency      string                     `json:"human_dependency"`
	AIExecutableScore    float64                    `json:"ai_executable_score"`
	RiskLevel            string                     `json:"risk_level"`
	Priority             int                        `json:"priority"`
	Status               string                     `json:"status"`
	SourceLinks          []*ActionSourceLinkView    `json:"source_links,omitempty"`
	SourceRefs           []actionsystem.SourceRef   `json:"source_refs"`
	CreatedTime          int64                      `json:"created_time"`
	UpdatedTime          int64                      `json:"updated_time"`
}

type ActionPlanView struct {
	PlanID               string                             `json:"plan_id"`
	OpportunityID        string                             `json:"opportunity_id"`
	ActionID             string                             `json:"action_id,omitempty"`
	Status               string                             `json:"status"`
	Objective            string                             `json:"objective"`
	Background           string                             `json:"background"`
	Scope                string                             `json:"scope"`
	Deliverables         []actionsystem.Deliverable         `json:"deliverables"`
	ExecutionSteps       []actionsystem.ExecutionStep       `json:"execution_steps"`
	RequiredInputs       []actionsystem.RequiredInput       `json:"required_inputs"`
	RequiredCapabilities []string                           `json:"required_capabilities"`
	Permissions          []actionsystem.Permission          `json:"permissions"`
	AcceptanceCriteria   []actionsystem.AcceptanceCriterion `json:"acceptance_criteria"`
	Risks                []actionsystem.Risk                `json:"risks"`
	EstimatedEffort      string                             `json:"estimated_effort"`
	Revision             int                                `json:"revision"`
	ConfirmedAt          int64                              `json:"confirmed_at,omitempty"`
	SourceInsightID      string                             `json:"source_insight_id"`
	SourceMeetingID      string                             `json:"source_meeting_id"`
	SourceLinks          []*ActionSourceLinkView            `json:"source_links,omitempty"`
	SourceRefs           []actionsystem.SourceRef           `json:"source_refs"`
	ResultAsset          *ActionResultAssetView             `json:"result_asset,omitempty"`
	ActionIntent         actionsystem.ActionIntent          `json:"action_intent"`
	CreatedTime          int64                              `json:"created_time"`
	UpdatedTime          int64                              `json:"updated_time"`
	// ActionSummary 是 Plan 列表上的 Action 执行摘要投影：列表业务状态唯一权威是
	// Action.status；latest_run 只补充 Run 身份、执行事实、liveness 与导航目标。
	ActionSummary *ActionPlanActionSummaryView `json:"action_summary,omitempty"`
}

// ActionPlanLatestRunSummaryView 是 Plan 列表用的 Run 摘要（不替代 Run 详情接口）。
type ActionPlanLatestRunSummaryView struct {
	RunID          string `json:"run_id"`
	Status         string `json:"status"`
	LastActivityAt int64  `json:"last_activity_at,omitempty"`
	StartedAt      int64  `json:"started_at,omitempty"`
	CompletedAt    int64  `json:"completed_at,omitempty"`
}

// ActionPlanActionSummaryView 是只读的执行摘要：action_id 用于进入详情，
// status 是业务状态权威，latest_run 用于「进入执行过程 / 查看成果」导航。
type ActionPlanActionSummaryView struct {
	ActionID      string                          `json:"action_id"`
	Status        string                          `json:"status"`
	LatestRun     *ActionPlanLatestRunSummaryView `json:"latest_run,omitempty"`
	ResultAssetID string                          `json:"result_asset_id,omitempty"`
}

type UpdateActionPlanRequest struct {
	Objective          string                             `json:"objective" binding:"required"`
	Background         string                             `json:"background" binding:"required"`
	Scope              string                             `json:"scope" binding:"required"`
	Deliverables       []actionsystem.Deliverable         `json:"deliverables" binding:"required,min=1"`
	ExecutionSteps     []actionsystem.ExecutionStep       `json:"execution_steps" binding:"required,min=1"`
	RequiredInputs     []actionsystem.RequiredInput       `json:"required_inputs"`
	AcceptanceCriteria []actionsystem.AcceptanceCriterion `json:"acceptance_criteria" binding:"required,min=1"`
	Risks              []actionsystem.Risk                `json:"risks"`
	EstimatedEffort    string                             `json:"estimated_effort"`
}

type ActionPlanConfirmationView struct {
	Plan   *ActionPlanView `json:"plan"`
	Action *ActionView     `json:"action"`
	Run    *ActionRunView  `json:"run"`
}

func (s *ActionRuntimeService) DetectInsightActionOpportunities(ctx context.Context, eid, userID, fileID int64) ([]*ActionOpportunityView, error) {
	_, err := GetViewableRecordingFile(ctx, eid, userID, fileID)
	if err != nil {
		return nil, mapActionNotFound(err, ErrActionOpportunityNotFound)
	}
	key := recordingActionOpportunityDetectionKey(eid, userID, fileID)
	result, err, _ := recordingActionOpportunityDetectionGroup.Do(key, func() (interface{}, error) {
		lease, leaseErr := acquireActionOpportunityDetectionLease(ctx, eid, userID, fileID)
		if leaseErr != nil {
			return nil, leaseErr
		}
		defer func() {
			if releaseErr := lease.Release(); releaseErr != nil {
				logger.Warnf(ctx, "【行动建议】释放自动发现锁失败：fileID=%d eid=%d err=%v", fileID, eid, releaseErr)
			}
		}()
		return s.detectInsightActionOpportunities(ctx, eid, userID, fileID)
	})
	if err != nil {
		return nil, err
	}
	opportunities, ok := result.([]*ActionOpportunityView)
	if !ok {
		return nil, ErrActionOpportunityUnavailable
	}
	return opportunities, nil
}

func (s *ActionRuntimeService) detectInsightActionOpportunities(ctx context.Context, eid, userID, fileID int64) ([]*ActionOpportunityView, error) {
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
	sourceInsightID, sourceMeetingID, sourceRefs, err := ensureRecordingActionSources(ctx, eid, fileID, file.InsightGeneration, "", "")
	if err != nil {
		return nil, err
	}
	legacySourceID, err := encodeActionID(fileID)
	if err != nil {
		return nil, err
	}
	existing, listErr := model.ListActionOpportunitiesForUser(ctx, eid, userID, ActionOpportunitySourceInsight, sourceInsightID)
	if listErr != nil {
		return nil, listErr
	}
	if len(existing) == 0 {
		legacy, legacyErr := model.ListActionOpportunitiesForUser(ctx, eid, userID, ActionOpportunitySourceMeetingInsight, legacySourceID)
		if legacyErr != nil {
			return nil, legacyErr
		}
		for _, aggregate := range legacy {
			if err := model.MigrateActionOpportunitySource(ctx, eid, userID, aggregate.Record.OpportunityID, sourceInsightID, sourceInsightID, sourceMeetingID, file.InsightGeneration, sourceRefs); err != nil {
				return nil, err
			}
		}
		existing, listErr = model.ListActionOpportunitiesForUser(ctx, eid, userID, ActionOpportunitySourceInsight, sourceInsightID)
		if listErr != nil {
			return nil, listErr
		}
	}
	for _, aggregate := range existing {
		if aggregate.Record.InsightGeneration == file.InsightGeneration {
			return s.opportunityViews(ctx, eid, existing)
		}
	}
	background, err := GetInsightBackground(ctx, eid, userID, fileID)
	if err != nil {
		if errors.Is(err, ErrInsightContextForbidden) {
			return nil, ErrActionForbidden
		}
		return nil, err
	}
	registry := actionCapabilityRegistry()
	config, err := model.ValidateOrCreateRecordingConfig(eid)
	if err != nil {
		return nil, err
	}
	input := actionsystem.DetectionInput{
		SourceType:        ActionOpportunitySourceInsight,
		SourceID:          sourceInsightID,
		SourceInsightID:   sourceInsightID,
		SourceMeetingID:   sourceMeetingID,
		InsightGeneration: file.InsightGeneration,
		InsightSummary:    insight,
		MaterialContext:   background.MaterialContext,
		SourceRefs:        actionSourceRefsDomain(sourceRefs),
		EvidenceRefs: []actionsystem.EvidenceRef{
			{SourceType: model.SourceTypeInsight, SourceID: sourceInsightID, Excerpt: truncateActionText(insight, maxOpportunityExcerpt)},
			{SourceType: model.SourceTypeMeeting, SourceID: sourceMeetingID, Excerpt: truncateActionText(background.MaterialContext, maxOpportunityExcerpt)},
		},
	}
	if s.opportunityGenerator == nil {
		return nil, ErrActionOpportunityUnavailable
	}
	opportunities, err := s.opportunityGenerator.Generate(ctx, config, input, registry)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrActionOpportunityUnavailable, err)
	}
	latestFile, err := model.GetFileByID(eid, fileID, ctx)
	if err != nil {
		return nil, err
	}
	if latestFile == nil || latestFile.InsightGeneration != file.InsightGeneration {
		return nil, ErrActionInsightChanged
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

func (s *ActionRuntimeService) GetActionOpportunity(ctx context.Context, eid, userID int64, opportunityID string) (*ActionOpportunityView, error) {
	aggregate, err := model.GetActionOpportunityForUser(ctx, eid, userID, strings.TrimSpace(opportunityID))
	if err != nil {
		return nil, mapActionNotFound(err, ErrActionOpportunityNotFound)
	}
	return s.actionOpportunityView(ctx, eid, aggregate)
}

func (s *ActionRuntimeService) ListActionOpportunities(ctx context.Context, eid, userID int64) ([]*ActionOpportunityView, error) {
	aggregates, err := model.ListActionOpportunitiesForUser(ctx, eid, userID, "", "")
	if err != nil {
		return nil, err
	}
	return s.opportunityViews(ctx, eid, aggregates)
}

// PatchActionOpportunity 是机会状态唯一写入口（candidate ↔ dismissed）。
func (s *ActionRuntimeService) PatchActionOpportunity(ctx context.Context, eid, userID int64, opportunityID, status string) (*ActionOpportunityView, error) {
	if status != model.ActionOpportunityStatusCandidate && status != model.ActionOpportunityStatusDismissed {
		return nil, ErrActionInvalidRequest
	}
	aggregate, err := model.GetActionOpportunityForUser(ctx, eid, userID, strings.TrimSpace(opportunityID))
	if err != nil {
		return nil, mapActionNotFound(err, ErrActionOpportunityNotFound)
	}
	if aggregate.Record.Status == status {
		return s.actionOpportunityView(ctx, eid, aggregate)
	}
	if status == model.ActionOpportunityStatusDismissed && aggregate.Record.Status != model.ActionOpportunityStatusCandidate {
		return nil, ErrActionOpportunityState
	}
	if err := model.UpdateActionOpportunityStatus(ctx, eid, userID, opportunityID, status); err != nil {
		return nil, err
	}
	aggregate.Record.Status = status
	return s.actionOpportunityView(ctx, eid, aggregate)
}

func (s *ActionRuntimeService) CreateActionPlan(ctx context.Context, eid, userID int64, opportunityID string) (*ActionPlanView, error) {
	opportunity, err := model.GetActionOpportunityForUser(ctx, eid, userID, strings.TrimSpace(opportunityID))
	if err != nil {
		return nil, mapActionNotFound(err, ErrActionOpportunityNotFound)
	}
	if existing, getErr := model.GetActionPlanByOpportunityForUser(ctx, eid, userID, opportunityID); getErr == nil {
		return s.actionPlanView(ctx, eid, userID, existing)
	} else if !errors.Is(getErr, gorm.ErrRecordNotFound) {
		return nil, getErr
	}
	if opportunity.Record.Status == model.ActionOpportunityStatusDismissed {
		return nil, ErrActionOpportunityState
	}
	registry := actionCapabilityRegistry()
	capabilities := opportunityCapabilities(opportunity)
	if !registry.Available(capabilities) {
		return nil, ErrActionCapabilityUnavailable
	}
	sourceContext, err := s.sourceContextForOpportunity(ctx, eid, userID, opportunity)
	if err != nil {
		return nil, err
	}
	planningInput := actionsystem.DetectionInput{
		SourceType: sourceContext.Input.SourceType, SourceID: sourceContext.Input.SourceID, ContextLabel: sourceContext.Input.ContextLabel,
		SourceInsightID: sourceContext.Input.SourceInsightID, SourceMeetingID: sourceContext.Input.SourceMeetingID, InsightGeneration: sourceContext.Input.InsightGeneration,
		InsightSummary: sourceContext.Input.InsightSummary, MaterialContext: sourceContext.Input.MaterialContext,
		SourceRefs: sourceContext.Input.SourceRefs, EvidenceRefs: sourceContext.Input.EvidenceRefs,
	}
	plan, err := buildAlignedActionPlan(opportunityDomain(opportunity), planningInput)
	if err != nil {
		return nil, err
	}
	plan.ID, err = model.GenerateActionPlanID()
	if err != nil {
		return nil, err
	}
	aggregate := planAggregate(eid, userID, plan)
	if err := model.CreateActionPlanAggregate(ctx, aggregate); err != nil {
		return nil, err
	}
	if err := model.UpdateActionOpportunityStatus(ctx, eid, userID, opportunityID, model.ActionOpportunityStatusPlanning); err != nil {
		return nil, err
	}
	return s.actionPlanView(ctx, eid, userID, aggregate)
}

func (s *ActionRuntimeService) GetActionPlan(ctx context.Context, eid, userID int64, planID string) (*ActionPlanView, error) {
	aggregate, err := model.GetActionPlanForUser(ctx, eid, userID, strings.TrimSpace(planID))
	if err != nil {
		return nil, mapActionNotFound(err, ErrActionPlanNotFound)
	}
	view, err := s.actionPlanView(ctx, eid, userID, aggregate)
	if err != nil {
		return nil, err
	}
	// 详情与列表共用同一份执行摘要契约，单条 Plan 不产生额外 N+1。
	summaries, err := listActionSummaries(ctx, eid, []*model.ActionPlanRecord{aggregate.Record})
	if err != nil {
		return nil, err
	}
	if summary, ok := summaries[aggregate.Record.PlanID]; ok {
		view.ActionSummary = summary
	}
	return view, nil
}

func (s *ActionRuntimeService) ListActionPlans(ctx context.Context, eid, userID int64) ([]*ActionPlanView, error) {
	records, err := model.ListActionPlansForUser(ctx, eid, userID)
	if err != nil {
		return nil, err
	}
	summaries, err := listActionSummaries(ctx, eid, records)
	if err != nil {
		return nil, err
	}
	plans := make([]*ActionPlanView, 0, len(records))
	for _, record := range records {
		aggregate, getErr := model.GetActionPlanForUser(ctx, eid, userID, record.PlanID)
		if getErr != nil {
			return nil, getErr
		}
		view, viewErr := s.actionPlanView(ctx, eid, userID, aggregate)
		if viewErr != nil {
			return nil, viewErr
		}
		if summary, ok := summaries[record.PlanID]; ok {
			view.ActionSummary = summary
		}
		plans = append(plans, view)
	}
	return plans, nil
}

// listActionSummaries 用固定 3 次批量查询补齐整页 Plan 的执行摘要
// （plan_ids → actions → latest runs → result assets），
// 让 App 不必为每张卡再发一次 GET /api/actions/:id。
func listActionSummaries(ctx context.Context, eid int64, records []*model.ActionPlanRecord) (map[string]*ActionPlanActionSummaryView, error) {
	summaries := make(map[string]*ActionPlanActionSummaryView, len(records))
	actionIDs := make([]string, 0, len(records))
	for _, record := range records {
		if record != nil && record.ActionID != "" {
			actionIDs = append(actionIDs, record.ActionID)
		}
	}
	if len(actionIDs) == 0 {
		return summaries, nil
	}
	actions, err := model.GetActionsByIDs(ctx, eid, actionIDs)
	if err != nil {
		return nil, err
	}
	runs, err := model.GetLatestActionRunsByActionIDs(ctx, eid, actionIDs)
	if err != nil {
		return nil, err
	}
	assets, err := model.GetActionResultAssetsByActionIDs(ctx, eid, actionIDs)
	if err != nil {
		return nil, err
	}
	for _, record := range records {
		if record == nil || record.ActionID == "" {
			continue
		}
		action := actions[record.ActionID]
		if action == nil {
			continue
		}
		summary := &ActionPlanActionSummaryView{ActionID: action.ActionID, Status: action.Status}
		if run := runs[action.ActionID]; run != nil {
			summary.LatestRun = &ActionPlanLatestRunSummaryView{
				RunID:          run.RunID,
				Status:         run.Status,
				LastActivityAt: run.LastActivityAt,
				StartedAt:      run.StartedAt,
				CompletedAt:    run.FinishedAt,
			}
		}
		if asset := assets[action.ActionID]; asset != nil {
			summary.ResultAssetID = asset.ResultAssetID
		}
		summaries[record.PlanID] = summary
	}
	return summaries, nil
}

func (s *ActionRuntimeService) UpdateActionPlan(ctx context.Context, eid, userID int64, planID string, req UpdateActionPlanRequest) (*ActionPlanView, error) {
	aggregate, err := model.GetActionPlanForUser(ctx, eid, userID, strings.TrimSpace(planID))
	if err != nil {
		return nil, mapActionNotFound(err, ErrActionPlanNotFound)
	}
	if aggregate.Record.Status != model.ActionPlanStatusDraft {
		return nil, ErrActionPlanState
	}
	if err := validateActionPlanRequest(req); err != nil {
		return nil, err
	}
	aggregate.Record.Objective = strings.TrimSpace(req.Objective)
	aggregate.Record.Background = strings.TrimSpace(req.Background)
	aggregate.Record.Scope = strings.TrimSpace(req.Scope)
	aggregate.Record.EstimatedEffort = strings.TrimSpace(req.EstimatedEffort)
	aggregate.Deliverables = make([]*model.ActionPlanDeliverableRecord, 0, len(req.Deliverables))
	for index, item := range req.Deliverables {
		format, _ := actionsystem.ParseDeliverableFormat(string(item.Format))
		aggregate.Deliverables = append(aggregate.Deliverables, &model.ActionPlanDeliverableRecord{
			Type: strings.TrimSpace(item.Type), Title: strings.TrimSpace(item.Title),
			Format: string(format), IsPrimary: item.IsPrimary, SortOrder: index,
		})
	}
	// 每次编辑后都收敛成「有且只有一个 primary」：旧方案没有标记时第一个交付物
	// 就是 primary，多标记时按顺序保留第一个，避免把歧义留给执行期。
	markPrimaryDeliverable(aggregate.Deliverables)
	aggregate.ExecutionSteps = make([]*model.ActionPlanStepRecord, 0, len(req.ExecutionSteps))
	for index, item := range req.ExecutionSteps {
		aggregate.ExecutionSteps = append(aggregate.ExecutionSteps, &model.ActionPlanStepRecord{StepOrder: index + 1, Title: strings.TrimSpace(item.Title), Description: strings.TrimSpace(item.Description)})
	}
	aggregate.RequiredInputs = make([]*model.ActionPlanInputRecord, 0, len(req.RequiredInputs))
	for _, item := range req.RequiredInputs {
		aggregate.RequiredInputs = append(aggregate.RequiredInputs, &model.ActionPlanInputRecord{Name: strings.TrimSpace(item.Name), Source: strings.TrimSpace(item.Source), Required: item.Required})
	}
	aggregate.AcceptanceCriteria = make([]*model.ActionPlanAcceptanceRecord, 0, len(req.AcceptanceCriteria))
	for index, item := range req.AcceptanceCriteria {
		aggregate.AcceptanceCriteria = append(aggregate.AcceptanceCriteria, &model.ActionPlanAcceptanceRecord{CriterionOrder: index + 1, Description: strings.TrimSpace(item.Description)})
	}
	aggregate.Risks = make([]*model.ActionPlanRiskRecord, 0, len(req.Risks))
	for index, item := range req.Risks {
		aggregate.Risks = append(aggregate.Risks, &model.ActionPlanRiskRecord{RiskOrder: index + 1, Description: strings.TrimSpace(item.Description), Mitigation: strings.TrimSpace(item.Mitigation)})
	}
	if err := model.UpdateActionPlanAggregate(ctx, aggregate); err != nil {
		return nil, err
	}
	return s.actionPlanView(ctx, eid, userID, aggregate)
}

func (s *ActionRuntimeService) ConfirmActionPlan(ctx context.Context, eid, userID int64, planID string) (*ActionPlanConfirmationView, error) {
	aggregate, err := model.GetActionPlanForUser(ctx, eid, userID, strings.TrimSpace(planID))
	if err != nil {
		return nil, mapActionNotFound(err, ErrActionPlanNotFound)
	}
	if aggregate.Record.Status != model.ActionPlanStatusDraft && aggregate.Record.Status != model.ActionPlanStatusConfirmed {
		return nil, ErrActionPlanState
	}
	if strings.TrimSpace(aggregate.Record.ActionID) != "" && aggregate.Record.Status != model.ActionPlanStatusConfirmed {
		return nil, ErrActionPlanState
	}
	opportunity, err := model.GetActionOpportunityForUser(ctx, eid, userID, aggregate.Record.OpportunityID)
	if err != nil {
		return nil, mapActionNotFound(err, ErrActionOpportunityNotFound)
	}
	if !actionCapabilityRegistry().Available(opportunityCapabilities(opportunity)) {
		return nil, ErrActionCapabilityUnavailable
	}
	sourceContext, err := s.sourceContextForOpportunity(ctx, eid, userID, opportunity)
	if err != nil {
		return nil, err
	}
	runtimeConfig := s.config()
	if err := validateRuntimeConfig(runtimeConfig, ActionTypeExecutePlan); err != nil {
		return nil, err
	}
	snapshot := sourceContext.Snapshot
	snapshot.CapturedAt = time.Now().UTC().UnixMilli()
	contextJSON, err := json.Marshal(snapshot)
	if err != nil {
		return nil, fmt.Errorf("serialize action context: %w", err)
	}
	// 幂等：Plan 已 confirmed 且有既有 Run → 直接返回，不新建 Task/Run（弱网重复 confirm）。
	if aggregate.Record.Status == model.ActionPlanStatusConfirmed && strings.TrimSpace(aggregate.Record.ActionID) != "" {
		if action, taskErr := model.GetActionForUser(ctx, eid, userID, aggregate.Record.ActionID); taskErr == nil {
			runs, listErr := model.ListActionRunsByAction(ctx, eid, action.ActionID)
			if listErr != nil {
				return nil, listErr
			}
			if len(runs) > 0 {
				actionView, viewErr := s.actionView(action)
				if viewErr != nil {
					return nil, viewErr
				}
				runView, viewErr := s.runView(ctx, runs[len(runs)-1])
				if viewErr != nil {
					return nil, viewErr
				}
				planView, viewErr := s.actionPlanView(ctx, eid, userID, aggregate)
				if viewErr != nil {
					return nil, viewErr
				}
				return &ActionPlanConfirmationView{Plan: planView, Action: actionView, Run: runView}, nil
			}
		}
	}
	actionID, err := model.GenerateActionID()
	if err != nil {
		return nil, err
	}
	// Plan confirm 前的主交付物校验：命名与格式都由用户确认过的 Plan 决定，
	// Action 的 ExpectedArtifacts 不再写死系统文件名。
	contract, err := canonicalPrimaryArtifact(aggregate)
	if err != nil {
		return nil, err
	}
	action := &model.ActionRecord{
		ActionID: actionID, Eid: eid, OwnerID: userID, SourceFileID: snapshot.SourceFileID,
		ActionType: ActionTypeExecutePlan, Status: model.ActionStatusDraft,
		Title: aggregate.Record.Objective, Prompt: model.LongText(buildActionPlanPrompt(opportunityDomain(opportunity), actionPlanDomain(aggregate), contract)),
		ContextJSON: model.LongText(contextJSON), ExpectedArtifactsJSON: model.LongText(expectedArtifactsJSON(contract.Filename)), Runtime: "codex",
	}
	if err := model.CreateActionRecord(ctx, action); err != nil {
		return nil, err
	}
	_ = model.UpdateActionOpportunityStatus(ctx, eid, userID, opportunity.Record.OpportunityID, model.ActionOpportunityStatusLinked)
	// 同一事务内完成：Plan → confirmed、Action → executing、创建唯一 active Run。
	// 弱网重复 confirm 会幂等返回已有 Run，不会创建第二个。
	confirmation, err := s.startActionRun(ctx, eid, userID, action.ActionID, runStartOptions{
		reason:                "confirm",
		planID:                aggregate.Record.PlanID,
		allowedActionStatuses: []string{model.ActionStatusDraft, model.ActionStatusReadyToConfirm},
	})
	if err != nil {
		return nil, err
	}
	updatedPlan, err := model.GetActionPlanForUser(ctx, eid, userID, aggregate.Record.PlanID)
	if err != nil {
		return nil, err
	}
	planView, err := s.actionPlanView(ctx, eid, userID, updatedPlan)
	if err != nil {
		return nil, err
	}
	return &ActionPlanConfirmationView{Plan: planView, Action: confirmation.Action, Run: confirmation.Run}, nil
}

func validateActionPlanRequest(req UpdateActionPlanRequest) error {
	if strings.TrimSpace(req.Objective) == "" || strings.TrimSpace(req.Background) == "" || strings.TrimSpace(req.Scope) == "" {
		return ErrActionPlanInvalid
	}
	for _, item := range req.Deliverables {
		if strings.TrimSpace(item.Type) == "" || strings.TrimSpace(item.Title) == "" {
			return ErrActionPlanInvalid
		}
		if _, ok := actionsystem.ParseDeliverableFormat(string(item.Format)); !ok {
			return ErrActionArtifactFormatUnsupported
		}
	}
	for _, item := range req.ExecutionSteps {
		if strings.TrimSpace(item.Title) == "" || strings.TrimSpace(item.Description) == "" {
			return ErrActionPlanInvalid
		}
	}
	for _, item := range req.AcceptanceCriteria {
		if strings.TrimSpace(item.Description) == "" {
			return ErrActionPlanInvalid
		}
	}
	return nil
}

func buildAlignedActionPlan(opportunity actionsystem.ActionOpportunity, input actionsystem.DetectionInput) (actionsystem.ActionPlan, error) {
	intent := actionsystem.BuildActionIntent(opportunity, input)
	var lastErr error
	for attempt := 0; attempt < 2; attempt++ {
		plan := actionsystem.BuildActionPlan(opportunity, input)
		if err := actionsystem.PlanAlignmentGate(intent, plan); err == nil {
			return plan, nil
		} else {
			lastErr = err
		}
	}
	return actionsystem.ActionPlan{}, fmt.Errorf("%w: %v", ErrActionPlanGenerationFailed, lastErr)
}

func actionCapabilityRegistry() actionsystem.StaticCapabilityRegistry {
	config := ActionRuntimeConfigFromEnv()
	deepResearchVerified := envBool("ACTION_RUNTIME_CAPABILITY_DEEP_RESEARCH_VERIFIED", false)
	registry := actionsystem.DefaultCapabilityRegistry(deepResearchVerified)
	if config.Enabled && strings.TrimSpace(config.CodexHome) != "" && strings.TrimSpace(config.MinCodexVersion) != "" && strings.TrimSpace(config.WorkRoot) != "" && strings.TrimSpace(config.ArtifactRoot) != "" {
		return registry
	}
	return actionsystem.NewStaticCapabilityRegistry(
		actionsystem.Capability{Key: actionsystem.CapabilityEnterpriseContext, Label: "读取 Host 提供的企业上下文", Status: actionsystem.CapabilityAvailable},
		actionsystem.Capability{Key: actionsystem.CapabilityDocumentGeneration, Label: "生成并交付文档", Status: actionsystem.CapabilityUnavailable, Reason: "Action Runtime 尚未完成运行环境配置"},
	)
}

func opportunityAggregate(eid, userID int64, opportunity actionsystem.ActionOpportunity) *model.ActionOpportunityAggregate {
	aggregate := &model.ActionOpportunityAggregate{Record: &model.ActionOpportunityRecord{
		OpportunityID: opportunity.ID, Eid: eid, OwnerID: userID, SourceType: opportunity.SourceType, SourceID: opportunity.SourceID,
		SourceInsightID: opportunity.SourceInsightID, SourceMeetingID: opportunity.SourceMeetingID, InsightGeneration: opportunity.InsightGeneration,
		Title: opportunity.Title, OpportunityType: string(opportunity.Type), TypeLabel: opportunity.TypeLabel, Reason: opportunity.Reason,
		Objective: opportunity.Objective, DisplayDeliverable: opportunity.DisplayDeliverable, HumanDependency: opportunity.HumanDependency,
		AIExecutableScore: opportunity.AIExecutableScore, RiskLevel: opportunity.RiskLevel, Priority: opportunity.Priority, Status: model.ActionOpportunityStatusCandidate,
	}}
	for index, item := range opportunity.Deliverables {
		aggregate.Deliverables = append(aggregate.Deliverables, &model.ActionOpportunityDeliverableRecord{Type: item.Type, Title: item.Title, SortOrder: index})
	}
	for _, key := range opportunity.RequiredCapabilities {
		status := string(actionsystem.CapabilityUnavailable)
		reason := "能力未注册"
		if capability, ok := actionCapabilityRegistry().Get(key); ok {
			status, reason = string(capability.Status), capability.Reason
		}
		aggregate.Capabilities = append(aggregate.Capabilities, &model.ActionOpportunityCapabilityRecord{Capability: key, Status: status, Reason: reason})
	}
	for _, item := range opportunity.EvidenceRefs {
		aggregate.EvidenceRefs = append(aggregate.EvidenceRefs, &model.ActionEvidenceRefRecord{SourceType: item.SourceType, SourceID: item.SourceID, SegmentID: item.SegmentID, Excerpt: item.Excerpt, Timestamp: item.Timestamp, Position: item.Position})
	}
	aggregate.SourceRefs = actionSourceRefsRecords(opportunity.SourceRefs)
	return aggregate
}

func planAggregate(eid, userID int64, plan actionsystem.ActionPlan) *model.ActionPlanAggregate {
	aggregate := &model.ActionPlanAggregate{Record: &model.ActionPlanRecord{
		PlanID: plan.ID, Eid: eid, OwnerID: userID, OpportunityID: plan.OpportunityID, Status: model.ActionPlanStatusDraft,
		Objective: plan.Objective, Background: plan.Background, Scope: plan.Scope, EstimatedEffort: plan.EstimatedEffort, Revision: 1,
	}}
	for index, item := range plan.Deliverables {
		format, _ := actionsystem.ParseDeliverableFormat(string(item.Format))
		aggregate.Deliverables = append(aggregate.Deliverables, &model.ActionPlanDeliverableRecord{
			Type: item.Type, Title: item.Title, Format: string(format), IsPrimary: item.IsPrimary, SortOrder: index,
		})
	}
	for _, item := range plan.ExecutionSteps {
		aggregate.ExecutionSteps = append(aggregate.ExecutionSteps, &model.ActionPlanStepRecord{StepOrder: item.Order, Title: item.Title, Description: item.Description})
	}
	for _, item := range plan.RequiredInputs {
		aggregate.RequiredInputs = append(aggregate.RequiredInputs, &model.ActionPlanInputRecord{Name: item.Name, Source: item.Source, Required: item.Required})
	}
	for _, item := range plan.Permissions {
		aggregate.Permissions = append(aggregate.Permissions, &model.ActionPlanPermissionRecord{Capability: item.Capability, Resource: item.Resource, Scope: item.Scope, Approval: item.Approval})
	}
	for _, item := range plan.AcceptanceCriteria {
		aggregate.AcceptanceCriteria = append(aggregate.AcceptanceCriteria, &model.ActionPlanAcceptanceRecord{CriterionOrder: item.Order, Description: item.Description})
	}
	for _, item := range plan.Risks {
		aggregate.Risks = append(aggregate.Risks, &model.ActionPlanRiskRecord{RiskOrder: item.Order, Description: item.Description, Mitigation: item.Mitigation})
	}
	aggregate.SourceRefs = actionSourceRefsRecords(plan.SourceRefs)
	return aggregate
}

func opportunityDomain(aggregate *model.ActionOpportunityAggregate) actionsystem.ActionOpportunity {
	result := actionsystem.ActionOpportunity{ID: aggregate.Record.OpportunityID, SourceType: aggregate.Record.SourceType, SourceID: aggregate.Record.SourceID, SourceInsightID: aggregate.Record.SourceInsightID, SourceMeetingID: aggregate.Record.SourceMeetingID, InsightGeneration: aggregate.Record.InsightGeneration, Title: aggregate.Record.Title, Type: actionsystem.OpportunityType(aggregate.Record.OpportunityType), TypeLabel: aggregate.Record.TypeLabel, Reason: aggregate.Record.Reason, Objective: aggregate.Record.Objective, DisplayDeliverable: aggregate.Record.DisplayDeliverable, HumanDependency: aggregate.Record.HumanDependency, AIExecutableScore: aggregate.Record.AIExecutableScore, RiskLevel: aggregate.Record.RiskLevel, Priority: aggregate.Record.Priority, SourceRefs: actionSourceRefsDomain(aggregate.SourceRefs)}
	for _, item := range aggregate.Deliverables {
		result.Deliverables = append(result.Deliverables, actionsystem.Deliverable{Type: item.Type, Title: item.Title})
	}
	for _, item := range aggregate.Capabilities {
		result.RequiredCapabilities = append(result.RequiredCapabilities, item.Capability)
	}
	for _, item := range aggregate.EvidenceRefs {
		result.EvidenceRefs = append(result.EvidenceRefs, actionsystem.EvidenceRef{SourceType: item.SourceType, SourceID: item.SourceID, SegmentID: item.SegmentID, Excerpt: item.Excerpt, Timestamp: item.Timestamp, Position: item.Position})
	}
	return result
}

func opportunityCapabilities(aggregate *model.ActionOpportunityAggregate) []string {
	result := make([]string, 0, len(aggregate.Capabilities))
	for _, item := range aggregate.Capabilities {
		result = append(result, item.Capability)
	}
	return result
}

func actionOpportunityFileID(ctx context.Context, record *model.ActionOpportunityRecord) (int64, error) {
	if record == nil {
		return 0, fmt.Errorf("unsupported action opportunity source")
	}
	if record.SourceType == ActionOpportunitySourceMeetingInsight {
		return hashids.TryParseID(record.SourceID)
	}
	if record.SourceType != ActionOpportunitySourceInsight {
		return 0, fmt.Errorf("unsupported action opportunity source")
	}
	identity, err := model.GetCanonicalSourceIdentity(ctx, record.Eid, record.SourceID)
	if err != nil || identity.LegacySourceType != model.LegacySourceTypeRecordingFile {
		return 0, fmt.Errorf("action opportunity source identity not found")
	}
	return strconv.ParseInt(identity.LegacySourceID, 10, 64)
}

// expectedArtifactsJSON 序列化 Action 的交付物契约。V1.1 只有一个主交付物，
// 名字来自 Plan，不再写死 action-result.docx。
func expectedArtifactsJSON(filename string) string {
	encoded, _ := json.Marshal([]string{filename})
	return string(encoded)
}

// planDeliverableDomains 把持久化的 deliverable 记录读成业务契约：旧记录没有
// format 时按 legacy 契约回落到 docx，不要求数据库批量迁移。
func planDeliverableDomains(records []*model.ActionPlanDeliverableRecord) []actionsystem.Deliverable {
	deliverables := make([]actionsystem.Deliverable, 0, len(records))
	for _, item := range records {
		if item == nil {
			continue
		}
		format, _ := actionsystem.ParseDeliverableFormat(item.Format)
		deliverables = append(deliverables, actionsystem.Deliverable{
			Type: item.Type, Title: strings.TrimSpace(item.Title), Format: format, IsPrimary: item.IsPrimary,
		})
	}
	return deliverables
}

// markPrimaryDeliverable 收敛一个 Run 的主交付物：有且只有一个 is_primary。
func markPrimaryDeliverable(records []*model.ActionPlanDeliverableRecord) {
	primary := -1
	for index, item := range records {
		if item == nil || !item.IsPrimary {
			continue
		}
		if primary < 0 {
			primary = index
			continue
		}
		item.IsPrimary = false
	}
	if primary < 0 {
		for index, item := range records {
			if item != nil && strings.TrimSpace(item.Title) != "" {
				item.IsPrimary = true
				primary = index
				break
			}
		}
	}
}

// primaryPlanDeliverable 解析 Plan 的唯一主交付物：显式 is_primary 优先，旧方案
// （没有 is_primary）按 sort_order 最小的 deliverable 作为 primary。
func primaryPlanDeliverable(aggregate *model.ActionPlanAggregate) (actionsystem.Deliverable, error) {
	if aggregate == nil || aggregate.Record == nil {
		return actionsystem.Deliverable{}, ErrActionPlanNotFound
	}
	records := make([]*model.ActionPlanDeliverableRecord, 0, len(aggregate.Deliverables))
	for _, item := range aggregate.Deliverables {
		if item != nil {
			records = append(records, item)
		}
	}
	sort.SliceStable(records, func(i, j int) bool { return records[i].SortOrder < records[j].SortOrder })
	ordered := planDeliverableDomains(records)
	primary, err := actionsystem.PrimaryDeliverable(ordered)
	if err != nil {
		return actionsystem.Deliverable{}, err
	}
	return primary, nil
}

// canonicalPrimaryArtifact 是「Host 在调用 Codex 之前就知道要交付什么」的唯一
// 计算入口：标题与格式都来自用户已确认的 Plan。
type canonicalPrimaryArtifactContract struct {
	Title    string
	Format   actionsystem.DeliverableFormat
	Filename string
}

func canonicalPrimaryArtifact(aggregate *model.ActionPlanAggregate) (canonicalPrimaryArtifactContract, error) {
	primary, err := primaryPlanDeliverable(aggregate)
	if err != nil {
		return canonicalPrimaryArtifactContract{}, err
	}
	filename, err := actionsystem.CanonicalArtifactFilename(primary.Title, primary.Format)
	if err != nil {
		return canonicalPrimaryArtifactContract{}, err
	}
	return canonicalPrimaryArtifactContract{Title: primary.Title, Format: primary.Format, Filename: filename}, nil
}

func actionPlanDomain(aggregate *model.ActionPlanAggregate) actionsystem.ActionPlan {
	plan := actionsystem.ActionPlan{
		ID: aggregate.Record.PlanID, OpportunityID: aggregate.Record.OpportunityID,
		Objective: aggregate.Record.Objective, Background: aggregate.Record.Background,
		Scope: aggregate.Record.Scope, EstimatedEffort: aggregate.Record.EstimatedEffort,
		SourceRefs: actionSourceRefsDomain(aggregate.SourceRefs),
	}
	plan.Deliverables = planDeliverableDomains(aggregate.Deliverables)
	for _, item := range aggregate.ExecutionSteps {
		plan.ExecutionSteps = append(plan.ExecutionSteps, actionsystem.ExecutionStep{Order: item.StepOrder, Title: item.Title, Description: item.Description})
	}
	for _, item := range aggregate.RequiredInputs {
		plan.RequiredInputs = append(plan.RequiredInputs, actionsystem.RequiredInput{Name: item.Name, Source: item.Source, Required: item.Required})
	}
	for _, item := range aggregate.Permissions {
		plan.Permissions = append(plan.Permissions, actionsystem.Permission{Capability: item.Capability, Resource: item.Resource, Scope: item.Scope, Approval: item.Approval})
	}
	for _, item := range aggregate.AcceptanceCriteria {
		plan.AcceptanceCriteria = append(plan.AcceptanceCriteria, actionsystem.AcceptanceCriterion{Order: item.CriterionOrder, Description: item.Description})
	}
	for _, item := range aggregate.Risks {
		plan.Risks = append(plan.Risks, actionsystem.Risk{Order: item.RiskOrder, Description: item.Description, Mitigation: item.Mitigation})
	}
	return plan
}

func buildActionPlanPrompt(opportunity actionsystem.ActionOpportunity, plan actionsystem.ActionPlan, contract canonicalPrimaryArtifactContract) string {
	var builder strings.Builder
	builder.WriteString("这是一个已经由用户确认的二号总裁 Action。请按以下 ActionPlan 执行，不要把人工待办、对外承诺或尚未确认的建议写成已发生事实。\n\n")
	builder.WriteString("<action_intent>\n这是用户确认的不可漂移边界：\n目标：" + opportunity.Objective + "\n行动类型：" + string(opportunity.Type) + "\n期望交付物：\n")
	for _, item := range opportunity.Deliverables {
		builder.WriteString("- " + item.Type + "：" + item.Title + "\n")
	}
	builder.WriteString("如果执行过程中发现输入不足，只能标注缺口，不能改成另一个目标或交付物。\n</action_intent>\n\n")
	builder.WriteString("<action_plan>\n目标：" + plan.Objective + "\n范围：" + plan.Scope + "\n")
	builder.WriteString("交付物：\n")
	for _, item := range plan.Deliverables {
		builder.WriteString("- " + item.Type + "：" + item.Title + "\n")
	}
	builder.WriteString("执行步骤：\n")
	for _, item := range plan.ExecutionSteps {
		builder.WriteString(fmt.Sprintf("%d. %s：%s\n", item.Order, item.Title, item.Description))
	}
	builder.WriteString("验收标准：\n")
	for _, item := range plan.AcceptanceCriteria {
		builder.WriteString("- " + item.Description + "\n")
	}
	builder.WriteString("风险：\n")
	for _, item := range plan.Risks {
		builder.WriteString("- " + item.Description + "；缓解：" + item.Mitigation + "\n")
	}
	builder.WriteString("</action_plan>\n\n")
	builder.WriteString("<source_trace>\nsource_insight_id：" + opportunity.SourceInsightID + "\nsource_meeting_id：" + opportunity.SourceMeetingID + "\n</source_trace>\n\n")
	if len(opportunity.EvidenceRefs) > 0 {
		builder.WriteString("<evidence_refs>\n")
		for _, evidence := range opportunity.EvidenceRefs {
			builder.WriteString("- " + evidence.SourceType + " / " + evidence.SourceID + "：" + truncateActionText(evidence.Excerpt, maxOpportunityExcerpt) + "\n")
		}
		builder.WriteString("</evidence_refs>\n\n")
	}
	builder.WriteString("当前 Run 只产出一个 Primary Business Artifact：\n")
	builder.WriteString("标题：" + contract.Title + "\n格式：" + strings.ToUpper(string(contract.Format)) + "\n文件名：" + contract.Filename + "\n")
	builder.WriteString("只生成这一个文件，检查清单、附录、数据表都作为它的一部分；真实格式必须与扩展名一致（不允许把 txt/csv/markdown 改扩展名）。不要调用 LibreOffice、GUI、预览或转换命令——Host 负责真实性校验、Host 侧的 canonical 命名、Artifact Persist 和 PDF 预览。生成后立即结束。")
	return builder.String()
}

func (s *ActionRuntimeService) actionOpportunityView(ctx context.Context, eid int64, aggregate *model.ActionOpportunityAggregate) (*ActionOpportunityView, error) {
	if aggregate == nil || aggregate.Record == nil {
		return nil, ErrActionOpportunityNotFound
	}
	view := &ActionOpportunityView{
		OpportunityID: aggregate.Record.OpportunityID, SourceType: aggregate.Record.SourceType, SourceID: aggregate.Record.SourceID,
		SourceInsightID: aggregate.Record.SourceInsightID, SourceMeetingID: aggregate.Record.SourceMeetingID, InsightGeneration: aggregate.Record.InsightGeneration,
		Title: aggregate.Record.Title, Type: aggregate.Record.OpportunityType, TypeLabel: aggregate.Record.TypeLabel, Reason: aggregate.Record.Reason,
		Objective: aggregate.Record.Objective, DisplayDeliverable: aggregate.Record.DisplayDeliverable, HumanDependency: aggregate.Record.HumanDependency,
		AIExecutableScore: aggregate.Record.AIExecutableScore, RiskLevel: aggregate.Record.RiskLevel, Priority: aggregate.Record.Priority, Status: aggregate.Record.Status,
		CreatedTime: aggregate.Record.CreatedTime, UpdatedTime: aggregate.Record.UpdatedTime,
	}
	for _, item := range aggregate.Deliverables {
		view.Deliverables = append(view.Deliverables, actionsystem.Deliverable{Type: item.Type, Title: item.Title})
	}
	for _, item := range aggregate.Capabilities {
		view.RequiredCapabilities = append(view.RequiredCapabilities, item.Capability)
	}
	// 原始会议来源入口：解析为可导航录音链接；evidence 正文不再下发（PLAN 7.3）。
	sourceLinks, err := s.resolveActionSourceLinks(ctx, eid, collectActionMeetingSourceIDs(aggregate.Record.SourceMeetingID, actionSourceRefsDomain(aggregate.SourceRefs), evidenceRefsDomain(aggregate.EvidenceRefs)))
	if err != nil {
		return nil, err
	}
	view.SourceLinks = sourceLinks
	view.SourceRefs = actionSourceRefsDomain(aggregate.SourceRefs)
	return view, nil
}

func (s *ActionRuntimeService) opportunityViews(ctx context.Context, eid int64, aggregates []*model.ActionOpportunityAggregate) ([]*ActionOpportunityView, error) {
	views := make([]*ActionOpportunityView, 0, len(aggregates))
	for _, aggregate := range aggregates {
		view, err := s.actionOpportunityView(ctx, eid, aggregate)
		if err != nil {
			return nil, err
		}
		views = append(views, view)
	}
	return views, nil
}

func (s *ActionRuntimeService) actionPlanView(ctx context.Context, eid, userID int64, aggregate *model.ActionPlanAggregate) (*ActionPlanView, error) {
	if aggregate == nil || aggregate.Record == nil {
		return nil, ErrActionPlanNotFound
	}
	opportunity, err := model.GetActionOpportunityForUser(ctx, eid, userID, aggregate.Record.OpportunityID)
	if err != nil {
		return nil, mapActionNotFound(err, ErrActionOpportunityNotFound)
	}
	view := &ActionPlanView{PlanID: aggregate.Record.PlanID, OpportunityID: aggregate.Record.OpportunityID, ActionID: aggregate.Record.ActionID, Status: aggregate.Record.Status, Objective: aggregate.Record.Objective, Background: aggregate.Record.Background, Scope: aggregate.Record.Scope, EstimatedEffort: aggregate.Record.EstimatedEffort, Revision: aggregate.Record.Revision, ConfirmedAt: aggregate.Record.ConfirmedAt, SourceInsightID: opportunity.Record.SourceInsightID, SourceMeetingID: opportunity.Record.SourceMeetingID, ActionIntent: actionIntentForOpportunity(opportunity), CreatedTime: aggregate.Record.CreatedTime, UpdatedTime: aggregate.Record.UpdatedTime}
	for _, item := range planDeliverableDomains(aggregate.Deliverables) {
		view.Deliverables = append(view.Deliverables, item)
	}
	for _, item := range aggregate.ExecutionSteps {
		view.ExecutionSteps = append(view.ExecutionSteps, actionsystem.ExecutionStep{Order: item.StepOrder, Title: item.Title, Description: item.Description})
	}
	for _, item := range aggregate.RequiredInputs {
		view.RequiredInputs = append(view.RequiredInputs, actionsystem.RequiredInput{Name: item.Name, Source: item.Source, Required: item.Required})
	}
	for _, item := range capabilitiesFromOpportunity(opportunity) {
		view.RequiredCapabilities = append(view.RequiredCapabilities, item)
	}
	for _, item := range aggregate.Permissions {
		view.Permissions = append(view.Permissions, actionsystem.Permission{Capability: item.Capability, Resource: item.Resource, Scope: item.Scope, Approval: item.Approval})
	}
	for _, item := range aggregate.AcceptanceCriteria {
		view.AcceptanceCriteria = append(view.AcceptanceCriteria, actionsystem.AcceptanceCriterion{Order: item.CriterionOrder, Description: item.Description})
	}
	for _, item := range aggregate.Risks {
		view.Risks = append(view.Risks, actionsystem.Risk{Order: item.RiskOrder, Description: item.Description, Mitigation: item.Mitigation})
	}
	// 原始会议来源入口：解析为可导航录音链接；evidence 正文不再下发（PLAN 7.3）。
	sourceLinks, err := s.resolveActionSourceLinks(ctx, eid, collectActionMeetingSourceIDs(opportunity.Record.SourceMeetingID, actionSourceRefsDomain(aggregate.SourceRefs), evidenceRefsDomain(opportunity.EvidenceRefs)))
	if err != nil {
		return nil, err
	}
	view.SourceLinks = sourceLinks
	view.SourceRefs = actionSourceRefsDomain(aggregate.SourceRefs)
	if result, resultErr := model.GetActionResultAssetByPlanForUser(ctx, eid, userID, aggregate.Record.PlanID); resultErr == nil {
		view.ResultAsset, resultErr = s.actionResultAssetView(ctx, result)
		if resultErr != nil {
			return nil, resultErr
		}
	} else if !errors.Is(resultErr, gorm.ErrRecordNotFound) {
		return nil, resultErr
	}
	return view, nil
}

func actionIntentForOpportunity(opportunity *model.ActionOpportunityAggregate) actionsystem.ActionIntent {
	if opportunity == nil || opportunity.Record == nil {
		return actionsystem.ActionIntent{}
	}
	contextLabel := "会议洞察"
	if opportunity.Record.SourceType == model.SourceTypeConversation {
		contextLabel = "会话深聊结论"
	} else if opportunity.Record.SourceType == model.SourceTypeResult {
		contextLabel = "已沉淀成果"
	}
	// ActionIntent 只保来源身份结构，正文 excerpt 不下发（PLAN 7.3）。
	evidence := make([]actionsystem.EvidenceRef, 0, len(opportunity.EvidenceRefs))
	for _, item := range opportunity.EvidenceRefs {
		if item == nil {
			continue
		}
		evidence = append(evidence, actionsystem.EvidenceRef{
			SourceType: item.SourceType, SourceID: item.SourceID, SegmentID: item.SegmentID,
			Timestamp: item.Timestamp, Position: item.Position,
		})
	}
	return actionsystem.BuildActionIntent(opportunityDomain(opportunity), actionsystem.DetectionInput{
		ContextLabel: contextLabel,
		EvidenceRefs: evidence,
	})
}

func evidenceRefsDomain(refs []*model.ActionEvidenceRefRecord) []actionsystem.EvidenceRef {
	result := make([]actionsystem.EvidenceRef, 0, len(refs))
	for _, item := range refs {
		if item == nil {
			continue
		}
		result = append(result, actionsystem.EvidenceRef{SourceType: item.SourceType, SourceID: item.SourceID, SegmentID: item.SegmentID, Excerpt: item.Excerpt, Timestamp: item.Timestamp, Position: item.Position})
	}
	return result
}

func capabilitiesFromOpportunity(opportunity *model.ActionOpportunityAggregate) []string {
	result := make([]string, 0, len(opportunity.Capabilities))
	for _, item := range opportunity.Capabilities {
		result = append(result, item.Capability)
	}
	return result
}

func truncateActionText(value string, limit int) string {
	value = strings.TrimSpace(value)
	if len([]rune(value)) <= limit {
		return value
	}
	return string([]rune(value)[:limit]) + "\n[内容过长，已截断]"
}
