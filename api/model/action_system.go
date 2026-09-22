package model

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"gorm.io/gorm"
)

const (
	ActionOpportunityStatusCandidate       = "candidate"
	ActionOpportunityStatusPlanning        = "planning"
	ActionOpportunityStatusAwaitingConfirm = "awaiting_confirmation"
	ActionOpportunityStatusLinked          = "linked"
	ActionOpportunityStatusDismissed       = "dismissed"
)

// ActionPlan lifecycle (V1): the plan is only a document the user edits and
// confirms. Execution progress/history lives on ActionRun; "accepted" and
// "archived_as_result" are not plan states.
const (
	ActionPlanStatusDraft      = "draft"
	ActionPlanStatusConfirmed  = "confirmed"
	ActionPlanStatusSuperseded = "superseded"
)


type ActionOpportunityRecord struct {
	ID                 int64   `json:"-" gorm:"primaryKey;autoIncrement"`
	OpportunityID      string  `json:"opportunity_id" gorm:"size:64;not null;uniqueIndex:uk_action_opportunities_id"`
	Eid                int64   `json:"-" gorm:"not null;index:idx_action_opportunities_scope,priority:1"`
	OwnerID            int64   `json:"-" gorm:"not null;index:idx_action_opportunities_scope,priority:2"`
	SourceType         string  `json:"source_type" gorm:"size:64;not null"`
	SourceID           string  `json:"source_id" gorm:"size:128;not null"`
	SourceInsightID    string  `json:"source_insight_id" gorm:"size:128;not null"`
	SourceMeetingID    string  `json:"source_meeting_id" gorm:"size:128;not null"`
	InsightGeneration  int64   `json:"insight_generation" gorm:"not null;default:0"`
	Title              string  `json:"title" gorm:"size:255;not null"`
	OpportunityType    string  `json:"type" gorm:"size:64;not null;index"`
	TypeLabel          string  `json:"type_label" gorm:"size:128;not null"`
	Reason             string  `json:"reason" gorm:"not null"`
	Objective          string  `json:"objective" gorm:"not null"`
	DisplayDeliverable string  `json:"display_deliverable" gorm:"size:255;not null"`
	HumanDependency    string  `json:"human_dependency" gorm:"size:255;not null"`
	AIExecutableScore  float64 `json:"ai_executable_score" gorm:"not null;default:0"`
	RiskLevel          string  `json:"risk_level" gorm:"size:16;not null;default:low"`
	Priority           int     `json:"priority" gorm:"not null;default:0;index"`
	Status             string  `json:"status" gorm:"size:32;not null;index:idx_action_opportunities_scope,priority:3"`
	DetectionVersion   string  `json:"detection_version" gorm:"size:32;not null;default:''"`
	// V1：opportunity 的快照子结构只作为 JSON 列存在，不再建子表。
	Deliverables []*ActionOpportunityDeliverableRecord `json:"deliverables,omitempty" gorm:"serializer:json;column:deliverables_json"`
	Capabilities []*ActionOpportunityCapabilityRecord  `json:"capabilities,omitempty" gorm:"serializer:json;column:capabilities_json"`
	BaseModel
}

func (ActionOpportunityRecord) TableName() string { return "action_opportunities" }

type ActionOpportunityDeliverableRecord struct {
	Type      string `json:"type"`
	Title     string `json:"title"`
	SortOrder int    `json:"sort_order"`
}

type ActionOpportunityCapabilityRecord struct {
	Capability string `json:"capability"`
	Status     string `json:"status"`
	Reason     string `json:"reason"`
}

