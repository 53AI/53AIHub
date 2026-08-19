package model

// RecordingMemoryEntity 是安心录决策洞察专属的实体档案。
// 它不复用通用 entities 表，避免会议属性污染 RAG 与知识图谱。
type RecordingMemoryEntity struct {
	ID            int64  `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid           int64  `json:"eid" gorm:"not null;uniqueIndex:uniq_recording_memory_entity,priority:1;index:idx_recording_memory_entity_scope,priority:1"`
	OwnerID       int64  `json:"owner_id" gorm:"not null;uniqueIndex:uniq_recording_memory_entity,priority:2;index:idx_recording_memory_entity_scope,priority:2"`
	EntityType    string `json:"entity_type" gorm:"size:32;not null;uniqueIndex:uniq_recording_memory_entity,priority:3;index:idx_recording_memory_entity_scope,priority:3"`
	CanonicalName string `json:"canonical_name" gorm:"size:255;not null"`
	// NormalizedName stores the SHA-256 hash of the normalized display name.
	// It is used only as the final column of the composite uniqueness key. Keeping
	// it fixed-width makes the key compatible with legacy MySQL utf8mb4's 767-byte
	// index limit while avoiding collisions introduced by name truncation.
	// NormalizedName 可空：已删除/已融合的行置 NULL 释放名字（唯一索引对 NULL 不冲突），
	// 从而允许"已删同名与新卡共存"，融合只影响历史。
	NormalizedName   string   `json:"-" gorm:"size:64;uniqueIndex:uniq_recording_memory_entity,priority:4"`
	Summary          LongText `json:"summary" gorm:"type:text"`
	AttributesJSON   LongText `json:"attributes" gorm:"type:text"`
	AliasesJSON      LongText `json:"aliases" gorm:"type:text"`
	SummarySource    string   `json:"summary_source" gorm:"size:16;not null;default:'automatic'"`
	AttributesSource string   `json:"attributes_source" gorm:"size:16;not null;default:'automatic'"`
	FirstMentionedAt int64    `json:"first_mentioned_at" gorm:"not null;default:0;index"`
	LastFactAt       int64    `json:"last_fact_at" gorm:"not null;default:0;index:idx_recording_memory_entity_scope,priority:4"`
	FactCount        int64    `json:"fact_count" gorm:"not null;default:0"`
	MergedIntoID     int64    `json:"merged_into_id" gorm:"not null;default:0;index"`
	IsDeleted        bool     `json:"is_deleted" gorm:"not null;default:false;index:idx_recording_memory_entity_scope,priority:5"`
	BaseModel
}

func (RecordingMemoryEntity) TableName() string {
	return "recording_memory_entities"
}

// RecordingMemoryFact 是一条可追溯的会议事实；自动事实不覆盖人工修正。
type RecordingMemoryFact struct {
	ID               int64    `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid              int64    `json:"eid" gorm:"not null;index:idx_recording_memory_fact_scope,priority:1;uniqueIndex:uniq_recording_memory_fact_source,priority:1"`
	OwnerID          int64    `json:"owner_id" gorm:"not null;index:idx_recording_memory_fact_scope,priority:2;uniqueIndex:uniq_recording_memory_fact_source,priority:2"`
	EntityID         int64    `json:"entity_id" gorm:"not null;index:idx_recording_memory_fact_scope,priority:3;index"`
	FileID           int64    `json:"file_id" gorm:"not null;index;uniqueIndex:uniq_recording_memory_fact_source,priority:3"`
	SourceKey        string   `json:"-" gorm:"size:64;not null;uniqueIndex:uniq_recording_memory_fact_source,priority:4"`
	FactKind         string   `json:"fact_kind" gorm:"size:32;not null;index"`
	Content          LongText `json:"content" gorm:"not null"`
	AttributesJSON   LongText `json:"attributes" gorm:"type:text"`
	SourceSegmentIDs LongText `json:"source_segment_ids" gorm:"type:text"`
	SourceType       string   `json:"source_type" gorm:"size:16;not null;default:'automatic'"`
	OccurredAt       int64    `json:"occurred_at" gorm:"not null;default:0;index:idx_recording_memory_fact_scope,priority:4"`
	IsDeleted        bool     `json:"is_deleted" gorm:"not null;default:false;index:idx_recording_memory_fact_scope,priority:5"`
	BaseModel
}

func (RecordingMemoryFact) TableName() string {
	return "recording_memory_facts"
}

// RecordingMemoryEntityRelation 仅表示安心录实体之间的人工关联。
type RecordingMemoryEntityRelation struct {
	ID              int64  `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid             int64  `json:"eid" gorm:"not null;uniqueIndex:uniq_recording_memory_entity_relation,priority:1;index"`
	OwnerID         int64  `json:"owner_id" gorm:"not null;uniqueIndex:uniq_recording_memory_entity_relation,priority:2;index"`
	EntityID        int64  `json:"entity_id" gorm:"not null;uniqueIndex:uniq_recording_memory_entity_relation,priority:3;index"`
	RelatedEntityID int64  `json:"related_entity_id" gorm:"not null;uniqueIndex:uniq_recording_memory_entity_relation,priority:4;index"`
	RelationType    string `json:"relation_type" gorm:"size:32;not null;default:'related'"`
	BaseModel
}

func (RecordingMemoryEntityRelation) TableName() string {
	return "recording_memory_entity_relations"
}
