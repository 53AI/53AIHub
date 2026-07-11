package model

import (
	"time"

	"gorm.io/gorm"
)

// UserRecentUsed 用户最近使用记录（聊天中使用知识库/空间/文件）
// 表名：user_recent_useds
type UserRecentUsed struct {
	ID           int64 `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid          int64 `json:"eid" gorm:"not null;uniqueIndex:idx_user_recent_used_uk,priority:1"`
	UserID       int64 `json:"user_id" gorm:"not null;uniqueIndex:idx_user_recent_used_uk,priority:2"`
	ResourceType int   `json:"resource_type" gorm:"not null;uniqueIndex:idx_user_recent_used_uk,priority:3"` // 0=space, 1=knowledge_base, 2=file
	ResourceID   int64 `json:"resource_id" gorm:"not null;uniqueIndex:idx_user_recent_used_uk,priority:4"`
	UpdatedTime  int64 `json:"updated_time" gorm:"not null"`
}

const (
	RECENT_USED_MAX_PER_TYPE = 20 // 每类型最多保留条数
)

func (UserRecentUsed) TableName() string {
	return "user_recent_useds"
}

func (h *UserRecentUsed) BeforeCreate(tx *gorm.DB) (err error) {
	h.UpdatedTime = time.Now().UTC().UnixMilli()
	return
}

// SaveUserRecentUsed 保存最近使用记录（upsert + 超限删除）
func SaveUserRecentUsed(eid, userID int64, resourceType int, resourceID int64) error {
	if resourceID <= 0 {
		return nil
	}
	now := time.Now().UTC().UnixMilli()

	// upsert
	history := &UserRecentUsed{
		Eid:          eid,
		UserID:       userID,
		ResourceType: resourceType,
		ResourceID:   resourceID,
	}
	err := DB.Where("eid = ? AND user_id = ? AND resource_type = ? AND resource_id = ?",
		eid, userID, resourceType, resourceID).
		Assign(map[string]interface{}{
			"updated_time": now,
		}).
		FirstOrCreate(history).Error
	if err != nil {
		return err
	}

	// 超限清理：保留最近 20 条
	return trimUserRecentUsed(eid, userID, resourceType)
}

// trimUserRecentUsed 清理超限记录，只保留最近 RECENT_USED_MAX_PER_TYPE 条
func trimUserRecentUsed(eid, userID int64, resourceType int) error {
	var count int64
	if err := DB.Model(&UserRecentUsed{}).
		Where("eid = ? AND user_id = ? AND resource_type = ?", eid, userID, resourceType).
		Count(&count).Error; err != nil {
		return err
	}
	if count <= RECENT_USED_MAX_PER_TYPE {
		return nil
	}

	// 找到第 RECENT_USED_MAX_PER_TYPE 条的最新时间戳，删除更早的
	var threshold UserRecentUsed
	if err := DB.Where("eid = ? AND user_id = ? AND resource_type = ?", eid, userID, resourceType).
		Order("updated_time DESC").
		Offset(RECENT_USED_MAX_PER_TYPE - 1).
		Limit(1).
		Find(&threshold).Error; err != nil {
		return err
	}
	if threshold.ID == 0 {
		return nil
	}

	return DB.Where("eid = ? AND user_id = ? AND resource_type = ? AND updated_time < ?",
		eid, userID, resourceType, threshold.UpdatedTime).
		Delete(&UserRecentUsed{}).Error
}

// ListUserRecentUsed 获取用户所有最近使用记录，按更新时间降序
func ListUserRecentUsed(eid, userID int64) ([]UserRecentUsed, error) {
	var histories []UserRecentUsed
	if err := DB.Where("eid = ? AND user_id = ?", eid, userID).
		Order("updated_time DESC").
		Find(&histories).Error; err != nil {
		return nil, err
	}
	return histories, nil
}

// BatchDeleteUserRecentUsed 批量删除最近使用记录
func BatchDeleteUserRecentUsed(eid, userID int64, ids []int64) error {
	if len(ids) == 0 {
		return nil
	}
	return DB.Where("eid = ? AND user_id = ? AND id IN ?", eid, userID, ids).
		Delete(&UserRecentUsed{}).Error
}

// DeleteAllUserRecentUsed 删除用户所有最近使用记录
func DeleteAllUserRecentUsed(eid, userID int64) error {
	return DB.Where("eid = ? AND user_id = ?", eid, userID).
		Delete(&UserRecentUsed{}).Error
}
