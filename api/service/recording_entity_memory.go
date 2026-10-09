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
	recordingdebug "github.com/53AI/53AIHub/service/recording_debug"
	"gorm.io/gorm"
)

const (
	recordingEntityMemorySourceAutomatic = "automatic"
	recordingEntityMemorySourceManual    = "manual"
	recordingEntityMemoryFactExtracted   = "extracted"
	recordingEntityMemoryFactCorrection  = "manual_correction"
	recordingEntityIdentityPolicyKey     = "_identity_policy_class"
	recordingEntityIdentityConfidenceKey = "_identity_policy_confidence"
	recordingEntityIdentityStatusKey     = "_identity_status"
	recordingEntityIdentityEvidenceKey   = "_identity_policy_evidence"
	recordingEntityIdentityDiscriminator = "_identity_discriminator"
)

var recordingMemoryScopeMarkers = []string{"项目", "客户", "产品", "公司", "系统", "平台", "服务", "合同", "订单", "方案", "功能", "模块", "版本", "制度", "团队", "部门"}

var recordingMemoryGenericNames = map[string]map[string]struct{}{
	"person": {
		"技术研发人员": {}, "研发人员": {}, "技术人员": {}, "业务人员": {}, "工作人员": {}, "负责人": {},
		"管理人员": {}, "销售人员": {}, "开发人员": {}, "采购人员": {}, "客服人员": {}, "用户": {},
		"客户": {}, "业务方": {}, "研发团队": {}, "技术团队": {},
	},
	"matter": {
		"评审问题清单": {}, "问题清单": {}, "会议事项": {}, "待办事项": {}, "优化升级项目": {}, "需求变更": {}, "需求变化": {},
	},
	"risk": {
		"风险": {}, "落地使用风险": {}, "进度延期风险": {}, "需求变更风险": {}, "落地风险": {}, "使用风险": {},
		"延期风险": {}, "交付风险": {}, "技术风险": {}, "财务风险": {}, "合规风险": {},
	},
	"commitment": {
		"承诺事项": {}, "承诺": {}, "承诺清单": {},
	},
	"decision": {
		"决策": {}, "决策事项": {}, "决策方案": {},
	},
}

var recordingMemoryLowInformationFacts = map[string]struct{}{
	"嗯": {}, "哦": {}, "好的": {}, "知道了": {}, "收到": {}, "谢谢": {}, "是的": {}, "没问题": {}, "大家好": {}, "欢迎参加": {}, "开始吧": {},
}

var ErrRecordingEntityMemoryNotFound = errors.New("recording entity memory not found")
var ErrRecordingEntityMemoryHasFacts = errors.New("recording entity memory has active facts")
var ErrRecordingEntityMemoryDuplicate = errors.New("recording entity memory with same type and name already exists")
var ErrRecordingEntityMemoryCrossType = errors.New("recording entity memory merge requires same entity type")
var ErrRecordingEntityMemoryMergeSelf = errors.New("recording entity memory cannot merge into itself")
var ErrRecordingEntityMemoryModelNotConfigured = errors.New("recording entity memory merge requires inference model")
var ErrRecordingEntityMemoryRelationSelf = errors.New("recording entity memory cannot relate to itself")

type recordingEntityMemoryItem struct {
	entityType         string
	canonicalName      string
	mentionOnlyName    bool
	identityClass      string
	identityConfidence float64
	identityStatus     string
	summary            string
	attributes         map[string]string
	aliases            []string
	facts              []recordingEntityMemoryFactItem
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
	SourceFile     string            `json:"source_file"` // 最新一条事实的来源文件名（人工事实为空）
	Attributes     map[string]string `json:"attributes"`  // schema 过滤后的属性（英文键值，中文经 schema 接口映射）
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
	EntityType       string            `json:"entity_type"` // 所属实体类型（person/matter/risk/commitment/decision）
	FactKind         string            `json:"fact_kind"`
	Content          string            `json:"content"`
	Attributes       map[string]string `json:"attributes"`
	SourceSegmentIDs []string          `json:"source_segment_ids"`
	SourceType       string            `json:"source_type"`
	OccurredAt       int64             `json:"occurred_at"`
	SourceFile       string            `json:"source_file"`
	FileID           int64             `json:"file_id"`
	RelatedEntityID  int64             `json:"related_entity_id"` // 被关联实体 id（0=普通 fact；>0=从其他实体关联过来的 fact，详情回填）
	RelatedName      string            `json:"related_name"`      // 被关联实体名称（回填）
	RelatedType      string            `json:"related_type"`      // 被关联实体类型（回填）
	UpdatedTime      int64             `json:"updated_time"`
}

type RecordingMemoryEntityRelationView struct {
	ID              int64  `json:"id"`
	RelatedEntityID int64  `json:"related_entity_id"`
	RelatedName     string `json:"related_name"`
	RelatedType     string `json:"related_type"`
	RelationType    string `json:"relation_type"`
}

type CreateRecordingMemoryFactInput struct {
	RelatedEntityID int64 // 被关联实体 id（>0=从其他实体关联过来的 fact，内容由详情回填）；0=普通人工事实
	Content         string
	Attributes      map[string]string
}

type UpdateRecordingMemoryFactInput struct {
	ID              int64 // >0 表示修改既有事实（仅人工事实 file_id=0 可改）；0 表示新增
	RelatedEntityID int64 // >0 表示修改关联目标（被关联实体 id）；0=按 content 修改普通事实内容
	Content         string
	Attributes      map[string]string
}

type CreateRecordingMemoryEntityInput struct {
	EntityType    string
	CanonicalName string
	Summary       string
	Attributes    map[string]string
	Facts         []CreateRecordingMemoryFactInput
}

type UpdateRecordingMemoryEntityInput struct {
	CanonicalName  *string
	Summary        *string
	Attributes     map[string]string
	Facts          []UpdateRecordingMemoryFactInput
	DeletedFactIDs []int64
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
		case model.EntityTypeCommitment:
			result["commitment"] = true
		case model.EntityTypeDecision:
			result["decision"] = true
		}
	}
	return result
}

func isRecordingMinutesSource(raw string) bool {
	cleaned := strings.TrimPrefix(extractJSON(strings.TrimSpace(raw)), "\ufeff")
	return classifyRecordingContent(cleaned) == recordingContentMinutesJSON
}

