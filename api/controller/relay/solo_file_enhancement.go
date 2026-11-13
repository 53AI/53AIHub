package relay

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/53AI/53AIHub/service/rag"
	"github.com/53AI/53AIHub/service/tools"
	relay_model "github.com/songquanpeng/one-api/relay/model"
)

// soloFileLibraryMeta 存储单文件模式下的知识库和空间元信息
type soloFileLibraryMeta struct {
	LibraryIDHash          string
	LibraryName            string
	LibraryIcon            string
	SpaceIDHash            string
	SpaceName              string
	IncludeDecisionInsight bool
}

// SoloFileEnhancedResult 包含单文件探讨注入的增强来源与正文上下文
type SoloFileEnhancedResult struct {
	Sources            []rag.SourceReference
	AllChunks          []interface{}
	UsedChunkIDs       []int64
	ContextContent     string
	HasMeetingMinutes  bool
	HasDecisionInsight bool
	MinutesLength      int
	InsightLength      int
	TranscriptLength   int
	TotalChunks        int
	UsedChunks         int
}

func readSoloFileMeetingMinutes(ctx context.Context, file *model.File, meta soloFileLibraryMeta) *rag.SourceReference {
	var minutesSummary model.RecordingFileSummary
	if err := model.DB.WithContext(ctx).Where("file_id = ? AND template_id = ?", file.ID, 0).First(&minutesSummary).Error; err != nil {
		return nil
	}
	minutesMD := strings.TrimSpace(service.BuildMinutesMarkdown(strings.TrimSpace(string(minutesSummary.SummaryContent))))
	if minutesMD == "" {
		return nil
	}
	fileName, filePath := file.GetAccurateFileName(), file.Path
	if filePath == "" && file.UploadFile != nil {
		filePath = "/" + file.UploadFile.FileName
	}
	minutesRefID := "1-0"
	minutesSourceKey := "[Source:" + minutesRefID + "]"
	minutesDisplayContent := "### 会议核心纪要与决议（优先参考）：\n" + minutesMD
	return &rag.SourceReference{
		SourceType:        "meeting_minutes",
		ReferenceID:       minutesRefID,
		ChunkID:           minutesSummary.ID,
		FileID:            file.ID,
		FileName:          fmt.Sprintf("%s (会议纪要与决议)", fileName),
		ChunkType:         "minutes",
		Content:           minutesDisplayContent,
		Score:             1.0,
		KnowledgeBaseID:   file.LibraryID,
		KnowledgeBaseName: meta.LibraryName,
		KnowledgeBaseLogo: meta.LibraryIcon,
		LibraryID:         meta.LibraryIDHash,
		LibraryName:       meta.LibraryName,
		LibraryIcon:       meta.LibraryIcon,
		FileCreatedAt:     file.CreatedTime,
		SourceKey:         minutesSourceKey,
		SpaceID:           meta.SpaceIDHash,
		SpaceName:         meta.SpaceName,
		URL:               filePath,
	}
}

// readMeetingDecisionInsight keeps AI analysis distinct from recorded meeting facts.
// The caller supplies the available byte budget and a provisional source ID;
// HandleRAG will assign final reference numbers alongside the other sources.
func readMeetingDecisionInsight(file *model.File, meta soloFileLibraryMeta, queries []string, sizeBudget int, refID string) *rag.SourceReference {
	if file == nil || !file.IsRecordingOriginType() || strings.TrimSpace(string(file.InsightSummary)) == "" {
		return nil
	}
	const heading = "### 当前页面的决策洞察（AI 生成的分析与建议，不是会议事实或已确认决议；请结合纪要和逐字稿核验）：\n"
	key := "[Source:" + refID + "]"
	selected := selectMeetingInsightMarkdown(string(file.InsightSummary), queries, sizeBudget-len(key)-len(heading)-len("\n\n"))
	if selected == "" {
		return nil
	}
	filePath := file.Path
	if filePath == "" && file.UploadFile != nil {
		filePath = "/" + file.UploadFile.FileName
	}
	return &rag.SourceReference{
		SourceType: "meeting_insight", ReferenceID: refID, FileID: file.ID,
		FileName: file.GetAccurateFileName() + " (决策洞察)", ChunkType: "insight",
		Content: heading + selected, Score: 1, KnowledgeBaseID: file.LibraryID,
		KnowledgeBaseName: meta.LibraryName, KnowledgeBaseLogo: meta.LibraryIcon,
		LibraryID: meta.LibraryIDHash, LibraryName: meta.LibraryName,
		LibraryIcon: meta.LibraryIcon, FileCreatedAt: file.CreatedTime,
		SourceKey: key, SpaceID: meta.SpaceIDHash, SpaceName: meta.SpaceName, URL: filePath,
	}
}

