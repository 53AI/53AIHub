package service

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

const (
	openClawMessageProjectionMaxJSONBytes = 64 * 1024
	openClawProjectionSource              = "openclaw_projection"
	openClawProjectionVersion             = "openclaw.message_projection.v1"
)

type OpenClawMessageProjectionService struct{}

type openClawMessageProjection struct {
	ConversationID string
	ProjectionKey  string
	TurnID         string
	RequestID      string
	Question       string
	Answer         string
	Reasoning      string
	Status         string
	SeqStart       int64
	SeqEnd         int64
	CreatedTime    int64
	UpdatedTime    int64
	OutputFiles    []interface{}
	Activities     []interface{}
	TimelineItems  []interface{}
}

func NewOpenClawMessageProjectionService() *OpenClawMessageProjectionService {
	return &OpenClawMessageProjectionService{}
}

func openClawMessageProjectionWriteEnabled() bool {
	return openClawProjectionEnvEnabled("OPENCLAW_MESSAGE_PROJECTION_WRITE")
}

func openClawMessageProjectionReadEnabled() bool {
	return openClawProjectionEnvEnabled("OPENCLAW_MESSAGE_PROJECTION_READ") || openClawMessageProjectionPrimaryEnabled()
}

func openClawMessageProjectionPrimaryEnabled() bool {
	return openClawProjectionEnvEnabled("OPENCLAW_MESSAGE_PROJECTION_PRIMARY")
}

func openClawProjectionEnvEnabled(key string) bool {
	value := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
	return value == "1" || value == "true" || value == "yes"
}

// projectionSyncedCacheTTL 控制跳过已同步投影的短时缓存有效期（30 分钟）。
// 用于避免几十分钟到半小时内重复同步同一投影记录。
const projectionSyncedCacheTTL = 30 * time.Minute

func isProjectionSynced(ctx context.Context, eid int64, agentID, userID int64, conversationID, projectionKey string) bool {
	key := common.GetOpenClawProjectionSyncedCacheKey(eid, agentID, userID, conversationID, projectionKey)
	_, err := common.RedisGet(key)
	return err == nil
}

func markProjectionSynced(ctx context.Context, eid int64, agentID, userID int64, conversationID, projectionKey string) {
	key := common.GetOpenClawProjectionSyncedCacheKey(eid, agentID, userID, conversationID, projectionKey)
	_ = common.RedisSet(key, "1", projectionSyncedCacheTTL)
}

func (s *OpenClawMessageProjectionService) CacheProjectionPayload(ctx context.Context, req OpenClawRequestContext, data json.RawMessage) {
	if !openClawMessageProjectionWriteEnabled() || model.DB == nil || strings.TrimSpace(req.ConversationID) == "" {
		return
	}
	if !s.agentAllowsProjection(req) {
		return
	}

	projections := buildOpenClawMessageProjections(req, sanitizeOpenClawMirrorHistoryAnswers(data))
	if len(projections) == 0 {
		return
	}

	// Serialize writes per conversation via distributed lock to prevent
	// the SELECT-then-INSERT race in upsertProjectionMessage legacy dedup.
	muKey := common.GetOpenClawProjectionMutexKey(req.EID, req.ConversationID)
	for !common.LOCKER.TryLock(muKey, 30*time.Second) {
		time.Sleep(50 * time.Millisecond)
	}
	defer common.LOCKER.Unlock(muKey)

	// 锁内过滤已同步投影（权威检查，避免竞态）
	uncached := projections[:0]
	for _, p := range projections {
		if !isProjectionSynced(ctx, req.EID, req.AgentID, req.UserID, req.ConversationID, p.ProjectionKey) {
			uncached = append(uncached, p)
		}
	}
	projections = uncached
	if len(projections) == 0 {
		return
	}

	if err := s.upsertProjections(ctx, req, projections); err != nil {
		logger.Warnf(ctx, "OpenClaw message projection cache failed: %v", err)
		return
	}

	for _, p := range projections {
		markProjectionSynced(ctx, req.EID, req.AgentID, req.UserID, req.ConversationID, p.ProjectionKey)
	}
}

func (s *OpenClawMessageProjectionService) CacheConversationListMetadata(ctx context.Context, req OpenClawRequestContext, data json.RawMessage) {
	if !openClawMessageProjectionWriteEnabled() || model.DB == nil {
		return
	}
	if !s.agentAllowsProjection(req) {
		return
	}
	records := extractOpenClawSessionRecords(data)
	if len(records) == 0 {
		return
	}
	baseSeenTime := openClawMirrorListBaseSeenTime(req)
	if err := model.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for index, session := range records {
			seenTime := openClawMirrorListSeenTime(baseSeenTime, req.Query.Offset, index)
			if err := s.upsertProjectionConversationMetadata(tx, req, session, seenTime); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		logger.Warnf(ctx, "OpenClaw conversation metadata projection cache failed: %v", err)
	}
}

func (s *OpenClawMessageProjectionService) CacheCurrentConversationMetadata(ctx context.Context, req OpenClawRequestContext, data json.RawMessage) {
	if !openClawMessageProjectionWriteEnabled() || model.DB == nil {
		return
	}
	if !s.agentAllowsProjection(req) {
		return
	}
	trimmed := strings.TrimSpace(string(data))
	if trimmed == "" || trimmed == "null" || !json.Valid(data) {
		return
	}
	var session map[string]interface{}
	if err := json.Unmarshal(data, &session); err != nil {
		return
	}
	seenTime := openClawProjectionTimestamp(firstOpenClawProjectionValue(session, "updated_at", "updatedAt", "last_seen_time", "lastSeenTime", "timestamp", "time"))
	if seenTime <= 0 {
		seenTime = openClawMirrorNow()
	}
	if err := model.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		return s.upsertProjectionConversationMetadata(tx, req, session, seenTime)
	}); err != nil {
		logger.Warnf(ctx, "OpenClaw current conversation metadata projection cache failed: %v", err)
	}
}

func (s *OpenClawMessageProjectionService) MirrorMessages(ctx context.Context, req OpenClawRequestContext) (json.RawMessage, *OpenClawServiceError, bool) {
	if !openClawMessageProjectionReadEnabled() || model.DB == nil || strings.TrimSpace(req.ConversationID) == "" {
		return nil, nil, false
	}
	if !s.agentAllowsProjection(req) {
		return nil, nil, false
	}
	raw, ok, err := s.messagesPayload(ctx, req)
	if err != nil {
		logger.Warnf(ctx, "OpenClaw message projection read failed: %v", err)
		return nil, nil, false
	}
	return raw, nil, ok
}

func (s *OpenClawMessageProjectionService) ConversationList(ctx context.Context, req OpenClawRequestContext) (json.RawMessage, *OpenClawServiceError, bool) {
	if !openClawMessageProjectionReadEnabled() || model.DB == nil {
		return nil, nil, false
	}
	if _, paginationErr := openClawPaginationPayload(req.Query); paginationErr != nil {
		return nil, paginationErr, true
	}
	if !s.agentAllowsProjection(req) {
		return nil, nil, false
	}
	raw, ok, err := s.conversationListPayload(ctx, req)
	if err != nil {
		logger.Warnf(ctx, "OpenClaw message projection conversation list read failed: %v", err)
		return nil, nil, false
	}
	return raw, nil, ok
}

func (s *OpenClawMessageProjectionService) CurrentConversation(ctx context.Context, req OpenClawRequestContext) (json.RawMessage, *OpenClawServiceError, bool) {
	if !openClawMessageProjectionReadEnabled() || model.DB == nil {
		return nil, nil, false
	}
	if !s.agentAllowsProjection(req) {
		return nil, nil, false
	}
	raw, ok, err := s.currentConversationPayload(ctx, req)
	if err != nil {
		logger.Warnf(ctx, "OpenClaw message projection current conversation read failed: %v", err)
		return nil, nil, false
	}
	return raw, nil, ok
}

