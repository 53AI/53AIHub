package rag

import (
	"errors"
	"fmt"
	"strings"
	"sync"

	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/utils"
	"gorm.io/gorm"
)

// 默认分块配置常量
const (
	DefaultMinChunkSize             = 1000
	DefaultKnowledgeSplitRule       = "h3,\n,\n\n,。"
	DefaultKnowledgeMaxLength       = 2048
	DefaultKnowledgeOverlapSize     = 0
	DefaultKnowledgeIncludeTitle    = false // 默认不添加知识标题
	DefaultKnowledgeIncludeFileName = true  // 默认添加文件名
	DefaultKnowledgeIncludeSubtitle = false // 默认不添加子标题
	DefaultIndexSplitRule           = "h3,\n,\n\n,。"
	DefaultIndexMaxLength           = 384
	DefaultIndexOverlapSize         = 0
	DefaultIndexIncludeTitle        = true  // 默认添加知识标题
	DefaultIndexIncludeFileName     = true  // 默认添加文件名
	DefaultIndexIncludeSubtitle     = false // 默认不添加子标题
	DefaultSummaryGeneration        = "manual"
	DefaultQuestionGeneration       = "ai"
	DefaultSearchConfigJSON         = `{"vector":true,"fulltext":false,"hybrid":false,"rerank_model":"rerank-english-v2.0","top_k":4,"score_threshold":0.0}`
	DefaultName                     = "通用文档"
)

const (
	ChunkModelIdentifierFirst = "identifier_first" // 分割符优先
	ChunkModelLengthFirst     = "length_first"     // 长度优先
)

// ChunkConfigService 分块配置服务
type ChunkConfigService struct {
	db *gorm.DB

	cacheMu            sync.RWMutex
	configCache        map[string]*ChunkConfig
	missingConfigCache map[string]struct{}
	systemConfigCache  map[string]*ChunkConfig
}

// ChunkConfig 分块配置
type ChunkConfig struct {
	ID                       int64                         `json:"id"`
	Eid                      int64                         `json:"eid"`
	LibraryID                *int64                        `json:"library_id"`
	MinChunkSize             int                           `json:"min_chunk_size"`
	KnowledgeChunk           model.KnowledgeChunkingConfig `json:"knowledge_chunking"`
	KnowledgeMaxLength       int                           `json:"knowledge_max_length"`
	KnowledgeOverlapSize     int                           `json:"knowledge_overlap_size"`
	KnowledgeIncludeTitle    bool                          `json:"knowledge_include_title"`    // 是否将知识标题添加到知识点中
	KnowledgeIncludeFileName bool                          `json:"knowledge_include_filename"` // 是否将文件名称添加到知识点中
	KnowledgeIncludeSubtitle bool                          `json:"knowledge_include_subtitle"` // 是否将子标题添加到知识点中
	IndexChunk               model.IndexChunkingConfig     `json:"index_chunking"`
	IndexMaxLength           int                           `json:"index_max_length"`
	IndexOverlapSize         int                           `json:"index_overlap_size"`
	IndexIncludeTitle        bool                          `json:"index_include_title"`    // 是否将知识标题添加到索引块中
	IndexIncludeFileName     bool                          `json:"index_include_filename"` // 是否将文件名称添加到索引块中
	IndexIncludeSubtitle     bool                          `json:"index_include_subtitle"` // 是否将子标题添加到索引块中
	SummaryGeneration        string                        `json:"summary_generation"`
	QuestionGeneration       string                        `json:"question_generation"`
	LogicChannelID           *int64                        `json:"logic_channel_id"`
	LogicModelName           *string                       `json:"logic_model_name"`
	EmbeddingChannelID       *int64                        `json:"embedding_channel_id"`
	EmbeddingModelName       *string                       `json:"embedding_model_name"`
	FastReasoning            model.ModelChannelConfig      `json:"fast_reasoning"`
	SearchConfig             *model.SearchConfigData       `json:"search_config"`

	// 时间字段
	CreatedTime int64 `json:"created_time"`
	UpdatedTime int64 `json:"updated_time"`

	// 关联的渠道信息
	LogicChannel     *model.Channel `json:"logic_channel,omitempty"`
	EmbeddingChannel *model.Channel `json:"embedding_channel,omitempty"`

	// 类型 default,data_table,qa,product_plan,product_catalog,video_course
	Type string `json:"type"`
	Name string `json:"name"`
}

// 为了向后兼容，保留旧字段的访问方法
func (c *ChunkConfig) GetKnowledgeSplitRule() string {
	return c.KnowledgeChunk.SplitRule
}

func (c *ChunkConfig) GetIndexSplitRule() string {
	return c.IndexChunk.SplitRule
}

func (c *ChunkConfig) SetKnowledgeSplitRule(rule string) {
	c.KnowledgeChunk.SplitRule = rule
}

func (c *ChunkConfig) SetIndexSplitRule(rule string) {
	c.IndexChunk.SplitRule = rule
}

// EnableAIGeneration 判断是否启用AI生成
// 当SummaryGeneration或QuestionGeneration任一为"ai"时启用AI生成
func (c *ChunkConfig) EnableAIGeneration() bool {
	return c.SummaryGeneration == "ai" || c.QuestionGeneration == "ai"
}

// SelectPipelineLLM 统一的流水线模型选择方法
// 优先级：LogicChannel > LogicChannelID > FastReasoning
// 流水线场景（图谱抽取、实体抽取、摘要生成等）均使用推理模型，LogicReasoning 优先
func (c *ChunkConfig) SelectPipelineLLM() (*model.Channel, string, error) {
	if c.LogicChannel != nil && c.LogicModelName != nil {
		return c.LogicChannel, *c.LogicModelName, nil
	}

	if c.LogicChannelID != nil && c.LogicModelName != nil {
		ch, err := model.GetChannelByID(*c.LogicChannelID)
		if err == nil && ch != nil {
			return ch, *c.LogicModelName, nil
		}
	}

	if c.FastReasoning.ChannelID != nil && c.FastReasoning.ModelName != nil {
		ch, err := model.GetChannelByID(*c.FastReasoning.ChannelID)
		if err == nil && ch != nil {
			return ch, *c.FastReasoning.ModelName, nil
		}
	}

	return nil, "", fmt.Errorf("no available llm channel for pipeline")
}

// NewChunkConfigService 创建分块配置服务
func NewChunkConfigService(db *gorm.DB) *ChunkConfigService {
	return &ChunkConfigService{
		db:                 db,
		configCache:        make(map[string]*ChunkConfig),
		missingConfigCache: make(map[string]struct{}),
		systemConfigCache:  make(map[string]*ChunkConfig),
	}
}

