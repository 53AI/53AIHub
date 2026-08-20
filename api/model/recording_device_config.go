package model

import "gorm.io/gorm"

// RecordingDeviceConfig 用户级录音设备配置。
// 同一企业同一用户同一设备类型可配置多条（多 api_key，对应多个远端账号）；
// (eid, user_id, device_type) 为普通索引（非唯一），按 id 精确操作。
// is_active 标记当前激活设备（每用户最多一条 true；首条自动激活，删除激活设备后
// 不自动迁移——由前端决定并调用 SetRecordingDeviceActive 指定新的）。
// device_type 当前支持 "sonicnote"（SonicNote/妙记）、"ticnote"（TicNote）。
type RecordingDeviceConfig struct {
	ID         int64  `json:"id" gorm:"column:id;primaryKey;autoIncrement"`
	Eid        int64  `json:"eid" gorm:"column:eid;not null;index:idx_eid_user_device;index:idx_eid_user_active"`
	UserID     int64  `json:"user_id" gorm:"column:user_id;not null;index:idx_eid_user_device;index:idx_eid_user_active"`
	DeviceType string `json:"device_type" gorm:"column:device_type;size:32;not null;index:idx_eid_user_device"`
	ApiKey     string `json:"api_key,omitempty" gorm:"column:api_key;size:256;not null;default:''"`
	Enabled    bool   `json:"enabled" gorm:"column:enabled;not null;default:false"`
	IsActive   bool   `json:"is_active" gorm:"column:is_active;not null;default:false;index:idx_eid_user_active"`
	BaseModel
}

func (RecordingDeviceConfig) TableName() string { return "recording_device_configs" }

// GetRecordingDeviceConfig 查询用户某设备类型的最新一条配置（多 key 场景兼容旧调用，取 id 最大）。
func GetRecordingDeviceConfig(eid, userID int64, deviceType string) (*RecordingDeviceConfig, error) {
	var cfg RecordingDeviceConfig
	err := DB.Where("eid = ? AND user_id = ? AND device_type = ?", eid, userID, deviceType).
		Order("id DESC").First(&cfg).Error
	if err != nil {
		return nil, err
	}
	return &cfg, nil
}

// GetRecordingDeviceConfigByID 按 id 查询配置（校验属主：eid + user_id）。
func GetRecordingDeviceConfigByID(eid, userID, id int64) (*RecordingDeviceConfig, error) {
	var cfg RecordingDeviceConfig
	err := DB.Where("id = ? AND eid = ? AND user_id = ?", id, eid, userID).First(&cfg).Error
	if err != nil {
		return nil, err
	}
	return &cfg, nil
}

// ListRecordingDeviceConfigs 查询用户全部设备配置（按 id ASC）。
func ListRecordingDeviceConfigs(eid, userID int64) ([]RecordingDeviceConfig, error) {
	var cfgs []RecordingDeviceConfig
	err := DB.Where("eid = ? AND user_id = ?", eid, userID).Order("id ASC").Find(&cfgs).Error
	return cfgs, err
}

// ListEnabledRecordingDeviceConfigs 查询用户某设备类型的全部启用配置（多 key 同步用，按 id ASC）。
func ListEnabledRecordingDeviceConfigs(eid, userID int64, deviceType string) ([]RecordingDeviceConfig, error) {
	var cfgs []RecordingDeviceConfig
	err := DB.Where("eid = ? AND user_id = ? AND device_type = ? AND enabled = ?", eid, userID, deviceType, true).
		Order("id ASC").Find(&cfgs).Error
	return cfgs, err
}

// UpsertRecordingDeviceConfig 幂等保存：同 (eid,user_id,device_type) 存在则更新最新一条（api_key/enabled），否则创建。
// 多 key 场景下旧接口（无 id）只能操作"最新一条"；按 id 的精确更新走 SaveRecordingDeviceConfig。
func UpsertRecordingDeviceConfig(cfg *RecordingDeviceConfig) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		var existing RecordingDeviceConfig
		err := tx.Where("eid = ? AND user_id = ? AND device_type = ?", cfg.Eid, cfg.UserID, cfg.DeviceType).
			Order("id DESC").First(&existing).Error
		if err == nil {
			existing.ApiKey = cfg.ApiKey
			existing.Enabled = cfg.Enabled
			existing.UpdatedTime = cfg.UpdatedTime
			return tx.Save(&existing).Error
		}
		return tx.Create(cfg).Error
	})
}

// GetRecordingDeviceConfigByKey 查询同企业同设备类型同 api_key 的配置（绑定唯一校验用）。
// 返回 nil 表示未被绑定；返回非 nil 时若 UserID 不等于当前用户，则绑定被拒绝。
func GetRecordingDeviceConfigByKey(eid int64, deviceType, apiKey string) (*RecordingDeviceConfig, error) {
	var cfg RecordingDeviceConfig
	err := DB.Where("eid = ? AND device_type = ? AND api_key = ?", eid, deviceType, apiKey).First(&cfg).Error
	if err != nil {
		return nil, err
	}
	return &cfg, nil
}

// SaveRecordingDeviceConfig 按 id 更新设备配置（调用方需先校验属主）。
func SaveRecordingDeviceConfig(cfg *RecordingDeviceConfig) error {
	return DB.Save(cfg).Error
}

// SetRecordingDeviceActive 将指定设备设为当前激活（事务：该用户全部置 false → 目标置 true）。
// 调用方需先校验目标配置属主（GetRecordingDeviceConfigByID）。
func SetRecordingDeviceActive(eid, userID, deviceID int64) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&RecordingDeviceConfig{}).
			Where("eid = ? AND user_id = ?", eid, userID).
			Update("is_active", false).Error; err != nil {
			return err
		}
		return tx.Model(&RecordingDeviceConfig{}).
			Where("id = ? AND eid = ? AND user_id = ?", deviceID, eid, userID).
			Update("is_active", true).Error
	})
}

// DeleteRecordingDeviceConfig 按 id 删除设备配置（调用方需先校验属主）。
func DeleteRecordingDeviceConfig(id int64) error {
	return DB.Delete(&RecordingDeviceConfig{}, id).Error
}
