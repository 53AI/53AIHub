package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

func (s *WikiIngestV2Service) reduceSlugUpdates(ctx context.Context, eid, libraryID, spaceID int64, slug string, updates []WikiSlugUpdate) (bool, error) {
	if len(updates) == 0 {
		return false, nil
	}
	folderID := firstWikiUpdateFolderID(updates)
	if isSummarySlug(slug) {
		return s.upsertSummaryPage(ctx, eid, libraryID, spaceID, slug, folderID, updates)
	}
	return s.upsertCompiledPage(ctx, eid, libraryID, spaceID, slug, folderID, updates)
}

func isSummarySlug(slug string) bool {
	return strings.HasPrefix(strings.TrimSpace(slug), "summary/")
}

func (s *WikiIngestV2Service) upsertSummaryPage(ctx context.Context, eid, libraryID, spaceID int64, slug string, folderID int64, updates []WikiSlugUpdate) (bool, error) {
	update := pickWikiSummaryUpdate(updates)
	if update == nil {
		return false, nil
	}

	changed := false
	err := s.db.Transaction(func(tx *gorm.DB) error {
		page, err := loadWikiPageForWrite(tx, eid, libraryID, slug)
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
				Eid:        eid,
				SpaceID:    spaceID,
				LibraryID:  libraryID,
				Slug:       slug,
				Title:      firstNonEmpty(update.Title, update.DocTitle, strings.TrimSpace(slug)),
				PageType:   model.WikiPageTypeSummary,
				BodyFormat: model.WikiPageBodyFormatMarkdown,
				Status:     model.WikiPageStatusDraft,
				Visibility: model.WikiPageVisibilityWorkspace,
				CreatorID:  update.Eid,
				UpdaterID:  update.Eid,
			}
		}

		page.Title = firstNonEmpty(update.Title, update.DocTitle, page.Title, strings.TrimSpace(slug))
		if page.SpaceID == 0 && spaceID > 0 {
			page.SpaceID = spaceID
		}
		page.PageType = model.WikiPageTypeSummary
		page.Body = firstNonEmpty(update.SummaryBody, update.Content)
		page.Summary = firstNonEmpty(update.SummaryLine, update.Summary)
		page.Aliases = mergeWikiStringSlices(page.Aliases, collectWikiUpdateAliasesList(updates))
		page.BodyFormat = model.WikiPageBodyFormatMarkdown
		page.Status = model.WikiPageStatusDraft
		page.Visibility = model.WikiPageVisibilityWorkspace
		page.UpdaterID = update.Eid
		page.FolderID = firstNonZeroInt64(folderID, update.FolderID, page.FolderID)

		linkedBody, _, err := linkifyWikiPageContent(tx, eid, libraryID, slug, page.Body)
		if err != nil {
			return err
		}
		page.Body = linkedBody

		if page.ID > 0 {
			existingSources, err := loadWikiPageSourcesForWrite(tx, page.ID)
			if err != nil {
				return err
			}
			candidateSources := buildWikiPageSourcesForUpdates(page.ID, eid, *update, model.WikiPageSourceKindImport)
			if wikiPageWriteIsNoop(existingPage, page, existingSources, candidateSources) {
				return nil
			}
		}

		sources := buildWikiPageSourcesForUpdates(0, eid, *update, model.WikiPageSourceKindImport)
		links := buildWikiPageLinksForContent(page.ID, eid, libraryID, page.Body, s.linkSvc, tx, update.Eid)
		if err := persistWikiPageWrite(ctx, tx, page, sources, links, "summary update"); err != nil {
			return err
		}
		if existingPage == nil {
			creatorUserID := update.Eid
			if update.SourceFileID > 0 {
				var f model.File
				if err := tx.Where("eid = ? AND id = ?", eid, update.SourceFileID).First(&f).Error; err == nil && f.UserID > 0 {
					creatorUserID = f.UserID
				}
			}
			perm := &model.Permission{
				Eid:          eid,
				ResourceType: model.RESOURCE_TYPE_WIKI_PAGE,
				ResourceID:   page.ID,
				SubjectType:  model.SUBJECT_TYPE_USER,
				SubjectID:    creatorUserID,
				Permission:   model.PERMISSION_MANAGE,
			}
			if err := tx.Create(perm).Error; err != nil {
				return err
			}
		}
		changed = true
		return nil
	})
	return changed, err
}

