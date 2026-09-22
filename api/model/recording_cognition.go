package model

// RecordingCognition 是安心录域内老板认知注册表中的当前版本。
// 认知不是机器规则；它必须有适用范围、状态、来源和可追溯版本。
// 认知类型收敛到 CognitionType 单一字段，支持新 7 类规范。
type RecordingCognition struct {
	ID               int64    `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid              int64    `json:"eid" gorm:"not null;index:idx_recording_cognition_scope,priority:1"`
	OwnerID          int64    `json:"owner_id" gorm:"not null;index:idx_recording_cognition_scope,priority:2"`
	Title            string   `json:"title" gorm:"size:255;not null"`
	Statement        LongText `json:"statement" gorm:"not null"`
	CognitionType    string   `json:"cognition_type" gorm:"size:32;not null;index:idx_recording_cognition_scope,priority:3"`
	Layer            string   `json:"layer" gorm:"size:16;not null;index:idx_recording_cognition_scope,priority:4"`
	DomainID         int64    `json:"domain_id" gorm:"not null;default:0;index"`
	DomainCode       string   `json:"domain_code,omitempty" gorm:"size:64;index"` // 保留用于存量历史数据自愈映射
	ScopeJSON        LongText `json:"scope" gorm:"type:text"`
	Status           string   `json:"status" gorm:"size:16;not null;index:idx_recording_cognition_scope,priority:5"`
	SourceType       string   `json:"source_type" gorm:"size:32;not null"`
	Confidence       float64  `json:"confidence" gorm:"not null;default:0"`
	ValidFrom        int64    `json:"valid_from" gorm:"not null;default:0;index"`
	ValidUntil       int64    `json:"valid_until" gorm:"not null;default:0;index"`
	CurrentVersion   int      `json:"current_version" gorm:"not null;default:1"`
	EvidenceRefsJSON LongText `json:"evidence_refs" gorm:"type:text"`
	ConflictRefsJSON LongText `json:"conflict_refs" gorm:"type:text"`
	CreatedBy        int64    `json:"created_by" gorm:"not null;default:0"`
	ConfirmedBy      int64    `json:"confirmed_by" gorm:"not null;default:0"`
	ConfirmedAt      int64    `json:"confirmed_at" gorm:"not null;default:0"`
	BaseModel
}

func (RecordingCognition) TableName() string {
	return "recording_cognitions"
}

// RecordingCognitionVersion 保存认知每次形成、修改、确认或失效的审计版本。
type RecordingCognitionVersion struct {
	ID               int64    `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid              int64    `json:"eid" gorm:"not null;index:idx_recording_cognition_version_scope,priority:1"`
	OwnerID          int64    `json:"owner_id" gorm:"not null;index:idx_recording_cognition_version_scope,priority:2"`
	CognitionID      int64    `json:"cognition_id" gorm:"not null;uniqueIndex:uniq_recording_cognition_version,priority:1;index"`
	Version          int      `json:"version" gorm:"not null;uniqueIndex:uniq_recording_cognition_version,priority:2"`
	Title            string   `json:"title" gorm:"size:255;not null"`
	Statement        LongText `json:"statement" gorm:"not null"`
	CognitionType    string   `json:"cognition_type" gorm:"size:32;not null"`
	Layer            string   `json:"layer" gorm:"size:16;not null"`
	DomainID         int64    `json:"domain_id" gorm:"not null;default:0;index"`
	DomainCode       string   `json:"domain_code,omitempty" gorm:"size:64;index"`
	ScopeJSON        LongText `json:"scope" gorm:"type:text"`
	ChangeType       string   `json:"change_type" gorm:"size:32;not null"`
	SourceType       string   `json:"source_type" gorm:"size:32;not null"`
	SourceFileID     int64    `json:"source_file_id" gorm:"not null;default:0;index"`
	SourceSegmentIDs LongText `json:"source_segment_ids" gorm:"type:text"`
	EvidenceRefsJSON LongText `json:"evidence_refs" gorm:"type:text"`
	ActorID          int64    `json:"actor_id" gorm:"not null;default:0"`
	CreatedAtUnix    int64    `json:"created_at_unix" gorm:"not null;index"`
	BaseModel
}