// GetConfig 获取分块配置（支持4层级联：默认 → 站点 → 知识库 → 文档）GetConfig
func (s *ChunkConfigService) GetConfig(eid int64, libraryID *int64, chunkType string) (*ChunkConfig, error) {
	if libraryID != nil {
		if libraryConfig, err := s.getConfigByLibrary(eid, *libraryID); err == nil && libraryConfig != nil {
			return libraryConfig, nil
		} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
	}

	siteConfig, err := s.getDefaultConfig(eid, chunkType)
	if err == nil {
		return siteConfig, nil
	}

	switch chunkType {
	case model.ChunkTypeDefault:
		return s.getSystemDefaultConfig(eid), nil
	case model.ChunkTypeDataTable:
		return s.getSystemDataTableConfig(eid), nil
	case model.ChunkTypeQA:
		return s.getSystemQaConfig(eid), nil
	}

	return siteConfig, err
}

// GetConfigWithFileID 获取分块配置（支持文档级配置）
func (s *ChunkConfigService) GetConfigWithFileID(eid int64, libraryID, fileID *int64) (*ChunkConfig, error) {
	var fileConfig *ChunkConfig
	var err error

	// 1. 优先获取文档专用配置
	if fileID != nil {
		fileConfig, err = s.getConfigByFile(eid, *fileID)
		if err != nil {
			// 允许"未找到记录"或"文件没有专用配置"作为正常无文档专用配置场景，其他错误上抛
			if !errors.Is(err, gorm.ErrRecordNotFound) && !strings.Contains(err.Error(), "文件没有专用配置") {
				return nil, err
			}
			fileConfig = nil
		}
		// 无库ID时，文档优先：直接返回文档配置
		// if fileConfig != nil && libraryID == nil {
		// 	return fileConfig, nil
		// }
	}
	if fileConfig != nil {
		config, _ := s.GetConfig(eid, nil, model.ChunkTypeDefault)
		fileConfig.EmbeddingModelName = config.EmbeddingModelName
		fileConfig.EmbeddingChannel = config.EmbeddingChannel
		fileConfig.EmbeddingChannelID = config.EmbeddingChannelID
		fileConfig.LogicModelName = config.LogicModelName
		fileConfig.LogicChannel = config.LogicChannel
		fileConfig.LogicChannelID = config.LogicChannelID
		return fileConfig, nil
	}

	// 废弃，拆分、模型，知识库这层没了，都在后台企业一份 //
	// 2. 库级配置：确保存在；若不存在则基于站点默认/系统默认创建
	// if libraryID != nil {
	// 	libraryConfig, err := s.ensureLibraryConfig(eid, *libraryID)
	// 	if err != nil {
	// 		return nil, err
	// 	}

	// 	// 存在文档配置时，用库级的6项覆盖后返回
	// 	if fileConfig != nil {
	// 		fileConfig.EmbeddingModelName = libraryConfig.EmbeddingModelName
	// 		fileConfig.EmbeddingChannel = libraryConfig.EmbeddingChannel
	// 		fileConfig.EmbeddingChannelID = libraryConfig.EmbeddingChannelID
	// 		fileConfig.LogicModelName = libraryConfig.LogicModelName
	// 		fileConfig.LogicChannel = libraryConfig.LogicChannel
	// 		fileConfig.LogicChannelID = libraryConfig.LogicChannelID
	// 		return fileConfig, nil
	// 	}
	// 	// 无文档配置，直接返回库级
	// 	return libraryConfig, nil
	// }

	// 3. 无库ID且无文档配置：获取清洗配置，不存在则获取企业默认的拆分规则chunk_setting
	cleaningConfig := s.getCleaningConfig(eid, libraryID, fileID)
	if cleaningConfig != nil {
		return cleaningConfig, nil
	}

	// 4. 如果清洗配置为 nil，则直接使用企业默认的拆分规则chunk_setting
	return s.GetConfig(eid, nil, model.ChunkTypeDefault)
}

// GetConfigByID 根据ID获取配置
func (s *ChunkConfigService) GetConfigByID(eid int64, id int64) (*ChunkConfig, error) {
	var setting model.ChunkSetting
	err := s.db.Where("eid = ? AND id = ?", eid, id).First(&setting).Error
	if err != nil {
		return nil, err
	}

	return s.convertToChunkConfig(&setting)
}

// GetConfigByType 根据 type 获取配置用于获取全局唯一的配置，如 qa、data_table
func (s *ChunkConfigService) GetConfigByType(eid int64, chunkType string) (*ChunkConfig, error) {
	var setting model.ChunkSetting
	err := s.db.Where("eid = ? AND type = ?", eid, chunkType).First(&setting).Error
	if err != nil {
		return nil, err
	}

	return s.convertToChunkConfig(&setting)
}

// GetConfigsByEid 获取企业的所有配置
func (s *ChunkConfigService) GetConfigsByEid(eid int64, libraryID *int64) ([]*ChunkConfig, error) {
	var settings []model.ChunkSetting
	query := s.db.Where("eid = ?", eid)

	if libraryID != nil {
		query = query.Where("library_id = ?", *libraryID)
	} else {
		query = query.Where("library_id IS NULL")
	}

	err := query.First(&settings).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	// 如果没有找到配置，则使用默认配置。后续有多个系统模板，在这里加
	if len(settings) == 0 {
		defaultConfigs := s.getSystemDefaultConfigs(eid)
		return defaultConfigs, nil
	}

	var configs []*ChunkConfig
	for _, setting := range settings {
		config, err := s.convertToChunkConfig(&setting)
		if err != nil {
			continue // 跳过转换失败的配置
		}
		configs = append(configs, config)
	}
	qaSetting, err := model.GetDefaultChunkSettingByType(eid, nil, model.ChunkTypeQA)
	if err != nil {
		return nil, err
	}
	qaChunkSetting, err := s.convertToChunkConfig(qaSetting)
	if err != nil {
		return nil, err
	}
	dataTableSetting, err := model.GetDefaultChunkSettingByType(eid, nil, model.ChunkTypeDataTable)
	if err != nil {
		return nil, err
	}
	dataTableChunkSetting, err := s.convertToChunkConfig(dataTableSetting)
	if err != nil {
		return nil, err
	}
	configs = append(configs, qaChunkSetting)
	configs = append(configs, dataTableChunkSetting)

	return configs, nil
}

// CreateConfig 创建配置
func (s *ChunkConfigService) CreateConfig(config *ChunkConfig) error {
	if err := s.validateConfig(config); err != nil {
		return err
	}

	setting := s.convertToChunkSetting(config)
	result := s.db.Create(setting)
	if result.Error != nil {
		return result.Error
	}

	// 更新配置ID
	config.ID = setting.ID
	s.invalidateCachesByEid(config.Eid)
	return nil
}