func (s *OpenClawMessageProjectionService) ConversationHistoryStatusMap(ctx context.Context, req OpenClawRequestContext, conversationIDs []string) map[string]bool {
	statusByID := make(map[string]bool, len(conversationIDs))
	if model.DB == nil || len(conversationIDs) == 0 {
		return statusByID
	}
	if !openClawMessageProjectionReadEnabled() && !openClawMessageProjectionWriteEnabled() {
		return statusByID
	}
	if !s.agentAllowsProjection(req) {
		return statusByID
	}
	ids := make([]string, 0, len(conversationIDs))
	seen := map[string]struct{}{}
	for _, id := range conversationIDs {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	if len(ids) == 0 {
		return statusByID
	}

	var conversations []model.Conversation
	if err := model.DB.WithContext(ctx).
		Where("eid = ? AND user_id = ? AND agent_id = ? AND source = ? AND channel_conversation_id IN ? AND deleted_time = 0 AND status <> ?", req.EID, req.UserID, req.AgentID, openClawProjectionSource, ids, model.ConversationStatusDeleted).
		Find(&conversations).Error; err != nil {
		logger.Warnf(ctx, "OpenClaw message projection cached-history status read failed: %v", err)
		return statusByID
	}
	if len(conversations) == 0 {
		return statusByID
	}
	conversationIDsByInternalID := make(map[int64]string, len(conversations))
	internalIDs := make([]int64, 0, len(conversations))
	for _, conversation := range conversations {
		if strings.TrimSpace(conversation.ChannelConversationID) == "" {
			continue
		}
		conversationIDsByInternalID[conversation.ConversationID] = conversation.ChannelConversationID
		internalIDs = append(internalIDs, conversation.ConversationID)
	}
	if len(internalIDs) == 0 {
		return statusByID
	}

	var rows []struct {
		ConversationID int64 `gorm:"column:conversation_id"`
		Count          int64 `gorm:"column:count"`
	}
	if err := model.DB.WithContext(ctx).Model(&model.Message{}).
		Select("conversation_id, COUNT(*) AS count").
		Where("eid = ? AND agent_id = ? AND user_id = ? AND conversation_id IN ? AND openclaw_projection_key <> ?", req.EID, req.AgentID, req.UserID, internalIDs, "").
		Group("conversation_id").
		Find(&rows).Error; err != nil {
		logger.Warnf(ctx, "OpenClaw message projection cached-history message count failed: %v", err)
		return statusByID
	}
	for _, row := range rows {
		if row.Count <= 0 {
			continue
		}
		if externalID := conversationIDsByInternalID[row.ConversationID]; externalID != "" {
			statusByID[externalID] = true
		}
	}
	return statusByID
}

func (s *OpenClawMessageProjectionService) MarkConversationDeleted(ctx context.Context, req OpenClawRequestContext, conversationID string) {
	if model.DB == nil || strings.TrimSpace(conversationID) == "" {
		return
	}
	if !openClawMessageProjectionWriteEnabled() && !openClawMessageProjectionReadEnabled() {
		return
	}
	if !s.agentAllowsProjection(req) {
		return
	}
	now := time.Now().UTC().UnixMilli()
	err := model.DB.WithContext(ctx).Model(&model.Conversation{}).
		Where("eid = ? AND user_id = ? AND agent_id = ? AND source = ? AND channel_conversation_id = ?", req.EID, req.UserID, req.AgentID, openClawProjectionSource, conversationID).
		Updates(map[string]interface{}{
			"status":       model.ConversationStatusDeleted,
			"deleted_time": now,
		}).Error
	if err != nil {
		logger.Warnf(ctx, "OpenClaw message projection mark deleted failed: %v", err)
	}
}

func (s *OpenClawMessageProjectionService) MarkConversationsMissingFromFreshList(ctx context.Context, req OpenClawRequestContext, liveConversationIDs []string) {
	if model.DB == nil {
		return
	}
	if !openClawMessageProjectionWriteEnabled() && !openClawMessageProjectionReadEnabled() {
		return
	}
	if !s.agentAllowsProjection(req) {
		return
	}
	query := model.DB.WithContext(ctx).Model(&model.Conversation{}).
		Where("eid = ? AND user_id = ? AND agent_id = ? AND source = ? AND deleted_time = 0", req.EID, req.UserID, req.AgentID, openClawProjectionSource)
	if len(liveConversationIDs) > 0 {
		query = query.Where("channel_conversation_id NOT IN ?", liveConversationIDs)
	}
	now := time.Now().UTC().UnixMilli()
	if err := query.Updates(map[string]interface{}{
		"status":       model.ConversationStatusDeleted,
		"deleted_time": now,
	}).Error; err != nil {
		logger.Warnf(ctx, "OpenClaw message projection mark missing conversations deleted failed: %v", err)
	}
}

func (s *OpenClawMessageProjectionService) agentAllowsProjection(req OpenClawRequestContext) bool {
	agent, err := model.GetAgentByID(req.EID, req.AgentID)
	return err == nil && agent != nil && agent.IsOpenClawWSCompatible()
}

func buildOpenClawMessageProjections(req OpenClawRequestContext, data json.RawMessage) []openClawMessageProjection {
	payload, ok := openClawJSONPayloadMap(data)
	if !ok {
		return nil
	}
	byKey := map[string]*openClawMessageProjection{}
	for _, ledger := range extractOpenClawProjectionLedgerRecords(payload) {
		applyOpenClawLedgerRecordToProjection(req, byKey, ledger)
	}
	applyOpenClawMessagesToProjection(req, byKey, payload)

	projections := make([]openClawMessageProjection, 0, len(byKey))
	for _, projection := range byKey {
		if projection == nil {
			continue
		}
		if strings.TrimSpace(projection.Question) == "" && strings.TrimSpace(projection.Answer) == "" && len(projection.OutputFiles) == 0 {
			continue
		}
		if projection.Status == "" {
			if strings.TrimSpace(projection.Answer) != "" || len(projection.OutputFiles) > 0 {
				projection.Status = model.AgentRunStatusCompleted
			} else {
				projection.Status = model.AgentRunStatusRunning
			}
		}
		if projection.CreatedTime == 0 {
			projection.CreatedTime = openClawMirrorNow()
		}
		if projection.UpdatedTime == 0 {
			projection.UpdatedTime = projection.CreatedTime
		}
		projections = append(projections, *projection)
	}
	sort.SliceStable(projections, func(i, j int) bool {
		if projections[i].SeqStart != projections[j].SeqStart {
			return projections[i].SeqStart < projections[j].SeqStart
		}
		if projections[i].CreatedTime != projections[j].CreatedTime {
			return projections[i].CreatedTime < projections[j].CreatedTime
		}
		return projections[i].ProjectionKey < projections[j].ProjectionKey
	})
	return projections
}

func extractOpenClawProjectionLedgerRecords(payload map[string]interface{}) []map[string]interface{} {
	var records []map[string]interface{}
	seen := map[string]struct{}{}
	for _, key := range []string{"ledger_events", "ledgerEvents", "recent_events", "recentEvents", "events"} {
		for _, item := range openClawJSONList(payload[key]) {
			record, ok := item.(map[string]interface{})
			if !ok {
				continue
			}
			ledger := openClawMirrorLedgerRecord(record)
			if ledger == nil {
				continue
			}
			if version := openClawRecordString(ledger, "protocol_version", "protocolVersion"); version != "" && version != "openclaw.ledger.v1" {
				continue
			}
			key := openClawProjectionLedgerDedupeKey(ledger)
			if key == "" {
				key = openClawProjectionLedgerDedupeKey(record)
			}
			if key != "" {
				if _, ok := seen[key]; ok {
					continue
				}
				seen[key] = struct{}{}
			}
			records = append(records, ledger)
		}
	}
	sort.SliceStable(records, func(i, j int) bool {
		leftSeq := openClawNumber(records[i]["seq"])
		rightSeq := openClawNumber(records[j]["seq"])
		if leftSeq != rightSeq {
			return leftSeq < rightSeq
		}
		return openClawRecordString(records[i], "part_id", "partId") < openClawRecordString(records[j], "part_id", "partId")
	})
	return records
}

func openClawProjectionLedgerDedupeKey(record map[string]interface{}) string {
	if record == nil {
		return ""
	}
	if ref := openClawRecordString(record, "raw_event_ref", "rawEventRef", "id", "event_id", "eventId"); ref != "" {
		return ref
	}
	sessionID := openClawRecordString(record, "session_id", "sessionId", "conversation_id", "conversationId")
	turnID := openClawRecordString(record, "turn_id", "turnId")
	partID := openClawRecordString(record, "part_id", "partId")
	eventType := openClawRecordString(record, "event_type", "eventType")
	seq := openClawNumber(record["seq"])
	if sessionID == "" && turnID == "" && partID == "" && eventType == "" && seq == 0 {
		return ""
	}
	return fmt.Sprintf("%s:%d:%s:%s:%s", sessionID, seq, turnID, partID, eventType)
}

func applyOpenClawLedgerRecordToProjection(req OpenClawRequestContext, byKey map[string]*openClawMessageProjection, record map[string]interface{}) {
	turnID := openClawRecordString(record, "turn_id", "turnId")
	requestID := openClawRecordString(record, "active_request_id", "activeRequestId", "run_id", "runId", "request_id", "requestId")
	if turnID == "" {
		return
	}
	projection := ensureOpenClawProjection(req, byKey, turnID, requestID)
	seq := openClawNumber(record["seq"])
	projection.addSeq(seq)
	if ts := openClawProjectionTimestamp(record["created_at"]); ts > 0 {
		projection.addTimestamp(ts)
	}
	partType := strings.ToLower(openClawRecordString(record, "part_type", "partType", "segment_type", "segmentType"))
	eventType := strings.ToLower(openClawRecordString(record, "event_type", "eventType", "kind", "type"))
	operation := strings.ToLower(openClawRecordString(record, "operation"))
	visibility := strings.ToLower(openClawRecordString(record, "visibility"))
	text := openClawProjectionRecordText(record)
	payload := openClawProjectionPayloadMap(record)

	switch {
	case eventType == "turn.started" || partType == "user" || openClawProjectionPayloadSourceKind(payload) == "user.message":
		if projection.Question == "" {
			projection.Question = text
		}
		if projection.Status == "" {
			projection.Status = model.AgentRunStatusRunning
		}
	case partType == "answer" || strings.Contains(eventType, "answer"):
		if text != "" {
			if operation == "append" && visibility == "stream" {
				projection.Answer += text
			} else {
				projection.Answer = text
			}
		}
	case partType == "thinking" || strings.Contains(eventType, "thinking"):
		if text != "" {
			projection.Reasoning = mergeOpenClawProjectionText(projection.Reasoning, text)
			projection.Activities = append(projection.Activities, map[string]interface{}{
				"kind":    "assistant.thinking",
				"summary": text,
				"seq":     seq,
			})
		}
	case partType == "tool" || strings.Contains(eventType, "tool"):
		name := openClawRecordString(payload, "tool_name", "toolName", "name")
		projection.Activities = append(projection.Activities, map[string]interface{}{
			"kind":    "tool",
			"summary": strings.TrimSpace(strings.Join([]string{name, text}, " ")),
			"seq":     seq,
		})
	case partType == "output_file" || partType == "output_files":
		projection.OutputFiles = mergeOpenClawProjectionFiles(projection.OutputFiles, openClawProjectionOutputFiles(payload))
	}

	if files := openClawProjectionOutputFiles(payload); len(files) > 0 {
		projection.OutputFiles = mergeOpenClawProjectionFiles(projection.OutputFiles, files)
	}
	if item := openClawProjectionTimelineItem(record, payload, text); item != nil {
		projection.TimelineItems = append(projection.TimelineItems, item)
	}
	if status := normalizeOpenClawProjectionStatus(openClawRecordString(record, "terminal_status", "terminalStatus", "status", "state")); status != "" {
		projection.Status = status
	}
	switch eventType {
	case "turn.interrupted", "run.interrupted":
		projection.Status = "interrupted"
	case "turn.failed", "run.failed":
		projection.Status = model.AgentRunStatusFailed
	case "turn.completed", "run.completed":
		projection.Status = model.AgentRunStatusCompleted
	}
}

func ensureOpenClawProjection(req OpenClawRequestContext, byKey map[string]*openClawMessageProjection, turnID string, requestID string) *openClawMessageProjection {
	key := openClawProjectionKey(turnID, requestID)
	if projection := byKey[key]; projection != nil {
		if projection.TurnID == "" {
			projection.TurnID = turnID
		}
		if projection.RequestID == "" {
			projection.RequestID = requestID
		}
		return projection
	}
	projection := &openClawMessageProjection{
		ConversationID: req.ConversationID,
		ProjectionKey:  key,
		TurnID:         turnID,
		RequestID:      requestID,
	}
	byKey[key] = projection
	return projection
}

func openClawProjectionKey(turnID string, requestID string) string {
	turnID = strings.TrimSpace(turnID)
	if turnID != "" {
		return "turn:" + turnID
	}
	requestID = strings.TrimSpace(requestID)
	if requestID != "" {
		return "request:" + requestID
	}
	return ""
}

func findOpenClawProjectionByRequestID(byKey map[string]*openClawMessageProjection, requestID string) *openClawMessageProjection {
	requestID = strings.TrimSpace(requestID)
	if requestID == "" {
		return nil
	}
	for _, p := range byKey {
		if p.RequestID == requestID {
			return p
		}
	}
	return nil
}

func applyOpenClawMessagesToProjection(req OpenClawRequestContext, byKey map[string]*openClawMessageProjection, payload map[string]interface{}) {
	messages := openClawJSONList(payload["messages"])
	if len(messages) == 0 {
		return
	}
	existing := orderedOpenClawMessageProjections(byKey)
	existingIndex := 0
	var pending *openClawMessageProjection
	legacyIndex := 0
	for _, item := range messages {
		record, ok := item.(map[string]interface{})
		if !ok {
			continue
		}
		role := strings.ToLower(openClawRecordString(record, "role", "sender", "author"))
		turnID := openClawRecordString(record, "turn_id", "turnId")
		requestID := openClawRecordString(record, "active_request_id", "activeRequestId", "request_id", "requestId", "run_id", "runId")
		if turnID != "" {
			pending = ensureOpenClawProjection(req, byKey, turnID, requestID)
		} else if requestID != "" {
			pending = findOpenClawProjectionByRequestID(byKey, requestID)
			if pending == nil {
				pending = ensureOpenClawProjection(req, byKey, "", requestID)
			}
		}
		selectedExisting := false
		if turnID == "" && requestID == "" && len(existing) > 0 {
			if role == "user" && (pending == nil || strings.TrimSpace(pending.Question) != "") && existingIndex < len(existing) {
				pending = existing[existingIndex]
				existingIndex++
				selectedExisting = true
			}
			if (role == "assistant" || role == "ai") && pending == nil && existingIndex < len(existing) {
				pending = existing[existingIndex]
				existingIndex++
				selectedExisting = true
			}
		}
		if pending == nil || (role == "user" && strings.TrimSpace(pending.Question) != "" && strings.TrimSpace(turnID) == "" && strings.TrimSpace(requestID) == "" && !selectedExisting && (len(existing) == 0 || existingIndex >= len(existing))) {
			legacyIndex++
			pending = ensureOpenClawProjection(req, byKey, fmt.Sprintf("%s:legacy:%d", req.ConversationID, legacyIndex), "")
		}
		if pending == nil {
			continue
		}
		seq := maxOpenClawSeqInValue(record)
		pending.addSeq(seq)
		if ts := openClawProjectionTimestamp(firstOpenClawProjectionValue(record, "created_at", "createdAt", "timestamp", "time")); ts > 0 {
			pending.addTimestamp(ts)
		}
		content := openClawProjectionFirstText(record, "content", "text", "message", "input", "prompt", "question", "answer")
		switch role {
		case "user":
			if content != "" {
				pending.Question = content
			}
		case "assistant", "ai":
			if content != "" && !isWeakOpenClawProjectionAnswer(content) {
				pending.Answer = content
			}
		}
		pending.OutputFiles = mergeOpenClawProjectionFiles(pending.OutputFiles, openClawProjectionOutputFiles(record))
		if reasoning := openClawRecordString(record, "reasoning_content", "reasoningContent", "reasoning", "thinking"); reasoning != "" {
			pending.Reasoning = mergeOpenClawProjectionText(pending.Reasoning, reasoning)
		}
	}
}

func orderedOpenClawMessageProjections(byKey map[string]*openClawMessageProjection) []*openClawMessageProjection {
	projections := make([]*openClawMessageProjection, 0, len(byKey))
	for _, projection := range byKey {
		if projection != nil {
			projections = append(projections, projection)
		}
	}
	sort.SliceStable(projections, func(i, j int) bool {
		if projections[i].SeqStart != projections[j].SeqStart {
			return projections[i].SeqStart < projections[j].SeqStart
		}
		if projections[i].CreatedTime != projections[j].CreatedTime {
			return projections[i].CreatedTime < projections[j].CreatedTime
		}
		return projections[i].ProjectionKey < projections[j].ProjectionKey
	})
	return projections
}

func (p *openClawMessageProjection) addSeq(seq int64) {
	if seq <= 0 {
		return
	}
	if p.SeqStart == 0 || seq < p.SeqStart {
		p.SeqStart = seq
	}
	if seq > p.SeqEnd {
		p.SeqEnd = seq
	}
}

func (p *openClawMessageProjection) addTimestamp(ts int64) {
	if ts <= 0 {
		return
	}
	if p.CreatedTime == 0 || ts < p.CreatedTime {
		p.CreatedTime = ts
	}
	if ts > p.UpdatedTime {
		p.UpdatedTime = ts
	}
}

func firstOpenClawProjectionValue(record map[string]interface{}, keys ...string) interface{} {
	for _, key := range keys {
		if value, ok := record[key]; ok {
			return value
		}
	}
	return nil
}

func openClawProjectionTimestamp(value interface{}) int64 {
	switch typed := value.(type) {
	case int64:
		return normalizeOpenClawProjectionUnixTime(typed)
	case int:
		return normalizeOpenClawProjectionUnixTime(int64(typed))
	case float64:
		return normalizeOpenClawProjectionUnixTime(int64(typed))
	case json.Number:
		next, _ := typed.Int64()
		return normalizeOpenClawProjectionUnixTime(next)
	case string:
		trimmed := strings.TrimSpace(typed)
		if trimmed == "" {
			return 0
		}
		if parsed, err := time.Parse(time.RFC3339Nano, trimmed); err == nil {
			return parsed.UTC().UnixMilli()
		}
		if parsed, err := time.Parse(time.RFC3339, trimmed); err == nil {
			return parsed.UTC().UnixMilli()
		}
	}
	return 0
}

func normalizeOpenClawProjectionUnixTime(value int64) int64 {
	if value <= 0 {
		return 0
	}
	if value < 1_000_000_000_000 {
		return value * 1000
	}
	return value
}

func openClawProjectionPayloadMap(record map[string]interface{}) map[string]interface{} {
	if payload, ok := record["payload"].(map[string]interface{}); ok {
		return payload
	}
	return map[string]interface{}{}
}

func openClawProjectionPayloadSourceKind(payload map[string]interface{}) string {
	return strings.ToLower(openClawRecordString(payload, "source_kind", "sourceKind", "kind", "type"))
}

func openClawProjectionRecordText(record map[string]interface{}) string {
	if text := openClawProjectionFirstText(record, "text", "content", "message", "input", "prompt", "question"); text != "" {
		return text
	}
	payload := openClawProjectionPayloadMap(record)
	return openClawProjectionFirstText(payload, "content", "text", "message", "userMessage", "user_message", "input", "prompt", "question", "answer", "visible_answer", "visibleAnswer")
}

func openClawProjectionFirstText(value interface{}, keys ...string) string {
	return openClawProjectionFirstTextValue(value, 0, keys...)
}

func openClawProjectionFirstTextValue(value interface{}, depth int, keys ...string) string {
	if depth > 6 {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case map[string]interface{}:
		if typed == nil {
			return ""
		}
		if text := openClawProjectionDirectString(typed, keys...); text != "" {
			return text
		}
		for _, key := range keys {
			if text := openClawProjectionFirstTextValue(typed[key], depth+1, "content", "text", "message", "userMessage", "user_message", "input", "prompt", "question"); text != "" {
				return text
			}
		}
		for _, key := range []string{"payload", "data", "raw", "body", "messages"} {
			if text := openClawProjectionFirstTextValue(typed[key], depth+1, "content", "text", "message", "userMessage", "user_message", "input", "prompt", "question"); text != "" {
				return text
			}
		}
	case []interface{}:
		for _, item := range typed {
			if text := openClawProjectionFirstTextValue(item, depth+1, "content", "text", "message", "userMessage", "user_message", "input", "prompt", "question"); text != "" {
				return text
			}
		}
	}
	return ""
}

func openClawProjectionDirectString(record map[string]interface{}, keys ...string) string {
	for _, key := range keys {
		if value, ok := record[key].(string); ok {
			if text := strings.TrimSpace(value); text != "" {
				return text
			}
		}
	}
	return ""
}

func mergeOpenClawProjectionText(existing string, incoming string) string {
	incoming = strings.TrimSpace(incoming)
	if incoming == "" {
		return existing
	}
	existing = strings.TrimSpace(existing)
	if existing == "" {
		return incoming
	}
	if strings.Contains(existing, incoming) {
		return existing
	}
	return existing + "\n\n" + incoming
}

func openClawProjectionOutputFiles(record map[string]interface{}) []interface{} {
	var files []interface{}
	appendFiles := func(list []interface{}) {
		for _, item := range list {
			if sanitized := sanitizeOpenClawProjectionFile(item); sanitized != nil {
				files = append(files, sanitized)
			}
		}
	}
	appendFiles(openClawJSONList(record["files"]))
	appendFiles(openClawJSONList(record["output_files"]))
	appendFiles(openClawJSONList(record["outputFiles"]))
	appendFiles(openClawJSONList(record["media_attachments"]))
	appendFiles(openClawJSONList(record["mediaAttachments"]))
	if processStep, ok := record["process_step"].(map[string]interface{}); ok {
		if data, ok := processStep["data"].(map[string]interface{}); ok {
			appendFiles(openClawJSONList(data["files"]))
			appendFiles(openClawJSONList(data["media_attachments"]))
			appendFiles(openClawJSONList(data["mediaAttachments"]))
		}
	}
	if data, ok := record["data"].(map[string]interface{}); ok {
		appendFiles(openClawJSONList(data["files"]))
		appendFiles(openClawJSONList(data["media_attachments"]))
		appendFiles(openClawJSONList(data["mediaAttachments"]))
	}
	return files
}

func sanitizeOpenClawProjectionFile(value interface{}) interface{} {
	file, ok := value.(map[string]interface{})
	if !ok {
		return value
	}
	next := make(map[string]interface{}, len(file))
	for key, item := range file {
		switch key {
		case "base64", "content":
			continue
		default:
			next[key] = item
		}
	}
	return next
}

func mergeOpenClawProjectionFiles(existing []interface{}, incoming []interface{}) []interface{} {
	if len(incoming) == 0 {
		return existing
	}
	next := append([]interface{}{}, existing...)
	indexByKey := map[string]int{}
	for index, item := range next {
		if key := openClawProjectionFileKey(item); key != "" {
			indexByKey[key] = index
		}
	}
	for _, item := range incoming {
		key := openClawProjectionFileKey(item)
		if key != "" {
			if index, ok := indexByKey[key]; ok {
				next[index] = mergeOpenClawProjectionFile(next[index], item)
				continue
			}
			indexByKey[key] = len(next)
		}
		next = append(next, item)
	}
	return next
}

func openClawProjectionFileKey(value interface{}) string {
	file, ok := value.(map[string]interface{})
	if !ok {
		return ""
	}
	return openClawRecordString(file, "artifact_id", "artifactId", "upload_file_id", "uploadFileId", "id", "file_id", "fileId", "preview_key", "previewKey", "sha256", "url")
}

func mergeOpenClawProjectionFile(existing interface{}, incoming interface{}) interface{} {
	existingMap, existingOK := existing.(map[string]interface{})
	incomingMap, incomingOK := incoming.(map[string]interface{})
	if !existingOK || !incomingOK {
		return incoming
	}
	next := make(map[string]interface{}, len(existingMap)+len(incomingMap))
	for key, value := range incomingMap {
		next[key] = value
	}
	for key, value := range existingMap {
		if value != nil && fmt.Sprint(value) != "" {
			next[key] = value
		}
	}
	return next
}

func openClawProjectionTimelineItem(record map[string]interface{}, payload map[string]interface{}, text string) interface{} {
	seq := openClawNumber(record["seq"])
	partType := openClawRecordString(record, "part_type", "partType", "event_type", "eventType")
	if partType == "" && text == "" {
		return nil
	}
	item := map[string]interface{}{
		"seq":  seq,
		"type": partType,
	}
	if text != "" {
		item["content"] = truncateOpenClawProjectionString(text, 2000)
	}
	if files := openClawProjectionOutputFiles(payload); len(files) > 0 {
		item["outputFiles"] = files
	}
	return item
}

func normalizeOpenClawProjectionStatus(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "running", "streaming", "pending", "queued":
		return model.AgentRunStatusRunning
	case "completed", "complete", "done", "success":
		return model.AgentRunStatusCompleted
	case "failed", "error":
		return model.AgentRunStatusFailed
	case "cancelled", "canceled":
		return model.AgentRunStatusCancelled
	case "interrupted":
		return "interrupted"
	default:
		return ""
	}
}