func (s *WikiIngestV2Service) upsertCompiledPage(ctx context.Context, eid, libraryID, spaceID int64, slug string, folderID int64, updates []WikiSlugUpdate) (bool, error) {
	additions, retracts := splitWikiSlugUpdateKinds(updates)
	if len(additions) == 0 && len(retracts) == 0 {
		return false, nil
	}

	snapshotPage, err := loadWikiPageForWrite(s.db, eid, libraryID, slug)
	if err != nil {
		return false, err
	}
	var snapshotSources []model.WikiPageSource
	if snapshotPage != nil {
		snapshotSources, err = loadWikiPageSourcesForWrite(s.db, snapshotPage.ID)
		if err != nil {
			return false, err
		}
	}

	if s.linkSvc == nil {
		s.linkSvc = NewWikiLinkService()
	}
	if s.prompts == nil {
		s.prompts = NewWikiPromptService()
	}

	primary := pickWikiPrimaryUpdate(additions, retracts)
	pageTitle := strings.TrimSpace(slug)
	pageType := model.WikiPageTypeConcept
	existingContent := ""
	existingAliases := []string(nil)
	if snapshotPage != nil {
		pageTitle = firstNonEmpty(snapshotPage.Title, primary.Title, primary.DocTitle, pageTitle)
		pageType = firstNonEmpty(snapshotPage.PageType, primary.PageType, model.WikiPageTypeConcept)
		existingContent = strings.TrimSpace(snapshotPage.Body)
		existingAliases = append([]string(nil), snapshotPage.Aliases...)
	} else {
		pageTitle = firstNonEmpty(primary.Title, primary.DocTitle, pageTitle)
		pageType = firstNonEmpty(primary.PageType, model.WikiPageTypeConcept)
	}

	availableTargets, err := s.loadWikiAvailableLinkTargets(ctx, eid, libraryID, slug)
	if err != nil {
		return false, err
	}
	if existingContent != "" {
		availableTargets = mergeWikiLinkTargets(s.linkSvc.ExtractWikiLinkTargets(existingContent), availableTargets)
	}
	availableLinks := renderWikiAvailableLinkList(availableTargets)
	if availableLinks == "" {
		availableLinks = "(none)"
	}

	newInformation := renderWikiSourceDocuments(additions, "new_information")
	deletedContent := renderWikiSourceDocuments(retracts, "deleted_documents")
	remainingSources := renderWikiRemainingSourceDocuments(snapshotPage, snapshotSources, retracts)
	updateAliases := collectWikiUpdateAliasesList(additions, retracts)
	pageAliases := strings.Join(updateAliases, ", ")

	prompt, err := s.prompts.RenderPageModifyPrompt(WikiPageModifyInput{
		PageSlug:         slug,
		PageTitle:        pageTitle,
		PageType:         pageType,
		PageAliases:      pageAliases,
		ExistingContent:  existingContent,
		NewInformation:   newInformation,
		DeletedContent:   deletedContent,
		RemainingSources: remainingSources,
		AvailableSlugs:   availableLinks,
		Language:         firstNonEmpty(additionsLanguage(additions), retractsLanguage(retracts), "中文"),
		HasAdditions:     len(additions) > 0,
		HasRetractions:   len(retracts) > 0,
	})
	if err != nil {
		return false, err
	}

	compiled, err := s.llm.Generate(ctx, prompt)
	if err != nil {
		return false, err
	}
	summaryLine, body := splitSummaryLine(compiled)
	if body == "" {
		body = strings.TrimSpace(compiled)
	}
	if summaryLine == "" {
		summaryLine = firstNonEmpty(pageTitle, slug)
	}

	finalSources := buildWikiPageSourcesForCompiledUpdates(snapshotSources, eid, additions, retracts)
	creatorID := firstUpdateActor(additions, retracts)

	changed := false
	err = s.db.Transaction(func(tx *gorm.DB) error {
		page, err := loadWikiPageForWrite(tx, eid, libraryID, slug)
		if err != nil {
			return err
		}
		var existingPage *model.WikiPage
		if page != nil {
			snapshot := *page
			existingPage = &snapshot
		}
		if snapshotPage == nil && page != nil {
			return fmt.Errorf("wiki page created during compilation")
		}
		if snapshotPage != nil && page != nil && page.CurrentVersionID != snapshotPage.CurrentVersionID {
			return fmt.Errorf("wiki page changed during compilation")
		}
		if page == nil {
			if len(additions) == 0 {
				return nil
			}
			page = &model.WikiPage{
				Eid:        eid,
				SpaceID:    spaceID,
				LibraryID:  libraryID,
				Slug:       slug,
				Title:      pageTitle,
				PageType:   pageType,
				BodyFormat: model.WikiPageBodyFormatMarkdown,
				Status:     model.WikiPageStatusDraft,
				Visibility: model.WikiPageVisibilityWorkspace,
				CreatorID:  creatorID,
				UpdaterID:  creatorID,
			}
		}

		page.Title = pageTitle
		if page.SpaceID == 0 && spaceID > 0 {
			page.SpaceID = spaceID
		}
		page.PageType = pageType
		page.Body = body
		page.Summary = summaryLine
		page.Aliases = mergeWikiStringSlices(existingAliases, updateAliases)
		page.BodyFormat = model.WikiPageBodyFormatMarkdown
		page.Status = model.WikiPageStatusDraft
		page.Visibility = model.WikiPageVisibilityWorkspace
		page.UpdaterID = creatorID
		page.FolderID = firstNonZeroInt64(folderID, page.FolderID)

		linkedBody, _, err := linkifyWikiPageContent(tx, eid, libraryID, slug, page.Body)
		if err != nil {
			return err
		}
		page.Body = linkedBody

		existingSources, err := loadWikiPageSourcesForWrite(tx, page.ID)
		if err != nil {
			return err
		}
		if existingPage != nil && wikiPageWriteIsNoop(existingPage, page, existingSources, finalSources) {
			return nil
		}

		links := buildWikiPageLinksForContent(page.ID, eid, libraryID, page.Body, s.linkSvc, tx, creatorID)
		if err := persistWikiPageWrite(ctx, tx, page, finalSources, links, "compiled update"); err != nil {
			return err
		}
		if snapshotPage == nil {
			creatorUserID := creatorID
			var srcFileID int64
			for _, u := range additions {
				if u.SourceFileID > 0 {
					srcFileID = u.SourceFileID
					break
				}
			}
			if srcFileID > 0 {
				var f model.File
				if err := tx.Where("eid = ? AND id = ?", eid, srcFileID).First(&f).Error; err == nil && f.UserID > 0 {
					creatorUserID = f.UserID
				}
			}
			perm := &model.Permission{
				Eid:          eid,
				ResourceType: model.RESOURCE_TYPE_WIKI_PAGE,
				ResourceID:   page.ID,
				SubjectType:  model.SUBJECT_TYPE_USER,
				SubjectID:    creatorUserID,
				Permission:   model.PERMISSION_MANAGE,
			}
			if err := tx.Create(perm).Error; err != nil {
				return err
			}
		}
		changed = true
		return nil
	})
	return changed, err
}