func (RecordingCognitionVersion) TableName() string {
	return "recording_cognition_versions"
}

// RecordingCognitionCandidate 是从当前会议中发现、等待老板校准的候选认知。
// 候选可以被丢弃，但不能在确认前直接作为长期认知使用。
type RecordingCognitionCandidate struct {
	ID                int64    `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid               int64    `json:"eid" gorm:"not null;uniqueIndex:uniq_recording_cognition_candidate,priority:1;index"`
	OwnerID           int64    `json:"owner_id" gorm:"not null;uniqueIndex:uniq_recording_cognition_candidate,priority:2;index"`
	FileID            int64    `json:"file_id" gorm:"not null;uniqueIndex:uniq_recording_cognition_candidate,priority:3;index"`
	MinutesHash       string   `json:"minutes_hash" gorm:"size:64;not null;uniqueIndex:uniq_recording_cognition_candidate,priority:4"`
	SourceKeyHash     string   `json:"-" gorm:"size:64;not null;uniqueIndex:uniq_recording_cognition_candidate,priority:5"`
	Title             string   `json:"title" gorm:"size:255;not null"`
	Statement         LongText `json:"statement" gorm:"not null"`
	CognitionType     string   `json:"cognition_type" gorm:"size:32;not null;index"`
	Layer             string   `json:"layer" gorm:"size:16;not null;index"`
	DomainID          int64    `json:"domain_id" gorm:"not null;default:0;index"`
	DomainCode        string   `json:"domain_code,omitempty" gorm:"size:64;index"`
	ScopeJSON         LongText `json:"scope" gorm:"type:text"`
	SourceType        string   `json:"source_type" gorm:"size:32;not null"`
	Confidence        float64  `json:"confidence" gorm:"not null;default:0"`
	SourceFileID      int64    `json:"source_file_id" gorm:"not null;index"`
	SourceSegmentIDs  LongText `json:"source_segment_ids" gorm:"type:text"`
	Status            string   `json:"status" gorm:"size:16;not null;index"`
	ReviewReason      LongText `json:"review_reason" gorm:"type:text"`
	TargetCognitionID int64    `json:"target_cognition_id" gorm:"not null;default:0;index"`
	ReviewedBy        int64    `json:"reviewed_by" gorm:"not null;default:0"`
	ReviewedAt        int64    `json:"reviewed_at" gorm:"not null;default:0"`
	BaseModel
}

func (RecordingCognitionCandidate) TableName() string {
	return "recording_cognition_candidates"
}

// RecordingCognitionExternalEvidence 保存外部导入候选的来源元数据。
// 外部数据只能作为候选进入校准流程，不能绕过老板确认直接写入认知注册表。
type RecordingCognitionExternalEvidence struct {
	ID               int64    `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid              int64    `json:"eid" gorm:"not null;index"`
	OwnerID          int64    `json:"owner_id" gorm:"not null;index"`
	CandidateID      int64    `json:"candidate_id" gorm:"not null;uniqueIndex"`
	ExternalSource   string   `json:"external_source" gorm:"size:64;not null;index"`
	ExternalRef      string   `json:"external_ref" gorm:"size:255;not null;index"`
	ObservedAt       int64    `json:"observed_at" gorm:"not null;default:0;index"`
	EvidenceRefsJSON LongText `json:"evidence_refs" gorm:"type:text"`
	PayloadHash      string   `json:"payload_hash" gorm:"size:64;not null;index"`
	BaseModel
}

func (RecordingCognitionExternalEvidence) TableName() string {
	return "recording_cognition_external_evidence"
}
