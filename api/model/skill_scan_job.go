package model

import "gorm.io/gorm"

const (
	SkillScanJobStatusPending = "pending"
	SkillScanJobStatusRunning = "running"
	SkillScanJobStatusSuccess = "success"
	SkillScanJobStatusFailed  = "failed"
)

type SkillScanJob struct {
	ID                int64  `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid               int64  `json:"eid" gorm:"not null;index:idx_skill_scan_jobs_queue,priority:1;index:idx_skill_scan_jobs_timeout,priority:1;index:idx_skill_scan_jobs_skill_latest,priority:1"`
	SkillLibraryID    int64  `json:"skill_library_id" gorm:"not null;index:idx_skill_scan_jobs_skill_latest,priority:2"`
	Status            string `json:"status" gorm:"size:20;not null;index:idx_skill_scan_jobs_queue,priority:2;index:idx_skill_scan_jobs_timeout,priority:2"`
	RiskLevel         string `json:"risk_level" gorm:"size:20;not null;default:''"`
	ScoreIntegrity    float64 `json:"score_integrity" gorm:"not null;default:0"`
	ScorePracticality float64 `json:"score_practicality" gorm:"not null;default:0"`
	ScoreSafety       float64 `json:"score_safety" gorm:"not null;default:0"`
	ScoreCodeQuality  float64 `json:"score_code_quality" gorm:"not null;default:0"`
	ScoreDocQuality   float64 `json:"score_doc_quality" gorm:"not null;default:0"`
	Message           string `json:"message" gorm:"type:text"`
	ScanPayload       string `json:"scan_payload" gorm:"type:text"`
	ScanModel         string `json:"scan_model" gorm:"size:128;not null;default:''"`
	RetryCount        int64  `json:"retry_count" gorm:"not null;default:0"`
	StartedTime       int64  `json:"started_time" gorm:"not null;default:0;index:idx_skill_scan_jobs_timeout,priority:3"`
	FinishedTime      int64  `json:"finished_time" gorm:"not null;default:0"`
	BaseModel
}

func GetLatestSkillScanJobBySkillLibraryID(eid, skillLibraryID int64) (*SkillScanJob, error) {
	return GetLatestSkillScanJobByDB(DB, eid, skillLibraryID)
}

func GetLatestSkillScanJobByDB(tx *gorm.DB, eid, skillLibraryID int64) (*SkillScanJob, error) {
	if tx == nil {
		tx = DB
	}
	var job SkillScanJob
	err := tx.Where("eid = ? AND skill_library_id = ?", eid, skillLibraryID).
		Order("created_time DESC").
		Order("id DESC").
		First(&job).Error
	if err != nil {
		return nil, err
	}
	return &job, nil
}

func GetSkillScanJobByIDAndEID(eid, jobID int64) (*SkillScanJob, error) {
	var job SkillScanJob
	if err := DB.Where("eid = ? AND id = ?", eid, jobID).First(&job).Error; err != nil {
		return nil, err
	}
	return &job, nil
}

func DeleteSkillScanJobsBySkillLibraryID(tx *gorm.DB, eid, skillLibraryID int64) error {
	if tx == nil {
		tx = DB
	}
	return tx.Where("eid = ? AND skill_library_id = ?", eid, skillLibraryID).Delete(&SkillScanJob{}).Error
}
