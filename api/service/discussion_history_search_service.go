package service

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"unicode"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
)

// DiscussionHistorySearchParams 跨会话历史探讨检索参数 (Phase 2B)
type DiscussionHistorySearchParams struct {
	Eid                   int64   `json:"eid"`
	UserID                int64   `json:"user_id"`
	AgentID               int64   `json:"agent_id"`
	CurrentConversationID int64   `json:"current_conversation_id"`
	Query                 string  `json:"query"`
	ConversationIDs       []int64 `json:"conversation_ids"`
	TimeRangeStart        int64   `json:"time_range_start"`
	TimeRangeEnd          int64   `json:"time_range_end"`
	Limit                 int     `json:"limit"`
}

// DiscussionHistoryHit 单条历史检索命中项
type DiscussionHistoryHit struct {
	ConversationID    int64  `json:"conversation_id"`
	ConversationTitle string `json:"conversation_title"`
	CreatedAt         int64  `json:"created_at"`
	HitType           string `json:"hit_type"` // "summary" | "message"
	MessageID         int64  `json:"message_id,omitempty"`
	Role              string `json:"role,omitempty"`
	MatchedExcerpt    string `json:"matched_excerpt"`
	ContextWindow     string `json:"context_window,omitempty"`
	SourceReference   string `json:"source_reference"`
}

// DiscussionHistorySearchResult 跨会话历史检索结果
type DiscussionHistorySearchResult struct {
	Query      string                 `json:"query"`
	Hits       []DiscussionHistoryHit `json:"hits"`
	TotalHits  int                    `json:"total_hits"`
	IsDegraded bool                   `json:"is_degraded"`
	// IsFallback 表示本次结果来自「零命中后的受限回退检索」，证据强度较弱，
	// 调用方（Tool/模型）应据此说明依据不足，而不是当作强证据。
	IsFallback bool `json:"is_fallback"`
}

// DiscussionHistorySearchService 二号总裁探讨跨会话历史检索服务 (Phase 2B)
type DiscussionHistorySearchService struct{}

// 相关性判定统一走 ScoreCJKRelevance（service/cjk_relevance.go）：
// 旧实现用固定 bigram 覆盖率阈值（0.40 / 0.35）判活，会把「库里确实存在、
// 但问句较长导致覆盖率被稀释」的正确记录直接过滤掉（Phase 2E Slice 1 真实失败案例）。
// 现改为：覆盖率 + 精确业务词（最长公共连续片段）综合打分，并按查询长度自适应下限。
const historyFallbackLimit = 3 // 零命中时的受限回退条数上限

func NewDiscussionHistorySearchService() *DiscussionHistorySearchService {
	return &DiscussionHistorySearchService{}
}

