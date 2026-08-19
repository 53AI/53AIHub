package model

// RecordingMemoryClaim 是从会议纪要中编译出的、可追溯的原子会议记忆。
// 它只保存纪要明确表达的内容，不在编译阶段推断“当前立场”或关系趋势。
type RecordingMemoryClaim struct {
	ID                 int64    `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid                int64    `json:"eid" gorm:"not null;index:idx_recording_memory_claims_scope,priority:1;uniqueIndex:uniq_recording_memory_claim,priority:1"`
	OwnerID            int64    `json:"owner_id" gorm:"not null;index:idx_recording_memory_claims_scope,priority:2;uniqueIndex:uniq_recording_memory_claim,priority:2"`
	FileID             int64    `json:"file_id" gorm:"not null;index:idx_recording_memory_claims_file;uniqueIndex:uniq_recording_memory_claim,priority:3"`
	MinutesHash        string   `json:"minutes_hash" gorm:"size:64;not null;uniqueIndex:uniq_recording_memory_claim,priority:4"`
	SourceItemType     string   `json:"source_item_type" gorm:"size:32;not null"`
	SourceItemID       string   `json:"source_item_id" gorm:"size:128;not null"`
	SourceKeyHash      string   `json:"-" gorm:"size:64;not null;uniqueIndex:uniq_recording_memory_claim,priority:5"`
	ClaimKind          string   `json:"claim_kind" gorm:"size:32;not null;index:idx_recording_memory_claims_scope,priority:3"`
	Content            LongText `json:"content" gorm:"not null"`
	DetailJSON         LongText `json:"detail_json" gorm:"type:text"`
	AssertionState     string   `json:"assertion_state" gorm:"size:32;not null;index"`
	EpistemicType      string   `json:"epistemic_type" gorm:"size:32;not null;index"`
	LifecycleState     string   `json:"lifecycle_state" gorm:"size:32;not null;index:idx_recording_memory_claims_scope,priority:4"`
	ReviewState        string   `json:"review_state" gorm:"size:32;not null;index:idx_recording_memory_claims_scope,priority:5"`
	SourceConfidence   float64  `json:"source_confidence" gorm:"not null;default:0"`
	EvidenceAvailable  bool     `json:"evidence_available" gorm:"not null;default:false;index"`
	SourceSegmentCount int      `json:"source_segment_count" gorm:"not null;default:0"`
	SourceSegmentIDs   LongText `json:"source_segment_ids" gorm:"type:text"`
	DueAt              int64    `json:"due_at" gorm:"not null;default:0;index"`
	IsCurrent          bool     `json:"is_current" gorm:"not null;default:true;index"`
	Version            int      `json:"version" gorm:"not null;default:1"`
	BaseModel
}

func (RecordingMemoryClaim) TableName() string {
	return "recording_memory_claims"
}
