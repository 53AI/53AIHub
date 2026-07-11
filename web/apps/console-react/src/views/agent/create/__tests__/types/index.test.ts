/**
 * Types 模块测试
 */
import { describe, it, expect } from 'vitest'
import {
  getInitialFormData,
  getDefaultFieldItem,
  DEFAULT_COMPLETION_PARAMS,
  type FormData,
  type Settings,
  type CustomConfig,
  type FieldItem,
  type RelateAgent,
  type GroupOption,
  type UseCase,
  type SuggestedQuestion,
  type ChannelConfig,
  type RequestLimit,
} from '../../types'

describe('getInitialFormData', () => {
  it('应返回正确的初始表单数据结构', () => {
    const formData = getInitialFormData()

    // 基本字段
    expect(formData.logo).toBe('')
    expect(formData.name).toBe('')
    expect(formData.group_id).toBe(0)
    expect(formData.description).toBe('')
    expect(formData.channel_type).toBe(0)
    expect(formData.model).toBe('')
    expect(formData.sort).toBe(0)
    expect(formData.prompt).toBe('')
    expect(formData.enable).toBeUndefined()
  })

  it('数组字段应为空数组', () => {
    const formData = getInitialFormData()

    expect(formData.user_group_ids).toEqual([])
    expect(formData.subscription_group_ids).toEqual([])
    expect(formData.tools).toEqual([])
    expect(formData.use_cases).toEqual([])
  })

  it('configs 应包含默认的 completion_params', () => {
    const formData = getInitialFormData()

    expect(formData.configs).toBeDefined()
    expect(formData.configs.completion_params).toEqual(DEFAULT_COMPLETION_PARAMS)
  })

  it('custom_config 应有正确的初始值', () => {
    const formData = getInitialFormData()
    const { custom_config } = formData

    expect(custom_config.agent_type).toBe('prompt')
    expect(custom_config.agent_mode).toBe('chat')
    expect(custom_config.provider_id).toBe(0)
    expect(custom_config.channel_id).toBe(0)
    expect(custom_config.coze_workspace_id).toBe('')
    expect(custom_config.coze_bot_id).toBe('')
    expect(custom_config.coze_bot_url).toBe('')
    expect(custom_config.tencent_bot_id).toBe('')
    expect(custom_config.app_builder_bot_id).toBe('')
    expect(custom_config.chat53ai_agent_id).toBe('')
    expect(custom_config.channel_config).toEqual({})
  })

  it('settings 应有正确的初始值', () => {
    const formData = getInitialFormData()
    const { settings } = formData

    expect(settings.opening_statement).toBe('')
    expect(settings.suggested_questions).toEqual([])
    expect(settings.file_parse.enable).toBe(false)
    expect(settings.image_parse.vision).toBe(false)
    expect(settings.image_parse.enable).toBe(false)
    expect(settings.relate_agents).toEqual([])
    expect(settings.input_fields).toEqual([])
    expect(settings.output_fields).toEqual([])
  })

  it('每次调用应返回新的对象引用', () => {
    const data1 = getInitialFormData()
    const data2 = getInitialFormData()

    expect(data1).not.toBe(data2)
    expect(data1.settings).not.toBe(data2.settings)
    expect(data1.custom_config).not.toBe(data2.custom_config)
  })

  it('返回值应符合 FormData 类型', () => {
    const formData: FormData = getInitialFormData()

    // TypeScript 编译通过即证明类型正确
    expect(typeof formData.name).toBe('string')
    expect(typeof formData.group_id).toBe('number')
    expect(Array.isArray(formData.tools)).toBe(true)
  })
})

