package docker

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/53AI/53AIHub/service/sandboxruntime"
)

const (
	defaultSandboxRuntimeImage              = "53ai-sandbox:latest"
	defaultSandboxRuntimeIdleCleanupSeconds = 3600
	remoteSandboxRuntimeImage               = "registry.cn-hangzhou.aliyuncs.com/53ai/53ai-sandbox:latest"
)

func Register() {
	sandboxruntime.RegisterProvider("docker", func(ctx context.Context, cfg sandboxruntime.ProviderConfig) (sandboxruntime.Runtime, error) {
		return NewRuntime(Config{
			Image:              cfg.Image,
			ContainerPrefix:    cfg.ContainerPrefix,
			WorkspaceRoot:      cfg.WorkspaceRoot,
			ContainerWorkdir:   cfg.ContainerWorkdir,
			TimeoutSeconds:     cfg.TimeoutSeconds,
			IdleCleanupSeconds: cfg.IdleCleanupSeconds,
			NetworkEnabled:     cfg.NetworkEnabled,
			ReadOnlyRoot:       cfg.ReadOnlyRoot,
		}), nil
	})
}

type Config struct {
	Image              string
	ContainerPrefix    string
	WorkspaceRoot      string
	ContainerWorkdir   string
	RunAsUser          string
	TimeoutSeconds     int
	IdleCleanupSeconds int
	CPUs               string
	Memory             string
	NetworkEnabled     bool
	ReadOnlyRoot       bool
}

type sessionState struct {
	session    *sandboxruntime.Session
	lastAccess time.Time
	activeOps  int
}

type Runtime struct {
	cfg        Config
	runner     dockerCommandRunner
	mu         sync.Mutex
	sessions   map[string]*sessionState
	idleTTL    time.Duration
	reaperStop chan struct{}
	reaperOnce sync.Once
	reaperWG   sync.WaitGroup
}

func NewRuntime(cfg Config) *Runtime {
	if strings.TrimSpace(cfg.Image) == "" {
		cfg.Image = defaultSandboxRuntimeImage
	}
	if strings.TrimSpace(cfg.ContainerPrefix) == "" {
		cfg.ContainerPrefix = "53ai-sbx-"
	}
	if strings.TrimSpace(cfg.WorkspaceRoot) == "" {
		cfg.WorkspaceRoot = filepath.Join(os.TempDir(), "53ai-sandbox")
	}
	if strings.TrimSpace(cfg.ContainerWorkdir) == "" {
		cfg.ContainerWorkdir = "/workspace"
	}
	if strings.TrimSpace(cfg.RunAsUser) == "" {
		cfg.RunAsUser = fmt.Sprintf("%d:%d", os.Getuid(), os.Getgid())
	}
	if cfg.TimeoutSeconds <= 0 {
		cfg.TimeoutSeconds = 300
	}
	if cfg.IdleCleanupSeconds <= 0 {
		cfg.IdleCleanupSeconds = defaultSandboxRuntimeIdleCleanupSeconds
	}
	rt := &Runtime{
		cfg:      cfg,
		runner:   osDockerCommandRunner{},
		sessions: map[string]*sessionState{},
	}
	rt.idleTTL = time.Duration(cfg.IdleCleanupSeconds) * time.Second
	rt.reaperStop = make(chan struct{})
	rt.startIdleReaper()
	return rt
}

type dockerCommandRunner interface {
	CombinedOutput(ctx context.Context, name string, args ...string) ([]byte, error)
}

type osDockerCommandRunner struct{}

func (osDockerCommandRunner) CombinedOutput(ctx context.Context, name string, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	return cmd.CombinedOutput()
}

func sanitizeName(s string) string {
	s = strings.TrimSpace(s)
	s = strings.ToLower(s)
	s = strings.NewReplacer(":", "-", "/", "-", " ", "-", "_", "-").Replace(s)
	if s == "" {
		return "sandbox"
	}
	return s
}

