package service

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/rag"
	"gorm.io/gorm"
)

type WikiLLMRunner interface {
	Generate(ctx context.Context, prompt string) (string, error)
}

type WikiIngestV2Service struct {
	db       *gorm.DB
	prompts  *WikiPromptService
	llm      WikiLLMRunner
	linkSvc  *WikiLinkService
	taxonomy *WikiTaxonomyService
	dedup    *WikiDedupService
	index    *WikiIndexIntroService
}

type WikiIngestV2MapDocumentInput struct {
	Eid                        int64
	LibraryID                  int64
	FileID                     int64
	Title                      string
	Content                    string
	Language                   string
	ExtractionGranularity      string
	EnableWikiKnowledgeGraph   bool
	EnableWikiDynamicKnowledge bool
}

type WikiIngestV2MapDocumentResult struct {
	SummaryLine     string
	SummaryBody     string
	CandidateSlugs  []string
	CitationResults []WikiIngestV2CitationResult
}

type WikiIngestV2CitationResult struct {
	Slug         string
	PageType     string
	Title        string
	SourceChunks []string
}

type wikiIngestV2Candidate struct {
	PageType     string
	Name         string
	Slug         string
	Aliases      []string
	Description  string
	Details      string
	SourceChunks []string
}

type wikiIngestV2SyntheticChunk struct {
	ID      string
	Content string
}

const wikiIngestV2AnalysisContentLimit = 16000

func NewWikiIngestV2Service(db *gorm.DB, llm WikiLLMRunner) *WikiIngestV2Service {
	prompts := NewWikiPromptService()
	return &WikiIngestV2Service{
		db:       db,
		prompts:  prompts,
		llm:      llm,
		taxonomy: NewWikiTaxonomyService(db, llm),
		dedup:    NewWikiDedupService(prompts, llm),
		index:    NewWikiIndexIntroService(prompts, llm),
	}
}

func (s *WikiIngestV2Service) mapDocument(ctx context.Context, in WikiIngestV2MapDocumentInput) (*WikiIngestV2MapDocumentResult, []WikiSlugUpdate, error) {
	in.EnableWikiDynamicKnowledge = in.EnableWikiKnowledgeGraph && in.EnableWikiDynamicKnowledge
	content := strings.TrimSpace(in.Content)
	if content == "" {
		return nil, nil, nil
	}
	if s == nil {
		return nil, nil, fmt.Errorf("wiki ingest v2 service is nil")
	}
	if s.prompts == nil {
		s.prompts = NewWikiPromptService()
	}
	if s.llm == nil {
		return nil, nil, fmt.Errorf("wiki llm runner is nil")
	}

	analysisContent := rag.ComposeSummaryInput(content, wikiIngestV2AnalysisContentLimit)

	var candidates []wikiIngestV2Candidate

	// 知识图谱阶段：实体/概念提取 + 去重
	if in.EnableWikiKnowledgeGraph {
		previousSlugs, err := s.loadWikiCandidatePreviousSlugs(ctx, in.Eid, in.LibraryID)
		if err != nil {
			return nil, nil, err
		}

		candidates, err = s.extractCandidateSlugs(ctx, in, analysisContent, previousSlugs)
		if err != nil {
			logger.Warnf(ctx, "wiki ingest v2: candidate extraction failed, falling back to legacy knowledge extract: eid=%d library_id=%d file_id=%d err=%v",
				in.Eid, in.LibraryID, in.FileID, err)
			candidates, err = s.extractKnowledgeCandidates(ctx, in, analysisContent, previousSlugs)
			if err != nil {
				return nil, nil, err
			}
		}
		if len(candidates) == 0 {
			logger.Warnf(ctx, "wiki ingest v2: candidate extraction returned 0 items, falling back to legacy knowledge extract: eid=%d library_id=%d file_id=%d",
				in.Eid, in.LibraryID, in.FileID)
			candidates, err = s.extractKnowledgeCandidates(ctx, in, analysisContent, previousSlugs)
			if err != nil {
				return nil, nil, err
			}
		}
		candidates, err = s.deduplicateWikiCandidates(ctx, in, candidates)
		if err != nil {
			return nil, nil, err
		}
	}

	var summaryLine, summaryBody string
	var citations map[string][]string
	var discovered []wikiIngestV2Candidate
	var chunks map[string]wikiIngestV2SyntheticChunk

	// 动态知识阶段：摘要生成 + 块分类引用
	if in.EnableWikiDynamicKnowledge {
		var err error
		summaryLine, summaryBody, err = s.generateSummaryPage(ctx, in, analysisContent, candidates)
		if err != nil {
			return nil, nil, err
		}

		citations, discovered, chunks, err = s.classifyChunkCitations(ctx, in, analysisContent, candidates)
		if err != nil {
			return nil, nil, err
		}
	}

	var updates []WikiSlugUpdate
	if in.EnableWikiKnowledgeGraph || in.EnableWikiDynamicKnowledge {
		updates = buildWikiIngestV2SlugUpdates(in, candidates, citations, discovered, chunks, summaryLine, summaryBody)
	}
	result := &WikiIngestV2MapDocumentResult{
		SummaryLine:     summaryLine,
		SummaryBody:     summaryBody,
		CandidateSlugs:  extractWikiCandidateSlugs(candidates),
		CitationResults: buildWikiCitationResults(candidates, citations),
	}

	return result, updates, nil
}

