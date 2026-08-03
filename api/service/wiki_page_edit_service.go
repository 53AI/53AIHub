package service

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

var (
	ErrWikiPageNotFound   = errors.New("wiki page not found")
	ErrWikiPageSlugExists = errors.New("wiki page slug already exists")
)

type WikiPageSourceInput struct {
	SourceKind        string `json:"source_kind"`
	SourceRef         string `json:"source_ref"`
	SourceFileID      int64  `json:"source_file_id"`
	SourceChunkID     int64  `json:"source_chunk_id"`
	SourceSlug        string `json:"source_slug"`
	SourceLocation    string `json:"source_location"`
	SourceContentHash string `json:"source_content_hash"`
	SourceURL         string `json:"source_url"`
	ExternalID        string `json:"external_id"`
	ExternalDigest    string `json:"external_digest"`
	MetaJSON          string `json:"meta_json"`
	LastSyncedTime    int64  `json:"last_synced_time"`
	CreatorID         int64  `json:"creator_id"`
}

type WikiCreatePageRequest struct {
	Eid          int64                 `json:"eid"`
	LibraryID    int64                 `json:"library_id"`
	PageType     string                `json:"page_type"`
	Slug         string                `json:"slug"`
	Title        string                `json:"title"`
	Summary      string                `json:"summary"`
	Content      string                `json:"content"`
	Aliases      []string              `json:"aliases,omitempty"`
	Visibility   string                `json:"visibility"`
	FolderID     int64                 `json:"folder_id"`
	CreatorID    int64                 `json:"creator_id"`
	ChangeReason string                `json:"change_reason"`
	Sources      []WikiPageSourceInput `json:"sources"`
}

type WikiUpdatePageRequest struct {
	Eid          int64                 `json:"eid"`
	LibraryID    int64                 `json:"library_id"`
	Slug         string                `json:"slug"`
	PageType     string                `json:"page_type"`
	Title        string                `json:"title"`
	Summary      string                `json:"summary"`
	Content      string                `json:"content"`
	Aliases      []string              `json:"aliases,omitempty"`
	Visibility   string                `json:"visibility"`
	FolderID     int64                 `json:"folder_id"`
	UpdaterID    int64                 `json:"updater_id"`
	ChangeReason string                `json:"change_reason"`
	Sources      []WikiPageSourceInput `json:"sources"`
}

type WikiRenamePageRequest struct {
	Eid          int64  `json:"eid"`
	LibraryID    int64  `json:"library_id"`
	Slug         string `json:"slug"`
	NewSlug      string `json:"new_slug"`
	NewTitle     string `json:"new_title"`
	ChangeReason string `json:"change_reason"`
	UpdaterID    int64  `json:"updater_id"`
}

type WikiMovePageRequest struct {
	Eid          int64  `json:"eid"`
	LibraryID    int64  `json:"library_id"`
	Slug         string `json:"slug"`
	FolderID     int64  `json:"folder_id"`
	ChangeReason string `json:"change_reason"`
	UpdaterID    int64  `json:"updater_id"`
}

type WikiArchivePageRequest struct {
	Eid          int64  `json:"eid"`
	LibraryID    int64  `json:"library_id"`
	Slug         string `json:"slug"`
	ChangeReason string `json:"change_reason"`
	UpdaterID    int64  `json:"updater_id"`
}

type WikiDeletePageRequest struct {
	Eid          int64  `json:"eid"`
	LibraryID    int64  `json:"library_id"`
	Slug         string `json:"slug"`
	ChangeReason string `json:"change_reason"`
	UpdaterID    int64  `json:"updater_id"`
}

type WikiPublishVersionRequest struct {
	Eid        int64  `json:"eid"`
	PageID     int64  `json:"page_id"`
	VersionNo  int64  `json:"version_no"`
	EditorID   int64  `json:"editor_id"`
	VersionTag string `json:"version_tag"`
}

type WikiUpdateVersionTagRequest struct {
	Eid        int64
	PageID     int64
	VersionNo  int64
	EditorID   int64
	VersionTag string `json:"version_tag"`
}

