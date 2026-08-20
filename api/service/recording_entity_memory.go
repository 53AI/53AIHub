package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

const (
	recordingEntityMemorySourceAutomatic = "automatic"
	recordingEntityMemorySourceManual    = "manual"
	recordingEntityMemoryFactExtracted   = "extracted"
	recordingEntityMemoryFactCorrection  = "manual_correction"
)

var ErrRecordingEntityMemoryNotFound = errors.New("recording entity memory not found")
var ErrRecordingEntityMemoryHasFacts = errors.New("recording entity memory has active facts")

type recordingEntityMemoryItem struct {
	entityType      string
	canonicalName   string
	mentionOnlyName bool
	summary         string
	attributes      map[string]string
	aliases         []string
	facts           []recordingEntityMemoryFactItem
}

type recordingEntityMemoryFactItem struct {
	content          string
	attributes       map[string]string
	sourceSegmentIDs []string
}

// RecordingMemoryEntityList 是安心录记忆列表：一行对应一个规范实体。
type RecordingMemoryEntityList struct {
	Items []RecordingMemoryEntityListItem `json:"items"`
	Total int64                           `json:"total"`
}

type RecordingMemoryEntityListItem struct {
	ID             int64             `json:"id"`
	EntityType     string            `json:"entity_type"`
	CanonicalName  string            `json:"canonical_name"`
	Summary        string            `json:"summary"`
	FactCount      int64             `json:"fact_count"`
	SourceMeetings int64             `json:"source_meetings"`
	LastFactAt     int64             `json:"last_fact_at"`
	UpdatedTime    int64             `json:"updated_time"`
	Attributes     map[string]string `json:"attributes"` // schema 过滤后的属性（英文键值，中文经 schema 接口映射）
}

type RecordingMemoryEntityDetail struct {
	RecordingMemoryEntityListItem
	Aliases          []string                            `json:"aliases"`
	FirstMentionedAt int64                               `json:"first_mentioned_at"`
	Facts            []RecordingMemoryEntityFactView     `json:"facts"`
	Relations        []RecordingMemoryEntityRelationView `json:"relations"`
}

type RecordingMemoryEntityFactView struct {
	ID               int64             `json:"id"`
	EntityType       string            `json:"entity_type"` // 所属实体类型（person/matter/risk/principle）
	FactKind         string            `json:"fact_kind"`
	Content          string            `json:"content"`
	Attributes       map[string]string `json:"attributes"`
	SourceSegmentIDs []string          `json:"source_segment_ids"`
	SourceType       string            `json:"source_type"`
	OccurredAt       int64             `json:"occurred_at"`
	SourceFile       string            `json:"source_file"`
	FileID           int64             `json:"file_id"`
	UpdatedTime      int64             `json:"updated_time"`
}

type RecordingMemoryEntityRelationView struct {
	ID              int64  `json:"id"`
	RelatedEntityID int64  `json:"related_entity_id"`
	RelatedName     string `json:"related_name"`
	RelatedType     string `json:"related_type"`
	RelationType    string `json:"relation_type"`
}

type UpdateRecordingMemoryEntityInput struct {
	CanonicalName *string
	Summary       *string
	Attributes    map[string]string
}

type AddRecordingMemoryFactInput struct {
	Content    string
	Attributes map[string]string
}

type RecordingMemoryEntityService struct{ eid int64 }

func NewRecordingMemoryEntityService(eid int64) *RecordingMemoryEntityService {
	return &RecordingMemoryEntityService{eid: eid}
}

func recordingEntityTypesFromConfig(config *model.RecordingConfig) map[string]bool {
	result := map[string]bool{}
	if config == nil || config.MemoryExtraction == nil || !config.MemoryExtraction.IsEffectivelyEnabled() {
		return result
	}
	for _, kind := range config.MemoryExtraction.Types {
		switch kind {
		case model.EntityTypePerson:
			result["person"] = true
		case model.EntityTypeMatter:
			result["matter"] = true
		case model.EntityTypeRisk:
			result["risk"] = true
		case model.EntityTypePrinciple:
			result["principle"] = true
		}
	}
	return result
}

