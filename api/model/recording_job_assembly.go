package model

import (
	"errors"
	"strings"

	"gorm.io/gorm"
)

const (
	RecordingJobAssemblyStatusActive    = "active"
	RecordingJobAssemblyStatusFlushing  = "flushing"
	RecordingJobAssemblyStatusFailed    = "failed"
	RecordingJobAssemblyStatusCompleted = "completed"
)

type RecordingJobAssembly struct {
	ID               int64  `json:"id" gorm:"primaryKey;autoIncrement"`
	JobID            int64  `json:"job_id" gorm:"not null;uniqueIndex:idx_recording_job_assembly_job_id"`
	Eid              int64  `json:"eid" gorm:"not null;index"`
	OwnerInstance    string `json:"owner_instance" gorm:"size:64;not null;default:'';index"`
	UserID           int64  `json:"user_id" gorm:"not null;index"`
	SegmentIndex     int64  `json:"segment_index" gorm:"not null;default:0"`
	BufferKey        string `json:"buffer_key" gorm:"size:512;not null;default:''"`
	BufferSize       int64  `json:"buffer_size" gorm:"not null;default:0"`
	BufferDurationMs int64  `json:"buffer_duration_ms" gorm:"not null;default:0"`
	LastInputIndex   int64  `json:"last_input_index" gorm:"not null;default:-1"`
	LastInputHash    string `json:"last_input_hash" gorm:"size:128;not null;default:''"`
	Status           string `json:"status" gorm:"size:20;not null;default:'active';index"`
	Version          int64  `json:"version" gorm:"not null;default:0"`
	BaseModel
}

func (a *RecordingJobAssembly) Normalize() {
	if a == nil {
		return
	}
	a.BufferKey = strings.TrimSpace(a.BufferKey)
	a.LastInputHash = strings.TrimSpace(a.LastInputHash)
	a.Status = strings.TrimSpace(a.Status)
	if a.Status == "" {
		a.Status = RecordingJobAssemblyStatusActive
	}
	if a.SegmentIndex < 0 {
		a.SegmentIndex = 0
	}
	if a.LastInputIndex < 0 {
		a.LastInputIndex = -1
	}
	if a.BufferSize < 0 {
		a.BufferSize = 0
	}
	if a.BufferDurationMs < 0 {
		a.BufferDurationMs = 0
	}
	if a.Version < 0 {
		a.Version = 0
	}
	a.OwnerInstance = normalizeRecordingInstanceID(a.OwnerInstance)
}

func (a *RecordingJobAssembly) BeforeCreate(tx *gorm.DB) error {
	_ = tx
	if strings.TrimSpace(a.OwnerInstance) == "" {
		a.OwnerInstance = recordingCurrentInstanceID()
	}
	a.Normalize()
	return nil
}

func (a *RecordingJobAssembly) BeforeUpdate(tx *gorm.DB) error {
	_ = tx
	if strings.TrimSpace(a.OwnerInstance) == "" {
		a.OwnerInstance = recordingCurrentInstanceID()
	}
	a.Normalize()
	return nil
}

func (a *RecordingJobAssembly) CanAppend() bool {
	if a == nil {
		return false
	}
	return a.Status == RecordingJobAssemblyStatusActive
}

func (a *RecordingJobAssembly) CanRecover() bool {
	if a == nil {
		return false
	}
	switch a.Status {
	case RecordingJobAssemblyStatusActive, RecordingJobAssemblyStatusFlushing:
		return true
	default:
		return false
	}
}

func (a *RecordingJobAssembly) CanEnterFlushing() bool {
	if a == nil {
		return false
	}
	return a.Status == RecordingJobAssemblyStatusActive
}

func (a *RecordingJobAssembly) IsTerminal() bool {
	if a == nil {
		return false
	}
	return a.Status == RecordingJobAssemblyStatusCompleted || a.Status == RecordingJobAssemblyStatusFailed
}

func CreateRecordingJobAssembly(assembly *RecordingJobAssembly) error {
	if assembly == nil {
		return errors.New("recording job assembly is nil")
	}
	if strings.TrimSpace(assembly.OwnerInstance) == "" {
		assembly.OwnerInstance = recordingCurrentInstanceID()
	}
	assembly.Normalize()
	return DB.Create(assembly).Error
}

func GetRecordingJobAssemblyByJobID(jobID int64) (*RecordingJobAssembly, error) {
	var assembly RecordingJobAssembly
	if err := DB.Where("job_id = ? AND owner_instance = ?", jobID, recordingCurrentInstanceID()).First(&assembly).Error; err != nil {
		return nil, err
	}
	return &assembly, nil
}

func UpdateRecordingJobAssembly(assembly *RecordingJobAssembly, fields map[string]interface{}) error {
	if assembly == nil {
		return errors.New("recording job assembly is nil")
	}
	if len(fields) == 0 {
		return nil
	}
	instanceID := recordingEnsureInstanceID(assembly.OwnerInstance)
	return DB.Model(&RecordingJobAssembly{}).
		Where("id = ? AND owner_instance = ?", assembly.ID, instanceID).
		Updates(fields).Error
}

func MarkRecordingJobAssemblyStatus(jobID int64, status string) error {
	return DB.Model(&RecordingJobAssembly{}).
		Where("job_id = ? AND owner_instance = ?", jobID, recordingCurrentInstanceID()).
		Updates(map[string]interface{}{
			"status": status,
		}).Error
}

func IsRecordingJobAssemblyRecoverableStatus(status string) bool {
	switch strings.TrimSpace(status) {
	case RecordingJobAssemblyStatusActive, RecordingJobAssemblyStatusFlushing:
		return true
	default:
		return false
	}
}
