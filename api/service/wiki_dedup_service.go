package service

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

type WikiDedupLLMRunner interface {
	Generate(ctx context.Context, prompt string) (string, error)
}

type WikiDedupService struct {
	prompts *WikiPromptService
	llm     WikiDedupLLMRunner
}

type WikiDedupItem struct {
	Slug    string
	Type    string
	Name    string
	Aliases []string
}

type WikiDedupPage struct {
	Slug    string
	Type    string
	Title   string
	Aliases []string
}

type WikiDedupInput struct {
	NewItems      []WikiDedupItem
	ExistingPages []WikiDedupPage
}

func NewWikiDedupService(prompts *WikiPromptService, llm WikiDedupLLMRunner) *WikiDedupService {
	if prompts == nil {
		prompts = NewWikiPromptService()
	}
	return &WikiDedupService{
		prompts: prompts,
		llm:     llm,
	}
}

func (s *WikiDedupService) PlanDedup(ctx context.Context, input WikiDedupInput) (map[string]string, error) {
	if s == nil || s.prompts == nil {
		return nil, fmt.Errorf("wiki dedup service is nil")
	}
	if s.llm == nil {
		return nil, fmt.Errorf("wiki llm runner is nil")
	}
	if len(input.NewItems) == 0 || len(input.ExistingPages) == 0 {
		return map[string]string{}, nil
	}

	prompt, err := s.prompts.Render(WikiDeduplicationPrompt, map[string]any{
		"NewItems":      renderWikiDedupItemsXML(input.NewItems),
		"ExistingPages": renderWikiDedupPagesXML(input.ExistingPages),
	})
	if err != nil {
		return nil, fmt.Errorf("render wiki dedup prompt: %w", err)
	}

	raw, err := s.llm.Generate(ctx, prompt)
	if err != nil {
		return nil, fmt.Errorf("generate wiki dedup plan: %w", err)
	}

	var parsed struct {
		Merges map[string]string `json:"merges"`
	}
	if err := json.Unmarshal([]byte(cleanLLMJSON(raw)), &parsed); err != nil {
		return nil, fmt.Errorf("parse wiki dedup JSON: %w", err)
	}
	if len(parsed.Merges) == 0 {
		return map[string]string{}, nil
	}

	newBySlug := make(map[string]WikiDedupItem, len(input.NewItems))
	for _, item := range input.NewItems {
		slug := strings.TrimSpace(item.Slug)
		if slug == "" {
			continue
		}
		if _, ok := newBySlug[slug]; !ok {
			newBySlug[slug] = item
		}
	}
	existingBySlug := make(map[string]WikiDedupPage, len(input.ExistingPages))
	for _, page := range input.ExistingPages {
		slug := strings.TrimSpace(page.Slug)
		if slug == "" {
			continue
		}
		if _, ok := existingBySlug[slug]; !ok {
			existingBySlug[slug] = page
		}
	}

	merges := make(map[string]string, len(parsed.Merges))
	for srcSlug, dstSlug := range parsed.Merges {
		srcSlug = strings.TrimSpace(srcSlug)
		dstSlug = strings.TrimSpace(dstSlug)
		if srcSlug == "" || dstSlug == "" {
			continue
		}
		srcItem, ok := newBySlug[srcSlug]
		if !ok {
			continue
		}
		dstPage, ok := existingBySlug[dstSlug]
		if !ok {
			continue
		}
		if !wikiDedupTypesCompatible(srcItem.Type, dstPage.Type) {
			continue
		}
		merges[srcSlug] = dstSlug
	}

	return merges, nil
}

func renderWikiDedupItemsXML(items []WikiDedupItem) string {
	if len(items) == 0 {
		return "(none)"
	}
	var builder strings.Builder
	for _, item := range items {
		if strings.TrimSpace(item.Slug) == "" || strings.TrimSpace(item.Name) == "" {
			continue
		}
		writeWikiDedupItemXML(&builder, item.Slug, item.Name, item.Type, item.Aliases)
	}
	result := strings.TrimSpace(builder.String())
	if result == "" {
		return "(none)"
	}
	return result
}

func renderWikiDedupPagesXML(pages []WikiDedupPage) string {
	if len(pages) == 0 {
		return "(none)"
	}
	var builder strings.Builder
	for _, page := range pages {
		if strings.TrimSpace(page.Slug) == "" || strings.TrimSpace(page.Title) == "" {
			continue
		}
		writeWikiDedupItemXML(&builder, page.Slug, page.Title, page.Type, page.Aliases)
	}
	result := strings.TrimSpace(builder.String())
	if result == "" {
		return "(none)"
	}
	return result
}

func writeWikiDedupItemXML(builder *strings.Builder, slug, name, itemType string, aliases []string) {
	if builder == nil {
		return
	}
	builder.WriteString("<item>\n")
	builder.WriteString(fmt.Sprintf("<slug>%s</slug>\n", strings.TrimSpace(slug)))
	builder.WriteString(fmt.Sprintf("<type>%s</type>\n", strings.TrimSpace(itemType)))
	builder.WriteString(fmt.Sprintf("<name>%s</name>\n", strings.TrimSpace(name)))
	if len(aliases) > 0 {
		builder.WriteString(fmt.Sprintf("<aliases>%s</aliases>\n", strings.Join(normalizeWikiStringSlice(aliases), ", ")))
	}
	builder.WriteString("</item>\n\n")
}

func wikiDedupTypesCompatible(left, right string) bool {
	left = strings.TrimSpace(left)
	right = strings.TrimSpace(right)
	if left == "" || right == "" {
		return false
	}
	return left == right
}

func normalizeWikiStringSlice(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(values))
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	sort.Strings(out)
	return out
}
