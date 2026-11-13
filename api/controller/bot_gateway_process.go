package controller

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/session"
	"github.com/53AI/53AIHub/common/utils/helper"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/controller/relay"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/botgateway"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// botSessionLock 会话串行锁条目：mu 串行化同一会话，refs 为持有者+等待者计数。
// refs 归零即从表中移除，否则每个会话都会永久占一把锁，进程长期运行后无界增长。
type botSessionLock struct {
	mu   sync.Mutex
	refs int
}

var (
	botSessionLocksMu sync.Mutex
	botSessionLocks   = make(map[string]*botSessionLock)
)

// lockBotSession 锁定指定会话并返回释放函数（调用方必须 defer 释放）。
// 同一会话严格串行；不同会话各自一把锁，互不阻塞；锁在最后一个使用者离开后被回收。
func lockBotSession(key string) func() {
	botSessionLocksMu.Lock()
	l, ok := botSessionLocks[key]
	if !ok {
		l = &botSessionLock{}
		botSessionLocks[key] = l
	}
	l.refs++
	botSessionLocksMu.Unlock()

	l.mu.Lock()
	return func() {
		// 先摘表再解锁：refs 归零说明既无持有者也无等待者，此后到达的消息才会新建一把锁，
		// 而此刻本函数的工作早已结束，串行性不受影响；若仍有等待者，refs>0 则不会摘除。
		botSessionLocksMu.Lock()
		l.refs--
		if l.refs == 0 {
			delete(botSessionLocks, key)
		}
		botSessionLocksMu.Unlock()
		l.mu.Unlock()
	}
}

func processBotWebhook(binding *model.BotBinding, payload botgateway.Payload, rawBody []byte) error {
	ctx, cancel := context.WithTimeout(context.Background(), botProcessTimeout)
	defer cancel()

	// 会话级串行锁：同一用户会话的消息必须串行执行，确保上一条问答完全落库后再执行下一条，杜绝并发串台！
	sessionLockKey := fmt.Sprintf("%d:%s", binding.ID, payload.Session)
	unlock := lockBotSession(sessionLockKey)
	defer unlock()

	agent, err := loadBotAgent(ctx, binding)
	if err != nil {
		logger.Warnf(ctx, "【bot-gateway】加载 agent 失败: bot_id=%s agent_id=%d err=%v", binding.BotID, binding.AgentID, err)
		return err
	}

	visitorID := botgateway.NormalizeSession(binding.BotID, payload.Session)
	visitorUser, err := ensureBotVisitorUser(ctx, binding.Eid, binding)
	if err != nil {
		logger.Warnf(ctx, "【bot-gateway】visitor 用户处理失败: bot_id=%s err=%v", binding.BotID, err)
		return err
	}

	conversation, err := ensureBotConversation(ctx, binding.Eid, visitorUser.UserID, agent.AgentID, visitorID, agent.Model)
	if err != nil {
		logger.Warnf(ctx, "【bot-gateway】会话处理失败: bot_id=%s err=%v", binding.BotID, err)
		return err
	}

	// 答案幂等缓存：同一 delivery 若上次大模型已生成过答案（但下发微信失败重试），
	// 严禁重新调用大模型！直接复用初次生成的完整答案，确保发给微信的答案与后台数据库记录 100% 完全一致，
	// 彻底杜绝重试导致大模型重新发散、多轮上下文错乱与串台！
	answerCacheKey := fmt.Sprintf("bot_gateway:answer:%s", payload.Delivery)
	var answer string
	if cached, cerr := common.RedisGet(answerCacheKey); cerr == nil && strings.TrimSpace(cached) != "" {
		answer = cached
		logger.Infof(ctx, "【bot-gateway】复用初次生成答案(不重新调大模型): delivery=%s", payload.Delivery)
	} else {
		ans, rerr := runBotAgentAndCollect(ctx, binding, agent, visitorUser, conversation, visitorID, payload.Content, payload.Files)
		if rerr != nil {
			logger.Warnf(ctx, "【bot-gateway】agent 回复生成失败: bot_id=%s session=%s err=%v", binding.BotID, payload.Session, rerr)
			return rerr
		}
		answer = strings.TrimSpace(ans)
		if answer != "" {
			_ = common.RedisSet(answerCacheKey, answer, 2*time.Hour)
		}
	}
	if answer == "" {
		logger.Infof(ctx, "【bot-gateway】agent 无回复内容，不回发: bot_id=%s session=%s", binding.BotID, payload.Session)
		return nil
	}

	// 下行多类型：按回复内容推断消息类型（图片/文件/视频/链接/文本）
	msgType, sendContent, file, link := inferBotReplyType(answer)
	var platformMsgID string
	if msgType == "text" {
		platformMsgID, err = botgateway.SendTextMessage(ctx, binding, payload.Session, sendContent)
	} else {
		platformMsgID, err = botgateway.SendMessage(ctx, binding, payload.Session, msgType, sendContent, file, link)
	}
	if err != nil {
		logger.Warnf(ctx, "【bot-gateway】回复回发失败: bot_id=%s session=%s type=%s err=%v", binding.BotID, payload.Session, msgType, err)
		// ⚠️ 若回复生成成功但平台发送失败（如微信离线、客户端未登录、平台风控），终止重试。
		// 严禁重试整个 processBotWebhook，否则会导致大模型被反复调用，在同一会话中堆积重复问题，引发回答错乱与串台！
		return nil
	}
	logger.Infof(ctx, "【bot-gateway】回复已回发: bot_id=%s session=%s type=%s platformMsgId=%s", binding.BotID, payload.Session, msgType, platformMsgID)
	return nil
}

