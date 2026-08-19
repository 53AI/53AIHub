package model

import (
	"context"

	"gorm.io/gorm"
)

// RecordingSyncSource 记录已从第三方同步的录音源，用于增量同步去重。
// (eid, user_id, provider, remote_id) 联合唯一：同一用户同一远端录音只同步一次。
// user_id 维度支持同 key 换绑：A 换 key 后 K1 给 B，B 可同步自己的记录（A 的记录不阻塞）。
// 注：唯一索引由标准 Schema 迁移维护（不使用 AutoMigrate，存量数据先去重再建索引），
// 见 service/schemamigrate/migrations/ 下 recording_sync_sources 相关迁移。
type RecordingSyncSource struct {
	ID       int64  `json:"id" gorm:"column:id;primaryKey;autoIncrement"`
	Eid      int64  `json:"eid" gorm:"column:eid;not null"`
	UserID   int64  `json:"user_id" gorm:"column:user_id;not null;default:0"`
	Provider string `json:"provider" gorm:"column:provider;size:32;not null"`
	RemoteID string `json:"remote_id" gorm:"column:remote_id;size:128;not null"`

	FileID   int64  `json:"file_id" gorm:"column:file_id;not null;default:0"`
	// JobID 同步该文件的 job（文件↔job 溯源）。
	JobID int64 `json:"job_id" gorm:"column:job_id;not null;default:0;index"`
	BaseModel
}

func (RecordingSyncSource) TableName() string {
	return "recording_sync_sources"
}

// SyncSourceState 一条远端录音的同步状态。
// HasSource：已同步过（recording_sync_sources 有记录）；FileActive：关联 File 存在且未软删。
// 去重语义（幂等补缺）：HasSource && FileActive → 跳过；HasSource && !FileActive → 重导（文件被删，同步回来）；!HasSource → 导入。
type SyncSourceState struct {
	HasSource  bool
	FileActive bool
	ID         int64 // sync source ID（重导时事务内删除用）
}

// GetExistingSyncSourceStates 批量查询**当前用户**已同步 remote_id 及其关联文件有效态（每页一次 IN 查询）。
// 关联 files 表判定 FileActive：files.id 存在且未软删（LEFT JOIN 保护"FileID 指向已删/不存在文件"场景）。
func GetExistingSyncSourceStates(ctx context.Context, eid, userID int64, provider string, remoteIDs []string) (map[string]SyncSourceState, error) {
	if len(remoteIDs) == 0 {
		return map[string]SyncSourceState{}, nil
	}
	var rows []struct {
		RemoteID   string
		ID         int64
		FileActive bool
	}
	if err := DB.WithContext(ctx).Model(&RecordingSyncSource{}).
		Select("recording_sync_sources.remote_id, recording_sync_sources.id, (files.id IS NOT NULL AND files.is_deleted = ?) AS file_active", false).
		Joins("LEFT JOIN files ON files.id = recording_sync_sources.file_id").
		Where("recording_sync_sources.eid = ? AND recording_sync_sources.user_id = ? AND recording_sync_sources.provider = ? AND recording_sync_sources.remote_id IN ?", eid, userID, provider, remoteIDs).
		Scan(&rows).Error; err != nil {
		return nil, err
	}
	result := make(map[string]SyncSourceState, len(rows))
	for _, r := range rows {
		result[r.RemoteID] = SyncSourceState{HasSource: true, FileActive: r.FileActive, ID: r.ID}
	}
	return result, nil
}

// GetReuseSyncSource 查询同 eid 同 provider 同 remote 但**其他用户**的 sync source（换 key 复用源）。
// 复用语义：当前用户无自己的 sync source 时，可复用同企业其他用户已同步的同一远端录音
// （不下载/不存储，File 指向源 upload_file；转写/纪要由管线按同 hash/同 upload_file 拷贝）。
// 选择策略：候选源通常极少（同企业同远端录音的其他用户），全量取回后按
// "关联文件有效（未软删）→ ID 最新"排序，优先返回可复用源——避免多个用户同步过同一
// 远端录音时取到文件已软删/失效的源而白白退回全量下载。
func GetReuseSyncSource(ctx context.Context, eid, excludeUserID int64, provider, remoteID string) (*RecordingSyncSource, error) {
	var candidates []RecordingSyncSource
	if err := DB.WithContext(ctx).Model(&RecordingSyncSource{}).
		Where("eid = ? AND user_id != ? AND provider = ? AND remote_id = ?", eid, excludeUserID, provider, remoteID).
		Order("id DESC").
		Find(&candidates).Error; err != nil {
		return nil, err
	}
	if len(candidates) == 0 {
		return nil, gorm.ErrRecordNotFound
	}
	// 内存排序：文件有效（未软删）的优先；都失效时取最新一条（调用方会退回全量下载）
	var best *RecordingSyncSource
	for i := range candidates {
		c := &candidates[i]
		if c.FileID > 0 {
			if f, ferr := GetFileByID(eid, c.FileID); ferr == nil && f != nil && !f.IsDeleted {
				return c, nil // 已按 id DESC，遇到的第一个有效文件即最优
			}
		}
		if best == nil {
			best = c
		}
	}
	return best, nil
}
