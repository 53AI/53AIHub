package model

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
)

// Action business lifecycle (V1). Execution status lives on ActionRun only:
// a Run's queued/running/completed/failed/cancelled must never be duplicated
// onto the Action as a second synonym.
const (
	ActionStatusDraft          = "draft"
	ActionStatusReadyToConfirm = "ready_to_confirm"
	ActionStatusExecuting      = "executing"
	ActionStatusAwaitingReview = "awaiting_review"
	ActionStatusNeedsAttention = "needs_attention"
	ActionStatusAccepted       = "accepted"
)

// ActionStatusForRunStatus maps a Run execution status onto the Action business
// lifecycle. It is the only place where the two layers are connected.
func ActionStatusForRunStatus(status string) string {
	switch status {
	case ActionRunStatusQueued, ActionRunStatusRunning:
		return ActionStatusExecuting
	case ActionRunStatusCompleted:
		return ActionStatusAwaitingReview
	case ActionRunStatusFailed, ActionRunStatusCancelled:
		return ActionStatusNeedsAttention
	default:
		return ""
	}
}

// ActionStatusAcceptsNewRun reports whether a failed/cancelled Action may be
// retried or refined with a new Run.
func ActionStatusAcceptsNewRun(status string) bool {
	return status == ActionStatusNeedsAttention || status == ActionStatusAwaitingReview || status == ActionStatusExecuting
}

const (
	ActionRunStatusQueued    = "queued"
	ActionRunStatusRunning   = "running"
	ActionRunStatusCompleted = "completed"
	ActionRunStatusFailed    = "failed"
	ActionRunStatusCancelled = "cancelled"
)

// ActionRecord is the durable business action. It is intentionally separate
// from AgentRun, which is the persistence projection for ordinary chat runs.
type ActionRecord struct {
	ID                    int64    `json:"-" gorm:"primaryKey;autoIncrement"`
	ActionID              string   `json:"action_id" gorm:"size:64;not null;uniqueIndex:uk_actions_action_id"`
	Eid                   int64    `json:"-" gorm:"not null;index:idx_actions_scope,priority:1;index:idx_actions_file,priority:1"`
	OwnerID               int64    `json:"-" gorm:"not null;index:idx_actions_scope,priority:2"`
	SourceFileID          int64    `json:"-" gorm:"not null;index:idx_actions_file,priority:2"`
	ActionType            string   `json:"action_type" gorm:"size:32;not null;index"`
	Status                string   `json:"status" gorm:"size:32;not null;index:idx_actions_scope,priority:3"`
	Title                 string   `json:"title" gorm:"size:255;not null"`
	Prompt                LongText `json:"prompt" gorm:"not null"`
	ContextJSON           LongText `json:"-" gorm:"not null"`
	ExpectedArtifactsJSON LongText `json:"-" gorm:"not null"`
	Runtime               string   `json:"runtime" gorm:"size:64;not null"`
	LastRunID             string   `json:"last_run_id,omitempty" gorm:"size:64;index"`
	ConfirmedBy           int64    `json:"-" gorm:"not null;default:0"`
	ConfirmedAt           int64    `json:"confirmed_at,omitempty" gorm:"not null;default:0"`
	BaseModel
}

func (ActionRecord) TableName() string { return "actions" }

type ActionRunRecord struct {
	ID                int64    `json:"-" gorm:"primaryKey;autoIncrement"`
	RunID             string   `json:"run_id" gorm:"size:64;not null;uniqueIndex:uk_action_runs_run_id"`
	ActionID          string   `json:"action_id" gorm:"size:64;not null;index:idx_action_runs_task,priority:1"`
	Eid               int64    `json:"-" gorm:"not null;index:idx_action_runs_task,priority:2;index:idx_action_runs_scope,priority:1"`
	Status            string   `json:"status" gorm:"size:32;not null;index:idx_action_runs_scope,priority:2"`
	Runtime           string   `json:"runtime" gorm:"size:64;not null"`
	PlanID            string   `json:"plan_id,omitempty" gorm:"size:64;default:'';index"`
	PlanSnapshotJSON  LongText `json:"-" gorm:"not null"`
	SessionID         string   `json:"session_id,omitempty" gorm:"size:64;default:''"`
	ExternalSessionID string   `json:"-" gorm:"size:128;default:''"`
	RuntimeThreadID   string   `json:"runtime_thread_id,omitempty" gorm:"size:128;default:''"`
	CancelRequestedAt int64    `json:"-" gorm:"not null;default:0"`
	// RefinementFeedback 记录本次 Run 由哪条 refine 指令触发，用于 refine 幂等判定：
	// 同一 feedback 视为重复请求；不同 feedback 视为新指令（运行中必须拒绝）。
	RefinementFeedback LongText `json:"-" gorm:"not null"`
	LastSeq            int64    `json:"last_seq" gorm:"not null;default:0"`
	// error_code / error_message belong to the Run: the Action never duplicates them.
	ErrorCode    string   `json:"error_code,omitempty" gorm:"size:64;default:''"`
	ErrorMessage LongText `json:"error_message,omitempty"`
	// OutputJSON holds Run outputs such as the confirmed ResultSpec; V1 has no
	// separate result-spec table.
	OutputJSON     LongText `json:"-" gorm:"not null"`
	StartedAt      int64    `json:"started_at,omitempty" gorm:"not null;default:0"`
	LastActivityAt int64    `json:"last_activity_at,omitempty" gorm:"not null;default:0"`
	FinishedAt     int64    `json:"finished_at,omitempty" gorm:"not null;default:0"`
	BaseModel
}

