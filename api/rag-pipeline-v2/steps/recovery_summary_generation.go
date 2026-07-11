package steps

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

// RecoverSummaryGeneration summary_generation 步骤的恢复 handler
// 断点检查：file.ai_generate_sq_status 是否为 normal
func RecoverSummaryGeneration(db *gorm.DB) func(ctx context.Context, job *model.RagJob, config json.RawMessage) error {
	return func(ctx context.Context, job *model.RagJob, config json.RawMessage) error {
		eid, fileID := extractEidAndFileID(job)

		var file model.File
		if err := db.Where("eid = ? AND id = ?", eid, fileID).First(&file).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				logger.Warnf(ctx, "【流水线恢复】summary_generation: 文件不存在，跳过 (eid=%d, file_id=%d)", eid, fileID)
				return nil
			}
			return NewSummaryGenerationHandler(db)(ctx, job, config)
		}

		if file.AIGenerateSQStatus == model.AIGenerateSQStatusNormal {
			logger.Infof(ctx, "【流水线恢复】summary_generation: 摘要已生成，跳过 (file_id=%d)", fileID)
			return nil
		}

		logger.Infof(ctx, "【流水线恢复】summary_generation: 摘要未完成，重做 (file_id=%d)", fileID)
		return NewSummaryGenerationHandler(db)(ctx, job, config)
	}
}
