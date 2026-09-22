package codex

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/53AI/53AIHub/service/actionruntime"
	"golang.org/x/mod/semver"
)

type Config struct {
	Binary          string
	CommandArgs     []string
	WorkDir         string
	Sandbox         string
	ApprovalPolicy  string
	Ephemeral       bool
	MinVersion      string
	ClientName      string
	ClientTitle     string
	ClientVersion   string
	Env             []string
	MaxMessageBytes int
	MaxOutputBytes  int64
}

const (
	DefaultMaxMessageBytes = 4 * 1024 * 1024
	DefaultMaxOutputBytes  = 8 * 1024 * 1024
)

type Adapter struct {
	config  Config
	nextID  atomic.Uint64
	manager *ProcessManager
}

type process struct {
	cmd             *exec.Cmd
	stdin           io.WriteCloser
	stdout          *bufio.Scanner
	stderr          boundedBuffer
	stderrDone      chan struct{}
	writeMu         sync.Mutex
	readMu          sync.Mutex
	pendingMu       sync.Mutex
	pending         []rpcMessage
	maxMessageBytes int
	maxOutputBytes  int64
	closeOnce       sync.Once
	cancelled       atomic.Bool
	completed       atomic.Bool
}

type rpcMessage struct {
	JSONRPC string          `json:"jsonrpc,omitempty"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method,omitempty"`
	Params  json.RawMessage `json:"params,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func NewAdapter(config Config) *Adapter {
	if config.Binary == "" {
		config.Binary = "codex"
	}
	if config.Sandbox == "" {
		config.Sandbox = "read-only"
	}
	if config.ApprovalPolicy == "" {
		config.ApprovalPolicy = "never"
	}
	if config.ClientName == "" {
		config.ClientName = "53aihub-action-runtime"
	}
	if config.ClientTitle == "" {
		config.ClientTitle = "53AIHub Action Runtime"
	}
	if config.ClientVersion == "" {
		config.ClientVersion = "0.1.0"
	}
	if config.MaxMessageBytes <= 0 {
		config.MaxMessageBytes = DefaultMaxMessageBytes
	}
	if config.MaxOutputBytes <= 0 {
		config.MaxOutputBytes = DefaultMaxOutputBytes
	}
	return &Adapter{config: config, manager: NewProcessManager()}
}

func (a *Adapter) Name() string { return "codex" }

func (a *Adapter) Close() error {
	if a == nil || a.manager == nil {
		return nil
	}
	return a.manager.CloseAll()
}

func (a *Adapter) Capabilities() []actionruntime.Capability {
	return []actionruntime.Capability{actionruntime.CapabilityStreaming, actionruntime.CapabilityCancel, actionruntime.CapabilityArtifact}
}

func (a *Adapter) StartSession(ctx context.Context, request actionruntime.SessionRequest) (actionruntime.RuntimeSession, error) {
	if a == nil {
		return actionruntime.RuntimeSession{}, errors.New("codex adapter is nil")
	}
	workdir, err := a.workDir(request.Action)
	if err != nil {
		return actionruntime.RuntimeSession{}, err
	}
	if minimum := strings.TrimSpace(a.config.MinVersion); minimum != "" {
		actual, versionErr := a.readVersion(ctx, workdir)
		if versionErr != nil {
			return actionruntime.RuntimeSession{}, actionruntime.NewRuntimeError("version", classifyError("version", versionErr), versionErr)
		}
		if versionErr := CheckVersion(actual, minimum); versionErr != nil {
			return actionruntime.RuntimeSession{}, actionruntime.NewRuntimeError("version", actionruntime.ErrorCodeVersionMismatch, versionErr)
		}
	}
	args := a.config.CommandArgs
	if len(args) == 0 {
		args = []string{"app-server", "--stdio"}
	}
	cmd := exec.CommandContext(ctx, a.config.Binary, args...)
	cmd.Dir = workdir
	cmd.Env = a.environment()
	configureProcess(cmd)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return actionruntime.RuntimeSession{}, fmt.Errorf("create Codex stdin: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return actionruntime.RuntimeSession{}, fmt.Errorf("create Codex stdout: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return actionruntime.RuntimeSession{}, fmt.Errorf("create Codex stderr: %w", err)
	}
	if err := cmd.Start(); err != nil {
		return actionruntime.RuntimeSession{}, actionruntime.NewRuntimeError("start", classifyError("start", err), fmt.Errorf("start Codex app-server: %w", err))
	}
	p := &process{
		cmd:             cmd,
		stdin:           stdin,
		stdout:          bufio.NewScanner(stdout),
		stderrDone:      make(chan struct{}),
		maxMessageBytes: a.config.MaxMessageBytes,
		maxOutputBytes:  a.config.MaxOutputBytes,
	}
	p.stdout.Buffer(make([]byte, 64*1024), p.maxMessageBytes)
	go func() {
		_, _ = io.Copy(&p.stderr, stderr)
		close(p.stderrDone)
	}()

	if _, err := p.request(ctx, "initialize", map[string]any{
		"clientInfo": map[string]string{"name": a.config.ClientName, "title": a.config.ClientTitle, "version": a.config.ClientVersion},
	}); err != nil {
		_ = p.close()
		return actionruntime.RuntimeSession{}, p.stageError("initialize", err)
	}
	if err := p.notify("initialized", map[string]any{}); err != nil {
		_ = p.close()
		return actionruntime.RuntimeSession{}, p.stageError("initialized", err)
	}
	threadResult, err := p.request(ctx, "thread/start", map[string]any{
		"cwd":            workdir,
		"approvalPolicy": valueOr(request.Action.ApprovalPolicy, a.config.ApprovalPolicy),
		"sandbox":        valueOr(request.Action.Sandbox, a.config.Sandbox),
		"ephemeral":      a.config.Ephemeral || request.Action.Ephemeral,
	})
	if err != nil {
		_ = p.close()
		return actionruntime.RuntimeSession{}, p.stageError("thread/start", err)
	}
	externalID := nestedString(threadResult, "thread", "id")
	if externalID == "" {
		_ = p.close()
		return actionruntime.RuntimeSession{}, p.stageError("thread/start", errors.New("response did not contain result.thread.id"))
	}
	sessionID := fmt.Sprintf("codex-session-%d", a.nextID.Add(1))
	a.manager.Register(sessionID, p)
	return actionruntime.RuntimeSession{ID: sessionID, Runtime: a.Name(), ExternalID: externalID, Status: actionruntime.SessionStatusReady}, nil
}

// CheckVersion enforces the minimum supported executor version. Upgrading the
// executor must never fail runs by itself; only an older binary is rejected.
func CheckVersion(actual, minimum string) error {
	actual = strings.TrimSpace(actual)
	if minimum = strings.TrimSpace(minimum); minimum == "" {
		return nil
	}
	actualVersion, ok := parseVersion(actual)
	if !ok {
		return fmt.Errorf("cannot parse Codex version %q; minimum supported version is %q", actual, minimum)
	}
	minimumVersion, ok := parseVersion(minimum)
	if !ok {
		return fmt.Errorf("cannot parse configured minimum Codex version %q", minimum)
	}
	if semver.Compare(actualVersion, minimumVersion) < 0 {
		return fmt.Errorf("Codex %q is below the minimum supported version %q", actual, minimum)
	}
	return nil
}

// parseVersion extracts the semantic version from a `codex --version` line such
// as "codex-cli 0.154.0".
func parseVersion(value string) (string, bool) {
	for _, field := range strings.Fields(value) {
		version := "v" + strings.TrimPrefix(field, "v")
		if semver.IsValid(version) {
			return version, true
		}
	}
	return "", false
}

func (a *Adapter) readVersion(ctx context.Context, workdir string) (string, error) {
	command := exec.CommandContext(ctx, a.config.Binary, "--version")
	command.Dir = workdir
	command.Env = a.environment()
	var stdout boundedBuffer
	var stderr boundedBuffer
	command.Stdout = &stdout
	command.Stderr = &stderr
	if err := command.Run(); err != nil {
		detail := strings.TrimSpace(stderr.buffer.String())
		if detail == "" {
			detail = strings.TrimSpace(stdout.buffer.String())
		}
		if detail != "" {
			return "", fmt.Errorf("read Codex version: %w: %s", err, detail)
		}
		return "", fmt.Errorf("read Codex version: %w", err)
	}
	return strings.TrimSpace(stdout.buffer.String()), nil
}

func (a *Adapter) environment() []string {
	if len(a.config.Env) == 0 {
		return os.Environ()
	}
	return append(os.Environ(), a.config.Env...)
}

func (a *Adapter) StartRun(ctx context.Context, request actionruntime.RunRequest) (<-chan actionruntime.ActionEvent, error) {
	p, ok := a.manager.Get(request.Session.ID)
	if !ok {
		return nil, fmt.Errorf("codex session not found: %s", request.Session.ID)
	}
	p.completed.Store(false)
	result, err := p.request(ctx, "turn/start", map[string]any{
		"threadId": request.Session.ExternalID,
		"input":    []map[string]string{{"type": "text", "text": request.Prompt}},
	})
	if err != nil {
		_ = p.close()
		a.manager.Remove(request.Session.ID)
		return nil, p.stageError("turn/start", err)
	}
	turnID := nestedString(result, "turn", "id")
	if turnID == "" {
		_ = p.close()
		a.manager.Remove(request.Session.ID)
		return nil, p.stageError("turn/start", errors.New("response did not contain result.turn.id"))
	}

	events := make(chan actionruntime.ActionEvent, 16)
	go a.readRun(ctx, request, p, turnID, events)
	return events, nil
}

func (a *Adapter) Cancel(_ context.Context, session actionruntime.RuntimeSession, _ actionruntime.ActionRun) error {
	return a.manager.Cancel(session.ID)
}

func (a *Adapter) readRun(ctx context.Context, request actionruntime.RunRequest, p *process, turnID string, output chan<- actionruntime.ActionEvent) {
	defer close(output)
	defer func() {
		if !p.completed.Load() {
			a.manager.Remove(request.Session.ID)
			_ = p.close()
		}
	}()
	var outputBytes int64
	for _, message := range p.takePending() {
		if a.handleRunMessage(ctx, request, p, turnID, output, message, int64(len(message.Params)), &outputBytes) {
			return
		}
	}
	for p.stdout.Scan() {
		line := append([]byte(nil), p.stdout.Bytes()...)
		message, err := decode(line)
		if err != nil {
			sendEvent(ctx, output, actionruntime.ActionEvent{Type: actionruntime.EventRunFailed, ExternalMethod: "protocol/decode", ErrorCode: string(actionruntime.ErrorCodeProtocolFailed), ErrorMessage: err.Error()})
			return
		}
		if a.handleRunMessage(ctx, request, p, turnID, output, message, int64(len(line)), &outputBytes) {
			return
		}
	}
	if p.cancelled.Load() {
		sendEvent(context.Background(), output, actionruntime.ActionEvent{Type: actionruntime.EventRunCancelled, ExternalMethod: "runtime/cancel", ErrorCode: string(actionruntime.ErrorCodeCancelled)})
		return
	}
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		sendEvent(context.Background(), output, actionruntime.ActionEvent{Type: actionruntime.EventRunFailed, ExternalMethod: "runtime/timeout", ErrorCode: string(actionruntime.ErrorCodeRunTimeout), ErrorMessage: "Codex run context deadline exceeded"})
		return
	}
	if errors.Is(ctx.Err(), context.Canceled) {
		sendEvent(context.Background(), output, actionruntime.ActionEvent{Type: actionruntime.EventRunCancelled, ExternalMethod: "runtime/cancel", ErrorCode: string(actionruntime.ErrorCodeCancelled)})
		return
	}
	err := p.stdout.Err()
	if err != nil {
		if strings.Contains(err.Error(), "token too long") {
			sendEvent(context.Background(), output, actionruntime.ActionEvent{Type: actionruntime.EventRunFailed, ExternalMethod: "protocol/size", ErrorCode: string(actionruntime.ErrorCodeOutputLimit), ErrorMessage: fmt.Sprintf("runtime message exceeds %d bytes", p.maxMessageBytes)})
			return
		}
		sendEvent(context.Background(), output, actionruntime.ActionEvent{Type: actionruntime.EventRunFailed, ExternalMethod: "protocol/read", ErrorCode: string(actionruntime.ErrorCodeProtocolFailed), ErrorMessage: p.stageError("read events", err).Error()})
		return
	}
	sendEvent(context.Background(), output, actionruntime.ActionEvent{Type: actionruntime.EventRunFailed, ExternalMethod: "runtime/exit", ErrorCode: string(actionruntime.ErrorCodeRuntimeExited), ErrorMessage: p.stageError("read events", io.EOF).Error()})
}

func (a *Adapter) handleRunMessage(ctx context.Context, request actionruntime.RunRequest, p *process, turnID string, output chan<- actionruntime.ActionEvent, message rpcMessage, messageBytes int64, outputBytes *int64) bool {
	if message.Method == "" {
		return false
	}
	if len(message.ID) > 0 {
		if err := p.reply(message.ID, -32601, "Codex server request is not supported by this adapter: "+message.Method); err != nil {
			return true
		}
	}
	// V1 不把 Codex Runtime 的技术审批暴露给用户：执行前已由用户 Confirm，运行中若仍出现
	// 需要人工授权的动作，按 fail-closed 处理——立即停止并不暴露 command/sandbox 等技术细节。
	if isApprovalMethod(message.Method) {
		p.cancelled.Store(true)
		sendEvent(context.Background(), output, actionruntime.ActionEvent{
			Type: actionruntime.EventRunFailed, ExternalMethod: "runtime/approval_unavailable",
			ErrorCode:    string(actionruntime.ErrorCodeApprovalUnavailable),
			ErrorMessage: "本次执行需要额外授权，系统已安全停止。请调整任务范围或拆分后再重新执行。",
		})
		_ = p.close()
		return true
	}
	if outputBytes != nil {
		*outputBytes += messageBytes
		if p.maxOutputBytes > 0 && *outputBytes > p.maxOutputBytes {
			p.cancelled.Store(true)
			sendEvent(context.Background(), output, actionruntime.ActionEvent{Type: actionruntime.EventRunFailed, ExternalMethod: "runtime/output_limit", ErrorCode: string(actionruntime.ErrorCodeOutputLimit), ErrorMessage: fmt.Sprintf("runtime output exceeds %d bytes", p.maxOutputBytes)})
			_ = p.close()
			return true
		}
	}
	event := eventFromMessage(message.Method, message.Params)
	if event.Type == "" {
		return false
	}
	if message.Method == "item/completed" {
		a.verifyArtifact(ctx, request.Action, &event)
		if nestedStringValue(event.Payload, "item", "type") == "fileChange" {
			event.Payload = redactArtifactPayload(event.Payload)
		} else if nestedStringValue(event.Payload, "item", "type") == "commandExecution" {
			event.Payload = redactCommandExecutionPayload(event.Payload)
		}
		if nestedStringValue(event.Payload, "item", "status") == "failed" && event.Type != actionruntime.EventRunFailed {
			event.ErrorCode = "operation_failed"
			event.ErrorMessage = "Codex operation reported failure"
		}
	} else if nestedStringValue(event.Payload, "item", "type") == "commandExecution" {
		event.Payload = redactCommandExecutionPayload(event.Payload)
	}
	if event.SessionID == "" {
		event.SessionID = request.Session.ID
	}
	if event.RunID == "" {
		event.RunID = request.Run.ID
	}
	event.TurnID = turnID
	event.Runtime = a.Name()
	event = sanitizeEvent(request.Action, event)
	sendEvent(ctx, output, event)
	if message.Method == "turn/completed" && nestedStringBytes(message.Params, "threadId") == request.Session.ExternalID && (nestedStringBytes(message.Params, "turn", "id") == turnID || nestedStringBytes(message.Params, "turnId") == turnID) {
		p.completed.Store(true)
		return true
	}
	return false
}

func sendEvent(ctx context.Context, output chan<- actionruntime.ActionEvent, event actionruntime.ActionEvent) {
	select {
	case output <- event:
	case <-ctx.Done():
	}
}

func (a *Adapter) workDir(action actionruntime.ActionSpec) (string, error) {
	workdir := action.WorkDir
	if workdir == "" {
		workdir = a.config.WorkDir
	}
	if workdir == "" {
		workdir = "."
	}
	return filepath.Abs(workdir)
}

func (p *process) request(ctx context.Context, method string, params any) (json.RawMessage, error) {
	p.readMu.Lock()
	defer p.readMu.Unlock()
	id := json.RawMessage("1")
	if err := p.write(rpcMessage{ID: id, Method: method, Params: mustJSON(params)}); err != nil {
		return nil, err
	}
	for p.stdout.Scan() {
		message, err := decode(p.stdout.Bytes())
		if err != nil {
			return nil, err
		}
		if message.Method != "" {
			if len(message.ID) > 0 {
				if isApprovalMethod(message.Method) {
					// 早于 turn 响应的授权请求：留到 readRun 统一 fail-closed（不回复、不暴露给用户）。
					p.addPending(message)
				} else if err := p.reply(message.ID, -32601, "Codex server request is not supported by this adapter: "+message.Method); err != nil {
					return nil, err
				}
			} else {
				p.addPending(message)
			}
			continue
		}
		if string(message.ID) != string(id) {
			continue
		}
		if message.Error != nil {
			return nil, fmt.Errorf("RPC %s (%d): %s", method, message.Error.Code, message.Error.Message)
		}
		return message.Result, nil
	}
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	if err := p.stdout.Err(); err != nil {
		return nil, err
	}
	return nil, io.EOF
}

func (p *process) addPending(message rpcMessage) {
	p.pendingMu.Lock()
	defer p.pendingMu.Unlock()
	p.pending = append(p.pending, message)
}

func (p *process) takePending() []rpcMessage {
	p.pendingMu.Lock()
	defer p.pendingMu.Unlock()
	pending := p.pending
	p.pending = nil
	return pending
}

func (p *process) notify(method string, params any) error {
	return p.write(rpcMessage{Method: method, Params: mustJSON(params)})
}

func (p *process) reply(id json.RawMessage, code int, message string) error {
	return p.write(rpcMessage{ID: id, Error: &rpcError{Code: code, Message: message}})
}

func (p *process) write(message rpcMessage) error {
	p.writeMu.Lock()
	defer p.writeMu.Unlock()
	message.JSONRPC = "2.0"
	encoded, err := json.Marshal(message)
	if err != nil {
		return err
	}
	if p.maxMessageBytes > 0 && len(encoded) > p.maxMessageBytes {
		return fmt.Errorf("Codex message exceeds %d bytes", p.maxMessageBytes)
	}
	if _, err := fmt.Fprintf(p.stdin, "%s\n", encoded); err != nil {
		return fmt.Errorf("write Codex %s: %w", message.Method, err)
	}
	return nil
}

func (p *process) close() error {
	var waitErr error
	p.closeOnce.Do(func() {
		_ = p.stdin.Close()
		wait := make(chan error, 1)
		go func() {
			wait <- p.cmd.Wait()
		}()
		timer := time.NewTimer(2 * time.Second)
		defer timer.Stop()
		select {
		case waitErr = <-wait:
		case <-timer.C:
			if p.cmd.Process != nil {
				_ = killProcess(p.cmd)
			}
			waitErr = <-wait
		}
		<-p.stderrDone
	})
	if p.cancelled.Load() {
		return nil
	}
	return waitErr
}

func (p *process) stageError(stage string, err error) error {
	return actionruntime.NewRuntimeError(stage, classifyError(stage, err), err)
}

func classifyError(stage string, err error) actionruntime.ErrorCode {
	if errors.Is(err, exec.ErrNotFound) || errors.Is(err, os.ErrNotExist) {
		return actionruntime.ErrorCodeBinaryMissing
	}
	if errors.Is(err, context.Canceled) {
		return actionruntime.ErrorCodeCancelled
	}
	if errors.Is(err, context.DeadlineExceeded) {
		if stage == "turn/start" || stage == "read events" {
			return actionruntime.ErrorCodeRunTimeout
		}
		return actionruntime.ErrorCodeReadyTimeout
	}
	if errors.Is(err, io.EOF) {
		return actionruntime.ErrorCodeRuntimeExited
	}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		return actionruntime.ErrorCodeRuntimeExited
	}
	lower := strings.ToLower(err.Error())
	if strings.Contains(lower, "auth") || strings.Contains(lower, "unauthorized") || strings.Contains(lower, "forbidden") {
		return actionruntime.ErrorCodeAuthFailed
	}
	if strings.Contains(lower, "proxy") || strings.Contains(lower, "connection refused") || strings.Contains(lower, "network is unreachable") {
		return actionruntime.ErrorCodeProxyFailed
	}
	if strings.Contains(lower, "decode") || strings.HasPrefix(stage, "initialize") || strings.HasPrefix(stage, "thread/") || strings.HasPrefix(stage, "turn/") {
		return actionruntime.ErrorCodeProtocolFailed
	}
	return actionruntime.ErrorCodeUnknown
}

type boundedBuffer struct {
	buffer bytes.Buffer
}

func (b *boundedBuffer) Write(value []byte) (int, error) {
	const maxStderrBytes = 64 * 1024
	originalLength := len(value)
	remaining := maxStderrBytes - b.buffer.Len()
	if remaining > 0 {
		if len(value) > remaining {
			value = value[:remaining]
		}
		_, _ = b.buffer.Write(value)
	}
	return originalLength, nil
}

func eventFromMessage(method string, params json.RawMessage) actionruntime.ActionEvent {
	event := actionruntime.ActionEvent{
		Type:           eventType(method, params),
		ExternalMethod: method,
		Payload:        objectValue(params),
	}
	if event.Type == actionruntime.EventProgress {
		event.Delta = nestedStringBytes(params, "delta")
	}
	return event
}

func eventType(method string, params json.RawMessage) actionruntime.EventType {
	switch method {
	case "item/agentMessage/delta", "agentMessage/delta":
		return actionruntime.EventProgress
	case "item/started":
		return actionruntime.EventOperationStarted
	case "item/completed":
		return actionruntime.EventOperationDone
	case "thread/started":
		return actionruntime.EventRuntimeStarted
	case "turn/started":
		return actionruntime.EventTurnStarted
	case "turn/completed":
		switch nestedStringBytes(params, "turn", "status") {
		case "failed":
			return actionruntime.EventTurnFailed
		case "cancelled", "canceled":
			return actionruntime.EventRunCancelled
		default:
			return actionruntime.EventTurnCompleted
		}
	case "error", "turn/failed":
		return actionruntime.EventTurnFailed
	default:
		return actionruntime.EventRuntime
	}
}

func isApprovalMethod(method string) bool {
	switch method {
	case "item/commandExecution/requestApproval", "item/fileChange/requestApproval":
		return true
	default:
		return false
	}
}

func rpcID(raw json.RawMessage) string {
	var value string
	if json.Unmarshal(raw, &value) == nil {
		return value
	}
	return string(raw)
}

func (a *Adapter) verifyArtifact(ctx context.Context, action actionruntime.ActionSpec, event *actionruntime.ActionEvent) {
	if event == nil || event.Payload == nil || nestedStringValue(event.Payload, "item", "type") != "fileChange" || nestedStringValue(event.Payload, "item", "status") != "completed" {
		return
	}
	changes, ok := nestedValue(event.Payload, "item", "changes").([]any)
	if !ok || len(changes) == 0 {
		event.ErrorCode = "artifact_verification_failed"
		event.ErrorMessage = "completed fileChange did not contain exactly one change"
		return
	}
	if len(changes) != 1 {
		event.ErrorCode = "artifact_verification_failed"
		event.ErrorMessage = fmt.Sprintf("fileChange contains %d changes; one Artifact is required", len(changes))
		return
	}
	path, _ := nestedStringValueFromAny(changes[0], "path")
	if path == "" {
		event.ErrorCode = "artifact_verification_failed"
		event.ErrorMessage = "completed fileChange did not contain a path"
		return
	}
	workdir, err := a.workDir(action)
	if err != nil {
		event.ErrorCode = "artifact_verification_failed"
		event.ErrorMessage = "artifact failed Host validation"
		return
	}
	if !filepath.IsAbs(path) {
		path = filepath.Join(workdir, path)
	}
	if len(action.ExpectedArtifacts) > 0 && !isExpectedArtifact(workdir, path, action.ExpectedArtifacts) {
		return
	}
	artifact, err := actionruntime.VerifyArtifactInWorkspace(ctx, workdir, path, 0)
	if err != nil {
		event.ErrorCode = "artifact_verification_failed"
		event.ErrorMessage = err.Error()
		return
	}
	event.Type = actionruntime.EventArtifact
	event.Artifact = &artifact
}

func isExpectedArtifact(workdir, path string, expected []string) bool {
	path, err := filepath.Abs(path)
	if err != nil {
		return false
	}
	for _, candidate := range expected {
		candidatePath, err := filepath.Abs(filepath.Join(workdir, candidate))
		if err == nil && candidatePath == path {
			return true
		}
	}
	return false
}

func sanitizeEvent(action actionruntime.ActionSpec, event actionruntime.ActionEvent) actionruntime.ActionEvent {
	if strings.TrimSpace(action.WorkDir) == "" {
		return event
	}
	workdir, err := filepath.Abs(action.WorkDir)
	if err != nil || workdir == "." || workdir == string(filepath.Separator) {
		return event
	}
	event.Delta = redactWorkdir(event.Delta, workdir)
	event.ErrorMessage = redactWorkdir(event.ErrorMessage, workdir)
	if event.Payload != nil {
		event.Payload = redactWorkdirValue(event.Payload, workdir).(map[string]any)
	}
	return event
}

func redactWorkdir(value, workdir string) string {
	if value == "" || workdir == "" {
		return value
	}
	for _, root := range []string{workdir, filepath.ToSlash(workdir)} {
		value = replaceWorkdir(value, root)
	}
	return value
}

func replaceWorkdir(value, root string) string {
	if root == "" {
		return value
	}
	var result strings.Builder
	last, search := 0, 0
	for search < len(value) {
		index := strings.Index(value[search:], root)
		if index < 0 {
			break
		}
		index += search
		end := index + len(root)
		if end == len(value) || value[end] == '/' || value[end] == '\\' {
			result.WriteString(value[last:index])
			result.WriteString(".")
			last = end
		}
		search = end
	}
	if last == 0 {
		return value
	}
	result.WriteString(value[last:])
	return result.String()
}

func redactWorkdirValue(value any, workdir string) any {
	switch current := value.(type) {
	case string:
		return redactWorkdir(current, workdir)
	case map[string]any:
		for key, child := range current {
			current[key] = redactWorkdirValue(child, workdir)
		}
	case []any:
		for index, child := range current {
			current[index] = redactWorkdirValue(child, workdir)
		}
	}
	return value
}

func redactArtifactPayload(payload map[string]any) map[string]any {
	item := map[string]any{}
	if rawItem, ok := payload["item"].(map[string]any); ok {
		if value, ok := rawItem["type"].(string); ok {
			item["type"] = value
		}
		if value, ok := rawItem["status"].(string); ok {
			item["status"] = value
		}
		if changes, ok := rawItem["changes"].([]any); ok {
			item["change_count"] = len(changes)
		}
	}
	return map[string]any{"item": item}
}

func redactCommandExecutionPayload(payload map[string]any) map[string]any {
	item := map[string]any{}
	if rawItem, ok := payload["item"].(map[string]any); ok {
		for _, key := range []string{"id", "type", "status", "exitCode"} {
			if value, exists := rawItem[key]; exists {
				item[key] = value
			}
		}
		if actions, ok := rawItem["commandActions"].([]any); ok {
			item["command_action_count"] = len(actions)
		}
	}
	return map[string]any{"item": item}
}

func decode(line []byte) (rpcMessage, error) {
	var message rpcMessage
	if err := json.Unmarshal(line, &message); err != nil {
		return rpcMessage{}, fmt.Errorf("decode app-server message: %w", err)
	}
	return message, nil
}

func objectValue(raw json.RawMessage) map[string]any {
	var value map[string]any
	if json.Unmarshal(raw, &value) != nil {
		return nil
	}
	return value
}

func nestedString(raw json.RawMessage, path ...string) string {
	return nestedStringBytes(raw, path...)
}

func nestedStringBytes(raw json.RawMessage, path ...string) string {
	value, ok := valueAt(raw, path...)
	if !ok {
		return ""
	}
	result, _ := value.(string)
	return result
}

func nestedStringValue(value map[string]any, path ...string) string {
	result, _ := nestedStringValueFromAny(value, path...)
	return result
}

func nestedStringValueFromAny(value any, path ...string) (string, bool) {
	for _, key := range path {
		object, ok := value.(map[string]any)
		if !ok {
			return "", false
		}
		value, ok = object[key]
		if !ok {
			return "", false
		}
	}
	result, ok := value.(string)
	return result, ok
}

func nestedValue(value map[string]any, path ...string) any {
	result, _ := nestedValueFromAny(value, path...)
	return result
}

func nestedValueFromAny(value any, path ...string) (any, bool) {
	for _, key := range path {
		object, ok := value.(map[string]any)
		if !ok {
			return nil, false
		}
		value, ok = object[key]
		if !ok {
			return nil, false
		}
	}
	return value, true
}

func valueAt(raw json.RawMessage, path ...string) (any, bool) {
	var value any
	if json.Unmarshal(raw, &value) != nil {
		return nil, false
	}
	for _, key := range path {
		object, ok := value.(map[string]any)
		if !ok {
			return nil, false
		}
		value, ok = object[key]
		if !ok {
			return nil, false
		}
	}
	return value, true
}

func valueOr(primary, fallback string) string {
	if primary != "" {
		return primary
	}
	return fallback
}

func mustJSON(value any) json.RawMessage {
	encoded, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return encoded
}

var _ actionruntime.RuntimeAdapter = (*Adapter)(nil)
