package controller

import (
	"errors"
	"net/http"
	"strings"

	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/elasticsearch"
	"github.com/gin-gonic/gin"
)

type recentAccessItem struct {
	resourceType int
	resourceID   int64
	file         *RecentAccessFileSummary
	library      *RecentAccessLibrarySummary
	libraryID    int64
	spaceID      int64
	space        *RecentAccessSpaceSummary
	creatorID    int64
	creator      *RecentAccessUserSummary
	recentTime   int64
	isFavorite   bool
}

type RecentAccessUserSummary struct {
	ID       string `json:"id"`
	Nickname string `json:"nickname"`
	Username string `json:"username,omitempty"`
}

type RecentAccessFileSummary struct {
	ID           string `json:"id"`
	Path         string `json:"path"`
	Type         int    `json:"type"`
	OriginType   string `json:"origin_type,omitempty"`
	OriginSource string `json:"origin_source,omitempty"`
}

type RecentAccessLibrarySummary struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	LibraryKind string `json:"library_kind"`
	SpaceID     string `json:"space_id"`
}

type RecentAccessSpaceSummary struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	SpaceKind string `json:"space_kind"`
}

type RecentAccessItem struct {
	ResourceType int                      `json:"resource_type"`
	ResourceID   string                   `json:"resource_id"`
	File         *RecentAccessFileSummary `json:"file,omitempty"`
	LibraryID    string                   `json:"library_id,omitempty"`
	SpaceID      string                   `json:"space_id,omitempty"`
	CreatorID    string                   `json:"creator_id,omitempty"`
	RecentTime   int64                    `json:"recent_time"`
	IsFavorite   bool                     `json:"is_favorite"`
}

type RecentAccessIncludes struct {
	Libraries map[string]RecentAccessLibrarySummary `json:"libraries,omitempty"`
	Spaces    map[string]RecentAccessSpaceSummary   `json:"spaces,omitempty"`
	Users     map[string]RecentAccessUserSummary    `json:"users,omitempty"`
}

type RecentAccessListResponse struct {
	Items    []RecentAccessItem    `json:"items"`
	Includes *RecentAccessIncludes `json:"includes,omitempty"`
}

func parseTabResourceType(raw int) (*int, error) {
	if raw == 0 {
		return nil, nil
	}
	if raw != model.RESOURCE_TYPE_LIBRARY && raw != model.RESOURCE_TYPE_FILE {
		return nil, errors.New("资源类型无效")
	}
	return &raw, nil
}

func rejectLegacyPageParam(c *gin.Context) bool {
	if _, ok := c.GetQuery("page"); !ok {
		return false
	}
	c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("新路由仅支持 offset/limit，不支持 page 参数")))
	return true
}

func normalizeTabPageLimit(page, limit, defaultLimit, maxLimit int) (int, int) {
	if page <= 0 {
		page = 1
	}
	if limit <= 0 {
		limit = defaultLimit
	}
	if maxLimit > 0 && limit > maxLimit {
		limit = maxLimit
	}
	return page, limit
}

func normalizeTabOffsetLimit(offset, limit, defaultLimit, maxLimit int) (int, int) {
	if offset < 0 {
		offset = 0
	}
	if limit <= 0 {
		limit = defaultLimit
	}
	if maxLimit > 0 && limit > maxLimit {
		limit = maxLimit
	}
	return offset, limit
}

func paginateAnySlice[T any](items []T, page, limit int) []T {
	if len(items) == 0 {
		return items
	}
	if page <= 1 {
		start := 0
		end := limit
		if end > len(items) {
			end = len(items)
		}
		return items[start:end]
	}

	start := (page - 1) * limit
	if start >= len(items) {
		return []T{}
	}
	end := start + limit
	if end > len(items) {
		end = len(items)
	}
	return items[start:end]
}

func paginateOffsetSlice[T any](items []T, offset, limit int) []T {
	if len(items) == 0 {
		return items
	}
	if offset < 0 {
		offset = 0
	}
	if limit <= 0 {
		return []T{}
	}
	if offset >= len(items) {
		return []T{}
	}
	end := offset + limit
	if end > len(items) {
		end = len(items)
	}
	return items[offset:end]
}

