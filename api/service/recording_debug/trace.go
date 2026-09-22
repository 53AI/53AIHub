package recordingdebug

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
	"github.com/go-redis/redis/v8"
)

const (
	RecordingDebugIndexPrefix = "RecordingDebug:Index:"
	RecordingDebugTracePrefix = "RecordingDebug:Trace:"
	MaxTracesPerEID           = 20
	TraceTTL                  = 24 * time.Hour
)

type contextKey struct{}
type llmStageKey struct{}

type TraceStage struct {
	Stage      string                 `json:"stage"`
	Title      string                 `json:"title"`
	Status     string                 `json:"status"`
	StartedAt  int64                  `json:"started_at"`
	DurationMs int64                  `json:"duration_ms"`
	Data       map[string]interface{} `json:"data,omitempty"`
	Error      string                 `json:"error,omitempty"`
}

type Trace struct {
	RequestID  string       `json:"request_id"`
	EID        int64        `json:"eid"`
	FileID     int64        `json:"file_id"`
	Generation int64        `json:"generation"`
	FileName   string       `json:"file_name,omitempty"`
	StartedAt  int64        `json:"started_at"`
	DurationMs int64        `json:"duration_ms"`
	Status     string       `json:"status"`
	Error      string       `json:"error,omitempty"`
	Stages     []TraceStage `json:"stages"`

	mu       sync.Mutex `json:"-"`
	finished bool       `json:"-"`
}

type TraceSummary struct {
	RequestID  string `json:"request_id"`
	EID        int64  `json:"eid"`
	FileID     int64  `json:"file_id"`
	Generation int64  `json:"generation"`
	FileName   string `json:"file_name,omitempty"`
	StartedAt  int64  `json:"started_at"`
	DurationMs int64  `json:"duration_ms"`
	Status     string `json:"status"`
	Error      string `json:"error,omitempty"`
	StageCount int    `json:"stage_count"`
}

type memoryTraceBuffer struct {
	mu      sync.RWMutex
	order   map[int64][]string
	details map[string]*Trace
	expires map[string]time.Time
}

var localBuffer = &memoryTraceBuffer{
	order:   make(map[int64][]string),
	details: make(map[string]*Trace),
	expires: make(map[string]time.Time),
}

func NewTrace(eid, fileID, generation int64, fileName string) *Trace {
	return &Trace{
		RequestID:  fmt.Sprintf("recording-%d-%d-%d", fileID, generation, time.Now().UnixNano()),
		EID:        eid,
		FileID:     fileID,
		Generation: generation,
		FileName:   strings.TrimSpace(fileName),
		StartedAt:  time.Now().UnixMilli(),
		Status:     "running",
		Stages:     make([]TraceStage, 0, 16),
	}
}

func EnsureTrace(ctx context.Context, eid, fileID, generation int64, fileName string) (context.Context, *Trace, bool) {
	if trace := GetTrace(ctx); trace != nil {
		return WithTrace(ctx, trace), trace, false
	}
	trace := NewTrace(eid, fileID, generation, fileName)
	return WithTrace(ctx, trace), trace, true
}

func WithTrace(ctx context.Context, trace *Trace) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	if trace == nil {
		return ctx
	}
	return context.WithValue(ctx, contextKey{}, trace)
}

func GetTrace(ctx context.Context) *Trace {
	if ctx == nil {
		return nil
	}
	trace, _ := ctx.Value(contextKey{}).(*Trace)
	return trace
}

func WithLLMStage(ctx context.Context, stage string) context.Context {
	return context.WithValue(ctx, llmStageKey{}, strings.TrimSpace(stage))
}

func LLMStage(ctx context.Context, fallback string) string {
	if ctx != nil {
		if stage, _ := ctx.Value(llmStageKey{}).(string); stage != "" {
			return stage
		}
	}
	return fallback
}

func (t *Trace) AddStage(stage TraceStage) {
	if t == nil {
		return
	}
	if stage.StartedAt == 0 {
		stage.StartedAt = time.Now().UnixMilli()
	}
	t.mu.Lock()
	t.Stages = append(t.Stages, stage)
	t.mu.Unlock()
}

func RecordStage(ctx context.Context, stage, title, status string, startedAt time.Time, data map[string]interface{}, err error) {
	trace := GetTrace(ctx)
	if trace == nil {
		return
	}
	if status == "" {
		status = "success"
	}
	if err != nil {
		status = "failed"
	}
	if startedAt.IsZero() {
		startedAt = time.Now()
	}
	duration := time.Since(startedAt).Milliseconds()
	trace.AddStage(TraceStage{
		Stage:      stage,
		Title:      title,
		Status:     status,
		StartedAt:  startedAt.UnixMilli(),
		DurationMs: duration,
		Data:       cloneData(data),
		Error:      errorText(err),
	})
}