func splitWikiSlugUpdateKinds(updates []WikiSlugUpdate) (additions []WikiSlugUpdate, retracts []WikiSlugUpdate) {
	for _, update := range updates {
		switch update.PageType {
		case "retract", "retractStale":
			retracts = append(retracts, update)
		default:
			additions = append(additions, update)
		}
	}
	return additions, retracts
}

func firstWikiUpdateFolderID(updates []WikiSlugUpdate) int64 {
	for _, update := range updates {
		if update.FolderID > 0 {
			return update.FolderID
		}
	}
	return 0
}

func loadWikiPageForWrite(tx *gorm.DB, eid, libraryID int64, slug string) (*model.WikiPage, error) {
	var page model.WikiPage
	err := tx.Where("eid = ? AND library_id = ? AND slug = ?", eid, libraryID, slug).First(&page).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}
	return &page, nil
}

func pickWikiSummaryUpdate(updates []WikiSlugUpdate) *WikiSlugUpdate {
	for i := range updates {
		if updates[i].PageType == model.WikiPageTypeSummary || isSummarySlug(updates[i].Slug) {
			return &updates[i]
		}
	}
	return nil
}

func pickWikiPrimaryUpdate(additions, retracts []WikiSlugUpdate) WikiSlugUpdate {
	if len(additions) > 0 {
		return additions[0]
	}
	if len(retracts) > 0 {
		return retracts[0]
	}
	return WikiSlugUpdate{}
}

func loadWikiPageSourcesForWrite(tx *gorm.DB, pageID int64) ([]model.WikiPageSource, error) {
	if tx == nil || pageID == 0 {
		return nil, nil
	}
	var sources []model.WikiPageSource
	if err := tx.Where("page_id = ?", pageID).Find(&sources).Error; err != nil {
		return nil, err
	}
	return sources, nil
}

func buildWikiPageSourcesForUpdates(pageID, eid int64, update WikiSlugUpdate, sourceKind string) []model.WikiPageSource {
	if len(update.SourceChunks) == 0 {
		return []model.WikiPageSource{{
			Eid:          eid,
			PageID:       pageID,
			SourceKind:   sourceKind,
			SourceRef:    fmt.Sprintf("file:%d", update.SourceFileID),
			SourceFileID: update.SourceFileID,
			CreatorID:    update.Eid,
		}}
	}
	sources := make([]model.WikiPageSource, 0, len(update.SourceChunks))
	for _, chunkID := range update.SourceChunks {
		sources = append(sources, model.WikiPageSource{
			Eid:           eid,
			PageID:        pageID,
			SourceKind:    sourceKind,
			SourceRef:     fmt.Sprintf("file:%d#%s", update.SourceFileID, chunkID),
			SourceFileID:  update.SourceFileID,
			SourceChunkID: parseInt64OrZero(chunkID),
			SourceSlug:    update.Slug,
			CreatorID:     update.Eid,
		})
	}
	return sources
}

func buildWikiPageSourcesForCompiledUpdates(existing []model.WikiPageSource, eid int64, additions, retracts []WikiSlugUpdate) []model.WikiPageSource {
	bySourceFile := make(map[string]model.WikiPageSource)
	for _, source := range existing {
		bySourceFile[wikiSourceKey(source.SourceFileID, source.SourceChunkID, source.SourceRef)] = source
	}
	for _, update := range additions {
		chunkSources := buildWikiPageSourcesForUpdates(0, eid, update, model.WikiPageSourceKindImport)
		for _, source := range chunkSources {
			bySourceFile[wikiSourceKey(source.SourceFileID, source.SourceChunkID, source.SourceRef)] = source
		}
	}
	if len(bySourceFile) == 0 {
		return nil
	}
	for _, retract := range retracts {
		for key, source := range bySourceFile {
			if source.SourceFileID == retract.SourceFileID {
				delete(bySourceFile, key)
			}
		}
	}
	sources := make([]model.WikiPageSource, 0, len(bySourceFile))
	for _, source := range bySourceFile {
		sources = append(sources, source)
	}
	return sources
}

func buildWikiPageLinksForContent(pageID, eid, libraryID int64, content string, svc *WikiLinkService, db *gorm.DB, creatorID int64) []model.WikiPageLink {
	if svc == nil {
		svc = NewWikiLinkService()
	}
	return svc.BuildPageLinks(svc.ExtractWikiLinkTargets(content), pageID, eid, libraryID, creatorID, db)
}