// loadBotAgent 加载绑定 Agent 并解析默认渠道（与 AgentAPIAuth 的渠道解析一致）。

func loadBotAgent(ctx context.Context, binding *model.BotBinding) (*model.Agent, error) {
	agent, err := model.GetAgentByID(binding.Eid, binding.AgentID)
	if err != nil {
		return nil, err
	}
	if agent.SpecificChannelID <= 0 {
		if agentModels, err := model.GetAgentModelsByAgentID(binding.Eid, agent.AgentID); err == nil && len(agentModels) > 0 {
			agent.ChannelType = agentModels[0].ChannelType
			agent.Model = agentModels[0].Model
			agent.SpecificChannelID = agentModels[0].ChannelID
		}
	}
	return agent, nil
}

// ensureBotVisitorUser 查找或创建 bot 专用 visitor 用户（仿 AgentAPIAuth）。
// username 规范为 "bot_<type>_<botid>"，同一个平台 bot 账号全局唯一映射到同一个 user 记录。
// 兼容平滑升级：若存在原 "bot_visitor_<bindingID>" 历史记录，自动升级为其 username 并返回。
func ensureBotVisitorUser(ctx context.Context, eid int64, binding *model.BotBinding) (*model.User, error) {
	UpgradeLegacyBotVisitorUser(eid, binding)
	username := BotVisitorUsername(binding.Provider, binding.BotID, binding.ID)
	user, err := model.GetUserByUserName(eid, username)
	if err == nil {
		return user, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	user = &model.User{
		Eid:      eid,
		Username: username,
		Nickname: FormatBotUserNickname(binding.Provider, binding.BotID, "", ""),
		Role:     model.RoleGuestUser,
		Status:   model.UserStatusJoined,
		Type:     model.UserTypeVisitor,
		Salt:     helper.RandomString(6),
	}
	if err := model.DB.Create(user).Error; err != nil {
		return nil, err
	}
	return user, nil
}

// ensureBotConversation 查找或创建 bot 会话（source=bot + visitor 精确匹配）。

func ensureBotConversation(ctx context.Context, eid, userID, agentID int64, visitorID, modelName string) (*model.Conversation, error) {
	conversation, err := model.GetBotConversation(eid, userID, agentID, visitorID)
	if err == nil {
		return conversation, nil
	}
	conversation = &model.Conversation{
		Eid:       eid,
		UserID:    userID,
		AgentID:   agentID,
		Status:    model.ConversationStatusActive,
		Model:     modelName,
		Source:    botVisitorSource,
		VisitorID: visitorID,
	}
	if err := model.CreateConversation(conversation); err != nil {
		return nil, err
	}
	return conversation, nil
}

// runBotAgentAndCollect 合成 gin 上下文调用 relay 管线并捕获最终回复。
// 上行图片（Files[].Content=base64 缩略图）以 image_url 多模态喂给 agent（禁主动下载，防封号）。

func runBotAgentAndCollect(ctx context.Context, binding *model.BotBinding, agent *model.Agent, visitorUser *model.User, conversation *model.Conversation, visitorID, content string, files []botgateway.File) (string, error) {
	reqBody, err := buildBotChatRequestBody(content, files, conversation.ConversationID, agent)
	if err != nil {
		return "", err
	}

	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	// ⚠️ 路由路径必须是 /v1/chat/completions（绝对不能带 /api 前缀）！
	// 上游 adaptor 在组装 LLM URL 时以 c.Request.URL.Path 为基准，
	// 若为 /api/v1/... 会拼接出 https://api.deepseek.com/api/v1/chat/completions 导致 404！
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader(reqBody)).WithContext(ctx)
	c.Request.Header.Set("Content-Type", "application/json")

	c.Set(session.ENV_EID, binding.Eid)
	c.Set(session.SESSION_USER_ID, visitorUser.UserID)
	c.Set(session.SESSION_USER_NICKNAME, visitorUser.Nickname)
	c.Set(session.SESSION_AGENT_ID, agent.AgentID)
	c.Set(session.SESSION_AGENT, agent)
	modelName := agent.Model
	if modelName == "" {
		modelName = fmt.Sprintf("agent-%d", agent.AgentID)
	}
	c.Set(session.SESSION_AGENT_MODEL, modelName)
	c.Set(session.SESSION_CONVERSATION_ID, conversation.ConversationID)
	c.Set(session.SESSION_CONVERSATION, conversation)
	c.Set(session.SESSION_REQUEST_SOURCE, botVisitorSource)
	session.SetVisitorID(c, visitorID)

	collector := SetupStreamInterceptor(c)
	relay.Relay(c)
	answer, _ := collector.GetContent()
	if strings.TrimSpace(answer) == "" {
		answer, _ = relay.GetResponseContent(c, true, nil)
	}
	if strings.TrimSpace(answer) == "" && rec.Body.Len() > 0 {
		answer = extractAnswerFromSSE(rec.Body.String())
	}
	return answer, nil
}

