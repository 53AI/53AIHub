package model

import "errors"

// FileBodyVersion 文件版本表
type FileBodyVersion struct {
	ID         int64  `json:"id" gorm:"primaryKey;autoIncrement"`
	FileBodyID int64  `json:"file_body_id" gorm:"not null;index;comment:'关联的file_bodies表ID'"`
	FileID     int64  `json:"file_id" gorm:"not null;index;comment:'关联的文件ID'"`
	Version    string `json:"version" gorm:"type:varchar(255);not null;comment:'版本名称'"`
	BaseModel

	// 关联字段，用于 Preload (GORM 会自动识别 FileBodyID 为外键)
	FileBody *FileBody `json:"file_body,omitempty"`
}

// TableName 设置表名
func (FileBodyVersion) TableName() string {
	return "file_body_versions"
}

// Save 保存版本
func (fbv *FileBodyVersion) Save() error {
	if fbv.Version == "" {
		return errors.New("版本名称不能为空")
	}

	// 如果没有设置 FileID，从 FileBody 中获取
	if fbv.FileID == 0 && fbv.FileBodyID != 0 {
		var fileBody FileBody
		if err := DB.Where("id = ?", fbv.FileBodyID).First(&fileBody).Error; err == nil {
			fbv.FileID = fileBody.FileID
		}
	}

	// 检查同一个文件是否已存在相同版本名
	var existingVersion FileBodyVersion
	if err := DB.Where("file_id = ? AND version = ?", fbv.FileID, fbv.Version).First(&existingVersion).Error; err == nil {
		return errors.New("该版本名称已存在")
	}

	result := DB.Create(fbv)
	if result.Error != nil {
		return result.Error
	}
	return nil
}

// Update 更新版本信息
func (fbv *FileBodyVersion) Update() error {
	if fbv.Version == "" {
		return errors.New("版本名称不能为空")
	}

	// 检查同一个文件是否已存在相同版本名（排除自己）
	var existingVersion FileBodyVersion
	if err := DB.Where("file_id = ? AND version = ? AND id != ?", fbv.FileID, fbv.Version, fbv.ID).First(&existingVersion).Error; err == nil {
		return errors.New("该版本名称已存在")
	}

	result := DB.Model(fbv).Updates(fbv)
	if result.Error != nil {
		return result.Error
	}
	return nil
}

// Delete 删除版本
func (fbv *FileBodyVersion) Delete() error {
	result := DB.Delete(fbv)
	if result.Error != nil {
		return result.Error
	}
	return nil
}

// GetFileBodyVersionByID 根据ID获取版本
func GetFileBodyVersionByID(id int64) (*FileBodyVersion, error) {
	var version FileBodyVersion
	if err := DB.Where("id = ?", id).First(&version).Error; err != nil {
		return nil, err
	}
	return &version, nil
}

// GetFileBodyVersionByFileBodyID 获取指定文件历史的版本
func GetFileBodyVersionByFileBodyID(fileBodyID int64) (*FileBodyVersion, error) {
	var version *FileBodyVersion
	if err := DB.Where("file_body_id = ?", fileBodyID).Order("created_time desc").Find(&version).Error; err != nil {
		return nil, err
	}
	return version, nil
}

// GetFileBodyVersionsWithContent 获取版本列表并关联文件内容
func GetFileBodyVersionsWithContent(fileBodyID int64, offsetParams OffsetParams) ([]*FileBodyVersion, int64, error) {
	var versions []*FileBodyVersion
	var total int64

	// 获取总数
	if err := DB.Model(&FileBodyVersion{}).Where("file_body_id = ?", fileBodyID).Count(&total).Error; err != nil {
		return nil, 0, err
	}

	// 获取版本列表
	if err := DB.Where("file_body_id = ?", fileBodyID).
		Offset(offsetParams.Offset).Limit(offsetParams.Limit).
		Order("created_time desc").Find(&versions).Error; err != nil {
		return nil, 0, err
	}

	return versions, total, nil
}

