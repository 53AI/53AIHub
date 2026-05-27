package service

import (
	"context"
	"errors"
	"math/rand"
	"sync"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/helper"
	"github.com/53AI/53AIHub/model"
)

type LibraryPermissionService struct {
	Eid int64
}

const libraryFileCountCacheTTLSeconds int64 = 300
const libraryFileCountCacheTTLJitterSeconds int64 = 30

var libraryFileCountCacheInitOnce sync.Once

func InitLibraryFileCountCacheInvalidator() {
	libraryFileCountCacheInitOnce.Do(func() {
		model.SetFileCountCacheInvalidator(invalidateLibraryFileCountCache)
	})
}

func invalidateLibraryFileCountCache(eid int64, libraryID int64) {
	if libraryID <= 0 || !common.RedisEnabled {
		return
	}
	cacheKey := common.GetLibraryFileCountCacheKey(eid, libraryID)
	if err := common.RedisDel(cacheKey); err != nil &&
		!errors.Is(err, common.ErrRedisNil) &&
		!errors.Is(err, common.ErrRedisNotEnabled) {
		logger.SysWarnf("【知识库】清理 file_count 缓存失败: eid=%d, library_id=%d, err=%v", eid, libraryID, err)
	}
}

func getLibraryFileCountMapWithCache(eid int64, libraryIDs []int64) (map[int64]int64, error) {
	result := make(map[int64]int64, len(libraryIDs))
	if len(libraryIDs) == 0 {
		return result, nil
	}

	dbQueryIDs := make([]int64, 0, len(libraryIDs))
	validLibraryIDs := make([]int64, 0, len(libraryIDs))
	seenLibraryIDs := make(map[int64]struct{}, len(libraryIDs))
	libraryCacheKeyMap := make(map[int64]string, len(libraryIDs))
	cacheKeys := make([]string, 0, len(libraryIDs))
	for _, libraryID := range libraryIDs {
		if libraryID <= 0 {
			continue
		}
		if _, exists := seenLibraryIDs[libraryID]; exists {
			continue
		}
		seenLibraryIDs[libraryID] = struct{}{}
		validLibraryIDs = append(validLibraryIDs, libraryID)
		cacheKey := common.GetLibraryFileCountCacheKey(eid, libraryID)
		libraryCacheKeyMap[libraryID] = cacheKey
		cacheKeys = append(cacheKeys, cacheKey)
	}
	if len(validLibraryIDs) == 0 {
		return result, nil
	}

	cacheHitCount := 0
	dbFallbackCount := 0

	if !common.RedisEnabled {
		dbQueryIDs = append(dbQueryIDs, validLibraryIDs...)
		dbFallbackCount = len(validLibraryIDs)
	} else {
		cachedMap, cacheErr := common.RedisMGetInt64(cacheKeys)
		if cacheErr != nil && !errors.Is(cacheErr, common.ErrRedisNotEnabled) {
			logger.SysWarnf("【知识库】批量读取 file_count 缓存失败: eid=%d, err=%v", eid, cacheErr)
		}
		for _, libraryID := range validLibraryIDs {
			cacheKey := libraryCacheKeyMap[libraryID]
			if cachedCount, ok := cachedMap[cacheKey]; ok {
				result[libraryID] = cachedCount
				cacheHitCount++
				continue
			}
			dbQueryIDs = append(dbQueryIDs, libraryID)
			dbFallbackCount++
		}
	}

	if len(dbQueryIDs) == 0 {
		logger.Debugf(context.TODO(), "【知识库】file_count缓存命中: eid=%d, libraries=%d, cache_hit=%d, db_fallback=%d, redis_enabled=%v",
			eid, len(validLibraryIDs), cacheHitCount, dbFallbackCount, common.RedisEnabled)
		return result, nil
	}

	dbCountMap, err := model.CountNotDeletedFilesByLibraryIDs(eid, dbQueryIDs)
	if err != nil {
		return nil, err
	}
	cacheSetValues := make(map[string]int64, len(dbQueryIDs))
	for _, libraryID := range dbQueryIDs {
		count := dbCountMap[libraryID]
		result[libraryID] = count

		if common.RedisEnabled {
			cacheSetValues[libraryCacheKeyMap[libraryID]] = count
		}
	}
	if common.RedisEnabled {
		cacheTTL := libraryFileCountCacheTTLSeconds
		if libraryFileCountCacheTTLJitterSeconds > 0 {
			cacheTTL += rand.Int63n(libraryFileCountCacheTTLJitterSeconds + 1)
		}
		if setErr := common.RedisMSetInt64(cacheSetValues, cacheTTL); setErr != nil &&
			!errors.Is(setErr, common.ErrRedisNotEnabled) {
			logger.SysWarnf("【知识库】批量写入 file_count 缓存失败: eid=%d, count=%d, ttl=%d, err=%v", eid, len(cacheSetValues), cacheTTL, setErr)
		}
	}
	logger.Debugf(context.TODO(), "【知识库】file_count缓存统计: eid=%d, libraries=%d, cache_hit=%d, db_fallback=%d, redis_enabled=%v",
		eid, len(validLibraryIDs), cacheHitCount, dbFallbackCount, common.RedisEnabled)
	return result, nil
}