// loadRecordingEntityMemorySource 读取安心录语义实体的结构化来源。
// 最新结构中 Summary(0) 是 Prompt 2 产出的唯一结构化语义来源。
// Summary(0) 缺失时由最新 FileBody 转写触发 Prompt 2；不读取旧布局。
func loadRecordingEntityMemorySource(fileID int64) (string, bool, error) {
	summary, summaryErr := model.GetSummaryByTemplateID(fileID, 0)
	if errors.Is(summaryErr, gorm.ErrRecordNotFound) {
		return "", false, nil
	}
	if summaryErr != nil {
		return "", false, summaryErr
	}
	if summary == nil {
		return "", false, nil
	}
	raw := strings.TrimSpace(string(summary.SummaryContent))
	if raw != "" && !isRecordingMinutesSource(raw) {
		return "", true, fmt.Errorf("Summary(0) 不是有效的会议纪要 JSON")
	}
	return raw, true, nil
}

// loadRecordingEntityMemoryTranscript 读取 ASR 转写源，并保留转写服务确认的 speaker 名称。
// 最新结构中 FileBody 始终是转写文本；可信 speaker person 始终从该源独立编译。
func loadRecordingEntityMemoryTranscript(eid, fileID int64) (string, error) {
	body, err := model.GetLastFileBodyByFileID(eid, fileID)
	if err != nil {
		return "", err
	}
	raw, err := body.GetContent()
	if err != nil {
		return "", err
	}
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", nil
	}
	switch classifyRecordingContent(raw) {
	case recordingContentTranscriptJSON:
		return RenderTranscriptMarkdown(raw, "")
	case recordingContentTranscriptMD, recordingContentUnknown:
		return raw, nil
	default:
		return "", nil
	}
}

// CompileRecordingEntityMemory 编译安心录专属的实体/事实记忆。
// 语义实体来自 Summary(0).memory_entities（缺失时由最新转写调用 Prompt 2），
// 可信 speaker person 来自最新 FileBody 转写；两者合并后落库。
func CompileRecordingEntityMemory(ctx context.Context, eid, fileID, ownerID int64) (int, error) {
	file, err := loadRecordingMemorySourceFile(ctx, eid, fileID)
	if err != nil {
		return 0, err
	}
	if !file.IsRecordingOriginType() {
		logger.Infof(ctx, "【实体记忆】跳过非录音来源 fileID=%d originType=%s", fileID, file.OriginType)
		return 0, nil
	}
	config, err := model.ValidateOrCreateRecordingConfig(eid)
	if err != nil {
		return 0, err
	}
	allowedTypes := recordingEntityTypesFromConfig(config)
	// 叠加 schema 类型限制：schema 外类型（如存量配置仍含 principle）不编译
	for entityType := range allowedTypes {
		if _, ok := model.RecordingMemoryEntitySchemas[entityType]; !ok {
			delete(allowedTypes, entityType)
		}
	}
	if len(allowedTypes) == 0 {
		return 0, nil
	}
	minutesRaw, hasSummary, err := loadRecordingEntityMemorySource(fileID)
	if err != nil {
		return 0, err
	}
	transcriptMD, transcriptErr := loadRecordingEntityMemoryTranscript(eid, fileID)
	if transcriptErr != nil {
		return 0, transcriptErr
	}

	var semanticRaw string
	var semanticItems []recordingEntityMemoryItem
	if hasSummary {
		semanticRaw = minutesRaw
		minutes, perr := parseRecordingMemoryMinutes(minutesRaw)
		if perr != nil {
			return 0, perr
		}
		semanticItems = buildRecordingEntityMemoryItems(minutes, allowedTypes)
	} else if strings.TrimSpace(transcriptMD) != "" {
		// 最新 FileBody 没有 Summary(0) 时，直接用同一套 Prompt 2 从转写抽取语义记忆。
		// Summary(0) 存在时不走该路径，避免合法空 memory_entities 被转写正文覆盖。
		semanticRaw, err = callMeetingMinutesLLM(recordingdebug.WithLLMStage(ctx, "entity_memory_llm"), config, eid, ownerID, fileID, transcriptMD, 0, 0)
		if err != nil {
			return 0, fmt.Errorf("从最新转写抽取会议记忆失败: %w", err)
		}
		minutes, perr := parseRecordingMemoryMinutes(semanticRaw)
		if perr != nil {
			return 0, perr
		}
		semanticItems = buildRecordingEntityMemoryItems(minutes, allowedTypes)
	}
	speakerItems := buildRecordingSpeakerEntities(transcriptMD, allowedTypes)
	items := mergeRecordingEntityMemoryItems(speakerItems, semanticItems)

	mentionedAt := recordingEntityMemoryOccurredAt(ctx, eid, fileID)
	sourceMaterial := strings.TrimSpace(semanticRaw)
	if transcriptMD != "" {
		sourceMaterial += "\n---recording-transcript---\n" + strings.TrimSpace(transcriptMD)
	}
	minutesHashBytes := sha256.Sum256([]byte(sourceMaterial))
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
			if err := retireEmptyGeneratedSpeakerEntity(tx, eid, ownerID, entityID); err != nil {
				return err
			}
		}
		return nil
	})
	if err == nil {
		logger.Infof(ctx, "【实体记忆】编译完成 eid=%d fileID=%d ownerID=%d entities=%d facts=%d", eid, fileID, ownerID, len(items), compiled)
		// 需求1：同名同类型自动融合（编译后触发；LLM 合并失败仅跳过该组，不阻塞编译）
		if n, merr := AutoMergeSameNameEntities(ctx, eid, ownerID); merr != nil {
			logger.Warnf(ctx, "【实体记忆】编译后自动融合失败 eid=%d ownerID=%d err=%v", eid, ownerID, merr)
		} else if n > 0 {
			logger.Infof(ctx, "【实体记忆】编译后自动融合 eid=%d ownerID=%d merged=%d", eid, ownerID, n)
		}
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
		if isGeneratedSpeakerLabel(name) || (name == "" && isGeneratedSpeakerLabel(mention)) {
			continue
		}
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
		aliases := make([]string, 0, len(stringSliceValue(row["aliases"])))
		for _, alias := range stringSliceValue(row["aliases"]) {
			if alias = strings.TrimSpace(alias); alias != "" && !isGeneratedSpeakerLabel(alias) {
				aliases = append(aliases, alias)
			}
		}
		item := recordingEntityMemoryItem{
			entityType:         kind,
			canonicalName:      name,
			mentionOnlyName:    mentionOnlyName,
			identityClass:      normalizeRecordingIdentityPolicyClass(stringValue(row["identity_policy_class"])),
			identityConfidence: normalizeRecordingIdentityPolicyConfidence(floatValue(row["identity_policy_confidence"])),
			identityStatus:     strings.ToLower(strings.TrimSpace(stringValue(row["identity_status"]))),
			summary:            strings.TrimSpace(stringValue(row["summary"])),
			attributes:         sanitizeRecordingMemoryAttributes(kind, stringMapValue(row["attributes"])),
			aliases:            aliases,
		}
		item.attributes[recordingEntityIdentityPolicyKey] = item.identityClass
		item.attributes[recordingEntityIdentityConfidenceKey] = fmt.Sprintf("%.4f", item.identityConfidence)
		if item.identityStatus != "" {
			item.attributes[recordingEntityIdentityStatusKey] = item.identityStatus
		}
		if evidence := memorySourceSegmentIDs(row["identity_policy_evidence_segment_ids"]); len(evidence) > 0 {
			item.attributes[recordingEntityIdentityEvidenceKey] = strings.Join(evidence, ",")
		}
		if discriminator := strings.TrimSpace(stringValue(row["identity_subject"])); discriminator != "" {
			item.attributes[recordingEntityIdentityDiscriminator] = discriminator
		} else if discriminator = strings.TrimSpace(stringValue(row["identity_binding"])); discriminator != "" {
			item.attributes[recordingEntityIdentityDiscriminator] = discriminator
		}
		// Conservative fallback: only a concrete named object may use the
		// ordinary cross-meeting name key. Unknown/conceptual objects and
		// unconfirmed people stay isolated to this file.
		if item.identityClass != "named_object" &&
			(item.identityClass == "unknown" || item.identityClass == "conceptual_object" ||
				(item.identityClass == "person" && item.identityStatus != "confirmed" && item.identityStatus != "manual_confirmed")) {
			item.mentionOnlyName = true
		}
		if item.identityClass == "conceptual_object" &&
			strings.TrimSpace(stringValue(row["identity_subject"])) == "" &&
			strings.TrimSpace(stringValue(row["identity_binding"])) == "" {
			item.mentionOnlyName = true
		}
		if mention != "" && mention != name && !isGeneratedSpeakerLabel(mention) {
			item.aliases = append(item.aliases, mention)
		}
		facts, _ := row["facts"].([]interface{})
		for _, rawFact := range facts {
			fact, ok := rawFact.(map[string]interface{})
			if !ok {
				continue
			}
			content := strings.TrimSpace(stringValue(fact["content"]))
			if !isUsefulRecordingMemoryFact(content) {
				continue
			}
			sourceSegmentIDs := memorySourceSegmentIDs(fact["source_segment_ids"])
			if len(sourceSegmentIDs) == 0 {
				continue
			}
			item.facts = append(item.facts, recordingEntityMemoryFactItem{
				content:          content,
				attributes:       sanitizeRecordingMemoryAttributes(kind, stringMapValue(fact["attributes"])),
				sourceSegmentIDs: sourceSegmentIDs,
			})
		}
		if len(item.facts) > 0 && isUsefulRecordingMemoryItem(item) {
			items = append(items, item)
		}
	}
	return items
}

