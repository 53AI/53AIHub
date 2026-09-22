package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/actionruntime"
	"github.com/53AI/53AIHub/service/actionruntime/codex"
	"github.com/53AI/53AIHub/service/actionsystem"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	ActionTypeCreateDOCX  = "create_docx"
	ActionTypeExecutePlan = "execute_plan"
	maxActionTitle        = 160
	maxActionPrompt       = 16000
	maxActionSnapshot     = 256 * 1024
	maxActionPayload      = 256 * 1024
)

var (
	ErrActionNotFound         = errors.New("action action not found")
	ErrActionRunNotFound      = errors.New("action run not found")
	ErrActionArtifactNotFound = errors.New("action artifact not found")
	ErrActionForbidden        = errors.New("action action is not accessible")
	ErrActionState            = errors.New("action action state does not allow this operation")
	ErrActionRunState         = errors.New("action run state does not allow this operation")
	// ErrRefinementAlreadyRunning：已有运行中的 refinement Run，且本次 feedback 与它不同。
	ErrRefinementAlreadyRunning   = errors.New("refinement already running")
	ErrActionRuntimeDisabled      = errors.New("action runtime is disabled")
	ErrActionRuntimeNotConfigured = errors.New("action runtime is not configured")
	ErrActionInsightNotReady      = errors.New("meeting insight is not ready")
	ErrActionInsightChanged       = errors.New("meeting insight changed after action draft")
	ErrActionInvalidRequest       = errors.New("invalid action request")
	ErrActionRunNotActive         = errors.New("action run is not active in this process")
	ErrActionPreviewUnavailable   = errors.New("action artifact preview is unavailable")
)

type InsightActionContextSnapshot struct {
	Version           int64                      `json:"version"`
	SourceType        string                     `json:"source_type,omitempty"`
	SourceID          string                     `json:"source_id,omitempty"`
	SourceFileID      int64                      `json:"source_file_id"`
	InsightGeneration int64                      `json:"insight_generation"`
	InsightSummary    string                     `json:"insight_summary"`
	ContextLabel      string                     `json:"context_label,omitempty"`
	Background        InsightBackground          `json:"background"`
	SourceRefs        []actionsystem.SourceRef   `json:"source_refs,omitempty"`
	EvidenceRefs      []actionsystem.EvidenceRef `json:"evidence_refs,omitempty"`
	CapturedAt        int64                      `json:"captured_at"`
}

type ActionRuntimeConfig struct {
	Enabled               bool
	Binary                string
	CodexHome             string
	MinCodexVersion       string
	CodexModel            string
	InstanceID            string
	WorkRoot              string
	ArtifactRoot          string
	PreviewRoot           string
	PreviewBinary         string
	Sandbox               string
	ApprovalPolicy        string
	Timeout               time.Duration
	TurnIdleTimeout       time.Duration
	ActionBudget          time.Duration
	ReasoningEffort       string
	DeepResearchReasoning string
	ResultSpecVersion     string
	TemplateVersion       string
	ArtifactRetentionDays int
	CleanupInterval       time.Duration
}

func ActionRuntimeConfigFromEnv() ActionRuntimeConfig {
	return ActionRuntimeConfig{
		Enabled:               envBool("ACTION_RUNTIME_CODEX_ENABLED", false),
		Binary:                envString("ACTION_RUNTIME_CODEX_BINARY", "codex"),
		CodexHome:             strings.TrimSpace(os.Getenv("ACTION_RUNTIME_CODEX_HOME")),
		MinCodexVersion:       strings.TrimSpace(os.Getenv("ACTION_RUNTIME_CODEX_MIN_VERSION")),
		CodexModel:            strings.TrimSpace(os.Getenv("ACTION_RUNTIME_CODEX_MODEL")),
		InstanceID:            envString("ACTION_RUNTIME_INSTANCE_ID", actionRuntimeDefaultInstanceID()),
		WorkRoot:              strings.TrimSpace(os.Getenv("ACTION_RUNTIME_WORK_ROOT")),
		ArtifactRoot:          strings.TrimSpace(os.Getenv("ACTION_RUNTIME_ARTIFACT_ROOT")),
		PreviewRoot:           strings.TrimSpace(os.Getenv("ACTION_RUNTIME_PREVIEW_ROOT")),
		PreviewBinary:         envString("ACTION_RUNTIME_PREVIEW_BINARY", "libreoffice"),
		Sandbox:               envString("ACTION_RUNTIME_CODEX_SANDBOX", "workspace-write"),
		ApprovalPolicy:        envString("ACTION_RUNTIME_CODEX_APPROVAL_POLICY", "on-request"),
		Timeout:               time.Duration(envInt("ACTION_RUNTIME_TIMEOUT_SECONDS", 1200)) * time.Second,
		TurnIdleTimeout:       time.Duration(envInt("ACTION_RUNTIME_TURN_IDLE_SECONDS", 600)) * time.Second,
		ActionBudget:          time.Duration(envInt("ACTION_RUNTIME_ACTION_BUDGET_SECONDS", 900)) * time.Second,
		ReasoningEffort:       envString("ACTION_RUNTIME_REASONING_EFFORT", "medium"),
		DeepResearchReasoning: envString("ACTION_RUNTIME_DEEP_RESEARCH_REASONING_EFFORT", "high"),
		ResultSpecVersion:     envString("ACTION_RUNTIME_RESULT_SPEC_VERSION", "result-spec-v1"),
		TemplateVersion:       envString("ACTION_RUNTIME_TEMPLATE_VERSION", "template-v1"),
		ArtifactRetentionDays: envInt("ACTION_RUNTIME_ARTIFACT_RETENTION_DAYS", 0),
		CleanupInterval:       time.Duration(envInt("ACTION_RUNTIME_CLEANUP_INTERVAL_SECONDS", 3600)) * time.Second,
	}
}

// actionRuntimeDefaultInstanceID identifies this process for logging only; V1 has
// no lease table, so it is never used for ownership arbitration.
func actionRuntimeDefaultInstanceID() string {
	host, err := os.Hostname()
	if err != nil || strings.TrimSpace(host) == "" {
		host = "unknown-host"
	}
	return fmt.Sprintf("%s:%d", host, os.Getpid())
}

type ActionView struct {
	ActionID          string   `json:"action_id"`
	FileID            string   `json:"file_id"`
	ActionType        string   `json:"action_type"`
	Status            string   `json:"status"`
	Title             string   `json:"title"`
	Prompt            string   `json:"prompt"`
	ExpectedArtifacts []string `json:"expected_artifacts"`
	Runtime           string   `json:"runtime"`
	LastRunID         string   `json:"last_run_id,omitempty"`
	ConfirmedAt       int64    `json:"confirmed_at,omitempty"`
	ErrorCode         string   `json:"error_code,omitempty"`
	ErrorMessage      string   `json:"error_message,omitempty"`
	CreatedTime       int64    `json:"created_time"`
	UpdatedTime       int64    `json:"updated_time"`
}

type ActionRunView struct {
	RunID           string `json:"run_id"`
	ActionID        string `json:"action_id"`
	PlanID          string `json:"plan_id,omitempty"`
	Status          string `json:"status"`
	Runtime         string `json:"runtime"`
	RuntimeThreadID string `json:"runtime_thread_id,omitempty"`
	LastSeq         int64  `json:"last_seq"`
	ErrorCode       string `json:"error_code,omitempty"`
	ErrorMessage    string `json:"error_message,omitempty"`
	StartedAt       int64  `json:"started_at,omitempty"`
	LastActivityAt  int64  `json:"last_activity_at,omitempty"`
	FinishedAt      int64  `json:"finished_at,omitempty"`
	CreatedTime     int64  `json:"created_time"`
	UpdatedTime     int64  `json:"updated_time"`
}

type ActionArtifactView struct {
	ArtifactID       string `json:"artifact_id"`
	Name             string `json:"name"`
	MimeType         string `json:"mime_type"`
	Size             int64  `json:"size"`
	DownloadURL      string `json:"download_url"`
	PreviewURL       string `json:"preview_url,omitempty"`
	PreviewStatus    string `json:"preview_status,omitempty"`
	PreviewErrorCode string `json:"preview_error_code,omitempty"`
}

type ActionEventView struct {
	Seq            int64               `json:"seq"`
	EventID        string              `json:"event_id,omitempty"`
	Type           string              `json:"type"`
	Runtime        string              `json:"runtime"`
	ExternalID     string              `json:"external_id,omitempty"`
	ExternalMethod string              `json:"external_method,omitempty"`
	ErrorCode      string              `json:"error_code,omitempty"`
	ErrorMessage   string              `json:"error_message,omitempty"`
	Delta          string              `json:"delta,omitempty"`
	Payload        map[string]any      `json:"payload,omitempty"`
	Artifact       *ActionArtifactView `json:"artifact,omitempty"`
	Preview        *ActionArtifactView `json:"preview,omitempty"`
	CreatedAt      int64               `json:"created_at"`
}

type ActionRunStartView struct {
	Action *ActionView    `json:"action"`
	Run    *ActionRunView `json:"run"`
}

type ActionRunReplayView struct {
	Run    *ActionRunView     `json:"run"`
	Events []*ActionEventView `json:"events"`
}

type actionRuntimeAdapterFactory func(ActionRuntimeConfig, actionRuntimeProfile) actionruntime.RuntimeAdapter

// actionRuntimeProfile is the per-Action execution profile. It only decides how
// much reasoning budget the runtime may spend; it never changes the confirmed
// objective or the deliverable.
type actionRuntimeProfile struct {
	ActionType      string
	ReasoningEffort string
	CommandArgs     []string
}

