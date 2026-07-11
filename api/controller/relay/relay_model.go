package relay

import (
	"fmt"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/rag"
	"github.com/53AI/53AIHub/service/skill"
	"github.com/gin-gonic/gin"
	relay_model "github.com/songquanpeng/one-api/relay/model"
	"regexp"
	"strings"
	"unicode"
)

// 本文件目标是定义所有用到的模型

const MAX_DESC_WORD = 50 // 描述字段最大字数
// MAX_SOLO_FILE_CONTENT_SIZE 单文件模式最大内容长度（字符数）
const MAX_SOLO_FILE_CONTENT_SIZE = 50000
const maxIntentSkillCandidates = 5
const maxIntentSkillDescriptionRunes = 120
const maxIntentSkillCandidateQueryRunes = 1200
const maxIntentSkillCandidateConversationItems = 4

// Process step code constants 废弃
const (
	KB_SEARCH    = "kbs" // Knowledge Base Search - 知识库搜索
	DOC_SEARCH   = "dcs" // Document Search - 文档搜索
	ANSWER_GEN   = "ang" // Answer Generation - 回答生成
	REF_ANALYSIS = "ran" // Reference Analysis - 引用分析
	WEB_SEARCH   = "wbs" // Web Search - 网络搜索
)

const (
	STEP_STATUS_START     = "start"
	STEP_STATUS_COMPLETED = "completed"
)
const (
	// 问题改写步骤
	// 意图分类步骤
	STEP_INTENT_CLASSIFICATION = "intent_classification"
	// 复杂问题拆解步骤
	STEP_QUERY_EXPANSION = "query_expansion"
	STEP_SCOPE_NARROWING = "scope_narrowing"
	// 知识搜索步骤
	STEP_KNOWLEDGE_SEARCH = "knowledge_search"
	// 回答生成步骤
	STEP_ANSWER_GENERATION = "answer_generation"
	// 引用分析步骤
	STEP_REF_ANALYSIS = "ref_analysis"
	// 技能路由步骤
	STEP_SKILL_ROUTING = "skill_routing"
	// 工具执行步骤
	STEP_TOOL_EXECUTION = "tool_execution"
)

type ChatRequest struct {
	Messages             []relay_model.Message   `json:"messages"`
	Stream               bool                    `json:"stream"`
	Model                string                  `json:"model" example:"agent-6"`
	Temperature          float64                 `json:"temperature,omitempty"`
	PresencePenalty      float64                 `json:"presence_penalty,omitempty"`
	FrequencyPenalty     float64                 `json:"frequency_penalty,omitempty"`
	TopP                 float64                 `json:"top_p,omitempty"`
	ConversationID       int64                   `json:"conversation_id"`
	SpaceIDs             []string                `json:"space_ids,omitempty"`               // 空间ID列表
	KnowledgeBaseIDs     []string                `json:"knowledge_base_ids,omitempty"`      // 知识库ID列表
	FileIDs              []string                `json:"file_ids,omitempty"`                // 文件ID列表
	MessageFileID        int64                   `json:"message_file_id,omitempty"`         // 消息文件ID（优先保存到message.file_id）
	SoloFileMode         bool                    `json:"solo_file_mode,omitempty"`          // 单文件模式：true=使用完整文件内容，false=使用RAG分块搜索
	SearchConfig         *model.SearchConfigData `json:"search_config,omitempty"`           // 搜索配置（可选）
	EnableProcessSteps   bool                    `json:"enable_process_steps"`              // 启用步骤化流式输出，返回步骤代码：kbs(知识库搜索), dcs(文档搜索), ang(回答生成)
	EnableGraphSearch    *bool                   `json:"enable_graph_search,omitempty"`     // 启用图谱聚合检索，默认开启，显式传 false 才关闭
	EnableSkillAutoMatch *bool                   `json:"enable_skill_auto_match,omitempty"` // 启用技能自动匹配；工作AI默认开启，其它入口默认关闭
	WebSearchConfig      *model.WebSearchConfig  `json:"web_search_config,omitempty"`       // AI在线搜索配置（可选）
	Tools                []relay_model.Tool      `json:"tools,omitempty"`
	Source               string                  `json:"source,omitempty"` // 请求来源：console/api/h5等，前端传递
}

