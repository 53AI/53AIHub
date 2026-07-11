package service

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/53AI/53AIHub/model"
)

const openClawShortcutSummaryMaxRunes = 500

type openClawShortcutSummary struct {
	Content         string
	LastMessageTime int64
	Seq             int64
	SourceRank      int
}

func (s *OpenClawService) refreshOpenClawAgentShortcutFromMirror(ctx context.Context, req OpenClawRequestContext, clearWhenEmpty bool) {
	if model.DB == nil || req.EID == 0 || req.UserID == 0 || req.AgentID == 0 {
		return
	}
	summary, ok := latestOpenClawAgentShortcutSummary(ctx, req)
	if !ok {
		if !clearWhenEmpty {
			return
		}
		_ = model.ClearUserAgentShortcutLastMessage(req.EID, req.UserID, req.AgentID)
		return
	}
	_ = model.AddOrUpdateUserAgentShortcutAt(req.EID, req.UserID, req.AgentID, summary.Content, summary.LastMessageTime)
}

func latestOpenClawAgentShortcutSummary(ctx context.Context, req OpenClawRequestContext) (openClawShortcutSummary, bool) {
	var mirrors []model.OpenClawConversationMirror
	if err := model.DB.WithContext(ctx).
		Where("eid = ? AND agent_id = ? AND user_id = ?", req.EID, req.AgentID, req.UserID).
		Order("updated_time DESC, last_seen_time DESC").
		Limit(100).
		Find(&mirrors).Error; err != nil {
		return openClawShortcutSummary{}, false
	}

	var best openClawShortcutSummary
	hasBest := false
	for _, mirror := range mirrors {
		for _, candidate := range openClawShortcutSummariesFromMirror(mirror) {
			if candidate.LastMessageTime <= 0 {
				candidate.LastMessageTime = maxOpenClawInt64(mirror.UpdatedTime, mirror.LastSeenTime, mirror.CreatedTime)
			}
			if candidate.LastMessageTime <= 0 {
				candidate.LastMessageTime = time.Now().UTC().UnixMilli()
			}
			if !hasBest || openClawShortcutSummaryNewer(candidate, best) {
				best = candidate
				hasBest = true
			}
		}
	}
	return best, hasBest
}

func openClawShortcutSummaryNewer(candidate, current openClawShortcutSummary) bool {
	if candidate.LastMessageTime != current.LastMessageTime {
		return candidate.LastMessageTime > current.LastMessageTime
	}
	if candidate.Seq != current.Seq {
		return candidate.Seq > current.Seq
	}
	return candidate.SourceRank > current.SourceRank
}

func openClawShortcutSummariesFromMirror(mirror model.OpenClawConversationMirror) []openClawShortcutSummary {
	var summaries []openClawShortcutSummary
	for _, source := range []struct {
		raw  string
		rank int
	}{
		{raw: mirror.MessagesJSON, rank: 3},
		{raw: mirror.SnapshotJSON, rank: 2},
		{raw: mirror.EventsJSON, rank: 1},
	} {
		raw := strings.TrimSpace(source.raw)
		if raw == "" || !json.Valid([]byte(raw)) {
			continue
		}
		var payload interface{}
		decoder := json.NewDecoder(strings.NewReader(raw))
		decoder.UseNumber()
		if err := decoder.Decode(&payload); err != nil {
			continue
		}
		collectOpenClawShortcutSummaries(payload, source.rank, 0, &summaries)
	}
	return summaries
}

func collectOpenClawShortcutSummaries(value interface{}, sourceRank int, depth int, summaries *[]openClawShortcutSummary) {
	if depth > 10 {
		return
	}
	switch typed := value.(type) {
	case map[string]interface{}:
		if summary, ok := openClawShortcutSummaryFromRecord(typed, sourceRank); ok {
			*summaries = append(*summaries, summary)
		}
		for _, child := range typed {
			collectOpenClawShortcutSummaries(child, sourceRank, depth+1, summaries)
		}
	case []interface{}:
		for _, item := range typed {
			collectOpenClawShortcutSummaries(item, sourceRank, depth+1, summaries)
		}
	}
}

func openClawShortcutSummaryFromRecord(record map[string]interface{}, sourceRank int) (openClawShortcutSummary, bool) {
	if !openClawShortcutRecordLooksLikeFinalAnswer(record) {
		return openClawShortcutSummary{}, false
	}
	content := cleanOpenClawShortcutContent(openClawShortcutRecordContent(record))
	if content == "" {
		return openClawShortcutSummary{}, false
	}
	return openClawShortcutSummary{
		Content:         content,
		LastMessageTime: openClawShortcutRecordTime(record),
		Seq:             maxOpenClawSeqInValue(record),
		SourceRank:      sourceRank,
	}, true
}

