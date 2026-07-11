package model

import (
	"github.com/53AI/53AIHub/common/logger"
)

type Provider struct {
	ProviderID   int64   `json:"provider_id" gorm:"primaryKey;autoIncrement"`
	Eid          int64   `json:"eid" gorm:"not null;index" example:"1"`
	Name         string  `json:"name" gorm:"size:100;not null;index"`
	ProviderType int64   `json:"provider_type" gorm:"not null;index"`
	Configs      string  `json:"configs" gorm:"type:text;not null"`
	IsAuthorized bool    `json:"is_authorized" gorm:"not null;default:false"`
	AccessToken  string  `json:"access_token" gorm:"type:text"`
	RefreshToken string  `json:"refresh_token" gorm:"type:text"`
	ExpiresIn    int64   `json:"expires_in" gorm:"not null"`
	AuthedTime            int64   `json:"authed_time" gorm:"not null"`
	TokenRefreshFailCount int     `json:"token_refresh_fail_count" gorm:"not null;default:0"`
	BaseURL               *string `json:"base_url" gorm:"size:512;column:base_url;default:''"`
	BaseModel
}

type CozeConfig struct {
	ClientID     string `json:"client_id"`
	ClientSecret string `json:"client_secret"`
}

const (
	ProviderTypeCozeCn     = 1
	ProviderTypeCozeCom    = 2
	ProviderTypeAppBuilder = 3
	ProviderType53AI       = 4
	ProviderTypeCozeStudio = 5
	ProviderTypeTencent    = 6
)

// GetBaseURLByProviderType returns the base URL based on provider type
func (provider *Provider) GetBaseURLByProviderType() string {
	if provider.BaseURL != nil && *provider.BaseURL != "" {
		return *provider.BaseURL
	}

	switch provider.ProviderType {
	case ProviderTypeCozeCn:
		return "https://api.coze.cn"
	case ProviderTypeCozeCom:
		return "https://api.coze.com"
	case ProviderTypeAppBuilder:
		return "https://qianfan.baidubce.com"
	case ProviderType53AI:
		return "https://api.53ai.com"
	case ProviderTypeCozeStudio:
		// coze-studio requires custom base_url, return empty if not set
		return ""
	default:
		return ""
	}
}

func CreateProvider(provider *Provider) error {
	return DB.Create(provider).Error
}

func DeleteProviderByID(id, eid int64) error {
	return DB.Where("provider_id = ? AND eid = ?", id, eid).Delete(&Provider{}).Error
}

func UpdateProvider(provider *Provider) error {
	return DB.Model(provider).
		Updates(map[string]interface{}{
			"name":              provider.Name,
			"provider_type":     provider.ProviderType,
			"configs":           provider.Configs,
			"is_authorized":     provider.IsAuthorized,
			"access_token":      provider.AccessToken,
			"refresh_token":     provider.RefreshToken,
			"expires_in":        provider.ExpiresIn,
			"authed_time":       provider.AuthedTime,
			"base_url":          provider.BaseURL,
		}).Error
}

func GetProviderByID(id, eid int64) (*Provider, error) {
	var provider Provider
	err := DB.Where("provider_id = ? AND eid = ?", id, eid).First(&provider).Error
	return &provider, err
}

func GetProvidersByEidAndProviderType(eid int64, providerType int64) ([]Provider, error) {
	var providers []Provider
	if providerType != 0 {
		err := DB.Where("eid =? AND provider_type =?", eid, providerType).Find(&providers).Error
		return providers, err
	}

	err := DB.Where("eid = ?", eid).Find(&providers).Error
	return providers, err
}

func GetProvidersByEidWithFilters(eid int64, providerType int64, name string) ([]Provider, error) {
	var providers []Provider
	query := DB.Where("eid = ?", eid)

	if providerType != 0 {
		query = query.Where("provider_type = ?", providerType)
	}

	if name != "" {
		query = query.Where("name LIKE ?", "%"+name+"%")
	}

	err := query.Find(&providers).Error
	return providers, err
}

func GetFirstProviderByEidAndProviderType(eid int64, providerType int64) (provider Provider, err error) {
	err = DB.Where("eid =? AND provider_type =?", eid, providerType).First(&provider).Error
	return provider, err
}

func GetProvidersByTypeAndAuthStatus(providerType int64, authStatus bool) ([]Provider, error) {
	var providers []Provider
	err := DB.Where("provider_type = ? and is_authorized = ?", providerType, authStatus).Find(&providers).Error
	return providers, err
}

// GetProviderByEidAndProviderTypeWithOptionalID gets a provider by enterprise ID and provider type
// If providerID is provided (> 0), returns the specific provider
// If providerID is 0, returns the first provider of that type (backward compatibility)
func GetProviderByEidAndProviderTypeWithOptionalID(eid int64, providerType int64, providerID int64) (Provider, error) {
	var provider Provider
	var err error

	if providerID > 0 {
		// Specific provider requested
		err = DB.Where("eid = ? AND provider_type = ? AND provider_id = ?", eid, providerType, providerID).First(&provider).Error
		if err == nil {
			logger.SysLogf("GetProviderByEidAndProviderTypeWithOptionalID: Found specific provider - ID: %d, Name: %s, Type: %d", provider.ProviderID, provider.Name, provider.ProviderType)
		} else {
			logger.SysLogf("GetProviderByEidAndProviderTypeWithOptionalID: Failed to find specific provider - EID: %d, Type: %d, ProviderID: %d, Error: %v", eid, providerType, providerID, err)
		}
	} else {
		// Backward compatibility: get first provider of this type
		err = DB.Where("eid = ? AND provider_type = ?", eid, providerType).First(&provider).Error
		if err == nil {
			logger.SysLogf("GetProviderByEidAndProviderTypeWithOptionalID: Found first provider - ID: %d, Name: %s, Type: %d", provider.ProviderID, provider.Name, provider.ProviderType)
		} else {
			logger.SysLogf("GetProviderByEidAndProviderTypeWithOptionalID: Failed to find first provider - EID: %d, Type: %d, Error: %v", eid, providerType, err)
		}
	}

	return provider, err
}
