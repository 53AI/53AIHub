package model

// 工具调用状态常量
const (
	ToolCallStatusPending = "pending" // 等待执行
	ToolCallStatusRunning = "running" // 执行中
	ToolCallStatusSuccess = "success" // 执行成功
	ToolCallStatusFailed  = "failed"  // 执行失败
)

// MessageToolCall 工具调用记录
type MessageToolCall struct {
	ID           int64  `json:"id" gorm:"column:id;primaryKey;autoIncrement"`
	Eid          int64  `json:"eid" gorm:"column:eid;not null;index"`
	MessageID    int64  `json:"message_id" gorm:"column:message_id;not null;index"`
	TurnNumber   int    `json:"turn_number" gorm:"column:turn_number;not null;default:0"`
	ToolName     string `json:"tool_name" gorm:"column:tool_name;size:100;not null;index"`
	ToolCallID   string `json:"tool_call_id" gorm:"column:tool_call_id;size:100;default:'';index"`
	FunctionName string `json:"function_name" gorm:"column:function_name;size:100;not null;index"`
	Arguments    string `json:"arguments" gorm:"column:arguments;type:text"`
	Status       string `json:"status" gorm:"column:status;size:20;not null;default:'pending';index"`
	Result       string `json:"result" gorm:"column:result;type:text"`
	ErrorMsg     string `json:"error_msg" gorm:"column:error_msg;type:text"`
	DurationMs   int64  `json:"duration_ms" gorm:"column:duration_ms;default:0"`
	SkillName    string `json:"skill_name" gorm:"column:skill_name;size:100;default:'';index"`
	ChannelID    int64  `json:"channel_id" gorm:"column:channel_id;default:0;index"`
	ModelName    string `json:"model_name" gorm:"column:model_name;size:100;default:'';index"`
	BaseModel
}

// TableName 指定表名
func (MessageToolCall) TableName() string {
	return "message_tool_call"
}

// CreateMessageToolCall 创建工具调用记录
func CreateMessageToolCall(toolCall *MessageToolCall) error {
	return DB.Create(toolCall).Error
}

// UpdateMessageToolCallResult 更新工具调用结果
func UpdateMessageToolCallResult(id int64, status string, result string, errorMsg string, durationMs int64) error {
	return DB.Model(&MessageToolCall{}).Where("id = ?", id).Updates(map[string]interface{}{
		"status":      status,
		"result":      result,
		"error_msg":   errorMsg,
		"duration_ms": durationMs,
	}).Error
}

// GetMessageToolCallsByMessageID 根据消息ID获取工具调用记录列表
func GetMessageToolCallsByMessageID(messageID int64) ([]*MessageToolCall, error) {
	var toolCalls []*MessageToolCall
	err := DB.Where("message_id = ?", messageID).Order("created_time ASC").Find(&toolCalls).Error
	if err != nil {
		return nil, err
	}
	return toolCalls, nil
}

// GetMessageToolCallsByMessageIDs 根据消息ID批量获取工具调用记录，并按 message_id 分组
func GetMessageToolCallsByMessageIDs(eid int64, messageIDs []int64) (map[int64][]*MessageToolCall, error) {
	grouped := make(map[int64][]*MessageToolCall, len(messageIDs))
	if len(messageIDs) == 0 {
		return grouped, nil
	}

	var toolCalls []*MessageToolCall
	err := DB.Where("eid = ? AND message_id IN ?", eid, messageIDs).
		Order("created_time ASC").
		Order("id ASC").
		Find(&toolCalls).Error
	if err != nil {
		return nil, err
	}

	for _, toolCall := range toolCalls {
		grouped[toolCall.MessageID] = append(grouped[toolCall.MessageID], toolCall)
	}
	return grouped, nil
}
