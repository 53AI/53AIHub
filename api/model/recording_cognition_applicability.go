package model

// RecordingCognitionApplicability stores explicit, permission-scoped conditions
// under which a confirmed cognition may be recalled. It is additive to the
// legacy scope JSON and can be introduced as a new AutoMigrate table.
type RecordingCognitionApplicability struct {
	ID          int64  `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid         int64  `json:"eid" gorm:"not null;index:idx_recording_cognition_applicability_scope,priority:1"`
	OwnerID     int64  `json:"owner_id" gorm:"not null;index:idx_recording_cognition_applicability_scope,priority:2"`
	CognitionID int64  `json:"cognition_id" gorm:"not null;index:idx_recording_cognition_applicability_scope,priority:3;uniqueIndex:uniq_recording_cognition_applicability,priority:1"`
	SceneCode   string `json:"scene_code" gorm:"size:64;uniqueIndex:uniq_recording_cognition_applicability,priority:2;index"`
	DomainCode  string `json:"domain_code" gorm:"size:64;uniqueIndex:uniq_recording_cognition_applicability,priority:3;index"`
	TopicCode   string `json:"topic_code" gorm:"size:128;uniqueIndex:uniq_recording_cognition_applicability,priority:4;index"`
	EntityKey   string `json:"entity_key" gorm:"size:128;uniqueIndex:uniq_recording_cognition_applicability,priority:5;index"`
	Include     bool   `json:"include" gorm:"not null;default:true"`
	ValidFrom   int64  `json:"valid_from" gorm:"not null;default:0;index"`
	ValidUntil  int64  `json:"valid_until" gorm:"not null;default:0;index"`
	Reason      string `json:"reason" gorm:"size:255"`
	BaseModel
}

func (RecordingCognitionApplicability) TableName() string {
	return "recording_cognition_applicabilities"
}
