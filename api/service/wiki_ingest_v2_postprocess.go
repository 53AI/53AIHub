package service

import (
	"context"
	"sort"
	"strings"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

func (s *WikiIngestV2Service) postProcessWikiPages(ctx context.Context, eid, libraryID int64, updates []WikiSlugUpdate) error {
	if s == nil || s.db == nil || len(updates) == 0 {
		return nil
	}

	affectedSlugs := uniqueWikiUpdateSlugs(updates)
	if len(affectedSlugs) == 0 {
		return nil
	}

	refs, liveTitles, liveSlugSet, redirectTargets, err := loadWikiPostProcessRefs(ctx, s.db, eid, libraryID)
	if err != nil {
		return err
	}

	var updated int
	var failed int
	for _, slug := range affectedSlugs {
		if err := s.rewriteSingleWikiPage(ctx, eid, libraryID, slug, refs, liveTitles, liveSlugSet, redirectTargets); err != nil {
			failed++
			logger.Warnf(ctx, "wiki ingest v2: postprocess failed for %s: %v", slug, err)
			continue
		}
		updated++
	}
	if updated > 0 || failed > 0 {
		logger.Infof(ctx, "wiki ingest v2: postprocessed %d pages (%d failed)", updated, failed)
	}
	return nil
}

func loadWikiPostProcessRefs(ctx context.Context, db *gorm.DB, eid, libraryID int64) ([]linkRef, map[string]string, map[string]struct{}, map[string]string, error) {
	if db == nil {
		return nil, nil, nil, nil, nil
	}
	var pages []model.WikiPage
	if err := db.WithContext(ctx).
		Where("eid = ? AND library_id = ? AND status IN ? AND page_type IN ?", eid, libraryID, []string{
			model.WikiPageStatusDraft,
			model.WikiPageStatusActive,
		}, []string{
			model.WikiPageTypeSummary,
			model.WikiPageTypeEntity,
			model.WikiPageTypeConcept,
		}).
		Find(&pages).Error; err != nil {
		return nil, nil, nil, nil, err
	}

	refs := make([]linkRef, 0, len(pages))
	liveTitles := make(map[string]string, len(pages))
	liveSlugSet := make(map[string]struct{}, len(pages))
	for _, page := range pages {
		slug := strings.TrimSpace(page.Slug)
		title := strings.TrimSpace(page.Title)
		if slug == "" {
			continue
		}
		liveSlugSet[slug] = struct{}{}
		if title != "" {
			if _, ok := liveTitles[title]; !ok {
				liveTitles[title] = slug
			}
			refs = append(refs, linkRef{
				slug:      slug,
				matchText: title,
			})
		}
		for _, alias := range normalizeWikiPageAliases(page.Aliases) {
			if _, ok := liveTitles[alias]; !ok {
				liveTitles[alias] = slug
			}
			refs = append(refs, linkRef{
				slug:      slug,
				matchText: alias,
			})
		}
	}

	var redirects []model.WikiPageRedirect
	if err := db.WithContext(ctx).
		Where("eid = ? AND library_id = ? AND status = ?", eid, libraryID, model.WikiRedirectStatusActive).
		Find(&redirects).Error; err != nil {
		return nil, nil, nil, nil, err
	}

	redirectTargets := make(map[string]string, len(redirects))
	for _, redirect := range redirects {
		fromSlug := strings.TrimSpace(redirect.FromSlug)
		toSlug := strings.TrimSpace(redirect.ToSlug)
		if fromSlug == "" || toSlug == "" {
			continue
		}
		if _, ok := liveSlugSet[toSlug]; !ok {
			continue
		}
		redirectTargets[fromSlug] = toSlug
	}

	sort.SliceStable(refs, func(i, j int) bool {
		if len([]rune(refs[i].matchText)) != len([]rune(refs[j].matchText)) {
			return len([]rune(refs[i].matchText)) > len([]rune(refs[j].matchText))
		}
		return refs[i].slug < refs[j].slug
	})

	return refs, liveTitles, liveSlugSet, redirectTargets, nil
}

func (s *WikiIngestV2Service) rewriteSingleWikiPage(
	ctx context.Context,
	eid, libraryID int64,
	slug string,
	refs []linkRef,
	liveTitles map[string]string,
	liveSlugSet map[string]struct{},
	redirectTargets map[string]string,
) error {
	slug = strings.TrimSpace(slug)
	if slug == "" {
		return nil
	}

	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		page, err := loadWikiPageForWrite(tx, eid, libraryID, slug)
		if err != nil {
			return err
		}
		if page == nil {
			return nil
		}
		if page.PageType == model.WikiPageTypeIndex || page.PageType == model.WikiPageTypeLog {
			return nil
		}
		if page.Status == model.WikiPageStatusArchived {
			return nil
		}

		rewritten := page.Body
		changed := false

		if linked, ok := linkifyWikiContent(rewritten, refs, page.Slug); ok {
			rewritten = linked
			changed = true
		}

		deadRewritten, deadChanged := rewriteDeadWikiLinks(rewritten, liveTitles, liveSlugSet, redirectTargets)
		if deadChanged {
			rewritten = deadRewritten
			changed = true
		}

		if !changed {
			return nil
		}

		sources, err := loadWikiPageSourcesForWrite(tx, page.ID)
		if err != nil {
			return err
		}
		page.Body = rewritten
		links := buildWikiPageLinksForContent(page.ID, eid, libraryID, page.Body, s.linkSvc, tx, page.UpdaterID)
		return persistWikiPageWrite(ctx, tx, page, sources, links, "wiki postprocess")
	})
}

