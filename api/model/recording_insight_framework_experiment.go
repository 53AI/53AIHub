package model

import (
	"context"
	"errors"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// InsightFrameworkExperimentVariant 标识一次对照实验里使用的是哪套思考框架。
const (
	// InsightFrameworkVariantV1 是现有线上决策参谋框架（V1 System Prompt）。
	InsightFrameworkVariantV1 = "v1_baseline"
	// InsightFrameworkVariantV2 是第二大脑思考程序（V2 System Prompt）。
	InsightFrameworkVariantV2 = "v2_second_brain"
	// InsightFrameworkVariantV21 是加入证据护栏后的第二大脑（V2.1 System Prompt）。
	InsightFrameworkVariantV21 = "v2_1_evidence_guardrail"
	// InsightFrameworkVariantV2Frozen 是 Phase 3B1 对照实验里“冻结的 V2.0”变体名。
	// 用独立变体名可以让 Phase 3A（V1 vs V2）的既有实验结果保持完整，同时保证 V2.0/V2.1
	// 两次调用共享同一次准备出来的输入。
	InsightFrameworkVariantV2Frozen = "v2_second_brain_frozen_3b1"
	// InsightFrameworkVariantV21Control 是 Phase 5A 对照实验的 CONTROL：V2.1 baseline。
	InsightFrameworkVariantV21Control = "v21_baseline_control"
	// InsightFrameworkVariantV21TaxonomyRouter 是 Phase 5A 对照实验的 TREATMENT：V2.1 + Taxonomy Attention Router。
	InsightFrameworkVariantV21TaxonomyRouter = "v21_taxonomy_attention_router"
	// InsightFrameworkVariantV21Minimal 是 Phase 5B 对照实验的 TREATMENT：V2.1 + Minimal Taxonomy Context。
	InsightFrameworkVariantV21Minimal = "v21_minimal_taxonomy_context"
	// InsightFrameworkVariantV21GuardedMinimal 是 Phase 5C 对照实验的 TREATMENT：V2.1 + Guarded Minimal Taxonomy Context。
	InsightFrameworkVariantV21GuardedMinimal = "v21_guarded_minimal_taxonomy_context"
)

// RecordingInsightFrameworkExperiment 保存「同一份输入、两套思考框架」的严格对照实验结果。
// 两行共享 input/user_prompt/context/model/perspective，只有 system_prompt_hash 不同；
// 该表只服务评测，不参与任何生产读写路径。
type RecordingInsightFrameworkExperiment struct {
	ID                   int64    `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid                  int64    `json:"eid" gorm:"not null;uniqueIndex:uniq_recording_insight_framework_experiment,priority:1;index"`
	OwnerID              int64    `json:"owner_id" gorm:"not null;uniqueIndex:uniq_recording_insight_framework_experiment,priority:2;index"`
	FileID               int64    `json:"file_id" gorm:"not null;uniqueIndex:uniq_recording_insight_framework_experiment,priority:3;index"`
	InsightGeneration    int64    `json:"insight_generation" gorm:"not null;uniqueIndex:uniq_recording_insight_framework_experiment,priority:4"`
	Variant              string   `json:"variant" gorm:"size:64;not null;uniqueIndex:uniq_recording_insight_framework_experiment,priority:5"`
	Perspective          string   `json:"perspective" gorm:"size:32;not null;default:''"`
	ModelName            string   `json:"model_name" gorm:"size:128;not null;default:''"`
	SystemPromptHash     string   `json:"system_prompt_hash" gorm:"size:64;not null;default:''"`
	InputHash            string   `json:"input_hash" gorm:"size:64;not null;default:''"`
	UserPromptHash       string   `json:"user_prompt_hash" gorm:"size:64;not null;default:''"`
	ContextHash          string   `json:"context_hash" gorm:"size:64;not null;default:''"`
	Status               string   `json:"status" gorm:"size:16;not null;index"`
	Content              LongText `json:"content" gorm:"type:text"`
	ErrorMessage         string   `json:"error_message" gorm:"size:512;not null;default:''"`
	DurationMs           int64    `json:"duration_ms" gorm:"not null;default:0"`
	BaseModel
	// Phase 5A Attention Router 受控实验字段。
	BaseSystemPromptHash string `json:"base_system_prompt_hash" gorm:"size:64;not null;default:''"`
	BaseContextHash      string `json:"base_context_hash" gorm:"size:64;not null;default:''"`
	AttentionRouterHash      string `json:"attention_router_hash" gorm:"size:64;not null;default:''"`
	MinimalRouterHash        string `json:"minimal_router_hash" gorm:"size:64;not null;default:''"`
	GuardedMinimalRouterHash string `json:"guarded_minimal_router_hash" gorm:"size:64;not null;default:''"`
	TaxonomyVersion          string `json:"taxonomy_version" gorm:"size:48;not null;default:''"`
	TaxonomyResultHash       string `json:"taxonomy_result_hash" gorm:"size:64;not null;default:''"`
}

func (RecordingInsightFrameworkExperiment) TableName() string {
	return "recording_insight_framework_experiments"
}

// UpsertRecordingInsightFrameworkExperiment 按 (eid, owner, file, generation, variant) 幂等写入。
func UpsertRecordingInsightFrameworkExperiment(ctx context.Context, row *RecordingInsightFrameworkExperiment) error {
	if row == nil {
		return errors.New("insight framework experiment row is nil")
	}
	return DB.WithContext(ctx).Clauses(clause.OnConflict{
		Columns: []clause.Column{
			{Name: "eid"}, {Name: "owner_id"}, {Name: "file_id"}, {Name: "insight_generation"}, {Name: "variant"},
		},
		DoUpdates: clause.AssignmentColumns([]string{
			"perspective", "model_name", "system_prompt_hash", "input_hash", "user_prompt_hash", "context_hash",
			"status", "content", "error_message", "duration_ms", "updated_time",
			"base_system_prompt_hash", "base_context_hash", "attention_router_hash", "minimal_router_hash", "guarded_minimal_router_hash", "taxonomy_version", "taxonomy_result_hash",
		}),
	}).Create(row).Error
}

// GetRecordingInsightFrameworkExperiment 读取某个 file/generation 下指定 variant 的结果。
func GetRecordingInsightFrameworkExperiment(ctx context.Context, eid, fileID, generation int64, variant string) (*RecordingInsightFrameworkExperiment, error) {
	var row RecordingInsightFrameworkExperiment
	err := DB.WithContext(ctx).Where("eid = ? AND file_id = ? AND insight_generation = ? AND variant = ?", eid, fileID, generation, variant).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &row, nil
}

// ListRecordingInsightFrameworkExperiments 读取某个 file/generation 下的全部 variant 结果。
func ListRecordingInsightFrameworkExperiments(ctx context.Context, eid, fileID, generation int64) ([]*RecordingInsightFrameworkExperiment, error) {
	var rows []*RecordingInsightFrameworkExperiment
	if err := DB.WithContext(ctx).Where("eid = ? AND file_id = ? AND insight_generation = ?", eid, fileID, generation).Order("variant asc").Find(&rows).Error; err != nil {
		return nil, err
	}
	return rows, nil
}
