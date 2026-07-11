package service

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/53AI/53AIHub/model"
)

type AgentH5AuthService struct{}

func NewAgentH5AuthService() *AgentH5AuthService {
	return &AgentH5AuthService{}
}

func (s *AgentH5AuthService) CreateAccessKey(ctx context.Context, eid, agentID int64, source string, ttl time.Duration) (*model.AgentAccessKey, error) {
	if eid <= 0 {
		return nil, fmt.Errorf("eid is required")
	}
	if agentID <= 0 {
		return nil, fmt.Errorf("agent_id is required")
	}

	if _, err := model.GetAgentByID(eid, agentID); err != nil {
		return nil, fmt.Errorf("agent not found in agents table: eid=%d, agent_id=%d: %w", eid, agentID, err)
	}

	_ = ttl
	return model.CreateAgentAccessKey(eid, agentID, source, 0)
}

type ExchangeAccessKeyResult struct {
	User              *model.User
	AgentAccessKey    *model.AgentAccessKey
	UserChannel       *model.UserChannel
	UserChannelToken  *model.UserChannelToken
}

func (s *AgentH5AuthService) ExchangeAccessKey(ctx context.Context, fixedToken string, ttl time.Duration, fingerprintCode string) (*ExchangeAccessKeyResult, error) {
	fixedRecord, err := model.ValidateAgentAccessKey(fixedToken)
	if err != nil {
		return nil, err
	}

	fingerprintCode = strings.TrimSpace(fingerprintCode)
	if fingerprintCode == "" {
		return nil, fmt.Errorf("fingerprint_code is required")
	}

	// 先通过 fingerprint_code 查找现有 UserChannel
	// 如果找到，复用已关联的用户；否则创建新用户和新 channel
	channel, err := s.getOrCreateUserChannel(ctx, fixedRecord.Eid, fingerprintCode)
	if err != nil {
		return nil, err
	}

	// 通过 channel 获取关联的用户
	visitorUser, err := model.GetUserByID(channel.UserID)
	if err != nil {
		return nil, fmt.Errorf("failed to get visitor user: user_id=%d: %w", channel.UserID, err)
	}

	sessionToken, err := model.GetOrCreateUserChannelTokenWithRenewal(fixedRecord.Eid, visitorUser.UserID, channel.ID, ttl)
	if err != nil {
		return nil, err
	}

	return &ExchangeAccessKeyResult{
		User:              visitorUser,
		AgentAccessKey:    fixedRecord,
		UserChannel:       channel,
		UserChannelToken:  sessionToken,
	}, nil
}

func (s *AgentH5AuthService) getOrCreateUserChannel(ctx context.Context, eid int64, openid string) (*model.UserChannel, error) {
	// 查找现有 channel
	channel, err := model.GetUserChannelByOpenID(eid, openid)
	if err == nil && channel != nil {
		return channel, nil
	}

	if err != model.ErrUserChannelNotFound {
		return nil, err
	}

	// 没找到现有 channel，创建新访客用户
	visitorUser, err := model.CreateVisitorUser(eid, "")
	if err != nil {
		return nil, fmt.Errorf("failed to create visitor user: %w", err)
	}

	// 创建新 channel
	newChannel, err := model.CreateUserChannel(eid, visitorUser.UserID, model.ChannelTypeWebEmbed, openid)
	if err != nil {
		return nil, fmt.Errorf("failed to create user channel: %w", err)
	}

	return newChannel, nil
}

func (s *AgentH5AuthService) GetAgentInfoByAccessKey(ctx context.Context, fixedToken string) (*model.Agent, error) {
	fixedRecord, err := model.ValidateAgentAccessKey(fixedToken)
	if err != nil {
		return nil, err
	}

	agent, err := model.GetAgentByID(fixedRecord.Eid, fixedRecord.AgentID)
	if err != nil {
		return nil, fmt.Errorf("agent not found in agents table: eid=%d, agent_id=%d: %w", fixedRecord.Eid, fixedRecord.AgentID, err)
	}

	if err := agent.LoadUserGroupIds(); err != nil {
		return nil, fmt.Errorf("failed to load user group ids: %w", err)
	}

	agent.FillBotID()
	return agent, nil
}

func (s *AgentH5AuthService) RevokeToken(ctx context.Context, token string) (bool, error) {
	return model.DeleteUserChannelTokenByToken(token)
}