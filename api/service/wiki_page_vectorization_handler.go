package service

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

type WikiPageVectorizationProcessor interface {
	Process(ctx context.Context, eid, pageID, versionID int64, force bool) error
}

func NewWikiPageVectorizationHandler(processor WikiPageVectorizationProcessor) func(context.Context, *model.RagJob, json.RawMessage) error {
	return func(ctx context.Context, job *model.RagJob, _ json.RawMessage) error {
		if processor == nil {
			return fmt.Errorf("wiki page vectorization processor is nil")
		}
		params, err := parseWikiPageVectorizationParameters(job)
		if err != nil {
			return err
		}
		logger.Infof(ctx, "【Wiki向量化】开始处理: job_id=%d page_id=%d version_id=%d force=%t", job.JobID, params.PageID, params.VersionID, params.Force)
		return processor.Process(ctx, job.Eid, params.PageID, params.VersionID, params.Force)
	}
}

func RecoverWikiPageVectorization(db *gorm.DB, processor WikiPageVectorizationProcessor) func(context.Context, *model.RagJob, json.RawMessage) error {
	return func(ctx context.Context, job *model.RagJob, config json.RawMessage) error {
		if db == nil {
			return fmt.Errorf("wiki page vectorization database is nil")
		}
		if _, err := parseWikiPageVectorizationParameters(job); err != nil {
			return err
		}
		return NewWikiPageVectorizationHandler(processor)(ctx, job, config)
	}
}
