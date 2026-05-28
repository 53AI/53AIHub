package service

import (
	"context"
	"fmt"
	"path"
	"sort"
	"strings"

	"github.com/53AI/53AIHub/model"
)

type MySpaceAIService struct {
	Eid                  int64
	personalSpaceService *PersonalSpaceService
}

func NewMySpaceAIService(eid int64) *MySpaceAIService {
	return &MySpaceAIService{
		Eid:                  eid,
		personalSpaceService: NewPersonalSpaceService(eid),
	}
}

func (s *MySpaceAIService) EnsurePersonalWorkspace(ctx context.Context, userID int64) (*model.Space, *model.Library, error) {
	return s.personalSpaceService.EnsurePersonalWorkspace(ctx, userID)
}

func (s *MySpaceAIService) GetPersonalWorkspace(ctx context.Context, userID int64) (*model.Space, *model.Library, error) {
	return s.personalSpaceService.EnsurePersonalWorkspace(ctx, userID)
}

func (s *MySpaceAIService) ListEntries(ctx context.Context, userID int64, keyword string, offset, limit int) ([]model.File, int64, error) {
	library, err := s.personalSpaceService.GetExistingPersonalLibrary(ctx, userID)
	if err != nil {
		return nil, 0, err
	}
	if library == nil {
		return []model.File{}, 0, nil
	}

	fileType := model.FILE_TYPE_FILE
	if strings.TrimSpace(keyword) != "" {
		files, total, err := searchMySpaceFilesByKeyword(ctx, s.Eid, library.ID, model.FileOriginTypeAIGenerated, keyword, &fileType, offset, limit)
		if err != nil {
			return nil, 0, err
		}
		if err := model.AttachUploadFiles(files); err != nil {
			return nil, 0, err
		}
		uploadSvc := NewMySpaceUploadService(s.Eid)
		if err := uploadSvc.fillFavoriteStatus(userID, files); err != nil {
			return nil, 0, err
		}
		return files, total, nil
	}

	files, total, err := model.SearchFilesByLibraryKeyword(s.Eid, library.ID, keyword, &fileType, []string{model.FileOriginTypeAIGenerated}, offset, limit)
	if err != nil {
		return nil, 0, err
	}

	if err := model.AttachUploadFiles(files); err != nil {
		return nil, 0, err
	}
	uploadSvc := NewMySpaceUploadService(s.Eid)
	if err := uploadSvc.fillFavoriteStatus(userID, files); err != nil {
		return nil, 0, err
	}
	return files, total, nil
}

func (s *MySpaceAIService) ListEntriesByPath(ctx context.Context, userID int64, parentPath string, typeFilter *int, keyword string, offset, limit int) ([]model.File, int64, error) {
	library, err := s.personalSpaceService.GetExistingPersonalLibrary(ctx, userID)
	if err != nil {
		return nil, 0, err
	}
	if library == nil {
		return []model.File{}, 0, nil
	}

	parentPath = normalizeAIGeneratedSessionFolderPath(parentPath)
	if parentPath == "" {
		parentPath = "/ai-generated"
	}

	files, total, err := s.listEntriesByPath(ctx, library.ID, parentPath, typeFilter, keyword, offset, limit)
	if err != nil {
		return nil, 0, err
	}
	if err := model.AttachUploadFiles(files); err != nil {
		return nil, 0, err
	}
	uploadSvc := NewMySpaceUploadService(s.Eid)
	if err := uploadSvc.fillFavoriteStatus(userID, files); err != nil {
		return nil, 0, err
	}
	return files, total, nil
}

