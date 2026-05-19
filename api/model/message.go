package model

import "encoding/json"

type Message struct {
	ID                int64  `json:"id" gorm:"column:id;primaryKey;autoIncrement"`
	Eid               int64  `json:"eid" gorm:"column:eid;not null"`
	UserID            int64  `json:"user_id" gorm:"column:user_id;not null"`
	Message           string `json:"message" gorm:"column:message;type:text"`
	AgentID           int64  `json:"agent_id" gorm:"column:agent_id;not null"`
	ConversationID    int64  `json:"conversation_id" gorm:"column:conversation_id;not null"`
	Answer            string `json:"answer" gorm:"column:answer;type:text"`
	ReasoningContent  string `json:"reasoning_content" gorm:"column:reasoning_content;type:text"`
	ModelName         string `json:"model_name" gorm:"index;index:index_username_model_name,priority:1;default:''"`
	Quota             int    `json:"quota" gorm:"default:0"`
	PromptTokens      int    `json:"prompt_tokens" gorm:"default:0"`
	CompletionTokens  int    `json:"completion_tokens" gorm:"default:0"`
	TotalTokens       int    `json:"total_tokens" gorm:"default:0"`
	ChannelId         int    `json:"channel" gorm:"index"`
	RequestId         string `json:"request_id" gorm:"default:''"`
	ElapsedTime       int64  `json:"elapsed_time" gorm:"default:0"`
	IsStream          bool   `json:"is_stream" gorm:"default:false"`
	QuotaContent      string `json:"quota_content" gorm:"default:''"`
	AgentCustomConfig string `json:"agent_custom_config" gorm:"type:text;default:''"`
	BaseModel
}

// MessageType 消息类型枚举
type MessageType string

const (
	MessageTypeChat     MessageType = "chat"     // 聊天消息
	MessageTypeWorkflow MessageType = "workflow" // 工作流消息
)

// GetMessageType 根据 Agent 类型判断消息类型
func (m *Message) GetMessageType() MessageType {
	// 查询关联的 Agent 来判断类型
	agent, err := GetAgentByID(m.Eid, m.AgentID)
	if err != nil {
		// 如果查询失败，默认返回聊天类型
		return MessageTypeChat
	}

	if agent.AgentType == AgentTypeWorkflow {
		return MessageTypeWorkflow
	}

	return MessageTypeChat
}

// ParseChatMessage 解析聊天消息的 Message 字段
func (m *Message) ParseChatMessage() ([]map[string]interface{}, error) {
	var messages []map[string]interface{}
	if err := json.Unmarshal([]byte(m.Message), &messages); err != nil {
		return nil, err
	}
	return messages, nil
}

// ParseWorkflowParameters 解析工作流消息的 Message 字段（parameters）
func (m *Message) ParseWorkflowParameters() (map[string]interface{}, error) {
	var parameters map[string]interface{}
	if err := json.Unmarshal([]byte(m.Message), &parameters); err != nil {
		return nil, err
	}
	return parameters, nil
}

// ParseWorkflowOutput 解析工作流消息的 Answer 字段（workflow_output_data）
func (m *Message) ParseWorkflowOutput() (map[string]interface{}, error) {
	var outputData map[string]interface{}
	if err := json.Unmarshal([]byte(m.Answer), &outputData); err != nil {
		return nil, err
	}
	return outputData, nil
}

// CreateMessage creates a new message record
func CreateMessage(message *Message) error {
	return DB.Create(message).Error
}

// GetMessageByID retrieves a message by ID
func GetMessageByID(eid int64, id int64) (*Message, error) {
	var message Message
	err := DB.Where("eid = ? AND id = ?", eid, id).First(&message).Error
	if err != nil {
		return nil, err
	}
	return &message, nil
}

// GetMessagesByUserID retrieves all messages for a user
func GetMessagesByUserID(eid int64, userID int64) ([]*Message, error) {
	var messages []*Message
	err := DB.Where("eid = ? AND user_id = ?", eid, userID).Find(&messages).Error
	if err != nil {
		return nil, err
	}
	return messages, nil
}