// UpdateConfig 更新配置
func (s *ChunkConfigService) UpdateConfig(config *ChunkConfig) error {
	if err := s.validateConfig(config); err != nil {
		return err
	}

	setting := s.convertToChunkSetting(config)

	if config.ID > 0 {
		// 更新现有配置
		result := s.db.Model(&model.ChunkSetting{}).Where("id = ?", config.ID).Updates(setting)
		if result.Error != nil {
			return result.Error
		}
	} else {
		// 创建新配置
		result := s.db.Create(setting)
		if result.Error != nil {
			return result.Error
		}
		config.ID = setting.ID
	}

	s.invalidateCachesByEid(config.Eid)
	return nil
}

// DeleteConfig 删除配置
func (s *ChunkConfigService) DeleteConfig(eid int64, id int64) error {
	if err := model.DeleteChunkSetting(eid, id); err != nil {
		return err
	}
	s.invalidateCachesByEid(eid)
	return nil
}

// CreateDefaultConfig 创建默认配置
func (s *ChunkConfigService) CreateDefaultConfig(eid int64, libraryID *int64, chunkType, name string) (*ChunkConfig, error) {
	setting := &model.ChunkSetting{
		Eid:       eid,
		LibraryID: libraryID,
		Name:      name,
		Type:      chunkType,
	}

	// 设置默认的分块配置
	chunkingConfig := &model.ChunkingConfigData{
		Version: "1.0",
		KnowledgeChunk: model.KnowledgeChunkingConfig{
			SplitRule:       DefaultKnowledgeSplitRule,
			MaxLength:       DefaultKnowledgeMaxLength,
			OverlapSize:     DefaultKnowledgeOverlapSize,
			IncludeTitle:    DefaultKnowledgeIncludeTitle,
			IncludeFileName: DefaultKnowledgeIncludeFileName,
			AppendSubtitle:  DefaultKnowledgeIncludeSubtitle,
		},
		IndexChunk: model.IndexChunkingConfig{
			SplitRule:       DefaultIndexSplitRule,
			MaxLength:       DefaultIndexMaxLength,
			OverlapSize:     DefaultIndexOverlapSize,
			IncludeTitle:    DefaultIndexIncludeTitle,
			IncludeFileName: DefaultIndexIncludeFileName,
			AppendSubtitle:  DefaultIndexIncludeSubtitle,
		},
		ContentSummary: model.ContentGenerationConfig{
			GenerationMethod: DefaultSummaryGeneration,
		},
		CommonQuestions: model.ContentGenerationConfig{
			GenerationMethod: DefaultQuestionGeneration,
		},
	}

	// 设置默认的模型配置
	modelConfig := &model.ModelConfigData{
		Version: "1.0",
		LogicReasoning: model.ModelChannelConfig{
			ChannelID: nil,
			ModelName: nil,
		},
		VectorEmbedding: model.ModelChannelConfig{
			ChannelID: nil,
			ModelName: nil,
		},
		FastReasoning: model.ModelChannelConfig{
			ChannelID: nil,
			ModelName: nil,
		},
		SearchConfig: model.SearchConfigData{
			Vector:         true,
			Fulltext:       false,
			Hybrid:         false,
			RerankModel:    "rerank-english-v2.0",
			TopK:           4,
			ScoreThreshold: 0.0,
		},
	}

	// 保存JSON配置
	if err := setting.SetChunkingConfig(chunkingConfig); err != nil {
		return nil, err
	}
	if err := setting.SetModelConfig(modelConfig); err != nil {
		return nil, err
	}

	result := s.db.Create(setting)
	if result.Error != nil {
		return nil, result.Error
	}

	return s.convertToChunkConfig(setting)
}

// ValidateChannels 验证渠道配置
func (s *ChunkConfigService) ValidateChannels(eid int64, logicChannelID *int64, embeddingChannelID *int64) error {
	if logicChannelID != nil {
		channel, err := model.GetChannelByID(*logicChannelID)
		if err != nil {
			return fmt.Errorf("逻辑推理渠道不存在: %v", err)
		}
		if channel.Eid != eid {
			return errors.New("逻辑推理渠道不属于当前企业")
		}
		if channel.Status != model.ChannelStatusEnabled {
			return errors.New("逻辑推理渠道未启用")
		}
	}

	if embeddingChannelID != nil {
		channel, err := model.GetChannelByID(*embeddingChannelID)
		if err != nil {
			return fmt.Errorf("向量嵌入渠道不存在: %v", err)
		}
		if channel.Eid != eid {
			return errors.New("向量嵌入渠道不属于当前企业")
		}
		if channel.Status != model.ChannelStatusEnabled {
			return errors.New("向量嵌入渠道未启用")
		}
	}

	return nil
}

// getConfigByLibrary 获取知识库专用配置
func (s *ChunkConfigService) getConfigByLibrary(eid int64, libraryID int64) (*ChunkConfig, error) {
	var setting model.ChunkSetting
	err := s.db.Where("eid = ? AND library_id = ?", eid, libraryID).First(&setting).Error
	if err != nil {
		return nil, err
	}

	return s.convertToChunkConfig(&setting)
}

// ensureLibraryConfig 确保知识库级配置存在；不存在时基于站点默认或系统默认创建
func (s *ChunkConfigService) ensureLibraryConfig(eid int64, libraryID int64) (*ChunkConfig, error) {
	// 已存在则直接返回
	cfg, err := s.getConfigByLibrary(eid, libraryID)
	if err == nil {
		return cfg, nil
	}
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	// 选择模板：站点默认优先，其次系统默认
	templateCfg, errDef := s.getDefaultConfig(eid, model.ChunkTypeDefault)
	if errDef != nil {
		templateCfg = s.getSystemDefaultConfig(eid)
	}

	// 基于模板构造新的库级配置
	newCfg := &ChunkConfig{
		Eid:                      eid,
		LibraryID:                &libraryID,
		MinChunkSize:             templateCfg.MinChunkSize,
		KnowledgeChunk:           templateCfg.KnowledgeChunk,
		KnowledgeMaxLength:       templateCfg.KnowledgeMaxLength,
		KnowledgeOverlapSize:     templateCfg.KnowledgeOverlapSize,
		KnowledgeIncludeTitle:    templateCfg.KnowledgeIncludeTitle,
		KnowledgeIncludeFileName: templateCfg.KnowledgeIncludeFileName,
		KnowledgeIncludeSubtitle: templateCfg.KnowledgeIncludeSubtitle,
		IndexChunk:               templateCfg.IndexChunk,
		IndexMaxLength:           templateCfg.IndexMaxLength,
		IndexOverlapSize:         templateCfg.IndexOverlapSize,
		IndexIncludeTitle:        templateCfg.IndexIncludeTitle,
		IndexIncludeFileName:     templateCfg.IndexIncludeFileName,
		IndexIncludeSubtitle:     templateCfg.IndexIncludeSubtitle,
		SummaryGeneration:        templateCfg.SummaryGeneration,
		QuestionGeneration:       templateCfg.QuestionGeneration,
		LogicChannelID:           templateCfg.LogicChannelID,
		LogicModelName:           templateCfg.LogicModelName,
		EmbeddingChannelID:       templateCfg.EmbeddingChannelID,
		EmbeddingModelName:       templateCfg.EmbeddingModelName,
		SearchConfig:             templateCfg.SearchConfig,
	}

	if newCfg.SearchConfig == nil {
		newCfg.SearchConfig = &model.SearchConfigData{
			Vector:         true,
			Fulltext:       false,
			Hybrid:         false,
			RerankModel:    "rerank-english-v2.0",
			TopK:           4,
			ScoreThreshold: 0.0,
		}
	}

	if err := s.CreateConfig(newCfg); err != nil {
		return nil, err
	}

	// 返回创建后的库级配置
	return s.getConfigByLibrary(eid, libraryID)
}

