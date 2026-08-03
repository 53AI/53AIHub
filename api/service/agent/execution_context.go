package agent

import (
	"errors"
	"sort"
	"sync"
	"time"
)

var (
	ErrTurnBudgetExceeded = errors.New("agent turn budget exceeded")
	ErrDeadlineExceeded   = errors.New("agent execution deadline exceeded")
)

type Stage string

const (
	StageRouting   Stage = "routing"
	StageRetrieval Stage = "retrieval"
	StageLLM       Stage = "llm"
	StageTool      Stage = "tool"
	StagePersist   Stage = "persist"
	StageFinalize  Stage = "finalize"
)

type Status string

const (
	StatusCompleted Status = "completed"
	StatusFailed    Status = "failed"
	StatusCancelled Status = "cancelled"
)

type Config struct {
	RequestID          string
	EID                int64
	AgentID            int64
	UserID             int64
	ConversationID     int64
	MessageID          int64
	RunID              string
	Model              string
	ChannelID          int64
	SkillName          string
	SkillRoot          string
	RunnableSkillPaths []string
	MaxTurns           int
	Deadline           time.Time
	StartedAt          time.Time
	Now                func() time.Time
}

type Identity struct {
	RequestID      string
	EID            int64
	AgentID        int64
	UserID         int64
	ConversationID int64
	MessageID      int64
	RunID          string
	Model          string
	ChannelID      int64
}

type Scope struct {
	SkillName          string
	SkillRoot          string
	RunnableSkillPaths []string
}

type Budget struct {
	MaxTurns  int
	TurnsUsed int
	Deadline  time.Time
}

type Usage struct {
	PromptTokens     int
	CompletionTokens int
	TotalTokens      int
}

type TurnInput struct {
	SkillName    string
	Model        string
	Phase        string
	MessageCount int
	ToolCount    int
}

type TurnRecord struct {
	Number       int
	SkillName    string
	Model        string
	Phase        string
	MessageCount int
	ToolCount    int
	StartedAt    time.Time
}

type TimingRecord struct {
	Stage          Stage
	Status         Status
	StartedAt      time.Time
	DurationMillis int64
	Error          string
	Attributes     map[string]string
}

type StageAggregate struct {
	Count       int
	FailedCount int
	TotalMillis int64
	MaxMillis   int64
}

type Snapshot struct {
	Identity      Identity
	Scope         Scope
	Budget        Budget
	Usage         Usage
	Turns         []TurnRecord
	Timings       []TimingRecord
	StageSummary  map[Stage]StageAggregate
	StartedAt     time.Time
	ElapsedMillis int64
}

type ExecutionContext struct {
	mu sync.RWMutex

	now           func() time.Time
	startedAt     time.Time
	identity      Identity
	scope         Scope
	budget        Budget
	usage         Usage
	turns         []TurnRecord
	timings       []TimingRecord
	stageSummary  map[Stage]StageAggregate
	runnablePaths map[string]struct{}
	filterSkills  bool
}

func NewExecutionContext(config Config) *ExecutionContext {
	now := config.Now
	if now == nil {
		now = time.Now
	}
	paths := append([]string(nil), config.RunnableSkillPaths...)
	sort.Strings(paths)
	runnable := make(map[string]struct{}, len(paths))
	for _, path := range paths {
		runnable[path] = struct{}{}
	}
	startedAt := config.StartedAt
	if startedAt.IsZero() {
		startedAt = now()
	}
	return &ExecutionContext{
		now:       now,
		startedAt: startedAt,
		identity: Identity{
			RequestID: config.RequestID, EID: config.EID, AgentID: config.AgentID,
			UserID: config.UserID, ConversationID: config.ConversationID,
			MessageID: config.MessageID, RunID: config.RunID, Model: config.Model,
			ChannelID: config.ChannelID,
		},
		scope:         Scope{SkillName: config.SkillName, SkillRoot: config.SkillRoot, RunnableSkillPaths: paths},
		budget:        Budget{MaxTurns: config.MaxTurns, Deadline: config.Deadline},
		stageSummary:  make(map[Stage]StageAggregate),
		runnablePaths: runnable,
		filterSkills:  config.RunnableSkillPaths != nil,
	}
}

func (c *ExecutionContext) BeginTurn(input TurnInput) (TurnRecord, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := c.now()
	if !c.budget.Deadline.IsZero() && !now.Before(c.budget.Deadline) {
		return TurnRecord{}, ErrDeadlineExceeded
	}
	if c.budget.MaxTurns > 0 && len(c.turns) >= c.budget.MaxTurns {
		return TurnRecord{}, ErrTurnBudgetExceeded
	}
	record := TurnRecord{
		Number: len(c.turns) + 1, SkillName: input.SkillName, Model: input.Model,
		Phase: input.Phase, MessageCount: input.MessageCount, ToolCount: input.ToolCount,
		StartedAt: now,
	}
	c.turns = append(c.turns, record)
	c.budget.TurnsUsed = len(c.turns)
	return record, nil
}

