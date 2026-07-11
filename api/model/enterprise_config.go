package model

import (
	"fmt"
)

type EnterpriseConfig struct {
	ID      int64  `gorm:"primaryKey;autoIncrement" json:"id"`
	EID     int64  `json:"eid" gorm:"column:eid;size:64;uniqueIndex:idx_eid_config"`
	Enabled bool   `json:"enabled" gorm:"not null;default:false"`
	Type    string `json:"type" gorm:"uniqueIndex:idx_eid_config;size:64;not null;default:''"`
	// smtp {\"smtp_host\":\"smtp_host.com\",\"smtp_username\":\"smtp_username@xx.com\",\"smtp_port\":\"465\",\"smtp_password\":\"xxxxxx\",\"smtp_from\":\"smtp_username@xx.com\",\"smtp_is_ssl\":true,\"smtp_to\":\"smtp_to\"}
	// auth_sso {"encrypt_enabled":true,"secret":""}
	Content string `json:"content" gorm:"type:text"`
	BaseModel
}

const (
	EnterpriseConfigTypeSMTP              = "smtp"
	EnterpriseConfigTypeMobile            = "mobile"
	EnterpriseConfigTypeSSO               = "auth_sso"
	EnterpriseConfigTypeVectorReadMode    = "vector_collection_read_mode"
)

var EnterpriseConfigTypes = []string{
	EnterpriseConfigTypeSMTP,
	EnterpriseConfigTypeMobile,
	EnterpriseConfigTypeSSO,
	EnterpriseConfigTypeVectorReadMode,
}

// 根据 type 获取 content 默认值
func GetEnterpriseConfigDefaultContent(configType string) (string, error) {
	switch configType {
	case EnterpriseConfigTypeSMTP:
		return `{"smtp_host":"","smtp_username":"","smtp_port":"","smtp_password":"","smtp_from":"","smtp_is_ssl":true,"smtp_to":""}`, nil
	case EnterpriseConfigTypeMobile:
		return `{}`, nil
	case EnterpriseConfigTypeSSO:
		return `{"encrypt_enabled":true,"secret":""}`, nil
	default:
		return "", fmt.Errorf("config type %s not found", configType)
	}
}
