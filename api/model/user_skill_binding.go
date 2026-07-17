package model

import (
	"errors"
	"time"

	"gorm.io/gorm"
)

const (
	UserSkillBindingStatusEnabled  = "enabled"
	UserSkillBindingStatusDisabled = "disabled"
)

type UserSkillBinding struct {
	ID             int64  `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid            int64  `json:"eid" gorm:"not null;uniqueIndex:uk_user_skill_bindings_eus,priority:1;index:idx_user_skill_bindings_list,priority:1"`
	UserID         int64  `json:"user_id" gorm:"not null;uniqueIndex:uk_user_skill_bindings_eus,priority:2;index:idx_user_skill_bindings_list,priority:2"`
	SkillLibraryID int64  `json:"skill_library_id" gorm:"not null;uniqueIndex:uk_user_skill_bindings_eus,priority:3"`
	Status         string `json:"status" gorm:"size:20;not null;index:idx_user_skill_bindings_list,priority:3"`
	BaseModel
}

type UserSkillBindingWithSkill struct {
	BindingID         int64   `json:"binding_id"`
	Eid               int64   `json:"eid"`
	UserID            int64   `json:"user_id"`
	SkillLibraryID    int64   `json:"skill_library_id"`
	BindingStatus     string  `json:"binding_status"`
	Sort              int64   `json:"sort"`
	SkillName         string  `json:"skill_name"`
	Logo              string  `json:"logo"`
	DisplayName       string  `json:"display_name"`
	Description       string  `json:"description"`
	Version           string  `json:"version"`
	UsageGuide        string  `json:"usage_guide"`
	SourceType        string  `json:"source_type"`
	OriginZipName     string  `json:"origin_zip_name"`
	OriginZipSize     int64   `json:"origin_zip_size"`
	OriginZipSHA256   string  `json:"origin_zip_sha256"`
	PublishStatus     string  `json:"publish_status"`
	AdminStatus       string  `json:"admin_status"`
	RiskLevel         string  `json:"risk_level"`
	ScoreIntegrity    float64 `json:"score_integrity"`
	ScorePracticality float64 `json:"score_practicality"`
	ScoreSafety       float64 `json:"score_safety"`
	ScoreCodeQuality  float64 `json:"score_code_quality"`
	ScoreDocQuality   float64 `json:"score_doc_quality"`
	ScanMessage       string  `json:"scan_message"`
	InstallPath       string  `json:"install_path"`
	CreatedTime       int64   `json:"created_time"`
	UpdatedTime       int64   `json:"updated_time"`
}

type UserSkillBindingInfo struct {
	BindingID int64  `json:"binding_id"`
	Status    string `json:"status"`
}

func AddUserSkillBinding(eid, userID, skillLibraryID int64) error {
	var binding UserSkillBinding
	err := DB.Where("eid = ? AND user_id = ? AND skill_library_id = ?", eid, userID, skillLibraryID).First(&binding).Error
	if err == nil {
		if binding.Status == UserSkillBindingStatusEnabled {
			return nil
		}
		now := time.Now().UTC().UnixMilli()
		return DB.Model(&UserSkillBinding{}).
			Where("id = ?", binding.ID).
			Updates(map[string]interface{}{
				"status":       UserSkillBindingStatusEnabled,
				"updated_time": now,
			}).Error
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}

	binding = UserSkillBinding{
		Eid:            eid,
		UserID:         userID,
		SkillLibraryID: skillLibraryID,
		Status:         UserSkillBindingStatusEnabled,
	}
	return DB.Create(&binding).Error
}

func ListUserSkillBindings(eid, userID int64, offset, limit int) ([]*UserSkillBinding, int64, error) {
	var (
		bindings []*UserSkillBinding
		count    int64
	)

	query := DB.Model(&UserSkillBinding{}).Where("eid = ? AND user_id = ?", eid, userID)
	if err := query.Count(&count).Error; err != nil {
		return nil, 0, err
	}
	if count == 0 {
		return []*UserSkillBinding{}, 0, nil
	}

	query = query.Order("updated_time DESC").Order("id DESC")
	if limit > 0 {
		query = query.Offset(offset).Limit(limit)
	}
	if err := query.Find(&bindings).Error; err != nil {
		return nil, 0, err
	}
	if bindings == nil {
		bindings = []*UserSkillBinding{}
	}
	return bindings, count, nil
}

func UpdateUserSkillBindingStatus(eid, userID, bindingID int64, status string) error {
	now := time.Now().UTC().UnixMilli()
	tx := DB.Model(&UserSkillBinding{}).
		Where("eid = ? AND user_id = ? AND id = ?", eid, userID, bindingID).
		Updates(map[string]interface{}{
			"status":       status,
			"updated_time": now,
		})
	if tx.Error != nil {
		return tx.Error
	}
	if tx.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func DeleteUserSkillBinding(eid, userID, bindingID int64) error {
	tx := DB.Where("eid = ? AND user_id = ? AND id = ?", eid, userID, bindingID).Delete(&UserSkillBinding{})
	if tx.Error != nil {
		return tx.Error
	}
	if tx.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func BatchDisableUserSkillBindingsBySkillLibraryID(tx *gorm.DB, eid, skillLibraryID int64) error {
	if tx == nil {
		tx = DB
	}
	now := time.Now().UTC().UnixMilli()
	return tx.Model(&UserSkillBinding{}).
		Where("eid = ? AND skill_library_id = ? AND status = ?", eid, skillLibraryID, UserSkillBindingStatusEnabled).
		Updates(map[string]interface{}{
			"status":       UserSkillBindingStatusDisabled,
			"updated_time": now,
		}).Error
}

func BatchDeleteUserSkillBindingsBySkillLibraryID(tx *gorm.DB, eid, skillLibraryID int64) error {
	if tx == nil {
		tx = DB
	}
	return tx.Where("eid = ? AND skill_library_id = ?", eid, skillLibraryID).Delete(&UserSkillBinding{}).Error
}

func ListUserSkillBindingsWithSkills(eid, userID int64, offset, limit int) ([]*UserSkillBindingWithSkill, int64, error) {
	var count int64
	countQuery := DB.Model(&UserSkillBinding{}).
		Where("user_skill_bindings.eid = ? AND user_skill_bindings.user_id = ?", eid, userID)
	if err := countQuery.Count(&count).Error; err != nil {
		return nil, 0, err
	}
	if count == 0 {
		return []*UserSkillBindingWithSkill{}, 0, nil
	}

	query := DB.Table("user_skill_bindings").
		Select(`user_skill_bindings.id AS binding_id,
user_skill_bindings.eid,
user_skill_bindings.user_id,
user_skill_bindings.skill_library_id,
user_skill_bindings.status AS binding_status,
skill_libraries.skill_name,
skill_libraries.logo,
skill_libraries.sort,
skill_libraries.display_name,
skill_libraries.description,
skill_libraries.version,
skill_libraries.usage_guide,
skill_libraries.source_type,
skill_libraries.origin_zip_name,
skill_libraries.origin_zip_size,
skill_libraries.origin_zip_sha256,
skill_libraries.publish_status,
skill_libraries.admin_status,
skill_libraries.risk_level,
skill_libraries.score_integrity,
skill_libraries.score_practicality,
skill_libraries.score_safety,
skill_libraries.score_code_quality,
skill_libraries.score_doc_quality,
skill_libraries.scan_message,
skill_libraries.install_path,
user_skill_bindings.created_time,
user_skill_bindings.updated_time`).
		Joins("JOIN skill_libraries ON skill_libraries.id = user_skill_bindings.skill_library_id").
		Where("user_skill_bindings.eid = ? AND user_skill_bindings.user_id = ?", eid, userID).
		Order("user_skill_bindings.id DESC").
		Order("skill_libraries.sort DESC")

	if limit > 0 {
		query = query.Offset(offset).Limit(limit)
	}

	var rows []*UserSkillBindingWithSkill
	if err := query.Find(&rows).Error; err != nil {
		return nil, 0, err
	}
	if rows == nil {
		rows = []*UserSkillBindingWithSkill{}
	}
	return rows, count, nil
}

func ListRunnableSkillInstallPathsForUser(eid, userID int64) ([]string, error) {
	var paths []string
	err := DB.Table("user_skill_bindings").
		Select("skill_libraries.install_path").
		Joins("JOIN skill_libraries ON skill_libraries.id = user_skill_bindings.skill_library_id").
		Where("user_skill_bindings.eid = ? AND user_skill_bindings.user_id = ? AND user_skill_bindings.status = ?",
			eid, userID, UserSkillBindingStatusEnabled).
		Where("skill_libraries.publish_status = ? AND skill_libraries.admin_status = ?",
			SkillPublishStatusPublished, SkillAdminStatusEnabled).
		Where("(skill_libraries.eid = ? OR skill_libraries.eid = ?)", eid, 0).
		Pluck("skill_libraries.install_path", &paths).Error
	if err != nil {
		return nil, err
	}
	if paths == nil {
		paths = []string{}
	}
	return paths, nil
}

func ListUserBoundSkillLibraryIDs(eid, userID int64) ([]int64, error) {
	var ids []int64
	err := DB.Model(&UserSkillBinding{}).
		Where("eid = ? AND user_id = ?", eid, userID).
		Pluck("skill_library_id", &ids).Error
	if err != nil {
		return nil, err
	}
	if ids == nil {
		ids = []int64{}
	}
	return ids, nil
}

func ListUserSkillBindingStatusMap(eid, userID int64, skillLibraryIDs []int64) (map[int64]string, error) {
	result := make(map[int64]string)
	if len(skillLibraryIDs) == 0 {
		return result, nil
	}

	var rows []UserSkillBinding
	err := DB.Where("eid = ? AND user_id = ? AND skill_library_id IN (?)", eid, userID, skillLibraryIDs).
		Find(&rows).Error
	if err != nil {
		return nil, err
	}

	for _, row := range rows {
		result[row.SkillLibraryID] = row.Status
	}
	return result, nil
}

func ListUserSkillBindingInfoMap(eid, userID int64, skillLibraryIDs []int64) (map[int64]UserSkillBindingInfo, error) {
	result := make(map[int64]UserSkillBindingInfo)
	if len(skillLibraryIDs) == 0 {
		return result, nil
	}

	var rows []UserSkillBinding
	err := DB.Select("id, skill_library_id, status").
		Where("eid = ? AND user_id = ? AND skill_library_id IN (?)", eid, userID, skillLibraryIDs).
		Find(&rows).Error
	if err != nil {
		return nil, err
	}

	for _, row := range rows {
		result[row.SkillLibraryID] = UserSkillBindingInfo{
			BindingID: row.ID,
			Status:    row.Status,
		}
	}
	return result, nil
}
