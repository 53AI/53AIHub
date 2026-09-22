package model

import (
	"context"
	"fmt"
	"strings"

	"gorm.io/gorm"
)

const (
	SourceTypeInsight      = "insight"
	SourceTypeMeeting      = "meeting"
	SourceTypeConversation = "conversation"
	SourceTypeResult       = "result"
	SourceTypeManual       = "manual"

	LegacySourceTypeRecordingFile = "recording_file"
)

const (
	ActionSourceRefRolePrimary = "primary"
	ActionSourceRefRoleRelated = "related"

	ActionSourceParentOpportunity = "opportunity"
	ActionSourceParentPlan        = "plan"
	ActionSourceParentResultAsset = "result_asset"
)

// CanonicalSourceIdentityRecord is an identity-only compatibility mapping. It
// deliberately stores no meeting, insight, or conversation content.
type CanonicalSourceIdentityRecord struct {
	ID               int64  `json:"-" gorm:"primaryKey;autoIncrement"`
	CanonicalID      string `json:"canonical_id" gorm:"size:128;not null;uniqueIndex:uk_action_source_identities_canonical"`
	Eid              int64  `json:"-" gorm:"not null;uniqueIndex:uk_action_source_identities_legacy,priority:1;index:idx_action_source_identities_scope,priority:1"`
	SourceType       string `json:"source_type" gorm:"size:32;not null;uniqueIndex:uk_action_source_identities_legacy,priority:2;index:idx_action_source_identities_scope,priority:2"`
	LegacySourceType string `json:"legacy_source_type" gorm:"size:64;not null;uniqueIndex:uk_action_source_identities_legacy,priority:3"`
	LegacySourceID   string `json:"legacy_source_id" gorm:"size:128;not null;uniqueIndex:uk_action_source_identities_legacy,priority:4"`
	BaseModel
}

func (CanonicalSourceIdentityRecord) TableName() string { return "action_source_identities" }

// ActionSourceRefRecord stores primary and related references for an Action.
// ParentType/ParentID is a relation key, not a new business entity.
type ActionSourceRefRecord struct {
	ID            int64  `json:"-" gorm:"primaryKey;autoIncrement"`
	Eid           int64  `json:"-" gorm:"not null;index:idx_action_source_refs_parent,priority:1;index:idx_action_source_refs_source,priority:1"`
	ParentType    string `json:"parent_type" gorm:"size:32;not null;index:idx_action_source_refs_parent,priority:2"`
	ParentID      string `json:"parent_id" gorm:"size:128;not null;index:idx_action_source_refs_parent,priority:3"`
	Role          string `json:"role" gorm:"size:32;not null;index:idx_action_source_refs_parent,priority:4"`
	SourceType    string `json:"source_type" gorm:"size:32;not null;index:idx_action_source_refs_source,priority:2"`
	CanonicalID   string `json:"canonical_id" gorm:"size:128;not null;index:idx_action_source_refs_source,priority:3"`
	SourceVersion string `json:"source_version" gorm:"size:64;not null;default:''"`
	BaseModel
}

func (ActionSourceRefRecord) TableName() string { return "action_source_refs" }

func GenerateCanonicalSourceID(sourceType string) (string, error) {
	if !isCanonicalSourceType(sourceType) {
		return "", fmt.Errorf("unsupported canonical source type: %s", sourceType)
	}
	return generateActionID(sourceType + "_")
}

func EnsureCanonicalSourceIdentity(ctx context.Context, eid int64, sourceType, legacySourceType, legacySourceID string) (*CanonicalSourceIdentityRecord, error) {
	if eid <= 0 || !isCanonicalSourceType(sourceType) || strings.TrimSpace(legacySourceType) == "" || strings.TrimSpace(legacySourceID) == "" {
		return nil, fmt.Errorf("invalid canonical source identity")
	}
	var identity CanonicalSourceIdentityRecord
	query := DB.WithContext(ctx).Where("eid = ? AND source_type = ? AND legacy_source_type = ? AND legacy_source_id = ?", eid, sourceType, strings.TrimSpace(legacySourceType), strings.TrimSpace(legacySourceID))
	if err := query.First(&identity).Error; err == nil {
		return &identity, nil
	} else if err != gorm.ErrRecordNotFound {
		return nil, err
	}

	canonicalID, err := GenerateCanonicalSourceID(sourceType)
	if err != nil {
		return nil, err
	}
	identity = CanonicalSourceIdentityRecord{
		CanonicalID:      canonicalID,
		Eid:              eid,
		SourceType:       sourceType,
		LegacySourceType: strings.TrimSpace(legacySourceType),
		LegacySourceID:   strings.TrimSpace(legacySourceID),
	}
	if err := DB.WithContext(ctx).Create(&identity).Error; err != nil {
		return nil, err
	}
	return &identity, nil
}