// SearchHistory 执行跨会话历史检索：双层结构（会话摘要检索 + 原始消息全文回溯）。
// 安全原则：服务端严格按 (eid, user_id) 鉴权，自动排除已删除和未授权会话，严禁越权。
func (s *DiscussionHistorySearchService) SearchHistory(ctx context.Context, params DiscussionHistorySearchParams) (*DiscussionHistorySearchResult, error) {
	if params.Eid <= 0 || params.UserID <= 0 {
		return nil, fmt.Errorf("invalid tenant or user credentials")
	}

	rawQuery := strings.TrimSpace(params.Query)
	if rawQuery == "" {
		return &DiscussionHistorySearchResult{Query: rawQuery, TotalHits: 0}, nil
	}

	limit := params.Limit
	if limit <= 0 {
		limit = 5
	}
	if limit > 15 {
		limit = 15
	}

	// 1. 查找当前用户合法、活跃且未删除的探讨会话范围
	convQuery := model.DB.WithContext(ctx).Model(&model.Conversation{}).
		Where("eid = ? AND user_id = ? AND deleted_time = 0 AND status = ?",
			params.Eid, params.UserID, model.ConversationStatusActive)

	if params.CurrentConversationID > 0 {
		convQuery = convQuery.Where("conversation_id != ?", params.CurrentConversationID)
	}
	if params.TimeRangeStart > 0 {
		convQuery = convQuery.Where("created_time >= ?", params.TimeRangeStart)
	}
	if params.TimeRangeEnd > 0 {
		convQuery = convQuery.Where("created_time <= ?", params.TimeRangeEnd)
	}

	// 模型或客户端若传入指定 conversation_ids，服务端强制交集校验，过滤掉任何非法 ID
	if len(params.ConversationIDs) > 0 {
		convQuery = convQuery.Where("conversation_id IN ?", params.ConversationIDs)
	}

	var validConversations []model.Conversation
	if err := convQuery.Order("created_time DESC").Limit(50).Find(&validConversations).Error; err != nil {
		logger.Warnf(ctx, "【历史检索】查询有效会话失败: err=%v", err)
		return nil, err
	}
	if len(validConversations) == 0 {
		return &DiscussionHistorySearchResult{Query: rawQuery, TotalHits: 0}, nil
	}

	validConvIDs := make([]int64, len(validConversations))
	convMap := make(map[int64]model.Conversation, len(validConversations))
	for i, c := range validConversations {
		validConvIDs[i] = c.ConversationID
		convMap[c.ConversationID] = c
	}
	subQueries := splitMultiTopicQueries(rawQuery)
	var hits []DiscussionHistoryHit
	isFallback := false

	if len(subQueries) > 1 {
		logger.Infof(ctx, "【历史检索-多话题】检测到多话题组合检索: 子查询=%v", subQueries)
		perQueryLimit := limit / len(subQueries)
		if perQueryLimit < 2 {
			perQueryLimit = 2
		}
		seenHits := make(map[string]bool)
		for _, sq := range subQueries {
			subHits, subFallback := s.searchDualLayerSingleQuery(ctx, params.Eid, params.UserID, validConvIDs, convMap, sq, perQueryLimit)
			if subFallback {
				isFallback = true
			}
			for _, hit := range subHits {
				dedupKey := fmt.Sprintf("%d:%s:%d", hit.ConversationID, hit.HitType, hit.MessageID)
				if !seenHits[dedupKey] {
					seenHits[dedupKey] = true
					hits = append(hits, hit)
				}
			}
		}
	} else {
		var singleFallback bool
		hits, singleFallback = s.searchDualLayerSingleQuery(ctx, params.Eid, params.UserID, validConvIDs, convMap, rawQuery, limit)
		isFallback = singleFallback
	}
	logger.Infof(ctx, "【历史检索】检索完成: query=%q, 候选会话数=%d, 命中数=%d",
		rawQuery, len(validConvIDs), len(hits))

	return &DiscussionHistorySearchResult{
		Query:      rawQuery,
		Hits:       hits,
		TotalHits:  len(hits),
		IsDegraded: true,       // 降级为数据库全文检索（第一版不强制依赖 ES 消息索引）
		IsFallback: isFallback, // 零命中后走受限回退检索时为 true
	}, nil
}

// loadMessageNeighborContext 加载目标消息的前后各 1 轮原始对话作为上下文窗口
func (s *DiscussionHistorySearchService) loadMessageNeighborContext(ctx context.Context, eid, conversationID, messageID int64) string {
	var msgs []model.Message
	// 取当前消息及其前后邻近消息 (id 邻近)
	err := model.DB.WithContext(ctx).
		Where("eid = ? AND conversation_id = ? AND id >= ? AND id <= ?",
			eid, conversationID, messageID-1, messageID+1).
		Order("id ASC").
		Limit(3).
		Find(&msgs).Error
	if err != nil || len(msgs) == 0 {
		return ""
	}

	var sb strings.Builder
	for _, m := range msgs {
		if strings.TrimSpace(m.Message) != "" {
			sb.WriteString(fmt.Sprintf("[用户] %s\n", truncateText(m.Message, 150)))
		}
		if strings.TrimSpace(m.Answer) != "" {
			sb.WriteString(fmt.Sprintf("[助手] %s\n", truncateText(m.Answer, 250)))
		}
	}
	return strings.TrimSpace(sb.String())
}

func tokenizeHistorySearchTerms(query string) []string {
	var terms []string
	seen := make(map[string]bool)

	var cur strings.Builder
	for _, r := range query {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			cur.WriteRune(r)
		} else {
			if cur.Len() >= 2 {
				w := cur.String()
				if !seen[w] {
					seen[w] = true
					terms = append(terms, w)
				}
			}
			cur.Reset()
		}
	}
	if cur.Len() >= 2 {
		w := cur.String()
		if !seen[w] {
			seen[w] = true
			terms = append(terms, w)
		}
	}
	return terms
}

