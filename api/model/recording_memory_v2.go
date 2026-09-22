package model

// RecordingMemoryV2Shadow 保存现有会议记忆映射成 Graphiti-compatible temporal
// projection 的 shadow 快照。它不是第二个事实源，正式记忆仍以 claims/entities/facts
// 为准；快照只用于召回对照和回滚审计。
type RecordingMemoryV2Shadow struct {
	ID                  int64    `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid                 int64    `json:"eid" gorm:"not null;uniqueIndex:uniq_recording_memory_v2_shadow,priority:1;index"`
	OwnerID             int64    `json:"owner_id" gorm:"not null;uniqueIndex:uniq_recording_memory_v2_shadow,priority:2;index"`
	FileID              int64    `json:"file_id" gorm:"not null;uniqueIndex:uniq_recording_memory_v2_shadow,priority:3;index"`
	SourceHash          string   `json:"source_hash" gorm:"size:64;not null;uniqueIndex:uniq_recording_memory_v2_shadow,priority:4"`
	ProjectionVersion   string   `json:"projection_version" gorm:"size:32;not null"`
	ProjectionJSON      LongText `json:"projection" gorm:"type:text;not null"`
	PermissionScopeJSON LongText `json:"permission_scope" gorm:"type:text;not null"`
	NodeCount           int      `json:"node_count" gorm:"not null;default:0"`
	EdgeCount           int      `json:"edge_count" gorm:"not null;default:0"`
	Status              string   `json:"status" gorm:"size:16;not null;index"`
	BaseModel
}

func (RecordingMemoryV2Shadow) TableName() string {
	return "recording_memory_v2_shadows"
}

// RecordingMemoryV2Evaluation 保存一次当前结构化记忆与 V2 shadow 召回对照。
// 结果用于评估和灰度门禁，不能直接改变洞察主召回链路。
type RecordingMemoryV2Evaluation struct {
	ID                    int64    `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid                   int64    `json:"eid" gorm:"not null;index:idx_recording_memory_v2_eval_scope,priority:1"`
	OwnerID               int64    `json:"owner_id" gorm:"not null;index:idx_recording_memory_v2_eval_scope,priority:2"`
	FileID                int64    `json:"file_id" gorm:"not null;index:idx_recording_memory_v2_eval_scope,priority:3"`
	InsightGeneration     int64    `json:"insight_generation" gorm:"not null;index"`
	QueryHash             string   `json:"query_hash" gorm:"size:64;not null;index"`
	ProjectionVersion     string   `json:"projection_version" gorm:"size:32;not null"`
	BaselineCount         int      `json:"baseline_count" gorm:"not null;default:0"`
	V2Count               int      `json:"v2_count" gorm:"not null;default:0"`
	OverlapCount          int      `json:"overlap_count" gorm:"not null;default:0"`
	BaselineOnlyCount     int      `json:"baseline_only_count" gorm:"not null;default:0"`
	V2OnlyCount           int      `json:"v2_only_count" gorm:"not null;default:0"`
	BaselineEvidenceCount int      `json:"baseline_evidence_count" gorm:"not null;default:0"`
	V2EvidenceCount       int      `json:"v2_evidence_count" gorm:"not null;default:0"`
	DurationMs            int64    `json:"duration_ms" gorm:"not null;default:0"`
	ResultJSON            LongText `json:"result" gorm:"type:text;not null"`
	Status                string   `json:"status" gorm:"size:16;not null;index"`
	BaseModel
}

func (RecordingMemoryV2Evaluation) TableName() string {
	return "recording_memory_v2_evaluations"
}
