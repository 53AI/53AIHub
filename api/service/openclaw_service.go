package service

import (
	"context"
	"crypto/sha1"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/wsmanager"
	"github.com/53AI/53AIHub/model"
)

const (
	openClawDefaultPageLimit = 30
	openClawMaxPageLimit     = 200
)

type OpenClawPaginationQuery struct {
	Limit    int  `form:"limit"`
	Offset   int  `form:"offset"`
	AfterSeq int  `form:"after_seq"`
	Fresh    bool `form:"fresh"`
}

type OpenClawRequestContext struct {
	EID            int64
	UserID         int64
	Role           int64
	GroupID        int64
	AgentID        int64
	ConversationID string
	APIBaseURL     string
	Query          OpenClawPaginationQuery
}

type OpenClawServiceError struct {
	HTTPStatus int
	Code       model.ResponseCode
	Message    string
	Err        error
}

func (e *OpenClawServiceError) Error() string {
	if e == nil {
		return ""
	}
	if e.Message != "" {
		return e.Message
	}
	if e.Err != nil {
		return e.Err.Error()
	}
	return e.Code.Message()
}

type OpenClawService struct{}

const (
	openClawSessionValidationPageLimit = 50
	openClawSessionValidationMaxPages  = 100
)

func NewOpenClawService() *OpenClawService {
	return &OpenClawService{}
}

func (s *OpenClawService) ListConversations(ctx context.Context, req OpenClawRequestContext) (json.RawMessage, *OpenClawServiceError) {
	payload, svcErr := openClawPaginationPayload(req.Query)
	if svcErr != nil {
		return nil, svcErr
	}
	if !req.Query.Fresh {
		projectionService := NewOpenClawMessageProjectionService()
		if openClawMessageProjectionPrimaryEnabled() {
			if cached, cachedErr, ok := projectionService.ConversationList(ctx, req); ok {
				return cached, cachedErr
			}
		}
		if cached, cachedErr, ok := s.mirrorConversationList(ctx, req); ok {
			return cached, cachedErr
		}
		if !openClawMessageProjectionPrimaryEnabled() {
			if cached, cachedErr, ok := projectionService.ConversationList(ctx, req); ok {
				return cached, cachedErr
			}
		}
	}
	data, svcErr := s.call(ctx, req, "sessions.list", payload)
	if svcErr != nil {
		if cached, cachedErr, ok := s.fallbackConversationList(ctx, req, svcErr); ok {
			return cached, cachedErr
		}
		return nil, svcErr
	}
	s.cacheConversationList(ctx, req, data)
	NewOpenClawMessageProjectionService().CacheConversationListMetadata(ctx, req, data)
	s.pruneConversationMirrorsMissingFromFreshList(ctx, req, data)
	data = withOpenClawConversationListHistoryStatus(req, data)
	return withOpenClawHistoryMetadata(data, openClawHistorySourceOpenClaw, false, extractOpenClawLastSeq(data), nil), nil
}

func (s *OpenClawService) GetCurrentConversation(ctx context.Context, req OpenClawRequestContext) (json.RawMessage, *OpenClawServiceError) {
	if !req.Query.Fresh {
		projectionService := NewOpenClawMessageProjectionService()
		if openClawMessageProjectionPrimaryEnabled() {
			if cached, cachedErr, ok := projectionService.CurrentConversation(ctx, req); ok {
				return cached, cachedErr
			}
		}
		if cached, cachedErr, ok := s.mirrorCurrentConversation(ctx, req); ok {
			return cached, cachedErr
		}
		if !openClawMessageProjectionPrimaryEnabled() {
			if cached, cachedErr, ok := projectionService.CurrentConversation(ctx, req); ok {
				return cached, cachedErr
			}
		}
	}
	userKey := openClawHubUserKey(req.UserID)
	payload := map[string]interface{}{
		"chat_id": userKey,
		"chatId":  userKey,
		"user":    userKey,
		"user_id": userKey,
		"userId":  userKey,
	}
	if userName := openClawHubUserName(req.UserID); userName != "" {
		payload["userName"] = userName
		payload["user_name"] = userName
	}
	data, svcErr := s.callWithOptions(ctx, req, "sessions.current", payload, true)
	if svcErr != nil {
		if cached, cachedErr, ok := s.fallbackCurrentConversation(ctx, req, svcErr); ok {
			return cached, cachedErr
		}
		return nil, svcErr
	}
	filtered := filterOpenClawCurrentHubSession(data, userKey, openClawHubUserName(req.UserID))
	if req.Query.Fresh {
		filtered = s.filterFreshCurrentConversationForAgentScope(ctx, req, filtered)
	}
	s.cacheCurrentConversation(ctx, req, filtered)
	NewOpenClawMessageProjectionService().CacheCurrentConversationMetadata(ctx, req, filtered)
	return withOpenClawHistoryMetadata(filtered, openClawHistorySourceOpenClaw, false, extractOpenClawLastSeq(filtered), nil), nil
}

