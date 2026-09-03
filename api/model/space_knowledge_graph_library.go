package model

import (
	"errors"

	"gorm.io/gorm"
)

// 空间知识库范围类型
const (
	SpaceKnowledgeGraphScopeNormal = "normal" // 普通图谱管线范围
	SpaceKnowledgeGraphScopeWiki   = "wiki"   // Wiki 知识图谱范围
)

// SpaceKnowledgeGraphLibrary 空间图谱知识库范围关联表（按类型区分 normal=普通图谱 / wiki=Wiki知识图谱）。
// 空记录 = 全部知识库。
type SpaceKnowledgeGraphLibrary struct {
	ID        int64  `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid       int64  `json:"eid" gorm:"not null;index"`
	SpaceID   int64  `json:"space_id" gorm:"not null;index:idx_skgl_space_type,priority:1"`
	LibraryID int64  `json:"library_id" gorm:"not null;index"`
	Type      string `json:"type" gorm:"type:varchar(16);not null;default:normal;comment:normal=普通图谱 wiki=Wiki知识图谱"`
	BaseModel
}

func (SpaceKnowledgeGraphLibrary) TableName() string {
	return "space_knowledge_graph_libraries"
}

// ReplaceSpaceKnowledgeGraphLibraryScope 整体替换某空间某类型的知识库范围（空=全部）。
// 若在外部事务内使用，请传入该事务的 *gorm.DB。
func ReplaceSpaceKnowledgeGraphLibraryScope(db *gorm.DB, eid, spaceID int64, scopeType string, libraryIDs []int64) error {
	if db == nil {
		return errors.New("db is nil")
	}
	if err := db.Where("eid = ? AND space_id = ? AND type = ?", eid, spaceID, scopeType).
		Delete(&SpaceKnowledgeGraphLibrary{}).Error; err != nil {
		return err
	}
	seen := make(map[int64]struct{}, len(libraryIDs))
	for _, libraryID := range libraryIDs {
		if _, dup := seen[libraryID]; dup {
			continue
		}
		seen[libraryID] = struct{}{}
		rec := SpaceKnowledgeGraphLibrary{
			Eid:       eid,
			SpaceID:   spaceID,
			LibraryID: libraryID,
			Type:      scopeType,
		}
		if err := db.Create(&rec).Error; err != nil {
			return err
		}
	}
	return nil
}

// GetSpaceKnowledgeGraphLibraryIDs 获取某空间某类型的知识库范围（int64 数组；空=全部）。
func GetSpaceKnowledgeGraphLibraryIDs(db *gorm.DB, eid, spaceID int64, scopeType string) ([]int64, error) {
	if db == nil {
		return nil, errors.New("db is nil")
	}
	var recs []SpaceKnowledgeGraphLibrary
	if err := db.Where("eid = ? AND space_id = ? AND type = ?", eid, spaceID, scopeType).
		Order("id asc").
		Find(&recs).Error; err != nil {
		return nil, err
	}
	ids := make([]int64, 0, len(recs))
	for _, rec := range recs {
		ids = append(ids, rec.LibraryID)
	}
	return ids, nil
}
