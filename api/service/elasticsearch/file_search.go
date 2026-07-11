package elasticsearch

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"github.com/elastic/go-elasticsearch/v7/esapi"
	"gorm.io/gorm"
)

// FileDocument 文件文档结构
type FileDocument struct {
	FileID        int64  `json:"file_id"`
	Eid           int64  `json:"eid"`
	LibraryID     int64  `json:"library_id"`
	OriginType    string `json:"origin_type"`
	OriginRefID   int64  `json:"origin_ref_id"`
	OriginSource  string `json:"origin_source"`
	Path          string `json:"path"`
	FileName      string `json:"file_name"`       // 完整文件名（含最后一个扩展名）
	BaseName      string `json:"base_name"`       // 基本名称（去除所有扩展名）
	LowerBaseName string `json:"lower_base_name"` // 小写基本名称（去除所有扩展名）
	Type          int    `json:"type"`            // 0=目录, 1=文件
	IsDeleted     bool   `json:"is_deleted"`
	UserID        int64  `json:"user_id"`
	CreatedTime   int64  `json:"created_time"`
	UpdatedTime   int64  `json:"updated_time"`
	FileExtension string `json:"file_extension"` // 文件扩展名（小写，含点号，如 .pdf .docx .md）
}

// FileNameSearchRequest 文件名搜索请求
type FileNameSearchRequest struct {
	Query              string   `json:"query" binding:"required"`
	TopK               int      `json:"top_k"`
	LibraryIDs         []int64  `json:"library_ids"`
	FileIDs            []int64  `json:"file_ids"`             // 新增：文件ID过滤
	FileType           *int     `json:"file_type"`            // 0=目录, 1=文件, nil=全部
	OriginTypes        []string `json:"origin_types"`         // 来源类型过滤
	ExcludeOriginTypes []string `json:"exclude_origin_types"` // 排除的来源类型
	CaseSensitive      *bool    `json:"case_sensitive"`       // 大小写敏感，nil表示不敏感
	FuzzyThreshold     *int     `json:"fuzzy_threshold"`      // 模糊匹配阈值，1-2，nil表示自动
	// 全局检索专用扩展字段
	SpaceIDs         []int64  `json:"space_ids"`           // 空间 ID 列表（多选）
	CreatorIDs       []int64  `json:"creator_ids"`          // 创建人 ID 列表（多选）
	FileExtensions   []string `json:"file_extensions"`     // 文件扩展名列表（如 [".pdf", ".docx"]）
	CreatedTimeFrom  *int64   `json:"created_time_from"`   // 创建时间范围起始（Unix 毫秒）
	CreatedTimeTo    *int64   `json:"created_time_to"`     // 创建时间范围结束（Unix 毫秒）
	UpdatedTimeFrom  *int64   `json:"updated_time_from"`   // 更新时间范围起始（Unix 毫秒）
	UpdatedTimeTo    *int64   `json:"updated_time_to"`     // 更新时间范围结束（Unix 毫秒）
	SortBy           string   `json:"sort_by"`              // "recent_update" | "recent_access"（默认 recent_update）
	Page             int      `json:"page"`                 // 页码（从 1 开始）
	Size             int      `json:"size"`                 // 每页条数（默认 20，最大 100）
	From             int      `json:"from"`                 // ES from 参数（替代 Page/Size 计算）
}

// FileNameSearchResult 文件名搜索结果
// LatestFileBodyUpdateTime: 最新文件内容更新时间（来自file_body表的updated_time）
type FileNameSearchResult struct {
	FileID                   int64   `json:"file_id"`
	LibraryID                int64   `json:"library_id"`
	Path                     string  `json:"path"`
	FileName                 string  `json:"file_name"`
	BaseName                 string  `json:"base_name"`
	Type                     int     `json:"type"`
	Score                    float64 `json:"score"`
	Highlight                string  `json:"highlight"`
	LibraryName              string  `json:"library_name"`
	SpaceID                  int64   `json:"space_id"`
	SpaceName                string  `json:"space_name"`
	CreatorID                int64   `json:"creator_id"`
	CreatorName              string  `json:"creator_name"`
	IsDeleted                bool    `json:"is_deleted"`
	LatestFileBodyUpdateTime int64   `json:"latest_file_body_update_time"`
}

