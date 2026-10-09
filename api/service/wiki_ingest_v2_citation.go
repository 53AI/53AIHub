package service

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/tokenlimit"
	"github.com/53AI/53AIHub/model"
)

const wikiIngestV2CitationChunkLimit = 6000

func splitWikiDocumentContentByTokenBudget(content string, budget int) []string {
	if strings.TrimSpace(content) == "" || budget <= 0 {
		return nil
	}

	runes := []rune(content)
	maxRunes := budget * 3
	batches := make([]string, 0, (len(runes)+maxRunes-1)/maxRunes)
	for start := 0; start < len(runes); start += maxRunes {
		end := start + maxRunes
		if end > len(runes) {
			end = len(runes)
		}
		batches = append(batches, tokenlimit.TruncateContent(string(runes[start:end]), budget))
	}
	return batches
}

func (s *WikiIngestV2Service) classifyChunkCitations(
	ctx context.Context,
	in WikiIngestV2MapDocumentInput,
	content string,
	candidates []wikiIngestV2Candidate,
) (map[string][]string, []wikiIngestV2Candidate, map[string]wikiIngestV2SyntheticChunk, error) {
	chunks := splitWikiIngestContentIntoChunks(content, wikiIngestV2CitationChunkLimit)

	if len(candidates) == 0 {
		return map[string][]string{}, nil, chunks, nil
	}

	promptOverhead, err := s.prompts.Render(WikiChunkCitationPrompt, map[string]any{
		"CandidateSlugs": renderWikiCandidateSlugsXML(candidates),
		"ChunksXML":      "",
		"SourceContext":  renderWikiIngestV2SourceContext("citation_selection", in, len(candidates)),
		"Language":       wikiIngestV2Language(in.Language),
	})
	if err != nil {
		return nil, nil, chunks, fmt.Errorf("render wiki citation prompt: %w", err)
	}
	budget, err := s.wikiPromptInputBudget(ctx, promptOverhead)
	if err != nil {
		return nil, nil, chunks, err
	}
	chunkRunes := (budget - 17) * 3
	if chunkRunes < 3 {
		chunkRunes = 3
	}
	if chunkRunes > wikiIngestV2CitationChunkLimit {
		chunkRunes = wikiIngestV2CitationChunkLimit
	}
	chunks = splitWikiIngestContentIntoChunks(content, chunkRunes)
	chunkBatches := batchWikiCitationChunks(chunks, budget)
	citations := make(map[string][]string)
	var discovered []wikiIngestV2Candidate
	for _, batch := range chunkBatches {
		prompt, renderErr := s.prompts.Render(WikiChunkCitationPrompt, map[string]any{
			"CandidateSlugs": renderWikiCandidateSlugsXML(candidates),
			"ChunksXML":      renderWikiSyntheticChunksXML(batch),
			"SourceContext":  renderWikiIngestV2SourceContext("citation_selection", in, len(candidates)),
			"Language":       wikiIngestV2Language(in.Language),
		})
		if renderErr != nil {
			return nil, nil, chunks, fmt.Errorf("render wiki citation prompt: %w", renderErr)
		}
		raw, generateErr := s.llm.Generate(ctx, prompt)
		if generateErr != nil {
			return nil, nil, chunks, fmt.Errorf("classify chunk citations failed: %w", generateErr)
		}

		batchResult, warnings := decodeWikiCitationBatch(raw)
		for _, warning := range warnings {
			logger.Warnf(ctx, "【Wiki生成】 %s", warning)
		}
		for slug, refs := range batchResult.Citations {
			citations[slug] = dedupeWikiChunkRefs(append(citations[slug], filterKnownChunkRefs(refs, batch)...))
		}
		discovered = mergeWikiIngestV2Candidates(discovered, flattenWikiDiscoveredSlugs(batchResult.NewSlugs))
	}

	return citations, discovered, chunks, nil
}

