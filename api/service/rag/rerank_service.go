package rag

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"github.com/songquanpeng/one-api/relay/adaptor/openai"
	relay_channeltype "github.com/songquanpeng/one-api/relay/channeltype"
	"github.com/songquanpeng/one-api/relay/meta"
	relay_model "github.com/songquanpeng/one-api/relay/model"
	"gorm.io/gorm"
)

// RerankRequest represents the request structure for rerank API
type RerankRequest struct {
	Model           string   `json:"model" example:"gte-rerank-v2" binding:"required"`                                                                               // Model name for reranking
	Query           string   `json:"query" example:"人工智能的发展历程" binding:"required"`                                                                                   // Query text to compare against documents
	Documents       []string `json:"documents" example:"[\"人工智能起源于1950年代，图灵提出了著名的图灵测试\",\"深度学习是机器学习的一个分支，使用神经网络进行学习\",\"自然语言处理是人工智能的重要应用领域之一\"]" binding:"required"` // List of documents to rerank
	TopN            *int     `json:"top_n,omitempty" example:"3"`                                                                                                    // Number of top results to return
	ReturnDocuments *bool    `json:"return_documents,omitempty" example:"true"`                                                                                      // Whether to return document content in response
}

// RerankResponse represents the response structure for rerank API
type RerankResponse struct {
	Object string         `json:"object" example:"list"`         // Response object type
	Data   []RerankResult `json:"data"`                          // Array of rerank results
	Model  string         `json:"model" example:"gte-rerank-v2"` // Model used for reranking
	Usage  RerankUsage    `json:"usage"`                         // Token usage information
}

// RerankResult represents a single rerank result
type RerankResult struct {
	Object         string          `json:"object" example:"rerank_result"` // Result object type
	Index          int             `json:"index" example:"0"`              // Original index in input documents
	RelevanceScore float64         `json:"relevance_score" example:"0.95"` // Relevance score (0-1)
	Document       *RerankDocument `json:"document,omitempty"`             // Document content (if return_documents=true)
}

// RerankDocument represents document content in rerank result
type RerankDocument struct {
	Text string `json:"text" example:"文档内容"` // Document text content
}

// RerankUsage represents token usage information for rerank
type RerankUsage struct {
	TotalTokens int `json:"total_tokens" example:"150"` // Total tokens used
}

// RerankService 重排服务
type RerankService struct {
	db *gorm.DB
	// 可能需要其他依赖，例如用于模型重排的HTTP客户端或特定适配器
	// embeddingService *EmbeddingService // 用于权重重排中的向量相似度计算
	// tokenizerService *TokenizerService // 用于权重重排中的关键词匹配
}

// NewRerankService 创建重排服务实例
func NewRerankService(db *gorm.DB) *RerankService {
	return &RerankService{
		db: db,
		// 初始化其他依赖
		// embeddingService: NewEmbeddingService(db),
		// tokenizerService: NewTokenizerService(),
	}
}