// enhanceSoloFileSourcesAndContent 为单会议探讨增强检索来源与上下文：
// 1. 若存在会议纪要（recording_file_summaries template_id=0），优先将其解析为结构化 Markdown 作为首要来源（[Source:1-0]）；
// 2. 单场录音的决策洞察 Markdown 作为独立 AI 分析来源；不混同会议纪要中的已确认决议；
// 3. 逐字稿按预算与问题相关性选取，旧会议无洞察时保留原逻辑。
func enhanceSoloFileSourcesAndContent(
	ctx context.Context,
	eid int64,
	file *model.File,
	chunks []model.DocumentChunk,
	queries []string,
	meta soloFileLibraryMeta,
	maxContentSize int,
) (*SoloFileEnhancedResult, error) {
	if file == nil {
		return nil, fmt.Errorf("file is nil")
	}

	result := &SoloFileEnhancedResult{
		TotalChunks: len(chunks),
		AllChunks:   make([]interface{}, 0, len(chunks)),
	}

	fileName := file.GetAccurateFileName()
	filePath := file.Path
	if filePath == "" && file.UploadFile != nil {
		filePath = "/" + file.UploadFile.FileName
	}

	var currentLength int
	var contextBuilder strings.Builder

	// 1. 尝试读取会议结构化纪要 (template_id = 0)
	if minutesSource := readSoloFileMeetingMinutes(ctx, file, meta); minutesSource != nil {
		minutesMD := strings.TrimPrefix(minutesSource.Content, "### 会议核心纪要与决议（优先参考）：\n")
		result.HasMeetingMinutes = true
		result.MinutesLength = len(minutesMD)
		minutesChunkFormatted := fmt.Sprintf("%s%s\n\n", minutesSource.SourceKey, minutesSource.Content)
		if currentLength+len(minutesChunkFormatted) <= maxContentSize {
			contextBuilder.WriteString(minutesChunkFormatted)
			currentLength += len(minutesChunkFormatted)
			result.Sources = append(result.Sources, *minutesSource)
			preview := minutesMD
			if len(preview) > 100 {
				preview = preview[:100] + "..."
			}
			result.AllChunks = append(result.AllChunks, map[string]interface{}{
				"chunk_id": hashInt64(minutesSource.ChunkID), "chunk_type": "minutes", "content": preview,
				"file_id": hashInt64(file.ID), "file_name": fileName, "file_path": filePath,
				"library_id": meta.LibraryIDHash, "library_name": meta.LibraryName, "library_icon": meta.LibraryIcon,
				"space_id": meta.SpaceIDHash, "space_name": meta.SpaceName, "score": 1.0, "source_key": minutesSource.SourceKey,
			})
		}
	}

	// Always load the selected recording's existing decision insight when present.
	// Reserve the space required for short transcripts; for long ones retain a
	// verification budget and select question-relevant transcript chunks below.
	if meta.IncludeDecisionInsight && file.IsRecordingOriginType() {
		reserveTranscript := 0
		for i, chunk := range chunks {
			reserveTranscript += len(sanitizeRetrievalContent(chunk.Content)) + len(fmt.Sprintf("[Source:1-%d]", i+1)) + 32
		}
		if reserveTranscript > maxContentSize/4 {
			reserveTranscript = maxContentSize / 4
		}
		insight := readMeetingDecisionInsight(file, meta, queries,
			maxContentSize-currentLength-reserveTranscript, fmt.Sprintf("1-%d", len(chunks)+1))
		if insight != nil {
			formatted := insight.SourceKey + insight.Content + "\n\n"
			if currentLength+len(formatted) <= maxContentSize {
				contextBuilder.WriteString(formatted)
				currentLength += len(formatted)
				result.HasDecisionInsight = true
				result.InsightLength = len(insight.Content)
				result.Sources = append(result.Sources, *insight)
				preview := strings.TrimPrefix(insight.Content, "### 当前页面的决策洞察（AI 生成的分析与建议，不是会议事实或已确认决议；请结合纪要和逐字稿核验）：\n")
				if letters := []rune(preview); len(letters) > 60 {
					preview = string(letters[:60]) + "..."
				}
				result.AllChunks = append(result.AllChunks, map[string]interface{}{
					"chunk_type": "insight", "content": preview,
					"file_id": hashInt64(file.ID), "file_name": fileName + " (决策洞察)",
					"file_path": filePath, "library_id": meta.LibraryIDHash,
					"library_name": meta.LibraryName, "library_icon": meta.LibraryIcon,
					"space_id": meta.SpaceIDHash, "space_name": meta.SpaceName,
					"score": 1.0, "source_key": insight.SourceKey,
				})
			}
		}
	}

	// 2. 处理逐字稿切片列表
	// 生成 allChunks 基础统计（供前端过程帧使用）
	for i, chunk := range chunks {
		preview := sanitizeRetrievalContent(chunk.Content)
		if len(preview) > 100 {
			preview = preview[:100] + "..."
		}
		result.AllChunks = append(result.AllChunks, map[string]interface{}{
			"chunk_id":     hashInt64(chunk.ID),
			"chunk_type":   chunk.ChunkType,
			"content":      preview,
			"file_id":      hashInt64(chunk.FileID),
			"file_name":    fileName,
			"file_path":    filePath,
			"library_id":   meta.LibraryIDHash,
			"library_name": meta.LibraryName,
			"library_icon": meta.LibraryIcon,
			"space_id":     meta.SpaceIDHash,
			"space_name":   meta.SpaceName,
			"score":        1.0,
			"source_key":   fmt.Sprintf("[Source:1-%d]", i+1),
		})
	}

	remainingSize := maxContentSize - currentLength
	if remainingSize <= 0 {
		result.ContextContent = contextBuilder.String()
		result.UsedChunks = len(result.UsedChunkIDs)
		return result, nil
	}

	// 挑选逐字稿切片：若总长度超限，按用户问题关键词计算相关度进行筛选，并保持原时序
	selectedIndices := selectTranscriptChunks(chunks, queries, remainingSize)

	for _, idx := range selectedIndices {
		chunk := chunks[idx]
		chunkRefID := fmt.Sprintf("1-%d", idx+1)
		chunkWithSource := fmt.Sprintf("[Source:%s]%s\n\n", chunkRefID, sanitizeRetrievalContent(chunk.Content))
		chunkLength := len(chunkWithSource)

		if currentLength+chunkLength > maxContentSize {
			break
		}

		contextBuilder.WriteString(chunkWithSource)
		currentLength += chunkLength
		result.TranscriptLength += len(chunk.Content)
		result.UsedChunkIDs = append(result.UsedChunkIDs, chunk.ID)

		source := rag.SourceReference{
			SourceType:        "document",
			ReferenceID:       chunkRefID,
			ChunkID:           chunk.ID,
			FileID:            chunk.FileID,
			FileName:          fileName,
			ChunkType:         chunk.ChunkType,
			Content:           chunk.Content,
			Score:             1.0,
			KnowledgeBaseID:   file.LibraryID,
			KnowledgeBaseName: meta.LibraryName,
			KnowledgeBaseLogo: meta.LibraryIcon,
			LibraryID:         meta.LibraryIDHash,
			LibraryName:       meta.LibraryName,
			LibraryIcon:       meta.LibraryIcon,
			FileCreatedAt:     file.CreatedTime,
			SourceKey:         fmt.Sprintf("[Source:%s]", chunkRefID),
			SpaceID:           meta.SpaceIDHash,
			SpaceName:         meta.SpaceName,
			URL:               filePath,
		}
		result.Sources = append(result.Sources, source)
	}

	result.ContextContent = contextBuilder.String()
	result.UsedChunks = len(result.UsedChunkIDs)

	logger.Infof(ctx, "【探讨-单会议增强】处理完成: file_id=%d, has_minutes=%v, has_insight=%v, 纪要长度=%d, 洞察长度=%d, 逐字稿长度=%d, 总分片=%d, 使用分片=%d",
		file.ID, result.HasMeetingMinutes, result.HasDecisionInsight, result.MinutesLength, result.InsightLength, result.TranscriptLength, result.TotalChunks, result.UsedChunks)

	return result, nil
}

