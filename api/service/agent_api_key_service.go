package service

import (
	"context"
	"fmt"
	"time"

	"github.com/53AI/53AIHub/model"
)

type AgentAPIKeyService struct{}

func NewAgentAPIKeyService() *AgentAPIKeyService {
	return &AgentAPIKeyService{}
}

func (s *AgentAPIKeyService) CreateAPIKey(ctx context.Context, eid, agentID int64, ttl time.Duration) (*model.AgentAccessKey, error) {
	if eid <= 0 {
		return nil, fmt.Errorf("eid is required")
	}
	if agentID <= 0 {
		return nil, fmt.Errorf("agent_id is required")
	}

	if _, err := model.GetAgentByID(eid, agentID); err != nil {
		return nil, fmt.Errorf("agent not found: eid=%d, agent_id=%d: %w", eid, agentID, err)
	}

	return model.CreateAgentAccessKey(eid, agentID, model.SourceAPI, ttl)
}