func isWeakOpenClawProjectionAnswer(value string) bool {
	normalized := strings.ToUpper(strings.TrimSpace(value))
	return normalized == "" || normalized == "HEARTBEAT_OK" || normalized == "NO_REPLY" || normalized == "--"
}

func (s *OpenClawMessageProjectionService) upsertProjectionConversationMetadata(tx *gorm.DB, req OpenClawRequestContext, session map[string]interface{}, seenTime int64) error {
	conversationID := openClawProjectionSessionID(session)
	if conversationID == "" {
		return nil
	}
	title := openClawProjectionMeaningfulSessionTitle(session, conversationID)
	createdTime := openClawProjectionTimestamp(firstOpenClawProjectionValue(session, "created_at", "createdAt", "created_time", "createdTime"))
	if createdTime <= 0 {
		createdTime = seenTime
	}
	updatedTime := seenTime
	if updatedTime <= 0 {
		updatedTime = openClawProjectionTimestamp(firstOpenClawProjectionValue(session, "updated_at", "updatedAt", "updated_time", "updatedTime", "last_seen_time", "lastSeenTime"))
	}
	if updatedTime <= 0 {
		updatedTime = openClawMirrorNow()
	}
	lastMessage := openClawProjectionSessionLastMessage(session)

	var conversation model.Conversation
	err := tx.Where(
		"eid = ? AND user_id = ? AND agent_id = ? AND source = ? AND channel_conversation_id = ?",
		req.EID,
		req.UserID,
		req.AgentID,
		openClawProjectionSource,
		conversationID,
	).Order("conversation_id DESC").First(&conversation).Error
	if err == nil {
		updates := map[string]interface{}{
			"status":       model.ConversationStatusActive,
			"deleted_time": int64(0),
			"updated_time": updatedTime,
		}
		if title != "" && shouldReplaceOpenClawProjectionTitle(conversation.Title, title, conversationID) {
			updates["title"] = title
		}
		if lastMessage != "" {
			updates["last_message"] = lastMessage
		}
		if conversation.CreatedTime == 0 && createdTime > 0 {
			updates["created_time"] = createdTime
		}
		if err := tx.Model(&conversation).UpdateColumns(updates).Error; err != nil {
			return err
		}
		return nil
	}
	if err != nil && err != gorm.ErrRecordNotFound {
		return err
	}
	if title == "" {
		title = truncateOpenClawProjectionString(conversationID, 80)
	}
	conversation = model.Conversation{
		Eid:                   req.EID,
		UserID:                req.UserID,
		AgentID:               req.AgentID,
		Source:                openClawProjectionSource,
		Title:                 title,
		Status:                model.ConversationStatusActive,
		ConversationType:      model.ConversationTypeDebug,
		LastMessage:           lastMessage,
		ChannelConversationID: conversationID,
		BaseModel: model.BaseModel{
			CreatedTime: createdTime,
			UpdatedTime: updatedTime,
		},
	}
	if err := tx.Create(&conversation).Error; err != nil {
		return err
	}
	if updatedTime > 0 {
		conversation.UpdatedTime = updatedTime
		if err := tx.Model(&conversation).UpdateColumn("updated_time", updatedTime).Error; err != nil {
			return err
		}
	}
	return nil
}