type WikiPageWriteResult struct {
	Action    string           `json:"action"`
	OldSlug   string           `json:"old_slug,omitempty"`
	NewSlug   string           `json:"new_slug,omitempty"`
	Page      *WikiPageSummary `json:"page,omitempty"`
	VersionID int64            `json:"version_id,omitempty"`
	VersionNo int64            `json:"version_no,omitempty"`
}

type WikiPageEditService interface {
	CreatePage(ctx context.Context, req WikiCreatePageRequest) (*WikiPageWriteResult, error)
	UpdatePage(ctx context.Context, req WikiUpdatePageRequest) (*WikiPageWriteResult, error)
	RenamePage(ctx context.Context, req WikiRenamePageRequest) (*WikiPageWriteResult, error)
	MovePage(ctx context.Context, req WikiMovePageRequest) (*WikiPageWriteResult, error)
	ArchivePage(ctx context.Context, req WikiArchivePageRequest) (*WikiPageWriteResult, error)
	DeletePage(ctx context.Context, req WikiDeletePageRequest) (*WikiPageWriteResult, error)
	PublishVersion(ctx context.Context, req WikiPublishVersionRequest) (*WikiPageVersionDTO, error)
	UpdateVersionTag(ctx context.Context, req WikiUpdateVersionTagRequest) (*WikiPageVersionDTO, error)
}

type wikiPageEditService struct {
	db *gorm.DB
}

func NewWikiPageEditService(db *gorm.DB) WikiPageEditService {
	return &wikiPageEditService{db: db}
}

func (s *wikiPageEditService) CreatePage(ctx context.Context, req WikiCreatePageRequest) (*WikiPageWriteResult, error) {
	if err := validateWikiPageWriteRequest(req.Eid, req.LibraryID, req.PageType, req.Title, req.Content); err != nil {
		return nil, err
	}

	pageType := strings.TrimSpace(req.PageType)
	title := strings.TrimSpace(req.Title)
	content := strings.TrimSpace(req.Content)
	normalizedContent, err := normalizeWikiInlineSources(content)
	if err != nil {
		return nil, err
	}
	content = normalizedContent.Body
	summary := strings.TrimSpace(req.Summary)
	if summary == "" {
		summary = truncateWikiText(firstParagraph(content), 220)
	}
	if strings.TrimSpace(req.Visibility) == "" {
		req.Visibility = model.WikiPageVisibilityWorkspace
	}

	page := &model.WikiPage{
		Eid:        req.Eid,
		LibraryID:  req.LibraryID,
		FolderID:   req.FolderID,
		Title:      title,
		Slug:       buildWikiPageScopedSlug(pageType, req.Slug, title),
		PageType:   pageType,
		Body:       content,
		BodyFormat: model.WikiPageBodyFormatMarkdown,
		Summary:    summary,
		Aliases:    normalizeWikiPageAliases(req.Aliases),
		Status:     model.WikiPageStatusActive,
		Visibility: firstNonEmpty(req.Visibility, model.WikiPageVisibilityWorkspace),
		CreatorID:  req.CreatorID,
		UpdaterID:  req.CreatorID,
	}
	var library model.Library
	if err := s.db.WithContext(ctx).
		Where("eid = ? AND id = ?", req.Eid, req.LibraryID).
		First(&library).Error; err == nil {
		page.SpaceID = library.SpaceID
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	if page.Slug == "" {
		return nil, fmt.Errorf("slug is required")
	}

	var result *WikiPageWriteResult
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := ensureWikiPageSlugAvailable(tx, req.Eid, req.LibraryID, page.Slug, 0); err != nil {
			return err
		}

		sources, err := buildWikiPageSources(req.Eid, req.CreatorID, 0, page.Slug, req.Sources)
		if err != nil {
			return err
		}
		sources = mergeWikiPageSources(sources, wikiPageSourcesForWrite(normalizedContent.Sources, req.Eid, req.CreatorID, 0))
		if err := validateWikiPageSourceFiles(tx, req.Eid, req.CreatorID, sources); err != nil {
			return err
		}
		linkedContent, _, err := linkifyWikiPageContent(tx, req.Eid, req.LibraryID, page.Slug, page.Body)
		if err != nil {
			return err
		}
		page.Body = linkedContent
		links := buildWikiPageContentLinks(0, req.Eid, req.LibraryID, page.Body, nil, tx, req.CreatorID)
		if err := persistWikiPageWrite(ctx, tx, page, sources, links, "create"); err != nil {
			return err
		}
		if err := upsertWikiPageLog(tx, page, page.CurrentVersionID, req.CreatorID, "create", req.ChangeReason, map[string]any{
			"slug": page.Slug,
		}); err != nil {
			return err
		}
		result = wikiWriteResult("create", "", page.Slug, page, page.CurrentVersionID, 0)
		return nil
	})
	if err != nil {
		return nil, err
	}
	if err := s.refreshWikiCrossLinks(ctx, req.Eid, req.LibraryID); err != nil {
		logger.Warnf(ctx, "wiki: cross-link refresh after create failed: %v", err)
	}
	return result, nil
}

