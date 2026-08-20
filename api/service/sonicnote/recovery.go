package sonicnote

import (
	"context"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
)

// RecoverSyncState 服务启动时恢复同步状态（多实例安全）。
// 只处理当前实例（owner_instance）遗留的状态：
//  1. 标记本实例卡在 running 的同步 job 为 interrupted（服务重启导致 goroutine 消失）
//  2. 保留已完成的 job 记录（供前端查看历史同步）
//
// 注意：绝不清空 recording_sync_sources（去重标记表）——
// 它是同步幂等的防线，清空会导致下次同步全部重新导入产生重复文件。
// 历史数据清理（如测试数据）应一次性手动执行 SQL，不放入启动逻辑。
//
// 数据安全：同步幂等由 RecordingSyncSource 唯一索引保证（已导入的会 Skipped 跳过），
// 重启后用户重新触发同步即可续传，无需额外逻辑。
func RecoverSyncState(ctx context.Context) error {
	instanceID := model.GetRecordingInstanceID()

	// 标记本实例 running → interrupted
	res := model.DB.WithContext(ctx).Model(&model.RecordingSyncJob{}).
		Where("owner_instance = ? AND status = ?", instanceID, "running").
		Updates(map[string]interface{}{
			"status":      "interrupted",
			"error":       "服务重启中断",
			"finished_at": time.Now().UnixMilli(),
		})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected > 0 {
		logger.Infof(ctx, "【SonicNote】启动恢复：标记 %d 个中断的同步任务 (instance=%s)", res.RowsAffected, instanceID)
	}
	return nil
}
