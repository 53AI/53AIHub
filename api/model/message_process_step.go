package model

import (
	"encoding/json"
)

// MessageProcessStep 消息处理过程步骤记录
type MessageProcessStep struct {
	ID            int64  `json:"id" gorm:"column:id;primaryKey;autoIncrement"`
	Eid           int64  `json:"eid" gorm:"column:eid;not null;index"`
	MessageID     int64  `json:"message_id" gorm:"column:message_id;not null;index"`
	RequestID     string `json:"request_id" gorm:"column:request_id;size:255;default:'';index"`
	StepCode      string `json:"step_code" gorm:"column:step_code;size:64;not null;index"`
	Name          string `json:"name" gorm:"column:name;size:255;default:''"`
	Status        string `json:"status" gorm:"column:status;size:20;not null;default:'start';index"`
	Message       string `json:"message" gorm:"column:message;type:text"`
	Data          string `json:"data" gorm:"column:data;type:text"`
	StepTimestamp int64  `json:"step_timestamp" gorm:"column:step_timestamp;default:0;index"`
	BaseModel
}

// TableName 指定表名
func (MessageProcessStep) TableName() string {
	return "message_process_steps"
}

// SetDataMap 设置 Data 字段（JSON 序列化）
func (m *MessageProcessStep) SetDataMap(v map[string]interface{}) error {
	if len(v) == 0 {
		m.Data = ""
		return nil
	}
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	m.Data = string(b)
	return nil
}

// GetDataMap 读取 Data 字段（JSON 反序列化）
func (m *MessageProcessStep) GetDataMap() (map[string]interface{}, error) {
	if m.Data == "" {
		return map[string]interface{}{}, nil
	}
	var data map[string]interface{}
	if err := json.Unmarshal([]byte(m.Data), &data); err != nil {
		return nil, err
	}
	return data, nil
}

// CreateMessageProcessStep 创建步骤记录
func CreateMessageProcessStep(step *MessageProcessStep) error {
	return DB.Create(step).Error
}

// GetMessageProcessStepsByMessageIDs 按消息ID批量查询步骤记录，并按 message_id 分组
func GetMessageProcessStepsByMessageIDs(eid int64, messageIDs []int64) (map[int64][]*MessageProcessStep, error) {
	grouped := make(map[int64][]*MessageProcessStep, len(messageIDs))
	if len(messageIDs) == 0 {
		return grouped, nil
	}

	var steps []*MessageProcessStep
	err := DB.Where("eid = ? AND message_id IN ?", eid, messageIDs).
		Order("step_timestamp ASC").
		Order("created_time ASC").
		Order("id ASC").
		Find(&steps).Error
	if err != nil {
		return nil, err
	}

	for _, step := range steps {
		grouped[step.MessageID] = append(grouped[step.MessageID], step)
	}
	return grouped, nil
}
