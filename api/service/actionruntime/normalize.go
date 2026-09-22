package actionruntime

import (
	"fmt"
	"strings"
	"time"
)

// ProgressKind is the complete user-visible vocabulary of "Codex 正在做什么".
// The runtime deliberately keeps it small and stable: the client shows a stage,
// never raw runtime output.
type ProgressKind string

const (
	ProgressReadingContext ProgressKind = "reading_context"
	ProgressSearching      ProgressKind = "searching"
	ProgressAnalyzing      ProgressKind = "analyzing"
	ProgressWriting        ProgressKind = "writing"
)

func (k ProgressKind) Label() string {
	switch k {
	case ProgressReadingContext:
		return "正在查阅会议资料"
	case ProgressSearching:
		return "正在检索公开资料"
	case ProgressAnalyzing:
		return "正在整理分析结果"
	case ProgressWriting:
		return "正在生成成果"
	default:
		return "正在执行"
	}
}

// Normalizer converts raw Codex runtime events into the two things the Host is
// allowed to keep or show:
//
//  1. user-readable progress (progress.updated) and sanitized tool activity;
//  2. lifecycle / artifact / error milestones.
//
// Everything else — hidden reasoning, chain-of-thought, raw shell commands,
// internal paths, token accounting, MCP bootstrap noise — is dropped and is
// never persisted or forwarded to the client.
type Normalizer struct {
	stage        ProgressKind
	finalMessage strings.Builder
	lastEmit     time.Time
}

// heartbeatInterval bounds how long the client can go without any liveness
// signal: raw runtime activity still refreshes the Run's last_activity_at and
// emits a same-stage progress event, without inventing steps or percentages.
const heartbeatInterval = 30 * time.Second

// Diagnostic is a sanitized, server-side-only description of a failed tool call:
// tool type, exit code, duration and a redacted summary. Raw shell commands and
// internal paths never leave the runtime.
func (n *Normalizer) consumeDiagnostic(event ActionEvent) string {
	if event.ErrorCode == "" {
		return ""
	}
	item, _ := event.Payload["item"].(map[string]any)
	exitCode := ""
	if value, ok := item["exitCode"]; ok {
		exitCode = fmt.Sprint(value)
	}
	duration := ""
	if value, ok := item["durationMs"]; ok {
		duration = fmt.Sprint(value) + "ms"
	}
	return fmt.Sprintf("tool=%s stage=%s code=%s exit=%s duration=%s", strings.ToLower(fmt.Sprint(item["type"])), n.stage, event.ErrorCode, valueOr(exitCode, "-"), valueOr(duration, "-"))
}

func valueOr(primary, fallback string) string {
	if strings.TrimSpace(primary) == "" || primary == "<nil>" {
		return fallback
	}
	return primary
}

// touch emits a same-stage heartbeat when the runtime has been active for a while
// without a new semantic stage, so long runs still look alive to the user.
func (n *Normalizer) touch(event ActionEvent) []ActionEvent {
	if n.stage == "" {
		return nil
	}
	now := time.Now()
	if n.lastEmit.IsZero() || now.Sub(n.lastEmit) < heartbeatInterval {
		return nil
	}
	n.lastEmit = now
	heartbeat := event
	heartbeat.Type = EventProgressUpdated
	heartbeat.Delta = ""
	heartbeat.Payload = map[string]any{"stage": string(n.stage), "label": n.stage.Label(), "heartbeat": true}
	return []ActionEvent{heartbeat}
}

func NewNormalizer() *Normalizer { return &Normalizer{} }

// FinalMessage is the assistant message of the run. It is the runtime's output
// channel for the deliverable contract; it is deliberately not exposed as an
// event and never persisted as raw text.
func (n *Normalizer) FinalMessage() string {
	if n == nil {
		return ""
	}
	return strings.TrimSpace(n.finalMessage.String())
}

// Stage reports the last normalized stage (useful for Run status rendering).
func (n *Normalizer) Stage() ProgressKind {
	if n == nil {
		return ""
	}
	return n.stage
}

