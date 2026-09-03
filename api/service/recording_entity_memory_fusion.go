package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	relaymodel "github.com/songquanpeng/one-api/relay/model"
	"gorm.io/gorm"
)

// recordingEntityMemoryMergeSystemPrompt 约束 LLM 只做描述合并去重，不新增事实。
const recordingEntityMemoryMergeSystemPrompt = `你是会议实体记忆的合并助手。

用户把同一实体的多条重复记忆合并为一条。请把输入中所有记忆的描述合并成唯一一段描述：
1. 语义去重：表达同一件事的内容只保留一次；
2. 信息不丢失：各条描述中独特的关键信息（人物、时间、数字、条件、结论）都要保留；
3. 不新增事实：不得添加输入中没有的信息，不得编造；
4. 语言简洁、连贯、面向业务使用。

只输出 JSON，不要输出 Markdown 或解释：
{"summary":"合并后的唯一描述"}`

type recordingEntityMemoryMergeResult struct {
	Summary string `json:"summary"`
}

// MergeMany 把多条同类型实体记忆融合为一条：除描述外全部保留基底内容；
// 描述由 LLM 对所选实体描述合并去重后写入基底（summary_source=manual）。
// 来源实体软删并指向基底，来源事实去重迁移，来源关联迁移。
func (s *RecordingMemoryEntityService) MergeMany(ctx context.Context, userID int64, sourceIDs []int64, targetID int64) (*RecordingMemoryEntityDetail, error) {
	if err := s.ensureAccess(ctx, userID, true); err != nil {
		return nil, err
	}
	sourceIDs = dedupeRecordingMemoryEntityIDs(sourceIDs)
	if len(sourceIDs) == 0 {
		return nil, errors.New("source entities are required")
	}
	for _, sourceID := range sourceIDs {
		if sourceID == targetID {
			return nil, ErrRecordingEntityMemoryMergeSelf
		}
	}

	// 1. 读取并校验（事务外完成：LLM 不允许在事务内调用）。
	var target model.RecordingMemoryEntity
	if err := model.DB.WithContext(ctx).
		Where("id = ? AND eid = ? AND owner_id = ? AND merged_into_id = ? AND is_deleted = ?", targetID, s.eid, userID, 0, false).
		First(&target).Error; err != nil {
		return nil, ErrRecordingEntityMemoryNotFound
	}
	sources := make([]model.RecordingMemoryEntity, 0, len(sourceIDs))
	for _, sourceID := range sourceIDs {
		var source model.RecordingMemoryEntity
		if err := model.DB.WithContext(ctx).
			Where("id = ? AND eid = ? AND owner_id = ? AND merged_into_id = ? AND is_deleted = ?", sourceID, s.eid, userID, 0, false).
			First(&source).Error; err != nil {
			return nil, ErrRecordingEntityMemoryNotFound
		}
		if source.EntityType != target.EntityType {
			return nil, ErrRecordingEntityMemoryCrossType
		}
		sources = append(sources, source)
	}

	// 2. LLM 合并描述；失败则整体失败，不落任何变更。
	mergedSummary, err := s.mergeRecordingEntitySummaries(ctx, target, sources)
	if err != nil {
		return nil, err
	}

	// 3. 事务落库（公共底层：facts 迁移 + 关联修正 + content/summary 替换 + aliases + relation + source 软删 + stats）。
	err = model.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		return mergeRecordingEntitiesTx(tx, s.eid, userID, sourceIDs, target.ID, mergedSummary)
	})
	if err != nil {
		return nil, err
	}
	return s.Detail(ctx, userID, targetID)
}