// charBigrams 生成字符串的连续 2 字符组（中文无分词场景下的标准近似检索单元）。
// 例："华南渠道账期" → [华南 南渠 渠道 道账 账期]
func charBigrams(text string) []string {
	runes := []rune(strings.TrimSpace(text))
	if len(runes) < 2 {
		return nil
	}
	seen := make(map[string]bool, len(runes))
	bigrams := make([]string, 0, len(runes))
	for i := 0; i+2 <= len(runes); i++ {
		bg := string(runes[i : i+2])
		if seen[bg] {
			continue
		}
		seen[bg] = true
		bigrams = append(bigrams, bg)
	}
	return bigrams
}

// bigramOverlapRatio 计算查询 n-gram 在内容中的覆盖率（0~1）。
func bigramOverlapRatio(content string, queryBigrams []string) float64 {
	if len(queryBigrams) == 0 {
		return 0
	}
	lower := strings.ToLower(content)
	hits := 0
	for _, bg := range queryBigrams {
		if strings.Contains(lower, strings.ToLower(bg)) {
			hits++
		}
	}
	return float64(hits) / float64(len(queryBigrams))
}

// firstMatchRunePos 返回首个命中 n-gram 的字符位置；-1 表示未命中。
func firstMatchRunePos(content string, queryBigrams []string) int {
	lower := strings.ToLower(content)
	bestByte := -1
	for _, bg := range queryBigrams {
		idx := strings.Index(lower, strings.ToLower(bg))
		if idx != -1 && (bestByte == -1 || idx < bestByte) {
			bestByte = idx
		}
	}
	if bestByte == -1 {
		return -1
	}
	return len([]rune(content[:bestByte]))
}

func extractMatchedExcerpt(content string, queryBigrams []string, maxLen int) string {
	clean := strings.TrimSpace(content)
	if len([]rune(clean)) <= maxLen {
		return clean
	}

	matchRunePos := firstMatchRunePos(clean, queryBigrams)
	if matchRunePos == -1 {
		return string([]rune(clean)[:maxLen]) + "..."
	}

	runes := []rune(clean)
	start := matchRunePos - 30
	if start < 0 {
		start = 0
	}
	end := start + maxLen
	if end > len(runes) {
		end = len(runes)
	}

	res := string(runes[start:end])
	if start > 0 {
		res = "..." + res
	}
	if end < len(runes) {
		res = res + "..."
	}
	return res
}

func truncateText(text string, maxRunes int) string {
	runes := []rune(strings.TrimSpace(text))
	if len(runes) <= maxRunes {
		return string(runes)
	}
	return string(runes[:maxRunes]) + "..."
}

