package model

import (
	"encoding/json"
	"strings"
	"time"

	"gorm.io/gorm"
)

var (
	ErrMemoryRecordNotFound  = errMemoryRecordNotFound{}
	ErrMemoryIndexOutOfRange = errMemoryIndexOutOfRange{}
	ErrMemoryItemShifted     = errMemoryItemShifted{}
)

type errMemoryRecordNotFound struct{}

func (errMemoryRecordNotFound) Error() string { return "记忆记录不存在" }

type errMemoryIndexOutOfRange struct{}

func (errMemoryIndexOutOfRange) Error() string { return "记忆索引超出范围" }

type errMemoryItemShifted struct{}

func (errMemoryItemShifted) Error() string { return "记忆条目在并发更新中发生位移" }

// AgentUserMemory Agent 对用户的记忆（MEMORY.md）
// 只存 items JSON，memory_content 为读取时实时生成的 Markdown，不存库。
type AgentUserMemory struct {
	ID      int64 `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid     int64 `json:"eid" gorm:"not null;uniqueIndex:uk_agent_user_memories,priority:1"`
	AgentID int64 `json:"agent_id" gorm:"not null;uniqueIndex:uk_agent_user_memories,priority:2"`
	UserID  int64 `json:"user_id" gorm:"not null;uniqueIndex:uk_agent_user_memories,priority:3"`

	Items   LongText `json:"items"`
	Version int    `json:"version" gorm:"default:0"`

	// MemoryContent 读取时实时生成的 Markdown，不存库，不返回前端
	MemoryContent string `json:"-" gorm:"-"`

	BaseModel
}

func (m *AgentUserMemory) GetEid() int64     { return m.Eid }
func (m *AgentUserMemory) GetAgentID() int64 { return m.AgentID }
func (m *AgentUserMemory) GetUserID() int64  { return m.UserID }
func (m *AgentUserMemory) GetID() int64      { return m.ID }
func (m *AgentUserMemory) GetVersion() int   { return m.Version }
func (m *AgentUserMemory) SetID(id int64)    { m.ID = id }
func (m *AgentUserMemory) SetVersion(v int)  { m.Version = v }

func (AgentUserMemory) TableName() string {
	return "agent_user_memories"
}

func (m *AgentUserMemory) GetItems() ([]MemoryItem, error) {
	if m.Items == "" || m.Items == "[]" {
		return []MemoryItem{}, nil
	}
	var items []MemoryItem
	if err := json.Unmarshal([]byte(m.Items), &items); err != nil {
		return nil, err
	}
	return FilterActiveMemoryItems(items, time.Now().UnixMilli()), nil
}

func (m *AgentUserMemory) SetItems(items []MemoryItem) error {
	items = NormalizeMemoryItemsForWrite(items, "system", DefaultMaxAgentMemoryItems, time.Now().UnixMilli())
	data, err := json.Marshal(items)
	if err != nil {
		return err
	}
	m.Items = LongText(data)
	return nil
}

func (m *AgentUserMemory) AppendItem(item MemoryItem) error {
	item = NormalizeMemoryItem(item, "system")
	items, err := m.GetItems()
	if err != nil {
		return err
	}
	items = MergeMemoryItems(items, []MemoryItem{item})
	return m.SetItems(items)
}

func (m *AgentUserMemory) WithMemoryContent() *AgentUserMemory {
	if m == nil {
		return nil
	}
	items, _ := m.GetItems()
	items = NormalizeMemoryItemsForResponse(items, "system", DefaultMaxAgentMemoryItems)
	data, err := json.Marshal(items)
	if err == nil {
		m.Items = LongText(data)
	}
	m.MemoryContent = m.FormatAsMarkdown()
	return m
}

func (m *AgentUserMemory) FormatAsMarkdown() string {
	items, err := m.GetItems()
	if err != nil || len(items) == 0 {
		return ""
	}
	items = NormalizeMemoryItemsForResponse(items, "system", DefaultMaxAgentMemoryItems)
	if len(items) == 0 {
		return ""
	}

	grouped := make(map[string][]string)
	displayCategories := []string{CategoryPreference, CategoryFact}
	for _, item := range items {
		if item.Fact == "" {
			continue
		}
		cat := NormalizeMemoryCategory(item.Category)
		grouped[cat] = append(grouped[cat], item.Fact)
	}

	hasContent := false
	for _, cat := range displayCategories {
		if len(grouped[cat]) > 0 {
			hasContent = true
			break
		}
	}
	if !hasContent {
		return ""
	}

	var b strings.Builder
	for _, cat := range displayCategories {
		lines := grouped[cat]
		if len(lines) == 0 {
			continue
		}
		b.WriteString("## " + CategoryLabel(cat) + "\n")
		for _, line := range lines {
			b.WriteString("- " + line + "\n")
		}
		b.WriteString("\n")
	}
	return b.String()
}

func (m *AgentUserMemory) Create() error {
	return DB.Create(m).Error
}

func (m *AgentUserMemory) Update() error {
	result := DB.Model(m).
		Where("id = ? AND version = ?", m.ID, m.Version).
		Updates(map[string]interface{}{
			"items":        m.Items,
			"version":      gorm.Expr("version + 1"),
			"updated_time": m.UpdatedTime,
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

func (m *AgentUserMemory) Upsert() error {
	return UpsertRecord(m)
}

func GetAgentUserMemory(eid, agentID, userID int64) (*AgentUserMemory, error) {
	return GetByEidAgentUser[AgentUserMemory](eid, agentID, userID)
}

func AppendAgentMemoryItem(eid, agentID, userID int64, item MemoryItem) error {
	return retryOnOptimisticLockConflict(func() error {
		m, err := GetAgentUserMemory(eid, agentID, userID)
		if err != nil {
			return err
		}
		if m == nil {
			m = &AgentUserMemory{
				Eid:     eid,
				AgentID: agentID,
				UserID:  userID,
			}
			if err := m.AppendItem(item); err != nil {
				return err
			}
			return m.Create()
		}

		baselineVersion := m.Version
		if err := m.AppendItem(item); err != nil {
			return err
		}
		m.Version = baselineVersion
		return m.Update()
	})
}

func IncrementAgentMemoryAccessCount(eid, agentID, userID int64, indices []int) error {
	if len(indices) == 0 {
		return nil
	}
	return retryOnOptimisticLockConflict(func() error {
		m, err := GetAgentUserMemory(eid, agentID, userID)
		if err != nil {
			return err
		}
		if m == nil {
			return nil
		}
		baselineVersion := m.Version
		items, err := m.GetItems()
		if err != nil {
			return err
		}
		if len(items) == 0 {
			return nil
		}
		now := time.Now().UnixMilli()
		seen := make(map[int]bool, len(indices))
		changed := false
		for _, idx := range indices {
			if idx < 0 || idx >= len(items) || seen[idx] {
				continue
			}
			seen[idx] = true
			items[idx].AccessCount++
			items[idx].LastAccessAt = now
			changed = true
		}
		if !changed {
			return nil
		}
		if err := m.SetItems(items); err != nil {
			return err
		}
		m.Version = baselineVersion
		return m.Update()
	})
}

func DeleteAgentMemoryItemByIndex(eid, agentID, userID int64, index int) error {
	if index < 0 {
		return ErrMemoryIndexOutOfRange
	}

	first, err := GetAgentUserMemory(eid, agentID, userID)
	if err != nil {
		return err
	}
	if first == nil {
		return ErrMemoryRecordNotFound
	}
	firstItems, err := first.GetItems()
	if err != nil {
		return err
	}
	if index >= len(firstItems) {
		return ErrMemoryIndexOutOfRange
	}
	targetFact := firstItems[index].Fact

	return retryOnOptimisticLockConflict(func() error {
		m, err := GetAgentUserMemory(eid, agentID, userID)
		if err != nil {
			return err
		}
		if m == nil {
			return ErrMemoryRecordNotFound
		}
		baselineVersion := m.Version
		items, err := m.GetItems()
		if err != nil {
			return err
		}
		if index >= len(items) || items[index].Fact != targetFact {
			return ErrMemoryItemShifted
		}
		items = append(items[:index], items[index+1:]...)
		if err := m.SetItems(items); err != nil {
			return err
		}
		m.Version = baselineVersion
		return m.Update()
	})
}
