package relay

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/53AI/53AIHub/service/elasticsearch"
	"github.com/53AI/53AIHub/service/rag"
	"github.com/gin-gonic/gin"
)

// maxStatsFileList 统计回答中文件列表的最大展示/查询条数。
const maxStatsFileList = 50

// displayFileName 恢复原始文件名：解析产物统一存为 xxx.pdf.md，展示时去掉 .md 还原原始扩展名；
// 原始就是 .md 的文件（去掉后无扩展名）保持不变。
func displayFileName(name string) string {
	if strings.HasSuffix(name, ".md") {
		if trimmed := strings.TrimSuffix(name, ".md"); strings.Contains(trimmed, ".") {
			return trimmed
		}
	}
	return name
}

type statsFileGroup struct {
	name    string
	indexes []int
}

var statsYearRe = regexp.MustCompile(`(?:19|20)\d{2}`)

func groupStatsFiles(files []elasticsearch.StatsSearchResult) []statsFileGroup {
	groups := make([]statsFileGroup, 0, len(files))
	indexByName := make(map[string]int, len(files))
	for i, file := range files {
		name := displayFileName(file.FileName)
		if groupIndex, ok := indexByName[name]; ok {
			groups[groupIndex].indexes = append(groups[groupIndex].indexes, i)
			continue
		}
		indexByName[name] = len(groups)
		groups = append(groups, statsFileGroup{name: name, indexes: []int{i}})
	}
	return groups
}

func statsFileCategory(name string) string {
	switch {
	case strings.Contains(name, "年度报告"):
		return "年度报告"
	case strings.Contains(name, "说明书"):
		return "说明书"
	case strings.Contains(name, "风险"):
		return "风险相关文档"
	default:
		return "其他文档"
	}
}

func statsFileSummary(groups []statsFileGroup) (map[string]int, []string) {
	categories := make(map[string]int)
	years := make(map[string]struct{})
	for _, group := range groups {
		categories[statsFileCategory(group.name)]++
		for _, year := range statsYearRe.FindAllString(group.name, -1) {
			years[year] = struct{}{}
		}
	}
	allYears := make([]string, 0, len(years))
	for year := range years {
		allYears = append(allYears, year)
	}
	sort.Strings(allYears)
	return categories, allYears
}

// buildStatsCountAnswer 统计回答模板：确定性输出，不走 LLM，保证统计数字准确。
// 文件列表项带 [Source:N-1] 标记，配合 buildStatsRAGStats 落库的 rag_stats 供前端来源卡片渲染。
func buildStatsCountAnswer(subject string, total int64, files []elasticsearch.StatsSearchResult) string {
	var b strings.Builder
	fmt.Fprintf(&b, "根据知识库检索，共找到 %d 份与「%s」相关的文件记录。", total, subject)
	if total == 0 {
		b.WriteString("\n暂未找到匹配文件。你可以尝试更换关键词，或缩小知识库范围。")
		return b.String()
	}

	shownFiles := files
	if len(shownFiles) > maxStatsFileList {
		shownFiles = shownFiles[:maxStatsFileList]
	}
	groups := groupStatsFiles(shownFiles)
	categories, years := statsFileSummary(groups)
	b.WriteString("\n整理结果：\n")
	if int64(len(shownFiles)) >= total {
		fmt.Fprintf(&b, "- 按文件名去重后，共 %d 个不同文件\n", len(groups))
	} else {
		fmt.Fprintf(&b, "- 当前展示的 %d 条结果中，按文件名去重后有 %d 个不同文件\n", len(shownFiles), len(groups))
	}

	categoryNames := make([]string, 0, len(categories))
	for category := range categories {
		categoryNames = append(categoryNames, category)
	}
	sort.Strings(categoryNames)
	if len(categoryNames) > 0 {
		b.WriteString("- 文档类型：")
		for i, category := range categoryNames {
			if i > 0 {
				b.WriteString("、")
			}
			fmt.Fprintf(&b, "%s：%d 个", category, categories[category])
		}
		b.WriteByte('\n')
	}
	if len(years) > 0 {
		fmt.Fprintf(&b, "- 覆盖年份：%s 年\n", formatStatsYears(years))
	}

	b.WriteString("\n文件清单（同名记录已合并）：\n")
	for i, group := range groups {
		fmt.Fprintf(&b, "%d. %s", i+1, group.name)
		if len(group.indexes) > 1 {
			fmt.Fprintf(&b, "（%d条记录）", len(group.indexes))
		}
		for _, index := range group.indexes {
			fmt.Fprintf(&b, " [Source:%d-1]", index+1)
		}
		b.WriteByte('\n')
	}
	if len(files) > len(shownFiles) {
		b.WriteString("…其余结果已省略。\n")
	}
	b.WriteString("\n你还可以继续查看：\n- 按年份整理相关文件\n- 按知识库去重\n- 只查看正文明确提到该关键词的文件")
	return b.String()
}

