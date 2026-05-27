package model

import (
	"errors"
	"strings"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Library struct {
	ID          int64  `json:"id" gorm:"primaryKey;autoIncrement"`
	UUID        string `json:"uuid" gorm:"size:36;uniqueIndex"`
	Name        string `json:"name" gorm:"not null;size:255" binding:"required"`
	Description string `json:"description" gorm:"type:text"`
	Icon        string `json:"icon" gorm:"size:255"`
	SpaceID     int64  `json:"space_id" gorm:"not null;index"`
	Eid         int64  `json:"eid" gorm:"not null;index"`
	CreatorID   int64  `json:"creator_id" gorm:"not null;index"`
	LibraryKind string `json:"library_kind" gorm:"size:32;not null;default:regular;index"`
	Status      int    `json:"status" gorm:"not null;default:0" example:"0"` // 0=active, 1=archived
	Sort        int64  `json:"sort" gorm:"not null;default:0" example:"0"`
	// 知识库可见性设置: 0=继承空间设置(默认), 1=公开可见, 2=私有不可见
	Visibility int `json:"visibility" gorm:"not null;default:0" example:"0"`
	// 非持久化：回传用户对该库的权限级别（与KM权限体系一致）
	Permission int   `json:"permission" gorm:"-"`
	FileCount  int64 `json:"file_count" gorm:"-"`
	BaseModel
	Recent     []File `json:"recent" binding:"omitempty"`
	IsFavorite bool   `json:"is_favorite" gorm:"-"`
}

// 知识库可见性类型常量
const (
	LIBRARY_VISIBILITY_INHERIT = 0 // 继承空间设置（默认）
	LIBRARY_VISIBILITY_PUBLIC  = 1 // 公开可见
	LIBRARY_VISIBILITY_PRIVATE = 2 // 私有不可见
)

const (
	LIBRARY_STATUS_ACTIVE   = 0
	LIBRARY_STATUS_ARCHIVED = 1
)

const (
	LIBRARY_KIND_REGULAR       = LibraryKindRegular
	LIBRARY_KIND_PERSONAL_USER = LibraryKindPersonalUser
)

const (
	LIBRARY_PERMISSION_READ  = 0
	LIBRARY_PERMISSION_WRITE = 1
	LIBRARY_PERMISSION_ADMIN = 2
)

// Save 创建知识库
func (library *Library) Save() error {
	if library.Name == "" {
		return errors.New("library name is required")
	}
	if library.LibraryKind == "" {
		library.LibraryKind = LIBRARY_KIND_REGULAR
	}

	// 检查同一空间下知识库名称是否重复
	existingLibrary, err := GetLibraryByName(library.SpaceID, library.Name)
	if err == nil && existingLibrary != nil {
		return errors.New("library name already exists in this space")
	}

	// 生成UUID
	if library.UUID == "" {
		library.UUID = uuid.New().String()
	}

	result := DB.Create(library)
	if result.Error != nil {
		return result.Error
	}
	return nil
}

// SaveWithTx 使用传入事务创建知识库（避免全局DB依赖）
func (library *Library) SaveWithTx(tx *gorm.DB) error {
	if tx == nil {
		return errors.New("nil tx")
	}
	if library.Name == "" {
		return errors.New("library name is required")
	}
	if library.LibraryKind == "" {
		library.LibraryKind = LIBRARY_KIND_REGULAR
	}

	// 检查同一空间下知识库名称是否重复（使用 tx）
	var exist Library
	if err := tx.Where("space_id = ? AND name = ?", library.SpaceID, library.Name).First(&exist).Error; err == nil && exist.ID != 0 {
		return errors.New("library name already exists in this space")
	}

	// 生成UUID
	if library.UUID == "" {
		library.UUID = uuid.New().String()
	}

	if err := tx.Create(library).Error; err != nil {
		return err
	}
	return nil
}

// Update 更新知识库信息
func (library *Library) Update() error {
	if library.Name == "" {
		return errors.New("library name is required")
	}

	// 检查名称重复（排除自己）
	existingLibrary, err := GetLibraryByName(library.SpaceID, library.Name)
	if err == nil && existingLibrary != nil && existingLibrary.ID != library.ID {
		return errors.New("library name already exists in this space")
	}

	// 明确指定要更新的字段，确保零值也能被更新，在原来的基础上加上 Visibility
	result := DB.Model(library).Select("Name", "Description", "Icon", "SpaceID", "Visibility").Updates(library)
	if result.Error != nil {
		return result.Error
	}
	return nil
}

func (library *Library) IsPersonalLibrary() bool {
	return library != nil && library.LibraryKind == LIBRARY_KIND_PERSONAL_USER
}

// GetLibraryByID 根据ID获取知识库
func GetLibraryByID(eid int64, id int64) (*Library, error) {
	var library Library
	if err := DB.Where("eid = ? AND id = ?", eid, id).First(&library).Error; err != nil {
		return nil, err
	}
	return &library, nil
}

// GetLibrariesByIDs 根据ID列表批量获取知识库
func GetLibrariesByIDs(eid int64, ids []int64) ([]Library, error) {
	var libraries []Library
	if len(ids) == 0 {
		return libraries, nil
	}
	if err := DB.Where("eid = ? AND id IN ? AND status = ?", eid, ids, LIBRARY_STATUS_ACTIVE).Find(&libraries).Error; err != nil {
		return nil, err
	}
	return libraries, nil
}

// GetLibrariesByIDsAndName 根据ID列表和名称模糊匹配知识库
func GetLibrariesByIDsAndName(eid int64, ids []int64, name string) ([]Library, error) {
	var libraries []Library
	if len(ids) == 0 {
		return libraries, nil
	}

	query := DB.Where("eid = ? AND id IN ? AND status = ?", eid, ids, LIBRARY_STATUS_ACTIVE)
	name = strings.TrimSpace(name)
	if name != "" {
		query = query.Where("name LIKE ?", "%"+name+"%")
	}

	if err := query.Find(&libraries).Error; err != nil {
		return nil, err
	}
	return libraries, nil
}

// GetLibraryByUUID 根据UUID获取知识库
func GetLibraryByUUID(eid int64, uuid string) (*Library, error) {
	var library Library
	if err := DB.Where("eid = ? AND uuid = ?", eid, uuid).First(&library).Error; err != nil {
		return nil, err
	}
	return &library, nil
}

// GetLibraryByName 根据名称获取知识库
func GetLibraryByName(spaceID int64, name string) (*Library, error) {
	var library Library
	if err := DB.Where("space_id = ? AND name = ?", spaceID, name).First(&library).Error; err != nil {
		return nil, err
	}
	return &library, nil
}

func GetPersonalLibraryByEidAndCreator(eid int64, creatorID int64) (*Library, error) {
	var library Library
	if err := DB.Where("eid = ? AND creator_id = ? AND library_kind = ?", eid, creatorID, LIBRARY_KIND_PERSONAL_USER).
		First(&library).Error; err != nil {
		return nil, err
	}
	return &library, nil
}

// GetLibrariesBySpaceID 获取空间下的所有知识库
func GetLibrariesBySpaceID(eid int64, spaceID int64) ([]Library, error) {
	var libraries []Library
	if err := DB.Where("eid = ? AND space_id = ?", eid, spaceID).
		Order("sort asc, created_time desc").Find(&libraries).Error; err != nil {
		return nil, err
	}
	return libraries, nil
}

// GetLibrariesByEid 获取企业下的所有知识库
func GetLibrariesByEid(eid int64, status *int) ([]Library, error) {
	var libraries []Library
	query := DB.Where("eid = ?", eid).Where("library_kind = ? OR library_kind = ?", LIBRARY_KIND_REGULAR, "")

	if status != nil {
		query = query.Where("status = ?", *status)
	}

	if err := query.Order("sort asc, created_time desc").Find(&libraries).Error; err != nil {
		return nil, err
	}
	return libraries, nil
}

// GetLibraryListWithIDs 基于筛选与ID集合的分页查询
// - name: 模糊匹配（若非空）
// - status: 等值过滤（可选）
// - spaceID: 等值过滤（可选）
// - ids: 若为 nil 不限制；若为空切片则直接返回空；否则 IN 过滤
// - 分页：offset/limit；当 limit<=0 时不限制条数
func GetLibraryListWithIDs(eid int64, name string, status *int, spaceID *int64, ids []int64, offset, limit int) (count int64, libraries []Library, err error) {
	query := DB.Model(&Library{}).Where("eid = ?", eid).Where("library_kind = ? OR library_kind = ?", LIBRARY_KIND_REGULAR, "")

	if name != "" {
		like := "%" + name + "%"
		query = query.Where("name LIKE ?", like)
	}
	if status != nil {
		query = query.Where("status = ?", *status)
	}
	if spaceID != nil {
		query = query.Where("space_id = ?", *spaceID)
	}
	if ids != nil {
		if len(ids) == 0 {
			return 0, []Library{}, nil
		}
		query = query.Where("id IN ?", ids)
	}

	// 统计总数
	if err = query.Count(&count).Error; err != nil {
		return 0, nil, err
	}

	// 列表查询
	query = query.Order("sort asc, created_time desc")
	if limit > 0 {
		query = query.Offset(offset).Limit(limit)
	}
	if err = query.Find(&libraries).Error; err != nil {
		return 0, nil, err
	}
	return count, libraries, nil
}

// DeleteLibrary 删除知识库
func DeleteLibrary(eid int64, id int64) error {
	// 检查知识库是否存在
	library, err := GetLibraryByID(eid, id)
	if err != nil {
		return err
	}

	// 检查知识库下是否有文件
	files, err := GetFilesByLibraryID(eid, library.ID)
	if err != nil {
		return err
	}
	if len(files) > 0 {
		// return fmt.Errorf("cannot delete library with files")
		for _, file := range files {
			if err := DeleteFile(eid, file.ID); err != nil {
				// 忽略"record not found"错误，因为文件可能已被其他进程删除
				if !errors.Is(err, gorm.ErrRecordNotFound) {
					return err
				}
			}
		}
	}

	// 开启事务
	tx := DB.Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	var entityIDs []int64
	if err := tx.Model(&EntityChunkRelation{}).
		Distinct("entity_id").
		Where("eid = ? AND library_id = ?", eid, id).
		Pluck("entity_id", &entityIDs).Error; err != nil {
		tx.Rollback()
		return err
	}
	if err := tx.Where("eid = ? AND library_id = ?", eid, id).Delete(&EntityChunkRelation{}).Error; err != nil {
		tx.Rollback()
		return err
	}

	// 删除知识库
	if err := tx.Where("eid = ? AND id = ?", eid, id).Delete(&Library{}).Error; err != nil {
		tx.Rollback()
		return err
	}

	if err := DeleteOrphanEntitiesByIDsWithDB(tx, eid, entityIDs); err != nil {
		tx.Rollback()
		return err
	}

	return tx.Commit().Error
}

// BatchUpdateLibrarySort 批量更新知识库排序
func BatchUpdateLibrarySort(eid int64, sortList []struct {
	ID   int64 `json:"id" binding:"required"`
	Sort int64 `json:"sort" binding:"required"`
}) error {
	tx := DB.Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	for _, item := range sortList {
		if err := tx.Model(&Library{}).Where("eid = ? AND id = ?", eid, item.ID).Update("sort", item.Sort).Error; err != nil {
			tx.Rollback()
			return err
		}
	}

	return tx.Commit().Error
}

func GetRecentlyLibraries(eid int64, limit int) ([]Library, error) {
	var libraries []Library
	if err := DB.Where("eid =?", eid).Where("library_kind = ? OR library_kind = ?", LIBRARY_KIND_REGULAR, "").
		Order("updated_time desc").
		Limit(limit).
		Find(&libraries).Error; err != nil {
		return nil, err
	}
	return libraries, nil
}

// CreateDefaultLibrary 为空间创建默认知识库
func CreateDefaultLibrary(spaceID int64, eid int64, creatorID int64) (*Library, error) {
	library := &Library{
		Name:        "默认知识库",
		Description: "空间的默认知识库",
		SpaceID:     spaceID,
		Eid:         eid,
		CreatorID:   creatorID,
		LibraryKind: LIBRARY_KIND_REGULAR,
		Status:      LIBRARY_STATUS_ACTIVE,
		Sort:        0,
	}

	if err := library.Save(); err != nil {
		return nil, err
	}

	return library, nil
}

// GetDefaultLibrary 获取空间的默认知识库
func GetDefaultLibrary(eid int64, spaceID int64) (*Library, error) {
	var library Library
	if err := DB.Where("eid = ? AND space_id = ? AND name = ?", eid, spaceID, "默认知识库").
		First(&library).Error; err != nil {
		return nil, err
	}
	return &library, nil
}

// GetVectorCollectionName 获取向量集合名称的统一方法
func GetVectorCollectionName(libraryUUID string) string {
	return "library_" + libraryUUID
}
