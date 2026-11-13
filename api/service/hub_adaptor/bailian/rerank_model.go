package bailian

// Rerank 请求结构 - 百炼格式
type BailianRerankRequest struct {
	Model      string                  `json:"model"`
	Input      BailianRerankInput      `json:"input"`
	Parameters BailianRerankParameters `json:"parameters,omitempty"`
}

type BailianRerankInput struct {
	Query     string   `json:"query"`
	Documents []string `json:"documents"`
}

type BailianRerankParameters struct {
	TopN            *int   `json:"top_n,omitempty"`
	ReturnDocuments *bool  `json:"return_documents,omitempty"`
	Instruct        string `json:"instruct,omitempty"`
}

// Rerank 响应结构 - 百炼格式
type BailianRerankResponse struct {
	Output    BailianRerankOutput `json:"output"`
	Usage     RerankUsage         `json:"usage"`
	RequestID string              `json:"request_id"`
}

type BailianRerankOutput struct {
	Results []BailianRerankResult `json:"results"`
}

type BailianRerankResult struct {
	Document       *BailianRerankDocument `json:"document,omitempty"`
	Index          int                    `json:"index"`
	RelevanceScore float64                `json:"relevance_score"`
}

type BailianRerankDocument struct {
	Text string `json:"text"`
}

type RerankUsage struct {
	TotalTokens int `json:"total_tokens"`
}

// 统一 Rerank 响应格式 - OpenAI 兼容
type OpenAIRerankResponse struct {
	Object string               `json:"object"`
	Data   []OpenAIRerankResult `json:"data"`
	Model  string               `json:"model"`
	Usage  *OpenAIRerankUsage   `json:"usage,omitempty"`
}

type OpenAIRerankResult struct {
	Object         string                `json:"object"`
	Index          int                   `json:"index"`
	RelevanceScore float64               `json:"relevance_score"`
	Document       *OpenAIRerankDocument `json:"document,omitempty"`
}

type OpenAIRerankDocument struct {
	Text string `json:"text"`
}

type OpenAIRerankUsage struct {
	TotalTokens int `json:"total_tokens"`
}
