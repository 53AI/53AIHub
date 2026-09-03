package service

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/rag"
	"gorm.io/gorm"
)

type WikiCategoryDraftInput struct {
	Name        string
	Description string
	GrowthMode  string
}

type WikiCategoryDraft struct {
	Name               string                              `json:"name"`
	Description        string                              `json:"description"`
	TargetEntityType   string                              `json:"target_entity_type"`
	OKFType            string                              `json:"okf_type"`
	GrowthMode         string                              `json:"growth_mode"`
	StylePrompt        string                              `json:"style_prompt"`
	StylePromptTitle   string                              `json:"style_prompt_title"`
	GraphDepth         int                                 `json:"graph_depth"`
	Creativity         float64                             `json:"creativity"`
	AnchorLinksEnabled bool                                `json:"anchor_links_enabled"`
	TemplateMarkdown   string                              `json:"template_markdown"`
	TemplateSections   []model.WikiCategoryTemplateSection `json:"template_sections"`
	StrictFill         bool                                `json:"strict_fill"`
	Status             string                              `json:"status"`
	Sort               int64                               `json:"sort"`
}

type WikiCategoryDraftResponse struct {
	Categories []WikiCategoryDraft `json:"categories"`
}

type WikiCategoryDraftService struct {
	llm WikiLLMRunner
}

func NewWikiCategoryDraftService(llm WikiLLMRunner) *WikiCategoryDraftService {
	return &WikiCategoryDraftService{llm: llm}
}

func NewWikiCategoryDraftServiceForEnterprise(db *gorm.DB, eid int64) (*WikiCategoryDraftService, error) {
	config, err := rag.NewChunkConfigService(db).GetEnterpriseEmbeddingConfig(eid)
	if err != nil {
		return nil, fmt.Errorf("get enterprise wiki llm config: %w", err)
	}
	if config == nil {
		return nil, errors.New("未配置企业默认逻辑推理渠道，无法生成 Wiki 分类草稿")
	}
	return NewWikiCategoryDraftService(NewWikiPromptLLMRunner(db, config)), nil
}

func (s *WikiCategoryDraftService) Generate(ctx context.Context, input WikiCategoryDraftInput) (*WikiCategoryDraftResponse, error) {
	if s == nil || s.llm == nil {
		return nil, errors.New("Wiki 分类草稿生成渠道未配置")
	}
	if strings.TrimSpace(input.Name) == "" {
		return nil, errors.New("空间名称不能为空")
	}
	input.GrowthMode = normalizeWikiCategoryDraftGrowthMode(input.GrowthMode)
	if input.GrowthMode == "" {
		return nil, errors.New("growth_mode 只能是 smart 或 fixed")
	}
	prompt := buildWikiCategoryDraftPrompt(input)
	raw, err := s.llm.Generate(ctx, prompt)
	if err != nil {
		return nil, fmt.Errorf("生成 Wiki 分类草稿失败：%w", err)
	}
	var response WikiCategoryDraftResponse
	if err := common.ParseLLMJSONInto(ctx, raw, &response); err != nil {
		return nil, fmt.Errorf("解析 Wiki 分类草稿失败：%w", err)
	}
	if err := validateWikiCategoryDraft(&response, input.GrowthMode); err != nil {
		return nil, err
	}
	return &response, nil
}

