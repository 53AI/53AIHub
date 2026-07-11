package service

import (
	"fmt"
	"path/filepath"
	"strings"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
)

// UserRecentUsedItem 最近使用记录返回项
// @Description 最近使用记录
type UserRecentUsedItem struct {
	ID           int64  `json:"id" example:"1"`                                          // 记录ID
	ResourceType int    `json:"resource_type" example:"0" enums:"0,1,2"`                 // 资源类型：0=空间, 1=知识库, 2=文件
	ResourceID   int64  `json:"resource_id" example:"474"`                               // 资源ID（自动编码为 hashID）
	Name         string `json:"name" example:"全员空间"`                                     // 资源名称
	Icon         string `json:"icon,omitempty" example:"/api/images/space/icon.png"`     // 图标（空间/知识库）
	Path         string `json:"path,omitempty" example:"/测试1"`                            // 文件路径（仅文件）
	FileType     string `json:"file_type,omitempty" example:"md"`                        // 文件扩展名（仅文件）
	IsDir        bool   `json:"is_dir" example:"false"`                                // 是否文件夹（仅文件）
	LibraryID    int64  `json:"library_id,omitempty" example:"507"`                      // 所属知识库ID（仅文件）
	LibraryName  string `json:"library_name,omitempty" example:"企业知识库"`                  // 所属知识库名称（仅文件）
	SpaceName    string `json:"space_name,omitempty" example:"全员空间"`                     // 所属空间名称（知识库/文件）
	UpdatedTime  int64  `json:"updated_time" example:"1780905385314"`                    // 更新时间戳（毫秒）
}

// ListUserRecentUsed 获取用户最近使用列表（合并空间/知识库/文件详情）
func ListUserRecentUsed(eid, userID int64) ([]UserRecentUsedItem, error) {
	records, err := model.ListUserRecentUsed(eid, userID)
	if err != nil {
		return nil, fmt.Errorf("查询最近使用记录失败: %v", err)
	}
	if len(records) == 0 {
		return []UserRecentUsedItem{}, nil
	}

	// 按类型分组收集 ID
	var spaceIDs, libIDs, fileIDs []int64
	for _, r := range records {
		switch r.ResourceType {
		case model.RESOURCE_TYPE_SPACE:
			spaceIDs = append(spaceIDs, r.ResourceID)
		case model.RESOURCE_TYPE_LIBRARY:
			libIDs = append(libIDs, r.ResourceID)
		case model.RESOURCE_TYPE_FILE:
			fileIDs = append(fileIDs, r.ResourceID)
		}
	}

	// 批量查询详情
	spaceMap := fetchSpacesMap(eid, spaceIDs)
	libMap := fetchLibrariesMap(eid, libIDs)
	fileMap := fetchFilesMap(eid, fileIDs)

	// 额外查询：知识库→空间名、文件→知识库名、文件所属知识库→空间名
	libSpaceNameMap := buildLibrarySpaceNameMap(libMap, spaceMap)
	fileLibNameMap := buildFileLibraryNameMap(eid, fileMap)
	fileLibSpaceNameMap := buildFileLibrarySpaceNameMap(eid, fileMap, spaceMap)

	// 组装结果（保持 records 的排序）
	result := make([]UserRecentUsedItem, 0, len(records))
	for _, r := range records {
		item := UserRecentUsedItem{
			ID:           r.ID,
			ResourceType: r.ResourceType,
			ResourceID:   r.ResourceID,
			UpdatedTime:  r.UpdatedTime,
		}

		switch r.ResourceType {
		case model.RESOURCE_TYPE_SPACE:
			if s, ok := spaceMap[r.ResourceID]; ok {
				item.Name = s.Name
				item.Icon = s.Icon
			} else {
				continue // 资源已删除，跳过
			}
		case model.RESOURCE_TYPE_LIBRARY:
			if l, ok := libMap[r.ResourceID]; ok && l.Status == model.LIBRARY_STATUS_ACTIVE {
				item.Name = l.Name
				item.Icon = l.Icon
				item.SpaceName = libSpaceNameMap[l.ID]
			} else {
				continue // 资源已删除或不活跃，跳过
			}
		case model.RESOURCE_TYPE_FILE:
			if f, ok := fileMap[r.ResourceID]; ok && !f.IsDeleted {
				item.Name = strings.TrimPrefix(f.Path, "/")
				item.Path = f.Path
				item.FileType = strings.TrimPrefix(filepath.Ext(f.Path), ".")
				item.IsDir = f.Type == model.FILE_TYPE_DIR
				item.LibraryID = f.LibraryID
				item.LibraryName = fileLibNameMap[f.LibraryID]
				item.SpaceName = fileLibSpaceNameMap[f.LibraryID]
			} else {
				continue
			}
		}
		result = append(result, item)
	}
	return result, nil
}

// RecentUsedSaveItem 最近使用保存项
type RecentUsedSaveItem struct {
	ResourceType *int  `json:"resource_type"`
	ResourceID   int64 `json:"resource_id"`
}

