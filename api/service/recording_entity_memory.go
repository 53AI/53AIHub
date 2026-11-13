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

	"github.com/53AI/53AIHub/common"
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
	// recordingEntityMemoryFactBelongsTo 是"人物所属企业"结构化关联的关系类型，直接作为 fact_kind 使用。
	// 事实类 fact_kind 只有 extracted / manual_correction，其余取值一律视为结构化关联（不进 facts[]）。
	recordingEntityMemoryFactBelongsTo   = "belongs_to"
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
	"company": {
		"公司": {}, "客户公司": {}, "该公司": {}, "贵公司": {}, "甲方": {}, "乙方": {}, "供应商": {}, "合作伙伴": {}, "同行": {},
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
	"然后": {}, "然后呢": {}, "嗯嗯": {}, "啊": {}, "就是": {},
}

var ErrRecordingEntityMemoryNotFound = errors.New("recording entity memory not found")
var ErrRecordingEntityMemoryHasFacts = errors.New("recording entity memory has active facts")
var ErrRecordingEntityMemoryDuplicate = errors.New("recording entity memory with same type and name already exists")
var ErrRecordingEntityMemoryCrossType = errors.New("recording entity memory merge requires same entity type")
var ErrRecordingEntityMemoryMergeSelf = errors.New("recording entity memory cannot merge into itself")
var ErrRecordingEntityMemoryModelNotConfigured = errors.New("recording entity memory merge requires inference model")
var ErrRecordingEntityMemoryRelationSelf = errors.New("recording entity memory cannot relate to itself")
var ErrRecordingEntityMemoryRelationTooMany = errors.New("recording entity memory allows at most one company per person")
var ErrRecordingEntityMemoryRelationTypeMismatch = errors.New("recording entity memory company link requires one person and one company")
var ErrRecordingEntityMemoryRelationTypeUnsupported = errors.New("recording entity memory relation type is not supported")

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
	companyName        string // 人物所属企业名称（抽取用中间态，不作为人物属性落库）
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
	Aliases        []string          `json:"aliases"`     // 其他称呼（人物别称）
	Attributes     map[string]string `json:"attributes"`  // schema 过滤后的属性（英文键值，中文经 schema 接口映射）
	// 结构化关联（belongs_to）：人物行返回所属企业；企业行返回关联人物数量
	RelatedCompany     *RecordingMemoryEntityRelationView `json:"related_company,omitempty"`
	RelatedPersonCount int64                              `json:"related_person_count,omitempty"`
}

