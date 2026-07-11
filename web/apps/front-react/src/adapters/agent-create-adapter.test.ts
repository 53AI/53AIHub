import { describe, expect, it } from 'vitest'
import { transformToFormData } from './agent-create-adapter'

describe('front agent create adapter OpenClaw compatibility', () => {
  it('normalizes legacy OpenClawWS prompt metadata into OpenClaw form data', () => {
    const formData = transformToFormData({
      agent_id: 123,
      bot_id: 'ERghxL',
      logo: '/api/images/agent/openclaw.png',
      name: 'legacy openclaw',
      channel_type: 1014,
      model: 'openclaw-ws',
      custom_config: {
        agent_type: 'prompt',
        channel_id: 8,
        openclaw_app_secret: 'sk-existing',
      },
      configs: {},
      settings: {},
    })

    expect(formData.model).toBe('openclaw-ws')
    expect(formData.logo).toBe('/images/agent/openclaw.png')
    expect(formData.custom_config).toMatchObject({
      agent_type: 'openclaw',
      hostKind: 'openclaw',
      channel_id: 8,
      openclaw_app_secret: 'sk-existing',
    })
    expect(formData.configs).toEqual({})
    expect(formData.settings).toEqual({})
  })

  it('preserves explicit Codex metadata while filling the runner command', () => {
    const formData = transformToFormData({
      agent_id: 124,
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

    expect(formData.logo).toBe('/images/agent/codex.png')
    expect(formData.channel_type).toBe(1016)
    expect(formData.custom_config).toMatchObject({
      agent_type: 'codex',
      hostKind: 'codex',
      runnerCommand: 'codex-app-server',
    })
  })
})
