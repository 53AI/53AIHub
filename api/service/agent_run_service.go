package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

type AgentRunService struct{}

var (
	ErrAgentRunNotFound = errors.New("agent run not found")
)

func NewAgentRunService() *AgentRunService {
	return &AgentRunService{}
}

func (s *AgentRunService) CreateRun(ctx context.Context, eid, conversationID, messageID int64, requestID string) (*model.AgentRun, error) {
	run := &model.AgentRun{
		Eid:            eid,
		ConversationID: conversationID,
		MessageID:      messageID,
		RequestID:      requestID,
		Status:         model.AgentRunStatusQueued,
		StartedAt:      time.Now().UTC().UnixMilli(),
	}
	if err := model.CreateAgentRun(run); err != nil {
		return nil, err
	}
	return run, nil
}

func (s *AgentRunService) EnsureRunForRequest(ctx context.Context, eid, conversationID, messageID int64, requestID string) (*model.AgentRun, bool, error) {
	requestID = strings.TrimSpace(requestID)
	if requestID == "" {
		return nil, false, fmt.Errorf("request_id is required")
	}

	run, err := s.GetRunByRequestID(ctx, eid, requestID)
	if err == nil {
		updates := map[string]interface{}{}
		if conversationID > 0 && run.ConversationID == 0 {
			updates["conversation_id"] = conversationID
		}
		if messageID > 0 && run.MessageID != messageID {
			updates["message_id"] = messageID
		}
		if len(updates) > 0 {
			if err := model.UpdateAgentRunByRunID(eid, run.RunID, updates); err != nil {
				return nil, false, err
			}
			updatedRun, loadErr := s.GetRunByRunID(ctx, eid, run.RunID)
			if loadErr != nil {
				return nil, false, loadErr
			}
			return updatedRun, false, nil
		}
		return run, false, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, false, err
	}

	createdRun, err := s.CreateRun(ctx, eid, conversationID, messageID, requestID)
	if err != nil {
		return nil, false, err
	}
	return createdRun, true, nil
}

func (s *AgentRunService) GetRunByRequestID(ctx context.Context, eid int64, requestID string) (*model.AgentRun, error) {
	return model.GetAgentRunByRequestID(eid, requestID)
}

func (s *AgentRunService) GetRunByRunID(ctx context.Context, eid int64, runID string) (*model.AgentRun, error) {
	return model.GetAgentRunByRunID(eid, runID)
}

func (s *AgentRunService) UpdateRunStatus(ctx context.Context, eid int64, runID string, status string, errorCode string, errorMessage string) error {
	updates := map[string]interface{}{
		"status": status,
	}
	if errorCode != "" {
		updates["error_code"] = errorCode
	}
	if errorMessage != "" {
		updates["error_message"] = errorMessage
	}
	if status == model.AgentRunStatusCompleted || status == model.AgentRunStatusFailed || status == model.AgentRunStatusCancelled {
		updates["finished_at"] = time.Now().UTC().UnixMilli()
	}
	if status == model.AgentRunStatusCancelling {
		updates["cancel_requested_at"] = time.Now().UTC().UnixMilli()
	}
	return model.UpdateAgentRunByRunID(eid, runID, updates)
}

func (s *AgentRunService) AppendEvent(ctx context.Context, eid int64, runID string, requestID string, eventType string, messageID int64, payload map[string]interface{}) (*model.AgentRunEvent, error) {
	payloadJSON := ""
	if len(payload) > 0 {
		b, err := json.Marshal(payload)
		if err != nil {
			return nil, fmt.Errorf("marshal payload failed: %w", err)
		}
		payloadJSON = string(b)
	}

	event := &model.AgentRunEvent{
		RequestID:   requestID,
		EventType:   eventType,
		MessageID:   messageID,
		PayloadJSON: payloadJSON,
	}
	createdEvent, err := model.AppendAgentRunEventWithAutoSeq(eid, runID, event)
	if err != nil {
		return nil, err
	}

	if err := model.UpdateAgentRunByRunID(eid, runID, map[string]interface{}{"last_event_id": createdEvent.ID}); err != nil {
		logger.Warnf(ctx, "update run last_event_id failed: run_id=%s, err=%v", runID, err)
	}

	return createdEvent, nil
}

