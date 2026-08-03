package wsmanager

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/env"
	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/model"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

// ==================== 配置常量 ====================

const (
	WriteTimeout               = 10 * time.Second
	HeartbeatInterval          = 20 * time.Second
	ReadTimeout                = 60 * time.Second
	WriteChannelSize           = 100
	WsBlacklistKeyPrefix       = "Cache:ws:blacklist:agent:"
	DefaultMaxTotalConnections = 10000
	DefaultRPCMaxConcurrent    = 16
	DefaultRPCTimeout          = 10 * time.Second
)

var (
	RequestSoftWarningTimeout   = 2 * time.Minute
	ConnectionInactiveTimeout   = 5 * time.Minute
	ConnectionHealthCheckPeriod = 30 * time.Second
)

// 环境变量配置
var (
	WSAllowedOrigins     = env.String("WS_ALLOWED_ORIGINS", "")
	WSAllowAllOrigins    = env.Bool("WS_ALLOW_ALL_ORIGINS", false)
	WSMaxTotalConnection = env.Int("WS_MAX_TOTAL_CONNECTIONS", DefaultMaxTotalConnections)
	WSRPCMaxConcurrent   = env.Int("WS_RPC_MAX_CONCURRENT", DefaultRPCMaxConcurrent)
	WSRPCTimeout         = time.Duration(env.Int("WS_RPC_TIMEOUT_SECONDS", int(DefaultRPCTimeout/time.Second))) * time.Second
)

var ErrRPCTooManyRequests = errors.New("openclaw rpc concurrency limit reached")

// ==================== 监控指标 ====================

// WsMetrics WebSocket 监控指标
type WsMetrics struct {
	TotalConnections    int64 // 累计连接数
	ActiveConnections   int64 // 当前活跃连接数
	MessagesSent        int64 // 发送消息数
	MessagesRecv        int64 // 接收消息数
	Errors              int64 // 错误数
	Timeouts            int64 // 超时数
	ReplacedConnections int64 // 被替换的连接数
}

var wsMetrics = &WsMetrics{}

// GetMetrics 获取当前监控指标
func GetMetrics() WsMetrics {
	return WsMetrics{
		TotalConnections:    atomic.LoadInt64(&wsMetrics.TotalConnections),
		ActiveConnections:   atomic.LoadInt64(&wsMetrics.ActiveConnections),
		MessagesSent:        atomic.LoadInt64(&wsMetrics.MessagesSent),
		MessagesRecv:        atomic.LoadInt64(&wsMetrics.MessagesRecv),
		Errors:              atomic.LoadInt64(&wsMetrics.Errors),
		Timeouts:            atomic.LoadInt64(&wsMetrics.Timeouts),
		ReplacedConnections: atomic.LoadInt64(&wsMetrics.ReplacedConnections),
	}
}

func (m *WsMetrics) IncTotalConnections()    { atomic.AddInt64(&m.TotalConnections, 1) }
func (m *WsMetrics) IncActiveConnections()   { atomic.AddInt64(&m.ActiveConnections, 1) }
func (m *WsMetrics) DecActiveConnections()   { atomic.AddInt64(&m.ActiveConnections, -1) }
func (m *WsMetrics) IncMessagesSent()        { atomic.AddInt64(&m.MessagesSent, 1) }
func (m *WsMetrics) IncMessagesRecv()        { atomic.AddInt64(&m.MessagesRecv, 1) }
func (m *WsMetrics) IncErrors()              { atomic.AddInt64(&m.Errors, 1) }
func (m *WsMetrics) IncTimeouts()            { atomic.AddInt64(&m.Timeouts, 1) }
func (m *WsMetrics) IncReplacedConnections() { atomic.AddInt64(&m.ReplacedConnections, 1) }

func IncMessagesSent() { wsMetrics.IncMessagesSent() }

func IsAgentBanned(agentID int64) bool {
	if !common.IsRedisEnabled() {
		return false
	}
	key := WsBlacklistKeyPrefix + fmt.Sprintf("%d", agentID)
	_, err := common.RedisGet(key)
	return err == nil
}

// ==================== 安全配置 ====================

// isAllowedOrigin 检查 Origin 是否在白名单中
func isAllowedOrigin(origin string) bool {
	// 开发环境允许所有来源（不推荐生产使用）
	if WSAllowAllOrigins {
		logger.SysError("[ws-security] WARNING: WS_ALLOW_ALL_ORIGINS is enabled, this is not safe for production!")
		return true
	}

	// 如果没有配置白名单，默认拒绝所有
	if WSAllowedOrigins == "" {
		// 兼容旧行为：无配置时允许（但记录警告）
		logger.SysError("[ws-security] WARNING: No WS_ALLOWED_ORIGINS configured, consider setting it for security")
		return true
	}

	// 解析 Origin
	originURL, err := url.Parse(origin)
	if err != nil {
		return false
	}
	originHost := originURL.Host

	// 检查白名单
	allowedHosts := strings.Split(WSAllowedOrigins, ",")
	for _, host := range allowedHosts {
		host = strings.TrimSpace(host)
		if host == "" {
			continue
		}
		// 支持通配符匹配
		if host == "*" {
			return true
		}
		// 精确匹配
		if originHost == host {
			return true
		}
		// 支持端口通配，如 example.com:* 匹配 example.com:8080
		if strings.HasSuffix(host, ":*") {
			baseHost := strings.TrimSuffix(host, ":*")
			if strings.HasPrefix(originHost, baseHost+":") || originHost == baseHost {
				return true
			}
		}
	}

	return false
}

