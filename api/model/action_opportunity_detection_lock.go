package model

import (
	"context"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ActionOpportunityDetectionLockRecord 是行动建议发现的数据库租约兜底。
// Redis 不可用时，仍使用数据库保证多实例不会同时为同一录音发现行动建议。
type ActionOpportunityDetectionLockRecord struct {
	ID         int64  `json:"-" gorm:"primaryKey;autoIncrement"`
	LockKey    string `json:"-" gorm:"size:191;not null;uniqueIndex:uk_action_opportunity_detection_lock_key"`
	LeaseToken string `json:"-" gorm:"size:64;not null"`
	LeaseUntil int64  `json:"-" gorm:"not null;index:idx_action_opportunity_detection_lock_until"`
	BaseModel
}

func (ActionOpportunityDetectionLockRecord) TableName() string {
	return "action_opportunity_detection_locks"
}

// TryAcquireActionOpportunityDetectionLock 原子地创建或抢占已过期的租约。
func TryAcquireActionOpportunityDetectionLock(ctx context.Context, lockKey, leaseToken string, leaseUntil int64) (bool, error) {
	if lockKey == "" || leaseToken == "" || leaseUntil <= 0 {
		return false, gorm.ErrInvalidData
	}
	record := &ActionOpportunityDetectionLockRecord{
		LockKey:    lockKey,
		LeaseToken: leaseToken,
		LeaseUntil: leaseUntil,
	}
	result := DB.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(record)
	if result.Error != nil {
		return false, result.Error
	}
	if result.RowsAffected == 1 {
		return true, nil
	}

	now := time.Now().UTC().UnixMilli()
	result = DB.WithContext(ctx).Model(&ActionOpportunityDetectionLockRecord{}).
		Where("lock_key = ? AND lease_until < ?", lockKey, now).
		Updates(map[string]interface{}{"lease_token": leaseToken, "lease_until": leaseUntil})
	if result.Error != nil {
		return false, result.Error
	}
	return result.RowsAffected == 1, nil
}

// ReleaseActionOpportunityDetectionLock 只释放当前租约持有者的锁。
func ReleaseActionOpportunityDetectionLock(ctx context.Context, lockKey, leaseToken string) error {
	if lockKey == "" || leaseToken == "" {
		return nil
	}
	return DB.WithContext(ctx).Model(&ActionOpportunityDetectionLockRecord{}).
		Where("lock_key = ? AND lease_token = ?", lockKey, leaseToken).
		Updates(map[string]interface{}{"lease_token": "", "lease_until": 0}).Error
}