func (s *WikiIngestV2Service) deduplicateWikiCandidates(ctx context.Context, in WikiIngestV2MapDocumentInput, candidates []wikiIngestV2Candidate) ([]wikiIngestV2Candidate, error) {
	if s == nil || s.dedup == nil || len(candidates) == 0 {
		return candidates, nil
	}

	newItems := make([]WikiDedupItem, 0, len(candidates))
	for _, candidate := range candidates {
		slug := strings.TrimSpace(candidate.Slug)
		if slug == "" {
			continue
		}
		newItems = append(newItems, WikiDedupItem{
			Slug:    slug,
			Type:    candidate.PageType,
			Name:    candidate.Name,
			Aliases: append([]string(nil), candidate.Aliases...),
		})
	}
	if len(newItems) == 0 {
		return candidates, nil
	}

	existingPages, err := s.loadWikiDedupExistingPages(ctx, in.Eid, in.LibraryID)
	if err != nil {
		return nil, err
	}
	merges, err := s.dedup.PlanDedup(ctx, WikiDedupInput{
		NewItems:      newItems,
		ExistingPages: existingPages,
	})
	if err != nil {
		return nil, err
	}
	if len(merges) == 0 {
		return candidates, nil
	}

	mergedBySlug := make(map[string]wikiIngestV2Candidate, len(candidates))
	for _, candidate := range candidates {
		finalSlug := strings.TrimSpace(candidate.Slug)
		if replacement, ok := merges[finalSlug]; ok && strings.TrimSpace(replacement) != "" {
			finalSlug = strings.TrimSpace(replacement)
		}
		if finalSlug == "" {
			continue
		}
		candidate.Slug = finalSlug
		if existing, ok := mergedBySlug[finalSlug]; ok {
			mergedBySlug[finalSlug] = mergeWikiIngestV2Candidate(existing, candidate)
			continue
		}
		mergedBySlug[finalSlug] = candidate
	}
	if len(mergedBySlug) == 0 {
		return candidates, nil
	}

	slugs := make([]string, 0, len(mergedBySlug))
	for slug := range mergedBySlug {
		slugs = append(slugs, slug)
	}
	sort.Strings(slugs)

	merged := make([]wikiIngestV2Candidate, 0, len(slugs))
	for _, slug := range slugs {
		merged = append(merged, mergedBySlug[slug])
	}
	return merged, nil
}