func openClawProjectionSessionID(session map[string]interface{}) string {
	return openClawRecordString(session, "id", "conversation_id", "conversationId", "session_id", "sessionId")
}

func openClawProjectionRawSessionTitle(session map[string]interface{}) string {
	return openClawRecordString(session, "title", "name", "label")
}

func openClawProjectionMeaningfulSessionTitle(session map[string]interface{}, conversationID string) string {
	title := strings.TrimSpace(openClawProjectionRawSessionTitle(session))
	if isOpenClawProjectionPlaceholderTitle(title, conversationID) {
		return ""
	}
	return truncateOpenClawProjectionString(title, 80)
}

func isOpenClawProjectionPlaceholderTitle(title string, conversationID string) bool {
	normalized := strings.TrimSpace(title)
	if normalized == "" {
		return true
	}
	if conversationID != "" && normalized == strings.TrimSpace(conversationID) {
		return true
	}
	lower := strings.ToLower(normalized)
	return lower == "claw control center" || lower == "openclaw control center"
}

func shouldReplaceOpenClawProjectionTitle(existing string, incoming string, conversationID string) bool {
	incoming = strings.TrimSpace(incoming)
	if incoming == "" || isOpenClawProjectionPlaceholderTitle(incoming, conversationID) {
		return false
	}
	existing = strings.TrimSpace(existing)
	if existing == "" || isOpenClawProjectionPlaceholderTitle(existing, conversationID) {
		return true
	}
	return existing != incoming
}

func openClawProjectionSessionLastMessage(session map[string]interface{}) string {
	return truncateOpenClawProjectionString(openClawRecordString(session, "last_message", "lastMessage", "lastMessageContent", "summary", "preview"), 500)
}

