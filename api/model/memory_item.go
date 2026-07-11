package model

import (
	"encoding/json"
	"regexp"
	"sort"
	"strings"
	"time"
)

// MemoryItem 单条记忆条目
//
// 关于 Category：
//   - 仅 preference（偏好/习惯）和 fact（核心事实/项目知识）会展示在 MEMORY.md 中
//   - 其他业务领域的"工具教训"不再走 Category，而是单独走 AgentToolLesson 模型
//   - 用户全局记忆（UserMemory.smart_memory / custom_memory）也不再使用 Category 分桶
//   - 历史遗留分类（lesson/project/custom）已下线，新写入若 Category 非法将被归并为 fact
type MemoryItem struct {
	Fact            string `json:"fact"`                        // 记忆内容
	Source          string `json:"source"`                      // user_input, inference, system, user_edit
	Time            int64  `json:"time"`                        // 创建时间（Unix 时间戳）
	Category        string `json:"category,omitempty"`          // 分类：preference | fact
	Tags            string `json:"tags,omitempty"`              // 逗号分隔的标签，支持多维度归类
	ExpireAt        int64  `json:"expire_at,omitempty"`         // 过期时间（Unix 时间戳），0 表示永不过期
	SourceSessionID string `json:"source_session_id,omitempty"` // 来源会话/消息 ID，用于溯源
	Topic           string `json:"topic,omitempty"`             // 主题，用于同类记忆归一
	Keywords        string `json:"keywords,omitempty"`          // 关键词索引，用于局部召回
	MemoryType      string `json:"memory_type,omitempty"`       // 记忆类型：preference | knowledge | failure | profile
	Evidence        string `json:"evidence,omitempty"`          // 来源证据摘要，用于解释为什么记住
	Weight          int    `json:"weight,omitempty"`            // 重要性权重，范围 0-100
	AccessCount     int    `json:"access_count,omitempty"`      // 召回命中次数
	LastAccessAt    int64  `json:"last_access_at,omitempty"`    // 最后一次召回时间（Unix 毫秒）
}

// 预定义的记忆分类 Key —— 仅这两类会被展示
const (
	CategoryPreference = "preference" // 偏好/习惯
	CategoryFact       = "fact"       // 核心事实/项目知识
)

const (
	MemoryTypePreference = "preference"
	MemoryTypeKnowledge  = "knowledge"
	MemoryTypeFailure    = "failure"
	MemoryTypeProfile    = "profile"
)

const (
	DefaultMaxUserSmartMemoryItems  = 100
	DefaultMaxUserCustomMemoryItems = 100
	DefaultMaxAgentMemoryItems      = 100
	DefaultMaxToolLessonItems       = 50
	DefaultMaxPromptMemoryItems     = 20
)

// DefaultCategoryLabels 默认分类标签映射（用于渲染 Markdown）
var DefaultCategoryLabels = map[string]string{
	CategoryPreference: "偏好/习惯",
	CategoryFact:       "核心事实/项目知识",
}

// CategoryLabel 获取分类的中文标签
func CategoryLabel(category string) string {
	if label, ok := DefaultCategoryLabels[category]; ok {
		return label
	}
	return category
}

// IsValidMemoryCategory 判断分类是否为合法的展示分类
func IsValidMemoryCategory(category string) bool {
	_, ok := DefaultCategoryLabels[category]
	return ok
}

// NormalizeMemoryCategory 将任意输入的 category 归一化：
//   - 合法值（preference / fact）原样返回
//   - 空值或历史遗留的 lesson/project/custom 等非法值统一归并到 fact
func NormalizeMemoryCategory(category string) string {
	if IsValidMemoryCategory(category) {
		return category
	}
	return CategoryFact
}

// SourcePriority 记忆来源的优先级权重，值越大越优先。
// 方案要求：用户当前输入 > 用户手动修改 > 自动整理 > 低置信推断
var SourcePriority = map[string]int{
	"user_input": 4, // 用户当前输入 — 最高优先
	"user_edit":  3, // 用户手动编辑
	"inference":  2, // 自动整理后的高置信记忆
	"system":     1, // 系统自动生成（低置信推断）
}

// NormalizeMemorySource 将 source 字段归一化：
//   - 合法值（user_input / user_edit / inference / system）原样返回
//   - 空值或其他未知值统一归并为 defaultSource
func NormalizeMemorySource(source string, defaultSource string) string {
	if _, ok := SourcePriority[source]; ok {
		return source
	}
	return defaultSource
}

