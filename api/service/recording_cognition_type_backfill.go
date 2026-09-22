package service

import (
	"context"
	"strings"

	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

// 存量认知类型修复，包含两步：
//  1. 回填：旧版本把 7 类规范值写在遗留列 canonical_type，重构后系统只读 cognition_type，
//     于是这部分存量在列表、筛选与统计里"数据在库、系统看不见"；
//  2. 老类型归一：早期枚举（red_line 等）此前只对正式表做过归一，候选表与审计版本表仍残留。
//
// 两步都只改类型字段，不删行、不改状态与领域归属，因此可重复执行（幂等）。

// RecordingCognitionTypeBackfillScope 限定修复范围；零值字段表示不限制。
// 建议先用 (eid, owner_id, layer) 小范围验证，确认后再放开为全量。
type RecordingCognitionTypeBackfillScope struct {
	Eid     int64
	OwnerID int64
	Layer   string
}

// RecordingCognitionTypeBackfillPreview 是存量类型修复的影响面（幂等：执行后再预览应为全 0）。
type RecordingCognitionTypeBackfillPreview struct {
	Cognitions           int64 `json:"cognitions"`
	Candidates           int64 `json:"candidates"`
	Versions             int64 `json:"versions"`
	NormalizedCognitions int64 `json:"normalized_cognitions"`
	NormalizedCandidates int64 `json:"normalized_candidates"`
	NormalizedVersions   int64 `json:"normalized_versions"`
}

// Affected 返回受影响总行数。
func (p *RecordingCognitionTypeBackfillPreview) Affected() int64 {
	return p.Cognitions + p.Candidates + p.Versions + p.NormalizedCognitions + p.NormalizedCandidates + p.NormalizedVersions
}

// recordingCognitionLegacyTypeMappings 早期枚举到 7 类规范的平滑映射，与 InitDefaultDomainsAndHealHistoryData 保持一致。
var recordingCognitionLegacyTypeMappings = []struct {
	Legacy []string
	Target string
}{
	{[]string{"red_line"}, RecordingCognitionTypeBoundary},
	{[]string{"risk_preference", "decision_style"}, RecordingCognitionTypePreference},
}

func applyRecordingCognitionTypeBackfillScope(query *gorm.DB, scope RecordingCognitionTypeBackfillScope) *gorm.DB {
	if scope.Eid > 0 {
		query = query.Where("eid = ?", scope.Eid)
	}
	if scope.OwnerID > 0 {
		query = query.Where("owner_id = ?", scope.OwnerID)
	}
	if layer := strings.TrimSpace(scope.Layer); layer != "" {
		query = query.Where("layer = ?", layer)
	}
	return query
}

// PreviewRecordingCognitionTypeBackfill 只读预览存量类型修复的影响面，不写库。
func PreviewRecordingCognitionTypeBackfill(ctx context.Context, db *gorm.DB, scope RecordingCognitionTypeBackfillScope) (*RecordingCognitionTypeBackfillPreview, error) {
	return recordingCognitionTypeBackfill(ctx, db, scope, false)
}

// BackfillRecordingCognitionType 执行存量类型修复（仅补空值 + 老类型归一，幂等）。
// 认知、候选与审计版本三张表同规则；返回本次实际影响行数，再次执行应为全 0。
func BackfillRecordingCognitionType(ctx context.Context, db *gorm.DB, scope RecordingCognitionTypeBackfillScope) (*RecordingCognitionTypeBackfillPreview, error) {
	return recordingCognitionTypeBackfill(ctx, db, scope, true)
}

func recordingCognitionTypeBackfill(ctx context.Context, db *gorm.DB, scope RecordingCognitionTypeBackfillScope, apply bool) (*RecordingCognitionTypeBackfillPreview, error) {
	if db == nil {
		db = model.DB
	}
	preview := &RecordingCognitionTypeBackfillPreview{}
	if db == nil {
		return preview, nil
	}
	targets := []struct {
		table      interface{}
		backfilled *int64
		normalized *int64
	}{
		{&model.RecordingCognition{}, &preview.Cognitions, &preview.NormalizedCognitions},
		{&model.RecordingCognitionCandidate{}, &preview.Candidates, &preview.NormalizedCandidates},
		{&model.RecordingCognitionVersion{}, &preview.Versions, &preview.NormalizedVersions},
	}
	for _, target := range targets {
		if !db.Migrator().HasTable(target.table) {
			continue
		}
		// 遗留列只存在于升级上来的库；全新建库没有该列，跳过回填但仍可做老类型归一。
		if db.Migrator().HasColumn(target.table, "canonical_type") {
			query := applyRecordingCognitionTypeBackfillScope(
				db.WithContext(ctx).Model(target.table).
					Where("(cognition_type IS NULL OR cognition_type = '')").
					Where("canonical_type IN ?", recordingCognitionTypes()), scope)
			if !apply {
				if err := query.Count(target.backfilled).Error; err != nil {
					return nil, err
				}
			} else {
				result := query.UpdateColumns(map[string]interface{}{"cognition_type": gorm.Expr("canonical_type")})
				if result.Error != nil {
					return nil, result.Error
				}
				*target.backfilled = result.RowsAffected
			}
		}
		for _, mapping := range recordingCognitionLegacyTypeMappings {
			query := applyRecordingCognitionTypeBackfillScope(
				db.WithContext(ctx).Model(target.table).Where("cognition_type IN ?", mapping.Legacy), scope)
			if !apply {
				var count int64
				if err := query.Count(&count).Error; err != nil {
					return nil, err
				}
				*target.normalized += count
				continue
			}
			// UpdateColumns 跳过 BeforeUpdate：字段修复不应把存量行的 updated_time 顶到最新，
			// 否则列表按更新时间排序会把这批老数据全部翻到最前。
			result := query.UpdateColumns(map[string]interface{}{"cognition_type": mapping.Target})
			if result.Error != nil {
				return nil, result.Error
			}
			*target.normalized += result.RowsAffected
		}
	}
	return preview, nil
}