func renderWikiSourceDocuments(updates []WikiSlugUpdate, tag string) string {
	if len(updates) == 0 {
		return ""
	}
	var builder strings.Builder
	for _, update := range updates {
		document := renderWikiSourceDocument(update, tag)
		if document == "" {
			continue
		}
		builder.WriteString(document)
		builder.WriteString("\n\n")
	}
	return strings.TrimSpace(builder.String())
}

func renderWikiRemainingSourceDocuments(page *model.WikiPage, existingSources []model.WikiPageSource, retracts []WikiSlugUpdate) string {
	if page == nil || len(retracts) == 0 {
		return ""
	}
	retractSet := make(map[int64]struct{}, len(retracts))
	for _, update := range retracts {
		retractSet[update.SourceFileID] = struct{}{}
	}
	if len(retractSet) == 0 {
		return ""
	}
	sourceContext := strings.TrimSpace(page.Summary)
	sourceCtxBlock := renderWikiExistingSourceContext(page, sourceContext)
	var builder strings.Builder
	for _, source := range existingSources {
		if _, ok := retractSet[source.SourceFileID]; ok {
			continue
		}
		title := source.SourceSlug
		if title == "" {
			title = source.SourceRef
		}
		if title == "" {
			title = fmt.Sprintf("source-%d", source.SourceFileID)
		}
		sourceChunksBlock := renderWikiSourceChunksBlock(source.SourceFileID, []string{sourceChunkIDString(source)}, source.SourceRef)
		fmt.Fprintf(&builder, "<document>\n<title>%s</title>\n%s%s<content>\nsource_ref: %s\n</content>\n</document>\n\n", title, sourceCtxBlock, sourceChunksBlock, source.SourceRef)
	}
	if builder.Len() == 0 {
		for _, source := range existingSources {
			if _, ok := retractSet[source.SourceFileID]; ok {
				continue
			}
			sourceChunksBlock := renderWikiSourceChunksBlock(source.SourceFileID, []string{sourceChunkIDString(source)}, source.SourceRef)
			fmt.Fprintf(&builder, "<document>\n<title>%s</title>\n%s%s<content>\nsource_ref: %s\n</content>\n</document>\n\n", page.Title, sourceCtxBlock, sourceChunksBlock, source.SourceRef)
		}
	}
	return strings.TrimSpace(builder.String())
}

func renderWikiExistingSourceContext(page *model.WikiPage, sourceSummary string) string {
	if page == nil && strings.TrimSpace(sourceSummary) == "" {
		return ""
	}
	fields := make([]string, 0, 4)
	if page != nil {
		fields = append(fields, fmt.Sprintf("page_style: %s", wikiPageStyleForType(page.PageType)))
		fields = append(fields, fmt.Sprintf("evidence_mode: %s", wikiEvidenceModeForTag("", page.PageType)))
		if pageType := strings.TrimSpace(page.PageType); pageType != "" {
			fields = append(fields, fmt.Sprintf("page_type: %s", pageType))
		}
		if title := strings.TrimSpace(page.Title); title != "" {
			fields = append(fields, fmt.Sprintf("page_title: %s", title))
		}
		if slug := strings.TrimSpace(page.Slug); slug != "" {
			fields = append(fields, fmt.Sprintf("page_slug: %s", slug))
		}
	}
	if summary := strings.TrimSpace(sourceSummary); summary != "" {
		fields = append(fields, fmt.Sprintf("document_summary: %s", summary))
	}
	return strings.Join(fields, "\n")
}

func renderWikiSourceDocument(update WikiSlugUpdate, tag string) string {
	title := firstNonEmpty(update.DocTitle, update.Title, update.Slug)
	if strings.TrimSpace(title) == "" {
		title = update.Slug
	}

	sourceContext := renderWikiSourceContext(update, tag)
	sourceCtxBlock := ""
	if sourceContext != "" {
		sourceCtxBlock = fmt.Sprintf("<source_context>\n%s\n</source_context>\n", sourceContext)
	}
	sourceChunksBlock := renderWikiSourceChunksBlock(update.SourceFileID, update.SourceChunks, "")

	evidence := renderWikiSourceEvidence(update, tag)
	leadLine := ""
	switch tag {
	case "deleted_documents":
		leadName := firstNonEmpty(update.DocTitle, update.Title, update.Slug)
		if leadName != "" {
			leadLine = fmt.Sprintf("**%s**: removed source material", leadName)
		}
	default:
		leadLine = wikiRenderLeadSentence(update)
	}

	parts := make([]string, 0, 2)
	if leadLine != "" {
		parts = append(parts, leadLine)
	}
	if evidence != "" {
		parts = append(parts, evidence)
	}
	if len(parts) == 0 {
		fallback := firstNonEmpty(update.Content, update.SummaryBody, update.Summary, update.DocSummary, update.RetractDocContent)
		if fallback == "" {
			return ""
		}
		parts = append(parts, fallback)
	}

	return fmt.Sprintf("<document>\n<title>%s</title>\n%s%s<content>\n%s\n</content>\n</document>", title, sourceCtxBlock, sourceChunksBlock, strings.Join(parts, "\n\n"))
}

