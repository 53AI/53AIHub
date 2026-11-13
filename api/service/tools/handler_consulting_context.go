package tools

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
)

// 本文件实现二号总裁探讨 Agent 的经营认知 / 经营记忆只读查询 Tool (Phase 2C)。
//
// 失败处理契约（统一遵守）：
//   - 认证上下文缺失：返回受限提示，不返回业务数据，不以 error 中断对话；
//   - 参数缺失/非法：limit 收敛到合法区间；query 为空返回提示；非法过滤值忽略；
//   - 无数据：明确返回「未找到…」，绝不编造；
//   - 服务/数据库错误：返回「查询暂时不可用」，与「无数据」严格区分，避免模型据此推断“不存在”；
//   - 超预算：按相关性截断并显式标注；
//   - 越权：服务端强制 owner 过滤，绝不因模型传入参数而放宽。

const (
	cognitionToolMaxChars = 4000
	memoryToolMaxChars    = 4000
	consultingToolMaxHits = 10
)

// consultingToolAuth 提取并校验服务端认证上下文，并在**执行入口**做纵深授权校验：
// 仅规范的系统探讨 Agent 实例可调用经营 Tool（模型无法通过任何参数影响该判定）。
func consultingToolAuth(ctx context.Context) (eid, userID int64, ok bool) {
	eid, _ = ctx.Value(ToolEIDKey).(int64)
	userID, _ = ctx.Value(ToolUserIDKey).(int64)
	if eid <= 0 || userID <= 0 {
		return eid, userID, false
	}
	agentID, _ := ctx.Value(ToolAgentIDKey).(int64)
	if err := service.AuthorizeDiscussionToolCall(ctx, eid, agentID); err != nil {
		logger.Warnf(ctx, "【经营上下文Tool】工具执行入口授权失败: eid=%d, user_id=%d, agent_id=%d, err=%v", eid, userID, agentID, err)
		return eid, userID, false
	}
	return eid, userID, true
}

// clampConsultingLimit 收敛 limit 到 [1, consultingToolMaxHits]。
func clampConsultingLimit(limit int, def int) int {
	if limit <= 0 {
		limit = def
	}
	if limit > consultingToolMaxHits {
		limit = consultingToolMaxHits
	}
	return limit
}

// truncateConsultingOutput 应用字符预算；超限时显式标注截断，避免模型误以为是完整结果。
func truncateConsultingOutput(sb *strings.Builder) string {
	out := strings.TrimSpace(sb.String())
	if len([]rune(out)) <= memoryToolMaxChars {
		return out
	}
	runes := []rune(out)
	return string(runes[:memoryToolMaxChars]) + "\n\n（结果已按相关性截断，未展示全部条目）"
}

// consultingToolRestrictedOutput 认证缺失时的受限提示。
func consultingToolRestrictedOutput() *ToolResult {
	return &ToolResult{
		Output:   "查询受限：未检测到合法的用户认证上下文，无法访问经营认知或经营记忆。",
		ExitCode: 0,
	}
}

// cjkRecallKeywords 生成中文召回关键词候选：原始查询 + 查询 bigram（用于 SQL LIKE 拓宽）。
// 中文无分词，整体 LIKE「现金流 账期」不会命中「现金流优先原则」，必须用 n-gram 拓宽。
func cjkRecallKeywords(query string, max int) []string {
	query = strings.TrimSpace(query)
	if query == "" {
		return nil
	}
	seen := map[string]bool{query: true}
	out := []string{query}

	runes := []rune(query)
	for i := 0; i+2 <= len(runes) && len(out) < max; i++ {
		bg := string(runes[i : i+2])
		if strings.ContainsAny(bg, " \t，,。;；、") {
			continue
		}
		if !seen[bg] {
			seen[bg] = true
			out = append(out, bg)
		}
	}
	return out
}