func actionRuntimeProfileFor(ctx context.Context, config ActionRuntimeConfig, action *model.ActionRecord) actionRuntimeProfile {
	actionType := ""
	if action != nil {
		actionType = action.ActionType
	}
	effort := strings.TrimSpace(config.ReasoningEffort)
	if action != nil && taskNeedsDeepResearch(ctx, action) {
		if deep := strings.TrimSpace(config.DeepResearchReasoning); deep != "" {
			effort = deep
		}
	}
	profile := actionRuntimeProfile{ActionType: actionType, ReasoningEffort: effort}
	// 注意：codex app-server 不支持 --ignore-user-config（仅 exec 支持），因此隔离必须由
	// 专用 CODEX_HOME 承担——该目录只放 auth.json + 最小 config.toml，不放个人 MCP/plugin/trust；
	// 需要的工具将来按 Action Capability 显式开放。
	args := []string{"app-server", "--stdio"}
	if effort != "" {
		args = append(args, "-c", "model_reasoning_effort="+effort)
	}
	if model := strings.TrimSpace(config.CodexModel); model != "" {
		args = append(args, "-c", "model="+model)
	}
	profile.CommandArgs = args
	return profile
}

// taskNeedsDeepResearch reports whether the confirmed plan requires the public
// web research capability, which is the only Action class allowed a higher
// reasoning budget in V1.
func taskNeedsDeepResearch(ctx context.Context, action *model.ActionRecord) bool {
	if action == nil || action.ActionType != ActionTypeExecutePlan {
		return false
	}
	plan, err := model.GetActionPlanByActionID(ctx, action.Eid, action.ActionID)
	if err != nil {
		return false
	}
	aggregate, err := model.GetActionPlanForUser(ctx, action.Eid, action.OwnerID, plan.PlanID)
	if err != nil {
		return false
	}
	for _, permission := range aggregate.Permissions {
		if permission != nil && permission.Capability == actionsystem.CapabilityDeepResearch {
			return true
		}
	}
	return false
}

// liveActionRun 是本进程持有的活跃 Run。它在 Run 启动的最前面就注册，因为取消
// 请求可能在 StartSession / StartTurn 返回之前到达：此时只能靠 budget context
// 生效，runtime turn 还不存在。
type liveActionRun struct {
	mu           sync.Mutex
	orchestrator *actionruntime.Orchestrator
	execution    *actionruntime.Execution
	cancel       context.CancelFunc
}

func (l *liveActionRun) attachOrchestrator(orchestrator *actionruntime.Orchestrator) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.orchestrator = orchestrator
}

func (l *liveActionRun) setExecution(execution *actionruntime.Execution) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.execution = execution
}

// cancelTurn 取消 runtime turn；Run 还在启动阶段（没有 execution）时是无操作。
func (l *liveActionRun) cancelTurn(ctx context.Context) error {
	l.mu.Lock()
	orchestrator, execution := l.orchestrator, l.execution
	l.mu.Unlock()
	if orchestrator == nil || execution == nil {
		return nil
	}
	return orchestrator.Cancel(ctx, execution)
}

type ActionRuntimeService struct {
	config               func() ActionRuntimeConfig
	adapterFactory       actionRuntimeAdapterFactory
	opportunityGenerator actionOpportunityGenerator
	lifecycleMu          sync.RWMutex
	lifecycleCtx         context.Context
	liveMu               sync.RWMutex
	live                 map[string]*liveActionRun
}

func NewActionRuntimeService() *ActionRuntimeService {
	return &ActionRuntimeService{
		config: ActionRuntimeConfigFromEnv,
		adapterFactory: func(config ActionRuntimeConfig, profile actionRuntimeProfile) actionruntime.RuntimeAdapter {
			return codex.NewAdapter(codex.Config{
				Binary:         config.Binary,
				CommandArgs:    profile.CommandArgs,
				WorkDir:        config.WorkRoot,
				Sandbox:        config.Sandbox,
				ApprovalPolicy: config.ApprovalPolicy,
				Ephemeral:      true,
				MinVersion:     config.MinCodexVersion,
				Env:            actionRuntimeCodexEnv(config.CodexHome),
			})
		},
		opportunityGenerator: newLLMActionOpportunityGenerator(),
		lifecycleCtx:         context.Background(),
		live:                 make(map[string]*liveActionRun),
	}
}

func actionRuntimeCodexEnv(codexHome string) []string {
	if strings.TrimSpace(codexHome) == "" {
		return nil
	}
	return []string{"CODEX_HOME=" + codexHome}
}

func NewActionRuntimeServiceForTest(config ActionRuntimeConfig, adapter actionruntime.RuntimeAdapter) *ActionRuntimeService {
	return &ActionRuntimeService{
		config:               func() ActionRuntimeConfig { return config },
		adapterFactory:       func(ActionRuntimeConfig, actionRuntimeProfile) actionruntime.RuntimeAdapter { return adapter },
		opportunityGenerator: newLLMActionOpportunityGenerator(),
		lifecycleCtx:         context.Background(),
		live:                 make(map[string]*liveActionRun),
	}
}

var defaultActionRuntimeService = NewActionRuntimeService()

func DefaultActionRuntimeService() *ActionRuntimeService { return defaultActionRuntimeService }

func BindActionRuntimeLifecycle(ctx context.Context) {
	defaultActionRuntimeService.SetLifecycleContext(ctx)
}

func (s *ActionRuntimeService) SetLifecycleContext(ctx context.Context) {
	if s == nil {
		return
	}
	if ctx == nil {
		ctx = context.Background()
	}
	s.lifecycleMu.Lock()
	s.lifecycleCtx = ctx
	s.lifecycleMu.Unlock()
}

func (s *ActionRuntimeService) lifecycleContext() context.Context {
	s.lifecycleMu.RLock()
	defer s.lifecycleMu.RUnlock()
	if s.lifecycleCtx == nil {
		return context.Background()
	}
	return s.lifecycleCtx
}

// RecoverActionRunsAfterRestart fails runs that cannot be safely resumed by
// this process. The durable failure event makes the state replayable and the
// action retry endpoint provides an explicit new Run; it never pretends to
// continue a Codex process that no longer exists.
func RecoverActionRunsAfterRestart(ctx context.Context) error {
	if model.DB == nil || !model.DB.Migrator().HasTable(&model.ActionRunRecord{}) {
		return nil
	}
	runs, err := model.ListActionRunsByStatuses(ctx, []string{
		model.ActionRunStatusQueued,
		model.ActionRunStatusRunning,
	})
	if err != nil {
		return err
	}
	for _, run := range runs {
		if err := persistActionRunFailure(ctx, run, actionruntime.ErrorCode("runtime_restarted"), "action runtime process restarted before the run completed"); err != nil {
			return err
		}
	}
	return nil
}

func (s *ActionRuntimeService) activeRunForAction(ctx context.Context, eid int64, actionID string) (*model.ActionRunRecord, error) {
	runs, err := model.ListActionRunsByAction(ctx, eid, actionID)
	if err != nil {
		return nil, err
	}
	for i := len(runs) - 1; i >= 0; i-- {
		if !model.IsActionRunStatusTerminal(runs[i].Status) {
			return runs[i], nil
		}
	}
	return nil, nil
}

// RefineActionRun 针对 completed Run 发起返工：幂等只合并"同一 feedback 的重复请求"。
// 已有活跃 refinement Run 时：同一 feedback 返回该 Run；不同 feedback 返回
// ErrRefinementAlreadyRunning（409 refinement_already_running），不静默吞掉新指令。
func (s *ActionRuntimeService) RefineActionRun(ctx context.Context, eid, userID int64, runID, feedback string) (*ActionRunStartView, error) {
	run, err := model.GetActionRunForUser(ctx, eid, userID, strings.TrimSpace(runID))
	if err != nil {
		return nil, mapActionNotFound(err, ErrActionRunNotFound)
	}
	if run.Status != model.ActionRunStatusCompleted {
		return nil, ErrActionRunState
	}
	feedback = strings.TrimSpace(feedback)
	if feedback == "" {
		return nil, ErrActionInvalidRequest
	}
	action, err := model.GetActionForUser(ctx, eid, userID, run.ActionID)
	if err != nil {
		return nil, mapActionNotFound(err, ErrActionNotFound)
	}
	active, err := s.activeRunForAction(ctx, eid, action.ActionID)
	if err != nil {
		return nil, err
	}
	if active != nil {
		if strings.TrimSpace(string(active.RefinementFeedback)) != feedback {
			return nil, ErrRefinementAlreadyRunning
		}
		actionView, viewErr := s.actionView(action)
		if viewErr != nil {
			return nil, viewErr
		}
		runView, viewErr := s.runView(ctx, active)
		if viewErr != nil {
			return nil, viewErr
		}
		return &ActionRunStartView{Action: actionView, Run: runView}, nil
	}
	return s.startActionRun(ctx, eid, userID, action.ActionID, runStartOptions{
		reason:                "refine",
		allowedActionStatuses: []string{model.ActionStatusAwaitingReview},
		feedback:              feedback,
	})
}

// RetryActionRun retries a failed or cancelled execution as a new Run.
// ActionAggregateView 是 Action 的聚合读取结果：Action + Plan + Run + 产物 + 成果。
type ActionAggregateView struct {
	Action      *ActionView            `json:"action"`
	Plan        *ActionPlanView        `json:"plan,omitempty"`
	Runs        []*ActionRunView       `json:"runs"`
	LatestRun   *ActionRunView         `json:"latest_run,omitempty"`
	Artifacts   []*ActionArtifactView  `json:"artifacts,omitempty"`
	ResultAsset *ActionResultAssetView `json:"result_asset,omitempty"`
	// SourceLinks 是 Action 的原始会议来源入口（与 Plan 内同一批来源，顶层投影
	// 便于客户端统一消费；Plan 为 nil 的裸 Action 不下发）。
	SourceLinks []*ActionSourceLinkView `json:"source_links,omitempty"`
}

