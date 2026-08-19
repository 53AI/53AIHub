package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/rag"
	relaymodel "github.com/songquanpeng/one-api/relay/model"
	"gorm.io/gorm"
)

// UserMemoryService 用户全局记忆服务
type UserMemoryService struct{}

// NewUserMemoryService 创建用户记忆服务
func NewUserMemoryService() *UserMemoryService {
	return &UserMemoryService{}
}

// GetUserMemoryWithSystemInfo 获取用户记忆并动态关联系统信息（昵称、部门）
// 即使没有记忆记录，也会返回系统信息（昵称、部门）。
func (s *UserMemoryService) GetUserMemoryWithSystemInfo(ctx context.Context, eid, userID int64) (*model.UserMemoryResponse, error) {
	if cached, err := s.getFromCache(ctx, eid, userID); err == nil && cached != nil {
		return cached, nil
	}

	memory, err := model.GetUserMemory(eid, userID)
	if err != nil {
		return nil, err
	}

	nickname, department := s.GetUserSystemInfo(ctx, eid, userID)

	var resp *model.UserMemoryResponse
	if memory != nil {
		resp = memory.ToResponse(nickname, department)
	} else {
		resp = &model.UserMemoryResponse{
			Eid:        eid,
			UserID:     userID,
			Nickname:   nickname,
			Department: department,
		}
	}

	_ = s.setCache(ctx, eid, userID, resp)

	return resp, nil
}

// GetUserSystemInfo 获取用户系统信息（昵称、部门）
// 部门为空时回退到组织架构顶级部门名称
func (s *UserMemoryService) GetUserSystemInfo(ctx context.Context, eid, userID int64) (nickname string, department string) {
	user, err := model.GetUserByID(userID)
	if err != nil {
		logger.Warnf(ctx, "获取用户信息失败: user_id=%d, err=%v", userID, err)
		return "", ""
	}

	nickname = user.Nickname

	if user.Type == model.UserTypeInternal {
		if err := user.LoadDepartments(model.DepartmentFromBackend); err == nil && len(user.Departments) > 0 {
			for i, d := range user.Departments {
				if i == 0 {
					department = d.Name
				} else {
					department += ", " + d.Name
				}
			}
		}
	}

	// 部门为空时回退到企业名称
	if department == "" {
		if enterprise, err := model.GetEnterpriseByID(eid); err == nil && enterprise != nil {
			department = enterprise.DisplayName
		}
	}

	return nickname, department
}

// FormatUserMemoryForPrompt 格式化用户记忆为 Prompt 片段（包含动态系统信息）
func (s *UserMemoryService) FormatUserMemoryForPrompt(ctx context.Context, eid, userID int64) string {
	memory, err := model.GetUserMemory(eid, userID)
	if err != nil || memory == nil {
		return ""
	}

	nickname, department := s.GetUserSystemInfo(ctx, eid, userID)
	smartItems, _ := memory.GetSmartMemoryItems()
	customItems, _ := memory.GetCustomMemoryItems()
	smartItems = model.NormalizeMemoryItemsForResponse(smartItems, "user_input", model.DefaultMaxUserSmartMemoryItems)
	customItems = model.NormalizeMemoryItemsForResponse(customItems, "user_input", model.DefaultMaxUserCustomMemoryItems)

	md := "# MEMORY.md — 用户全局记忆\n\n"

	md += "## 基本信息（来自系统）\n"
	if nickname != "" {
		md += "- 昵称：" + nickname + "\n"
	}
	if department != "" {
		md += "- 部门：" + department + "\n"
	}
	if memory.Position != "" {
		md += "- 职位：" + memory.Position + "\n"
	}
	if memory.Style != "" {
		md += "- 风格：" + memory.Style + "\n"
	}
	if nickname == "" && department == "" && memory.Position == "" && memory.Style == "" {
		md += "_暂无基本信息_\n"
	}

	md += "\n## 智能记忆\n"
	if len(smartItems) > 0 {
		for _, item := range smartItems {
			md += "- " + item.Fact + "\n"
		}
	}

	md += "\n## 自定义记忆\n"
	if len(customItems) > 0 {
		for _, item := range customItems {
			md += "- " + item.Fact + "\n"
		}
	}

	return md
}

// StandardizeImportResult LLM 标准化导入结果
type StandardizeImportResult struct {
	SmartItems    []model.MemoryItem     // 路由到智能记忆（profile/knowledge）
	CustomItems   []model.MemoryItem     // 路由到自定义记忆（preference/failure）
	MemoryActions []existingMemoryAction // 对已有记忆的处理动作（archive/replace）
}

