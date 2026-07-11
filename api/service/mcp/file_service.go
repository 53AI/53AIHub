package mcp

import (
	"context"
	"errors"
	"path/filepath"
	"strings"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/storage"
	"github.com/53AI/53AIHub/model"
	core "github.com/53AI/53AIHub/service"
	"github.com/53AI/53AIHub/service/document"
	"github.com/53AI/53AIHub/service/elasticsearch"
	"github.com/53AI/53AIHub/service/rag"
	"gorm.io/gorm"
)

type FileService struct{}

type FileDetailResult struct {
	File     *model.File     `json:"file"`
	FileBody *model.FileBody `json:"file_body,omitempty"`
	Content  string          `json:"content,omitempty"`
	Markdown string          `json:"markdown,omitempty"`
}

var RenameFileAsyncEntityExtraction = func(eid, fileID int64) {
	extractor := rag.NewEntityExtractionService(model.DB)
	if err := extractor.ExtractAndStoreForFileMeta(context.Background(), eid, fileID); err != nil {
		// ignore background error
	}
}

type FileCreateResult struct {
	File     *model.File     `json:"file"`
	FileBody *model.FileBody `json:"file_body,omitempty"`
}

func NewFileService() *FileService {
	return &FileService{}
}

func (s *FileService) DeleteFile(ctx context.Context, eid, userID int64, fileID int64) (*model.File, error) {
	file, err := model.GetFileByID(eid, fileID)
	if err != nil {
		return nil, err
	}

	permission, err := core.GetUserPermission(eid, model.RESOURCE_TYPE_FILE, fileID, userID)
	if err != nil || permission < model.PERMISSION_MANAGE {
		if err != nil {
			return nil, err
		}
		return nil, errors.New("无权删除此文件")
	}

	common.SetFileStop(file.ID)

	if err := model.SoftDeleteFile(eid, fileID, userID); err != nil {
		return nil, err
	}

	go func() {
		if file.Type == model.FILE_TYPE_DIR {
			children, err := model.GetChildrenByPathPrefix(eid, file.Path)
			if err != nil {
				return
			}
			for _, child := range children {
				if child.Type == model.FILE_TYPE_FILE {
					common.SetFileStop(child.ID)
					elasticsearch.SyncFileToES(&child, "delete")
				}
			}
			return
		}
		elasticsearch.SyncFileToES(file, "delete")
	}()

	return file, nil
}

func (s *FileService) CreateFileOrFolder(ctx context.Context, eid, userID int64, libraryID int64, filePath string, fileType int, content string) (*FileCreateResult, error) {
	if libraryID <= 0 {
		return nil, errors.New("知识库ID不能为空")
	}
	if strings.TrimSpace(filePath) == "" {
		return nil, errors.New("文件路径不能为空")
	}
	if fileType != model.FILE_TYPE_DIR && fileType != model.FILE_TYPE_FILE {
		return nil, errors.New("文件类型错误")
	}

	normalizedPath := strings.TrimSpace(filePath)
	if !strings.HasPrefix(normalizedPath, "/") {
		normalizedPath = "/" + normalizedPath
	}

	if fileType == model.FILE_TYPE_FILE {
		if strings.TrimSpace(content) == "" {
			return nil, errors.New("创建文件内容不能为空")
		}
		ext := strings.ToLower(filepath.Ext(normalizedPath))
		if ext == "" {
			normalizedPath += ".md"
		} else if ext != ".md" {
			return nil, errors.New("文件必须为 md 格式")
		}
	}

	fps := core.NewFilePermissionService(eid)
	if err := fps.CheckParentPermission(userID, normalizedPath, libraryID); err != nil {
		return nil, err
	}

	if existingFile, _ := model.GetFileByPathAndLibraryNotDeleted(eid, libraryID, normalizedPath); existingFile != nil {
		return nil, errors.New("目标路径已存在")
	}

	file := &model.File{
		Eid:              eid,
		LibraryID:        libraryID,
		Path:             normalizedPath,
		Type:             fileType,
		UserID:           userID,
		ConversionStatus: model.FileConversionStatusNormal,
		ParsingStatus:    model.FileParsingStatusNormal,
	}
	if err := file.Save(); err != nil {
		return nil, err
	}

	if err := fps.AddFileCreatorPermission(file.ID, userID); err != nil {
		return nil, err
	}

	result := &FileCreateResult{File: file}
	if fileType == model.FILE_TYPE_FILE {
		fileBody, err := s.CreateFileBody(ctx, eid, userID, file.ID, content)
		if err != nil {
			return nil, err
		}
		result.FileBody = fileBody
	}

	elasticsearch.SyncFileToES(file, "create")
	return result, nil
}

