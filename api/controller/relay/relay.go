package relay

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	km_common "github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/ctxkey"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/session"
	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/common/utils/helper"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/middleware"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/53AI/53AIHub/service/hub_adaptor/custom"
	Hub_openai "github.com/53AI/53AIHub/service/hub_adaptor/openai"
	"github.com/53AI/53AIHub/service/rag"
	"github.com/53AI/53AIHub/service/skill"
	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common"
	oneapi_client "github.com/songquanpeng/one-api/common/client"
	oneapi_model "github.com/songquanpeng/one-api/model"
	"github.com/songquanpeng/one-api/monitor"
	"github.com/songquanpeng/one-api/relay/adaptor"
	"github.com/songquanpeng/one-api/relay/adaptor/openai"
	"github.com/songquanpeng/one-api/relay/apitype"
	billing_ratio "github.com/songquanpeng/one-api/relay/billing/ratio"
	"github.com/songquanpeng/one-api/relay/channeltype"
	"github.com/songquanpeng/one-api/relay/constant/role"
	"github.com/songquanpeng/one-api/relay/controller"
	"github.com/songquanpeng/one-api/relay/controller/validator"
	"github.com/songquanpeng/one-api/relay/meta"
	relay_meta "github.com/songquanpeng/one-api/relay/meta"
	relay_model "github.com/songquanpeng/one-api/relay/model"
	"github.com/songquanpeng/one-api/relay/relaymode"
)

func GetSessionAgent(c *gin.Context) (agent *model.Agent, err error) {
	sessionAgent, exists := c.Get(session.SESSION_AGENT)
	if !exists {
		return nil, errors.New("agent not found")
	}
	agent, ok := sessionAgent.(*model.Agent)
	if !ok {
		return nil, errors.New("agent not found")
	}
	return agent, nil
}

func GetSessionConversation(c *gin.Context) (conversation *model.Conversation, err error) {
	sessionConversation, exists := c.Get(session.SESSION_CONVERSATION)
	if !exists {
		return nil, errors.New("conversation not found")
	}
	conversation, ok := sessionConversation.(*model.Conversation)
	if !ok {
		return nil, errors.New("conversation not found")
	}
	return conversation, nil
}

func resolveChatConversation(c *gin.Context, chatRequest *ChatRequest) (*model.Conversation, error) {
	if conversation, err := GetSessionConversation(c); err == nil && conversation != nil {
		return conversation, nil
	}
	if chatRequest == nil || chatRequest.ConversationID <= 0 {
		return nil, errors.New("conversation not found")
	}

	conversation, err := model.GetConversationByID(config.GetEID(c), config.GetUserId(c), chatRequest.ConversationID)
	if err != nil {
		return nil, err
	}
	if c != nil {
		c.Set(session.SESSION_CONVERSATION_ID, conversation.ConversationID)
		c.Set(session.SESSION_CONVERSATION, conversation)
	}
	return conversation, nil
}

// extractUploadedFilesFromMessages 从消息中提取用户上传的文件
func extractUploadedFilesFromMessages(messages []relay_model.Message) []*model.UploadFile {
	var uploadedFiles []*model.UploadFile

	// 找最后一条用户消息
	var lastUserMessage *relay_model.Message
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role == "user" {
			lastUserMessage = &messages[i]
			break
		}
	}

	if lastUserMessage == nil {
		return uploadedFiles
	}

	content := lastUserMessage.StringContent()
	if content == "" {
		return uploadedFiles
	}

	// 尝试解析为 ObjectStringContent 数组
	var contentObjs []model.ObjectStringContent
	if err := json.Unmarshal([]byte(content), &contentObjs); err != nil {
		// 不是 JSON 格式，视为纯文本
		return uploadedFiles
	}

	// 提取文件对象
	for _, obj := range contentObjs {
		if obj.Type == "file" || obj.Type == "image" {
			uploadFile := obj.GetUploadFile()
			if uploadFile != nil {
				uploadedFiles = append(uploadedFiles, uploadFile)
			}
		}
	}

	return uploadedFiles
}

// @Summary Relay
// @Description AI聊天接口，支持知识库检索和步骤化输出。当enable_process_steps=true时，将返回处理步骤：kbs(知识库搜索), dcs(文档搜索), ang(回答生成)
// @Tags Relay
// @Accept json
// @Produce json
// @Param chatRequest body ChatRequest true "ChatRequest"
// @Success 500 {object} model.OpenAIErrorResponse
// @Router /v1/chat/completions [post]
// @Security BearerAuth
func Relay(c *gin.Context) {
	c.Set(ctxkey.Group, "vip")

	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(400, model.ParamError.ToOpenAIErrorRespone(err))
		return
	}

	// 处理请求参数（包括参数解析、验证和转换）
	processedBody, agent, err := ProcessRequestParams(c, body)
	if err != nil {
		// 根据错误类型返回不同的HTTP状态码和错误信息
		if err.Error() == "agent not found" {
			c.JSON(404, model.NotFound.ToOpenAIErrorRespone(err))
		} else {
			c.JSON(400, model.ParamError.ToOpenAIErrorRespone(err))
		}
		return
	}

	// 恢复处理后的请求体
	c.Request.Body = io.NopCloser(bytes.NewBuffer(processedBody))

	// 获取 relay 模式
	relayMode := relaymode.GetByPath(c.Request.URL.Path)

	// 处理普通聊天请求
	handleChatRequest(c, processedBody, agent, relayMode)
}

func pickAutoMatchSkill(matches []*skill.SkillMatchResult, minScore float64) *skill.SkillMatchResult {
	for _, match := range matches {
		if match == nil || match.Skill == nil {
			continue
		}
		if match.Score < minScore {
			continue
		}
		return match
	}
	return nil
}

const skillUnavailableMessage = "当前技能已停用，请重新选择技能"

func shouldApplySkillLibraryFilter(agent *model.Agent) bool {
	return agent != nil && agent.AgentUsage == model.AgentUsageWorkAI
}

func loadRunnableSkillPathSet(ctx context.Context, agent *model.Agent, userID int64) map[string]struct{} {
	if !shouldApplySkillLibraryFilter(agent) {
		return nil
	}
	if userID <= 0 {
		return map[string]struct{}{}
	}
	skillService := service.NewSkillLibraryService()
	pathSet, err := skillService.GetUserRunnableSkillPathSet(ctx, agent.Eid, userID)
	if err != nil {
		logger.Warnf(ctx, "【技能运行】加载用户可用技能集合失败，按空集合处理: eid=%d user_id=%d err=%v", agent.Eid, userID, err)
		return map[string]struct{}{}
	}
	return pathSet
}

func isSkillAllowedByPathSet(s *skill.Skill, allowedPathSet map[string]struct{}) bool {
	if s == nil {
		return false
	}
	if allowedPathSet == nil {
		return true
	}
	cleanPath := filepath.Clean(strings.TrimSpace(s.Path))
	if cleanPath == "" || cleanPath == "." {
		return false
	}
	_, ok := allowedPathSet[cleanPath]
	return ok
}

func filterSkillsByPathSet(skills []*skill.Skill, allowedPathSet map[string]struct{}) []*skill.Skill {
	if allowedPathSet == nil {
		return skills
	}
	result := make([]*skill.Skill, 0, len(skills))
	for _, item := range skills {
		if isSkillAllowedByPathSet(item, allowedPathSet) {
			result = append(result, item)
		}
	}
	return result
}

func filterSkillMatchByPathSet(matches []*skill.SkillMatchResult, allowedPathSet map[string]struct{}) []*skill.SkillMatchResult {
	if allowedPathSet == nil {
		return matches
	}
	result := make([]*skill.SkillMatchResult, 0, len(matches))
	for _, item := range matches {
		if item == nil || item.Skill == nil {
			continue
		}
		if isSkillAllowedByPathSet(item.Skill, allowedPathSet) {
			result = append(result, item)
		}
	}
	return result
}

func sendSkillUnavailableReply(c *gin.Context, chatRequest *ChatRequest, agent *model.Agent, relayMode int, originalQuestion string) {
	ctx := c.Request.Context()
	requestId := helper.GetRequestID(ctx)
	if requestId == "" {
		requestId = fmt.Sprintf("req-%d", time.Now().UnixNano())
	}
	requestId = ensureRequestID(c, requestId)

	if chatRequest != nil && chatRequest.Stream {
		SetupStreamInterceptor(c)
		SetUpStreamResponseHeaders(c)
	}

	messageStatus := &MessageStatsInfo{
		OriginalQuestion: originalQuestion,
		AgentModel:       agent,
		RelayMode:        relayMode,
		RequestId:        requestId,
		RequestSource:    normalizeRequestSource(chatRequest.Source),
	}
	handleOutOfRangeReply(c, chatRequest, agent, skillUnavailableMessage, requestId, relayMode, messageStatus)
}

func newSkillMessageStatsInfo(agent *model.Agent, relayMode int, requestId string, originalQuestion, rewrittenQuestion string, scope *skill.RunScope, uploadedFiles []*model.UploadFile, requestSource string) *MessageStatsInfo {
	return &MessageStatsInfo{
		ResponseStatus:    model.ResponseStatusNormal,
		ThinkingMode:      model.ThinkingModeQuick,
		KnowledgeScope:    "",
		KnowledgeType:     model.KnowledgeTypeDatabase,
		OriginalQuestion:  originalQuestion,
		RewrittenQuestion: rewrittenQuestion,
		AgentModel:        agent,
		RelayMode:         relayMode,
		RequestId:         requestId,
		UploadedFiles:     uploadedFiles,
		SkillRunScope:     scope,
		RequestSource:     requestSource,
	}
}

func buildSkillRunScope(ctx context.Context, agent *model.Agent, eid int64, defaultCWD string, runID string) skill.RunScope {
	scope := skill.BuildDefaultRunScope()
	scope.CWD = defaultCWD
	scope.EnvVars = map[string]string{
		"SKILL_RUN_ID":  runID,
		"SKILL_RUN_CWD": defaultCWD,
	}
	scope.Secrets = map[string]string{}
	for _, secretKey := range []string{"OPENAI_API_KEY", "ANTHROPIC_API_KEY"} {
		if value := os.Getenv(secretKey); strings.TrimSpace(value) != "" {
			scope.Secrets[secretKey] = value
		}
	}

	// 真实配置映射：enterprise + agent
	scope.Config = map[string]bool{
		"skill.enabled": true,
	}
	for _, configType := range []string{
		model.EnterpriseConfigTypeSMTP,
		model.EnterpriseConfigTypeMobile,
		model.EnterpriseConfigTypeSSO,
	} {
		enabled, err := service.IsEnterpriseConfigEnabled(eid, configType)
		if err != nil {
			logger.Warnf(ctx, "Load enterprise config failed: eid=%d, type=%s, err=%v", eid, configType, err)
			continue
		}
		scope.Config["enterprise."+configType] = enabled
	}

	if agent != nil {
		scope.Config["agent.workai"] = agent.AgentUsage == model.AgentUsageWorkAI
		scope.Config["agent.openclaw"] = agent.IsOpenClawAgent()
		scope.Config["agent.enabled"] = agent.Enable

		if cfg, err := agent.GetWebSearchConfig(); err == nil && cfg != nil {
			scope.Config["agent.web_search"] = cfg.Enable
		}
		if cfg, err := agent.GetGraphSearchConfig(); err == nil && cfg != nil {
			scope.Config["agent.graph_search"] = cfg.Enable
			scope.Config["agent.graph_search_default"] = cfg.DefaultEnable
		}
		if cfg, err := agent.GetSkillRunConfig(); err == nil && cfg != nil {
			scope.Config["agent.skill_run"] = cfg.Enable
		}
		if cfg, err := agent.GetFastReasoningConfig(); err == nil && cfg != nil {
			scope.Config["agent.fast_reasoning"] = cfg.ChannelID != nil && cfg.ModelName != nil
		}
	}
	return scope
}

func ensureSkillSnapshot(ctx context.Context, ms *MessageStatsInfo, eid int64, requestID string, scope skill.RunScope) *skill.SkillSnapshot {
	if ms != nil && ms.SkillSnapshot != nil {
		return ms.SkillSnapshot
	}
	snapshot := skill.GetManager().CreateRunSnapshot(eid, requestID, scope)
	if ms != nil {
		ms.SkillSnapshot = snapshot
	}
	logger.Infof(ctx, "【技能快照】created: run_id=%s, runnable=%d, blocked=%d", requestID, len(snapshot.Skills), len(snapshot.Blocked))
	return snapshot
}

func findSkillInSnapshot(snapshot *skill.SkillSnapshot, skillName string) *skill.Skill {
	if snapshot == nil || strings.TrimSpace(skillName) == "" {
		return nil
	}
	for _, s := range snapshot.Skills {
		if s != nil && s.Name == skillName {
			return s
		}
	}
	return nil
}

func findBlockedReasons(snapshot *skill.SkillSnapshot, skillName string) []string {
	if snapshot == nil || strings.TrimSpace(skillName) == "" {
		return nil
	}
	return snapshot.Blocked[skillName]
}

const (
	maxInjectedHistoryTurns    = 4
	maxInjectedHistoryChars    = 12000
	maxHistoryMessageRuneLimit = 2000
	maxIntentConversationItems = 4
	maxIntentMessageRuneLimit  = 500
)