func NewLibraryPermissionService(Eid int64) *LibraryPermissionService {
	return &LibraryPermissionService{Eid: Eid}
}

// 前台用户视角：获取用户可访问的知识库列表（带权限）
// 优化版：使用批量查询减少N+1问题，并利用缓存加速
func (s *LibraryPermissionService) GetUserLibraries(userID int64, name string, status *int, spaceID *int64, offset, limit int, withFileCount bool) (count int64, libraries []model.Library, err error) {
	if spaceID == nil {
		return 0, []model.Library{}, nil
	}

	space, err := model.GetSpaceByID(s.Eid, *spaceID)
	if err != nil || space == nil {
		return 0, []model.Library{}, err
	}

	// 1. 获取基础知识库列表
	count, libraries, err = model.GetLibraryListWithIDs(s.Eid, name, status, spaceID, nil, offset, limit)
	if err != nil {
		return 0, []model.Library{}, err
	}

	if len(libraries) == 0 {
		return count, libraries, nil
	}

	// 2. 批量处理权限和可见性
	libraryIDs := make([]int64, len(libraries))
	for i, lib := range libraries {
		libraryIDs[i] = lib.ID
	}

	// 预加载用户主体信息（一次查询）
	user, err := model.GetUserByID(userID)
	if user == nil || err != nil || user.Eid != s.Eid {
		logger.SysLogf("【知识库】无法加载用户 %d", userID)
		// 降级处理：仅使用userID
	}
	userGroupIDs := []int64{}
	if user != nil {
		userGroupIDs, _ = user.GetUserGroupIds()
	}

	subjects := []model.SubjectIdentifier{
		{SubjectType: model.SUBJECT_TYPE_USER, SubjectID: userID},
	}
	for _, gid := range userGroupIDs {
		subjects = append(subjects, model.SubjectIdentifier{SubjectType: model.SUBJECT_TYPE_GROUP, SubjectID: gid})
	}

	// 批量查询权限记录（一次数据库查询）
	allPermissions, err := model.BatchGetResourcePermissions(s.Eid, model.RESOURCE_TYPE_LIBRARY, libraryIDs, subjects)
	if err != nil {
		// 如果批量查询失败，回退到原来的逐个查询逻辑，或者直接报错
		// 这里选择不中断，但性能会受影响
		logger.SysErrorf("批量获取知识库权限失败: %v", err)
	}

	// 将权限记录按 ResourceID 分组
	permMap := make(map[int64][]model.Permission)
	for _, p := range allPermissions {
		permMap[p.ResourceID] = append(permMap[p.ResourceID], p)
	}

	// 预先查询空间权限（因为很多库可能继承空间权限）
	sps := NewSpacePermissionService(s.Eid)
	spaceAdmin, spaceMember, spacePermVal := sps.GetUserSpaceRoles(userID, *spaceID)

	// 预先查询空间级权限记录（针对该空间下的所有库，可能存在的空间管理员/成员记录）
	// 注意：GetResourcePermissions 返回的是针对特定ResourceID的，这里我们需要知道哪些库有空间级覆盖
	// 简便起见，我们在循环中处理，但利用已经获取的 permMap

	var visibleLibraries []model.Library

	for _, library := range libraries {
		// 计算可见性
		isVisible := false

		// 尝试从缓存读取最终权限（最快路径）
		if common.RedisEnabled {
			cacheKey := common.GetPermissionCacheKey(s.Eid, model.RESOURCE_TYPE_LIBRARY, library.ID, userID)
			if cachedPerm, err := common.RedisGetInt64(cacheKey); err == nil {
				if cachedPerm > model.PERMISSION_NONE {
					isVisible = true
					library.Permission = int(cachedPerm)
					visibleLibraries = append(visibleLibraries, library)
					continue
				} else if space.Visibility != model.SPACE_VISIBILITY_PUBLIC && library.Visibility != model.LIBRARY_VISIBILITY_PUBLIC {
					// 如果缓存显示无权限，且空间/库不是公开的，则判定不可见
					continue
				} else {
					// 虽然缓存显示无权限（PERMISSION_NONE），但如果是公开库，依然可见
					// 这种情况通常 Permission=0，但 visible=true
				}
			}
		}

		// 如果缓存未命中，进行计算
		// 1. 判断可见性
		switch library.Visibility {
		case model.LIBRARY_VISIBILITY_PUBLIC:
			isVisible = true
		case model.LIBRARY_VISIBILITY_INHERIT:
			if space.Visibility == model.SPACE_VISIBILITY_PUBLIC {
				isVisible = true
			}
		}

		// 2. 计算具体权限
		currentPerm := model.PERMISSION_NONE

		libPerms := permMap[library.ID]

		// 计算逻辑复用 GetUserLibraryPermission 的核心逻辑，但使用内存数据
		// A. 直接权限 (User/Group/Company)
		var maxGroupPerm *int
		var companyPerm *int

		hasSpaceAdminRecord := false
		hasSpaceUserRecord := false
		spaceAdminPermOverride := model.PERMISSION_MANAGE
		spaceUserPermOverride := model.PERMISSION_NONE

		for _, p := range libPerms {
			if p.SubjectType == model.SUBJECT_TYPE_USER && p.SubjectID == userID {
				currentPerm = p.Permission
				goto PermFound // 找到用户特定权限，直接跳出
			}
			if p.SubjectType == model.SUBJECT_TYPE_GROUP && helper.Int64InArray(p.SubjectID, userGroupIDs) {
				if maxGroupPerm == nil || p.Permission > *maxGroupPerm {
					v := p.Permission
					maxGroupPerm = &v
				}
			}
			if p.SubjectType == model.SUBJECT_TYPE_COMPANY_ALL {
				v := p.Permission
				companyPerm = &v
			}
			// 收集空间角色覆盖记录
			if p.SubjectType == model.SUBJECT_TYPE_SPACE_ADMIN {
				hasSpaceAdminRecord = true
				spaceAdminPermOverride = p.Permission
			}
			if p.SubjectType == model.SUBJECT_TYPE_SPACE_USER {
				hasSpaceUserRecord = true
				spaceUserPermOverride = p.Permission
			}
		}

		if maxGroupPerm != nil {
			currentPerm = *maxGroupPerm
			goto PermFound
		}
		if companyPerm != nil {
			currentPerm = *companyPerm
			goto PermFound
		}

		// B. 空间角色继承
		if spaceAdmin {
			if !hasSpaceAdminRecord {
				currentPerm = model.PERMISSION_MANAGE // 默认继承管理
			} else {
				currentPerm = spaceAdminPermOverride
			}
			goto PermFound
		}

		if spaceMember {
			if !hasSpaceUserRecord {
				currentPerm = spacePermVal // 继承在空间中的权限
			} else {
				currentPerm = spaceUserPermOverride
			}
			goto PermFound
		}

	PermFound:
		// 如果还没设置可见性（即私有库/空间），则有权限即代表可见
		if !isVisible && currentPerm > model.PERMISSION_NONE {
			isVisible = true
		}

		if isVisible {
			library.Permission = currentPerm
			visibleLibraries = append(visibleLibraries, library)

			// 异步写入缓存
			if common.RedisEnabled {
				go func(eid int64, resType int, resID, uid int64, perm int) {
					cacheKey := common.GetPermissionCacheKey(eid, resType, resID, uid)
					common.RedisSetInt64(cacheKey, int64(perm), 30*60)
				}(s.Eid, model.RESOURCE_TYPE_LIBRARY, library.ID, userID, currentPerm)
			}
		}
	}

	visibleLibraryIDs := make([]int64, 0, len(visibleLibraries))
	for i := range visibleLibraries {
		visibleLibraryIDs = append(visibleLibraryIDs, visibleLibraries[i].ID)
	}
	if !withFileCount {
		return int64(len(visibleLibraries)), visibleLibraries, nil
	}

	fileCountMap, countErr := getLibraryFileCountMapWithCache(s.Eid, visibleLibraryIDs)
	if countErr != nil {
		logger.SysWarnf("【知识库】file_count 统计失败，降级返回0: eid=%d, space_id=%d, library_count=%d, err=%v", s.Eid, *spaceID, len(visibleLibraries), countErr)
		return int64(len(visibleLibraries)), visibleLibraries, nil
	}
	for i := range visibleLibraries {
		visibleLibraries[i].FileCount = fileCountMap[visibleLibraries[i].ID]
	}

	return int64(len(visibleLibraries)), visibleLibraries, nil
}

