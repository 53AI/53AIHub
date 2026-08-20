package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

const (
	openClawHistorySourceMirror   = "mirror"
	openClawHistorySourceOpenClaw = "openclaw"

	openClawProjectionMirrorRecentLimit = openClawDefaultPageLimit
)

func isOpenClawMirrorFallbackEligible(svcErr *OpenClawServiceError) bool {
	if svcErr == nil {
		return false
	}
	switch svcErr.HTTPStatus {
	case http.StatusServiceUnavailable, http.StatusGatewayTimeout, http.StatusTooManyRequests, http.StatusBadGateway:
		return svcErr.Code == model.NetworkError || svcErr.Code == model.OperateTooFast
	default:
		return false
	}
}

func (s *OpenClawService) cacheConversationList(ctx context.Context, req OpenClawRequestContext, data json.RawMessage) {
	_ = ctx
	baseSeenTime := openClawMirrorListBaseSeenTime(req)
	for index, session := range extractOpenClawSessionRecords(data) {
		conversationID := openClawRecordString(session, "id", "conversation_id", "conversationId", "session_id", "sessionId")
		if conversationID == "" {
			continue
		}
		raw, err := json.Marshal(session)
		if err != nil {
			continue
		}
		_ = upsertOpenClawConversationMirror(req, conversationID, map[string]interface{}{
			"title":             openClawRecordString(session, "title", "name", "label"),
			"status":            openClawRecordString(session, "status", "state"),
			"conversation_json": string(raw),
			"last_seen_time":    openClawMirrorListSeenTime(baseSeenTime, req.Query.Offset, index),
		})
	}
}

func (s *OpenClawService) pruneConversationMirrorsMissingFromFreshList(ctx context.Context, req OpenClawRequestContext, data json.RawMessage) {
	if model.DB == nil || !req.Query.Fresh || req.Query.Offset != 0 {
		return
	}
	records, ok := extractOpenClawSessionRecordsWithPresence(data)
	if !ok {
		return
	}
	liveIDs := make([]string, 0, len(records))
	seen := make(map[string]struct{}, len(records))
	for _, session := range records {
		conversationID := openClawRecordString(session, "id", "conversation_id", "conversationId", "session_id", "sessionId")
		if conversationID == "" {
			continue
		}
		if _, exists := seen[conversationID]; exists {
			continue
		}
		seen[conversationID] = struct{}{}
		liveIDs = append(liveIDs, conversationID)
	}

	query := model.DB.WithContext(ctx).Where(
		"eid = ? AND agent_id = ? AND user_id = ?",
		req.EID,
		req.AgentID,
		req.UserID,
	)
	if len(liveIDs) > 0 {
		query = query.Where("conversation_id NOT IN ?", liveIDs)
	}
	NewOpenClawMessageProjectionService().MarkConversationsMissingFromFreshList(ctx, req, liveIDs)
	if result := query.Delete(&model.OpenClawConversationMirror{}); result.Error == nil && result.RowsAffected > 0 {
		s.refreshOpenClawAgentShortcutFromMirror(ctx, req, true)
	}
}

func (s *OpenClawService) deleteConversationMirror(ctx context.Context, req OpenClawRequestContext) {
	if model.DB == nil || strings.TrimSpace(req.ConversationID) == "" {
		return
	}
	NewOpenClawMessageProjectionService().MarkConversationDeleted(ctx, req, req.ConversationID)
	if result := model.DB.WithContext(ctx).Where(
		"eid = ? AND agent_id = ? AND user_id = ? AND conversation_id = ?",
		req.EID,
		req.AgentID,
		req.UserID,
		req.ConversationID,
	).Delete(&model.OpenClawConversationMirror{}); result.Error == nil && result.RowsAffected > 0 {
		s.refreshOpenClawAgentShortcutFromMirror(ctx, req, true)
	}
}

func (s *OpenClawService) cacheCurrentConversation(ctx context.Context, req OpenClawRequestContext, data json.RawMessage) {
	_ = ctx
	if strings.TrimSpace(string(data)) == "" || strings.TrimSpace(string(data)) == "null" {
		return
	}
	var session map[string]interface{}
	if err := json.Unmarshal(data, &session); err != nil {
		return
	}
	conversationID := openClawRecordString(session, "id", "conversation_id", "conversationId", "session_id", "sessionId")
	if conversationID == "" {
		return
	}
	_ = upsertOpenClawConversationMirror(req, conversationID, map[string]interface{}{
		"title":             openClawRecordString(session, "title", "name", "label"),
		"status":            openClawRecordString(session, "status", "state"),
		"conversation_json": string(data),
	})
}

func (s *OpenClawService) cacheMessages(ctx context.Context, req OpenClawRequestContext, data json.RawMessage) {
	_ = ctx
	if strings.TrimSpace(req.ConversationID) == "" || !json.Valid(data) {
		return
	}
	data = sanitizeOpenClawMirrorHistoryAnswers(data)

	var existing model.OpenClawConversationMirror
	existingRaw := ""
	existingMirrorLastSeq := int64(0)
	if model.DB != nil {
		err := model.DB.Where(
			"eid = ? AND agent_id = ? AND user_id = ? AND conversation_id = ?",
			req.EID,
			req.AgentID,
			req.UserID,
			req.ConversationID,
		).First(&existing).Error
		if err == nil {
			existingRaw = existing.MessagesJSON
			existingMirrorLastSeq = existing.LastSeq
		}
	}
	var merged json.RawMessage
	var ok bool
	if openClawMessageProjectionPrimaryEnabled() {
		merged, ok = compactOpenClawMirrorMessagesPayload(data)
	} else {
		merged, ok = mergeOpenClawMirrorMessagesPayload(existingRaw, data, req.Query)
	}
	if !ok {
		return
	}
	updates := map[string]interface{}{
		"messages_json":                     string(merged),
		"_openclaw_messages_json_premerged": true,
	}
	if lastSeq := maxOpenClawInt64(existingMirrorLastSeq, extractOpenClawLastSeq(data), extractOpenClawLastSeq(merged)); lastSeq > 0 {
		updates["last_seq"] = lastSeq
	}
	_ = upsertOpenClawConversationMirror(req, req.ConversationID, updates)
	s.refreshOpenClawAgentShortcutFromMirror(ctx, req, false)
}

