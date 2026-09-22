package model

import (
	"context"
)

// Wiki 权限快照：与 capabilities 的 filetree/libperms 快照同范式。
// 只存权限计算闭包所需的轻字段：
//   - CapabilityWikiPages 覆盖 GetWikiPageByID + Page→SourceFile 映射（wiki_page_sources），
//     免去详情/搜索逐页 DB 点查。
//   - CapabilityWikiPerms 覆盖页面显式 ACL（permissions 表 RESOURCE_TYPE_WIKI_PAGE 行）。
// Source 文件权限不落 Wiki 快照：解析时从 FILE libperms 快照实时读，FILE 权限变更
// 无需清 Wiki 缓存，天然一致。
// user/group/space 结论同样不进快照：每请求点查（与 filetree/libperms 决策一致）。

// CapabilityWikiPageNode Wiki 页面轻字段。
type CapabilityWikiPageNode struct {
	ID        int64  `json:"id"`
	LibraryID int64  `json:"library_id"`
	SpaceID   int64  `json:"space_id"`
	FolderID  int64  `json:"folder_id"`
	Status    string `json:"status"`
}

// CapabilityWikiPages 单库 Wiki 页面结构快照：页面轻字段 + page→sourceFile 映射。
type CapabilityWikiPages struct {
	LibraryID   int64                    `json:"library_id"`
	Pages       []CapabilityWikiPageNode `json:"pages"`
	PageSources map[int64][]int64        `json:"page_sources"`
	// SourceDeleted：来源文件是否已删除（硬删=记录不存在，软删=is_deleted=true）。
	// 已删除来源不参与权限交集（跳过，不影响页面可见性）。
	SourceDeleted map[int64]bool `json:"source_deleted"`
}

// GetWikiPageIDsByScope 反查权限依赖该资源的 Wiki 页面 id（权限变更时用于失效页面级权限缓存）：
//   - FILE：wiki_page_sources.source_file_id = resourceID（页面来源文档）
//   - LIBRARY：wiki_pages.library_id = resourceID
//   - SPACE：wiki_pages.space_id = resourceID
func GetWikiPageIDsByScope(eid int64, resourceType int, resourceID int64, ctxs ...context.Context) ([]int64, error) {
	if eid <= 0 || resourceID <= 0 {
		return nil, nil
	}
	var pageIDs []int64
	query := dbWithOptionalCtx(ctxs...).Model(&WikiPage{}).Select("wiki_pages.id")
	switch resourceType {
	case RESOURCE_TYPE_FILE:
		if err := dbWithOptionalCtx(ctxs...).Model(&WikiPageSource{}).
			Select("DISTINCT page_id").
			Where("eid = ? AND source_file_id = ?", eid, resourceID).
			Pluck("page_id", &pageIDs).Error; err != nil {
			return nil, err
		}
		return pageIDs, nil
	case RESOURCE_TYPE_LIBRARY:
		query = query.Where("eid = ? AND library_id = ?", eid, resourceID)
	case RESOURCE_TYPE_SPACE:
		query = query.Where("eid = ? AND space_id = ?", eid, resourceID)
	default:
		return nil, nil
	}
	if err := query.Pluck("id", &pageIDs).Error; err != nil {
		return nil, err
	}
	return pageIDs, nil
}

// GetFilesDeletedFlags 批量返回 fileID → 是否已删除（硬删=记录不存在，软删=is_deleted=true）。
// 用于 Wiki Source 交集排除已删除来源（删除来源不参与权限判断）。
func GetFilesDeletedFlags(eid int64, fileIDs []int64, ctxs ...context.Context) (map[int64]bool, error) {
	result := make(map[int64]bool)
	if len(fileIDs) == 0 {
		return result, nil
	}
	var files []File
	if err := dbWithOptionalCtx(ctxs...).Select("id, is_deleted").Where("eid = ? AND id IN ?", eid, fileIDs).Find(&files).Error; err != nil {
		return nil, err
	}
	alive := make(map[int64]bool, len(files))
	for _, f := range files {
		alive[f.ID] = !f.IsDeleted
	}
	for _, id := range fileIDs {
		if !alive[id] {
			result[id] = true
		}
	}
	return result, nil
}

// CapabilityWikiPerms 单库 Wiki 页面显式 ACL 行（key 已限定 eid/WIKI_PAGE，行内复用 CapabilityPermRow）。
type CapabilityWikiPerms struct {
	LibraryID int64               `json:"library_id"`
	PagePerms []CapabilityPermRow `json:"page_perms"`
}

