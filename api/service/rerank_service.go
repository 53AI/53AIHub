package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/helper"
	"github.com/songquanpeng/one-api/relay/channeltype"
	"github.com/songquanpeng/one-api/relay/meta"
	relay_model "github.com/songquanpeng/one-api/relay/model"
)

const (
	SiliconFlowBaseURL  = "https://api.siliconflow.cn"
	SiliconFlowEndpoint = "/v1/rerank"

	BaiduQianfanBaseURL  = "https://qianfan.baidubce.com"
	BaiduQianfanEndpoint = "/v2/rerank"
)

// RerankRequest 与 controller 中的 RerankRequest 结构相同
type RerankRequest struct {
	Model           string   `json:"model" example:"gte-rerank-v2" binding:"required"`
	Query           string   `json:"query" example:"人工智能的发展历程" binding:"required"`
	Documents       []string `json:"documents" example:"[\"人工智能起源于1950年代，图灵提出了著名的图灵测试\",\"深度学习是机器学习的一个分支，使用神经网络进行学习\",\"自然语言处理是人工智能的重要应用领域之一\"]" binding:"required"`
	TopN            *int     `json:"top_n,omitempty" example:"3"`
	ReturnDocuments *bool    `json:"return_documents,omitempty" example:"true"`
}

// RerankResponse 与 controller 中的 RerankResponse 结构相同
type RerankResponse struct {
	Object string         `json:"object" example:"list"`
	Data   []RerankResult `json:"data"`
	Model  string         `json:"model" example:"gte-rerank-v2"`
	Usage  RerankUsage    `json:"usage"`
}

// RerankResult 与 controller 中的 RerankResult 结构相同
type RerankResult struct {
	Object         string          `json:"object" example:"rerank_result"`
	Index          int             `json:"index" example:"0"`
	RelevanceScore float64         `json:"relevance_score" example:"0.95"`
	Document       *RerankDocument `json:"document,omitempty"`
}

// RerankDocument 与 controller 中的 RerankDocument 结构相同
type RerankDocument struct {
	Text string `json:"text" example:"文档内容"`
}

// RerankUsage 与 controller 中的 RerankUsage 结构相同
type RerankUsage struct {
	TotalTokens int `json:"total_tokens" example:"150"`
}

// OpenAIRerankResponse 与 OpenAI API 格式兼容的响应结构
type OpenAIRerankResponse struct {
	Object string         `json:"object"`
	Data   []RerankResult `json:"data"`
	Model  string         `json:"model"`
	Usage  RerankUsage    `json:"usage"`
}

// OpenAIRerankResult 与 OpenAI API 格式兼容的结果结构
type OpenAIRerankResult struct {
	Object         string          `json:"object"`
	Index          int             `json:"index"`
	RelevanceScore float64         `json:"relevance_score"`
	Document       *RerankDocument `json:"document,omitempty"`
}

// OpenAIRerankDocument 与 OpenAI API 格式兼容的文档结构
type OpenAIRerankDocument struct {
	Text string `json:"text"`
}

// OpenAIRerankUsage 与 OpenAI API 格式兼容的用量结构
type OpenAIRerankUsage struct {
	TotalTokens int `json:"total_tokens"`
}

// OpenAIService 处理 OpenAI rerank API 调用的服务
type OpenAIService struct{}

// BailianRerankService 处理百炼 rerank API 调用的服务
type BailianRerankService struct{}

// SiliconFlowRerankService 处理硅基流动 rerank API 调用的服务
type SiliconFlowRerankService struct{}

// BaiduQianfanRerankService 处理百度千帆 rerank API 调用的服务
type BaiduQianfanRerankService struct{}