// buildBotChatRequestBody 合成 relay 聊天请求体。
// 纯文本用字符串 content：与前台/后台落库形态一致（分片数组会导致 original_question 为空、
// 多轮历史被跳过）；仅当带图片缩略图时才用多模态分片。conversation_id 供 relay 注入历史。
func buildBotChatRequestBody(content string, files []botgateway.File, conversationID int64, agents ...*model.Agent) ([]byte, error) {
	var contentValue any = content
	parts := make([]map[string]any, 0, 1+len(files))
	parts = append(parts, map[string]any{"type": "text", "text": content})
	for _, f := range files {
		if strings.TrimSpace(f.Content) != "" {
			parts = append(parts, map[string]any{
				"type":      "image_url",
				"image_url": map[string]any{"url": "data:image/jpeg;base64," + f.Content},
			})
		}
	}
	if len(parts) > 1 {
		contentValue = parts
	}
	modelName := ""
	if len(agents) > 0 && agents[0] != nil {
		modelName = agents[0].Model
	}
	return json.Marshal(map[string]any{
		"model":           modelName,
		"messages":        []map[string]any{{"role": "user", "content": contentValue}},
		"conversation_id": conversationID,
		"stream":          true,
	})
}

// extractAnswerFromSSE 从底层录制的 SSE 原始流式块中兜底提取 assistant 文本内容。
func extractAnswerFromSSE(raw string) string {
	var sb strings.Builder
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "data:") {
			data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
			if data == "" || data == "[DONE]" {
				continue
			}
			var chunk struct {
				Choices []struct {
					Delta struct {
						Content *string `json:"content"`
					} `json:"delta"`
				} `json:"choices"`
			}
			if err := json.Unmarshal([]byte(data), &chunk); err == nil && len(chunk.Choices) > 0 {
				if chunk.Choices[0].Delta.Content != nil {
					sb.WriteString(*chunk.Choices[0].Delta.Content)
				}
			}
		}
	}
	return sb.String()
}

// botReplyImageRE 匹配整段 markdown 图片：![alt](https://...)
var botReplyImageRE = regexp.MustCompile(`^!\[[^\]]*\]\((https?://[^)]+)\)\s*$`)

// inferBotReplyType 根据 agent 回复推断下行消息类型（优于 xbot 的后缀直判：用 url.Parse 取路径后缀，
// 避免查询串/路径误判）：
//   - 整段 markdown 图片 ![alt](url) → image
//   - 纯 URL 且路径为媒体后缀 → image / video / file
//   - 纯 URL（非媒体）→ link 卡片
//   - 其余 → text

func inferBotReplyType(reply string) (msgType, content string, file *botgateway.SendFileContent, link *botgateway.SendLinkContent) {
	trimmed := strings.TrimSpace(reply)
	if m := botReplyImageRE.FindStringSubmatch(trimmed); m != nil {
		return "image", "", &botgateway.SendFileContent{URL: m[1]}, nil
	}
	u, err := url.Parse(trimmed)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return "text", trimmed, nil, nil
	}
	pathLower := strings.ToLower(u.Path)
	switch {
	case botURLHasSuffix(pathLower, ".jpg", ".jpeg", ".png", ".gif", ".webp"):
		return "image", "", &botgateway.SendFileContent{URL: trimmed}, nil
	case botURLHasSuffix(pathLower, ".mp4", ".mov"):
		return "video", "", &botgateway.SendFileContent{URL: trimmed}, nil
	case botURLHasSuffix(pathLower, ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".zip"):
		return "file", "", &botgateway.SendFileContent{Name: path.Base(u.Path), URL: trimmed}, nil
	}
	// 非媒体纯 URL → 链接卡片（标题用 URL，用户可点开）
	return "link", "", nil, &botgateway.SendLinkContent{Title: trimmed, Desc: "", URL: trimmed}
}