func wikiRenderLeadSentence(update WikiSlugUpdate) string {
	title := firstNonEmpty(update.Title, update.DocTitle, update.Slug)
	if title == "" {
		return ""
	}

	summary := firstNonEmpty(update.Summary, update.SummaryBody, update.DocSummary, update.Content)
	if summary == "" {
		return fmt.Sprintf("**%s**", title)
	}

	return fmt.Sprintf("**%s**: %s", title, trimWikiSentence(summary))
}

func trimWikiSentence(value string) string {
	value = strings.TrimSpace(value)
	value = strings.TrimRight(value, "。.!?！？")
	return strings.TrimSpace(value)
}

func renderWikiSourceChunksBlock(sourceFileID int64, chunkIDs []string, sourceRef string) string {
	filtered := make([]string, 0, len(chunkIDs))
	for _, chunkID := range chunkIDs {
		chunkID = strings.TrimSpace(chunkID)
		if chunkID == "" {
			continue
		}
		filtered = append(filtered, chunkID)
	}
	if sourceFileID <= 0 && len(filtered) == 0 && strings.TrimSpace(sourceRef) == "" {
		return ""
	}
	if len(filtered) == 0 {
		fallbackRef := strings.TrimSpace(sourceRef)
		if fallbackRef == "" && sourceFileID > 0 {
			fallbackRef = fmt.Sprintf("file:%d", sourceFileID)
		}
		return fmt.Sprintf("<source_chunks>\n- source_file_id: %d\n  source_ref: %s\n</source_chunks>\n", sourceFileID, fallbackRef)
	}

	var builder strings.Builder
	builder.WriteString("<source_chunks>\n")
	for _, chunkID := range filtered {
		builder.WriteString(fmt.Sprintf("- source_file_id: %d\n  source_chunk_id: %s\n", sourceFileID, chunkID))
		if strings.TrimSpace(sourceRef) != "" {
			builder.WriteString(fmt.Sprintf("  source_ref: %s\n", strings.TrimSpace(sourceRef)))
		} else if sourceFileID > 0 {
			builder.WriteString(fmt.Sprintf("  source_ref: file:%d#%s\n", sourceFileID, chunkID))
		}
	}
	builder.WriteString("</source_chunks>\n")
	return builder.String()
}

func sourceChunkIDString(source model.WikiPageSource) string {
	if source.SourceChunkID <= 0 {
		return ""
	}
	return fmt.Sprintf("%d", source.SourceChunkID)
}

func renderWikiSourceContext(update WikiSlugUpdate, tag string) string {
	if update.Slug == "" && update.Title == "" && update.DocTitle == "" && len(update.Aliases) == 0 && update.DocSummary == "" && update.SummaryBody == "" && update.Summary == "" {
		return ""
	}

	fields := make([]string, 0, 6)
	pageType := strings.TrimSpace(update.PageType)
	if pageType == "" {
		pageType = "entity"
	}
	fields = append(fields, fmt.Sprintf("page_style: %s", wikiPageStyleForType(pageType)))
	fields = append(fields, fmt.Sprintf("evidence_mode: %s", wikiEvidenceModeForTag(tag, pageType)))
	fields = append(fields, fmt.Sprintf("page_type: %s", pageType))
	if title := firstNonEmpty(update.Title, update.DocTitle, update.Slug); title != "" {
		fields = append(fields, fmt.Sprintf("page_title: %s", title))
	}
	if len(update.Aliases) > 0 {
		fields = append(fields, fmt.Sprintf("aliases: %s", strings.Join(update.Aliases, ", ")))
	}
	if summary := firstNonEmpty(update.DocSummary, update.SummaryBody, update.Summary); summary != "" {
		fields = append(fields, fmt.Sprintf("document_summary: %s", summary))
	}
	if tag != "" {
		fields = append(fields, fmt.Sprintf("tag: %s", tag))
	}
	return strings.Join(fields, "\n")
}

func renderWikiSourceEvidence(update WikiSlugUpdate, tag string) string {
	evidence := ""
	switch tag {
	case "deleted_documents":
		evidence = firstNonEmpty(update.RetractDocContent, update.Content, update.SummaryBody, update.Summary, update.DocSummary)
	default:
		evidence = firstNonEmpty(update.Content, update.SummaryBody, update.Summary, update.DocSummary, update.RetractDocContent)
	}
	return strings.TrimSpace(evidence)
}

func wikiPageStyleForType(pageType string) string {
	switch strings.TrimSpace(pageType) {
	case model.WikiPageTypeSummary:
		return "document_digest"
	case model.WikiPageTypeConcept:
		return "explanatory_entry"
	case model.WikiPageTypeEntity:
		return "human_entry"
	default:
		return "human_entry"
	}
}

func wikiEvidenceModeForTag(tag, pageType string) string {
	switch tag {
	case "deleted_documents":
		return "retraction_compilation"
	}
	if strings.TrimSpace(pageType) == model.WikiPageTypeSummary {
		return "document_digest"
	}
	return "chunk_cited"
}

func collectWikiUpdateAliasesList(groups ...[]WikiSlugUpdate) []string {
	seen := make(map[string]struct{})
	aliases := make([]string, 0)
	for _, updates := range groups {
		for _, update := range updates {
			for _, alias := range update.Aliases {
				alias = strings.TrimSpace(alias)
				if alias == "" {
					continue
				}
				if _, ok := seen[alias]; ok {
					continue
				}
				seen[alias] = struct{}{}
				aliases = append(aliases, alias)
			}
		}
	}
	return aliases
}