// selectMeetingInsightMarkdown 通常注入完整 Markdown；超出预算时按二级标题选取
// 与本轮问题最相关的章节，避免简单截断导致用户问的后段洞察消失。
func selectMeetingInsightMarkdown(markdown string, queries []string, sizeBudget int) string {
	if sizeBudget <= 0 {
		return ""
	}
	markdown = sanitizeRetrievalContent(markdown)
	if len(markdown) <= sizeBudget {
		return markdown
	}
	// Keep short sections intact. Only oversized sections are split further into
	// paragraphs and UTF-8-safe excerpts so a relevant late paragraph can win.
	parts := strings.Split(markdown, "\n## ")
	chunks := make([]model.DocumentChunk, 0, len(parts))
	appendChunk := func(content string) {
		content = strings.TrimSpace(content)
		if content != "" {
			chunks = append(chunks, model.DocumentChunk{Content: content})
		}
	}
	for i, part := range parts {
		if i > 0 {
			part = "## " + part
		}
		if len(part)+32 <= sizeBudget {
			appendChunk(part)
			continue
		}
		heading, body := "", part
		if pos := strings.IndexByte(part, '\n'); pos >= 0 {
			heading, body = part[:pos+1], part[pos+1:]
		}
		limit := sizeBudget/2 - len(heading) - 32
		if limit <= 0 {
			continue
		}
		for _, paragraph := range strings.Split(body, "\n\n") {
			paragraph = strings.TrimSpace(paragraph)
			for len(paragraph) > 0 {
				cut := 0
				for _, char := range paragraph {
					width := utf8.RuneLen(char)
					if cut+width > limit {
						break
					}
					cut += width
				}
				if cut == 0 {
					break
				}
				appendChunk(heading + paragraph[:cut])
				paragraph = paragraph[cut:]
			}
		}
	}
	var chosen strings.Builder
	for _, idx := range selectTranscriptChunks(chunks, queries, sizeBudget) {
		part := chunks[idx].Content
		if part == "" {
			continue
		}
		if chosen.Len() > 0 {
			chosen.WriteString("\n\n")
		}
		chosen.WriteString(part)
	}
	if chosen.Len() == 0 {
		// 旧洞察可能只有一个超长段落，没有可按标题拆分的章节。
		// 此时至少保留 UTF-8 完整的开头片段，而不是静默丢掉整份洞察。
		for _, r := range markdown {
			if chosen.Len()+len(string(r)) > sizeBudget {
				break
			}
			chosen.WriteRune(r)
		}
	}
	return chosen.String()
}

