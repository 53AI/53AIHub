package service

import (
	"context"
	"strings"

	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/elasticsearch"
)

type mySpaceFileSearchService interface {
	Search(eid int64, req *elasticsearch.FileNameSearchRequest) (*elasticsearch.FileNameSearchResponse, error)
}

var newMySpaceFileSearchService = func() mySpaceFileSearchService {
	esClient := elasticsearch.GetGlobalClient()
	if esClient == nil || esClient.IsDisabled() {
		return nil
	}
	return elasticsearch.NewFileNameSearchService(esClient, model.DB)
}

func searchMySpaceFilesByKeyword(ctx context.Context, eid, libraryID int64, originType string, keyword string, fileType *int, offset, limit int) ([]model.File, int64, error) {
	if originType != "" {
		return searchMySpaceFilesByKeywordWithOriginTypes(ctx, eid, libraryID, []string{originType}, keyword, fileType, offset, limit)
	}
	return searchMySpaceFilesByKeywordWithFilters(ctx, eid, libraryID, nil, nil, keyword, fileType, offset, limit)
}

func searchMySpaceFilesByKeywordWithOriginTypes(ctx context.Context, eid, libraryID int64, originTypes []string, keyword string, fileType *int, offset, limit int) ([]model.File, int64, error) {
	return searchMySpaceFilesByKeywordWithFilters(ctx, eid, libraryID, originTypes, nil, keyword, fileType, offset, limit)
}

func searchMySpaceFilesByKeywordExcludingOriginTypes(ctx context.Context, eid, libraryID int64, excludedOriginTypes []string, keyword string, fileType *int, offset, limit int) ([]model.File, int64, error) {
	return searchMySpaceFilesByKeywordWithFilters(ctx, eid, libraryID, nil, excludedOriginTypes, keyword, fileType, offset, limit)
}

func searchMySpaceFilesByKeywordWithFilters(ctx context.Context, eid, libraryID int64, originTypes []string, excludedOriginTypes []string, keyword string, fileType *int, offset, limit int) ([]model.File, int64, error) {
	keyword = strings.TrimSpace(keyword)
	if keyword == "" {
		return []model.File{}, 0, nil
	}

	if limit <= 0 {
		limit = 20
	}

	if searchService := newMySpaceFileSearchService(); searchService != nil {
		// 我的上传 / 我的录音的来源口径以 docs/对接文档/知识库文件列表优化.md 为准。
		// 后续如果这里的筛选条件变化，先同步文档再调整 ES / DB 回退逻辑，避免合并时出现口径分叉。
		request := &elasticsearch.FileNameSearchRequest{
			Query:              keyword,
			TopK:               offset + limit,
			LibraryIDs:         []int64{libraryID},
			FileType:           fileType,
			ExcludeOriginTypes: excludedOriginTypes,
		}
		if len(originTypes) > 0 {
			request.OriginTypes = originTypes
		}

		response, err := searchService.Search(eid, request)
		if err == nil {
			files, materializeErr := materializeMySpaceFilesFromSearchResults(eid, response.Results, offset, limit)
			if materializeErr == nil {
				return files, response.Total, nil
			}
		}
	}

	if len(originTypes) > 0 {
		return model.SearchFilesByLibraryOriginTypesKeyword(eid, libraryID, originTypes, keyword, fileType, offset, limit)
	}
	if len(excludedOriginTypes) > 0 {
		return model.SearchFilesByLibraryExcludeOriginTypesKeyword(eid, libraryID, excludedOriginTypes, keyword, fileType, offset, limit)
	}
	return model.SearchFilesByLibraryKeyword(eid, libraryID, keyword, fileType, originTypes, offset, limit)
}

func materializeMySpaceFilesFromSearchResults(eid int64, results []elasticsearch.FileNameSearchResult, offset, limit int) ([]model.File, error) {
	if len(results) == 0 {
		return []model.File{}, nil
	}
	if offset < 0 {
		offset = 0
	}
	if limit <= 0 {
		limit = len(results)
	}
	if offset >= len(results) {
		return []model.File{}, nil
	}
	end := offset + limit
	if end > len(results) {
		end = len(results)
	}
	selected := results[offset:end]
	if len(selected) == 0 {
		return []model.File{}, nil
	}

	fileIDs := make([]int64, 0, len(selected))
	for _, result := range selected {
		if result.FileID <= 0 {
			continue
		}
		fileIDs = append(fileIDs, result.FileID)
	}
	if len(fileIDs) == 0 {
		return []model.File{}, nil
	}

	files, err := model.GetFilesByIDs(eid, fileIDs)
	if err != nil {
		return nil, err
	}

	fileMap := make(map[int64]model.File, len(files))
	for _, file := range files {
		fileMap[file.ID] = file
	}

	ordered := make([]model.File, 0, len(fileIDs))
	for _, result := range selected {
		if file, ok := fileMap[result.FileID]; ok {
			ordered = append(ordered, file)
		}
	}

	return ordered, nil
}