// StandardizeImportText 调用 LLM 将用户自由文本标准化为结构化记忆条目
// 返回结果已按 memory_type 路由到智能记忆和自定义记忆
// 使用指定智能体的规划推理模型（fast_reasoning_config）作为 LLM
func (s *UserMemoryService) StandardizeImportText(ctx context.Context, text string, eid int64, userID int64) (*StandardizeImportResult, error) {
	if model.DB == nil {
		return nil, fmt.Errorf("数据库不可用")
	}

	// 0. 同步路径预检查：去除文本中与现有记忆重复的句子，减少 LLM 冗余处理
	preDedupedText := s.preDedupeImportText(ctx, eid, userID, text)

	// 0.1 增强括号内的沟通对象标记，提高 LLM 保留概率
	preDedupedText = enhanceAudienceMarkers(preDedupedText)

	// 1. 选择 LLM 渠道：使用系统智能体（小助理）的规划推理模型
	channel, modelName, err := resolveImportLLM(ctx, eid)
	if err != nil {
		return nil, err
	}

	// 2.1 构建请求（注入用户身份上下文，解决代词消解问题）
	existingMD := s.FormatUserMemoryForPrompt(ctx, eid, userID)
	nickname, department := s.GetUserSystemInfo(ctx, eid, userID)
	systemPrompt := buildUserMemoryImportPromptWithContext(nickname, department, existingMD)
	if strings.Contains(preDedupedText, "（") || strings.Contains(preDedupedText, "(") {
		systemPrompt += "\n\n【重要补充】用户文本中包含括号标注的沟通对象（如（给王总）、（对小李）），该对象是记忆的核心组成部分，必须在 fact 中完整保留，不得丢弃或泛化。"
	}
	request := &relaymodel.GeneralOpenAIRequest{
		Model:       modelName,
		MaxTokens:   0,
		Temperature: float64Ptr(0.3),
		Stream:      false,
	}
	request.Messages = []relaymodel.Message{
		{Role: "system", Content: systemPrompt},
		{Role: "user", Content: preDedupedText},
	}

	// 3. 调用 LLM
	contentGenSvc := rag.NewContentGeneratorService(model.DB)
	resp, err, openAIErr := contentGenSvc.TestChannel(ctx, channel, request)
	if err != nil {
		return nil, fmt.Errorf("调用 LLM 失败: %w", err)
	}
	if openAIErr != nil {
		return nil, fmt.Errorf("LLM 返回错误: %+v", openAIErr)
	}

	// 4. 解析 JSON 响应
	resp = strings.TrimSpace(resp)
	// 移除可能的代码块包裹
	resp = strings.TrimPrefix(resp, "```json")
	resp = strings.TrimPrefix(resp, "```")
	resp = strings.TrimSuffix(resp, "```")
	resp = strings.TrimSpace(resp)

	allItems, memoryActions := parseImportResponseToItems(ctx, resp)
	if len(allItems) == 0 {
		result := &StandardizeImportResult{}
		logger.Infof(ctx, "【记忆导入】LLM 未提取出有效记忆")
		return result, nil
	}

	// 5. 应用 conflict resolution：读取现有记忆并执行 archive/replace 动作
	if err := applyImportConflictResolution(ctx, eid, userID, memoryActions); err != nil {
		logger.Warnf(ctx, "【记忆导入】conflict resolution 失败: eid=%d, user_id=%d, err=%v", eid, userID, err)
	}

	// 6. 注入沟通对象：从原始文本提取（给XXX）标记，回填到 LLM 返回的 fact 中
	injectAudienceIntoItems(allItems, text)

	// 6. 按 memory_type 路由到智能记忆和自定义记忆
	result := &StandardizeImportResult{}
	for _, item := range allItems {
		item = model.NormalizeMemoryItem(item, "user_input")
		if item.Fact == "" {
			continue
		}
		switch item.MemoryType {
		case model.MemoryTypePreference, model.MemoryTypeFailure:
			result.CustomItems = append(result.CustomItems, item)
		case model.MemoryTypeProfile, model.MemoryTypeKnowledge:
			result.SmartItems = append(result.SmartItems, item)
		default:
			result.CustomItems = append(result.CustomItems, item)
		}
	}
	result.MemoryActions = memoryActions

	logger.Infof(ctx, "【记忆导入】LLM 标准化完成: 智能记忆=%d条, 自定义记忆=%d条, conflict actions=%d",
		len(result.SmartItems), len(result.CustomItems), len(result.MemoryActions))
	return result, nil
}