// FileNameSearchResponse 文件名搜索响应
type FileNameSearchResponse struct {
	Results []FileNameSearchResult `json:"results"`
	Total   int64                  `json:"total"`
	Time    int64                  `json:"time_ms"`
	Query   string                 `json:"query"`
	Source  string                 `json:"source"` // 搜索结果来源: "es" (Elasticsearch) 或 "sql" (数据库降级)
}

// FileNameSearchService 文件名搜索服务
type FileNameSearchService struct {
	client *Client
	db     *gorm.DB
}

// NewFileNameSearchService 创建文件名搜索服务
func NewFileNameSearchService(client *Client, db *gorm.DB) *FileNameSearchService {
	return &FileNameSearchService{
		client: client,
		db:     db,
	}
}

// Search 执行文件名搜索
func (s *FileNameSearchService) Search(eid int64, req *FileNameSearchRequest) (*FileNameSearchResponse, error) {
	startTime := time.Now()

	if s.client == nil || s.client.IsDisabled() {
		return &FileNameSearchResponse{
			Results: []FileNameSearchResult{},
			Total:   0,
			Time:    time.Since(startTime).Milliseconds(),
			Query:   req.Query,
			Source:  "db",
		}, nil
	}

	if req.Page <= 0 {
		req.Page = 1
	}
	if req.Size <= 0 {
		req.Size = 20
	}
	if req.Size > 100 {
		req.Size = 100
	}
	topK := req.TopK
	if topK <= 0 {
		topK = req.Size
	}

	logger.SysLogf("开始 Elasticsearch 文件名搜索: eid=%d, query=%s, page=%d, size=%d", eid, req.Query, req.Page, req.Size)

	query := s.buildSearchQuery(eid, req)

	from := (req.Page - 1) * req.Size
	results, total, err := s.executeSearch(query, from, topK)
	if err != nil {
		return nil, fmt.Errorf("执行搜索失败: %v", err)
	}

	s.enrichWithLibraryInfo(results)
	s.enrichWithCreatorInfo(results)
	s.enrichWithLatestFileBodyUpdateTime(results)

	searchTime := time.Since(startTime).Milliseconds()

	logger.SysLogf("Elasticsearch 文件名搜索完成: eid=%d, 找到%d个结果, 总计%d个, 耗时%dms",
		eid, len(results), total, searchTime)

	return &FileNameSearchResponse{
		Results: results,
		Total:   total,
		Time:    searchTime,
		Query:   req.Query,
		Source:  "es",
	}, nil
}

