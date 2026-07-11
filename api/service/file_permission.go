package service

import (
	"errors"
	"path"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/helper"
	"github.com/53AI/53AIHub/model"
)

type FilePermissionService struct {
	Eid int64
}

// IsValidPermissionData 基础校验：SubjectType/Permission 范围
func IsValidPermissionData(p *model.PermissionData) bool {
	if p == nil {
		return false
	}
	// 允许的 SubjectType：USER/GROUP/COMPANY_ALL/LIBRARY_USER 等
	switch p.SubjectType {
	case model.SUBJECT_TYPE_USER,
		model.SUBJECT_TYPE_GROUP,
		model.SUBJECT_TYPE_COMPANY_ALL,
		model.SUBJECT_TYPE_LIBRARY_USER:
	default:
		return false
	}
	// 允许的 Permission
	switch p.Permission {
	case model.PERMISSION_NONE,
		model.PERMISSION_VIEW_ONLY,
		model.PERMISSION_EDIT_ALL,
		model.PERMISSION_MANAGE:
	default:
		return false
	}
	return true
}

func NewFilePermissionService(eid int64) *FilePermissionService {
	return &FilePermissionService{Eid: eid}
}

// AddFileCreatorPermission 为文档创建者添加可管理权限（USER:MANAGE）
func (s *FilePermissionService) AddFileCreatorPermission(fileID, userID int64) error {
	// 先删除可能存在的重复项（USER 同一 subject）
	perms, err := model.GetPermissionsByFilter(s.Eid, intPtr(model.RESOURCE_TYPE_FILE), &fileID, intPtr(model.SUBJECT_TYPE_USER), &userID, nil)
	if err != nil {
		return err
	}
	for _, p := range perms {
		_ = DeletePermissionByID(p.ID)
	}

	// 新增一条 MANAGE
	p := &model.Permission{
		Eid:          s.Eid,
		ResourceType: model.RESOURCE_TYPE_FILE,
		ResourceID:   fileID,
		SubjectType:  model.SUBJECT_TYPE_USER,
		SubjectID:    userID,
		Permission:   model.PERMISSION_MANAGE,
	}
	if err := p.Save(); err != nil {
		return err
	}

	invalidatePermissionCacheForFile(s.Eid, fileID)
	return nil
}

// BatchAddPermissionsForFile 对创建文件时附带的 permissions 做最小批量写入
// - 跳过非法项
// - 同主体重复取最大 permission
// - 不删除已有记录（最小改动）
func (s *FilePermissionService) BatchAddPermissionsForFile(fileID int64, permsData []*model.PermissionData) error {
	if len(permsData) == 0 {
		return nil
	}
	// 归并同主体
	type key struct {
		t  int
		id int64
	}
	bucket := map[key]int{}
	for _, d := range permsData {
		if !IsValidPermissionData(d) {
			continue
		}
		k := key{t: d.SubjectType, id: d.SubjectID}
		if cur, ok := bucket[k]; !ok || d.Permission > cur {
			bucket[k] = d.Permission
		}
	}
	// 写入
	for k, perm := range bucket {
		p := &model.Permission{
			Eid:          s.Eid,
			ResourceType: model.RESOURCE_TYPE_FILE,
			ResourceID:   fileID,
			SubjectType:  k.t,
			SubjectID:    k.id,
			Permission:   perm,
		}
		if err := p.Save(); err != nil {
			return err
		}

	}
	invalidatePermissionCacheForFile(s.Eid, fileID)
	return nil
}

func intPtr(v int) *int { return &v }

// CheckParentPermission 检查用户对文件上级目录的管理权限
// 如果上级是根目录，检查知识库管理权限；如果是具体文件夹，检查文件夹管理权限
func (s *FilePermissionService) CheckParentPermission(userID int64, filePath string, libraryID int64) error {
	// 解析父级路径
	parentPath := path.Dir(filePath)
	if parentPath == "." || parentPath == "/" {
		parentPath = "" // 根目录
	}

	if parentPath == "" {
		// 根目录：检查知识库管理权限
		libraryP, err := GetUserPermission(s.Eid, model.RESOURCE_TYPE_LIBRARY, libraryID, userID)
		if err != nil || libraryP < model.PERMISSION_EDIT_KNOWLEDGE {
			return errors.New("没有知识库编辑权限")
		}
	} else {
		// 具体文件夹：检查文件夹存在性和管理权限
		parentFile, err := model.GetFileByPathAndLibrary(s.Eid, libraryID, parentPath)
		if err != nil {
			logger.SysLogf("查询上级文件夹失败: path=%s, libraryID=%d, err=%v", parentPath, libraryID, err)
			return err
		}
		if parentFile == nil {
			logger.SysLogf("上级文件夹不存在: path=%s, libraryID=%d", parentPath, libraryID)
			return errors.New("上级文件夹不存在")
		}

		// 检查文件夹管理权限
		permisson, err := GetUserPermission(s.Eid, model.RESOURCE_TYPE_FILE, parentFile.ID, userID)
		if err != nil || permisson < model.PERMISSION_EDIT_KNOWLEDGE {
			logger.SysLogf("用户没有上级文件夹管理权限: userID=%d, fileID=%d, path=%s", userID, parentFile.ID, parentPath)
			return errors.New("没有上级文件夹管理权限")
		}
	}

	return nil
}