// importMemoryPayload LLM 导入接口约定的结构化输出
type importMemoryPayload struct {
	Items               []importMemoryItemWithAction `json:"items"`
	ExistingMemoryItems []existingMemoryAction       `json:"existing_memory_actions,omitempty"`
}

type importMemoryItemWithAction struct {
	Fact        string   `json:"fact"`
	Category    string   `json:"category"`
	MemoryType  string   `json:"memory_type"`
	Tags        []string `json:"tags"`
	Topic       string   `json:"topic"`
	Keywords    []string `json:"keywords"`
	Evidence    string   `json:"evidence"`
	ExpireAt    int64    `json:"expire_at"`
	Weight      int      `json:"weight"`
	Action      string   `json:"action,omitempty"`
	ReplaceFact string   `json:"replace_fact,omitempty"`
}

// parseImportResponseToItems 解析 LLM 返回的 JSON 记忆数据，支持 conflict resolution
func parseImportResponseToItems(ctx context.Context, resp string) ([]model.MemoryItem, []existingMemoryAction) {
	resp = strings.TrimSpace(resp)
	if resp == "" {
		return nil, nil
	}

	var payload importMemoryPayload
	if err := common.ParseLLMJSONInto(ctx, resp, &payload); err == nil && len(payload.Items) > 0 {
		items := make([]model.MemoryItem, 0, len(payload.Items))
		now := time.Now().UnixMilli()
		for _, item := range payload.Items {
			fact := strings.TrimSpace(item.Fact)
			if fact == "" {
				continue
			}
			action := strings.TrimSpace(item.Action)
			if strings.EqualFold(action, "skip") {
				continue
			}
			items = append(items, model.SanitizeMemoryItem(model.MemoryItem{
				Fact:       fact,
				Category:   model.NormalizeMemoryCategory(item.Category),
				Source:     "user_input",
				Tags:       strings.Join(item.Tags, ","),
				Topic:      strings.TrimSpace(item.Topic),
				Keywords:   strings.Join(item.Keywords, ","),
				MemoryType: model.NormalizeMemoryType(item.MemoryType, model.NormalizeMemoryCategory(item.Category)),
				Evidence:   strings.TrimSpace(item.Evidence),
				ExpireAt:   item.ExpireAt,
				Weight:     item.Weight,
				Time:       now,
			}))
		}
		return items, payload.ExistingMemoryItems
	}

	var allItems []model.MemoryItem
	if err := json.Unmarshal([]byte(resp), &allItems); err != nil {
		return nil, nil
	}
	return allItems, nil
}

// applyImportConflictResolution 对用户已有记忆应用 conflict resolution action
func applyImportConflictResolution(ctx context.Context, eid, userID int64, actions []existingMemoryAction) error {
	if len(actions) == 0 {
		return nil
	}

	backoff := 5 * time.Millisecond
	for attempt := 0; attempt < 3; attempt++ {
		err := applyImportConflictResolutionOnce(ctx, eid, userID, actions)
		if err == nil {
			return nil
		}
		if !isRetryableOptimisticLockErr(err) {
			return err
		}
		time.Sleep(backoff)
		backoff *= 2
	}
	return fmt.Errorf("conflict resolution 重试耗尽: eid=%d, user_id=%d", eid, userID)
}

func applyImportConflictResolutionOnce(ctx context.Context, eid, userID int64, actions []existingMemoryAction) error {
	memory, err := model.GetUserMemory(eid, userID)
	if err != nil || memory == nil {
		return nil
	}

	now := time.Now().UnixMilli()
	smartItems, _ := memory.GetSmartMemoryItems()
	customItems, _ := memory.GetCustomMemoryItems()

	smartByFact := make(map[string]int)
	for i, item := range smartItems {
		smartByFact[strings.ToLower(strings.TrimSpace(item.Fact))] = i
	}
	customByFact := make(map[string]int)
	for i, item := range customItems {
		customByFact[strings.ToLower(strings.TrimSpace(item.Fact))] = i
	}

	modified := false
	for _, action := range actions {
		fact := strings.TrimSpace(action.Fact)
		if fact == "" {
			continue
		}
		lowerFact := strings.ToLower(fact)
		act := strings.TrimSpace(action.Action)
		if !strings.EqualFold(act, "archive") && !strings.EqualFold(act, "replace") {
			continue
		}
		if idx, ok := smartByFact[lowerFact]; ok {
			if smartItems[idx].ExpireAt == 0 || smartItems[idx].ExpireAt > now {
				smartItems[idx].ExpireAt = now
				modified = true
			}
		}
		if idx, ok := customByFact[lowerFact]; ok {
			if customItems[idx].ExpireAt == 0 || customItems[idx].ExpireAt > now {
				customItems[idx].ExpireAt = now
				modified = true
			}
		}
	}

	if !modified {
		return nil
	}
	if err := memory.SetSmartMemoryItems(smartItems); err != nil {
		return err
	}
	if err := memory.SetCustomMemoryItems(customItems); err != nil {
		return err
	}
	return memory.Upsert()
}

