package model

import (
	"errors"
	"fmt"
	"strings"

	"gorm.io/gorm"
)

// EntityType* 实体类型枚举（用于统一管理实体分类）
const (
	EntityTypePerson       = "Person"       // 人物（真实的人名）
	EntityTypeOrganization = "Organization" // 组织/公司/部门/机构
	EntityTypeProduct      = "Product"      // 产品/系统/服务/平台名称（软件、硬件、业务产品）
	EntityTypeLocation     = "Location"     // 地点（国家、省市、园区、地址等）
	EntityTypeTime         = "Time"         // 时间（日期、月份、年份、时间点、时间范围）
	EntityTypeEvent        = "Event"        // 事件（发布、会议、故障、活动等）
	EntityTypeDocument     = "Document"     // 文档/制度/规范/手册/协议/文件名等
	EntityTypeConcept      = "Concept"      // 概念/术语/指标/名词性知识点（默认兜底）
	EntityTypeMethod       = "Method"       // 方法/流程/步骤/方案/机制
)

// EntityRelationSource* 实体关联来源枚举（用于区分自动/手动来源，便于重生成时隔离）
const (
	EntityRelationSourceManual   = "manual"    // 手动维护
	EntityRelationSourceAutoMeta = "auto_meta" // 基于空间/知识库/文件名等元信息自动生成
	EntityRelationSourceAutoLLM  = "auto_llm"  // 基于文档内容的 LLM 自动抽取
)

// EntityRelationStatus* 实体关联状态枚举（用于标记关联是否有效）
const (
	EntityRelationStatusActive  = "active"  // 有效
	EntityRelationStatusDeleted = "deleted" // 假删除
)

// GetAllEntityTypes 返回所有预定义的实体类型及其描述
func GetAllEntityTypes() map[string]string {
	return map[string]string{
		EntityTypePerson:       "人物（真实的人名）",
		EntityTypeOrganization: "组织/公司/部门/机构",
		EntityTypeProduct:      "产品/系统/服务/平台名称（软件、硬件、业务产品）",
		EntityTypeLocation:     "地点（国家、省市、园区、地址等）",
		EntityTypeTime:         "时间（日期、月份、年份、时间点、时间范围）",
		EntityTypeEvent:        "事件（发布、会议、故障、活动等有发生含义的事件）",
		EntityTypeDocument:     "文档/制度/规范/手册/协议/文件名等",
		EntityTypeConcept:      "概念/术语/指标/名词性知识点",
		EntityTypeMethod:       "方法/流程/步骤/方案/机制",
	}
}

