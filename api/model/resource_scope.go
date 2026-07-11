package model

import "time"

const (
	ScopeTypeCompany    = "company"
	ScopeTypeDepartment = "department"
	ScopeTypeUser       = "user"
	ScopeTypeGroup      = "group"
)

type ResourceScope struct {
	ID           int64     `json:"id" gorm:"primaryKey;autoIncrement"`
	ResourceID   int64     `json:"resource_id" gorm:"not null;index:idx_rs_resource"`
	ResourceType string    `json:"resource_type" gorm:"not null;index:idx_rs_resource;type:varchar(32)"`
	ScopeType    string    `json:"scope_type" gorm:"not null;type:varchar(16)"`
	TargetID     int64     `json:"target_id" gorm:"not null;default:0"`
	Eid          int64     `json:"eid" gorm:"not null;default:0;index:idx_rs_eid"`
	CreatedAt    time.Time `json:"created_at"`
}

type ResourceScopeItem struct {
	ScopeType string `json:"scope_type"`
	TargetID  int64  `json:"target_id"`
}

func (ResourceScope) TableName() string {
	return "resource_scopes"
}

func GetResourceScopesByResource(resourceID int64, resourceType string) ([]ResourceScope, error) {
	var scopes []ResourceScope
	err := DB.Where("resource_id = ? AND resource_type = ?", resourceID, resourceType).Find(&scopes).Error
	if err != nil {
		return nil, err
	}
	if scopes == nil {
		scopes = []ResourceScope{}
	}
	return scopes, nil
}