func runeCount(s string) int {
	return len([]rune(s))
}

func truncateToRunes(s string, limit int) string {
	if limit <= 0 {
		return ""
	}
	runes := []rune(s)
	if len(runes) <= limit {
		return s
	}
	return string(runes[:limit])
}

func countUserMessages(messages []relay_model.Message) int {
	count := 0
	for _, message := range messages {
		if message.Role == "user" {
			count++
		}
	}
	return count
}

func getLastUserMessageText(messages []relay_model.Message) string {
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role != "user" {
			continue
		}
		if text := extractTextFromMessageContent(messages[i].Content); text != "" {
			return text
		}
	}
	return ""
}

func getMessageText(msg relay_model.Message) string {
	return extractTextFromMessageContent(msg.Content)
}

func extractTextFromMessageContent(content interface{}) string {
	contentStr, ok := content.(string)
	if !ok {
		return ""
	}
	contentStr = strings.TrimSpace(contentStr)
	if contentStr == "" {
		return ""
	}

	var contentObjs []model.ObjectStringContent
	if err := json.Unmarshal([]byte(contentStr), &contentObjs); err == nil && len(contentObjs) > 0 {
		textParts := make([]string, 0, len(contentObjs))
		for _, obj := range contentObjs {
			if obj.Type != "text" {
				continue
			}
			text := strings.TrimSpace(obj.Content)
			if text == "" {
				continue
			}
			textParts = append(textParts, text)
		}
		if len(textParts) > 0 {
			return strings.TrimSpace(strings.Join(textParts, "\n"))
		}
	}

	return contentStr
}

func buildHistoryMessagesFromStored(stored []*model.Message, maxTurns int, maxChars int) []relay_model.Message {
	historyMessages, _ := buildHistoryMessagesWithExtrasFromStored(stored, maxTurns, maxChars)
	return historyMessages
}

func buildHistoryMessagesWithExtrasFromStored(stored []*model.Message, maxTurns int, maxChars int) ([]relay_model.Message, map[int]map[string]interface{}) {
	if len(stored) == 0 || maxTurns <= 0 || maxChars <= 0 {
		return nil, nil
	}

	type historyPair struct {
		question         string
		answer           string
		reasoningContent string
	}

	pairsDesc := make([]historyPair, 0, maxTurns)
	usedChars := 0

	for _, record := range stored {
		question := strings.TrimSpace(record.OriginalQuestion)
		if question == "" {
			continue
		}
		answer := strings.TrimSpace(record.Answer)
		reasoningContent := strings.TrimSpace(record.ReasoningContent)

		question = truncateToRunes(question, maxHistoryMessageRuneLimit)
		answer = truncateToRunes(answer, maxHistoryMessageRuneLimit)
		reasoningContent = truncateToRunes(reasoningContent, maxHistoryMessageRuneLimit)

		pairChars := runeCount(question) + runeCount(answer)
		if pairChars == 0 {
			continue
		}

		if usedChars+pairChars > maxChars {
			remaining := maxChars - usedChars
			if remaining <= 0 {
				break
			}
			if runeCount(question) > remaining {
				question = truncateToRunes(question, remaining)
				answer = ""
				reasoningContent = ""
			} else {
				answer = truncateToRunes(answer, remaining-runeCount(question))
				if answer == "" {
					reasoningContent = ""
				}
			}
			pairChars = runeCount(question) + runeCount(answer)
			if pairChars == 0 {
				break
			}
		}

		pairsDesc = append(pairsDesc, historyPair{
			question:         question,
			answer:           answer,
			reasoningContent: reasoningContent,
		})
		usedChars += pairChars

		if len(pairsDesc) >= maxTurns || usedChars >= maxChars {
			break
		}
	}

	if len(pairsDesc) == 0 {
		return nil, nil
	}

	historyMessages := make([]relay_model.Message, 0, len(pairsDesc)*2)
	assistantExtras := make(map[int]map[string]interface{})
	assistantOrdinal := 0
	for i := len(pairsDesc) - 1; i >= 0; i-- {
		pair := pairsDesc[i]
		if pair.question != "" {
			historyMessages = append(historyMessages, relay_model.Message{
				Role:    "user",
				Content: pair.question,
			})
		}
		if pair.answer != "" {
			historyMessages = append(historyMessages, relay_model.Message{
				Role:    "assistant",
				Content: pair.answer,
			})
			if pair.reasoningContent != "" {
				assistantExtras[assistantOrdinal] = map[string]interface{}{
					"reasoning_content": pair.reasoningContent,
				}
			}
			assistantOrdinal++
		}
	}

	if len(assistantExtras) == 0 {
		assistantExtras = nil
	}
	return historyMessages, assistantExtras
}

func injectRecentConversationHistory(ctx context.Context, chatRequest *ChatRequest, eid int64, userID int64) (map[int]map[string]interface{}, int) {
	if chatRequest == nil || chatRequest.ConversationID <= 0 || userID <= 0 {
		return nil, 0
	}
	if countUserMessages(chatRequest.Messages) > 1 {
		return nil, 0
	}

	if _, err := model.GetConversationByID(eid, userID, chatRequest.ConversationID); err != nil {
		logger.Warnf(ctx, "Skip history injection: conversation not accessible, eid=%d user_id=%d conversation_id=%d err=%v",
			eid, userID, chatRequest.ConversationID, err)
		return nil, 0
	}

	_, stored, err := model.GetMessagesByConversationIDWithDirection(eid, chatRequest.ConversationID, "", maxInjectedHistoryTurns*3, 0, "desc")
	if err != nil {
		logger.Warnf(ctx, "Load conversation history failed, conversation_id=%d err=%v", chatRequest.ConversationID, err)
		return nil, 0
	}

	historyMessages, historyAssistantExtras := buildHistoryMessagesWithExtrasFromStored(stored, maxInjectedHistoryTurns, maxInjectedHistoryChars)
	if len(historyMessages) == 0 {
		return nil, 0
	}

	if len(chatRequest.Messages) > 0 && chatRequest.Messages[0].Role == role.System {
		merged := make([]relay_model.Message, 0, 1+len(historyMessages)+len(chatRequest.Messages)-1)
		merged = append(merged, chatRequest.Messages[0])
		merged = append(merged, historyMessages...)
		merged = append(merged, chatRequest.Messages[1:]...)
		chatRequest.Messages = merged
	} else {
		merged := make([]relay_model.Message, 0, len(historyMessages)+len(chatRequest.Messages))
		merged = append(merged, historyMessages...)
		merged = append(merged, chatRequest.Messages...)
		chatRequest.Messages = merged
	}

	logger.Infof(ctx, "Injected conversation history: conversation_id=%d, injected_messages=%d, max_turns=%d, max_chars=%d",
		chatRequest.ConversationID, len(historyMessages), maxInjectedHistoryTurns, maxInjectedHistoryChars)
	return historyAssistantExtras, countAssistantMessages(historyMessages)
}

func buildIntentConversationFromMessages(messages []relay_model.Message, currentQuery string, maxItems int) []rag.ConversationItem {
	if len(messages) == 0 || maxItems <= 0 {
		return nil
	}

	pairs := make([]rag.ConversationItem, 0, maxItems)
	normalizedCurrent := strings.TrimSpace(currentQuery)

	for i := 0; i < len(messages); i++ {
		msg := messages[i]
		if msg.Role != "user" {
			continue
		}

		query := getMessageText(msg)
		if query == "" {
			continue
		}

		answer := ""
		for j := i + 1; j < len(messages); j++ {
			next := messages[j]
			if next.Role == "assistant" {
				answer = getMessageText(next)
				break
			}
			if next.Role == "user" {
				break
			}
		}

		// currentQuery 会单独通过 request.Query 传入，这里只保留历史对话。
		if normalizedCurrent != "" && query == normalizedCurrent && answer == "" {
			continue
		}

		query = truncateToRunes(query, maxIntentMessageRuneLimit)
		answer = truncateToRunes(answer, maxIntentMessageRuneLimit)
		pairs = append(pairs, rag.ConversationItem{
			Query:  query,
			Answer: answer,
		})
	}

	if len(pairs) > maxItems {
		return pairs[len(pairs)-maxItems:]
	}
	return pairs
}

func applyNormalizedQueryToMessages(messages []relay_model.Message, normalizedQuery string) []relay_model.Message {
	normalizedQuery = strings.TrimSpace(normalizedQuery)
	if normalizedQuery == "" {
		return messages
	}

	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role != "user" {
			continue
		}
		if _, ok := messages[i].Content.(string); !ok {
			return messages
		}
		messages[i].Content = normalizedQuery
		return messages
	}

	return messages
}