// HasPublishedVersions 检查文件是否有发布版本
func HasPublishedVersions(fileID int64) (bool, error) {
	var count int64

	// 查询该文件的所有file_body记录
	var fileBodyIDs []int64
	if err := DB.Model(&FileBody{}).Where("file_id = ?", fileID).Pluck("id", &fileBodyIDs).Error; err != nil {
		return false, err
	}

	if len(fileBodyIDs) == 0 {
		return false, nil
	}

	// 检查这些file_body是否有版本记录
	if err := DB.Model(&FileBodyVersion{}).Where("file_body_id IN ?", fileBodyIDs).Count(&count).Error; err != nil {
		return false, err
	}

	return count > 0, nil
}

// GetFileBodyListWithVersionFilter 获取文件列表，支持版本筛选
// hasVersions: nil-返回所有文件, true-只返回有版本的文件, false-只返回无版本的文件
func GetFileBodyListWithVersionFilter(eid int64, fileID int64, hasVersions *bool, offsetParams OffsetParams) ([]*FileBody, int64, error) {
	query := DB.Where("eid = ? AND file_id = ?", eid, fileID)

	// 默认不区分是否有版本，只有明确传递参数时才进行筛选
	if hasVersions != nil {
		if *hasVersions {
			// 只返回有版本的文件
			var fileBodyIDsWithVersions []int64
			if err := DB.Model(&FileBodyVersion{}).Distinct("file_body_id").Pluck("file_body_id", &fileBodyIDsWithVersions).Error; err != nil {
				return nil, 0, err
			}
			if len(fileBodyIDsWithVersions) > 0 {
				query = query.Where("id IN ?", fileBodyIDsWithVersions)
			} else {
				// 没有任何版本记录，返回空结果
				return []*FileBody{}, 0, nil
			}
		} else {
			// 只返回没有版本的文件
			var fileBodyIDsWithVersions []int64
			if err := DB.Model(&FileBodyVersion{}).Distinct("file_body_id").Pluck("file_body_id", &fileBodyIDsWithVersions).Error; err != nil {
				return nil, 0, err
			}
			if len(fileBodyIDsWithVersions) > 0 {
				query = query.Where("id NOT IN ?", fileBodyIDsWithVersions)
			}
		}
	}

	// 获取总数
	var total int64
	if err := query.Model(&FileBody{}).Count(&total).Error; err != nil {
		return nil, 0, err
	}

	// 获取列表，使用 Preload 预加载版本信息
	var fileBodies []*FileBody
	if err := query.Preload("FileBodyVersions").
		Offset(offsetParams.Offset).Limit(offsetParams.Limit).
		Order("created_time desc").Find(&fileBodies).Error; err != nil {
		return nil, 0, err
	}

	for _, fileBody := range fileBodies {
		err := fileBody.LoadUser()
		if err != nil {
			continue
		}
	}

	return fileBodies, total, nil
}

func (f *FileBody) LoadUser() error {
	user, err := GetUserByID(f.UserID)
	if err != nil {
		return errors.New("用户不存在")
	}
	f.User = user
	return nil
}

// GetFileVersionsByFileID 根据文件ID获取该文件下所有版本信息 (使用Preload优化)
func GetFileVersionsByFileID(eid int64, fileID int64, offsetParams OffsetParams) ([]*FileBodyVersion, int64, error) {
	var versions []*FileBodyVersion
	var total int64

	// 获取总数
	if err := DB.Model(&FileBodyVersion{}).Where("file_id = ?", fileID).Count(&total).Error; err != nil {
		return nil, 0, err
	}

	// 使用 Preload 预加载关联的 FileBody 数据
	if err := DB.Preload("FileBody").
		Where("file_id = ?", fileID).
		Offset(offsetParams.Offset).
		Limit(offsetParams.Limit).
		Order("created_time desc").
		Find(&versions).Error; err != nil {
		return nil, 0, err
	}

	// 转换为目标结构
	for _, version := range versions {
		err := version.FileBody.LoadUser()
		if err != nil {
			continue
		}
	}

	return versions, total, nil
}