// PerformRerank 执行重排的入口方法
// query: 用户查询
// initialResults: 经过初步检索（向量、全文、混合）得到的原始结果
// config: 知识库的SearchConfigData配置，包含重排参数
func (s *RerankService) PerformRerank(
	ctx context.Context,
	eid int64,
	query string,
	initialResults []SearchResultItem,
	config *model.SearchConfigData,
) ([]SearchResultItem, error) {
	if config == nil || !config.RerankingEnable {
		// 如果未启用重排，直接返回原始结果
		return initialResults, nil
	}
	logger.Debugf(ctx, "【重排】开始执行: eid=%d, query=%q, initial_results=%d, rerank_model=%s, rerank_model_name=%s, top_k=%d, threshold_enabled=%v, threshold=%.4f",
		eid, truncateForDebug(query, 256), len(initialResults), config.RerankModel, config.RerankModelName, config.TopK,
		config.ScoreThresholdEnabled, config.ScoreThreshold)

	// 1. 文档去重处理 (参考流程图 3.4)
	deduplicatedResults := s.deduplicateDocuments(initialResults)
	logger.Debugf(ctx, "【重排】去重完成: before=%d, after=%d, sample=%v",
		len(initialResults), len(deduplicatedResults), previewSearchResultsForDebug(deduplicatedResults, 5))

	// 如果去重后的候选数已经不超过最终返回数量，就没有必要再做重排了
	if config.TopK > 0 && len(deduplicatedResults) <= config.TopK {
		logger.Debugf(ctx, "【重排】候选数已不超过 top_k，跳过重排: deduplicated=%d, top_k=%d",
			len(deduplicatedResults), config.TopK)
		return s.applyTopKLimit(deduplicatedResults, config), nil
	}

	// 2. 根据RerankModel选择重排方式 (参考流程图 3.1)
	var rerankedResults []SearchResultItem
	var err error

	switch config.RerankModel {
	case "reranking_model":
		// 模型重排 (参考流程图 3.2)
		rerankedResults, err = s.modelRerank(ctx, eid, query, deduplicatedResults, config)
	case "weighted_score":
		// 权重重排 (参考流程图 3.3)
		rerankedResults, err = s.weightedScoreRerank(ctx, eid, query, deduplicatedResults, config)
	default:
		// 如果RerankModel未指定或不支持，则默认不进行重排，直接应用过滤和TopK
		logger.SysLogf("警告: 不支持的重排模型 '%s'，跳过模型重排。", config.RerankModel)
		rerankedResults = deduplicatedResults
	}

	if err != nil {
		// 如果重排过程中发生错误，可以选择返回原始去重结果或报错
		logger.SysErrorf("重排过程中发生错误: %v，返回去重后的原始结果。", err)
		return deduplicatedResults, err // 或者直接返回 err
	}

	// 3. 仅应用TopK限制；分数阈值应在召回阶段完成，不在重排阶段重复过滤
	finalResults := s.applyTopKLimit(rerankedResults, config)
	logger.Debugf(ctx, "【重排】完成: reranked=%d, final=%d, sample=%v",
		len(rerankedResults), len(finalResults), previewSearchResultsForDebug(finalResults, 5))

	return finalResults, nil
}

