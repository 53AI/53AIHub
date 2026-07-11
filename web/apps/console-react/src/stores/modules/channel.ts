import { create } from 'zustand'
import { deepCopy } from '@km/shared-utils'
import channelApiIndex, { transformModelList, type ModelOption } from '@/api/modules/channel/index'
interface ChannelState {
  modelConfigList: ModelOption[]
  modelConfigListCopy: () => ModelOption[]
  loadModelConfig: (reset?: boolean) => Promise<ModelOption[]>
  save: (opts?: { data?: Record<string, unknown> }) => Promise<unknown>
}

export const useChannelStore = create<ChannelState>((set, get) => ({
  modelConfigList: [],

  modelConfigListCopy() {
    return deepCopy(get().modelConfigList)
  },

  async loadModelConfig(reset = false) {
    if (!reset && get().modelConfigList.length) {
      return get().modelConfigListCopy()
    }
    const res = await channelApiIndex.models.config()
    const transformedList = transformModelList(res)
    set({ modelConfigList: transformedList })
    return transformedList
  },

  async save({ data = {} } = {}) {
    return channelApiIndex.save({ data } as any)
  },
}))

export type { ModelOption }