type ActionPlanRecord struct {
	ID              int64  `json:"-" gorm:"primaryKey;autoIncrement"`
	PlanID          string `json:"plan_id" gorm:"size:64;not null;uniqueIndex:uk_action_plans_id"`
	Eid             int64  `json:"-" gorm:"not null;index:idx_action_plans_scope,priority:1"`
	OwnerID         int64  `json:"-" gorm:"not null;index:idx_action_plans_scope,priority:2"`
	OpportunityID   string `json:"opportunity_id" gorm:"size:64;not null;index:idx_action_plans_opportunity"`
	ActionID        string `json:"action_id,omitempty" gorm:"size:64;not null;default:'';index"`
	Status          string `json:"status" gorm:"size:32;not null;index:idx_action_plans_scope,priority:3"`
	Objective       string `json:"objective" gorm:"not null"`
	Background      string `json:"background" gorm:"not null"`
	Scope           string `json:"scope" gorm:"not null"`
	EstimatedEffort string `json:"estimated_effort" gorm:"size:64;not null;default:''"`
	Revision        int    `json:"revision" gorm:"not null;default:1"`
	ConfirmedBy     int64  `json:"-" gorm:"not null;default:0"`
	ConfirmedAt     int64  `json:"confirmed_at,omitempty" gorm:"not null;default:0"`
	// V1：plan 的 6 类子结构只作为 JSON 列存在，顺序即数组顺序，不再建 6 张子表。
	Deliverables       []*ActionPlanDeliverableRecord `json:"deliverables,omitempty" gorm:"serializer:json;column:deliverables_json"`
	ExecutionSteps     []*ActionPlanStepRecord        `json:"execution_steps,omitempty" gorm:"serializer:json;column:steps_json"`
	RequiredInputs     []*ActionPlanInputRecord       `json:"required_inputs,omitempty" gorm:"serializer:json;column:required_inputs_json"`
	Permissions        []*ActionPlanPermissionRecord  `json:"permissions,omitempty" gorm:"serializer:json;column:permissions_json"`
	AcceptanceCriteria []*ActionPlanAcceptanceRecord  `json:"acceptance_criteria,omitempty" gorm:"serializer:json;column:acceptance_criteria_json"`
	Risks              []*ActionPlanRiskRecord        `json:"risks,omitempty" gorm:"serializer:json;column:risks_json"`
	BaseModel
}

func (ActionPlanRecord) TableName() string { return "action_plans" }

type ActionPlanDeliverableRecord struct {
	Type      string `json:"type"`
	Title     string `json:"title"`
	// Format 是主交付物格式（docx/xlsx/pptx）；空值按旧契约回落到 docx。
	Format string `json:"format,omitempty"`
	// IsPrimary 标记唯一主交付物；旧方案没有该标记时按顺序回落到第一个。
	IsPrimary bool `json:"is_primary,omitempty"`
	SortOrder int  `json:"sort_order"`
}

type ActionPlanStepRecord struct {
	StepOrder   int    `json:"order"`
	Title       string `json:"title"`
	Description string `json:"description"`
}

type ActionPlanInputRecord struct {
	Name     string `json:"name"`
	Source   string `json:"source"`
	Required bool   `json:"required"`
}

type ActionPlanPermissionRecord struct {
	Capability string `json:"capability"`
	Resource   string `json:"resource"`
	Scope      string `json:"scope"`
	Approval   string `json:"approval"`
}

type ActionPlanAcceptanceRecord struct {
	CriterionOrder int    `json:"order"`
	Description    string `json:"description"`
}

type ActionPlanRiskRecord struct {
	RiskOrder   int    `json:"order"`
	Description string `json:"description"`
	Mitigation  string `json:"mitigation"`
}

type ActionOpportunityAggregate struct {
	Record       *ActionOpportunityRecord
	Deliverables []*ActionOpportunityDeliverableRecord
	Capabilities []*ActionOpportunityCapabilityRecord
	EvidenceRefs []*ActionEvidenceRefRecord
	SourceRefs   []*ActionSourceRefRecord
}

type ActionPlanAggregate struct {
	Record             *ActionPlanRecord
	Deliverables       []*ActionPlanDeliverableRecord
	ExecutionSteps     []*ActionPlanStepRecord
	RequiredInputs     []*ActionPlanInputRecord
	Permissions        []*ActionPlanPermissionRecord
	AcceptanceCriteria []*ActionPlanAcceptanceRecord
	Risks              []*ActionPlanRiskRecord
	SourceRefs         []*ActionSourceRefRecord
}

func GenerateActionOpportunityID() (string, error) { return generateActionID("action_opportunity_") }

func GenerateActionPlanID() (string, error) { return generateActionID("action_plan_") }

