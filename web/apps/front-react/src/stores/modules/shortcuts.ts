import { create } from 'zustand'
import shortcutsApi from '@/api/modules/shortcuts'
import { checkPermission } from '@/utils/permission'
import { buildUrl, buildWikiPageUrl } from '@/utils/router'
import { message } from 'antd'
import { t } from '@/locales'
import type { ShortcutItem, ShortcutType } from '@/api/modules/shortcuts/types'

/** Agent 快捷方式跳转配置 */
interface AgentShortcutNavigateOptions {
  agentId: string
  isSoftStyle: boolean
  /** 软件模式下的导航函数，用于页面内跳转而非新开窗口 */
  navigate?: (path: string) => void
}

/**
 * 处理 Agent 快捷方式跳转
 * - 网站模式：新开窗口跳转到 /chat?agent_id=xxx
 * - 软件模式：检查是否已添加到工作台，未添加则先添加，然后在当前页面导航到 /agent/agent?agent_id=xxx
 */
export async function navigateAgentShortcut(options: AgentShortcutNavigateOptions): Promise<void> {
  const { agentId, isSoftStyle, navigate } = options

  // 网站模式：新开窗口跳转到 /chat?agent_id=xxx
  if (!isSoftStyle) {
    window.open(`/chat?agent_id=${agentId}`, '_blank')
    return
  }

  // 软件模式：检查是否已添加到工作台
  try {
    // 动态导入避免循环依赖
    const { useAgentStore } = await import('@/stores/modules/agent')
    const agentStore = useAgentStore.getState()

    // 先确保加载了快捷方式ID列表
    await agentStore.loadShortcutIds()

    const isAdded = agentStore.isShortcutAdded(agentId)
    if (!isAdded) {
      // 没有添加则先添加到工作台
      await agentStore.addShortcut(agentId)
    }

    // 跳转到工作台智能体页
    const targetPath = `/agent/agent?agent_id=${agentId}`
    if (navigate) {
      navigate(targetPath)
    } else {
      // 降级处理：如果没有传入 navigate，则使用 hash 导航
      window.location.hash = targetPath
    }
  } catch (error) {
    console.error('快捷方式跳转失败:', error)
    // 失败时仍然尝试跳转
    const targetPath = `/agent/agent?agent_id=${agentId}`
    if (navigate) {
      navigate(targetPath)
    } else {
      window.location.hash = targetPath
    }
  }
}

interface ShortcutsState {
  shortcuts: ShortcutItem[]
  loading: boolean
  shortcutsByType: (type: ShortcutType) => ShortcutItem[]
  isShortcut: (type: ShortcutType, related_id: string) => boolean
  getShortcut: (type: ShortcutType, related_id: string) => ShortcutItem | undefined
  getShortcutRoute: (shortcut: {
    type: ShortcutType
    related_id: string
    url?: string
    related_info?: { library_id?: string; space_id?: string; slug?: string }
  }) => string
  loadShortcuts: () => Promise<void>
  addShortcut: (
    type: ShortcutType,
    related_id: string,
    related_info?: { library_id?: string; space_id?: string; slug?: string },
  ) => Promise<ShortcutItem>
  removeShortcut: (type: ShortcutType, related_id: string) => Promise<void>
  toggleShortcut: (
    type: ShortcutType,
    related_id: string,
    related_info?: { library_id?: string; space_id?: string; slug?: string },
  ) => Promise<boolean>
}

export const useShortcutsStore = create<ShortcutsState>((set, get) => ({
  shortcuts: [],
  loading: false,

  /**
   * 根据类型获取快捷方式列表
   */
  shortcutsByType: (type) => {
    return get().shortcuts.filter(item => item.type === type)
  },

  /**
   * 检查某个资源是否已添加快捷方式
   */
  isShortcut: (type, related_id) => {
    return get().shortcuts.some(
      item => item.type === type && (item.related_id === related_id || item.raw_related_id === parseInt(related_id))
    )
  },

  /**
   * 获取某个资源的快捷方式
   */
  getShortcut: (type, related_id) => {
    return get().shortcuts.find(
      item => item.type === type && (item.related_id === related_id || item.raw_related_id === parseInt(related_id))
    )
  },

  /**
   * 根据快捷方式获取跳转路由
   */
  getShortcutRoute: (shortcut) => {
    const { type, related_id, url, related_info } = shortcut
    switch (type) {
      case "agent":
        return buildUrl(`/agent/${related_id}`)
      case "library":
        return buildUrl(`/library/${related_id}`)
      case "file":
        return buildUrl(`/library/${related_info?.library_id || ""}/file/${related_id}`)
      case "wiki_page":
        return buildWikiPageUrl(
          related_info?.space_id || "",
          related_info?.slug || related_id,
        )
      case "space_wiki":
        // 空间快捷方式：related_id 是空间 HashID，跳转到 Wiki 索引页
        return buildUrl("/knowledge/wiki", {
          space_id: related_id,
          sub: "index",
        })
      case "ai_link":
        return url || ""
      default:
        return buildUrl("/")
    }
  },

  /**
   * 加载所有快捷方式
   */
  loadShortcuts: async () => {
    set({ loading: true })
    try {
      const response = await shortcutsApi.list()
      set({ shortcuts: response.shortcuts || [] })
    } catch (error) {
      console.error('加载快捷方式失败:', error)
      set({ shortcuts: [] })
    } finally {
      set({ loading: false })
    }
  },

  /**
   * 添加快捷方式
   */
  addShortcut: async (type, related_id, related_info) => {
    try {
      if (!checkPermission()) {
        throw new Error(t('authority.login_not_permission'))
      }
      const shortcut = await shortcutsApi.create({ type, related_id, related_info })
      // 如果列表中不存在，则添加
      const shortcuts = get().shortcuts
      if (!shortcuts.find(item => item.id === shortcut.id)) {
        set({ shortcuts: [...shortcuts, shortcut] })
      }
      message.success(t('action.add_success'))
      return shortcut
    } catch (error) {
      console.error('添加快捷方式失败:', error)
      throw error
    }
  },

  /**
   * 移除快捷方式
   */
  removeShortcut: async (type, related_id) => {
    try {
      const shortcut = get().getShortcut(type, related_id)
      if (!shortcut) {
        throw new Error('快捷方式不存在')
      }
      await shortcutsApi.remove(shortcut.id)
      set({ shortcuts: get().shortcuts.filter(item => item.id !== shortcut.id) })
      message.success(t('action.remove_success'))
    } catch (error) {
      console.error('移除快捷方式失败:', error)
      throw error
    }
  },

  /**
   * 切换快捷方式（如果存在则移除，不存在则添加）
   */
  toggleShortcut: async (type, related_id, related_info) => {
    const existing = get().getShortcut(type, related_id)
    if (existing) {
      await get().removeShortcut(type, related_id)
      return false
    } else {
      await get().addShortcut(type, related_id, related_info)
      return true
    }
  },
}))
