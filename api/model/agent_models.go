package model

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
	err := DB.Where("eid = ? AND agent_id = ?", eid, agentID).Find(&agentModels).Error
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