func (s *FileService) ListFilesByLibraryAndPath(ctx context.Context, eid, userID int64, libraryID int64, parentPath string, recursive bool, sort string) ([]model.File, error) {
	permission, err := core.GetUserPermission(eid, model.RESOURCE_TYPE_LIBRARY, libraryID, userID)
	if err != nil || permission < model.PERMISSION_VIEW_ONLY {
		if err != nil {
			return nil, err
		}
		return nil, errors.New("无权访问此知识库")
	}

	if parentPath == "" {
		parentPath = "/"
	}

	if recursive {
		files, err := model.GetAllFilesByLibrary(eid, libraryID, "", sort, nil, nil)
		if err != nil {
			return nil, err
		}
		filtered := make([]model.File, 0, len(files))
		for _, file := range files {
			if parentPath == "/" || strings.HasPrefix(file.Path, strings.TrimRight(parentPath, "/")+"/") || file.Path == parentPath {
				filtered = append(filtered, file)
			}
		}
		return filtered, nil
	}

	return model.GetFilesByParentPathAndLibrary(eid, libraryID, parentPath, sort)
}

func (s *FileService) GetFileDetailWithBody(ctx context.Context, eid, userID int64, fileID int64) (*FileDetailResult, error) {
	permission, err := core.GetUserPermission(eid, model.RESOURCE_TYPE_FILE, fileID, userID)
	if err != nil || permission < model.PERMISSION_VIEW_ONLY {
		if err != nil {
			return nil, err
		}
		return nil, errors.New("无权访问此文件")
	}

	file, err := model.GetFileByID(eid, fileID)
	if err != nil {
		return nil, err
	}

	var body *model.FileBody
	if latest, err := model.GetLastFileBodyByFileID(eid, fileID); err == nil && latest != nil {
		if err := latest.LoadContent(); err != nil {
			return nil, err
		}
		body = latest
	}

	result := &FileDetailResult{
		File: file,
	}
	if body != nil {
		result.FileBody = body
		result.Content = body.Content
		result.Markdown = body.Content
	}
	return result, nil
}

func (s *FileService) RenameFileOrDirectory(ctx context.Context, eid, userID int64, fileID int64, newPath string) (*model.File, error) {
	if newPath == "" {
		return nil, errors.New("新路径不能为空")
	}
	if newPath == "/" {
		return nil, errors.New("新路径不能根目录")
	}

	file, err := model.GetFileByID(eid, fileID)
	if err != nil {
		return nil, err
	}

	permission, err := core.GetUserPermission(eid, model.RESOURCE_TYPE_FILE, fileID, userID)
	if err != nil || permission < model.PERMISSION_EDIT_KNOWLEDGE {
		if err != nil {
			return nil, err
		}
		return nil, errors.New("无权修改此文件")
	}

	if !strings.HasPrefix(newPath, "/") {
		newPath = "/" + newPath
	}

	if existingFile, _ := model.GetFileByPathAndLibraryNotDeleted(eid, file.LibraryID, newPath); existingFile != nil && existingFile.ID != file.ID {
		return nil, errors.New("目标路径已存在")
	}

	oldPath := file.Path
	tx := model.DB.Begin()
	if tx.Error != nil {
		return nil, tx.Error
	}
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
			panic(r)
		}
	}()

	if file.Type == model.FILE_TYPE_DIR {
		children, err := model.GetChildrenByPathPrefix(eid, oldPath)
		if err != nil {
			tx.Rollback()
			return nil, err
		}
		for _, child := range children {
			newChildPath := strings.Replace(child.Path, oldPath, newPath, 1)
			if err := tx.Model(&model.File{}).Where("eid = ? AND id = ?", eid, child.ID).Updates(&model.File{Path: newChildPath}).Error; err != nil {
				tx.Rollback()
				return nil, err
			}
		}
	}

	file.Path = newPath
	if err := tx.Model(&model.File{}).Where("eid = ? AND id = ?", eid, file.ID).Updates(file).Error; err != nil {
		tx.Rollback()
		return nil, err
	}
	if err := tx.Commit().Error; err != nil {
		return nil, err
	}

	elasticsearch.SyncFileToES(file, "update")
	asyncExtraction := RenameFileAsyncEntityExtraction
	go func() {
		asyncExtraction(eid, file.ID)
	}()

	return file, nil
}

