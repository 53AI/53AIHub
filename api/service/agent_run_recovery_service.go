package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

const (
	agentRunRecoveryInterval    = time.Minute
	agentRunRecoveryBatchSize   = 100
	agentRunRecoveryCancelGrace = 5 * time.Minute
	agentRunRecoveryLockTTL     = 2 * time.Minute
)

type agentRunRecoveryAction string

const (
	agentRunRecoverySkip     agentRunRecoveryAction = "skip"
	agentRunRecoveryComplete agentRunRecoveryAction = "complete"
	agentRunRecoveryFail     agentRunRecoveryAction = "fail"
	agentRunRecoveryCancel   agentRunRecoveryAction = "cancel"
)

type agentRunRecoveryPolicy struct {
	CompletionGrace time.Duration
	MaxRunAge       time.Duration
	CancelGrace     time.Duration
	BatchSize       int
}

func defaultAgentRunRecoveryPolicy() agentRunRecoveryPolicy {
	maxRunAge := time.Duration(config.AGENT_MAX_WALL_CLOCK_SECONDS)*time.Second + 5*time.Minute
	if maxRunAge <= 0 {
		maxRunAge = 20 * time.Minute
	}
	return agentRunRecoveryPolicy{
		CompletionGrace: 20 * time.Minute,
		MaxRunAge:       maxRunAge,
		CancelGrace:     agentRunRecoveryCancelGrace,
		BatchSize:       agentRunRecoveryBatchSize,
	}
}

func classifyAgentRunRecovery(run *model.AgentRun, event *model.AgentRunEvent, now time.Time, policy agentRunRecoveryPolicy) agentRunRecoveryAction {
	if run == nil || isAgentRunTerminalStatus(run.Status) {
		return agentRunRecoverySkip
	}
	// requires_action is intentionally left for the user/agent action resolver.
	// Its age alone does not prove that the run is abandoned.
	if run.Status == model.AgentRunStatusRequiresAction {
		return agentRunRecoverySkip
	}

	lastActivity := time.UnixMilli(run.StartedAt)
	if event != nil && event.CreatedAt > 0 {
		lastActivity = time.UnixMilli(event.CreatedAt)
	}
	activityAge := now.Sub(lastActivity)
	if activityAge < 0 {
		activityAge = 0
	}

	if run.Status == model.AgentRunStatusCancelling {
		if activityAge >= policy.CancelGrace {
			return agentRunRecoveryCancel
		}
		return agentRunRecoverySkip
	}

	if event != nil && event.EventType == model.AgentRunEventMessageDone && activityAge >= policy.CompletionGrace {
		return agentRunRecoveryComplete
	}

	runAge := now.Sub(time.UnixMilli(run.StartedAt))
	if runAge < 0 {
		runAge = 0
	}
	if runAge >= policy.MaxRunAge && activityAge >= policy.CompletionGrace {
		return agentRunRecoveryFail
	}
	return agentRunRecoverySkip
}

type AgentRunRecoveryStats struct {
	Scanned   int
	Skipped   int
	Completed int
	Failed    int
	Cancelled int
	Errors    int
}

type AgentRunRecoveryService struct {
	policy agentRunRecoveryPolicy
}

func NewAgentRunRecoveryService() *AgentRunRecoveryService {
	return &AgentRunRecoveryService{policy: defaultAgentRunRecoveryPolicy()}
}

func newAgentRunRecoveryServiceWithPolicy(policy agentRunRecoveryPolicy) *AgentRunRecoveryService {
	if policy.BatchSize <= 0 {
		policy.BatchSize = agentRunRecoveryBatchSize
	}
	return &AgentRunRecoveryService{policy: policy}
}

