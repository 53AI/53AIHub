package service

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/rag"
	relaymodel "github.com/songquanpeng/one-api/relay/model"
)

// ConversationSummaryService 会话持久化增量摘要服务 (Phase 2A)。
//
// 目标：解决探讨会话超过 4 轮硬截断后早期内容丢失的问题。
// 核心流程：
//  1. 每次正常回复落库后，异步触发 EnsureSummaryUpToDate；
//  2. 读取已有摘要 + 游标（covered_through_message_id）之后新落库的消息；
//  3. 调用 LLM 增量重写摘要（保留主题/事实/判断/决策/数值/实体/未决问题/引用）；
//  4. 乐观锁（summary_version）原子推进游标；并发冲突自动重读重试；
//  5. 失败只记录 last_error 与 status=failed，绝不阻塞正常聊天；后续轮次安全重试。
type ConversationSummaryService struct {
	contentGenService *rag.ContentGeneratorService
}

// NewConversationSummaryService 创建会话摘要服务
func NewConversationSummaryService() *ConversationSummaryService {
	svc := &ConversationSummaryService{}
	if model.DB != nil {
		svc.contentGenService = rag.NewContentGeneratorService(model.DB)
	}
	return svc
}

// ShouldMaintainConversationSummary 为持续聊天类 Agent 维护会话历史摘要。
func ShouldMaintainConversationSummary(agent *model.Agent) bool {
	if agent == nil {
		return false
	}
	switch agent.AgentUsage {
	case model.AgentUsageRecording, model.AgentUsageSearch, model.AgentUsageFileChat,
		model.AgentUsageWorkAI, model.AgentUsageHub:
		return true
	}
	return false
}

// EnsureSummaryUpToDate 增量推进指定会话的摘要。
// 幂等：游标只前进不后退；并发安全：乐观锁 version 冲突时重读重试。
// 不阻塞调用方（由调用方异步触发，内部所有失败仅记日志）。
func (s *ConversationSummaryService) EnsureSummaryUpToDate(ctx context.Context, eid, conversationID, userID, agentID int64) {
	s.ensureSummaryUpToDate(ctx, eid, conversationID, userID, agentID, 0)
}