func (s *FileService) UpdateFileContentReplace(ctx context.Context, eid, userID int64, fileID int64, content string) (*model.FileBody, error) {
	return s.ReplaceFileBody(ctx, eid, userID, fileID, content)
}

func (s *FileService) UpdateFileContentAppend(ctx context.Context, eid, userID int64, fileID int64, content string) (*model.FileBody, error) {
	return s.AppendFileBody(ctx, eid, userID, fileID, content)
}

func (s *FileService) ReplaceFileBody(ctx context.Context, eid, userID int64, fileID int64, content string) (*model.FileBody, error) {
	file, err := model.GetFileByID(eid, fileID)
	if err != nil {
		return nil, err
	}
	if err := s.ensureFileEditPermission(eid, userID, fileID); err != nil {
		return nil, err
	}
	return s.saveNewFileBody(ctx, file, userID, content)
}

func (s *FileService) AppendFileBody(ctx context.Context, eid, userID int64, fileID int64, content string) (*model.FileBody, error) {
	if err := s.ensureFileEditPermission(eid, userID, fileID); err != nil {
		return nil, err
	}

	fileBody, err := model.GetLastFileBodyByFileID(eid, fileID)
	if err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
	}
	if fileBody == nil {
		file, fileErr := model.GetFileByID(eid, fileID)
		if fileErr != nil {
			return nil, fileErr
		}
		return s.saveNewFileBody(ctx, file, userID, content)
	}

	if err := fileBody.LoadContent(); err != nil {
		return nil, err
	}
	fileBody.UserID = userID
	if err := fileBody.AppendContent(content); err != nil {
		return nil, err
	}
	return fileBody, nil
}

func (s *FileService) CreateFileBody(ctx context.Context, eid, userID int64, fileID int64, content string) (*model.FileBody, error) {
	file, err := model.GetFileByID(eid, fileID)
	if err != nil {
		return nil, err
	}
	if err := s.ensureFileEditPermission(eid, userID, fileID); err != nil {
		return nil, err
	}

	normalizedContent, err := s.normalizeCreateFileBodyContent(file.Path, content)
	if err != nil {
		return nil, err
	}
	if err := s.syncUploadContentForCreate(file, content); err != nil {
		return nil, err
	}
	return s.saveNewFileBody(ctx, file, userID, normalizedContent)
}

func (s *FileService) UpdateRawFileContent(ctx context.Context, eid, userID int64, fileID int64, content string) (*model.FileBody, error) {
	file, err := model.GetFileByID(eid, fileID)
	if err != nil {
		return nil, err
	}
	if err := s.ensureFileEditPermission(eid, userID, fileID); err != nil {
		return nil, err
	}

	normalizedContent, err := s.normalizeRawFileContent(file.Path, content)
	if err != nil {
		return nil, err
	}
	if err := s.syncUploadContentForRaw(file, content); err != nil {
		return nil, err
	}
	return s.saveNewFileBody(ctx, file, userID, normalizedContent)
}

