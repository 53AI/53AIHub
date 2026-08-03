package model

import (
	"encoding/json"
	"errors"
	"time"

	"gorm.io/gorm"
)

type EmbeddingReindexRun struct {
	ID                int64  `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid               int64  `json:"eid" gorm:"not null;index:idx_embedding_reindex_runs_eid_status,priority:1;index:idx_embedding_reindex_runs_eid_run_id,priority:1"`
	RunID             string `json:"run_id" gorm:"size:36;not null;uniqueIndex:uniq_embedding_reindex_runs_run_id;index:idx_embedding_reindex_runs_eid_run_id,priority:2"`
	Status            string `json:"status" gorm:"size:20;not null;index:idx_embedding_reindex_runs_status;index:idx_embedding_reindex_runs_eid_status,priority:2"`
	OldChannelID      int64  `json:"old_channel_id" gorm:"not null;default:0"`
	OldModelName      string `json:"old_model_name" gorm:"size:100;not null;default:''"`
	NewChannelID      int64  `json:"new_channel_id" gorm:"not null;default:0"`
	NewModelName      string `json:"new_model_name" gorm:"size:100;not null;default:''"`
	OldDimension      int    `json:"old_dimension" gorm:"not null;default:0"`
	NewDimension      int    `json:"new_dimension" gorm:"not null;default:0"`
	DimensionChanged  bool   `json:"dimension_changed" gorm:"not null;default:false"`
	TotalFiles        int64  `json:"total_files" gorm:"not null;default:0"`
	QueuedFiles       int64  `json:"queued_files" gorm:"not null;default:0"`
	SucceededFiles    int64  `json:"succeeded_files" gorm:"not null;default:0"`
	FailedFiles       int64  `json:"failed_files" gorm:"not null;default:0"`
	CursorFileID      int64  `json:"cursor_file_id" gorm:"not null;default:0"`
	CursorLibraryID   int64  `json:"cursor_library_id" gorm:"not null;default:0"`
	RebuiltLibraryIDs string `json:"rebuilt_library_ids" gorm:"type:text"`
	StartedTime       int64  `json:"started_time" gorm:"not null;default:0"`
	EndedTime         int64  `json:"ended_time" gorm:"not null;default:0"`
	FailureReason     string `json:"failure_reason" gorm:"type:text"`
	BaseModel
}

func (EmbeddingReindexRun) TableName() string {
	return "embedding_reindex_runs"
}

const (
	EmbeddingReindexStatusPending    = "pending"
	EmbeddingReindexStatusProcessing = "processing"
	EmbeddingReindexStatusSuccess    = "success"
	EmbeddingReindexStatusFailed     = "failed"
	EmbeddingReindexStatusCancelled  = "cancelled"
)

func activeEmbeddingReindexStatuses() []string {
	return []string{
		EmbeddingReindexStatusPending,
		EmbeddingReindexStatusProcessing,
	}
}

func CreateEmbeddingReindexRun(tx *gorm.DB, run *EmbeddingReindexRun) error {
	if run == nil {
		return errors.New("embedding reindex run is nil")
	}
	if tx == nil {
		tx = DB
	}
	if tx == nil {
		return errors.New("db is nil")
	}
	if run.Status == "" {
		run.Status = EmbeddingReindexStatusPending
	}
	if run.StartedTime == 0 {
		run.StartedTime = time.Now().UTC().UnixMilli()
	}
	return tx.Create(run).Error
}

func CancelActiveEmbeddingReindexRuns(tx *gorm.DB, eid int64, reason string) error {
	if tx == nil {
		tx = DB
	}
	if tx == nil {
		return errors.New("db is nil")
	}
	now := time.Now().UTC().UnixMilli()
	return tx.Model(&EmbeddingReindexRun{}).
		Where("eid = ? AND status IN ?", eid, activeEmbeddingReindexStatuses()).
		Updates(map[string]interface{}{
			"status":         EmbeddingReindexStatusCancelled,
			"failure_reason": reason,
			"ended_time":     now,
			"updated_time":   now,
		}).Error
}

func GetActiveEmbeddingReindexRun(db *gorm.DB, eid int64) (*EmbeddingReindexRun, error) {
	if db == nil {
		db = DB
	}
	if db == nil {
		return nil, errors.New("db is nil")
	}
	var run EmbeddingReindexRun
	if err := db.Where("eid = ? AND status IN ?", eid, activeEmbeddingReindexStatuses()).
		Order("id DESC").
		First(&run).Error; err != nil {
		return nil, err
	}
	return &run, nil
}

func UpdateEmbeddingReindexRunProgress(db *gorm.DB, runID string, updates map[string]interface{}) error {
	if db == nil {
		db = DB
	}
	if db == nil {
		return errors.New("db is nil")
	}
	if runID == "" {
		return errors.New("run_id is empty")
	}
	if updates == nil {
		updates = map[string]interface{}{}
	}
	safeUpdates := make(map[string]interface{}, len(updates)+1)
	for key, value := range updates {
		safeUpdates[key] = value
	}
	safeUpdates["updated_time"] = time.Now().UTC().UnixMilli()
	return db.Model(&EmbeddingReindexRun{}).Where("run_id = ?", runID).Updates(safeUpdates).Error
}

func (r *EmbeddingReindexRun) parsedRebuiltLibraryIDs() []int64 {
	if r.RebuiltLibraryIDs == "" {
		return nil
	}
	var ids []int64
	if err := json.Unmarshal([]byte(r.RebuiltLibraryIDs), &ids); err != nil {
		return nil
	}
	return ids
}

func (r *EmbeddingReindexRun) IsLibraryRebuilt(libraryID int64) bool {
	for _, id := range r.parsedRebuiltLibraryIDs() {
		if id == libraryID {
			return true
		}
	}
	return false
}

func (r *EmbeddingReindexRun) MarkLibraryRebuilt(libraryID int64) {
	ids := r.parsedRebuiltLibraryIDs()
	for _, id := range ids {
		if id == libraryID {
			return
		}
	}
	ids = append(ids, libraryID)
	data, _ := json.Marshal(ids)
	r.RebuiltLibraryIDs = string(data)
}

func (r *EmbeddingReindexRun) IsEnterpriseRebuilt() bool {
	return r.RebuiltLibraryIDs == "__enterprise__"
}

func (r *EmbeddingReindexRun) MarkEnterpriseRebuilt() {
	r.RebuiltLibraryIDs = "__enterprise__"
}