func batchWikiCitationChunks(chunks map[string]wikiIngestV2SyntheticChunk, budget int) []map[string]wikiIngestV2SyntheticChunk {
	if len(chunks) == 0 || budget <= 0 {
		return nil
	}
	ids := make([]string, 0, len(chunks))
	for id := range chunks {
		ids = append(ids, id)
	}
	sort.Strings(ids)

	const perChunkOverheadTokens = 16
	batches := make([]map[string]wikiIngestV2SyntheticChunk, 0, 1)
	current := make(map[string]wikiIngestV2SyntheticChunk)
	usedTokens := 0
	for _, id := range ids {
		chunk := chunks[id]
		tokens := (len([]rune(chunk.Content))+2)/3 + perChunkOverheadTokens
		if len(current) > 0 && usedTokens+tokens > budget {
			batches = append(batches, current)
			current = make(map[string]wikiIngestV2SyntheticChunk)
			usedTokens = 0
		}
		current[id] = chunk
		usedTokens += tokens
	}
	if len(current) > 0 {
		batches = append(batches, current)
	}
	return batches
}

func splitWikiIngestContentIntoChunks(content string, maxRunes int) map[string]wikiIngestV2SyntheticChunk {
	content = strings.TrimSpace(content)
	if content == "" {
		return map[string]wikiIngestV2SyntheticChunk{}
	}
	if maxRunes <= 0 {
		maxRunes = wikiIngestV2CitationChunkLimit
	}
	parts := splitWikiDocumentContentByTokenBudget(content, (maxRunes+2)/3)
	chunks := make(map[string]wikiIngestV2SyntheticChunk, len(parts))
	for i, part := range parts {
		id := fmt.Sprintf("c%03d", i)
		chunks[id] = wikiIngestV2SyntheticChunk{ID: id, Content: part}
	}
	return chunks
}

func splitWikiIngestContentBlocks(content string) []string {
	rawBlocks := strings.Split(content, "\n\n")
	blocks := make([]string, 0, len(rawBlocks))
	for _, raw := range rawBlocks {
		block := strings.TrimSpace(raw)
		if block != "" {
			blocks = append(blocks, block)
		}
	}
	if len(blocks) > 1 {
		return blocks
	}

	lines := strings.Split(content, "\n")
	blocks = blocks[:0]
	current := make([]string, 0, len(lines))

	flush := func() {
		if len(current) == 0 {
			return
		}
		blocks = append(blocks, strings.Join(current, "\n"))
		current = current[:0]
	}

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			flush()
			continue
		}
		if strings.HasPrefix(trimmed, "#") {
			flush()
			blocks = append(blocks, trimmed)
			continue
		}
		current = append(current, trimmed)
	}
	flush()
	return blocks
}

func truncateWikiRunes(s string, maxRunes int) string {
	if maxRunes <= 0 {
		return ""
	}
	runes := []rune(strings.TrimSpace(s))
	if len(runes) <= maxRunes {
		return strings.TrimSpace(s)
	}
	return string(runes[:maxRunes])
}

func decodeWikiLLMJSON(raw string, dst any) error {
	return common.ParseLLMJSONInto(context.Background(), raw, dst)
}

// decodeWikiCitationBatch 保留可用 citations，并逐条容错 new_slugs。
// citation 是增强信息，不能因为新增 slug 的单条脏数据阻断整条 Wiki 生成。
func decodeWikiCitationBatch(raw string) (WikiCitationBatch, []string) {
	type citationEnvelope struct {
		Citations map[string][]string `json:"citations"`
		NewSlugs  json.RawMessage     `json:"new_slugs"`
	}

	var envelope citationEnvelope
	if err := decodeWikiLLMJSON(raw, &envelope); err != nil {
		return WikiCitationBatch{}, []string{fmt.Sprintf("citation 响应整体解析失败，已跳过引用增强: %v", err)}
	}

	batch := WikiCitationBatch{Citations: envelope.Citations}
	if len(envelope.NewSlugs) == 0 || string(envelope.NewSlugs) == "null" {
		return batch, nil
	}

	var rawSlugs []json.RawMessage
	if err := decodeWikiLLMJSON(string(envelope.NewSlugs), &rawSlugs); err != nil {
		return batch, []string{fmt.Sprintf("new_slugs 数组解析失败，已跳过新增 slug: %v", err)}
	}

	warnings := make([]string, 0)
	for index, rawSlug := range rawSlugs {
		var slug WikiDiscoveredSlug
		if err := decodeWikiLLMJSON(string(rawSlug), &slug); err != nil {
			var identity struct {
				Slug string `json:"slug"`
			}
			_ = decodeWikiLLMJSON(string(rawSlug), &identity)
			warnings = append(warnings, fmt.Sprintf("new_slugs[%d] slug=%s 解析失败，已丢弃该条: %v", index, identity.Slug, err))
			continue
		}
		batch.NewSlugs = append(batch.NewSlugs, slug)
	}
	return batch, warnings
}

