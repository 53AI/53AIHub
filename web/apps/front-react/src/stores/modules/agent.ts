import { create } from 'zustand'
import { useMemo } from 'react'
import groupApi from '@/api/modules/group'
import agentApi from '@/api/modules/agents/index'
import { parseAgentParsedFields } from '@/api/modules/agents/transform'
import agentShortcutsApi from '@/api/modules/agent-shortcuts'
import { cacheManager as cache, eventBus } from '@km/shared-utils'
import { GROUP_TYPE } from '@/constants/group'
import { useConversationStore } from './conversation'
import { EVENT_NAMES } from '@/constants/events'
import { AGENT_USAGES } from '@/constants/agent'
import { getPublicPath } from '@/utils/config'
// 缓存key常量
const CACHE_KEYS = {
  AGENT_LIST: 'agent_list',
  MY_AGENT_LIST: 'my_agent_list',
  CATEGORY_LIST: 'category_list',
  AGENT_SHORTCUT_IDS: 'agent_shortcut_ids'
} as const

export const DEFAULT_AGENT: Agent.State = {
  name: '',
  logo: '',
  agent_id: '',
  configs: '{}',
  custom_config_obj: {},
  settings_obj: {},
  description: '',
  user_group_ids: [],
}

interface AgentState {
  categorys: Category.State[]
  agentList: Agent.State[]
  myAgentList: Agent.State[]
  myAgentLoading: boolean
  boxHeight: number
  /** 已添加快捷方式的智能体 ID 集合 */
  shortcutIds: Set<string>
  /** 加载请求的 Promise（用于请求去重） */
  shortcutIdsLoadingPromise: Promise<void> | null
  setBoxHeight: (height: number) => void
  loadAgentList: () => Promise<Agent.State[]>
  loadCategorys: () => Promise<void>
  loadMyAgentList: (isRefresh?: boolean) => Promise<Agent.State[]>
  findAgentByAgentId: (agent_id: string) => Agent.State | undefined
  /** 检查智能体是否已添加快捷方式 */
  isShortcutAdded: (agent_id: string) => boolean
  /** 加载已添加的智能体快捷方式 ID 列表（同一时间段只请求一次） */
  loadShortcutIds: () => Promise<void>
  /** 标记智能体为已添加快捷方式 */
  markShortcutAdded: (agent_id: string) => void
  /** 添加智能体快捷方式（API + 状态更新） */
  addShortcut: (agent_id: string) => Promise<void>
}