func shouldIncludeRecentAccessLibrarySummary(library *RecentAccessLibrarySummary) bool {
	if library == nil {
		return false
	}
	return library.LibraryKind != model.LIBRARY_KIND_PERSONAL_USER
}

func shouldIncludeRecentAccessSpaceSummary(item recentAccessItem) bool {
	if item.space == nil {
		return false
	}
	if item.library != nil && item.library.LibraryKind == model.LIBRARY_KIND_PERSONAL_USER {
		return false
	}
	return true
}

var searchTabFileIDsByKeyword = func(eid int64, fileIDs []int64, keyword string) ([]int64, error) {
	keyword = strings.TrimSpace(keyword)
	if keyword == "" || len(fileIDs) == 0 {
		return fileIDs, nil
	}

	esClient := elasticsearch.GetGlobalClient()
	if esClient != nil && !esClient.IsDisabled() {
		esSearchService := elasticsearch.NewFileNameSearchService(esClient, model.DB)
		response, err := esSearchService.Search(eid, &elasticsearch.FileNameSearchRequest{
			Query:    keyword,
			TopK:     len(fileIDs),
			FileIDs:  fileIDs,
			FileType: nil,
		})
		if err == nil {
			matched := make(map[int64]struct{}, len(response.Results))
			for _, result := range response.Results {
				matched[result.FileID] = struct{}{}
			}
			filtered := make([]int64, 0, len(fileIDs))
			for _, id := range fileIDs {
				if _, ok := matched[id]; ok {
					filtered = append(filtered, id)
				}
			}
			return filtered, nil
		}
	}

	var files []model.File
	if err := model.DB.Where("eid = ? AND is_deleted = ? AND id IN ? AND path LIKE ?", eid, false, fileIDs, "%"+keyword+"%").Find(&files).Error; err != nil {
		return nil, err
	}
	matched := make(map[int64]struct{}, len(files))
	for _, file := range files {
		matched[file.ID] = struct{}{}
	}
	filtered := make([]int64, 0, len(fileIDs))
	for _, id := range fileIDs {
		if _, ok := matched[id]; ok {
			filtered = append(filtered, id)
		}
	}
	return filtered, nil
}

var getUserRecentBrowseHistoryPage = model.GetUserRecentBrowseHistoryPage

func encodeRecentAccessID(id int64) string {
	if id <= 0 {
		return ""
	}
	encoded, err := hashids.Encode(id)
	if err != nil {
		return ""
	}
	return encoded
}

