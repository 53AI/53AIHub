package actionruntime

import (
	"context"
	"errors"
	"fmt"
	"sync/atomic"
)

var (
	ErrAdapterRequired = errors.New("action runtime adapter is required")
	ErrTaskRequired    = errors.New("action action is required")
)

type Execution struct {
	Action  ActionSpec
	Session RuntimeSession
	Run     ActionRun
	Events  <-chan ActionEvent
}

func (o *Orchestrator) Cancel(ctx context.Context, execution *Execution) error {
	if o == nil || o.adapter == nil {
		return ErrAdapterRequired
	}
	if execution == nil {
		return ErrTaskRequired
	}
	return o.adapter.Cancel(ctx, execution.Session, execution.Run)
}

type Orchestrator struct {
	// normalizer turns raw runtime output into user-readable progress and
	// milestones; nothing else leaves the runtime.
	normalizer       *Normalizer
	adapter          RuntimeAdapter
	artifactPipeline *ArtifactPipeline
	nextID           atomic.Uint64
}

func NewOrchestrator(adapter RuntimeAdapter, pipelines ...*ArtifactPipeline) (*Orchestrator, error) {
	if adapter == nil {
		return nil, ErrAdapterRequired
	}
	var pipeline *ArtifactPipeline
	if len(pipelines) > 0 {
		pipeline = pipelines[0]
	}
	return &Orchestrator{adapter: adapter, artifactPipeline: pipeline, normalizer: NewNormalizer()}, nil
}

// Normalizer exposes the run's normalized output (final message + stage) to the
// Host; raw runtime output never leaves this boundary.
func (o *Orchestrator) Normalizer() *Normalizer { return o.normalizer }

func (o *Orchestrator) Start(ctx context.Context, action ActionSpec, prompt string) (*Execution, error) {
	return o.start(ctx, action, prompt, "")
}

// StartWithRunID is used by a durable Host that allocates its business run ID
// before starting the Runtime. The normal Start path keeps generating IDs for
// standalone callers and tests.
func (o *Orchestrator) StartWithRunID(ctx context.Context, action ActionSpec, prompt, runID string) (*Execution, error) {
	return o.start(ctx, action, prompt, runID)
}

// StartSession creates the one runtime thread owned by an ActionRun. A Host
// may then call StartTurn sequentially while keeping the session alive.
func (o *Orchestrator) StartSession(ctx context.Context, action ActionSpec) (RuntimeSession, error) {
	if o == nil || o.adapter == nil {
		return RuntimeSession{}, ErrAdapterRequired
	}
	if action.ID == "" {
		action.ID = o.nextIDString("action")
	}
	session, err := o.adapter.StartSession(ctx, SessionRequest{Action: action})
	if err != nil {
		return RuntimeSession{}, fmt.Errorf("start action runtime session: %w", err)
	}
	return session, nil
}

// StartTurn starts one reconstructable step on an existing runtime thread.
// The Host supplies the durable run sequence so replay remains contiguous
// across all turns in the ActionRun.
func (o *Orchestrator) StartTurn(ctx context.Context, action ActionSpec, session RuntimeSession, run ActionRun, prompt string) (*Execution, error) {
	if o == nil || o.adapter == nil {
		return nil, ErrAdapterRequired
	}
	if session.ID == "" || session.ExternalID == "" {
		return nil, ErrTaskRequired
	}
	if prompt == "" {
		return nil, ErrTaskRequired
	}
	rawEvents, err := o.adapter.StartRun(ctx, RunRequest{Action: action, Session: session, Run: run, Prompt: prompt})
	if err != nil {
		return nil, fmt.Errorf("start action runtime run: %w", err)
	}
	run.Status = RunStatusRunning
	events := make(chan ActionEvent, 8)
	go normalizeEvents(ctx, events, rawEvents, o.adapter.Name(), action, session, run, o.artifactPipeline, o.normalizer)
	return &Execution{Action: action, Session: session, Run: run, Events: events}, nil
}

func (o *Orchestrator) start(ctx context.Context, action ActionSpec, prompt, runID string) (*Execution, error) {
	if o == nil || o.adapter == nil {
		return nil, ErrAdapterRequired
	}
	if action.ID == "" {
		action.ID = o.nextIDString("action")
	}
	if prompt == "" {
		prompt = action.Prompt
	}
	if prompt == "" {
		return nil, ErrTaskRequired
	}

	session, err := o.StartSession(ctx, action)
	if err != nil {
		return nil, err
	}
	if runID == "" {
		runID = o.nextIDString("run")
	}
	run := ActionRun{
		ID:        runID,
		ActionID:  action.ID,
		SessionID: session.ID,
		Status:    RunStatusQueued,
	}
	return o.StartTurn(ctx, action, session, run, prompt)
}

func (o *Orchestrator) nextIDString(prefix string) string {
	return fmt.Sprintf("%s-%d", prefix, o.nextID.Add(1))
}

func normalizeEvents(ctx context.Context, output chan<- ActionEvent, input <-chan ActionEvent, runtime string, action ActionSpec, session RuntimeSession, run ActionRun, pipeline *ArtifactPipeline, normalizer *Normalizer) {
	defer close(output)
	seq := run.LastSeq
	status := RunStatusRunning
	for {
		select {
		case <-ctx.Done():
			if status == RunStatusRunning {
				event := ActionEvent{ExternalMethod: "host/context"}
				if errors.Is(ctx.Err(), context.DeadlineExceeded) {
					event.Type = EventRunFailed
					event.ErrorCode = string(ErrorCodeRunTimeout)
					event.ErrorMessage = "action run context deadline exceeded"
				} else {
					event.Type = EventRunCancelled
					event.ErrorCode = string(ErrorCodeCancelled)
				}
				seq++
				event.Seq = seq
				event.ID = fmt.Sprintf("%s:%d", run.ID, seq)
				event.Runtime = runtime
				event.SessionID = session.ID
				event.RunID = run.ID
				output <- event
			}
			return
		case event, ok := <-input:
			if !ok {
				return
			}
			events := []ActionEvent{event}
			if pipeline != nil {
				events = pipeline.ProcessEvents(ctx, action, run, event)
			}
			normalized := make([]ActionEvent, 0, len(events))
			for _, event := range events {
				normalized = append(normalized, normalizer.Normalize(event)...)
			}
			for _, event := range normalized {
				event = guardRunStatus(event, &status)
				seq++
				if event.Type == "" {
					event.Type = EventRuntime
				}
				event.Seq = seq
				if event.ID != "" && event.ExternalID == "" {
					event.ExternalID = event.ID
				}
				event.ID = fmt.Sprintf("%s:%d", run.ID, seq)
				if event.Runtime == "" {
					event.Runtime = runtime
				}
				if event.SessionID == "" {
					event.SessionID = session.ID
				}
				if event.RunID == "" {
					event.RunID = run.ID
				}
				select {
				case output <- event:
				case <-ctx.Done():
					return
				}
			}
		}
	}
}

func guardRunStatus(event ActionEvent, current *RunStatus) ActionEvent {
	if current == nil {
		return event
	}
	next, ok := event.RunStatus()
	if !ok || next == *current {
		return event
	}
	if _, err := (ActionRun{Status: *current}).Transition(next); err == nil {
		*current = next
		return event
	}
	event.Type = EventRuntime
	event.ErrorCode = string(ErrorCodeStatusConflict)
	event.ErrorMessage = fmt.Sprintf("ignored invalid run status transition: %s -> %s", *current, next)
	return event
}
