package service

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"unicode"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/tokenlimit"
	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

type WikiLLMRunner interface {
	Generate(ctx context.Context, prompt string) (string, error)
}

type wikiPromptInputBudgeter interface {
	InputBudget(ctx context.Context, promptOverhead string) (int, error)
}

type WikiIngestV2Service struct {
	db                     *gorm.DB
	prompts                *WikiPromptService
	llm                    WikiLLMRunner
	fileGuard              wikiFileGenerationGuard
	checkpoint             *wikiGenerationCheckpoint
	checkpointJobID        int64
	linkSvc                *WikiLinkService
	taxonomy               *WikiTaxonomyService
	dedup                  *WikiDedupService
	index                  *WikiIndexIntroService
	pageUpdateBatchAcquire wikiPageUpdateBatchAcquire
	identitySemanticSearch func(context.Context, *gorm.DB, int64, int64, WikiDedupItem) ([]int64, error)
	identityESearch        func(context.Context, int64, int64, WikiDedupItem) ([]int64, error)
}

type WikiIngestV2MapDocumentInput struct {
	Eid                        int64
	LibraryID                  int64
	FileID                     int64
	JobID                      int64
	Title                      string
	Content                    string
	Language                   string
	ExtractionGranularity      string
	EnableWikiKnowledgeGraph   bool
	EnableWikiDynamicKnowledge bool
	WikiGenerationMode         string
	strictCategoryScope        string
	strictCategoryTypes        map[string]struct{}
}

type WikiIngestV2MapDocumentResult struct {
	SummaryLine     string
	SummaryBody     string
	CandidateSlugs  []string
	CitationResults []WikiIngestV2CitationResult
	candidates      []wikiIngestV2Candidate
}

type WikiIngestV2CitationResult struct {
	Slug         string
	PageType     string
	Title        string
	SourceChunks []string
}