// GetAction 是 Action 的唯一读取入口（聚合）。
func (s *ActionRuntimeService) GetAction(ctx context.Context, eid, userID int64, actionID string) (*ActionAggregateView, error) {
	action, err := model.GetActionForUser(ctx, eid, userID, strings.TrimSpace(actionID))
	if err != nil {
		return nil, mapActionNotFound(err, ErrActionNotFound)
	}
	actionView, err := s.actionView(action)
	if err != nil {
		return nil, err
	}
	view := &ActionAggregateView{Action: actionView}
	if plan, planErr := model.GetActionPlanByActionID(ctx, eid, action.ActionID); planErr == nil {
		aggregate, aggregateErr := model.GetActionPlanForUser(ctx, eid, userID, plan.PlanID)
		if aggregateErr != nil {
			return nil, aggregateErr
		}
		planView, viewErr := s.actionPlanView(ctx, eid, userID, aggregate)
		if viewErr != nil {
			return nil, viewErr
		}
		view.Plan = planView
		view.SourceLinks = planView.SourceLinks
	} else if !errors.Is(planErr, gorm.ErrRecordNotFound) {
		return nil, planErr
	}
	runs, err := model.ListActionRunsByAction(ctx, eid, action.ActionID)
	if err != nil {
		return nil, err
	}
	for _, run := range runs {
		runView, viewErr := s.runView(ctx, run)
		if viewErr != nil {
			return nil, viewErr
		}
		view.Runs = append(view.Runs, runView)
	}
	if len(view.Runs) == 0 {
		return view, nil
	}
	view.LatestRun = view.Runs[len(view.Runs)-1]
	artifacts, err := model.ListActionArtifactsByRun(ctx, eid, view.LatestRun.RunID)
	if err != nil {
		return nil, err
	}
	for _, artifact := range artifacts {
		if artifactView := artifactView(view.LatestRun.RunID, artifact); artifactView != nil {
			view.Artifacts = append(view.Artifacts, artifactView)
		}
	}
	asset, assetErr := model.GetActionResultAssetByRunForUser(ctx, eid, userID, view.LatestRun.RunID)
	if assetErr != nil {
		if errors.Is(assetErr, gorm.ErrRecordNotFound) {
			return view, nil
		}
		return nil, assetErr
	}
	assetView, viewErr := s.actionResultAssetView(ctx, asset)
	if viewErr != nil {
		return nil, viewErr
	}
	view.ResultAsset = assetView
	return view, nil
}

func (s *ActionRuntimeService) RetryActionRun(ctx context.Context, eid, userID int64, runID string) (*ActionRunStartView, error) {
	run, err := model.GetActionRunForUser(ctx, eid, userID, strings.TrimSpace(runID))
	if err != nil {
		return nil, mapActionNotFound(err, ErrActionRunNotFound)
	}
	action, err := model.GetActionForUser(ctx, eid, userID, run.ActionID)
	if err != nil {
		return nil, mapActionNotFound(err, ErrActionNotFound)
	}
	return s.startActionRun(ctx, eid, userID, action.ActionID, runStartOptions{
		reason:                "retry",
		allowedActionStatuses: []string{model.ActionStatusNeedsAttention},
	})
}

type runStartOptions struct {
	reason                string
	planID                string
	allowedActionStatuses []string
	feedback              string
}

// startActionRun creates the one active Run for an Action inside a single
// transaction: the Action moves to executing, the plan is confirmed, and the
// confirmed plan is snapshotted onto the Run. Repeated requests on a weak
// network are idempotent: an existing active Run is returned as-is.
func (s *ActionRuntimeService) startActionRun(ctx context.Context, eid, userID int64, actionID string, options runStartOptions) (*ActionRunStartView, error) {
	action, err := model.GetActionForUser(ctx, eid, userID, strings.TrimSpace(actionID))
	if err != nil {
		return nil, mapActionNotFound(err, ErrActionNotFound)
	}
	if !containsActionStatus(options.allowedActionStatuses, action.Status) {
		return nil, ErrActionState
	}
	if err := validateActionSource(ctx, eid, userID, action); err != nil {
		return nil, err
	}
	runtimeConfig := s.config()
	if err := validateRuntimeConfig(runtimeConfig, action.ActionType); err != nil {
		return nil, err
	}
	// 方案型 Action 一定有 Plan；裸 Action（直接创建的 action）允许没有 Plan。
	// confirm 时 Plan 还没有 action_id，因此按 planID 查找。
	var plan *model.ActionPlanRecord
	var planAggregate *model.ActionPlanAggregate
	if strings.TrimSpace(options.planID) != "" {
		loaded, planErr := model.GetActionPlanForUser(ctx, eid, userID, options.planID)
		if planErr != nil {
			return nil, mapActionNotFound(planErr, ErrActionPlanNotFound)
		}
		plan = loaded.Record
		planAggregate = loaded
	} else if loaded, planErr := model.GetActionPlanByActionID(ctx, eid, action.ActionID); planErr == nil {
		plan = loaded
		aggregate, aggregateErr := model.GetActionPlanForUser(ctx, eid, userID, plan.PlanID)
		if aggregateErr != nil {
			return nil, mapActionNotFound(aggregateErr, ErrActionPlanNotFound)
		}
		planAggregate = aggregate
	} else if !errors.Is(planErr, gorm.ErrRecordNotFound) {
		return nil, planErr
	} else if options.reason == "confirm" && !planExistsForAction(ctx, eid, action.ActionID) {
		// 无方案的裸 Action：允许 confirm，但没有 Plan 需要确认。
		plan = nil
	}
	if plan != nil && options.reason == "confirm" {
		// 幂等：弱网/连点重复 confirm 时，Plan 已经 confirmed，直接返回已有 Run，
		// 不再创建第二个 Run，也不报状态冲突。
		if plan.Status == model.ActionPlanStatusConfirmed {
			runs, listErr := model.ListActionRunsByAction(ctx, eid, action.ActionID)
			if listErr != nil {
				return nil, listErr
			}
			if len(runs) > 0 {
				latest := runs[len(runs)-1]
				actionView, viewErr := s.actionView(action)
				if viewErr != nil {
					return nil, viewErr
				}
				runView, viewErr := s.runView(ctx, latest)
				if viewErr != nil {
					return nil, viewErr
				}
				return &ActionRunStartView{Action: actionView, Run: runView}, nil
			}
		}
		if plan.Status != model.ActionPlanStatusDraft {
			return nil, ErrActionPlanState
		}
	}
	// 幂等 + 资源保护：同一 Action 已有非终态 Run 时，重复的 confirm/retry/refine
	// 直接返回该 Run，不再新建（不并行拉起第二个 Runtime 会话）。
	if existing, reuseErr := s.activeRunForAction(ctx, eid, action.ActionID); reuseErr != nil {
		return nil, reuseErr
	} else if existing != nil {
		actionView, viewErr := s.actionView(action)
		if viewErr != nil {
			return nil, viewErr
		}
		runView, viewErr := s.runView(ctx, existing)
		if viewErr != nil {
			return nil, viewErr
		}
		return &ActionRunStartView{Action: actionView, Run: runView}, nil
	}
	runID, err := model.GenerateActionRunID()
	if err != nil {
		return nil, err
	}
	// 每次启动 Run 都按 Plan 重新计算 canonical 主交付物：retry / refine 不继承
	// 旧 Run 里写死的 action-result.docx。
	expectedJSON := string(action.ExpectedArtifactsJSON)
	if planAggregate != nil {
		if contract, contractErr := canonicalPrimaryArtifact(planAggregate); contractErr == nil {
			expectedJSON = expectedArtifactsJSON(contract.Filename)
		}
	}
	now := time.Now().UTC().UnixMilli()
	run := &model.ActionRunRecord{
		RunID: runID, ActionID: action.ActionID, Eid: eid, Status: model.ActionRunStatusQueued, Runtime: action.Runtime,
		PlanID:           planIDOf(plan),
		PlanSnapshotJSON: model.LongText(buildActionPlanSnapshot(planAggregate)),
	}
	if options.reason == "refine" {
		run.RefinementFeedback = model.LongText(options.feedback)
	}
	prompt := string(action.Prompt)
	if options.feedback != "" {
		prompt = prompt + "\n\n<user_refinement_feedback>\n" + options.feedback + "\n</user_refinement_feedback>\n请在保持目标、范围与交付物不变的前提下，按上述反馈重做本次交付。"
	}
	err = model.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// 行锁：并发/弱网重复请求在同一 Action 上串行，只会有一个 Run 被创建。
		var locked model.ActionRecord
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("eid = ? AND owner_id = ? AND action_id = ?", eid, userID, action.ActionID).First(&locked).Error; err != nil {
			return err
		}
		if !containsActionStatus(options.allowedActionStatuses, locked.Status) {
			return ErrActionState
		}
		var active model.ActionRunRecord
		if err := tx.Where("eid = ? AND action_id = ? AND status IN ?", eid, action.ActionID, []string{model.ActionRunStatusQueued, model.ActionRunStatusRunning}).
			Order("id ASC").First(&active).Error; err == nil {
			run = &active
			return nil
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if err := tx.Create(run).Error; err != nil {
			return err
		}
		if options.reason == "confirm" && plan != nil {
			// 机会期产生的证据以关系表形式继承给 Action；不做 JSON 副本。
			if err := model.CloneActionEvidenceRefs(tx, eid, model.ActionEvidenceOwnerOpportunity, plan.OpportunityID, model.ActionEvidenceOwnerAction, action.ActionID); err != nil {
				return err
			}
			result := tx.Model(&model.ActionPlanRecord{}).
				Where("eid = ? AND owner_id = ? AND plan_id = ? AND status = ?", eid, userID, plan.PlanID, model.ActionPlanStatusDraft).
				Updates(map[string]interface{}{"action_id": action.ActionID, "status": model.ActionPlanStatusConfirmed, "confirmed_by": userID, "confirmed_at": now})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return ErrActionPlanState
			}
		}
		return tx.Model(&model.ActionRecord{}).Where("eid = ? AND owner_id = ? AND action_id = ?", eid, userID, action.ActionID).
			Updates(map[string]interface{}{
				"status":                  model.ActionStatusExecuting,
				"last_run_id":             run.RunID,
				"prompt":                  model.LongText(prompt),
				"expected_artifacts_json": model.LongText(expectedJSON),
				"confirmed_by":            userID,
				"confirmed_at":            now,
			}).Error
	})
	if err != nil {
		return nil, err
	}
	action.Status = model.ActionStatusExecuting
	action.LastRunID = run.RunID
	action.ExpectedArtifactsJSON = model.LongText(expectedJSON)
	if run.ActionID != action.ActionID || run.Status != model.ActionRunStatusQueued {
		// 幂等返回：已存在 active Run，不再启动执行。
		actionView, viewErr := s.actionView(action)
		if viewErr != nil {
			return nil, viewErr
		}
		runView, viewErr := s.runView(ctx, run)
		if viewErr != nil {
			return nil, viewErr
		}
		return &ActionRunStartView{Action: actionView, Run: runView}, nil
	}
	go s.execute(action, run, runtimeConfig)
	actionView, err := s.actionView(action)
	if err != nil {
		return nil, err
	}
	runView, err := s.runView(ctx, run)
	if err != nil {
		return nil, err
	}
	return &ActionRunStartView{Action: actionView, Run: runView}, nil
}