type RecordingMemoryEntityDetail struct {
	RecordingMemoryEntityListItem
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
	ID              int64             `json:"id"`
	RelatedEntityID int64             `json:"related_entity_id"`
	RelatedName     string            `json:"related_name"`
	RelatedType     string            `json:"related_type"`
	RelationType    string            `json:"relation_type"`
	Summary         string            `json:"summary"`    // 被关联实体描述
	Attributes      map[string]string `json:"attributes"` // 被关联实体属性（schema 过滤）
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

// RecordingMemoryRelationInput 一组结构化关联：按 relation_type 替换该类型的关联集合。
// 未出现在入参中的 relation_type 保持不变；空切片表示清空该类型。
type RecordingMemoryRelationInput struct {
	RelationType     string
	RelatedEntityIDs []int64
}

type CreateRecordingMemoryEntityInput struct {
	EntityType    string
	CanonicalName string
	Summary       string
	Attributes    map[string]string
	Facts         []CreateRecordingMemoryFactInput
	Aliases       *[]string                      // 人工别称；替换语义
	Relations     []RecordingMemoryRelationInput // 结构化关联（belongs_to）：人物传所属企业，企业传关联人物
}

type UpdateRecordingMemoryEntityInput struct {
	CanonicalName  *string
	Summary        *string
	Attributes     map[string]string
	Facts          []UpdateRecordingMemoryFactInput
	DeletedFactIDs []int64
	Aliases        *[]string                       // 人工别称；替换语义，nil=不改
	Relations      *[]RecordingMemoryRelationInput // 结构化关联：nil=不改，按 relation_type 替换
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
	if config == nil || config.MemoryExtraction == nil || !config.MemoryExtraction.Enabled {
		return result
	}
	// 人员（人物）与企业默认开启抽取，不受配置影响
	result["person"] = true
	result["company"] = true

	// 其他业务记忆类型按配置原逻辑
	for _, kind := range config.MemoryExtraction.Types {
		switch kind {
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

// loadRecordingEntityMemorySource 读取安心录语义实体的结构化来源（纪要 JSON）。
// 优先 Summary(0)；转写布局反转后纪要也可能落在 FileBody（此时转写原文在 Summary(-1)），
// 故 Summary(0) 缺失时若 FileBody 内容是纪要 JSON 同样采用。
func loadRecordingEntityMemorySource(eid, fileID int64) (string, bool, error) {
	summary, summaryErr := model.GetSummaryByTemplateID(fileID, 0)
	if summaryErr != nil && !errors.Is(summaryErr, gorm.ErrRecordNotFound) {
		return "", false, summaryErr
	}
	if summary != nil {
		raw := strings.TrimSpace(string(summary.SummaryContent))
		if raw != "" {
			if !isRecordingMinutesSource(raw) {
				return "", true, fmt.Errorf("Summary(0) 不是有效的会议纪要 JSON")
			}
			return raw, true, nil
		}
	}
	body, err := model.GetLastFileBodyByFileID(eid, fileID)
	if err != nil {
		return "", false, nil
	}
	content, err := body.GetContent()
	if err != nil {
		return "", false, err
	}
	if raw := strings.TrimSpace(content); raw != "" && isRecordingMinutesSource(raw) {
		return raw, true, nil
	}
	return "", false, nil
}

// loadRecordingEntityMemoryTranscript 读取 ASR 转写源，并保留转写服务确认的 speaker 名称。
// 转写原文当前存在 Summary(-1)（反转后布局），旧布局存放在 FileBody，两条路径都要兼容。
func loadRecordingEntityMemoryTranscript(eid, fileID int64) (string, error) {
	raw := ""
	if summary, err := model.GetSummaryByTemplateID(fileID, -1); err == nil && summary != nil {
		raw = strings.TrimSpace(string(summary.SummaryContent))
	}
	if raw == "" {
		body, err := model.GetLastFileBodyByFileID(eid, fileID)
		if err != nil {
			return "", err
		}
		content, err := body.GetContent()
		if err != nil {
			return "", err
		}
		raw = strings.TrimSpace(content)
	}
	if raw == "" {
		return "", nil
	}
	switch classifyRecordingContent(raw) {
	case recordingContentTranscriptJSON:
		return RenderTranscriptMarkdown(raw, "")
	case recordingContentTranscriptMD, recordingContentUnknown:
		return common.StripInternalContactComments(raw), nil
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
	minutesRaw, hasSummary, err := loadRecordingEntityMemorySource(eid, fileID)
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
			// 原始 speaker 只用于补充同名实体身份；没有语义事实时不建立空人物档案。
			if len(item.facts) == 0 {
				continue
			}
			entity, err := findOrCreateRecordingMemoryEntity(tx, eid, ownerID, fileID, item, mentionedAt)
			if errors.Is(err, errRecordingMemoryBindingRetired) {
				continue
			}
			if err != nil {
				return err
			}
			if err := saveRecordingMemoryEntityBinding(tx, eid, ownerID, fileID, item.entityType, recordingMemoryMentionKey(fileID, item), item.canonicalName, entity.ID, "automatic"); err != nil {
				return err
			}
			confirmed, err := isRecordingMemoryBindingConfirmed(tx, eid, ownerID, fileID, item.entityType, recordingMemoryMentionKey(fileID, item))
			if err != nil {
				return err
			}
			if !confirmed {
				if err := updateAutomaticRecordingMemoryEntity(tx, entity, item, mentionedAt); err != nil {
					return err
				}
			}
			// 人物所属企业：按名称查找/新建企业实体并建立关联（企业记忆的唯一真相，不再存 person.company）
			if !confirmed && item.entityType == "person" && item.companyName != "" {
				if err := linkRecordingMemoryEntityCompanyForFile(tx, eid, ownerID, fileID, entity.ID, item.companyName, mentionedAt); err != nil {
					return err
				}
			}
			// 同一实体已有有效自动事实或人工修正时不重复新增相同内容；数据变化仍留下新版本。
			var priorFacts []model.RecordingMemoryFact
			if err := tx.Where("eid = ? AND owner_id = ? AND entity_id = ? AND file_id <> ? AND fact_kind IN ? AND is_deleted = ?", eid, ownerID, entity.ID, fileID, []string{recordingEntityMemoryFactExtracted, recordingEntityMemoryFactCorrection}, false).Find(&priorFacts).Error; err != nil {
				return err
			}
			known := map[string]bool{}
			for _, previous := range priorFacts {
				known[recordingMemoryFactCanonicalKey(string(previous.Content))] = true
			}
			for factIndex, fact := range item.facts {
				if !isUsefulRecordingMemoryFact(fact.content) || known[recordingMemoryFactCanonicalKey(fact.content)] {
					continue
				}
				known[recordingMemoryFactCanonicalKey(fact.content)] = true
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
			companyName:        strings.TrimSpace(stringMapValue(row["attributes"])["company"]),
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
		// 其他称呼仅人员保留，且不收录与主名相同的项
		item.aliases = CleanRecordingMemoryAliases(kind, name, mergeRecordingMemoryAliases(nil, item.aliases))
		facts, _ := row["facts"].([]interface{})
		seenFacts := map[string]int{}
		for _, rawFact := range facts {
			fact, ok := rawFact.(map[string]interface{})
			if !ok {
				continue
			}
			content := strings.TrimSpace(stringValue(fact["content"]))
			// 新纪要可明确拒绝长期价值低的候选；兼容没有该字段的历史纪要。
			if strings.EqualFold(stringValue(fact["memory_value"]), "low") || !isUsefulRecordingMemoryFact(content) {
				continue
			}
			key := recordingMemoryFactCanonicalKey(content)
			sourceSegmentIDs := memorySourceSegmentIDs(fact["source_segment_ids"])
			if len(sourceSegmentIDs) == 0 {
				continue
			}
			if index, exists := seenFacts[key]; exists {
				item.facts[index].sourceSegmentIDs = mergeRecordingMemorySourceIDs(item.facts[index].sourceSegmentIDs, sourceSegmentIDs)
				continue
			}
			seenFacts[key] = len(item.facts)
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
	// 人物与企业以具名身份为准，不要求额外结构化属性；其余类型必须至少有一个 schema 内属性
	if item.entityType == "person" || item.entityType == "company" {
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
	if entityType == "person" || entityType == "company" {
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
	content = strings.Trim(strings.TrimSpace(content), " \t\r\n，。！？!?、.;；…")
	if content == "" {
		return false
	}
	if _, low := recordingMemoryLowInformationFacts[content]; low {
		return false
	}
	// 不把无主体的口头碎片当作长期记忆；保留短的经营数值、金额或百分比事实。
	if (len([]rune(content)) <= 4 || strings.HasSuffix(content, "的啊")) && !strings.ContainsAny(content, "0123456789%％￥¥") {
		return false
	}
	return true
}

// 轻量格式去重，不折叠日期、数字和否定词，避免误认为经营数据变化是重复信息。
func recordingMemoryFactCanonicalKey(content string) string {
	content = strings.ToLower(strings.TrimSpace(content))
	content = strings.TrimPrefix(strings.TrimPrefix(content, "目前"), "当前")
	return strings.Map(func(r rune) rune {
		if strings.ContainsRune(" \t\r\n，。！？!?、.;；…：:（）()", r) {
			return -1
		}
		return r
	}, content)
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
			if item.entityType == "person" && recordingMemoryAmbiguousTitle(name) {
				key += "\x00" + strings.TrimSpace(item.attributes[recordingEntityIdentityDiscriminator])
			}
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
	if strings.TrimSpace(preferred.companyName) == "" {
		preferred.companyName = secondary.companyName
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

// 归并重复事实时合并证据，而不是简单丢弃新出现的逐字稿引用。
func mergeRecordingMemorySourceIDs(existing, incoming []string) []string {
	seen := make(map[string]bool, len(existing)+len(incoming))
	out := make([]string, 0, len(existing)+len(incoming))
	for _, id := range append(append([]string{}, existing...), incoming...) {
		if id != "" && !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	return out
}

func mergeRecordingEntityMemoryFacts(existing, incoming []recordingEntityMemoryFactItem) []recordingEntityMemoryFactItem {
	result := make([]recordingEntityMemoryFactItem, 0, len(existing)+len(incoming))
	seen := map[string]int{}
	for _, facts := range [][]recordingEntityMemoryFactItem{existing, incoming} {
		for _, fact := range facts {
			content := strings.TrimSpace(fact.content)
			if content == "" {
				continue
			}
			key := recordingMemoryFactCanonicalKey(content)
			if index, exists := seen[key]; exists {
				result[index].sourceSegmentIDs = mergeRecordingMemorySourceIDs(result[index].sourceSegmentIDs, fact.sourceSegmentIDs)
				continue
			}
			seen[key] = len(result)
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

// recordingMemoryLegacyAttributeKeys 历史数据兼容键：这些键已从 schema 移除（如 person.company），
// 但存量行 attributes_json 里仍有值。读路径按白名单放行，避免存量数据显示不全；
// 写路径仍只接受 schema 内属性，因此新数据不会再写入这些键（新旧数据天然可分）。
var recordingMemoryLegacyAttributeKeys = map[string]bool{"company": true}

// filterRecordingMemoryAttributesForResponse 读路径属性过滤：schema 内属性 + 历史兼容键（原样返回存量值）。
func filterRecordingMemoryAttributesForResponse(entityType string, attributes map[string]string) map[string]string {
	result := sanitizeRecordingMemoryAttributes(entityType, attributes)
	if result == nil {
		result = map[string]string{}
	}
	for key, value := range attributes {
		if !recordingMemoryLegacyAttributeKeys[key] {
			continue
		}
		if value = strings.TrimSpace(value); value != "" {
			result[key] = value
		}
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
	// 首先尊重本会议已经确认的归属；泛称只在本会议里对应实体。
	key := recordingMemoryMentionKey(fileID, item)
	if target, found, err := findRecordingMemoryBoundEntity(tx, eid, ownerID, fileID, item.entityType, key); found || err != nil {
		return target, err
	}
	normalized := key
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
	if item.entityType == "person" && !item.mentionOnlyName && !recordingMemoryAmbiguousTitle(item.canonicalName) {
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
	aliases := CleanRecordingMemoryAliases(entity.EntityType, entity.CanonicalName, mergeRecordingMemoryAliases(decodeStringSlice(entity.AliasesJSON), item.aliases))
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

// CleanRecordingMemoryAliases 收敛实体别名（读路径 / 写入 / 融合 / 离线清洗共用同一规则）：仅人员（person）保留其他称呼，
// 且只放与记忆名称不同的项（剔除与主名相同、全空格及规范化同名、默认说话人标签与重复项），其他类型一律返回空切片。
func CleanRecordingMemoryAliases(entityType, canonicalName string, aliases []string) []string {
	if entityType != "person" {
		return []string{}
	}
	canonicalTrim := strings.TrimSpace(canonicalName)
	canonicalNorm := normalizeRecordingMemoryEntityName(canonicalName)
	filtered := make([]string, 0, len(aliases))
	seen := make(map[string]struct{}, len(aliases))
	for _, alias := range aliases {
		aliasTrim := strings.TrimSpace(alias)
		if aliasTrim == "" || isGeneratedSpeakerLabel(aliasTrim) {
			continue
		}
		// 明确其他称呼只放和记忆名称不同的项
		if aliasTrim == canonicalTrim {
			continue
		}
		norm := normalizeRecordingMemoryEntityName(aliasTrim)
		if norm == canonicalNorm {
			continue
		}
		if _, ok := seen[norm]; ok {
			continue
		}
		seen[norm] = struct{}{}
		filtered = append(filtered, aliasTrim)
	}
	return filtered
}

func refreshRecordingMemoryEntityStats(tx *gorm.DB, eid, ownerID, entityID int64) error {
	var count int64
	if err := recordingMemoryFactRowsOnly(tx.Model(&model.RecordingMemoryFact{})).Where("eid = ? AND owner_id = ? AND entity_id = ? AND is_deleted = ?", eid, ownerID, entityID, false).Count(&count).Error; err != nil {
		return err
	}
	var last model.RecordingMemoryFact
	if count > 0 {
		if err := recordingMemoryFactRowsOnly(tx.Model(&model.RecordingMemoryFact{})).Where("eid = ? AND owner_id = ? AND entity_id = ? AND is_deleted = ?", eid, ownerID, entityID, false).Order("occurred_at DESC, id DESC").First(&last).Error; err != nil {
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

// RecordingMemoryEntityFilter 实体记忆列表多维查询过滤条件
type RecordingMemoryEntityFilter struct {
	EntityTypes     []string // 实体类型列表（person, company...）
	Keyword         string   // 全局模糊搜索（同时匹配 canonical_name 和 summary）
	Name            string   // 只按名称搜索（只匹配 canonical_name）
	AttributeKey    string   // 属性筛选 key（须为 schema 内属性，如 relationship / industry）
	AttributeValues []string // 属性筛选值（多值任一命中；兼容枚举 value 与中文 label 双写）
	SortBy          string   // 排序字段：created_time / updated_time（白名单，缺省 updated_time）
	Limit           int
	Offset          int
}

// List 兼容门面方法，默认将 keyword 作为全局模糊搜索。
func (s *RecordingMemoryEntityService) List(ctx context.Context, userID int64, entityTypes []string, keyword string, limit, offset int) (*RecordingMemoryEntityList, error) {
	return s.ListWithFilter(ctx, userID, RecordingMemoryEntityFilter{
		EntityTypes: entityTypes,
		Keyword:     keyword,
		Limit:       limit,
		Offset:      offset,
	})
}

// recordingMemorySchemaAttributeKeyExists 判断 [key] 是否在任一实体类型的
// schema 属性集内（属性筛选 key 白名单；不在集内的 key 直接返回空列表）。
func recordingMemorySchemaAttributeKeyExists(key string) bool {
	for _, schema := range model.RecordingMemoryEntitySchemas {
		if _, ok := schema.Attributes[key]; ok {
			return true
		}
	}
	return false
}

// recordingMemoryAttributeLikePattern 构造 attributes JSON 文本列的 LIKE 模式：
// %"key":"value"% —— 依赖落库为 json.Marshal 的紧凑形态（{"k":"v"} 无空格）；
// 若写入路径改成带空格的序列化，本筛选会静默全失效。
//
// 两侧引号都参与匹配，因此 key / value 都是精确匹配：key 不会被「尾串相同的
// 其他 key」误命中（sub_industry 里不含 `"industry"`），value 也不会被更长值
// 误命中（partner_x 里不含 `"partner"`）。
//
// 转义只做两件事：JSON 转义（值的引号 / 反斜杠由 json.Marshal 转成落库形态，
// 如 a"b → a\"b）+ LIKE 通配符转义（复用 escapeLikePattern）。
//
// LIKE 转义字符用 '!' 而不是反斜杠：MySQL 的字符串字面量里反斜杠是转义符，
// `ESCAPE '\'` 会被当成未闭合字面量直接语法报错（默认 sql_mode 下），而
// PostgreSQL / SQLite 又能通过 —— 等于只在生产 MySQL 上炸、SQLite 测试全绿。
// 反斜杠在 ESCAPE '!' 下是普通字符，故无需二次处理（与仓库既有约定一致，
// 见 my_space_upload_service.go 的 escapeLikePattern）。
func recordingMemoryAttributeLikePattern(key, value string) string {
	jsonKey, _ := json.Marshal(key)
	jsonValue, _ := json.Marshal(value)
	return "%" + escapeLikePattern(string(jsonKey)) + ":" + escapeLikePattern(string(jsonValue)) + "%"
}

// ListWithFilter 增强版实体记忆列表查询，支持指定 Name 进行精准名称搜索，杜绝简介关键词干扰。
func (s *RecordingMemoryEntityService) ListWithFilter(ctx context.Context, userID int64, filter RecordingMemoryEntityFilter) (*RecordingMemoryEntityList, error) {
	if err := s.ensureAccess(ctx, userID, false); err != nil {
		return nil, err
	}
	limit := filter.Limit
	offset := filter.Offset
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
	// 多值查询：支持重复传参与逗号分隔两种写法；只保留 schema 内类型；全部未知时直接返回空，避免 IN () 非法 SQL
	if len(filter.EntityTypes) > 0 {
		wanted := make([]string, 0, len(filter.EntityTypes))
		seen := make(map[string]bool, len(filter.EntityTypes))
		for _, raw := range filter.EntityTypes {
			for _, entityType := range strings.Split(raw, ",") {
				entityType = strings.ToLower(strings.TrimSpace(entityType))
				if entityType == "" || seen[entityType] {
					continue
				}
				if _, ok := model.RecordingMemoryEntitySchemas[entityType]; !ok {
					continue
				}
				seen[entityType] = true
				wanted = append(wanted, entityType)
			}
		}
		if len(wanted) == 0 {
			return &RecordingMemoryEntityList{Items: []RecordingMemoryEntityListItem{}}, nil
		}
		query = query.Where("entity_type IN ?", wanted)
	}

	// 属性筛选：attributes JSON 文本列按 "key":"value" 形态精确匹配（参数化 LIKE，
	// MySQL / PostgreSQL / SQLite 三方言通用，不用 JSON_EXTRACT）。多值任一命中
	// （用 OR 拼接，GORM 会给含 OR 的原生条件自动加括号，不会与上面的
	// eid / owner_id / entity_type 条件混淆优先级）。兼容枚举 value 与中文 label
	// 双写的历史数据。key 不在 schema 属性集内、或传了 key 但 value 全为空，
	// 一律返回空列表（与未知 entity_type 同口径，不静默省略筛选条件返回全量）。
	if attributeKey := strings.TrimSpace(filter.AttributeKey); attributeKey != "" {
		if !recordingMemorySchemaAttributeKeyExists(attributeKey) {
			return &RecordingMemoryEntityList{Items: []RecordingMemoryEntityListItem{}}, nil
		}
		conds := make([]string, 0, len(filter.AttributeValues))
		args := make([]interface{}, 0, len(filter.AttributeValues))
		for _, value := range filter.AttributeValues {
			value = strings.TrimSpace(value)
			if value == "" {
				continue
			}
			conds = append(conds, `attributes_json LIKE ? ESCAPE '!'`)
			args = append(args, recordingMemoryAttributeLikePattern(attributeKey, value))
		}
		if len(conds) == 0 {
			return &RecordingMemoryEntityList{Items: []RecordingMemoryEntityListItem{}}, nil
		}
		query = query.Where(strings.Join(conds, " OR "), args...)
	}

	// 搜索过滤：优先按名称精确搜索（name）；若未传 name 则回退全局模糊搜索（keyword）
	if name := strings.TrimSpace(filter.Name); name != "" {
		like := "%" + name + "%"
		query = query.Where("canonical_name LIKE ?", like)
	} else if keyword := strings.TrimSpace(filter.Keyword); keyword != "" {
		like := "%" + keyword + "%"
		query = query.Where("canonical_name LIKE ? OR summary LIKE ?", like, like)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, err
	}
	var entities []model.RecordingMemoryEntity
	// 排序：白名单内切换（created_time / updated_time），缺省与历史行为一致
	// （updated_time DESC，列表默认「最近更新」在前）；非法值回退缺省不报错（兼容
	// 老客户端）。末尾固定补 id DESC：批量导入的数据时间戳大量相同，只按时间
	// 排序时数据库不保证同值内部顺序稳定，offset 翻页会重复 / 漏项。
	order := "updated_time DESC, id DESC"
	switch strings.ToLower(strings.TrimSpace(filter.SortBy)) {
	case "created_time":
		order = "created_time DESC, id DESC"
	case "updated_time", "":
		// 缺省
	}
	if err := query.Order(order).Offset(offset).Limit(limit).Find(&entities).Error; err != nil {
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
	companies, personCounts, err := recordingMemoryEntityRelationSummaries(ctx, s.eid, userID, entities)
	if err != nil {
		return nil, err
	}
	for _, entity := range entities {
		item := recordingMemoryEntityListItem(entity, sourceMeetings[entity.ID])
		item.SourceFile = sourceFiles[entity.ID]
		if company, ok := companies[entity.ID]; ok {
			view := company
			item.RelatedCompany = &view
		}
		item.RelatedPersonCount = personCounts[entity.ID]
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
  AND f.fact_kind NOT IN ?
  AND NOT EXISTS (
    SELECT 1 FROM recording_memory_facts g
    WHERE g.eid = f.eid AND g.owner_id = f.owner_id AND g.entity_id = f.entity_id AND g.is_deleted = ?
      AND g.fact_kind NOT IN ?
      AND (g.occurred_at > f.occurred_at OR (g.occurred_at = f.occurred_at AND g.id > f.id))
  )`
	if err := model.DB.WithContext(ctx).Raw(latestSQL, eid, ownerID, entityIDs, false,
		recordingMemoryRelationFactKinds, false, recordingMemoryRelationFactKinds).Scan(&rows).Error; err != nil {
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
	aliases := CleanRecordingMemoryAliases(entity.EntityType, entity.CanonicalName, decodeStringSlice(entity.AliasesJSON))
	if aliases == nil {
		aliases = []string{}
	}
	return RecordingMemoryEntityListItem{
		ID:             entity.ID,
		EntityType:     entity.EntityType,
		CanonicalName:  entity.CanonicalName,
		Aliases:        aliases,
		Summary:        string(entity.Summary),
		FactCount:      entity.FactCount,
		SourceMeetings: sourceMeetings,
		LastFactAt:     entity.LastFactAt,
		UpdatedTime:    entity.UpdatedTime,
		Attributes:     filterRecordingMemoryAttributesForResponse(entity.EntityType, decodeStringMap(entity.AttributesJSON)),
	}
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
	detail := &RecordingMemoryEntityDetail{RecordingMemoryEntityListItem: recordingMemoryEntityListItem(*entity, sourceMeetings), FirstMentionedAt: entity.FirstMentionedAt, Facts: []RecordingMemoryEntityFactView{}, Relations: []RecordingMemoryEntityRelationView{}}
	var facts []model.RecordingMemoryFact
	if err := recordingMemoryFactRowsOnly(model.DB.WithContext(ctx).Where("eid = ? AND owner_id = ? AND entity_id = ? AND is_deleted = ?", s.eid, userID, entity.ID, false)).Order("occurred_at DESC, id DESC").Limit(100).Find(&facts).Error; err != nil {
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
	companies, personCounts, err := recordingMemoryEntityRelationSummaries(ctx, s.eid, userID, []model.RecordingMemoryEntity{*entity})
	if err != nil {
		return nil, err
	}
	if company, ok := companies[entity.ID]; ok {
		view := company
		detail.RelatedCompany = &view
	}
	detail.RelatedPersonCount = personCounts[entity.ID]
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
	err := recordingMemoryFactRowsOnly(tx).Where("eid = ? AND owner_id = ? AND entity_id = ? AND is_deleted = ?", eid, ownerID, entityID, false).
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
  AND f.fact_kind NOT IN ?
  AND NOT EXISTS (
    SELECT 1 FROM recording_memory_facts g
    WHERE g.eid = f.eid AND g.owner_id = f.owner_id AND g.entity_id = f.entity_id AND g.is_deleted = ?
      AND g.fact_kind NOT IN ?
      AND (g.occurred_at > f.occurred_at OR (g.occurred_at = f.occurred_at AND g.id > f.id))
  )`
	if err := model.DB.WithContext(ctx).Raw(latestSQL, eid, ownerID, entityIDs, false, recordingMemoryRelationFactKinds, false, recordingMemoryRelationFactKinds).Scan(&rows).Error; err != nil {
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
	aliasesJSON, err := marshalRecordingMemoryAliases(entityType, name, input.Aliases)
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
			AliasesJSON:      model.LongText(aliasesJSON),
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
		if len(input.Relations) > 0 {
			if err := syncRecordingMemoryEntityRelations(tx, s.eid, userID, entity.ID, entityType, input.Relations); err != nil {
				return err
			}
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
		if input.Aliases != nil {
			aliasesJSON, err := marshalRecordingMemoryAliases(entity.EntityType, entity.CanonicalName, input.Aliases)
			if err != nil {
				return err
			}
			updates["aliases_json"] = aliasesJSON
		}
		if len(updates) == 0 && len(input.Facts) == 0 && len(input.DeletedFactIDs) == 0 && input.Relations == nil {
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
		if input.Relations != nil && len(*input.Relations) > 0 {
			if err := syncRecordingMemoryEntityRelations(tx, s.eid, userID, entity.ID, entity.EntityType, *input.Relations); err != nil {
				return err
			}
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
		// 其他实体指向本实体的关联行（关联记忆/结构化关联）一并软删，避免其详情出现空白关联项
		if err := tx.Model(&model.RecordingMemoryFact{}).
			Where("eid = ? AND owner_id = ? AND related_entity_id = ? AND is_deleted = ?", s.eid, userID, entityID, false).
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
		return mergeRecordingEntitiesTx(tx, s.eid, userID, []int64{sourceID}, targetID, "", "confirmed")
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

// recordingMemoryRelationFactKinds 是结构化关联使用的关系类型白名单（作为 fact_kind 存储）。
// 新增关系类型时必须同步这里，以及 syncRecordingMemoryEntityRelations 的 switch。
var recordingMemoryRelationFactKinds = []string{recordingEntityMemoryFactBelongsTo}

// recordingMemoryFactRowsOnly 只保留"事实/关联记忆"行，排除结构化关联行。
// facts[]、fact_count、last_fact_at、source_file 与历史召回统一使用，保证"列表条数 == fact_count"。
// 采用"只排除已登记的关系类型"而不是"只保留事实类 kind"：fact_kind 是开放取值
// （存量/夹具里存在其它取值），后者会把关系行之外的数据一并隐藏。
func recordingMemoryFactRowsOnly(db *gorm.DB) *gorm.DB {
	return db.Where("fact_kind NOT IN ?", recordingMemoryRelationFactKinds)
}

// marshalRecordingMemoryAliases 清洗并序列化人工别称；nil（未提供）落库为 "[]"。
// 仅人员（person）保留其他称呼，且剔除与主名相同的项。
func marshalRecordingMemoryAliases(entityType, canonicalName string, aliases *[]string) (string, error) {
	if aliases == nil {
		return "[]", nil
	}
	payload, err := json.Marshal(CleanRecordingMemoryAliases(entityType, canonicalName, mergeRecordingMemoryAliases(nil, *aliases)))
	if err != nil {
		return "", err
	}
	return string(payload), nil
}

// upsertRecordingMemoryEntityCompanyLink 幂等写入"人物→企业"关联行。
// source_key 固定，而唯一索引 uniq_recording_memory_fact_source 不含 is_deleted，
// 因此同键的已软删行必须复活复用，不能重复插入（否则改绑回旧企业/清空后重挂会唯一约束报错）。
func upsertRecordingMemoryEntityCompanyLink(tx *gorm.DB, eid, ownerID, personID, companyID, occurredAt int64) error {
	seed := fmt.Sprintf("manual|relation|%s|%d|%d", recordingEntityMemoryFactBelongsTo, personID, companyID)
	hash := sha256.Sum256([]byte(seed))
	sourceKey := hex.EncodeToString(hash[:])
	var existing model.RecordingMemoryFact
	err := tx.Where("eid = ? AND owner_id = ? AND file_id = ? AND source_key = ?", eid, ownerID, 0, sourceKey).First(&existing).Error
	if err == nil {
		return tx.Model(&model.RecordingMemoryFact{}).Where("id = ?", existing.ID).Updates(map[string]interface{}{
			"entity_id":         personID,
			"related_entity_id": companyID,
			"is_deleted":        false,
			"occurred_at":       occurredAt,
			"fact_kind":         recordingEntityMemoryFactBelongsTo,
		}).Error
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	return tx.Create(&model.RecordingMemoryFact{
		Eid: eid, OwnerID: ownerID, EntityID: personID, FileID: 0,
		SourceKey:        sourceKey,
		FactKind:         recordingEntityMemoryFactBelongsTo,
		Content:          model.LongText(""),
		AttributesJSON:   model.LongText("{}"),
		SourceSegmentIDs: model.LongText("[]"),
		SourceType:       recordingEntityMemorySourceManual,
		OccurredAt:       occurredAt,
		RelatedEntityID:  companyID,
	}).Error
}

// IsGenericOrUnnamedCompany 判断公司名是否属于泛称或未具名占位词（用于抽取和历史数据回填清洗）。
func IsGenericOrUnnamedCompany(name string) bool {
	trimmed := strings.TrimSpace(name)
	return trimmed == "" || isGenericRecordingMemoryName("company", trimmed) || isUnnamedRecordingMemoryCompany(trimmed)
}

// unnamedRecordingMemoryCompanyMarkers 占位/未具名企业名标记：命中即不建企业实体，避免垃圾卡片。
// 现网 person.company 中约 16% 是这类占位值（未明确/未具名/未知/待确认…）。
var unnamedRecordingMemoryCompanyMarkers = []string{"未明确", "未具名", "未提供", "未说明", "不详", "待确认", "未知", "无法确认", "不明确", "某公司", "同上", "不明", "本公司", "我公司", "我方公司", "我司", "个人", "供应商方"}

func isUnnamedRecordingMemoryCompany(name string) bool {
	for _, marker := range unnamedRecordingMemoryCompanyMarkers {
		if strings.Contains(name, marker) {
			return true
		}
	}
	return false
}

// linkRecordingMemoryEntityCompany 依据人物抽取到的企业名称，查找/新建 company 实体并建立 belongs_to 关联。
// 企业实体不存在时按名称新建（属性留空，等待人工或后续会议补充）；人物至多一个企业，切换时软删旧关联。
func LinkRecordingMemoryEntityCompany(tx *gorm.DB, eid, ownerID, personID int64, companyName string, mentionedAt int64) error {
	return linkRecordingMemoryEntityCompanyForFile(tx, eid, ownerID, 0, personID, companyName, mentionedAt)
}

func linkRecordingMemoryEntityCompanyForFile(tx *gorm.DB, eid, ownerID, fileID, personID int64, companyName string, mentionedAt int64) error {
	name := strings.TrimSpace(companyName)
	if name == "" || isGenericRecordingMemoryName("company", name) || isUnnamedRecordingMemoryCompany(name) {
		return nil
	}
	normalized := normalizeRecordingMemoryEntityName(name)
	bound, found, err := findRecordingMemoryBoundEntity(tx, eid, ownerID, fileID, "company", normalized)
	if errors.Is(err, errRecordingMemoryBindingRetired) {
		return nil
	}
	if err != nil {
		return err
	}
	var company model.RecordingMemoryEntity
	if found {
		company = *bound
	} else {
		err = tx.Where("eid = ? AND owner_id = ? AND entity_type = ? AND normalized_name = ?", eid, ownerID, "company", normalized).First(&company).Error
		switch {
		case errors.Is(err, gorm.ErrRecordNotFound):
			company = model.RecordingMemoryEntity{
				Eid: eid, OwnerID: ownerID, EntityType: "company", CanonicalName: name, NormalizedName: normalized,
				SummarySource: recordingEntityMemorySourceAutomatic, AttributesSource: recordingEntityMemorySourceAutomatic,
				FirstMentionedAt: mentionedAt, LastFactAt: mentionedAt,
			}
			if err := tx.Create(&company).Error; err != nil {
				return err
			}
		case err != nil:
			return err
		case company.MergedIntoID != 0:
			if err := tx.Where("id = ? AND eid = ? AND owner_id = ? AND is_deleted = ?", company.MergedIntoID, eid, ownerID, false).First(&company).Error; err != nil {
				return err
			}
		}
	}
	if err := saveRecordingMemoryEntityBinding(tx, eid, ownerID, fileID, "company", normalized, name, company.ID, "automatic"); err != nil {
		return err
	}
	// 若企业之前被软删，再次在会议中作为人员所属企业出现时，自动复活恢复有效
	if company.IsDeleted {
		if err := tx.Model(&company).Updates(map[string]interface{}{
			"is_deleted":   false,
			"last_fact_at": mentionedAt,
			"updated_time": time.Now().UTC().UnixMilli(),
		}).Error; err != nil {
			return err
		}
		company.IsDeleted = false
	}
	// 人物至多一个企业：已关联同一企业则幂等返回；已关联其他企业时，只有不早于现有结论的会议才能改绑，
	// 避免重跑旧会议把新会议确定的关联顶掉。
	var current model.RecordingMemoryFact
	curErr := tx.Where("eid = ? AND owner_id = ? AND entity_id = ? AND fact_kind = ? AND is_deleted = ?",
		eid, ownerID, personID, recordingEntityMemoryFactBelongsTo, false).
		Order("occurred_at DESC, id DESC").First(&current).Error
	switch {
	case curErr == nil && current.RelatedEntityID == company.ID:
		return nil
	case curErr == nil:
		if current.OccurredAt > mentionedAt {
			return nil
		}
		if err := tx.Model(&model.RecordingMemoryFact{}).Where("id = ?", current.ID).Update("is_deleted", true).Error; err != nil {
			return err
		}
	case !errors.Is(curErr, gorm.ErrRecordNotFound):
		return curErr
	}
	return upsertRecordingMemoryEntityCompanyLink(tx, eid, ownerID, personID, company.ID, mentionedAt)
}

// syncRecordingMemoryEntityRelations 按 relation_type 分组替换结构化关联；未知关系类型报错。
func syncRecordingMemoryEntityRelations(tx *gorm.DB, eid, ownerID, entityID int64, entityType string, groups []RecordingMemoryRelationInput) error {
	for _, group := range groups {
		switch group.RelationType {
		case recordingEntityMemoryFactBelongsTo:
			if err := syncRecordingMemoryEntityCompanyLinks(tx, eid, ownerID, entityID, entityType, group.RelatedEntityIDs); err != nil {
				return err
			}
		default:
			return ErrRecordingEntityMemoryRelationTypeUnsupported
		}
	}
	return nil
}

// syncRecordingMemoryEntityCompanyLinks 按替换语义维护人物↔企业的 belongs_to 关联行。
// 行方向固定为 entity_id=人物、related_entity_id=企业：人物侧维护自己名下的行，企业侧维护指向自己的行。
func syncRecordingMemoryEntityCompanyLinks(tx *gorm.DB, eid, ownerID, entityID int64, entityType string, relatedIDs []int64) error {
	personSide := entityType == "person"
	wantType := "company"
	if !personSide {
		if entityType != "company" {
			return ErrRecordingEntityMemoryRelationTypeMismatch
		}
		wantType = "person"
	}
	want := make([]int64, 0, len(relatedIDs))
	seen := make(map[int64]bool, len(relatedIDs))
	for _, relatedID := range relatedIDs {
		if relatedID == entityID {
			return ErrRecordingEntityMemoryRelationSelf
		}
		if relatedID <= 0 || seen[relatedID] {
			continue
		}
		seen[relatedID] = true
		want = append(want, relatedID)
	}
	if personSide && len(want) > 1 {
		return ErrRecordingEntityMemoryRelationTooMany
	}
	if len(want) > 0 {
		var targets []model.RecordingMemoryEntity
		if err := tx.Where("id IN ? AND eid = ? AND owner_id = ? AND merged_into_id = ? AND is_deleted = ?", want, eid, ownerID, 0, false).Find(&targets).Error; err != nil {
			return err
		}
		if len(targets) != len(want) {
			return ErrRecordingEntityMemoryNotFound
		}
		for _, target := range targets {
			if target.EntityType != wantType {
				return ErrRecordingEntityMemoryRelationTypeMismatch
			}
		}
	}
	currentQuery := tx.Where("eid = ? AND owner_id = ? AND fact_kind = ? AND is_deleted = ?", eid, ownerID, recordingEntityMemoryFactBelongsTo, false)
	if personSide {
		currentQuery = currentQuery.Where("entity_id = ?", entityID)
	} else {
		currentQuery = currentQuery.Where("related_entity_id = ?", entityID)
	}
	var current []model.RecordingMemoryFact
	if err := currentQuery.Find(&current).Error; err != nil {
		return err
	}
	kept := make(map[int64]bool, len(current))
	for _, fact := range current {
		otherID := fact.RelatedEntityID
		if !personSide {
			otherID = fact.EntityID
		}
		if seen[otherID] {
			kept[otherID] = true
			continue
		}
		if err := tx.Model(&model.RecordingMemoryFact{}).Where("id = ?", fact.ID).Update("is_deleted", true).Error; err != nil {
			return err
		}
	}
	now := time.Now().UTC().UnixMilli()
	for _, otherID := range want {
		if kept[otherID] {
			continue
		}
		personID, companyID := entityID, otherID
		if !personSide {
			personID, companyID = otherID, entityID
		}
		// 人物至多一个企业：挂到本企业前清掉该人物名下的其它企业关联（企业侧多选时也可能命中）
		if err := tx.Model(&model.RecordingMemoryFact{}).
			Where("eid = ? AND owner_id = ? AND entity_id = ? AND fact_kind = ? AND is_deleted = ? AND related_entity_id <> ?",
				eid, ownerID, personID, recordingEntityMemoryFactBelongsTo, false, companyID).
			Update("is_deleted", true).Error; err != nil {
			return err
		}
		if err := upsertRecordingMemoryEntityCompanyLink(tx, eid, ownerID, personID, companyID, now); err != nil {
			return err
		}
	}
	return nil
}

// convergeRecordingMemoryEntityCompanyLinks 融合后收敛：同一人物只保留一条有效 belongs_to 关联。
func convergeRecordingMemoryEntityCompanyLinks(tx *gorm.DB, eid, ownerID int64) error {
	type linkCount struct {
		EntityID int64
		Total    int64
	}
	var rows []linkCount
	if err := tx.Model(&model.RecordingMemoryFact{}).
		Select("entity_id, COUNT(*) AS total").
		Where("eid = ? AND owner_id = ? AND fact_kind = ? AND is_deleted = ?", eid, ownerID, recordingEntityMemoryFactBelongsTo, false).
		Group("entity_id").Having("COUNT(*) > 1").Scan(&rows).Error; err != nil {
		return err
	}
	for _, row := range rows {
		var facts []model.RecordingMemoryFact
		if err := tx.Where("eid = ? AND owner_id = ? AND entity_id = ? AND fact_kind = ? AND is_deleted = ?", eid, ownerID, row.EntityID, recordingEntityMemoryFactBelongsTo, false).
			Order("id DESC").Find(&facts).Error; err != nil {
			return err
		}
		for _, fact := range facts[1:] {
			if err := tx.Model(&model.RecordingMemoryFact{}).Where("id = ?", fact.ID).Update("is_deleted", true).Error; err != nil {
				return err
			}
		}
	}
	return nil
}

// recordingMemoryEntityRelationSummaries 批量汇总结构化关联：人物行 → 所属企业；企业行 → 关联人物数。
func recordingMemoryEntityRelationSummaries(ctx context.Context, eid, ownerID int64, entities []model.RecordingMemoryEntity) (map[int64]RecordingMemoryEntityRelationView, map[int64]int64, error) {
	companies := map[int64]RecordingMemoryEntityRelationView{}
	counts := map[int64]int64{}
	personIDs := make([]int64, 0, len(entities))
	companyIDs := make([]int64, 0, len(entities))
	for _, entity := range entities {
		switch entity.EntityType {
		case "person":
			personIDs = append(personIDs, entity.ID)
		case "company":
			companyIDs = append(companyIDs, entity.ID)
		}
	}
	if len(personIDs) > 0 {
		var facts []model.RecordingMemoryFact
		if err := model.DB.WithContext(ctx).
			Where("eid = ? AND owner_id = ? AND fact_kind = ? AND is_deleted = ? AND entity_id IN ?", eid, ownerID, recordingEntityMemoryFactBelongsTo, false, personIDs).
			Order("id DESC").Find(&facts).Error; err != nil {
			return nil, nil, err
		}
		relatedIDs := make([]int64, 0, len(facts))
		for _, fact := range facts {
			relatedIDs = append(relatedIDs, fact.RelatedEntityID)
		}
		infos := recordingMemoryRelatedEntityInfos(ctx, eid, ownerID, relatedIDs)
		for _, fact := range facts {
			if _, exists := companies[fact.EntityID]; exists {
				continue // 一人至多一个企业；出现重复行时保留最新
			}
			info, ok := infos[fact.RelatedEntityID]
			if !ok {
				continue
			}
			companies[fact.EntityID] = RecordingMemoryEntityRelationView{
				ID: fact.ID, RelatedEntityID: fact.RelatedEntityID, RelatedName: info.Name, RelatedType: info.Type,
				RelationType: fact.FactKind, Summary: info.Summary,
				Attributes: filterRecordingMemoryAttributesForResponse(info.Type, info.Attributes),
			}
		}
	}
	if len(companyIDs) > 0 {
		var facts []model.RecordingMemoryFact
		if err := model.DB.WithContext(ctx).
			Where("eid = ? AND owner_id = ? AND fact_kind = ? AND is_deleted = ? AND related_entity_id IN ?", eid, ownerID, recordingEntityMemoryFactBelongsTo, false, companyIDs).
			Find(&facts).Error; err != nil {
			return nil, nil, err
		}
		linkPersonIDs := make([]int64, 0, len(facts))
		for _, fact := range facts {
			linkPersonIDs = append(linkPersonIDs, fact.EntityID)
		}
		infos := recordingMemoryRelatedEntityInfos(ctx, eid, ownerID, linkPersonIDs)
		counted := map[int64]map[int64]bool{}
		for _, fact := range facts {
			info, ok := infos[fact.EntityID]
			if !ok || info.Type != "person" {
				continue
			}
			if counted[fact.RelatedEntityID] == nil {
				counted[fact.RelatedEntityID] = map[int64]bool{}
			}
			counted[fact.RelatedEntityID][fact.EntityID] = true
		}
		for companyID, set := range counted {
			counts[companyID] = int64(len(set))
		}
	}
	return companies, counts, nil
}

func (s *RecordingMemoryEntityService) listRelations(ctx context.Context, userID, entityID int64) ([]RecordingMemoryEntityRelationView, error) {
	var facts []model.RecordingMemoryFact
	if err := model.DB.WithContext(ctx).
		Where("eid = ? AND owner_id = ? AND fact_kind = ? AND is_deleted = ? AND (entity_id = ? OR related_entity_id = ?)",
			s.eid, userID, recordingEntityMemoryFactBelongsTo, false, entityID, entityID).
		Find(&facts).Error; err != nil {
		return nil, err
	}
	ids := make([]int64, 0, len(facts))
	for _, fact := range facts {
		if fact.EntityID == entityID {
			ids = append(ids, fact.RelatedEntityID)
		} else {
			ids = append(ids, fact.EntityID)
		}
	}
	infos := recordingMemoryRelatedEntityInfos(ctx, s.eid, userID, ids)
	result := make([]RecordingMemoryEntityRelationView, 0, len(facts))
	for i, fact := range facts {
		info, ok := infos[ids[i]]
		if !ok {
			continue // 目标已删/已融合：不返回悬空项
		}
		result = append(result, RecordingMemoryEntityRelationView{
			ID: fact.ID, RelatedEntityID: ids[i], RelatedName: info.Name, RelatedType: info.Type,
			RelationType: fact.FactKind,
			Summary:      info.Summary,
			Attributes:   filterRecordingMemoryAttributesForResponse(info.Type, info.Attributes),
		})
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
	genericTerms := buildGenericIdentityTerms(ctx, eid, ownerID, currentFileID)
	var allEntities []model.RecordingMemoryEntity
	if err := model.DB.WithContext(ctx).Where("eid = ? AND owner_id = ? AND id IN ? AND is_deleted = ?", eid, ownerID, currentEntityIDs, false).Find(&allEntities).Error; err != nil || len(allEntities) == 0 {
		return nil
	}
	specificEnts, _ := partitionRecordingMemoryEntities(allEntities, genericTerms)
	if len(specificEnts) == 0 {
		return nil
	}
	specificEntityIDs := make([]int64, 0, len(specificEnts))
	for _, ent := range specificEnts {
		specificEntityIDs = append(specificEntityIDs, ent.ID)
	}
	var facts []model.RecordingMemoryFact
	if err := recordingMemoryFactRowsOnly(model.DB.WithContext(ctx).
		Where("eid = ? AND owner_id = ? AND entity_id IN ? AND file_id != ? AND is_deleted = ?", eid, ownerID, specificEntityIDs, currentFileID, false)).
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
