package service

import (
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/elasticsearch"
)

// DirectoryManager 目录管理器
type DirectoryManager struct {
	mu sync.RWMutex
}

// NewDirectoryManager 创建目录管理器
func NewDirectoryManager() *DirectoryManager {
	return &DirectoryManager{}
}

func isPersonalLibraryByID(eid, libraryID int64) (bool, error) {
	library, err := model.GetLibraryByID(eid, libraryID)
	if err != nil {
		return false, err
	}
	return library.IsPersonalLibrary(), nil
}

func fileParsingStatusByLibrary(isPersonalLibrary bool) string {
	if isPersonalLibrary {
		return model.FileParsingStatusDisabled
	}
	return model.FileParsingStatusParsing
}

// CreateDirectoryTree 在数据库中创建目录结构记录
func (dm *DirectoryManager) CreateDirectoryTree(eid, libraryID int64, structure []FileStructureItem, basePath string, userID int64, originType string, originSource string, originRefID int64) error {
	dm.mu.Lock()
	defer dm.mu.Unlock()

	// 按深度排序，确保父目录先创建
	sortedStructure := make([]FileStructureItem, len(structure))
	copy(sortedStructure, structure)
	sort.Slice(sortedStructure, func(i, j int) bool {
		return sortedStructure[i].Depth < sortedStructure[j].Depth
	})

	// 创建一个映射来存储已创建的目录路径
	createdDirs := make(map[string]bool)

	// 如果有basePath，先创建basePath目录（若已存在则跳过）
	if basePath != "" {
		if !strings.HasPrefix(basePath, "/") {
			basePath = "/" + basePath
		}

		// 递归创建basePath的所有父目录
		dm.createParentDirectories(eid, libraryID, basePath, userID, createdDirs, originType, originSource, originRefID)

		// 检查基础目录是否已存在且未被删除，已存在则标记为已创建
		if existing, err := model.GetFileByPathAndLibraryNotDeleted(eid, libraryID, basePath); err == nil && existing != nil && existing.Type == model.FILE_TYPE_DIR {
			if err := dm.backfillRecordingOriginForExistingDir(existing, originType, originSource, originRefID); err != nil {
				return fmt.Errorf("回填基础目录来源信息失败: %v", err)
			}
			createdDirs[basePath] = true
		} else {
			// 检查是否已有同名但已删除的目录，如果有则直接创建新目录而不恢复已删除的目录
			// 注意：这里我们不恢复已删除的目录，而是创建一个新目录
			baseDir := &model.File{
				Path:         basePath,
				Type:         model.FILE_TYPE_DIR,
				LibraryID:    libraryID,
				Eid:          eid,
				UploadFileID: 0,
				Sort:         0,
				UserID:       userID,
			}
			applyFileOriginMeta(baseDir, originType, originSource, originRefID)

			if err := baseDir.Save(); err != nil {
				// 如果目录已存在，忽略错误
				if existingFile, getErr := model.GetFileByPathAndLibraryNotDeleted(eid, libraryID, basePath); getErr != nil || existingFile == nil || existingFile.Type != model.FILE_TYPE_DIR {
					return fmt.Errorf("保存基础目录记录失败: %v", err)
				}
				// 目录已存在且未被删除，标记为已创建
				createdDirs[basePath] = true
			} else {
				// 同步到 Elasticsearch
				elasticsearch.SyncFileToES(baseDir, "create")
				// 为目录创建者自动分配管理权限
				fps := NewFilePermissionService(eid)
				if err := fps.AddFileCreatorPermission(baseDir.ID, userID); err != nil {
					// 权限分配失败不影响目录创建，只记录错误
				}
				createdDirs[basePath] = true
			}
		}
	}

	for _, item := range sortedStructure {
		if item.IsDirectory {
			// 构建完整路径（包含basePath）
			fullPath := dm.GetDirectoryPath(basePath, item.RelativePath)

			// 如果目录已存在且未被删除则跳过
			if existing, err := model.GetFileByPathAndLibraryNotDeleted(eid, libraryID, fullPath); err == nil && existing != nil && existing.Type == model.FILE_TYPE_DIR {
				createdDirs[fullPath] = true
				continue
			}

			// 确保父目录存在
			dm.createParentDirectories(eid, libraryID, fullPath, userID, createdDirs, originType, originSource, originRefID)

			if err := dm.createDirectoryRecord(eid, libraryID, item, basePath, userID, createdDirs, originType, originSource, originRefID); err != nil {
				return fmt.Errorf("创建目录记录 %s 失败: %v", item.RelativePath, err)
			}
			createdDirs[fullPath] = true
		}
	}

	return nil
}

