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

type AgentRunService struct {
	broker AgentRunEventBroker
}

var (
	ErrAgentRunNotFound         = errors.New("agent run not found")
	defaultAgentRunEventBroker  = newAgentRunEventBroker()
	agentRunSubscriptionMaxIdle = 20 * time.Minute
)

func NewAgentRunService() *AgentRunService {
	return &AgentRunService{broker: defaultAgentRunEventBroker}
}

func NewAgentRunServiceWithBroker(broker AgentRunEventBroker) *AgentRunService {
	if broker == nil {
		broker = defaultAgentRunEventBroker
	}
	return &AgentRunService{broker: broker}
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
	if err := model.UpdateAgentRunByRunID(eid, runID, updates); err != nil {
		return err
	}
	s.publishRunNotification(ctx, AgentRunEventNotification{
		EID: eid, RunID: runID, PublishedAt: time.Now().UnixMilli(),
	})
	return nil
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
	db := model.DB
	if ctx != nil {
		db = db.WithContext(ctx)
	}
	createdEvent, err := model.AppendAgentRunEventWithAutoSeqTx(db, eid, runID, event)
	if err != nil {
		return nil, err
	}

	if err := model.UpdateAgentRunByRunIDWithDB(db, eid, runID, map[string]interface{}{"last_event_id": createdEvent.ID}); err != nil {
		logger.Warnf(ctx, "update run last_event_id failed: run_id=%s, err=%v", runID, err)
	}
	s.publishEventNotification(ctx, createdEvent)

	return createdEvent, nil
}

func (s *AgentRunService) publishEventNotification(ctx context.Context, event *model.AgentRunEvent) {
	if event == nil {
		return
	}
	s.publishRunNotification(ctx, AgentRunEventNotification{
		EID: event.Eid, RunID: event.RunID, Seq: event.Seq, PublishedAt: time.Now().UnixMilli(),
	})
}