// handleChatRequest 处理标准聊天请求
func handleChatRequest(c *gin.Context, body []byte, agent *model.Agent, relayMode int) {
	var chatRequest ChatRequest
	if err := json.Unmarshal(body, &chatRequest); err != nil {
		c.JSON(400, model.ParamError.ToOpenAIErrorRespone(err))
		return
	}

	requestAssistantExtras := extractAssistantMessageExtrasFromBody(body)
	requestPassthroughFields := extractRequestPassthroughFields(body)
	if len(requestPassthroughFields) > 0 {
		storeRequestPassthroughFields(c, requestPassthroughFields)
	}

	requestCtx, _, requestID := prepareDetachedExecutionContext(c, helper.GetRequestID(c.Request.Context()))
	runCtx, runCancel := startAgentRunCancelWatcher(c.Request.Context(), agent.Eid, requestID, time.Second)
	defer runCancel()
	if c != nil && c.Request != nil {
		c.Request = c.Request.WithContext(runCtx)
	}
	ctx := c.Request.Context()

	if conversation, convErr := resolveChatConversation(c, &chatRequest); convErr == nil && conversation != nil {
		runSvc := service.NewAgentRunService()
		run, created, runErr := runSvc.EnsureRunForRequest(ctx, agent.Eid, conversation.ConversationID, 0, requestID)
		if runErr != nil {
			logger.Warnf(ctx, "创建 agent run 失败: conversation_id=%d request_id=%s err=%v", conversation.ConversationID, requestID, runErr)
		} else if created {
			if _, err := runSvc.AppendEvent(ctx, agent.Eid, run.RunID, run.RequestID, model.AgentRunEventRunCreated, 0, map[string]interface{}{
				"conversation_id": conversation.ConversationID,
				"request_id":      requestID,
			}); err != nil {
				logger.Warnf(ctx, "追加 agent run created 事件失败: run_id=%s err=%v", run.RunID, err)
			}
		}
	}

	// 设置 EnableProcessSteps 默认值为 true
	if !chatRequest.EnableProcessSteps {
		chatRequest.EnableProcessSteps = true
	}

	// 检查是否启用问题改写功能
	var originalQuestion, rewrittenQuestion string

	// 获取最后一个用户消息作为当前问题
	originalQuestion = getLastUserMessageText(chatRequest.Messages)

	currentUserID := config.GetUserId(c)
	var currentUser *model.User
	if currentUserID > 0 {
		var userErr error
		currentUser, userErr = model.GetUserByID(currentUserID)
		if userErr != nil {
			logger.Warnf(c.Request.Context(), "加载会话用户失败: userID=%d, err=%v", currentUserID, userErr)
		}
	}

	if shouldDisableKnowledgeSearchForUser(agent, currentUser) {
		clearKnowledgeSearchScope(&chatRequest)
		logger.Infof(c.Request.Context(), "【知识库限制】WorkAI 注册用户禁用知识库检索: userID=%d, eid=%d, agentID=%d", currentUserID, agent.Eid, agent.AgentID)
	}

	// 兼容前端只传当前轮消息：按 conversation_id 自动补最近几轮历史，并做长度预算裁剪，避免上下文超限。
	historyAssistantExtras, historyAssistantCount := injectRecentConversationHistory(c.Request.Context(), &chatRequest, agent.Eid, currentUserID)
	if len(historyAssistantExtras) > 0 || len(requestAssistantExtras) > 0 {
		shiftedRequestAssistantExtras := requestAssistantExtras
		if historyAssistantCount > 0 {
			shiftedRequestAssistantExtras = shiftAssistantOrdinalExtras(requestAssistantExtras, historyAssistantCount)
		}
		storeAssistantMessageExtras(c, mergeAssistantOrdinalExtras(historyAssistantExtras, shiftedRequestAssistantExtras))
	}

	var runnableSkillPathSet map[string]struct{}

	// 处理手动触发技能 (/skillname)
	// 如果用户问题以 / 开头，尝试直接匹配技能
	if strings.HasPrefix(originalQuestion, "/") {
		skillName := strings.TrimPrefix(strings.Split(originalQuestion, " ")[0], "/")
		blockedRequestID := helper.GetRequestID(c.Request.Context())
		if blockedRequestID == "" {
			blockedRequestID = fmt.Sprintf("req-%d", time.Now().UnixNano())
		}
		blockedRequestID = ensureRequestID(c, blockedRequestID)
		scope := buildSkillRunScope(c.Request.Context(), agent, agent.Eid, ".", blockedRequestID)
		rawSkill := skill.GetManager().GetSkill(agent.Eid, skillName)
		if rawSkill == nil {
			logger.Infof(c.Request.Context(), "【技能运行】手动触发技能不存在: skill=%s, user_id=%d", skillName, currentUserID)
			sendSkillUnavailableReply(c, &chatRequest, agent, relayMode, originalQuestion)
			return
		}
		matchedSkill := rawSkill
		logger.Infof(c.Request.Context(), "Manual Skill Trigger: %s", matchedSkill.Name)
		// 直接进入技能执行流程
		requestId := requestID

		// 确保流式响应拦截器已设置
		if chatRequest.Stream {
			SetupStreamInterceptor(c)
			SetUpStreamResponseHeaders(c)
		}

		messageStatus := newSkillMessageStatsInfo(agent, relayMode, requestId, originalQuestion, "", &scope, extractUploadedFilesFromMessages(chatRequest.Messages), normalizeRequestSource(chatRequest.Source))
		messageStatus.SkillSnapshot = skill.GetManager().CreateRunSnapshot(agent.Eid, requestId, scope)
		stepSender := NewProcessSender(c, requestId, &chatRequest, messageStatus)
		messageStatus.StepSender = stepSender

		// 发送技能路由步骤
		messageStatus.StepSender.SendStartStep(STEP_SKILL_ROUTING, "正在激活手动技能...", nil)
		messageStatus.StepSender.SendEndStep(STEP_SKILL_ROUTING, fmt.Sprintf("已激活技能: %s", matchedSkill.Name), map[string]interface{}{
			"skill_name": matchedSkill.Name,
			"manual":     true,
		})

		// Set RouterResult for manual trigger too
		messageStatus.RouterResult = &RouterResult{
			Skill: matchedSkill,
		}

		executeSkill(c, &chatRequest, requestCtx, ctx, messageStatus, matchedSkill)
		return
	}

	requestId := requestID

	// 确保流式响应拦截器已设置（如果需要流式响应）
	if chatRequest.Stream {
		SetupStreamInterceptor(c)
		SetUpStreamResponseHeaders(c)
	}
	runScope := buildSkillRunScope(ctx, agent, agent.Eid, ".", requestId)

	messageStatus := newSkillMessageStatsInfo(agent, relayMode, requestId, originalQuestion, rewrittenQuestion, &runScope, extractUploadedFilesFromMessages(chatRequest.Messages), normalizeRequestSource(chatRequest.Source))
	stepSender := NewProcessSender(c, requestId, &chatRequest, messageStatus)
	messageStatus.StepSender = stepSender
	runnableSkillPathSet, skillSnapshot := prepareIntentRoutingPrerequisites(
		ctx,
		shouldApplySkillLibraryFilter(agent),
		func(callCtx context.Context) map[string]struct{} {
			return loadRunnableSkillPathSet(callCtx, agent, currentUserID)
		},
		func(callCtx context.Context) *skill.SkillSnapshot {
			return ensureSkillSnapshot(callCtx, nil, agent.Eid, requestId, runScope)
		},
	)
	messageStatus.SkillSnapshot = skillSnapshot

	// 流式请求在进入路由前提前创建 master message，确保 RAG/意图识别步骤可以立即输出首帧
	if chatRequest.Stream {
		meta := GetByContext(c)
		meta.IsStream = chatRequest.Stream
		initialModel := chatRequest.Model
		if initialModel == "" {
			initialModel = agent.Model
		}
		initialTextRequest := &relay_model.GeneralOpenAIRequest{
			Messages: chatRequest.Messages,
			Model:    initialModel,
			Stream:   chatRequest.Stream,
		}
		if conversation, err := GetSessionConversation(c); err == nil {
			if messageID, err := ensureStreamingMasterMessageBeforeRAG(c, &chatRequest, agent, currentUserID, conversation.ConversationID, initialTextRequest, meta, requestId, messageStatus); err != nil {
				logger.Warnf(c.Request.Context(), "提前创建流式消息失败: %v", err)
			} else if messageID > 0 {
				logger.Debugf(c.Request.Context(), "【技能运行】流式消息已提前创建: message_id=%d", messageID)
			}
		} else {
			logger.Warnf(c.Request.Context(), "提前创建流式消息失败，无法获取会话: %v", err)
		}
	}

	relayRouter := NewRelayRouter(&chatRequest, messageStatus)
	if relayResult := relayRouter.Level1Router(); relayResult != nil && relayResult.ReplyStop {
		// 处理预设回答，预设的配置明前还没确定
		handleOutOfRangeReply(c, &chatRequest, agent, relayResult.Content, requestId, relayMode, messageStatus)
		return
	}

	// 意图识别与路由 (Intent Classification & Routing)
	// 如果是 Hub 模式或单文件模式，跳过意图识别，直接走简单 RAG
	if chatRequest.DatasetIsSoloFile() || agent.AgentUsage == model.AgentUsageHub {
		// Skip intent classification
		messageStatus.RouterResult = &RouterResult{
			IntentClassificationResult: &rag.IntentClassificationResult{
				Intent: "SIMPLE_RAG",
			},
		}
	} else {
		messageStatus.StepSender.SendStartStep(STEP_INTENT_CLASSIFICATION, "正在识别意图...", nil)

		// 意图识别，传入可用技能
		contentGenerator := rag.NewContentGeneratorService(model.DB)
		query := messageStatus.RewrittenQuestion
		if query == "" {
			query = messageStatus.OriginalQuestion
		}
		allowIntentSkillCandidates := shouldInjectIntentSkillCandidates(agent, &chatRequest)
		intentConversation := buildIntentConversationFromMessages(chatRequest.Messages, query, maxIntentConversationItems)
		skillCandidateQuery := buildIntentSkillCandidateQuery(query, intentConversation)
		autoMatchSkills := buildIntentSkillCandidates(agent, &chatRequest, skillCandidateQuery, runScope, runnableSkillPathSet)
		intentReq := &rag.IntentClassificationRequest{
			Query:        query,
			Conversation: intentConversation,
		}
		logger.Debugf(ctx, "Intent classification conversation injected: items=%d", len(intentConversation))

		// 使用 ChunkConfigService 获取 Config
		chunkConfigService := rag.NewChunkConfigService(model.DB)
		// 这里假设我们使用系统默认配置或者从其他地方获取 EID，Agent Model 中有 Eid
		// 但 GetConfig 需要知道 chunkType，这里我们可以用 Default
		// 或者更好的方式：如果 agent.GetChunkConfig 不可用，我们应该有一个获取 Config 的逻辑
		// 之前代码里有 agent.GetChunkConfig() 调用，但那是个假想的方法

		// 正确获取 Config 的方式：
		// 我们可以使用 Default Config
		config, err := chunkConfigService.GetConfig(agent.Eid, nil, model.ChunkTypeDefault)
		if err != nil {
			logger.Warnf(ctx, "Get chunk config failed: %v", err)
			config, _ = chunkConfigService.GetSystemDefaultConfig(model.ChunkTypeDefault)
		}

		classificationResult, err := contentGenerator.GenerateFastIntentRoute(ctx, agent.Eid, config, intentReq, autoMatchSkills, agent)

		if err != nil {
			logger.Warnf(ctx, "意图识别失败: %v", err)
			// Fallback to SIMPLE_RAG
			classificationResult = &rag.IntentClassificationResult{Intent: "SIMPLE_RAG"}
		}

		if classificationResult == nil {
			classificationResult = &rag.IntentClassificationResult{Intent: "SIMPLE_RAG"}
		}

		if allowIntentSkillCandidates && shouldRetryIntentSkillSelection(classificationResult, skillSnapshot, runnableSkillPathSet) {
			var runnableSkills []*skill.Skill
			if skillSnapshot != nil {
				runnableSkills = skillSnapshot.Skills
			}
			broadSkillCandidates := buildBroadIntentSkillCandidates(runnableSkills, runnableSkillPathSet)
			if len(broadSkillCandidates) > 0 {
				retryResult, retryErr := contentGenerator.GenerateFastIntentRoute(ctx, agent.Eid, config, intentReq, broadSkillCandidates, agent)
				if retryErr != nil {
					logger.Warnf(ctx, "技能意图二次匹配失败: %v", retryErr)
				} else if retryResult != nil {
					if retryResult.Intent == "USE_SKILL" && strings.TrimSpace(retryResult.SkillName) != "" {
						logger.Infof(ctx, "技能意图二次匹配成功: skill=%s, candidate_count=%d", retryResult.SkillName, len(broadSkillCandidates))
						classificationResult = retryResult
					} else {
						logger.Warnf(ctx, "技能意图二次匹配未选出技能: intent=%s, skill=%s, candidate_count=%d", retryResult.Intent, retryResult.SkillName, len(broadSkillCandidates))
					}
				}
			} else {
				logger.Warnf(ctx, "技能意图需要二次匹配，但没有可用技能候选")
			}
		}

		messageStatus.StepSender.SendEndStep(STEP_INTENT_CLASSIFICATION, "意图识别完成", buildIntentClassificationStepData(classificationResult))

		if classificationResult.Intent == "COMPLEX_AGENT" {
			expansionQuery := strings.TrimSpace(classificationResult.NormalizedQuery)
			if expansionQuery == "" {
				expansionQuery = query
			}
			expansionReq := &rag.IntentClassificationRequest{
				Query:        expansionQuery,
				Conversation: intentConversation,
			}

			messageStatus.StepSender.SendStartStep(STEP_QUERY_EXPANSION, "正在拆解复杂问题...", nil)
			expansionResult, expansionErr := contentGenerator.GenerateComplexQueryExpansion(ctx, agent.Eid, config, expansionReq, agent)
			if expansionErr != nil {
				logger.Warnf(ctx, "复杂问题拆解失败: %v", expansionErr)
				messageStatus.StepSender.SendEndStep(STEP_QUERY_EXPANSION, "问题拆解失败，已按原问题检索", map[string]interface{}{
					"error": true,
				})
			} else {
				mergeComplexQueryExpansionResult(classificationResult, expansionResult)
				messageStatus.StepSender.SendEndStep(STEP_QUERY_EXPANSION, "问题拆解完成", buildQueryExpansionStepData(expansionResult))
			}
		}

		if normalizedQuery := strings.TrimSpace(classificationResult.NormalizedQuery); normalizedQuery != "" {
			messageStatus.RewrittenQuestion = normalizedQuery
			chatRequest.Messages = applyNormalizedQueryToMessages(chatRequest.Messages, normalizedQuery)
		}

		// 处理意图分支
		switch classificationResult.Intent {
		case "CHITCHAT":
			// 修复 BUG #1133244388001005148: 如果闲聊回答为空，使用拒答文案
			if classificationResult.Answer == "" {
				outOfRangeConfig, _ := agent.GetOutOfRangeReplyConfig()
				if outOfRangeConfig != nil && outOfRangeConfig.Enable && outOfRangeConfig.Reply != "" {
					stepSender.SendOutOfRangeReply()
					handleOutOfRangeReply(c, &chatRequest, agent, outOfRangeConfig.Reply, requestId, relayMode, messageStatus)
					return
				}
			}
			if classificationResult.Answer == "" {
				messageStatus.RouterResult = &RouterResult{
					IntentClassificationResult: classificationResult,
				}
				processChatRequestV2(c, &chatRequest, ctx, messageStatus)
				return
			}
			handleOutOfRangeReply(c, &chatRequest, agent, classificationResult.Answer, requestId, relayMode, messageStatus)
			return

		case "USE_SKILL":
			// 先按技能名找到目标技能，再校验是否属于当前用户可运行集合（tenant 优先，global 兜底）。
			rawSkill := skill.GetManager().GetSkill(agent.Eid, classificationResult.SkillName)
			if rawSkill != nil && !isSkillAllowedByPathSet(rawSkill, runnableSkillPathSet) {
				logger.Infof(ctx, "【技能运行】意图命中技能但不在当前可运行集合中: skill=%s, user_id=%d", rawSkill.Name, currentUserID)
				logger.Warnf(ctx, "Intent matched skill '%s' but is not runnable for current user, skipping skill and continuing", rawSkill.Name)
				messageStatus.StepSender.SendStartStep(STEP_SKILL_ROUTING, fmt.Sprintf("技能不可用: %s", classificationResult.SkillName), map[string]interface{}{
					"blocked": true,
				})
				messageStatus.StepSender.SendEndStep(STEP_SKILL_ROUTING, "技能不可用，已回退到RAG", nil)
				messageStatus.RouterResult = &RouterResult{
					IntentClassificationResult: classificationResult,
				}
				break
			}

			targetSkill := findSkillInSnapshot(skillSnapshot, classificationResult.SkillName)
			if targetSkill != nil && !isSkillAllowedByPathSet(targetSkill, runnableSkillPathSet) {
				logger.Infof(ctx, "【技能运行】意图命中技能但未进入当前可运行集合: skill=%s, user_id=%d", targetSkill.Name, currentUserID)
				messageStatus.StepSender.SendStartStep(STEP_SKILL_ROUTING, fmt.Sprintf("技能不可用: %s", targetSkill.Name), map[string]interface{}{
					"blocked": true,
				})
				messageStatus.StepSender.SendEndStep(STEP_SKILL_ROUTING, "技能不可用，已回退到RAG", nil)
				messageStatus.RouterResult = &RouterResult{
					IntentClassificationResult: classificationResult,
				}
				break
			}
			if targetSkill != nil {
				logger.Infof(ctx, "Intent matched skill: %s", targetSkill.Name)
				messageStatus.StepSender.SendStartStep(STEP_SKILL_ROUTING, fmt.Sprintf("已激活技能: %s", targetSkill.Name), nil)
				messageStatus.StepSender.SendEndStep(STEP_SKILL_ROUTING, "技能加载完成", nil)

				// Ensure RouterResult is set so executeSkill can pass it down
				messageStatus.RouterResult = &RouterResult{
					IntentClassificationResult: classificationResult,
					Skill:                      targetSkill,
				}

				executeSkill(c, &chatRequest, requestCtx, ctx, messageStatus, targetSkill)
				return
			}
			if blockedReasons := findBlockedReasons(skillSnapshot, classificationResult.SkillName); len(blockedReasons) > 0 {
				logger.Warnf(ctx, "Intent matched skill but blocked by gating: skill=%s, reasons=%v", classificationResult.SkillName, blockedReasons)
				messageStatus.StepSender.SendStartStep(STEP_SKILL_ROUTING, fmt.Sprintf("技能不可用: %s", classificationResult.SkillName), map[string]interface{}{
					"blocked": true,
					"reasons": blockedReasons,
				})
				messageStatus.StepSender.SendEndStep(STEP_SKILL_ROUTING, "技能准入校验未通过，已回退到RAG", nil)
			}
			logger.Warnf(ctx, "Intent matched skill %s but not found, falling back to RAG", classificationResult.SkillName)
			// Fallback to RAG

		default: // SIMPLE_RAG, COMPLEX_AGENT
			// Continue to RAG flow
			messageStatus.RouterResult = &RouterResult{
				IntentClassificationResult: classificationResult,
			}
		}

		// 兜底：当意图识别误判为 RAG 时，使用 AutoMatch 技能匹配避免技能被跳过
		if allowIntentSkillCandidates &&
			classificationResult != nil &&
			(classificationResult.Intent == "SIMPLE_RAG" || classificationResult.Intent == "COMPLEX_AGENT") {
			query := messageStatus.RewrittenQuestion
			if query == "" {
				query = messageStatus.OriginalQuestion
			}
			if query != "" {
				allMatches := filterSkillMatchByPathSet(skill.GetManager().MatchSkillsWithScope(agent.Eid, query, runScope), runnableSkillPathSet)
				fallbackMatch := pickAutoMatchSkill(allMatches, 0.6)
				if fallbackMatch != nil && fallbackMatch.Skill != nil {
					logger.Infof(ctx, "【技能运行】触发技能兜底匹配: skill=%s, score=%.2f, original_intent=%s",
						fallbackMatch.Skill.Name, fallbackMatch.Score, classificationResult.Intent)
					messageStatus.StepSender.SendStartStep(STEP_SKILL_ROUTING, fmt.Sprintf("已激活技能: %s", fallbackMatch.Skill.Name), map[string]interface{}{
						"fallback":    true,
						"match_score": fallbackMatch.Score,
					})
					messageStatus.StepSender.SendEndStep(STEP_SKILL_ROUTING, "技能加载完成", nil)
					messageStatus.RouterResult = &RouterResult{
						IntentClassificationResult: classificationResult,
						Skill:                      fallbackMatch.Skill,
					}
					executeSkill(c, &chatRequest, requestCtx, ctx, messageStatus, fallbackMatch.Skill)
					return
				}
			}
		}
	}

	var sources []rag.SourceReference
	var err error
	ragCompleted := false
	if agent.AgentUsage != model.AgentUsageHub {
		logger.Infof(ctx, "【网络搜索】智能体允许进入 RAG：agent_usage=%d，开始判定知识库与网络搜索分支", agent.AgentUsage)
		sources, err = HandleRAG(c, &chatRequest, ctx, messageStatus)
		if err != nil {
			c.JSON(500, model.ParamError.ToOpenAIErrorRespone(err))
			return
		}
		ragCompleted = true
	} else {
		logger.Infof(ctx, "【网络搜索】智能体类型为 Hub，已跳过 RAG 检索，因此不会进入网络搜索分支：agent_usage=%d", agent.AgentUsage)
	}

	// 3. 重排序 (Rerank)
	if len(sources) > 0 && shouldRerank(agent, &chatRequest) {
		query := messageStatus.RewrittenQuestion
		if query == "" {
			query = messageStatus.OriginalQuestion
		}
		newSources, err := rerankSources(ctx, agent, query, sources)
		if err != nil {
			logger.Warnf(ctx, "重排序失败: %v", err)
		} else {
			sources = newSources
		}
	}

	// 4. 超纲回复 (OutOfRange Reply)
	outOfRangeConfig, _ := agent.GetOutOfRangeReplyConfig()
	if outOfRangeConfig != nil && outOfRangeConfig.Enable && len(sources) == 0 {
		if outOfRangeConfig.Mode == "continue" {
			// 模式：交给模型继续生成
			// 使用兜底提示词替换用户问题（如果有）
			if outOfRangeConfig.Prompt != "" {
				// 找到最后一个用户消息并替换
				for i := len(chatRequest.Messages) - 1; i >= 0; i-- {
					if chatRequest.Messages[i].Role == "user" {
						// 简单的追加，可以根据需要调整格式
						chatRequest.Messages[i].Content = outOfRangeConfig.Prompt
						break
					}
				}
				logger.Infof(ctx, "启用超纲回复(继续生成模式)，已替换 Prompt")
			}
			// 不返回，继续执行后续流程（processChatRequestV2）
		} else {
			// 模式：固定回复 (默认)
			stepSender.SendOutOfRangeReply()
			handleOutOfRangeReply(c, &chatRequest, agent, outOfRangeConfig.Reply, requestId, relayMode, messageStatus)
			return
		}
	} else if len(sources) == 0 {
		// 兼容旧逻辑
	}

	if len(sources) > 0 {
		// 添加上下文
		retrievalContext := CreateRetrievalContext(sources)
		addContextToMessages(&chatRequest, retrievalContext)
	}

	// 5. 回答偏好 (Answer Preference)
	prefConfig, _ := agent.GetAnswerPreferenceConfig()
	if prefConfig != nil && prefConfig.Enable && prefConfig.Content != "" {
		// 追加到最后一个用户消息
		for i := len(chatRequest.Messages) - 1; i >= 0; i-- {
			if chatRequest.Messages[i].Role == "user" {
				// 简单的追加，可以根据需要调整格式
				if contentStr, ok := chatRequest.Messages[i].Content.(string); ok {
					chatRequest.Messages[i].Content = contentStr + "\n\n" + prefConfig.Content
					logger.Infof(ctx, "已应用回答偏好设置")
				}
				break
			}
		}
	}

	hadRequestToolsBeforeGlobalInjection := len(chatRequest.Tools) > 0
	injectGlobalToolsToChatRequest(&chatRequest, ctx)

	if len(chatRequest.Tools) > 0 {
		if shouldUseRAGAnsweringInitialPhase(messageStatus, ragCompleted, hadRequestToolsBeforeGlobalInjection, chatRequest.Tools) {
			c.Set(agentInitialStreamPhaseContextKey, agentStreamPhaseAnswering)
			logger.Debugf(ctx, "【网络搜索】RAG 后仅注入全局工具，Agent Loop 初始流式阶段设为 answering")
		}
		// 解析执行渠道（修复：非技能工具路径也需要有效的执行渠道）
		executionChannel, executionModel, err := resolveExecutionChannel(ctx, agent)
		if err != nil {
			logger.Errorf(ctx, "【工具执行】解析执行渠道失败: %v", err)
			c.JSON(500, model.ParamError.ToNewErrorResponse(err.Error()))
			return
		}
		retryTimes := config.CHANNEL_RETRY_TIMES
		runAgentLoop(c, requestCtx, agent, &chatRequest, messageStatus, executionModel, relayMode, int(retryTimes), executionChannel)
	} else {
		// Standard Flow
		processChatRequestV2(c, &chatRequest, ctx, messageStatus)
	}
}

