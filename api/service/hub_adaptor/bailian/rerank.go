package bailian

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/gin-gonic/gin"
)

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
		Model: a.meta.ActualModelName,
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
	baseUrl := a.meta.BaseURL
	if baseUrl == "" {
		baseUrl = "https://dashscope.aliyuncs.com"
	}
	return fmt.Sprintf("%s/api/v1/services/rerank/text-rerank/text-rerank", baseUrl)
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
