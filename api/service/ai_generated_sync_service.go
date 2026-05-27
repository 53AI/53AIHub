package service

import (
	"context"
	"errors"
	"fmt"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/elasticsearch"
	"gorm.io/gorm"
)

type AIGeneratedSyncService struct {
	Eid                  int64
	personalSpaceService *PersonalSpaceService
}

func NewAIGeneratedSyncService(eid int64) *AIGeneratedSyncService {
	return &AIGeneratedSyncService{
		Eid:                  eid,
		personalSpaceService: NewPersonalSpaceService(eid),
	}
}

func (s *AIGeneratedSyncService) EnsurePersonalWorkspace(ctx context.Context, userID int64) (*model.Space, *model.Library, error) {
	return s.personalSpaceService.EnsurePersonalWorkspace(ctx, userID)
}

func (s *AIGeneratedSyncService) GetPersonalWorkspace(ctx context.Context, userID int64) (*model.Space, *model.Library, error) {
	return s.personalSpaceService.EnsurePersonalWorkspace(ctx, userID)
}

func (s *AIGeneratedSyncService) SyncOutputFiles(ctx context.Context, userID int64, outputFiles []*model.UploadFile, sessionFolderPath string) ([]*model.File, error) {
	if len(outputFiles) == 0 {
		return nil, nil
	}

	_, library, err := s.personalSpaceService.EnsurePersonalWorkspace(ctx, userID)
	if err != nil {
		return nil, err
	}

	syncedFiles := make([]*model.File, 0, len(outputFiles))
	var syncErrs []error
	for _, outputFile := range outputFiles {
		if outputFile == nil || outputFile.ID <= 0 {
			continue
		}

		file, syncErr := s.syncSingleOutputFile(ctx, userID, library.ID, outputFile, sessionFolderPath)
		if syncErr != nil {
			logger.SysErrorf("【技能运行】同步AI生成文件失败: eid=%d user_id=%d message_id=%d file_name=%s err=%v",
				s.Eid, userID, outputFile.MessageID, outputFile.FileName, syncErr)
			syncErrs = append(syncErrs, syncErr)
			continue
		}
		if file != nil {
			syncedFiles = append(syncedFiles, file)
		}
	}

	if len(syncErrs) > 0 {
		return syncedFiles, errors.Join(syncErrs...)
	}
	return syncedFiles, nil
}

func (s *AIGeneratedSyncService) ensureDirectoryChain(_ context.Context, userID, libraryID int64, dirPath string) error {
	dirPath = normalizeAIGeneratedSessionFolderPath(dirPath)
	if dirPath == "" {
		return nil
	}

	cleanPath := path.Clean(dirPath)
	if cleanPath == "." || cleanPath == "/" {
		return nil
	}

	segments := strings.Split(strings.TrimPrefix(cleanPath, "/"), "/")
	current := ""
	for idx, segment := range segments {
		safeSegment := normalizeAIGeneratedSessionFolderSegment(segment)
		if safeSegment == "" {
			continue
		}
		if idx == 0 && safeSegment == "ai-generated" {
			current = "/" + safeSegment
			continue
		}
		current = path.Join(current, safeSegment)
		if !strings.HasPrefix(current, "/") {
			current = "/" + current
		}

		existing, err := model.GetFileByPathAndLibraryNotDeleted(s.Eid, libraryID, current)
		if err == nil && existing != nil {
			if existing.Type != model.FILE_TYPE_DIR {
				return fmt.Errorf("path %s already exists and is not a directory", current)
			}
			continue
		}
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}

		dir := &model.File{
			Path:         current,
			Type:         model.FILE_TYPE_DIR,
			LibraryID:    libraryID,
			Eid:          s.Eid,
			UploadFileID: 0,
			OriginType:   model.FileOriginTypeAIGenerated,
			OriginRefID:  0,
			OriginSource: model.FileOriginSourceDirect,
			Sort:         0,
			UserID:       userID,
		}
		if err := dir.Save(); err != nil {
			if existingFile, getErr := model.GetFileByPathAndLibraryNotDeleted(s.Eid, libraryID, current); getErr == nil && existingFile != nil && existingFile.Type == model.FILE_TYPE_DIR {
				continue
			}
			return err
		}
	}
	return nil
}

