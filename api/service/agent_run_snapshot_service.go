package service

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
)

const agentRunSnapshotTTL = 24 * time.Hour

type AgentRunSnapshot struct {
	Eid           int64  `json:"eid"`
	RunID         string `json:"run_id"`
	Status        string `json:"status"`
	CurrentStep   string `json:"current_step"`
	PartialText   string `json:"partial_text"`
	ReasoningText string `json:"reasoning_text"`
	LastEventID   int64  `json:"last_event_id"`
	UpdatedAt     int64  `json:"updated_at"`
}

type AgentRunSnapshotService struct {
	cache sync.Map
}

func NewAgentRunSnapshotService() *AgentRunSnapshotService {
	return &AgentRunSnapshotService{}
}

func (s *AgentRunSnapshotService) SaveSnapshot(ctx context.Context, run *model.AgentRun) error {
	if run == nil {
		return fmt.Errorf("run is nil")
	}
	if run.RunID == "" {
		return fmt.Errorf("run_id is required")
	}

	snapshot := &AgentRunSnapshot{
		Eid:           run.Eid,
		RunID:         run.RunID,
		Status:        run.Status,
		CurrentStep:   run.CurrentStep,
		PartialText:   run.PartialText,
		ReasoningText: run.ReasoningText,
		LastEventID:   run.LastEventID,
		UpdatedAt:     time.Now().UTC().UnixMilli(),
	}

	if err := model.UpdateAgentRunByRunID(run.Eid, run.RunID, map[string]interface{}{
		"status":         run.Status,
		"current_step":   run.CurrentStep,
		"partial_text":   run.PartialText,
		"reasoning_text": run.ReasoningText,
		"last_event_id":  run.LastEventID,
	}); err != nil {
		return err
	}

	s.cache.Store(agentRunSnapshotLocalCacheKey(run.Eid, run.RunID), snapshot)

	data, err := json.Marshal(snapshot)
	if err != nil {
		return err
	}
	if common.IsRedisEnabled() {
		if err := common.RedisSet(agentRunSnapshotCacheKey(run.Eid, run.RunID), string(data), agentRunSnapshotTTL); err != nil {
			logger.Warnf(ctx, "save run snapshot to redis failed: eid=%d, run_id=%s, err=%v", run.Eid, run.RunID, err)
		}
	}
	return nil
}

func (s *AgentRunSnapshotService) LoadSnapshot(ctx context.Context, eid int64, runID string) (*AgentRunSnapshot, error) {
	if runID == "" {
		return nil, fmt.Errorf("run_id is required")
	}

	if common.IsRedisEnabled() {
		if value, err := common.RedisGet(agentRunSnapshotCacheKey(eid, runID)); err == nil {
			var snapshot AgentRunSnapshot
			if unmarshalErr := json.Unmarshal([]byte(value), &snapshot); unmarshalErr == nil && snapshot.Eid == eid && snapshot.RunID == runID {
				s.cache.Store(agentRunSnapshotLocalCacheKey(eid, runID), &snapshot)
				return &snapshot, nil
			}
		} else if err != common.ErrRedisNil {
			logger.Warnf(ctx, "load run snapshot from redis failed: eid=%d, run_id=%s, err=%v", eid, runID, err)
		}
	}

	if value, ok := s.cache.Load(agentRunSnapshotLocalCacheKey(eid, runID)); ok {
		if snapshot, ok := value.(*AgentRunSnapshot); ok && snapshot.Eid == eid && snapshot.RunID == runID {
			return snapshot, nil
		}
	}

	run, err := model.GetAgentRunByRunID(eid, runID)
	if err != nil {
		return nil, err
	}

	snapshot := &AgentRunSnapshot{
		Eid:           run.Eid,
		RunID:         run.RunID,
		Status:        run.Status,
		CurrentStep:   run.CurrentStep,
		PartialText:   run.PartialText,
		ReasoningText: run.ReasoningText,
		LastEventID:   run.LastEventID,
		UpdatedAt:     run.UpdatedTime,
	}
	s.cache.Store(agentRunSnapshotLocalCacheKey(eid, runID), snapshot)
	return snapshot, nil
}

func agentRunSnapshotCacheKey(eid int64, runID string) string {
	return fmt.Sprintf("Cache:agent_run:snapshot:%d:%s", eid, runID)
}

func agentRunSnapshotLocalCacheKey(eid int64, runID string) string {
	return fmt.Sprintf("%d:%s", eid, runID)
}
