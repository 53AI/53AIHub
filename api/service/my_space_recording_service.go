package service

import (
	"context"
	"errors"

	"github.com/53AI/53AIHub/model"
)

type MySpaceRecordingService struct {
	eid               int64
	recordingSvc      *RecordingService
	batchUploadFacade *BatchUploadFacade
}

func NewMySpaceRecordingService(eid int64) *MySpaceRecordingService {
	return &MySpaceRecordingService{
		eid:               eid,
		recordingSvc:      NewRecordingService(eid),
		batchUploadFacade: NewBatchUploadFacade(GetBatchUploadManagerInstance()),
	}
}

func (s *MySpaceRecordingService) ListEntries(ctx context.Context, userID int64, path string, fileType *int, keyword string, offset, limit int) ([]model.File, int64, error) {
	query := &RecordingFileListQuery{
		Path:    path,
		Keyword: keyword,
		Type:    fileType,
		Offset:  offset,
		Limit:   limit,
	}
	return s.recordingSvc.ListMyRecordingFiles(ctx, userID, query)
}

func (s *MySpaceRecordingService) CreateImportBatch(ctx context.Context, userID int64, req *BatchInitRequest) (*BatchUploadFacadeResult, error) {
	personalSpaceSvc := NewPersonalSpaceService(s.eid)
	_, library, err := personalSpaceSvc.EnsurePersonalWorkspace(ctx, userID)
	if err != nil {
		return nil, err
	}
	if library == nil {
		return nil, errors.New("个人知识库不存在")
	}
	if req == nil {
		return nil, errors.New("批量上传请求不能为空")
	}

	req.LibraryID = library.ID
	req.OriginType = model.FileOriginTypeRecordingImported
	req.OriginSource = model.FileOriginSourceRecordingImport

	return s.batchUploadFacade.CreateBatch(ctx, s.eid, userID, req)
}

func (s *MySpaceRecordingService) ActiveRecordingJobID(ctx context.Context, userID int64) (int64, error) {
	job, err := s.recordingSvc.GetActiveJob(ctx, userID)
	if err != nil || job == nil {
		return 0, err
	}
	return job.ID, nil
}
