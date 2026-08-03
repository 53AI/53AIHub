package mcp

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	core "github.com/53AI/53AIHub/service"
	es "github.com/53AI/53AIHub/service/elasticsearch"
	"gorm.io/gorm"
)

type FileNameSearchRequest struct {
	Query           string
	TopK            int
	LibraryIDs      []int64
	CaseSensitive   *bool
	FuzzyThreshold  *int
	CreatorIDs      []int64
	FileExtensions  []string
	CreatedTimeFrom *int64
	CreatedTimeTo   *int64
	UpdatedTimeFrom *int64
	UpdatedTimeTo   *int64
	SortBy          string
	TimeFrom        *int64
	TimeTo          *int64
	TimeField       string // "created_time" or "updated_time"
	Page            int
	Size            int
}

type SearchService struct {
	db *gorm.DB
}

type fileNameSearcher interface {
	Search(eid int64, req *es.FileNameSearchRequest) (*es.FileNameSearchResponse, error)
}

var getGlobalFileNameSearchClient = es.GetGlobalClient
var isGlobalFileNameSearchClientEnabled = func(client *es.Client) bool {
	return client != nil && !client.IsDisabled()
}
var newFileNameSearchExecutor = func(client *es.Client, db *gorm.DB) fileNameSearcher {
	return es.NewFileNameSearchService(client, db)
}

func NewSearchService(db *gorm.DB) *SearchService {
	return &SearchService{db: db}
}

func (s *SearchService) SearchFileNames(ctx context.Context, eid int64, args ...interface{}) (*es.FileNameSearchResponse, error) {
	startTime := time.Now()
	userID, req := parseFileNameSearchRequest(args)
	if req == nil {
		return nil, fmt.Errorf("搜索请求不能为空")
	}
	if strings.TrimSpace(req.Query) == "" {
		return nil, fmt.Errorf("搜索关键词不能为空")
	}
	if req.TopK <= 0 {
		req.TopK = 20
	}

	client := getGlobalFileNameSearchClient()
	if !isGlobalFileNameSearchClientEnabled(client) {
		resp, err := s.searchFileNameByDatabase(eid, userID, req, startTime)
		if err != nil {
			return nil, err
		}
		resp.Source = "sql"
		return resp, nil
	}

	searchExecutor := newFileNameSearchExecutor(client, s.db)
	response, err := searchExecutor.Search(eid, &es.FileNameSearchRequest{
		Query:           req.Query,
		TopK:            req.TopK,
		LibraryIDs:      req.LibraryIDs,
		CaseSensitive:   req.CaseSensitive,
		FuzzyThreshold:  req.FuzzyThreshold,
		CreatorIDs:      req.CreatorIDs,
		FileExtensions:  req.FileExtensions,
		CreatedTimeFrom: firstTimePointer(req.CreatedTimeFrom, timePointerForField(req.TimeFrom, req.TimeField, "created_time")),
		CreatedTimeTo:   firstTimePointer(req.CreatedTimeTo, timePointerForField(req.TimeTo, req.TimeField, "created_time")),
		UpdatedTimeFrom: firstTimePointer(req.UpdatedTimeFrom, timePointerForField(req.TimeFrom, req.TimeField, "updated_time")),
		UpdatedTimeTo:   firstTimePointer(req.UpdatedTimeTo, timePointerForField(req.TimeTo, req.TimeField, "updated_time")),
		SortBy:          req.SortBy,
		Page:            req.Page,
		Size:            req.Size,
	})
	if err != nil {
		logger.SysLogf("Elasticsearch 搜索失败，不回退 SQL: eid=%d, query=%s, err=%v", eid, req.Query, err)
		return nil, fmt.Errorf("Elasticsearch 搜索失败: %v", err)
	}
	response.Source = "es"
	if userID > 0 {
		return s.filterSearchResponseByPermission(eid, userID, response)
	}
	return response, nil
}

func timePointerForField(value *int64, field, wanted string) *int64 {
	if value == nil || field != wanted {
		return nil
	}
	return value
}

func firstTimePointer(primary, fallback *int64) *int64 {
	if primary != nil {
		return primary
	}
	return fallback
}

func parseFileNameSearchRequest(args []interface{}) (int64, *FileNameSearchRequest) {
	if len(args) == 1 {
		if req, ok := args[0].(*FileNameSearchRequest); ok {
			return 0, req
		}
	}
	if len(args) == 2 {
		var userID int64
		switch value := args[0].(type) {
		case int64:
			userID = value
		case int:
			userID = int64(value)
		case float64:
			userID = int64(value)
		case string:
			fmt.Sscan(value, &userID)
		}
		if req, ok := args[1].(*FileNameSearchRequest); ok {
			return userID, req
		}
	}
	return 0, nil
}

