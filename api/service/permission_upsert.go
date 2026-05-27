package service

import (
	"errors"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
)

// UpsertPermission 保存唯一权限，根据唯一键自动判断新增或更新
// 唯一键: eid + resource_type + resource_id + subject_type + subject_id
// 参数说明：
//   - eid: 企业ID
//   - resourceType: 资源类型（0-空间，1-知识库，2-文件）
//   - resourceID: 资源ID
//   - subjectType: 主体类型（0-用户，1-分组，2-全公司等）
//   - subjectID: 主体ID
//   - permission: 权限级别（0-无权限，1-仅公开，2-仅查看，3-可查看/导出，4-仅编辑知识，5-可编辑知识/语料，6-可管理）
//
// 处理逻辑：
// 1. 根据唯一键查询现有权限记录（不限定权限级别）
// 2. 如果记录存在，则更新权限级别
// 3. 如果记录不存在，则创建新的权限记录
//
// 返回值：
//   - error: 操作错误，nil表示成功
func UpsertPermission(eid int64, resourceType int, resourceID int64, subjectType int, subjectID int64, permission int) error {
	// 查现有记录（不限定 permission）
	existing, err := model.GetPermission(eid, resourceType, resourceID, subjectType, subjectID, nil)
	if err != nil {
		return err
	}
	if existing != nil {
		// 更新现有权限记录
		existing.Permission = permission
		err = existing.Update()
	} else {
		// 新建权限记录
		p := &model.Permission{
			Eid:          eid,
			ResourceType: resourceType,
			ResourceID:   resourceID,
			SubjectType:  subjectType,
			SubjectID:    subjectID,
			Permission:   permission,
		}
		err = p.Save()
	}

	// 如果操作成功，清除对应资源及其下游的最终权限缓存。
	if err == nil {
		if cacheErr := invalidatePermissionCacheByResource(eid, resourceType, resourceID); cacheErr != nil {
			logger.SysWarnf("【权限】清理权限级联缓存失败: resource_type=%d, resource_id=%d, err=%v", resourceType, resourceID, cacheErr)
		}
	}

	return err
}

// UpsertBatchPermissions 批量保存唯一权限，对每个权限项应用 Upsert 逻辑
// 参数说明：
//   - eid: 企业ID
//   - resourceType: 资源类型（0-空间，1-知识库，2-文件）
//   - resourceID: 资源ID
//   - perms: 权限数据切片，每个元素包含主体信息和权限级别
//
// 处理逻辑：
// 1. 遍历权限数据切片，跳过 nil 元素
// 2. 对每个权限项调用 UpsertPermission，实现自动新增或更新
// 3. 任何一个权限项失败都会立即终止并返回错误
//
// 返回值：
//   - error: 操作错误，nil表示全部成功
//
// 使用场景：
//   - 批量设置资源的权限，确保每个主体权限都是唯一的
//   - 权限更新时自动处理冲突，避免重复记录
func UpsertBatchPermissions(eid int64, resourceType int, resourceID int64, perms []*model.PermissionData) error {
	for _, d := range perms {
		if d == nil {
			continue
		}
		if err := UpsertPermission(eid, resourceType, resourceID, d.SubjectType, d.SubjectID, d.Permission); err != nil {
			return err
		}
	}
	return nil
}

// UpdatePermissionByID 根据ID更新权限并清除缓存
// 参数说明：
//   - permissionID: 权限记录ID
//   - newPermission: 新的权限级别
//
// 处理逻辑：
// 1. 根据ID查询权限记录（获取缓存Key所需信息）
// 2. 更新权限记录
// 3. 如果是用户权限，清除对应的缓存
//
// 返回值：
//   - error: 操作错误，nil表示成功
func UpdatePermissionByID(permissionID int64, newPermission int) error {
	permission, err := model.GetPermissionByID(permissionID)
	if err != nil {
		return err
	}
	if permission == nil {
		return errors.New("permission not found")
	}

	if err := model.UpdatePermissionByID(permissionID, newPermission); err != nil {
		return err
	}

	if cacheErr := invalidatePermissionCacheByResource(permission.Eid, permission.ResourceType, permission.ResourceID); cacheErr != nil {
		logger.SysWarnf("【权限】清理权限级联缓存失败: resource_type=%d, resource_id=%d, err=%v", permission.ResourceType, permission.ResourceID, cacheErr)
	}

	return nil
}

// DeletePermissionByID 删除权限并清除缓存
func DeletePermissionByID(id int64) error {
	permission, err := model.GetPermissionByID(id)
	if err != nil {
		return err
	}
	if permission == nil {
		return nil
	}

	if err := model.DeletePermissionByID(id); err != nil {
		return err
	}

	if cacheErr := invalidatePermissionCacheByResource(permission.Eid, permission.ResourceType, permission.ResourceID); cacheErr != nil {
		logger.SysWarnf("【权限】清理权限级联缓存失败: resource_type=%d, resource_id=%d, err=%v", permission.ResourceType, permission.ResourceID, cacheErr)
	}

	return nil
}