// upgrader WebSocket 升级器
var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		// 如果 Origin 为空（如同源请求或非浏览器客户端），检查其他认证
		if origin == "" {
			// 这里只做凭据来源存在性判断，真正的 agent/secret 校验在 HandleOpenClawWS 中完成。
			if hasOpenClawWSCredentials(r) {
				return true
			}
			logger.SysError(fmt.Sprintf("[ws-security] Rejected connection with empty origin from %s", r.RemoteAddr))
			return false
		}
		allowed := isAllowedOrigin(origin)
		if !allowed {
			logger.SysError(fmt.Sprintf("[ws-security] Rejected connection from origin: %s", origin))
		}
		return allowed
	},
	// 设置缓冲区大小
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	// 启用压缩
	EnableCompression: false,
}

func hasOpenClawWSCredentials(r *http.Request) bool {
	botID := strings.TrimSpace(r.Header.Get("X-Bot-Id"))
	if botID == "" {
		botID = strings.TrimSpace(r.Header.Get("X-Agent-Id"))
	}
	if botID == "" {
		botID = strings.TrimSpace(r.URL.Query().Get("botId"))
	}

	secret := strings.TrimSpace(r.Header.Get("X-Api-Key"))
	if secret == "" {
		authHeader := strings.TrimSpace(r.Header.Get("Authorization"))
		if strings.HasPrefix(authHeader, "Bearer ") {
			secret = strings.TrimSpace(strings.TrimPrefix(authHeader, "Bearer "))
		}
	}
	if secret == "" {
		secret = strings.TrimSpace(r.Header.Get("X-Agent-Secret"))
	}
	if secret == "" {
		secret = strings.TrimSpace(r.URL.Query().Get("secret"))
	}

	return botID != "" && secret != ""
}

// ==================== 客户端结构 ====================

// WSClient WebSocket 客户端
type WSClient struct {
	AgentID    int64
	Conn       *websocket.Conn
	mu         sync.Mutex
	writers    sync.Map
	rpcWaiters sync.Map
	CloseChan  chan struct{}
	closed     atomic.Bool
	createdAt  time.Time
	lastActive atomic.Value // time.Time
	rpcSem     chan struct{}

	// 背压控制
	writeCh chan interface{}

	// SendFunc is optional and used by tests to observe outbound frames without a real websocket.
	SendFunc func(msg interface{}) error

	// 超时监控管理
	timeoutWatchers sync.Map // map[string]context.CancelFunc

	// 被替换标记 - 用于正确处理连接替换时的活跃计数
	isReplaced atomic.Bool
}

// NewWSClient 创建新的 WebSocket 客户端
func NewWSClient(agentID int64, conn *websocket.Conn) *WSClient {
	maxRPC := WSRPCMaxConcurrent
	if maxRPC <= 0 {
		maxRPC = DefaultRPCMaxConcurrent
	}
	client := &WSClient{
		AgentID:   agentID,
		Conn:      conn,
		CloseChan: make(chan struct{}),
		createdAt: time.Now(),
		writeCh:   make(chan interface{}, WriteChannelSize),
		rpcSem:    make(chan struct{}, maxRPC),
	}
	client.lastActive.Store(time.Now())
	return client
}

type RPCError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Details string `json:"details,omitempty"`
}

type RPCStatusError struct {
	Status  string
	Code    string
	Message string
	Details string
}

func (e *RPCStatusError) Error() string {
	if e == nil {
		return ""
	}
	if e.Message != "" {
		return e.Message
	}
	if e.Code != "" {
		return e.Code
	}
	return "openclaw rpc error"
}

type RPCResult struct {
	ReqID  string
	Action string
	Status string
	Data   json.RawMessage
	Error  *RPCError
}

type rpcWaiter struct {
	ch chan RPCResult
}

