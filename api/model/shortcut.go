package model

import (
	"errors"

	"gorm.io/gorm"
)

// ShortcutType* 快捷方式类型枚举（用于区分快捷方式关联的对象类型）
const (
	ShortcutTypeAgent   = "agent"   // 智能体
	ShortcutTypeLibrary = "library" // 知识库
	ShortcutTypeAILink  = "ai_link" // AI工具
)

// Shortcut 快捷方式表
type Shortcut struct {
	ID        int64  `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid       int64  `json:"eid" gorm:"not null;index:idx_shortcuts_unique,priority:1;index"`
	UserID    int64  `json:"user_id" gorm:"not null;index:idx_shortcuts_unique,priority:2;index"`
	Type      string `json:"type" gorm:"type:varchar(32);not null;index:idx_shortcuts_unique,priority:3;index"`
	RelatedID int64  `json:"related_id" gorm:"not null;index:idx_shortcuts_unique,priority:4;index"`
	BaseModel
}

func (Shortcut) TableName() string { return "shortcuts" }

func (s *Shortcut) Validate() error {
	if s.Eid <= 0 {
		return errors.New("企业ID无效")
	}
	if s.UserID <= 0 {
		return errors.New("用户ID无效")
	}
	if s.RelatedID <= 0 {
		return errors.New("关联ID无效")
	}
	switch s.Type {
	case ShortcutTypeAgent, ShortcutTypeLibrary, ShortcutTypeAILink:
		return nil
	default:
		return errors.New("快捷方式类型无效")
	}
}

// EnsureShortcut 确保快捷方式存在（幂等）
func EnsureShortcut(eid, userID int64, shortcutType string, relatedID int64) (*Shortcut, error) {
	s := &Shortcut{
		Eid:       eid,
		UserID:    userID,
		Type:      shortcutType,
		RelatedID: relatedID,
	}
	if err := s.Validate(); err != nil {
		return nil, err
	}

	exist, err := GetShortcutByUserTypeRelatedID(eid, userID, shortcutType, relatedID)
	if err == nil && exist != nil {
		return exist, nil
	}
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	if err := DB.Create(s).Error; err != nil {
		return nil, err
	}
	return s, nil
}

func GetUserShortcuts(eid, userID int64) ([]Shortcut, error) {
	var shortcuts []Shortcut
	err := DB.Where("eid = ? AND user_id = ?", eid, userID).
		Order("updated_time desc").
		Find(&shortcuts).Error
	return shortcuts, err
}

func GetShortcutByUserTypeRelatedID(eid, userID int64, shortcutType string, relatedID int64) (*Shortcut, error) {
	var s Shortcut
	err := DB.Where("eid = ? AND user_id = ? AND type = ? AND related_id = ?", eid, userID, shortcutType, relatedID).
		First(&s).Error
	if err != nil {
		return nil, err
	}
	return &s, nil
}