// CompileRecordingEntityMemory 从新生成的会议纪要中编译安心录专属的实体/事实记忆。
// 不调用额外 LLM；只消费 Prompt 2 的 memory_entities，失败不影响纪要主链路。
func CompileRecordingEntityMemory(ctx context.Context, eid, fileID, ownerID int64) (int, error) {
	config, err := model.ValidateOrCreateRecordingConfig(eid)
	if err != nil {
		return 0, err
	}
	allowedTypes := recordingEntityTypesFromConfig(config)
	// 叠加 schema 类型限制：schema 外类型（如存量配置含 commitment）不编译
	for entityType := range allowedTypes {
		if _, ok := model.RecordingMemoryEntitySchemas[entityType]; !ok {
			delete(allowedTypes, entityType)
		}
	}
	if len(allowedTypes) == 0 {
		return 0, nil
	}
	raw, err := loadMeetingMinutesJSON(eid, fileID)
	if err != nil {
		return 0, err
	}
	minutes, err := parseRecordingMemoryMinutes(raw)
	if err != nil {
		return 0, err
	}
	items := buildRecordingEntityMemoryItems(minutes, allowedTypes)

	mentionedAt := recordingEntityMemoryOccurredAt(ctx, eid, fileID)
	minutesHashBytes := sha256.Sum256([]byte(strings.TrimSpace(raw)))
	minutesHash := hex.EncodeToString(minutesHashBytes[:])
	compiled := 0
	err = model.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var previousEntityIDs []int64
		if err := tx.Model(&model.RecordingMemoryFact{}).
			Where("eid = ? AND owner_id = ? AND file_id = ? AND source_type = ? AND is_deleted = ?", eid, ownerID, fileID, recordingEntityMemorySourceAutomatic, false).
			Distinct("entity_id").Pluck("entity_id", &previousEntityIDs).Error; err != nil {
			return err
		}
		if err := tx.Model(&model.RecordingMemoryFact{}).
			Where("eid = ? AND owner_id = ? AND file_id = ? AND source_type = ? AND is_deleted = ?", eid, ownerID, fileID, recordingEntityMemorySourceAutomatic, false).
			Updates(map[string]interface{}{"is_deleted": true}).Error; err != nil {
			return err
		}
		for itemIndex, item := range items {
			entity, err := findOrCreateRecordingMemoryEntity(tx, eid, ownerID, fileID, item, mentionedAt)
			if err != nil {
				return err
			}
			if err := updateAutomaticRecordingMemoryEntity(tx, entity, item, mentionedAt); err != nil {
				return err
			}
			for factIndex, fact := range item.facts {
				if strings.TrimSpace(fact.content) == "" {
					continue
				}
				sourceSeed := fmt.Sprintf("%s|%d|%d|%s|%s", minutesHash, itemIndex, factIndex, item.canonicalName, fact.content)
				hash := sha256.Sum256([]byte(sourceSeed))
				attributesJSON, _ := json.Marshal(fact.attributes)
				segmentJSON, _ := json.Marshal(fact.sourceSegmentIDs)
				record := &model.RecordingMemoryFact{
					Eid:              eid,
					OwnerID:          ownerID,
					EntityID:         entity.ID,
					FileID:           fileID,
					SourceKey:        hex.EncodeToString(hash[:]),
					FactKind:         recordingEntityMemoryFactExtracted,
					Content:          model.LongText(fact.content),
					AttributesJSON:   model.LongText(attributesJSON),
					SourceSegmentIDs: model.LongText(segmentJSON),
					SourceType:       recordingEntityMemorySourceAutomatic,
					OccurredAt:       mentionedAt,
					IsDeleted:        false,
				}
				updates := map[string]interface{}{
					"entity_id":          record.EntityID,
					"fact_kind":          record.FactKind,
					"content":            record.Content,
					"attributes_json":    record.AttributesJSON,
					"source_segment_ids": record.SourceSegmentIDs,
					"source_type":        record.SourceType,
					"occurred_at":        record.OccurredAt,
					"is_deleted":         false,
				}
				result := tx.Model(&model.RecordingMemoryFact{}).
					Where("eid = ? AND owner_id = ? AND file_id = ? AND source_key = ?", eid, ownerID, fileID, record.SourceKey).
					Updates(updates)
				if result.Error != nil {
					return result.Error
				}
				if result.RowsAffected == 0 {
					if err := tx.Create(record).Error; err != nil {
						return err
					}
				}
				compiled++
			}
			if err := refreshRecordingMemoryEntityStats(tx, eid, ownerID, entity.ID); err != nil {
				return err
			}
		}
		for _, entityID := range previousEntityIDs {
			if err := refreshRecordingMemoryEntityStats(tx, eid, ownerID, entityID); err != nil {
				return err
			}
		}
		return nil
	})
	if err == nil {
		logger.Infof(ctx, "【实体记忆】编译完成 eid=%d fileID=%d ownerID=%d entities=%d facts=%d", eid, fileID, ownerID, len(items), compiled)
	}
	return compiled, err
}

func buildRecordingEntityMemoryItems(minutes map[string]interface{}, allowedTypes map[string]bool) []recordingEntityMemoryItem {
	rows, ok := minutes["memory_entities"].([]interface{})
	if !ok {
		return nil
	}
	items := make([]recordingEntityMemoryItem, 0, len(rows))
	for _, raw := range rows {
		row, ok := raw.(map[string]interface{})
		if !ok {
			continue
		}
		kind := strings.ToLower(strings.TrimSpace(stringValue(row["entity_type"])))
		name := strings.TrimSpace(stringValue(row["canonical_name"]))
		mention := strings.TrimSpace(stringValue(row["mention"]))
		mentionOnlyName := false
		if name == "" && mention != "" {
			// 模型无法确认跨会议同一性时会留空 canonical_name，但已经给出本次会议
			// 的明确提及和事实。保留该实体供用户在融合页决定是否合并。
			name = mention
			mentionOnlyName = true
		}
		if !allowedTypes[kind] || name == "" {
			continue
		}
		item := recordingEntityMemoryItem{
			entityType:      kind,
			canonicalName:   name,
			mentionOnlyName: mentionOnlyName,
			summary:         strings.TrimSpace(stringValue(row["summary"])),
			attributes:      sanitizeRecordingMemoryAttributes(kind, stringMapValue(row["attributes"])),
			aliases:         stringSliceValue(row["aliases"]),
		}
		if mention != "" && mention != name {
			item.aliases = append(item.aliases, mention)
		}
		facts, _ := row["facts"].([]interface{})
		for _, rawFact := range facts {
			fact, ok := rawFact.(map[string]interface{})
			if !ok {
				continue
			}
			content := strings.TrimSpace(stringValue(fact["content"]))
			if content == "" {
				continue
			}
			item.facts = append(item.facts, recordingEntityMemoryFactItem{
				content:          content,
				attributes:       sanitizeRecordingMemoryAttributes(kind, stringMapValue(fact["attributes"])),
				sourceSegmentIDs: memorySourceSegmentIDs(fact["source_segment_ids"]),
			})
		}
		if len(item.facts) == 0 && item.summary != "" {
			item.facts = append(item.facts, recordingEntityMemoryFactItem{content: item.summary})
		}
		if len(item.facts) > 0 {
			items = append(items, item)
		}
	}
	return items
}

