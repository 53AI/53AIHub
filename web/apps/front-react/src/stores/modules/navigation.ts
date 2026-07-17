import { create } from 'zustand'
import navigationApi from '@/api/modules/navigation'
import { NAVIGATION_TYPE, NAVIGATION_TARGET, INIT_DATA_LIST } from '@/constants/navigation'
import { cacheManager as cache } from '@km/shared-utils'
import { img_host } from '@/utils/config'
import { updateMessages } from '@/locales'
import { buildUrl } from '@/utils/router'
import { checkVersion } from '@/utils/version'
import { VERSION_MODULE } from '@/constants/enterprise'

const getFormatData = (data: Navigation.State): Navigation.State => {
  try {
    data.config = typeof data.config === 'string' ? JSON.parse(data.config) : data.config
  } catch {
    data.config = {}
  }
  data.type = +data.type || +data.config?.type || NAVIGATION_TYPE.SYSTEM
  data.target = +data.target || +data.config?.target || NAVIGATION_TARGET.SELF
  data.url = data.menu_path = data.jump_path = data.jump_path || ''

  if ([NAVIGATION_TYPE.CUSTOM, NAVIGATION_TYPE.SYSTEM].includes(data.type)) {
    if (data.menu_path !== '/index') data.menu_path = `${data.jump_path}`
    data.url = buildUrl(data.menu_path)
  }
  if (data.type === NAVIGATION_TYPE.EXTERNAL && data.target === NAVIGATION_TARGET.SELF) {
    data.menu_path = '/page-' + String(data.navigation_id).split('').map((char) => char.charCodeAt(0).toString(36)).join('')
  }

  // System page icons are fixed
  if (data.type === 1) {
    const pathIconMap: Record<string, number> = {
      '/index': 34,
      '/agent': 33,
      '/prompt': 32,
      '/toolkit': 10,
      '/knowledge': 5,
      '/skills': 35,
    }
    data.icon = `${img_host}/icon/icon${pathIconMap[data.jump_path]}.png`
  } else if (data.icon?.indexOf('default') !== -1) {
    data.icon = `${img_host}/icon/icon5.png`
  }
  return data
}

const CACHE_KEYS = {
  NAVIGATION_LIST: 'navigation_list'
}

const cacheRaw = JSON.parse(localStorage.getItem(CACHE_KEYS.NAVIGATION_LIST) || 'null')
const cacheNavigations = Array.isArray(cacheRaw) ? cacheRaw : (cacheRaw?.list || [])
const cacheHasKnowledge = typeof cacheRaw?.hasKnowledge === 'boolean' ? cacheRaw.hasKnowledge : false

interface NavigationState {
  navigations: Navigation.State[]
  agentNavigation: Partial<Navigation.State>
  promptNavigation: Partial<Navigation.State>
  toolkitNavigation: Partial<Navigation.State>
  homeNavigation: Partial<Navigation.State>
  knowledgeNavigation: Partial<Navigation.State>
  skillsNavigation: Partial<Navigation.State>
  loading: boolean
  hasKnowledge: boolean
  fetchNavigations: () => Promise<Navigation.State[]>
  getNavState: (jump_path: string) => Partial<Navigation.State> | null
}

export const useNavigationStore = create<NavigationState>((set, get) => ({
  navigations: cacheNavigations,
  agentNavigation: cacheNavigations.find((item: Navigation.State) => item.jump_path === '/agent') || {},
  promptNavigation: cacheNavigations.find((item: Navigation.State) => item.jump_path === '/prompt') || {},
  toolkitNavigation: cacheNavigations.find((item: Navigation.State) => item.jump_path === '/toolkit') || {},
  homeNavigation: cacheNavigations.find((item: Navigation.State) => item.jump_path === '/index') || {},
  knowledgeNavigation: cacheNavigations.find((item: Navigation.State) => item.jump_path === '/knowledge') || {},
  skillsNavigation: cacheNavigations.find((item: Navigation.State) => item.jump_path === '/skills') || {},
  loading: false,
  hasKnowledge: cacheHasKnowledge,

  fetchNavigations: async () => {
    set({ loading: true })

    const fetchData = async () => {
      let { list = [] } = await navigationApi.list().catch(() => {
        set({ loading: false })
        return { list: [] }
      })

      if (!list.length) list = INIT_DATA_LIST

      const hasKnowledge = checkVersion(VERSION_MODULE.KNOWLEDGE_BASE)
      const hasAgent = checkVersion(VERSION_MODULE.AGENT)
      const hasPrompt = checkVersion(VERSION_MODULE.PROMPT)
      const hasToolkit = checkVersion(VERSION_MODULE.AI_LINK)

      list = list.filter((item: Navigation.State) => {
        if (item.jump_path === '/knowledge') return hasKnowledge
        if (item.jump_path === '/agent') return hasAgent
        if (item.jump_path === '/prompt') return hasPrompt
        if (item.jump_path === '/toolkit') return hasToolkit
        return true
      })

      return { list, hasKnowledge, hasAgent, hasPrompt, hasToolkit }
    }

    const result = await cache.getOrFetch(CACHE_KEYS.NAVIGATION_LIST, fetchData)
    const list = result.list
    const hasKnowledge = result.hasKnowledge ?? checkVersion(VERSION_MODULE.KNOWLEDGE_BASE)
    const navigations = list.map((item: Navigation.State) => getFormatData(item))

    const agentNavigation = navigations.find((item: Navigation.State) => item.jump_path === '/agent') || {}
    const promptNavigation = navigations.find((item: Navigation.State) => item.jump_path === '/prompt') || {}
    const toolkitNavigation = navigations.find((item: Navigation.State) => item.jump_path === '/toolkit') || {}
    const knowledgeNavigation = navigations.find((item: Navigation.State) => item.jump_path === '/knowledge') || {}
    const homeNavigation = navigations.find((item: Navigation.State) => item.jump_path === '/index') || {}
    const skillsNavigation = navigations.find((item: Navigation.State) => item.jump_path === '/skills') || {}
    set({
      loading: false,
      navigations,
      agentNavigation,
      promptNavigation,
      toolkitNavigation,
      knowledgeNavigation,
      homeNavigation,
      skillsNavigation,
      hasKnowledge: hasKnowledge && !!knowledgeNavigation.status,
    })

    // 动态更新导航模块名称翻译（扁平 key 结构）
    updateMessages('zh-cn', {
      'module.agent': (agentNavigation as Navigation.State).name,
      'module.prompt': (promptNavigation as Navigation.State).name,
      'module.toolbox': (toolkitNavigation as Navigation.State).name,
      'module.index': (homeNavigation as Navigation.State).name,
      'module.skill': (skillsNavigation as Navigation.State).name
    })

    // 缓存完整结果（包含版本检查结果）
    localStorage.setItem(CACHE_KEYS.NAVIGATION_LIST, JSON.stringify({ list: navigations, hasKnowledge }))
    return navigations
  },

  getNavState: (jump_path: string) => {
    const nav = get().navigations.find((item) => item.jump_path === jump_path) || null
    if (nav && nav.status) return nav
    return null
  }
}))
