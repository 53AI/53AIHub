package bailian

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/gin-gonic/gin"
)

const RerankEndpointPath = "/api/v1/services/rerank/text-rerank/text-rerank"

// NormalizeRerankModel converts the product-facing alias to the model id
// accepted by DashScope. The alias is kept in our config and response model.
func NormalizeRerankModel(model string) string {
	if strings.EqualFold(strings.TrimSpace(model), "qwen-gte-rerank-v2") {
		return "gte-rerank-v2"
	}
	return model
}

func RerankURL(baseURL string) string {
	baseURL = strings.TrimSpace(strings.TrimRight(baseURL, "/"))
	if baseURL == "" {
		baseURL = "https://dashscope.aliyuncs.com"
	}
	if strings.HasSuffix(baseURL, RerankEndpointPath) {
		return baseURL
	}
	// DashScope 的 OpenAI 兼容接口通常配置为
	// https://dashscope.aliyuncs.com/compatible-mode/v1。重排使用原生
	// /api/v1 接口，不能把这段兼容模式路径再次拼到原生路径前。
	if parsed, err := url.Parse(baseURL); err == nil && parsed.Scheme != "" && parsed.Host != "" {
		if strings.HasSuffix(strings.TrimRight(parsed.Path, "/"), "/compatible-mode/v1") {
			parsed.Path = strings.TrimSuffix(strings.TrimRight(parsed.Path, "/"), "/compatible-mode/v1")
			parsed.RawPath = ""
			parsed.RawQuery = ""
			parsed.Fragment = ""
			baseURL = strings.TrimRight(parsed.String(), "/")
		}
	}
	return baseURL + RerankEndpointPath
}

// CallRerankAPI is the shared DashScope text-rerank transport used by both
// the channel test and the RAG pipeline. client is injectable for tests.
func CallRerankAPI(ctx context.Context, client *http.Client, baseURL, apiKey string, request *BailianRerankRequest) (*BailianRerankResponse, error) {
	if request == nil {
		return nil, fmt.Errorf("rerank request is nil")
	}
	if request.Input.Query == "" {
		return nil, fmt.Errorf("rerank query is required")
	}
	if len(request.Input.Documents) == 0 {
		return nil, fmt.Errorf("rerank documents are required")
	}

	requestCopy := *request
	requestCopy.Model = NormalizeRerankModel(request.Model)
	body, err := json.Marshal(&requestCopy)
	if err != nil {
		return nil, fmt.Errorf("marshal rerank request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, RerankURL(baseURL), bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create rerank request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+apiKey)
	httpReq.Header.Set("X-DashScope-SSE", "disable")

	if client == nil {
		client = &http.Client{Timeout: 60 * time.Second}
	}
	resp, err := client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("execute rerank request: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read rerank response: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("rerank request failed with status %d: %s", resp.StatusCode, strings.TrimSpace(string(respBody)))
	}

	var result BailianRerankResponse
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("decode rerank response: %w", err)
	}
	if len(result.Output.Results) == 0 {
		return nil, fmt.Errorf("rerank response contains no results")
	}
	return &result, nil
}

// RerankRequest 定义 rerank 请求结构
type RerankRequest struct {
	Model      string   `json:"model"`
	Query      string   `json:"query"`
	Documents  []string `json:"documents"`
	TopN       *int     `json:"top_n,omitempty"`
	ReturnDocs *bool    `json:"return_documents,omitempty"`
}

// ConvertToRerankRequest 将 rerank 请求转换为百炼格式
func (a *Adaptor) ConvertToRerankRequest(request *RerankRequest) (*BailianRerankRequest, error) {
	if request.Query == "" {
		return nil, fmt.Errorf("query is required for rerank")
	}

	if len(request.Documents) == 0 {
		return nil, fmt.Errorf("documents are required for rerank")
	}

	rerankRequest := &BailianRerankRequest{
		Model: NormalizeRerankModel(a.meta.ActualModelName),
		Input: BailianRerankInput{
			Query:     request.Query,
			Documents: request.Documents,
		},
	}

	// 设置参数
	if request.TopN != nil || request.ReturnDocs != nil {
		rerankRequest.Parameters = BailianRerankParameters{
			TopN:            request.TopN,
			ReturnDocuments: request.ReturnDocs,
		}
	}

	return rerankRequest, nil
}

// GetRerankURL 获取百炼 rerank API URL
func (a *Adaptor) GetRerankURL() string {
	return RerankURL(a.meta.BaseURL)
}

// DoRerankRequest 执行 rerank 请求
func (a *Adaptor) DoRerankRequest(c *gin.Context, request *BailianRerankRequest) (*http.Response, error) {
	requestBody, err := json.Marshal(request)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal rerank request: %v", err)
	}

	url := a.GetRerankURL()
	req, err := http.NewRequestWithContext(c.Request.Context(), "POST", url, bytes.NewBuffer(requestBody))
	if err != nil {
		return nil, fmt.Errorf("failed to create rerank request: %v", err)
	}

	// 设置请求头
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", a.meta.APIKey))
	req.Header.Set("X-DashScope-SSE", "disable")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to execute rerank request: %v", err)
	}

	return resp, nil
}

