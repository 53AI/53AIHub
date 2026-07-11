package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/rag"
	relaymodel "github.com/songquanpeng/one-api/relay/model"
	"gorm.io/gorm"
)

// AgentMemoryCompressService Agent 记忆压缩/总结服务
// 调用 LLM 分析对话历史，生成新的记忆摘要
type AgentMemoryCompressService struct {
	contentGenService *rag.ContentGeneratorService
}

// NewAgentMemoryCompressService 创建记忆压缩服务
func NewAgentMemoryCompressService() *AgentMemoryCompressService {
	svc := &AgentMemoryCompressService{}
	if model.DB != nil {
		svc.contentGenService = rag.NewContentGeneratorService(model.DB)
	}
	return svc
}

// memoryCompressFreshWindow 压缩流程允许参考的对话历史时间窗口（48 小时）。
// 设置原因：避免反复将 2 天前的旧消息送入 LLM 重新提炼，违反 AGENTS.md 的"不静默重处理 2 天前数据"红线。
const memoryCompressFreshWindow = 48 * time.Hour

// compressedMemoryPayload LLM 压缩接口约定的结构化输出
type compressedMemoryPayload struct {
	Preferences         []taggedMemoryItem     `json:"preferences"`
	Facts               []taggedMemoryItem     `json:"facts"`
	ToolLessons         []taggedMemoryItem     `json:"tool_lessons,omitempty"`
	ExistingMemoryItems []existingMemoryAction `json:"existing_memory_actions,omitempty"`
}

type taggedMemoryItem struct {
	Topic         string   `json:"topic"`
	Fact          string   `json:"fact"`
	Tags          []string `json:"tags"`
	Keywords      []string `json:"keywords"`
	MemoryType    string   `json:"memory_type"`
	Evidence      string   `json:"evidence"`
	ExpireAt      int64    `json:"expire_at"`
	Weight        int      `json:"weight"`
	Action        string   `json:"action,omitempty"`
	ReplaceFact   string   `json:"replace_fact,omitempty"`
	ReplacedFacts []string `json:"replaced_facts,omitempty"`
}

type existingMemoryAction struct {
	Fact        string `json:"fact"`
	Action      string `json:"action"`
	Reason      string `json:"reason,omitempty"`
	ReplaceFact string `json:"replace_fact,omitempty"`
}

// CompressAgentMemory 触发 AI 压缩/总结 Agent 对用户的记忆
// sinceMessageID > 0 时，只压缩 >= sinceMessageID 的消息（任务式触发）。
// sinceMessageID == 0 时，回退到 48h 窗口（兼容手动调用）。
func (s *AgentMemoryCompressService) CompressAgentMemory(ctx context.Context, eid, agentID, userID, sinceMessageID int64) error {
	if s.contentGenService == nil {
		return fmt.Errorf("内容生成服务未初始化（DB不可用）")
	}
	// 1. 获取现有记忆（作为上下文参考）
	existingMemory, _ := model.GetAgentUserMemory(eid, agentID, userID)
	existingContent := ""
	existingItems := []model.MemoryItem{}
	if existingMemory != nil {
		existingContent = existingMemory.FormatAsMarkdown()
		existingItems, _ = existingMemory.GetItems()
		logger.Infof(ctx, "【记忆压缩】压缩前旧记忆: eid=%d, agent_id=%d, user_id=%d, 条目数=%d, 内容长度=%d",
			eid, agentID, userID, len(existingItems), len(existingContent))
	} else {
		logger.Infof(ctx, "【记忆压缩】压缩前无旧记忆: eid=%d, agent_id=%d, user_id=%d", eid, agentID, userID)
	}

	// 2. 获取 Agent 信息
	agent, err := model.GetAgentByID(eid, agentID)
	if err != nil {
		return fmt.Errorf("获取Agent信息失败: %w", err)
	}

	// 3. 获取待压缩的对话消息
	var freshMessages []*model.Message
	var fetchErr error
	if sinceMessageID > 0 {
		// 任务式：只取 >= sinceMessageID 的消息
		freshMessages, fetchErr = s.getMessagesSince(eid, userID, agentID, sinceMessageID)
	} else {
		// 回退：48h 窗口
		var allMessages []*model.Message
		_, allMessages, fetchErr = model.GetMessagesByUserAndAgent(eid, userID, agentID, "", 0, 20, 0)
		if fetchErr == nil {
			freshThresholdMs := time.Now().Add(-memoryCompressFreshWindow).UnixMilli()
			freshMessages = filterRecentMessages(allMessages, freshThresholdMs)
		}
	}
	if fetchErr != nil {
		logger.Errorf(ctx, "【记忆压缩】获取对话历史失败: eid=%d, agent_id=%d, user_id=%d, err=%v", eid, agentID, userID, fetchErr)
		return fmt.Errorf("获取对话历史失败: %w", fetchErr)
	}
	if len(freshMessages) == 0 {
		logger.Infof(ctx, "【记忆压缩】无新对话，跳过压缩: eid=%d, agent_id=%d, user_id=%d", eid, agentID, userID)
		return nil
	}

	return s.compressFreshMessages(ctx, eid, agentID, userID, agent, existingContent, existingItems, freshMessages)
}

