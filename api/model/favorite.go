package model

import (
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"
)

// FavoriteListQuery 收藏列表查询条件
type FavoriteListQuery struct {
	ResourceType *int
	Keyword      string
	Offset       int
	Limit        int
	Eid          int64
}

// Favorite 收藏记录表
type Favorite struct {
	ID           int64 `json:"id" gorm:"primaryKey;autoIncrement"`
	UserID       int64 `json:"user_id" gorm:"not null;index:idx_user_res_status,priority:1"`
	ResourceType int   `json:"resource_type" gorm:"not null;index:idx_user_res_status,priority:2"` // 使用 model.PERMISSION 的资源类型常量
	ResourceID   int64 `json:"resource_id" gorm:"not null;index:idx_user_res_status,priority:3"`
	Status       int8  `json:"status" gorm:"not null;default:1;index:idx_user_res_status,priority:4"` // 1:有效,0:取消（假删）
	BaseModel
}

// 表名
func (Favorite) TableName() string { return "favorites" }

// 状态常量
const (
	FavoriteStatusActive int8 = 1
	FavoriteStatusCancel int8 = 0
)

// 校验
func (f *Favorite) Validate() error {
	if f.UserID <= 0 {
		return errors.New("用户ID无效")
	}
	if f.ResourceID <= 0 {
		return errors.New("资源ID无效")
	}
	if f.ResourceType != RESOURCE_TYPE_FILE && f.ResourceType != RESOURCE_TYPE_LIBRARY {
		return errors.New("资源类型无效")
	}
	return nil
}

// Create 创建收藏（默认置为 Active），若已存在且为取消状态，建议使用 UpdateStatus 恢复
func (f *Favorite) Create() error {
	if err := f.Validate(); err != nil {
		return err
	}
	exist, err := f.Exists()
	if err != nil {
		return err
	}
	if exist {
		return errors.New("已存在收藏记录")
	}
	f.Status = FavoriteStatusActive
	return DB.Create(f).Error
}

// UpdateStatus 更新收藏状态
func (f *Favorite) UpdateStatus(newStatus int8) error {
	if newStatus != FavoriteStatusActive && newStatus != FavoriteStatusCancel {
		return errors.New("无效的状态值")
	}
	f.Status = newStatus
	return DB.Model(f).Updates(map[string]interface{}{
		"status":       f.Status,
		"updated_time": time.Now().UTC().UnixMilli(),
	}).Error
}

// Delete 软删（设为取消）
func (f *Favorite) Delete() error {
	return f.UpdateStatus(FavoriteStatusCancel)
}

// HardDelete 硬删除
func (f *Favorite) HardDelete() error {
	return DB.Delete(f).Error
}

// Exists 是否存在当前用户-类型-资源的收藏记录
func (f *Favorite) Exists() (bool, error) {
	var count int64
	err := DB.Model(&Favorite{}).
		Where("user_id = ? AND resource_type = ? AND resource_id = ?", f.UserID, f.ResourceType, f.ResourceID).
		Count(&count).Error
	return count > 0, err
}

// GetFavoriteByUserObject 获取收藏记录
func GetFavoriteByUserObject(userID int64, resourceType int, resourceID int64) (*Favorite, error) {
	var fav Favorite
	err := DB.Where("user_id = ? AND resource_type = ? AND resource_id = ?", userID, resourceType, resourceID).
		First(&fav).Error
	if err != nil {
		return nil, err
	}
	return &fav, nil
}

// ToggleFavorite 切换收藏状态
func ToggleFavorite(userID int64, resourceType int, resourceID int64) error {
	// 查询是否存在
	fav, err := GetFavoriteByUserObject(userID, resourceType, resourceID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			// 不存在则创建为 Active
			nf := &Favorite{
				UserID:       userID,
				ResourceType: resourceType,
				ResourceID:   resourceID,
				Status:       FavoriteStatusActive,
			}
			return nf.Create()
		}
		return err
	}
	// 存在则在 Active/Cancel 间切换
	newStatus := FavoriteStatusCancel
	if fav.Status == FavoriteStatusCancel {
		newStatus = FavoriteStatusActive
	}
	return fav.UpdateStatus(newStatus)
}

// EnsureActiveFavorite 确保收藏为有效（用于 POST /favorites 幂等）
func EnsureActiveFavorite(userID int64, resourceType int, resourceID int64) error {
	fav, err := GetFavoriteByUserObject(userID, resourceType, resourceID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			nf := &Favorite{
				UserID:       userID,
				ResourceType: resourceType,
				ResourceID:   resourceID,
				Status:       FavoriteStatusActive,
			}
			return nf.Create()
		}
		return err
	}
	if fav.Status == FavoriteStatusActive {
		return nil
	}
	return fav.UpdateStatus(FavoriteStatusActive)
}

