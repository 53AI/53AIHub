package model

import (
	"errors"

	"gorm.io/gorm"
)

const (
	SkillSourceTypeZip      = "zip"
	SkillSourceTypeGithub   = "github"
	SkillSourceTypePlatform = "platform"
)

const (
	SkillPublishStatusDraft     = "draft"
	SkillPublishStatusPublished = "published"
	SkillPublishStatusRejected  = "rejected"
)

const (
	SkillAdminStatusEnabled  = "enabled"
	SkillAdminStatusDisabled = "disabled"
)

const (
	SkillRiskLevelLow    = "low"
	SkillRiskLevelMedium = "medium"
	SkillRiskLevelHigh   = "high"
)

type SkillLibrary struct {
	ID                int64   `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid               int64   `json:"eid" gorm:"not null;index:idx_skill_libraries_query,priority:1;uniqueIndex:uk_skill_libraries_eid_name,priority:1"`
	SourceType        string  `json:"source_type" gorm:"size:20;not null"`
	SourceRef         string  `json:"source_ref" gorm:"size:512;not null;default:''"`
	SkillName         string  `json:"skill_name" gorm:"size:120;not null;uniqueIndex:uk_skill_libraries_eid_name,priority:2"`
	Sort              int64   `json:"sort" gorm:"not null;default:0;index:idx_skill_libraries_query,priority:4"`
	GroupIDs          []int64 `json:"group_ids" gorm:"-"`
	DisplayName       string  `json:"display_name" gorm:"size:120;not null;default:''"`
	Description       string  `json:"description" gorm:"type:text"`
	Version           string  `json:"version" gorm:"size:50;not null;default:'v1.0.0'"`
	UsageGuide        string  `json:"usage_guide" gorm:"type:text"`
	OriginZipKey      string  `json:"origin_zip_key" gorm:"size:512;not null;default:''"`
	OriginZipName     string  `json:"origin_zip_name" gorm:"size:255;not null;default:''"`
	OriginZipSize     int64   `json:"origin_zip_size" gorm:"not null;default:0"`
	OriginZipSHA256   string  `json:"origin_zip_sha256" gorm:"size:128;not null;default:''"`
	ExtractFolder     string  `json:"extract_folder" gorm:"size:150;not null;default:''"`
	InstallPath       string  `json:"install_path" gorm:"size:512;not null;default:''"`
	PublishStatus     string  `json:"publish_status" gorm:"size:20;not null;index:idx_skill_libraries_query,priority:2"`
	AdminStatus       string  `json:"admin_status" gorm:"size:20;not null;index:idx_skill_libraries_query,priority:3"`
	RiskLevel         string  `json:"risk_level" gorm:"size:20;not null;default:''"`
	ScoreIntegrity    float64 `json:"score_integrity" gorm:"not null;default:0"`
	ScorePracticality float64 `json:"score_practicality" gorm:"not null;default:0"`
	ScoreSafety       float64 `json:"score_safety" gorm:"not null;default:0"`
	ScoreCodeQuality  float64 `json:"score_code_quality" gorm:"not null;default:0"`
	ScoreDocQuality   float64 `json:"score_doc_quality" gorm:"not null;default:0"`
	Logo              string  `json:"logo" gorm:"size:512;not null;default:''"`
	ScanMessage       string  `json:"scan_message" gorm:"type:text"`
	ScanPayload       string  `json:"scan_payload" gorm:"type:text"`
	BaseModel
}

type SkillLibraryExploreFilter struct {
	VisibleGroupIDs []int64
	SkillIDs        []int64
	Keyword         string
	PublishStatuses []string
	AdminStatuses   []string
	Offset          int
	Limit           int
}

func ListExploreSkillLibraries(eid int64, keyword string, offset, limit int) ([]*SkillLibrary, int64, error) {
	return ListExploreSkillLibrariesWithStatus(eid, keyword, nil, nil, offset, limit)
}

func ListExploreSkillLibrariesWithStatus(eid int64, keyword string, publishStatuses []string, adminStatuses []string, offset, limit int) ([]*SkillLibrary, int64, error) {
	return ListExploreSkillLibrariesWithStatusAndPermissionGroupIDs(eid, keyword, nil, publishStatuses, adminStatuses, offset, limit)
}

func ListExploreSkillLibrariesWithStatusAndPermissionGroupIDs(eid int64, keyword string, permissionGroupIDs []int64, publishStatuses []string, adminStatuses []string, offset, limit int) ([]*SkillLibrary, int64, error) {
	return ListExploreSkillLibrariesWithFilter(eid, SkillLibraryExploreFilter{
		VisibleGroupIDs: permissionGroupIDs,
		Keyword:         keyword,
		PublishStatuses: publishStatuses,
		AdminStatuses:   adminStatuses,
		Offset:          offset,
		Limit:           limit,
	})
}

func ListExploreSkillLibrariesWithStatusAndPermissionGroupIDsAndSkillIDs(eid int64, keyword string, permissionGroupIDs, filterSkillIDs []int64, publishStatuses []string, adminStatuses []string, offset, limit int) ([]*SkillLibrary, int64, error) {
	return ListExploreSkillLibrariesWithFilter(eid, SkillLibraryExploreFilter{
		VisibleGroupIDs: permissionGroupIDs,
		SkillIDs:        filterSkillIDs,
		Keyword:         keyword,
		PublishStatuses: publishStatuses,
		AdminStatuses:   adminStatuses,
		Offset:          offset,
		Limit:           limit,
	})
}

func ListExploreSkillLibrariesWithFilter(eid int64, filter SkillLibraryExploreFilter) ([]*SkillLibrary, int64, error) {
	var (
		skills []*SkillLibrary
		count  int64
	)

	query := DB.Model(&SkillLibrary{})
	query = applySkillExploreVisibility(query, eid)
	// 有可见分组时，按分组权限筛选技能（仅平台技能 + 有权限的技能）
	// 无可见分组时（未登录），完全依赖 Query.eid = <企业eid> OR eid = 0 展示全部已发布技能
	if len(filter.VisibleGroupIDs) > 0 {
		resourceIDs, err := GetDistinctResourceIDsByGroupsAndType(filter.VisibleGroupIDs, ResourceTypeSkillLibrary)
		if err != nil {
			return nil, 0, err
		}
		if len(resourceIDs) > 0 {
			query = query.Where(DB.Where("skill_libraries.eid = ?", 0).Or("skill_libraries.id IN ?", resourceIDs))
		} else {
			query = query.Where("skill_libraries.eid = ?", 0)
		}
	}
	if len(filter.SkillIDs) > 0 {
		query = query.Where("skill_libraries.id IN ?", filter.SkillIDs)
	}

	if filter.Keyword != "" {
		like := "%" + filter.Keyword + "%"
		query = query.Where(DB.Where("skill_name LIKE ?", like).Or("display_name LIKE ?", like))
	}
	if len(filter.PublishStatuses) > 0 {
		query = query.Where("publish_status IN (?)", filter.PublishStatuses)
	}
	if len(filter.AdminStatuses) > 0 {
		query = query.Where("admin_status IN (?)", filter.AdminStatuses)
	}

	if err := query.Count(&count).Error; err != nil {
		return nil, 0, err
	}
	if count == 0 {
		return []*SkillLibrary{}, 0, nil
	}

	query = query.Order("sort DESC").Order("id DESC")
	if filter.Limit > 0 {
		query = query.Offset(filter.Offset).Limit(filter.Limit)
	}
	if err := query.Find(&skills).Error; err != nil {
		return nil, 0, err
	}
	if skills == nil {
		skills = []*SkillLibrary{}
	}
	return skills, count, nil
}

func (s *SkillLibrary) LoadSkillGroups() error {
	if s == nil {
		return nil
	}
	groupIDs, err := GetResourcePermissionGroupIDs(s.ID, ResourceTypeSkillLibrary)
	if err != nil {
		return err
	}
	if groupIDs == nil {
		groupIDs = []int64{}
	}
	s.GroupIDs = groupIDs
	return nil
}

func GetSkillLibraryByID(id int64) (*SkillLibrary, error) {
	var skill SkillLibrary
	if err := DB.Where("id = ?", id).First(&skill).Error; err != nil {
		return nil, err
	}
	return &skill, nil
}

func GetSkillLibraryByName(skillName string) (*SkillLibrary, error) {
	return GetSkillLibraryByNameAndEID(0, skillName)
}

func GetSkillLibraryByNameAndEID(eid int64, skillName string) (*SkillLibrary, error) {
	var skill SkillLibrary
	if err := DB.Where("eid = ? AND skill_name = ?", eid, skillName).First(&skill).Error; err != nil {
		return nil, err
	}
	return &skill, nil
}

func GetSkillLibraryByIDAndEID(eid, id int64) (*SkillLibrary, error) {
	var skill SkillLibrary
	if err := DB.Where("id = ? AND eid = ?", id, eid).First(&skill).Error; err != nil {
		return nil, err
	}
	return &skill, nil
}

func GetSkillLibraryByIDForTenant(eid, id int64) (*SkillLibrary, error) {
	var skill SkillLibrary
	if err := DB.Where("id = ? AND (eid = ? OR eid = ?)", id, eid, 0).First(&skill).Error; err != nil {
		return nil, err
	}
	return &skill, nil
}

func ListAdminSkillLibraries(eid int64, keyword string, publishStatus, adminStatus string, offset, limit int) ([]*SkillLibrary, int64, error) {
	var (
		skills []*SkillLibrary
		count  int64
	)

	query := DB.Model(&SkillLibrary{}).Where("skill_libraries.eid = ? OR skill_libraries.eid = ?", eid, 0)
	if keyword != "" {
		like := "%" + keyword + "%"
		query = query.Where(DB.Where("skill_name LIKE ?", like).Or("display_name LIKE ?", like))
	}
	if publishStatus != "" {
		query = query.Where("publish_status = ?", publishStatus)
	}
	if adminStatus != "" {
		query = query.Where("admin_status = ?", adminStatus)
	}

	if err := query.Count(&count).Error; err != nil {
		return nil, 0, err
	}
	if count == 0 {
		return []*SkillLibrary{}, 0, nil
	}

	query = query.Order("sort DESC").Order("id DESC")
	if limit > 0 {
		query = query.Offset(offset).Limit(limit)
	}
	if err := query.Find(&skills).Error; err != nil {
		return nil, 0, err
	}
	if skills == nil {
		skills = []*SkillLibrary{}
	}
	return skills, count, nil
}

func ListAdminSkillLibrariesWithFilter(eid int64, keyword, publishStatus, adminStatus string, filterSkillIDs []int64, offset, limit int) ([]*SkillLibrary, int64, error) {
	var (
		skills []*SkillLibrary
		count  int64
	)

	query := DB.Model(&SkillLibrary{}).Where("skill_libraries.eid = ? OR skill_libraries.eid = ?", eid, 0)
	if keyword != "" {
		like := "%" + keyword + "%"
		query = query.Where(DB.Where("skill_name LIKE ?", like).Or("display_name LIKE ?", like))
	}
	if publishStatus != "" {
		query = query.Where("publish_status = ?", publishStatus)
	}
	if adminStatus != "" {
		query = query.Where("admin_status = ?", adminStatus)
	}
	if len(filterSkillIDs) > 0 {
		query = query.Where("id IN ?", filterSkillIDs)
	}

	if err := query.Count(&count).Error; err != nil {
		return nil, 0, err
	}
	if count == 0 {
		return []*SkillLibrary{}, 0, nil
	}

	query = query.Order("sort DESC").Order("id DESC")
	if limit > 0 {
		query = query.Offset(offset).Limit(limit)
	}
	if err := query.Find(&skills).Error; err != nil {
		return nil, 0, err
	}
	if skills == nil {
		skills = []*SkillLibrary{}
	}
	return skills, count, nil
}

func UpdateSkillLibraryByIDAndEID(eid, id int64, updates map[string]interface{}) error {
	tx := DB.Model(&SkillLibrary{}).Where("id = ? AND eid = ?", id, eid).Updates(updates)
	if tx.Error != nil {
		return tx.Error
	}
	if tx.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func DeleteSkillLibraryByIDAndEID(tx *gorm.DB, eid, id int64) error {
	if tx == nil {
		tx = DB
	}
	result := tx.Where("id = ? AND eid = ?", id, eid).Delete(&SkillLibrary{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func ListSkillLibrariesByIDs(ids []int64) ([]*SkillLibrary, error) {
	if len(ids) == 0 {
		return []*SkillLibrary{}, nil
	}
	var skills []*SkillLibrary
	if err := DB.Where("id IN (?)", ids).Find(&skills).Error; err != nil {
		return nil, err
	}
	if skills == nil {
		skills = []*SkillLibrary{}
	}
	return skills, nil
}

func SaveSkillLibrary(tx *gorm.DB, skill *SkillLibrary) error {
	if skill == nil {
		return errors.New("skill is nil")
	}
	if tx == nil {
		tx = DB
	}
	return tx.Save(skill).Error
}

func applySkillExploreVisibility(query *gorm.DB, eid int64) *gorm.DB {
	return query.Where("skill_libraries.eid = ? OR skill_libraries.eid = ?", eid, 0)
}
