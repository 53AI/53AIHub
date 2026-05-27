package model

import (
	"errors"

	"github.com/53AI/53AIHub/common/logger"
)

// MigrateToSpaceLibraryStructure 迁移现有数据到空间-知识库结构
func MigrateToSpaceLibraryStructure() error {
	logger.SysLog("Starting migration to space-library structure...")

	// 检查是否已经迁移过
	var count int64
	if err := DB.Model(&Space{}).Count(&count).Error; err != nil {
		return err
	}

	if count > 0 {
		logger.SysLog("Migration already completed, skipping...")
		return nil
	}

	// 获取所有企业
	var enterprises []Enterprise
	if err := DB.Find(&enterprises).Error; err != nil {
		return err
	}

	for _, enterprise := range enterprises {
		if err := migrateEnterpriseData(enterprise); err != nil {
			logger.SysLogf("Failed to migrate enterprise %d: %v", enterprise.Eid, err)
			return err
		}
	}

	logger.SysLog("Migration to space-library structure completed successfully")
	return nil
}

// migrateEnterpriseData 迁移单个企业的数据
func migrateEnterpriseData(enterprise Enterprise) error {
	logger.SysLogf("Migrating enterprise %d: %s", enterprise.Eid, enterprise.DisplayName)

	// 开启事务
	tx := DB.Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	// 获取企业的第一个管理员用户作为默认空间的Owner
	var adminUser User
	if err := tx.Where("eid = ? AND role >= ?", enterprise.Eid, 10).First(&adminUser).Error; err != nil {
		// 如果没有管理员，获取第一个用户
		if err := tx.Where("eid = ?", enterprise.Eid).First(&adminUser).Error; err != nil {
			// 如果没有用户，创建一个系统用户
			adminUser = User{
				Username: "system",
				Email:    "system@" + enterprise.Domain,
				Eid:      enterprise.Eid,
				Role:     100, // 系统管理员
			}
			if err := tx.Create(&adminUser).Error; err != nil {
				tx.Rollback()
				return err
			}
		}
	}

	// 1. 创建默认空间
	defaultSpace := &Space{
		Name:        "默认空间",
		Description: "企业的默认工作空间",
		Eid:         enterprise.Eid,
		OwnerID:     adminUser.UserID,
		Status:      SPACE_STATUS_ACTIVE,
		Sort:        0,
	}

	if err := tx.Create(defaultSpace).Error; err != nil {
		tx.Rollback()
		return err
	}

	// 3. 创建默认知识库
	defaultLibrary := &Library{
		Name:        "默认知识库",
		Description: "空间的默认知识库",
		SpaceID:     defaultSpace.ID,
		Eid:         enterprise.Eid,
		CreatorID:   adminUser.UserID,
		Status:      LIBRARY_STATUS_ACTIVE,
		Sort:        0,
	}

	// 使用Library的Save方法确保UUID正确生成
	originalDB := DB
	DB = tx // 临时将全局DB设置为当前事务
	err := defaultLibrary.Save()
	DB = originalDB // 恢复全局DB
	if err != nil {
		tx.Rollback()
		return err
	}

	// 5. 更新现有文件，关联到默认知识库
	if err := tx.Model(&File{}).Where("eid = ?", enterprise.Eid).Update("library_id", defaultLibrary.ID).Error; err != nil {
		tx.Rollback()
		return err
	}

	// 6. 更新现有文件内容，关联到默认知识库
	if err := tx.Model(&FileBody{}).Where("eid = ?", enterprise.Eid).Update("library_id", defaultLibrary.ID).Error; err != nil {
		tx.Rollback()
		return err
	}

	// 7. 将企业的所有用户添加到默认空间
	var users []User
	if err := tx.Where("eid = ?", enterprise.Eid).Find(&users).Error; err != nil {
		tx.Rollback()
		return err
	}

	for _, user := range users {
		if user.UserID == adminUser.UserID {
			continue // 跳过已经添加的Owner
		}
	}

	return tx.Commit().Error
}

// CheckMigrationNeeded 检查是否需要迁移
func CheckMigrationNeeded() (bool, error) {
	var spaceCount int64
	if err := DB.Model(&Space{}).Count(&spaceCount).Error; err != nil {
		return false, err
	}

	var fileCount int64
	if err := DB.Model(&File{}).Count(&fileCount).Error; err != nil {
		return false, err
	}

	// 如果有文件但没有空间，说明需要迁移
	return fileCount > 0 && spaceCount == 0, nil
}

// CreateDefaultSpaceAndLibrary 为企业创建默认空间和知识库
func CreateDefaultSpaceAndLibrary(eid int64, ownerID int64) (*Space, *Library, error) {
	// 检查是否已存在默认空间
	var existingSpace Space
	if err := DB.Where("eid = ? AND name = ?", eid, "默认空间").First(&existingSpace).Error; err == nil {
		return nil, nil, errors.New("default space already exists")
	}

	// 开启事务
	tx := DB.Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	// 创建默认空间
	defaultSpace := &Space{
		Name:        "默认空间",
		Description: "企业的默认工作空间",
		Eid:         eid,
		OwnerID:     ownerID,
		SpaceKind:   SPACE_KIND_REGULAR,
		Status:      SPACE_STATUS_ACTIVE,
		Sort:        0,
	}

	if err := tx.Create(defaultSpace).Error; err != nil {
		tx.Rollback()
		return nil, nil, err
	}

	// 创建默认知识库
	defaultLibrary := &Library{
		Name:        "默认知识库",
		Description: "空间的默认知识库",
		SpaceID:     defaultSpace.ID,
		Eid:         eid,
		CreatorID:   ownerID,
		LibraryKind: LIBRARY_KIND_REGULAR,
		Status:      LIBRARY_STATUS_ACTIVE,
		Sort:        0,
	}

	// 使用Library的Save方法确保UUID正确生成
	originalDB := DB
	DB = tx // 临时将全局DB设置为当前事务
	err := defaultLibrary.Save()
	DB = originalDB // 恢复全局DB
	if err != nil {
		tx.Rollback()
		return nil, nil, err
	}

	if err := tx.Commit().Error; err != nil {
		return nil, nil, err
	}

	return defaultSpace, defaultLibrary, nil
}

// AddUserIDToFileTable 为file表添加user_id字段
func AddUserIDToFileTable() error {
	logger.SysLog("Starting migration to add user_id column to file table...")

	// 检查是否已经添加过user_id字段
	var columnExists bool
	err := DB.Raw(`
		SELECT COUNT(*) > 0
		FROM information_schema.columns
		WHERE table_name = 'files'
		AND column_name = 'user_id'
	`).Scan(&columnExists).Error

	if err != nil {
		return err
	}

	if columnExists {
		logger.SysLog("user_id column already exists in file table, skipping...")
		return nil
	}

	// 添加user_id字段
	err = DB.Exec("ALTER TABLE files ADD COLUMN user_id BIGINT NOT NULL DEFAULT 0 COMMENT '文件创建人ID'").Error
	if err != nil {
		return err
	}

	// 创建索引
	err = DB.Exec("CREATE INDEX idx_files_user_id ON files (user_id)").Error
	if err != nil {
		return err
	}

	logger.SysLog("user_id column added to file table successfully")
	return nil
}