// CallRPC sends a request-response style message to the connected OpenClaw plugin.
func (c *WSClient) CallRPC(ctx context.Context, action string, payload interface{}) (*RPCResult, error) {
	if c == nil {
		return nil, errors.New("websocket client is nil")
	}
	if c.closed.Load() {
		return nil, errors.New("connection closed")
	}
	if strings.TrimSpace(action) == "" {
		return nil, errors.New("rpc action is required")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if _, hasDeadline := ctx.Deadline(); !hasDeadline && WSRPCTimeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, WSRPCTimeout)
		defer cancel()
	}

	select {
	case c.rpcSem <- struct{}{}:
		defer func() { <-c.rpcSem }()
	default:
		wsMetrics.IncErrors()
		return nil, ErrRPCTooManyRequests
	}

	reqID := uuid.New().String()
	rawPayload, err := marshalRPCPayload(payload)
	if err != nil {
		return nil, err
	}

	waiter := &rpcWaiter{ch: make(chan RPCResult, 1)}
	c.rpcWaiters.Store(reqID, waiter)
	defer c.rpcWaiters.Delete(reqID)

	msg := WsMessage{
		ReqID:  reqID,
		Action: action,
		Data:   rawPayload,
		Status: "request",
	}
	if err := c.SendMessage(msg); err != nil {
		wsMetrics.IncErrors()
		return nil, err
	}

	select {
	case result := <-waiter.ch:
		if result.Status == "error" {
			if result.Error == nil {
				result.Error = &RPCError{Code: "PLUGIN_ERROR", Message: "openclaw plugin returned error"}
			}
			return &result, &RPCStatusError{
				Status:  result.Status,
				Code:    result.Error.Code,
				Message: result.Error.Message,
				Details: result.Error.Details,
			}
		}
		return &result, nil
	case <-ctx.Done():
		wsMetrics.IncTimeouts()
		return nil, ctx.Err()
	}
}

func marshalRPCPayload(payload interface{}) (json.RawMessage, error) {
	if payload == nil {
		return json.RawMessage(`{}`), nil
	}
	switch v := payload.(type) {
	case json.RawMessage:
		if len(v) == 0 {
			return json.RawMessage(`{}`), nil
		}
		return v, nil
	case []byte:
		if len(v) == 0 {
			return json.RawMessage(`{}`), nil
		}
		return json.RawMessage(v), nil
	default:
		bytes, err := json.Marshal(payload)
		if err != nil {
			return nil, err
		}
		return json.RawMessage(bytes), nil
	}
}

func (c *WSClient) HandleIncomingMessage(msg WsMessage) bool {
	if msg.ReqID == "" {
		return false
	}
	if waiterValue, ok := c.rpcWaiters.LoadAndDelete(msg.ReqID); ok {
		result := RPCResult{
			ReqID:  msg.ReqID,
			Action: msg.Action,
			Status: msg.Status,
			Data:   msg.Data,
		}
		if msg.Status == "error" {
			result.Error = parseRPCError(msg.Data)
		}
		waiter := waiterValue.(*rpcWaiter)
		select {
		case waiter.ch <- result:
		default:
		}
		return true
	}
	if writerValue, ok := c.writers.Load(msg.ReqID); ok {
		writer := writerValue.(*io.PipeWriter)
		handled := handleWSMessage(c, msg, writer)
		if handled {
			c.releaseWriter(msg.ReqID)
		}
		return true
	}
	return false
}

func parseRPCError(data json.RawMessage) *RPCError {
	if len(data) == 0 {
		return nil
	}
	var direct RPCError
	if err := json.Unmarshal(data, &direct); err == nil && (direct.Code != "" || direct.Message != "") {
		return &direct
	}
	var wrapped struct {
		Error RPCError `json:"error"`
	}
	if err := json.Unmarshal(data, &wrapped); err == nil && (wrapped.Error.Code != "" || wrapped.Error.Message != "") {
		return &wrapped.Error
	}
	return &RPCError{Code: "PLUGIN_ERROR", Message: string(data)}
}

// SendMessage 发送消息（带超时和背压控制）
func (c *WSClient) SendMessage(msg interface{}) error {
	if c.closed.Load() {
		return fmt.Errorf("connection closed")
	}
	if c.SendFunc != nil {
		return c.SendFunc(msg)
	}

	// 非阻塞发送到通道
	select {
	case c.writeCh <- msg:
		return nil
	default:
		// 通道满，尝试直接发送（带超时）
		c.mu.Lock()
		defer c.mu.Unlock()
		c.Conn.SetWriteDeadline(time.Now().Add(WriteTimeout))
		defer c.Conn.SetWriteDeadline(time.Time{})
		err := c.Conn.WriteJSON(msg)
		if err != nil {
			wsMetrics.IncErrors()
			go c.Close(websocket.CloseAbnormalClosure, "write failed")
		}
		return err
	}
}

// sendMessageDirect 直接发送消息（内部使用）
func (c *WSClient) sendMessageDirect(msg interface{}) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.closed.Load() {
		return fmt.Errorf("connection closed")
	}

	c.Conn.SetWriteDeadline(time.Now().Add(WriteTimeout))
	defer c.Conn.SetWriteDeadline(time.Time{})

	err := c.Conn.WriteJSON(msg)
	if err != nil {
		wsMetrics.IncErrors()
		go c.Close(websocket.CloseAbnormalClosure, "write failed")
	} else {
		wsMetrics.IncMessagesSent()
	}
	return err
}

// startWriteWorker 启动写入工作协程
func (c *WSClient) startWriteWorker() {
	go func() {
		for {
			select {
			case <-c.CloseChan:
				return
			case msg, ok := <-c.writeCh:
				if !ok {
					return
				}
				if err := c.sendMessageDirect(msg); err != nil {
					logger.SysError(fmt.Sprintf("[openclaw-ws] Write error: %v", err))
					return
				}
			}
		}
	}()
}