// getConfigByFile 获取文档专用配置
func (s *ChunkConfigService) getConfigByFile(eid int64, fileID int64) (*ChunkConfig, error) {
	// 首先查询文件的配置ID
	var file model.File
	err := s.db.Where("eid = ? AND id = ?", eid, fileID).First(&file).Error
	if err != nil {
		return nil, err
	}

	// 如果文件没有专用配置，返回错误
	if file.ConfigID == nil {
		return nil, errors.New("文件没有专用配置")
	}

	// 根据配置ID获取配置
	var setting model.ChunkSetting
	err = s.db.Where("eid = ? AND id = ?", eid, *file.ConfigID).First(&setting).Error
	if err != nil {
		// 获取 qa、data_table
		err = s.db.Where("eid = ? AND id = ?", 0, *file.ConfigID).First(&setting).Error
		if err != nil {
			return nil, err
		}
	}

	return s.convertToChunkConfig(&setting)
}

// getCleaningConfig 获取清洗配置（先获取知识库级的清洗配置，不存在则获取企业级清洗配置，否则返回 nil）
func (s *ChunkConfigService) getCleaningConfig(eid int64, libraryID, fileID *int64) *ChunkConfig {
	var cleaningRules []utils.DocumentSettingRule
	var err error

	// 1. 获取清洗配置规则（知识库级优先，不存在则获取企业级）
	if libraryID != nil {
		cleaningRules, err = utils.GetDocumentSettingRules(eid, *libraryID)
	}

	if err != nil {
		// 直接获取企业级配置
		cleaningRules, err = utils.GetDocumentSettingRules(eid, 0)
		if err != nil {
			return nil
		}
	}

	// 2. 如果清洗配置为空，返回 nil
	if len(cleaningRules) == 0 {
		return nil
	}

	// 3. 通过fileid获取文件path获取文件类型以此匹配对应的清洗规则
	if fileID != nil {
		var file model.File
		err = s.db.Where("eid = ? AND id = ?", eid, *fileID).First(&file).Error
		if err != nil {
			return nil
		}

		// 提取文件扩展名
		ext := utils.ExtractExtension(file.Path)
		if ext == "" {
			return nil
		}

		// 4. 匹配清洗规则
		matchedRule, configId := utils.MatchCleaningRule(ext, cleaningRules)
		if matchedRule == "" {
			// 当不存在指定的清洗规则时，返回 nil（使用企业默认的拆分规则）
			return nil
		}

		// 根据规则获取对应的配置ID
		if configId > 0 {
			config, err := s.GetConfigByID(eid, configId)
			if err != nil {
				return nil
			}
			return config
		}
	}

	return nil
}

// getDefaultConfig 获取站点默认配置
func (s *ChunkConfigService) getDefaultConfig(eid int64, chunkType string) (*ChunkConfig, error) {
	cacheKey := fmt.Sprintf("default|%d|%s", eid, chunkType)
	s.cacheMu.RLock()
	if _, missing := s.missingConfigCache[cacheKey]; missing {
		s.cacheMu.RUnlock()
		return nil, gorm.ErrRecordNotFound
	}
	s.cacheMu.RUnlock()
	return s.getCachedConfig(cacheKey, func() (*ChunkConfig, error) {
		var setting model.ChunkSetting
		err := s.db.Where("eid = ? AND library_id IS NULL AND type = ? ", eid, chunkType).First(&setting).Error
		if err != nil {
			return nil, err
		}

		return s.convertToChunkConfig(&setting)
	})
}

func (s *ChunkConfigService) GetSystemDefaultConfig(chunkType string) (*ChunkConfig, error) {
	switch chunkType {
	case model.ChunkTypeDefault:
		return s.getSystemDefaultConfig(0), nil
	case model.ChunkTypeDataTable:
		return s.getSystemDataTableConfig(0), nil
	case model.ChunkTypeQA:
		return s.getSystemQaConfig(0), nil
	}
	return nil, errors.New("unknow chunk type")
}

// getSystemDefaultConfig 获取系统默认配置
func (s *ChunkConfigService) getSystemDefaultConfig(eid int64) *ChunkConfig {
	cacheKey := fmt.Sprintf("system-default|%d", eid)
	if cfg, ok := s.getCachedSystemConfig(cacheKey); ok {
		return cfg
	}
	cfg := s.buildSystemDefaultConfig(eid)
	s.setCachedSystemConfig(cacheKey, cfg)
	return cfg
}

// getSystemQaConfig 获取系统默认问答配置
func (s *ChunkConfigService) getSystemQaConfig(eid int64) *ChunkConfig {
	cacheKey := fmt.Sprintf("system-qa|%d", eid)
	if cfg, ok := s.getCachedSystemConfig(cacheKey); ok {
		return cfg
	}
	cfg := s.buildSystemQaConfig(eid)
	s.setCachedSystemConfig(cacheKey, cfg)
	return cfg
}

// getSystemDataTableConfig 获取系统默认数据表格配置
func (s *ChunkConfigService) getSystemDataTableConfig(eid int64) *ChunkConfig {
	cacheKey := fmt.Sprintf("system-datatable|%d", eid)
	if cfg, ok := s.getCachedSystemConfig(cacheKey); ok {
		return cfg
	}
	cfg := s.buildSystemDataTableConfig(eid)
	s.setCachedSystemConfig(cacheKey, cfg)
	return cfg
}

func (s *ChunkConfigService) getCachedConfig(cacheKey string, loader func() (*ChunkConfig, error)) (*ChunkConfig, error) {
	s.cacheMu.RLock()
	if cfg, ok := s.configCache[cacheKey]; ok && cfg != nil {
		cached := cloneChunkConfig(cfg)
		s.cacheMu.RUnlock()
		return cached, nil
	}
	s.cacheMu.RUnlock()

	cfg, err := loader()
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			s.cacheMu.Lock()
			s.missingConfigCache[cacheKey] = struct{}{}
			s.cacheMu.Unlock()
		}
		return nil, err
	}
	if cfg == nil {
		return nil, nil
	}

	cached := cloneChunkConfig(cfg)
	s.cacheMu.Lock()
	s.configCache[cacheKey] = cached
	s.cacheMu.Unlock()

	return cloneChunkConfig(cached), nil
}