type MessageStatsInfo struct {
	ResponseStatus int    `json:"response_status"` // 回答状态：1=正常回答，2=拒答/超纲回复
	ThinkingMode   int    `json:"thinking_mode"`   // 思考方式：1=快速回答，2=深度思考
	KnowledgeScope string `json:"knowledge_scope"` // 知识范围
	// CitationCount  int    `json:"citation_count"`  // 引用数量
	KnowledgeType      int                  `json:"knowledge_type"`
	SaveFileID         int64                `json:"save_file_id"`       // 需要保存的文件ID（用于单文件模式）
	MessageFileID      int64                `json:"message_file_id"`    // 消息文件ID（优先级更高）、
	OriginalQuestion   string               `json:"original_question"`  // 原始问题（未改写）
	RewrittenQuestion  string               `json:"rewritten_question"` // 改写后的问题（用于RAG搜索）
	AgentModel         *model.Agent         `json:"agent_model"`        // 企业模型
	RelayMode          int                  `json:"relay_mode"`         // 中继模式
	RequestId          string               `json:"request_id"`         // 请求ID
	MessageID          int64                `json:"-"`                  // 绑定的消息ID（用于过程记录落库）
	BufferedSteps      []ProcessStep        `json:"-"`                  // message_id 未就绪时的步骤缓冲
	ProcessRecordError string               `json:"-"`                  // 过程记录落库错误（仅调试）
	RouterResult       *RouterResult        `json:"router_result"`      // 路由结果
	StepSender         *ProcessSender       `json:"-"`                  // 步骤发送器
	UploadedFiles      []*model.UploadFile  `json:"-"`                  // 用户上传的文件列表（从message content解析）
	SkillSnapshot      *skill.SkillSnapshot `json:"-"`                  // run 级技能快照（含 gating 过滤结果）
	SkillRunScope      *skill.RunScope      `json:"-"`                  // run 级运行域（cwd/env/secrets）
	RequestSource      string               `json:"request_source"`     // 请求来源：console/api/h5等
}

// UniqueDocumentInfo 去重文档信息
type UniqueDocumentInfo struct {
	FileID     int64  `json:"file_id"`     // 文档ID
	FileName   string `json:"file_name"`   // 文档名称
	FilePath   string `json:"file_path"`   // 文档路径
	ChunkCount int    `json:"chunk_count"` // 匹配的分片数量
	FirstChunk string `json:"first_chunk"` // 第一个匹配分片的内容作为文档详情
}

func normalizeRequestSource(source string) string {
	source = strings.TrimSpace(source)
	if source == "" {
		return model.MessageRequestSourceConsole
	}
	return source
}

// WorkflowRunRequest 工作流运行请求结构体
type WorkflowRunRequest struct {
	Parameters     map[string]interface{} `json:"parameters"`       // 工作流参数
	Stream         bool                   `json:"stream"`           // 是否流式响应（工作流不支持，会被忽略）
	Model          string                 `json:"model"`            // Agent模型
	ConversationID int64                  `json:"conversation_id"`  // 会话ID
	Source         string                 `json:"source,omitempty"` // 请求来源：console/api/h5等，前端传递
}

// 预设问答映射表（TODO）
var presetAnswers = map[string]string{
	"你好":    "你好！我是您的AI助手，很高兴为您服务。请问有什么可以帮助您的吗？",
	"帮助":    "我可以帮助您回答问题、搜索文档、提供信息等。具体功能包括：\n1. 智能问答\n2. 文档搜索\n3. 信息查询\n请直接告诉我您需要什么帮助。",
	"清除上下文": "上下文已清除。您可以开始新的对话了。",
}