func (s *OpenClawMessageProjectionService) upsertProjections(ctx context.Context, req OpenClawRequestContext, projections []openClawMessageProjection) error {
	return model.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for _, projection := range projections {
			conversation, err := s.ensureProjectionConversation(tx, req, projection)
			if err != nil {
				return err
			}
			if err := s.upsertProjectionMessage(tx, req, conversation, projection); err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *OpenClawMessageProjectionService) ensureProjectionConversation(tx *gorm.DB, req OpenClawRequestContext, projection openClawMessageProjection) (*model.Conversation, error) {
	var conversation model.Conversation
	err := tx.Where(
		"eid = ? AND user_id = ? AND agent_id = ? AND source = ? AND channel_conversation_id = ?",
		req.EID,
		req.UserID,
		req.AgentID,
		openClawProjectionSource,
		req.ConversationID,
	).Order("conversation_id DESC").First(&conversation).Error
	if err == nil {
		updates := map[string]interface{}{}
		if conversation.Status == model.ConversationStatusDeleted || conversation.DeletedTime > 0 {
			updates["status"] = model.ConversationStatusActive
			updates["deleted_time"] = int64(0)
		}
		lastMessage := openClawProjectionLastMessage(projection)
		if lastMessage != "" {
			updates["last_message"] = lastMessage
		}
		if title := openClawProjectionConversationTitle(projection, req.ConversationID); strings.TrimSpace(conversation.Title) == "" && title != "" {
			updates["title"] = title
		}
		if len(updates) > 0 {
			if err := tx.Model(&conversation).Updates(updates).Error; err != nil {
				return nil, err
			}
			for key, value := range updates {
				switch key {
				case "status":
					conversation.Status = value.(int)
				case "deleted_time":
					conversation.DeletedTime = value.(int64)
				case "last_message":
					conversation.LastMessage = value.(string)
				case "title":
					conversation.Title = value.(string)
				}
			}
		}
		return &conversation, nil
	}
	if err != nil && err != gorm.ErrRecordNotFound {
		return nil, err
	}
	now := openClawMirrorNow()
	if projection.CreatedTime > 0 {
		now = projection.CreatedTime
	}
	conversation = model.Conversation{
		Eid:                   req.EID,
		UserID:                req.UserID,
		AgentID:               req.AgentID,
		Source:                openClawProjectionSource,
		Title:                 openClawProjectionConversationTitle(projection, req.ConversationID),
		Status:                model.ConversationStatusActive,
		ConversationType:      model.ConversationTypeDebug,
		LastMessage:           openClawProjectionLastMessage(projection),
		ChannelConversationID: req.ConversationID,
		BaseModel: model.BaseModel{
			CreatedTime: now,
			UpdatedTime: now,
		},
	}
	if err := tx.Create(&conversation).Error; err != nil {
		return nil, err
	}
	return &conversation, nil
}

func (s *OpenClawMessageProjectionService) upsertProjectionMessage(tx *gorm.DB, req OpenClawRequestContext, conversation *model.Conversation, projection openClawMessageProjection) error {
	projectionJSON, projectionScore, err := marshalOpenClawProjectionJSON(projection)
	if err != nil {
		return err
	}
	var existing model.Message
	err = tx.Where(
		"eid = ? AND agent_id = ? AND user_id = ? AND conversation_id = ? AND openclaw_projection_key = ?",
		req.EID,
		req.AgentID,
		req.UserID,
		conversation.ConversationID,
		projection.ProjectionKey,
	).First(&existing).Error
	if err == nil {
		if projection.SeqEnd > 0 && existing.OpenClawSeqEnd > 0 && projection.SeqEnd < existing.OpenClawSeqEnd {
			return nil
		}
		if projection.SeqEnd == existing.OpenClawSeqEnd && projectionScore < openClawProjectionMessageScore(existing) {
			return nil
		}
		updates := map[string]interface{}{
			"answer":                   projection.Answer,
			"reasoning_content":        projection.Reasoning,
			"request_id":               projection.RequestID,
			"openclaw_turn_id":         projection.TurnID,
			"openclaw_seq_start":       projection.SeqStart,
			"openclaw_seq_end":         projection.SeqEnd,
			"openclaw_status":          projection.Status,
			"openclaw_projection_json": projectionJSON,
			"openclaw_projection_key":  projection.ProjectionKey,
			"updated_time":             maxOpenClawInt64(projection.UpdatedTime, openClawMirrorNow()),
			"response_status":          model.ResponseStatusNormal,
			"request_source":           openClawProjectionSource,
			"conversation_id":          conversation.ConversationID,
			"agent_id":                 req.AgentID,
			"user_id":                  req.UserID,
			"eid":                      req.EID,
		}
		if strings.TrimSpace(projection.Question) != "" {
			updates["message"] = projection.Question
			updates["original_question"] = projection.Question
			existing.Message = projection.Question
			existing.OriginalQuestion = projection.Question
		}
		if err := tx.Model(&existing).Updates(updates).Error; err != nil {
			return err
		}
		existing.Answer = projection.Answer
		existing.ReasoningContent = projection.Reasoning
		existing.OpenClawProjectionJSON = projectionJSON
		existing.OpenClawSeqEnd = projection.SeqEnd
		return s.replaceProjectionOutputFileStep(tx, existing.ID, req.EID, projection)
	}
	if err != nil && err != gorm.ErrRecordNotFound {
		return err
	}
	// Legacy dedup: same (seq_start, seq_end) may exist under a different legacy index
	// from a prior call that reset the index counter. Update in-place instead of INSERTing a duplicate.
	if projection.SeqStart > 0 && strings.Contains(projection.ProjectionKey, ":legacy:") {
		var legacyProj model.Message
		if legacyErr := tx.Where(
			"eid = ? AND agent_id = ? AND user_id = ? AND conversation_id = ? AND openclaw_projection_key LIKE ? AND openclaw_seq_start = ? AND openclaw_seq_end = ?",
			req.EID, req.AgentID, req.UserID, conversation.ConversationID,
			"%:legacy:%",
			projection.SeqStart, projection.SeqEnd,
		).First(&legacyProj).Error; legacyErr == nil {
			existing = legacyProj
			if projection.SeqEnd > 0 && existing.OpenClawSeqEnd > 0 && projection.SeqEnd < existing.OpenClawSeqEnd {
				return nil
			}
			if projection.SeqEnd == existing.OpenClawSeqEnd && projectionScore < openClawProjectionMessageScore(existing) {
				return nil
			}
			updates := map[string]interface{}{
				"answer":                   projection.Answer,
				"reasoning_content":        projection.Reasoning,
				"request_id":               projection.RequestID,
				"openclaw_turn_id":         projection.TurnID,
				"openclaw_seq_start":       projection.SeqStart,
				"openclaw_seq_end":         projection.SeqEnd,
				"openclaw_status":          projection.Status,
				"openclaw_projection_json": projectionJSON,
				"openclaw_projection_key":  projection.ProjectionKey,
				"updated_time":             maxOpenClawInt64(projection.UpdatedTime, openClawMirrorNow()),
				"response_status":          model.ResponseStatusNormal,
				"request_source":           openClawProjectionSource,
				"conversation_id":          conversation.ConversationID,
				"agent_id":                 req.AgentID,
				"user_id":                  req.UserID,
				"eid":                      req.EID,
			}
			if strings.TrimSpace(projection.Question) != "" {
				updates["message"] = projection.Question
				updates["original_question"] = projection.Question
			}
			if err := tx.Model(&existing).Updates(updates).Error; err != nil {
				return err
			}
			existing.Answer = projection.Answer
			existing.ReasoningContent = projection.Reasoning
			existing.OpenClawProjectionJSON = projectionJSON
			existing.OpenClawSeqEnd = projection.SeqEnd
			return s.replaceProjectionOutputFileStep(tx, existing.ID, req.EID, projection)
		}
	}
	message := model.Message{
		Eid:                    req.EID,
		UserID:                 req.UserID,
		AgentID:                req.AgentID,
		ConversationID:         conversation.ConversationID,
		Message:                projection.Question,
		Answer:                 projection.Answer,
		ReasoningContent:       projection.Reasoning,
		RequestId:              projection.RequestID,
		ResponseStatus:         model.ResponseStatusNormal,
		RequestSource:          openClawProjectionSource,
		OriginalQuestion:       projection.Question,
		OpenClawProjectionKey:  projection.ProjectionKey,
		OpenClawTurnID:         projection.TurnID,
		OpenClawSeqStart:       projection.SeqStart,
		OpenClawSeqEnd:         projection.SeqEnd,
		OpenClawStatus:         projection.Status,
		OpenClawProjectionJSON: projectionJSON,
		CreatedTime:            projection.CreatedTime,
		UpdatedTime:            projection.UpdatedTime,
	}
	if err := tx.Create(&message).Error; err != nil {
		return err
	}
	return s.replaceProjectionOutputFileStep(tx, message.ID, req.EID, projection)
}

func (s *OpenClawMessageProjectionService) replaceProjectionOutputFileStep(tx *gorm.DB, messageID int64, eid int64, projection openClawMessageProjection) error {
	if err := tx.Where("eid = ? AND message_id = ? AND step_code = ?", eid, messageID, "output_files").Delete(&model.MessageProcessStep{}).Error; err != nil {
		return err
	}
	if len(projection.OutputFiles) == 0 {
		return nil
	}
	data, err := json.Marshal(map[string]interface{}{
		"files":             projection.OutputFiles,
		"media_attachments": projection.OutputFiles,
	})
	if err != nil {
		return err
	}
	stepTime := projection.UpdatedTime / 1000
	if stepTime <= 0 {
		stepTime = openClawMirrorNow() / 1000
	}
	return tx.Create(&model.MessageProcessStep{
		Eid:           eid,
		MessageID:     messageID,
		RequestID:     projection.RequestID,
		StepCode:      "output_files",
		Name:          "生成文件",
		Status:        "completed",
		Message:       "生成文件",
		Data:          string(data),
		StepTimestamp: stepTime,
	}).Error
}

func marshalOpenClawProjectionJSON(projection openClawMessageProjection) (string, int, error) {
	payload := openClawProjectionJSONPayload(projection, false)
	raw, err := json.Marshal(payload)
	if err != nil {
		return "", 0, err
	}
	score := openClawProjectionCompletenessScore(payload)
	if len(raw) <= openClawMessageProjectionMaxJSONBytes {
		return string(raw), score, nil
	}
	compact := openClawProjectionJSONPayload(projection, true)
	raw, err = json.Marshal(compact)
	if err != nil {
		return "", 0, err
	}
	if len(raw) > openClawMessageProjectionMaxJSONBytes && openClawSnapshotDebugEnabled() {
		logger.Warnf(context.Background(), "OpenClaw projection JSON still exceeds cap after compaction: turn=%s bytes=%d", projection.TurnID, len(raw))
	}
	return string(raw), score, nil
}

func openClawProjectionJSONPayload(projection openClawMessageProjection, compact bool) map[string]interface{} {
	payload := map[string]interface{}{
		"projection_version": openClawProjectionVersion,
		"turn_id":            projection.TurnID,
		"request_id":         projection.RequestID,
		"seq":                projection.SeqEnd,
		"seq_start":          projection.SeqStart,
		"seq_end":            projection.SeqEnd,
		"status":             projection.Status,
		"visibleAnswer":      projection.Answer,
		"outputFiles":        projection.OutputFiles,
		"interrupted":        projection.Status == "interrupted",
		"failed":             projection.Status == model.AgentRunStatusFailed,
		"isStreaming":        projection.Status == model.AgentRunStatusRunning,
	}
	if compact {
		payload["timelineItems"] = []interface{}{}
		payload["activities"] = []interface{}{}
		return payload
	}
	payload["timelineItems"] = projection.TimelineItems
	payload["activities"] = projection.Activities
	return payload
}

func openClawProjectionCompletenessScore(payload map[string]interface{}) int {
	score := len(openClawRecordString(payload, "visibleAnswer"))
	score += 1000 * len(openClawJSONList(payload["outputFiles"]))
	score += 100 * len(openClawJSONList(payload["timelineItems"]))
	score += 50 * len(openClawJSONList(payload["activities"]))
	return score
}

func openClawProjectionMessageScore(message model.Message) int {
	payload, ok := openClawJSONPayloadMap(json.RawMessage(message.OpenClawProjectionJSON))
	if !ok {
		return len(message.Answer)
	}
	return openClawProjectionCompletenessScore(payload)
}

func openClawProjectionConversationTitle(projection openClawMessageProjection, fallback string) string {
	title := strings.TrimSpace(projection.Question)
	if title == "" {
		title = strings.TrimSpace(fallback)
	}
	if utf8.RuneCountInString(title) <= 80 {
		return title
	}
	runes := []rune(title)
	return string(runes[:80])
}

func openClawProjectionLastMessage(projection openClawMessageProjection) string {
	if answer := strings.TrimSpace(projection.Answer); answer != "" {
		return truncateOpenClawProjectionString(answer, 500)
	}
	if len(projection.OutputFiles) > 0 {
		return "生成文件"
	}
	return truncateOpenClawProjectionString(projection.Question, 500)
}

func truncateOpenClawProjectionString(value string, maxRunes int) string {
	value = strings.TrimSpace(value)
	if maxRunes <= 0 || utf8.RuneCountInString(value) <= maxRunes {
		return value
	}
	runes := []rune(value)
	return string(runes[:maxRunes])
}

func (s *OpenClawMessageProjectionService) messagesPayload(ctx context.Context, req OpenClawRequestContext) (json.RawMessage, bool, error) {
	var conversation model.Conversation
	err := model.DB.WithContext(ctx).
		Where("eid = ? AND user_id = ? AND agent_id = ? AND source = ? AND channel_conversation_id = ? AND deleted_time = 0", req.EID, req.UserID, req.AgentID, openClawProjectionSource, req.ConversationID).
		Order("conversation_id DESC").
		First(&conversation).Error
	if err == gorm.ErrRecordNotFound {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}

	query := model.DB.WithContext(ctx).Model(&model.Message{}).
		Where("eid = ? AND agent_id = ? AND user_id = ? AND conversation_id = ? AND openclaw_projection_key <> ?", req.EID, req.AgentID, req.UserID, conversation.ConversationID, "")
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, false, err
	}
	if total == 0 {
		return nil, false, nil
	}
	limit := req.Query.Limit
	if limit == 0 {
		limit = openClawDefaultPageLimit
	}
	if limit > openClawMaxPageLimit {
		limit = openClawMaxPageLimit
	}
	offset := req.Query.Offset
	var newest []model.Message
	if err := query.
		Order("openclaw_seq_start DESC").
		Order("id DESC").
		Limit(limit).
		Offset(offset).
		Find(&newest).Error; err != nil {
		return nil, false, err
	}
	for i, j := 0, len(newest)-1; i < j; i, j = i+1, j-1 {
		newest[i], newest[j] = newest[j], newest[i]
	}
	newest = collapseOpenClawProjectionMessagePage(newest)
	if hasOpenClawProjectionBlankQuestions(newest) {
		if recovered, err := s.recoverProjectionQuestionsFromMirror(ctx, req, newest); err != nil {
			logger.Warnf(ctx, "OpenClaw projection question recovery from mirror failed: %v", err)
		} else {
			newest = recovered
		}
	}
	rawMessages := make([]interface{}, 0, len(newest)*2)
	ledgerEvents := make([]interface{}, 0, len(newest)*4)
	for _, message := range newest {
		if strings.TrimSpace(message.Message) != "" {
			rawMessages = append(rawMessages, openClawProjectionUserMessage(req, message))
		}
		if strings.TrimSpace(message.Answer) != "" || strings.TrimSpace(message.OpenClawProjectionJSON) != "" {
			rawMessages = append(rawMessages, openClawProjectionAssistantMessage(req, message))
		}
		ledgerEvents = append(ledgerEvents, openClawProjectionLedgerEvents(req, message)...)
	}
	nextOffset := offset + len(newest)
	payload := map[string]interface{}{
		"messages":      rawMessages,
		"ledger_events": ledgerEvents,
		"ledgerEvents":  ledgerEvents,
		"pagination": map[string]interface{}{
			"limit":      limit,
			"offset":     offset,
			"total":      total,
			"hasMore":    int64(nextOffset) < total,
			"nextOffset": nextOffset,
		},
		"source":             openClawHistorySourceMirror,
		"stale":              true,
		"mirror_field":       "messages_projection",
		"messages_last_seq":  maxOpenClawProjectionSeq(newest),
		"projection_version": openClawProjectionVersion,
	}
	if lastSeq := maxOpenClawProjectionSeq(newest); lastSeq > 0 {
		payload["last_seq"] = lastSeq
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, false, err
	}
	return json.RawMessage(raw), true, nil
}