func (s *ConversationSummaryService) ensureSummaryUpToDate(ctx context.Context, eid, conversationID, userID, agentID int64, retry int) {
	if conversationID <= 0 || userID <= 0 {
		return
	}
	if s.contentGenService == nil {
		logger.Warnf(ctx, "【会话摘要】内容生成服务未初始化（DB不可用），跳过: conversation_id=%d", conversationID)
		return
	}

	// 读取当前摘要与游标
	summaryRow, err := model.GetConversationSummary(eid, conversationID)
	if err != nil {
		logger.Warnf(ctx, "【会话摘要】读取摘要记录失败: conversation_id=%d, err=%v", conversationID, err)
		return
	}

	var existingSummary string
	var expectedVersion int64
	var cursor int64
	var previouslySkippedIDs []int64
	if summaryRow != nil {
		existingSummary = summaryRow.Summary
		expectedVersion = summaryRow.SummaryVersion
		cursor = summaryRow.CoveredThroughMessageID
		previouslySkippedIDs = parseIDList(summaryRow.SkippedMessageIDs)
	}

	// 补偿机制 (Phase 2A.2 Slice 2): 核对历史跳过的消息，若现已完成则按时序回填摘要重写
	var compensatedMessages []*model.Message
	var remainingSkippedIDs []int64
	if len(previouslySkippedIDs) > 0 {
		var candidateMsgs []*model.Message
		_ = model.DB.WithContext(ctx).
			Where("eid = ? AND id IN ?", eid, previouslySkippedIDs).
			Order("id ASC").
			Find(&candidateMsgs).Error
		for _, cm := range candidateMsgs {
			if cm.ResponseStatus == 1 && strings.TrimSpace(cm.Answer) != "" {
				compensatedMessages = append(compensatedMessages, cm)
				logger.Infof(ctx, "【会话摘要-补偿机制】曾跳过消息现已完成，纳入回填摘要: conversation_id=%d, msg_id=%d", conversationID, cm.ID)
			} else {
				remainingSkippedIDs = append(remainingSkippedIDs, cm.ID)
			}
		}
	}
	// 拉取游标之后已落库的新消息（上限 100 条，防止一次性超长）
	// 首次生成和增量推进统一按 message ID 排序，避免相同 created_time 下水位线跳跃。
	freshMessages, err := model.GetMessagesByConversationIDWithDirectionAfter(eid, conversationID, cursor, 100, "asc")
	if err != nil {
		logger.Warnf(ctx, "【会话摘要】拉取新消息失败: conversation_id=%d, err=%v", conversationID, err)
		return
	}

	// 过滤掉无实际对话内容的消息
	filtered := make([]*model.Message, 0, len(freshMessages))
	for _, m := range freshMessages {
		if m == nil {
			continue
		}
		if strings.TrimSpace(m.Message) != "" || strings.TrimSpace(m.Answer) != "" {
			filtered = append(filtered, m)
		}
	}
	if len(filtered) == 0 {
		return
	}

	// 连续已完成水位线机制 (Continuous Completed High-Water Mark, Phase 2A.1):
	// 从当前游标后第一条消息按序遍历，只能推进到首个未完成消息之前的连续已完成节点；
	// 若遇到未完成消息：
	//  - 若属于在途消息（创建时间距今 <= 3分钟）：停止推进，留待下次该消息完成后连同后续一并处理，防止越过丢消息；
	//  - 若属于长期挂死/失败消息（创建时间距今 > 3分钟 或 ResponseStatus==2）：标记为废弃跳过点，允许水位线安全越过，防止死节点永久卡死摘要。
	const inProgressTimeoutMs = int64(3 * 60 * 1000)
	nowMs := time.Now().UnixMilli()

	complete := make([]*model.Message, 0, len(filtered))
	var lastMessageID int64
	var lastMessageTime int64

	for _, m := range filtered {
		isCompleted := m.ResponseStatus == 1 && strings.TrimSpace(m.Answer) != ""
		if isCompleted {
			complete = append(complete, m)
			lastMessageID = m.ID
			lastMessageTime = m.CreatedTime
			continue
		}

		// 检查关联的 AgentRun 是否真正仍在运行中 (Phase 2A.2 Slice 1)
		isStillRunning := false
		if strings.TrimSpace(m.RequestId) != "" {
			if run, rErr := model.GetAgentRunByRequestID(eid, m.RequestId); rErr == nil && run != nil {
				if run.Status == model.AgentRunStatusRunning || run.Status == model.AgentRunStatusQueued || run.Status == model.AgentRunStatusRequiresAction {
					isStillRunning = true
				}
			}
		}

		// 若 AgentRun 明确在运行中，或时间距今 <= 3分钟且非明确拒绝失败：判定为在途中，阻断推进！
		isRecentInProgress := isStillRunning || ((nowMs-m.CreatedTime) < inProgressTimeoutMs && m.ResponseStatus != model.ResponseStatusReject)
		if isRecentInProgress {
			logger.Infof(ctx, "【会话摘要-水位线】遇到在途中消息，停止推进游标以防遗漏: conversation_id=%d, in_progress_msg_id=%d, is_running=%v", conversationID, m.ID, isStillRunning)
			break
		}

		// 超过超时门限仍未完成，或已明确拒绝/失败：作为跳过点，记录告警并允许水位线越过
		logger.Warnf(ctx, "【会话摘要-水位线】遇到挂死/失败消息，记录到跳过列表并越过: conversation_id=%d, skipped_msg_id=%d, status=%d", conversationID, m.ID, m.ResponseStatus)
		remainingSkippedIDs = append(remainingSkippedIDs, m.ID)
		lastMessageID = m.ID
		lastMessageTime = m.CreatedTime
	}

	// 合并补偿消息与新完成消息，按时序排序
	allToSummarize := mergeAndSortMessages(compensatedMessages, complete)
	if len(allToSummarize) == 0 {
		return
	}
	// 组装 LLM 请求（已有摘要 + 新增未覆盖消息 → 新摘要）
	channel, modelName, err := s.resolveSummaryChannel(ctx, eid, agentID)
	if err != nil {
		logger.Warnf(ctx, "【会话摘要】解析执行渠道失败: conversation_id=%d, err=%v", conversationID, err)
		return
	}

	systemPrompt := s.buildSummarySystemPrompt()
	userPrompt := s.buildSummaryUserPrompt(existingSummary, allToSummarize)

	request := &relaymodel.GeneralOpenAIRequest{
		Model:       modelName,
		Messages:    []relaymodel.Message{{Role: "system", Content: systemPrompt}, {Role: "user", Content: userPrompt}},
		Temperature: float64Ptr(0.2),
		Stream:      false,
	}

	resp, err, openAIErr := s.contentGenService.TestChannel(ctx, channel, request)
	if err != nil || openAIErr != nil {
		msg := "unknown error"
		if err != nil {
			msg = err.Error()
		} else if openAIErr != nil {
			msg = openAIErr.Message
		}
		_ = model.MarkConversationSummaryFailed(eid, conversationID, msg)
		logger.Warnf(ctx, "【会话摘要】LLM 生成失败: conversation_id=%d, err=%s", conversationID, msg)
		return
	}

	summary := strings.TrimSpace(resp)
	if summary == "" {
		logger.Warnf(ctx, "【会话摘要】LLM 返回空摘要，跳过推进: conversation_id=%d", conversationID)
		return
	}

	// 控长与精简重压机制 (Phase 2A.1):
	// 严格控制在 4000 字符内；超限时触发 LLM 精简重压，压缩背景但保留核心决策/事实/数值/未决事项。
	// 若重压依然超标或重压失败，绝不截断末尾最新决策！放弃推进游标，保留既有有效旧摘要。
	const maxSummaryLength = 4000
	if len([]rune(summary)) > maxSummaryLength {
		logger.Warnf(ctx, "【会话摘要-控长】摘要超出字符上限 (%d 字符)，触发精简重压: conversation_id=%d", len([]rune(summary)), conversationID)
		recompressed, reErr := s.recompressSummary(ctx, channel, modelName, summary)
		if reErr == nil && len([]rune(recompressed)) <= maxSummaryLength && len(strings.TrimSpace(recompressed)) > 0 {
			summary = recompressed
			logger.Infof(ctx, "【会话摘要-控长】精简重压成功: conversation_id=%d, 新长度=%d", conversationID, len([]rune(summary)))
		} else {
			msg := fmt.Sprintf("摘要超限且重压失败: 原始长度=%d", len([]rune(summary)))
			if reErr != nil {
				msg += fmt.Sprintf(", err=%v", reErr)
			}
			_ = model.MarkConversationSummaryFailed(eid, conversationID, msg)
			logger.Warnf(ctx, "【会话摘要-控长】放弃推进游标以防丢弃尾部最新决策: conversation_id=%d, err=%s", conversationID, msg)
			return
		}
	}

	// 乐观锁推进游标；冲突时必须重读最新摘要并重新生成，不能把基于旧摘要的结果直接覆写。
	nowMs = time.Now().UnixMilli()
	skippedSerialized := formatIDList(remainingSkippedIDs)
	ok, upErr := model.UpsertConversationSummaryWithVersion(eid, conversationID, userID, agentID, summary, lastMessageID, expectedVersion, nowMs, skippedSerialized)
	if upErr != nil {
		logger.Warnf(ctx, "【会话摘要】摘要落库失败: conversation_id=%d, err=%v", conversationID, upErr)
		return
	}
	if !ok {
		// 并发冲突：重读最新行，若游标已被推进则放弃（新摘要已生成）
		latest, reErr := model.GetConversationSummary(eid, conversationID)
		if reErr != nil {
			logger.Warnf(ctx, "【会话摘要】并发冲突后重读失败: conversation_id=%d, err=%v", conversationID, reErr)
			return
		}
		if latest != nil && latest.CoveredThroughMessageID >= lastMessageID {
			logger.Infof(ctx, "【会话摘要】并发冲突，游标已被其他任务推进，跳过: conversation_id=%d, latest_cursor=%d", conversationID, latest.CoveredThroughMessageID)
			return
		}
		if retry < 2 {
			logger.Infof(ctx, "【会话摘要】版本冲突，基于最新摘要重新生成：会话%d，第%d次重试", conversationID, retry+1)
			s.ensureSummaryUpToDate(ctx, eid, conversationID, userID, agentID, retry+1)
		} else {
			logger.Warnf(ctx, "【会话摘要】版本冲突重试耗尽，会话%d后续执行可继续补偿", conversationID)
		}
		return
	}

	logger.Infof(ctx, "【会话摘要】摘要推进完成: conversation_id=%d, version=%d, cursor=%d, last_message_time=%d, new_messages=%d",
		conversationID, expectedVersion+1, lastMessageID, lastMessageTime, len(complete))
}

