package service

import (
	"github.com/53AI/53AIHub/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// UpdateResourcePermissions 更新资源权限的通用方法
// 该方法会先删除指定资源的所有现有权限，然后添加新的权限
func UpdateResourcePermissions(c *gin.Context, tx *gorm.DB, resourceID int64, resourceType string, groupIDs []int64) error {
	// 删除现有权限
	if err := tx.Where("resource_id = ? AND resource_type = ?", resourceID, resourceType).Delete(&model.ResourcePermission{}).Error; err != nil {
		return err
	}

	// 添加新权限
	if len(groupIDs) > 0 {
		// 使用map去重
		groupIDMap := make(map[int64]bool)
		uniqueGroupIDs := make([]int64, 0)

		for _, groupID := range groupIDs {
			if !groupIDMap[groupID] && groupID > 0 {
				groupIDMap[groupID] = true
				uniqueGroupIDs = append(uniqueGroupIDs, groupID)
			}
		}

		for _, groupID := range uniqueGroupIDs {
			permission := model.ResourcePermission{
				GroupID:      groupID,
				ResourceID:   resourceID,
				ResourceType: resourceType,
				Permission:   model.PermissionRead,
			}

			if err := tx.Create(&permission).Error; err != nil {
				return err
			}
		}
	}

	if resourceType == model.ResourceTypePrompt || resourceType == model.ResourceTypeAILink || resourceType == model.ResourceTypeSkillLibrary {
		eid, err := getResourceEnterpriseID(tx, resourceID, resourceType)
		if err != nil {
			return err
		}
		scopes := make([]model.ResourceScopeItem, 0, len(groupIDs))
		for _, groupID := range groupIDs {
			if groupID > 0 {
				scopes = append(scopes, model.ResourceScopeItem{ScopeType: model.ScopeTypeGroup, TargetID: groupID})
			}
		}
		if len(scopes) == 0 {
			scopes = append(scopes, model.ResourceScopeItem{ScopeType: model.ScopeTypeCompany, TargetID: 0})
		}
		if err := ReplaceResourceScopes(tx, resourceID, resourceType, scopes, eid); err != nil {
			return err
		}
	}

	return nil
}

func getResourceEnterpriseID(tx *gorm.DB, resourceID int64, resourceType string) (int64, error) {
	var eid int64
	var err error
	switch resourceType {
	case model.ResourceTypePrompt:
		var resource model.Prompt
		err = tx.Select("eid").Where("prompt_id = ?", resourceID).First(&resource).Error
		eid = resource.Eid
	case model.ResourceTypeAILink:
		var resource model.AILink
		err = tx.Select("eid").Where("id = ?", resourceID).First(&resource).Error
		eid = resource.Eid
	case model.ResourceTypeSkillLibrary:
		var resource model.SkillLibrary
		err = tx.Select("eid").Where("id = ?", resourceID).First(&resource).Error
		eid = resource.Eid
	}
	if err != nil {
		return 0, err
	}
	return eid, nil
}

// UpdateAgentResourcePermissions 更新Agent资源权限的专用方法
// 该方法会先删除指定Agent的所有现有权限，然后根据企业类型过滤后添加新的权限
func UpdateAgentResourcePermissions(c *gin.Context, tx *gorm.DB, agentID int64, subscriptionGroupIds, userGroupIds []int64, enterprise *model.Enterprise) error {
	// 删除现有权限
	if err := tx.Where("resource_id = ? AND resource_type = ?", agentID, model.ResourceTypeAgent).Delete(&model.ResourcePermission{}).Error; err != nil {
		return err
	}

	// 确定分组ID
	var allGroupIds []int64
	groupIDSet := make(map[int64]bool)

	switch enterprise.Type {
	case model.EnterpriseTypeIndustry:
		// 取所有分组ID
		if len(subscriptionGroupIds) > 0 {
			for _, id := range subscriptionGroupIds {
				groupIDSet[id] = true
			}
		}
		if len(userGroupIds) > 0 {
			for _, id := range userGroupIds {
				groupIDSet[id] = true
			}
		}
	case model.EnterpriseTypeIndependent:
		// 只取订阅分组ID
		if len(subscriptionGroupIds) > 0 {
			for _, id := range subscriptionGroupIds {
				groupIDSet[id] = true
			}
		}
	case model.EnterpriseTypeEnterprise:
		// 只取用户分组ID
		if len(userGroupIds) > 0 {
			for _, id := range userGroupIds {
				groupIDSet[id] = true
			}
		}
	}

	// 转换为切片
	allGroupIds = make([]int64, 0, len(groupIDSet))
	for id := range groupIDSet {
		allGroupIds = append(allGroupIds, id)
	}

	// 如果不是行业类型且有分组ID，需要过滤分组
	if enterprise.Type != model.EnterpriseTypeIndustry && len(allGroupIds) > 0 {
		// 获取所有分组
		var groups []model.Group
		if err := tx.Where("group_id IN (?)", allGroupIds).Find(&groups).Error; err != nil {
			return err
		}

		// 过滤分组
		filteredGroupIds := make([]int64, 0, len(groups))
		for _, group := range groups {
			// 根据企业类型过滤
			if (enterprise.Type == model.EnterpriseTypeIndependent && group.GroupType != model.USER_GROUP_TYPE) ||
				(enterprise.Type == model.EnterpriseTypeEnterprise && group.GroupType != model.INTERNAL_USER_GROUP_TYPE) {
				continue
			}
			filteredGroupIds = append(filteredGroupIds, group.GroupId)
		}

		allGroupIds = filteredGroupIds
	}

	// 添加新权限
	if len(allGroupIds) > 0 {
		for _, groupID := range allGroupIds {
			permission := model.ResourcePermission{
				GroupID:      groupID,
				ResourceID:   agentID,
				ResourceType: model.ResourceTypeAgent,
				Permission:   model.PermissionRead,
			}
			if err := tx.Create(&permission).Error; err != nil {
				return err
			}
		}
	}

	return nil
}
