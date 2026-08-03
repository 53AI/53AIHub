package rag

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	urlTool "net/url"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/vectorstore"
	"github.com/google/uuid"
	"github.com/songquanpeng/one-api/relay/channeltype"
	"gorm.io/gorm"
)

// EmbeddingContext embedding 调用上下文，用于传递停止信号检查参数
type EmbeddingContext struct {
	LibraryID *int64 `json:"library_id,omitempty"`
	FileID    *int64 `json:"file_id,omitempty"`
}

// NewEmbeddingContext 创建新的 embedding 上下文
func NewEmbeddingContext(libraryID, fileID int64) *EmbeddingContext {
	return &EmbeddingContext{
		LibraryID: &libraryID,
		FileID:    &fileID,
	}
}

// NewEmptyEmbeddingContext 创建空的 embedding 上下文（不检查停止信号）
func NewEmptyEmbeddingContext() *EmbeddingContext {
	return &EmbeddingContext{}
}

// IsValid 检查上下文是否有效（包含有效的 libraryID 和 fileID）
func (ctx *EmbeddingContext) IsValid() bool {
	return ctx != nil && ctx.LibraryID != nil && ctx.FileID != nil && *ctx.LibraryID != 0 && *ctx.FileID != 0
}

// GetLibraryID 获取 LibraryID
func (ctx *EmbeddingContext) GetLibraryID() int64 {
	if ctx != nil && ctx.LibraryID != nil {
		return *ctx.LibraryID
	}
	return 0
}

// GetFileID 获取 FileID
func (ctx *EmbeddingContext) GetFileID() int64 {
	if ctx != nil && ctx.FileID != nil {
		return *ctx.FileID
	}
	return 0
}

// EmbeddingService 向量化服务
type EmbeddingService struct {
	db          *gorm.DB
	client      *http.Client
	vectorStore vectorstore.VectorStore
	tokenizer   *TokenizerService
}

// EmbeddingRequest 向量化请求 - 符合OpenAI官方API格式
type EmbeddingRequest struct {
	Input          interface{} `json:"input"`                     // 输入文本，可以是string或[]string
	Model          string      `json:"model"`                     // 模型名称
	EncodingFormat string      `json:"encoding_format,omitempty"` // 编码格式，默认float
	Dimensions     int         `json:"dimensions,omitempty"`      // 输出维度（仅支持text-embedding-3及更新模型）
	User           string      `json:"user,omitempty"`            // 用户标识
}

// EmbeddingResponse 向量化响应
type EmbeddingResponse struct {
	Data []struct {
		Embedding []float64 `json:"embedding"`
		Index     int       `json:"index"`
	} `json:"data"`
	Model string `json:"model"`
	Usage struct {
		PromptTokens int `json:"prompt_tokens"`
		TotalTokens  int `json:"total_tokens"`
	} `json:"usage"`
}

// MultimodalEmbeddingResponse 火山方舟视觉嵌入模型响应格式
type MultimodalEmbeddingResponse struct {
	Data      interface{} `json:"data"` // 使用interface{}以处理不同的数据格式
	Model     string      `json:"model"`
	Usage     interface{} `json:"usage"`
	RequestId string      `json:"request_id,omitempty"`
	Latency   float64     `json:"latency,omitempty"`
}

// MultimodalEmbeddingData 视觉嵌入模型响应数据
type MultimodalEmbeddingData struct {
	Embedding []float64 `json:"embedding"`
	Index     int       `json:"index"`
}