// executeQueryBossCognitions 查询当前老板的经营认知（只读）。
func executeQueryBossCognitions(ctx context.Context, args map[string]interface{}) (*ToolResult, error) {
	var parsed struct {
		Query         string `json:"query"`
		Layer         string `json:"layer"`
		CognitionType string `json:"cognition_type"`
		Limit         int    `json:"limit"`
	}
	if err := parseArgs(args, &parsed); err != nil {
		return nil, fmt.Errorf("参数解析失败: %w", err)
	}

	eid, userID, ok := consultingToolAuth(ctx)
	if !ok {
		logger.Warnf(ctx, "【认知查询Tool】缺少有效认证上下文: eid=%d, user_id=%d", eid, userID)
		return consultingToolRestrictedOutput(), nil
	}

	query := strings.TrimSpace(parsed.Query)
	if query == "" {
		return &ToolResult{Output: "查询条件为空：请提供要检索的经营主题关键词。", ExitCode: 0}, nil
	}
	limit := clampConsultingLimit(parsed.Limit, 5)

	svc := service.NewRecordingCognitionService(eid)
	layer := strings.TrimSpace(parsed.Layer)
	cognitionType := strings.TrimSpace(parsed.CognitionType)

	// 1. 已确认 / 冲突中的正式认知（多关键词 bigram 拓宽召回 + 覆盖率排序）
	confirmedItems, confirmedTotal, serviceErr := collectCognitionsByRecall(ctx, svc, userID, layer, cognitionType, query, limit)
	if serviceErr != nil {
		logger.Warnf(ctx, "【认知查询Tool】正式认知查询失败: user_id=%d err=%v", userID, serviceErr)
		return &ToolResult{
			Output:   "经营认知查询暂时不可用（服务异常）。请不要据此推断「老板没有相关认知」，可基于已知信息继续讨论并说明该限制。",
			ExitCode: 0,
		}, nil
	}

	var sb strings.Builder
	if len(confirmedItems) > 0 {
		sb.WriteString("### 老板经营认知（只读）\n\n")
		for _, item := range confirmedItems {
			sb.WriteString(formatCognitionItem(item))
		}
		if confirmedTotal > len(confirmedItems) {
			sb.WriteString(fmt.Sprintf("\n（本次共命中 %d 条相关认知，已展示 %d 条；如需更完整证据请用更具体的关键词再次查询）\n", confirmedTotal, len(confirmedItems)))
		}
	}

	// 2. 待校准候选：必须与已确认认知严格区分（不得冒充老板已确认原则）
	candidates, candidatesTotal := collectCognitionCandidatesByRecall(ctx, svc, userID, layer, cognitionType, query, 3)
	if len(candidates) > 0 {
		sb.WriteString("### 待老板确认的候选认知（**尚未确认，不得作为老板已确认原则使用**）\n\n")
		for _, item := range candidates {
			sb.WriteString(fmt.Sprintf("- [待确认] %s：%s（层级=%s；来源=%s；置信度=%.2f；认知ID=%d）\n",
				item.Title, item.Statement, cognitionLayerLabel(item.Layer), cognitionSourceLabel(item.SourceType), item.Confidence, item.ID))
		}
		if candidatesTotal > len(candidates) {
			sb.WriteString(fmt.Sprintf("（共命中 %d 条待确认候选，已展示 %d 条）\n", candidatesTotal, len(candidates)))
		}
		sb.WriteString("\n")
	}

	if strings.TrimSpace(sb.String()) == "" {
		return &ToolResult{
			Output:   fmt.Sprintf("未找到与 %q 相关的经营认知记录（该老板尚未注册相关原则/判断标准，或有待确认内容）。请不要编造老板的经营原则。", query),
			ExitCode: 0,
		}, nil
	}

	sb.WriteString("【使用要求】：引用时须保留认知类别与层级；外部专业认知不得表述为老板个人认知；待确认内容不得表述为已确认原则；情境认知须说明适用边界。")
	return &ToolResult{Output: truncateConsultingOutput(&sb), ExitCode: 0}, nil
}

