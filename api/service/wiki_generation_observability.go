package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/go-redis/redis/v8"
)

const (
	wikiGenerationObservabilityRetention = 24 * time.Hour
	wikiGenerationObservabilityActiveTTL = 30 * time.Minute
	wikiGenerationObservabilityMaxErrors = 100
	wikiGenerationObservabilityMaxEvents = 200
)

type wikiGenerationContextKey struct{}

type wikiGenerationContext struct {
	Eid     int64
	FileID  int64
	JobID   int64
	TraceID string
	Title   string
}

type WikiGenerationObservation struct {
	Eid              int64
	FileID           int64
	JobID            int64
	TraceID          string
	Title            string
	Phase            string
	Status           string
	Reason           string
	Category         string
	Slug             string
	Error            string
	DurationMs       int64
	LLMCalls         int64
	PromptTokens     int64
	CompletionTokens int64
	TotalTokens      int64
	Candidates       int64
	Entities         int64
	Concepts         int64
	CategoryMatched  int64
	PagesSucceeded   int64
	PagesFailed      int64
	Data             map[string]interface{}
}

type WikiGenerationTraceEvent struct {
	Time       int64                  `json:"time"`
	TraceID    string                 `json:"trace_id"`
	FileID     int64                  `json:"file_id"`
	JobID      int64                  `json:"job_id"`
	Title      string                 `json:"title,omitempty"`
	Phase      string                 `json:"phase"`
	Status     string                 `json:"status"`
	Reason     string                 `json:"reason,omitempty"`
	DurationMs int64                  `json:"duration_ms,omitempty"`
	Counters   map[string]int64       `json:"counters,omitempty"`
	Data       map[string]interface{} `json:"data,omitempty"`
	Error      string                 `json:"error,omitempty"`
}

type WikiGenerationFileSummary struct {
	FileID           int64  `json:"file_id"`
	JobID            int64  `json:"job_id"`
	TraceID          string `json:"trace_id"`
	Title            string `json:"title"`
	Status           string `json:"status"`
	Phase            string `json:"phase"`
	TerminalReason   string `json:"terminal_reason,omitempty"`
	StartedAt        int64  `json:"started_at"`
	UpdatedAt        int64  `json:"updated_at"`
	DurationMs       int64  `json:"duration_ms"`
	Candidates       int64  `json:"candidates"`
	Entities         int64  `json:"entities"`
	Concepts         int64  `json:"concepts"`
	CategoryMatched  int64  `json:"category_matched"`
	PagesSucceeded   int64  `json:"pages_succeeded"`
	PagesFailed      int64  `json:"pages_failed"`
	LLMCalls         int64  `json:"llm_calls"`
	PromptTokens     int64  `json:"prompt_tokens"`
	CompletionTokens int64  `json:"completion_tokens"`
	TotalTokens      int64  `json:"total_tokens"`
}

type WikiGenerationFailure struct {
	Time     int64  `json:"time"`
	FileID   int64  `json:"file_id"`
	JobID    int64  `json:"job_id"`
	Phase    string `json:"phase"`
	Category string `json:"category,omitempty"`
	Slug     string `json:"slug,omitempty"`
	Error    string `json:"error"`
}

type WikiGenerationPhaseStats struct {
	Events    int64 `json:"events"`
	Succeeded int64 `json:"succeeded"`
	Failed    int64 `json:"failed"`
	Duration  int64 `json:"duration_ms"`
}

type WikiGenerationObservationSnapshot struct {
	Stats           map[string]int64
	Phases          map[string]WikiGenerationPhaseStats
	CategoryMatches map[string]int64
	Failures        []WikiGenerationFailure
	Active          []map[string]interface{}
}

