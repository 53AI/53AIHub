package model

import (
	"errors"
	"strconv"
	"strings"
)

// Prompt 提示词表
type Prompt struct {
	PromptID     int64        `json:"prompt_id" gorm:"primaryKey;autoIncrement;comment:自增id"`
	Name         string       `json:"name" gorm:"size:255;not null;default:'';comment:名称"`
	Logo         string       `json:"logo" gorm:"size:500;default:'';comment:图标URL"`
	Content      string       `json:"content" gorm:"size:5000;not null;default:'';comment:技能提示语"`
	Description  string       `json:"description" gorm:"type:text;comment:描述"`
	Type         int          `json:"type" gorm:"not null;default:1;comment:类型。1个人；2系统"`
	Status       int          `json:"status" gorm:"not null;default:1;comment:状态。；0未启用；1正常；2删除"`
	UserID       int64        `json:"user_id" gorm:"not null;default:0;comment:creator user id"`
	Eid          int64        `json:"eid" gorm:"not null;default:0;comment:团队id"`
	Views        int64        `json:"views" gorm:"not null;default:0;comment:查看次数"`
	Likes        int64        `json:"likes" gorm:"not null;default:0;comment:点赞次数"`
	Sort         int          `json:"sort" gorm:"not null;default:0;comment:排序"`
	CustomConfig string       `json:"custom_config" gorm:"not null;type:text"`
	AILinks      string       `json:"ai_links" gorm:"type:text;comment:关联的AI链接"`
	AILinksData  []AILinkInfo `gorm:"-" json:"ai_links_data"`
	GroupIDs     []int64      `json:"group_ids" gorm:"-"`
	IsLiked      bool         `json:"is_liked" gorm:"-"`
	BaseModel
}

const (
	PromptTypeSystem   = 1
	PromptTypePersonal = 2

	PromptStatusDisable = 0
	PromptStatusNormal  = 1
	PromptStatusDelete  = 2
)

// TableName 设置表名
func (Prompt) TableName() string {
	return "prompts"
}

// Create 创建提示词记录
func (p *Prompt) Create() error {
	if p.Name == "" {
		return errors.New("name is empty")
	}
	if p.Content == "" {
		return errors.New("content is empty")
	}

	if p.Description == "" {
		return errors.New("description is empty")
	}

	result := DB.Create(p)
	if result.Error != nil {
		return result.Error
	}

	return nil
}

// Update 更新提示词信息
func (p *Prompt) Update() error {
	updateData := map[string]interface{}{
		"name":          p.Name,
		"content":       p.Content,
		"description":   p.Description,
		"status":        p.Status,
		"views":         p.Views,
		"likes":         p.Likes,
		"sort":          p.Sort,
		"custom_config": p.CustomConfig,
	}
	return DB.Model(p).Updates(updateData).Error
}

// Delete 删除提示词记录（软删除，将状态设为2）
func (p *Prompt) Delete() error {
	p.Status = 2

	return DB.Model(p).Updates(map[string]interface{}{
		"status": p.Status,
	}).Error
}

// HardDelete 硬删除提示词记录
func (p *Prompt) HardDelete() error {
	err := DB.Delete(p).Error
	return err
}

// GetPromptByID 根据ID获取提示词信息
func GetPromptByID(promptID int) (*Prompt, error) {
	var prompt Prompt
	statusArray := []int{PromptStatusNormal, PromptStatusDisable}
	err := DB.Where("prompt_id = ? AND status in (?)", promptID, statusArray).First(&prompt).Error
	if err != nil {
		return nil, err
	}
	return &prompt, nil
}

// GetPromptsByEid 根据团队ID获取提示词列表
func GetPromptsByEid(eid int) ([]*Prompt, error) {
	var prompts []*Prompt
	statusArray := []int{PromptStatusNormal, PromptStatusDisable}
	err := DB.Where("eid = ? AND status in (?)", eid, statusArray).Find(&prompts).Error
	if err != nil {
		return nil, err
	}
	return prompts, nil
}

func GetPromptList(eid int64, keyword string, groupIDStr string, status, offset int, limit int) (int64, []*Prompt, error) {
	statusArray := []int{PromptStatusNormal, PromptStatusDisable}
	if status != -1 {
		statusArray = []int{status}
	}
	db := DB.Model(&Prompt{}).Where("status in (?) AND eid = ?", statusArray, eid)

	if keyword != "" {
		db = db.Where("name LIKE ?", "%"+keyword+"%")
	}

	if groupIDStr != "" {
		// 解析多个分组ID
		groupIDStrings := strings.Split(groupIDStr, ",")
		groupIDs := make([]int64, 0, len(groupIDStrings))

		for _, idStr := range groupIDStrings {
			idStr = strings.TrimSpace(idStr)
			if idStr == "" {
				continue
			}

			id, err := strconv.ParseInt(idStr, 10, 64)
			if err != nil {
				continue // 忽略无效的ID
			}

			if id > 0 {
				groupIDs = append(groupIDs, id)
			}
		}

		if len(groupIDs) > 0 {
			// 通过 ResourcePermission 表关联查询
			db = db.Joins("JOIN resource_permissions ON prompts.prompt_id = resource_permissions.resource_id").
				Where("resource_permissions.group_id IN (?) AND resource_permissions.resource_type = ?", groupIDs, ResourceTypePrompt).
				Group("prompts.prompt_id") // 确保结果不重复
		}
	}

	var count int64
	db.Count(&count)

	var prompts []*Prompt
	db = db.Order("sort DESC, prompt_id DESC")

	err := db.Offset(offset).Limit(limit).Find(&prompts).Error

	return count, prompts, err
}

// IncrementViews 增加查看次数
func (p *Prompt) IncrementViews() error {
	p.Views++

	return DB.Model(p).Updates(map[string]interface{}{
		"views": p.Views,
	}).Error
}

// UpdateSort 更新排序
func (p *Prompt) UpdateSort(sort int) error {
	p.Sort = sort

	return DB.Model(p).Updates(map[string]interface{}{
		"sort": p.Sort,
	}).Error
}

// UpdateCustomConfig 更新自定义配置
func (p *Prompt) UpdateCustomConfig(config string) error {
	p.CustomConfig = config

	return DB.Model(p).Updates(map[string]interface{}{
		"custom_config": p.CustomConfig,
	}).Error
}

func (p *Prompt) LoadPromptGroups() error {
	// 获取提示词关联的所有分组ID
	var groupIDs []int64
	err := DB.Model(&ResourcePermission{}).
		Where("resource_id = ? AND resource_type = ?", p.PromptID, ResourceTypePrompt).
		Pluck("group_id", &groupIDs).Error
	if err != nil {
		return err
	}

	// 将分组ID添加到提示词对象中
	p.GroupIDs = groupIDs
	return nil
}

func (p *Prompt) LoadIsLiked(UserId int64) error {
	like, err := GetLikeByUserObject(UserId, ResourceTypePrompt, p.PromptID)
	if err != nil {
		p.IsLiked = false
		return nil
	}
	p.IsLiked = like != nil && like.Status == LikeStatusActive
	return nil
}
