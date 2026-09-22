package model

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"gorm.io/gorm"
)

// GetRecentMessagesByConversationID returns the newest messages first so
// source-driven Action launches can snapshot the latest constraints and
// judgments without copying conversation content into an identity table.
func GetRecentMessagesByConversationID(ctx context.Context, eid, conversationID int64, limit int) ([]*Message, error) {
	if limit <= 0 {
		limit = 20
	}
	var messages []*Message
	err := DB.WithContext(ctx).
		Where("eid = ? AND conversation_id = ?", eid, conversationID).
		Order("created_time DESC, id DESC").Limit(limit).Find(&messages).Error
	return messages, err
}

type Message struct {
	ID                     int64  `json:"id" gorm:"column:id;primaryKey;autoIncrement"`
	Eid                    int64  `json:"eid" gorm:"column:eid;not null"`
	UserID                 int64  `json:"user_id" gorm:"column:user_id;not null"`
	Message                string `json:"message" gorm:"column:message;type:text"`
	AgentID                int64  `json:"agent_id" gorm:"column:agent_id;not null"`
	ConversationID         int64  `json:"conversation_id" gorm:"column:conversation_id;not null"`
	FileID                 int64  `json:"file_id" gorm:"column:file_id;default:0;index"`
	Answer                 string `json:"answer" gorm:"column:answer;type:text"`
	ReasoningContent       string `json:"reasoning_content" gorm:"column:reasoning_content;type:text"`
	ModelName              string `json:"model_name" gorm:"index;index:index_username_model_name,priority:1;size:255;default:''"`
	Quota                  int    `json:"quota" gorm:"default:0"`
	PromptTokens           int    `json:"prompt_tokens" gorm:"default:0"`
	CompletionTokens       int    `json:"completion_tokens" gorm:"default:0"`
	TotalTokens            int    `json:"total_tokens" gorm:"default:0"`
	ChannelId              int    `json:"channel" gorm:"index"`
	RequestId              string `json:"request_id" gorm:"size:255;default:''"`
	ElapsedTime            int64  `json:"elapsed_time" gorm:"default:0"`
	IsStream               bool   `json:"is_stream" gorm:"default:false"`
	QuotaContent           string `json:"quota_content" gorm:"size:2000;default:''"`
	AgentCustomConfig      string `json:"agent_custom_config" gorm:"size:2000;default:''"`
	RAGStats               string `json:"rag_stats,omitempty" gorm:"type:text"`
	ResponseStatus         int    `json:"response_status" gorm:"default:1;index"`
	ThinkingMode           int    `json:"thinking_mode" gorm:"default:1;index"`
	KnowledgeScope         string `json:"knowledge_scope" gorm:"size:255;default:'';index"`
	CitationCount          int    `json:"citation_count" gorm:"default:0;index"`
	KnowledgeType          int    `json:"knowledge_type" gorm:"default:0;index"`
	RequestSource          string `json:"request_source" gorm:"size:32;not null;default:'console'"`
	OriginalQuestion       string `json:"original_question" gorm:"type:text"`
	RewrittenQuestion      string `json:"rewritten_question" gorm:"type:text"`
	DocumentType           string `json:"document_type" gorm:"size:32;default:''"`
	DocumentID             int64  `json:"document_id" gorm:"default:0;index"`
	VisitorID              string `json:"visitor_id" gorm:"size:64;default:''"`
	OpenClawProjectionKey  string `json:"-" gorm:"column:openclaw_projection_key;size:255;default:''"`
	OpenClawTurnID         string `json:"-" gorm:"column:openclaw_turn_id;size:255;default:''"`
	OpenClawSeqStart       int64  `json:"-" gorm:"column:openclaw_seq_start;default:0"`
	OpenClawSeqEnd         int64  `json:"-" gorm:"column:openclaw_seq_end;default:0"`
	OpenClawStatus         string `json:"-" gorm:"column:openclaw_status;size:32;default:''"`
	OpenClawProjectionJSON string `json:"-" gorm:"column:openclaw_projection_json;type:text"`
	CreatedTime            int64  `json:"created_time" gorm:"not null"`
	UpdatedTime            int64  `json:"updated_time" gorm:"not null"`
}

