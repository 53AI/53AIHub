import channelApi, { transformSelectData } from '@/api/modules/channel/index'
import { cacheManager as cache } from '@km/shared-utils'

export interface ModelOption {
  value: string
  label: string
  icon?: string
  vision?: boolean
  model_value?: string
  modelType?: string
  modelTypeName?: string
  provider_name?: string
  deep_thinking?: boolean
  text_generation?: boolean
}

export interface ChannelOption {
  value: string
  label: string
  icon?: string
  options: ModelOption[]
}

export const loadModels = (type?: string, mode?: string): Promise<ChannelOption[]> => {
  return cache.getOrFetch('model_list_' + type + '_' + mode, () => {
    return channelApi.listv2().then((res) => {
      const modelList = res
        .map(item => transformSelectData(item, type, mode))
        .filter(item => item.options.length > 0)
      return modelList
    })
  })
}

/**
 * Clear the model cache
 */
export function clearModelCache(): void {
  cache.clear()
}