// resolveSummaryChannel 复用与记忆压缩一致的渠道解析：fast_reasoning_config → agent 默认渠道
func (s *ConversationSummaryService) resolveSummaryChannel(ctx context.Context, eid, agentID int64) (*model.Channel, string, error) {
	agent, err := model.GetAgentByID(eid, agentID)
	if err != nil {
		return nil, "", fmt.Errorf("获取 Agent 信息失败: %w", err)
	}
	return resolveAgentChannel(ctx, agent)
}

// buildSummarySystemPrompt 构建增量会话摘要系统提示词
func (s *ConversationSummaryService) buildSummarySystemPrompt() string {
	return `你是一位专业的会话上下文摘要助手，负责维护长对话的**增量会话摘要**。

要求：
1. 将【已有摘要】、【可能包含的延迟回填历史消息】与【新增对话】合并重写为一份新的精简摘要（不是简单追加，是整体重写更新）。
2. 冲突裁决与证据规则（极其重要，严格遵守）：
   - 当用户明确更新或修正自己的判断、意图、约束或决定时，以最新明确表达为准（新判断覆盖旧判断）；
   - 涉及外部客观事实（如合同金额、客户原话、财务数字、交付数据）时，必须保留不同来源和证据，严禁因随口表述单向覆盖已核实的事实；
   - 发生无法裁决的客观事实矛盾时，必须在摘要中列出冲突点（例如"华东报价：合同记录为100万，第15轮讨论中提及120万，待核实"），供后续查证；
   - 严禁把 AI 的推测或建议写成用户已确认的决定！
3. 必须保留：
   - 讨论主题与背景；
   - 已明确事实及业务背景；
   - 用户明确作出的判断和决策；
   - 关键数值与实体（客户/金额/时间/责任人）；
   - 尚未解决的问题与待办；
   - 必要时的原始消息引用（保留可回溯表述，不编造引用）。
4. 严格控制在 800-2000 字内，硬上限绝不超过 3500 字。
5. 只输出摘要正文，不要输出任何解释说明。`
}