// createParentDirectories 递归创建父目录
func (dm *DirectoryManager) createParentDirectories(eid, libraryID int64, path string, userID int64, createdDirs map[string]bool, originType string, originSource string, originRefID int64) {
	// 获取父目录路径
	parentPath := filepath.Dir(path)

	// 如果已经是根目录或已创建，则返回
	if parentPath == "/" || parentPath == "." || createdDirs[parentPath] {
		return
	}

	// 递归创建更上层的目录
	dm.createParentDirectories(eid, libraryID, parentPath, userID, createdDirs, originType, originSource, originRefID)

	// 检查当前父目录是否已存在且未被删除
	if existing, err := model.GetFileByPathAndLibraryNotDeleted(eid, libraryID, parentPath); err == nil && existing != nil && existing.Type == model.FILE_TYPE_DIR {
		// 父目录已存在且未被删除，标记为已创建，不需要重复创建
		if err := dm.backfillRecordingOriginForExistingDir(existing, originType, originSource, originRefID); err != nil {
			fmt.Printf("回填父目录来源信息失败 %s: %v\n", parentPath, err)
		}
		createdDirs[parentPath] = true
		return
	}

	// 不再尝试恢复已删除的父目录，直接创建新目录
	// 注意：即使有已删除的同名目录，我们也创建一个新目录而不恢复已删除的目录
	dir := &model.File{
		Path:         parentPath,
		Type:         model.FILE_TYPE_DIR,
		LibraryID:    libraryID,
		Eid:          eid,
		UploadFileID: 0,
		Sort:         0,
		UserID:       userID, // 设置父目录创建人
	}
	applyFileOriginMeta(dir, originType, originSource, originRefID)

	if err := dir.Save(); err != nil {
		// 检查目录是否已存在
		existingFile, getErr := model.GetFileByPathAndLibraryNotDeleted(eid, libraryID, parentPath)
		if getErr != nil || existingFile == nil || existingFile.Type != model.FILE_TYPE_DIR {
			// 真正的错误，记录日志
			fmt.Printf("创建父目录失败 %s: %v\n", parentPath, err)
		}
		// 目录已存在且未被删除，不记录错误日志，直接标记为已创建
		createdDirs[parentPath] = true
		return
	}

	// 同步到 Elasticsearch
	elasticsearch.SyncFileToES(dir, "create")

	// 为父目录创建者自动分配管理权限
	fps := NewFilePermissionService(eid)
	if err := fps.AddFileCreatorPermission(dir.ID, userID); err != nil {
		// 权限分配失败不影响目录创建，只记录错误
		// 这里可以考虑添加日志记录
	}

	createdDirs[parentPath] = true
}

