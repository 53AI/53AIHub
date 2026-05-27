package common

import (
	"errors"
	"fmt"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/helper"
	"github.com/53AI/53AIHub/model"
)

const permissionCacheTTLSeconds int64 = 60 * 60

type permissionResolver struct {
	eid    int64
	userID int64
	user   *model.User

	groupIDs []int64

	spaceCache               map[int64]*model.Space
	libraryCache             map[int64]*model.Library
	fileChainCache           map[int64]*fileChain
	spacePermissionCache     map[int64]int
	spaceRolePermissionCache map[int64]int
	libraryPermissionCache   map[int64]int
	filePermissionCache      map[int64]int
}

type fileChain struct {
	current *model.File
	chain   []model.File
}

// NewPermissionResolver loads the user and their subject membership once so
// repeated permission checks can reuse the same context.
func NewPermissionResolver(eid int64, userID int64) (*permissionResolver, error) {
	user, err := model.GetUserByID(userID)
	if err != nil {
		return nil, err
	}
	if user == nil || user.Eid != eid {
		return nil, fmt.Errorf("user %d does not belong to eid %d", userID, eid)
	}

	groupIDs, err := user.GetUserGroupIds()
	if err != nil {
		return nil, err
	}

	return &permissionResolver{
		eid:                      eid,
		userID:                   userID,
		user:                     user,
		groupIDs:                 groupIDs,
		spaceCache:               make(map[int64]*model.Space),
		libraryCache:             make(map[int64]*model.Library),
		fileChainCache:           make(map[int64]*fileChain),
		spacePermissionCache:     make(map[int64]int),
		spaceRolePermissionCache: make(map[int64]int),
		libraryPermissionCache:   make(map[int64]int),
		filePermissionCache:      make(map[int64]int),
	}, nil
}

