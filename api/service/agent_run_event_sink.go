package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"sync"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
)

const (
	defaultAgentRunEventWriteTimeout  = 3 * time.Second
	defaultAgentRunDeltaCoalesceDelay = 25 * time.Millisecond
	defaultAgentRunEventWriteAttempts = 3
)

var ErrAgentRunEventSinkClosed = errors.New("agent run event sink is closed")

type AgentRunEventSinkConfig struct {
	EID                int64
	RequestID          string
	RunID              string
	WriteTimeout       time.Duration
	DeltaCoalesceDelay time.Duration
	MaxWriteAttempts   int
}

type agentRunEventSinkItem struct {
	eventType string
	messageID int64
	payload   map[string]interface{}
	write     func(context.Context) error
}

type agentRunEventAppendFunc func(context.Context, int64, string, string, string, int64, map[string]interface{}) error
type agentRunIDResolveFunc func(context.Context, int64, string) (string, error)

// AgentRunEventSink serializes AgentRun event persistence away from the relay
// streaming path. A sink is scoped to one request/run and owns one worker, so
// events keep enqueue order without querying the run for every event.
type AgentRunEventSink struct {
	config  AgentRunEventSinkConfig
	append  agentRunEventAppendFunc
	resolve agentRunIDResolveFunc

	mu     sync.Mutex
	cond   *sync.Cond
	queue  []agentRunEventSinkItem
	closed bool
	errors []error
	done   chan struct{}

	drainStarted bool
	drainDone    chan struct{}
	drainErr     error

	runResolveOnce sync.Once
	resolvedRunID  string
	runResolveErr  error
	startedAt      time.Time
	enqueued       int64
	persisted      int64
	coalesced      int64
	persistMillis  int64
	maxQueueDepth  int
	statsReported  bool
}

type AgentRunEventSinkStats struct {
	Enqueued      int64
	Persisted     int64
	Coalesced     int64
	Failed        int
	MaxQueueDepth int
	PersistMillis int64
	ElapsedMillis int64
}

func NewAgentRunEventSink(config AgentRunEventSinkConfig) *AgentRunEventSink {
	runSvc := NewAgentRunService()
	return newAgentRunEventSinkForTest(
		config,
		func(ctx context.Context, eid int64, runID, requestID, eventType string, messageID int64, payload map[string]interface{}) error {
			_, err := runSvc.AppendEvent(ctx, eid, runID, requestID, eventType, messageID, payload)
			return err
		},
		func(ctx context.Context, eid int64, requestID string) (string, error) {
			run, err := runSvc.GetRunByRequestID(ctx, eid, requestID)
			if err != nil {
				return "", err
			}
			return run.RunID, nil
		},
	)
}

func newAgentRunEventSinkForTest(config AgentRunEventSinkConfig, appendFn agentRunEventAppendFunc, resolveFn agentRunIDResolveFunc) *AgentRunEventSink {
	if config.WriteTimeout <= 0 {
		config.WriteTimeout = defaultAgentRunEventWriteTimeout
	}
	if config.DeltaCoalesceDelay <= 0 {
		config.DeltaCoalesceDelay = defaultAgentRunDeltaCoalesceDelay
	}
	if config.MaxWriteAttempts <= 0 {
		config.MaxWriteAttempts = defaultAgentRunEventWriteAttempts
	}
	sink := &AgentRunEventSink{
		config:        config,
		append:        appendFn,
		resolve:       resolveFn,
		resolvedRunID: config.RunID,
		done:          make(chan struct{}),
		drainDone:     make(chan struct{}),
		startedAt:     time.Now(),
	}
	sink.cond = sync.NewCond(&sink.mu)
	go sink.run()
	return sink
}

// Enqueue snapshots the payload and signals the run worker. It does
// not perform SQL and therefore does not add database RTT to SSE delivery.
func (s *AgentRunEventSink) Enqueue(eventType string, messageID int64, payload map[string]interface{}) error {
	if s == nil {
		return nil
	}
	clonedPayload, err := cloneAgentRunEventPayload(payload)
	if err != nil {
		return fmt.Errorf("clone agent run event payload: %w", err)
	}
	item := agentRunEventSinkItem{
		eventType: eventType,
		messageID: messageID,
		payload:   clonedPayload,
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return ErrAgentRunEventSinkClosed
	}
	s.enqueued++
	if s.coalesceQueueTailLocked(item) {
		return nil
	}
	s.queue = append(s.queue, item)
	if len(s.queue) > s.maxQueueDepth {
		s.maxQueueDepth = len(s.queue)
	}
	s.cond.Signal()
	return nil
}

