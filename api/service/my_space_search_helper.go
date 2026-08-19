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

func searchMySpaceFilesByKeywordWithOriginTypes(ctx context.Context, eid, libraryID int64, originTypes []string, keyword string, fileType *int, offset, limit int, groupID ...int64) ([]model.File, int64, error) {
	return searchMySpaceFilesByKeywordWithFilters(ctx, eid, libraryID, originTypes, nil, keyword, fileType, offset, limit, groupID...)
}

func searchMySpaceFilesByKeywordExcludingOriginTypes(ctx context.Context, eid, libraryID int64, excludedOriginTypes []string, keyword string, fileType *int, offset, limit int) ([]model.File, int64, error) {
	return searchMySpaceFilesByKeywordWithFilters(ctx, eid, libraryID, nil, excludedOriginTypes, keyword, fileType, offset, limit)
}

func searchMySpaceFilesByKeywordWithFilters(ctx context.Context, eid, libraryID int64, originTypes []string, excludedOriginTypes []string, keyword string, fileType *int, offset, limit int, groupID ...int64) ([]model.File, int64, error) {
	keyword = strings.TrimSpace(keyword)
	if keyword == "" {
		return []model.File{}, 0, nil
	}

	if limit <= 0 {
		limit = 20
	}

	var gid int64
	if len(groupID) > 0 {
		gid = groupID[0]
	}

	if searchService := newMySpaceFileSearchService(); searchService != nil {
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
			files, materializeErr := materializeMySpaceFilesFromSearchResults(eid, response.Results, offset, limit, gid)
			// ES 返回 err==nil 且物化出文件才算命中。注意：ES 索引可能不完整
			// （如设备导入的 recording_imported 文件未同步进 ES），空结果不能当作
			// "无匹配"直接返回——否则 keyword 搜索会漏掉 ES 缺失的文件。空结果必须
			// fallback 到 DB 查询兜底。即使 ES Total>0 但物化后 files 为空
			// （结果文件已软删/DB 查不到），同样 fallback，避免返回"空数组+非零 total"
			// 的矛盾结果（前端拿不到数据却分页提示还有更多）。
			if materializeErr == nil && len(files) > 0 {
				return files, response.Total, nil
			}
		}
	}

	if len(originTypes) > 0 {
		files, total, err := model.SearchFilesByLibraryOriginTypesKeyword(eid, libraryID, originTypes, keyword, fileType, offset, limit)
		if err != nil {
			return nil, 0, err
		}
		if gid > 0 {
			filtered := make([]model.File, 0)
			for _, f := range files {
				if f.GroupID == gid {
					filtered = append(filtered, f)
				}
			}
			return filtered, int64(len(filtered)), nil
		}
		return files, total, nil
	}
	if len(excludedOriginTypes) > 0 {
		return model.SearchFilesByLibraryExcludeOriginTypesKeyword(eid, libraryID, excludedOriginTypes, keyword, fileType, offset, limit)
	}
	return model.SearchFilesByLibraryKeyword(eid, libraryID, keyword, fileType, originTypes, offset, limit)
}

func materializeMySpaceFilesFromSearchResults(eid int64, results []elasticsearch.FileNameSearchResult, offset, limit int, groupID ...int64) ([]model.File, error) {
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

	var gid int64
	if len(groupID) > 0 {
		gid = groupID[0]
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

	ordered := make([]model.File, 0, len(selected))
	for _, result := range selected {
		if gid > 0 {
			if file, ok := fileMap[result.FileID]; ok && file.GroupID == gid {
				ordered = append(ordered, file)
			}
			continue
		}
		if file, ok := fileMap[result.FileID]; ok {
			ordered = append(ordered, file)
		}
	}

	return ordered, nil
}
