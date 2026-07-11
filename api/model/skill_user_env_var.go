package model

import (
	"gorm.io/gorm"
)

// SkillUserEnvVarRecord 用户级技能环境变量记录
type SkillUserEnvVarRecord struct {
	ID        int64  `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid       int64  `json:"eid" gorm:"not null;uniqueIndex:idx_skill_user_env_vars_eid_user_skill_key,priority:1"`
	UserID    int64  `json:"user_id" gorm:"not null;uniqueIndex:idx_skill_user_env_vars_eid_user_skill_key,priority:2"`
	SkillID   int64  `json:"skill_id" gorm:"not null;uniqueIndex:idx_skill_user_env_vars_eid_user_skill_key,priority:3"`
	Key       string `json:"key" gorm:"size:100;not null;uniqueIndex:idx_skill_user_env_vars_eid_user_skill_key,priority:4"`
	Value     string `json:"value" gorm:"type:text"`
	Sensitive bool   `json:"sensitive" gorm:"not null;default:false"`
	BaseModel
}

// TableName 指定表名
func (SkillUserEnvVarRecord) TableName() string {
	return "skill_user_env_vars"
}

// GetSkillUserEnvVarsBySkillID 根据用户和技能获取环境变量列表
func GetSkillUserEnvVarsBySkillID(eid, userID, skillID int64) ([]SkillUserEnvVarRecord, error) {
	var records []SkillUserEnvVarRecord
	if err := DB.Where("eid = ? AND user_id = ? AND skill_id = ?", eid, userID, skillID).Order("id ASC").Find(&records).Error; err != nil {
		return nil, err
	}
	return records, nil
}

// GetSkillUserEnvVarsMapBySkillID 根据用户和技能获取环境变量Map
func GetSkillUserEnvVarsMapBySkillID(eid, userID, skillID int64) (map[string]string, error) {
	records, err := GetSkillUserEnvVarsBySkillID(eid, userID, skillID)
	if err != nil {
		return nil, err
	}
	result := make(map[string]string, len(records))
	for _, record := range records {
		result[record.Key] = record.Value
	}
	return result, nil
}

// CreateSkillUserEnvVar 创建用户级技能环境变量
func CreateSkillUserEnvVar(tx *gorm.DB, record *SkillUserEnvVarRecord) error {
	if tx == nil {
		tx = DB
	}
	return tx.Create(record).Error
}

// UpdateSkillUserEnvVar 更新用户级技能环境变量
func UpdateSkillUserEnvVar(tx *gorm.DB, eid, userID, skillID, envVarID int64, updates map[string]interface{}) error {
	if tx == nil {
		tx = DB
	}
	result := tx.Model(&SkillUserEnvVarRecord{}).
		Where("id = ? AND eid = ? AND user_id = ? AND skill_id = ?", envVarID, eid, userID, skillID).
		Updates(updates)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

// DeleteSkillUserEnvVar 删除用户级技能环境变量
func DeleteSkillUserEnvVar(tx *gorm.DB, eid, userID, skillID, envVarID int64) error {
	if tx == nil {
		tx = DB
	}
	result := tx.Where("id = ? AND eid = ? AND user_id = ? AND skill_id = ?", envVarID, eid, userID, skillID).Delete(&SkillUserEnvVarRecord{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

// DeleteSkillUserEnvVarsBySkillID 删除某个用户某个技能下的所有环境变量
func DeleteSkillUserEnvVarsBySkillID(tx *gorm.DB, eid, userID, skillID int64) error {
	if tx == nil {
		tx = DB
	}
	return tx.Where("eid = ? AND user_id = ? AND skill_id = ?", eid, userID, skillID).Delete(&SkillUserEnvVarRecord{}).Error
}

// BatchCreateSkillUserEnvVars 批量创建用户级技能环境变量
func BatchCreateSkillUserEnvVars(tx *gorm.DB, records []SkillUserEnvVarRecord) error {
	if tx == nil {
		tx = DB
	}
	if len(records) == 0 {
		return nil
	}
	return tx.Create(&records).Error
}

// ReplaceSkillUserEnvVars 替换某个用户某个技能的所有环境变量（先删后建，事务保护）
func ReplaceSkillUserEnvVars(tx *gorm.DB, eid, userID, skillID int64, envVars []SkillEnvVar) error {
	if tx == nil {
		tx = DB
	}

	return tx.Transaction(func(t *gorm.DB) error {
		if err := DeleteSkillUserEnvVarsBySkillID(t, eid, userID, skillID); err != nil {
			return err
		}
		if len(envVars) == 0 {
			return nil
		}

		records := make([]SkillUserEnvVarRecord, 0, len(envVars))
		for _, envVar := range envVars {
			records = append(records, SkillUserEnvVarRecord{
				Eid:       eid,
				UserID:    userID,
				SkillID:   skillID,
				Key:       envVar.Key,
				Value:     envVar.Value,
				Sensitive: envVar.Sensitive,
			})
		}

		return BatchCreateSkillUserEnvVars(t, records)
	})
}