func (s *OpenClawService) cacheEvents(ctx context.Context, req OpenClawRequestContext, data json.RawMessage) {
	_ = ctx
	if strings.TrimSpace(req.ConversationID) == "" || !json.Valid(data) {
		return
	}
	data = sanitizeOpenClawMirrorHistoryAnswers(data)
	if openClawMessageProjectionPrimaryEnabled() {
		data = compactOpenClawMirrorRecentPayload(data)
	}
	_ = upsertOpenClawConversationMirror(req, req.ConversationID, map[string]interface{}{
		"events_json": string(data),
		"last_seq":    extractOpenClawLastSeq(data),
	})
}

func (s *OpenClawService) cacheSnapshot(ctx context.Context, req OpenClawRequestContext, data json.RawMessage) {
	_ = ctx
	if strings.TrimSpace(req.ConversationID) == "" || !json.Valid(data) {
		return
	}
	data = sanitizeOpenClawMirrorHistoryAnswers(data)
	if openClawMessageProjectionPrimaryEnabled() {
		data = compactOpenClawMirrorRecentPayload(data)
	}
	_ = upsertOpenClawConversationMirror(req, req.ConversationID, map[string]interface{}{
		"snapshot_json": string(data),
		"last_seq":      extractOpenClawLastSeq(data),
	})
	s.refreshOpenClawAgentShortcutFromMirror(ctx, req, false)
}

func (s *OpenClawService) fallbackConversationList(ctx context.Context, req OpenClawRequestContext, svcErr *OpenClawServiceError) (json.RawMessage, *OpenClawServiceError, bool) {
	if !isOpenClawMirrorFallbackEligible(svcErr) {
		return nil, svcErr, false
	}
	projectionService := NewOpenClawMessageProjectionService()
	if openClawMessageProjectionPrimaryEnabled() {
		if raw, projectionErr, ok := projectionService.ConversationList(ctx, req); ok {
			return raw, projectionErr, true
		}
	}
	raw, mirrorErr, ok := s.mirrorConversationList(ctx, req)
	if ok || mirrorErr != nil {
		return raw, mirrorErr, ok
	}
	return projectionService.ConversationList(ctx, req)
}

func (s *OpenClawService) mirrorConversationList(ctx context.Context, req OpenClawRequestContext) (json.RawMessage, *OpenClawServiceError, bool) {
	_ = ctx
	if _, agentErr := s.loadAgent(req); agentErr != nil {
		return nil, agentErr, true
	}
	if _, paginationErr := openClawPaginationPayload(req.Query); paginationErr != nil {
		return nil, paginationErr, true
	}
	limit := req.Query.Limit
	if limit == 0 {
		limit = openClawDefaultPageLimit
	}
	offset := req.Query.Offset
	query := model.DB.Model(&model.OpenClawConversationMirror{}).Where(
		"eid = ? AND agent_id = ? AND user_id = ?",
		req.EID,
		req.AgentID,
		req.UserID,
	)
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, nil, false
	}
	if total == 0 {
		return nil, nil, false
	}
	var mirrors []model.OpenClawConversationMirror
	if err := query.
		Order("last_seen_time DESC, updated_time DESC").
		Limit(limit).
		Offset(offset).
		Find(&mirrors).Error; err != nil {
		return nil, nil, false
	}
	sessions := make([]json.RawMessage, 0, len(mirrors))
	for _, mirror := range mirrors {
		sessions = append(sessions, openClawMirrorConversationPayload(mirror))
	}
	nextOffset := offset + len(mirrors)
	payload, err := json.Marshal(map[string]interface{}{
		"sessions": sessions,
		"pagination": map[string]interface{}{
			"limit":      limit,
			"offset":     offset,
			"total":      total,
			"hasMore":    int64(nextOffset) < total,
			"nextOffset": nextOffset,
		},
		"source": openClawHistorySourceMirror,
		"stale":  true,
	})
	if err != nil {
		return nil, nil, false
	}
	return payload, nil, true
}

func (s *OpenClawService) fallbackCurrentConversation(ctx context.Context, req OpenClawRequestContext, svcErr *OpenClawServiceError) (json.RawMessage, *OpenClawServiceError, bool) {
	if !isOpenClawMirrorFallbackEligible(svcErr) {
		return nil, svcErr, false
	}
	projectionService := NewOpenClawMessageProjectionService()
	if openClawMessageProjectionPrimaryEnabled() {
		if raw, projectionErr, ok := projectionService.CurrentConversation(ctx, req); ok {
			return raw, projectionErr, true
		}
	}
	raw, mirrorErr, ok := s.mirrorCurrentConversation(ctx, req)
	if ok || mirrorErr != nil {
		return raw, mirrorErr, ok
	}
	return projectionService.CurrentConversation(ctx, req)
}

func (s *OpenClawService) mirrorCurrentConversation(ctx context.Context, req OpenClawRequestContext) (json.RawMessage, *OpenClawServiceError, bool) {
	_ = ctx
	if _, agentErr := s.loadAgent(req); agentErr != nil {
		return nil, agentErr, true
	}
	var mirrors []model.OpenClawConversationMirror
	err := model.DB.Where("eid = ? AND agent_id = ? AND user_id = ?", req.EID, req.AgentID, req.UserID).
		Where(openClawMirrorCachedHistoryWhere()).
		Order("last_seen_time DESC, updated_time DESC").
		Find(&mirrors).Error
	if err != nil {
		return nil, nil, false
	}
	mirror, ok := selectOpenClawMirrorCurrentConversation(mirrors, req)
	if !ok {
		return nil, nil, false
	}
	return openClawMirrorConversationPayload(mirror), nil, true
}

