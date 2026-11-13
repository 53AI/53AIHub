import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { AgentFormData } from '@km/shared-business/agent-create'
import service from '@/api/config'
import channelApi from '@/api/modules/channel'

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
let consoleAgentAdapter: (typeof import('./agent-create-adapter'))['consoleAgentAdapter']

beforeAll(async () => {
  const adapterModule = await import('./agent-create-adapter')
  transformToFormData = adapterModule.transformToFormData
  consoleAgentAdapter = adapterModule.consoleAgentAdapter
})

const saveAndReloadSettings = async (formData: AgentFormData) => {
  let savedRecord: Record<string, unknown> = {}
  let serializedSettings: Record<string, unknown> = {}

  vi.spyOn(service, 'put').mockImplementation(async (_url, data) => {
    const requestData = data as Record<string, unknown>
    serializedSettings = JSON.parse(String(requestData.settings)) as Record<string, unknown>
    savedRecord = { ...requestData, agent_id: 456, agent_usage: 0 }
    return { data: savedRecord } as never
  })
  vi.spyOn(service, 'get').mockImplementation(async () => ({ data: savedRecord }) as never)

  await consoleAgentAdapter.save(formData)
  const reloaded = await consoleAgentAdapter.getDetail(456)

  return { serializedSettings, settings: reloaded.settings }
}

const createFormData = (settings: Record<string, unknown>) => transformToFormData({
  agent_id: 456,
  name: 'legacy agent',
  channel_type: 1,
  model: 'gpt-4o-mini',
  custom_config: { agent_type: 'prompt', channel_id: 22 },
  configs: {},
  settings,
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

describe('console agent decision model provider filtering', () => {
  it('lists Bailian DECISION and Jev models without exposing normal Bailian models or Bailian agents', async () => {
    const channels = [
      { channel_id: 101, type: 17, name: 'Bailian', models: 'decision-model-preview,qwen-plus',
        custom_config: JSON.stringify({ 'decision-model-preview': '5', 'qwen-plus': '1' }), config: '[]' },
      { channel_id: 102, type: 1020, name: 'Jev', models: 'jev-latest',
        custom_config: JSON.stringify({ 'jev-latest': '5' }), config: '[]' },
      { channel_id: 103, type: 1003, name: 'Bailian agent', models: 'decision-model-preview',
        custom_config: JSON.stringify({ 'decision-model-preview': '5' }), config: '[]' },
    ]
    vi.spyOn(channelApi, 'listv2').mockResolvedValue(channels as never)
    const result = await consoleAgentAdapter.loadDecisionModels()
    expect(result.map((channel) => channel.value)).toEqual(['101', '102'])
    expect(result[0].options).toHaveLength(1)
    expect(result[0].options[0].label).toBe('decision-model-preview')
    expect(result[1].options[0].label).toBe('jev-latest')
  })
})

describe('console agent create adapter Jev settings round trip', () => {
  it('does not add decision settings to an old agent and preserves its settings', async () => {
    const { serializedSettings, settings } = await saveAndReloadSettings(createFormData({
      opening_statement: 'Hello',
      legacy_setting: 'preserve',
    }))

    expect(serializedSettings).toMatchObject({
      opening_statement: 'Hello',
      legacy_setting: 'preserve',
    })
    expect(serializedSettings).not.toHaveProperty('intent_decision_config')
    expect(settings).toMatchObject({
      opening_statement: 'Hello',
      legacy_setting: 'preserve',
    })
    expect(settings).not.toHaveProperty('intent_decision_config')
  })

  it('preserves enabled Jev settings through save and reload', async () => {
    const config = {
      enable: true,
      channel_id: 42,
      model_name: 'jev-latest',
      confidence_threshold: 0.9,
    }
    const { serializedSettings, settings } = await saveAndReloadSettings(createFormData({
      legacy_setting: 'preserve',
      intent_decision_config: config,
    }))

    expect(serializedSettings).toMatchObject({ intent_decision_config: config, legacy_setting: 'preserve' })
    expect(settings.intent_decision_config).toEqual(config)
  })

  it('preserves the disabled Jev state through save and reload', async () => {
    const config = {
      enable: false,
      channel_id: 42,
      model_name: 'jev-latest',
      confidence_threshold: 0.8,
    }
    const { serializedSettings, settings } = await saveAndReloadSettings(createFormData({
      intent_decision_config: config,
    }))

    expect(serializedSettings).toMatchObject({ intent_decision_config: config })
    expect(settings.intent_decision_config).toEqual(config)
  })
})