func RecordLLM(ctx context.Context, stage, modelName string, prompt interface{}, response string, durationMs int64, attempt int, err error) {
	data := map[string]interface{}{
		"model":        modelName,
		"attempt":      attempt,
		"prompt":       prompt,
		"response":     limitText(response),
		"response_len": len([]rune(response)),
	}
	RecordStageAt(ctx, stage, llmTitle(stage), "success", time.Now().Add(-time.Duration(durationMs)*time.Millisecond), durationMs, data, err)
}

func llmTitle(stage string) string {
	switch stage {
	case "meeting_minutes_llm":
		return "Prompt 2 · 生成会议纪要"
	case "entity_memory_llm":
		return "Prompt 2 · 提取结构化记忆"
	case "transcript_compression_llm":
		return "转写压缩模型调用"
	case "insight_perspective_llm":
		return "洞察视角分类器"
	case "insights_llm":
		return "Prompt 4 · 生成决策洞察"
	case "insight_page_llm":
		return "Prompt 5 · 编排洞察页面"
	default:
		return "模型调用 · " + stage
	}
}

func RecordStageAt(ctx context.Context, stage, title, status string, startedAt time.Time, durationMs int64, data map[string]interface{}, err error) {
	trace := GetTrace(ctx)
	if trace == nil {
		return
	}
	if status == "" {
		status = "success"
	}
	if err != nil {
		status = "failed"
	}
	trace.AddStage(TraceStage{
		Stage:      stage,
		Title:      title,
		Status:     status,
		StartedAt:  startedAt.UnixMilli(),
		DurationMs: durationMs,
		Data:       cloneData(data),
		Error:      errorText(err),
	})
}

func (t *Trace) Finish(status string, err error) {
	if t == nil {
		return
	}
	t.mu.Lock()
	if t.finished {
		t.mu.Unlock()
		return
	}
	t.finished = true
	if status == "" {
		status = "success"
	}
	if err != nil {
		status = "failed"
		t.Error = errorText(err)
	}
	t.Status = status
	t.DurationMs = time.Now().UnixMilli() - t.StartedAt
	t.mu.Unlock()
	t.FlushAsync()
}