func planIDOf(plan *model.ActionPlanRecord) string {
	if plan == nil {
		return ""
	}
	return plan.PlanID
}

// planExistsForAction distinguishes "no plan was ever created" from a plan lookup
// error.
func planExistsForAction(ctx context.Context, eid int64, actionID string) bool {
	_, err := model.GetActionPlanByActionID(ctx, eid, actionID)
	return err == nil
}

// buildActionPlanSnapshot freezes the confirmed plan on the Run for audit.
func buildActionPlanSnapshot(aggregate *model.ActionPlanAggregate) string {
	if aggregate == nil || aggregate.Record == nil {
		return "{}"
	}
	steps := make([]map[string]any, 0, len(aggregate.ExecutionSteps))
	for _, step := range aggregate.ExecutionSteps {
		if step != nil {
			steps = append(steps, map[string]any{"order": step.StepOrder, "title": step.Title, "description": step.Description})
		}
	}
	deliverables := make([]map[string]any, 0, len(aggregate.Deliverables))
	for _, item := range aggregate.Deliverables {
		if item != nil {
			deliverables = append(deliverables, map[string]any{"type": item.Type, "title": item.Title, "format": item.Format, "is_primary": item.IsPrimary})
		}
	}
	acceptance := make([]map[string]any, 0, len(aggregate.AcceptanceCriteria))
	for _, item := range aggregate.AcceptanceCriteria {
		if item != nil {
			acceptance = append(acceptance, map[string]any{"order": item.CriterionOrder, "description": item.Description})
		}
	}
	snapshot := map[string]any{
		"plan_id": aggregate.Record.PlanID, "revision": aggregate.Record.Revision,
		"objective": aggregate.Record.Objective, "background": aggregate.Record.Background, "scope": aggregate.Record.Scope,
		"steps": steps, "deliverables": deliverables, "acceptance_criteria": acceptance,
		"confirmed_at": aggregate.Record.ConfirmedAt,
	}
	encoded, err := json.Marshal(snapshot)
	if err != nil {
		return "{}"
	}
	return string(encoded)
}

func containsActionStatus(statuses []string, target string) bool {
	for _, status := range statuses {
		if status == target {
			return true
		}
	}
	return false
}

func (s *ActionRuntimeService) GetActionRun(ctx context.Context, eid, userID int64, runID string) (*ActionRunView, error) {
	run, err := model.GetActionRunForUser(ctx, eid, userID, strings.TrimSpace(runID))
	if err != nil {
		return nil, mapActionNotFound(err, ErrActionRunNotFound)
	}
	return s.runView(ctx, run)
}

func (s *ActionRuntimeService) GetActionRunReplay(ctx context.Context, eid, userID int64, runID string, afterSeq int64, limit int) (*ActionRunReplayView, error) {
	run, err := model.GetActionRunForUser(ctx, eid, userID, strings.TrimSpace(runID))
	if err != nil {
		return nil, mapActionNotFound(err, ErrActionRunNotFound)
	}
	events, err := model.GetActionEventsAfterSeq(ctx, eid, run.RunID, afterSeq, limit)
	if err != nil {
		return nil, err
	}
	views, err := s.eventViews(ctx, eid, run.RunID, events)
	if err != nil {
		return nil, err
	}
	runView, err := s.runView(ctx, run)
	if err != nil {
		return nil, err
	}
	return &ActionRunReplayView{Run: runView, Events: views}, nil
}

func (s *ActionRuntimeService) CancelActionRun(ctx context.Context, eid, userID int64, runID string) (*ActionRunView, error) {
	run, err := model.GetActionRunForUser(ctx, eid, userID, strings.TrimSpace(runID))
	if err != nil {
		return nil, mapActionNotFound(err, ErrActionRunNotFound)
	}
	// 幂等：Run 已是终态时直接返回当前状态（含重复 cancel），不报状态冲突。
	if model.IsActionRunStatusTerminal(run.Status) {
		return s.runView(ctx, run)
	}
	live, ok := s.getLive(run.RunID)
	if !ok {
		return nil, ErrActionRunNotActive
	}
	// Run 可能刚注册 live 但 StartTurn 还没返回：此时没有可取消的 runtime turn，
	// 只取消 budget context，Run 由正常链路收敛为 cancelled。
	if err := live.cancelTurn(ctx); err != nil {
		return nil, err
	}
	live.cancel()
	if err := model.DB.WithContext(ctx).Model(&model.ActionRunRecord{}).
		Where("eid = ? AND run_id = ? AND status NOT IN ?", eid, run.RunID, []string{model.ActionRunStatusCompleted, model.ActionRunStatusFailed, model.ActionRunStatusCancelled}).
		Updates(map[string]interface{}{"cancel_requested_at": time.Now().UTC().UnixMilli()}).Error; err != nil {
		return nil, err
	}
	updated, err := model.GetActionRunForUser(ctx, eid, userID, run.RunID)
	if err != nil {
		return nil, err
	}
	return s.runView(ctx, updated)
}

func (s *ActionRuntimeService) GetArtifactFile(ctx context.Context, eid, userID int64, runID, artifactID string, preview bool) (*model.ActionArtifactRecord, error) {
	artifact, err := model.GetActionArtifactForUser(ctx, eid, userID, strings.TrimSpace(runID), strings.TrimSpace(artifactID))
	if err != nil {
		return nil, mapActionNotFound(err, ErrActionArtifactNotFound)
	}
	path := artifact.StoragePath
	runtimeConfig := s.config()
	root := runtimeConfig.ArtifactRoot
	if preview {
		path = artifact.PreviewPath
		root = runtimeConfig.PreviewRoot
		if path == "" {
			return nil, ErrActionPreviewUnavailable
		}
	}
	if !pathWithinActionRuntimeRoot(path, root) {
		return nil, ErrActionArtifactNotFound
	}
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() {
		return nil, ErrActionArtifactNotFound
	}
	return artifact, nil
}