type RelayRouter struct {
	CR *ChatRequest
	MS *MessageStatsInfo
}

type RouterResult struct {
	Err                        *error                          // 错误信息
	ReplyStop                  bool                            // 是否停止后续处理，直接返回给用户
	Content                    string                          // 直接返回给用户的内容
	IntentClassificationResult *rag.IntentClassificationResult `json:"intent_classification_result"` // 意图分类结果
	Skill                      *skill.Skill                    `json:"skill"`                        // 匹配的技能
}

// 步骤发送器
type ProcessSender struct {
	c             *gin.Context
	requestId     string
	chatRequest   *ChatRequest
	messageStatus *MessageStatsInfo
}

// Agent Decision constants - 采用Claude Code风格的"dumb runtime, smart model"哲学
const (
	DecisionContinue    = "CONTINUE"     // 继续当前对话流程
	DecisionToolCall    = "TOOL_CALL"    // 需要调用工具
	DecisionRAGQuery    = "RAG_QUERY"    // 需要检索知识库
	DecisionSkillSwitch = "SKILL_SWITCH" // 需要切换技能
	DecisionDone        = "DONE"         // 对话完成
)

// AgentDecision represents a decision made by the agent
// 用于解析LLM响应中的 <decision>XXX</decision> 标签
type AgentDecision struct {
	Decision string `json:"decision"` // 决策类型: CONTINUE, TOOL_CALL, RAG_QUERY, SKILL_SWITCH, DONE
}

// AgentControlEvent is the internal routing signal used by the relay loop.
// It keeps the parsed decision together with the raw content so callers can
// preserve compatibility while moving away from text-driven control flow.
type AgentControlEvent struct {
	Decision   *AgentDecision `json:"decision,omitempty"`
	RawContent string         `json:"raw_content,omitempty"`
	Query      string         `json:"query,omitempty"`
	SkillName  string         `json:"skill_name,omitempty"`
	IsLegacy   bool           `json:"is_legacy,omitempty"`
}

// decisionRegex is the compiled regex for parsing decision tags
var decisionRegex = regexp.MustCompile(`<decision>([^<]*)</decision>`)
var skillNameRegex = regexp.MustCompile(`<skill_name>([^<]*)</skill_name>`)

var decisionTokenSet = map[string]struct{}{
	DecisionContinue:    {},
	DecisionToolCall:    {},
	DecisionRAGQuery:    {},
	DecisionSkillSwitch: {},
	DecisionDone:        {},
}

func shouldDisableKnowledgeSearchForUser(agent *model.Agent, user *model.User) bool {
	if agent == nil || user == nil {
		return false
	}
	if agent.AgentUsage != model.AgentUsageWorkAI {
		return false
	}
	return user.Eid == agent.Eid && user.Type == model.UserTypeRegistered
}

func clearKnowledgeSearchScope(chatRequest *ChatRequest) {
	if chatRequest == nil {
		return
	}
	chatRequest.SpaceIDs = nil
	chatRequest.KnowledgeBaseIDs = nil
	chatRequest.FileIDs = nil
	chatRequest.MessageFileID = 0
	chatRequest.SoloFileMode = false
}

// ParseAgentDecision parses the decision tag from LLM response content
// Returns nil if no valid decision found (defaults to DONE in downstream logic)
func ParseAgentDecision(content string) *AgentDecision {
	// Legacy compatibility wrapper. The structured parser is the preferred path.
	return parseDecisionFromContent(content)
}

// ParseAgentControlEvent parses the model response into an internal routing event.
// Legacy <decision> tags are still accepted, but the caller should prefer using
// the structured event instead of reading the raw string directly.
func ParseAgentControlEvent(content string) *AgentControlEvent {
	event := &AgentControlEvent{RawContent: content}
	decision := parseDecisionFromContent(content)
	if decision == nil {
		return event
	}
	event.Decision = decision
	event.IsLegacy = true
	switch decision.Decision {
	case DecisionRAGQuery:
		event.Query = extractQueryFromDecision(content)
	case DecisionSkillSwitch:
		event.SkillName = extractSkillNameFromDecision(content)
	}
	return event
}

