package model

import (
	"errors"
)

type LibraryQuery struct {
	ID           int64  `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid          int64  `json:"eid" gorm:"not null;index"`
	LibraryID    *int64 `json:"library_id" gorm:"index"` // 可为空，表示跨库搜索
	UserID       int64  `json:"user_id" gorm:"not null;index"`
	QueryText    string `json:"query_text" gorm:"type:text;not null"`
	SearchType   string `json:"search_type" gorm:"size:20;not null;default:'hybrid'"`
	TopK         int    `json:"top_k" gorm:"not null;default:10"`
	TotalResults int    `json:"total_results" gorm:"not null;default:0"`
	SearchTimeMs int64  `json:"search_time_ms" gorm:"not null;default:0"`
	BaseModel
}

// LibraryQueryWithUser 包含用户信息的查询记录
type LibraryQueryWithUser struct {
	LibraryQuery
	UserName string `json:"user_name"`
}

// Save 创建查询记录
func (lq *LibraryQuery) Save() error {
	if lq.QueryText == "" {
		return errors.New("query text is required")
	}

	result := DB.Create(lq)
	if result.Error != nil {
		return result.Error
	}
	return nil
}

// GetLibraryQueryByID 根据ID获取查询记录
func GetLibraryQueryByID(eid int64, id int64) (*LibraryQuery, error) {
	var query LibraryQuery
	if err := DB.Where("eid = ? AND id = ?", eid, id).First(&query).Error; err != nil {
		return nil, err
	}
	return &query, nil
}

// GetLibraryQueries 获取知识库的查询历史记录
func GetLibraryQueries(eid int64, libraryID int64, page, pageSize int, searchType, startDate, endDate string) ([]LibraryQueryWithUser, int64, error) {
	var queries []LibraryQueryWithUser
	var total int64

	query := DB.Table("library_queries").
		Select("library_queries.*, users.username as user_name").
		Joins("LEFT JOIN users ON library_queries.user_id = users.user_id").
		Where("library_queries.eid = ? AND library_queries.library_id = ?", eid, libraryID)

	// 添加搜索类型过滤
	if searchType != "" {
		query = query.Where("library_queries.search_type = ?", searchType)
	}

	// 添加日期范围过滤
	if startDate != "" {
		query = query.Where("library_queries.created_time >= ?", startDate)
	}
	if endDate != "" {
		query = query.Where("library_queries.created_time <= ?", endDate)
	}

	// 获取总数
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	// 分页查询
	offset := (page - 1) * pageSize
	if err := query.Order("library_queries.created_time DESC").
		Limit(pageSize).
		Offset(offset).
		Find(&queries).Error; err != nil {
		return nil, 0, err
	}

	return queries, total, nil
}

// CreateLibraryQuery 创建查询记录
func CreateLibraryQuery(eid int64, userID int64, libraryID *int64, queryText, searchType string, topK, totalResults int, searchTimeMs int64) (*LibraryQuery, error) {
	query := &LibraryQuery{
		Eid:          eid,
		LibraryID:    libraryID,
		UserID:       userID,
		QueryText:    queryText,
		SearchType:   searchType,
		TopK:         topK,
		TotalResults: totalResults,
		SearchTimeMs: searchTimeMs,
	}

	if err := query.Save(); err != nil {
		return nil, err
	}

	return query, nil
}

// DeleteLibraryQuery 删除查询记录
func DeleteLibraryQuery(eid int64, id int64) error {
	result := DB.Where("eid = ? AND id = ?", eid, id).Delete(&LibraryQuery{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return errors.New("query record not found")
	}
	return nil
}