func botURLHasSuffix(pathLower string, suffixes ...string) bool {
	for _, s := range suffixes {
		if strings.HasSuffix(pathLower, s) {
			return true
		}
	}
	return false
}

// botMessageType 从上行 payload 推导规范化消息类型（未改动 bot-gateway 时用 Files/Content 占位文本判定）：
// image/file/link/video/text/empty/unknown。

func botMessageType(payload botgateway.Payload) string {
	// 优先用网关规范化 MessageType 字段；缺失则回退占位文本推导
	if mt := strings.TrimSpace(payload.MessageType); mt != "" {
		switch mt {
		case "text", "image", "link", "file", "video":
			return mt
		}
		return "unknown"
	}
	for _, f := range payload.Files {
		if strings.TrimSpace(f.Content) != "" {
			return "image"
		}
	}
	c := strings.TrimSpace(payload.Content)
	lc := strings.ToLower(c)
	switch {
	case strings.Contains(lc, "收到视频"):
		return "video"
	case strings.Contains(lc, "收到文件") || strings.Contains(lc, "文件地址"):
		return "file"
	case strings.Contains(lc, "链接") || strings.Contains(lc, "地址：") || strings.Contains(lc, "小程序"):
		return "link"
	case c == "":
		return "empty"
	case strings.HasPrefix(lc, "收到"):
		return "unknown" // 其他占位（网关未来新增类型）
	default:
		return "text"
	}
}

// botRepeatDedupable 是否参与“短时相同内容”去重：仅文本。
// 媒体（图片/文件/链接）Content 为占位常量（如图片恒为“收到图片”），按内容哈希会把不同媒体误判为重复；
// 媒体的重复由网关 msgId 幂等 + AgentHub Outbox DeliveryID 兜底。
func botRepeatDedupable(payload botgateway.Payload) bool {
	return botMessageType(payload) == "text"
}

// botMessageSupported hub 能否处理该类型：text/image/link/file 可处理；video/empty/unknown 不可处理。

func botMessageSupported(payload botgateway.Payload) bool {
	switch botMessageType(payload) {
	case "text", "image", "link", "file":
		return true
	default:
		return false
	}
}

// botInternalCommand 内部命令识别（获取 ID 等）：返回回复文本；不匹配返回 ok=false。
// 供运营/联调直接获取会话、发送者、Bot 的 ID，而不必进 agent。

func botInternalCommand(payload botgateway.Payload) (string, bool) {
	c := strings.ToLower(strings.TrimSpace(payload.Content))
	if !(c == "id" || c == "查询id" || c == "我的id" || c == "获取id" || c == "查id" || c == "查询会话id") {
		return "", false
	}
	sid := strings.TrimPrefix(payload.Session, "R:")
	sid = strings.TrimPrefix(sid, "S:")
	kind := "单聊"
	if strings.HasPrefix(payload.Session, "R:") {
		kind = "群聊"
	}
	return fmt.Sprintf("会话类型：%s\n会话 ID：%s\nBot ID：%s", kind, sid, payload.BotID), true
}

// internalCommandReply 回发内部命令结果（不进 agent）。

func internalCommandReply(binding *model.BotBinding, payload botgateway.Payload, reply string) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if _, err := botgateway.SendTextMessage(ctx, binding, payload.Session, reply); err != nil {
		logger.Warnf(ctx, "【bot-gateway】内部命令回复失败: bot_id=%s session=%s err=%v", binding.BotID, payload.Session, err)
		return
	}
	logger.Infof(ctx, "【bot-gateway】内部命令已回复: bot_id=%s session=%s", binding.BotID, payload.Session)
}

// sendBotReply 直接向会话回一条固定文案（不进 agent，失败只记日志）。

func sendBotReply(binding *model.BotBinding, payload botgateway.Payload, text string) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if _, err := botgateway.SendTextMessage(ctx, binding, payload.Session, text); err != nil {
		logger.Warnf(ctx, "【bot-gateway】固定文案回发失败: bot_id=%s session=%s err=%v", binding.BotID, payload.Session, err)
		return
	}
	logger.Infof(ctx, "【bot-gateway】固定文案已回发: bot_id=%s session=%s", binding.BotID, payload.Session)
}

// fallbackBotReply 快速兜底：不进 agent，直接回发固定文案。

func fallbackBotReply(binding *model.BotBinding, payload botgateway.Payload) {
	sendBotReply(binding, payload, config.BotGatewayFallbackReply)
}
