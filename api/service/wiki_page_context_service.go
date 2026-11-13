package service

import (
	"context"

	"github.com/53AI/53AIHub/model"
)

type WikiPageContext struct {
	PageID            int64
	VersionID         int64
	Title             string
	Body              string
	MatchedChunkDBIDs []int64
	MatchedChunkIDs   []string
	Chunks            []model.WikiPageChunk
}

type wikiPageVersionKey struct {
	pageID    int64
	versionID int64
}

func (s *WikiSearchService) LoadPageContexts(ctx context.Context, eid, userID int64, matches []WikiSearchResult) ([]WikiPageContext, error) {
	if s == nil || s.db == nil || eid <= 0 || userID <= 0 || len(matches) == 0 {
		return []WikiPageContext{}, nil
	}

	pageIDs := make([]int64, 0, len(matches))
	selected := make(map[int64]WikiSearchResult, len(matches))
	matchesByPage := make(map[int64][]WikiSearchResult, len(matches))
	for _, match := range matches {
		if match.PageID == 0 || match.WikiPageVersionID == 0 || match.ChunkDBID == 0 || match.ChunkID == "" {
			continue
		}
		if _, exists := selected[match.PageID]; !exists {
			selected[match.PageID] = match
			pageIDs = append(pageIDs, match.PageID)
		}
		matchesByPage[match.PageID] = append(matchesByPage[match.PageID], match)
	}
	if len(pageIDs) == 0 {
		return []WikiPageContext{}, nil
	}

	var pages []model.WikiPage
	if err := s.db.WithContext(ctx).Where("eid = ? AND status = ? AND id IN ?", eid, model.WikiPageStatusActive, pageIDs).Find(&pages).Error; err != nil {
		return nil, err
	}
	pageMap := make(map[int64]model.WikiPage, len(pages))
	for _, page := range pages {
		pageMap[page.ID] = page
	}
	permissions, err := batchGetWikiPermissions(eid, model.RESOURCE_TYPE_WIKI_PAGE, pageIDs, userID, ctx)
	if err != nil {
		return nil, err
	}
	versionIDs := make([]int64, 0, len(selected))
	for _, match := range selected {
		versionIDs = append(versionIDs, match.WikiPageVersionID)
	}
	var versions []model.WikiPageVersion
	if err := s.db.WithContext(ctx).Where("eid = ? AND id IN ? AND is_published = ?", eid, versionIDs, true).Find(&versions).Error; err != nil {
		return nil, err
	}
	versionMap := make(map[int64]model.WikiPageVersion, len(versions))
	for _, version := range versions {
		versionMap[version.ID] = version
	}
	versionPageIDs := make([]int64, 0, len(selected))
	for pageID := range selected {
		versionPageIDs = append(versionPageIDs, pageID)
	}
	var chunks []model.WikiPageChunk
	if err := s.db.WithContext(ctx).
		Where("eid = ? AND wiki_page_id IN ? AND wiki_page_version_id IN ?", eid, versionPageIDs, versionIDs).
		Order("chunk_index ASC").Order("id ASC").Find(&chunks).Error; err != nil {
		return nil, err
	}
	chunksByPageVersion := make(map[wikiPageVersionKey][]model.WikiPageChunk, len(selected))
	for _, chunk := range chunks {
		key := wikiPageVersionKey{pageID: chunk.WikiPageID, versionID: chunk.WikiPageVersionID}
		chunksByPageVersion[key] = append(chunksByPageVersion[key], chunk)
	}

	contexts := make([]WikiPageContext, 0, len(selected))
	for _, pageID := range pageIDs {
		page, pageExists := pageMap[pageID]
		match := selected[pageID]
		version, versionExists := versionMap[match.WikiPageVersionID]
		if !pageExists || permissions[pageID] < model.PERMISSION_VIEW_ONLY || !versionExists || version.PageID != pageID {
			continue
		}
		pageChunks := chunksByPageVersion[wikiPageVersionKey{pageID: pageID, versionID: version.ID}]
		matchedDBIDs := make([]int64, 0, len(matchesByPage[pageID]))
		matchedChunkIDs := make([]string, 0, len(matchesByPage[pageID]))
		matched := make(map[int64]struct{})
		for _, pageMatch := range matchesByPage[pageID] {
			if pageMatch.WikiPageVersionID != version.ID {
				continue
			}
			for _, chunk := range pageChunks {
				if chunk.ID == pageMatch.ChunkDBID && chunk.ChunkID == pageMatch.ChunkID {
					if _, exists := matched[chunk.ID]; !exists {
						matched[chunk.ID] = struct{}{}
						matchedDBIDs = append(matchedDBIDs, chunk.ID)
						matchedChunkIDs = append(matchedChunkIDs, chunk.ChunkID)
					}
					break
				}
			}
		}
		if len(matchedDBIDs) == 0 {
			continue
		}
		pageContext := WikiPageContext{
			PageID: page.ID, VersionID: version.ID, Title: version.Title, Body: version.Body,
			Chunks: pageChunks, MatchedChunkDBIDs: matchedDBIDs, MatchedChunkIDs: matchedChunkIDs,
		}
		if pageContext.Title == "" {
			pageContext.Title = page.Title
		}
		contexts = append(contexts, pageContext)
	}
	return contexts, nil
}