func hasOpenClawProjectionBlankQuestions(messages []model.Message) bool {
	for _, message := range messages {
		if strings.TrimSpace(message.Message) == "" {
			return true
		}
	}
	return false
}

func collapseOpenClawProjectionMessagePage(messages []model.Message) []model.Message {
	if len(messages) < 2 {
		return messages
	}
	next := make([]model.Message, 0, len(messages))
	indexByIdentity := map[string]int{}
	for _, message := range messages {
		identity := openClawProjectionMessageIdentity(message)
		if identity == "" {
			next = append(next, message)
			continue
		}
		if index, ok := indexByIdentity[identity]; ok {
			next[index] = mergeOpenClawProjectionMessages(next[index], message)
			continue
		}
		indexByIdentity[identity] = len(next)
		next = append(next, message)
	}
	return next
}

func openClawProjectionMessageIdentity(message model.Message) string {
	if turnID := strings.TrimSpace(message.OpenClawTurnID); turnID != "" {
		return "turn:" + turnID
	}
	if key := strings.TrimSpace(message.OpenClawProjectionKey); key != "" {
		return key
	}
	if requestID := strings.TrimSpace(message.RequestId); requestID != "" {
		return "request:" + requestID
	}
	if message.OpenClawSeqStart > 0 {
		return fmt.Sprintf("seq:%d", message.OpenClawSeqStart)
	}
	return ""
}

func mergeOpenClawProjectionMessages(existing model.Message, incoming model.Message) model.Message {
	merged := existing
	if strings.TrimSpace(merged.Message) == "" && strings.TrimSpace(incoming.Message) != "" {
		merged.Message = incoming.Message
		merged.OriginalQuestion = incoming.OriginalQuestion
	}
	if strongerOpenClawProjectionAnswer(incoming.Answer, merged.Answer) {
		merged.Answer = incoming.Answer
	}
	if strings.TrimSpace(merged.ReasoningContent) == "" && strings.TrimSpace(incoming.ReasoningContent) != "" {
		merged.ReasoningContent = incoming.ReasoningContent
	}
	if strings.TrimSpace(merged.RequestId) == "" {
		merged.RequestId = incoming.RequestId
	}
	if strings.TrimSpace(merged.OpenClawTurnID) == "" {
		merged.OpenClawTurnID = incoming.OpenClawTurnID
	}
	if merged.OpenClawSeqStart == 0 || (incoming.OpenClawSeqStart > 0 && incoming.OpenClawSeqStart < merged.OpenClawSeqStart) {
		merged.OpenClawSeqStart = incoming.OpenClawSeqStart
	}
	if incoming.OpenClawSeqEnd > merged.OpenClawSeqEnd {
		merged.OpenClawSeqEnd = incoming.OpenClawSeqEnd
	}
	if strings.TrimSpace(incoming.OpenClawStatus) != "" {
		merged.OpenClawStatus = incoming.OpenClawStatus
	}
	if openClawProjectionMessageJSONScore(incoming.OpenClawProjectionJSON) > openClawProjectionMessageJSONScore(merged.OpenClawProjectionJSON) {
		merged.OpenClawProjectionJSON = incoming.OpenClawProjectionJSON
	}
	if incoming.UpdatedTime > merged.UpdatedTime {
		merged.UpdatedTime = incoming.UpdatedTime
	}
	if merged.CreatedTime == 0 || (incoming.CreatedTime > 0 && incoming.CreatedTime < merged.CreatedTime) {
		merged.CreatedTime = incoming.CreatedTime
	}
	return merged
}

func strongerOpenClawProjectionAnswer(incoming string, existing string) bool {
	incoming = strings.TrimSpace(incoming)
	existing = strings.TrimSpace(existing)
	if incoming == "" || isWeakOpenClawProjectionAnswer(incoming) {
		return false
	}
	if existing == "" || isWeakOpenClawProjectionAnswer(existing) {
		return true
	}
	return len([]rune(incoming)) > len([]rune(existing))
}

func openClawProjectionMessageJSONScore(raw string) int {
	payload, ok := openClawJSONPayloadMap(json.RawMessage(raw))
	if !ok {
		return 0
	}
	return openClawProjectionCompletenessScore(payload)
}

type openClawProjectionQuestionRecovery struct {
	ByTurn    map[string]string
	ByRequest map[string]string
	BySeq     map[int64]string
	ByAnswer  map[string]string
	Ordered   []string
}

func (s *OpenClawMessageProjectionService) recoverProjectionQuestionsFromMirror(ctx context.Context, req OpenClawRequestContext, messages []model.Message) ([]model.Message, error) {
	recovery, ok, err := s.projectionQuestionRecoveryFromMirror(ctx, req)
	if err != nil || !ok {
		return messages, err
	}
	next := append([]model.Message{}, messages...)
	for index := range next {
		if strings.TrimSpace(next[index].Message) != "" {
			continue
		}
		if question := recovery.questionForMessage(next[index], index); question != "" {
			next[index].Message = question
			next[index].OriginalQuestion = question
		}
	}
	return next, nil
}

func (s *OpenClawMessageProjectionService) projectionQuestionRecoveryFromMirror(ctx context.Context, req OpenClawRequestContext) (openClawProjectionQuestionRecovery, bool, error) {
	recovery := openClawProjectionQuestionRecovery{
		ByTurn:    map[string]string{},
		ByRequest: map[string]string{},
		BySeq:     map[int64]string{},
		ByAnswer:  map[string]string{},
	}
	var mirror model.OpenClawConversationMirror
	err := model.DB.WithContext(ctx).
		Where("eid = ? AND agent_id = ? AND user_id = ? AND conversation_id = ?", req.EID, req.AgentID, req.UserID, req.ConversationID).
		Order("id DESC").
		First(&mirror).Error
	if err == gorm.ErrRecordNotFound {
		return recovery, false, nil
	}
	if err != nil {
		return recovery, false, err
	}
	payload, ok := openClawJSONPayloadMap(json.RawMessage(mirror.MessagesJSON))
	if !ok {
		return recovery, false, nil
	}
	var pendingQuestion string
	var pendingRecord map[string]interface{}
	for _, item := range openClawJSONList(payload["messages"]) {
		record, ok := item.(map[string]interface{})
		if !ok {
			continue
		}
		role := strings.ToLower(openClawRecordString(record, "role", "sender", "author"))
		text := openClawProjectionRecordText(record)
		switch role {
		case "user":
			if text == "" {
				continue
			}
			pendingQuestion = text
			pendingRecord = record
			recovery.Ordered = append(recovery.Ordered, text)
			indexOpenClawProjectionRecoveryRecord(recovery, record, text)
		case "assistant", "ai":
			if pendingQuestion == "" {
				continue
			}
			indexOpenClawProjectionRecoveryRecord(recovery, record, pendingQuestion)
			if answerKey := openClawProjectionTextFingerprint(text); answerKey != "" {
				recovery.ByAnswer[answerKey] = pendingQuestion
			}
			if pendingRecord != nil {
				for _, seq := range []int64{maxOpenClawSeqInValue(pendingRecord), maxOpenClawSeqInValue(record)} {
					if seq > 0 {
						recovery.BySeq[seq] = pendingQuestion
					}
				}
			}
			pendingQuestion = ""
			pendingRecord = nil
		}
	}
	return recovery, len(recovery.Ordered) > 0, nil
}

func indexOpenClawProjectionRecoveryRecord(recovery openClawProjectionQuestionRecovery, record map[string]interface{}, question string) {
	for _, key := range []string{"turn_id", "turnId"} {
		if value := openClawRecordString(record, key); value != "" {
			recovery.ByTurn[value] = question
		}
	}
	for _, key := range []string{"active_request_id", "activeRequestId", "request_id", "requestId", "run_id", "runId"} {
		if value := openClawRecordString(record, key); value != "" {
			recovery.ByRequest[value] = question
		}
	}
	if seq := maxOpenClawSeqInValue(record); seq > 0 {
		recovery.BySeq[seq] = question
	}
}

func (r openClawProjectionQuestionRecovery) questionForMessage(message model.Message, position int) string {
	if turnID := strings.TrimSpace(message.OpenClawTurnID); turnID != "" {
		if question := r.ByTurn[turnID]; question != "" {
			return question
		}
	}
	if key := strings.TrimPrefix(strings.TrimSpace(message.OpenClawProjectionKey), "turn:"); key != "" {
		if question := r.ByTurn[key]; question != "" {
			return question
		}
	}
	if requestID := strings.TrimSpace(message.RequestId); requestID != "" {
		if question := r.ByRequest[requestID]; question != "" {
			return question
		}
	}
	for _, seq := range []int64{message.OpenClawSeqStart, message.OpenClawSeqEnd} {
		if seq > 0 {
			if question := r.BySeq[seq]; question != "" {
				return question
			}
		}
	}
	if answerKey := openClawProjectionTextFingerprint(message.Answer); answerKey != "" {
		if question := r.ByAnswer[answerKey]; question != "" {
			return question
		}
	}
	if position >= 0 && position < len(r.Ordered) {
		return r.Ordered[position]
	}
	return ""
}

func openClawProjectionTextFingerprint(value string) string {
	normalized := strings.Join(strings.Fields(value), " ")
	if normalized == "" {
		return ""
	}
	runes := []rune(normalized)
	if len(runes) > 160 {
		normalized = string(runes[:160])
	}
	return normalized
}

type openClawProjectionConversationStats struct {
	HasMessages bool
	LastSeq     int64
	Status      string
	UpdatedTime int64
}