// GetUserLibraries_Old 保留旧方法以备回滚
func (s *LibraryPermissionService) GetUserLibraries_Old(userID int64, name string, status *int, spaceID *int64, offset, limit int) (count int64, libraries []model.Library, err error) {
	if spaceID == nil {
		return 0, []model.Library{}, nil
	}

	space, err := model.GetSpaceByID(s.Eid, *spaceID)
	if err != nil || space == nil {
		return 0, []model.Library{}, err
	}

	count, libraries, err = model.GetLibraryListWithIDs(s.Eid, name, status, spaceID, nil, offset, limit)
	if err != nil {
		return 0, []model.Library{}, err
	}

	// 根据可见性过滤知识库
	var visibleLibraries []model.Library
	for _, library := range libraries {
		visible, err := IsLibraryVisible(s.Eid, library.ID, userID)
		if err != nil {
			// 出错时跳过该知识库
			continue
		}

		if visible {
			// 获取用户对该知识库的权限
			permission, err := s.GetUserLibraryPermission(userID, library.ID)
			if err == nil {
				library.Permission = permission
			}
			visibleLibraries = append(visibleLibraries, library)
		}
	}

	return int64(len(visibleLibraries)), visibleLibraries, nil
}

// 添加知识库创建者的权限
func (s *LibraryPermissionService) AddLibraryCreatorPermission(libraryID int64, userID int64, permissions []*model.PermissionData) error {
	// 第一步：循环permissions，判断是否有SubjectID为userID的item，有则删除
	for i := 0; i < len(permissions); i++ {
		if permissions[i].SubjectType == model.SUBJECT_TYPE_USER && permissions[i].SubjectID == userID {
			// 从切片中删除这个元素
			permissions = append(permissions[:i], permissions[i+1:]...)
			// 由于删除了元素，索引需要回退
			i--
		}
	}

	// 第二步：添加一个ownerPermission到permissions
	ownerPermission := &model.PermissionData{
		SubjectType: model.SUBJECT_TYPE_USER,
		SubjectID:   userID,
		Permission:  model.PERMISSION_MANAGE,
	}
	permissions = append(permissions, ownerPermission)

	// 第三步：调用BatchAddPermissions添加
	err := model.BatchAddPermissions(s.Eid, model.RESOURCE_TYPE_LIBRARY, libraryID, permissions)

	// 如果添加成功，清除知识库及其下属文件的最终权限缓存
	if err == nil {
		if cacheErr := invalidateLibraryPermissionCacheHierarchy(s.Eid, libraryID); cacheErr != nil {
			logger.SysWarnf("【知识库】清理知识库权限级联缓存失败: library_id=%d, err=%v", libraryID, cacheErr)
		}
	}

	return err
}

