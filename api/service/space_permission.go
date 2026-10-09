package service

import (
	"context"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
)

type SpacePermissionService struct {
	Eid int64
}

func NewSpacePermissionService(Eid int64) *SpacePermissionService {
	return &SpacePermissionService{Eid: Eid}
}

// BuildSubjectsForSpace 组装用户在指定空间下的主体集合（包含用户/分组/公司与空间角色）
func BuildSubjectsForSpace(eid int64, userID int64, spaceID int64) ([]model.SubjectIdentifier, error) {
	subjects, err := GetSubjectIdentifierByUser(eid, userID)
	if err != nil {
		return nil, err
	}
	if spaceID > 0 {
		sps := NewSpacePermissionService(eid)
		if isAdmin, e := sps.IsSpaceAdmin(userID, spaceID); e == nil && isAdmin {
			subjects = append(subjects, model.SubjectIdentifier{
				SubjectType: model.SUBJECT_TYPE_SPACE_ADMIN,
				SubjectID:   0,
			})
		} else if e != nil {
			return nil, e
		}
		if isMember, e := sps.IsSpaceMember(userID, spaceID); e == nil && isMember {
			subjects = append(subjects, model.SubjectIdentifier{
				SubjectType: model.SUBJECT_TYPE_SPACE_USER,
				SubjectID:   0,
			})
		} else if e != nil {
			return nil, e
		}
	}
	return subjects, nil
}

// 前台用户视角
func (s *SpacePermissionService) GetUserSpaces(UserId int64, status int, name string, creatorIDs []int64, createdTimeFrom, createdTimeTo, updatedTimeFrom, updatedTimeTo int64, offset int, limit int) (count int64, spaces []model.Space, err error) {
	subjects, err := GetSubjectIdentifierByUser(s.Eid, UserId)
	if err != nil {
		return 0, nil, err
	}
	// 添加可见性
	subjects = append(subjects, model.SubjectIdentifier{
		SubjectType: model.SUBJECT_TYPE_SPACE_ACTIVE,
		SubjectID:   0,
	})

	resourceIDs, _, err := model.GetResourceIDsBySubjectPermissions(
		s.Eid, model.RESOURCE_TYPE_SPACE, subjects,
		model.PERMISSION_PUBLIC_ONLY)

	if err != nil {
		return 0, nil, err
	}

	count, spaces, err = model.GetSpaceListWithIDs(s.Eid, name, status, creatorIDs, createdTimeFrom, createdTimeTo, updatedTimeFrom, updatedTimeTo, resourceIDs, offset, limit)
	if err != nil {
		return 0, nil, err
	}

	for i := range spaces {
		// permissionValue, _ := s.GetUserPermissionForSpace(UserId, spaces[i].ID)
		spaces[i].Permission = 0
		spaces[i].LoadOwnerInfo(s.Eid)
		spaces[i].LoadLibraryCount(s.Eid)
	}

	return count, spaces, nil
}

// 管理员后台视角
func (s *SpacePermissionService) GetAdminSpaces(UserId int64, status int, name string, offset int, limit int) (count int64, spaces []model.Space, err error) {
	count, spaces, err = model.GetSpaceListWithIDs(s.Eid, name, status, nil, 0, 0, 0, 0, nil, offset, limit)
	if err != nil {
		return 0, nil, err
	}
	for i := range spaces {
		// 管理员视角是可管理
		spaces[i].Permission = model.PERMISSION_MANAGE
		spaces[i].LoadOwnerInfo(s.Eid)
		spaces[i].LoadLibraryCount(s.Eid)
	}

	return count, spaces, nil
}

func (s *SpacePermissionService) CheckSpacePermission(UserId int64, SpaceID int64, permissionLevel int) (bool, error) {
	userPermission, err := GetUserPermission(s.Eid, model.RESOURCE_TYPE_SPACE, SpaceID, UserId)
	if err != nil {
		return false, err
	}
	return userPermission >= permissionLevel, nil
}