// buildSummaryUserPrompt 组装「已有摘要 + 新增消息」输入
func (s *ConversationSummaryService) buildSummaryUserPrompt(existingSummary string, freshMessages []*model.Message) string {
	var sb strings.Builder

	sb.WriteString("### 已有摘要\n")
	if strings.TrimSpace(existingSummary) == "" {
		sb.WriteString("（暂无摘要）\n")
	} else {
		sb.WriteString(existingSummary)
		sb.WriteString("\n")
	}

	sb.WriteString("\n### 新增对话\n")
	for _, m := range freshMessages {
		q := strings.TrimSpace(m.Message)
		a := strings.TrimSpace(m.Answer)
		if q != "" {
			sb.WriteString(fmt.Sprintf("[用户] %s\n", truncateSummarySegment(q, 600)))
		}
		if a != "" {
			sb.WriteString(fmt.Sprintf("[助手] %s\n", truncateSummarySegment(a, 1200)))
		}
	}

	return sb.String()
}

// recompressSummary 对超限摘要执行精简重压 (Phase 2A.1)
func (s *ConversationSummaryService) recompressSummary(ctx context.Context, channel *model.Channel, modelName string, rawSummary string) (string, error) {
	recompressSystemPrompt := `你是一位专业的精简摘要提炼专家。当前会话摘要篇幅超出上限，请对其进行紧凑压缩。
必须严格遵守：
1. 压缩背景与过程描述，但【绝对完整保留】所有已确定的经营事实、老板作出的关键决策与最新结论、关键数值（金额/比例/时间）与未解决事项。
2. 绝对不能丢弃文末最新的决策和行动项。
3. 严格控制在 1000-2000 字以内，字数绝不超过 3500 字。
4. 只输出压缩后的精简摘要正文，严禁输出任何解释说明。`

	request := &relaymodel.GeneralOpenAIRequest{
		Model: modelName,
		Messages: []relaymodel.Message{
			{Role: "system", Content: recompressSystemPrompt},
			{Role: "user", Content: fmt.Sprintf("请压缩以下摘要：\n\n%s", rawSummary)},
		},
		Temperature: float64Ptr(0.1),
		Stream:      false,
	}

	resp, err, openAIErr := s.contentGenService.TestChannel(ctx, channel, request)
	if err != nil {
		return "", err
	}
	if openAIErr != nil {
		return "", fmt.Errorf("LLM error: %s", openAIErr.Message)
	}
	return strings.TrimSpace(resp), nil
}
func truncateSummarySegment(text string, maxRunes int) string {
	runes := []rune(text)
	if len(runes) <= maxRunes {
		return text
	}
	return string(runes[:maxRunes])
}