// buildSearchQuery 构建搜索查询
func (s *FileNameSearchService) buildSearchQuery(eid int64, req *FileNameSearchRequest) map[string]interface{} {
	boolQuery := map[string]interface{}{
		"must": []map[string]interface{}{
			{
				"term": map[string]interface{}{
					"eid": eid,
				},
			},
			{
				"term": map[string]interface{}{
					"is_deleted": false,
				},
			},
		},
	}

	var filters []map[string]interface{}

	if len(req.LibraryIDs) > 0 {
		filters = append(filters, map[string]interface{}{
			"terms": map[string]interface{}{
				"library_id": req.LibraryIDs,
			},
		})
	}

	if len(req.FileIDs) > 0 {
		filters = append(filters, map[string]interface{}{
			"terms": map[string]interface{}{
				"file_id": req.FileIDs,
			},
		})
	}

	if req.FileType != nil {
		filters = append(filters, map[string]interface{}{
			"term": map[string]interface{}{
				"type": *req.FileType,
			},
		})
	}

	if len(req.OriginTypes) > 0 {
		filters = append(filters, map[string]interface{}{
			"terms": map[string]interface{}{
				"origin_type": req.OriginTypes,
			},
		})
	}

	if len(req.CreatorIDs) > 0 {
		filters = append(filters, map[string]interface{}{
			"terms": map[string]interface{}{
				"user_id": req.CreatorIDs,
			},
		})
	}

	if len(req.FileExtensions) > 0 {
		filters = append(filters, map[string]interface{}{
			"terms": map[string]interface{}{
				"file_extension.keyword": req.FileExtensions,
			},
		})
	}

	if req.CreatedTimeFrom != nil || req.CreatedTimeTo != nil {
		rangeClause := map[string]interface{}{}
		if req.CreatedTimeFrom != nil {
			rangeClause["gte"] = *req.CreatedTimeFrom
		}
		if req.CreatedTimeTo != nil {
			rangeClause["lte"] = *req.CreatedTimeTo
		}
		filters = append(filters, map[string]interface{}{
			"range": map[string]interface{}{
				"created_time": rangeClause,
			},
		})
	}

	if req.UpdatedTimeFrom != nil || req.UpdatedTimeTo != nil {
		rangeClause := map[string]interface{}{}
		if req.UpdatedTimeFrom != nil {
			rangeClause["gte"] = *req.UpdatedTimeFrom
		}
		if req.UpdatedTimeTo != nil {
			rangeClause["lte"] = *req.UpdatedTimeTo
		}
		filters = append(filters, map[string]interface{}{
			"range": map[string]interface{}{
				"updated_time": rangeClause,
			},
		})
	}

	if len(filters) > 0 {
		boolQuery["filter"] = filters
	}

	var mustNot []map[string]interface{}
	if len(req.ExcludeOriginTypes) > 0 {
		mustNot = append(mustNot, map[string]interface{}{
			"terms": map[string]interface{}{
				"origin_type": req.ExcludeOriginTypes,
			},
		})
	}
	if len(mustNot) > 0 {
		boolQuery["must_not"] = mustNot
	}

	if req.Query != "" {
		fileNameQuery := s.buildFileNameQuery(req)
		boolQuery["must"] = append(boolQuery["must"].([]map[string]interface{}), fileNameQuery)
	}

	query := map[string]interface{}{
		"query": map[string]interface{}{
			"bool": boolQuery,
		},
		"highlight": map[string]interface{}{
			"fields": map[string]interface{}{
				"base_name": map[string]interface{}{
					"pre_tags":  []string{"<mark>"},
					"post_tags": []string{"</mark>"},
				},
			},
		},
	}

	if req.SortBy == "recent_update" || req.SortBy == "" {
		query["sort"] = []map[string]interface{}{
			{"updated_time": map[string]interface{}{"order": "desc"}},
			{"_score": map[string]interface{}{"order": "desc"}},
		}
	} else {
		query["sort"] = []map[string]interface{}{
			{"_score": map[string]interface{}{"order": "desc"}},
		}
	}

	return query
}

