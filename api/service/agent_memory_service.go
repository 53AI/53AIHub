package service

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"
	"unicode"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
)

// AgentMemoryService Agent 记忆业务服务
type AgentMemoryService struct{}

// NewAgentMemoryService 创建 Agent 记忆服务
func NewAgentMemoryService() *AgentMemoryService {
	return &AgentMemoryService{}
}

// GetAgentMemory 获取 Agent 对用户的记忆
func (s *AgentMemoryService) GetAgentMemory(eid, agentID, userID int64) (*model.AgentUserMemory, error) {
	return model.GetAgentUserMemory(eid, agentID, userID)
}

// UpdateAgentMemory 更新 Agent 对用户的记忆
// 从 ParseAndNormalizeItemsJSON 进入统一治理管线：解析 → 脱敏 → 归一 → 合并
func (s *AgentMemoryService) UpdateAgentMemory(eid, agentID, userID int64, items string) error {
	normalized, err := model.ParseAndNormalizeItemsJSON(items, "user_edit")
	if err != nil {
		return err
	}

	memory, err := model.GetAgentUserMemory(eid, agentID, userID)
	if err != nil {
		return err
	}

	if memory == nil {
		memory = &model.AgentUserMemory{
			Eid:     eid,
			AgentID: agentID,
			UserID:  userID,
		}
	}

	existingItems, _ := memory.GetItems()
	merged := model.MergeMemoryItemsForReplacement(existingItems, normalized)
	if err := memory.SetItems(merged); err != nil {
		return err
	}
	return memory.Upsert()
}

// GetAgentToolLessons 获取 Agent 工具教训
func (s *AgentMemoryService) GetAgentToolLessons(eid, agentID, userID int64) (*model.AgentToolLesson, error) {
	return model.GetAgentToolLessons(eid, agentID, userID)
}

// UpdateAgentToolLessons 更新 Agent 工具教训
func (s *AgentMemoryService) UpdateAgentToolLessons(eid, agentID, userID int64, lessons string) error {
	var lessonItems []model.ToolLessonItem
	if lessons != "" && lessons != "[]" {
		if err := json.Unmarshal([]byte(lessons), &lessonItems); err != nil {
			return err
		}
	}

	toolLessons, err := model.GetAgentToolLessons(eid, agentID, userID)
	if err != nil {
		return err
	}

	if toolLessons == nil {
		toolLessons = &model.AgentToolLesson{
			Eid:     eid,
			AgentID: agentID,
			UserID:  userID,
		}
	}

	if err := toolLessons.SetLessons(lessonItems); err != nil {
		return err
	}
	return toolLessons.Upsert()
}

// AppendToolLesson 追加一条工具教训
func (s *AgentMemoryService) AppendToolLesson(eid, agentID, userID int64, item model.ToolLessonItem) error {
	return model.AppendToolLesson(eid, agentID, userID, item)
}

// FormatUserMemoryForPrompt 格式化用户全局记忆为 Prompt 片段（包含动态系统信息）
func (s *AgentMemoryService) FormatUserMemoryForPrompt(ctx context.Context, eid, userID int64) string {
	userMemSvc := NewUserMemoryService()
	return userMemSvc.FormatUserMemoryForPrompt(ctx, eid, userID)
}

// FormatAgentMemoryForPrompt 格式化 Agent 记忆为 Prompt 片段（支持按 Query 筛选）
// query 为空时返回全部（兼容旧调用方）
func (s *AgentMemoryService) FormatAgentMemoryForPrompt(eid, agentID, userID int64, query string) string {
	memory, err := model.GetAgentUserMemory(eid, agentID, userID)
	if err != nil || memory == nil {
		return ""
	}

	items, err := memory.GetItems()
	if err != nil {
		return ""
	}

	items, matchedIndices := s.FilterRelevantItemsWithIndices(items, query)
	if len(matchedIndices) > 0 {
		go func(indices []int) {
			if err := model.IncrementAgentMemoryAccessCount(eid, agentID, userID, indices); err != nil {
				logger.Warnf(context.Background(), "【记忆召回】更新访问计数失败: eid=%d, agent_id=%d, user_id=%d, err=%v", eid, agentID, userID, err)
			}
		}(append([]int(nil), matchedIndices...))
	}

	if len(items) == 0 {
		return ""
	}

	// 按 category 分组格式化
	md := "# AGENT MEMORY.md — 你对该用户的认知\n\n"
	displayCategories := []string{model.CategoryPreference, model.CategoryFact}
	grouped := make(map[string][]model.MemoryItem)
	for _, item := range items {
		for _, displayCat := range displayCategories {
			if item.Category == displayCat {
				grouped[item.Category] = append(grouped[item.Category], item)
				break
			}
		}
	}

	for _, cat := range displayCategories {
		itemsInCat := grouped[cat]
		if len(itemsInCat) == 0 {
			continue
		}
		md += fmt.Sprintf("## %s\n", model.CategoryLabel(cat))
		for _, item := range itemsInCat {
			md += "- " + item.Fact + "\n"
		}
		md += "\n"
	}

	return md
}

