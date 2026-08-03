package service

import (
	"context"
	"strings"

	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

// RecordingFileQueryService 负责录音文件列表查询和收藏状态。
type RecordingFileQueryService struct {
	eid               int64
	personalSpaceSvc  *PersonalSpaceService
	filePermissionSvc *FilePermissionService
}

// NewRecordingFileQueryService 创建文件查询服务。
func NewRecordingFileQueryService(svc *RecordingService) *RecordingFileQueryService {
	return &RecordingFileQueryService{
		eid:               svc.eid,
		personalSpaceSvc:  svc.personalSpaceSvc,
		filePermissionSvc: svc.filePermissionSvc,
	}
}

// ListMyRecordingFiles 列出用户录音文件，支持分页、排序、搜索、分组筛选。
func (q *RecordingFileQueryService) ListMyRecordingFiles(ctx context.Context, userID int64, query *RecordingFileListQuery) ([]model.File, int64, error) {
	if query == nil {
		query = &RecordingFileListQuery{}
	}
	if query.Offset < 0 {
		query.Offset = 0
	}
	if query.Limit <= 0 {
		query.Limit = 30
	}
	if query.Limit > 200 {
		query.Limit = 200
	}
	library, err := q.personalSpaceSvc.GetExistingPersonalLibrary(ctx, userID)
	if err != nil {
		return nil, 0, err
	}
	if library == nil {
		return []model.File{}, 0, nil
	}

	fileTypes := []int{model.FILE_TYPE_DIR, model.FILE_TYPE_FILE}
	if query.Type != nil {
		fileTypes = []int{*query.Type}
	}

	if strings.TrimSpace(query.Keyword) != "" {
		files, total, err := searchMySpaceFilesByKeywordWithOriginTypes(ctx, q.eid, library.ID, model.RecordingOriginTypes(), query.Keyword, query.Type, query.Offset, query.Limit, query.GroupID)
		if err != nil {
			return nil, 0, err
		}
		if err := q.attachUploadFiles(files); err != nil {
			return nil, 0, err
		}
		if err := q.fillFavoriteStatus(userID, files); err != nil {
			return nil, 0, err
		}
		return files, total, nil
	}

	var files []model.File
	qb := q.buildMyRecordingFilesQuery(library.ID, fileTypes, query.Path, query.GroupID)

	if query.StartTime > 0 {
		qb = qb.Where("created_time >= ?", query.StartTime)
	}
	if query.EndTime > 0 {
		qb = qb.Where("created_time <= ?", query.EndTime)
	}

	orderClause := model.BuildRecordingSortOrder(query.SortBy, query.Order)
	if err := qb.Order(orderClause + ", id desc").Offset(query.Offset).Limit(query.Limit).Find(&files).Error; err != nil {
		return nil, 0, err
	}
	if err := q.attachUploadFiles(files); err != nil {
		return nil, 0, err
	}
	if err := q.fillFavoriteStatus(userID, files); err != nil {
		return nil, 0, err
	}

	var total int64
	countQ := q.buildMyRecordingFilesQuery(library.ID, fileTypes, query.Path, query.GroupID)
	if query.StartTime > 0 {
		countQ = countQ.Where("created_time >= ?", query.StartTime)
	}
	if query.EndTime > 0 {
		countQ = countQ.Where("created_time <= ?", query.EndTime)
	}
	if err := countQ.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	return files, total, nil
}

func (q *RecordingFileQueryService) buildMyRecordingFilesQuery(libraryID int64, fileTypes []int, pathFilter string, groupID int64) *gorm.DB {
	qb := model.DB.Model(&model.File{}).
		Where("eid = ? AND library_id = ? AND is_deleted = ?", q.eid, libraryID, false).
		Where("origin_type IN ?", model.RecordingOriginTypes()).
		Where("type IN ?", fileTypes)

	if groupID > 0 {
		qb = qb.Where("group_id = ?", groupID)
	}

	if strings.TrimSpace(pathFilter) != "" {
		normalized := normalizeRecordingPath(pathFilter)
		if normalized == "/" {
			qb = qb.Where("path LIKE ? AND path NOT LIKE ?", "/%", "/%/%")
		} else {
			qb = qb.Where("path LIKE ? AND path NOT LIKE ?", normalized+"/%", normalized+"/%/%")
		}
	}

	return qb
}

func (q *RecordingFileQueryService) fillFavoriteStatus(userID int64, files []model.File) error {
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

func (q *RecordingFileQueryService) attachUploadFiles(files []model.File) error {
	if len(files) == 0 {
		return nil
	}
	uploadFileIDs := make([]int64, 0, len(files))
	for _, f := range files {
		if f.UploadFileID > 0 {
			uploadFileIDs = append(uploadFileIDs, f.UploadFileID)
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