func collectWikiUpdateAliases(groups ...[]WikiSlugUpdate) string {
	return strings.Join(collectWikiUpdateAliasesList(groups...), ", ")
}

func renderWikiAvailableLinkList(targets []WikiLinkTarget) string {
	if len(targets) == 0 {
		return "(none)"
	}
	var builder strings.Builder
	for _, target := range targets {
		fmt.Fprintf(&builder, "- [[%s|%s]]", target.Slug, target.AnchorText)
		if len(target.Aliases) > 0 {
			fmt.Fprintf(&builder, " (Aliases: %s)", strings.Join(target.Aliases, ", "))
		}
		builder.WriteByte('\n')
	}
	return strings.TrimSpace(builder.String())
}

func (s *WikiIngestV2Service) loadWikiAvailableLinkTargets(ctx context.Context, eid, libraryID int64, excludeSlug string) ([]WikiLinkTarget, error) {
	if s == nil || s.db == nil {
		return nil, nil
	}

	var pages []model.WikiPage
	query := s.db.WithContext(ctx).Model(&model.WikiPage{}).
		Select("slug", "title", "aliases").
		Where("eid = ? AND library_id = ? AND status = ?", eid, libraryID, model.WikiPageStatusActive)
	if strings.TrimSpace(excludeSlug) != "" {
		query = query.Where("slug <> ?", strings.TrimSpace(excludeSlug))
	}
	if err := query.Order("page_type ASC, sort ASC, id ASC").Limit(300).Find(&pages).Error; err != nil {
		return nil, fmt.Errorf("load wiki available links: %w", err)
	}

	targets := make([]WikiLinkTarget, 0, len(pages))
	seen := make(map[string]struct{}, len(pages))
	for _, page := range pages {
		slug := strings.TrimSpace(page.Slug)
		if slug == "" {
			continue
		}
		if _, ok := seen[slug]; ok {
			continue
		}
		seen[slug] = struct{}{}
		anchor := strings.TrimSpace(page.Title)
		if anchor == "" {
			anchor = slug
		}
		targets = append(targets, WikiLinkTarget{Slug: slug, AnchorText: anchor, Aliases: normalizeWikiPageAliases(page.Aliases)})
	}
	return targets, nil
}

func mergeWikiLinkTargets(primary, secondary []WikiLinkTarget) []WikiLinkTarget {
	if len(primary) == 0 && len(secondary) == 0 {
		return nil
	}
	merged := make([]WikiLinkTarget, 0, len(primary)+len(secondary))
	seen := make(map[string]struct{}, len(primary)+len(secondary))
	appendTargets := func(targets []WikiLinkTarget) {
		for _, target := range targets {
			slug := strings.TrimSpace(target.Slug)
			if slug == "" {
				continue
			}
			if _, ok := seen[slug]; ok {
				continue
			}
			seen[slug] = struct{}{}
			anchor := strings.TrimSpace(target.AnchorText)
			if anchor == "" {
				anchor = slug
			}
			merged = append(merged, WikiLinkTarget{
				Slug:       slug,
				AnchorText: anchor,
				Aliases:    append([]string(nil), target.Aliases...),
			})
		}
	}
	appendTargets(primary)
	appendTargets(secondary)
	return merged
}

func additionsLanguage(updates []WikiSlugUpdate) string {
	if len(updates) == 0 {
		return ""
	}
	return "中文"
}

func retractsLanguage(updates []WikiSlugUpdate) string {
	if len(updates) == 0 {
		return ""
	}
	return "中文"
}

func firstUpdateActor(additions, retracts []WikiSlugUpdate) int64 {
	for _, update := range additions {
		if update.Eid != 0 {
			return update.Eid
		}
	}
	for _, update := range retracts {
		if update.Eid != 0 {
			return update.Eid
		}
	}
	return 0
}

func parseInt64OrZero(input string) int64 {
	value, err := strconv.ParseInt(strings.TrimSpace(input), 10, 64)
	if err != nil {
		return 0
	}
	return value
}

func wikiSourceKey(sourceFileID, sourceChunkID int64, sourceRef string) string {
	return fmt.Sprintf("%d:%d:%s", sourceFileID, sourceChunkID, sourceRef)
}

func buildWikiPageVersionMetadata(tx *gorm.DB, page *model.WikiPage, sources []model.WikiPageSource, links []model.WikiPageLink) (string, string, string, string, error) {
	if page == nil {
		return "", "", "", "", nil
	}
	if tx == nil {
		return "", "", "", "", fmt.Errorf("wiki version metadata db is required")
	}

	aliases := page.Aliases
	if aliases == nil {
		aliases = []string{}
	}
	snapshotSources := sources
	if snapshotSources == nil {
		snapshotSources = []model.WikiPageSource{}
	}
	snapshotLinks := links
	if snapshotLinks == nil {
		snapshotLinks = []model.WikiPageLink{}
	}
	backlinks := make([]model.WikiPageLink, 0)
	if page.ID > 0 {
		if err := tx.Where("eid = ? AND to_page_id = ?", page.Eid, page.ID).Order("id ASC").Find(&backlinks).Error; err != nil {
			return "", "", "", "", err
		}
	}

	aliasesJSON, err := json.Marshal(aliases)
	if err != nil {
		return "", "", "", "", err
	}
	sourcesJSON, err := json.Marshal(snapshotSources)
	if err != nil {
		return "", "", "", "", err
	}
	linksJSON, err := json.Marshal(snapshotLinks)
	if err != nil {
		return "", "", "", "", err
	}
	backlinksJSON, err := json.Marshal(backlinks)
	if err != nil {
		return "", "", "", "", err
	}
	return string(aliasesJSON), string(sourcesJSON), string(linksJSON), string(backlinksJSON), nil
}