// FormatToolLessonsForPrompt 格式化工具教训为 Prompt 片段（支持按工具名筛选）
// toolNames 为空时返回全部（兼容旧调用方）
func (s *AgentMemoryService) FormatToolLessonsForPrompt(eid, agentID, userID int64, toolNames []string) string {
	lessons, err := model.GetAgentToolLessons(eid, agentID, userID)
	if err != nil || lessons == nil {
		return ""
	}

	items, err := lessons.GetLessons()
	if err != nil {
		return ""
	}

	// 有工具名时筛选，否则全量返回
	// tool_name 为空的是通用教训，始终包含
	if len(toolNames) > 0 {
		toolSet := make(map[string]bool, len(toolNames))
		for _, name := range toolNames {
			toolSet[name] = true
		}
		filtered := make([]model.ToolLessonItem, 0, len(items))
		for _, item := range items {
			if item.ToolName == "" || toolSet[item.ToolName] {
				filtered = append(filtered, item)
			}
		}
		items = filtered
	}

	if len(items) == 0 {
		return ""
	}

	md := "# TOOLS.md — 智能体工具教训\n\n"
	sort.Slice(items, func(i, j int) bool {
		if items[i].ToolName != items[j].ToolName {
			return items[i].ToolName < items[j].ToolName
		}
		return items[i].Time > items[j].Time
	})

	var currentTool string
	for _, item := range items {
		name := item.ToolName
		if name == "" {
			name = "通用"
		}
		if name != currentTool {
			md += fmt.Sprintf("## %s\n", name)
			currentTool = name
		}
		prefix := "✅"
		if !item.Success {
			prefix = "❌"
		}
		md += fmt.Sprintf("- %s %s\n", prefix, item.Lesson)
	}

	return md
}

// BuildMemoryEnrichedPrompt 构建包含记忆增强的 System Prompt
// query 为当前用户输入，用于筛选相关的 Agent 记忆
// toolNames 为当前请求的工具列表，用于筛选相关的工具教训
func (s *AgentMemoryService) BuildMemoryEnrichedPrompt(ctx context.Context, eid, agentID, userID int64, basePrompt string, query string, toolNames []string) string {
	userMemoryMD := s.FormatUserMemoryForPrompt(ctx, eid, userID)
	agentMemoryMD := s.FormatAgentMemoryForPrompt(eid, agentID, userID, query)
	toolLessonsMD := s.FormatToolLessonsForPrompt(eid, agentID, userID, toolNames)

	// 如果没有任何记忆内容，直接返回基础 prompt
	if userMemoryMD == "" && agentMemoryMD == "" && toolLessonsMD == "" {
		return basePrompt
	}

	enriched := basePrompt

	enriched += "\n\n---\n以下是用户信息和你的交互记忆。你在回答时必须参考这些信息来更好地理解和帮助用户：\n\n"

	if userMemoryMD != "" {
		enriched += userMemoryMD + "\n\n"
	}

	if agentMemoryMD != "" {
		enriched += agentMemoryMD + "\n\n"
	}

	if toolLessonsMD != "" {
		enriched += toolLessonsMD + "\n"
	}

	logger.Infof(ctx, "【记忆注入】已构建增强Prompt: eid=%d, agent_id=%d, user_id=%d, "+
		"basePrompt长度=%d, 用户记忆长度=%d, Agent记忆长度=%d, 工具教训长度=%d, 增强后总长度=%d",
		eid, agentID, userID,
		len(basePrompt), len(userMemoryMD), len(agentMemoryMD), len(toolLessonsMD), len(enriched))

	return enriched
}

// FilterRelevantItems 根据用户 Query 关键词筛选相关的记忆条目
// 匹配逻辑：提取 Query 中的关键词，匹配 MemoryItem.Tags
// 零 LLM 成本，纯字符串匹配
func (s *AgentMemoryService) FilterRelevantItems(items []model.MemoryItem, query string) []model.MemoryItem {
	filtered, _ := s.FilterRelevantItemsWithIndices(items, query)
	return filtered
}

