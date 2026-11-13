package tools

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/service"
)

// executeSearchDiscussionHistory 执行跨会话探讨历史检索工具 (Phase 2B)
func executeSearchDiscussionHistory(ctx context.Context, args map[string]interface{}) (*ToolResult, error) {
	var parsed struct {
		Query           string   `json:"query"`
		Limit           int      `json:"limit"`
		TimeRange       string   `json:"time_range"`
		ConversationIDs []string `json:"conversation_ids"`
	}
	if err := parseArgs(args, &parsed); err != nil {
		return nil, fmt.Errorf("参数解析失败: %w", err)
	}

	query := strings.TrimSpace(parsed.Query)
	if query == "" {
		return nil, fmt.Errorf("query 不能为空")
	}

	limit := parsed.Limit
	if limit <= 0 {
		limit = 5
	}
	if limit > 15 {
		limit = 15
	}

	eid, _ := ctx.Value(ToolEIDKey).(int64)
	userID, _ := ctx.Value(ToolUserIDKey).(int64)
	agentID, _ := ctx.Value(ToolAgentIDKey).(int64)

	// 执行入口纵深授权校验：仅规范的系统探讨 Agent 实例可调用（模型参数无法影响该判定）。
	if eid > 0 && userID > 0 {
		if authErr := service.AuthorizeDiscussionToolCall(ctx, eid, agentID); authErr != nil {
			logger.Warnf(ctx, "【历史检索Tool】工具执行入口授权失败: eid=%d, user_id=%d, agent_id=%d, err=%v", eid, userID, agentID, authErr)
			return &ToolResult{Output: "检索受限：当前调用方未获授权使用跨会话历史检索。", ExitCode: 0}, nil
		}
	}

	var currentConvID int64
	if v := ctx.Value(SandboxConversationIDKey); v != nil {
		switch idVal := v.(type) {
		case int64:
			currentConvID = idVal
		case string:
			if _, err := fmt.Sscanf(idVal, "conversation-%d", &currentConvID); err != nil || currentConvID <= 0 {
				fmt.Sscanf(idVal, "%d", &currentConvID)
			}
		}
	}

	if eid <= 0 || userID <= 0 {
		logger.Warnf(ctx, "【历史检索Tool】未找到有效租户或用户认证信息: eid=%d, user_id=%d", eid, userID)
		return &ToolResult{
			Output:   "检索受限：未检测到合法的用户认证上下文。",
			ExitCode: 0,
		}, nil
	}

	// 解析时间范围
	var timeRangeStart int64
	now := time.Now()
	switch strings.ToLower(strings.TrimSpace(parsed.TimeRange)) {
	case "7d":
		timeRangeStart = now.AddDate(0, 0, -7).UnixMilli()
	case "30d":
		timeRangeStart = now.AddDate(0, 0, -30).UnixMilli()
	case "90d":
		timeRangeStart = now.AddDate(0, 0, -90).UnixMilli()
	}

	// 解析可选的会话 ID 列表（支持明文与 HashID）
	var decodedConvIDs []int64
	for _, rawID := range parsed.ConversationIDs {
		rawID = strings.TrimSpace(rawID)
		if rawID == "" {
			continue
		}
		var numID int64
		if _, err := fmt.Sscanf(rawID, "%d", &numID); err == nil && numID > 0 {
			decodedConvIDs = append(decodedConvIDs, numID)
		} else if hid, err := hashids.Decode(rawID); err == nil && hid > 0 {
			decodedConvIDs = append(decodedConvIDs, hid)
		}
	}

	searchSvc := service.NewDiscussionHistorySearchService()
	res, err := searchSvc.SearchHistory(ctx, service.DiscussionHistorySearchParams{
		Eid:                   eid,
		UserID:                userID,
		AgentID:               agentID,
		CurrentConversationID: currentConvID,
		Query:                 query,
		ConversationIDs:       decodedConvIDs,
		TimeRangeStart:        timeRangeStart,
		Limit:                 limit,
	})
	if err != nil {
		logger.Warnf(ctx, "【历史检索Tool】执行失败: query=%q err=%v", query, err)
		return nil, fmt.Errorf("历史检索失败: %w", err)
	}

	if res == nil || len(res.Hits) == 0 {
		return &ToolResult{
			Output: fmt.Sprintf("未在历史探讨中检索到与 %q 相关的记录。\n"+
				"【重要】这只表示本层检索没有命中，**不等于**该判断/事实不存在，也不等于老板没有做过该决策。\n"+
				"请勿据此断言“没有相关历史”，可改用老板的经营记忆/经营认知查询，或在回答中说明依据不足。", query),
			ExitCode: 0,
		}, nil
	}

	// 格式化为模型易理解的 Markdown 证据格式
	var sb strings.Builder
	if res.IsFallback {
		// 零命中后的受限回退检索：证据强度弱，必须显式告知模型，避免被当作强证据引用。
		sb.WriteString("【证据强度提示】本次为“直接命中不足后的受限回退检索”，依据强度较弱，回答时必须说明该结论仍需与老板确认，不得作为既定事实陈述。\n\n")
	}
	sb.WriteString(fmt.Sprintf("### 跨会话历史探讨检索结果（共检索到 %d 条历史依据）：\n\n", len(res.Hits)))

	for i, hit := range res.Hits {
		timeStr := ""
		if hit.CreatedAt > 0 {
			timeStr = time.UnixMilli(hit.CreatedAt).Format("2006-01-02 15:04")
		}

		sb.WriteString(fmt.Sprintf("%d. **会话：%s** %s\n", i+1, hit.ConversationTitle, hit.SourceReference))
		if timeStr != "" {
			sb.WriteString(fmt.Sprintf("   - 讨论时间：%s\n", timeStr))
		}
		if hit.HitType == "summary" {
			sb.WriteString(fmt.Sprintf("   - **当时探讨结论与事实摘要**：%s\n", hit.MatchedExcerpt))
		} else {
			sb.WriteString(fmt.Sprintf("   - **命中历史发言**：%s\n", hit.MatchedExcerpt))
			if hit.ContextWindow != "" {
				sb.WriteString(fmt.Sprintf("   - **完整上下文**：\n%s\n", indentText(hit.ContextWindow, "     ")))
			}
		}
		sb.WriteString("\n")
	}

	sb.WriteString("【引用指引】：在回答中引用上述历史讨论时，请标明对应的来源会话及时间；若不同会话存在决策变动，请按时间先后顺序指出其变化脉络。")

	output := sb.String()
	logger.Infof(ctx, "【历史检索Tool】成功返回 %d 条历史依据", len(res.Hits))
	return &ToolResult{
		Output:   output,
		ExitCode: 0,
	}, nil
}

func indentText(text, prefix string) string {
	lines := strings.Split(text, "\n")
	for i, line := range lines {
		lines[i] = prefix + line
	}
	return strings.Join(lines, "\n")
}
