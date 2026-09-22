package elasticsearch

import "fmt"

// StatsSearchResult 统计检索命中文件
type StatsSearchResult struct {
	FileID         int64   `json:"file_id"`
	FileName       string  `json:"file_name"`
	LibraryID      int64   `json:"library_id"`
	Score          float64 `json:"score"`
	ContentPreview string  `json:"content_preview,omitempty"` // 文件内容预览（ES 高亮片段 / SQL 正文预览），用于 rag_stats content
}

// SearchStats 统计计数检索：multi_match 匹配 file_name^3 + content，
// track_total_hits 取全量命中数（total），用于"多少个文件提到X"类问题。
// ES 不可用时调用方应走 SQL 兜底；本方法假定 client 可用。
func (s *FileNameSearchService) SearchStats(query string, libraryIDs []int64, limit int) (int64, []StatsSearchResult, error) {
	if s == nil || s.client == nil {
		return 0, nil, fmt.Errorf("ES client 不可用")
	}
	if limit <= 0 {
		limit = 10
	}
	q := buildStatsSearchQuery(query, libraryIDs)
	results, total, err := s.executeSearch(q, 0, limit)
	if err != nil {
		return 0, nil, err
	}
	out := make([]StatsSearchResult, 0, len(results))
	for _, r := range results {
		out = append(out, StatsSearchResult{FileID: r.FileID, FileName: r.FileName, LibraryID: r.LibraryID, Score: r.Score, ContentPreview: r.ContentHighlight})
	}
	return total, out, nil
}

// buildStatsSearchQuery 统计检索 query：multi_match(file_name^3, content) + 库过滤。
// 返回纯 map，便于单测（不连真 ES）。
func buildStatsSearchQuery(query string, libraryIDs []int64) map[string]interface{} {
	match := map[string]interface{}{
		"multi_match": map[string]interface{}{
			"query":  query,
			"fields": []string{"file_name^3", "content"},
			"type":   "phrase",
		},
	}
	q := map[string]interface{}{
		"query":            match,
		"track_total_hits": true,
	}
	if len(libraryIDs) > 0 {
		q["query"] = map[string]interface{}{
			"bool": map[string]interface{}{
				"must":   match,
				"filter": []map[string]interface{}{{"terms": map[string]interface{}{"library_id": libraryIDs}}},
			},
		}
	}
	return q
}