// ProcessRerankResponse 处理百炼 rerank 响应
func (a *Adaptor) ProcessRerankResponse(resp *http.Response) (*OpenAIRerankResponse, error) {
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read rerank response: %v", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("rerank request failed with status %d: %s", resp.StatusCode, string(body))
	}

	var bailianResp BailianRerankResponse
	if err := json.Unmarshal(body, &bailianResp); err != nil {
		return nil, fmt.Errorf("failed to decode rerank response: %v", err)
	}

	// 转换为 OpenAI 兼容格式
	openaiResp := &OpenAIRerankResponse{
		Object: "list",
		Model:  a.meta.ActualModelName,
		Data:   make([]OpenAIRerankResult, len(bailianResp.Output.Results)),
		Usage: &OpenAIRerankUsage{
			TotalTokens: bailianResp.Usage.TotalTokens,
		},
	}

	for i, result := range bailianResp.Output.Results {
		openaiResult := OpenAIRerankResult{
			Object:         "rerank_result",
			Index:          result.Index,
			RelevanceScore: result.RelevanceScore,
		}

		if result.Document != nil {
			openaiResult.Document = &OpenAIRerankDocument{
				Text: result.Document.Text,
			}
		}

		openaiResp.Data[i] = openaiResult
	}

	return openaiResp, nil
}

// HandleRerankRequest 处理完整的 rerank 请求流程
func (a *Adaptor) HandleRerankRequest(c *gin.Context, request *RerankRequest) error {
	ctx := c.Request.Context()

	// 转换请求格式
	rerankRequest, err := a.ConvertToRerankRequest(request)
	if err != nil {
		logger.Errorf(ctx, "failed to convert rerank request: %v", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return err
	}

	// 执行请求
	resp, err := a.DoRerankRequest(c, rerankRequest)
	if err != nil {
		logger.Errorf(ctx, "failed to execute rerank request: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return err
	}

	// 处理响应
	openaiResp, err := a.ProcessRerankResponse(resp)
	if err != nil {
		logger.Errorf(ctx, "failed to process rerank response: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return err
	}

	// 返回响应
	c.JSON(http.StatusOK, openaiResp)
	return nil
}

// ParseRerankRequest 从 gin.Context 中解析 rerank 请求
func ParseRerankRequest(c *gin.Context) (*RerankRequest, error) {
	var request RerankRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		return nil, fmt.Errorf("failed to parse rerank request: %v", err)
	}

	// 验证必需字段
	if request.Query == "" {
		return nil, fmt.Errorf("query is required")
	}

	if len(request.Documents) == 0 {
		return nil, fmt.Errorf("documents are required")
	}

	return &request, nil
}

// IsRerankModel 检查是否为 rerank 模型
func (a *Adaptor) IsRerankModel(modelName string) bool {
	// 使用模型目录加载器判断是否为 rerank 模型
	loader := common.GetModelCatalogLoader()
	return loader.IsRerankModel(modelName)
}