// GetUserFavorites 获取用户收藏（仅 Active），可选按类型过滤
func GetUserFavorites(userID int64, resourceType *int) ([]Favorite, error) {
	var favs []Favorite
	q := DB.Where("user_id = ? AND status = ?", userID, FavoriteStatusActive)
	if resourceType != nil {
		q = q.Where("resource_type = ?", *resourceType)
	}
	err := q.Order("updated_time desc").Find(&favs).Error
	return favs, err
}

// GetUserFavoritesForList 获取用户收藏列表，支持分页与关键词过滤
func GetUserFavoritesForList(userID int64, query FavoriteListQuery) ([]Favorite, error) {
	var favs []Favorite
	db := DB.Model(&Favorite{}).Where("favorites.user_id = ? AND favorites.status = ?", userID, FavoriteStatusActive)
	if query.ResourceType != nil {
		db = db.Where("favorites.resource_type = ?", *query.ResourceType)
	}

	db = db.Order("favorites.updated_time desc")
	if query.Offset > 0 {
		db = db.Offset(query.Offset)
	}
	if query.Limit > 0 {
		db = db.Limit(query.Limit)
	}

	if err := db.Find(&favs).Error; err != nil {
		return nil, err
	}
	return favs, nil
}

// GetUserFavoriteLibrariesByKeyword 获取用户收藏的知识库列表，支持关键词和分页
func GetUserFavoriteLibrariesByKeyword(userID, eid int64, keyword string, offset, limit int) ([]Favorite, error) {
	var favs []Favorite
	db := DB.Table("favorites").
		Select("favorites.*").
		Joins("JOIN libraries ON libraries.id = favorites.resource_id AND libraries.eid = ? AND libraries.status = ?", eid, LIBRARY_STATUS_ACTIVE).
		Where("favorites.user_id = ? AND favorites.status = ? AND favorites.resource_type = ?", userID, FavoriteStatusActive, RESOURCE_TYPE_LIBRARY)

	keyword = strings.TrimSpace(keyword)
	if keyword != "" {
		db = db.Where("libraries.name LIKE ?", "%"+keyword+"%")
	}

	db = db.Order("favorites.updated_time desc")
	if offset > 0 {
		db = db.Offset(offset)
	}
	if limit > 0 {
		db = db.Limit(limit)
	}

	if err := db.Find(&favs).Error; err != nil {
		return nil, err
	}
	return favs, nil
}

// GetUserFavoriteFilesByKeyword 获取用户收藏的文件列表，支持关键词和分页
func GetUserFavoriteFilesByKeyword(userID, eid int64, keyword string, offset, limit int) ([]Favorite, error) {
	var favs []Favorite
	db := DB.Table("favorites").
		Select("favorites.*").
		Joins("JOIN files ON files.id = favorites.resource_id AND files.eid = ? AND files.is_deleted = ?", eid, false).
		Where("favorites.user_id = ? AND favorites.status = ? AND favorites.resource_type = ?", userID, FavoriteStatusActive, RESOURCE_TYPE_FILE)

	keyword = strings.TrimSpace(keyword)
	if keyword != "" {
		db = db.Where("files.path LIKE ?", "%"+keyword+"%")
	}

	db = db.Order("favorites.updated_time DESC")
	if offset > 0 {
		db = db.Offset(offset)
	}
	if limit > 0 {
		db = db.Limit(limit)
	}

	if err := db.Find(&favs).Error; err != nil {
		return nil, err
	}
	return favs, nil
}

// IsFavorited 公共方法：是否收藏
func IsFavorited(userID int64, resourceType int, resourceID int64) (bool, error) {
	var count int64
	err := DB.Model(&Favorite{}).
		Where("user_id = ? AND resource_type = ? AND resource_id = ? AND status = ?", userID, resourceType, resourceID, FavoriteStatusActive).
		Count(&count).Error
	return count > 0, err
}

// GetFavoriteResourceIDMap 批量获取资源收藏状态
func GetFavoriteResourceIDMap(userID int64, resourceType int, resourceIDs []int64) (map[int64]bool, error) {
	result := make(map[int64]bool)
	if len(resourceIDs) == 0 {
		return result, nil
	}

	var favorites []Favorite
	if err := DB.Where("user_id = ? AND resource_type = ? AND status = ? AND resource_id IN ?",
		userID, resourceType, FavoriteStatusActive, resourceIDs).
		Find(&favorites).Error; err != nil {
		return nil, err
	}

	for _, fav := range favorites {
		result[fav.ResourceID] = true
	}
	return result, nil
}