func GetCanonicalSourceIdentity(ctx context.Context, eid int64, canonicalID string) (*CanonicalSourceIdentityRecord, error) {
	var identity CanonicalSourceIdentityRecord
	if err := DB.WithContext(ctx).Where("eid = ? AND canonical_id = ?", eid, strings.TrimSpace(canonicalID)).First(&identity).Error; err != nil {
		return nil, err
	}
	return &identity, nil
}

func GetCanonicalSourceIdentityByLegacy(ctx context.Context, eid int64, sourceType, legacySourceType, legacySourceID string) (*CanonicalSourceIdentityRecord, error) {
	var identity CanonicalSourceIdentityRecord
	if err := DB.WithContext(ctx).Where("eid = ? AND source_type = ? AND legacy_source_type = ? AND legacy_source_id = ?", eid, sourceType, strings.TrimSpace(legacySourceType), strings.TrimSpace(legacySourceID)).First(&identity).Error; err != nil {
		return nil, err
	}
	return &identity, nil
}

// GetCanonicalSourceIdentitiesByCanonicalIDs 批量按 canonical_id 查询身份映射，
// 供 Action 来源链接解析使用（常量次查询，避免逐条回源）。
func GetCanonicalSourceIdentitiesByCanonicalIDs(ctx context.Context, eid int64, canonicalIDs []string) (map[string]*CanonicalSourceIdentityRecord, error) {
	ids := make([]string, 0, len(canonicalIDs))
	seen := make(map[string]struct{}, len(canonicalIDs))
	for _, id := range canonicalIDs {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	if len(ids) == 0 {
		return map[string]*CanonicalSourceIdentityRecord{}, nil
	}
	var identities []*CanonicalSourceIdentityRecord
	if err := DB.WithContext(ctx).Where("eid = ? AND canonical_id IN ?", eid, ids).Find(&identities).Error; err != nil {
		return nil, err
	}
	result := make(map[string]*CanonicalSourceIdentityRecord, len(identities))
	for _, identity := range identities {
		if identity == nil {
			continue
		}
		result[identity.CanonicalID] = identity
	}
	return result, nil
}

func ReplaceActionSourceRefs(ctx context.Context, eid int64, parentType, parentID string, refs []*ActionSourceRefRecord) error {
	if eid <= 0 || !isActionSourceParentType(parentType) || strings.TrimSpace(parentID) == "" {
		return fmt.Errorf("invalid action source reference")
	}
	return DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("eid = ? AND parent_type = ? AND parent_id = ?", eid, parentType, strings.TrimSpace(parentID)).Delete(&ActionSourceRefRecord{}).Error; err != nil {
			return err
		}
		return createActionSourceRefs(tx, eid, parentType, parentID, refs)
	})
}

func createActionSourceRefs(tx *gorm.DB, eid int64, parentType, parentID string, refs []*ActionSourceRefRecord) error {
	for _, ref := range refs {
		if ref == nil || !isActionSourceRefRole(ref.Role) || !isCanonicalSourceType(ref.SourceType) || strings.TrimSpace(ref.CanonicalID) == "" {
			return fmt.Errorf("invalid action source reference")
		}
		ref.Eid = eid
		ref.ParentType = parentType
		ref.ParentID = strings.TrimSpace(parentID)
		if err := tx.Create(ref).Error; err != nil {
			return err
		}
	}
	return nil
}

func ListActionSourceRefs(ctx context.Context, eid int64, parentType, parentID string) ([]*ActionSourceRefRecord, error) {
	var refs []*ActionSourceRefRecord
	if err := DB.WithContext(ctx).Where("eid = ? AND parent_type = ? AND parent_id = ?", eid, parentType, strings.TrimSpace(parentID)).Order("role ASC, id ASC").Find(&refs).Error; err != nil {
		return nil, err
	}
	return refs, nil
}