describe('getDefaultFieldItem', () => {
  it('应返回正确的默认字段项结构', () => {
    const field = getDefaultFieldItem()

    expect(field.id).toBe('')
    expect(field.variable).toBe('')
    expect(field.label).toBe('')
    expect(field.type).toBe('text')
    expect(field.desc).toBe('')
    expect(field.required).toBe(false)
    expect(field.max_length).toBe(0)
    expect(field.show_word_limit).toBe(false)
    expect(field.options).toEqual([])
    expect(field.multiple).toBe(false)
    expect(field.date_format).toBe('')
    expect(field.file_type).toBe('all')
    expect(field.file_accept).toEqual([])
    expect(field.file_limit).toBe(1)
    expect(field.file_size).toBe(30)
    expect(field.is_system).toBe(false)
  })

  it('每次调用应返回新的对象引用', () => {
    const field1 = getDefaultFieldItem()
    const field2 = getDefaultFieldItem()

    expect(field1).not.toBe(field2)
    expect(field1.options).not.toBe(field2.options)
    expect(field1.file_accept).not.toBe(field2.file_accept)
  })

  it('返回值应符合 FieldItem 类型', () => {
    const field: FieldItem = getDefaultFieldItem()

    // TypeScript 编译通过即证明类型正确
    expect(typeof field.variable).toBe('string')
    expect(typeof field.required).toBe('boolean')
    expect(Array.isArray(field.options)).toBe(true)
  })
})

describe('DEFAULT_COMPLETION_PARAMS', () => {
  it('应有正确的默认参数值', () => {
    expect(DEFAULT_COMPLETION_PARAMS.temperature).toBe(0.2)
    expect(DEFAULT_COMPLETION_PARAMS.top_p).toBe(0.75)
    expect(DEFAULT_COMPLETION_PARAMS.presence_penalty).toBe(0.5)
    expect(DEFAULT_COMPLETION_PARAMS.frequency_penalty).toBe(0.5)
  })

  it('所有参数应为数字', () => {
    expect(typeof DEFAULT_COMPLETION_PARAMS.temperature).toBe('number')
    expect(typeof DEFAULT_COMPLETION_PARAMS.top_p).toBe('number')
    expect(typeof DEFAULT_COMPLETION_PARAMS.presence_penalty).toBe('number')
    expect(typeof DEFAULT_COMPLETION_PARAMS.frequency_penalty).toBe('number')
  })
})

