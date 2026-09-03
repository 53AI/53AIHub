package service

import (
	"errors"
	"fmt"
	"strings"

	"github.com/53AI/53AIHub/model"
)

type WikiCategoryHeading struct {
	Title string
	Level int
	Line  int
}

func WikiCategoryTemplateSections(category model.WikiCategory) ([]model.WikiCategoryTemplateSection, error) {
	if len(category.TemplateSections) > 0 {
		sections := append([]model.WikiCategoryTemplateSection(nil), category.TemplateSections...)
		seen := make(map[string]struct{}, len(sections))
		for i := range sections {
			sections[i].Title = strings.TrimSpace(sections[i].Title)
			sections[i].Description = strings.TrimSpace(sections[i].Description)
			if sections[i].Title == "" {
				return nil, fmt.Errorf("template section %d requires title", i+1)
			}
			if _, ok := seen[sections[i].Title]; ok {
				return nil, fmt.Errorf("duplicate template section: %s", sections[i].Title)
			}
			if sections[i].Level == 0 {
				sections[i].Level = 2
			}
			if sections[i].Level < 1 || sections[i].Level > 6 {
				return nil, fmt.Errorf("template section %s level must be between 1 and 6", sections[i].Title)
			}
			seen[sections[i].Title] = struct{}{}
		}
		return sections, nil
	}
	headings, err := ParseWikiCategoryHeadings(category.TemplateMarkdown)
	if err != nil {
		return nil, err
	}
	sections := make([]model.WikiCategoryTemplateSection, 0, len(headings))
	for _, heading := range headings {
		sections = append(sections, model.WikiCategoryTemplateSection{Title: heading.Title, Level: heading.Level})
	}
	return sections, nil
}

func ParseWikiCategoryHeadings(markdown string) ([]WikiCategoryHeading, error) {
	lines := strings.Split(strings.ReplaceAll(markdown, "\r\n", "\n"), "\n")
	headings := make([]WikiCategoryHeading, 0)
	seen := map[string]struct{}{}
	inFence := false
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "```") {
			inFence = !inFence
			continue
		}
		if inFence {
			continue
		}
		// 模板通常来自 Markdown 编辑器，兼容行首缩进和 # 后缺少空格的常见写法；
		// 仍然只接受一级标题，避免把 ## 子标题误识别为模板字段。
		if !strings.HasPrefix(trimmed, "#") || strings.HasPrefix(trimmed, "##") {
			continue
		}
		title := strings.TrimSpace(strings.TrimPrefix(trimmed, "#"))
		if title == "" {
			return nil, fmt.Errorf("empty heading at line %d", i+1)
		}
		if _, ok := seen[title]; ok {
			return nil, fmt.Errorf("duplicate heading: %s", title)
		}
		seen[title] = struct{}{}
		headings = append(headings, WikiCategoryHeading{Title: title, Level: 1, Line: i + 1})
	}
	return headings, nil
}

func ValidateWikiCategoryTemplate(category *model.WikiCategory) error {
	if err := model.ValidateWikiCategory(category); err != nil {
		return err
	}
	if category.GrowthMode != model.WikiCategoryGrowthModeFixed {
		return nil
	}
	if strings.TrimSpace(category.TemplateMarkdown) == "" && len(category.TemplateSections) == 0 {
		return errors.New("fixed growth mode requires template markdown")
	}
	sections, err := WikiCategoryTemplateSections(*category)
	if err != nil {
		return err
	}
	if len(sections) == 0 {
		return errors.New("template requires at least one section")
	}
	return nil
}