// modelRerank 执行模型重排 (参考流程图 3.2)
func (s *RerankService) modelRerank(
	ctx context.Context,
	eid int64,
	query string,
	documents []SearchResultItem,
	config *model.SearchConfigData,
) ([]SearchResultItem, error) {
	if len(documents) == 0 {
		return []SearchResultItem{}, nil
	}

	// 提取文档文本内容
	var docTexts []string
	for _, doc := range documents {
		docTexts = append(docTexts, doc.Content)
	}

	// 构建模型请求参数
	topN := len(docTexts)
	rerankReq := &RerankRequest{
		Model:     config.RerankModelName, // 使用配置中的模型名称
		Query:     query,
		Documents: docTexts,
		// 不在重排前按 TopK 预裁剪，要求模型对全量候选排序。
		TopN: &topN,
	}
	logger.Debugf(ctx, "【重排】构建请求: model=%s, doc_count=%d, query_first_50=%q, doc_first_50=%v",
		rerankReq.Model, len(rerankReq.Documents), firstNRunesForDebug(rerankReq.Query, 50),
		previewDocumentsForDebug(rerankReq.Documents, 10, 50))

	// 获取重排渠道
	channelType := getChannelTypeByModel(config.RerankModelName)
	if channelType == -1 {
		return nil, fmt.Errorf("不支持的 rerank 模型类型: %s", config.RerankModelName)
	}
	logger.Debugf(ctx, "【重排】模型渠道映射: model=%s, channel_type=%d", config.RerankModelName, channelType)

	var channel *model.Channel
	var err error
	if config.RerankChannelId != 0 {
		channel, err = model.GetChannelByID(int64(config.RerankChannelId))
		if err != nil || channel.Eid != eid || channel.Type != channelType || channel.Status != model.ChannelStatusEnabled {
			logger.SysLogf("警告: 获取指定 rerank 渠道 %d 失败或不可用，尝试获取随机渠道。", config.RerankChannelId)
			channel, err = model.GetRandomChannel(eid, channelType, config.RerankModelName)
		}
	} else {
		channel, err = model.GetRandomChannel(eid, channelType, config.RerankModelName)
	}

	if err != nil {
		return nil, fmt.Errorf("获取 rerank 渠道失败: %v", err)
	}
	logger.Debugf(ctx, "【重排】选中渠道: channel_id=%d, channel_type=%d, channel_name=%s, base_url=%s",
		channel.ChannelID, channel.Type, channel.Name, safeBaseURL(channel.BaseURL))

	// 调用外部重排模型
	rerankResp, _, err := callExternalRerankAPI(ctx, rerankReq, channel)
	if err != nil {
		return nil, fmt.Errorf("调用外部重排模型失败: %v", err)
	}
	logger.Debugf(ctx, "【重排】外部接口响应: result_count=%d, sample=%v",
		len(rerankResp.Data), previewRerankResultsForDebug(rerankResp.Data, 5))

	// 解析模型返回结果并构建文档对象
	rerankedMap := make(map[int64]float64) // chunkID -> relevance_score
	for _, data := range rerankResp.Data {
		// 确保索引有效
		if data.Index >= 0 && data.Index < len(documents) {
			originalChunkID := documents[data.Index].ChunkID
			rerankedMap[originalChunkID] = data.RelevanceScore
		}
	}

	var resultsWithScores []SearchResultItem
	for _, doc := range documents {
		if score, ok := rerankedMap[doc.ChunkID]; ok {
			doc.Score = score // 更新分数
			resultsWithScores = append(resultsWithScores, doc)
		}
	}

	// 按分数降序排序
	sort.Slice(resultsWithScores, func(i, j int) bool {
		return resultsWithScores[i].Score > resultsWithScores[j].Score
	})

	return resultsWithScores, nil
}

// weightedScoreRerank 执行权重重排 (参考流程图 3.3)
func (s *RerankService) weightedScoreRerank(
	ctx context.Context,
	eid int64,
	query string,
	documents []SearchResultItem,
	config *model.SearchConfigData,
) ([]SearchResultItem, error) {
	if len(documents) == 0 {
		return []SearchResultItem{}, nil
	}

	// 获取权重配置
	keywordWeight := config.Weights.KeywordSetting.KeywordWeight
	vectorWeight := config.Weights.VectorSetting.VectorWeight

	// 确保权重和为1，或者进行归一化
	totalWeight := keywordWeight + vectorWeight
	if totalWeight == 0 {
		// 避免除以零，如果权重都为0，则不进行加权，按原始分数排序
		return documents, nil
	}
	keywordWeight /= totalWeight
	vectorWeight /= totalWeight

	// 获取查询的向量 (如果需要) - 暂时省略，假设vectorScore已在SearchResultItem中
	// embeddingService := NewEmbeddingService(s.db) // 假设已注入或创建
	// queryVector, err := embeddingService.GetQueryEmbedding(eid, query, /* channelID */, /* config */)
	// if err != nil {
	// 	fmt.Printf("警告: 生成查询向量失败，可能影响权重重排的向量部分: %v\n", err)
	// }

	var weightedResults []SearchResultItem
	for _, doc := range documents {
		// 计算向量相似度分数 (假设SearchService已经返回了vectorScore)
		// 如果没有，这里需要重新计算或从元数据中获取
		vectorScore := doc.VectorScore // 假设这个字段在SearchResultItem中存在并被填充

		// 计算关键词匹配分数
		textScore := s.calculateTextScore(doc.Content, query)

		// 计算综合分数
		combinedScore := (vectorScore * vectorWeight) + (textScore * keywordWeight)

		doc.Score = combinedScore // 更新分数
		weightedResults = append(weightedResults, doc)
	}

	// 按综合分数降序排序
	sort.Slice(weightedResults, func(i, j int) bool {
		return weightedResults[i].Score > weightedResults[j].Score
	})

	return weightedResults, nil
}

