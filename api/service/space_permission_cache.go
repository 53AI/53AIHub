package service

import (
	"github.com/53AI/53AIHub/common"
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

	return nil
}

func invalidatePermissionCacheByResource(eid int64, resourceType int, resourceID int64) error {
	switch resourceType {
	case model.RESOURCE_TYPE_SPACE:
		return invalidateSpacePermissionCacheHierarchy(eid, resourceID)
	case model.RESOURCE_TYPE_LIBRARY:
		return invalidateLibraryPermissionCacheHierarchy(eid, resourceID)
	case model.RESOURCE_TYPE_FILE:
		return invalidatePermissionCacheForResources(eid, resourceType, []int64{resourceID})
	default:
		return nil
	}
}