// selectTranscriptChunks 根据用户提问从逐字稿分片中挑选最相关的分片，返回按原始时序排序的切片索引列表
func selectTranscriptChunks(chunks []model.DocumentChunk, queries []string, sizeBudget int) []int {
	if len(chunks) == 0 || sizeBudget <= 0 {
		return nil
	}

	// 1. 先测算是否全量容纳
	var totalLen int
	for _, c := range chunks {
		totalLen += len(c.Content) + 32 // 包含标签预留
	}
	if totalLen <= sizeBudget {
		indices := make([]int, len(chunks))
		for i := range chunks {
			indices[i] = i
		}
		return indices
	}

	// 2. 超限时提取查询关键词
	queryKeywords := extractQueryKeywords(queries)

	type scoredChunk struct {
		index int
		score int
		size  int
	}

	scored := make([]scoredChunk, len(chunks))
	for i, c := range chunks {
		score := 1 // 基础分
		content := strings.ToLower(c.Content)

		for _, kw := range queryKeywords {
			if strings.Contains(content, kw) {
				score += 5
			}
		}

		// 会议开头与结尾适当增加保真权重
		if i == 0 || i == len(chunks)-1 {
			score += 3
		}

		scored[i] = scoredChunk{
			index: i,
			score: score,
			size:  len(c.Content) + 32,
		}
	}

	// 按分数从高到低排序，同分按原顺序
	sort.SliceStable(scored, func(i, j int) bool {
		if scored[i].score != scored[j].score {
			return scored[i].score > scored[j].score
		}
		return scored[i].index < scored[j].index
	})
	// 挑选预算内的最高分分片
	var chosen []int
	var usedSize int
	for _, sc := range scored {
		if usedSize+sc.size > sizeBudget {
			continue
		}
		chosen = append(chosen, sc.index)
		usedSize += sc.size
	}

	// 恢复时间先后顺序，避免对话打乱
	sort.Ints(chosen)

	return chosen
}

