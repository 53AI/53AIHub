package model

type RagPipelineStepKey string

const (
	RagPipelineStepKeyContentCleaning RagPipelineStepKey = "content_cleaning" // 内容清洗节点
)

const (
	ContentCleaningConfigKeyRemoveInvalidTags  = "remove_invalid_tags" // 移除无效标签
	ContentCleaningConfigKeyTypoCorrection     = "typo_correction"     // 错别字纠正
	ContentCleaningConfigKeySpecialCharFilter  = "special_char_filter" // 特殊字符过滤
	ContentCleaningConfigKeyPronounReplacement = "pronoun_replacement" // 代词替换
	ContentCleaningConfigKeyShortTextFilter    = "short_text_filter"   // 短文本过滤
	ContentCleaningConfigKeyGrammarCorrection  = "grammar_correction"  // 语法错误纠正
)

const (
	ContentCleaningSpecialCharThresholdDefault = 0.1 // 特殊字符过滤默认阈值
	ContentCleaningShortTextMinLengthDefault   = 5   // 短文本过滤默认字数
)

type ContentCleaningConfig struct {
	RemoveInvalidTags  bool                    `json:"remove_invalid_tags"`
	TypoCorrection     bool                    `json:"typo_correction"`
	SpecialCharFilter  SpecialCharFilterConfig `json:"special_char_filter"`
	PronounReplacement bool                    `json:"pronoun_replacement"`
	ShortTextFilter    ShortTextFilterConfig   `json:"short_text_filter"`
	GrammarCorrection  bool                    `json:"grammar_correction"`
}

type SpecialCharFilterConfig struct {
	Enabled   bool    `json:"enabled"`
	Threshold float64 `json:"threshold"`
}

type ShortTextFilterConfig struct {
	Enabled   bool `json:"enabled"`
	MinLength int  `json:"min_length"`
}
