package model

type RecordingSummaryTemplate struct {
	ID          int64  `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid         int64  `json:"eid" gorm:"not null;uniqueIndex:idx_eid_name"`
	Name        string `json:"name" gorm:"size:100;not null;uniqueIndex:idx_eid_name"`
	Description string `json:"description" gorm:"type:text;not null"`
	Prompt      string `json:"prompt" gorm:"type:text;not null"`
	GroupID     int64  `json:"group_id" gorm:"not null;default:0"`
	BaseModel
}

func CreateRecordingSummaryTemplate(t *RecordingSummaryTemplate) error {
	return DB.Create(t).Error
}

func UpdateRecordingSummaryTemplate(t *RecordingSummaryTemplate) error {
	return DB.Model(t).
		Select("name", "description", "prompt", "group_id", "updated_time").
		Updates(t).Error
}

func DeleteRecordingSummaryTemplate(id int64) error {
	return DB.Where("id = ?", id).Delete(&RecordingSummaryTemplate{}).Error
}

func GetRecordingSummaryTemplateByID(id int64) (*RecordingSummaryTemplate, error) {
	var t RecordingSummaryTemplate
	err := DB.Where("id = ?", id).First(&t).Error
	return &t, err
}

func GetRecordingSummaryTemplatesByEid(eid int64, groupID int64) ([]RecordingSummaryTemplate, error) {
	var templates []RecordingSummaryTemplate
	query := DB.Where("eid = ?", eid)
	if groupID > 0 {
		query = query.Where("group_id = ?", groupID)
	}
	err := query.Order("created_time DESC").Find(&templates).Error
	return templates, err
}