// coalesceQueueTailLocked bounds queue growth while persistence is slower than
// the upstream token stream. Only adjacent compatible events are merged, so a
// tool/process event or a different delta type remains an ordering barrier.
func (s *AgentRunEventSink) coalesceQueueTailLocked(item agentRunEventSinkItem) bool {
	if !isCoalescibleAgentRunEvent(item) || len(s.queue) == 0 {
		return false
	}
	lastIndex := len(s.queue) - 1
	last := s.queue[lastIndex]
	if last.eventType != item.eventType || last.messageID != item.messageID {
		return false
	}
	merged, ok := mergeAgentRunEventPayload(item.eventType, last.payload, item.payload)
	if !ok {
		return false
	}
	s.queue[lastIndex].payload = merged
	s.coalesced++
	return true
}

// EnqueueWrite schedules a compatibility projection write (for example,
// MessageProcessStep) on the same request worker. It keeps legacy projections
// durable without moving their SQL back onto the SSE path.
func (s *AgentRunEventSink) EnqueueWrite(name string, write func(context.Context) error) error {
	if s == nil || write == nil {
		return nil
	}
	item := agentRunEventSinkItem{eventType: name, write: write}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return ErrAgentRunEventSinkClosed
	}
	s.queue = append(s.queue, item)
	s.enqueued++
	if len(s.queue) > s.maxQueueDepth {
		s.maxQueueDepth = len(s.queue)
	}
	s.cond.Signal()
	return nil
}

