/**
 * System Log 模块状态管理
 * 使用 Zustand 统一管理列表页数据状态
 * 注意：筛选状态由 useListState hook 管理（URL持久化）
 */
import { create } from 'zustand'
import { systemLogApi, transformSystemLogList } from './api/systemLogApi'
import type {
  SystemLogDisplayItem,
  SystemLogListParams,
  ActionItem,
  ModuleItem,
} from './types'

interface SystemLogState {
  // 数据状态
  list: SystemLogDisplayItem[]
  total: number
  actions: ActionItem[]
  modules: ModuleItem[]

  // UI 状态
  loading: boolean

  // Actions
  loadList: (params: SystemLogListParams) => Promise<void>
  loadActions: () => Promise<void>
  loadModules: () => Promise<void>
  refresh: () => Promise<void>
}

/**
 * 计算当前页码
 */
export function calculateCurrentPage(offset: number, limit: number): number {
  return Math.floor(offset / limit) + 1
}

/**
 * 计算偏移量
 */
export function calculateOffset(page: number, pageSize: number): number {
  return (page - 1) * pageSize
}

export const useSystemLogStore = create<SystemLogState>((set, get) => ({
  // 初始状态
  list: [],
  total: 0,
  actions: [],
  modules: [],
  loading: false,

  // 加载日志列表
  loadList: async (params: SystemLogListParams) => {
    set({ loading: true })
    try {
      const response = await systemLogApi.list(params)
      set({
        list: transformSystemLogList(response.system_logs || []),
        total: response.count || 0,
      })
    } finally {
      set({ loading: false })
    }
  },

  // 加载操作类型列表
  loadActions: async () => {
    const data = await systemLogApi.actions()
    set({ actions: data })
  },

  // 加载模块列表
  loadModules: async () => {
    const data = await systemLogApi.modules()
    set({ modules: data })
  },

  // 刷新数据（需要外部传入参数）
  refresh: async () => {
    // refresh 仅触发 loading 状态，实际数据加载由组件控制
    set({ loading: true })
    set({ loading: false })
  },
}))