// MessageType 消息类型枚举
type MessageType string

const (
	MessageTypeChat     MessageType = "chat"     // 聊天消息
	MessageTypeWorkflow MessageType = "workflow" // 工作流消息
)

const (
	ResponseStatusNormal       = 1
	ResponseStatusReject       = 2
	ThinkingModeQuick          = 1
	ThinkingModeDeep           = 2

	// KnowledgeType 按「对话开启的查询范围组合」判定，与消息列表筛选互斥对应：
	// 0=未启用知识查询，1=知识文档(全部知识库)，2=联网搜索，3=指定知识库/空间，
	// 4=单文件，5=知识文档+动态知识，6=动态知识(全部Wiki)，7=指定Wiki，
	// 8=知识文档+知识图谱，9=知识文档+动态知识+知识图谱，10=其他组合(仅全部可见)
	KnowledgeTypeNone           = 0
	KnowledgeTypeDatabase       = 1
	KnowledgeTypeWeb            = 2
	KnowledgeTypeSpecificKB     = 3
	KnowledgeTypeSingleFile     = 4
	KnowledgeTypeKBDynamic      = 5
	KnowledgeTypeAllWiki        = 6
	KnowledgeTypeSpecificWiki   = 7
	KnowledgeTypeKBGraph        = 8
	KnowledgeTypeKBDynamicGraph = 9
	KnowledgeTypeOther          = 10
)

const (
	MessageRequestSourceConsole = "console"
	MessageRequestSourceAPI     = "api"
	MessageRequestSourceH5      = "h5"
)

func normalizeMessageRequestSource(source string) string {
	source = strings.TrimSpace(source)
	if source == "" {
		return MessageRequestSourceConsole
	}
	return source
}

func (m *Message) BeforeSave(tx *gorm.DB) error {
	m.RequestSource = normalizeMessageRequestSource(m.RequestSource)
	return nil
}

func (m *Message) AfterFind(tx *gorm.DB) error {
	m.RequestSource = normalizeMessageRequestSource(m.RequestSource)
	return nil
}

func (m *Message) BeforeCreate(tx *gorm.DB) error {
	now := time.Now().UTC().UnixMilli()
	if m.CreatedTime == 0 {
		m.CreatedTime = now
	}
	if m.UpdatedTime == 0 {
		m.UpdatedTime = now
	}
	return nil
}

func (m *Message) BeforeUpdate(tx *gorm.DB) error {
	m.UpdatedTime = time.Now().UTC().UnixMilli()
	return nil
}

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
func GetMessagesByUserAndAgent(eid int64, userID int64, agentID int64, keyword string, args ...interface{}) (count int64, messages []*Message, err error) {
	fileID, limit, offset := 0, 0, 0
	if len(args) >= 3 {
		fileID = intFromMessageArg(args[0])
		limit = intFromMessageArg(args[1])
		offset = intFromMessageArg(args[2])
	} else if len(args) >= 2 {
		limit = intFromMessageArg(args[0])
		offset = intFromMessageArg(args[1])
	}

	return getMessagesByUserAndAgent(eid, userID, agentID, keyword, fileID, "", 0, limit, offset)
}

// GetMessagesByUserAndAgentWithDocument retrieves messages filtered by a document reference.
func GetMessagesByUserAndAgentWithDocument(eid, userID, agentID int64, keyword, documentType string, documentID int64, visitorID string, limit, offset int) (int64, []*Message, error) {
	return getMessagesByUserAndAgent(eid, userID, agentID, keyword, 0, documentType, documentID, limit, offset)
}

