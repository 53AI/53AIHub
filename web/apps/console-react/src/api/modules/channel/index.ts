import service from '../../config'
import axios from 'axios'
import { handleError } from '../../error-handler'
import {
  type ModelValue,
  type ModelUseType,
  type ReasoningMode,
  REASONING_MODE,
  MODEL_USE_TYPE,
} from '@/constants/platform/config'
import { MODEL_VALUE_SEPARATOR, EXTERNAL_MODEL_API_URL } from '@/constants/platform/model'
import { getPublicPath } from '@/utils/config'

import { JSONParse } from '@/utils'

import { useChannelStore } from '@/stores/modules/channel'

export interface RawModelOption {
  categories: Array<{
    model_count: number
    model_type: ModelUseType
    models: Array<{
      model_id: string
      model_name: string
      deep_thinking?: boolean
      dimensions?: number
      max_tokens?: number
      context_length?: number
      vision?: boolean
    }>
  }>
  platform_id: string
  platform_name: string
  channel_type: number
  can_multiple: boolean
}

export interface ModelCategoryOption {
  icon?: string
  model_type: ModelUseType
  model_type_name: string
  model_count: number
  models: Array<{
    icon: string
    model_id: string
    model_name: string
    deep_thinking?: boolean
    dimensions?: number
    max_tokens?: number
    context_length?: number
    vision?: boolean
  }>
}

export interface ModelOption extends Omit<RawModelOption, 'categories'> {
  platform_icon: string
  categories: Array<ModelCategoryOption>
}

export interface ChannelRequestData {
  base_url: string
  config: string
  key: string
  custom_config: string
  model_mapping: string
  model_type: number
  models: string
  name: string
  other: string
  priority: number
  provider_id: number
  type: number
  weight: number
}

export interface RawChannelItem {
  channel_id: number
  eid: number
  type: ModelValue
  key: string
  weight: number
  name: string
  models: string
  config: string
  custom_config: string
  other: string
  model_mapping: string
  priority: number
  base_url: string
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
    modelType: ModelUseType
    modelTypeName: string
    options: Array<{
      value: string
      modelType: ModelUseType
      modelTypeName: string
      label: string
      icon: string
      deep_thinking: boolean
      vision: boolean
      text_generation: boolean
      max_tokens?: number
      context_length?: number
    }>
  }>
  options: Array<{
    value: string
    label: string
    icon: string
    modelType: ModelUseType
    modelTypeName: string
    deep_thinking: boolean
    vision: boolean
    text_generation: boolean
    max_tokens?: number
    context_length?: number
  }>
}

export interface ChannelTestResponse {
  success: boolean
  message: string
  time: number
}

export const getModelIcon = (value: string) => {
  let icon = ''
  if (/deepseek/i.test(value)) icon = 'deepseek'
  else if (/tongyi|qwen/i.test(value)) icon = 'tongyi'
  else if (/thudm/i.test(value)) icon = 'zhipu'
  else if (/ai\/yi/i.test(value)) icon = 'yi'
  else if (/internlm/i.test(value)) icon = 'internlm'
  else if (/baai/i.test(value)) icon = 'baai'
  else if (/google/i.test(value)) icon = 'google'
  else if (/mistralai/i.test(value)) icon = 'mistralai'
  else if (/llama/i.test(value)) icon = 'llama'
  else if (/ernie/i.test(value)) icon = 'weixin'
  else if (/kimi|moonshot/i.test(value)) icon = 'moonshot'

  const w = window as any
  return icon ? (typeof w.$getRealPath === 'function' ? w.$getRealPath({ url: `/images/platform/${icon}.png` }) : '') : ''
}

const getModelTypeName = (model_type: ModelUseType) => {
  switch (model_type) {
    case MODEL_USE_TYPE.REASONING:
      return window.$t('model.reasoning')
    case MODEL_USE_TYPE.EMBEDDING:
      return window.$t('model.embedding')
    case MODEL_USE_TYPE.RERANKER:
      return window.$t('model.rerank')
    default:
      return ''
  }
}

export const transformChannelData = (data: RawChannelItem): ChannelItem => {
  const channelStore = useChannelStore.getState()
  const model = (channelStore as any).modelConfigListCopy().find((item: any) => item.channel_type === data.type) ||
    channelStore.modelConfigList.find((item: any) => item.channel_type === (data as any).type) || {
      platform_icon: '',
      platform_name: '',
      platform_id: '',
    }
  const config = JSONParse(data.config, {}) || {}
  const custom_config = JSONParse(data.custom_config, {})

  // 判断 config 是否为数组格式（新格式）
  const isConfigArray = Array.isArray(config)

  const models = typeof data.models === 'string' ? data.models.split(',') : (data.models as any) || []
  const alias_map = (custom_config.alias_map || {}) as Record<string, string>

  const options = models.map((value: string) => {
    const model_type = custom_config[value] || MODEL_USE_TYPE.REASONING

    // 从 config 数组或 custom_config 读取模型属性
    const modelConfig = isConfigArray
      ? config.find((c: any) => c.model_id === value)
      : config
    
    return {
      value,
      modelType: model_type,
      modelTypeName: getModelTypeName(model_type),
      label: alias_map[value] || value,
      icon: getModelIcon(value) || (model as any)?.platform_icon || '',
      deep_thinking: modelConfig?.deep_thinking || custom_config.deep_thinking?.includes(value) || false,
      vision: modelConfig?.vision || custom_config.vision?.includes(value) || false,
      text_generation: modelConfig?.text_generation || custom_config.text_generation?.includes(value) || false,
      max_tokens: modelConfig?.max_tokens || custom_config.max_tokens?.[value],
      context_length: modelConfig?.context_length || custom_config.context_length?.[value],
    }
  })

  const group = options.reduce((acc: any[], item: any) => {
    const found = acc.find(row => row.modelType === item.modelType)
    if (found) found.options.push(item)
    else acc.push({ modelType: item.modelType, modelTypeName: item.modelTypeName, options: [item] })
    return acc
  }, [])

  return {
    ...data,
    platform_icon: (model as any)?.platform_icon || '',
    platform_name: (model as any)?.platform_name || '',
    platform_id: (model as any)?.platform_id || '',
    channel_type: (data as any).type,
    custom_config,
    config,
    models,
    group,
    options,
  }
}

