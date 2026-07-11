package model

import (
	"encoding/json"
	"fmt"
	"regexp"

	"gorm.io/gorm"
)

const (
	MaxEnvVarKeyLength   = 100
	MaxEnvVarValueLength = 10000
	MaxEnvVarCount       = 50
)

var envVarKeyRegex = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

// SkillEnvVar 技能环境变量定义
type SkillEnvVar struct {
	Key       string `json:"key"`       // 环境变量名称
	Value     string `json:"value"`     // 环境变量值
	Sensitive bool   `json:"sensitive"` // 是否为敏感信息（敏感信息在日志中脱敏）
}

// SkillEnvVarRecord 技能环境变量记录（数据库表）
type SkillEnvVarRecord struct {
	ID        int64  `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid       int64  `json:"eid" gorm:"not null;uniqueIndex:idx_skill_env_vars_eid_skill_key,priority:1"`
	SkillID   int64  `json:"skill_id" gorm:"not null;uniqueIndex:idx_skill_env_vars_eid_skill_key,priority:2"`
	Key       string `json:"key" gorm:"size:100;not null;uniqueIndex:idx_skill_env_vars_eid_skill_key,priority:3"`
	Value     string `json:"value" gorm:"type:text"`
	Sensitive bool   `json:"sensitive" gorm:"not null;default:false"`
	BaseModel
}

// TableName 指定表名
func (SkillEnvVarRecord) TableName() string {
	return "skill_env_vars"
}

// GetSkillEnvVarsBySkillID 根据技能ID获取环境变量列表
func GetSkillEnvVarsBySkillID(eid, skillID int64) ([]SkillEnvVarRecord, error) {
	var records []SkillEnvVarRecord
	if err := DB.Where("eid = ? AND skill_id = ?", eid, skillID).Order("id ASC").Find(&records).Error; err != nil {
		return nil, err
	}
	return records, nil
}

// GetSkillEnvVarsMapBySkillID 根据技能ID获取环境变量Map
func GetSkillEnvVarsMapBySkillID(eid, skillID int64) (map[string]string, error) {
	records, err := GetSkillEnvVarsBySkillID(eid, skillID)
	if err != nil {
		return nil, err
	}
	result := make(map[string]string)
	for _, record := range records {
		result[record.Key] = record.Value
	}
	return result, nil
}

// CreateSkillEnvVar 创建技能环境变量
func CreateSkillEnvVar(tx *gorm.DB, record *SkillEnvVarRecord) error {
	if tx == nil {
		tx = DB
	}
	return tx.Create(record).Error
}

// UpdateSkillEnvVar 更新技能环境变量
func UpdateSkillEnvVar(tx *gorm.DB, eid, skillID, envVarID int64, updates map[string]interface{}) error {
	if tx == nil {
		tx = DB
	}
	result := tx.Model(&SkillEnvVarRecord{}).
		Where("id = ? AND eid = ? AND skill_id = ?", envVarID, eid, skillID).
		Updates(updates)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

// DeleteSkillEnvVar 删除技能环境变量
func DeleteSkillEnvVar(tx *gorm.DB, eid, skillID, envVarID int64) error {
	if tx == nil {
		tx = DB
	}
	result := tx.Where("id = ? AND eid = ? AND skill_id = ?", envVarID, eid, skillID).Delete(&SkillEnvVarRecord{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

// DeleteSkillEnvVarsBySkillID 删除技能的所有环境变量
func DeleteSkillEnvVarsBySkillID(tx *gorm.DB, eid, skillID int64) error {
	if tx == nil {
		tx = DB
	}
	return tx.Where("eid = ? AND skill_id = ?", eid, skillID).Delete(&SkillEnvVarRecord{}).Error
}

// BatchCreateSkillEnvVars 批量创建技能环境变量
func BatchCreateSkillEnvVars(tx *gorm.DB, records []SkillEnvVarRecord) error {
	if tx == nil {
		tx = DB
	}
	if len(records) == 0 {
		return nil
	}
	return tx.Create(&records).Error
}

// ReplaceSkillEnvVars 替换技能的所有环境变量（先删后建，事务保护）
func ReplaceSkillEnvVars(tx *gorm.DB, eid, skillID int64, envVars []SkillEnvVar) error {
	if tx == nil {
		tx = DB
	}

	return tx.Transaction(func(t *gorm.DB) error {
		// 先删除旧的环境变量
		if err := DeleteSkillEnvVarsBySkillID(t, eid, skillID); err != nil {
			return err
		}

		// 如果没有新的环境变量，直接返回
		if len(envVars) == 0 {
			return nil
		}

		// 创建新的环境变量
		records := make([]SkillEnvVarRecord, 0, len(envVars))
		for _, envVar := range envVars {
			records = append(records, SkillEnvVarRecord{
				Eid:       eid,
				SkillID:   skillID,
				Key:       envVar.Key,
				Value:     envVar.Value,
				Sensitive: envVar.Sensitive,
			})
		}

		return BatchCreateSkillEnvVars(t, records)
	})
}

// SkillEnvVarsToJSON 将环境变量列表转换为JSON字符串（兼容旧接口）
func SkillEnvVarsToJSON(envVars []SkillEnvVar) (string, error) {
	if len(envVars) == 0 {
		return "", nil
	}
	data, err := json.Marshal(envVars)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// JSONToSkillEnvVars 将JSON字符串转换为环境变量列表（兼容旧接口）
func JSONToSkillEnvVars(jsonStr string) ([]SkillEnvVar, error) {
	if jsonStr == "" {
		return nil, nil
	}
	var envVars []SkillEnvVar
	if err := json.Unmarshal([]byte(jsonStr), &envVars); err != nil {
		return nil, err
	}
	return envVars, nil
}

// ValidateEnvVar 校验单个环境变量
func ValidateEnvVar(key, value string) error {
	if key == "" {
		return fmt.Errorf("environment variable key cannot be empty")
	}
	if len(key) > MaxEnvVarKeyLength {
		return fmt.Errorf("environment variable key too long (max %d chars)", MaxEnvVarKeyLength)
	}
	if len(value) > MaxEnvVarValueLength {
		return fmt.Errorf("environment variable value too large (max %d chars)", MaxEnvVarValueLength)
	}
	return nil
}

// ValidateEnvVars 校验环境变量列表
func ValidateEnvVars(envVars []SkillEnvVar) error {
	if len(envVars) > MaxEnvVarCount {
		return fmt.Errorf("environment variable count exceeds limit (max %d)", MaxEnvVarCount)
	}
	seen := make(map[string]bool, len(envVars))
	for _, envVar := range envVars {
		if err := ValidateEnvVar(envVar.Key, envVar.Value); err != nil {
			return err
		}
		if seen[envVar.Key] {
			return fmt.Errorf("duplicate environment variable key: %s", envVar.Key)
		}
		seen[envVar.Key] = true
	}
	return nil
}