// deduplicateDocuments 文档去重处理 (参考流程图 3.4)
func (s *RerankService) deduplicateDocuments(documents []SearchResultItem) []SearchResultItem {
	uniqueDocs := make(map[int64]struct{}) // 使用ChunkID作为唯一标识
	result := make([]SearchResultItem, 0, len(documents))
	for _, doc := range documents {
		// 简单的去重，保留第一个遇到的，并维持输入顺序
		if _, exists := uniqueDocs[doc.ChunkID]; exists {
			continue
		}
		uniqueDocs[doc.ChunkID] = struct{}{}
		result = append(result, doc)
	}
	return result
}

// applyTopKLimit 仅应用TopK限制
func (s *RerankService) applyTopKLimit(
	results []SearchResultItem,
	config *model.SearchConfigData,
) []SearchResultItem {
	if config == nil {
		return results
	}

	if config.TopK > 0 && len(results) > config.TopK {
		return results[:config.TopK]
	}

	return results
}

// calculateTextScore 简单的文本相关性分数计算 (可复用SearchService中的逻辑)
func (s *RerankService) calculateTextScore(content, query string) float64 {
	contentLower := strings.ToLower(content)
	queryLower := strings.ToLower(query)

	// 计算查询词在内容中的出现次数
	count := strings.Count(contentLower, queryLower)
	if count == 0 {
		return 0.0
	}

	// 简单的相关性分数：出现次数 / 内容长度
	score := float64(count) / float64(len(content)) * 1000

	// 限制分数范围
	if score > 1.0 {
		score = 1.0
	}

	return score
}

// callExternalRerankAPI 调用外部Rerank API的函数
func callExternalRerankAPI(ctx context.Context, req *RerankRequest, channel *model.Channel) (*RerankResponse, *relay_model.Usage, error) {
	// 创建元数据
	meta := &meta.Meta{
		Mode:            0, // rerank 模式
		ChannelType:     channel.Type,
		ChannelId:       int(channel.ChannelID),
		UserId:          0, // 在服务层中暂时使用默认值
		OriginModelName: req.Model,
		ActualModelName: req.Model,
		APIType:         model.GetApiType(channel.Type),
		APIKey:          channel.Key,
	}

	if channel.BaseURL != nil {
		meta.BaseURL = *channel.BaseURL
	}
	logger.Debugf(ctx, "【重排】调用外部接口: channel_id=%d, channel_type=%d, api_type=%d, model=%s, query_first_50=%q, doc_count=%d, top_n=%d, return_documents=%v, base_url=%s",
		channel.ChannelID, channel.Type, meta.APIType, req.Model, firstNRunesForDebug(req.Query, 50), len(req.Documents),
		derefIntForDebug(req.TopN), derefBoolForDebug(req.ReturnDocuments), meta.BaseURL)

	// 根据渠道类型处理请求
	switch channel.Type {
	case model.ChannelApiBailian, relay_channeltype.Ali:
		return executeBailianRerankRequest(ctx, req, meta)
	case relay_channeltype.SiliconFlow: // 硅基流动渠道类型
		return executeSiliconFlowRerankRequest(ctx, req, meta)
	case model.ChannelApiTypeAppBuilderModel: // 百度千帆渠道类型
		return executeBaiduQianfanRerankRequest(ctx, req, meta)
	default:
		return nil, nil, fmt.Errorf("不支持的渠道类型: %d (channel_id=%d, channel_name=%s)", channel.Type, channel.ChannelID, channel.Name)
	}
}