func (s *ChunkConfigService) getCachedSystemConfig(cacheKey string) (*ChunkConfig, bool) {
	s.cacheMu.RLock()
	cfg, ok := s.systemConfigCache[cacheKey]
	s.cacheMu.RUnlock()
	if !ok || cfg == nil {
		return nil, false
	}
	return cloneChunkConfig(cfg), true
}

func (s *ChunkConfigService) setCachedSystemConfig(cacheKey string, cfg *ChunkConfig) {
	if cfg == nil {
		return
	}
	s.cacheMu.Lock()
	s.systemConfigCache[cacheKey] = cloneChunkConfig(cfg)
	s.cacheMu.Unlock()
}

func (s *ChunkConfigService) buildSystemDefaultConfig(eid int64) *ChunkConfig {
	if cfg, err := s.loadSystemConfig(eid, model.ChunkTypeDefault); err == nil && cfg != nil {
		return cfg
	}
	return s.newFallbackSystemConfig(eid, model.ChunkTypeDefault, DefaultName)
}

func (s *ChunkConfigService) buildSystemQaConfig(eid int64) *ChunkConfig {
	if cfg, err := s.loadSystemConfig(eid, model.ChunkTypeQA); err == nil && cfg != nil {
		return cfg
	}
	return s.newFallbackSystemConfig(eid, model.ChunkTypeQA, "百问百答")
}

func (s *ChunkConfigService) buildSystemDataTableConfig(eid int64) *ChunkConfig {
	if cfg, err := s.loadSystemConfig(eid, model.ChunkTypeDataTable); err == nil && cfg != nil {
		return cfg
	}
	return s.newFallbackSystemConfig(eid, model.ChunkTypeDataTable, "数据表格")
}

func (s *ChunkConfigService) invalidateCachesByEid(eid int64) {
	s.cacheMu.Lock()
	defer s.cacheMu.Unlock()

	eidFragment := fmt.Sprintf("|%d|", eid)
	eidSuffix := fmt.Sprintf("|%d", eid)
	for key := range s.configCache {
		if strings.Contains(key, eidFragment) {
			delete(s.configCache, key)
		}
	}
	for key := range s.missingConfigCache {
		if strings.Contains(key, eidFragment) {
			delete(s.missingConfigCache, key)
		}
	}
	for key := range s.systemConfigCache {
		if strings.HasSuffix(key, eidSuffix) {
			delete(s.systemConfigCache, key)
		}
	}
}

func (s *ChunkConfigService) loadSystemConfig(eid int64, chunkType string) (*ChunkConfig, error) {
	var setting model.ChunkSetting
	if err := s.db.Where("eid = ? AND library_id IS NULL AND type = ?", 0, chunkType).First(&setting).Error; err != nil {
		return nil, err
	}
	cfg, err := s.convertToChunkConfig(&setting)
	if err != nil {
		return nil, err
	}
	cfg.Eid = eid
	return cfg, nil
}

func (s *ChunkConfigService) newFallbackSystemConfig(eid int64, chunkType, name string) *ChunkConfig {
	embeddingChannelID, embeddingModelName := s.getDefaultEmbeddingChannelConfig(eid)
	searchConfig := &model.SearchConfigData{
		Vector:                true,
		Fulltext:              false,
		Hybrid:                false,
		RerankModel:           "rerank-english-v2.0",
		TopK:                  4,
		ScoreThreshold:        0.0,
		ScoreThresholdEnabled: false,
	}
	cfg := &ChunkConfig{
		Eid:          eid,
		LibraryID:    nil,
		MinChunkSize: 0,
		KnowledgeChunk: model.KnowledgeChunkingConfig{
			SplitRule:       DefaultKnowledgeSplitRule,
			MaxLength:       DefaultKnowledgeMaxLength,
			OverlapSize:     DefaultKnowledgeOverlapSize,
			IncludeTitle:    DefaultKnowledgeIncludeTitle,
			IncludeFileName: DefaultKnowledgeIncludeFileName,
			AppendSubtitle:  DefaultKnowledgeIncludeSubtitle,
			ChunkMode:       ChunkModelLengthFirst,
			IsSystemDefault: true,
		},
		KnowledgeMaxLength:       DefaultKnowledgeMaxLength,
		KnowledgeOverlapSize:     DefaultKnowledgeOverlapSize,
		KnowledgeIncludeTitle:    DefaultKnowledgeIncludeTitle,
		KnowledgeIncludeFileName: DefaultKnowledgeIncludeFileName,
		KnowledgeIncludeSubtitle: DefaultKnowledgeIncludeSubtitle,
		IndexChunk: model.IndexChunkingConfig{
			SplitRule:       DefaultIndexSplitRule,
			MaxLength:       DefaultIndexMaxLength,
			OverlapSize:     DefaultIndexOverlapSize,
			IncludeTitle:    DefaultIndexIncludeTitle,
			IncludeFileName: DefaultIndexIncludeFileName,
			AppendSubtitle:  DefaultIndexIncludeSubtitle,
			ChunkMode:       ChunkModelLengthFirst,
			IsSystemDefault: true,
		},
		IndexMaxLength:       DefaultIndexMaxLength,
		IndexOverlapSize:     DefaultIndexOverlapSize,
		IndexIncludeTitle:    DefaultIndexIncludeTitle,
		IndexIncludeFileName: DefaultIndexIncludeFileName,
		IndexIncludeSubtitle: DefaultIndexIncludeSubtitle,
		SummaryGeneration:    DefaultSummaryGeneration,
		QuestionGeneration:   DefaultQuestionGeneration,
		EmbeddingChannelID:   embeddingChannelID,
		EmbeddingModelName:   embeddingModelName,
		SearchConfig:         searchConfig,
		Type:                 chunkType,
		Name:                 name,
	}
	return cfg
}

func (s *ChunkConfigService) getDefaultEmbeddingChannelConfig(eid int64) (*int64, *string) {
	var channels []model.Channel
	if err := s.db.Where("eid = ? AND status = ?", eid, model.ChannelStatusEnabled).Find(&channels).Error; err != nil {
		return nil, nil
	}
	if len(channels) == 0 {
		return nil, nil
	}

	channel := channels[0]
	channelID := channel.ChannelID
	modelName := defaultEmbeddingModelNameByChannelType(channel.Type)
	return &channelID, &modelName
}

func defaultEmbeddingModelNameByChannelType(channelType int) string {
	switch channelType {
	case 1, 2:
		return "text-embedding-3-small"
	case 3:
		return "text-embedding-v1"
	default:
		return "text-embedding-3-small"
	}
}

