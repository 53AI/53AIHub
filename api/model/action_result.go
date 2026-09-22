package model

import (
	"context"
	"fmt"

	"gorm.io/gorm"
)

const (
	ActionResultAssetStatusActive   = "active"
	ActionResultAssetStatusArchived = "archived"
)

type ActionResultAssetRecord struct {
	ID              int64    `json:"-" gorm:"primaryKey;autoIncrement"`
	ResultAssetID   string   `json:"result_asset_id" gorm:"size:64;not null;uniqueIndex:uk_action_result_assets_id"`
	Eid             int64    `json:"-" gorm:"not null;index:idx_action_result_assets_scope,priority:1"`
	OwnerID         int64    `json:"-" gorm:"not null;index:idx_action_result_assets_scope,priority:2"`
	PlanID          string   `json:"plan_id" gorm:"size:64;not null;uniqueIndex:uk_action_result_assets_plan,priority:1"`
	ActionID        string   `json:"action_id" gorm:"size:64;not null"`
	RunID           string   `json:"run_id" gorm:"size:64;not null;uniqueIndex:uk_action_result_assets_run"`
	OpportunityID   string   `json:"opportunity_id" gorm:"size:64;not null;index"`
	SourceInsightID string   `json:"source_insight_id" gorm:"size:128;not null"`
	SourceMeetingID string   `json:"source_meeting_id" gorm:"size:128;not null"`
	Title           string   `json:"title" gorm:"size:255;not null"`
	ResultType      string   `json:"result_type" gorm:"size:64;not null"`
	Summary         LongText `json:"summary" gorm:"not null"`
	Status          string   `json:"status" gorm:"size:32;not null;index:idx_action_result_assets_scope,priority:3"`
	BaseModel
}

func (ActionResultAssetRecord) TableName() string { return "action_result_assets" }

type ActionResultAssetAggregate struct {
	Record       *ActionResultAssetRecord
	Artifacts    []*ActionArtifactRecord
	EvidenceRefs []*ActionEvidenceRefRecord
	SourceRefs   []*ActionSourceRefRecord
}

func GenerateActionResultAssetID() (string, error) { return generateActionID("action_result_") }

func CreateActionResultAssetAggregate(ctx context.Context, aggregate *ActionResultAssetAggregate) error {
	if aggregate == nil || aggregate.Record == nil || aggregate.Record.ResultAssetID == "" {
		return fmt.Errorf("action result asset is invalid")
	}
	return DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(aggregate.Record).Error; err != nil {
			return err
		}
		if err := CreateActionEvidenceRefs(tx, aggregate.Record.Eid, ActionEvidenceOwnerResultAsset, aggregate.Record.ResultAssetID, aggregate.EvidenceRefs); err != nil {
			return err
		}
		return createActionSourceRefs(tx, aggregate.Record.Eid, ActionSourceParentResultAsset, aggregate.Record.ResultAssetID, aggregate.SourceRefs)
	})
}

func GetActionResultAssetForUser(ctx context.Context, eid, ownerID int64, resultAssetID string) (*ActionResultAssetAggregate, error) {
	var record ActionResultAssetRecord
	if err := DB.WithContext(ctx).Where("eid = ? AND owner_id = ? AND result_asset_id = ?", eid, ownerID, resultAssetID).First(&record).Error; err != nil {
		return nil, err
	}
	artifacts, err := ListActionArtifactsByRun(ctx, eid, record.RunID)
	if err != nil {
		return nil, err
	}
	evidence, err := ListActionEvidenceRefs(ctx, eid, ActionEvidenceOwnerResultAsset, resultAssetID)
	if err != nil {
		return nil, err
	}
	refs, err := ListActionSourceRefs(ctx, eid, ActionSourceParentResultAsset, resultAssetID)
	if err != nil {
		return nil, err
	}
	return &ActionResultAssetAggregate{Record: &record, Artifacts: artifacts, EvidenceRefs: evidence, SourceRefs: refs}, nil
}

// GetActionResultAssetByRunForUser makes acceptance idempotent per run: repeated
// accept requests return the same ResultAsset instead of creating another one.
func GetActionResultAssetByRunForUser(ctx context.Context, eid, ownerID int64, runID string) (*ActionResultAssetAggregate, error) {
	var record ActionResultAssetRecord
	if err := DB.WithContext(ctx).Where("eid = ? AND owner_id = ? AND run_id = ?", eid, ownerID, runID).
		Order("id DESC").First(&record).Error; err != nil {
		return nil, err
	}
	return GetActionResultAssetForUser(ctx, eid, ownerID, record.ResultAssetID)
}

func GetActionResultAssetByPlanForUser(ctx context.Context, eid, ownerID int64, planID string) (*ActionResultAssetAggregate, error) {
	var record ActionResultAssetRecord
	if err := DB.WithContext(ctx).Where("eid = ? AND owner_id = ? AND plan_id = ?", eid, ownerID, planID).First(&record).Error; err != nil {
		return nil, err
	}
	return GetActionResultAssetForUser(ctx, eid, ownerID, record.ResultAssetID)
}

func ListActionResultAssetsForUser(ctx context.Context, eid, ownerID int64) ([]*ActionResultAssetRecord, error) {
	var records []*ActionResultAssetRecord
	err := DB.WithContext(ctx).Where("eid = ? AND owner_id = ?", eid, ownerID).Order("created_time DESC, id DESC").Find(&records).Error
	return records, err
}

// GetActionResultAssetsByActionIDs 批量读取每个 Action 的成果资产（已接受成果的直达入口），
// 供 Plan 列表摘要输出 result_asset_id，避免按 Plan 逐条查询。
func GetActionResultAssetsByActionIDs(ctx context.Context, eid int64, actionIDs []string) (map[string]*ActionResultAssetRecord, error) {
	result := make(map[string]*ActionResultAssetRecord, len(actionIDs))
	if len(actionIDs) == 0 {
		return result, nil
	}
	var records []*ActionResultAssetRecord
	if err := DB.WithContext(ctx).Where("eid = ? AND action_id IN ?", eid, actionIDs).Order("id DESC").Find(&records).Error; err != nil {
		return nil, err
	}
	for _, record := range records {
		if record == nil {
			continue
		}
		if _, exists := result[record.ActionID]; !exists {
			result[record.ActionID] = record
		}
	}
	return result, nil
}