func (r *Runtime) startIdleReaper() {
	if r == nil || r.idleTTL <= 0 || r.reaperStop == nil {
		return
	}
	r.reaperWG.Add(1)
	go func() {
		defer r.reaperWG.Done()
		ticker := time.NewTicker(r.idleReaperInterval())
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				if err := r.reapExpiredSessions(context.Background(), time.Now()); err != nil {
					// 仅做兜底清理，失败不影响主流程
				}
			case <-r.reaperStop:
				return
			}
		}
	}()
}

func (r *Runtime) stopIdleReaper() {
	if r == nil || r.reaperStop == nil {
		return
	}
	r.reaperOnce.Do(func() {
		close(r.reaperStop)
		r.reaperWG.Wait()
	})
}

func (r *Runtime) idleReaperInterval() time.Duration {
	if r == nil || r.idleTTL <= 0 {
		return time.Second
	}
	interval := r.idleTTL / 2
	if interval < time.Second {
		interval = time.Second
	}
	if interval > time.Minute {
		interval = time.Minute
	}
	return interval
}

func (r *Runtime) beginSessionUse(session *sandboxruntime.Session) (func(), error) {
	if session == nil {
		return nil, sandboxruntime.ErrSessionRequired
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	state, ok := r.sessions[session.ID]
	if !ok || state == nil || state.session == nil {
		return nil, fmt.Errorf("sandbox session %q is not available", session.ID)
	}
	state.activeOps++
	state.lastAccess = time.Now()
	return func() {
		r.endSessionUse(session.ID)
	}, nil
}

func (r *Runtime) endSessionUse(sessionID string) {
	now := time.Now()
	r.mu.Lock()
	defer r.mu.Unlock()
	state, ok := r.sessions[sessionID]
	if !ok || state == nil {
		return
	}
	if state.activeOps > 0 {
		state.activeOps--
	}
	if state.activeOps == 0 {
		state.lastAccess = now
	}
}

func (r *Runtime) reapExpiredSessions(ctx context.Context, now time.Time) error {
	if r == nil || r.idleTTL <= 0 {
		return nil
	}
	type expiredSession struct {
		id      string
		session *sandboxruntime.Session
	}
	expired := make([]expiredSession, 0)
	r.mu.Lock()
	for id, state := range r.sessions {
		if state == nil || state.session == nil {
			delete(r.sessions, id)
			continue
		}
		if state.activeOps > 0 {
			continue
		}
		if state.lastAccess.IsZero() {
			state.lastAccess = now
			continue
		}
		if now.Sub(state.lastAccess) < r.idleTTL {
			continue
		}
		expired = append(expired, expiredSession{id: id, session: state.session})
		delete(r.sessions, id)
	}
	r.mu.Unlock()

	var errs []string
	for _, item := range expired {
		if item.session == nil {
			continue
		}
		if err := r.killContainer(ctx, item.session.ProviderID); err != nil {
			errs = append(errs, fmt.Sprintf("%s: %v", item.id, err))
		} else {
			item.session.State = "killed"
		}
	}
	if len(errs) > 0 {
		return errors.New(strings.Join(errs, "; "))
	}
	return nil
}

func (r *Runtime) killContainer(ctx context.Context, providerID string) error {
	if strings.TrimSpace(providerID) == "" {
		return nil
	}
	out, err := r.runDockerCommand(ctx, "rm", "-f", providerID)
	if err != nil {
		lower := strings.ToLower(string(out))
		if strings.Contains(lower, "no such container") || strings.Contains(lower, "not found") {
			return nil
		}
		return fmt.Errorf("docker rm failed: %w, output: %s", err, string(out))
	}
	return nil
}

func (r *Runtime) Acquire(ctx context.Context, spec sandboxruntime.SessionSpec) (*sandboxruntime.Session, error) {
	sessionID := spec.AgentRunID
	if sessionID == "" {
		sessionID = fmt.Sprintf("session-%d-%d", spec.Eid, time.Now().UnixNano())
	}
	if err := r.reapExpiredSessions(ctx, time.Now()); err != nil {
		// 仅做兜底清理，失败不阻塞新会话创建
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if state, ok := r.sessions[sessionID]; ok && state != nil && state.session != nil {
		state.lastAccess = time.Now()
		return state.session, nil
	}
	hostRoot := filepath.Join(r.cfg.WorkspaceRoot, sanitizeName(sessionID))
	if err := os.MkdirAll(filepath.Join(hostRoot, "skills"), 0755); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Join(hostRoot, "inputs"), 0755); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Join(hostRoot, "output"), 0755); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Join(hostRoot, "tmp"), 0755); err != nil {
		return nil, err
	}
	containerID, err := r.ensureContainer(ctx, sessionID, hostRoot)
	if err != nil {
		return nil, err
	}
	session := &sandboxruntime.Session{
		ID:         sessionID,
		Provider:   "docker",
		ProviderID: containerID,
		Mounts: sandboxruntime.Mounts{
			WorkspaceRoot: hostRoot,
			SkillRoot:     filepath.Join(hostRoot, "skills"),
			InputRoot:     filepath.Join(hostRoot, "inputs"),
			ArtifactRoot:  filepath.Join(hostRoot, "output"),
		},
		State: "running",
	}
	r.sessions[sessionID] = &sessionState{
		session:    session,
		lastAccess: time.Now(),
	}
	return session, nil
}

