
package model

import (
	"encoding/json"
	"time"

	"gorm.io/gorm"
)

// UserMemory 用户全局记忆
// 智能记忆和自定义记忆存储在数据库，昵称和部门动态从 User 表读取
type UserMemory struct {
	ID     int64 `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid    int64 `json:"eid" gorm:"not null;uniqueIndex:uk_user_memories_user,priority:1"`
	UserID int64 `json:"user_id" gorm:"not null;uniqueIndex:uk_user_memories_user,priority:2"`

	// SmartMemory 智能记忆信息（系统辅助生成的记忆）
	SmartMemory LongText `json:"smart_memory"`
	// CustomMemory 自定义记忆信息（用户手动编辑的记忆）
	CustomMemory LongText `json:"custom_memory"`

	// Position 职位（用户填写，15字限制）
	Position string `json:"position" gorm:"size:15;default:'';not null;comment:'职位（用户填写，15字限制）'"`
	// Style 风格（选项，用户选择）
	Style string `json:"style" gorm:"size:50;default:'';not null;comment:'风格（选项，用户选择）'"`

	// Version 乐观锁版本号
	Version int `json:"version" gorm:"default:0"`

	BaseModel
}

func (UserMemory) TableName() string {
	return "user_memories"
}

// UserMemoryResponse 用户记忆响应（包含动态关联的系统信息）
type UserMemoryResponse struct {
	ID           int64  `json:"id"`
	Eid          int64  `json:"eid"`
	UserID       int64  `json:"user_id"`
	Nickname     string `json:"nickname"`   // 动态从 User 表读取
	Department   string `json:"department"` // 动态从组织架构读取
	SmartMemory  string `json:"smart_memory"`
	CustomMemory string `json:"custom_memory"`
	Position     string `json:"position"`
	Style        string `json:"style"`
	Version      int    `json:"version"`
}

var StyleOptions = []string{
	"内容简洁、引发思考",
	"结论先行、细节支撑",
	"详细分析、引发思考",
}

// GetSmartMemoryItems 解析智能记忆列表
func (m *UserMemory) GetSmartMemoryItems() ([]MemoryItem, error) {
	if m.SmartMemory == "" || m.SmartMemory == "[]" {
		return []MemoryItem{}, nil
	}
	var items []MemoryItem
	if err := json.Unmarshal([]byte(m.SmartMemory), &items); err != nil {
		return nil, err
	}
	return FilterActiveMemoryItems(items, time.Now().UnixMilli()), nil
}

// GetCustomMemoryItems 解析自定义记忆列表
func (m *UserMemory) GetCustomMemoryItems() ([]MemoryItem, error) {
	if m.CustomMemory == "" || m.CustomMemory == "[]" {
		return []MemoryItem{}, nil
	}
	var items []MemoryItem
	if err := json.Unmarshal([]byte(m.CustomMemory), &items); err != nil {
		return nil, err
	}
	return FilterActiveMemoryItems(items, time.Now().UnixMilli()), nil
}

// SetSmartMemoryItems 序列化智能记忆列表
func (m *UserMemory) SetSmartMemoryItems(items []MemoryItem) error {
	items = NormalizeMemoryItemsForWrite(items, "user_input", DefaultMaxUserSmartMemoryItems, time.Now().UnixMilli())
	data, err := json.Marshal(items)
	if err != nil {
		return err
	}
	m.SmartMemory = LongText(data)
	return nil
}

// SetCustomMemoryItems 序列化自定义记忆列表
func (m *UserMemory) SetCustomMemoryItems(items []MemoryItem) error {
	items = NormalizeMemoryItemsForWrite(items, "user_input", DefaultMaxUserCustomMemoryItems, time.Now().UnixMilli())
	data, err := json.Marshal(items)
	if err != nil {
		return err
	}
	m.CustomMemory = LongText(data)
	return nil
}

// ToResponse 转换为响应结构（不含动态字段）
func (m *UserMemory) ToResponse(nickname, department string) *UserMemoryResponse {
	smartMemory := string(m.SmartMemory)
	if items, err := m.GetSmartMemoryItems(); err == nil {
		items = NormalizeMemoryItemsForResponse(items, "user_input", DefaultMaxUserSmartMemoryItems)
		if data, err := json.Marshal(items); err == nil {
			smartMemory = string(data)
		}
	}
	customMemory := string(m.CustomMemory)
	if items, err := m.GetCustomMemoryItems(); err == nil {
		items = NormalizeMemoryItemsForResponse(items, "user_input", DefaultMaxUserCustomMemoryItems)
		if data, err := json.Marshal(items); err == nil {
			customMemory = string(data)
		}
	}
	return &UserMemoryResponse{
		ID:           m.ID,
		Eid:          m.Eid,
		UserID:       m.UserID,
		Nickname:     nickname,
		Department:   department,
		SmartMemory:  smartMemory,
		CustomMemory: customMemory,
		Position:     m.Position,
		Style:        m.Style,
		Version:      m.Version,
	}
}

// Create 创建用户全局记忆
func (m *UserMemory) Create() error {
	return DB.Create(m).Error
}

// Update 更新用户全局记忆（带版本号乐观锁）
func (m *UserMemory) Update() error {
	result := DB.Model(m).
		Where("id = ? AND version = ?", m.ID, m.Version).
		Updates(map[string]interface{}{
			"smart_memory":  m.SmartMemory,
			"custom_memory": m.CustomMemory,
			"position":      m.Position,
			"style":         m.Style,
			"version":       gorm.Expr("version + 1"),
			"updated_time":  m.UpdatedTime,
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	m.Version++
	return nil
}

// Upsert 不存在则创建，存在则更新用户可编辑字段
func (m *UserMemory) Upsert() error {
	var existing UserMemory
	err := DB.Where("eid = ? AND user_id = ?", m.Eid, m.UserID).First(&existing).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return m.Create()
		}
		return err
	}
	m.ID = existing.ID
	m.Version = existing.Version
	return m.Update()
}

// GetUserMemory 根据 eid 和 userID 获取用户全局记忆
func GetUserMemory(eid, userID int64) (*UserMemory, error) {
	var m UserMemory
	err := DB.Where("eid = ? AND user_id = ?", eid, userID).First(&m).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}
	return &m, nil
}

// MergeSmartMemory 增量追加智能记忆条目（去重，带乐观锁重试）
func MergeSmartMemory(eid, userID int64, newItems []MemoryItem) error {
	return retryOnOptimisticLockConflict(func() error {
		m, err := GetUserMemory(eid, userID)
		if err != nil {
			return err
		}
		if m == nil {
			m = &UserMemory{
				Eid:    eid,
				UserID: userID,
			}
			if err := m.SetSmartMemoryItems(mergeMemoryItems(nil, newItems)); err != nil {
				return err
			}
			return m.Create()
		}

		baselineVersion := m.Version
		existingItems, _ := m.GetSmartMemoryItems()
		if err := m.SetSmartMemoryItems(mergeMemoryItems(existingItems, newItems)); err != nil {
			return err
		}
		m.Version = baselineVersion
		return m.Update()
	})
}

// MergeCustomMemory 增量追加自定义记忆条目（去重，带乐观锁重试）
func MergeCustomMemory(eid, userID int64, newItems []MemoryItem) error {
	return retryOnOptimisticLockConflict(func() error {
		m, err := GetUserMemory(eid, userID)
		if err != nil {
			return err
		}
		if m == nil {
			m = &UserMemory{
				Eid:    eid,
				UserID: userID,
			}
			if err := m.SetCustomMemoryItems(mergeMemoryItems(nil, newItems)); err != nil {
				return err
			}
			return m.Create()
		}

		baselineVersion := m.Version
		existingItems, _ := m.GetCustomMemoryItems()
		if err := m.SetCustomMemoryItems(mergeMemoryItems(existingItems, newItems)); err != nil {
			return err
		}
		m.Version = baselineVersion
		return m.Update()
	})
}

// mergeMemoryItems 按 fact 去重合并，冲突时按来源优先级裁决。
// 委托给 model.MergeMemoryItems 统一实现。
func mergeMemoryItems(existing, incoming []MemoryItem) []MemoryItem {
	return MergeMemoryItems(existing, incoming)
}