func isRetryableOptimisticLockErr(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return true
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "duplicate key") ||
		strings.Contains(msg, "duplicate entry") ||
		strings.Contains(msg, "unique constraint failed") ||
		strings.Contains(msg, "1062") ||
		strings.Contains(msg, "23505")
}

// TriggerUserTopicMerge 对用户记忆按 Topic 分组并触发 LLM 融合
// 触发条件：同一 Topic 下条目数 >1
func (s *UserMemoryService) TriggerUserTopicMerge(ctx context.Context, eid, userID int64) error {
	if model.DB == nil {
		return nil
	}

	memory, err := model.GetUserMemory(eid, userID)
	if err != nil || memory == nil {
		return nil
	}

	smartItems, err := memory.GetSmartMemoryItems()
	if err != nil {
		return nil
	}
	customItems, err := memory.GetCustomMemoryItems()
	if err != nil {
		return nil
	}

	allItems := append(smartItems, customItems...)
	if len(allItems) == 0 {
		return nil
	}

	topicGroups := make(map[string][]model.MemoryItem)
	for _, item := range allItems {
		topic := strings.TrimSpace(item.Topic)
		if topic == "" {
			continue
		}
		topicGroups[topic] = append(topicGroups[topic], item)
	}

	for topic, groupItems := range topicGroups {
		if len(groupItems) <= 1 {
			continue
		}

		channel, modelName, err := resolveImportLLM(ctx, eid)
		if err != nil {
			logger.Warnf(ctx, "【用户Topic融合】获取 LLM 失败: %v", err)
			continue
		}

		systemPrompt := buildTopicMergePrompt(topic, groupItems)
		request := &relaymodel.GeneralOpenAIRequest{
			Model:       modelName,
			Messages:    []relaymodel.Message{{Role: "user", Content: "请将以上记忆融合为一条更完整准确的记忆"}},
			MaxTokens:   512,
			Temperature: float64Ptr(0.3),
			Stream:      false,
		}
		request.Messages = append([]relaymodel.Message{{Role: "system", Content: systemPrompt}}, request.Messages...)

		contentGenSvc := rag.NewContentGeneratorService(model.DB)
		resp, err, openAIErr := contentGenSvc.TestChannel(ctx, channel, request)
		if err != nil || openAIErr != nil {
			logger.Warnf(ctx, "【用户Topic融合】LLM 调用失败: err=%v, openai_err=%v", err, openAIErr)
			continue
		}

		mergedItem := parseTopicMergeResponse(ctx, resp, topic, groupItems[0].Category, selectTopicMemoryType(groupItems))
		if mergedItem == nil {
			continue
		}
		mergedItem.Source = "system"

		if err := s.persistUserTopicMerge(ctx, eid, userID, topic, groupItems, mergedItem); err != nil {
			logger.Warnf(ctx, "【用户Topic融合】持久化失败: %v", err)
		}
	}

	// 清除缓存，确保后续查询读到最新数据
	InvalidateUserMemoryCache(eid)
	return nil
}

