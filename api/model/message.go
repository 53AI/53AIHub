package model

import "encoding/json"

type Message struct {
	ID                int64  `json:"id" gorm:"column:id;primaryKey;autoIncrement"`
	Eid               int64  `json:"eid" gorm:"column:eid;not null"`
	UserID            int64  `json:"user_id" gorm:"column:user_id;not null"`
	Message           string `json:"message" gorm:"column:message;type:text"`
	AgentID           int64  `json:"agent_id" gorm:"column:agent_id;not null"`
	ConversationID    int64  `json:"conversation_id" gorm:"column:conversation_id;not null"`
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
	RAGStats          string `json:"rag_stats,omitempty" gorm:"type:text"` // RAG检索统计数据，JSON格式，包含知识库搜索、文档检索(含完整分片信息)、性能等统计信息
	// 新增字段
	ResponseStatus    int    `json:"response_status" gorm:"default:1;index"`           // 回答状态：1=正常回答，2=拒答/超纲回复
	ThinkingMode      int    `json:"thinking_mode" gorm:"default:1;index"`             // 思考方式：1=快速回答，2=深度思考
	KnowledgeScope    string `json:"knowledge_scope" gorm:"size:255;default:'';index"` // 知识范围
	CitationCount     int    `json:"citation_count" gorm:"default:0;index"`            // 引用数量
	KnowledgeType     int    `json:"knowledge_type" gorm:"default:1;index"`            // 知识类型：1=知识库搜索，2=Web搜索， 3=指定知识库
	OriginalQuestion  string `json:"original_question" gorm:"type:text"`               // 原始问题（问题改写功能使用）
	RewrittenQuestion string `json:"rewritten_question" gorm:"type:text"`              // 改写后的问题（问题改写功能使用）
	Media             string `json:"media" gorm:"type:text"`
	BaseModel
}

// MessageType 消息类型枚举
type MessageType string

const (
	MessageTypeChat     MessageType = "chat"     // 聊天消息
	MessageTypeWorkflow MessageType = "workflow" // 工作流消息
)

// ResponseStatus 回答状态枚举
const (
	ResponseStatusNormal = 1 // 正常回答
	ResponseStatusReject = 2 // 拒答/超纲回复
)

// ThinkingMode 思考方式枚举
const (
	ThinkingModeQuick = 1 // 快速回答
	ThinkingModeDeep  = 2 // 深度思考
)

// KnowledgeType 知识类型枚举
const (
	KnowledgeTypeDatabase   = 1 // 知识库搜索
	KnowledgeTypeWeb        = 2 // Web搜索
	KnowledgeTypeSpecificKB = 3 // 指定知识库
	KnowledgeTypeSingleFile = 4 // 单文件模式
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
func GetMessagesByUserAndAgent(eid int64, userID int64, agentID int64, keyword string, fileID int64, limit int, offset int) (count int64, messages []*Message, err error) {
	query := DB.Model(&Message{}).Where("eid = ? AND user_id = ? AND agent_id = ?", eid, userID, agentID)

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

	err = query.Order("created_time DESC").Find(&messages).Error
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

// GetMessagesList 获取消息列表，支持多种筛选和排序
func GetMessagesList(eid int64, keyword string, thinkingMode, responseStatus, knowledgeType *int, startDate, endDate *int64, direction string, limit, offset int, agentID *int64, fileIDs []int64) (count int64, messages []*Message, err error) {
	query := DB.Model(&Message{}).
		// 使用 LEFT JOIN 以保留没有会话关联的后台消息，例如知识地图生成消息。
		Joins("LEFT JOIN conversations ON conversations.conversation_id = messages.conversation_id AND conversations.eid = messages.eid").
		Where("messages.eid = ?", eid).
		Where("(conversations.conversation_type IS NULL OR conversations.conversation_type <> ?)", ConversationTypeDebug)

	// 关键词筛选
	if keyword != "" {
		query = query.Where("messages.original_question LIKE ? OR messages.rewritten_question LIKE ?", "%"+keyword+"%", "%"+keyword+"%")
	}

	// 文件ID过滤
	if len(fileIDs) > 0 {
		query = query.Where("messages.file_id IN ?", fileIDs)
	}

	// 思考方式筛选
	if thinkingMode != nil {
		query = query.Where("messages.thinking_mode = ?", *thinkingMode)
	}

	// 回答状态筛选
	if responseStatus != nil {
		query = query.Where("messages.response_status = ?", *responseStatus)
	}

	// 知识类型筛选
	if knowledgeType != nil {
		query = query.Where("messages.knowledge_type = ?", *knowledgeType)
	}

	// Agent ID 筛选
	if agentID != nil {
		query = query.Where("messages.agent_id = ?", *agentID)
	}

	// 日期范围筛选
	if startDate != nil {
		// 判断是否为秒级时间戳（小于10^12，即小于公元2001年9月9日）
		// 如果是秒级时间戳，转换为毫秒级
		startTime := *startDate
		if startTime < 1e12 {
			startTime = startTime * 1000
		}
		query = query.Where("messages.created_time >= ?", startTime)
	}
	if endDate != nil {
		// 判断是否为秒级时间戳（小于10^12，即小于公元2001年9月9日）
		// 如果是秒级时间戳，转换为毫秒级
		endTime := *endDate
		if endTime < 1e12 {
			endTime = endTime * 1000
		}
		query = query.Where("messages.created_time <= ?", endTime)
	}

	// 获取总数
	countQuery := query
	if err = countQuery.Count(&count).Error; err != nil {
		return 0, nil, err
	}

	// 设置分页
	if limit == 0 {
		limit = 10
	}
	query = query.Limit(limit)
	if offset > 0 {
		query = query.Offset(offset)
	}

	// 设置排序
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
