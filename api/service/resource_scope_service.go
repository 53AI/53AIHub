package service

import (
	"fmt"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

// ReplaceResourceScopes 替换 resource 的所有 scope（先删后插，要求在事务内调用）
func ReplaceResourceScopes(tx *gorm.DB, resourceID int64, resourceType string, items []model.ResourceScopeItem, eid int64) error {
	if err := tx.Where("resource_id = ? AND resource_type = ?", resourceID, resourceType).Delete(&model.ResourceScope{}).Error; err != nil {
		return err
	}

	if len(items) == 0 {
		return nil
	}

	scopes := make([]model.ResourceScope, 0, len(items))
	for _, item := range items {
		if item.ScopeType == "" {
			continue
		}
		scopes = append(scopes, model.ResourceScope{
			ResourceID:   resourceID,
			ResourceType: resourceType,
			ScopeType:    item.ScopeType,
			TargetID:     item.TargetID,
			Eid:          eid,
		})
	}

	if len(scopes) > 0 {
		if err := tx.Create(&scopes).Error; err != nil {
			return err
		}
	}

	return nil
}

// GetResourceScopes 获取 resource 的所有 scope
func GetResourceScopes(resourceID int64, resourceType string) ([]model.ResourceScope, error) {
	return model.GetResourceScopesByResource(resourceID, resourceType)
}

type ResourceScopeAccessResult struct {
	Accessible   bool
	MatchedScope *model.ResourceScopeItem
}

// CheckResourceScopeAccess 判断用户是否有权限访问 resource
func CheckResourceScopeAccess(userID, eid, resourceID int64, resourceType string) (bool, error) {
	result, err := GetResourceScopeAccess(userID, eid, resourceID, resourceType)
	if err != nil {
		return false, err
	}
	return result.Accessible, nil
}

// GetResourceScopeAccess 判断指定用户是否有权限访问 resource，并返回命中的范围。
func GetResourceScopeAccess(userID, eid, resourceID int64, resourceType string) (*ResourceScopeAccessResult, error) {
	logger.SysDebugf("resource-scopes service check: user_id=%d eid=%d resource_id=%d resource_type=%s", userID, eid, resourceID, resourceType)
	user, userErr := model.GetUserByID(userID)
	if userErr != nil {
		return nil, userErr
	}
	if user.Eid != eid {
		return &ResourceScopeAccessResult{}, nil
	}
	result := &ResourceScopeAccessResult{}
	scopes, err := model.GetResourceScopesByResource(resourceID, resourceType)
	if err != nil {
		logger.SysDebugf("resource-scopes service check db error: user_id=%d eid=%d resource_id=%d resource_type=%s err=%v", userID, eid, resourceID, resourceType, err)
		return nil, err
	}
	logger.SysDebugf("resource-scopes service check scopes count=%d for user_id=%d eid=%d resource_id=%d resource_type=%s", len(scopes), userID, eid, resourceID, resourceType)

	// 兼容旧版 group_id：对于 agent 类型，展开 group_id 关联的用户和部门作为隐式 scope
	if resourceType == model.ResourceTypeAgent {
		agent, err := model.GetAgentByID(eid, resourceID)
		if err == nil && agent.GroupID > 0 {
			userIDs, err := model.GetResourcesByGroupAndType(agent.GroupID, model.ResourceTypeUser)
			if err != nil {
				return nil, err
			}
			for _, uid := range userIDs {
				scopes = append(scopes, model.ResourceScope{ScopeType: model.ScopeTypeUser, TargetID: uid})
			}

			departmentIDs, err := model.GetResourcesByGroupAndType(agent.GroupID, model.ResourceTypeDepartment)
			if err != nil {
				return nil, err
			}
			for _, did := range departmentIDs {
				scopes = append(scopes, model.ResourceScope{ScopeType: model.ScopeTypeDepartment, TargetID: did})
			}
		}
	}

	if len(scopes) == 0 {
		legacyAccessible, legacyConfigured, legacyErr := checkLegacyResourcePermission(userID, resourceID, resourceType)
		if legacyErr != nil {
			return nil, legacyErr
		}
		if legacyConfigured {
			result.Accessible = legacyAccessible
			return result, nil
		}
		// 旧资源没有任何成员范围配置时，兼容历史语义：企业内全员可见。
		result.Accessible, err = checkUserInCompany(userID, eid)
		return result, err
	}

	for _, scope := range scopes {
		accessible, err := checkScopeAccess(userID, eid, scope.ScopeType, scope.TargetID)
		if err != nil {
			logger.SysDebugf("resource-scopes service check scope error: user_id=%d eid=%d scope_type=%s target_id=%d err=%v", userID, eid, scope.ScopeType, scope.TargetID, err)
			return nil, err
		}
		if accessible {
			logger.SysDebugf("resource-scopes service check result=true: user_id=%d eid=%d matched scope_type=%s target_id=%d", userID, eid, scope.ScopeType, scope.TargetID)
			result.Accessible = true
			result.MatchedScope = &model.ResourceScopeItem{ScopeType: scope.ScopeType, TargetID: scope.TargetID}
			return result, nil
		}
	}

	logger.SysDebugf("resource-scopes service check result=false: no matching scope for user_id=%d eid=%d resource_id=%d resource_type=%s", userID, eid, resourceID, resourceType)
	return result, nil
}

func checkLegacyResourcePermission(userID, resourceID int64, resourceType string) (accessible, configured bool, err error) {
	user, err := model.GetUserByID(userID)
	if err != nil {
		return false, false, err
	}
	groupIDs, err := user.GetUserGroupIds()
	if err != nil {
		return false, false, err
	}
	var permissions []model.ResourcePermission
	err = model.DB.Where("resource_id = ? AND resource_type = ?", resourceID, resourceType).Find(&permissions).Error
	if err != nil {
		return false, false, err
	}
	if len(permissions) == 0 {
		return false, false, nil
	}
	groupSet := make(map[int64]struct{}, len(groupIDs))
	for _, groupID := range groupIDs {
		groupSet[groupID] = struct{}{}
	}
	for _, permission := range permissions {
		if permission.Permission == model.PermissionRead {
			if _, ok := groupSet[permission.GroupID]; ok {
				return true, true, nil
			}
		}
	}
	return false, true, nil
}

func checkScopeAccess(userID, eid int64, scopeType string, targetID int64) (bool, error) {
	switch scopeType {
	case model.ScopeTypeCompany:
		return checkUserInCompany(userID, eid)
	case model.ScopeTypeDepartment:
		return checkUserInDepartment(userID, eid, targetID)
	case model.ScopeTypeUser:
		return userID == targetID, nil
	case model.ScopeTypeGroup:
		return checkUserInGroup(userID, eid, targetID)
	default:
		return false, nil
	}
}

func checkUserInCompany(userID, eid int64) (bool, error) {
	var count int64
	err := model.DB.Model(&model.User{}).Where("user_id = ? AND eid = ?", userID, eid).Count(&count).Error
	return count > 0, err
}

func checkUserInDepartment(userID, eid, departmentID int64) (bool, error) {
	var count int64
	err := model.DB.Table("member_department_relations").
		Joins("JOIN member_bindings ON member_bindings.id = member_department_relations.bid").
		Where("member_bindings.eid = ? AND member_bindings.bindvalue = ? AND member_department_relations.did = ?",
			eid, fmt.Sprintf("%d", userID), departmentID).
		Count(&count).Error
	return count > 0, err
}

func checkUserInGroup(userID, eid, groupID int64) (bool, error) {
	user, err := model.GetUserByID(userID)
	if err != nil {
		return false, err
	}
	if user.Eid != eid {
		return false, nil
	}
	groupIDs, err := user.GetUserGroupIds()
	if err != nil {
		return false, err
	}
	for _, userGroupID := range groupIDs {
		if userGroupID == groupID {
			return true, nil
		}
	}
	return false, nil
}