// AddWriter 添加 writer 并启动软警告保护
func (c *WSClient) AddWriter(reqID string, w *io.PipeWriter) {
	ctx, cancel := context.WithCancel(context.Background())
	c.timeoutWatchers.Store(reqID, cancel)
	c.writers.Store(reqID, w)
	// 启动软警告 goroutine
	go c.watchRequestSoftWarning(reqID, ctx)
}

// watchRequestSoftWarning 请求软警告监控
func (c *WSClient) watchRequestSoftWarning(reqID string, ctx context.Context) {
	timer := time.NewTimer(RequestSoftWarningTimeout)
	defer timer.Stop()
	defer c.timeoutWatchers.Delete(reqID)

	select {
	case <-timer.C:
		if _, ok := c.writers.Load(reqID); ok {
			logger.SysWarnf("[openclaw-ws] Request soft warning: agentID=%d reqID=%s elapsed=%v connectionAlive=%v",
				c.AgentID, reqID, RequestSoftWarningTimeout, !c.closed.Load())
		}
	case <-ctx.Done():
	case <-c.CloseChan:
	}
}

// RemoveWriter 移除 writer
func (c *WSClient) RemoveWriter(reqID string) {
	if cancel, ok := c.timeoutWatchers.LoadAndDelete(reqID); ok {
		cancel.(context.CancelFunc)()
	}
	if w, ok := c.writers.LoadAndDelete(reqID); ok {
		w.(*io.PipeWriter).CloseWithError(fmt.Errorf("writer removed"))
	}
}

// releaseWriter 释放 writer 但不主动关闭底层 pipe
// 用于正常完成路径：writer 本身已经写入 [DONE] 并关闭，这里只负责移除关联与取消软警告 watcher。
func (c *WSClient) releaseWriter(reqID string) {
	if cancel, ok := c.timeoutWatchers.LoadAndDelete(reqID); ok {
		cancel.(context.CancelFunc)()
	}
	c.writers.Delete(reqID)
}

// Close 优雅关闭连接
func (c *WSClient) Close(code int, reason string) error {
	if c.closed.Swap(true) {
		return nil // 已经关闭
	}

	// 发送关闭帧
	c.mu.Lock()
	err := c.Conn.WriteMessage(websocket.CloseMessage,
		websocket.FormatCloseMessage(code, reason))
	c.mu.Unlock()

	// 关闭 CloseChan，通知所有 goroutine 退出
	close(c.CloseChan)

	// 取消所有超时监控
	c.timeoutWatchers.Range(func(key, value interface{}) bool {
		if cancel, ok := value.(context.CancelFunc); ok {
			cancel()
		}
		c.timeoutWatchers.Delete(key)
		return true
	})

	// 清理所有 writers
	c.writers.Range(func(key, value interface{}) bool {
		value.(*io.PipeWriter).CloseWithError(fmt.Errorf("connection closed"))
		c.writers.Delete(key)
		return true
	})

	// 关闭连接
	c.Conn.Close()

	return err
}

// UpdateLastActive 更新最后活跃时间
func (c *WSClient) UpdateLastActive() {
	c.lastActive.Store(time.Now())
}

// GetLastActive 获取最后活跃时间
func (c *WSClient) GetLastActive() time.Time {
	if v := c.lastActive.Load(); v != nil {
		return v.(time.Time)
	}
	return c.createdAt
}

// CreatedAt 返回连接创建时间
func (c *WSClient) CreatedAt() time.Time {
	return c.createdAt
}

// Done 返回连接关闭信号通道
func (c *WSClient) Done() <-chan struct{} {
	return c.CloseChan
}

// CloseGracefully 发送优雅关闭帧后关闭连接
func (c *WSClient) CloseGracefully(reason string) {
	c.Close(websocket.CloseGoingAway, reason)
}

// CloseImmediately 立即关闭连接
func (c *WSClient) CloseImmediately(reason string) {
	c.Close(websocket.ClosePolicyViolation, reason)
}

// IsReplaced 返回连接是否已被新连接替换
func (c *WSClient) IsReplaced() bool {
	return c.isReplaced.Load()
}

// MarkReplaced 标记连接已被替换
func (c *WSClient) MarkReplaced() {
	c.isReplaced.Store(true)
}

// ==================== 连接管理器 ====================

type WsManager struct {
	clients sync.Map
	mu      sync.Mutex
}

var WsClientManager = &WsManager{}

func (m *WsManager) AddClient(agentID int64, c *WSClient) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	currentActive := atomic.LoadInt64(&wsMetrics.ActiveConnections)
	if currentActive >= int64(WSMaxTotalConnection) {
		return fmt.Errorf("max total connections (%d) reached", WSMaxTotalConnection)
	}

	if existing, ok := m.clients.Load(agentID); ok {
		oldClient := existing.(*WSClient)
		oldClient.MarkReplaced()
		wsMetrics.IncReplacedConnections()
		logger.Info(context.Background(), fmt.Sprintf("[openclaw-ws] Closing old connection for AgentID=%d", agentID))

		go func() {
			oldClient.Close(websocket.ClosePolicyViolation, "connection replaced by new client")
		}()
	} else {
		wsMetrics.IncActiveConnections()
	}

	m.clients.Store(agentID, c)
	wsMetrics.IncTotalConnections()

	return nil
}