type openClawProjectionConversationListEntry struct {
	ID       string
	SortTime int64
	Payload  map[string]interface{}
}

type openClawProjectionCurrentCandidate struct {
	Payload        map[string]interface{}
	SortTime       int64
	HubScore       int
	NonPlaceholder bool
	Index          int
}

func (s *OpenClawMessageProjectionService) projectionConversationBaseQuery(ctx context.Context, req OpenClawRequestContext) *gorm.DB {
	return model.DB.WithContext(ctx).Model(&model.Conversation{}).Where(
		"eid = ? AND user_id = ? AND agent_id = ? AND source = ? AND deleted_time = 0 AND status <> ?",
		req.EID,
		req.UserID,
		req.AgentID,
		openClawProjectionSource,
		model.ConversationStatusDeleted,
	)
}

func (s *OpenClawMessageProjectionService) conversationListPayload(ctx context.Context, req OpenClawRequestContext) (json.RawMessage, bool, error) {
	limit := req.Query.Limit
	if limit == 0 {
		limit = openClawDefaultPageLimit
	}
	offset := req.Query.Offset
	var conversations []model.Conversation
	if err := s.projectionConversationBaseQuery(ctx, req).
		Order("updated_time DESC").
		Order("conversation_id DESC").
		Find(&conversations).Error; err != nil {
		return nil, false, err
	}
	stats, err := s.projectionConversationStatsByID(ctx, req, conversations)
	if err != nil {
		return nil, false, err
	}
	mirrors, err := s.projectionMirrorFallbackRows(ctx, req)
	if err != nil {
		return nil, false, err
	}
	mirrorsByID := make(map[string]model.OpenClawConversationMirror, len(mirrors))
	for _, mirror := range mirrors {
		if strings.TrimSpace(mirror.ConversationID) != "" {
			mirrorsByID[mirror.ConversationID] = mirror
		}
	}
	entries := make([]openClawProjectionConversationListEntry, 0, len(conversations)+len(mirrors))
	seen := make(map[string]struct{}, len(conversations))
	for _, conversation := range conversations {
		stat := stats[conversation.ConversationID]
		payload := openClawProjectionConversationPayload(conversation, stat)
		id := openClawProjectionPayloadConversationID(payload)
		if id == "" {
			continue
		}
		if mirror, ok := mirrorsByID[id]; ok {
			payload = mergeOpenClawProjectionConversationMirrorFallback(req, payload, openClawProjectionMirrorConversationMap(mirror))
		}
		entries = append(entries, openClawProjectionConversationListEntry{
			ID:       id,
			SortTime: maxOpenClawInt64(conversation.UpdatedTime, stat.UpdatedTime),
			Payload:  payload,
		})
		seen[id] = struct{}{}
	}
	for _, mirror := range mirrors {
		if strings.TrimSpace(mirror.ConversationID) == "" {
			continue
		}
		if _, ok := seen[mirror.ConversationID]; ok {
			continue
		}
		payload := openClawProjectionMirrorConversationMap(mirror)
		entries = append(entries, openClawProjectionConversationListEntry{
			ID:       mirror.ConversationID,
			SortTime: maxOpenClawInt64(mirror.LastSeenTime, mirror.UpdatedTime),
			Payload:  payload,
		})
	}
	if len(entries) == 0 {
		return nil, false, nil
	}
	sort.SliceStable(entries, func(i, j int) bool {
		if entries[i].SortTime != entries[j].SortTime {
			return entries[i].SortTime > entries[j].SortTime
		}
		return entries[i].ID > entries[j].ID
	})
	total := len(entries)
	start := offset
	if start > total {
		start = total
	}
	end := start + limit
	if end > total {
		end = total
	}
	sessions := make([]interface{}, 0, end-start)
	for _, entry := range entries[start:end] {
		sessions = append(sessions, entry.Payload)
	}
	nextOffset := offset + len(sessions)
	raw, err := json.Marshal(map[string]interface{}{
		"sessions": sessions,
		"pagination": map[string]interface{}{
			"limit":      limit,
			"offset":     offset,
			"total":      total,
			"hasMore":    nextOffset < total,
			"nextOffset": nextOffset,
		},
		"source":             openClawHistorySourceMirror,
		"stale":              true,
		"mirror_field":       "messages_projection",
		"projection_version": openClawProjectionVersion,
	})
	if err != nil {
		return nil, false, err
	}
	return json.RawMessage(raw), true, nil
}

func (s *OpenClawMessageProjectionService) currentConversationPayload(ctx context.Context, req OpenClawRequestContext) (json.RawMessage, bool, error) {
	var conversations []model.Conversation
	if err := s.projectionConversationBaseQuery(ctx, req).
		Order("updated_time DESC").
		Order("conversation_id DESC").
		Limit(openClawDefaultPageLimit).
		Find(&conversations).Error; err != nil {
		return nil, false, err
	}
	if len(conversations) == 0 {
		return nil, false, nil
	}
	stats, err := s.projectionConversationStatsByID(ctx, req, conversations)
	if err != nil {
		return nil, false, err
	}
	mirrors, err := s.projectionMirrorFallbackRows(ctx, req)
	if err != nil {
		return nil, false, err
	}
	mirrorsByID := make(map[string]model.OpenClawConversationMirror, len(mirrors))
	for _, mirror := range mirrors {
		if strings.TrimSpace(mirror.ConversationID) != "" {
			mirrorsByID[mirror.ConversationID] = mirror
		}
	}
	userKey := openClawHubUserKey(req.UserID)
	userName := openClawHubUserName(req.UserID)
	candidates := make([]openClawProjectionCurrentCandidate, 0, len(conversations))
	for index, conversation := range conversations {
		stat := stats[conversation.ConversationID]
		if !stat.HasMessages {
			continue
		}
		payload := openClawProjectionConversationPayload(conversation, stat)
		if mirror, ok := mirrorsByID[openClawProjectionPayloadConversationID(payload)]; ok {
			payload = mergeOpenClawProjectionConversationMirrorFallback(req, payload, openClawProjectionMirrorConversationMap(mirror))
		}
		title := openClawRecordString(payload, "title", "name", "label")
		candidates = append(candidates, openClawProjectionCurrentCandidate{
			Payload:        payload,
			SortTime:       maxOpenClawInt64(conversation.UpdatedTime, stat.UpdatedTime),
			HubScore:       openClawHubSessionTitleScore(title, userKey, userName),
			NonPlaceholder: !isOpenClawProjectionPlaceholderTitle(title, openClawProjectionPayloadConversationID(payload)),
			Index:          index,
		})
	}
	if len(candidates) == 0 {
		return nil, false, nil
	}
	selected := selectOpenClawProjectionCurrentCandidate(candidates)
	raw, err := json.Marshal(selected.Payload)
	if err != nil {
		return nil, false, err
	}
	return json.RawMessage(raw), true, nil
}

func selectOpenClawProjectionCurrentCandidate(candidates []openClawProjectionCurrentCandidate) openClawProjectionCurrentCandidate {
	selected := candidates[0]
	for _, candidate := range candidates[1:] {
		if compareOpenClawProjectionCurrentCandidate(candidate, selected) {
			selected = candidate
		}
	}
	if selected.HubScore > 0 {
		return selected
	}
	for _, candidate := range candidates {
		if !candidate.NonPlaceholder {
			continue
		}
		if !selected.NonPlaceholder || candidate.SortTime > selected.SortTime || (candidate.SortTime == selected.SortTime && candidate.Index < selected.Index) {
			selected = candidate
		}
	}
	return selected
}

func compareOpenClawProjectionCurrentCandidate(left openClawProjectionCurrentCandidate, right openClawProjectionCurrentCandidate) bool {
	if left.HubScore != right.HubScore {
		return left.HubScore > right.HubScore
	}
	if left.SortTime != right.SortTime {
		return left.SortTime > right.SortTime
	}
	return left.Index < right.Index
}

func (s *OpenClawMessageProjectionService) projectionMirrorFallbackRows(ctx context.Context, req OpenClawRequestContext) ([]model.OpenClawConversationMirror, error) {
	var mirrors []model.OpenClawConversationMirror
	if err := model.DB.WithContext(ctx).
		Where("eid = ? AND agent_id = ? AND user_id = ?", req.EID, req.AgentID, req.UserID).
		Order("last_seen_time DESC, updated_time DESC").
		Find(&mirrors).Error; err != nil {
		return nil, err
	}
	return mirrors, nil
}

func (s *OpenClawMessageProjectionService) projectionConversationStatsByID(ctx context.Context, req OpenClawRequestContext, conversations []model.Conversation) (map[int64]openClawProjectionConversationStats, error) {
	stats := make(map[int64]openClawProjectionConversationStats, len(conversations))
	if len(conversations) == 0 {
		return stats, nil
	}
	ids := make([]int64, 0, len(conversations))
	for _, conversation := range conversations {
		ids = append(ids, conversation.ConversationID)
	}
	var messages []model.Message
	if err := model.DB.WithContext(ctx).
		Select("conversation_id", "openclaw_seq_end", "openclaw_status", "updated_time").
		Where("eid = ? AND agent_id = ? AND user_id = ? AND conversation_id IN ? AND openclaw_projection_key <> ?", req.EID, req.AgentID, req.UserID, ids, "").
		Find(&messages).Error; err != nil {
		return nil, err
	}
	for _, message := range messages {
		stat := stats[message.ConversationID]
		stat.HasMessages = true
		if message.OpenClawSeqEnd > stat.LastSeq {
			stat.LastSeq = message.OpenClawSeqEnd
		}
		if message.UpdatedTime >= stat.UpdatedTime {
			stat.UpdatedTime = message.UpdatedTime
			stat.Status = message.OpenClawStatus
		}
		stats[message.ConversationID] = stat
	}
	return stats, nil
}

func openClawProjectionConversationPayload(conversation model.Conversation, stat openClawProjectionConversationStats) map[string]interface{} {
	conversationID := strings.TrimSpace(conversation.ChannelConversationID)
	if conversationID == "" {
		conversationID = fmt.Sprint(conversation.ConversationID)
	}
	title := strings.TrimSpace(conversation.Title)
	if title == "" {
		title = conversationID
	}
	updatedTime := maxOpenClawInt64(conversation.UpdatedTime, stat.UpdatedTime)
	payload := map[string]interface{}{
		"id":                 conversationID,
		"conversation_id":    conversationID,
		"session_id":         conversationID,
		"sessionId":          conversationID,
		"title":              title,
		"status":             stat.Status,
		"source":             openClawHistorySourceMirror,
		"stale":              true,
		"mirror_field":       "messages_projection",
		"projection_version": openClawProjectionVersion,
		"has_cached_history": stat.HasMessages,
		"hasCachedHistory":   stat.HasMessages,
		"created_time":       conversation.CreatedTime,
		"updated_time":       updatedTime,
	}
	if createdAt := openClawProjectionTimeString(conversation.CreatedTime); createdAt != "" {
		payload["createdAt"] = createdAt
	}
	if updatedAt := openClawProjectionTimeString(updatedTime); updatedAt != "" {
		payload["updatedAt"] = updatedAt
	}
	if stat.LastSeq > 0 {
		payload["last_seq"] = stat.LastSeq
		payload["lastEventSeq"] = stat.LastSeq
	}
	return payload
}

