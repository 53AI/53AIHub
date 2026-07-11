package model

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"reflect"
	"time"

	"github.com/53AI/53AIHub/config"
	"gorm.io/gorm"
)

// fetchContentFromURL 从指定 URL 获取内容
func fetchContentFromURL(url string) ([]byte, error) {
	// 设置超时时间为 30 秒
	client := &http.Client{
		Timeout: 30 * time.Second,
	}

	resp, err := client.Get(url)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch content from URL: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	content, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}

	return content, nil
}

// AutoChunkingCallback 自动分块回调函数类型
type AutoChunkingCallback func(eid int64, fileID int64, userID int64, content string, configID *int64)

// autoChunkingCallback 全局回调函数变量
var autoChunkingCallback AutoChunkingCallback

// SetAutoChunkingCallback 设置自动分块回调函数
func SetAutoChunkingCallback(callback AutoChunkingCallback) {
	autoChunkingCallback = callback
}

type Space struct {
	ID           int64          `json:"id" gorm:"primaryKey;autoIncrement"`
	Name         string         `json:"name" gorm:"not null;size:255" binding:"required"`
	Description  string         `json:"description" gorm:"type:text"`
	Icon         string         `json:"icon" gorm:"size:255"`
	Eid          int64          `json:"eid" gorm:"not null;index"`
	OwnerID      int64          `json:"owner_id" gorm:"not null;index"`
	SpaceKind    string         `json:"space_kind" gorm:"size:32;not null;default:regular;index"`
	Status       int            `json:"status" gorm:"not null;default:0" example:"0"` // 0=active, 1=archived
	Sort         int64          `json:"sort" gorm:"not null;default:0" example:"0"`
	IsDefault    bool           `json:"is_default" gorm:"not null;default:0" example:"0"`
	Visibility   int            `json:"visibility" gorm:"not null;" example:"0"` // 0=private, 1=public
	OwnerInfo    SpaceOwnerInfo `json:"owner_info" gorm:"-"`
	LibraryCount int64          `json:"library_count" gorm:"-"`
	Permission   int            `json:"permission" gorm:"-"`
	BaseModel
}

type SpaceOwnerInfo struct {
	UserID         int64           `json:"user_id"`
	Username       string          `json:"username"`
	Nickname       string          `json:"nickname"`
	Avatar         string          `json:"avatar"`
	Mobile         string          `json:"mobile"`
	Email          string          `json:"email"`
	Eid            int64           `json:"eid"`
	Role           int64           `json:"role"`
	GroupId        int64           `json:"group_id"`
	Status         int             `json:"status"`
	ExpiredTime    int64           `json:"expired_time"`
	LastLoginTime  int64           `json:"last_login_time"`
	RelatedId      int64           `json:"related_id"`
	Type           int             `json:"type"`
	AddAdminTime   int64           `json:"add_admin_time"`
	OpenID         string          `json:"openid"`
	UnionID        string          `json:"unionid"`
	Departments    []Department    `json:"departments"`
	MemberBindings []MemberBinding `json:"memberbindings"`
	GroupIds       []int64         `json:"group_ids"`
	CreatedTime    int64           `json:"created_time"`
	UpdatedTime    int64           `json:"updated_time"`
}

type SpaceListResponse struct {
	Count  int64   `json:"count"`
	Spaces []Space `json:"spaces"`
}

const (
	SPACE_STATUS_ACTIVE   = 0
	SPACE_STATUS_ARCHIVED = 1
)

const (
	SPACE_KIND_REGULAR          = SpaceKindRegular
	SPACE_KIND_PERSONAL_COMPANY = SpaceKindPersonalCompany
)

const (
	SPACE_VISIBILITY_PUBLIC  = 1 // 非空间成员也可以搜索到本空间，并主动申请加入
	SPACE_VISIBILITY_PRIVATE = 0 // 仅空间成员才可以搜索到本空间，只有获得链接的成员才能申请加入
)

