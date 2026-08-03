package yuanqi

// 顶层请求结构体
type YuanQiRequest struct {
	AssistantID string          `json:"assistant_id"`        // 助手ID（必选）
	Version     *int            `json:"version,omitempty"`   // 助手版本（可选，仅内部开放）
	UserID      string          `json:"user_id"`             // 用户ID（必选）
	Stream      bool            `json:"stream,omitempty"`    // 是否流式返回（可选，默认false）
	ChatType    string          `json:"chat_type,omitempty"` // 会话类型（可选，默认published）
	Messages    []YuanQiMessage `json:"messages"`            // 会话内容列表（必选，最多40条）
}

// 会话消息结构体
type YuanQiMessage struct {
	Role    string          `json:"role"`    // 角色（必选，'user'或'assistant'）
	Content []YuanQiContent `json:"content"` // 消息内容列表（必选）
}

// 消息内容结构体（支持文本或文件）
type YuanQiContent struct {
	Type    string   `json:"type,omitempty"`     // 内容类型（可选，'text'或'file_url'）
	Text    string   `json:"text,omitempty"`     // 文本内容（当type为text时使用）
	FileURL *FileURL `json:"file_url,omitempty"` // 文件信息（当type为file_url时使用）
}

// 文件URL信息结构体
type FileURL struct {
	Type string `json:"type,omitempty"` // 文件类型（如image/video/audio等）
	URL  string `json:"url,omitempty"`  // 文件URL地址
}

// 工具调用函数结构体
type ToolCallFunction struct {
	Name      string `json:"name"`
	Desc      string `json:"desc"`
	Type      string `json:"type"`
	Arguments string `json:"arguments"`
}

// 工具调用结构体
type ToolCall struct {
	ID       string           `json:"id"`
	Type     string           `json:"type"`
	Function ToolCallFunction `json:"function"`
}

// 使用情况结构体
type Usage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
}

// 步骤结构体
type Step struct {
	Role       string     `json:"role"`
	Content    string     `json:"content"`
	ToolCallID string     `json:"tool_call_id"`
	ToolCalls  []ToolCall `json:"tool_calls"`
	Usage      Usage      `json:"usage"`
	TimeCost   int64      `json:"time_cost"`
}

// 消息结构体
type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
	Steps   []Step `json:"steps"`
}

// Delta结构体
type Delta struct {
	Role      string     `json:"role"`
	Content   string     `json:"content"`
	ToolCalls []ToolCall `json:"tool_calls"`
	TimeCost  int64      `json:"time_cost"`
}

// 选择项结构体
type Choice struct {
	Index           int     `json:"index"`
	FinishReason    string  `json:"finish_reason"`
	Message         Message `json:"message"`
	Delta           Delta   `json:"delta"`
	ModerationLevel string  `json:"moderation_level"`
}

// 响应结构体
type Response struct {
	ID          string   `json:"id"`
	Created     int64    `json:"created"`
	Choices     []Choice `json:"choices"`
	AssistantID string   `json:"assistant_id"`
	Usage       Usage    `json:"usage"`
}
