import { describe, expect, it } from 'vitest'
import { transformSelectData, type RawChannelItem } from '@/api/modules/channel'

describe('transformSelectData model capabilities', () => {
  it('preserves native web search metadata for agent model selection', () => {
    const channel = {
      channel_id: 880,
      eid: 1,
      type: 44,
      weight: 1,
      name: 'SiliconFlow',
      models: 'deepseek-ai/DeepSeek-V4.1-Flash',
      config: JSON.stringify([{
        model_id: 'deepseek-ai/DeepSeek-V4.1-Flash',
        upstream_api_format: 'responses',
        enabled_tools: ['function', 'web_search'],
      }]),
      custom_config: JSON.stringify({ deep_thinking: [] }),
      other: '',
      model_mapping: '',
      priority: 1,
      used_quota: 0,
      status: 1,
      balance: 0,
      balance_updated_time: 0,
      test_time: 0,
      response_time: 0,
      provider_id: 0,
      created_time: 0,
      updated_time: 0,
    } as RawChannelItem

    const option = transformSelectData(channel).options[0]

    expect(option).toMatchObject({
      enabled_tools: ['function', 'web_search'],
      upstream_api_format: 'responses',
    })
  })
})