// shouldGenerateConversationSummary 仅在尚未纳入摘要的对话超过近期原文窗口时生成。
func shouldGenerateConversationSummary(eid, conversationID int64) bool {
	row, err := model.GetConversationSummary(eid, conversationID)
	if err != nil {
		return false
	}
	var cursor int64
	if row != nil {
		cursor = row.CoveredThroughMessageID
	}
	var count int64
	err = model.DB.Model(&model.Message{}).
		Where("eid = ? AND conversation_id = ? AND id > ?", eid, conversationID, cursor).
		Count(&count).Error
	return err == nil && count > 4
}

// TriggerConversationSummaryAsync 异步触发摘要维护（不阻塞正常回复流程）。
func TriggerConversationSummaryAsync(ctx context.Context, eid, conversationID, userID, agentID int64) {
	if !shouldGenerateConversationSummary(eid, conversationID) {
		return
	}
	go func() {
		summaryCtx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
		defer cancel()
		svc := NewConversationSummaryService()
		svc.EnsureSummaryUpToDate(summaryCtx, eid, conversationID, userID, agentID)
	}()
	_ = ctx
}

var _ = common.ParseLLMJSONInto // keep import
func parseIDList(raw string) []int64 {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	var ids []int64
	for _, p := range parts {
		var id int64
		if _, err := fmt.Sscanf(strings.TrimSpace(p), "%d", &id); err == nil && id > 0 {
			ids = append(ids, id)
		}
	}
	return ids
}

func formatIDList(ids []int64) string {
	if len(ids) == 0 {
		return ""
	}
	parts := make([]string, len(ids))
	for i, id := range ids {
		parts[i] = fmt.Sprintf("%d", id)
	}
	return strings.Join(parts, ",")
}

func mergeAndSortMessages(a, b []*model.Message) []*model.Message {
	seen := make(map[int64]bool)
	var merged []*model.Message
	for _, m := range append(a, b...) {
		if m != nil && !seen[m.ID] {
			seen[m.ID] = true
			merged = append(merged, m)
		}
	}
	sort.SliceStable(merged, func(i, j int) bool {
		return merged[i].ID < merged[j].ID
	})
	return merged
}