func (s *SearchService) searchFileNameByDatabase(eid, userID int64, req *FileNameSearchRequest, startTime time.Time) (*es.FileNameSearchResponse, error) {
	query := model.DB.Model(&model.File{}).Where("eid = ? AND is_deleted = ? AND type = ?", eid, false, model.FILE_TYPE_FILE)
	if len(req.LibraryIDs) > 0 {
		query = query.Where("library_id IN ?", req.LibraryIDs)
	}
	if req.Query != "" {
		query = query.Where("path LIKE ?", "%"+req.Query+"%")
	}
	if len(req.CreatorIDs) > 0 {
		query = query.Where("user_id IN ?", req.CreatorIDs)
	}
	if len(req.FileExtensions) > 0 {
		var extConditions []string
		var extValues []interface{}
		for _, ext := range req.FileExtensions {
			extConditions = append(extConditions, "path LIKE ?")
			extValues = append(extValues, "%"+ext)
		}
		query = query.Where(strings.Join(extConditions, " OR "), extValues...)
	}
	if req.CreatedTimeFrom != nil {
		query = query.Where("created_time >= ?", *req.CreatedTimeFrom)
	}
	if req.CreatedTimeTo != nil {
		query = query.Where("created_time <= ?", *req.CreatedTimeTo)
	}
	if req.UpdatedTimeFrom != nil {
		query = query.Where("updated_time >= ?", *req.UpdatedTimeFrom)
	}
	if req.UpdatedTimeTo != nil {
		query = query.Where("updated_time <= ?", *req.UpdatedTimeTo)
	}
	if req.CreatedTimeFrom == nil && req.CreatedTimeTo == nil && req.UpdatedTimeFrom == nil && req.UpdatedTimeTo == nil && req.TimeField != "" {
		if req.TimeFrom != nil {
			query = query.Where(req.TimeField+" >= ?", *req.TimeFrom)
		}
		if req.TimeTo != nil {
			query = query.Where(req.TimeField+" <= ?", *req.TimeTo)
		}
	}

	var recentFileIDs []int64
	if req.SortBy == "recent_access" {
		var err error
		recentFileIDs, err = model.GetUserRecentFileIDs(eid, userID, 1000)
		if err != nil {
			return nil, fmt.Errorf("获取最近访问文件失败: %v", err)
		}
		if len(recentFileIDs) == 0 {
			return &es.FileNameSearchResponse{Results: []es.FileNameSearchResult{}, Total: 0, Time: time.Since(startTime).Milliseconds(), Query: req.Query, Source: "sql"}, nil
		}
		query = query.Where("id IN ?", recentFileIDs)
	}

	size := req.TopK
	if req.Size > 0 {
		size = req.Size
	}
	if size > 100 {
		size = 100
	}
	offset := 0
	if req.Page > 1 && req.Size > 0 {
		offset = (req.Page - 1) * req.Size
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, fmt.Errorf("数据库搜索统计失败: %v", err)
	}

	var files []model.File
	if req.SortBy == "recent_access" {
		if err := query.Find(&files).Error; err != nil {
			return nil, fmt.Errorf("数据库搜索失败: %v", err)
		}
		rankMap := make(map[int64]int, len(recentFileIDs))
		for i, fileID := range recentFileIDs {
			rankMap[fileID] = i
		}
		sort.SliceStable(files, func(i, j int) bool {
			return rankMap[files[i].ID] < rankMap[files[j].ID]
		})
		if offset >= len(files) {
			files = []model.File{}
		} else {
			end := offset + size
			if end > len(files) {
				end = len(files)
			}
			files = files[offset:end]
		}
	} else if err := query.Order("updated_time DESC").Offset(offset).Limit(size).Find(&files).Error; err != nil {
		return nil, fmt.Errorf("数据库搜索失败: %v", err)
	}

	results := make([]es.FileNameSearchResult, 0, len(files))
	for _, file := range files {
		if userID > 0 {
			if ok, err := s.canUserReadFile(eid, userID, file.ID); err != nil || !ok {
				continue
			}
		}
		library, _ := model.GetLibraryByID(eid, file.LibraryID)
		libraryName := ""
		spaceID := int64(0)
		spaceName := ""
		if library != nil {
			libraryName = library.Name
			spaceID = library.SpaceID
		}
		if spaceID > 0 {
			space, _ := model.GetSpaceByID(eid, spaceID)
			if space != nil {
				spaceName = space.Name
			}
		}

		creatorID := file.UserID
		creatorName := ""
		if creatorID > 0 {
			if creator, err := model.GetUserByID(creatorID); err == nil && creator != nil {
				creatorName = creator.Nickname
				if creatorName == "" {
					creatorName = creator.Username
				}
			}
		}

		latestUpdateTime := int64(0)
		if fileBody, err := model.GetLastFileBodyByFileID(eid, file.ID); err == nil && fileBody != nil {
			latestUpdateTime = fileBody.UpdatedTime
		}

		results = append(results, es.FileNameSearchResult{
			FileID:                   file.ID,
			LibraryID:                file.LibraryID,
			Path:                     file.Path,
			FileName:                 model.ExtractSimpleFileName(file.Path),
			BaseName:                 model.ExtractSimpleBaseName(file.Path),
			Type:                     file.Type,
			Score:                    1.0,
			Highlight:                "",
			LibraryName:              libraryName,
			SpaceID:                  spaceID,
			SpaceName:                spaceName,
			CreatorID:                creatorID,
			CreatorName:              creatorName,
			IsDeleted:                file.IsDeleted,
			LatestFileBodyUpdateTime: latestUpdateTime,
		})
	}

	return &es.FileNameSearchResponse{
		Results: results,
		Total:   total,
		Time:    0,
		Query:   req.Query,
	}, nil
}

func (s *SearchService) filterSearchResponseByPermission(eid, userID int64, response *es.FileNameSearchResponse) (*es.FileNameSearchResponse, error) {
	if response == nil || len(response.Results) == 0 {
		return response, nil
	}
	filtered := make([]es.FileNameSearchResult, 0, len(response.Results))
	for _, result := range response.Results {
		if ok, err := s.canUserReadFile(eid, userID, result.FileID); err != nil || !ok {
			continue
		}
		filtered = append(filtered, result)
	}
	response.Results = filtered
	return response, nil
}

func (s *SearchService) canUserReadFile(eid, userID, fileID int64) (bool, error) {
	permission, err := core.GetUserPermission(eid, model.RESOURCE_TYPE_FILE, fileID, userID)
	if err != nil {
		return false, err
	}
	return permission >= model.PERMISSION_VIEW_ONLY, nil
}