func (s *wikiPageEditService) UpdatePage(ctx context.Context, req WikiUpdatePageRequest) (*WikiPageWriteResult, error) {
	if err := validateWikiPageWriteRequest(req.Eid, req.LibraryID, req.PageType, req.Title, req.Content); err != nil {
		return nil, err
	}

	title := strings.TrimSpace(req.Title)
	content := strings.TrimSpace(req.Content)
	normalizedContent, err := normalizeWikiInlineSources(content)
	if err != nil {
		return nil, err
	}
	content = normalizedContent.Body
	summary := strings.TrimSpace(req.Summary)
	if summary == "" {
		summary = truncateWikiText(firstParagraph(content), 220)
	}

	var result *WikiPageWriteResult
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		page, err := loadWikiPageForEdit(tx, req.Eid, req.LibraryID, req.Slug)
		if err != nil {
			return err
		}
		if page == nil {
			return ErrWikiPageNotFound
		}

		page.PageType = firstNonEmpty(strings.TrimSpace(req.PageType), page.PageType)
		page.Title = title
		page.Body = content
		page.BodyFormat = model.WikiPageBodyFormatMarkdown
		page.Summary = summary
		if req.Aliases != nil {
			page.Aliases = normalizeWikiPageAliases(req.Aliases)
		}
		page.Visibility = firstNonEmpty(strings.TrimSpace(req.Visibility), page.Visibility, model.WikiPageVisibilityWorkspace)
		page.FolderID = req.FolderID
		page.UpdaterID = req.UpdaterID

		linkedContent, _, err := linkifyWikiPageContent(tx, req.Eid, req.LibraryID, page.Slug, page.Body)
		if err != nil {
			return err
		}
		page.Body = linkedContent

		sources, err := buildWikiPageSources(req.Eid, req.UpdaterID, page.ID, page.Slug, req.Sources)
		if err != nil {
			return err
		}
		existingSources, err := cloneWikiPageSources(tx, page.ID, req.UpdaterID)
		if err != nil {
			return err
		}
		if req.Sources != nil {
			existingSources = retainWikiAutomaticSources(existingSources)
		}
		sources = mergeWikiPageSources(existingSources, sources)
		sources = mergeWikiPageSources(sources, wikiPageSourcesForWrite(normalizedContent.Sources, req.Eid, req.UpdaterID, page.ID))
		if sources == nil {
			// An explicit empty sources array intentionally clears manual sources.
			sources = []model.WikiPageSource{}
		}
		if err := validateWikiPageSourceFiles(tx, req.Eid, req.UpdaterID, sources); err != nil {
			return err
		}
		links := buildWikiPageContentLinks(page.ID, req.Eid, req.LibraryID, page.Body, nil, tx, req.UpdaterID)
		if err := persistWikiPageWrite(ctx, tx, page, sources, links, "update"); err != nil {
			return err
		}
		// PUT 的语义是保存并发布新版本。发布状态必须在同一事务内写入，
		// 这样事务提交后异步向量化任务才能读取到可处理的已发布版本。
		now := time.Now().UnixMilli()
		if err := tx.Model(&model.WikiPageVersion{}).
			Where("eid = ? AND page_id = ? AND id = ?", req.Eid, page.ID, page.CurrentVersionID).
			Updates(map[string]any{
				"is_published":   true,
				"publish_kind":   model.WikiPagePublishKindManual,
				"published_time": now,
			}).Error; err != nil {
			return err
		}
		if err := upsertWikiPageLog(tx, page, page.CurrentVersionID, req.UpdaterID, "update", req.ChangeReason, map[string]any{
			"slug": page.Slug,
		}); err != nil {
			return err
		}
		result = wikiWriteResult("update", "", page.Slug, page, page.CurrentVersionID, 0)
		return nil
	})
	if err != nil {
		return nil, err
	}
	if err := s.refreshWikiCrossLinks(ctx, req.Eid, req.LibraryID); err != nil {
		logger.Warnf(ctx, "wiki: cross-link refresh after update failed: %v", err)
	}
	if result != nil && result.Page != nil && result.VersionID > 0 {
		if _, enqueueErr := createWikiPageVectorizationJob(ctx, s.db, common.RDB, req.Eid, result.Page.ID, result.VersionID, false, "manual_update"); enqueueErr != nil {
			logger.Warnf(ctx, "【Wiki向量化】编辑后创建任务失败: eid=%d page_id=%d version_id=%d err=%v", req.Eid, result.Page.ID, result.VersionID, enqueueErr)
		}
	}
	return result, nil
}