// createDirectoryRecord 在数据库中创建目录记录
func (dm *DirectoryManager) createDirectoryRecord(eid, libraryID int64, item FileStructureItem, basePath string, userID int64, createdDirs map[string]bool, originType string, originSource string, originRefID int64) error {
	// 使用basePath和relativePath组合完整路径
	dirPath := dm.GetDirectoryPath(basePath, item.RelativePath)

	// 检查目录是否已存在
	existingFile, err := model.GetFileByPathAndLibraryNotDeleted(eid, libraryID, dirPath)
	if err == nil && existingFile != nil && existingFile.Type == model.FILE_TYPE_DIR {
		// 目录已存在且未被删除，跳过创建，不返回错误
		if err := dm.backfillRecordingOriginForExistingDir(existingFile, originType, originSource, originRefID); err != nil {
			return fmt.Errorf("回填目录来源信息失败: %v", err)
		}
		return nil
	}

	// 尝试恢复已删除的目录
	if deletedFile, getErr := model.GetFileByPathAndLibraryWithDeleted(eid, libraryID, dirPath); getErr == nil && deletedFile != nil && deletedFile.Type == model.FILE_TYPE_DIR && deletedFile.IsDeleted {
		// 不再自动恢复已删除的目录，而是创建一个新的同名目录
		// 恢复已删除目录应该通过专门的API接口操作，而不是在上传文件时自动触发
		// if restoreErr := model.RestoreFile(eid, deletedFile.ID); restoreErr != nil {
		// 	return fmt.Errorf("恢复已删除目录失败: %v", restoreErr)
		// }

		// 创建新的同名目录，而不是恢复已删除的目录
		file := &model.File{
			Path:         dirPath,
			Type:         model.FILE_TYPE_DIR, // 目录类型
			LibraryID:    libraryID,
			Eid:          eid,
			UploadFileID: 0, // 目录不关联实际文件
			Sort:         0,
			UserID:       userID, // 设置目录创建人
		}
		applyFileOriginMeta(file, originType, originSource, originRefID)

		if err := file.Save(); err != nil {
			return fmt.Errorf("保存目录记录失败: %v", err)
		}

		// 同步到 Elasticsearch
		elasticsearch.SyncFileToES(file, "create")

		// 为目录创建者自动分配管理权限
		fps := NewFilePermissionService(eid)
		if err := fps.AddFileCreatorPermission(file.ID, userID); err != nil {
			// 权限分配失败不影响目录创建，只记录错误
			// 这里可以考虑添加日志记录
		}
		return nil
	}

	// 创建目录记录
	file := &model.File{
		Path:         dirPath,
		Type:         model.FILE_TYPE_DIR, // 目录类型
		LibraryID:    libraryID,
		Eid:          eid,
		UploadFileID: 0, // 目录不关联实际文件
		Sort:         0,
		UserID:       userID, // 设置目录创建人
	}
	applyFileOriginMeta(file, originType, originSource, originRefID)

	if err := file.Save(); err != nil {
		return fmt.Errorf("保存目录记录失败: %v", err)
	}

	// 同步到 Elasticsearch
	elasticsearch.SyncFileToES(file, "create")

	// 为目录创建者自动分配管理权限
	fps := NewFilePermissionService(eid)
	if err := fps.AddFileCreatorPermission(file.ID, userID); err != nil {
		// 权限分配失败不影响目录创建，只记录错误
		// 这里可以考虑添加日志记录
	}

	return nil
}

