package service

import (
	"errors"
	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"path"
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

// GetUserFilePermission 获取用户对文件的权限
// Deprecated: 请使用 service.GetUserPermission 或 common.GetUserPermission
func (s *FilePermissionService) GetUserFilePermission(userID int64, fileID int64) (int, error) {
	return common.GetUserPermission(s.Eid, model.RESOURCE_TYPE_FILE, fileID, userID)
}
