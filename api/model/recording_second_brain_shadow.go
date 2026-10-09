package model

import (
	"context"
	"errors"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// RecordingSecondBrainShadow 保存「二号总裁第二大脑 V2」在 Shadow 通道产出的 Markdown。
// 它不是第二个洞察事实源：正式结果仍以 files.insight_summary + recording_file_insight_page 为准，
// shadow 只用于同输入下的 V1/V2 判断质量对照与回滚审计。
type RecordingSecondBrainShadow struct {
	ID                int64    `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid               int64    `json:"eid" gorm:"not null;uniqueIndex:uniq_recording_second_brain_shadow,priority:1;index"`
	OwnerID           int64    `json:"owner_id" gorm:"not null;uniqueIndex:uniq_recording_second_brain_shadow,priority:2;index"`
	FileID            int64    `json:"file_id" gorm:"not null;uniqueIndex:uniq_recording_second_brain_shadow,priority:3;index"`
	InsightGeneration int64    `json:"insight_generation" gorm:"not null;uniqueIndex:uniq_recording_second_brain_shadow,priority:4"`
	Perspective       string   `json:"perspective" gorm:"size:32;not null;default:''"`
	PromptVersion     string   `json:"prompt_version" gorm:"size:32;not null;default:''"`
	PromptHash        string   `json:"prompt_hash" gorm:"size:64;not null;default:''"`
	ModelName         string   `json:"model_name" gorm:"size:128;not null;default:''"`
	Status            string   `json:"status" gorm:"size:16;not null;index"`
	Content           LongText `json:"content" gorm:"type:text"`
	ErrorMessage      string   `json:"error_message" gorm:"size:512;not null;default:''"`
	DurationMs        int64    `json:"duration_ms" gorm:"not null;default:0"`
	BaseModel
}

func (RecordingSecondBrainShadow) TableName() string {
	return "recording_second_brain_shadows"
}

// UpsertRecordingSecondBrainShadow 按 (eid, owner, file, generation) 幂等写入；
// 同一 generation 的重复执行不会产生第二行，也不会覆盖更新的 generation。
func UpsertRecordingSecondBrainShadow(ctx context.Context, row *RecordingSecondBrainShadow) error {
	if row == nil {
		return errors.New("recording second brain shadow is nil")
	}
	return DB.WithContext(ctx).Clauses(clause.OnConflict{
		Columns: []clause.Column{
			{Name: "eid"}, {Name: "owner_id"}, {Name: "file_id"}, {Name: "insight_generation"},
		},
		DoUpdates: clause.AssignmentColumns([]string{
			"perspective", "prompt_version", "prompt_hash", "model_name", "status", "content", "error_message", "duration_ms", "updated_time",
		}),
	}).Create(row).Error
}

// GetRecordingSecondBrainShadow 读取指定 generation 的 shadow 结果；不存在时返回 (nil, nil)。
func GetRecordingSecondBrainShadow(ctx context.Context, eid, fileID, generation int64) (*RecordingSecondBrainShadow, error) {
	var row RecordingSecondBrainShadow
	err := DB.WithContext(ctx).Where("eid = ? AND file_id = ? AND insight_generation = ?", eid, fileID, generation).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &row, nil
}

// GetLatestRecordingSecondBrainShadow 读取最新一次 generation 的 shadow 结果；不存在时返回 (nil, nil)。
func GetLatestRecordingSecondBrainShadow(ctx context.Context, eid, fileID int64) (*RecordingSecondBrainShadow, error) {
	var row RecordingSecondBrainShadow
	err := DB.WithContext(ctx).Where("eid = ? AND file_id = ?", eid, fileID).Order("insight_generation desc, id desc").First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &row, nil
}