export const transformSelectData = (data: RawChannelItem, type?: string, mode?: ReasoningMode): ChannelItem => {
  const result = transformChannelData(data)

  let options = result.options
  if (type) options = options.filter(item => result.custom_config[item.value] === type)

  const deepThinking = result.custom_config.deep_thinking || []
  if (mode === REASONING_MODE.DEEP) options = options.filter(item => deepThinking.includes(item.value) || item.deep_thinking)
  else if (mode === REASONING_MODE.FAST)
    options = options.filter(item => !deepThinking.includes(item.value) || !item.deep_thinking)

  return {
    ...result,
    options: options.map(item => ({
      value: `${data.channel_id}${MODEL_VALUE_SEPARATOR}${item.value}`,
      model_value: `${data.channel_id}${MODEL_VALUE_SEPARATOR}${item.value}${MODEL_VALUE_SEPARATOR}${data.type}`,
      label: item.label,
      icon: item.icon,
      modelType: item.modelType,
      modelTypeName: item.modelTypeName,
      provider_name: result.platform_name,
      deep_thinking: item.deep_thinking,
      vision: item.vision,
      text_generation: item.text_generation,
    })) as any,
  }
}

export const transformModelList = (data: RawModelOption[]): ModelOption[] => {
  return data.map(item => ({
    ...item,
    platform_icon: getPublicPath(`/images/platform/${item.platform_id}.png`),
    categories: item.categories.map(cate => ({
      ...cate,
      icon: '',
      model_type_name: getModelTypeName(`${cate.model_type}` as any),
      models: cate.models.map(model => ({
        ...model,
        icon: getModelIcon(model.model_id),
      })),
    })),
  }))
}

export const channelApi = {
  models: {
    config(): Promise<RawModelOption[]> {
      return service
        .get('/api/channels/km/models')
        .then((res: any) => res.data.platforms)
        .catch(handleError)
    },
  },
  /**
   * 获取外部模型的 max_tokens 和 context_length 映射
   * 从 EXTERNAL_MODEL_API_URL 获取
   */
  externalModels(): Promise<{ maxTokens: Record<string, number>; contextLength: Record<string, number> }> {
    return axios
      .get(EXTERNAL_MODEL_API_URL)
      .then((res: any) => {
        const maxTokens: Record<string, number> = {}
        const contextLength: Record<string, number> = {}
        const data = res.data?.data || res.data || []
        if (Array.isArray(data)) {
          data.forEach((model: any) => {
            const modelMaxTokens = model.top_provider?.max_completion_tokens || model.max_tokens
            const modelContextLength = model.top_provider?.context_length
            if (model.id) {
              // 存储完整格式（如 'qwen/qwen3.7-plus'）
              if (modelMaxTokens) maxTokens[model.id] = modelMaxTokens
              if (modelContextLength) contextLength[model.id] = modelContextLength
              // 同时存储简化格式（去掉 provider 前缀，如 'qwen3.7-plus'）
              const simpleId = model.id.includes('/') ? model.id.split('/').pop() : model.id
              if (simpleId && simpleId !== model.id) {
                if (modelMaxTokens) maxTokens[simpleId] = modelMaxTokens
                if (modelContextLength) contextLength[simpleId] = modelContextLength
              }
            }
          })
        }
        return { maxTokens, contextLength }
      })
      .catch((error) => {
        console.warn('[channelApi.externalModels] Failed to fetch:', error?.message || error)
        return { maxTokens: {}, contextLength: {} }
      })
  },
  listv2(): Promise<RawChannelItem[]> {
    return service
      .get('/api/channels')
      .then((res: any) => res.data)
      .catch(handleError)
  },
  create(data: ChannelRequestData) {
    return service.post('/api/channels', data).catch(handleError)
  },
  update(channel_id: number, data: ChannelRequestData) {
    return service.put(`/api/channels/${channel_id}`, data).catch(handleError)
  },
  delete(channel_id: number) {
    return service.delete(`/api/channels/${channel_id}`).catch(handleError)
  },
  test(channel_id: number, params?: { model?: string; model_type?: number | string }): Promise<ChannelTestResponse> {
    return service
      .get(`/api/channels/test/${channel_id}`, { params })
      .then((res: any) => res.data ?? res)
      .catch(handleError)
  },
  async save({ data = {} }: { data?: Record<string, any> } = {}) {
    const channel_id = data.channel_id
    const payload = { ...data }
    delete payload.channel_id
    if (Array.isArray(payload.models)) {
      payload.models = payload.models.join(',')
    }
    const res = await service[channel_id ? 'put' : 'post'](
      `/api/channels${channel_id ? `/${channel_id}` : ''}`,
      payload,
    ).catch(handleError)
    return transformChannelData(res?.data)
  },
}

export default channelApi