func buildWikiCategoryDraftPrompt(input WikiCategoryDraftInput) string {
	mode := normalizeWikiCategoryDraftGrowthMode(input.GrowthMode)
	if mode == "" {
		mode = model.WikiCategoryGrowthModeSmart
	}
	modeInstruction := `当前 growth_mode 为 smart：不要生成固定模板章节，template_sections 输出空数组；根据空间内容为每个分类选择最合适的写作风格。style_prompt_title 必须是“专业严谨”“通俗易懂”“对话访谈”之一，或使用“自定义”并提供具体 style_prompt。`
	modeExample := `"growth_mode":"smart","style_prompt":"专业严谨，使用业务人员容易理解的语言，多用数据和事实支撑","style_prompt_title":"专业严谨","graph_depth":1,"creativity":0.5,"anchor_links_enabled":true,"template_markdown":"","template_sections":[],"strict_fill":false`
	if mode == model.WikiCategoryGrowthModeFixed {
		modeInstruction = `当前 growth_mode 为 fixed：每个分类必须生成至少 4 个章节的完整、多层级 template_sections，不固定章节数量，也不设上限；先分析分类对象，再从多个关键角度组织合理的文章结构，不能只生成“概述”和“核心内容”两个章节。每个章节包含纯文本 title、level 和 description；允许多个一级标题（H1），并在 H1 下按需组织 H2、H3 等子章节；style_prompt 和 style_prompt_title 输出空字符串。`
		modeExample = `"growth_mode":"fixed","style_prompt":"","style_prompt_title":"自定义","graph_depth":1,"creativity":0.5,"anchor_links_enabled":true,"template_markdown":"","template_sections":[{"title":"按分类对象动态设计的章节标题","level":1,"description":"该章节填写什么；此项仅表示字段格式，不代表固定章节或固定数量"}],"strict_fill":true`
	}
	return fmt.Sprintf(`你是知识空间 Wiki 分类设计器。请根据空间名称和空间简介，只设计有明确依据、适合长期沉淀知识的分类。

空间名称：%s
空间简介：%s

要求：
- 宁缺毋滥：只有空间名称或简介明确支持的分类才输出；不确定、过于宽泛或仅凭常识推断的分类直接省略。
- 不要为了凑数量生成分类，分类数量以准确为先，可以输出 0 个或多个分类。
- 禁止生成“其他”“其它”“未分类”“通用”“综合”“杂项”等兜底或空泛分类。
- target_entity_type 只能使用 Person、Organization、Product、Location、Time、Event、Document、Concept、Method 之一。
- %s
- 每个章节 level 必须为 1 到 6；没有明确层级时使用 2。fixed 模式必须生成至少 4 个章节，首个章节为 H1，允许多个 H1；H1 下可使用 H2/H3 等子章节，层级最多逐级增加一级，不得无理由跳级。title 不得包含 #，Markdown 标题符号由系统生成。
- template_markdown 是旧字段，固定输出空字符串，不要生成其内容。
- growth_mode 必须为 %s，strict_fill 必须与该模式匹配，status 固定为 enabled。
- smart 模式的写作风格预设：专业严谨（使用业务人员容易理解的语言，多用数据和事实支撑）；通俗易懂（多用比喻和日常例子，避免术语堆砌）；对话访谈（以一问一答或采访形式展开）。请根据空间内容选择，不要机械固定一个风格。
- 只输出 JSON，不要输出 Markdown 代码围栏或解释文字。

输出格式：
	{"categories":[{"name":"分类名称","description":"分类适用范围及依据","target_entity_type":"Product","okf_type":"product",%s,"status":"enabled","sort":1}]}`, strings.TrimSpace(input.Name), strings.TrimSpace(input.Description), modeInstruction, mode, modeExample)
}