// callCompressLLMWithRetry 调用 LLM 压缩，带临时错误重试和 context 超限的降级重试
func (s *AgentMemoryCompressService) callCompressLLMWithRetry(ctx context.Context, channel *model.Channel, modelName, systemPrompt string, freshMessages []*model.Message) (string, error) {
	maxTurns := 10
	for attempt := 0; attempt < 2; attempt++ {
		userMessages := s.buildCompressUserPrompt(freshMessages, maxTurns)
		request := &relaymodel.GeneralOpenAIRequest{
			Model:       modelName,
			Messages:    userMessages,
			MaxTokens:   0,
			Temperature: float64Ptr(0.3),
			Stream:      false,
		}
		request.Messages = append([]relaymodel.Message{{
			Role:    "system",
			Content: systemPrompt,
		}}, request.Messages...)

		compressStart := time.Now()
		resp, err, openAIErr := s.contentGenService.TestChannel(ctx, channel, request)
		compressDuration := time.Since(compressStart)

		if err == nil && openAIErr == nil {
			logger.Infof(ctx, "【记忆压缩】LLM 响应已返回: 长度=%d, 耗时=%s", len(resp), compressDuration)
			return resp, nil
		}

		if err != nil {
			if attempt == 0 {
				time.Sleep(time.Second)
				logger.Warnf(ctx, "【记忆压缩】LLM 调用临时失败，重试中: err=%v, 耗时=%s", err, compressDuration)
				continue
			}
			return "", fmt.Errorf("调用 LLM 失败(重试后): %w", err)
		}

		if attempt == 0 && isContextOverLimitError(openAIErr) {
			maxTurns = maxTurns / 2
			if maxTurns < 2 {
				maxTurns = 2
			}
			logger.Warnf(ctx, "【记忆压缩】LLM context 超限，消息量降级为 maxTurns=%d 重试: err=%+v, 耗时=%s", maxTurns, openAIErr, compressDuration)
			continue
		}

		return "", fmt.Errorf("LLM 返回错误(重试后): %+v", openAIErr)
	}
	return "", errors.New("LLM 调用超过最大重试次数")
}

// isContextOverLimitError 判断是否为 LLM context 长度超限错误
func isContextOverLimitError(openAIErr *relaymodel.Error) bool {
	msg := openAIErr.Message
	return strings.Contains(msg, "context_length_exceeded") ||
		strings.Contains(msg, "maximum context length") ||
		strings.Contains(msg, "too many tokens")
}

func (s *AgentMemoryCompressService) compressFreshMessages(ctx context.Context, eid, agentID, userID int64, agent *model.Agent, existingContent string, existingItems []model.MemoryItem, freshMessages []*model.Message) error {
	// 4. 选择 LLM 渠道：使用当前智能体自身的模型配置
	channel, modelName, err := resolveAgentChannel(ctx, agent)
	if err != nil {
		return fmt.Errorf("选择 LLM 渠道失败: %w", err)
	}

	toolLessonsMarkdown := ""
	if tl, err := model.GetAgentToolLessons(eid, agentID, userID); err == nil && tl != nil {
		toolLessonsMarkdown = tl.FormatAsMarkdown()
	}
	userSmartMemoryMarkdown := ""
	if um, err := model.GetUserMemory(eid, userID); err == nil && um != nil {
		if items, err := um.GetSmartMemoryItems(); err == nil && len(items) > 0 {
			var sb strings.Builder
			sb.WriteString("已有的用户全局画像记忆（请评估是否需要更新）：\n")
			for i, item := range items {
				sb.WriteString(fmt.Sprintf("%d. %s | topic: %s | memory_type: %s\n", i+1, item.Fact, item.Topic, item.MemoryType))
			}
			userSmartMemoryMarkdown = sb.String()
		}
	}

	// 5. 调用 LLM（带重试和消息降级）
	systemPrompt := s.buildCompressSystemPrompt(agent.Name, existingContent, existingItems, toolLessonsMarkdown, userSmartMemoryMarkdown)
	resp, err := s.callCompressLLMWithRetry(ctx, channel, modelName, systemPrompt, freshMessages)
	if err != nil {
		return err
	}

	// 7. 解析 LLM 返回的结构化记忆，转换为 MemoryItem 列表 + action 标记
	result := s.parseCompressResponseToItems(ctx, resp)
	if result == nil || (len(result.NewItems) == 0 && len(result.MemoryActions) == 0) {
		logger.Warnf(ctx, "【记忆压缩】LLM 未提炼出有效条目或动作，保留旧记忆: eid=%d, agent_id=%d, user_id=%d", eid, agentID, userID)
		return nil
	}

	// 7.1 从对话消息中提取沟通对象，回填到 LLM 返回的记忆条目中
	if conversationText := extractConversationText(freshMessages); conversationText != "" {
		injectAudienceIntoItems(result.NewItems, conversationText)
	}

	// 从最新消息中获取会话 ID，作为 SourceSessionID 写入每条压缩条目
	sessionID := s.extractSessionID(freshMessages)
	if sessionID != "" {
		for i := range result.NewItems {
			result.NewItems[i].SourceSessionID = sessionID
		}
	}

	// 8. 持久化：重读最新 → 合并 → action 处理 → Version Update → 冲突重试
	//    同时返回 profile 条目供全局画像同步
	profileItems, err := s.persistCompressedItems(ctx, eid, agentID, userID, result)
	if err != nil {
		return fmt.Errorf("更新记忆失败: %w", err)
	}

	// 9. P1.3: 全局画像自动发现 —— profile 类型记忆同步到 user_memories.smart_memory
	if len(profileItems) > 0 {
		if err := model.MergeSmartMemory(eid, userID, profileItems); err != nil {
			logger.Warnf(ctx, "【记忆同步】全局画像写入失败: eid=%d, user_id=%d, profile条目=%d, err=%v",
				eid, userID, len(profileItems), err)
		} else {
			logger.Infof(ctx, "【记忆同步】全局画像写入成功: eid=%d, user_id=%d, profile条目=%d",
				eid, userID, len(profileItems))
		}
	}

	// 10. 压缩提炼的工具教训写入 TOOLS.md
	if len(result.ToolLessonItems) > 0 {
		if err := s.persistCompressedToolLessons(ctx, eid, agentID, userID, result.ToolLessonItems); err != nil {
			logger.Warnf(ctx, "【记忆压缩】工具教训写入失败: eid=%d, agent_id=%d, user_id=%d, err=%v",
				eid, agentID, userID, err)
		}
	}

	// 11. P1.2: 异步触发 Topic 融合（不阻塞主流程）
	go s.triggerTopicMergeAsync(context.Background(), eid, agentID, userID)

	logger.Infof(ctx, "【记忆压缩】压缩完成并持久化: eid=%d, agent_id=%d, user_id=%d, 压缩条目数=%d",
		eid, agentID, userID, len(result.NewItems))
	return nil
}