type StageSpan struct {
	owner      *ExecutionContext
	stage      Stage
	startedAt  time.Time
	attributes map[string]string
	once       sync.Once
}

func (c *ExecutionContext) BeginStage(stage Stage, attributes map[string]string) *StageSpan {
	if c == nil {
		return &StageSpan{}
	}
	cloned := make(map[string]string, len(attributes))
	for key, value := range attributes {
		cloned[key] = value
	}
	return &StageSpan{owner: c, stage: stage, startedAt: c.now(), attributes: cloned}
}

func (s *StageSpan) End(status Status, err error) {
	if s == nil || s.owner == nil {
		return
	}
	s.once.Do(func() {
		endedAt := s.owner.now()
		duration := endedAt.Sub(s.startedAt).Milliseconds()
		if duration < 0 {
			duration = 0
		}
		record := TimingRecord{Stage: s.stage, Status: status, StartedAt: s.startedAt, DurationMillis: duration, Attributes: s.attributes}
		if err != nil {
			record.Error = err.Error()
		}
		s.owner.mu.Lock()
		s.owner.timings = append(s.owner.timings, record)
		aggregate := s.owner.stageSummary[s.stage]
		aggregate.Count++
		aggregate.TotalMillis += duration
		if duration > aggregate.MaxMillis {
			aggregate.MaxMillis = duration
		}
		if status == StatusFailed {
			aggregate.FailedCount++
		}
		s.owner.stageSummary[s.stage] = aggregate
		s.owner.mu.Unlock()
	})
}

func (c *ExecutionContext) AddUsage(usage Usage) {
	if c == nil {
		return
	}
	c.mu.Lock()
	c.usage.PromptTokens += usage.PromptTokens
	c.usage.CompletionTokens += usage.CompletionTokens
	c.usage.TotalTokens += usage.TotalTokens
	c.mu.Unlock()
}

func (c *ExecutionContext) UpdateMessageID(messageID int64) {
	if c == nil || messageID <= 0 {
		return
	}
	c.mu.Lock()
	c.identity.MessageID = messageID
	c.mu.Unlock()
}

func (c *ExecutionContext) UpdateSkill(name, root string) {
	if c == nil {
		return
	}
	c.mu.Lock()
	c.scope.SkillName = name
	c.scope.SkillRoot = root
	c.mu.Unlock()
}

func (c *ExecutionContext) UpdateRuntimeIdentity(conversationID, messageID int64, runID, model string, channelID int64) {
	if c == nil {
		return
	}
	c.mu.Lock()
	if conversationID > 0 {
		c.identity.ConversationID = conversationID
	}
	if messageID > 0 {
		c.identity.MessageID = messageID
	}
	if runID != "" {
		c.identity.RunID = runID
	}
	if model != "" {
		c.identity.Model = model
	}
	if channelID > 0 {
		c.identity.ChannelID = channelID
	}
	c.mu.Unlock()
}

func (c *ExecutionContext) UpdateRunnableSkillPaths(paths []string) {
	if c == nil {
		return
	}
	cloned := append([]string(nil), paths...)
	sort.Strings(cloned)
	runnable := make(map[string]struct{}, len(cloned))
	for _, path := range cloned {
		runnable[path] = struct{}{}
	}
	c.mu.Lock()
	c.scope.RunnableSkillPaths = cloned
	c.runnablePaths = runnable
	c.filterSkills = paths != nil
	c.mu.Unlock()
}

func (c *ExecutionContext) IsSkillRunnable(path string) bool {
	if c == nil {
		return false
	}
	c.mu.RLock()
	defer c.mu.RUnlock()
	if !c.filterSkills {
		return true
	}
	_, ok := c.runnablePaths[path]
	return ok
}

func (c *ExecutionContext) Snapshot() Snapshot {
	if c == nil {
		return Snapshot{}
	}
	c.mu.RLock()
	defer c.mu.RUnlock()
	snapshot := Snapshot{
		Identity: c.identity, Scope: c.scope, Budget: c.budget, Usage: c.usage,
		Turns: append([]TurnRecord(nil), c.turns...), Timings: append([]TimingRecord(nil), c.timings...),
		StageSummary: make(map[Stage]StageAggregate, len(c.stageSummary)), StartedAt: c.startedAt,
		ElapsedMillis: c.now().Sub(c.startedAt).Milliseconds(),
	}
	snapshot.Scope.RunnableSkillPaths = append([]string(nil), c.scope.RunnableSkillPaths...)
	for stage, aggregate := range c.stageSummary {
		snapshot.StageSummary[stage] = aggregate
	}
	for i := range snapshot.Timings {
		attributes := make(map[string]string, len(snapshot.Timings[i].Attributes))
		for key, value := range snapshot.Timings[i].Attributes {
			attributes[key] = value
		}
		snapshot.Timings[i].Attributes = attributes
	}
	return snapshot
}
