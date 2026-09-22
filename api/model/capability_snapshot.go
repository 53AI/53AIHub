package model

import (
	"context"
)

// capabilities 接口用的按库快照：只含权限计算闭包所需的轻字段。
// 快照与现有 resolveFilePermission 逻辑对齐：
//   - CapabilityFiletree 覆盖 GetFilesByLibraryID + GetFileWithParentsByID（父链由 path 内存推导）
//   - CapabilityLibraryPerms 覆盖 GetResourcePermissions（库级）+ GetResourcesPermissions（文件级）
// 库行本身不进快照：GetLibraryByID 已走 eid 级快照缓存（GetLibrariesByEidCached）。
// user/group/space 结论不进快照：按用户变化，每请求点查（见 Q3 结论：近零 DB）。

// CapabilityFileNode 文件骨架轻字段。
type CapabilityFileNode struct {
	ID              int64  `json:"id"`
	Path            string `json:"path"`
	IsDeleted       bool   `json:"is_deleted"`
	IsActiveDeleted bool   `json:"is_active_deleted"`
}

// CapabilityFiletree 单库全量文件骨架。
type CapabilityFiletree struct {
	LibraryID int64                `json:"library_id"`
	Files     []CapabilityFileNode `json:"files"`
}

// CapabilityPermRow 权限行轻字段（key 已限定 eid/resource_type，行内不再重复）。
type CapabilityPermRow struct {
	ResourceID  int64 `json:"resource_id"`
	SubjectType int   `json:"subject_type"`
	SubjectID   int64 `json:"subject_id"`
	Permission  int   `json:"permission"`
}

// CapabilityLibraryPerms 单库权限行：库级 + 该库所有文件级。
type CapabilityLibraryPerms struct {
	LibraryID    int64               `json:"library_id"`
	LibraryPerms []CapabilityPermRow `json:"library_perms"`
	FilePerms    []CapabilityPermRow `json:"file_perms"`
}

// BuildCapabilityFiletree 从 DB 构建单库文件骨架（仅 SELECT 轻字段列，非 SELECT *）。
func BuildCapabilityFiletree(eid int64, libraryID int64, ctxs ...context.Context) (*CapabilityFiletree, error) {
	tree := &CapabilityFiletree{LibraryID: libraryID, Files: []CapabilityFileNode{}}
	if eid <= 0 || libraryID <= 0 {
		return tree, nil
	}
	if err := dbWithOptionalCtx(ctxs...).Model(&File{}).
		Select("id, path, is_deleted, is_active_deleted").
		Where("eid = ? AND library_id = ?", eid, libraryID).
		Find(&tree.Files).Error; err != nil {
		return nil, err
	}
	return tree, nil
}

// BuildCapabilityLibraryPerms 从 DB 构建单库权限行（库级 + 该库文件级，按 id 升序保证确定性）。
func BuildCapabilityLibraryPerms(eid int64, libraryID int64, ctxs ...context.Context) (*CapabilityLibraryPerms, error) {
	snap := &CapabilityLibraryPerms{LibraryID: libraryID, LibraryPerms: []CapabilityPermRow{}, FilePerms: []CapabilityPermRow{}}
	if eid <= 0 || libraryID <= 0 {
		return snap, nil
	}
	var libPerms []Permission
	if err := dbWithOptionalCtx(ctxs...).
		Where("eid = ? AND resource_type = ? AND resource_id = ?", eid, RESOURCE_TYPE_LIBRARY, libraryID).
		Order("id asc").Find(&libPerms).Error; err != nil {
		return nil, err
	}
	for _, p := range libPerms {
		snap.LibraryPerms = append(snap.LibraryPerms, CapabilityPermRow{
			ResourceID: p.ResourceID, SubjectType: p.SubjectType, SubjectID: p.SubjectID, Permission: p.Permission,
		})
	}
	var fileIDs []int64
	if err := dbWithOptionalCtx(ctxs...).Model(&File{}).
		Select("id").Where("eid = ? AND library_id = ?", eid, libraryID).
		Pluck("id", &fileIDs).Error; err != nil {
		return nil, err
	}
	if len(fileIDs) == 0 {
		return snap, nil
	}
	var filePerms []Permission
	if err := dbWithOptionalCtx(ctxs...).
		Where("eid = ? AND resource_type = ? AND resource_id IN ?", eid, RESOURCE_TYPE_FILE, fileIDs).
		Order("id asc").Find(&filePerms).Error; err != nil {
		return nil, err
	}
	for _, p := range filePerms {
		snap.FilePerms = append(snap.FilePerms, CapabilityPermRow{
			ResourceID: p.ResourceID, SubjectType: p.SubjectType, SubjectID: p.SubjectID, Permission: p.Permission,
		})
	}
	return snap, nil
}