func (m *WsManager) RemoveClient(agentID int64) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, loaded := m.clients.LoadAndDelete(agentID); loaded {
		wsMetrics.DecActiveConnections()
	}
}

func (m *WsManager) GetClient(agentID int64) (*WSClient, bool) {
	v, ok := m.clients.Load(agentID)
	if !ok {
		return nil, false
	}
	return v.(*WSClient), true
}

func (m *WsManager) GetAllClients() map[int64]*WSClient {
	result := make(map[int64]*WSClient)
	m.clients.Range(func(key, value interface{}) bool {
		result[key.(int64)] = value.(*WSClient)
		return true
	})
	return result
}

// ==================== 消息结构 ====================

// MediaContent 媒体内容结构
type MediaContent struct {
	Type     string `json:"type"`               // "image" 或 "file"
	URL      string `json:"url,omitempty"`      // 媒体 URL
	Base64   string `json:"base64,omitempty"`   // Base64 编码数据
	MimeType string `json:"mimeType,omitempty"` // MIME 类型
	Filename string `json:"filename,omitempty"` // 文件名（仅文件类型）
	FileName string `json:"file_name,omitempty"`
	Size     int64  `json:"size,omitempty"`
}

// WsMessageData WebSocket 消息数据结构
type WsMessageData struct {
	ToChatId string         `json:"toChatId,omitempty"`
	Text     string         `json:"text,omitempty"`
	Media    *MediaContent  `json:"media,omitempty"`
	Files    []MediaContent `json:"files,omitempty"`
}

// WsMessage WebSocket 消息结构
type WsMessage struct {
	ReqID  string          `json:"req_id"`
	Action string          `json:"action"`
	Data   json.RawMessage `json:"data"`
	Status string          `json:"status"` // "done", "error", "streaming", "final"
}

// ==================== 处理器 ====================

