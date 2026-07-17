import request from '../../index'
import { ChannelRequestData, ChannelTestResponse } from './types'
import { REASONING_MODE } from '@/constants/agent'

export interface RawChannelItem {
  channel_id: number
  eid: number
  type: number
  weight: number
  name: string
  models: string
  config: string
  custom_config: string
  other: string
  model_mapping: string
  priority: number
  used_quota: number
  status: number
  balance: number
  balance_updated_time: number
  test_time: number
  response_time: number
  provider_id: number
  created_time: number
  updated_time: number
}

export interface ChannelItem extends Omit<RawChannelItem, 'models' | 'config' | 'custom_config'> {
  platform_icon: string
  platform_name: string
  platform_id: string
  name: string
  custom_config: Record<string, any>
  config: Record<string, any>
  channel_type: number
  models: string[]
  group: Array<{
    modelType: string
    modelTypeName: string
    options: Array<{
      value: string
      modelType: string
      modelTypeName: string
      label: string
      icon: string
      deep_thinking: boolean
      vision: boolean
      text_generation: boolean
    }>
  }>
  options: Array<{
    value: string
    label: string
    icon: string
    modelType: string
    modelTypeName: string
    deep_thinking: boolean
    vision: boolean
    text_generation: boolean
  }>
}

export const getPlatformInfo = (type: number) => {
  const platformMap: Record<number, { name: string; icon: string; platform_id: string }> = {
    44: { name: '硅基流动', icon: 'https://kmtest.53ai.com/console/images/platform/siliconflow.png', platform_id: '44' },
    3: { name: 'Azure OpenAI', icon: 'https://kmtest.53ai.com/console/images/platform/azure_openai.png', platform_id: '3' },
    36: { name: 'DeepSeek', icon: 'https://kmtest.53ai.com/console/images/platform/deepseek.png', platform_id: '36' },
    900: { name: '火山方舟', icon: 'https://kmtest.53ai.com/console/images/platform/volcengine.png', platform_id: '900' },
    17: { name: '阿里百炼', icon: 'https://kmtest.53ai.com/console/images/platform/alibaba_bailian.png', platform_id: '17' },
    901: { name: 'ModelBuilder', icon: 'https://kmtest.53ai.com/console/images/platform/baidu_qianfan.png', platform_id: '901' },
    25: { name: '月之暗面', icon: 'https://kmtest.53ai.com/console/images/platform/moonshot.png', platform_id: '25' },
    24: { name: 'Gemini', icon: 'https://kmtest.53ai.com/console/images/platform/gemini.png', platform_id: '24' },
    1012: { name: '自定义模型 （兼容OpenAI）', icon: 'https://kmtest.53ai.com/console/images/platform/custom_openai.png', platform_id: '1012' }
  }
  return platformMap[type] || { name: '', icon: '', platform_id: '' }
}

export const getModelIcon = (value: string) => {
  const iconPatterns: [RegExp, string][] = [
    [/deepseek/i, 'deepseek'],
    [/tongyi|qwen/i, 'tongyi'],
    [/thudm/i, 'zhipu'],
    [/ai\/yi/i, 'yi'],
    [/internlm/i, 'internlm'],
    [/baai/i, 'baai'],
    [/google/i, 'google'],
    [/mistralai/i, 'mistralai'],
    [/llama/i, 'llama'],
    [/ernie/i, 'weixin'],
    [/kimi|moonshot/i, 'moonshot']
  ]
  for (const [pattern, icon] of iconPatterns) {
    if (pattern.test(value)) {
      return `https://kmtest.53ai.com/console/images/platform/${icon}.png`
    }
  }
  return ''
}

export const transformChannelData = (data: RawChannelItem): ChannelItem => {
  const model = getPlatformInfo(data.type)
  let config = {}
  let custom_config = {}
  try {
    config = (typeof data.config === 'string' ? JSON.parse(data.config) : data.config) || {}
    custom_config =
      typeof data.custom_config === 'string' && data.custom_config
        ? JSON.parse(data.custom_config)
        : data.custom_config || {}
  } catch (error) {
    console.log(error)
  }
  const models = typeof data.models === 'string' ? data.models.split(',') : data.models || []
  const alias_map = (custom_config.alias_map || {}) as Record<string, string>

  const options = models.map(value => {
    const model_type = custom_config[value] || '1'
    return {
      value,
      modelType: model_type,
      modelTypeName: model_type === '1' ? '推理' : model_type === '2' ? '嵌入' : '重排序',
      label: alias_map[value] || value,
      icon: getModelIcon(value) || model?.icon || '',
      deep_thinking: custom_config.deep_thinking?.includes(value) || false,
      vision: custom_config.vision?.includes(value) || false,
      text_generation: custom_config.text_generation?.includes(value) || false,
    }
  })

  const group = options.reduce(
    (acc: Array<{ modelType: string; modelTypeName: string; options: typeof options }>, item) => {
      const data = acc.find(row => row.modelType === item.modelType)
      if (data) {
        data.options.push(item)
      } else {
        acc.push({
          modelType: item.modelType,
          modelTypeName: item.modelTypeName,
          options: [item],
        })
      }
      return acc
    },
    []
  )

  return {
    ...data,
    icon: model?.icon || '',
    label: model?.name || '',
    platform_name: model?.name || '',
    platform_id: model?.platform_id || '',
    channel_type: data.type,
    custom_config,
    config,
    models,
    group,
    options,
  }
}

export const transformSelectData = (
  data: RawChannelItem,
  type?: string,
  mode?: string
): ChannelItem => {
  const result = transformChannelData(data)

  let options = result.options
  if (type) {
    options = options.filter(item => result.custom_config[item.value] === type)
  }
  const deepThinking = result.custom_config.deep_thinking || []
  if (mode === REASONING_MODE.DEEP) {
    options = options.filter(item => deepThinking.includes(item.value))
  } else if (mode === REASONING_MODE.FAST && deepThinking.length > 0) {
    options = options.filter(item => !deepThinking.includes(item.value))
  }
  return {
    ...result,
    options: options.map(item => {
      return {
        value: `${data.channel_id}_53aikm_${item.value}`,
        model_value: `${data.channel_id}_53aikm_${item.value}_53aikm_${data.type}`,
        label: item.label,
        icon: item.icon,
        modelType: item.modelType,
        modelTypeName: item.modelTypeName,
        provider_name: result.platform_name,
        deep_thinking: item.deep_thinking,
        vision: item.vision,
        text_generation: item.text_generation,
      }
    }),
  }
}

const channelApi = {
  listv2(): Promise<RawChannelItem[]> {
    return request.get('/api/channels/public').then((res) => res.data)
  },
  create(data: ChannelRequestData) {
    return request.post('/api/channels', data)
  },
  /**
   * 测试渠道连接
   */
  test(channel_id: number, params?: { model?: string; model_type?: number | string }): Promise<ChannelTestResponse> {
    return request.get(`/api/channels/test/${channel_id}`, { params }).then((res) => res.data ?? res)
  },
}

export default channelApi