// 以下为快照失效钩子：与 SetFileCountCacheInvalidator / SetLibraryCacheInvalidator 同范式。
// model 层只声明回调（避免循环引用），service 层注册 Redis 删除实现。

var capabilityFiletreeInvalidator func(eid int64, libraryID int64)

var capabilityLibraryPermsInvalidator func(eid int64, libraryID int64)

// SetCapabilityFiletreeInvalidator 注册文件骨架快照失效回调。
func SetCapabilityFiletreeInvalidator(invalidator func(eid int64, libraryID int64)) {
	capabilityFiletreeInvalidator = invalidator
}

// SetCapabilityLibraryPermsInvalidator 注册库权限快照失效回调。
func SetCapabilityLibraryPermsInvalidator(invalidator func(eid int64, libraryID int64)) {
	capabilityLibraryPermsInvalidator = invalidator
}

// InvalidateCapabilityFiletree 失效单库文件骨架快照（文件增删改名/移动/软删恢复后调用）。
func InvalidateCapabilityFiletree(eid int64, libraryID int64) {
	if eid <= 0 || libraryID <= 0 || capabilityFiletreeInvalidator == nil {
		return
	}
	capabilityFiletreeInvalidator(eid, libraryID)
}

// InvalidateCapabilityLibraryPerms 失效单库权限快照（该库权限写入后调用）。
func InvalidateCapabilityLibraryPerms(eid int64, libraryID int64) {
	if eid <= 0 || libraryID <= 0 || capabilityLibraryPermsInvalidator == nil {
		return
	}
	capabilityLibraryPermsInvalidator(eid, libraryID)
}

// InvalidateCapabilityLibraryPermsForResource 按权限写入的资源定位到所属库并失效。
//   - 库级写入：resourceID 即 libraryID，直接失效。
//   - 文件级写入：查文件映射到 libraryID（写路径低频，1 次点查可接受；文件已彻底删除时
//     查不到，由文件删除路径的失效覆盖，此处跳过）。
//   - 空间/Wiki 级写入：不影响库快照（space role 每次 live 计算），跳过。
func InvalidateCapabilityLibraryPermsForResource(eid int64, resourceType int, resourceID int64) {
	if eid <= 0 || resourceID <= 0 {
		return
	}
	switch resourceType {
	case RESOURCE_TYPE_LIBRARY:
		InvalidateCapabilityLibraryPerms(eid, resourceID)
	case RESOURCE_TYPE_FILE:
		file, err := GetFileByID(eid, resourceID)
		if err != nil || file == nil {
			return
		}
		InvalidateCapabilityLibraryPerms(eid, file.LibraryID)
	case RESOURCE_TYPE_WIKI_PAGE:
		// Wiki 页面 ACL 写入：失效该页所属库的 Wiki ACL 快照（Source 文件权限由 FILE 快照负责，此处不动）。
		InvalidateCapabilityWikiPermsForResource(eid, resourceType, resourceID)
	default:
		return
	}
}