// HandleOpenClawWS OpenClaw WebSocket 长连接处理器
// @Summary OpenClaw WebSocket 连接
// @Description 建立 OpenClaw 智能体的 WebSocket 长连接，实现插件与后端的实时双向通信
// @Description
// @Description **认证方式**: Header传参 X-Bot-Id + X-Api-Key，或Query传参 botId + secret
// @Description
// @Description **消息格式**:
// @Description - 发送聊天: {"req_id":"xxx","action":"chat","data":{"model":"gpt-4","messages":[{"role":"user","content":"你好"}]}}
// @Description - 多模态: content为数组，包含{"type":"text","text":"..."}和{"type":"image_url","image_url":{"url":"..."}}
// @Description - 插件推送: {"req_id":"xxx","action":"message","data":{"toChatId":"user-id","text":"文本","media":{"type":"image","url":"..."}}}
// @Description - 心跳: {"action":"ping"} 或原生 WebSocket Ping
// @Tags OpenClaw
// @Accept json
// @Produce json
// @Param X-Bot-Id header string false "智能体ID（优先）"
// @Param X-Agent-Id header string false "智能体ID（备选）"
// @Param X-Api-Key header string false "API密钥（优先）"
// @Param Authorization header string false "Bearer token格式密钥"
// @Param botId query string false "智能体ID（Query参数）"
// @Param secret query string false "API密钥（Query参数）"
// @Success 101 {string} string "Switching Protocols - WebSocket连接建立成功"
// @Failure 401 {object} map[string]string "Unauthorized - 缺少或无效的认证信息"
// @Failure 403 {object} map[string]string "Forbidden - 智能体类型不匹配"
// @Router /v1/openclaw/ws/connect [get]
func HandleOpenClawWS(c *gin.Context) {
	// 优先从 headers 获取认证信息（支持多种 header 格式）
	agentIdStr := c.GetHeader("X-Bot-Id")
	if agentIdStr == "" {
		// 兼容旧格式
		agentIdStr = c.GetHeader("X-Agent-Id")
	}
	if agentIdStr == "" {
		agentIdStr = c.Query("botId")
	}

	// 从多个来源获取 secret/token
	secret := c.GetHeader("X-Api-Key")
	if secret == "" {
		// 尝试从 Authorization header 获取
		authHeader := c.GetHeader("Authorization")
		if strings.HasPrefix(authHeader, "Bearer ") {
			secret = strings.TrimPrefix(authHeader, "Bearer ")
		}
	}
	if secret == "" {
		// 兼容旧格式
		secret = c.GetHeader("X-Agent-Secret")
	}
	if secret == "" {
		secret = c.Query("secret")
	}

	if agentIdStr == "" || secret == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Missing credentials"})
		return
	}

	agentID, err := hashids.TryParseID(agentIdStr)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid agent ID format"})
		return
	}

	var agent model.Agent
	if err := model.DB.Where("agent_id = ?", agentID).First(&agent).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Agent not found"})
		return
	}

	if !agent.IsOpenClawWSCompatible() {
		c.JSON(http.StatusForbidden, gin.H{"error": "Agent is not a WebSocket OpenClaw agent"})
		return
	}

	var customCfg map[string]interface{}
	if agent.CustomConfig != "" {
		_ = json.Unmarshal([]byte(agent.CustomConfig), &customCfg)
	}

	storedSecret, _ := customCfg["openclaw_app_secret"].(string)
	if storedSecret == "" || storedSecret != secret {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid secret"})
		return
	}

	if IsAgentBanned(agentID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Agent is banned"})
		return
	}

	// 升级 WebSocket 连接
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		logger.SysError(fmt.Sprintf("[openclaw-ws] WebSocket Upgrade Error: %v", err))
		return
	}

	// 创建客户端
	client := NewWSClient(agentID, conn)

	// 添加到管理器（会检查连接数限制）
	if err := WsClientManager.AddClient(agentID, client); err != nil {
		logger.SysError(fmt.Sprintf("[openclaw-ws] Failed to add client: %v", err))
		conn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.ClosePolicyViolation, err.Error()))
		conn.Close()
		return
	}

	// 启动写入工作协程
	client.startWriteWorker()

	logger.Info(context.Background(), fmt.Sprintf("[openclaw-ws] Connected: AgentID=%d, RemoteAddr=%s",
		agentID, conn.RemoteAddr()))

	// 设置初始读超时
	conn.SetReadDeadline(time.Now().Add(ReadTimeout))

	// 处理原生 WebSocket ping frame（插件每 15 秒发送一次）
	conn.SetPingHandler(func(appData string) error {
		conn.SetReadDeadline(time.Now().Add(ReadTimeout))
		client.UpdateLastActive()
		client.mu.Lock()
		err := conn.WriteMessage(websocket.PongMessage, []byte(appData))
		client.mu.Unlock()
		return err
	})

	// 处理 pong frame（响应服务端发送的 ping）
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(ReadTimeout))
		client.UpdateLastActive()
		return nil
	})

	// 读协程
	go func() {
		defer func() {
			if !client.IsReplaced() {
				WsClientManager.RemoveClient(agentID)
			}
			client.Close(websocket.CloseGoingAway, "read loop ended")
			logger.Info(context.Background(), fmt.Sprintf("[openclaw-ws] Disconnected: AgentID=%d", agentID))
		}()

		for {
			var msg WsMessage
			if err := conn.ReadJSON(&msg); err != nil {
				if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure, websocket.CloseNormalClosure) {
					logger.SysError(fmt.Sprintf("[openclaw-ws] Read error: %v", err))
					wsMetrics.IncErrors()
				}
				break
			}

			client.UpdateLastActive()
			wsMetrics.IncMessagesRecv()

			// 处理 ping 消息
			if msg.Action == "ping" {
				client.SendMessage(WsMessage{Action: "pong"})
				continue
			}

			// 处理插件主动发送的消息（如发送媒体给用户）
			if msg.Action == "message" {
				if processStep, ok := convertPluginMessageToProcessStep(msg); ok && msg.ReqID != "" {
					if client.HandleIncomingMessage(processStep) {
						logger.Debugf(context.Background(), "[openclaw-ws] Forwarded plugin message media to reqID=%s", msg.ReqID)
					}
				}
				handlePluginMessage(client, msg)
				continue
			}

			if msg.ReqID != "" {
				if client.HandleIncomingMessage(msg) {
					continue
				}
				logger.SysWarnf("[openclaw-ws] Writer not found for reqID=%s action=%s status=%s", msg.ReqID, msg.Action, msg.Status)
			} else {
				logger.SysError(fmt.Sprintf("[openclaw-ws] Received message with empty reqID: action=%s", msg.Action))
			}
		}
	}()

	// 心跳协程
	go func() {
		ticker := time.NewTicker(HeartbeatInterval)
		defer ticker.Stop()

		for {
			select {
			case <-client.CloseChan:
				return
			case <-ticker.C:
				client.mu.Lock()
				err := conn.WriteMessage(websocket.PingMessage, nil)
				client.mu.Unlock()
				if err != nil {
					logger.SysError(fmt.Sprintf("[openclaw-ws] Heartbeat failed: %v", err))
					wsMetrics.IncErrors()
					go client.Close(websocket.CloseAbnormalClosure, "heartbeat failed")
					return
				}
			}
		}
	}()

	// 连接健康检查协程
	go startConnectionInactivityWatcher(client, agentID)
}

// handleWSMessage 处理 WebSocket 消息，返回是否需要清理 writer
func handleWSMessage(client *WSClient, msg WsMessage, writer *io.PipeWriter) bool {
	switch msg.Status {
	case "done", "final":
		// done 状态时，data 可能包含最终内容，需要先写入
		if len(msg.Data) > 0 {
			writeSSEData(writer, msg.Data)
		}
		writer.Write([]byte("data: [DONE]\n\n"))
		writer.Close()
		return true

	case "error":
		if len(msg.Data) > 0 {
			writeSSEData(writer, msg.Data)
		}
		writer.Write([]byte("data: [DONE]\n\n"))
		writer.Close()
		return true

	case "thinking":
		// thinking 状态：转换为 reasoning_content 格式发送给前端
		// 这样前端可以看到思考过程，但不会记录到 answer 字段
		if len(msg.Data) > 0 {
			thinkingData := convertThinkingToReasoning(msg.Data, msg.ReqID)
			writeSSEData(writer, thinkingData)
		}
		return false

	default:
		if len(msg.Data) > 0 {
			writeSSEData(writer, msg.Data)
		}
		return false
	}
}