// execute runs one confirmed Action exactly once: a single Codex turn with the
// whole confirmed plan, bounded by the Action budget and an idle watchdog.
// Plan steps are never used as a scheduling unit.
func (s *ActionRuntimeService) execute(action *model.ActionRecord, run *model.ActionRunRecord, runtimeConfig ActionRuntimeConfig) {
	lifecycleCtx := s.lifecycleContext()
	actionBudget := runtimeConfig.ActionBudget
	if actionBudget <= 0 {
		actionBudget = runtimeConfig.Timeout
	}
	ctx, cancel := context.WithTimeout(lifecycleCtx, actionBudget)
	defer cancel()
	if action == nil || run == nil {
		return
	}
	live := &liveActionRun{cancel: cancel}
	s.liveMu.Lock()
	s.live[run.RunID] = live
	s.liveMu.Unlock()
	defer func() {
		s.liveMu.Lock()
		delete(s.live, run.RunID)
		s.liveMu.Unlock()
	}()
	if err := ensureActionRuntimeWorkRoot(runtimeConfig.WorkRoot); err != nil {
		s.failRun(run, actionruntime.ErrorCode("workdir_unavailable"), "action work directory is unavailable")
		return
	}
	workdir, err := os.MkdirTemp(runtimeConfig.WorkRoot, "action-runtime-")
	if err != nil {
		s.failRun(run, actionruntime.ErrorCode("workdir_unavailable"), "action work directory is unavailable")
		return
	}
	defer os.RemoveAll(workdir)
	if _, err := expectedArtifacts(action); err != nil {
		s.failRun(run, actionruntime.ErrorCode("action_contract_invalid"), "expected artifact contract is invalid")
		return
	}
	// 命名与格式的权威是用户确认过的 Plan：每次启动 Run 都重新计算 canonical
	// 主交付物，不继承旧 Run 里写死的 action-result.docx。
	contract, err := s.resolveActionArtifactContract(ctx, action)
	if err != nil {
		logger.SysErrorf("【Action Runtime】主交付物契约无效 run_id=%s action_id=%s err=%v", run.RunID, action.ActionID, err)
		s.failRun(run, actionruntime.ErrorCode("action_contract_invalid"), "primary artifact contract is invalid")
		return
	}
	store, err := actionruntime.NewArtifactStore(runtimeConfig.ArtifactRoot)
	if err != nil {
		s.failRun(run, actionruntime.ErrorCode("artifact_store_unavailable"), "artifact store is unavailable")
		return
	}
	pipeline := actionruntime.NewArtifactPipeline(store, runtimeConfig.PreviewRoot, runtimeConfig.PreviewBinary)
	profile := actionRuntimeProfileFor(ctx, runtimeConfig, action)
	adapter := s.adapterFactory(runtimeConfig, profile)
	if adapter == nil {
		s.failRun(run, actionruntime.ErrorCode("runtime_unavailable"), "action runtime is unavailable")
		return
	}
	if closer, ok := adapter.(interface{ Close() error }); ok {
		defer closer.Close()
	}
	orchestrator, err := actionruntime.NewOrchestrator(adapter, pipeline)
	if err != nil {
		s.failRun(run, actionruntime.ErrorCode("runtime_unavailable"), "action runtime is unavailable")
		return
	}
	runtimeAction := actionruntime.ActionSpec{
		ID:             action.ActionID,
		Name:           action.Title,
		Prompt:         string(action.Prompt),
		WorkDir:        workdir,
		Sandbox:        runtimeConfig.Sandbox,
		ApprovalPolicy: runtimeConfig.ApprovalPolicy,
		Ephemeral:      true,
	}
	session, err := orchestrator.StartSession(ctx, runtimeAction)
	if err != nil {
		code := actionruntime.RuntimeErrorCode(err)
		if code == "" {
			code = actionruntime.ErrorCodeUnknown
		}
		logger.SysErrorf("【Action Runtime】启动 Codex session 失败 run_id=%s action_id=%s code=%s err=%v", run.RunID, action.ActionID, code, err)
		s.failRun(run, code, "Codex action runtime failed to start")
		return
	}
	live.attachOrchestrator(orchestrator)
	startedAt := time.Now().UTC().UnixMilli()
	if err := model.DB.WithContext(ctx).Model(&model.ActionRunRecord{}).Where("eid = ? AND run_id = ?", run.Eid, run.RunID).Updates(map[string]interface{}{
		"status":            model.ActionRunStatusRunning,
		"session_id":        session.ID,
		"runtime_thread_id": session.ExternalID,
		"started_at":        startedAt,
		"last_activity_at":  startedAt,
	}).Error; err != nil {
		s.failRun(run, actionruntime.ErrorCode("run_persistence_failed"), "action run could not be persisted")
		return
	}
	run.Status = model.ActionRunStatusRunning
	s.persistRunMilestone(run, action, actionruntime.EventSessionStarted, "host/session", map[string]any{"thread_id": session.ExternalID})
	s.persistRunMilestone(run, action, actionruntime.EventRunStarted, "host/run", map[string]any{
		"action_type":       action.ActionType,
		"reasoning_effort":  profile.ReasoningEffort,
		"budget_seconds":    int(actionBudget.Seconds()),
		"expected_artifact": contract.Filename,
		"artifact_format":   string(contract.Format),
	})
	turnRun := actionruntime.ActionRun{ID: run.RunID, ActionID: action.ActionID, SessionID: session.ID, Status: actionruntime.RunStatusQueued, LastSeq: run.LastSeq}
	execution, startErr := orchestrator.StartTurn(ctx, runtimeAction, session, turnRun, buildActionPrompt(action, contract))
	if startErr != nil {
		code := actionruntime.RuntimeErrorCode(startErr)
		if code == "" {
			code = actionruntime.ErrorCodeUnknown
		}
		logger.SysErrorf("【Action Runtime】启动 Codex turn 失败 run_id=%s action_id=%s code=%s err=%v", run.RunID, action.ActionID, code, startErr)
		s.failRun(run, code, "Codex action runtime failed to start")
		return
	}
	live.setExecution(execution)
	status, consumeErr := s.consumeRun(ctx, execution, run, action, cancel, runtimeConfig.TurnIdleTimeout)
	if consumeErr != nil {
		if status != model.ActionRunStatusCancelled {
			logger.SysErrorf("【Action Runtime】Run 未正常结束 run_id=%s status=%s err=%v", run.RunID, status, consumeErr)
		}
		return
	}
	if status != model.ActionRunStatusCompleted {
		return
	}
	finalMessage := orchestrator.Normalizer().FinalMessage()
	if err := s.renderHostResult(context.Background(), action, run, runtimeConfig, workdir, contract, finalMessage); err != nil {
		code := actionArtifactDeliveryCode(err)
		// 取证：有界输出最终消息首尾片段，便于判断是围栏/额外字段/截断/非 JSON。
		logger.SysErrorf("【Action Runtime】交付失败 run_id=%s code=%s message_bytes=%d err=%v head=%q tail=%q",
			run.RunID, code, len(finalMessage), err, boundedHead(finalMessage, 200), boundedTail(finalMessage, 200))
		s.failRun(run, code, "Host result rendering failed")
		return
	}
	// 主链不再有 AI 自评：主交付物已由 Host 在交付阶段做确定性校验（存在/唯一/真实格式），
	// 业务价值验收由用户通过 Run 级 accept / refine 完成。
	s.updateRunStatus(context.Background(), run, action, model.ActionRunStatusCompleted, "", "")
}

// consumeRun drains one runtime turn. The turn's budget is the remaining Action
// budget; the idle watchdog only fires when the runtime stops producing events.
func (s *ActionRuntimeService) consumeRun(ctx context.Context, execution *actionruntime.Execution, run *model.ActionRunRecord, action *model.ActionRecord, cancel context.CancelFunc, idleTimeout time.Duration) (string, error) {
	idle := startIdleWatchdog(idleTimeout)
	defer stopIdleWatchdog(idle)
	for {
		select {
		case <-idleWatchdogChannel(idle):
			cancel()
			s.failRun(run, actionruntime.ErrorCode("turn_idle_timeout"), "the runtime produced no events within the idle budget")
			return model.ActionRunStatusFailed, errors.New("action turn produced no events within the idle budget")
		case event, ok := <-execution.Events:
			if !ok {
				if run.Status == model.ActionRunStatusCompleted || run.Status == model.ActionRunStatusFailed || run.Status == model.ActionRunStatusCancelled {
					return run.Status, nil
				}
				s.failRun(run, actionruntime.ErrorCodeRuntimeExited, "action runtime ended without a terminal event")
				return model.ActionRunStatusFailed, errors.New("action runtime ended without a terminal event")
			}
			resetIdleWatchdog(idle, idleTimeout)
			eventCtx := ctx
			if ctx.Err() != nil {
				eventCtx = context.Background()
			}
			if err := s.persistActionEvent(eventCtx, run, action, event); err != nil {
				logger.SysErrorf("【Action Runtime】保存事件失败: run_id=%s seq=%d type=%s err=%v", run.RunID, event.Seq, event.Type, err)
				s.failRun(run, actionruntime.ErrorCode("event_persistence_failed"), "action event could not be persisted")
				return model.ActionRunStatusFailed, err
			}
			if event.Diagnostic != "" {
				logger.SysErrorf("【Action Runtime】工具失败诊断 run_id=%s seq=%d %s", run.RunID, event.Seq, event.Diagnostic)
			}
			if event.Seq > run.LastSeq {
				run.LastSeq = event.Seq
			}
			_ = model.DB.WithContext(eventCtx).Model(&model.ActionRunRecord{}).Where("eid = ? AND run_id = ?", run.Eid, run.RunID).
				Update("last_activity_at", time.Now().UTC().UnixMilli()).Error
			switch event.Type {
			case actionruntime.EventTurnCompleted:
				run.Status = model.ActionRunStatusCompleted
				return model.ActionRunStatusCompleted, nil
			case actionruntime.EventTurnFailed:
				code := event.ErrorCode
				if code == "" {
					code = string(actionruntime.ErrorCodeUnknown)
				}
				s.failRun(run, actionruntime.ErrorCode(code), "Codex turn failed")
				run.Status = model.ActionRunStatusFailed
				return model.ActionRunStatusFailed, nil
			case actionruntime.EventRunCancelled:
				s.updateRunStatus(eventCtx, run, action, model.ActionRunStatusCancelled, event.ErrorCode, event.ErrorMessage)
				return model.ActionRunStatusCancelled, nil
			case actionruntime.EventRunFailed:
				code := event.ErrorCode
				if code == "" {
					code = string(actionruntime.ErrorCodeUnknown)
				}
				s.failRun(run, actionruntime.ErrorCode(code), "Codex run failed")
				run.Status = model.ActionRunStatusFailed
				return model.ActionRunStatusFailed, nil
			}
		}
	}
}

// persistRunMilestone records a host-owned lifecycle event. Milestones are the
// events replay, progress rendering and recovery rely on.
func (s *ActionRuntimeService) persistRunMilestone(run *model.ActionRunRecord, action *model.ActionRecord, eventType actionruntime.EventType, method string, payload map[string]any) {
	if run == nil {
		return
	}
	event := actionruntime.ActionEvent{
		ID:             fmt.Sprintf("%s:%d", run.RunID, run.LastSeq+1),
		Seq:            run.LastSeq + 1,
		Type:           eventType,
		Runtime:        run.Runtime,
		RunID:          run.RunID,
		ExternalMethod: method,
		Payload:        payload,
	}
	if err := s.persistActionEvent(context.Background(), run, action, event); err != nil {
		logger.SysErrorf("【Action Runtime】保存里程碑事件失败: run_id=%s type=%s err=%v", run.RunID, eventType, err)
		return
	}
	run.LastSeq = event.Seq
}

// startIdleWatchdog bounds how long one turn may stay silent. It replaces the
// Alpha per-step timeout: slow thinking inside the budget is fine, a runtime
// that stops producing events is not.
func startIdleWatchdog(timeout time.Duration) *time.Timer {
	if timeout <= 0 {
		return nil
	}
	return time.NewTimer(timeout)
}

func idleWatchdogChannel(timer *time.Timer) <-chan time.Time {
	if timer == nil {
		return nil
	}
	return timer.C
}

func resetIdleWatchdog(timer *time.Timer, timeout time.Duration) {
	if timer == nil || timeout <= 0 {
		return
	}
	if !timer.Stop() {
		select {
		case <-timer.C:
		default:
		}
	}
	timer.Reset(timeout)
}

func stopIdleWatchdog(timer *time.Timer) {
	if timer != nil {
		timer.Stop()
	}
}