// extractQueryKeywords 提取用户问题中的核心检索词（忽略停用符号）
func extractQueryKeywords(queries []string) []string {
	var keywords []string
	seen := make(map[string]bool)

	for _, q := range queries {
		q = strings.TrimSpace(strings.ToLower(q))
		if q == "" {
			continue
		}

		// 中英文分词简易抽取
		var curWord strings.Builder
		for _, r := range q {
			if unicode.IsLetter(r) || unicode.IsDigit(r) {
				curWord.WriteRune(r)
			} else {
				if curWord.Len() >= 2 {
					w := curWord.String()
					if !seen[w] {
						seen[w] = true
						keywords = append(keywords, w)
					}
				}
				curWord.Reset()
			}
		}
		if curWord.Len() >= 2 {
			w := curWord.String()
			if !seen[w] {
				seen[w] = true
				keywords = append(keywords, w)
			}
		}
	}

	return keywords
}

// autoAttachPersonalLibraryIfFreeDiscussion 为探讨/录音应用自动挂载当前认证老板的个人知识库 (Slice 2)
// 仅在自由探讨模式（无指定文件、无指定知识库）下挂载，严格按 JWT session 中的 currentUserID 查询，
// 绝不信任客户端传入的未经验证身份，绝不扩大到其他用户的私有库。
func autoAttachPersonalLibraryIfFreeDiscussion(ctx context.Context, agent *model.Agent, currentUserID int64, chatRequest *ChatRequest) {
	if agent == nil || chatRequest == nil || currentUserID <= 0 {
		return
	}
	// 仅对探讨/录音应用生效，不影响普通知识库搜索或 WorkAI
	if agent.AgentUsage != model.AgentUsageRecording {
		return
	}
	// 如果已指定单文件或已指定文件列表，保持会议单文件探讨模式，不自动挂载
	if chatRequest.DatasetIsSoloFile() || len(chatRequest.FileIDs) > 0 || chatRequest.MessageFileID > 0 {
		return
	}
	// 如果客户端已显式指定知识库或空间，保持用户显式范围
	if len(chatRequest.KnowledgeBaseIDs) > 0 || len(chatRequest.SpaceIDs) > 0 {
		return
	}

	// 自由探讨模式：安全检索当前认证用户 (JWT session) 的专属个人知识库
	var personalLibrary model.Library
	err := model.DB.WithContext(ctx).
		Where("eid = ? AND creator_id = ? AND library_kind = ? AND status = ?",
			agent.Eid, currentUserID, model.LIBRARY_KIND_PERSONAL_USER, model.LIBRARY_STATUS_ACTIVE).
		First(&personalLibrary).Error
	if err != nil {
		logger.Debugf(ctx, "【探讨-个人库检索】未找到当前用户的个人知识库: eid=%d, user_id=%d", agent.Eid, currentUserID)
		return
	}

	personalHashID, encErr := hashids.Encode(personalLibrary.ID)
	if encErr != nil {
		logger.Warnf(ctx, "【探讨-个人库检索】个人知识库ID加密失败: library_id=%d, err=%v", personalLibrary.ID, encErr)
		return
	}

	chatRequest.KnowledgeBaseIDs = []string{personalHashID}
	chatRequest.SoloFileMode = false
	logger.Infof(ctx, "【探讨-个人库检索】自由探讨已自动挂载当前老板个人知识库: eid=%d, user_id=%d, library_id=%d, hash=%s",
		agent.Eid, currentUserID, personalLibrary.ID, personalHashID)
}