func isUsefulRecordingMemoryItem(item recordingEntityMemoryItem) bool {
	if isGenericRecordingMemoryName(item.entityType, item.canonicalName) || !hasRecordingMemoryScope(item.entityType, item.canonicalName, item.attributes) {
		return false
	}
	if item.entityType == "person" {
		return true
	}
	return hasRecordingMemoryTypeAttribute(item.entityType, item.attributes)
}

func isGenericRecordingMemoryName(entityType, name string) bool {
	name = strings.Join(strings.Fields(strings.TrimSpace(name)), "")
	if _, ok := recordingMemoryGenericNames[entityType][name]; ok {
		return true
	}
	if entityType == "person" && (strings.HasSuffix(name, "人员") || strings.HasSuffix(name, "团队")) {
		return true
	}
	return false
}

func hasRecordingMemoryScope(entityType, name string, attributes map[string]string) bool {
	if entityType == "person" {
		return true
	}
	for _, marker := range recordingMemoryScopeMarkers {
		if strings.Contains(name, marker) {
			return true
		}
	}
	for _, r := range name {
		if (r >= '0' && r <= '9') || (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') {
			return true
		}
	}
	switch entityType {
	case "commitment":
		return strings.TrimSpace(attributes["due_date"]) != ""
	case "decision":
		return strings.TrimSpace(attributes["impact_scope"]) != ""
	}
	return false
}

func hasRecordingMemoryTypeAttribute(entityType string, attributes map[string]string) bool {
	schema, ok := model.RecordingMemoryEntitySchemas[entityType]
	if !ok {
		return false
	}
	for key := range schema.Attributes {
		if strings.TrimSpace(attributes[key]) != "" {
			return true
		}
	}
	return false
}

func isUsefulRecordingMemoryFact(content string) bool {
	content = strings.TrimSpace(content)
	if content == "" {
		return false
	}
	_, lowInformation := recordingMemoryLowInformationFacts[content]
	return !lowInformation
}

// mergeRecordingEntityMemoryItems 合并 ASR speaker 与纪要抽取的同名实体。
// speaker 身份来自可信 ASR 字段，身份状态优先于 Prompt 2 对同名实体的保守判断。
func mergeRecordingEntityMemoryItems(groups ...[]recordingEntityMemoryItem) []recordingEntityMemoryItem {
	result := make([]recordingEntityMemoryItem, 0)
	indexes := map[string]int{}
	for _, items := range groups {
		for _, item := range items {
			name := strings.TrimSpace(item.canonicalName)
			if name == "" {
				continue
			}
			item.canonicalName = name
			key := strings.ToLower(item.entityType) + "\x00" + normalizeRecordingMemoryEntityName(name)
			if index, ok := indexes[key]; ok {
				result[index] = mergeRecordingEntityMemoryItem(result[index], item)
				continue
			}
			indexes[key] = len(result)
			result = append(result, item)
		}
	}
	return result
}

