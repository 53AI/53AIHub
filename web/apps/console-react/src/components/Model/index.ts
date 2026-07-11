import channelApi, { transformSelectData } from '@/api/modules/channel/index'
import { cacheManager as cache } from '@km/shared-utils'
import type { ReasoningMode, ModelUseType } from '@/constants/platform/config'

const MODEL_CACHE_PREFIX = 'modelList_'

/**
 * 清除模型列表缓存
 */
export const clearModelCache = () => {
  cache.clear()
}

/**
 * 加载模型列表
 * @param type - 模型类型
 * @param mode - 全部、普通、深度思考
 * @returns 模型列表
 */
export const loadModels = (type?: ModelUseType, mode?: ReasoningMode): Promise<any[]> => {
  return cache.getOrFetch(`${MODEL_CACHE_PREFIX}${type}_${mode}`, () =>
    channelApi.listv2().then(res => {
      const modelList = res
        .map((item: any) => transformSelectData(item, type, mode))
        .filter((item: any) => item.options.length > 0)
      return modelList
    })
  )
}

// 导出组件
export { default as ModelView } from './view'
export { default as ModelSelect } from './select'
export { default as ModelDialog } from './dialog'