// executeSearch 执行搜索
func (s *FileNameSearchService) executeSearch(query map[string]interface{}, from int, size int) ([]FileNameSearchResult, int64, error) {
	// 序列化查询
	var buf bytes.Buffer
	if err := json.NewEncoder(&buf).Encode(query); err != nil {
		return nil, 0, fmt.Errorf("编码查询失败: %v", err)
	}

	// 执行搜索
	res, err := s.client.Search(
		s.client.Search.WithContext(context.Background()),
		s.client.Search.WithIndex(s.client.GetIndexName()),
		s.client.Search.WithBody(&buf),
		s.client.Search.WithFrom(from),
		s.client.Search.WithSize(size),
		s.client.Search.WithTrackTotalHits(true),
	)
	if err != nil {
		return nil, 0, fmt.Errorf("搜索请求失败: %v", err)
	}
	defer res.Body.Close()

	if res.IsError() {
		if res.Status() == "404 Not Found" {
			return make([]FileNameSearchResult, 0), 0, nil
		}
		return nil, 0, fmt.Errorf("搜索响应错误: %s", res.Status())
	}

	// 解析响应
	var searchResponse map[string]interface{}
	if err := json.NewDecoder(res.Body).Decode(&searchResponse); err != nil {
		return nil, 0, fmt.Errorf("解析响应失败: %v", err)
	}

	// 提取结果
	hits := searchResponse["hits"].(map[string]interface{})
	total := int64(hits["total"].(map[string]interface{})["value"].(float64))
	hitsList := hits["hits"].([]interface{})

	var results []FileNameSearchResult
	for _, hit := range hitsList {
		hitMap := hit.(map[string]interface{})
		source := hitMap["_source"].(map[string]interface{})
		score := hitMap["_score"].(float64)

		// 只提取 base_name 高亮
		highlight := ""
		if highlightData, exists := hitMap["highlight"]; exists {
			highlights := highlightData.(map[string]interface{})
			if fileNameHighlights, exists := highlights["base_name"]; exists {
				if highlightsList, ok := fileNameHighlights.([]interface{}); ok && len(highlightsList) > 0 {
					highlight = highlightsList[0].(string)
				}
			}
		}

		result := FileNameSearchResult{
			FileID:    int64(source["file_id"].(float64)),
			LibraryID: int64(source["library_id"].(float64)),
			Path:      source["path"].(string),
			FileName:  source["file_name"].(string),
			BaseName:  source["base_name"].(string),
			Type:      int(source["type"].(float64)),
			Score:     score,
			Highlight: highlight,
			IsDeleted: source["is_deleted"].(bool),
			CreatorID: int64(source["user_id"].(float64)),
		}

		results = append(results, result)
	}

	return results, total, nil
}

// enrichWithLibraryInfo 丰富知识库信息
func (s *FileNameSearchService) enrichWithLibraryInfo(results []FileNameSearchResult) {
	if len(results) == 0 || s.db == nil {
		return
	}

	// 收集需要查询的知识库ID
	libraryIDs := make([]int64, 0, len(results))
	libraryIDSet := make(map[int64]bool)

	for _, result := range results {
		if !libraryIDSet[result.LibraryID] {
			libraryIDs = append(libraryIDs, result.LibraryID)
			libraryIDSet[result.LibraryID] = true
		}
	}

	// 批量查询知识库信息
	var libraries []model.Library
	err := s.db.Where("id IN ?", libraryIDs).Find(&libraries).Error
	if err != nil {
		logger.SysLogf("批量查询知识库信息失败: %v", err)
		return
	}

	// 构建知识库映射
	libraryMap := make(map[int64]string)
	for _, lib := range libraries {
		libraryMap[lib.ID] = lib.Name
	}

	// 更新结果中的知识库名称
	for i := range results {
		if libName, exists := libraryMap[results[i].LibraryID]; exists {
			results[i].LibraryName = libName
		}
	}
}

// enrichWithCreatorInfo 丰富创建人信息
func (s *FileNameSearchService) enrichWithCreatorInfo(results []FileNameSearchResult) {
	if len(results) == 0 || s.db == nil {
		return
	}

	// 收集需要查询的创建人ID
	userIDs := make([]int64, 0, len(results))
	userIDSet := make(map[int64]bool)

	for _, result := range results {
		if result.CreatorID > 0 && !userIDSet[result.CreatorID] {
			userIDs = append(userIDs, result.CreatorID)
			userIDSet[result.CreatorID] = true
		}
	}

	if len(userIDs) == 0 {
		return
	}

	// 批量查询创建人信息
	var users []model.User
	err := s.db.Where("user_id IN ?", userIDs).Find(&users).Error
	if err != nil {
		logger.SysLogf("批量查询创建人信息失败: %v", err)
		return
	}

	// 构建用户映射
	userMap := make(map[int64]string)
	for _, user := range users {
		userMap[user.UserID] = user.Nickname
		if user.Nickname == "" {
			userMap[user.UserID] = user.Username
		}
	}

	// 更新结果中的创建人信息
	for i := range results {
		if results[i].CreatorID > 0 {
			if creatorName, exists := userMap[results[i].CreatorID]; exists {
				results[i].CreatorName = creatorName
			}
		}
	}
}