// collectCognitionsByRecall 多关键词（bigram 拓宽）召回正式认知，按 bigram 覆盖率排序取 TopN。
// 首个关键词查询失败时返回错误，用于区分「服务异常」与「无数据」。
func collectCognitionsByRecall(
	ctx context.Context,
	svc *service.RecordingCognitionService,
	userID int64,
	layer, cognitionType, query string,
	limit int,
) (items []service.RecordingCognitionView, matchedTotal int, err error) {
	keywords := cjkRecallKeywords(query, 4)
	seen := make(map[int64]bool)
	type scoredItem struct {
		item  service.RecordingCognitionView
		score float64
	}
	var scored []scoredItem
	var firstErr error

	for _, kw := range keywords {
		list, err := svc.List(ctx, userID, service.RecordingCognitionFilter{
			Status: "", Layer: layer, CognitionType: cognitionType, Keyword: kw, Limit: 50, Offset: 0,
		})
		if err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		if list == nil {
			continue
		}
		for _, item := range list.Items {
			if seen[item.ID] {
				continue
			}
			seen[item.ID] = true
			haystack := item.Title + " " + string(item.Statement) + " " + item.DomainName + " " + strings.Join(item.Scope, " ")
			rel := service.ScoreCJKRelevance(haystack, query)
			if !rel.Relevant {
				continue
			}
			score := rel.Score
			scored = append(scored, scoredItem{item: item, score: score})
		}
	}

	if len(scored) == 0 {
		// 所有关键词都失败 → 服务异常；否则为真实「无数据」
		if firstErr != nil && len(seen) == 0 {
			return nil, 0, firstErr
		}
		return nil, 0, nil
	}

	matchedTotal = len(scored)
	sort.SliceStable(scored, func(i, j int) bool {
		if scored[i].score != scored[j].score {
			return scored[i].score > scored[j].score
		}
		return scored[i].item.ID > scored[j].item.ID
	})
	if len(scored) > limit {
		scored = scored[:limit]
	}
	items = make([]service.RecordingCognitionView, 0, len(scored))
	for _, sc := range scored {
		items = append(items, sc.item)
	}
	return items, matchedTotal, nil
}

// collectCognitionCandidatesByRecall 多关键词召回待校准候选认知（始终与已确认认知分开呈现）。
func collectCognitionCandidatesByRecall(
	ctx context.Context,
	svc *service.RecordingCognitionService,
	userID int64,
	layer, cognitionType, query string,
	limit int,
) (items []service.RecordingCognitionCandidateView, matchedTotal int) {
	keywords := cjkRecallKeywords(query, 3)
	seen := make(map[int64]bool)
	var out []service.RecordingCognitionCandidateView
	for _, kw := range keywords {
		list, err := svc.ListCandidates(ctx, userID, -1, "candidate", layer, cognitionType, 0, nil, kw, 20, 0)
		if err != nil || list == nil {
			continue
		}
		for _, item := range list.Items {
			if seen[item.ID] {
				continue
			}
			seen[item.ID] = true
			haystack := item.Title + " " + string(item.Statement) + " " + item.DomainName
			if !service.ScoreCJKRelevance(haystack, query).Relevant {
				continue
			}
			out = append(out, item)
		}
	}
	matchedTotal = len(out)
	if len(out) > limit {
		out = out[:limit]
	}
	return out, matchedTotal
}

// formatCognitionItem 渲染单条正式认知，保留状态/来源/层级/边界/证据。
func formatCognitionItem(item service.RecordingCognitionView) string {
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("- **%s**（%s；%s）\n", item.Title, cognitionTypeLabel(item.CognitionType), cognitionLayerLabel(item.Layer)))
	sb.WriteString(fmt.Sprintf("  - 内容：%s\n", strings.TrimSpace(item.Statement)))
	if item.DomainName != "" {
		sb.WriteString(fmt.Sprintf("  - 适用领域：%s\n", item.DomainName))
	}
	if len(item.Scope) > 0 {
		sb.WriteString(fmt.Sprintf("  - 适用边界/范围：%s\n", strings.Join(item.Scope, "、")))
	}
	sb.WriteString(fmt.Sprintf("  - 确认状态：%s；来源：%s；置信度=%.2f\n",
		cognitionStatusLabel(item.Status), cognitionSourceLabel(item.SourceType), item.Confidence))
	if item.ValidUntil > 0 {
		sb.WriteString(fmt.Sprintf("  - 有效期至：%d\n", item.ValidUntil))
	}
	if len(item.EvidenceRefs) > 0 {
		for _, ref := range item.EvidenceRefs {
			src := ref.SourceFileName
			if src == "" {
				src = ref.ExternalSource
			}
			if src == "" {
				src = "会议证据"
			}
			sb.WriteString(fmt.Sprintf("  - 证据来源：%s（file_id=%d，片段数=%d）\n", src, ref.SourceFileID, len(ref.SourceSegmentIDs)))
		}
	}
	if len(item.ConflictRefs) > 0 {
		sb.WriteString(fmt.Sprintf("  - ⚠ 存在冲突认知（未合并）：%s\n", strings.Join(item.ConflictRefs, "; ")))
	}
	sb.WriteString(fmt.Sprintf("  - 认知ID=%d\n", item.ID))
	return sb.String()
}

