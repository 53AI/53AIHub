package common

import (
	"encoding/json"
	"fmt"
	"sync"

	"github.com/53AI/53AIHub/common/logger"
)

// EmbeddingModelMeta embedding模型元数据
type EmbeddingModelMeta struct {
	ModelID     string `json:"model_id"`
	ModelName   string `json:"model_name"`
	Dimensions  int    `json:"dimensions"`
	MaxTokens   int    `json:"max_tokens"`
	Provider    string `json:"provider"`
	PlatformID  string `json:"platform_id"`
	ChannelType int    `json:"channel_type"`
}

// ChatModelMeta 聊天模型元数据
type ChatModelMeta struct {
	ModelID     string `json:"model_id"`
	ModelName   string `json:"model_name"`
	CategoryID  string `json:"category_id"`
	PlatformID  string `json:"platform_id"`
	Enabled     bool   `json:"enabled"`
}

// RerankModelMeta rerank模型元数据
type RerankModelMeta struct {
	ModelID     string `json:"model_id"`
	ModelName   string `json:"model_name"`
	CategoryID  string `json:"category_id"`
	PlatformID  string `json:"platform_id"`
	Enabled     bool   `json:"enabled"`
}

// ModelCatalog 模型目录结构
type ModelCatalog struct {
	Platforms []Platform `json:"platforms"`
}

type Platform struct {
	PlatformName string     `json:"platform_name"`
	PlatformID   string     `json:"platform_id"`
	ChannelType  int        `json:"channel_type"`
	CanMultiple  bool       `json:"can_multiple"`
	Categories   []Category `json:"categories"`
}

type Category struct {
	ModelType  int     `json:"model_type"`
	CategoryID string  `json:"category_id"`  // 添加 CategoryID 字段
	Models     []Model `json:"models"`
}

type Model struct {
	ModelID      string `json:"model_id"`
	ModelName    string `json:"model_name"`
	Dimensions   int    `json:"dimensions,omitempty"`
	MaxTokens    int    `json:"max_tokens,omitempty"`
	DeepThinking bool   `json:"deep_thinking,omitempty"`
	Vision       bool   `json:"vision,omitempty"`
}

// ModelCatalogLoader 模型目录加载器
type ModelCatalogLoader struct {
	catalog          *ModelCatalog
	embeddingModels  map[string]*EmbeddingModelMeta
	channelModels    map[int][]string                    // 模型按渠道类型索引
	rerankModels     map[string]*RerankModelMeta         // rerank模型索引（按模型ID）
	chatModels       map[string]*ChatModelMeta           // 对话模型索引（按模型ID）
	unknownModelType map[int]bool                        // 记录遇到的未知模型类型
	once             sync.Once
	loadErr          error
}

var globalLoader = &ModelCatalogLoader{}

// GetModelCatalogLoader 获取全局模型目录加载器
func GetModelCatalogLoader() *ModelCatalogLoader {
	globalLoader.once.Do(func() {
		globalLoader.loadErr = globalLoader.load()
	})
	return globalLoader
}

