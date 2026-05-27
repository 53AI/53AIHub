package sandboxruntime

import (
	"context"
	"io"
)

type Scope string

const (
	ScopeSingleSkillRun  Scope = "single_skill_run"
	ScopeInteractiveChat Scope = "interactive_chat"
	ScopeLongAgentRun    Scope = "long_agent_run"
)

type Mounts struct {
	WorkspaceRoot string
	SkillRoot     string
	InputRoot     string
	ArtifactRoot  string
}

type SessionSpec struct {
	Eid        int64
	UserID     int64
	MessageID  int64
	AgentRunID string
	Scope      Scope
	TemplateID string
	Metadata   map[string]string
}

type Session struct {
	ID         string
	Provider   string
	ProviderID string
	Mounts     Mounts
	State      string
}

type FileObject struct {
	Path        string
	Data        []byte
	ContentType string
	Size        int64
}

type CommandRequest struct {
	Command        string
	Cwd            string
	Env            map[string]string
	TimeoutSeconds int
}

type CommandResult struct {
	Stdout   string
	Stderr   string
	ExitCode int
}

type StreamEvent struct {
	Type    string
	Content string
	Data    map[string]interface{}
}

type Artifact struct {
	Path        string
	FileName    string
	ContentType string
	Size        int64
	Checksum    string
}

type Runtime interface {
	Acquire(ctx context.Context, spec SessionSpec) (*Session, error)
	WriteFiles(ctx context.Context, session *Session, files []FileObject) error
	ReadFile(ctx context.Context, session *Session, path string, maxBytes int64) ([]byte, error)
	ListFiles(ctx context.Context, session *Session, root string, recursive bool, limit int) ([]Artifact, error)
	RunCommand(ctx context.Context, session *Session, req CommandRequest, stream func(StreamEvent)) (*CommandResult, error)
	ExportArtifact(ctx context.Context, session *Session, artifact Artifact) (io.ReadCloser, error)
	Pause(ctx context.Context, session *Session) error
	Kill(ctx context.Context, session *Session) error
}