// executeSkill prepares and executes a skill
// ... existing code ...
func executeSkill(c *gin.Context, chatRequest *ChatRequest, requestCtx context.Context, ctx context.Context, messageStatus *MessageStatsInfo, matchedSkill *skill.Skill) {
	systemControlPrompt := buildSystemControlPrompt()

	var userFilesSection string
	if len(messageStatus.UploadedFiles) > 0 {
		var fileNames []string
		for _, f := range messageStatus.UploadedFiles {
			fileNames = append(fileNames, fmt.Sprintf("- %s", f.FileName))
		}
		userFilesSection = fmt.Sprintf("\n\n### 用户已上传的文件（在沙盒当前目录，可直接使用文件名）：\n%s", strings.Join(fileNames, "\n"))
	}

	instructionMsg := fmt.Sprintf("\n\n%s\n\n[Active Skill: %s]\n%s%s",
		systemControlPrompt,
		matchedSkill.Name,
		matchedSkill.Instruction,
		userFilesSection,
	)

	if len(chatRequest.Messages) > 0 && chatRequest.Messages[0].Role == "system" {
		if contentStr, ok := chatRequest.Messages[0].Content.(string); ok {
			chatRequest.Messages[0].Content = contentStr + instructionMsg
		}
	} else {
		skillMsg := relay_model.Message{
			Role:    "system",
			Content: instructionMsg,
		}
		chatRequest.Messages = append([]relay_model.Message{skillMsg}, chatRequest.Messages...)
	}

	injectedTools := buildToolSetForSkill(ctx, matchedSkill)
	chatRequest.Tools = mergeToolsByName(chatRequest.Tools, injectedTools)
	injectGlobalToolsToChatRequest(chatRequest, ctx)
	if len(chatRequest.Tools) > 0 {
		logger.Infof(ctx, "Injected %d tools (skill scoped) for skill %s", len(chatRequest.Tools), matchedSkill.Name)
	}

	agent := messageStatus.AgentModel

	// 解析执行渠道（使用统一的渠道解析函数）
	executionChannel, executionModel, err := resolveExecutionChannel(ctx, agent)
	if err != nil {
		logger.Errorf(ctx, "【技能运行】解析执行渠道失败: %v", err)
		c.JSON(500, model.ParamError.ToNewErrorResponse(err.Error()))
		return
	}

	retryTimes := config.CHANNEL_RETRY_TIMES
	runAgentLoop(c, requestCtx, messageStatus.AgentModel, chatRequest, messageStatus, executionModel, messageStatus.RelayMode, int(retryTimes), executionChannel)
}

func buildSystemControlPrompt() string {
	return "### SYSTEM EXECUTION PROTOCOL:\n\n" +
		"1. ROLE & GOAL:\n" +
		"   - You are executing the current Active Skill.\n" +
		"   - Complete the active skill instruction efficiently and prioritize producing a usable result.\n" +
		"   - Prefer tool-based execution over discussion.\n" +
		"   - Emit a routing marker only when another runtime action is required.\n" +
		"   - Valid routing markers are `<decision>CONTINUE</decision>`, `<decision>RAG_QUERY</decision>`, and `<decision>SKILL_SWITCH</decision>`.\n" +
		"   - Use native tool_calls when a tool is needed; do not emit a text marker for tool calls.\n" +
		"   - The runtime will interpret routing markers internally; do not treat them as user-visible content.\n" +
		"   - If the task is complete, do not emit a routing marker. Start the final user-visible answer directly.\n" +
		"   - The runtime treats normal assistant text without an action marker as DONE.\n" +
		"   - Never mention, explain, quote, or expose routing markers in the final answer.\n" +
		"   - Do not ask the user follow-up questions. Do not repeat the same tool call without a reason.\n\n" +
		"2. TOOLS & BOUNDARIES:\n" +
		"   - Use tool results as the source of truth. Do not invent or guess missing data.\n" +
		"   - If a tool result contains truncation markers such as `...(truncated)` or `...[context-pruned ...]...`, treat it as an intentional preview, not as file corruption. Do not infer that the file is malformed just because middle content is omitted.\n" +
		"   - Use run_shell for executing skill scripts or commands. Use read_file/prepare_input_file/write_file/list_files for file operations.\n" +
		"   - Any path referenced by the active skill is relative to the workspace root unless the skill explicitly says otherwise. Read skill docs/scripts exactly as written instead of prefixing them with `inputs/`.\n" +
		"   - Prefer prepare_input_file for helper scripts, configs, and other intermediate resources that should stay in inputs/.\n" +
		"   - Treat the sandbox as a workspace-backed runtime: read existing files first, write or edit files in place, then execute from the workspace.\n" +
		"   - Keep the execution cwd at the workspace root. Do not `cd inputs/` when running helper scripts; reference helpers as `inputs/...` and let them write final artifacts under `output/` from the workspace root.\n" +
		"   - Use conversation-level sandbox reuse: keep one sandbox/workspace for the current conversation and continue from the existing workspace state instead of rebuilding a fresh workspace on every turn.\n" +
		"   - Use code-interpreter only for real coding or calculation tasks, and only when it is available in the current tool list.\n" +
		"   - If code-interpreter is unavailable, do not replace it with huge inline code; write file(s) and execute them with run_shell.\n" +
		"   - Start from the current workspace. Use workspace-relative paths such as `output/report.docx`, `./inputs/main.py`, or `.`.\n" +
		"   - If a path is written with a leading slash but is clearly intended to stay inside the workspace, normalize it to a workspace-relative path instead of using OS root paths such as `/root`.\n" +
		"   - Write process files, helper scripts, and temporary intermediates under `inputs/` or `tmp/`.\n" +
		"   - Write only final user-deliverable files under `output/`.\n" +
		"   - Unchanged `output/` files are not re-emitted; only newly created or modified `output/` files should be treated as deliverables.\n" +
		"   - Do not expose raw execution commands, internal tool mechanics, or implementation details in the final answer.\n\n" +
		"3. WORKFLOW:\n" +
		"   - Read the Active Skill instruction first, including any scripts, resource paths, and documented command flow.\n" +
		"   - If the skill provides scripts or a documented command flow, use that as the default plan before inventing a new one.\n" +
		"   - Check the uploaded file list before execution and use those filenames directly when relevant.\n" +
		"   - Try the skill's main flow first instead of starting with environment reconnaissance.\n" +
		"   - Do not start with package inventory commands such as `which`, `command -v`, `npm list -g`, `npm view`,`npm install -g`, `pip install`, `apt install`, or `pip show` before the first direct attempt at the final task.\n" +
		"   - Only check availability after a direct attempt fails with a missing executable/module error, and keep that check narrowly scoped.\n" +
		"   - Prefer one direct attempt that targets the final artifact or output, not a preparatory environment test.\n" +
		"   - If the direct attempt fails because a dependency is missing, apply one targeted fix and retry the real task instead of looping through probes.\n" +
		"   - If the same syntax, path, or dependency failure repeats, switch strategy: validate the file, narrow the helper, or split the change before retrying again.\n" +
		"   - For long or structured content, prefer file-based transfer instead of sending the whole document or script in one tool argument.\n" +
		"   - If a tool returns an error, analyze the error, fix the parameters or path, and retry once without asking for permission.\n" +
		"   - Once valid output is obtained, stop calling tools instead of double-checking the same result.\n\n" +
		"4. OUTPUT:\n" +
		"   - Give a brief conclusion and the key result.\n" +
		"   - For large outputs, summarize the important points instead of dumping the full content.\n" +
		"   - When a file was produced, keep the response concise and point to the saved output path.\n" +
		"   - Do not invent extra save/download steps; generated output files are already captured by the runtime."
}

