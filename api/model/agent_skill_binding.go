package model

import (
	"errors"
	"time"

	"gorm.io/gorm"
)

const (
	AgentSkillBindTypeBuiltin       = "builtin"
	AgentSkillBindTypeUser          = "user"
	AgentSkillBindingStatusEnabled  = "enabled"
	AgentSkillBindingStatusDisabled = "disabled"
)

type AgentSkillBinding struct {
	ID             int64  `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid            int64  `json:"eid" gorm:"not null;uniqueIndex:uk_agent_skill_bindings,priority:1"`
	AgentID        int64  `json:"agent_id" gorm:"not null;uniqueIndex:uk_agent_skill_bindings,priority:2"`
	SkillLibraryID int64  `json:"skill_library_id" gorm:"not null;uniqueIndex:uk_agent_skill_bindings,priority:3"`
	BindType       string `json:"bind_type" gorm:"size:20;not null;uniqueIndex:uk_agent_skill_bindings,priority:4"`
	UserID         int64  `json:"user_id" gorm:"not null;default:0;uniqueIndex:uk_agent_skill_bindings,priority:5"`
	Status         string `json:"status" gorm:"size:20;not null"`
	BaseModel
}

type AgentSkillBindingWithSkill struct {
	BindingID      int64  `json:"binding_id"`
	Eid            int64  `json:"eid"`
	AgentID        int64  `json:"agent_id"`
	SkillLibraryID int64  `json:"skill_library_id"`
	BindType       string `json:"bind_type"`
	UserID         int64  `json:"user_id"`
	Status         string `json:"status"`
	SkillName      string `json:"skill_name"`
	Logo           string `json:"logo"`
	DisplayName    string `json:"display_name"`
	Description    string `json:"description"`
	Version        string `json:"version"`
	UsageGuide     string `json:"usage_guide"`
	SourceType     string `json:"source_type"`
	PublishStatus  string `json:"publish_status"`
	AdminStatus    string `json:"admin_status"`
	RiskLevel      string `json:"risk_level"`
	InstallPath    string `json:"install_path"`
	Sort           int64  `json:"sort"`
	CreatedTime    int64  `json:"created_time"`
	UpdatedTime    int64  `json:"updated_time"`
}

func AddAgentSkillBinding(eid, agentID, skillLibraryID int64, bindType string, userID int64) error {
	var binding AgentSkillBinding
	err := DB.Where("eid = ? AND agent_id = ? AND skill_library_id = ? AND bind_type = ? AND user_id = ?",
		eid, agentID, skillLibraryID, bindType, userID).First(&binding).Error
	if err == nil {
		if binding.Status == AgentSkillBindingStatusEnabled {
			return nil
		}
		now := time.Now().UTC().UnixMilli()
		return DB.Model(&AgentSkillBinding{}).
			Where("id = ?", binding.ID).
			Updates(map[string]interface{}{
				"status":       AgentSkillBindingStatusEnabled,
				"updated_time": now,
			}).Error
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}

	binding = AgentSkillBinding{
		Eid:            eid,
		AgentID:        agentID,
		SkillLibraryID: skillLibraryID,
		BindType:       bindType,
		UserID:         userID,
		Status:         AgentSkillBindingStatusEnabled,
	}
	return DB.Create(&binding).Error
}

func DeleteAgentSkillBinding(eid, agentID, bindingID int64, bindType string, userID int64) error {
	query := DB.Where("eid = ? AND agent_id = ? AND id = ? AND bind_type = ?", eid, agentID, bindingID, bindType)
	if bindType == AgentSkillBindTypeUser {
		query = query.Where("user_id = ?", userID)
	}
	tx := query.Delete(&AgentSkillBinding{})
	if tx.Error != nil {
		return tx.Error
	}
	if tx.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func ListAgentSkillBindingsWithSkills(eid, agentID, userID int64) ([]*AgentSkillBindingWithSkill, error) {
	query := DB.Table("agent_skill_bindings").
		Select(`agent_skill_bindings.id AS binding_id,
agent_skill_bindings.eid,
agent_skill_bindings.agent_id,
agent_skill_bindings.skill_library_id,
agent_skill_bindings.bind_type,
agent_skill_bindings.user_id,
agent_skill_bindings.status,
skill_libraries.skill_name,
skill_libraries.logo,
skill_libraries.display_name,
skill_libraries.description,
skill_libraries.version,
skill_libraries.usage_guide,
skill_libraries.source_type,
skill_libraries.publish_status,
skill_libraries.admin_status,
skill_libraries.risk_level,
skill_libraries.install_path,
skill_libraries.sort,
agent_skill_bindings.created_time,
agent_skill_bindings.updated_time`).
		Joins("JOIN skill_libraries ON skill_libraries.id = agent_skill_bindings.skill_library_id").
		Where("agent_skill_bindings.eid = ? AND agent_skill_bindings.agent_id = ?", eid, agentID).
		Where("(agent_skill_bindings.bind_type = ? OR (agent_skill_bindings.bind_type = ? AND agent_skill_bindings.user_id = ?))",
			AgentSkillBindTypeBuiltin, AgentSkillBindTypeUser, userID).
		Where("skill_libraries.publish_status = ? AND skill_libraries.admin_status = ?",
			SkillPublishStatusPublished, SkillAdminStatusEnabled).
		Order("agent_skill_bindings.bind_type ASC").
		Order("skill_libraries.sort DESC").
		Order("agent_skill_bindings.id DESC")

	var rows []*AgentSkillBindingWithSkill
	if err := query.Find(&rows).Error; err != nil {
		return nil, err
	}
	if rows == nil {
		rows = []*AgentSkillBindingWithSkill{}
	}
	return rows, nil
}

func ListAgentSkillBuiltinBindings(eid, agentID int64) ([]*AgentSkillBindingWithSkill, error) {
	query := DB.Table("agent_skill_bindings").
		Select(`agent_skill_bindings.id AS binding_id,
agent_skill_bindings.eid,
agent_skill_bindings.agent_id,
agent_skill_bindings.skill_library_id,
agent_skill_bindings.bind_type,
agent_skill_bindings.user_id,
agent_skill_bindings.status,
skill_libraries.skill_name,
skill_libraries.logo,
skill_libraries.display_name,
skill_libraries.description,
skill_libraries.version,
skill_libraries.usage_guide,
skill_libraries.source_type,
skill_libraries.publish_status,
skill_libraries.admin_status,
skill_libraries.risk_level,
skill_libraries.install_path,
skill_libraries.sort,
agent_skill_bindings.created_time,
agent_skill_bindings.updated_time`).
		Joins("JOIN skill_libraries ON skill_libraries.id = agent_skill_bindings.skill_library_id").
		Where("agent_skill_bindings.eid = ? AND agent_skill_bindings.agent_id = ? AND agent_skill_bindings.bind_type = ?",
			eid, agentID, AgentSkillBindTypeBuiltin).
		Order("skill_libraries.sort DESC").
		Order("agent_skill_bindings.id DESC")

	var rows []*AgentSkillBindingWithSkill
	if err := query.Find(&rows).Error; err != nil {
		return nil, err
	}
	if rows == nil {
		rows = []*AgentSkillBindingWithSkill{}
	}
	return rows, nil
}

func ListAgentSkillBuiltinInstallPaths(eid, agentID int64) ([]string, error) {
	var paths []string
	err := DB.Table("agent_skill_bindings").
		Select("skill_libraries.install_path").
		Joins("JOIN skill_libraries ON skill_libraries.id = agent_skill_bindings.skill_library_id").
		Where("agent_skill_bindings.eid = ? AND agent_skill_bindings.agent_id = ? AND agent_skill_bindings.bind_type = ? AND agent_skill_bindings.status = ?",
			eid, agentID, AgentSkillBindTypeBuiltin, AgentSkillBindingStatusEnabled).
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

func ListAgentSkillUserLibraryIDs(eid, agentID, userID int64) ([]int64, error) {
	var ids []int64
	err := DB.Model(&AgentSkillBinding{}).
		Where("eid = ? AND agent_id = ? AND bind_type = ? AND user_id = ? AND status = ?",
			eid, agentID, AgentSkillBindTypeUser, userID, AgentSkillBindingStatusEnabled).
		Pluck("skill_library_id", &ids).Error
	if err != nil {
		return nil, err
	}
	if ids == nil {
		ids = []int64{}
	}
	return ids, nil
}

func DeleteAgentSkillUserBindingsBySkill(eid, agentID, skillLibraryID int64) error {
	return DB.Where("eid = ? AND agent_id = ? AND skill_library_id = ? AND bind_type = ?",
		eid, agentID, skillLibraryID, AgentSkillBindTypeUser).Delete(&AgentSkillBinding{}).Error
}

func HasAgentBuiltinSkillBinding(eid, agentID, skillLibraryID int64) (bool, error) {
	var count int64
	err := DB.Model(&AgentSkillBinding{}).
		Where("eid = ? AND agent_id = ? AND skill_library_id = ? AND bind_type = ? AND status = ?",
			eid, agentID, skillLibraryID, AgentSkillBindTypeBuiltin, AgentSkillBindingStatusEnabled).
		Count(&count).Error
	if err != nil {
		return false, err
	}
	return count > 0, nil
}