// load 加载模型目录
func (l *ModelCatalogLoader) load() error {
	var catalog ModelCatalog
	if err := json.Unmarshal([]byte(KmModelsJSON), &catalog); err != nil {
		return fmt.Errorf("failed to unmarshal model catalog: %v", err)
	}

	l.catalog = &catalog
	l.embeddingModels = make(map[string]*EmbeddingModelMeta)
	l.channelModels = make(map[int][]string)  // 初始化 channelModels
	l.rerankModels = make(map[string]*RerankModelMeta)
	l.chatModels = make(map[string]*ChatModelMeta)
	l.unknownModelType = make(map[int]bool)

	// 构建embedding模型索引、rerank模型索引和对话模型索引
	for _, platform := range catalog.Platforms {
		for _, category := range platform.Categories {
			switch category.ModelType {
			case 1: // chat模型
				for _, model := range category.Models {
					meta := &ChatModelMeta{
						ModelID:     model.ModelID,
						ModelName:   model.ModelName,
						CategoryID:  category.CategoryID,
						PlatformID:  platform.PlatformID,
						Enabled:     true, // 默认启用
					}
					l.chatModels[model.ModelID] = meta
				}
				// 添加到渠道类型索引
				if platform.ChannelType != 0 {
					for _, model := range category.Models {
						l.channelModels[platform.ChannelType] = append(l.channelModels[platform.ChannelType], model.ModelID)
					}
				}
			case 2: // embedding模型
				for _, model := range category.Models {
					meta := &EmbeddingModelMeta{
						ModelID:     model.ModelID,
						ModelName:   model.ModelName,
						Dimensions:  model.Dimensions,
						MaxTokens:   model.MaxTokens,
						Provider:    platform.PlatformName,
						PlatformID:  platform.PlatformID,
						ChannelType: platform.ChannelType,
					}
					l.embeddingModels[model.ModelID] = meta
				}
				// 添加到渠道类型索引
				if platform.ChannelType != 0 {
					for _, model := range category.Models {
						l.channelModels[platform.ChannelType] = append(l.channelModels[platform.ChannelType], model.ModelID)
					}
				}
			case 3: // rerank模型
				for _, model := range category.Models {
					meta := &RerankModelMeta{
						ModelID:     model.ModelID,
						ModelName:   model.ModelName,
						CategoryID:  category.CategoryID,
						PlatformID:  platform.PlatformID,
						Enabled:     true, // 默认启用
					}
					l.rerankModels[model.ModelID] = meta
				}
				// 添加到渠道类型索引
				if platform.ChannelType != 0 {
					for _, model := range category.Models {
						l.channelModels[platform.ChannelType] = append(l.channelModels[platform.ChannelType], model.ModelID)
					}
				}
			default:
				// 记录未知模型类型，但不中断处理
				logger.SysLogf("Unknown model type: %d for platform %s", category.ModelType, platform.PlatformID)
			}
		}
	}

	logger.SysLogf("Model catalog loaded: %d platforms, %d chat models, %d embedding models, %d rerank models",
		len(catalog.Platforms),
		len(l.chatModels),
		len(l.embeddingModels),
		len(l.rerankModels))

	return nil
}

// init 初始化时触发校验
func init() {
	loader := GetModelCatalogLoader()
	if loader.loadErr == nil {
		loader.validateEmbeddingModels()
		fmt.Printf("信息: 模型目录加载完成，共加载 %d 个平台，%d 个对话模型，%d 个embedding模型\n",
			len(loader.catalog.Platforms),
			len(loader.chatModels),
			len(loader.embeddingModels))
	}
}

// ListEmbeddingModelsByChannelType 根据渠道类型获取embedding模型列表
func (l *ModelCatalogLoader) ListEmbeddingModelsByChannelType(channelType int) ([]string, error) {
	if l.loadErr != nil {
		return nil, fmt.Errorf("模型目录加载失败: %v", l.loadErr)
	}

	models, exists := l.channelModels[channelType]
	if !exists {
		return []string{}, nil // 返回空列表而不是错误
	}

	return models, nil
}

// ListRerankModelsByChannelType 根据渠道类型获取rerank模型列表
func (l *ModelCatalogLoader) ListRerankModelsByChannelType(channelType int) ([]string, error) {
	if l.loadErr != nil {
		return nil, fmt.Errorf("模型目录加载失败: %v", l.loadErr)
	}

	models, exists := l.channelModels[channelType]
	if !exists {
		return []string{}, nil // 返回空列表而不是错误
	}

	return models, nil
}

// IsRerankModel 检查模型是否为rerank模型
func (l *ModelCatalogLoader) IsRerankModel(modelName string) bool {
	if l.loadErr != nil {
		return false
	}

	_, exists := l.rerankModels[modelName]
	return exists
}

// GetRerankModelMeta 获取rerank模型元数据
func (l *ModelCatalogLoader) GetRerankModelMeta(modelName string) (*RerankModelMeta, error) {
	if l.loadErr != nil {
		return nil, fmt.Errorf("模型目录加载失败: %v", l.loadErr)
	}

	meta, exists := l.rerankModels[modelName]
	if !exists {
		return nil, fmt.Errorf("未找到rerank模型: %s", modelName)
	}

	return meta, nil
}