func (s *OpenClawService) fallbackConversationField(ctx context.Context, req OpenClawRequestContext, field string, svcErr *OpenClawServiceError) (json.RawMessage, *OpenClawServiceError, bool) {
	if !isOpenClawMirrorFallbackEligible(svcErr) {
		return nil, svcErr, false
	}
	projectionService := NewOpenClawMessageProjectionService()
	if field == "messages" && openClawMessageProjectionPrimaryEnabled() {
		if raw, projectionErr, ok := projectionService.MirrorMessages(ctx, req); ok {
			return raw, projectionErr, true
		}
	}
	raw, mirrorErr, ok := s.mirrorConversationField(ctx, req, field)
	if ok || mirrorErr != nil || field != "messages" {
		return raw, mirrorErr, ok
	}
	return projectionService.MirrorMessages(ctx, req)
}

func (s *OpenClawService) mirrorConversationField(ctx context.Context, req OpenClawRequestContext, field string) (json.RawMessage, *OpenClawServiceError, bool) {
	_ = ctx
	if _, agentErr := s.loadAgent(req); agentErr != nil {
		return nil, agentErr, true
	}
	var mirror model.OpenClawConversationMirror
	err := model.DB.Where(
		"eid = ? AND agent_id = ? AND user_id = ? AND conversation_id = ?",
		req.EID,
		req.AgentID,
		req.UserID,
		req.ConversationID,
	).First(&mirror).Error
	if err != nil {
		return nil, nil, false
	}
	var raw string
	switch field {
	case "messages":
		raw = mirror.MessagesJSON
	case "events":
		raw = mirror.EventsJSON
	case "snapshot":
		raw = mirror.SnapshotJSON
	}
	raw = strings.TrimSpace(raw)
	if raw == "" || !json.Valid([]byte(raw)) {
		return nil, nil, false
	}
	if field == "messages" {
		raw = string(paginateOpenClawMirrorMessagesPayload(json.RawMessage(raw), req.Query))
	}
	return withOpenClawMirrorMetadata(json.RawMessage(raw), field, mirror.LastSeq), nil, true
}

func openClawMirrorCachedHistoryWhere() string {
	return "(COALESCE(messages_json, '') <> '' OR COALESCE(events_json, '') <> '' OR COALESCE(snapshot_json, '') <> '')"
}

func selectOpenClawMirrorCurrentConversation(mirrors []model.OpenClawConversationMirror, req OpenClawRequestContext) (model.OpenClawConversationMirror, bool) {
	userKey := openClawHubUserKey(req.UserID)
	userName := openClawHubUserName(req.UserID)
	bestIndex := -1
	bestScore := 0
	for index, mirror := range mirrors {
		score := openClawHubSessionTitleScore(openClawMirrorConversationTitle(mirror), userKey, userName)
		if score > bestScore {
			bestScore = score
			bestIndex = index
		}
	}
	if bestIndex < 0 {
		return model.OpenClawConversationMirror{}, false
	}
	return mirrors[bestIndex], true
}

func openClawMirrorListSeenTime(base int64, offset int, index int) int64 {
	position := offset + index
	if position <= 0 {
		return base
	}
	return base - int64(position)
}

func openClawMirrorListBaseSeenTime(req OpenClawRequestContext) int64 {
	if req.Query.Offset <= 0 || model.DB == nil {
		return openClawMirrorNow()
	}
	var mirror model.OpenClawConversationMirror
	err := model.DB.Where(
		"eid = ? AND agent_id = ? AND user_id = ?",
		req.EID,
		req.AgentID,
		req.UserID,
	).Order("last_seen_time DESC").First(&mirror).Error
	if err == nil && mirror.LastSeenTime > 0 {
		return mirror.LastSeenTime
	}
	return openClawMirrorNow()
}

func withOpenClawHistoryMetadata(raw json.RawMessage, source string, stale bool, lastSeq int64, extra map[string]interface{}) json.RawMessage {
	var payload map[string]interface{}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return raw
	}
	if payload == nil {
		return raw
	}
	delete(payload, "cached")
	payload["source"] = source
	payload["stale"] = stale
	if lastSeq > 0 {
		payload["last_seq"] = lastSeq
	}
	for key, value := range extra {
		payload[key] = value
	}
	next, err := json.Marshal(payload)
	if err != nil {
		return raw
	}
	return json.RawMessage(next)
}

func withOpenClawMirrorMetadata(raw json.RawMessage, field string, lastSeq int64) json.RawMessage {
	extra := map[string]interface{}{
		"mirror_field": field,
	}
	if field == "messages" {
		messagesLastSeq := extractOpenClawMessagesLastSeq(raw)
		if messagesLastSeq > 0 {
			extra["messages_last_seq"] = messagesLastSeq
		}
		if lastSeq > 0 {
			extra["mirror_last_seq"] = lastSeq
		}
		if lastSeq > 0 && (messagesLastSeq == 0 || messagesLastSeq < lastSeq) {
			extra["refresh_recommended"] = true
		}
		if messagesLastSeq > 0 {
			return withOpenClawHistoryMetadata(raw, openClawHistorySourceMirror, true, messagesLastSeq, extra)
		}
	}
	return withOpenClawHistoryMetadata(raw, openClawHistorySourceMirror, true, lastSeq, extra)
}