func renderWikiCandidateSlugsXML(candidates []wikiIngestV2Candidate) string {
	if len(candidates) == 0 {
		return ""
	}

	var builder strings.Builder
	for _, candidate := range candidates {
		if candidate.Slug == "" || candidate.Name == "" {
			continue
		}
		builder.WriteString("- slug: ")
		builder.WriteString(candidate.Slug)
		builder.WriteString(", type: ")
		builder.WriteString(candidate.PageType)
		builder.WriteString(", name: ")
		builder.WriteString(fmt.Sprintf("%q", candidate.Name))
		if len(candidate.Aliases) > 0 {
			builder.WriteString(fmt.Sprintf(" aliases=%q", strings.Join(candidate.Aliases, ", ")))
		}
		if strings.TrimSpace(candidate.Description) != "" {
			builder.WriteString(", description: ")
			builder.WriteString(candidate.Description)
		}
		builder.WriteString("\n")
	}

	return strings.TrimRight(builder.String(), "\n")
}

func renderWikiSyntheticChunksXML(chunks map[string]wikiIngestV2SyntheticChunk) string {
	if len(chunks) == 0 {
		return ""
	}

	ids := make([]string, 0, len(chunks))
	for id := range chunks {
		ids = append(ids, id)
	}
	sort.Strings(ids)

	var builder strings.Builder
	for index, id := range ids {
		chunk := chunks[id]
		builder.WriteString(fmt.Sprintf("<c id=%q index=\"%d\">\n", id, index))
		builder.WriteString(strings.TrimSpace(chunk.Content))
		builder.WriteString("\n</c>\n")
	}
	return strings.TrimRight(builder.String(), "\n")
}

func flattenWikiDiscoveredSlugs(items []WikiDiscoveredSlug) []wikiIngestV2Candidate {
	candidates := make([]wikiIngestV2Candidate, 0, len(items))
	for _, item := range items {
		if item.Slug == "" || item.Name == "" {
			continue
		}

		candidates = append(candidates, wikiIngestV2Candidate{
			PageType:     normalizeWikiDiscoveredPageType(item.Type, item.Slug),
			Name:         item.Name,
			Slug:         item.Slug,
			Aliases:      append([]string(nil), item.Aliases...),
			Description:  item.Description,
			Details:      item.Details,
			SourceChunks: append([]string(nil), item.SourceChunks...),
		})
	}
	return candidates
}

func filterKnownChunkRefs(refs []string, chunks map[string]wikiIngestV2SyntheticChunk) []string {
	if len(refs) == 0 {
		return nil
	}
	filtered := make([]string, 0, len(refs))
	for _, ref := range refs {
		ref = strings.TrimSpace(ref)
		if ref == "" {
			continue
		}
		if _, ok := chunks[ref]; !ok {
			continue
		}
		filtered = append(filtered, ref)
	}
	return dedupeWikiChunkRefs(filtered)
}

func normalizeWikiDiscoveredPageType(raw string, slug string) string {
	pageType := strings.ToLower(strings.TrimSpace(raw))
	switch pageType {
	case model.WikiPageTypeEntity, model.WikiPageTypeConcept:
		return pageType
	}

	switch {
	case strings.HasPrefix(slug, model.WikiPageTypeEntity+"/"):
		return model.WikiPageTypeEntity
	case strings.HasPrefix(slug, model.WikiPageTypeConcept+"/"):
		return model.WikiPageTypeConcept
	default:
		return model.WikiPageTypeConcept
	}
}