func (s *ActionRuntimeService) persistActionEvent(ctx context.Context, run *model.ActionRunRecord, action *model.ActionRecord, event actionruntime.ActionEvent) error {
	payloadJSON := ""
	if len(event.Payload) > 0 {
		encoded, err := json.Marshal(event.Payload)
		if err != nil {
			return err
		}
		if len(encoded) > maxActionPayload {
			encoded = []byte(`{"truncated":true}`)
		}
		payloadJSON = string(encoded)
	}
	return model.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var existing model.ActionEventRecord
		err := tx.Where("eid = ? AND run_id = ? AND seq = ?", run.Eid, run.RunID, event.Seq).First(&existing).Error
		if err == nil {
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		artifactID, previewID, err := createArtifactRecords(tx, run, action, event)
		if err != nil {
			return err
		}
		now := time.Now().UTC().UnixMilli()
		record := &model.ActionEventRecord{
			Eid:            run.Eid,
			RunID:          run.RunID,
			Seq:            event.Seq,
			EventID:        event.ID,
			Type:           string(event.Type),
			Runtime:        event.Runtime,
			ExternalID:     event.ExternalID,
			ExternalMethod: event.ExternalMethod,
			ErrorCode:      event.ErrorCode,
			ErrorMessage:   model.LongText(publicActionErrorMessage(event.ErrorCode, string(event.ErrorMessage))),
			Delta:          model.LongText(event.Delta),
			PayloadJSON:    model.LongText(payloadJSON),
			ArtifactID:     artifactID,
			PreviewID:      previewID,
			CreatedAt:      now,
		}
		if err := tx.Create(record).Error; err != nil {
			return err
		}
		return tx.Model(&model.ActionRunRecord{}).Where("eid = ? AND run_id = ?", run.Eid, run.RunID).
			Updates(map[string]interface{}{"last_seq": event.Seq}).Error
	})
}

func createArtifactRecords(tx *gorm.DB, run *model.ActionRunRecord, action *model.ActionRecord, event actionruntime.ActionEvent) (string, string, error) {
	var artifactID, previewID string
	create := func(artifact *actionruntime.ActionArtifact) (string, error) {
		if artifact == nil {
			return "", nil
		}
		id, err := model.GenerateActionArtifactID()
		if err != nil {
			return "", err
		}
		record := &model.ActionArtifactRecord{
			ArtifactID:       id,
			Eid:              run.Eid,
			ActionID:         action.ActionID,
			RunID:            run.RunID,
			Name:             artifact.Name,
			MimeType:         artifact.MimeType,
			Size:             artifact.Size,
			StoragePath:      artifact.Path,
			PreviewStatus:    event.PreviewStatus,
			PreviewErrorCode: event.PreviewErrorCode,
		}
		if err := tx.Create(record).Error; err != nil {
			return "", err
		}
		return id, nil
	}
	artifactID, err := create(event.Artifact)
	if err != nil {
		return "", "", err
	}
	if event.Preview != nil {
		if artifactID != "" {
			updates := map[string]interface{}{"preview_path": event.Preview.Path, "preview_status": actionruntime.PreviewStatusAvailable, "preview_error_code": ""}
			if err := tx.Model(&model.ActionArtifactRecord{}).Where("artifact_id = ?", artifactID).Updates(updates).Error; err != nil {
				return "", "", err
			}
			previewID = artifactID
		} else {
			id, err := create(event.Preview)
			if err != nil {
				return "", "", err
			}
			previewID = id
		}
	}
	return artifactID, previewID, nil
}

func (s *ActionRuntimeService) updateRunStatus(ctx context.Context, run *model.ActionRunRecord, action *model.ActionRecord, status, errorCode, errorMessage string) {
	if run == nil || action == nil {
		return
	}
	publicMessage := publicActionErrorMessage(errorCode, errorMessage)
	updates := map[string]interface{}{"status": status}
	if errorCode != "" {
		updates["error_code"] = errorCode
	}
	if publicMessage != "" {
		updates["error_message"] = publicMessage
	}
	if model.IsActionRunStatusTerminal(status) {
		updates["finished_at"] = time.Now().UTC().UnixMilli()
	}
	if err := model.DB.WithContext(ctx).Model(&model.ActionRunRecord{}).Where("eid = ? AND run_id = ?", run.Eid, run.RunID).Updates(updates).Error; err != nil {
		return
	}
	run.Status = status
	if errorCode != "" {
		run.ErrorCode = errorCode
	}
	if publicMessage != "" {
		run.ErrorMessage = model.LongText(publicMessage)
	}
	if finishedAt, ok := updates["finished_at"].(int64); ok {
		run.FinishedAt = finishedAt
	}
	// Action 业务状态由 Run 执行状态映射而来（唯一映射点），
	// 执行错误只保留在 Run 上。
	if actionStatus := model.ActionStatusForRunStatus(status); actionStatus != "" {
		_ = model.DB.WithContext(ctx).Model(&model.ActionRecord{}).Where("eid = ? AND action_id = ?", action.Eid, action.ActionID).Updates(map[string]interface{}{"status": actionStatus})
	}
}

func (s *ActionRuntimeService) failRun(run *model.ActionRunRecord, code actionruntime.ErrorCode, message string) {
	if run == nil {
		return
	}
	_ = persistActionRunFailure(context.Background(), run, code, message)
}

func persistActionRunFailure(ctx context.Context, run *model.ActionRunRecord, code actionruntime.ErrorCode, message string) error {
	if run == nil {
		return nil
	}
	publicMessage := publicActionErrorMessage(string(code), message)
	eventID, _ := model.GenerateActionEventID()
	return model.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var current model.ActionRunRecord
		if err := tx.Where("eid = ? AND run_id = ?", run.Eid, run.RunID).First(&current).Error; err != nil {
			return err
		}
		if model.IsActionRunStatusTerminal(current.Status) {
			return nil
		}
		seq := current.LastSeq + 1
		if err := tx.Create(&model.ActionEventRecord{
			Eid:            run.Eid,
			RunID:          run.RunID,
			Seq:            seq,
			EventID:        eventID,
			Type:           string(actionruntime.EventRunFailed),
			Runtime:        run.Runtime,
			ExternalMethod: "host/failure",
			ErrorCode:      string(code),
			ErrorMessage:   model.LongText(publicMessage),
			PayloadJSON:    model.LongText(fmt.Sprintf(`{"error_code":%q}`, string(code))),
			CreatedAt:      time.Now().UTC().UnixMilli(),
		}).Error; err != nil {
			return err
		}
		if err := tx.Model(&model.ActionRunRecord{}).Where("eid = ? AND run_id = ?", run.Eid, run.RunID).Updates(map[string]interface{}{
			"status":        model.ActionRunStatusFailed,
			"last_seq":      seq,
			"error_code":    string(code),
			"error_message": publicMessage,
			"finished_at":   time.Now().UTC().UnixMilli(),
		}).Error; err != nil {
			return err
		}
		// Action 只更新业务生命周期；error_code/error_message 属于 Run。
		if err := tx.Model(&model.ActionRecord{}).Where("eid = ? AND action_id = ?", run.Eid, run.ActionID).Updates(map[string]interface{}{
			"status": model.ActionStatusNeedsAttention,
		}).Error; err != nil {
			return err
		}
		return nil
	})
}

func (s *ActionRuntimeService) eventViews(ctx context.Context, eid int64, runID string, events []*model.ActionEventRecord) ([]*ActionEventView, error) {
	ids := make([]string, 0, len(events)*2)
	for _, event := range events {
		if event == nil {
			continue
		}
		if event.ArtifactID != "" {
			ids = append(ids, event.ArtifactID)
		}
		if event.PreviewID != "" {
			ids = append(ids, event.PreviewID)
		}
	}
	artifacts, err := model.GetActionArtifactsByIDs(ctx, eid, ids)
	if err != nil {
		return nil, err
	}
	views := make([]*ActionEventView, 0, len(events))
	for _, event := range events {
		if event == nil {
			continue
		}
		var payload map[string]any
		if strings.TrimSpace(string(event.PayloadJSON)) != "" {
			if err := json.Unmarshal([]byte(event.PayloadJSON), &payload); err != nil {
				payload = map[string]any{"truncated": true}
			}
		}
		view := &ActionEventView{
			Seq:            event.Seq,
			EventID:        event.EventID,
			Type:           event.Type,
			Runtime:        event.Runtime,
			ExternalID:     event.ExternalID,
			ExternalMethod: event.ExternalMethod,
			ErrorCode:      event.ErrorCode,
			ErrorMessage:   publicActionErrorMessage(event.ErrorCode, string(event.ErrorMessage)),
			Delta:          string(event.Delta),
			Payload:        payload,
			CreatedAt:      event.CreatedAt,
		}
		if artifact := artifacts[event.ArtifactID]; artifact != nil {
			view.Artifact = artifactView(runID, artifact)
		}
		if preview := artifacts[event.PreviewID]; preview != nil {
			view.Preview = previewView(runID, preview)
		}
		views = append(views, view)
	}
	return views, nil
}

func (s *ActionRuntimeService) actionView(action *model.ActionRecord) (*ActionView, error) {
	if action == nil {
		return nil, ErrActionNotFound
	}
	fileID := ""
	if action.SourceFileID > 0 {
		encoded, err := encodeActionID(action.SourceFileID)
		if err != nil {
			return nil, err
		}
		fileID = encoded
	}
	expected, err := expectedArtifacts(action)
	if err != nil {
		return nil, err
	}
	return &ActionView{
		ActionID:          action.ActionID,
		FileID:            fileID,
		ActionType:        action.ActionType,
		Status:            action.Status,
		Title:             action.Title,
		Prompt:            string(action.Prompt),
		ExpectedArtifacts: expected,
		Runtime:           action.Runtime,
		LastRunID:         action.LastRunID,
		ConfirmedAt:       action.ConfirmedAt,
		// Run 的错误只从 Run 读取（见 ActionRunView），Action 不复制执行错误。
		CreatedTime: action.CreatedTime,
		UpdatedTime: action.UpdatedTime,
	}, nil
}