// GetEmbeddingMeta 获取embedding模型元数据
func (l *ModelCatalogLoader) GetEmbeddingMeta(modelID string) (*EmbeddingModelMeta, error) {
	if l.loadErr != nil {
		return nil, fmt.Errorf("模型目录加载失败: %v", l.loadErr)
	}

	meta, exists := l.embeddingModels[modelID]
	if !exists {
		return nil, fmt.Errorf("未找到模型 %s 的元数据", modelID)
	}

	return meta, nil
}

// GetChannelTypeMapping 获取渠道类型映射（用于兼容性）
func (l *ModelCatalogLoader) GetChannelTypeMapping() map[int]string {
	return map[int]string{
		1:   "OpenAI",
		3:   "Azure OpenAI",
		17:  "阿里百炼",
		36:  "DeepSeek",
		44:  "硅基流动",
		900: "火山方舟",
		901: "百度千帆ModelBuilder",
		// 新增
		24:   "Gemini",
		25:   "月之暗面",
		1012: "自定义模型",
	}
}

// GetChatModelMeta 获取聊天模型元数据
func (l *ModelCatalogLoader) GetChatModelMeta(modelName string) (*ChatModelMeta, error) {
	if l.loadErr != nil {
		return nil, fmt.Errorf("模型目录加载失败: %v", l.loadErr)
	}

	meta, exists := l.chatModels[modelName]
	if !exists {
		return nil, fmt.Errorf("未找到聊天模型: %s", modelName)
	}

	return meta, nil
}

// IsEmbeddingModel 检查模型是否为embedding模型
func (l *ModelCatalogLoader) IsEmbeddingModel(modelName string) bool {
	if l.loadErr != nil {
		return false
	}

	_, exists := l.embeddingModels[modelName]
	return exists
}

// GetEmbeddingModelMeta 获取embedding模型元数据
func (l *ModelCatalogLoader) GetEmbeddingModelMeta(modelName string) (*EmbeddingModelMeta, error) {
	if l.loadErr != nil {
		return nil, fmt.Errorf("模型目录加载失败: %v", l.loadErr)
	}

	meta, exists := l.embeddingModels[modelName]
	if !exists {
		return nil, fmt.Errorf("未找到embedding模型: %s", modelName)
	}

	return meta, nil
}

// ListRerankModels 获取所有rerank模型列表
func (l *ModelCatalogLoader) ListRerankModels() []string {
	if l.loadErr != nil {
		return []string{}
	}

	models := make([]string, 0, len(l.rerankModels))
	for modelID := range l.rerankModels {
		models = append(models, modelID)
	}
	return models
}

// ListChatModels 获取所有聊天模型列表
func (l *ModelCatalogLoader) ListChatModels() []string {
	if l.loadErr != nil {
		return []string{}
	}

	models := make([]string, 0, len(l.chatModels))
	for modelID := range l.chatModels {
		models = append(models, modelID)
	}
	return models
}

// ListEmbeddingModels 获取所有embedding模型列表
func (l *ModelCatalogLoader) ListEmbeddingModels() []string {
	if l.loadErr != nil {
		return []string{}
	}

	models := make([]string, 0, len(l.embeddingModels))
	for modelID := range l.embeddingModels {
		models = append(models, modelID)
	}
	return models
}

// GetChannelTypeByRerankModel 根据rerank模型名称获取对应的渠道类型
func (l *ModelCatalogLoader) GetChannelTypeByRerankModel(modelName string) int {
	if l.loadErr != nil {
		return -1
	}

	// 遍历平台和类别，查找匹配的模型
	for _, platform := range l.catalog.Platforms {
		for _, category := range platform.Categories {
			if category.ModelType != 3 { // 3 表示 rerank 模型
				continue
			}
			for _, model := range category.Models {
				if model.ModelID == modelName {
					return platform.ChannelType
				}
			}
		}
	}

	return -1 // 未找到
}

// IsDeepThinkingModel 检查模型是否为深度思考模型
func (l *ModelCatalogLoader) IsDeepThinkingModel(modelName string) (bool, error) {
	if l.loadErr != nil {
		return false, fmt.Errorf("模型目录加载失败: %v", l.loadErr)
	}

	// 遍历平台和类别，查找匹配的模型
	for _, platform := range l.catalog.Platforms {
		for _, category := range platform.Categories {
			if category.ModelType != 1 { // 1 表示 chat 模型
				continue
			}
			for _, model := range category.Models {
				if model.ModelID == modelName {
					return model.DeepThinking, nil
				}
			}
		}
	}

	// 如果模型不存在，返回 false，但不报错
	return false, nil
}

