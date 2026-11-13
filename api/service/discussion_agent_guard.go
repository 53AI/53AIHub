package service

import (
	"context"
	"fmt"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
)

// 二号总裁「探讨」Agent 的精确身份与工具授权（Phase 2C Slice 0 / Phase 2D 安全前置）。
//
// 授权原则（比「按 AgentUsageRecording 类型全局开放」更严格）：
//  1. 必须是系统初始化的录音应用智能体：AgentUsage == AgentUsageRecording 且 IsSystem == true；
//  2. 在满足 (1) 的候选中，只认「规范实例」= 该企业 agent_id 最小的那一个（与存量迁移
//     agent_system_flag_backfill 的「每种 usage 首个 agent 标记 is_system」语义一致），
//     从而即使存在多个 is_system 录音 Agent，也不会同时获得经营 Tool；
//  3. 该判定既用于 Prompt 构建阶段的工具注入，也必须在**工具执行入口**再次校验（纵深防御）。

// ResolveDiscussionAgentID 返回该企业规范的探讨 Agent ID；无候选项时返回 0。
func ResolveDiscussionAgentID(eid int64) int64 {
	if eid <= 0 || model.DB == nil {
		return 0
	}
	var agentID int64
	err := model.DB.Model(&model.Agent{}).
		Where("eid = ? AND agent_usage = ? AND is_system = ?", eid, model.AgentUsageRecording, true).
		Order("agent_id ASC").
		Limit(1).
		Pluck("agent_id", &agentID).Error
	if err != nil || agentID <= 0 {
		return 0
	}
	return agentID
}

// IsAuthorizedDiscussionAgent 判定某个 Agent 是否为该企业规范的探讨 Agent。
func IsAuthorizedDiscussionAgent(agent *model.Agent) bool {
	if agent == nil {
		return false
	}
	if agent.AgentUsage != model.AgentUsageRecording || !agent.IsSystem {
		return false
	}
	canonical := ResolveDiscussionAgentID(agent.Eid)
	return canonical > 0 && agent.AgentID == canonical
}

// ErrDiscussionToolUnauthorized 工具执行入口授权失败。
var ErrDiscussionToolUnauthorized = fmt.Errorf("discussion tool caller is not authorized")

// AuthorizeDiscussionToolCall 工具执行入口的纵深校验：用服务端上下文中的 (eid, agentID)
// 反查 Agent 并核对是否为规范探讨实例。模型无法通过参数影响该判定。
func AuthorizeDiscussionToolCall(ctx context.Context, eid, agentID int64) error {
	if eid <= 0 || agentID <= 0 {
		return ErrDiscussionToolUnauthorized
	}
	agent, err := model.GetAgentByID(eid, agentID)
	if err != nil || agent == nil {
		logger.Warnf(ctx, "【探讨-工具授权】Agent 查询失败: eid=%d, agent_id=%d, err=%v", eid, agentID, err)
		return ErrDiscussionToolUnauthorized
	}
	if !IsAuthorizedDiscussionAgent(agent) {
		logger.Warnf(ctx, "【探讨-工具授权】非规范探讨实例，拒绝工具调用: eid=%d, agent_id=%d, usage=%d, is_system=%v",
			eid, agentID, agent.AgentUsage, agent.IsSystem)
		return ErrDiscussionToolUnauthorized
	}
	return nil
}