// 获取用户对知识库的权限
// 就近原则，先找到什么权限就是什么权限
func (s *LibraryPermissionService) GetUserLibraryPermission(userID int64, libraryID int64) (int, error) {
	user, err := model.GetUserByID(userID)
	if user == nil || err != nil || user.Eid != s.Eid {
		logger.SysLogf("【知识库】无法加载用户 %d", userID)
		return 0, err
	}

	// 如果用户类型是注册用户，则直接返回无权限
	if user.Type == model.UserTypeRegistered {
		return model.PERMISSION_NONE, nil
	}

	// 先加载库，拿到 SpaceID
	library, err := model.GetLibraryByID(s.Eid, libraryID)
	if err != nil || library == nil {
		logger.SysLogf("【知识库】无法加载知识库 %d", libraryID)
		return 0, err
	}
	return s.getUserLibraryPermissionForLoadedLibrary(userID, library, user)
}

func (s *LibraryPermissionService) getUserLibraryPermissionForLoadedLibrary(userID int64, library *model.Library, user *model.User) (int, error) {
	if library == nil {
		return model.PERMISSION_NONE, nil
	}

	if library.IsPersonalLibrary() {
		if library.CreatorID == userID {
			logger.SysLogf("【知识库】用户 %d 是个人知识库 %d 的创建者，直接返回管理权限", userID, library.ID)
			return model.PERMISSION_MANAGE, nil
		}
		logger.SysLogf("【知识库】用户 %d 不是个人知识库 %d 的创建者，无访问权限", userID, library.ID)
		return model.PERMISSION_NONE, nil
	}

	if library.CreatorID == userID {
		logger.SysLogf("【知识库】用户 %d 是知识库 %d 的创建者，直接返回管理权限", userID, library.ID)
		return model.PERMISSION_MANAGE, nil
	}

	userGroupIDs, _ := user.GetUserGroupIds()

	// 步骤1：获取知识库的所有权限记录
	allLibraryPermissions, err := model.GetResourcePermissions(s.Eid, model.RESOURCE_TYPE_LIBRARY, library.ID)
	if err != nil {
		logger.SysLogf("【知识库】无法加载知识库 %d 的权限", library.ID)
		return 0, err
	}

	var maxGroupPermission *int
	var companyPermission *int

	// 判断 allLibraryPermissions 中是否有自己的记录，如果有并且是MANAGE，那么直接返回
	for _, perm := range allLibraryPermissions {
		// 就近原则，人是最近的
		if perm.SubjectType == model.SUBJECT_TYPE_USER && perm.SubjectID == userID {
			logger.SysLogf("【知识库】直接指定用户权限 %d", perm.Permission)
			return perm.Permission, nil
		}
		// 判断分组
		if len(userGroupIDs) > 0 && perm.SubjectType == model.SUBJECT_TYPE_GROUP &&
			helper.Int64InArray(perm.SubjectID, userGroupIDs) {
			if maxGroupPermission == nil || perm.Permission > *maxGroupPermission {
				maxGroupPermission = &perm.Permission
			}
		}
		// 判断全公司
		if perm.SubjectType == model.SUBJECT_TYPE_COMPANY_ALL {
			companyPermission = &perm.Permission
		}
	}

	if maxGroupPermission != nil {
		logger.SysLogf("【知识库】搜到指定分组最大权限 %d", *maxGroupPermission)
		return *maxGroupPermission, nil
	} else if companyPermission != nil {
		logger.SysLogf("【知识库】搜到全公司最大权限 %d", *companyPermission)
		return *companyPermission, nil
	}

	// 步骤2：检查是否存在空间角色权限记录
	hasSpaceAdminRecord := false // fasle 默认继承
	hasSpaceUserRecord := false  // false 默认继承
	spaceAdminPermission := model.PERMISSION_MANAGE
	spaceUserRole := model.PERMISSION_NONE
	for _, perm := range allLibraryPermissions {
		if perm.SubjectType == model.SUBJECT_TYPE_SPACE_ADMIN {
			hasSpaceAdminRecord = true
			spaceAdminPermission = perm.Permission
		}
		if perm.SubjectType == model.SUBJECT_TYPE_SPACE_USER {
			hasSpaceUserRecord = true
			spaceUserRole = perm.Permission
		}
	}

	sps := NewSpacePermissionService(s.Eid)
	isAdmin, isMember, spacePermission := sps.GetUserSpaceRoles(userID, library.SpaceID)

	if isAdmin && !hasSpaceAdminRecord {
		// 空间管理员势必继承空间管理权限也就继承了知识库权限
		logger.SysLogf("空间管理员 %d 继承知识库 %d 的权限 %d", userID, library.ID, model.PERMISSION_MANAGE)
		return spacePermission, nil
	} else if isAdmin && hasSpaceAdminRecord {
		// 空间管理员继承空间管理员权限，无需额外判断
		logger.SysLogf("空间管理员 %d 继承知识库 %d 的权限 %d", userID, library.ID, model.PERMISSION_MANAGE)
		return spaceAdminPermission, nil
	}

	if isMember && !hasSpaceUserRecord {
		// 空间成员继承空间成员权限, 需要查询该成员在空间是什么权限
		logger.SysLogf("空间成员 %d 继承知识库 %d 的权限 %d", userID, library.ID, spaceUserRole)
		// 添加一个虚拟权限用于后续判断最大值
		return spacePermission, nil
	} else if isMember && hasSpaceUserRecord {
		// 空间成员继承空间管理员权限，无需额外判断
		logger.SysLogf("空间成员 %d 继承知识库 %d 的权限 %d", userID, library.ID, spaceAdminPermission)
		return spaceUserRole, nil
	}

	logger.SysLogf("用户没有找到最近的权限 user %d, library %d, permission %d", userID, library.ID, model.PERMISSION_NONE)
	return model.PERMISSION_NONE, nil
}

