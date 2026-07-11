/**
 * Toolbox 模块状态管理
 * 使用 Zustand 统一管理列表页数据状态
 * 注意：筛选状态由 useListState hook 管理（URL持久化）
 */
import { create } from 'zustand'
import type { AiLinkItem, GroupOption, RawGroupOption } from './types'
import { toolboxApi } from './api/toolboxApi'
import { GROUP_TYPE_AI_LINK, ALL_GROUP_ID } from './constants'

interface ToolboxState {
  // 数据
  aiLinkList: AiLinkItem[]
  groupOptions: GroupOption[]
  rawGroupOptions: RawGroupOption[]

  // 状态
  loading: boolean
  saving: boolean
  isSort: boolean

  // Actions
  loadGroups: () => Promise<void>
  loadListData: (keyword?: string) => Promise<void>
  setIsSort: (isSort: boolean) => void
  setSaving: (saving: boolean) => void
  updateGroupOptions: (options: RawGroupOption[]) => void
  updateSortOrder: (groups: GroupOption[]) => void
  refresh: () => Promise<void>
}

export const useToolboxStore = create<ToolboxState>((set, get) => ({
  // 初始状态
  aiLinkList: [],
  groupOptions: [],
  rawGroupOptions: [],
  loading: false,
  saving: false,
  isSort: false,

  // 加载分组
  loadGroups: async () => {
    const options = await toolboxApi.loadGroups(GROUP_TYPE_AI_LINK)
    set({ rawGroupOptions: options })
  },

  // 加载列表数据（参考Vue版本：不传group_id给后端，前端过滤）
  loadListData: async (keyword?: string) => {
    const { groupOptions } = get()

    set({ loading: true })
    try {
      // 只传keyword，不传group_id（前端过滤）
      const data = await toolboxApi.list({
        keyword: keyword || undefined,
      })

      // 分组处理
      const groups = groupOptions.length > 0
        ? groupOptions
        : get().rawGroupOptions.map((item) => ({
            group_id: item.group_id,
            group_name: item.group_name,
            children: [],
          }))

      const groupedData = groups.map((group) => {
        if (String(group.group_id) === ALL_GROUP_ID) return group
        const children = data
          .filter((item) => item.group_id === Number(group.group_id))
          .sort((a, b) => b.sort - a.sort)
        return { ...group, children }
      })

      set({
        aiLinkList: data,
        groupOptions: groupedData,
      })
    } finally {
      set({ loading: false })
    }
  },

  // 设置排序模式
  setIsSort: (isSort) => set({ isSort }),

  // 设置保存状态
  setSaving: (saving) => set({ saving }),

  // 更新分组选项（从 GroupTabs 回调）
  updateGroupOptions: (options) => {
    const { aiLinkList } = get()
    const groups: GroupOption[] = options.map((item) => ({
      group_id: item.group_id,
      group_name: item.group_name,
      children: [],
    }))

    // 重新分组
    const groupedData = groups.map((group) => {
      const children = aiLinkList
        .filter((item) => item.group_id === Number(group.group_id))
        .sort((a, b) => b.sort - a.sort)
      return { ...group, children }
    })

    set({ groupOptions: groupedData })
  },

  // 更新排序顺序
  updateSortOrder: (groups) => set({ groupOptions: groups }),

  // 刷新数据（需要外部传入参数）
  refresh: async () => {
    // refresh 仅触发 loading 状态，实际数据加载由组件控制
    set({ loading: true })
    set({ loading: false })
  },
}))
