package service

import (
	"context"
	"fmt"
	"strings"
)

type WikiIndexIntroLLMRunner interface {
	Generate(ctx context.Context, prompt string) (string, error)
}

type WikiIndexIntroService struct {
	prompts *WikiPromptService
	llm     WikiIndexIntroLLMRunner
}

type WikiIndexIntroInput struct {
	Language          string
	DocumentSummaries []string
	ExistingIntro     string
	ChangeDescription string
}

func NewWikiIndexIntroService(prompts *WikiPromptService, llm WikiIndexIntroLLMRunner) *WikiIndexIntroService {
	if prompts == nil {
		prompts = NewWikiPromptService()
	}
	return &WikiIndexIntroService{
		prompts: prompts,
		llm:     llm,
	}
}

func (s *WikiIndexIntroService) GenerateIntro(ctx context.Context, input WikiIndexIntroInput) (string, error) {
	if s == nil || s.prompts == nil {
		return "", fmt.Errorf("wiki index intro service is nil")
	}
	if s.llm == nil {
		return "", fmt.Errorf("wiki llm runner is nil")
	}

	prompt, err := s.prompts.Render(WikiIndexIntroPrompt, map[string]any{
		"DocumentSummaries": renderWikiIndexDocumentSummaries(input.DocumentSummaries),
		"Language":          normalizeWikiIndexLanguage(input.Language),
	})
	if err != nil {
		return "", fmt.Errorf("render wiki index intro prompt: %w", err)
	}

	raw, err := s.llm.Generate(ctx, prompt)
	if err != nil {
		return "", fmt.Errorf("generate wiki index intro: %w", err)
	}
	return normalizeWikiIndexIntroOutput(raw), nil
}

func (s *WikiIndexIntroService) UpdateIntro(ctx context.Context, input WikiIndexIntroInput) (string, error) {
	if s == nil || s.prompts == nil {
		return "", fmt.Errorf("wiki index intro service is nil")
	}
	if s.llm == nil {
		return "", fmt.Errorf("wiki llm runner is nil")
	}

	prompt, err := s.prompts.Render(WikiIndexIntroUpdatePrompt, map[string]any{
		"ExistingIntro":     strings.TrimSpace(input.ExistingIntro),
		"ChangeDescription": strings.TrimSpace(input.ChangeDescription),
		"DocumentSummaries": renderWikiIndexDocumentSummaries(input.DocumentSummaries),
		"Language":          normalizeWikiIndexLanguage(input.Language),
	})
	if err != nil {
		return "", fmt.Errorf("render wiki index intro update prompt: %w", err)
	}

	raw, err := s.llm.Generate(ctx, prompt)
	if err != nil {
		return "", fmt.Errorf("update wiki index intro: %w", err)
	}
	return normalizeWikiIndexIntroOutput(raw), nil
}

func renderWikiIndexDocumentSummaries(summaries []string) string {
	if len(summaries) == 0 {
		return "(no documents yet)"
	}
	var builder strings.Builder
	for _, summary := range summaries {
		summary = strings.TrimSpace(summary)
		if summary == "" {
			continue
		}
		builder.WriteString("<document>\n")
		builder.WriteString(summary)
		builder.WriteString("\n</document>\n\n")
	}
	result := strings.TrimSpace(builder.String())
	if result == "" {
		return "(no documents yet)"
	}
	return result
}

func normalizeWikiIndexIntroOutput(raw string) string {
	intro := strings.TrimSpace(raw)
	if intro == "" {
		return "# Wiki Index\n\nThis wiki contains knowledge extracted from uploaded documents."
	}
	if idx := strings.Index(intro, "\n## "); idx >= 0 {
		intro = strings.TrimSpace(intro[:idx])
	}
	return intro
}

func normalizeWikiIndexLanguage(language string) string {
	language = strings.TrimSpace(language)
	if language == "" {
		return "中文"
	}
	return language
}