type Entity struct {
	ID   int64  `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid  int64  `json:"eid" gorm:"not null;uniqueIndex:idx_entities_unique,priority:1;index"`
	Type string `json:"type" gorm:"size:32;not null;uniqueIndex:idx_entities_unique,priority:2;index"`
	Name string `json:"name" gorm:"size:128;not null;uniqueIndex:idx_entities_unique,priority:3;index"`

	Status string `json:"status" gorm:"size:20;not null;default:'active';index"`

	BaseModel
}

func (Entity) TableName() string {
	return "entities"
}

type EntityChunkRelation struct {
	ID int64 `json:"id" gorm:"primaryKey;autoIncrement"`

	Eid      int64 `json:"eid" gorm:"not null;index;uniqueIndex:idx_entity_scope_unique,priority:1"`
	EntityID int64 `json:"entity_id" gorm:"not null;index;uniqueIndex:idx_entity_scope_unique,priority:2"`

	SpaceID   int64 `json:"space_id" gorm:"not null;index;uniqueIndex:idx_entity_scope_unique,priority:3"`
	LibraryID int64 `json:"library_id" gorm:"not null;index;uniqueIndex:idx_entity_scope_unique,priority:4"`
	FileID    int64 `json:"file_id" gorm:"not null;index;uniqueIndex:idx_entity_scope_unique,priority:5"`
	ChunkID   int64 `json:"chunk_id" gorm:"not null;index;uniqueIndex:idx_entity_scope_unique,priority:6"`

	ChunkType string `json:"chunk_type" gorm:"size:20;not null;default:'knowledge';index"`

	Status string `json:"status" gorm:"size:20;not null;default:'active';index"`

	Confidence float64 `json:"confidence" gorm:"not null;default:1.0"`
	Source     string  `json:"source" gorm:"size:20;not null;default:'manual';index"`

	// 图谱相关字段
	TemplateID int64  `json:"template_id" gorm:"index"`    // 图谱模板ID（图谱生成时填充，0表示非图谱来源）
	Properties string `json:"properties" gorm:"type:text"` // 实体属性 JSON，格式: {"属性名": "属性值"}

	BaseModel
}

func (EntityChunkRelation) TableName() string {
	return "entity_chunk_relations"
}

func GetOrCreateEntityWithDB(db *gorm.DB, eid int64, entityType string, name string) (*Entity, error) {
	entity, _, err := GetOrCreateEntityWithDBAndCreated(db, eid, entityType, name)
	return entity, err
}

func GetOrCreateEntityWithDBAndCreated(db *gorm.DB, eid int64, entityType string, name string) (*Entity, bool, error) {
	entityType = strings.TrimSpace(entityType)
	name = strings.TrimSpace(name)
	if entityType == "" || name == "" {
		return nil, false, errors.New("entity type or name is empty")
	}

	e := &Entity{
		Eid:    eid,
		Type:   entityType,
		Name:   name,
		Status: "active",
	}

	result := db.Where("eid = ? AND type = ? AND name = ?", eid, entityType, name).FirstOrCreate(e)
	if result.Error != nil {
		return nil, false, result.Error
	}
	created := result.RowsAffected > 0
	return e, created, nil
}

func CountEntitiesByNamesWithDB(db *gorm.DB, eid int64, names []string) (int64, error) {
	if db == nil {
		return 0, errors.New("db is nil")
	}
	if eid <= 0 {
		return 0, errors.New("eid is empty")
	}

	uniq := make(map[string]struct{}, len(names))
	cleaned := make([]string, 0, len(names))
	for _, n := range names {
		n = strings.TrimSpace(n)
		if n == "" {
			continue
		}
		if _, ok := uniq[n]; ok {
			continue
		}
		uniq[n] = struct{}{}
		cleaned = append(cleaned, n)
	}
	if len(cleaned) == 0 {
		return 0, nil
	}

	var count int64
	if err := db.Model(&Entity{}).
		Where("eid = ? AND status = ? AND name IN ?", eid, "active", cleaned).
		Count(&count).Error; err != nil {
		return 0, err
	}
	return count, nil
}

func ReplaceEntityChunkRelationsWithDB(db *gorm.DB, eid int64, chunkID int64, relations []EntityChunkRelation) error {
	if err := db.Where("eid = ? AND chunk_id = ?", eid, chunkID).Delete(&EntityChunkRelation{}).Error; err != nil {
		return err
	}
	if len(relations) == 0 {
		return nil
	}
	return db.CreateInBatches(relations, 200).Error
}

func ReplaceEntityChunkRelationsBySourceWithDB(db *gorm.DB, eid int64, chunkID int64, source string, relations []EntityChunkRelation) error {
	source = strings.TrimSpace(source)
	if source == "" {
		return errors.New("source is empty")
	}
	if err := db.Where("eid = ? AND chunk_id = ? AND source = ?", eid, chunkID, source).Delete(&EntityChunkRelation{}).Error; err != nil {
		return err
	}
	if len(relations) == 0 {
		return nil
	}
	return db.CreateInBatches(relations, 200).Error
}

func ReplaceEntityScopeRelationsBySourceWithDB(db *gorm.DB, eid int64, spaceID, libraryID, fileID, chunkID int64, source string, relations []EntityChunkRelation) error {
	source = strings.TrimSpace(source)
	if source == "" {
		return errors.New("source is empty")
	}
	query := db.Where("eid = ? AND source = ?", eid, source)
	query = query.Where("space_id = ? AND library_id = ? AND file_id = ? AND chunk_id = ?", spaceID, libraryID, fileID, chunkID)
	if err := query.Delete(&EntityChunkRelation{}).Error; err != nil {
		return err
	}
	if len(relations) == 0 {
		return nil
	}
	return db.CreateInBatches(relations, 200).Error
}

func DeleteOrphanEntitiesByIDsWithDB(db *gorm.DB, eid int64, entityIDs []int64) error {
	if db == nil {
		return errors.New("db is nil")
	}
	if eid <= 0 {
		return errors.New("eid is empty")
	}
	if len(entityIDs) == 0 {
		return nil
	}

	uniq := make(map[int64]struct{}, len(entityIDs))
	cleaned := make([]int64, 0, len(entityIDs))
	for _, id := range entityIDs {
		if id <= 0 {
			continue
		}
		if _, ok := uniq[id]; ok {
			continue
		}
		uniq[id] = struct{}{}
		cleaned = append(cleaned, id)
	}
	if len(cleaned) == 0 {
		return nil
	}

	return db.Model(&Entity{}).
		Where("eid = ? AND id IN ?", eid, cleaned).
		Where("NOT EXISTS (SELECT 1 FROM entity_chunk_relations WHERE entity_chunk_relations.eid = ? AND entity_chunk_relations.entity_id = entities.id)", eid).
		Delete(&Entity{}).Error
}

func GetEntityVectorCollectionName(eid int64) string {
	return fmt.Sprintf("entity_eid_%d", eid)
}