func (s *OpenClawService) filterFreshCurrentConversationForAgentScope(ctx context.Context, req OpenClawRequestContext, data json.RawMessage) json.RawMessage {
	conversationID := openClawConversationIDFromSessionPayload(data)
	if conversationID == "" {
		return data
	}
	exists, authoritative := s.freshConversationIDExists(ctx, req, conversationID)
	if !authoritative || exists {
		return data
	}
	return json.RawMessage("null")
}

func filterOpenClawCurrentHubSession(data json.RawMessage, userKey string, userName string) json.RawMessage {
	trimmed := strings.TrimSpace(string(data))
	if trimmed == "" || trimmed == "null" {
		return json.RawMessage("null")
	}

	var session struct {
		Title string `json:"title"`
	}
	if err := json.Unmarshal(data, &session); err != nil {
		return data
	}
	if session.Title == "" || openClawHubSessionTitleScore(session.Title, userKey, userName) > 0 {
		return data
	}
	return json.RawMessage("null")
}

func openClawConversationIDFromSessionPayload(data json.RawMessage) string {
	trimmed := strings.TrimSpace(string(data))
	if trimmed == "" || trimmed == "null" {
		return ""
	}
	var session map[string]interface{}
	if err := json.Unmarshal(data, &session); err != nil {
		return ""
	}
	return openClawRecordString(session, "id", "conversation_id", "conversationId", "session_id", "sessionId")
}

func isOpenClawHubSessionTitle(title string, userKey string) bool {
	return openClawHubSessionTitleScore(title, userKey, userKey) > 0
}

func openClawHubSessionTitleScore(title string, userKey string, userName string) int {
	normalized := strings.TrimSpace(title)
	if normalized == "" {
		return 1
	}
	userKey = strings.TrimSpace(userKey)
	userName = strings.TrimSpace(userName)
	if userName == "" {
		userName = userKey
	}
	if strings.HasPrefix(normalized, "53AI Hub-") {
		owner := strings.TrimSpace(strings.TrimPrefix(normalized, "53AI Hub-"))
		if separator := strings.IndexAny(owner, ":："); separator >= 0 {
			owner = strings.TrimSpace(owner[:separator])
		}
		if owner != "" && owner == userName {
			return 100
		}
		if owner != "" && owner == userKey {
			return 90
		}
		if userName == userKey {
			return 10
		}
		return 0
	}
	for _, candidate := range []string{userName, userKey} {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" {
			continue
		}
		if normalized == "53AIHub "+candidate ||
			normalized == "53AIHub:"+candidate ||
			normalized == "53AIHub-"+candidate ||
			normalized == candidate {
			return 100
		}
	}
	return 0
}

func (s *OpenClawService) ListMessages(ctx context.Context, req OpenClawRequestContext) (json.RawMessage, *OpenClawServiceError) {
	if strings.TrimSpace(req.ConversationID) == "" {
		return nil, newOpenClawServiceError(http.StatusBadRequest, model.ParamError, "conversation_id is required", nil)
	}
	payload, svcErr := openClawPaginationPayload(req.Query)
	if svcErr != nil {
		return nil, svcErr
	}
	if !req.Query.Fresh {
		projectionService := NewOpenClawMessageProjectionService()
		if openClawMessageProjectionPrimaryEnabled() {
			if cached, cachedErr, ok := projectionService.MirrorMessages(ctx, req); ok {
				return cached, cachedErr
			}
		}
		if cached, cachedErr, ok := s.mirrorConversationField(ctx, req, "messages"); ok {
			return cached, cachedErr
		}
		if !openClawMessageProjectionPrimaryEnabled() {
			if cached, cachedErr, ok := projectionService.MirrorMessages(ctx, req); ok {
				return cached, cachedErr
			}
		}
	}
	attachOpenClawHubUserPayload(payload, req)
	payload["conversation_id"] = req.ConversationID
	payload["session_id"] = req.ConversationID
	data, svcErr := s.call(ctx, req, "sessions.messages", payload)
	if svcErr != nil {
		if svcErr.Code == model.NotFound {
			s.deleteConversationMirror(ctx, req)
		}
		if cached, cachedErr, ok := s.fallbackConversationField(ctx, req, "messages", svcErr); ok {
			return cached, cachedErr
		}
		return nil, svcErr
	}
	data = sanitizeOpenClawMirrorHistoryAnswers(data)
	if svcErr := s.rejectMissingFreshConversationAfterEmptyHistory(ctx, req, data); svcErr != nil {
		return nil, svcErr
	}
	s.cacheMessages(ctx, req, data)
	NewOpenClawMessageProjectionService().CacheProjectionPayload(ctx, req, data)
	return withOpenClawHistoryMetadata(data, openClawHistorySourceOpenClaw, false, extractOpenClawLastSeq(data), nil), nil
}