func (s *wikiPageEditService) RenamePage(ctx context.Context, req WikiRenamePageRequest) (*WikiPageWriteResult, error) {
	if req.Eid <= 0 || req.LibraryID <= 0 {
		return nil, fmt.Errorf("eid and library_id are required")
	}
	if strings.TrimSpace(req.Slug) == "" {
		return nil, fmt.Errorf("slug is required")
	}

	var result *WikiPageWriteResult
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		page, err := loadWikiPageForEdit(tx, req.Eid, req.LibraryID, req.Slug)
		if err != nil {
			return err
		}
		if page == nil {
			return ErrWikiPageNotFound
		}

		oldSlug := page.Slug
		newTitle := firstNonEmpty(strings.TrimSpace(req.NewTitle), page.Title)
		newSlug := buildWikiPageScopedSlug(page.PageType, req.NewSlug, newTitle)
		if newSlug == "" {
			return fmt.Errorf("new slug is required")
		}
		if err := ensureWikiPageSlugAvailable(tx, req.Eid, req.LibraryID, newSlug, page.ID); err != nil {
			return err
		}

		page.Title = newTitle
		page.Slug = newSlug
		page.UpdaterID = req.UpdaterID

		sources, err := cloneWikiPageSources(tx, page.ID, req.UpdaterID)
		if err != nil {
			return err
		}
		links, err := cloneWikiPageLinks(tx, page.ID, req.UpdaterID, oldSlug, newSlug)
		if err != nil {
			return err
		}
		if err := persistWikiPageWrite(ctx, tx, page, sources, links, "rename"); err != nil {
			return err
		}
		if err := upsertWikiPageRedirect(tx, page, oldSlug); err != nil {
			return err
		}
		if err := updateWikiPageIncomingLinkTargets(tx, req.Eid, req.LibraryID, page.ID, oldSlug, newSlug); err != nil {
			return err
		}
		if err := upsertWikiPageLog(tx, page, page.CurrentVersionID, req.UpdaterID, "rename", req.ChangeReason, map[string]any{
			"old_slug": oldSlug,
			"new_slug": newSlug,
		}); err != nil {
			return err
		}
		result = wikiWriteResult("rename", oldSlug, newSlug, page, page.CurrentVersionID, 0)
		return nil
	})
	if err != nil {
		return nil, err
	}
	if err := s.refreshWikiCrossLinks(ctx, req.Eid, req.LibraryID); err != nil {
		logger.Warnf(ctx, "wiki: cross-link refresh after rename failed: %v", err)
	}
	return result, nil
}