func (s *AgentMemoryService) FilterRelevantItemsWithIndices(items []model.MemoryItem, query string) ([]model.MemoryItem, []int) {
	if items == nil {
		return nil, nil
	}
	activeItems := make([]model.MemoryItem, 0, len(items))
	activeIndices := make([]int, 0, len(items))
	now := time.Now().UnixMilli()
	for i, item := range items {
		if item.ExpireAt > 0 && item.ExpireAt <= now {
			continue
		}
		activeItems = append(activeItems, item)
		activeIndices = append(activeIndices, i)
	}
	if len(activeItems) == 0 {
		return activeItems, []int{}
	}
	if query == "" {
		return trimMemoryItemsWithOriginalIndices(activeItems, activeIndices, model.DefaultMaxPromptMemoryItems, now)
	}

	keywords := extractKeywords(query)
	if len(keywords) == 0 {
		return trimMemoryItemsWithOriginalIndices(activeItems, activeIndices, model.DefaultMaxPromptMemoryItems, now)
	}

	matched := make([]model.MemoryItem, 0, len(activeItems))
	matchedIndices := make([]int, 0, len(activeItems))
	seen := make(map[string]bool)

	for i, item := range activeItems {
		if item.Tags == "" && item.Keywords == "" && item.Topic == "" {
			if !seen[item.Fact] {
				matched = append(matched, item)
				matchedIndices = append(matchedIndices, activeIndices[i])
				seen[item.Fact] = true
			}
			continue
		}
		itemIndexes := splitMemoryIndexText(item.Tags, item.Keywords, item.Topic)
		for _, kw := range keywords {
			for _, indexText := range itemIndexes {
				if indexText == "" {
					continue
				}
				if strings.Contains(strings.ToLower(indexText), strings.ToLower(kw)) ||
					strings.Contains(strings.ToLower(kw), strings.ToLower(indexText)) {
					if !seen[item.Fact] {
						matched = append(matched, item)
						matchedIndices = append(matchedIndices, activeIndices[i])
						seen[item.Fact] = true
					}
					break
				}
			}
		}
	}

	if len(matched) == 0 {
		return trimMemoryItemsWithOriginalIndices(activeItems, activeIndices, model.DefaultMaxPromptMemoryItems, now)
	}

	return trimMemoryItemsWithOriginalIndices(matched, matchedIndices, model.DefaultMaxPromptMemoryItems, now)
}

func trimMemoryItemsWithOriginalIndices(items []model.MemoryItem, originalIndices []int, maxItems int, now int64) ([]model.MemoryItem, []int) {
	trimmed, localIndices := model.TrimMemoryItemsWithIndices(items, maxItems, now)
	indices := make([]int, 0, len(localIndices))
	for _, idx := range localIndices {
		if idx >= 0 && idx < len(originalIndices) {
			indices = append(indices, originalIndices[idx])
		}
	}
	return trimmed, indices
}

func splitMemoryIndexText(values ...string) []string {
	indexes := make([]string, 0)
	for _, value := range values {
		for _, part := range strings.Split(value, ",") {
			part = strings.TrimSpace(part)
			if part != "" {
				indexes = append(indexes, part)
			}
		}
	}
	return indexes
}

// extractKeywords 从用户 Query 中提取关键词
func extractKeywords(query string) []string {
	stopWords := map[string]bool{
		"的": true, "了": true, "是": true, "在": true, "我": true,
		"你": true, "他": true, "她": true, "它": true, "们": true,
		"这": true, "那": true, "和": true, "与": true, "就": true,
		"也": true, "都": true, "要": true, "会": true, "可以": true,
		"吗": true, "呢": true, "吧": true, "啊": true, "哦": true,
		"嗯": true, "有": true, "没": true, "不": true, "很": true,
		"什么": true, "怎么": true, "为什么": true, "如何": true,
		"一个": true, "这个": true, "那个": true, "哪个": true,
		"请": true, "帮": true, "让": true, "把": true, "被": true,
		"a": true, "an": true, "the": true, "is": true, "are": true,
		"was": true, "were": true, "be": true, "been": true, "being": true,
		"have": true, "has": true, "had": true, "do": true, "does": true,
		"did": true, "will": true, "would": true, "could": true, "should": true,
		"may": true, "might": true, "can": true, "shall": true,
		"to": true, "of": true, "in": true, "for": true, "on": true,
		"with": true, "at": true, "by": true, "from": true, "as": true,
		"into": true, "through": true, "during": true, "before": true,
		"after": true, "above": true, "below": true, "between": true,
		"and": true, "or": true, "but": true, "not": true, "so": true,
		"if": true, "then": true, "than": true, "that": true, "this": true,
		"these": true, "those": true, "it": true, "its": true,
	}

	// 先按空格/标点分成大块
	parts := strings.FieldsFunc(query, func(r rune) bool {
		return r == ' ' || r == ',' || r == '，' || r == '。' ||
			r == '？' || r == '！' || r == '、' || r == '；' ||
			r == '：' || r == '"' || r == '\'' ||
			r == '（' || r == '）' || r == '(' || r == ')' ||
			r == '[' || r == ']' || r == '{' || r == '}' ||
			r == '\n' || r == '\t'
	})

	keywordSet := make(map[string]bool)
	var keywords []string

	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}

		// 将中英文混合的字符串按字符类型拆分为连续的同语言片段
		segments := splitByLanguage(part)
		for _, seg := range segments {
			seg = strings.TrimSpace(seg)
			if seg == "" {
				continue
			}
			lower := strings.ToLower(seg)
			if stopWords[lower] {
				continue
			}
			if isChinese(seg) {
				if len([]rune(seg)) >= 2 && !keywordSet[lower] {
					keywordSet[lower] = true
					keywords = append(keywords, seg)
				}
			} else {
				if len(seg) >= 2 && !keywordSet[lower] {
					keywordSet[lower] = true
					keywords = append(keywords, seg)
				}
			}
		}
	}

	return keywords
}