func (s *MySpaceAIService) listEntriesByPath(_ context.Context, libraryID int64, parentPath string, typeFilter *int, keyword string, offset, limit int) ([]model.File, int64, error) {
	actualEntries, err := s.listAIGeneratedDirectChildren(libraryID, parentPath, typeFilter, keyword)
	if err != nil {
		return nil, 0, err
	}

	entriesByPath := make(map[string]model.File, len(actualEntries))
	for _, entry := range actualEntries {
		if entry.Path == "" {
			continue
		}
		entriesByPath[entry.Path] = entry
	}

	// 当用户明确按目录类型搜索时，关键词只应该筛目录本身，不应把命中的文件反推成父目录。
	// 当用户明确按文件类型搜索时，关键词应该直接命中文件本身，而不是把它折叠回目录层。
	if typeFilter != nil && *typeFilter == model.FILE_TYPE_FILE && strings.TrimSpace(keyword) != "" {
		legacyFiles, err := s.listAIGeneratedDescendantFiles(libraryID, parentPath, keyword)
		if err != nil {
			return nil, 0, err
		}
		for _, legacyFile := range legacyFiles {
			if legacyFile.Type != model.FILE_TYPE_FILE {
				continue
			}
			entriesByPath[legacyFile.Path] = legacyFile
		}
	} else if typeFilter == nil || *typeFilter != model.FILE_TYPE_DIR {
		legacyFiles, err := s.listAIGeneratedDescendantFiles(libraryID, parentPath, keyword)
		if err != nil {
			return nil, 0, err
		}

		for _, legacyFile := range legacyFiles {
			childPath, childType := directAIGeneratedChildPath(parentPath, legacyFile.Path)
			if childPath == "" {
				continue
			}

			if childType == model.FILE_TYPE_DIR {
				if typeFilter != nil && *typeFilter == model.FILE_TYPE_FILE {
					continue
				}
				if _, exists := entriesByPath[childPath]; !exists {
					entriesByPath[childPath] = model.File{
						Path:         childPath,
						Type:         model.FILE_TYPE_DIR,
						LibraryID:    libraryID,
						Eid:          s.Eid,
						OriginType:   model.FileOriginTypeAIGenerated,
						OriginSource: model.FileOriginSourceAI,
					}
				}
				continue
			}

			if typeFilter != nil && *typeFilter == model.FILE_TYPE_DIR {
				continue
			}
			if _, exists := entriesByPath[childPath]; !exists {
				entriesByPath[childPath] = legacyFile
			}
		}
	}

	entries := make([]model.File, 0, len(entriesByPath))
	for _, entry := range entriesByPath {
		entries = append(entries, entry)
	}

	switch {
	case typeFilter == nil:
		sort.Slice(entries, func(i, j int) bool {
			if entries[i].Type != entries[j].Type {
				return entries[i].Type < entries[j].Type
			}
			if entries[i].Sort != entries[j].Sort {
				return entries[i].Sort < entries[j].Sort
			}
			if entries[i].CreatedTime != entries[j].CreatedTime {
				return entries[i].CreatedTime > entries[j].CreatedTime
			}
			return entries[i].Path < entries[j].Path
		})
	case *typeFilter == model.FILE_TYPE_DIR:
		sort.Slice(entries, func(i, j int) bool {
			if entries[i].Sort != entries[j].Sort {
				return entries[i].Sort < entries[j].Sort
			}
			if entries[i].CreatedTime != entries[j].CreatedTime {
				return entries[i].CreatedTime > entries[j].CreatedTime
			}
			return entries[i].Path < entries[j].Path
		})
	case *typeFilter == model.FILE_TYPE_FILE:
		sort.Slice(entries, func(i, j int) bool {
			if entries[i].CreatedTime != entries[j].CreatedTime {
				return entries[i].CreatedTime > entries[j].CreatedTime
			}
			if entries[i].ID != entries[j].ID {
				return entries[i].ID > entries[j].ID
			}
			return entries[i].Path < entries[j].Path
		})
	default:
		return nil, 0, fmt.Errorf("invalid file type: %d", *typeFilter)
	}

	total := int64(len(entries))
	if offset < 0 {
		offset = 0
	}
	if limit <= 0 {
		limit = len(entries)
	}
	if offset >= len(entries) {
		return []model.File{}, total, nil
	}
	end := offset + limit
	if end > len(entries) {
		end = len(entries)
	}
	return entries[offset:end], total, nil
}

func (s *MySpaceAIService) listAIGeneratedDirectChildren(libraryID int64, parentPath string, typeFilter *int, keyword string) ([]model.File, error) {
	var files []model.File
	query := model.DB.Model(&model.File{}).
		Where("eid = ? AND library_id = ? AND is_deleted = ?", s.Eid, libraryID, false)

	if typeFilter != nil {
		query = query.Where(map[string]interface{}{"type": *typeFilter})
	}

	escapedParentPath := escapeLikePattern(parentPath)
	if parentPath == "/" {
		query = query.Where("path LIKE ? ESCAPE '!' AND path NOT LIKE ? ESCAPE '!'", "/%", "/%/%")
	} else {
		query = query.Where(
			"path LIKE ? ESCAPE '!' AND path NOT LIKE ? ESCAPE '!'",
			escapedParentPath+"/%",
			escapedParentPath+"/%/%",
		)
	}

	keyword = strings.TrimSpace(keyword)
	if keyword != "" {
		query = query.Where("path LIKE ? ESCAPE '!'", "%"+escapeLikePattern(keyword)+"%")
	}

	if err := query.Find(&files).Error; err != nil {
		return nil, err
	}
	return files, nil
}

func (s *MySpaceAIService) listAIGeneratedDescendantFiles(libraryID int64, parentPath string, keyword string) ([]model.File, error) {
	var files []model.File
	prefix := strings.TrimRight(parentPath, "/")
	if prefix == "" {
		prefix = "/ai-generated"
	}
	escapedPrefix := escapeLikePattern(prefix)

	query := model.DB.Model(&model.File{}).
		Where("eid = ? AND library_id = ? AND is_deleted = ? AND origin_type = ? AND type = ?", s.Eid, libraryID, false, model.FileOriginTypeAIGenerated, model.FILE_TYPE_FILE).
		Where("path LIKE ? ESCAPE '!'", escapedPrefix+"/%")

	keyword = strings.TrimSpace(keyword)
	if keyword != "" {
		query = query.Where("path LIKE ? ESCAPE '!'", "%"+escapeLikePattern(keyword)+"%")
	}

	if err := query.Find(&files).Error; err != nil {
		return nil, err
	}
	return files, nil
}

func directAIGeneratedChildPath(parentPath, filePath string) (string, int) {
	prefix := strings.TrimRight(parentPath, "/")
	if prefix == "" {
		prefix = "/ai-generated"
	}
	fullPrefix := prefix + "/"
	if !strings.HasPrefix(filePath, fullPrefix) {
		return "", -1
	}

	remainder := strings.TrimPrefix(filePath, fullPrefix)
	if remainder == "" {
		return "", -1
	}

	segments := strings.Split(remainder, "/")
	if len(segments) == 1 {
		return filePath, model.FILE_TYPE_FILE
	}
	return path.Join(prefix, segments[0]), model.FILE_TYPE_DIR
}