func (s *WikiSearchService) LoadCurrentPageContexts(ctx context.Context, eid, userID int64, pageIDs []int64) ([]WikiPageContext, error) {
	if s == nil || s.db == nil || eid <= 0 || userID <= 0 || len(pageIDs) == 0 {
		return []WikiPageContext{}, nil
	}
	var pages []model.WikiPage
	if err := s.db.WithContext(ctx).Where("eid = ? AND status = ? AND id IN ?", eid, model.WikiPageStatusActive, pageIDs).Find(&pages).Error; err != nil {
		return nil, err
	}
	permissions, err := batchGetWikiPermissions(eid, model.RESOURCE_TYPE_WIKI_PAGE, pageIDs, userID, ctx)
	if err != nil {
		return nil, err
	}
	versionIDs := make([]int64, 0, len(pages))
	allowedPages := make([]model.WikiPage, 0, len(pages))
	for _, page := range pages {
		if page.CurrentVersionID > 0 && permissions[page.ID] >= model.PERMISSION_VIEW_ONLY {
			versionIDs = append(versionIDs, page.CurrentVersionID)
			allowedPages = append(allowedPages, page)
		}
	}
	if len(versionIDs) == 0 {
		return []WikiPageContext{}, nil
	}
	var versions []model.WikiPageVersion
	if err := s.db.WithContext(ctx).Where("eid = ? AND id IN ? AND is_published = ?", eid, versionIDs, true).Find(&versions).Error; err != nil {
		return nil, err
	}
	versionMap := make(map[int64]model.WikiPageVersion, len(versions))
	for _, version := range versions {
		versionMap[version.ID] = version
	}
	currentPageIDs := make([]int64, 0, len(allowedPages))
	for _, page := range allowedPages {
		version, exists := versionMap[page.CurrentVersionID]
		if exists && version.PageID == page.ID {
			currentPageIDs = append(currentPageIDs, page.ID)
		}
	}
	if len(currentPageIDs) == 0 {
		return []WikiPageContext{}, nil
	}
	var chunks []model.WikiPageChunk
	if err := s.db.WithContext(ctx).
		Where("eid = ? AND wiki_page_id IN ? AND wiki_page_version_id IN ?", eid, currentPageIDs, versionIDs).
		Order("chunk_index ASC").Order("id ASC").Find(&chunks).Error; err != nil {
		return nil, err
	}
	chunksByPageVersion := make(map[wikiPageVersionKey][]model.WikiPageChunk, len(currentPageIDs))
	for _, chunk := range chunks {
		key := wikiPageVersionKey{pageID: chunk.WikiPageID, versionID: chunk.WikiPageVersionID}
		chunksByPageVersion[key] = append(chunksByPageVersion[key], chunk)
	}
	pageMap := make(map[int64]model.WikiPage, len(allowedPages))
	for _, page := range allowedPages {
		pageMap[page.ID] = page
	}
	contexts := make([]WikiPageContext, 0, len(currentPageIDs))
	for _, pageID := range currentPageIDs {
		page := pageMap[pageID]
		version := versionMap[page.CurrentVersionID]
		title := version.Title
		if title == "" {
			title = page.Title
		}
		contexts = append(contexts, WikiPageContext{
			PageID: pageID, VersionID: version.ID, Title: title, Body: version.Body,
			Chunks: chunksByPageVersion[wikiPageVersionKey{pageID: pageID, versionID: version.ID}],
		})
	}
	return contexts, nil
}
