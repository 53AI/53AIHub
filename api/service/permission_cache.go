package service

import (
	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
)

func invalidatePermissionCacheForResources(eid int64, resourceType int, resourceIDs []int64) error {
	if !common.RedisEnabled || len(resourceIDs) == 0 {
		return nil
	}

	if _, err := common.RedisDelPermissionCacheByResourceIDs(eid, resourceType, resourceIDs); err != nil &&
		err != common.ErrRedisNotEnabled {
		return err
	}

	return nil
}

func invalidatePermissionCacheForFile(eid, fileID int64) {
	if err := invalidatePermissionCacheForResources(eid, model.RESOURCE_TYPE_FILE, []int64{fileID}); err != nil {
		logger.SysWarnf("Failed to clear permission cache: eid=%d resource_type=%d resource_ids=%v err=%v",
			eid, model.RESOURCE_TYPE_FILE, []int64{fileID}, err)
	}
}

func invalidatePermissionCacheForLibrary(eid, libraryID int64) {
	if err := invalidatePermissionCacheForResources(eid, model.RESOURCE_TYPE_LIBRARY, []int64{libraryID}); err != nil {
		logger.SysWarnf("Failed to clear permission cache: eid=%d resource_type=%d resource_ids=%v err=%v",
			eid, model.RESOURCE_TYPE_LIBRARY, []int64{libraryID}, err)
	}

	files, err := model.GetFilesByLibraryID(eid, libraryID)
	if err != nil {
		logger.SysWarnf("Failed to load files for permission cache invalidation: eid=%d library_id=%d err=%v",
			eid, libraryID, err)
		return
	}

	fileIDs := make([]int64, 0, len(files))
	for _, file := range files {
		fileIDs = append(fileIDs, file.ID)
	}
	if err := invalidatePermissionCacheForResources(eid, model.RESOURCE_TYPE_FILE, fileIDs); err != nil {
		logger.SysWarnf("Failed to clear permission cache: eid=%d resource_type=%d resource_ids=%v err=%v",
			eid, model.RESOURCE_TYPE_FILE, fileIDs, err)
	}
}

func invalidatePermissionCacheForSpace(eid, spaceID int64) {
	if err := invalidatePermissionCacheForResources(eid, model.RESOURCE_TYPE_SPACE, []int64{spaceID}); err != nil {
		logger.SysWarnf("Failed to clear permission cache: eid=%d resource_type=%d resource_ids=%v err=%v",
			eid, model.RESOURCE_TYPE_SPACE, []int64{spaceID}, err)
	}

	libraries, err := model.GetLibrariesBySpaceID(eid, spaceID)
	if err != nil {
		logger.SysWarnf("Failed to load libraries for permission cache invalidation: eid=%d space_id=%d err=%v",
			eid, spaceID, err)
		return
	}

	libraryIDs := make([]int64, 0, len(libraries))
	fileIDs := make([]int64, 0)
	for _, library := range libraries {
		libraryIDs = append(libraryIDs, library.ID)

		files, err := model.GetFilesByLibraryID(eid, library.ID)
		if err != nil {
			logger.SysWarnf("Failed to load files for permission cache invalidation: eid=%d library_id=%d err=%v",
				eid, library.ID, err)
			continue
		}
		for _, file := range files {
			fileIDs = append(fileIDs, file.ID)
		}
	}

	if err := invalidatePermissionCacheForResources(eid, model.RESOURCE_TYPE_LIBRARY, libraryIDs); err != nil {
		logger.SysWarnf("Failed to clear permission cache: eid=%d resource_type=%d resource_ids=%v err=%v",
			eid, model.RESOURCE_TYPE_LIBRARY, libraryIDs, err)
	}
	if err := invalidatePermissionCacheForResources(eid, model.RESOURCE_TYPE_FILE, fileIDs); err != nil {
		logger.SysWarnf("Failed to clear permission cache: eid=%d resource_type=%d resource_ids=%v err=%v",
			eid, model.RESOURCE_TYPE_FILE, fileIDs, err)
	}
}