func (s *WikiIngestV2Service) loadWikiDedupExistingPages(ctx context.Context, eid, libraryID int64) ([]WikiDedupPage, error) {
	if s == nil || s.db == nil {
		return nil, nil
	}
	var pages []model.WikiPage
	if err := s.db.WithContext(ctx).
		Model(&model.WikiPage{}).
		Select("slug", "title", "page_type", "aliases").
		Where("eid = ? AND library_id = ? AND status = ? AND page_type IN ?", eid, libraryID, model.WikiPageStatusActive, []string{model.WikiPageTypeEntity, model.WikiPageTypeConcept}).
		Order("page_type ASC, sort ASC, id ASC").
		Find(&pages).Error; err != nil {
		return nil, fmt.Errorf("load wiki dedup pages: %w", err)
	}

	existing := make([]WikiDedupPage, 0, len(pages))
	for _, page := range pages {
		if strings.TrimSpace(page.Slug) == "" || strings.TrimSpace(page.Title) == "" {
			continue
		}
		existing = append(existing, WikiDedupPage{
			Slug:    page.Slug,
			Type:    page.PageType,
			Title:   page.Title,
			Aliases: append([]string(nil), page.Aliases...),
		})
	}
	return existing, nil
}

func (s *WikiIngestV2Service) extractCandidateSlugs(ctx context.Context, in WikiIngestV2MapDocumentInput, content string, previousSlugs string) ([]wikiIngestV2Candidate, error) {
	prompt, err := s.prompts.Render(WikiCandidateSlugPrompt, map[string]any{
		"Content":             content,
		"SourceContext":       renderWikiIngestV2SourceContext("candidate_discovery", in, 0),
		"Language":            wikiIngestV2Language(in.Language),
		"PreviousSlugs":       previousSlugs,
		"Granularity":         wikiIngestV2ExtractionGranularity(in.ExtractionGranularity),
		"GranularityGuidance": wikiIngestV2GranularityGuidance(in.ExtractionGranularity),
	})
	if err != nil {
		return nil, fmt.Errorf("render candidate slug prompt: %w", err)
	}

	raw, err := s.llm.Generate(ctx, prompt)
	if err != nil {
		return nil, fmt.Errorf("candidate slug extraction failed: %w", err)
	}

	var batch WikiCandidateSlugBatch
	if err := decodeWikiLLMJSON(raw, &batch); err != nil {
		return nil, fmt.Errorf("parse candidate slug JSON: %w", err)
	}

	return flattenWikiCandidateBatch(batch), nil
}

func (s *WikiIngestV2Service) extractKnowledgeCandidates(ctx context.Context, in WikiIngestV2MapDocumentInput, content string, previousSlugs string) ([]wikiIngestV2Candidate, error) {
	prompt, err := s.prompts.Render(WikiKnowledgeExtractPrompt, map[string]any{
		"Content":       content,
		"PreviousSlugs": previousSlugs,
		"Language":      wikiIngestV2Language(in.Language),
	})
	if err != nil {
		return nil, fmt.Errorf("render knowledge extract prompt: %w", err)
	}

	raw, err := s.llm.Generate(ctx, prompt)
	if err != nil {
		return nil, fmt.Errorf("knowledge extract failed: %w", err)
	}

	var batch WikiCandidateSlugBatch
	if err := decodeWikiLLMJSON(raw, &batch); err != nil {
		return nil, fmt.Errorf("parse knowledge extract JSON: %w", err)
	}

	return flattenWikiCandidateBatch(batch), nil
}