func (ActionRunRecord) TableName() string { return "action_runs" }

type ActionEventRecord struct {
	ID             int64    `json:"-" gorm:"primaryKey;autoIncrement"`
	Eid            int64    `json:"-" gorm:"not null;uniqueIndex:uk_action_events_seq,priority:1;index"`
	RunID          string   `json:"run_id" gorm:"size:64;not null;uniqueIndex:uk_action_events_seq,priority:2;index"`
	Seq            int64    `json:"seq" gorm:"not null;uniqueIndex:uk_action_events_seq,priority:3"`
	EventID        string   `json:"event_id,omitempty" gorm:"size:128;default:''"`
	Type           string   `json:"type" gorm:"size:64;not null;index"`
	Runtime        string   `json:"runtime" gorm:"size:64;not null"`
	ExternalID     string   `json:"external_id,omitempty" gorm:"size:128;default:''"`
	ExternalMethod string   `json:"external_method,omitempty" gorm:"size:128;default:''"`
	ErrorCode      string   `json:"error_code,omitempty" gorm:"size:64;default:''"`
	ErrorMessage   LongText `json:"-"`
	Delta          LongText `json:"delta,omitempty"`
	PayloadJSON    LongText `json:"-"`
	ArtifactID     string   `json:"artifact_id,omitempty" gorm:"size:128;default:'';index"`
	PreviewID      string   `json:"preview_id,omitempty" gorm:"size:128;default:'';index"`
	CreatedAt      int64    `json:"created_at" gorm:"not null;index"`
	BaseModel
}

func (ActionEventRecord) TableName() string { return "action_events" }

type ActionArtifactRecord struct {
	ID          int64  `json:"-" gorm:"primaryKey;autoIncrement"`
	ArtifactID  string `json:"artifact_id" gorm:"size:128;not null;uniqueIndex:uk_action_artifacts_id"`
	Eid         int64  `json:"-" gorm:"not null;index:idx_action_artifacts_run,priority:1"`
	ActionID    string `json:"-" gorm:"size:64;not null;index"`
	RunID       string `json:"run_id" gorm:"size:64;not null;index:idx_action_artifacts_run,priority:2"`
	Name        string `json:"name" gorm:"size:255;not null"`
	MimeType    string `json:"mime_type" gorm:"size:128;not null"`
	Size        int64  `json:"size" gorm:"not null;default:0"`
	StoragePath string `json:"-" gorm:"not null"`
	PreviewPath string `json:"-" gorm:"default:''"`
	// PreviewStatus / PreviewErrorCode 记录 Host 生成预览的结论（available / unavailable /
	// failed + 安全 error code）。历史记录为空：视图层按 preview_path 是否为空兼容。
	PreviewStatus    string `json:"preview_status,omitempty" gorm:"size:32;not null;default:''"`
	PreviewErrorCode string `json:"preview_error_code,omitempty" gorm:"size:64;not null;default:''"`
	BaseModel
}

func (ActionArtifactRecord) TableName() string { return "action_artifacts" }

func CreateActionRecord(ctx context.Context, action *ActionRecord) error {
	if action == nil {
		return fmt.Errorf("action action is nil")
	}
	if action.ActionID == "" {
		id, err := GenerateActionID()
		if err != nil {
			return err
		}
		action.ActionID = id
	}
	if action.Status == "" {
		action.Status = ActionStatusDraft
	}
	if action.Runtime == "" {
		action.Runtime = "codex"
	}
	return DB.WithContext(ctx).Create(action).Error
}

func GetActionByID(ctx context.Context, eid int64, actionID string) (*ActionRecord, error) {
	var action ActionRecord
	if err := DB.WithContext(ctx).Where("eid = ? AND action_id = ?", eid, actionID).First(&action).Error; err != nil {
		return nil, err
	}
	return &action, nil
}