// NewEmbeddingService 创建向量化服务
func NewEmbeddingService(db *gorm.DB) *EmbeddingService {
	// 获取全局向量存储实例
	store, err := vectorstore.GetGlobalVectorStore()
	if err != nil {
		// 如果获取失败，记录错误但不阻塞服务启动
		fmt.Printf("警告: 获取全局向量存储失败: %v\n", err)
		store = nil
	}

	return &EmbeddingService{
		db:          db,
		vectorStore: store,
		tokenizer:   NewTokenizerService(),
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// ProcessChunkEmbedding 处理分块向量化
func (s *EmbeddingService) ProcessChunkEmbedding(eid int64, chunkID int64) error {
	// 获取分块信息
	chunk, err := model.GetDocumentChunkByID(eid, chunkID)
	if err != nil {
		return fmt.Errorf("获取分块信息失败: %v", err)
	}

	// 检查是否已经向量化
	if model.IsDocumentChunkEmbeddingSucceeded(chunk.EmbeddingStatus) {
		return nil
	}

	// 更新状态为处理中
	err = model.UpdateChunkEmbeddingStatus(eid, chunkID, model.DocumentChunkEmbeddingStatusIndexing, "")
	if err != nil {
		return fmt.Errorf("更新状态失败: %v", err)
	}

	// 获取配置
	configService := NewChunkConfigService(s.db)
	config, err := configService.GetEnterpriseEmbeddingConfig(eid)
	if err != nil {
		s.updateEmbeddingStatusWithError(eid, chunkID, "获取配置失败")
		return fmt.Errorf("获取配置失败: %v", err)
	}

	if config.EmbeddingChannelID == nil {
		s.updateEmbeddingStatusWithError(eid, chunkID, "未配置向量化渠道")
		return fmt.Errorf("未配置向量化渠道")
	}

	// 获取渠道配置
	channel, err := model.GetChannelByID(*config.EmbeddingChannelID)
	if err != nil {
		s.updateEmbeddingStatusWithError(eid, chunkID, "获取渠道配置失败")
		return fmt.Errorf("获取渠道配置失败: %v", err)
	}

	// 获取模型名称
	var modelName string
	if config.EmbeddingModelName != nil {
		modelName = *config.EmbeddingModelName
	} else {
		// 如果没有配置模型名称，使用默认模型（按渠道常量判断）
		switch channel.Type {
		case channeltype.OpenAI:
			modelName = "text-embedding-3-small"
		case channeltype.Azure:
			modelName = "text-embedding-3-small"
		case channeltype.Ali: // Qwen (百炼 compatible-mode)
			modelName = "text-embedding-v4"
		case model.ChannelApiTypeAppBuilderModel: // 千帆向量模型
			modelName = "bge-large-zh"
		default:
			modelName = "text-embedding-3-small"
		}
	}

	ctx := &EmbeddingContext{
		LibraryID: &chunk.LibraryID,
		FileID:    &chunk.FileID,
	}

	// 调用embedding API
	vector, err := s.CallEmbeddingAPIWithModel(chunk.Content, channel, modelName, ctx)
	if err != nil {
		s.updateEmbeddingStatusWithError(eid, chunkID, fmt.Sprintf("向量化失败: %v", err))
		return fmt.Errorf("向量化失败: %v", err)
	}

	// 存储到向量数据库
	vectorID, err := s.storeToVectorDB(chunkID, vector, chunk)
	if err != nil {
		s.updateEmbeddingStatusWithError(eid, chunkID, fmt.Sprintf("存储向量失败: %v", err))
		return fmt.Errorf("存储向量失败: %v", err)
	}

	// 更新状态为完成
	err = model.UpdateChunkEmbeddingStatus(eid, chunkID, model.DocumentChunkEmbeddingStatusNormal, vectorID)
	if err != nil {
		return fmt.Errorf("更新完成状态失败: %v", err)
	}

	return nil
}

// ProcessPendingEmbeddings 处理待向量化的分块
func (s *EmbeddingService) ProcessPendingEmbeddings(eid int64, batchSize int) error {
	// 获取待处理的分块
	chunks, err := model.GetPendingEmbeddingChunks(eid, batchSize)
	if err != nil {
		return fmt.Errorf("获取待处理分块失败: %v", err)
	}

	if len(chunks) == 0 {
		return nil
	}

	// 逐个处理
	for _, chunk := range chunks {
		err := s.ProcessChunkEmbedding(eid, chunk.ID)
		if err != nil {
			fmt.Printf("处理分块 %d 向量化失败: %v\n", chunk.ID, err)
			continue
		}

		// 添加延迟避免API限流
		time.Sleep(100 * time.Millisecond)
	}

	return nil
}

// callEmbeddingAPIWithStop 调用embedding API (兼容旧接口) - 支持停止信号检查
func (s *EmbeddingService) callEmbeddingAPIWithStop(content string, channel *model.Channel, config *ChunkConfig, libraryID, fileID int64) ([]float64, error) {
	// 验证输入
	if channel == nil {
		return nil, fmt.Errorf("渠道配置不能为空")
	}

	if config == nil {
		return nil, fmt.Errorf("配置不能为空")
	}

	// 使用默认模型
	var modelName string
	if config.EmbeddingModelName != nil && *config.EmbeddingModelName != "" {
		modelName = *config.EmbeddingModelName
	} else {
		// 如果没有配置模型名称，使用默认模型（按渠道常量判断）
		switch channel.Type {
		case channeltype.OpenAI:
			modelName = "text-embedding-3-small"
		case channeltype.Azure:
			modelName = "text-embedding-3-small"
		case channeltype.Ali: // Qwen (百炼 compatible-mode)
			modelName = "text-embedding-v4"
		default:
			modelName = "text-embedding-3-small"
		}
	}
	return s.CallEmbeddingAPIWithModelWithStop(content, channel, modelName, libraryID, fileID)
}

// callEmbeddingAPI 调用embedding API (兼容旧接口)
func (s *EmbeddingService) callEmbeddingAPI(content string, channel *model.Channel, config *ChunkConfig, ctx *EmbeddingContext) ([]float64, error) {
	// 验证输入
	if channel == nil {
		return nil, fmt.Errorf("渠道配置不能为空")
	}

	if config == nil {
		return nil, fmt.Errorf("配置不能为空")
	}

	// 使用默认模型
	var modelName string
	if config.EmbeddingModelName != nil && *config.EmbeddingModelName != "" {
		modelName = *config.EmbeddingModelName
	} else {
		// 如果没有配置模型名称，使用默认模型（按渠道常量判断）
		switch channel.Type {
		case channeltype.OpenAI:
			modelName = "text-embedding-3-small"
		case channeltype.Azure:
			modelName = "text-embedding-3-small"
		case channeltype.Ali: // Qwen (百炼 compatible-mode)
			modelName = "text-embedding-v4"
		default:
			modelName = "text-embedding-3-small"
		}
	}
	return s.CallEmbeddingAPIWithModel(content, channel, modelName, ctx)
}

// CallEmbeddingAPIWithModelWithStop 调用embedding API (指定模型) - 支持停止信号检查
func (s *EmbeddingService) CallEmbeddingAPIWithModelWithStop(content string, channel *model.Channel, modelName string, libraryID, fileID int64) ([]float64, error) {
	// 验证输入
	if content == "" {
		return nil, fmt.Errorf("内容不能为空")
	}

	if channel == nil {
		return nil, fmt.Errorf("渠道配置不能为空")
	}

	if channel.Key == "" {
		return nil, fmt.Errorf("API密钥不能为空")
	}

	// 限制embedding内容长度为4096个token，超出部分舍弃
	content = s.truncateContentForEmbedding(content, 4096)

	log.Printf("开始调用Embedding API: 渠道类型=%d, 内容长度=%d", channel.Type, len(content))

	// 实现重试机制
	maxRetries := 3
	var lastErr error

	for attempt := 1; attempt <= maxRetries; attempt++ {
		if attempt > 1 {
			logger.SysLogf("Embedding API重试第%d次", attempt)
			time.Sleep(time.Duration(attempt) * time.Second) // 指数退避
		}

		// 🔒 安全检查：只有当 libraryID 和 fileID 都不为 0 时才检查停止信号
		if libraryID != 0 || fileID != 0 {
			if err := common.CheckRagTaskStop(libraryID, fileID); err != nil {
				log.Printf("embedding task stopped by signal: libraryID=%d, fileID=%d, error=%v", libraryID, fileID, err)
				return nil, fmt.Errorf("embedding task stopped: %v", err)
			}
		}

		var vector []float64
		var err error

		switch channel.Type {
		case channeltype.OpenAI: // OpenAI
			vector, err = s.callOpenAIEmbeddingWithModel(content, channel, modelName)
		case channeltype.Azure: // Azure OpenAI
			vector, err = s.callAzureEmbeddingWithModel(content, channel, modelName)
		case channeltype.Ali: // 阿里百炼使用 OpenAI 兼容接口
			vector, err = s.callOpenAIEmbeddingWithModel(content, channel, modelName)
		case channeltype.SiliconFlow: // 硅基流动使用 OpenAI 兼容接口
			vector, err = s.callOpenAIEmbeddingWithModel(content, channel, modelName)
		case channeltype.Gemini, channeltype.Moonshot, model.ChannelApiTypeCustomOpenAI: // 月之暗面, Gemini, 自定义模型使用 OpenAI 兼容接口
			vector, err = s.callOpenAIEmbeddingWithModel(content, channel, modelName)
		case model.ChannelApiVolcengineModel: // 火山平台模型兼容
			vector, err = s.callOpenAIEmbeddingWithModel(content, channel, modelName)
		case model.ChannelApiTypeAppBuilderModel: // 千帆向量模型
			vector, err = s.callQianfanEmbeddingWithModel(content, channel, modelName)
		default:
			return nil, fmt.Errorf("不支持的渠道类型: %d", channel.Type)
		}

		if err == nil {
			// 验证返回的向量
			if len(vector) == 0 {
				return nil, fmt.Errorf("API返回的向量为空")
			}

			logger.SysLogf("Embedding API调用成功: 向量维度=%d", len(vector))
			return vector, nil
		}

		lastErr = err
		logger.SysLogf("Embedding API调用失败 (尝试%d/%d): %v", attempt, maxRetries, err)

		// 检查是否是不可重试的错误
		if s.isNonRetryableError(err) {
			logger.SysLogf("检测到不可重试错误，停止重试: %v", err)
			break
		}
	}

	return nil, fmt.Errorf("Embedding API调用失败，已重试%d次: %v", maxRetries, lastErr)
}

// CallEmbeddingAPIWithModelWithContext 调用embedding API (指定模型) - 使用上下文进行停止信号检查
func (s *EmbeddingService) CallEmbeddingAPIWithModelWithContext(content string, channel *model.Channel, modelName string, ctx *EmbeddingContext) ([]float64, error) {
	if ctx != nil && ctx.IsValid() {
		return s.CallEmbeddingAPIWithModelWithStop(content, channel, modelName, ctx.GetLibraryID(), ctx.GetFileID())
	}
	// 上下文无效时，调用原版本（不检查停止信号）
	return s.CallEmbeddingAPIWithModel(content, channel, modelName, ctx)
}

// CallEmbeddingAPIWithModel 调用embedding API (指定模型) - 保持向后兼容
func (s *EmbeddingService) CallEmbeddingAPIWithModel(content string, channel *model.Channel, modelName string, ctx *EmbeddingContext) ([]float64, error) {
	// 调用新版本方法，传递 0,0 表示不检查停止信号
	return s.CallEmbeddingAPIWithModelWithStop(content, channel, modelName, ctx.GetLibraryID(), ctx.GetFileID())
}

// isNonRetryableError 判断是否是不可重试的错误
func (s *EmbeddingService) isNonRetryableError(err error) bool {
	errStr := strings.ToLower(err.Error())

	// 认证错误
	if strings.Contains(errStr, "unauthorized") || strings.Contains(errStr, "invalid api key") {
		return true
	}

	// 配置错误
	if strings.Contains(errStr, "baseurl") || strings.Contains(errStr, "不支持的渠道类型") {
		return true
	}

	// 请求格式错误
	if strings.Contains(errStr, "bad request") || strings.Contains(errStr, "400") {
		return true
	}

	return false
}

// callVolcEngineVisionEmbedding 调用火山方舟视觉嵌入模型API
func (s *EmbeddingService) callVolcEngineVisionEmbedding(content string, channel *model.Channel, modelName, url string) ([]float64, error) {
	// 构建视觉模型的输入格式
	// 根据官方示例，视觉模型需要特定的输入格式
	reqBodyForVision := map[string]interface{}{
		"model": modelName,
		"input": []map[string]interface{}{
			{"type": "text", "text": content}, // 文本内容
			{"type": "image_url", "image_url": map[string]string{"url": "https://ark-project.tos-cn-beijing.volces.com/images/view.jpeg"}}, // 默认图片URL
		},
	}

	jsonData, err := json.Marshal(reqBodyForVision)
	if err != nil {
		return nil, fmt.Errorf("序列化视觉模型请求失败: %v", err)
	}

	logger.SysLogf("火山方舟视觉 Embedding API请求: URL=%s, Model=%s, ContentLength=%d", url, modelName, len(content))

	req, err := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, fmt.Errorf("创建视觉模型请求失败: %v", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+channel.Key)

	// 发送请求
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("发送视觉模型请求失败: %v", err)
	}
	defer resp.Body.Close()

	// 读取响应
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("读取视觉模型响应失败: %v", err)
	}

	logger.SysLogf("火山方舟视觉 API响应: StatusCode=%d, BodyLength=%d", resp.StatusCode, len(body))

	// 检查HTTP状态码
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		logger.SysLogf("火山方舟视觉 API错误响应: %s", string(body))

		// 针对404错误提供更详细的信息
		if resp.StatusCode == 404 {
			return nil, fmt.Errorf("视觉API端点不存在 (404): URL=%s, 请检查BaseURL配置和模型名称 %s", url, modelName)
		}

		// 针对401错误提供更详细的信息
		if resp.StatusCode == 401 {
			return nil, fmt.Errorf("视觉API认证失败 (401): 请检查API密钥是否正确")
		}

		// 针对429错误提供更详细的信息
		if resp.StatusCode == 429 {
			return nil, fmt.Errorf("视觉API请求频率限制 (429): 请稍后重试")
		}

		return nil, fmt.Errorf("视觉API请求失败: %s, 响应: %s", resp.Status, string(body))
	}

	// 解析视觉模型响应，使用专门的响应结构
	var multimodalResp MultimodalEmbeddingResponse
	err = json.Unmarshal(body, &multimodalResp)
	if err != nil {
		logger.SysLogf("火山方舟视觉响应解析失败: %v, 原始响应: %s", err, string(body))
		return nil, fmt.Errorf("解析视觉响应失败: %v, 响应内容: %s", err, string(body))
	}

	// 处理data字段，根据实际情况可能是数组或对象
	var embedding []float64

	// 首先检查data是否为数组
	if dataArray, isArray := multimodalResp.Data.([]interface{}); isArray {
		if len(dataArray) == 0 {
			logger.SysLogf("火山方舟视觉响应中没有向量数据: %s", string(body))
			return nil, fmt.Errorf("视觉响应中没有向量数据")
		}

		// 提取第一个数据项
		firstDataItem := dataArray[0]
		dataMap, ok := firstDataItem.(map[string]interface{})
		if !ok {
			logger.SysLogf("火山方舟视觉响应中数据格式不正确: %v", firstDataItem)
			return nil, fmt.Errorf("视觉响应中数据格式不正确")
		}

		embedding, err = extractEmbeddingFromDataMap(dataMap)
		if err != nil {
			return nil, err
		}
	} else if dataMap, isObject := multimodalResp.Data.(map[string]interface{}); isObject {
		// data也可能是一个对象
		embedding, err = extractEmbeddingFromDataMap(dataMap)
		if err != nil {
			return nil, err
		}
	} else {
		logger.SysLogf("火山方舟视觉响应中data字段格式未知: %T", multimodalResp.Data)
		return nil, fmt.Errorf("视觉响应中data字段格式未知")
	}

	if len(embedding) == 0 {
		logger.SysLogf("火山方舟视觉响应中向量为空: %s", string(body))
		return nil, fmt.Errorf("视觉响应中向量为空")
	}

	logger.SysLogf("火山方舟视觉 Embedding成功: 向量维度=%d", len(embedding))
	return embedding, nil
}

