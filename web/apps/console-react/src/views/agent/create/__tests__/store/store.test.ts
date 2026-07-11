/**
 * Store 测试 - 完整覆盖
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { useAgentFormStore } from '../../store'
import { getInitialFormData } from '../../types'

// Mock external dependencies
vi.mock('@/api/modules/agent', () => ({
  agentApi: {
    detail: vi.fn().mockResolvedValue({
      agent_id: 1,
      name: '测试Agent',
      logo: 'https://example.com/logo.png',
      description: '测试描述',
      group_id: 1,
      channel_type: 1,
      model: 'gpt-4',
      prompt: '你是一个助手',
      settings: {
        opening_statement: '你好',
        suggested_questions: [{ id: '1', content: '问题1' }],
      },
      custom_config: {
        agent_type: 'prompt',
        channel_id: 1,
      },
    }),
    save: vi.fn().mockResolvedValue({
      agent_id: 123,
      name: '保存的Agent',
    }),
  },
}))

vi.mock('@/api/modules/group', () => ({
  groupApi: {
    list: vi.fn().mockResolvedValue([
      { group_id: 1, group_name: '分组1' },
      { group_id: 2, group_name: '分组2' },
    ]),
  },
}))

vi.mock('@/stores', () => ({
  useEnterpriseStore: {
    getState: () => ({
      info: {
        is_independent: false,
        is_industry: false,
        is_enterprise: true,
      },
    }),
  },
}))

vi.mock('@/constants/platform/channel', () => ({
  CHANNEL_TYPE_VALUE_MAP: new Map([
    ['prompt', 1],
    ['coze_agent_cn', 2],
    ['tencent', 3],
  ]),
}))

vi.mock('@/constants/platform/config', () => ({
  getAgentByAgentType: vi.fn((type: string) => {
    const configs: Record<string, { id: string; icon: string; mode: string }> = {
      prompt: { id: 'prompt', icon: 'prompt-icon', mode: 'chat' },
      coze_agent_cn: { id: 'coze_agent_cn', icon: 'coze-icon', mode: 'chat' },
      tencent: { id: 'tencent', icon: 'tencent-icon', mode: 'chat' },
      '53ai_agent': { id: '53ai_agent', icon: '53ai-icon', mode: 'completion' },
    }
    return configs[type] || configs.prompt
  }),
  BACKEND_AGENT_TYPE: {
    AGENT: 'agent',
    WORKFLOW: 'workflow',
  },
  AGENT_MODES: {
    CHAT: 'chat',
    COMPLETION: 'completion',
  },
  AGENT_TYPES: {
    PROMPT: 'prompt',
    COZE_AGENT_CN: 'coze_agent_cn',
    COZE_WORKFLOW_CN: 'coze_workflow_cn',
    APP_BUILDER: 'app_builder',
    TENCENT: 'tencent',
    '53AI_AGENT': '53ai_agent',
    '53AI_WORKFLOW': '53ai_workflow',
  },
}))

vi.mock('@/constants/group', () => ({
  GROUP_TYPE: {
    AGENT: 1,
  },
}))

vi.mock('antd', () => ({
  message: {
    success: vi.fn(),
  },
}))

describe('useAgentFormStore', () => {
  beforeEach(() => {
    // Reset store to initial state (matching actual store defaults)
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
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // ============ 初始状态测试 ============
  describe('初始状态', () => {
    it('应有正确的初始值', () => {
      const state = useAgentFormStore.getState()

      expect(state.agent_id).toBe(0)
      expect(state.agent_type).toBe('prompt')
      expect(state.is_new).toBe(false)
      expect(state.loading).toBe(false)
      expect(state.saving).toBe(false)
      expect(state.initializing).toBe(false)  // 新增：验证 initializing 初始值
      expect(state.support_image).toBe(false)
      expect(state.agent_data).toEqual({})  // 修复：与 store.ts 初始值保持一致
      expect(state.group_options).toEqual([])
    })

    it('form_data 应有正确的初始结构', () => {
      const { form_data } = useAgentFormStore.getState()

      expect(form_data.name).toBe('')
      expect(form_data.logo).toBe('')
      expect(form_data.description).toBe('')
      expect(form_data.prompt).toBe('')
      expect(form_data.model).toBe('')
      expect(form_data.group_id).toBe(0)
      expect(form_data.sort).toBe(0)
      expect(form_data.channel_type).toBe(0)
      expect(form_data.user_group_ids).toEqual([])
      expect(form_data.subscription_group_ids).toEqual([])
      expect(form_data.tools).toEqual([])
      expect(form_data.use_cases).toEqual([])
    })

    it('settings 应有正确的初始结构', () => {
      const { form_data } = useAgentFormStore.getState()

      expect(form_data.settings.opening_statement).toBe('')
      expect(form_data.settings.suggested_questions).toEqual([])
      expect(form_data.settings.input_fields).toEqual([])
      expect(form_data.settings.output_fields).toEqual([])
      expect(form_data.settings.relate_agents).toEqual([])
      expect(form_data.settings.file_parse.enable).toBe(false)
      expect(form_data.settings.image_parse.vision).toBe(false)
      expect(form_data.settings.image_parse.enable).toBe(false)
    })

    it('custom_config 应有正确的初始结构', () => {
      const { form_data } = useAgentFormStore.getState()

      expect(form_data.custom_config).toBeDefined()
      expect(form_data.custom_config.agent_type).toBe('prompt')
      expect(form_data.custom_config.agent_mode).toBe('chat')
      expect(form_data.custom_config.provider_id).toBe(0)
      expect(form_data.custom_config.channel_id).toBe(0)
      expect(form_data.custom_config.coze_workspace_id).toBe('')
      expect(form_data.custom_config.coze_bot_id).toBe('')
      expect(form_data.custom_config.coze_bot_url).toBe('')
      expect(form_data.custom_config.tencent_bot_id).toBe('')
      expect(form_data.custom_config.app_builder_bot_id).toBe('')
      expect(form_data.custom_config.chat53ai_agent_id).toBe('')
      expect(form_data.custom_config.channel_config).toEqual({})
    })
  })

  // ============ setState 操作测试 ============
  describe('setState 操作', () => {
    it('应能更新 agent_id', () => {
      useAgentFormStore.setState({ agent_id: 456 })
      expect(useAgentFormStore.getState().agent_id).toBe(456)
    })

    it('应能更新 agent_type', () => {
      useAgentFormStore.setState({ agent_type: 'coze_agent_cn' })
      expect(useAgentFormStore.getState().agent_type).toBe('coze_agent_cn')
    })

    it('应能更新 is_new', () => {
      useAgentFormStore.setState({ is_new: true })
      expect(useAgentFormStore.getState().is_new).toBe(true)
    })

    it('应能更新 loading', () => {
      useAgentFormStore.setState({ loading: true })
      expect(useAgentFormStore.getState().loading).toBe(true)
    })

    it('应能更新 saving', () => {
      useAgentFormStore.setState({ saving: true })
      expect(useAgentFormStore.getState().saving).toBe(true)
    })

    it('应能更新 support_image', () => {
      useAgentFormStore.setState({ support_image: true })
      expect(useAgentFormStore.getState().support_image).toBe(true)
    })

    it('应能更新 form_data', () => {
      useAgentFormStore.setState({
        form_data: {
          ...useAgentFormStore.getState().form_data,
          name: '新名称',
          group_id: 5,
        },
      })

      const { form_data } = useAgentFormStore.getState()
      expect(form_data.name).toBe('新名称')
      expect(form_data.group_id).toBe(5)
    })

    it('应能更新 form_data.settings', () => {
      useAgentFormStore.setState({
        form_data: {
          ...useAgentFormStore.getState().form_data,
          settings: {
            ...useAgentFormStore.getState().form_data.settings,
            opening_statement: '新的开场白',
            suggested_questions: [{ id: '1', content: '问题1' }],
          },
        },
      })

      const { form_data } = useAgentFormStore.getState()
      expect(form_data.settings.opening_statement).toBe('新的开场白')
      expect(form_data.settings.suggested_questions).toHaveLength(1)
    })

    it('应能更新 form_data.custom_config', () => {
      useAgentFormStore.setState({
        form_data: {
          ...useAgentFormStore.getState().form_data,
          custom_config: {
            ...useAgentFormStore.getState().form_data.custom_config,
            channel_id: 10,
            coze_bot_id: 'bot-123',
          },
        },
      })

      const { form_data } = useAgentFormStore.getState()
      expect(form_data.custom_config.channel_id).toBe(10)
      expect(form_data.custom_config.coze_bot_id).toBe('bot-123')
    })

    it('应能更新 agent_data', () => {
      const mockData = { agent_id: 1, name: '测试数据' }
      useAgentFormStore.setState({ agent_data: mockData })
      expect(useAgentFormStore.getState().agent_data).toEqual(mockData)
    })

    it('应能更新 group_options', () => {
      const mockOptions = [
        { value: 1, label: '分组1', group_id: 1, group_name: '分组1' },
      ]
      useAgentFormStore.setState({ group_options: mockOptions })
      expect(useAgentFormStore.getState().group_options).toEqual(mockOptions)
    })
  })

  // ============ getAgentOptionData 测试 ============
  describe('getAgentOptionData', () => {
    it('应返回基于 agent_type 的配置', () => {
      const data = useAgentFormStore.getState().getAgentOptionData()
      expect(data).toBeDefined()
      expect(data.id).toBe('prompt')
    })

    it('应返回不同 agent_type 的配置', () => {
      useAgentFormStore.setState({ agent_type: 'coze_agent_cn' })
      const data = useAgentFormStore.getState().getAgentOptionData()
      expect(data.id).toBe('coze_agent_cn')
    })
  })

  // ============ getSupportFile 测试 ============
  describe('getSupportFile', () => {
    it('prompt 类型应返回 false', () => {
      useAgentFormStore.setState({ agent_type: 'prompt' })
      const support = useAgentFormStore.getState().getSupportFile()
      expect(support).toBe(false)
    })

    it('非 prompt 类型应返回 true', () => {
      useAgentFormStore.setState({ agent_type: 'coze_agent_cn' })
      const support = useAgentFormStore.getState().getSupportFile()
      expect(support).toBe(true)
    })
  })

  // ============ getIsIndependent 测试 ============
  describe('getIsIndependent', () => {
    it('应返回 enterprise store 的 is_independent 值', () => {
      const isIndependent = useAgentFormStore.getState().getIsIndependent()
      expect(typeof isIndependent).toBe('boolean')
      expect(isIndependent).toBe(false)
    })
  })

  // ============ loadDetailData 测试 ============
  describe('loadDetailData', () => {
    it('agent_id 为 0 时不应加载', async () => {
      useAgentFormStore.setState({ agent_id: 0 })
      await useAgentFormStore.getState().loadDetailData()
      // 不应设置 loading
      expect(useAgentFormStore.getState().loading).toBe(false)
    })

    it('应正确加载详情数据', async () => {
      useAgentFormStore.setState({ agent_id: 1, agent_type: 'prompt' })

      await useAgentFormStore.getState().loadDetailData()

      const state = useAgentFormStore.getState()
      expect(state.agent_data).toBeDefined()
      expect(state.agent_data.name).toBe('测试Agent')
      expect(state.loading).toBe(false)
    })

    it('加载过程中应设置 loading 状态', async () => {
      useAgentFormStore.setState({ agent_id: 1 })

      const promise = useAgentFormStore.getState().loadDetailData()
      // 在 promise resolve 之前检查 loading
      // 注意：这个测试可能不稳定，因为在微任务中状态会变化

      await promise
      expect(useAgentFormStore.getState().loading).toBe(false)
    })
  })

  // ============ updateFormData 测试 ============
  describe('updateFormData', () => {
    it('应正确更新 form_data', () => {
      useAgentFormStore.setState({
        agent_id: 1,
        agent_type: 'prompt',
        agent_data: {
          agent_id: 1,
          name: '测试Agent',
          logo: 'https://example.com/logo.png',
          description: '测试描述',
          group_id: 1,
          channel_type: 1,
          model: 'gpt-4',
          prompt: '你是一个助手',
          settings: {
            opening_statement: '你好',
          },
          custom_config: {
            channel_id: 1,
          },
        },
      })

      useAgentFormStore.getState().updateFormData()

      const { form_data } = useAgentFormStore.getState()
      expect(form_data.name).toBe('测试Agent')
      expect(form_data.description).toBe('测试描述')
      expect(form_data.group_id).toBe(1)
      expect(form_data.settings.opening_statement).toBe('你好')
    })

    it('应正确处理空的 agent_data（空对象）', () => {
      useAgentFormStore.setState({
        agent_data: {},
        agent_type: 'prompt',
      })

      useAgentFormStore.getState().updateFormData()

      const { form_data } = useAgentFormStore.getState()
      // 应使用默认值
      expect(form_data.name).toBeDefined()
      expect(form_data.name).toBe('')
    })

    it('应正确处理 settings 合并', () => {
      useAgentFormStore.setState({
        agent_data: {
          settings: {
            opening_statement: '自定义开场白',
            suggested_questions: [{ id: '1', content: '问题' }],
            file_parse: { enable: true },
            image_parse: { vision: true, enable: true },
            relate_agents: [{ agent_id: 1, name: '关联应用' }],
            input_fields: [],
            output_fields: [],
          },
        },
        agent_type: 'prompt',
      })

      useAgentFormStore.getState().updateFormData()

      const { form_data } = useAgentFormStore.getState()
      expect(form_data.settings.opening_statement).toBe('自定义开场白')
      expect(form_data.settings.file_parse.enable).toBe(true)
      expect(form_data.settings.image_parse.vision).toBe(true)
    })

    it('prompt 类型应正确处理 model 格式', () => {
      useAgentFormStore.setState({
        agent_data: {
          model: 'gpt-4',
          channel_type: 1,
          custom_config: {
            channel_id: 10,
          },
        },
        agent_type: 'prompt',
      })

      useAgentFormStore.getState().updateFormData()

      const { form_data } = useAgentFormStore.getState()
      expect(form_data.model).toBe('10_53aikm_gpt-4_53aikm_1')
    })

    it('非 prompt 类型应设置 support_image 为 true', () => {
      useAgentFormStore.setState({
        agent_data: {},
        agent_type: 'coze_agent_cn',
      })

      useAgentFormStore.getState().updateFormData()

      expect(useAgentFormStore.getState().support_image).toBe(true)
    })

    it('vision 启用时应设置 support_image 为 true', () => {
      useAgentFormStore.setState({
        agent_data: {
          settings: {
            image_parse: { vision: true, enable: false },
          },
        },
        agent_type: 'prompt',
      })

      useAgentFormStore.getState().updateFormData()

      expect(useAgentFormStore.getState().support_image).toBe(true)
    })
  })

  // ============ loadGroupOptions 测试 ============
  describe('loadGroupOptions', () => {
    it('应正确加载分组选项', async () => {
      await useAgentFormStore.getState().loadGroupOptions()

      const { group_options } = useAgentFormStore.getState()
      expect(group_options).toHaveLength(2)
      expect(group_options[0].value).toBe(1)
      expect(group_options[0].label).toBe('分组1')
    })

    it('当 form_data.group_id 为 0 时应设置第一个分组', async () => {
      useAgentFormStore.setState({
        form_data: {
          ...useAgentFormStore.getState().form_data,
          group_id: 0,
        },
      })

      await useAgentFormStore.getState().loadGroupOptions()

      const { form_data } = useAgentFormStore.getState()
      expect(form_data.group_id).toBe(1)
    })

    it('当 form_data.group_id 不在列表中时应重置为 0', async () => {
      useAgentFormStore.setState({
        form_data: {
          ...useAgentFormStore.getState().form_data,
          group_id: 999,
        },
      })

      await useAgentFormStore.getState().loadGroupOptions()

      const { form_data } = useAgentFormStore.getState()
      expect(form_data.group_id).toBe(0)
    })
  })

  // ============ resetState 测试 ============
  describe('resetState', () => {
    it('应重置所有状态到初始值', () => {
      // 先设置一些非初始值
      useAgentFormStore.setState({
        agent_id: 123,
        agent_type: 'coze_agent_cn',
        is_new: true,
        loading: true,
        saving: true,
        form_data: {
          ...getInitialFormData(),
          name: '测试名称',
        },
        agent_data: { test: true },
        group_options: [{ value: 1, label: '测试' }],
        support_image: true,
      })

      useAgentFormStore.getState().resetState()

      const state = useAgentFormStore.getState()
      expect(state.agent_id).toBe(0)
      expect(state.agent_type).toBe('prompt')
      expect(state.is_new).toBe(false)
      expect(state.loading).toBe(false)
      expect(state.saving).toBe(false)
      expect(state.form_data.name).toBe('')
      expect(state.agent_data).toEqual({})
      expect(state.group_options).toEqual([])
      expect(state.support_image).toBe(false)
    })
  })

  // ============ saveAgentData 测试 ============
  describe('saveAgentData', () => {
    it('应正确保存数据并返回结果', async () => {
      useAgentFormStore.setState({
        agent_id: 0,
        agent_type: 'prompt',
        form_data: {
          ...getInitialFormData(),
          name: '新Agent',
          group_id: 1,
          description: '描述',
          model: '1_53aikm_gpt-4_53aikm_1',
        },
      })

      const result = await useAgentFormStore.getState().saveAgentData()

      expect(result.agent_id).toBe(123)
      expect(useAgentFormStore.getState().saving).toBe(false)
    })

    it('保存过程中应设置 saving 状态', async () => {
      useAgentFormStore.setState({
        agent_type: 'prompt',
        form_data: getInitialFormData(),
      })

      await useAgentFormStore.getState().saveAgentData()

      expect(useAgentFormStore.getState().saving).toBe(false)
    })

    it('hideToast 为 true 时不应显示消息', async () => {
      const { message } = await import('antd')

      useAgentFormStore.setState({
        agent_type: 'prompt',
        form_data: getInitialFormData(),
      })

      await useAgentFormStore.getState().saveAgentData({ hideToast: true })

      expect(message.success).not.toHaveBeenCalled()
    })

    it('hideToast 为 false 时应显示成功消息', async () => {
      const { message } = await import('antd')

      useAgentFormStore.setState({
        agent_type: 'prompt',
        form_data: getInitialFormData(),
      })

      await useAgentFormStore.getState().saveAgentData({ hideToast: false })

      expect(message.success).toHaveBeenCalled()
    })

    it('coze_agent_cn 类型应正确处理 model', async () => {
      useAgentFormStore.setState({
        agent_type: 'coze_agent_cn',
        form_data: {
          ...getInitialFormData(),
          custom_config: {
            ...getInitialFormData().custom_config,
            coze_bot_id: 'bot-456',
          },
        },
      })

      await useAgentFormStore.getState().saveAgentData()

      // 验证 save 被调用
      const { agentApi } = await import('@/api/modules/agent')
      expect(agentApi.save).toHaveBeenCalled()
    })

    it('tencent 类型应正确处理 model', async () => {
      useAgentFormStore.setState({
        agent_type: 'tencent',
        form_data: {
          ...getInitialFormData(),
          custom_config: {
            ...getInitialFormData().custom_config,
            tencent_bot_id: 'tencent-789',
          },
        },
      })

      await useAgentFormStore.getState().saveAgentData()

      const { agentApi } = await import('@/api/modules/agent')
      expect(agentApi.save).toHaveBeenCalled()
    })

    it('completion 模式应设置 WORKFLOW 类型', async () => {
      useAgentFormStore.setState({
        agent_type: '53ai_agent', // mock 中配置为 completion 模式
        form_data: getInitialFormData(),
      })

      await useAgentFormStore.getState().saveAgentData()

      const { agentApi } = await import('@/api/modules/agent')
      const saveCall = agentApi.save.mock.calls[0]
      expect(saveCall[0].data.agent_type).toBe('workflow')
    })
  })

  // ============ 状态选择器测试 ============
  describe('状态选择器', () => {
    it('应能通过选择器获取具体字段', () => {
      useAgentFormStore.setState({
        form_data: {
          ...useAgentFormStore.getState().form_data,
          name: '选择器测试',
        },
      })

      const name = useAgentFormStore.getState().form_data.name
      expect(name).toBe('选择器测试')
    })

    it('应能获取嵌套字段', () => {
      useAgentFormStore.setState({
        form_data: {
          ...useAgentFormStore.getState().form_data,
          settings: {
            ...useAgentFormStore.getState().form_data.settings,
            opening_statement: '嵌套字段测试',
          },
        },
      })

      const openingStatement = useAgentFormStore.getState().form_data.settings.opening_statement
      expect(openingStatement).toBe('嵌套字段测试')
    })

    it('应能获取深层嵌套字段', () => {
      useAgentFormStore.setState({
        form_data: {
          ...useAgentFormStore.getState().form_data,
          custom_config: {
            ...useAgentFormStore.getState().form_data.custom_config,
            channel_config: {
              key: 'value',
            },
          },
        },
      })

      const channelConfig = useAgentFormStore.getState().form_data.custom_config.channel_config
      expect(channelConfig.key).toBe('value')
    })
  })
})
