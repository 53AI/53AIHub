package chatdebug

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/service/rag"
	"github.com/gin-gonic/gin"
	"github.com/go-redis/redis/v8"
)

const (
	ChatDebugIndexPrefix = "ChatDebug:Index:"
	ChatDebugTracePrefix = "ChatDebug:Trace:"
	MaxTracesPerEID      = 10
	TraceTTL             = 1 * time.Hour
	GinTraceKey          = "chat_debug_trace"
)

type chatDebugContextKey struct{}

// TraceStage 单个执行阶段明细
type TraceStage struct {
	Stage      string                 `json:"stage"`           // request, intent, rag, tool, llm
	Title      string                 `json:"title"`           // 阶段中文标题
	Status     string                 `json:"status"`          // success, failed, skipped
	StartedAt  int64                  `json:"started_at"`      // 阶段开始时间戳毫秒
	DurationMs int64                  `json:"duration_ms"`     // 耗时毫秒
	Data       map[string]interface{} `json:"data,omitempty"`  // 阶段详情数据
	Error      string                 `json:"error,omitempty"` // 阶段错误
}

// ChatTrace 一次 /v1/chat/completions 的完整链路记录
type ChatTrace struct {
	RequestID        string       `json:"request_id"`
	EID              int64        `json:"eid"`
	Model            string       `json:"model"`
	OriginalQuery    string       `json:"original_query"`
	StartedAt        int64        `json:"started_at"`
	DurationMs       int64        `json:"duration_ms"`
	StatusCode       int          `json:"status_code"`
	Status           string       `json:"status"` // success, failed
	Error            string       `json:"error,omitempty"`
	PromptTokens     int64        `json:"prompt_tokens"`
	CompletionTokens int64        `json:"completion_tokens"`
	TotalTokens      int64        `json:"total_tokens"`
	Response         string       `json:"response,omitempty"`
	Stages           []TraceStage `json:"stages"`

	mu sync.Mutex `json:"-"`
}

// TraceSummary 列表摘要
type TraceSummary struct {
	RequestID        string `json:"request_id"`
	EID              int64  `json:"eid"`
	Model            string `json:"model"`
	OriginalQuery    string `json:"original_query"`
	StartedAt        int64  `json:"started_at"`
	DurationMs       int64  `json:"duration_ms"`
	StatusCode       int    `json:"status_code"`
	Status           string `json:"status"`
	PromptTokens     int64  `json:"prompt_tokens"`
	CompletionTokens int64  `json:"completion_tokens"`
	TotalTokens      int64  `json:"total_tokens"`
	StageCount       int    `json:"stage_count"`
}

// MemoryBuffer 本地内存环形缓冲区兜底，支持在无 Redis 时正常工作
type memoryTraceBuffer struct {
	mu      sync.RWMutex
	order   map[int64][]string    // eid -> list of requestIDs (newest first)
	details map[string]*ChatTrace // key: "eid:reqID" -> ChatTrace copy
	expires map[string]time.Time  // key: "eid:reqID" -> expire time
}

var localBuffer = &memoryTraceBuffer{
	order:   make(map[int64][]string),
	details: make(map[string]*ChatTrace),
	expires: make(map[string]time.Time),
}

func (mb *memoryTraceBuffer) Put(trace *ChatTrace) {
	if trace == nil || trace.EID <= 0 || strings.TrimSpace(trace.RequestID) == "" {
		return
	}
	mb.mu.Lock()
	defer mb.mu.Unlock()

	eid := trace.EID
	reqID := trace.RequestID
	key := fmt.Sprintf("%d:%s", eid, reqID)

	// 深拷贝一份放入内存，避免后续修改竞态
	bytes, err := json.Marshal(trace)
	if err != nil {
		return
	}
	var clone ChatTrace
	if err := json.Unmarshal(bytes, &clone); err != nil {
		return
	}

	mb.details[key] = &clone
	mb.expires[key] = time.Now().Add(TraceTTL)

	// 更新队列，去重后插入头部
	list := mb.order[eid]
	newList := make([]string, 0, len(list)+1)
	newList = append(newList, reqID)
	for _, id := range list {
		if id != reqID {
			newList = append(newList, id)
		}
	}
	// 超过最大容量时清理多余的
	if len(newList) > MaxTracesPerEID {
		for _, evictedID := range newList[MaxTracesPerEID:] {
			evictedKey := fmt.Sprintf("%d:%s", eid, evictedID)
			delete(mb.details, evictedKey)
			delete(mb.expires, evictedKey)
		}
		newList = newList[:MaxTracesPerEID]
	}
	mb.order[eid] = newList
}