func getMessagesByUserAndAgent(eid, userID, agentID int64, keyword string, fileID int, documentType string, documentID int64, limit, offset int) (count int64, messages []*Message, err error) {
	query := DB.Model(&Message{}).Where("eid = ? AND user_id = ? AND agent_id = ?", eid, userID, agentID)
	if keyword != "" {
		query = query.Where("message LIKE ? OR answer LIKE ?", "%"+keyword+"%", "%"+keyword+"%")
	}
	if documentID > 0 && documentType != "" {
		query = query.Where("document_type = ? AND document_id = ?", documentType, documentID)
	} else if fileID > 0 {
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

	err = query.Find(&messages).Error
	if err != nil {
		return 0, nil, err
	}

	return count, messages, nil
}

func intFromMessageArg(value interface{}) int {
	switch typed := value.(type) {
	case int:
		return typed
	case int64:
		return int(typed)
	case int32:
		return int(typed)
	default:
		return 0
	}
}

func GetMessagesByUserAndAgentWithVisitor(eid, userID, agentID int64, keyword string, fileID int64, visitorID string, limit, offset int) (int64, []*Message, error) {
	return GetMessagesByUserAndAgent(eid, userID, agentID, keyword, fileID, limit, offset)
}

func GetMessagesByUserAndAgentSince(eid, userID, agentID, sinceID int64) ([]*Message, error) {
	var messages []*Message
	err := DB.Where("eid = ? AND user_id = ? AND agent_id = ? AND id >= ?", eid, userID, agentID, sinceID).
		Order("id ASC").Find(&messages).Error
	return messages, err
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

	err = query.Find(&messages).Order("created_time DESC").Error
	if err != nil {
		return 0, nil, err
	}
	return count, messages, nil
}

// GetMessagesByConversationIDWithDirection retrieves conversation messages by conversation ID with direction control
func GetMessagesByConversationIDWithDirection(eid int64, conversationID int64, keyword string, limit, offset int, direction string) (count int64, messages []*Message, err error) {
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

func GetMessagesByConversationIDWithDirectionWithVisitor(eid, conversationID, userID int64, keyword, visitorID string, limit, offset int, direction string) (int64, []*Message, error) {
	return GetMessagesByConversationIDWithDirection(eid, conversationID, keyword, limit, offset, direction)
}

func GetMessagesList(eid int64, keyword string, thinkingMode, responseStatus *int, knowledgeTypes []int, startDate, endDate *int64, direction string, limit, offset int, agentID *int64, fileIDs []int64, sources []string) (count int64, messages []*Message, err error) {
	query := DB.Model(&Message{}).Where("eid = ?", eid)
	if keyword != "" {
		query = query.Where("message LIKE ? OR answer LIKE ?", "%"+keyword+"%", "%"+keyword+"%")
	}
	if thinkingMode != nil {
		query = query.Where("thinking_mode = ?", *thinkingMode)
	}
	if responseStatus != nil {
		query = query.Where("response_status = ?", *responseStatus)
	}
	if len(knowledgeTypes) > 0 {
		query = query.Where("knowledge_type IN ?", knowledgeTypes)
	}
	if startDate != nil && *startDate > 0 {
		query = query.Where("created_time >= ?", *startDate)
	}
	if endDate != nil && *endDate > 0 {
		query = query.Where("created_time <= ?", *endDate)
	}
	if agentID != nil && *agentID > 0 {
		query = query.Where("agent_id = ?", *agentID)
	}
	if len(fileIDs) > 0 {
		query = query.Where("file_id IN ?", fileIDs)
	}
	if len(sources) > 0 {
		query = query.Where("request_source IN ?", sources)
	}
	if err = query.Count(&count).Error; err != nil {
		return 0, nil, err
	}
	if limit <= 0 {
		limit = 10
	}
	query = query.Limit(limit).Offset(offset)
	if direction == "asc" {
		query = query.Order("created_time ASC")
	} else {
		query = query.Order("created_time DESC")
	}
	err = query.Find(&messages).Error
	return count, messages, err
}