// callOpenAIEmbeddingWithModel 调用OpenAI embedding API (指定模型)
func (s *EmbeddingService) callOpenAIEmbeddingWithModel(content string, channel *model.Channel, modelName string) ([]float64, error) {
	// 验证必要参数
	if channel.Key == "" {
		return nil, fmt.Errorf("OpenAI API密钥不能为空")
	}

	// 构建HTTP请求
	var baseURL string
	if channel.BaseURL != nil && *channel.BaseURL != "" {
		baseURL = strings.TrimSuffix(*channel.BaseURL, "/")
	} else {
		// Ali(Qwen) 兼容模式必须显式配置 BaseURL
		if channel.Type == channeltype.Ali {
			return nil, fmt.Errorf("baseurl 缺失：Ali(Qwen) 渠道使用 OpenAI 兼容接口时必须配置 BaseURL（示例：https://dashscope.aliyuncs.com/compatible-mode/v1）")
		}
		// 优先使用渠道类型对应的默认 BaseURL
		if channel.Type >= 0 && channel.Type < len(channeltype.ChannelBaseURLs) && channeltype.ChannelBaseURLs[channel.Type] != "" {
			baseURL = channeltype.ChannelBaseURLs[channel.Type]
		} else {
			baseURL = "https://api.openai.com"
		}
	}
	// 避免 baseURL 已包含 /v1 时重复拼接
	normalizedBase := strings.TrimSuffix(baseURL, "/")
	var url string

	// 火山引擎特殊处理：V3 API 直接拼接 /embeddings
	if channel.Type == model.ChannelApiVolcengineModel && strings.Contains(normalizedBase, "/api/v3") {
		url = normalizedBase + "/embeddings"

		// 检查是否为视觉嵌入模型
		isVisionModel := strings.Contains(strings.ToLower(modelName), "vision") ||
			strings.Contains(strings.ToLower(modelName), "multimodal") ||
			strings.Contains(strings.ToLower(modelName), "doubao-embedding-vision")

		if isVisionModel {
			// https://console.volcengine.com/ark/region:ark+cn-beijing/model/detail?Id=doubao-embedding-vision
			url = url + "/multimodal"
			return s.callVolcEngineVisionEmbedding(content, channel, modelName, url)
		}
	} else if channel.Type == model.ChannelApiBailian || channeltype.Ali == channel.Type {
		// 解析URL
		parsedURL, err := urlTool.Parse(normalizedBase)
		if err == nil {
			baseURL := fmt.Sprintf("%s://%s", parsedURL.Scheme, parsedURL.Host)
			url = baseURL + "/compatible-mode/v1/embeddings"
		} else {
			url = normalizedBase + "/embeddings"
		}
	} else if strings.HasSuffix(normalizedBase, "/v1") {
		url = normalizedBase + "/embeddings"
		// 增加一个类型，如果 normalizedBase 包含 /embeddings 表示是完全的 baseURL，直接使用，不再拼接
	} else if strings.Contains(normalizedBase, "/embeddings") {
		url = normalizedBase
	} else {
		url = normalizedBase + "/v1/embeddings"
	}

	// 对于非视觉模型，继续使用原来的逻辑
	// 构建符合OpenAI官方格式的请求
	reqBody := EmbeddingRequest{
		Input:          content,   // 输入文本
		Model:          modelName, // 使用chunk_setting中配置的模型名称
		EncodingFormat: "float",   // 使用float格式
	}

	jsonData, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("序列化请求失败: %v", err)
	}

	logger.SysLogf("OpenAI Embedding API请求: URL=%s, Model=%s, ContentLength=%d", url, modelName, len(content))

	req, err := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, fmt.Errorf("创建请求失败: %v", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+channel.Key)

	// 发送请求
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("发送请求失败: %v", err)
	}
	defer resp.Body.Close()

	// 读取响应
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("读取响应失败: %v", err)
	}

	logger.SysLogf("OpenAI API响应: StatusCode=%d, BodyLength=%d", resp.StatusCode, len(body))

	// 检查HTTP状态码
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		logger.SysLogf("OpenAI API错误响应: %s", string(body))

		// 针对404错误提供更详细的信息
		if resp.StatusCode == 404 {
			return nil, fmt.Errorf("API端点不存在 (404): URL=%s, 请检查BaseURL配置和模型名称 %s", url, modelName)
		}

		// 针对401错误提供更详细的信息
		if resp.StatusCode == 401 {
			return nil, fmt.Errorf("API认证失败 (401): 请检查API密钥是否正确")
		}

		// 针对429错误提供更详细的信息
		if resp.StatusCode == 429 {
			return nil, fmt.Errorf("API请求频率限制 (429): 请稍后重试")
		}

		return nil, fmt.Errorf("API请求失败: %s, 响应: %s", resp.Status, string(body))
	}

	// 解析响应
	var embeddingResp EmbeddingResponse
	err = json.Unmarshal(body, &embeddingResp)
	if err != nil {
		logger.SysLogf("OpenAI响应解析失败: %v, 原始响应: %s", err, string(body))
		return nil, fmt.Errorf("解析响应失败: %v, 响应内容: %s", err, string(body))
	}

	if len(embeddingResp.Data) == 0 {
		logger.SysLogf("OpenAI响应中没有向量数据: %s", string(body))
		return nil, fmt.Errorf("响应中没有向量数据")
	}

	if len(embeddingResp.Data[0].Embedding) == 0 {
		logger.SysLogf("OpenAI响应中向量为空: %s", string(body))
		return nil, fmt.Errorf("响应中向量为空")
	}

	logger.SysLogf("OpenAI Embedding成功: 向量维度=%d", len(embeddingResp.Data[0].Embedding))
	return embeddingResp.Data[0].Embedding, nil
}

