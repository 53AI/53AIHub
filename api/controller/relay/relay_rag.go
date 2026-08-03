package relay

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/search_tools"
	servicepkg "github.com/53AI/53AIHub/service"
	"github.com/53AI/53AIHub/service/rag"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const (
	rerankRecallMultiplier = 2
	rerankRecallMax        = 200
)

func calculateRecallTopK(finalTopK int, _ int, rerankEnabled bool) int {
	if finalTopK <= 0 {
		finalTopK = 20
	}
	if !rerankEnabled {
		return finalTopK
	}

	recallTopK := finalTopK * rerankRecallMultiplier
	if recallTopK < finalTopK {
		recallTopK = finalTopK
	}
	if recallTopK > rerankRecallMax {
		recallTopK = rerankRecallMax
	}
	return recallTopK
}

func limitSearchItemsTopK(items []*search_tools.SearchItem, topK int) []*search_tools.SearchItem {
	if topK <= 0 || len(items) <= topK {
		return items
	}
	return items[:topK]
}

func appendGraphAggregateSource(base []rag.SourceReference, graphSource *rag.SourceReference) []rag.SourceReference {
	if graphSource == nil {
		return base
	}

	result := make([]rag.SourceReference, 0, len(base)+1)
	result = append(result, *graphSource)
	result = append(result, base...)
	return result
}

func shouldRunGraphSearch(ctx context.Context, chatRequest *ChatRequest, agent *model.Agent) bool {
	if chatRequest == nil {
		logger.Warnf(ctx, "【图谱检索】运行判定失败：请求为空，最终关闭")
		return false
	}
	normalizeGraphSearchSettingWithContext(ctx, chatRequest, agent)
	if len(chatRequest.FileIDs) > 0 {
		logger.Infof(ctx, "【图谱检索】运行判定：检测到文件检索输入，文件数=%d，图谱搜索关闭", len(chatRequest.FileIDs))
		return false
	}
	enabled := chatRequest.EnableGraphSearch == nil || *chatRequest.EnableGraphSearch
	logger.Infof(ctx, "【图谱检索】运行判定：文件数=%d，图谱搜索最终结果=%t，当前开关=%s", len(chatRequest.FileIDs), enabled, formatGraphSearchToggle(chatRequest.EnableGraphSearch))
	return enabled
}

func shouldRunWikiSearch(ctx context.Context, chatRequest *ChatRequest, agent *model.Agent) bool {
	if chatRequest == nil {
		logger.Infof(ctx, "【Wiki检索】运行判定：请求为空，最终关闭")
		return false
	}
	if chatRequest.DatasetIsSoloWiki() {
		logger.Infof(ctx, "【Wiki检索】运行判定：单 Wiki 页面模式，跳过普通 Wiki 搜索")
		return false
	}
	if chatRequest.WikiSearchConfig == nil {
		logger.Infof(ctx, "【Wiki检索】运行判定：未设置 wiki_search_config，最终关闭")
		return false
	}
	if chatRequest.WikiSearchConfig.Enabled == nil {
		logger.Infof(ctx, "【Wiki检索】运行判定：wiki_search_config.enabled 未设置，最终关闭")
		return false
	}
	if !*chatRequest.WikiSearchConfig.Enabled {
		logger.Infof(ctx, "【Wiki检索】运行判定：请求开关为 false，最终关闭")
		return false
	}
	if agent == nil {
		logger.Infof(ctx, "【Wiki检索】运行判定：Agent 为空，最终关闭")
		return false
	}
	cfg, err := agent.GetWikiSearchConfig()
	if err != nil {
		logger.Warnf(ctx, "【Wiki检索】读取 Agent 配置失败：智能体ID=%d，错误=%v，最终关闭", agent.AgentID, err)
		return false
	}
	if cfg == nil {
		logger.Infof(ctx, "【Wiki检索】运行判定：Agent 配置为空，智能体ID=%d，最终关闭", agent.AgentID)
		return false
	}
	if !cfg.Enable {
		logger.Infof(ctx, "【Wiki检索】运行判定：Agent Wiki 总开关为 false，智能体ID=%d，默认开关=%t，最终关闭", agent.AgentID, cfg.DefaultEnable)
		return false
	}
	logger.Infof(ctx, "【Wiki检索】运行判定：请求开关=true，Agent 总开关=true，智能体ID=%d，默认开关=%t，最终开启", agent.AgentID, cfg.DefaultEnable)
	return true
}