func (s *AIGeneratedSyncService) syncSingleOutputFile(ctx context.Context, userID, libraryID int64, outputFile *model.UploadFile, sessionFolderPath string) (*model.File, error) {
	if outputFile == nil {
		return nil, fmt.Errorf("ai upload file is required")
	}

	lockName := fmt.Sprintf("ai_generated_sync:%d:%d", s.Eid, outputFile.ID)
	if common.LOCKER != nil && !common.LOCKER.TryLock(lockName, 30*time.Second) {
		return nil, fmt.Errorf("ai generated sync lock busy: eid=%d output_file_id=%d", s.Eid, outputFile.ID)
	}
	if common.LOCKER != nil {
		defer common.LOCKER.Unlock(lockName)
	}

	return s.syncSingleOutputFileLocked(ctx, userID, libraryID, outputFile, sessionFolderPath)
}

func (s *AIGeneratedSyncService) syncSingleOutputFileLocked(ctx context.Context, userID, libraryID int64, outputFile *model.UploadFile, sessionFolderPath string) (*model.File, error) {
	filePath := s.buildAIGeneratedPath(outputFile, sessionFolderPath)
	parentPath := path.Dir(filePath)
	if parentPath != "." && parentPath != "/" {
		if err := s.ensureDirectoryChain(ctx, userID, libraryID, parentPath); err != nil {
			return nil, err
		}
	}

	var existing model.File
	err := model.DB.Where("eid = ? AND library_id = ? AND origin_type = ? AND origin_ref_id = ?",
		s.Eid, libraryID, model.FileOriginTypeAIGenerated, outputFile.ID).First(&existing).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	if existing.ID > 0 {
		changed := false
		if existing.Path != filePath {
			existing.Path = filePath
			changed = true
		}
		if existing.UploadFileID != outputFile.ID {
			existing.UploadFileID = outputFile.ID
			changed = true
		}
		if existing.Type != model.FILE_TYPE_FILE {
			existing.Type = model.FILE_TYPE_FILE
			changed = true
		}
		if existing.OriginSource != model.FileOriginSourceAI {
			existing.OriginSource = model.FileOriginSourceAI
			changed = true
		}
		if existing.UserID != userID {
			existing.UserID = userID
			changed = true
		}
		if existing.ConversionStatus != model.FileConversionStatusNormal {
			existing.ConversionStatus = model.FileConversionStatusNormal
			changed = true
		}
		if existing.ParsingStatus != model.FileParsingStatusDisabled {
			existing.ParsingStatus = model.FileParsingStatusDisabled
			changed = true
		}
		existing.OriginRefID = outputFile.ID
		existing.UploadFileID = outputFile.ID
		existing.Eid = s.Eid
		existing.LibraryID = libraryID
		existing.UploadFile = outputFile

		if changed {
			if err := existing.Update(); err != nil {
				return nil, err
			}
		}

		if err := s.ensureCreatorPermission(existing.ID, userID); err != nil {
			return nil, err
		}
		elasticsearch.SyncFileToES(&existing, "update")
		return &existing, nil
	}

	file := &model.File{
		Path:             filePath,
		Type:             model.FILE_TYPE_FILE,
		LibraryID:        libraryID,
		Eid:              s.Eid,
		UploadFileID:     outputFile.ID,
		OriginRefID:      outputFile.ID,
		OriginSource:     model.FileOriginSourceAI,
		ConversionStatus: model.FileConversionStatusNormal,
		ParsingStatus:    model.FileParsingStatusDisabled,
		UserID:           userID,
		UploadFile:       outputFile,
	}
	file.SetAIGeneratedOrigin(outputFile.ID, model.FileOriginSourceAI)

	if err := file.Save(); err != nil {
		return nil, err
	}

	if err := s.ensureCreatorPermission(file.ID, userID); err != nil {
		return nil, err
	}
	elasticsearch.SyncFileToES(file, "create")
	return file, nil
}