func buildAIUploadFilePathKey(file *model.UploadFile) string {
	if file == nil {
		return ""
	}
	name := strings.TrimSpace(file.FileName)
	name = strings.ReplaceAll(name, "\\", "/")
	if name == "" {
		return ""
	}
	cleaned := path.Clean(name)
	if cleaned == "." || cleaned == "/" {
		return ""
	}
	return cleaned
}

func mergeAIUploadFilesKeepLast(existing []*model.UploadFile, incoming ...*model.UploadFile) []*model.UploadFile {
	if len(existing) == 0 && len(incoming) == 0 {
		return nil
	}
	merged := make(map[string]*model.UploadFile, len(existing)+len(incoming))
	order := make([]string, 0, len(existing)+len(incoming))
	appendFile := func(file *model.UploadFile) {
		key := buildAIUploadFilePathKey(file)
		if key == "" {
			return
		}
		if _, exists := merged[key]; !exists {
			order = append(order, key)
		}
		merged[key] = file
	}
	for _, file := range existing {
		appendFile(file)
	}
	for _, file := range incoming {
		appendFile(file)
	}
	result := make([]*model.UploadFile, 0, len(order))
	for _, key := range order {
		if file := merged[key]; file != nil {
			result = append(result, file)
		}
	}
	return result
}

// resolveExecutionChannel 解析执行渠道
// 按优先级获取执行渠道：skill_run_config > FastReasoning > agent default
// 返回：channel, model, error
func resolveExecutionChannel(ctx context.Context, agent *model.Agent) (*model.Channel, string, error) {
	executionModel := agent.Model
	var executionChannel *model.Channel

	// 优先级 1：skill_run_config.ChannelID
	if agent.AgentUsage == model.AgentUsageWorkAI {
		if skillRunConfig, err := agent.GetSkillRunConfig(); err == nil && skillRunConfig != nil && skillRunConfig.Enable {
			executionModel = skillRunConfig.ModelName
			if skillRunConfig.ChannelID != 0 {
				if ch, err := model.GetChannelByID(skillRunConfig.ChannelID); err == nil {
					executionChannel = ch
					logger.Infof(ctx, "【渠道解析】使用 skill_run_config 渠道: channelID=%d, model=%s", skillRunConfig.ChannelID, executionModel)
				} else {
					logger.Warnf(ctx, "【渠道解析】skill_run_config 渠道未找到: channelID=%d, err=%v", skillRunConfig.ChannelID, err)
				}
			}
		}
	}

	// 优先级 2：FastReasoning.ChannelID
	if executionChannel == nil {
		if fastReasoningConfig, err := agent.GetFastReasoningConfig(); err == nil && fastReasoningConfig != nil {
			if fastReasoningConfig.ChannelID != nil && fastReasoningConfig.ModelName != nil {
				executionModel = *fastReasoningConfig.ModelName
				if ch, err := model.GetChannelByID(*fastReasoningConfig.ChannelID); err == nil {
					executionChannel = ch
					logger.Infof(ctx, "【渠道解析】使用 FastReasoning 渠道: channelID=%d, model=%s", *fastReasoningConfig.ChannelID, executionModel)
				} else {
					logger.Warnf(ctx, "【渠道解析】FastReasoning 渠道未找到: channelID=%d, err=%v", *fastReasoningConfig.ChannelID, err)
				}
			}
		}
	}

	// 优先级 3：使用 agent.ChannelType + Model 随机获取
	if executionChannel == nil {
		ch, err := model.GetRandomChannel(agent.Eid, agent.ChannelType, agent.Model)
		if err == nil {
			executionChannel = ch
			executionModel = agent.Model
			logger.Infof(ctx, "【渠道解析】使用 agent 默认渠道: channelID=%d, channelType=%d, model=%s", ch.ChannelID, agent.ChannelType, executionModel)
		} else {
			logger.Warnf(ctx, "【渠道解析】未找到可用渠道: channelType=%d, model=%s, err=%v", agent.ChannelType, agent.Model, err)
		}
	}

	if executionChannel == nil {
		return nil, "", fmt.Errorf("没有可用的执行渠道")
	}

	return executionChannel, executionModel, nil
}

// ... existing code ...

// rerankSources 对 SourceReference 列表进行重排序
func rerankSources(ctx context.Context, agent *model.Agent, query string, sources []rag.SourceReference) ([]rag.SourceReference, error) {
	rerankConfig, err := agent.GetRerankConfig()
	if err != nil || rerankConfig == nil || !rerankConfig.RerankingEnable {
		return sources, nil
	}

	graphSources, rerankableSources := splitGraphAggregateSources(sources)
	if len(rerankableSources) == 0 {
		return graphSources, nil
	}

	// 转换为 SearchResultItem
	ragItems := make([]rag.SearchResultItem, len(rerankableSources))
	for i, source := range rerankableSources {
		ragItems[i] = rag.SearchResultItem{
			ChunkID:   source.ChunkID,
			FileID:    source.FileID,
			LibraryID: source.KnowledgeBaseID,
			Content:   source.Content,
			Score:     source.Score,
		}
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
		return append(graphSources, rerankableSources...), err
	}

	// 映射回 SourceReference
	// 注意：这里假设 ChunkID 是唯一的。如果是 Web 搜索结果，可能需要更健壮的映射方式
	sourceMap := make(map[int64]rag.SourceReference)
	for _, s := range rerankableSources {
		sourceMap[s.ChunkID] = s
	}

	var newSources []rag.SourceReference
	for _, item := range rerankedItems {
		if original, ok := sourceMap[item.ChunkID]; ok {
			original.Score = item.Score
			newSources = append(newSources, original)
		}
	}

	return append(graphSources, newSources...), nil
}

func splitGraphAggregateSources(sources []rag.SourceReference) ([]rag.SourceReference, []rag.SourceReference) {
	if len(sources) == 0 {
		return []rag.SourceReference{}, []rag.SourceReference{}
	}

	graphSources := make([]rag.SourceReference, 0, 1)
	rerankableSources := make([]rag.SourceReference, 0, len(sources))
	for _, source := range sources {
		if shouldPreserveSourceContent(source) {
			graphSources = append(graphSources, source)
			continue
		}
		rerankableSources = append(rerankableSources, source)
	}

	return graphSources, rerankableSources
}

func processChatRequestV2(c *gin.Context, chatRequest *ChatRequest, ctx context.Context, messageStatus *MessageStatsInfo) {
	retryTimes := config.CHANNEL_RETRY_TIMES
	agent := messageStatus.AgentModel
	relayMode := messageStatus.RelayMode

	// 优先使用请求中指定的模型（前端用户选择的深度思考/快速回答），
	// 如果请求中没有指定，则回退到智能体默认模型
	requestModel := chatRequest.Model
	if requestModel == "" {
		requestModel = agent.Model
		chatRequest.Model = requestModel
	}

	// if 1o model, unset temperature, presence_penalty, frequency_penalty, top_p
	if agent.ChannelType == channeltype.OpenAI && strings.Contains(strings.ToLower(chatRequest.Model), "o1") {
		chatRequest.Temperature = 0
		chatRequest.PresencePenalty = 0
		chatRequest.FrequencyPenalty = 0
		chatRequest.TopP = 0
	}

	modifiedBody, err := json.Marshal(chatRequest)
	if err != nil {
		errResp := model.ParamError.ToOpenAIErrorRespone(nil)
		if chatRequest.Stream {
			writeStreamOpenAIError(c, 500, errResp)
		} else {
			c.JSON(500, errResp)
		}
		return
	}
	c.Request.Body = io.NopCloser(bytes.NewBuffer(modifiedBody))
	logger.Debugf(ctx, "修改后的请求体: %s", string(modifiedBody))

	// bizErr := relayHelper(c, relayMode)
	// if bizErr == nil {
	// 	return
	// }

	var lastFailedChannelId int64
	for i := retryTimes; i > 0; i-- {
		// 使用新的服务函数获取渠道并检查/刷新token
		channel, err := service.GetChannelWithTokenRefresh(ctx, agent.Eid, agent.ChannelType, requestModel, lastFailedChannelId)
		if err != nil {
			logger.Errorf(ctx, "获取渠道失败: %s", err.Error())
			continue
		}

		middleware.SetupContextForSelectedChannel(c, channel, requestModel)
		logger.SysLogf("ChannelID: %d", channel.ChannelID)
		channelId := c.GetInt64(ctxkey.ChannelId)
		lastFailedChannelId = channelId
		requestBody, err := common.GetRequestBody(c)
		c.Request.Body = io.NopCloser(bytes.NewBuffer(requestBody))
		bizErr := relayHelper(c, relayMode, messageStatus)
		if bizErr == nil {
			return
		}
		channelName := c.GetString(ctxkey.ChannelName)
		go processChannelRelayError(ctx, int(config.GetUserId(c)), int(channelId), channelName, *bizErr)
		// return error message
		errResp := openAIErrorResponseFromRelayError(bizErr)
		if chatRequest.Stream {
			writeStreamOpenAIError(c, 500, errResp)
		} else {
			c.JSON(500, errResp)
		}
		return
	}
	errResp := model.OpenAIErrorResponse{
		Error: model.OpenAIError{
			Message: "All channels are unavailable",
			Type:    "53aihub_error",
		},
	}
	if chatRequest.Stream {
		writeStreamOpenAIError(c, 500, errResp)
	} else {
		c.JSON(500, errResp)
	}
}

func relayHelper(c *gin.Context, relayMode int, messageStatus *MessageStatsInfo) *relay_model.ErrorWithStatusCode {
	var err *relay_model.ErrorWithStatusCode
	switch relayMode {
	case relaymode.ImagesGenerations:
		err = controller.RelayImageHelper(c, relayMode)
	// case relaymode.AudioSpeech:
	// 	fallthrough
	// case relaymode.AudioTranslation:
	// 	fallthrough
	// case relaymode.AudioTranscription:
	// 	err = controller.RelayAudioHelper(c, relayMode)
	// case relaymode.Proxy:
	// 	err = controller.RelayProxyHelper(c, relayMode)
	default:
		err = RelayTextHelper(c, messageStatus)
	}
	return err
}

func processChannelRelayError(ctx context.Context, userId int, channelId int, channelName string, err relay_model.ErrorWithStatusCode) {
	logger.Errorf(ctx, "relay error (channel id %d, user id: %d): %+v", channelId, userId, err.Error)
	if monitor.ShouldDisableChannel(&err.Error, err.StatusCode) {
		monitor.DisableChannel(channelId, channelName, err.Message)
	} else {
		monitor.Emit(channelId, false)
	}
}

func getAndValidateTextRequest(c *gin.Context, relayMode int) (*relay_model.GeneralOpenAIRequest, error) {
	textRequest := &relay_model.GeneralOpenAIRequest{}
	err := common.UnmarshalBodyReusable(c, textRequest)
	if err != nil {
		return nil, err
	}
	if relayMode == relaymode.Moderations && textRequest.Model == "" {
		textRequest.Model = "text-moderation-latest"
	}
	if relayMode == relaymode.Embeddings && textRequest.Model == "" {
		textRequest.Model = c.Param("model")
	}
	err = validator.ValidateTextRequest(textRequest, relayMode)
	if err != nil {
		return nil, err
	}
	return textRequest, nil
}