// enrichWithLatestFileBodyUpdateTime 丰富最新文件内容更新时间
func (s *FileNameSearchService) enrichWithLatestFileBodyUpdateTime(results []FileNameSearchResult) {
	if len(results) == 0 || s.db == nil {
		return
	}

	// 收集需要查询的文件ID
	fileIDs := make([]int64, 0, len(results))
	fileIDSet := make(map[int64]bool)

	for _, result := range results {
		if !fileIDSet[result.FileID] {
			fileIDs = append(fileIDs, result.FileID)
			fileIDSet[result.FileID] = true
		}
	}

	if len(fileIDs) == 0 {
		return
	}

	// 批量查询每个文件的最新文件内容更新时间
	type FileBodyLatestTime struct {
		FileID      int64 `json:"file_id"`
		UpdatedTime int64 `json:"updated_time"`
	}

	var latestTimes []FileBodyLatestTime
	err := s.db.Table("file_bodies").
		Select("file_id, MAX(updated_time) as updated_time").
		Where("file_id IN ?", fileIDs).
		Group("file_id").
		Find(&latestTimes).Error
	if err != nil {
		logger.SysLogf("批量查询文件内容更新时间失败: %v", err)
		return
	}

	// 构建文件ID到最新更新时间的映射
	latestTimeMap := make(map[int64]int64)
	for _, latest := range latestTimes {
		latestTimeMap[latest.FileID] = latest.UpdatedTime
	}

	// 更新结果中的最新文件内容更新时间
	for i := range results {
		if latestTime, exists := latestTimeMap[results[i].FileID]; exists {
			results[i].LatestFileBodyUpdateTime = latestTime
		}
	}
}

// IndexFile 索引单个文件
func (s *FileNameSearchService) IndexFile(file *model.File) error {
	if s.client.IsDisabled() {
		return nil
	}

	doc := s.convertToFileDocument(file)
	return s.indexDocument(doc)
}

// IndexFilesBatch 批量索引文件
func (s *FileNameSearchService) IndexFilesBatch(files []model.File) error {
	if s.client.IsDisabled() {
		return nil
	}

	var docs []FileDocument
	for _, file := range files {
		doc := s.convertToFileDocument(&file)
		docs = append(docs, doc)
	}

	return s.indexDocumentsBatch(docs)
}

// DeleteFile 删除文件索引
func (s *FileNameSearchService) DeleteFile(fileID int64) error {
	if s.client.IsDisabled() {
		return nil
	}

	req := esapi.DeleteRequest{
		Index:      s.client.GetIndexName(),
		DocumentID: fmt.Sprintf("%d", fileID),
		Refresh:    "true",
	}

	res, err := req.Do(context.Background(), s.client)
	if err != nil {
		return fmt.Errorf("删除文档失败: %v", err)
	}
	defer res.Body.Close()

	if res.IsError() && res.StatusCode != 404 {
		return fmt.Errorf("删除文档响应错误: %s", res.Status())
	}

	return nil
}

