/**
 * Agent Create 模块测试工具函数
 */

import { vi } from 'vitest'
import type { FormData, Settings, CustomConfig, GroupOption } from '../../types'

/**
 * 创建默认表单数据
 */
export function createMockFormData(overrides: Partial<FormData> = {}): FormData {
  return {
    logo: '',
    name: '',
    group_id: 0,
    description: '',
    channel_type: 0,
    model: '',
    sort: 0,
    prompt: '',
    user_group_ids: [],
    subscription_group_ids: [],
    tools: [],
    use_cases: [],
    configs: { completion_params: { temperature: 0.2, top_p: 0.75, presence_penalty: 0.5, frequency_penalty: 0.5 } },
    custom_config: {
      agent_type: 'prompt',
      agent_mode: 'chat',
      provider_id: 0,
      channel_id: 0,
      coze_workspace_id: '',
      coze_bot_id: '',
      coze_bot_url: '',
      app_builder_bot_id: '',
      tencent_bot_id: '',
      chat53ai_agent_id: '',
      channel_config: {},
    },
    settings: {
      opening_statement: '',
      suggested_questions: [],
      file_parse: { enable: false },
      image_parse: { vision: false, enable: false },
      relate_agents: [],
      input_fields: [],
      output_fields: [],
    },
    ...overrides,
  }
}

/**
 * 创建默认 Settings
 */
export function createMockSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    opening_statement: '',
    suggested_questions: [],
    file_parse: { enable: false },
    image_parse: { vision: false, enable: false },
    relate_agents: [],
    input_fields: [],
    output_fields: [],
    ...overrides,
  }
}

/**
 * 创建默认 CustomConfig
 */
export function createMockCustomConfig(overrides: Partial<CustomConfig> = {}): CustomConfig {
  return {
    agent_type: 'prompt',
    agent_mode: 'chat',
    provider_id: 0,
    channel_id: 0,
    coze_workspace_id: '',
    coze_bot_id: '',
    coze_bot_url: '',
    app_builder_bot_id: '',
    tencent_bot_id: '',
    chat53ai_agent_id: '',
    channel_config: {},
    ...overrides,
  }
}

/**
 * 创建分组选项
 */
export function createMockGroupOptions(overrides: Partial<GroupOption>[] = []): GroupOption[] {
  const defaults: GroupOption[] = [
    { value: 1, label: '分组1', group_id: 1, group_name: '分组1' },
    { value: 2, label: '分组2', group_id: 2, group_name: '分组2' },
  ]
  return overrides.length ? overrides : defaults
}

/**
 * Mock API 模块
 */
export function mockAgentApi() {
  return {
    detail: vi.fn().mockResolvedValue({
      agent_id: 1,
      name: '测试Agent',
      logo: 'https://example.com/logo.png',
      description: '测试描述',
      group_id: 1,
      channel_type: 1,
      model: 'gpt-4',
      prompt: '你是一个助手',
      settings: {},
      custom_config: {},
    }),
    save: vi.fn().mockResolvedValue({
      agent_id: 1,
      name: '测试Agent',
    }),
  }
}

export function mockGroupApi() {
  return {
    list: vi.fn().mockResolvedValue([
      { group_id: 1, group_name: '分组1' },
      { group_id: 2, group_name: '分组2' },
    ]),
  }
}

/**
 * Mock Enterprise Store
 */
export function mockEnterpriseStore(overrides = {}) {
  return {
    getState: () => ({
      info: {
        is_independent: false,
        is_industry: false,
        is_enterprise: true,
        ...overrides,
      },
    }),
  }
}

/**
 * 重置 store 状态
 */
export function resetStoreState() {
  const { useAgentFormStore } = require('../../store')
  const { getInitialFormData } = require('../../types')

  useAgentFormStore.setState({
    form_data: getInitialFormData(),
    agent_id: 0,
    agent_type: 'prompt',
    is_new: false,
    loading: false,
    saving: false,
    initializing: false,  // 新增：与 store.ts 初始值保持一致
    agent_data: {},  // 修复：与 store.ts 初始值保持一致
    group_options: [],
    support_image: false,
  })
}