package model

import (
	"context"

	"github.com/53AI/53AIHub/common/logger"
	"gorm.io/gorm"
)

// ApprovalStatus 表示审批状态
const (
	ApprovalStatusPending  = 0 // 待审批
	ApprovalStatusApproved = 1 // 同意
	ApprovalStatusRejected = 2 // 拒绝
)

// Approval 权限申请记录
// 说明：保持 eid 多租户，沿用 BaseModel（CreatedTime/UpdatedTime 毫秒）
type Approval struct {
	ID             int64  `gorm:"column:id;primaryKey;autoIncrement" json:"id"`
	Eid            int64  `gorm:"column:eid;not null;index:idx_approval_user_resource"          json:"eid"`
	UserID         int64  `gorm:"column:user_id;not null;index:idx_approval_user_resource"      json:"user_id"`          // 申请人
	ApproverUserID int64  `gorm:"column:approver_user_id;index;default:0"                                 json:"approver_user_id"` // 审批人，未执行前为0
	ResourceType   int    `gorm:"column:resource_type;not null;index:idx_approval_user_resource" json:"resource_type"`   // 对应 Permission 的 ResourceType
	ResourceID     int64  `gorm:"column:resource_id;not null;index:idx_approval_user_resource"  json:"resource_id"`
	Permission     int    `gorm:"column:permission;not null"         json:"permission"`
	Status         int    `gorm:"column:status;not null;default:0"   json:"status"` // 0待审批 1同意 2拒绝
	Reason         string `gorm:"column:reason;type:text"            json:"reason"` // 申请原因
	// 展示字段（非持久化），由 LoadApproverBasics 填充
	ApproverInfo ApproverInfo `gorm:"-" json:"approver_info,omitempty"`
	BaseModel
}

func (Approval) TableName() string { return "approvals" }

// ApproverInfo 审批人展示信息（非持久化）
type ApproverInfo struct {
	UserID   int64  `json:"user_id"`
	Nickname string `json:"nickname"`
	Avatar   string `json:"avatar"`
}

// LoadApproverBasics 批量加载审批人的基础信息（昵称、头像）到展示字段
// 出错时仅记录日志，不中断业务
func LoadApproverBasics(db *gorm.DB, approvals []*Approval) {
	if db == nil || len(approvals) == 0 {
		return
	}
	ids := make(map[int64]struct{}, len(approvals))
	for _, ap := range approvals {
		if ap == nil {
			continue
		}
		if ap.ApproverUserID > 0 {
			ids[ap.ApproverUserID] = struct{}{}
		}
	}
	if len(ids) == 0 {
		return
	}
	// 转为切片
	slice := make([]int64, 0, len(ids))
	for id := range ids {
		slice = append(slice, id)
	}
	// 仅查询必要字段
	var rows []ApproverInfo
	if err := db.Model(&User{}).
		Select("user_id, nickname, avatar").
		Where("user_id IN ?", slice).
		Find(&rows).Error; err != nil {
		logger.Errorf(context.Background(), "LoadApproverBasics query error: %v", err)
		return
	}
	mp := make(map[int64]ApproverInfo, len(rows))
	for _, r := range rows {
		mp[r.UserID] = r
	}
	for _, ap := range approvals {
		if ap == nil || ap.ApproverUserID <= 0 {
			continue
		}
		if r, ok := mp[ap.ApproverUserID]; ok {
			ap.ApproverInfo = r
		}
	}
}

// IsApprovalApplied 判断是否已申请（pending）
/*
仅判断待审批状态，避免已审批历史记录影响再次申请的合法性。
*/
func IsApprovalApplied(db *gorm.DB, eid, userID int64, resourceType int, resourceID int64) (bool, error) {
	if db == nil {
		db = DB
	}
	var cnt int64
	if err := db.Model(&Approval{}).
		Where("eid = ? AND user_id = ? AND resource_type = ? AND resource_id = ? AND status = ?", eid, userID, resourceType, resourceID, ApprovalStatusPending).
		Count(&cnt).Error; err != nil {
		return false, err
	}
	return cnt > 0, nil
}