// commonAPICall 是通用的 API 调用函数
func commonAPICall(ctx context.Context, req *RerankRequest, meta *meta.Meta,
	baseURL, endpoint, platformName string) (*RerankResponse, *relay_model.Usage, error) {

	// 构建请求体
	requestData := map[string]interface{}{
		"model":     req.Model,
		"query":     req.Query,
		"documents": req.Documents,
	}

	// 添加可选参数
	if req.TopN != nil {
		requestData["top_n"] = *req.TopN
	}
	if req.ReturnDocuments != nil {
		requestData["return_documents"] = *req.ReturnDocuments
	}

	requestBody, err := json.Marshal(requestData)
	if err != nil {
		return nil, nil, fmt.Errorf("序列化请求失败: %v", err)
	}

	// 构建请求 URL
	url := fmt.Sprintf("%s%s", baseURL, endpoint)

	// 详细的请求日志
	logger.SysLogf("🚀 %s Rerank API请求开始", platformName)
	logger.SysLogf("┌─────────────────────────────────────────────────────────────")
	logger.SysLogf("│ 📡 请求URL: %s", url)
	logger.SysLogf("│ 🔑 API Key: %s", helper.MaskAPIKey(meta.APIKey))
	logger.SysLogf("│ 🤖 模型名称: %s", req.Model)
	logger.SysLogf("│ 📝 请求方法: POST")
	logger.SysLogf("│ 📊 查询长度: %d 字符", len(req.Query))
	logger.SysLogf("│ 📚 文档数量: %d", len(req.Documents))
	if req.TopN != nil {
		logger.SysLogf("│ 🎯 TopN: %d", *req.TopN)
	}
	if req.ReturnDocuments != nil {
		logger.SysLogf("│ 📄 返回文档: %v", *req.ReturnDocuments)
	}
	logger.SysLogf("└─────────────────────────────────────────────────────────────")

	// 创建HTTP请求
	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(requestBody))
	if err != nil {
		logger.SysErrorf("❌ 创建HTTP请求失败: %v", err)
		return nil, nil, fmt.Errorf("创建请求失败: %v", err)
	}

	// 设置请求头
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+meta.APIKey)

	// 发送请求
	client := &http.Client{}
	resp, err := client.Do(httpReq)
	if err != nil {
		logger.SysErrorf("❌ %s Rerank请求失败: %v", platformName, err)
		return nil, nil, fmt.Errorf("发送请求失败: %v", err)
	}
	defer resp.Body.Close()

	logger.SysLogf("✅ %s Rerank请求完成 - 状态码: %d", platformName, resp.StatusCode)

	// 检查响应状态
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		logger.SysErrorf("❌ %s Rerank请求失败 - 状态码: %d, 响应: %s", platformName, resp.StatusCode, string(body))
		return nil, nil, fmt.Errorf("请求失败，状态码: %d", resp.StatusCode)
	}

	// 读取响应体
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		logger.SysErrorf("❌ 读取响应体失败: %v", err)
		return nil, nil, fmt.Errorf("读取响应体失败: %v", err)
	}

	// 转换为标准格式
	openaiResp := &RerankResponse{
		Object: "list",
		Model:  req.Model,
		Usage:  RerankUsage{TotalTokens: 0}, // 根据实际响应填充
	}

	// 根据平台类型解析响应

	switch platformName {
	case "硅基流动":
		var siliconFlowResp struct {
			Id      string `json:"id"`
			Object  string `json:"object"`
			Created int64  `json:"created"`
			Model   string `json:"model"`
			Results []struct {
				Document *struct {
					Text string `json:"text"`
				} `json:"document"`
				Index          int     `json:"index"`
				RelevanceScore float64 `json:"relevance_score"`
			} `json:"results"`
			Meta interface{} `json:"meta"`
		}

		if err := json.Unmarshal(respBody, &siliconFlowResp); err != nil {
			logger.SysErrorf("❌ 解析硅基流动Rerank响应失败: %v", err)
			return nil, nil, fmt.Errorf("解析响应失败: %v", err)
		}

		openaiResp.Data = make([]RerankResult, len(siliconFlowResp.Results))
		for i, result := range siliconFlowResp.Results {
			openaiResult := RerankResult{
				Object:         "rerank_result",
				Index:          result.Index,
				RelevanceScore: result.RelevanceScore,
			}

			if req.ReturnDocuments != nil && *req.ReturnDocuments {
				if result.Document != nil {
					openaiResult.Document = &RerankDocument{
						Text: result.Document.Text,
					}
				}
			} else if req.ReturnDocuments == nil {
				if result.Document != nil {
					openaiResult.Document = &RerankDocument{
						Text: result.Document.Text,
					}
				}
			}

			openaiResp.Data[i] = openaiResult
		}

		// 从 meta 中提取 token 信息
		totalTokens := 0
		if metaMap, ok := siliconFlowResp.Meta.(map[string]interface{}); ok {
			if tokens, exists := metaMap["tokens"]; exists {
				if tokenMap, ok := tokens.(map[string]interface{}); ok {
					if inputTokens, exists := tokenMap["input_tokens"]; exists {
						if val, ok := inputTokens.(float64); ok {
							totalTokens += int(val)
						}
					}
					if outputTokens, exists := tokenMap["output_tokens"]; exists {
						if val, ok := outputTokens.(float64); ok {
							totalTokens += int(val)
						}
					}
				}
			}
		} else if metaSlice, ok := siliconFlowResp.Meta.([]interface{}); ok {
			for _, item := range metaSlice {
				if itemMap, ok := item.(map[string]interface{}); ok {
					if tokens, exists := itemMap["tokens"]; exists {
						if tokenMap, ok := tokens.(map[string]interface{}); ok {
							if inputTokens, exists := tokenMap["input_tokens"]; exists {
								if val, ok := inputTokens.(float64); ok {
									totalTokens += int(val)
								}
							}
							if outputTokens, exists := tokenMap["output_tokens"]; exists {
								if val, ok := outputTokens.(float64); ok {
									totalTokens += int(val)
								}
							}
						}
					}
				}
			}
		}
		openaiResp.Usage.TotalTokens = totalTokens

	case "百度千帆":
		var qianfanResp struct {
			Id      string `json:"id"`
			Object  string `json:"object"`
			Created int64  `json:"created"`
			Model   string `json:"model"`
			Results []struct {
				Document       string  `json:"document"`
				Index          int     `json:"index"`
				RelevanceScore float64 `json:"relevance_score"`
			} `json:"results"`
			Usage struct {
				PromptTokens     int `json:"prompt_tokens"`
				TotalTokens      int `json:"total_tokens"`
				CompletionTokens int `json:"completion_tokens"`
			} `json:"usage"`
		}

		if err := json.Unmarshal(respBody, &qianfanResp); err != nil {
			logger.SysErrorf("❌ 解析百度千帆Rerank响应失败: %v", err)
			return nil, nil, fmt.Errorf("解析响应失败: %v", err)
		}

		openaiResp.Data = make([]RerankResult, len(qianfanResp.Results))
		for i, result := range qianfanResp.Results {
			openaiResult := RerankResult{
				Object:         "rerank_result",
				Index:          result.Index,
				RelevanceScore: result.RelevanceScore,
			}

			if req.ReturnDocuments != nil && *req.ReturnDocuments {
				openaiResult.Document = &RerankDocument{
					Text: result.Document,
				}
			} else if req.ReturnDocuments == nil {
				openaiResult.Document = &RerankDocument{
					Text: result.Document,
				}
			}

			openaiResp.Data[i] = openaiResult
		}

		openaiResp.Model = qianfanResp.Model
		openaiResp.Object = qianfanResp.Object

		// 构建使用情况
		usage := &relay_model.Usage{
			PromptTokens:     qianfanResp.Usage.PromptTokens,
			CompletionTokens: qianfanResp.Usage.CompletionTokens,
			TotalTokens:      qianfanResp.Usage.TotalTokens,
		}

		logger.SysLogf("✅ %s Rerank API请求完成，返回 %d 个结果", platformName, len(openaiResp.Data))
		return openaiResp, usage, nil
	default:
		// 通用 OpenAI 兼容格式解析 — 兼容 Cohere 格式（results）及变体
		if err := parseGenericRerankResponse(openaiResp, respBody, req); err != nil {
			return nil, nil, err
		}
	}
	// 对于 OpenAI 兼容等平台，构建通用 usage
	usage := &relay_model.Usage{
		TotalTokens: openaiResp.Usage.TotalTokens,
	}
	logger.SysLogf("✅ %s Rerank API请求完成，返回 %d 个结果", platformName, len(openaiResp.Data))
	return openaiResp, usage, nil
}