func mergeOpenClawMirrorMessagesPayload(existingRaw string, incomingRaw json.RawMessage, query OpenClawPaginationQuery) (json.RawMessage, bool) {
	incoming, ok := openClawJSONPayloadMap(incomingRaw)
	if !ok {
		return nil, false
	}
	existing := map[string]interface{}{}
	if raw := strings.TrimSpace(existingRaw); raw != "" && json.Valid([]byte(raw)) {
		if parsed, parsedOK := openClawJSONPayloadMap(json.RawMessage(raw)); parsedOK {
			existing = parsed
		}
	}

	incomingMessages := openClawJSONList(incoming["messages"])
	existingMessages := openClawJSONList(existing["messages"])
	incomingEvents := openClawJSONList(incoming["events"])
	existingEvents := openClawJSONList(existing["events"])
	incomingLedgerEvents := openClawJSONList(incoming["ledger_events"])
	existingLedgerEvents := openClawJSONList(existing["ledger_events"])

	if len(incomingMessages) == 0 && len(incomingEvents) == 0 && len(incomingLedgerEvents) == 0 {
		if len(existingMessages) > 0 || len(existingEvents) > 0 || len(existingLedgerEvents) > 0 {
			return openClawMarshalPayload(existing)
		}
		return nil, false
	}

	merged := make(map[string]interface{}, len(existing)+len(incoming))
	for key, value := range existing {
		merged[key] = value
	}
	for key, value := range incoming {
		switch key {
		case "messages", "events", "ledger_events", "pagination", "source", "stale", "mirror_field", "cached", "messages_last_seq", "mirror_last_seq", "refresh_recommended":
			continue
		default:
			merged[key] = value
		}
	}

	prepend := query.Offset > 0
	messages := mergeOpenClawJSONRecords(existingMessages, incomingMessages, prepend)
	events := mergeOpenClawJSONRecords(existingEvents, incomingEvents, prepend)
	ledgerEvents := mergeOpenClawJSONRecords(existingLedgerEvents, incomingLedgerEvents, prepend)
	events = sortOpenClawJSONRecordsBySeq(events)
	ledgerEvents = sortOpenClawJSONRecordsBySeq(ledgerEvents)

	if len(messages) > 0 {
		merged["messages"] = messages
	}
	if len(events) > 0 {
		merged["events"] = events
	}
	if len(ledgerEvents) > 0 {
		merged["ledger_events"] = ledgerEvents
	}

	total := len(messages)
	merged["pagination"] = map[string]interface{}{
		"limit":      total,
		"offset":     0,
		"total":      total,
		"hasMore":    false,
		"nextOffset": total,
	}
	if lastSeq := maxOpenClawInt64(extractOpenClawMessagesLastSeq(json.RawMessage(existingRaw)), extractOpenClawLastSeq(incomingRaw)); lastSeq > 0 {
		merged["last_seq"] = lastSeq
		merged["messages_last_seq"] = lastSeq
	}

	return openClawMarshalPayload(merged)
}

func compactOpenClawMirrorMessagesPayload(raw json.RawMessage) (json.RawMessage, bool) {
	payload, ok := openClawJSONPayloadMap(raw)
	if !ok {
		return nil, false
	}
	compactOpenClawMirrorPayloadLists(payload)
	payload["projection_mirror_compact"] = true
	payload["projection_version"] = openClawProjectionVersion
	return openClawMarshalPayload(payload)
}

func compactOpenClawMirrorRecentPayload(raw json.RawMessage) json.RawMessage {
	payload, ok := openClawJSONPayloadMap(raw)
	if !ok {
		return raw
	}
	compactOpenClawMirrorPayloadLists(payload)
	payload["projection_mirror_compact"] = true
	payload["projection_version"] = openClawProjectionVersion
	next, ok := openClawMarshalPayload(payload)
	if !ok {
		return raw
	}
	return next
}

func compactOpenClawMirrorPayloadLists(payload map[string]interface{}) {
	for _, key := range []string{"messages", "events", "ledger_events", "ledgerEvents", "recent_events", "recentEvents"} {
		list := openClawJSONList(payload[key])
		if len(list) <= openClawProjectionMirrorRecentLimit {
			continue
		}
		payload[key] = append([]interface{}{}, list[len(list)-openClawProjectionMirrorRecentLimit:]...)
	}
}

func paginateOpenClawMirrorMessagesPayload(raw json.RawMessage, query OpenClawPaginationQuery) json.RawMessage {
	payload, ok := openClawJSONPayloadMap(raw)
	if !ok {
		return raw
	}
	messages := openClawJSONList(payload["messages"])
	if len(messages) == 0 {
		return raw
	}
	limit := query.Limit
	if limit == 0 {
		limit = openClawDefaultPageLimit
	}
	offset := query.Offset
	total := len(messages)
	end := total - offset
	if end < 0 {
		end = 0
	}
	start := end - limit
	if start < 0 {
		start = 0
	}
	page := messages[start:end]
	nextOffset := offset + len(page)
	payload["messages"] = page
	payload["pagination"] = map[string]interface{}{
		"limit":      limit,
		"offset":     offset,
		"total":      total,
		"hasMore":    nextOffset < total,
		"nextOffset": nextOffset,
	}
	next, err := json.Marshal(payload)
	if err != nil {
		return raw
	}
	return json.RawMessage(next)
}

func openClawJSONPayloadMap(raw json.RawMessage) (map[string]interface{}, bool) {
	var payload map[string]interface{}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if err := decoder.Decode(&payload); err != nil || payload == nil {
		return nil, false
	}
	return payload, true
}

func openClawMarshalPayload(payload map[string]interface{}) (json.RawMessage, bool) {
	next, err := json.Marshal(payload)
	if err != nil {
		return nil, false
	}
	return json.RawMessage(next), true
}

func openClawJSONList(value interface{}) []interface{} {
	switch typed := value.(type) {
	case []interface{}:
		return typed
	case []map[string]interface{}:
		list := make([]interface{}, 0, len(typed))
		for _, item := range typed {
			list = append(list, item)
		}
		return list
	default:
		return nil
	}
}