func (mb *memoryTraceBuffer) List(eid int64) []TraceSummary {
	mb.mu.RLock()
	defer mb.mu.RUnlock()

	now := time.Now()
	reqIDs := mb.order[eid]
	summaries := make([]TraceSummary, 0, len(reqIDs))
	for _, reqID := range reqIDs {
		key := fmt.Sprintf("%d:%s", eid, reqID)
		exp, hasExp := mb.expires[key]
		if hasExp && now.After(exp) {
			continue
		}
		detail, ok := mb.details[key]
		if !ok || detail == nil {
			continue
		}
		summaries = append(summaries, TraceSummary{
			RequestID:        detail.RequestID,
			EID:              detail.EID,
			Model:            detail.Model,
			OriginalQuery:    detail.OriginalQuery,
			StartedAt:        detail.StartedAt,
			DurationMs:       detail.DurationMs,
			StatusCode:       detail.StatusCode,
			Status:           detail.Status,
			PromptTokens:     detail.PromptTokens,
			CompletionTokens: detail.CompletionTokens,
			TotalTokens:      detail.TotalTokens,
			StageCount:       len(detail.Stages),
		})
	}
	return summaries
}

func (mb *memoryTraceBuffer) Get(eid int64, reqID string) *ChatTrace {
	mb.mu.RLock()
	defer mb.mu.RUnlock()

	key := fmt.Sprintf("%d:%s", eid, reqID)
	exp, hasExp := mb.expires[key]
	if hasExp && time.Now().After(exp) {
		return nil
	}
	detail, ok := mb.details[key]
	if !ok || detail == nil {
		return nil
	}
	bytes, _ := json.Marshal(detail)
	var clone ChatTrace
	_ = json.Unmarshal(bytes, &clone)
	return &clone
}

// InitTrace 初始化 Trace 并注入 Context 和 Gin 上下文
func InitTrace(c *gin.Context, eid int64, requestID string) (context.Context, *ChatTrace) {
	trace := &ChatTrace{
		RequestID: strings.TrimSpace(requestID),
		EID:       eid,
		StartedAt: time.Now().UnixMilli(),
		Stages:    make([]TraceStage, 0, 8),
		Status:    "success",
	}
	if c != nil {
		c.Set(GinTraceKey, trace)
		if c.Request != nil {
			ctx := context.WithValue(c.Request.Context(), chatDebugContextKey{}, trace)
			c.Request = c.Request.WithContext(ctx)
			return ctx, trace
		}
	}
	return context.WithValue(context.Background(), chatDebugContextKey{}, trace), trace
}

// WithTrace 将 Trace 包装到指定的 Context 中
func WithTrace(ctx context.Context, trace *ChatTrace) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	if trace == nil {
		return ctx
	}
	return context.WithValue(ctx, chatDebugContextKey{}, trace)
}

// GetTrace 从 Context（或包含 Gin 上下文的 Context）获取 Trace
func GetTrace(ctx context.Context) *ChatTrace {
	if ctx == nil {
		return nil
	}
	if trace, ok := ctx.Value(chatDebugContextKey{}).(*ChatTrace); ok && trace != nil {
		return trace
	}
	if ginCtx, ok := ctx.(*gin.Context); ok && ginCtx != nil {
		return GetTraceFromGin(ginCtx)
	}
	return nil
}

