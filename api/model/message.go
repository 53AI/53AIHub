package model

import (
	"encoding/json"
	"strings"
	"time"

	"gorm.io/gorm"
)

// Message 不嵌入 BaseModel，CreatedTime/UpdatedTime 为直接字段。
// 之前因 BaseModel 嵌入 + 直接字段重复导致 CreatedTime 始终为 0
// （BaseModel.BeforeCreate 设置嵌入字段，GORM 写库用直接字段）。
// 如需修改时间字段行为，同步更新 BeforeCreate / BeforeUpdate / BeforeSave 三个 hook。
type Message struct {
	ID                int64  `json:"id" gorm:"column:id;primaryKey;autoIncrement"`
	Eid               int64  `json:"eid" gorm:"column:eid;not null"`
	UserID            int64  `json:"user_id" gorm:"column:user_id;not null;index:idx_messages_agent_user_time,priority:2"`
	Message           string `json:"message" gorm:"column:message;type:text"`
	AgentID           int64  `json:"agent_id" gorm:"column:agent_id;not null;index:idx_messages_agent_user_time,priority:1"`
	ConversationID    int64  `json:"conversation_id" gorm:"column:conversation_id;not null"`
	CreatedTime       int64  `json:"created_time" gorm:"not null;index:idx_messages_agent_user_time,priority:3"`
	UpdatedTime       int64  `json:"updated_time" gorm:"not null"`
	VisitorID         string `json:"visitor_id" gorm:"column:visitor_id;size:64;default:''"`
	FileID            int64  `json:"file_id" gorm:"column:file_id;default:0"`
	Answer            string `json:"answer" gorm:"column:answer;type:text"`
	ReasoningContent  string `json:"reasoning_content" gorm:"column:reasoning_content;type:text"`
	ModelName         string `json:"model_name" gorm:"index;index:index_username_model_name,priority:1;default:''"`
	Quota             int    `json:"quota" gorm:"default:0"`
	PromptTokens      int    `json:"prompt_tokens" gorm:"default:0"`
	CompletionTokens  int    `json:"completion_tokens" gorm:"default:0"`
	TotalTokens       int    `json:"total_tokens" gorm:"default:0"`
	ChannelId         int    `json:"channel" gorm:"index"`
	RequestId         string `json:"request_id" gorm:"size:255;default:''"`
	ElapsedTime       int64  `json:"elapsed_time" gorm:"default:0"`
	IsStream          bool   `json:"is_stream" gorm:"default:false"`
	QuotaContent      string `json:"quota_content" gorm:"size:2000;default:''"`
	AgentCustomConfig string `json:"agent_custom_config" gorm:"size:2000;default:''"`
	RAGStats          string `json:"rag_stats,omitempty" gorm:"type:text"`
	ResponseStatus    int    `json:"response_status" gorm:"default:1;index"`
	ThinkingMode      int    `json:"thinking_mode" gorm:"default:1;index"`
	KnowledgeScope    string `json:"knowledge_scope" gorm:"size:255;default:'';index"`
	CitationCount     int    `json:"citation_count" gorm:"default:0;index"`
	KnowledgeType     int    `json:"knowledge_type" gorm:"default:1;index"`
	RequestSource     string `json:"request_source" gorm:"size:32;not null;default:'console'"`
	OriginalQuestion  string `json:"original_question" gorm:"type:text"`
	RewrittenQuestion string `json:"rewritten_question" gorm:"type:text"`
	Media             string `json:"media" gorm:"type:text"`

	OpenClawProjectionKey  string `json:"-" gorm:"column:openclaw_projection_key;size:255;default:''"`
	OpenClawTurnID         string `json:"-" gorm:"column:openclaw_turn_id;size:255;default:''"`
	OpenClawSeqStart       int64  `json:"-" gorm:"column:openclaw_seq_start;default:0"`
	OpenClawSeqEnd         int64  `json:"-" gorm:"column:openclaw_seq_end;default:0"`
	OpenClawStatus         string `json:"-" gorm:"column:openclaw_status;size:32;default:''"`
	OpenClawProjectionJSON string `json:"-" gorm:"column:openclaw_projection_json;type:text"`
}

type MessageType string

const (
	MessageTypeChat     MessageType = "chat"
	MessageTypeWorkflow MessageType = "workflow"
)

const (
	ResponseStatusNormal = 1
	ResponseStatusReject = 2
)

const (
	ThinkingModeQuick = 1
	ThinkingModeDeep  = 2
)

const (
	KnowledgeTypeDatabase   = 1
	KnowledgeTypeWeb        = 2
	KnowledgeTypeSpecificKB = 3
	KnowledgeTypeSingleFile = 4
)

const (
	MessageRequestSourceConsole = "console"
	MessageRequestSourceAPI     = "api"
	MessageRequestSourceH5      = "h5"
)

