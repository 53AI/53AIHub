import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { AgentFormData } from '@km/shared-business/agent-create'

vi.mock('@km/hub-ui-x-react', () => ({
  XBubbleAssistant: () => null,
  XBubbleList: () => null,
  XBubbleUser: () => null,
  XIcon: () => null,
  XSender: () => null,
}))

const storageMock = {
  clear: vi.fn(),
  getItem: vi.fn(() => null),
  key: vi.fn(() => null),
  removeItem: vi.fn(),
  setItem: vi.fn(),
  length: 0,
}

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: storageMock,
})

Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: storageMock,
})

let transformToFormData: (data: any) => AgentFormData

beforeAll(async () => {
  const adapterModule = await import('./agent-create-adapter')
  transformToFormData = adapterModule.transformToFormData
})

describe('console agent create adapter OpenClaw compatibility', () => {
  it('normalizes legacy OpenClawWS prompt metadata without prompt model rewriting', () => {
    const formData = transformToFormData({
      agent_id: 456,
      bot_id: 'xuGoCp',
      logo: '/api/images/agent/openclaw.png',
      name: 'legacy openclaw',
      channel_type: 1014,
      model: 'openclaw-ws',
      custom_config: {
        agent_type: 'prompt',
        channel_id: 11,
        openclaw_app_secret: 'sk-existing',
      },
      configs: {},
      settings: {},
    })

    expect(formData.model).toBe('openclaw-ws')
    expect(formData.model).not.toContain('_53aikm_')
    expect(formData.logo).toBe('/images/agent/openclaw.png')
    expect(formData.custom_config).toMatchObject({
      agent_type: 'openclaw',
      hostKind: 'openclaw',
      channel_id: 11,
      openclaw_app_secret: 'sk-existing',
    })
    expect(formData.configs).toEqual({})
    expect(formData.settings).toEqual({})
  })

  it('keeps regular prompt agents on the prompt model value path', () => {
    const formData = transformToFormData({
      agent_id: 457,
      logo: '/api/images/agent/prompt.png',
      name: 'prompt',
      channel_type: 1,
      model: 'gpt-4o-mini',
      custom_config: {
        agent_type: 'prompt',
        channel_id: 22,
      },
      configs: {},
      settings: {},
    })

    expect(formData.model).toBe('22_53aikm_gpt-4o-mini_53aikm_1')
    expect(formData.custom_config.agent_type).toBe('prompt')
    expect(formData.custom_config).not.toHaveProperty('hostKind')
  })

  it('preserves explicit Codex metadata and corrects the channel type', () => {
    const formData = transformToFormData({
      agent_id: 458,
      logo: '/api/images/agent/codex.png',
      name: 'codex',
      channel_type: 1014,
      model: 'openclaw-ws',
      custom_config: {
        agent_type: 'codex',
        hostKind: 'codex',
      },
      configs: {},
      settings: {},
    })

    expect(formData.channel_type).toBe(1016)
    expect(formData.logo).toBe('/images/agent/codex.png')
    expect(formData.custom_config).toMatchObject({
      agent_type: 'codex',
      hostKind: 'codex',
      runnerCommand: 'codex-app-server',
    })
  })
})