func parseDecisionFromContent(content string) *AgentDecision {
	matches := decisionRegex.FindStringSubmatch(content)
	if len(matches) < 2 {
		return nil
	}
	decision := matches[1]
	if decision == "" {
		return nil
	}
	switch decision {
	case DecisionContinue, DecisionToolCall, DecisionRAGQuery, DecisionSkillSwitch, DecisionDone:
		return &AgentDecision{Decision: decision}
	default:
		return nil
	}
}

// extractQueryFromDecision extracts the query text from a decision-tagged response.
// Legacy compatibility helper kept so older prompts and tests still work.
func extractQueryFromDecision(content string) string {
	// Remove the decision tag from content
	result := decisionRegex.ReplaceAllString(content, "")

	// Trim whitespace and newlines
	result = regexp.MustCompile(`^\s+`).ReplaceAllString(result, "")
	result = regexp.MustCompile(`\s+$`).ReplaceAllString(result, "")

	// If result is empty after removing decision tag, return the original content
	// (some models might use a different format)
	if result == "" {
		return content
	}

	return result
}

// extractSkillNameFromDecision extracts the target skill name from a SKILL_SWITCH decision.
// Legacy compatibility helper kept so older prompts and tests still work.
func extractSkillNameFromDecision(content string) string {
	// First, try to find a skill_name tag
	matches := skillNameRegex.FindStringSubmatch(content)
	if len(matches) >= 2 && matches[1] != "" {
		return matches[1]
	}

	// Fallback: remove decision tag and extract first word
	result := decisionRegex.ReplaceAllString(content, "")

	// Trim whitespace
	result = regexp.MustCompile(`^\s+`).ReplaceAllString(result, "")
	result = regexp.MustCompile(`\s+$`).ReplaceAllString(result, "")

	// Extract first word (skill name)
	words := regexp.MustCompile(`\s+`).Split(result, -1)
	if len(words) > 0 && words[0] != "" {
		return words[0]
	}

	return ""
}

// sanitizeFinalAssistantContent removes runtime control markers from user-visible content.
func sanitizeFinalAssistantContent(content string) string {
	result := strings.TrimSpace(content)
	if result == "" {
		return ""
	}

	result = decisionRegex.ReplaceAllString(result, "")
	result = skillNameRegex.ReplaceAllString(result, "")
	result = strings.TrimSpace(result)
	if result == "" {
		return ""
	}

	lines := strings.Split(result, "\n")
	for len(lines) > 0 {
		lastLine := strings.TrimSpace(lines[len(lines)-1])
		if _, isDecisionToken := decisionTokenSet[lastLine]; !isDecisionToken {
			break
		}
		lines = lines[:len(lines)-1]
	}

	return strings.TrimSpace(strings.Join(lines, "\n"))
}

// sanitizeAssistantContentForToolCalls keeps short natural-language planning
// text but drops DSML/function-call scaffolding and binary-like payloads that
// would only pollute the next LLM turn.
func sanitizeAssistantContentForToolCalls(content string) string {
	result := sanitizeFinalAssistantContent(content)
	if result == "" {
		return ""
	}

	lower := strings.ToLower(result)
	if strings.Contains(result, "<｜DSML｜") ||
		strings.Contains(result, "<|") ||
		strings.Contains(lower, "function_calls") ||
		strings.Contains(lower, "invoke name=") ||
		strings.Contains(lower, "\"tool_calls\"") ||
		strings.Contains(lower, "\"arguments\"") {
		return ""
	}

	for _, r := range result {
		if unicode.IsControl(r) && r != '\n' && r != '\r' && r != '\t' {
			return ""
		}
	}

	return truncateRunes(strings.TrimSpace(result), 500)
}