func isCanonicalSourceType(sourceType string) bool {
	switch sourceType {
	case SourceTypeInsight, SourceTypeMeeting, SourceTypeConversation, SourceTypeResult, SourceTypeManual:
		return true
	default:
		return false
	}
}

func isActionSourceRefRole(role string) bool {
	return role == ActionSourceRefRolePrimary || role == ActionSourceRefRoleRelated
}

func isActionSourceParentType(parentType string) bool {
	switch parentType {
	case ActionSourceParentOpportunity, ActionSourceParentPlan, ActionSourceParentResultAsset:
		return true
	default:
		return false
	}
}

// Evidence owner types. Evidence references are relational (single source of
// truth) and are inherited along the chain opportunity -> action -> result
// asset; they are never duplicated into JSON.
const (
	ActionEvidenceOwnerOpportunity = "opportunity"
	ActionEvidenceOwnerAction      = "action"
	ActionEvidenceOwnerResultAsset = "result_asset"
)

// ActionEvidenceRefRecord is the one authoritative store for evidence refs.
type ActionEvidenceRefRecord struct {
	ID         int64  `json:"-" gorm:"primaryKey;autoIncrement"`
	Eid        int64  `json:"-" gorm:"not null;index:idx_action_evidence_refs_owner,priority:1"`
	OwnerType  string `json:"owner_type" gorm:"size:32;not null;index:idx_action_evidence_refs_owner,priority:2"`
	OwnerID    string `json:"owner_id" gorm:"size:64;not null;index:idx_action_evidence_refs_owner,priority:3"`
	SourceType string `json:"source_type" gorm:"size:64;not null"`
	SourceID   string `json:"source_id" gorm:"size:128;not null"`
	SegmentID  string `json:"segment_id" gorm:"size:128;not null;default:''"`
	Excerpt    string `json:"excerpt" gorm:"not null"`
	Timestamp  int64  `json:"timestamp" gorm:"not null;default:0"`
	Position   string `json:"position" gorm:"size:128;not null;default:''"`
	SortOrder  int    `json:"sort_order" gorm:"not null;default:0"`
	BaseModel
}

func (ActionEvidenceRefRecord) TableName() string { return "action_evidence_refs" }

func CreateActionEvidenceRefs(tx *gorm.DB, eid int64, ownerType, ownerID string, refs []*ActionEvidenceRefRecord) error {
	for index, ref := range refs {
		if ref == nil {
			continue
		}
		record := *ref
		record.ID = 0
		record.Eid = eid
		record.OwnerType = ownerType
		record.OwnerID = ownerID
		record.SortOrder = index
		if err := tx.Create(&record).Error; err != nil {
			return err
		}
	}
	return nil
}

func ListActionEvidenceRefs(ctx context.Context, eid int64, ownerType, ownerID string) ([]*ActionEvidenceRefRecord, error) {
	return listActionEvidenceRefs(DB.WithContext(ctx), eid, ownerType, ownerID)
}

// listActionEvidenceRefs runs on the caller's handle so an in-transaction caller
// never opens a second connection for the same rows.
func listActionEvidenceRefs(db *gorm.DB, eid int64, ownerType, ownerID string) ([]*ActionEvidenceRefRecord, error) {
	if strings.TrimSpace(ownerID) == "" {
		return nil, nil
	}
	var refs []*ActionEvidenceRefRecord
	err := db.Where("eid = ? AND owner_type = ? AND owner_id = ?", eid, ownerType, ownerID).
		Order("sort_order ASC, id ASC").Find(&refs).Error
	return refs, err
}

// CloneActionEvidenceRefs copies evidence along the chain (opportunity -> action
// -> result asset) inside the caller's transaction.
func CloneActionEvidenceRefs(tx *gorm.DB, eid int64, fromType, fromID, toType, toID string) error {
	refs, err := listActionEvidenceRefs(tx, eid, fromType, fromID)
	if err != nil {
		return err
	}
	return CreateActionEvidenceRefs(tx, eid, toType, toID, refs)
}
