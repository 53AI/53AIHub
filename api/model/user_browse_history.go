package model

import (
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/rediskeys"
	"gorm.io/gorm"
)

type UserBrowseHistory struct {
	ID        int64 `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid       int64 `json:"eid" gorm:"not null"`
	UserID    int64 `json:"user_id" gorm:"not null;index:idx_user_browse_history_composite,priority:1"`
	LibraryID int64 `json:"library_id" gorm:"not null;default:0;index:idx_user_browse_history_composite,priority:2"`
	FileID    int64 `json:"file_id" gorm:"not null;default:0;index:idx_user_browse_history_composite,priority:3"`
	// 使用 UpdatedTime 作为浏览时间
	CreatedTime int64 `json:"created_time" gorm:"not null"`
	UpdatedTime int64 `json:"updated_time" gorm:"not null;index:idx_user_browse_history_composite,priority:4,sort:desc"`
}

type browseHistoryLocker interface {
	TryLock(name string, ttl time.Duration) bool
	Unlock(name string)
}

var recordBrowseHistoryLocker browseHistoryLocker

const browseHistoryLockTTL = 5 * time.Second
const browseHistoryLockMaxWait = 5 * time.Second
const browseHistoryLockRetryInterval = 50 * time.Millisecond

// SetBrowseHistoryLocker 设置浏览历史写入锁实现
func SetBrowseHistoryLocker(lock browseHistoryLocker) {
	recordBrowseHistoryLocker = lock
}

func (h *UserBrowseHistory) BeforeCreate(tx *gorm.DB) (err error) {
	now := time.Now().UTC().UnixMilli()
	if h.CreatedTime == 0 {
		h.CreatedTime = now
	}
	h.UpdatedTime = now
	return
}

// RecordBrowseHistory 记录浏览历史
func RecordBrowseHistory(eid, userID int64, libraryID int64, fileID int64) error {
	lockKey := rediskeys.GetUserBrowseHistoryLockKey(eid, userID, libraryID, fileID)
	if recordBrowseHistoryLocker != nil {
		if tryAcquireBrowseHistoryLock(lockKey) {
			defer recordBrowseHistoryLocker.Unlock(lockKey)
		}
	}

	now := time.Now().UTC().UnixMilli()

	// 创建浏览历史记录
	history := &UserBrowseHistory{
		Eid:       eid,
		UserID:    userID,
		LibraryID: libraryID,
		FileID:    fileID,
	}

	// 使用 FirstOrCreate 保证最终一定落库。
	return DB.Where("eid = ? AND user_id = ? AND library_id = ? AND file_id = ?",
		eid, userID, libraryID, fileID).
		Assign(map[string]interface{}{
			"updated_time": now,
		}).
		FirstOrCreate(history).Error
}

func tryAcquireBrowseHistoryLock(lockKey string) bool {
	deadline := time.Now().Add(browseHistoryLockMaxWait)
	for {
		if recordBrowseHistoryLocker.TryLock(lockKey, browseHistoryLockTTL) {
			return true
		}
		if time.Now().After(deadline) {
			return false
		}
		time.Sleep(browseHistoryLockRetryInterval)
	}
}

// GetUserRecentBrowseHistory 获取用户最近访问记录，支持同时包含知识库和文件
func GetUserRecentBrowseHistory(eid, userID int64, limit int) ([]UserBrowseHistory, error) {
	var histories []UserBrowseHistory
	query := DB.Where("eid = ? AND user_id = ? AND (file_id != ? OR library_id != ?)", eid, userID, 0, 0).
		Order("updated_time DESC")
	if limit > 0 {
		query = query.Limit(limit)
	}
	if err := query.Find(&histories).Error; err != nil {
		return nil, err
	}
	return histories, nil
}

// GetUserRecentBrowseHistoryPage 获取用户最近访问记录分页结果
func GetUserRecentBrowseHistoryPage(eid, userID int64, libraryID int64, resourceType *int, offset, limit int) ([]UserBrowseHistory, error) {
	var histories []UserBrowseHistory
	query := DB.Where("eid = ? AND user_id = ? AND (file_id != ? OR library_id != ?)", eid, userID, 0, 0)
	if libraryID > 0 {
		query = query.Where("library_id = ?", libraryID)
	}
	if resourceType != nil {
		switch *resourceType {
		case RESOURCE_TYPE_FILE:
			query = query.Where("file_id > ?", 0)
		case RESOURCE_TYPE_LIBRARY:
			query = query.Where("file_id = ? AND library_id > ?", 0, 0)
		}
	}
	query = query.Order("updated_time DESC")
	if offset > 0 {
		query = query.Offset(offset)
	}
	if limit > 0 {
		query = query.Limit(limit)
	}
	if err := query.Find(&histories).Error; err != nil {
		return nil, err
	}
	return histories, nil
}

// GetUserRecentLibrariesByKeyword 获取用户最近访问的知识库，支持关键词和分页
func GetUserRecentLibrariesByKeyword(eid, userID int64, libraryID int64, keyword string, offset, limit int) ([]UserBrowseHistory, error) {
	var histories []UserBrowseHistory
	query := DB.Table("user_browse_histories").
		Select("user_browse_histories.*").
		Joins("JOIN libraries ON libraries.id = user_browse_histories.library_id AND libraries.eid = user_browse_histories.eid AND libraries.status = ?", LIBRARY_STATUS_ACTIVE).
		Where("user_browse_histories.eid = ? AND user_browse_histories.user_id = ? AND user_browse_histories.file_id = ? AND user_browse_histories.library_id > ?", eid, userID, 0, 0)

	if libraryID > 0 {
		query = query.Where("user_browse_histories.library_id = ?", libraryID)
	}

	keyword = strings.TrimSpace(keyword)
	if keyword != "" {
		query = query.Where("libraries.name LIKE ?", "%"+keyword+"%")
	}

	query = query.Order("user_browse_histories.updated_time DESC")
	if offset > 0 {
		query = query.Offset(offset)
	}
	if limit > 0 {
		query = query.Limit(limit)
	}

	if err := query.Find(&histories).Error; err != nil {
		return nil, err
	}
	return histories, nil
}

// GetUserRecentFilesByKeyword 获取用户最近访问的文档，支持关键词和分页
func GetUserRecentFilesByKeyword(eid, userID int64, libraryID int64, keyword string, offset, limit int) ([]UserBrowseHistory, error) {
	var histories []UserBrowseHistory
	query := DB.Table("user_browse_histories").
		Select("user_browse_histories.*").
		Joins("JOIN files ON files.id = user_browse_histories.file_id AND files.eid = user_browse_histories.eid AND files.is_deleted = ?", false).
		Where("user_browse_histories.eid = ? AND user_browse_histories.user_id = ? AND user_browse_histories.file_id > ?", eid, userID, 0)

	if libraryID > 0 {
		query = query.Where("user_browse_histories.library_id = ?", libraryID)
	}

	keyword = strings.TrimSpace(keyword)
	if keyword != "" {
		query = query.Where("files.path LIKE ?", "%"+keyword+"%")
	}

	query = query.Order("user_browse_histories.updated_time DESC")
	if offset > 0 {
		query = query.Offset(offset)
	}
	if limit > 0 {
		query = query.Limit(limit)
	}

	if err := query.Find(&histories).Error; err != nil {
		return nil, err
	}
	return histories, nil
}

// GetUserRecentLibraries 获取用户最近访问的知识库
func GetUserRecentLibraries(eid, userID int64, limit int) ([]Library, error) {
	var histories []UserBrowseHistory
	query := DB.Where("eid = ? AND user_id = ? AND file_id = ?", eid, userID, 0).
		Order("updated_time DESC")
	if limit > 0 {
		query = query.Limit(limit)
	}
	err := query.Find(&histories).Error
	if err != nil {
		return nil, err
	}

	var libraryIDs []int64
	for _, h := range histories {
		libraryIDs = append(libraryIDs, h.LibraryID)
	}

	if len(libraryIDs) == 0 {
		return []Library{}, nil
	}

	var libraries []Library
	// 查询所有匹配的库，不使用 FIND_IN_SET 函数以确保兼容不同数据库
	// FIND_IN_SET 是 MySQL 特有的函数，用于按给定顺序返回结果
	// 为了保持数据库通用性，我们先查询数据，然后在应用层按原始顺序排序
	err = DB.Where("eid = ? AND id IN ? AND status = ?", eid, libraryIDs, 0).Find(&libraries).Error
	if err != nil {
		return nil, err
	}

	// 按照 libraryIDs 的顺序对结果进行排序，模拟 FIND_IN_SET 的效果
	librariesMap := make(map[int64]Library)
	for _, lib := range libraries {
		librariesMap[lib.ID] = lib
	}

	// 只保留能找到且状态活跃的知识库
	var sortedLibraries []Library
	for _, id := range libraryIDs {
		if lib, exists := librariesMap[id]; exists && lib.ID != 0 {
			sortedLibraries = append(sortedLibraries, lib)
		}
	}

	return sortedLibraries, nil
}

// GetUserRecentFiles 获取用户最近访问的文档
func GetUserRecentFiles(eid, userID int64, limit int) ([]File, error) {
	return GetUserRecentFilesByLibrary(eid, userID, 0, limit)
}

// GetUserRecentFilesByLibrary 获取用户最近访问的文档，可指定知识库ID
func GetUserRecentFilesByLibrary(eid, userID int64, libraryId int64, limit int) ([]File, error) {
	var histories []UserBrowseHistory
	query := DB.Where("eid = ? AND user_id = ? AND file_id != ?", eid, userID, 0)

	// 如果指定了 libraryId，则添加过滤条件
	if libraryId > 0 {
		query = query.Where("library_id = ?", libraryId)
	}

	query = query.Order("updated_time DESC")
	if limit > 0 {
		query = query.Limit(limit)
	}
	err := query.Find(&histories).Error
	if err != nil {
		return nil, err
	}

	var fileIDs []int64
	for _, h := range histories {
		fileIDs = append(fileIDs, h.FileID)
	}

	if len(fileIDs) == 0 {
		return []File{}, nil
	}

	var files []File
	// 查询所有匹配的文件，不使用 FIND_IN_SET 函数以确保兼容不同数据库
	// FIND_IN_SET 是 MySQL 特有的函数，用于按给定顺序返回结果
	// 为了保持数据库通用性，我们先查询数据，然后在应用层按原始顺序排序
	err = DB.Where("eid = ? AND id IN ? AND is_deleted = ?", eid, fileIDs, false).Find(&files).Error
	if err != nil {
		return nil, err
	}

	// 按照 fileIDs 的顺序对结果进行排序，模拟 FIND_IN_SET 的效果
	filesMap := make(map[int64]File)
	for _, file := range files {
		filesMap[file.ID] = file
	}

	// 只保留能找到且未被删除的文件
	var sortedFiles []File
	for _, id := range fileIDs {
		if file, exists := filesMap[id]; exists && file.ID != 0 {
			sortedFiles = append(sortedFiles, file)
		}
	}

	return sortedFiles, nil
}
