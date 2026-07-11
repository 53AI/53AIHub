import { describe, expect, it } from 'vitest'
import {
  AGENT_MODES,
  BACKEND_AGENT_TYPE,
  createPlatformsByType,
  type CreateAgentDialogResult,
} from '@km/shared-business/agent-create'
import { buildOpenClawEnterpriseAgentPayload } from './openclaw-create'

function createDialogResult(agentType: string): CreateAgentDialogResult {
  return {
    agentType,
    name: `${agentType} agent`,
    description: `${agentType} description`,
    logo: `/api/images/agent/${agentType}.png`,
    groupId: 12,
    backend_agent_type: BACKEND_AGENT_TYPE.ASSISTANT,
    agent_mode: AGENT_MODES.ASSISTANT,
  }
}

describe('OpenClaw compatible enterprise agent creation', () => {
  it('temporarily exposes only OpenClaw and QClaw as creatable assistant options', () => {
    const platforms = createPlatformsByType('/api/images')
    const byValue = Object.fromEntries(platforms.map((platform) => [platform.value, platform]))

    expect(byValue.openclaw).toMatchObject({
      label: 'OpenClaw',
      icon: '/images/agent/openclaw.png',
      channel_type: 1014,
      agent_type: BACKEND_AGENT_TYPE.ASSISTANT,
      agent_mode: AGENT_MODES.ASSISTANT,
    })
    expect(byValue.qclaw).toMatchObject({
      label: 'QClaw',
      icon: '/images/agent/qclaw.png',
      channel_type: 1015,
      agent_type: BACKEND_AGENT_TYPE.ASSISTANT,
      agent_mode: AGENT_MODES.ASSISTANT,
    })
    expect(byValue.codex).toBeUndefined()
    expect(byValue.manus).toBeUndefined()
  })

  it('writes Codex metadata and runner command into the enterprise creation payload', () => {
    const payload = buildOpenClawEnterpriseAgentPayload({
      data: createDialogResult('codex'),
      channelId: 77,
      subscriptionGroupIds: [1, 2],
      internalGroupIds: [3, 4],
    })

    expect(payload).toMatchObject({
      channel_type: 1016,
      model: 'openclaw-ws',
      agent_type: BACKEND_AGENT_TYPE.ASSISTANT,
      logo: '/images/agent/codex.png',
      subscription_group_ids: [1, 2],
      user_group_ids: [3, 4],
      custom_config: {
        agent_type: 'codex',
        agent_mode: AGENT_MODES.ASSISTANT,
        hostKind: 'codex',
        runnerCommand: 'codex-app-server',
        channel_id: 77,
      },
    })
  })

  it('does not write a runner command for QClaw enterprise agents', () => {
    const payload = buildOpenClawEnterpriseAgentPayload({
      data: createDialogResult('qclaw'),
      channelId: 66,
      subscriptionGroupIds: [],
      internalGroupIds: [],
    })

    expect(payload.custom_config).toMatchObject({
      agent_type: 'qclaw',
      agent_mode: AGENT_MODES.ASSISTANT,
      hostKind: 'qclaw',
      channel_id: 66,
    })
    expect(payload.channel_type).toBe(1015)
    expect(payload.custom_config).not.toHaveProperty('runnerCommand')
  })

  it('does not write a runner command for Manus enterprise agents', () => {
    const payload = buildOpenClawEnterpriseAgentPayload({
      data: createDialogResult('manus'),
      channelId: 67,
      subscriptionGroupIds: [],
      internalGroupIds: [],
    })

    expect(payload.custom_config).toMatchObject({
      agent_type: 'manus',
      agent_mode: AGENT_MODES.ASSISTANT,
      hostKind: 'manus',
      channel_id: 67,
    })
    expect(payload.channel_type).toBe(1017)
    expect(payload.custom_config).not.toHaveProperty('runnerCommand')
  })
})
