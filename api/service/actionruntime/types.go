// Package actionruntime defines the host-owned contract shared by Action
// runtimes. It deliberately has no database or HTTP dependency.
package actionruntime

import (
	"context"
	"fmt"
)

type SessionStatus string

const (
	SessionStatusStarting SessionStatus = "starting"
	SessionStatusReady    SessionStatus = "ready"
	SessionStatusClosed   SessionStatus = "closed"
)

type RunStatus string

const (
	RunStatusQueued      RunStatus = "queued"
	RunStatusRunning     RunStatus = "running"
	RunStatusCompleted   RunStatus = "completed"
	RunStatusFailed      RunStatus = "failed"
	RunStatusCancelled   RunStatus = "cancelled"
)

var ErrInvalidRunTransition = fmt.Errorf("invalid action run status transition")

type EventType string

const (
	EventSessionStarted   EventType = "session.started"
	EventRunStarted       EventType = "run.started"
	EventProgress         EventType = "progress"
	EventProgressUpdated  EventType = "progress.updated"
	EventToolStarted      EventType = "tool.started"
	EventToolCompleted    EventType = "tool.completed"
	EventRuntimeStarted   EventType = "runtime.started"
	EventTurnStarted      EventType = "turn.started"
	EventTurnCompleted    EventType = "turn.completed"
	EventTurnFailed       EventType = "turn.failed"
	EventOperationStarted EventType = "operation.started"
	EventOperationDone    EventType = "operation.completed"
	EventArtifact         EventType = "artifact.created"
	EventRunCompleted     EventType = "run.completed"
	EventRunFailed        EventType = "run.failed"
	EventRunCancelled     EventType = "run.cancelled"
	EventRuntime          EventType = "runtime.event"
)

type Capability string

const (
	CapabilityStreaming Capability = "streaming"
	CapabilityCancel    Capability = "cancel"
	CapabilityResume    Capability = "resume"
	CapabilityArtifact  Capability = "artifact"
)

type ActionSpec struct {
	ID                string   `json:"id"`
	Name              string   `json:"name,omitempty"`
	Prompt            string   `json:"prompt,omitempty"`
	WorkDir           string   `json:"work_dir,omitempty"`
	Sandbox           string   `json:"sandbox,omitempty"`
	ApprovalPolicy    string   `json:"approval_policy,omitempty"`
	Ephemeral         bool     `json:"ephemeral,omitempty"`
	ExpectedArtifacts []string `json:"expected_artifacts,omitempty"`
}

type RuntimeSession struct {
	ID         string        `json:"id"`
	Runtime    string        `json:"runtime"`
	ExternalID string        `json:"external_id"`
	Status     SessionStatus `json:"status"`
}

type ActionRun struct {
	ID           string    `json:"id"`
	ActionID     string    `json:"action_id"`
	SessionID    string    `json:"session_id"`
	Status       RunStatus `json:"status"`
	LastSeq      int64     `json:"last_seq,omitempty"`
	ErrorCode    string    `json:"error_code,omitempty"`
	ErrorMessage string    `json:"error_message,omitempty"`
}

type ActionArtifact struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Path     string `json:"-"`
	MimeType string `json:"mime_type"`
	Size     int64  `json:"size"`
}

type ActionEvent struct {
	ID             string          `json:"id,omitempty"`
	Seq            int64           `json:"seq"`
	Type           EventType       `json:"type"`
	Runtime        string          `json:"runtime"`
	SessionID      string          `json:"session_id"`
	RunID          string          `json:"run_id"`
	ExternalID     string          `json:"external_id,omitempty"`
	ExternalMethod string          `json:"external_method,omitempty"`
	TurnID         string          `json:"turn_id,omitempty"`
	Delta          string          `json:"delta,omitempty"`
	Payload        map[string]any  `json:"payload,omitempty"`
	Artifact       *ActionArtifact `json:"artifact,omitempty"`
	Preview        *ActionArtifact `json:"preview,omitempty"`
	ErrorCode      string          `json:"error_code,omitempty"`
	ErrorMessage   string          `json:"error_message,omitempty"`
	// PreviewStatus / PreviewErrorCode 是 Host 预览能力的持久化结论：
	// available / unavailable / failed + 安全 error code。它与 Artifact 同生命周期，
	// 不因为预览失败影响原始交付物。
	PreviewStatus    string `json:"preview_status,omitempty"`
	PreviewErrorCode string `json:"preview_error_code,omitempty"`
	// Diagnostic is server-side only (never persisted, never sent to clients).
	Diagnostic string `json:"-"`
}

func (e ActionEvent) RunStatus() (RunStatus, bool) {
	switch e.Type {
	case EventRunStarted:
		return RunStatusRunning, true
	case EventRunCompleted:
		return RunStatusCompleted, true
	case EventRunFailed:
		return RunStatusFailed, true
	case EventRunCancelled:
		return RunStatusCancelled, true
	default:
		return "", false
	}
}

type SessionRequest struct {
	Action ActionSpec
}

type RunRequest struct {
	Action  ActionSpec
	Session RuntimeSession
	Run     ActionRun
	Prompt  string
}

type RuntimeAdapter interface {
	Name() string
	Capabilities() []Capability
	StartSession(context.Context, SessionRequest) (RuntimeSession, error)
	StartRun(context.Context, RunRequest) (<-chan ActionEvent, error)
	Cancel(context.Context, RuntimeSession, ActionRun) error
}

func (s RuntimeSession) Transition(next SessionStatus) (RuntimeSession, error) {
	if s.Status == next {
		return s, nil
	}
	valid := s.Status == SessionStatusStarting && (next == SessionStatusReady || next == SessionStatusClosed)
	if s.Status == SessionStatusReady {
		valid = next == SessionStatusClosed
	}
	if !valid {
		return s, fmt.Errorf("invalid action runtime session transition: %s -> %s", s.Status, next)
	}
	s.Status = next
	return s, nil
}

func (r ActionRun) Transition(next RunStatus) (ActionRun, error) {
	if r.Status == next {
		return r, nil
	}
	valid := false
	switch r.Status {
	case RunStatusQueued:
		valid = next == RunStatusRunning || next == RunStatusCancelled || next == RunStatusFailed
	case RunStatusRunning:
		valid = next == RunStatusCompleted || next == RunStatusFailed || next == RunStatusCancelled
	}
	if !valid {
		return r, fmt.Errorf("%w: %s -> %s", ErrInvalidRunTransition, r.Status, next)
	}
	r.Status = next
	return r, nil
}