// GetModelMeta 根据渠道类型和模型名称获取模型元数据
func (l *ModelCatalogLoader) GetModelMeta(channelType int, modelName string) (interface{}, error) {
	if l.loadErr != nil {
		return nil, fmt.Errorf("模型目录加载失败: %v", l.loadErr)
	}

	// 遍历平台，查找匹配的渠道类型和模型
	for _, platform := range l.catalog.Platforms {
		if platform.ChannelType != channelType {
			continue
		}
		
		for _, category := range platform.Categories {
			for _, model := range category.Models {
				if model.ModelID == modelName {
					// 根据模型类型返回相应的元数据
					switch category.ModelType {
					case 1: // chat 模型
						chatMeta, exists := l.chatModels[modelName]
						if exists {
							return chatMeta, nil
						}
						// 如果缓存中不存在，创建一个新的
						return &ChatModelMeta{
							ModelID:     model.ModelID,
							ModelName:   model.ModelName,
							CategoryID:  category.CategoryID,
							PlatformID:  platform.PlatformID,
							Enabled:     true,
						}, nil
					case 2: // embedding 模型
						embeddingMeta, exists := l.embeddingModels[modelName]
						if exists {
							return embeddingMeta, nil
						}
						// 如果缓存中不存在，创建一个新的
						return &EmbeddingModelMeta{
							ModelID:     model.ModelID,
							ModelName:   model.ModelName,
							Dimensions:  model.Dimensions,
							MaxTokens:   model.MaxTokens,
							Provider:    platform.PlatformName,
							PlatformID:  platform.PlatformID,
							ChannelType: platform.ChannelType,
						}, nil
					case 3: // rerank 模型
						rerankMeta, exists := l.rerankModels[modelName]
						if exists {
							return rerankMeta, nil
						}
						// 如果缓存中不存在，创建一个新的
						return &RerankModelMeta{
							ModelID:     model.ModelID,
							ModelName:   model.ModelName,
							CategoryID:  category.CategoryID,
							PlatformID:  platform.PlatformID,
							Enabled:     true,
						}, nil
					default:
						// 对于未知类型，返回基本模型信息
						return map[string]interface{}{
							"model_id":   model.ModelID,
							"model_name": model.ModelName,
							"category_id": category.CategoryID,
							"platform_id": platform.PlatformID,
							"model_type":  category.ModelType,
						}, nil
					}
				}
			}
		}
	}

	return nil, fmt.Errorf("未找到模型 %s 在渠道类型 %d 下的元数据", modelName, channelType)
}

// validateEmbeddingModels 启动时校验embedding模型元数据完整性
func (l *ModelCatalogLoader) validateEmbeddingModels() {
	if l.loadErr != nil {
		return
	}

	var issues []string

	// 检查必需字段
	for modelID, meta := range l.embeddingModels {
		if meta.Dimensions <= 0 {
			issues = append(issues, fmt.Sprintf("模型 %s 缺少有效的 dimensions 配置", modelID))
		}
		if meta.MaxTokens <= 0 {
			issues = append(issues, fmt.Sprintf("模型 %s 缺少有效的 max_tokens 配置", modelID))
		}
		if meta.ModelName == "" {
			issues = append(issues, fmt.Sprintf("模型 %s 缺少 model_name", modelID))
		}
	}

	// 检查重复的模型ID
	seen := make(map[string]bool)
	for modelID := range l.embeddingModels {
		if seen[modelID] {
			issues = append(issues, fmt.Sprintf("发现重复的模型ID: %s", modelID))
		}
		seen[modelID] = true
	}

	// 记录校验结果
	if len(issues) > 0 {
		fmt.Printf("警告: embedding模型元数据校验发现问题:\n")
		for _, issue := range issues {
			fmt.Printf("  - %s\n", issue)
		}
	} else {
		fmt.Printf("信息: embedding模型元数据校验通过，共加载 %d 个模型\n", len(l.embeddingModels))
	}
}