func (s *FilePermissionService) GetUserFilePermission(userID int64, fileID int64) (int, error) {
	// file
	// 查出文件和文件的父ID
	user, err := model.GetUserByID(userID)
	if user == nil || err != nil || user.Eid != s.Eid {
		logger.SysLogf("【知识库】无法加载用户 %d", userID)
		return 0, err
	}

	// 如果用户类型是注册用户，则直接返回无权限
	if user.Type == model.UserTypeRegistered {
		return model.PERMISSION_NONE, nil
	}

	userGroupIDs, _ := user.GetUserGroupIds()

	file, fileList, err := model.GetFileWithParentsByID(s.Eid, fileID)
	if err != nil {
		logger.SysLogf("无法获取文件[%d]的信息, err=%v", fileID, err)
		return 0, err
	}

	fileIDs := []int64{}
	for _, f := range fileList {
		fileIDs = append(fileIDs, f.ID)
	}

	// 第一层:查看文件直接设置的权限
	allFilePermissions, err := model.GetResourcesPermissions(s.Eid, model.RESOURCE_TYPE_FILE, fileIDs)
	if err != nil || len(allFilePermissions) == 0 {
		logger.SysLogf("无法获取文件[%d]的权限信息, 继承知识库权限 err=%v, len=%d", fileID, err, len(allFilePermissions))
		lps := NewLibraryPermissionService(file.Eid)
		return lps.GetUserLibraryPermission(userID, file.LibraryID)
	}

	var bestPermission *int // 最佳权限
	var bestLevel *int      // 最佳权限所在层级，数值越小越近（0=当前文件）
	var bestPriority int    // 权限优先级：用户>组>LIBRARY_USER>公司

	for index, f := range fileList {
		var currentUserPermission *int
		var currentGroupPermission *int
		var currentLibraryUserPermission *int
		var currentCompanyPermission *int

		logger.SysLogf("开始检查第【%d】层文件[%s]的权限", index, f.Path)

		for _, perm := range allFilePermissions {
			if perm.ResourceID != f.ID {
				continue
			}

			// 收集当前层级的各类权限
			if perm.SubjectType == model.SUBJECT_TYPE_USER && perm.SubjectID == userID && currentUserPermission == nil {
				currentUserPermission = &perm.Permission
			} else if len(userGroupIDs) > 0 && perm.SubjectType == model.SUBJECT_TYPE_GROUP &&
				helper.Int64InArray(perm.SubjectID, userGroupIDs) {
				if currentGroupPermission == nil || perm.Permission > *currentGroupPermission {
					currentGroupPermission = &perm.Permission
				}
			} else if perm.SubjectType == model.SUBJECT_TYPE_LIBRARY_USER && currentLibraryUserPermission == nil {
				currentLibraryUserPermission = &perm.Permission
			} else if perm.SubjectType == model.SUBJECT_TYPE_COMPANY_ALL && currentCompanyPermission == nil {
				currentCompanyPermission = &perm.Permission
			}
		}

		// 按优先级检查当前层级的权限，并应用就近原则
		if currentUserPermission != nil {
			if bestPermission == nil || index < *bestLevel || (index == *bestLevel && 1 > bestPriority) {
				bestPermission = currentUserPermission
				bestLevel = &index
				bestPriority = 1
				logger.SysLogf("第%d层找到更优的用户权限 %d", index, *currentUserPermission)
			}
		} else if currentGroupPermission != nil {
			if bestPermission == nil || index < *bestLevel || (index == *bestLevel && 2 > bestPriority) {
				bestPermission = currentGroupPermission
				bestLevel = &index
				bestPriority = 2
				logger.SysLogf("第%d层找到更优的组权限 %d", index, *currentGroupPermission)
			}
		} else if currentLibraryUserPermission != nil {
			if bestPermission == nil || index < *bestLevel || (index == *bestLevel && 3 > bestPriority) {
				bestPermission = currentLibraryUserPermission
				bestLevel = &index
				bestPriority = 3
				logger.SysLogf("第%d层找到更优的LIBRARY_USER权限 %d", index, *currentLibraryUserPermission)
			}
		} else if currentCompanyPermission != nil {
			if bestPermission == nil || index < *bestLevel || (index == *bestLevel && 4 > bestPriority) {
				bestPermission = currentCompanyPermission
				bestLevel = &index
				bestPriority = 4
				logger.SysLogf("第%d层找到更优的公司权限 %d", index, *currentCompanyPermission)
			}
		}
	}

	// 如果找到文件层级的权限，直接返回
	if bestPermission != nil {
		logger.SysLogf("返回最优权限 %d（层级：%d，优先级：%d）", *bestPermission, *bestLevel, bestPriority)
		return *bestPermission, nil
	}

	// 如果没有找到文件层级的权限，使用知识库权限
	lps := NewLibraryPermissionService(file.Eid)
	librayPermission, err := lps.GetUserLibraryPermission(userID, file.LibraryID)
	if err != nil {
		librayPermission = model.PERMISSION_NONE
	}
	if librayPermission <= model.PERMISSION_PUBLIC_ONLY {
		librayPermission = model.PERMISSION_NONE // 仅公开其实只在空间生效，在下层级的这两个对象其实都是无权限
	}

	return librayPermission, nil
}