// SaveUserRecentUsed 保存最近使用记录
func SaveUserRecentUsed(eid, userID int64, resourceType int, resourceID int64) error {
	return model.SaveUserRecentUsed(eid, userID, resourceType, resourceID)
}

// BatchSaveUserRecentUsed 批量保存最近使用记录
func BatchSaveUserRecentUsed(eid, userID int64, records []RecentUsedSaveItem) error {
	for _, r := range records {
		if r.ResourceType == nil {
			continue
		}
		if err := model.SaveUserRecentUsed(eid, userID, *r.ResourceType, r.ResourceID); err != nil {
			return err
		}
	}
	return nil
}

// BatchDeleteUserRecentUsed 批量删除（ids 为空时删除全部）
func BatchDeleteUserRecentUsed(eid, userID int64, ids []int64) error {
	if len(ids) == 0 {
		return model.DeleteAllUserRecentUsed(eid, userID)
	}
	return model.BatchDeleteUserRecentUsed(eid, userID, ids)
}

// --- helper: 批量查询详情 ---

func fetchSpacesMap(eid int64, ids []int64) map[int64]*model.Space {
	if len(ids) == 0 {
		return nil
	}
	spaces, err := model.GetSpacesByIDs(eid, ids)
	if err != nil {
		logger.Warnf(nil, "批量查询空间失败: %v", err)
		return nil
	}
	m := make(map[int64]*model.Space, len(spaces))
	for i := range spaces {
		m[spaces[i].ID] = &spaces[i]
	}
	return m
}

func fetchLibrariesMap(eid int64, ids []int64) map[int64]*model.Library {
	if len(ids) == 0 {
		return nil
	}
	libraries, err := model.GetLibrariesByIDs(eid, ids)
	if err != nil {
		logger.Warnf(nil, "批量查询知识库失败: %v", err)
		return nil
	}
	m := make(map[int64]*model.Library, len(libraries))
	for i := range libraries {
		m[libraries[i].ID] = &libraries[i]
	}
	return m
}

func fetchFilesMap(eid int64, ids []int64) map[int64]*model.File {
	if len(ids) == 0 {
		return nil
	}
	var files []model.File
	if err := model.DB.Where("eid = ? AND id IN ?", eid, ids).Find(&files).Error; err != nil {
		logger.Warnf(nil, "批量查询文件失败: %v", err)
		return nil
	}
	m := make(map[int64]*model.File, len(files))
	for i := range files {
		m[files[i].ID] = &files[i]
	}
	return m
}

// buildLibrarySpaceNameMap 构建知识库ID→空间名称的映射
func buildLibrarySpaceNameMap(libMap map[int64]*model.Library, spaceMap map[int64]*model.Space) map[int64]string {
	m := make(map[int64]string, len(libMap))
	for _, lib := range libMap {
		if s, ok := spaceMap[lib.SpaceID]; ok {
			m[lib.ID] = s.Name
		}
	}
	return m
}

// buildFileLibraryNameMap 构建文件所属知识库ID→知识库名称的映射
func buildFileLibraryNameMap(eid int64, fileMap map[int64]*model.File) map[int64]string {
	// 收集所有唯一的 LibraryID
	libIDs := make([]int64, 0, len(fileMap))
	seen := make(map[int64]struct{})
	for _, f := range fileMap {
		if f.LibraryID <= 0 {
			continue
		}
		if _, ok := seen[f.LibraryID]; ok {
			continue
		}
		seen[f.LibraryID] = struct{}{}
		libIDs = append(libIDs, f.LibraryID)
	}
	if len(libIDs) == 0 {
		return nil
	}

	libraries, err := model.GetLibrariesByIDs(eid, libIDs)
	if err != nil {
		logger.Warnf(nil, "批量查询知识库名称失败: %v", err)
		return nil
	}
	m := make(map[int64]string, len(libraries))
	for i := range libraries {
		m[libraries[i].ID] = libraries[i].Name
	}
	return m
}

// buildFileLibrarySpaceNameMap 构建文件所属知识库ID→空间名称的映射
func buildFileLibrarySpaceNameMap(eid int64, fileMap map[int64]*model.File, spaceMap map[int64]*model.Space) map[int64]string {
	// 收集所有唯一的 LibraryID
	libIDs := make([]int64, 0, len(fileMap))
	seen := make(map[int64]struct{})
	for _, f := range fileMap {
		if f.LibraryID <= 0 {
			continue
		}
		if _, ok := seen[f.LibraryID]; ok {
			continue
		}
		seen[f.LibraryID] = struct{}{}
		libIDs = append(libIDs, f.LibraryID)
	}
	if len(libIDs) == 0 {
		return nil
	}

	libraries, err := model.GetLibrariesByIDs(eid, libIDs)
	if err != nil {
		logger.Warnf(nil, "批量查询知识库空间名失败: %v", err)
		return nil
	}
	m := make(map[int64]string, len(libraries))
	for i := range libraries {
		if s, ok := spaceMap[libraries[i].SpaceID]; ok {
			m[libraries[i].ID] = s.Name
		}
	}
	return m
}