func (n *Normalizer) Normalize(event ActionEvent) []ActionEvent {
	switch event.Type {
	case EventProgress:
		// Streaming text is live transport only: it may carry hidden reasoning
		// fragments, so it is never persisted and never shown as text. The
		// accumulated assistant message stays available to the Host for the
		// deliverable contract (ResultSpec), which is the only way the runtime
		// hands its output back.
		n.finalMessage.WriteString(event.Delta)
		return n.touch(event)
	case EventRuntime:
		// Technical noise (token usage, rate limits, MCP status, thread status,
		// remote control) has no user or recovery value.
		return nil
	case EventOperationStarted, EventOperationDone:
		return n.normalizeItem(event)
	case EventArtifact:
		return []ActionEvent{sanitizeArtifactEvent(event)}
	default:
		return []ActionEvent{event}
	}
}

func (n *Normalizer) normalizeItem(event ActionEvent) []ActionEvent {
	itemType := strings.ToLower(strings.TrimSpace(nestedStringFromPayload(event.Payload, "item", "type")))
	stage, tool, ok := progressForItem(itemType)
	if !ok {
		// reasoning / agentMessage / unknown items are dropped.
		return nil
	}
	var events []ActionEvent
	if stage != "" && stage != n.stage {
		n.stage = stage
		n.lastEmit = time.Now()
		progress := event
		progress.Type = EventProgressUpdated
		progress.ErrorCode = ""
		progress.ErrorMessage = ""
		progress.Delta = ""
		progress.Payload = map[string]any{"stage": string(stage), "label": stage.Label()}
		events = append(events, progress)
	}
	activity := event
	if event.Type == EventOperationStarted {
		activity.Type = EventToolStarted
	} else {
		activity.Type = EventToolCompleted
	}
	// 工具级失败常常由 Codex 自行恢复，不作为用户可见事件；只保留服务端诊断。
	// 真正影响交付的失败会在 turn.failed / run.failed 上体现为 needs_attention。
	activity.Diagnostic = n.consumeDiagnostic(event)
	activity.ErrorCode = ""
	activity.ErrorMessage = ""
	activity.Delta = ""
	activity.Payload = map[string]any{"tool": tool, "stage": string(stage)}
	events = append(events, activity)
	if event.Type == EventOperationDone {
		events = append(events, n.touch(event)...)
	}
	return events
}

// progressForItem maps a Codex item type to a user-visible stage and a stable
// tool label. Unknown items return ok=false and are dropped.
func progressForItem(itemType string) (ProgressKind, string, bool) {
	switch itemType {
	case "commandexecution", "command_execution", "localelexec", "exec":
		return ProgressAnalyzing, "command_execution", true
	case "filechange", "file_change", "patch":
		return ProgressWriting, "file_change", true
	case "websearch", "web_search", "search":
		return ProgressSearching, "web_search", true
	case "mcptoolcall", "mcp_tool_call", "mcpcall":
		return ProgressSearching, "mcp_tool", true
	case "plan", "todo", "todolist":
		return ProgressAnalyzing, "plan", true
	default:
		return "", "", false
	}
}

// sanitizeArtifactEvent keeps the artifact metadata the Host needs for storage
// and only sanitizes the payload (no workspace path, no raw change list). The
// storage path stays on the internal event and is never serialized by the API.
func sanitizeArtifactEvent(event ActionEvent) ActionEvent {
	if event.Artifact == nil {
		event.Payload = nil
		return event
	}
	event.Payload = map[string]any{"name": event.Artifact.Name, "mime_type": event.Artifact.MimeType, "size": event.Artifact.Size}
	return event
}

// nestedStringFromPayload reads a nested string field out of an event payload.
func nestedStringFromPayload(payload map[string]any, path ...string) string {
	var current any = payload
	for _, key := range path {
		object, ok := current.(map[string]any)
		if !ok {
			return ""
		}
		current, ok = object[key]
		if !ok {
			return ""
		}
	}
	value, _ := current.(string)
	return value
}