func sanitizeRecordingMemoryAttributes(entityType string, attributes map[string]string) map[string]string {
	schema, ok := model.RecordingMemoryEntitySchemas[entityType]
	if !ok {
		return nil
	}
	result := map[string]string{}
	for key, value := range attributes {
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		attrSchema, ok := schema.Attributes[key]
		if !ok || value == "" {
			continue
		}
		if len(attrSchema.Values) > 0 {
			if _, ok := attrSchema.Values[value]; !ok {
				continue
			}
		}
		result[key] = value
	}
	return result
}

func stringMapValue(value interface{}) map[string]string {
	result := map[string]string{}
	row, ok := value.(map[string]interface{})
	if !ok {
		return result
	}
	for key, raw := range row {
		if text := strings.TrimSpace(stringValue(raw)); text != "" {
			result[key] = text
		}
	}
	return result
}

func stringSliceValue(value interface{}) []string {
	rows, ok := value.([]interface{})
	if !ok {
		return nil
	}
	seen := map[string]bool{}
	result := make([]string, 0, len(rows))
	for _, raw := range rows {
		text := strings.TrimSpace(stringValue(raw))
		if text == "" || seen[text] {
			continue
		}
		seen[text] = true
		result = append(result, text)
	}
	return result
}

func normalizeRecordingMemoryEntityName(name string) string {
	normalized := strings.ToLower(strings.Join(strings.Fields(strings.TrimSpace(name)), ""))
	digest := sha256.Sum256([]byte(normalized))
	return hex.EncodeToString(digest[:])
}

func recordingEntityMemoryOccurredAt(ctx context.Context, eid, fileID int64) int64 {
	if job, err := model.GetRecordingJobByOutputFileID(eid, fileID); err == nil && job != nil && job.StartedAt > 0 {
		return job.StartedAt
	}
	var file model.File
	if err := model.DB.WithContext(ctx).Where("eid = ? AND id = ?", eid, fileID).First(&file).Error; err == nil {
		if file.CreatedTime > 0 {
			return file.CreatedTime
		}
		return file.UpdatedTime
	}
	return time.Now().UTC().UnixMilli()
}