func startConnectionInactivityWatcher(client *WSClient, agentID int64) {
	ticker := time.NewTicker(ConnectionHealthCheckPeriod)
	defer ticker.Stop()

	for {
		select {
		case <-client.CloseChan:
			return
		case <-ticker.C:
			lastActive := client.GetLastActive()
			if time.Since(lastActive) > ConnectionInactiveTimeout {
				wsMetrics.IncTimeouts()
				logger.SysError(fmt.Sprintf("[openclaw-ws] Connection inactive for too long: AgentID=%d lastActive=%s timeout=%v",
					agentID, lastActive.Format(time.RFC3339Nano), ConnectionInactiveTimeout))
				client.Close(websocket.ClosePolicyViolation, "connection inactive")
				return
			}
		}
	}
}

// convertThinkingToReasoning 将 thinking 消息转换为 reasoning_content 格式
func convertThinkingToReasoning(data json.RawMessage, reqID string) json.RawMessage {
	// 解析原始 thinking 数据
	var thinkingMsg struct {
		Type           string          `json:"type"`
		Content        string          `json:"content"`
		Status         string          `json:"status"`
		Mode           string          `json:"mode"`
		Replace        *bool           `json:"replace"`
		EventKind      string          `json:"event_kind"`
		SessionID      string          `json:"session_id"`
		ConversationID string          `json:"conversation_id"`
		Payload        json.RawMessage `json:"payload"`
	}
	if err := json.Unmarshal(data, &thinkingMsg); err != nil {
		logger.SysError(fmt.Sprintf("[openclaw-ws] Failed to parse thinking data: %v", err))
		return data
	}
	thinkingContent := strings.TrimSpace(thinkingMsg.Content)
	if thinkingContent == "" {
		var chunk struct {
			Choices []struct {
				Delta struct {
					Content          string `json:"content"`
					ReasoningContent string `json:"reasoning_content"`
				} `json:"delta"`
			} `json:"choices"`
		}
		if err := json.Unmarshal(data, &chunk); err == nil && len(chunk.Choices) > 0 {
			thinkingContent = strings.TrimSpace(chunk.Choices[0].Delta.ReasoningContent)
			if thinkingContent == "" {
				thinkingContent = strings.TrimSpace(chunk.Choices[0].Delta.Content)
			}
		}
	}

	// 构建标准的 OpenAI 流式响应格式，使用 reasoning_content 字段
	response := map[string]interface{}{
		"id":      reqID,
		"object":  "chat.completion.chunk",
		"created": time.Now().Unix(),
		"model":   "openclaw-agent",
		"status":  "thinking",
		"choices": []map[string]interface{}{
			{
				"index": 0,
				"delta": map[string]interface{}{
					"reasoning_content": thinkingContent,
				},
				"finish_reason": nil,
			},
		},
	}
	if thinkingMsg.Status != "" {
		response["status"] = thinkingMsg.Status
	}
	if thinkingMsg.Mode != "" {
		response["mode"] = thinkingMsg.Mode
	}
	if thinkingMsg.Replace != nil {
		response["replace"] = *thinkingMsg.Replace
	}
	if thinkingMsg.EventKind != "" {
		response["event_kind"] = thinkingMsg.EventKind
	} else {
		response["event_kind"] = "assistant.thinking"
	}
	if thinkingMsg.SessionID != "" {
		response["session_id"] = thinkingMsg.SessionID
	}
	if thinkingMsg.ConversationID != "" {
		response["conversation_id"] = thinkingMsg.ConversationID
	}
	if len(thinkingMsg.Payload) > 0 && string(thinkingMsg.Payload) != "null" {
		response["payload"] = thinkingMsg.Payload
	}

	result, err := json.Marshal(response)
	if err != nil {
		logger.SysError(fmt.Sprintf("[openclaw-ws] Failed to marshal reasoning response: %v", err))
		return data
	}

	return result
}

// writeSSEData 写入 SSE 格式数据
func writeSSEData(writer *io.PipeWriter, data json.RawMessage) {
	chunk := append([]byte("data: "), data...)
	chunk = append(chunk, []byte("\n\n")...)
	writer.Write(chunk)
}