func (s *wikiPageEditService) MovePage(ctx context.Context, req WikiMovePageRequest) (*WikiPageWriteResult, error) {
	if req.Eid <= 0 || req.LibraryID <= 0 {
		return nil, fmt.Errorf("eid and library_id are required")
	}
	if strings.TrimSpace(req.Slug) == "" {
		return nil, fmt.Errorf("slug is required")
	}

	var result *WikiPageWriteResult
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		page, err := loadWikiPageForEdit(tx, req.Eid, req.LibraryID, req.Slug)
		if err != nil {
			return err
		}
		if page == nil {
			return ErrWikiPageNotFound
		}

		page.FolderID = req.FolderID
		page.UpdaterID = req.UpdaterID

		sources, err := cloneWikiPageSources(tx, page.ID, req.UpdaterID)
		if err != nil {
			return err
		}
		links, err := cloneWikiPageLinks(tx, page.ID, req.UpdaterID, page.Slug, page.Slug)
		if err != nil {
			return err
		}
		if err := persistWikiPageWrite(ctx, tx, page, sources, links, "move"); err != nil {
			return err
		}
		if err := upsertWikiPageLog(tx, page, page.CurrentVersionID, req.UpdaterID, "move", req.ChangeReason, map[string]any{
			"folder_id": req.FolderID,
		}); err != nil {
			return err
		}
		result = wikiWriteResult("move", "", page.Slug, page, page.CurrentVersionID, 0)
		return nil
	})
	if err != nil {
		return nil, err
	}
	if err := s.refreshWikiCrossLinks(ctx, req.Eid, req.LibraryID); err != nil {
		logger.Warnf(ctx, "wiki: cross-link refresh after move failed: %v", err)
	}
	return result, nil
}

func (s *wikiPageEditService) ArchivePage(ctx context.Context, req WikiArchivePageRequest) (*WikiPageWriteResult, error) {
	return s.archiveOrDeletePage(ctx, req.Eid, req.LibraryID, req.Slug, req.UpdaterID, req.ChangeReason, "archive")
}

func (s *wikiPageEditService) DeletePage(ctx context.Context, req WikiDeletePageRequest) (*WikiPageWriteResult, error) {
	return s.archiveOrDeletePage(ctx, req.Eid, req.LibraryID, req.Slug, req.UpdaterID, req.ChangeReason, "delete")
}

func (s *wikiPageEditService) archiveOrDeletePage(ctx context.Context, eid, libraryID int64, slug string, updaterID int64, reason string, action string) (*WikiPageWriteResult, error) {
	if eid <= 0 || libraryID <= 0 {
		return nil, fmt.Errorf("eid and library_id are required")
	}
	if strings.TrimSpace(slug) == "" {
		return nil, fmt.Errorf("slug is required")
	}

	var result *WikiPageWriteResult
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		page, err := loadWikiPageForEdit(tx, eid, libraryID, slug)
		if err != nil {
			return err
		}
		if page == nil {
			return ErrWikiPageNotFound
		}

		page.Status = model.WikiPageStatusArchived
		page.UpdaterID = updaterID

		sources, err := cloneWikiPageSources(tx, page.ID, updaterID)
		if err != nil {
			return err
		}
		links, err := cloneWikiPageLinks(tx, page.ID, updaterID, page.Slug, page.Slug)
		if err != nil {
			return err
		}
		if err := persistWikiPageWrite(ctx, tx, page, sources, links, action); err != nil {
			return err
		}
		if err := upsertWikiPageLog(tx, page, page.CurrentVersionID, updaterID, action, reason, nil); err != nil {
			return err
		}
		result = wikiWriteResult(action, "", page.Slug, page, page.CurrentVersionID, 0)
		return nil
	})
	if err != nil {
		return nil, err
	}
	if err := s.refreshWikiCrossLinks(ctx, eid, libraryID); err != nil {
		logger.Warnf(ctx, "wiki: cross-link refresh after %s failed: %v", action, err)
	}
	return result, nil
}

func normalizeWikiPageAliases(aliases []string) []string {
	if len(aliases) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(aliases))
	normalized := make([]string, 0, len(aliases))
	for _, alias := range aliases {
		alias = strings.TrimSpace(alias)
		if alias == "" {
			continue
		}
		if _, ok := seen[alias]; ok {
			continue
		}
		seen[alias] = struct{}{}
		normalized = append(normalized, alias)
	}
	return normalized
}