// convertToFileDocument 转换为文件文档
func (s *FileNameSearchService) convertToFileDocument(file *model.File) FileDocument {
	// 提取文件名信息 - 使用更简单可靠的方法
	fileName := model.ExtractSimpleFileName(file.Path)
	baseName := model.ExtractSimpleBaseName(file.Path)

	// 如果文件名提取失败，使用完整路径作为备选
	if fileName == "" {
		fileName = file.Path
		logger.SysLogf("文件名提取失败，使用完整路径: fileID=%d, path=%s", file.ID, file.Path)
	}

	// 如果base_name为空，使用file_name去掉扩展名
	if baseName == "" && fileName != "" {
		if lastDot := strings.LastIndex(fileName, "."); lastDot > 0 {
			baseName = fileName[:lastDot]
		} else {
			baseName = fileName
		}
	}

	// 生成小写基本名称用于忽略大小写的搜索
	lowerBaseName := strings.ToLower(baseName)

	fileExtension := ""
	// lazy: 仅查 upload_file，不新增 UploadFileID=0 文件的查询；如需要统一查所有文件的扩展名再改为 JOIN
	if s.db != nil && file.UploadFileID > 0 {
		var uploadFile model.UploadFile
		if err := s.db.Select("extension").Where("id = ?", file.UploadFileID).First(&uploadFile).Error; err == nil && uploadFile.Extension != "" {
			fileExtension = uploadFile.Extension
		}
	}
	if fileExtension == "" {
		if lastDot := strings.LastIndex(fileName, "."); lastDot > 0 {
			fileExtension = strings.ToLower(fileName[lastDot:])
		}
	}

	logger.SysLogf("转换文件文档: fileID=%d, path=%s, fileName=%s, baseName=%s, lowerBaseName=%s",
		file.ID, file.Path, fileName, baseName, lowerBaseName)

	return FileDocument{
		FileID:        file.ID,
		Eid:           file.Eid,
		LibraryID:     file.LibraryID,
		OriginType:    file.OriginType,
		OriginRefID:   file.OriginRefID,
		OriginSource:  file.OriginSource,
		Path:          file.Path,
		FileName:      fileName,
		BaseName:      baseName,
		LowerBaseName: lowerBaseName,
		Type:          file.Type,
		IsDeleted:     file.IsDeleted,
		UserID:        file.UserID,
		CreatedTime:   file.CreatedTime,
		UpdatedTime:   file.UpdatedTime,
		FileExtension: fileExtension,
	}
}

// indexDocument 索引单个文档
func (s *FileNameSearchService) indexDocument(doc FileDocument) error {
	docJSON, err := json.Marshal(doc)
	if err != nil {
		return fmt.Errorf("序列化文档失败: %v", err)
	}

	req := esapi.IndexRequest{
		Index:      s.client.GetIndexName(),
		DocumentID: fmt.Sprintf("%d", doc.FileID),
		Body:       bytes.NewReader(docJSON),
		Refresh:    "false",
	}

	res, err := req.Do(context.Background(), s.client)
	if err != nil {
		return fmt.Errorf("索引文档失败: %v", err)
	}
	defer res.Body.Close()

	if res.IsError() {
		return fmt.Errorf("索引文档响应错误: %s", res.Status())
	}

	return nil
}

// indexDocumentsBatch 批量索引文档
func (s *FileNameSearchService) indexDocumentsBatch(docs []FileDocument) error {
	if len(docs) == 0 {
		return nil
	}

	var buf bytes.Buffer
	for _, doc := range docs {
		// 写入索引操作
		meta := map[string]interface{}{
			"index": map[string]interface{}{
				"_index": s.client.GetIndexName(),
				"_id":    fmt.Sprintf("%d", doc.FileID),
			},
		}
		metaBytes, _ := json.Marshal(meta)
		buf.Write(metaBytes)
		buf.WriteByte('\n')

		// 写入文档数据
		docBytes, _ := json.Marshal(doc)
		buf.Write(docBytes)
		buf.WriteByte('\n')
	}

	req := esapi.BulkRequest{
		Body:    &buf,
		Refresh: "true", // 立即刷新索引确保数据可搜索
	}

	res, err := req.Do(context.Background(), s.client)
	if err != nil {
		return fmt.Errorf("批量索引失败: %v", err)
	}
	defer res.Body.Close()

	if res.IsError() {
		return fmt.Errorf("批量索引响应错误: %s", res.Status())
	}

	var bulkResp map[string]interface{}
	if err := json.NewDecoder(res.Body).Decode(&bulkResp); err != nil {
		return fmt.Errorf("解析批量索引响应失败: %v", err)
	}
	if itemsErr, ok := bulkResp["errors"].(bool); ok && itemsErr {
		logger.SysLogf("批量索引存在逐项失败: index=%s, items=%v", s.client.GetIndexName(), bulkResp["items"])
	}

	return nil
}