func (s *AgentRunService) AppendEventForRequest(ctx context.Context, eid int64, requestID string, eventType string, messageID int64, payload map[string]interface{}) (*model.AgentRunEvent, error) {
	requestID = strings.TrimSpace(requestID)
	if requestID == "" {
		return nil, nil
	}

	run, err := s.GetRunByRequestID(ctx, eid, requestID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}

	return s.AppendEvent(ctx, eid, run.RunID, requestID, eventType, messageID, payload)
}

func (s *AgentRunService) ListEventsAfterSeq(ctx context.Context, eid int64, runID string, afterSeq int64, limit int) ([]*model.AgentRunEvent, error) {
	return model.GetAgentRunEventsAfterSeq(eid, runID, afterSeq, limit)
}

func (s *AgentRunService) GetRunForUser(ctx context.Context, eid int64, userID int64, userRole int64, runID string) (*model.AgentRun, error) {
	run, err := model.GetAgentRunByRunID(eid, runID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrAgentRunNotFound
		}
		return nil, err
	}
	if _, err := s.loadAccessibleConversation(ctx, eid, userID, userRole, run.ConversationID); err != nil {
		return nil, err
	}
	return run, nil
}

func (s *AgentRunService) GetLatestRunForConversation(ctx context.Context, eid int64, userID int64, userRole int64, conversationID int64) (*model.AgentRun, error) {
	if _, err := s.loadAccessibleConversation(ctx, eid, userID, userRole, conversationID); err != nil {
		return nil, err
	}
	run, err := model.GetLatestAgentRunByConversationID(eid, conversationID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrAgentRunNotFound
		}
		return nil, err
	}
	return run, nil
}

func (s *AgentRunService) ListRunsForConversation(ctx context.Context, eid int64, userID int64, userRole int64, conversationID int64, offset int, limit int) (int64, []*model.AgentRun, error) {
	if _, err := s.loadAccessibleConversation(ctx, eid, userID, userRole, conversationID); err != nil {
		return 0, nil, err
	}
	return model.GetAgentRunsByConversationID(eid, conversationID, limit, offset)
}

func (s *AgentRunService) GetLatestRunsForConversations(ctx context.Context, eid int64, conversationIDs []int64) (map[int64]*model.AgentRun, error) {
	return model.GetLatestAgentRunsByConversationIDs(eid, conversationIDs)
}

func (s *AgentRunService) ListEventsForUser(ctx context.Context, eid int64, userID int64, userRole int64, runID string, afterSeq int64, limit int) ([]*model.AgentRunEvent, error) {
	run, err := s.GetRunForUser(ctx, eid, userID, userRole, runID)
	if err != nil {
		return nil, err
	}
	return model.GetAgentRunEventsAfterSeq(eid, run.RunID, afterSeq, limit)
}

func (s *AgentRunService) WatchEventsForUser(ctx context.Context, eid int64, userID int64, userRole int64, runID string, afterSeq int64, limit int, pollInterval time.Duration) (<-chan *model.AgentRunEvent, <-chan error, error) {
	run, err := s.GetRunForUser(ctx, eid, userID, userRole, runID)
	if err != nil {
		return nil, nil, err
	}

	if pollInterval <= 0 {
		pollInterval = 500 * time.Millisecond
	}

	eventsCh := make(chan *model.AgentRunEvent)
	errCh := make(chan error, 1)

	go func() {
		defer close(eventsCh)
		defer close(errCh)

		ticker := time.NewTicker(pollInterval)
		defer ticker.Stop()

		lastSeq := afterSeq
		currentRun := run

		for {
			events, err := model.GetAgentRunEventsAfterSeq(eid, currentRun.RunID, lastSeq, limit)
			if err != nil {
				errCh <- err
				return
			}

			if len(events) > 0 {
				for _, event := range events {
					select {
					case eventsCh <- event:
						lastSeq = event.Seq
					case <-ctx.Done():
						return
					}
				}
				continue
			}

			if isAgentRunTerminalStatus(currentRun.Status) {
				return
			}

			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}

			currentRun, err = model.GetAgentRunByRunID(eid, currentRun.RunID)
			if err != nil {
				errCh <- err
				return
			}
		}
	}()

	return eventsCh, errCh, nil
}