func (s *SpacePermissionService) hasSpacePermission(userID int64, spaceID int64, minLevel int, strictGreater bool) (bool, error) {
	var count int64

	groupIDs, err := GetUserGroupIDs(userID)
	if err != nil {
		return false, err
	}

	q := model.DB.Model(&model.Permission{}).
		Where("eid = ? AND resource_type = ? AND resource_id = ?", s.Eid, model.RESOURCE_TYPE_SPACE, spaceID)

	if strictGreater {
		q = q.Where("permission > ?", minLevel)
	} else {
		q = q.Where("permission >= ?", minLevel)
	}

	q = q.Where("(subject_type = ? AND subject_id = ?) OR (subject_type = ? AND subject_id = 0)",
		model.SUBJECT_TYPE_USER, userID, model.SUBJECT_TYPE_COMPANY_ALL)

	if len(groupIDs) > 0 {
		q = q.Or("(subject_type = ? AND subject_id IN (?))", model.SUBJECT_TYPE_GROUP, groupIDs)
	}

	if err := q.Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}

// 判断用户是否为指定空间的管理员（基于用户主体直判 ）
func (s *SpacePermissionService) IsSpaceAdmin(userID int64, spaceID int64) (bool, error) {
	return s.hasSpacePermission(userID, spaceID, model.PERMISSION_MANAGE, false)
}

// 判断用户是否为指定空间的成员（有任意非NONE权限）
func (s *SpacePermissionService) IsSpaceMember(userID int64, spaceID int64) (bool, error) {
	return s.hasSpacePermission(userID, spaceID, model.PERMISSION_NONE, true)
}

// 添加空间创建者的权限
func (s *SpacePermissionService) AddSpaceCreatorPermission(spaceID int64, userID int64, permissions []*model.PermissionData) error {
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
	return model.BatchAddPermissions(s.Eid, model.RESOURCE_TYPE_SPACE, spaceID, permissions)
}

// 创建空间时的默认权限设置
func (s *SpacePermissionService) CreateSpaceDefaultPermissions(space *model.Space) error {
	// 如果空间是公开的，添加全公司权限
	if space.Visibility == model.SPACE_VISIBILITY_PUBLIC {
		companyPermission := model.Permission{
			Eid:          space.Eid,
			ResourceType: model.RESOURCE_TYPE_SPACE,
			ResourceID:   space.ID,
			SubjectType:  model.SUBJECT_TYPE_SPACE_ACTIVE,
			SubjectID:    0,
			Permission:   model.PERMISSION_PUBLIC_ONLY,
		}
		return companyPermission.Save()
	}
	return nil
}

// 处理空间可见性变更时的权限更新
func (s *SpacePermissionService) UpdateSpaceVisibilityPermission(space *model.Space, newVisibility int) error {
	publicOnly := model.PERMISSION_PUBLIC_ONLY

	if newVisibility == model.SPACE_VISIBILITY_PUBLIC {
		// visibility = 1 时，确保存在唯一的 PERMISSION_PUBLIC_ONLY 记录
		existingPermission, err := model.GetPermission(
			s.Eid,
			model.RESOURCE_TYPE_SPACE,
			space.ID,
			model.SUBJECT_TYPE_SPACE_ACTIVE,
			0,
			&publicOnly,
		)
		if err != nil {
			return err
		}

		if existingPermission == nil {
			// 不存在则创建新的权限记录
			companyPermission := model.Permission{
				Eid:          space.Eid,
				ResourceType: model.RESOURCE_TYPE_SPACE,
				ResourceID:   space.ID,
				SubjectType:  model.SUBJECT_TYPE_SPACE_ACTIVE,
				SubjectID:    0,
				Permission:   model.PERMISSION_PUBLIC_ONLY,
			}
			if err := companyPermission.Save(); err != nil {
				return err
			}
		}
		// 如果已存在 PERMISSION_PUBLIC_ONLY 记录，无需操作
	} else if newVisibility == model.SPACE_VISIBILITY_PRIVATE {
		// visibility = 0 时，删除 PERMISSION_PUBLIC_ONLY 记录
		permission, err := model.GetPermission(
			s.Eid,
			model.RESOURCE_TYPE_SPACE,
			space.ID,
			model.SUBJECT_TYPE_SPACE_ACTIVE,
			0,
			&publicOnly,
		)
		if err != nil {
			return err
		}
		if permission != nil {
			if err := permission.Delete(); err != nil {
				return err
			}
		}
	}

	// visibility 变化后，空间下的空间、知识库、文件最终权限缓存都需要重新计算。
	if err := invalidateSpacePermissionCacheHierarchy(s.Eid, space.ID); err != nil {
		logger.SysWarnf("【空间】清理可见性级联缓存失败: space_id=%d, err=%v", space.ID, err)
	}

	return nil
}