// GetFileNamesByPattern 根据模式获取文件名（用于自动补全）
func (s *FileNameSearchService) GetFileNamesByPattern(eid int64, pattern string, libraryIDs []int64, limit int) ([]string, error) {
	if s.client.IsDisabled() {
		return []string{}, fmt.Errorf("Elasticsearch 已禁用")
	}

	if limit <= 0 {
		limit = 10
	}

	// 构建自动补全查询
	query := map[string]interface{}{
		"query": map[string]interface{}{
			"bool": map[string]interface{}{
				"must": []map[string]interface{}{
					{
						"term": map[string]interface{}{
							"eid": eid,
						},
					},
					{
						"term": map[string]interface{}{
							"is_deleted": false,
						},
					},
					{
						"prefix": map[string]interface{}{
							"base_name": strings.ToLower(pattern),
						},
					},
				},
			},
		},
		"_source": []string{"base_name"},
		"size":    limit,
	}

	// 添加知识库过滤
	if len(libraryIDs) > 0 {
		query["query"].(map[string]interface{})["bool"].(map[string]interface{})["filter"] = []map[string]interface{}{
			{
				"terms": map[string]interface{}{
					"library_id": libraryIDs,
				},
			},
		}
	}

	// 序列化查询
	var buf bytes.Buffer
	if err := json.NewEncoder(&buf).Encode(query); err != nil {
		return nil, fmt.Errorf("编码查询失败: %v", err)
	}

	// 执行搜索
	res, err := s.client.Search(
		s.client.Search.WithContext(context.Background()),
		s.client.Search.WithIndex(s.client.GetIndexName()),
		s.client.Search.WithBody(&buf),
		s.client.Search.WithSize(limit),
	)
	if err != nil {
		return nil, fmt.Errorf("搜索请求失败: %v", err)
	}
	defer res.Body.Close()

	if res.IsError() {
		return nil, fmt.Errorf("搜索响应错误: %s", res.Status())
	}

	// 解析响应
	var searchResponse map[string]interface{}
	if err := json.NewDecoder(res.Body).Decode(&searchResponse); err != nil {
		return nil, fmt.Errorf("解析响应失败: %v", err)
	}

	// 提取结果
	hits := searchResponse["hits"].(map[string]interface{})
	hitsList := hits["hits"].([]interface{})

	var suggestions []string
	seen := make(map[string]bool)

	for _, hit := range hitsList {
		hitMap := hit.(map[string]interface{})
		source := hitMap["_source"].(map[string]interface{})
		baseName := source["base_name"].(string)

		if baseName != "" && !seen[baseName] {
			suggestions = append(suggestions, baseName)
			seen[baseName] = true
		}
	}

	return suggestions, nil
}