// callExternalRerankAPIWithoutGinContext 调用外部重排API，处理没有gin.Context的情况
func (s *RerankService) callExternalRerankAPIWithoutGinContext(ctx context.Context, req *RerankRequest, channel *model.Channel) (*RerankResponse, *relay_model.Usage, error) {
	// 创建元数据
	meta := &meta.Meta{
		Mode:            0, // rerank 模式
		ChannelType:     channel.Type,
		ChannelId:       int(channel.ChannelID),
		UserId:          0, // 在服务层中暂时使用默认值
		OriginModelName: req.Model,
		ActualModelName: req.Model,
		APIType:         model.GetApiType(channel.Type),
		APIKey:          channel.Key,
	}

	if channel.BaseURL != nil {
		meta.BaseURL = *channel.BaseURL
	}
	logger.Debugf(ctx, "【重排】无Gin上下文调用外部接口: channel_id=%d, channel_type=%d, api_type=%d, model=%s, query_first_50=%q, doc_count=%d, top_n=%d, return_documents=%v, base_url=%s",
		channel.ChannelID, channel.Type, meta.APIType, req.Model, firstNRunesForDebug(req.Query, 50), len(req.Documents),
		derefIntForDebug(req.TopN), derefBoolForDebug(req.ReturnDocuments), meta.BaseURL)

	// 根据渠道类型处理请求
	switch channel.Type {
	case model.ChannelApiBailian, relay_channeltype.Ali:
		return executeBailianRerankRequest(ctx, req, meta)
	case relay_channeltype.SiliconFlow: // 硅基流动
		return executeSiliconFlowRerankRequest(ctx, req, meta)
	case model.ChannelApiTypeAppBuilderModel: // 百度千帆
		return executeBaiduQianfanRerankRequest(ctx, req, meta)
	default:
		return nil, nil, fmt.Errorf("不支持的渠道类型: %d (channel_id=%d, channel_name=%s)", channel.Type, channel.ChannelID, channel.Name)
	}
}

// convertBailianRerankResponse 转换百炼 rerank 响应为标准格式
func convertBailianRerankResponse(bailianResp map[string]interface{}, req *RerankRequest) (*RerankResponse, *relay_model.Usage, error) {
	// 解析输出数据
	output, ok := bailianResp["output"].(map[string]interface{})
	if !ok {
		return nil, nil, errors.New("响应格式错误：缺少 output 字段")
	}

	results, ok := output["results"].([]interface{})
	if !ok {
		return nil, nil, errors.New("响应格式错误：缺少 results 字段")
	}

	// 转换结果
	var rerankResults []RerankResult
	for _, result := range results {
		resultMap, ok := result.(map[string]interface{})
		if !ok {
			continue
		}

		index, _ := resultMap["index"].(float64)
		score, _ := resultMap["relevance_score"].(float64)

		rerankResult := RerankResult{
			Object:         "rerank_result",
			Index:          int(index),
			RelevanceScore: score,
		}

		// 如果需要返回文档内容
		if req.ReturnDocuments != nil && *req.ReturnDocuments {
			if int(index) < len(req.Documents) {
				rerankResult.Document = &RerankDocument{
					Text: req.Documents[int(index)],
				}
			}
		}

		rerankResults = append(rerankResults, rerankResult)
	}

	// 计算 token 使用量 (这里简化，实际需要根据模型和响应计算)
	usage := &relay_model.Usage{
		PromptTokens:     0, // 实际需要计算
		CompletionTokens: 0, // 实际需要计算
		TotalTokens:      0, // 实际需要计算
	}

	response := &RerankResponse{
		Object: "list",
		Data:   rerankResults,
		Model:  req.Model,
		Usage: RerankUsage{
			TotalTokens: usage.TotalTokens,
		},
	}

	return response, usage, nil
}

// getChannelTypeByModel 根据模型名称获取渠道类型
func getChannelTypeByModel(modelName string) int {
	// 使用模型目录加载器获取渠道类型
	loader := common.GetModelCatalogLoader()
	channelType := loader.GetChannelTypeByRerankModel(modelName)
	if channelType != -1 {
		return channelType
	}

	// 如果没有找到，检查是否为百炼模型的特殊前缀
	if strings.HasPrefix(modelName, "gte-rerank") {
		return model.ChannelApiBailian
	}

	// 检查是否为硅基流动平台的rerank模型
	if isRerankModelFromSiliconFlow(modelName) {
		return relay_channeltype.SiliconFlow
	}

	return -1 // 不支持的模型
}