func buildRecentAccessItemsFromHistories(eid int64, histories []model.UserBrowseHistory, keyword string) ([]recentAccessItem, error) {
	if len(histories) == 0 {
		return []recentAccessItem{}, nil
	}

	fileIDs := make([]int64, 0, len(histories))
	libraryIDs := make([]int64, 0, len(histories))
	fileSeen := make(map[int64]struct{}, len(histories))
	librarySeen := make(map[int64]struct{}, len(histories))

	for _, history := range histories {
		if history.FileID > 0 {
			if _, ok := fileSeen[history.FileID]; !ok {
				fileSeen[history.FileID] = struct{}{}
				fileIDs = append(fileIDs, history.FileID)
			}
			if history.LibraryID > 0 {
				if _, ok := librarySeen[history.LibraryID]; !ok {
					librarySeen[history.LibraryID] = struct{}{}
					libraryIDs = append(libraryIDs, history.LibraryID)
				}
			}
			continue
		}
		if history.LibraryID > 0 {
			if _, ok := librarySeen[history.LibraryID]; !ok {
				librarySeen[history.LibraryID] = struct{}{}
				libraryIDs = append(libraryIDs, history.LibraryID)
			}
		}
	}

	matchedFileIDs := fileIDs
	if strings.TrimSpace(keyword) != "" && len(fileIDs) > 0 {
		var err error
		matchedFileIDs, err = searchTabFileIDsByKeyword(eid, fileIDs, keyword)
		if err != nil {
			return nil, err
		}
	}
	matchedFileIDSet := make(map[int64]struct{}, len(matchedFileIDs))
	for _, id := range matchedFileIDs {
		matchedFileIDSet[id] = struct{}{}
	}

	filesByID := map[int64]*model.File{}
	if len(matchedFileIDs) > 0 {
		files, err := model.GetFilesByIDs(eid, matchedFileIDs)
		if err != nil {
			return nil, err
		}
		for i := range files {
			if files[i].IsDeleted {
				continue
			}
			file := files[i]
			filesByID[file.ID] = &file
		}
	}

	librariesByID := map[int64]*model.Library{}
	if len(libraryIDs) > 0 {
		libraries, err := model.GetLibrariesByIDs(eid, libraryIDs)
		if err != nil {
			return nil, err
		}
		for i := range libraries {
			library := libraries[i]
			librariesByID[library.ID] = &library
		}
	}

	matchedLibraryIDs := make(map[int64]struct{}, len(libraryIDs))
	if strings.TrimSpace(keyword) != "" && len(libraryIDs) > 0 {
		matchedLibraries, err := model.GetLibrariesByIDsAndName(eid, libraryIDs, keyword)
		if err != nil {
			return nil, err
		}
		for i := range matchedLibraries {
			matchedLibraryIDs[matchedLibraries[i].ID] = struct{}{}
		}
	}

	spaceIDs := make([]int64, 0, len(librariesByID))
	spaceSeen := make(map[int64]struct{}, len(librariesByID))
	for _, library := range librariesByID {
		if library == nil || library.SpaceID <= 0 {
			continue
		}
		if _, ok := spaceSeen[library.SpaceID]; ok {
			continue
		}
		spaceSeen[library.SpaceID] = struct{}{}
		spaceIDs = append(spaceIDs, library.SpaceID)
	}

	spacesByID := map[int64]*model.Space{}
	if len(spaceIDs) > 0 {
		spaces, err := model.GetSpacesByIDs(eid, spaceIDs)
		if err != nil {
			return nil, err
		}
		for i := range spaces {
			space := spaces[i]
			spacesByID[space.ID] = &space
		}
	}

	items := make([]recentAccessItem, 0, len(histories))
	for _, history := range histories {
		switch {
		case history.FileID > 0:
			if strings.TrimSpace(keyword) != "" {
				if _, ok := matchedFileIDSet[history.FileID]; !ok {
					continue
				}
			}
			file, ok := filesByID[history.FileID]
			if !ok || file == nil {
				continue
			}
			library, ok := librariesByID[file.LibraryID]
			if !ok || library == nil {
				continue
			}
			visibleFile := *file
			trimPersonalLibraryFilePath(&visibleFile, library)
			visiblePath := visibleFile.Path
			creatorID := file.UserID
			if creatorID == 0 {
				creatorID = library.CreatorID
			}
			items = append(items, recentAccessItem{
				resourceType: model.RESOURCE_TYPE_FILE,
				resourceID:   file.ID,
				file: &RecentAccessFileSummary{
					ID:           encodeRecentAccessID(file.ID),
					Path:         visiblePath,
					Type:         file.Type,
					OriginType:   file.OriginType,
					OriginSource: file.OriginSource,
				},
				library: &RecentAccessLibrarySummary{
					ID:          encodeRecentAccessID(library.ID),
					Name:        library.Name,
					LibraryKind: library.LibraryKind,
					SpaceID:     encodeRecentAccessID(library.SpaceID),
				},
				libraryID:  library.ID,
				spaceID:    library.SpaceID,
				creatorID:  creatorID,
				recentTime: history.UpdatedTime,
			})
		case history.LibraryID > 0:
			library, ok := librariesByID[history.LibraryID]
			if !ok || library == nil {
				continue
			}
			if strings.TrimSpace(keyword) != "" {
				if _, ok := matchedLibraryIDs[library.ID]; !ok {
					continue
				}
			}
			items = append(items, recentAccessItem{
				resourceType: model.RESOURCE_TYPE_LIBRARY,
				resourceID:   library.ID,
				library: &RecentAccessLibrarySummary{
					ID:          encodeRecentAccessID(library.ID),
					Name:        library.Name,
					LibraryKind: library.LibraryKind,
					SpaceID:     encodeRecentAccessID(library.SpaceID),
				},
				libraryID:  library.ID,
				spaceID:    library.SpaceID,
				creatorID:  library.CreatorID,
				recentTime: history.UpdatedTime,
			})
		}
	}

	for i := range items {
		if items[i].libraryID > 0 {
			if library, ok := librariesByID[items[i].libraryID]; ok && library != nil {
				items[i].library = &RecentAccessLibrarySummary{
					ID:          encodeRecentAccessID(library.ID),
					Name:        library.Name,
					LibraryKind: library.LibraryKind,
					SpaceID:     encodeRecentAccessID(library.SpaceID),
				}
				if items[i].spaceID <= 0 {
					items[i].spaceID = library.SpaceID
				}
			}
		}
		if items[i].spaceID > 0 {
			if space, ok := spacesByID[items[i].spaceID]; ok && space != nil {
				items[i].space = &RecentAccessSpaceSummary{
					ID:        encodeRecentAccessID(space.ID),
					Name:      space.Name,
					SpaceKind: space.SpaceKind,
				}
			} else {
				continue
			}
		}
	}

	if err := attachRecentAccessCreators(eid, items); err != nil {
		return nil, err
	}

	return items, nil
}