export const useAgentStore = create<AgentState>((set, get) => ({
  categorys: [],
  agentList: [],
  myAgentList: [],
  myAgentLoading: false,
  boxHeight: 0,
  shortcutIds: new Set<string>(),
  shortcutIdsLoadingPromise: null,

  setBoxHeight: (height: number) => {
    set({ boxHeight: height })
  },

  loadAgentList: async () => {
    const fetchAgents = async () => {
      // const userStore = useUserStore()
      // const { is_internal } = userStore.info
      // 接口不用区分内外部，直接展示，然后点击时候判断权限
      // const { data: { agents = [] } = {} } = is_internal ? await agentApi.internalList() : await agentApi.list()
      // limit: 1000 用于获取完整的智能体列表（包括 agent_usage 等字段）
      const { data: { agents = [] } = {} } = await agentApi.available({ limit: 1000 })
      const list = agents.map((originalItem: Agent.State) => {
        const item = parseAgentParsedFields(originalItem)

        if (item.agent_usage === AGENT_USAGES.KM_AI_SEARCH) {
          item.name = item.name || 'AI搜问'
          item.logo = item.logo || getPublicPath('/images/chat/knowledge.png')
          item.custom_config_obj.agent_type = 'knowledge'
        } else if (item.agent_usage === AGENT_USAGES.WORK_AI) {
          item.name = item.name || '小助理'
          item.logo = item.logo || getPublicPath('/images/chat/workbench.png')
          item.custom_config_obj.agent_type = 'workbench'
        }
        return item
      })
      
      list.sort((a, b) => {
        // 排序优先级：AI搜问（is_system=true） > 小助理（is_system=true） > 其他
        const getRank = (item: Agent.State) => {
          if (item.is_system && item.agent_usage === AGENT_USAGES.KM_AI_SEARCH) return 0
          if (item.is_system && item.agent_usage === AGENT_USAGES.WORK_AI) return 1
          return 2
        }
        return getRank(a) - getRank(b)
      })

      return list
    }
    const agentList = await cache.getOrFetch(CACHE_KEYS.AGENT_LIST, fetchAgents, 0.1)
    set({ agentList })
    return agentList
  },

  loadCategorys: async () => {
    const fetchCategories = async () => {
      const data = await groupApi.current_list(GROUP_TYPE.AGENT)
      return [{ group_id: 0, group_name: '全部' }].concat(
        data
      ) as Category.State[]
    }

    const categorys = await cache.getOrFetch(CACHE_KEYS.CATEGORY_LIST, fetchCategories)
    set({ categorys })
  },

  loadMyAgentList: async (isRefresh = false) => {
    set({ myAgentLoading: true })
    try {
      const fetchMyAgents = async () => {
        const res = await agentApi.my.list({ offset: 0, limit: 100 })
        const data = res.data || res
        const list = data.agents || data || []
        return list.map((originalItem: Agent.State) => parseAgentParsedFields(originalItem))
      }
      let myAgentList: Agent.State[]
      if (isRefresh) {
        myAgentList = await fetchMyAgents()
      } else {
        myAgentList = await cache.getOrFetch(CACHE_KEYS.MY_AGENT_LIST, fetchMyAgents)
      }
      set({ myAgentList })
      return myAgentList
    } finally {
      set({ myAgentLoading: false })
    }
  },

  findAgentByAgentId: (agent_id) => {
    const state = get()
    return state.myAgentList.find((item) => String(item.agent_id) === String(agent_id)) ||
      state.agentList.find((item) => String(item.agent_id) === String(agent_id))
  },

  /**
   * 检查智能体是否已添加快捷方式
   */
  isShortcutAdded: (agent_id) => {
    return get().shortcutIds.has(String(agent_id))
  },

  /**
   * 加载已添加的智能体快捷方式 ID 列表
   * 同一时间段只会发起一次请求（请求去重）
   */
  loadShortcutIds: async () => {
    const state = get()

    // 如果正在加载，返回已有的 Promise（请求去重）
    if (state.shortcutIdsLoadingPromise) {
      return state.shortcutIdsLoadingPromise
    }

    // 发起新的加载请求
    const promise = agentShortcutsApi.getIds()
      .then((ids) => {
        set({
          shortcutIds: new Set(ids.map(id => String(id))),
          shortcutIdsLoadingPromise: null
        })
      })
      .catch((error) => {
        console.error('加载智能体快捷方式ID列表失败:', error)
        set({ shortcutIdsLoadingPromise: null })
      })

    set({ shortcutIdsLoadingPromise: promise })
    return promise
  },

  /**
   * 标记智能体为已添加快捷方式
   */
  markShortcutAdded: (agent_id) => {
    const shortcutIds = new Set(get().shortcutIds)
    shortcutIds.add(String(agent_id))
    set({ shortcutIds })
  },

  /**
   * 添加智能体快捷方式（API + 状态更新）
   */
  addShortcut: async (agent_id) => {
    await agentShortcutsApi.create({ agent_id })
    get().markShortcutAdded(agent_id)
    eventBus.emit(EVENT_NAMES.SHORTCUT_ADDED, agent_id)
  }
}))

export function useCurrentAgent() {
  const currentAgentId = useConversationStore((state) => state.current_agentid)
  const agentList = useAgentStore((state) => state.agentList)
  const myAgentList = useAgentStore((state) => state.myAgentList)
  return useMemo(
    () =>
      myAgentList.find((item) => String(item.agent_id) === String(currentAgentId)) ||
      agentList.find((item) => String(item.agent_id) === String(currentAgentId)) ||
      DEFAULT_AGENT,
    [myAgentList, agentList, currentAgentId]
  )
}