func cloneChunkConfig(cfg *ChunkConfig) *ChunkConfig {
	if cfg == nil {
		return nil
	}
	cloned := *cfg
	if cfg.SearchConfig != nil {
		searchConfig := *cfg.SearchConfig
		cloned.SearchConfig = &searchConfig
	}
	if cfg.LogicModelName != nil {
		name := *cfg.LogicModelName
		cloned.LogicModelName = &name
	}
	if cfg.EmbeddingModelName != nil {
		name := *cfg.EmbeddingModelName
		cloned.EmbeddingModelName = &name
	}
	if cfg.LogicChannelID != nil {
		id := *cfg.LogicChannelID
		cloned.LogicChannelID = &id
	}
	if cfg.EmbeddingChannelID != nil {
		id := *cfg.EmbeddingChannelID
		cloned.EmbeddingChannelID = &id
	}
	if cfg.FastReasoning.ChannelID != nil {
		id := *cfg.FastReasoning.ChannelID
		cloned.FastReasoning.ChannelID = &id
	}
	if cfg.FastReasoning.ModelName != nil {
		name := *cfg.FastReasoning.ModelName
		cloned.FastReasoning.ModelName = &name
	}
	return &cloned
}

// convertToChunkConfig 将数据库模型转换为服务模型（支持JSON配置）
func (s *ChunkConfigService) convertToChunkConfig(setting *model.ChunkSetting) (*ChunkConfig, error) {
	config := &ChunkConfig{
		ID:          setting.ID,
		Eid:         setting.Eid,
		LibraryID:   setting.LibraryID,
		CreatedTime: setting.CreatedTime,
		UpdatedTime: setting.UpdatedTime,
		Name:        setting.Name,
		Type:        setting.Type,
	}

	if config.Name == "" {
		switch config.Type {
		case model.ChunkTypeDefault:
			config.Name = DefaultName
		}
	}

	// 使用JSON配置
	chunkingConfig, err := setting.GetChunkingConfig()
	if err != nil {
		return nil, fmt.Errorf("解析资料拆分配置失败: %v", err)
	}

	modelConfig, err := setting.GetModelConfig()
	if err != nil {
		return nil, fmt.Errorf("解析模型配置失败: %v", err)
	}

	// 从JSON配置填充字段
	config.MinChunkSize = 0 // 移除触发条件，默认为0
	config.KnowledgeChunk = chunkingConfig.KnowledgeChunk
	config.KnowledgeMaxLength = chunkingConfig.KnowledgeChunk.MaxLength
	config.KnowledgeOverlapSize = chunkingConfig.KnowledgeChunk.OverlapSize
	config.KnowledgeIncludeTitle = chunkingConfig.KnowledgeChunk.IncludeTitle
	config.KnowledgeIncludeFileName = chunkingConfig.KnowledgeChunk.IncludeFileName
	config.KnowledgeIncludeSubtitle = chunkingConfig.KnowledgeChunk.AppendSubtitle
	config.IndexChunk = chunkingConfig.IndexChunk
	config.IndexMaxLength = chunkingConfig.IndexChunk.MaxLength
	config.IndexOverlapSize = chunkingConfig.IndexChunk.OverlapSize
	config.IndexIncludeTitle = chunkingConfig.IndexChunk.IncludeTitle
	config.IndexIncludeFileName = chunkingConfig.IndexChunk.IncludeFileName
	config.IndexIncludeSubtitle = chunkingConfig.IndexChunk.AppendSubtitle
	config.SummaryGeneration = chunkingConfig.ContentSummary.GenerationMethod
	config.QuestionGeneration = chunkingConfig.CommonQuestions.GenerationMethod
	config.LogicChannelID = modelConfig.LogicReasoning.ChannelID
	config.LogicModelName = modelConfig.LogicReasoning.ModelName
	config.EmbeddingChannelID = modelConfig.VectorEmbedding.ChannelID
	config.EmbeddingModelName = modelConfig.VectorEmbedding.ModelName
	config.FastReasoning = modelConfig.FastReasoning
	config.SearchConfig = &modelConfig.SearchConfig

	// 加载关联的渠道信息
	if config.LogicChannelID != nil {
		channel, err := model.GetChannelByID(*config.LogicChannelID)
		if err == nil {
			config.LogicChannel = channel
		}
	}

	if config.EmbeddingChannelID != nil {
		channel, err := model.GetChannelByID(*config.EmbeddingChannelID)
		if err == nil {
			config.EmbeddingChannel = channel
		}
	}

	return config, nil
}

// convertToChunkSetting 将服务模型转换为数据库模型
func (s *ChunkConfigService) convertToChunkSetting(config *ChunkConfig) *model.ChunkSetting {
	setting := &model.ChunkSetting{
		ID:        config.ID,
		Eid:       config.Eid,
		LibraryID: config.LibraryID,
	}

	// 尝试从数据库获取现有的模型配置
	var existingSetting model.ChunkSetting
	var modelConfig *model.ModelConfigData

	if config.ID > 0 {
		if err := s.db.Where("id = ?", config.ID).First(&existingSetting).Error; err == nil {
			// 如果找到现有配置，解析它
			if existingModelConfig, err := existingSetting.GetModelConfig(); err == nil {
				// 使用现有配置作为基础
				modelConfig = existingModelConfig
			}
		}
	}

	// 如果没有现有配置，创建新的
	if modelConfig == nil {
		modelConfig = &model.ModelConfigData{
			Version: "1.0",
			LogicReasoning: model.ModelChannelConfig{
				ChannelID: config.LogicChannelID,
				ModelName: config.LogicModelName,
			},
			VectorEmbedding: model.ModelChannelConfig{
				ChannelID: config.EmbeddingChannelID,
				ModelName: config.EmbeddingModelName,
			},
			FastReasoning: model.ModelChannelConfig{
				ChannelID: config.FastReasoning.ChannelID,
				ModelName: config.FastReasoning.ModelName,
			},
		}
	} else {
		// 更新现有配置中的 LogicReasoning 和 VectorEmbedding
		if config.LogicChannelID != nil {
			modelConfig.LogicReasoning.ChannelID = config.LogicChannelID
		}
		if config.LogicModelName != nil {
			modelConfig.LogicReasoning.ModelName = config.LogicModelName
		}
		if config.EmbeddingChannelID != nil {
			modelConfig.VectorEmbedding.ChannelID = config.EmbeddingChannelID
		}
		if config.EmbeddingModelName != nil {
			modelConfig.VectorEmbedding.ModelName = config.EmbeddingModelName
		}
		if config.FastReasoning.ChannelID != nil {
			modelConfig.FastReasoning.ChannelID = config.FastReasoning.ChannelID
		}
		if config.FastReasoning.ModelName != nil {
			modelConfig.FastReasoning.ModelName = config.FastReasoning.ModelName
		}
	}

	// 更新搜索配置
	if config.SearchConfig != nil {
		modelConfig.SearchConfig = *config.SearchConfig
	}

	setting.SetModelConfig(modelConfig)

	// 构建分块配置JSON
	chunkingConfig := &model.ChunkingConfigData{
		Version:        "1.0",
		KnowledgeChunk: config.KnowledgeChunk,
		IndexChunk:     config.IndexChunk,
		ContentSummary: model.ContentGenerationConfig{
			GenerationMethod: config.SummaryGeneration,
		},
		CommonQuestions: model.ContentGenerationConfig{
			GenerationMethod: config.QuestionGeneration,
		},
	}
	setting.SetChunkingConfig(chunkingConfig)

	return setting
}