// injectConversationSummaryIfEnabled 为持续聊天 Agent 注入持久化增量会话摘要
// 组装模式：持久化历史摘要 + 最近原始对话 + 当前用户问题
// 仅作用于会话摘要启用的 Agent 类型
func injectConversationSummaryIfEnabled(ctx context.Context, agent *model.Agent, chatRequest *ChatRequest, userID int64) bool {
	if agent == nil || chatRequest == nil || chatRequest.ConversationID <= 0 || userID <= 0 {
		return false
	}
	if !service.ShouldMaintainConversationSummary(agent) || !supportsSystemRole(agent.ChannelType) {
		return false
	}

	summaryRow, err := model.GetConversationSummary(agent.Eid, chatRequest.ConversationID)
	if err != nil || summaryRow == nil || summaryRow.UserID != userID ||
		summaryRow.AgentID != agent.AgentID || strings.TrimSpace(summaryRow.Summary) == "" {
		return false
	}

	summaryText := strings.TrimSpace(summaryRow.Summary)
	const maxSummaryChars = 8000
	runes := []rune(summaryText)
	if len(runes) > maxSummaryChars {
		// 避免简单切断尾部导致最新决策丢失：保留首部背景与尾部最新决议
		headPart := string(runes[:3000])
		tailPart := string(runes[len(runes)-4500:])
		summaryText = fmt.Sprintf("%s\n\n...[中间讨论过程已压缩]...\n\n%s", headPart, tailPart)
	}

	summaryMessage := relay_model.Message{
		Role: "system",
		Content: fmt.Sprintf("[前期会话历史摘要 (v%d, 覆盖至消息#%d)]\n以下是当前会话此前积累的讨论背景、已确认事实、用户判断、约束和未完成事项。\n\n【重要优先级与事实冲突规则】：\n后续的【近期对话原文】代表最新真实交互，其表述优先级绝对高于本前期摘要。若摘要内容与近期对话原文存在出入或进展变动，必须以近期对话原文为准！\n\n%s",
			summaryRow.SummaryVersion, summaryRow.CoveredThroughMessageID, summaryText),
	}

	// 插入到消息前部（若首条已有系统消息则插入其后，紧接在最近几轮原始对话之前）
	if len(chatRequest.Messages) > 0 && chatRequest.Messages[0].Role == "system" {
		merged := make([]relay_model.Message, 0, len(chatRequest.Messages)+1)
		merged = append(merged, chatRequest.Messages[0])
		merged = append(merged, summaryMessage)
		merged = append(merged, chatRequest.Messages[1:]...)
		chatRequest.Messages = merged
	} else {
		chatRequest.Messages = append([]relay_model.Message{summaryMessage}, chatRequest.Messages...)
	}

	logger.Infof(ctx, "【探讨-上下文组装】会话摘要已注入: conversation_id=%d, version=%d, cursor_msg_id=%d, summary_chars=%d, priority_rule=recent_raw_dialogue_first",
		chatRequest.ConversationID, summaryRow.SummaryVersion, summaryRow.CoveredThroughMessageID, len(runes))
	return true
}

// discussionContextPolicyText 二号总裁探讨 Agent 的上下文使用规则（仅提示层约束，不新增工具/权限）。
//
// 依据 Phase 2E 实测：工具描述本身已覆盖意图，但模型仍出现「该调未调」与
// 「无工具证据仍输出具体政策/时间线 + 编造 [Source:N-M]」两类问题。
const discussionContextPolicyText = `[二号总裁经营探讨-上下文使用规则与事实约束]
1) 按当前问题和已提供的资料决定是否需要工具：
   - 单会议探讨且已提供当前会议纪要、当前会议决策洞察或逐字稿时，这些资料是优先工作上下文。解释当前洞察的某条判断、讨论当前会议提到的人/客户/项目/风险，应优先直接依据本轮资料回答；已有足够依据就不必调用外部工具重复搜索。洞察是AI分析，须结合纪要/逐字稿核验，不当作已确认事实。
   - 解释刚才回答的重复引用、表达或格式问题，优先依据当前对话回应，不强制检索会议资料，也不为故障解释附上无关来源。
   - 涉及“跨会议/以前怎么决定的/过去讨论过什么/历史结论”，除当前会议已提供的结论外，必须调用 search_discussion_history；
   - 涉及客户、人员、项目等经营事实，当前会议有可核验证据则直接使用；否则必须调用 query_business_memory；
   - 涉及老板的原则、判断标准与适用边界，当前资料已包含相应可靠依据则直接使用；否则必须调用 query_boss_cognitions。
   - 自由探讨未绑定会议ID时，不假设存在当前会议；继续按上述规则查询外部证据。
2) 严格事实证据边界：
   - 不得编造政策、数值、生效日期、审批条件或适用范围；具体经营事实必须来自本轮可核验资料或当前对话中老板明确确认的内容。
   - 区分普遍政策、个案例外、建议和已确认决策，不得把个案特批扩大为通用规则。
3) 证据不足时诚实陈述：
   - 当工具返回为空或依据不足时，只能如实说明“依据不足，目前仅明确已知部分，其余需与老板确认”，不得为了使回答看起来丰富而脑补任何假设性政策条款。
4) 严禁用 web_fetch / 联网搜索替代老板的私有经营认知与经营记忆查询。
5) 只有本轮工具结果或知识库来源中真实存在的来源编号，才可写成 [Source:N-M]；没有真实来源时严禁输出任何 [Source:...] 标记。
6) 引用历史结论时标明来源会话与时间；同一议题存在决策变更时，按时序准确说明脉络，并严格区分「已确认决策」与「候选/未确认」。`