func validateWikiCategoryDraft(response *WikiCategoryDraftResponse, growthMode string) error {
	if response == nil {
		return errors.New("Wiki 分类草稿不能为空")
	}
	names := make(map[string]struct{}, len(response.Categories))
	for i := range response.Categories {
		category := &response.Categories[i]
		category.Name = strings.TrimSpace(category.Name)
		category.Description = strings.TrimSpace(category.Description)
		category.TargetEntityType = strings.TrimSpace(category.TargetEntityType)
		if category.Name == "" {
			return errors.New("Wiki 分类草稿包含空的分类名称")
		}
		if isOverbroadWikiCategoryName(category.Name) {
			return fmt.Errorf("Wiki 分类草稿包含过于宽泛的分类：%s", category.Name)
		}
		if _, exists := names[category.Name]; exists {
			return fmt.Errorf("Wiki 分类草稿包含重复的分类名称：%s", category.Name)
		}
		names[category.Name] = struct{}{}
		if _, ok := model.NormalizeWikiCategoryTargetType(category.TargetEntityType); !ok {
			return fmt.Errorf("Wiki 分类草稿包含无效的目标实体类型：%s", category.TargetEntityType)
		}
		if growthMode == model.WikiCategoryGrowthModeFixed && len(category.TemplateSections) == 0 {
			return fmt.Errorf("Wiki 分类草稿模板不能为空：%s", category.Name)
		}
		if growthMode == model.WikiCategoryGrowthModeFixed && len(category.TemplateSections) < 4 {
			return fmt.Errorf("Wiki 分类草稿固定模板至少需要 4 个章节：%s", category.Name)
		}
		for j := range category.TemplateSections {
			category.TemplateSections[j].Title = strings.TrimSpace(category.TemplateSections[j].Title)
			if category.TemplateSections[j].Title == "" {
				return fmt.Errorf("Wiki 分类草稿包含空的模板章节：%s", category.Name)
			}
			if strings.Contains(category.TemplateSections[j].Title, "#") {
				return fmt.Errorf("Wiki 分类草稿模板章节标题不能包含 Markdown 前缀：%s", category.Name)
			}
			if category.TemplateSections[j].Level == 0 {
				category.TemplateSections[j].Level = 2
			}
			if category.TemplateSections[j].Level < 1 || category.TemplateSections[j].Level > 6 {
				return fmt.Errorf("Wiki 分类草稿模板章节层级必须在 1 到 6 之间：%s", category.Name)
			}
			if growthMode == model.WikiCategoryGrowthModeFixed {
				if j == 0 && category.TemplateSections[j].Level != 1 {
					return fmt.Errorf("Wiki 分类草稿固定模板首个章节必须使用 H1：%s", category.Name)
				}
				if j > 0 && category.TemplateSections[j].Level > category.TemplateSections[j-1].Level+1 {
					return fmt.Errorf("Wiki 分类草稿固定模板章节层级不能跳级：%s", category.Name)
				}
			}
		}
		category.GrowthMode = growthMode
		if growthMode == model.WikiCategoryGrowthModeSmart {
			if category.StylePromptTitle == "" {
				category.StylePromptTitle = WikiCategoryStylePresets[0].Title
			}
			if preset, ok := wikiCategoryStylePreset(category.StylePromptTitle); ok {
				category.StylePromptTitle, category.StylePrompt = preset.Title, preset.Prompt
			} else if strings.TrimSpace(category.StylePrompt) == "" {
				return fmt.Errorf("Wiki 分类草稿的自定义写作风格不能为空：%s", category.Name)
			}
			category.TemplateSections = []model.WikiCategoryTemplateSection{}
		} else {
			category.StylePrompt = ""
			category.StylePromptTitle = model.WikiCategoryStylePromptTitleCustom
		}
		if category.GraphDepth == 0 {
			category.GraphDepth = 1
		}
		if category.GraphDepth < 1 || category.GraphDepth > 3 {
			return fmt.Errorf("Wiki 分类草稿的图谱深度无效：%s", category.Name)
		}
		if category.Creativity == 0 {
			category.Creativity = 0.5
		}
		if category.Creativity < 0 || category.Creativity > 1 {
			return fmt.Errorf("Wiki 分类草稿的创造力参数无效：%s", category.Name)
		}
		category.StrictFill = growthMode == model.WikiCategoryGrowthModeFixed
		if category.Status == "" {
			category.Status = model.WikiCategoryStatusEnabled
		}
		if category.Status != model.WikiCategoryStatusEnabled {
			return fmt.Errorf("Wiki 分类草稿状态必须为 enabled：%s", category.Name)
		}
		category.TemplateMarkdown = ""
	}
	return nil
}

func normalizeWikiCategoryDraftGrowthMode(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" {
		return model.WikiCategoryGrowthModeSmart
	}
	if value == model.WikiCategoryGrowthModeSmart || value == model.WikiCategoryGrowthModeFixed {
		return value
	}
	return ""
}

func wikiCategoryStylePreset(title string) (StylePreset, bool) {
	for _, preset := range WikiCategoryStylePresets {
		if strings.TrimSpace(title) == preset.Title {
			return preset, true
		}
	}
	return StylePreset{}, false
}

func isOverbroadWikiCategoryName(name string) bool {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "其他", "其它", "未分类", "通用", "综合", "杂项", "默认":
		return true
	default:
		return false
	}
}
