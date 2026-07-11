package controller

import (
	"errors"
	"net/http"
	"strings"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type FavoriteRequest struct {
	ResourceType        int   `json:"resource_type"`
	ResourceID          int64 `json:"resource_id"`
	SandboxOutputFileID int64 `json:"sandbox_output_file_id,omitempty"`
}

// ToggleFavorite godoc
// @Summary 切换收藏状态
// @Description 切换指定资源的收藏状态（收藏/取消）
// @Tags 收藏
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body FavoriteRequest true "收藏信息"
// @Success 200 {object} model.CommonResponse
// @Router /api/favorites/toggle [post]
func ToggleFavorite(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	var req FavoriteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	var resourceType int
	var resourceID int64

	if req.ResourceID <= 0 {
		if req.SandboxOutputFileID <= 0 {
			c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("resource_id 不能为空")))
			return
		}
	}
	if req.SandboxOutputFileID > 0 {
		if req.ResourceType != 0 && req.ResourceType != model.RESOURCE_TYPE_FILE {
			c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("sandbox_output_file_id 仅支持文件收藏")))
			return
		}

		file, err := model.GetAIGeneratedFileBySandboxOutputFileID(eid, req.SandboxOutputFileID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				c.JSON(http.StatusNotFound, model.NotFound.ToResponse(errors.New("关联的 AI 生成文件不存在")))
				return
			}
			logger.Errorf(c, "GetAIGeneratedFileBySandboxOutputFileID error: %v", err)
			c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
			return
		}
		resourceType = model.RESOURCE_TYPE_FILE
		resourceID = file.ID
	} else {
		switch req.ResourceType {
		case model.RESOURCE_TYPE_FILE:
			_, err := model.GetFileByID(eid, req.ResourceID)
			if err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					c.JSON(http.StatusNotFound, model.NotFound.ToResponse(errors.New("文件不存在")))
					return
				}
				logger.Errorf(c, "GetFileByID error: %v", err)
				c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
				return
			}
		case model.RESOURCE_TYPE_LIBRARY:
			_, err := model.GetLibraryByID(eid, req.ResourceID)
			if err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					c.JSON(http.StatusNotFound, model.NotFound.ToResponse(errors.New("知识库不存在")))
					return
				}
				logger.Errorf(c, "GetLibraryByID error: %v", err)
				c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
				return
			}
		case RESOURCE_TYPE_UPLOAD_FILE:
			files, err := model.GetFilesByUploadFileID(req.ResourceID)
			if err != nil {
				logger.Errorf(c, "GetFilesByUploadFileID error: %v", err)
				c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
				return
			}
			if len(files) == 0 {
				c.JSON(http.StatusNotFound, model.NotFound.ToResponse(errors.New("上传文件关联的文件不存在")))
				return
			}
			resourceType = model.RESOURCE_TYPE_FILE
			resourceID = files[0].ID
		default:
			c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("资源类型无效")))
			return
		}
		if resourceID == 0 {
			resourceType = req.ResourceType
			resourceID = req.ResourceID
		}
	}

	if err := model.ToggleFavorite(userID, resourceType, resourceID); err != nil {
		logger.Errorf(c, "ToggleFavorite error: %v", err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}

type FavoriteFileItem struct {
	File         model.File     `json:"file"`
	Library      *model.Library `json:"library,omitempty"`
	Space        *model.Space   `json:"space,omitempty"`
	FavoriteTime int64          `json:"favorite_time"`
}

type FavoriteLibraryItem struct {
	Library      model.Library `json:"library"`
	Space        *model.Space  `json:"space,omitempty"`
	FavoriteTime int64         `json:"favorite_time"`
}

type FavoritesListResponse struct {
	Files     []FavoriteFileItem    `json:"files"`
	Libraries []FavoriteLibraryItem `json:"libraries"`
}

type favoriteListItem struct {
	resourceType int
	resourceID   int64
	file         *model.File
	library      *model.Library
	space        *model.Space
	favoriteTime int64
}

type favoritesListQuery struct {
	ResourceType int    `form:"resource_type"`
	Keyword      string `form:"keyword"`
	Offset       int    `form:"offset"`
	Limit        int    `form:"limit"`
}

var getUserFavoritesForList = model.GetUserFavoritesForList

func loadFavoriteListItems(eid, userID int64, resourceTypeFilter *int, keyword string, offset, limit int) ([]favoriteListItem, error) {
	keyword = strings.TrimSpace(keyword)
	if keyword == "" {
		favs, queryErr := getUserFavoritesForList(userID, model.FavoriteListQuery{
			ResourceType: resourceTypeFilter,
			Offset:       offset,
			Limit:        limit,
			Eid:          eid,
		})
		if queryErr != nil {
			return nil, queryErr
		}
		return buildFavoriteItemsFromFavorites(eid, favs, "")
	}

	if resourceTypeFilter != nil && *resourceTypeFilter == model.RESOURCE_TYPE_LIBRARY {
		favs, queryErr := model.GetUserFavoriteLibrariesByKeyword(userID, eid, keyword, offset, limit)
		if queryErr != nil {
			return nil, queryErr
		}
		return buildFavoriteItemsFromFavorites(eid, favs, "")
	}

	if resourceTypeFilter != nil && *resourceTypeFilter == model.RESOURCE_TYPE_FILE {
		favs, queryErr := model.GetUserFavoriteFilesByKeyword(userID, eid, keyword, offset, limit)
		if queryErr != nil {
			return nil, queryErr
		}
		return buildFavoriteItemsFromFavorites(eid, favs, "")
	}

	if resourceTypeFilter == nil {
		return loadFavoriteListItemsByKeywordAll(eid, userID, keyword, offset, limit)
	}

	return loadFavoriteListItemsByKeywordPaged(eid, userID, resourceTypeFilter, keyword, offset, limit)
}

func loadFavoriteListItemsByKeywordAll(eid, userID int64, keyword string, offset, limit int) ([]favoriteListItem, error) {
	if limit <= 0 {
		limit = 30
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

	sources := []*favoriteAllSource{
		newFavoriteAllSource(
			func(sourceOffset, sourceLimit int) ([]model.Favorite, error) {
				return model.GetUserFavoriteFilesByKeyword(userID, eid, keyword, sourceOffset, sourceLimit)
			},
			func(batch []model.Favorite) ([]favoriteListItem, error) {
				return buildFavoriteItemsFromFavorites(eid, batch, "")
			},
		),
		newFavoriteAllSource(
			func(sourceOffset, sourceLimit int) ([]model.Favorite, error) {
				return model.GetUserFavoriteLibrariesByKeyword(userID, eid, keyword, sourceOffset, sourceLimit)
			},
			func(batch []model.Favorite) ([]favoriteListItem, error) {
				return buildFavoriteItemsFromFavorites(eid, batch, "")
			},
		),
	}

	items := make([]favoriteListItem, 0, target)
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
			if bestIdx < 0 || favoriteListItemMoreRecent(source.peekItem(), sources[bestIdx].peekItem()) {
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

type favoriteAllSource struct {
	offset     int
	done       bool
	items      []favoriteListItem
	fetchBatch func(offset, limit int) ([]model.Favorite, error)
	buildItems func([]model.Favorite) ([]favoriteListItem, error)
}

func newFavoriteAllSource(fetchBatch func(offset, limit int) ([]model.Favorite, error), buildItems func([]model.Favorite) ([]favoriteListItem, error)) *favoriteAllSource {
	return &favoriteAllSource{fetchBatch: fetchBatch, buildItems: buildItems}
}

func (s *favoriteAllSource) ensureBuffer(batchSize int) error {
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

func (s *favoriteAllSource) hasItem() bool {
	return len(s.items) > 0
}

func (s *favoriteAllSource) peekItem() favoriteListItem {
	if len(s.items) == 0 {
		return favoriteListItem{}
	}
	return s.items[0]
}

func (s *favoriteAllSource) popItem() favoriteListItem {
	if len(s.items) == 0 {
		return favoriteListItem{}
	}
	item := s.items[0]
	s.items = s.items[1:]
	return item
}

func favoriteListItemMoreRecent(a, b favoriteListItem) bool {
	if a.favoriteTime == b.favoriteTime {
		if a.resourceType == b.resourceType {
			return a.resourceID > b.resourceID
		}
		return a.resourceType < b.resourceType
	}
	return a.favoriteTime > b.favoriteTime
}

func loadFavoriteListItemsByKeywordPaged(eid, userID int64, resourceTypeFilter *int, keyword string, offset, limit int) ([]favoriteListItem, error) {
	if limit <= 0 {
		limit = 30
	}
	if offset < 0 {
		offset = 0
	}

	target := offset + limit
	if target <= 0 {
		target = limit
	}

	collected := make([]favoriteListItem, 0, target)
	batchOffset := 0
	batchSize := limit
	for {
		favs, queryErr := getUserFavoritesForList(userID, model.FavoriteListQuery{
			ResourceType: resourceTypeFilter,
			Offset:       batchOffset,
			Limit:        batchSize,
			Eid:          eid,
		})
		if queryErr != nil {
			return nil, queryErr
		}
		if len(favs) == 0 {
			break
		}

		items, buildErr := buildFavoriteItemsFromFavorites(eid, favs, keyword)
		if buildErr != nil {
			return nil, buildErr
		}
		collected = append(collected, items...)

		if len(collected) >= target || len(favs) < batchSize {
			break
		}
		batchOffset += batchSize
	}

	return paginateOffsetSlice(collected, offset, limit), nil
}

func convertFavoriteItemsToRecentAccessItems(items []favoriteListItem) []recentAccessItem {
	if len(items) == 0 {
		return []recentAccessItem{}
	}

	recentItems := make([]recentAccessItem, 0, len(items))
	for _, item := range items {
		switch item.resourceType {
		case model.RESOURCE_TYPE_FILE:
			if item.file == nil {
				continue
			}
			creatorID := item.file.UserID
			if creatorID == 0 && item.library != nil {
				creatorID = item.library.CreatorID
			}
			var librarySummary *RecentAccessLibrarySummary
			if item.library != nil {
				librarySummary = &RecentAccessLibrarySummary{
					ID:          encodeRecentAccessID(item.library.ID),
					Name:        item.library.Name,
					LibraryKind: item.library.LibraryKind,
					SpaceID:     encodeRecentAccessID(item.library.SpaceID),
				}
			}
			var spaceSummary *RecentAccessSpaceSummary
			if item.space != nil {
				spaceSummary = &RecentAccessSpaceSummary{
					ID:        encodeRecentAccessID(item.space.ID),
					Name:      item.space.Name,
					SpaceKind: item.space.SpaceKind,
				}
			}
			recentItems = append(recentItems, recentAccessItem{
				resourceType: model.RESOURCE_TYPE_FILE,
				resourceID:   item.file.ID,
				file: &RecentAccessFileSummary{
					ID:           encodeRecentAccessID(item.file.ID),
					Path:         item.file.Path,
					Type:         item.file.Type,
					OriginType:   item.file.OriginType,
					OriginSource: item.file.OriginSource,
				},
				libraryID: func() int64 {
					if item.library != nil {
						return item.library.ID
					}
					return 0
				}(),
				spaceID: func() int64 {
					if item.space != nil {
						return item.space.ID
					}
					return 0
				}(),
				creatorID:  creatorID,
				library:    librarySummary,
				space:      spaceSummary,
				recentTime: item.favoriteTime,
				isFavorite: true,
			})
		case model.RESOURCE_TYPE_LIBRARY:
			if item.library == nil {
				continue
			}
			var spaceSummary *RecentAccessSpaceSummary
			if item.space != nil {
				spaceSummary = &RecentAccessSpaceSummary{
					ID:        encodeRecentAccessID(item.space.ID),
					Name:      item.space.Name,
					SpaceKind: item.space.SpaceKind,
				}
			}
			recentItems = append(recentItems, recentAccessItem{
				resourceType: model.RESOURCE_TYPE_LIBRARY,
				resourceID:   item.library.ID,
				library: &RecentAccessLibrarySummary{
					ID:          encodeRecentAccessID(item.library.ID),
					Name:        item.library.Name,
					LibraryKind: item.library.LibraryKind,
					SpaceID:     encodeRecentAccessID(item.library.SpaceID),
				},
				libraryID: item.library.ID,
				spaceID: func() int64 {
					if item.space != nil {
						return item.space.ID
					}
					return item.library.SpaceID
				}(),
				creatorID:  item.library.CreatorID,
				space:      spaceSummary,
				recentTime: item.favoriteTime,
				isFavorite: true,
			})
		}
	}

	return recentItems
}

// ListFavorites godoc
// @Summary 获取当前用户收藏列表
// @Description 返回所有收藏的资源，倒序按收藏时间，不分页。文件附带来源（空间/知识库）。
// @Tags 收藏
// @Accept json
// @Produce json
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse{data=FavoritesListResponse}
// @Router /api/favorites [get]
func ListFavorites(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	// 拉取当前用户所有 Active 收藏
	favs, err := model.GetUserFavorites(userID, nil)
	if err != nil {
		logger.Errorf(c, "ListFavorites query error: %v", err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	resp := FavoritesListResponse{
		Files:     []FavoriteFileItem{},
		Libraries: []FavoriteLibraryItem{},
	}

	domain := config.GetProtocol(c) + "://" + config.GetDomain(c)
	for _, f := range favs {
		switch f.ResourceType {
		case model.RESOURCE_TYPE_FILE:
			file, err := model.GetFileByID(eid, f.ResourceID)
			if err != nil || file == nil {
				// 跳过无效记录
				continue
			}
			lib, _ := model.GetLibraryByID(eid, file.LibraryID)
			var space *model.Space
			if lib != nil {
				space, _ = model.GetSpaceByID(eid, lib.SpaceID)
				trimPersonalLibraryFilePath(file, lib)
			}
			file.IsFavorite = true
			resp.Files = append(resp.Files, FavoriteFileItem{
				File:         *file,
				Library:      lib,
				Space:        space,
				FavoriteTime: f.UpdatedTime,
			})
		case model.RESOURCE_TYPE_LIBRARY:
			lib, err := model.GetLibraryByID(eid, f.ResourceID)
			if err != nil || lib == nil {
				continue
			}
			// 如果 icon 地址没有最前面的域名则把当前请求的域名拼接进去
			lib.Icon = domain + lib.Icon
			space, _ := model.GetSpaceByID(eid, lib.SpaceID)
			resp.Libraries = append(resp.Libraries, FavoriteLibraryItem{
				Library:      *lib,
				Space:        space,
				FavoriteTime: f.UpdatedTime,
			})
		default:
			// 其他类型暂不处理
			continue
		}
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(resp))
}

// GetMySpaceFavorites godoc
// @Summary 获取我的收藏（统一结构）
// @Description 返回当前用户收藏的文件/知识库单列表，结构与最近访问保持一致；新路由优先用于前端新迭代。
// @Tags 我的空间
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param resource_type query int false "资源类型筛选，仅支持 1（知识库）或 2（文件）"
// @Param offset query int false "偏移量" default(0)
// @Param limit query int false "每页数量" default(30)
// @Param keyword query string false "当前 Tab 内关键词搜索"
// @Success 200 {object} model.CommonResponse{data=controller.RecentAccessListResponse}
// @Router /api/my-space/favorites [get]
func GetMySpaceFavorites(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	var req favoritesListQuery
	if err := c.ShouldBindQuery(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	if rejectLegacyPageParam(c) {
		return
	}

	resourceTypeFilter, err := parseTabResourceType(req.ResourceType)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	req.Offset, req.Limit = normalizeTabOffsetLimit(req.Offset, req.Limit, 30, 100)

	items, queryErr := loadFavoriteListItems(eid, userID, resourceTypeFilter, req.Keyword, req.Offset, req.Limit)
	if queryErr != nil {
		logger.Errorf(c, "GetMySpaceFavorites query error: %v", queryErr)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(queryErr))
		return
	}

	recentItems := convertFavoriteItemsToRecentAccessItems(items)
	if err := attachRecentAccessCreators(eid, recentItems); err != nil {
		logger.Errorf(c, "GetMySpaceFavorites attach creators error: %v", err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}
	resp := toRecentAccessResponse(recentItems)
	c.JSON(http.StatusOK, model.Success.ToResponse(resp))
}

func buildFavoriteItemsFromFavorites(eid int64, favs []model.Favorite, keyword string) ([]favoriteListItem, error) {
	if len(favs) == 0 {
		return []favoriteListItem{}, nil
	}

	fileIDs := make([]int64, 0, len(favs))
	libraryIDs := make([]int64, 0, len(favs))
	for _, fav := range favs {
		switch fav.ResourceType {
		case model.RESOURCE_TYPE_FILE:
			fileIDs = append(fileIDs, fav.ResourceID)
		case model.RESOURCE_TYPE_LIBRARY:
			libraryIDs = append(libraryIDs, fav.ResourceID)
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

	items := make([]favoriteListItem, 0, len(favs))
	for _, fav := range favs {
		switch fav.ResourceType {
		case model.RESOURCE_TYPE_FILE:
			if strings.TrimSpace(keyword) != "" {
				if _, ok := matchedFileIDSet[fav.ResourceID]; !ok {
					continue
				}
			}
			file, ok := filesByID[fav.ResourceID]
			if !ok || file == nil {
				continue
			}
			lib, _ := model.GetLibraryByID(eid, file.LibraryID)
			var space *model.Space
			if lib != nil {
				space, _ = model.GetSpaceByID(eid, lib.SpaceID)
				trimPersonalLibraryFilePath(file, lib)
			}
			file.IsFavorite = true
			items = append(items, favoriteListItem{
				resourceType: model.RESOURCE_TYPE_FILE,
				resourceID:   fav.ResourceID,
				file:         file,
				library:      lib,
				space:        space,
				favoriteTime: fav.UpdatedTime,
			})
		case model.RESOURCE_TYPE_LIBRARY:
			lib, ok := librariesByID[fav.ResourceID]
			if !ok || lib == nil {
				continue
			}
			if strings.TrimSpace(keyword) != "" {
				if _, ok := matchedLibraryIDs[lib.ID]; !ok {
					continue
				}
			}
			space := spacesByID[lib.SpaceID]
			items = append(items, favoriteListItem{
				resourceType: model.RESOURCE_TYPE_LIBRARY,
				resourceID:   lib.ID,
				library:      lib,
				space:        space,
				favoriteTime: fav.UpdatedTime,
			})
		}
	}

	return items, nil
}

type CheckFavoritesRequest struct {
	ResourceType int      `json:"resource_type" binding:"required"`
	IDs          []string `json:"ids" binding:"required,min=1,max=100"`
}

type CheckFavoritesResponse struct {
	FavoritedIDs []string `json:"favorited_ids"`
}

// CheckFavorites godoc
// @Summary 批量查询收藏状态
// @Description 通过多个 hashID 批量查询资源是否被当前用户收藏，返回已收藏的 hashID 列表
// @Description resource_type: 1=知识库, 2=文件, 9999=上传文件(用 uploadfile 查 file 再查收藏)
// @Tags 我的空间
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body CheckFavoritesRequest true "查询信息"
// @Success 200 {object} model.CommonResponse{data=CheckFavoritesResponse}
// @Router /api/my-space/favorites/check [post]
func CheckFavorites(c *gin.Context) {
	userID := config.GetUserId(c)

	var req CheckFavoritesRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	if req.ResourceType != model.RESOURCE_TYPE_FILE && req.ResourceType != model.RESOURCE_TYPE_LIBRARY && req.ResourceType != RESOURCE_TYPE_UPLOAD_FILE {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("resource_type 无效，必须为 1（知识库）、2（文件）或 9999（上传文件）")))
		return
	}

	resourceIDs := make([]int64, 0, len(req.IDs))
	for _, idStr := range req.IDs {
		decoded, err := hashids.TryParseID(idStr)
		if err != nil {
			c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("ids 中包含无效的 hashID: "+idStr)))
			return
		}
		resourceIDs = append(resourceIDs, decoded)
	}

	if req.ResourceType == RESOURCE_TYPE_UPLOAD_FILE {
		checkFavoritesByUploadFile(c, userID, req, resourceIDs)
		return
	}

	favoriteMap, err := model.GetFavoriteResourceIDMap(userID, req.ResourceType, resourceIDs)
	if err != nil {
		logger.Errorf(c, "【收藏】批量查询收藏状态失败: user_id=%d err=%v", userID, err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	favoritedResourceIDs := make([]int64, 0)
	for resourceID, isFavorited := range favoriteMap {
		if isFavorited {
			favoritedResourceIDs = append(favoritedResourceIDs, resourceID)
		}
	}

	favoritedIDs := make([]string, 0, len(favoritedResourceIDs))
	for _, rid := range favoritedResourceIDs {
		encoded, err := hashids.Encode(rid)
		if err != nil {
			logger.Errorf(c, "【收藏】编码 hashID 失败: resource_id=%d err=%v", rid, err)
			continue
		}
		favoritedIDs = append(favoritedIDs, encoded)
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(CheckFavoritesResponse{
		FavoritedIDs: favoritedIDs,
	}))
}

const RESOURCE_TYPE_UPLOAD_FILE = 9999

// checkFavoritesByUploadFile 通过 upload file ID 查询关联文件是否被收藏。
// 输入：upload file 的 hashID，输出 upload file 的 hashID（那些关联文件已被收藏的）。
func checkFavoritesByUploadFile(c *gin.Context, userID int64, req CheckFavoritesRequest, uploadFileIDs []int64) {
	// 1. 批量查找 upload_file_id → []File 的映射
	filesByUploadFileID, err := model.GetFilesByUploadFileIDs(uploadFileIDs)
	if err != nil {
		logger.Errorf(c, "【收藏】根据 upload_file_id 查询文件失败: user_id=%d err=%v", userID, err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	// 2. 收集所有关联的 fileID
	allFileIDs := make([]int64, 0, len(uploadFileIDs))
	uploadFileIDToFileIDs := make(map[int64][]int64, len(uploadFileIDs))
	for _, ufID := range uploadFileIDs {
		files, ok := filesByUploadFileID[ufID]
		if !ok || len(files) == 0 {
			continue
		}
		fileIDs := make([]int64, 0, len(files))
		for _, f := range files {
			if !f.IsDeleted {
				fileIDs = append(fileIDs, f.ID)
			}
		}
		if len(fileIDs) > 0 {
			uploadFileIDToFileIDs[ufID] = fileIDs
			allFileIDs = append(allFileIDs, fileIDs...)
		}
	}

	if len(allFileIDs) == 0 {
		c.JSON(http.StatusOK, model.Success.ToResponse(CheckFavoritesResponse{
			FavoritedIDs: []string{},
		}))
		return
	}

	// 3. 批量查询这些 fileID 的收藏状态
	favoriteMap, err := model.GetFavoriteResourceIDMap(userID, model.RESOURCE_TYPE_FILE, allFileIDs)
	if err != nil {
		logger.Errorf(c, "【收藏】批量查询文件收藏状态失败: user_id=%d err=%v", userID, err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	// 4. 构建 uploadFileID → 是否被收藏的映射
	favoritedUploadFileIDSet := make(map[int64]struct{}, len(uploadFileIDs))
	for ufID, fileIDs := range uploadFileIDToFileIDs {
		for _, fid := range fileIDs {
			if favoriteMap[fid] {
				favoritedUploadFileIDSet[ufID] = struct{}{}
				break
			}
		}
	}

	// 5. 按原始请求顺序输出已收藏的 upload file hashID
	favoritedIDs := make([]string, 0, len(favoritedUploadFileIDSet))
	for _, ufID := range uploadFileIDs {
		if _, ok := favoritedUploadFileIDSet[ufID]; ok {
			encoded, err := hashids.Encode(ufID)
			if err != nil {
				logger.Errorf(c, "【收藏】编码 upload file hashID 失败: upload_file_id=%d err=%v", ufID, err)
				continue
			}
			favoritedIDs = append(favoritedIDs, encoded)
		}
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(CheckFavoritesResponse{
		FavoritedIDs: favoritedIDs,
	}))
}