func mergeRecordingEntityMemoryItem(existing, incoming recordingEntityMemoryItem) recordingEntityMemoryItem {
	preferred, secondary := existing, incoming
	if recordingEntityMemoryIdentityRank(incoming) > recordingEntityMemoryIdentityRank(existing) {
		preferred, secondary = incoming, existing
	}

	if strings.TrimSpace(preferred.summary) == "" {
		preferred.summary = secondary.summary
	}
	preferred.mentionOnlyName = preferred.mentionOnlyName && secondary.mentionOnlyName
	preferred.attributes = mergeRecordingMemoryAttributes(secondary.attributes, preferred.attributes)
	preferred.aliases = mergeRecordingMemoryAliases(secondary.aliases, preferred.aliases)
	preferred.facts = mergeRecordingEntityMemoryFacts(secondary.facts, preferred.facts)
	return preferred
}

func recordingEntityMemoryIdentityRank(item recordingEntityMemoryItem) int {
	if item.entityType == "person" && item.identityClass == "person" && item.identityStatus == "confirmed" && !item.mentionOnlyName {
		return 3
	}
	if item.identityStatus == "manual_confirmed" || item.identityClass == "named_object" {
		return 2
	}
	if !item.mentionOnlyName {
		return 1
	}
	return 0
}

func mergeRecordingEntityMemoryFacts(existing, incoming []recordingEntityMemoryFactItem) []recordingEntityMemoryFactItem {
	result := make([]recordingEntityMemoryFactItem, 0, len(existing)+len(incoming))
	seen := map[string]bool{}
	for _, facts := range [][]recordingEntityMemoryFactItem{existing, incoming} {
		for _, fact := range facts {
			content := strings.TrimSpace(fact.content)
			if content == "" {
				continue
			}
			key := content + "\x00" + strings.Join(fact.sourceSegmentIDs, ",")
			if seen[key] {
				continue
			}
			seen[key] = true
			fact.content = content
			result = append(result, fact)
		}
	}
	return result
}

func normalizeRecordingIdentityPolicyClass(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "person", "named_object", "conceptual_object":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return "unknown"
	}
}