func loadRecentAccessItemsPaged(eid, userID int64, libraryID int64, resourceTypeFilter *int, offset, limit int) ([]recentAccessItem, error) {
	histories, err := getUserRecentBrowseHistoryPage(eid, userID, libraryID, resourceTypeFilter, offset, limit)
	if err != nil {
		return nil, err
	}
	return buildRecentAccessItemsFromHistories(eid, histories, "")
}

func loadRecentAccessItemsByKeyword(eid, userID int64, libraryID int64, resourceTypeFilter *int, keyword string, offset, limit int) ([]recentAccessItem, error) {
	if limit <= 0 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}

	if resourceTypeFilter != nil && *resourceTypeFilter == model.RESOURCE_TYPE_LIBRARY {
		histories, err := model.GetUserRecentLibrariesByKeyword(eid, userID, libraryID, keyword, offset, limit)
		if err != nil {
			return nil, err
		}
		return buildRecentAccessItemsFromHistories(eid, histories, "")
	}

	if resourceTypeFilter != nil && *resourceTypeFilter == model.RESOURCE_TYPE_FILE {
		histories, err := model.GetUserRecentFilesByKeyword(eid, userID, libraryID, keyword, offset, limit)
		if err != nil {
			return nil, err
		}
		return buildRecentAccessItemsFromHistories(eid, histories, "")
	}

	if resourceTypeFilter == nil {
		return loadRecentAccessItemsByKeywordAll(eid, userID, libraryID, keyword, offset, limit)
	}

	target := offset + limit
	if target <= 0 {
		target = limit
	}

	collected := make([]recentAccessItem, 0, target)
	batchOffset := 0
	batchSize := limit
	for {
		histories, err := getUserRecentBrowseHistoryPage(eid, userID, libraryID, resourceTypeFilter, batchOffset, batchSize)
		if err != nil {
			return nil, err
		}
		if len(histories) == 0 {
			break
		}

		items, buildErr := buildRecentAccessItemsFromHistories(eid, histories, keyword)
		if buildErr != nil {
			return nil, buildErr
		}
		collected = append(collected, items...)

		if len(collected) >= target || len(histories) < batchSize {
			break
		}
		batchOffset += batchSize
	}

	return paginateOffsetSlice(collected, offset, limit), nil
}

