package service

import (
	"github.com/53AI/53AIHub/model"
)

// IsLibraryVisible 判断用户是否能看到指定知识库
func IsLibraryVisible(eid int64, libraryID int64, userID int64) (bool, error) {
	// 1. 获取知识库信息
	library, err := model.GetLibraryByID(eid, libraryID)
	if err != nil {
		return false, err
	}

	// 2. 根据知识库可见性设置判断
	switch library.Visibility {
	case model.LIBRARY_VISIBILITY_PUBLIC:
		// 明确设置为可见，任何人可见
		return true, nil

	case model.LIBRARY_VISIBILITY_PRIVATE:
		// 明确设置为不可见，只有成员可见
		hasPermission, err := hasLibraryPermission(eid, libraryID, userID)
		if err != nil {
			return false, err
		}
		return hasPermission, nil

	case model.LIBRARY_VISIBILITY_INHERIT:
		// 继承空间设置，获取空间信息
		space, err := model.GetSpaceByID(eid, library.SpaceID)
		if err != nil {
			return false, err
		}

		// 根据空间可见性判断
		if space.Visibility == model.SPACE_VISIBILITY_PUBLIC {
			// 空间可见，则知识库也可见
			return true, nil
		} else {
			// 空间不可见，只有成员可见
			hasPermission, err := hasLibraryPermission(eid, libraryID, userID)
			if err != nil {
				return false, err
			}
			return hasPermission, nil
		}
	}

	return false, nil
}

// hasLibraryPermission 检查用户是否对知识库有权限
// 该函数在生产环境中会复用LibraryPermissionService.GetUserLibraryPermission
func hasLibraryPermission(eid int64, libraryID int64, userID int64) (bool, error) {
	libraryPermissionService := NewLibraryPermissionService(eid)
	permission, err := libraryPermissionService.GetUserLibraryPermission(userID, libraryID)
	return permission > model.PERMISSION_NONE, err
}