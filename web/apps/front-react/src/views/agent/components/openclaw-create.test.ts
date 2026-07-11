import { describe, expect, it } from 'vitest'
import {
  AGENT_MODES,
  BACKEND_AGENT_TYPE,
  buildOpenClawInstallCommand,
  createFrontPlatformsByType,
  type CreateAgentDialogResult,
} from '@km/shared-business/agent-create'
import { buildOpenClawPersonalAgentPayload } from './openclaw-create'

function createDialogResult(agentType: string): CreateAgentDialogResult {
  return {
    agentType,
    name: `${agentType} agent`,
    description: `${agentType} description`,
    logo: `/images/agent/${agentType}.png`,
    backend_agent_type: BACKEND_AGENT_TYPE.ASSISTANT,
    agent_mode: AGENT_MODES.ASSISTANT,
  }
}

function parseCustomConfig(payload: ReturnType<typeof buildOpenClawPersonalAgentPayload>) {
  return JSON.parse(payload.custom_config)
}

describe('OpenClaw compatible personal agent creation', () => {
  it('temporarily exposes only OpenClaw and QClaw as creatable assistant options', () => {
    const platforms = createFrontPlatformsByType('/api/images')
    const byValue = Object.fromEntries(platforms.map((platform) => [platform.value, platform]))

    expect(Object.keys(byValue)).toEqual(['openclaw', 'qclaw'])
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

  it('writes Codex metadata and runner command into the personal creation payload', () => {
    const payload = buildOpenClawPersonalAgentPayload(createDialogResult('codex'), 88)
    const customConfig = parseCustomConfig(payload)

    expect(payload).toMatchObject({
      channel_type: 1016,
      model: 'openclaw-ws',
      agent_type: BACKEND_AGENT_TYPE.ASSISTANT,
      logo: '/images/agent/codex.png',
    })
    expect(customConfig).toMatchObject({
      agent_type: 'codex',
      agent_mode: AGENT_MODES.ASSISTANT,
      hostKind: 'codex',
      runnerCommand: 'codex-app-server',
      channel_id: 88,
    })
    expect(payload.channel_type).toBe(1016)
  })

  it('does not write a runner command for QClaw personal agents', () => {
    const payload = buildOpenClawPersonalAgentPayload(createDialogResult('qclaw'), 99)
    const customConfig = parseCustomConfig(payload)

    expect(customConfig).toMatchObject({
      agent_type: 'qclaw',
      agent_mode: AGENT_MODES.ASSISTANT,
      hostKind: 'qclaw',
      channel_id: 99,
    })
    expect(payload.channel_type).toBe(1015)
    expect(customConfig).not.toHaveProperty('runnerCommand')
  })

  it('does not write a runner command for Manus personal agents', () => {
    const payload = buildOpenClawPersonalAgentPayload(createDialogResult('manus'), 100)
    const customConfig = parseCustomConfig(payload)

    expect(customConfig).toMatchObject({
      agent_type: 'manus',
      agent_mode: AGENT_MODES.ASSISTANT,
      hostKind: 'manus',
      channel_id: 100,
    })
    expect(payload.channel_type).toBe(1017)
    expect(customConfig).not.toHaveProperty('runnerCommand')
  })

  it('uses host kind to select OpenClaw without exposing local paths', () => {
    const command = buildOpenClawInstallCommand({
      botId: 'bot-1',
      secret: 'sk-test',
      wsUrl: 'ws://localhost:9002/api/v1/openclaw/ws/connect',
      agentType: 'openclaw',
    })

    expect(command).toBe(
      'npx --yes @53ai/53ai-openclaw@latest install --host-kind openclaw --hub-bot-id "bot-1" --hub-secret "sk-test" --hub-ws-url "ws://localhost:9002/api/v1/openclaw/ws/connect"',
    )
    expect(command).not.toContain('--config-path')
    expect(command).not.toContain('--extensions-dir')
  })

  it('uses host kind to select QClaw without exposing local paths', () => {
    const command = buildOpenClawInstallCommand({
      botId: 'bot-1',
      secret: 'sk-test',
      wsUrl: 'ws://localhost:9002/api/v1/openclaw/ws/connect',
      agentType: 'qclaw',
    })

    expect(command).toBe(
      'npx --yes @53ai/53ai-openclaw@latest install --host-kind qclaw --hub-bot-id "bot-1" --hub-secret "sk-test" --hub-ws-url "ws://localhost:9002/api/v1/openclaw/ws/connect"',
    )
    expect(command).not.toContain('--config-path')
    expect(command).not.toContain('--extensions-dir')
  })

  it('uses host kind to select Codex through the unified installer', () => {
    expect(buildOpenClawInstallCommand({
      botId: 'bot-1',
      secret: 'sk-test',
      wsUrl: 'ws://localhost:9002/api/v1/openclaw/ws/connect',
      agentType: 'codex',
    })).toBe(
      'npx --yes @53ai/53ai-openclaw@latest install --host-kind codex --hub-bot-id "bot-1" --hub-secret "sk-test" --hub-ws-url "ws://localhost:9002/api/v1/openclaw/ws/connect"',
    )
  })

  it('uses host kind to select Manus through the unified installer', () => {
    expect(buildOpenClawInstallCommand({
      botId: 'bot-1',
      secret: 'sk-test',
      wsUrl: 'ws://localhost:9002/api/v1/openclaw/ws/connect',
      agentType: 'manus',
    })).toBe(
      'npx --yes @53ai/53ai-openclaw@latest install --host-kind manus --hub-bot-id "bot-1" --hub-secret "sk-test" --hub-ws-url "ws://localhost:9002/api/v1/openclaw/ws/connect"',
    )
  })
})
