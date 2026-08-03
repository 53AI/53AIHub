package model

type RecordingFileSummary struct {
	ID               int64    `json:"id" gorm:"primaryKey;autoIncrement"`
	FileID           int64    `json:"file_id" gorm:"not null;index:idx_recording_file_summaries_file_template,priority:1"`
	TemplateID       int64    `json:"template_id" gorm:"not null;index:idx_recording_file_summaries_file_template,priority:2"`
	TemplateName     string   `json:"template_name" gorm:"not null"`
	InferenceModelID int64    `json:"inference_model_id" gorm:"not null"`
	SummaryContent   LongText `json:"summary_content" gorm:"not null"`
	Status           string   `json:"status" gorm:"not null;default:pending;size:32"`
	BaseModel
}

func CreateRecordingFileSummary(s *RecordingFileSummary) error {
	return DB.Create(s).Error
}

func UpdateRecordingFileSummary(s *RecordingFileSummary) error {
	return DB.Save(s).Error
}

func DeleteRecordingFileSummary(id int64) error {
	return DB.Where("id = ?", id).Delete(&RecordingFileSummary{}).Error
}

func GetRecordingFileSummaryByID(id int64) (*RecordingFileSummary, error) {
	var s RecordingFileSummary
	err := DB.Where("id = ?", id).First(&s).Error
	return &s, err
}

func GetRecordingFileSummariesByFileID(fileID int64) ([]RecordingFileSummary, error) {
	var summaries []RecordingFileSummary
	err := DB.Where("file_id = ?", fileID).Order("id ASC").Find(&summaries).Error
	return summaries, err
}

func GetSummaryByTemplateID(fileID, templateID int64) (*RecordingFileSummary, error) {
	var summary RecordingFileSummary
	err := DB.Where("file_id = ? AND template_id = ?", fileID, templateID).First(&summary).Error
	if err != nil {
		return nil, err
	}
	return &summary, nil
}

func HasTranscriptSummary(fileID int64) bool {
	var count int64
	DB.Model(&RecordingFileSummary{}).
		Where("file_id = ? AND template_id = -1", fileID).Count(&count)
	return count > 0
}
