package service

import (
	"fmt"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

// EnsureWikiSpacePermissionsWhenEnabled 开启空间 Wiki 时初始化空间级 Wiki 权限（resource_type=4）。
// 仅当该空间当前不存在任何 Wiki 空间权限记录时执行：
//   - 空间全体成员（来自空间 type=0 权限行中 permission > NONE 的用户/分组/全公司主体）→ 仅查看 VIEW_ONLY
//   - 操作人（本接口调用者）→ Wiki 管理员 MANAGE
//
// 关闭 Wiki 不删除权限；重复开启且已有记录时直接跳过，不重复添加。
// 在开启方的事务内调用，guard 与写入同事务保证原子；事务回滚时多做的缓存失效无害。
func EnsureWikiSpacePermissionsWhenEnabled(tx *gorm.DB, eid, spaceID, operatorID int64) error {
	// guard：该空间已存在任何 type=4 记录（含用户手动配置）则跳过，不重复初始化。
	var existing int64
	if err := tx.Model(&model.Permission{}).
		Where("eid = ? AND resource_type = ? AND resource_id = ?", eid, model.RESOURCE_TYPE_WIKI_SPACE, spaceID).
		Count(&existing).Error; err != nil {
		return err
	}
	if existing > 0 {
		return nil
	}

	// 枚举空间成员主体：空间（type=0）权限行中 permission > NONE 的主体。
	var spacePerms []model.Permission
	if err := tx.Where("eid = ? AND resource_type = ? AND resource_id = ? AND permission > ?",
		eid, model.RESOURCE_TYPE_SPACE, spaceID, model.PERMISSION_NONE).Find(&spacePerms).Error; err != nil {
		return err
	}

	rows := make([]model.Permission, 0, len(spacePerms)+1)
	seen := make(map[string]struct{}, len(spacePerms)+1)
	appendRow := func(subjectType int, subjectID int64, permission int) {
		key := fmt.Sprintf("%d:%d", subjectType, subjectID)
		if _, ok := seen[key]; ok {
			return
		}
		seen[key] = struct{}{}
		rows = append(rows, model.Permission{
			Eid:          eid,
			ResourceType: model.RESOURCE_TYPE_WIKI_SPACE,
			ResourceID:   spaceID,
			SubjectType:  subjectType,
			SubjectID:    subjectID,
			Permission:   permission,
		})
	}

	for _, p := range spacePerms {
		switch p.SubjectType {
		case model.SUBJECT_TYPE_USER, model.SUBJECT_TYPE_GROUP, model.SUBJECT_TYPE_COMPANY_ALL:
		default:
			// SPACE_ACTIVE(7) 是公开空间可见性标记、SPACE_ADMIN/SPACE_USER 是角色占位，
			// 都不是真实成员主体；且 resolver 只解析 USER/GROUP/COMPANY_ALL，跳过。
			continue
		}
		if p.SubjectType == model.SUBJECT_TYPE_USER && p.SubjectID == operatorID {
			continue // 操作人单独授予 MANAGE，避免先写 VIEW_ONLY 再被去重吞掉
		}
		appendRow(p.SubjectType, p.SubjectID, model.PERMISSION_VIEW_ONLY)
	}
	if operatorID > 0 {
		appendRow(model.SUBJECT_TYPE_USER, operatorID, model.PERMISSION_MANAGE)
	}

	if len(rows) > 0 {
		if err := tx.CreateInBatches(rows, 100).Error; err != nil {
			return err
		}
	}

	// 新生效的 type=4 空间层会改写该空间下所有 Wiki 页面的最终权限（fallback 从库级变为空间级），
	// 连带失效页面权限缓存，避免旧值在 TTL 内继续放行；事务回滚时多失效无害。
	if err := invalidatePermissionCacheByResource(eid, model.RESOURCE_TYPE_WIKI_SPACE, spaceID); err != nil {
		logger.SysWarnf("【权限】开启 Wiki 初始化权限后清理级联缓存失败: space_id=%d err=%v", spaceID, err)
	}
	return nil
}
