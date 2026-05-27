package mcp

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/53AI/53AIHub/model"
	core "github.com/53AI/53AIHub/service"
	es "github.com/53AI/53AIHub/service/elasticsearch"
	"gorm.io/gorm"
)

type FileNameSearchRequest struct {
	Query          string
	TopK           int
	LibraryIDs     []int64
	CaseSensitive  *bool
	FuzzyThreshold *int
}

type SearchService struct {
	db *gorm.DB
}

type fileNameSearcher interface {
	Search(eid int64, req *es.FileNameSearchRequest) (*es.FileNameSearchResponse, error)
}

var getGlobalFileNameSearchClient = es.GetGlobalClient
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
	if client == nil || client.IsDisabled() {
		return s.searchFileNameByDatabase(eid, userID, req, startTime)
	}

	searchExecutor := newFileNameSearchExecutor(client, s.db)
	response, err := searchExecutor.Search(eid, &es.FileNameSearchRequest{
		Query:          req.Query,
		TopK:           req.TopK,
		LibraryIDs:     req.LibraryIDs,
		CaseSensitive:  req.CaseSensitive,
		FuzzyThreshold: req.FuzzyThreshold,
	})
	if err != nil {
		return nil, err
	}
	if userID > 0 {
		return s.filterSearchResponseByPermission(eid, userID, response)
	}
	return response, nil
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
	var files []model.File
	query := model.DB.Where("eid = ? AND is_deleted = ?", eid, false)
	if len(req.LibraryIDs) > 0 {
		query = query.Where("library_id IN ?", req.LibraryIDs)
	}
	if req.Query != "" {
		query = query.Where("path LIKE ?", "%"+req.Query+"%")
	}
	query = query.Limit(req.TopK)
	if err := query.Find(&files).Error; err != nil {
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
		Total:   int64(len(results)),
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
	response.Total = int64(len(filtered))
	return response, nil
}

func (s *SearchService) canUserReadFile(eid, userID, fileID int64) (bool, error) {
	permission, err := core.GetUserPermission(eid, model.RESOURCE_TYPE_FILE, fileID, userID)
	if err != nil {
		return false, err
	}
	return permission >= model.PERMISSION_VIEW_ONLY, nil
}
