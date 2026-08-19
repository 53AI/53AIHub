package service

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/model"
)

const wikiIngestV2CitationChunkLimit = 6000

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

	prompt, err := s.prompts.Render(WikiChunkCitationPrompt, map[string]any{
		"CandidateSlugs": renderWikiCandidateSlugsXML(candidates),
		"ChunksXML":      renderWikiSyntheticChunksXML(chunks),
		"SourceContext":  renderWikiIngestV2SourceContext("citation_selection", in, len(candidates)),
		"Language":       wikiIngestV2Language(in.Language),
	})
	if err != nil {
		return nil, nil, nil, fmt.Errorf("render wiki citation prompt: %w", err)
	}

	raw, err := s.llm.Generate(ctx, prompt)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("classify chunk citations failed: %w", err)
	}

	var batch WikiCitationBatch
	if err := decodeWikiLLMJSON(raw, &batch); err != nil {
		return nil, nil, nil, fmt.Errorf("parse chunk citation JSON: %w", err)
	}

	citations := make(map[string][]string, len(batch.Citations))
	for slug, refs := range batch.Citations {
		citations[slug] = filterKnownChunkRefs(refs, chunks)
	}

	return citations, flattenWikiDiscoveredSlugs(batch.NewSlugs), chunks, nil
}

func splitWikiIngestContentIntoChunks(content string, maxRunes int) map[string]wikiIngestV2SyntheticChunk {
	content = strings.TrimSpace(content)
	if content == "" {
		return map[string]wikiIngestV2SyntheticChunk{}
	}
	if maxRunes <= 0 {
		maxRunes = 6000
	}

	blocks := splitWikiIngestContentBlocks(content)
	if len(blocks) == 0 {
		return map[string]wikiIngestV2SyntheticChunk{
			"c000": {
				ID:      "c000",
				Content: content,
			},
		}
	}

	chunks := make(map[string]wikiIngestV2SyntheticChunk)
	current := make([]string, 0, len(blocks))
	currentRunes := 0
	chunkIndex := 0

	flush := func() {
		if len(current) == 0 {
			return
		}
		id := fmt.Sprintf("c%03d", chunkIndex)
		chunkIndex++
		chunks[id] = wikiIngestV2SyntheticChunk{
			ID:      id,
			Content: strings.Join(current, "\n\n"),
		}
		current = current[:0]
		currentRunes = 0
	}

	for _, block := range blocks {
		blockRunes := len([]rune(block))
		if len(current) > 0 && currentRunes+2+blockRunes > maxRunes {
			flush()
		}
		if blockRunes > maxRunes {
			flush()
			id := fmt.Sprintf("c%03d", chunkIndex)
			chunkIndex++
			chunks[id] = wikiIngestV2SyntheticChunk{
				ID:      id,
				Content: truncateWikiRunes(block, maxRunes),
			}
			continue
		}
		current = append(current, block)
		currentRunes += blockRunes
	}
	flush()

	if len(chunks) == 0 {
		return map[string]wikiIngestV2SyntheticChunk{
			"c000": {
				ID:      "c000",
				Content: content,
			},
		}
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