func (s *AgentRunService) RequestCancelRun(ctx context.Context, eid int64, userID int64, userRole int64, runID string) (*model.AgentRun, error) {
	run, err := s.GetRunForUser(ctx, eid, userID, userRole, runID)
	if err != nil {
		return nil, err
	}

	switch run.Status {
	case model.AgentRunStatusCompleted, model.AgentRunStatusFailed, model.AgentRunStatusCancelled, model.AgentRunStatusCancelling:
		return run, nil
	}

	err = model.DB.Transaction(func(tx *gorm.DB) error {
		now := time.Now().UTC().UnixMilli()
		result := tx.Model(&model.AgentRun{}).
			Where("eid = ? AND run_id = ? AND status NOT IN ?", eid, runID, []string{
				model.AgentRunStatusCompleted,
				model.AgentRunStatusFailed,
				model.AgentRunStatusCancelled,
				model.AgentRunStatusCancelling,
			}).
			Updates(map[string]interface{}{
				"status":              model.AgentRunStatusCancelling,
				"cancel_requested_at": now,
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return nil
		}

		payloadJSON, marshalErr := json.Marshal(map[string]interface{}{
			"status": model.AgentRunStatusCancelling,
		})
		if marshalErr != nil {
			return fmt.Errorf("marshal cancel event payload failed: %w", marshalErr)
		}

		event, appendErr := appendAgentRunEventInTx(tx, eid, runID, &model.AgentRunEvent{
			RequestID:   run.RequestID,
			EventType:   model.AgentRunEventStatusChanged,
			MessageID:   run.MessageID,
			PayloadJSON: string(payloadJSON),
			CreatedAt:   now,
		})
		if appendErr != nil {
			return appendErr
		}

		return model.UpdateAgentRunByRunIDWithDB(tx, eid, runID, map[string]interface{}{
			"last_event_id": event.ID,
		})
	})
	if err != nil {
		return nil, err
	}

	return s.GetRunByRunID(ctx, eid, runID)
}

func (s *AgentRunService) FinalizeCancelledRun(ctx context.Context, eid int64, runID string, errorCode string, errorMessage string) (*model.AgentRun, error) {
	return s.finalizeRun(ctx, eid, runID, model.AgentRunStatusCancelled, model.AgentRunEventRunCancelled, errorCode, errorMessage)
}

func (s *AgentRunService) FinalizeCompletedRun(ctx context.Context, eid int64, runID string, errorCode string, errorMessage string) (*model.AgentRun, error) {
	return s.finalizeRun(ctx, eid, runID, model.AgentRunStatusCompleted, model.AgentRunEventRunCompleted, errorCode, errorMessage)
}

func (s *AgentRunService) FinalizeFailedRun(ctx context.Context, eid int64, runID string, errorCode string, errorMessage string) (*model.AgentRun, error) {
	return s.finalizeRun(ctx, eid, runID, model.AgentRunStatusFailed, model.AgentRunEventRunFailed, errorCode, errorMessage)
}

func (s *AgentRunService) loadAccessibleConversation(ctx context.Context, eid int64, userID int64, userRole int64, conversationID int64) (*model.Conversation, error) {
	if conversationID <= 0 {
		return nil, ErrAgentRunNotFound
	}
	if userRole >= model.RoleAdminUser {
		conversation, err := model.AdminGetConversationAccessByID(eid, conversationID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				logger.Warnf(ctx, "agent run conversation not found for admin: eid=%d, conversation_id=%d", eid, conversationID)
				return nil, ErrAgentRunNotFound
			}
			return nil, err
		}
		return conversation, nil
	}

	conversation, err := model.GetConversationAccessByID(eid, userID, conversationID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			logger.Warnf(ctx, "agent run conversation not accessible: eid=%d, user_id=%d, conversation_id=%d", eid, userID, conversationID)
			return nil, ErrAgentRunNotFound
		}
		return nil, err
	}
	return conversation, nil
}