func (s *AgentRunRecoveryService) RecoverOnce(ctx context.Context, now time.Time) (AgentRunRecoveryStats, error) {
	var stats AgentRunRecoveryStats
	if s == nil || model.DB == nil {
		return stats, nil
	}
	if ctx == nil {
		ctx = context.Background()
	}

	unlock, ok := tryAgentRunRecoveryLock()
	if !ok {
		return stats, nil
	}
	defer unlock()

	cutoff := now.Add(-s.policy.MaxRunAge).UnixMilli()
	var runs []model.AgentRun
	if err := model.DB.WithContext(ctx).
		Where("status IN ?", []string{
			model.AgentRunStatusQueued,
			model.AgentRunStatusRunning,
			model.AgentRunStatusCancelling,
		}).
		Where("started_at <= ?", cutoff).
		Order("started_at ASC, id ASC").
		Limit(s.policy.BatchSize).
		Find(&runs).Error; err != nil {
		return stats, err
	}

	finalizer := NewAgentRunService()
	var recoveryErrors []error
	for i := range runs {
		run := &runs[i]
		stats.Scanned++

		unlockRun, locked := tryAgentRunRecoveryRunLock(run.RunID)
		if !locked {
			stats.Skipped++
			continue
		}

		event, err := latestAgentRunRecoveryEvent(ctx, run)
		if err != nil {
			unlockRun()
			stats.Errors++
			recoveryErrors = append(recoveryErrors, fmt.Errorf("run_id=%s load latest event: %w", run.RunID, err))
			continue
		}

		action := classifyAgentRunRecovery(run, event, now, s.policy)
		if action == agentRunRecoverySkip {
			stats.Skipped++
			unlockRun()
			continue
		}

		var finalizeErr error
		switch action {
		case agentRunRecoveryComplete:
			_, finalizeErr = finalizer.FinalizeCompletedRun(ctx, run.Eid, run.RunID, "stale_message_completed", "recovered from a stale message.completed event")
			if finalizeErr == nil {
				stats.Completed++
			}
		case agentRunRecoveryFail:
			_, finalizeErr = finalizer.FinalizeFailedRun(ctx, run.Eid, run.RunID, "stale_run_recovered", "agent run exceeded the recovery timeout without a terminal event")
			if finalizeErr == nil {
				stats.Failed++
			}
		case agentRunRecoveryCancel:
			_, finalizeErr = finalizer.FinalizeCancelledRun(ctx, run.Eid, run.RunID, "stale_cancellation_recovered", "agent run remained cancelling beyond the recovery timeout")
			if finalizeErr == nil {
				stats.Cancelled++
			}
		}
		unlockRun()
		if finalizeErr != nil {
			stats.Errors++
			recoveryErrors = append(recoveryErrors, fmt.Errorf("run_id=%s action=%s: %w", run.RunID, action, finalizeErr))
			continue
		}
		logger.Infof(ctx, "【AgentRun恢复】历史Run已收口: eid=%d run_id=%s old_status=%s action=%s last_event_id=%d", run.Eid, run.RunID, run.Status, action, run.LastEventID)
	}

	if len(recoveryErrors) > 0 {
		return stats, errors.Join(recoveryErrors...)
	}
	return stats, nil
}

func latestAgentRunRecoveryEvent(ctx context.Context, run *model.AgentRun) (*model.AgentRunEvent, error) {
	if run == nil {
		return nil, nil
	}
	query := model.DB.WithContext(ctx).Where("eid = ? AND run_id = ?", run.Eid, run.RunID)
	var event model.AgentRunEvent
	var err error
	if run.LastEventID > 0 {
		err = query.Where("id = ?", run.LastEventID).First(&event).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			err = nil
		}
	}
	if err == nil && event.ID > 0 {
		return &event, nil
	}
	if err != nil {
		return nil, err
	}
	err = query.Order("seq DESC, id DESC").First(&event).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &event, nil
}

func tryAgentRunRecoveryLock() (func(), bool) {
	if common.LOCKER == nil {
		return func() {}, true
	}
	if !common.LOCKER.TryLock("agent-run:recovery:global", agentRunRecoveryLockTTL) {
		return nil, false
	}
	return func() { common.LOCKER.Unlock("agent-run:recovery:global") }, true
}

func tryAgentRunRecoveryRunLock(runID string) (func(), bool) {
	if common.LOCKER == nil {
		return func() {}, true
	}
	lockName := fmt.Sprintf("agent-run:recovery:%s", runID)
	if !common.LOCKER.TryLock(lockName, agentRunRecoveryLockTTL) {
		return nil, false
	}
	return func() { common.LOCKER.Unlock(lockName) }, true
}

func (s *AgentRunRecoveryService) Start(ctx context.Context, interval time.Duration) {
	if s == nil || model.DB == nil {
		return
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if interval <= 0 {
		interval = agentRunRecoveryInterval
	}
	go func() {
		if stats, err := s.RecoverOnce(ctx, time.Now().UTC()); err != nil {
			logger.SysWarnf("【AgentRun恢复】启动扫描失败: stats=%+v err=%v", stats, err)
		} else if stats.Scanned > 0 {
			logger.SysLogf("【AgentRun恢复】启动扫描完成: %+v", stats)
		}

		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				stats, err := s.RecoverOnce(ctx, time.Now().UTC())
				if err != nil {
					logger.SysWarnf("【AgentRun恢复】周期扫描失败: stats=%+v err=%v", stats, err)
				} else if stats.Scanned > 0 {
					logger.SysLogf("【AgentRun恢复】周期扫描完成: %+v", stats)
				}
			}
		}
	}()
}

func StartAgentRunRecoveryWorker(ctx context.Context) {
	NewAgentRunRecoveryService().Start(ctx, agentRunRecoveryInterval)
}