// ensureNonEmptyFinalAssistantContent provides a runtime fallback summary when
// the model returns only control tags (for example: <decision>DONE</decision>)
// after tool execution.
func ensureNonEmptyFinalAssistantContent(content string, messages []relay_model.Message, skillName string) string {
	result := strings.TrimSpace(content)
	if result != "" {
		return result
	}

	lastToolOutput := getLastToolOutput(messages)
	if lastToolOutput == "" {
		return ""
	}

	if weatherSummary := summarizeWeatherToolOutput(lastToolOutput); weatherSummary != "" {
		return weatherSummary
	}

	snippet := firstMeaningfulToolLine(lastToolOutput)
	if snippet == "" {
		snippet = "工具已执行完成。"
	}
	snippet = truncateRunes(snippet, 120)

	if skillName != "" {
		return fmt.Sprintf("%s 执行完成：%s", skillName, snippet)
	}
	return fmt.Sprintf("工具执行完成：%s", snippet)
}

func getLastToolOutput(messages []relay_model.Message) string {
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role != "tool" {
			continue
		}
		content, ok := messages[i].Content.(string)
		if !ok {
			continue
		}
		content = strings.TrimSpace(content)
		if content != "" {
			return content
		}
	}
	return ""
}

func firstMeaningfulToolLine(output string) string {
	lines := strings.Split(output, "\n")
	for _, line := range lines {
		text := strings.TrimSpace(line)
		if text == "" {
			continue
		}
		if strings.HasPrefix(text, "===") || strings.HasPrefix(text, "---") {
			continue
		}
		return text
	}
	return ""
}

func summarizeWeatherToolOutput(output string) string {
	weather := extractWeatherField(output, "天气:")
	temp := extractWeatherField(output, "温度:")
	wind := extractWeatherField(output, "风向风力:")
	humidity := extractWeatherField(output, "湿度:")

	if weather == "" && temp == "" && wind == "" && humidity == "" {
		return ""
	}

	city := extractWeatherCity(output)
	prefix := "今日当地"
	if city != "" {
		prefix = "今日" + city
	}

	parts := make([]string, 0, 4)
	if weather != "" {
		parts = append(parts, "天气为"+weather)
	}
	if temp != "" {
		parts = append(parts, "气温"+normalizeTemperature(temp))
	}
	if wind != "" {
		compactWind := strings.Join(strings.Fields(wind), "")
		parts = append(parts, compactWind)
	}
	if humidity != "" {
		parts = append(parts, "湿度"+normalizeHumidity(humidity))
	}
	if len(parts) == 0 {
		return ""
	}

	return prefix + strings.Join(parts, "，") + "。"
}

func extractWeatherField(output string, key string) string {
	lines := strings.Split(output, "\n")
	for _, line := range lines {
		text := strings.TrimSpace(line)
		if strings.HasPrefix(text, key) {
			return strings.TrimSpace(strings.TrimPrefix(text, key))
		}
	}
	return ""
}

func extractWeatherCity(output string) string {
	lines := strings.Split(output, "\n")
	for _, line := range lines {
		text := strings.TrimSpace(line)
		if !strings.Contains(text, "天气实况") {
			continue
		}
		text = strings.Trim(text, "= ")
		text = strings.TrimSpace(strings.TrimSuffix(text, "天气实况"))
		fields := strings.Fields(text)
		if len(fields) == 0 {
			return ""
		}
		return fields[len(fields)-1]
	}
	return ""
}

func normalizeTemperature(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if strings.Contains(value, "°") {
		return value
	}
	return value + "°C"
}

func normalizeHumidity(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if strings.HasSuffix(value, "%") {
		return value
	}
	return value + "%"
}

func truncateRunes(value string, limit int) string {
	if limit <= 0 {
		return ""
	}
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit]) + "..."
}