func (r *Runtime) ensureContainer(ctx context.Context, sessionID, hostRoot string) (string, error) {
	if err := r.ensureImageAvailable(ctx); err != nil {
		return "", err
	}
	name := r.cfg.ContainerPrefix + sanitizeName(sessionID)
	args := []string{"run", "-d", "--name", name, "--label", "53aihub.sandbox=true"}
	if strings.TrimSpace(r.cfg.RunAsUser) != "" {
		args = append(args, "--user", r.cfg.RunAsUser)
	}
	// Give GUI-ish tools such as LibreOffice a writable home and XDG cache/config area.
	// Without this, they may fall back to /.cache or fail to create their user profile.
	args = append(args,
		"-e", "HOME=/workspace/.home",
		"-e", "XDG_CACHE_HOME=/workspace/.home/.cache",
		"-e", "XDG_CONFIG_HOME=/workspace/.home/.config",
		"-e", "XDG_DATA_HOME=/workspace/.home/.local/share",
	)
	if r.cfg.ReadOnlyRoot {
		args = append(args, "--read-only")
	}
	args = append(args, "--tmpfs", "/tmp", "--tmpfs", "/var/tmp", "--tmpfs", "/run")
	if !r.cfg.NetworkEnabled {
		args = append(args, "--network", "none")
	}
	args = append(args, "-v", fmt.Sprintf("%s:%s:rw", hostRoot, r.cfg.ContainerWorkdir))
	args = append(args, "-w", r.cfg.ContainerWorkdir)
	args = append(args, r.cfg.Image, "sleep", "infinity")

	out, err := r.runDockerCommand(ctx, args...)
	if err != nil {
		return "", fmt.Errorf("docker run failed: %w, output: %s", err, string(out))
	}
	return strings.TrimSpace(string(out)), nil
}

func (r *Runtime) CleanupOrphans(ctx context.Context) error {
	out, err := r.runDockerCommand(ctx, "ps", "-aq", "--filter", "label=53aihub.sandbox=true")
	if err != nil {
		return fmt.Errorf("docker ps failed: %w, output: %s", err, string(out))
	}
	ids := strings.Fields(string(out))
	if len(ids) == 0 {
		return nil
	}
	args := append([]string{"rm", "-f"}, ids...)
	rmOut, rmErr := r.runDockerCommand(ctx, args...)
	if rmErr != nil {
		return fmt.Errorf("docker rm failed: %w, output: %s", rmErr, string(rmOut))
	}
	return nil
}

func (r *Runtime) getFsBridge(session *sandboxruntime.Session) *FsBridge {
	return NewFsBridge(session.Mounts.WorkspaceRoot, r.cfg.ContainerWorkdir)
}