func (s *AIGeneratedSyncService) ensureCreatorPermission(fileID, userID int64) error {
	resourceType := model.RESOURCE_TYPE_FILE
	subjectType := model.SUBJECT_TYPE_USER

	var permission model.Permission
	err := model.DB.Where("eid = ? AND resource_type = ? AND resource_id = ? AND subject_type = ? AND subject_id = ?",
		s.Eid, resourceType, fileID, subjectType, userID).First(&permission).Error
	if err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			logger.SysErrorf("【技能运行】查询AI生成文件权限失败: eid=%d fileID=%d userID=%d err=%v", s.Eid, fileID, userID, err)
		}
		permission = model.Permission{
			Eid:          s.Eid,
			ResourceType: resourceType,
			ResourceID:   fileID,
			SubjectType:  subjectType,
			SubjectID:    userID,
			Permission:   model.PERMISSION_MANAGE,
		}
		if createErr := model.DB.Create(&permission).Error; createErr != nil {
			logger.SysErrorf("【技能运行】创建AI生成文件权限失败: eid=%d fileID=%d userID=%d err=%v", s.Eid, fileID, userID, createErr)
			return createErr
		}
		return nil
	}

	if permission.Permission == model.PERMISSION_MANAGE {
		return nil
	}

	if updateErr := model.DB.Model(&model.Permission{}).
		Where("id = ?", permission.ID).
		Update("permission", model.PERMISSION_MANAGE).Error; updateErr != nil {
		logger.SysErrorf("【技能运行】更新AI生成文件权限失败: eid=%d fileID=%d userID=%d err=%v", s.Eid, fileID, userID, updateErr)
		return updateErr
	}
	return nil
}

func (s *AIGeneratedSyncService) buildAIGeneratedPath(outputFile *model.UploadFile, sessionFolderPath string) string {
	fileName := strings.TrimSpace(outputFile.FileName)
	baseName := path.Base(filepath.ToSlash(fileName))
	if baseName == "." || baseName == "/" || baseName == "" {
		baseName = "file"
	}
	if path.Ext(baseName) != ".md" {
		baseName += ".md"
	}
	basePath := normalizeAIGeneratedSessionFolderPath(sessionFolderPath)
	if basePath == "" {
		basePath = "/ai-generated"
	}
	sessionFolderName := strings.TrimPrefix(basePath, "/")
	sessionFolderName = strings.TrimSpace(sessionFolderName)
	if sessionFolderName == "" {
		sessionFolderName = "ai-generated"
	}
	combinedSessionFolder := path.Join(path.Dir(basePath), fmt.Sprintf("%s-%d", path.Base(basePath), outputFile.MessageID))
	if combinedSessionFolder == "." || combinedSessionFolder == "/" {
		combinedSessionFolder = "/" + fmt.Sprintf("%s-%d", sessionFolderName, outputFile.MessageID)
	}
	return path.Join(combinedSessionFolder, baseName)
}

func normalizeAIGeneratedSessionFolderPath(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
	}
	if !strings.HasPrefix(trimmed, "/") {
		trimmed = "/" + trimmed
	}

	segments := strings.Split(trimmed, "/")
	normalizedSegments := make([]string, 0, len(segments))
	for _, segment := range segments {
		safe := normalizeAIGeneratedSessionFolderSegment(segment)
		if safe != "" {
			normalizedSegments = append(normalizedSegments, safe)
		}
	}
	if len(normalizedSegments) == 0 {
		return ""
	}
	return "/" + strings.Join(normalizedSegments, "/")
}

func normalizeAIGeneratedSessionFolderSegment(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
	}

	replacer := strings.NewReplacer(
		"/", "-",
		"\\", "-",
		":", "-",
		"*", "-",
		"?", "-",
		"\"", "-",
		"<", "-",
		">", "-",
		"|", "-",
		"\t", " ",
		"\n", " ",
		"\r", " ",
	)
	trimmed = replacer.Replace(trimmed)
	trimmed = strings.Join(strings.Fields(trimmed), "-")
	trimmed = strings.Trim(trimmed, "-._")
	if trimmed == "" {
		return ""
	}

	runes := []rune(trimmed)
	const maxSegmentRunes = 80
	if len(runes) > maxSegmentRunes {
		trimmed = string(runes[:maxSegmentRunes])
		trimmed = strings.Trim(trimmed, "-._")
	}
	return trimmed
}
