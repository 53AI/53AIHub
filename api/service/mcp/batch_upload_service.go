package mcp

import (
	"context"

	core "github.com/53AI/53AIHub/service"
)

type BatchUploadService struct {
	facade *core.BatchUploadFacade
}

func NewBatchUploadService() *BatchUploadService {
	return NewBatchUploadServiceWithFacade(core.NewBatchUploadFacade(core.GetBatchUploadManagerInstance()))
}

func NewBatchUploadServiceWithFacade(facade *core.BatchUploadFacade) *BatchUploadService {
	if facade == nil {
		facade = core.NewBatchUploadFacade(core.GetBatchUploadManagerInstance())
	}
	return &BatchUploadService{facade: facade}
}

func (s *BatchUploadService) InitBatch(ctx context.Context, eid, userID int64, req *core.BatchInitRequest) (*core.BatchInitResponse, error) {
	result, err := s.facade.CreateBatch(ctx, eid, userID, req)
	if err != nil {
		return nil, err
	}
	return &core.BatchInitResponse{
		BatchID:        result.Batch.ID,
		UploadToken:    result.Batch.UploadToken,
		MaxConcurrent:  s.facade.GetMaxConcurrent(),
		ChunkSize:      s.facade.GetChunkSize(),
		FileMappings:   result.FileMappings,
		DuplicateFiles: result.DuplicateFiles,
	}, nil
}

func (s *BatchUploadService) GetProgress(ctx context.Context, batchID string, detail bool, fileUploadID string, since int64) (*core.BatchProgressResponse, error) {
	return s.facade.GetProgressStorage().GetBatchProgress(batchID, &core.ProgressQueryParams{
		Detail:       detail,
		FileUploadID: fileUploadID,
		Since:        since,
	})
}

func (s *BatchUploadService) CancelBatch(ctx context.Context, batchID string) error {
	return s.facade.CancelBatch(batchID)
}
