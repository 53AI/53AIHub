package model

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// 文档类型常量
const (
	ChunkTypeDefault        = "default"         // 通用文档
	ChunkTypeDataTable      = "data_table"      // 数据表格
	ChunkTypeQA             = "qa"              // 百问百答
	ChunkTypeProductPlan    = "product_plan"    // 产品方案
	ChunkTypeProductCatalog = "product_catalog" // 产品画册
	ChunkTypeVideoCourse    = "video_course"    // 视频课程
	ChunkTypeCustom         = "custom"          // 自定义
)

type ChunkSetting struct {
	ID        int64  `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid       int64  `json:"eid" gorm:"not null;index"`
	LibraryID *int64 `json:"library_id" gorm:"index" comment:"知识库ID，NULL表示站点默认配置"`
	Type      string `json:"type" gorm:"type:varchar(50);default:'default'" comment:"文档类型"`
	Name      string `json:"name" gorm:"type:varchar(255);not null"`

	// JSON配置字段 - 新的配置存储方式
	ModelConfigJSON    string `json:"model_config_json" gorm:"not null" comment:"模型设置JSON"`
	ChunkingConfigJSON string `json:"chunking_config_json" gorm:"not null" comment:"资料拆分设置JSON"`

	BaseModel
}

// KeywordSetting 关键词设置
type KeywordSetting struct {
	KeywordWeight float64 `json:"keyword_weight"` // 关键词权重
}

// VectorSetting 向量设置
type VectorSetting struct {
	VectorWeight float64 `json:"vector_weight"` // 向量权重
}

// SearchWeights 搜索权重配置
type SearchWeights struct {
	KeywordSetting KeywordSetting `json:"keyword_setting"` // 关键词设置
	VectorSetting  VectorSetting  `json:"vector_setting"`  // 向量设置
}

// SearchConfigData 检索配置结构
type SearchConfigData struct {
	Vector                bool          `json:"vector"`
	Fulltext              bool          `json:"fulltext"`
	Hybrid                bool          `json:"hybrid"`
	RerankModel           string        `json:"rerank_model"`
	RerankChannelId       int           `json:"rerank_channel_id"`
	RerankModelName       string        `json:"rerank_model_name"`
	RerankingEnable       bool          `json:"reranking_enable"`
	TopK                  int           `json:"top_k"`
	ScoreThreshold        float64       `json:"score_threshold"`
	ScoreThresholdEnabled bool          `json:"score_threshold_enabled"`
	Weights               SearchWeights `json:"weights"` // 权重配置
}

// ModelConfigData 模型设置JSON结构
type ModelConfigData struct {
	Version         string             `json:"version"`
	LogicReasoning  ModelChannelConfig `json:"logic_reasoning"`
	VectorEmbedding ModelChannelConfig `json:"vector_embedding"`
	FastReasoning   ModelChannelConfig `json:"fast_reasoning"`
	SearchConfig    SearchConfigData   `json:"search_config"`
}

// ModelChannelConfig 模型渠道配置
type ModelChannelConfig struct {
	ChannelID *int64  `json:"channel_id"`
	ModelName *string `json:"model_name"`
}

// ChunkingConfigData 资料拆分设置JSON结构
type ChunkingConfigData struct {
	Version string `json:"version"`
	Type    string `json:"type"` // 文档类型
	Name    string `json:"name"`
	// split_rule none：不拆分；h1-h6：按标题拆分；按自定义分隔符拆分
	KnowledgeChunk KnowledgeChunkingConfig `json:"knowledge_chunking"`
	// split_rule none：不拆分；h1-h6：按标题拆分；按自定义分隔符拆分
	IndexChunk      IndexChunkingConfig     `json:"index_chunking"`
	ContentSummary  ContentGenerationConfig `json:"content_summary"`
	CommonQuestions ContentGenerationConfig `json:"common_questions"`
}

// KnowledgeChunkingConfig 知识点分块配置
type KnowledgeChunkingConfig struct {
	// SplitRule 分割规则，支持多个分割符，用逗号分隔
	// 例如: "h2" (单个分割符) 或 "h2,h3,\n\n" (多个分割符)
	// 支持的分隔符: none, h1, h2, h3, h4, h5, h6, \n\n (双换行), \n (单换行), 或自定义文本
	SplitRule       string `json:"split_rule"`
	MaxLength       int    `json:"max_length"`
	OverlapSize     int    `json:"overlap_size"`
	IncludeTitle    bool   `json:"include_title"`     // 是否将知识标题添加到知识点中
	IncludeFileName bool   `json:"include_filename"`  // 是否将文件名称添加到知识点中
	AppendSubtitle  bool   `json:"append_subtitle"`   // 是否将子标题添加到知识点中
	IsSystemDefault bool   `json:"is_system_default"` // 是否为选择为系统默认配置
	ChunkMode       string `json:"chunk_mode"`        // 分块模式，identifier_first 或 length_first
}

// IndexChunkingConfig 索引块分块配置（与知识点分块结构一致）
type IndexChunkingConfig struct {
	// SplitRule 分割规则，支持多个分割符，用逗号分隔
	// 例如: "\n\n" (单个分割符) 或 "\n\n,---,###" (多个分割符)
	// 支持的分隔符: none, h1, h2, h3, h4, h5, h6, \n\n (双换行), \n (单换行), 或自定义文本
	SplitRule       string `json:"split_rule"`
	MaxLength       int    `json:"max_length"`
	OverlapSize     int    `json:"overlap_size"`
	IncludeTitle    bool   `json:"include_title"`     // 是否将知识标题添加到索引块中
	IncludeFileName bool   `json:"include_filename"`  // 是否将文件名称添加到索引块中
	AppendSubtitle  bool   `json:"append_subtitle"`   // 是否将子标题添加到索引块中
	IsSystemDefault bool   `json:"is_system_default"` // 是否为选择为系统默认配置
	ChunkMode       string `json:"chunk_mode"`        // 分块模式，identifier_first 或 length_first
}

// ResetBySystemDefault 重置为系统默认配置
func (kcc *KnowledgeChunkingConfig) ResetBySystemDefault() {
	if kcc.IsSystemDefault {
		kcc.MaxLength = 2048
		kcc.ChunkMode = "length_first"
		kcc.SplitRule = "\n\n,\r\n\r\n,\n,\r\n,.,。,;,； " // 默认多个分割符
	}
}

func (icc *IndexChunkingConfig) ResetBySystemDefault() {
	if icc.IsSystemDefault {
		icc.MaxLength = 384
		icc.ChunkMode = "length_first"
		icc.SplitRule = "\n\n,\r\n\r\n,\n,\r\n,.,。,;,； " // 默认多个分割符
	}
}

// GetSplitRules 获取分割规则数组，支持多个分割符
func (k *KnowledgeChunkingConfig) GetSplitRules() []string {
	if k.SplitRule == "" {
		return []string{}
	}

	// 去除空格并按逗号分割
	rules := strings.Split(strings.ReplaceAll(k.SplitRule, " ", ""), ",")
	var result []string
	for _, rule := range rules {
		if rule != "" {
			result = append(result, rule)
		}
	}
	return result
}

// SetSplitRules 设置分割规则，支持多个分割符
func (k *KnowledgeChunkingConfig) SetSplitRules(rules []string) {
	k.SplitRule = strings.Join(rules, ",")
}

// GetSplitRules 获取分割规则数组，支持多个分割符
func (i *IndexChunkingConfig) GetSplitRules() []string {
	if i.SplitRule == "" {
		return []string{}
	}

	// 去除空格并按逗号分割
	rules := strings.Split(strings.ReplaceAll(i.SplitRule, " ", ""), ",")
	var result []string
	for _, rule := range rules {
		if rule != "" {
			result = append(result, rule)
		}
	}
	return result
}

// SetSplitRules 设置分割规则，支持多个分割符
func (i *IndexChunkingConfig) SetSplitRules(rules []string) {
	i.SplitRule = strings.Join(rules, ",")
}

// ContentGenerationConfig 内容生成配置
type ContentGenerationConfig struct {
	GenerationMethod string `json:"generation_method"`
}

// Save 创建分块配置
func (cs *ChunkSetting) Save() error {
	result := DB.Create(cs)
	if result.Error != nil {
		return result.Error
	}
	return nil
}

// Update 更新分块配置
func (cs *ChunkSetting) Update() error {
	result := DB.Model(cs).Updates(cs)
	if result.Error != nil {
		return result.Error
	}
	return nil
}

// GetSearchConfig 获取解析后的检索配置
func (cs *ChunkSetting) GetSearchConfig() (*SearchConfigData, error) {
	// 从ModelConfigJSON中获取搜索配置
	modelConfig, err := cs.GetModelConfig()
	if err != nil {
		// 返回默认配置
		return &SearchConfigData{
			Vector:                true,
			Fulltext:              false,
			Hybrid:                false,
			TopK:                  4,
			ScoreThreshold:        0.0,
			ScoreThresholdEnabled: true,
			Weights: SearchWeights{
				KeywordSetting: KeywordSetting{
					KeywordWeight: 0.5,
				},
				VectorSetting: VectorSetting{
					VectorWeight: 0.5,
				},
			},
		}, nil
	}

	return &modelConfig.SearchConfig, nil
}

// SetSearchConfig 设置检索配置
func (cs *ChunkSetting) SetSearchConfig(config *SearchConfigData) error {
	// 获取现有的模型配置
	modelConfig, err := cs.GetModelConfig()
	if err != nil {
		// 创建新的模型配置
		modelConfig = &ModelConfigData{
			Version: "1.0",
			LogicReasoning: ModelChannelConfig{
				ChannelID: nil,
				ModelName: nil,
			},
			VectorEmbedding: ModelChannelConfig{
				ChannelID: nil,
				ModelName: nil,
			},
			FastReasoning: ModelChannelConfig{
				ChannelID: nil,
				ModelName: nil,
			},
		}
	}

	// 更新搜索配置
	modelConfig.SearchConfig = *config

	// 保存回JSON
	return cs.SetModelConfig(modelConfig)
}

// GetModelConfig 获取解析后的模型配置
func (cs *ChunkSetting) GetModelConfig() (*ModelConfigData, error) {
	if cs.ModelConfigJSON == "" {
		// 返回默认配置
		return &ModelConfigData{
			Version: "1.0",
			LogicReasoning: ModelChannelConfig{
				ChannelID: nil,
				ModelName: nil,
			},
			VectorEmbedding: ModelChannelConfig{
				ChannelID: nil,
				ModelName: nil,
			},
			FastReasoning: ModelChannelConfig{
				ChannelID: nil,
				ModelName: nil,
			},
			SearchConfig: SearchConfigData{
				Vector:                true,
				Fulltext:              false,
				Hybrid:                false,
				RerankModel:           "rerank-english-v2.0",
				RerankingEnable:       false,
				TopK:                  4,
				ScoreThreshold:        0.0,
				ScoreThresholdEnabled: true,
				Weights: SearchWeights{
					KeywordSetting: KeywordSetting{
						KeywordWeight: 0.5,
					},
					VectorSetting: VectorSetting{
						VectorWeight: 0.5,
					},
				},
			},
		}, nil
	}

	var config ModelConfigData
	err := json.Unmarshal([]byte(cs.ModelConfigJSON), &config)
	if err != nil {
		return nil, err
	}
	return &config, nil
}

// SetModelConfig 设置模型配置
func (cs *ChunkSetting) SetModelConfig(config *ModelConfigData) error {
	data, err := json.Marshal(config)
	if err != nil {
		return err
	}
	cs.ModelConfigJSON = string(data)
	return nil
}

// GetChunkingConfig 获取解析后的资料拆分配置
func (cs *ChunkSetting) GetChunkingConfig() (*ChunkingConfigData, error) {
	if cs.ChunkingConfigJSON == "" {
		// 返回默认配置
		return &ChunkingConfigData{
			Version: "1.0",
			KnowledgeChunk: KnowledgeChunkingConfig{
				SplitRule:       "h2",
				MaxLength:       2000,
				OverlapSize:     0,
				IncludeTitle:    false,
				IncludeFileName: false,
			},
			IndexChunk: IndexChunkingConfig{
				SplitRule:       "\n\n",
				MaxLength:       2000,
				OverlapSize:     0,
				IncludeTitle:    false,
				IncludeFileName: false,
			},
			ContentSummary: ContentGenerationConfig{
				GenerationMethod: "manual",
			},
			CommonQuestions: ContentGenerationConfig{
				GenerationMethod: "manual",
			},
		}, nil
	}

	var config ChunkingConfigData
	err := json.Unmarshal([]byte(cs.ChunkingConfigJSON), &config)
	if err != nil {
		return nil, err
	}
	return &config, nil
}

// SetChunkingConfig 设置资料拆分配置
func (cs *ChunkSetting) SetChunkingConfig(config *ChunkingConfigData) error {
	data, err := json.Marshal(config)
	if err != nil {
		return err
	}
	cs.ChunkingConfigJSON = string(data)
	return nil
}

// GetChunkSettingByID 根据ID获取分块配置
func GetChunkSettingByID(eid int64, id int64) (*ChunkSetting, error) {
	var setting ChunkSetting
	if err := DB.Where("eid = ? AND id = ?", eid, id).First(&setting).Error; err != nil {
		return nil, err
	}
	return &setting, nil
}

// GetDefaultChunkSetting 获取默认分块配置
func GetDefaultChunkSetting(eid int64, libraryID *int64) (*ChunkSetting, error) {
	var setting ChunkSetting

	// 优先获取知识库专用配置
	if libraryID != nil {
		err := DB.Where("eid = ? AND library_id = ?", eid, *libraryID).First(&setting).Error
		if err == nil {
			return &setting, nil
		}
	}

	// 获取站点默认配置（library_id为NULL的第一个配置）
	err := DB.Where("eid = ? AND library_id IS NULL", eid).First(&setting).Error
	if err != nil {
		return nil, err
	}

	return &setting, nil
}

// GetChunkSettingsByEid 获取企业下的所有分块配置
func GetChunkSettingsByEid(eid int64, libraryID *int64) ([]ChunkSetting, error) {
	var settings []ChunkSetting
	query := DB.Where("eid = ?", eid)

	if libraryID != nil {
		query = query.Where("library_id = ?", *libraryID)
	}

	if err := query.Order("is_default desc, created_time desc").Find(&settings).Error; err != nil {
		return nil, err
	}
	return settings, nil
}

// DeleteChunkSetting 删除分块配置
func DeleteChunkSetting(eid int64, id int64) error {
	// 检查是否有文档正在使用此配置
	var count int64
	err := DB.Model(&File{}).Where("eid = ? AND config_id = ?", eid, id).Count(&count).Error
	if err != nil {
		return err
	}

	if count > 0 {
		return errors.New("配置正在使用中，无法删除")
	}

	if err := DB.Where("eid = ? AND id = ?", eid, id).Delete(&ChunkSetting{}).Error; err != nil {
		return err
	}
	return nil
}

// GetEmbeddingChannel 获取embedding渠道信息
func (cs *ChunkSetting) GetEmbeddingChannel() (*Channel, error) {
	modelConfig, err := cs.GetModelConfig()
	if err != nil || modelConfig.VectorEmbedding.ChannelID == nil {
		return nil, nil
	}

	var channel Channel
	err = DB.Where("channel_id = ?", *modelConfig.VectorEmbedding.ChannelID).First(&channel).Error
	if err != nil {
		return nil, err
	}
	return &channel, nil
}

// GetLogicChannel 获取逻辑推理渠道信息
func (cs *ChunkSetting) GetLogicChannel() (*Channel, error) {
	modelConfig, err := cs.GetModelConfig()
	if err != nil || modelConfig.LogicReasoning.ChannelID == nil {
		return nil, nil
	}

	var channel Channel
	err = DB.Where("channel_id = ?", *modelConfig.LogicReasoning.ChannelID).First(&channel).Error
	if err != nil {
		return nil, err
	}
	return &channel, nil
}

// ValidateChannels 验证渠道配置是否有效
func (cs *ChunkSetting) ValidateChannels() error {
	modelConfig, err := cs.GetModelConfig()
	if err != nil {
		return err
	}

	if modelConfig.VectorEmbedding.ChannelID != nil {
		var count int64
		err := DB.Model(&Channel{}).Where("channel_id = ? AND status = ?",
			*modelConfig.VectorEmbedding.ChannelID, 1).Count(&count).Error // 1 = ChannelStatusEnabled
		if err != nil {
			return err
		}
		if count == 0 {
			return fmt.Errorf("embedding渠道不存在或已禁用")
		}
	}

	if modelConfig.LogicReasoning.ChannelID != nil {
		var count int64
		err := DB.Model(&Channel{}).Where("channel_id = ? AND status = ?",
			*modelConfig.LogicReasoning.ChannelID, 1).Count(&count).Error // 1 = ChannelStatusEnabled
		if err != nil {
			return err
		}
		if count == 0 {
			return fmt.Errorf("逻辑推理渠道不存在或已禁用")
		}
	}

	return nil
}

// CreateDefaultChunkSetting 创建默认分块配置
func CreateDefaultChunkSetting(eid int64, libraryID *int64) (*ChunkSetting, error) {
	setting := &ChunkSetting{
		Eid:       eid,
		LibraryID: libraryID,
	}

	// 设置默认的分块配置
	chunkingConfig := &ChunkingConfigData{
		Version: "1.0",
		KnowledgeChunk: KnowledgeChunkingConfig{
			SplitRule:       "h2",
			MaxLength:       2000,
			OverlapSize:     0,
			IncludeTitle:    false,
			IncludeFileName: false,
		},
		IndexChunk: IndexChunkingConfig{
			SplitRule:    "\n\n",
			MaxLength:    2000,
			OverlapSize:  0,
			IncludeTitle: false,
		},
		ContentSummary: ContentGenerationConfig{
			GenerationMethod: "manual",
		},
		CommonQuestions: ContentGenerationConfig{
			GenerationMethod: "manual",
		},
	}

	// 设置默认的模型配置
	modelConfig := &ModelConfigData{
		Version: "1.0",
		LogicReasoning: ModelChannelConfig{
			ChannelID: nil,
			ModelName: nil,
		},
		VectorEmbedding: ModelChannelConfig{
			ChannelID: nil,
			ModelName: nil,
		},
		FastReasoning: ModelChannelConfig{
			ChannelID: nil,
			ModelName: nil,
		},
		SearchConfig: SearchConfigData{
			Vector:                true,
			Fulltext:              false,
			Hybrid:                false,
			RerankModel:           "rerank-english-v2.0",
			RerankingEnable:       false,
			TopK:                  4,
			ScoreThreshold:        0.0,
			ScoreThresholdEnabled: true,
			Weights: SearchWeights{
				KeywordSetting: KeywordSetting{
					KeywordWeight: 0.5,
				},
				VectorSetting: VectorSetting{
					VectorWeight: 0.5,
				},
			},
		},
	}

	// 保存JSON配置
	if err := setting.SetChunkingConfig(chunkingConfig); err != nil {
		return nil, err
	}
	if err := setting.SetModelConfig(modelConfig); err != nil {
		return nil, err
	}

	if err := setting.Save(); err != nil {
		return nil, err
	}

	return setting, nil
}

// GetDefaultChunkSettingByType 根据类型获取默认分块配置
func GetDefaultChunkSettingByType(eid int64, libraryID *int64, chunkType string) (*ChunkSetting, error) {
	var setting ChunkSetting
	query := DB.Where("eid = ? AND type = ?", eid, chunkType)
	if libraryID != nil {
		query = query.Where("library_id = ?", *libraryID)
	} else {
		query = query.Where("library_id IS NULL")
	}

	if err := query.First(&setting).Error; err != nil {
		querySystem := DB.Where("eid = ? AND library_id IS NULL AND type = ?", 0, chunkType).First(&setting)
		if querySystem.Error != nil {
			return nil, querySystem.Error
		}
	}

	return &setting, nil
}