// mergeRecordingEntitySummaries 调用 LLM 把基底与来源的描述合并去重为唯一描述。
func (s *RecordingMemoryEntityService) mergeRecordingEntitySummaries(ctx context.Context, target model.RecordingMemoryEntity, sources []model.RecordingMemoryEntity) (string, error) {
	config, err := model.ValidateOrCreateRecordingConfig(s.eid)
	if err != nil || config.InferenceModelID == 0 || config.InferenceModelName == "" {
		return "", ErrRecordingEntityMemoryModelNotConfigured
	}
	var input strings.Builder
	typeLabel := "实体"
	if schema, ok := model.RecordingMemoryEntitySchemas[target.EntityType]; ok && schema.Label != "" {
		typeLabel = schema.Label
	}
	fmt.Fprintf(&input, "实体类型：%s\n\n待合并的记忆（最后一条为基底；基底保留名称/类型/属性，仅描述取合并结果）：\n", typeLabel)
	for _, source := range sources {
		summary := strings.TrimSpace(string(source.Summary))
		if summary == "" {
			summary = "（无描述）"
		}
		fmt.Fprintf(&input, "- %s：%s\n", source.CanonicalName, summary)
	}
	fmt.Fprintf(&input, "- %s（基底）：%s\n", target.CanonicalName, strings.TrimSpace(string(target.Summary)))

	// 输入预算控制：实体摘要通常很短，防御性截断避免超上下文。
	mergedInput := truncateRecordingEntityMergeInput(input.String())

	buildRequest := func() *relaymodel.GeneralOpenAIRequest {
		return &relaymodel.GeneralOpenAIRequest{
			Model: config.InferenceModelName,
			Messages: []relaymodel.Message{
				{Role: "system", Content: recordingEntityMemoryMergeSystemPrompt},
				{Role: "user", Content: mergedInput},
			},
		}
	}
	raw, err := callLLMWithRetry(ctx, config, buildRequest)
	if err != nil {
		return "", err
	}
	summary, ok := parseRecordingEntityMemoryMergeSummary(raw)
	if !ok {
		return "", errors.New("合并描述解析失败")
	}
	return summary, nil
}

const recordingEntityMemoryMergeMaxInputRunes = 12000

func truncateRecordingEntityMergeInput(value string) string {
	runes := []rune(value)
	if len(runes) <= recordingEntityMemoryMergeMaxInputRunes {
		return value
	}
	return string(runes[:recordingEntityMemoryMergeMaxInputRunes]) + "\n...(内容已截断，仅用于描述合并)"
}

func parseRecordingEntityMemoryMergeSummary(raw string) (string, bool) {
	var result recordingEntityMemoryMergeResult
	if err := json.Unmarshal([]byte(extractJSON(raw)), &result); err != nil {
		return "", false
	}
	summary := strings.TrimSpace(result.Summary)
	if summary == "" {
		return "", false
	}
	return summary, true
}

func dedupeRecordingMemoryEntityIDs(ids []int64) []int64 {
	seen := map[int64]struct{}{}
	result := make([]int64, 0, len(ids))
	for _, id := range ids {
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		result = append(result, id)
	}
	return result
}

// migrateRecordingMemoryFact 把事实迁移到基底；目标已存在同源同内容事实时软删重复项。
func migrateRecordingMemoryFact(tx *gorm.DB, eid, userID, targetID int64, fact model.RecordingMemoryFact) error {
	var duplicate int64
	if err := tx.Model(&model.RecordingMemoryFact{}).
		Where("eid = ? AND owner_id = ? AND entity_id = ? AND file_id = ? AND source_type = ? AND content = ? AND is_deleted = ?",
			eid, userID, targetID, fact.FileID, fact.SourceType, fact.Content, false).
		Count(&duplicate).Error; err != nil {
		return err
	}
	if duplicate > 0 {
		return tx.Model(&model.RecordingMemoryFact{}).Where("id = ?", fact.ID).Update("is_deleted", true).Error
	}
	return tx.Model(&model.RecordingMemoryFact{}).Where("id = ? AND eid = ? AND owner_id = ?", fact.ID, eid, userID).
		Update("entity_id", targetID).Error
}

// migrateRecordingMemoryEntityRelations 把来源实体的关联迁移到基底，并按 (低ID, 高ID) 去重。
func migrateRecordingMemoryEntityRelations(tx *gorm.DB, eid, userID, sourceID, targetID int64) error {
	var sourceRelations []model.RecordingMemoryEntityRelation
	if err := tx.Where("eid = ? AND owner_id = ? AND (entity_id = ? OR related_entity_id = ?)", eid, userID, sourceID, sourceID).Find(&sourceRelations).Error; err != nil {
		return err
	}
	if err := tx.Where("eid = ? AND owner_id = ? AND (entity_id = ? OR related_entity_id = ?)", eid, userID, sourceID, sourceID).Delete(&model.RecordingMemoryEntityRelation{}).Error; err != nil {
		return err
	}
	for _, relation := range sourceRelations {
		otherID := relation.EntityID
		if otherID == sourceID {
			otherID = relation.RelatedEntityID
		}
		if otherID == targetID || otherID == sourceID {
			continue
		}
		first, second := targetID, otherID
		if first > second {
			first, second = second, first
		}
		replacement := &model.RecordingMemoryEntityRelation{Eid: eid, OwnerID: userID, EntityID: first, RelatedEntityID: second, RelationType: relation.RelationType}
		if err := tx.Where("eid = ? AND owner_id = ? AND entity_id = ? AND related_entity_id = ?", eid, userID, first, second).FirstOrCreate(replacement).Error; err != nil {
			return err
		}
	}
	return nil
}

