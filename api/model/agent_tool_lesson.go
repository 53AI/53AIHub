package model

import (
	"encoding/json"
	"sort"
	"strings"

	"gorm.io/gorm"
)

// AgentToolLesson 智能体工具使用教训（TOOLS.md）
// 存储 Agent 在工具调用过程中积累的经验教训
type AgentToolLesson struct {
	ID      int64 `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid     int64 `json:"eid" gorm:"not null;uniqueIndex:uk_agent_tool_lessons,priority:1"`
	AgentID int64 `json:"agent_id" gorm:"not null;uniqueIndex:uk_agent_tool_lessons,priority:2"`
	UserID  int64 `json:"user_id" gorm:"not null;uniqueIndex:uk_agent_tool_lessons,priority:3"`

	// Lessons JSON数组: [{tool_name, lesson, success, time}]
	Lessons LongText `json:"lessons"`

	// Version 乐观锁版本号
	Version int `json:"version" gorm:"default:0"`

	BaseModel
}

// Record 接口实现
func (a *AgentToolLesson) GetEid() int64     { return a.Eid }
func (a *AgentToolLesson) GetAgentID() int64 { return a.AgentID }
func (a *AgentToolLesson) GetUserID() int64  { return a.UserID }
func (a *AgentToolLesson) GetID() int64      { return a.ID }
func (a *AgentToolLesson) GetVersion() int   { return a.Version }
func (a *AgentToolLesson) SetID(id int64)    { a.ID = id }
func (a *AgentToolLesson) SetVersion(v int)  { a.Version = v }

func (AgentToolLesson) TableName() string {
	return "agent_tool_lessons"
}

// ToolLessonItem 单条工具教训条目
type ToolLessonItem struct {
	ToolName string `json:"tool_name"`
	Lesson   string `json:"lesson"`
	Category string `json:"category"`
	Success  bool   `json:"success"` // true=成功经验, false=失败教训
	Time     int64  `json:"time"`
}

// GetLessons 解析教训列表
func (a *AgentToolLesson) GetLessons() ([]ToolLessonItem, error) {
	if a.Lessons == "" || a.Lessons == "[]" {
		return []ToolLessonItem{}, nil
	}
	var items []ToolLessonItem
	if err := json.Unmarshal([]byte(a.Lessons), &items); err != nil {
		return nil, err
	}
	return items, nil
}

// SetLessons 序列化教训列表
func (a *AgentToolLesson) SetLessons(items []ToolLessonItem) error {
	if items == nil {
		items = []ToolLessonItem{}
	}
	cleaned := make([]ToolLessonItem, 0, len(items))
	for _, item := range items {
		item.ToolName = strings.TrimSpace(item.ToolName)
		item.Lesson = strings.TrimSpace(item.Lesson)
		item.Category = strings.TrimSpace(item.Category)
		if item.Lesson == "" {
			continue
		}
		cleaned = append(cleaned, item)
	}
	items = cleaned
	if len(items) > DefaultMaxToolLessonItems {
		items = items[len(items)-DefaultMaxToolLessonItems:]
	}
	data, err := json.Marshal(items)
	if err != nil {
		return err
	}
	a.Lessons = LongText(data)
	return nil
}

// FormatAsMarkdown 格式化为 TOOLS.md Markdown 文本
func (a *AgentToolLesson) FormatAsMarkdown() string {
	items, _ := a.GetLessons()

	md := "# TOOLS.md — 智能体工具教训\n\n"
	md += "记录各种工具的使用技巧和注意事项\n\n"

	grouped := make(map[string][]ToolLessonItem)
	var categories []string
	for _, item := range items {
		cat := item.Category
		if cat == "" {
			cat = "_未分类"
		}
		if _, ok := grouped[cat]; !ok {
			categories = append(categories, cat)
		}
		grouped[cat] = append(grouped[cat], item)
	}
	sort.Strings(categories)

	if len(categories) == 0 {
		md += "_暂无记录_\n"
	} else {
		for _, cat := range categories {
			md += "- **" + cat + "：**\n"
			for _, item := range grouped[cat] {
				if item.ToolName != "" {
					md += "  - **" + item.ToolName + "**：" + item.Lesson + "\n"
				} else {
					md += "  - " + item.Lesson + "\n"
				}
			}
			md += "\n"
		}
	}

	return md
}

// Create 创建工具教训
func (a *AgentToolLesson) Create() error {
	return DB.Create(a).Error
}

// Update 更新工具教训（带版本号乐观锁）
func (a *AgentToolLesson) Update() error {
	result := DB.Model(a).
		Where("id = ? AND version = ?", a.ID, a.Version).
		Updates(map[string]interface{}{
			"lessons":      a.Lessons,
			"version":      gorm.Expr("version + 1"),
			"updated_time": a.UpdatedTime,
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	a.Version++
	return nil
}

// Upsert 不存在则创建，存在则更新
func (a *AgentToolLesson) Upsert() error {
	return UpsertRecord(a)
}

// GetAgentToolLessons 查询 Agent 工具教训
func GetAgentToolLessons(eid, agentID, userID int64) (*AgentToolLesson, error) {
	return GetByEidAgentUser[AgentToolLesson](eid, agentID, userID)
}

// AppendToolLesson 追加一条工具教训（去重，带乐观锁重试）
//
// 与 AppendAgentMemoryItem 同款语义：用 baseline version 走 Update，冲突时重读重试。
func AppendToolLesson(eid, agentID, userID int64, item ToolLessonItem) error {
	return retryOnOptimisticLockConflict(func() error {
		a, err := GetAgentToolLessons(eid, agentID, userID)
		if err != nil {
			return err
		}
		if a == nil {
			a = &AgentToolLesson{
				Eid:     eid,
				AgentID: agentID,
				UserID:  userID,
			}
			items := []ToolLessonItem{item}
			if err := a.SetLessons(items); err != nil {
				return err
			}
			return a.Create()
		}

		items, _ := a.GetLessons()

		// 按 tool_name + lesson 去重
		existing := make(map[string]bool, len(items))
		for _, it := range items {
			key := it.ToolName + "||" + it.Lesson
			existing[key] = true
		}
		key := item.ToolName + "||" + item.Lesson
		if !existing[key] {
			items = append(items, item)
		}

		baselineVersion := a.Version
		if err := a.SetLessons(items); err != nil {
			return err
		}
		// 强制使用基线 version 调 Update，让 RowsAffected==0 触发重试
		a.Version = baselineVersion
		return a.Update()
	})
}

// FormatDefaultToolLessonsMD 生成默认的 TOOLS.md
func FormatDefaultToolLessonsMD() string {
	return `# TOOLS.md — 智能体工具教训

_暂无记录_
`
}

// DeleteToolLessonByIndex 按索引删除一条工具教训（带乐观锁重试）。
// 如果记录不存在返回 ErrToolLessonRecordNotFound；索引越界返回 ErrToolLessonIndexOutOfRange。
func DeleteToolLessonByIndex(eid, agentID, userID int64, index int) error {
	if index < 0 {
		return ErrToolLessonIndexOutOfRange
	}
	return retryOnOptimisticLockConflict(func() error {
		a, err := GetAgentToolLessons(eid, agentID, userID)
		if err != nil {
			return err
		}
		if a == nil {
			return ErrToolLessonRecordNotFound
		}

		items, err := a.GetLessons()
		if err != nil {
			return err
		}
		if index >= len(items) {
			return ErrToolLessonIndexOutOfRange
		}

		baselineVersion := a.Version
		items = append(items[:index], items[index+1:]...)
		if err := a.SetLessons(items); err != nil {
			return err
		}
		a.Version = baselineVersion
		return a.Update()
	})
}

// AppendToolLessons 批量追加多条工具教训（去重，带乐观锁重试）
func AppendToolLessons(eid, agentID, userID int64, items []ToolLessonItem) error {
	if len(items) == 0 {
		return nil
	}
	return retryOnOptimisticLockConflict(func() error {
		a, err := GetAgentToolLessons(eid, agentID, userID)
		if err != nil {
			return err
		}
		if a == nil {
			a = &AgentToolLesson{
				Eid:     eid,
				AgentID: agentID,
				UserID:  userID,
			}
			if err := a.SetLessons(items); err != nil {
				return err
			}
			return a.Create()
		}

		existing, _ := a.GetLessons()
		existingSet := make(map[string]bool, len(existing))
		for _, it := range existing {
			key := it.ToolName + "||" + it.Lesson
			existingSet[key] = true
		}
		for _, item := range items {
			key := item.ToolName + "||" + item.Lesson
			if !existingSet[key] {
				existing = append(existing, item)
				existingSet[key] = true
			}
		}

		baselineVersion := a.Version
		if err := a.SetLessons(existing); err != nil {
			return err
		}
		a.Version = baselineVersion
		return a.Update()
	})
}

// 工具教训删除场景的可识别错误，便于 controller 层映射到 404
var (
	ErrToolLessonRecordNotFound  = errToolLessonRecordNotFound{}
	ErrToolLessonIndexOutOfRange = errToolLessonIndexOutOfRange{}
)

type errToolLessonRecordNotFound struct{}

func (errToolLessonRecordNotFound) Error() string { return "工具教训记录不存在" }

type errToolLessonIndexOutOfRange struct{}

func (errToolLessonIndexOutOfRange) Error() string { return "工具教训索引超出范围" }