func mergeOpenClawJSONRecords(existing []interface{}, incoming []interface{}, prepend bool) []interface{} {
	if len(existing) == 0 {
		return append([]interface{}{}, incoming...)
	}
	if len(incoming) == 0 {
		return append([]interface{}{}, existing...)
	}
	merged := append([]interface{}{}, existing...)
	indexByKey := make(map[string]int, len(merged))
	for index, item := range merged {
		if key := openClawMirrorRecordKey(item, index); key != "" {
			indexByKey[key] = index
		}
	}
	newItems := make([]interface{}, 0, len(incoming))
	for index, item := range incoming {
		key := openClawMirrorRecordKey(item, index)
		if existingIndex, ok := indexByKey[key]; ok && key != "" {
			merged[existingIndex] = selectOpenClawMirrorRecord(merged[existingIndex], item)
			continue
		}
		newItems = append(newItems, item)
	}
	if len(newItems) == 0 {
		return merged
	}
	if prepend {
		next := make([]interface{}, 0, len(newItems)+len(merged))
		next = append(next, newItems...)
		next = append(next, merged...)
		return next
	}
	return append(merged, newItems...)
}

func selectOpenClawMirrorRecord(existing interface{}, incoming interface{}) interface{} {
	existingSeq := maxOpenClawSeqInValue(existing)
	incomingSeq := maxOpenClawSeqInValue(incoming)
	existingScore := openClawMirrorRecordCompletenessScore(existing)
	incomingScore := openClawMirrorRecordCompletenessScore(incoming)
	if incomingSeq > 0 && existingSeq > 0 && incomingSeq < existingSeq && incomingScore <= existingScore {
		return existing
	}
	if incomingSeq <= existingSeq && incomingScore < existingScore {
		return existing
	}
	return incoming
}

func openClawMirrorRecordCompletenessScore(value interface{}) int {
	switch typed := value.(type) {
	case map[string]interface{}:
		score := 0
		for _, key := range []string{"answer", "content", "text", "message", "reasoning_content", "reasoning", "thinking"} {
			if text := openClawRecordString(typed, key); text != "" {
				score += len(text)
			}
		}
		for _, key := range []string{"outputFiles", "output_files", "files", "media_attachments", "process_records", "processRecords", "ledger_events", "events", "openclawTimelineItems"} {
			score += 1000 * len(openClawJSONList(typed[key]))
		}
		for _, value := range typed {
			switch nested := value.(type) {
			case map[string]interface{}, []interface{}:
				score += openClawMirrorRecordCompletenessScore(nested)
			}
		}
		return score
	case []interface{}:
		score := 100 * len(typed)
		for _, item := range typed {
			score += openClawMirrorRecordCompletenessScore(item)
		}
		return score
	default:
		return 0
	}
}

func sortOpenClawJSONRecordsBySeq(records []interface{}) []interface{} {
	if len(records) < 2 {
		return records
	}
	records = append([]interface{}{}, records...)
	sort.SliceStable(records, func(i, j int) bool {
		left := maxOpenClawSeqInValue(records[i])
		right := maxOpenClawSeqInValue(records[j])
		if left == 0 || right == 0 || left == right {
			return i < j
		}
		return left < right
	})
	return records
}

func openClawMirrorRecordKey(item interface{}, fallbackIndex int) string {
	_ = fallbackIndex
	record, ok := item.(map[string]interface{})
	if !ok {
		return ""
	}
	for _, key := range []string{
		"id", "message_id", "messageId", "event_id", "eventId", "part_id", "partId",
		"segment_id", "segmentId", "request_id", "requestId", "call_id", "callId",
	} {
		if value := openClawRecordString(record, key); value != "" {
			return key + ":" + value
		}
	}
	for _, key := range []string{"rawSeq", "raw_seq", "messageSeq", "message_seq", "seq"} {
		if seq := openClawNumber(record[key]); seq > 0 {
			return key + ":" + fmt.Sprintf("%d", seq)
		}
	}
	turnID := openClawRecordString(record, "turn_id", "turnId")
	eventKind := openClawRecordString(record, "event_kind", "eventKind", "event_type", "eventType", "type", "kind")
	status := openClawRecordString(record, "status", "state", "final")
	if turnID != "" && eventKind != "" {
		return "turn:" + turnID + ":" + eventKind + ":" + status
	}
	createdAt := openClawRecordString(record, "created_at", "createdAt", "timestamp", "time")
	role := openClawRecordString(record, "role", "sender")
	content := openClawRecordString(record, "content", "text", "message")
	if createdAt != "" && role != "" && content != "" {
		return "content:" + createdAt + ":" + role + ":" + content
	}
	return ""
}

func upsertOpenClawConversationMirror(req OpenClawRequestContext, conversationID string, updates map[string]interface{}) error {
	if model.DB == nil {
		return nil
	}
	conversationID = strings.TrimSpace(conversationID)
	if conversationID == "" {
		return nil
	}
	updates = sanitizeOpenClawMirrorHistoryUpdateFields(updates)
	var mirror model.OpenClawConversationMirror
	err := model.DB.Where(
		"eid = ? AND agent_id = ? AND user_id = ? AND conversation_id = ?",
		req.EID,
		req.AgentID,
		req.UserID,
		conversationID,
	).First(&mirror).Error
	if err == nil {
		updates = filterOpenClawMirrorUpdates(mirror, updates)
		if len(updates) == 0 {
			return nil
		}
		return model.DB.Model(&mirror).Updates(updates).Error
	}
	if err != nil && err != gorm.ErrRecordNotFound {
		return err
	}
	mirror = model.OpenClawConversationMirror{
		Eid:            req.EID,
		AgentID:        req.AgentID,
		UserID:         req.UserID,
		ConversationID: conversationID,
		LastSeenTime:   openClawMirrorNow(),
	}
	if value, ok := updates["title"].(string); ok {
		mirror.Title = value
	}
	if value, ok := updates["status"].(string); ok {
		mirror.Status = value
	}
	if value, ok := updates["conversation_json"].(string); ok {
		mirror.ConversationJSON = value
	}
	if value, ok := updates["messages_json"].(string); ok {
		mirror.MessagesJSON = value
	}
	if value, ok := updates["events_json"].(string); ok {
		mirror.EventsJSON = value
	}
	if value, ok := updates["snapshot_json"].(string); ok {
		mirror.SnapshotJSON = value
	}
	if value, ok := updates["last_seq"].(int64); ok {
		mirror.LastSeq = value
	}
	if value, ok := updates["last_seen_time"].(int64); ok {
		mirror.LastSeenTime = value
	}
	return model.DB.Create(&mirror).Error
}