// GetMessagesByAgentID retrieves all messages for a specific agent
func GetMessagesByAgentID(eid int64, agentID int64) ([]*Message, error) {
	var messages []*Message
	err := DB.Where("eid = ? AND agent_id = ?", eid, agentID).Find(&messages).Error
	if err != nil {
		return nil, err
	}
	return messages, nil
}

// GetMessagesByUserAndAgent retrieves conversation messages between a user and a specific agent
func GetMessagesByUserAndAgent(eid int64, userID int64, agentID int64, keyword string, limit int, offset int) (count int64, messages []*Message, err error) {
	query := DB.Model(&Message{}).Where("eid = ? AND user_id = ? AND agent_id = ?", eid, userID, agentID)

	if keyword != "" {
		query = query.Where("message LIKE ? OR answer LIKE ?", "%"+keyword+"%", "%"+keyword+"%")
	}

	countQuery := query
	if err = countQuery.Count(&count).Error; err != nil {
		return 0, nil, err
	}

	if limit == 0 {
		limit = 10
	}
	query = query.Limit(limit)

	if offset > 0 {
		query = query.Offset(offset)
	}

	err = query.Find(&messages).Error
	if err != nil {
		return 0, nil, err
	}

	return count, messages, nil
}

// UpdateMessage updates a message record
func UpdateMessage(message *Message) error {
	return DB.Save(message).Error
}

// DeleteMessage deletes a message by ID
func DeleteMessage(eid int64, id int64) error {
	return DB.Where("eid = ? AND id = ?", eid, id).Delete(&Message{}).Error
}

// DeleteMessagesByUserID deletes all messages for a user
func DeleteMessagesByUserID(eid int64, userID int64) error {
	return DB.Where("eid = ? AND user_id = ?", eid, userID).Delete(&Message{}).Error
}

// DeleteMessagesByAgentID deletes all messages for a specific agent
func DeleteMessagesByAgentID(eid int64, agentID int64) error {
	return DB.Where("eid = ? AND agent_id = ?", eid, agentID).Delete(&Message{}).Error
}

// GetMessagesByConversationID retrieves conversation messages by conversation ID
func GetMessagesByConversationID(eid int64, conversationID int64, keyword string, limit int, offset int) (count int64, messages []*Message, err error) {
	query := DB.Model(&Message{}).Where("eid = ? AND conversation_id = ?", eid, conversationID)
	if keyword != "" {
		query = query.Where("message LIKE ? OR answer LIKE ?", "%"+keyword+"%", "%"+keyword+"%")
	}

	countQuery := query
	if err = countQuery.Count(&count).Error; err != nil {
		return 0, nil, err
	}

	if limit == 0 {
		limit = 10
	}
	query = query.Limit(limit)
	if offset > 0 {
		query = query.Offset(offset)
	}

	err = query.Order("created_time DESC").Find(&messages).Error
	if err != nil {
		return 0, nil, err
	}
	return count, messages, nil
}

// GetMessagesByConversationIDWithDirection retrieves conversation messages by conversation ID with direction control
func GetMessagesByConversationIDWithDirection(eid int64, conversationID int64, keyword string, limit, offset int, direction string) (count int64, messages []*Message, err error) {
	query := DB.Model(&Message{}).Where("eid = ? AND conversation_id = ?", eid, conversationID)
	if keyword != "" {
		query = query.Where("message LIKE ? OR answer LIKE ?", "%"+keyword+"%", "%"+keyword+"%")
	}

	countQuery := query
	if err = countQuery.Count(&count).Error; err != nil {
		return 0, nil, err
	}

	if limit == 0 {
		limit = 10
	}
	query = query.Limit(limit)
	if offset > 0 {
		query = query.Offset(offset)
	}

	if direction == "asc" {
		query = query.Order("created_time ASC")
	} else {
		query = query.Order("created_time DESC")
	}

	err = query.Find(&messages).Error
	if err != nil {
		return 0, nil, err
	}

	return count, messages, nil
}