// extractEmbeddingFromDataMap 从数据映射中提取嵌入向量
func extractEmbeddingFromDataMap(dataMap map[string]interface{}) ([]float64, error) {
	// 提取嵌入向量
	embeddingInterface, exists := dataMap["embedding"]
	if !exists {
		logger.SysLogf("火山方舟视觉响应中缺少embedding字段: %v", dataMap)
		return nil, fmt.Errorf("视觉响应中缺少embedding字段")
	}

	// 将嵌入向量转换为float64数组
	embeddingSlice, ok := embeddingInterface.([]interface{})
	if !ok {
		logger.SysLogf("火山方舟视觉响应中embedding不是数组类型: %v", embeddingInterface)
		return nil, fmt.Errorf("视觉响应中embedding不是数组类型")
	}

	// 转换interface{}数组为float64数组
	embedding := make([]float64, len(embeddingSlice))
	for i, val := range embeddingSlice {
		if floatVal, ok := val.(float64); ok {
			embedding[i] = floatVal
		} else if intVal, ok := val.(int); ok {
			embedding[i] = float64(intVal)
		} else if int64Val, ok := val.(int64); ok {
			embedding[i] = float64(int64Val)
		} else {
			logger.SysLogf("火山方舟视觉响应中embedding数组元素类型不正确: %v", val)
			return nil, fmt.Errorf("视觉响应中embedding数组元素类型不正确")
		}
	}

	return embedding, nil
}

// callAzureEmbeddingWithModel 调用Azure OpenAI embedding API (指定模型)
func (s *EmbeddingService) callAzureEmbeddingWithModel(content string, channel *model.Channel, modelName string) ([]float64, error) {
	// 验证必要的配置
	if channel.BaseURL == nil || *channel.BaseURL == "" {
		return nil, fmt.Errorf("azure OpenAI需要配置BaseURL")
	}

	if channel.Key == "" {
		return nil, fmt.Errorf("azure OpenAI API密钥不能为空")
	}

	// Azure OpenAI的实现类似OpenAI，但URL格式不同
	reqBody := EmbeddingRequest{
		Input:          content,   // 输入文本
		Model:          modelName, // 使用chunk_setting中配置的模型名称
		EncodingFormat: "float",   // 使用float格式
	}

	jsonData, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("序列化请求失败: %v", err)
	}

	// Azure URL格式: https://{resource}.openai.azure.com/openai/deployments/{deployment}/embeddings?api-version=2023-05-15
	baseURL := strings.TrimSuffix(*channel.BaseURL, "/")
	url := fmt.Sprintf("%s/openai/deployments/%s/embeddings?api-version=2023-05-15", baseURL, modelName)

	logger.SysLogf("Azure OpenAI Embedding API请求: URL=%s, Model=%s, ContentLength=%d", url, modelName, len(content))

	req, err := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, fmt.Errorf("创建请求失败: %v", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("api-key", channel.Key)

	resp, err := s.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("发送请求失败: %v", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("读取响应失败: %v", err)
	}

	logger.SysLogf("Azure OpenAI API响应: StatusCode=%d, BodyLength=%d", resp.StatusCode, len(body))

	// 检查HTTP状态码
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		logger.SysLogf("Azure OpenAI API错误响应: %s", string(body))

		// 针对404错误提供更详细的信息
		if resp.StatusCode == 404 {
			return nil, fmt.Errorf("azure API端点不存在 (404): URL=%s, 请检查BaseURL配置和部署名称 %s", url, modelName)
		}

		// 针对401错误提供更详细的信息
		if resp.StatusCode == 401 {
			return nil, fmt.Errorf("azure API认证失败 (401): 请检查API密钥是否正确")
		}

		// 针对429错误提供更详细的信息
		if resp.StatusCode == 429 {
			return nil, fmt.Errorf("azure API请求频率限制 (429): 请稍后重试")
		}

		return nil, fmt.Errorf("azure API请求失败: %s, 响应: %s", resp.Status, string(body))
	}

	var embeddingResp EmbeddingResponse
	err = json.Unmarshal(body, &embeddingResp)
	if err != nil {
		logger.SysLogf("Azure OpenAI响应解析失败: %v, 原始响应: %s", err, string(body))
		return nil, fmt.Errorf("解析响应失败: %v, 响应内容: %s", err, string(body))
	}

	if len(embeddingResp.Data) == 0 {
		logger.SysLogf("Azure OpenAI响应中没有向量数据: %s", string(body))
		return nil, fmt.Errorf("响应中没有向量数据")
	}

	if len(embeddingResp.Data[0].Embedding) == 0 {
		logger.SysLogf("Azure OpenAI响应中向量为空: %s", string(body))
		return nil, fmt.Errorf("响应中向量为空")
	}

	logger.SysLogf("Azure OpenAI Embedding成功: 向量维度=%d", len(embeddingResp.Data[0].Embedding))
	return embeddingResp.Data[0].Embedding, nil
}