// buildIntentClassificationStepData returns a safe subset for process-step output.
func buildIntentClassificationStepData(result *rag.IntentClassificationResult) map[string]interface{} {
	intentData := map[string]interface{}{
		"intent":           "",
		"skill_name":       "",
		"confidence":       float64(0),
		"reasoning":        "",
		"keywords":         []string{},
		"document_type":    "",
		"normalized_query": "",
		"expanded_queries": []string{},
	}

	if result != nil {
		intentData["intent"] = result.Intent
		intentData["skill_name"] = result.SkillName
		intentData["confidence"] = result.Confidence
		if strings.TrimSpace(result.Reasoning) != "" {
			intentData["reasoning"] = truncateRunes(strings.TrimSpace(result.Reasoning), 1200)
		}
		if result.Keywords != nil {
			intentData["keywords"] = result.Keywords
		}
		if strings.TrimSpace(result.DocumentType) != "" {
			intentData["document_type"] = strings.TrimSpace(result.DocumentType)
		}
		if strings.TrimSpace(result.NormalizedQuery) != "" {
			intentData["normalized_query"] = strings.TrimSpace(result.NormalizedQuery)
		}
		if result.ExpandedQueries != nil {
			intentData["expanded_queries"] = result.ExpandedQueries
		}
	}

	return map[string]interface{}{
		"intent": intentData,
	}
}

func buildQueryExpansionStepData(result *rag.QueryExpansionResult) map[string]interface{} {
	expansionData := map[string]interface{}{
		"normalized_query": "",
		"keywords":         []string{},
		"document_type":    "",
		"expanded_queries": []string{},
	}

	if result != nil {
		if strings.TrimSpace(result.NormalizedQuery) != "" {
			expansionData["normalized_query"] = strings.TrimSpace(result.NormalizedQuery)
		}
		if result.Keywords != nil {
			expansionData["keywords"] = result.Keywords
		}
		if strings.TrimSpace(result.DocumentType) != "" {
			expansionData["document_type"] = strings.TrimSpace(result.DocumentType)
		}
		if result.ExpandedQueries != nil {
			expansionData["expanded_queries"] = result.ExpandedQueries
		}
	}

	return map[string]interface{}{
		"query_expansion": expansionData,
	}
}

func mergeComplexQueryExpansionResult(result *rag.IntentClassificationResult, expansion *rag.QueryExpansionResult) {
	if result == nil || expansion == nil {
		return
	}

	if normalizedQuery := strings.TrimSpace(expansion.NormalizedQuery); normalizedQuery != "" {
		result.NormalizedQuery = normalizedQuery
	}
	if len(expansion.Keywords) > 0 {
		result.Keywords = append([]string(nil), expansion.Keywords...)
	}
	if documentType := strings.TrimSpace(expansion.DocumentType); documentType != "" {
		result.DocumentType = documentType
	}
	if len(expansion.ExpandedQueries) > 0 {
		result.ExpandedQueries = append([]string(nil), expansion.ExpandedQueries...)
	}
}

func shouldInjectIntentSkillCandidates(agent *model.Agent, chatRequest *ChatRequest) bool {
	if agent == nil {
		return false
	}
	if chatRequest != nil && chatRequest.EnableSkillAutoMatch != nil {
		return *chatRequest.EnableSkillAutoMatch
	}
	return agent.AgentUsage == model.AgentUsageWorkAI
}

func buildIntentSkillCandidates(agent *model.Agent, chatRequest *ChatRequest, query string, runScope skill.RunScope, allowedPathSet map[string]struct{}) []*skill.Skill {
	if agent == nil || !shouldInjectIntentSkillCandidates(agent, chatRequest) {
		return nil
	}

	matches := skill.GetManager().MatchSkillsWithScope(agent.Eid, query, runScope)
	candidates := selectIntentSkillCandidatesFromMatches(matches, allowedPathSet, maxIntentSkillCandidates)
	if len(candidates) > 0 {
		return candidates
	}

	runnableSkills, _ := skill.GetManager().ListRunnableSkills(agent.Eid, runScope)
	return buildBroadIntentSkillCandidates(runnableSkills, allowedPathSet)
}