// fixMergedEntityReferences 融合后修复其他实体对被融合实体的引用（需求2）：
//  1. 改关联 id：related_entity_id = sourceID 的活动 fact → targetID
//  2. content 替换：所有活动 fact 的 content 里出现 sourceName（被融合实体主名）→ 替换为 targetName
//  3. summary 替换：活动实体的 summary 里出现 sourceName → 替换为 targetName
//
// 仅处理主名，别名不处理（用户确认：别名牵扯太大，本轮不做）。
func fixMergedEntityReferences(tx *gorm.DB, eid, ownerID int64, sourceID, targetID int64, sourceName, targetName string) error {
	if sourceName == "" || sourceName == targetName {
		return nil
	}
	// 1. 改关联 id
	if err := tx.Model(&model.RecordingMemoryFact{}).
		Where("eid = ? AND owner_id = ? AND related_entity_id = ? AND is_deleted = ?", eid, ownerID, sourceID, false).
		Update("related_entity_id", targetID).Error; err != nil {
		return err
	}
	// 2. content 替换（Go 侧 ReplaceAll，避免 SQL REPLACE 方言差异）
	like := "%" + sourceName + "%"
	var facts []model.RecordingMemoryFact
	if err := tx.Where("eid = ? AND owner_id = ? AND is_deleted = ? AND content LIKE ?", eid, ownerID, false, like).Find(&facts).Error; err != nil {
		return err
	}
	for _, f := range facts {
		nc := strings.ReplaceAll(string(f.Content), sourceName, targetName)
		if nc != string(f.Content) {
			if err := tx.Model(&model.RecordingMemoryFact{}).Where("id = ?", f.ID).Update("content", model.LongText(nc)).Error; err != nil {
				return err
			}
		}
	}
	// 3. summary 替换（活动实体）
	var entities []model.RecordingMemoryEntity
	if err := tx.Where("eid = ? AND owner_id = ? AND is_deleted = ? AND merged_into_id = ? AND summary LIKE ?",
		eid, ownerID, false, 0, like).Find(&entities).Error; err != nil {
		return err
	}
	for _, e := range entities {
		ns := strings.ReplaceAll(string(e.Summary), sourceName, targetName)
		if ns != string(e.Summary) {
			if err := tx.Model(&model.RecordingMemoryEntity{}).Where("id = ?", e.ID).Update("summary", model.LongText(ns)).Error; err != nil {
				return err
			}
		}
	}
	return nil
}