// storeToVectorDB 存储到向量数据库
func (s *EmbeddingService) storeToVectorDB(chunkID int64, vector []float64, chunk *model.DocumentChunk) (string, error) {
	// 验证输入
	if len(vector) == 0 {
		return "", fmt.Errorf("向量不能为空")
	}

	if chunk == nil {
		return "", fmt.Errorf("分块信息不能为空")
	}

	// 检查向量存储是否可用
	if s.vectorStore == nil {
		return "", fmt.Errorf("向量存储不可用")
	}

	// 获取库信息构建集合名
	library, err := model.GetLibraryByID(chunk.Eid, chunk.LibraryID)
	if err != nil {
		return "", fmt.Errorf("获取库信息失败: %v", err)
	}

	// 构建向量记录
	vectorID := uuid.New().String()
	resolver := VectorCollectionResolver{Mode: GetVectorCollectionMode()}
	collections := resolver.ResolveDocumentWriteCollections(chunk.Eid, *library)
	logger.SysLogf("【诊断-文档块写入】eid=%d, chunk_id=%d, library_id=%d, mode=%s, collections=%v", chunk.Eid, chunkID, chunk.LibraryID, resolver.Mode, collections)

	// 转换向量格式 (float64 -> float32)
	vector32 := make([]float32, len(vector))
	for i, v := range vector {
		vector32[i] = float32(v)
	}

	// 构建元数据（使用统一的企业级 metadata 构建函数）
	metadata := buildDocumentVectorMetadata(DocumentVectorMetadataInput{
		Eid:                chunk.Eid,
		SpaceID:            library.SpaceID,
		LibraryID:          chunk.LibraryID,
		FileID:             chunk.FileID,
		ChunkID:            chunkID,
		KnowledgeChunkID:   0, // 文档 chunk 暂无可关联的知识点 chunk ID
		ChunkType:          chunk.ChunkType,
		Content:            chunk.Content,
		TokenCount:         chunk.TokenCount,
		Status:             "enabled",
		EmbeddingModel:     "",
		EmbeddingChannelID: 0,
	})
	// 保留 library_uuid 字段（兼容旧代码查询）
	metadata["library_uuid"] = library.UUID
	// 保留 created_at 时间戳
	metadata["created_at"] = time.Now().Unix()

	record := vectorstore.VectorRecord{
		ID:       vectorID,
		Vector:   vector32,
		Metadata: metadata,
	}

	ctx := context.Background()

	// 根据模式向每个目标集合写入向量
	for _, collection := range collections {
		if err := s.insertWithAutoCreateCollection(ctx, collection, record, len(vector32)); err != nil {
			return "", fmt.Errorf("写入集合 %s 失败: %v", collection, err)
		}
		logger.SysLogf("成功存储向量: VectorID=%s, Collection=%s", vectorID, collection)
	}
	return vectorID, nil
}

// insertWithAutoCreateCollection 插入向量，如果集合不存在则自动创建
func (s *EmbeddingService) insertWithAutoCreateCollection(ctx context.Context, collection string, record vectorstore.VectorRecord, dimension int) error {
	// 尝试直接插入
	err := s.vectorStore.Insert(ctx, collection, []vectorstore.VectorRecord{record})
	if err == nil {
		return nil
	}

	// 检查是否是集合不存在的错误
	if vsErr, ok := err.(*vectorstore.VectorStoreError); ok {
		if vsErr.Code == vectorstore.ErrCodeCollectionNotFound || vsErr.Code == vectorstore.ErrCodeUnknown {
			logger.SysLogf("【诊断-插入向量】collection不存在，尝试创建: %s, dimension=%d", collection, dimension)
			// 尝试创建集合
			collectionConfig := vectorstore.CollectionConfig{
				Name:      collection,
				Dimension: dimension,
				Metric:    "cosine",
				IndexType: "HNSW",
			}

			createErr := s.vectorStore.CreateCollection(ctx, collectionConfig)
			if createErr != nil && !vectorstore.IsExistsError(createErr) {
				return fmt.Errorf("创建集合失败: %v", createErr)
			}
			if createErr != nil && vectorstore.IsExistsError(createErr) {
				logger.SysLogf("【诊断-插入向量】collection已存在，继续尝试插入: %s, dimension=%d", collection, dimension)
			} else {
				logger.SysLogf("【诊断-插入向量】collection创建成功，重新插入: %s, dimension=%d", collection, dimension)
			}

			// 重新尝试插入
			if insertErr := s.vectorStore.Insert(ctx, collection, []vectorstore.VectorRecord{record}); insertErr != nil {
				return fmt.Errorf("创建集合后插入向量失败: %v", insertErr)
			}
			return nil
		}
		logger.SysLogf("【诊断-插入向量】非collection not found错误: collection=%s, code=%s, err=%v", collection, vsErr.Code, err)
	}

	// 其他错误，使用重试机制
	return s.insertWithRetry(ctx, collection, record)
}

// insertWithRetry 带重试机制的插入
func (s *EmbeddingService) insertWithRetry(ctx context.Context, collection string, record vectorstore.VectorRecord) error {
	maxRetries := 3
	for attempt := 1; attempt <= maxRetries; attempt++ {
		if attempt > 1 {
			logger.SysLogf("向量插入重试第%d次", attempt)
			time.Sleep(time.Duration(attempt) * time.Second)
		}

		err := s.vectorStore.Insert(ctx, collection, []vectorstore.VectorRecord{record})
		if err == nil {
			return nil
		}

		// 如果是最后一次尝试或非网络错误，直接返回
		if attempt == maxRetries || !isVectorRetryableError(err) {
			return err
		}

		lastErr := err
		_ = lastErr
	}
	return fmt.Errorf("插入向量失败，已重试%d次", maxRetries)
}

// isVectorRetryableError 判断向量存储错误是否可重试
func isVectorRetryableError(err error) bool {
	// 网络相关错误可重试
	if strings.Contains(err.Error(), "connection") ||
		strings.Contains(err.Error(), "timeout") ||
		strings.Contains(err.Error(), "network") {
		return true
	}

	// VectorStore连接错误可重试
	if vsErr, ok := err.(*vectorstore.VectorStoreError); ok {
		return vsErr.Code == vectorstore.ErrCodeConnectionFailed
	}

	return false
}

