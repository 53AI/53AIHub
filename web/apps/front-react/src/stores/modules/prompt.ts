import { create } from 'zustand'
import groupApi from '@/api/modules/group'
import promptApi from '@/api/modules/prompt'
import { GROUP_TYPE } from '@/constants/group'
import { api_host } from '@/utils/config'

interface PromptState {
  categorys: Category.State[]
  promptList: Prompt.State[]
  loadPromptList: () => Promise<Prompt.State[]>
  loadCategorys: () => Promise<void>
  updatePromptLike: (promptId: string, isLiked: boolean) => void
}

export const usePromptStore = create<PromptState>((set, get) => ({
  categorys: [],
  promptList: [],

  loadPromptList: async () => {
    try {
      const res = await promptApi.list()
      const promptList = (res.prompts || []).map((item: Prompt.State) => {
        try {
          item.custom_config_obj = item.custom_config ? JSON.parse(item.custom_config) : {}
        } catch {
          item.custom_config_obj = {}
        }
        item.logo = item.logo || `${ api_host }/api/images/prompt/logo.png`
        return item 
      })
      set({ promptList })
      return promptList
    } catch {
      return []
    }
  },

  loadCategorys: async () => {
    try {
      const data = await groupApi.current_list(GROUP_TYPE.PROMPT)
      const categorys = [
        { group_id: 0, group_name: '全部' },
        ...data
      ] as Category.State[]
      set({ categorys })
    } catch {
      set({ categorys: [{ group_id: 0, group_name: '全部' }] })
    }
  },

  updatePromptLike: (promptId: string, isLiked: boolean) => {
    const { promptList } = get()
    const updatedList = promptList.map((item) => {
      if (item.prompt_id === promptId) {
        return {
          ...item,
          is_liked: isLiked,
          likes: isLiked ? (item.likes || 0) + 1 : (item.likes || 1) - 1,
        }
      }
      return item
    })
    set({ promptList: updatedList })
  },
}))