// CreateFileRecord 在数据库中创建文件记录
func (dm *DirectoryManager) CreateFileRecord(eid, libraryID int64, relativePath string, uploadFileID int64, basePath string, userID int64, duplicateMode DuplicateMode, isPersonalLibrary bool, originType string, originSource string, originRefID int64) (int64, error) {
	dm.mu.Lock()
	defer dm.mu.Unlock()

	filePath := dm.GetDirectoryPath(basePath, relativePath)

	if shouldAppendMarkdownSuffix() && filepath.Ext(filePath) != ".md" {
		filePath += ".md"
	}

	var finalPath string
	existingFile, _ := model.GetFileByPathAndLibraryNotDeleted(eid, libraryID, filePath)

	if existingFile != nil && duplicateMode == DuplicateModeReplace {
		cleanupSvc := NewCleanupService(model.DB)
		if err := cleanupSvc.CleanupFileRelatedData(eid, existingFile.ID); err != nil {
			return 0, fmt.Errorf("清理原文件相关数据失败: %v", err)
		}
		existingFile.UploadFileID = uploadFileID
		existingFile.UserID = userID
		applyFileOriginMeta(existingFile, originType, originSource, originRefID)
		if !existingFile.IsRecordingOriginType() {
			existingFile.SetPersonalUploadOrigin(uploadFileID)
		}
		existingFile.ConversionStatus = model.FileConversionStatusNormal
		existingFile.ParsingStatus = fileParsingStatusByLibrary(isPersonalLibrary)
		if err := existingFile.Update(); err != nil {
			return 0, fmt.Errorf("更新文件记录失败: %v", err)
		}
		elasticsearch.SyncFileToES(existingFile, "update")
		return existingFile.ID, nil
	}

	finalPath, err := dm.generateUniqueFileName(eid, libraryID, filePath)
	if err != nil {
		return 0, fmt.Errorf("生成唯一文件名失败: %v", err)
	}

	file := &model.File{
		Path:             finalPath,
		Type:             model.FILE_TYPE_FILE,
		LibraryID:        libraryID,
		Eid:              eid,
		UploadFileID:     uploadFileID,
		Sort:             0,
		ConversionStatus: model.FileConversionStatusNormal,
		ParsingStatus:    fileParsingStatusByLibrary(isPersonalLibrary),
		UserID:           userID,
	}
	applyFileOriginMeta(file, originType, originSource, originRefID)
	if !file.IsRecordingOriginType() {
		file.SetPersonalUploadOrigin(uploadFileID)
	}

	if err := file.Save(); err != nil {
		return 0, fmt.Errorf("保存文件记录失败: %v", err)
	}

	elasticsearch.SyncFileToES(file, "create")

	fps := NewFilePermissionService(eid)
	fps.AddFileCreatorPermission(file.ID, userID)

	return file.ID, nil
}

// ValidateDirectoryStructure 验证目录结构
func (dm *DirectoryManager) ValidateDirectoryStructure(structure []FileStructureItem) error {
	if len(structure) == 0 {
		return fmt.Errorf("目录结构不能为空")
	}

	// 验证路径格式
	for _, item := range structure {
		if err := dm.validatePath(item.RelativePath, item.IsDirectory); err != nil {
			return fmt.Errorf("路径验证失败 %s: %v", item.RelativePath, err)
		}

		// 验证深度
		if item.Depth < 0 || item.Depth > 10 {
			return fmt.Errorf("目录深度超出限制: %s (深度: %d)", item.RelativePath, item.Depth)
		}
	}

	// 验证父子关系
	if err := dm.validateParentChildRelations(structure); err != nil {
		return err
	}

	return nil
}

// validatePath 验证路径格式
func (dm *DirectoryManager) validatePath(path string, isDirectory bool) error {
	if path == "" {
		return fmt.Errorf("路径不能为空")
	}

	// 清理路径
	cleanPath := filepath.Clean(path)
	if cleanPath == "." || cleanPath == ".." {
		return fmt.Errorf("无效的路径: %s", path)
	}

	// 检查是否包含非法字符
	if strings.Contains(path, "..") {
		return fmt.Errorf("路径不能包含 '..'")
	}

	// 对于文件，检查是否有扩展名
	if !isDirectory {
		ext := filepath.Ext(path)
		if ext == "" {
			return fmt.Errorf("文件路径必须包含扩展名: %s", path)
		}
	}

	return nil
}