func normalizeMessageRequestSource(requestSource string, visitorID string) string {
	visitorID = strings.TrimSpace(visitorID)
	requestSource = strings.TrimSpace(requestSource)
	if visitorID != "" && (requestSource == "" || requestSource == MessageRequestSourceConsole) {
		return MessageRequestSourceH5
	}
	if requestSource == "" {
		return MessageRequestSourceConsole
	}
	return requestSource
}

func applyVisitorMessageScope(query *gorm.DB, visitorID string) *gorm.DB {
	visitorID = strings.TrimSpace(visitorID)
	if visitorID == "" || query == nil {
		return query
	}
	return query.Where("visitor_id = ? AND (request_source = ? OR request_source = ?)", visitorID, MessageRequestSourceH5, MessageRequestSourceAPI)
}

// GORM hook 调用顺序（v2）：
//   Create: BeforeCreate → BeforeSave
//   Save:   BeforeUpdate → BeforeSave
//   Update: BeforeUpdate（BeforeSave 不触发）
// 时间字段仅在这三个 hook 中维护，其他 hook 不要触碰 CreatedTime/UpdatedTime。

func (m *Message) BeforeCreate(tx *gorm.DB) error {
	now := time.Now().UTC().UnixMilli()
	if m.CreatedTime == 0 {
		m.CreatedTime = now
	}
	m.UpdatedTime = now
	return nil
}

func (m *Message) BeforeUpdate(tx *gorm.DB) error {
	m.UpdatedTime = time.Now().UTC().UnixMilli()
	return nil
}

func (m *Message) BeforeSave(tx *gorm.DB) error {
	m.VisitorID = strings.TrimSpace(m.VisitorID)
	m.RequestSource = normalizeMessageRequestSource(m.RequestSource, m.VisitorID)
	return nil
}

func (m *Message) AfterFind(tx *gorm.DB) error {
	m.VisitorID = strings.TrimSpace(m.VisitorID)
	m.RequestSource = normalizeMessageRequestSource(m.RequestSource, m.VisitorID)
	if m.CreatedTime == 0 && m.UpdatedTime > 0 {
		m.CreatedTime = m.UpdatedTime
	}
	return nil
}

func (m *Message) GetMessageType() MessageType {
	agent, err := GetAgentByID(m.Eid, m.AgentID)
	if err != nil {
		return MessageTypeChat
	}

	if agent.AgentType == AgentTypeWorkflow {
		return MessageTypeWorkflow
	}

	return MessageTypeChat
}

func (m *Message) ParseChatMessage() ([]map[string]interface{}, error) {
	var messages []map[string]interface{}
	if err := json.Unmarshal([]byte(m.Message), &messages); err != nil {
		return nil, err
	}
	return messages, nil
}

func (m *Message) ParseWorkflowParameters() (map[string]interface{}, error) {
	var parameters map[string]interface{}
	if err := json.Unmarshal([]byte(m.Message), &parameters); err != nil {
		return nil, err
	}
	return parameters, nil
}

func (m *Message) ParseWorkflowOutput() (map[string]interface{}, error) {
	var outputData map[string]interface{}
	if err := json.Unmarshal([]byte(m.Answer), &outputData); err != nil {
		return nil, err
	}
	return outputData, nil
}

func CreateMessage(message *Message) error {
	return DB.Create(message).Error
}

func GetMessageByID(eid int64, id int64) (*Message, error) {
	var message Message
	err := DB.Where("eid = ? AND id = ?", eid, id).First(&message).Error
	if err != nil {
		return nil, err
	}
	return &message, nil
}

func GetMessagesByUserID(eid int64, userID int64) ([]*Message, error) {
	var messages []*Message
	err := DB.Where("eid = ? AND user_id = ?", eid, userID).Find(&messages).Error
	if err != nil {
		return nil, err
	}
	return messages, nil
}

func GetMessagesByAgentID(eid int64, agentID int64) ([]*Message, error) {
	var messages []*Message
	err := DB.Where("eid = ? AND agent_id = ?", eid, agentID).Find(&messages).Error
	if err != nil {
		return nil, err
	}
	return messages, nil
}

func GetMessagesByUserAndAgent(eid int64, userID int64, agentID int64, keyword string, fileID int64, limit int, offset int) (count int64, messages []*Message, err error) {
	return GetMessagesByUserAndAgentWithVisitor(eid, userID, agentID, keyword, fileID, "", limit, offset)
}