func (r *Runtime) ensureImageAvailable(ctx context.Context) error {
	if strings.TrimSpace(r.cfg.Image) == "" {
		return fmt.Errorf("docker runtime image is empty")
	}
	if out, err := r.runDockerCommand(ctx, "image", "inspect", r.cfg.Image); err == nil {
		_ = out
		return nil
	}
	if strings.TrimSpace(remoteSandboxRuntimeImage) == "" {
		return fmt.Errorf("docker runtime image %q not found locally and remote fallback is empty", r.cfg.Image)
	}
	if _, err := r.runDockerCommand(ctx, "pull", remoteSandboxRuntimeImage); err != nil {
		return fmt.Errorf("docker pull failed for %s: %w", remoteSandboxRuntimeImage, err)
	}
	if r.cfg.Image != remoteSandboxRuntimeImage {
		if _, err := r.runDockerCommand(ctx, "tag", remoteSandboxRuntimeImage, r.cfg.Image); err != nil {
			return fmt.Errorf("docker tag failed from %s to %s: %w", remoteSandboxRuntimeImage, r.cfg.Image, err)
		}
	}
	return nil
}

func (r *Runtime) runDockerCommand(ctx context.Context, args ...string) ([]byte, error) {
	runner := r.runner
	if runner == nil {
		runner = osDockerCommandRunner{}
	}
	return runner.CombinedOutput(ctx, "docker", args...)
}

func (r *Runtime) WriteFiles(ctx context.Context, session *sandboxruntime.Session, files []sandboxruntime.FileObject) error {
	release, err := r.beginSessionUse(session)
	if err != nil {
		return err
	}
	defer release()
	bridge := r.getFsBridge(session)
	for _, file := range files {
		if err := bridge.WriteFile(ctx, file.Path, string(file.Data), false); err != nil {
			return err
		}
	}
	return nil
}

func (r *Runtime) ReadFile(ctx context.Context, session *sandboxruntime.Session, path string, maxBytes int64) ([]byte, error) {
	release, err := r.beginSessionUse(session)
	if err != nil {
		return nil, err
	}
	defer release()
	bridge := r.getFsBridge(session)
	content, err := bridge.ReadFile(ctx, path)
	if err != nil {
		return nil, err
	}
	raw := []byte(content)
	if maxBytes > 0 && int64(len(raw)) > maxBytes {
		raw = raw[:maxBytes]
	}
	return raw, nil
}

func (r *Runtime) ListFiles(ctx context.Context, session *sandboxruntime.Session, root string, recursive bool, limit int) ([]sandboxruntime.Artifact, error) {
	release, err := r.beginSessionUse(session)
	if err != nil {
		return nil, err
	}
	defer release()
	rootDir := filepath.Join(session.Mounts.WorkspaceRoot, root)
	if !recursive {
		ents, err := os.ReadDir(rootDir)
		if err != nil {
			return nil, err
		}
		out := make([]sandboxruntime.Artifact, 0, len(ents))
		for _, ent := range ents {
			info, err := ent.Info()
			if err != nil {
				return nil, err
			}
			rel, _ := filepath.Rel(session.Mounts.WorkspaceRoot, filepath.Join(rootDir, ent.Name()))
			out = append(out, sandboxruntime.Artifact{
				Path:        filepath.ToSlash(rel),
				FileName:    ent.Name(),
				ContentType: sandboxruntime.DetectMimeType(ent.Name()),
				Size:        info.Size(),
			})
			if limit > 0 && len(out) >= limit {
				break
			}
		}
		return out, nil
	}
	arts := make([]sandboxruntime.Artifact, 0)
	err = filepath.WalkDir(rootDir, func(path string, d os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if path == rootDir {
			return nil
		}
		rel, relErr := filepath.Rel(session.Mounts.WorkspaceRoot, path)
		if relErr != nil {
			return relErr
		}
		artifact := sandboxruntime.Artifact{
			Path:        filepath.ToSlash(rel),
			FileName:    d.Name(),
			ContentType: sandboxruntime.DetectMimeType(path),
		}
		if !d.IsDir() {
			info, infoErr := d.Info()
			if infoErr != nil {
				return infoErr
			}
			artifact.Size = info.Size()
		}
		arts = append(arts, artifact)
		if limit > 0 && len(arts) >= limit {
			return io.EOF
		}
		return nil
	})
	if err != nil && !errors.Is(err, io.EOF) {
		return nil, err
	}
	return arts, nil
}