// isRerankModelFromSiliconFlow 检查rerank模型是否来自硅基流动平台
func isRerankModelFromSiliconFlow(modelName string) bool {
	loader := common.GetModelCatalogLoader()

	// 先检查模型是否为rerank模型
	if !loader.IsRerankModel(modelName) {
		return false
	}

	// 获取硅基流动平台的rerank模型列表
	siliconFlowChannelType := relay_channeltype.SiliconFlow
	models, err := loader.ListRerankModelsByChannelType(siliconFlowChannelType)
	if err != nil {
		return false
	}

	// 检查模型名是否在硅基流动的rerank模型列表中
	for _, modelID := range models {
		if modelID == modelName {
			return true
		}
	}

	return false
}

// calculateRerankUsage 计算 rerank 的 token 使用量
func calculateRerankUsage(req *RerankRequest, resultCount int) *relay_model.Usage {
	// 计算输入 token（query + documents）
	queryTokens := openai.CountTokenText(req.Query, req.Model)

	documentsText := strings.Join(req.Documents, " ")
	documentsTokens := openai.CountTokenText(documentsText, req.Model)

	promptTokens := queryTokens + documentsTokens

	// rerank 通常没有生成内容，completion tokens 为 0
	completionTokens := 0

	totalTokens := promptTokens + completionTokens

	return &relay_model.Usage{
		PromptTokens:     promptTokens,
		CompletionTokens: completionTokens,
		TotalTokens:      totalTokens,
	}
}

// executeBailianRerankRequest 执行百炼rerank请求
func executeBailianRerankRequest(ctx context.Context, req *RerankRequest, meta *meta.Meta) (*RerankResponse, *relay_model.Usage, error) {
	// 构建请求体 - 根据百炼API文档格式
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
	logger.Debugf(ctx, "【重排】百炼请求参数: query_first_50=%q, doc_count=%d, doc_first_50=%v",
		firstNRunesForDebug(req.Query, 50), len(req.Documents), previewDocumentsForDebug(req.Documents, 10, 50))

	// 构建请求 URL
	baseUrl := meta.BaseURL
	if baseUrl == "" {
		baseUrl = "https://api.bailianai.com" // 默认百炼 API 地址
	}
	url := fmt.Sprintf("%s/v1/rerank", baseUrl)

	// 创建HTTP请求
	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, strings.NewReader(string(requestBody)))
	if err != nil {
		logger.SysErrorf("❌ 创建HTTP请求失败: %v", err)
		return nil, nil, fmt.Errorf("创建请求失败: %v", err)
	}

	// 设置请求头
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+meta.APIKey)

	// 发送请求
	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		logger.SysErrorf("❌ 百炼Rerank请求失败: %v", err)
		return nil, nil, fmt.Errorf("发送请求失败: %v", err)
	}
	defer resp.Body.Close()

	// 检查响应状态
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		logger.SysErrorf("❌ 百炼Rerank请求失败 - 状态码: %d, 响应: %s", resp.StatusCode, string(body))
		return nil, nil, fmt.Errorf("请求失败，状态码: %d, 响应: %s", resp.StatusCode, string(body))
	}

	// 读取响应体
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		logger.SysErrorf("❌ 读取响应体失败: %v", err)
		return nil, nil, fmt.Errorf("读取响应体失败: %v", err)
	}

	// 解析百炼响应
	var bailianResp map[string]interface{}
	if err := json.Unmarshal(respBody, &bailianResp); err != nil {
		logger.SysErrorf("❌ 解析百炼Rerank响应失败: %v", err)
		return nil, nil, fmt.Errorf("解析响应失败: %v", err)
	}

	// 转换为标准格式
	return convertBailianRerankResponse(bailianResp, req)
}