func (s *AgentRunService) publishRunNotification(ctx context.Context, notification AgentRunEventNotification) {
	if s == nil {
		return
	}
	if ctx == nil {
		ctx = context.Background()
	}
	broker := s.broker
	if broker == nil {
		broker = defaultAgentRunEventBroker
	}
	if err := broker.Publish(ctx, notification); err != nil {
		logger.Warnf(ctx, "agent run event notification failed: eid=%d, run_id=%s, seq=%d, err=%v", notification.EID, notification.RunID, notification.Seq, err)
	}
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

// AppendEventsForRequestBatch appends a serialized event batch with one run
// lookup, one bulk insert and one last_event_id update.
func (s *AgentRunService) AppendEventsForRequestBatch(ctx context.Context, eid int64, requestID string, inputs []model.AgentRunEventInput) error {
	requestID = strings.TrimSpace(requestID)
	if requestID == "" || len(inputs) == 0 {
		return nil
	}
	run, err := s.GetRunByRequestID(ctx, eid, requestID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}

	events := make([]*model.AgentRunEvent, 0, len(inputs))
	for _, input := range inputs {
		payloadJSON := ""
		if len(input.Payload) > 0 {
			b, marshalErr := json.Marshal(input.Payload)
			if marshalErr != nil {
				return fmt.Errorf("marshal payload failed: %w", marshalErr)
			}
			payloadJSON = string(b)
		}
		events = append(events, &model.AgentRunEvent{
			RequestID:   requestID,
			EventType:   input.EventType,
			MessageID:   input.MessageID,
			PayloadJSON: payloadJSON,
		})
	}
	created, err := model.AppendAgentRunEventsWithAutoSeq(eid, run.RunID, events)
	if err != nil {
		return err
	}
	if len(created) > 0 {
		return model.UpdateAgentRunByRunID(eid, run.RunID, map[string]interface{}{"last_event_id": created[len(created)-1].ID})
	}
	return nil
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
		pollInterval = 5 * time.Second
	}
	if limit <= 0 {
		limit = 200
	}
	if limit > 2000 {
		limit = 2000
	}
	broker := s.broker
	if broker == nil {
		broker = defaultAgentRunEventBroker
	}
	subscription, subscribeErr := broker.Subscribe(ctx, eid, run.RunID)
	if subscribeErr != nil {
		logger.Warnf(ctx, "agent run realtime subscription unavailable, using DB reconcile: eid=%d, run_id=%s, err=%v", eid, run.RunID, subscribeErr)
	}

	eventsCh := make(chan *model.AgentRunEvent)
	errCh := make(chan error, 1)

	go func() {
		defer close(eventsCh)
		defer close(errCh)
		watchStartedAt := time.Now()
		notificationCount := 0
		reconcileCount := 0
		emittedCount := 0
		maxNotificationLag := int64(0)
		defer func() {
			logger.Infof(ctx, "agent run subscription summary: eid=%d, run_id=%s, notifications=%d, reconciles=%d, emitted=%d, max_notification_lag_ms=%d, elapsed_ms=%d",
				eid, runID, notificationCount, reconcileCount, emittedCount, maxNotificationLag, time.Since(watchStartedAt).Milliseconds())
		}()
		if subscription != nil {
			defer subscription.Close()
		}

		ticker := time.NewTicker(pollInterval)
		defer ticker.Stop()

		lastSeq := afterSeq
		currentRun := run
		lastObservedStatus := ""
		lastEventAt := time.Now()
		reconcile := func() (bool, error) {
			reconcileCount++
			for {
				events, queryErr := model.GetAgentRunEventsAfterSeq(eid, currentRun.RunID, lastSeq, limit)
				if queryErr != nil {
					return false, queryErr
				}
				for _, event := range events {
					select {
					case eventsCh <- event:
						lastSeq = event.Seq
						emittedCount++
						lastEventAt = time.Now()
					case <-ctx.Done():
						return false, ctx.Err()
					}
				}
				if len(events) < limit {
					break
				}
			}
			refreshedRun, queryErr := model.GetAgentRunByRunID(eid, currentRun.RunID)
			if queryErr != nil {
				return false, queryErr
			}
			currentRun = refreshedRun
			if currentRun.Status != lastObservedStatus {
				logger.Infof(ctx, "【诊断-AgentRun】订阅观察到Run状态: eid=%d run_id=%s status=%s last_seq=%d last_event_id=%d",
					eid, currentRun.RunID, currentRun.Status, lastSeq, currentRun.LastEventID)
				lastObservedStatus = currentRun.Status
			}
			return isAgentRunTerminalStatus(currentRun.Status), nil
		}
		checkIdle := func() bool {
			maxIdle := agentRunSubscriptionMaxIdle
			if maxIdle <= 0 || time.Since(lastEventAt) < maxIdle {
				return false
			}
			idleErr := fmt.Errorf("agent run subscription idle timeout: eid=%d run_id=%s status=%s last_seq=%d idle=%s",
				eid, currentRun.RunID, currentRun.Status, lastSeq, time.Since(lastEventAt).Round(time.Millisecond))
			logger.Warnf(ctx, "【诊断-AgentRun】订阅空闲超时: eid=%d run_id=%s status=%s last_seq=%d idle=%s",
				eid, currentRun.RunID, currentRun.Status, lastSeq, time.Since(lastEventAt).Round(time.Millisecond))
			errCh <- idleErr
			return true
		}

		terminal, reconcileErr := reconcile()
		if reconcileErr != nil {
			if !errors.Is(reconcileErr, context.Canceled) {
				errCh <- reconcileErr
			}
			return
		}
		if terminal {
			logger.Infof(ctx, "【诊断-AgentRun】订阅因终态结束: eid=%d run_id=%s status=%s last_seq=%d", eid, currentRun.RunID, currentRun.Status, lastSeq)
			return
		}
		if checkIdle() {
			return
		}

		var notifications <-chan AgentRunEventNotification
		if subscription != nil {
			notifications = subscription.Notifications()
		}
		for {
			select {
			case notification, ok := <-notifications:
				if !ok {
					notifications = nil
					continue
				}
				notificationCount++
				if notification.PublishedAt > 0 {
					lag := time.Now().UnixMilli() - notification.PublishedAt
					if lag > maxNotificationLag {
						maxNotificationLag = lag
					}
				}
			case <-ticker.C:
				// Reconcile durable state at a low frequency for missed/cross-instance notifications.
			case <-ctx.Done():
				logger.Infof(ctx, "【诊断-AgentRun】订阅因上下文取消结束: eid=%d run_id=%s last_seq=%d", eid, currentRun.RunID, lastSeq)
				return
			}

			terminal, reconcileErr = reconcile()
			if reconcileErr != nil {
				if !errors.Is(reconcileErr, context.Canceled) {
					errCh <- reconcileErr
				}
				return
			}
			if terminal {
				logger.Infof(ctx, "【诊断-AgentRun】订阅因终态结束: eid=%d run_id=%s status=%s last_seq=%d", eid, currentRun.RunID, currentRun.Status, lastSeq)
				return
			}
			if checkIdle() {
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

	var cancelEvent *model.AgentRunEvent
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
		cancelEvent = event

		return model.UpdateAgentRunByRunIDWithDB(tx, eid, runID, map[string]interface{}{
			"last_event_id": event.ID,
		})
	})
	if err != nil {
		return nil, err
	}
	s.publishEventNotification(ctx, cancelEvent)

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

	var terminalEvent *model.AgentRunEvent
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
		terminalEvent = event

		return tx.Model(&model.AgentRun{}).
			Where("eid = ? AND run_id = ?", eid, runID).
			Updates(map[string]interface{}{
				"last_event_id": event.ID,
			}).Error
	})
	if err != nil {
		return nil, err
	}
	s.publishEventNotification(ctx, terminalEvent)

	return s.GetRunByRunID(ctx, eid, runID)
}
