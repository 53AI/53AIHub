package model

import (
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ConversationSummary 会话持久化增量摘要 (Phase 2A)。
//
// 用于解决探讨会话超过 4 轮硬截断后早期内容丢失的问题：
// 每个会话一行，通过 covered_through_message_id 可靠消息游标记录已归纳范围，
// 后续轮次采用「已有摘要 + 新增未覆盖消息 → 新摘要」的增量重写方式推进。
//
// 并发安全约定：
//   - 唯一索引 (eid, conversation_id) 保证同一会话单行；
//   - 写入时携带 expected_version 乐观锁（CompareAndSwap），
//     失败方重读最新行后重试，不允许旧摘要覆盖新摘要；
//   - 游标单调递增，绝不允许回退。
type ConversationSummary struct {
	ID                      int64  `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid                     int64  `json:"eid" gorm:"column:eid;not null;uniqueIndex:uk_conversation_summaries_eid_conv,priority:1"`
	ConversationID          int64  `json:"conversation_id" gorm:"column:conversation_id;not null;uniqueIndex:uk_conversation_summaries_eid_conv,priority:2"`
	UserID                  int64  `json:"user_id" gorm:"column:user_id;not null"`
	AgentID                 int64  `json:"agent_id" gorm:"column:agent_id;not null"`
	Summary                 string `json:"summary" gorm:"column:summary;type:text"`
	SummaryVersion          int64  `json:"summary_version" gorm:"column:summary_version;not null;default:0"`
	CoveredThroughMessageID int64  `json:"covered_through_message_id" gorm:"column:covered_through_message_id;not null;default:0"`
	LatestMessageID         int64  `json:"latest_message_id" gorm:"column:latest_message_id;not null;default:0"`
	LatestMessageTime       int64  `json:"latest_message_time" gorm:"column:latest_message_time;not null;default:0"`
	LastError               string `json:"last_error" gorm:"column:last_error;type:text"`
	Status                  string `json:"status" gorm:"column:status;size:32;not null;default:'pending'"`
	SkippedMessageIDs       string `json:"skipped_message_ids" gorm:"column:skipped_message_ids;type:text"`
	BaseModel
}

func (ConversationSummary) TableName() string {
	return "conversation_summaries"
}

// GetConversationSummary 读取指定会话的摘要记录；不存在时返回 (nil, nil)。
func GetConversationSummary(eid, conversationID int64) (*ConversationSummary, error) {
	var s ConversationSummary
	err := DB.Where("eid = ? AND conversation_id = ?", eid, conversationID).First(&s).Error
	if err == gorm.ErrRecordNotFound {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &s, nil
}

// UpsertConversationSummaryWithVersion 使用乐观锁版本号原子推进摘要。
//
// 幂等性保证：当已存在行的 summary_version 大于 expectedVersion 时直接返回 false（不覆盖更新）；
// 当游标不大于已有游标时也直接返回 false，确保并发下新消息不会被遗漏、旧摘要不会覆盖新摘要。
func UpsertConversationSummaryWithVersion(
	eid, conversationID, userID, agentID int64,
	summary string,
	coveredThroughMessageID int64,
	expectedVersion int64,
	nowMs int64,
	skippedMessageIDs ...string,
) (bool, error) {
	if coveredThroughMessageID <= 0 {
		return false, nil
	}

	summary = TruncateSummaryText(summary)

	// 首次创建（无既有行）：直接插入
	var existing int64
	if err := DB.Model(&ConversationSummary{}).
		Where("eid = ? AND conversation_id = ?", eid, conversationID).
		Count(&existing).Error; err != nil {
		return false, err
	}

	now := time.UnixMilli(nowMs)
	var skipped string
	if len(skippedMessageIDs) > 0 {
		skipped = skippedMessageIDs[0]
	}

	if existing == 0 {
		row := &ConversationSummary{
			Eid:                     eid,
			ConversationID:          conversationID,
			UserID:                  userID,
			AgentID:                 agentID,
			Summary:                 summary,
			SummaryVersion:          1,
			CoveredThroughMessageID: coveredThroughMessageID,
			LatestMessageID:         coveredThroughMessageID,
			LatestMessageTime:       nowMs,
			Status:                  "completed",
			SkippedMessageIDs:       skipped,
		}
		row.CreatedTime = now.UnixMilli()
		row.UpdatedTime = now.UnixMilli()
		res := DB.Clauses(clause.OnConflict{DoNothing: true}).Create(row)
		return res.RowsAffected > 0, res.Error
	}

	// 已有行：乐观锁版本推进 + 游标单调性校验
	res := DB.Model(&ConversationSummary{}).
		Where("eid = ? AND conversation_id = ? AND summary_version = ?", eid, conversationID, expectedVersion).
		Where("covered_through_message_id <= ?", coveredThroughMessageID).
		Updates(map[string]interface{}{
			"summary":                    summary,
			"summary_version":            expectedVersion + 1,
			"covered_through_message_id": coveredThroughMessageID,
			"latest_message_id":          coveredThroughMessageID,
			"latest_message_time":        nowMs,
			"status":                     "completed",
			"last_error":                 "",
			"skipped_message_ids":        skipped,
			"updated_time":               now.UnixMilli(),
		})
	if res.Error != nil {
		return false, res.Error
	}
	return res.RowsAffected > 0, nil
}

// MarkConversationSummaryFailed 记录一次摘要生成失败（不影响对话继续）。
func MarkConversationSummaryFailed(eid, conversationID int64, errMsg string) error {
	return DB.Model(&ConversationSummary{}).
		Where("eid = ? AND conversation_id = ?", eid, conversationID).
		Updates(map[string]interface{}{
			"status":       "failed",
			"last_error":   TruncateSummaryText(errMsg),
			"updated_time": time.Now().UnixMilli(),
		}).Error
}

// TruncateSummaryText 限制摘要文本长度（约 12000 字符上限，防止超长历史撑爆上下文）。
func TruncateSummaryText(text string) string {
	const maxSummaryRunes = 12000
	runes := []rune(text)
	if len(runes) <= maxSummaryRunes {
		return text
	}
	return string(runes[:maxSummaryRunes])
}