// parseGenericRerankResponse 解析通用 OpenAI 兼容格式的 rerank 响应
// 兼容 Cohere 格式（results[]）及常见变体（data[] 兜底）
func parseGenericRerankResponse(openaiResp *RerankResponse, respBody []byte, req *RerankRequest) error {
	var rawResp map[string]interface{}
	if err := json.Unmarshal(respBody, &rawResp); err != nil {
		logger.SysErrorf("❌ 解析通用Rerank响应失败: %v", err)
		return fmt.Errorf("解析通用Rerank响应失败: %v", err)
	}

	// 尝试 results，兜底 data
	var items []interface{}
	if results, ok := rawResp["results"].([]interface{}); ok {
		items = results
	} else if data, ok := rawResp["data"].([]interface{}); ok {
		items = data
	}

	if len(items) == 0 {
		logger.SysErrorf("❌ 通用Rerank响应中未找到 results/data 字段")
		return fmt.Errorf("通用Rerank响应格式错误：缺少 results/data 字段")
	}

	openaiResp.Data = make([]RerankResult, 0, len(items))
	for _, item := range items {
		itemMap, ok := item.(map[string]interface{})
		if !ok {
			continue
		}

		index, _ := itemMap["index"].(float64)
		relevanceScore, _ := itemMap["relevance_score"].(float64)

		result := RerankResult{
			Object:         "rerank_result",
			Index:          int(index),
			RelevanceScore: relevanceScore,
		}

		if doc, exists := itemMap["document"].(map[string]interface{}); exists {
			if req.ReturnDocuments == nil || *req.ReturnDocuments {
				if text, ok := doc["text"].(string); ok {
					result.Document = &RerankDocument{Text: text}
				}
			}
		}

		openaiResp.Data = append(openaiResp.Data, result)
	}

	// 尝试从 usage/meta 提取 token 信息
	if usage, ok := rawResp["usage"].(map[string]interface{}); ok {
		if total, ok := usage["total_tokens"].(float64); ok {
			openaiResp.Usage.TotalTokens = int(total)
		}
	} else if meta, ok := rawResp["meta"].(map[string]interface{}); ok {
		if billedUnits, ok := meta["billed_units"].(map[string]interface{}); ok {
			total := 0
			if input, ok := billedUnits["input_tokens"].(float64); ok {
				total += int(input)
			}
			if output, ok := billedUnits["output_tokens"].(float64); ok {
				total += int(output)
			}
			openaiResp.Usage.TotalTokens = total
		}
	}

	return nil
}