// validateParentChildRelations 验证父子关系
func (dm *DirectoryManager) validateParentChildRelations(structure []FileStructureItem) error {
	// 创建路径映射
	pathMap := make(map[string]FileStructureItem)
	for _, item := range structure {
		pathMap[item.RelativePath] = item
	}

	// 验证每个项目的父路径是否存在
	for _, item := range structure {
		if item.ParentPath != "" {
			parent, exists := pathMap[item.ParentPath]
			if !exists {
				return fmt.Errorf("父路径不存在: %s (子项: %s)", item.ParentPath, item.RelativePath)
			}
			if !parent.IsDirectory {
				return fmt.Errorf("父路径不是目录: %s (子项: %s)", item.ParentPath, item.RelativePath)
			}
		}
	}

	return nil
}

// GetDirectoryPath 获取目录路径
func (dm *DirectoryManager) GetDirectoryPath(basePath, relativePath string) string {
	if basePath == "" {
		return "/" + strings.TrimPrefix(relativePath, "/")
	}

	// 确保basePath以/开头
	if !strings.HasPrefix(basePath, "/") {
		basePath = "/" + basePath
	}

	// 组合路径
	fullPath := filepath.Join(basePath, relativePath)

	// 确保路径以/开头
	if !strings.HasPrefix(fullPath, "/") {
		fullPath = "/" + fullPath
	}

	return filepath.Clean(fullPath)
}

func applyFileOriginMeta(file *model.File, originType string, originSource string, originRefID int64) {
	if file == nil {
		return
	}
	originType = strings.TrimSpace(originType)
	originSource = strings.TrimSpace(originSource)
	switch originType {
	case model.FileOriginTypeRecordingAudio:
		file.SetRecordingAudioOrigin(originRefID)
	case model.FileOriginTypeRecordingFolder:
		file.SetRecordingFolderOrigin(originRefID)
	case model.FileOriginTypeRecordingImported:
		file.SetRecordingImportedOrigin(originRefID)
	case "":
		// keep existing defaults
	default:
		file.OriginType = originType
		file.OriginRefID = originRefID
		file.OriginSource = originSource
	}
}

func (dm *DirectoryManager) backfillRecordingOriginForExistingDir(existing *model.File, originType string, originSource string, originRefID int64) error {
	if existing == nil || existing.Type != model.FILE_TYPE_DIR {
		return nil
	}
	originType = strings.TrimSpace(originType)
	if originType == "" {
		return nil
	}
	if existing.OriginType == originType &&
		strings.TrimSpace(existing.OriginSource) == strings.TrimSpace(originSource) &&
		existing.OriginRefID == originRefID {
		return nil
	}

	updated := *existing
	applyFileOriginMeta(&updated, originType, originSource, originRefID)
	if err := model.DB.Model(existing).Updates(map[string]interface{}{
		"origin_type":   updated.OriginType,
		"origin_source": updated.OriginSource,
		"origin_ref_id": updated.OriginRefID,
	}).Error; err != nil {
		return err
	}
	existing.OriginType = updated.OriginType
	existing.OriginSource = updated.OriginSource
	existing.OriginRefID = updated.OriginRefID
	return nil
}

func shouldAppendMarkdownSuffix() bool {
	return true
}

// CheckDirectoryExists 检查目录是否存在
func (dm *DirectoryManager) CheckDirectoryExists(eid, libraryID int64, dirPath string) (bool, error) {
	// 确保路径以 / 开头
	if !strings.HasPrefix(dirPath, "/") {
		dirPath = "/" + dirPath
	}

	file, err := model.GetFileByPathAndLibrary(eid, libraryID, dirPath)
	if err != nil {
		// 如果是记录不存在的错误，返回false
		if strings.Contains(err.Error(), "record not found") {
			return false, nil
		}
		return false, err
	}

	// 检查是否为目录类型
	return file.Type == model.FILE_TYPE_DIR, nil
}