// injectDiscussionContextPolicyIfEnabled 向二号总裁探讨 Agent 注入上下文使用规则。
// 仅提示层约束；不新增工具、不改权限、不影响其他 Agent 实例。
func injectDiscussionContextPolicyIfEnabled(ctx context.Context, agent *model.Agent, chatRequest *ChatRequest) bool {
	if agent == nil || chatRequest == nil || !isDiscussionAgentAuthorized(agent) {
		return false
	}
	policyMessage := relay_model.Message{Role: "system", Content: discussionContextPolicyText}
	if len(chatRequest.Messages) > 0 && chatRequest.Messages[0].Role == "system" {
		merged := make([]relay_model.Message, 0, len(chatRequest.Messages)+1)
		merged = append(merged, chatRequest.Messages[0])
		merged = append(merged, policyMessage)
		merged = append(merged, chatRequest.Messages[1:]...)
		chatRequest.Messages = merged
	} else {
		chatRequest.Messages = append([]relay_model.Message{policyMessage}, chatRequest.Messages...)
	}
	logger.Debugf(ctx, "【探讨-上下文策略】已注入上下文使用规则: agent_id=%d", agent.AgentID)
	return true
}

// isDiscussionAgentAuthorized 判断是否为「明确的二号总裁探讨 Agent 实例」。
// 委派给 service.IsAuthorizedDiscussionAgent：要求系统录音应用 + 该企业规范实例（agent_id 最小），
// 而不是按 AgentUsageRecording 类型全局开放工具。
func isDiscussionAgentAuthorized(agent *model.Agent) bool {
	return service.IsAuthorizedDiscussionAgent(agent)
}

// discussionReadOnlyToolNames 二号总裁探讨 Agent 可用的只读上下文工具集合。
var discussionReadOnlyToolNames = []string{
	"search_discussion_history", // Phase 2B：跨会话历史探讨检索
	"query_boss_cognitions",     // Phase 2C：经营认知只读查询
	"query_business_memory",     // Phase 2C：经营记忆只读查询
}

// injectDiscussionContextToolsIfEnabled 向二号总裁探讨 Agent 注入只读上下文工具。
// 全部为只读；不开放任何写入型能力；其他 Agent 实例不受影响。
func injectDiscussionContextToolsIfEnabled(toolsList *[]relay_model.Tool, agent *model.Agent, ctx context.Context) {
	if toolsList == nil || !isDiscussionAgentAuthorized(agent) {
		return
	}
	injected := make([]relay_model.Tool, 0, len(discussionReadOnlyToolNames))
	for _, name := range discussionReadOnlyToolNames {
		toolDef, err := tools.GetToolDefinition(name)
		if err != nil {
			logger.Warnf(ctx, "【探讨-工具注入】未找到 %s 定义: %v", name, err)
			continue
		}
		injected = append(injected, relay_model.Tool{
			Type: "function",
			Function: relay_model.Function{
				Name:        toolDef.Function.Name,
				Description: toolDef.Function.Description,
				Parameters:  toolDef.Function.Parameters,
			},
		})
	}
	if len(injected) == 0 {
		return
	}
	*toolsList = mergeToolsByName(*toolsList, injected)
	logger.Debugf(ctx, "【探讨-工具注入】已向探讨 Agent 注入 %d 个只读上下文工具", len(injected))
}
