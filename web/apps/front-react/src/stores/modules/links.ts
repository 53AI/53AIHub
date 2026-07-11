import { create } from 'zustand'
import groupApi from '@/api/modules/group'
import linksApi from '@/api/modules/links'
import { GROUP_TYPE } from '@/constants/group'

const CACHE_KEYS = {
  CATEGORY_LIST: 'links_category_list',
  LINKS_LIST: 'links_list',
}

// Simple cache manager
const cache = {
  data: new Map<string, { value: unknown; timestamp: number }>(),
  ttl: 5 * 60 * 1000, // 5 minutes

  get<T>(key: string): T | null {
    const item = cache.data.get(key)
    if (item && Date.now() - item.timestamp < cache.ttl) {
      return item.value as T
    }
    return null
  },

  set(key: string, value: unknown) {
    cache.data.set(key, { value, timestamp: Date.now() })
  },
}

interface LinksState {
  categorys: Category.State[]
  links: Link.State[]
  loadCategorys: () => Promise<void>
  loadLinks: () => Promise<void>
}

const allGroup = { group_name: '全部', group_id: 0 }

export const useLinksStore = create<LinksState>((set, get) => ({
  categorys: [{ ...allGroup }],
  links: [],

  loadCategorys: async () => {
    const cached = cache.get<Category.State[]>(CACHE_KEYS.CATEGORY_LIST)
    if (cached) {
      set({ categorys: cached })
      return
    }

    try {
      const data = await groupApi.current_list(GROUP_TYPE.AI_LINK)
      const list = data.map((item) => {
        item.visible = true
        return item
      })
      list.unshift(allGroup)
      cache.set(CACHE_KEYS.CATEGORY_LIST, list)
      set({ categorys: list })
    } catch {
      set({ categorys: [{ ...allGroup }] })
    }
  },

  loadLinks: async () => {
    const cached = cache.get<Link.State[]>(CACHE_KEYS.LINKS_LIST)
    if (cached) {
      set({ links: cached })
      return
    }

    try {
      const res = await linksApi.currentList()
      const links = res.data.map(item => {
        item.visible = true
        return item
      })
      cache.set(CACHE_KEYS.LINKS_LIST, links)
      set({ links })
    } catch {
      set({ links: [] })
    }
  },
}))