func (s *WikiIngestV2Service) loadWikiCandidatePreviousSlugs(ctx context.Context, eid, libraryID int64) (string, error) {
	if s == nil || s.db == nil {
		return "(none — this is a new document)", nil
	}
	var pages []model.WikiPage
	if err := s.db.WithContext(ctx).
		Model(&model.WikiPage{}).
		Select("slug").
		Where("eid = ? AND library_id = ? AND status = ? AND page_type IN ?", eid, libraryID, model.WikiPageStatusActive, []string{model.WikiPageTypeEntity, model.WikiPageTypeConcept}).
		Order("page_type ASC, sort ASC, id ASC").
		Find(&pages).Error; err != nil {
		return "", fmt.Errorf("load wiki previous slugs: %w", err)
	}
	if len(pages) == 0 {
		return "(none — this is a new document)", nil
	}

	var builder strings.Builder
	for _, page := range pages {
		slug := strings.TrimSpace(page.Slug)
		if slug == "" {
			continue
		}
		builder.WriteString("- ")
		builder.WriteString(slug)
		builder.WriteString("\n")
	}
	result := strings.TrimSpace(builder.String())
	if result == "" {
		return "(none — this is a new document)", nil
	}
	return result, nil
}

func (s *WikiIngestV2Service) generateSummaryPage(ctx context.Context, in WikiIngestV2MapDocumentInput, content string, candidates []wikiIngestV2Candidate) (string, string, error) {
	prompt, err := s.prompts.Render(WikiSummaryPrompt, map[string]any{
		"Content":        content,
		"SourceContext":  renderWikiIngestV2SourceContext("document_digest", in, len(candidates)),
		"Language":       wikiIngestV2Language(in.Language),
		"ExtractedSlugs": renderWikiSummarySlugListing(candidates),
	})
	if err != nil {
		return "", "", fmt.Errorf("render wiki summary prompt: %w", err)
	}

	raw, err := s.llm.Generate(ctx, prompt)
	if err != nil {
		return "", "", fmt.Errorf("generate summary page: %w", err)
	}

	summaryLine, summaryBody := splitSummaryLine(raw)
	if summaryBody == "" {
		summaryBody = strings.TrimSpace(raw)
	}
	if summaryLine == "" {
		summaryLine = strings.TrimSpace(in.Title)
	}
	return summaryLine, summaryBody, nil
}

func buildWikiIngestV2SlugUpdates(
	in WikiIngestV2MapDocumentInput,
	candidates []wikiIngestV2Candidate,
	citations map[string][]string,
	discovered []wikiIngestV2Candidate,
	chunks map[string]wikiIngestV2SyntheticChunk,
	summaryLine string,
	summaryBody string,
) []WikiSlugUpdate {
	updates := make([]WikiSlugUpdate, 0, 1+len(candidates)+len(discovered))
	if in.EnableWikiDynamicKnowledge {
		updates = append(updates, WikiSlugUpdate{
			Slug:         wikiSummarySlug(in.FileID),
			PageType:     model.WikiPageTypeSummary,
			Title:        firstNonEmpty(strings.TrimSpace(in.Title), fmt.Sprintf("Document %d Summary", in.FileID)),
			Summary:      summaryLine,
			Content:      summaryBody,
			SummaryLine:  summaryLine,
			SummaryBody:  summaryBody,
			DocTitle:     strings.TrimSpace(in.Title),
			DocSummary:   summaryBody,
			Eid:          in.Eid,
			LibraryID:    in.LibraryID,
			SourceFileID: in.FileID,
		})
	}

	candidateBySlug := make(map[string]wikiIngestV2Candidate, len(candidates)+len(discovered))
	for _, candidate := range candidates {
		candidateBySlug[candidate.Slug] = candidate
	}
	for _, candidate := range discovered {
		if existing, ok := candidateBySlug[candidate.Slug]; ok {
			candidateBySlug[candidate.Slug] = mergeWikiIngestV2Candidate(existing, candidate)
			continue
		}
		candidateBySlug[candidate.Slug] = candidate
	}

	slugs := make([]string, 0, len(candidateBySlug))
	for slug := range candidateBySlug {
		slugs = append(slugs, slug)
	}
	sort.Strings(slugs)

	for _, slug := range slugs {
		candidate := candidateBySlug[slug]
		sourceChunks := dedupeWikiChunkRefs(append(append([]string(nil), citations[slug]...), candidate.SourceChunks...))
		content := buildWikiSourceContent(sourceChunks, chunks)
		if content == "" {
			content = strings.TrimSpace(candidate.Details)
		}

		updates = append(updates, WikiSlugUpdate{
			Slug:         slug,
			PageType:     candidate.PageType,
			Title:        candidate.Name,
			Aliases:      append([]string(nil), candidate.Aliases...),
			Summary:      candidate.Description,
			Content:      content,
			DocTitle:     strings.TrimSpace(in.Title),
			DocSummary:   summaryBody,
			Eid:          in.Eid,
			LibraryID:    in.LibraryID,
			SourceFileID: in.FileID,
			SourceChunks: sourceChunks,
		})
	}

	return updates
}