func cognitionLayerLabel(layer string) string {
	switch layer {
	case "core":
		return "核心认知（跨业务通用）"
	case "situational":
		return "情境/领域认知（有适用边界）"
	default:
		return layer
	}
}

// cognitionTypeLabel 渲染认知类别（与 service 层 7 类规范常量一致）。
func cognitionTypeLabel(cognitionType string) string {
	switch cognitionType {
	case "principle":
		return "原则"
	case "priority":
		return "价值排序"
	case "criterion":
		return "判断标准"
	case "preference":
		return "偏好"
	case "boundary":
		return "边界"
	case "assumption":
		return "前提"
	case "trigger":
		return "触发条件"
	default:
		return cognitionType
	}
}

func cognitionStatusLabel(status string) string {
	switch status {
	case "confirmed":
		return "老板已确认"
	case "conflicted":
		return "存在冲突（未解决）"
	case "expired":
		return "已废止"
	default:
		return status
	}
}

func cognitionSourceLabel(source string) string {
	switch source {
	case "boss_authored":
		return "老板亲自撰写"
	case "boss_confirmed":
		return "老板确认"
	case "auto_confirmed":
		return "系统自动确认"
	case "explicit_statement":
		return "会议中明确表述"
	case "behavior_observation":
		return "行为观察"
	case "ai_inference":
		return "AI 推断（未确认）"
	case "external_import":
		return "外部专业来源（非老板个人认知）"
	default:
		return source
	}
}