func updateExistingOpenClawConversationMirror(req OpenClawRequestContext, conversationID string, updates map[string]interface{}) error {
	if model.DB == nil {
		return nil
	}
	conversationID = strings.TrimSpace(conversationID)
	if conversationID == "" {
		return nil
	}
	var mirror model.OpenClawConversationMirror
	err := model.DB.Where(
		"eid = ? AND agent_id = ? AND user_id = ? AND conversation_id = ?",
		req.EID,
		req.AgentID,
		req.UserID,
		conversationID,
	).First(&mirror).Error
	if err == gorm.ErrRecordNotFound {
		return nil
	}
	if err != nil {
		return err
	}
	updates = filterOpenClawMirrorUpdates(mirror, updates)
	if len(updates) == 0 {
		return nil
	}
	return model.DB.Model(&mirror).Updates(updates).Error
}

func openClawMirrorHasCachedHistory(mirror model.OpenClawConversationMirror) bool {
	return strings.TrimSpace(mirror.MessagesJSON) != "" ||
		strings.TrimSpace(mirror.EventsJSON) != "" ||
		strings.TrimSpace(mirror.SnapshotJSON) != ""
}

func openClawConversationHistoryStatusMap(req OpenClawRequestContext, conversationIDs []string) map[string]bool {
	statusByID := make(map[string]bool, len(conversationIDs))
	if model.DB == nil || len(conversationIDs) == 0 {
		return statusByID
	}
	ids := make([]string, 0, len(conversationIDs))
	seen := map[string]bool{}
	for _, id := range conversationIDs {
		id = strings.TrimSpace(id)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		ids = append(ids, id)
	}
	if len(ids) == 0 {
		return statusByID
	}
	var mirrors []model.OpenClawConversationMirror
	if err := model.DB.Where(
		"eid = ? AND agent_id = ? AND user_id = ? AND conversation_id IN ?",
		req.EID,
		req.AgentID,
		req.UserID,
		ids,
	).Find(&mirrors).Error; err != nil {
		return statusByID
	}
	for _, mirror := range mirrors {
		statusByID[mirror.ConversationID] = openClawMirrorHasCachedHistory(mirror)
	}
	for id, hasProjectionHistory := range NewOpenClawMessageProjectionService().ConversationHistoryStatusMap(context.Background(), req, ids) {
		if hasProjectionHistory {
			statusByID[id] = true
		}
	}
	return statusByID
}

func withOpenClawConversationListHistoryStatus(req OpenClawRequestContext, data json.RawMessage) json.RawMessage {
	records := extractOpenClawSessionRecords(data)
	if len(records) == 0 {
		return data
	}
	ids := make([]string, 0, len(records))
	for _, record := range records {
		ids = append(ids, openClawRecordString(record, "id", "conversation_id", "conversationId", "session_id", "sessionId"))
	}
	statusByID := openClawConversationHistoryStatusMap(req, ids)
	decorate := func(record map[string]interface{}) map[string]interface{} {
		conversationID := openClawRecordString(record, "id", "conversation_id", "conversationId", "session_id", "sessionId")
		record["has_cached_history"] = statusByID[conversationID]
		return record
	}

	trimmed := strings.TrimSpace(string(data))
	if strings.HasPrefix(trimmed, "[") {
		var list []map[string]interface{}
		if err := json.Unmarshal(data, &list); err != nil {
			return data
		}
		for index := range list {
			list[index] = decorate(list[index])
		}
		next, err := json.Marshal(list)
		if err != nil {
			return data
		}
		return json.RawMessage(next)
	}

	var payload map[string]json.RawMessage
	if err := json.Unmarshal(data, &payload); err != nil {
		return data
	}
	for _, key := range []string{"sessions", "items", "conversations"} {
		raw, ok := payload[key]
		if !ok || len(raw) == 0 {
			continue
		}
		var list []map[string]interface{}
		if err := json.Unmarshal(raw, &list); err != nil {
			continue
		}
		for index := range list {
			list[index] = decorate(list[index])
		}
		nextList, err := json.Marshal(list)
		if err != nil {
			return data
		}
		payload[key] = nextList
		nextPayload, err := json.Marshal(payload)
		if err != nil {
			return data
		}
		return json.RawMessage(nextPayload)
	}
	return data
}

func filterOpenClawMirrorUpdates(mirror model.OpenClawConversationMirror, updates map[string]interface{}) map[string]interface{} {
	if len(updates) == 0 {
		return updates
	}
	filtered := make(map[string]interface{}, len(updates))
	for key, value := range updates {
		filtered[key] = value
	}
	messagesPremerged, _ := filtered["_openclaw_messages_json_premerged"].(bool)
	delete(filtered, "_openclaw_messages_json_premerged")

	incomingSeq, hasIncomingSeq := readOpenClawMirrorUpdateLastSeq(updates)
	touchesHistory := touchesOpenClawMirrorHistory(updates)
	if !touchesHistory {
		return filtered
	}

	if hasIncomingSeq && mirror.LastSeq > 0 && incomingSeq < mirror.LastSeq {
		delete(filtered, "messages_json")
		delete(filtered, "events_json")
		delete(filtered, "snapshot_json")
		delete(filtered, "last_seq")
		return filtered
	}

	if !hasIncomingSeq && mirror.LastSeq > 0 {
		for _, field := range []string{"messages_json", "events_json", "snapshot_json"} {
			if _, ok := filtered[field]; ok && openClawMirrorHistoryFieldValue(mirror, field) != "" {
				delete(filtered, field)
			}
		}
		return filtered
	}

	if !messagesPremerged {
		mergeOpenClawMirrorMessagesUpdate(mirror, filtered)
	}
	return filtered
}