func (s *wikiPageEditService) refreshWikiCrossLinks(ctx context.Context, eid, libraryID int64) error {
	if s == nil || s.db == nil || eid <= 0 || libraryID <= 0 {
		return nil
	}

	refs, liveTitles, liveSlugSet, redirectTargets, err := loadWikiPostProcessRefs(ctx, s.db, eid, libraryID)
	if err != nil {
		return err
	}
	if len(refs) == 0 && len(redirectTargets) == 0 {
		return nil
	}

	var pages []model.WikiPage
	if err := s.db.WithContext(ctx).
		Where("eid = ? AND library_id = ? AND status = ? AND page_type IN ?", eid, libraryID, model.WikiPageStatusActive, []string{
			model.WikiPageTypeSummary,
			model.WikiPageTypeEntity,
			model.WikiPageTypeConcept,
		}).
		Find(&pages).Error; err != nil {
		return err
	}
	if len(pages) == 0 {
		return nil
	}

	updated := 0
	for _, page := range pages {
		if page.PageType == model.WikiPageTypeIndex || page.PageType == model.WikiPageTypeLog {
			continue
		}
		rewritten, changed := rewriteDeadWikiLinks(page.Body, liveTitles, liveSlugSet, redirectTargets)
		if linked, ok := linkifyWikiContent(rewritten, refs, page.Slug); ok {
			rewritten = linked
			changed = true
		}
		if !changed {
			continue
		}
		if err := s.persistAutoLinkedPageBody(ctx, &page, rewritten); err != nil {
			logger.Warnf(ctx, "wiki: cross-link refresh failed for %s: %v", page.Slug, err)
			continue
		}
		updated++
	}

	if updated > 0 {
		logger.Infof(ctx, "wiki: refreshed cross-links in %d pages", updated)
	}
	return nil
}