func (s *ActionRuntimeService) runView(ctx context.Context, run *model.ActionRunRecord) (*ActionRunView, error) {
	if run == nil {
		return nil, nil
	}
	return &ActionRunView{
		RunID:           run.RunID,
		ActionID:        run.ActionID,
		Status:          run.Status,
		Runtime:         run.Runtime,
		RuntimeThreadID: run.RuntimeThreadID,
		PlanID:          run.PlanID,
		LastSeq:         run.LastSeq,
		ErrorCode:       run.ErrorCode,
		ErrorMessage:    string(run.ErrorMessage),
		StartedAt:       run.StartedAt,
		LastActivityAt:  run.LastActivityAt,
		FinishedAt:      run.FinishedAt,
		CreatedTime:     run.CreatedTime,
		UpdatedTime:     run.UpdatedTime,
	}, nil
}

func artifactView(runID string, artifact *model.ActionArtifactRecord) *ActionArtifactView {
	if artifact == nil {
		return nil
	}
	previewStatus, previewErrorCode := artifactPreviewState(artifact)
	return &ActionArtifactView{
		ArtifactID:       artifact.ArtifactID,
		Name:             artifact.Name,
		MimeType:         artifact.MimeType,
		Size:             artifact.Size,
		DownloadURL:      "/api/recordings/action-runs/" + url.PathEscape(runID) + "/artifacts/" + url.PathEscape(artifact.ArtifactID) + "/download",
		PreviewURL:       previewURL(runID, artifact),
		PreviewStatus:    previewStatus,
		PreviewErrorCode: previewErrorCode,
	}
}

// artifactPreviewState 是 Artifact 预览状态的唯一推导入口（Review 与 ResultAsset 共用）：
//   - preview_path 非空 → available；
//   - 持久化了 Host 结论 → 原样输出（unavailable / failed + 安全 error code）；
//   - 历史记录（PLAN 7.2 之前的 Artifact）没有结论：能转换的格式记为 unavailable，
//     其余格式（本来就没有预览通道）不输出状态。
func artifactPreviewState(artifact *model.ActionArtifactRecord) (string, string) {
	if artifact == nil {
		return "", ""
	}
	if artifact.PreviewPath != "" {
		return actionruntime.PreviewStatusAvailable, ""
	}
	if artifact.PreviewStatus != "" {
		return artifact.PreviewStatus, artifact.PreviewErrorCode
	}
	if _, ok := actionsystem.FormatForExtension(filepath.Ext(artifact.Name)); ok {
		return actionruntime.PreviewStatusUnavailable, ""
	}
	return "", ""
}

func previewView(runID string, artifact *model.ActionArtifactRecord) *ActionArtifactView {
	if artifact == nil || artifact.PreviewPath == "" {
		return nil
	}
	info, err := os.Stat(artifact.PreviewPath)
	if err != nil || !info.Mode().IsRegular() {
		return nil
	}
	name := ActionArtifactPreviewName(artifact.Name)
	return &ActionArtifactView{
		ArtifactID:    artifact.ArtifactID,
		Name:          name,
		MimeType:      "application/pdf",
		Size:          info.Size(),
		DownloadURL:   "/api/recordings/action-runs/" + url.PathEscape(runID) + "/artifacts/" + url.PathEscape(artifact.ArtifactID) + "/preview",
		PreviewStatus: actionruntime.PreviewStatusAvailable,
	}
}

func previewURL(runID string, artifact *model.ActionArtifactRecord) string {
	if artifact == nil || artifact.PreviewPath == "" {
		return ""
	}
	return "/api/recordings/action-runs/" + url.PathEscape(runID) + "/artifacts/" + url.PathEscape(artifact.ArtifactID) + "/preview"
}

func pathWithinActionRuntimeRoot(path, root string) bool {
	path = strings.TrimSpace(path)
	root = strings.TrimSpace(root)
	if path == "" || root == "" {
		return false
	}
	path, pathErr := filepath.Abs(path)
	root, rootErr := filepath.Abs(root)
	if pathErr != nil || rootErr != nil || root == string(filepath.Separator) {
		return false
	}
	relative, err := filepath.Rel(root, path)
	return err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))
}

func expectedArtifacts(action *model.ActionRecord) ([]string, error) {
	if action == nil || strings.TrimSpace(string(action.ExpectedArtifactsJSON)) == "" {
		return nil, ErrActionInvalidRequest
	}
	var expected []string
	if err := json.Unmarshal([]byte(action.ExpectedArtifactsJSON), &expected); err != nil || len(expected) == 0 {
		return nil, ErrActionInvalidRequest
	}
	for _, path := range expected {
		if err := validateExpectedArtifact(path); err != nil {
			return nil, err
		}
	}
	return expected, nil
}

func validateActionSource(ctx context.Context, eid, userID int64, action *model.ActionRecord) error {
	if action == nil {
		return ErrActionNotFound
	}
	var snapshot InsightActionContextSnapshot
	if err := json.Unmarshal([]byte(action.ContextJSON), &snapshot); err != nil {
		return ErrActionInvalidRequest
	}
	if snapshot.SourceType == model.SourceTypeConversation || snapshot.SourceType == model.SourceTypeResult {
		if strings.TrimSpace(snapshot.SourceID) == "" || strings.TrimSpace(snapshot.InsightSummary) == "" || len(snapshot.SourceRefs) == 0 {
			return ErrActionInvalidRequest
		}
		if snapshot.SourceType == model.SourceTypeConversation {
			conversationID, err := hashids.TryParseID(snapshot.SourceID)
			if err != nil {
				return ErrActionInvalidRequest
			}
			if _, err := model.GetConversationByID(eid, userID, conversationID); err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return ErrActionNotFound
				}
				return err
			}
			return nil
		}
		if _, err := model.GetActionResultAssetForUser(ctx, eid, userID, snapshot.SourceID); err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrActionNotFound
			}
			return err
		}
		return nil
	}
	file, err := GetViewableRecordingFile(ctx, eid, userID, action.SourceFileID)
	if err != nil {
		if errors.Is(err, ErrRecordingFileForbidden) {
			return ErrActionForbidden
		}
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrActionNotFound
		}
		return err
	}
	if !file.IsRecordingOriginType() {
		return ErrActionInsightNotReady
	}
	insight, err := loadFormalInsightPageText(action.SourceFileID)
	if err != nil {
		return ErrActionInsightNotReady
	}
	if snapshot.SourceFileID != action.SourceFileID {
		return ErrActionInvalidRequest
	}
	if snapshot.InsightGeneration != file.InsightGeneration || snapshot.InsightSummary != insight {
		return ErrActionInsightChanged
	}
	return nil
}

func validateExpectedArtifact(value string) error {
	value = strings.TrimSpace(value)
	if value == "" || filepath.Base(value) != value || strings.ContainsAny(value, "/\\") || strings.Contains(value, "..") || !utf8.ValidString(value) || strings.IndexFunc(value, unicode.IsControl) >= 0 || utf8.RuneCountInString(value) > 255 {
		return fmt.Errorf("%w: expected_artifact must be a single filename", ErrActionInvalidRequest)
	}
	if _, ok := actionsystem.FormatForExtension(filepath.Ext(value)); !ok {
		return fmt.Errorf("%w: expected_artifact must be a .docx, .xlsx or .pptx filename", ErrActionInvalidRequest)
	}
	return nil
}

func validateRuntimeConfig(config ActionRuntimeConfig, actionType string) error {
	if !config.Enabled {
		return ErrActionRuntimeDisabled
	}
	if strings.TrimSpace(config.Binary) == "" || strings.TrimSpace(config.WorkRoot) == "" || strings.TrimSpace(config.ArtifactRoot) == "" {
		return ErrActionRuntimeNotConfigured
	}
	if strings.TrimSpace(config.CodexHome) == "" || strings.TrimSpace(config.MinCodexVersion) == "" {
		return ErrActionRuntimeNotConfigured
	}
	if (actionType == ActionTypeCreateDOCX || actionType == ActionTypeExecutePlan) && strings.TrimSpace(config.PreviewRoot) == "" {
		return ErrActionRuntimeNotConfigured
	}
	actionBudget := config.ActionBudget
	if actionBudget <= 0 {
		actionBudget = config.Timeout
	}
	if actionBudget <= 0 {
		return ErrActionRuntimeNotConfigured
	}
	return nil
}

func ensureActionRuntimeWorkRoot(root string) error {
	root = strings.TrimSpace(root)
	if root == "" {
		return ErrActionRuntimeNotConfigured
	}
	if err := os.MkdirAll(root, 0o700); err != nil {
		return err
	}
	info, err := os.Stat(root)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return fmt.Errorf("action runtime work root is not a directory: %s", root)
	}
	return nil
}

