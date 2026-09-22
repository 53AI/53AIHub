package common

import (
	"context"
	"errors"
	"fmt"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/helper"
	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

const permissionCacheTTLSeconds int64 = 60 * 60

type permissionResolver struct {
	eid    int64
	userID int64
	ctx    context.Context
	user   *model.User

	groupIDs []int64

	spaceCache               map[int64]*model.Space
	libraryCache             map[int64]*model.Library
	fileChainCache           map[int64]*fileChain
	spacePermissionCache     map[int64]int
	spaceRolePermissionCache map[int64]int
	libraryPermissionCache   map[int64]int
	filePermissionCache      map[int64]int
	wikiPagePermissionCache  map[int64]int

	// Wiki 权限快照（service 层按库预加载后注入，common 不依赖 service 避免循环）。
	// 非 nil 时 WIKI_PAGE 解析优先走快照（含 Source 文件交集）；快照未覆盖的页面回退 DB。
	// lazy: 单库快照（wikiPages+wikiPerms 一组），跨库批量时未覆盖页面走 DB 兜底。
	wikiPages *model.CapabilityWikiPages
	wikiPerms *model.CapabilityWikiPerms

	// Wiki 空间级权限（RESOURCE_TYPE_WIKI_SPACE，对标 RAG 的 SPACE 但数据独立）：
	// 按 space 粒度点查 + 请求内缓存（不进快照，与 user/group/space 决策一致）。
	wikiSpacePermissionCache    map[int64]int
	wikiSpacePermissionRecCache map[int64]bool
}

type fileChain struct {
	current *model.File
	chain   []model.File
}

// NewPermissionResolver loads the user and their subject membership once so
// repeated permission checks can reuse the same context.
func NewPermissionResolver(eid int64, userID int64, ctxs ...context.Context) (*permissionResolver, error) {
	ctx := context.Background()
	if len(ctxs) > 0 && ctxs[0] != nil {
		ctx = ctxs[0]
	}
	user, err := getCachedUserByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if user == nil || user.Eid != eid {
		return nil, fmt.Errorf("user %d does not belong to eid %d", userID, eid)
	}

	groupIDs, err := getCachedUserGroupIDs(ctx, user)
	if err != nil {
		return nil, err
	}

	return &permissionResolver{
		ctx:                         ctx,
		eid:                         eid,
		userID:                      userID,
		user:                        user,
		groupIDs:                    groupIDs,
		spaceCache:                  make(map[int64]*model.Space),
		libraryCache:                make(map[int64]*model.Library),
		fileChainCache:              make(map[int64]*fileChain),
		spacePermissionCache:        make(map[int64]int),
		spaceRolePermissionCache:    make(map[int64]int),
		libraryPermissionCache:      make(map[int64]int),
		filePermissionCache:         make(map[int64]int),
		wikiPagePermissionCache:     make(map[int64]int),
		wikiSpacePermissionCache:    make(map[int64]int),
		wikiSpacePermissionRecCache: make(map[int64]bool),
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

	// 个人知识库权限由创建者和 library_kind 决定，不能被 Redis 中的旧权限覆盖。
	// 先加载资源确认类型，再决定是否使用外部缓存。
	bypassRedisCache := false
	if resourceType == model.RESOURCE_TYPE_LIBRARY {
		library, err := r.loadLibrary(resourceID)
		if err != nil {
			return 0, err
		}
		bypassRedisCache = library != nil && library.IsPersonalLibrary()
	}

	cacheKey := GetPermissionCacheKey(r.eid, resourceType, resourceID, r.userID)
	if RedisEnabled && !bypassRedisCache {
		if cachedPermission, cacheErr := RedisGetInt64(cacheKey, r.ctx); cacheErr == nil {
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
	if RedisEnabled && !bypassRedisCache {
		if cacheErr := RedisSetInt64(cacheKey, int64(permission), permissionCacheTTLSeconds, r.ctx); cacheErr != nil &&
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
		if resourceType == model.RESOURCE_TYPE_WIKI_PAGE {
			return r.resolveWikiPagePermissions(uniqueIDs)
		}
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

	cachedMap, cacheErr := RedisMGetInt64(cacheKeys, r.ctx)
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
	if resourceType == model.RESOURCE_TYPE_WIKI_PAGE {
		batchResult, err := r.resolveWikiPagePermissions(missingIDs)
		if err != nil {
			return nil, err
		}
		for _, resourceID := range missingIDs {
			permission := batchResult[resourceID]
			result[resourceID] = permission
			cacheSetValues[GetPermissionCacheKey(r.eid, resourceType, resourceID, r.userID)] = int64(permission)
		}
	} else {
		for _, resourceID := range missingIDs {
			permission, err := r.ResolvePermission(resourceType, resourceID)
			if err != nil {
				return nil, err
			}
			result[resourceID] = permission
			r.cacheResolvedPermission(resourceType, resourceID, permission)
			cacheSetValues[GetPermissionCacheKey(r.eid, resourceType, resourceID, r.userID)] = int64(permission)
		}
	}
	if RedisEnabled {
		if cacheErr := RedisMSetInt64(cacheSetValues, permissionCacheTTLSeconds, r.ctx); cacheErr != nil &&
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
	case model.RESOURCE_TYPE_WIKI_PAGE:
		return r.resolveWikiPagePermission(resourceID)
	case model.RESOURCE_TYPE_WIKI_SPACE:
		// Wiki 空间级权限（resource_type=4）的管理/查询门槛对标空间权限：谁能管理该空间的
		// RAG 权限（SPACE），谁就能管理 WIKI_SPACE。权限记录本身独立（resource_type=4）。
		return r.resolveSpacePermission(resourceID)
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
	case model.RESOURCE_TYPE_WIKI_PAGE:
		r.wikiPagePermissionCache[resourceID] = permission
	case model.RESOURCE_TYPE_WIKI_SPACE:
		// 语义=用户对该空间的权限，与 SPACE(0) 同值，共用 spacePermissionCache。
		r.spacePermissionCache[resourceID] = permission
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
	case model.RESOURCE_TYPE_WIKI_PAGE:
		permission, ok := r.wikiPagePermissionCache[resourceID]
		return permission, ok
	case model.RESOURCE_TYPE_WIKI_SPACE:
		permission, ok := r.spacePermissionCache[resourceID]
		return permission, ok
	default:
		return 0, false
	}
}

func (r *permissionResolver) loadSpace(spaceID int64) (*model.Space, error) {
	if space, ok := r.spaceCache[spaceID]; ok {
		return space, nil
	}

	space, err := model.GetSpaceByID(r.eid, spaceID, r.ctx)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	r.spaceCache[spaceID] = space
	return space, nil
}

func (r *permissionResolver) loadLibrary(libraryID int64) (*model.Library, error) {
	if library, ok := r.libraryCache[libraryID]; ok {
		return library, nil
	}

	library, err := model.GetLibraryByID(r.eid, libraryID, r.ctx)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	r.libraryCache[libraryID] = library
	return library, nil
}

func (r *permissionResolver) loadFileChain(fileID int64) (*fileChain, error) {
	if chain, ok := r.fileChainCache[fileID]; ok {
		return chain, nil
	}

	currentFile, files, err := model.GetFileWithParentsByID(r.eid, fileID, r.ctx)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
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
	if space == nil {
		r.cacheResolvedPermission(model.RESOURCE_TYPE_SPACE, spaceID, model.PERMISSION_NONE)
		return model.PERMISSION_NONE, nil
	}

	if r.user.Type == model.UserTypeRegistered {
		r.cacheResolvedPermission(model.RESOURCE_TYPE_SPACE, spaceID, model.PERMISSION_NONE)
		return model.PERMISSION_NONE, nil
	}

	if space.OwnerID == r.userID {
		r.cacheResolvedPermission(model.RESOURCE_TYPE_SPACE, spaceID, model.PERMISSION_MANAGE)
		return model.PERMISSION_MANAGE, nil
	}

	permissions, err := model.GetResourcePermissions(r.eid, model.RESOURCE_TYPE_SPACE, spaceID, r.ctx)
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

	permissions, err := model.GetResourcePermissions(r.eid, model.RESOURCE_TYPE_SPACE, spaceID, r.ctx)
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

	permissions, err := model.GetResourcePermissions(r.eid, model.RESOURCE_TYPE_LIBRARY, libraryID, r.ctx)
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

	allFilePermissions, err := model.GetResourcesPermissions(r.eid, model.RESOURCE_TYPE_FILE, fileIDs, r.ctx)
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

func (r *permissionResolver) resolveWikiPagePermission(pageID int64) (int, error) {
	if permission, ok := r.cachedResolvedPermission(model.RESOURCE_TYPE_WIKI_PAGE, pageID); ok {
		return permission, nil
	}

	if r.user.Type == model.UserTypeRegistered {
		r.cacheResolvedPermission(model.RESOURCE_TYPE_WIKI_PAGE, pageID, model.PERMISSION_NONE)
		return model.PERMISSION_NONE, nil
	}

	if r.wikiPages != nil {
		return r.resolveWikiPagePermissionFromSnapshot(pageID)
	}
	return r.resolveWikiPagePermissionDB(pageID)
}

// resolveWikiPagePermissionDB 无快照时的 DB 路径：页面点查 + 页面 ACL + Source 文件交集。
// Source 交集与快照路径保持一致（DB 兜底同样不扩大原始知识可见范围）。
func (r *permissionResolver) resolveWikiPagePermissionDB(pageID int64) (int, error) {
	page, err := model.GetWikiPageByID(r.eid, pageID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			r.cacheResolvedPermission(model.RESOURCE_TYPE_WIKI_PAGE, pageID, model.PERMISSION_NONE)
			return model.PERMISSION_NONE, nil
		}
		return 0, err
	}

	allPerms, err := model.GetResourcesPermissions(r.eid, model.RESOURCE_TYPE_WIKI_PAGE, []int64{pageID})
	if err != nil {
		allPerms = nil
	}
	sources, err := model.GetWikiPageSourceFileIDs(r.eid, []int64{pageID}, r.ctx)
	if err != nil {
		sources = nil
	}
	permission, fromPageACL, err := r.resolveWikiPagePermissionFromData(pageID, page.LibraryID, page.SpaceID, allPerms)
	if err != nil {
		return 0, err
	}
	// DB 兜底路径：排除已删除来源（硬删/软删），删除来源不参与权限交集。
	sourceIDs := sources[pageID]
	deleted, delErr := model.GetFilesDeletedFlags(r.eid, sourceIDs, r.ctx)
	if delErr != nil {
		deleted = nil
	}
	return r.finalizeWikiPermission(pageID, permission, fromPageACL, filterLiveWikiSources(sourceIDs, deleted))
}

// resolveWikiPagePermissionFromSnapshot 快照路径：页面结构 + 页面 ACL 均来自快照，
// Source 交集使用快照的 page→sourceFile 映射。快照未覆盖的页面回退 DB 路径。
func (r *permissionResolver) resolveWikiPagePermissionFromSnapshot(pageID int64) (int, error) {
	if r.wikiPages == nil {
		return r.resolveWikiPagePermissionDB(pageID)
	}
	var node *model.CapabilityWikiPageNode
	for i := range r.wikiPages.Pages {
		if r.wikiPages.Pages[i].ID == pageID {
			node = &r.wikiPages.Pages[i]
			break
		}
	}
	if node == nil {
		// 快照未覆盖（新建未重建/跨库）→ DB 兜底，不误伤。
		return r.resolveWikiPagePermissionDB(pageID)
	}
	allPerms := make([]model.Permission, 0)
	if r.wikiPerms != nil {
		for _, p := range r.wikiPerms.PagePerms {
			if p.ResourceID == pageID {
				allPerms = append(allPerms, model.Permission{
					Eid: r.eid, ResourceType: model.RESOURCE_TYPE_WIKI_PAGE,
					ResourceID: p.ResourceID, SubjectType: p.SubjectType, SubjectID: p.SubjectID, Permission: p.Permission,
				})
			}
		}
	}
	permission, fromPageACL, err := r.resolveWikiPagePermissionFromData(pageID, node.LibraryID, node.SpaceID, allPerms)
	if err != nil {
		return 0, err
	}
	// 排除已删除来源（硬删/软删）：删除来源不参与权限交集，不影响页面可见性。
	return r.finalizeWikiPermission(pageID, permission, fromPageACL, filterLiveWikiSources(r.wikiPages.PageSources[pageID], r.wikiPages.SourceDeleted))
}

// filterLiveWikiSources 排除已删除/不存在的来源文件（deleted map 值为 true 表示硬删或软删）。
func filterLiveWikiSources(sourceIDs []int64, deleted map[int64]bool) []int64 {
	if len(sourceIDs) == 0 || len(deleted) == 0 {
		return sourceIDs
	}
	live := make([]int64, 0, len(sourceIDs))
	for _, id := range sourceIDs {
		if !deleted[id] {
			live = append(live, id)
		}
	}
	return live
}

// finalizeWikiPermission 对纯 ACL 页面权限应用 Source 文件交集并缓存最终值。
// Source 交集：任一来源文件权限 < 页面权限 → 收窄；来源文件无权限（0）→ 整页 0。
// 页面本身无权限（0）时短路，不查 Source（省查询）。缓存必须在交集之后写入，
// 否则提前缓存的页面 ACL 值会绕过 Source 约束。
//
// 优先级（明确要求）：来源文档的显式"无权限"优先于继承来的权限——继承（空间角色/库级
// fallback）拿到的 MANAGE 不代表可以越过来源文档的显式无权限。
//
// 业务决策（勿回退）：只有**页面级显式 ACL 命中且达到 MANAGE**（"单独在页面上设置了管理
// 权限"，fromPageACL=true）才豁免 Source 交集，管理员默认可查看该页面；继承来的 MANAGE
// **不豁免**。注意这与"不能扩大原始知识传播范围"仍有张力：页面正文由 source 融合生成，
// 管理员可见页面即间接可见来源内容，属产品拍板接受的已知取舍（限页面级显式设置）；
// 非 MANAGE 权限一律严格受 Source 交集约束。
func (r *permissionResolver) finalizeWikiPermission(pageID int64, permission int, fromPageACL bool, sourceIDs []int64) (int, error) {
	exemptByPageACL := fromPageACL && permission >= model.PERMISSION_MANAGE
	if permission != model.PERMISSION_NONE && !exemptByPageACL && len(sourceIDs) > 0 {
		minSrc := model.PERMISSION_MANAGE
		for _, sid := range sourceIDs {
			sp, err := r.resolveFilePermission(sid)
			if err != nil {
				return 0, err
			}
			if sp < minSrc {
				minSrc = sp
			}
		}
		if minSrc < permission {
			permission = minSrc
		}
	}
	r.cacheResolvedPermission(model.RESOURCE_TYPE_WIKI_PAGE, pageID, permission)
	return permission, nil
}

func (r *permissionResolver) resolveWikiPagePermissions(pageIDs []int64) (map[int64]int, error) {
	result := make(map[int64]int, len(pageIDs))
	uniqueIDs := uniqueInt64IDs(pageIDs)
	if len(uniqueIDs) == 0 {
		return result, nil
	}
	if r.user.Type == model.UserTypeRegistered {
		for _, pageID := range uniqueIDs {
			r.cacheResolvedPermission(model.RESOURCE_TYPE_WIKI_PAGE, pageID, model.PERMISSION_NONE)
			result[pageID] = model.PERMISSION_NONE
		}
		return result, nil
	}

	if r.wikiPages != nil {
		for _, pageID := range uniqueIDs {
			permission, err := r.resolveWikiPagePermissionFromSnapshot(pageID)
			if err != nil {
				return nil, err
			}
			result[pageID] = permission
		}
		return result, nil
	}

	pages, err := model.GetWikiPagesByIDs(r.eid, uniqueIDs)
	if err != nil {
		return nil, err
	}
	pageMap := make(map[int64]*model.WikiPage, len(pages))
	for i := range pages {
		pageMap[pages[i].ID] = &pages[i]
	}
	permissions, err := model.GetResourcesPermissions(r.eid, model.RESOURCE_TYPE_WIKI_PAGE, uniqueIDs)
	if err != nil {
		permissions = nil
	}
	permissionsByPage := make(map[int64][]model.Permission)
	for _, permission := range permissions {
		permissionsByPage[permission.ResourceID] = append(permissionsByPage[permission.ResourceID], permission)
	}
	sources, err := model.GetWikiPageSourceFileIDs(r.eid, uniqueIDs, r.ctx)
	if err != nil {
		sources = nil
	}
	// 批量排除已删除来源（硬删/软删）：删除来源不参与权限交集。
	deleted := map[int64]bool{}
	allSourceIDs := make([]int64, 0)
	for _, ids := range sources {
		allSourceIDs = append(allSourceIDs, ids...)
	}
	if delFlags, delErr := model.GetFilesDeletedFlags(r.eid, allSourceIDs, r.ctx); delErr == nil {
		deleted = delFlags
	}

	for _, pageID := range uniqueIDs {
		page, ok := pageMap[pageID]
		if !ok {
			r.cacheResolvedPermission(model.RESOURCE_TYPE_WIKI_PAGE, pageID, model.PERMISSION_NONE)
			result[pageID] = model.PERMISSION_NONE
			continue
		}
		permission, fromPageACL, err := r.resolveWikiPagePermissionFromData(pageID, page.LibraryID, page.SpaceID, permissionsByPage[pageID])
		if err != nil {
			return nil, err
		}
		permission, err = r.finalizeWikiPermission(pageID, permission, fromPageACL, filterLiveWikiSources(sources[pageID], deleted))
		if err != nil {
			return nil, err
		}
		result[pageID] = permission
	}
	return result, nil
}

// resolveWikiSpacePermission 查 Wiki 空间级权限（RESOURCE_TYPE_WIKI_SPACE，resource_id=spaceID）。
// 返回 (maxPerm, hasRecord)：hasRecord=false 表示该空间未配置 Wiki 空间权限（fallback 库级）；
// hasRecord=true 时 maxPerm 即最终约束（未列名/显式配 0 = 禁止）。对标 RAG 的 SPACE 权限但数据独立。
// 例外：type=4 已配置但没有任何一行命中空间创建者时，创建者兜底 MANAGE（与 resolveSpacePermission
// 对 type=0 的所有者口径一致），避免把创建者锁在自己的 wiki 之外；显式命中（含配 0）仍以显式行为准。
func (r *permissionResolver) resolveWikiSpacePermission(spaceID int64) (int, bool) {
	if v, ok := r.wikiSpacePermissionCache[spaceID]; ok {
		return v, r.wikiSpacePermissionRecCache[spaceID]
	}
	permissions, err := model.GetResourcePermissions(r.eid, model.RESOURCE_TYPE_WIKI_SPACE, spaceID, r.ctx)
	if err != nil {
		return 0, false
	}
	hasRecord := len(permissions) > 0
	maxPerm := model.PERMISSION_NONE
	matched := false
	for _, perm := range permissions {
		if perm.SubjectType == model.SUBJECT_TYPE_USER && perm.SubjectID == r.userID {
			matched = true
			if perm.Permission > maxPerm {
				maxPerm = perm.Permission
			}
		}
		if len(r.groupIDs) > 0 && perm.SubjectType == model.SUBJECT_TYPE_GROUP &&
			helper.Int64InArray(perm.SubjectID, r.groupIDs) {
			matched = true
			if perm.Permission > maxPerm {
				maxPerm = perm.Permission
			}
		}
		if perm.SubjectType == model.SUBJECT_TYPE_COMPANY_ALL {
			matched = true
			if perm.Permission > maxPerm {
				maxPerm = perm.Permission
			}
		}
	}
	if hasRecord && !matched && r.isSpaceOwner(spaceID) {
		maxPerm = model.PERMISSION_MANAGE
	}
	r.wikiSpacePermissionCache[spaceID] = maxPerm
	r.wikiSpacePermissionRecCache[spaceID] = hasRecord
	return maxPerm, hasRecord
}

// isSpaceOwner 判断当前用户是否为该空间创建者（空间不存在/创建者缺失时为 false，不放大权限）。
func (r *permissionResolver) isSpaceOwner(spaceID int64) bool {
	space, err := r.loadSpace(spaceID)
	if err != nil || space == nil {
		return false
	}
	return space.OwnerID > 0 && space.OwnerID == r.userID
}

// fallbackWikiPermission Wiki 页面库级 fallback 的中间层：配置了 Wiki 空间权限（resource_type=4）
// 的空间优先用空间权限，未配置再 fallback 库级。页面显式 ACL 命中（user/group/company）时不受影响。
func (r *permissionResolver) fallbackWikiPermission(spaceID, libraryID int64) (int, error) {
	if perm, has := r.resolveWikiSpacePermission(spaceID); has {
		return perm, nil
	}
	return r.resolveLibraryPermission(libraryID)
}

// resolveWikiPagePermissionFromData 返回 (权限值, 是否来自页面级显式 ACL, error)。
// fromPageACL=true 表示结果由 resource_type=3 且 resource_id=pageID 的权限行命中决定
// （"单独在页面上设置"）；false 表示继承（空间级/库级 fallback）。
// 空间级继承口径：Wiki 空间权限（resource_type=4）已配置 → 以其为准；未配置 → RAG 空间角色
// （resource_type=0）。与 fallbackWikiPermission 同口径，保证"页面是否存在他人 ACL 行"不改变
// 空间级继承来源。
func (r *permissionResolver) resolveWikiPagePermissionFromData(pageID, libraryID, spaceID int64, allPerms []model.Permission) (int, bool, error) {
	if len(allPerms) == 0 {
		perm, err := r.fallbackWikiPermission(spaceID, libraryID)
		return perm, false, err
	}

	var userDirect *int
	var maxGroupPermission *int
	var companyPermission *int
	var libraryUserPermission *int
	hasSpaceAdminRecord := false
	hasSpaceUserRecord := false
	spaceAdminPermission := model.PERMISSION_MANAGE
	spaceUserPermission := model.PERMISSION_NONE

	for _, perm := range allPerms {
		if perm.ResourceID != pageID {
			continue
		}
		if perm.SubjectType == model.SUBJECT_TYPE_USER && perm.SubjectID == r.userID {
			value := perm.Permission
			userDirect = &value
			break
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

		if perm.SubjectType == model.SUBJECT_TYPE_LIBRARY_USER {
			if libraryUserPermission == nil || perm.Permission > *libraryUserPermission {
				value := perm.Permission
				libraryUserPermission = &value
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

	if userDirect != nil {
		return *userDirect, true, nil
	}
	if maxGroupPermission != nil {
		return *maxGroupPermission, true, nil
	}
	if companyPermission != nil {
		return *companyPermission, true, nil
	}

	// 空间级继承：type=4 已配置则完全接管（含"配 0 = 禁止"），不再回退 RAG 空间角色(type=0)。
	spacePermission, hasWikiSpacePermission := r.resolveWikiSpacePermission(spaceID)
	if !hasWikiSpacePermission {
		rolePermission, roleErr := r.resolveSpaceRolePermission(spaceID)
		if roleErr != nil {
			return 0, false, roleErr
		}
		spacePermission = rolePermission
	}
	isAdmin := spacePermission == model.PERMISSION_MANAGE
	isMember := spacePermission >= model.PERMISSION_VIEW_ONLY

	if isAdmin {
		if !hasSpaceAdminRecord {
			// 空间角色继承来的 MANAGE，非页面级设置。
			return spacePermission, false, nil
		}
		return spaceAdminPermission, true, nil
	}
	if isMember {
		if !hasSpaceUserRecord {
			return spacePermission, false, nil
		}
		return spaceUserPermission, true, nil
	}

	if libraryUserPermission != nil {
		return *libraryUserPermission, true, nil
	}

	perm, err := r.fallbackWikiPermission(spaceID, libraryID)
	return perm, false, err
}

// GetUserPermission resolves a single resource permission and uses Redis cache
// when available.
func GetUserPermission(eid int64, resourceType int, resourceID int64, userID int64, ctxs ...context.Context) (int, error) {
	resolver, err := NewPermissionResolver(eid, userID, ctxs...)
	if err != nil {
		return 0, err
	}
	return resolver.GetPermission(resourceType, resourceID)
}

// BatchGetUserPermissions resolves permissions for a batch of resource IDs.
func BatchGetUserPermissions(eid int64, resourceType int, resourceIDs []int64, userID int64, ctxs ...context.Context) (map[int64]int, error) {
	resolver, err := NewPermissionResolver(eid, userID, ctxs...)
	if err != nil {
		return nil, err
	}
	return resolver.BatchGetPermissions(resourceType, resourceIDs)
}

// GetWikiSpaceReadPermission 解析"用户对该 Wiki 空间的读权限"：Wiki 空间权限（resource_type=4）
// 已配置 → 以其为准（配 0 = 禁止）；未配置 → 回退 RAG 空间权限（resource_type=0，含空间创建者）。
// 与 Wiki 页面继承（resolveWikiPagePermissionFromData）同口径，供空间级读门禁使用——否则只配了
// type=4 的空间权限、未配 type=0 的用户会在空间级门禁被 403，type=4 形同虚设。
func GetWikiSpaceReadPermission(eid int64, spaceID int64, userID int64, ctxs ...context.Context) (int, error) {
	if eid <= 0 || spaceID <= 0 || userID <= 0 {
		return model.PERMISSION_NONE, nil
	}
	resolver, err := NewPermissionResolver(eid, userID, ctxs...)
	if err != nil {
		return model.PERMISSION_NONE, err
	}
	if permission, has := resolver.resolveWikiSpacePermission(spaceID); has {
		return permission, nil
	}
	return resolver.resolveSpacePermission(spaceID)
}

// BatchGetWikiSpaceReadPermissions 批量解析"用户对一组 Wiki 空间的读权限"，与
// GetWikiSpaceReadPermission 同口径：type=4 已配置以其为准（未列名/配 0 = 禁止），
// 未配置回退 RAG 空间权限（type=0）。供 /api/permissions/my/batch 的 type=4 分支使用。
func BatchGetWikiSpaceReadPermissions(eid int64, spaceIDs []int64, userID int64, ctxs ...context.Context) (map[int64]int, error) {
	resolver, err := NewPermissionResolver(eid, userID, ctxs...)
	if err != nil {
		return nil, err
	}
	result := make(map[int64]int, len(spaceIDs))
	for _, spaceID := range spaceIDs {
		if spaceID <= 0 {
			result[spaceID] = model.PERMISSION_NONE
			continue
		}
		if permission, has := resolver.resolveWikiSpacePermission(spaceID); has {
			result[spaceID] = permission
			continue
		}
		permission, err := resolver.resolveSpacePermission(spaceID)
		if err != nil {
			return nil, err
		}
		result[spaceID] = permission
	}
	return result, nil
}

// GetUserPermissionWithWikiSnapshot 与 GetUserPermission 同语义，但 WIKI_PAGE 解析注入
// 按库预加载的 Wiki 快照（service 层负责加载，common 避免反向依赖 service）。
// 非 WIKI_PAGE 类型忽略快照参数，行为与 GetUserPermission 一致。
func GetUserPermissionWithWikiSnapshot(eid int64, resourceType int, resourceID int64, userID int64, wikiPages *model.CapabilityWikiPages, wikiPerms *model.CapabilityWikiPerms, ctxs ...context.Context) (int, error) {
	resolver, err := NewPermissionResolver(eid, userID, ctxs...)
	if err != nil {
		return 0, err
	}
	if resourceType == model.RESOURCE_TYPE_WIKI_PAGE {
		resolver.wikiPages = wikiPages
		resolver.wikiPerms = wikiPerms
	}
	return resolver.GetPermission(resourceType, resourceID)
}

// BatchGetUserPermissionsWithWikiSnapshot 与 BatchGetUserPermissions 同语义，WIKI_PAGE
// 批量解析注入 Wiki 快照；跨库/快照未覆盖页面回退 DB 兜底。
func BatchGetUserPermissionsWithWikiSnapshot(eid int64, resourceType int, resourceIDs []int64, userID int64, wikiPages *model.CapabilityWikiPages, wikiPerms *model.CapabilityWikiPerms, ctxs ...context.Context) (map[int64]int, error) {
	resolver, err := NewPermissionResolver(eid, userID, ctxs...)
	if err != nil {
		return nil, err
	}
	if resourceType == model.RESOURCE_TYPE_WIKI_PAGE {
		resolver.wikiPages = wikiPages
		resolver.wikiPerms = wikiPerms
	}
	return resolver.BatchGetPermissions(resourceType, resourceIDs)
}