const (
	SPACE_ROLE_MEMBER = 0
	SPACE_ROLE_ADMIN  = 1
	SPACE_ROLE_OWNER  = 2
)

// Save 创建空间
func (space *Space) Save() error {
	if space.Name == "" {
		return errors.New("space name is required")
	}
	if space.SpaceKind == "" {
		space.SpaceKind = SPACE_KIND_REGULAR
	}

	// 检查同一企业下空间名称是否重复
	existingSpace, err := GetSpaceByName(space.Eid, space.Name)
	if err == nil && existingSpace != nil {
		return errors.New("space name already exists")
	}

	result := DB.Create(space)
	if result.Error != nil {
		return result.Error
	}
	return nil
}

// SaveWithTx 使用传入事务创建空间（避免全局 DB 依赖）
func (space *Space) SaveWithTx(tx *gorm.DB) error {
	if tx == nil {
		return errors.New("nil tx")
	}
	if space.Name == "" {
		return errors.New("space name is required")
	}
	if space.SpaceKind == "" {
		space.SpaceKind = SPACE_KIND_REGULAR
	}

	var existingSpace Space
	if err := tx.Where("eid = ? AND name = ?", space.Eid, space.Name).First(&existingSpace).Error; err == nil && existingSpace.ID != 0 {
		return errors.New("space name already exists")
	}

	return tx.Create(space).Error
}

// Update 更新空间信息
func (space *Space) Update() error {
	if space.Name == "" {
		return errors.New("space name is required")
	}

	// 检查名称重复（排除自己）
	existingSpace, err := GetSpaceByName(space.Eid, space.Name)
	if err == nil && existingSpace != nil && existingSpace.ID != space.ID {
		return errors.New("space name already exists")
	}

	result := DB.Model(space).Select("*").Updates(space)
	if result.Error != nil {
		return result.Error
	}
	return nil
}

// GetSpaceByID 根据ID获取空间
func GetSpaceByID(eid int64, id int64) (*Space, error) {
	var space Space
	if err := DB.Where("eid = ? AND id = ?", eid, id).First(&space).Error; err != nil {
		return nil, err
	}
	return &space, nil
}

// GetSpaceByName 根据名称获取空间
func GetSpaceByName(eid int64, name string) (*Space, error) {
	var space Space
	if err := DB.Where("eid = ? AND name = ?", eid, name).First(&space).Error; err != nil {
		return nil, err
	}
	return &space, nil
}

// GetSpacesByIDs 根据ID列表批量获取空间
func GetSpacesByIDs(eid int64, ids []int64) ([]Space, error) {
	var spaces []Space
	if len(ids) == 0 {
		return spaces, nil
	}
	if err := DB.Where("eid = ? AND id IN ?", eid, ids).Find(&spaces).Error; err != nil {
		return nil, err
	}
	return spaces, nil
}

// GetSpacesByEid 获取企业下的所有空间
func GetSpacesByEid(eid int64, status *int) ([]Space, error) {
	var spaces []Space
	query := DB.Where("eid = ?", eid).Where("space_kind = ? OR space_kind = ?", SPACE_KIND_REGULAR, "")

	if status != nil {
		query = query.Where("status = ?", *status)
	}

	if err := query.Order("sort asc, created_time desc").Find(&spaces).Error; err != nil {
		return nil, err
	}
	return spaces, nil
}

