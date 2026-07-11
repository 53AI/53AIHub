package model

import (
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// APIKey 外部API密钥模型
type APIKey struct {
	ID          int64      `json:"id" gorm:"primaryKey;autoIncrement"`
	Key         string     `json:"key" gorm:"column:key;size:255;not null"`
	Name        string     `json:"name" gorm:"size:255;not null"`
	Description string     `json:"description" gorm:"type:text"`
	Eid         int64      `json:"eid" gorm:"not null;index"`
	CreatorID   int64      `json:"creator_id" gorm:"not null;index"`
	LibraryID   *int64     `json:"library_id,omitempty" gorm:"index"` // 关联知识库ID，可选
	SpaceID     *int64     `json:"space_id,omitempty" gorm:"index"`   // 关联空间ID，可选
	Status      int        `json:"status" gorm:"not null;default:1"`  // 1=active, 0=disabled
	ExpiresAt   *time.Time `json:"expires_at" gorm:"index"`           // 过期时间，nil表示永不过期

	BaseModel
}

const (
	APIKeyStatusActive   = 1
	APIKeyStatusDisabled = 0
)

const (
	APIKeyPrefix = "km-"
)

// BeforeCreate 创建前钩子
func (ak *APIKey) BeforeCreate(tx *gorm.DB) error {
	// 验证密钥前缀
	if !strings.HasPrefix(ak.Key, APIKeyPrefix) {
		return errors.New("API密钥必须以'km-'开头")
	}

	return nil
}

// Save 创建API密钥
func (ak *APIKey) Save() error {
	if ak.Name == "" {
		return errors.New("API密钥名称不能为空")
	}

	if ak.Key == "" {
		return errors.New("API密钥不能为空")
	}

	// 验证密钥前缀
	if !strings.HasPrefix(ak.Key, APIKeyPrefix) {
		return errors.New("API密钥必须以'km-'开头")
	}

	// 检查密钥是否已存在
	existingKey, err := GetAPIKeyByKey(ak.Key)
	if err == nil && existingKey != nil {
		return errors.New("API密钥已存在")
	}

	result := DB.Create(ak)
	if result.Error != nil {
		return result.Error
	}
	return nil
}

// Update 更新API密钥
func (ak *APIKey) Update() error {
	if ak.Name == "" {
		return errors.New("API密钥名称不能为空")
	}

	result := DB.Model(ak).Updates(ak)
	if result.Error != nil {
		return result.Error
	}
	return nil
}

// GetAPIKeyByID 根据ID获取API密钥
func GetAPIKeyByID(id int64) (*APIKey, error) {
	var apiKey APIKey
	if err := DB.Where("id = ?", id).First(&apiKey).Error; err != nil {
		return nil, err
	}
	return &apiKey, nil
}

// GetAPIKeyByKey 根据密钥获取API密钥
func GetAPIKeyByKey(key string) (*APIKey, error) {
	var apiKey APIKey
	if err := DB.Where(&APIKey{Key: key}).First(&apiKey).Error; err != nil {
		return nil, err
	}
	return &apiKey, nil
}

// GetAPIKeysByEid 获取企业下的所有API密钥
func GetAPIKeysByEid(eid int64) ([]APIKey, error) {
	var apiKeys []APIKey
	if err := DB.Where("eid = ?", eid).Order("created_time desc").Find(&apiKeys).Error; err != nil {
		return nil, err
	}
	return apiKeys, nil
}

// GetAPIKeysByEidAndCreatorID 获取某个用户创建的所有 API 密钥
func GetAPIKeysByEidAndCreatorID(eid int64, creatorID int64) ([]APIKey, error) {
	var apiKeys []APIKey
	if err := DB.Where(map[string]interface{}{"eid": eid, "creator_id": creatorID}).Order("id desc").Find(&apiKeys).Error; err != nil {
		return nil, err
	}
	return apiKeys, nil
}

// GetAPIKeyByIDAndCreatorID 获取指定用户创建的 API 密钥
func GetAPIKeyByIDAndCreatorID(eid int64, creatorID int64, id int64) (*APIKey, error) {
	var apiKey APIKey
	if err := DB.Where(map[string]interface{}{"eid": eid, "creator_id": creatorID, "id": id}).First(&apiKey).Error; err != nil {
		return nil, err
	}
	return &apiKey, nil
}

// GetAPIKeysByEidAndLibraryID 获取企业下指定知识库的所有API密钥
func GetAPIKeysByEidAndLibraryID(eid int64, libraryID int64) ([]APIKey, error) {
	var apiKeys []APIKey
	if err := DB.Where(map[string]interface{}{"eid": eid, "library_id": libraryID}).Order("id desc").Find(&apiKeys).Error; err != nil {
		return nil, err
	}
	return apiKeys, nil
}

// GetAPIKeysByEidWithoutLibrary 获取企业下未关联知识库的API密钥
func GetAPIKeysByEidWithoutLibrary(eid int64) ([]APIKey, error) {
	var apiKeys []APIKey
	if err := DB.Where(map[string]interface{}{"eid": eid}).Where("library_id IS NULL").Order("id desc").Find(&apiKeys).Error; err != nil {
		return nil, err
	}
	return apiKeys, nil
}

// GetAPIKeysByEidAndCreatorIDWithoutLibrary 获取某个用户创建的未关联知识库的API密钥
func GetAPIKeysByEidAndCreatorIDWithoutLibrary(eid int64, creatorID int64) ([]APIKey, error) {
	var apiKeys []APIKey
	if err := DB.Where(map[string]interface{}{"eid": eid, "creator_id": creatorID}).Where("library_id IS NULL").Order("id desc").Find(&apiKeys).Error; err != nil {
		return nil, err
	}
	return apiKeys, nil
}

// GetAPIKeysByEidWithLibrary 获取企业下所有关联知识库的API密钥
func GetAPIKeysByEidWithLibrary(eid int64) ([]APIKey, error) {
	var apiKeys []APIKey
	if err := DB.Where(map[string]interface{}{"eid": eid}).Where("library_id IS NOT NULL").Order("id desc").Find(&apiKeys).Error; err != nil {
		return nil, err
	}
	return apiKeys, nil
}

// GetAPIKeysByEidAndScope 根据知识库范围获取企业下的API密钥。
// libraryID 为空时表示全局密钥。
func GetAPIKeysByEidAndScope(eid int64, libraryID *int64) ([]APIKey, error) {
	if libraryID == nil {
		return GetAPIKeysByEidWithoutLibrary(eid)
	}
	return GetAPIKeysByEidAndLibraryID(eid, *libraryID)
}

// DeleteAPIKey 删除API密钥
func DeleteAPIKey(id int64) error {
	return DB.Where("id = ?", id).Delete(&APIKey{}).Error
}

// DeleteAPIKeyByCreatorID 删除当前用户创建的 API 密钥
func DeleteAPIKeyByCreatorID(eid int64, creatorID int64, id int64) error {
	return DB.Where(map[string]interface{}{"eid": eid, "creator_id": creatorID, "id": id}).Delete(&APIKey{}).Error
}

// ValidateAPIKey 验证API密钥是否有效
func ValidateAPIKey(key string) (*APIKey, error) {
	// 验证密钥前缀
	if !strings.HasPrefix(key, APIKeyPrefix) {
		return nil, errors.New("无效的API密钥格式")
	}

	// 获取API密钥
	apiKey, err := GetAPIKeyByKey(key)
	if err != nil {
		return nil, errors.New("无效的API密钥")
	}

	// 检查状态
	if apiKey.Status != APIKeyStatusActive {
		return nil, errors.New("API密钥已被禁用")
	}

	// 检查过期时间
	if apiKey.ExpiresAt != nil && time.Now().After(*apiKey.ExpiresAt) {
		return nil, errors.New("API密钥已过期")
	}

	return apiKey, nil
}

// GenerateAPIKey 生成新的API密钥
func GenerateAPIKey(eid int64, creatorID int64) string {
	// 生成随机字符串
	uuidStr := uuid.New().String()
	// 移除UUID中的连字符
	keySuffix := strings.ReplaceAll(uuidStr, "-", "")
	// OpenAI风格的密钥长度，确保总长度不超过255字符
	if len(APIKeyPrefix+keySuffix) > 255 {
		keySuffix = keySuffix[:255-len(APIKeyPrefix)]
	}
	return APIKeyPrefix + keySuffix
}

// DisableAPIKey 禁用API密钥
func DisableAPIKey(id int64) error {
	return DB.Model(&APIKey{}).Where("id = ?", id).Update("status", APIKeyStatusDisabled).Error
}

// DisableAPIKeyByCreatorID 禁用当前用户创建的 API 密钥
func DisableAPIKeyByCreatorID(eid int64, creatorID int64, id int64) error {
	return DB.Model(&APIKey{}).Where(map[string]interface{}{"eid": eid, "creator_id": creatorID, "id": id}).Update("status", APIKeyStatusDisabled).Error
}

// EnableAPIKey 启用API密钥
func EnableAPIKey(id int64) error {
	return DB.Model(&APIKey{}).Where("id = ?", id).Update("status", APIKeyStatusActive).Error
}