// buildActionPrompt hands the whole confirmed Action to Codex exactly once:
// objective, background, plan steps, deliverable contract and acceptance
// criteria. The runtime must produce one real OOXML business file with the
// Host-decided canonical filename, plus one strict JSON ResultSpec that carries
// the business meaning of the delivery.
func buildActionPrompt(action *model.ActionRecord, contract canonicalPrimaryArtifactContract) string {
	var snapshot InsightActionContextSnapshot
	_ = json.Unmarshal([]byte(action.ContextJSON), &snapshot)
	contextText := formatInsightBackgroundPrompt(snapshot.Background, snapshot.Background.MaterialContext)
	contextLabel := strings.TrimSpace(snapshot.ContextLabel)
	if contextLabel == "" {
		contextLabel = "会议洞察"
	}
	sourceRefs, _ := json.Marshal(snapshot.SourceRefs)
	return fmt.Sprintf(`你是二号总裁的执行引擎。用户已经确认了下面这份行动方案，请自主把它做完。

<action_request>
标题：%s
目标与要求：%s
主交付物：%s（格式 %s；文件名必须恰好是 %s）
</action_request>

<confirmed_plan>
%s
</confirmed_plan>

<source_context label="%s" type="%s" id="%s">
%s
</source_context>

<confirmed_context>
%s
</confirmed_context>

<source_refs>
%s
</source_refs>

执行要求：
1. 自行决定怎么做：可以推理、检索、调用工具、写中间文件、自我检查与修正，全部在同一轮内完成。
2. 只交付上面那一个主业务文件：检查清单、附录、数据表都是它的内容，不要生成第二个业务文件，也不要生成 CSV/Markdown/HTML。
3. 直接生成真实 OOXML 文件，写在当前工作目录、文件名必须精确等于 %s：
%s
   不允许把 txt/csv/markdown 改扩展名冒充；Host 会打开文件校验真实格式。
4. 生成后可自行用 Python 打开一次自检（python3 已预装 python-docx / openpyxl / python-pptx）。不要调用 LibreOffice、GUI 或任何预览/转换命令，Host 负责校验、归档与 PDF 预览。
5. 最终只输出一个严格 JSON ResultSpec，不要 Markdown 代码围栏、不要解释文字、不要在 JSON 前后追加任何内容：
{"result_spec_version":"%s","renderer_version":"%s","template_version":"%s","title":"%s","subtitle":"...","executive_summary":"...","sections":[{"title":"...","body":"..."}],"findings":["..."],"recommendations":["..."],"sources":[{"role":"primary","source_type":"insight","canonical_id":"..."}],"appendices":["..."]}
ResultSpec 描述这份成果的业务含义（执行摘要、关键章节、发现与建议），它不描述文件的物理排版；title 使用上面主交付物的标题。
sections 只能包含 title、body；findings、recommendations、appendices 必须是字符串数组；sources 只能包含 role、source_type、canonical_id、source_version。
6. 所有结论必须基于 Host 提供的上下文；不要把建议或其他未确认内容写成已经发生的事实；无法验证的内容要显式标注。`,
		action.Title, action.Prompt, contract.Title, strings.ToUpper(string(contract.Format)), contract.Filename,
		string(action.Prompt), contextLabel, snapshot.SourceType, snapshot.SourceID, snapshot.InsightSummary, contextText, sourceRefs,
		contract.Filename, formatGenerationGuidance(contract.Format),
		resultConfigValue(snapshotResultSpecVersion(action), "result-spec-v1"), RendererVersionForFormat(contract.Format),
		resultConfigValue(ActionRuntimeConfigFromEnv().TemplateVersion, "template-v1"), contract.Title)
}

// formatGenerationGuidance 是三种格式各自的最低真实性要求。
func formatGenerationGuidance(format actionsystem.DeliverableFormat) string {
	switch format {
	case actionsystem.FormatXLSX:
		return "   这是真实 Excel OOXML workbook：至少一个可见工作表，表头与数据用单元格承载。"
	case actionsystem.FormatPPTX:
		return "   这是真实 PowerPoint OOXML：至少一张 slide，标题与要点用文本框承载。"
	default:
		return "   这是真实 Word OOXML：标题、章节段落与列表用 Word 结构承载。"
	}
}

// RendererVersionForFormat 描述真实产出这份文件的 pipeline：executor 直接生成的
// OOXML 一律是 direct-<format>-v1，不允许三种格式共用 host-docx-v1。
func RendererVersionForFormat(format actionsystem.DeliverableFormat) string {
	if format.Extension() == "" {
		return "direct-docx-v1"
	}
	return "direct-" + string(format) + "-v1"
}

// snapshotResultSpecVersion keeps the prompt's declared spec version aligned with
// the runtime configuration.
func snapshotResultSpecVersion(action *model.ActionRecord) string {
	config := ActionRuntimeConfigFromEnv()
	_ = action
	return resultConfigValue(config.ResultSpecVersion, "result-spec-v1")
}

// boundedHead / boundedTail keep forensic logs small without hiding the shape of
// the model's final message.
func boundedHead(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit])
}

func boundedTail(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[len(runes)-limit:])
}

func firstExpectedArtifact(action *model.ActionRecord) string {
	expected, _ := expectedArtifacts(action)
	if len(expected) == 0 {
		return "指定的交付文件"
	}
	return expected[0]
}

// resolveActionArtifactContract 解析本次 Run 的主交付物契约：权威是用户确认过的
// Plan；只有没有 Plan 的裸 Action 才回落到既有的 ExpectedArtifacts 缓存。
func (s *ActionRuntimeService) resolveActionArtifactContract(ctx context.Context, action *model.ActionRecord) (canonicalPrimaryArtifactContract, error) {
	if action == nil {
		return canonicalPrimaryArtifactContract{}, ErrActionNotFound
	}
	plan, err := model.GetActionPlanByActionID(ctx, action.Eid, action.ActionID)
	if err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return canonicalPrimaryArtifactContract{}, err
		}
		return contractFromExpectedArtifact(action)
	}
	aggregate, err := model.GetActionPlanForUser(ctx, action.Eid, action.OwnerID, plan.PlanID)
	if err != nil {
		return canonicalPrimaryArtifactContract{}, mapActionNotFound(err, ErrActionPlanNotFound)
	}
	contract, err := canonicalPrimaryArtifact(aggregate)
	if err == nil {
		return contract, nil
	}
	// 历史 Plan 可能带着无法 canonicalize 的标题（例如标题里写了别的扩展名）。
	// 这类 Run 沿用既有交付物契约，历史行为不被破坏。
	fallback, fallbackErr := contractFromExpectedArtifact(action)
	if fallbackErr != nil {
		return canonicalPrimaryArtifactContract{}, err
	}
	logger.SysErrorf("【Action Runtime】Plan 主交付物契约无效，沿用既有契约 action_id=%s err=%v", action.ActionID, err)
	return fallback, nil
}

// contractFromExpectedArtifact 只服务没有 Plan 的裸 Action：文件名本身就是契约，
// 扩展名决定格式。
func contractFromExpectedArtifact(action *model.ActionRecord) (canonicalPrimaryArtifactContract, error) {
	name := firstExpectedArtifact(action)
	format, ok := actionsystem.FormatForExtension(filepath.Ext(name))
	if !ok {
		return canonicalPrimaryArtifactContract{}, ErrActionArtifactFormatUnsupported
	}
	return canonicalPrimaryArtifactContract{
		Title: strings.TrimSuffix(name, filepath.Ext(name)), Format: format, Filename: name,
	}, nil
}

// ActionArtifactPreviewName 是 PDF preview 的展示名：只替换扩展名，业务文件名
// 本身不变，也不产生第二份业务交付物。
func ActionArtifactPreviewName(name string) string {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return ""
	}
	return strings.TrimSuffix(trimmed, filepath.Ext(trimmed)) + ".pdf"
}

func actionRunStatus(event actionruntime.ActionEvent) (string, bool) {
	switch event.Type {
	case actionruntime.EventRunCompleted:
		return model.ActionRunStatusCompleted, true
	case actionruntime.EventRunFailed:
		return model.ActionRunStatusFailed, true
	case actionruntime.EventRunCancelled:
		return model.ActionRunStatusCancelled, true
	case actionruntime.EventRunStarted:
		return model.ActionRunStatusRunning, true
	default:
		return "", false
	}
}

func publicActionErrorMessage(code, _ string) string {
	if strings.TrimSpace(code) == "" {
		return ""
	}
	switch code {
	case "artifact_validation_failed", "artifact_verification_failed":
		return "文件产物未通过真实性校验"
	case "artifact_format_mismatch":
		return "交付文件真实格式与约定格式不一致"
	case "expected_artifact_missing":
		return "执行结束但未找到约定的交付文件"
	case "artifact_ambiguous":
		return "工作目录里存在多个同格式候选文件，无法确定主交付物"
	case "action_contract_invalid":
		return "行动方案的主交付物契约无效"
	case "artifact_archive_failed", "artifact_store_unavailable":
		return "文件产物无法归档"
	case "artifact_preview_failed":
		return "文件预览生成失败"
	case "run_timeout":
		return "行动任务执行超时"
	case "runtime_restarted":
		return "服务重启导致行动任务中断，请重试"
	case "cancelled":
		return "行动任务已取消"
	case "operation_failed":
		return "Codex 操作未成功"
	case "protocol_error":
		return "Codex 协议通信失败"
	case "auth_failed":
		return "Codex 认证失败"
	case "proxy_failed":
		return "Codex 网络代理失败"
	case "ready_timeout":
		return "Codex 启动超时"
	case "output_limit_exceeded":
		return "Codex 输出超过限制"
	case "run_status_conflict":
		return "行动任务状态冲突"
	case "binary_missing", "runtime_unavailable", "runtime_disabled":
		return "Codex 执行环境不可用"
	case "workdir_unavailable":
		return "行动工作目录不可用"
	case "event_persistence_failed":
		return "行动进度无法保存"
	case "runtime_exit":
		return "Codex 执行进程异常退出"
	}
	return "行动任务执行失败"
}

func (s *ActionRuntimeService) getLive(runID string) (*liveActionRun, bool) {
	s.liveMu.RLock()
	defer s.liveMu.RUnlock()
	live, ok := s.live[runID]
	return live, ok
}

func mapActionNotFound(err, target error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return target
	}
	return err
}

func encodeActionID(id int64) (string, error) {
	if id <= 0 {
		return "", ErrActionForbidden
	}
	return hashids.Encode(id)
}

func validText(value string, max int) bool {
	value = strings.TrimSpace(value)
	return value != "" && utf8.RuneCountInString(value) <= max
}

func envString(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func envBool(key string, fallback bool) bool {
	value, err := strconv.ParseBool(strings.TrimSpace(os.Getenv(key)))
	if err != nil {
		return fallback
	}
	return value
}

func envInt(key string, fallback int) int {
	value, err := strconv.Atoi(strings.TrimSpace(os.Getenv(key)))
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}