func appendAgentRunEventInTx(tx *gorm.DB, eid int64, runID string, event *model.AgentRunEvent) (*model.AgentRunEvent, error) {
	if event == nil {
		return nil, fmt.Errorf("agent run event is nil")
	}

	var maxSeq int64
	if err := tx.Model(&model.AgentRunEvent{}).
		Where("eid = ? AND run_id = ?", eid, runID).
		Select("COALESCE(MAX(seq), 0)").
		Scan(&maxSeq).Error; err != nil {
		return nil, err
	}

	event.Eid = eid
	event.RunID = runID
	event.Seq = maxSeq + 1
	if event.CreatedAt == 0 {
		event.CreatedAt = time.Now().UTC().UnixMilli()
	}
	if err := tx.Create(event).Error; err != nil {
		return nil, err
	}
	return event, nil
}

func isAgentRunTerminalStatus(status string) bool {
	switch status {
	case model.AgentRunStatusCompleted, model.AgentRunStatusFailed, model.AgentRunStatusCancelled:
		return true
	default:
		return false
	}
}

func mustMarshalJSONString(value interface{}) string {
	b, err := json.Marshal(value)
	if err != nil {
		return "{}"
	}
	return string(b)
}

func (s *AgentRunService) finalizeRun(ctx context.Context, eid int64, runID string, status string, eventType string, errorCode string, errorMessage string) (*model.AgentRun, error) {
	run, err := s.GetRunByRunID(ctx, eid, runID)
	if err != nil {
		return nil, err
	}

	switch run.Status {
	case model.AgentRunStatusCompleted, model.AgentRunStatusFailed, model.AgentRunStatusCancelled:
		return run, nil
	}

	now := time.Now().UTC().UnixMilli()
	eventPayload := map[string]interface{}{
		"status": status,
	}
	if errorCode != "" {
		eventPayload["error_code"] = errorCode
	}
	if errorMessage != "" {
		eventPayload["error_message"] = errorMessage
	}

	err = model.DB.Transaction(func(tx *gorm.DB) error {
		updates := map[string]interface{}{
			"status":      status,
			"finished_at": now,
		}
		if errorCode != "" {
			updates["error_code"] = errorCode
		}
		if errorMessage != "" {
			updates["error_message"] = errorMessage
		}
		if status == model.AgentRunStatusCancelled {
			if run.CancelRequestedAt > 0 {
				updates["cancel_requested_at"] = run.CancelRequestedAt
			} else {
				updates["cancel_requested_at"] = now
			}
		}

		result := tx.Model(&model.AgentRun{}).
			Where("eid = ? AND run_id = ? AND status NOT IN ?", eid, runID, []string{
				model.AgentRunStatusCompleted,
				model.AgentRunStatusFailed,
				model.AgentRunStatusCancelled,
			}).
			Updates(updates)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return nil
		}

		event, appendErr := appendAgentRunEventInTx(tx, eid, runID, &model.AgentRunEvent{
			RequestID:   run.RequestID,
			EventType:   eventType,
			MessageID:   run.MessageID,
			PayloadJSON: mustMarshalJSONString(eventPayload),
			CreatedAt:   now,
		})
		if appendErr != nil {
			return appendErr
		}

		return tx.Model(&model.AgentRun{}).
			Where("eid = ? AND run_id = ?", eid, runID).
			Updates(map[string]interface{}{
				"last_event_id": event.ID,
			}).Error
	})
	if err != nil {
		return nil, err
	}

	return s.GetRunByRunID(ctx, eid, runID)
}