// validateConfig 验证配置
func (s *ChunkConfigService) validateConfig(config *ChunkConfig) error {
	// 移除MinChunkSize验证，因为已经不再使用触发条件

	if config.KnowledgeMaxLength <= 0 {
		return errors.New("知识点最大长度必须大于0")
	}

	if config.IndexMaxLength <= 0 {
		return errors.New("索引块最大长度必须大于0")
	}

	if config.KnowledgeOverlapSize < 0 {
		return errors.New("知识点重叠长度不能为负数")
	}

	if config.IndexOverlapSize < 0 {
		return errors.New("索引块重叠长度不能为负数")
	}

	// 验证分块规则 - 支持预定义规则和自定义分隔符
	if err := s.validateSplitRule(config.GetKnowledgeSplitRule(), "知识点分块规则"); err != nil {
		return err
	}

	if err := s.validateSplitRule(config.GetIndexSplitRule(), "索引块分块规则"); err != nil {
		return err
	}

	// 验证生成方式
	validGenerations := []string{"manual", "ai", "disabled"}
	if !contains(validGenerations, config.SummaryGeneration) {
		return errors.New("无效的概要生成方式")
	}

	if !contains(validGenerations, config.QuestionGeneration) {
		return errors.New("无效的问法生成方式")
	}

	// 验证渠道
	if err := s.ValidateChannels(config.Eid, config.LogicChannelID, config.EmbeddingChannelID); err != nil {
		return err
	}

	// 验证搜索配置
	if config.SearchConfig != nil {
		if config.SearchConfig.TopK <= 0 {
			return errors.New("TopK必须大于0")
		}

		if config.SearchConfig.ScoreThreshold < 0 || config.SearchConfig.ScoreThreshold > 1 {
			return errors.New("分数阈值必须在0-1之间")
		}
	}

	return nil
}

// contains 检查切片是否包含指定元素
func contains(slice []string, item string) bool {
	for _, s := range slice {
		if s == item {
			return true
		}
	}
	return false
}

// validateSplitRule 验证分块规则
func (s *ChunkConfigService) validateSplitRule(rule string, ruleType string) error {
	// 空字符串表示不拆分，是有效的规则
	if rule == "" {
		return nil
	}

	// 预定义的规则
	predefinedRules := []string{
		"h1", "h2", "h3", "h4", "h5", "h6", // 标题规则
		"paragraph", "sentence", "\n", "\n\n", // 段落和句子规则
		"none", // 不拆分规则
	}

	// 检查是否是预定义规则
	for _, predefined := range predefinedRules {
		if rule == predefined {
			return nil // 预定义规则直接通过
		}
	}

	// 自定义分隔符验证
	// 允许任何非空字符串作为分隔符，但有一些基本限制
	if len(rule) > 100 {
		return fmt.Errorf("%s的自定义分隔符长度不能超过100个字符", ruleType)
	}

	return nil // 自定义分隔符验证通过
}

// GetAvailableChannels 获取可用的渠道列表
func (s *ChunkConfigService) GetAvailableChannels(eid int64, channelType string) ([]*model.Channel, error) {
	channels, err := model.GetChannelsByEid(eid)
	if err != nil {
		return nil, err
	}

	var availableChannels []*model.Channel
	for _, channel := range channels {
		if channel.Status == model.ChannelStatusEnabled {
			// 根据channelType过滤渠道
			switch channelType {
			case "embedding":
				// 检查是否为embedding模型
				if s.isEmbeddingChannel(&channel) {
					availableChannels = append(availableChannels, &channel)
				}
			case "logic":
				// 检查是否为逻辑推理模型
				if s.isLogicChannel(&channel) {
					availableChannels = append(availableChannels, &channel)
				}
			default:
				availableChannels = append(availableChannels, &channel)
			}
		}
	}

	return availableChannels, nil
}

// isEmbeddingChannel 判断是否为embedding渠道
func (s *ChunkConfigService) isEmbeddingChannel(channel *model.Channel) bool {
	// 检查模型名称是否包含embedding相关关键词
	models := channel.Models
	embeddingKeywords := []string{"embedding", "embed", "text-embedding"}

	for _, keyword := range embeddingKeywords {
		if contains([]string{models}, keyword) {
			return true
		}
	}

	return false
}

// isLogicChannel 判断是否为逻辑推理渠道
func (s *ChunkConfigService) isLogicChannel(channel *model.Channel) bool {
	// 检查模型名称是否包含逻辑推理相关关键词
	models := channel.Models
	logicKeywords := []string{"gpt", "claude", "llama", "qwen", "baichuan"}

	for _, keyword := range logicKeywords {
		if contains([]string{models}, keyword) {
			return true
		}
	}

	return false
}

// GetModelConfigFromChunkConfig 从分块配置中提取模型配置JSON
func (s *ChunkConfigService) GetModelConfigFromChunkConfig(config *ChunkConfig) (*model.ModelConfigData, error) {
	// 首先尝试从数据库中读取完整的模型配置
	if config.ID > 0 {
		var setting model.ChunkSetting
		if err := s.db.Where("id = ?", config.ID).First(&setting).Error; err == nil {
			// 如果找到配置，解析并返回
			if modelConfig, err := setting.GetModelConfig(); err == nil {
				// 确保搜索配置是最新的
				if config.SearchConfig != nil {
					modelConfig.SearchConfig = *config.SearchConfig
				}
				return modelConfig, nil
			}
		}
	}

	// 如果没有找到配置，使用旧的字段方式构建默认配置
	searchConfig := model.SearchConfigData{
		Vector:         true,
		Fulltext:       false,
		Hybrid:         false,
		RerankModel:    "rerank-english-v2.0",
		TopK:           4,
		ScoreThreshold: 0.0,
	}

	if config.SearchConfig != nil {
		searchConfig = *config.SearchConfig
	}

	modelConfig := &model.ModelConfigData{
		Version: "1.0",
		LogicReasoning: model.ModelChannelConfig{
			ChannelID: config.LogicChannelID,
			ModelName: config.LogicModelName,
		},
		VectorEmbedding: model.ModelChannelConfig{
			ChannelID: config.EmbeddingChannelID,
			ModelName: config.EmbeddingModelName,
		},
		FastReasoning: model.ModelChannelConfig{
			ChannelID: nil,
			ModelName: nil,
		},
		SearchConfig: searchConfig,
	}

	return modelConfig, nil
}

