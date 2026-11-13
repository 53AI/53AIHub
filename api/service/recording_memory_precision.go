package service

import (
	"context"
	"strings"

	"github.com/53AI/53AIHub/model"
)

// ---------------------------------------------------------------------------
// Business Memory Precision & Generic Identity Suppression
// 核心原则：Generic identity never creates continuity. Specific business objects create continuity.
// ---------------------------------------------------------------------------

const (
	MemoryRejectGenericEntityOnly      = "generic_entity_only"
	MemoryRejectNoSpecificAnchor        = "no_specific_anchor"
	MemoryRejectRawQuote                = "raw_quote"
	MemoryRejectDifferentSpecificPerson = "different_specific_person"
	MemoryRejectDifferentCustomer       = "different_customer"
	MemoryRejectDifferentProject        = "different_project"
	MemoryRejectDifferentBusinessMatter = "different_business_matter"
	MemoryRejectUnsupportedMemoryType  = "unsupported_memory_type"
	MemoryRejectLowRelevance           = "low_relevance"
)

// RecordingMemoryRetrievalDebugManifest 记录记忆召回全链路过滤明细，供调试与评测审计。
type RecordingMemoryRetrievalDebugManifest struct {
	FileID                            int64                          `json:"file_id"`
	CurrentEntities                   []string                       `json:"current_entities"`
	GenericEntities                   []string                       `json:"generic_entities"`
	SpecificAnchors                   []string                       `json:"specific_anchors"`
	MemoryCandidatesBeforeFilter      int                            `json:"memory_candidates_before_filter"`
	MemoryCandidatesAfterEntityFilter int                            `json:"memory_candidates_after_entity_filter"`
	MemoryCandidatesAfterTypeFilter   int                            `json:"memory_candidates_after_type_filter"`
	MemorySelected                    []string                       `json:"memory_selected"`
	MemoryCited                       []string                       `json:"memory_cited"`
	Rejected                          []RecordingMemoryRejectionItem `json:"rejected"`
}

// RecordingMemoryRejectionItem 记录单条被过滤记忆的原因。
type RecordingMemoryRejectionItem struct {
	MemoryID int64  `json:"memory_id"`
	Reason   string `json:"reason"`
}

// buildGenericIdentityTerms 构建当前租户与用户的通用身份称谓列表。
// 必须根据 current_user、current_company 和 aliases 确定性动态构造，不单独硬编码死常量。
func buildGenericIdentityTerms(ctx context.Context, eid, userID, fileID int64) []string {
	terms := []string{
		"我司", "公司", "本公司", "我们公司", "团队", "平台", "老板", "创始人", "总经理",
		"53ai", "53aihub", "53AI", "53AIHub",
	}

	personal := loadInsightPersonalContext(ctx, eid, userID, fileID)
	if personal.User != nil {
		if nick := strings.TrimSpace(personal.User.Nickname); nick != "" {
			terms = appendUniqueStrings(terms, strings.ToLower(nick))
			// 生成常见尊称/简称别名，如“杨振宇” -> “杨总”, “杨老师”, “老杨”, “小杨”
			runes := []rune(nick)
			if len(runes) >= 2 {
				surname := string(runes[0])
				terms = appendUniqueStrings(terms, surname+"总", surname+"老师", "老"+surname, "小"+surname)
			}
		}
		if username := strings.TrimSpace(personal.User.Username); username != "" {
			terms = appendUniqueStrings(terms, strings.ToLower(username))
		}
	}

	if enterprise, err := model.GetEnterpriseByID(eid); err == nil && enterprise != nil {
		if name := strings.TrimSpace(enterprise.DisplayName); name != "" {
			terms = appendUniqueStrings(terms, strings.ToLower(name))
		}
		if name := strings.TrimSpace(enterprise.FullName); name != "" {
			terms = appendUniqueStrings(terms, strings.ToLower(name))
		}
	}

	return terms
}

// isGenericIdentityEntity 判定某实体名称是否属于通用身份实体（不能单独建立历史连续性）。
func isGenericIdentityEntity(name string, genericTerms []string) bool {
	norm := strings.ToLower(strings.TrimSpace(name))
	if norm == "" {
		return true
	}
	for _, term := range genericTerms {
		if norm == term || strings.EqualFold(norm, term) {
			return true
		}
	}
	// 常见通用组织/称谓阻断词
	commonStopwords := map[string]bool{
		"我司": true, "公司": true, "本公司": true, "我们公司": true,
		"团队": true, "平台": true, "老板": true, "创始人": true,
		"总经理": true, "杨总": true, "53ai": true, "53aihub": true,
	}
	return commonStopwords[norm]
}

// partitionEntitiesByGenericity 将实体切分为业务专用 Anchor 与通用陪伴实体。
func partitionEntitiesByGenericity(entities []model.Entity, genericTerms []string) (specific []model.Entity, generic []model.Entity) {
	for _, ent := range entities {
		if isGenericIdentityEntity(ent.Name, genericTerms) {
			generic = append(generic, ent)
		} else {
			specific = append(specific, ent)
		}
	}
	return specific, generic
}