// executeQueryBusinessMemory 查询当前老板的经营记忆（只读）。
func executeQueryBusinessMemory(ctx context.Context, args map[string]interface{}) (*ToolResult, error) {
	var parsed struct {
		Query      string `json:"query"`
		EntityType string `json:"entity_type"`
		Limit      int    `json:"limit"`
	}
	if err := parseArgs(args, &parsed); err != nil {
		return nil, fmt.Errorf("参数解析失败: %w", err)
	}

	eid, userID, ok := consultingToolAuth(ctx)
	if !ok {
		logger.Warnf(ctx, "【经营记忆查询Tool】缺少有效认证上下文: eid=%d, user_id=%d", eid, userID)
		return consultingToolRestrictedOutput(), nil
	}

	query := strings.TrimSpace(parsed.Query)
	if query == "" {
		return &ToolResult{Output: "查询条件为空：请提供要检索的实体或经营主题关键词。", ExitCode: 0}, nil
	}
	limit := clampConsultingLimit(parsed.Limit, 5)

	entitySvc := service.NewRecordingMemoryEntityService(eid)
	entityItems, entityTotal, serviceErr := collectEntitiesByRecall(ctx, entitySvc, userID, strings.TrimSpace(parsed.EntityType), query, limit)
	if serviceErr != nil {
		logger.Warnf(ctx, "【经营记忆查询Tool】实体记忆查询失败: user_id=%d err=%v", userID, serviceErr)
		return &ToolResult{
			Output:   "经营记忆查询暂时不可用（服务异常）。请不要据此推断「没有相关经营事实」，可基于已知信息继续讨论并说明该限制。",
			ExitCode: 0,
		}, nil
	}

	var sb strings.Builder
	if len(entityItems) > 0 {
		sb.WriteString("### 经营记忆实体与事实（只读）\n\n")
		for i, item := range entityItems {
			sb.WriteString(fmt.Sprintf("- **%s**（类型=%s；事实数=%d；来源会议数=%d）\n",
				item.CanonicalName, entityTypeLabel(item.EntityType), item.FactCount, item.SourceMeetings))
			if strings.TrimSpace(item.Summary) != "" {
				sb.WriteString(fmt.Sprintf("  - 摘要：%s\n", strings.TrimSpace(item.Summary)))
			}
			if item.LastFactAt > 0 {
				sb.WriteString(fmt.Sprintf("  - 最近事实时间：%d\n", item.LastFactAt))
			}
			if item.SourceFile != "" {
				sb.WriteString(fmt.Sprintf("  - 来源文件：%s\n", item.SourceFile))
			}
			sb.WriteString(fmt.Sprintf("  - 实体ID=%d\n", item.ID))

			// 仅对前 2 个实体展开事实明细，控制查询与 Token 预算
			if i < 2 {
				detail, derr := entitySvc.Detail(ctx, userID, item.ID)
				if derr != nil {
					// 明细失败不阻断整体查询，但必须可观测，避免静默降级成「无事实」
					logger.Warnf(ctx, "【经营记忆查询Tool】实体事实明细查询失败: entity_id=%d err=%v", item.ID, derr)
				}
				if derr == nil && detail != nil && len(detail.Facts) > 0 {
					limitFacts := len(detail.Facts)
					if limitFacts > 5 {
						limitFacts = 5
					}
					for _, fact := range detail.Facts[:limitFacts] {
						sb.WriteString(fmt.Sprintf("    - [%s] %s\n", factSourceLabel(fact.SourceType), strings.TrimSpace(fact.Content)))
						if fact.SourceFile != "" {
							sb.WriteString(fmt.Sprintf("      · 来源：%s（file_id=%d，时间=%d）\n", fact.SourceFile, fact.FileID, fact.OccurredAt))
						}
						if fact.FactKind != "" {
							sb.WriteString(fmt.Sprintf("      · 事实类型：%s\n", fact.FactKind))
						}
					}
				}
			}
		}
		if entityTotal > len(entityItems) {
			sb.WriteString(fmt.Sprintf("\n（本次共命中 %d 个相关实体，已展示 %d 个）\n", entityTotal, len(entityItems)))
		}
		sb.WriteString("\n")
	}

	// 会议原子记忆 Claim：保留时效/审阅状态/证据可用性
	claims, claimsTotal := queryOwnerClaims(ctx, eid, userID, query, limit)
	if len(claims) > 0 {
		sb.WriteString("### 会议原子记忆（Claim，含时效与审阅状态）\n\n")
		for _, claim := range claims {
			sb.WriteString(fmt.Sprintf("- [%s] %s\n", claimKindLabel(claim.ClaimKind), strings.TrimSpace(string(claim.Content))))
			sb.WriteString(fmt.Sprintf("  - 当前有效=%v；审阅状态=%s；置信度=%.2f；证据可用=%v；来源文件ID=%d\n",
				claim.IsCurrent, claim.ReviewState, claim.SourceConfidence, claim.EvidenceAvailable, claim.FileID))
			if claim.DueAt > 0 {
				sb.WriteString(fmt.Sprintf("  - 到期时间：%d\n", claim.DueAt))
			}
			sb.WriteString(fmt.Sprintf("  - 记忆ID=%d\n", claim.ID))
		}
		if claimsTotal > len(claims) {
			sb.WriteString(fmt.Sprintf("（本次共命中 %d 条会议记忆，已展示 %d 条）\n", claimsTotal, len(claims)))
		}
		sb.WriteString("\n")
	}

	if strings.TrimSpace(sb.String()) == "" {
		return &ToolResult{
			Output:   fmt.Sprintf("未找到与 %q 相关的经营记忆记录。请不要编造相关客户或经营事实。", query),
			ExitCode: 0,
		}, nil
	}

	sb.WriteString("【使用要求】：人工录入的事实不等同于已核实，涉及金额/承诺/决策时须提示核实状态；「AI 自动提取（未经核实）」不得作为已确认事实引用；已撤销/失效内容不得作为当前有效事实；引用时保留来源文件与时间；冲突事实须同时呈现。")
	return &ToolResult{Output: truncateConsultingOutput(&sb), ExitCode: 0}, nil
}

// collectEntitiesByRecall 多关键词（bigram 拓宽）召回经营记忆实体，按覆盖率排序取 TopN。
func collectEntitiesByRecall(
	ctx context.Context,
	svc *service.RecordingMemoryEntityService,
	userID int64,
	entityType, query string,
	limit int,
) (items []service.RecordingMemoryEntityListItem, matchedTotal int, err error) {
	keywords := cjkRecallKeywords(query, 4)
	seen := make(map[int64]bool)
	type scoredItem struct {
		item  service.RecordingMemoryEntityListItem
		score float64
	}
	var scored []scoredItem
	var firstErr error
	var entityTypes []string
	if entityType = strings.TrimSpace(entityType); entityType != "" {
		entityTypes = []string{entityType}
	}

	for _, kw := range keywords {
		list, err := svc.List(ctx, userID, entityTypes, kw, 50, 0)
		if err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		if list == nil {
			continue
		}
		for _, item := range list.Items {
			if seen[item.ID] {
				continue
			}
			seen[item.ID] = true
			haystack := item.CanonicalName + " " + item.Summary
			rel := service.ScoreCJKRelevance(haystack, query)
			if !rel.Relevant {
				continue
			}
			score := rel.Score
			scored = append(scored, scoredItem{item: item, score: score})
		}
	}

	if len(scored) == 0 {
		if firstErr != nil && len(seen) == 0 {
			return nil, 0, firstErr
		}
		return nil, 0, nil
	}

	matchedTotal = len(scored)
	sort.SliceStable(scored, func(i, j int) bool {
		if scored[i].score != scored[j].score {
			return scored[i].score > scored[j].score
		}
		return scored[i].item.LastFactAt > scored[j].item.LastFactAt
	})
	if len(scored) > limit {
		scored = scored[:limit]
	}
	items = make([]service.RecordingMemoryEntityListItem, 0, len(scored))
	for _, sc := range scored {
		items = append(items, sc.item)
	}
	return items, matchedTotal, nil
}

