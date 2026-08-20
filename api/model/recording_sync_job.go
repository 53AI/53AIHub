package model

// RecordingSyncJob 记录一次 SonicNote 同步任务的状态与进度。
// 同步开始建 running 记录，结束更新终态；供前端轮询展示进度。
type RecordingSyncJob struct {
	ID         int64  `json:"id" gorm:"column:id;primaryKey;autoIncrement"`
	Eid        int64  `json:"eid" gorm:"column:eid;not null;index"`
	UserID     int64  `json:"user_id" gorm:"column:user_id;not null;index"`
	Provider   string `json:"provider" gorm:"column:provider;size:32;not null"`
	Status     string `json:"status" gorm:"column:status;size:20;not null"` // running | completed | failed | interrupted(服务重启)
	Discovered int    `json:"discovered" gorm:"column:discovered;not null;default:0"`
	Completed  int    `json:"completed" gorm:"column:completed;not null;default:0"`
	Failed     int    `json:"failed" gorm:"column:failed;not null;default:0"`
	Skipped    int    `json:"skipped" gorm:"column:skipped;not null;default:0"`
	Error      string `json:"error,omitempty" gorm:"column:error;type:text"`
	// FailedDetails 逐条失败明细 JSON：[{audio_id, title, reason}]，空为无失败。
	FailedDetails string `json:"failed_details,omitempty" gorm:"column:failed_details;type:text"`
	// OwnerInstance 启动同步的实例 ID（多实例隔离，复用录音模块的 RECORDING_INSTANCE_ID）。
	OwnerInstance string `json:"owner_instance" gorm:"size:64;not null;default:'';index"`
	StartedAt     int64  `json:"started_at" gorm:"column:started_at;not null;default:0"`
	FinishedAt    int64  `json:"finished_at" gorm:"column:finished_at;not null;default:0"`
	BaseModel
}

func (RecordingSyncJob) TableName() string { return "recording_sync_jobs" }

// CreateRecordingSyncJob 创建同步任务记录。
func CreateRecordingSyncJob(job *RecordingSyncJob) error {
	return DB.Create(job).Error
}

// UpdateRecordingSyncJob 更新同步任务记录字段。
func UpdateRecordingSyncJob(id int64, fields map[string]interface{}) error {
	return DB.Model(&RecordingSyncJob{}).Where("id = ?", id).Updates(fields).Error
}

// GetLatestRecordingSyncJob 查询用户最近一次同步任务记录。
func GetLatestRecordingSyncJob(eid, userID int64) (*RecordingSyncJob, error) {
	var job RecordingSyncJob
	if err := DB.Where("eid = ? AND user_id = ?", eid, userID).
		Order("id DESC").First(&job).Error; err != nil {
		return nil, err
	}
	return &job, nil
}

// GetLatestRecordingSyncJobByProvider 查询用户指定设备（provider）最近一次同步任务记录。
// 多设备（SonicNote + TicNote / 多 key）场景下按设备隔离查询，避免跨设备误读最近任务。
func GetLatestRecordingSyncJobByProvider(eid, userID int64, provider string) (*RecordingSyncJob, error) {
	var job RecordingSyncJob
	if err := DB.Where("eid = ? AND user_id = ? AND provider = ?", eid, userID, provider).
		Order("id DESC").First(&job).Error; err != nil {
		return nil, err
	}
	return &job, nil
}

// HasRunningRecordingSyncJob 检查同 eid+user+provider 是否已有 running 任务（跨实例防重入）。
// 进程内已有 sync.Mutex 防同实例重入；多实例部署下加 DB 层检查：
// 另一实例正在同步同一设备时，本实例拒绝再起任务，避免并发拉取同一远端录音。
func HasRunningRecordingSyncJob(eid, userID int64, provider string) (bool, error) {
	var count int64
	if err := DB.Model(&RecordingSyncJob{}).
		Where("eid = ? AND user_id = ? AND provider = ? AND status = ?", eid, userID, provider, "running").
		Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}