func getMappedModelName(modelName string, mapping map[string]string) (string, bool) {
	if mapping == nil {
		return modelName, false
	}
	mappedModelName := mapping[modelName]
	if mappedModelName != "" {
		return mappedModelName, true
	}
	return modelName, false
}

func setSystemPrompt(ctx context.Context, request *relay_model.GeneralOpenAIRequest, prompt string) (reset bool) {
	if prompt == "" {
		return false
	}
	if len(request.Messages) == 0 {
		return false
	}
	if request.Messages[0].Role == role.System {
		request.Messages[0].Content = prompt
		logger.Infof(ctx, "rewrite system prompt")
		return true
	}
	request.Messages = append([]relay_model.Message{{
		Role:    role.System,
		Content: prompt,
	}}, request.Messages...)
	logger.Infof(ctx, "add system prompt")
	return true
}

// prepareMessagesForStorage 用于持久化前裁剪消息：
// 1) 仅保留最后一条 user 消息，避免历史对话写入 message.message / last_message.question
// 2) 若不存在 user 消息，返回空数组
func prepareMessagesForStorage(messages []relay_model.Message) []relay_model.Message {
	if len(messages) == 0 {
		return messages
	}
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role == "user" {
			return []relay_model.Message{messages[i]}
		}
	}
	logger.Warnf(context.Background(), "【消息存储】未找到 user 消息，按空数组落库: total_messages=%d", len(messages))
	return []relay_model.Message{}
}

// CreateInitialMessage 在请求发起前创建占位消息，返回 messageID
func CreateInitialMessage(c *gin.Context, agent *model.Agent, user_id int64, conversationId int64, textRequest *relay_model.GeneralOpenAIRequest, meta *meta.Meta, requestId string, messageStatus *MessageStatsInfo) (int64, error) {
	ctx := c.Request.Context()
	messageJSON, err := json.Marshal(prepareMessagesForStorage(textRequest.Messages))
	if err != nil {
		logger.Errorf(ctx, "marshal messages failed: %s", err.Error())
		messageJSON = []byte("[]")
	}

	msg := &model.Message{
		Eid:              agent.Eid,
		UserID:           user_id,
		ConversationID:   conversationId,
		AgentID:          agent.AgentID,
		Message:          string(messageJSON),
		Answer:           "",
		ReasoningContent: "",
		ModelName:        textRequest.Model,
		Quota:            0,
		PromptTokens:     0,
		CompletionTokens: 0,
		TotalTokens:      0,
		ChannelId:        int(meta.ChannelId),
		RequestId:        requestId,
		ElapsedTime:      0,
		IsStream:         meta.IsStream,
		QuotaContent:     "",
		AgentCustomConfig: func() string {
			// 保存历史配置便于追溯
			return agent.CustomConfig
		}(),
		OriginalQuestion:  messageStatus.OriginalQuestion,
		RewrittenQuestion: messageStatus.RewrittenQuestion,
		RequestSource:     messageStatus.RequestSource,
		FileID: func() int64 {
			// 优先级：message_file_id > SaveFileID
			if messageStatus.MessageFileID > 0 {
				return messageStatus.MessageFileID
			}
			return messageStatus.SaveFileID
		}(), // 设置文件ID（优先使用message_file_id）
	}
	applyVisitorIdentityToMessage(c, msg)
	if err := model.CreateMessage(msg); err != nil {
		return 0, err
	}

	// 立即同步 MessageID 到 AgentRun
	if msg.ID > 0 && requestId != "" {
		runSvc := service.NewAgentRunService()
		if _, _, err := runSvc.EnsureRunForRequest(ctx, agent.Eid, conversationId, msg.ID, requestId); err != nil {
			logger.Warnf(ctx, "sync message_id to agent_run failed: eid=%d, conversation_id=%d, message_id=%d, request_id=%s, err=%v",
				agent.Eid, conversationId, msg.ID, requestId, err)
		}
	}

	return msg.ID, nil
}

func syncAgentRunForMessage(ctx context.Context, agent *model.Agent, conversationID int64, messageID int64, requestID string, currentStep string) {
	if agent == nil || conversationID <= 0 || messageID <= 0 || strings.TrimSpace(requestID) == "" {
		return
	}

	runSvc := service.NewAgentRunService()
	run, created, err := runSvc.EnsureRunForRequest(ctx, agent.Eid, conversationID, messageID, requestID)
	if err != nil {
		logger.Warnf(ctx, "sync agent run failed: eid=%d, conversation_id=%d, message_id=%d, request_id=%s, err=%v",
			agent.Eid, conversationID, messageID, requestID, err)
		return
	}

	if created {
		if _, err := runSvc.AppendEvent(ctx, agent.Eid, run.RunID, run.RequestID, model.AgentRunEventRunCreated, messageID, map[string]interface{}{
			"conversation_id": conversationID,
			"message_id":      messageID,
			"request_id":      requestID,
		}); err != nil {
			logger.Warnf(ctx, "append agent run created event failed in sync: eid=%d, run_id=%s, err=%v", agent.Eid, run.RunID, err)
		}
	}

	if run.Status != model.AgentRunStatusQueued {
		return
	}

	if err := runSvc.UpdateRunStatus(ctx, agent.Eid, run.RunID, model.AgentRunStatusRunning, "", ""); err != nil {
		logger.Warnf(ctx, "mark agent run running failed: eid=%d, run_id=%s, err=%v", agent.Eid, run.RunID, err)
		return
	}
	if _, err := runSvc.AppendEvent(ctx, agent.Eid, run.RunID, run.RequestID, model.AgentRunEventStatusChanged, messageID, map[string]interface{}{
		"status":       model.AgentRunStatusRunning,
		"current_step": currentStep,
	}); err != nil {
		logger.Warnf(ctx, "append agent run running event failed: eid=%d, run_id=%s, err=%v", agent.Eid, run.RunID, err)
	}
}

func finalizeAgentRunForMessage(ctx context.Context, agent *model.Agent, conversationID int64, messageID int64, requestID string, status string, errorCode string, errorMessage string) {
	if agent == nil || conversationID <= 0 || messageID <= 0 || strings.TrimSpace(requestID) == "" {
		return
	}

	runSvc := service.NewAgentRunService()
	run, created, err := runSvc.EnsureRunForRequest(ctx, agent.Eid, conversationID, messageID, requestID)
	if err != nil {
		logger.Warnf(ctx, "finalize agent run failed: eid=%d, conversation_id=%d, message_id=%d, request_id=%s, err=%v",
			agent.Eid, conversationID, messageID, requestID, err)
		return
	}

	if created {
		if _, err := runSvc.AppendEvent(ctx, agent.Eid, run.RunID, run.RequestID, model.AgentRunEventRunCreated, messageID, map[string]interface{}{
			"conversation_id": conversationID,
			"message_id":      messageID,
			"request_id":      requestID,
		}); err != nil {
			logger.Warnf(ctx, "append agent run created event failed during finalize: eid=%d, run_id=%s, err=%v", agent.Eid, run.RunID, err)
		}
	}

	switch status {
	case model.AgentRunStatusCompleted:
		if _, err := runSvc.FinalizeCompletedRun(ctx, agent.Eid, run.RunID, errorCode, errorMessage); err != nil {
			logger.Warnf(ctx, "finalize agent run completed failed: eid=%d, run_id=%s, err=%v", agent.Eid, run.RunID, err)
		}
	case model.AgentRunStatusFailed:
		if _, err := runSvc.FinalizeFailedRun(ctx, agent.Eid, run.RunID, errorCode, errorMessage); err != nil {
			logger.Warnf(ctx, "finalize agent run failed failed: eid=%d, run_id=%s, err=%v", agent.Eid, run.RunID, err)
		}
	case model.AgentRunStatusCancelled:
		if _, err := runSvc.FinalizeCancelledRun(ctx, agent.Eid, run.RunID, errorCode, errorMessage); err != nil {
			logger.Warnf(ctx, "finalize agent run cancelled failed: eid=%d, run_id=%s, err=%v", agent.Eid, run.RunID, err)
		}
	}
}

// sendSaveMessageEvent 按OpenAI兼容格式发送首帧，包含 save_message.id 的 HashID
func sendSaveMessageEvent(c *gin.Context, requestId, modelName string, messageID int64) error {
	// 检查响应头是否已设置，避免重复设置
	if c.Writer.Header().Get("Content-Type") == "" {
		// 设置必要头部（幂等）
		h := c.Writer.Header()
		h.Set("Content-Type", "text/event-stream; charset=utf-8")
		h.Set("Cache-Control", "no-cache")
		h.Set("Connection", "keep-alive")
		h.Set("X-Accel-Buffering", "no")
	}

	messageIDHash, err := hashids.Encode(messageID)
	if err != nil {
		return fmt.Errorf("encode stream message id failed: %w", err)
	}
	payload := map[string]interface{}{
		"id":         requestId,
		"object":     "chat.completion.chunk",
		"created":    time.Now().Unix(),
		"model":      modelName,
		"message_id": messageIDHash,
		"choices":    []interface{}{},
	}
	b, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	chunk := append([]byte("data: "), b...)
	chunk = append(chunk, []byte("\n\n")...)

	if _, err := c.Writer.Write(chunk); err != nil {
		return err
	}
	if flusher, ok := c.Writer.(http.Flusher); ok {
		flusher.Flush()
	}
	return nil
}

func getPromptTokens(textRequest *relay_model.GeneralOpenAIRequest, relayMode int) int {
	switch relayMode {
	case relaymode.ChatCompletions:
		return Hub_openai.CountTokenMessages(textRequest.Messages, textRequest.Model)
	case relaymode.Completions:
		return Hub_openai.CountTokenInput(textRequest.Prompt, textRequest.Model)
	case relaymode.Moderations:
		return Hub_openai.CountTokenInput(textRequest.Input, textRequest.Model)
	}
	return 0
}

func getRequestBody(c *gin.Context, meta *meta.Meta, textRequest *relay_model.GeneralOpenAIRequest, adaptor adaptor.Adaptor) (io.Reader, error) {
	if !config.EnforceIncludeUsage &&
		meta.APIType != apitype.OpenAI &&
		meta.OriginModelName == meta.ActualModelName &&
		meta.ChannelType != channeltype.Baichuan &&
		meta.SystemPrompt == "" {
		bodyBytes, err := io.ReadAll(c.Request.Body)
		if err != nil {
			return nil, err
		}

		var requestData map[string]interface{}
		if err := json.Unmarshal(bodyBytes, &requestData); err != nil {
			return nil, err
		}

		delete(requestData, "conversation_id")
		modifiedBody, err := json.Marshal(requestData)
		if err != nil {
			return nil, err
		}

		c.Request.Body = io.NopCloser(bytes.NewBuffer(modifiedBody))
		// return c.Request.Body, nil
	}

	// get request body
	var requestBody io.Reader
	convertedRequest, err := adaptor.ConvertRequest(c, meta.Mode, textRequest)
	if err != nil {
		logger.Debugf(c.Request.Context(), "converted request failed: %s\n", err.Error())
		return nil, err
	}

	convertedRequest, err = applyRelayRequestPassthrough(c, convertedRequest)
	if err != nil {
		logger.Debugf(c.Request.Context(), "apply relay passthrough failed: %s\n", err.Error())
		return nil, err
	}

	if convertedRequestMap, ok := convertedRequest.(map[string]interface{}); ok {
		delete(convertedRequestMap, "conversation_id")
	}

	jsonData, err := json.Marshal(convertedRequest)
	if err != nil {
		logger.Debugf(c.Request.Context(), "converted request json_marshal_failed: %s\n", err.Error())
		return nil, err
	}
	logger.SysDebug(string(jsonData))
	requestBody = bytes.NewBuffer(jsonData)
	return requestBody, nil
}

func getReaderSize(reader io.Reader) int {
	switch v := reader.(type) {
	case interface{ Len() int }:
		return v.Len()
	case *bytes.Buffer:
		return v.Len()
	case *bytes.Reader:
		return v.Len()
	case *strings.Reader:
		return v.Len()
	default:
		return -1
	}
}

func ensureRelayHTTPTimeout(ctx context.Context) time.Duration {
	const fallbackTimeout = 120 * time.Second
	if oneapi_client.HTTPClient == nil {
		return 0
	}
	if oneapi_client.HTTPClient.Timeout == 0 {
		oneapi_client.HTTPClient.Timeout = fallbackTimeout
		logger.Warnf(ctx, "【技能运行】检测到Relay HTTP客户端未设置超时，已应用兜底超时: timeout=%s", fallbackTimeout)
	}
	return oneapi_client.HTTPClient.Timeout
}

