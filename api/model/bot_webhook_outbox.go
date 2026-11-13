package model

import (
	"time"

	"gorm.io/gorm"
)

// BotWebhookOutbox 上行消息可靠投递队列：webhook 验签后持久化，worker 异步处理 + 指数退避重试。
// DeliveryID 唯一（去重兜底，跨 Redis 故障仍不重复）。
type BotWebhookOutbox struct {
	ID          int64  `gorm:"column:id;primaryKey;autoIncrement"`
	DeliveryID  string `gorm:"column:delivery_id;size:128;not null;uniqueIndex"`
	BotID       string `gorm:"column:bot_id;size:128;not null;index"`
	Provider    string `gorm:"column:provider;size:16;not null"`
	Payload     string `gorm:"column:payload;type:text;not null"`
	Status      string `gorm:"column:status;size:16;not null;default:'pending';index"` // pending/processing/success/failed
	Attempts    int    `gorm:"column:attempts;not null;default:0"`
	NextRetryAt int64  `gorm:"column:next_retry_at;not null;default:0"`
	BaseModel
}

// BotWebhookOutbox 状态与重试上限
const (
	BotWebhookOutboxStatusPending    = "pending"
	BotWebhookOutboxStatusProcessing = "processing"
	BotWebhookOutboxStatusSuccess    = "success"
	BotWebhookOutboxStatusFailed     = "failed"
	BotWebhookOutboxMaxAttempts      = 8
	BotWebhookOutboxBackoffBaseSec   = 3 // 秒级指数退避（3s, 6s, 12s...），消除长达数分钟的重试悬停延迟
)

// CreateBotWebhookOutbox 入队（DeliveryID 唯一约束兜底去重）。
func CreateBotWebhookOutbox(outbox *BotWebhookOutbox) error {
	return DB.Create(outbox).Error
}

// ClaimBotWebhookOutbox 领取一批到期待处理项（CAS pending→processing 防并发重复）。
func ClaimBotWebhookOutbox(limit int) ([]*BotWebhookOutbox, error) {
	now := time.Now().Unix()
	var ids []int64
	if err := DB.Model(&BotWebhookOutbox{}).
		Where("status = ? AND next_retry_at <= ?", BotWebhookOutboxStatusPending, now).
		Order("id ASC").Limit(limit).Pluck("id", &ids).Error; err != nil {
		return nil, err
	}
	var out []*BotWebhookOutbox
	for _, id := range ids {
		res := DB.Model(&BotWebhookOutbox{}).Where("id = ? AND status = ?", id, BotWebhookOutboxStatusPending).Update("status", BotWebhookOutboxStatusProcessing)
		if res.Error != nil {
			continue
		}
		if res.RowsAffected != 1 {
			continue
		}
		var it BotWebhookOutbox
		if err := DB.First(&it, id).Error; err != nil {
			continue
		}
		out = append(out, &it)
	}
	return out, nil
}

// ClaimBotWebhookOutboxByID 按 id 抢占单条待处理项（CAS pending→processing）。
// 与 ClaimBotWebhookOutbox 同一把锁语义：同一行只能有一个处理者。
// 即时处理必须走这里才能与后台 worker 互斥——否则两个处理者会各跑一次 agent，
// 同一问题重复落库、向用户重复回复。claimed=false 表示已被他人领取或已是终态。
func ClaimBotWebhookOutboxByID(id int64) (*BotWebhookOutbox, bool, error) {
	var (
		it      BotWebhookOutbox
		claimed bool
	)
	// 抢占与回读放同一事务：否则第二步失败会把行永久留在 processing（要等超时回收才复活）。
	err := DB.Transaction(func(tx *gorm.DB) error {
		res := tx.Model(&BotWebhookOutbox{}).
			Where("id = ? AND status = ?", id, BotWebhookOutboxStatusPending).
			Update("status", BotWebhookOutboxStatusProcessing)
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected != 1 {
			return nil // 已被他人领取或已是终态
		}
		if err := tx.First(&it, id).Error; err != nil {
			return err
		}
		claimed = true
		return nil
	})
	if err != nil {
		return nil, false, err
	}
	if !claimed {
		return nil, false, nil
	}
	return &it, true, nil
}

// RecoverStuckBotWebhookOutbox 回收超时未完成的 processing 记录（多实例下崩溃实例遗留的领取），置回 pending。
// 返回回收条数。
func RecoverStuckBotWebhookOutbox(timeout time.Duration) (int64, error) {
	deadline := time.Now().Add(-timeout).UnixMilli() // updated_time 为毫秒（领取 processing 时被更新）
	res := DB.Model(&BotWebhookOutbox{}).
		Where("status = ? AND updated_time < ?", BotWebhookOutboxStatusProcessing, deadline).
		Updates(map[string]any{"status": BotWebhookOutboxStatusPending})
	return res.RowsAffected, res.Error
}

// MarkBotWebhookOutboxSuccess 处理成功。
func MarkBotWebhookOutboxSuccess(id int64) error {
	return DB.Model(&BotWebhookOutbox{}).Where("id = ?", id).Updates(map[string]any{
		"status": BotWebhookOutboxStatusSuccess, "attempts": gorm.Expr("attempts + 1"),
	}).Error
}

// MarkBotWebhookOutboxFailure 处理失败：指数退避设置下次重试，超上限标记 failed。
func MarkBotWebhookOutboxFailure(id int64, attempts int) error {
	nextAttempts := attempts + 1
	if nextAttempts >= BotWebhookOutboxMaxAttempts {
		return DB.Model(&BotWebhookOutbox{}).Where("id = ?", id).Updates(map[string]any{
			"status": BotWebhookOutboxStatusFailed, "attempts": nextAttempts,
		}).Error
	}
	backoff := int64(BotWebhookOutboxBackoffBaseSec) << attempts // attempts=0→3s, 1→6s, 2→12s…
	if backoff < BotWebhookOutboxBackoffBaseSec {
		backoff = BotWebhookOutboxBackoffBaseSec
	}
	if backoff > 7200 {
		backoff = 7200
	}
	return DB.Model(&BotWebhookOutbox{}).Where("id = ?", id).Updates(map[string]any{
		"status": BotWebhookOutboxStatusPending, "attempts": nextAttempts, "next_retry_at": time.Now().Unix() + int64(backoff),
	}).Error
}
