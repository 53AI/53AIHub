package model

import (
	"context"
	"fmt"
	"strings"

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
		return CreateActionResultAssetAggregateTx(tx, aggregate)
	})
}

// CreateActionResultAssetAggregateTx participates in the caller's existing acceptance transaction.
func CreateActionResultAssetAggregateTx(tx *gorm.DB, aggregate *ActionResultAssetAggregate) error {
	if err := tx.Create(aggregate.Record).Error; err != nil {
		return err
	}
	if err := CreateActionEvidenceRefs(tx, aggregate.Record.Eid, ActionEvidenceOwnerResultAsset, aggregate.Record.ResultAssetID, aggregate.EvidenceRefs); err != nil {
		return err
	}
	return createActionSourceRefs(tx, aggregate.Record.Eid, ActionSourceParentResultAsset, aggregate.Record.ResultAssetID, aggregate.SourceRefs)
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

type ActionResultAssetCategory struct {
	ResultType string `json:"type"`
	Count      int64  `json:"count"`
}

// ActionResultAssetSortCreatedTime / ActionResultAssetSortUpdatedTime 是成果列表
// 支持的时间排序键（与经营记忆列表 sort_by 同一套取值）。
const (
	ActionResultAssetSortCreatedTime = "created_time"
	ActionResultAssetSortUpdatedTime = "updated_time"
)

// NormalizeActionResultAssetSortBy 把外部传入的 sort_by 收敛到白名单，未识别一律
// 回落到 created_time（旧行为：最近接受的成果在前）。
func NormalizeActionResultAssetSortBy(sortBy string) string {
	if strings.TrimSpace(sortBy) == ActionResultAssetSortUpdatedTime {
		return ActionResultAssetSortUpdatedTime
	}
	return ActionResultAssetSortCreatedTime
}

// ListActionResultAssetsForUserPage 分页读用户成果。
//
// statusFilter 为空时隐藏 archived（软删除）记录：客户端删除成果走
// [ArchiveActionResultAssetForUser]，列表不再展示，但数据与执行历史保留。
// sortBy 见 [NormalizeActionResultAssetSortBy]。
func ListActionResultAssetsForUserPage(ctx context.Context, eid, ownerID int64, typeFilter, statusFilter, sortBy string, page, pageSize int) ([]*ActionResultAssetRecord, int64, error) {
	query := DB.WithContext(ctx).Model(&ActionResultAssetRecord{}).Where("eid = ? AND owner_id = ?", eid, ownerID)
	if typeFilter != "" && typeFilter != "all" {
		opportunityIDs := DB.Model(&ActionOpportunityRecord{}).Select("opportunity_id").
			Where("eid = ? AND owner_id = ? AND opportunity_type = ?", eid, ownerID, typeFilter)
		allOpportunityIDs := DB.Model(&ActionOpportunityRecord{}).Select("opportunity_id").
			Where("eid = ? AND owner_id = ?", eid, ownerID)
		legacyResultIDs := DB.Model(&ActionResultAssetRecord{}).Select("result_asset_id").
			Where("eid = ? AND owner_id = ? AND result_type = ? AND opportunity_id NOT IN (?)", eid, ownerID, typeFilter, allOpportunityIDs)
		query = query.Where("(opportunity_id IN (?) OR result_asset_id IN (?))", opportunityIDs, legacyResultIDs)
	}
	if statusFilter != "" && statusFilter != "all" {
		query = query.Where("status = ?", statusFilter)
	} else if statusFilter == "" {
		query = query.Where("status <> ?", ActionResultAssetStatusArchived)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	order := "created_time DESC, id DESC"
	if NormalizeActionResultAssetSortBy(sortBy) == ActionResultAssetSortUpdatedTime {
		order = "updated_time DESC, id DESC"
	}
	var records []*ActionResultAssetRecord
	if err := query.Order(order).Offset((page - 1) * pageSize).Limit(pageSize).Find(&records).Error; err != nil {
		return nil, 0, err
	}
	return records, total, nil
}

// ArchiveActionResultAssetForUser 软删除一条成果（status=archived）。
//
// WHY 不是物理删除：成果挂在 run / action / artifacts 上，物理删除会让执行历史
// 与交付物出现悬挂引用；用户侧的「删除」语义＝列表不再出现，数据保留可追溯。
//
// 幂等：已归档的再删一次也算成功。客户端批量删除 + 网络重试会重发同一个 id，
// 若第二次返回 404，用户会在「已经删掉了」的条目上看到「删除失败」。
func ArchiveActionResultAssetForUser(ctx context.Context, eid, ownerID int64, resultAssetID string) error {
	var record ActionResultAssetRecord
	if err := DB.WithContext(ctx).
		Where("eid = ? AND owner_id = ? AND result_asset_id = ?", eid, ownerID, resultAssetID).
		First(&record).Error; err != nil {
		return err
	}
	if record.Status == ActionResultAssetStatusArchived {
		return nil
	}
	return DB.WithContext(ctx).Model(&ActionResultAssetRecord{}).
		Where("eid = ? AND owner_id = ? AND result_asset_id = ?", eid, ownerID, resultAssetID).
		Update("status", ActionResultAssetStatusArchived).Error
}

// ListActionResultAssetCategoriesForUser 汇总「场景」（业务类型）与数量。
//
// stage 为空 / result / all 时沿用旧语义：只统计已验收成果（成果页的场景下拉）；
// stage=proposal / action 时改为统计对应阶段的业务事项（提议 / 行动页的场景
// 下拉）—— 三页共用同一个 opportunity_type 词表，但各自只看自己阶段的数据，
// 避免「还没有成果时提议页的场景下拉是空的」。
func ListActionResultAssetCategoriesForUser(ctx context.Context, eid, ownerID int64, stage string) ([]ActionResultAssetCategory, error) {
	stage = strings.TrimSpace(stage)
	if stage == ActionItemStageProposal || stage == ActionItemStageAction {
		var categories []ActionResultAssetCategory
		// 「未回收」口径与列表查询保持一致：is_trashed=false 且 status<>dismissed
		//（取消的提议只改 status，不一定置 is_trashed，否则它的场景会出现在
		// 下拉里却只对应回收站里的条目）。
		err := DB.WithContext(ctx).Table("action_opportunities").
			Select("COALESCE(NULLIF(opportunity_type, ''), 'custom') AS result_type, COUNT(*) AS count").
			Where("eid = ? AND owner_id = ? AND is_trashed = ? AND status <> ? AND stage = ?",
				eid, ownerID, false, ActionOpportunityStatusDismissed, stage).
			Group("COALESCE(NULLIF(opportunity_type, ''), 'custom')").
			Order("result_type ASC").Scan(&categories).Error
		return categories, err
	}
	var categories []ActionResultAssetCategory
	err := DB.WithContext(ctx).Table("action_result_assets AS ar").
		Select("COALESCE(NULLIF(ao.opportunity_type, ''), ar.result_type) AS result_type, COUNT(*) AS count").
		Joins("LEFT JOIN action_opportunities AS ao ON ao.eid = ar.eid AND ao.owner_id = ar.owner_id AND ao.opportunity_id = ar.opportunity_id").
		Where("ar.eid = ? AND ar.owner_id = ? AND ar.status <> ?", eid, ownerID, ActionResultAssetStatusArchived).
		Group("COALESCE(NULLIF(ao.opportunity_type, ''), ar.result_type)").
		Order("result_type ASC").Scan(&categories).Error
	return categories, err
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