func (s *OpenClawService) ListEvents(ctx context.Context, req OpenClawRequestContext) (json.RawMessage, *OpenClawServiceError) {
	if strings.TrimSpace(req.ConversationID) == "" {
		return nil, newOpenClawServiceError(http.StatusBadRequest, model.ParamError, "conversation_id is required", nil)
	}
	payload, svcErr := openClawEventsPayload(req.Query)
	if svcErr != nil {
		return nil, svcErr
	}
	if !req.Query.Fresh {
		if cached, cachedErr, ok := s.mirrorConversationField(ctx, req, "events"); ok {
			return cached, cachedErr
		}
	}
	attachOpenClawHubUserPayload(payload, req)
	payload["conversation_id"] = req.ConversationID
	payload["session_id"] = req.ConversationID
	data, svcErr := s.call(ctx, req, "sessions.events", payload)
	if svcErr != nil {
		if svcErr.Code == model.NotFound {
			s.deleteConversationMirror(ctx, req)
		}
		if cached, cachedErr, ok := s.fallbackConversationField(ctx, req, "events", svcErr); ok {
			return cached, cachedErr
		}
		return nil, svcErr
	}
	data = sanitizeOpenClawMirrorHistoryAnswers(data)
	if svcErr := s.rejectMissingFreshConversationAfterEmptyHistory(ctx, req, data); svcErr != nil {
		return nil, svcErr
	}
	s.cacheEvents(ctx, req, data)
	return withOpenClawHistoryMetadata(data, openClawHistorySourceOpenClaw, false, extractOpenClawLastSeq(data), nil), nil
}

func (s *OpenClawService) GetSnapshot(ctx context.Context, req OpenClawRequestContext) (json.RawMessage, *OpenClawServiceError) {
	if strings.TrimSpace(req.ConversationID) == "" {
		return nil, newOpenClawServiceError(http.StatusBadRequest, model.ParamError, "conversation_id is required", nil)
	}
	payload, svcErr := openClawEventsPayload(req.Query)
	if svcErr != nil {
		return nil, svcErr
	}
	if !req.Query.Fresh {
		if cached, cachedErr, ok := s.mirrorConversationField(ctx, req, "snapshot"); ok {
			return cached, cachedErr
		}
	}
	attachOpenClawHubUserPayload(payload, req)
	payload["conversation_id"] = req.ConversationID
	payload["session_id"] = req.ConversationID
	data, svcErr := s.call(ctx, req, "sessions.snapshot", payload)
	if svcErr != nil {
		traceOpenClawSnapshotError(ctx, req, svcErr)
		if svcErr.Code == model.NotFound {
			s.deleteConversationMirror(ctx, req)
		}
		if cached, cachedErr, ok := s.fallbackConversationField(ctx, req, "snapshot", svcErr); ok {
			return cached, cachedErr
		}
		return nil, svcErr
	}
	data = sanitizeOpenClawMirrorHistoryAnswers(data)
	if svcErr := s.rejectMissingFreshConversationAfterEmptyHistory(ctx, req, data); svcErr != nil {
		traceOpenClawSnapshotError(ctx, req, svcErr)
		return nil, svcErr
	}
	traceOpenClawSnapshotSummary(ctx, req, data)
	s.cacheSnapshot(ctx, req, data)
	return withOpenClawHistoryMetadata(data, openClawHistorySourceOpenClaw, false, extractOpenClawLastSeq(data), nil), nil
}

func (s *OpenClawService) rejectMissingFreshConversationAfterEmptyHistory(ctx context.Context, req OpenClawRequestContext, data json.RawMessage) *OpenClawServiceError {
	if !req.Query.Fresh || req.Query.Offset > 0 || !openClawHistoryPayloadIsEmpty(data) {
		return nil
	}
	exists, authoritative := s.freshConversationExists(ctx, req)
	if !authoritative || exists {
		return nil
	}
	s.deleteConversationMirror(ctx, req)
	return newOpenClawServiceError(http.StatusNotFound, model.NotFound, "OpenClaw 会话不存在或已删除", nil)
}

func (s *OpenClawService) freshConversationExists(ctx context.Context, req OpenClawRequestContext) (bool, bool) {
	conversationID := strings.TrimSpace(req.ConversationID)
	if conversationID == "" {
		return false, false
	}
	return s.freshConversationIDExists(ctx, req, conversationID)
}

func (s *OpenClawService) freshConversationIDExists(ctx context.Context, req OpenClawRequestContext, conversationID string) (bool, bool) {
	conversationID = strings.TrimSpace(conversationID)
	if conversationID == "" {
		return false, false
	}
	offset := 0
	for page := 0; page < openClawSessionValidationMaxPages; page++ {
		payload := map[string]interface{}{
			"limit":  openClawSessionValidationPageLimit,
			"offset": offset,
		}
		attachOpenClawHubUserPayload(payload, req)
		data, svcErr := s.call(ctx, req, "sessions.list", payload)
		if svcErr != nil {
			return false, false
		}
		records, ok := extractOpenClawSessionRecordsWithPresence(data)
		if !ok {
			return false, false
		}
		for _, record := range records {
			if openClawRecordString(record, "id", "conversation_id", "conversationId", "session_id", "sessionId") == conversationID {
				return true, true
			}
		}
		hasMore, nextOffset := openClawSessionListPageCursor(data, offset, len(records))
		if !hasMore {
			return false, true
		}
		if nextOffset <= offset {
			nextOffset = offset + len(records)
		}
		if nextOffset <= offset {
			return false, false
		}
		offset = nextOffset
	}
	return false, false
}