func findOrCreateRecordingMemoryEntity(tx *gorm.DB, eid, ownerID, fileID int64, item recordingEntityMemoryItem, mentionedAt int64) (*model.RecordingMemoryEntity, error) {
	identityName := item.canonicalName
	if item.mentionOnlyName {
		// mention 没有被模型归一为 canonical_name，不能据此自动跨会议合并。
		identityName = fmt.Sprintf("mention:%d:%s", fileID, item.canonicalName)
	}
	normalized := normalizeRecordingMemoryEntityName(identityName)
	var entity model.RecordingMemoryEntity
	err := tx.Where("eid = ? AND owner_id = ? AND entity_type = ? AND normalized_name = ?", eid, ownerID, item.entityType, normalized).First(&entity).Error
	if err == nil {
		if entity.MergedIntoID != 0 {
			var target model.RecordingMemoryEntity
			if err := tx.Where("id = ? AND eid = ? AND owner_id = ? AND is_deleted = ?", entity.MergedIntoID, eid, ownerID, false).First(&target).Error; err != nil {
				return nil, ErrRecordingEntityMemoryNotFound
			}
			return &target, nil
		}
		if entity.IsDeleted {
			if err := tx.Model(&entity).Updates(map[string]interface{}{"is_deleted": false}).Error; err != nil {
				return nil, err
			}
		}
		return &entity, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	attributesJSON, _ := json.Marshal(item.attributes)
	aliasesJSON, _ := json.Marshal(item.aliases)
	entity = model.RecordingMemoryEntity{
		Eid:              eid,
		OwnerID:          ownerID,
		EntityType:       item.entityType,
		CanonicalName:    item.canonicalName,
		NormalizedName:   normalized,
		Summary:          model.LongText(item.summary),
		AttributesJSON:   model.LongText(attributesJSON),
		AliasesJSON:      model.LongText(aliasesJSON),
		SummarySource:    recordingEntityMemorySourceAutomatic,
		AttributesSource: recordingEntityMemorySourceAutomatic,
		FirstMentionedAt: mentionedAt,
		LastFactAt:       mentionedAt,
	}
	if err := tx.Create(&entity).Error; err != nil {
		return nil, err
	}
	return &entity, nil
}

func updateAutomaticRecordingMemoryEntity(tx *gorm.DB, entity *model.RecordingMemoryEntity, item recordingEntityMemoryItem, mentionedAt int64) error {
	updates := map[string]interface{}{}
	// 档案展示的是当前有效状态。重编译旧会议仍需要更新其事实，
	// 但不能让旧会议倒灌覆盖已经由较新会议确认的档案内容。
	isCurrentOrNewer := mentionedAt >= entity.LastFactAt
	if entity.FirstMentionedAt == 0 || (mentionedAt > 0 && mentionedAt < entity.FirstMentionedAt) {
		updates["first_mentioned_at"] = mentionedAt
	}
	if mentionedAt > entity.LastFactAt {
		updates["last_fact_at"] = mentionedAt
	}
	if isCurrentOrNewer && entity.SummarySource != recordingEntityMemorySourceManual && strings.TrimSpace(item.summary) != "" {
		updates["summary"] = item.summary
		updates["summary_source"] = recordingEntityMemorySourceAutomatic
	}
	if isCurrentOrNewer && entity.AttributesSource != recordingEntityMemorySourceManual && len(item.attributes) > 0 {
		payload, _ := json.Marshal(mergeRecordingMemoryAttributes(decodeStringMap(entity.AttributesJSON), item.attributes))
		updates["attributes_json"] = string(payload)
		updates["attributes_source"] = recordingEntityMemorySourceAutomatic
	}
	aliases := mergeRecordingMemoryAliases(decodeStringSlice(entity.AliasesJSON), item.aliases)
	if len(aliases) > 0 {
		payload, _ := json.Marshal(aliases)
		updates["aliases_json"] = string(payload)
	}
	if len(updates) == 0 {
		return nil
	}
	if err := tx.Model(entity).Updates(updates).Error; err != nil {
		return err
	}
	return tx.First(entity, entity.ID).Error
}

func mergeRecordingMemoryAttributes(existing, incoming map[string]string) map[string]string {
	merged := make(map[string]string, len(existing)+len(incoming))
	for key, value := range existing {
		merged[key] = value
	}
	for key, value := range incoming {
		merged[key] = value
	}
	return merged
}

func mergeRecordingMemoryAliases(existing, incoming []string) []string {
	seen := map[string]bool{}
	result := make([]string, 0, len(existing)+len(incoming))
	for _, values := range [][]string{existing, incoming} {
		for _, value := range values {
			value = strings.TrimSpace(value)
			if value == "" || seen[value] {
				continue
			}
			seen[value] = true
			result = append(result, value)
		}
	}
	return result
}

func refreshRecordingMemoryEntityStats(tx *gorm.DB, eid, ownerID, entityID int64) error {
	var count int64
	if err := tx.Model(&model.RecordingMemoryFact{}).Where("eid = ? AND owner_id = ? AND entity_id = ? AND is_deleted = ?", eid, ownerID, entityID, false).Count(&count).Error; err != nil {
		return err
	}
	var last model.RecordingMemoryFact
	if count > 0 {
		if err := tx.Where("eid = ? AND owner_id = ? AND entity_id = ? AND is_deleted = ?", eid, ownerID, entityID, false).Order("occurred_at DESC, id DESC").First(&last).Error; err != nil {
			return err
		}
	}
	return tx.Model(&model.RecordingMemoryEntity{}).Where("id = ?", entityID).Updates(map[string]interface{}{"fact_count": count, "last_fact_at": last.OccurredAt}).Error
}

func (s *RecordingMemoryEntityService) ensureAccess(ctx context.Context, userID int64, requireEdit bool) error {
	library, err := NewPersonalSpaceService(s.eid).GetExistingPersonalLibrary(ctx, userID)
	if err != nil || library == nil {
		return err
	}
	permission, err := GetUserPermission(s.eid, model.RESOURCE_TYPE_LIBRARY, library.ID, userID)
	if err != nil {
		return err
	}
	if (requireEdit && permission < model.PERMISSION_EDIT_KNOWLEDGE) || (!requireEdit && permission < model.PERMISSION_VIEW_ONLY) {
		return ErrRecordingMemoryForbidden
	}
	return nil
}

func (s *RecordingMemoryEntityService) List(ctx context.Context, userID int64, entityType, keyword string, limit, offset int) (*RecordingMemoryEntityList, error) {
	if err := s.ensureAccess(ctx, userID, false); err != nil {
		return nil, err
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	query := model.DB.WithContext(ctx).Model(&model.RecordingMemoryEntity{}).Where("eid = ? AND owner_id = ? AND merged_into_id = ? AND is_deleted = ?", s.eid, userID, 0, false)
	schemaTypes := make([]string, 0, len(model.RecordingMemoryEntitySchemas))
	for entityType := range model.RecordingMemoryEntitySchemas {
		schemaTypes = append(schemaTypes, entityType)
	}
	query = query.Where("entity_type IN ?", schemaTypes)
	if entityType = strings.TrimSpace(entityType); entityType != "" {
		query = query.Where("entity_type = ?", entityType)
	}
	if keyword = strings.TrimSpace(keyword); keyword != "" {
		like := "%" + keyword + "%"
		query = query.Where("canonical_name LIKE ? OR summary LIKE ?", like, like)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, err
	}
	var entities []model.RecordingMemoryEntity
	if err := query.Order("last_fact_at DESC, id DESC").Offset(offset).Limit(limit).Find(&entities).Error; err != nil {
		return nil, err
	}
	entityIDs := make([]int64, 0, len(entities))
	for _, entity := range entities {
		entityIDs = append(entityIDs, entity.ID)
	}
	sourceMeetings, err := recordingMemorySourceMeetingCounts(ctx, s.eid, userID, entityIDs)
	if err != nil {
		return nil, err
	}
	items := make([]RecordingMemoryEntityListItem, 0, len(entities))
	for _, entity := range entities {
		items = append(items, recordingMemoryEntityListItem(entity, sourceMeetings[entity.ID]))
	}
	return &RecordingMemoryEntityList{Items: items, Total: total}, nil
}

func recordingMemorySourceMeetingCounts(ctx context.Context, eid, ownerID int64, entityIDs []int64) (map[int64]int64, error) {
	result := make(map[int64]int64, len(entityIDs))
	if len(entityIDs) == 0 {
		return result, nil
	}
	type sourceMeetingCount struct {
		EntityID       int64
		SourceMeetings int64
	}
	var rows []sourceMeetingCount
	err := model.DB.WithContext(ctx).Model(&model.RecordingMemoryFact{}).
		Select("entity_id, COUNT(DISTINCT file_id) AS source_meetings").
		Where("eid = ? AND owner_id = ? AND entity_id IN ? AND is_deleted = ? AND file_id > ?", eid, ownerID, entityIDs, false, 0).
		Group("entity_id").
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		result[row.EntityID] = row.SourceMeetings
	}
	return result, nil
}

func recordingMemoryEntityListItem(entity model.RecordingMemoryEntity, sourceMeetings int64) RecordingMemoryEntityListItem {
	return RecordingMemoryEntityListItem{ID: entity.ID, EntityType: entity.EntityType, CanonicalName: entity.CanonicalName, Summary: string(entity.Summary), FactCount: entity.FactCount, SourceMeetings: sourceMeetings, LastFactAt: entity.LastFactAt, UpdatedTime: entity.UpdatedTime, Attributes: sanitizeRecordingMemoryAttributes(entity.EntityType, decodeStringMap(entity.AttributesJSON))}
}

func (s *RecordingMemoryEntityService) Detail(ctx context.Context, userID, entityID int64) (*RecordingMemoryEntityDetail, error) {
	if err := s.ensureAccess(ctx, userID, false); err != nil {
		return nil, err
	}
	entity, err := s.findActiveEntity(ctx, userID, entityID)
	if err != nil {
		return nil, err
	}
	if _, ok := model.RecordingMemoryEntitySchemas[entity.EntityType]; !ok {
		return nil, ErrRecordingEntityMemoryNotFound
	}
	var sourceMeetings int64
	if err := model.DB.WithContext(ctx).Model(&model.RecordingMemoryFact{}).Where("eid = ? AND owner_id = ? AND entity_id = ? AND is_deleted = ? AND file_id > ?", s.eid, userID, entity.ID, false, 0).Distinct("file_id").Count(&sourceMeetings).Error; err != nil {
		return nil, err
	}
	detail := &RecordingMemoryEntityDetail{RecordingMemoryEntityListItem: recordingMemoryEntityListItem(*entity, sourceMeetings), Aliases: decodeStringSlice(entity.AliasesJSON), FirstMentionedAt: entity.FirstMentionedAt, Facts: []RecordingMemoryEntityFactView{}, Relations: []RecordingMemoryEntityRelationView{}}
	var facts []model.RecordingMemoryFact
	if err := model.DB.WithContext(ctx).Where("eid = ? AND owner_id = ? AND entity_id = ? AND is_deleted = ?", s.eid, userID, entity.ID, false).Order("occurred_at DESC, id DESC").Limit(100).Find(&facts).Error; err != nil {
		return nil, err
	}
	fileIDs := make([]int64, 0, len(facts))
	for _, fact := range facts {
		if fact.FileID > 0 {
			fileIDs = append(fileIDs, fact.FileID)
		}
	}
	fileNames := recordingMemorySourceFileNames(ctx, s.eid, userID, fileIDs)
	for _, fact := range facts {
		detail.Facts = append(detail.Facts, RecordingMemoryEntityFactView{ID: fact.ID, EntityType: entity.EntityType, FactKind: fact.FactKind, Content: string(fact.Content), Attributes: decodeStringMap(fact.AttributesJSON), SourceSegmentIDs: decodeStringSlice(fact.SourceSegmentIDs), SourceType: fact.SourceType, OccurredAt: fact.OccurredAt, SourceFile: fileNames[fact.FileID], FileID: fact.FileID, UpdatedTime: fact.UpdatedTime})
	}
	relations, err := s.listRelations(ctx, userID, entity.ID)
	if err != nil {
		return nil, err
	}
	detail.Relations = relations
	return detail, nil
}

func recordingMemorySourceFileNames(ctx context.Context, eid, ownerID int64, fileIDs []int64) map[int64]string {
	result := map[int64]string{}
	if len(fileIDs) == 0 {
		return result
	}
	var files []model.File
	if err := model.DB.WithContext(ctx).Where("eid = ? AND user_id = ? AND id IN ? AND is_deleted = ?", eid, ownerID, fileIDs, false).Find(&files).Error; err != nil {
		return result
	}
	for _, file := range files {
		result[file.ID] = file.Path
	}
	return result
}

func (s *RecordingMemoryEntityService) Update(ctx context.Context, userID, entityID int64, input UpdateRecordingMemoryEntityInput) (*RecordingMemoryEntityDetail, error) {
	if err := s.ensureAccess(ctx, userID, true); err != nil {
		return nil, err
	}
	err := model.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var entity model.RecordingMemoryEntity
		if err := tx.Where("id = ? AND eid = ? AND owner_id = ? AND merged_into_id = ? AND is_deleted = ?", entityID, s.eid, userID, 0, false).First(&entity).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrRecordingEntityMemoryNotFound
			}
			return err
		}
		updates := map[string]interface{}{}
		if input.CanonicalName != nil {
			name := strings.TrimSpace(*input.CanonicalName)
			if name == "" {
				return errors.New("entity name is empty")
			}
			updates["canonical_name"] = name
			updates["normalized_name"] = normalizeRecordingMemoryEntityName(name)
		}
		if input.Summary != nil {
			updates["summary"] = strings.TrimSpace(*input.Summary)
			updates["summary_source"] = recordingEntityMemorySourceManual
		}
		if input.Attributes != nil {
			payload, _ := json.Marshal(mergeRecordingMemoryAttributes(decodeStringMap(entity.AttributesJSON), sanitizeRecordingMemoryAttributes(entity.EntityType, input.Attributes)))
			updates["attributes_json"] = string(payload)
			updates["attributes_source"] = recordingEntityMemorySourceManual
		}
		if len(updates) == 0 {
			return nil
		}
		return tx.Model(&entity).Updates(updates).Error
	})
	if err != nil {
		return nil, err
	}
	return s.Detail(ctx, userID, entityID)
}

