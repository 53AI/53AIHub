package service

import (
	"strings"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
)

// collectSpacePermissionCacheKeys 收集空间及其下属知识库、文件的最终权限缓存 key。
// 仅用于用户维度的最终权限缓存失效。
func collectSpacePermissionCacheKeys(eid int64, spaceID int64, userID int64) ([]string, error) {
	if spaceID <= 0 || userID <= 0 {
		return nil, nil
	}

	keys := make([]string, 0, 8)
	seen := make(map[string]struct{}, 8)
	appendKey := func(key string) {
		if key == "" {
			return
		}
		if _, ok := seen[key]; ok {
			return
		}
		seen[key] = struct{}{}
		keys = append(keys, key)
	}

	appendKey(common.GetPermissionCacheKey(eid, model.RESOURCE_TYPE_SPACE, spaceID, userID))

	libraries, err := model.GetLibrariesBySpaceID(eid, spaceID)
	if err != nil {
		return nil, err
	}
	for _, library := range libraries {
		appendKey(common.GetPermissionCacheKey(eid, model.RESOURCE_TYPE_LIBRARY, library.ID, userID))

		files, err := model.GetFilesByLibraryID(eid, library.ID)
		if err != nil {
			return nil, err
		}
		for _, file := range files {
			appendKey(common.GetPermissionCacheKey(eid, model.RESOURCE_TYPE_FILE, file.ID, userID))
		}
	}

	return keys, nil
}

// collectLibraryPermissionCacheKeys 收集知识库及其下属文件的最终权限缓存 key。
// 仅用于用户维度的最终权限缓存失效。
func collectLibraryPermissionCacheKeys(eid int64, libraryID int64, userID int64) ([]string, error) {
	if libraryID <= 0 || userID <= 0 {
		return nil, nil
	}

	keys := make([]string, 0, 4)
	seen := make(map[string]struct{}, 4)
	appendKey := func(key string) {
		if key == "" {
			return
		}
		if _, ok := seen[key]; ok {
			return
		}
		seen[key] = struct{}{}
		keys = append(keys, key)
	}

	appendKey(common.GetPermissionCacheKey(eid, model.RESOURCE_TYPE_LIBRARY, libraryID, userID))

	files, err := model.GetFilesByLibraryID(eid, libraryID)
	if err != nil {
		return nil, err
	}
	for _, file := range files {
		appendKey(common.GetPermissionCacheKey(eid, model.RESOURCE_TYPE_FILE, file.ID, userID))
	}

	return keys, nil
}

// collectFilePermissionCacheKeys 收集文件/文件夹及其下属后代文件的最终权限缓存 key。
// 仅用于用户维度的最终权限缓存失效。
func collectFilePermissionCacheKeys(eid int64, fileID int64, userID int64) ([]string, error) {
	if fileID <= 0 || userID <= 0 {
		return nil, nil
	}

	keys := make([]string, 0, 4)
	seen := make(map[string]struct{}, 4)
	appendKey := func(key string) {
		if key == "" {
			return
		}
		if _, ok := seen[key]; ok {
			return
		}
		seen[key] = struct{}{}
		keys = append(keys, key)
	}

	appendKey(common.GetPermissionCacheKey(eid, model.RESOURCE_TYPE_FILE, fileID, userID))

	file, err := model.GetFileByID(eid, fileID)
	if err != nil || file == nil || file.Type != model.FILE_TYPE_DIR {
		return keys, nil
	}

	dirPath := file.GetPath()
	if dirPath != "" && dirPath != "/" {
		prefix := strings.TrimSuffix(dirPath, "/") + "/%"
		prefixWithoutSlash := strings.TrimPrefix(prefix, "/")
		var descendantIDs []int64
		if err := model.DB.Model(&model.File{}).
			Where("eid = ? AND library_id = ? AND (path LIKE ? OR path LIKE ?)", eid, file.LibraryID, prefix, prefixWithoutSlash).
			Pluck("id", &descendantIDs).Error; err == nil {
			for _, descID := range descendantIDs {
				appendKey(common.GetPermissionCacheKey(eid, model.RESOURCE_TYPE_FILE, descID, userID))
			}
		}
	}

	return keys, nil
}

func invalidateFilePermissionCacheHierarchy(eid int64, fileID int64) error {
	if !common.RedisEnabled || fileID <= 0 {
		return nil
	}

	fileIDs := []int64{fileID}

	file, err := model.GetFileByID(eid, fileID)
	if err == nil && file != nil && file.Type == model.FILE_TYPE_DIR {
		dirPath := file.GetPath()
		if dirPath != "" && dirPath != "/" {
			prefix := strings.TrimSuffix(dirPath, "/") + "/%"
			prefixWithoutSlash := strings.TrimPrefix(prefix, "/")
			var descendantIDs []int64
			if err := model.DB.Model(&model.File{}).
				Where("eid = ? AND library_id = ? AND (path LIKE ? OR path LIKE ?)", eid, file.LibraryID, prefix, prefixWithoutSlash).
				Pluck("id", &descendantIDs).Error; err == nil && len(descendantIDs) > 0 {
				fileIDs = append(fileIDs, descendantIDs...)
			}
		}
	}

	// 目录权限变更连带影响其下文件的 Wiki 来源页：逐个反查依赖页面并失效其页面权限缓存。
	for _, id := range fileIDs {
		invalidateDependentWikiPagePermissionCache(eid, model.RESOURCE_TYPE_FILE, id)
	}

	return invalidatePermissionCacheForResources(eid, model.RESOURCE_TYPE_FILE, fileIDs)
}