func CreateActionOpportunityAggregate(ctx context.Context, aggregate *ActionOpportunityAggregate) error {
	if aggregate == nil || aggregate.Record == nil {
		return fmt.Errorf("action opportunity is nil")
	}
	if aggregate.Record.OpportunityID == "" {
		id, err := GenerateActionOpportunityID()
		if err != nil {
			return err
		}
		aggregate.Record.OpportunityID = id
	}
	if aggregate.Record.Status == "" {
		aggregate.Record.Status = ActionOpportunityStatusCandidate
	}
	aggregate.Record.Deliverables = aggregate.Deliverables
	aggregate.Record.Capabilities = aggregate.Capabilities
	return DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(aggregate.Record).Error; err != nil {
			return err
		}
		if err := CreateActionEvidenceRefs(tx, aggregate.Record.Eid, ActionEvidenceOwnerOpportunity, aggregate.Record.OpportunityID, aggregate.EvidenceRefs); err != nil {
			return err
		}
		return createActionSourceRefs(tx, aggregate.Record.Eid, ActionSourceParentOpportunity, aggregate.Record.OpportunityID, aggregate.SourceRefs)
	})
}

func GetActionOpportunityForUser(ctx context.Context, eid, ownerID int64, opportunityID string) (*ActionOpportunityAggregate, error) {
	var record ActionOpportunityRecord
	if err := DB.WithContext(ctx).Where("eid = ? AND owner_id = ? AND opportunity_id = ?", eid, ownerID, opportunityID).First(&record).Error; err != nil {
		return nil, err
	}
	aggregate := &ActionOpportunityAggregate{Record: &record, Deliverables: record.Deliverables, Capabilities: record.Capabilities}
	evidence, err := ListActionEvidenceRefs(ctx, eid, ActionEvidenceOwnerOpportunity, opportunityID)
	if err != nil {
		return nil, err
	}
	aggregate.EvidenceRefs = evidence
	refs, err := ListActionSourceRefs(ctx, eid, ActionSourceParentOpportunity, opportunityID)
	if err != nil {
		return nil, err
	}
	aggregate.SourceRefs = refs
	return aggregate, nil
}

func ListActionOpportunitiesForUser(ctx context.Context, eid, ownerID int64, sourceType, sourceID string) ([]*ActionOpportunityAggregate, error) {
	var records []*ActionOpportunityRecord
	query := DB.WithContext(ctx).Where("eid = ? AND owner_id = ?", eid, ownerID)
	if sourceType != "" {
		query = query.Where("source_type = ?", sourceType)
	}
	if sourceID != "" {
		query = query.Where("source_id = ?", sourceID)
	}
	if err := query.Order("priority ASC, created_time ASC, id ASC").Find(&records).Error; err != nil {
		return nil, err
	}
	result := make([]*ActionOpportunityAggregate, 0, len(records))
	for _, record := range records {
		aggregate, err := GetActionOpportunityForUser(ctx, eid, ownerID, record.OpportunityID)
		if err != nil {
			return nil, err
		}
		result = append(result, aggregate)
	}
	return result, nil
}

func UpdateActionOpportunityStatus(ctx context.Context, eid, ownerID int64, opportunityID, status string) error {
	result := DB.WithContext(ctx).Model(&ActionOpportunityRecord{}).
		Where("eid = ? AND owner_id = ? AND opportunity_id = ?", eid, ownerID, opportunityID).
		Updates(map[string]interface{}{"status": status})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func MigrateActionOpportunitySource(ctx context.Context, eid, ownerID int64, opportunityID, sourceID, sourceInsightID, sourceMeetingID string, insightGeneration int64, refs []*ActionSourceRefRecord) error {
	if strings.TrimSpace(opportunityID) == "" || strings.TrimSpace(sourceID) == "" || strings.TrimSpace(sourceInsightID) == "" || strings.TrimSpace(sourceMeetingID) == "" {
		return fmt.Errorf("invalid action opportunity source")
	}
	return DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&ActionOpportunityRecord{}).
			Where("eid = ? AND owner_id = ? AND opportunity_id = ?", eid, ownerID, opportunityID).
			Updates(map[string]interface{}{"source_type": SourceTypeInsight, "source_id": sourceID, "source_insight_id": sourceInsightID, "source_meeting_id": sourceMeetingID, "insight_generation": insightGeneration})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		if err := tx.Where("eid = ? AND parent_type = ? AND parent_id = ?", eid, ActionSourceParentOpportunity, opportunityID).Delete(&ActionSourceRefRecord{}).Error; err != nil {
			return err
		}
		return createActionSourceRefs(tx, eid, ActionSourceParentOpportunity, opportunityID, refs)
	})
}