func decodeWikiIDs(values []string) ([]int64, error) {
	ids := make([]int64, 0, len(values))
	seen := make(map[int64]struct{}, len(values))
	for _, value := range values {
		id, err := hashids.TryParseID(value)
		if err != nil {
			return nil, fmt.Errorf("invalid wiki id %q: %w", value, err)
		}
		if id <= 0 {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	return ids, nil
}

func HandleWikiSearchRag(c *gin.Context, queries []string, chatRequest *ChatRequest, ctx context.Context, messageStatus *MessageStatsInfo) ([]rag.SourceReference, error) {
	if len(queries) == 0 || messageStatus == nil || messageStatus.AgentModel == nil || chatRequest == nil || chatRequest.WikiSearchConfig == nil {
		logger.Infof(ctx, "【Wiki检索】未执行：查询或请求上下文不完整，queries=%d，message_status=%t，agent=%t，request=%t，config=%t", len(queries), messageStatus != nil, messageStatus != nil && messageStatus.AgentModel != nil, chatRequest != nil, chatRequest != nil && chatRequest.WikiSearchConfig != nil)
		return []rag.SourceReference{}, nil
	}
	wikiConfig := chatRequest.WikiSearchConfig
	queryText := ""
	if len(queries) > 0 {
		queryText = strings.TrimSpace(queries[0])
	}
	logger.Infof(ctx, "【Wiki检索】开始搜索：智能体ID=%d，企业ID=%d，用户ID=%d，查询=%q，空间数=%d，知识库数=%d，页面数=%d", messageStatus.AgentModel.AgentID, messageStatus.AgentModel.Eid, config.GetUserId(c), queryText, len(wikiConfig.SpaceIDs), len(wikiConfig.KnowledgeBaseIDs), len(wikiConfig.WikiPageIDs))
	spaceIDs, err := decodeWikiIDs(wikiConfig.SpaceIDs)
	if err != nil {
		logger.Warnf(ctx, "【Wiki检索】空间ID解析失败：错误=%v", err)
		return nil, err
	}
	libraryIDs, err := decodeWikiIDs(wikiConfig.KnowledgeBaseIDs)
	if err != nil {
		logger.Warnf(ctx, "【Wiki检索】知识库ID解析失败：错误=%v", err)
		return nil, err
	}
	pageIDs, err := decodeWikiIDs(wikiConfig.WikiPageIDs)
	if err != nil {
		logger.Warnf(ctx, "【Wiki检索】页面ID解析失败：错误=%v", err)
		return nil, err
	}

	// 按空间的知识动态开关过滤：只搜索开启 EnableWikiDynamicKnowledge 的空间
	enabledSpaceIDs, err := model.GetEnabledDynamicKnowledgeSpaceIDs(messageStatus.AgentModel.Eid, spaceIDs)
	if err != nil {
		logger.Warnf(ctx, "【Wiki检索】查询空间开关状态失败：错误=%v", err)
		return nil, err
	}
	if len(enabledSpaceIDs) == 0 {
		if len(spaceIDs) > 0 {
			logger.Infof(ctx, "【Wiki检索】指定空间均已关闭知识动态，跳过搜索：空间数=%d", len(spaceIDs))
		} else {
			logger.Infof(ctx, "【Wiki检索】企业下无开启知识动态的空间，跳过搜索")
		}
		return []rag.SourceReference{}, nil
	}

	query := queryText
	results, err := servicepkg.NewWikiSearchService(model.DB).Search(ctx, servicepkg.WikiSearchRequest{
		Eid:         messageStatus.AgentModel.Eid,
		UserID:      config.GetUserId(c),
		Query:       query,
		SpaceIDs:    enabledSpaceIDs,
		LibraryIDs:  libraryIDs,
		WikiPageIDs: pageIDs,
		TopK:        wikiTopK(chatRequest),
	})
	if err != nil {
		logger.Warnf(ctx, "【Wiki检索】搜索失败：查询=%q，错误=%v", query, err)
		return nil, fmt.Errorf("Wiki搜索失败: %w", err)
	}
	logger.Infof(ctx, "【Wiki检索】搜索完成：查询=%q，返回结果数=%d", query, len(results))

	sources := make([]rag.SourceReference, 0, len(results))
	for i, result := range results {
		sources = append(sources, wikiSourceReference(result, i))
	}
	logger.Infof(ctx, "【Wiki检索】来源转换完成：来源数=%d", len(sources))
	return sources, nil
}

func wikiSourceReference(result servicepkg.WikiSearchResult, index int) rag.SourceReference {
	content := strings.TrimSpace(result.Body)
	if content == "" {
		content = strings.TrimSpace(result.Content)
	}
	if content == "" {
		content = strings.TrimSpace(result.Summary)
	}
	contentRunes := []rune(content)
	if len(contentRunes) > 12000 {
		content = string(contentRunes[:12000])
	}
	referenceID := wikiReferenceID(index)
	return rag.SourceReference{
		SourceType: "wiki", WikiPageID: result.PageID, ReferenceID: referenceID,
		ChunkID: result.ChunkDBID, FileName: result.Title, Title: result.Title,
		Content: content, Score: result.Score, ChunkType: "wiki",
		KnowledgeBaseID: result.LibraryID, KnowledgeBaseName: result.LibraryName,
		KnowledgeBaseLogo: result.LibraryIcon, LibraryID: hashInt64(result.LibraryID),
		LibraryName: result.LibraryName, LibraryIcon: result.LibraryIcon,
		SpaceID: hashInt64(result.SpaceID), SpaceName: result.SpaceName,
		Slug: result.Slug, FileCreatedAt: result.CreatedTime,
		URL:       fmt.Sprintf("/api/wiki/pages/%s", hashInt64(result.PageID)),
		SourceKey: fmt.Sprintf("[Source:%s]", referenceID),
	}
}

func wikiReferenceID(index int) string {
	return fmt.Sprintf("1-%d", index+1)
}

func wikiTopK(chatRequest *ChatRequest) int {
	if chatRequest != nil && chatRequest.SearchConfig != nil && chatRequest.SearchConfig.TopK > 0 {
		return chatRequest.SearchConfig.TopK
	}
	return 20
}

func mergeSearchSources(ragSources, wikiSources []rag.SourceReference, topK int) []rag.SourceReference {
	merged := make([]rag.SourceReference, 0, len(ragSources)+len(wikiSources))
	seen := make(map[string]struct{}, len(ragSources)+len(wikiSources))
	for _, source := range append(append([]rag.SourceReference{}, ragSources...), wikiSources...) {
		key := source.SourceType + ":" + source.ReferenceID
		if source.SourceType == "wiki" {
			key = fmt.Sprintf("wiki:%d:%s", source.WikiPageID, source.ReferenceID)
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		merged = append(merged, source)
	}
	sort.SliceStable(merged, func(i, j int) bool { return merged[i].Score > merged[j].Score })
	usedReferences := make(map[string]struct{}, len(merged))
	for _, source := range merged {
		if source.SourceType != "wiki" && source.ReferenceID != "" {
			usedReferences[source.ReferenceID] = struct{}{}
		}
	}
	nextWikiReference := 0
	for i := range merged {
		if merged[i].SourceType != "wiki" {
			continue
		}
		referenceID := merged[i].ReferenceID
		if referenceID == "" {
			referenceID = wikiReferenceID(nextWikiReference)
		}
		for {
			if _, exists := usedReferences[referenceID]; !exists {
				break
			}
			nextWikiReference++
			referenceID = wikiReferenceID(nextWikiReference)
		}
		merged[i].ReferenceID = referenceID
		merged[i].SourceKey = fmt.Sprintf("[Source:%s]", referenceID)
		usedReferences[referenceID] = struct{}{}
	}
	if topK <= 0 || len(merged) <= topK {
		return merged
	}
	return merged[:topK]
}

func sourceResourceKey(source rag.SourceReference) string {
	switch source.SourceType {
	case "wiki":
		if source.WikiPageID > 0 {
			return fmt.Sprintf("wiki:%d", source.WikiPageID)
		}
		if source.Slug != "" {
			return "wiki:slug:" + source.Slug
		}
		if source.URL != "" {
			return "wiki:url:" + source.URL
		}
	case "file", "knowledge", "":
		if source.FileID > 0 {
			return fmt.Sprintf("file:%d", source.FileID)
		}
		if source.FilePath != "" {
			return "file:path:" + source.FilePath
		}
		if source.FileName != "" {
			return "file:name:" + source.FileName
		}
	}
	return ""
}

// renumberSourceReferences assigns citation sequences by resource after all
// search sources have been merged and ordered. Each Wiki page or document
// file gets a new resource number, and its chunks are numbered within it.
func renumberSourceReferences(sources []rag.SourceReference) []rag.SourceReference {
	resourceIndexes := make(map[string]int, len(sources))
	chunkIndexes := make(map[string]int, len(sources))
	nextResourceIndex := 0
	for i := range sources {
		resourceKey := sourceResourceKey(sources[i])
		if resourceKey == "" {
			continue
		}
		resourceIndex, ok := resourceIndexes[resourceKey]
		if !ok {
			nextResourceIndex++
			resourceIndex = nextResourceIndex
			resourceIndexes[resourceKey] = resourceIndex
		}
		chunkIndexes[resourceKey]++
		referenceID := fmt.Sprintf("%d-%d", resourceIndex, chunkIndexes[resourceKey])
		sources[i].ReferenceID = referenceID
		sources[i].SourceKey = fmt.Sprintf("[Source:%s]", referenceID)
	}
	return sources
}

func normalizeGraphSearchSetting(chatRequest *ChatRequest, agent *model.Agent) {
	normalizeGraphSearchSettingWithContext(context.Background(), chatRequest, agent)
}

func normalizeGraphSearchSettingWithContext(ctx context.Context, chatRequest *ChatRequest, agent *model.Agent) {
	if chatRequest == nil || agent == nil {
		return
	}

	cfg, err := agent.GetGraphSearchConfig()
	if err != nil || cfg == nil {
		if err != nil {
			logger.Warnf(ctx, "【图谱检索】读取图谱配置失败：智能体ID=%d，企业ID=%d，错误=%v", agent.AgentID, agent.Eid, err)
		}
		return
	}

	originalToggle := chatRequest.EnableGraphSearch
	if !cfg.Enable {
		disabled := false
		chatRequest.EnableGraphSearch = &disabled
		logger.Infof(ctx, "【图谱检索】开关归一化：智能体ID=%d，企业ID=%d，原始开关=%s，总开关=关闭，默认值=%t，最终开关=%s，原因=智能体总开关关闭，强制关闭图谱搜索", agent.AgentID, agent.Eid, formatGraphSearchToggle(originalToggle), cfg.DefaultEnable, formatGraphSearchToggle(chatRequest.EnableGraphSearch))
		return
	}

	if chatRequest.EnableGraphSearch == nil {
		defaultEnabled := cfg.DefaultEnable
		chatRequest.EnableGraphSearch = &defaultEnabled
		logger.Infof(ctx, "【图谱检索】开关归一化：智能体ID=%d，企业ID=%d，原始开关=未设置，总开关=开启，默认值=%t，最终开关=%s，原因=请求未设置，沿用智能体默认值", agent.AgentID, agent.Eid, cfg.DefaultEnable, formatGraphSearchToggle(chatRequest.EnableGraphSearch))
		return
	}

	logger.Infof(ctx, "【图谱检索】开关归一化：智能体ID=%d，企业ID=%d，原始开关=%s，总开关=开启，默认值=%t，最终开关=%s，原因=%s", agent.AgentID, agent.Eid, formatGraphSearchToggle(originalToggle), cfg.DefaultEnable, formatGraphSearchToggle(chatRequest.EnableGraphSearch), graphSearchToggleReason(chatRequest.EnableGraphSearch))
}

func formatGraphSearchToggle(toggle *bool) string {
	if toggle == nil {
		return "未设置"
	}
	if *toggle {
		return "开启"
	}
	return "关闭"
}

func graphSearchToggleReason(toggle *bool) string {
	if toggle == nil {
		return "请求未设置，沿用当前状态"
	}
	if *toggle {
		return "请求显式开启"
	}
	return "请求显式关闭"
}

var executeSearchMulti = func(searcher search_tools.Searcher, queries []string, count int) (*search_tools.SearchResult, error) {
	engine := search_tools.NewEngine(
		searcher,
		search_tools.WithMaxWorkers(config.RAG_SEARCH_ENGINE_MAX_WORKERS),
		search_tools.WithTimeout(0),
	)
	return engine.SearchMulti(queries, count)
}

func buildScopeNarrowingStartData(searchTarget *SearchTarget, queriesCount int) map[string]interface{} {
	scopeType := "library"
	beforeLibraryIDsCount := 0
	beforeFileIDsCount := 0

	if searchTarget != nil {
		beforeLibraryIDsCount = len(searchTarget.LibraryIDs)
		beforeFileIDsCount = len(searchTarget.FileIDs)
		if len(searchTarget.FileIDs) > 0 && len(searchTarget.LibraryIDs) == 0 {
			scopeType = "file"
		}
	}

	return map[string]interface{}{
		"scope_type":               scopeType,
		"before_library_ids_count": beforeLibraryIDsCount,
		"before_file_ids_count":    beforeFileIDsCount,
		"queries_count":            queriesCount,
	}
}

// LibraryInfo 用于返回知识库简要信息
type LibraryInfo struct {
	ID   string `json:"id"` // HashID 格式
	Name string `json:"name"`
}

// FileInfo 用于返回文件简要信息
type FileInfo struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

func buildScopeNarrowingEndData(
	narrowedLibraries []rag.EntityScopeNarrowLibrary,
	beforeLibraryCount int,
	beforeFileCount int,
	actualSearchType string,
	actualKeywords []string,
	queriesCount int,
) map[string]interface{} {
	if actualKeywords == nil {
		actualKeywords = []string{}
	}

	var libraries []LibraryInfo
	for _, library := range narrowedLibraries {
		hashID, _ := hashids.Encode(library.ID)
		libraries = append(libraries, LibraryInfo{
			ID:   hashID,
			Name: library.Name,
		})
	}

	data := map[string]interface{}{
		"before_library_count":  beforeLibraryCount,
		"before_file_count":     beforeFileCount,
		"after_library_count":   len(narrowedLibraries),
		"actual_search_type":    actualSearchType,
		"actual_keywords":       actualKeywords,
		"actual_keywords_count": len(actualKeywords),
		"queries_count":         queriesCount,
	}

	if len(libraries) > 0 {
		data["libraries"] = libraries
	}

	return data
}

func rootErrorMessage(err error) string {
	if err == nil {
		return ""
	}
	current := err
	for {
		next := errors.Unwrap(current)
		if next == nil {
			break
		}
		current = next
	}
	return current.Error()
}

func searchResultErrorMessages(errs []error) []string {
	if len(errs) == 0 {
		return nil
	}
	reasons := make([]string, 0, len(errs))
	for _, err := range errs {
		if err == nil {
			continue
		}
		reasons = append(reasons, rootErrorMessage(err))
	}
	return reasons
}

func HandleRAG(c *gin.Context, chatRequest *ChatRequest, ctx context.Context, messageStatus *MessageStatsInfo) ([]rag.SourceReference, error) {
	var err error
	var searchErrors []string
	// 开始处理 RAG 意图
	var queries []string // RAG 意图的查询列表
	InitialQuery := messageStatus.OriginalQuestion
	if messageStatus.RewrittenQuestion != "" {
		InitialQuery = messageStatus.RewrittenQuestion
	}
	if messageStatus.RouterResult != nil && messageStatus.RouterResult.IntentClassificationResult != nil && messageStatus.RouterResult.IntentClassificationResult.Intent == "COMPLEX_AGENT" {
		queries = append(queries, messageStatus.RouterResult.IntentClassificationResult.ExpandedQueries...)
	}

	queries = append(queries, InitialQuery)

	logger.SysLogf("【网络搜索】RAG 查询内容：%v", queries)
	var sources []rag.SourceReference
	var wikiSources []rag.SourceReference
	var wikiErr error
	wikiSearchEnabled := shouldRunWikiSearch(ctx, chatRequest, messageStatus.AgentModel)
	if wikiSearchEnabled {
		// Wiki 与原有知识库共用 knowledge_search 步骤，且步骤必须在实际检索前发出。
		messageStatus.StepSender.SendStartStep(STEP_KNOWLEDGE_SEARCH, "正在查找知识...", map[string]interface{}{
			"queries": queries,
		})
		c.Set("knowledge_search_step_started", true)
		wikiSources, wikiErr = HandleWikiSearchRag(c, queries, chatRequest, ctx, messageStatus)
		if wikiErr != nil {
			logger.Warnf(ctx, "【Wiki检索】搜索失败：%v", wikiErr)
		}
	}

	if chatRequest.DatasetIsSoloWiki() {
		if !knowledgeSearchStepStarted(c) {
			messageStatus.StepSender.SendStartStep(STEP_KNOWLEDGE_SEARCH, "正在查找知识...", map[string]interface{}{
				"queries": queries,
			})
			c.Set("knowledge_search_step_started", true)
		}
		logger.Infof(ctx, "【Wiki检索】当前请求为 Wiki 单文档模式，开始读取页面完整内容")
		sources, err = HandleSoloWikiSearchRag(c, queries, chatRequest, ctx, messageStatus)
	} else if chatRequest.DatasetIsSoloFile() {
		enableWeb := chatRequest.DatasetIsWebSearch()
		if enableWeb {
			logger.Infof(ctx, "【网络搜索】单文件模式+网络搜索混合模式：file_ids=%d，message_file_id=%d，开始并发执行", len(chatRequest.FileIDs), chatRequest.MessageFileID)
			messageStatus.KnowledgeType = model.KnowledgeTypeSingleFile

			var soloSources []rag.SourceReference
			var webSources []rag.SourceReference
			var soloErr, webErr error
			var wg sync.WaitGroup

			// 并发执行搜索
			wg.Add(2)

			// 1. 执行单文件搜索（使用浅拷贝避免并发修改 messageStatus 导致的数据竞争）
			go func() {
				defer wg.Done()
				msCopy := *messageStatus
				soloSources, soloErr = HandleSoloFileSearchRag(c, queries, chatRequest, ctx, &msCopy)
				if soloErr != nil {
					logger.Warnf(ctx, "单文件搜索失败: %v", soloErr)
				}
			}()

			// 2. 执行 Web 搜索
			go func() {
				defer wg.Done()
				// 使用浅拷贝避免并发修改 KnowledgeType 导致的数据竞争
				msCopy := *messageStatus
				webSources, webErr = HandleWebSearchRag(c, queries, chatRequest, ctx, &msCopy)
				if webErr != nil {
					logger.Warnf(ctx, "Web搜索失败: %v", webErr)
				}
			}()

			wg.Wait()

			// 合并策略：单文件结果优先，Web 结果追加补充
			sources = []rag.SourceReference{}
			if soloErr == nil {
				sources = append(sources, soloSources...)
			}
			if webErr == nil {
				sources = append(sources, webSources...)
			}

			// 如果最终没有结果，且有错误发生，返回错误
			if len(sources) == 0 {
				if soloErr != nil {
					logger.Warnf(ctx, "【网络搜索】单文件+网络混合搜索未返回单文件结果：%v", soloErr)
					searchErrors = append(searchErrors, rootErrorMessage(soloErr))
				}
				if webErr != nil {
					logger.Warnf(ctx, "【网络搜索】单文件+网络混合搜索未返回网络搜索结果：%v", webErr)
					searchErrors = append(searchErrors, rootErrorMessage(webErr))
				}
				if soloErr != nil && webErr != nil {
					err = fmt.Errorf("混合搜索失败: 单文件错误[%v], Web错误[%v]", soloErr, webErr)
				} else if soloErr != nil {
					err = soloErr
				} else if webErr != nil {
					err = webErr
				}
			}
		} else {
			logger.Infof(ctx, "【网络搜索】当前请求为单文件模式，未启用网络搜索：file_ids=%d，message_file_id=%d", len(chatRequest.FileIDs), chatRequest.MessageFileID)
			sources, err = HandleSoloFileSearchRag(c, queries, chatRequest, ctx, messageStatus)
		}
	} else {
		if !chatRequest.DatasetIsKnowledgeBase() && !knowledgeSearchStepStarted(c) {
			messageStatus.StepSender.SendStartStep(STEP_KNOWLEDGE_SEARCH, "正在查找知识...", map[string]interface{}{
				"queries": queries,
			})
		}

		enableWeb := chatRequest.DatasetIsWebSearch()
		enableKB := chatRequest.DatasetIsKnowledgeBase()
		logger.Infof(
			ctx,
			"【网络搜索】RAG 分支判定：是否知识库=%t，是否网络搜索=%t，是否单文件=%t，知识库数量=%d，文件数量=%d",
			enableKB,
			enableWeb,
			chatRequest.DatasetIsSoloFile(),
			len(chatRequest.KnowledgeBaseIDs),
			len(chatRequest.FileIDs),
		)

		if enableKB && enableWeb {
			messageStatus.KnowledgeType = model.KnowledgeTypeDatabase

			var kbSources []rag.SourceReference
			var webSources []rag.SourceReference
			var kbErr, webErr error
			var wg sync.WaitGroup

			// 获取 TopK 配置
			topK := 20
			if chatRequest.SearchConfig != nil && chatRequest.SearchConfig.TopK > 0 {
				topK = chatRequest.SearchConfig.TopK
			}

			// 并行执行搜索
			wg.Add(2)

			// 1. 执行知识库搜索
			go func() {
				defer wg.Done()
				kbSources, kbErr = HandleKnowledgeSearchRag(c, queries, chatRequest, ctx, messageStatus)
				if kbErr != nil {
					logger.Warnf(ctx, "知识库搜索失败: %v", kbErr)
				}
			}()

			// 2. 执行 Web 搜索
			go func() {
				defer wg.Done()
				// 使用浅拷贝避免并发修改 KnowledgeType 导致的数据竞争
				// StepSender 等引用类型字段仍然共享，需注意并发写入安全（目前 Web 搜索未发送 Step，暂无风险）
				msCopy := *messageStatus
				webSources, webErr = HandleWebSearchRag(c, queries, chatRequest, ctx, &msCopy)
				if webErr != nil {
					logger.Warnf(ctx, "Web搜索失败: %v", webErr)
				}
			}()

			wg.Wait()

			// 错误处理策略：
			// 1. 如果 KB 成功，忽略 Web 错误（如果 Web 失败）
			// 2. 如果 KB 失败，Web 成功，降级为 Web 搜索
			// 3. 如果都失败，返回 KB 的错误（或者合并错误）

			// 开启重排时，将 KB 和 Web 候选完整合并后统一重排一次；
			// 未开启重排时保持原有 KB 优先、Web 补足 TopK 的语义。
			availableKBSources := []rag.SourceReference(nil)
			availableWebSources := []rag.SourceReference(nil)
			if kbErr == nil {
				availableKBSources = kbSources
			}
			if webErr == nil {
				availableWebSources = webSources
			}
			sources = mergeKnowledgeAndWebSources(
				availableKBSources,
				availableWebSources,
				topK,
				shouldRerank(messageStatus.AgentModel, chatRequest),
			)

			// 如果最终没有结果，且有错误发生，返回错误
			if len(sources) == 0 {
				if kbErr != nil {
					logger.Warnf(ctx, "【网络搜索】混合搜索未返回知识库结果：%v", kbErr)
					searchErrors = append(searchErrors, rootErrorMessage(kbErr))
				}
				if webErr != nil {
					logger.Warnf(ctx, "【网络搜索】混合搜索未返回网络搜索结果：%v", webErr)
					searchErrors = append(searchErrors, rootErrorMessage(webErr))
				}
				if kbErr != nil && webErr != nil {
					err = fmt.Errorf("混合搜索失败: KB错误[%v], Web错误[%v]", kbErr, webErr)
				} else if kbErr != nil {
					err = kbErr
				} else if webErr != nil {
					err = webErr
				}
			}

			// 重置 KnowledgeType 为 Database (或根据结果动态调整，但在 rag_stats 中会重新计算)
			messageStatus.KnowledgeType = model.KnowledgeTypeDatabase

		} else if enableWeb {
			logger.Infof(ctx, "【网络搜索】仅命中网络搜索分支，开始执行网络搜索")
			sources, err = HandleWebSearchRag(c, queries, chatRequest, ctx, messageStatus)
			if err != nil {
				searchErrors = append(searchErrors, rootErrorMessage(err))
			}
		} else if enableKB {
			logger.Infof(ctx, "【网络搜索】仅命中知识库分支，网络搜索未启用")
			messageStatus.KnowledgeType = model.KnowledgeTypeDatabase
			sources, err = HandleKnowledgeSearchRag(c, queries, chatRequest, ctx, messageStatus)
		} else {
			logger.Infof(ctx, "【网络搜索】既未命中知识库也未命中网络搜索分支，跳过检索")
		}
	}

	if wikiErr != nil {
		searchErrors = append(searchErrors, rootErrorMessage(wikiErr))
	}
	sources = mergeSearchSources(sources, wikiSources, wikiTopK(chatRequest))
	if len(sources) > 0 {
		hasWiki, hasFile := false, false
		for _, source := range sources {
			if source.SourceType == "wiki" {
				hasWiki = true
			} else if source.SourceType == "file" || source.FileID > 0 {
				hasFile = true
			}
		}
		if hasWiki {
			switch {
			case hasFile:
				messageStatus.KnowledgeType = model.KnowledgeTypeInternalMixed
				messageStatus.DocumentType = model.DocumentTypeMixed
				messageStatus.DocumentID = 0
			case chatRequest.WikiSearchConfig != nil && len(chatRequest.WikiSearchConfig.WikiPageIDs) > 0:
				messageStatus.KnowledgeType = model.KnowledgeTypeSpecificWiki
				messageStatus.DocumentType = model.DocumentTypeWiki
				messageStatus.DocumentID = firstWikiPageID(sources)
			default:
				messageStatus.KnowledgeType = model.KnowledgeTypeAllWiki
				messageStatus.DocumentType = model.DocumentTypeWiki
				messageStatus.DocumentID = firstWikiPageID(sources)
			}
		}
	}
	// 所有召回来源（KB、Web、图谱）完成合并后，只在这里执行一次最终重排。
	if len(sources) > 0 && shouldRerank(messageStatus.AgentModel, chatRequest) {
		query := messageStatus.RewrittenQuestion
		if query == "" {
			query = messageStatus.OriginalQuestion
		}
		var rerankErr error
		sources, rerankErr = rerankSources(ctx, messageStatus.AgentModel, chatRequest, query, sources)
		if rerankErr != nil {
			logger.Warnf(ctx, "最终重排序失败: %v，使用 TopK 截断后的原始合并结果", rerankErr)
		}
	}
	sources = renumberSourceReferences(sources)

	stepData := map[string]interface{}{
		"sources":                  sources,
		"wiki_result_count":        len(wikiSources), // 兼容旧客户端
		"wiki_search_result_count": len(wikiSources),
		"solo_wiki_chunk_count":    0,
	}
	if chatRequest.DatasetIsSoloWiki() {
		stepData["solo_wiki_chunk_count"] = len(sources)
	}
	if timings, ok := c.Get("rag_stage_timings_ms"); ok {
		if stageTimings, ok := timings.(map[string]int64); ok && len(stageTimings) > 0 {
			stepData["stage_timings_ms"] = stageTimings
		}
	}
	if len(searchErrors) > 0 {
		stepData["search_errors"] = searchErrors
		stepData["error_count"] = len(searchErrors)
		if len(sources) == 0 {
			err = errors.New(strings.Join(searchErrors, "; "))
		}
	}
	messageStatus.StepSender.SendEndStep(STEP_KNOWLEDGE_SEARCH, "知识查找完成", stepData)

	c.Set("rag_sources", sources)
	return sources, err
}

func firstWikiPageID(sources []rag.SourceReference) int64 {
	for _, source := range sources {
		if source.SourceType == "wiki" && source.WikiPageID > 0 {
			return source.WikiPageID
		}
	}
	return 0
}

func knowledgeSearchStepStarted(c *gin.Context) bool {
	if c == nil {
		return false
	}
	started, _ := c.Get("knowledge_search_step_started")
	value, _ := started.(bool)
	return value
}

func mergeKnowledgeAndWebSources(kbSources, webSources []rag.SourceReference, topK int, rerankEnabled bool) []rag.SourceReference {
	if rerankEnabled {
		merged := make([]rag.SourceReference, 0, len(kbSources)+len(webSources))
		merged = append(merged, kbSources...)
		return append(merged, webSources...)
	}

	if topK <= 0 {
		topK = 20
	}
	merged := make([]rag.SourceReference, 0, topK)
	if len(kbSources) > topK {
		kbSources = kbSources[:topK]
	}
	merged = append(merged, kbSources...)
	remaining := topK - len(merged)
	if remaining > len(webSources) {
		remaining = len(webSources)
	}
	if remaining > 0 {
		merged = append(merged, webSources[:remaining]...)
	}
	return merged
}

// ExecuteRAGQuery performs RAG search independently without gin.Context dependency.
// This allows calling RAG from agent loop without full HTTP context.
// Parameters:
//   - ctx: context for cancellation and tracing
//   - query: the search query string
//   - libraryIDs: list of knowledge base IDs to search in (decoded int64)
//   - fileIDs: optional list of file IDs to search in (decoded int64)
//   - eid: enterprise ID
//   - userID: current user id pointer for permission filtering
//   - agent: agent model containing rerank config
//   - searchConfig: optional search configuration (topK, search type, etc.)
//
// Returns SourceReference slice for use in RAG context building.
func ExecuteRAGQuery(
	ctx context.Context,
	query string,
	libraryIDs []int64,
	fileIDs []int64,
	eid int64,
	userID *int64,
	agent *model.Agent,
	searchConfig *model.SearchConfigData,
) ([]rag.SourceReference, error) {
	if query == "" {
		return nil, fmt.Errorf("query cannot be empty")
	}

	if len(libraryIDs) == 0 && len(fileIDs) == 0 {
		return nil, fmt.Errorf("at least one libraryID or fileID is required")
	}

	logger.Infof(ctx, "ExecuteRAGQuery: query_chars=%d, libraries=%d, files=%d, eid=%d", len(query), len(libraryIDs), len(fileIDs), eid)

	// Build search target directly from int64 IDs
	searchTarget := &SearchTarget{
		Type:       "knowledge_base",
		SpaceIDs:   nil, // ExecuteRAGQuery 不涉及 space_ids
		LibraryIDs: libraryIDs,
		FileIDs:    fileIDs,
	}

	// Determine search type and topK
	searchType := "vector" // default
	topK := 20
	if searchConfig != nil {
		if searchConfig.TopK > 0 {
			topK = searchConfig.TopK
		}
		searchType = getSearchType(searchConfig)
	}

	// Build RAG config
	ragConfig := &search_tools.RagConfig{
		Type:         searchType,
		LibraryIDs:   searchTarget.LibraryIDs,
		FileIDs:      searchTarget.FileIDs,
		SearchConfig: searchConfig,
	}

	// Create RagSearcher with user context to enforce permission filtering.
	ragSearcher := search_tools.NewRagSearcher(model.DB, eid, userID, ragConfig)

	// Create search engine and execute
	engine := search_tools.NewEngine(
		ragSearcher,
		search_tools.WithMaxWorkers(config.RAG_SEARCH_ENGINE_MAX_WORKERS),
		search_tools.WithTimeout(0),
	)

	shouldDoRerank := shouldRerankSimple(agent, searchConfig)
	recallTopK := calculateRecallTopK(topK, 1, shouldDoRerank)
	logger.Debugf(ctx, "【RAG检索】召回参数: top_k=%d, rerank=%v, recall_top_k=%d", topK, shouldDoRerank, recallTopK)

	searchResult, err := engine.SearchMulti([]string{query}, recallTopK)
	if err != nil {
		return nil, fmt.Errorf("RAG search failed: %v", err)
	}

	if len(searchResult.Errors) > 0 {
		logger.Warnf(ctx, "RAG search had errors: %v", searchResult.Errors)
	}

	if len(searchResult.Items) == 0 {
		logger.Infof(ctx, "ExecuteRAGQuery: no results found")
		return []rag.SourceReference{}, nil
	}

	// Perform rerank if configured
	finalItems := searchResult.Items
	if shouldDoRerank {
		finalItems, err = performRerank(ctx, agent, query, searchResult.Items)
		if err != nil {
			logger.Warnf(ctx, "Rerank failed: %v, using original results", err)
			finalItems = limitSearchItemsTopK(searchResult.Items, topK)
			logger.Debugf(ctx, "【重排】失败回退截断: top_k=%d, fallback_count=%d", topK, len(finalItems))
		}
	}

	// Convert to SourceReference
	sources := convertToSourceReferences(ctx, eid, searchTarget, finalItems)

	logger.Infof(ctx, "ExecuteRAGQuery completed: found %d sources", len(sources))
	return sources, nil
}

// shouldRerankSimple checks if rerank should be performed (simplified version for ExecuteRAGQuery)
func shouldRerankSimple(agent *model.Agent, searchConfig *model.SearchConfigData) bool {
	// Check Agent config
	if agent != nil {
		rerankConfig, err := agent.GetRerankConfig()
		if err == nil && rerankConfig != nil && rerankConfig.RerankingEnable {
			return true
		}
	}

	// Check request config
	if searchConfig != nil && searchConfig.RerankingEnable {
		return true
	}

	return false
}

// HandleWebSearchRag 处理Web搜索RAG
func HandleWebSearchRag(c *gin.Context, queries []string, chatRequest *ChatRequest, ctx context.Context, messageStatus *MessageStatsInfo) ([]rag.SourceReference, error) {
	messageStatus.KnowledgeType = model.KnowledgeTypeWeb
	// stepSender.SendStartWebSearchStep()

	// 获取企业配置和API密钥
	agent := messageStatus.AgentModel
	logger.Infof(
		ctx,
		"【网络搜索】开始执行网络搜索：查询数量=%d，平台配置ID=%s，平台Key=%s，知识库数量=%d，文件数量=%d",
		len(queries),
		chatRequest.WebSearchConfig.PlatformSettingID,
		chatRequest.WebSearchConfig.PlatformKey,
		len(chatRequest.KnowledgeBaseIDs),
		len(chatRequest.FileIDs),
	)

	// 从PlatformSetting中获取API密钥
	platformSettingID, err := hashids.Decode(chatRequest.WebSearchConfig.PlatformSettingID)
	if err != nil {
		logger.Warnf(ctx, "【网络搜索】解析网络搜索平台配置ID失败：platform_setting_id=%s，错误=%v", chatRequest.WebSearchConfig.PlatformSettingID, err)
		return nil, fmt.Errorf("解析Web搜索平台配置ID失败: %w", err)
	}

	platformSetting, err := model.GetPlatformSettingByIDAndEid(platformSettingID, agent.Eid)
	if err != nil {
		logger.Warnf(ctx, "【网络搜索】获取网络搜索平台配置失败：platform_setting_id=%d，企业ID=%d，错误=%v", platformSettingID, agent.Eid, err)
		return nil, fmt.Errorf("获取Web搜索平台配置失败: %w", err)
	}
	if platformSetting == nil {
		logger.Warnf(ctx, "【网络搜索】网络搜索平台配置不存在：platform_setting_id=%d，企业ID=%d", platformSettingID, agent.Eid)
		return nil, fmt.Errorf("获取Web搜索平台配置失败: 配置不存在")
	}

	// 解析设置中的API密钥
	var apiKeySetting struct {
		APIKey string `json:"api_key"`
	}
	if err := json.Unmarshal([]byte(platformSetting.Setting), &apiKeySetting); err != nil {
		logger.Warnf(ctx, "【网络搜索】解析网络搜索平台配置失败：platform_setting_id=%d，错误=%v", platformSettingID, err)
		return nil, fmt.Errorf("解析Web搜索平台配置失败: %w", err)
	}

	if apiKeySetting.APIKey == "" {
		logger.Warnf(ctx, "【网络搜索】网络搜索平台配置缺少 api_key：platform_setting_id=%d", platformSettingID)
		return nil, fmt.Errorf("Web搜索 , API密钥不能为空")
	}

	// 2. 执行搜索
	// 创建搜索配置
	searchConfig := &search_tools.SearchConfig{
		Wsc: &search_tools.WebSearchConfig{
			ApiType: chatRequest.WebSearchConfig.PlatformKey,
			ApiKey:  apiKeySetting.APIKey,
		},
	}

	// 创建 Web 搜索器
	webSearcher := search_tools.NewWebSearcher(searchConfig)

	// 创建搜索引擎
	engine := search_tools.NewEngine(
		webSearcher,
		search_tools.WithMaxWorkers(config.RAG_SEARCH_ENGINE_MAX_WORKERS),
		search_tools.WithTimeout(0),
	)

	// 每个查询返回的结果数量
	count := 20
	if chatRequest.SearchConfig != nil && chatRequest.SearchConfig.TopK > 0 {
		count = chatRequest.SearchConfig.TopK
	}

	// 执行并发搜索
	logger.SysLogf("【网络搜索】开始执行网络搜索，查询数量：%d", len(queries))
	searchResult, err := engine.SearchMulti(queries, count)

	if err != nil {
		logger.Warnf(ctx, "【网络搜索】执行网络搜索失败：查询数量=%d，返回错误=%v", len(queries), err)
		return nil, fmt.Errorf("Web搜索失败: %w", err)
	}

	if len(searchResult.Errors) > 0 {
		logger.SysErrorf("【网络搜索】网络搜索返回了 %d 个错误，错误详情=%v", len(searchResult.Errors), searchResult.Errors)
	}

	if len(searchResult.Items) == 0 {
		if len(searchResult.Errors) > 0 {
			primaryReasons := searchResultErrorMessages(searchResult.Errors)
			if len(primaryReasons) > 0 {
				logger.Warnf(ctx, "【网络搜索】网络搜索无结果但存在底层错误：%v", primaryReasons)
				return nil, errors.New(strings.Join(primaryReasons, "; "))
			}
		}
		logger.Warnf(ctx, "【网络搜索】网络搜索未返回任何结果：查询数量=%d，平台配置ID=%s", len(queries), chatRequest.WebSearchConfig.PlatformSettingID)
		return nil, fmt.Errorf("Web搜索未返回任何结果")
	}

	logger.Infof(
		ctx,
		"【网络搜索】网络搜索完成：查询数量=%d，返回结果数=%d，错误数=%d，TopK=%d",
		len(queries),
		len(searchResult.Items),
		len(searchResult.Errors),
		count,
	)

	// 3. 处理搜索结果
	// 转换搜索结果为RAG格式
	var sources []rag.SourceReference

	for i, item := range searchResult.Items {
		SourceTk := fmt.Sprintf("B-%d", i+1)
		source := rag.SourceReference{
			SourceType:        "web",
			ReferenceID:       SourceTk,
			ChunkID:           item.ChunkID, // 确保 ChunkID 在本次搜索结果中唯一
			FileID:            item.FileID,
			Content:           item.Content,
			FileName:          item.FileName,
			LibraryName:       item.LibraryName,
			LibraryIcon:       item.LibraryIcon,
			KnowledgeBaseName: item.LibraryName,
			KnowledgeBaseLogo: item.LibraryIcon,
			URL:               item.FilePath,
			FilePath:          item.FilePath,
			SourceKey:         fmt.Sprintf("[Source:%s]", SourceTk),
			Score:             1.0,
			ChunkType:         item.ChunkType,
		}
		sources = append(sources, source)
	}

	// stepSender.EndStartWebSearchStep(sources)

	// 统计Web搜索使用数
	go func() {
		if err := model.IncrementField(agent.Eid, agent.AgentID, "web_search_count", 1); err != nil {
			logger.Warnf(ctx, "【网络搜索】统计网络搜索使用数失败：%v", err)
		}
	}()

	logger.Infof(ctx, "【网络搜索】网络搜索处理完成：查询数量=%d，返回结果数=%d", len(queries), len(sources))

	return sources, nil
}

// HandleSoloFileSearchRag 处理单文件搜索RAG
func HandleSoloFileSearchRag(c *gin.Context, queries []string, chatRequest *ChatRequest, ctx context.Context, messageStatus *MessageStatsInfo) ([]rag.SourceReference, error) {
	eid := messageStatus.AgentModel.Eid
	agent := messageStatus.AgentModel
	messageStatus.KnowledgeType = model.KnowledgeTypeSingleFile
	messageStatus.DocumentType = model.DocumentTypeFile

	fileIdStr := chatRequest.FileIDs[0]
	fileID, err := hashids.TryParseID(fileIdStr)
	messageStatus.KnowledgeScope = fileIdStr

	if err != nil {
		logger.Errorf(ctx, "hash解密失败: %v, 原始字符串: %s", err.Error(), fileIdStr)
		return nil, fmt.Errorf("无效的文件ID格式: %s", fileIdStr)
	}

	file, err := model.GetFileByID(eid, fileID)
	if err != nil {
		return nil, fmt.Errorf("获取文件失败: %v", err)
	}

	messageStatus.SaveFileID = file.ID
	messageStatus.DocumentID = file.ID
	chunks, err := model.GetDocumentChunksByFileID(agent.Eid, fileID, 0, 0)
	if err != nil || len(chunks) == 0 {
		return nil, fmt.Errorf("获取文件分块失败: %v", err)
	}
	fileName := file.GetAccurateFileName()
	// 查询知识库和空间信息（如果有）
	var library model.Library
	var space model.Space
	libraryName := ""
	libraryIcon := ""
	spaceIDHash := ""
	spaceName := ""

	// 如果文件属于某个知识库，查询相关信息
	if file.LibraryID > 0 {
		if err := model.DB.Where("eid = ? AND id = ?", agent.Eid, file.LibraryID).First(&library).Error; err == nil {
			libraryName = library.Name
			libraryIcon = library.Icon

			// 查询空间信息
			if library.SpaceID > 0 {
				if err := model.DB.Where("eid = ? AND id = ?", agent.Eid, library.SpaceID).First(&space).Error; err == nil {
					spaceIDHash = hashInt64(space.ID)
					spaceName = space.Name
				}
			}
		}
	}

	filePath := file.Path
	// 创建 sources 引用参考数据，以便后续进行引用分析
	var sources []rag.SourceReference
	var currentLength int
	for i, chunk := range chunks {
		if currentLength+len(chunk.Content) > MAX_SOLO_FILE_CONTENT_SIZE {
			logger.SysLogf("单文件搜索RAG，文件 %s 内容长度超出最大限制，已截断", fileName)
			break
		}

		chunkRefID := fmt.Sprintf("%d-%d", 1, i+1) // 永远为 1-索引
		source := rag.SourceReference{
			SourceType:        "file",
			ReferenceID:       chunkRefID,
			ChunkID:           chunk.ID,
			FileID:            chunk.FileID,
			FileName:          fileName,
			ChunkType:         chunk.ChunkType,
			Content:           chunk.Content,
			Score:             1.0,
			KnowledgeBaseID:   file.LibraryID,
			KnowledgeBaseName: libraryName,
			KnowledgeBaseLogo: libraryIcon,
			LibraryID:         hashInt64(file.LibraryID),
			LibraryName:       libraryName,
			LibraryIcon:       libraryIcon,
			FileCreatedAt:     file.CreatedTime,
			SourceKey:         fmt.Sprintf("[Source:%s]", chunkRefID),
			SpaceID:           spaceIDHash,
			SpaceName:         spaceName,
			URL:               filePath,
		}
		sources = append(sources, source)
		currentLength += len(chunk.Content)
	}

	return sources, nil
}

// HandleSoloWikiSearchRag 处理 Wiki 单文档模式，直接读取指定页面的可用分片。
func HandleSoloWikiSearchRag(c *gin.Context, queries []string, chatRequest *ChatRequest, ctx context.Context, messageStatus *MessageStatsInfo) ([]rag.SourceReference, error) {
	if chatRequest == nil || chatRequest.WikiSearchConfig == nil || len(chatRequest.WikiSearchConfig.WikiPageIDs) != 1 {
		return nil, fmt.Errorf("Wiki 单文档模式必须指定一个 wiki_page_id")
	}
	pageIDs, err := decodeWikiIDs(chatRequest.WikiSearchConfig.WikiPageIDs)
	if err != nil || len(pageIDs) != 1 {
		return nil, fmt.Errorf("无效的 Wiki 页面 ID")
	}
	pageID := pageIDs[0]
	eid := messageStatus.AgentModel.Eid
	userID := config.GetUserId(c)
	page, err := model.GetWikiPageByID(eid, pageID)
	if err != nil || page == nil || page.Status != model.WikiPageStatusActive {
		return nil, fmt.Errorf("Wiki 页面不存在或不可用")
	}
	permission, err := servicepkg.GetUserPermission(eid, model.RESOURCE_TYPE_WIKI_PAGE, pageID, userID)
	if err != nil || permission < model.PERMISSION_VIEW_ONLY {
		return nil, fmt.Errorf("无权限查看 Wiki 页面")
	}

	var publishedVersion model.WikiPageVersion
	versionErr := model.DB.WithContext(ctx).
		Where("eid = ? AND page_id = ? AND is_published = ?", eid, pageID, true).
		Order("version_no DESC").First(&publishedVersion).Error
	if errors.Is(versionErr, gorm.ErrRecordNotFound) {
		logger.Warnf(ctx, "【Wiki检索】单文档页面没有已发布版本：页面ID=%d，继续使用空上下文", pageID)
		return []rag.SourceReference{}, nil
	}
	if versionErr != nil {
		return nil, fmt.Errorf("读取 Wiki 已发布版本失败: %w", versionErr)
	}

	var chunks []model.WikiPageChunk
	query := model.DB.WithContext(ctx).Where("eid = ? AND wiki_page_id = ? AND wiki_page_version_id = ?", eid, pageID, publishedVersion.ID)
	if err := query.Order("chunk_index ASC").Order("id ASC").Find(&chunks).Error; err != nil {
		return nil, fmt.Errorf("读取 Wiki 页面分片失败: %w", err)
	}
	if len(chunks) == 0 {
		logger.Warnf(ctx, "【Wiki检索】单文档页面暂无可用分片：页面ID=%d，已发布版本ID=%d，继续使用空上下文", pageID, publishedVersion.ID)
		messageStatus.KnowledgeType = model.KnowledgeTypeSpecificWiki
		messageStatus.DocumentType = model.DocumentTypeWiki
		messageStatus.DocumentID = pageID
		messageStatus.KnowledgeScope = hashInt64(pageID)
		return []rag.SourceReference{}, nil
	}

	messageStatus.KnowledgeType = model.KnowledgeTypeSpecificWiki
	messageStatus.DocumentType = model.DocumentTypeWiki
	messageStatus.DocumentID = pageID
	messageStatus.KnowledgeScope = hashInt64(pageID)
	var library model.Library
	if err := model.DB.WithContext(ctx).Where("eid = ? AND id = ?", eid, page.LibraryID).First(&library).Error; err != nil {
		return nil, fmt.Errorf("读取 Wiki 知识库信息失败: %w", err)
	}
	var space model.Space
	if err := model.DB.WithContext(ctx).Where("eid = ? AND id = ?", eid, page.SpaceID).First(&space).Error; err != nil {
		return nil, fmt.Errorf("读取 Wiki 空间信息失败: %w", err)
	}
	sources := make([]rag.SourceReference, 0, len(chunks))
	for i, chunk := range chunks {
		sources = append(sources, soloWikiSourceReference(*page, library, space, chunk, i))
	}
	logger.Infof(ctx, "【Wiki检索】单文档读取完成：页面ID=%d，原始分片数=%d，注入分片数=%d，未执行固定字符截断", pageID, len(chunks), len(sources))
	return sources, nil
}

func soloWikiSourceReference(page model.WikiPage, library model.Library, space model.Space, chunk model.WikiPageChunk, index int) rag.SourceReference {
	referenceID := fmt.Sprintf("1-%d", index+1)
	return rag.SourceReference{
		SourceType: "wiki", WikiPageID: page.ID, ReferenceID: referenceID,
		ChunkID: chunk.ID, ChunkType: "wiki", Content: chunk.Content,
		Score: 1, FileName: page.Title, Title: page.Title, Slug: page.Slug,
		KnowledgeBaseID: page.LibraryID, KnowledgeBaseName: library.Name, KnowledgeBaseLogo: library.Icon,
		LibraryID: hashInt64(page.LibraryID), LibraryName: library.Name, LibraryIcon: library.Icon,
		SpaceID: hashInt64(page.SpaceID), SpaceName: space.Name, FileCreatedAt: page.CreatedTime,
		URL:       fmt.Sprintf("/api/wiki/pages/%s", hashInt64(page.ID)),
		SourceKey: fmt.Sprintf("[Source:%s]", referenceID),
	}
}

// HandleKnowledgeSearchRag 处理知识库搜索（纯逻辑，不包含步骤发送）
func HandleKnowledgeSearchRag(c *gin.Context, queries []string, chatRequest *ChatRequest, ctx context.Context, messageStatus *MessageStatsInfo) ([]rag.SourceReference, error) {
	agent := messageStatus.AgentModel

	// 1. 解析搜索目标
	searchTarget, err := resolveSearchTargets(
		agent.Eid,
		chatRequest.SpaceIDs,
		chatRequest.KnowledgeBaseIDs,
		chatRequest.FileIDs,
	)
	if err != nil {
		return nil, fmt.Errorf("解析搜索目标失败: %v", err)
	}

	if searchTarget.Type == "" {
		return nil, fmt.Errorf("未指定搜索目标")
	}

	// 设置知识范围和知识类型（多源记录格式）
	var scopeParts []string
	if len(chatRequest.SpaceIDs) > 0 {
		scopeParts = append(scopeParts, "space:"+strings.Join(chatRequest.SpaceIDs, ","))
	}
	if len(chatRequest.KnowledgeBaseIDs) > 0 {
		scopeParts = append(scopeParts, "kb:"+strings.Join(chatRequest.KnowledgeBaseIDs, ","))
	}
	if len(chatRequest.FileIDs) > 0 {
		scopeParts = append(scopeParts, "file:"+strings.Join(chatRequest.FileIDs, ","))
	}
	if len(scopeParts) > 0 {
		messageStatus.KnowledgeScope = strings.Join(scopeParts, "|")
		messageStatus.KnowledgeType = model.KnowledgeTypeSpecificKB
	}

	// 2. 构建搜索配置
	searchType := "vector" // 默认
	topK := 20
	if chatRequest.SearchConfig != nil {
		if chatRequest.SearchConfig.TopK > 0 {
			topK = chatRequest.SearchConfig.TopK
		}
		searchType = getSearchType(chatRequest.SearchConfig)
	}

	// 3. 准备实体关键词
	actualKeywords := []string{}
	actualSearchType := searchType
	if messageStatus.RouterResult != nil && messageStatus.RouterResult.IntentClassificationResult != nil {
		if len(messageStatus.RouterResult.IntentClassificationResult.Keywords) > 0 {
			actualKeywords = append([]string(nil), messageStatus.RouterResult.IntentClassificationResult.Keywords...)
		}
	}

	userID := config.GetUserId(c)

	// ========== 阶段 1: 实体范围收敛 ==========
	// 如果请求已指定 file_id，则跳过收敛（文件级检索不需要收敛）
	messageStatus.StepSender.SendStartStep(STEP_SCOPE_NARROWING, "正在搜索文档...", buildScopeNarrowingStartData(searchTarget, len(queries)))

	searchService := rag.NewSearchService(model.DB)
	preprocessReq := &rag.SearchRequest{
		Query:                    queries[0],
		LibraryIDs:               searchTarget.LibraryIDs,
		FileIDs:                  searchTarget.FileIDs,
		EntityKeywords:           actualKeywords,
		DocumentType:             "",
		SkipEntityScopeNarrowing: len(searchTarget.FileIDs) > 0,
	}
	if messageStatus.RouterResult != nil && messageStatus.RouterResult.IntentClassificationResult != nil {
		preprocessReq.DocumentType = strings.TrimSpace(messageStatus.RouterResult.IntentClassificationResult.DocumentType)
	}

	narrowResult, preprocessErr := searchService.PreprocessEntityScope(agent.Eid, preprocessReq)
	if preprocessErr != nil {
		logger.Warnf(ctx, "【RAG检索】实体范围预处理失败: %v", preprocessErr)
	}

	// 发送缩小范围完成步骤（在向量搜索前）
	messageStatus.StepSender.SendEndStep(STEP_SCOPE_NARROWING, "文档缩小范围完成", buildScopeNarrowingEndData(
		narrowResult.NarrowedLibraries,
		len(searchTarget.LibraryIDs),
		len(searchTarget.FileIDs),
		actualSearchType,
		actualKeywords,
		len(queries),
	))

	// ========== 阶段 2: 向量搜索 ==========
	// 使用收敛后的范围构建 RagSearcher
	effectiveLibraryIDs := narrowResult.NarrowedLibraryIDs
	effectiveFileIDs := narrowResult.NarrowedFileIDs

	ragConfig := &search_tools.RagConfig{
		Type:         searchType,
		LibraryIDs:   effectiveLibraryIDs,
		FileIDs:      effectiveFileIDs,
		SearchConfig: chatRequest.SearchConfig,
	}

	if !knowledgeSearchStepStarted(c) {
		messageStatus.StepSender.SendStartStep(STEP_KNOWLEDGE_SEARCH, "正在查找知识...", map[string]interface{}{
			"queries": queries,
		})
	}

	ragSearcher := search_tools.NewRagSearcher(model.DB, agent.Eid, &userID, ragConfig)

	// 创建搜索引擎并执行搜索
	shouldDoRerank := shouldRerank(agent, chatRequest)
	recallTopK := calculateRecallTopK(topK, len(queries), shouldDoRerank)
	logger.Debugf(ctx, "【RAG检索】召回参数: top_k=%d, query_count=%d, rerank=%v, recall_top_k=%d",
		topK, len(queries), shouldDoRerank, recallTopK)

	searchResult, err := executeSearchMulti(ragSearcher, queries, recallTopK)
	if err != nil {
		return nil, fmt.Errorf("执行搜索失败: %v", err)
	}
	c.Set("rag_stage_timings_ms", ragSearcher.GetLastSearchTimings())

	if len(searchResult.Errors) > 0 {
		logger.Warnf(ctx, "搜索过程中出现错误: %v", searchResult.Errors)
	}

	// 知识库和 Web 结果会在 relay 汇总后统一执行一次最终重排。
	// 开启重排时保留完整召回窗口；关闭重排时仍在这里应用最终 TopK。
	finalItems := selectKnowledgeItemsForFinalRerank(searchResult.Items, topK, shouldDoRerank)

	// 转换为 SourceReference 格式
	sources := convertToSourceReferences(ctx, agent.Eid, searchTarget, finalItems)

	var graphSource *rag.SourceReference
	if shouldRunGraphSearch(ctx, chatRequest, messageStatus.AgentModel) && len(actualKeywords) > 0 {
		graphAggregateService := rag.NewGraphAggregateService(model.DB)
		builtGraphSource, graphAggregateResult, graphErr := graphAggregateService.BuildAggregateSourceByKeywords(agent.Eid, actualKeywords, &rag.GraphAggregateScope{
			LibraryIDs: effectiveLibraryIDs,
			FileIDs:    effectiveFileIDs,
			UserID:     &userID,
		})
		if graphErr != nil {
			logger.Warnf(ctx, "图谱聚合 source 生成失败: %v", graphErr)
		} else {
			graphSource = builtGraphSource
			sources = appendGraphAggregateSource(sources, graphSource)
			if graphSource != nil {
				logger.Infof(
					ctx,
					"【图谱检索】聚合完成: eid=%d, 关键词=%v, %s, chunk类型=%s, 引用编号=%s",
					agent.Eid,
					actualKeywords,
					rag.BuildGraphAggregateLogSummary(graphAggregateResult),
					graphSource.ChunkType,
					graphSource.ReferenceID,
				)
			}
		}
	}

	if len(sources) == 0 {
		logger.Infof(ctx, "未搜索到相关内容")
		return []rag.SourceReference{}, nil
	}

	logger.Infof(ctx, "知识库搜索完成: 搜索到%d个结果", len(sources))
	return sources, nil
}

func selectKnowledgeItemsForFinalRerank(items []*search_tools.SearchItem, topK int, rerankEnabled bool) []*search_tools.SearchItem {
	if rerankEnabled {
		return items
	}
	return limitSearchItemsTopK(items, topK)
}

// getSearchType 获取搜索类型
func getSearchType(config *model.SearchConfigData) string {
	if config.Vector && !config.Fulltext {
		return "vector"
	}
	if !config.Vector && config.Fulltext {
		return "fulltext"
	}
	if config.Vector && config.Fulltext {
		return "hybrid"
	}
	return "vector" // 默认
}

// shouldRerank 判断是否需要重排序
func shouldRerank(agent *model.Agent, chatRequest *ChatRequest) bool {
	// 检查 Agent 配置
	rerankConfig, err := agent.GetRerankConfig()
	if err == nil && rerankConfig != nil && rerankConfig.RerankingEnable {
		return true
	}

	// 检查请求配置
	if chatRequest.SearchConfig != nil && chatRequest.SearchConfig.RerankingEnable {
		return true
	}

	return false
}

// performRerank 执行重排序
func performRerank(
	ctx context.Context,
	agent *model.Agent,
	query string,
	items []*search_tools.SearchItem,
) ([]*search_tools.SearchItem, error) {

	rerankConfig, err := agent.GetRerankConfig()
	if err != nil || rerankConfig == nil {
		return items, fmt.Errorf("获取重排配置失败")
	}
	logger.Debugf(ctx, "【重排】进入重排流程: eid=%d, agent_id=%d, query_chars=%d, input_items=%d, rerank_model=%s, rerank_model_name=%s, rerank_channel_id=%d",
		agent.Eid, agent.AgentID, len(query), len(items), rerankConfig.RerankModel, rerankConfig.RerankModelName, rerankConfig.RerankChannelId)

	// 转换为 RAG 格式
	ragItems := make([]rag.SearchResultItem, len(items))
	for i, item := range items {
		ragItems[i] = toRagSearchResultItem(item)
	}

	// 执行重排
	rerankService := rag.NewRerankService(model.DB)
	rerankedItems, err := rerankService.PerformRerank(
		ctx,
		agent.Eid,
		query,
		ragItems,
		rerankConfig,
	)
	if err != nil {
		return items, err
	}
	logger.Debugf(ctx, "【重排】重排服务返回: input=%d, output=%d", len(items), len(rerankedItems))

	// 转换回 SearchItem 格式
	result := make([]*search_tools.SearchItem, len(rerankedItems))
	for i, item := range rerankedItems {
		result[i] = toSearchItem(item)
	}

	return result, nil
}

// convertToSourceReferences 转换为 SourceReference 格式
func convertToSourceReferences(
	ctx context.Context,
	eid int64,
	searchTarget *SearchTarget,
	items []*search_tools.SearchItem,
) []rag.SourceReference {

	// 创建ID映射
	fileIDMap, chunkIDMap := createIDMapping(items)

	// 批量获取扩展信息
	extendedInfos := getExtendedChunkInfoFromItems(eid, items)

	sources := make([]rag.SourceReference, 0, len(items))
	for _, item := range items {
		mappedFileID := fileIDMap[item.FileID]
		mappedChunkID := chunkIDMap[item.ChunkID]
		chunkRefID := fmt.Sprintf("%d-%d", mappedFileID, mappedChunkID)

		extInfo := extendedInfos[item.ChunkID]

		source := rag.SourceReference{
			SourceType:        "file",
			ReferenceID:       chunkRefID,
			ChunkID:           item.ChunkID,
			FileID:            item.FileID,
			FileName:          item.FileName,
			FilePath:          item.FilePath,
			ChunkType:         item.ChunkType,
			Content:           item.Content,
			Score:             item.Score,
			KnowledgeBaseID:   extInfo.KnowledgeBaseID,
			KnowledgeBaseName: extInfo.KnowledgeBaseName,
			KnowledgeBaseLogo: extInfo.KnowledgeBaseLogo,
			LibraryID:         hashInt64(extInfo.KnowledgeBaseID),
			LibraryName:       extInfo.KnowledgeBaseName,
			LibraryIcon:       extInfo.KnowledgeBaseLogo,
			FileCreatedAt:     extInfo.FileCreatedAt,
			SourceKey:         fmt.Sprintf("[Source:%s]", chunkRefID),
			SpaceID:           hashInt64(extInfo.SpaceID),
			SpaceName:         extInfo.SpaceName,
		}
		if source.ChunkType == "" || source.FileName == "" || source.FilePath == "" {
			logger.Debugf(
				ctx,
				"【RAG检索】来源转换结果: reference_id=%s, chunk_id=%d, file_id=%d, library_id=%d, chunk_type=%q, file_name=%q, file_path=%q, score=%.6f",
				source.ReferenceID,
				source.ChunkID,
				source.FileID,
				source.KnowledgeBaseID,
				source.ChunkType,
				source.FileName,
				source.FilePath,
				source.Score,
			)
		}
		sources = append(sources, source)
	}

	return sources
}

func toRagSearchResultItem(item *search_tools.SearchItem) rag.SearchResultItem {
	if item == nil {
		return rag.SearchResultItem{}
	}
	return rag.SearchResultItem{
		ChunkID:       item.ChunkID,
		FileID:        item.FileID,
		LibraryID:     item.LibraryID,
		FilePath:      item.FilePath,
		FileName:      item.FileName,
		LibraryName:   item.LibraryName,
		LibraryIcon:   item.LibraryIcon,
		FileCreatedAt: item.FileCreatedAt,
		SpaceID:       item.SpaceID,
		SpaceName:     item.SpaceName,
		ChunkType:     item.ChunkType,
		Content:       item.Content,
		Score:         item.Score,
	}
}

func toSearchItem(item rag.SearchResultItem) *search_tools.SearchItem {
	return &search_tools.SearchItem{
		ChunkID:       item.ChunkID,
		FileID:        item.FileID,
		LibraryID:     item.LibraryID,
		FilePath:      item.FilePath,
		FileName:      item.FileName,
		LibraryName:   item.LibraryName,
		LibraryIcon:   item.LibraryIcon,
		FileCreatedAt: item.FileCreatedAt,
		SpaceID:       item.SpaceID,
		SpaceName:     item.SpaceName,
		ChunkType:     item.ChunkType,
		Content:       item.Content,
		Score:         item.Score,
	}
}

// createIDMapping 创建ID映射（从1开始）
func createIDMapping(items []*search_tools.SearchItem) (map[int64]int, map[int64]int) {
	fileIDMap := make(map[int64]int)
	chunkIDMap := make(map[int64]int)

	fileCounter := 1
	fileChunkCounters := make(map[int64]int)

	// 先收集所有唯一的FileID
	for _, item := range items {
		if _, exists := fileIDMap[item.FileID]; !exists {
			fileIDMap[item.FileID] = fileCounter
			fileChunkCounters[item.FileID] = 1
			fileCounter++
		}
	}

	// 为每个分片分配ID
	for _, item := range items {
		if _, exists := chunkIDMap[item.ChunkID]; !exists {
			chunkIDMap[item.ChunkID] = fileChunkCounters[item.FileID]
			fileChunkCounters[item.FileID]++
		}
	}

	return fileIDMap, chunkIDMap
}

// getExtendedChunkInfoFromItems 从 SearchItem 批量获取扩展信息
func getExtendedChunkInfoFromItems(eid int64, items []*search_tools.SearchItem) map[int64]ChunkExtendedInfo {
	chunkIDs := make([]int64, len(items))
	for i, item := range items {
		chunkIDs[i] = item.ChunkID
	}

	// 复用现有的 getExtendedChunkInfo 函数（需要适配）
	ragItems := make([]rag.SearchResultItem, len(items))
	for i, item := range items {
		ragItems[i] = rag.SearchResultItem{
			ChunkID:       item.ChunkID,
			FileID:        item.FileID,
			LibraryID:     item.LibraryID,
			FilePath:      item.FilePath,
			FileName:      item.FileName,
			LibraryName:   item.LibraryName,
			LibraryIcon:   item.LibraryIcon,
			FileCreatedAt: item.FileCreatedAt,
			SpaceID:       item.SpaceID,
			SpaceName:     item.SpaceName,
			ChunkType:     item.ChunkType,
			Content:       item.Content,
			Score:         item.Score,
		}
	}

	return getExtendedChunkInfo(eid, ragItems)
}