// BuildCapabilityWikiPages 从 DB 构建单库 Wiki 页面结构快照（仅 SELECT 轻字段列，非 SELECT *）。
func BuildCapabilityWikiPages(eid int64, libraryID int64, ctxs ...context.Context) (*CapabilityWikiPages, error) {
	snap := &CapabilityWikiPages{
		LibraryID:     libraryID,
		Pages:         []CapabilityWikiPageNode{},
		PageSources:   map[int64][]int64{},
		SourceDeleted: map[int64]bool{},
	}
	if eid <= 0 || libraryID <= 0 {
		return snap, nil
	}
	if err := dbWithOptionalCtx(ctxs...).Model(&WikiPage{}).
		Select("id, library_id, space_id, folder_id, status").
		Where("eid = ? AND library_id = ?", eid, libraryID).
		Order("id asc").
		Find(&snap.Pages).Error; err != nil {
		return nil, err
	}
	if len(snap.Pages) == 0 {
		return snap, nil
	}
	pageIDs := make([]int64, 0, len(snap.Pages))
	for _, p := range snap.Pages {
		pageIDs = append(pageIDs, p.ID)
	}
	var sources []WikiPageSource
	if err := dbWithOptionalCtx(ctxs...).
		Select("page_id, source_file_id").
		Where("eid = ? AND page_id IN ? AND source_file_id > 0", eid, pageIDs).
		Find(&sources).Error; err != nil {
		return nil, err
	}
	for _, s := range sources {
		snap.PageSources[s.PageID] = append(snap.PageSources[s.PageID], s.SourceFileID)
	}
	// 标记已删除来源（硬删=files 表无此 id，软删=is_deleted=true）：不参与权限交集。
	sourceFileSet := make(map[int64]struct{})
	for _, ids := range snap.PageSources {
		for _, id := range ids {
			sourceFileSet[id] = struct{}{}
		}
	}
	if len(sourceFileSet) > 0 {
		ids := make([]int64, 0, len(sourceFileSet))
		for id := range sourceFileSet {
			ids = append(ids, id)
		}
		var sourceFiles []File
		if err := dbWithOptionalCtx(ctxs...).Select("id, is_deleted").Where("id IN ?", ids).Find(&sourceFiles).Error; err != nil {
			return nil, err
		}
		alive := make(map[int64]bool, len(sourceFiles))
		for _, f := range sourceFiles {
			alive[f.ID] = !f.IsDeleted
		}
		for id := range sourceFileSet {
			if !alive[id] {
				snap.SourceDeleted[id] = true
			}
		}
	}
	return snap, nil
}

// BuildCapabilityWikiPerms 从 DB 构建单库 Wiki 页面显式 ACL（按 id 升序保证确定性）。
func BuildCapabilityWikiPerms(eid int64, libraryID int64, ctxs ...context.Context) (*CapabilityWikiPerms, error) {
	snap := &CapabilityWikiPerms{LibraryID: libraryID, PagePerms: []CapabilityPermRow{}}
	if eid <= 0 || libraryID <= 0 {
		return snap, nil
	}
	var pageIDs []int64
	if err := dbWithOptionalCtx(ctxs...).Model(&WikiPage{}).
		Select("id").Where("eid = ? AND library_id = ?", eid, libraryID).
		Pluck("id", &pageIDs).Error; err != nil {
		return nil, err
	}
	if len(pageIDs) == 0 {
		return snap, nil
	}
	var pagePerms []Permission
	if err := dbWithOptionalCtx(ctxs...).
		Where("eid = ? AND resource_type = ? AND resource_id IN ?", eid, RESOURCE_TYPE_WIKI_PAGE, pageIDs).
		Order("id asc").Find(&pagePerms).Error; err != nil {
		return nil, err
	}
	for _, p := range pagePerms {
		snap.PagePerms = append(snap.PagePerms, CapabilityPermRow{
			ResourceID: p.ResourceID, SubjectType: p.SubjectType, SubjectID: p.SubjectID, Permission: p.Permission,
		})
	}
	return snap, nil
}

// 以下为快照失效钩子：与 capability 快照同范式，model 层只声明回调（避免循环引用），
// service 层注册 Redis 删除实现。

var capabilityWikiInvalidator func(eid int64, libraryID int64)

var capabilityWikiPermsInvalidator func(eid int64, libraryID int64)

// SetCapabilityWikiInvalidator 注册 Wiki 页面结构快照失效回调。
func SetCapabilityWikiInvalidator(invalidator func(eid int64, libraryID int64)) {
	capabilityWikiInvalidator = invalidator
}

// SetCapabilityWikiPermsInvalidator 注册 Wiki 页面 ACL 快照失效回调。
func SetCapabilityWikiPermsInvalidator(invalidator func(eid int64, libraryID int64)) {
	capabilityWikiPermsInvalidator = invalidator
}

// InvalidateCapabilityWiki 失效单库 Wiki 页面结构快照（页面增删改/归档/移动库/Source 关联变更后调用）。
func InvalidateCapabilityWiki(eid int64, libraryID int64) {
	if eid <= 0 || libraryID <= 0 || capabilityWikiInvalidator == nil {
		return
	}
	capabilityWikiInvalidator(eid, libraryID)
}

// InvalidateCapabilityWikiPerms 失效单库 Wiki 页面 ACL 快照（该库 WIKI_PAGE 权限写入后调用）。
func InvalidateCapabilityWikiPerms(eid int64, libraryID int64) {
	if eid <= 0 || libraryID <= 0 || capabilityWikiPermsInvalidator == nil {
		return
	}
	capabilityWikiPermsInvalidator(eid, libraryID)
}

// InvalidateCapabilityWikiPermsForResource 按权限写入的资源定位到所属库并失效 Wiki ACL 快照。
// 仅处理 WIKI_PAGE：查页面映射到 libraryID（写路径低频，1 次点查可接受）。
func InvalidateCapabilityWikiPermsForResource(eid int64, resourceType int, resourceID int64) {
	if eid <= 0 || resourceID <= 0 || resourceType != RESOURCE_TYPE_WIKI_PAGE {
		return
	}
	page, err := GetWikiPageByID(eid, resourceID)
	if err != nil || page == nil || page.LibraryID <= 0 {
		return
	}
	InvalidateCapabilityWikiPerms(eid, page.LibraryID)
}