// mergeRecordingEntitiesTx 事务内把多个 source 实体并入 target（需求1/需求2 公共底层）：
// facts 去重迁移、关联修正（related_entity_id 改向 + content/summary 旧名替换）、aliases 并入、
// relation 迁移、source 软删释放名字、stats 刷新。mergedSummary 非空时更新 target.summary。
// 不校验权限（调用方保证）；不调用 LLM（事务内禁止，LLM 合并由调用方在事务外完成）。
func mergeRecordingEntitiesTx(tx *gorm.DB, eid, ownerID int64, sourceIDs []int64, targetID int64, mergedSummary string) error {
	var target model.RecordingMemoryEntity
	if err := tx.First(&target, targetID).Error; err != nil {
		return err
	}
	if mergedSummary != "" {
		if err := tx.Model(&model.RecordingMemoryEntity{}).Where("id = ?", targetID).
			Updates(map[string]interface{}{"summary": mergedSummary, "summary_source": recordingEntityMemorySourceManual}).Error; err != nil {
			return err
		}
	}
	targetAliases := decodeStringSlice(target.AliasesJSON)
	for _, sourceID := range sourceIDs {
		var source model.RecordingMemoryEntity
		if err := tx.First(&source, sourceID).Error; err != nil {
			return err
		}
		// 来源事实迁移（内容去重）
		var facts []model.RecordingMemoryFact
		if err := tx.Where("eid = ? AND owner_id = ? AND entity_id = ? AND is_deleted = ?", eid, ownerID, sourceID, false).Find(&facts).Error; err != nil {
			return err
		}
		for _, fact := range facts {
			if err := migrateRecordingMemoryFact(tx, eid, ownerID, targetID, fact); err != nil {
				return err
			}
		}
		// 关联修正 + content/summary 旧名替换（需求2）
		if err := fixMergedEntityReferences(tx, eid, ownerID, sourceID, targetID, source.CanonicalName, target.CanonicalName); err != nil {
			return err
		}
		// 别名并入基底（辅助查找，不改展示内容）；本地累积避免多源互相覆盖
		targetAliases = mergeRecordingMemoryAliases(targetAliases, append(decodeStringSlice(source.AliasesJSON), source.CanonicalName))
		// 来源软删并指向基底；释放名字（融合只影响历史，后续同名可再建新卡）
		if err := tx.Model(&model.RecordingMemoryEntity{}).Where("id = ?", sourceID).
			Updates(map[string]interface{}{"merged_into_id": targetID, "is_deleted": true, "normalized_name": gorm.Expr("NULL")}).Error; err != nil {
			return err
		}
		// 来源关联迁移
		if err := migrateRecordingMemoryEntityRelations(tx, eid, ownerID, sourceID, targetID); err != nil {
			return err
		}
	}
	// 别名统一落库（累积结果）
	if len(targetAliases) > 0 {
		payload, err := json.Marshal(targetAliases)
		if err != nil {
			return err
		}
		if err := tx.Model(&model.RecordingMemoryEntity{}).Where("id = ?", targetID).Update("aliases_json", string(payload)).Error; err != nil {
			return err
		}
	}
	return refreshRecordingMemoryEntityStats(tx, eid, ownerID, targetID)
}

// AutoMergeSameNameEntities 扫描 eid/ownerID 下"同名同类型"多张活动实体并自动融合（需求1）。
// 每组保留 LastFactAt 最大者当基底，其余并入；描述合并与手动融合一致（LLM，事务外调用）。
// 单组 LLM 失败跳过该组继续（不阻塞编译），返回成功融合的组数。
func AutoMergeSameNameEntities(ctx context.Context, eid, ownerID int64) (int, error) {
	var entities []model.RecordingMemoryEntity
	if err := model.DB.WithContext(ctx).
		Where("eid = ? AND owner_id = ? AND is_deleted = ? AND merged_into_id = ?", eid, ownerID, false, 0).
		Order("last_fact_at DESC, id ASC").Find(&entities).Error; err != nil {
		return 0, err
	}
	// 按 (entityType, 规范化 canonical_name) 分组；排除 ASR speaker 标签（跨会议可能不同人，不自动合并）
	groups := map[string][]model.RecordingMemoryEntity{}
	for _, e := range entities {
		if isGeneratedSpeakerLabel(e.CanonicalName) {
			continue
		}
		name := strings.ToLower(strings.Join(strings.Fields(strings.TrimSpace(e.CanonicalName)), ""))
		if name == "" {
			continue
		}
		key := e.EntityType + "\x00" + name
		groups[key] = append(groups[key], e)
	}
	svc := NewRecordingMemoryEntityService(eid)
	merged := 0
	for _, list := range groups {
		if len(list) < 2 {
			continue
		}
		// list 已按 last_fact_at DESC 排序：第一个为基底（内容最新），其余为 source
		target := list[0]
		sources := list[1:]
		sourceIDs := make([]int64, 0, len(sources))
		for _, s := range sources {
			sourceIDs = append(sourceIDs, s.ID)
		}
		// LLM 合并描述（事务外）；失败跳过该组，不阻塞编译
		mergedSummary, err := svc.mergeRecordingEntitySummaries(ctx, target, sources)
		if err != nil {
			logger.Warnf(ctx, "【实体记忆】自动融合描述合并失败，跳过 name=%s type=%s err=%v", target.CanonicalName, target.EntityType, err)
			continue
		}
		err = model.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			return mergeRecordingEntitiesTx(tx, eid, ownerID, sourceIDs, target.ID, mergedSummary)
		})
		if err != nil {
			return merged, err
		}
		logger.Infof(ctx, "【实体记忆】自动融合同名同类型实体 eid=%d ownerID=%d type=%s name=%s sources=%d", eid, ownerID, target.EntityType, target.CanonicalName, len(sources))
		merged++
	}
	return merged, nil
}