func CreateActionPlanAggregate(ctx context.Context, aggregate *ActionPlanAggregate) error {
	if aggregate == nil || aggregate.Record == nil {
		return fmt.Errorf("action plan is nil")
	}
	if aggregate.Record.PlanID == "" {
		id, err := GenerateActionPlanID()
		if err != nil {
			return err
		}
		aggregate.Record.PlanID = id
	}
	if aggregate.Record.Status == "" {
		aggregate.Record.Status = ActionPlanStatusDraft
	}
	if aggregate.Record.Revision == 0 {
		aggregate.Record.Revision = 1
	}
	writeActionPlanPayload(aggregate)
	return DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(aggregate.Record).Error; err != nil {
			return err
		}
		return createActionSourceRefs(tx, aggregate.Record.Eid, ActionSourceParentPlan, aggregate.Record.PlanID, aggregate.SourceRefs)
	})
}

// writeActionPlanPayload 把聚合的子结构写回 JSON 列（顺序即数组顺序）。
func writeActionPlanPayload(aggregate *ActionPlanAggregate) {
	aggregate.Record.Deliverables = aggregate.Deliverables
	aggregate.Record.ExecutionSteps = aggregate.ExecutionSteps
	aggregate.Record.RequiredInputs = aggregate.RequiredInputs
	aggregate.Record.Permissions = aggregate.Permissions
	aggregate.Record.AcceptanceCriteria = aggregate.AcceptanceCriteria
	aggregate.Record.Risks = aggregate.Risks
}

func GetActionPlanForUser(ctx context.Context, eid, ownerID int64, planID string) (*ActionPlanAggregate, error) {
	var record ActionPlanRecord
	if err := DB.WithContext(ctx).Table("action_plans AS ap").Select("ap.*").Joins("JOIN action_opportunities AS ao ON ao.eid = ap.eid AND ao.opportunity_id = ap.opportunity_id").Where("ap.eid = ? AND ap.owner_id = ? AND ap.plan_id = ?", eid, ownerID, planID).First(&record).Error; err != nil {
		return nil, err
	}
	aggregate := &ActionPlanAggregate{
		Record: &record, Deliverables: record.Deliverables, ExecutionSteps: record.ExecutionSteps,
		RequiredInputs: record.RequiredInputs, Permissions: record.Permissions,
		AcceptanceCriteria: record.AcceptanceCriteria, Risks: record.Risks,
	}
	refs, err := ListActionSourceRefs(ctx, eid, ActionSourceParentPlan, planID)
	if err != nil {
		return nil, err
	}
	aggregate.SourceRefs = refs
	return aggregate, nil
}

func ListActionPlansForUser(ctx context.Context, eid, ownerID int64) ([]*ActionPlanRecord, error) {
	var records []*ActionPlanRecord
	if err := DB.WithContext(ctx).Where("eid = ? AND owner_id = ?", eid, ownerID).
		Order("updated_time DESC, id DESC").Find(&records).Error; err != nil {
		return nil, err
	}
	return records, nil
}

func GetActionPlanByOpportunityForUser(ctx context.Context, eid, ownerID int64, opportunityID string) (*ActionPlanAggregate, error) {
	var record ActionPlanRecord
	if err := DB.WithContext(ctx).Where("eid = ? AND owner_id = ? AND opportunity_id = ?", eid, ownerID, opportunityID).
		Order("revision DESC, id DESC").First(&record).Error; err != nil {
		return nil, err
	}
	return GetActionPlanForUser(ctx, eid, ownerID, record.PlanID)
}