func persistWikiPageWrite(ctx context.Context, tx *gorm.DB, page *model.WikiPage, sources []model.WikiPageSource, links []model.WikiPageLink, reason string) error {
	if page == nil {
		return nil
	}
	if err := saveWikiPageForWrite(tx, page); err != nil {
		return err
	}
	if err := tx.Where("page_id = ?", page.ID).Delete(&model.WikiPageSource{}).Error; err != nil {
		return err
	}
	if err := tx.Where("from_page_id = ?", page.ID).Delete(&model.WikiPageLink{}).Error; err != nil {
		return err
	}
	if len(sources) > 0 {
		for i := range sources {
			sources[i].PageID = page.ID
			sources[i].Eid = page.Eid
		}
		if err := tx.Create(&sources).Error; err != nil {
			return err
		}
	}
	if len(links) > 0 {
		for i := range links {
			links[i].FromPageID = page.ID
			links[i].Eid = page.Eid
		}
		if err := tx.Create(&links).Error; err != nil {
			return err
		}
	}
	aliasesJSON, sourcesJSON, linksJSON, backlinksJSON, err := buildWikiPageVersionMetadata(tx, page, sources, links)
	if err != nil {
		return err
	}

	versionNo, err := nextWikiPageVersionNo(tx, page.ID)
	if err != nil {
		return err
	}
	version := &model.WikiPageVersion{
		Eid:           page.Eid,
		PageID:        page.ID,
		VersionNo:     versionNo,
		Title:         page.Title,
		Slug:          page.Slug,
		PageType:      page.PageType,
		AliasesJSON:   aliasesJSON,
		SourcesJSON:   sourcesJSON,
		LinksJSON:     linksJSON,
		BacklinksJSON: backlinksJSON,
		Body:          page.Body,
		BodyFormat:    page.BodyFormat,
		Checksum:      fmt.Sprintf("%s:%d", page.Slug, versionNo),
		EditorID:      page.UpdaterID,
		PublishKind:   model.WikiPagePublishKindSync,
	}
	if err := tx.Create(version).Error; err != nil {
		if shouldFallbackToLegacyWikiPageVersionUpdate(tx, err) {
			// 旧库可能还保留着历史唯一索引，导致版本追加写入失败。
			// 这里退化为原地更新当前版本记录，保证重建不会中断；后续 schema migration 会移除该索引。
			existingVersion, loadErr := loadLatestWikiPageVersionForWrite(tx, page.ID)
			if loadErr != nil {
				return loadErr
			}
			if existingVersion == nil {
				return err
			}

			existingVersion.Eid = version.Eid
			existingVersion.VersionNo = version.VersionNo
			existingVersion.Title = version.Title
			existingVersion.Slug = version.Slug
			existingVersion.PageType = version.PageType
			existingVersion.AliasesJSON = version.AliasesJSON
			existingVersion.SourcesJSON = version.SourcesJSON
			existingVersion.LinksJSON = version.LinksJSON
			existingVersion.BacklinksJSON = version.BacklinksJSON
			existingVersion.Body = version.Body
			existingVersion.BodyFormat = version.BodyFormat
			existingVersion.ChangeSummary = version.ChangeSummary
			existingVersion.Checksum = version.Checksum
			existingVersion.SourceVersion = version.SourceVersion
			existingVersion.EditorID = version.EditorID
			existingVersion.IsPublished = version.IsPublished
			existingVersion.PublishKind = version.PublishKind
			existingVersion.PublishedTime = version.PublishedTime
			if err := tx.Save(existingVersion).Error; err != nil {
				return err
			}
			version.ID = existingVersion.ID
		} else {
			return err
		}
	}
	page.CurrentVersionID = version.ID
	return tx.Model(page).Updates(map[string]any{
		"current_version_id": page.CurrentVersionID,
		"summary":            page.Summary,
		"body":               page.Body,
		"title":              page.Title,
		"page_type":          page.PageType,
		"status":             page.Status,
		"visibility":         page.Visibility,
		"updater_id":         page.UpdaterID,
	}).Error
}

func saveWikiPageForWrite(tx *gorm.DB, page *model.WikiPage) error {
	if tx == nil || page == nil {
		return nil
	}

	saveErr := tx.Save(page).Error
	if saveErr == nil {
		return nil
	}
	if !isWikiPageDuplicateKeyErr(saveErr) || page.ID > 0 {
		return saveErr
	}

	existing, loadErr := loadWikiPageForWrite(tx, page.Eid, page.LibraryID, page.Slug)
	if loadErr != nil {
		return loadErr
	}
	if existing == nil {
		return saveErr
	}

	page.ID = existing.ID
	if page.SpaceID == 0 {
		page.SpaceID = existing.SpaceID
	}
	if page.FolderID == 0 {
		page.FolderID = existing.FolderID
	}
	page.CreatorID = existing.CreatorID
	if page.Sort == 0 {
		page.Sort = existing.Sort
	}
	page.BaseModel = existing.BaseModel

	return tx.Save(page).Error
}