func mergeOpenClawMirrorMessagesUpdate(mirror model.OpenClawConversationMirror, updates map[string]interface{}) {
	value, ok := updates["messages_json"]
	if !ok || strings.TrimSpace(mirror.MessagesJSON) == "" {
		return
	}
	incomingRaw, ok := openClawMirrorUpdateRawMessage(value)
	if !ok {
		return
	}
	merged, ok := mergeOpenClawMirrorMessagesPayload(mirror.MessagesJSON, incomingRaw, OpenClawPaginationQuery{})
	if !ok {
		return
	}
	updates["messages_json"] = string(merged)
	if lastSeq := maxOpenClawInt64(mirror.LastSeq, extractOpenClawLastSeq(merged)); lastSeq > 0 {
		updates["last_seq"] = lastSeq
	}
}

func openClawMirrorUpdateRawMessage(value interface{}) (json.RawMessage, bool) {
	switch typed := value.(type) {
	case json.RawMessage:
		return typed, json.Valid(typed)
	case []byte:
		return json.RawMessage(typed), json.Valid(typed)
	case string:
		raw := json.RawMessage(strings.TrimSpace(typed))
		return raw, json.Valid(raw)
	default:
		raw, err := json.Marshal(value)
		if err != nil {
			return nil, false
		}
		return raw, json.Valid(raw)
	}
}

func sanitizeOpenClawMirrorHistoryUpdateFields(updates map[string]interface{}) map[string]interface{} {
	if len(updates) == 0 {
		return updates
	}
	next := make(map[string]interface{}, len(updates))
	for key, value := range updates {
		if key != "messages_json" && key != "events_json" && key != "snapshot_json" {
			next[key] = value
			continue
		}
		raw, ok := openClawMirrorUpdateRawMessage(value)
		if !ok {
			next[key] = value
			continue
		}
		next[key] = string(sanitizeOpenClawMirrorHistoryAnswers(raw))
	}
	return next
}

func sanitizeOpenClawMirrorHistoryAnswers(raw json.RawMessage) json.RawMessage {
	payload, ok := openClawJSONPayloadMap(raw)
	if !ok {
		return raw
	}
	if !sanitizeOpenClawMirrorHistoryAnswerValue(payload) {
		return raw
	}
	next, err := json.Marshal(payload)
	if err != nil {
		return raw
	}
	return json.RawMessage(next)
}

func sanitizeOpenClawMirrorHistoryAnswerValue(value interface{}) bool {
	switch typed := value.(type) {
	case map[string]interface{}:
		changed := false
		for key, child := range typed {
			if openClawMirrorHistoryAnswerListKey(key) {
				list := openClawJSONList(child)
				if list == nil {
					if sanitizeOpenClawMirrorHistoryAnswerValue(child) {
						changed = true
					}
					continue
				}
				next := make([]interface{}, 0, len(list))
				removed := false
				for _, item := range list {
					if isOpenClawMirrorSyntheticHistoryAnswer(item) {
						removed = true
						continue
					}
					if sanitizeOpenClawMirrorHistoryAnswerValue(item) {
						changed = true
					}
					next = append(next, item)
				}
				if removed {
					typed[key] = next
					changed = true
				}
				continue
			}
			if sanitizeOpenClawMirrorHistoryAnswerValue(child) {
				changed = true
			}
		}
		return changed
	case []interface{}:
		changed := false
		for _, item := range typed {
			if sanitizeOpenClawMirrorHistoryAnswerValue(item) {
				changed = true
			}
		}
		return changed
	default:
		return false
	}
}

func openClawMirrorHistoryAnswerListKey(key string) bool {
	switch key {
	case "ledger_events", "ledgerEvents", "recent_events", "recentEvents", "events":
		return true
	default:
		return false
	}
}

func isOpenClawMirrorSyntheticHistoryAnswer(value interface{}) bool {
	record, ok := value.(map[string]interface{})
	if !ok {
		return false
	}
	ledger := openClawMirrorLedgerRecord(record)
	if ledger == nil {
		return false
	}
	activeRequestID := openClawRecordString(ledger, "active_request_id", "activeRequestId", "req_id", "request_id")
	turnID := openClawRecordString(ledger, "turn_id", "turnId")
	if !strings.HasPrefix(activeRequestID, "history:") && !strings.Contains(turnID, ":history:") {
		return false
	}
	return isOpenClawMirrorAnswerLedgerRecord(record, ledger)
}

func openClawMirrorLedgerRecord(record map[string]interface{}) map[string]interface{} {
	if ledger, ok := record["openclaw_ledger"].(map[string]interface{}); ok {
		return ledger
	}
	if payload, ok := record["payload"].(map[string]interface{}); ok {
		if ledger, ok := payload["openclaw_ledger"].(map[string]interface{}); ok {
			return ledger
		}
	}
	if record["protocol_version"] == "openclaw.ledger.v1" || record["active_request_id"] != nil || record["turn_id"] != nil {
		return record
	}
	return nil
}

func isOpenClawMirrorAnswerLedgerRecord(record map[string]interface{}, ledger map[string]interface{}) bool {
	partType := openClawRecordString(ledger, "part_type", "partType", "segment_type", "segmentType")
	if partType == "answer" {
		return true
	}
	eventType := openClawRecordString(ledger, "event_type", "eventType")
	if strings.Contains(eventType, "answer") {
		return true
	}
	if payload, ok := record["payload"].(map[string]interface{}); ok {
		segmentType := openClawRecordString(payload, "segment_type", "segmentType")
		sourceKind := openClawRecordString(payload, "source_kind", "sourceKind")
		if segmentType == "answer" || strings.HasPrefix(sourceKind, "typed_transcript.") {
			return true
		}
	}
	kind := openClawRecordString(record, "kind", "type", "event_kind", "eventKind")
	return kind == "assistant.message" || kind == "assistant.delta" || kind == "assistant.message.delta"
}

