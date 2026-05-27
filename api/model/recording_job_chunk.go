package model

import (
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"
)

const (
	RecordingJobChunkStatusUploaded = "uploaded"
	RecordingJobChunkStatusFailed   = "failed"
)

type RecordingJobChunk struct {
	ID            int64  `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid           int64  `json:"eid" gorm:"not null"`
	OwnerInstance string `json:"owner_instance" gorm:"size:64;not null;default:'';index:idx_recording_job_chunks_job_owner_segment,priority:2;index"`
	JobID         int64  `json:"job_id" gorm:"not null;index:idx_recording_job_chunks_job_owner_segment,priority:1;index:idx_recording_job_chunks_status,priority:1"`
	SegmentIndex  int64  `json:"segment_index" gorm:"not null;index:idx_recording_job_chunks_job_owner_segment,priority:3"`
	StorageKey    string `json:"storage_key" gorm:"size:512;not null"`
	Size          int64  `json:"size" gorm:"not null;default:0"`
	DurationMs    int64  `json:"duration_ms" gorm:"not null;default:0"`
	Status        string `json:"status" gorm:"size:20;not null;default:'uploaded';index:idx_recording_job_chunks_status,priority:2"`
	Error         string `json:"error" gorm:"type:text"`
	CreatedTime   int64  `json:"created_time" gorm:"not null;default:0"`
	UpdatedTime   int64  `json:"updated_time" gorm:"not null;default:0"`
}

func (c *RecordingJobChunk) Normalize() {
	if c == nil {
		return
	}
	c.StorageKey = strings.TrimSpace(c.StorageKey)
	c.Status = strings.TrimSpace(c.Status)
	if c.Status == "" {
		c.Status = RecordingJobChunkStatusUploaded
	}
	c.Error = strings.TrimSpace(c.Error)
	if c.SegmentIndex < 0 {
		c.SegmentIndex = 0
	}
	if c.Size < 0 {
		c.Size = 0
	}
	if c.DurationMs < 0 {
		c.DurationMs = 0
	}
	c.OwnerInstance = normalizeRecordingInstanceID(c.OwnerInstance)
}

func (c *RecordingJobChunk) BeforeCreate(tx *gorm.DB) error {
	_ = tx
	if strings.TrimSpace(c.OwnerInstance) == "" {
		c.OwnerInstance = recordingCurrentInstanceID()
	}
	c.Normalize()
	now := time.Now().UTC().UnixMilli()
	if c.CreatedTime == 0 {
		c.CreatedTime = now
	}
	c.UpdatedTime = now
	return nil
}

func (c *RecordingJobChunk) BeforeUpdate(tx *gorm.DB) error {
	_ = tx
	if strings.TrimSpace(c.OwnerInstance) == "" {
		c.OwnerInstance = recordingCurrentInstanceID()
	}
	c.Normalize()
	c.UpdatedTime = time.Now().UTC().UnixMilli()
	return nil
}

func CreateRecordingJobChunk(chunk *RecordingJobChunk) error {
	if chunk == nil {
		return errors.New("recording job chunk is nil")
	}
	if strings.TrimSpace(chunk.OwnerInstance) == "" {
		chunk.OwnerInstance = recordingCurrentInstanceID()
	}
	chunk.Normalize()
	return DB.Create(chunk).Error
}

func GetRecordingJobChunksByJobID(jobID int64) ([]RecordingJobChunk, error) {
	var chunks []RecordingJobChunk
	if err := DB.Where("job_id = ? AND owner_instance = ?", jobID, recordingCurrentInstanceID()).
		Order("segment_index asc, id asc").
		Find(&chunks).Error; err != nil {
		return nil, err
	}
	return chunks, nil
}
