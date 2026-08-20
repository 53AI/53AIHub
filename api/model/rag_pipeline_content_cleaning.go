package model

type RagPipelineStepKey string

const (
	RagPipelineStepKeyContentCleaning RagPipelineStepKey = "content_cleaning" // 内容清洗节点
)

// ContentCleaningConfig 内容清洗步骤配置。
// 由企业默认逻辑推理模型执行，支持九项可独立开关的清洗能力。
type ContentCleaningConfig struct {
	RemoveInvalidTags  bool                `json:"remove_invalid_tags"` // 移除无效标签：页眉、页脚、页码、注脚等
	TypoCorrection     bool                `json:"typo_correction"`     // 错别字纠正
	GrammarCorrection  bool                `json:"grammar_correction"`  // 语法错误纠正
	FormatCorrection   bool                `json:"format_correction"`   // 格式纠正：Markdown 表格、加粗、代码块等闭合格式补全
	OCRCorrection      bool                `json:"ocr_correction"`      // OCR 识别纠错：水印、杂字及勾选/叉选标记还原
	FormulaRestoration bool                `json:"formula_restoration"` // 公式还原：修正 OCR 造成的公式样式错位
	SensitiveMask      SensitiveMaskConfig `json:"sensitive_mask"`      // 敏感信息脱敏（仅 mask，不支持 filter）

	Glossary     GlossaryConfig     `json:"glossary"`      // 专业词库：开关 + 词条列表
	CustomPrompt CustomPromptConfig `json:"custom_prompt"` // 自定义规则：开关 + 附加提示词
}

// GlossaryConfig 专业词库配置。
type GlossaryConfig struct {
	Enabled bool     `json:"enabled"`
	Items   []string `json:"items"`
}

// CustomPromptConfig 自定义规则配置。
type CustomPromptConfig struct {
	Enabled bool   `json:"enabled"`
	Content string `json:"content"`
}

// SensitiveMaskConfig 敏感信息脱敏配置。
// 只支持 mask 模式，由大模型识别并以保留部分字符的方式脱敏；
// 不在本地通过正则或字符串规则识别敏感信息。
type SensitiveMaskConfig struct {
	Enabled bool     `json:"enabled"`
	Fields  []string `json:"fields"`
}

// DefaultContentCleaningConfig 返回企业初始化默认内容清洗配置：
// 默认开启移除无效标签、错别字纠正、格式纠正、OCR 识别纠错；
// 默认关闭语法纠正、公式还原、敏感信息脱敏、专业词库、自定义规则。
func DefaultContentCleaningConfig() ContentCleaningConfig {
	return ContentCleaningConfig{
		RemoveInvalidTags:  true,
		TypoCorrection:     true,
		GrammarCorrection:  false,
		FormatCorrection:   true,
		OCRCorrection:      true,
		FormulaRestoration: false,
		SensitiveMask: SensitiveMaskConfig{
			Enabled: false,
			Fields:  []string{},
		},
		Glossary: GlossaryConfig{
			Enabled: false,
			Items:   []string{},
		},
		CustomPrompt: CustomPromptConfig{
			Enabled: false,
			Content: "",
		},
	}
}

// EnabledFeatureKeys 返回已开启的清洗能力 key 列表，用于构造批次请求。
func (c ContentCleaningConfig) EnabledFeatureKeys() []string {
	keys := make([]string, 0, 9)
	if c.RemoveInvalidTags {
		keys = append(keys, "remove_invalid_tags")
	}
	if c.TypoCorrection {
		keys = append(keys, "typo_correction")
	}
	if c.GrammarCorrection {
		keys = append(keys, "grammar_correction")
	}
	if c.FormatCorrection {
		keys = append(keys, "format_correction")
	}
	if c.OCRCorrection {
		keys = append(keys, "ocr_correction")
	}
	if c.FormulaRestoration {
		keys = append(keys, "formula_restoration")
	}
	if c.SensitiveMask.Enabled {
		keys = append(keys, "sensitive_mask")
	}
	if c.Glossary.Enabled && len(c.Glossary.Items) > 0 {
		keys = append(keys, "glossary")
	}
	if c.CustomPrompt.Enabled && c.CustomPrompt.Content != "" {
		keys = append(keys, "custom_prompt")
	}
	return keys
}