func (s *RecordingMemoryEntityService) AddManualCorrection(ctx context.Context, userID, entityID int64, input AddRecordingMemoryFactInput) (*RecordingMemoryEntityDetail, error) {
	if err := s.ensureAccess(ctx, userID, true); err != nil {
		return nil, err
	}
	if strings.TrimSpace(input.Content) == "" {
		return nil, errors.New("fact content is empty")
	}
	entity, err := s.findActiveEntity(ctx, userID, entityID)
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC().UnixMilli()
	seed := fmt.Sprintf("manual|%d|%d|%d", entityID, userID, now)
	hash := sha256.Sum256([]byte(seed))
	attributesJSON, _ := json.Marshal(sanitizeRecordingMemoryAttributes(entity.EntityType, input.Attributes))
	err = model.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		fact := &model.RecordingMemoryFact{Eid: s.eid, OwnerID: userID, EntityID: entityID, FileID: 0, SourceKey: hex.EncodeToString(hash[:]), FactKind: recordingEntityMemoryFactCorrection, Content: model.LongText(strings.TrimSpace(input.Content)), AttributesJSON: model.LongText(attributesJSON), SourceSegmentIDs: model.LongText("[]"), SourceType: recordingEntityMemorySourceManual, OccurredAt: now}
		if err := tx.Create(fact).Error; err != nil {
			return err
		}
		if err := applyRecordingMemoryManualCorrectionProfile(tx, entity, string(fact.Content), decodeStringMap(fact.AttributesJSON)); err != nil {
			return err
		}
		return refreshRecordingMemoryEntityStats(tx, s.eid, userID, entityID)
	})
	if err != nil {
		return nil, err
	}
	return s.Detail(ctx, userID, entityID)
}