func loadRecentAccessItemsByKeywordAll(eid, userID int64, libraryID int64, keyword string, offset, limit int) ([]recentAccessItem, error) {
	if limit <= 0 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}

	target := offset + limit
	if target <= 0 {
		target = limit
	}

	batchSize := limit
	if batchSize < 20 {
		batchSize = 20
	}

	sources := []*recentAccessAllSource{
		newRecentAccessAllSource(
			func(sourceOffset, sourceLimit int) ([]model.UserBrowseHistory, error) {
				return model.GetUserRecentFilesByKeyword(eid, userID, libraryID, keyword, sourceOffset, sourceLimit)
			},
			func(batch []model.UserBrowseHistory) ([]recentAccessItem, error) {
				return buildRecentAccessItemsFromHistories(eid, batch, "")
			},
		),
		newRecentAccessAllSource(
			func(sourceOffset, sourceLimit int) ([]model.UserBrowseHistory, error) {
				return model.GetUserRecentLibrariesByKeyword(eid, userID, libraryID, keyword, sourceOffset, sourceLimit)
			},
			func(batch []model.UserBrowseHistory) ([]recentAccessItem, error) {
				return buildRecentAccessItemsFromHistories(eid, batch, "")
			},
		),
	}

	items := make([]recentAccessItem, 0, target)
	for len(items) < target {
		progressed := false
		for _, source := range sources {
			if err := source.ensureBuffer(batchSize); err != nil {
				return nil, err
			}
			if source.hasItem() {
				progressed = true
			}
		}
		if !progressed {
			break
		}

		bestIdx := -1
		for idx, source := range sources {
			if !source.hasItem() {
				continue
			}
			if bestIdx < 0 || recentAccessItemMoreRecent(source.peekItem(), sources[bestIdx].peekItem()) {
				bestIdx = idx
			}
		}
		if bestIdx < 0 {
			break
		}
		items = append(items, sources[bestIdx].popItem())
	}

	return paginateOffsetSlice(items, offset, limit), nil
}

type recentAccessAllSource struct {
	offset     int
	done       bool
	items      []recentAccessItem
	fetchBatch func(offset, limit int) ([]model.UserBrowseHistory, error)
	buildItems func([]model.UserBrowseHistory) ([]recentAccessItem, error)
}

func newRecentAccessAllSource(fetchBatch func(offset, limit int) ([]model.UserBrowseHistory, error), buildItems func([]model.UserBrowseHistory) ([]recentAccessItem, error)) *recentAccessAllSource {
	return &recentAccessAllSource{fetchBatch: fetchBatch, buildItems: buildItems}
}

func (s *recentAccessAllSource) ensureBuffer(batchSize int) error {
	for len(s.items) == 0 && !s.done {
		batch, err := s.fetchBatch(s.offset, batchSize)
		if err != nil {
			return err
		}
		s.offset += len(batch)
		if len(batch) < batchSize {
			s.done = true
		}
		if len(batch) == 0 {
			return nil
		}
		batchItems, err := s.buildItems(batch)
		if err != nil {
			return err
		}
		if len(batchItems) > 0 {
			s.items = append(s.items, batchItems...)
		}
	}
	return nil
}

func (s *recentAccessAllSource) hasItem() bool {
	return len(s.items) > 0
}

func (s *recentAccessAllSource) peekItem() recentAccessItem {
	if len(s.items) == 0 {
		return recentAccessItem{}
	}
	return s.items[0]
}

func (s *recentAccessAllSource) popItem() recentAccessItem {
	if len(s.items) == 0 {
		return recentAccessItem{}
	}
	item := s.items[0]
	s.items = s.items[1:]
	return item
}

func recentAccessItemMoreRecent(a, b recentAccessItem) bool {
	if a.recentTime == b.recentTime {
		if a.resourceType == b.resourceType {
			return a.resourceID > b.resourceID
		}
		return a.resourceType < b.resourceType
	}
	return a.recentTime > b.recentTime
}