// partitionRecordingMemoryEntities 将安心录专属实体切分为具体 Anchor 与通用实体。
func partitionRecordingMemoryEntities(entities []model.RecordingMemoryEntity, genericTerms []string) (specific []model.RecordingMemoryEntity, generic []model.RecordingMemoryEntity) {
	for _, ent := range entities {
		if isGenericIdentityEntity(ent.CanonicalName, genericTerms) {
			generic = append(generic, ent)
		} else {
			specific = append(specific, ent)
		}
	}
	return specific, generic
}

// filterOutGenericTerms 从候选检索词条中剔除通用身份实体词，避免 LIKE 检索全量外溢。
func filterOutGenericTerms(terms []string, genericTerms []string) []string {
	result := make([]string, 0, len(terms))
	for _, t := range terms {
		if !isGenericIdentityEntity(t, genericTerms) {
			result = append(result, t)
		}
	}
	return result
}

// ---------------------------------------------------------------------------
// Exported audit helpers for test/CLI
// ---------------------------------------------------------------------------

func BuildGenericIdentityTermsForAudit(ctx context.Context, eid, userID, fileID int64) []string {
	return buildGenericIdentityTerms(ctx, eid, userID, fileID)
}

func PartitionEntitiesByGenericityForAudit(entities []model.Entity, genericTerms []string) ([]model.Entity, []model.Entity) {
	return partitionEntitiesByGenericity(entities, genericTerms)
}

func LoadRelatedInsightHistoryWithContextForAudit(ctx context.Context, eid, fileID, userID int64, memCfg *model.MemoryExtractionConfig, currentContext *CurrentMeetingContext) []historyMeeting {
	return loadRelatedInsightHistoryWithContext(ctx, eid, fileID, userID, memCfg, currentContext)
}

// LoadRelatedInsightHistoryUnfilteredForAudit 用于在审计时模拟老版本（不过滤通用实体、不排除 quote）的召回结果做前后对比。
func LoadRelatedInsightHistoryUnfilteredForAudit(ctx context.Context, eid, fileID, userID int64, memCfg *model.MemoryExtractionConfig) []historyMeeting {
	if memCfg == nil || !memCfg.IsEffectivelyEnabled() {
		return nil
	}
	var currentEntityIDs []int64
	_ = model.DB.WithContext(ctx).Model(&model.EntityChunkRelation{}).
		Joins("JOIN entities e ON e.id = entity_chunk_relations.entity_id").
		Where("entity_chunk_relations.eid = ? AND entity_chunk_relations.file_id = ? AND entity_chunk_relations.status = ?",
			eid, fileID, "active").
		Where("entity_chunk_relations.source IN ?", []string{"auto_llm", "auto_meta"}).
		Where("e.type IN ?", memCfg.Types).
		Distinct("entity_chunk_relations.entity_id").
		Pluck("entity_chunk_relations.entity_id", &currentEntityIDs)

	if len(currentEntityIDs) == 0 {
		return nil
	}
	var historyFileIDs []int64
	_ = model.DB.WithContext(ctx).Table("entity_chunk_relations ecr").
		Joins("JOIN files f ON f.id = ecr.file_id").
		Joins("JOIN entities e ON e.id = ecr.entity_id").
		Where("ecr.eid = ? AND ecr.entity_id IN ? AND ecr.file_id != ? AND ecr.status = ?",
			eid, currentEntityIDs, fileID, "active").
		Where("e.type IN ?", memCfg.Types).
		Where("f.user_id = ? AND f.origin_type IN ? AND f.parsing_status = ? AND f.insight_summary != ''",
			userID, model.RecordingOriginTypes(), "normal").
		Where("f.is_deleted = ?", false).
		Group("ecr.file_id").
		Order("COUNT(DISTINCT ecr.entity_id) DESC").
		Limit(5).
		Pluck("ecr.file_id", &historyFileIDs)

	var rows []historyMeeting
	for _, historyFileID := range historyFileIDs {
		var file model.File
		if err := model.DB.WithContext(ctx).Where("id = ?", historyFileID).First(&file).Error; err != nil {
			continue
		}
		var claims []model.RecordingMemoryClaim
		_ = model.DB.WithContext(ctx).
			Where("eid = ? AND owner_id = ? AND file_id = ? AND is_current = ?", eid, userID, historyFileID, true).
			Where("assertion_state NOT IN ?", []string{"rejected"}).
			Limit(8).Find(&claims)
		var mems []meetingMemoryContext
		for _, c := range claims {
			mems = append(mems, meetingMemoryContext{
				MemoryID: c.ID,
				Kind:     c.ClaimKind,
				Content:  string(c.Content),
			})
		}
		rows = append(rows, historyMeeting{
			FileID:   historyFileID,
			Title:    file.Path,
			Memories: mems,
		})
	}
	return rows
}
