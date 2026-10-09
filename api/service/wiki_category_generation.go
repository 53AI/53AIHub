package service

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/53AI/53AIHub/model"
)

var wikiMarkdownHeadingPattern = regexp.MustCompile(`^(\s*)(#{1,6})\s+(.+?)\s*$`)

type WikiCategoryGenerationInput struct {
	Category      model.WikiCategory
	EntityName    string
	EntityType    string
	EntitySlug    string
	EntitySummary string
	EntityDetails string
	GraphContext  string
	Language      string
}

type WikiCategoryMatchInput struct {
	Categories []model.WikiCategory
	Candidates []wikiIngestV2Candidate
	Language   string
}

type WikiCategoryMatchBatch struct {
	Results []WikiCategoryMatchResult `json:"results"`
}

type WikiCategoryMatchResult struct {
	Slug       string  `json:"slug"`
	CategoryID int64   `json:"category_id"`
	Confidence float64 `json:"confidence"`
	Reason     string  `json:"reason"`
}

// BuildWikiCategoryMatchPrompt 一次比较所有启用分类与候选实体。
func BuildWikiCategoryMatchPrompt(input WikiCategoryMatchInput) (string, error) {
	if len(input.Categories) == 0 {
		return "", fmt.Errorf("categories are required")
	}
	var categories, candidates strings.Builder
	for _, category := range input.Categories {
		fmt.Fprintf(&categories, "- category_id: %d, 名称: %s, 目标类型: %s, 适用范围: %s\n", category.ID, category.Name, category.TargetEntityType, category.Description)
	}
	for i, candidate := range input.Candidates {
		fmt.Fprintf(&candidates, "%d. slug: %s, name: %s, type: %s, 摘要: %s, 详情: %s\n", i+1, candidate.Slug, candidate.Name, firstNonEmpty(candidate.EntityType, "未知"), candidate.Description, truncateWikiText(candidate.Details, 400))
	}
	language := strings.TrimSpace(input.Language)
	if language == "" {
		language = "中文"
	}
	return fmt.Sprintf("你是分类器。请将每个候选实体与所有分类比较，依据实体内容和分类适用范围选最合适的唯一分类。目标类型只是参考，不是必须相同的硬条件；有合理归属时不要遗漏，没有合适分类时 category_id 为 0。不要因为多个分类都相关就重复归类。语言：%s\n\n分类：\n%s\n候选实体：\n%s\nresults 必须为每个候选 slug 恰好返回一项，slug 和 category_id 必须取自上方列表，禁止修改、改写或省略 slug。confidence 为 0 到 1，category_id=0 表示不归类。输出 JSON：{\"results\":[{\"slug\":\"候选slug\",\"category_id\":0,\"confidence\":0.8,\"reason\":\"一句话原因\"}]}。只输出 JSON，不要额外文本。", language, categories.String(), candidates.String()), nil
}

// CoarseCategoryMatch 粗筛：分类 target 大类与候选 type 的大类比较。
// 候选 type 能规范化为大类（如 person/人物/location）→ 大类相等才放行；
// 候选 type 是无法归类的自由词（如 军阀/皇帝）→ 放行，交给 LLM 语义判断。
func CoarseCategoryMatch(category model.WikiCategory, entityType string) bool {
	want, wantOK := model.NormalizeWikiCategoryTargetType(category.TargetEntityType)
	if !wantOK || want == "" {
		return false
	}
	got, gotOK := model.NormalizeWikiCategoryTargetType(entityType)
	if !gotOK || got == "" {
		return true // 自由词放行
	}
	return want == got
}