// CloseAndDrain rejects new events and waits until all already queued events
// have either been persisted or reported as errors. While the worker is still
// active, repeated calls reuse the first wait result instead of starting a new
// full timeout window. Once the worker finishes, callers receive its final
// persistence result.
func (s *AgentRunEventSink) CloseAndDrain(ctx context.Context) error {
	if s == nil {
		return nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	s.mu.Lock()
	if !s.closed {
		s.closed = true
		s.cond.Broadcast()
	}
	isFirstWaiter := !s.drainStarted
	if isFirstWaiter {
		s.drainStarted = true
	}
	drainDone := s.drainDone
	s.mu.Unlock()

	if !isFirstWaiter {
		select {
		case <-s.done:
			s.mu.Lock()
			err := errors.Join(s.errors...)
			s.mu.Unlock()
			return err
		default:
		}
		select {
		case <-drainDone:
			s.mu.Lock()
			err := s.drainErr
			s.mu.Unlock()
			return err
		case <-ctx.Done():
			return ctx.Err()
		}
	}

	var drainErr error
	select {
	case <-s.done:
		s.mu.Lock()
		drainErr = errors.Join(s.errors...)
		s.mu.Unlock()
	case <-ctx.Done():
		drainErr = ctx.Err()
	}

	s.mu.Lock()
	s.drainErr = drainErr
	close(s.drainDone)
	s.mu.Unlock()
	return drainErr
}

func (s *AgentRunEventSink) ErrorCount() int {
	if s == nil {
		return 0
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.errors)
}

func (s *AgentRunEventSink) Stats() AgentRunEventSinkStats {
	if s == nil {
		return AgentRunEventSinkStats{}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return AgentRunEventSinkStats{
		Enqueued: s.enqueued, Persisted: s.persisted, Coalesced: s.coalesced,
		Failed: len(s.errors), MaxQueueDepth: s.maxQueueDepth, PersistMillis: s.persistMillis,
		ElapsedMillis: time.Since(s.startedAt).Milliseconds(),
	}
}

func (s *AgentRunEventSink) StatsForReport() (AgentRunEventSinkStats, bool) {
	if s == nil {
		return AgentRunEventSinkStats{}, false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.statsReported {
		return AgentRunEventSinkStats{}, false
	}
	s.statsReported = true
	return AgentRunEventSinkStats{
		Enqueued: s.enqueued, Persisted: s.persisted, Coalesced: s.coalesced,
		Failed: len(s.errors), MaxQueueDepth: s.maxQueueDepth, PersistMillis: s.persistMillis,
		ElapsedMillis: time.Since(s.startedAt).Milliseconds(),
	}, true
}

func (s *AgentRunEventSink) run() {
	defer close(s.done)
	for {
		item, ok := s.nextItem()
		if !ok {
			return
		}
		if isCoalescibleAgentRunEvent(item) && s.config.DeltaCoalesceDelay > 0 {
			time.Sleep(s.config.DeltaCoalesceDelay)
			item = s.coalesceQueuedEvents(item)
		}
		persistStartedAt := time.Now()
		err := s.persist(item)
		persistElapsed := time.Since(persistStartedAt).Milliseconds()
		s.mu.Lock()
		s.persistMillis += persistElapsed
		if err == nil {
			s.persisted++
		}
		s.mu.Unlock()
		if err != nil {
			s.mu.Lock()
			s.errors = append(s.errors, err)
			s.mu.Unlock()
			logger.Warnf(context.Background(),
				"【技能运行】AgentRun事件异步落库失败: eid=%d, request_id=%s, event_type=%s, message_id=%d, err=%v",
				s.config.EID, s.config.RequestID, item.eventType, item.messageID, err)
		}
	}
}

func (s *AgentRunEventSink) nextItem() (agentRunEventSinkItem, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for len(s.queue) == 0 && !s.closed {
		s.cond.Wait()
	}
	if len(s.queue) == 0 {
		return agentRunEventSinkItem{}, false
	}
	item := s.queue[0]
	s.queue[0] = agentRunEventSinkItem{}
	s.queue = s.queue[1:]
	return item, true
}

func (s *AgentRunEventSink) coalesceQueuedEvents(item agentRunEventSinkItem) agentRunEventSinkItem {
	s.mu.Lock()
	defer s.mu.Unlock()
	for len(s.queue) > 0 {
		next := s.queue[0]
		if next.eventType != item.eventType || next.messageID != item.messageID {
			break
		}
		merged, ok := mergeAgentRunEventPayload(item.eventType, item.payload, next.payload)
		if !ok {
			break
		}
		item.payload = merged
		s.coalesced++
		s.queue[0] = agentRunEventSinkItem{}
		s.queue = s.queue[1:]
	}
	return item
}

func isCoalescibleAgentRunEvent(item agentRunEventSinkItem) bool {
	if item.write != nil {
		return false
	}
	switch item.eventType {
	case model.AgentRunEventMessageDelta:
		return true
	case model.AgentRunEventProcessStep:
		_, _, _, ok := agentRunLLMDeltaProcessStepData(item.payload)
		return ok
	default:
		return false
	}
}

func mergeAgentRunEventPayload(eventType string, first, second map[string]interface{}) (map[string]interface{}, bool) {
	switch eventType {
	case model.AgentRunEventMessageDelta:
		return mergeAgentRunDeltaPayload(first, second)
	case model.AgentRunEventProcessStep:
		return mergeAgentRunLLMDeltaProcessStepPayload(first, second)
	default:
		return nil, false
	}
}

func mergeAgentRunLLMDeltaProcessStepPayload(first, second map[string]interface{}) (map[string]interface{}, bool) {
	firstStep, firstData, firstType, firstOK := agentRunLLMDeltaProcessStepData(first)
	secondStep, secondData, secondType, secondOK := agentRunLLMDeltaProcessStepData(second)
	if !firstOK || !secondOK || firstType != secondType {
		return nil, false
	}
	if !agentRunEventMapsEqualExcept(firstStep, secondStep, "data") ||
		!agentRunEventMapsEqualExcept(firstData, secondData, "content") {
		return nil, false
	}
	firstContent, firstContentOK := firstData["content"].(string)
	secondContent, secondContentOK := secondData["content"].(string)
	if !firstContentOK || !secondContentOK || secondContent == "" {
		return nil, false
	}
	firstData["content"] = firstContent + secondContent
	return first, true
}

func agentRunLLMDeltaProcessStepData(payload map[string]interface{}) (map[string]interface{}, map[string]interface{}, string, bool) {
	processStep, ok := payload["process_step"].(map[string]interface{})
	if !ok || processStep["step_code"] != "llm_delta" {
		return nil, nil, "", false
	}
	data, ok := processStep["data"].(map[string]interface{})
	if !ok {
		return nil, nil, "", false
	}
	deltaType, ok := data["type"].(string)
	if !ok || deltaType == "" {
		return nil, nil, "", false
	}
	return processStep, data, deltaType, true
}

func agentRunEventMapsEqualExcept(first, second map[string]interface{}, excludedKey string) bool {
	if len(first) != len(second) {
		return false
	}
	for key, firstValue := range first {
		if key == excludedKey {
			continue
		}
		secondValue, ok := second[key]
		if !ok || !reflect.DeepEqual(firstValue, secondValue) {
			return false
		}
	}
	return true
}

func (s *AgentRunEventSink) persist(item agentRunEventSinkItem) error {
	if item.write != nil {
		return s.persistWrite(item)
	}
	runID, err := s.runID()
	if err != nil {
		return fmt.Errorf("resolve agent run id: %w", err)
	}
	if runID == "" {
		return fmt.Errorf("resolve agent run id: empty run id")
	}
	if s.append == nil {
		return fmt.Errorf("agent run event appender is nil")
	}

	var lastErr error
	for attempt := 1; attempt <= s.config.MaxWriteAttempts; attempt++ {
		writeCtx, cancel := context.WithTimeout(context.Background(), s.config.WriteTimeout)
		lastErr = s.append(writeCtx, s.config.EID, runID, s.config.RequestID, item.eventType, item.messageID, item.payload)
		cancel()
		if lastErr == nil {
			return nil
		}
		if attempt < s.config.MaxWriteAttempts {
			time.Sleep(time.Duration(attempt) * 10 * time.Millisecond)
		}
	}
	return fmt.Errorf("persist agent run event after %d attempts: %w", s.config.MaxWriteAttempts, lastErr)
}

func (s *AgentRunEventSink) persistWrite(item agentRunEventSinkItem) error {
	var lastErr error
	for attempt := 1; attempt <= s.config.MaxWriteAttempts; attempt++ {
		writeCtx, cancel := context.WithTimeout(context.Background(), s.config.WriteTimeout)
		lastErr = item.write(writeCtx)
		cancel()
		if lastErr == nil {
			return nil
		}
		if attempt < s.config.MaxWriteAttempts {
			time.Sleep(time.Duration(attempt) * 10 * time.Millisecond)
		}
	}
	return fmt.Errorf("persist async projection %s after %d attempts: %w", item.eventType, s.config.MaxWriteAttempts, lastErr)
}

func (s *AgentRunEventSink) runID() (string, error) {
	if s.resolvedRunID != "" {
		return s.resolvedRunID, nil
	}
	s.runResolveOnce.Do(func() {
		if s.resolve == nil {
			s.runResolveErr = fmt.Errorf("agent run id resolver is nil")
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), s.config.WriteTimeout)
		defer cancel()
		s.resolvedRunID, s.runResolveErr = s.resolve(ctx, s.config.EID, s.config.RequestID)
	})
	return s.resolvedRunID, s.runResolveErr
}

func cloneAgentRunEventPayload(payload map[string]interface{}) (map[string]interface{}, error) {
	if payload == nil {
		return nil, nil
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	var cloned map[string]interface{}
	if err := json.Unmarshal(encoded, &cloned); err != nil {
		return nil, err
	}
	return cloned, nil
}

func mergeAgentRunDeltaPayload(first, second map[string]interface{}) (map[string]interface{}, bool) {
	firstJSON, err := json.Marshal(first)
	if err != nil {
		return nil, false
	}
	secondJSON, err := json.Marshal(second)
	if err != nil {
		return nil, false
	}
	var firstNormalized map[string]interface{}
	var secondNormalized map[string]interface{}
	if err := json.Unmarshal(firstJSON, &firstNormalized); err != nil {
		return nil, false
	}
	if err := json.Unmarshal(secondJSON, &secondNormalized); err != nil {
		return nil, false
	}
	firstDelta, ok := firstAgentRunDelta(firstNormalized)
	if !ok {
		return nil, false
	}
	secondDelta, ok := firstAgentRunDelta(secondNormalized)
	if !ok {
		return nil, false
	}
	mergedAny := false
	for _, key := range []string{"content", "reasoning_content"} {
		secondText, secondExists := secondDelta[key].(string)
		if !secondExists || secondText == "" {
			continue
		}
		firstText, _ := firstDelta[key].(string)
		firstDelta[key] = firstText + secondText
		mergedAny = true
	}
	if !mergedAny {
		return nil, false
	}
	return firstNormalized, true
}

func firstAgentRunDelta(payload map[string]interface{}) (map[string]interface{}, bool) {
	choices, ok := payload["choices"].([]interface{})
	if !ok || len(choices) == 0 {
		return nil, false
	}
	choice, ok := choices[0].(map[string]interface{})
	if !ok {
		return nil, false
	}
	delta, ok := choice["delta"].(map[string]interface{})
	return delta, ok
}
