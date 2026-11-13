package model

import (
	"context"
	"errors"
	"strconv"
	"strings"

	"gorm.io/gorm"
)

const (
	ActionItemStageProposal = "proposal"
	ActionItemStageAction   = "action"
	ActionItemStageResult   = "result"
)

type ActionItemFilter struct {
	Stage           string
	Status          string
	Read            string
	Type            string
	SourceType      string
	SourceID        string
	MeetingID       string
	RecordingFileID string
	InsightID       string
	Trashed         bool
	Page            int
	PageSize        int
}

// ListActionItemsForUserPage paginates on the ONE authoritative business-item table.
// Execution states are filtered through linked Actions without multiplying list rows.
func ListActionItemsForUserPage(ctx context.Context, eid, ownerID int64, filter ActionItemFilter) ([]*ActionOpportunityRecord, int64, error) {
	if filter.Page < 1 {
		filter.Page = 1
	}
	if filter.PageSize < 1 {
		filter.PageSize = 20
	}
	if filter.PageSize > 100 {
		filter.PageSize = 100
	}
	query := DB.WithContext(ctx).Model(&ActionOpportunityRecord{}).
		Where("eid = ? AND owner_id = ? AND is_trashed = ?", eid, ownerID, filter.Trashed)
	if filter.Stage != "" && filter.Stage != "all" {
		query = query.Where("stage = ?", filter.Stage)
	}
	if filter.Read == "read" {
		query = query.Where("is_read = ?", true)
	}
	if filter.Read == "unread" {
		query = query.Where("is_read = ?", false)
	}
	if filter.Type != "" && filter.Type != "all" {
		query = query.Where("opportunity_type = ?", filter.Type)
	}
	if filter.SourceType != "" {
		query = query.Where("source_type = ?", filter.SourceType)
	}
	if filter.SourceID != "" {
		query = query.Where("source_id = ?", filter.SourceID)
	}
	// 同一业务事项可能由多个会议/洞察推动：匹配主来源或权威来源关系。
	// 子查询只产生同一租户的 item ID；外层仍执行 owner_id 隔离。
	if filter.MeetingID != "" {
		refs := DB.WithContext(ctx).Model(&ActionSourceRefRecord{}).Select("parent_id").Where(
			"eid = ? AND parent_type = ? AND source_type = ? AND canonical_id = ?", eid, ActionSourceParentOpportunity, SourceTypeMeeting, filter.MeetingID)
		query = query.Where("source_meeting_id = ? OR opportunity_id IN (?)", filter.MeetingID, refs)
	}
	if filter.RecordingFileID != "" {
		ids := DB.WithContext(ctx).Model(&CanonicalSourceIdentityRecord{}).Select("canonical_id").Where(
			"eid = ? AND source_type = ? AND legacy_source_type = ? AND legacy_source_id = ?", eid,
			SourceTypeMeeting, LegacySourceTypeRecordingFile, filter.RecordingFileID)
		refs := DB.WithContext(ctx).Model(&ActionSourceRefRecord{}).Select("parent_id").Where(
			"eid = ? AND parent_type = ? AND source_type = ? AND canonical_id IN (?)", eid,
			ActionSourceParentOpportunity, SourceTypeMeeting, ids)
		query = query.Where("source_meeting_id IN (?) OR opportunity_id IN (?)", ids, refs)
		if !filter.Trashed {
			fileID, parseErr := strconv.ParseInt(filter.RecordingFileID, 10, 64)
			if parseErr != nil {
				return nil, 0, parseErr
			}
			var file File
			fileErr := DB.WithContext(ctx).Select("insight_generation").
				Where("id = ? AND eid = ?", fileID, eid).First(&file).Error
			if fileErr != nil && !errors.Is(fileErr, gorm.ErrRecordNotFound) {
				return nil, 0, fileErr
			}
			if fileErr == nil {
				// 旧轮次未落地的提议不计入当前会议；已创建方案的历史提议及行动/成果仍保留。
				planned := DB.WithContext(ctx).Model(&ActionPlanRecord{}).Select("opportunity_id").
					Where("eid = ? AND owner_id = ?", eid, ownerID)
				query = query.Where(
					"stage <> ? OR source_type NOT IN ? OR insight_generation = ? OR opportunity_id IN (?)",
					ActionItemStageProposal, []string{SourceTypeInsight, "meeting_insight"}, file.InsightGeneration, planned,
				)
			}
		}
	}
	if filter.InsightID != "" {
		refs := DB.WithContext(ctx).Model(&ActionSourceRefRecord{}).Select("parent_id").Where(
			"eid = ? AND parent_type = ? AND source_type = ? AND canonical_id = ?", eid, ActionSourceParentOpportunity, SourceTypeInsight, filter.InsightID)
		query = query.Where("source_insight_id = ? OR opportunity_id IN (?)", filter.InsightID, refs)
	}
	if filter.Status != "" && filter.Status != "all" {
		// 支持逗号分隔多值（如 running,needs_attention）：逐个映射为 Action 状态后
		// 按 IN 过滤；单值行为与旧契约完全一致（未知值原样透传）。
		targets := make([]string, 0, 4)
		for _, raw := range strings.Split(filter.Status, ",") {
			target := strings.TrimSpace(raw)
			if target == "" {
				continue
			}
			switch target {
			case "running":
				target = ActionStatusExecuting
			case "pending_review":
				target = ActionStatusAwaitingReview
			case "completed":
				target = ActionStatusAccepted
			}
			targets = append(targets, target)
		}
		// 全部为空串（如 status=,,）：与旧契约一致 —— 垃圾值匹配不到任何行，
		// 空 IN 子句（IN (NULL)）天然返回空集，无需报错。
		// A business item may have multiple Plan revisions and Runs. Filter on a linked Action.
		actionIDs := DB.WithContext(ctx).Model(&ActionRecord{}).Select("action_id").
			Where("eid = ? AND owner_id = ? AND status IN (?)", eid, ownerID, targets)
		planItems := DB.WithContext(ctx).Model(&ActionPlanRecord{}).Select("opportunity_id").
			Where("eid = ? AND owner_id = ? AND action_id IN (?)", eid, ownerID, actionIDs)
		query = query.Where("opportunity_id IN (?)", planItems)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var items []*ActionOpportunityRecord
	if err := query.Order("updated_time DESC, id DESC").Offset((filter.Page - 1) * filter.PageSize).Limit(filter.PageSize).Find(&items).Error; err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

// GetActionPlanForBusinessItem preserves the actual business lifecycle link across plan revisions.
// The highest revision can be an unapproved draft: it must never mask an executing Action or archived Result.
func GetActionPlanForBusinessItem(ctx context.Context, eid, ownerID int64, opportunityID, stage string) (*ActionPlanAggregate, error) {
	query := DB.WithContext(ctx).Model(&ActionPlanRecord{}).
		Where("eid = ? AND owner_id = ? AND opportunity_id = ?", eid, ownerID, opportunityID)
	if stage == ActionItemStageResult {
		var result ActionResultAssetRecord
		err := DB.WithContext(ctx).Where("eid = ? AND owner_id = ? AND opportunity_id = ?", eid, ownerID, opportunityID).
			Order("id DESC").First(&result).Error
		if err != nil {
			return nil, err
		}
		return GetActionPlanForUser(ctx, eid, ownerID, result.PlanID)
	}
	if stage == ActionItemStageAction {
		var confirmed ActionPlanRecord
		err := query.Where("action_id <> ?", "").Order("revision DESC, id DESC").First(&confirmed).Error
		if err == nil {
			return GetActionPlanForUser(ctx, eid, ownerID, confirmed.PlanID)
		}
		if err != gorm.ErrRecordNotFound {
			return nil, err
		}
	}
	return GetActionPlanByOpportunityForUser(ctx, eid, ownerID, opportunityID)
}

func TransitionActionItemStage(tx *gorm.DB, eid, ownerID int64, itemID, from, to string) error {
	result := tx.Model(&ActionOpportunityRecord{}).
		Where("eid = ? AND owner_id = ? AND opportunity_id = ? AND is_trashed = ? AND stage = ?", eid, ownerID, itemID, false, from).
		Update("stage", to)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return gorm.ErrRecordNotFound
	}
	return nil
}