// buildFileNameQuery 根据请求参数构建文件名查询
func (s *FileNameSearchService) buildFileNameQuery(req *FileNameSearchRequest) map[string]interface{} {
	// 设置默认值
	caseSensitive := false
	if req.CaseSensitive != nil {
		caseSensitive = *req.CaseSensitive
	}

	// fuzzyThreshold := "AUTO" // 默认自动模糊
	// if req.FuzzyThreshold != nil {
	// 	switch *req.FuzzyThreshold {
	// 	case 1:
	// 		fuzzyThreshold = "1"
	// 	case 2:
	// 		fuzzyThreshold = "2"
	// 	default:
	// 		fuzzyThreshold = "AUTO"
	// 	}
	// }

	var fileNameQuery map[string]interface{}

	if caseSensitive {
		// 大小写敏感：使用case_sensitive字段进行精确匹配、模糊匹配和通配符匹配
		fileNameQuery = map[string]interface{}{
			"bool": map[string]interface{}{
				"should": []map[string]interface{}{
					// 精确匹配（最高优先级）
					{
						"term": map[string]interface{}{
							"base_name.case_sensitive": map[string]interface{}{
								"value": req.Query,
								"boost": 5.5,
							},
						},
					},
					// 模糊匹配（中等优先级）
					// {
					// 	"match": map[string]interface{}{
					// 		"base_name.fuzzy": map[string]interface{}{
					// 			"query":     req.Query,
					// 			"fuzziness": fuzzyThreshold,
					// 			"boost":     3.0,
					// 		},
					// 	},
					// },
					// 通配符匹配（低优先级）
					{
						"wildcard": map[string]interface{}{
							"base_name.case_sensitive": map[string]interface{}{
								"value": "*" + req.Query + "*",
								"boost": 1.0,
							},
						},
					},
				},
				"minimum_should_match": 1,
			},
		}
	} else {
		// 大小写不敏感：使用lower_base_name.keyword字段进行精确匹配和通配符匹配
		fileNameQuery = map[string]interface{}{
			"bool": map[string]interface{}{
				"should": []map[string]interface{}{
					// 精确匹配（最高优先级）
					{
						"term": map[string]interface{}{
							"lower_base_name.keyword": map[string]interface{}{
								"value": strings.ToLower(req.Query),
								"boost": 5.5,
							},
						},
					},
					// 通配符匹配（中等优先级）- 使用lower_base_name.keyword实现忽略大小写的搜索
					{
						"wildcard": map[string]interface{}{
							"lower_base_name.keyword": map[string]interface{}{
								"value": "*" + strings.ToLower(req.Query) + "*",
								"boost": 4.5,
							},
						},
					},
				},
				"minimum_should_match": 1,
			},
		}
	}

	return fileNameQuery
}

// SearchWithRecentAccessSort 按最近访问排序执行复合搜索
func (s *FileNameSearchService) SearchWithRecentAccessSort(eid int64, userID int64, req *FileNameSearchRequest) (*FileNameSearchResponse, error) {
	startTime := time.Now()

	if s.client == nil || s.client.IsDisabled() {
		return &FileNameSearchResponse{
			Results: []FileNameSearchResult{},
			Total:   0,
			Time:    time.Since(startTime).Milliseconds(),
			Query:   req.Query,
			Source:  "db",
		}, nil
	}

	recentFileIDs, err := model.GetUserRecentFileIDs(eid, userID, 1000)
	if err != nil {
		return nil, fmt.Errorf("获取最近访问文件失败: %v", err)
	}
	if len(recentFileIDs) == 0 {
		return &FileNameSearchResponse{
			Results: []FileNameSearchResult{},
			Total:   0,
			Time:    time.Since(startTime).Milliseconds(),
			Query:   req.Query,
			Source:  "es",
		}, nil
	}

	query := s.buildSearchQuery(eid, req)

	boolQuery := query["query"].(map[string]interface{})["bool"].(map[string]interface{})
	var filters []map[string]interface{}
	if f, ok := boolQuery["filter"].([]map[string]interface{}); ok {
		filters = f
	}
	filters = append(filters, map[string]interface{}{
		"terms": map[string]interface{}{
			"file_id": recentFileIDs,
		},
	})
	boolQuery["filter"] = filters

	query["sort"] = []map[string]interface{}{
		{"_score": map[string]interface{}{"order": "desc"}},
	}

	from := 0
	size := req.Size
	if size <= 0 {
		size = 20
	}
	results, total, err := s.executeSearch(query, from, size)
	if err != nil {
		return nil, err
	}

	rankMap := make(map[int64]int, len(recentFileIDs))
	for i, fid := range recentFileIDs {
		rankMap[fid] = i
	}
	sort.SliceStable(results, func(i, j int) bool {
		ri, oki := rankMap[results[i].FileID]
		rj, okj := rankMap[results[j].FileID]
		if !oki {
			return false
		}
		if !okj {
			return true
		}
		return ri < rj
	})

	s.enrichWithLibraryInfo(results)
	s.enrichWithCreatorInfo(results)
	s.enrichWithLatestFileBodyUpdateTime(results)

	searchTime := time.Since(startTime).Milliseconds()

	return &FileNameSearchResponse{
		Results: results,
		Total:   total,
		Time:    searchTime,
		Query:   req.Query,
		Source:  "es",
	}, nil
}