// CallSiliconFlowRerankAPI 调用硅基流动 rerank API
func (s *SiliconFlowRerankService) CallSiliconFlowRerankAPI(ctx context.Context, req *RerankRequest, meta *meta.Meta) (*RerankResponse, *relay_model.Usage, error) {
	return commonAPICall(ctx, req, meta, SiliconFlowBaseURL, SiliconFlowEndpoint, "硅基流动")
}

// CallBaiduQianfanRerankAPI 调用百度千帆 rerank API
func (s *BaiduQianfanRerankService) CallBaiduQianfanRerankAPI(ctx context.Context, req *RerankRequest, meta *meta.Meta) (*RerankResponse, *relay_model.Usage, error) {
	return commonAPICall(ctx, req, meta, BaiduQianfanBaseURL, BaiduQianfanEndpoint, "百度千帆")
}

// CallOpenAIRerankAPI 调用 OpenAI rerank API
func (s *OpenAIService) CallOpenAIRerankAPI(ctx context.Context, req *RerankRequest, meta *meta.Meta) (*RerankResponse, *relay_model.Usage, error) {
	// 使用渠道类型对应的默认 BaseURL，兜底 OpenAI
	baseURL := meta.BaseURL
	if baseURL == "" {
		if meta.ChannelType >= 0 && meta.ChannelType < len(channeltype.ChannelBaseURLs) && channeltype.ChannelBaseURLs[meta.ChannelType] != "" {
			baseURL = channeltype.ChannelBaseURLs[meta.ChannelType]
		} else {
			baseURL = "https://api.openai.com"
		}
	}
	return commonAPICall(ctx, req, meta, baseURL, "/v1/rerank", "OpenAI")
}

// CallBailianRerankAPI 调用百炼 rerank API
func (s *BailianRerankService) CallBailianRerankAPI(ctx context.Context, req *RerankRequest, meta *meta.Meta) (*RerankResponse, *relay_model.Usage, error) {
	// 百炼 API 的具体实现
	// 这里使用原来的实现逻辑
	resultContent := make([]string, len(req.Documents))
	copy(resultContent, req.Documents)

	// 按相关性排序（这里只是一个模拟实现）
	// 实际实现中应该调用百炼的 API
	// ...

	response := &RerankResponse{
		Object: "list",
		Data:   make([]RerankResult, len(resultContent)),
		Model:  req.Model,
		Usage:  RerankUsage{TotalTokens: 0}, // 根据实际情况计算
	}

	for i, content := range resultContent {
		response.Data[i] = RerankResult{
			Object:         "rerank_result",
			Index:          i,
			RelevanceScore: 1.0, // 模拟分数
			Document: &RerankDocument{
				Text: content,
			},
		}
	}

	// 计算使用量
	usage := s.calculateRerankUsage(req, resultContent)

	return response, usage, nil
}

func (s *BailianRerankService) calculateRerankUsage(req *RerankRequest, resultContent []string) *relay_model.Usage {
	totalTokens := 0
	// 计算查询和文档的字符数
	totalTokens += len(req.Query)
	for _, doc := range req.Documents {
		totalTokens += len(doc)
	}

	// 计算返回结果的字符数
	for _, content := range resultContent {
		totalTokens += len(content)
	}

	usage := &relay_model.Usage{
		TotalTokens:      totalTokens,
		PromptTokens:     len(req.Query),
		CompletionTokens: totalTokens - len(req.Query),
	}
	return usage
}