func (s *FileService) ensureFileEditPermission(eid, userID, fileID int64) error {
	file, err := model.GetFileByID(eid, fileID)
	if err != nil {
		return err
	}

	library, err := model.GetLibraryByID(eid, file.LibraryID)
	if err != nil {
		return err
	}

	if library != nil && library.IsPersonalLibrary() {
		if library.CreatorID != userID {
			return errors.New("无权修改个人知识库文件")
		}
		return nil
	}

	permission, err := core.GetUserPermission(eid, model.RESOURCE_TYPE_FILE, fileID, userID)
	if err != nil || permission < model.PERMISSION_EDIT_KNOWLEDGE {
		if err != nil {
			return err
		}
		return errors.New("无权访问此文件")
	}
	return nil
}

func (s *FileService) saveNewFileBody(ctx context.Context, file *model.File, userID int64, content string) (*model.FileBody, error) {
	fileBody := model.NewFileBody(file.Eid, file.ID, file.LibraryID, userID, content)
	if err := fileBody.ReplaceContent(content); err != nil {
		return nil, err
	}
	return fileBody, nil
}

func (s *FileService) normalizeCreateFileBodyContent(filePath, content string) (string, error) {
	ext := strings.ToLower(filepath.Ext(filePath))
	if ext == ".md" {
		withoutMd := strings.TrimSuffix(filePath, ".md")
		innerExt := strings.ToLower(filepath.Ext(withoutMd))
		if innerExt != "" {
			ext = innerExt
		}
	}
	if ext == ".html" || ext == ".htm" {
		converter := document.NewConverterService()
		markdownContent, err := converter.ConvertHTMLToMarkdown(content)
		if err != nil {
			return "", err
		}
		return markdownContent, nil
	}
	return content, nil
}

func (s *FileService) normalizeRawFileContent(filePath, content string) (string, error) {
	ext := strings.ToLower(filepath.Ext(filePath))
	if ext != ".md" && ext != ".txt" && ext != ".html" && ext != ".htm" {
		return "", errors.New("不支持的文件格式")
	}
	if ext == ".html" || ext == ".htm" {
		converter := document.NewConverterService()
		markdownContent, err := converter.ConvertHTMLToMarkdown(content)
		if err != nil {
			return "", err
		}
		return markdownContent, nil
	}
	return content, nil
}

func (s *FileService) syncUploadContentForCreate(file *model.File, rawContent string) error {
	if file.UploadFileID == 0 {
		return nil
	}
	uploadFile, err := model.GetUploadFileByID(file.UploadFileID)
	if err != nil {
		return nil
	}

	uploadExt := strings.ToLower(uploadFile.Extension)
	if uploadExt != ".txt" && uploadExt != ".md" && uploadExt != ".html" && uploadExt != ".htm" {
		return nil
	}

	contentBytes := []byte(rawContent)
	if err := storage.StorageInstance.Save(contentBytes, uploadFile.Key); err != nil {
		return nil
	}

	mimeType := "text/markdown; charset=utf-8"
	switch uploadExt {
	case ".txt":
		mimeType = "text/plain; charset=utf-8"
	case ".html", ".htm":
		mimeType = "text/html; charset=utf-8"
	}
	_ = uploadFile.UpdateSizeAndMimeType(int64(len(contentBytes)), mimeType)
	return nil
}

func (s *FileService) syncUploadContentForRaw(file *model.File, rawContent string) error {
	if file.UploadFileID == 0 {
		return nil
	}
	uploadFile, err := model.GetUploadFileByID(file.UploadFileID)
	if err != nil {
		return nil
	}

	ext := strings.ToLower(filepath.Ext(file.Path))
	if ext != ".md" && ext != ".txt" && ext != ".html" && ext != ".htm" {
		return nil
	}

	contentBytes := []byte(rawContent)
	if err := storage.StorageInstance.Save(contentBytes, uploadFile.Key); err != nil {
		return nil
	}

	mimeType := "text/plain; charset=utf-8"
	if ext == ".md" {
		mimeType = "text/markdown; charset=utf-8"
	} else if ext == ".html" || ext == ".htm" {
		mimeType = "text/html; charset=utf-8"
	}
	_ = uploadFile.UpdateSizeAndMimeType(int64(len(contentBytes)), mimeType)
	return nil
}