// UpdateModelConfigInChunkConfig 更新分块配置中的模型配置
func (s *ChunkConfigService) UpdateModelConfigInChunkConfig(config *ChunkConfig, modelConfig *model.ModelConfigData) error {
	if modelConfig == nil {
		return nil
	}

	// 直接获取并更新 ChunkSetting 的 ModelConfigJSON
	var setting model.ChunkSetting
	if err := s.db.Where("id = ?", config.ID).First(&setting).Error; err != nil {
		// 如果找不到 ChunkSetting，创建一个新的
		setting = model.ChunkSetting{
			ID:        config.ID,
			Eid:       config.Eid,
			LibraryID: config.LibraryID,
			Type:      config.Type,
			Name:      config.Name,
		}
	}

	// 直接设置完整的模型配置，包括 FastReasoning
	if err := setting.SetModelConfig(modelConfig); err != nil {
		return err
	}

	// 保存 ChunkSetting
	if err := s.db.Save(&setting).Error; err != nil {
		return err
	}

	// 为了兼容性，也更新 ChunkConfig 的字段
	// 更新逻辑模型配置
	if modelConfig.LogicReasoning.ChannelID != nil {
		config.LogicChannelID = modelConfig.LogicReasoning.ChannelID
	}
	if modelConfig.LogicReasoning.ModelName != nil {
		config.LogicModelName = modelConfig.LogicReasoning.ModelName
	}

	// 更新嵌入模型配置
	if modelConfig.VectorEmbedding.ChannelID != nil {
		config.EmbeddingChannelID = modelConfig.VectorEmbedding.ChannelID
	}
	if modelConfig.VectorEmbedding.ModelName != nil {
		config.EmbeddingModelName = modelConfig.VectorEmbedding.ModelName
	}
	config.FastReasoning = modelConfig.FastReasoning

	// 更新搜索配置
	config.SearchConfig = &modelConfig.SearchConfig

	return nil
}

// GetChunkingConfigFromChunkConfig 从分块配置中提取资料拆分配置JSON
func (s *ChunkConfigService) GetChunkingConfigFromChunkConfig(config *ChunkConfig) (*model.ChunkingConfigData, error) {
	// 构建分块配置JSON
	chunkingConfig := &model.ChunkingConfigData{
		Version:        "1.0",
		KnowledgeChunk: config.KnowledgeChunk,
		IndexChunk:     config.IndexChunk,
		ContentSummary: model.ContentGenerationConfig{
			GenerationMethod: config.SummaryGeneration,
		},
		CommonQuestions: model.ContentGenerationConfig{
			GenerationMethod: config.QuestionGeneration,
		},
		Type: config.Type,
		Name: config.Name,
	}

	return chunkingConfig, nil
}

// UpdateChunkingConfigInChunkConfig 更新分块配置中的资料拆分配置
func (s *ChunkConfigService) UpdateChunkingConfigInChunkConfig(config *ChunkConfig, chunkingConfig *model.ChunkingConfigData) error {
	if chunkingConfig == nil {
		return nil
	}

	// 更新知识块配置
	config.KnowledgeChunk = chunkingConfig.KnowledgeChunk
	config.KnowledgeMaxLength = chunkingConfig.KnowledgeChunk.MaxLength
	config.KnowledgeOverlapSize = chunkingConfig.KnowledgeChunk.OverlapSize
	config.KnowledgeIncludeTitle = chunkingConfig.KnowledgeChunk.IncludeTitle
	config.KnowledgeIncludeFileName = chunkingConfig.KnowledgeChunk.IncludeFileName
	config.KnowledgeIncludeSubtitle = chunkingConfig.KnowledgeChunk.AppendSubtitle

	// 更新索引块配置
	config.IndexChunk = chunkingConfig.IndexChunk
	config.IndexMaxLength = chunkingConfig.IndexChunk.MaxLength
	config.IndexOverlapSize = chunkingConfig.IndexChunk.OverlapSize
	config.IndexIncludeTitle = chunkingConfig.IndexChunk.IncludeTitle
	config.IndexIncludeFileName = chunkingConfig.IndexChunk.IncludeFileName
	config.IndexIncludeSubtitle = chunkingConfig.IndexChunk.AppendSubtitle

	// 更新内容生成配置
	config.SummaryGeneration = chunkingConfig.ContentSummary.GenerationMethod
	config.QuestionGeneration = chunkingConfig.CommonQuestions.GenerationMethod

	return nil
}

// DeleteLibraryConfig 删除知识库配置
func (s *ChunkConfigService) DeleteLibraryConfig(eid, libraryID int64, chunkType string) error {
	// 查找知识库配置
	var setting model.ChunkSetting
	err := s.db.Where("eid = ? AND library_id = ? AND type = ?", eid, libraryID, chunkType).First(&setting).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			// 记录不存在，认为删除成功
			return nil
		}
		return err
	}

	// 删除配置
	return s.db.Delete(&setting).Error
}

// getSystemDefaultConfigs 获取系统默认配置列表
func (s *ChunkConfigService) getSystemDefaultConfigs(eid int64) []*ChunkConfig {
	// 优先从数据库搜索 eid 为0的设置
	var systemSettings []model.ChunkSetting
	err := s.db.Where("eid = ? AND library_id IS NULL", 0).Find(&systemSettings).Error
	if err == nil && len(systemSettings) > 0 {
		// 如果找到了eid为0的设置，转换并返回
		var configs []*ChunkConfig
		for _, setting := range systemSettings {
			config, err := s.convertToChunkConfig(&setting)
			if err != nil {
				continue
			}
			configs = append(configs, config)
		}
		return configs
	}

	// 如果数据不存在，则使用默认数据
	defaultConfig := s.getSystemDefaultConfig(eid)
	qaConfig := s.getSystemQaConfig(eid)
	dataTableConfig := s.getSystemDataTableConfig(eid)
	// 系统默认
	saveDefaultConfig := *defaultConfig

	// 将默认数据的 eid 改为0
	saveDefaultConfig.Eid = 0
	defaultConfig.Eid = 0
	qaConfig.Eid = 0
	dataTableConfig.Eid = 0

	// 保存到数据库中
	saveDefaultConfig.EmbeddingChannelID = nil
	saveDefaultConfig.EmbeddingModelName = nil
	saveDefaultConfig.LogicChannelID = nil
	saveDefaultConfig.LogicModelName = nil
	defaultSetting := s.convertToChunkSetting(&saveDefaultConfig)

	qaSetting := &model.ChunkSetting{
		Eid:       0,
		Type:      qaConfig.Type,
		Name:      qaConfig.Name,
		LibraryID: nil,
	}

	dataTableSetting := &model.ChunkSetting{
		Eid:       0,
		Type:      dataTableConfig.Type,
		Name:      dataTableConfig.Name,
		LibraryID: nil,
	}

	// 保存到数据库
	s.db.Create(defaultSetting)
	s.db.Create(qaSetting)
	s.db.Create(dataTableSetting)

	// 返回默认数据
	return []*ChunkConfig{defaultConfig, qaConfig, dataTableConfig}
}