type wikiIngestV2Candidate struct {
	PageType     string
	EntityType   string
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

func NewWikiIngestV2Service(db *gorm.DB, llm WikiLLMRunner) *WikiIngestV2Service {
	prompts := NewWikiPromptService()
	return &WikiIngestV2Service{
		db:                     db,
		prompts:                prompts,
		llm:                    llm,
		taxonomy:               NewWikiTaxonomyService(db, llm),
		dedup:                  NewWikiDedupService(prompts, llm),
		index:                  NewWikiIndexIntroService(prompts, llm),
		pageUpdateBatchAcquire: acquireWikiPageUpdateBatchLease,
		identitySemanticSearch: searchWikiIdentitySemantic,
		identityESearch:        searchWikiIdentityES,
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

	analysisContent := content

	var candidates []wikiIngestV2Candidate

	// 知识图谱阶段：实体/概念提取 + 去重
	if in.EnableWikiKnowledgeGraph && !(model.NormalizeWikiGenerationMode(in.WikiGenerationMode) == model.WikiGenerationModeStrict && strings.TrimSpace(in.strictCategoryScope) == "") {
		// 候选提取只识别当前文档；已有词条由后续增量消歧检索提供。
		previousSlugs := "(none)"

		candidatePrompt, err := s.prompts.Render(WikiCandidateSlugPrompt, map[string]any{
			"Content":             "",
			"SourceContext":       renderWikiIngestV2SourceContext("candidate_discovery", in, 0),
			"Language":            wikiIngestV2Language(in.Language),
			"PreviousSlugs":       previousSlugs,
			"Granularity":         wikiIngestV2ExtractionGranularity(in.ExtractionGranularity),
			"GranularityGuidance": wikiIngestV2GranularityGuidance(in.ExtractionGranularity),
			"StrictCategoryScope": in.strictCategoryScope,
		})
		if err != nil {
			return nil, nil, fmt.Errorf("render candidate slug budget prompt: %w", err)
		}
		candidateBudget, err := s.wikiPromptInputBudget(ctx, candidatePrompt)
		if err != nil {
			return nil, nil, err
		}
		candidateBatches := splitWikiDocumentContentByTokenBudget(content, candidateBudget)
		if len(candidateBatches) == 0 {
			return nil, nil, fmt.Errorf("wiki candidate input budget is not positive")
		}

		fallbackAttempted := false
		for _, batch := range candidateBatches {
			batchCandidates, extractErr := s.extractCandidateSlugs(ctx, in, batch, previousSlugs)
			if extractErr != nil {
				err = extractErr
				break
			}
			candidates = mergeWikiIngestV2Candidates(candidates, batchCandidates)
		}
		if err != nil {
			logger.Warnf(ctx, "【Wiki生成】 phase=candidate_extract 候选提取失败，回退到 legacy 知识提取: eid=%d library_id=%d file_id=%d err=%v",
				in.Eid, in.LibraryID, in.FileID, err)
			fallbackAttempted = true
			fallbackCandidates, fallbackErr := s.extractKnowledgeCandidatesFromBatches(ctx, in, candidateBatches, previousSlugs)
			if fallbackErr != nil {
				logger.Errorf(ctx, "【Wiki生成】 主候选与 legacy 候选均解析失败，降级为仅生成摘要: eid=%d library_id=%d file_id=%d err=%v",
					in.Eid, in.LibraryID, in.FileID, fallbackErr)
				candidates = nil
			} else {
				candidates = fallbackCandidates
			}
			err = nil
		}
		if len(candidates) == 0 && !fallbackAttempted {
			logger.Warnf(ctx, "【Wiki生成】 主候选提取为空，启用 legacy fallback: eid=%d library_id=%d file_id=%d",
				in.Eid, in.LibraryID, in.FileID)
			fallbackCandidates, fallbackErr := s.extractKnowledgeCandidatesFromBatches(ctx, in, candidateBatches, previousSlugs)
			if fallbackErr != nil {
				logger.Errorf(ctx, "【Wiki生成】 y fallback 解析失败，降级为仅生成摘要: eid=%d library_id=%d file_id=%d err=%v",
					in.Eid, in.LibraryID, in.FileID, fallbackErr)
				candidates = nil
			} else {
				candidates = fallbackCandidates
			}
			if len(candidates) == 0 {
				logger.Errorf(ctx, "【Wiki生成】 主候选提取与 legacy fallback 均为空，仅继续生成文档简介: eid=%d library_id=%d file_id=%d",
					in.Eid, in.LibraryID, in.FileID)
			} else {
				logger.Infof(ctx, "【Wiki生成】 y fallback 完成 candidates=%d: eid=%d library_id=%d file_id=%d",
					len(candidates), in.Eid, in.LibraryID, in.FileID)
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
		chunks = splitWikiIngestContentIntoChunks(analysisContent, wikiIngestV2CitationChunkLimit)
		type summaryResult struct {
			line string
			body string
			err  error
		}
		summaryCh := make(chan summaryResult, 1)
		citationCh := make(chan struct {
			citations  map[string][]string
			discovered []wikiIngestV2Candidate
			chunks     map[string]wikiIngestV2SyntheticChunk
			err        error
		}, 1)
		go func() {
			line, body, err := s.generateSummaryPage(ctx, in, analysisContent, candidates)
			summaryCh <- summaryResult{line: line, body: body, err: err}
		}()
		go func() {
			citationMap, discoveredSlugs, citationChunks, err := s.classifyChunkCitations(ctx, in, analysisContent, candidates)
			citationCh <- struct {
				citations  map[string][]string
				discovered []wikiIngestV2Candidate
				chunks     map[string]wikiIngestV2SyntheticChunk
				err        error
			}{citationMap, discoveredSlugs, citationChunks, err}
		}()
		summary := <-summaryCh
		if summary.err != nil {
			logger.Errorf(ctx, "【Wiki生成】 文档摘要生成失败，继续生成实体页面: file_id=%d err=%v", in.FileID, summary.err)
		} else {
			summaryLine, summaryBody = summary.line, summary.body
		}
		citation := <-citationCh
		if citation.err != nil {
			logger.Errorf(ctx, "【Wiki生成】 引用识别失败，继续生成页面: file_id=%d err=%v", in.FileID, citation.err)
		} else {
			citations, discovered = citation.citations, citation.discovered
			attachWikiCitationSources(candidates, citations)
			if len(citation.chunks) > 0 {
				chunks = citation.chunks
			}
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
		candidates:      candidates,
	}

	return result, updates, nil
}

func attachWikiCitationSources(candidates []wikiIngestV2Candidate, citations map[string][]string) {
	for i := range candidates {
		candidates[i].SourceChunks = dedupeWikiChunkRefs(append(candidates[i].SourceChunks, citations[candidates[i].Slug]...))
	}
}

func mergeWikiIngestV2Candidates(existing, incoming []wikiIngestV2Candidate) []wikiIngestV2Candidate {
	indexes := make(map[string]int, len(existing)+len(incoming))
	merged := append([]wikiIngestV2Candidate(nil), existing...)
	for i, candidate := range merged {
		indexes[strings.TrimSpace(candidate.Slug)] = i
	}
	for _, candidate := range incoming {
		slug := strings.TrimSpace(candidate.Slug)
		if index, ok := indexes[slug]; ok {
			merged[index] = mergeWikiIngestV2Candidate(merged[index], candidate)
			continue
		}
		indexes[slug] = len(merged)
		merged = append(merged, candidate)
	}
	return merged
}

func (s *WikiIngestV2Service) wikiPromptInputBudget(ctx context.Context, promptOverhead string) (int, error) {
	if budgeter, ok := s.llm.(wikiPromptInputBudgeter); ok {
		return budgeter.InputBudget(ctx, promptOverhead)
	}
	return tokenlimit.DefaultContextBudget, nil
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
			Slug:        slug,
			Type:        candidate.PageType,
			Name:        candidate.Name,
			Description: candidate.Description,
			Aliases:     append([]string(nil), candidate.Aliases...),
		})
	}
	if len(newItems) == 0 {
		return candidates, nil
	}

	merges := make(map[string]string)
	for i, item := range newItems {
		// 同批次同类型、标题完全相同的候选确定性归并，避免依赖 LLM 是否返回 merges。
		name := normalizeWikiDedupTitle(item.Name)
		if name != "" {
			for _, prior := range newItems[:i] {
				if prior.Type != item.Type || normalizeWikiDedupTitle(prior.Name) != name {
					continue
				}
				target := prior.Slug
				if resolved := merges[target]; resolved != "" {
					target = resolved
				}
				merges[item.Slug] = target
				break
			}
			if merges[item.Slug] != "" {
				continue
			}
		}

		existingPages, err := s.loadWikiDedupExistingPages(ctx, in.Eid, in.LibraryID, []WikiDedupItem{item})
		if err != nil {
			return nil, err
		}
		// 唯一的历史同名词条是明确身份匹配；只在存在多个同名页面时交给 LLM 消歧。
		name = normalizeWikiDedupTitle(item.Name)
		var exactTitleMatches []WikiDedupPage
		if name != "" {
			for _, page := range existingPages {
				if normalizeWikiDedupTitle(page.Title) == name {
					exactTitleMatches = append(exactTitleMatches, page)
				}
			}
		}
		if len(exactTitleMatches) == 1 {
			merges[item.Slug] = exactTitleMatches[0].Slug
			logger.Infof(ctx, "【Wiki去重】候选词条与已有词条标题完全匹配，直接复用已有页面：新候选=%s，已有页面=%s", item.Slug, exactTitleMatches[0].Slug)
			continue
		}
		for _, prior := range newItems[:i] {
			if prior.Type != item.Type || !wikiIdentityNamesOverlap(item, prior) {
				continue
			}
			target := prior.Slug
			if resolved := merges[target]; resolved != "" {
				target = resolved
			}
			found := false
			for _, page := range existingPages {
				if page.Slug == target {
					found = true
					break
				}
			}
			if !found && target != item.Slug {
				if len(existingPages) == 20 {
					existingPages = existingPages[:19]
				}
				existingPages = append(existingPages, WikiDedupPage{Slug: target, Type: prior.Type, Title: prior.Name, Summary: prior.Description, Aliases: prior.Aliases})
			}
		}
		if len(existingPages) == 0 {
			continue
		}
		resolved, err := s.dedup.PlanDedup(ctx, WikiDedupInput{
			NewItems:      []WikiDedupItem{item},
			ExistingPages: existingPages,
		})
		if err != nil {
			logger.Warnf(ctx, "【Wiki生成】候选 %s 消歧失败，保留独立词条继续生成：%v", item.Slug, err)
			continue
		}
		for source, target := range resolved {
			merges[source] = target
		}
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

func normalizeWikiDedupTitle(title string) string {
	return strings.ToLower(strings.TrimSpace(title))
}

func (s *WikiIngestV2Service) loadWikiDedupExistingPages(ctx context.Context, eid, libraryID int64, items []WikiDedupItem) ([]WikiDedupPage, error) {
	if s.db == nil {
		return nil, nil
	}
	const candidateLimit = 20
	var existing []WikiDedupPage
	seen := make(map[string]bool)
	for _, item := range items {
		// 先独立查询精确标题和 Slug，避免别名候选达到上限后挤掉真正的同名页面。
		// 同名结果可能不止一个，因此保留全部候选交给后续的歧义判断。
		names := append([]string{item.Slug, item.Name}, item.Aliases...)
		var exactPages []model.WikiPage
		if title := normalizeWikiDedupTitle(item.Name); title != "" {
			if err := s.db.WithContext(ctx).Model(&model.WikiPage{}).
				Select("id", "slug", "title", "summary", "page_type", "aliases").
				Where("eid = ? AND library_id = ? AND status = ? AND page_type = ?", eid, libraryID, model.WikiPageStatusActive, item.Type).
				Where("LOWER(TRIM(title)) = ?", title).Order("id ASC").Limit(candidateLimit).Find(&exactPages).Error; err != nil {
				return nil, fmt.Errorf("retrieve exact wiki title matches: %w", err)
			}
		}
		if slug := strings.TrimSpace(item.Slug); slug != "" && len(exactPages) < candidateLimit {
			var slugPages []model.WikiPage
			if err := s.db.WithContext(ctx).Model(&model.WikiPage{}).
				Select("id", "slug", "title", "summary", "page_type", "aliases").
				Where("eid = ? AND library_id = ? AND status = ? AND page_type = ? AND slug = ?", eid, libraryID, model.WikiPageStatusActive, item.Type, slug).
				Limit(1).Find(&slugPages).Error; err != nil {
				return nil, fmt.Errorf("retrieve exact wiki slug match: %w", err)
			}
			if len(slugPages) == 0 {
				if err := s.db.WithContext(ctx).Model(&model.WikiPage{}).
					Select("id", "slug", "title", "summary", "page_type", "aliases").
					Where("eid = ? AND library_id = ? AND status = ? AND page_type = ? AND LOWER(TRIM(slug)) = ?", eid, libraryID, model.WikiPageStatusActive, item.Type, strings.ToLower(slug)).
					Limit(1).Find(&slugPages).Error; err != nil {
					return nil, fmt.Errorf("retrieve normalized wiki slug match: %w", err)
				}
			}
			exactPages = append(exactPages, slugPages...)
		}
		for _, page := range exactPages {
			if !seen[page.Slug] && len(existing) < candidateLimit {
				seen[page.Slug] = true
				existing = append(existing, WikiDedupPage{Slug: page.Slug, Title: page.Title, Summary: page.Summary, Type: page.PageType, Aliases: wikiIdentityRankAliases(page.Aliases, names)})
			}
		}
		var esIDs []int64
		if s.identityESearch != nil {
			ids, esErr := s.identityESearch(ctx, eid, libraryID, item)
			if esErr != nil {
				logger.Warnf(ctx, "【Wiki生成】ES 身份召回不可用，回退数据库查询：%v", esErr)
			} else {
				esIDs = ids
			}
		}
		const lexicalLimit = 12
		for pass := 0; pass < 2 && len(existing) < lexicalLimit; pass++ {
			if pass == 1 && len(esIDs) > 0 {
				break
			}
			var match *gorm.DB
			for _, value := range names {
				name := strings.ToLower(strings.TrimSpace(value))
				if name == "" || (pass == 1 && (len([]rune(name)) < 4 || strings.ContainsAny(name, "%_"))) {
					continue
				}
				var condition *gorm.DB
				if pass == 0 {
					condition = s.db.Where("LOWER(TRIM(slug)) = ? OR LOWER(TRIM(title)) = ? OR lower(aliases) LIKE ?", name, name, "%\""+name+"\"%")
				} else {
					pattern := "%" + name + "%"
					condition = s.db.Where("lower(title) LIKE ? OR lower(slug) LIKE ?", pattern, pattern)
				}
				if match == nil {
					match = condition
				} else {
					match = match.Or(condition)
				}
			}
			if match == nil {
				continue
			}
			var pages []model.WikiPage
			if err := s.db.WithContext(ctx).Model(&model.WikiPage{}).
				Select("id", "slug", "title", "summary", "page_type", "aliases").
				Where("eid = ? AND library_id = ? AND status = ? AND page_type = ?", eid, libraryID, model.WikiPageStatusActive, item.Type).
				Where(match).
				Order(gorm.Expr("CASE WHEN LOWER(TRIM(title)) = ? THEN 0 WHEN LOWER(TRIM(slug)) = ? THEN 1 ELSE 2 END, id ASC", normalizeWikiDedupTitle(item.Name), normalizeWikiDedupTitle(item.Slug))).
				Limit(lexicalLimit - len(existing)).Find(&pages).Error; err != nil {
				return nil, fmt.Errorf("retrieve wiki identity candidates: %w", err)
			}
			for _, page := range pages {
				if !seen[page.Slug] {
					seen[page.Slug] = true
					existing = append(existing, WikiDedupPage{Slug: page.Slug, Title: page.Title, Summary: page.Summary, Type: page.PageType, Aliases: wikiIdentityRankAliases(page.Aliases, names)})
				}
			}
		}
		// ES 词法候选经过数据库重新确认身份范围，避免依赖 ES 中可能滞后的元数据。
		if len(esIDs) > 0 && len(existing) < candidateLimit {
			ids := esIDs
			var pages []model.WikiPage
			if err := s.db.WithContext(ctx).Model(&model.WikiPage{}).
				Select("id", "slug", "title", "summary", "page_type", "aliases").
				Where("eid = ? AND library_id = ? AND status = ? AND page_type = ? AND id IN ?", eid, libraryID, model.WikiPageStatusActive, item.Type, ids).
				Limit(candidateLimit).Find(&pages).Error; err != nil {
				return nil, err
			}
			byID := make(map[int64]model.WikiPage, len(pages))
			for _, page := range pages {
				byID[page.ID] = page
			}
			for _, id := range ids {
				page, ok := byID[id]
				if ok && !seen[page.Slug] && len(existing) < candidateLimit {
					seen[page.Slug] = true
					existing = append(existing, WikiDedupPage{Slug: page.Slug, Title: page.Title, Summary: page.Summary, Type: page.PageType, Aliases: wikiIdentityRankAliases(page.Aliases, names)})
				}
			}
		}
		if s.identitySemanticSearch != nil && len(existing) < candidateLimit {
			ids, searchErr := s.identitySemanticSearch(ctx, s.db, eid, libraryID, item)
			if searchErr != nil {
				logger.Warnf(ctx, "【Wiki生成】语义候选召回失败，继续使用名称召回：%v", searchErr)
			} else if len(ids) > 0 {
				var pages []model.WikiPage
				if err := s.db.WithContext(ctx).Select("id", "slug", "title", "summary", "page_type", "aliases").
					Where("eid = ? AND library_id = ? AND status = ? AND page_type = ? AND id IN ?", eid, libraryID, model.WikiPageStatusActive, item.Type, ids).
					Limit(candidateLimit).Find(&pages).Error; err != nil {
					return nil, err
				}
				byID := make(map[int64]model.WikiPage, len(pages))
				for _, page := range pages {
					byID[page.ID] = page
				}
				for _, id := range ids {
					page, ok := byID[id]
					if ok && !seen[page.Slug] && len(existing) < candidateLimit {
						seen[page.Slug] = true
						existing = append(existing, WikiDedupPage{Slug: page.Slug, Title: page.Title, Summary: page.Summary, Type: page.PageType, Aliases: wikiIdentityRankAliases(page.Aliases, names)})
					}
				}
			}
		}
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
		"StrictCategoryScope": in.strictCategoryScope,
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

	return flattenWikiCandidateBatch(ctx, "candidate_extract", batch), nil
}

func (s *WikiIngestV2Service) extractKnowledgeCandidates(ctx context.Context, in WikiIngestV2MapDocumentInput, content string, previousSlugs string) ([]wikiIngestV2Candidate, error) {
	prompt, err := s.prompts.Render(WikiKnowledgeExtractPrompt, map[string]any{
		"Content":             content,
		"PreviousSlugs":       previousSlugs,
		"Language":            wikiIngestV2Language(in.Language),
		"StrictCategoryScope": in.strictCategoryScope,
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

	return flattenWikiCandidateBatch(ctx, "legacy_knowledge_extract", batch), nil
}

func (s *WikiIngestV2Service) extractKnowledgeCandidatesFromBatches(ctx context.Context, in WikiIngestV2MapDocumentInput, batches []string, previousSlugs string) ([]wikiIngestV2Candidate, error) {
	var candidates []wikiIngestV2Candidate
	for _, batch := range batches {
		batchCandidates, err := s.extractKnowledgeCandidates(ctx, in, batch, previousSlugs)
		if err != nil {
			return nil, err
		}
		candidates = mergeWikiIngestV2Candidates(candidates, batchCandidates)
	}
	return candidates, nil
}

func (s *WikiIngestV2Service) generateSummaryPage(ctx context.Context, in WikiIngestV2MapDocumentInput, content string, candidates []wikiIngestV2Candidate) (string, string, error) {
	vars := map[string]any{
		"Content":        "",
		"SourceContext":  renderWikiIngestV2SourceContext("document_digest", in, len(candidates)),
		"Language":       wikiIngestV2Language(in.Language),
		"ExtractedSlugs": renderWikiSummarySlugListing(candidates),
	}
	promptOverhead, err := s.prompts.Render(WikiSummaryPrompt, vars)
	if err != nil {
		return "", "", fmt.Errorf("render wiki summary budget prompt: %w", err)
	}
	budget, err := s.wikiPromptInputBudget(ctx, promptOverhead)
	if err != nil {
		return "", "", err
	}
	batches := splitWikiDocumentContentByTokenBudget(content, budget)
	if len(batches) == 0 {
		return "", "", fmt.Errorf("wiki summary input budget is not positive")
	}
	if len(batches) == 1 {
		return s.generateSummaryPageForContent(ctx, in, batches[0], candidates)
	}

	partials := make([]string, 0, len(batches))
	for _, batch := range batches {
		partial, err := s.generateWikiSummaryReduction(ctx, batch, in.Language)
		if err != nil {
			return "", "", err
		}
		partials = append(partials, partial)
	}

	for len(partials) > 1 {
		mergeInput := strings.Join(partials, "\n\n")
		mergeBatches := splitWikiDocumentContentByTokenBudget(mergeInput, budget)
		if len(mergeBatches) >= len(partials) {
			return "", "", fmt.Errorf("wiki summary reduction cannot fit partial results into context budget")
		}
		next := make([]string, 0, len(mergeBatches))
		for _, batch := range mergeBatches {
			partial, err := s.generateWikiSummaryReduction(ctx, batch, in.Language)
			if err != nil {
				return "", "", err
			}
			next = append(next, partial)
		}
		partials = next
	}
	return s.generateSummaryPageForContent(ctx, in, partials[0], candidates)
}

// generateWikiSummaryReduction 生成中间摘要（分批摘要链路的第一级）。
//
// 三点与旧实现的区别，都是为了消除"猜模型会输出什么"：
//
//  1. 输出协议改为 XML 标签（<intermediate_summary>），由提示词明文要求。
//     旧实现靠"是否以某句英文开头"判断回显，模型换个说法就穿透；标签是提示词
//     与代码之间的显式约定，模型不遵守就是违约，不遵守就不落库，不需要猜。
//
//  2. 校验只看提示词自己承诺的契约：标签完整、单段、指定语言、不逐字照抄源内容。
//     全部可在提示词模板里逐条指出出处。
//
//  3. 重试携带纠偏信息。此前 prompt 是闭包外的固定变量，三次重发的是逐字节相同的
//     提示词，属于盲重采样；生产日志里出现过多次逐字节相同的响应，纯粹浪费 token。
//     现在每次重试都会把"上一次具体违反了哪条契约"回灌给模型。
func (s *WikiIngestV2Service) generateWikiSummaryReduction(ctx context.Context, content, language string) (string, error) {
	prompt, err := s.prompts.Render(WikiSummaryReductionPrompt, map[string]any{
		"Content":  content,
		"Language": wikiIngestV2Language(language),
	})
	if err != nil {
		return "", fmt.Errorf("render wiki summary reduction prompt: %w", err)
	}

	var lastViolation string
	raw, err := generateWikiPromptWithRetry(ctx, func() (string, error) {
		response, callErr := s.llm.Generate(ctx, prompt)
		if callErr != nil {
			return "", callErr
		}
		inner, stripErr := extractWikiTaggedBlock(response, "intermediate_summary")
		if stripErr != nil {
			lastViolation = stripErr.Error()
			return "", fmt.Errorf("%s: %w", wikiContractViolationMarker, stripErr)
		}
		if verr := validateWikiReductionContract(inner, content, language); verr != nil {
			lastViolation = verr.Error()
			return "", verr
		}
		return inner, nil
	},
		common.WithMaxRetries(2),
		common.WithRetryableFunc(isWikiSummaryFormatRetryableError),
		// 每次重试追加"上一次为什么不合格"，让重试有信息增量而不是重复采样。
		common.WithRetryHook(func(attempt int, retryErr error) {
			if attempt <= 0 || lastViolation == "" {
				return
			}
			prompt = prompt + fmt.Sprintf(`

Your previous attempt was rejected: %s

Produce the <intermediate_summary> block again, this time satisfying the shape and content requirements above.`, lastViolation)
			logger.Warnf(ctx, "【Wiki生成】 reduction 重试并纠偏 attempt=%d violation=%s", attempt+1, truncateWikiText(lastViolation, 160))
			lastViolation = ""
		}),
	)
	if err != nil {
		return "", fmt.Errorf("reduce wiki summary: %w", err)
	}
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", fmt.Errorf("reduce wiki summary: LLM returned empty content")
	}
	return trimmed, nil
}

// generateSummaryPageForContent 生成文档摘要页（分批链路的最后一级，或单批时的唯一一级）。
//
// content 可能是原始正文（单批），也可能是 reduction 的输出（多批）。提示词现在明确
// 告诉模型 <content> 是数据而非指令，因此即使上游压缩得不理想，下游也不会跟着跑偏。
func (s *WikiIngestV2Service) generateSummaryPageForContent(ctx context.Context, in WikiIngestV2MapDocumentInput, content string, candidates []wikiIngestV2Candidate) (string, string, error) {
	prompt, err := s.prompts.Render(WikiSummaryPrompt, map[string]any{
		"Content":        content,
		"SourceContext":  renderWikiIngestV2SourceContext("document_digest", in, len(candidates)),
		"Language":       wikiIngestV2Language(in.Language),
		"ExtractedSlugs": renderWikiSummarySlugListing(candidates),
	})
	if err != nil {
		return "", "", fmt.Errorf("render wiki summary prompt: %w", err)
	}

	var lastViolation string
	raw, err := generateWikiPromptWithRetry(ctx, func() (string, error) {
		response, callErr := s.llm.Generate(ctx, prompt)
		if callErr != nil {
			return "", callErr
		}
		inner, stripErr := extractWikiTaggedBlock(response, "wiki_summary")
		if stripErr != nil {
			lastViolation = stripErr.Error()
			return "", fmt.Errorf("%s: %w", wikiContractViolationMarker, stripErr)
		}
		if verr := validateWikiSummaryContract(inner, content, in.Language); verr != nil {
			lastViolation = verr.Error()
			return "", verr
		}
		return inner, nil
	},
		common.WithMaxRetries(2),
		common.WithRetryableFunc(isWikiSummaryFormatRetryableError),
		common.WithRetryHook(func(attempt int, retryErr error) {
			if attempt <= 0 || lastViolation == "" {
				return
			}
			prompt = prompt + fmt.Sprintf(`

Your previous attempt was rejected: %s

Produce the <wiki_summary> block again, this time satisfying the shape and content requirements above.`, lastViolation)
			logger.Warnf(ctx, "【Wiki生成】 summary 重试并纠偏 attempt=%d violation=%s", attempt+1, truncateWikiText(lastViolation, 160))
			lastViolation = ""
		}),
	)
	if err != nil {
		return "", "", fmt.Errorf("generate summary page: %w", err)
	}

	summaryLine, summaryBody := splitSummaryLine(raw)
	if strings.TrimSpace(summaryLine) == "" {
		return "", "", fmt.Errorf("generate summary page: %s: no SUMMARY line after retries", wikiContractViolationMarker)
	}
	return summaryLine, summaryBody, nil
}

// isWikiSummaryFormatRetryableError 判断契约类错误是否值得重试。
//
// 判定依据是统一标记 wikiContractViolationMarker，而不是一堆具体错误文案——
// 错误文案会随实现变化，按文案匹配是另一种形式的脆弱字符串判断。
func isWikiSummaryFormatRetryableError(err error) bool {
	if err == nil {
		return false
	}
	if strings.Contains(err.Error(), wikiContractViolationMarker) {
		return true
	}
	errStr := strings.ToLower(err.Error())
	return strings.Contains(errStr, "llm 返回内容为空")
}

func wikiSummaryResponseMatchesLanguage(response, language string) bool {
	language = strings.ToLower(strings.TrimSpace(language))
	if !strings.Contains(language, "中文") && language != "zh" && !strings.HasPrefix(language, "zh-") {
		return true
	}
	return strings.IndexFunc(response, func(r rune) bool { return unicode.Is(unicode.Han, r) }) >= 0
}

// wikiResponseLooksLikePromptEcho 已移除。
//
// 背景：本轮之前这里有 47 条前缀黑名单（wikiEchoImperativePrefixes /
// wikiEchoContentAnchors），靠"输出开头像不像某句英文"判定回显。实测证明这条路
// 走不通：
//
//  1. 黑名单必然被绕过。生产日志里的 "NOT include any analysis, explanations, or
//     markdown formatting." 在整个代码仓库 grep 不到，是模型自造的。
//  2. 换成"与提示词原文的重合度"也不行。实测生产回显样本的重合率是 0%——模型
//     几乎从不逐字复制提示词，它是自己改写了一遍。所以重合度检测对改写型回显
//     完全无效。
//  3. 换成"与源文档的实体重合度"方向是反的。实测回显样本与源文档重合 33%，
//     正常摘要只有 0%（因为那份源文档本身全是英文指令，中文摘要自然不重合）。
//  4. 换成"新颖词占比"只能抓逐字抄源，对自造回显同样无效。
//
// 结论：没有任何基于输出文本内容的统计判据能可靠识别回显。继续加判据就是在
// 打地鼠，而且会制造"已修复"的假象。
//
// 现在的做法：**把防线前移到输出协议**。提示词要求响应必须是
// <wiki_summary>...</wiki_summary> 这样的标签块，代码用 extractWikiTaggedBlock
// 提取。模型如果回显，它产出的是自然语言，不会有正确的标签块——协议校验直接
// 把它挡在门外，失败信息（"response does not contain the required
// <wiki_summary> opening tag"）会作为纠偏信息回灌给下一次尝试。
//
// 这不依赖任何对模型措辞的猜测：判据是"输出是否符合我要求的格式"，不是"输出像
// 不像坏输出"。

// wikiResponseHasSubstantiveHanRatio 判断响应是否含有足量中文实体。
//
// 这不是猜测，而是提示词的明文契约（"Write in {{.Language}}"）：中文任务里，
// 一段正常的中文摘要汉字占比必然很高；纯英文回显则接近 0。
func wikiResponseHasSubstantiveHanRatio(response string) bool {
	return wikiContractHasDominantHanRatio(response)
}

// hasWikiSummaryContent 判断本次生成是否产出了可落库的摘要内容。
func hasWikiSummaryContent(summaryLine, summaryBody string) bool {
	return strings.TrimSpace(summaryLine) != "" || strings.TrimSpace(summaryBody) != ""
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
	contentHash := wikiDocumentContentFingerprint(in.Content)
	updates := make([]WikiSlugUpdate, 0, 1+len(candidates)+len(discovered))
	// 摘要生成失败时 summaryLine/summaryBody 为空（见 mapDocument 中"文档摘要生成失败"的降级分支）。
	// 此时若仍然写入 summary 更新，会把上一轮正常生成的摘要页覆盖成空页面。
	// 生产日志 53AIHub-20261021.log:105xxx 记录了 file_id=1978075 的这一现象：
	// summary 生成报"language does not match requested language"后，页面变成空文档。
	// 没有可用摘要时直接跳过，让上一轮内容保持不变。
	if in.EnableWikiDynamicKnowledge && hasWikiSummaryContent(summaryLine, summaryBody) {
		updates = append(updates, WikiSlugUpdate{
			Slug:              wikiSummarySlug(in.FileID),
			PageType:          model.WikiPageTypeSummary,
			Title:             firstNonEmpty(strings.TrimSpace(in.Title), fmt.Sprintf("Document %d Summary", in.FileID)),
			Summary:           summaryLine,
			Content:           summaryBody,
			SummaryLine:       summaryLine,
			SummaryBody:       summaryBody,
			DocTitle:          strings.TrimSpace(in.Title),
			DocSummary:        summaryBody,
			Eid:               in.Eid,
			LibraryID:         in.LibraryID,
			SourceFileID:      in.FileID,
			SourceContentHash: contentHash,
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
			Slug:              slug,
			PageType:          candidate.PageType,
			Title:             candidate.Name,
			Aliases:           append([]string(nil), candidate.Aliases...),
			Summary:           candidate.Description,
			Content:           content,
			DocTitle:          strings.TrimSpace(in.Title),
			DocSummary:        summaryBody,
			Eid:               in.Eid,
			LibraryID:         in.LibraryID,
			SourceFileID:      in.FileID,
			SourceChunks:      sourceChunks,
			SourceContentHash: contentHash,
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

func wikiCandidateMissingFields(candidate WikiCandidateSlug) []string {
	missing := make([]string, 0, 4)
	if strings.TrimSpace(candidate.Name) == "" {
		missing = append(missing, "name")
	}
	if strings.TrimSpace(candidate.Slug) == "" {
		missing = append(missing, "slug")
	}
	if strings.TrimSpace(candidate.Description) == "" {
		missing = append(missing, "description")
	}
	if strings.TrimSpace(candidate.Details) == "" {
		missing = append(missing, "details")
	}
	return missing
}

func flattenWikiCandidateBatch(ctx context.Context, stage string, batch WikiCandidateSlugBatch) []wikiIngestV2Candidate {
	candidates := make([]wikiIngestV2Candidate, 0, len(batch.Entities)+len(batch.Concepts))
	for index, entity := range batch.Entities {
		missing := wikiCandidateMissingFields(entity)
		if len(missing) > 0 {
			logger.Errorf(ctx, "【Wiki生成】 %s entities[%d] 字段缺失，已记录并%s: missing_fields=%s name=%q slug=%q", stage, index, candidateSkipMessage(entity.Name, entity.Slug), strings.Join(missing, ","), entity.Name, entity.Slug)
		}
		if strings.TrimSpace(entity.Slug) == "" || strings.TrimSpace(entity.Name) == "" {
			continue
		}
		candidates = append(candidates, wikiIngestV2Candidate{
			PageType:     model.WikiPageTypeEntity,
			EntityType:   firstNonEmpty(entity.Type, model.WikiPageTypeEntity),
			Name:         entity.Name,
			Slug:         entity.Slug,
			Aliases:      append([]string(nil), entity.Aliases...),
			Description:  entity.Description,
			Details:      entity.Details,
			SourceChunks: nil,
		})
	}
	for index, concept := range batch.Concepts {
		missing := wikiCandidateMissingFields(concept)
		if len(missing) > 0 {
			logger.Errorf(ctx, "【Wiki生成】 %s concepts[%d] 字段缺失，已记录并%s: missing_fields=%s name=%q slug=%q", stage, index, candidateSkipMessage(concept.Name, concept.Slug), strings.Join(missing, ","), concept.Name, concept.Slug)
		}
		if strings.TrimSpace(concept.Slug) == "" || strings.TrimSpace(concept.Name) == "" {
			continue
		}
		candidates = append(candidates, wikiIngestV2Candidate{
			PageType:     model.WikiPageTypeConcept,
			EntityType:   model.WikiPageTypeConcept,
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

func candidateSkipMessage(name, slug string) string {
	if strings.TrimSpace(name) == "" || strings.TrimSpace(slug) == "" {
		return "跳过"
	}
	return "保留"
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