func GetActionForUser(ctx context.Context, eid, ownerID int64, actionID string) (*ActionRecord, error) {
	var action ActionRecord
	if err := DB.WithContext(ctx).Where("eid = ? AND owner_id = ? AND action_id = ?", eid, ownerID, actionID).First(&action).Error; err != nil {
		return nil, err
	}
	return &action, nil
}

func CreateActionRunRecord(ctx context.Context, run *ActionRunRecord) error {
	if run == nil {
		return fmt.Errorf("action run is nil")
	}
	if run.RunID == "" {
		id, err := GenerateActionRunID()
		if err != nil {
			return err
		}
		run.RunID = id
	}
	if run.Status == "" {
		run.Status = ActionRunStatusQueued
	}
	return DB.WithContext(ctx).Create(run).Error
}

func GetActionRunByID(ctx context.Context, eid int64, runID string) (*ActionRunRecord, error) {
	var run ActionRunRecord
	if err := DB.WithContext(ctx).Where("eid = ? AND run_id = ?", eid, runID).First(&run).Error; err != nil {
		return nil, err
	}
	return &run, nil
}

func GetActionRunForUser(ctx context.Context, eid, ownerID int64, runID string) (*ActionRunRecord, error) {
	var run ActionRunRecord
	err := DB.WithContext(ctx).Table("action_runs AS ar").
		Select("ar.*").
		Joins("JOIN actions AS at ON at.eid = ar.eid AND at.action_id = ar.action_id").
		Where("ar.eid = ? AND ar.run_id = ? AND at.owner_id = ?", eid, runID, ownerID).
		First(&run).Error
	if err != nil {
		return nil, err
	}
	return &run, nil
}

// ListActiveActionRunsByTask returns the non-terminal runs of a action. It is the
// idempotency guard for confirm/retry/refine: one Action may only ever have one
// active run, so a repeated request returns the existing run instead of creating
// a second one.
func ListActiveActionRunsByTask(ctx context.Context, eid int64, actionID string) ([]*ActionRunRecord, error) {
	var runs []*ActionRunRecord
	err := DB.WithContext(ctx).
		Where("eid = ? AND action_id = ? AND status IN ?", eid, actionID, []string{ActionRunStatusQueued, ActionRunStatusRunning}).
		Order("id ASC").
		Find(&runs).Error
	return runs, err
}

func ListActionRunsByAction(ctx context.Context, eid int64, actionID string) ([]*ActionRunRecord, error) {
	var runs []*ActionRunRecord
	err := DB.WithContext(ctx).
		Where("eid = ? AND action_id = ?", eid, actionID).
		Order("created_time ASC, id ASC").
		Find(&runs).Error
	return runs, err
}

func ListActionRunsByStatuses(ctx context.Context, statuses []string) ([]*ActionRunRecord, error) {
	if len(statuses) == 0 {
		return nil, nil
	}
	var runs []*ActionRunRecord
	err := DB.WithContext(ctx).Where("status IN ?", statuses).Order("id ASC").Find(&runs).Error
	return runs, err
}

// ListActionArtifactsByRun 返回某个 Run 归档的全部产物；ResultAsset 的产物即由此派生。
func ListActionArtifactsByRun(ctx context.Context, eid int64, runID string) ([]*ActionArtifactRecord, error) {
	var records []*ActionArtifactRecord
	if err := DB.WithContext(ctx).Where("eid = ? AND run_id = ?", eid, runID).Order("id ASC").Find(&records).Error; err != nil {
		return nil, err
	}
	return records, nil
}

func ListExpiredActionArtifacts(ctx context.Context, cutoff int64, afterID int64, limit int) ([]*ActionArtifactRecord, error) {
	if limit <= 0 {
		limit = 100
	}
	var artifacts []*ActionArtifactRecord
	err := DB.WithContext(ctx).Table("action_artifacts AS aa").
		Select("aa.*").
		Joins("JOIN action_runs AS ar ON ar.eid = aa.eid AND ar.run_id = aa.run_id").
		Where("aa.id > ? AND ar.status IN ? AND ar.finished_at > 0 AND ar.finished_at <= ?", afterID, []string{
			ActionRunStatusCompleted,
			ActionRunStatusFailed,
			ActionRunStatusCancelled,
		}, cutoff).
		Order("aa.id ASC").
		Limit(limit).
		Find(&artifacts).Error
	return artifacts, err
}

func DeleteActionArtifact(ctx context.Context, eid int64, artifactID string) error {
	return DB.WithContext(ctx).Where("eid = ? AND artifact_id = ?", eid, artifactID).Delete(&ActionArtifactRecord{}).Error
}

