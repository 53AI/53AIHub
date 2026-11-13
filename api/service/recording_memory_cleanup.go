package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/53AI/53AIHub/model"
)

// RecordingSpeakerFactCleanupCandidate 仅表示源转写可核对的旧自动 speaker 事实；不含人工事实。
// UpdatedTime 供清理任务做乐观校验，避免预览后覆盖新修改。
type RecordingSpeakerFactCleanupCandidate struct {
	FactID      int64  `json:"fact_id"`
	EntityID    int64  `json:"entity_id"`
	SourceKey   string `json:"source_key"`
	Content     string `json:"content"`
	UpdatedTime int64  `json:"updated_time"`
	Reason      string `json:"reason"`
	SourceTime  string `json:"source_time"`
	EntityName  string `json:"entity_name"`
}

// RecordingSpeakerFactCleanupPreview 是纯只读分析结果；Uncovered 为需显式开启才能清理的原始发言。
type RecordingSpeakerFactCleanupPreview struct {
	FileID     int64                                  `json:"file_id"`
	SourceHash string                                 `json:"source_hash"`
	Selected   []RecordingSpeakerFactCleanupCandidate `json:"selected"`
	Uncovered  []RecordingSpeakerFactCleanupCandidate `json:"uncovered"`
	Skipped    string                                 `json:"skipped,omitempty"`
}

// RecordingSpeakerCleanupSourceHash 固定源转写及当前纪要版本，避免预览后纪要更换仍执行旧计划。
func RecordingSpeakerCleanupSourceHash(eid, fileID int64) (string, error) {
	md, err := loadRecordingEntityMemoryTranscript(eid, fileID)
	if err != nil {
		return "", err
	}
	minutesRaw, _, err := loadRecordingEntityMemorySource(eid, fileID)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256([]byte(md + "\x00" + minutesRaw))
	return hex.EncodeToString(sum[:]), nil
}

// PreviewRecordingSpeakerFactCleanup 不重新调用 LLM，也不修改任何实体、属性、关联或事实。
// 只有内容与时间戳均匹配转写原文的具名说话人自动 extracted 事实才可能入选。
// 对不能确认有结构化语义替代的原始经营表述，默认仅报告，不参与执行。
func PreviewRecordingSpeakerFactCleanup(ctx context.Context, eid, ownerID, fileID int64, includeUncovered bool) (RecordingSpeakerFactCleanupPreview, error) {
	out := RecordingSpeakerFactCleanupPreview{FileID: fileID}
	file, err := loadRecordingMemorySourceFile(ctx, eid, fileID)
	if err != nil {
		return out, err
	}
	if file.UserID != ownerID || !file.IsRecordingOriginType() {
		out.Skipped = "非该用户录音"
		return out, nil
	}
	md, err := loadRecordingEntityMemoryTranscript(eid, fileID)
	if err != nil {
		return out, err
	}
	utterances := parseTranscriptMarkdown(md)
	if len(utterances) == 0 {
		out.Skipped = "缺少可匹配的转写"
		return out, nil
	}
	// 结构化纪要存在时只借用已经产出的内容，不在清理任务里触发抽取或同名实体融合。
	minutesRaw, hasMinutes, err := loadRecordingEntityMemorySource(eid, fileID)
	if err != nil {
		out.Skipped = "已有纪要格式异常"
		return out, nil
	}
	sum := sha256.Sum256([]byte(md + "\x00" + minutesRaw))
	out.SourceHash = hex.EncodeToString(sum[:])
	semantic := map[string]map[string]bool{}
	if hasMinutes {
		minutes, err := parseRecordingMemoryMinutes(minutesRaw)
		if err != nil {
			out.Skipped = "已有纪要无法解析"
			return out, nil
		}
		allowed := map[string]bool{"person": true, "company": true, "matter": true, "risk": true, "decision": true, "commitment": true}
		for _, item := range buildRecordingEntityMemoryItems(minutes, allowed) {
			if item.entityType != "person" {
				continue
			}
			if semantic[item.canonicalName] == nil {
				semantic[item.canonicalName] = map[string]bool{}
			}
			for _, fact := range item.facts {
				semantic[item.canonicalName][strings.TrimSpace(fact.content)] = true
			}
		}
	}
	var facts []model.RecordingMemoryFact
	if err := model.DB.WithContext(ctx).Where(
		"eid = ? AND owner_id = ? AND file_id = ? AND source_type = ? AND fact_kind = ? AND is_deleted = ?",
		eid, ownerID, fileID, recordingEntityMemorySourceAutomatic, recordingEntityMemoryFactExtracted, false,
	).Order("id ASC").Find(&facts).Error; err != nil {
		return out, err
	}
	if len(facts) == 0 {
		return out, nil
	}
	entityIDs := make([]int64, 0, len(facts))
	for _, f := range facts {
		entityIDs = append(entityIDs, f.EntityID)
	}
	var entities []model.RecordingMemoryEntity
	if err := model.DB.WithContext(ctx).Where("eid = ? AND owner_id = ? AND id IN ?", eid, ownerID, entityIDs).Find(&entities).Error; err != nil {
		return out, err
	}
	names := map[int64]string{}
	for _, ent := range entities {
		if ent.EntityType == "person" {
			names[ent.ID] = ent.CanonicalName
		}
	}
	// “有语义替代”必须意味着当前库里确实存有该人物的结构化事实，
	// 仅在纪要 JSON 里出现却尚未入库，不足以支持删除重要原文。
	storedSemantic := map[string]bool{}
	for _, f := range facts {
		name := names[f.EntityID]
		if semantic[name][strings.TrimSpace(string(f.Content))] {
			storedSemantic[name] = true
		}
	}
	// 时间戳与说话人、原文同时匹配，避免误清理来自纪要摘要的业务事实。
	transcriptRows := map[string]bool{}
	for _, u := range utterances {
		if u.Time != "" && u.Speaker != "" && !isGeneratedSpeakerLabel(u.Speaker) {
			transcriptRows[u.Speaker+"\x00"+u.Time+"\x00"+strings.TrimSpace(u.Text)] = true
		}
	}
	for _, fact := range facts {
		name := names[fact.EntityID]
		if name == "" {
			continue
		}
		var segIDs []string
		if json.Unmarshal([]byte(fact.SourceSegmentIDs), &segIDs) != nil || len(segIDs) != 1 {
			continue
		}
		utterance := name + "\x00" + segIDs[0] + "\x00" + strings.TrimSpace(string(fact.Content))
		if !transcriptRows[utterance] {
			continue
		}
		candidate := RecordingSpeakerFactCleanupCandidate{
			FactID: fact.ID, EntityID: fact.EntityID, SourceKey: fact.SourceKey, Content: string(fact.Content),
			UpdatedTime: fact.UpdatedTime, SourceTime: segIDs[0], EntityName: name,
		}
		if !isUsefulRecordingMemoryFact(candidate.Content) {
			candidate.Reason = "obvious_noise"
			out.Selected = append(out.Selected, candidate)
			continue
		}
		// 内容与结构化纪要的语义事实完全一致时来源无法区分，保守保留。
		if semantic[name][strings.TrimSpace(candidate.Content)] {
			continue
		}
		candidate.Reason = "raw_utterance_not_in_minutes"
		// 只有该人物已经有有效语义事实时，才允许经显式授权清理尚未覆盖的原始发言。
		if len(semantic[name]) == 0 {
			out.Uncovered = append(out.Uncovered, candidate)
			continue
		}
		if includeUncovered && storedSemantic[name] {
			out.Selected = append(out.Selected, candidate)
		} else {
			out.Uncovered = append(out.Uncovered, candidate)
		}
	}
	return out, nil
}

