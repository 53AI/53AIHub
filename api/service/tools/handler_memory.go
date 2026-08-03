package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
)

func parseArgs(args map[string]interface{}, target interface{}) error {
	data, err := json.Marshal(args)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, target)
}

func executeMemorySearch(ctx context.Context, args map[string]interface{}) (*ToolResult, error) {
	var parsed struct {
		Query      string `json:"query"`
		MemoryType string `json:"memory_type"`
		MaxResults int    `json:"max_results"`
	}
	if err := parseArgs(args, &parsed); err != nil {
		return nil, fmt.Errorf("参数解析失败: %w", err)
	}
	parsed.Query = strings.TrimSpace(parsed.Query)
	if parsed.Query == "" {
		return nil, fmt.Errorf("query 不能为空")
	}
	if parsed.MaxResults <= 0 || parsed.MaxResults > 10 {
		parsed.MaxResults = 5
	}
	if parsed.MemoryType == "" {
		parsed.MemoryType = "all"
	}

	eid, _ := ctx.Value(ToolEIDKey).(int64)
	userID, _ := ctx.Value(ToolUserIDKey).(int64)
	agentID, _ := ctx.Value(ToolAgentIDKey).(int64)

	var items []model.MemoryItem
	memSvc := service.NewAgentMemoryService()

	searchUser := func() []model.MemoryItem {
		if eid == 0 || userID == 0 {
			return nil
		}
		memory, err := model.GetUserMemory(eid, userID)
		if err != nil || memory == nil {
			return nil
		}
		smart, _ := memory.GetSmartMemoryItems()
		custom, _ := memory.GetCustomMemoryItems()
		return memSvc.FilterRelevantItems(append(smart, custom...), parsed.Query)
	}

	searchAgent := func() []model.MemoryItem {
		if eid == 0 || agentID == 0 || userID == 0 {
			return nil
		}
		memory, err := model.GetAgentUserMemory(eid, agentID, userID)
		if err != nil || memory == nil {
			return nil
		}
		all, _ := memory.GetItems()
		return memSvc.FilterRelevantItems(all, parsed.Query)
	}

	searchLessons := func() []model.MemoryItem {
		if eid == 0 || agentID == 0 || userID == 0 {
			return nil
		}
		lessons, err := model.GetAgentToolLessons(eid, agentID, userID)
		if err != nil || lessons == nil {
			return nil
		}
		lessonItems, _ := lessons.GetLessons()
		out := make([]model.MemoryItem, 0, len(lessonItems))
		for _, li := range lessonItems {
			out = append(out, model.MemoryItem{
				Fact:       li.Lesson,
				MemoryType: model.MemoryTypeFailure,
				Source:     "inference",
				Category:   model.CategoryFact,
			})
		}
		return memSvc.FilterRelevantItems(out, parsed.Query)
	}

	switch parsed.MemoryType {
	case "user":
		items = searchUser()
	case "agent":
		items = searchAgent()
	case "tool_lesson":
		items = searchLessons()
	case "all":
		items = append(items, searchUser()...)
		items = append(items, searchAgent()...)
		items = append(items, searchLessons()...)
	}

	if len(items) == 0 {
		return &ToolResult{Output: "未找到匹配的记忆条目（只读数据）", ExitCode: 0}, nil
	}

	seen := make(map[string]bool, len(items))
	deduped := make([]model.MemoryItem, 0, len(items))
	for _, item := range items {
		key := strings.ToLower(strings.TrimSpace(item.Fact))
		if key == "" || seen[key] {
			continue
		}
		seen[key] = true
		deduped = append(deduped, item)
	}
	if len(deduped) > parsed.MaxResults {
		deduped = deduped[:parsed.MaxResults]
	}

	var lines []string
	for _, item := range deduped {
		line := fmt.Sprintf("- %s", item.Fact)
		if item.Category != "" {
			line += fmt.Sprintf(" [%s", item.Category)
			if item.MemoryType != "" {
				line += fmt.Sprintf("/%s]", item.MemoryType)
			} else {
				line += "]"
			}
		}
		if item.Tags != "" {
			line += fmt.Sprintf(" 标签: %s", item.Tags)
		}
		lines = append(lines, line)
	}

	output := fmt.Sprintf("找到 %d 条相关记忆（只读数据，不可修改）:\n%s", len(deduped), strings.Join(lines, "\n"))

	logger.Infof(ctx, "【memory_search】query_chars=%d type=%s 命中=%d条", len(parsed.Query), parsed.MemoryType, len(deduped))
	return &ToolResult{Output: output, ExitCode: 0}, nil
}