func (s *UserMemoryService) persistUserTopicMerge(ctx context.Context, eid, userID int64, topic string, originalItems []model.MemoryItem, mergedItem *model.MemoryItem) error {
	const maxRetries = 3
	backoff := 5 * time.Millisecond
	now := time.Now().UnixMilli()

	for attempt := 0; attempt < maxRetries; attempt++ {
		memory, err := model.GetUserMemory(eid, userID)
		if err != nil || memory == nil {
			return nil
		}

		smartItems, _ := memory.GetSmartMemoryItems()
		customItems, _ := memory.GetCustomMemoryItems()

		archiveFacts := make(map[string]bool, len(originalItems))
		for _, item := range originalItems {
			archiveFacts[strings.ToLower(strings.TrimSpace(item.Fact))] = true
		}

		// 判断合并后的条目应路由到 smart 还是 custom
		isCustom := false
		for _, item := range originalItems {
			if item.MemoryType == model.MemoryTypePreference || item.MemoryType == model.MemoryTypeFailure {
				isCustom = true
				break
			}
		}

		var newSmart []model.MemoryItem
		var newCustom []model.MemoryItem
		for _, item := range smartItems {
			if archiveFacts[strings.ToLower(strings.TrimSpace(item.Fact))] {
				item.ExpireAt = now
			}
			newSmart = append(newSmart, item)
		}
		if isCustom {
			newCustom = append(newCustom, *mergedItem)
		} else {
			newSmart = append(newSmart, *mergedItem)
		}
		for _, item := range customItems {
			if archiveFacts[strings.ToLower(strings.TrimSpace(item.Fact))] {
				item.ExpireAt = now
			}
			newCustom = append(newCustom, item)
		}

		if err := memory.SetSmartMemoryItems(newSmart); err != nil {
			return err
		}
		if err := memory.SetCustomMemoryItems(newCustom); err != nil {
			return err
		}
		err = memory.Upsert()
		if err == nil {
			logger.Infof(ctx, "【用户Topic融合】持久化完成: eid=%d, user_id=%d, topic=%s, 合并条目数=%d",
				eid, userID, topic, len(originalItems))
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		time.Sleep(backoff)
		backoff *= 2
	}
	return fmt.Errorf("retry exhausted: eid=%d, user_id=%d", eid, userID)
}

// buildTopicMergePrompt 构建 Topic 融合的 System Prompt
func buildTopicMergePrompt(topic string, items []model.MemoryItem) string {
	prompt := fmt.Sprintf("以下记忆都属于同一主题「%s」，请将它们融合为一条更完整准确的记忆。\n\n主题：%s\n\n记忆条目：\n", topic, topic)
	for i, item := range items {
		prompt += fmt.Sprintf("%d. %s\n", i+1, item.Fact)
	}
	prompt += "\n输出要求：\n- 严格输出 JSON，格式：{\"fact\":\"融合后的完整内容\", \"tags\":[\"关键词\"], \"keywords\":[\"关键词\"], \"evidence\":\"来源\"}\n- 融合时保留关键信息，去除重复冗余\n- fact 应简洁准确，不超过 200 字"
	return prompt
}

// parseTopicMergeResponse 解析 Topic 融合的 LLM 响应
func parseTopicMergeResponse(ctx context.Context, resp string, topic string, category string, memoryType string) *model.MemoryItem {
	type mergePayload struct {
		Fact     string   `json:"fact"`
		Tags     []string `json:"tags"`
		Keywords []string `json:"keywords"`
		Evidence string   `json:"evidence"`
	}
	resp = strings.TrimSpace(resp)
	if resp == "" {
		return nil
	}
	var payload mergePayload
	if err := common.ParseLLMJSONInto(ctx, resp, &payload); err != nil {
		return nil
	}
	fact := strings.TrimSpace(payload.Fact)
	if fact == "" {
		return nil
	}
	now := time.Now().UnixMilli()
	item := &model.MemoryItem{
		Fact:       fact,
		Category:   category,
		Source:     "system",
		Tags:       strings.Join(payload.Tags, ","),
		Topic:      topic,
		Keywords:   strings.Join(payload.Keywords, ","),
		MemoryType: model.NormalizeMemoryType(memoryType, category),
		Evidence:   strings.TrimSpace(payload.Evidence),
		Weight:     80,
		Time:       now,
	}
	*item = model.SanitizeMemoryItem(*item)
	return item
}

// selectTopicMemoryType 为 Topic 融合结果选择主要记忆类型
func selectTopicMemoryType(items []model.MemoryItem) string {
	for _, item := range items {
		if item.MemoryType == model.MemoryTypeProfile {
			return model.MemoryTypeProfile
		}
	}
	for _, item := range items {
		if item.MemoryType == model.MemoryTypeFailure {
			return model.MemoryTypeFailure
		}
	}
	for _, item := range items {
		if item.MemoryType != "" {
			return item.MemoryType
		}
	}
	return model.MemoryTypeKnowledge
}

// buildUserMemoryImportPrompt 构建记忆导入的 System Prompt（不含用户上下文，保留向后兼容）
func buildUserMemoryImportPrompt() string {
	return buildUserMemoryImportPromptWithContext("", "", "")
}

// buildUserMemoryImportPromptWithContext 构建带用户身份和现有记忆上下文的 System Prompt
func buildUserMemoryImportPromptWithContext(nickname, department, existingMemory string) string {
	identityBlock := ""
	if nickname != "" || department != "" {
		identityBlock = fmt.Sprintf(`用户身份锚点：
- 当前用户昵称：%s
- 当前用户部门：%s

`, nickname, department)
	}

	existingBlock := ""
	existingListBlock := ""
	if existingMemory != "" {
		truncated := truncateString(existingMemory, 2000)
		existingBlock = fmt.Sprintf(`=== 用户已有记忆（请勿重复提取，仅提取新信息） ===
%s
=== 结束 ===

`, truncated)
		existingListBlock = `已有记忆列表（用于冲突消解，评估是否需要更新）：
` + truncated + `

`
	}

	return fmt.Sprintf(`%s%s你是一个用户画像分析助手。请分析用户提供的自我介绍文本，提取结构化的记忆条目。

%s对于已有记忆，你需要评估是否需要更新：
- keep: 保持不变（新信息与已有记忆一致或无关）
- archive: 归档（已有记忆已过时或被新信息替代，在 existing_memory_actions 中标记 action 为 archive）
- replace: 替换（新条目完全替代旧条目，在 existing_memory_actions 中标记旧条目 archive，并在新条目的 replace_fact 中注明被替换的旧记忆内容）

输出格式为 JSON 对象，包含 items 和 existing_memory_actions 两个字段：
{
  "items": [
    {
      "fact": "记忆内容（必填，字符串）",
      "category": "fact|preference",
      "memory_type": "profile|knowledge|preference|failure",
      "tags": ["标签1", "标签2"],
      "topic": "主题",
      "keywords": ["关键词1", "关键词2"],
      "evidence": "来源证据",
      "expire_at": 0,
      "weight": 50,
      "action": "keep|skip|replace（可选，默认 keep）",
      "replace_fact": "被替换的旧记忆内容（可选）"
    }
  ],
  "existing_memory_actions": [
    {
      "fact": "旧记忆内容",
      "action": "keep|archive",
      "reason": "原因（可选）",
      "replace_fact": "新记忆内容（可选）"
    }
  ]
}

要求：
1. 只提取文本中明确提及或可靠推断的信息，不要编造
2. 每条独立的事实或偏好作为一条独立的记忆条目
3. profile 类：用户的身份、职业、技能、项目等画像信息
4. knowledge 类：通用知识、事实性信息
5. preference 类：用户的偏好、习惯、风格
6. failure 类：失败教训、避坑经验
7. 只输出 JSON，不要额外的解释文字
8. 如果文本中出现"我"、"我的"、"本人"等第一人称代词，请删除代词，保留核心事实。不要添加用户名。
   例如："我是一个后端工程师" → "后端工程师"（而不是"张三是一名后端工程师"）
   例如："我的主力语言是 Go" → "主力语言为 Go"
   不要保留"用户"这个泛称。
 9. 如果文本中包含特定的沟通对象、受众或指向（如"给王总"、"对小李"、"向客户"），请在 fact 中保留该对象，或在 tags 中标注该对象。不要丢弃沟通方向。
   例如："向上汇报（给王总）：结论先行" → fact 为 "给王总汇报：结论先行、数据驱动"，tags 包含 "王总,向上汇报"
   例如："向下沟通（给小李）：鼓励为主" → fact 为 "给小李沟通：鼓励为主、包容引导"，tags 包含 "小李,向下沟通"

 示例输入：
 我是一名Go后端开发者，偏好简洁回答

 示例输出：
 [{"fact":"主力开发语言为 Go","category":"fact","memory_type":"profile","tags":"技术栈,Go","topic":"技术栈","keywords":"Go,后端开发","evidence":"用户自述","weight":80},{"fact":"偏好简洁回答","category":"preference","memory_type":"preference","tags":"回答风格,效率","topic":"回答风格","keywords":"简洁,直接","evidence":"用户明确要求","weight":70}]

 带沟通对象的示例：
 {"items":[{"fact":"给王总汇报：结论先行、数据驱动、结构化","category":"preference","memory_type":"preference","tags":["王总","向上汇报","沟通风格"],"topic":"沟通风格","keywords":"汇报,结论先行,数据驱动","evidence":"用户明确要求","expire_at":0,"weight":80,"action":"keep"},{"fact":"给小李沟通：鼓励为主、包容引导","category":"preference","memory_type":"preference","tags":["小李","向下沟通","沟通风格"],"topic":"沟通风格","keywords":"沟通,鼓励,包容","evidence":"用户明确要求","expire_at":0,"weight":80,"action":"keep"}],"existing_memory_actions":[]}
`, existingBlock, identityBlock, existingListBlock)
}

const userMemoryCacheTTL = 60 * time.Second

func (s *UserMemoryService) getFromCache(ctx context.Context, eid, userID int64) (*model.UserMemoryResponse, error) {
	if !common.IsRedisEnabled() {
		return nil, nil
	}
	data, err := common.RedisGet(common.GetUserMemoryCacheKey(eid, userID))
	if err != nil {
		return nil, err
	}
	if data == "" {
		return nil, nil
	}
	var resp model.UserMemoryResponse
	if err := json.Unmarshal([]byte(data), &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

func (s *UserMemoryService) setCache(ctx context.Context, eid, userID int64, resp *model.UserMemoryResponse) error {
	if !common.IsRedisEnabled() {
		return nil
	}
	data, err := json.Marshal(resp)
	if err != nil {
		return err
	}
	return common.RedisSet(common.GetUserMemoryCacheKey(eid, userID), string(data), userMemoryCacheTTL)
}

// InvalidateUserMemoryCache 清除企业下所有用户记忆缓存
func InvalidateUserMemoryCache(eid int64) {
	if eid <= 0 {
		return
	}
	if !common.IsRedisEnabled() {
		return
	}
	if _, err := common.RedisDelByPattern(common.GetUserMemoryCachePattern(eid)); err != nil && !errors.Is(err, common.ErrRedisNotEnabled) {
		logger.SysWarnf("【记忆】清理用户记忆缓存失败: eid=%d, err=%v", eid, err)
	}
}

// enhanceAudienceMarkers 将括号内的沟通对象展开为句内主语，提高 LLM 保留概率
// 如 "向上汇报（给王总）：结论先行" → "给王总汇报：结论先行、数据驱动、结构化"
func enhanceAudienceMarkers(text string) string {
	if text == "" {
		return text
	}
	result := text
	result = strings.ReplaceAll(result, "（给", "给")
	result = strings.ReplaceAll(result, "(给", "给")
	result = strings.ReplaceAll(result, "（对", "对")
	result = strings.ReplaceAll(result, "(对", "对")
	result = strings.ReplaceAll(result, "（向", "向")
	result = strings.ReplaceAll(result, "(向", "向")
	result = strings.ReplaceAll(result, "）", "")
	result = strings.ReplaceAll(result, ")", "")
	return result
}

// preDedupeImportText 同步路径预检查：去除文本中与现有记忆重复的句子，减少 LLM 冗余处理
func (s *UserMemoryService) preDedupeImportText(ctx context.Context, eid, userID int64, text string) string {
	if text == "" {
		return text
	}
	memory, err := model.GetUserMemory(eid, userID)
	if err != nil || memory == nil {
		return text
	}
	existingFacts := extractFactSentences(memory)
	if len(existingFacts) == 0 {
		return text
	}

	lines := strings.Split(text, "\n")
	var filtered []string
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			filtered = append(filtered, line)
			continue
		}
		fact := trimmed
		for _, prefix := range []string{"- ", "* ", "+ "} {
			if strings.HasPrefix(fact, prefix) {
				fact = fact[len(prefix):]
				break
			}
		}
		fact = strings.TrimSpace(fact)
		if fact == "" {
			filtered = append(filtered, line)
			continue
		}
		if isSentenceDuplicate(fact, existingFacts) {
			continue
		}
		filtered = append(filtered, line)
	}
	if len(filtered) == 0 {
		return ""
	}
	return strings.Join(filtered, "\n")
}

// extractFactSentences 从 UserMemory 中提取所有 fact 句子集合
func extractFactSentences(memory *model.UserMemory) map[string]struct{} {
	facts := make(map[string]struct{})
	smartItems, _ := memory.GetSmartMemoryItems()
	customItems, _ := memory.GetCustomMemoryItems()
	allItems := append(smartItems, customItems...)
	for _, item := range allItems {
		fact := strings.TrimSpace(item.Fact)
		if fact != "" {
			facts[strings.ToLower(fact)] = struct{}{}
		}
	}
	return facts
}

// isSentenceDuplicate 判断句子是否与现有事实集合重复
func isSentenceDuplicate(sentence string, existingFacts map[string]struct{}) bool {
	lower := strings.ToLower(strings.TrimSpace(sentence))
	if lower == "" {
		return false
	}
	if _, ok := existingFacts[lower]; ok {
		return true
	}
	for fact := range existingFacts {
		if strings.Contains(fact, lower) || strings.Contains(lower, fact) {
			return true
		}
	}
	return false
}

// truncateString 截断字符串到最大 rune 数
func truncateString(value string, maxRunes int) string {
	value = strings.TrimSpace(value)
	if maxRunes <= 0 {
		return value
	}
	if utf8.RuneCountInString(value) <= maxRunes {
		return value
	}
	runes := []rune(value)
	return string(runes[:maxRunes])
}

// injectAudienceIntoItems 从原始文本中提取沟通对象标记，并将其注入到 LLM 返回的记忆条目中
func injectAudienceIntoItems(items []model.MemoryItem, originalText string) {
	if len(items) == 0 || originalText == "" {
		return
	}
	audienceMap := extractAudienceMap(originalText)
	if len(audienceMap) == 0 {
		return
	}
	for i := range items {
		for keyword, audience := range audienceMap {
			if strings.Contains(items[i].Fact, keyword) && !strings.Contains(items[i].Fact, audience) {
				items[i].Fact = "给" + audience + items[i].Fact
				break
			}
		}
	}
}

// extractAudienceMap 从原始文本中提取沟通对象映射（关键词 → 对象名称）
// 例如："向上汇报（给王总）：结论先行" → {"向上汇报": "王总"}
func extractAudienceMap(text string) map[string]string {
	result := make(map[string]string)
	runes := []rune(text)
	for i := 0; i < len(runes)-1; i++ {
		if runes[i] == '（' || runes[i] == '(' {
			j := i + 1
			if j >= len(runes) {
				continue
			}
			prefix := string(runes[j])
			if prefix != "给" && prefix != "对" && prefix != "向" {
				continue
			}
			k := j + 1
			for k < len(runes) && runes[k] != '）' && runes[k] != ')' {
				k++
			}
			if k >= len(runes) {
				continue
			}
			audience := strings.TrimSpace(string(runes[j+1 : k]))
			if audience == "" {
				continue
			}
			before := strings.TrimSpace(string(runes[:i]))
			parts := strings.FieldsFunc(before, func(r rune) bool {
				return r == ' ' || r == '\n' || r == '\t' || r == '-' || r == '：' || r == ':'
			})
			keyword := ""
			if len(parts) > 0 {
				keyword = parts[len(parts)-1]
			}
			if keyword != "" && keyword != audience {
				result[keyword] = audience
			}
		}
	}
	return result
}

// resolveImportLLM 查找企业级系统智能体（小助理）的规划推理模型，用于记忆导入
func resolveImportLLM(ctx context.Context, eid int64) (*model.Channel, string, error) {
	if model.DB == nil {
		return nil, "", fmt.Errorf("数据库不可用")
	}

	var agent model.Agent
	if err := model.DB.Where("eid = ? AND agent_usage = ? AND is_system = ? AND enable = ?",
		eid, model.AgentUsageWorkAI, true, true).First(&agent).Error; err != nil {
		return nil, "", fmt.Errorf("未找到企业级系统智能体，请确认已在后台创建系统智能体")
	}

	fastReasoning, err := agent.GetFastReasoningConfig()
	if err != nil {
		return nil, "", fmt.Errorf("读取系统智能体推理模型配置失败: %w", err)
	}
	if fastReasoning == nil || fastReasoning.ChannelID == nil || fastReasoning.ModelName == nil {
		return nil, "", fmt.Errorf("系统智能体未配置规划推理模型，请在后台设置中配置")
	}

	ch, err := model.GetChannelByID(*fastReasoning.ChannelID)
	if err != nil || ch == nil {
		return nil, "", fmt.Errorf("规划推理模型对应的渠道不存在（channel_id=%d），请在后台重新配置: %w",
			*fastReasoning.ChannelID, err)
	}

	logger.Infof(ctx, "【记忆导入】使用系统智能体规划推理模型: channel_id=%d, model=%s", *fastReasoning.ChannelID, *fastReasoning.ModelName)
	return ch, *fastReasoning.ModelName, nil
}