// executeSiliconFlowRerankRequest 执行硅基流动rerank请求
func executeSiliconFlowRerankRequest(ctx context.Context, req *RerankRequest, meta *meta.Meta) (*RerankResponse, *relay_model.Usage, error) {
	// 构建请求体 - 根据硅基流动API文档格式
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
	logger.Debugf(ctx, "【重排】硅基流动请求参数: query_first_50=%q, doc_count=%d, doc_first_50=%v",
		firstNRunesForDebug(req.Query, 50), len(req.Documents), previewDocumentsForDebug(req.Documents, 10, 50))

	// 构建请求 URL
	baseUrl := meta.BaseURL
	if baseUrl == "" {
		baseUrl = "https://api.siliconflow.cn" // 默认硅基流动 API 地址
	}
	url := fmt.Sprintf("%s/v1/rerank", baseUrl)

	// 创建HTTP请求
	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, strings.NewReader(string(requestBody)))
	if err != nil {
		logger.SysErrorf("❌ 创建HTTP请求失败: %v", err)
		return nil, nil, fmt.Errorf("创建请求失败: %v", err)
	}

	// 设置请求头
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+meta.APIKey)

	// 发送请求
	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		logger.SysErrorf("❌ 硅基流动Rerank请求失败: %v", err)
		return nil, nil, fmt.Errorf("发送请求失败: %v", err)
	}
	defer resp.Body.Close()

	// 检查响应状态
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		logger.SysErrorf("❌ 硅基流动Rerank请求失败 - 状态码: %d, 响应: %s", resp.StatusCode, string(body))
		return nil, nil, fmt.Errorf("请求失败，状态码: %d, 响应: %s", resp.StatusCode, string(body))
	}

	// 读取响应体
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		logger.SysErrorf("❌ 读取响应体失败: %v", err)
		return nil, nil, fmt.Errorf("读取响应体失败: %v", err)
	}

	// 解析硅基流动响应
	var siliconFlowResp map[string]interface{}
	if err := json.Unmarshal(respBody, &siliconFlowResp); err != nil {
		logger.SysErrorf("❌ 解析硅基流动Rerank响应失败: %v", err)
		return nil, nil, fmt.Errorf("解析响应失败: %v", err)
	}

	// 转换为标准格式
	// 硅基流动返回字段存在版本差异：
	// - 新格式: results
	// - 旧格式: data
	// 这里优先兼容 results，并保留 data 兜底。
	var (
		data []interface{}
		ok   bool
	)
	if data, ok = siliconFlowResp["results"].([]interface{}); !ok {
		data, ok = siliconFlowResp["data"].([]interface{})
	}
	if !ok {
		return nil, nil, fmt.Errorf("响应格式错误：缺少 results/data 字段或格式不正确")
	}

	openaiResp := &RerankResponse{
		Object: "list",
		Model:  req.Model,
		Data:   make([]RerankResult, len(data)),
		Usage: RerankUsage{
			TotalTokens: 0, // 硅基流动API可能不返回token使用情况
		},
	}

	for i, item := range data {
		itemMap, ok := item.(map[string]interface{})
		if !ok {
			continue
		}

		index, _ := itemMap["index"].(float64)
		relevanceScore, _ := itemMap["relevance_score"].(float64)

		openaiResult := RerankResult{
			Object:         "rerank_result",
			Index:          int(index),
			RelevanceScore: relevanceScore,
		}

		// 如果需要返回文档内容
		document, exists := itemMap["document"].(map[string]interface{})
		if exists && req.ReturnDocuments != nil && *req.ReturnDocuments {
			if text, textExists := document["text"].(string); textExists {
				openaiResult.Document = &RerankDocument{
					Text: text,
				}
			}
		}

		openaiResp.Data[i] = openaiResult
	}

	// 计算 token 使用量
	usage := calculateRerankUsage(req, len(data))

	return openaiResp, usage, nil
}

