import { create } from 'zustand'
import { cacheManager as cache } from '@km/shared-utils'
import groupApi from '@/api/modules/group'
import skillApi from '@/api/modules/skill'
import type { Skill, AgentSkillBindingItem } from '@/api/modules/skill/types'
import { GROUP_TYPE } from '@/constants/group'
import { t } from "@/locales"
import { api_host } from '@/utils/config'

const CACHE_KEYS = {
  SKILL_LIST: 'skill_list',
  MY_SKILL_LIST: 'my_skill_list',
  CATEGORY_LIST: 'skill_category_list',
  AGENT_SKILLS: 'agent_skills', // 新增：按 agentId 缓存技能列表
} as const

interface SkillsState {
  categorys: { group_id: number; group_name: string }[]
  skillList: Skill[]
  currentSkillGroupId: number // 当前 skillList 对应的 group_id
  mySkillList: Skill[]
  mySkillLoading: boolean
  // 新增：Agent 技能列表管理（使用 string 作为 key，统一处理 string | number）
  agentSkillsMap: Map<string, AgentSkillBindingItem[]>
  agentSkillsLoading: boolean
  loadSkillList: (params?: { keyword?: string; offset?: number; limit?: number; isRefresh?: boolean; group_id?: number }) => Promise<Skill[]>
  loadCategorys: () => Promise<void>
  loadMySkillList: (isRefresh?: boolean, silent?: boolean) => Promise<Skill[]>
  addSkill: (skill: Skill) => void
  removeSkill: (skillId: string) => void
  // 新增：Agent 技能相关方法（支持 string | number）
  loadAgentSkills: (agentId: string | number) => Promise<AgentSkillBindingItem[]>
  addAgentSkill: (agentId: string | number, skill: AgentSkillBindingItem) => void
  removeAgentSkill: (agentId: string | number, bindingId: string | number) => void
  clearAgentSkills: (agentId?: string | number) => void
  /** 清除技能列表缓存并重置 group_id */
  clearSkillListCache: () => void
}

// 统一转换 agentId 为 Map key
const getAgentKey = (agentId: string | number) => String(agentId);

export const useSkillsStore = create<SkillsState>((set, get) => ({
  categorys: [],
  skillList: [],
  currentSkillGroupId: 0,
  mySkillList: [],
  mySkillLoading: false,
  agentSkillsMap: new Map(),
  agentSkillsLoading: false,

  loadSkillList: async (params) => {
    const { offset = 0, limit = 500, isRefresh, group_id = 0, ...rest } = params || {}
    const fetchSkills = async () => {
      const res = await skillApi.explore({ offset, limit, group_id: group_id || undefined, ...rest })
      return (res.items || []).map(item => {
        item.logo = item.logo || `${ api_host }/api/images/skill/logo.png`
        return item
      })
    }

    if (params?.keyword !== undefined || isRefresh) {
      const skills = await fetchSkills()
      set({ skillList: skills, currentSkillGroupId: group_id })
      cache.set(CACHE_KEYS.SKILL_LIST, skills)
      return skills
    }

    const skills = await cache.getOrFetch(CACHE_KEYS.SKILL_LIST, fetchSkills)
    set({ skillList: skills, currentSkillGroupId: group_id })
    return skills
  },

  loadCategorys: async () => {
    const fetchCategories = async () => {
      const data = await groupApi.current_list(GROUP_TYPE.SKILLS)
      return [{ group_id: 0, group_name: t('common.all') }].concat(data) as { group_id: number; group_name: string }[]
    }
    const categorys = await cache.getOrFetch(CACHE_KEYS.CATEGORY_LIST, fetchCategories)
    set({ categorys })
  },

  loadMySkillList: async (isRefresh = false, silent = false) => {
    if (!silent) {
      set({ mySkillLoading: true })
    }
    try {
      const fetchMySkills = async () => {
        const res = await skillApi.getMyList({ offset: 0, limit: 500 })
        return (res.items || []).map(item => {
        item.logo = item.logo || `${ api_host }/api/images/skill/logo.png`
        return item
      })
      }

      if (isRefresh) {
        const mySkillList = await fetchMySkills()
        set({ mySkillList })
        cache.set(CACHE_KEYS.MY_SKILL_LIST, mySkillList)
        return mySkillList
      }

      const mySkillList = await cache.getOrFetch(CACHE_KEYS.MY_SKILL_LIST, fetchMySkills)
      set({ mySkillList })
      return mySkillList
    } finally {
      if (!silent) {
        set({ mySkillLoading: false })
      }
    }
  },

  addSkill: (skill) => {
    const { mySkillList, skillList } = get()
    const exists = mySkillList.some(s => s.id === skill.id)
    if (!exists) {
      set({ mySkillList: [...mySkillList, { ...skill, added: true, binding_status: 'enabled' }] })
    }
    const index = skillList.findIndex(s => s.id === skill.id)
    if (index !== -1) {
      const newSkillList = [...skillList]
      newSkillList[index] = { ...newSkillList[index], added: true }
      set({ skillList: newSkillList })
    }
    cache.delete(CACHE_KEYS.MY_SKILL_LIST)
  },

  removeSkill: (skillId) => {
    const { mySkillList, skillList } = get()
    set({ mySkillList: mySkillList.filter(s => s.id !== skillId) })
    const index = skillList.findIndex(s => s.id === skillId)
    if (index !== -1) {
      const newSkillList = [...skillList]
      newSkillList[index] = { ...newSkillList[index], added: false }
      set({ skillList: newSkillList })
    }
    cache.delete(CACHE_KEYS.MY_SKILL_LIST)
  },

  // ========== Agent 技能管理 ==========

  loadAgentSkills: async (agentId: string | number) => {
    const key = getAgentKey(agentId);
    set({ agentSkillsLoading: true })
    try {
      const skills = await skillApi.getAgentSkills(agentId)

      set(state => {
        const newMap = new Map(state.agentSkillsMap)
        newMap.set(key, skills.map(item => {
        item.logo = item.logo || `${ api_host }/api/images/skill/logo.png`
        return item
      }))
        return { agentSkillsMap: newMap }
      })

      return skills
    } finally {
      set({ agentSkillsLoading: false })
    }
  },

  addAgentSkill: (agentId: string | number, skill: AgentSkillBindingItem) => {
    const key = getAgentKey(agentId);
    set(state => {
      const newMap = new Map(state.agentSkillsMap)
      const current = newMap.get(key) || []
      if (!current.some(s => String(s.binding_id) === String(skill.binding_id))) {
        newMap.set(key, [...current, skill])
        return { agentSkillsMap: newMap }
      }
      return state
    })
  },

  removeAgentSkill: (agentId: string | number, bindingId: string | number) => {
    const key = getAgentKey(agentId);
    set(state => {
      const newMap = new Map(state.agentSkillsMap)
      const current = newMap.get(key) || []
      newMap.set(key, current.filter(s => String(s.binding_id) !== String(bindingId)))
      return { agentSkillsMap: newMap }
    })
  },

  clearAgentSkills: (agentId?: string | number) => {
    if (agentId !== undefined) {
      const key = getAgentKey(agentId);
      set(state => {
        const newMap = new Map(state.agentSkillsMap)
        newMap.delete(key)
        return { agentSkillsMap: newMap }
      })
    } else {
      set({ agentSkillsMap: new Map() })
    }
  },

  clearSkillListCache: () => {
    set({ skillList: [], currentSkillGroupId: 0 })
    cache.delete(CACHE_KEYS.SKILL_LIST)
  },
}))