// searchDualLayerSingleQuery 针对单一子查询执行双层检索（Layer 1 摘要 + Layer 2 消息上下文回溯）
func (s *DiscussionHistorySearchService) searchDualLayerSingleQuery(
	ctx context.Context,
	eid, userID int64,
	validConvIDs []int64,
	convMap map[int64]model.Conversation,
	query string,
	limit int,
) ([]DiscussionHistoryHit, bool) {
	// 中文无分词场景：以字符 n-gram（bigram）作为检索与相关性度量单元。
	// 先用任一 bigram 在 SQL 层做召回拓宽（避免多词概念整体 LIKE 不命中），
	// 再在应用层按 bigram 覆盖率排序与阈值过滤，兼顾召回率与精确率。
	queryBigrams := charBigrams(query)
	if len(queryBigrams) == 0 {
		queryBigrams = []string{query}
	}
	const maxSQLBigrams = 12
	sqlBigrams := queryBigrams
	if len(sqlBigrams) > maxSQLBigrams {
		sqlBigrams = sqlBigrams[:maxSQLBigrams]
	}

	var hits []DiscussionHistoryHit

	// Layer 1: 会话摘要检索 (Summary Search)
	candidateLimit := limit * 6
	if candidateLimit < 30 {
		candidateLimit = 30
	}
	var summaries []model.ConversationSummary
	summaryDB := model.DB.WithContext(ctx).Model(&model.ConversationSummary{}).
		Where("eid = ? AND user_id = ? AND conversation_id IN ?", eid, userID, validConvIDs).
		Where("status = ?", "completed")

	summaryConds := make([]string, 0, len(sqlBigrams))
	summaryArgs := make([]interface{}, 0, len(sqlBigrams))
	for _, bg := range sqlBigrams {
		summaryConds = append(summaryConds, "summary LIKE ?")
		summaryArgs = append(summaryArgs, "%"+bg+"%")
	}
	if len(summaryConds) > 0 {
		summaryDB = summaryDB.Where(strings.Join(summaryConds, " OR "), summaryArgs...)
	}
	// 候选池：用于「零命中后的受限回退」，同时承担精排序。
	// 注意：召回阶段（SQL）保持宽召回不变，判活/排序改由 ScoreCJKRelevance 负责。
	type histCandidate struct {
		kind    string // summary | message
		score   float64
		strong  bool
		summary model.ConversationSummary
		message model.Message
	}
	pool := make([]histCandidate, 0, 16)
	hitScore := make(map[string]float64, 16) // 命中键 -> 相关性分，用于排序（防止高分依据被挤掉）
	hitKey := func(hitType string, convID, msgID int64) string {
		return fmt.Sprintf("%s:%d:%d", hitType, convID, msgID)
	}

	buildSummaryHit := func(sm model.ConversationSummary) (DiscussionHistoryHit, bool) {
		conv, exists := convMap[sm.ConversationID]
		if !exists {
			return DiscussionHistoryHit{}, false
		}
		excerpt := extractMatchedExcerpt(conv.Title+"\n"+sm.Summary, queryBigrams, 240)
		refKey := fmt.Sprintf("[历史探讨: 会话#%d 摘要(v%d)]", sm.ConversationID, sm.SummaryVersion)
		return DiscussionHistoryHit{
			ConversationID:    sm.ConversationID,
			ConversationTitle: conv.Title,
			CreatedAt:         sm.CreatedTime,
			HitType:           "summary",
			MatchedExcerpt:    excerpt,
			SourceReference:   refKey,
		}, true
	}
	buildMessageHit := func(m model.Message) DiscussionHistoryHit {
		conv := convMap[m.ConversationID]
		fullText := m.Message + "\n" + m.Answer
		return DiscussionHistoryHit{
			ConversationID:    m.ConversationID,
			ConversationTitle: conv.Title,
			CreatedAt:         m.CreatedTime,
			HitType:           "message",
			MessageID:         m.ID,
			Role:              "assistant",
			MatchedExcerpt:    extractMatchedExcerpt(fullText, queryBigrams, 200),
			ContextWindow:     s.loadMessageNeighborContext(ctx, eid, m.ConversationID, m.ID),
			SourceReference:   fmt.Sprintf("[历史探讨: 会话#%d 消息#%d]", m.ConversationID, m.ID),
		}
	}

	// ---- Layer 1: 会话摘要检索 ----
	if err := summaryDB.Order("summary_version DESC, id DESC").Limit(candidateLimit).Find(&summaries).Error; err == nil {
		for _, sm := range summaries {
			// 摘要正文 + 会话标题共同参与相关性判定（标题常含精确业务主题词）
			haystack := sm.Summary
			if conv, ok := convMap[sm.ConversationID]; ok {
				haystack = conv.Title + "\n" + sm.Summary
			}
			rel := ScoreCJKRelevance(haystack, query)
			pool = append(pool, histCandidate{kind: "summary", score: rel.Score, strong: rel.Strong, summary: sm})
			if !rel.Relevant {
				continue
			}
			if hit, ok := buildSummaryHit(sm); ok {
				hitScore[hitKey("summary", sm.ConversationID, 0)] = rel.Score
				hits = append(hits, hit)
			}
		}
	}

	// ---- Layer 2: 原始消息检索与邻近上下文窗口 ----
	if len(hits) < limit {
		var messages []model.Message
		msgDB := model.DB.WithContext(ctx).Model(&model.Message{}).
			Where("eid = ? AND user_id = ? AND conversation_id IN ?", eid, userID, validConvIDs).
			Where("response_status = ?", 1)

		msgConds := make([]string, 0, len(sqlBigrams))
		msgArgs := make([]interface{}, 0, len(sqlBigrams)*2)
		for _, bg := range sqlBigrams {
			msgConds = append(msgConds, "(message LIKE ? OR answer LIKE ?)")
			msgArgs = append(msgArgs, "%"+bg+"%", "%"+bg+"%")
		}
		if len(msgConds) > 0 {
			msgDB = msgDB.Where(strings.Join(msgConds, " OR "), msgArgs...)
		}
		if err := msgDB.Order("id DESC").Limit(candidateLimit).Find(&messages).Error; err == nil {
			for _, m := range messages {
				fullText := m.Message + "\n" + m.Answer
				rel := ScoreCJKRelevance(fullText, query)
				pool = append(pool, histCandidate{kind: "message", score: rel.Score, strong: rel.Strong, message: m})
				if !rel.Relevant {
					continue
				}
				hitScore[hitKey("message", m.ConversationID, m.ID)] = rel.Score
				hits = append(hits, buildMessageHit(m))
			}
		}
	}

	// 精排序：相关性分优先，其次新近优先。
	// 注意：不能只按时间排序——否则「命中精确业务词」的高分摘要会被一堆低分消息挤掉。
	sort.SliceStable(hits, func(i, j int) bool {
		si := hitScore[hitKey(hits[i].HitType, hits[i].ConversationID, hits[i].MessageID)]
		sj := hitScore[hitKey(hits[j].HitType, hits[j].ConversationID, hits[j].MessageID)]
		if si != sj {
			return si > sj
		}
		// 同分时：已沉淀的会话摘要（结论层）优先于原始消息（过程层），
		// 否则结论性依据会被多轮过程消息挤掉 TopK。
		if hits[i].HitType != hits[j].HitType {
			return hits[i].HitType == "summary"
		}
		return hits[i].CreatedAt > hits[j].CreatedAt
	})
	if len(hits) > limit {
		hits = hits[:limit]
	}

	// ---- 零命中后的受限回退检索（有界：条数上限 + 不改变权限范围）----
	if len(hits) == 0 && len(pool) > 0 {
		sort.SliceStable(pool, func(i, j int) bool {
			if pool[i].score != pool[j].score {
				return pool[i].score > pool[j].score
			}
			if pool[i].strong != pool[j].strong {
				return pool[i].strong
			}
			return true
		})
		for _, c := range pool {
			if len(hits) >= historyFallbackLimit {
				break
			}
			if c.score <= 0 {
				continue
			}
			if c.kind == "summary" {
				if hit, ok := buildSummaryHit(c.summary); ok {
					hits = append(hits, hit)
				}
				continue
			}
			hits = append(hits, buildMessageHit(c.message))
		}
		if len(hits) > 0 {
			logger.Infof(ctx, "【历史检索-回退】零命中，返回受限回退结果: query=%q, 条数=%d", query, len(hits))
			return hits, true
		}
	}

	return hits, false
}