func openClawHistoryPayloadIsEmpty(data json.RawMessage) bool {
	if extractOpenClawLastSeq(data) > 0 {
		return false
	}
	payload, ok := openClawJSONPayloadMap(data)
	if !ok {
		return false
	}
	hasKnownHistoryKey := false
	for _, key := range []string{"messages", "events", "ledger_events", "ledgerEvents", "recent_events", "recentEvents", "active_turns", "activeTurns"} {
		if _, ok := payload[key]; !ok {
			continue
		}
		hasKnownHistoryKey = true
		if len(openClawJSONList(payload[key])) > 0 {
			return false
		}
	}
	return hasKnownHistoryKey
}

func openClawSessionListPageCursor(data json.RawMessage, offset int, recordsLen int) (bool, int) {
	payload, ok := openClawJSONPayloadMap(data)
	if !ok {
		return false, offset + recordsLen
	}
	pagination, ok := payload["pagination"].(map[string]interface{})
	if !ok {
		return false, offset + recordsLen
	}
	hasMore := openClawBool(pagination["hasMore"]) || openClawBool(pagination["has_more"])
	nextOffset := int(maxOpenClawInt64(openClawNumber(pagination["nextOffset"]), openClawNumber(pagination["next_offset"])))
	if nextOffset <= 0 {
		nextOffset = offset + recordsLen
	}
	return hasMore, nextOffset
}

func openClawBool(value interface{}) bool {
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		normalized := strings.ToLower(strings.TrimSpace(typed))
		return normalized == "true" || normalized == "1" || normalized == "yes"
	default:
		return false
	}
}

func (s *OpenClawService) ControlConversation(ctx context.Context, req OpenClawRequestContext, action string, payload map[string]interface{}) (json.RawMessage, *OpenClawServiceError) {
	if strings.TrimSpace(req.ConversationID) == "" {
		return nil, newOpenClawServiceError(http.StatusBadRequest, model.ParamError, "conversation_id is required", nil)
	}
	if !isSupportedOpenClawControlAction(action) {
		return nil, newOpenClawServiceError(http.StatusBadRequest, model.ParamError, "unsupported OpenClaw control action", nil)
	}
	nextPayload := make(map[string]interface{}, len(payload)+3)
	for key, value := range payload {
		nextPayload[key] = value
	}
	attachOpenClawHubUserPayload(nextPayload, req)
	nextPayload["action"] = action
	nextPayload["conversation_id"] = req.ConversationID
	nextPayload["session_id"] = req.ConversationID
	return s.call(ctx, req, "sessions.control", nextPayload)
}

func attachOpenClawHubUserPayload(payload map[string]interface{}, req OpenClawRequestContext) {
	userKey := openClawHubUserKey(req.UserID)
	payload["chat_id"] = userKey
	payload["chatId"] = userKey
	payload["user"] = userKey
	payload["user_id"] = userKey
	payload["userId"] = userKey
	if userName := openClawHubUserName(req.UserID); userName != "" {
		payload["userName"] = userName
		payload["user_name"] = userName
	}
}

func isSupportedOpenClawControlAction(action string) bool {
	switch action {
	case "stop", "respond_interruption", "submit_answer", "resolve_interruption":
		return true
	default:
		return false
	}
}

func (s *OpenClawService) GetStatus(ctx context.Context, req OpenClawRequestContext) (json.RawMessage, *OpenClawServiceError) {
	agent, svcErr := s.loadAgent(req)
	if svcErr != nil {
		return nil, svcErr
	}

	client, ok := wsmanager.WsClientManager.GetClient(agent.AgentID)
	if !ok || client == nil {
		return nil, newOpenClawServiceError(http.StatusServiceUnavailable, model.NetworkError, "OpenClaw 插件未连接", nil)
	}

	select {
	case <-client.Done():
		return nil, newOpenClawServiceError(http.StatusServiceUnavailable, model.NetworkError, "OpenClaw 插件未连接", nil)
	default:
	}

	lastActive := client.GetLastActive()
	payload, err := json.Marshal(map[string]interface{}{
		"healthy":           true,
		"connectionHealthy": true,
		"source":            "websocket",
		"hostKind":          agent.ResolveOpenClawCompatiblePlatformType(),
		"createdAt":         client.CreatedAt().Format(time.RFC3339Nano),
		"lastActiveAt":      lastActive.Format(time.RFC3339Nano),
		"lastActiveMsAgo":   time.Since(lastActive).Milliseconds(),
		"hub53ai": map[string]interface{}{
			"connectionStatus": "connected",
			"hostKind":         agent.ResolveOpenClawCompatiblePlatformType(),
		},
	})
	if err != nil {
		return nil, newOpenClawServiceError(http.StatusInternalServerError, model.SystemError, "OpenClaw 状态序列化失败", err)
	}
	return payload, nil
}

func (s *OpenClawService) GetConfig(ctx context.Context, req OpenClawRequestContext) (json.RawMessage, *OpenClawServiceError) {
	return s.call(ctx, req, "runtime.get", map[string]interface{}{"include": "config"})
}