func normalizeRecordingIdentityPolicyConfidence(value float64) float64 {
	if value < 0 {
		return 0
	}
	if value > 1 {
		return 1
	}
	return value
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
			if err := tx.Model(&entity).Updates(map[string]interface{}{"is_deleted": false, "updated_time": time.Now().UTC().UnixMilli()}).Error; err != nil {
				return nil, err
			}
		}
		return &entity, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	if item.entityType == "person" && !item.mentionOnlyName {
		legacyNormalized := normalizeRecordingMemoryEntityName(fmt.Sprintf("mention:%d:%s", fileID, item.canonicalName))
		var legacy model.RecordingMemoryEntity
		legacyErr := tx.Where("eid = ? AND owner_id = ? AND entity_type = ? AND normalized_name = ?", eid, ownerID, item.entityType, legacyNormalized).First(&legacy).Error
		if legacyErr == nil {
			if legacy.MergedIntoID != 0 {
				var target model.RecordingMemoryEntity
				if err := tx.Where("id = ? AND eid = ? AND owner_id = ? AND is_deleted = ?", legacy.MergedIntoID, eid, ownerID, false).First(&target).Error; err != nil {
					return nil, ErrRecordingEntityMemoryNotFound
				}
				return &target, nil
			}
			if err := tx.Model(&legacy).Updates(map[string]interface{}{
				"canonical_name":  item.canonicalName,
				"normalized_name": normalized,
				"is_deleted":      false,
				"updated_time":    time.Now().UTC().UnixMilli(),
			}).Error; err != nil {
				return nil, err
			}
			if err := tx.First(&legacy, legacy.ID).Error; err != nil {
				return nil, err
			}
			return &legacy, nil
		}
		if !errors.Is(legacyErr, gorm.ErrRecordNotFound) {
			return nil, legacyErr
		}
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
	// 方案 A（领导确认）：人工/自动内容等同，编译按较新会议一律可覆盖；
	// summary_source/attributes_source 仅作来源记录，不再阻止覆盖。
	isCurrentOrNewer := mentionedAt >= entity.LastFactAt
	if entity.FirstMentionedAt == 0 || (mentionedAt > 0 && mentionedAt < entity.FirstMentionedAt) {
		updates["first_mentioned_at"] = mentionedAt
	}
	if mentionedAt > entity.LastFactAt {
		updates["last_fact_at"] = mentionedAt
	}
	if isCurrentOrNewer && strings.TrimSpace(item.summary) != "" {
		updates["summary"] = item.summary
		updates["summary_source"] = recordingEntityMemorySourceAutomatic
	}
	if isCurrentOrNewer && len(item.attributes) > 0 {
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
	updates["updated_time"] = time.Now().UTC().UnixMilli()
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
			if value == "" || isGeneratedSpeakerLabel(value) || seen[value] {
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
	return tx.Model(&model.RecordingMemoryEntity{}).Where("id = ?", entityID).Updates(map[string]interface{}{"fact_count": count, "last_fact_at": last.OccurredAt, "updated_time": time.Now().UTC().UnixMilli()}).Error
}

// retireEmptyGeneratedSpeakerEntity 清理本次重编译后已无事实的历史默认 speaker 卡片。
// 仅处理自动生成的默认标签，人工创建/修改过的实体不受影响。
func retireEmptyGeneratedSpeakerEntity(tx *gorm.DB, eid, ownerID, entityID int64) error {
	var entity model.RecordingMemoryEntity
	if err := tx.Where("id = ? AND eid = ? AND owner_id = ?", entityID, eid, ownerID).First(&entity).Error; err != nil {
		return err
	}
	if entity.IsDeleted || entity.MergedIntoID != 0 || !isGeneratedSpeakerLabel(entity.CanonicalName) ||
		entity.SummarySource != recordingEntityMemorySourceAutomatic || entity.AttributesSource != recordingEntityMemorySourceAutomatic {
		return nil
	}
	if entity.FactCount != 0 {
		return nil
	}
	return tx.Model(&entity).Updates(map[string]interface{}{
		"is_deleted":      true,
		"normalized_name": "",
		"updated_time":    time.Now().UTC().UnixMilli(),
	}).Error
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
	if err := query.Order("updated_time DESC").Offset(offset).Limit(limit).Find(&entities).Error; err != nil {
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
	sourceFiles, err := recordingMemoryEntityLatestSourceFiles(ctx, s.eid, userID, entityIDs)
	if err != nil {
		return nil, err
	}
	items := make([]RecordingMemoryEntityListItem, 0, len(entities))
	for _, entity := range entities {
		item := recordingMemoryEntityListItem(entity, sourceMeetings[entity.ID])
		item.SourceFile = sourceFiles[entity.ID]
		items = append(items, item)
	}
	return &RecordingMemoryEntityList{Items: items, Total: total}, nil
}

// recordingMemoryEntityLatestSourceFiles 返回每个实体最新一条事实的来源文件名。
// 最新事实为人工添加（file_id=0）时返回空字符串；无活动事实的实体同样为空。
func recordingMemoryEntityLatestSourceFiles(ctx context.Context, eid, ownerID int64, entityIDs []int64) (map[int64]string, error) {
	result := make(map[int64]string, len(entityIDs))
	if len(entityIDs) == 0 {
		return result, nil
	}
	type latestFactRow struct {
		EntityID int64
		FileID   int64
	}
	var rows []latestFactRow
	const latestSQL = `SELECT f.entity_id, f.file_id FROM recording_memory_facts f
WHERE f.eid = ? AND f.owner_id = ? AND f.entity_id IN ? AND f.is_deleted = ?
  AND NOT EXISTS (
    SELECT 1 FROM recording_memory_facts g
    WHERE g.eid = f.eid AND g.owner_id = f.owner_id AND g.entity_id = f.entity_id AND g.is_deleted = ?
      AND (g.occurred_at > f.occurred_at OR (g.occurred_at = f.occurred_at AND g.id > f.id))
  )`
	if err := model.DB.WithContext(ctx).Raw(latestSQL, eid, ownerID, entityIDs, false, false).Scan(&rows).Error; err != nil {
		return result, err
	}
	fileIDs := make([]int64, 0, len(rows))
	for _, row := range rows {
		if row.FileID > 0 {
			fileIDs = append(fileIDs, row.FileID)
		}
	}
	fileNames := recordingMemorySourceFileNames(ctx, eid, ownerID, fileIDs)
	for _, row := range rows {
		result[row.EntityID] = fileNames[row.FileID]
	}
	return result, nil
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
	relatedIDs := make([]int64, 0, len(facts))
	for _, fact := range facts {
		if fact.FileID > 0 {
			fileIDs = append(fileIDs, fact.FileID)
		}
		if fact.RelatedEntityID > 0 {
			relatedIDs = append(relatedIDs, fact.RelatedEntityID)
		}
	}
	fileNames := recordingMemorySourceFileNames(ctx, s.eid, userID, fileIDs)
	relatedEntities := recordingMemoryRelatedEntityInfos(ctx, s.eid, userID, relatedIDs)
	relatedLatest := recordingMemoryRelatedLatestFacts(ctx, s.eid, userID, relatedIDs)
	for _, fact := range facts {
		view := RecordingMemoryEntityFactView{ID: fact.ID, EntityType: entity.EntityType, FactKind: fact.FactKind, Content: string(fact.Content), Attributes: decodeStringMap(fact.AttributesJSON), SourceSegmentIDs: decodeStringSlice(fact.SourceSegmentIDs), SourceType: fact.SourceType, OccurredAt: fact.OccurredAt, SourceFile: fileNames[fact.FileID], FileID: fact.FileID, UpdatedTime: fact.UpdatedTime}
		if fact.RelatedEntityID > 0 {
			// 关联 fact：实体字段按被关联实体当前内容回填（content=summary、attributes、来源=最新事实）
			view.RelatedEntityID = fact.RelatedEntityID
			if ri, ok := relatedEntities[fact.RelatedEntityID]; ok {
				view.RelatedName = ri.Name
				view.RelatedType = ri.Type
				view.Content = ri.Summary
				view.Attributes = ri.Attributes
			}
			if rf, ok := relatedLatest[fact.RelatedEntityID]; ok {
				view.FileID = rf.FileID
				view.SourceFile = rf.SourceFile
				view.SourceSegmentIDs = rf.SegmentIDs
			}
		}
		detail.Facts = append(detail.Facts, view)
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

// recordingMemoryRelatedLatestOccurredAt 取被关联实体最新一条未删除事实的 occurred_at（会议时间）；
// 无任何事实时返回 0（由调用方兜底）。
func recordingMemoryRelatedLatestOccurredAt(tx *gorm.DB, eid, ownerID, entityID int64) (int64, error) {
	var last model.RecordingMemoryFact
	err := tx.Where("eid = ? AND owner_id = ? AND entity_id = ? AND is_deleted = ?", eid, ownerID, entityID, false).
		Order("occurred_at DESC, id DESC").First(&last).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	return last.OccurredAt, nil
}

// recordingMemoryRelatedEntityInfos 批量取被关联实体信息（名称/类型/描述/属性），用于关联 fact 回填。
func recordingMemoryRelatedEntityInfos(ctx context.Context, eid, ownerID int64, entityIDs []int64) map[int64]recordingMemoryRelatedEntityInfo {
	result := make(map[int64]recordingMemoryRelatedEntityInfo, len(entityIDs))
	if len(entityIDs) == 0 {
		return result
	}
	var entities []model.RecordingMemoryEntity
	if err := model.DB.WithContext(ctx).Where("id IN ? AND eid = ? AND owner_id = ? AND merged_into_id = ? AND is_deleted = ?", entityIDs, eid, ownerID, 0, false).Find(&entities).Error; err != nil {
		return result
	}
	for _, e := range entities {
		result[e.ID] = recordingMemoryRelatedEntityInfo{Name: e.CanonicalName, Type: e.EntityType, Summary: string(e.Summary), Attributes: decodeStringMap(e.AttributesJSON)}
	}
	return result
}

type recordingMemoryRelatedEntityInfo struct {
	Name       string
	Type       string
	Summary    string
	Attributes map[string]string
}

// recordingMemoryRelatedLatestFacts 批量取被关联实体的最新一条事实（来源字段），用于关联 fact 回填。
func recordingMemoryRelatedLatestFacts(ctx context.Context, eid, ownerID int64, entityIDs []int64) map[int64]recordingMemoryRelatedLatestFact {
	result := make(map[int64]recordingMemoryRelatedLatestFact, len(entityIDs))
	if len(entityIDs) == 0 {
		return result
	}
	type row struct {
		EntityID         int64
		FileID           int64
		SourceSegmentIDs string
	}
	var rows []row
	const latestSQL = `SELECT f.entity_id, f.file_id, f.source_segment_ids FROM recording_memory_facts f
WHERE f.eid = ? AND f.owner_id = ? AND f.entity_id IN ? AND f.is_deleted = ?
  AND NOT EXISTS (
    SELECT 1 FROM recording_memory_facts g
    WHERE g.eid = f.eid AND g.owner_id = f.owner_id AND g.entity_id = f.entity_id AND g.is_deleted = ?
      AND (g.occurred_at > f.occurred_at OR (g.occurred_at = f.occurred_at AND g.id > f.id))
  )`
	if err := model.DB.WithContext(ctx).Raw(latestSQL, eid, ownerID, entityIDs, false, false).Scan(&rows).Error; err != nil {
		return result
	}
	fileIDs := make([]int64, 0, len(rows))
	for _, r := range rows {
		if r.FileID > 0 {
			fileIDs = append(fileIDs, r.FileID)
		}
	}
	fileNames := recordingMemorySourceFileNames(ctx, eid, ownerID, fileIDs)
	for _, r := range rows {
		result[r.EntityID] = recordingMemoryRelatedLatestFact{FileID: r.FileID, SourceFile: fileNames[r.FileID], SegmentIDs: decodeStringSlice(model.LongText(r.SourceSegmentIDs))}
	}
	return result
}

type recordingMemoryRelatedLatestFact struct {
	FileID     int64
	SourceFile string
	SegmentIDs []string
}

// Create 手工新增一条实体记忆（summary_source=manual 记录来源；行为上与自动实体等同，
// 后续较新会议编译可覆盖其描述/属性）。实体类型不可选 schema 之外的值；
// 同类型同名已存在时返回 ErrRecordingEntityMemoryDuplicate，引导用户改用融合。
func (s *RecordingMemoryEntityService) Create(ctx context.Context, userID int64, input CreateRecordingMemoryEntityInput) (*RecordingMemoryEntityDetail, error) {
	if err := s.ensureAccess(ctx, userID, true); err != nil {
		return nil, err
	}
	entityType := strings.TrimSpace(input.EntityType)
	if _, ok := model.RecordingMemoryEntitySchemas[entityType]; !ok {
		return nil, errors.New("unsupported recording entity type")
	}
	name := strings.TrimSpace(input.CanonicalName)
	if name == "" {
		return nil, errors.New("entity name is empty")
	}
	now := time.Now().UTC().UnixMilli()
	attributesJSON, err := json.Marshal(sanitizeRecordingMemoryAttributes(entityType, input.Attributes))
	if err != nil {
		return nil, err
	}
	var createdID int64
	err = model.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var duplicate int64
		if err := tx.Model(&model.RecordingMemoryEntity{}).
			Where("eid = ? AND owner_id = ? AND entity_type = ? AND normalized_name = ? AND merged_into_id = ? AND is_deleted = ?",
				s.eid, userID, entityType, normalizeRecordingMemoryEntityName(name), 0, false).
			Count(&duplicate).Error; err != nil {
			return err
		}
		if duplicate > 0 {
			return ErrRecordingEntityMemoryDuplicate
		}
		entity := &model.RecordingMemoryEntity{
			Eid:              s.eid,
			OwnerID:          userID,
			EntityType:       entityType,
			CanonicalName:    name,
			NormalizedName:   normalizeRecordingMemoryEntityName(name),
			Summary:          model.LongText(strings.TrimSpace(input.Summary)),
			AttributesJSON:   model.LongText(attributesJSON),
			AliasesJSON:      "[]",
			SummarySource:    recordingEntityMemorySourceManual,
			AttributesSource: recordingEntityMemorySourceManual,
			FirstMentionedAt: now,
			LastFactAt:       now,
		}
		if err := tx.Create(entity).Error; err != nil {
			return err
		}
		createdID = entity.ID
		if err := createRecordingMemoryManualFacts(tx, s.eid, userID, entityType, entity.ID, input.Facts, now); err != nil {
			return err
		}
		if err := refreshRecordingMemoryEntityStats(tx, s.eid, userID, entity.ID); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.Detail(ctx, userID, createdID)
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
			// 编辑不允许改成活动中的同名实体（同类型同名；已删除的不算）。
			var duplicate int64
			if err := tx.Model(&model.RecordingMemoryEntity{}).
				Where("eid = ? AND owner_id = ? AND entity_type = ? AND normalized_name = ? AND id != ? AND merged_into_id = ? AND is_deleted = ?",
					s.eid, userID, entity.EntityType, normalizeRecordingMemoryEntityName(name), entity.ID, 0, false).
				Count(&duplicate).Error; err != nil {
				return err
			}
			if duplicate > 0 {
				return ErrRecordingEntityMemoryDuplicate
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
		if len(updates) == 0 && len(input.Facts) == 0 && len(input.DeletedFactIDs) == 0 {
			return nil
		}
		if len(updates) > 0 {
			updates["updated_time"] = time.Now().UTC().UnixMilli()
			if err := tx.Model(&entity).Updates(updates).Error; err != nil {
				return err
			}
		}
		if err := updateRecordingMemoryEntityFacts(tx, s.eid, userID, &entity, input); err != nil {
			return err
		}
		if len(input.Facts) > 0 || len(input.DeletedFactIDs) > 0 {
			return refreshRecordingMemoryEntityStats(tx, s.eid, userID, entityID)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.Detail(ctx, userID, entityID)
}

// createRecordingMemoryManualFacts 创建一批人工事实：RelatedEntityID>0 为"从其他实体关联过来的 fact"
// （存 related_entity_id，内容由详情按被关联实体回填）；RelatedEntityID=0 为普通 content 人工事实。
// 编辑表单语义：只挂事实，不更新实体描述/属性（与 AddManualCorrection 的"人工修正"语义区分）。
// 普通事实 occurred_at=调用方 now（与原实现一致）；关联 fact occurred_at=被关联实体最新事实的会议时间。
func createRecordingMemoryManualFacts(tx *gorm.DB, eid, userID int64, entityType string, entityID int64, facts []CreateRecordingMemoryFactInput, now int64) error {
	for i, fact := range facts {
		seed := fmt.Sprintf("manual|%d|%d|%d|%d", entityID, userID, now, i)
		if err := createRecordingMemoryFact(tx, eid, userID, entityType, entityID, fact, seed, now); err != nil {
			return err
		}
	}
	return nil
}

// createRecordingMemoryFact 创建一条人工事实（普通 content 或关联实体）。
// now 为调用方统一取的时间戳（同批事实一致，与 occurred_at 同源，保持原逻辑）。
func createRecordingMemoryFact(tx *gorm.DB, eid, userID int64, entityType string, entityID int64, fact CreateRecordingMemoryFactInput, seed string, now int64) error {
	if fact.RelatedEntityID > 0 {
		if err := ensureRelatedEntity(tx, eid, userID, entityID, fact.RelatedEntityID); err != nil {
			return err
		}
		// occurred_at = 被关联实体最新事实的会议时间（与 recordingEntityMemoryOccurredAt 语义一致），
		// 被关联实体无任何事实时兜底为 now。
		relatedOccurredAt, err := recordingMemoryRelatedLatestOccurredAt(tx, eid, userID, fact.RelatedEntityID)
		if err != nil {
			return err
		}
		if relatedOccurredAt == 0 {
			relatedOccurredAt = now
		}
		hash := sha256.Sum256([]byte(seed))
		f := &model.RecordingMemoryFact{
			Eid: eid, OwnerID: userID, EntityID: entityID, FileID: 0,
			SourceKey:        hex.EncodeToString(hash[:]),
			FactKind:         recordingEntityMemoryFactCorrection,
			Content:          model.LongText(""),
			AttributesJSON:   model.LongText("{}"),
			SourceSegmentIDs: model.LongText("[]"),
			SourceType:       recordingEntityMemorySourceManual,
			OccurredAt:       relatedOccurredAt,
			RelatedEntityID:  fact.RelatedEntityID,
		}
		return tx.Create(f).Error
	}
	content := strings.TrimSpace(fact.Content)
	if content == "" {
		return errors.New("fact content is empty")
	}
	hash := sha256.Sum256([]byte(seed))
	attributesJSON, _ := json.Marshal(sanitizeRecordingMemoryAttributes(entityType, fact.Attributes))
	f := &model.RecordingMemoryFact{
		Eid: eid, OwnerID: userID, EntityID: entityID, FileID: 0,
		SourceKey:        hex.EncodeToString(hash[:]),
		FactKind:         recordingEntityMemoryFactCorrection,
		Content:          model.LongText(content),
		AttributesJSON:   model.LongText(attributesJSON),
		SourceSegmentIDs: model.LongText("[]"),
		SourceType:       recordingEntityMemorySourceManual,
		OccurredAt:       now,
	}
	return tx.Create(f).Error
}

// ensureRelatedEntity 校验被关联实体存在（活动、非自关联）。
func ensureRelatedEntity(tx *gorm.DB, eid, userID, entityID, relatedID int64) error {
	if relatedID == entityID {
		return ErrRecordingEntityMemoryRelationSelf
	}
	var count int64
	if err := tx.Model(&model.RecordingMemoryEntity{}).
		Where("id = ? AND eid = ? AND owner_id = ? AND merged_into_id = ? AND is_deleted = ?", relatedID, eid, userID, 0, false).
		Count(&count).Error; err != nil {
		return err
	}
	if count == 0 {
		return ErrRecordingEntityMemoryNotFound
	}
	return nil
}

// updateRecordingMemoryEntityFacts 处理编辑实体时的批量事实操作：
// 无 ID 的条目为新增（普通 content 或关联实体）；有 ID 的条目为修改，人工/自动事实均可（暂不限制）；
// 修改时 RelatedEntityID>0 改关联目标、RelatedEntityID=0 改普通内容；DeletedFactIDs 软删活动事实（不存在返回 ErrRecordingEntityMemoryNotFound）。
func updateRecordingMemoryEntityFacts(tx *gorm.DB, eid, userID int64, entity *model.RecordingMemoryEntity, input UpdateRecordingMemoryEntityInput) error {
	now := time.Now().UTC().UnixMilli()
	for i, fact := range input.Facts {
		if fact.ID == 0 {
			seed := fmt.Sprintf("manual|%d|%d|%d|%d", entity.ID, userID, now, i)
			createInput := CreateRecordingMemoryFactInput{RelatedEntityID: fact.RelatedEntityID, Content: fact.Content, Attributes: fact.Attributes}
			if err := createRecordingMemoryFact(tx, eid, userID, entity.EntityType, entity.ID, createInput, seed, now); err != nil {
				return err
			}
			continue
		}
		if fact.RelatedEntityID > 0 {
			// 修改关联目标（被关联实体）：occurred_at 同步为被关联实体最新事实的会议时间
			if err := ensureRelatedEntity(tx, eid, userID, entity.ID, fact.RelatedEntityID); err != nil {
				if err != ErrRecordingEntityMemoryNotFound {
					return err
				}
				// 目标实体不存在（如已被删除）。若当前事实已关联到同一目标，则本次请求无实际变更，视为成功；
				// 否则（试图新增指向已删除实体的关联）按不存在处理。
				var cur model.RecordingMemoryFact
				if err2 := tx.Select("related_entity_id").
					Where("id = ? AND eid = ? AND owner_id = ? AND entity_id = ? AND is_deleted = ?", fact.ID, eid, userID, entity.ID, false).
					First(&cur).Error; err2 != nil {
					return ErrRecordingEntityMemoryNotFound
				}
				if cur.RelatedEntityID != fact.RelatedEntityID {
					return err
				}
				continue
			}
			relatedOccurredAt, err := recordingMemoryRelatedLatestOccurredAt(tx, eid, userID, fact.RelatedEntityID)
			if err != nil {
				return err
			}
			if relatedOccurredAt == 0 {
				relatedOccurredAt = now
			}
			result := tx.Model(&model.RecordingMemoryFact{}).
				Where("id = ? AND eid = ? AND owner_id = ? AND entity_id = ? AND is_deleted = ?", fact.ID, eid, userID, entity.ID, false).
				Updates(map[string]interface{}{"related_entity_id": fact.RelatedEntityID, "occurred_at": relatedOccurredAt, "source_type": recordingEntityMemorySourceManual})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected == 0 {
				exists, err := recordingMemoryFactExists(tx, eid, userID, entity.ID, fact.ID)
				if err != nil {
					return err
				}
				if !exists {
					return ErrRecordingEntityMemoryNotFound
				}
				// 事实存在但值无变化（如重复设置相同关联目标）→ 视为成功
			}
			continue
		}
		// 修改普通事实内容（related_entity_id=0）
		content := strings.TrimSpace(fact.Content)
		if content == "" {
			// 未提供 content：视为保持普通事实不变（前端常以 related_entity_id="0" 表示无关联），不报错
			continue
		}
		attributesJSON, _ := json.Marshal(sanitizeRecordingMemoryAttributes(entity.EntityType, fact.Attributes))
		result := tx.Model(&model.RecordingMemoryFact{}).
			Where("id = ? AND eid = ? AND owner_id = ? AND entity_id = ? AND is_deleted = ?", fact.ID, eid, userID, entity.ID, false).
			Updates(map[string]interface{}{"content": content, "attributes_json": string(attributesJSON), "source_type": recordingEntityMemorySourceManual})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			exists, err := recordingMemoryFactExists(tx, eid, userID, entity.ID, fact.ID)
			if err != nil {
				return err
			}
			if !exists {
				return ErrRecordingEntityMemoryNotFound
			}
			// 事实存在但值无变化（如重复设置相同内容）→ 视为成功
		}
	}
	for _, factID := range input.DeletedFactIDs {
		result := tx.Model(&model.RecordingMemoryFact{}).
			Where("id = ? AND eid = ? AND owner_id = ? AND entity_id = ? AND is_deleted = ?", factID, eid, userID, entity.ID, false).
			Updates(map[string]interface{}{"is_deleted": true})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return ErrRecordingEntityMemoryNotFound
		}
	}
	return nil
}

// recordingMemoryFactExists 判断指定活动事实是否存在（属于该实体且未删除）。
func recordingMemoryFactExists(tx *gorm.DB, eid, userID, entityID, factID int64) (bool, error) {
	var count int64
	if err := tx.Model(&model.RecordingMemoryFact{}).
		Where("id = ? AND eid = ? AND owner_id = ? AND entity_id = ? AND is_deleted = ?", factID, eid, userID, entityID, false).
		Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
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
		"updated_time":   time.Now().UTC().UnixMilli(),
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

func (s *RecordingMemoryEntityService) DeleteEntity(ctx context.Context, userID, entityID int64) error {
	if err := s.ensureAccess(ctx, userID, true); err != nil {
		return err
	}
	return model.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&model.RecordingMemoryEntity{}).
			Where("id = ? AND eid = ? AND owner_id = ? AND merged_into_id = ? AND is_deleted = ?", entityID, s.eid, userID, 0, false).
			Updates(map[string]interface{}{"is_deleted": true, "normalized_name": gorm.Expr("NULL")})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return ErrRecordingEntityMemoryNotFound
		}
		// 级联软删其实体事实，保持"已删除实体不再有任何有效内容"的不变量。
		if err := tx.Model(&model.RecordingMemoryFact{}).
			Where("eid = ? AND owner_id = ? AND entity_id = ? AND is_deleted = ?", s.eid, userID, entityID, false).
			Updates(map[string]interface{}{"is_deleted": true}).Error; err != nil {
			return err
		}
		// 删除该实体的所有关联关系（人工关联不再有意义）。
		return tx.Where("eid = ? AND owner_id = ? AND (entity_id = ? OR related_entity_id = ?)", s.eid, userID, entityID, entityID).
			Delete(&model.RecordingMemoryEntityRelation{}).Error
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
		// 公共底层：facts 去重迁移 + 关联修正 + content/summary 旧名替换 + aliases + relation + source 软删 + stats。
		// 单源融合现状不调 LLM 合并描述（mergedSummary 传空，不更新 summary）。
		return mergeRecordingEntitiesTx(tx, s.eid, userID, []int64{sourceID}, targetID, "")
	})
	if err != nil {
		return nil, err
	}
	return s.Detail(ctx, userID, targetID)
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
		if fact.SourceType == recordingEntityMemorySourceAutomatic && !recordingMemoryEntityMayRecall(entity) {
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
			RecallReason:      "当前会议实体对应的历史事实",
			AssertionState:    "confirmed",
			LifecycleState:    "open",
			ReviewState:       recordingMemoryReviewConfirmed,
			SourceFileID:      fact.FileID,
			SourceFile:        sourceFile,
			SourceConfidence:  1,
			EvidenceAvailable: fact.SourceType == recordingEntityMemorySourceManual || len(decodeStringSlice(fact.SourceSegmentIDs)) > 0,
			SourceSegmentIDs:  decodeStringSlice(fact.SourceSegmentIDs),
			RecallPath:        []string{"entity:" + entity.EntityType, "fact"},
		})
	}
	return rows
}

func recordingMemoryEntityMayRecall(entity model.RecordingMemoryEntity) bool {
	attributes := decodeStringMap(entity.AttributesJSON)
	switch attributes[recordingEntityIdentityPolicyKey] {
	case "named_object":
		return true
	case "person":
		return attributes[recordingEntityIdentityStatusKey] == "confirmed" || attributes[recordingEntityIdentityStatusKey] == "manual_confirmed"
	case "conceptual_object":
		return strings.TrimSpace(attributes[recordingEntityIdentityDiscriminator]) != ""
	default:
		return false
	}
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