func isWikiPageDuplicateKeyErr(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(strings.TrimSpace(err.Error()))
	switch {
	case strings.Contains(msg, "duplicate entry"):
		return true
	case strings.Contains(msg, "duplicate key"):
		return true
	case strings.Contains(msg, "unique constraint failed"):
		return true
	case strings.Contains(msg, "1062"):
		return true
	case strings.Contains(msg, "23505"):
		return true
	}
	return false
}

func wikiPageWriteIsNoop(existing *model.WikiPage, candidate *model.WikiPage, existingSources, candidateSources []model.WikiPageSource) bool {
	if existing == nil || candidate == nil {
		return false
	}

	if strings.TrimSpace(existing.Slug) != strings.TrimSpace(candidate.Slug) {
		return false
	}
	if strings.TrimSpace(existing.Title) != strings.TrimSpace(candidate.Title) {
		return false
	}
	if strings.TrimSpace(existing.PageType) != strings.TrimSpace(candidate.PageType) {
		return false
	}
	if strings.TrimSpace(existing.Body) != strings.TrimSpace(candidate.Body) {
		return false
	}
	if strings.TrimSpace(existing.Summary) != strings.TrimSpace(candidate.Summary) {
		return false
	}
	if strings.TrimSpace(existing.BodyFormat) != strings.TrimSpace(candidate.BodyFormat) {
		return false
	}
	if existing.FolderID != candidate.FolderID {
		return false
	}
	if strings.TrimSpace(existing.Visibility) != strings.TrimSpace(candidate.Visibility) {
		return false
	}
	if !wikiPageAliasesEqual(existing.Aliases, candidate.Aliases) {
		return false
	}
	if !wikiPageSourcesEqual(existingSources, candidateSources) {
		return false
	}
	return true
}

func wikiPageAliasesEqual(left, right []string) bool {
	leftNorm := normalizeWikiPageAliases(left)
	rightNorm := normalizeWikiPageAliases(right)
	if len(leftNorm) != len(rightNorm) {
		return false
	}
	for i := range leftNorm {
		if leftNorm[i] != rightNorm[i] {
			return false
		}
	}
	return true
}

func wikiPageSourcesEqual(left, right []model.WikiPageSource) bool {
	if len(left) != len(right) {
		return false
	}
	if len(left) == 0 {
		return true
	}
	leftSet := make(map[string]struct{}, len(left))
	for _, source := range left {
		leftSet[wikiPageSourceSignature(source)] = struct{}{}
	}
	for _, source := range right {
		if _, ok := leftSet[wikiPageSourceSignature(source)]; !ok {
			return false
		}
	}
	return true
}

func wikiPageSourceSignature(source model.WikiPageSource) string {
	return fmt.Sprintf("%d:%d:%s:%s", source.SourceFileID, source.SourceChunkID, strings.TrimSpace(source.SourceRef), strings.TrimSpace(source.SourceKind))
}

func nextWikiPageVersionNo(tx *gorm.DB, pageID int64) (int64, error) {
	if tx == nil || pageID == 0 {
		return 1, nil
	}
	var nextVersionNo int64
	if err := tx.Model(&model.WikiPageVersion{}).
		Where("page_id = ?", pageID).
		Select("COALESCE(MAX(version_no), 0) + 1").
		Scan(&nextVersionNo).Error; err != nil {
		return 0, err
	}
	if nextVersionNo <= 0 {
		return 1, nil
	}
	return nextVersionNo, nil
}

func loadLatestWikiPageVersionForWrite(tx *gorm.DB, pageID int64) (*model.WikiPageVersion, error) {
	if tx == nil || pageID == 0 {
		return nil, nil
	}

	var version model.WikiPageVersion
	if err := tx.Where("page_id = ?", pageID).Order("version_no DESC, id DESC").First(&version).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &version, nil
}

func shouldFallbackToLegacyWikiPageVersionUpdate(tx *gorm.DB, err error) bool {
	if tx == nil || err == nil {
		return false
	}
	if !isDuplicateKeyErrText(err) {
		return false
	}
	return tx.Migrator().HasIndex(&model.WikiPageVersion{}, "idx_wiki_page_versions_unique")
}

func isDuplicateKeyErrText(err error) bool {
	msg := strings.ToLower(strings.TrimSpace(err.Error()))
	switch {
	case strings.Contains(msg, "duplicate entry"):
		return true
	case strings.Contains(msg, "duplicate key"):
		return true
	case strings.Contains(msg, "unique constraint failed"):
		return true
	case strings.Contains(msg, "1062"):
		return true
	case strings.Contains(msg, "23505"):
		return true
	}
	return false
}

// isWikiCompilationConflictErr 判断是否为 wiki 页面编译期间的版本冲突错误。
// 这类错误是并发的 wiki 生成任务修改了同一页面导致的临时冲突，重试可恢复。
func isWikiCompilationConflictErr(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "during compilation")
}