func uniqueWikiUpdateSlugs(updates []WikiSlugUpdate) []string {
	if len(updates) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(updates))
	slugs := make([]string, 0, len(updates))
	for _, update := range updates {
		slug := strings.TrimSpace(update.Slug)
		if slug == "" {
			continue
		}
		if _, ok := seen[slug]; ok {
			continue
		}
		seen[slug] = struct{}{}
		slugs = append(slugs, slug)
	}
	sort.Strings(slugs)
	return slugs
}

func rewriteDeadWikiLinks(content string, liveTitles map[string]string, liveSlugSet map[string]struct{}, redirectTargets map[string]string) (string, bool) {
	if strings.TrimSpace(content) == "" {
		return content, false
	}

	forbidden := computeWikiRewriteForbiddenSpans(content)
	var builder strings.Builder
	builder.Grow(len(content))
	changed := false

	i := 0
	for i < len(content) {
		if span, ok := nextWikiRewriteForbiddenSpan(forbidden, i); ok {
			builder.WriteString(content[i:span.end])
			i = span.end
			continue
		}
		if strings.HasPrefix(content[i:], "[[") {
			end := strings.Index(content[i+2:], "]]")
			if end >= 0 {
				end += i + 4
				inner := content[i+2 : end-2]
				slug, display := splitWikiLinkInner(inner)
				if slug != "" {
					if resolved, keep := resolveWikiDeadLink(slug, display, liveTitles, liveSlugSet, redirectTargets); keep {
						if resolved != slug || display != normalizeWikiLinkDisplay(display) {
							changed = true
						}
						builder.WriteString(formatWikiLink(resolved, display))
					} else {
						fallback := strings.TrimSpace(display)
						if fallback == "" {
							fallback = slug
						}
						builder.WriteString(fallback)
						changed = true
					}
					i = end
					continue
				}
			}
		}
		builder.WriteByte(content[i])
		i++
	}

	if !changed {
		return content, false
	}
	return builder.String(), true
}

func resolveWikiDeadLink(slug, display string, liveTitles map[string]string, liveSlugSet map[string]struct{}, redirectTargets map[string]string) (string, bool) {
	slug = strings.TrimSpace(slug)
	if slug == "" {
		return "", false
	}
	if _, ok := liveSlugSet[slug]; ok {
		return slug, true
	}
	if next := strings.TrimSpace(redirectTargets[slug]); next != "" {
		if _, ok := liveSlugSet[next]; ok {
			return next, true
		}
	}
	display = strings.TrimSpace(display)
	if display != "" {
		if next := strings.TrimSpace(liveTitles[display]); next != "" {
			return next, true
		}
	}
	return "", false
}

func splitWikiLinkInner(inner string) (slug, display string) {
	inner = strings.TrimSpace(inner)
	if inner == "" {
		return "", ""
	}
	if pipe := strings.IndexByte(inner, '|'); pipe >= 0 {
		slug = strings.TrimSpace(inner[:pipe])
		display = strings.TrimSpace(inner[pipe+1:])
		return slug, display
	}
	return inner, ""
}

func formatWikiLink(slug, display string) string {
	slug = strings.TrimSpace(slug)
	display = strings.TrimSpace(display)
	if slug == "" {
		return display
	}
	if display == "" || display == slug {
		return "[[" + slug + "]]"
	}
	return "[[" + slug + "|" + display + "]]"
}

func normalizeWikiLinkDisplay(display string) string {
	return strings.TrimSpace(display)
}

func computeWikiRewriteForbiddenSpans(s string) []span {
	spans := make([]span, 0, 8)
	for _, sp := range scanWikiReferenceDefinitions(s) {
		spans = append(spans, sp)
	}

	i := 0
	n := len(s)
	for i < n {
		if isWikiFenceStart(s, i) {
			fenceLen, fenceCh := wikiFenceRun(s, i)
			end := findWikiFenceEnd(s, i+fenceLen, fenceCh, fenceLen)
			spans = append(spans, span{start: i, end: end})
			i = end
			continue
		}

		c := s[i]
		switch c {
		case '`':
			run := 1
			for i+run < n && s[i+run] == '`' {
				run++
			}
			closeIdx := findWikiInlineCodeClose(s, i+run, run)
			if closeIdx < 0 {
				i += run
				continue
			}
			spans = append(spans, span{start: i, end: closeIdx + run})
			i = closeIdx + run
		case '[':
			if end, ok := matchWikiMarkdownLink(s, i); ok {
				spans = append(spans, span{start: i, end: end})
				i = end
				continue
			}
			if end, ok := matchWikiReferenceStyleLink(s, i); ok {
				spans = append(spans, span{start: i, end: end})
				i = end
				continue
			}
			i++
		case '!':
			if i+1 < n && s[i+1] == '[' {
				if end, ok := matchWikiMarkdownLink(s, i+1); ok {
					spans = append(spans, span{start: i, end: end})
					i = end
					continue
				}
				if end, ok := matchWikiReferenceStyleLink(s, i+1); ok {
					spans = append(spans, span{start: i, end: end})
					i = end
					continue
				}
			}
			i++
		case '<':
			if end, ok := matchWikiAutolink(s, i); ok {
				spans = append(spans, span{start: i, end: end})
				i = end
				continue
			}
			i++
		default:
			i++
		}
	}

	sortWikiSpans(spans)
	return spans
}

func nextWikiRewriteForbiddenSpan(spans []span, pos int) (span, bool) {
	for _, sp := range spans {
		if pos >= sp.start && pos < sp.end {
			return sp, true
		}
		if sp.start > pos {
			break
		}
	}
	return span{}, false
}
