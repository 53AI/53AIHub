package steps

import (
	"context"
	"encoding/json"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

// RecoverDocumentParsing document_parsing 步骤的恢复 handler
// 断点检查：file_bodies 表是否有该文件的记录
func RecoverDocumentParsing(db *gorm.DB) func(ctx context.Context, job *model.RagJob, config json.RawMessage) error {
	return func(ctx context.Context, job *model.RagJob, config json.RawMessage) error {
		eid, fileID := extractEidAndFileID(job)

		var count int64
		db.Model(&model.FileBody{}).Where("eid = ? AND file_id = ?", eid, fileID).Count(&count)
		if count > 0 {
			logger.Infof(ctx, "【流水线恢复】document_parsing: file_bodies 已存在，跳过 (file_id=%d)", fileID)
			return nil
		}

		logger.Infof(ctx, "【流水线恢复】document_parsing: file_bodies 不存在，重做 (file_id=%d)", fileID)
		return NewDocumentParsingHandler(db)(ctx, job, config)
	}
}