// ListDirectoryContents 列出目录内容
func (dm *DirectoryManager) ListDirectoryContents(eid, libraryID int64, dirPath string) ([]model.File, error) {
	// 确保路径以 / 开头
	if !strings.HasPrefix(dirPath, "/") {
		dirPath = "/" + dirPath
	}

	// 获取目录下的所有文件和子目录
	files, err := model.GetFilesByParentPathAndLibrary(eid, libraryID, dirPath, "asc")
	if err != nil {
		return nil, fmt.Errorf("获取目录内容失败: %v", err)
	}

	return files, nil
}

// DeleteDirectory 删除目录（仅当目录为空时）
func (dm *DirectoryManager) DeleteDirectory(eid, libraryID int64, dirPath string) error {
	dm.mu.Lock()
	defer dm.mu.Unlock()

	// 确保路径以 / 开头
	if !strings.HasPrefix(dirPath, "/") {
		dirPath = "/" + dirPath
	}

	// 检查目录是否存在
	file, err := model.GetFileByPathAndLibraryNotDeleted(eid, libraryID, dirPath)
	if err != nil {
		return fmt.Errorf("目录不存在: %s", dirPath)
	}

	if file.Type != model.FILE_TYPE_DIR {
		return fmt.Errorf("路径不是目录: %s", dirPath)
	}

	// 检查目录是否为空
	contents, err := dm.ListDirectoryContents(eid, libraryID, dirPath)
	if err != nil {
		return fmt.Errorf("检查目录内容失败: %v", err)
	}

	if len(contents) > 0 {
		return fmt.Errorf("目录不为空，无法删除: %s", dirPath)
	}

	// 删除目录记录
	return model.DeleteFile(eid, file.ID)
}

// parseFileNameAndExtensions 解析文件名和扩展名，支持多重扩展名
// 例如： "1721205308914.pdf.md" -> baseName: "1721205308914", extensions: ".pdf.md"
func (dm *DirectoryManager) parseFileNameAndExtensions(filename string) (baseName, extensions string) {
	// 找到第一个扩展名的位置
	firstDotIndex := strings.Index(filename, ".")
	if firstDotIndex == -1 {
		// 没有扩展名
		return filename, ""
	}

	// 分割文件名和扩展名
	baseName = filename[:firstDotIndex]
	extensions = filename[firstDotIndex:]
	return baseName, extensions
}

// generateUniqueFileName 生成唯一文件名，类似浏览器的下载文件重命名逻辑、类似 windows 的回收站
// 修改：将序号插入到倒数第二个字符位置，如 "1721205308914.pdf.md" -> "1721205308914（1）.pdf.md"
func (dm *DirectoryManager) generateUniqueFileName(eid, libraryID int64, originalPath string) (string, error) {
	// 检查原始路径是否已存在
	existingFile, err := model.GetFileByPathAndLibraryNotDeleted(eid, libraryID, originalPath)
	if err != nil || existingFile == nil {
		// 文件不存在，可以使用原始路径
		return originalPath, nil
	}

	// 如果文件已被删除，也可以使用原始路径
	// if existingFile.IsDeleted {
	// 	return originalPath, nil
	// }

	// 文件已存在，开始生成重命名
	dir := filepath.Dir(originalPath)
	filename := filepath.Base(originalPath)

	// 解析文件名和扩展名（支持多重扩展名）
	baseName, extensions := dm.parseFileNameAndExtensions(filename)

	// 从（1）开始尝试
	for i := 1; i <= 1000; i++ { // 设置上限避免无限循环
		// 将序号插入到baseName和extensions之间
		newName := fmt.Sprintf("%s（%d）%s", baseName, i, extensions)
		newPath := filepath.Join(dir, newName)

		// 确保路径以 / 开头
		if !strings.HasPrefix(newPath, "/") {
			newPath = "/" + newPath
		}

		// 检查新路径是否已存在
		existingFile, err := model.GetFileByPathAndLibrary(eid, libraryID, newPath)
		if err != nil && existingFile == nil {
			// 找到可用路径
			return newPath, nil
		}
	}

	return "", fmt.Errorf("无法生成唯一文件名，已尝试1000次")
}
