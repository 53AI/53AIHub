package relay

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/53AI/53AIHub/common/ctxkey"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/tokenlimit"
	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/middleware"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/search_tools"
	servicepkg "github.com/53AI/53AIHub/service"
	agentexec "github.com/53AI/53AIHub/service/agent"
	"github.com/53AI/53AIHub/service/hub_adaptor/custom"
	CustomOpenAI "github.com/53AI/53AIHub/service/hub_adaptor/custom_openai"
	"github.com/53AI/53AIHub/service/hub_adaptor/openai"
	"github.com/53AI/53AIHub/service/rag"
	"github.com/gin-gonic/gin"
	relay_model "github.com/songquanpeng/one-api/relay/model"
	"github.com/songquanpeng/one-api/relay/relaymode"
)

const (
	rerankRecallMultiplier = 2
	// rerankRecallMax 单查询召回上限：限制多问题拆解场景下各子查询独立召回、合并后的候选膨胀
	// （此前 200 时单查询最多召回 100，多查询合并可达 150+，rerank 成本与淘汰噪声同步放大）。
	// finalTopK 超过该值时由下方下限保护兜底，保证 rerank 输入不小于最终输出。
	rerankRecallMax = 50
)

type ragSourcePlan struct {
	LocalWebSearch bool
	ModelSearch    bool
	KnowledgeBase  bool
	SoloFile       bool
	SoloWiki       bool
	WikiSearch     bool
}

type ragSearchBranchResult struct {
	sources []rag.SourceReference
	err     error
}

func runRAGSearchBranches(searches ...func() ([]rag.SourceReference, error)) []ragSearchBranchResult {
	results := make([]ragSearchBranchResult, len(searches))
	var wg sync.WaitGroup
	for index, search := range searches {
		wg.Add(1)
		go func(index int, search func() ([]rag.SourceReference, error)) {
			defer wg.Done()
			results[index].sources, results[index].err = search()
		}(index, search)
	}
	wg.Wait()
	return results
}

func ragSearchStartMessage(plan ragSourcePlan) string {
	var scopes []string
	if plan.KnowledgeBase {
		scopes = append(scopes, "所选知识库")
	}
	if plan.WikiSearch {
		scopes = append(scopes, "Wiki")
	} else if plan.SoloWiki {
		scopes = append(scopes, "所选 Wiki 页面")
	}
	if plan.SoloFile {
		scopes = append(scopes, "所选文件")
	}
	if plan.LocalWebSearch || plan.ModelSearch {
		scopes = append(scopes, "全网")
	}
	if len(scopes) == 0 {
		return ""
	}
	if len(scopes) == 1 {
		return "正在搜索" + scopes[0] + "..."
	}
	return "正在搜索" + strings.Join(scopes[:len(scopes)-1], "、") + "和" + scopes[len(scopes)-1] + "..."
}

const nativeWebSearchUsageContextKey = "native_web_search_usage"

func calculateRecallTopK(finalTopK int, _ int, rerankEnabled bool) int {
	if finalTopK <= 0 {
		finalTopK = 20
	}
	if !rerankEnabled {
		return finalTopK
	}

	recallTopK := finalTopK * rerankRecallMultiplier
	if recallTopK > rerankRecallMax {
		recallTopK = rerankRecallMax
	}
	// 下限保护：cap 后仍须保证 rerank 输入不小于最终输出，避免召回不足
	if recallTopK < finalTopK {
		recallTopK = finalTopK
	}
	return recallTopK
}

func limitSearchItemsTopK(items []*search_tools.SearchItem, topK int) []*search_tools.SearchItem {
	if topK <= 0 || len(items) <= topK {
		return items
	}
	return items[:topK]
}

func limitDocumentQAQueries(queries []string, maxQueries int) []string {
	if maxQueries <= 0 {
		return nil
	}
	capacity := maxQueries
	if len(queries) < capacity {
		capacity = len(queries)
	}
	result := make([]string, 0, capacity)
	seen := make(map[string]struct{}, len(queries))
	for _, query := range queries {
		query = strings.TrimSpace(query)
		if query == "" {
			continue
		}
		if _, exists := seen[query]; exists {
			continue
		}
		seen[query] = struct{}{}
		result = append(result, query)
		if len(result) == maxQueries {
			break
		}
	}
	return result
}

// retrievalQueries preserves ordinary single-query behavior while allowing an
// enhanced SIMPLE_RAG to use the expansion already produced by classification.
func retrievalQueries(initial string, intent *rag.IntentClassificationResult) []string {
	queries := []string{}
	if intent != nil && (intent.Intent == "COMPLEX_AGENT" || (intent.Intent == "SIMPLE_RAG" && intent.EnhancedRetrieval)) {
		expanded := intent.ExpandedQueries
		if intent.Intent == "SIMPLE_RAG" && len(expanded) > 2 {
			expanded = expanded[:2]
		}
		queries = append(queries, expanded...)
	}
	queries = append(queries, initial)
	queries = limitDocumentQAQueries(queries, len(queries))
	if len(queries) == 0 {
		return []string{initial}
	}
	return queries
}

func retrievalScopeQuery(original, rewritten string, queries []string) string {
	if rewritten != "" {
		return rewritten
	}
	if original != "" {
		return original
	}
	return queries[0]
}

// documentCluesAvailable requires the document and target terms to occur in
// the same file. A missing clue is not proof that the document lacks the field.
func documentCluesAvailable(sources []rag.SourceReference, intent *rag.IntentClassificationResult) bool {
	if intent != nil && intent.EnhancedRetrieval && (strings.TrimSpace(intent.DocumentType) == "" || len(intent.TargetKeywords) == 0) {
		return false
	}
	if intent == nil || strings.TrimSpace(intent.DocumentType) == "" || len(intent.TargetKeywords) == 0 {
		return len(sources) > 0
	}
	found := false
	for _, source := range sources {
		if sourceCategory(source) != "document" || source.FileID == 0 {
			continue
		}
		content := strings.ToLower(source.FileName + " " + source.Title)
		if !strings.Contains(content, strings.ToLower(intent.DocumentType)) {
			continue
		}
		// Require the document identity and all requested field clues in one
		// coherent line/row. Pooling chunks or sentences can pair unrelated fields.
		for _, row := range strings.FieldsFunc(source.Content, func(r rune) bool {
			return r == '\n' || r == '\r' || r == '。' || r == '；' || r == ';' || r == '，' || r == ','
		}) {
			row = strings.ToLower(row)
			all := true
			for _, term := range intent.TargetKeywords {
				term = strings.ToLower(strings.TrimSpace(term))
				if term != "" && !strings.Contains(row, term) {
					all = false
					break
				}
			}
			if all {
				found = true
			}
		}
	}
	return found
}

func supplementalRetrievalQueries(intent *rag.IntentClassificationResult, previous []string, original, rewritten string) []string {
	if intent == nil {
		return nil
	}
	possible := append([]string{}, intent.Keywords...)
	possible = append(possible, intent.DocumentType)
	possible = append(possible, intent.TargetKeywords...)
	var terms []string
	for _, term := range possible {
		term = strings.TrimSpace(term)
		if term != "" && (strings.Contains(strings.ToLower(original), strings.ToLower(term)) || strings.Contains(strings.ToLower(rewritten), strings.ToLower(term))) {
			terms = append(terms, term)
		}
	}
	terms = limitDocumentQAQueries(terms, len(terms))
	query := strings.TrimSpace(strings.Join(terms, " "))
	if query == "" {
		return nil
	}
	for _, existing := range previous {
		if strings.EqualFold(strings.Join(strings.Fields(existing), " "), strings.Join(strings.Fields(query), " ")) {
			return nil
		}
	}
	return []string{query}
}

func mergeSupplementalSources(first, extra []rag.SourceReference) []rag.SourceReference {
	result := append([]rag.SourceReference(nil), first...)
	seen := make(map[string]bool, len(first)+len(extra))
	key := func(source rag.SourceReference) string {
		if source.ChunkID != 0 {
			return fmt.Sprintf("%s:%d:%d", sourceCategory(source), source.FileID, source.ChunkID)
		}
		return fmt.Sprintf("%s:%d:%s:%s", sourceCategory(source), source.FileID, source.URL, source.Content)
	}
	for _, source := range first {
		seen[key(source)] = true
	}
	for _, source := range extra {
		if !seen[key(source)] {
			result = append(result, source)
			seen[key(source)] = true
		}
	}
	return result
}

