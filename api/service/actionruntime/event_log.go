package actionruntime

import (
	"context"
	"errors"
	"fmt"
	"sync"
)

var (
	ErrEventRequired = errors.New("action event is required")
	ErrEventSequence = errors.New("action event sequence is invalid")
	ErrEventConflict = errors.New("action event duplicate conflicts")
)

type EventLog struct {
	mu     sync.RWMutex
	events map[string][]ActionEvent
	byID   map[string]ActionEvent
}

func NewEventLog() *EventLog {
	return &EventLog{events: make(map[string][]ActionEvent), byID: make(map[string]ActionEvent)}
}

func (l *EventLog) Append(ctx context.Context, event ActionEvent) error {
	if l == nil {
		return ErrEventRequired
	}
	if err := contextError(ctx); err != nil {
		return err
	}
	if event.RunID == "" || event.ID == "" || event.Seq <= 0 {
		return ErrEventRequired
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if existing, ok := l.byID[event.ID]; ok {
		if existing.RunID == event.RunID && existing.Seq == event.Seq && existing.Type == event.Type {
			return nil
		}
		return fmt.Errorf("%w: %s", ErrEventConflict, event.ID)
	}
	runEvents := l.events[event.RunID]
	wantSeq := int64(len(runEvents) + 1)
	if event.Seq != wantSeq {
		return fmt.Errorf("%w: got %d, want %d", ErrEventSequence, event.Seq, wantSeq)
	}
	l.events[event.RunID] = append(runEvents, event)
	l.byID[event.ID] = event
	return nil
}

func (l *EventLog) Replay(ctx context.Context, runID string, afterSeq, limit int64) ([]ActionEvent, error) {
	if l == nil || runID == "" {
		return nil, ErrEventRequired
	}
	if err := contextError(ctx); err != nil {
		return nil, err
	}
	l.mu.RLock()
	defer l.mu.RUnlock()
	runEvents := l.events[runID]
	if limit <= 0 {
		limit = 200
	}
	result := make([]ActionEvent, 0, minInt64(limit, int64(len(runEvents))))
	for _, event := range runEvents {
		if event.Seq <= afterSeq {
			continue
		}
		result = append(result, event)
		if int64(len(result)) == limit {
			break
		}
	}
	return result, nil
}

func (l *EventLog) LastSeq(runID string) int64 {
	if l == nil {
		return 0
	}
	l.mu.RLock()
	defer l.mu.RUnlock()
	runEvents := l.events[runID]
	if len(runEvents) == 0 {
		return 0
	}
	return runEvents[len(runEvents)-1].Seq
}

func minInt64(left, right int64) int {
	if left < right {
		return int(left)
	}
	return int(right)
}