// LoadOwnerInfo 加载空间所有者信息
func (s *Space) LoadOwnerInfo(eid int64) error {
	var user User
	if err := DB.Where("eid = ? AND user_id = ?", eid, s.OwnerID).First(&user).Error; err != nil {
		return err
	}
	s.OwnerInfo = SpaceOwnerInfo{
		UserID:         user.UserID,
		Username:       user.Username,
		Nickname:       user.Nickname,
		Avatar:         user.Avatar,
		Mobile:         user.Mobile,
		Email:          user.Email,
		Eid:            user.Eid,
		Role:           user.Role,
		GroupId:        user.GroupId,
		Status:         user.Status,
		ExpiredTime:    user.ExpiredTime,
		LastLoginTime:  user.LastLoginTime,
		RelatedId:      user.RelatedId,
		Type:           user.Type,
		AddAdminTime:   user.AddAdminTime,
		OpenID:         user.OpenID,
		UnionID:        user.UnionID,
		Departments:    user.Departments,
		MemberBindings: user.MemberBindings,
		GroupIds:       user.GroupIds,
		CreatedTime:    user.CreatedTime,
		UpdatedTime:    user.UpdatedTime,
	}
	return nil
}

// LoadLibraryCount 加载空间知识库数量
func (s *Space) LoadLibraryCount(eid int64) error {
	var count int64
	if err := DB.Model(&Library{}).Where("eid = ? AND space_id = ?", eid, s.ID).Count(&count).Error; err != nil {
		return err
	}
	s.LibraryCount = count
	return nil
}

// DeleteSpace 删除空间
func DeleteSpace(eid int64, id int64) error {
	// 检查空间是否存在
	space, err := GetSpaceByID(eid, id)
	if err != nil {
		return err
	}

	// 检查空间下是否有知识库
	libraries, err := GetLibrariesBySpaceID(eid, space.ID)
	if err != nil {
		return err
	}
	if len(libraries) > 0 {
		return fmt.Errorf("cannot delete space with libraries")
	}

	// 开启事务
	tx := DB.Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	// 删除空间相关的所有权限记录
	if err := tx.Where("eid = ? AND resource_type = ? AND resource_id = ?",
		eid, RESOURCE_TYPE_SPACE, id).Delete(&Permission{}).Error; err != nil {
		tx.Rollback()
		return err
	}

	// 删除空间
	if err := tx.Where("eid = ? AND id = ?", eid, id).Delete(&Space{}).Error; err != nil {
		tx.Rollback()
		return err
	}

	return tx.Commit().Error
}

// BatchUpdateSpaceSort 批量更新空间排序
func BatchUpdateSpaceSort(eid int64, sortList []struct {
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
		if err := tx.Model(&Space{}).Where("eid = ? AND id = ?", eid, item.ID).Update("sort", item.Sort).Error; err != nil {
			tx.Rollback()
			return err
		}
	}

	return tx.Commit().Error
}

func GetPersonalSpaceByEid(eid int64) (*Space, error) {
	var space Space
	if err := DB.Where("eid = ? AND space_kind = ?", eid, SPACE_KIND_PERSONAL_COMPANY).First(&space).Error; err != nil {
		return nil, err
	}
	return &space, nil
}

func (s *Space) IsPersonalSpace() bool {
	return s != nil && s.SpaceKind == SPACE_KIND_PERSONAL_COMPANY
}

