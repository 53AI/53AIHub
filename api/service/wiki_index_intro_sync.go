package service

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

const wikiIndexIntroSlug = "index/main"

func (s *WikiIngestV2Service) syncWikiIndexIntro(ctx context.Context, in WikiIngestV2MapDocumentInput, spaceID int64, result *WikiIngestV2MapDocumentResult) error {
	if s == nil || s.db == nil || s.index == nil {
		return nil
	}

	// 未关联空间时回退到原 per-library 行为
	anchorLibraryID := in.LibraryID
	summaryLibraryIDs := []int64{in.LibraryID}

	if spaceID > 0 {
		anchorLib, spaceLibs, err := s.resolveSpaceIndexAnchor(ctx, in.Eid, spaceID)
		if err != nil {
			return err
		}
		if anchorLib > 0 {
			anchorLibraryID = anchorLib
			summaryLibraryIDs = spaceLibs
		}
	}

	summaryDocuments, err := s.loadWikiIndexSummaryDocuments(ctx, in.Eid, summaryLibraryIDs)
	if err != nil {
		return err
	}
	if result != nil {
		if summaryDoc := buildWikiIndexIntroSummaryDocument(in.Title, result.SummaryLine, result.SummaryBody); summaryDoc != "" {
			summaryDocuments = append([]string{summaryDoc}, summaryDocuments...)
		}
	}
	if len(summaryDocuments) == 0 {
		summaryDocuments = []string{"(no documents yet)"}
	}

	page, err := loadWikiPageForWrite(s.db, in.Eid, anchorLibraryID, wikiIndexIntroSlug)
	if err != nil {
		return err
	}

	changeDescription := fmt.Sprintf("Processed %s", strings.TrimSpace(in.Title))
	if result != nil && len(result.CandidateSlugs) > 0 {
		changeDescription = fmt.Sprintf("%s; candidate slugs: %s", changeDescription, strings.Join(result.CandidateSlugs, ", "))
	}

	input := WikiIndexIntroInput{
		Language:          normalizeWikiIndexLanguage(in.Language),
		DocumentSummaries: summaryDocuments,
		ChangeDescription: changeDescription,
	}

	var intro string
	if page == nil || strings.TrimSpace(page.Body) == "" {
		intro, err = s.index.GenerateIntro(ctx, input)
	} else {
		input.ExistingIntro = page.Body
		intro, err = s.index.UpdateIntro(ctx, input)
	}
	if err != nil {
		return err
	}

	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		page, err := loadWikiPageForWrite(tx, in.Eid, anchorLibraryID, wikiIndexIntroSlug)
		if err != nil {
			return err
		}
		var existingPage *model.WikiPage
		if page != nil {
			snapshot := *page
			existingPage = &snapshot
		}
		if page == nil {
			page = &model.WikiPage{
				Eid:        in.Eid,
				LibraryID:  anchorLibraryID,
				Slug:       wikiIndexIntroSlug,
				Title:      "Wiki Index",
				PageType:   model.WikiPageTypeIndex,
				BodyFormat: model.WikiPageBodyFormatMarkdown,
				Status:     model.WikiPageStatusActive,
				Visibility: model.WikiPageVisibilityWorkspace,
				CreatorID:  in.Eid,
				UpdaterID:  in.Eid,
			}
		}

		page.Title = firstNonEmpty(page.Title, "Wiki Index")
		page.PageType = model.WikiPageTypeIndex
		page.BodyFormat = model.WikiPageBodyFormatMarkdown
		page.Status = model.WikiPageStatusActive
		page.Visibility = model.WikiPageVisibilityWorkspace
		page.Summary = strings.TrimSpace(intro)
		page.Body = strings.TrimSpace(intro)
		page.UpdaterID = in.Eid

		if page.ID > 0 {
			existingSources, err := loadWikiPageSourcesForWrite(tx, page.ID)
			if err != nil {
				return err
			}
			if wikiPageWriteIsNoop(existingPage, page, existingSources, nil) {
				return nil
			}
		}

		return persistWikiPageWrite(ctx, tx, page, nil, nil, "index intro update")
	})
}

func (s *WikiIngestV2Service) loadWikiIndexSummaryDocuments(ctx context.Context, eid int64, libraryIDs []int64) ([]string, error) {
	if s == nil || s.db == nil {
		return nil, nil
	}
	if len(libraryIDs) == 0 {
		return nil, nil
	}


	var pages []model.WikiPage
	if err := s.db.WithContext(ctx).
		Model(&model.WikiPage{}).
		Select("title", "summary", "body").
		Where("eid = ? AND library_id IN ? AND status = ? AND page_type = ?", eid, libraryIDs, model.WikiPageStatusActive, model.WikiPageTypeSummary).
		Order("updated_time DESC, id DESC").
		Limit(20).
		Find(&pages).Error; err != nil {
		return nil, fmt.Errorf("load wiki summary documents: %w", err)
	}

	out := make([]string, 0, len(pages))
	for _, page := range pages {
		title := strings.TrimSpace(page.Title)
		if title == "" {
			title = "Untitled"
		}
		summary := strings.TrimSpace(page.Summary)
		if summary == "" {
			summary = truncateWikiIndexText(page.Body, 220)
		}
		if summary == "" {
			continue
		}
		out = append(out, fmt.Sprintf("SUMMARY: %s\n# %s\n\n%s", summary, title, summary))
	}
	return out, nil
}

// resolveSpaceIndexAnchor 解析空间内首个活跃知识库作为 index/main 页面的锚点库
// lazy: 按 sort 排序取第一个活跃库，如后续需要负载均衡可改为轮询或权重
func (s *WikiIngestV2Service) resolveSpaceIndexAnchor(ctx context.Context, eid, spaceID int64) (anchorLibraryID int64, allLibraryIDs []int64, err error) {
	if s == nil || s.db == nil {
		return 0, nil, nil
	}
	libraries, err := model.GetLibrariesBySpaceID(eid, spaceID)
	if err != nil {
		return 0, nil, fmt.Errorf("resolve space index anchor: %w", err)
	}

	sort.SliceStable(libraries, func(i, j int) bool {
		if libraries[i].Sort != libraries[j].Sort {
			return libraries[i].Sort < libraries[j].Sort
		}
		return libraries[i].ID < libraries[j].ID
	})

	ids := make([]int64, 0, len(libraries))
	for _, lib := range libraries {
		if lib.Status != model.LIBRARY_STATUS_ACTIVE {
			continue
		}
		ids = append(ids, lib.ID)
	}

	if len(ids) == 0 {
		return 0, nil, nil
	}

	return ids[0], ids, nil
}

func buildWikiIndexIntroSummaryDocument(title, summaryLine, summaryBody string) string {
	title = strings.TrimSpace(title)
	summaryLine = strings.TrimSpace(summaryLine)
	summaryBody = strings.TrimSpace(summaryBody)
	if title == "" && summaryLine == "" && summaryBody == "" {
		return ""
	}
	if title == "" {
		title = "Untitled"
	}
	if summaryLine == "" {
		summaryLine = truncateWikiIndexText(summaryBody, 220)
	}
	if summaryBody == "" {
		summaryBody = summaryLine
	}
	if summaryLine == "" && summaryBody == "" {
		return ""
	}
	return fmt.Sprintf("SUMMARY: %s\n# %s\n\n%s", summaryLine, title, summaryBody)
}

func truncateWikiIndexText(value string, max int) string {
	value = strings.TrimSpace(value)
	if max <= 0 || len(value) <= max {
		return value
	}
	if max <= 3 {
		return value[:max]
	}
	return strings.TrimSpace(value[:max-3]) + "..."
}