func uniqueInt64IDs(ids []int64) []int64 {
	if len(ids) == 0 {
		return nil
	}
	seen := make(map[int64]struct{}, len(ids))
	unique := make([]int64, 0, len(ids))
	for _, id := range ids {
		if id <= 0 {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		unique = append(unique, id)
	}
	if len(unique) == 0 {
		return nil
	}
	return unique
}

func (r *permissionResolver) GetPermission(resourceType int, resourceID int64) (int, error) {
	if r == nil {
		return 0, errors.New("permission resolver is nil")
	}
	if resourceID <= 0 {
		return model.PERMISSION_NONE, nil
	}

	cacheKey := GetPermissionCacheKey(r.eid, resourceType, resourceID, r.userID)
	if RedisEnabled {
		if cachedPermission, cacheErr := RedisGetInt64(cacheKey); cacheErr == nil {
			permission := int(cachedPermission)
			r.cacheResolvedPermission(resourceType, resourceID, permission)
			return permission, nil
		}
	}

	permission, err := r.ResolvePermission(resourceType, resourceID)
	if err != nil {
		return 0, err
	}

	r.cacheResolvedPermission(resourceType, resourceID, permission)
	if RedisEnabled {
		if cacheErr := RedisSetInt64(cacheKey, int64(permission), permissionCacheTTLSeconds); cacheErr != nil &&
			!errors.Is(cacheErr, ErrRedisNotEnabled) {
			logger.SysWarnf("Failed to cache permission: eid=%d resource_type=%d resource_id=%d user_id=%d err=%v",
				r.eid, resourceType, resourceID, r.userID, cacheErr)
		}
	}

	return permission, nil
}

func (r *permissionResolver) BatchGetPermissions(resourceType int, resourceIDs []int64) (map[int64]int, error) {
	result := make(map[int64]int)
	uniqueIDs := uniqueInt64IDs(resourceIDs)
	if len(uniqueIDs) == 0 {
		return result, nil
	}

	if !RedisEnabled {
		for _, resourceID := range uniqueIDs {
			permission, err := r.ResolvePermission(resourceType, resourceID)
			if err != nil {
				return nil, err
			}
			result[resourceID] = permission
			r.cacheResolvedPermission(resourceType, resourceID, permission)
		}
		return result, nil
	}

	cacheKeys := make([]string, 0, len(uniqueIDs))
	for _, resourceID := range uniqueIDs {
		cacheKeys = append(cacheKeys, GetPermissionCacheKey(r.eid, resourceType, resourceID, r.userID))
	}

	cachedMap, cacheErr := RedisMGetInt64(cacheKeys)
	if cacheErr != nil && !errors.Is(cacheErr, ErrRedisNotEnabled) {
		logger.SysWarnf("Failed to batch read permission cache: eid=%d resource_type=%d user_id=%d err=%v",
			r.eid, resourceType, r.userID, cacheErr)
	}

	missingIDs := make([]int64, 0, len(uniqueIDs))
	for i, resourceID := range uniqueIDs {
		cacheKey := cacheKeys[i]
		if cachedPermission, ok := cachedMap[cacheKey]; ok {
			permission := int(cachedPermission)
			result[resourceID] = permission
			r.cacheResolvedPermission(resourceType, resourceID, permission)
			continue
		}
		missingIDs = append(missingIDs, resourceID)
	}

	if len(missingIDs) == 0 {
		return result, nil
	}

	cacheSetValues := make(map[string]int64, len(missingIDs))
	for _, resourceID := range missingIDs {
		permission, err := r.ResolvePermission(resourceType, resourceID)
		if err != nil {
			return nil, err
		}
		result[resourceID] = permission
		r.cacheResolvedPermission(resourceType, resourceID, permission)
		cacheSetValues[GetPermissionCacheKey(r.eid, resourceType, resourceID, r.userID)] = int64(permission)
	}

	if RedisEnabled {
		if cacheErr := RedisMSetInt64(cacheSetValues, permissionCacheTTLSeconds); cacheErr != nil &&
			!errors.Is(cacheErr, ErrRedisNotEnabled) {
			logger.SysWarnf("Failed to batch cache permissions: eid=%d resource_type=%d user_id=%d count=%d err=%v",
				r.eid, resourceType, r.userID, len(cacheSetValues), cacheErr)
		}
	}

	return result, nil
}

func (r *permissionResolver) ResolvePermission(resourceType int, resourceID int64) (int, error) {
	switch resourceType {
	case model.RESOURCE_TYPE_SPACE:
		return r.resolveSpacePermission(resourceID)
	case model.RESOURCE_TYPE_LIBRARY:
		return r.resolveLibraryPermission(resourceID)
	case model.RESOURCE_TYPE_FILE:
		return r.resolveFilePermission(resourceID)
	default:
		return 0, errors.New("未知资源错误")
	}
}

func (r *permissionResolver) cacheResolvedPermission(resourceType int, resourceID int64, permission int) {
	switch resourceType {
	case model.RESOURCE_TYPE_SPACE:
		r.spacePermissionCache[resourceID] = permission
	case model.RESOURCE_TYPE_LIBRARY:
		r.libraryPermissionCache[resourceID] = permission
	case model.RESOURCE_TYPE_FILE:
		r.filePermissionCache[resourceID] = permission
	}
}

func (r *permissionResolver) cachedResolvedPermission(resourceType int, resourceID int64) (int, bool) {
	switch resourceType {
	case model.RESOURCE_TYPE_SPACE:
		permission, ok := r.spacePermissionCache[resourceID]
		return permission, ok
	case model.RESOURCE_TYPE_LIBRARY:
		permission, ok := r.libraryPermissionCache[resourceID]
		return permission, ok
	case model.RESOURCE_TYPE_FILE:
		permission, ok := r.filePermissionCache[resourceID]
		return permission, ok
	default:
		return 0, false
	}
}

func (r *permissionResolver) loadSpace(spaceID int64) (*model.Space, error) {
	if space, ok := r.spaceCache[spaceID]; ok {
		return space, nil
	}

	space, err := model.GetSpaceByID(r.eid, spaceID)
	if err != nil {
		return nil, err
	}
	r.spaceCache[spaceID] = space
	return space, nil
}

func (r *permissionResolver) loadLibrary(libraryID int64) (*model.Library, error) {
	if library, ok := r.libraryCache[libraryID]; ok {
		return library, nil
	}

	library, err := model.GetLibraryByID(r.eid, libraryID)
	if err != nil {
		return nil, err
	}
	r.libraryCache[libraryID] = library
	return library, nil
}

func (r *permissionResolver) loadFileChain(fileID int64) (*fileChain, error) {
	if chain, ok := r.fileChainCache[fileID]; ok {
		return chain, nil
	}

	currentFile, files, err := model.GetFileWithParentsByID(r.eid, fileID)
	if err != nil {
		return nil, err
	}

	chain := &fileChain{
		current: currentFile,
		chain:   files,
	}
	r.fileChainCache[fileID] = chain
	return chain, nil
}

func (r *permissionResolver) resolveSpacePermission(spaceID int64) (int, error) {
	if permission, ok := r.cachedResolvedPermission(model.RESOURCE_TYPE_SPACE, spaceID); ok {
		return permission, nil
	}

	space, err := r.loadSpace(spaceID)
	if err != nil {
		return 0, err
	}

	if r.user.Type == model.UserTypeRegistered {
		r.cacheResolvedPermission(model.RESOURCE_TYPE_SPACE, spaceID, model.PERMISSION_NONE)
		return model.PERMISSION_NONE, nil
	}

	if space.OwnerID == r.userID {
		r.cacheResolvedPermission(model.RESOURCE_TYPE_SPACE, spaceID, model.PERMISSION_MANAGE)
		return model.PERMISSION_MANAGE, nil
	}

	permissions, err := model.GetResourcePermissions(r.eid, model.RESOURCE_TYPE_SPACE, spaceID)
	if err != nil {
		return 0, err
	}

	var maxGroupPermission *int
	var maxCompanyPermission *int
	for _, perm := range permissions {
		if perm.SubjectType == model.SUBJECT_TYPE_USER && perm.SubjectID == r.userID {
			r.cacheResolvedPermission(model.RESOURCE_TYPE_SPACE, spaceID, perm.Permission)
			return perm.Permission, nil
		}
		if len(r.groupIDs) > 0 && perm.SubjectType == model.SUBJECT_TYPE_GROUP &&
			helper.Int64InArray(perm.SubjectID, r.groupIDs) {
			if maxGroupPermission == nil || perm.Permission > *maxGroupPermission {
				value := perm.Permission
				maxGroupPermission = &value
			}
		}
		if perm.SubjectType == model.SUBJECT_TYPE_COMPANY_ALL {
			if maxCompanyPermission == nil || perm.Permission > *maxCompanyPermission {
				value := perm.Permission
				maxCompanyPermission = &value
			}
		}
	}

	if maxGroupPermission != nil {
		r.cacheResolvedPermission(model.RESOURCE_TYPE_SPACE, spaceID, *maxGroupPermission)
		return *maxGroupPermission, nil
	}
	if maxCompanyPermission != nil {
		r.cacheResolvedPermission(model.RESOURCE_TYPE_SPACE, spaceID, *maxCompanyPermission)
		return *maxCompanyPermission, nil
	}

	r.cacheResolvedPermission(model.RESOURCE_TYPE_SPACE, spaceID, model.PERMISSION_NONE)
	return model.PERMISSION_NONE, nil
}

func (r *permissionResolver) resolveSpaceRolePermission(spaceID int64) (int, error) {
	if permission, ok := r.spaceRolePermissionCache[spaceID]; ok {
		return permission, nil
	}

	permissions, err := model.GetResourcePermissions(r.eid, model.RESOURCE_TYPE_SPACE, spaceID)
	if err != nil {
		return 0, err
	}

	maxPermission := model.PERMISSION_NONE
	for _, perm := range permissions {
		if perm.SubjectType == model.SUBJECT_TYPE_USER && perm.SubjectID == r.userID && perm.Permission > maxPermission {
			maxPermission = perm.Permission
		}
		if len(r.groupIDs) > 0 && perm.SubjectType == model.SUBJECT_TYPE_GROUP &&
			helper.Int64InArray(perm.SubjectID, r.groupIDs) && perm.Permission > maxPermission {
			maxPermission = perm.Permission
		}
		if perm.SubjectType == model.SUBJECT_TYPE_COMPANY_ALL && perm.Permission > maxPermission {
			maxPermission = perm.Permission
		}
	}

	r.spaceRolePermissionCache[spaceID] = maxPermission
	return maxPermission, nil
}

func (r *permissionResolver) resolveLibraryPermission(libraryID int64) (int, error) {
	if permission, ok := r.cachedResolvedPermission(model.RESOURCE_TYPE_LIBRARY, libraryID); ok {
		return permission, nil
	}

	if r.user.Type == model.UserTypeRegistered {
		r.cacheResolvedPermission(model.RESOURCE_TYPE_LIBRARY, libraryID, model.PERMISSION_NONE)
		return model.PERMISSION_NONE, nil
	}

	library, err := r.loadLibrary(libraryID)
	if err != nil {
		return 0, err
	}
	if library == nil {
		return model.PERMISSION_NONE, nil
	}

	if library.IsPersonalLibrary() {
		if library.CreatorID == r.userID {
			r.cacheResolvedPermission(model.RESOURCE_TYPE_LIBRARY, libraryID, model.PERMISSION_MANAGE)
			return model.PERMISSION_MANAGE, nil
		}
		r.cacheResolvedPermission(model.RESOURCE_TYPE_LIBRARY, libraryID, model.PERMISSION_NONE)
		return model.PERMISSION_NONE, nil
	}

	if library.CreatorID == r.userID {
		r.cacheResolvedPermission(model.RESOURCE_TYPE_LIBRARY, libraryID, model.PERMISSION_MANAGE)
		return model.PERMISSION_MANAGE, nil
	}

	permissions, err := model.GetResourcePermissions(r.eid, model.RESOURCE_TYPE_LIBRARY, libraryID)
	if err != nil {
		return 0, err
	}

	var maxGroupPermission *int
	var companyPermission *int
	hasSpaceAdminRecord := false
	hasSpaceUserRecord := false
	spaceAdminPermission := model.PERMISSION_MANAGE
	spaceUserPermission := model.PERMISSION_NONE

	for _, perm := range permissions {
		if perm.SubjectType == model.SUBJECT_TYPE_USER && perm.SubjectID == r.userID {
			r.cacheResolvedPermission(model.RESOURCE_TYPE_LIBRARY, libraryID, perm.Permission)
			return perm.Permission, nil
		}

		if len(r.groupIDs) > 0 && perm.SubjectType == model.SUBJECT_TYPE_GROUP &&
			helper.Int64InArray(perm.SubjectID, r.groupIDs) {
			if maxGroupPermission == nil || perm.Permission > *maxGroupPermission {
				value := perm.Permission
				maxGroupPermission = &value
			}
		}

		if perm.SubjectType == model.SUBJECT_TYPE_COMPANY_ALL {
			if companyPermission == nil || perm.Permission > *companyPermission {
				value := perm.Permission
				companyPermission = &value
			}
		}

		if perm.SubjectType == model.SUBJECT_TYPE_SPACE_ADMIN {
			hasSpaceAdminRecord = true
			spaceAdminPermission = perm.Permission
		}
		if perm.SubjectType == model.SUBJECT_TYPE_SPACE_USER {
			hasSpaceUserRecord = true
			spaceUserPermission = perm.Permission
		}
	}

	if maxGroupPermission != nil {
		r.cacheResolvedPermission(model.RESOURCE_TYPE_LIBRARY, libraryID, *maxGroupPermission)
		return *maxGroupPermission, nil
	}
	if companyPermission != nil {
		r.cacheResolvedPermission(model.RESOURCE_TYPE_LIBRARY, libraryID, *companyPermission)
		return *companyPermission, nil
	}

	spacePermission, err := r.resolveSpaceRolePermission(library.SpaceID)
	if err != nil {
		return 0, err
	}
	isAdmin := spacePermission == model.PERMISSION_MANAGE
	isMember := spacePermission >= model.PERMISSION_VIEW_ONLY

	if isAdmin {
		if !hasSpaceAdminRecord {
			r.cacheResolvedPermission(model.RESOURCE_TYPE_LIBRARY, libraryID, spacePermission)
			return spacePermission, nil
		}
		r.cacheResolvedPermission(model.RESOURCE_TYPE_LIBRARY, libraryID, spaceAdminPermission)
		return spaceAdminPermission, nil
	}
	if isMember {
		if !hasSpaceUserRecord {
			r.cacheResolvedPermission(model.RESOURCE_TYPE_LIBRARY, libraryID, spacePermission)
			return spacePermission, nil
		}
		r.cacheResolvedPermission(model.RESOURCE_TYPE_LIBRARY, libraryID, spaceUserPermission)
		return spaceUserPermission, nil
	}

	r.cacheResolvedPermission(model.RESOURCE_TYPE_LIBRARY, libraryID, model.PERMISSION_NONE)
	return model.PERMISSION_NONE, nil
}

func (r *permissionResolver) resolveFilePermission(fileID int64) (int, error) {
	if permission, ok := r.cachedResolvedPermission(model.RESOURCE_TYPE_FILE, fileID); ok {
		return permission, nil
	}

	if r.user.Type == model.UserTypeRegistered {
		r.cacheResolvedPermission(model.RESOURCE_TYPE_FILE, fileID, model.PERMISSION_NONE)
		return model.PERMISSION_NONE, nil
	}

	fileChain, err := r.loadFileChain(fileID)
	if err != nil {
		return 0, err
	}
	if fileChain == nil || fileChain.current == nil {
		r.cacheResolvedPermission(model.RESOURCE_TYPE_FILE, fileID, model.PERMISSION_NONE)
		return model.PERMISSION_NONE, nil
	}

	fileIDs := make([]int64, 0, len(fileChain.chain))
	for _, file := range fileChain.chain {
		fileIDs = append(fileIDs, file.ID)
	}

	allFilePermissions, err := model.GetResourcesPermissions(r.eid, model.RESOURCE_TYPE_FILE, fileIDs)
	if err != nil || len(allFilePermissions) == 0 {
		permission, permErr := r.resolveLibraryPermission(fileChain.current.LibraryID)
		if permErr != nil {
			return 0, permErr
		}
		r.cacheResolvedPermission(model.RESOURCE_TYPE_FILE, fileID, permission)
		return permission, nil
	}

	var bestPermission *int
	var bestLevel *int
	var bestPriority int

	for index, f := range fileChain.chain {
		var currentUserPermission *int
		var currentGroupPermission *int
		var currentLibraryUserPermission *int
		var currentCompanyPermission *int

		for _, perm := range allFilePermissions {
			if perm.ResourceID != f.ID {
				continue
			}

			if perm.SubjectType == model.SUBJECT_TYPE_USER && perm.SubjectID == r.userID && currentUserPermission == nil {
				value := perm.Permission
				currentUserPermission = &value
			} else if len(r.groupIDs) > 0 && perm.SubjectType == model.SUBJECT_TYPE_GROUP &&
				helper.Int64InArray(perm.SubjectID, r.groupIDs) {
				if currentGroupPermission == nil || perm.Permission > *currentGroupPermission {
					value := perm.Permission
					currentGroupPermission = &value
				}
			} else if perm.SubjectType == model.SUBJECT_TYPE_LIBRARY_USER && currentLibraryUserPermission == nil {
				value := perm.Permission
				currentLibraryUserPermission = &value
			} else if perm.SubjectType == model.SUBJECT_TYPE_COMPANY_ALL && currentCompanyPermission == nil {
				value := perm.Permission
				currentCompanyPermission = &value
			}
		}

		if currentUserPermission != nil {
			if bestPermission == nil || index < *bestLevel || (index == *bestLevel && 1 > bestPriority) {
				bestPermission = currentUserPermission
				level := index
				bestLevel = &level
				bestPriority = 1
			}
		} else if currentGroupPermission != nil {
			if bestPermission == nil || index < *bestLevel || (index == *bestLevel && 2 > bestPriority) {
				bestPermission = currentGroupPermission
				level := index
				bestLevel = &level
				bestPriority = 2
			}
		} else if currentLibraryUserPermission != nil {
			if bestPermission == nil || index < *bestLevel || (index == *bestLevel && 3 > bestPriority) {
				bestPermission = currentLibraryUserPermission
				level := index
				bestLevel = &level
				bestPriority = 3
			}
		} else if currentCompanyPermission != nil {
			if bestPermission == nil || index < *bestLevel || (index == *bestLevel && 4 > bestPriority) {
				bestPermission = currentCompanyPermission
				level := index
				bestLevel = &level
				bestPriority = 4
			}
		}
	}

	if bestPermission != nil {
		r.cacheResolvedPermission(model.RESOURCE_TYPE_FILE, fileID, *bestPermission)
		return *bestPermission, nil
	}

	permission, err := r.resolveLibraryPermission(fileChain.current.LibraryID)
	if err != nil {
		return 0, err
	}
	r.cacheResolvedPermission(model.RESOURCE_TYPE_FILE, fileID, permission)
	return permission, nil
}

// GetUserPermission resolves a single resource permission and uses Redis cache
// when available.
func GetUserPermission(eid int64, resourceType int, resourceID int64, userID int64) (int, error) {
	resolver, err := NewPermissionResolver(eid, userID)
	if err != nil {
		return 0, err
	}
	return resolver.GetPermission(resourceType, resourceID)
}

// BatchGetUserPermissions resolves permissions for a batch of resource IDs.
func BatchGetUserPermissions(eid int64, resourceType int, resourceIDs []int64, userID int64) (map[int64]int, error) {
	resolver, err := NewPermissionResolver(eid, userID)
	if err != nil {
		return nil, err
	}
	return resolver.BatchGetPermissions(resourceType, resourceIDs)
}