func GetMessagesByUserAndAgentWithVisitor(eid int64, userID int64, agentID int64, keyword string, fileID int64, visitorID string, limit int, offset int) (count int64, messages []*Message, err error) {
	query := DB.Model(&Message{}).Where("eid = ? AND user_id = ? AND agent_id = ?", eid, userID, agentID)
	query = applyVisitorMessageScope(query, visitorID)

	if keyword != "" {
		query = query.Where("message LIKE ? OR answer LIKE ?", "%"+keyword+"%", "%"+keyword+"%")
	}

	if fileID > 0 {
		query = query.Where("file_id = ?", fileID)
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

// GetMessagesByUserAndAgentSince 获取指定用户-智能体对中 id >= sinceID 的消息（按时间升序）
func GetMessagesByUserAndAgentSince(eid, userID, agentID, sinceID int64) ([]*Message, error) {
	var messages []*Message
	err := DB.Where("eid = ? AND user_id = ? AND agent_id = ? AND id >= ?", eid, userID, agentID, sinceID).
		Order("created_time ASC").
		Find(&messages).Error
	if err != nil {
		return nil, err
	}
	return messages, nil
}

func UpdateMessage(message *Message) error {
	return DB.Save(message).Error
}

func DeleteMessage(eid int64, id int64) error {
	return DB.Where("eid = ? AND id = ?", eid, id).Delete(&Message{}).Error
}

func DeleteMessagesByUserID(eid int64, userID int64) error {
	return DB.Where("eid = ? AND user_id = ?", eid, userID).Delete(&Message{}).Error
}

func DeleteMessagesByAgentID(eid int64, agentID int64) error {
	return DB.Where("eid = ? AND agent_id = ?", eid, agentID).Delete(&Message{}).Error
}

func GetMessagesByConversationID(eid int64, conversationID int64, keyword string, limit int, offset int) (count int64, messages []*Message, err error) {
	query := DB.Model(&Message{}).Where("eid =? AND conversation_id =?", eid, conversationID)
	if keyword != "" {
		query = query.Where("message LIKE? OR answer LIKE?", "%"+keyword+"%", "%"+keyword+"%")
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

func GetMessagesByConversationIDWithDirection(eid int64, conversationID int64, keyword string, limit, offset int, direction string) (count int64, messages []*Message, err error) {
	return GetMessagesByConversationIDWithDirectionWithVisitor(eid, conversationID, 0, keyword, "", limit, offset, direction)
}

func GetMessagesByConversationIDWithDirectionWithVisitor(eid int64, conversationID int64, userID int64, keyword string, visitorID string, limit, offset int, direction string) (count int64, messages []*Message, err error) {
	query := DB.Model(&Message{}).Where("eid =? AND conversation_id =?", eid, conversationID)
	if userID > 0 {
		query = query.Where("user_id = ?", userID)
	}
	query = applyVisitorMessageScope(query, visitorID)
	if keyword != "" {
		query = query.Where("message LIKE? OR answer LIKE?", "%"+keyword+"%", "%"+keyword+"%")
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
		query = query.Order("id ASC")
	} else {
		query = query.Order("id DESC")
	}

	err = query.Find(&messages).Error
	if err != nil {
		return 0, nil, err
	}

	return count, messages, nil
}

func GetMessagesList(eid int64, keyword string, thinkingMode, responseStatus, knowledgeType *int, startDate, endDate *int64, direction string, limit, offset int, agentID *int64, fileIDs []int64, sources []string) (count int64, messages []*Message, err error) {
	query := DB.Model(&Message{}).
		Joins("LEFT JOIN conversations ON conversations.conversation_id = messages.conversation_id AND conversations.eid = messages.eid").
		Where("messages.eid = ?", eid)

	if keyword != "" {
		query = query.Where("messages.original_question LIKE ? OR messages.rewritten_question LIKE ?", "%"+keyword+"%", "%"+keyword+"%")
	}

	if len(fileIDs) > 0 {
		query = query.Where("messages.file_id IN ?", fileIDs)
	}

	if thinkingMode != nil {
		query = query.Where("messages.thinking_mode = ?", *thinkingMode)
	}

	if responseStatus != nil {
		query = query.Where("messages.response_status = ?", *responseStatus)
	}

	if knowledgeType != nil {
		query = query.Where("messages.knowledge_type = ?", *knowledgeType)
	}

	if agentID != nil {
		query = query.Where("messages.agent_id = ?", *agentID)
	}

	if len(sources) > 0 {
		query = query.Where("messages.request_source IN ?", sources)
	}

	if startDate != nil {
		startTime := *startDate
		if startTime < 1e12 {
			startTime = startTime * 1000
		}
		query = query.Where("messages.created_time >= ?", startTime)
	}
	if endDate != nil {
		endTime := *endDate
		if endTime < 1e12 {
			endTime = endTime * 1000
		}
		query = query.Where("messages.created_time <= ?", endTime)
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
		query = query.Order("messages.created_time ASC")
	} else {
		query = query.Order("messages.created_time DESC")
	}

	err = query.Find(&messages).Error
	if err != nil {
		return 0, nil, err
	}

	return count, messages, nil
}