func RelayTextHelper(c *gin.Context, messageStatus *MessageStatsInfo) *relay_model.ErrorWithStatusCode {
	ctx := c.Request.Context()
	user_id := config.GetUserId(c)
	meta := GetByContext(c)
	channelId := c.GetInt64(ctxkey.ChannelId)
	meta.ChannelId = int(channelId)
	meta.APIType = model.GetApiType(meta.ChannelType)
	startTime := time.Now()

	// 先读取原始请求体以获取 enable_process_steps 参数
	var originalChatRequest ChatRequest
	bodyBytes, _ := io.ReadAll(c.Request.Body)
	c.Request.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))
	json.Unmarshal(bodyBytes, &originalChatRequest)

	// 设置 EnableProcessSteps 默认值为 true
	if !originalChatRequest.EnableProcessSteps {
		originalChatRequest.EnableProcessSteps = true
	}

	// 恢复请求体供 getAndValidateTextRequest 使用
	c.Request.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))

	textRequest, err := getAndValidateTextRequest(c, meta.Mode)
	if err != nil {
		logger.Errorf(ctx, "getAndValidateTextRequest failed: %s", err.Error())
		return openai.ErrorWrapper(err, "invalid_text_request", http.StatusBadRequest)
	}

	// Inject global tools for skill path
	if messageStatus.RouterResult != nil && messageStatus.RouterResult.Skill != nil {
		injectedTools := buildToolSetForSkill(ctx, messageStatus.RouterResult.Skill)
		textRequest.Tools = mergeToolsByName(textRequest.Tools, injectedTools)
		injectGlobalToolsToGeneralRequest(textRequest, ctx)
		if len(textRequest.Tools) > 0 {
			logger.Infof(ctx, "Injected %d tools (skill scoped) for skill %s", len(textRequest.Tools), messageStatus.RouterResult.Skill.Name)
		}
	}

	meta.IsStream = textRequest.Stream

	if meta.IsStream {
		SetupStreamInterceptor(c)
		if config.IsSSECompactMode() {
			c.Set("defer_stream_done", true)
			defer flushDeferredStreamDone(c)
		}
	}

	// 获取请求ID
	requestId := helper.GetRequestID(ctx)
	if requestId == "" {
		requestId = fmt.Sprintf("req-%d", time.Now().UnixNano())
	}

	emitAnswerGenerationStep := shouldEmitAnswerGenerationStep(c)
	if emitAnswerGenerationStep {
		messageStatus.StepSender.SendStartStep(STEP_ANSWER_GENERATION, "正在生成回答...", nil)
	}

	// map model name

	// map model name
	meta.OriginModelName = textRequest.Model
	textRequest.Model, _ = getMappedModelName(textRequest.Model, meta.ModelMapping)
	meta.ActualModelName = textRequest.Model
	modelRatio := billing_ratio.GetModelRatio(textRequest.Model, meta.ChannelType)
	groupRatio := 1.0
	ratio := modelRatio * groupRatio

	agent, err := GetSessionAgent(c)
	if err != nil {
		logger.Errorf(ctx, "getSessionAgent failed: %s", err.Error())
		return openai.ErrorWrapper(err, "invalid_text_request", http.StatusBadRequest)
	}

	systemPromptReset := false
	if agent.Prompt != "" {
		systemPromptReset = addAgentPrompt(ctx, textRequest, agent.Prompt, agent.ChannelType)
		modifiedBody, err := json.Marshal(textRequest)
		if err != nil {
			return openai.ErrorWrapper(err, "marshal_request_failed", http.StatusInternalServerError)
		}
		c.Request.Body = io.NopCloser(bytes.NewBuffer(modifiedBody))
	}

	promptTokens := getPromptTokens(textRequest, meta.Mode)
	meta.PromptTokens = promptTokens
	preConsumedQuota, bizErr := preConsumeQuota(ctx, textRequest, promptTokens, ratio, meta)
	if bizErr != nil {
		logger.Warnf(ctx, "preConsumeQuota failed: %+v", *bizErr)
		return bizErr
	}

	conversation, err := GetSessionConversation(c)
	if err != nil {
		logger.Errorf(ctx, "getSessionConversation failed: %s", err.Error())
		return openai.ErrorWrapper(err, "invalid_text_request", http.StatusBadRequest)
	}

	adaptor := service.GetAdaptor(meta.APIType)
	if adaptor == nil {
		return openai.ErrorWrapper(fmt.Errorf("invalid api type: %d", meta.APIType), "invalid_api_type", http.StatusBadRequest)
	}
	adaptor.Init(meta)

	// 从上下文中获取渠道配置，以便适配器可以访问context_length、function_calling等配置
	channelInterface, exists := c.Get(ctxkey.SelectedChannel)
	if exists {
		if channel, ok := channelInterface.(*model.Channel); ok {
			// 如果是OpenAI适配器，将渠道配置注入到适配器中
			if adapt, ok := adaptor.(*Hub_openai.Adaptor); ok {
				adapt.ChannelConfig = channel.Config
			}
		}
	}

	customConfig := &custom.CustomConfig{
		UserId:                     "angethub_u" + fmt.Sprintf("%d", user_id),
		ConversationId:             conversation.ChannelConversationID,
		ConversationExpirationTime: conversation.ChannelConversationExpirationTime,
		AIHubConversationId:        conversation.ConversationID,
	}

	err = service.SetCustomConfig(&adaptor, customConfig)
	if err != nil {
		return openai.ErrorWrapper(err, "convert_request_failed", http.StatusInternalServerError)
	}

	// 创建消息记录
	var messageID int64
	var errCreate error

	// 检查是否已经在Agent Loop中创建了主消息ID
	if agentMasterMsgID, exists := c.Get("agent_master_message_id"); exists {
		if id, ok := agentMasterMsgID.(int64); ok && id > 0 {
			messageID = id
			logger.Debugf(ctx, "Using existing agent master message ID: %d", messageID)
		}
	}

	if messageID == 0 {
		messageID, errCreate = CreateInitialMessage(c, agent, user_id, conversation.ConversationID, textRequest, meta, requestId, messageStatus)
		textRequest.Messages = filterInfoMessages(textRequest.Messages)
		if errCreate != nil {
			logger.Errorf(ctx, "createInitialMessage failed: %s", errCreate.Error())
			return openai.ErrorWrapper(errCreate, "create_message_failed", http.StatusInternalServerError)
		}
	} else {
		// 如果使用了已有的消息ID，我们需要过滤掉info消息，以免影响后续处理
		textRequest.Messages = filterInfoMessages(textRequest.Messages)
	}
	syncAgentRunForMessage(ctx, agent, conversation.ConversationID, messageID, requestId, "answer_generation")
	if messageStatus != nil && messageID > 0 {
		bindMessageIDAndFlushProcessSteps(ctx, agent.Eid, messageStatus, messageID)
	}

	// 获取请求体
	requestBody, err := getRequestBody(c, meta, textRequest, adaptor)
	if err != nil {
		if emitAnswerGenerationStep {
			messageStatus.StepSender.SendEndStep(STEP_ANSWER_GENERATION, "生成失败", map[string]interface{}{
				"error": err.Error(),
			})
		}
		return openai.ErrorWrapper(err, "convert_request_failed", http.StatusInternalServerError)
	}
	requestBodySize := getReaderSize(requestBody)
	httpTimeout := ensureRelayHTTPTimeout(ctx)
	turnValue, _ := c.Get("agent_loop_turn")
	turnCount, _ := turnValue.(int)
	skillValue, _ := c.Get("agent_loop_skill_name")
	skillName, _ := skillValue.(string)

	// 执行请求
	logger.Debugf(ctx, "【技能运行】开始LLM请求: turn=%d, skill=%s, model=%s, stream=%v, api_type=%d, channel_type=%d, request_bytes=%d, http_timeout=%s",
		turnCount, skillName, meta.ActualModelName, meta.IsStream, meta.APIType, meta.ChannelType, requestBodySize, httpTimeout)
	doRequestStart := time.Now()
	resp, err := adaptor.DoRequest(c, meta, requestBody)
	if err != nil {
		logger.Warnf(ctx, "【技能运行】LLM请求失败: turn=%d, skill=%s, model=%s, stream=%v, duration_ms=%d, err=%v",
			turnCount, skillName, meta.ActualModelName, meta.IsStream, time.Since(doRequestStart).Milliseconds(), err)
		logger.Errorf(ctx, "DoRequest failed: %s", err.Error())
		return openai.ErrorWrapper(err, "do_request_failed", http.StatusInternalServerError)
	}
	logger.Debugf(ctx, "【技能运行】完成LLM请求: turn=%d, skill=%s, model=%s, stream=%v, duration_ms=%d",
		turnCount, skillName, meta.ActualModelName, meta.IsStream, time.Since(doRequestStart).Milliseconds())
	if resp != nil {
		logger.Debugf(ctx, "【技能运行】LLM响应头: turn=%d, skill=%s, model=%s, stream=%v, status=%d, content_type=%s, transfer_encoding=%v, connection=%s",
			turnCount, skillName, meta.ActualModelName, meta.IsStream, resp.StatusCode, resp.Header.Get("Content-Type"), resp.TransferEncoding, resp.Header.Get("Connection"))
	} else {
		logger.Warnf(ctx, "【技能运行】LLM空响应: turn=%d, skill=%s, model=%s, stream=%v", turnCount, skillName, meta.ActualModelName, meta.IsStream)
	}

	// [FIX] 预读取响应体
	// 如果是非流式，DoResponse 会读取 resp.Body，导致后续 GetResponseContent 无法读取
	// 所以先读取并保存，每次使用前重置
	var responseBody []byte
	if !meta.IsStream && resp != nil && resp.Body != nil {
		responseBody, _ = io.ReadAll(resp.Body)
		resp.Body = io.NopCloser(bytes.NewBuffer(responseBody))
	}

	// 检查错误
	if isErrorHappened(meta, resp) {
		logger.SysErrorf("检测到错误响应 - StatusCode: %d, ContentType: %s, IsStream: %v, ChannelType: %d, ModelName: %s",
			resp.StatusCode, resp.Header.Get("Content-Type"), meta.IsStream, meta.ChannelType, meta.ActualModelName)

		// 确保错误处理时Body可用 (其实上面的预读取已经保证了，这里保持原逻辑也没问题，但为了稳健)
		if len(responseBody) > 0 {
			resp.Body = io.NopCloser(bytes.NewBuffer(responseBody))
		}

		errBodyBytes, _ := io.ReadAll(resp.Body)
		resp.Body = io.NopCloser(bytes.NewBuffer(errBodyBytes))
		logger.Errorf(ctx, "【技能运行】LLM错误响应体: turn=%d, skill=%s, model=%s, status=%d, body=%s",
			turnCount, skillName, meta.ActualModelName, resp.StatusCode, string(errBodyBytes))
		failUpdateMessage(c, agent, messageID, startTime, meta, textRequest.Model, requestId, string(errBodyBytes))
		return controller.RelayErrorHandler(resp)
	}

	// 发送首帧
	if meta.IsStream {
		if err := sendMessageIDFirstFrame(c, requestId, textRequest.Model, messageID); err != nil {
			logger.Warnf(ctx, "sendMessageIDFirstFrame failed: %s", err.Error())
		}
	}

	// 执行响应处理
	doResponseStart := time.Now()
	logger.Debugf(ctx, "【技能运行】开始处理LLM响应体: turn=%d, skill=%s, model=%s, stream=%v, status=%d",
		turnCount, skillName, meta.ActualModelName, meta.IsStream, resp.StatusCode)
	usage, respErr := adaptor.DoResponse(c, resp, meta)
	logger.Debugf(ctx, "【技能运行】完成处理LLM响应体: turn=%d, skill=%s, model=%s, stream=%v, duration_ms=%d",
		turnCount, skillName, meta.ActualModelName, meta.IsStream, time.Since(doResponseStart).Milliseconds())
	logger.SysLogf("usage: %+v", usage)
	if respErr != nil {
		logger.Errorf(ctx, "respErr is not nil: %+v", respErr)
		return respErr
	}

	// [FIX] 重置 Body 供 GetResponseContent 使用
	if !meta.IsStream && resp != nil && len(responseBody) > 0 {
		resp.Body = io.NopCloser(bytes.NewBuffer(responseBody))
	}

	// 统计相关
	go func() {
		if err := model.IncrementField(agent.Eid, agent.AgentID, "total_questions", 1); err != nil {
			logger.Errorf(ctx, "增加AI回答总数统计失败: %s", err.Error())
		}
	}()

	loader := km_common.GetModelCatalogLoader()
	if loader != nil {
		isDeepThinking, err := loader.IsDeepThinkingModel(textRequest.Model)
		if err != nil {
			logger.Warnf(ctx, "检查模型是否为深度思考模型失败: %s", err.Error())
		}

		if isDeepThinking {
			messageStatus.ThinkingMode = model.ThinkingModeDeep
			if err := model.IncrementField(agent.Eid, agent.AgentID, "deep_thinking", 1); err != nil {
				logger.Errorf(ctx, "增加深度思考模型统计失败: %s", err.Error())
			}
		} else {
			if err := model.IncrementField(agent.Eid, agent.AgentID, "quick_answers", 1); err != nil {
				logger.Errorf(ctx, "增加快速回答统计失败: %s", err.Error())
			}
		}
	}

	responseContent, reasoningContent := GetResponseContent(c, meta.IsStream, resp)
	logger.SysDebug(responseContent)

	if emitAnswerGenerationStep {
		messageStatus.StepSender.SendEndStep(STEP_ANSWER_GENERATION, "回答生成完成", nil)
	}

	// ⭐ 统一处理引用分析步骤（使用 StepSender）
	if originalChatRequest.EnableProcessSteps && textRequest.Stream {
		sendReferenceAnalysisStep(c, ctx, messageStatus, responseContent)
	}

	customConfig = service.GetCustomConfig(&adaptor)

	// 后置配额处理
	go postConsumeQuota(c, agent, user_id, startTime, ctx, usage, meta,
		textRequest, ratio, preConsumedQuota, modelRatio, groupRatio,
		systemPromptReset, responseContent, reasoningContent, customConfig, messageID, messageStatus)

	if !c.GetBool("agent_internal_stream_turn") {
		requestID := ""
		if messageStatus != nil {
			requestID = messageStatus.RequestId
		}
		if requestID == "" {
			requestID = helper.GetRequestID(ctx)
		}
		if conversation, convErr := GetSessionConversation(c); convErr == nil && conversation != nil {
			if agentForFinal, agentErr := GetSessionAgent(c); agentErr == nil && agentForFinal != nil {
				finalizeAgentRunForMessage(ctx, agentForFinal, conversation.ConversationID, messageID, requestID, model.AgentRunStatusCompleted, "", "")
			}
		}
	}

	return nil
}