func markRecentAccessFavoriteState(userID int64, items []recentAccessItem) error {
	fileIDs := make([]int64, 0, len(items))
	libraryIDs := make([]int64, 0, len(items))
	for _, item := range items {
		switch item.resourceType {
		case model.RESOURCE_TYPE_FILE:
			if item.resourceID > 0 {
				fileIDs = append(fileIDs, item.resourceID)
			}
		case model.RESOURCE_TYPE_LIBRARY:
			if item.resourceID > 0 {
				libraryIDs = append(libraryIDs, item.resourceID)
			}
		}
	}

	fileFavoriteMap, err := model.GetFavoriteResourceIDMap(userID, model.RESOURCE_TYPE_FILE, fileIDs)
	if err != nil {
		return err
	}
	libraryFavoriteMap, err := model.GetFavoriteResourceIDMap(userID, model.RESOURCE_TYPE_LIBRARY, libraryIDs)
	if err != nil {
		return err
	}

	for i := range items {
		switch items[i].resourceType {
		case model.RESOURCE_TYPE_FILE:
			if items[i].resourceID > 0 {
				items[i].isFavorite = fileFavoriteMap[items[i].resourceID]
			}
		case model.RESOURCE_TYPE_LIBRARY:
			if items[i].resourceID > 0 {
				items[i].isFavorite = libraryFavoriteMap[items[i].resourceID]
			}
		}
	}

	return nil
}

func attachRecentAccessCreators(eid int64, items []recentAccessItem) error {
	creatorIDs := make([]int64, 0, len(items))
	seen := make(map[int64]struct{}, len(items))
	for _, item := range items {
		if item.creatorID <= 0 {
			continue
		}
		if _, ok := seen[item.creatorID]; ok {
			continue
		}
		seen[item.creatorID] = struct{}{}
		creatorIDs = append(creatorIDs, item.creatorID)
	}

	if len(creatorIDs) == 0 {
		return nil
	}

	users, err := model.GetUsersByIDsAndEid(eid, creatorIDs)
	if err != nil {
		return err
	}
	userMap := make(map[int64]*model.User, len(users))
	for _, user := range users {
		if user == nil {
			continue
		}
		userMap[user.UserID] = user
	}

	for i := range items {
		if items[i].creatorID <= 0 {
			continue
		}
		if user, ok := userMap[items[i].creatorID]; ok && user != nil {
			items[i].creator = &RecentAccessUserSummary{
				ID:       encodeRecentAccessID(user.UserID),
				Nickname: user.Nickname,
				Username: user.Username,
			}
		}
	}

	return nil
}

func toRecentAccessResponse(items []recentAccessItem) RecentAccessListResponse {
	resp := RecentAccessListResponse{
		Items: make([]RecentAccessItem, 0, len(items)),
		Includes: &RecentAccessIncludes{
			Libraries: map[string]RecentAccessLibrarySummary{},
			Spaces:    map[string]RecentAccessSpaceSummary{},
			Users:     map[string]RecentAccessUserSummary{},
		},
	}
	for _, item := range items {
		if shouldIncludeRecentAccessLibrarySummary(item.library) {
			resp.Includes.Libraries[item.library.ID] = *item.library
		}
		if shouldIncludeRecentAccessSpaceSummary(item) {
			resp.Includes.Spaces[item.space.ID] = *item.space
		}
		if item.creator != nil {
			resp.Includes.Users[item.creator.ID] = *item.creator
		}
		resp.Items = append(resp.Items, RecentAccessItem{
			ResourceType: item.resourceType,
			ResourceID:   encodeRecentAccessID(item.resourceID),
			File:         item.file,
			LibraryID:    encodeRecentAccessID(item.libraryID),
			SpaceID:      encodeRecentAccessID(item.spaceID),
			CreatorID:    encodeRecentAccessID(item.creatorID),
			RecentTime:   item.recentTime,
			IsFavorite:   item.isFavorite,
		})
	}
	if len(resp.Includes.Libraries) == 0 && len(resp.Includes.Spaces) == 0 && len(resp.Includes.Users) == 0 {
		resp.Includes = nil
	}
	return resp
}