func readOpenClawMirrorUpdateLastSeq(updates map[string]interface{}) (int64, bool) {
	value, ok := updates["last_seq"]
	if !ok {
		return 0, false
	}
	switch typed := value.(type) {
	case int:
		return int64(typed), true
	case int64:
		return typed, true
	case float64:
		return int64(typed), true
	case json.Number:
		next, err := typed.Int64()
		return next, err == nil
	default:
		return openClawNumber(typed), true
	}
}

func touchesOpenClawMirrorHistory(updates map[string]interface{}) bool {
	for _, field := range []string{"messages_json", "events_json", "snapshot_json"} {
		if _, ok := updates[field]; ok {
			return true
		}
	}
	return false
}

func openClawMirrorHistoryFieldValue(mirror model.OpenClawConversationMirror, field string) string {
	switch field {
	case "messages_json":
		return strings.TrimSpace(mirror.MessagesJSON)
	case "events_json":
		return strings.TrimSpace(mirror.EventsJSON)
	case "snapshot_json":
		return strings.TrimSpace(mirror.SnapshotJSON)
	default:
		return ""
	}
}

func extractOpenClawSessionRecords(data json.RawMessage) []map[string]interface{} {
	records, _ := extractOpenClawSessionRecordsWithPresence(data)
	return records
}

func extractOpenClawSessionRecordsWithPresence(data json.RawMessage) ([]map[string]interface{}, bool) {
	trimmed := strings.TrimSpace(string(data))
	if trimmed == "" || trimmed == "null" {
		return nil, false
	}
	if strings.HasPrefix(trimmed, "[") {
		var records []map[string]interface{}
		if err := json.Unmarshal(data, &records); err == nil {
			return records, true
		}
		return nil, false
	}
	var payload map[string]json.RawMessage
	if err := json.Unmarshal(data, &payload); err != nil {
		return nil, false
	}
	for _, key := range []string{"sessions", "items", "conversations"} {
		if raw := payload[key]; len(raw) > 0 {
			var records []map[string]interface{}
			if err := json.Unmarshal(raw, &records); err == nil {
				return records, true
			}
		}
	}
	return nil, false
}

func openClawMirrorConversationPayload(mirror model.OpenClawConversationMirror) json.RawMessage {
	raw := strings.TrimSpace(mirror.ConversationJSON)
	hasCachedHistory := openClawMirrorHasCachedHistory(mirror)
	if raw != "" && json.Valid([]byte(raw)) {
		return withOpenClawHistoryMetadata(json.RawMessage(raw), openClawHistorySourceMirror, true, mirror.LastSeq, map[string]interface{}{
			"has_cached_history": hasCachedHistory,
		})
	}
	payload, _ := json.Marshal(map[string]interface{}{
		"id":                 mirror.ConversationID,
		"conversation_id":    mirror.ConversationID,
		"title":              mirror.Title,
		"status":             mirror.Status,
		"source":             openClawHistorySourceMirror,
		"stale":              true,
		"last_seq":           mirror.LastSeq,
		"updated_time":       mirror.UpdatedTime,
		"has_cached_history": hasCachedHistory,
	})
	return payload
}

func openClawMirrorConversationTitle(mirror model.OpenClawConversationMirror) string {
	if title := strings.TrimSpace(mirror.Title); title != "" {
		return title
	}
	var record map[string]interface{}
	if raw := strings.TrimSpace(mirror.ConversationJSON); raw != "" && json.Valid([]byte(raw)) {
		if err := json.Unmarshal([]byte(raw), &record); err == nil {
			return openClawRecordString(record, "title", "name", "label")
		}
	}
	return ""
}

func openClawRecordString(record map[string]interface{}, keys ...string) string {
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
		case float64:
			if typed == float64(int64(typed)) {
				return fmt.Sprintf("%d", int64(typed))
			}
			return fmt.Sprintf("%v", typed)
		default:
			normalized := strings.TrimSpace(fmt.Sprintf("%v", typed))
			if normalized != "" {
				return normalized
			}
		}
	}
	return ""
}

func extractOpenClawLastSeq(data json.RawMessage) int64 {
	var payload map[string]interface{}
	if err := json.Unmarshal(data, &payload); err != nil {
		return 0
	}
	for _, key := range []string{"last_seq", "lastSeq"} {
		if value, ok := payload[key]; ok {
			return openClawNumber(value)
		}
	}
	return maxOpenClawSeqInValue(payload)
}

func extractOpenClawMessagesLastSeq(data json.RawMessage) int64 {
	payload, ok := openClawJSONPayloadMap(data)
	if !ok {
		return 0
	}
	for _, key := range []string{"messages_last_seq", "messagesLastSeq"} {
		if seq := openClawNumber(payload[key]); seq > 0 {
			return seq
		}
	}
	return 0
}

func openClawNumber(value interface{}) int64 {
	switch typed := value.(type) {
	case float64:
		return int64(typed)
	case int64:
		return typed
	case json.Number:
		next, _ := typed.Int64()
		return next
	default:
		return 0
	}
}

func maxOpenClawInt64(values ...int64) int64 {
	maxValue := int64(0)
	for _, value := range values {
		if value > maxValue {
			maxValue = value
		}
	}
	return maxValue
}

func maxOpenClawSeqInValue(value interface{}) int64 {
	switch typed := value.(type) {
	case map[string]interface{}:
		maxSeq := int64(0)
		for _, key := range []string{"seq", "rawSeq", "raw_seq", "messageSeq", "message_seq", "last_seq", "lastSeq"} {
			if seq := openClawNumber(typed[key]); seq > maxSeq {
				maxSeq = seq
			}
		}
		for _, value := range typed {
			if seq := maxOpenClawSeqInValue(value); seq > maxSeq {
				maxSeq = seq
			}
		}
		return maxSeq
	case []interface{}:
		maxSeq := int64(0)
		for _, item := range typed {
			if seq := maxOpenClawSeqInValue(item); seq > maxSeq {
				maxSeq = seq
			}
		}
		return maxSeq
	default:
		return 0
	}
}

func openClawMirrorNow() int64 {
	return time.Now().UTC().UnixMilli()
}
