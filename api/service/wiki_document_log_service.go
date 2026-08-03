package service

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/model"
)

func (s *WikiIngestV2Service) recordWikiDocumentLog(ctx context.Context, in WikiIngestV2MapDocumentInput, result *WikiIngestV2MapDocumentResult, updates []WikiSlugUpdate) error {
	if s == nil || s.db == nil || result == nil {
		return nil
	}
	var library model.Library
	if err := s.db.WithContext(ctx).Where("eid = ? AND id = ?", in.Eid, in.LibraryID).First(&library).Error; err != nil {
		return fmt.Errorf("读取 wiki 知识库信息失败: %w", err)
	}
	knowledgeID, err := hashids.Encode(in.FileID)
	if err != nil {
		return fmt.Errorf("编码 wiki 文档 ID 失败: %w", err)
	}

	action := "ingest"
	slugSet := make(map[string]struct{})
	for _, update := range updates {
		if strings.EqualFold(update.PageType, "retract") || strings.EqualFold(update.PageType, "retractStale") {
			action = "retract"
		}
		if slug := strings.TrimSpace(update.Slug); slug != "" {
			slugSet[slug] = struct{}{}
		}
	}
	pages := make([]WikiDocumentLogPage, 0, len(result.CitationResults))
	for _, citation := range result.CitationResults {
		slug := strings.TrimSpace(citation.Slug)
		if slug == "" {
			continue
		}
		slugSet[slug] = struct{}{}
		pages = append(pages, WikiDocumentLogPage{Slug: slug, Title: strings.TrimSpace(citation.Title)})
	}
	for _, slug := range result.CandidateSlugs {
		if slug = strings.TrimSpace(slug); slug != "" {
			slugSet[slug] = struct{}{}
		}
	}
	var wikiPages []model.WikiPage
	if len(slugSet) > 0 {
		slugs := make([]string, 0, len(slugSet))
		for slug := range slugSet {
			slugs = append(slugs, slug)
		}
		if err := s.db.WithContext(ctx).Where("eid = ? AND library_id = ? AND slug IN ?", in.Eid, in.LibraryID, slugs).Find(&wikiPages).Error; err != nil {
			return fmt.Errorf("读取 wiki 受影响页面失败: %w", err)
		}
	}
	pageBySlug := make(map[string]WikiDocumentLogPage, len(pages)+len(wikiPages))
	for _, page := range pages {
		pageBySlug[page.Slug] = page
	}
	for _, page := range wikiPages {
		pageBySlug[page.Slug] = WikiDocumentLogPage{Slug: page.Slug, Title: page.Title}
	}
	pages = pages[:0]
	slugs := make([]string, 0, len(pageBySlug))
	for slug := range pageBySlug {
		slugs = append(slugs, slug)
	}
	sort.Strings(slugs)
	for _, slug := range slugs {
		pages = append(pages, pageBySlug[slug])
	}
	logPages, err := json.Marshal(pages)
	if err != nil {
		return fmt.Errorf("编码 wiki 受影响页面失败: %w", err)
	}
	summary := strings.TrimSpace(result.SummaryLine)
	if summary == "" {
		summary = truncateWikiText(result.SummaryBody, 512)
	}
	return s.db.WithContext(ctx).Create(&model.WikiLogEntry{
		Eid:             in.Eid,
		KnowledgeBaseID: library.UUID,
		KnowledgeID:     knowledgeID,
		DocTitle:        strings.TrimSpace(in.Title),
		Summary:         summary,
		PagesAffected:   string(logPages),
		PageID:          0,
		Action:          action,
	}).Error
}