func (s *OpenClawService) GetSkills(ctx context.Context, req OpenClawRequestContext) (json.RawMessage, *OpenClawServiceError) {
	return s.call(ctx, req, "runtime.get", map[string]interface{}{"include": "skills"})
}

func (s *OpenClawService) ListCronTasks(ctx context.Context, req OpenClawRequestContext) (json.RawMessage, *OpenClawServiceError) {
	payload, svcErr := openClawPaginationPayload(req.Query)
	if svcErr != nil {
		return nil, svcErr
	}
	return s.call(ctx, req, "cron.tasks", payload)
}

func (s *OpenClawService) call(ctx context.Context, req OpenClawRequestContext, action string, payload map[string]interface{}) (json.RawMessage, *OpenClawServiceError) {
	return s.callWithOptions(ctx, req, action, payload, false)
}

func (s *OpenClawService) callWithOptions(ctx context.Context, req OpenClawRequestContext, action string, payload map[string]interface{}, allowNullData bool) (json.RawMessage, *OpenClawServiceError) {
	agent, svcErr := s.loadAgent(req)
	if svcErr != nil {
		return nil, svcErr
	}

	traceOpenClawRPC(ctx, "rpc.start", req, action, map[string]interface{}{
		"agent_id":      agent.AgentID,
		"payload_keys":  openClawTracePayloadKeys(payload),
		"allow_null":    allowNullData,
		"has_client_id": req.ConversationID != "",
	})
	client, ok := wsmanager.WsClientManager.GetClient(agent.AgentID)
	if !ok || client == nil {
		traceOpenClawRPC(ctx, "rpc.offline", req, action, map[string]interface{}{
			"agent_id": agent.AgentID,
		})
		return nil, newOpenClawServiceError(http.StatusServiceUnavailable, model.NetworkError, "OpenClaw 插件未连接", nil)
	}

	result, err := client.CallRPC(ctx, action, payload)
	if err != nil {
		mappedErr := mapOpenClawRPCError(err)
		traceOpenClawRPC(ctx, "rpc.error", req, action, map[string]interface{}{
			"agent_id":       agent.AgentID,
			"http_status":    mappedErr.HTTPStatus,
			"code":           mappedErr.Code,
			"message_hash":   openClawTraceHash(mappedErr.Error()),
			"message_length": len(mappedErr.Error()),
		})
		return nil, mappedErr
	}
	if result == nil {
		traceOpenClawRPC(ctx, "rpc.empty", req, action, map[string]interface{}{
			"agent_id": agent.AgentID,
		})
		return nil, newOpenClawServiceError(http.StatusBadGateway, model.NetworkError, "OpenClaw 插件返回为空", nil)
	}
	resultData := strings.TrimSpace(string(result.Data))
	if allowNullData && resultData == "null" {
		traceOpenClawRPC(ctx, "rpc.done", req, action, map[string]interface{}{
			"agent_id":      agent.AgentID,
			"status":        result.Status,
			"data_bytes":    len(result.Data),
			"returned_null": true,
		})
		return result.Data, nil
	}
	if resultData == "" || resultData == "null" {
		traceOpenClawRPC(ctx, "rpc.empty_data", req, action, map[string]interface{}{
			"agent_id":   agent.AgentID,
			"status":     result.Status,
			"data_bytes": len(result.Data),
		})
		return nil, newOpenClawServiceError(http.StatusBadGateway, model.NetworkError, "OpenClaw 插件返回数据为空", nil)
	}
	traceOpenClawRPC(ctx, "rpc.done", req, action, map[string]interface{}{
		"agent_id":   agent.AgentID,
		"status":     result.Status,
		"data_bytes": len(result.Data),
	})
	return result.Data, nil
}

func openClawHubUserKey(userID int64) string {
	return fmt.Sprintf("agenthub_u%d", userID)
}

type openClawSnapshotTraceTurn struct {
	TurnID          string   `json:"turn_id"`
	RunID           string   `json:"run_id"`
	ActiveRequestID string   `json:"active_request_id"`
	Status          string   `json:"status"`
	TerminalSeq     int      `json:"terminal_seq"`
	LastSeq         int      `json:"last_seq"`
	PartIDs         []string `json:"part_ids"`
}

type openClawSnapshotTraceEvent struct {
	Seq             int    `json:"seq"`
	TurnID          string `json:"turn_id"`
	RunID           string `json:"run_id"`
	ActiveRequestID string `json:"active_request_id"`
	PartID          string `json:"part_id"`
	PartType        string `json:"part_type"`
	EventType       string `json:"event_type"`
	Operation       string `json:"operation"`
	Visibility      string `json:"visibility"`
	TerminalStatus  string `json:"terminal_status"`
	Text            string `json:"text"`
	RawEventRef     string `json:"raw_event_ref"`
}