func openClawShortcutRecordLooksLikeFinalAnswer(record map[string]interface{}) bool {
	status := strings.ToLower(openClawRecordString(record, "status", "state", "terminal_status", "terminalStatus"))
	if status == "streaming" || status == "running" || status == "pending" || status == "queued" {
		return false
	}
	visibility := strings.ToLower(openClawRecordString(record, "visibility"))
	if visibility == "stream" || visibility == "partial" {
		return false
	}
	if finalValue, ok := record["final"]; ok && !openClawBool(finalValue) {
		return false
	}

	role := strings.ToLower(openClawRecordString(record, "role", "sender", "author"))
	if role == "user" || role == "tool" || role == "function" || role == "system" {
		return false
	}
	partType := strings.ToLower(openClawRecordString(record, "part_type", "partType", "segment_type", "segmentType"))
	if partType == "thinking" || partType == "tool" || partType == "output_file" || partType == "output_files" || partType == "status" {
		return false
	}
	eventKind := strings.ToLower(openClawRecordString(record, "event_kind", "eventKind", "kind", "type", "event_type", "eventType"))
	if strings.Contains(eventKind, "tool") || strings.Contains(eventKind, "thinking") || strings.Contains(eventKind, "reasoning") || strings.Contains(eventKind, "status") {
		return false
	}
	sourceKind := strings.ToLower(openClawRecordString(record, "source_kind", "sourceKind"))
	if strings.Contains(sourceKind, "tool") || strings.Contains(sourceKind, "thinking") || strings.Contains(sourceKind, "reasoning") || strings.Contains(sourceKind, "status") {
		return false
	}

	if role == "assistant" || role == "ai" || partType == "answer" || strings.Contains(eventKind, "assistant") || strings.Contains(eventKind, "answer") || strings.HasPrefix(sourceKind, "typed_transcript.") {
		return true
	}
	if openClawShortcutStringField(record, "visible_answer", "visibleAnswer", "answer") != "" {
		return true
	}
	for _, key := range []string{"openclawProjection", "openclaw_projection", "projection"} {
		if nested, ok := record[key].(map[string]interface{}); ok && openClawShortcutStringField(nested, "visible_answer", "visibleAnswer", "answer") != "" {
			return true
		}
	}
	return false
}

func openClawShortcutRecordContent(record map[string]interface{}) string {
	if text := openClawShortcutStringField(record, "visible_answer", "visibleAnswer", "answer"); text != "" {
		return text
	}
	for _, key := range []string{"openclawProjection", "openclaw_projection", "projection"} {
		if nested, ok := record[key].(map[string]interface{}); ok {
			if text := openClawShortcutStringField(nested, "visible_answer", "visibleAnswer", "answer"); text != "" {
				return text
			}
		}
	}
	if payload, ok := record["payload"].(map[string]interface{}); ok {
		if text := openClawShortcutStringField(payload, "visible_answer", "visibleAnswer", "answer", "content", "text", "message"); text != "" {
			return text
		}
	}
	return openClawShortcutStringField(record, "content", "text", "message")
}

func openClawShortcutStringField(record map[string]interface{}, keys ...string) string {
	for _, key := range keys {
		value, ok := record[key]
		if !ok || value == nil {
			continue
		}
		switch typed := value.(type) {
		case string:
			if normalized := strings.TrimSpace(typed); normalized != "" {
				return normalized
			}
		case json.Number:
			return typed.String()
		}
	}
	return ""
}

func cleanOpenClawShortcutContent(content string) string {
	content = strings.Join(strings.Fields(content), " ")
	if content == "" || content == "--" {
		return ""
	}
	if utf8.RuneCountInString(content) <= openClawShortcutSummaryMaxRunes {
		return content
	}
	runes := []rune(content)
	return string(runes[:openClawShortcutSummaryMaxRunes])
}

func openClawShortcutRecordTime(record map[string]interface{}) int64 {
	for _, key := range []string{"updated_time", "updatedTime", "created_time", "createdTime", "created_at", "createdAt", "timestamp", "time"} {
		if ts := openClawShortcutTimeValue(record[key]); ts > 0 {
			return ts
		}
	}
	if payload, ok := record["payload"].(map[string]interface{}); ok {
		for _, key := range []string{"updated_time", "updatedTime", "created_time", "createdTime", "created_at", "createdAt", "timestamp", "time"} {
			if ts := openClawShortcutTimeValue(payload[key]); ts > 0 {
				return ts
			}
		}
	}
	return 0
}

func openClawShortcutTimeValue(value interface{}) int64 {
	switch typed := value.(type) {
	case nil:
		return 0
	case int64:
		return normalizeOpenClawShortcutUnixTime(typed)
	case int:
		return normalizeOpenClawShortcutUnixTime(int64(typed))
	case float64:
		return normalizeOpenClawShortcutUnixTime(int64(typed))
	case json.Number:
		if next, err := typed.Int64(); err == nil {
			return normalizeOpenClawShortcutUnixTime(next)
		}
	case string:
		trimmed := strings.TrimSpace(typed)
		if trimmed == "" {
			return 0
		}
		if numeric, err := strconv.ParseInt(trimmed, 10, 64); err == nil {
			return normalizeOpenClawShortcutUnixTime(numeric)
		}
		if parsed, err := time.Parse(time.RFC3339Nano, trimmed); err == nil {
			return parsed.UTC().UnixMilli()
		}
	}
	return 0
}

func normalizeOpenClawShortcutUnixTime(value int64) int64 {
	if value <= 0 {
		return 0
	}
	if value > 1_000_000_000_000 {
		return value
	}
	if value > 1_000_000_000 {
		return value * 1000
	}
	return value
}
