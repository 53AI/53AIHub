package service

import (
	"context"
	"fmt"

	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

// UserGroupService 通用用户级分组服务
type UserGroupService struct {
	eid int64
}

// NewUserGroupService 创建用户级分组服务
func NewUserGroupService(eid int64) *UserGroupService {
	return &UserGroupService{eid: eid}
}

// BatchSubmitItem 批量提交的分组项
type BatchSubmitItem struct {
	GroupID   int64  `json:"group_id"`
	GroupName string `json:"group_name"`
	Sort      int64  `json:"sort"`
}

// List 列出当前用户指定类型的分组
func (s *UserGroupService) List(ctx context.Context, userID int64, groupType int64) ([]model.Group, error) {
	_ = ctx
	var groups []model.Group
	if err := model.DB.Where("eid = ? AND group_type = ? AND created_by = ?", s.eid, groupType, userID).
		Order("sort DESC, group_id ASC").
		Find(&groups).Error; err != nil {
		return nil, fmt.Errorf("查询用户分组列表失败: %w", err)
	}
	return groups, nil
}

// Create 创建用户级分组
func (s *UserGroupService) Create(ctx context.Context, userID int64, groupName string, groupType int64, sort int64) (*model.Group, error) {
	_ = ctx
	group := &model.Group{
		Eid:       s.eid,
		CreatedBy: userID,
		GroupName: groupName,
		GroupType: groupType,
		Sort:      sort,
	}
	if err := model.CreateGroup(group); err != nil {
		return nil, fmt.Errorf("创建用户分组失败: %w", err)
	}
	return group, nil
}

// Rename 重命名用户级分组，校验归属
func (s *UserGroupService) Rename(ctx context.Context, userID int64, groupID int64, newName string) error {
	_ = ctx
	group, err := model.GetGroupByID(groupID)
	if err != nil {
		return fmt.Errorf("分组不存在: %w", err)
	}
	if group.Eid != s.eid || group.CreatedBy != userID {
		return fmt.Errorf("无权操作该分组")
	}
	group.GroupName = newName
	return model.UpdateGroup(group)
}

// Delete 删除用户级分组，先清空关联文件的 group_id，再删分组
func (s *UserGroupService) Delete(ctx context.Context, userID int64, groupID int64) error {
	_ = ctx
	group, err := model.GetGroupByID(groupID)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil
		}
		return fmt.Errorf("分组不存在: %w", err)
	}
	if group.Eid != s.eid || group.CreatedBy != userID {
		return fmt.Errorf("无权操作该分组")
	}

	// 先清空分组内文件的 group_id
	if err := model.DB.Model(&model.File{}).
		Where("group_id = ?", groupID).
		Update("group_id", 0).Error; err != nil {
		return fmt.Errorf("清空分组文件关联失败: %w", err)
	}

	return model.DeleteGroupByID(groupID)
}

// BatchSubmit 批量提交用户级分组：group_id=0 创建，group_id>0 更新，不在列表中的删除
func (s *UserGroupService) BatchSubmit(ctx context.Context, userID int64, groupType int64, items []BatchSubmitItem) error {
	_ = ctx
	// 查询用户当前已有的分组
	var existingGroups []model.Group
	if err := model.DB.Where("eid = ? AND group_type = ? AND created_by = ?", s.eid, groupType, userID).
		Find(&existingGroups).Error; err != nil {
		return fmt.Errorf("查询已有分组失败: %w", err)
	}

	existingGroupIDs := make(map[int64]bool)
	for _, g := range existingGroups {
		existingGroupIDs[g.GroupId] = true
	}

	// 处理传入的分组
	for _, item := range items {
		if item.GroupID == 0 {
			// 创建新分组
			g := &model.Group{
				Eid:       s.eid,
				CreatedBy: userID,
				GroupName: item.GroupName,
				GroupType: groupType,
				Sort:      item.Sort,
			}
			if err := model.CreateGroup(g); err != nil {
				return fmt.Errorf("创建分组失败: %w", err)
			}
		} else {
			// 更新已有分组（校验归属）
			group, err := model.GetGroupByID(item.GroupID)
			if err != nil {
				return fmt.Errorf("分组不存在: %w", err)
			}
			if group.Eid != s.eid || group.CreatedBy != userID {
				return fmt.Errorf("无权操作分组 %d", item.GroupID)
			}
			group.GroupName = item.GroupName
			group.Sort = item.Sort
			if err := model.UpdateGroup(group); err != nil {
				return fmt.Errorf("更新分组失败: %w", err)
			}
			existingGroupIDs[item.GroupID] = false
		}
	}

	// 删除不在列表中的分组
	for groupID, shouldDelete := range existingGroupIDs {
		if shouldDelete {
			// 先清空文件关联
			_ = model.DB.Model(&model.File{}).Where("group_id = ?", groupID).Update("group_id", 0).Error
			if err := model.DeleteGroupByID(groupID); err != nil {
				return fmt.Errorf("删除分组失败: %w", err)
			}
		}
	}

	return nil
}
