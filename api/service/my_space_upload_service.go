package service

import (
	"context"
	"fmt"
	"path"
	"strings"

	"github.com/53AI/53AIHub/model"
)

type MySpaceUploadService struct {
	Eid                  int64
	personalSpaceService *PersonalSpaceService
}

func NewMySpaceUploadService(eid int64) *MySpaceUploadService {
	return &MySpaceUploadService{
		Eid:                  eid,
		personalSpaceService: NewPersonalSpaceService(eid),
	}
}

func (s *MySpaceUploadService) EnsurePersonalWorkspace(ctx context.Context, userID int64) (*model.Space, *model.Library, error) {
	return s.personalSpaceService.EnsurePersonalWorkspace(ctx, userID)
}

func (s *MySpaceUploadService) GetPersonalWorkspace(ctx context.Context, userID int64) (*model.Space, *model.Library, error) {
	return s.personalSpaceService.EnsurePersonalWorkspace(ctx, userID)
}

func (s *MySpaceUploadService) ListEntries(ctx context.Context, userID int64, parentPath string, typeFilter *int, keyword string, offset, limit int) ([]model.File, int64, error) {
	library, err := s.personalSpaceService.GetExistingPersonalLibrary(ctx, userID)
	if err != nil {
		return nil, 0, err
	}
	if library == nil {
		return []model.File{}, 0, nil
	}
	parentPath = s.NormalizeParentPath(parentPath)

	if typeFilter != nil {
		if strings.TrimSpace(keyword) != "" {
			excludedOriginTypes := append([]string{model.FileOriginTypeAIGenerated}, model.RecordingOriginTypes()...)
			files, total, err := searchMySpaceFilesByKeywordExcludingOriginTypes(ctx, s.Eid, library.ID, excludedOriginTypes, keyword, typeFilter, offset, limit)
			if err != nil {
				return nil, 0, err
			}
			if err := s.fillUploadFiles(files); err != nil {
				return nil, 0, err
			}
			if err := s.fillFavoriteStatus(userID, files); err != nil {
				return nil, 0, err
			}
			return files, total, nil
		}
		return s.queryEntriesByType(userID, library.ID, parentPath, *typeFilter, offset, limit)
	}
	return nil, 0, fmt.Errorf("type filter is required")
}

func (s *MySpaceUploadService) NormalizeParentPath(parentPath string) string {
	if strings.TrimSpace(parentPath) == "" {
		return "/"
	}
	if !strings.HasPrefix(parentPath, "/") {
		parentPath = "/" + parentPath
	}
	return path.Clean(parentPath)
}

func escapeLikePattern(value string) string {
	replacer := strings.NewReplacer("!", "!!", "%", "!%", "_", "!_")
	return replacer.Replace(value)
}

func (s *MySpaceUploadService) queryEntriesByType(userID, libraryID int64, parentPath string, fileType int, offset, limit int) ([]model.File, int64, error) {
	var files []model.File
	query := model.DB.Model(&model.File{}).
		Where("eid = ? AND library_id = ? AND is_deleted = ?", s.Eid, libraryID, false).
		Where(map[string]interface{}{"type": fileType}).
		Where(model.DB.Where("origin_type = ''").Or("origin_type IS NULL").Or("origin_type NOT IN ?", append([]string{model.FileOriginTypeAIGenerated}, model.RecordingOriginTypes()...)))

	// “我上传的”只展示用户上传/手工创建的内容，AI 生成内容走专门的 AI 列表。
	query = query.Where("origin_type <> ? AND path NOT LIKE ?", model.FileOriginTypeAIGenerated, "/ai-generated%")

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

	if fileType == model.FILE_TYPE_DIR {
		query = query.Order("sort asc, created_time asc, id asc")
	} else if fileType == model.FILE_TYPE_FILE {
		query = query.Order("created_time desc, id desc")
	} else {
		return nil, 0, fmt.Errorf("invalid file type: %d", fileType)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if err := query.Offset(offset).Limit(limit).Find(&files).Error; err != nil {
		return nil, 0, err
	}

	if err := s.fillUploadFiles(files); err != nil {
		return nil, 0, err
	}
	if err := s.fillFavoriteStatus(userID, files); err != nil {
		return nil, 0, err
	}
	return files, total, nil
}

func (s *MySpaceUploadService) fillUploadFiles(files []model.File) error {
	uploadFileIDs := make([]int64, 0, len(files))
	for _, file := range files {
		if file.UploadFileID > 0 {
			uploadFileIDs = append(uploadFileIDs, file.UploadFileID)
		}
	}
	if len(uploadFileIDs) == 0 {
		return nil
	}

	var uploadFiles []model.UploadFile
	if err := model.DB.Where("id IN ?", uploadFileIDs).Find(&uploadFiles).Error; err != nil {
		return err
	}
	uploadFileMap := make(map[int64]*model.UploadFile, len(uploadFiles))
	for i := range uploadFiles {
		uploadFileMap[uploadFiles[i].ID] = &uploadFiles[i]
	}
	for i := range files {
		if files[i].UploadFileID > 0 {
			if uf, ok := uploadFileMap[files[i].UploadFileID]; ok {
				files[i].UploadFile = uf
			}
		}
	}
	return nil
}

func (s *MySpaceUploadService) fillFavoriteStatus(userID int64, files []model.File) error {
	fileIDs := make([]int64, 0, len(files))
	for _, file := range files {
		if file.ID > 0 {
			fileIDs = append(fileIDs, file.ID)
		}
	}
	if len(fileIDs) == 0 {
		return nil
	}

	favoriteMap, err := model.GetFavoriteResourceIDMap(userID, model.RESOURCE_TYPE_FILE, fileIDs)
	if err != nil {
		return err
	}
	for i := range files {
		if favoriteMap[files[i].ID] {
			files[i].IsFavorite = true
		}
	}
	return nil
}