func openClawProjectionPayloadConversationID(payload map[string]interface{}) string {
	return openClawRecordString(payload, "id", "conversation_id", "conversationId", "session_id", "sessionId")
}

func openClawProjectionMirrorConversationMap(mirror model.OpenClawConversationMirror) map[string]interface{} {
	var payload map[string]interface{}
	raw := openClawMirrorConversationPayload(mirror)
	if err := json.Unmarshal(raw, &payload); err != nil || payload == nil {
		payload = map[string]interface{}{}
	}
	conversationID := strings.TrimSpace(mirror.ConversationID)
	if conversationID == "" {
		conversationID = openClawProjectionPayloadConversationID(payload)
	}
	if conversationID != "" {
		payload["id"] = conversationID
		payload["conversation_id"] = conversationID
		payload["session_id"] = conversationID
		payload["sessionId"] = conversationID
	}
	if title := strings.TrimSpace(openClawRecordString(payload, "title")); title == "" && strings.TrimSpace(mirror.Title) != "" {
		payload["title"] = mirror.Title
	}
	hasCachedHistory := openClawMirrorHasCachedHistory(mirror)
	payload["source"] = openClawHistorySourceMirror
	payload["stale"] = true
	payload["mirror_field"] = "messages_projection"
	payload["projection_version"] = openClawProjectionVersion
	payload["has_cached_history"] = hasCachedHistory
	payload["hasCachedHistory"] = hasCachedHistory
	if _, ok := payload["updated_time"]; !ok {
		payload["updated_time"] = maxOpenClawInt64(mirror.LastSeenTime, mirror.UpdatedTime)
	}
	if _, ok := payload["last_seen_time"]; !ok && mirror.LastSeenTime > 0 {
		payload["last_seen_time"] = mirror.LastSeenTime
	}
	return payload
}

func mergeOpenClawProjectionConversationMirrorFallback(req OpenClawRequestContext, projection map[string]interface{}, mirror map[string]interface{}) map[string]interface{} {
	if projection == nil {
		return mirror
	}
	if mirror == nil {
		return projection
	}
	conversationID := openClawProjectionPayloadConversationID(projection)
	if conversationID == "" {
		conversationID = openClawProjectionPayloadConversationID(mirror)
	}
	projectionTitle := openClawRecordString(projection, "title")
	mirrorTitle := openClawRecordString(mirror, "title")
	if shouldUseOpenClawMirrorTitleFallback(req, projectionTitle, mirrorTitle, conversationID) {
		projection["title"] = mirrorTitle
	}
	if openClawProjectionPayloadBool(mirror, "has_cached_history", "hasCachedHistory") {
		projection["has_cached_history"] = true
		projection["hasCachedHistory"] = true
	}
	if openClawRecordString(projection, "status", "state") == "" {
		if status := openClawRecordString(mirror, "status", "state"); status != "" {
			projection["status"] = status
		}
	}
	if openClawProjectionPayloadNumber(projection, "last_seq", "lastEventSeq") <= 0 {
		if lastSeq := openClawProjectionPayloadNumber(mirror, "last_seq", "lastEventSeq"); lastSeq > 0 {
			projection["last_seq"] = lastSeq
			projection["lastEventSeq"] = lastSeq
		}
	}
	return projection
}

func shouldUseOpenClawMirrorTitleFallback(req OpenClawRequestContext, projectionTitle string, mirrorTitle string, conversationID string) bool {
	mirrorTitle = strings.TrimSpace(mirrorTitle)
	if mirrorTitle == "" || isOpenClawProjectionPlaceholderTitle(mirrorTitle, conversationID) {
		return false
	}
	projectionTitle = strings.TrimSpace(projectionTitle)
	if projectionTitle == "" || isOpenClawProjectionPlaceholderTitle(projectionTitle, conversationID) {
		return true
	}
	userKey := openClawHubUserKey(req.UserID)
	userName := openClawHubUserName(req.UserID)
	return openClawHubSessionTitleScore(mirrorTitle, userKey, userName) > 0 &&
		openClawHubSessionTitleScore(projectionTitle, userKey, userName) == 0
}

func openClawProjectionPayloadBool(payload map[string]interface{}, keys ...string) bool {
	for _, key := range keys {
		value, ok := payload[key]
		if !ok {
			continue
		}
		switch typed := value.(type) {
		case bool:
			return typed
		case string:
			return strings.EqualFold(strings.TrimSpace(typed), "true") || strings.TrimSpace(typed) == "1"
		case json.Number:
			number, _ := typed.Int64()
			return number != 0
		case float64:
			return typed != 0
		case int:
			return typed != 0
		case int64:
			return typed != 0
		}
	}
	return false
}

func openClawProjectionPayloadNumber(payload map[string]interface{}, keys ...string) int64 {
	for _, key := range keys {
		if value, ok := payload[key]; ok {
			if number := openClawNumber(value); number > 0 {
				return number
			}
		}
	}
	return 0
}

func openClawProjectionTimeString(value int64) string {
	if value <= 0 {
		return ""
	}
	return time.UnixMilli(value).UTC().Format(time.RFC3339Nano)
}

func openClawProjectionUserMessage(req OpenClawRequestContext, message model.Message) map[string]interface{} {
	return map[string]interface{}{
		"id":              message.OpenClawProjectionKey + ":user",
		"sessionId":       req.ConversationID,
		"session_id":      req.ConversationID,
		"conversation_id": req.ConversationID,
		"role":            "user",
		"content":         message.Message,
		"createdAt":       message.CreatedTime,
		"payload": map[string]interface{}{
			"rawSeq": message.OpenClawSeqStart,
		},
	}
}

func openClawProjectionAssistantMessage(req OpenClawRequestContext, message model.Message) map[string]interface{} {
	payload := map[string]interface{}{
		"rawSeq": message.OpenClawSeqEnd,
	}
	if projection, ok := openClawJSONPayloadMap(json.RawMessage(message.OpenClawProjectionJSON)); ok {
		payload["openclawProjection"] = projection
	}
	return map[string]interface{}{
		"id":                message.OpenClawProjectionKey + ":assistant",
		"sessionId":         req.ConversationID,
		"session_id":        req.ConversationID,
		"conversation_id":   req.ConversationID,
		"role":              "assistant",
		"content":           message.Answer,
		"reasoning_content": message.ReasoningContent,
		"createdAt":         maxOpenClawInt64(message.UpdatedTime, message.CreatedTime),
		"payload":           payload,
	}
}

func openClawProjectionLedgerEvents(req OpenClawRequestContext, message model.Message) []interface{} {
	turnID := strings.TrimSpace(message.OpenClawTurnID)
	if turnID == "" {
		turnID = strings.TrimPrefix(message.OpenClawProjectionKey, "turn:")
	}
	if turnID == "" {
		turnID = req.ConversationID + ":turn:" + fmt.Sprint(message.ID)
	}
	runID := strings.TrimSpace(message.RequestId)
	if runID == "" {
		runID = turnID
	}
	nextSeq := message.OpenClawSeqStart
	if nextSeq <= 0 {
		nextSeq = 1
	}
	events := []interface{}{}
	appendEvent := func(partType string, eventType string, operation string, visibility string, text string, payload map[string]interface{}, terminalStatus string) {
		seq := nextSeq
		nextSeq++
		if message.OpenClawSeqEnd > 0 && nextSeq > message.OpenClawSeqEnd+1 {
			seq = message.OpenClawSeqEnd
		}
		partID := fmt.Sprintf("%s:%s:%d", turnID, partType, seq)
		event := map[string]interface{}{
			"protocol_version":  "openclaw.ledger.v1",
			"seq":               seq,
			"session_id":        req.ConversationID,
			"conversation_id":   req.ConversationID,
			"turn_id":           turnID,
			"run_id":            runID,
			"active_request_id": runID,
			"part_id":           partID,
			"part_type":         partType,
			"event_type":        eventType,
			"operation":         operation,
			"visibility":        visibility,
			"payload":           payload,
			"created_at":        openClawProjectionCreatedAt(message),
			"raw_event_ref":     fmt.Sprintf("%s:%s", message.OpenClawProjectionKey, partID),
		}
		if text != "" {
			event["text"] = text
		}
		if terminalStatus != "" {
			event["terminal_status"] = terminalStatus
		}
		events = append(events, event)
	}
	if question := strings.TrimSpace(message.Message); question != "" {
		appendEvent("status", "turn.started", "noop", "hidden", "", map[string]interface{}{
			"source_kind": "user.message",
			"content":     question,
		}, "")
	}
	if reasoning := strings.TrimSpace(message.ReasoningContent); reasoning != "" {
		appendEvent("thinking", "part.replace", "replace", "stream", reasoning, map[string]interface{}{
			"content": reasoning,
		}, "")
	}
	if files := openClawProjectionFilesFromMessage(message); len(files) > 0 {
		appendEvent("output_file", "part.done", "replace", "final", "生成文件", map[string]interface{}{
			"process_step": map[string]interface{}{
				"step_code": "output_files",
				"status":    "completed",
				"data": map[string]interface{}{
					"files":             files,
					"media_attachments": files,
				},
			},
		}, "")
	}
	if answer := strings.TrimSpace(message.Answer); answer != "" {
		status := normalizeOpenClawProjectionStatus(message.OpenClawStatus)
		if status == "" || status == model.AgentRunStatusRunning {
			status = model.AgentRunStatusCompleted
		}
		appendEvent("answer", "part.replace", "replace", "final", answer, map[string]interface{}{
			"content": answer,
		}, status)
	}
	return events
}

func openClawProjectionCreatedAt(message model.Message) string {
	ts := maxOpenClawInt64(message.UpdatedTime, message.CreatedTime)
	if ts <= 0 {
		ts = openClawMirrorNow()
	}
	return time.UnixMilli(ts).UTC().Format(time.RFC3339Nano)
}

func openClawProjectionFilesFromMessage(message model.Message) []interface{} {
	payload, ok := openClawJSONPayloadMap(json.RawMessage(message.OpenClawProjectionJSON))
	if !ok {
		return nil
	}
	return openClawJSONList(payload["outputFiles"])
}

func maxOpenClawProjectionSeq(messages []model.Message) int64 {
	var maxSeq int64
	for _, message := range messages {
		if message.OpenClawSeqEnd > maxSeq {
			maxSeq = message.OpenClawSeqEnd
		}
	}
	return maxSeq
}