func invalidateSpacePermissionCacheHierarchy(eid int64, spaceID int64) error {
	if !common.RedisEnabled || spaceID <= 0 {
		return nil
	}

	if err := invalidatePermissionCacheForResources(eid, model.RESOURCE_TYPE_SPACE, []int64{spaceID}); err != nil {
		return err
	}

	libraries, err := model.GetLibrariesBySpaceID(eid, spaceID)
	if err != nil {
		return err
	}
	libraryIDs := make([]int64, 0, len(libraries))
	fileIDs := make([]int64, 0)
	for _, library := range libraries {
		libraryIDs = append(libraryIDs, library.ID)

		files, err := model.GetFilesByLibraryID(eid, library.ID)
		if err != nil {
			return err
		}
		for _, file := range files {
			fileIDs = append(fileIDs, file.ID)
		}
	}

	if err := invalidatePermissionCacheForResources(eid, model.RESOURCE_TYPE_LIBRARY, libraryIDs); err != nil {
		return err
	}
	if err := invalidatePermissionCacheForResources(eid, model.RESOURCE_TYPE_FILE, fileIDs); err != nil {
		return err
	}

	// 空间权限变更影响该空间下所有 Wiki 页面的 fallback，连带失效页面权限缓存。
	invalidateDependentWikiPagePermissionCache(eid, model.RESOURCE_TYPE_SPACE, spaceID)

	return nil
}

func invalidateLibraryPermissionCacheHierarchy(eid int64, libraryID int64) error {
	if !common.RedisEnabled || libraryID <= 0 {
		return nil
	}

	if err := invalidatePermissionCacheForResources(eid, model.RESOURCE_TYPE_LIBRARY, []int64{libraryID}); err != nil {
		return err
	}

	files, err := model.GetFilesByLibraryID(eid, libraryID)
	if err != nil {
		return err
	}
	fileIDs := make([]int64, 0, len(files))
	for _, file := range files {
		fileIDs = append(fileIDs, file.ID)
	}
	if err := invalidatePermissionCacheForResources(eid, model.RESOURCE_TYPE_FILE, fileIDs); err != nil {
		return err
	}

	// 库权限变更影响该库下所有 Wiki 页面的 fallback，连带失效页面权限缓存。
	invalidateDependentWikiPagePermissionCache(eid, model.RESOURCE_TYPE_LIBRARY, libraryID)

	return nil
}
func invalidatePermissionCacheByResource(eid int64, resourceType int, resourceID int64) error {
	switch resourceType {
	case model.RESOURCE_TYPE_SPACE:
		return invalidateSpacePermissionCacheHierarchy(eid, resourceID)
	case model.RESOURCE_TYPE_LIBRARY:
		return invalidateLibraryPermissionCacheHierarchy(eid, resourceID)
	case model.RESOURCE_TYPE_FILE:
		return invalidateFilePermissionCacheHierarchy(eid, resourceID)
	case model.RESOURCE_TYPE_WIKI_PAGE:
		return invalidatePermissionCacheForResources(eid, resourceType, []int64{resourceID})
	case model.RESOURCE_TYPE_WIKI_SPACE:
		// Wiki 空间权限（type=4）的 resource_id 即 spaceID：它是页面空间级继承层，变更后
		// 该空间下所有页面的最终权限都会变，必须连带失效页面级缓存（否则旧值在 TTL 1h 内继续放行）。
		invalidateDependentWikiPagePermissionCache(eid, model.RESOURCE_TYPE_SPACE, resourceID)
		return nil
	default:
		return nil
	}
}

// invalidateDependentWikiPagePermissionCache 失效"权限依赖该资源"的 Wiki 页面权限缓存。
// Wiki 页面的最终权限 = 页面 ACL ∩ 来源文件 ACL（库级/空间级为其 fallback），因此
// 来源文件/所属库/所属空间的权限变更都会让已缓存的页面最终值失效：
//   - FILE → 反查 wiki_page_sources 得到依赖页
//   - LIBRARY / SPACE → 该库/空间下所有页面
//
// 不失效时旧值会在权限缓存 TTL（1h）内继续放行，导致"来源文档设为无权限后页面仍可见"。
func invalidateDependentWikiPagePermissionCache(eid int64, resourceType int, resourceID int64) {
	if !common.RedisEnabled || eid <= 0 || resourceID <= 0 {
		return
	}
	pageIDs, err := model.GetWikiPageIDsByScope(eid, resourceType, resourceID)
	if err != nil {
		logger.SysWarnf("【权限】反查 Wiki 依赖页面失败: eid=%d resource_type=%d resource_id=%d err=%v", eid, resourceType, resourceID, err)
		return
	}
	if len(pageIDs) == 0 {
		return
	}
	if err := invalidatePermissionCacheForResources(eid, model.RESOURCE_TYPE_WIKI_PAGE, pageIDs); err != nil {
		logger.SysWarnf("【权限】清理 Wiki 页面权限缓存失败: eid=%d resource_type=%d resource_id=%d pages=%d err=%v",
			eid, resourceType, resourceID, len(pageIDs), err)
	}
}