// rankDocumentClues changes ordering only; missing clues never discard a source.
func rankDocumentClues(sources []rag.SourceReference, intent *rag.IntentClassificationResult) {
	if intent == nil || !intent.EnhancedRetrieval || strings.TrimSpace(intent.DocumentType) == "" {
		return
	}
	score := func(source rag.SourceReference) int {
		if sourceCategory(source) != "document" {
			return 0
		}
		text := strings.ToLower(source.FileName + " " + source.Title + " " + source.Content)
		weight := 0
		if strings.Contains(text, strings.ToLower(intent.DocumentType)) {
			weight += 2
		}
		for _, term := range append(append([]string(nil), intent.Keywords...), intent.TargetKeywords...) {
			term = strings.ToLower(strings.TrimSpace(term))
			if term != "" && strings.Contains(text, term) {
				weight++
			}
		}
		return weight
	}
	// A clue may promote a document by at most one adjacent position. It cannot
	// leap over Wiki/Web results or turn a soft signal into an absolute filter.
	for i := 1; i < len(sources); i++ {
		if sourceCategory(sources[i]) == "document" && sourceCategory(sources[i-1]) == "document" && score(sources[i]) > score(sources[i-1]) {
			sources[i-1], sources[i] = sources[i], sources[i-1]
		}
	}
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
	wikiRecallTopK := calculateRecallTopK(
		wikiTopK(chatRequest),
		len(queries),
		shouldRerank(messageStatus.AgentModel, chatRequest),
	)
	results, err := servicepkg.NewWikiSearchService(model.DB).Search(ctx, servicepkg.WikiSearchRequest{
		Eid:         messageStatus.AgentModel.Eid,
		UserID:      config.GetUserId(c),
		Query:       query,
		SpaceIDs:    enabledSpaceIDs,
		LibraryIDs:  libraryIDs,
		WikiPageIDs: pageIDs,
		TopK:        wikiRecallTopK,
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
	// Keep the matched chunk as the retrieval source; the selected Wiki page is
	// expanded to its version body only after final source selection.
	content := strings.TrimSpace(result.Content)
	if content == "" && result.ChunkID == "" {
		content = strings.TrimSpace(result.Body)
	}
	if content == "" && result.ChunkID == "" {
		content = strings.TrimSpace(result.Summary)
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
		URL:               fmt.Sprintf("/api/wiki/pages/%s", hashInt64(result.PageID)),
		SourceKey:         fmt.Sprintf("[Source:%s]", referenceID),
		WikiPageVersionID: result.WikiPageVersionID, WikiChunkID: result.ChunkID,
		WikiHeadingPath: result.HeadingPath,
	}
}

func wikiSourceWithPageContext(source rag.SourceReference, pageContext servicepkg.WikiPageContext) rag.SourceReference {
	source.Content = pageContext.Body
	if pageContext.Title != "" {
		source.Title = pageContext.Title
		source.FileName = pageContext.Title
	}
	source.WikiPageVersionID = pageContext.VersionID
	if strings.TrimSpace(pageContext.Body) == "" {
		source.WikiCoverage = "unavailable"
	} else {
		source.WikiCoverage = "complete"
	}
	source.WikiMatchedChunkDBIDs = append([]int64(nil), pageContext.MatchedChunkDBIDs...)
	source.WikiMatchedChunkIDs = append([]string(nil), pageContext.MatchedChunkIDs...)
	source.WikiChunks = make([]rag.WikiSourceChunk, 0, len(pageContext.Chunks))
	source.WikiChunkDBIDs = make([]int64, 0, len(pageContext.Chunks))
	source.WikiChunkIDs = make([]string, 0, len(pageContext.Chunks))
	for _, chunk := range pageContext.Chunks {
		source.WikiChunks = append(source.WikiChunks, rag.WikiSourceChunk{
			DBID: chunk.ID, ChunkID: chunk.ChunkID, HeadingPath: chunk.HeadingPath, Content: chunk.Content,
		})
		source.WikiChunkDBIDs = append(source.WikiChunkDBIDs, chunk.ID)
		source.WikiChunkIDs = append(source.WikiChunkIDs, chunk.ChunkID)
	}
	return source
}

func fitWikiSourceToBudget(source rag.SourceReference, budget int, modelName, question string) rag.SourceReference {
	if source.SourceType != "wiki" || source.Content == "" {
		return source
	}
	if budget <= 0 {
		source.Content = ""
		source.WikiCoverage = "unavailable"
		return source
	}
	if openai.CountTokenText(CreateRetrievalContext([]rag.SourceReference{source}), modelName) <= budget {
		source.WikiCoverage = "complete"
		return source
	}

	var relevant strings.Builder
	selectedHeadings := make(map[string]struct{})
	selectedChunks := make(map[string]struct{})
	for _, chunk := range source.WikiChunks {
		if source.WikiHeadingPath != "" && chunk.HeadingPath == source.WikiHeadingPath {
			selectedHeadings[chunk.HeadingPath] = struct{}{}
		}
	}
	if len(selectedHeadings) == 0 {
		terms := wikiBudgetQueryTerms(question)
		for _, chunk := range source.WikiChunks {
			text := strings.ToLower(chunk.HeadingPath + " " + chunk.Content)
			for _, term := range terms {
				if strings.Contains(text, term) {
					if chunk.HeadingPath != "" {
						selectedHeadings[chunk.HeadingPath] = struct{}{}
					} else {
						selectedChunks[chunk.ChunkID] = struct{}{}
					}
					break
				}
			}
		}
	}
	if len(selectedHeadings) == 0 && len(selectedChunks) == 0 {
		selectedChunks[source.WikiChunkID] = struct{}{}
	}
	for _, chunk := range source.WikiChunks {
		_, headingSelected := selectedHeadings[chunk.HeadingPath]
		_, chunkSelected := selectedChunks[chunk.ChunkID]
		if headingSelected || chunkSelected {
			relevant.WriteString(chunk.Content)
			relevant.WriteString("\n")
		}
	}
	if relevant.Len() == 0 {
		source.Content = ""
		source.WikiCoverage = "unavailable"
		return source
	}

	source.WikiCoverage = "partial"
	content := relevant.String()
	contentBudget := budget - openai.CountTokenText(CreateRetrievalContext([]rag.SourceReference{{
		SourceType: source.SourceType, WikiPageID: source.WikiPageID, ReferenceID: source.ReferenceID,
		Title: source.Title, FileName: source.FileName, WikiCoverage: source.WikiCoverage,
	}}), modelName) - 8
	for contentBudget > 0 {
		source.Content = tokenlimit.TruncateContent(content, contentBudget)
		if openai.CountTokenText(CreateRetrievalContext([]rag.SourceReference{source}), modelName) <= budget {
			return source
		}
		actualTokens := openai.CountTokenText(source.Content, modelName)
		nextBudget := contentBudget * budget / (actualTokens + 1)
		if nextBudget >= contentBudget {
			nextBudget = contentBudget - 1
		}
		contentBudget = nextBudget
	}
	source.Content = ""
	source.WikiCoverage = "unavailable"
	return source
}

func wikiBudgetQueryTerms(question string) []string {
	terms := extractQueryKeywords([]string{question})
	seen := make(map[string]struct{}, len(terms))
	for _, term := range terms {
		seen[term] = struct{}{}
	}
	runes := []rune(strings.ToLower(question))
	for i := 0; i+1 < len(runes); i++ {
		if unicode.Is(unicode.Han, runes[i]) && unicode.Is(unicode.Han, runes[i+1]) {
			term := string(runes[i : i+2])
			if _, exists := seen[term]; !exists {
				seen[term] = struct{}{}
				terms = append(terms, term)
			}
		}
	}
	return terms
}

func fitWikiSourcesToBudget(sources []rag.SourceReference, availableTokens int, modelName, question string) []rag.SourceReference {
	result := make([]rag.SourceReference, len(sources))
	copy(result, sources)
	for i := range result {
		if result[i].SourceType != "wiki" {
			continue
		}
		if result[i].Content != "" {
			result[i] = fitWikiSourceToBudget(result[i], availableTokens, modelName, question)
			availableTokens -= openai.CountTokenText(CreateRetrievalContext([]rag.SourceReference{result[i]}), modelName)
		}
		result[i].WikiChunks = nil
	}
	return result
}

func wikiContextInputBudget(ctx context.Context, channelID int64, channelConfig, modelName string, existingTokens int) int {
	budget := tokenlimit.ComputeBudget(ctx, channelID, channelConfig, modelName, 0, tokenlimit.DefaultOutputBudget, 0)
	available := budget.InputAvailable - existingTokens
	if available < 0 {
		return 0
	}
	return available
}

func budgetWikiSourcesForRequest(ctx context.Context, c *gin.Context, request *ChatRequest, status *MessageStatsInfo, sources []rag.SourceReference) ([]rag.SourceReference, error) {
	hasWikiContent := false
	for _, source := range sources {
		if source.SourceType == "wiki" && source.Content != "" {
			hasWikiContent = true
			break
		}
	}
	if !hasWikiContent {
		for i := range sources {
			if sources[i].SourceType == "wiki" {
				sources[i].WikiChunks = nil
			}
		}
		return sources, nil
	}
	channel, modelName, err := resolveExecutionChannel(ctx, status.AgentModel, request.Model)
	if err != nil {
		return nil, err
	}
	available := wikiContextInputBudget(ctx, channel.ChannelID, channel.Config, modelName,
		documentQAExistingInputTokens(request, status.AgentModel, modelName))
	var nonWikiSources []rag.SourceReference
	var wikiSources []rag.SourceReference
	for _, source := range sources {
		if source.SourceType == "wiki" {
			wikiSources = append(wikiSources, source)
		} else {
			nonWikiSources = append(nonWikiSources, source)
		}
	}
	available -= openai.CountTokenText(CreateRetrievalContext(nonWikiSources), modelName)
	if available < 0 {
		available = 0
	}
	if rag.DetectDocumentQATask(status.OriginalQuestion) == rag.DocumentQATaskSummarize &&
		openai.CountTokenText(CreateRetrievalContext(wikiSources), modelName) > available {
		return summarizeWikiSourcesWithinBudget(ctx, c, request, status, sources, available)
	}
	return fitWikiSourcesToBudget(sources, available, modelName, status.OriginalQuestion), nil
}

func summarizeWikiSourcesWithinBudget(ctx context.Context, c *gin.Context, request *ChatRequest, status *MessageStatsInfo, sources []rag.SourceReference, available int) ([]rag.SourceReference, error) {
	var documents []rag.DocumentQAContent
	var files []*model.File
	for _, source := range sources {
		if source.SourceType != "wiki" || source.Content == "" {
			continue
		}
		documents = append(documents, rag.DocumentQAContent{FileID: source.WikiPageID, Content: source.Content})
		files = append(files, &model.File{Path: source.Title + ".md"})
	}
	result := summarizeDocumentQASegments(ctx, request, status, documents, files, available)
	usage := result.Usage
	addDocumentQAUsage(c, &usage)
	coverage := make(map[string]string)
	for i := range sources {
		source := &sources[i]
		if source.SourceType != "wiki" || source.Content == "" {
			continue
		}
		stats := result.ByFile[source.WikiPageID]
		if summary, ok := result.FileSummaries[source.WikiPageID]; ok && stats.Complete {
			source.Content = summary.Content
			source.WikiCoverage = "summarized_complete"
		} else {
			var notes []string
			for _, note := range result.Notes {
				if note.FileID == source.WikiPageID {
					notes = append(notes, note.Content)
				}
			}
			source.Content = strings.Join(notes, "\n")
			source.WikiCoverage = "partial"
			if source.Content == "" {
				source.WikiCoverage = "unavailable"
			}
		}
		coverage[hashInt64(source.WikiPageID)] = source.WikiCoverage
		source.WikiChunks = nil
	}
	if c != nil {
		c.Set("wiki_page_context_coverage", coverage)
	}
	return sources, nil
}

func wikiContextCoverage(sources []rag.SourceReference) map[string]string {
	coverage := make(map[string]string)
	for _, source := range sources {
		if source.SourceType == "wiki" && source.WikiPageID > 0 && source.WikiCoverage != "" {
			coverage[hashInt64(source.WikiPageID)] = source.WikiCoverage
		}
	}
	return coverage
}

func expandWikiSourceContexts(ctx context.Context, eid, userID int64, sources []rag.SourceReference) ([]rag.SourceReference, error) {
	matches := make([]servicepkg.WikiSearchResult, 0, len(sources))
	for _, source := range sources {
		if source.SourceType != "wiki" || source.WikiCoverage == "complete" || source.WikiPageVersionID == 0 || source.WikiChunkID == "" {
			continue
		}
		matches = append(matches, servicepkg.WikiSearchResult{
			PageID: source.WikiPageID, WikiPageVersionID: source.WikiPageVersionID,
			ChunkDBID: source.ChunkID, ChunkID: source.WikiChunkID,
		})
	}
	if len(matches) == 0 {
		return sources, nil
	}
	contexts, err := servicepkg.NewWikiSearchService(model.DB).LoadPageContexts(ctx, eid, userID, matches)
	if err != nil {
		return nil, err
	}
	contextByPage := make(map[int64]servicepkg.WikiPageContext, len(contexts))
	for _, pageContext := range contexts {
		contextByPage[pageContext.PageID] = pageContext
	}
	result := make([]rag.SourceReference, 0, len(sources))
	seenPages := make(map[int64]struct{}, len(contexts))
	for _, source := range sources {
		if source.SourceType != "wiki" || source.WikiCoverage == "complete" || source.WikiPageVersionID == 0 {
			result = append(result, source)
			continue
		}
		if _, seen := seenPages[source.WikiPageID]; seen {
			continue
		}
		pageContext, found := contextByPage[source.WikiPageID]
		if !found || pageContext.VersionID != source.WikiPageVersionID {
			continue
		}
		seenPages[source.WikiPageID] = struct{}{}
		result = append(result, wikiSourceWithPageContext(source, pageContext))
	}
	return result, nil
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

func documentQACompareTopK(chatRequest *ChatRequest, fileCount int) int {
	if topK := wikiTopK(chatRequest); topK < fileCount {
		return fileCount
	}
	return wikiTopK(chatRequest)
}

type retrievalStageCounts struct {
	Recalled    int
	AfterFusion int
	AfterRerank int
	Selected    int
}

type retrievalObservability struct {
	Document retrievalStageCounts
	Wiki     retrievalStageCounts
	Graph    retrievalStageCounts
	Web      retrievalStageCounts
}

func (o retrievalObservability) asMap() map[string]interface{} {
	return map[string]interface{}{
		"document":           retrievalStageCountMap(o.Document),
		"wiki":               retrievalStageCountMap(o.Wiki),
		"graph":              retrievalStageCountMap(o.Graph),
		"web":                retrievalStageCountMap(o.Web),
		"initial_candidates": o.Document.Recalled + o.Wiki.Recalled + o.Graph.Recalled + o.Web.Recalled,
		"after_fusion":       o.Document.AfterFusion + o.Wiki.AfterFusion + o.Graph.AfterFusion + o.Web.AfterFusion,
		"after_rerank":       o.Document.AfterRerank + o.Wiki.AfterRerank + o.Graph.AfterRerank + o.Web.AfterRerank,
		"selected":           o.Document.Selected + o.Wiki.Selected + o.Graph.Selected + o.Web.Selected,
	}
}

func retrievalStageCountMap(counts retrievalStageCounts) map[string]int {
	return map[string]int{
		"recalled":     counts.Recalled,
		"after_fusion": counts.AfterFusion,
		"after_rerank": counts.AfterRerank,
		"selected":     counts.Selected,
	}
}

func sourceCategory(source rag.SourceReference) string {
	sourceType := strings.ToLower(strings.TrimSpace(source.SourceType))
	switch {
	case sourceType == "wiki":
		return "wiki"
	case sourceType == "graph" || source.ChunkType == rag.GraphAggregateChunkType || source.ReferenceID == rag.GraphAggregateReferenceID:
		return "graph"
	case sourceType == "web" || strings.HasPrefix(strings.ToUpper(strings.TrimSpace(source.ReferenceID)), "B-"):
		return "web"
	default:
		return "document"
	}
}

func sourceWeight(category string) float64 {
	switch category {
	case "wiki":
		return config.RAGSourceWeightWiki
	case "document":
		return config.RAGSourceWeightDocument
	case "web":
		return config.RAGSourceWeightWeb
	default:
		return 1
	}
}

func fusionRankConstant() int {
	if config.RAGSourceFusionRankConstant <= 0 {
		return 60
	}
	return config.RAGSourceFusionRankConstant
}

func addSourceCounts(counts map[string]int, sources []rag.SourceReference) {
	for _, source := range sources {
		counts[sourceCategory(source)]++
	}
}

func updateRetrievalObservability(observability *retrievalObservability, stage string, sources []rag.SourceReference) {
	counts := map[string]int{}
	addSourceCounts(counts, sources)
	for category, count := range counts {
		var target *retrievalStageCounts
		switch category {
		case "document":
			target = &observability.Document
		case "wiki":
			target = &observability.Wiki
		case "graph":
			target = &observability.Graph
		case "web":
			target = &observability.Web
		}
		if target == nil {
			continue
		}
		switch stage {
		case "recalled":
			target.Recalled = count
		case "after_fusion":
			target.AfterFusion = count
		case "after_rerank":
			target.AfterRerank = count
		case "selected":
			target.Selected = count
		}
	}
}

func mergeSearchSources(ragSources, wikiSources []rag.SourceReference, topK int) []rag.SourceReference {
	merged, _ := mergeSearchSourcesWithStats(ragSources, wikiSources, topK, false)
	return merged
}

func mergeSearchSourcesWithStats(ragSources, wikiSources []rag.SourceReference, topK int, keepRerankCandidates bool) ([]rag.SourceReference, retrievalObservability) {
	observability := retrievalObservability{}
	allRecalled := make([]rag.SourceReference, 0, len(ragSources)+len(wikiSources))
	allRecalled = append(allRecalled, ragSources...)
	allRecalled = append(allRecalled, wikiSources...)
	updateRetrievalObservability(&observability, "recalled", allRecalled)

	seen := make(map[string]struct{}, len(allRecalled))
	graphSources := make([]rag.SourceReference, 0, 1)
	byCategory := make(map[string][]rag.SourceReference)
	for _, source := range allRecalled {
		category := sourceCategory(source)
		key := fmt.Sprintf("%s:%d:%s", category, source.ChunkID, source.ReferenceID)
		if category == "wiki" {
			key = fmt.Sprintf("wiki:%d:%d:%s", source.WikiPageID, source.ChunkID, source.ReferenceID)
		} else if category == "web" {
			key = fmt.Sprintf("web:%s:%s", source.URL, source.Content)
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		if category == "graph" {
			source.RawScore = source.Score
			source.Score = 0
			source.FusionScore = 0
			graphSources = append(graphSources, source)
			continue
		}
		byCategory[category] = append(byCategory[category], source)
	}

	fused := make([]rag.SourceReference, 0, len(allRecalled))
	for _, category := range []string{"document", "wiki", "web"} {
		candidates := byCategory[category]
		sort.SliceStable(candidates, func(i, j int) bool { return candidates[i].Score > candidates[j].Score })
		for index := range candidates {
			candidates[index].RawScore = candidates[index].Score
			candidates[index].SourceRank = index + 1
			candidates[index].FusionScore = sourceWeight(category) / float64(index+1+fusionRankConstant())
		}
		fused = append(fused, candidates...)
	}
	sort.SliceStable(fused, func(i, j int) bool { return fused[i].FusionScore > fused[j].FusionScore })

	if topK <= 0 {
		topK = 20
	}
	if !keepRerankCandidates && len(fused) > topK {
		fused = fused[:topK]
	}
	afterFusion := make([]rag.SourceReference, 0, len(graphSources)+len(fused))
	afterFusion = append(afterFusion, graphSources...)
	afterFusion = append(afterFusion, fused...)
	updateRetrievalObservability(&observability, "after_fusion", afterFusion)

	// Graph is supplemental structured context. It remains visible but is not
	// allowed to consume the text candidate TopK or compete by a sentinel score.
	return ensureWikiReferenceIDs(afterFusion), observability
}

func ensureWikiReferenceIDs(sources []rag.SourceReference) []rag.SourceReference {
	used := make(map[string]struct{}, len(sources))
	for _, source := range sources {
		if !strings.EqualFold(source.SourceType, "wiki") && source.ReferenceID != "" {
			used[source.ReferenceID] = struct{}{}
		}
	}
	nextIndex := 0
	for index := range sources {
		if !strings.EqualFold(sources[index].SourceType, "wiki") {
			continue
		}
		referenceID := sources[index].ReferenceID
		if referenceID == "" {
			referenceID = wikiReferenceID(nextIndex)
		}
		for {
			if _, exists := used[referenceID]; !exists {
				break
			}
			nextIndex++
			referenceID = wikiReferenceID(nextIndex)
		}
		sources[index].ReferenceID = referenceID
		sources[index].SourceKey = fmt.Sprintf("[Source:%s]", referenceID)
		used[referenceID] = struct{}{}
	}
	return sources
}

func sourceResourceKey(source rag.SourceReference) string {
	switch strings.ToLower(strings.TrimSpace(source.SourceType)) {
	case "web":
		if source.URL != "" {
			return "web:" + source.URL
		}
		if source.Title != "" {
			return "web:title:" + source.Title
		}
		if source.Content != "" {
			return "web:content:" + source.Content
		}
		return fmt.Sprintf("web:chunk:%d", source.ChunkID)
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
	case "document", "file", "knowledge", "meeting_minutes", "meeting_insight", "":
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

// Merge mandatory meeting evidence without repeating the same minutes/insight
// source when the retrieval fallback has already returned it.
func mergePreparedMeetingSources(mandatory, retrieved []rag.SourceReference) []rag.SourceReference {
	if len(mandatory) == 0 {
		return retrieved
	}
	seen := make(map[string]struct{}, len(mandatory))
	merged := make([]rag.SourceReference, 0, len(mandatory)+len(retrieved))
	for _, source := range mandatory {
		key := fmt.Sprintf("%d:%s", source.FileID, source.SourceType)
		if _, duplicate := seen[key]; duplicate {
			continue
		}
		seen[key] = struct{}{}
		merged = append(merged, source)
	}
	for _, source := range retrieved {
		if source.SourceType == "meeting_minutes" || source.SourceType == "meeting_insight" {
			key := fmt.Sprintf("%d:%s", source.FileID, source.SourceType)
			if _, duplicate := seen[key]; duplicate {
				continue
			}
		}
		merged = append(merged, source)
	}
	return merged
}

// renumberSourceReferences assigns one citation sequence format to all
// sources after they have been merged and ordered.
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

var executeSearchMulti = func(ctx context.Context, searcher search_tools.Searcher, queries []string, count, maxWorkers int) (*search_tools.SearchResult, error) {
	if maxWorkers <= 0 {
		maxWorkers = config.RAG_SEARCH_ENGINE_MAX_WORKERS
	}
	engine := search_tools.NewEngine(
		searcher,
		search_tools.WithMaxWorkers(maxWorkers),
		search_tools.WithTimeout(0),
	)
	return engine.SearchMultiContext(ctx, queries, count)
}

var executeFinalRerank = rerankSources

const knowledgeSearchPartialErrorsKey = "knowledge_search_partial_errors"

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

type documentQACompareFileCoverage struct {
	FileID            int64
	HasEvidence       bool
	MissingDimensions []string
}

func documentQACompareDimensions(query string) []string {
	part := strings.TrimSpace(query)
	start := -1
	for _, marker := range []string{"在", "关于", "针对", "围绕"} {
		if index := strings.LastIndex(part, marker); index > start {
			start = index + len(marker)
		}
	}
	if start >= 0 {
		part = part[start:]
	} else if index := strings.LastIndex(part, "的"); index >= 0 {
		part = part[index+len("的"):]
	}
	for _, suffix := range []string{"方面的差异", "方面的区别", "方面的异同", "方面的不同", "方面的差别", "方面差异", "方面区别", "方面异同", "方面不同", "方面差别", "方面", "的差异", "的区别", "的异同", "的不同", "的差别", "差异", "区别", "异同", "不同", "差别"} {
		part = strings.TrimSuffix(part, suffix)
	}
	part = strings.NewReplacer("以及", "|", "和", "|", "与", "|", "及", "|", "、", "|", "，", "|", ",", "|", "；", "|", ";", "|", "/", "|").Replace(part)

	dimensions := make([]string, 0)
	seen := make(map[string]struct{})
	for _, dimension := range strings.Split(part, "|") {
		dimension = strings.Trim(dimension, " \t\n\r：:、，,；;。.!！?？“”\"'()（）")
		dimension = strings.TrimPrefix(dimension, "分别")
		dimension = strings.TrimPrefix(dimension, "各自")
		if dimension == "" || dimension == "差异" || dimension == "区别" || dimension == "方面" {
			continue
		}
		if _, exists := seen[dimension]; exists {
			continue
		}
		seen[dimension] = struct{}{}
		dimensions = append(dimensions, dimension)
	}
	return dimensions
}

func evaluateDocumentQACompareCoverage(fileIDs []int64, sources []rag.SourceReference, dimensions []string) (string, []documentQACompareFileCoverage) {
	coverage := "complete"
	if len(dimensions) == 0 {
		coverage = "partial"
	}
	files := make([]documentQACompareFileCoverage, 0, len(fileIDs))
	for _, fileID := range fileIDs {
		var content strings.Builder
		fileCoverage := documentQACompareFileCoverage{FileID: fileID}
		for _, source := range sources {
			if source.FileID != fileID || source.SourceType == "web" {
				continue
			}
			fileCoverage.HasEvidence = true
			content.WriteString(source.Content)
			content.WriteByte('\n')
		}
		lowerContent := strings.ToLower(content.String())
		for _, dimension := range dimensions {
			if !strings.Contains(lowerContent, strings.ToLower(dimension)) {
				fileCoverage.MissingDimensions = append(fileCoverage.MissingDimensions, dimension)
			}
		}
		if !fileCoverage.HasEvidence || len(fileCoverage.MissingDimensions) > 0 {
			coverage = "partial"
		}
		files = append(files, fileCoverage)
	}
	return coverage, files
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

// Summarize the selected meeting evidence that actually survived RAG source
// selection. These metadata-only counts support both planning priority and
// diagnostics without logging any meeting content.
type selectedMeetingEvidenceStats struct {
	FileID          int64
	HasMinutes      bool
	HasInsight      bool
	HasTranscript   bool
	MinutesBytes    int
	InsightBytes    int
	TranscriptBytes int
	SourceCount     int
}

func selectedMeetingEvidence(request *ChatRequest, sources []rag.SourceReference) (selectedMeetingEvidenceStats, bool) {
	var stats selectedMeetingEvidenceStats
	if request == nil || !request.DatasetIsSoloFile() {
		return stats, false
	}
	fileID, err := hashids.TryParseID(request.FileIDs[0])
	if err != nil {
		return stats, false
	}
	stats.FileID = fileID
	for _, source := range sources {
		if source.FileID != fileID || strings.TrimSpace(source.Content) == "" {
			continue
		}
		stats.SourceCount++
		switch source.SourceType {
		case "meeting_minutes":
			stats.HasMinutes = true
			stats.MinutesBytes += len(source.Content)
		case "meeting_insight":
			stats.HasInsight = true
			stats.InsightBytes += len(source.Content)
		case "document", "file":
			stats.HasTranscript = true
			stats.TranscriptBytes += len(source.Content)
		}
	}
	return stats, true
}

func HandleRAG(c *gin.Context, chatRequest *ChatRequest, ctx context.Context, messageStatus *MessageStatsInfo) ([]rag.SourceReference, error) {
	var err error
	var kbSearchErr error
	var searchErrors []string
	var partialSearchErrors []string
	if chatRequest.WebSearchConfig != nil {
		chatRequest.WebSearchConfig, err = configuredWebSearchRequest(messageStatus.AgentModel, chatRequest.WebSearchConfig)
		if err != nil {
			return nil, err
		}
	}
	// 开始处理 RAG 意图
	InitialQuery := messageStatus.OriginalQuestion
	if messageStatus.RewrittenQuestion != "" {
		InitialQuery = messageStatus.RewrittenQuestion
	}
	var intent *rag.IntentClassificationResult
	if messageStatus.RouterResult != nil {
		intent = messageStatus.RouterResult.IntentClassificationResult
	}
	queries := retrievalQueries(InitialQuery, intent)

	logger.SysLogf("【网络搜索】RAG 查询内容：%v", queries)
	var sources []rag.SourceReference
	var wikiSources []rag.SourceReference
	var wikiErr error
	sourcePlan := buildRAGSourcePlan(ctx, c, chatRequest, messageStatus.AgentModel)
	fileOnly := len(chatRequest.FileIDs) > 0 && len(chatRequest.KnowledgeBaseIDs) == 0 && len(chatRequest.SpaceIDs) == 0 &&
		!sourcePlan.WikiSearch && !sourcePlan.LocalWebSearch && !sourcePlan.ModelSearch
	if fileOnly {
		if resolved := resolveDocumentQAFollowupQuery(chatRequest.Messages, InitialQuery); resolved != InitialQuery {
			InitialQuery = resolved
			messageStatus.RewrittenQuestion = resolved
			queries = []string{resolved}
		}
	}
	var cancelDocumentQA context.CancelFunc
	if fileOnly {
		ctx, cancelDocumentQA = context.WithTimeout(ctx, documentQASummaryTimeout)
		defer cancelDocumentQA()
		queries = limitDocumentQAQueries(queries, 4)
	}
	preparedDocumentQA, useFullDocument, documentQAErr := prepareDocumentQA(c, chatRequest, ctx, messageStatus, fileOnly)
	if documentQAErr != nil {
		return nil, documentQAErr
	}
	var fullDocumentSources []rag.SourceReference
	var partialDocumentSources []rag.SourceReference
	if useFullDocument && preparedDocumentQA != nil {
		fullDocumentSources = preparedDocumentQA.Sources
		c.Set("document_qa_plan", preparedDocumentQA.Plan)
		logger.Infof(ctx, "【文档问答】已读取全部指定文件正文：文件数=%d，策略=%s，正文估算=%d token，可用输入=%d token",
			len(fullDocumentSources), preparedDocumentQA.Plan.Strategy, preparedDocumentQA.Plan.RequiredInputTokens, preparedDocumentQA.Plan.AvailableInputTokens)
	} else if preparedDocumentQA != nil && preparedDocumentQA.Plan.Strategy == rag.DocumentQAStrategyMapReduce {
		partialDocumentSources = preparedDocumentQA.Sources
	}
	rerankEnabled := shouldRerank(messageStatus.AgentModel, chatRequest)
	startMessage := ragSearchStartMessage(sourcePlan)
	if sourcePlan.KnowledgeBase {
		c.Set("knowledge_search_start_message", startMessage)
	} else if startMessage != "" && !knowledgeSearchStepStarted(c) {
		messageStatus.StepSender.SendStartStep(STEP_KNOWLEDGE_SEARCH, startMessage, map[string]interface{}{"queries": queries})
		c.Set("knowledge_search_step_started", true)
	}
	var wikiSearchDone chan struct{}
	var wikiContext *gin.Context
	var wikiStatus MessageStatsInfo
	if sourcePlan.WikiSearch {
		wikiContext = c.Copy()
		wikiStatus = *messageStatus
		wikiSearchDone = make(chan struct{})
		go func() {
			defer close(wikiSearchDone)
			wikiSources, wikiErr = HandleWikiSearchRag(wikiContext, queries, chatRequest, ctx, &wikiStatus)
			if wikiErr != nil {
				logger.Warnf(ctx, "【Wiki检索】搜索失败：%v", wikiErr)
			}
		}()
	}

	if len(fullDocumentSources) > 0 {
		// 全文材料按预算直接进入上下文，不参与检索 TopK 和重排。
	} else if sourcePlan.SoloWiki {
		logger.Infof(ctx, "【Wiki检索】当前请求为 Wiki 单文档模式，开始读取页面完整内容")
		if sourcePlan.LocalWebSearch || sourcePlan.ModelSearch {
			wikiContext, webContext := c.Copy(), c.Copy()
			wikiStatus, webStatus := *messageStatus, *messageStatus
			results := runRAGSearchBranches(
				func() ([]rag.SourceReference, error) {
					return HandleSoloWikiSearchRag(wikiContext, queries, chatRequest, ctx, &wikiStatus)
				},
				func() ([]rag.SourceReference, error) {
					return handleConfiguredWebSearch(webContext, queries, chatRequest, ctx, &webStatus)
				},
			)
			copyRAGContextValues(c, wikiContext)
			copyRAGContextValues(c, webContext)
			if results[0].err == nil {
				sources = append(sources, results[0].sources...)
				if wikiStatus.KnowledgeScope != "" {
					messageStatus.KnowledgeScope = wikiStatus.KnowledgeScope
				}
			}
			if results[1].err == nil {
				sources = append(sources, results[1].sources...)
			} else {
				searchErrors = append(searchErrors, "网络搜索："+rootErrorMessage(results[1].err))
				if len(sources) == 0 {
					err = results[1].err
				}
			}
			if results[0].err != nil {
				searchErrors = append(searchErrors, "Wiki 页面："+rootErrorMessage(results[0].err))
				if len(sources) == 0 {
					err = results[0].err
				}
			}
		} else {
			sources, err = HandleSoloWikiSearchRag(c, queries, chatRequest, ctx, messageStatus)
			if err != nil {
				searchErrors = append(searchErrors, "Wiki 页面："+rootErrorMessage(err))
			}
		}
	} else if fileOnly {
		searchCtx, cancelSearch := context.WithTimeout(ctx, documentQARetrievalTimeout)
		defer cancelSearch()
		compare := rag.DetectDocumentQATask(InitialQuery) == rag.DocumentQATaskCompare && len(chatRequest.FileIDs) > 1
		if compare {
			sources, err = handleDocumentQACompareSearch(c, queries, chatRequest, searchCtx, messageStatus)
		} else {
			sources, err = HandleKnowledgeSearchRag(c, queries, chatRequest, searchCtx, messageStatus)
			if (err != nil || len(sources) == 0) && preparedDocumentQA != nil && preparedDocumentQA.Plan.Strategy == rag.DocumentQAStrategyRetrieval {
				fallbackCompleted := fallbackDocumentQASegmentSearch(c, chatRequest, messageStatus, ctx, preparedDocumentQA)
				if fallbackCompleted {
					sources = nil
					partialDocumentSources = preparedDocumentQA.Sources
					err = nil
				} else if fallbackErr := documentQAFallbackFailure(false, sources, preparedDocumentQA.Sources); fallbackErr != nil {
					err = fallbackErr
				}
			}
			if err == nil && documentQAQuestionNeedsGapCheck(messageStatus, InitialQuery) {
				sources, err = handleDocumentQAFollowupSearch(c, queries, sources, chatRequest, searchCtx, messageStatus)
			}
		}
		if err != nil {
			searchErrors = append(searchErrors, "指定文件检索："+rootErrorMessage(err))
		}
	} else if sourcePlan.SoloFile {
		enableWeb := sourcePlan.LocalWebSearch || sourcePlan.ModelSearch
		if enableWeb {
			logger.Infof(ctx, "【网络搜索】单文件模式+网络搜索混合模式：file_ids=%d，message_file_id=%d，开始并发执行", len(chatRequest.FileIDs), chatRequest.MessageFileID)
			messageStatus.KnowledgeType = model.KnowledgeTypeSingleFile

			var soloSources []rag.SourceReference
			var webSources []rag.SourceReference
			var soloErr, webErr error
			var wg sync.WaitGroup
			soloContext, webContext := c.Copy(), c.Copy()
			soloStatus, webStatus := *messageStatus, *messageStatus

			// 并发执行搜索
			wg.Add(2)

			// 1. 执行单文件搜索
			go func() {
				defer wg.Done()
				soloSources, soloErr = HandleSoloFileSearchRag(soloContext, queries, chatRequest, ctx, &soloStatus)
				if soloErr != nil {
					logger.Warnf(ctx, "单文件搜索失败: %v", soloErr)
				}
			}()

			// 2. 执行 Web 搜索
			go func() {
				defer wg.Done()
				webSources, webErr = handleConfiguredWebSearch(webContext, queries, chatRequest, ctx, &webStatus)
				if webErr != nil {
					logger.Warnf(ctx, "Web搜索失败: %v", webErr)
				}
			}()

			wg.Wait()
			copyRAGContextValues(c, soloContext)
			copyRAGContextValues(c, webContext)
			mergeSoloFileSearchStatus(messageStatus, &soloStatus, soloErr)
			if soloErr != nil {
				searchErrors = append(searchErrors, "单文件："+rootErrorMessage(soloErr))
			}
			if webErr != nil {
				searchErrors = append(searchErrors, "网络搜索："+rootErrorMessage(webErr))
			}

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
				}
				if webErr != nil {
					logger.Warnf(ctx, "【网络搜索】单文件+网络混合搜索未返回网络搜索结果：%v", webErr)
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
			if err != nil {
				searchErrors = append(searchErrors, "单文件："+rootErrorMessage(err))
			}
		}
	} else {
		enableWeb := sourcePlan.LocalWebSearch || sourcePlan.ModelSearch
		enableKB := sourcePlan.KnowledgeBase
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
			webSearchSource := "外挂 API"
			if sourcePlan.ModelSearch {
				webSearchSource = "模型"
			}
			logger.Infof(ctx, "【网络搜索】开始执行混合检索：网络搜索来源=%s，知识库数量=%d，查询数量=%d", webSearchSource, len(chatRequest.KnowledgeBaseIDs), len(queries))

			var kbSources []rag.SourceReference
			var webSources []rag.SourceReference
			var kbErr, webErr error
			var wg sync.WaitGroup
			kbContext, webContext := c.Copy(), c.Copy()
			kbStatus, webStatus := *messageStatus, *messageStatus

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
				kbSources, kbErr = HandleKnowledgeSearchRag(kbContext, queries, chatRequest, ctx, &kbStatus)
				if kbErr != nil {
					logger.Warnf(ctx, "知识库搜索失败: %v", kbErr)
				}
			}()

			// 2. 执行 Web 搜索
			go func() {
				defer wg.Done()
				webSources, webErr = handleConfiguredWebSearch(webContext, queries, chatRequest, ctx, &webStatus)
				if webErr != nil {
					logger.Warnf(ctx, "Web搜索失败: %v", webErr)
				}
			}()

			wg.Wait()
			kbSearchErr = kbErr
			logger.Infof(ctx, "【网络搜索】混合检索完成：知识库来源数=%d，知识库错误=%t，网络搜索来源=%s，网络搜索结果数=%d，网络搜索错误=%t", len(kbSources), kbErr != nil, webSearchSource, len(webSources), webErr != nil)
			copyRAGContextValues(c, kbContext)
			copyRAGContextValues(c, webContext)
			if knowledgeSearchStepStarted(kbContext) {
				c.Set("knowledge_search_step_started", true)
			}
			messageStatus.KnowledgeScope = kbStatus.KnowledgeScope
			messageStatus.KnowledgeType = model.KnowledgeTypeDatabase
			if kbErr != nil {
				searchErrors = append(searchErrors, "知识库："+rootErrorMessage(kbErr))
			}
			if webErr != nil {
				searchErrors = append(searchErrors, "网络搜索："+rootErrorMessage(webErr))
			}

			// 错误处理策略：
			// 1. 如果 KB 成功，忽略 Web 错误（如果 Web 失败）
			// 2. 如果 KB 失败，Web 成功，降级为 Web 搜索
			// 3. 如果都失败，返回 KB 的错误（或者合并错误）

			// KB 和 Web 候选完整保留，交由后续跨来源 rank fusion 统一截断；
			// 开启重排时再对融合候选执行一次最终重排。
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
				rerankEnabled,
			)

			// 如果最终没有结果，且有错误发生，返回错误
			if len(sources) == 0 {
				if kbErr != nil {
					logger.Warnf(ctx, "【网络搜索】混合搜索未返回知识库结果：%v", kbErr)
				}
				if webErr != nil {
					logger.Warnf(ctx, "【网络搜索】混合搜索未返回网络搜索结果：%v", webErr)
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
			sources, err = handleConfiguredWebSearch(c, queries, chatRequest, ctx, messageStatus)
			if err != nil {
				searchErrors = append(searchErrors, "网络搜索："+rootErrorMessage(err))
			}
		} else if enableKB {
			logger.Infof(ctx, "【网络搜索】仅命中知识库分支，网络搜索未启用")
			messageStatus.KnowledgeType = model.KnowledgeTypeDatabase
			sources, err = HandleKnowledgeSearchRag(c, queries, chatRequest, ctx, messageStatus)
			kbSearchErr = err
			if err != nil {
				searchErrors = append(searchErrors, "知识库："+rootErrorMessage(err))
			}
		} else {
			logger.Infof(ctx, "【网络搜索】既未命中知识库也未命中网络搜索分支，跳过检索")
		}
	}

	partialSearchErrors = append(partialSearchErrors, knowledgeSearchPartialErrors(c)...)
	// File-only document QA has its own coverage check and must not receive a
	// second, independent retry here. KB retries retain the original request.
	var retrievalSummary map[string]interface{}
	if sourcePlan.KnowledgeBase && !fileOnly && !sourcePlan.SoloFile && !sourcePlan.SoloWiki {
		firstSources := make([]rag.SourceReference, 0, len(sources))
		for _, source := range sources {
			if sourceCategory(source) == "document" {
				firstSources = append(firstSources, source)
			}
		}
		enhanced := intent != nil && intent.EnhancedRetrieval
		retrievalSummary = map[string]interface{}{
			"enhanced": enhanced, "rounds": 1, "first_queries": queries,
			"first_result_count": len(firstSources), "supplement_queries": []string{},
			"supplement_result_count": 0, "supplement_reason": "", "stop_reason": "clues_available",
		}
		if kbSearchErr != nil {
			retrievalSummary["stop_reason"] = "search_error"
		} else if !documentCluesAvailable(firstSources, intent) {
			if len(firstSources) == 0 {
				retrievalSummary["supplement_reason"] = "no_results"
			} else {
				retrievalSummary["supplement_reason"] = "missing_document_or_field_clues"
			}
			retrievalSummary["stop_reason"] = "no_new_query"
			supplementQueries := supplementalRetrievalQueries(intent, queries, messageStatus.OriginalQuestion, messageStatus.RewrittenQuestion)
			if ctx.Err() != nil {
				retrievalSummary["stop_reason"] = "cancelled"
			} else if len(supplementQueries) > 0 {
				supplementContext := c.Copy()
				supplementContext.Set(knowledgeSearchPartialErrorsKey, []string{})
				supplementStatus := *messageStatus
				supplementStatus.StepSender = nil
				supplementRequest := *chatRequest
				graphDisabled := false
				supplementRequest.EnableGraphSearch = &graphDisabled
				extra, supplementErr := HandleKnowledgeSearchRag(supplementContext, supplementQueries, &supplementRequest, ctx, &supplementStatus)
				partialSearchErrors = append(partialSearchErrors, knowledgeSearchPartialErrors(supplementContext)...)
				retrievalSummary["rounds"] = 2
				retrievalSummary["supplement_queries"] = supplementQueries
				retrievalSummary["supplement_result_count"] = len(extra)
				if supplementErr != nil {
					retrievalSummary["stop_reason"] = "supplement_error"
					logger.Warnf(ctx, "【知识检索】补充检索失败，沿用首轮结果：%v", supplementErr)
				} else {
					sources = mergeSupplementalSources(sources, extra)
					retrievalSummary["stop_reason"] = "supplement_completed"
				}
			}
		}
		if len(partialSearchErrors) > 0 {
			retrievalSummary["partial_search_errors"] = partialSearchErrors
		}
	}

	if wikiSearchDone != nil {
		<-wikiSearchDone
		copyRAGContextValues(c, wikiContext)
		if wikiStatus.KnowledgeScope != "" {
			messageStatus.KnowledgeScope = wikiStatus.KnowledgeScope
		}
	}
	if sourcePlan.KnowledgeBase && !knowledgeSearchStepStarted(c) {
		messageStatus.StepSender.SendStartStep(STEP_KNOWLEDGE_SEARCH, startMessage, map[string]interface{}{"queries": queries})
		c.Set("knowledge_search_step_started", true)
	}
	if wikiErr != nil {
		searchErrors = append(searchErrors, "Wiki："+rootErrorMessage(wikiErr))
	}
	for _, message := range partialSearchErrors {
		searchErrors = append(searchErrors, "知识库部分搜索："+message)
	}
	var retrievalObs retrievalObservability
	keepCompareCandidates := false
	if value, exists := c.Get("document_qa_compare_file_ids"); exists {
		if fileIDs, ok := value.([]int64); ok {
			compareTopK := documentQACompareTopK(chatRequest, len(fileIDs))
			sources, retrievalObs = mergeSearchSourcesWithStats(sources, wikiSources, compareTopK, true)
			sources = selectCompareSourcesPerFile(sources, fileIDs, compareTopK)
			keepCompareCandidates = true
		}
	}
	if !keepCompareCandidates {
		keepCandidates := rerankEnabled || (intent != nil && intent.EnhancedRetrieval)
		sources, retrievalObs = mergeSearchSourcesWithStats(sources, wikiSources, wikiTopK(chatRequest), keepCandidates)
	}
	if len(sources) > 0 {
		hasWiki, hasFile := false, false
		for _, source := range sources {
			if source.SourceType == "wiki" {
				hasWiki = true
			} else if sourceCategory(source) == "document" {
				hasFile = true
			}
		}
		if hasWiki {
			switch {
			case hasFile:
				messageStatus.KnowledgeType = model.KnowledgeTypeKBDynamic
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
	// 所有召回来源（KB、Wiki、Web、图谱）完成合并后，只在这里执行一次最终重排。
	var rerankExecutionStatus = "disabled"
	var rerankExecutionDesc = "未开启重排功能，按初检向量/全文相关度直接截断"
	if !rerankEnabled && !keepCompareCandidates {
		rankDocumentClues(sources, intent)
		sources, _ = splitTopKSourcesWithDropped(sources, wikiTopK(chatRequest))
	}
	if len(sources) > 0 && rerankEnabled {
		query := messageStatus.RewrittenQuestion
		if query == "" {
			query = messageStatus.OriginalQuestion
		}
		var rerankErr error
		var droppedSources []rag.SourceReference
		rerankStart := time.Now()
		rerankRequest := chatRequest
		if value, exists := c.Get("document_qa_compare_file_ids"); exists {
			if fileIDs, ok := value.([]int64); ok {
				requestCopy := *chatRequest
				searchConfigCopy := &model.SearchConfigData{}
				if chatRequest.SearchConfig != nil {
					*searchConfigCopy = *chatRequest.SearchConfig
				}
				searchConfigCopy.TopK = documentQACompareTopK(chatRequest, len(fileIDs))
				requestCopy.SearchConfig = searchConfigCopy
				rerankRequest = &requestCopy
			}
		}
		if !keepCompareCandidates && intent != nil && intent.EnhancedRetrieval {
			requestCopy := *chatRequest
			searchConfigCopy := &model.SearchConfigData{}
			if chatRequest.SearchConfig != nil {
				*searchConfigCopy = *chatRequest.SearchConfig
			}
			searchConfigCopy.TopK = len(sources)
			requestCopy.SearchConfig = searchConfigCopy
			rerankRequest = &requestCopy
		}
		sources, droppedSources, rerankErr = executeFinalRerank(ctx, messageStatus.AgentModel, rerankRequest, query, sources)
		if !keepCompareCandidates && intent != nil && intent.EnhancedRetrieval {
			rankDocumentClues(sources, intent)
			var topKDropped []rag.SourceReference
			sources, topKDropped = splitTopKSourcesWithDropped(sources, wikiTopK(chatRequest))
			droppedSources = append(droppedSources, topKDropped...)
		}
		rerankDuration := time.Since(rerankStart)
		if rerankErr != nil {
			logger.Warnf(ctx, "最终重排序失败: %v，使用 TopK 截断后的原始合并结果", rerankErr)
			rerankExecutionStatus = "failed"
			rerankExecutionDesc = fmt.Sprintf("重排模型调用失败（%v），已降级为按初筛分数 TopK 截断", rerankErr)
		} else {
			rerankExecutionStatus = "success"
			modelName := ""
			if messageStatus.AgentModel != nil {
				if rc, _ := messageStatus.AgentModel.GetRerankConfig(); rc != nil {
					modelName = rc.RerankModelName
				}
			}
			if modelName == "" {
				modelName = "配置的重排模型"
			}
			rerankExecutionDesc = fmt.Sprintf("已成功调用重排接口（模型: %s，耗时: %.2fs，候选: %d 条，入选: %d 条）",
				modelName, rerankDuration.Seconds(), len(sources)+len(droppedSources), len(sources))
		}
	}
	updateRetrievalObservability(&retrievalObs, "after_rerank", sources)
	updateRetrievalObservability(&retrievalObs, "selected", sources)
	if preparedDocumentQA != nil {
		sources = mergePreparedMeetingSources(preparedDocumentQA.MeetingSources, sources)
	}
	sources = append(sources, fullDocumentSources...)
	sources = append(sources, partialDocumentSources...)
	sources, err = expandWikiSourceContexts(ctx, messageStatus.AgentModel.Eid, config.GetUserId(c), sources)
	if err != nil {
		return nil, fmt.Errorf("读取 Wiki 页面完整上下文失败: %w", err)
	}
	sources, err = budgetWikiSourcesForRequest(ctx, c, chatRequest, messageStatus, sources)
	if err != nil {
		return nil, fmt.Errorf("计算 Wiki 页面上下文预算失败: %w", err)
	}
	wikiCoverage := wikiContextCoverage(sources)
	if len(wikiCoverage) > 0 {
		c.Set("wiki_page_context_coverage", wikiCoverage)
	}
	if preparedDocumentQA != nil && preparedDocumentQA.Plan.Strategy == rag.DocumentQAStrategyMapReduce &&
		!preparedDocumentQA.Summary.ComprehensiveComplete && len(sources) == 0 {
		if summaryErr := documentQAFallbackFailure(false, nil, preparedDocumentQA.Sources); summaryErr != nil {
			err = summaryErr
			searchErrors = append(searchErrors, "指定文件全文总结："+rootErrorMessage(summaryErr))
		}
	}
	c.Set("rag_retrieval_observability", retrievalObs.asMap())
	searchConfigSnapshot := map[string]interface{}{
		"top_k":          wikiTopK(chatRequest),
		"rerank_enabled": rerankEnabled,
	}
	if messageStatus.AgentModel != nil {
		if rc, _ := messageStatus.AgentModel.GetRerankConfig(); rc != nil {
			searchConfigSnapshot["rerank_model"] = rc.RerankModelName
			searchConfigSnapshot["rerank_type"] = rc.RerankModel
			searchConfigSnapshot["score_threshold_enabled"] = rc.ScoreThresholdEnabled
			searchConfigSnapshot["score_threshold"] = rc.ScoreThreshold
			searchConfigSnapshot["rerank_score_threshold_enabled"] = rc.RerankScoreThresholdEnabled
			searchConfigSnapshot["rerank_score_threshold"] = rc.RerankScoreThreshold
		}
	}
	searchConfigSnapshot["rerank_execution_status"] = rerankExecutionStatus
	searchConfigSnapshot["rerank_execution_desc"] = rerankExecutionDesc
	searchConfigSnapshot["retrieval_queries"] = queries
	if retrievalSummary != nil {
		var finalDocuments []rag.SourceReference
		for _, source := range sources {
			if sourceCategory(source) == "document" {
				finalDocuments = append(finalDocuments, source)
			}
		}
		retrievalSummary["clues_available"] = documentCluesAvailable(finalDocuments, intent)
		searchConfigSnapshot["retrieval_summary"] = retrievalSummary
		c.Set("rag_retrieval_summary", retrievalSummary)
	}
	if followup, exists := c.Get("document_qa_followup_queries"); exists {
		searchConfigSnapshot["followup_queries"] = followup
	}
	c.Set("rag_search_config_snapshot", searchConfigSnapshot)
	sources = renumberSourceReferences(sources)

	if chatRequest.DatasetIsSoloFile() && isDiscussionAgentAuthorized(messageStatus.AgentModel) {
		if evidence, ok := selectedMeetingEvidence(chatRequest, sources); ok {
			strategy := "solo_retrieval"
			if preparedDocumentQA != nil {
				strategy = string(preparedDocumentQA.Plan.Strategy)
			}
			logger.Infof(ctx, "【探讨-当前会议上下文】request_id=%s file_id=%d strategy=%s has_minutes=%t has_insight=%t has_transcript=%t minutes_bytes=%d insight_bytes=%d transcript_bytes=%d source_count=%d",
				messageStatus.RequestId, evidence.FileID, strategy, evidence.HasMinutes, evidence.HasInsight, evidence.HasTranscript,
				evidence.MinutesBytes, evidence.InsightBytes, evidence.TranscriptBytes, evidence.SourceCount)
		}
	}

	stepData := map[string]interface{}{
		"sources":                  sources,
		"wiki_result_count":        len(wikiSources), // 兼容旧客户端
		"wiki_search_result_count": len(wikiSources),
		"solo_wiki_chunk_count":    0,
		"retrieval_observability":  retrievalObs.asMap(),
		"retrieval_fusion": map[string]interface{}{
			"method":          "weighted_rrf",
			"document_weight": config.RAGSourceWeightDocument,
			"wiki_weight":     config.RAGSourceWeightWiki,
			"web_weight":      config.RAGSourceWeightWeb,
			"rank_constant":   fusionRankConstant(),
		},
	}
	if len(wikiCoverage) > 0 {
		stepData["wiki_page_context_coverage"] = wikiCoverage
	}
	if retrievalSummary != nil {
		stepData["retrieval_summary"] = retrievalSummary
	}
	if chatRequest.DatasetIsSoloWiki() {
		chunkCount := 0
		for _, source := range sources {
			if source.SourceType == "wiki" {
				chunkCount += len(source.WikiChunkIDs)
			}
		}
		stepData["solo_wiki_chunk_count"] = chunkCount
	}
	if preparedDocumentQA != nil {
		stepData["document_qa"] = map[string]interface{}{
			"strategy":              preparedDocumentQA.Plan.Strategy,
			"coverage":              preparedDocumentQA.Plan.Coverage,
			"required_input_tokens": preparedDocumentQA.Plan.RequiredInputTokens,
			"available_tokens":      preparedDocumentQA.Plan.AvailableInputTokens,
		}
		if preparedDocumentQA.Plan.Strategy == rag.DocumentQAStrategyMapReduce {
			fileCoverage := make([]map[string]interface{}, 0, len(chatRequest.FileIDs))
			for _, encodedFileID := range chatRequest.FileIDs {
				fileID, parseErr := hashids.TryParseID(encodedFileID)
				if parseErr != nil {
					continue
				}
				stats := preparedDocumentQA.Summary.ByFile[fileID]
				fileCoverage = append(fileCoverage, map[string]interface{}{
					"file_id": hashInt64(fileID), "total": stats.Total,
					"processed": stats.Processed, "failed": stats.Failed, "complete": stats.Complete,
				})
			}
			documentQAData := stepData["document_qa"].(map[string]interface{})
			documentQAData["coverage"] = preparedDocumentQA.Summary.Coverage
			documentQAData["comprehensive_complete"] = preparedDocumentQA.Summary.ComprehensiveComplete
			documentQAData["file_coverage"] = fileCoverage
		}
	}
	if followup, exists := c.Get("document_qa_followup_queries"); exists {
		if followupQueries, ok := followup.([]string); ok {
			if data, exists := stepData["document_qa"].(map[string]interface{}); exists {
				data["rounds"] = 2
				data["followup_query_count"] = len(followupQueries)
			}
		}
	}
	if value, exists := c.Get("document_qa_compare_file_ids"); exists {
		if fileIDs, ok := value.([]int64); ok {
			dimensions := documentQACompareDimensions(messageStatus.OriginalQuestion)
			coverage, fileCoverages := evaluateDocumentQACompareCoverage(fileIDs, sources, dimensions)
			files := make([]map[string]interface{}, 0, len(fileIDs))
			for _, fileCoverage := range fileCoverages {
				files = append(files, map[string]interface{}{
					"file_id": hashInt64(fileCoverage.FileID), "has_evidence": fileCoverage.HasEvidence,
					"missing_dimensions": fileCoverage.MissingDimensions,
				})
			}
			compareData := map[string]interface{}{"coverage": coverage, "dimensions": dimensions, "files": files}
			if len(dimensions) == 0 {
				compareData["dimension_coverage_available"] = false
			}
			if followup, exists := c.Get("document_qa_followup_queries"); exists {
				if followupQueries, ok := followup.([]string); ok {
					compareData["followup_query_count"] = len(followupQueries)
					compareData["rounds"] = 2
				}
			}
			stepData["document_qa_compare"] = compareData
		}
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
	messageStatus.StepSender.SendEndStep(STEP_KNOWLEDGE_SEARCH, "搜索完成", stepData)

	// 按对话开启的查询范围组合判定知识类型（与消息列表筛选互斥对应）
	messageStatus.KnowledgeType = ComputeKnowledgeScopeTag(buildScopeSignals(ctx, chatRequest, messageStatus.AgentModel, sources))

	c.Set("rag_sources", sources)
	if len(sources) > 0 {
		err = nil
	}
	return sources, err
}

func configuredWebSearchRequest(agent *model.Agent, request *model.WebSearchConfig) (*model.WebSearchConfig, error) {
	if agent == nil || request == nil {
		return nil, nil
	}
	configured, err := agent.GetWebSearchConfig()
	if err != nil {
		return nil, fmt.Errorf("读取 Agent 联网搜索配置失败: %w", err)
	}
	if configured == nil {
		return nil, nil
	}
	configured.Enable = configured.Enable && request.Enable
	return configured, nil
}

func copyRAGContextValues(target, source *gin.Context) {
	if partialErrors := knowledgeSearchPartialErrors(source); len(partialErrors) > 0 {
		target.Set(knowledgeSearchPartialErrorsKey, partialErrors)
	}
	if timings, exists := source.Get("rag_stage_timings_ms"); exists {
		target.Set("rag_stage_timings_ms", timings)
	}
	if value, exists := source.Get(nativeWebSearchUsageContextKey); exists {
		usage := value.(relay_model.Usage)
		addNativeWebSearchUsage(target, &usage)
	}
}

func knowledgeSearchPartialErrors(c *gin.Context) []string {
	if raw, exists := c.Get(knowledgeSearchPartialErrorsKey); exists {
		if errs, ok := raw.([]string); ok {
			return errs
		}
	}
	return nil
}

func mergeSoloFileSearchStatus(target, source *MessageStatsInfo, searchErr error) {
	if searchErr != nil {
		return
	}
	target.DocumentType = source.DocumentType
	target.DocumentID = source.DocumentID
	target.SaveFileID = source.SaveFileID
	target.KnowledgeScope = source.KnowledgeScope
	target.KnowledgeType = source.KnowledgeType
}

func addNativeWebSearchUsage(c *gin.Context, usage *relay_model.Usage) {
	if usage == nil {
		return
	}
	current, _ := c.Get(nativeWebSearchUsageContextKey)
	if current == nil {
		c.Set(nativeWebSearchUsageContextKey, *usage)
		return
	}
	total := current.(relay_model.Usage)
	total.PromptTokens += usage.PromptTokens
	total.CompletionTokens += usage.CompletionTokens
	total.TotalTokens += usage.TotalTokens
	c.Set(nativeWebSearchUsageContextKey, total)
}

func takeNativeWebSearchUsage(c *gin.Context) (relay_model.Usage, bool) {
	value, exists := c.Get(nativeWebSearchUsageContextKey)
	if !exists || value == nil {
		return relay_model.Usage{}, false
	}
	c.Set(nativeWebSearchUsageContextKey, nil)
	usage, ok := value.(relay_model.Usage)
	return usage, ok
}

func recordFailedNativeWebSearchUsage(c *gin.Context, ctx context.Context) {
	usage, ok := takeNativeWebSearchUsage(c)
	if !ok {
		return
	}
	if executionContext := agentExecutionContextFromGin(c); executionContext != nil {
		executionContext.AddUsage(agentexec.Usage{
			PromptTokens: usage.PromptTokens, CompletionTokens: usage.CompletionTokens,
			TotalTokens: usage.TotalTokens,
		})
	}
	logger.Infof(ctx, "【网络搜索】模型来源检索未能进入回答流程，已记录上游用量：输入Token=%d，输出Token=%d，合计=%d",
		usage.PromptTokens, usage.CompletionTokens, usage.TotalTokens)
}

func buildRAGSourcePlan(ctx context.Context, c *gin.Context, chatRequest *ChatRequest, agent *model.Agent) ragSourcePlan {
	if chatRequest == nil {
		return ragSourcePlan{}
	}
	var webSearchConfig *model.WebSearchConfig
	if agent != nil {
		configured, configErr := agent.GetWebSearchConfig()
		webSearchConfig = configured
		if configErr != nil {
			logger.Warnf(ctx, "【网络搜索】读取 Agent 搜索来源配置失败：%v", configErr)
		}
	}
	modelSearch := chatRequest.DatasetIsWebSearch() && webSearchConfig != nil && webSearchConfig.SourceType == "model"
	soloWiki := chatRequest.DatasetIsSoloWiki()
	wikiSearch := shouldRunWikiSearch(ctx, chatRequest, agent)
	explicitFileOnly := len(chatRequest.FileIDs) > 0 && len(chatRequest.KnowledgeBaseIDs) == 0 && len(chatRequest.SpaceIDs) == 0 &&
		!chatRequest.DatasetIsWebSearch() && !soloWiki && !wikiSearch
	fileOnly := explicitFileOnly && len(chatRequest.FileIDs) == 1
	return ragSourcePlan{
		LocalWebSearch: chatRequest.DatasetIsWebSearch() && !modelSearch,
		ModelSearch:    modelSearch,
		KnowledgeBase:  chatRequest.DatasetIsKnowledgeBase() && !fileOnly,
		SoloFile:       chatRequest.DatasetIsSoloFile() || fileOnly,
		SoloWiki:       soloWiki,
		WikiSearch:     wikiSearch,
	}
}

func handleConfiguredWebSearch(c *gin.Context, queries []string, chatRequest *ChatRequest, ctx context.Context, messageStatus *MessageStatsInfo) ([]rag.SourceReference, error) {
	useModelSearch := chatRequest.WebSearchConfig != nil && chatRequest.WebSearchConfig.SourceType == "model"
	source := "外挂 API"
	if useModelSearch {
		source = "模型"
	}
	logger.Infof(ctx, "【网络搜索】开始调用网络搜索：来源=%s，查询数量=%d", source, len(queries))
	var sources []rag.SourceReference
	var err error
	if useModelSearch {
		sources, err = HandleNativeModelWebSearchRag(c, queries, chatRequest, ctx, messageStatus)
	} else {
		sources, err = HandleWebSearchRag(c, queries, chatRequest, ctx, messageStatus)
	}
	if err != nil {
		logger.Warnf(ctx, "【网络搜索】网络搜索调用失败：来源=%s，错误=%v", source, err)
		return nil, err
	}
	logger.Infof(ctx, "【网络搜索】网络搜索调用完成：来源=%s，返回来源数=%d", source, len(sources))
	return sources, nil
}

func HandleNativeModelWebSearchRag(c *gin.Context, queries []string, chatRequest *ChatRequest, ctx context.Context, messageStatus *MessageStatsInfo) ([]rag.SourceReference, error) {
	requestedModel := chatRequest.Model
	agentModel := ""
	if messageStatus != nil && messageStatus.AgentModel != nil {
		agentModel = messageStatus.AgentModel.Model
	}
	if requestedModel == "" || strings.HasPrefix(requestedModel, "agent-") {
		requestedModel = agentModel
	}
	if requestedModel == "" {
		return nil, errors.New("无法确定网络搜索使用的模型名称")
	}
	logger.Infof(ctx, "【网络搜索】模型名称解析完成：请求模型=%s，Agent模型=%s，实际模型=%s", chatRequest.Model, agentModel, requestedModel)

	selectedChannel, exists := c.Get(ctxkey.SelectedChannel)
	channel, ok := selectedChannel.(*model.Channel)
	if messageStatus != nil && messageStatus.AgentModel != nil && messageStatus.AgentModel.SpecificChannelID > 0 {
		var err error
		channel, err = getAgentSpecificChannel(ctx, messageStatus.AgentModel)
		if err != nil {
			return nil, fmt.Errorf("加载网络搜索渠道失败: %w", err)
		}
		middleware.SetupContextForSelectedChannel(c, channel, requestedModel)
		ok, exists = true, true
	}
	if !exists || !ok || channel == nil {
		if messageStatus != nil && messageStatus.AgentModel != nil {
			resolvedChannel, _, err := resolveExecutionChannel(ctx, messageStatus.AgentModel, requestedModel)
			if err == nil && resolvedChannel != nil {
				channel = resolvedChannel
				middleware.SetupContextForSelectedChannel(c, channel, requestedModel)
				ok, exists = true, true
				logger.Infof(ctx, "【网络搜索】已从 Agent 配置恢复执行渠道：渠道ID=%d，模型=%s", channel.ChannelID, requestedModel)
			}
		}
	}
	if !exists || !ok || channel == nil {
		fixedChannelID := int64(0)
		if messageStatus != nil && messageStatus.AgentModel != nil {
			fixedChannelID = messageStatus.AgentModel.SpecificChannelID
		}
		logger.Warnf(ctx, "【网络搜索】模型来源渠道判定失败：无法获取当前渠道（Agent固定渠道ID=%d，上下文渠道存在=%t）", fixedChannelID, exists)
		return nil, errors.New("当前模型渠道不支持模型网络搜索")
	}
	meta := GetByContext(c)
	mappedModel, _ := getMappedModelName(requestedModel, channel.GetModelMapping())
	capabilities, useResponses, err := CustomOpenAI.ResolveModelConfig(channel.Type, channel.Config, mappedModel)
	if err != nil || !useResponses || !capabilities.EnabledTools["web_search"] {
		return nil, errors.New("当前模型未启用 Responses API 的网络搜索能力")
	}

	topK := 20
	if chatRequest.SearchConfig != nil && chatRequest.SearchConfig.TopK > 0 {
		topK = chatRequest.SearchConfig.TopK
	}
	dateWindow := recentWeekSearchWindow(messageStatus.OriginalQuestion, time.Now())
	if dateWindow != nil {
		logger.Infof(ctx, "【网络搜索】模型原生搜索按最近一周检索：发布日期范围为%s至%s", dateWindow.Start.Format(time.DateOnly), dateWindow.End.Format(time.DateOnly))
	}
	var sources []rag.SourceReference
	sourceIndexes := make(map[string]int)
	for queryIndex, query := range queries {
		metaCopy := *meta
		metaCopy.IsStream = false
		metaCopy.Mode = relaymode.ChatCompletions
		metaCopy.RequestURLPath = "/v1/chat/completions"
		metaCopy.ActualModelName = mappedModel
		adaptor := servicepkg.GetAdaptorForChannel(metaCopy.APIType, metaCopy.BaseURL, metaCopy.ChannelType)
		if adaptor == nil {
			return nil, errors.New("无法创建模型渠道适配器")
		}
		configured, ok := adaptor.(*CustomOpenAI.Adaptor)
		if !ok {
			return nil, errors.New("当前模型渠道的 Responses API 地址格式不支持模型网络搜索")
		}
		adaptor.Init(&metaCopy)
		configured.ChannelConfig = channel.Config
		configured.NativeWebSearch = true
		if err := servicepkg.SetCustomConfig(&adaptor, &custom.CustomConfig{UserId: fmt.Sprintf("agentsearch_u%d", config.GetUserId(c))}); err != nil {
			return nil, fmt.Errorf("初始化模型网络搜索请求失败: %w", err)
		}
		requestURL, err := adaptor.GetRequestURL(&metaCopy)
		if err != nil {
			return nil, fmt.Errorf("解析模型网络搜索地址失败: %w", err)
		}

		requestBody, convertErr := adaptor.ConvertRequest(c, relaymode.ChatCompletions, &relay_model.GeneralOpenAIRequest{
			Model:    mappedModel,
			Messages: []relay_model.Message{{Role: "user", Content: nativeModelWebSearchPrompt(query, topK, dateWindow)}},
		})
		if convertErr != nil {
			return nil, fmt.Errorf("转换模型网络搜索请求失败: %w", convertErr)
		}
		payload, err := json.Marshal(requestBody)
		if err != nil {
			return nil, fmt.Errorf("序列化模型网络搜索请求失败: %w", err)
		}
		logger.Infof(ctx, "【网络搜索】正在请求上游：渠道ID=%d，模型=%s，地址=%s，当前查询=%d，总查询数=%d", channel.ChannelID, mappedModel, requestURL, queryIndex+1, len(queries))
		resp, err := adaptor.DoRequest(c, &metaCopy, bytes.NewReader(payload))
		if err != nil {
			return nil, fmt.Errorf("请求模型网络搜索失败: %w", err)
		}
		body, readErr := io.ReadAll(resp.Body)
		resp.Body.Close()
		if readErr != nil {
			return nil, fmt.Errorf("读取模型网络搜索响应失败: %w", readErr)
		}
		if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
			responseMessage := strings.TrimSpace(string(body))
			if len(responseMessage) > 512 {
				responseMessage = responseMessage[:512]
			}
			logger.Warnf(ctx, "【网络搜索】模型上游拒绝请求：渠道ID=%d，模型=%s，地址=%s，状态码=%d，响应=%s", channel.ChannelID, mappedModel, requestURL, resp.StatusCode, responseMessage)
			return nil, fmt.Errorf("模型网络搜索返回状态码 %d", resp.StatusCode)
		}
		results, usage, err := CustomOpenAI.ExtractResponsesWebSearchResult(ctx, body)
		addNativeWebSearchUsage(c, usage)
		if err != nil {
			return nil, err
		}
		logger.Infof(ctx, "【网络搜索】模型上游响应已解析：渠道ID=%d，模型=%s，HTTP状态码=%d，网页结果数=%d", channel.ChannelID, mappedModel, resp.StatusCode, len(results))
		filteredCount := 0
		for _, result := range results {
			if dateWindow != nil && !dateWindow.includes(result.Date) {
				filteredCount++
				continue
			}
			referenceKey := result.URL
			if index, exists := sourceIndexes[referenceKey]; exists {
				if !strings.Contains(sources[index].Content, result.Content) {
					sources[index].Content += "\n" + result.Content
				}
				continue
			}
			if len(sources) >= topK {
				break
			}
			title := strings.TrimSpace(result.Title)
			if title == "" {
				title = result.URL
			}
			sourceIndexes[referenceKey] = len(sources)
			itemID := int64(len(sources) + 1)
			searchItem := &search_tools.SearchItem{
				ChunkID: itemID, FileID: itemID, FilePath: result.URL, FileName: title,
				Content: result.Content, PublishedAt: result.Date, ChunkType: "web_page", Score: 1,
			}
			sources = append(sources, webSearchSourceReference(searchItem))
		}
		if dateWindow != nil {
			logger.Infof(ctx, "【网络搜索】模型原生搜索已按发布日期筛选：累计保留%d条，当前查询过滤%d条", len(sources), filteredCount)
		}
		if len(sources) >= topK {
			break
		}
	}
	if len(sources) == 0 {
		if dateWindow != nil {
			return nil, fmt.Errorf("模型网络搜索未返回 %s 至 %s 内且带明确发布日期的网页来源", dateWindow.Start.Format(time.DateOnly), dateWindow.End.Format(time.DateOnly))
		}
		return nil, errors.New("模型网络搜索未返回可用网页来源内容")
	}
	messageStatus.KnowledgeType = model.KnowledgeTypeWeb
	go func() {
		if err := model.IncrementField(messageStatus.AgentModel.Eid, messageStatus.AgentModel.AgentID, "web_search_count", 1); err != nil {
			logger.Warnf(ctx, "【网络搜索】更新模型来源搜索次数失败：%v", err)
		}
	}()
	return sources, nil
}

func nativeModelWebSearchPrompt(query string, topK int, dateWindow *recentWeekWindow) string {
	dateRule := ""
	if dateWindow != nil {
		dateRule = fmt.Sprintf("只保留发布日期在 %s 至 %s（含首尾）之间的网页；无法确认发布日期或日期不在范围内的网页不要输出；没有符合条件的网页时返回空数组。", dateWindow.Start.Format(time.DateOnly), dateWindow.End.Format(time.DateOnly))
	}
	return fmt.Sprintf("请使用 web_search 搜索以下问题：先搜索一次，只有结果不足时才补充搜索。将实际搜索到的网页整理为 JSON 数组，不要代码围栏、解释或总括性回答。最多 %d 条，每条仅含 url、title、content、date。url 必须来自搜索结果；title 使用网页标题；content 应提供足够回答问题的具体信息，通常写 3-5 句、约 150-300 个汉字，优先保留关键事实、时间、数据和结论依据；只能总结该网页实际提供且与问题相关的信息，不混合不同网页的内容，也不补充网页未提供的事实，若网页有效信息较少则据实缩短；date 使用网页明确提供的发布日期，格式 YYYY-MM-DD，无法确认时填空字符串。%s\n搜索问题：%s", topK, dateRule, query)
}

type recentWeekWindow struct {
	Start time.Time
	End   time.Time
}

func recentWeekSearchWindow(question string, now time.Time) *recentWeekWindow {
	question = strings.ToLower(strings.TrimSpace(question))
	for _, phrase := range []string{"最近一周", "近一周", "过去一周", "最近7天", "近7天", "过去7天", "最近七天", "近七天", "过去七天", "past week", "last week", "past 7 days", "last 7 days"} {
		if strings.Contains(question, phrase) {
			location := time.FixedZone("Asia/Shanghai", 8*60*60)
			end := now.In(location)
			end = time.Date(end.Year(), end.Month(), end.Day(), 0, 0, 0, 0, end.Location())
			start := end.AddDate(0, 0, -6)
			return &recentWeekWindow{Start: start, End: end}
		}
	}
	return nil
}

func (window *recentWeekWindow) includes(rawDate string) bool {
	date, ok := parseSearchPublishedDate(rawDate)
	if !ok {
		return false
	}
	dateText := date.In(window.Start.Location()).Format(time.DateOnly)
	return dateText >= window.Start.Format(time.DateOnly) && dateText <= window.End.Format(time.DateOnly)
}

func parseSearchPublishedDate(rawDate string) (time.Time, bool) {
	rawDate = strings.TrimSpace(rawDate)
	for _, layout := range []string{time.DateOnly, time.RFC3339, "2006-01-02 15:04:05"} {
		if parsed, err := time.Parse(layout, rawDate); err == nil {
			return time.Date(parsed.Year(), parsed.Month(), parsed.Day(), 0, 0, 0, 0, parsed.Location()), true
		}
	}
	return time.Time{}, false
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

func mergeKnowledgeAndWebSources(kbSources, webSources []rag.SourceReference, _ int, _ bool) []rag.SourceReference {
	// Keep both source lists intact. Cross-source rank fusion owns the only
	// final TopK cutoff, otherwise a full KB list can consume the window before
	// Wiki/Web candidates are compared.
	merged := make([]rag.SourceReference, 0, len(kbSources)+len(webSources))
	merged = append(merged, kbSources...)
	return append(merged, webSources...)
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
	dateWindow := recentWeekSearchWindow(messageStatus.OriginalQuestion, time.Now())
	if dateWindow != nil {
		searchConfig.Wsc.Freshness = fmt.Sprintf("%s..%s", dateWindow.Start.Format(time.DateOnly), dateWindow.End.Format(time.DateOnly))
		logger.Infof(ctx, "【网络搜索】博查搜索按最近一周检索：发布日期范围为%s至%s", dateWindow.Start.Format(time.DateOnly), dateWindow.End.Format(time.DateOnly))
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
	if dateWindow != nil {
		freshItems := make([]*search_tools.SearchItem, 0, len(searchResult.Items))
		filteredCount := 0
		for _, item := range searchResult.Items {
			if item.ChunkType == "web_page" && dateWindow.includes(item.PublishedAt) {
				freshItems = append(freshItems, item)
			} else {
				filteredCount++
			}
		}
		searchResult.Items = freshItems
		logger.Infof(ctx, "【网络搜索】博查搜索已按发布日期筛选：保留%d条，过滤%d条", len(freshItems), filteredCount)
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
		if dateWindow != nil {
			return nil, fmt.Errorf("博查未返回 %s 至 %s 内且带明确发布日期的网页来源", dateWindow.Start.Format(time.DateOnly), dateWindow.End.Format(time.DateOnly))
		}
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

	for _, item := range searchResult.Items {
		sources = append(sources, webSearchSourceReference(item))
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

func webSearchSourceReference(item *search_tools.SearchItem) rag.SourceReference {
	return rag.SourceReference{
		SourceType:        "web",
		ChunkID:           item.ChunkID,
		FileID:            item.FileID,
		Content:           item.Content,
		FileName:          item.FileName,
		LibraryName:       item.LibraryName,
		LibraryIcon:       item.LibraryIcon,
		KnowledgeBaseName: item.LibraryName,
		KnowledgeBaseLogo: item.LibraryIcon,
		URL:               item.FilePath,
		FilePath:          item.FilePath,
		PublishedAt:       item.PublishedAt,
		Score:             1.0,
		ChunkType:         item.ChunkType,
	}
}

// HandleSoloFileSearchRag 处理单文件搜索RAG
// requireFileViewPermission 单文件问答需对该文件有查看权限（与单页 Wiki 检索口径一致，避免直读越权）。
func requireFileViewPermission(c *gin.Context, eid, fileID int64) error {
	if eid <= 0 || fileID <= 0 {
		return fmt.Errorf("无效的文件ID")
	}
	permission, err := servicepkg.GetUserPermission(eid, model.RESOURCE_TYPE_FILE, fileID, config.GetUserId(c))
	if err != nil || permission < model.PERMISSION_VIEW_ONLY {
		return fmt.Errorf("无权限查看该文件")
	}
	return nil
}

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

	// 文件级权限：单文件问答需对文件有查看权限（页面/单页 Wiki 同口径）。
	if err := requireFileViewPermission(c, eid, fileID); err != nil {
		logger.Warnf(ctx, "【文档检索】单文件问答无权限：文件ID=%d，用户ID=%d", fileID, config.GetUserId(c))
		return nil, err
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
	// 调用单文件增强逻辑：优先注入纪要，再按关键词检索相关逐字稿片段
	enhanced, enhErr := enhanceSoloFileSourcesAndContent(ctx, agent.Eid, file, chunks, queries, soloFileLibraryMeta{
		LibraryIDHash:          hashInt64(file.LibraryID),
		LibraryName:            libraryName,
		LibraryIcon:            libraryIcon,
		SpaceIDHash:            spaceIDHash,
		SpaceName:              spaceName,
		IncludeDecisionInsight: isDiscussionAgentAuthorized(agent),
	}, MAX_SOLO_FILE_CONTENT_SIZE)
	if enhErr == nil && enhanced != nil && len(enhanced.Sources) > 0 {
		return enhanced.Sources, nil
	}
	if enhErr != nil {
		logger.Warnf(ctx, "【文档检索】单文件增强处理失败，回退基础分片循环: %v", enhErr)
	}

	var sources []rag.SourceReference
	var currentLength int
	for i, chunk := range chunks {
		if currentLength+len(chunk.Content) > MAX_SOLO_FILE_CONTENT_SIZE {
			logger.SysLogf("单文件搜索RAG，文件 %s 内容长度超出最大限制，已截断", fileName)
			break
		}

		chunkRefID := fmt.Sprintf("%d-%d", 1, i+1) // 永远为 1-索引
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
	pageContexts, err := servicepkg.NewWikiSearchService(model.DB).LoadCurrentPageContexts(ctx, eid, userID, []int64{pageID})
	if err != nil {
		return nil, fmt.Errorf("读取 Wiki 当前页面上下文失败: %w", err)
	}
	if len(pageContexts) == 0 {
		logger.Warnf(ctx, "【Wiki检索】单文档页面当前版本未发布或无查看权限：页面ID=%d，继续使用空上下文", pageID)
		return []rag.SourceReference{}, nil
	}
	pageContext := pageContexts[0]
	chunks := pageContext.Chunks
	if len(chunks) == 0 {
		logger.Warnf(ctx, "【Wiki检索】单文档页面当前版本暂无分片：页面ID=%d，版本ID=%d", pageID, pageContext.VersionID)
		messageStatus.KnowledgeType = model.KnowledgeTypeSpecificWiki
		messageStatus.DocumentType = model.DocumentTypeWiki
		messageStatus.DocumentID = pageID
		messageStatus.KnowledgeScope = hashInt64(pageID)
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
	if len(chunks) == 0 {
		base := soloWikiSourceReference(*page, library, space, model.WikiPageChunk{WikiPageVersionID: pageContext.VersionID}, 0)
		return []rag.SourceReference{wikiSourceWithPageContext(base, pageContext)}, nil
	}
	sources := make([]rag.SourceReference, 0, len(chunks))
	for i, chunk := range chunks {
		sources = append(sources, soloWikiSourceReference(*page, library, space, chunk, i))
	}
	logger.Infof(ctx, "【Wiki检索】单文档读取完成：页面ID=%d，版本ID=%d，原始分片数=%d，注入分片数=%d", pageID, pageContext.VersionID, len(chunks), len(sources))
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
		URL:               fmt.Sprintf("/api/wiki/pages/%s", hashInt64(page.ID)),
		SourceKey:         fmt.Sprintf("[Source:%s]", referenceID),
		WikiPageVersionID: chunk.WikiPageVersionID, WikiChunkID: chunk.ChunkID,
		WikiHeadingPath: chunk.HeadingPath,
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
	if messageStatus.StepSender != nil {
		messageStatus.StepSender.SendStartStep(STEP_SCOPE_NARROWING, "正在搜索文档...", buildScopeNarrowingStartData(searchTarget, len(queries)))
	}

	searchService := rag.NewSearchService(model.DB)
	scopeQuery := retrievalScopeQuery(messageStatus.OriginalQuestion, messageStatus.RewrittenQuestion, queries)
	preprocessReq := &rag.SearchRequest{
		Query:                    scopeQuery,
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
	if messageStatus.StepSender != nil {
		messageStatus.StepSender.SendEndStep(STEP_SCOPE_NARROWING, "文档缩小范围完成", buildScopeNarrowingEndData(
			narrowResult.NarrowedLibraries,
			len(searchTarget.LibraryIDs),
			len(searchTarget.FileIDs),
			actualSearchType,
			actualKeywords,
			len(queries),
		))
	}

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
		startMessage := "正在搜索所选知识库..."
		if value, exists := c.Get("knowledge_search_start_message"); exists {
			if configured, ok := value.(string); ok && configured != "" {
				startMessage = configured
			}
		}
		if messageStatus.StepSender != nil {
			messageStatus.StepSender.SendStartStep(STEP_KNOWLEDGE_SEARCH, startMessage, map[string]interface{}{"queries": queries})
		}
		c.Set("knowledge_search_step_started", true)
	}

	ragSearcher := search_tools.NewRagSearcher(model.DB, agent.Eid, &userID, ragConfig)

	// 创建搜索引擎并执行搜索
	shouldDoRerank := shouldRerank(agent, chatRequest)
	keepCandidates := shouldDoRerank
	if messageStatus.RouterResult != nil && messageStatus.RouterResult.IntentClassificationResult != nil && messageStatus.RouterResult.IntentClassificationResult.EnhancedRetrieval {
		keepCandidates = true
	}
	recallTopK := calculateRecallTopK(topK, len(queries), keepCandidates)
	logger.Debugf(ctx, "【RAG检索】召回参数: top_k=%d, query_count=%d, rerank=%v, recall_top_k=%d",
		topK, len(queries), shouldDoRerank, recallTopK)

	searchWorkers := config.RAG_SEARCH_ENGINE_MAX_WORKERS
	if len(effectiveFileIDs) > 0 && len(effectiveLibraryIDs) == 0 {
		ctx = rag.WithSearchConcurrency(ctx, searchWorkers)
	}
	searchResult, err := executeSearchMulti(ctx, ragSearcher, queries, recallTopK, searchWorkers)
	if err != nil {
		return nil, fmt.Errorf("执行搜索失败: %v", err)
	}
	c.Set("rag_stage_timings_ms", ragSearcher.GetLastSearchTimings())

	if len(searchResult.Errors) > 0 {
		logger.Warnf(ctx, "搜索过程中出现错误: %v", searchResult.Errors)
		c.Set(knowledgeSearchPartialErrorsKey, searchResultErrorMessages(searchResult.Errors))
		if len(searchResult.Items) == 0 {
			return nil, fmt.Errorf("执行搜索失败: %w", errors.Join(searchResult.Errors...))
		}
	}

	// 知识库和 Web 结果会在 relay 汇总后统一执行一次最终重排。
	// 开启重排时保留完整召回窗口；关闭重排时仍在这里应用最终 TopK。
	compareFileScope := rag.DetectDocumentQATask(messageStatus.OriginalQuestion) == rag.DocumentQATaskCompare &&
		len(chatRequest.FileIDs) > 1 && len(chatRequest.KnowledgeBaseIDs) == 0 && len(chatRequest.SpaceIDs) == 0
	var compareFileIDs []int64
	var finalItems []*search_tools.SearchItem
	if compareFileScope {
		compareFileIDs = searchTarget.FileIDs
		finalItems = selectCompareItemsPerFile(searchResult.Items, compareFileIDs, topK)
		c.Set("document_qa_compare_file_ids", compareFileIDs)
	} else {
		finalItems = selectKnowledgeItemsForFinalRerank(searchResult.Items, topK, keepCandidates)
	}

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

func handleDocumentQACompareSearch(c *gin.Context, queries []string, chatRequest *ChatRequest, ctx context.Context, messageStatus *MessageStatsInfo) ([]rag.SourceReference, error) {
	fileIDs, err := decodeWikiIDs(chatRequest.FileIDs)
	if err != nil {
		return nil, fmt.Errorf("解析比较文件范围失败: %w", err)
	}
	if len(fileIDs) < 2 {
		return nil, fmt.Errorf("比较检索至少需要两个目标文件")
	}
	maxItems := calculateRecallTopK(documentQACompareTopK(chatRequest, len(fileIDs)), len(queries), shouldRerank(messageStatus.AgentModel, chatRequest))
	byFile := make(map[int64][]rag.SourceReference, len(fileIDs))
	var firstErr error
	for fileIndex, encodedFileID := range chatRequest.FileIDs {
		fileID, parseErr := hashids.TryParseID(encodedFileID)
		if parseErr != nil {
			return nil, fmt.Errorf("无效的文件ID格式: %s", encodedFileID)
		}
		for _, query := range queries {
			restrictedRequest := *chatRequest
			restrictedRequest.FileIDs = []string{encodedFileID}
			searchContext := c.Copy()
			searchStatus := *messageStatus
			searchStatus.StepSender = nil
			fileSources, searchErr := HandleKnowledgeSearchRag(searchContext, []string{query}, &restrictedRequest, ctx, &searchStatus)
			if searchErr != nil {
				if firstErr == nil {
					firstErr = searchErr
				}
				continue
			}
			byFile[fileID] = append(byFile[fileID], fileSources...)
		}
		if fileIndex < len(chatRequest.FileIDs)-1 && ctx.Err() != nil {
			break
		}
	}
	if ctx.Err() == nil {
		fileNames := make([]string, 0, len(fileIDs))
		for _, fileID := range fileIDs {
			file, fileErr := model.GetFileByID(messageStatus.AgentModel.Eid, fileID, ctx)
			if fileErr != nil {
				continue
			}
			fileNames = append(fileNames, file.GetAccurateFileName())
		}
		firstRoundSources := make([]rag.SourceReference, 0)
		for _, fileID := range fileIDs {
			firstRoundSources = append(firstRoundSources, byFile[fileID]...)
		}
		followupQueries, followupErr := generateDocumentQAFollowupQueries(c, ctx, chatRequest, messageStatus, fileNames, firstRoundSources, queries)
		if followupErr != nil {
			logger.Warnf(ctx, "【文档问答】比较缺口检查失败：%v", followupErr)
		} else if len(followupQueries) > 0 {
			c.Set("document_qa_followup_queries", followupQueries)
			for _, encodedFileID := range chatRequest.FileIDs {
				fileID, parseErr := hashids.TryParseID(encodedFileID)
				if parseErr != nil {
					continue
				}
				for _, query := range followupQueries {
					restrictedRequest := *chatRequest
					restrictedRequest.FileIDs = []string{encodedFileID}
					searchContext := c.Copy()
					searchStatus := *messageStatus
					searchStatus.StepSender = nil
					fileSources, searchErr := HandleKnowledgeSearchRag(searchContext, []string{query}, &restrictedRequest, ctx, &searchStatus)
					if searchErr != nil {
						if firstErr == nil {
							firstErr = searchErr
						}
						continue
					}
					byFile[fileID] = append(byFile[fileID], fileSources...)
				}
				if ctx.Err() != nil {
					break
				}
			}
		}
	}
	var candidates []rag.SourceReference
	for _, fileID := range fileIDs {
		seenChunks := make(map[int64]struct{})
		for _, source := range byFile[fileID] {
			if source.ChunkID > 0 {
				if _, exists := seenChunks[source.ChunkID]; exists {
					continue
				}
				seenChunks[source.ChunkID] = struct{}{}
			}
			candidates = append(candidates, source)
		}
	}
	sources := selectCompareSourcesPerFile(candidates, fileIDs, maxItems)
	c.Set("document_qa_compare_file_ids", fileIDs)
	messageStatus.KnowledgeScope = "file:" + strings.Join(chatRequest.FileIDs, ",")
	messageStatus.KnowledgeType = model.KnowledgeTypeSpecificKB
	if len(sources) == 0 && firstErr != nil {
		return nil, firstErr
	}
	return sources, nil
}

func documentQAQuestionNeedsGapCheck(status *MessageStatsInfo, query string) bool {
	if status != nil && status.RouterResult != nil && status.RouterResult.IntentClassificationResult != nil &&
		status.RouterResult.IntentClassificationResult.Intent == "COMPLEX_AGENT" {
		return true
	}
	for _, cue := range []string{"分别", "各方面", "系统梳理", "全面分析", "完整梳理", "逐项说明", "依次说明", "有哪些方面", "包含哪些内容"} {
		if strings.Contains(query, cue) {
			return true
		}
	}
	coveredDimensions := 0
	for _, dimension := range []string{"原因", "背景", "过程", "步骤", "条件", "影响", "结果", "后果", "优缺点", "风险", "措施", "建议"} {
		if strings.Contains(query, dimension) {
			coveredDimensions++
		}
	}
	if coveredDimensions >= 2 {
		return true
	}
	return false
}

func handleDocumentQAFollowupSearch(c *gin.Context, firstRoundQueries []string, firstRoundSources []rag.SourceReference, request *ChatRequest, ctx context.Context, status *MessageStatsInfo) ([]rag.SourceReference, error) {
	if len(request.FileIDs) == 0 {
		return firstRoundSources, nil
	}
	fileNames := make([]string, 0, len(request.FileIDs))
	for _, encodedFileID := range request.FileIDs {
		fileID, err := hashids.TryParseID(encodedFileID)
		if err != nil {
			continue
		}
		file, err := model.GetFileByID(status.AgentModel.Eid, fileID, ctx)
		if err == nil {
			fileNames = append(fileNames, file.GetAccurateFileName())
		}
	}
	followupQueries, err := generateDocumentQAFollowupQueries(c, ctx, request, status, fileNames, firstRoundSources, firstRoundQueries)
	if err != nil {
		logger.Warnf(ctx, "【文档问答】首轮检索缺口检查失败：%v", err)
		return firstRoundSources, nil
	}
	if len(followupQueries) == 0 {
		return firstRoundSources, nil
	}
	c.Set("document_qa_followup_queries", followupQueries)
	extraSources, err := HandleKnowledgeSearchRag(c, followupQueries, request, ctx, status)
	if err != nil {
		return firstRoundSources, err
	}
	return appendUniqueDocumentQASources(firstRoundSources, extraSources), nil
}

func appendUniqueDocumentQASources(sources ...[]rag.SourceReference) []rag.SourceReference {
	combined := make([]rag.SourceReference, 0)
	seen := make(map[string]struct{})
	for _, group := range sources {
		for _, source := range group {
			key := fmt.Sprintf("%d:%d:%s", source.FileID, source.ChunkID, source.SourceKey)
			if _, exists := seen[key]; exists {
				continue
			}
			seen[key] = struct{}{}
			combined = append(combined, source)
		}
	}
	return combined
}

func selectCompareSourcesPerFile(sources []rag.SourceReference, fileIDs []int64, limit int) []rag.SourceReference {
	byFile := make(map[int64][]rag.SourceReference, len(fileIDs))
	for _, source := range sources {
		byFile[source.FileID] = append(byFile[source.FileID], source)
	}
	for fileID := range byFile {
		sort.SliceStable(byFile[fileID], func(i, j int) bool {
			return byFile[fileID][i].Score > byFile[fileID][j].Score
		})
	}
	result := make([]rag.SourceReference, 0, limit)
	for rank := 0; len(result) < limit; rank++ {
		added := false
		for _, fileID := range fileIDs {
			if rank >= len(byFile[fileID]) {
				continue
			}
			result = append(result, byFile[fileID][rank])
			added = true
			if len(result) == limit {
				break
			}
		}
		if !added {
			break
		}
	}
	return result
}

func selectKnowledgeItemsForFinalRerank(items []*search_tools.SearchItem, topK int, rerankEnabled bool) []*search_tools.SearchItem {
	if rerankEnabled {
		return items
	}
	return limitSearchItemsTopK(items, topK)
}

func selectCompareItemsPerFile(items []*search_tools.SearchItem, fileIDs []int64, topK int) []*search_tools.SearchItem {
	if topK <= 0 {
		topK = 20
	}
	byFile := make(map[int64][]*search_tools.SearchItem, len(fileIDs))
	for _, item := range items {
		if item != nil {
			byFile[item.FileID] = append(byFile[item.FileID], item)
		}
	}
	for fileID := range byFile {
		sort.SliceStable(byFile[fileID], func(i, j int) bool {
			return byFile[fileID][i].Score > byFile[fileID][j].Score
		})
	}
	result := make([]*search_tools.SearchItem, 0, topK)
	for rank := 0; len(result) < topK; rank++ {
		added := false
		for _, fileID := range fileIDs {
			if rank >= len(byFile[fileID]) {
				continue
			}
			result = append(result, byFile[fileID][rank])
			added = true
			if len(result) == topK {
				break
			}
		}
		if !added {
			break
		}
	}
	return result
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

		fileName := item.FileName
		if fileName == "" && extInfo.FileName != "" {
			fileName = extInfo.FileName
		}
		if fileName == "" && item.FilePath != "" {
			fileName = filepath.Base(item.FilePath)
		}

		source := rag.SourceReference{
			SourceType:        "document",
			ReferenceID:       chunkRefID,
			ChunkID:           item.ChunkID,
			FileID:            item.FileID,
			FileName:          fileName,
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