func errorText(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

func withWikiGenerationContext(ctx context.Context, observation WikiGenerationObservation) context.Context {
	return context.WithValue(ctx, wikiGenerationContextKey{}, wikiGenerationContext{Eid: observation.Eid, FileID: observation.FileID, JobID: observation.JobID, TraceID: observation.TraceID, Title: observation.Title})
}

func applyWikiGenerationContext(ctx context.Context, observation *WikiGenerationObservation) {
	value, ok := ctx.Value(wikiGenerationContextKey{}).(wikiGenerationContext)
	if !ok {
		return
	}
	if observation.Eid == 0 {
		observation.Eid = value.Eid
	}
	if observation.FileID == 0 {
		observation.FileID = value.FileID
	}
	if observation.JobID == 0 {
		observation.JobID = value.JobID
	}
	if observation.TraceID == "" {
		observation.TraceID = value.TraceID
	}
	if observation.Title == "" {
		observation.Title = value.Title
	}
}

func wikiGenerationStatsKey(eid int64, date string) string {
	return fmt.Sprintf("rag:wiki:obs:%d:stats:%s", eid, date)
}

func wikiGenerationPhaseKey(eid int64, date string) string {
	return fmt.Sprintf("rag:wiki:obs:%d:phases:%s", eid, date)
}

func wikiGenerationFailuresKey(eid int64) string {
	return fmt.Sprintf("rag:wiki:obs:%d:failures", eid)
}

func wikiGenerationCategoryKey(eid int64, date string) string {
	return fmt.Sprintf("rag:wiki:obs:%d:categories:%s", eid, date)
}

func wikiGenerationFileIndexKey(eid int64) string {
	return fmt.Sprintf("rag:wiki:trace:%d:files", eid)
}

func wikiGenerationFileKey(eid, fileID int64) string {
	return fmt.Sprintf("rag:wiki:trace:%d:file:%d", eid, fileID)
}

func wikiGenerationEventsKey(eid, fileID int64) string {
	return fmt.Sprintf("rag:wiki:trace:%d:file:%d:events", eid, fileID)
}

func wikiGenerationActiveKey(eid, jobID int64) string {
	return fmt.Sprintf("rag:wiki:obs:%d:active:%d", eid, jobID)
}

func wikiGenerationActiveSetKey(eid int64) string {
	return fmt.Sprintf("rag:wiki:obs:%d:active_set", eid)
}

func recordWikiGenerationObservation(ctx context.Context, observation WikiGenerationObservation) {
	applyWikiGenerationContext(ctx, &observation)
	if observation.Eid <= 0 || common.RDB == nil {
		return
	}
	phase := strings.TrimSpace(observation.Phase)
	if phase == "" {
		phase = "unknown"
	}
	date := time.Now().Format("2006-01-02")
	now := time.Now()
	traceID := strings.TrimSpace(observation.TraceID)
	if traceID == "" {
		traceID = fmt.Sprintf("file-%d-job-%d", observation.FileID, observation.JobID)
	}
	statsKey := wikiGenerationStatsKey(observation.Eid, date)
	phaseKey := wikiGenerationPhaseKey(observation.Eid, date)
	categoryKey := wikiGenerationCategoryKey(observation.Eid, date)
	pipe := common.RDB.Pipeline()
	recordWikiGenerationTrace(pipe, ctx, observation, traceID, now)
	pipe.HIncrBy(ctx, statsKey, "events", 1)
	pipe.HIncrBy(ctx, statsKey, "duration_ms", observation.DurationMs)
	pipe.HIncrBy(ctx, statsKey, "llm_calls", observation.LLMCalls)
	pipe.HIncrBy(ctx, statsKey, "prompt_tokens", observation.PromptTokens)
	pipe.HIncrBy(ctx, statsKey, "completion_tokens", observation.CompletionTokens)
	pipe.HIncrBy(ctx, statsKey, "total_tokens", observation.TotalTokens)
	pipe.HIncrBy(ctx, statsKey, "candidates", observation.Candidates)
	pipe.HIncrBy(ctx, statsKey, "entities", observation.Entities)
	pipe.HIncrBy(ctx, statsKey, "concepts", observation.Concepts)
	pipe.HIncrBy(ctx, statsKey, "category_matched", observation.CategoryMatched)
	pipe.HIncrBy(ctx, statsKey, "pages_succeeded", observation.PagesSucceeded)
	pipe.HIncrBy(ctx, statsKey, "pages_failed", observation.PagesFailed)
	if strings.EqualFold(observation.Status, "failed") {
		pipe.HIncrBy(ctx, statsKey, "failed", 1)
	} else if strings.EqualFold(observation.Status, "success") {
		pipe.HIncrBy(ctx, statsKey, "succeeded", 1)
	}
	pipe.Expire(ctx, statsKey, wikiGenerationObservabilityRetention)
	pipe.HIncrBy(ctx, phaseKey, phase+":events", 1)
	pipe.HIncrBy(ctx, phaseKey, phase+":duration_ms", observation.DurationMs)
	if strings.EqualFold(observation.Status, "failed") {
		pipe.HIncrBy(ctx, phaseKey, phase+":failed", 1)
	}
	if strings.EqualFold(observation.Status, "success") {
		pipe.HIncrBy(ctx, phaseKey, phase+":succeeded", 1)
	}
	pipe.Expire(ctx, phaseKey, wikiGenerationObservabilityRetention)
	if strings.TrimSpace(observation.Category) != "" {
		pipe.HIncrBy(ctx, categoryKey, observation.Category, observation.CategoryMatched)
		pipe.Expire(ctx, categoryKey, wikiGenerationObservabilityRetention)
	}

	if observation.JobID > 0 {
		activeKey := wikiGenerationActiveKey(observation.Eid, observation.JobID)
		if strings.EqualFold(observation.Status, "started") || strings.EqualFold(observation.Status, "processing") {
			payload, _ := json.Marshal(map[string]interface{}{"file_id": observation.FileID, "job_id": observation.JobID, "phase": phase, "category": observation.Category, "slug": observation.Slug, "started_at": now.UnixMilli()})
			pipe.Set(ctx, activeKey, payload, wikiGenerationObservabilityActiveTTL)
			pipe.SAdd(ctx, wikiGenerationActiveSetKey(observation.Eid), observation.JobID)
			pipe.Expire(ctx, wikiGenerationActiveSetKey(observation.Eid), wikiGenerationObservabilityActiveTTL)
		} else if strings.EqualFold(observation.Status, "success") || strings.EqualFold(observation.Status, "failed") {
			pipe.Del(ctx, activeKey)
			pipe.SRem(ctx, wikiGenerationActiveSetKey(observation.Eid), observation.JobID)
		}
	}
	if strings.EqualFold(observation.Status, "failed") && strings.TrimSpace(observation.Error) != "" {
		failure, _ := json.Marshal(WikiGenerationFailure{Time: time.Now().UnixMilli(), FileID: observation.FileID, JobID: observation.JobID, Phase: phase, Category: observation.Category, Slug: observation.Slug, Error: observation.Error})
		pipe.LPush(ctx, wikiGenerationFailuresKey(observation.Eid), failure)
		pipe.LTrim(ctx, wikiGenerationFailuresKey(observation.Eid), 0, wikiGenerationObservabilityMaxErrors-1)
		pipe.Expire(ctx, wikiGenerationFailuresKey(observation.Eid), wikiGenerationObservabilityRetention)
	}
	if _, err := pipe.Exec(ctx); err != nil {
		logger.Warnf(ctx, "【Wiki生成】 phase=observability Wiki 观测写入失败: eid=%d file_id=%d err=%v", observation.Eid, observation.FileID, err)
	}
}

func recordWikiGenerationTrace(pipe redis.Pipeliner, ctx context.Context, observation WikiGenerationObservation, traceID string, now time.Time) {
	if observation.FileID <= 0 {
		return
	}
	counters := map[string]int64{"candidates": observation.Candidates, "entities": observation.Entities, "concepts": observation.Concepts, "category_matched": observation.CategoryMatched, "pages_succeeded": observation.PagesSucceeded, "pages_failed": observation.PagesFailed}
	data := truncateWikiObservationData(observation.Data)
	if observation.Category != "" || observation.Slug != "" {
		if data == nil {
			data = map[string]interface{}{}
		}
		if observation.Category != "" {
			data["category"] = observation.Category
		}
		if observation.Slug != "" {
			data["slug"] = observation.Slug
		}
	}
	event := WikiGenerationTraceEvent{Time: now.UnixMilli(), TraceID: traceID, FileID: observation.FileID, JobID: observation.JobID, Title: observation.Title, Phase: strings.TrimSpace(observation.Phase), Status: observation.Status, Reason: observation.Reason, DurationMs: observation.DurationMs, Counters: counters, Data: data, Error: observation.Error}
	payload, _ := json.Marshal(event)
	eventsKey := wikiGenerationEventsKey(observation.Eid, observation.FileID)
	fileKey := wikiGenerationFileKey(observation.Eid, observation.FileID)
	pipe.RPush(ctx, eventsKey, payload)
	pipe.LTrim(ctx, eventsKey, -wikiGenerationObservabilityMaxEvents, -1)
	pipe.Expire(ctx, eventsKey, wikiGenerationObservabilityRetention)
	pipe.ZAdd(ctx, wikiGenerationFileIndexKey(observation.Eid), &redis.Z{Score: float64(now.UnixMilli()), Member: observation.FileID})
	pipe.Expire(ctx, wikiGenerationFileIndexKey(observation.Eid), wikiGenerationObservabilityRetention)
	pipe.HSet(ctx, fileKey, "file_id", observation.FileID, "job_id", observation.JobID, "trace_id", traceID, "phase", event.Phase, "updated_at", now.UnixMilli())
	if event.Phase == "process" && strings.EqualFold(observation.Status, "success") {
		pipe.HSet(ctx, fileKey, "duration_ms", observation.DurationMs)
	}
	if strings.TrimSpace(observation.Title) != "" {
		pipe.HSet(ctx, fileKey, "title", observation.Title)
	}
	if observation.Status == "started" && event.Phase == "process" {
		pipe.HSet(ctx, fileKey, "status", "running", "started_at", now.UnixMilli())
	} else if observation.Status == "failed" || (observation.Status == "success" && event.Phase == "process") {
		pipe.HSet(ctx, fileKey, "status", observation.Status)
		if observation.Reason != "" || observation.Error != "" {
			pipe.HSet(ctx, fileKey, "reason", firstWikiTraceText(observation.Reason, observation.Error))
		} else if observation.Status == "success" && event.Phase == "process" {
			pipe.HSet(ctx, fileKey, "reason", "生成完成")
		}
	}
	for name, value := range counters {
		if value != 0 {
			pipe.HIncrBy(ctx, fileKey, name, value)
		}
	}
	fileCounters := map[string]int64{"llm_calls": observation.LLMCalls, "prompt_tokens": observation.PromptTokens, "completion_tokens": observation.CompletionTokens, "total_tokens": observation.TotalTokens}
	for name, value := range fileCounters {
		if value != 0 {
			pipe.HIncrBy(ctx, fileKey, name, value)
		}
	}
	pipe.Expire(ctx, fileKey, wikiGenerationObservabilityRetention)
}

func truncateWikiObservationData(data map[string]interface{}) map[string]interface{} {
	if len(data) == 0 {
		return nil
	}
	encoded, err := json.Marshal(data)
	if err != nil || len(encoded) <= 4096 {
		return data
	}
	return map[string]interface{}{"truncated": true, "preview": string(encoded[:4096])}
}

func firstWikiTraceText(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func loadWikiGenerationObservation(ctx context.Context, eid int64) (WikiGenerationObservationSnapshot, error) {
	snapshot := WikiGenerationObservationSnapshot{Stats: map[string]int64{}, Phases: map[string]WikiGenerationPhaseStats{}, CategoryMatches: map[string]int64{}, Failures: []WikiGenerationFailure{}, Active: []map[string]interface{}{}}
	if eid <= 0 || common.RDB == nil {
		return snapshot, nil
	}
	date := time.Now().Format("2006-01-02")
	stats, err := common.RDB.HGetAll(ctx, wikiGenerationStatsKey(eid, date)).Result()
	if err != nil {
		return snapshot, err
	}
	for key, value := range stats {
		var n int64
		if _, scanErr := fmt.Sscan(value, &n); scanErr == nil {
			snapshot.Stats[key] = n
		}
	}
	phases, err := common.RDB.HGetAll(ctx, wikiGenerationPhaseKey(eid, date)).Result()
	if err != nil {
		return snapshot, err
	}
	for key, value := range phases {
		parts := strings.SplitN(key, ":", 2)
		if len(parts) != 2 {
			continue
		}
		var n int64
		if _, scanErr := fmt.Sscan(value, &n); scanErr != nil {
			continue
		}
		phase := snapshot.Phases[parts[0]]
		switch parts[1] {
		case "events":
			phase.Events = n
		case "succeeded":
			phase.Succeeded = n
		case "failed":
			phase.Failed = n
		case "duration_ms":
			phase.Duration = n
		}
		snapshot.Phases[parts[0]] = phase
	}
	categories, err := common.RDB.HGetAll(ctx, wikiGenerationCategoryKey(eid, date)).Result()
	if err != nil {
		return snapshot, err
	}
	for category, value := range categories {
		if n, scanErr := strconv.ParseInt(value, 10, 64); scanErr == nil {
			snapshot.CategoryMatches[category] = n
		}
	}
	failureValues, err := common.RDB.LRange(ctx, wikiGenerationFailuresKey(eid), 0, wikiGenerationObservabilityMaxErrors-1).Result()
	if err != nil && err != redis.Nil {
		return snapshot, err
	}
	for _, value := range failureValues {
		var failure WikiGenerationFailure
		if json.Unmarshal([]byte(value), &failure) == nil {
			snapshot.Failures = append(snapshot.Failures, failure)
		}
	}
	jobIDs, err := common.RDB.SMembers(ctx, wikiGenerationActiveSetKey(eid)).Result()
	if err != nil && err != redis.Nil {
		return snapshot, err
	}
	for _, jobID := range jobIDs {
		value, getErr := common.RDB.Get(ctx, wikiGenerationActiveKey(eid, mustParseInt64(jobID))).Result()
		if getErr != nil {
			continue
		}
		var active map[string]interface{}
		if json.Unmarshal([]byte(value), &active) == nil {
			snapshot.Active = append(snapshot.Active, active)
		}
	}
	return snapshot, nil
}

// LoadWikiGenerationObservation 返回 Wiki 生成最近 24 小时内的观测快照。
func LoadWikiGenerationObservation(ctx context.Context, eid int64) (WikiGenerationObservationSnapshot, error) {
	return loadWikiGenerationObservation(ctx, eid)
}

func ListWikiGenerationFiles(ctx context.Context, eid int64) ([]WikiGenerationFileSummary, error) {
	if eid <= 0 || common.RDB == nil {
		return []WikiGenerationFileSummary{}, nil
	}
	ids, err := common.RDB.ZRevRange(ctx, wikiGenerationFileIndexKey(eid), 0, wikiGenerationObservabilityMaxEvents-1).Result()
	if err != nil && err != redis.Nil {
		return nil, err
	}
	files := make([]WikiGenerationFileSummary, 0, len(ids))
	for _, value := range ids {
		fileID := mustParseInt64(value)
		if fileID <= 0 {
			continue
		}
		fields, getErr := common.RDB.HGetAll(ctx, wikiGenerationFileKey(eid, fileID)).Result()
		if getErr != nil {
			return nil, getErr
		}
		if len(fields) == 0 {
			continue
		}
		file := wikiGenerationFileSummaryFromRedis(fields)
		if file.Title == "" {
			file.Title = recoverWikiGenerationFileTitle(ctx, eid, fileID)
		}
		files = append(files, file)
	}
	return files, nil
}

func recoverWikiGenerationFileTitle(ctx context.Context, eid, fileID int64) string {
	values, err := common.RDB.LRange(ctx, wikiGenerationEventsKey(eid, fileID), 0, -1).Result()
	if err != nil {
		return ""
	}
	for _, value := range values {
		var event WikiGenerationTraceEvent
		if json.Unmarshal([]byte(value), &event) == nil && strings.TrimSpace(event.Title) != "" {
			return event.Title
		}
	}
	return ""
}

func LoadWikiGenerationTrace(ctx context.Context, eid, fileID int64) ([]WikiGenerationTraceEvent, error) {
	if eid <= 0 || fileID <= 0 || common.RDB == nil {
		return []WikiGenerationTraceEvent{}, nil
	}
	values, err := common.RDB.LRange(ctx, wikiGenerationEventsKey(eid, fileID), 0, -1).Result()
	if err != nil && err != redis.Nil {
		return nil, err
	}
	events := make([]WikiGenerationTraceEvent, 0, len(values))
	for _, value := range values {
		var event WikiGenerationTraceEvent
		if json.Unmarshal([]byte(value), &event) == nil {
			events = append(events, event)
		}
	}
	return events, nil
}

func wikiGenerationFileSummaryFromRedis(fields map[string]string) WikiGenerationFileSummary {
	return WikiGenerationFileSummary{
		FileID: mustParseInt64(fields["file_id"]), JobID: mustParseInt64(fields["job_id"]), TraceID: fields["trace_id"], Title: fields["title"], Status: fields["status"], Phase: fields["phase"], TerminalReason: fields["reason"],
		StartedAt: mustParseInt64(fields["started_at"]), UpdatedAt: mustParseInt64(fields["updated_at"]), DurationMs: mustParseInt64(fields["duration_ms"]), Candidates: mustParseInt64(fields["candidates"]), Entities: mustParseInt64(fields["entities"]), Concepts: mustParseInt64(fields["concepts"]), CategoryMatched: mustParseInt64(fields["category_matched"]), PagesSucceeded: mustParseInt64(fields["pages_succeeded"]), PagesFailed: mustParseInt64(fields["pages_failed"]), LLMCalls: mustParseInt64(fields["llm_calls"]), PromptTokens: mustParseInt64(fields["prompt_tokens"]), CompletionTokens: mustParseInt64(fields["completion_tokens"]), TotalTokens: mustParseInt64(fields["total_tokens"]),
	}
}

func mustParseInt64(value string) int64 {
	var n int64
	_, _ = fmt.Sscan(value, &n)
	return n
}