func UpdateActionPlanStatus(ctx context.Context, eid, ownerID int64, planID, status string) error {
	result := DB.WithContext(ctx).Model(&ActionPlanRecord{}).
		Where("eid = ? AND owner_id = ? AND plan_id = ?", eid, ownerID, planID).
		Updates(map[string]interface{}{"status": status})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func LinkActionPlanAction(ctx context.Context, eid, ownerID int64, planID, actionID string) error {
	result := DB.WithContext(ctx).Model(&ActionPlanRecord{}).
		Where("eid = ? AND owner_id = ? AND plan_id = ?", eid, ownerID, planID).
		Updates(map[string]interface{}{"action_id": actionID})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func ConfirmActionPlan(ctx context.Context, eid, ownerID int64, planID, actionID string, confirmedBy, confirmedAt int64) error {
	result := DB.WithContext(ctx).Model(&ActionPlanRecord{}).
		Where("eid = ? AND owner_id = ? AND plan_id = ? AND action_id = '' AND status = ?", eid, ownerID, planID, ActionPlanStatusDraft).
		Updates(map[string]interface{}{"action_id": actionID, "status": ActionPlanStatusConfirmed, "confirmed_by": confirmedBy, "confirmed_at": confirmedAt})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func GetActionPlanByActionID(ctx context.Context, eid int64, actionID string) (*ActionPlanRecord, error) {
	var plan ActionPlanRecord
	if err := DB.WithContext(ctx).Where("eid = ? AND action_id = ?", eid, actionID).Order("revision DESC, id DESC").First(&plan).Error; err != nil {
		return nil, err
	}
	return &plan, nil
}

func UpdateActionPlanStatusByAction(ctx context.Context, eid int64, actionID, status string) error {
	return DB.WithContext(ctx).Model(&ActionPlanRecord{}).
		Where("eid = ? AND action_id = ?", eid, actionID).
		Updates(map[string]interface{}{"status": status}).Error
}

func UpdateActionPlanAggregate(ctx context.Context, aggregate *ActionPlanAggregate) error {
	if aggregate == nil || aggregate.Record == nil || aggregate.Record.PlanID == "" {
		return fmt.Errorf("action plan is invalid")
	}
	aggregate.Record.Revision++
	writeActionPlanPayload(aggregate)
	payload, err := planPayloadJSON(aggregate.Record)
	if err != nil {
		return err
	}
	return DB.WithContext(ctx).Model(&ActionPlanRecord{}).
		Where("eid = ? AND plan_id = ?", aggregate.Record.Eid, aggregate.Record.PlanID).
		Updates(map[string]interface{}{
			"objective": aggregate.Record.Objective, "background": aggregate.Record.Background, "scope": aggregate.Record.Scope,
			"estimated_effort": aggregate.Record.EstimatedEffort, "revision": aggregate.Record.Revision,
			"deliverables_json": payload["deliverables_json"], "steps_json": payload["steps_json"],
			"required_inputs_json": payload["required_inputs_json"], "permissions_json": payload["permissions_json"],
			"acceptance_criteria_json": payload["acceptance_criteria_json"], "risks_json": payload["risks_json"],
		}).Error
}

// planPayloadJSON 把 6 类子结构序列化为 JSON 列值；空数组序列化为 []（保持"空数组"语义）。
func planPayloadJSON(record *ActionPlanRecord) (map[string]LongText, error) {
	fields := map[string]any{
		"deliverables_json": record.Deliverables, "steps_json": record.ExecutionSteps,
		"required_inputs_json": record.RequiredInputs, "permissions_json": record.Permissions,
		"acceptance_criteria_json": record.AcceptanceCriteria, "risks_json": record.Risks,
	}
	out := make(map[string]LongText, len(fields))
	for column, value := range fields {
		raw, err := json.Marshal(nonNilPayload(value))
		if err != nil {
			return nil, err
		}
		out[column] = LongText(raw)
	}
	return out, nil
}

// nonNilPayload 保证 nil 切片写为 [] 而不是 null。
func nonNilPayload(value any) any {
	switch typed := value.(type) {
	case []*ActionPlanDeliverableRecord:
		if typed == nil {
			return []*ActionPlanDeliverableRecord{}
		}
	case []*ActionPlanStepRecord:
		if typed == nil {
			return []*ActionPlanStepRecord{}
		}
	case []*ActionPlanInputRecord:
		if typed == nil {
			return []*ActionPlanInputRecord{}
		}
	case []*ActionPlanPermissionRecord:
		if typed == nil {
			return []*ActionPlanPermissionRecord{}
		}
	case []*ActionPlanAcceptanceRecord:
		if typed == nil {
			return []*ActionPlanAcceptanceRecord{}
		}
	case []*ActionPlanRiskRecord:
		if typed == nil {
			return []*ActionPlanRiskRecord{}
		}
	}
	return value
}