// ValidateRecordingMemoryCleanupScope 防止跨企业或跨用户选错会议文件。
func ValidateRecordingMemoryCleanupScope(ctx context.Context, eid, ownerID, fileID int64) error {
	if eid <= 0 || ownerID <= 0 || fileID <= 0 {
		return fmt.Errorf("eid、owner_id、file_id 必须为正数")
	}
	file, err := loadRecordingMemorySourceFile(ctx, eid, fileID)
	if err != nil {
		return err
	}
	if file.UserID != ownerID || !file.IsRecordingOriginType() {
		return fmt.Errorf("会议不属于指定用户，或来源不是录音")
	}
	return nil
}

// PreviewRecordingUnlinkedFactCleanup 审计当前用户 file_id=0 的自动事实。
// 0 不等于垃圾：人工维护和 belongs_to 关系不在查询范围；无法回溯来源的自动事实
// 仅在显然是语音碎片时进入 selected，其余归入 uncovered 人工复核。
func PreviewRecordingUnlinkedFactCleanup(ctx context.Context, eid, ownerID int64) (RecordingSpeakerFactCleanupPreview, error) {
	out := RecordingSpeakerFactCleanupPreview{FileID: 0, SourceHash: "unlinked-automatic-extracted-v1"}
	var facts []model.RecordingMemoryFact
	if err := model.DB.WithContext(ctx).Where(
		"eid = ? AND owner_id = ? AND file_id = ? AND source_type = ? AND fact_kind = ? AND related_entity_id = ? AND is_deleted = ?",
		eid, ownerID, 0, recordingEntityMemorySourceAutomatic, recordingEntityMemoryFactExtracted, 0, false,
	).Order("id ASC").Find(&facts).Error; err != nil {
		return out, err
	}
	if len(facts) == 0 {
		return out, nil
	}
	ids := make([]int64, 0, len(facts))
	for _, f := range facts {
		ids = append(ids, f.EntityID)
	}
	var entities []model.RecordingMemoryEntity
	if err := model.DB.WithContext(ctx).Where("eid = ? AND owner_id = ? AND id IN ?", eid, ownerID, ids).Find(&entities).Error; err != nil {
		return out, err
	}
	names := make(map[int64]string, len(entities))
	for _, e := range entities {
		names[e.ID] = e.CanonicalName
	}
	for _, fact := range facts {
		candidate := RecordingSpeakerFactCleanupCandidate{
			FactID: fact.ID, EntityID: fact.EntityID, SourceKey: fact.SourceKey,
			Content: string(fact.Content), UpdatedTime: fact.UpdatedTime, EntityName: names[fact.EntityID],
		}
		if !isUsefulRecordingMemoryFact(candidate.Content) {
			candidate.Reason = "unlinked_obvious_noise"
			out.Selected = append(out.Selected, candidate)
		} else {
			candidate.Reason = "unlinked_requires_review"
			out.Uncovered = append(out.Uncovered, candidate)
		}
	}
	return out, nil
}

// IsValuableRecordingMemoryFact 供迁移工具执行前再次校验，不信任本地可编辑的计划 JSON。
func IsValuableRecordingMemoryFact(content string) bool { return isUsefulRecordingMemoryFact(content) }
