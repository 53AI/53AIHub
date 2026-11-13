package dify

type StreamEventData struct {
	Status string `json:"status"`
	Error  string `json:"error"`
}

type StreamResponse struct {
	Event          string          `json:"event"`
	ConversationID string          `json:"conversation_id"`
	MessageID      string          `json:"message_id"`
	CreatedAt      int64           `json:"created_at"`
	TaskID         string          `json:"task_id"`
	ID             string          `json:"id"`
	Answer         string          `json:"answer"`
	Code           string          `json:"code"`
	Message        string          `json:"message"`
	Status         int             `json:"status"`
	Data           StreamEventData `json:"data"`
}

type Response struct {
	ConversationId string    `json:"conversation_id,omitempty"`
	Messages       []Message `json:"messages,omitempty"`
	Code           int       `json:"code,omitempty"`
	Msg            string    `json:"msg,omitempty"`
	Metadata       *Metadata `json:"metadata,omitempty"`
}

type Message struct {
	Role        string `json:"role"`
	Type        string `json:"type"`
	Content     string `json:"content"`
	ContentType string `json:"content_type"`
}

type BlockResponse struct {
	Event          string    `json:"event"`
	TaskID         string    `json:"task_id"`
	ID             string    `json:"id"`
	MessageID      string    `json:"message_id"`
	ConversationID string    `json:"conversation_id"`
	CreatedAt      int64     `json:"created_at"`
	Answer         string    `json:"answer"`
	Metadata       *Metadata `json:"metadata"`
}

type Metadata struct {
	Usage *Usage `json:"usage"`
}

type Usage struct {
	PromptTokens        int     `json:"prompt_tokens"`
	PromptUnitPrice     string  `json:"prompt_unit_price"`
	PromptPriceUnit     string  `json:"prompt_price_unit"`
	PromptPrice         string  `json:"prompt_price"`
	CompletionTokens    int     `json:"completion_tokens"`
	CompletionUnitPrice string  `json:"completion_unit_price"`
	CompletionPriceUnit string  `json:"completion_price_unit"`
	CompletionPrice     string  `json:"completion_price"`
	TotalTokens         int     `json:"total_tokens"`
	TotalPrice          string  `json:"total_price"`
	Currency            string  `json:"currency"`
	Latency             float64 `json:"latency"`
}

type DIFYUploadResponse struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Size      int64  `json:"size"`
	Extension string `json:"extension"`
	MimeType  string `json:"mime_type"`
	CreatedBy string `json:"created_by"`
	CreatedAt int64  `json:"created_at"`
}