func buildWikiCitationResults(candidates []wikiIngestV2Candidate, citations map[string][]string) []WikiIngestV2CitationResult {
	if len(citations) == 0 {
		return nil
	}

	candidateBySlug := make(map[string]wikiIngestV2Candidate, len(candidates))
	for _, candidate := range candidates {
		candidateBySlug[candidate.Slug] = candidate
	}

	slugs := make([]string, 0, len(citations))
	for slug := range citations {
		slugs = append(slugs, slug)
	}
	sort.Strings(slugs)

	results := make([]WikiIngestV2CitationResult, 0, len(slugs))
	for _, slug := range slugs {
		candidate, ok := candidateBySlug[slug]
		if !ok {
			continue
		}
		results = append(results, WikiIngestV2CitationResult{
			Slug:         slug,
			PageType:     candidate.PageType,
			Title:        candidate.Name,
			SourceChunks: dedupeWikiChunkRefs(citations[slug]),
		})
	}
	return results
}

func renderWikiSummarySlugListing(candidates []wikiIngestV2Candidate) string {
	if len(candidates) == 0 {
		return "(none)"
	}

	var builder strings.Builder
	for _, candidate := range candidates {
		if candidate.Slug == "" {
			continue
		}
		builder.WriteString("- [[")
		builder.WriteString(candidate.Slug)
		builder.WriteString("]] = ")
		builder.WriteString(candidate.Name)
		if len(candidate.Aliases) > 0 {
			builder.WriteString(" (Aliases: ")
			builder.WriteString(strings.Join(candidate.Aliases, ", "))
			builder.WriteString(")")
		}
		if strings.TrimSpace(candidate.Description) != "" {
			builder.WriteString(" — ")
			builder.WriteString(strings.TrimSpace(candidate.Description))
		}
		builder.WriteString("\n")
	}
	return strings.TrimRight(builder.String(), "\n")
}

func renderWikiIngestV2SourceContext(pageStyle string, in WikiIngestV2MapDocumentInput, candidateCount int) string {
	// Keep early-stage source context narrow: these prompts only need
	// document-level framing for extraction and summary generation.
	fields := make([]string, 0, 5)
	fields = append(fields, fmt.Sprintf("page_style: %s", pageStyle))
	fields = append(fields, "evidence_mode: stitched_windows")
	if title := strings.TrimSpace(in.Title); title != "" {
		fields = append(fields, fmt.Sprintf("document_title: %s", title))
	}
	if language := wikiIngestV2Language(in.Language); language != "" {
		fields = append(fields, fmt.Sprintf("document_language: %s", language))
	}
	if candidateCount > 0 {
		fields = append(fields, fmt.Sprintf("candidate_count: %d", candidateCount))
	}
	return strings.Join(fields, "\n")
}

