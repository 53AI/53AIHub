package model

import (
	"context"
	"errors"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// RecordingTaxonomyV2Shadow 保存 Taxonomy V2（现场类型 × 参与角色 × 参与目的 × 判断任务）Shadow 结果。
// 它只服务评测与人工评审：不写入 files.insight_perspective，不参与任何生产读写路径，
// 也不注入 V2.1 Second Brain Prompt。
type RecordingTaxonomyV2Shadow struct {
	ID                int64 `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid               int64 `json:"eid" gorm:"not null;uniqueIndex:uniq_recording_taxonomy_v2_shadow_variant,priority:1;index"`
	OwnerID           int64 `json:"owner_id" gorm:"not null;uniqueIndex:uniq_recording_taxonomy_v2_shadow_variant,priority:2;index"`
	FileID            int64 `json:"file_id" gorm:"not null;uniqueIndex:uniq_recording_taxonomy_v2_shadow_variant,priority:3;index"`
	InsightGeneration int64 `json:"insight_generation" gorm:"not null;uniqueIndex:uniq_recording_taxonomy_v2_shadow_variant,priority:4"`
	// Variant 区分同一提示词家族的不同版本（taxonomy_shadow_v1 / taxonomy_shadow_v2）。
	Variant         string  `json:"variant" gorm:"size:32;not null;uniqueIndex:uniq_recording_taxonomy_v2_shadow_variant,priority:5"`
	SceneType       string  `json:"scene_type" gorm:"size:48;not null;default:''"`
	SceneConfidence float64 `json:"scene_confidence" gorm:"not null;default:0"`
	// SceneSubtype 是自由 snake_case 子类型（Phase 4B 只保存，不参与路由）。
	SceneSubtype           string  `json:"scene_subtype" gorm:"size:64;not null;default:''"`
	SceneSubtypeConfidence float64 `json:"scene_subtype_confidence" gorm:"not null;default:0"`
	ParticipationRole      string  `json:"participation_role" gorm:"size:48;not null;default:''"`
	// AuthorityLevelJSON 保存 Phase 4C 新增的“决策权限”维度（与现场角色正交）。
	AuthorityLevelJSON LongText `json:"authority_level" gorm:"type:text"`
	SecondaryRolesJSON LongText `json:"secondary_roles" gorm:"type:text"`
	IntentTagsJSON     LongText `json:"intent_tags" gorm:"type:text"`
	DecisionTasksJSON  LongText `json:"decision_tasks" gorm:"type:text"`
	TopicTagsJSON      LongText `json:"topic_tags" gorm:"type:text"`
	EntityLinksJSON    LongText `json:"entity_links" gorm:"type:text"`
	AmbiguityJSON      LongText `json:"ambiguity" gorm:"type:text"`
	// ResultJSON 保存完整解析结果（含 scene 证据、authority、相关性等），供 Freeze 审计与复盘使用。
	ResultJSON    LongText `json:"result" gorm:"type:text"`
	ModelName     string   `json:"model_name" gorm:"size:128;not null;default:''"`
	PromptVersion string   `json:"prompt_version" gorm:"size:32;not null;default:''"`
	PromptHash    string   `json:"prompt_hash" gorm:"size:64;not null;default:''"`
	Status        string   `json:"status" gorm:"size:16;not null;index"`
	ErrorMessage  string   `json:"error_message" gorm:"size:512;not null;default:''"`
	DurationMs    int64    `json:"duration_ms" gorm:"not null;default:0"`
	BaseModel
}

func (RecordingTaxonomyV2Shadow) TableName() string {
	return "recording_taxonomy_v2_shadows"
}

// UpsertRecordingTaxonomyV2Shadow 按 (eid, owner, file, generation) 幂等写入。
func UpsertRecordingTaxonomyV2Shadow(ctx context.Context, row *RecordingTaxonomyV2Shadow) error {
	if row == nil {
		return errors.New("taxonomy v2 shadow row is nil")
	}
	return DB.WithContext(ctx).Clauses(clause.OnConflict{
		Columns: []clause.Column{
			{Name: "eid"}, {Name: "owner_id"}, {Name: "file_id"}, {Name: "insight_generation"}, {Name: "variant"},
		},
		DoUpdates: clause.AssignmentColumns([]string{
			"scene_type", "scene_confidence", "scene_subtype", "scene_subtype_confidence",
			"participation_role", "authority_level_json", "secondary_roles_json", "intent_tags_json",
			"decision_tasks_json", "topic_tags_json", "entity_links_json", "ambiguity_json", "result_json",
			"model_name", "prompt_version", "prompt_hash", "status", "error_message", "duration_ms", "updated_time",
		}),
	}).Create(row).Error
}

// GetRecordingTaxonomyV2Shadow 读取指定 generation + variant 的 Taxonomy V2 Shadow；不存在时返回 (nil, nil)。
func GetRecordingTaxonomyV2Shadow(ctx context.Context, eid, fileID, generation int64, variant string) (*RecordingTaxonomyV2Shadow, error) {
	var row RecordingTaxonomyV2Shadow
	query := DB.WithContext(ctx).Where("eid = ? AND file_id = ? AND insight_generation = ?", eid, fileID, generation)
	if variant != "" {
		query = query.Where("variant = ?", variant)
	}
	err := query.Order("id asc").First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &row, nil
}