// applyRecordingMemoryManualCorrectionProfile 让人工修正在保留原始事实的同时，成为详情顶部的当前有效内容。
func applyRecordingMemoryManualCorrectionProfile(tx *gorm.DB, entity *model.RecordingMemoryEntity, content string, attributes map[string]string) error {
	updates := map[string]interface{}{
		"summary":        strings.TrimSpace(content),
		"summary_source": recordingEntityMemorySourceManual,
	}
	if len(attributes) > 0 {
		payload, _ := json.Marshal(mergeRecordingMemoryAttributes(decodeStringMap(entity.AttributesJSON), attributes))
		updates["attributes_json"] = string(payload)
		updates["attributes_source"] = recordingEntityMemorySourceManual
	}
	if err := tx.Model(entity).Updates(updates).Error; err != nil {
		return err
	}
	return tx.First(entity, entity.ID).Error
}

func (s *RecordingMemoryEntityService) DeleteFact(ctx context.Context, userID, entityID, factID int64) error {
	if err := s.ensureAccess(ctx, userID, true); err != nil {
		return err
	}
	return model.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&model.RecordingMemoryFact{}).Where("id = ? AND eid = ? AND owner_id = ? AND entity_id = ? AND is_deleted = ?", factID, s.eid, userID, entityID, false).Updates(map[string]interface{}{"is_deleted": true})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return ErrRecordingEntityMemoryNotFound
		}
		return refreshRecordingMemoryEntityStats(tx, s.eid, userID, entityID)
	})
}

func (s *RecordingMemoryEntityService) DeleteEntity(ctx context.Context, userID, entityID int64) error {
	if err := s.ensureAccess(ctx, userID, true); err != nil {
		return err
	}
	return model.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var activeFacts int64
		if err := tx.Model(&model.RecordingMemoryFact{}).Where("eid = ? AND owner_id = ? AND entity_id = ? AND is_deleted = ?", s.eid, userID, entityID, false).Count(&activeFacts).Error; err != nil {
			return err
		}
		if activeFacts > 0 {
			return ErrRecordingEntityMemoryHasFacts
		}
		result := tx.Model(&model.RecordingMemoryEntity{}).Where("id = ? AND eid = ? AND owner_id = ? AND merged_into_id = ? AND is_deleted = ?", entityID, s.eid, userID, 0, false).Updates(map[string]interface{}{"is_deleted": true})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return ErrRecordingEntityMemoryNotFound
		}
		return nil
	})
}