func InitializeSpaces(enterprise *Enterprise, adminUser *User, tx *gorm.DB) error {
	// 创建默认空间
	defaultSpace := &Space{
		Eid:         enterprise.Eid,
		Name:        "全员空间",
		Description: "系统创建的默认空间",
		Icon:        "/api/images/space/icon.png",
		OwnerID:     adminUser.UserID, // 设置管理员为空间所有者
		SpaceKind:   SPACE_KIND_REGULAR,
		IsDefault:   true,
		Status:      SPACE_STATUS_ACTIVE,
		Sort:        100,
		Visibility:  SPACE_VISIBILITY_PUBLIC,
	}
	if err := tx.Create(defaultSpace).Error; err != nil {
		return err
	}

	// 为管理员创建可管理权限
	adminPermission := &Permission{
		Eid:          enterprise.Eid,
		ResourceType: RESOURCE_TYPE_SPACE,
		ResourceID:   defaultSpace.ID,
		SubjectType:  SUBJECT_TYPE_USER,
		SubjectID:    adminUser.UserID,
		Permission:   PERMISSION_MANAGE,
	}
	if err := tx.Create(adminPermission).Error; err != nil {
		return err
	}

	// 为全公司创建可查看权限
	companyPermission := &Permission{
		Eid:          enterprise.Eid,
		ResourceType: RESOURCE_TYPE_SPACE,
		ResourceID:   defaultSpace.ID,
		SubjectType:  SUBJECT_TYPE_COMPANY_ALL,
		SubjectID:    0,
		Permission:   PERMISSION_VIEW_ONLY,
	}
	if err := tx.Create(companyPermission).Error; err != nil {
		return err
	}

	// 创建默认知识库
	defaultLibrary := &Library{
		Eid:         enterprise.Eid,
		SpaceID:     defaultSpace.ID,
		Description: "系统创建的默认知识库",
		Icon:        "/api/images/library/icon.png",
		Name:        "企业知识库",
		Status:      LIBRARY_STATUS_ACTIVE,
		Sort:        0,
	}

	// 使用 Library 的 SaveWithTx，避免修改全局 DB，确保并发安全
	if err := defaultLibrary.SaveWithTx(tx); err != nil {
		return err
	}

	defaultFileName := "53AI KM 知识管理方法论与实践.md"
	// 创建默认文件
	defaultFile := &File{
		Eid:       enterprise.Eid,
		LibraryID: defaultLibrary.ID,
		Path:      fmt.Sprintf("/%s", defaultFileName),
		Type:      FILE_TYPE_FILE,
	}
	if err := tx.Create(defaultFile).Error; err != nil {
		return err
	}

	// 从在线地址获取默认文档内容
	// 如果在线获取失败,使用本地备份文件
	var content []byte
	var err error

	// 从配置文件读取默认文档的在线地址
	defaultDocURL := config.DEFAULT_DOC_URL

	// 尝试从在线地址获取
	content, err = fetchContentFromURL(defaultDocURL)
	if err != nil {
		// 如果在线获取失败,尝试从本地文件读取作为备份
		content, err = os.ReadFile("config/default/" + defaultFileName)
		if err != nil {
			// 如果本地文件也不存在,使用空内容
			content = []byte("# 欢迎使用 53AI KM 知识管理系统\n\n这是您的第一个文档。")
		}
	}

	// 创建默认文件内容
	defaultFileBody := &FileBody{
		FileID:    defaultFile.ID,
		LibraryID: defaultFile.LibraryID,
		Eid:       defaultFile.Eid,
		Content:   string(content),
	}
	if err := tx.Create(defaultFileBody).Error; err != nil {
		return err
	}

	// 异步处理自动分块（在事务提交后）
	go func() {
		// 调用自动分块处理
		if autoChunkingCallback != nil {
			autoChunkingCallback(enterprise.Eid, defaultFile.ID, adminUser.UserID, string(content), nil)
		}
	}()

	return nil
}

func GetSpaceListWithIDs(eid int64, name string, status int, resourceIDs any, offset, limit int) (int64, []Space, error) {
	var spaces []Space
	var count int64

	query := DB.Model(&Space{}).Where("eid = ?", eid).Where("space_kind = ? OR space_kind = ?", SPACE_KIND_REGULAR, "")
	// 并且判断 resourceIDs 不为 nil 且是 slice int64
	if resourceIDs != nil && reflect.TypeOf(resourceIDs).Kind() == reflect.Slice {
		query = query.Where("id IN ?", resourceIDs)
	}

	if name != "" {
		query = query.Where("name LIKE ?", "%"+name+"%")
	}
	if status >= 0 {
		query = query.Where("status = ?", status)
	}

	err := query.Count(&count).Error
	if err != nil {
		return 0, nil, err
	}

	err = query.Offset(offset).Limit(limit).Find(&spaces).Error
	return count, spaces, err
}