// executeBaiduQianfanRerankRequest 执行百度千帆rerank请求
func executeBaiduQianfanRerankRequest(ctx context.Context, req *RerankRequest, meta *meta.Meta) (*RerankResponse, *relay_model.Usage, error) {
	// 构建请求体 - 根据百度千帆API文档格式
	requestData := map[string]interface{}{
		"model_id":              req.Model,
		"query":                 req.Query,
		"texts":                 req.Documents,
		"return_reranker_score": true, // 需要返回重排序得分
	}

	// 添加可选参数
	if req.TopN != nil {
		requestData["top_n"] = *req.TopN
	}
	if req.ReturnDocuments != nil {
		requestData["return_text"] = *req.ReturnDocuments
	}

	requestBody, err := json.Marshal(requestData)
	if err != nil {
		return nil, nil, fmt.Errorf("序列化请求失败: %v", err)
	}
	logger.Debugf(ctx, "【重排】百度千帆请求参数: query_first_50=%q, doc_count=%d, doc_first_50=%v",
		firstNRunesForDebug(req.Query, 50), len(req.Documents), previewDocumentsForDebug(req.Documents, 10, 50))

	// 构建请求 URL
	baseUrl := meta.BaseURL
	if baseUrl == "" {
		baseUrl = "https://qianfan.baidubce.com" // 默认百度千帆 API 地址
	}
	url := fmt.Sprintf("%s/reranker/v1/%s", strings.TrimSuffix(baseUrl, "/"), req.Model)

	// 创建HTTP请求
	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, strings.NewReader(string(requestBody)))
	if err != nil {
		logger.SysErrorf("❌ 创建HTTP请求失败: %v", err)
		return nil, nil, fmt.Errorf("创建请求失败: %v", err)
	}

	// 设置请求头
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+meta.APIKey)

	// 发送请求
	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		logger.SysErrorf("❌ 百度千帆Rerank请求失败: %v", err)
		return nil, nil, fmt.Errorf("发送请求失败: %v", err)
	}
	defer resp.Body.Close()

	// 检查响应状态
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		logger.SysErrorf("❌ 百度千帆Rerank请求失败 - 状态码: %d, 响应: %s", resp.StatusCode, string(body))
		return nil, nil, fmt.Errorf("请求失败，状态码: %d, 响应: %s", resp.StatusCode, string(body))
	}

	// 读取响应体
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		logger.SysErrorf("❌ 读取响应体失败: %v", err)
		return nil, nil, fmt.Errorf("读取响应体失败: %v", err)
	}

	// 解析百度千帆响应
	var qianfanResp map[string]interface{}
	if err := json.Unmarshal(respBody, &qianfanResp); err != nil {
		logger.SysErrorf("❌ 解析百度千帆Rerank响应失败: %v", err)
		return nil, nil, fmt.Errorf("解析响应失败: %v", err)
	}

	// 转换为标准格式
	data, ok := qianfanResp["results"].([]interface{})
	if !ok {
		return nil, nil, fmt.Errorf("响应格式错误：缺少 results 字段或格式不正确")
	}

	openaiResp := &RerankResponse{
		Object: "list",
		Model:  req.Model,
		Data:   make([]RerankResult, len(data)),
		Usage: RerankUsage{
			TotalTokens: 0, // 百度千帆API可能不返回token使用情况
		},
	}

	for i, item := range data {
		itemMap, ok := item.(map[string]interface{})
		if !ok {
			continue
		}

		index, _ := itemMap["index"].(float64)
		relevanceScore, _ := itemMap["relevance_score"].(float64)

		openaiResult := RerankResult{
			Object:         "rerank_result",
			Index:          int(index),
			RelevanceScore: relevanceScore,
		}

		// 如果需要返回文档内容
		if req.ReturnDocuments == nil || *req.ReturnDocuments {
			text, exists := itemMap["text"].(string)
			if exists && int(index) < len(req.Documents) {
				openaiResult.Document = &RerankDocument{
					Text: text,
				}
			}
		}

		openaiResp.Data[i] = openaiResult
	}

	// 计算 token 使用量
	usage := calculateRerankUsage(req, len(data))

	return openaiResp, usage, nil
}
