package model

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"
)

const (
	AgentRunEventRunCreated     = "run.created"
	AgentRunEventStatusChanged  = "run.status_changed"
	AgentRunEventMessageDelta   = "message.delta"
	AgentRunEventStepCreated    = "step.created"
	AgentRunEventMessageDone    = "message.completed"
	AgentRunEventRunCompleted   = "run.completed"
	AgentRunEventRunFailed      = "run.failed"
	AgentRunEventRunCancelled   = "run.cancelled"
	AgentRunEventProcessStep    = "process.step"
	AgentRunEventProcessStepEnd = "process.step.end"
)

type AgentRunEvent struct {
	ID          int64  `json:"id" gorm:"column:id;primaryKey;autoIncrement"`
	Eid         int64  `json:"eid" gorm:"column:eid;not null;index:idx_agent_run_events_seq,priority:1;index:idx_agent_run_events_request,priority:1"`
	RunID       string `json:"run_id" gorm:"column:run_id;size:64;not null;index:idx_agent_run_events_seq,priority:2,unique"`
	RequestID   string `json:"request_id" gorm:"column:request_id;size:255;default:'';index:idx_agent_run_events_request,priority:2"`
	Seq         int64  `json:"seq" gorm:"column:seq;not null;default:0;index:idx_agent_run_events_seq,priority:3,unique"`
	EventType   string `json:"event_type" gorm:"column:event_type;size:64;not null;index"`
	MessageID   int64  `json:"message_id" gorm:"column:message_id;not null;default:0;index"`
	PayloadJSON string `json:"payload_json" gorm:"column:payload_json;type:text"`
	CreatedAt   int64  `json:"created_at" gorm:"column:created_at;not null;default:0;index"`
	BaseModel
}

func (AgentRunEvent) TableName() string {
	return "agent_run_events"
}

func CreateAgentRunEvent(event *AgentRunEvent) error {
	if event == nil {
		return fmt.Errorf("agent run event is nil")
	}
	if event.CreatedAt == 0 {
		event.CreatedAt = time.Now().UTC().UnixMilli()
	}
	return DB.Create(event).Error
}

func AppendAgentRunEventWithAutoSeq(eid int64, runID string, event *AgentRunEvent) (*AgentRunEvent, error) {
	return AppendAgentRunEventWithAutoSeqTx(DB, eid, runID, event)
}

func AppendAgentRunEventWithAutoSeqTx(db *gorm.DB, eid int64, runID string, event *AgentRunEvent) (*AgentRunEvent, error) {
	if event == nil {
		return nil, fmt.Errorf("agent run event is nil")
	}
	if runID == "" {
		return nil, fmt.Errorf("run_id is required")
	}

	event.Eid = eid
	event.RunID = runID
	if event.CreatedAt == 0 {
		event.CreatedAt = time.Now().UTC().UnixMilli()
	}

	const maxRetries = 8
	for attempt := 0; attempt < maxRetries; attempt++ {
		eventCopy := *event
		err := db.Transaction(func(tx *gorm.DB) error {
			var maxSeq int64
			if err := tx.Model(&AgentRunEvent{}).
				Where("eid = ? AND run_id = ?", eid, runID).
				Select("COALESCE(MAX(seq), 0)").
				Scan(&maxSeq).Error; err != nil {
				return err
			}

			eventCopy.Seq = maxSeq + 1
			return tx.Create(&eventCopy).Error
		})
		if err == nil {
			*event = eventCopy
			return event, nil
		}
		if !isAgentRunEventRetryable(err) {
			return nil, err
		}
		time.Sleep(time.Duration(attempt+1) * time.Millisecond)
	}
	return nil, fmt.Errorf("append agent run event failed after retries: run_id=%s", runID)
}

func GetAgentRunEventsAfterSeq(eid int64, runID string, afterSeq int64, limit int) ([]*AgentRunEvent, error) {
	if limit <= 0 {
		limit = 200
	}
	if limit > 2000 {
		limit = 2000
	}

	var events []*AgentRunEvent
	err := DB.Where("eid = ? AND run_id = ? AND seq > ?", eid, runID, afterSeq).
		Order("seq ASC").
		Limit(limit).
		Find(&events).Error
	if err != nil {
		return nil, err
	}
	return events, nil
}

func isAgentRunEventRetryable(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return true
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "duplicate key") ||
		strings.Contains(msg, "duplicate entry") ||
		strings.Contains(msg, "unique constraint") ||
		strings.Contains(msg, "unique failed") ||
		strings.Contains(msg, "database is locked") ||
		strings.Contains(msg, "database table is locked") ||
		strings.Contains(msg, "deadlock")
}