func shouldEmitAnswerGenerationStep(c *gin.Context) bool {
	return !isInternalAgentStreamTurn(c)
}

func isErrorHappened(meta *meta.Meta, resp *http.Response) bool {
	if resp == nil {
		if meta.ChannelType == channeltype.AwsClaude {
			return false
		}
		return true
	}
	if resp.StatusCode != http.StatusOK &&
		// replicate return 201 to create a task
		resp.StatusCode != http.StatusCreated {
		return true
	}
	if meta.ChannelType == channeltype.DeepL {
		// skip stream check for deepl
		return false
	}

	// Coze 工作流特殊处理：工作流不支持流式响应，总是返回 JSON
	if meta.ChannelType == channeltype.Coze && strings.HasPrefix(meta.ActualModelName, "workflow-") {
		// 对于 Coze 工作流，即使设置了 stream=true，也会返回 JSON 格式，这是正常的
		return false
	}

	if meta.IsStream && strings.HasPrefix(resp.Header.Get("Content-Type"), "application/json") &&
		// Even if stream mode is enabled, replicate will first return a task info in JSON format,
		// requiring the client to request the stream endpoint in the task info
		meta.ChannelType != channeltype.Replicate {
		return true
	}
	return false
}

func addAgentPrompt(ctx context.Context, textRequest *relay_model.GeneralOpenAIRequest, agentPrompt string, channelType int) bool {
	if agentPrompt == "" {
		return false
	}

	if channelType == channeltype.OpenAI && strings.Contains(strings.ToLower(textRequest.Model), "o1") {
		textRequest.Messages = append([]relay_model.Message{{
			Role:    "user",
			Content: agentPrompt,
		}}, textRequest.Messages...)
		logger.Infof(ctx, "add agent prompt for o1 model")
		return true
	}

	if len(textRequest.Messages) > 0 && textRequest.Messages[0].Role == role.System {
		textRequest.Messages[0].Content = fmt.Sprintf("%s\n%s", agentPrompt, textRequest.Messages[0].Content)
		logger.Infof(ctx, "append agent system prompt")
	} else {
		textRequest.Messages = append([]relay_model.Message{{
			Role:    role.System,
			Content: agentPrompt,
		}}, textRequest.Messages...)
		logger.Infof(ctx, "add agent system prompt")
	}
	return true
}

func postConsumeQuota(c *gin.Context, agent *model.Agent, user_id int64, startTime time.Time,
	ctx context.Context, usage *relay_model.Usage, meta *meta.Meta, textRequest *relay_model.GeneralOpenAIRequest,
	ratio float64, preConsumedQuota int64, modelRatio float64,
	groupRatio float64, systemPromptReset bool, responseContent string,
	reasoningContent string, customConfig *custom.CustomConfig, messageID int64, messageStatus *MessageStatsInfo) {

	if usage == nil {
		logger.Error(ctx, "usage is nil, which is unexpected")
		return
	}

	// ... 计算 quota、tokens 等逻辑保持不变 ...
	var quota int64
	completionRatio := billing_ratio.GetCompletionRatio(textRequest.Model, meta.ChannelType)
	promptTokens := usage.PromptTokens
	completionTokens := usage.CompletionTokens
	quota = int64(math.Ceil((float64(promptTokens) + float64(completionTokens)*completionRatio) * ratio))
	if ratio != 0 && quota <= 0 {
		quota = 1
	}
	totalTokens := promptTokens + completionTokens
	if totalTokens == 0 {
		quota = 0
	}
	quotaDelta := quota - preConsumedQuota

	logContent := fmt.Sprintf("倍率：%.2f × %.2f × %.2f", modelRatio, groupRatio, completionRatio)

	// 获取前置保存的消息并更新
	message, err := model.GetMessageByID(agent.Eid, messageID)
	if err != nil {
		logger.Errorf(ctx, "GetMessageByID failed (eid=%d id=%d): %s", agent.Eid, messageID, err.Error())
		return
	}

	// 仅用于持久化字段：question/message 只保留最后一条 user 消息
	messageJSON, err := json.Marshal(prepareMessagesForStorage(textRequest.Messages))
	if err != nil {
		logger.Errorf(ctx, "marshal messages failed: %s", err.Error())
		messageJSON = []byte("[]")
	}

	// 检查是否为Agent Loop模式（需要累加配额和Tokens）
	isAgentLoop := false
	if agentMasterMsgID, exists := c.Get("agent_master_message_id"); exists {
		if id, ok := agentMasterMsgID.(int64); ok && id > 0 {
			isAgentLoop = true
		}
	}

	// 更新消息字段
	message.Answer = responseContent
	message.ReasoningContent = reasoningContent
	message.ModelName = textRequest.Model

	if isAgentLoop {
		// Agent模式下累加配额和Tokens
		message.Quota += int(quotaDelta)
		message.PromptTokens += promptTokens
		message.CompletionTokens += completionTokens
		message.TotalTokens += totalTokens
	} else {
		// 普通模式下覆盖
		message.Quota = int(quotaDelta)
		message.PromptTokens = promptTokens
		message.CompletionTokens = completionTokens
		message.TotalTokens = totalTokens
	}

	message.ChannelId = int(meta.ChannelId)
	if message.RequestId == "" {
		message.RequestId = helper.GetRequestID(ctx)
	}
	message.ElapsedTime = helper.CalcElapsedTime(startTime)
	message.IsStream = meta.IsStream
	message.QuotaContent = logContent

	// 保存消息状态
	if messageStatus != nil {
		message.ResponseStatus = messageStatus.ResponseStatus
		message.ThinkingMode = messageStatus.ThinkingMode
		message.KnowledgeScope = messageStatus.KnowledgeScope
		message.KnowledgeType = messageStatus.KnowledgeType
		message.OriginalQuestion = messageStatus.OriginalQuestion
		message.RewrittenQuestion = messageStatus.RewrittenQuestion

		// 设置文件ID（优先使用message_file_id）
		if messageStatus.MessageFileID > 0 {
			message.FileID = messageStatus.MessageFileID
		} else if messageStatus.SaveFileID > 0 {
			message.FileID = messageStatus.SaveFileID
		}
	}

	// ⭐ 统一保存 RAG 统计数据（替换原有的复杂逻辑）
	if err := SaveRAGStats(ctx, c, message, responseContent, agent.Eid); err != nil {
		logger.Warnf(ctx, "保存 RAG 统计数据失败: %v", err)
		// 不阻断主流程
	}

	// 更新消息到数据库
	if err := model.UpdateMessage(message); err != nil {
		logger.Errorf(ctx, "UpdateMessage failed: %s", err.Error())
		return
	}

	// 更新会话信息
	conversationId := message.ConversationID
	if conversationId != 0 {
		conversation, err := model.GetConversationByIdAndUserId(agent.Eid, conversationId, user_id)
		if err != nil {
			logger.Errorf(ctx, "get conversation by id and user id failed: %s", err.Error())
		} else {
			lastMessage, _ := json.Marshal(map[string]string{
				"question": string(messageJSON),
				"answer":   responseContent,
			})

			conversation.Quota += int(quotaDelta)
			conversation.TotalTokens += totalTokens
			conversation.LastMessage = string(lastMessage)
			if customConfig != nil {
				if customConfig.ConversationId != "" {
					conversation.ChannelConversationID = customConfig.ConversationId
				}
				if customConfig.ConversationExpirationTime != 0 {
					conversation.ChannelConversationExpirationTime = customConfig.ConversationExpirationTime
				}
			}

			if err := model.UpdateConversation(conversation); err != nil {
				logger.Errorf(ctx, "UpdateConversation failed: %s", err.Error())
			}
		}
	}

	if !isAgentLoop {
		finalizeAgentRunForMessage(ctx, agent, message.ConversationID, message.ID, message.RequestId, model.AgentRunStatusCompleted, "", "")
	}

	go func() {
		if err := model.IncrementField(agent.Eid, agent.AgentID, "total_tokens", int64(totalTokens)); err != nil {
			logger.Errorf(ctx, "增加token消耗统计失败: %s", err.Error())
		}
	}()
	go func() {
		if err := model.IncrementField(agent.Eid, agent.AgentID, "total_duration_ms", message.ElapsedTime); err != nil {
			logger.Errorf(ctx, "增加耗时统计失败: %s", err.Error())
		}
	}()
}

func preConsumeQuota(ctx context.Context, textRequest *relay_model.GeneralOpenAIRequest, promptTokens int, ratio float64, meta *meta.Meta) (int64, *relay_model.ErrorWithStatusCode) {
	preConsumedQuota := getPreConsumedQuota(textRequest, promptTokens, ratio)
	return preConsumedQuota, nil
}

func getPreConsumedQuota(textRequest *relay_model.GeneralOpenAIRequest, promptTokens int, ratio float64) int64 {
	preConsumedTokens := config.PreConsumedQuota + int64(promptTokens)
	if textRequest.MaxTokens != 0 {
		preConsumedTokens += int64(textRequest.MaxTokens)
	}
	return int64(float64(preConsumedTokens) * ratio)
}

// failUpdateMessage: 在错误路径下更新前置创建的消息为失败记录
func failUpdateMessage(c *gin.Context, agent *model.Agent, messageID int64, startTime time.Time, meta *meta.Meta, modelName, requestId, errText string) {
	ctx := c.Request.Context()
	msg, err := model.GetMessageByID(agent.Eid, messageID)
	if err != nil {
		logger.Errorf(ctx, "failUpdateMessage GetMessageByID failed (eid=%d id=%d): %s", agent.Eid, messageID, err.Error())
		return
	}
	// 将错误文本写入 Answer，tokens/Quota 置零
	msg.Answer = errText
	msg.ReasoningContent = ""
	msg.ModelName = modelName
	msg.Quota = 0
	msg.PromptTokens = 0
	msg.CompletionTokens = 0
	msg.TotalTokens = 0
	msg.ChannelId = int(meta.ChannelId)
	if msg.RequestId == "" {
		msg.RequestId = requestId
	}
	msg.ElapsedTime = helper.CalcElapsedTime(startTime)
	msg.IsStream = meta.IsStream
	// 可选：标注倍率文本为空
	msg.QuotaContent = ""

	if err := model.UpdateMessage(msg); err != nil {
		logger.Errorf(ctx, "failUpdateMessage UpdateMessage failed: %s", err.Error())
	}

	finalizeAgentRunForMessage(ctx, agent, msg.ConversationID, msg.ID, msg.RequestId, model.AgentRunStatusFailed, "", errText)
}

func GetByContext(c *gin.Context) *relay_meta.Meta {
	meta := relay_meta.Meta{
		Mode:            relaymode.GetByPath(c.Request.URL.Path),
		ChannelType:     c.GetInt(ctxkey.Channel),
		ChannelId:       c.GetInt(ctxkey.ChannelId),
		TokenId:         c.GetInt(ctxkey.TokenId),
		TokenName:       c.GetString(ctxkey.TokenName),
		UserId:          c.GetInt(ctxkey.Id),
		Group:           c.GetString(ctxkey.Group),
		ModelMapping:    c.GetStringMapString(ctxkey.ModelMapping),
		OriginModelName: c.GetString(ctxkey.RequestModel),
		BaseURL:         c.GetString(ctxkey.BaseURL),
		APIKey:          strings.TrimPrefix(c.Request.Header.Get("Authorization"), "Bearer "),
		RequestURLPath:  c.Request.URL.String(),
		SystemPrompt:    c.GetString(ctxkey.SystemPrompt),
	}
	cfg, ok := c.Get(ctxkey.Config)
	if ok {
		meta.Config = cfg.(oneapi_model.ChannelConfig)
	}
	if meta.BaseURL == "" {
		if meta.ChannelType >= 0 && meta.ChannelType < len(channeltype.ChannelBaseURLs) {
			meta.BaseURL = channeltype.ChannelBaseURLs[meta.ChannelType]
		}
	}
	meta.APIType = channeltype.ToAPIType(meta.ChannelType)
	return &meta
}

// getLastUserMessage 获取消息列表中的最后一条用户消息
func getLastUserMessage(messages []relay_model.Message) string {
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role == "user" {
			content, _ := messages[i].Content.(string)
			// 尝试解析可能的JSON格式内容
			var contentData []map[string]interface{}
			if err := json.Unmarshal([]byte(content), &contentData); err == nil && len(contentData) > 0 {
				// 如果是JSON数组格式，提取text类型的内容
				for _, item := range contentData {
					if itemType, ok := item["type"].(string); ok && itemType == "text" {
						if itemContent, ok := item["content"].(string); ok {
							return itemContent
						}
					}
				}
			}
			return content
		}
	}
	return ""
}