// 获取团队的管理员权限列表
func (s *SpacePermissionService) GetSpaceAdminPermissions(spaceID int64) ([]model.Permission, error) {
	resourceType := model.RESOURCE_TYPE_SPACE
	permissionLevel := model.PERMISSION_MANAGE

	permissions, err := model.GetPermissionsByFilter(
		s.Eid,
		&resourceType,
		&spaceID,
		nil, // 不限制主体类型，获取所有用户、分组等管理员
		nil, // 不限制主体ID
		&permissionLevel,
	)

	if err != nil {
		return nil, err
	}

	return permissions, nil
}

// 获取团队的成员权限列表（有权限的成员）
func (s *SpacePermissionService) GetSpaceUserPermissions(spaceID int64) ([]model.Permission, error) {
	resourceType := model.RESOURCE_TYPE_SPACE

	permissions, err := model.GetPermissionsByFilter(
		s.Eid,
		&resourceType,
		&spaceID,
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

// UpdateSpacePermissions 更新空间权限（完全重建模式）
// 1. 删除空间的所有权限（除了创建者权限）
// 2. 重建权限体系，包括创建者权限和新提供的权限
// 3. 根据空间可见性设置默认权限
func (s *SpacePermissionService) UpdateSpacePermissions(spaceID int64, userID int64, permissions []*model.PermissionData) error {
	// 1. 删除空间的所有权限记录
	resourceType := model.RESOURCE_TYPE_SPACE

	if err := model.DB.Where("eid = ? AND resource_type = ? AND resource_id = ?",
		s.Eid, model.RESOURCE_TYPE_SPACE, spaceID).Delete(&model.Permission{}).Error; err != nil {
		return err
	}
	// 2. 添加新的权限（不自动添加操作者管理权限）
	if err := model.BatchAddPermissions(s.Eid, resourceType, spaceID, permissions); err != nil {
		logger.SysErrorf("Failed to add permissions for space %d: %v", spaceID, err)
		return err
	}

	// 清除空间、知识库、文件三个层级的最终权限缓存。
	if err := invalidateSpacePermissionCacheHierarchy(s.Eid, spaceID); err != nil {
		logger.SysWarnf("【空间】清理空间权限级联缓存失败: space_id=%d, err=%v", spaceID, err)
	}

	return nil
}

// GetUserSpacePermission 获取用户对特定空间的最大权限值
func (s *SpacePermissionService) GetUserSpacePermission(userID int64, spaceID int64) (int, error) {
	// 构建用户主体
	subjects, err := GetSubjectIdentifierByUser(s.Eid, userID)
	if err != nil {
		return 0, err
	}

	// 获取用户对该空间的所有权限记录
	_, KMResourcePermissions, err := model.GetResourceIDsBySubjectPermissions(
		s.Eid, model.RESOURCE_TYPE_SPACE, subjects,
		model.PERMISSION_PUBLIC_ONLY,
	)
	if err != nil {
		return 0, err
	}

	// 找到该空间的最大权限值
	maxPermission := 0
	for _, perm := range KMResourcePermissions {
		if perm.ResourceID == spaceID && perm.Permission > maxPermission {
			maxPermission = perm.Permission
		}
	}

	return maxPermission, nil
}

func (s *SpacePermissionService) GetUserSpaceRoles(userID int64, spaceID int64) (bool, bool, int) {
	sps := NewSpacePermissionService(s.Eid)
	spacePermission, err := sps.GetUserSpacePermission(userID, spaceID)
	if err != nil {
		spacePermission = 0
	}
	isAdmin := spacePermission == model.PERMISSION_MANAGE
	isMember := spacePermission >= model.PERMISSION_VIEW_ONLY

	return isAdmin, isMember, spacePermission
}

// GetUserPermissionForSpace 获取用户对空间的权限
// Deprecated: 请使用 service.GetUserPermission 或 common.GetUserPermission
func (s *SpacePermissionService) GetUserPermissionForSpace(userID int64, spaceID int64) (int, error) {
	return common.GetUserPermission(s.Eid, model.RESOURCE_TYPE_SPACE, spaceID, userID)
}

// 获取用户对一个资源的权限
// 最终确定版方法
// lazy: variadic-ctx（老调用方多，待同文件迁完收敛为标准签名）
func GetUserPermission(eid int64, resourceType int, resourceID int64, userID int64, ctxs ...context.Context) (int, error) {
	if resourceType == model.RESOURCE_TYPE_WIKI_PAGE {
		return getUserPermissionWikiSnapshot(eid, resourceID, userID, ctxs...)
	}
	return common.GetUserPermission(eid, resourceType, resourceID, userID, ctxs...)
}

// getUserPermissionWikiSnapshot WIKI_PAGE 单页权限走按库快照：先点查页面定位所属库
// （1 次 DB，快照不建 page→library 索引），再加载库快照注入 resolver 解析。
// 页面不存在或快照加载失败时降级到原 DB 路径，语义不缩水。
func getUserPermissionWikiSnapshot(eid int64, pageID int64, userID int64, ctxs ...context.Context) (int, error) {
	ctx := context.Background()
	if len(ctxs) > 0 && ctxs[0] != nil {
		ctx = ctxs[0]
	}
	page, err := model.GetWikiPageByID(eid, pageID)
	if err != nil {
		return common.GetUserPermission(eid, model.RESOURCE_TYPE_WIKI_PAGE, pageID, userID, ctxs...)
	}
	wiki, perms, err := loadCapabilityWiki(ctx, eid, page.LibraryID)
	if err != nil {
		return common.GetUserPermission(eid, model.RESOURCE_TYPE_WIKI_PAGE, pageID, userID, ctxs...)
	}
	return common.GetUserPermissionWithWikiSnapshot(eid, model.RESOURCE_TYPE_WIKI_PAGE, pageID, userID, wiki, perms, ctxs...)
}

// SearchLibrariesByName 根据知识库名搜索企业下有权限的知识库（跨空间）
func (s *SpacePermissionService) SearchLibrariesByName(userID int64, name string, spaceIDs []int64, creatorIDs []int64, createdTimeFrom, createdTimeTo, updatedTimeFrom, updatedTimeTo int64, offset, limit int) ([]model.Library, int64, error) {
	// 1. 获取企业下所有知识库
	var allLibraries []model.Library
	query := model.DB.Where("eid = ? AND library_kind <> ?", s.Eid, model.LIBRARY_KIND_PERSONAL_USER)
	if len(spaceIDs) > 0 {
		query = query.Where("space_id IN ?", spaceIDs)
	}

	if name != "" {
		like := "%" + name + "%"
		query = query.Where("name LIKE ?", like)
	}
	if len(creatorIDs) > 0 {
		query = query.Where("creator_id IN ?", creatorIDs)
	}
	if createdTimeFrom > 0 {
		query = query.Where("created_time >= ?", createdTimeFrom)
	}
	if createdTimeTo > 0 {
		query = query.Where("created_time <= ?", createdTimeTo)
	}
	if updatedTimeFrom > 0 {
		query = query.Where("updated_time >= ?", updatedTimeFrom)
	}
	if updatedTimeTo > 0 {
		query = query.Where("updated_time <= ?", updatedTimeTo)
	}

	var totalCount int64
	if err := query.Model(&model.Library{}).Count(&totalCount).Error; err != nil {
		return nil, 0, err
	}

	if err := query.Order("sort asc, created_time desc").Offset(offset).Limit(limit).Find(&allLibraries).Error; err != nil {
		return nil, 0, err
	}

	// 2. 过滤用户有权限的知识库
	var filteredLibraries []model.Library
	for _, library := range allLibraries {
		// 获取用户对该知识库的权限
		permission, err := GetUserPermission(s.Eid, model.RESOURCE_TYPE_LIBRARY, library.ID, userID)
		if err != nil {
			continue // 跳过权限检查失败的知识库
		}

		// 只有有权限（大于NONE）才加入结果
		if permission > model.PERMISSION_NONE {
			library.Permission = permission // 设置权限信息
			filteredLibraries = append(filteredLibraries, library)
		}
	}

	return filteredLibraries, totalCount, nil
}