// splitByLanguage 将字符串按中英文边界拆分为连续的同语言片段
// 例如 "帮我看看Go编译" → ["帮我看看", "Go", "编译"]
func splitByLanguage(s string) []string {
	var segments []string
	var current []rune
	var currentIsChinese bool

	for i, r := range s {
		isHan := unicode.Is(unicode.Han, r)
		if i == 0 {
			currentIsChinese = isHan
		}
		if isHan != currentIsChinese {
			if len(current) > 0 {
				segments = append(segments, string(current))
			}
			current = nil
			currentIsChinese = isHan
		}
		current = append(current, r)
	}
	if len(current) > 0 {
		segments = append(segments, string(current))
	}
	return segments
}

// isChinese 判断字符串是否包含中文字符
func isChinese(s string) bool {
	for _, r := range s {
		if unicode.Is(unicode.Han, r) {
			return true
		}
	}
	return false
}

// ExtractToolLessonsFromRun 从 Agent Run 的工具调用中提取教训
// 在 Run 完成后调用，分析消息中的工具调用成功/失败模式
func (s *AgentMemoryService) ExtractToolLessonsFromRun(ctx context.Context, eid, agentID, userID int64, messageID int64) error {
	if messageID <= 0 {
		return nil
	}

	toolCalls, err := model.GetMessageToolCallsByMessageID(messageID)
	if err != nil {
		logger.Warnf(ctx, "获取工具调用记录失败: eid=%d, message_id=%d, err=%v", eid, messageID, err)
		return nil // 失败不阻塞主流程
	}

	if len(toolCalls) == 0 {
		return nil
	}

	now := time.Now().UnixMilli()

	for _, tc := range toolCalls {
		// 根据工具调用结果提取教训
		lesson := s.analyzeToolCallForLesson(tc)
		if lesson != "" {
			_ = model.AppendToolLesson(eid, agentID, userID, model.ToolLessonItem{
				ToolName: tc.ToolName,
				Lesson:   lesson,
				Success:  tc.Status == model.ToolCallStatusSuccess,
				Time:     now,
			})
		}
	}

	return nil
}

// analyzeToolCallForLesson 分析单条工具调用，生成教训文本
// 如果无需记录教训，返回空字符串
func (s *AgentMemoryService) analyzeToolCallForLesson(tc *model.MessageToolCall) string {
	if tc == nil {
		return ""
	}

	switch tc.Status {
	case model.ToolCallStatusFailed:
		// 工具调用失败，记录失败教训
		if tc.ErrorMsg != "" {
			// 截断过长的错误信息
			errMsg := tc.ErrorMsg
			if len(errMsg) > 100 {
				errMsg = errMsg[:100] + "..."
			}
			return fmt.Sprintf("工具 %s 执行失败: %s", tc.ToolName, errMsg)
		}
		return fmt.Sprintf("工具 %s 执行失败，请检查参数或重试", tc.ToolName)

	case model.ToolCallStatusSuccess:
		// 成功调用，如果有值得记录的教训
		if tc.DurationMs > 30000 { // 超过30秒的调用
			return fmt.Sprintf("工具 %s 执行耗时较长 (%dms)，注意优化调用参数", tc.ToolName, tc.DurationMs)
		}
		return ""

	default:
		return ""
	}
}
