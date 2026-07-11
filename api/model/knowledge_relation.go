package model

import (
	"encoding/json"
	"time"

	"gorm.io/gorm"
)

// KnowledgeRelation 知识点关联关系模型 - 存储知识点之间的关联关系
type KnowledgeRelation struct {
	ID        int64 `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid       int64 `json:"eid" gorm:"not null;index"`
	LibraryID int64 `json:"library_id" gorm:"not null;index" comment:"知识库ID"`

	// 关联关系 - 知识点之间的关联
	SourceKnowledgeID int64 `json:"source_knowledge_id" gorm:"not null;index" comment:"源知识点分块ID"`
	TargetKnowledgeID int64 `json:"target_knowledge_id" gorm:"not null;index" comment:"目标知识点分块ID"`

	// 关联元数据
	RelationType     string  `json:"relation_type" gorm:"size:20;not null;default:'manual'" comment:"关联类型：manual,auto,semantic"`
	RelationWeight   float64 `json:"relation_weight" gorm:"not null;default:1.0" comment:"关联权重"`
	RelationMetadata string  `json:"relation_metadata" gorm:"type:text" comment:"关联元数据JSON"`

	// 状态
	Status string `json:"status" gorm:"size:20;not null;default:'active'" comment:"状态：active,inactive"`

	BaseModel
}

// KnowledgeRelationMetadata 知识点关联元数据结构
type KnowledgeRelationMetadata struct {
	CreatedBy      int64   `json:"created_by"`      // 创建者ID
	CreatedReason  string  `json:"created_reason"`  // 创建原因
	SemanticScore  float64 `json:"semantic_score"`  // 语义相似度分数
	ContentOverlap float64 `json:"content_overlap"` // 内容重叠度
	LastUpdated    int64   `json:"last_updated"`    // 最后更新时间
}

// TableName 设置表名
func (KnowledgeRelation) TableName() string {
	return "knowledge_relations"
}

// Save 创建知识点关联关系
func (kr *KnowledgeRelation) Save() error {
	result := DB.Create(kr)
	if result.Error != nil {
		return result.Error
	}
	return nil
}

// SaveWithDB 使用指定数据库连接创建知识点关联关系
func (kr *KnowledgeRelation) SaveWithDB(db *gorm.DB) error {
	result := db.Create(kr)
	if result.Error != nil {
		return result.Error
	}
	return nil
}

// Update 更新知识点关联关系
func (kr *KnowledgeRelation) Update() error {
	result := DB.Model(kr).Updates(kr)
	if result.Error != nil {
		return result.Error
	}
	return nil
}

// GetRelationMetadata 获取解析后的关联元数据
func (kr *KnowledgeRelation) GetRelationMetadata() (*KnowledgeRelationMetadata, error) {
	if kr.RelationMetadata == "" {
		return &KnowledgeRelationMetadata{
			LastUpdated: time.Now().UTC().UnixMilli(),
		}, nil
	}

	var metadata KnowledgeRelationMetadata
	err := json.Unmarshal([]byte(kr.RelationMetadata), &metadata)
	if err != nil {
		return nil, err
	}
	return &metadata, nil
}

// SetRelationMetadata 设置关联元数据
func (kr *KnowledgeRelation) SetRelationMetadata(metadata *KnowledgeRelationMetadata) error {
	metadata.LastUpdated = time.Now().UTC().UnixMilli()
	data, err := json.Marshal(metadata)
	if err != nil {
		return err
	}
	kr.RelationMetadata = string(data)
	return nil
}

// GetKnowledgeRelationsBySourceID 根据源知识点ID获取所有关联关系
func GetKnowledgeRelationsBySourceID(eid int64, sourceKnowledgeID int64) ([]KnowledgeRelation, error) {
	var relations []KnowledgeRelation
	err := DB.Where("eid = ? AND source_knowledge_id = ? AND status = ?",
		eid, sourceKnowledgeID, "active").
		Order("relation_weight desc").Find(&relations).Error
	return relations, err
}

// GetKnowledgeRelationsByTargetID 根据目标知识点ID获取所有关联关系
func GetKnowledgeRelationsByTargetID(eid int64, targetKnowledgeID int64) ([]KnowledgeRelation, error) {
	var relations []KnowledgeRelation
	err := DB.Where("eid = ? AND target_knowledge_id = ? AND status = ?",
		eid, targetKnowledgeID, "active").
		Order("relation_weight desc").Find(&relations).Error
	return relations, err
}

// GetKnowledgeRelationsByKnowledgeID 根据知识点ID获取所有关联关系（包括作为源和目标的）
func GetKnowledgeRelationsByKnowledgeID(eid int64, knowledgeID int64) ([]KnowledgeRelation, error) {
	return GetKnowledgeRelationsByKnowledgeIDWithDB(DB, eid, knowledgeID)
}

// GetKnowledgeRelationsByKnowledgeIDWithDB 使用指定数据库连接根据知识点ID获取所有关联关系
func GetKnowledgeRelationsByKnowledgeIDWithDB(db *gorm.DB, eid int64, knowledgeID int64) ([]KnowledgeRelation, error) {
	var relations []KnowledgeRelation
	err := db.Where("eid = ? AND (source_knowledge_id = ? OR target_knowledge_id = ?) AND status = ?",
		eid, knowledgeID, knowledgeID, "active").
		Order("relation_weight desc").Find(&relations).Error
	return relations, err
}

// CreateKnowledgeRelation 创建知识点关联关系
func CreateKnowledgeRelation(eid int64, libraryID int64, sourceKnowledgeID int64, targetKnowledgeID int64, relationType string, weight float64, metadata *KnowledgeRelationMetadata) (*KnowledgeRelation, error) {
	return CreateKnowledgeRelationWithDB(DB, eid, libraryID, sourceKnowledgeID, targetKnowledgeID, relationType, weight, metadata)
}

// CreateKnowledgeRelationWithDB 使用指定数据库连接创建知识点关联关系
func CreateKnowledgeRelationWithDB(db *gorm.DB, eid int64, libraryID int64, sourceKnowledgeID int64, targetKnowledgeID int64, relationType string, weight float64, metadata *KnowledgeRelationMetadata) (*KnowledgeRelation, error) {
	relation := &KnowledgeRelation{
		Eid:               eid,
		LibraryID:         libraryID,
		SourceKnowledgeID: sourceKnowledgeID,
		TargetKnowledgeID: targetKnowledgeID,
		RelationType:      relationType,
		RelationWeight:    weight,
		Status:            "active",
	}

	if metadata != nil {
		err := relation.SetRelationMetadata(metadata)
		if err != nil {
			return nil, err
		}
	}

	err := relation.SaveWithDB(db)
	if err != nil {
		return nil, err
	}

	return relation, nil
}

// BatchCreateKnowledgeRelationsWithDB 使用指定数据库连接批量创建知识点关联关系
func BatchCreateKnowledgeRelationsWithDB(db *gorm.DB, relations []KnowledgeRelation) error {
	if len(relations) == 0 {
		return nil
	}
	if db == nil {
		db = DB
	}

	return db.CreateInBatches(relations, 100).Error
}

// DeleteKnowledgeRelationsByKnowledgeID 删除知识点的所有关联关系
func DeleteKnowledgeRelationsByKnowledgeID(eid int64, knowledgeID int64) error {
	return DB.Where("eid = ? AND (source_knowledge_id = ? OR target_knowledge_id = ?)",
		eid, knowledgeID, knowledgeID).
		Delete(&KnowledgeRelation{}).Error
}

// DeleteKnowledgeRelationsByKnowledgeIDWithDB 使用指定数据库连接删除知识点的所有关联关系
func DeleteKnowledgeRelationsByKnowledgeIDWithDB(db *gorm.DB, eid int64, knowledgeID int64) error {
	if db == nil {
		db = DB
	}
	return db.Where("eid = ? AND (source_knowledge_id = ? OR target_knowledge_id = ?)",
		eid, knowledgeID, knowledgeID).
		Delete(&KnowledgeRelation{}).Error
}

// UpdateKnowledgeRelationStatus 更新关联关系状态
func UpdateKnowledgeRelationStatus(eid int64, relationID int64, status string) error {
	return DB.Model(&KnowledgeRelation{}).
		Where("eid = ? AND id = ?", eid, relationID).
		Update("status", status).Error
}

// BatchCreateKnowledgeRelations 批量创建知识点关联关系
func BatchCreateKnowledgeRelations(relations []KnowledgeRelation) error {
	return BatchCreateKnowledgeRelationsWithDB(DB, relations)
}

// GetKnowledgeRelationStats 获取知识点关联关系统计
func GetKnowledgeRelationStats(eid int64, libraryID int64) (*KnowledgeRelationStats, error) {
	var stats KnowledgeRelationStats

	// 总关联数
	err := DB.Model(&KnowledgeRelation{}).
		Where("eid = ? AND library_id = ? AND status = ?", eid, libraryID, "active").
		Count(&stats.TotalRelations).Error
	if err != nil {
		return nil, err
	}

	// 自动关联数
	err = DB.Model(&KnowledgeRelation{}).
		Where("eid = ? AND library_id = ? AND status = ? AND relation_type = ?", eid, libraryID, "active", "auto").
		Count(&stats.AutoRelations).Error
	if err != nil {
		return nil, err
	}

	// 手动关联数
	stats.ManualRelations = stats.TotalRelations - stats.AutoRelations

	// 平均权重
	var avgWeight float64
	err = DB.Model(&KnowledgeRelation{}).
		Select("AVG(relation_weight)").
		Where("eid = ? AND library_id = ? AND status = ?", eid, libraryID, "active").
		Scan(&avgWeight).Error
	if err == nil {
		stats.AvgWeight = avgWeight
	}

	return &stats, nil
}

// KnowledgeRelationStats 知识点关联关系统计
type KnowledgeRelationStats struct {
	TotalRelations  int64   `json:"total_relations"`
	AutoRelations   int64   `json:"auto_relations"`
	ManualRelations int64   `json:"manual_relations"`
	AvgWeight       float64 `json:"avg_weight"`
}