func (s *wikiPageEditService) persistAutoLinkedPageBody(ctx context.Context, page *model.WikiPage, body string) error {
	if s == nil || s.db == nil || page == nil {
		return nil
	}
	body = strings.TrimSpace(body)
	if body == "" {
		return nil
	}

	page.Body = body
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Save(page).Error; err != nil {
			return err
		}
		if err := tx.Where("from_page_id = ?", page.ID).Delete(&model.WikiPageLink{}).Error; err != nil {
			return err
		}
		links := buildWikiPageContentLinks(page.ID, page.Eid, page.LibraryID, page.Body, nil, tx, page.UpdaterID)
		if len(links) > 0 {
			if err := tx.Create(&links).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func validateWikiPageWriteRequest(eid, libraryID int64, pageType, title, content string) error {
	if eid <= 0 || libraryID <= 0 {
		return fmt.Errorf("eid and library_id are required")
	}
	if strings.TrimSpace(pageType) == "" {
		return fmt.Errorf("page_type is required")
	}
	if strings.TrimSpace(title) == "" {
		return fmt.Errorf("title is required")
	}
	if strings.TrimSpace(content) == "" {
		return fmt.Errorf("content is required")
	}
	return nil
}

func ensureWikiPageSlugAvailable(tx *gorm.DB, eid, libraryID int64, slug string, excludeID int64) error {
	var page model.WikiPage
	err := tx.Where("eid = ? AND library_id = ? AND slug = ?", eid, libraryID, slug).First(&page).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	if excludeID > 0 && page.ID == excludeID {
		return nil
	}
	return ErrWikiPageSlugExists
}

func loadWikiPageForEdit(tx *gorm.DB, eid, libraryID int64, slug string) (*model.WikiPage, error) {
	var page model.WikiPage
	err := tx.Where("eid = ? AND library_id = ? AND slug = ?", eid, libraryID, strings.TrimSpace(slug)).First(&page).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &page, nil
}

func cloneWikiPageSources(tx *gorm.DB, pageID, creatorID int64) ([]model.WikiPageSource, error) {
	var sources []model.WikiPageSource
	if err := tx.Where("page_id = ?", pageID).Find(&sources).Error; err != nil {
		return nil, err
	}
	for i := range sources {
		sources[i].ID = 0
		sources[i].CreatorID = creatorID
	}
	return sources, nil
}

func cloneWikiPageLinks(tx *gorm.DB, pageID, creatorID int64, oldSlug, newSlug string) ([]model.WikiPageLink, error) {
	var links []model.WikiPageLink
	if err := tx.Where("from_page_id = ?", pageID).Find(&links).Error; err != nil {
		return nil, err
	}
	for i := range links {
		links[i].ID = 0
		links[i].CreatorID = creatorID
		if strings.TrimSpace(newSlug) != "" && links[i].TargetSlug == oldSlug {
			links[i].TargetSlug = newSlug
		}
	}
	return links, nil
}

func buildWikiPageContentLinks(pageID, eid, libraryID int64, content string, svc *WikiLinkService, db *gorm.DB, creatorID int64) []model.WikiPageLink {
	if strings.TrimSpace(content) == "" {
		return nil
	}
	if svc == nil {
		svc = NewWikiLinkService()
	}
	return svc.BuildPageLinks(svc.ExtractWikiLinkTargets(content), pageID, eid, libraryID, creatorID, db)
}

func upsertWikiPageRedirect(tx *gorm.DB, page *model.WikiPage, fromSlug string) error {
	if tx == nil || page == nil {
		return nil
	}
	fromSlug = strings.TrimSpace(fromSlug)
	if fromSlug == "" || fromSlug == page.Slug {
		return nil
	}
	redirect := model.WikiPageRedirect{
		Eid:       page.Eid,
		LibraryID: page.LibraryID,
		FromSlug:  fromSlug,
		ToPageID:  page.ID,
		ToSlug:    page.Slug,
		Status:    model.WikiRedirectStatusActive,
		CreatorID: page.UpdaterID,
	}
	return tx.Where("eid = ? AND library_id = ? AND from_slug = ?", page.Eid, page.LibraryID, fromSlug).
		Assign(&redirect).
		FirstOrCreate(&redirect).Error
}

func updateWikiPageIncomingLinkTargets(tx *gorm.DB, eid, libraryID, pageID int64, oldSlug, newSlug string) error {
	if tx == nil || pageID <= 0 || oldSlug == newSlug {
		return nil
	}
	if err := tx.Model(&model.WikiPageLink{}).
		Where("eid = ? AND to_page_id = ?", eid, pageID).
		Update("target_slug", newSlug).Error; err != nil {
		return err
	}
	return tx.Model(&model.WikiPageLink{}).
		Where("eid = ? AND target_slug = ?", eid, oldSlug).
		Update("target_slug", newSlug).Error
}

func upsertWikiPageLog(tx *gorm.DB, page *model.WikiPage, versionID, actorID int64, action, reason string, meta map[string]any) error {
	if tx == nil || page == nil {
		return nil
	}
	logEntry := model.WikiLogEntry{
		Eid:       page.Eid,
		PageID:    page.ID,
		VersionID: versionID,
		ActorID:   actorID,
		Action:    action,
		RequestID: "",
		Message:   strings.TrimSpace(reason),
	}
	if len(meta) > 0 {
		raw, err := json.Marshal(meta)
		if err == nil {
			logEntry.MetaJSON = string(raw)
		}
	}
	return tx.Create(&logEntry).Error
}

func truncateWikiText(value string, max int) string {
	value = strings.TrimSpace(value)
	if value == "" || max <= 0 {
		return value
	}
	runes := []rune(value)
	if len(runes) <= max {
		return value
	}
	return strings.TrimSpace(string(runes[:max]))
}

func firstParagraph(content string) string {
	content = strings.TrimSpace(content)
	if content == "" {
		return ""
	}
	parts := strings.Split(content, "\n\n")
	if len(parts) == 0 {
		return content
	}
	return strings.TrimSpace(parts[0])
}

func buildWikiPageScopedSlug(pageType, rawSlug, title string) string {
	if slug := normalizeWikiScopedSlug(rawSlug); slug != "" {
		if strings.Contains(slug, "/") {
			return slug
		}
		if pageType != "" {
			return normalizeWikiScopedSlug(pageType + "/" + slug)
		}
		return slug
	}
	pageType = firstNonEmpty(normalizeWikiScopedSlug(pageType), "page")
	titleSlug := model.NormalizeWikiPageSlug(title)
	if titleSlug == "" || titleSlug == "page" {
		titleSlug = "page-" + wikiShortHash(title)
	}
	return normalizeWikiScopedSlug(pageType + "/" + titleSlug)
}

func normalizeWikiScopedSlug(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	parts := strings.Split(raw, "/")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		normalized := model.NormalizeWikiPageSlug(part)
		if normalized == "" {
			normalized = "page"
		}
		out = append(out, normalized)
	}
	return strings.Join(out, "/")
}

func wikiShortHash(input string) string {
	sum := sha1.Sum([]byte(strings.TrimSpace(input)))
	return hex.EncodeToString(sum[:4])
}

func (s *wikiPageEditService) PublishVersion(ctx context.Context, req WikiPublishVersionRequest) (*WikiPageVersionDTO, error) {
	if s == nil || s.db == nil {
		return nil, fmt.Errorf("wiki edit db is required")
	}
	if req.Eid <= 0 || req.PageID <= 0 || req.VersionNo <= 0 || req.EditorID <= 0 {
		return nil, fmt.Errorf("eid, page_id, version_no and editor_id are required")
	}

	var page model.WikiPage
	if err := s.db.WithContext(ctx).Where("eid = ? AND id = ?", req.Eid, req.PageID).First(&page).Error; err != nil {
		return nil, err
	}

	var version model.WikiPageVersion
	if err := s.db.WithContext(ctx).Where("eid = ? AND page_id = ? AND version_no = ?", req.Eid, req.PageID, req.VersionNo).First(&version).Error; err != nil {
		return nil, err
	}

	now := time.Now().UnixMilli()
	if err := s.db.WithContext(ctx).Model(&version).Updates(map[string]any{
		"is_published":   true,
		"publish_kind":   model.WikiPagePublishKindManual,
		"published_time": now,
		"version_tag":    req.VersionTag,
	}).Error; err != nil {
		return nil, err
	}

	if err := upsertWikiPageLog(s.db.WithContext(ctx), &page, version.ID, req.EditorID, "publish", "", map[string]any{
		"version_no": req.VersionNo,
	}); err != nil {
		return nil, err
	}

	dto := toWikiPageVersionDTO(&version)
	dto.IsPublished = true
	dto.PublishKind = model.WikiPagePublishKindManual
	dto.PublishedTime = now
	if _, enqueueErr := createWikiPageVectorizationJob(ctx, s.db, common.RDB, req.Eid, page.ID, version.ID, false, "manual_publish"); enqueueErr != nil {
		logger.Errorf(ctx, "【Wiki向量化】手动发布后创建任务失败: eid=%d page_id=%d version_id=%d err=%v", req.Eid, page.ID, version.ID, enqueueErr)
	}
	return &dto, nil
}

func (s *wikiPageEditService) UpdateVersionTag(ctx context.Context, req WikiUpdateVersionTagRequest) (*WikiPageVersionDTO, error) {
	if s == nil || s.db == nil {
		return nil, fmt.Errorf("wiki edit db is required")
	}
	if req.Eid <= 0 || req.PageID <= 0 || req.VersionNo <= 0 || req.EditorID <= 0 {
		return nil, fmt.Errorf("eid, page_id, version_no and editor_id are required")
	}

	var version model.WikiPageVersion
	if err := s.db.WithContext(ctx).Where("eid = ? AND page_id = ? AND version_no = ?", req.Eid, req.PageID, req.VersionNo).First(&version).Error; err != nil {
		return nil, err
	}

	if err := s.db.WithContext(ctx).Model(&version).Update("version_tag", req.VersionTag).Error; err != nil {
		return nil, err
	}

	dto := toWikiPageVersionDTO(&version)
	dto.VersionTag = req.VersionTag
	return &dto, nil
}

func wikiWriteResult(action, oldSlug, newSlug string, page *model.WikiPage, versionID, versionNo int64) *WikiPageWriteResult {
	result := &WikiPageWriteResult{
		Action:    action,
		OldSlug:   oldSlug,
		NewSlug:   newSlug,
		VersionID: versionID,
		VersionNo: versionNo,
	}
	if page != nil {
		summary := toWikiPageSummary(page, "")
		result.Page = &summary
	}
	return result
}