func convertPluginMessageToProcessStep(msg WsMessage) (WsMessage, bool) {
	var msgData WsMessageData
	if err := json.Unmarshal(msg.Data, &msgData); err != nil {
		return WsMessage{}, false
	}
	files := make([]map[string]interface{}, 0, 1+len(msgData.Files))
	if msgData.Media != nil {
		if file := mediaContentToOutputFile(*msgData.Media); file != nil {
			files = append(files, file)
		}
	}
	for _, media := range msgData.Files {
		if file := mediaContentToOutputFile(media); file != nil {
			files = append(files, file)
		}
	}
	if len(files) == 0 {
		return WsMessage{}, false
	}

	mediaAttachments := make([]map[string]interface{}, 0, len(files))
	for _, file := range files {
		attachment := make(map[string]interface{}, len(file)+1)
		for key, value := range file {
			attachment[key] = value
		}
		attachment["kind"] = resolvePluginMediaKind(stringFromMap(file, "mime_type"), stringFromMap(file, "file_name"))
		mediaAttachments = append(mediaAttachments, attachment)
	}

	payload := map[string]interface{}{
		"id":      firstNonEmpty(msg.ReqID, uuid.NewString()) + "-message-output-files",
		"object":  "process.step",
		"created": time.Now().Unix(),
		"model":   "openclaw-agent",
		"status":  "streaming",
		"process_step": map[string]interface{}{
			"step_code": "output_files",
			"name":      "生成文件",
			"status":    "completed",
			"message":   fmt.Sprintf("生成了 %d 个文件", len(files)),
			"data": map[string]interface{}{
				"files":                  files,
				"contract_version":       "v1",
				"media_attachments":      mediaAttachments,
				"media_contract_version": "v1",
			},
			"timestamp": time.Now().Unix(),
		},
	}
	rawPayload, err := json.Marshal(payload)
	if err != nil {
		logger.SysError(fmt.Sprintf("[openclaw-ws] Failed to marshal plugin message process step: %v", err))
		return WsMessage{}, false
	}
	return WsMessage{
		ReqID:  msg.ReqID,
		Action: "chat",
		Data:   rawPayload,
		Status: "streaming",
	}, true
}

func mediaContentToOutputFile(media MediaContent) map[string]interface{} {
	urlValue := strings.TrimSpace(media.URL)
	base64Value := strings.TrimSpace(media.Base64)
	if urlValue == "" && base64Value == "" {
		return nil
	}
	fileName := firstNonEmpty(media.FileName, media.Filename, inferPluginFileNameFromURL(urlValue), "file")
	fileID := firstNonEmpty(urlValue, fileName)
	item := map[string]interface{}{
		"id":        fileID,
		"file_name": fileName,
	}
	if urlValue != "" {
		item["url"] = urlValue
	}
	if base64Value != "" {
		item["base64"] = base64Value
	}
	if media.MimeType != "" {
		item["mime_type"] = strings.TrimSpace(media.MimeType)
	}
	if media.Size > 0 {
		item["size"] = media.Size
	}
	return item
}

func stringFromMap(value map[string]interface{}, key string) string {
	if raw, ok := value[key].(string); ok {
		return raw
	}
	return ""
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func inferPluginFileNameFromURL(rawURL string) string {
	if rawURL == "" {
		return ""
	}
	parsed, err := url.Parse(rawURL)
	var pathname string
	if err == nil {
		pathname = parsed.Path
	} else {
		pathname = strings.Split(rawURL, "?")[0]
	}
	parts := strings.Split(pathname, "/")
	for i := len(parts) - 1; i >= 0; i-- {
		if part := strings.TrimSpace(parts[i]); part != "" {
			return part
		}
	}
	return ""
}

func resolvePluginMediaKind(mimeType string, fileName string) string {
	lower := strings.ToLower(strings.TrimSpace(mimeType))
	switch {
	case strings.HasPrefix(lower, "image/"):
		return "image"
	case strings.HasPrefix(lower, "audio/"):
		return "audio"
	case strings.HasPrefix(lower, "video/"):
		return "video"
	case strings.HasPrefix(lower, "text/"):
		return "text"
	}
	ext := strings.ToLower(strings.TrimPrefix(strings.TrimSpace(fileName[strings.LastIndex(fileName, ".")+1:]), "."))
	switch ext {
	case "png", "jpg", "jpeg", "gif", "webp", "svg":
		return "image"
	case "mp3", "wav", "m4a", "ogg":
		return "audio"
	case "mp4", "mov", "webm":
		return "video"
	case "txt", "md", "csv", "json", "log":
		return "text"
	default:
		return "file"
	}
}

// handlePluginMessage 处理插件主动发送的消息（如发送媒体给用户）
func handlePluginMessage(client *WSClient, msg WsMessage) {
	var msgData WsMessageData
	if err := json.Unmarshal(msg.Data, &msgData); err != nil {
		logger.SysError(fmt.Sprintf("[openclaw-ws] Failed to parse message data: %v", err))
		return
	}

	logger.Info(context.Background(), fmt.Sprintf("[openclaw-ws] Received plugin message: toChatId=%s, hasMedia=%v, files=%d, textLen=%d",
		msgData.ToChatId, msgData.Media != nil, len(msgData.Files), len(msgData.Text)))

	// 发送确认响应
	ackMsg := WsMessage{
		ReqID:  msg.ReqID,
		Action: "message_ack",
		Status: "done",
	}
	if err := client.SendMessage(ackMsg); err != nil {
		logger.SysError(fmt.Sprintf("[openclaw-ws] Failed to send message ack: %v", err))
	}
}