// updateEmbeddingStatusWithError 更新向量化状态为失败
func (s *EmbeddingService) updateEmbeddingStatusWithError(eid int64, chunkID int64, errorMsg string) {
	err := model.UpdateChunkEmbeddingStatus(eid, chunkID, model.DocumentChunkEmbeddingStatusFailed, "")
	if err != nil {
		fmt.Printf("更新向量化失败状态失败: %v\n", err)
	}
	fmt.Printf("分块 %d 向量化失败: %s\n", chunkID, errorMsg)
}

// GetQueryEmbedding 获取查询文本的向量（使用 singleflight 防止并发重复请求）
func (s *EmbeddingService) GetQueryEmbedding(eid int64, query string, channelID int64, config *ChunkConfig) ([]float64, error) {
	// 验证输入
	if config == nil {
		return nil, fmt.Errorf("配置不能为空")
	}

	query = strings.TrimSpace(query)
	if query == "" {
		return nil, fmt.Errorf("查询内容不能为空")
	}

	modelName := ""
	if config.EmbeddingModelName != nil {
		modelName = *config.EmbeddingModelName
	}
	cacheKey := buildQueryEmbeddingCacheKey(eid, query, channelID, modelName)
	if cacheKey != "" {
		if cachedVector, hit := s.getCachedQueryEmbedding(cacheKey); hit {
			return cachedVector, nil
		}
	}

	// 使用 singleflight 防止并发时对相同查询重复调用 embedding API
	sfKey := fmt.Sprintf("eid:%d:ch:%d:m:%s:q:%s", eid, channelID, modelName, query)
	result, err := embeddingSingleflight.Do(sfKey, func() (interface{}, error) {
		// 再次检查缓存（可能在等待其他请求完成时已写入）
		if cacheKey != "" {
			if cachedVector, hit := s.getCachedQueryEmbedding(cacheKey); hit {
				return cachedVector, nil
			}
		}

		// 获取渠道配置
		channel, err := model.GetChannelByID(channelID)
		if err != nil {
			return nil, fmt.Errorf("获取渠道配置失败: %v", err)
		}

		if channel.Eid != eid {
			return nil, fmt.Errorf("渠道不属于当前企业")
		}

		// 调用embedding API
		vector, err := s.callEmbeddingAPI(query, channel, config, nil)
		if err != nil {
			return nil, err
		}

		if cacheKey != "" {
			s.setCachedQueryEmbedding(cacheKey, vector)
		}
		return vector, nil
	})

	if err != nil {
		return nil, err
	}

	return result.([]float64), nil
}

// GenerateEmbeddingWithStop 生成文本的向量表示 - 支持停止信号检查
func (s *EmbeddingService) GenerateEmbeddingWithStop(eid int64, content string, channel *model.Channel, config *ChunkConfig, libraryID, fileID int64) ([]float64, error) {
	// 验证输入
	if config == nil {
		return nil, fmt.Errorf("配置不能为空")
	}

	if channel == nil {
		return nil, fmt.Errorf("渠道配置不能为空")
	}

	return s.callEmbeddingAPIWithStop(content, channel, config, libraryID, fileID)
}

// GenerateEmbeddingWithContext 生成文本的向量表示 - 使用上下文进行停止信号检查
func (s *EmbeddingService) GenerateEmbeddingWithContext(eid int64, content string, channel *model.Channel, config *ChunkConfig, ctx *EmbeddingContext) ([]float64, error) {
	// 验证输入
	if config == nil {
		return nil, fmt.Errorf("配置不能为空")
	}

	if channel == nil {
		return nil, fmt.Errorf("渠道配置不能为空")
	}

	if ctx != nil && ctx.IsValid() {
		return s.callEmbeddingAPIWithStop(content, channel, config, ctx.GetLibraryID(), ctx.GetFileID())
	}
	// 上下文无效时，调用原版本（不检查停止信号）
	return s.callEmbeddingAPI(content, channel, config, ctx)
}

// GenerateEmbedding 生成文本的向量表示
func (s *EmbeddingService) GenerateEmbedding(eid int64, content string, channel *model.Channel, config *ChunkConfig, ctx *EmbeddingContext) ([]float64, error) {
	// 验证输入
	if config == nil {
		return nil, fmt.Errorf("配置不能为空")
	}

	if channel == nil {
		return nil, fmt.Errorf("渠道配置不能为空")
	}

	return s.callEmbeddingAPI(content, channel, config, ctx)
}

// truncateContentForEmbedding 截断内容到指定的token长度
func (s *EmbeddingService) truncateContentForEmbedding(content string, maxTokens int) string {
	if content == "" {
		return content
	}

	// 使用tokenizer计算当前内容的token数
	currentTokens, err := s.tokenizer.CountTokens(content)
	if err != nil {
		logger.SysLogf("计算token数失败: %v", err)
		// 如果计算失败，使用字符长度的粗略估算（1个token约等于4个字符）
		if len(content) <= maxTokens*4 {
			return content
		}
		return content[:maxTokens*4]
	}

	// 如果当前token数小于等于最大限制，直接返回
	if currentTokens <= maxTokens {
		return content
	}

	// 需要截断内容
	logger.SysLogf("内容token数(%d)超过限制(%d)，开始截断", currentTokens, maxTokens)

	// 使用二分查找找到合适的截断位置
	left, right := 0, len(content)
	result := content

	for left < right {
		mid := (left + right + 1) / 2
		testContent := content[:mid]
		testTokens, err := s.tokenizer.CountTokens(testContent)

		if err != nil {
			// 如果计算失败，使用更保守的估算
			right = mid - 1
			continue
		}

		if testTokens <= maxTokens {
			result = testContent
			left = mid
		} else {
			right = mid - 1
		}
	}

	logger.SysLogf("内容已截断: 原长度=%d字符(%d tokens), 截断后长度=%d字符", len(content), currentTokens, len(result))
	return result
}

// TruncateContentForEmbedding 公开的内容截断方法，用于测试
func (s *EmbeddingService) TruncateContentForEmbedding(content string, maxTokens int) string {
	return s.truncateContentForEmbedding(content, maxTokens)
}