func buildIntentSkillCandidateQuery(query string, conversation []rag.ConversationItem) string {
	query = strings.TrimSpace(query)
	var builder strings.Builder
	if query != "" {
		builder.WriteString(query)
	}

	start := 0
	if len(conversation) > maxIntentSkillCandidateConversationItems {
		start = len(conversation) - maxIntentSkillCandidateConversationItems
	}
	for _, item := range conversation[start:] {
		itemQuery := strings.TrimSpace(item.Query)
		itemAnswer := strings.TrimSpace(item.Answer)
		if itemQuery == "" && itemAnswer == "" {
			continue
		}
		if builder.Len() > 0 {
			builder.WriteString("\n")
		}
		if itemQuery != "" {
			builder.WriteString(itemQuery)
		}
		if itemAnswer != "" {
			if itemQuery != "" {
				builder.WriteString("\n")
			}
			builder.WriteString(itemAnswer)
		}
	}

	return truncateRunes(builder.String(), maxIntentSkillCandidateQueryRunes)
}

func selectIntentSkillCandidatesFromMatches(matches []*skill.SkillMatchResult, allowedPathSet map[string]struct{}, limit int) []*skill.Skill {
	if len(matches) == 0 || limit <= 0 {
		return nil
	}

	filtered := filterSkillMatchByPathSet(matches, allowedPathSet)
	candidates := make([]*skill.Skill, 0, minInt(limit, len(filtered)))
	seen := make(map[string]struct{}, len(filtered))

	for _, match := range filtered {
		if match == nil || match.Skill == nil {
			continue
		}
		name := strings.TrimSpace(match.Skill.Name)
		if name == "" {
			continue
		}
		if _, ok := seen[name]; ok {
			continue
		}
		seen[name] = struct{}{}
		candidates = append(candidates, cloneIntentSkillCandidate(match.Skill))
		if len(candidates) >= limit {
			break
		}
	}

	if len(candidates) == 0 {
		return nil
	}
	return candidates
}

func buildBroadIntentSkillCandidates(skills []*skill.Skill, allowedPathSet map[string]struct{}) []*skill.Skill {
	filtered := filterSkillsByPathSet(skills, allowedPathSet)
	if len(filtered) == 0 {
		return nil
	}

	candidates := make([]*skill.Skill, 0, len(filtered))
	seen := make(map[string]struct{}, len(filtered))
	for _, item := range filtered {
		if item == nil {
			continue
		}
		name := strings.TrimSpace(item.Name)
		if name == "" {
			continue
		}
		if _, ok := seen[name]; ok {
			continue
		}
		seen[name] = struct{}{}
		candidates = append(candidates, cloneIntentSkillCandidate(item))
	}
	if len(candidates) == 0 {
		return nil
	}
	return candidates
}

func cloneIntentSkillCandidate(item *skill.Skill) *skill.Skill {
	if item == nil {
		return nil
	}
	return &skill.Skill{
		Name:        strings.TrimSpace(item.Name),
		Description: truncateRunes(strings.TrimSpace(item.Description), maxIntentSkillDescriptionRunes),
		Path:        strings.TrimSpace(item.Path),
		AutoMatch:   item.AutoMatch,
	}
}

func shouldRetryIntentSkillSelection(result *rag.IntentClassificationResult, snapshot *skill.SkillSnapshot, allowedPathSet map[string]struct{}) bool {
	if result == nil || result.Intent != "USE_SKILL" {
		return false
	}
	skillName := strings.TrimSpace(result.SkillName)
	if skillName == "" {
		return true
	}
	if target := findSkillInSnapshot(snapshot, skillName); target != nil && isSkillAllowedByPathSet(target, allowedPathSet) {
		return false
	}
	if blockedReasons := findBlockedReasons(snapshot, skillName); len(blockedReasons) > 0 {
		return false
	}
	return true
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