// GetTraceFromGin 从 Gin.Context 获取 Trace
func GetTraceFromGin(c *gin.Context) *ChatTrace {
	if c == nil {
		return nil
	}
	if val, exists := c.Get(GinTraceKey); exists {
		if trace, ok := val.(*ChatTrace); ok && trace != nil {
			return trace
		}
	}
	if c.Request != nil {
		if trace, ok := c.Request.Context().Value(chatDebugContextKey{}).(*ChatTrace); ok && trace != nil {
			return trace
		}
	}
	return nil
}

// AddStage 添加通用阶段
func (t *ChatTrace) AddStage(stage TraceStage) {
	if t == nil {
		return
	}
	if stage.StartedAt == 0 {
		stage.StartedAt = time.Now().UnixMilli()
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	t.Stages = append(t.Stages, stage)
}

// SetSummary 设置请求汇总
func (t *ChatTrace) SetSummary(modelName string, statusCode int, durationMs int64, err error) {
	if t == nil {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	if modelName != "" {
		t.Model = modelName
	}
	if statusCode > 0 {
		t.StatusCode = statusCode
	}
	if durationMs > 0 {
		t.DurationMs = durationMs
	} else if t.StartedAt > 0 {
		t.DurationMs = time.Now().UnixMilli() - t.StartedAt
	}
	if err != nil {
		t.Status = "failed"
		t.Error = err.Error()
	}
}

// SetQuery 设置原始问题
func (t *ChatTrace) SetQuery(query string) {
	if t == nil {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	if query != "" {
		t.OriginalQuery = query
	}
}

// SetResponse 设置最终响应内容
func (t *ChatTrace) SetResponse(resp string) {
	if t == nil {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	if resp != "" {
		t.Response = resp
	}
}

// AddTokens 累加 Token 消耗
func (t *ChatTrace) AddTokens(prompt, completion, total int64) {
	if t == nil {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	t.PromptTokens += prompt
	t.CompletionTokens += completion
	t.TotalTokens += total
}

// RecordIntent 记录意图识别与范围缩小过程
func RecordIntent(ctx context.Context, intentReq *rag.IntentClassificationRequest, result *rag.IntentClassificationResult, candidateSkills interface{}, durationMs int64, err error) {
	trace := GetTrace(ctx)
	if trace == nil {
		return
	}

	now := time.Now().UnixMilli()
	startedAt := now
	if durationMs > 0 {
		startedAt = now - durationMs
	}

	stage := TraceStage{
		Stage:      "intent",
		Title:      "意图识别与范围缩小",
		Status:     "success",
		StartedAt:  startedAt,
		DurationMs: durationMs,
		Data:       make(map[string]interface{}),
	}
	if err != nil {
		stage.Status = "failed"
		stage.Error = err.Error()
	}

	if intentReq != nil {
		stage.Data["original_query"] = intentReq.Query
		if len(intentReq.Conversation) > 0 {
			stage.Data["history_turns"] = len(intentReq.Conversation)
		}
		if trace.OriginalQuery == "" && intentReq.Query != "" {
			trace.SetQuery(intentReq.Query)
		}
	}

	if result != nil {
		stage.Data["intent"] = result.Intent
		stage.Data["skill_name"] = result.SkillName
		stage.Data["confidence"] = result.Confidence
		stage.Data["reasoning"] = result.Reasoning
		stage.Data["normalized_query"] = result.NormalizedQuery
		stage.Data["keywords"] = result.Keywords
		stage.Data["expanded_queries"] = result.ExpandedQueries
		if result.Answer != "" {
			stage.Data["answer"] = result.Answer
		}
	}

	if candidateSkills != nil {
		stage.Data["candidate_skills"] = candidateSkills
	}

	trace.AddStage(stage)
}

// RecordRAG 记录知识库检索召回全过程（切片、打分、重排结果）
// RecordRAG 记录知识库检索与切片召回
func RecordRAG(ctx context.Context, query string, sources []rag.SourceReference, searchErrors []string, durationMs int64, retrievalObs map[string]interface{}, err error) {
	trace := GetTrace(ctx)
	if trace == nil {
		return
	}

	now := time.Now().UnixMilli()
	startedAt := now
	if durationMs > 0 {
		startedAt = now - durationMs
	}

	stage := TraceStage{
		Stage:      "rag",
		Title:      "知识库检索与切片召回",
		Status:     "success",
		StartedAt:  startedAt,
		DurationMs: durationMs,
		Data: map[string]interface{}{
			"query":          query,
			"selected_count": len(sources),
			"count":          len(sources),
		},
	}
	if err != nil {
		stage.Status = "failed"
		stage.Error = err.Error()
	}

	if len(retrievalObs) > 0 {
		stage.Data["retrieval_observability"] = retrievalObs
		if cfg, ok := retrievalObs["search_config"]; ok {
			stage.Data["search_config"] = cfg
		}
		if droppedRaw, ok := retrievalObs["dropped_sources"]; ok {
			var droppedList []map[string]interface{}
			switch d := droppedRaw.(type) {
			case []rag.SourceReference:
				for _, s := range d {
					sourceType := s.SourceType
					if sourceType == "" {
						if s.WikiPageID > 0 {
							sourceType = "wiki"
						} else {
							sourceType = "document"
						}
					}
					reason := "超出 TopK 截断"
					if s.RawScore > 0 && s.Score != s.RawScore {
						// Score 已被重排相关性终分覆盖（relay.rerankSources 回填），
						// 说明该切片经过重排打分但未入选。
						reason = "Rerank 排序靠后截断"
					}
					droppedList = append(droppedList, map[string]interface{}{
						"reference_id":        s.ReferenceID,
						"source_type":         sourceType,
						"chunk_id":            s.ChunkID,
						"file_id":             s.FileID,
						"file_name":           s.FileName,
						"file_path":           s.FilePath,
						"title":               s.Title,
						"knowledge_base_name": s.KnowledgeBaseName,
						"score":               s.Score,
						"raw_score":           s.RawScore,
						"source_rank":         s.SourceRank,
						"content":             s.Content,
						"reason":              reason,
					})
				}
			case []map[string]interface{}:
				droppedList = d
			}
			stage.Data["dropped_sources"] = droppedList
			stage.Data["dropped_count"] = len(droppedList)
		}
	}

	if len(searchErrors) > 0 {
		stage.Data["search_errors"] = searchErrors
	}
	items := make([]map[string]interface{}, 0, len(sources))
	for i, s := range sources {
		sourceType := s.SourceType
		if sourceType == "" {
			if s.WikiPageID > 0 {
				sourceType = "wiki"
			} else if s.EntityCount > 0 || s.Graph != nil {
				sourceType = "graph"
			} else {
				sourceType = "document"
			}
		}

		item := map[string]interface{}{
			"index":               i + 1,
			"source_rank":         s.SourceRank,
			"reference_id":        s.ReferenceID,
			"source_type":         sourceType,
			"chunk_type":          s.ChunkType,
			"chunk_id":            s.ChunkID,
			"file_id":             s.FileID,
			"file_name":           s.FileName,
			"file_path":           s.FilePath,
			"url":                 s.URL,
			"title":               s.Title,
			"knowledge_base_id":   s.KnowledgeBaseID,
			"knowledge_base_name": s.KnowledgeBaseName,
			"library_id":          s.LibraryID,
			"library_name":        s.LibraryName,
			"space_id":            s.SpaceID,
			"space_name":          s.SpaceName,
			"score":               s.Score,
			"raw_score":           s.RawScore,
			"fusion_score":        s.FusionScore,
			"content":             s.Content,
		}
		items = append(items, item)
	}
	stage.Data["sources"] = items

	trace.AddStage(stage)
}

// RecordTool 记录工具调用
func RecordTool(ctx context.Context, toolName string, args interface{}, result interface{}, durationMs int64, err error) {
	trace := GetTrace(ctx)
	if trace == nil {
		return
	}

	now := time.Now().UnixMilli()
	startedAt := now
	if durationMs > 0 {
		startedAt = now - durationMs
	}

	stage := TraceStage{
		Stage:      "tool",
		Title:      fmt.Sprintf("工具执行: %s", toolName),
		Status:     "success",
		StartedAt:  startedAt,
		DurationMs: durationMs,
		Data: map[string]interface{}{
			"tool_name": toolName,
			"arguments": args,
			"result":    result,
		},
	}
	if err != nil {
		stage.Status = "failed"
		stage.Error = err.Error()
	}

	trace.AddStage(stage)
}
// RecordLLM 记录大模型实际调用与响应
func RecordLLM(ctx context.Context, modelName string, prompt interface{}, response string, promptTokens, completionTokens int64, durationMs int64, err error, extraParams ...map[string]interface{}) {
	trace := GetTrace(ctx)
	if trace == nil {
		return
	}
	now := time.Now().UnixMilli()
	startedAt := now
	if durationMs > 0 {
		startedAt = now - durationMs
	}

	data := map[string]interface{}{
		"model":             modelName,
		"prompt":            prompt,
		"response":          response,
		"prompt_tokens":     promptTokens,
		"completion_tokens": completionTokens,
		"total_tokens":      promptTokens + completionTokens,
	}
	if len(extraParams) > 0 && extraParams[0] != nil {
		data["params"] = extraParams[0]
	}

	stage := TraceStage{
		Stage:      "llm",
		Title:      fmt.Sprintf("模型推理: %s", modelName),
		Status:     "success",
		StartedAt:  startedAt,
		DurationMs: durationMs,
		Data:       data,
	}
	if err != nil {
		stage.Status = "failed"
		stage.Error = err.Error()
	}

	trace.AddStage(stage)
	trace.AddTokens(promptTokens, completionTokens, promptTokens+completionTokens)
	if trace.Model == "" {
		trace.Model = modelName
	}
	if response != "" {
		trace.SetResponse(response)
	}
}

var (
	skRegex     = regexp.MustCompile(`(sk-[a-zA-Z0-9]{8})[a-zA-Z0-9]{12,}`)
	bearerRegex = regexp.MustCompile(`(?i)(bearer\s+[a-zA-Z0-9_\-\.]{6})[a-zA-Z0-9_\-\.]{14,}`)
)

func sanitizePayload(content string) string {
	content = skRegex.ReplaceAllString(content, "${1}****")
	content = bearerRegex.ReplaceAllString(content, "${1}****")
	return content
}

// FlushAsync 异步保存到本地内存与 Redis（每个企业保留最新 10 条，1小时 TTL）
func (t *ChatTrace) FlushAsync() {
	if t == nil {
		return
	}
	if t.EID <= 0 || strings.TrimSpace(t.RequestID) == "" {
		logger.SysWarn(fmt.Sprintf("【ChatDebug】Trace 未包含企业ID或请求ID，跳过落盘: eid=%d req=%s", t.EID, t.RequestID))
		return
	}

	// 补全总耗时
	if t.DurationMs <= 0 && t.StartedAt > 0 {
		t.DurationMs = time.Now().UnixMilli() - t.StartedAt
	}

	// 1. 同步深拷贝写入本地内存环形缓冲区，确保无 Redis 时亦能查询
	localBuffer.Put(t)

	// 2. 异步落盘至 Redis
	go func() {
		defer func() {
			if r := recover(); r != nil {
				logger.SysError(fmt.Sprintf("【ChatDebug】异步落盘异常: %v", r))
			}
		}()

		if !common.IsRedisEnabled() || common.RDB == nil {
			return
		}

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		bytes, err := json.Marshal(t)
		if err != nil {
			logger.SysError(fmt.Sprintf("【ChatDebug】序列化 Trace 失败: %v", err))
			return
		}

		sanitizedJSON := sanitizePayload(string(bytes))

		traceKey := fmt.Sprintf("%s%d:%s", ChatDebugTracePrefix, t.EID, t.RequestID)
		indexKey := fmt.Sprintf("%s%d", ChatDebugIndexPrefix, t.EID)

		pipe := common.RDB.Pipeline()

		// 保存详情，TTL 1 小时
		pipe.Set(ctx, traceKey, sanitizedJSON, TraceTTL)

		// 写入索引 ZSet，Score 为 StartedAt
		pipe.ZAdd(ctx, indexKey, &redis.Z{
			Score:  float64(t.StartedAt),
			Member: t.RequestID,
		})

		// 保持每个企业最多 10 条，裁剪超出范围的旧数据
		pipe.ZRemRangeByRank(ctx, indexKey, 0, -(MaxTracesPerEID + 1))

		// 索引键也设 1 小时 TTL
		pipe.Expire(ctx, indexKey, TraceTTL)

		if _, err := pipe.Exec(ctx); err != nil {
			logger.SysWarn(fmt.Sprintf("【ChatDebug】写入 Redis 失败: eid=%d, req=%s, err=%v", t.EID, t.RequestID, err))
		}
	}()
}

// ListTraces 获取企业最近的 Trace 列表（优先 Redis，降级内存缓冲区）
func ListTraces(ctx context.Context, eid int64) ([]TraceSummary, error) {
	if eid <= 0 {
		return []TraceSummary{}, nil
	}

	// 1. 尝试从 Redis 读取
	if common.IsRedisEnabled() && common.RDB != nil {
		indexKey := fmt.Sprintf("%s%d", ChatDebugIndexPrefix, eid)
		reqIDs, err := common.RDB.ZRevRange(ctx, indexKey, 0, MaxTracesPerEID-1).Result()
		if err == nil && len(reqIDs) > 0 {
			summaries := make([]TraceSummary, 0, len(reqIDs))
			for _, reqID := range reqIDs {
				traceKey := fmt.Sprintf("%s%d:%s", ChatDebugTracePrefix, eid, reqID)
				val, getErr := common.RDB.Get(ctx, traceKey).Result()
				if getErr != nil {
					continue
				}
				var trace ChatTrace
				if err := json.Unmarshal([]byte(val), &trace); err == nil {
					summaries = append(summaries, TraceSummary{
						RequestID:        trace.RequestID,
						EID:              trace.EID,
						Model:            trace.Model,
						OriginalQuery:    trace.OriginalQuery,
						StartedAt:        trace.StartedAt,
						DurationMs:       trace.DurationMs,
						StatusCode:       trace.StatusCode,
						Status:           trace.Status,
						PromptTokens:     trace.PromptTokens,
						CompletionTokens: trace.CompletionTokens,
						TotalTokens:      trace.TotalTokens,
						StageCount:       len(trace.Stages),
					})
				}
			}
			if len(summaries) > 0 {
				return summaries, nil
			}
		}
	}

	// 2. 降级从本地内存缓冲区获取
	return localBuffer.List(eid), nil
}

// GetTraceDetail 获取单个 Trace 详情（优先 Redis，降级内存缓冲区）
func GetTraceDetail(ctx context.Context, eid int64, requestID string) (*ChatTrace, error) {
	if eid <= 0 || strings.TrimSpace(requestID) == "" {
		return nil, nil
	}

	// 1. 尝试从 Redis 读取
	if common.IsRedisEnabled() && common.RDB != nil {
		traceKey := fmt.Sprintf("%s%d:%s", ChatDebugTracePrefix, eid, requestID)
		val, err := common.RDB.Get(ctx, traceKey).Result()
		if err == nil {
			var trace ChatTrace
			if err := json.Unmarshal([]byte(val), &trace); err == nil {
				return &trace, nil
			}
		}
	}

	// 2. 降级从本地内存缓冲区获取
	return localBuffer.Get(eid, requestID), nil
}