// callQianfanEmbeddingWithModel 调用千帆向量模型API
func (s *EmbeddingService) callQianfanEmbeddingWithModel(content string, channel *model.Channel, modelName string) ([]float64, error) {
	// 检查BaseURL是否配置
	if channel.BaseURL == nil || *channel.BaseURL == "" {
		return nil, fmt.Errorf("千帆渠道必须配置BaseURL")
	}

	// 验证必要参数
	if channel.Key == "" {
		return nil, fmt.Errorf("千帆API密钥不能为空")
	}

	// 构建请求体 - 千帆API要求input为数组格式
	requestBody := map[string]interface{}{
		"model": modelName,
		"input": []string{content},
	}

	jsonData, err := json.Marshal(requestBody)
	if err != nil {
		return nil, fmt.Errorf("序列化请求体失败: %v", err)
	}

	// 构建请求 - 千帆使用/v2/embeddings端点
	baseURL := strings.TrimSuffix(*channel.BaseURL, "/")
	var url string

	// 检查BaseURL是否已经包含/v2/embeddings路径
	if strings.HasSuffix(baseURL, "/v2/embeddings") {
		url = baseURL
	} else {
		// 提取主机部分，避免重复路径
		if strings.Contains(baseURL, "/v2/embeddings") {
			// 如果BaseURL中包含/v2/embeddings但不在末尾，提取主机部分
			parts := strings.Split(baseURL, "/v2/embeddings")
			url = parts[0] + "/v2/embeddings"
		} else {
			// 正常拼接
			url = baseURL + "/v2/embeddings"
		}
	}

	logger.SysLogf("千帆 Embedding API请求: URL=%s, Model=%s, ContentLength=%d", url, modelName, len(content))

	req, err := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, fmt.Errorf("创建请求失败: %v", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+channel.Key)

	// 发送请求
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("请求失败: %v", err)
	}
	defer resp.Body.Close()

	// 读取响应
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("读取响应失败: %v", err)
	}

	logger.SysLogf("千帆API响应: StatusCode=%d, BodyLength=%d", resp.StatusCode, len(body))

	if resp.StatusCode != http.StatusOK {
		logger.SysLogf("千帆API错误响应: %s", string(body))

		// 针对常见错误提供详细信息
		if resp.StatusCode == 401 {
			return nil, fmt.Errorf("千帆API认证失败 (401): 请检查API密钥是否正确")
		}
		if resp.StatusCode == 404 {
			return nil, fmt.Errorf("千帆API端点不存在 (404): URL=%s, 请检查BaseURL配置", url)
		}
		if resp.StatusCode == 429 {
			return nil, fmt.Errorf("千帆API请求频率限制 (429): 请稍后重试")
		}

		return nil, fmt.Errorf("千帆API请求失败，状态码: %d, 响应: %s", resp.StatusCode, string(body))
	}

	// 解析响应
	var embeddingResponse EmbeddingResponse
	if err := json.Unmarshal(body, &embeddingResponse); err != nil {
		logger.SysLogf("千帆响应解析失败: %v, 原始响应: %s", err, string(body))
		return nil, fmt.Errorf("解析响应失败: %v, 响应内容: %s", err, string(body))
	}

	if len(embeddingResponse.Data) == 0 {
		logger.SysLogf("千帆响应中没有向量数据: %s", string(body))
		return nil, fmt.Errorf("千帆响应中没有向量数据")
	}

	if len(embeddingResponse.Data[0].Embedding) == 0 {
		logger.SysLogf("千帆响应中向量为空: %s", string(body))
		return nil, fmt.Errorf("千帆响应中向量为空")
	}

	logger.SysLogf("千帆 Embedding成功: 向量维度=%d", len(embeddingResponse.Data[0].Embedding))
	return embeddingResponse.Data[0].Embedding, nil
}

// BatchGenerateEmbedding 批量生成文本的向量表示
func (s *EmbeddingService) BatchGenerateEmbedding(eid int64, contents []string, channel *model.Channel, config *ChunkConfig, ctx *EmbeddingContext) ([][]float64, error) {
	start := time.Now()
	if config == nil {
		return nil, fmt.Errorf("配置不能为空")
	}
	if channel == nil {
		return nil, fmt.Errorf("渠道配置不能为空")
	}
	if len(contents) == 0 {
		return nil, nil
	}

	vectors := make([][]float64, len(contents))
	type missingEmbeddingQuery struct {
		query    string
		cacheKey string
		indexes  []int
	}
	missingByQuery := make(map[string]int)
	missing := make([]missingEmbeddingQuery, 0, len(contents))
	cacheHits := 0

	for i, content := range contents {
		query := strings.TrimSpace(content)
		if query == "" {
			return nil, fmt.Errorf("查询内容不能为空")
		}
		modelName := ""
		if config.EmbeddingModelName != nil {
			modelName = *config.EmbeddingModelName
		}
		cacheKey := buildQueryEmbeddingCacheKey(eid, query, channel.ChannelID, modelName)
		if cachedVector, hit := s.getCachedQueryEmbedding(cacheKey); hit {
			vectors[i] = cachedVector
			cacheHits++
			continue
		}
		if existingIndex, ok := missingByQuery[query]; ok {
			missing[existingIndex].indexes = append(missing[existingIndex].indexes, i)
			continue
		}
		missingByQuery[query] = len(missing)
		missing = append(missing, missingEmbeddingQuery{
			query:    query,
			cacheKey: cacheKey,
			indexes:  []int{i},
		})
	}

	if len(missing) == 0 {
		logger.SysDebugf("【Embedding】批量查询向量全部命中缓存: eid=%d, channel_id=%d, query_count=%d, elapsed_ms=%d",
			eid, channel.ChannelID, len(contents), time.Since(start).Milliseconds())
		return vectors, nil
	}

	missingContents := make([]string, len(missing))
	for i, item := range missing {
		missingContents[i] = item.query
	}
	generatedVectors, err := s.callEmbeddingAPIBatch(missingContents, channel, config, ctx)
	if err != nil {
		return nil, err
	}
	if len(generatedVectors) != len(missing) {
		return nil, fmt.Errorf("批量向量返回数量不匹配: expected=%d, got=%d", len(missing), len(generatedVectors))
	}

	for i, vector := range generatedVectors {
		item := missing[i]
		for _, originalIndex := range item.indexes {
			vectors[originalIndex] = vector
		}
		s.setCachedQueryEmbedding(item.cacheKey, vector)
	}

	logger.SysDebugf("【Embedding】批量查询向量完成: eid=%d, channel_id=%d, query_count=%d, cache_hits=%d, api_queries=%d, deduped_duplicates=%d, elapsed_ms=%d",
		eid, channel.ChannelID, len(contents), cacheHits, len(missing), len(contents)-cacheHits-len(missing), time.Since(start).Milliseconds())
	return vectors, nil
}

func (s *EmbeddingService) callEmbeddingAPIBatch(contents []string, channel *model.Channel, config *ChunkConfig, ctx *EmbeddingContext) ([][]float64, error) {
	// 验证输入
	if channel == nil {
		return nil, fmt.Errorf("渠道配置不能为空")
	}
	if config == nil {
		return nil, fmt.Errorf("配置不能为空")
	}

	// 使用默认模型
	var modelName string
	if config.EmbeddingModelName != nil && *config.EmbeddingModelName != "" {
		modelName = *config.EmbeddingModelName
	} else {
		switch channel.Type {
		case channeltype.OpenAI:
			modelName = "text-embedding-3-small"
		case channeltype.Azure:
			modelName = "text-embedding-3-small"
		case channeltype.Ali:
			modelName = "text-embedding-v4"
		default:
			modelName = "text-embedding-3-small"
		}
	}
	return s.CallEmbeddingAPIBatchWithModel(contents, channel, modelName, ctx)
}

