package model

import (
	"errors"
	"log"
)

type AILink struct {
	ID          int64  `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid         int64  `json:"eid" gorm:"not null;index" example:"1"`
	GroupID     int64  `json:"group_id" gorm:"not null;index" example:"1"`
	Name        string `json:"name" gorm:"not null" example:"ai_link_name"`
	Logo        string `json:"logo" gorm:"not null" example:"logo_url"`
	URL         string `json:"url" gorm:"not null" example:"ai_link_url"`
	Description string `json:"description" gorm:"not null" example:"ai_link_description"`
	Sort        int64  `json:"sort" gorm:"not null; default:0" example:"0"`
	CreatedBy   int64  `json:"created_by" gorm:"not null" example:"1"`
	BaseModel
	// 字符串字段存 共享账号（账号、密码、备注）
	SharedAccount   string  `json:"shared_account" gorm:"not null" example:"[{'account':'admin', 'password':'<PASSWORD>', 'remark':''}]"`
	HasShareAccount bool    `json:"has_share_account" gorm:"-"`
	UserGroupIds    []int64 `json:"user_group_ids" gorm:"-"`
}

func (aiLink *AILink) CheckGroup() error {
	if aiLink.GroupID == 0 {
		return nil
	}
	exist, _ := ExistsGroupByIDAndType(aiLink.Eid, aiLink.GroupID, AI_LINKS_TYPE)
	if !exist {
		return errors.New("group not exist")
	}
	return nil
}

func CreateAILink(aiLink *AILink) error {
	err := aiLink.CheckGroup()
	if err != nil {
		return err
	}
	return DB.Create(aiLink).Error
}

func DeleteAILinkByID(id int64) error {
	return DB.Where("id = ?", id).Delete(&AILink{}).Error
}

func UpdateAILink(aiLink *AILink) error {
	err := aiLink.CheckGroup()
	if err != nil {
		return err
	}
	return DB.Model(aiLink).
		Select("name", "group_id", "logo", "url", "description", "sort", "updated_at", "shared_account").
		Updates(aiLink).Error
}

func GetAILinkByID(id int64) (*AILink, error) {
	var aiLink AILink
	result := DB.Where("id = ?", id).First(&aiLink)
	if result.Error != nil {
		return nil, result.Error
	}
	return &aiLink, nil
}

func (aiLink *AILink) LoadUserGroupIds() error {
	var userGroupIds []int64
	if err := DB.Model(&ResourcePermission{}).
		Where("resource_id = ? AND resource_type = ?", aiLink.ID, ResourceTypeAILink).
		Pluck("group_id", &userGroupIds).Error; err != nil {
		return err
	}
	aiLink.UserGroupIds = userGroupIds
	return nil
}

func GetAILinksByEidAndGroupId(eid int64, groupID int64) ([]AILink, error) {
	var aiLinks []AILink
	if err := DB.Where("eid =? AND group_id =?", eid, groupID).
		Select("ai_links.id, ai_links.eid, ai_links.group_id, ai_links.name, ai_links.logo, ai_links.url, ai_links.description, ai_links.sort, ai_links.created_by, ai_links.created_time, ai_links.updated_time, ai_links.shared_account").
		Order("sort DESC").Find(&aiLinks).Error; err != nil {
		return nil, err
	}
	for i := range aiLinks {
		err := aiLinks[i].LoadUserGroupIds()
		if err != nil {
			aiLinks[i].UserGroupIds = []int64{}
		}
		aiLinks[i].LoadHasSharedAccount()
		aiLinks[i].SharedAccount = ""
	}
	return aiLinks, nil
}

func GetAILinksGroupedBySort(eid int64) ([]AILink, error) {
	type queryResult struct {
		GroupSort int64 `gorm:"column:group_sort"`
		AILink
	}

	var results []queryResult
	err := DB.Table("groups").
		Select("groups.sort AS group_sort, ai_links.id, ai_links.eid, ai_links.group_id, ai_links.name, ai_links.logo, ai_links.url, ai_links.description, ai_links.sort, ai_links.created_by, ai_links.created_time, ai_links.updated_time, ai_links.shared_account").
		Joins("JOIN ai_links ON groups.group_id = ai_links.group_id AND groups.eid = ai_links.eid").
		Where("ai_links.eid = ?", eid).
		Order("group_sort DESC, sort DESC").
		Scan(&results).Error

	if err != nil {
		log.Printf("GetAILinksGroupedBySort failed: %v", err)
		return nil, err
	}

	aiLinks := make([]AILink, 0, len(results))
	for _, r := range results {
		err := r.AILink.LoadUserGroupIds()
		if err != nil {
			r.AILink.UserGroupIds = []int64{}
		}
		r.AILink.LoadHasSharedAccount()
		r.AILink.SharedAccount = ""
		aiLinks = append(aiLinks, r.AILink)
	}
	return aiLinks, nil
}

func GetAILinksByEidAndGroupIdWithKeyword(eid int64, groupID int64, keyword string) ([]AILink, error) {
	var aiLinks []AILink
	if err := DB.Where("eid = ? AND group_id = ? AND name LIKE ?", eid, groupID, "%"+keyword+"%").
		Select("ai_links.id, ai_links.eid, ai_links.group_id, ai_links.name, ai_links.logo, ai_links.url, ai_links.description, ai_links.sort, ai_links.created_by, ai_links.created_time, ai_links.updated_time, ai_links.shared_account").
		Order("sort DESC").Find(&aiLinks).Error; err != nil {
		return nil, err
	}
	for i := range aiLinks {
		err := aiLinks[i].LoadUserGroupIds()
		if err != nil {
			aiLinks[i].UserGroupIds = []int64{}
		}
		aiLinks[i].LoadHasSharedAccount()
		aiLinks[i].SharedAccount = ""
	}
	return aiLinks, nil
}

func GetAILinksGroupedBySortWithKeyword(eid int64, keyword string) ([]AILink, error) {
	type queryResult struct {
		GroupSort int64 `gorm:"column:group_sort"`
		AILink
	}

	var results []queryResult
	err := DB.Table("groups").
		Select("groups.sort AS group_sort, ai_links.id, ai_links.eid, ai_links.group_id, ai_links.name, ai_links.logo, ai_links.url, ai_links.description, ai_links.sort, ai_links.created_by, ai_links.created_time, ai_links.updated_time, ai_links.shared_account").
		Joins("JOIN ai_links ON groups.group_id = ai_links.group_id AND groups.eid = ai_links.eid").
		Where("ai_links.eid = ? AND ai_links.name LIKE ?", eid, "%"+keyword+"%").
		Order("group_sort DESC, sort DESC").
		Scan(&results).Error

	if err != nil {
		log.Printf("GetAILinksGroupedBySortWithKeyword failed: %v", err)
		return nil, err
	}

	aiLinks := make([]AILink, 0, len(results))
	for _, r := range results {
		err := r.AILink.LoadUserGroupIds()
		if err != nil {
			r.AILink.UserGroupIds = []int64{}
		}
		r.AILink.LoadHasSharedAccount()
		r.AILink.SharedAccount = ""
		aiLinks = append(aiLinks, r.AILink)
	}
	return aiLinks, nil
}

func (aiLink *AILink) LoadHasSharedAccount() {
	aiLink.HasShareAccount = aiLink.SharedAccount != ""
}
