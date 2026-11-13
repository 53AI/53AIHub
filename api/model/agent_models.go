package model

import (
	"fmt"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// AgentModels Agent模型配置
// @Description Agent模型配置，用于存储Agent支持的不同模型和渠道类型
type AgentModels struct {
	// ID 主键
	ID int64 `json:"id" gorm:"primaryKey;autoIncrement"`
	// Eid 企业ID
	Eid int64 `json:"eid" gorm:"not null;index"`
	// AgentID Agent ID
	AgentID int64 `json:"agent_id" gorm:"not null;index"`
	// Model 模型名称
	Model string `json:"model" gorm:"not null"`
	// ChannelType 渠道类型
	ChannelType int `json:"channel_type" gorm:"default:0"`
	// ChannelID 渠道ID，关联 Channel.ChannelID
	ChannelID int64                  `json:"channel_id" gorm:"default:0"`
	ModelMeta map[string]interface{} `json:"model_meta" gorm:"-"`
	BaseModel
}

func (am *AgentModels) Create() error {
	result := DB.Create(am)
	if result.Error != nil {
		return result.Error
	}
	return nil
}

func (am *AgentModels) Update() error {
	err := DB.Model(am).Updates(am).Error
	return err
}

func (am *AgentModels) Delete() error {
	err := DB.Delete(am).Error
	return err
}

func GetAgentModelByID(eid, id int64) (*AgentModels, error) {
	var agentModel AgentModels
	err := DB.Where("eid = ? AND id = ?", eid, id).First(&agentModel).Error
	if err != nil {
		return nil, err
	}
	return &agentModel, nil
}

func GetAgentModelsByAgentID(eid, agentID int64) ([]*AgentModels, error) {
	var agentModels []*AgentModels
	err := DB.Where("eid = ? AND agent_id = ?", eid, agentID).Order("id ASC").Find(&agentModels).Error
	if err != nil {
		return nil, err
	}
	return agentModels, nil
}

func GetAgentModelsList(eid int64, offset, limit int) (int64, []*AgentModels, error) {
	var count int64
	var agentModels []*AgentModels

	db := DB.Model(&AgentModels{}).Where("eid = ?", eid)

	db.Count(&count)

	err := db.Offset(offset).Limit(limit).Order("id DESC").Find(&agentModels).Error

	return count, agentModels, err
}

// GetAgentModelsByChannelID 根据渠道ID获取Agent模型列表
func GetAgentModelsByChannelID(eid, channelID int64) ([]*AgentModels, error) {
	var agentModels []*AgentModels
	err := DB.Where("eid = ? AND channel_id = ?", eid, channelID).Find(&agentModels).Error
	if err != nil {
		return nil, err
	}
	return agentModels, nil
}

// GetAgentModelsByEidAndChannelIds 根据企业ID和渠道ID列表获取Agent模型列表
func GetAgentModelsByEidAndChannelIds(eid int64, channelIds []int64) ([]*AgentModels, error) {
	var agentModels []*AgentModels
	if len(channelIds) == 0 {
		return agentModels, nil
	}
	err := DB.Where("eid = ? AND channel_id IN ?", eid, channelIds).Find(&agentModels).Error
	if err != nil {
		return nil, err
	}
	return agentModels, nil
}

// ReconcileAgentModels replaces the ordered configuration list without replacing the
// primary keys of existing slots. The batch API has historically treated list position
// as the role (fast reasoning first, deep thinking / skill execution second). Preserve
// this contract for existing clients and databases, without requiring a schema migration.
//
// An agent row lock serializes concurrent saves, including the initial empty list.
// Every operation is in a single transaction: a failed update/create/delete rolls back.
func ReconcileAgentModels(eid, agentID int64, requested []AgentModels) ([]*AgentModels, error) {
	if len(requested) == 0 {
		return nil, fmt.Errorf("models list cannot be empty")
	}
	for _, item := range requested {
		if item.Model == "" || item.ChannelID <= 0 {
			return nil, fmt.Errorf("model and channel_id are required")
		}
	}

	var result []*AgentModels
	err := DB.Transaction(func(tx *gorm.DB) error {
		var agent Agent
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("eid = ? AND agent_id = ?", eid, agentID).First(&agent).Error; err != nil {
			return err
		}
		var existing []AgentModels
		if err := tx.Where("eid = ? AND agent_id = ?", eid, agentID).
			Order("id ASC").Find(&existing).Error; err != nil {
			return err
		}

		result = make([]*AgentModels, 0, len(requested))
		for i, item := range requested {
			if i < len(existing) {
				current := existing[i]
				if current.Model != item.Model || current.ChannelID != item.ChannelID || current.ChannelType != item.ChannelType {
					if err := tx.Model(&current).Updates(map[string]interface{}{
						"model": item.Model, "channel_id": item.ChannelID,
						"channel_type": item.ChannelType,
					}).Error; err != nil {
						return err
					}
					current.Model, current.ChannelID, current.ChannelType = item.Model, item.ChannelID, item.ChannelType
				}
				result = append(result, &current)
				continue
			}
			created := &AgentModels{
				Eid: eid, AgentID: agentID, Model: item.Model,
				ChannelID: item.ChannelID, ChannelType: item.ChannelType,
			}
			if err := tx.Create(created).Error; err != nil {
				return err
			}
			result = append(result, created)
		}
		if len(existing) > len(requested) {
			ids := make([]int64, 0, len(existing)-len(requested))
			for _, removed := range existing[len(requested):] {
				ids = append(ids, removed.ID)
			}
			if err := tx.Where("eid = ? AND agent_id = ? AND id IN ?", eid, agentID, ids).
				Delete(&AgentModels{}).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}
