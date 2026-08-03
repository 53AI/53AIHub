package custom

type CustomConfig struct {
	UserId                     string                   `json:"user_id,omitempty"`
	ConversationId             string                   `json:"conversation_id,omitempty"`
	ConversationExpirationTime int64                    `json:"conversation_expire,omitempty"`
	AIHubConversationId        int64                    `json:"53AIHub_conversation_id,omitempty"`
	WorkflowParams             map[string]WorkflowParam `json:"workflow_params,omitempty"`
	DisableThinking            *bool                    `json:"disable_thinking,omitempty"`
}

// WorkflowParam 工作流参数配置
type WorkflowParam struct {
	Source string `json:"source"` // 参数来源: "user_input", "static", "duplicate"
	Value  string `json:"value"`  // 静态值（当 source 为 "static" 时使用）
}