func (s *RecordingMemoryEntityService) Merge(ctx context.Context, userID, sourceID, targetID int64) (*RecordingMemoryEntityDetail, error) {
	if err := s.ensureAccess(ctx, userID, true); err != nil {
		return nil, err
	}
	if sourceID == targetID {
		return nil, errors.New("source and target cannot be the same")
	}
	err := model.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var source, target model.RecordingMemoryEntity
		if err := tx.Where("id = ? AND eid = ? AND owner_id = ? AND merged_into_id = ? AND is_deleted = ?", sourceID, s.eid, userID, 0, false).First(&source).Error; err != nil {
			return ErrRecordingEntityMemoryNotFound
		}
		if err := tx.Where("id = ? AND eid = ? AND owner_id = ? AND merged_into_id = ? AND is_deleted = ?", targetID, s.eid, userID, 0, false).First(&target).Error; err != nil {
			return ErrRecordingEntityMemoryNotFound
		}
		if source.EntityType != target.EntityType {
			return errors.New("only entities of the same type can be merged")
		}
		if err := tx.Model(&model.RecordingMemoryFact{}).Where("eid = ? AND owner_id = ? AND entity_id = ?", s.eid, userID, source.ID).Updates(map[string]interface{}{"entity_id": target.ID}).Error; err != nil {
			return err
		}
		aliases := mergeRecordingMemoryAliases(decodeStringSlice(target.AliasesJSON), append(decodeStringSlice(source.AliasesJSON), source.CanonicalName))
		aliasesJSON, _ := json.Marshal(aliases)
		if err := tx.Model(&target).Updates(map[string]interface{}{"aliases_json": string(aliasesJSON)}).Error; err != nil {
			return err
		}
		if err := tx.Model(&source).Updates(map[string]interface{}{"merged_into_id": target.ID, "is_deleted": true}).Error; err != nil {
			return err
		}
		var sourceRelations []model.RecordingMemoryEntityRelation
		if err := tx.Where("eid = ? AND owner_id = ? AND (entity_id = ? OR related_entity_id = ?)", s.eid, userID, source.ID, source.ID).Find(&sourceRelations).Error; err != nil {
			return err
		}
		if err := tx.Where("eid = ? AND owner_id = ? AND (entity_id = ? OR related_entity_id = ?)", s.eid, userID, source.ID, source.ID).Delete(&model.RecordingMemoryEntityRelation{}).Error; err != nil {
			return err
		}
		for _, relation := range sourceRelations {
			otherID := relation.EntityID
			if otherID == source.ID {
				otherID = relation.RelatedEntityID
			}
			if otherID == target.ID || otherID == source.ID {
				continue
			}
			first, second := target.ID, otherID
			if first > second {
				first, second = second, first
			}
			replacement := &model.RecordingMemoryEntityRelation{Eid: s.eid, OwnerID: userID, EntityID: first, RelatedEntityID: second, RelationType: relation.RelationType}
			if err := tx.Where("eid = ? AND owner_id = ? AND entity_id = ? AND related_entity_id = ?", s.eid, userID, first, second).FirstOrCreate(replacement).Error; err != nil {
				return err
			}
		}
		return refreshRecordingMemoryEntityStats(tx, s.eid, userID, target.ID)
	})
	if err != nil {
		return nil, err
	}
	return s.Detail(ctx, userID, targetID)
}

func (s *RecordingMemoryEntityService) AddRelation(ctx context.Context, userID, entityID, relatedID int64) (*RecordingMemoryEntityDetail, error) {
	if err := s.ensureAccess(ctx, userID, true); err != nil {
		return nil, err
	}
	if entityID == relatedID {
		return nil, errors.New("cannot relate an entity to itself")
	}
	first, second := entityID, relatedID
	if first > second {
		first, second = second, first
	}
	err := model.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for _, id := range []int64{first, second} {
			var entity model.RecordingMemoryEntity
			if err := tx.Where("id = ? AND eid = ? AND owner_id = ? AND merged_into_id = ? AND is_deleted = ?", id, s.eid, userID, 0, false).First(&entity).Error; err != nil {
				return ErrRecordingEntityMemoryNotFound
			}
		}
		relation := &model.RecordingMemoryEntityRelation{Eid: s.eid, OwnerID: userID, EntityID: first, RelatedEntityID: second, RelationType: "related"}
		return tx.Where("eid = ? AND owner_id = ? AND entity_id = ? AND related_entity_id = ?", s.eid, userID, first, second).FirstOrCreate(relation).Error
	})
	if err != nil {
		return nil, err
	}
	return s.Detail(ctx, userID, entityID)
}

func (s *RecordingMemoryEntityService) DeleteRelation(ctx context.Context, userID, entityID, relationID int64) error {
	if err := s.ensureAccess(ctx, userID, true); err != nil {
		return err
	}
	result := model.DB.WithContext(ctx).Where("id = ? AND eid = ? AND owner_id = ? AND (entity_id = ? OR related_entity_id = ?)", relationID, s.eid, userID, entityID, entityID).Delete(&model.RecordingMemoryEntityRelation{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrRecordingEntityMemoryNotFound
	}
	return nil
}

func (s *RecordingMemoryEntityService) findActiveEntity(ctx context.Context, userID, entityID int64) (*model.RecordingMemoryEntity, error) {
	var entity model.RecordingMemoryEntity
	if err := model.DB.WithContext(ctx).Where("id = ? AND eid = ? AND owner_id = ? AND merged_into_id = ? AND is_deleted = ?", entityID, s.eid, userID, 0, false).First(&entity).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrRecordingEntityMemoryNotFound
		}
		return nil, err
	}
	return &entity, nil
}