// queryOwnerClaims 查询当前老板的会议原子记忆。
// 严格 owner 过滤 + 当前有效 + 非拒绝；中文用 bigram 拓宽召回并按覆盖率过滤。
func queryOwnerClaims(ctx context.Context, eid, ownerID int64, query string, limit int) (claimsOut []model.RecordingMemoryClaim, matchedTotal int) {
	keywords := cjkRecallKeywords(query, 4)
	dbQuery := model.DB.WithContext(ctx).
		Where("eid = ? AND owner_id = ?", eid, ownerID).
		Where("is_current = ?", true).
		Where("assertion_state <> ?", "rejected")

	conds := make([]string, 0, len(keywords))
	args := make([]interface{}, 0, len(keywords))
	for _, kw := range keywords {
		conds = append(conds, "content LIKE ?")
		args = append(args, "%"+kw+"%")
	}
	if len(conds) > 0 {
		dbQuery = dbQuery.Where(strings.Join(conds, " OR "), args...)
	}

	var claims []model.RecordingMemoryClaim
	if err := dbQuery.Order("updated_time DESC, id DESC").Limit(50).Find(&claims).Error; err != nil {
		logger.Warnf(ctx, "【经营记忆查询Tool】Claim 查询失败: owner_id=%d err=%v", ownerID, err)
		return nil, 0
	}

	type scoredClaim struct {
		claim model.RecordingMemoryClaim
		score float64
	}
	scored := make([]scoredClaim, 0, len(claims))
	for _, claim := range claims {
		rel := service.ScoreCJKRelevance(string(claim.Content), query)
		if !rel.Relevant {
			continue
		}
		scored = append(scored, scoredClaim{claim: claim, score: rel.Score})
	}
	sort.SliceStable(scored, func(i, j int) bool {
		if scored[i].score != scored[j].score {
			return scored[i].score > scored[j].score
		}
		return scored[i].claim.UpdatedTime > scored[j].claim.UpdatedTime
	})
	matchedTotal = len(scored)
	if len(scored) > limit {
		scored = scored[:limit]
	}
	out := make([]model.RecordingMemoryClaim, 0, len(scored))
	for _, sc := range scored {
		out = append(out, sc.claim)
	}
	return out, matchedTotal
}

func entityTypeLabel(entityType string) string {
	switch entityType {
	case "person":
		return "人物/人员"
	case "matter":
		return "事项"
	case "risk":
		return "风险"
	case "commitment":
		return "承诺"
	case "decision":
		return "决策"
	default:
		return entityType
	}
}

func claimKindLabel(kind string) string {
	switch kind {
	case "decision":
		return "决策"
	case "commitment":
		return "承诺"
	case "risk":
		return "风险"
	case "quote":
		return "原话引用"
	case "fact":
		return "事实"
	default:
		return kind
	}
}

// factSourceLabel 按数据库真实 source_type 如实表达，不据 source_type 提升事实可信等级。
// 说明：recording_memory_facts 只有 source_type(automatic|manual)，没有「已核实」标志位，
// 因此人工来源只能表述为「人工录入」，不得表述为「人工核实」。
func factSourceLabel(sourceType string) string {
	switch sourceType {
	case "manual":
		return "人工录入（核实状态未标注）"
	case "manual_correction":
		return "人工修正（核实状态未标注）"
	case "automatic":
		return "AI 自动提取（未经核实）"
	case "":
		return "来源未标注"
	default:
		return sourceType
	}
}