// ============ 类型定义测试 ============
describe('类型定义', () => {
  it('FormData 类型应包含所有必要字段', () => {
    const formData: FormData = {
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
      configs: {},
      custom_config: {
        agent_type: '',
        agent_mode: '',
        provider_id: 0,
        channel_id: 0,
        tencent_bot_id: '',
        coze_workspace_id: '',
        coze_bot_id: '',
        coze_bot_url: '',
        app_builder_bot_id: '',
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
    }

    expect(formData).toBeDefined()
  })

  it('Settings 类型应包含所有必要字段', () => {
    const settings: Settings = {
      opening_statement: '测试开场白',
      suggested_questions: [{ id: '1', content: '问题' }],
      file_parse: { enable: true },
      image_parse: { vision: true, enable: true },
      relate_agents: [],
      input_fields: [],
      output_fields: [],
    }

    expect(settings.opening_statement).toBe('测试开场白')
  })

  it('CustomConfig 类型应包含所有必要字段', () => {
    const customConfig: CustomConfig = {
      agent_type: 'prompt',
      agent_mode: 'chat',
      provider_id: 1,
      channel_id: 1,
      tencent_bot_id: '',
      coze_workspace_id: '',
      coze_bot_id: '',
      coze_bot_url: '',
      app_builder_bot_id: '',
      chat53ai_agent_id: '',
      channel_config: { key: 'value' },
    }

    expect(customConfig.agent_type).toBe('prompt')
  })

  it('RelateAgent 类型应包含所有必要字段', () => {
    const relateAgent: RelateAgent = {
      agent_id: 1,
      id: '1',
      name: '关联应用',
      logo: '',
      description: '描述',
      input_fields: [
        { id: '1', type: 'text', label: '输入', variable: 'input', required: true },
      ],
      field_mapping: { input: 'output' },
      execution_rule: 'auto',
      is_workflow: false,
    }

    expect(relateAgent.agent_id).toBe(1)
    expect(relateAgent.execution_rule).toBe('auto')
  })

  it('GroupOption 类型应包含所有必要字段', () => {
    const groupOption: GroupOption = {
      value: 1,
      label: '分组1',
      group_id: 1,
      group_name: '分组1',
    }

    expect(groupOption.value).toBe(1)
    expect(groupOption.label).toBe('分组1')
  })

  it('UseCase 类型应包含所有必要字段', () => {
    const useCase: UseCase = {
      id: '1',
      type: 'case',
      input_text: '输入',
      output_text: '输出',
      image: '',
      scene: '',
      desc: '描述',
    }

    expect(useCase.id).toBe('1')
    expect(useCase.type).toBe('case')
  })

  it('SuggestedQuestion 类型应包含所有必要字段', () => {
    const question: SuggestedQuestion = {
      id: '1',
      content: '建议问题',
    }

    expect(question.id).toBe('1')
    expect(question.content).toBe('建议问题')
  })

  it('ChannelConfig 类型应包含所有可选字段', () => {
    const channelConfig: ChannelConfig = {
      channel_type: 1,
      channel_id: 1,
      name: '渠道',
      label: '标签',
      value: 'value',
      key: 'key',
      base_url: 'https://api.example.com',
      models: ['gpt-4', 'gpt-3.5'],
      model: 'gpt-4',
      config: { custom: 'config' },
    }

    expect(channelConfig.channel_type).toBe(1)
    expect(channelConfig.models).toHaveLength(2)
  })

  it('RequestLimit 类型应包含所有必要字段', () => {
    const requestLimit: RequestLimit = {
      frequency: {
        enable: true,
        interval: 60,
        number: 10,
        over_message: '请求过于频繁',
      },
      total: {
        enable: true,
        limit: 100,
        over_message: '已达到限制',
      },
    }

    expect(requestLimit.frequency.enable).toBe(true)
    expect(requestLimit.total.limit).toBe(100)
  })

  it('FieldItem 类型应包含所有必要字段', () => {
    const fieldItem: FieldItem = {
      id: '1',
      variable: 'input1',
      label: '输入字段',
      type: 'text',
      desc: '描述',
      required: true,
      max_length: 100,
      show_word_limit: true,
      options: [
        { id: '1', label: '选项1', value: 'opt1' },
      ],
      multiple: false,
      date_format: 'YYYY-MM-DD',
      file_type: 'image',
      file_accept: ['.jpg', '.png'],
      file_limit: 5,
      file_size: 10,
      is_system: false,
    }

    expect(fieldItem.id).toBe('1')
    expect(fieldItem.required).toBe(true)
    expect(fieldItem.options).toHaveLength(1)
  })
})

// ============ 边界情况测试 ============
describe('边界情况', () => {
  it('getInitialFormData 应能被部分覆盖', () => {
    const formData = getInitialFormData()

    // 模拟部分覆盖
    const partialUpdate = {
      ...formData,
      name: '新名称',
      group_id: 5,
    }

    expect(partialUpdate.name).toBe('新名称')
    expect(partialUpdate.group_id).toBe(5)
    expect(partialUpdate.description).toBe('') // 保持默认
  })

  it('getDefaultFieldItem 应能被部分覆盖', () => {
    const field = getDefaultFieldItem()

    // 模拟部分覆盖
    const partialUpdate = {
      ...field,
      variable: 'myVar',
      label: '我的字段',
      required: true,
    }

    expect(partialUpdate.variable).toBe('myVar')
    expect(partialUpdate.label).toBe('我的字段')
    expect(partialUpdate.required).toBe(true)
    expect(partialUpdate.type).toBe('text') // 保持默认
  })
})