func (t *Trace) FlushAsync() {
	if t == nil || t.EID <= 0 || t.FileID <= 0 {
		return
	}
	snapshot := snapshot(t)
	if snapshot == nil {
		return
	}
	localBuffer.Put(snapshot)

	go func() {
		if !common.IsRedisEnabled() || common.RDB == nil {
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		payload, err := json.Marshal(snapshot)
		if err != nil {
			return
		}
		traceKey := fmt.Sprintf("%s%d:%s", RecordingDebugTracePrefix, snapshot.EID, snapshot.RequestID)
		indexKey := fmt.Sprintf("%s%d", RecordingDebugIndexPrefix, snapshot.EID)
		pipe := common.RDB.Pipeline()
		pipe.Set(ctx, traceKey, sanitizePayload(string(payload)), TraceTTL)
		pipe.ZAdd(ctx, indexKey, &redis.Z{Score: float64(snapshot.StartedAt), Member: snapshot.RequestID})
		pipe.ZRemRangeByRank(ctx, indexKey, 0, -(MaxTracesPerEID + 1))
		pipe.Expire(ctx, indexKey, TraceTTL)
		if _, err := pipe.Exec(ctx); err != nil {
			logger.SysWarn(fmt.Sprintf("【RecordingDebug】写入 Redis 失败: eid=%d fileID=%d err=%v", snapshot.EID, snapshot.FileID, err))
		}
	}()
}

func ListTraces(ctx context.Context, eid int64) ([]TraceSummary, error) {
	if eid <= 0 {
		return []TraceSummary{}, nil
	}
	if common.IsRedisEnabled() && common.RDB != nil {
		indexKey := fmt.Sprintf("%s%d", RecordingDebugIndexPrefix, eid)
		requestIDs, err := common.RDB.ZRevRange(ctx, indexKey, 0, MaxTracesPerEID-1).Result()
		if err == nil && len(requestIDs) > 0 {
			result := make([]TraceSummary, 0, len(requestIDs))
			for _, requestID := range requestIDs {
				traceKey := fmt.Sprintf("%s%d:%s", RecordingDebugTracePrefix, eid, requestID)
				payload, getErr := common.RDB.Get(ctx, traceKey).Result()
				if getErr != nil {
					continue
				}
				var trace Trace
				if json.Unmarshal([]byte(payload), &trace) == nil {
					result = append(result, trace.Summary())
				}
			}
			if len(result) > 0 {
				return result, nil
			}
		}
	}
	return localBuffer.List(eid), nil
}

func GetTraceDetail(ctx context.Context, eid int64, requestID string) (*Trace, error) {
	if eid <= 0 || strings.TrimSpace(requestID) == "" {
		return nil, nil
	}
	if common.IsRedisEnabled() && common.RDB != nil {
		traceKey := fmt.Sprintf("%s%d:%s", RecordingDebugTracePrefix, eid, requestID)
		if payload, err := common.RDB.Get(ctx, traceKey).Result(); err == nil {
			var trace Trace
			if json.Unmarshal([]byte(payload), &trace) == nil {
				return &trace, nil
			}
		}
	}
	return localBuffer.Get(eid, requestID), nil
}

func (t *Trace) Summary() TraceSummary {
	if t == nil {
		return TraceSummary{}
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	return TraceSummary{
		RequestID:  t.RequestID,
		EID:        t.EID,
		FileID:     t.FileID,
		Generation: t.Generation,
		FileName:   t.FileName,
		StartedAt:  t.StartedAt,
		DurationMs: t.DurationMs,
		Status:     t.Status,
		Error:      t.Error,
		StageCount: len(t.Stages),
	}
}

func (mb *memoryTraceBuffer) Put(trace *Trace) {
	if trace == nil || trace.EID <= 0 || trace.RequestID == "" {
		return
	}
	mb.mu.Lock()
	defer mb.mu.Unlock()
	key := traceKey(trace.EID, trace.RequestID)
	mb.details[key] = snapshot(trace)
	mb.expires[key] = time.Now().Add(TraceTTL)
	ids := append([]string{trace.RequestID}, mb.order[trace.EID]...)
	filtered := ids[:0]
	seen := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		filtered = append(filtered, id)
	}
	if len(filtered) > MaxTracesPerEID {
		for _, id := range filtered[MaxTracesPerEID:] {
			delete(mb.details, traceKey(trace.EID, id))
			delete(mb.expires, traceKey(trace.EID, id))
		}
		filtered = filtered[:MaxTracesPerEID]
	}
	mb.order[trace.EID] = filtered
}

func (mb *memoryTraceBuffer) List(eid int64) []TraceSummary {
	mb.mu.RLock()
	defer mb.mu.RUnlock()
	now := time.Now()
	result := make([]TraceSummary, 0, len(mb.order[eid]))
	for _, requestID := range mb.order[eid] {
		key := traceKey(eid, requestID)
		if expiry, ok := mb.expires[key]; ok && now.After(expiry) {
			continue
		}
		if trace := mb.details[key]; trace != nil {
			result = append(result, trace.Summary())
		}
	}
	return result
}

func (mb *memoryTraceBuffer) Get(eid int64, requestID string) *Trace {
	mb.mu.RLock()
	defer mb.mu.RUnlock()
	key := traceKey(eid, requestID)
	if expiry, ok := mb.expires[key]; ok && time.Now().After(expiry) {
		return nil
	}
	return snapshot(mb.details[key])
}

func traceKey(eid int64, requestID string) string {
	return fmt.Sprintf("%d:%s", eid, requestID)
}

func snapshot(trace *Trace) *Trace {
	if trace == nil {
		return nil
	}
	trace.mu.Lock()
	defer trace.mu.Unlock()
	payload, err := json.Marshal(trace)
	if err != nil {
		return nil
	}
	payload = []byte(sanitizePayload(string(payload)))
	var clone Trace
	if json.Unmarshal(payload, &clone) != nil {
		return nil
	}
	return &clone
}

func cloneData(data map[string]interface{}) map[string]interface{} {
	if len(data) == 0 {
		return nil
	}
	payload, err := json.Marshal(data)
	if err != nil {
		return map[string]interface{}{"value": limitText(fmt.Sprint(data))}
	}
	var clone map[string]interface{}
	if json.Unmarshal(payload, &clone) != nil {
		return map[string]interface{}{"value": limitText(string(payload))}
	}
	return clone
}

func limitText(value string) string {
	const maxRunes = 120000
	runes := []rune(value)
	if len(runes) <= maxRunes {
		return value
	}
	return string(runes[:maxRunes]) + "\n…[调试内容已截断]"
}

func errorText(err error) string {
	if err == nil {
		return ""
	}
	return limitText(err.Error())
}

var (
	skRegex     = regexp.MustCompile(`(sk-[a-zA-Z0-9]{8})[a-zA-Z0-9]{12,}`)
	bearerRegex = regexp.MustCompile(`(?i)(bearer\s+[a-zA-Z0-9_\-\.]{6})[a-zA-Z0-9_\-\.]{14,}`)
)

func sanitizePayload(payload string) string {
	payload = skRegex.ReplaceAllString(payload, "${1}****")
	return bearerRegex.ReplaceAllString(payload, "${1}****")
}