func BuildWikiCategoryPrompt(input WikiCategoryGenerationInput) (string, error) {
	if err := ValidateWikiCategoryTemplate(&input.Category); err != nil {
		return "", err
	}
	language := strings.TrimSpace(input.Language)
	if language == "" {
		language = "中文"
	}
	graph := strings.TrimSpace(input.GraphContext)
	if graph == "" {
		graph = "（无图谱上下文）"
	}
	style := strings.TrimSpace(input.Category.StylePrompt)
	if style == "" {
		style = "请使用专业、清晰、基于证据的表达。"
	}
	if input.Category.GrowthMode == model.WikiCategoryGrowthModeFixed {
		sections, _ := WikiCategoryTemplateSections(input.Category)
		var names []string
		for _, section := range sections {
			names = append(names, section.Title)
		}
		// strict_fill 只是 prompt 自由度开关：开启=只按模板标题；关闭=模板标题后允许自由追加。
		constraint := "不得删减或新增一级标题"
		if !input.Category.StrictFill {
			constraint = "可在模板标题之后自由追加其他有价值的章节"
		}
		contract := renderHeadingContract(names)
		if hasWikiCategorySectionDescriptions(sections) {
			contract = renderSectionContract(sections)
		}
		return fmt.Sprintf("你是 Wiki 编辑器。请为分类“%s”生成实体“%s”的 Markdown 页面。\n页面标题由系统单独展示，正文不得重复输出实体标题的一级标题。\n业务场景：%s\n目标实体类型：%s\n语言：%s\n请严格按照以下模板标题组织内容，%s；标题前的 # 数量必须与 level 完全一致：\n%s\n实体摘要：%s\n实体详情：%s\n图谱上下文（最多%d度）：%s\n没有证据的章节请明确写“暂无可靠信息”，不要编造。", input.Category.Name, input.EntityName, input.Category.Description, input.Category.TargetEntityType, language, constraint, contract, input.EntitySummary, input.EntityDetails, input.Category.GraphDepth, graph), nil
	}
	return fmt.Sprintf("你是 Wiki 编辑器。请生成分类“%s”的 OKF Markdown 页面。\n业务场景：%s\n目标实体类型：%s\n写作风格：%s\n图谱穿透深度：%d\n创造力：%.2f\n自动生成实体锚点链接：%t\n语言：%s\n实体：%s（%s）\n摘要：%s\n详情：%s\n图谱上下文：%s\n只使用有证据的信息，输出 Markdown 正文，不要输出 YAML frontmatter。", input.Category.Name, input.Category.Description, input.Category.TargetEntityType, style, input.Category.GraphDepth, input.Category.Creativity, input.Category.AnchorLinksEnabled, language, input.EntityName, input.EntitySlug, input.EntitySummary, input.EntityDetails, graph), nil
}

func hasWikiCategorySectionDescriptions(sections []model.WikiCategoryTemplateSection) bool {
	for _, section := range sections {
		if strings.TrimSpace(section.Description) != "" {
			return true
		}
	}
	return false
}

func renderSectionContract(sections []model.WikiCategoryTemplateSection) string {
	var b strings.Builder
	for _, section := range sections {
		level := section.Level
		if level == 0 {
			level = 2
		}
		b.WriteString(strings.Repeat("#", level))
		b.WriteString(" ")
		b.WriteString(section.Title)
		b.WriteString("\n字段生成说明：")
		b.WriteString(section.Description)
		b.WriteString("\n")
	}
	return b.String()
}

func renderHeadingContract(names []string) string {
	var b strings.Builder
	for _, name := range names {
		b.WriteString("# ")
		b.WriteString(name)
		b.WriteString("\n")
	}
	return b.String()
}

// NormalizeWikiCategoryMarkdown enforces configured template heading levels while
// preserving the generated prose and any headings outside the template.
func NormalizeWikiCategoryMarkdown(body string, sections []model.WikiCategoryTemplateSection) (string, error) {
	wanted := make(map[string]int, len(sections))
	for _, section := range sections {
		level := section.Level
		if level == 0 {
			level = 2
		}
		if level < 1 || level > 6 || strings.TrimSpace(section.Title) == "" {
			return "", fmt.Errorf("invalid wiki category template section")
		}
		wanted[strings.TrimSpace(section.Title)] = level
	}
	seen := make(map[string]bool, len(wanted))
	lines := strings.Split(strings.ReplaceAll(body, "\r\n", "\n"), "\n")
	for i, line := range lines {
		matches := wikiMarkdownHeadingPattern.FindStringSubmatch(line)
		if len(matches) == 0 {
			continue
		}
		title := strings.TrimSpace(matches[3])
		level, ok := wanted[title]
		if !ok {
			continue
		}
		if seen[title] {
			return "", fmt.Errorf("duplicate generated wiki category heading %q", title)
		}
		seen[title] = true
		lines[i] = matches[1] + strings.Repeat("#", level) + " " + title
	}
	for title := range wanted {
		if !seen[title] {
			return "", fmt.Errorf("generated wiki category body is missing heading %q", title)
		}
	}
	return strings.TrimSpace(strings.Join(lines, "\n")), nil
}
