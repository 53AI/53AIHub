package model

import (
	"encoding/json"
	"time"

	"gorm.io/gorm"
)

// ChunkRelation 分块关联关系元数据模型 - 存储复杂的关联关系信息
type ChunkRelation struct {
	ID        int64 `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid       int64 `json:"eid" gorm:"not null;index"`
	FileID    int64 `json:"file_id" gorm:"not null;index" comment:"文件ID"`
	LibraryID int64 `json:"library_id" gorm:"not null;index" comment:"知识库ID"`

	// 关联关系 - 现在指向RetrievalChunk
	KnowledgeChunkID int64 `json:"knowledge_chunk_id" gorm:"not null;index" comment:"知识点分块ID"`
	RetrievalChunkID int64 `json:"retrieval_chunk_id" gorm:"not null;index" comment:"检索块ID"`

	// 关联元数据
	RelationType     string  `json:"relation_type" gorm:"size:20;not null;default:'auto'" comment:"关联类型：auto,manual,semantic"`
	RelationWeight   float64 `json:"relation_weight" gorm:"not null;default:1.0" comment:"关联权重"`
	RelationMetadata string  `json:"relation_metadata" gorm:"type:text" comment:"关联元数据JSON"`

	// 状态
	Status string `json:"status" gorm:"size:20;not null;default:'active'" comment:"状态：active,inactive"`

	BaseModel
}

// RelationMetadataData 关联元数据结构
type RelationMetadataData struct {
	CreatedBy      int64   `json:"created_by"`      // 创建者ID
	CreatedReason  string  `json:"created_reason"`  // 创建原因
	SemanticScore  float64 `json:"semantic_score"`  // 语义相似度分数
	PositionScore  float64 `json:"position_score"`  // 位置相关性分数
	ContentOverlap float64 `json:"content_overlap"` // 内容重叠度
	LastUpdated    int64   `json:"last_updated"`    // 最后更新时间
}

// TableName 设置表名
func (ChunkRelation) TableName() string {
	return "chunk_relations"
}

// Save 创建分块关联关系
func (cr *ChunkRelation) Save() error {
	result := DB.Create(cr)
	if result.Error != nil {
		return result.Error
	}
	return nil
}

// Update 更新分块关联关系
func (cr *ChunkRelation) Update() error {
	result := DB.Model(cr).Updates(cr)
	if result.Error != nil {
		return result.Error
	}
	return nil
}

// GetRelationMetadata 获取解析后的关联元数据
func (cr *ChunkRelation) GetRelationMetadata() (*RelationMetadataData, error) {
	if cr.RelationMetadata == "" {
		return &RelationMetadataData{
			LastUpdated: time.Now().UTC().UnixMilli(),
		}, nil
	}

	var metadata RelationMetadataData
	err := json.Unmarshal([]byte(cr.RelationMetadata), &metadata)
	if err != nil {
		return nil, err
	}
	return &metadata, nil
}

// SetRelationMetadata 设置关联元数据
func (cr *ChunkRelation) SetRelationMetadata(metadata *RelationMetadataData) error {
	metadata.LastUpdated = time.Now().UTC().UnixMilli()
	data, err := json.Marshal(metadata)
	if err != nil {
		return err
	}
	cr.RelationMetadata = string(data)
	return nil
}

// GetChunkRelationByRetrievalID 根据检索块ID获取关联关系元数据
func GetChunkRelationByRetrievalID(eid int64, retrievalChunkID int64) (*ChunkRelation, error) {
	var relation ChunkRelation
	err := DB.Where("eid = ? AND retrieval_chunk_id = ? AND status = ?",
		eid, retrievalChunkID, "active").First(&relation).Error
	return &relation, err
}

// GetChunkRelationsByKnowledgeID 根据知识点分块ID获取所有关联关系元数据
func GetChunkRelationsByKnowledgeID(eid int64, knowledgeChunkID int64) ([]ChunkRelation, error) {
	var relations []ChunkRelation
	err := DB.Where("eid = ? AND knowledge_chunk_id = ? AND status = ?",
		eid, knowledgeChunkID, "active").
		Order("relation_weight desc").Find(&relations).Error
	return relations, err
}

// GetChunkRelationsByFileID 获取文件的所有分块关联关系
func GetChunkRelationsByFileID(eid int64, fileID int64) ([]ChunkRelation, error) {
	var relations []ChunkRelation
	err := DB.Where("eid = ? AND file_id = ? AND status = ?", eid, fileID, "active").
		Order("id asc").Find(&relations).Error
	return relations, err
}

// CreateChunkRelation 创建分块关联关系
func CreateChunkRelation(eid int64, fileID int64, libraryID int64, knowledgeChunkID int64, retrievalChunkID int64, relationType string, weight float64, metadata *RelationMetadataData) (*ChunkRelation, error) {
	relation := &ChunkRelation{
		Eid:              eid,
		FileID:           fileID,
		LibraryID:        libraryID,
		KnowledgeChunkID: knowledgeChunkID,
		RetrievalChunkID: retrievalChunkID,
		RelationType:     relationType,
		RelationWeight:   weight,
		Status:           "active",
	}

	if metadata != nil {
		err := relation.SetRelationMetadata(metadata)
		if err != nil {
			return nil, err
		}
	}

	err := relation.Save()
	if err != nil {
		return nil, err
	}

	return relation, nil
}

// BatchCreateChunkRelationsWithDB 使用指定 DB 批量创建分块关联关系
func BatchCreateChunkRelationsWithDB(db *gorm.DB, relations []ChunkRelation) error {
	if len(relations) == 0 {
		return nil
	}
	if db == nil {
		db = DB
	}
	return db.CreateInBatches(relations, 100).Error
}

// DeleteChunkRelationsByKnowledgeID 删除知识点分块的所有关联关系
func DeleteChunkRelationsByKnowledgeID(eid int64, knowledgeChunkID int64) error {
	return DB.Where("eid = ? AND knowledge_chunk_id = ?", eid, knowledgeChunkID).
		Delete(&ChunkRelation{}).Error
}

// DeleteChunkRelationsByRetrievalID 删除检索块的关联关系
func DeleteChunkRelationsByRetrievalID(eid int64, retrievalChunkID int64) error {
	return DB.Where("eid = ? AND retrieval_chunk_id = ?", eid, retrievalChunkID).
		Delete(&ChunkRelation{}).Error
}

// UpdateChunkRelationStatus 更新关联关系状态
func UpdateChunkRelationStatus(eid int64, relationID int64, status string) error {
	return DB.Model(&ChunkRelation{}).
		Where("eid = ? AND id = ?", eid, relationID).
		Update("status", status).Error
}

// GetChunkRelationStats 获取分块关联关系统计
func GetChunkRelationStats(eid int64, fileID int64) (*ChunkRelationStats, error) {
	var stats ChunkRelationStats

	// 总关联数
	err := DB.Model(&ChunkRelation{}).
		Where("eid = ? AND file_id = ? AND status = ?", eid, fileID, "active").
		Count(&stats.TotalRelations).Error
	if err != nil {
		return nil, err
	}

	// 自动关联数
	err = DB.Model(&ChunkRelation{}).
		Where("eid = ? AND file_id = ? AND status = ? AND relation_type = ?", eid, fileID, "active", "auto").
		Count(&stats.AutoRelations).Error
	if err != nil {
		return nil, err
	}

	// 手动关联数
	stats.ManualRelations = stats.TotalRelations - stats.AutoRelations

	// 平均权重
	var avgWeight float64
	err = DB.Model(&ChunkRelation{}).
		Select("AVG(relation_weight)").
		Where("eid = ? AND file_id = ? AND status = ?", eid, fileID, "active").
		Scan(&avgWeight).Error
	if err == nil {
		stats.AvgWeight = avgWeight
	}

	return &stats, nil
}

// ChunkRelationStats 分块关联关系统计
type ChunkRelationStats struct {
	TotalRelations  int64   `json:"total_relations"`
	AutoRelations   int64   `json:"auto_relations"`
	ManualRelations int64   `json:"manual_relations"`
	AvgWeight       float64 `json:"avg_weight"`
}

// BatchCreateChunkRelations 批量创建分块关联关系
func BatchCreateChunkRelations(relations []ChunkRelation) error {
	return BatchCreateChunkRelationsWithDB(DB, relations)
}

// GetOrphanedRetrievalChunks 获取没有关联关系的检索块
func GetOrphanedRetrievalChunks(eid int64, fileID int64) ([]DocumentChunk, error) {
	var chunks []DocumentChunk

	err := DB.Table("document_chunks").
		Select("document_chunks.*").
		Where("document_chunks.eid = ? AND document_chunks.file_id = ? AND document_chunks.chunk_type = ?",
			eid, fileID, "index").
		Where("NOT EXISTS (SELECT 1 FROM chunk_relations WHERE chunk_relations.retrieval_chunk_id = document_chunks.id AND chunk_relations.status = ?)",
			"active").
		Order("document_chunks.chunk_index asc").
		Find(&chunks).Error

	return chunks, err
}

// GetOrphanedKnowledgeChunks 获取没有关联检索块的知识点分块
func GetOrphanedKnowledgeChunks(eid int64, fileID int64) ([]DocumentChunk, error) {
	var chunks []DocumentChunk

	err := DB.Table("document_chunks").
		Select("document_chunks.*").
		Where("document_chunks.eid = ? AND document_chunks.file_id = ? AND document_chunks.chunk_type = ?",
			eid, fileID, "knowledge").
		Where("NOT EXISTS (SELECT 1 FROM chunk_relations WHERE chunk_relations.knowledge_chunk_id = document_chunks.id AND chunk_relations.status = ?)",
			"active").
		Order("document_chunks.chunk_index asc").
		Find(&chunks).Error

	return chunks, err
}