type openClawSnapshotTracePayload struct {
	SessionID      string                       `json:"session_id"`
	ConversationID string                       `json:"conversation_id"`
	LastSeq        int                          `json:"last_seq"`
	ActiveTurns    []openClawSnapshotTraceTurn  `json:"active_turns"`
	RecentEvents   []openClawSnapshotTraceEvent `json:"recent_events"`
	LedgerEvents   []openClawSnapshotTraceEvent `json:"ledger_events"`
	LedgerEvents2  []openClawSnapshotTraceEvent `json:"ledgerEvents"`
}

func traceOpenClawSnapshotSummary(ctx context.Context, req OpenClawRequestContext, data json.RawMessage) {
	if !openClawSnapshotDebugEnabled() {
		return
	}

	summary := summarizeOpenClawSnapshotPayload(req, data)
	raw, err := json.Marshal(summary)
	if err != nil {
		logger.Infof(ctx, "[openclaw-snapshot] hub.summary {}")
		return
	}
	logger.Infof(ctx, "[openclaw-snapshot] hub.summary %s", string(raw))
}

func traceOpenClawSnapshotError(ctx context.Context, req OpenClawRequestContext, svcErr *OpenClawServiceError) {
	if !openClawSnapshotDebugEnabled() || svcErr == nil {
		return
	}
	summary := map[string]interface{}{
		"agent_id":             req.AgentID,
		"conversation_id_hash": openClawTraceHash(req.ConversationID),
		"after_seq":            req.Query.AfterSeq,
		"http_status":          svcErr.HTTPStatus,
		"code":                 svcErr.Code,
		"message_length":       len(svcErr.Error()),
		"message_hash":         openClawTraceHash(svcErr.Error()),
	}
	raw, err := json.Marshal(summary)
	if err != nil {
		logger.Infof(ctx, "[openclaw-snapshot] hub.error {}")
		return
	}
	logger.Infof(ctx, "[openclaw-snapshot] hub.error %s", string(raw))
}

func openClawSnapshotDebugEnabled() bool {
	value := strings.ToLower(strings.TrimSpace(os.Getenv("OPENCLAW_LEDGER_DEBUG")))
	if value == "" {
		value = strings.ToLower(strings.TrimSpace(os.Getenv("OPENCLAW_DIAG_LOGS")))
	}
	return value == "1" || value == "true" || value == "yes"
}

func openClawRuntimeTraceEnabled() bool {
	value := strings.ToLower(strings.TrimSpace(os.Getenv("OPENCLAW_TRACE_STREAM")))
	if value == "" {
		value = strings.ToLower(strings.TrimSpace(os.Getenv("OPENCLAW_DIAG_LOGS")))
	}
	return value == "1" || value == "true" || value == "yes"
}

func traceOpenClawRPC(ctx context.Context, label string, req OpenClawRequestContext, action string, fields map[string]interface{}) {
	if !openClawRuntimeTraceEnabled() {
		return
	}
	payload := map[string]interface{}{
		"action":               action,
		"agent_id":             req.AgentID,
		"user_id":              req.UserID,
		"conversation_id_hash": openClawTraceHash(req.ConversationID),
		"limit":                req.Query.Limit,
		"offset":               req.Query.Offset,
		"after_seq":            req.Query.AfterSeq,
	}
	for key, value := range fields {
		payload[key] = value
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		logger.Infof(ctx, "[openclaw-rpc-trace] %s {}", label)
		return
	}
	logger.Infof(ctx, "[openclaw-rpc-trace] %s %s", label, string(raw))
}

func openClawTracePayloadKeys(payload map[string]interface{}) []string {
	if len(payload) == 0 {
		return []string{}
	}
	keys := make([]string, 0, len(payload))
	for key := range payload {
		keys = append(keys, key)
	}
	return keys
}

func summarizeOpenClawSnapshotPayload(req OpenClawRequestContext, data json.RawMessage) map[string]interface{} {
	summary := map[string]interface{}{
		"agent_id":             req.AgentID,
		"conversation_id_hash": openClawTraceHash(req.ConversationID),
		"after_seq":            req.Query.AfterSeq,
		"payload_bytes":        len(data),
	}

	var payload openClawSnapshotTracePayload
	if err := json.Unmarshal(data, &payload); err != nil {
		summary["parse_error"] = err.Error()
		summary["payload_hash"] = openClawTraceHash(string(data))
		return summary
	}

	ledgerEvents := payload.LedgerEvents
	if len(ledgerEvents) == 0 && len(payload.LedgerEvents2) > 0 {
		ledgerEvents = payload.LedgerEvents2
	}
	summary["session_id_hash"] = openClawTraceHash(payload.SessionID)
	summary["snapshot_conversation_id_hash"] = openClawTraceHash(payload.ConversationID)
	summary["last_seq"] = payload.LastSeq
	summary["active_turn_count"] = len(payload.ActiveTurns)
	summary["running_active_turn_count"] = countOpenClawSnapshotTurnsByStatus(payload.ActiveTurns, "running")
	summary["active_status_counts"] = countOpenClawSnapshotTurnStatuses(payload.ActiveTurns)
	summary["active_last_seq_max"] = maxOpenClawSnapshotTurnSeq(payload.ActiveTurns)
	summary["active_turns"] = summarizeOpenClawSnapshotTurns(payload.ActiveTurns, 5)
	summary["recent_event_count"] = len(payload.RecentEvents)
	summary["recent_event_max_seq"] = maxOpenClawSnapshotEventSeq(payload.RecentEvents)
	summary["recent_event_type_counts"] = countOpenClawSnapshotEventTypes(payload.RecentEvents)
	summary["recent_terminal_status_counts"] = countOpenClawSnapshotEventTerminalStatuses(payload.RecentEvents)
	summary["recent_tail_events"] = summarizeOpenClawSnapshotEvents(payload.RecentEvents, 3)
	summary["ledger_event_count"] = len(ledgerEvents)
	summary["ledger_event_max_seq"] = maxOpenClawSnapshotEventSeq(ledgerEvents)
	summary["ledger_event_type_counts"] = countOpenClawSnapshotEventTypes(ledgerEvents)
	summary["ledger_terminal_status_counts"] = countOpenClawSnapshotEventTerminalStatuses(ledgerEvents)
	summary["ledger_tail_events"] = summarizeOpenClawSnapshotEvents(ledgerEvents, 3)
	return summary
}