func (s *RecordingMemoryEntityService) listRelations(ctx context.Context, userID, entityID int64) ([]RecordingMemoryEntityRelationView, error) {
	var relations []model.RecordingMemoryEntityRelation
	if err := model.DB.WithContext(ctx).Where("eid = ? AND owner_id = ? AND (entity_id = ? OR related_entity_id = ?)", s.eid, userID, entityID, entityID).Find(&relations).Error; err != nil {
		return nil, err
	}
	ids := make([]int64, 0, len(relations))
	for _, relation := range relations {
		if relation.EntityID == entityID {
			ids = append(ids, relation.RelatedEntityID)
		} else {
			ids = append(ids, relation.EntityID)
		}
	}
	var entities []model.RecordingMemoryEntity
	if len(ids) > 0 {
		if err := model.DB.WithContext(ctx).Where("eid = ? AND owner_id = ? AND id IN ? AND is_deleted = ?", s.eid, userID, ids, false).Find(&entities).Error; err != nil {
			return nil, err
		}
	}
	byID := map[int64]model.RecordingMemoryEntity{}
	for _, entity := range entities {
		byID[entity.ID] = entity
	}
	result := make([]RecordingMemoryEntityRelationView, 0, len(relations))
	for _, relation := range relations {
		relatedID := relation.EntityID
		if relatedID == entityID {
			relatedID = relation.RelatedEntityID
		}
		related, ok := byID[relatedID]
		if !ok {
			continue
		}
		result = append(result, RecordingMemoryEntityRelationView{ID: relation.ID, RelatedEntityID: relatedID, RelatedName: related.CanonicalName, RelatedType: related.EntityType, RelationType: relation.RelationType})
	}
	sort.Slice(result, func(i, j int) bool { return result[i].RelatedName < result[j].RelatedName })
	return result, nil
}

// loadRecordingEntityMemoryRecallHistory 将当前会议已抽取到的实体作为精确候选，
// 仅召回同一安心录用户下的有效历史事实，不触碰通用 RAG 实体表。
func loadRecordingEntityMemoryRecallHistory(ctx context.Context, eid, ownerID, currentFileID int64) []historyMeeting {
	var currentEntityIDs []int64
	if err := model.DB.WithContext(ctx).Model(&model.RecordingMemoryFact{}).
		Where("eid = ? AND owner_id = ? AND file_id = ? AND is_deleted = ?", eid, ownerID, currentFileID, false).
		Distinct("entity_id").Pluck("entity_id", &currentEntityIDs).Error; err != nil || len(currentEntityIDs) == 0 {
		return nil
	}
	var facts []model.RecordingMemoryFact
	if err := model.DB.WithContext(ctx).
		Where("eid = ? AND owner_id = ? AND entity_id IN ? AND file_id != ? AND is_deleted = ?", eid, ownerID, currentEntityIDs, currentFileID, false).
		Order("occurred_at DESC, id DESC").Limit(24).Find(&facts).Error; err != nil || len(facts) == 0 {
		return nil
	}
	entityIDs := make([]int64, 0, len(currentEntityIDs))
	fileIDs := make([]int64, 0, len(facts))
	for _, fact := range facts {
		entityIDs = append(entityIDs, fact.EntityID)
		if fact.FileID > 0 {
			fileIDs = append(fileIDs, fact.FileID)
		}
	}
	var entities []model.RecordingMemoryEntity
	if err := model.DB.WithContext(ctx).Where("eid = ? AND owner_id = ? AND id IN ? AND merged_into_id = ? AND is_deleted = ?", eid, ownerID, entityIDs, 0, false).Find(&entities).Error; err != nil {
		return nil
	}
	entityByID := map[int64]model.RecordingMemoryEntity{}
	for _, entity := range entities {
		entityByID[entity.ID] = entity
	}
	fileNames := recordingMemorySourceFileNames(ctx, eid, ownerID, fileIDs)
	rowsByFile := map[int64]int{}
	rows := make([]historyMeeting, 0, len(fileNames))
	for _, fact := range facts {
		entity, ok := entityByID[fact.EntityID]
		if !ok {
			continue
		}
		sourceFile := fileNames[fact.FileID]
		if fact.FileID == 0 {
			sourceFile = "人工修正"
		}
		if sourceFile == "" {
			continue
		}
		index, exists := rowsByFile[fact.FileID]
		if !exists {
			index = len(rows)
			rowsByFile[fact.FileID] = index
			rows = append(rows, historyMeeting{FileID: fact.FileID, Title: sourceFile})
		}
		content := entity.CanonicalName + "：" + strings.TrimSpace(string(fact.Content))
		if attributes := decodeStringMap(fact.AttributesJSON); len(attributes) > 0 {
			payload, _ := json.Marshal(attributes)
			content += "；属性=" + string(payload)
		}
		rows[index].Memories = append(rows[index].Memories, meetingMemoryContext{
			MemoryID:          -fact.ID,
			Kind:              "entity_" + entity.EntityType,
			Content:           content,
			AssertionState:    "confirmed",
			LifecycleState:    "open",
			ReviewState:       recordingMemoryReviewConfirmed,
			SourceFileID:      fact.FileID,
			SourceFile:        sourceFile,
			SourceConfidence:  1,
			EvidenceAvailable: fact.SourceType == recordingEntityMemorySourceManual || len(decodeStringSlice(fact.SourceSegmentIDs)) > 0,
			SourceSegmentIDs:  decodeStringSlice(fact.SourceSegmentIDs),
		})
	}
	return rows
}

func decodeStringMap(raw model.LongText) map[string]string {
	result := map[string]string{}
	if strings.TrimSpace(string(raw)) == "" {
		return result
	}
	_ = json.Unmarshal([]byte(raw), &result)
	return result
}

func decodeStringSlice(raw model.LongText) []string {
	result := []string{}
	if strings.TrimSpace(string(raw)) == "" {
		return result
	}
	_ = json.Unmarshal([]byte(raw), &result)
	return result
}
