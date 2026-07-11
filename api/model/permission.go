package model

// KM 专属权限

import (
	"errors"
	"strings"

	"github.com/53AI/53AIHub/common/logger"
	"gorm.io/gorm"
)

type Permission struct {
	ID           int64 `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid          int64 `json:"eid" gorm:"not null"`
	ResourceType int   `json:"resource_type" gorm:"not null"`
	ResourceID   int64 `json:"resource_id" gorm:"not null"`
	SubjectType  int   `json:"subject_type" gorm:"not null"`
	SubjectID    int64 `json:"subject_id" gorm:"not null"`
	Permission   int   `json:"permission" gorm:"not null"`
	BaseModel
}

// 设置表名
func (Permission) TableName() string {
	return "permissions"
}

// 资源类型常量
const (
	RESOURCE_TYPE_SPACE   = 0 // 空间
	RESOURCE_TYPE_LIBRARY = 1 // 知识库
	RESOURCE_TYPE_FILE    = 2 // 文件/文档
)

// 权限主体类型常量
const (
	SUBJECT_TYPE_USER          = 0 // 用户
	SUBJECT_TYPE_GROUP         = 1 // 分组
	SUBJECT_TYPE_COMPANY_ALL   = 2 // 全公司权限
	SUBJECT_TYPE_SPACE_ADMIN   = 3 // 所属空间管理员
	SUBJECT_TYPE_SPACE_USER    = 4 // 所属空间成员
	SUBJECT_TYPE_LIBRARY_ADMIN = 5 // 所属知识库管理员(这个权限只能是 PERMISSION_MANAGE，这条记录无需添加，只是占位)
	SUBJECT_TYPE_LIBRARY_USER  = 6 // 所属知识库成员｜上级文档成员 （没有这条记录代表是继承知识库权限，有这条记录以这条记录为准）
	SUBJECT_TYPE_SPACE_ACTIVE  = 7 // 全公司空间可见性
)

// 通用权限级别常量
const (
	PERMISSION_NONE           = 0   // 无权限
	PERMISSION_PUBLIC_ONLY    = 1   // 仅公开
	PERMISSION_VIEW_ONLY      = 100 // 仅查看
	PERMISSION_VIEW_EXPORT    = 200 // 可查看/导出
	PERMISSION_EDIT_KNOWLEDGE = 300 // 仅编辑知识
	PERMISSION_EDIT_ALL       = 400 // 可编辑知识/语料
	PERMISSION_MANAGE         = 500 // 可管理
)

// Save 创建权限
func (p *Permission) Save() error {
	if p.Eid == 0 {
		return errors.New("eid is required")
	}

	// 使用数据库唯一约束来避免竞态条件
	// 如果权限已存在，数据库会返回唯一约束错误
	result := DB.Create(p)
	return result.Error
}

// Update 更新权限
func (p *Permission) Update() error {
	result := DB.Model(p).Updates(p)
	return result.Error
}

// Delete 删除权限
func (p *Permission) Delete() error {
	result := DB.Delete(p)
	return result.Error
}

// GetPermission 获取特定权限
func GetPermission(eid int64, resourceType int, resourceID int64, subjectType int, subjectID int64, permissionLevel *int) (*Permission, error) {
	var permission Permission
	query := DB.Where("eid = ? AND resource_type = ? AND resource_id = ? AND subject_type = ? AND subject_id = ?",
		eid, resourceType, resourceID, subjectType, subjectID)

	if permissionLevel != nil {
		query = query.Where("permission = ?", *permissionLevel)
	}

	err := query.First(&permission).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &permission, nil
}

// GetPermissionByID 根据ID获取权限
func GetPermissionByID(id int64) (*Permission, error) {
	var permission Permission
	err := DB.Where("id = ?", id).First(&permission).Error
	if err != nil {
		return nil, err
	}
	return &permission, nil
}

// GetResourcePermissions 获取资源的所有权限
func GetResourcePermissions(eid int64, resourceType int, resourceID int64) ([]Permission, error) {
	var permissions []Permission
	err := DB.Where("eid = ? AND resource_type = ? AND resource_id = ?",
		eid, resourceType, resourceID).Find(&permissions).Error
	return permissions, err
}

func GetResourcesPermissions(eid int64, resourceType int, resourceIDs []int64) ([]Permission, error) {
	var permissions []Permission
	err := DB.Where("eid = ? AND resource_type = ? AND resource_id IN ?",
		eid, resourceType, resourceIDs).Find(&permissions).Error
	return permissions, err
}

// GetSubjectPermissions 获取主体的所有权限
func GetSubjectPermissions(eid int64, subjectType int, subjectID int64) ([]Permission, error) {
	var permissions []Permission
	err := DB.Where("eid = ? AND subject_type = ? AND subject_id = ?",
		eid, subjectType, subjectID).Find(&permissions).Error
	return permissions, err
}

// PermissionData 权限数据结构体
// 用于定义空间、知识库等资源的权限配置
// 支持为用户或分组设置不同级别的权限
type PermissionData struct {
	// 权限主体类型：0-用户，1-分组，2-全公司
	SubjectType int `json:"subject_type" binding:"required" example:"0"`

	// 权限主体ID：用户ID或分组ID
	SubjectID int64 `json:"subject_id" binding:"required" example:"1001"`

	// 权限级别：0-无权限，2-仅查看，6-可管理
	Permission int `json:"permission" binding:"required" example:"2"`
}

// BatchAddPermissions 批量添加权限
func BatchAddPermissions(eid int64, resourceType int, resourceID int64, permissions []*PermissionData) error {
	if len(permissions) == 0 {
		return nil
	}

	// 构建权限对象切片
	permissionObjs := make([]Permission, len(permissions))
	for i, perm := range permissions {
		permissionObjs[i] = Permission{
			Eid:          eid,
			ResourceType: resourceType,
			ResourceID:   resourceID,
			SubjectType:  perm.SubjectType,
			SubjectID:    perm.SubjectID,
			Permission:   perm.Permission,
		}
	}

	// 使用批量插入，每批100条记录
	err := DB.CreateInBatches(permissionObjs, 100).Error
	if err != nil {
		logger.SysErrorf("Failed to batch create permissions: %v", err)
		return err
	}

	return nil
}

// DeleteResourcePermissions 删除资源的所有权限
func DeleteResourcePermissions(eid int64, resourceType int, resourceID int64) error {
	return DB.Where("eid = ? AND resource_type = ? AND resource_id = ?",
		eid, resourceType, resourceID).Delete(&Permission{}).Error
}

// DeletePermissionByID 根据ID删除权限
func DeletePermissionByID(id int64) error {
	return DB.Where("id = ?", id).Delete(&Permission{}).Error
}

// DeletePermissionsBySubject 删除指定主体的所有权限
func DeletePermissionsBySubject(tx *gorm.DB, eid int64, subjectType int, subjectID int64) error {
	return tx.Where("eid = ? AND subject_type = ? AND subject_id = ?", eid, subjectType, subjectID).Delete(&Permission{}).Error
}

// UpdatePermissionByID 根据ID更新权限
func UpdatePermissionByID(id int64, permission int) error {
	return DB.Model(&Permission{}).Where("id = ?", id).Update("permission", permission).Error
}

// GetAllPermissions 获取所有权限
func GetAllPermissions(eid int64) ([]Permission, error) {
	var permissions []Permission
	err := DB.Where("eid = ?", eid).Find(&permissions).Error
	return permissions, err
}

// GetPermissionsByFilter 根据筛选条件获取权限
func GetPermissionsByFilter(eid int64, resourceType *int, resourceID *int64, subjectType *int, subjectID *int64, permissionLevel *int) ([]Permission, error) {
	var permissions []Permission
	query := DB.Debug().Where("eid = ?", eid)

	if resourceType != nil {
		query = query.Where("resource_type = ?", *resourceType)
	}
	if resourceID != nil {
		query = query.Where("resource_id = ?", *resourceID)
	}
	if subjectType != nil {
		query = query.Where("subject_type = ?", *subjectType)
	}
	if subjectID != nil {
		query = query.Where("subject_id = ?", *subjectID)
	}
	if permissionLevel != nil {
		query = query.Where("permission = ?", *permissionLevel)
	}

	err := query.Find(&permissions).Error
	return permissions, err
}

// SubjectIdentifier 主体标识结构体，用于批量查询
// 包含主体类型和主体ID的组合
type SubjectIdentifier struct {
	SubjectType int   `json:"subject_type" binding:"required"`
	SubjectID   int64 `json:"subject_id" binding:"required"`
}

type KMResourcePermission struct {
	ResourceID int64 `json:"resource_id"`
	Permission int   `json:"permission"`
}

// GetResourceIDsBySubjectPermissions 根据主体列表查询有权限的资源ID
// 查询满足以下条件的所有ResourceID：
// 1. eid匹配
// 2. resource_type匹配
// 3. subject_type和subject_id在提供的列表中，或者存在全公司权限（SUBJECT_TYPE_COMPANY_ALL）
// 4. permission >= minPermission
// 返回去重后的ResourceID数组
// 使用场景：批量检查多个用户/分组对某类资源的访问权限
// 示例：
//
//	subjects := []SubjectIdentifier{
//	    {SubjectType: 0, SubjectID: 1001}, // 用户1001
//	    {SubjectType: 1, SubjectID: 2001}, // 分组2001
//	}
//
// resourceIDs, err := GetResourceIDsBySubjectPermissions(1, 1, subjects, 2)
func GetResourceIDsBySubjectPermissions(eid int64, resourceType int, subjects []SubjectIdentifier, minPermission int) ([]int64, []KMResourcePermission, error) {
	var resourceIDs []int64
	var KMResourcePermissions []KMResourcePermission

	// 构建查询条件
	query := DB.Model(&Permission{}).
		Select("DISTINCT resource_id, permission").
		Where("eid = ? AND resource_type = ? AND permission >= ?",
			eid, resourceType, minPermission)

	var orConditions []string
	var values []interface{}

	// 始终包含全公司权限（即使没有显式查询）
	orConditions = append(orConditions, "(subject_type = ? AND subject_id = ?)")
	values = append(values, SUBJECT_TYPE_COMPANY_ALL, int64(0))

	// 添加其他主体条件
	for _, subject := range subjects {
		if subject.SubjectType != SUBJECT_TYPE_COMPANY_ALL || subject.SubjectID != 0 {
			orConditions = append(orConditions, "(subject_type = ? AND subject_id = ?)")
			values = append(values, subject.SubjectType, subject.SubjectID)
		}
	}

	orClause := "(" + strings.Join(orConditions, " OR ") + ")"
	query = query.Where(orClause, values...)

	err := query.Find(&KMResourcePermissions).Error
	if err != nil {
		return nil, nil, err
	}
	for _, perm := range KMResourcePermissions {
		resourceIDs = append(resourceIDs, perm.ResourceID)
	}

	return resourceIDs, KMResourcePermissions, nil
}

// BatchGetResourcePermissions 根据资源ID列表批量获取权限信息
// resourceIDs: 需要查询的资源ID列表
// subjects: 用户相关的所有主体标识（用户ID、分组ID等）
func BatchGetResourcePermissions(eid int64, resourceType int, resourceIDs []int64, subjects []SubjectIdentifier) ([]Permission, error) {
	if len(resourceIDs) == 0 || len(subjects) == 0 {
		return []Permission{}, nil
	}

	var permissions []Permission

	// 构建查询
	query := DB.Where("eid = ? AND resource_type = ? AND resource_id IN ?",
		eid, resourceType, resourceIDs)

	// 主体过滤条件
	var orConditions []string
	var values []interface{}

	// 始终包含全公司权限
	orConditions = append(orConditions, "(subject_type = ? AND subject_id = ?)")
	values = append(values, SUBJECT_TYPE_COMPANY_ALL, int64(0))

	// 添加其他主体条件
	for _, subject := range subjects {
		if subject.SubjectType != SUBJECT_TYPE_COMPANY_ALL || subject.SubjectID != 0 {
			orConditions = append(orConditions, "(subject_type = ? AND subject_id = ?)")
			values = append(values, subject.SubjectType, subject.SubjectID)
		}
	}

	orClause := "(" + strings.Join(orConditions, " OR ") + ")"
	query = query.Where(orClause, values...)

	err := query.Find(&permissions).Error
	return permissions, err
}

// GetResourceIDsBySubjectPermissionsBatch 批量版本，支持大量subject的分批处理
// 当subject数量很大时，分批处理避免SQL语句过长
func GetResourceIDsBySubjectPermissionsBatch(eid int64, resourceType int, subjects []SubjectIdentifier, minPermission int) ([]int64, error) {
	if len(subjects) == 0 {
		return []int64{}, nil
	}

	// 使用map去重
	resourceIDMap := make(map[int64]bool)

	// 分批处理，每批100个subject
	batchSize := 100
	for i := 0; i < len(subjects); i += batchSize {
		end := i + batchSize
		if end > len(subjects) {
			end = len(subjects)
		}

		batch := subjects[i:end]
		var batchResourceIDs []int64

		// 查询当前批次
		query := DB.Model(&Permission{}).
			Select("DISTINCT resource_id").
			Where("eid = ? AND resource_type = ? AND permission >= ?",
				eid, resourceType, minPermission)

		if len(batch) == 1 {
			query = query.Where("subject_type = ? AND subject_id = ?",
				batch[0].SubjectType, batch[0].SubjectID)
		} else {
			var orConditions []string
			var values []interface{}

			for _, subject := range batch {
				orConditions = append(orConditions, "(subject_type = ? AND subject_id = ?)")
				values = append(values, subject.SubjectType, subject.SubjectID)
			}

			orClause := "(" + strings.Join(orConditions, " OR ") + ")"
			query = query.Where(orClause, values...)
		}

		err := query.Find(&batchResourceIDs).Error
		if err != nil {
			return nil, err
		}

		// 合并结果
		for _, id := range batchResourceIDs {
			resourceIDMap[id] = true
		}
	}

	// 转换为数组
	var result []int64
	for id := range resourceIDMap {
		result = append(result, id)
	}

	return result, nil
}

// CheckKMPermission 已废弃，请使用 service.GetUserPermission 作为唯一指定的权限检查入口