func countOpenClawSnapshotTurnsByStatus(turns []openClawSnapshotTraceTurn, status string) int {
	count := 0
	for _, turn := range turns {
		if turn.Status == status {
			count++
		}
	}
	return count
}

func countOpenClawSnapshotTurnStatuses(turns []openClawSnapshotTraceTurn) map[string]int {
	counts := map[string]int{}
	for _, turn := range turns {
		status := strings.TrimSpace(turn.Status)
		if status == "" {
			status = "unknown"
		}
		counts[status]++
	}
	return counts
}

func maxOpenClawSnapshotTurnSeq(turns []openClawSnapshotTraceTurn) int {
	maxSeq := 0
	for _, turn := range turns {
		if turn.LastSeq > maxSeq {
			maxSeq = turn.LastSeq
		}
	}
	return maxSeq
}

func maxOpenClawSnapshotEventSeq(events []openClawSnapshotTraceEvent) int {
	maxSeq := 0
	for _, event := range events {
		if event.Seq > maxSeq {
			maxSeq = event.Seq
		}
	}
	return maxSeq
}

func countOpenClawSnapshotEventTypes(events []openClawSnapshotTraceEvent) map[string]int {
	counts := map[string]int{}
	for _, event := range events {
		eventType := strings.TrimSpace(event.EventType)
		if eventType == "" {
			eventType = "unknown"
		}
		counts[eventType]++
	}
	return counts
}

func countOpenClawSnapshotEventTerminalStatuses(events []openClawSnapshotTraceEvent) map[string]int {
	counts := map[string]int{}
	for _, event := range events {
		status := strings.TrimSpace(event.TerminalStatus)
		if status == "" {
			continue
		}
		counts[status]++
	}
	return counts
}

func summarizeOpenClawSnapshotTurns(turns []openClawSnapshotTraceTurn, limit int) []map[string]interface{} {
	if limit <= 0 || len(turns) == 0 {
		return []map[string]interface{}{}
	}
	start := len(turns) - limit
	if start < 0 {
		start = 0
	}
	summaries := make([]map[string]interface{}, 0, len(turns)-start)
	for _, turn := range turns[start:] {
		partIDHashes := make([]string, 0, len(turn.PartIDs))
		for _, partID := range turn.PartIDs {
			partIDHashes = append(partIDHashes, openClawTraceHash(partID))
			if len(partIDHashes) >= 5 {
				break
			}
		}
		summaries = append(summaries, map[string]interface{}{
			"turn_id_hash":           openClawTraceHash(turn.TurnID),
			"run_id_hash":            openClawTraceHash(turn.RunID),
			"active_request_id_hash": openClawTraceHash(turn.ActiveRequestID),
			"status":                 turn.Status,
			"terminal_seq":           turn.TerminalSeq,
			"last_seq":               turn.LastSeq,
			"part_count":             len(turn.PartIDs),
			"part_id_hashes":         partIDHashes,
		})
	}
	return summaries
}

func summarizeOpenClawSnapshotEvents(events []openClawSnapshotTraceEvent, limit int) []map[string]interface{} {
	if limit <= 0 || len(events) == 0 {
		return []map[string]interface{}{}
	}
	start := len(events) - limit
	if start < 0 {
		start = 0
	}
	summaries := make([]map[string]interface{}, 0, len(events)-start)
	for _, event := range events[start:] {
		summaries = append(summaries, map[string]interface{}{
			"seq":                    event.Seq,
			"turn_id_hash":           openClawTraceHash(event.TurnID),
			"run_id_hash":            openClawTraceHash(event.RunID),
			"active_request_id_hash": openClawTraceHash(event.ActiveRequestID),
			"part_id_hash":           openClawTraceHash(event.PartID),
			"part_type":              event.PartType,
			"event_type":             event.EventType,
			"operation":              event.Operation,
			"visibility":             event.Visibility,
			"terminal_status":        event.TerminalStatus,
			"text_length":            len(event.Text),
			"text_hash":              openClawTraceHash(event.Text),
			"raw_event_ref_hash":     openClawTraceHash(event.RawEventRef),
		})
	}
	return summaries
}

