import { describe, expect, it } from 'vitest'
import { getChannelModelTypeKeys } from './channel-model-mapping'

describe('channel model mapping', () => {
  it('does not turn SystemOne endpoint metadata into a model after editing and reloading', () => {
    const config = {
      'qwen-plus': '1',
      'decision-model-preview': 5,
      decision_model_endpoints: {
        'decision-model-preview': 'https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/systemone',
      },
      alias_map: { 'decision-model-preview': 'Decision' },
      models: [{ model_id: 'decision-model-preview', model_type: 5 }],
      voice_models: {},
      deep_thinking: [],
    }
    // Preserve other and future model category values; don't enforce a type whitelist.
    Object.assign(config, { 'next-generation-model': '9' })
    const keys = getChannelModelTypeKeys(config)
    expect(keys).toEqual(['qwen-plus', 'decision-model-preview', 'next-generation-model'])
    expect(keys).not.toContain('decision_model_endpoints')
    expect(config.decision_model_endpoints['decision-model-preview']).toContain('/systemone')
  })
})