func formatStatsYears(years []string) string {
	if len(years) == 1 {
		return years[0]
	}
	return years[0] + "—" + years[len(years)-1]
}

// buildStatsRAGStats 构造统计回答的 rag_stats：每文件一个 chunk 条目（source_key=[Source:N-1]），
// document_quotations 全量引用，前端用现有来源卡片逻辑渲染（复用 formatRagStats / useRagStats）。
func buildStatsRAGStats(files []elasticsearch.StatsSearchResult) (string, error) {
	b, err := json.Marshal(buildStatsRAGStatsData(files))
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func buildStatsRAGStatsData(files []elasticsearch.StatsSearchResult) *RAGStatsData {
	chunks := make([]ChunkData, 0, len(files))
	quotations := make([]string, 0, len(files))
	for i, f := range files {
		chunkID := hashInt64(f.FileID)
		chunks = append(chunks, ChunkData{
			SourceType: "document",
			ChunkID:    chunkID,
			ChunkType:  "knowledge",                           // 用知识库标准类型，前端来源卡片兼容（统计到的本就是 RAG 文件）
			Content:    truncateContent(f.ContentPreview, 50), // 文件正文预览（ES 高亮/SQL 正文），与 RAG 切片预览逻辑一致
			FileID:     chunkID,
			FileName:   displayFileName(f.FileName),
			LibraryID:  hashInt64(f.LibraryID),
			SourceKey:  fmt.Sprintf("[Source:%d-1]", i+1),
			Score:      f.Score,
		})
		quotations = append(quotations, chunkID)
	}
	return &RAGStatsData{
		DocumentSearch:     &DocumentSearchData{Chunks: chunks},
		DocumentQuotations: quotations,
		FileQuotations:     quotations,
		WikiPageQuotations: []string{},
		Performance:        &PerformanceData{},
		Type:               "rag_search",
	}
}

// statsSubject 统计回答的主题：优先取意图分类提取的核心关键词，否则用原查询。
func statsSubject(result *rag.IntentClassificationResult, fallback string) string {
	if result != nil && len(result.Keywords) > 0 {
		return result.Keywords[0]
	}
	return fallback
}

// tryHandleStatsCount 尝试走统计计数路径：ES 全库计数 + 模板回答。
// 成功返回 true（已回复用户）；失败返回 false（调用方降级走 RAG）。
func tryHandleStatsCount(c *gin.Context, chatRequest *ChatRequest, ctx context.Context, messageStatus *MessageStatsInfo, classificationResult *rag.IntentClassificationResult, agent *model.Agent, requestId string) bool {
	messageStatus.StepSender.SendStartStep(STEP_STATS_COUNT, "正在统计知识库文件...", nil)
	total, statsFiles, source, statsErr := HandleStatsQuery(c, chatRequest, ctx, messageStatus, classificationResult)
	if statsErr != nil {
		logger.Warnf(ctx, "统计查询失败，降级回 RAG: %v", statsErr)
		messageStatus.StepSender.SendEndStep(STEP_STATS_COUNT, "统计失败，降级知识库检索", nil)
		return false
	}
	statsQuery := messageStatus.RewrittenQuestion
	if statsQuery == "" {
		statsQuery = messageStatus.OriginalQuestion
	}
	keyword := statsSubject(classificationResult, statsQuery)
	answer := buildStatsCountAnswer(keyword, total, statsFiles)
	// 文件名直接命中数（方向1：文件名命中优先，内容仅作补充——可观测列表里多少是文件名直接相关）
	fileHits := 0
	for _, f := range statsFiles {
		if strings.Contains(displayFileName(f.FileName), keyword) {
			fileHits++
		}
	}
	ragStatsData := buildStatsRAGStatsData(statsFiles)
	ragStatsBytes, ragStatsErr := json.Marshal(ragStatsData)
	ragStatsJSON := string(ragStatsBytes)
	if ragStatsErr != nil {
		logger.Warnf(ctx, "统计回答 rag_stats 构造失败: %v", ragStatsErr)
		ragStatsJSON = ""
	}
	messageStatus.StepSender.SendEndStep(STEP_STATS_COUNT, fmt.Sprintf("统计完成，共 %d 个文件", total), map[string]interface{}{
		"total":          total,
		"file_name_hits": fileHits,
		"source":         source,
		"keyword":        keyword,
		"sources":        ragStatsData.DocumentSearch.Chunks,
	})
	if len(ragStatsData.DocumentQuotations)+len(ragStatsData.WikiPageQuotations) > 0 {
		messageStatus.StepSender.SendStartStep(STEP_REF_ANALYSIS, "正在分析回答中的文档引用...", nil)
		quotedCount := len(ragStatsData.DocumentQuotations) + len(ragStatsData.WikiPageQuotations)
		messageStatus.StepSender.SendEndStep(STEP_REF_ANALYSIS, fmt.Sprintf("引用分析完成，回答中引用了 %d 篇文档", quotedCount), map[string]interface{}{
			"document_quotations":  ragStatsData.DocumentQuotations,
			"file_quotations":      ragStatsData.FileQuotations,
			"wiki_page_quotations": ragStatsData.WikiPageQuotations,
			"performance":          ragStatsData.Performance,
		})
	}
	handleStatsCountReply(c, chatRequest, agent, answer, ragStatsJSON, requestId, messageStatus)
	return true
}

// HandleStatsQuery 处理统计计数查询：库范围解析 + ES 全文计数 + 文件级权限过滤。
// 返回命中文件总数、文件列表（文件名级展示）与检索源（es/sql）。ES 不可用时降级 SQL。
func HandleStatsQuery(c *gin.Context, chatRequest *ChatRequest, ctx context.Context, messageStatus *MessageStatsInfo, classificationResult *rag.IntentClassificationResult) (int64, []elasticsearch.StatsSearchResult, string, error) {
	agent := messageStatus.AgentModel
	if agent == nil {
		return 0, nil, "", fmt.Errorf("agent 为空")
	}
	searchTarget, err := resolveSearchTargets(agent.Eid, chatRequest.SpaceIDs, chatRequest.KnowledgeBaseIDs, chatRequest.FileIDs)
	if err != nil {
		return 0, nil, "", fmt.Errorf("解析搜索目标失败: %v", err)
	}
	query := messageStatus.RewrittenQuestion
	if query == "" {
		query = messageStatus.OriginalQuestion
	}
	keyword := statsSubject(classificationResult, query)
	userID := config.GetUserId(c)

	// 库级权限过滤：仅统计用户可访问的知识库（未指定库时查 eid 全部库并过滤），
	// 防止统计数字泄露无权限库的文档数量。
	accessibleLibs, err := filterAccessibleLibraryIDsForStats(agent.Eid, userID, searchTarget.LibraryIDs)
	if err != nil {
		return 0, nil, "", fmt.Errorf("库级权限过滤失败: %v", err)
	}

	esClient := elasticsearch.GetGlobalClient()
	if esClient == nil || esClient.IsDisabled() {
		// SQL 降级：文件名 + 文件内容 LIKE 计数（内容级统计需要，否则"和XX相关"若关键词不在文件名则为 0）
		total, files, err := statsCountViaSQL(ctx, agent.Eid, userID, keyword, accessibleLibs)
		return total, files, "sql", err
	}
	svc := elasticsearch.NewFileNameSearchService(esClient, model.DB)
	total, files, err := svc.SearchStats(keyword, accessibleLibs, maxStatsFileList)
	if err != nil {
		return 0, nil, "es", fmt.Errorf("ES 统计检索失败: %v", err)
	}
	files = enrichStatsContentPreviews(ctx, files)
	files = filterStatsFilePermission(ctx, agent.Eid, userID, files)
	return total, files, "es", nil
}

// enrichStatsContentPreviews 为缺失内容预览的命中文件回填文件正文预览（file_bodies.content）。
// ES 高亮片段只在 query 命中 content 时非空；仅命中文件名（如"基金"在产品名里）时需回填正文。
// 每文件取最新一条正文，Go 侧截断由 buildStatsRAGStats 统一处理。
func enrichStatsContentPreviews(ctx context.Context, files []elasticsearch.StatsSearchResult) []elasticsearch.StatsSearchResult {
	if len(files) == 0 {
		return files
	}
	missing := make([]int64, 0, len(files))
	idx := make(map[int64]int, len(files))
	for i := range files {
		if files[i].ContentPreview == "" {
			idx[files[i].FileID] = i
			missing = append(missing, files[i].FileID)
		}
	}
	if len(missing) == 0 {
		return files
	}
	var bodies []struct {
		FileID  int64
		Content string
	}
	if err := model.DB.WithContext(ctx).Table("file_bodies").
		Select("file_id, content").
		Where("file_id IN ? AND content != ''", missing).
		Order("id DESC").
		Scan(&bodies).Error; err != nil {
		logger.Warnf(ctx, "统计文件内容预览回填失败: %v", err)
		return files
	}
	seen := make(map[int64]bool, len(missing))
	for _, b := range bodies {
		if seen[b.FileID] {
			continue
		}
		seen[b.FileID] = true
		if i, ok := idx[b.FileID]; ok && files[i].ContentPreview == "" {
			files[i].ContentPreview = b.Content
		}
	}
	return files
}

// filterAccessibleLibraryIDsForStats 过滤用户可访问的普通知识库（与全局搜索同口径）。
func filterAccessibleLibraryIDsForStats(eid, userID int64, libraryIDs []int64) ([]int64, error) {
	var libraries []model.Library
	query := model.DB.Where("eid = ?", eid)
	if len(libraryIDs) > 0 {
		query = query.Where("id IN ?", libraryIDs)
	}
	if err := query.Find(&libraries).Error; err != nil {
		return nil, err
	}
	resolver, err := common.NewPermissionResolver(eid, userID)
	if err != nil {
		return nil, err
	}
	accessible := make([]int64, 0, len(libraries))
	for _, library := range libraries {
		if library.LibraryKind != model.LIBRARY_KIND_REGULAR {
			continue
		}
		permission, err := resolver.GetPermission(model.RESOURCE_TYPE_LIBRARY, library.ID)
		if err != nil {
			return nil, err
		}
		if permission > model.PERMISSION_NONE {
			accessible = append(accessible, library.ID)
		}
	}
	return accessible, nil
}

// filterStatsFilePermission 按文件权限过滤统计结果（无查看权限的文件不展示）。
func filterStatsFilePermission(ctx context.Context, eid, userID int64, files []elasticsearch.StatsSearchResult) []elasticsearch.StatsSearchResult {
	if len(files) == 0 || userID <= 0 {
		return files
	}
	fileIDs := make([]int64, 0, len(files))
	for _, f := range files {
		fileIDs = append(fileIDs, f.FileID)
	}
	permissions, err := service.BatchGetUserPermissions(eid, model.RESOURCE_TYPE_FILE, fileIDs, userID, ctx)
	if err != nil {
		logger.Warnf(ctx, "统计回答文件权限查询失败: %v", err)
		return files
	}
	kept := make([]elasticsearch.StatsSearchResult, 0, len(files))
	for _, f := range files {
		if permissions[f.FileID] >= model.PERMISSION_VIEW_ONLY {
			kept = append(kept, f)
		}
	}
	return kept
}

// statsCountViaSQL SQL 降级：文件名（path）或文件内容（file_bodies.content）LIKE 计数。
// 必须匹配内容，否则"和基金相关的文档"在关键词不在文件名（如"FOF"产品名）时误报 0。
func statsCountViaSQL(ctx context.Context, eid, userID int64, keyword string, libraryIDs []int64) (int64, []elasticsearch.StatsSearchResult, error) {
	if keyword == "" {
		return 0, nil, fmt.Errorf("检索关键词为空")
	}
	like := "%" + keyword + "%"
	base := model.DB.Model(&model.File{}).
		Where("eid = ? AND is_deleted = ? AND type = ?", eid, false, model.FILE_TYPE_FILE).
		Where("(path LIKE ? OR EXISTS(SELECT 1 FROM file_bodies WHERE file_bodies.file_id = files.id AND file_bodies.content LIKE ?))", like, like)
	if len(libraryIDs) > 0 {
		base = base.Where("library_id IN ?", libraryIDs)
	}

	var total int64
	if err := base.Count(&total).Error; err != nil {
		return 0, nil, fmt.Errorf("SQL 统计计数失败: %v", err)
	}
	var files []model.File
	if err := base.Order("updated_time DESC").Limit(maxStatsFileList).Find(&files).Error; err != nil {
		return 0, nil, fmt.Errorf("SQL 统计文件列表失败: %v", err)
	}
	// 文件名命中优先（方向1：文件名命中优先，内容仅作补充）。
	// Go 侧稳定排序：文件名含关键词的排前，其余按更新时间倒序，避免 SQL 拼接注入。
	sort.SliceStable(files, func(i, j int) bool {
		iHit := strings.Contains(files[i].Path, keyword)
		jHit := strings.Contains(files[j].Path, keyword)
		if iHit != jHit {
			return iHit
		}
		return files[i].UpdatedTime > files[j].UpdatedTime
	})
	out := make([]elasticsearch.StatsSearchResult, 0, len(files))
	for _, f := range files {
		out = append(out, elasticsearch.StatsSearchResult{FileID: f.ID, FileName: model.ExtractSimpleFileName(f.Path), LibraryID: f.LibraryID})
	}
	// 回填文件正文预览（file_bodies.content），与 ES 路径一致
	out = enrichStatsContentPreviews(ctx, out)
	// 文件级权限过滤（无查看权限的文件剔除）
	out = filterStatsFilePermission(ctx, eid, userID, out)
	return total, out, nil
}

// handleStatsCountReply 写统计回答消息并返回（仿 handleOutOfRangeReply 骨架，正常响应状态）。
// ragStatsJSON 为统计回答的 rag_stats（chunks + quotations），落库并随流式响应返回。
func handleStatsCountReply(c *gin.Context, chatRequest *ChatRequest, agent *model.Agent, answer, ragStatsJSON, requestId string, messageStatus *MessageStatsInfo) {
	ctx := c.Request.Context()
	userID := config.GetUserId(c)
	conversationId := int64(0)
	if conversation, err := GetSessionConversation(c); err == nil {
		conversationId = conversation.ConversationID
	}
	existingMsgID := getPreparedMasterMessageID(c, messageStatus)

	if existingMsgID > 0 {
		if msg, err := model.GetMessageByID(agent.Eid, existingMsgID); err == nil {
			msg.Answer = answer
			msg.RAGStats = ragStatsJSON
			msg.ReasoningContent = ""
			msg.ModelName = agent.Model
			msg.Quota = 0
			msg.ChannelId = 0
			msg.RequestId = requestId
			msg.IsStream = chatRequest.Stream
			msg.ResponseStatus = model.ResponseStatusNormal
			msg.ThinkingMode = messageStatus.ThinkingMode
			msg.OriginalQuestion = messageStatus.OriginalQuestion
			msg.RewrittenQuestion = messageStatus.RewrittenQuestion
			if err := model.UpdateMessage(msg); err != nil {
				logger.Errorf(ctx, "更新统计回答消息失败: %s", err.Error())
			}
			if chatRequest.Stream {
				if err := sendMessageIDFirstFrame(c, requestId, agent.Model, existingMsgID); err != nil {
					logger.Warnf(ctx, "sendMessageIDFirstFrame failed: %v", err)
				}
			}
		}
	} else if userID != 0 && conversationId != 0 {
		messageJSON, err := json.Marshal(prepareMessagesForStorage(chatRequest.Messages))
		if err != nil {
			messageJSON = []byte("[]")
		}
		message := &model.Message{
			Eid:               agent.Eid,
			UserID:            userID,
			ConversationID:    conversationId,
			AgentID:           agent.AgentID,
			Message:           string(messageJSON),
			Answer:            answer,
			RAGStats:          ragStatsJSON,
			ReasoningContent:  "",
			ModelName:         agent.Model,
			Quota:             0,
			PromptTokens:      0,
			CompletionTokens:  0,
			TotalTokens:       0,
			ChannelId:         0,
			RequestId:         requestId,
			ElapsedTime:       0,
			IsStream:          chatRequest.Stream,
			ResponseStatus:    model.ResponseStatusNormal,
			ThinkingMode:      messageStatus.ThinkingMode,
			KnowledgeScope:    messageStatus.KnowledgeScope,
			KnowledgeType:     messageStatus.KnowledgeType,
			OriginalQuestion:  messageStatus.OriginalQuestion,
			RewrittenQuestion: messageStatus.RewrittenQuestion,
			RequestSource:     messageStatus.RequestSource,
		}
		applyVisitorIdentityToMessage(c, message)
		if err := model.CreateMessage(message); err != nil {
			logger.Errorf(ctx, "保存统计回答消息失败: %s", err.Error())
		} else {
			if err := updateConversationLastMessage(agent.Eid, conversationId, userID, string(messageJSON), answer, 0, 0); err != nil {
				logger.Warnf(ctx, "更新会话最后消息失败: %v", err)
			}
			if chatRequest.Stream {
				if err := sendMessageIDFirstFrame(c, requestId, agent.Model, message.ID); err != nil {
					logger.Warnf(ctx, "sendMessageIDFirstFrame failed: %v", err)
				}
			}
			mirrorOutOfRangeReplyForSubscribe(c, requestId, message.ID, answer)
			finalizeAgentRunForMessage(ctx, agent, conversationId, message.ID, requestId, model.AgentRunStatusCompleted, "", "")
		}
	}

	if chatRequest.Stream {
		sendStreamReply(c, answer, requestId, agent.Model, json.RawMessage(ragStatsJSON))
	} else {
		sendNonStreamOutOfRangeReply(c, answer, requestId, agent.Model)
	}
}