func (s *EmbeddingService) CallEmbeddingAPIBatchWithModel(contents []string, channel *model.Channel, modelName string, ctx *EmbeddingContext) ([][]float64, error) {
	if len(contents) == 0 {
		return nil, nil
	}
	if channel == nil {
		return nil, fmt.Errorf("渠道配置不能为空")
	}
	if channel.Key == "" {
		return nil, fmt.Errorf("API密钥不能为空")
	}

	// 批量截断内容
	truncatedContents := make([]string, len(contents))
	for i, content := range contents {
		truncatedContents[i] = s.truncateContentForEmbedding(content, 4096)
	}

	// 实现重试机制
	maxRetries := 3
	var lastErr error

	for attempt := 1; attempt <= maxRetries; attempt++ {
		if attempt > 1 {
			logger.SysLogf("Embedding Batch API重试第%d次", attempt)
			time.Sleep(time.Duration(attempt) * time.Second)
		}

		if ctx != nil && ctx.IsValid() {
			if err := common.CheckRagTaskStop(ctx.GetLibraryID(), ctx.GetFileID()); err != nil {
				return nil, fmt.Errorf("embedding task stopped: %v", err)
			}
		}

		var vectors [][]float64
		var err error

		switch channel.Type {
		case channeltype.OpenAI, channeltype.Ali, channeltype.SiliconFlow, model.ChannelApiVolcengineModel:
			vectors, err = s.callOpenAIEmbeddingBatchWithModel(truncatedContents, channel, modelName)
		case channeltype.Azure:
			vectors, err = s.callAzureEmbeddingBatchWithModel(truncatedContents, channel, modelName)
		case model.ChannelApiTypeAppBuilderModel: // 千帆
			// 千帆的批量接口实现比较特殊，暂不支持批量或者需要额外实现
			// 这里简单 fallback 到逐个调用
			vectors = make([][]float64, len(truncatedContents))
			for i, content := range truncatedContents {
				vec, err := s.callQianfanEmbeddingWithModel(content, channel, modelName)
				if err != nil {
					return nil, err
				}
				vectors[i] = vec
			}
		default:
			return nil, fmt.Errorf("不支持的批量渠道类型: %d", channel.Type)
		}

		if err == nil {
			if len(vectors) != len(truncatedContents) {
				return nil, fmt.Errorf("API返回的向量数量不匹配: 期望%d, 实际%d", len(truncatedContents), len(vectors))
			}
			logger.SysLogf("Embedding Batch API调用成功: 数量=%d", len(vectors))
			return vectors, nil
		}

		lastErr = err
		logger.SysLogf("Embedding Batch API调用失败 (尝试%d/%d): %v", attempt, maxRetries, err)

		if s.isNonRetryableError(err) {
			break
		}
	}
	return nil, fmt.Errorf("Embedding Batch API调用失败，已重试%d次: %v", maxRetries, lastErr)
}

func (s *EmbeddingService) callOpenAIEmbeddingBatchWithModel(contents []string, channel *model.Channel, modelName string) ([][]float64, error) {
	if channel.Key == "" {
		return nil, fmt.Errorf("OpenAI API密钥不能为空")
	}

	reqBody := EmbeddingRequest{
		Input:          contents,
		Model:          modelName,
		EncodingFormat: "float",
	}

	jsonData, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("序列化请求失败: %v", err)
	}

	var baseURL string
	if channel.BaseURL != nil && *channel.BaseURL != "" {
		baseURL = strings.TrimSuffix(*channel.BaseURL, "/")
	} else {
		if channel.Type == channeltype.Ali {
			return nil, fmt.Errorf("baseurl 缺失：Ali(Qwen) 渠道使用 OpenAI 兼容接口时必须配置 BaseURL")
		}
		if channel.Type >= 0 && channel.Type < len(channeltype.ChannelBaseURLs) && channeltype.ChannelBaseURLs[channel.Type] != "" {
			baseURL = channeltype.ChannelBaseURLs[channel.Type]
		} else {
			baseURL = "https://api.openai.com"
		}
	}
	normalizedBase := strings.TrimSuffix(baseURL, "/")
	var url string

	if channel.Type == model.ChannelApiVolcengineModel && strings.Contains(normalizedBase, "/api/v3") {
		url = normalizedBase + "/embeddings"
	} else if channel.Type == model.ChannelApiBailian || channeltype.Ali == channel.Type {
		parsedURL, err := urlTool.Parse(normalizedBase)
		if err == nil {
			baseURL := fmt.Sprintf("%s://%s", parsedURL.Scheme, parsedURL.Host)
			url = baseURL + "/compatible-mode/v1/embeddings"
		} else {
			url = normalizedBase + "/embeddings"
		}
	} else if strings.HasSuffix(normalizedBase, "/v1") {
		url = normalizedBase + "/embeddings"
	} else {
		url = normalizedBase + "/v1/embeddings"
	}
	logger.SysLogf("OpenAI Batch Embedding API请求: URL=%s, Model=%s, Count=%d", url, modelName, len(contents))

	req, err := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, fmt.Errorf("创建请求失败: %v", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+channel.Key)

	resp, err := s.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("发送请求失败: %v", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("读取响应失败: %v", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		logger.SysLogf("OpenAI API错误响应: %s", string(body))
		if resp.StatusCode == 429 {
			return nil, fmt.Errorf("API请求频率限制 (429): 请稍后重试")
		}
		return nil, fmt.Errorf("API请求失败: %s, 响应: %s", resp.Status, string(body))
	}

	var embeddingResp EmbeddingResponse
	err = json.Unmarshal(body, &embeddingResp)
	if err != nil {
		return nil, fmt.Errorf("解析响应失败: %v, 响应内容: %s", err, string(body))
	}

	results := make([][]float64, len(contents))

	for _, item := range embeddingResp.Data {
		if item.Index >= 0 && item.Index < len(results) {
			results[item.Index] = item.Embedding
		}
	}

	// Check if all indices are present
	if len(embeddingResp.Data) != len(contents) {
		logger.SysLogf("警告: 响应数量(%d)与请求数量(%d)不一致", len(embeddingResp.Data), len(contents))
	}

	return results, nil
}

func (s *EmbeddingService) callAzureEmbeddingBatchWithModel(contents []string, channel *model.Channel, modelName string) ([][]float64, error) {
	if channel.BaseURL == nil || *channel.BaseURL == "" {
		return nil, fmt.Errorf("azure OpenAI需要配置BaseURL")
	}
	if channel.Key == "" {
		return nil, fmt.Errorf("azure OpenAI API密钥不能为空")
	}

	reqBody := EmbeddingRequest{
		Input:          contents,
		Model:          modelName,
		EncodingFormat: "float",
	}

	jsonData, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("序列化请求失败: %v", err)
	}

	baseURL := strings.TrimSuffix(*channel.BaseURL, "/")
	url := fmt.Sprintf("%s/openai/deployments/%s/embeddings?api-version=2023-05-15", baseURL, modelName)

	logger.SysLogf("Azure OpenAI Batch Embedding API请求: URL=%s, Model=%s, Count=%d", url, modelName, len(contents))

	req, err := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, fmt.Errorf("创建请求失败: %v", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("api-key", channel.Key)

	resp, err := s.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("发送请求失败: %v", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("读取响应失败: %v", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		logger.SysLogf("Azure OpenAI API错误响应: %s", string(body))
		return nil, fmt.Errorf("API请求失败: %s, 响应: %s", resp.Status, string(body))
	}

	var embeddingResp EmbeddingResponse
	err = json.Unmarshal(body, &embeddingResp)
	if err != nil {
		return nil, fmt.Errorf("解析响应失败: %v, 响应内容: %s", err, string(body))
	}

	results := make([][]float64, len(contents))
	for _, item := range embeddingResp.Data {
		if item.Index >= 0 && item.Index < len(results) {
			results[item.Index] = item.Embedding
		}
	}

	return results, nil
}