func openClawTraceHash(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	sum := sha1.Sum([]byte(value))
	return fmt.Sprintf("%x", sum)[:12]
}

func openClawHubUserName(userID int64) string {
	user, err := model.GetUserByID(userID)
	if err != nil || user == nil {
		return openClawHubUserKey(userID)
	}
	for _, value := range []string{user.Nickname, user.Email, user.Username} {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return openClawHubUserKey(userID)
}

func (s *OpenClawService) loadAgent(req OpenClawRequestContext) (*model.Agent, *OpenClawServiceError) {
	agent, err := model.GetAgentByID(req.EID, req.AgentID)
	if err != nil {
		return nil, newOpenClawServiceError(http.StatusNotFound, model.NotFound, "OpenClaw 智能体不存在", err)
	}
	if !agent.IsOpenClawWSCompatible() {
		return nil, newOpenClawServiceError(http.StatusBadRequest, model.ParamError, "目标智能体不是 OpenClawWS 类型", nil)
	}
	if !canAccessOpenClawAgent(agent, req.UserID, req.Role, req.GroupID) {
		return nil, newOpenClawServiceError(http.StatusForbidden, model.ForbiddenError, "无权访问该 OpenClaw 智能体", nil)
	}
	return agent, nil
}

func canAccessOpenClawAgent(agent *model.Agent, userID int64, role int64, groupID int64) bool {
	if agent == nil || userID <= 0 {
		return false
	}
	if agent.OwnerID > 0 {
		return agent.OwnerID == userID
	}
	if role >= model.RoleAdminUser {
		return true
	}
	hasPermission, err := model.CheckPermission(groupID, agent.AgentID, model.ResourceTypeAgent, model.PermissionRead)
	return err == nil && hasPermission
}

func openClawPaginationPayload(query OpenClawPaginationQuery) (map[string]interface{}, *OpenClawServiceError) {
	if query.Limit < 0 || query.Offset < 0 {
		return nil, newOpenClawServiceError(http.StatusBadRequest, model.ParamError, "分页参数不合法", nil)
	}
	if query.Limit > openClawMaxPageLimit {
		return nil, newOpenClawServiceError(http.StatusBadRequest, model.ParamError, "分页 limit 超出上限", nil)
	}
	limit := query.Limit
	if limit == 0 {
		limit = openClawDefaultPageLimit
	}
	payload := map[string]interface{}{
		"limit":  limit,
		"offset": query.Offset,
	}
	return payload, nil
}

func openClawEventsPayload(query OpenClawPaginationQuery) (map[string]interface{}, *OpenClawServiceError) {
	payload, svcErr := openClawPaginationPayload(query)
	if svcErr != nil {
		return nil, svcErr
	}
	if query.AfterSeq < 0 {
		return nil, newOpenClawServiceError(http.StatusBadRequest, model.ParamError, "事件序号参数不合法", nil)
	}
	if query.AfterSeq > 0 {
		payload["after_seq"] = query.AfterSeq
		payload["afterSeq"] = query.AfterSeq
	}
	return payload, nil
}

func mapOpenClawRPCError(err error) *OpenClawServiceError {
	if errors.Is(err, wsmanager.ErrRPCTooManyRequests) {
		return newOpenClawServiceError(http.StatusTooManyRequests, model.OperateTooFast, "OpenClaw 请求过于频繁", err)
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return newOpenClawServiceError(http.StatusGatewayTimeout, model.NetworkError, "OpenClaw 插件调用超时", err)
	}
	if errors.Is(err, context.Canceled) {
		return newOpenClawServiceError(http.StatusServiceUnavailable, model.NetworkError, "OpenClaw 插件调用已取消", err)
	}

	var rpcErr *wsmanager.RPCStatusError
	if errors.As(err, &rpcErr) {
		code := strings.ToUpper(rpcErr.Code)
		switch {
		case strings.Contains(code, "NOT_FOUND"):
			return newOpenClawServiceError(http.StatusNotFound, model.NotFound, rpcErr.Error(), err)
		case strings.Contains(code, "FEATURE") || strings.Contains(code, "UNSUPPORTED"):
			return newOpenClawServiceError(http.StatusServiceUnavailable, model.FeatureNotAvailableError, rpcErr.Error(), err)
		case strings.Contains(code, "PARAM") || strings.Contains(code, "INVALID"):
			return newOpenClawServiceError(http.StatusBadRequest, model.ParamError, rpcErr.Error(), err)
		default:
			return newOpenClawServiceError(http.StatusBadGateway, model.NetworkError, rpcErr.Error(), err)
		}
	}

	return newOpenClawServiceError(http.StatusBadGateway, model.NetworkError, "OpenClaw 插件调用失败", err)
}

func newOpenClawServiceError(status int, code model.ResponseCode, message string, err error) *OpenClawServiceError {
	return &OpenClawServiceError{
		HTTPStatus: status,
		Code:       code,
		Message:    message,
		Err:        err,
	}
}