func flattenWikiCandidateBatch(batch WikiCandidateSlugBatch) []wikiIngestV2Candidate {
	candidates := make([]wikiIngestV2Candidate, 0, len(batch.Entities)+len(batch.Concepts))
	for _, entity := range batch.Entities {
		if entity.Slug == "" || entity.Name == "" {
			continue
		}
		candidates = append(candidates, wikiIngestV2Candidate{
			PageType:     model.WikiPageTypeEntity,
			Name:         entity.Name,
			Slug:         entity.Slug,
			Aliases:      append([]string(nil), entity.Aliases...),
			Description:  entity.Description,
			Details:      entity.Details,
			SourceChunks: nil,
		})
	}
	for _, concept := range batch.Concepts {
		if concept.Slug == "" || concept.Name == "" {
			continue
		}
		candidates = append(candidates, wikiIngestV2Candidate{
			PageType:     model.WikiPageTypeConcept,
			Name:         concept.Name,
			Slug:         concept.Slug,
			Aliases:      append([]string(nil), concept.Aliases...),
			Description:  concept.Description,
			Details:      concept.Details,
			SourceChunks: nil,
		})
	}
	return candidates
}

func extractWikiCandidateSlugs(candidates []wikiIngestV2Candidate) []string {
	slugs := make([]string, 0, len(candidates))
	for _, candidate := range candidates {
		if candidate.Slug == "" {
			continue
		}
		slugs = append(slugs, candidate.Slug)
	}
	sort.Strings(slugs)
	return slugs
}

func wikiIngestV2GranularityGuidance(granularity string) string {
	return WikiGranularityGuidance(granularity)
}

func wikiIngestV2ExtractionGranularity(granularity string) string {
	granularity = strings.TrimSpace(strings.ToLower(granularity))
	if granularity == "" {
		return "standard"
	}
	return granularity
}

func wikiIngestV2Language(language string) string {
	language = strings.TrimSpace(language)
	if language == "" {
		return "中文"
	}
	return language
}

func wikiSummarySlug(fileID int64) string {
	return fmt.Sprintf("summary/file-%d", fileID)
}

func buildWikiSourceContent(sourceChunks []string, chunks map[string]wikiIngestV2SyntheticChunk) string {
	if len(sourceChunks) == 0 {
		return ""
	}
	parts := make([]string, 0, len(sourceChunks))
	for _, chunkID := range sourceChunks {
		chunk, ok := chunks[chunkID]
		if !ok {
			continue
		}
		content := strings.TrimSpace(chunk.Content)
		if content == "" {
			continue
		}
		parts = append(parts, content)
	}
	return strings.Join(parts, "\n\n")
}

func dedupeWikiChunkRefs(chunkIDs []string) []string {
	if len(chunkIDs) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(chunkIDs))
	out := make([]string, 0, len(chunkIDs))
	for _, chunkID := range chunkIDs {
		chunkID = strings.TrimSpace(chunkID)
		if chunkID == "" {
			continue
		}
		if _, ok := seen[chunkID]; ok {
			continue
		}
		seen[chunkID] = struct{}{}
		out = append(out, chunkID)
	}
	sort.Strings(out)
	return out
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func firstNonZeroInt64(values ...int64) int64 {
	for _, value := range values {
		if value != 0 {
			return value
		}
	}
	return 0
}

func mergeWikiIngestV2Candidate(primary wikiIngestV2Candidate, discovered wikiIngestV2Candidate) wikiIngestV2Candidate {
	merged := primary
	if strings.TrimSpace(merged.PageType) == "" {
		merged.PageType = discovered.PageType
	}
	if strings.TrimSpace(merged.Name) == "" {
		merged.Name = discovered.Name
	}
	if strings.TrimSpace(merged.Description) == "" {
		merged.Description = discovered.Description
	}
	if strings.TrimSpace(merged.Details) == "" {
		merged.Details = discovered.Details
	}
	merged.Aliases = mergeWikiStringSlices(primary.Aliases, discovered.Aliases)
	merged.SourceChunks = dedupeWikiChunkRefs(append(append([]string(nil), primary.SourceChunks...), discovered.SourceChunks...))
	return merged
}

func mergeWikiStringSlices(left []string, right []string) []string {
	if len(left) == 0 && len(right) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(left)+len(right))
	merged := make([]string, 0, len(left)+len(right))
	for _, value := range append(append([]string(nil), left...), right...) {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		merged = append(merged, value)
	}
	return merged
}
