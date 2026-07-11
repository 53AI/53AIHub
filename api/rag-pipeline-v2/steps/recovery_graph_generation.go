package steps

import (
	"context"
	"encoding/json"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

// RecoverGraphGeneration graph_generation 步骤的恢复 handler
// 断点检查：graph_instances 表中该文件是否有 completed 状态的实例
func RecoverGraphGeneration(db *gorm.DB) func(ctx context.Context, job *model.RagJob, config json.RawMessage) error {
	return func(ctx context.Context, job *model.RagJob, config json.RawMessage) error {
		eid, fileID := extractEidAndFileID(job)

		var completed model.GraphInstance
		if err := db.Where("eid = ? AND file_id = ? AND run_id = ? AND status = ?",
			eid, fileID, job.RunID, model.GraphInstanceStatusCompleted).
			First(&completed).Error; err == nil {
			logger.Infof(ctx, "【流水线恢复】graph_generation: 图谱实例已完成，跳过 (file_id=%d, instance_id=%d)", fileID, completed.ID)
			return nil
		}

		// 清理残留的 processing instance
		db.Where("eid = ? AND file_id = ? AND run_id = ? AND status = ?",
			eid, fileID, job.RunID, model.GraphInstanceStatusProcessing).
			Delete(&model.GraphInstance{})

		logger.Infof(ctx, "【流水线恢复】graph_generation: 重做图谱生成 (file_id=%d)", fileID)
		return NewGraphGenerationHandler(db)(ctx, job, config)
	}
}