func (r *Runtime) RunCommand(ctx context.Context, session *sandboxruntime.Session, req sandboxruntime.CommandRequest, stream func(sandboxruntime.StreamEvent)) (*sandboxruntime.CommandResult, error) {
	release, err := r.beginSessionUse(session)
	if err != nil {
		return nil, err
	}
	defer release()
	bridge := r.getFsBridge(session)
	cwd := req.Cwd
	if strings.TrimSpace(cwd) == "" {
		cwd = r.cfg.ContainerWorkdir
	}
	cwd = bridge.ContainerPath(cwd)
	timeout := time.Duration(req.TimeoutSeconds) * time.Second
	if timeout <= 0 {
		timeout = time.Duration(r.cfg.TimeoutSeconds) * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	args := []string{"exec"}
	for k, v := range req.Env {
		args = append(args, "-e", k+"="+v)
	}
	args = append(args, "-w", cwd, session.ProviderID, "sh", "-lc", req.Command)
	cmd := exec.CommandContext(ctx, "docker", args...)
	var stdout, stderr strings.Builder
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	runErr := cmd.Run()
	exitCode := 0
	if runErr != nil {
		if exitErr, ok := runErr.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		} else {
			return nil, runErr
		}
	}
	if stream != nil {
		stream(sandboxruntime.StreamEvent{Type: "tool.completed", Data: map[string]interface{}{"exit_code": exitCode}})
	}
	return &sandboxruntime.CommandResult{Stdout: stdout.String(), Stderr: stderr.String(), ExitCode: exitCode}, nil
}

func (r *Runtime) ExportArtifact(ctx context.Context, session *sandboxruntime.Session, artifact sandboxruntime.Artifact) (io.ReadCloser, error) {
	release, err := r.beginSessionUse(session)
	if err != nil {
		return nil, err
	}
	defer release()
	normalized, err := sandboxruntime.ResolveRelPath(session.Mounts.WorkspaceRoot, artifact.Path)
	if err != nil {
		return nil, err
	}
	return os.Open(normalized)
}

func (r *Runtime) Pause(ctx context.Context, session *sandboxruntime.Session) error {
	release, err := r.beginSessionUse(session)
	if err != nil {
		return err
	}
	defer release()
	session.State = "paused"
	return nil
}

func (r *Runtime) Kill(ctx context.Context, session *sandboxruntime.Session) error {
	if session == nil {
		return sandboxruntime.ErrSessionRequired
	}
	_ = r.killContainer(ctx, session.ProviderID)
	r.mu.Lock()
	delete(r.sessions, session.ID)
	r.mu.Unlock()
	session.State = "killed"
	return nil
}

func (r *Runtime) CloseAll(ctx context.Context) error {
	r.stopIdleReaper()
	r.mu.Lock()
	sessions := make([]*sandboxruntime.Session, 0, len(r.sessions))
	for _, state := range r.sessions {
		if state == nil || state.session == nil {
			continue
		}
		sessions = append(sessions, state.session)
	}
	r.sessions = map[string]*sessionState{}
	r.mu.Unlock()
	var errs []string
	for _, session := range sessions {
		if session == nil {
			continue
		}
		if err := r.killContainer(ctx, session.ProviderID); err != nil {
			errs = append(errs, err.Error())
		}
		session.State = "killed"
	}
	if len(errs) > 0 {
		return errors.New(strings.Join(errs, "; "))
	}
	return nil
}