// 在指定空间内创建知识库的权限判定：>= PERMISSION_EDIT_KNOWLEDGE 即可创建
func (s *LibraryPermissionService) CanCreateLibraryInSpace(userID int64, spaceID int64) (bool, error) {
	// 判断是否具备在该空间的编辑以上权限（团队约定）
	userPermission, err := GetUserPermission(s.Eid, model.RESOURCE_TYPE_SPACE, spaceID, userID)
	if err != nil {
		return false, err
	}
	return userPermission >= model.PERMISSION_EDIT_KNOWLEDGE, nil
}

// 获取团队的管理员权限列表
func (s *LibraryPermissionService) GetLibraryAdminPermissions(libraryID int64) ([]model.Permission, error) {
	resourceType := model.RESOURCE_TYPE_LIBRARY
	permissionLevel := model.PERMISSION_MANAGE

	permissions, err := model.GetPermissionsByFilter(
		s.Eid,
		&resourceType,
		&libraryID,
		nil, // 不限制主体类型，获取所有用户、分组等管理员
		nil, // 不限制主体ID
		&permissionLevel,
	)

	if err != nil {
		return nil, err
	}

	return permissions, nil
}

// GetLibraryUserPermissions 获取团队的成员权限列表（有权限的成员）
func (s *LibraryPermissionService) GetLibraryUserPermissions(libraryID int64) ([]model.Permission, error) {
	resourceType := model.RESOURCE_TYPE_LIBRARY

	permissions, err := model.GetPermissionsByFilter(
		s.Eid,
		&resourceType,
		&libraryID,
		nil, // 不限制主体类型，获取所有用户、分组等成员
		nil, // 不限制主体ID
		nil,
	)

	if err != nil {
		return nil, err
	}
	// PERMISSION_NONE 无权限的记录应该过滤掉，同时过滤掉管理员权限
	filteredPermissions := make([]model.Permission, 0, len(permissions))
	for _, perm := range permissions {
		if perm.Permission != model.PERMISSION_NONE &&
			perm.Permission != model.PERMISSION_MANAGE &&
			perm.Permission != model.PERMISSION_PUBLIC_ONLY {
			filteredPermissions = append(filteredPermissions, perm)
		}
	}

	return filteredPermissions, nil
}