func executeSaveMemory(ctx context.Context, args map[string]interface{}) (*ToolResult, error) {
	var parsed struct {
		Content string `json:"content"`
		Type    string `json:"type"`
		Scope   string `json:"scope"`
		Topic   string `json:"topic"`
	}
	if err := parseArgs(args, &parsed); err != nil {
		return nil, fmt.Errorf("参数解析失败: %w", err)
	}
	parsed.Content = strings.TrimSpace(parsed.Content)
	if parsed.Content == "" {
		return nil, fmt.Errorf("content 不能为空")
	}

	switch parsed.Type {
	case "preference", "fact", "tool_lesson":
	default:
		return nil, fmt.Errorf("不支持的记忆类型: %s (支持: preference, fact, tool_lesson)", parsed.Type)
	}

	if parsed.Scope == "" {
		parsed.Scope = "agent"
	}

	eid, _ := ctx.Value(ToolEIDKey).(int64)
	userID, _ := ctx.Value(ToolUserIDKey).(int64)
	agentID, _ := ctx.Value(ToolAgentIDKey).(int64)

	now := time.Now().UnixMilli()
	typeLabel := map[string]string{
		"preference":  "偏好",
		"fact":        "事实",
		"tool_lesson": "工具教训",
	}

	switch {
	case parsed.Scope == "user":
		if eid == 0 || userID == 0 {
			return nil, fmt.Errorf("缺少用户上下文")
		}
		item := model.MemoryItem{
			Fact:       parsed.Content,
			Source:     "user_input",
			Time:       now,
			Category:   model.NormalizeMemoryCategory(parsed.Type),
			MemoryType: parsed.Type,
		}
		if err := model.MergeCustomMemory(eid, userID, []model.MemoryItem{item}); err != nil {
			return nil, fmt.Errorf("保存用户记忆失败: %w", err)
		}

	case parsed.Type == "tool_lesson":
		if eid == 0 || agentID == 0 || userID == 0 {
			return nil, fmt.Errorf("缺少助手/用户上下文")
		}
		topic := strings.TrimSpace(parsed.Topic)
		if topic == "" {
			topic = "通用"
		}
		lesson := model.ToolLessonItem{
			ToolName: topic,
			Lesson:   parsed.Content,
			Success:  true,
			Time:     time.Now().Unix(),
		}
		if err := model.AppendToolLessons(eid, agentID, userID, []model.ToolLessonItem{lesson}); err != nil {
			return nil, fmt.Errorf("保存工具教训失败: %w", err)
		}

	default:
		if eid == 0 || agentID == 0 || userID == 0 {
			return nil, fmt.Errorf("缺少助手/用户上下文")
		}
		item := model.MemoryItem{
			Fact:       parsed.Content,
			Source:     "user_input",
			Time:       now,
			Category:   parsed.Type,
			MemoryType: parsed.Type,
		}
		if err := model.AppendAgentMemoryItem(eid, agentID, userID, item); err != nil {
			return nil, fmt.Errorf("保存记忆失败: %w", err)
		}
	}

	logger.Infof(ctx, "【save_memory】type=%s scope=%s content_chars=%d", parsed.Type, parsed.Scope, len(parsed.Content))
	output := fmt.Sprintf("已保存【%s】: %s", typeLabel[parsed.Type], parsed.Content)
	return &ToolResult{Output: output, ExitCode: 0}, nil
}