// persistCompressedItems 把 LLM 压缩出来的 items 与 DB 中最新 Items 合并写回
// 合并语义：按 Fact 去重，已存在的旧条目优先保留（保留它们的 Source/Time），新条目按顺序追加
// 同时处理 existingMemoryActions：archive 的旧条目设置 expire_at = now（软归档）
// 返回 profile 类型的新条目，供后续同步到全局画像
func (s *AgentMemoryCompressService) persistCompressedItems(ctx context.Context, eid, agentID, userID int64, result *compressResult) ([]model.MemoryItem, error) {
	var lastErr error
	const maxRetries = 3
	backoff := 5 * time.Millisecond
	now := time.Now().UnixMilli()
	var profileItems []model.MemoryItem

	for attempt := 0; attempt < maxRetries; attempt++ {
		latest, err := model.GetAgentUserMemory(eid, agentID, userID)
		if err != nil {
			return nil, err
		}
		if latest == nil {
			if len(result.NewItems) == 0 {
				return nil, nil
			}
			latest = &model.AgentUserMemory{
				Eid:     eid,
				AgentID: agentID,
				UserID:  userID,
			}
			// profile 类型条目只进 UserMemory（全局画像），不进 AgentUserMemory
			if err := latest.SetItems(filterNonProfileItems(result.NewItems)); err != nil {
				return nil, err
			}
			if err := latest.Create(); err != nil {
				return nil, err
			}
			profileItems = extractProfileItems(result.NewItems)
			return profileItems, nil
		}

		baselineVersion := latest.Version
		rawItems, err := model.ParseItemsJSON(string(latest.Items))
		if err != nil {
			return nil, err
		}
		existingItems, archivedItems := splitActiveAndArchivedMemoryItems(rawItems, now)

		// 处理 existingMemoryActions：archive 旧条目
		existingItems = applyMemoryActions(ctx, existingItems, result.MemoryActions, now)

		// 合并新条目（profile 类型不进 AgentUserMemory，只进 UserMemory 全局画像）
		merged := mergeMemoryItemsByFact(existingItems, filterNonProfileItems(result.NewItems))
		merged = append(merged, archivedItems...)
		if err := persistMemoryItemsWithArchived(latest, merged, now); err != nil {
			return nil, err
		}
		latest.Version = baselineVersion
		err = latest.Update()
		if err == nil {
			profileItems = extractProfileItems(result.NewItems)
			logger.Infof(ctx, "【记忆压缩】持久化完成: eid=%d, agent_id=%d, user_id=%d, 新条目=%d, archive动作=%d",
				eid, agentID, userID, len(result.NewItems), len(result.MemoryActions))
			return profileItems, nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
		lastErr = err
		time.Sleep(backoff)
		backoff *= 2
	}
	return nil, lastErr
}

// persistMemoryItemsWithArchived 序列化记忆条目并保留 archive 标记。
// AgentUserMemory.SetItems 会过滤 expire_at <= now 的条目，适合正常写入；
// 这里需要软归档旧条目，因此只做 Normalize/Sanitize/Trim，不做 active 过滤。
func persistMemoryItemsWithArchived(memory *model.AgentUserMemory, items []model.MemoryItem, now int64) error {
	items = normalizeMemoryItemsKeepingArchived(items, "system", model.DefaultMaxAgentMemoryItems, now)
	data, err := json.Marshal(items)
	if err != nil {
		return err
	}
	memory.Items = model.LongText(data)
	return nil
}

func splitActiveAndArchivedMemoryItems(items []model.MemoryItem, now int64) ([]model.MemoryItem, []model.MemoryItem) {
	activeItems := make([]model.MemoryItem, 0, len(items))
	archivedItems := make([]model.MemoryItem, 0)
	for _, item := range items {
		if item.ExpireAt > 0 && item.ExpireAt <= now {
			archivedItems = append(archivedItems, item)
			continue
		}
		activeItems = append(activeItems, item)
	}
	return activeItems, archivedItems
}

func normalizeMemoryItemsKeepingArchived(items []model.MemoryItem, defaultSource string, maxItems int, now int64) []model.MemoryItem {
	activeItems := make([]model.MemoryItem, 0, len(items))
	archivedItems := make([]model.MemoryItem, 0)
	for _, item := range items {
		if strings.TrimSpace(item.Fact) == "" {
			continue
		}
		item = model.NormalizeMemoryItem(item, defaultSource)
		if item.ExpireAt > 0 && item.ExpireAt <= now {
			archivedItems = append(archivedItems, item)
			continue
		}
		activeItems = append(activeItems, item)
	}
	activeItems = model.TrimMemoryItems(activeItems, maxItems, now)
	if len(archivedItems) == 0 || len(activeItems) >= maxItems {
		return activeItems
	}
	remaining := maxItems - len(activeItems)
	if len(archivedItems) > remaining {
		archivedItems = archivedItems[len(archivedItems)-remaining:]
	}
	return append(activeItems, archivedItems...)
}

// applyMemoryActions 对已有记忆条目应用 action：archive 的条目设置 expire_at = now
func applyMemoryActions(ctx context.Context, items []model.MemoryItem, actions []existingMemoryAction, now int64) []model.MemoryItem {
	if len(actions) == 0 || len(items) == 0 {
		return items
	}

	actionMap := make(map[string]*existingMemoryAction, len(actions))
	for i := range actions {
		actionMap[strings.ToLower(strings.TrimSpace(actions[i].Fact))] = &actions[i]
	}

	for i := range items {
		key := strings.ToLower(strings.TrimSpace(items[i].Fact))
		if action, ok := actionMap[key]; ok {
			if strings.EqualFold(strings.TrimSpace(action.Action), "archive") {
				items[i].ExpireAt = now
				logger.Infof(ctx, "【记忆消解】归档旧条目: fact_len=%d, reason_len=%d", len(items[i].Fact), len(action.Reason))
			}
		}
	}
	return items
}

// persistCompressedToolLessons 将压缩提炼的工具教训写入 agent_tool_lessons
func (s *AgentMemoryCompressService) persistCompressedToolLessons(ctx context.Context, eid, agentID, userID int64, items []model.ToolLessonItem) error {
	if len(items) == 0 {
		return nil
	}
	logger.Infof(ctx, "【记忆压缩】写入工具教训: eid=%d, agent_id=%d, user_id=%d, 条数=%d",
		eid, agentID, userID, len(items))
	return model.AppendToolLessons(eid, agentID, userID, items)
}

// extractProfileItems 从新条目中提取 memory_type == "profile" 的条目
func extractProfileItems(items []model.MemoryItem) []model.MemoryItem {
	var profileItems []model.MemoryItem
	for _, item := range items {
		if item.MemoryType == model.MemoryTypeProfile {
			profileItems = append(profileItems, item)
		}
	}
	return profileItems
}

// filterNonProfileItems 过滤掉 profile 类型条目，仅返回应存入 AgentUserMemory 的条目。
// profile 类型条目只应同步到 UserMemory（全局画像），不应进入 AgentUserMemory。
func filterNonProfileItems(items []model.MemoryItem) []model.MemoryItem {
	var nonProfile []model.MemoryItem
	for _, item := range items {
		if item.MemoryType != model.MemoryTypeProfile {
			nonProfile = append(nonProfile, item)
		}
	}
	return nonProfile
}

// mergeMemoryItemsByFact 按 Fact 去重合并，冲突时按来源优先级裁决。
// 委托给 model.MergeMemoryItems 统一实现。
func mergeMemoryItemsByFact(existing, incoming []model.MemoryItem) []model.MemoryItem {
	return model.MergeMemoryItems(existing, incoming)
}

// filterRecentMessages 过滤出 created_time >= thresholdMs 的消息（即时间窗口内的新消息）
func filterRecentMessages(messages []*model.Message, thresholdMs int64) []*model.Message {
	if len(messages) == 0 {
		return nil
	}
	out := make([]*model.Message, 0, len(messages))
	for _, m := range messages {
		if m == nil {
			continue
		}
		if m.CreatedTime >= thresholdMs {
			out = append(out, m)
		}
	}
	return out
}

// buildCompressSystemPrompt 构建压缩记忆的 System Prompt
// 要求 LLM 严格输出 JSON 格式，包含新记忆提取和已有记忆的 action 标记。
func (s *AgentMemoryCompressService) buildCompressSystemPrompt(agentName, existingContent string, existingItems []model.MemoryItem, existingToolLessonsMarkdown string, existingSmartMemoryMarkdown string) string {
	prompt := `你是一个专业的记忆分析助手。请基于对话历史，提取并总结关于用户的关键信息。

请分类提取以下三类信息：
1. preferences（偏好/习惯）：用户的回答风格偏好、工作习惯、沟通风格等
2. facts（核心事实/项目知识）：用户身份、项目背景、技术栈、团队协作信息等
3. tool_lessons（工具｜技能相关要求/约束）：对话中涉及工具或技能的任何要求、限制、偏好、经验教训
    - 包括用户对工具/技能的使用偏好（如"我不喜欢 vim"、"PPTX 统一用黄色背景"）、使用技巧（如"grep 加 -n"）、注意事项、最佳实践
    - 核心判断：是否提到了某个具体工具或技能？只要提到工具/技能且对之有要求/约束/技巧/偏好，就归入 tool_lessons
    - tool_lessons 的 topic 字段填写工具名或技能名（如"vim"、"grep"、"web_search"、"pptx"）
    - 技能（如 pptx、12306、web_search）的 topic 也填写技能名，它们和工具同等对待

输出要求：
- 严格输出 JSON，不要任何额外文字、不要 Markdown 代码块包裹
- 每条信息必须包含 fact（内容）和 tags（关键词标签，用于检索匹配）
- 每条信息尽量包含 topic（主题）、keywords（关键词索引）、memory_type（preference/knowledge/failure/profile）、evidence（来源证据摘要）、expire_at（过期时间戳，毫秒，0=永不过期）、weight（重要性权重，0-100）
- tags 和 keywords 是从 fact 中提取的 2-5 个关键词，用数组形式给出
- 不要保存 API Key、Token、密码、身份证、银行卡等敏感信息，发现时用 [REDACTED] 替代
- 没有可总结的信息时返回 {"preferences":[],"facts":[],"tool_lessons":[]}
- 对于同一工具/技能，尽量复用已有 fact 的措辞，只更新变化的部分，避免重复生成含义相同的条目

对于已有记忆，你需要评估是否需要更新：
- keep: 保持不变（新信息与已有记忆一致或无关）
- archive: 归档（已有记忆已过时或被新信息替代，设置 action 为 archive）
- replace: 替换（新条目完全替代旧条目，在 existing_memory_actions 中标记旧条目 archive，新条目中注明 replace_fact）

JSON Schema：
{
  "preferences": [{"topic":"string","fact": "string", "tags": ["string", ...], "keywords": ["string", ...], "memory_type":"preference", "evidence":"string", "expire_at": 0, "weight": 50}],
  "facts": [{"topic":"string","fact": "string", "tags": ["string", ...], "keywords": ["string", ...], "memory_type":"knowledge|failure|profile", "evidence":"string", "expire_at": 0, "weight": 50}],
  "tool_lessons": [{"topic":"工具名","fact": "string", "tags": ["string", ...], "keywords": ["string", ...], "memory_type":"knowledge", "evidence":"string", "expire_at": 0, "weight": 50}],
  "existing_memory_actions": [{"fact":"string","action":"keep|archive","reason":"string","replace_fact":"string(可选)"}]
}

示例：
{"preferences":[{"topic":"回答风格","fact":"回答时偏好先解释结论再展开理由","tags":["回答风格","解释方式"],"keywords":["结论优先","简洁"],"memory_type":"preference","evidence":"用户明确要求","expire_at":0,"weight":60}],"facts":[{"topic":"Go 技术栈","fact":"主力开发语言为 Go","tags":["技术栈","Go"],"keywords":["Go","后端"],"memory_type":"profile","evidence":"用户自述","expire_at":0,"weight":80},{"topic":"版本排查","fact":"当前项目版本 V0.3.5 已发布","tags":["项目","版本"],"keywords":["V0.3.5","发布"],"memory_type":"knowledge","evidence":"近期对话","expire_at":1750000000000,"weight":50}],"tool_lessons":[{"topic":"git","fact":"每次 git merge 前先 rebase 避免分叉","tags":["git","merge","rebase"],"keywords":["git merge","rebase"],"memory_type":"knowledge","evidence":"用户明确要求","expire_at":0,"weight":60},{"topic":"pptx","fact":"PPT 统一使用黄色背景 #F9E795，默认单页","tags":["pptx","PPT","背景"],"keywords":["pptx","黄色背景"],"memory_type":"knowledge","evidence":"用户明确要求","expire_at":0,"weight":60}],"existing_memory_actions":[{"fact":"当前项目版本 V0.3.4 测试中","action":"archive","reason":"版本已更新为 V0.3.5","replace_fact":"当前项目版本 V0.3.5 已发布"}]}
`

	if existingContent != "" && len(existingItems) > 0 {
		prompt += fmt.Sprintf("\n已有的记忆条目（请评估是否需要更新）：\n%s", existingContent)
		prompt += "\n\n已有记忆条目详情（用于 action 标记）："
		for i, item := range existingItems {
			prompt += fmt.Sprintf("\n%d. fact: %s | topic: %s | memory_type: %s", i+1, item.Fact, item.Topic, item.MemoryType)
		}
	}

	if strings.TrimSpace(existingToolLessonsMarkdown) != "" {
		prompt += "\n\n已有的工具教训（请评估是否需要更新）：\n" + strings.TrimSpace(existingToolLessonsMarkdown)
	}

	if strings.TrimSpace(existingSmartMemoryMarkdown) != "" {
		prompt += "\n\n" + strings.TrimSpace(existingSmartMemoryMarkdown)
	}

	return prompt
}

// buildCompressUserPrompt 构建用户消息（包含对话历史）
// getMessagesSince 获取 id >= sinceID 的消息（任务式触发专用）
// 上限 100 条防止意外堆积导致 LLM token 超限
func (s *AgentMemoryCompressService) getMessagesSince(eid, userID, agentID, sinceID int64) ([]*model.Message, error) {
	messages, err := model.GetMessagesByUserAndAgentSince(eid, userID, agentID, sinceID)
	if err != nil {
		return nil, err
	}
	// 只保留有实际对话内容的消息
	var filtered []*model.Message
	for _, m := range messages {
		if m == nil {
			continue
		}
		if m.Message != "" || m.Answer != "" {
			filtered = append(filtered, m)
		}
	}
	// 上限 100 条
	if len(filtered) > 100 {
		filtered = filtered[len(filtered)-100:]
	}
	return filtered, nil
}

func (s *AgentMemoryCompressService) buildCompressUserPrompt(messages []*model.Message, maxTurns int) []relaymodel.Message {
	var relayMessages []relaymodel.Message

	// 首尾取样：消息过多时取前 5 条（保留会话起始上下文）+ 后 15 条（最近对话）
	maxTotal := maxTurns * 2
	headCount := 5
	tailCount := maxTotal - headCount

	var selectedMsgs []*model.Message
	if len(messages) <= maxTotal {
		selectedMsgs = messages
	} else {
		head := messages[:headCount]
		tail := messages[len(messages)-tailCount:]
		selectedMsgs = append(head, tail...)
	}

	messageIDs := make([]int64, 0, len(selectedMsgs))
	toolCallMap := make(map[int64][]*model.MessageToolCall)
	if len(selectedMsgs) > 0 && selectedMsgs[0] != nil && selectedMsgs[0].Eid != 0 {
		for _, msg := range selectedMsgs {
			messageIDs = append(messageIDs, msg.ID)
		}
		tmpMap, err := model.GetMessageToolCallsByMessageIDs(selectedMsgs[0].Eid, messageIDs)
		if err == nil {
			toolCallMap = tmpMap
		}
	}

	var dialogParts []string
	for _, msg := range selectedMsgs {
		if msg.Message != "" {
			dialogParts = append(dialogParts, fmt.Sprintf("用户: %s", msg.Message))
		}
		if msg.Answer != "" {
			dialogParts = append(dialogParts, fmt.Sprintf("助手: %s", msg.Answer))
		}
		if toolCalls, ok := toolCallMap[msg.ID]; ok && len(toolCalls) > 0 {
			for _, tc := range toolCalls {
				name := tc.SkillName
				if name == "" {
					name = tc.FunctionName
				}
				if name == "" {
					continue
				}
				if tc.Status == model.ToolCallStatusSuccess {
					dialogParts = append(dialogParts, fmt.Sprintf("[技能调用] %s: 成功", name))
				} else if tc.ErrorMsg != "" {
					dialogParts = append(dialogParts, fmt.Sprintf("[技能调用] %s: 失败 (%s)", name, tc.ErrorMsg))
				} else {
					dialogParts = append(dialogParts, fmt.Sprintf("[技能调用] %s: 失败", name))
				}
			}
		}
	}

	dialogText := strings.Join(dialogParts, "\n\n")
	if dialogText == "" {
		dialogText = "暂无对话历史。请基于现有记忆内容维持或更新记忆。"
	}

	relayMessages = append(relayMessages, relaymodel.Message{
		Role:    "user",
		Content: fmt.Sprintf("请分析以下对话历史，提取关于用户的记忆信息（严格按 JSON Schema 输出）：\n\n%s", dialogText),
	})

	return relayMessages
}

// resolveAgentChannel 解析智能体自身的执行渠道和模型名称
// 优先级：skill_run_config > fast_reasoning_config > agent 默认渠道
func resolveAgentChannel(ctx context.Context, agent *model.Agent) (*model.Channel, string, error) {
	if agent == nil {
		return nil, "", fmt.Errorf("agent is nil")
	}

	executionModel := agent.Model
	var executionChannel *model.Channel

	// 优先级 1：skill_run_config
	if agent.AgentUsage == model.AgentUsageWorkAI {
		if skillRunConfig, err := agent.GetSkillRunConfig(); err == nil && skillRunConfig != nil && skillRunConfig.Enable {
			executionModel = skillRunConfig.ModelName
			if skillRunConfig.ChannelID != 0 {
				if ch, err := model.GetChannelByID(skillRunConfig.ChannelID); err == nil {
					executionChannel = ch
				} else {
					logger.Warnf(ctx, "【渠道解析】skill_run_config 渠道未找到: channelID=%d, err=%v", skillRunConfig.ChannelID, err)
				}
			}
		}
	}

	// 优先级 2：fast_reasoning_config
	if executionChannel == nil {
		if frCfg, err := agent.GetFastReasoningConfig(); err == nil && frCfg != nil {
			if frCfg.ChannelID != nil && frCfg.ModelName != nil {
				executionModel = *frCfg.ModelName
				if ch, err := model.GetChannelByID(*frCfg.ChannelID); err == nil {
					executionChannel = ch
				} else {
					logger.Warnf(ctx, "【渠道解析】FastReasoning 渠道未找到: channelID=%d, err=%v", *frCfg.ChannelID, err)
				}
			}
		}
	}

	// 优先级 3：agent 默认渠道
	if executionChannel == nil {
		ch, err := model.GetRandomChannel(agent.Eid, agent.ChannelType, agent.Model)
		if err == nil {
			executionChannel = ch
			executionModel = agent.Model
		} else {
			logger.Warnf(ctx, "【渠道解析】agent 默认渠道未找到: channelType=%d, model=%s, err=%v", agent.ChannelType, agent.Model, err)
		}
	}

	if executionChannel == nil {
		return nil, "", fmt.Errorf("agent %d 没有可用的执行渠道", agent.AgentID)
	}

	return executionChannel, executionModel, nil
}

// compressResult LLM 压缩结果，包含新记忆条目、工具教训和已有记忆的处理动作
type compressResult struct {
	NewItems        []model.MemoryItem
	ToolLessonItems []model.ToolLessonItem
	MemoryActions   []existingMemoryAction
}

// parseCompressResponseToItems 解析 LLM 返回的 JSON 记忆数据，返回新条目和处理动作
func (s *AgentMemoryCompressService) parseCompressResponseToItems(ctx context.Context, resp string) *compressResult {
	resp = strings.TrimSpace(resp)
	if resp == "" {
		return nil
	}

	var payload compressedMemoryPayload
	if err := common.ParseLLMJSONInto(ctx, resp, &payload); err != nil {
		logger.Warnf(ctx, "【记忆压缩】LLM JSON 解析失败: err=%v", err)
		return nil
	}

	now := time.Now().UnixMilli()
	newItems := make([]model.MemoryItem, 0, len(payload.Preferences)+len(payload.Facts))

	for _, p := range payload.Preferences {
		fact := strings.TrimSpace(p.Fact)
		if fact == "" {
			continue
		}
		newItems = append(newItems, model.SanitizeMemoryItem(model.MemoryItem{
			Fact:       fact,
			Category:   model.CategoryPreference,
			Source:     "inference",
			Tags:       strings.Join(p.Tags, ","),
			Keywords:   strings.Join(p.Keywords, ","),
			Topic:      strings.TrimSpace(p.Topic),
			MemoryType: model.NormalizeMemoryType(p.MemoryType, model.CategoryPreference),
			Evidence:   strings.TrimSpace(p.Evidence),
			ExpireAt:   p.ExpireAt,
			Weight:     p.Weight,
			Time:       now,
		}))
	}
	for _, f := range payload.Facts {
		fact := strings.TrimSpace(f.Fact)
		if fact == "" {
			continue
		}
		newItems = append(newItems, model.SanitizeMemoryItem(model.MemoryItem{
			Fact:       fact,
			Category:   model.CategoryFact,
			Source:     "inference",
			Tags:       strings.Join(f.Tags, ","),
			Keywords:   strings.Join(f.Keywords, ","),
			Topic:      strings.TrimSpace(f.Topic),
			MemoryType: model.NormalizeMemoryType(f.MemoryType, model.CategoryFact),
			Evidence:   strings.TrimSpace(f.Evidence),
			ExpireAt:   f.ExpireAt,
			Weight:     f.Weight,
			Time:       now,
		}))
	}

	// 解析 tool_lessons
	var toolLessonItems []model.ToolLessonItem
	for _, tl := range payload.ToolLessons {
		fact := strings.TrimSpace(tl.Fact)
		if fact == "" {
			continue
		}
		toolLessonItems = append(toolLessonItems, model.ToolLessonItem{
			ToolName: strings.TrimSpace(tl.Topic),
			Lesson:   fact,
			Success:  true,
			Time:     now,
		})
	}

	return &compressResult{
		NewItems:        newItems,
		ToolLessonItems: toolLessonItems,
		MemoryActions:   append(payload.ExistingMemoryItems, append(collectTaggedMemoryActions(payload.Preferences), collectTaggedMemoryActions(payload.Facts)...)...),
	}
}

func collectTaggedMemoryActions(items []taggedMemoryItem) []existingMemoryAction {
	actions := make([]existingMemoryAction, 0)
	for _, item := range items {
		action := strings.TrimSpace(item.Action)
		if !strings.EqualFold(action, "archive") && !strings.EqualFold(action, "replace") {
			continue
		}
		targets := append([]string{}, item.ReplacedFacts...)
		if strings.TrimSpace(item.ReplaceFact) != "" {
			targets = append(targets, item.ReplaceFact)
		}
		for _, target := range targets {
			target = strings.TrimSpace(target)
			if target == "" {
				continue
			}
			actions = append(actions, existingMemoryAction{
				Fact:        target,
				Action:      "archive",
				Reason:      "新记忆替代旧条目",
				ReplaceFact: item.Fact,
			})
		}
	}
	return actions
}

// triggerTopicMergeAsync 异步检查 Topic 并在必要时触发融合
// 触发条件：某 Topic 下条目数 >1（2 条及以上即合并）
func (s *AgentMemoryCompressService) triggerTopicMergeAsync(ctx context.Context, eid, agentID, userID int64) {
	if s.contentGenService == nil {
		return
	}

	agent, err := model.GetAgentByID(eid, agentID)
	if err != nil || agent == nil {
		logger.Warnf(ctx, "【Topic融合】获取智能体失败: eid=%d, agent_id=%d, err=%v", eid, agentID, err)
		return
	}

	memory, err := model.GetAgentUserMemory(eid, agentID, userID)
	if err != nil || memory == nil {
		return
	}

	items, err := memory.GetItems()
	if err != nil || len(items) == 0 {
		return
	}

	// 按 Topic 分组
	topicGroups := groupByTopic(items)
	for topic, groupItems := range topicGroups {
		if len(groupItems) > 1 {
			logger.Infof(ctx, "【Topic融合】触发二级压缩: eid=%d, agent_id=%d, user_id=%d, topic_len=%d, 条目数=%d",
				eid, agentID, userID, len(topic), len(groupItems))
			if err := s.mergeTopicGroup(ctx, agent, userID, topic, groupItems); err != nil {
				logger.Warnf(ctx, "【Topic融合】失败: eid=%d, agent_id=%d, user_id=%d, topic_len=%d, err=%v",
					eid, agentID, userID, len(topic), err)
			}
		}
	}
}

// groupByTopic 按 Topic 字段分组记忆条目
func groupByTopic(items []model.MemoryItem) map[string][]model.MemoryItem {
	groups := make(map[string][]model.MemoryItem)
	for _, item := range items {
		topic := strings.TrimSpace(item.Topic)
		if topic == "" {
			continue
		}
		groups[topic] = append(groups[topic], item)
	}
	return groups
}

// mergeTopicGroup 对同一 Topic 的多条记忆调用 LLM 融合为一条
func (s *AgentMemoryCompressService) mergeTopicGroup(ctx context.Context, agent *model.Agent, userID int64, topic string, items []model.MemoryItem) error {
	if len(items) <= 1 {
		return nil
	}

	channel, modelName, err := resolveAgentChannel(ctx, agent)
	if err != nil {
		return err
	}

	// 构建融合 prompt
	systemPrompt := buildTopicMergePrompt(topic, items)
	request := &relaymodel.GeneralOpenAIRequest{
		Model:       modelName,
		Messages:    []relaymodel.Message{{Role: "user", Content: "请将以上记忆融合为一条更完整准确的记忆"}},
		MaxTokens:   512,
		Temperature: float64Ptr(0.3),
		Stream:      false,
	}
	request.Messages = append([]relaymodel.Message{{Role: "system", Content: systemPrompt}}, request.Messages...)

	resp, err, openAIErr := s.contentGenService.TestChannel(ctx, channel, request)
	if err != nil || openAIErr != nil {
		return fmt.Errorf("Topic 融合 LLM 调用失败: err=%v, openai_err=%v", err, openAIErr)
	}

	// 解析融合结果
	mergedItem := parseTopicMergeResponse(ctx, resp, topic, items[0].Category, selectTopicMemoryType(items))
	if mergedItem == nil {
		return nil
	}
	mergedItem.Source = "inference"

	// 持久化：将原条目归档，新增融合条目
	return s.persistTopicMerge(ctx, agent, userID, items, mergedItem)
}

// buildTopicMergePrompt 构建 Topic 融合的 System Prompt
// persistTopicMerge 持久化 Topic 融合结果：归档原条目，新增融合条目
func (s *AgentMemoryCompressService) persistTopicMerge(ctx context.Context, agent *model.Agent, userID int64, originalItems []model.MemoryItem, mergedItem *model.MemoryItem) error {
	now := time.Now().UnixMilli()
	var lastErr error
	const maxRetries = 3
	backoff := 5 * time.Millisecond

	for attempt := 0; attempt < maxRetries; attempt++ {
		memory, err := model.GetAgentUserMemory(agent.Eid, agent.AgentID, userID)
		if err != nil {
			return err
		}
		if memory == nil {
			return nil
		}

		baselineVersion := memory.Version
		rawItems, err := model.ParseItemsJSON(string(memory.Items))
		if err != nil {
			return err
		}
		items, archivedItems := splitActiveAndArchivedMemoryItems(rawItems, now)

		// 构建归档的 fact 集合
		archiveFacts := make(map[string]bool, len(originalItems))
		for _, item := range originalItems {
			archiveFacts[strings.ToLower(strings.TrimSpace(item.Fact))] = true
		}

		// 归档原条目
		for i := range items {
			if archiveFacts[strings.ToLower(strings.TrimSpace(items[i].Fact))] {
				items[i].ExpireAt = now
			}
		}

		// 新增融合条目，并保留既有归档条目
		items = append(items, *mergedItem)
		items = append(items, archivedItems...)

		if err := persistMemoryItemsWithArchived(memory, items, now); err != nil {
			return err
		}
		memory.Version = baselineVersion
		err = memory.Update()
		if err == nil {
			logger.Infof(ctx, "【Topic融合】持久化完成: eid=%d, agent_id=%d, user_id=%d, topic_len=%d, 融合条目长度=%d",
				agent.Eid, agent.AgentID, userID, len(mergedItem.Topic), len(mergedItem.Fact))
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		lastErr = err
		time.Sleep(backoff)
		backoff *= 2
	}
	return lastErr
}

// extractSessionID 从消息列表中提取会话 ID（取最后一条消息的 ConversationID）
func (s *AgentMemoryCompressService) extractSessionID(messages []*model.Message) string {
	if len(messages) == 0 {
		return ""
	}
	latest := messages[len(messages)-1]
	if latest == nil || latest.ConversationID <= 0 {
		return ""
	}
	return fmt.Sprintf("%d", latest.ConversationID)
}

// extractConversationText 从消息列表中提取纯文本对话内容，用于沟通对象保留
func extractConversationText(messages []*model.Message) string {
	if len(messages) == 0 {
		return ""
	}
	var parts []string
	for _, msg := range messages {
		if msg == nil {
			continue
		}
		content := strings.TrimSpace(msg.Message)
		if content != "" {
			parts = append(parts, content)
		}
		content = strings.TrimSpace(msg.Answer)
		if content != "" {
			parts = append(parts, content)
		}
	}
	return strings.Join(parts, "\n")
}

// float64Ptr 辅助函数：将 float64 转为 *float64
func float64Ptr(v float64) *float64 {
	return &v
}
