package embedding

import (
	"fmt"
	"strings"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

// RerankModelInfo rerank模型信息
type RerankModelInfo struct {
	ChannelID   int64  `json:"channel_id"`   // 渠道ID
	ChannelName string `json:"channel_name"` // 渠道名称
	ModelName   string `json:"model_name"`   // 模型名称
	ModelKey    string `json:"model_key"`    // 模型标识
	Provider    string `json:"provider"`     // 提供商
	Description string `json:"description"`  // 模型描述
	Status      int    `json:"status"`       // 渠道状态
}

// EmbeddingModelService embedding模型管理服务
type EmbeddingModelService struct {
	db *gorm.DB
}

// NewEmbeddingModelService 创建embedding模型服务实例
func NewEmbeddingModelService(db *gorm.DB) *EmbeddingModelService {
	return &EmbeddingModelService{
		db: db,
	}
}

// EmbeddingModelInfo embedding模型信息
type EmbeddingModelInfo struct {
	ChannelID   int64  `json:"channel_id"`   // 渠道ID
	ChannelName string `json:"channel_name"` // 渠道名称
	ModelName   string `json:"model_name"`   // 模型名称
	ModelKey    string `json:"model_key"`    // 模型标识
	Provider    string `json:"provider"`     // 提供商
	Dimensions  int    `json:"dimensions"`   // 向量维度
	MaxTokens   int    `json:"max_tokens"`   // 最大Token数
	Description string `json:"description"`  // 模型描述
	Status      int    `json:"status"`       // 渠道状态
}

// GetAvailableEmbeddingModels 获取可用的embedding模型列表
func (s *EmbeddingModelService) GetAvailableEmbeddingModels(eid int64) ([]EmbeddingModelInfo, error) {
	var channels []model.Channel
	err := s.db.Where("eid = ? AND status = ?",
		eid, model.ChannelStatusEnabled).Find(&channels).Error
	if err != nil {
		return nil, fmt.Errorf("获取embedding渠道失败: %v", err)
	}

	var modelInfos []EmbeddingModelInfo
	for _, channel := range channels {
		// 根据渠道类型获取支持的embedding模型
		embeddingModels := s.getEmbeddingModelsByChannelType(channel.Type)
		for _, modelName := range embeddingModels {
			modelInfo := EmbeddingModelInfo{
				ChannelID:   channel.ChannelID,
				ChannelName: channel.Name,
				ModelName:   modelName,
				ModelKey:    modelName,
				Provider:    s.getProviderName(channel.Type),
				Dimensions:  s.getModelDimensions(modelName),
				MaxTokens:   s.getModelMaxTokens(modelName),
				Description: s.getModelDescription(modelName),
				Status:      channel.Status,
			}
			modelInfos = append(modelInfos, modelInfo)
		}
	}

	return modelInfos, nil
}

// getEmbeddingModelsByChannelType 根据渠道类型获取支持的embedding模型
func (s *EmbeddingModelService) getEmbeddingModelsByChannelType(channelType int) []string {
	// 使用模型目录加载器获取模型列表
	loader := common.GetModelCatalogLoader()
	models, err := loader.ListEmbeddingModelsByChannelType(channelType)
	if err != nil {
		logger.SysLogf("错误: 获取渠道 %d 的embedding模型失败: %v", channelType, err)
		return []string{}
	}
	if len(models) == 0 {
		logger.SysLogf("错误: 渠道 %d 未配置embedding模型", channelType)
	}
	return models
}

// GetEmbeddingModelsByChannelID 根据渠道ID获取embedding模型
func (s *EmbeddingModelService) GetEmbeddingModelsByChannelID(eid int64, channelID int64) ([]string, error) {
	var channel model.Channel
	err := s.db.Where("eid = ? AND channel_id = ?", eid, channelID).First(&channel).Error
	if err != nil {
		return nil, fmt.Errorf("获取渠道失败: %v", err)
	}

	return s.getEmbeddingModelsByChannelType(channel.Type), nil
}

// GetChannelByEmbeddingModel 根据embedding模型获取渠道
func (s *EmbeddingModelService) GetChannelByEmbeddingModel(eid int64, modelName string) (*model.Channel, error) {
	var channels []model.Channel
	err := s.db.Where("eid = ? AND status = ?", eid, model.ChannelStatusEnabled).Find(&channels).Error
	if err != nil {
		return nil, fmt.Errorf("获取渠道失败: %v", err)
	}

	// 查找支持该模型的渠道
	var supportedChannels []model.Channel
	for _, channel := range channels {
		embeddingModels := s.getEmbeddingModelsByChannelType(channel.Type)
		for _, supportedModel := range embeddingModels {
			if supportedModel == modelName {
				supportedChannels = append(supportedChannels, channel)
				break
			}
		}
	}

	if len(supportedChannels) == 0 {
		return nil, fmt.Errorf("没有找到支持模型 %s 的渠道", modelName)
	}

	// 返回第一个支持的渠道（可以后续扩展为权重选择）
	return &supportedChannels[0], nil
}

// ValidateEmbeddingModel 验证embedding模型是否可用
func (s *EmbeddingModelService) ValidateEmbeddingModel(eid int64, channelID int64, modelName string) error {
	var channel model.Channel
	err := s.db.Where("eid = ? AND channel_id = ? AND status = ?",
		eid, channelID, model.ChannelStatusEnabled).First(&channel).Error
	if err != nil {
		return fmt.Errorf("渠道不存在或已禁用")
	}

	embeddingModels := s.getEmbeddingModelsByChannelType(channel.Type)
	for _, model := range embeddingModels {
		if model == modelName {
			return nil
		}
	}

	return fmt.Errorf("模型 %s 在渠道 %s 中不可用", modelName, channel.Name)
}

// getProviderName 根据渠道类型获取提供商名称
func (s *EmbeddingModelService) getProviderName(channelType int) string {
	providerMap := map[int]string{
		1:  "OpenAI",
		14: "Azure OpenAI",
		17: "Anthropic",
		18: "Google",
		19: "Baidu",
		20: "Alibaba",
		21: "Tencent",
		22: "FastGPT",
		23: "Cohere",
		24: "Voyage",
		25: "Jina",
	}

	if provider, exists := providerMap[channelType]; exists {
		return provider
	}
	return "Unknown"
}

// getModelDimensions 获取模型向量维度
func (s *EmbeddingModelService) getModelDimensions(modelName string) int {
	// 使用模型目录加载器获取维度
	loader := common.GetModelCatalogLoader()
	meta, err := loader.GetEmbeddingMeta(modelName)
	if err == nil && meta.Dimensions > 0 {
		return meta.Dimensions
	}

	// 记录错误：无法从目录获取模型维度信息
	fmt.Printf("警告: 无法从模型目录获取维度信息 - ModelName:%s Err:%v\n", modelName, err)
	return 0 // 返回0表示未知，调用方应以实际向量长度为准
}

// getModelMaxTokens 获取模型最大Token数
func (s *EmbeddingModelService) getModelMaxTokens(modelName string) int {
	// 使用模型目录加载器获取最大Token数
	loader := common.GetModelCatalogLoader()
	meta, err := loader.GetEmbeddingMeta(modelName)
	if err == nil && meta.MaxTokens > 0 {
		return meta.MaxTokens
	}

	// 记录错误：无法从目录获取模型最大Token信息
	fmt.Printf("警告: 无法从模型目录获取最大Token信息 - ModelName:%s Err:%v\n", modelName, err)
	return 0 // 返回0表示未知
}

// getModelDescription 获取模型描述
func (s *EmbeddingModelService) getModelDescription(modelName string) string {
	descMap := map[string]string{
		"text-embedding-ada-002":    "OpenAI Ada v2 嵌入模型，性能稳定",
		"text-embedding-3-small":    "OpenAI 第三代小型嵌入模型，效率高",
		"text-embedding-3-large":    "OpenAI 第三代大型嵌入模型，精度高",
		"text-embedding-v1":         "通义千问嵌入模型 v1",
		"embedding-v1":              "百度文心嵌入模型 v1",
		"embedding-2":               "百度文心嵌入模型 v2",
		"bge-large-zh":              "BGE 大型中文嵌入模型",
		"bge-base-zh":               "BGE 基础中文嵌入模型",
		"bge-small-zh":              "BGE 小型中文嵌入模型",
		"m3e-base":                  "M3E 基础多语言嵌入模型",
		"m3e-large":                 "M3E 大型多语言嵌入模型",
		"cohere-embed-multilingual": "Cohere 多语言嵌入模型",
		"voyage-large-2":            "Voyage AI 大型嵌入模型 v2",
		"jina-embeddings-v2-base":   "Jina AI 基础嵌入模型 v2",
	}

	if desc, exists := descMap[modelName]; exists {
		return desc
	}
	return "向量嵌入模型"
}

// GetEmbeddingModelGroups 获取按提供商分组的embedding模型
func (s *EmbeddingModelService) GetEmbeddingModelGroups(eid int64) (map[string][]EmbeddingModelInfo, error) {
	models, err := s.GetAvailableEmbeddingModels(eid)
	if err != nil {
		return nil, err
	}

	groups := make(map[string][]EmbeddingModelInfo)
	for _, model := range models {
		groups[model.Provider] = append(groups[model.Provider], model)
	}

	return groups, nil
}

// SearchEmbeddingModels 搜索embedding模型
func (s *EmbeddingModelService) SearchEmbeddingModels(eid int64, keyword string) ([]EmbeddingModelInfo, error) {
	models, err := s.GetAvailableEmbeddingModels(eid)
	if err != nil {
		return nil, err
	}

	if keyword == "" {
		return models, nil
	}

	var filteredModels []EmbeddingModelInfo
	keyword = strings.ToLower(keyword)

	for _, model := range models {
		if strings.Contains(strings.ToLower(model.ModelName), keyword) ||
			strings.Contains(strings.ToLower(model.Provider), keyword) ||
			strings.Contains(strings.ToLower(model.Description), keyword) {
			filteredModels = append(filteredModels, model)
		}
	}

	return filteredModels, nil
}

// GetDefaultEmbeddingModel 获取默认的embedding模型
func (s *EmbeddingModelService) GetDefaultEmbeddingModel(eid int64) (*EmbeddingModelInfo, error) {
	models, err := s.GetAvailableEmbeddingModels(eid)
	if err != nil {
		return nil, err
	}

	if len(models) == 0 {
		return nil, fmt.Errorf("没有可用的embedding模型")
	}

	// 优先选择OpenAI的模型
	for _, model := range models {
		if model.Provider == "OpenAI" && strings.Contains(model.ModelName, "text-embedding") {
			return &model, nil
		}
	}

	// 如果没有OpenAI模型，返回第一个可用模型
	return &models[0], nil
}

// GetRerankModels 获取可用的rerank模型列表
func (s *EmbeddingModelService) GetRerankModels(eid int64) ([]RerankModelInfo, error) {
	var channels []model.Channel
	err := s.db.Where("eid = ? AND status = ?",
		eid, model.ChannelStatusEnabled).Find(&channels).Error
	if err != nil {
		return nil, fmt.Errorf("获取rerank渠道失败: %v", err)
	}

	var modelInfos []RerankModelInfo
	for _, channel := range channels {
		// 根据渠道类型获取支持的rerank模型
		rerankModels := s.getRerankModelsByChannelType(channel.Type)
		for _, modelName := range rerankModels {
			modelInfo := RerankModelInfo{
				ChannelID:   channel.ChannelID,
				ChannelName: channel.Name,
				ModelName:   modelName,
				ModelKey:    modelName,
				Provider:    s.getProviderName(channel.Type),
				Description: s.getRerankModelDescription(modelName),
				Status:      channel.Status,
			}
			modelInfos = append(modelInfos, modelInfo)
		}
	}

	return modelInfos, nil
}

// getRerankModelsByChannelType 根据渠道类型获取支持的rerank模型
func (s *EmbeddingModelService) getRerankModelsByChannelType(channelType int) []string {
	// 使用模型目录加载器获取模型列表
	loader := common.GetModelCatalogLoader()
	models, err := loader.ListRerankModelsByChannelType(channelType)
	if err != nil {
		logger.SysLogf("错误: 获取渠道 %d 的rerank模型失败: %v", channelType, err)
		return []string{}
	}
	if len(models) == 0 {
		logger.SysLogf("错误: 渠道 %d 未配置rerank模型", channelType)
	}
	return models
}

// getRerankModelDescription 获取rerank模型描述
func (s *EmbeddingModelService) getRerankModelDescription(modelName string) string {
	descMap := map[string]string{
		"rerank-english-v2.0":      "Cohere 英文重排序模型 v2.0",
		"rerank-multilingual-v2.0": "Cohere 多语言重排序模型 v2.0",
	}

	if desc, exists := descMap[modelName]; exists {
		return desc
	}
	return "重排序模型"
}

// GetDefaultRerankModel 获取默认的rerank模型
func (s *EmbeddingModelService) GetDefaultRerankModel(eid int64) (*RerankModelInfo, error) {
	models, err := s.GetRerankModels(eid)
	if err != nil {
		return nil, err
	}

	if len(models) == 0 {
		return nil, fmt.Errorf("没有可用的rerank模型")
	}

	// 优先选择Cohere的模型
	for _, model := range models {
		if model.Provider == "Cohere" && strings.Contains(model.ModelName, "rerank") {
			return &model, nil
		}
	}

	// 如果没有Cohere模型，返回第一个可用模型
	return &models[0], nil
}
