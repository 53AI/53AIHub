import { describe, it, expect } from 'vitest'
import { transformSelectData, RawChannelItem } from './index'

describe('transformSelectData', () => {
  const mockRawChannel: RawChannelItem = {
    channel_id: 123,
    eid: 1,
    type: 36,
    weight: 1,
    name: 'test-channel',
    models: 'deepseek-chat,deepseek-coder',
    config: '{}',
    custom_config: '{"deepseek-chat": "1", "deepseek-coder": "1"}',
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
  }

  it('should transform raw channel data with correct value format', () => {
    const result = transformSelectData(mockRawChannel)

    expect(result.options).toHaveLength(2)
    expect(result.options[0].value).toBe('123_53aikm_deepseek-chat')
    expect(result.options[0].provider_name).toBe('DeepSeek')
  })

  it('should include provider_name from platform_name', () => {
    const result = transformSelectData(mockRawChannel)

    expect(result.options[0].provider_name).toBeDefined()
    expect(result.options[0].provider_name).toBe('DeepSeek')
  })

  it('should filter options by type when provided', () => {
    const result = transformSelectData(mockRawChannel, '1')

    expect(result.options.length).toBeGreaterThan(0)
  })
})