// splitMultiTopicQueries 将可能包含多话题/对比连接词的复合查询拆分为独立子查询
func splitMultiTopicQueries(rawQuery string) []string {
	q := strings.TrimSpace(rawQuery)
	if q == "" {
		return nil
	}

	for _, prefix := range []string{"请对比", "对比一下", "对比", "请比较", "比较一下", "比较", "查看之前的", "回忆一下", "分析一下"} {
		if strings.HasPrefix(q, prefix) {
			q = strings.TrimPrefix(q, prefix)
			break
		}
	}
	q = strings.TrimSpace(q)

	separators := []string{" 和 ", "与", "以及", "、", ";", "；", " vs ", " VS "}
	for _, sep := range separators {
		if strings.Contains(q, sep) {
			parts := strings.Split(q, sep)
			var subQueries []string
			for _, p := range parts {
				p = strings.TrimSpace(p)
				if len([]rune(p)) >= 2 {
					subQueries = append(subQueries, p)
				}
			}
			if len(subQueries) >= 2 {
				return subQueries
			}
		}
	}

	// 连字 "和" 无空格场景 (如 "华东报价和华南账期")
	if strings.Contains(q, "和") && !strings.Contains(q, "平和") && !strings.Contains(q, "和睦") {
		parts := strings.Split(q, "和")
		var subQueries []string
		for _, p := range parts {
			p = strings.TrimSpace(p)
			if len([]rune(p)) >= 2 {
				subQueries = append(subQueries, p)
			}
		}
		if len(subQueries) >= 2 {
			return subQueries
		}
	}

	return []string{rawQuery}
}