func GetActionEventsAfterSeq(ctx context.Context, eid int64, runID string, afterSeq int64, limit int) ([]*ActionEventRecord, error) {
	if limit <= 0 {
		limit = 200
	}
	if limit > 2000 {
		limit = 2000
	}
	var events []*ActionEventRecord
	err := DB.WithContext(ctx).Where("eid = ? AND run_id = ? AND seq > ?", eid, runID, afterSeq).
		Order("seq ASC").Limit(limit).Find(&events).Error
	return events, err
}

func GetActionArtifactsByIDs(ctx context.Context, eid int64, artifactIDs []string) (map[string]*ActionArtifactRecord, error) {
	result := make(map[string]*ActionArtifactRecord, len(artifactIDs))
	if len(artifactIDs) == 0 {
		return result, nil
	}
	var artifacts []*ActionArtifactRecord
	if err := DB.WithContext(ctx).Where("eid = ? AND artifact_id IN ?", eid, artifactIDs).Find(&artifacts).Error; err != nil {
		return nil, err
	}
	for _, artifact := range artifacts {
		if artifact != nil {
			result[artifact.ArtifactID] = artifact
		}
	}
	return result, nil
}

// GetActionsByIDs 批量读取 Action：Plan 列表要展示执行摘要，必须避免按 Plan 逐条查询。
func GetActionsByIDs(ctx context.Context, eid int64, actionIDs []string) (map[string]*ActionRecord, error) {
	result := make(map[string]*ActionRecord, len(actionIDs))
	if len(actionIDs) == 0 {
		return result, nil
	}
	var actions []*ActionRecord
	if err := DB.WithContext(ctx).Where("eid = ? AND action_id IN ?", eid, actionIDs).Find(&actions).Error; err != nil {
		return nil, err
	}
	for _, action := range actions {
		if action != nil {
			result[action.ActionID] = action
		}
	}
	return result, nil
}

// GetLatestActionRunsByActionIDs 批量读取每个 Action 最近一次 Run（按 id 取最新，即
// Action 当前/最近一次执行身份），供 Plan 列表摘要补充 Run 状态与活跃时间。
func GetLatestActionRunsByActionIDs(ctx context.Context, eid int64, actionIDs []string) (map[string]*ActionRunRecord, error) {
	result := make(map[string]*ActionRunRecord, len(actionIDs))
	if len(actionIDs) == 0 {
		return result, nil
	}
	var runs []*ActionRunRecord
	if err := DB.WithContext(ctx).Where("eid = ? AND action_id IN ?", eid, actionIDs).Order("id DESC").Find(&runs).Error; err != nil {
		return nil, err
	}
	for _, run := range runs {
		if run == nil {
			continue
		}
		if _, exists := result[run.ActionID]; !exists {
			result[run.ActionID] = run
		}
	}
	return result, nil
}

func GetActionArtifactForUser(ctx context.Context, eid, ownerID int64, runID, artifactID string) (*ActionArtifactRecord, error) {
	var artifact ActionArtifactRecord
	err := DB.WithContext(ctx).Table("action_artifacts AS aa").
		Select("aa.*").
		Joins("JOIN actions AS at ON at.eid = aa.eid AND at.action_id = aa.action_id").
		Where("aa.eid = ? AND aa.run_id = ? AND aa.artifact_id = ? AND at.owner_id = ?", eid, runID, artifactID, ownerID).
		First(&artifact).Error
	if err != nil {
		return nil, err
	}
	return &artifact, nil
}

// IsActionStatusTerminal reports whether the Action business lifecycle has
// reached a state the user no longer needs to act on.
func IsActionStatusTerminal(status string) bool {
	return status == ActionStatusAccepted
}

// IsActionStatusActive reports whether a new Run may still be created for the
// Action (failed/cancelled actions stay retryable via needs_attention).
func IsActionStatusActive(status string) bool {
	switch status {
	case ActionStatusDraft, ActionStatusReadyToConfirm, ActionStatusExecuting, ActionStatusNeedsAttention, ActionStatusAwaitingReview:
		return true
	default:
		return false
	}
}

func IsActionRunStatusTerminal(status string) bool {
	switch status {
	case ActionRunStatusCompleted, ActionRunStatusFailed, ActionRunStatusCancelled:
		return true
	default:
		return false
	}
}

func GenerateActionID() (string, error) { return generateActionID("action_") }

func GenerateActionRunID() (string, error) { return generateActionID("action_run_") }

func GenerateActionArtifactID() (string, error) { return generateActionID("action_artifact_") }

func GenerateActionEventID() (string, error) { return generateActionID("action_event_") }

func generateActionID(prefix string) (string, error) {
	var buf [16]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return "", fmt.Errorf("generate action id failed: %w", err)
	}
	return prefix + hex.EncodeToString(buf[:]), nil
}