// NormalizeItemsSource 遍历 items 数组，将每个 item 的 source 归一化。
// 空 source 或其他未知值统一归并为 defaultSource。
func NormalizeMemoryItem(item MemoryItem, defaultSource string) MemoryItem {
	item.Source = NormalizeMemorySource(item.Source, defaultSource)
	item.Category = NormalizeMemoryCategory(item.Category)
	item.MemoryType = NormalizeMemoryType(item.MemoryType, item.Category)
	item.Weight = NormalizeMemoryWeight(item.Weight)
	return SanitizeMemoryItem(item)
}

func NormalizeItemsSource(items []MemoryItem, defaultSource string) []MemoryItem {
	for i := range items {
		items[i].Source = NormalizeMemorySource(items[i].Source, defaultSource)
	}
	return items
}

func NormalizeMemoryType(memoryType, category string) string {
	switch memoryType {
	case MemoryTypePreference, MemoryTypeKnowledge, MemoryTypeFailure, MemoryTypeProfile:
		return memoryType
	}
	if category == CategoryPreference {
		return MemoryTypePreference
	}
	return MemoryTypeKnowledge
}

func NormalizeMemoryWeight(weight int) int {
	if weight < 0 {
		return 0
	}
	if weight > 100 {
		return 100
	}
	return weight
}

func SanitizeMemoryItem(item MemoryItem) MemoryItem {
	item.Fact = RedactMemoryText(item.Fact)
	item.Tags = RedactMemoryText(item.Tags)
	item.Topic = RedactMemoryText(item.Topic)
	item.Keywords = RedactMemoryText(item.Keywords)
	item.Evidence = RedactMemoryText(item.Evidence)
	return item
}

func SanitizeMemoryItemWithCheck(item MemoryItem) (MemoryItem, bool) {
	hasSensitive := ContainsSensitiveInfo(item.Fact) ||
		ContainsSensitiveInfo(item.Tags) ||
		ContainsSensitiveInfo(item.Topic) ||
		ContainsSensitiveInfo(item.Keywords) ||
		ContainsSensitiveInfo(item.Evidence)
	return SanitizeMemoryItem(item), hasSensitive
}

func ItemsContainSensitiveInfo(items []MemoryItem) bool {
	for _, item := range items {
		if ContainsSensitiveInfo(item.Fact) ||
			ContainsSensitiveInfo(item.Tags) ||
			ContainsSensitiveInfo(item.Topic) ||
			ContainsSensitiveInfo(item.Keywords) ||
			ContainsSensitiveInfo(item.Evidence) {
			return true
		}
	}
	return false
}

var sensitivePatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)sk-[a-z0-9_\-]{20,}`),
	regexp.MustCompile(`(?i)bearer\s+[a-z0-9._\-]+`),
	regexp.MustCompile(`(?i)password\s*[=:：]\s*[^\s,，;；]+`),
	regexp.MustCompile(`(?i)密码\s*[=:：]?\s*[^\s,，;；]+`),
	regexp.MustCompile(`\b[1-9]\d{5}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[0-9Xx]\b`),
	regexp.MustCompile(`\b(?:\d[ -]?){16,19}\b`),
}

func RedactMemoryText(text string) string {
	if text == "" {
		return text
	}
	redacted := text
	for _, pattern := range sensitivePatterns {
		redacted = pattern.ReplaceAllString(redacted, "[REDACTED]")
	}
	return redacted
}

func ContainsSensitiveInfo(text string) bool {
	if text == "" {
		return false
	}
	for _, pattern := range sensitivePatterns {
		if pattern.MatchString(text) {
			return true
		}
	}
	return false
}

func memoryMergeKey(item MemoryItem) string {
	fact := strings.TrimSpace(strings.ToLower(item.Fact))
	return "fact:" + fact
}

func memoryMergeKeys(item MemoryItem) []string {
	fact := strings.TrimSpace(strings.ToLower(item.Fact))
	if fact == "" {
		return []string{"fact:"}
	}
	return []string{"fact:" + fact}
}

func mergeMemoryItemFields(existing, incoming MemoryItem, defaultSource string) MemoryItem {
	merged := incoming
	if strings.TrimSpace(merged.Topic) == "" {
		merged.Topic = existing.Topic
	}
	if strings.TrimSpace(merged.Keywords) == "" {
		merged.Keywords = existing.Keywords
	}
	if strings.TrimSpace(merged.MemoryType) == "" {
		merged.MemoryType = existing.MemoryType
	}
	if strings.TrimSpace(merged.Evidence) == "" {
		merged.Evidence = existing.Evidence
	}
	if strings.TrimSpace(merged.SourceSessionID) == "" {
		merged.SourceSessionID = existing.SourceSessionID
	}
	if strings.TrimSpace(merged.Tags) == "" {
		merged.Tags = existing.Tags
	}
	if merged.Weight == 0 {
		merged.Weight = existing.Weight
	}
	if merged.AccessCount == 0 {
		merged.AccessCount = existing.AccessCount
	}
	if merged.LastAccessAt == 0 {
		merged.LastAccessAt = existing.LastAccessAt
	}
	return NormalizeMemoryItem(merged, defaultSource)
}

func ParseItemsJSON(itemsJSON string) ([]MemoryItem, error) {
	if itemsJSON == "" || itemsJSON == "[]" {
		return []MemoryItem{}, nil
	}
	var items []MemoryItem
	if err := json.Unmarshal([]byte(itemsJSON), &items); err != nil {
		return nil, err
	}
	return items, nil
}

func ParseAndNormalizeItemsJSON(itemsJSON string, defaultSource string) ([]MemoryItem, error) {
	items, err := ParseItemsJSON(itemsJSON)
	if err != nil {
		return nil, err
	}
	for i := range items {
		items[i] = NormalizeMemoryItem(items[i], defaultSource)
	}
	return items, nil
}

// NormalizeItemsJSON 解析 JSON 字符串为 []MemoryItem，归一化 source 和 category，再序列化回 JSON。
// 用于 PUT 接口中透传 items JSON 字符串的场景。
func NormalizeItemsJSON(itemsJSON string, defaultSource string) (string, error) {
	items, err := ParseAndNormalizeItemsJSON(itemsJSON, defaultSource)
	if err != nil {
		return itemsJSON, err
	}
	if itemsJSON == "" || itemsJSON == "[]" {
		return itemsJSON, nil
	}
	data, err := json.Marshal(items)
	if err != nil {
		return itemsJSON, err
	}
	return string(data), nil
}

func FilterActiveMemoryItems(items []MemoryItem, now int64) []MemoryItem {
	out := make([]MemoryItem, 0, len(items))
	for _, item := range items {
		if item.ExpireAt > 0 && item.ExpireAt <= now {
			continue
		}
		out = append(out, item)
	}
	return out
}

func TrimMemoryItems(items []MemoryItem, maxItems int, now int64) []MemoryItem {
	trimmed, _ := TrimMemoryItemsWithIndices(items, maxItems, now)
	return trimmed
}

func TrimMemoryItemsWithIndices(items []MemoryItem, maxItems int, now int64) ([]MemoryItem, []int) {
	if maxItems <= 0 || len(items) <= maxItems {
		indices := make([]int, 0, len(items))
		for i := range items {
			indices = append(indices, i)
		}
		return items, indices
	}
	type scoredItem struct {
		item  MemoryItem
		index int
		score int64
	}
	scored := make([]scoredItem, 0, len(items))
	for i, item := range items {
		scored = append(scored, scoredItem{item: item, index: i, score: memoryItemScore(item, now)})
	}
	sort.SliceStable(scored, func(i, j int) bool {
		if scored[i].score == scored[j].score {
			return scored[i].index < scored[j].index
		}
		return scored[i].score > scored[j].score
	})
	kept := scored[:maxItems]
	sort.SliceStable(kept, func(i, j int) bool { return kept[i].index < kept[j].index })
	out := make([]MemoryItem, 0, maxItems)
	indices := make([]int, 0, maxItems)
	for _, item := range kept {
		out = append(out, item.item)
		indices = append(indices, item.index)
	}
	return out, indices
}

func NormalizeMemoryItemsForWrite(items []MemoryItem, defaultSource string, maxItems int, now int64) []MemoryItem {
	if now <= 0 {
		now = time.Now().UnixMilli()
	}
	out := make([]MemoryItem, 0, len(items))
	for _, item := range items {
		if strings.TrimSpace(item.Fact) == "" {
			continue
		}
		out = append(out, NormalizeMemoryItem(item, defaultSource))
	}
	out = FilterActiveMemoryItems(out, now)
	return TrimMemoryItems(out, maxItems, now)
}

func NormalizeMemoryItemsForResponse(items []MemoryItem, defaultSource string, maxItems int) []MemoryItem {
	return NormalizeMemoryItemsForWrite(items, defaultSource, maxItems, time.Now().UnixMilli())
}

func memoryItemScore(item MemoryItem, now int64) int64 {
	sourceScore := int64(SourcePriority[NormalizeMemorySource(item.Source, "system")]) * 1000
	weightScore := int64(item.Weight) * 10
	accessScore := int64(item.AccessCount) * 2
	structureScore := int64(0)
	if strings.TrimSpace(item.Topic) != "" {
		structureScore += 50
	}
	if strings.TrimSpace(item.Keywords) != "" {
		structureScore += 50
	}
	manualScore := int64(0)
	if item.Source == "user_input" || item.Source == "user_edit" {
		manualScore = 500
	}
	referenceTime := item.LastAccessAt
	if referenceTime == 0 {
		referenceTime = item.Time
	}
	recencyScore := int64(0)
	if referenceTime > 0 && now > 0 {
		days := (now - referenceTime) / int64(24*time.Hour/time.Millisecond)
		if days < 0 {
			days = 0
		}
		if days < 365 {
			recencyScore = 365 - days
		}
	}
	return sourceScore + weightScore + accessScore + structureScore + manualScore + recencyScore
}

// MergeMemoryItems 按 fact 去重合并新旧条目，冲突时按来源优先级裁决。
//
// 合并规则：
//   - 新 fact：直接追加
//   - 相同 fact：比较 source 优先级，高优先级覆盖低优先级
//   - 同优先级：保留旧条目（existing wins，保持稳定性）
//
// 这是整个记忆系统唯一的去重合并入口，model/user_memory.go 和
// service/agent_memory_compress_service.go 均通过此函数统一行为。
func MergeMemoryItems(existing, incoming []MemoryItem) []MemoryItem {
	merged := make([]MemoryItem, 0, len(existing)+len(incoming))
	seen := make(map[string]int, len(existing)+len(incoming)) // fact → index in merged

	for _, it := range existing {
		it = NormalizeMemoryItem(it, "system")
		idx := len(merged)
		for _, key := range memoryMergeKeys(it) {
			seen[key] = idx
		}
		merged = append(merged, it)
	}
	for _, it := range incoming {
		rawIncoming := it
		it = NormalizeMemoryItem(it, "system")
		matched := -1
		for _, key := range memoryMergeKeys(it) {
			if idx, ok := seen[key]; ok {
				matched = idx
				break
			}
		}
		if matched >= 0 {
			existingPriority := SourcePriority[merged[matched].Source]
			incomingPriority := SourcePriority[it.Source]
			if incomingPriority > existingPriority {
				merged[matched] = mergeMemoryItemFields(merged[matched], rawIncoming, "system")
			}
			continue
		}
		idx := len(merged)
		for _, key := range memoryMergeKeys(it) {
			seen[key] = idx
		}
		merged = append(merged, it)
	}
	return merged
}

func MergeMemoryItemsForReplacement(existing, incoming []MemoryItem) []MemoryItem {
	if len(incoming) == 0 {
		return []MemoryItem{}
	}
	existingByFact := make(map[string]MemoryItem, len(existing))
	for _, item := range existing {
		normalized := NormalizeMemoryItem(item, "system")
		for _, key := range memoryMergeKeys(normalized) {
			existingByFact[key] = normalized
		}
	}
	out := make([]MemoryItem, 0, len(incoming))
	seen := make(map[string]bool, len(incoming))
	for _, item := range incoming {
		rawIncoming := item
		normalized := NormalizeMemoryItem(item, "user_edit")
		for _, key := range memoryMergeKeys(normalized) {
			if old, ok := existingByFact[key]; ok {
				normalized = mergeMemoryItemFields(old, rawIncoming, "user_edit")
				break
			}
		}
		primaryKey := memoryMergeKey(normalized)
		if seen[primaryKey] {
			continue
		}
		seen[primaryKey] = true
		out = append(out, normalized)
	}
	return out
}
